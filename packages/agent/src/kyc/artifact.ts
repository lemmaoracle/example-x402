/**
 * KYC Identity Artifact creation utilities.
 *
 * Builds IdentityArtifact from AgentCredential with KYC roles/scopes/permissions.
 */

import * as R from "ramda";
import type { AgentCredential } from "@lemmaoracle/agent";
import { commit, prove } from "../mocks/identity.js";
import type { CommitOutput, ProveOutput } from "../mocks/identity.js";
import type { IdentityArtifact } from "../mocks/protocol.js";
import type { KycCredential, KycRole, KycScope, KycPermission } from "./types.js";

// ── Helpers ───────────────────────────────────────────────────────────────

/**
 * Convert KYC roles to AgentCredential authority format.
 */
const rolesToAuthorityRoles = (
  roles: ReadonlyArray<KycRole>,
): ReadonlyArray<{ name: string }> =>
  R.map((r) => ({ name: r.name }), roles);

/**
 * Convert KYC scopes to AgentCredential authority format.
 */
const scopesToAuthorityScopes = (
  scopes: ReadonlyArray<KycScope>,
): ReadonlyArray<{ name: string }> =>
  R.map((s) => ({ name: s.name }), scopes);

/**
 * Convert KYC permissions to AgentCredential authority format.
 */
const permissionsToAuthorityPermissions = (
  permissions: ReadonlyArray<KycPermission>,
): ReadonlyArray<{ resource: string; action: string }> =>
  R.map((p) => ({ resource: p.resource, action: p.action }), permissions);

// ── AgentCredential Builder ──────────────────────────────────────────────

/**
 * Input for building an AgentCredential with KYC attributes.
 */
export type BuildCredentialInput = Readonly<{
  agentId: string;
  subjectId: string;
  issuerId: string;
  kyc: KycCredential;
  spendLimit?: number;
  currency?: string;
  validForSeconds?: number;
  controllerId?: string;
  orgId?: string;
}>;

/**
 * Current Unix timestamp in seconds.
 */
const nowSeconds = (): number => Math.floor(Date.now() / 1000);

/**
 * Build an AgentCredential with KYC roles/scopes/permissions.
 */
export const buildKycCredential = (input: BuildCredentialInput): AgentCredential => {
  const issuedAt = nowSeconds();
  const expiresAt = input.validForSeconds
    ? issuedAt + input.validForSeconds
    : undefined;

  return {
    schema: "agent-credential-v1",
    identity: {
      agentId: input.agentId,
      subjectId: input.subjectId,
      ...(input.controllerId ? { controllerId: input.controllerId } : {}),
      ...(input.orgId ? { orgId: input.orgId } : {}),
    },
    authority: {
      roles: rolesToAuthorityRoles(input.kyc.roles),
      scopes: scopesToAuthorityScopes(input.kyc.scopes),
      permissions: permissionsToAuthorityPermissions(input.kyc.permissions),
    },
    ...(input.spendLimit !== undefined || input.currency !== undefined
      ? {
          financial: {
            ...(input.spendLimit !== undefined ? { spendLimit: input.spendLimit } : {}),
            ...(input.currency ? { currency: input.currency } : {}),
          },
        }
      : {}),
    lifecycle: {
      issuedAt,
      ...(expiresAt ? { expiresAt } : {}),
      revoked: false,
    },
    provenance: {
      issuerId: input.issuerId,
      sourceSystem: "trust402-kyc",
    },
  };
};

// ── Identity Artifact Builder ─────────────────────────────────────────────

/**
 * Input for creating an IdentityArtifact.
 */
export type BuildArtifactInput = Readonly<{
  credential: AgentCredential;
  issuerSecretKey: string;
  mac: string;
  issuerPublicKey: string;
  holderKey: string;
  docHash?: string;
}>;

/**
 * Result of building an identity artifact.
 */
export type BuildArtifactResult = Readonly<{
  artifact: IdentityArtifact;
  commitOutput: CommitOutput;
  proveOutput: ProveOutput;
  docHash: string;
}>;

/**
 * Build an IdentityArtifact from a credential.
 *
 * This performs:
 * 1. commit() - Creates the commitment structure
 * 2. prove() - Generates the ZK proof
 * 3. Returns the IdentityArtifact
 */
export const buildIdentityArtifact = async (
  lemmaClient: Parameters<typeof commit>[0],
  input: BuildArtifactInput,
): Promise<BuildArtifactResult> => {
  // Step 1: Commit the credential
  const commitOutput = await commit(lemmaClient, input.credential);

  // Step 2: Generate the identity proof
  const proveOutput = await prove(lemmaClient, {
    commitOutput,
    issuerSecretKey: input.issuerSecretKey,
    mac: input.mac,
    issuerPublicKey: input.issuerPublicKey,
    // Default 'nowSec' to current time
    nowSec: Math.floor(Date.now() / 1000).toString(),
  });

  // Use provided docHash or compute from credential
  const docHash = input.docHash ?? commitOutput.root;

  // Step 3: Build the IdentityArtifact
  const artifact: IdentityArtifact = {
    commitOutput,
    identityProof: proveOutput,
    docHash,
    credential: input.credential,
  };

  return {
    artifact,
    commitOutput,
    proveOutput,
    docHash,
  };
};

// ── Re-exports for convenience ────────────────────────────────────────────

// Re-export IdentityArtifact type from mocks
export type { IdentityArtifact } from "../mocks/protocol.js";
