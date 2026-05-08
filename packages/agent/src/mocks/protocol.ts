/**
 * Mock @trust402/protocol package for testing KYC flow.
 *
 * Provides IdentityArtifact type and wrapFetchWithProof for proof attachment.
 */

import type { AgentCredential } from "@lemmaoracle/agent";
import type { ProveOutput } from "@lemmaoracle/sdk";
import type { CommitOutput } from "./identity.js";
import type { PaymentGate } from "./roles.js";

// ── Types ──────────────────────────────────────────────────────────────────

/**
 * Pre-generated identity proof artifact.
 */
export type IdentityArtifact = Readonly<{
  commitOutput: CommitOutput;
  identityProof: ProveOutput;
  docHash: string;
  credential: AgentCredential;
}>;

/**
 * Result of generating a role proof from a cached identity artifact.
 */
export type ProveRoleResult = Readonly<{
  identityProof: ProveOutput;
  roleProof: ProveOutput;
  identitySubmission: unknown;
  roleSubmission: unknown;
}>;

export type WrapFetchWithProofOptions = Readonly<{
  chainId?: number;
  onProofResult?: (result: ProveRoleResult) => void;
  webhookUrl?: string;
  webhookApiKey?: string;
  agentId?: string;
  attemptedSpend?: number;
}>;

// ── proveRoleFromArtifact() ────────────────────────────────────────────────

/**
 * Generate a role proof from an identity artifact.
 * Mock implementation for testing.
 */
export const proveRoleFromArtifact = async (
  _client: unknown,
  artifact: IdentityArtifact,
  gate: PaymentGate,
  _options?: WrapFetchWithProofOptions,
): Promise<ProveRoleResult> => {
  // Mock role proof generation
  const roleProof: ProveOutput = {
    proof: Array.from(crypto.getRandomValues(new Uint8Array(128)))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join(""),
    inputs: [artifact.docHash, gate.role, gate.maxSpend.toString()],
  };

  return {
    identityProof: artifact.identityProof,
    roleProof,
    identitySubmission: { txHash: "0x" + "00".repeat(32) },
    roleSubmission: { txHash: "0x" + "00".repeat(32) },
  };
};

// ── wrapFetchWithProof() ────────────────────────────────────────────────────

/**
 * Wrap fetch to attach identity proof to payments.
 *
 * This composes the x402 payment flow with the identity proof attachment.
 * The resulting fetch will:
 * 1. Generate a role proof before making the request
 * 2. Attach the proof to the PAYMENT header
 * 3. Make the actual request with proof attached
 */
export const wrapFetchWithProof = (
  baseFetch: typeof fetch,
  artifact: IdentityArtifact,
  gate: PaymentGate,
  lemmaClient: unknown,
  options?: WrapFetchWithProofOptions,
): typeof fetch => {
  return async (input: URL | Request | string, init?: RequestInit): Promise<Response> => {
    // Generate proof before making request
    const proofResult = await proveRoleFromArtifact(lemmaClient, artifact, gate, options);

    // Call callback if provided
    options?.onProofResult?.(proofResult);

    // Encode credential and proof for headers
    const credentialEncoded = btoa(JSON.stringify(artifact.credential));
    const proofEncoded = btoa(JSON.stringify(proofResult.identityProof));

    // Merge proof headers with existing headers
    const headers = new Headers(init?.headers);
    headers.set("X-Lemma-Credential", credentialEncoded);
    headers.set("X-Lemma-Identity-Proof", proofEncoded);

    // Make the actual request
    return baseFetch(input, {
      ...init,
      headers,
    });
  };
};

// ── Re-exports ─────────────────────────────────────────────────────────────

export type { CommitOutput } from "./identity.js";
export type { PaymentGate } from "./roles.js";
