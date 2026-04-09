/**
 * Lemma × x402 provenance verification worker.
 *
 * Main endpoint: GET /verify/:hash
 *   — x402 gated ($0.001 USDC). After payment, queries Lemma for
 *   verified attributes (author, published, integrity, words, lang)
 *   and proof status for the given document hash.
 *
 * Advanced: POST /query
 *   — x402 gated. Full query API with BBS+ selective disclosure.
 *   For agents that need content access (title/body) in addition
 *   to provenance verification.
 *
 * Content is free. Trust costs $0.001.
 */

import { Hono } from "hono";
import { paymentMiddleware, x402ResourceServer } from "@x402/hono";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import { HTTPFacilitatorClient } from "@x402/core/server";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Env = {
  readonly PAY_TO_ADDRESS: string;
  readonly LEMMA_API_BASE: string;
  readonly LEMMA_API_KEY?: string;
};

/** Raw SelectiveDisclosure from Lemma API (BBS+ envelope). */
type RawSelectiveDisclosure = Readonly<{
  format: string;
  attributes: Readonly<Record<string, unknown>>;
  proof: string;
  publicKey: string;
  indexes: ReadonlyArray<number>;
  count: number;
  header: string;
  condition?: Readonly<{ circuitId: string }>;
}>;

/** A single item from Lemma's verified-attributes/query response. */
type LemmaResponseItem = Readonly<{
  docHash: string;
  schema: string;
  issuerId: string;
  subjectId: string;
  chainId?: number;
  attributes: Readonly<Record<string, unknown>>;
  proof?: Readonly<Record<string, unknown>>;
  disclosure?: RawSelectiveDisclosure | null;
  disclosureError?: "condition_not_met";
}>;

type LemmaQueryResponse = Readonly<{
  results: ReadonlyArray<LemmaResponseItem>;
  hasMore: boolean;
}>;

/** Simplified response item (no BBS+ crypto data). */
type QueryResponseItem = Readonly<{
  docHash: string;
  schema: string;
  issuerId: string;
  subjectId: string;
  chainId?: number;
  attributes: Readonly<Record<string, unknown>>;
  /** Disclosed attributes extracted from BBS+ selective disclosure. */
  disclosed: Readonly<Record<string, unknown>> | null;
  /** Present when the disclosure condition was not met. */
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
// Helpers
// ---------------------------------------------------------------------------

const extractDisclosed = (
  sd: RawSelectiveDisclosure | null | undefined,
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

// ---------------------------------------------------------------------------
// App
// ---------------------------------------------------------------------------

const app = new Hono<{ Bindings: Env }>();

// ---------------------------------------------------------------------------
// x402 payment middleware — GET /verify/:hash
//
// Main endpoint. Returns ZK-verified provenance attributes for a document.
// $0.001 USDC per verification on Base Sepolia.
//
// 402 response includes lemmaAttestation hints:
//   { schema, verifiable }
// ---------------------------------------------------------------------------
app.use(
  "/verify/:hash",
  async (c, next) => {
    const facilitatorClient = new HTTPFacilitatorClient({
      url: "https://x402.org/facilitator",
    });

    const server = new x402ResourceServer(facilitatorClient);
    server.register("eip155:84532", new ExactEvmScheme());

    const middleware = paymentMiddleware(
      {
        "GET /verify/:hash": {
          accepts: [
            {
              scheme: "exact",
              price: "$0.001",
              network: "eip155:84532",
              payTo: c.env.PAY_TO_ADDRESS as `0x${string}`,
            },
          ],
          description:
            "Verified provenance attributes for a Lemma-attested document",
          mimeType: "application/json",
          extensions: {
            lemmaAttestation: {
              schema: "blog-article",
              verifiable: [
                "author",
                "published",
                "integrity",
                "words",
                "lang",
              ],
            },
          },
        },
      },
      server,
    );

    return middleware(c, next);
  },
);

// ---------------------------------------------------------------------------
// GET /verify/:hash — Provenance verification endpoint
//
// After x402 payment clears, queries Lemma for the document matching
// the given hash and returns verified attributes + proof status.
//
// The hash can be a docHash (0x-prefixed). The agent can additionally
// compare its locally computed SHA-256 of the content against the
// returned `integrity` attribute to confirm content has not been tampered.
// ---------------------------------------------------------------------------
app.get("/verify/:hash", async (c) => {
  const hash = c.req.param("hash");
  const apiBase = c.env.LEMMA_API_BASE.replace(/\/$/, "");
  const apiKey = c.env.LEMMA_API_KEY;

  const response = await fetch(`${apiBase}/verified-attributes/query`, {
    method: "POST",
    headers: lemmaHeaders(apiKey),
    body: JSON.stringify({ docHash: hash }),
  });

  if (!response.ok) {
    const error = await response.text();
    return c.json({ error }, response.status as 500);
  }

  const data = (await response.json()) as LemmaQueryResponse;

  if (data.results.length === 0) {
    return c.json({ error: "document_not_found", docHash: hash }, 404);
  }

  return c.json({
    results: data.results.map(toVerifyItem),
  });
});

// ---------------------------------------------------------------------------
// x402 payment middleware — POST /query (Advanced)
//
// Full query endpoint with BBS+ selective disclosure. For agents that
// need disclosed content (title, body) alongside verified attributes.
// ---------------------------------------------------------------------------
app.use(
  "/query",
  async (c, next) => {
    const facilitatorClient = new HTTPFacilitatorClient({
      url: "https://x402.org/facilitator",
    });

    const server = new x402ResourceServer(facilitatorClient);
    server.register("eip155:84532", new ExactEvmScheme());

    const middleware = paymentMiddleware(
      {
        "POST /query": {
          accepts: [
            {
              scheme: "exact",
              price: "$0.001",
              network: "eip155:84532",
              payTo: c.env.PAY_TO_ADDRESS as `0x${string}`,
            },
          ],
          description:
            "ZK-verified blog articles with BBS+ selective disclosure",
          mimeType: "application/json",
          extensions: {
            lemmaAttestation: {
              circuitId: "blog-article-v1",
              schema: "blog-article",
              hints: {
                attributes: [
                  "author",
                  "published",
                  "words",
                  "lang",
                  "integrity",
                ],
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
      },
      server,
    );

    return middleware(c, next);
  },
);

// ---------------------------------------------------------------------------
// POST /query — Full query with BBS+ selective disclosure (Advanced)
// ---------------------------------------------------------------------------
app.post("/query", async (c) => {
  const apiBase = c.env.LEMMA_API_BASE.replace(/\/$/, "");
  const apiKey = c.env.LEMMA_API_KEY;

  const callerBody = await c.req
    .json<Record<string, unknown>>()
    .catch(() => ({}));

  const body = {
    ...callerBody,
    disclosure:
      (callerBody as Record<string, unknown>).disclosure ?? {
        proof: "",
        inputs: [],
      },
  };

  const response = await fetch(`${apiBase}/verified-attributes/query`, {
    method: "POST",
    headers: lemmaHeaders(apiKey),
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const error = await response.text();
    return c.json({ error }, response.status as 500);
  }

  const data = (await response.json()) as LemmaQueryResponse;

  return c.json({
    results: data.results.map(simplifyItem),
    hasMore: data.hasMore,
  });
});

// ---------------------------------------------------------------------------
// AI Detection — Demo helper (not a production integration method)
//
// Retained for quick 5-minute demos. For production, use the A+B
// discovery approach: X-Lemma-Attestation header + <link> meta tag.
// See the "Discovery" section in README.md.
// ---------------------------------------------------------------------------

const detectAI = (c: any): boolean => {
  const userAgent = c.req.header("User-Agent") || "";
  const xRequestedWith = c.req.header("X-Requested-With");
  const secPurpose = c.req.header("Sec-Purpose");

  const aiPatterns = [
    "OpenAI",
    "Claude",
    "GPT",
    "ChatGPT",
    "Bard",
    "Gemini",
    "Cohere",
    "Anthropic",
    "AI",
    "LLM",
    "Language-Model",
    "Agent",
    "Crawler",
    "Bot",
    "Scraper",
  ];

  const isAIUserAgent = aiPatterns.some((pattern) =>
    userAgent.toLowerCase().includes(pattern.toLowerCase()),
  );

  return isAIUserAgent || xRequestedWith === "AI" || secPurpose === "fetch";
};

app.use("/ai-content/*", async (c, next) => {
  const isAI = detectAI(c);

  if (!isAI) {
    return c.json(
      {
        message:
          "Human detected. Please visit the original blog URL for free access.",
        redirect: "https://example-blog.com",
      },
      302,
    );
  }

  await next();
});

app.get("/ai-content/:slug", async (c) => {
  const slug = c.req.param("slug");

  return c.json({
    slug,
    title: `Example Blog Post: ${slug}`,
    author: "did:example:author",
    published: "2026-04-08",
    wordCount: 1500,
    language: "en",
    message:
      "AI detected. To verify provenance, call GET /verify/:docHash with x402 payment.",
    paymentRequired: true,
    endpoints: {
      verify: "/verify/:docHash (provenance — recommended)",
      query: "/query (full disclosure — advanced)",
    },
    price: "$0.001 USDC per request",
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
      verify: "GET /verify/:hash (provenance verification — main)",
      query: "POST /query (BBS+ selective disclosure — advanced)",
      aiContent: "GET /ai-content/:slug (demo helper)",
      health: "GET /",
    },
  }),
);

export default app;
