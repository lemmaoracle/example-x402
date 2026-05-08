/**
 * Mock @trust402/identity package for testing KYC flow.
 *
 * This provides a minimal implementation that matches the expected interface
 * for identity proof generation.
 */

import type { AgentCredential } from "@lemmaoracle/agent";

// ── Types ──────────────────────────────────────────────────────────────────

export type CommitOutput = Readonly<{
  root: string;
  salt: string;
  sectionHashes: Readonly<Record<string, string>>;
  normalized: Readonly<{
    identity: Readonly<{
      agentId: string;
      subjectId: string;
      controllerId?: string;
      orgId?: string;
    }>;
    authority: Readonly<{
      roles: ReadonlyArray<{ name: string }>;
      scopes: ReadonlyArray<{ name: string }>;
      permissions: ReadonlyArray<{ resource: string; action: string }>;
    }>;
    financial: Readonly<{
      spendLimit?: string;
      currency?: string;
      paymentPolicy?: string;
    }>;
    lifecycle: Readonly<{
      issuedAt: string;
      expiresAt: string;
      revoked: string;
    }>;
    provenance: Readonly<{
      issuerId: string;
      sourceSystem?: string;
      generatorId?: string;
    }>;
  }>;
}>;

export type ProveInput = Readonly<{
  commitOutput: CommitOutput;
  issuerSecretKey: string;
  mac: string;
  issuerPublicKey: string;
  nowSec?: string;
}>;

// Use ProveOutput from @lemmaoracle/sdk
import type { ProveOutput } from "@lemmaoracle/sdk";

// Re-export for convenience
export type { ProveOutput } from "@lemmaoracle/sdk";

// ── commit() ────────────────────────────────────────────────────────────────

const computeSectionHash = (section: unknown): string => {
  // Simple hash simulation - in real implementation this uses Poseidon
  const json = JSON.stringify(section);
  let hash = 0;
  for (let i = 0; i < json.length; i++) {
    const char = json.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return Math.abs(hash).toString(16).padStart(64, "0").slice(0, 64);
};

const normalizeCredential = (cred: AgentCredential): CommitOutput["normalized"] => ({
  identity: {
    agentId: cred.identity.agentId,
    subjectId: cred.identity.subjectId,
    ...("controllerId" in cred.identity && { controllerId: cred.identity.controllerId }),
    ...("orgId" in cred.identity && { orgId: cred.identity.orgId }),
  },
  authority: {
    roles: cred.authority.roles,
    scopes: cred.authority.scopes,
    permissions: cred.authority.permissions,
  },
  financial: {
    ...(cred.financial?.spendLimit !== undefined && { spendLimit: cred.financial.spendLimit.toString() }),
    ...(cred.financial?.currency && { currency: cred.financial.currency }),
    ...(cred.financial?.paymentPolicy && { paymentPolicy: cred.financial.paymentPolicy }),
  },
  lifecycle: {
    issuedAt: cred.lifecycle.issuedAt.toString(),
    expiresAt: (cred.lifecycle.expiresAt ?? 0).toString(),
    revoked: (cred.lifecycle.revoked ?? false).toString(),
  },
  provenance: {
    issuerId: cred.provenance.issuerId,
    ...(cred.provenance.sourceSystem && { sourceSystem: cred.provenance.sourceSystem }),
    ...(cred.provenance.generatorId && { generatorId: cred.provenance.generatorId }),
  },
});

/**
 * Commit an AgentCredential to create the commitment structure.
 * This is a mock implementation for testing.
 */
export const commit = async (
  _client: unknown,
  credential: AgentCredential,
): Promise<CommitOutput> => {
  const normalized = normalizeCredential(credential);

  // Compute section hashes
  const sectionHashes: Record<string, string> = {
    identityHash: computeSectionHash(normalized.identity),
    authorityHash: computeSectionHash(normalized.authority),
    financialHash: computeSectionHash(normalized.financial),
    lifecycleHash: computeSectionHash(normalized.lifecycle),
    provenanceHash: computeSectionHash(normalized.provenance),
  };

  // Compute root as combination of section hashes
  const rootInput = Object.values(sectionHashes).join("");
  const root = computeSectionHash(rootInput);

  // Generate random salt
  const salt = Array.from(crypto.getRandomValues(new Uint8Array(32)))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  return {
    root,
    salt,
    sectionHashes,
    normalized,
  };
};

// ── prove() ─────────────────────────────────────────────────────────────────

/**
 * Generate an identity proof from a commitment.
 * This is a mock implementation for testing.
 */
export const prove = async (
  _client: unknown,
  input: ProveInput,
): Promise<ProveOutput> => {
  // Mock proof generation - in real implementation this calls the prover API
  const proofBytes = Array.from(crypto.getRandomValues(new Uint8Array(128)))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  const inputs = [
    input.commitOutput.root,
    input.commitOutput.salt,
    input.issuerPublicKey,
    input.nowSec ?? Math.floor(Date.now() / 1000).toString(),
  ];

  return {
    proof: proofBytes,
    inputs,
  };
};

// ── submit() ────────────────────────────────────────────────────────────────

/**
 * Submit an identity proof to the chain.
 * This is a mock implementation for testing.
 */
export const submit = async (
  _client: unknown,
  _docHash: string,
  _proofResult: ProveOutput,
  _chainId?: number,
): Promise<unknown> => {
  // Mock submission - in real implementation this submits to the chain
  return { txHash: "0x" + "00".repeat(32) };
};

// ── Re-exports from @lemmaoracle/agent ─────────────────────────────────────

export type {
  AgentCredential,
  AgentCredentialInput,
  NormalizedAgentCredential,
  ValidationResult,
  ValidationError,
  ValidationErrorKind,
} from "@lemmaoracle/agent";

export { computeCredentialCommitment } from "@lemmaoracle/agent";
