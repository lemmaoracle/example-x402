/**
 * Lemma × x402 agent demo.
 *
 * Queries the deployed worker, auto-pays via x402, and prints ZK-verified attributes.
 *
 * Usage:
 *   AGENT_PRIVATE_KEY=0x... WORKER_URL=https://... tsx src/index.ts
 */

import { wrapFetchWithPayment } from "@x402/fetch";
import { x402Client } from "@x402/core/client";
import { ExactEvmScheme } from "@x402/evm/exact/client";
import { privateKeyToAccount } from "viem/accounts";
import { monadTestnet } from "viem/chains";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------
const WORKER_URL = process.env.WORKER_URL;
const AGENT_PRIVATE_KEY = process.env.AGENT_PRIVATE_KEY as `0x${string}` | undefined;

if (!WORKER_URL) {
  console.error("Error: WORKER_URL environment variable is required.");
  console.error("Set it to your deployed worker URL, e.g.:");
  console.error("  WORKER_URL=https://lemma-query.your-subdomain.workers.dev pnpm agent");
  process.exit(1);
}

if (!AGENT_PRIVATE_KEY) {
  console.error("Error: AGENT_PRIVATE_KEY environment variable is required.");
  console.error("Set it to a 0x-prefixed private key with Monad testnet USDC.");
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Setup x402 auto-payment fetch (v2)
// ---------------------------------------------------------------------------
const account = privateKeyToAccount(AGENT_PRIVATE_KEY);
console.log(`Agent wallet: ${account.address}`);

// Create x402 client with EVM exact scheme
const client = new x402Client();
// Create a signer for the EVM scheme
const signer = {
  address: account.address,
  signTypedData: account.signTypedData.bind(account),
};
client.register("eip155:10143", new ExactEvmScheme(signer));

// Wrap fetch with auto-payment
const x402Fetch = wrapFetchWithPayment(fetch, client);

// ---------------------------------------------------------------------------
// Query the worker
// ---------------------------------------------------------------------------
const query = async (): Promise<void> => {
  console.log(`\nQuerying ${WORKER_URL}/query ...`);

  const response = await x402Fetch(`${WORKER_URL}/query`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      // Filter for documents with a specific verified attribute.
      // Adjust to match the attributes in your registered documents.
      attributes: [{ name: "verified", value: true }],
      // Optional: filter by schema or chain
      // targets: { schemas: ["your-schema-id"] },
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    console.error(`Query failed (${String(response.status)}):`, error);
    return;
  }

  const result = await response.json() as {
    results: ReadonlyArray<{
      docHash: string;
      schema: string;
      issuerId: string;
      subjectId: string;
      attributes: Record<string, unknown>;
      disclosure?: {
        format: string;
        attributes: Record<string, unknown>;
      } | null;
      disclosureError?: string;
    }>;
    hasMore: boolean;
  };

  console.log(`\n✓ Payment accepted. ${String(result.results.length)} result(s) returned.\n`);

  result.results.forEach((item, i) => {
    console.log(`── Result ${String(i + 1)} ──────────────────────────`);
    console.log(`  docHash:   ${item.docHash}`);
    console.log(`  schema:    ${item.schema}`);
    console.log(`  issuerId:  ${item.issuerId}`);
    console.log(`  subjectId: ${item.subjectId}`);
    console.log(`  attributes:`, item.attributes);
    if (item.disclosure) {
      console.log(`  disclosure:`, item.disclosure.attributes);
    } else if (item.disclosureError) {
      console.log(`  disclosureError: ${item.disclosureError}`);
    }
  });

  if (result.hasMore) {
    console.log(`\n(more results available — use offset pagination)`);
  }
};

query().catch((err: unknown) => {
  console.error("Unexpected error:", err);
  process.exit(1);
});
