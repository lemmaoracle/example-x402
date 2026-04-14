/**
 * Lemma × x402 provenance verification worker.
 *
 * Reference implementation of the x402 protocol flow for resource servers.
 * This worker demonstrates the explicit verify → work → settle pattern
 * that any x402-enabled server must implement.
 *
 * Flow:
 *   1. Client sends request with PAYMENT-SIGNATURE header (Base64 PaymentPayload)
 *   2. Worker calls facilitator POST /verify — lightweight pre-check
 *   3. Worker generates the resource (calls Lemma API)
 *   4. Worker calls facilitator POST /settle — broadcasts tx, returns proof
 *   5. The proof from /settle is used as disclosure in the Lemma query
 *   6. Worker returns 200 + PAYMENT-RESPONSE header with settlement details
 *
 * Endpoints:
 *   GET  /verify/:hash  — Provenance verification ($0.001 USDC)
 *   POST /query         — Full BBS+ selective disclosure ($0.001 USDC)
 *   GET  /              — Health check
 *
 * Content is free. Trust costs $0.001.
 */

import { Hono } from "hono";

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

/** Payment requirements for x402 v2 (inside accepts array). */
type PaymentAcceptV2 = {
  scheme: string;
  network: string;
  amount: string;
  asset: string;
  payTo: string;
  maxTimeoutSeconds: number;
  extra?: Record<string, unknown>;
};

/** Resource info for x402 v2 PaymentRequired. */
type ResourceInfo = {
  url: string;
  description: string;
  mimeType: string;
};

/** Full 402 response for x402 v2. */
type PaymentRequiredV2 = {
  x402Version: 2;
  error?: string;
  resource: ResourceInfo;
  accepts: PaymentAcceptV2[];
  extensions?: Record<string, unknown>;
};

/** Facilitator /verify response. */
type VerifyResponse = {
  isValid: boolean;
  invalidReason: string | null;
};

/** Facilitator /settle response. */
type SettleResponse = {
  success: boolean;
  txHash: string;
  proof: string;
  inputs?: unknown[];
  [key: string]: unknown;
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
  disclosed: Readonly<Record<string, unknown>> | null;
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

/** USDC contract address on Monad Testnet (chain ID 10143). */
const USDC_MONAD_TESTNET = "0x534b2f3A21130d7a60830c2Df862319e593943A3";

/** Default timeout for payment (60 seconds). */
const DEFAULT_TIMEOUT_SECONDS = 60;

// ---------------------------------------------------------------------------
// Payment requirements for each endpoint (x402 v2 format)
// ---------------------------------------------------------------------------

const verifyPaymentRequired = (
  payTo: string,
  requestUrl: string,
): PaymentRequiredV2 => ({
  x402Version: 2,
  resource: {
    url: requestUrl,
    description: "Verified provenance attributes for a Lemma-attested document",
    mimeType: "application/json",
  },
  accepts: [
    {
      scheme: "exact",
      network: "eip155:10143",
      amount: "1000", // $0.001 USDC (6 decimals)
      asset: USDC_MONAD_TESTNET,
      payTo,
      maxTimeoutSeconds: DEFAULT_TIMEOUT_SECONDS,
      extra: {
        name: "USD Coin",
        version: "2",
      },
    },
  ],
  extensions: {
    lemmaAttestation: {
      schema: "blog-article",
      verifiable: ["author", "published", "integrity", "words", "lang"],
    },
  },
});

const queryPaymentRequired = (
  payTo: string,
  requestUrl: string,
): PaymentRequiredV2 => ({
  x402Version: 2,
  resource: {
    url: requestUrl,
    description: "ZK-verified blog articles with BBS+ selective disclosure",
    mimeType: "application/json",
  },
  accepts: [
    {
      scheme: "exact",
      network: "eip155:10143",
      amount: "1000", // $0.001 USDC (6 decimals)
      asset: USDC_MONAD_TESTNET,
      payTo,
      maxTimeoutSeconds: DEFAULT_TIMEOUT_SECONDS,
      extra: {
        name: "USD Coin",
        version: "2",
      },
    },
  ],
  extensions: {
    lemmaAttestation: {
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
});

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
// x402 facilitator interaction helpers
// ---------------------------------------------------------------------------

/**
 * Extract the payment payload from the PAYMENT-SIGNATURE header.
 * Returns the decoded payload string, or null if the header is missing.
 */
function extractPaymentPayload(
  header: string | undefined,
): string | null {
  if (!header) return null;
  try {
    return atob(header);
  } catch {
    return null;
  }
}

/** Payment payload from client (x402 v2). */
type PaymentPayloadV2 = {
  x402Version: 2;
  accepted: PaymentAcceptV2;
  payload: unknown;
  resource?: ResourceInfo;
  extensions?: Record<string, unknown>;
};

/**
 * Call the facilitator's POST /verify endpoint.
 *
 * Sends the client's payment payload along with this server's payment
 * requirements. The facilitator validates the signature, amount, and
 * balance without broadcasting any transaction.
 */
async function facilitatorVerify(
  facilitatorUrl: string,
  paymentPayloadStr: string,
  serverRequirements: PaymentRequiredV2,
  demoMode: boolean = false,
): Promise<VerifyResponse> {
  // Parse the payment payload to extract x402Version and accepted requirements
  let paymentPayload: PaymentPayloadV2;
  try {
    paymentPayload = JSON.parse(paymentPayloadStr) as PaymentPayloadV2;
  } catch {
    throw new Error("Invalid payment payload: not valid JSON");
  }

  // Demo mode: skip blockchain verification, always return valid
  if (demoMode) {
    return {
      isValid: true,
      invalidReason: null,
    };
  }

  // Use the client's accepted requirements for verification
  const paymentRequirements = paymentPayload.accepted;

  const res = await fetch(`${facilitatorUrl}/verify`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      x402Version: paymentPayload.x402Version,
      paymentPayload,
      paymentRequirements,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Facilitator /verify failed (${res.status}): ${text}`);
  }

  return res.json() as Promise<VerifyResponse>;
}

/**
 * Call the facilitator's POST /settle endpoint.
 *
 * Submits the payment transaction to the blockchain. This call blocks
 * while the facilitator waits for on-chain confirmation (typically
 * seconds to tens of seconds).
 *
 * Returns the settlement result including txHash and ZK proof.
 */
async function facilitatorSettle(
  facilitatorUrl: string,
  paymentPayloadStr: string,
  serverRequirements: PaymentRequiredV2,
  demoMode: boolean = false,
): Promise<SettleResponse> {
  // Parse the payment payload to extract x402Version and accepted requirements
  let paymentPayload: PaymentPayloadV2;
  try {
    paymentPayload = JSON.parse(paymentPayloadStr) as PaymentPayloadV2;
  } catch {
    throw new Error("Invalid payment payload: not valid JSON");
  }

  // Demo mode: return mock settlement with fake txHash and proof
  if (demoMode) {
    return {
      success: true,
      txHash: "0x" + "d".repeat(64), // Mock tx hash
      proof: "demo-proof-base64",
    };
  }

  // Use the client's accepted requirements for settlement
  const paymentRequirements = paymentPayload.accepted;

  const res = await fetch(`${facilitatorUrl}/settle`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      x402Version: paymentPayload.x402Version,
      paymentPayload,
      paymentRequirements,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Facilitator /settle failed (${res.status}): ${text}`);
  }

  return res.json() as Promise<SettleResponse>;
}

/**
 * Build the Base64-encoded PAYMENT-RESPONSE header value from settle result.
 */
function buildPaymentResponseHeader(settleResult: SettleResponse): string {
  return btoa(JSON.stringify(settleResult));
}

// ---------------------------------------------------------------------------
// App
// ---------------------------------------------------------------------------

const app = new Hono<{ Bindings: Env }>();

// ---------------------------------------------------------------------------
// GET /verify/:hash — Provenance verification endpoint
//
// x402 flow:
//   1. No PAYMENT-SIGNATURE header → 402 with payment requirements
//   2. PAYMENT-SIGNATURE present → verify with facilitator
//   3. If valid → query Lemma for document provenance
//   4. Settle payment with facilitator → get txHash + proof
//   5. Return provenance data + PAYMENT-RESPONSE header
// ---------------------------------------------------------------------------
app.get("/verify/:hash", async (c) => {
  const facilitatorUrl = c.env.FACILITATOR_URL.replace(/\/$/, "");
  const payTo = c.env.PAY_TO_ADDRESS;
  const requestUrl = c.req.url;
  const requirements = verifyPaymentRequired(payTo, requestUrl);

  // Step 1: Check for payment — return 402 if no payment signature
  const paymentSignature = c.req.header("PAYMENT-SIGNATURE");
  const paymentPayload = extractPaymentPayload(paymentSignature);

  if (!paymentPayload) {
    return c.json(
      {
        error: "payment_required",
        message: "Content is free. Trust costs $0.001.",
        ...requirements,
      },
      402,
      {
        "PAYMENT-REQUIRED": btoa(JSON.stringify(requirements)),
      },
    );
  }

  // Step 2: Verify payment with facilitator (lightweight pre-check)
  const demoMode = c.env.DEMO_MODE === "true";
  let verification: VerifyResponse;
  try {
    verification = await facilitatorVerify(
      facilitatorUrl,
      paymentPayload,
      requirements,
      demoMode,
    );
  } catch (err) {
    return c.json(
      { error: "verification_failed", message: String(err) },
      502,
    );
  }

  if (!verification.isValid) {
    return c.json(
      {
        error: "payment_invalid",
        reason: verification.invalidReason,
        ...requirements,
      },
      402,
      {
        "PAYMENT-REQUIRED": btoa(JSON.stringify(requirements)),
      },
    );
  }

  // Step 3: Settle payment with facilitator (broadcasts tx, returns proof)
  // Settlement blocks while waiting for on-chain confirmation.
  let settlement: SettleResponse;
  try {
    settlement = await facilitatorSettle(
      facilitatorUrl,
      paymentPayload,
      requirements,
      demoMode,
    );
  } catch (err) {
    return c.json(
      { error: "settlement_failed", message: String(err) },
      502,
    );
  }

  // Step 4: Query Lemma with the settlement proof as disclosure
  // The proof from /settle is the critical link — it proves on-chain payment
  // occurred and is attached as the disclosure credential for the Lemma query.
  const hash = c.req.param("hash");
  const apiBase = c.env.LEMMA_API_BASE.replace(/\/$/, "");
  const apiKey = c.env.LEMMA_API_KEY;

  let data: LemmaQueryResponse;

  if (demoMode) {
    // Demo mode: return mock provenance data
    data = {
      results: [
        {
          docHash: hash,
          schema: "blog-article",
          issuerId: "did:example:lemma",
          subjectId: "did:example:blog-author",
          attributes: {
            title: "Zero-Knowledge Proofs: A Gentle Introduction",
            author: "Alice",
            published: "2024-03-15",
            integrity: "sha256-abc123",
            words: 1200,
            lang: "en",
          },
          proof: { circuitId: "blog-article-v1" },
        },
      ],
      hasMore: false,
    };
  } else {
    const response = await fetch(`${apiBase}/verified-attributes/query`, {
      method: "POST",
      headers: lemmaHeaders(apiKey),
      body: JSON.stringify({
        docHash: hash,
        disclosure: {
          proof: settlement.proof,
          inputs: settlement.inputs ?? [],
        },
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      return c.json({ error }, response.status as 500);
    }

    data = (await response.json()) as LemmaQueryResponse;
  }

  if (data.results.length === 0) {
    return c.json({ error: "document_not_found", docHash: hash }, 404);
  }

  // Step 5: Return provenance data with PAYMENT-RESPONSE header
  return c.json(
    { results: data.results.map(toVerifyItem) },
    200,
    { "PAYMENT-RESPONSE": buildPaymentResponseHeader(settlement) },
  );
});

// ---------------------------------------------------------------------------
// POST /query — Full query with BBS+ selective disclosure
//
// Same x402 flow as /verify, but accepts a richer query body and returns
// disclosed content (title, body) alongside verified attributes.
// ---------------------------------------------------------------------------
app.post("/query", async (c) => {
  const facilitatorUrl = c.env.FACILITATOR_URL.replace(/\/$/, "");
  const payTo = c.env.PAY_TO_ADDRESS;
  const requestUrl = c.req.url;
  const requirements = queryPaymentRequired(payTo, requestUrl);

  // Step 1: Check for payment
  const paymentSignature = c.req.header("PAYMENT-SIGNATURE");
  const paymentPayload = extractPaymentPayload(paymentSignature);

  if (!paymentPayload) {
    return c.json(
      {
        error: "payment_required",
        message: "Content is free. Trust costs $0.001.",
        ...requirements,
      },
      402,
      {
        "PAYMENT-REQUIRED": btoa(JSON.stringify(requirements)),
      },
    );
  }

  // Step 2: Verify payment with facilitator
  const demoMode = c.env.DEMO_MODE === "true";
  let verification: VerifyResponse;
  try {
    verification = await facilitatorVerify(
      facilitatorUrl,
      paymentPayload,
      requirements,
      demoMode,
    );
  } catch (err) {
    return c.json(
      { error: "verification_failed", message: String(err) },
      502,
    );
  }

  if (!verification.isValid) {
    return c.json(
      {
        error: "payment_invalid",
        reason: verification.invalidReason,
        ...requirements,
      },
      402,
      {
        "PAYMENT-REQUIRED": btoa(JSON.stringify(requirements)),
      },
    );
  }

  // Step 3: Settle payment with facilitator
  let settlement: SettleResponse;
  try {
    settlement = await facilitatorSettle(
      facilitatorUrl,
      paymentPayload,
      requirements,
      demoMode,
    );
  } catch (err) {
    return c.json(
      { error: "settlement_failed", message: String(err) },
      502,
    );
  }

  // Step 4: Query Lemma with settlement proof as disclosure
  const apiBase = c.env.LEMMA_API_BASE.replace(/\/$/, "");
  const apiKey = c.env.LEMMA_API_KEY;

  const callerBody = await c.req
    .json<Record<string, unknown>>()
    .catch(() => ({}));

  let data: LemmaQueryResponse;

  if (demoMode) {
    // Demo mode: return mock query results with selective disclosure
    data = {
      results: [
        {
          docHash: "0xa1b2c3d4a1b2c3d4a1b2c3d4a1b2c3d4a1b2c3d4a1b2c3d4a1b2c3d4a1b2c3d4",
          schema: "blog-article",
          issuerId: "did:example:lemma",
          subjectId: "did:example:blog-author",
          attributes: {
            title: "Zero-Knowledge Proofs: A Gentle Introduction",
            author: "Alice",
            published: "2024-03-15",
            integrity: "sha256-abc123",
            words: 1200,
            lang: "en",
          },
          disclosure: {
            format: "BBS+",
            attributes: { author: "Alice", published: "2024-03-15" },
            proof: "mock-bbs-proof",
            publicKey: "mock-public-key",
            indexes: [1, 2],
            count: 6,
            header: "mock-header",
          },
        },
      ],
      hasMore: false,
    };
  } else {
    // Merge the caller's query params with the settlement proof disclosure.
    // The proof from /settle replaces any client-provided disclosure.
    const body = {
      ...callerBody,
      disclosure: {
        proof: settlement.proof,
        inputs: settlement.inputs ?? [],
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

    data = (await response.json()) as LemmaQueryResponse;
  }

  // Step 5: Return query results with PAYMENT-RESPONSE header
  return c.json(
    {
      results: data.results.map(simplifyItem),
      hasMore: data.hasMore,
    },
    200,
    { "PAYMENT-RESPONSE": buildPaymentResponseHeader(settlement) },
  );
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
      health: "GET /",
    },
  }),
);

export default app;
