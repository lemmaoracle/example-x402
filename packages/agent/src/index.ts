/**
 * Lemma × x402 agent demo — 4-phase provenance verification.
 *
 * Demonstrates the "Content is free. Trust costs $0.001." flow:
 *
 *   Phase 1: Fetch blog article freely → content acquired
 *   Phase 2: Discover attestation URL (X-Lemma-Attestation header / <link> tag)
 *   Phase 3: Pay $0.001 via x402 → receive verified attributes + proof
 *   Phase 4: Compare content hash with integrity attribute → trust confirmed
 *
 * Usage:
 *   AGENT_PRIVATE_KEY=0x... WORKER_URL=https://... BLOG_URL=https://... tsx src/index.ts
 *
 * Flags:
 *   --with-disclosure   Also query POST /query for BBS+ selective disclosure (advanced)
 */

import { createHash } from "crypto";
import { wrapFetchWithPayment } from "@x402/fetch";
import { x402Client } from "@x402/core/client";
import { ExactEvmScheme } from "@x402/evm/exact/client";
import { privateKeyToAccount } from "viem/accounts";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------
const WORKER_URL = process.env.WORKER_URL;
let AGENT_PRIVATE_KEY = process.env.AGENT_PRIVATE_KEY as
  | `0x${string}`
  | undefined;
const BLOG_URL =
  process.env.BLOG_URL || "https://example-blog.com/articles/zk-proofs";
const WITH_DISCLOSURE = process.argv.includes("--with-disclosure");

if (!WORKER_URL) {
  console.error("Error: WORKER_URL environment variable is required.");
  console.error("Set it to your deployed worker URL, e.g.:");
  console.error(
    "  WORKER_URL=https://lemma-query.your-subdomain.workers.dev pnpm agent",
  );
  process.exit(1);
}

// Generate a random key if not provided (demo mode)
// In demo mode, the worker skips blockchain verification
if (!AGENT_PRIVATE_KEY) {
  console.warn("Warning: AGENT_PRIVATE_KEY not set. Using demo mode with random key.");
  console.warn("For real transactions, set AGENT_PRIVATE_KEY to a wallet with Base Sepolia USDC.\n");
  // Generate 32 random bytes as hex
  const randomBytes = new Uint8Array(32);
  crypto.getRandomValues(randomBytes);
  AGENT_PRIVATE_KEY = `0x${Array.from(randomBytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")}` as `0x${string}`;
}

// ---------------------------------------------------------------------------
// Setup x402 auto-payment fetch
// ---------------------------------------------------------------------------
const account = privateKeyToAccount(AGENT_PRIVATE_KEY);
console.log(`Agent wallet: ${account.address}\n`);

const client = new x402Client();
const signer = {
  address: account.address,
  signTypedData: account.signTypedData.bind(account),
};
client.register("eip155:84532", new ExactEvmScheme(signer));

const x402Fetch = wrapFetchWithPayment(fetch, client);

// ---------------------------------------------------------------------------
// Utility: compute SHA-256 of content
// ---------------------------------------------------------------------------
const sha256 = (content: string): string =>
  createHash("sha256").update(content).digest("hex");

// ---------------------------------------------------------------------------
// Phase 1: Fetch blog content freely
// ---------------------------------------------------------------------------
const phase1_fetchContent = async (): Promise<{
  content: string;
  attestationUrl: string | null;
  schema: string | null;
}> => {
  console.log("=== Phase 1: Fetch blog content (free) ===");
  console.log(`  Fetching ${BLOG_URL} ...`);

  let content: string;
  let attestationUrl: string | null = null;
  let schema: string | null = null;

  try {
    const response = await fetch(BLOG_URL);

    // Discovery path A: check X-Lemma-Attestation header
    attestationUrl = response.headers.get("X-Lemma-Attestation");
    schema = response.headers.get("X-Lemma-Schema");

    content = await response.text();

    // Discovery path B: parse <link rel="lemma-attestation"> from HTML
    if (!attestationUrl) {
      const linkMatch = content.match(
        /<link[^>]+rel=["']lemma-attestation["'][^>]+href=["']([^"']+)["']/,
      );
      if (linkMatch) {
        attestationUrl = linkMatch[1];
      }
      const schemaMatch = content.match(
        /<link[^>]+rel=["']lemma-attestation["'][^>]+data-schema=["']([^"']+)["']/,
      );
      if (schemaMatch) {
        schema = schemaMatch[1];
      }
    }

    console.log(`  Content fetched (${content.length} bytes)`);
  } catch {
    // If the blog URL is unreachable (demo mode), use placeholder content
    console.log(
      "  Blog URL unreachable — using demo content for illustration",
    );
    content =
      "Zero-knowledge proofs allow one party to prove a statement is true " +
      "without revealing any information beyond the validity of the " +
      "statement itself.";
    attestationUrl = null;
  }

  return { content, attestationUrl, schema };
};

// ---------------------------------------------------------------------------
// Phase 2: Display as unverified
// ---------------------------------------------------------------------------
const phase2_displayUnverified = (
  content: string,
  attestationUrl: string | null,
  schema: string | null,
): void => {
  console.log("\n=== Phase 2: Display as UNVERIFIED ===");
  console.log(
    `  Content preview: "${content.slice(0, 120)}${content.length > 120 ? "..." : ""}"`,
  );
  console.log("  Status: UNVERIFIED");
  console.log(
    `  Attestation URL: ${attestationUrl || "(not discovered — using demo mode)"}`,
  );
  if (schema) {
    console.log(`  Schema: ${schema}`);
  }
};

// ---------------------------------------------------------------------------
// Phase 3: Pay for provenance verification
// ---------------------------------------------------------------------------
const phase3_verify = async (
  attestationUrl: string,
): Promise<{
  attributes: Record<string, unknown>;
  proof: { status: string; circuitId?: string };
  docHash: string;
} | null> => {
  console.log("\n=== Phase 3: Pay $0.001 for provenance verification ===");
  console.log(`  Calling ${attestationUrl} with x402 auto-payment ...`);

  const response = await x402Fetch(attestationUrl, { method: "GET" });

  if (!response.ok) {
    const error = await response.text();
    console.error(
      `  Verification failed (${String(response.status)}):`,
      error,
    );
    return null;
  }

  const data = (await response.json()) as {
    results: Array<{
      docHash: string;
      schema: string;
      attributes: Record<string, unknown>;
      proof: { status: string; circuitId?: string };
    }>;
  };

  if (!data.results || data.results.length === 0) {
    console.error("  No verification data returned");
    return null;
  }

  const result = data.results[0];
  console.log("  Payment accepted. Verified attributes received.");

  return {
    attributes: result.attributes,
    proof: result.proof,
    docHash: result.docHash,
  };
};

// ---------------------------------------------------------------------------
// Phase 4: Verify integrity and display as verified
// ---------------------------------------------------------------------------
const phase4_confirmTrust = (
  content: string,
  attributes: Record<string, unknown>,
  proof: { status: string; circuitId?: string },
  docHash: string,
): void => {
  console.log("\n=== Phase 4: Confirm trust ===");

  // Compare content hash with integrity attribute
  const contentHash = sha256(content);
  const integrity = attributes.integrity as string;
  const integrityMatch =
    integrity &&
    (contentHash === integrity ||
      contentHash === integrity.replace(/^0x/, ""));

  console.log(`  Content SHA-256:  ${contentHash}`);
  console.log(`  Lemma integrity:  ${integrity || "(not available)"}`);
  console.log(
    `  Integrity match:  ${integrityMatch ? "YES" : "NO (content may have been modified, or demo mode)"}`,
  );
  console.log(`  Proof status:     ${proof.status}`);
  if (proof.circuitId) {
    console.log(`  Circuit ID:       ${proof.circuitId}`);
  }

  console.log("\n-- Verified Attributes --");
  for (const [key, value] of Object.entries(attributes)) {
    console.log(`  ${key}: ${String(value)}`);
  }

  const isFullyVerified = proof.status === "verified" && integrityMatch;

  console.log(
    `\n  Status: ${isFullyVerified ? "VERIFIED" : proof.status === "verified" ? "PROOF VERIFIED (integrity mismatch)" : "PROOF PENDING"}`,
  );
  if (isFullyVerified) {
    console.log(
      "  Content is authentic — author, date, and integrity all confirmed.",
    );
  }
};

// ---------------------------------------------------------------------------
// Advanced: BBS+ selective disclosure via /query
// ---------------------------------------------------------------------------
const advancedDisclosure = async (): Promise<void> => {
  console.log("\n=== Advanced: BBS+ Selective Disclosure (/query) ===");
  console.log(`  Querying ${WORKER_URL}/query with x402 auto-payment ...`);

  const response = await x402Fetch(`${WORKER_URL}/query`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      targets: { schemas: ["blog-article"] },
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    console.error(
      `  Query failed (${String(response.status)}):`,
      error,
    );
    return;
  }

  const result = (await response.json()) as {
    results: Array<{
      docHash: string;
      schema: string;
      attributes: Record<string, unknown>;
      disclosed: Record<string, unknown> | null;
      proof?: Record<string, unknown>;
    }>;
    hasMore: boolean;
  };

  console.log(
    `  ${String(result.results.length)} result(s) with disclosure.\n`,
  );

  result.results.forEach((item, i) => {
    console.log(`  -- Result ${String(i + 1)} --`);
    console.log(`    docHash:    ${item.docHash}`);
    console.log(`    attributes:`, item.attributes);
    if (item.disclosed) {
      console.log(`    disclosed:`, item.disclosed);
    }
  });
};

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
const main = async (): Promise<void> => {
  // Phase 1: Fetch content freely
  const { content, attestationUrl, schema } = await phase1_fetchContent();

  // Phase 2: Display as unverified
  phase2_displayUnverified(content, attestationUrl, schema);

  // Phase 3: Pay for provenance verification
  // Use discovered attestation URL, or fall back to demo URL
  const verifyUrl =
    attestationUrl ||
    `${WORKER_URL}/verify/0xa1b2c3d4a1b2c3d4a1b2c3d4a1b2c3d4a1b2c3d4a1b2c3d4a1b2c3d4a1b2c3d4`;

  const verifyResult = await phase3_verify(verifyUrl);

  if (verifyResult) {
    // Phase 4: Confirm trust
    phase4_confirmTrust(
      content,
      verifyResult.attributes,
      verifyResult.proof,
      verifyResult.docHash,
    );
  }

  // Advanced: BBS+ selective disclosure (optional)
  if (WITH_DISCLOSURE) {
    await advancedDisclosure();
  }
};

main().catch((err: unknown) => {
  console.error("Unexpected error:", err);
  process.exit(1);
});
