/**
 * KYC verification module for worker-side enforcement.
 */

export {
  IDENTITY_PROOF_HEADER,
  CREDENTIAL_HEADER,
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
