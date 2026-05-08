/**
 * KYC verification module for worker-side enforcement.
 */

export {
  IDENTITY_ARTIFACT_HEADER,
  IDENTITY_PROOF_HEADER,
  CREDENTIAL_HEADER,
  extractIdentityArtifact,
  extractIdentityProof,
  extractCredential,
  hasRole,
  hasScope,
  hasPermission,
  isExpired,
  isRevoked,
  verifyKycGate,
  KycGates,
} from "./verify.js";

export type { KycVerificationResult, KycGateConfig } from "./verify.js";
