/**
 * Mock @trust402/roles package for testing KYC flow.
 */

import type { ProveOutput } from "@lemmaoracle/sdk";
import type { CommitOutput } from "./identity.js";

// ── Types ──────────────────────────────────────────────────────────────────

export type PaymentGate = Readonly<{
  role: string;
  maxSpend: number;
}>;

export type CircuitWitness = Readonly<{
  credentialCommitment: string;
  roleHash: string;
  spendLimit: string;
  salt: string;
  requiredRoleHash: string;
  maxSpend: string;
  nowSec: string;
  roleGateCommitment: string;
  credentialCommitmentPublic: string;
}>;

// ── Constants ──────────────────────────────────────────────────────────────

const BN254_PRIME = BigInt(
  "21888242871839275222246405745257275088548364400416034343698204186575808495617",
);

// ── fieldHash() ─────────────────────────────────────────────────────────────

import { createHash } from "crypto";

/**
 * SHA-256 with top-nibble masking for BN254 field-element derivation.
 */
export const fieldHash = (name: string): string => {
  const hash = createHash("sha256").update(name, "utf8").digest("hex");
  const maskedFirstByte = (parseInt(hash.slice(0, 2), 16) & 0x0f).toString(16).padStart(2, "0");
  const maskedHash = maskedFirstByte + hash.slice(2);
  const scalar = BigInt(`0x${maskedHash}`) % BN254_PRIME;
  return scalar.toString();
};

// ── witness() ───────────────────────────────────────────────────────────────

/**
 * Build a CircuitWitness for the role-spend-limit-v1 circuit.
 */
export const witness = (
  gate: PaymentGate,
  commitOutput: CommitOutput,
): CircuitWitness => {
  const roleHash = fieldHash(gate.role);
  const spendLimit = commitOutput.normalized.financial.spendLimit ?? "0";
  const saltScalar = BigInt(commitOutput.salt).toString();
  const nowSec = Math.floor(Date.now() / 1000).toString();

  // Simple poseidon-like combination (mock)
  const roleGateCommitment = fieldHash(
    commitOutput.root + roleHash + spendLimit + saltScalar,
  );

  return {
    credentialCommitment: commitOutput.root,
    roleHash,
    spendLimit,
    salt: saltScalar,
    requiredRoleHash: roleHash,
    maxSpend: gate.maxSpend.toString(),
    nowSec,
    roleGateCommitment,
    credentialCommitmentPublic: commitOutput.root,
  };
};

// ── prove() ─────────────────────────────────────────────────────────────────

/**
 * Generate a role proof.
 * Mock implementation for testing.
 */
export const prove = async (
  _client: unknown,
  circuitWitness: CircuitWitness,
): Promise<ProveOutput> => {
  // Mock proof generation
  const proofBytes = Array.from(crypto.getRandomValues(new Uint8Array(128)))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  return {
    proof: proofBytes,
    inputs: Object.values(circuitWitness),
  };
};

// ── submit() ───────────────────────────────────────────────────────────────

/**
 * Submit a role proof.
 * Mock implementation for testing.
 */
export const submit = async (
  _client: unknown,
  _docHash: string,
  _proofResult: ProveOutput,
  _chainId?: number,
): Promise<unknown> => {
  return { txHash: "0x" + "00".repeat(32) };
};

// ── Client factory ─────────────────────────────────────────────────────────

export const connect = (apiBase: string) => (apiKey: string) => ({
  apiBase,
  apiKey,
});
