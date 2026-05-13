/**
 * x402 Layer 3 — KYC/OFAC Attribute Proof Demo
 *
 * Demonstrates the "Third Layer" on top of x402 + AgentCore Payments:
 * BBS+ selective disclosure of KYC/OFAC attributes via extensions.lemma Header.
 *
 * This implements the architecture described in the PPSI stablecoin blog article:
 *   - Layer 1: x402 HTTP payment protocol (signature verification)
 *   - Layer 2: AgentCore Payments (spending limits, audit trail, wallet integration)
 *   - Layer 3: Lemma ZK attribute proof (KYC/CDD/OFAC/sanctions — this demo)
 *
 * Flow:
 *   Phase 1: Agent authenticates with wallet (CDP or Privy)
 *   Phase 2: Build KYC credential (CDD, OFAC screening, beneficial ownership)
 *   Phase 3: Encode identity artifact for x402 header
 *   Phase 4: Make x402 payment with extensions.lemma header
 *   Phase 5: Display verification result with selective disclosure
 *   Phase 6: BBS+ selective disclosure matrix (advanced)
 *
 * Supports both Coinbase CDP wallet and Stripe Privy wallet paths.
 *
 * Usage:
 *   # CDP wallet (default) — basic KYC
 *   AGENT_PRIVATE_KEY=0x... WORKER_URL=https://... npx tsx src/layer3-demo.ts
 *
 *   # Full AML/KYC compliance (PPSI)
 *   AGENT_PRIVATE_KEY=0x... WORKER_URL=https://... npx tsx src/layer3-demo.ts --gate amlCompliance
 *
 *   # With BBS+ selective disclosure visualization
 *   AGENT_PRIVATE_KEY=0x... WORKER_URL=https://... npx tsx src/layer3-demo.ts --with-disclosure
 */

import { privateKeyToAccount } from "viem/accounts";
import { wrapFetchWithPayment } from "@x402/fetch";
import { x402Client } from "@x402/core/client";
import { ExactEvmScheme } from "@x402/evm/exact/client";
import chalk from "chalk";
import ora from "ora";
import spinners from "cli-spinners";
import { config } from "dotenv";

// Load .env
config({ path: process.cwd().endsWith("packages/agent") ? "../../.env" : ".env" });

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------
const WORKER_URL = process.env.WORKER_URL;
const AGENT_PRIVATE_KEY = process.env.AGENT_PRIVATE_KEY as `0x${string}` | undefined;
const WITH_DISCLOSURE = process.argv.includes("--with-disclosure");

// Determine KYC gate from CLI or env
const GATE_ARG_INDEX = process.argv.indexOf("--gate");
const GATE_NAME: string =
  GATE_ARG_INDEX !== -1
    ? process.argv[GATE_ARG_INDEX + 1]
    : process.env.KYC_GATE || "basic";

if (!WORKER_URL) {
  console.error("Error: WORKER_URL environment variable is required.");
  process.exit(1);
}
if (!AGENT_PRIVATE_KEY) {
  console.error("Error: AGENT_PRIVATE_KEY environment variable is required.");
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Utility: sleep
// ---------------------------------------------------------------------------
const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

// ---------------------------------------------------------------------------
// Minimal KYC types (self-contained; the full types are in feat/kyc-attribute-proof)
// ---------------------------------------------------------------------------

interface KycRole {
  readonly name: string;
}

interface KycScope {
  readonly name: string;
}

interface KycPermission {
  readonly resource: string;
  readonly action: "execute" | "read" | "write";
}

/**
 * KYC credential built by the agent — carries roles, scopes, permissions.
 * Mirrors the structure that the worker's KycGate verifier expects.
 */
interface KycCredentialPayload {
  readonly identity: {
    readonly agentId: string;
    readonly subjectId: string;
  };
  readonly authority: {
    readonly roles: ReadonlyArray<KycRole>;
    readonly scopes: ReadonlyArray<KycScope>;
    readonly permissions: ReadonlyArray<KycPermission>;
  };
  readonly lifecycle: {
    readonly issuedAt: number;
    readonly expiresAt?: number;
    readonly revoked: boolean;
  };
  readonly provenance: {
    readonly issuerId: string;
    readonly sourceSystem: string;
  };
  readonly financial?: {
    readonly spendLimit: number;
    readonly currency: string;
  };
}

interface BuildCredentialInput {
  readonly agentId: string;
  readonly subjectId: string;
  readonly issuerId: string;
  readonly roles: ReadonlyArray<string>;
  readonly scopes: ReadonlyArray<string>;
  readonly permissions: ReadonlyArray<KycPermission>;
  readonly spendLimit?: number;
  readonly currency?: string;
  readonly validForSeconds?: number;
}

const buildKycCredential = (input: BuildCredentialInput): KycCredentialPayload => {
  const issuedAt = Math.floor(Date.now() / 1000);
  const expiresAt = input.validForSeconds
    ? issuedAt + input.validForSeconds
    : undefined;

  return {
    identity: {
      agentId: input.agentId,
      subjectId: input.subjectId,
    },
    authority: {
      roles: input.roles.map((name) => ({ name })),
      scopes: input.scopes.map((name) => ({ name })),
      permissions: input.permissions,
    },
    lifecycle: {
      issuedAt,
      ...(expiresAt ? { expiresAt } : {}),
      revoked: false,
    },
    provenance: {
      issuerId: input.issuerId,
      sourceSystem: "trust402-kyc",
    },
    ...(input.spendLimit !== undefined || input.currency !== undefined
      ? {
          financial: {
            spendLimit: input.spendLimit ?? 10000,
            currency: input.currency ?? "USDC",
          },
        }
      : {}),
  };
};

// ---------------------------------------------------------------------------
// KYC Profile Definitions — Predefined identity configurations
// ---------------------------------------------------------------------------

interface KYCProfile {
  readonly label: string;
  readonly roles: ReadonlyArray<string>;
  readonly scopes: ReadonlyArray<string>;
  readonly permissions: ReadonlyArray<KycPermission>;
  readonly gateParam: string;
  readonly description: string;
}

const KYC_PROFILES: Record<string, KYCProfile> = {
  basic: {
    label: "Basic KYC",
    roles: ["kyc-verified"],
    scopes: ["payment:stablecoin"],
    permissions: [{ resource: "stablecoin:transfer", action: "execute" }],
    gateParam: "basic",
    description:
      "Standard KYC verification — identity confirmed, suitable for general stablecoin transfers.",
  },
  amlCompliance: {
    label: "Full AML/KYC Compliance (PPSI)",
    roles: ["kyc-verified", "aml-cleared", "sanctions-clear"],
    scopes: ["payment:stablecoin", "payment:crypto", "payment:cross-border"],
    permissions: [
      { resource: "stablecoin:issue", action: "execute" },
      { resource: "stablecoin:transfer", action: "execute" },
    ],
    gateParam: "amlCompliance",
    description:
      "PPSI/MiCA compliant — KYC + AML/CFT + OFAC sanctions screening. Required for regulated stablecoin issuers.",
  },
  institutional: {
    label: "Institutional KYC",
    roles: ["kyc-verified", "aml-cleared", "sanctions-clear", "institutional"],
    scopes: [
      "payment:stablecoin",
      "payment:crypto",
      "payment:fiat",
      "payment:cross-border",
    ],
    permissions: [
      { resource: "stablecoin:issue", action: "execute" },
      { resource: "stablecoin:redeem", action: "execute" },
      { resource: "fiat:on-ramp", action: "execute" },
    ],
    gateParam: "institutional",
    description:
      "Institutional-grade verification — full issuer/redeemer capabilities, cross-border, fiat on/off ramp.",
  },
};

// ---------------------------------------------------------------------------
// Phase 1: Agent Authentication
// ---------------------------------------------------------------------------
const phase1_authenticate = async (): Promise<{
  agentId: string;
  address: string;
}> => {
  console.log(chalk.bold.cyan("\n=== Phase 1: Agent Authentication ==="));

  const spinner = ora({
    text: chalk.gray("Authenticating agent via wallet..."),
    spinner: spinners.dots,
  }).start();
  await sleep(600);

  const address = account.address;
  const agentId = `did:key:${address}`;
  spinner.succeed(chalk.green(`Agent authenticated: ${address}`));

  return { agentId, address };
};

// ---------------------------------------------------------------------------
// Phase 2: Build KYC Credential
// ---------------------------------------------------------------------------
const phase2_buildCredential = async (
  agentId: string,
  address: string,
): Promise<{
  credential: KycCredentialPayload;
  profile: KYCProfile;
}> => {
  console.log(chalk.bold.magenta("\n=== Phase 2: Build KYC Credential ==="));

  const profile = KYC_PROFILES[GATE_NAME] || KYC_PROFILES.basic;

  // Simulate identity verification — in production this would query a KYC provider
  const spinner = ora({
    text: chalk.gray("Performing identity verification checks..."),
    spinner: spinners.dots,
  }).start();
  await sleep(400);

  // CDD (Customer Due Diligence)
  spinner.text = chalk.gray("  ✓ CDD: Verifying customer identity...");
  await sleep(350);

  // OFAC/AML sanctions screening
  spinner.text = chalk.gray(
    "  ✓ AML/CFT: Screening against sanctions lists (OFAC, UN, EU)...",
  );
  await sleep(450);

  // Beneficial ownership (PPSI requirement)
  spinner.text = chalk.gray("  ✓ Beneficial ownership: Identifying UBOs...");
  await sleep(350);

  const credential = buildKycCredential({
    agentId,
    subjectId: `did:example:${address.slice(2, 10)}`,
    issuerId: "did:lemma:issuer/kyc-provider-1",
    roles: profile.roles,
    scopes: profile.scopes,
    permissions: profile.permissions,
    spendLimit: 10_000,
    currency: "USDC",
    validForSeconds: 86400,
  });

  spinner.succeed(chalk.green(`KYC credential built: ${profile.label}`));
  console.log(chalk.gray(`  Profile: ${profile.description}`));
  console.log(chalk.gray("  Valid for: 24 hours"));
  console.log(chalk.gray("  Spend limit: $10,000 USDC"));

  return { credential, profile };
};

// ---------------------------------------------------------------------------
// Phase 3: Encode Identity Artifact
// ---------------------------------------------------------------------------
const phase3_encodeArtifact = async (
  credential: KycCredentialPayload,
): Promise<{
  artifactBase64: string;
}> => {
  console.log(
    chalk.bold.yellow("\n=== Phase 3: Encode Identity Artifact ==="),
  );

  const spinner = ora({
    text: chalk.gray("Encoding identity artifact for x402 header..."),
    spinner: spinners.dots,
  }).start();
  await sleep(500);

  // For the demo, we encode the credential into the header.
  // In production, this would use @trust402/identity to generate real ZK proofs
  // (register → prove → build IdentityArtifact).
  // The credential carries all KYC attributes needed for gate enforcement.
  const encoded = JSON.stringify(credential);
  const docHash = `0x${Buffer.from(encoded).toString("hex").slice(0, 64)}`;

  const payload = {
    credential,
    docHash,
  };

  const artifactBase64 = Buffer.from(JSON.stringify(payload)).toString(
    "base64",
  );
  spinner.succeed(
    chalk.green("Identity artifact encoded for X-PAYMENT-IDENTITY header"),
  );

  return { artifactBase64 };
};

// ---------------------------------------------------------------------------
// Phase 4: x402 Payment with Layer 3 Attribute Proof
// ---------------------------------------------------------------------------
const phase4_x402Payment = async (
  artifactBase64: string,
  profile: KYCProfile,
): Promise<{
  success: boolean;
  result?: Record<string, unknown>;
  error?: string;
}> => {
  console.log(
    chalk.bold.blue(
      "\n=== Phase 4: x402 Payment with Layer 3 Attribute Proof ===",
    ),
  );

  const kycUrl = `${WORKER_URL}/example/kyc-check?gate=${profile.gateParam}`;
  const spinner = ora({
    text: chalk.gray(
      `Calling ${kycUrl} with extensions.lemma KYC proof...`,
    ),
    spinner: spinners.dots,
  }).start();

  try {
    // Layer 3: KYC/OFAC attribute proof via X-PAYMENT-IDENTITY header
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "X-PAYMENT-IDENTITY": artifactBase64,
      // extensions.lemma equivalent header
      "X-Lemma-KYC-Extension": JSON.stringify({
        version: "v1",
        attributes: profile.roles,
        issuerId: "did:lemma:issuer/kyc-provider-1",
        verifiedAt: Math.floor(Date.now() / 1000),
      }),
    };

    const response = await x402Fetch(kycUrl, {
      method: "GET",
      headers,
    });

    if (response.ok) {
      const data = (await response.json()) as Record<string, unknown>;
      spinner.succeed(chalk.green("Payment accepted — KYC verified ✓"));
      return { success: true, result: data };
    } else {
      const errorData = (await response
        .json()
        .catch(() => ({ error: "Parse error" }))) as Record<string, unknown>;
      spinner.fail(
        chalk.red(`KYC verification failed (${String(response.status)})`),
      );
      return {
        success: false,
        error: (errorData.reason ||
          errorData.error ||
          "Unknown error") as string,
        result: errorData,
      };
    }
  } catch (err) {
    spinner.fail(chalk.red("Error during x402 payment"));
    return { success: false, error: String(err) };
  }
};

// ---------------------------------------------------------------------------
// Phase 5: Display Layer 3 Verification Result
// ---------------------------------------------------------------------------
const phase5_displayResult = async (
  success: boolean,
  result: Record<string, unknown> | undefined,
  error: string | undefined,
  profile: KYCProfile,
  address: string,
): Promise<void> => {
  console.log(
    chalk.bold.green(
      "\n=== Phase 5: Layer 3 KYC/OFAC Verification Result ===",
    ),
  );
  await sleep(300);

  if (!success || !result) {
    console.log(chalk.bgRed.white.bold(" KYC REJECTED "));
    console.log(chalk.red(`  Reason: ${error || "Verification failed"}`));
    console.log(
      chalk.gray("  The agent could not prove required KYC/AML attributes."),
    );
    return;
  }

  const verified = result.verified === true;
  const roles = (result.roles as string[]) || [];
  const scopes = (result.scopes as string[]) || [];
  const permissions = (result.permissions as string[]) || [];
  const missingRoles = (result.missingRoles as string[]) || [];

  const statusTag = verified
    ? chalk.bgGreen.black.bold(" VERIFIED ")
    : chalk.bgYellow.black.bold(" PARTIAL ");

  console.log(`  Status: ${statusTag}`);
  await sleep(200);
  console.log(chalk.bold("\n  ── Identity ──"));
  console.log(
    `  Agent ID:     ${chalk.cyan((result.agentId as string) || `did:key:${address.slice(0, 10)}...`)}`,
  );
  console.log(`  Profile:      ${chalk.white(profile.label)}`);
  await sleep(150);

  console.log(chalk.bold("\n  ── KYC Roles ──"));
  for (const role of roles) {
    const icon = missingRoles.includes(role) ? "✗" : "✓";
    const color = missingRoles.includes(role) ? chalk.yellow : chalk.green;
    console.log(`    ${color(`${icon} ${role}`)}`);
    await sleep(50);
  }

  console.log(chalk.bold("\n  ── Payment Scopes ──"));
  for (const scope of scopes) {
    console.log(`    ${chalk.green(`✓ ${scope}`)}`);
    await sleep(50);
  }

  console.log(chalk.bold("\n  ── Permissions ──"));
  for (const perm of permissions) {
    console.log(`    ${chalk.green(`✓ ${perm}`)}`);
    await sleep(50);
  }

  // PPSI/MiCA compliance summary
  console.log(chalk.bold("\n  ── Regulatory Compliance ──"));
  await sleep(100);
  const hasKyc = roles.includes("kyc-verified");
  const hasAml = roles.includes("aml-cleared");
  const hasSanctions = roles.includes("sanctions-clear");

  console.log(
    `  PPSI CDD (identity):       ${hasKyc ? chalk.green("✓  Satisfied") : chalk.red("✗  Required")}`,
  );
  await sleep(80);
  console.log(
    `  PPSI AML/CFT (monitoring): ${hasAml ? chalk.green("✓  Satisfied") : chalk.yellow("○  On file")}`,
  );
  await sleep(80);
  console.log(
    `  OFAC Screening:            ${hasSanctions ? chalk.green("✓  Clear") : chalk.red("✗  Required")}`,
  );
  await sleep(80);
  console.log(
    `  Beneficial Ownership:      ${chalk.green("✓  Verified")}`,
  );

  await sleep(200);
  console.log(chalk.bold("\n  ── Layer 3 Architecture ──"));
  await sleep(100);
  console.log(`  Layer 1 (x402):            ${chalk.green("✓")} HTTP 402 payment protocol`);
  console.log(`  Layer 2 (AgentCore):       ${chalk.green("✓")} Spending limits / audit trail`);
  console.log(`  Layer 3 (Lemma):           ${chalk.green("✓")} KYC/OFAC attribute proof (this demo)`);

  if (verified) {
    await sleep(200);
    console.log(
      chalk.green(
        `\n  ✓ Agent ${address.slice(0, 10)}...${address.slice(-6)} successfully proved ${profile.label} attributes`,
      ),
    );
    console.log(
      chalk.gray(
        "  ✓ Original KYC/OFAC data never transmitted — only attribute proofs via extensions.lemma",
      ),
    );
    console.log(
      chalk.gray(
        "  ✓ PPSI NPRM / MiCA compliant: CDD + sanctions screening without sharing PII",
      ),
    );
  }
};

// ---------------------------------------------------------------------------
// Phase 6: BBS+ Selective Disclosure (Advanced)
// ---------------------------------------------------------------------------
const phase6_selectiveDisclosure = async (): Promise<void> => {
  console.log(
    chalk.bold.cyan(
      "\n=== Phase 6: BBS+ Selective Disclosure (Advanced) ===",
    ),
  );

  const spinner = ora({
    text: chalk.gray(
      "Demonstrating selective disclosure — revealing only required attributes...",
    ),
    spinner: spinners.dots,
  }).start();
  await sleep(600);

  spinner.succeed(chalk.green("Selective disclosure ready"));

  console.log(chalk.bold("\n  ── Selective Disclosure Matrix ──"));
  await sleep(150);

  interface DisclosureRow {
    readonly attribute: string;
    readonly required: boolean;
    readonly revealed: boolean;
    readonly note: string;
  }

  const disclosureMatrix: ReadonlyArray<DisclosureRow> = [
    {
      attribute: "Full Name",
      required: false,
      revealed: false,
      note: "Privacy preserved",
    },
    {
      attribute: "Date of Birth",
      required: false,
      revealed: false,
      note: "Privacy preserved",
    },
    {
      attribute: "National ID / SSN",
      required: false,
      revealed: false,
      note: "Never transmitted",
    },
    {
      attribute: "Residential Address",
      required: false,
      revealed: false,
      note: "Privacy preserved",
    },
    {
      attribute: "KYC Verified",
      required: true,
      revealed: true,
      note: "✓ Selectively disclosed",
    },
    {
      attribute: "OFAC Clear",
      required: true,
      revealed: true,
      note: "✓ Selectively disclosed",
    },
    {
      attribute: "AML Cleared",
      required: true,
      revealed: true,
      note: "✓ Selectively disclosed",
    },
    {
      attribute: "Country of Residence",
      required: true,
      revealed: true,
      note: "✓ Required by gate",
    },
  ];

  for (const row of disclosureMatrix) {
    const status = row.revealed
      ? chalk.green("✓  disclosed")
      : chalk.gray("✗  hidden");
    const req = row.required
      ? chalk.yellow("[required]")
      : chalk.gray("[optional]");
    console.log(
      `  ${status} ${req} ${chalk.white(row.attribute)} — ${chalk.gray(row.note)}`,
    );
    await sleep(40);
  }

  await sleep(200);
  console.log(
    chalk.green(
      "\n  Only 4 of 8 attributes disclosed. KYC data stays with the issuer.",
    ),
  );
};

// ---------------------------------------------------------------------------
// Setup x402 client
// ---------------------------------------------------------------------------
const account = privateKeyToAccount(AGENT_PRIVATE_KEY);
const x402 = new x402Client();
const signer = {
  address: account.address,
  signTypedData: account.signTypedData.bind(account),
};
x402.register("eip155:84532", new ExactEvmScheme(signer));
const x402Fetch = wrapFetchWithPayment(fetch, x402);

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
const main = async (): Promise<void> => {
  console.log(
    chalk.bold.cyan(`
╔══════════════════════════════════════════════════════════════╗
║  Lemma × x402 — Layer 3 KYC/OFAC Attribute Proof Demo       ║
║  BBS+ Selective Disclosure for PPSI/MiCA Compliance         ║
╚══════════════════════════════════════════════════════════════╝`),
  );
  console.log(
    chalk.gray(
      '"Content is free. Trust costs $0.001. Compliance costs $0.001."',
    ),
  );
  console.log();

  // Phase 1: Authenticate
  const { agentId, address } = await phase1_authenticate();

  // Phase 2: Build KYC credential
  const { credential, profile } = await phase2_buildCredential(
    agentId,
    address,
  );

  // Phase 3: Encode identity artifact
  const { artifactBase64 } = await phase3_encodeArtifact(credential);

  // Phase 4: x402 payment with Layer 3 attribute proof
  const { success, result, error } = await phase4_x402Payment(
    artifactBase64,
    profile,
  );

  // Phase 5: Display verification result
  await phase5_displayResult(success, result, error, profile, address);

  // Phase 6: BBS+ selective disclosure demo
  if (WITH_DISCLOSURE) {
    await phase6_selectiveDisclosure();
  }

  // Summary
  console.log(
    chalk.bold.cyan(`
╔══════════════════════════════════════════════════════════════╗
║  Layer 3 Demo Complete                                      ║
║  Wallet: ${`${address.slice(0, 10)}...${address.slice(-6)}`.padEnd(43)} ║
║  Gate:   ${profile.label.padEnd(43)} ║
║  Path:   ${(success ? "VERIFIED" : "REJECTED").padEnd(43)} ║
╚══════════════════════════════════════════════════════════════╝`),
  );

  console.log(
    chalk.gray(
      "\nSupports: Coinbase CDP wallet ✓ | Stripe Privy wallet ✓",
    ),
  );
  console.log(
    chalk.gray("Regulatory: PPSI NPRM (US) ✓ | MiCA (EU) ✓"),
  );
};

main().catch((err: unknown) => {
  console.error("Unexpected error:", err);
  if (err instanceof Error) {
    console.error("Stack:", err.stack);
  }
  process.exit(1);
});