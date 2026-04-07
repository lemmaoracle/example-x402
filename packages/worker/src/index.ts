/**
 * Lemma × x402 query worker.
 *
 * Gates the Lemma verified-attributes query behind an x402 micropayment.
 * Developers deploy this worker; Lemma registration and proof submission
 * are handled by Lemma's own infrastructure.
 */

import { Hono } from "hono";
import { paymentMiddleware, Network } from "x402-hono";

type Env = {
  readonly PAY_TO_ADDRESS: string;
  readonly LEMMA_API_BASE: string;
  readonly LEMMA_API_KEY?: string;
};

const app = new Hono<{ Bindings: Env }>();

// ---------------------------------------------------------------------------
// x402 payment middleware
// Gate POST /query: $0.001 USDC per request on Monad testnet.
// Uses self-verify mode (@x402/evm) — the Monad network is not supported
// by the x402 public facilitator, so the worker verifies payments itself.
// ---------------------------------------------------------------------------
app.use(
  "/query",
  async (c, next) => {
    const middleware = paymentMiddleware(
      c.env.PAY_TO_ADDRESS as `0x${string}`,
      {
        "POST /query": {
          price: "$0.001",
          network: "monad-testnet" as Network,
        },
      },
      {
        // Self-verify mode: worker verifies the payment on-chain directly.
        // Required for networks not supported by the public x402 facilitator.
        url: "https://testnet-rpc.monad.xyz",
      },
    );
    return middleware(c, next);
  },
);

// ---------------------------------------------------------------------------
// Query endpoint
// Proxies the request body to Lemma's verified-attributes/query API.
// Automatically opts-in to disclosure access via the disclosure field.
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
    disclosure: callerBody.disclosure ?? { proof: "", inputs: [] },
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

  const data = await response.json();
  return c.json(data, response.status as 200);
});

// Health check
app.get("/", (c) => c.json({ status: "ok", service: "lemma-query-worker" }));

export default app;
