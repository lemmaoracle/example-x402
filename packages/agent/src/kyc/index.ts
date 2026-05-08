/**
 * KYC attribute proof system for Trust402.
 *
 * Provides utilities for:
 * - Building AgentCredentials with KYC roles/scopes/permissions
 * - Creating IdentityArtifacts for proof attachment
 * - Verifying KYC attributes on the worker side
 */

// Types
export type {
  KycRole,
  KycRoles,
  KycScope,
  KycScopes,
  KycPermission,
  KycPermissions,
  KycCredential,
  KycVerificationResult,
  KycGateConfig,
} from "./types.js";

// Artifact building
export {
  buildKycCredential,
  buildIdentityArtifact,
  type BuildCredentialInput,
  type BuildArtifactInput,
  type BuildArtifactResult,
} from "./artifact.js";

// Re-export IdentityArtifact type from mocks
export type { IdentityArtifact } from "../mocks/protocol.js";
