/**
 * Lemma x x402 provenance verification worker.
 *
 * Uses @lemmaoracle/x402 as a drop-in replacement for @x402/*.
 * Discovery metadata is auto-applied from LEMMA_DISCOVERY_CONFIG env var.
 * Proof submission is handled automatically by the augmented x402ResourceServer.
 *
 * Endpoints:
 *   GET  /example/verify/:hash  -- Provenance verification ($0.001 USDC)
 *   POST /example/query         -- Full BBS+ selective disclosure ($0.001 USDC)
 *   GET  /                      -- Health check
 *
 * Content is free. Trust costs $0.001.
 */

import { Hono } from "hono";
import {
  HTTPFacilitatorClient,
  x402ResourceServer,
  paymentMiddleware,
  ExactEvmScheme,
} from "@lemmaoracle/x402";
import { createFacilitatorConfig } from "@coinbase/x402";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Env = {
  readonly PAY_TO_ADDRESS: string;
  readonly FACILITATOR_URL: string;
  readonly LEMMA_API_BASE: string;
  readonly LEMMA_API_KEY?: string;
  readonly DEMO_MODE?: string;
  readonly LEMMA_DISCOVERY_CONFIG?: string;
  readonly CDP_API_KEY_ID?: string;
  readonly CDP_API_KEY_SECRET?: string;
};

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

type QueryResponseItem = Readonly<{
  docHash: string;
  schema: string;
  issuerId: string;
  subjectId: string;
  chainId?: number;
  attributes: Readonly<Record<string, unknown>>;
  disclosed: Readonly<Record<string, unknown>> | null;
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

const lemmaHeaders = (apiKey?: string): Record<string, string> => ({
  "Content-Type": "application/json",
  ...(apiKey ? { "X-Api-Key": apiKey } : {}),
});

// ---------------------------------------------------------------------------
// Demo mode mock data
// ---------------------------------------------------------------------------

const DEMO_CONTENT =
  "Artificial intelligence and blockchain technology are converging to create new possibilities for trust and automation. This convergence enables verifiable provenance and transparent content attribution.";
const DEMO_CONTENT_HASH =
  "c6b3380e0d8334e87c3e55d23e987dc0b7638e91950a2467b2bb496e62ac6fdd";

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
          body: DEMO_CONTENT,
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
// Routes -- standard x402 RoutesConfig.
// Discovery metadata (lemma extensions) is auto-enriched by
// @lemmaoracle/x402 paymentMiddleware from LEMMA_DISCOVERY_CONFIG env var.
// ---------------------------------------------------------------------------

const staticRoutes = {
  "GET /example/verify/:hash": {
    accepts: [
      {
        scheme: "exact" as const,
        price: "$0.001",
        network: "eip155:84532" as const,
        payTo: "", // resolved dynamically below
        extra: {
          name: "USDC",
          version: "2",
        },
      },
    ],
    description: "Verified provenance attributes for a Lemma-attested document",
    mimeType: "application/json",
  },
  "POST /example/query": {
    accepts: [
      {
        scheme: "exact" as const,
        price: "$0.001",
        network: "eip155:84532" as const,
        payTo: "", // resolved dynamically below
        extra: {
          name: "USDC",
          version: "2",
        },
      },
    ],
    description: "ZK-verified blog articles with BBS+ selective disclosure",
    mimeType: "application/json",
  },
};

// ---------------------------------------------------------------------------
// App
// ---------------------------------------------------------------------------

const app = new Hono<{ Bindings: Env }>();

/**
 * Resolve payTo dynamically from env and apply x402 payment middleware.
 *
 * - Demo mode / health check: skip entirely
 * - /query endpoint: skip (uses client-provided disclosure proof from /verify)
 * - Otherwise: standard x402 payment flow via @lemmaoracle/x402
 *
 * The augmented x402ResourceServer auto-attaches Lemma onAfterSettle hook.
 * The augmented paymentMiddleware auto-enriches routes with discovery metadata.
 */
app.use("*", async (c, next) => {
  const demoMode = c.env.DEMO_MODE === "true";

// Skip x402 for health check and demo mode only
if (c.req.path === "/" || demoMode) {
    return next();
}

  try {
    // Use @coinbase/x402 for automatic CDP facilitator authentication.
    // Reads CDP_API_KEY_ID and CDP_API_KEY_SECRET from env vars.
    const facilitatorConfig = {
      url: c.env.FACILITATOR_URL.replace(/\/$/, ""),
      ...createFacilitatorConfig(
        c.env.CDP_API_KEY_ID,
        c.env.CDP_API_KEY_SECRET,
      ),
    };

    const facilitatorClient = new HTTPFacilitatorClient(facilitatorConfig);

    const resourceServer = new x402ResourceServer(facilitatorClient)
      .register("eip155:84532", new ExactEvmScheme());

    // Inject payTo dynamically (not hardcoded in static routes)
    const payTo = c.env.PAY_TO_ADDRESS;
    const routes = {
      "GET /example/verify/:hash": {
        ...staticRoutes["GET /example/verify/:hash"],
        accepts: staticRoutes["GET /example/verify/:hash"].accepts.map(
          (accept) => ({ ...accept, payTo }),
        ),
      },
      "POST /example/query": {
        ...staticRoutes["POST /example/query"],
        accepts: staticRoutes["POST /example/query"].accepts.map(
          (accept) => ({ ...accept, payTo }),
        ),
      },
    };

    const middleware = paymentMiddleware(routes, resourceServer);
    return await middleware(c, next);
  } catch (err) {
    console.error("x402 middleware error:", err);
    return c.json({ error: "x402 middleware error", details: String(err) }, 500);
  }
});

// ---------------------------------------------------------------------------
// GET /example/verify/:hash -- Provenance verification endpoint
// ---------------------------------------------------------------------------
app.get("/example/verify/:hash", async (c) => {
  const hash = c.req.param("hash");
  const apiBase = c.env.LEMMA_API_BASE.replace(/\/$/, "");
  const apiKey = c.env.LEMMA_API_KEY;
  const demoMode = c.env.DEMO_MODE === "true";

  if (demoMode) {
    const data = mockVerifyData(hash);
    return c.json({ results: data.results.map(toVerifyItem) });
  }

  console.log("[DEBUG] /verify fetching from Lemma API:", apiBase);
  const raw = await fetch(`${apiBase}/v1/verified-attributes/query`, {
    method: "POST",
    headers: lemmaHeaders(apiKey),
    body: JSON.stringify({ attributes: [], docHash: hash }),
  });
  console.log("[DEBUG] /verify Lemma API status:", raw.status, raw.statusText);

  if (!raw.ok) {
    const errText = await raw.text();
    console.log("[DEBUG] /verify Lemma API error:", errText);
    return c.json({ results: [], hasMore: false });
  }

  const data = await raw.json() as LemmaQueryResponse;
  console.log("[DEBUG] /verify Lemma API result count:", data.results?.length ?? 0);
  return c.json({ results: data.results.map(toVerifyItem) });
});

// ---------------------------------------------------------------------------
// POST /example/query -- Full query with BBS+ selective disclosure
// ---------------------------------------------------------------------------
app.post("/example/query", async (c) => {
  const apiBase = c.env.LEMMA_API_BASE.replace(/\/$/, "");
  const apiKey = c.env.LEMMA_API_KEY;
  const demoMode = c.env.DEMO_MODE === "true";

  if (demoMode) {
    const data = mockQueryData();
    return c.json({ results: data.results.map(simplifyItem), hasMore: data.hasMore });
  }

  const callerBody = await c.req.json<Record<string, unknown>>().catch(() => ({}));
  console.log("[DEBUG] /query received body:", JSON.stringify(callerBody, null, 2));

  const response = await fetch(`${apiBase}/v1/verified-attributes/query`, {
    method: "POST",
    headers: lemmaHeaders(apiKey),
    body: JSON.stringify(callerBody),
  });

  return response.ok
    ? response.json().then((data) => {
        const typed = data as LemmaQueryResponse;
        return c.json({ results: typed.results.map(simplifyItem), hasMore: typed.hasMore });
      })
    : response.text().then((error: string) => {
        console.log("[DEBUG] Lemma API error response:", error);
        return c.json({ error }, response.status as 500);
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
      verify: "GET /example/verify/:hash (provenance verification)",
      query: "POST /example/query (BBS+ selective disclosure)",
      health: "GET /",
    },
  }),
);

export default app;
