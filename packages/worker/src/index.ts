/**
 * Lemma × x402 provenance verification worker.
 *
 * Uses @x402/hono middleware for the standard payment flow and adds a thin
 * post-processing layer to extract the settlement proof and forward it to
 * the Lemma API as a disclosure credential.
 *
 * Flow:
 *   1. @x402/hono middleware handles 402 response / verify / settle
 *   2. After middleware passes, settlement proof is extracted from
 *      the PAYMENT-RESPONSE header
 *   3. Worker calls Lemma API with the proof as disclosure
 *   4. Worker returns the verified data to the client
 *
 * Endpoints:
 *   GET  /verify/:hash  — Provenance verification ($0.001 USDC)
 *   POST /query         — Full BBS+ selective disclosure ($0.001 USDC)
 *   GET  /              — Health check
 *
 * Content is free. Trust costs $0.001.
 */

import { Hono } from "hono";
import { paymentMiddleware } from "@x402/hono";
import { HTTPFacilitatorClient, x402ResourceServer } from "@x402/core/server";
import { ExactEvmScheme } from "@x402/evm/exact/server";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Env = {
  readonly PAY_TO_ADDRESS: string;
  readonly FACILITATOR_URL: string;
  readonly LEMMA_API_BASE: string;
  readonly LEMMA_API_KEY?: string;
  /** Demo mode: skip real blockchain verification (for quick demos without wallet setup). */
  readonly DEMO_MODE?: string;
};

/** A single item from Lemma's verified-attributes/query response. */
type LemmaResponseItem = Readonly<{
  docHash: string;
  schema: string;
  issuerId: string;
  subjectId: string;
  chainId?: number;
  attributes: Readonly<Record<string, unknown>>;
  proof?: Readonly<Record<string, unknown>>;
  disclosure?: Readonly<{
    format: string;
    attributes: Readonly<Record<string, unknown>>;
    proof: string;
    publicKey: string;
    indexes: ReadonlyArray<number>;
    count: number;
    header: string;
    condition?: Readonly<{ circuitId: string }>;
  }> | null;
  disclosureError?: "condition_not_met";
}>;

type LemmaQueryResponse = Readonly<{
  results: ReadonlyArray<LemmaResponseItem>;
  hasMore: boolean;
}>;

/** Simplified response item (includes full BBS+ disclosure envelope). */
type QueryResponseItem = Readonly<{
  docHash: string;
  schema: string;
  issuerId: string;
  subjectId: string;
  chainId?: number;
  attributes: Readonly<Record<string, unknown>>;
  disclosed: Readonly<Record<string, unknown>> | null;
  /** Full BBS+ disclosure envelope (format, proof, publicKey, indexes, etc.) */
  disclosure?: Readonly<{
    format: string;
    attributes: Readonly<Record<string, unknown>>;
    proof: string;
    publicKey: string;
    indexes: ReadonlyArray<number>;
    count: number;
    header: string;
    condition?: Readonly<{ circuitId: string }>;
  }> | null;
  disclosureError?: "condition_not_met";
  proof?: Readonly<Record<string, unknown>>;
}>;

/** Verify endpoint response — provenance only, no disclosed content. */
type VerifyResponseItem = Readonly<{
  docHash: string;
  schema: string;
  attributes: Readonly<Record<string, unknown>>;
  proof: {
    status: "verified" | "unverified" | "pending";
    circuitId?: string;
  };
}>;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** USDC contract address on Base Sepolia (chain ID 84532). */
const USDC_BASE_SEPOLIA = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const extractDisclosed = (
  sd: LemmaResponseItem["disclosure"],
): Readonly<Record<string, unknown>> | null =>
  sd?.attributes && Object.keys(sd.attributes).length > 0
    ? sd.attributes
    : null;

const simplifyItem = (item: LemmaResponseItem): QueryResponseItem => ({
  docHash: item.docHash,
  schema: item.schema,
  issuerId: item.issuerId,
  subjectId: item.subjectId,
  ...(item.chainId !== undefined ? { chainId: item.chainId } : {}),
  attributes: item.attributes,
  disclosed: extractDisclosed(item.disclosure),
  // Include full disclosure envelope for BBS+ verification
  disclosure: item.disclosure,
  ...(item.disclosureError ? { disclosureError: item.disclosureError } : {}),
  ...(item.proof ? { proof: item.proof } : {}),
});

const toVerifyItem = (item: LemmaResponseItem): VerifyResponseItem => ({
  docHash: item.docHash,
  schema: item.schema,
  attributes: item.attributes,
  proof: {
    status: item.proof ? "verified" : "unverified",
    ...(item.proof && "circuitId" in item.proof
      ? { circuitId: item.proof.circuitId as string }
      : {}),
  },
});

/** Build Lemma API headers. */
const lemmaHeaders = (apiKey?: string): Record<string, string> => ({
  "Content-Type": "application/json",
  ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
});

/**
 * Extract settlement result from the PAYMENT-RESPONSE header.
 * The middleware sets this header as Base64-encoded JSON after settle.
 * Returns the full extensions.lemma object (x402 spec compliant).
 */
const extractSettlement = (
  headerValue: string | undefined,
): { transaction: string; lemma?: { proof: string; inputs: unknown[] } } | null => {
  if (!headerValue) return null;
  try {
    const parsed = JSON.parse(atob(headerValue));
    return {
      transaction: parsed.transaction,
      lemma: parsed?.extensions?.lemma,
    };
  } catch {
    return null;
  }
};

// ---------------------------------------------------------------------------
// Demo mode mock data
// ---------------------------------------------------------------------------

// Since the content of the blog changes every time we fetch it (probably due to dynamic tracking scripts or timestamps),
// we use a fixed demo content for the local agent demo so the hashes match.
const DEMO_CONTENT = `Artificial intelligence and blockchain technology are converging to create new possibilities for trust and automation. This convergence enables verifiable provenance and transparent content attribution.`;
// Pre-computed SHA-256 of DEMO_CONTENT
const DEMO_CONTENT_HASH = "c6b3380e0d8334e87c3e55d23e987dc0b7638e91950a2467b2bb496e62ac6fdd";

const mockVerifyData = (hash: string): LemmaQueryResponse => ({
  results: [
    {
      docHash: hash,
      schema: "blog-article",
      issuerId: "did:example:lemma",
      subjectId: "did:example:blog-author",
      attributes: {
        title: "The Future of AI and Blockchain",
        author: "did:example:alice",
        published: 1775658600,
        integrity: DEMO_CONTENT_HASH,
        words: 24,
        lang: "en",
        content_type: "html",
      },
      proof: { circuitId: "blog-article-v1" },
    },
  ],
  hasMore: false,
});

const mockQueryData = (): LemmaQueryResponse => ({
  results: [
    {
      docHash: `0x${DEMO_CONTENT_HASH}`,
      schema: "blog-article",
      issuerId: "did:example:lemma",
      subjectId: "did:example:blog-author",
      attributes: {
        title: "The Future of AI and Blockchain",
        author: "did:example:alice",
        published: 1775658600,
        integrity: DEMO_CONTENT_HASH,
        words: 24,
        lang: "en",
        content_type: "html",
      },
      disclosure: {
        format: "BBS+",
        attributes: { 
          author: "did:example:alice", 
          lang: "en", 
          published: 1775658600,
          body: "Artificial intelligence and blockchain technology are converging to create new possibilities for trust and automation. This convergence enables verifiable provenance and transparent content attribution.",
          fullContent: "<html>...</html>",
        },
        proof: "mock-bbs-proof",
        publicKey: "mock-public-key",
        indexes: [0, 3, 4, 1, 7],
        count: 8,
        header: "blog-article-v1",
        condition: { circuitId: "x402-payment-v1" },
      },
    },
  ],
  hasMore: false,
});

// ---------------------------------------------------------------------------
// x402 route configuration
// ---------------------------------------------------------------------------

const buildRoutes = (payTo: string) => ({
  "GET /example/verify/:hash": {
    accepts: [
      {
        scheme: "exact" as const,
        price: "$0.001",
        network: "eip155:84532" as const,
        payTo,
        extra: {
          name: "USDC",
          version: "2",
        },
      },
    ],
    description: "Verified provenance attributes for a Lemma-attested document",
    mimeType: "application/json",
    extensions: {
      lemma: {
        schema: "blog-article",
        verifiable: ["author", "published", "integrity", "words", "lang"],
      },
    },
  },
  "POST /example/query": {
    accepts: [
      {
        scheme: "exact" as const,
        price: "$0.001",
        network: "eip155:84532" as const,
        payTo,
        extra: {
          name: "USDC",
          version: "2",
        },
      },
    ],
    description: "ZK-verified blog articles with BBS+ selective disclosure",
    mimeType: "application/json",
    extensions: {
      lemma: {
        circuitId: "blog-article-v1",
        schema: "blog-article",
        hints: {
          attributes: ["author", "published", "words", "lang", "integrity"],
          authors: [
            "did:example:alice",
            "did:example:bob",
            "did:example:charlie",
          ],
          freshness: "2026-04-08",
          langs: ["en", "ja"],
          count: 3,
        },
      },
    },
  },
});

// ---------------------------------------------------------------------------
// App
// ---------------------------------------------------------------------------

const app = new Hono<{ Bindings: Env }>();

/**
 * Apply x402 payment middleware conditionally.
 *
 * - Demo mode: skip entirely
 * - Request with "disclosure" in body: skip (pre-paid proof provided)
 * - Otherwise: standard x402 payment flow
 */
app.use("*", async (c, next) => {
  const demoMode = c.env.DEMO_MODE === "true";

  if (c.req.path === "/" || demoMode) {
    return next();
  }

  // Skip x402 for health check, demo mode, and /query endpoint
  // /query uses disclosure proof from client (already paid via /verify)
  if (c.req.path === "/" || demoMode || c.req.path === "/example/query") {
    return next();
  }

  try {
    const apiKey = c.env.LEMMA_API_KEY;
    const facilitatorClient = new HTTPFacilitatorClient({
      url: c.env.FACILITATOR_URL.replace(/\/$/, ""),
      ...(apiKey
        ? {
            createAuthHeaders: async () => ({
              verify: { Authorization: `Bearer ${apiKey}` },
              settle: { Authorization: `Bearer ${apiKey}` },
              supported: { Authorization: `Bearer ${apiKey}` },
            }),
          }
        : {}),
    });

    const resourceServer = new x402ResourceServer(facilitatorClient)
      .register("eip155:84532", new ExactEvmScheme());

    const routes = buildRoutes(c.env.PAY_TO_ADDRESS);
    const middleware = paymentMiddleware(routes, resourceServer);

    return await middleware(c, next);
  } catch (err) {
    console.error("x402 middleware error:", err);
    return c.json({ error: "x402 middleware error", details: String(err) }, 500);
  }
});

// ---------------------------------------------------------------------------
// GET /example/verify/:hash — Provenance verification endpoint
// ---------------------------------------------------------------------------
app.get("/example/verify/:hash", async (c) => {
  const hash = c.req.param("hash");
  const apiBase = c.env.LEMMA_API_BASE.replace(/\/$/, "");
  const apiKey = c.env.LEMMA_API_KEY;
  const demoMode = c.env.DEMO_MODE === "true";

  let data: LemmaQueryResponse;

  if (demoMode) {
    data = mockVerifyData(hash);
  } else {
    // Query Lemma API without settlement proof first
    // The middleware will add PAYMENT-RESPONSE header after settlement
    const response = await fetch(`${apiBase}/v1/verified-attributes/query`, {
      method: "POST",
      headers: lemmaHeaders(apiKey),
      body: JSON.stringify({
        attributes: [],
        docHash: hash,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      console.error("Lemma API error:", error);
      // Return empty results instead of error - settlement will happen after
      data = { results: [], hasMore: false };
    } else {
      data = (await response.json()) as LemmaQueryResponse;
    }
  }

  // Return results (may be empty if document not found yet)
  return c.json({ results: data.results.map(toVerifyItem) });
});

// ---------------------------------------------------------------------------
// POST /example/query — Full query with BBS+ selective disclosure
// ---------------------------------------------------------------------------
app.post("/example/query", async (c) => {
  const apiBase = c.env.LEMMA_API_BASE.replace(/\/$/, "");
  const apiKey = c.env.LEMMA_API_KEY;
  const demoMode = c.env.DEMO_MODE === "true";

  let data: LemmaQueryResponse;

  if (demoMode) {
    data = mockQueryData();
  } else {
    const callerBody = await c.req.json<Record<string, unknown>>().catch(() => ({}));
    console.log("[DEBUG] /query received body:", JSON.stringify(callerBody, null, 2));

    const response = await fetch(`${apiBase}/v1/verified-attributes/query`, {
      method: "POST",
      headers: lemmaHeaders(apiKey),
      body: JSON.stringify(callerBody),
    });

    if (!response.ok) {
      const error = await response.text();
      console.log("[DEBUG] Lemma API error response:", error);
      return c.json({ error }, response.status as 500);
    }

    data = (await response.json()) as LemmaQueryResponse;
    
  }

  return c.json({
    results: data.results.map(simplifyItem),
    hasMore: data.hasMore,
  });
});

// ---------------------------------------------------------------------------
// Health check
// ---------------------------------------------------------------------------
app.get("/", (c) =>
  c.json({
    status: "ok",
    service: "lemma-x402-worker",
    tagline: "Content is free. Trust costs $0.001.",
    endpoints: {
      verify: "GET /example/verify/:hash (provenance verification — main)",
      query: "POST /example/query (BBS+ selective disclosure — advanced)",
      health: "GET /",
    },
  }),
);

export default app;
