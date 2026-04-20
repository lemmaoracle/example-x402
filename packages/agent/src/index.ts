/**
 * Lemma x x402 agent demo - 4-phase provenance verification.
 *
 * Demonstrates the "Content is free. Trust costs $0.001." flow:
 *
 *   Phase 1: Fetch blog article freely -> content acquired
 *   Phase 2: Discover attestation URL (X-Lemma-Attestation header / <link> tag)
 *   Phase 3: Pay $0.001 via x402 -> receive verified attributes + proof
 *   Phase 4: Compare content hash with integrity attribute -> trust confirmed
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
import chalk from "chalk";
import ora from "ora";
import spinners from "cli-spinners";
import { config } from "dotenv";

// Load .env from root workspace if we're running locally
// Check if running from packages/agent (dev) or root (via pnpm filter)
config({ path: process.cwd().endsWith("packages/agent") ? "../../.env" : ".env" });

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
const DEMO_MODE = process.env.DEMO_MODE === "true" || process.env.DEMO_MODE === "1";

if (!WORKER_URL) {
  console.error("Error: WORKER_URL environment variable is required.");
  console.error("Set it to your deployed worker URL, e.g.:");
  console.error(
    "  WORKER_URL=https://lemma-query.your-subdomain.workers.dev pnpm agent",
  );
  process.exit(1);
}

// Require AGENT_PRIVATE_KEY (no demo mode fallback)
if (!AGENT_PRIVATE_KEY) {
  console.error("Error: AGENT_PRIVATE_KEY environment variable is required.");
  console.error("Set it to a wallet with Base Sepolia USDC.");
  console.error("");
  console.error("Get test USDC from: https://faucet.circle.com (select Base Sepolia)");
  console.error("");
  console.error("For local testing without real payments, set DEMO_MODE=true in worker config.");
  process.exit(1);
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
const sha256 = (content: string): string => {
  // Use a strictly normalized version of the content to handle any whitespace/newline differences
  const normalized = content.replace(/\r\n/g, '\n').trim();
  return createHash("sha256").update(normalized).digest("hex");
};

// ---------------------------------------------------------------------------
// Utility: extract settlement proof from PAYMENT-RESPONSE header
// ---------------------------------------------------------------------------
type PaymentResponseExtension = {
  transaction: string;
  network: string;
  payer?: string;
  extensions?: {
    lemma?: {
      proof: string;
      inputs: string[];
      circuitId: string;
      generatedAt: number;
    };
  };
};

/**
 * Extract settlement proof from PAYMENT-RESPONSE header.
 * The header is Base64-encoded JSON set by the x402 middleware after settlement.
 */
const extractPaymentResponse = (
  headerValue: string | null,
): PaymentResponseExtension | null => {
  if (!headerValue) return null;
  try {
    return JSON.parse(atob(headerValue)) as PaymentResponseExtension;
  } catch {
    return null;
  }
};

// ---------------------------------------------------------------------------
// Utility: sleep and typewrite for CLI effects
// ---------------------------------------------------------------------------
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const typewrite = async (
  text: string,
  colorFn?: (str: string) => string,
  minDelay = 5,
  maxDelay = 20
): Promise<void> => {
  for (const char of text) {
    process.stdout.write(colorFn ? colorFn(char) : char);
    await sleep(Math.floor(Math.random() * (maxDelay - minDelay + 1)) + minDelay);
  }
};

// ---------------------------------------------------------------------------
// Phase 1: Fetch blog content freely
// ---------------------------------------------------------------------------
// Demo content (must match worker's DEMO_CONTENT)
const DEMO_CONTENT = `Artificial intelligence and blockchain technology are converging to create new possibilities for trust and automation. This convergence enables verifiable provenance and transparent content attribution.`;

const phase1_fetchContent = async (): Promise<{
  content: string;
  attestationUrl: string | null;
  schema: string | null;
}> => {
  console.log(chalk.bold.cyan("\n=== Phase 1: Fetch blog content (free) ==="));
  
  const spinner = ora({
    text: chalk.gray(`Fetching ${BLOG_URL} ...`),
    spinner: spinners.dots,
  }).start();

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

    spinner.succeed(chalk.green(`Content fetched (${content.length} bytes)`));

    // If we didn't discover an attestation URL, use fixed demo content for hash matching.
    // The fallback verification URL uses the demo content hash, so the content must match.
    if (!attestationUrl) {
      console.log(chalk.gray("  (No attestation URL found - using demo content for verification)"));
      content = DEMO_CONTENT;
    }
  } catch {
    // If the blog URL is unreachable (e.g. standalone screenshot mode), use placeholder content
    spinner.warn(
      chalk.yellow("Blog URL unreachable - using demo content for illustration"),
    );
    content = DEMO_CONTENT;
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
  console.log(chalk.bold.magenta("\n=== Phase 2: Display as UNVERIFIED ==="));
  console.log(
    chalk.gray(`  Content preview: "${content.slice(0, 120).replace(/\n/g, " ")}${content.length > 120 ? "..." : ""}"`),
  );
  console.log(`  Status: ${chalk.bgRed.white.bold(" UNVERIFIED ")}`);
  console.log(
    chalk.gray(`  Attestation URL: ${attestationUrl || "(not discovered - using demo mode)"}`),
  );
  if (schema) {
    console.log(chalk.gray(`  Schema: ${schema}`));
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
  /** Settlement proof from PAYMENT-RESPONSE header (for disclosure queries) */
  settlementProof?: { proof: string; inputs: string[]; circuitId: string };
} | null> => {
  console.log(chalk.bold.yellow("\n=== Phase 3: Pay $0.001 for provenance verification ==="));
  
  const spinner = ora({
    text: chalk.gray(`Calling ${attestationUrl} with x402 auto-payment ...`),
    spinner: spinners.dots,
  }).start();

  try {
    const response = await x402Fetch(attestationUrl, { method: "GET" });

    // Debug payload if failed
    if (!response.ok) {
      spinner.fail(chalk.red(`Verification failed (${String(response.status)})`));
      
      // Read body once, parse twice (text for logging, JSON for debug)
      const errorText = await response.text();
      let errorJson: Record<string, unknown> | null = null;
      try { errorJson = JSON.parse(errorText); } catch { /* non-JSON response */ }
      
      console.error(chalk.red(errorText));
      console.log(chalk.gray("  Response headers:"));
      response.headers.forEach((v, k) => console.log(chalk.gray(`    ${k}: ${v}`)));
      
      // Dump the client's cached payment authorization if available
      if (errorJson && Array.isArray(errorJson.accepts) && errorJson.accepts[0]) {
        const clientAuth = await (client as any).createAuthorizationHeader(
          "exact", "eip155:84532",
          errorJson.accepts[0]
        ).catch((e: unknown) => `Error creating auth: ${e}`);
        console.log(chalk.yellow(`\n  Debug - Payment Authorization that would be sent: ${clientAuth}`));
      }
      
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
      spinner.fail(chalk.red("No verification data returned"));
      return null;
    }

    const result = data.results[0];
    spinner.succeed(chalk.green("Payment accepted. Verified attributes received."));

    // Extract settlement proof from PAYMENT-RESPONSE header for disclosure queries
    const paymentResponse = extractPaymentResponse(response.headers.get("PAYMENT-RESPONSE"));
    const settlementProof = paymentResponse?.extensions?.lemma;

    return {
      attributes: result.attributes,
      proof: result.proof,
      docHash: result.docHash,
      ...(settlementProof ? { settlementProof } : {}),
    };
  } catch (err) {
    spinner.fail(chalk.red("Error during verification"));
    console.error(chalk.red(String(err)));
    return null;
  }
};

// ---------------------------------------------------------------------------
// Phase 4: Verify integrity and display as verified
// ---------------------------------------------------------------------------
const phase4_confirmTrust = async (
  content: string,
  attributes: Record<string, unknown>,
  proof: { status: string; circuitId?: string },
  docHash: string,
): Promise<void> => {
  console.log(chalk.bold.green("\n=== Phase 4: Confirm trust ==="));
  await sleep(150);

  // Compare content hash with integrity attribute
  const contentHash = sha256(content);
  const integrity = attributes.integrity as string;
  const integrityMatch =
    integrity &&
    (contentHash === integrity ||
      contentHash === integrity.replace(/^0x/, "") ||
      contentHash === integrity.replace(/^sha256-/, ""));

  process.stdout.write(`  Content SHA-256:  `);
  await typewrite(contentHash, chalk.cyan, 2, 10);
  console.log();
  await sleep(100);

  process.stdout.write(`  Lemma integrity:  `);
  await typewrite(integrity || "(not available)", chalk.cyan, 2, 10);
  console.log();
  await sleep(150);
  
  const matchColor = integrityMatch ? chalk.green : chalk.yellow;
  const matchText = integrityMatch ? "YES" : "NO (content may have been modified, or demo mode)";
  console.log(`  Integrity match:  ${matchColor(matchText)}`);
  await sleep(130);
  
  const proofColor = proof.status === "verified" ? chalk.green : chalk.yellow;
  console.log(`  Proof status:     ${proofColor(proof.status)}`);
  await sleep(100);
  
  if (proof.circuitId) {
    console.log(`  Circuit ID:       ${chalk.cyan(proof.circuitId)}`);
    await sleep(70);
  }

  console.log(chalk.bold("\n-- Verified Attributes --"));
  await sleep(130);
  for (const [key, value] of Object.entries(attributes)) {
    process.stdout.write(`  ${chalk.gray(key)}: `);
    const valueStr = String(value);
    if (valueStr.length > 40) {
      await typewrite(valueStr, chalk.white, 2, 10);
    } else {
      await typewrite(valueStr, chalk.white, 10, 30);
    }
    console.log();
    await sleep(50);
  }

  const isFullyVerified = proof.status === "verified" && integrityMatch;

  let statusTag;
  if (isFullyVerified) {
    statusTag = chalk.bgGreen.black.bold(" VERIFIED ");
  } else if (proof.status === "verified") {
    statusTag = chalk.bgYellow.black.bold(" PROOF VERIFIED (integrity mismatch) ");
  } else {
    statusTag = chalk.bgRed.white.bold(" PROOF PENDING ");
  }

  await sleep(200);
  console.log(`\n  Status: ${statusTag}`);
  
  if (isFullyVerified) {
    await sleep(100);
    console.log(
      chalk.green("  Content is authentic - author, date, and integrity all confirmed."),
    );
  }
};

// ---------------------------------------------------------------------------
// Advanced: BBS+ selective disclosure via /query
// ---------------------------------------------------------------------------
const advancedDisclosure = async (
  docHash: string,
  settlementProof?: { proof: string; inputs: string[]; circuitId: string },
): Promise<void> => {
  console.log(chalk.bold.blue("\n=== Advanced: BBS+ Selective Disclosure (/query) ==="));
  await sleep(150);
  
  const spinner = ora({
    text: chalk.gray(`Querying ${WORKER_URL}/example/query with x402 auto-payment ...`),
    spinner: spinners.dots,
  }).start();

  const response = await x402Fetch(`${WORKER_URL}/example/query`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      docHash,
      attributes: [],
      ...(settlementProof ? {
        disclosure: {
          proof: settlementProof.proof,
          inputs: settlementProof.inputs,
        },
      } : {}),
    }),
  });

  if (!response.ok) {
    spinner.fail(chalk.red(`Query failed (${String(response.status)})`));
    const error = await response.text();
    console.error(chalk.red(error));
    return;
  }

  const result = (await response.json()) as {
    results: Array<{
      docHash: string;
      schema: string;
      attributes: Record<string, unknown>;
      disclosed: Record<string, unknown> | null;
      /** Full BBS+ disclosure envelope */
      disclosure?: {
        format: string;
        attributes: Record<string, unknown>;
        proof: string;
        publicKey: string;
        indexes: number[];
        count: number;
        header: string;
        condition?: { circuitId: string };
      } | null;
      proof?: Record<string, unknown>;
    }>;
    hasMore: boolean;
  };

  spinner.succeed(chalk.green(`Query successful`));
  await sleep(100);

  console.log(
    chalk.cyan(`  ${String(result.results.length)} result(s) with disclosure.\n`),
  );
  await sleep(130);

  for (let i = 0; i < result.results.length; i++) {
    const item = result.results[i];
    console.log(chalk.bold(`  -- Result ${String(i + 1)} --`));
    await sleep(70);
    process.stdout.write(`    ${chalk.gray("docHash:")}    `);
    await typewrite(item.docHash, chalk.cyan, 2, 10);
    console.log();
    await sleep(70);
    
    console.log(`    ${chalk.gray("attributes:")}`);
    await sleep(50);
    for (const [k, v] of Object.entries(item.attributes)) {
      process.stdout.write(`      ${chalk.gray(k)}: `);
      const vStr = String(v);
      if (vStr.length > 40) {
        await typewrite(vStr, chalk.white, 2, 10);
      } else {
        await typewrite(vStr, chalk.white, 7, 20);
      }
      console.log();
      await sleep(30);
    }
    
    // Display full BBS+ disclosure envelope
    if (item.disclosure) {
      const sd = item.disclosure;
      await sleep(70);
      console.log(`    ${chalk.gray("disclosure envelope:")}`);
      await sleep(50);
      console.log(`      ${chalk.gray("format:")}     ${chalk.white(sd.format)}`);
      console.log(`      ${chalk.gray("proof:")}      ${chalk.cyan(sd.proof.slice(0, 20) + "..." + sd.proof.slice(-10))}`);
      console.log(`      ${chalk.gray("publicKey:")}  ${chalk.cyan(sd.publicKey.slice(0, 20) + "...")}`);
      console.log(`      ${chalk.gray("indexes:")}    ${chalk.white(JSON.stringify(sd.indexes))}`);
      console.log(`      ${chalk.gray("count:")}      ${chalk.white(String(sd.count))}`);
      if (sd.condition) {
        console.log(`      ${chalk.gray("condition:")}  ${chalk.yellow(sd.condition.circuitId)}`);
      }
      
      // Disclosed attributes (the actual revealed values)
      await sleep(50);
      console.log(`    ${chalk.gray("disclosed attributes:")}`);
      await sleep(50);
      if (sd.attributes && Object.keys(sd.attributes).length > 0) {
        for (const [k, v] of Object.entries(sd.attributes)) {
          process.stdout.write(`      ${chalk.gray(k)}: `);
          const vStr = String(v);
          if (vStr.length > 40) {
            await typewrite(vStr, chalk.green, 2, 10);
          } else {
            await typewrite(vStr, chalk.green, 7, 20);
          }
          console.log();
          await sleep(30);
        }
      }
    } else if (item.disclosed) {
      // Fallback: simplified disclosed (without BBS+ envelope)
      await sleep(70);
      console.log(`    ${chalk.gray("disclosed:")}`);
      await sleep(50);
      for (const [k, v] of Object.entries(item.disclosed)) {
        process.stdout.write(`      ${chalk.gray(k)}: `);
        const vStr = String(v);
        if (vStr.length > 40) {
          await typewrite(vStr, chalk.white, 2, 10);
        } else {
          await typewrite(vStr, chalk.white, 7, 20);
        }
        console.log();
        await sleep(30);
      }
    }
    if (i < result.results.length - 1) {
      console.log();
      await sleep(150);
    }
  }
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
    `${WORKER_URL}/example/verify/0xc6b3380e0d8334e87c3e55d23e987dc0b7638e91950a2467b2bb496e62ac6fdd`;

  const verifyResult = await phase3_verify(verifyUrl);

  if (verifyResult) {
    // Phase 4: Confirm trust
    await phase4_confirmTrust(
      content,
      verifyResult.attributes,
      verifyResult.proof,
      verifyResult.docHash,
    );
  }

  // Advanced: BBS+ selective disclosure (optional)
  if (WITH_DISCLOSURE) {
    await advancedDisclosure(
      verifyResult ? verifyResult.docHash : "0xc6b3380e0d8334e87c3e55d23e987dc0b7638e91950a2467b2bb496e62ac6fdd",
      verifyResult?.settlementProof,
    );
  }
};

main().catch((err: unknown) => {
  console.error("Unexpected error:", err);
  if (err instanceof Error) {
    console.error("Stack:", err.stack);
  }
  process.exit(1);
});
