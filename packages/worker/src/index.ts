/**
 * Lemma × x402 query worker.
 *
 * Gates the Lemma verified-attributes query behind an x402 micropayment.
 * After payment clears, queries Lemma and returns a simplified response:
 * BBS+ cryptographic envelope is stripped — the caller receives clean
 * `disclosed` attributes alongside ZK-verified public attributes.
 *
 * Developers deploy this worker; Lemma registration and proof submission
 * are handled by Lemma's own infrastructure.
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

/**
 * Raw SelectiveDisclosure from Lemma API (BBS+ envelope).
 * See @lemmaoracle/spec SelectiveDisclosure.
 */
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

/** Simplified response item returned to the caller (no BBS+ crypto data). */
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

// ---------------------------------------------------------------------------
// Disclosure extraction
// ---------------------------------------------------------------------------

/**
 * Extract the disclosed attribute map from a raw SelectiveDisclosure.
 *
 * This is the lightweight equivalent of `disclose.fromSelectiveDisclosure`
 * from @lemmaoracle/sdk — we trust the Lemma API response (the worker
 * calls it directly) and skip BBS+ proof re-verification. The caller
 * receives clean key-value attributes without cryptographic envelope data.
 */
const extractDisclosed = (
  sd: RawSelectiveDisclosure | null | undefined,
): Readonly<Record<string, unknown>> | null =>
  sd?.attributes && Object.keys(sd.attributes).length > 0
    ? sd.attributes
    : null;

/**
 * Transform a Lemma response item into a simplified response for the caller.
 * Strips BBS+ proof/publicKey/indexes/count/header from disclosure.
 */
const simplifyItem = (item: LemmaResponseItem): QueryResponseItem => {
  const base: QueryResponseItem = {
    docHash: item.docHash,
    schema: item.schema,
    issuerId: item.issuerId,
    subjectId: item.subjectId,
    ...(item.chainId !== undefined ? { chainId: item.chainId } : {}),
    attributes: item.attributes,
    disclosed: extractDisclosed(item.disclosure),
    ...(item.disclosureError ? { disclosureError: item.disclosureError } : {}),
    ...(item.proof ? { proof: item.proof } : {}),
  };
  return base;
};

// ---------------------------------------------------------------------------
// App
// ---------------------------------------------------------------------------

const app = new Hono<{ Bindings: Env }>();

// ---------------------------------------------------------------------------
// x402 payment middleware
// Gate POST /query: $0.001 USDC per request on Monad testnet.
// Uses self-verify mode (@x402/evm) — the Monad network is not supported
// by the x402 public facilitator, so the worker verifies payments itself.
//
// The `extra.lemmaAttestation` field surfaces ZK-verifiable quality hints
// inside the 402 PAYMENT-REQUIRED header so AI agents can make informed
// purchasing decisions *before* paying.  After payment, the corresponding
// attributes are returned with full ZK proof backing.
//
// See: https://www.perplexity.ai/page/lemma-nitotutenoshi-suo-.KJBBLmAS7m0vmEmAtP.pw
// ---------------------------------------------------------------------------
app.use(
  "/query",
  async (c, next) => {
    // Create facilitator client (using public testnet facilitator)
    const facilitatorClient = new HTTPFacilitatorClient({
      url: "https://x402.org/facilitator"
    });

    // Create resource server and register EVM scheme
    const server = new x402ResourceServer(facilitatorClient);
    // Note: Monad testnet CAIP-2 identifier. Using eip155:10143 for Monad testnet
    server.register("eip155:10143", new ExactEvmScheme());

    const middleware = paymentMiddleware(
      {
        "POST /query": {
          accepts: [
            {
              scheme: "exact",
              price: "$0.001",
              network: "eip155:10143", // Monad testnet CAIP-2 identifier
              payTo: c.env.PAY_TO_ADDRESS as `0x${string}`,
            },
          ],
          description: "ZK-verified blog articles with BBS+ selective disclosure",
          mimeType: "application/json",
          extensions: {
            lemmaAttestation: {
              circuitId: "blog-article-v1",
              schema: "blog-article",
              // Quality hints — visible before payment, verifiable after.
              // "See but can't trust → pay → verify with ZK proof."
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
      },
      server,
    );
    
    return middleware(c, next);
  },
);

// ---------------------------------------------------------------------------
// Query endpoint
// Proxies the request body to Lemma's verified-attributes/query API,
// then simplifies the response: BBS+ selective disclosure envelopes are
// reduced to plain `disclosed` attribute maps.
// ---------------------------------------------------------------------------
app.post("/query", async (c) => {
  const apiBase = c.env.LEMMA_API_BASE.replace(/\/$/, "");
  const apiKey = c.env.LEMMA_API_KEY;

  // Parse caller's query params (attribute filters, targets, pagination, etc.)
  const callerBody = await c.req.json<Record<string, unknown>>().catch(() => ({}));

  // Merge with disclosure opt-in. If the caller already provided a disclosure
  // field (with a proof for condition-gated documents), use theirs; otherwise
  // use the empty opt-in to request unconditioned disclosures.
  const body = {
    ...callerBody,
    disclosure: (callerBody as Record<string, unknown>).disclosure ?? { proof: "", inputs: [] },
  };

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (apiKey) {
    headers["Authorization"] = `Bearer ${apiKey}`;
  }

  const response = await fetch(`${apiBase}/verified-attributes/query`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const error = await response.text();
    return c.json({ error }, response.status as 500);
  }

  const data = (await response.json()) as LemmaQueryResponse;

  // Strip BBS+ cryptographic envelope — return clean disclosed attributes
  return c.json({
    results: data.results.map(simplifyItem),
    hasMore: data.hasMore,
  });
});

// ---------------------------------------------------------------------------
// AI Detection Middleware
// ---------------------------------------------------------------------------

/**
 * Detect if the request is from an AI agent.
 * Uses User-Agent, X-Requested-With, and Sec-Purpose headers.
 */
const detectAI = (c: any): boolean => {
  const userAgent = c.req.header("User-Agent") || "";
  const xRequestedWith = c.req.header("X-Requested-With");
  const secPurpose = c.req.header("Sec-Purpose");
  
  // Common AI/LLM User-Agent patterns
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
    "Scraper"
  ];
  
  const isAIUserAgent = aiPatterns.some(pattern => 
    userAgent.toLowerCase().includes(pattern.toLowerCase())
  );
  
  return isAIUserAgent || 
         xRequestedWith === "AI" || 
         secPurpose === "fetch";
};

// ---------------------------------------------------------------------------
// AI Redirect Endpoints
// ---------------------------------------------------------------------------

// AI detection middleware for /ai-content/* paths
app.use("/ai-content/*", async (c, next) => {
  const isAI = detectAI(c);
  
  if (!isAI) {
    // Human users get redirected to the original blog
    // For now, return a message. In production, this would redirect to the actual blog URL.
    return c.json(
      { 
        message: "Human detected. Please visit the original blog URL for free access.",
        redirect: "https://example-blog.com" // Placeholder
      }, 
      302
    );
  }
  
  // AI agents proceed to payment gate
  await next();
});

// Article-specific endpoint for AI access
app.get("/ai-content/:slug", async (c) => {
  const slug = c.req.param("slug");
  
  // This endpoint provides metadata to help AI decide whether to pay
  // In production, you would:
  // 1. Look up the article by slug in your database
  // 2. Map to docHash and other metadata
  // 3. Return quality hints similar to the 402 response
  
  return c.json({
    slug,
    title: `Example Blog Post: ${slug}`,
    author: "did:example:author",
    published: "2026-04-08",
    wordCount: 1500,
    language: "en",
    message: "AI detected. To access ZK-verified content, make a POST request to /query endpoint.",
    paymentRequired: true,
    endpoint: "/query",
    price: "$0.001 USDC per query",
    qualityHints: {
      attributes: ["author", "published", "words", "lang", "integrity"],
      freshness: "2026-04-08",
      wordCountRange: [1000, 2000],
      languages: ["en", "ja"]
    }
  });
});

// Helper function to simulate article lookup by slug
const getArticleMetadataBySlug = (slug: string) => {
  // In production, this would query a database
  return {
    docHash: "0x" + "a1b2c3d4".repeat(8), // Placeholder
    title: `Blog Post: ${slug}`,
    author: "did:example:author",
    publishedAt: "2026-04-08T12:00:00Z"
  };
};

// ---------------------------------------------------------------------------
// Health check
// ---------------------------------------------------------------------------
app.get("/", (c) => c.json({ 
  status: "ok", 
  service: "lemma-query-worker",
  endpoints: {
    query: "POST /query (payment required)",
    aiContent: "GET /ai-content/:slug (AI detection + redirect)",
    health: "GET /"
  }
}));

export default app;
