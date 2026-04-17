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
const WORKER_URL = process.env.WORKER_URL || "http://localhost:8787";
// Demo mode: detected by localhost URL or explicit env var
const DEMO_MODE = process.env.DEMO_MODE === "true" || process.env.DEMO_MODE === "1" || 
  WORKER_URL.includes("localhost") || WORKER_URL.includes("127.0.0.1");
let AGENT_PRIVATE_KEY = process.env.AGENT_PRIVATE_KEY as
  | `0x${string}`
  | undefined;
const BLOG_URL =
  process.env.BLOG_URL || "https://example-blog.com/articles/zk-proofs";
const WITH_DISCLOSURE = process.argv.includes("--with-disclosure");

// Generate a random key if not provided (demo mode)
// In demo mode, the worker skips blockchain verification
if (!AGENT_PRIVATE_KEY) {
  if (!DEMO_MODE) {
    console.error("Error: AGENT_PRIVATE_KEY environment variable is required.");
    console.error("Set it to a wallet with Base Sepolia USDC, or use DEMO_MODE=true");
    process.exit(1);
  }
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
const sha256 = (content: string): string => {
  // Use a strictly normalized version of the content to handle any whitespace/newline differences
  const normalized = content.replace(/\r\n/g, '\n').trim();
  return createHash("sha256").update(normalized).digest("hex");
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
const DEMO_CONTENT = `Artificial intelligence and blockchain technology are converging to create new possibilities for trust and automation.`;

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
    
    // In demo mode, if we didn't discover an attestation URL, use the fixed demo content for hash matching
    if (!attestationUrl && DEMO_MODE) {
      console.log(chalk.gray("  (Using demo content for hash matching)"));
      content = DEMO_CONTENT;
    }
  } catch {
    // If the blog URL is unreachable (e.g. standalone demo mode), use placeholder content
    spinner.warn(
      chalk.yellow("Blog URL unreachable — using demo content for illustration"),
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
    chalk.gray(`  Attestation URL: ${attestationUrl || "(not discovered — using demo mode)"}`),
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
      const error = await response.text();
      console.error(chalk.red(error));
      console.log(chalk.gray("  Response headers:"));
      response.headers.forEach((v, k) => console.log(chalk.gray(`    ${k}: ${v}`)));
      
      // Dump the client's cached payment authorization if any
      const clientAuth = await (client as any).createAuthorizationHeader(
        "exact", "eip155:84532", 
        (await response.clone().json() as any).accepts[0]
      ).catch((e: any) => `Error creating auth: ${e}`);
      console.log(chalk.yellow(`\n  Debug - Payment Authorization that would be sent: ${clientAuth}`));
      
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

    return {
      attributes: result.attributes,
      proof: result.proof,
      docHash: result.docHash,
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
      chalk.green("  ✓ Content is authentic — author, date, and integrity all confirmed."),
    );
  }
};

// ---------------------------------------------------------------------------
// Advanced: BBS+ selective disclosure via /query
// ---------------------------------------------------------------------------
const advancedDisclosure = async (): Promise<void> => {
  console.log(chalk.bold.blue("\n=== Advanced: BBS+ Selective Disclosure (/query) ==="));
  await sleep(150);
  
  const spinner = ora({
    text: chalk.gray(`Querying ${WORKER_URL}/query with x402 auto-payment ...`),
    spinner: spinners.dots,
  }).start();

  const response = await x402Fetch(`${WORKER_URL}/query`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      targets: { schemas: ["blog-article"] },
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
    
    if (item.disclosed) {
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
    `${WORKER_URL}/verify/0xea79591c06bc62df2401f9fe2aa5e49a21dbc3e9176d613ec80b02c5bfdeebb1`;

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
    await advancedDisclosure();
  }
};

main().catch((err: unknown) => {
  console.error("Unexpected error:", err);
  if (err instanceof Error) {
    console.error("Stack:", err.stack);
  }
  process.exit(1);
});
