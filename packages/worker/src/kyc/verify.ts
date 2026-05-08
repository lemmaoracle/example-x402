/**
 * KYC verification utilities for worker-side enforcement.
 *
 * Verifies identity proofs from x402 payment headers and checks KYC attributes.
 */

import * as R from "ramda";

// ── Types (defined locally to avoid cross-package imports) ─────────────────────

type KycVerificationResult = Readonly<{
  verified: boolean;
  agentId?: string;
  roles: ReadonlyArray<string>;
  scopes: ReadonlyArray<string>;
  permissions: ReadonlyArray<string>;
  missingRoles?: ReadonlyArray<string>;
  reason?: string;
}>;

type KycGateConfig = Readonly<{
  requiredRoles?: ReadonlyArray<string>;
  requiredScopes?: ReadonlyArray<string>;
  requiredPermissions?: ReadonlyArray<{ resource: string; action: string }>;
  requireAll?: boolean;
}>;

// Import AgentCredential type
import type { AgentCredential } from "@lemmaoracle/agent";

// Re-export types
export type { KycVerificationResult, KycGateConfig };

// ── Proof Header Extraction ───────────────────────────────────────────────

/**
 * Header name for identity proof in x402 payment.
 */
export const IDENTITY_PROOF_HEADER = "X-Lemma-Identity-Proof";

/**
 * Header name for credential in x402 payment.
 */
export const CREDENTIAL_HEADER = "X-Lemma-Credential";

/**
 * Extract identity proof from payment headers.
 */
export const extractIdentityProof = (
  headers: Record<string, string | undefined>,
): Readonly<Record<string, unknown>> | null => {
  const proofHeader = headers[IDENTITY_PROOF_HEADER];
  if (!proofHeader) return null;

  try {
    return JSON.parse(atob(proofHeader)) as Record<string, unknown>;
  } catch {
    return null;
  }
};

/**
 * Extract credential from payment headers.
 */
export const extractCredential = (
  headers: Record<string, string | undefined>,
): AgentCredential | null => {
  const credHeader = headers[CREDENTIAL_HEADER];
  if (!credHeader) return null;

  try {
    return JSON.parse(atob(credHeader)) as AgentCredential;
  } catch {
    return null;
  }
};

// ── KYC Verification ──────────────────────────────────────────────────────

/**
 * Extract role names from credential.
 */
const extractRoleNames = (cred: AgentCredential): ReadonlyArray<string> =>
  R.map((r) => r.name, cred.authority.roles);

/**
 * Extract scope names from credential.
 */
const extractScopeNames = (cred: AgentCredential): ReadonlyArray<string> =>
  R.map((s) => s.name, cred.authority.scopes);

/**
 * Extract permission strings from credential.
 */
const extractPermissionStrings = (cred: AgentCredential): ReadonlyArray<string> =>
  R.map((p) => `${p.resource}:${p.action}`, cred.authority.permissions);

/**
 * Check if credential has a specific role.
 */
export const hasRole = (cred: AgentCredential, roleName: string): boolean =>
  R.any((r) => r.name === roleName, cred.authority.roles);

/**
 * Check if credential has a specific scope.
 */
export const hasScope = (cred: AgentCredential, scopeName: string): boolean =>
  R.any((s) => s.name === scopeName, cred.authority.scopes);

/**
 * Check if credential has a specific permission.
 */
export const hasPermission = (
  cred: AgentCredential,
  resource: string,
  action: string,
): boolean =>
  R.any(
    (p) => p.resource === resource && p.action === action,
    cred.authority.permissions,
  );

/**
 * Check if credential is expired.
 */
export const isExpired = (cred: AgentCredential): boolean => {
  if (!cred.lifecycle.expiresAt) return false;
  return cred.lifecycle.expiresAt < Math.floor(Date.now() / 1000);
};

/**
 * Check if credential is revoked.
 */
export const isRevoked = (cred: AgentCredential): boolean =>
  cred.lifecycle.revoked === true;

/**
 * Verify KYC gate requirements against a credential.
 */
export const verifyKycGate = (
  cred: AgentCredential,
  gate: KycGateConfig,
): KycVerificationResult => {
  // Check expiration and revocation
  if (isExpired(cred)) {
    return {
      verified: false,
      agentId: cred.identity.agentId,
      roles: extractRoleNames(cred),
      scopes: extractScopeNames(cred),
      permissions: extractPermissionStrings(cred),
      reason: "Credential expired",
    };
  }

  if (isRevoked(cred)) {
    return {
      verified: false,
      agentId: cred.identity.agentId,
      roles: extractRoleNames(cred),
      scopes: extractScopeNames(cred),
      permissions: extractPermissionStrings(cred),
      reason: "Credential revoked",
    };
  }

  const requiredRoles = gate.requiredRoles ?? [];
  const requiredScopes = gate.requiredScopes ?? [];
  const requiredPermissions = gate.requiredPermissions ?? [];
  const requireAll = gate.requireAll ?? true;

  // Collect missing requirements
  const missingRoles = R.filter(
    (name: string) => !hasRole(cred, name),
    requiredRoles,
  );

  const missingScopes = R.filter(
    (name: string) => !hasScope(cred, name),
    requiredScopes,
  );

  const missingPermissions = R.filter(
    (req: { resource: string; action: string }) =>
      !hasPermission(cred, req.resource, req.action),
    requiredPermissions,
  );

  // Determine if verified based on requireAll flag
  let verified: boolean;
  let missingRolesList: ReadonlyArray<string>;

  if (requireAll) {
    // All requirements must be met
    verified =
      missingRoles.length === 0 &&
      missingScopes.length === 0 &&
      missingPermissions.length === 0;
    missingRolesList = [
      ...missingRoles,
      ...missingScopes,
      ...R.map(
        (p: { resource: string; action: string }) => `${p.resource}:${p.action}`,
        missingPermissions,
      ),
    ];
  } else {
    // Any one requirement being met is sufficient
    const hasAnyRole =
      requiredRoles.length > 0 &&
      R.any((name: string) => hasRole(cred, name), requiredRoles);
    const hasAnyScope =
      requiredScopes.length > 0 &&
      R.any((name: string) => hasScope(cred, name), requiredScopes);
    const hasAnyPermission =
      requiredPermissions.length > 0 &&
      R.any(
        (req: { resource: string; action: string }) =>
          hasPermission(cred, req.resource, req.action),
        requiredPermissions,
      );

    verified =
      hasAnyRole || hasAnyScope || hasAnyPermission ||
      (requiredRoles.length === 0 && requiredScopes.length === 0 && requiredPermissions.length === 0);

    missingRolesList = verified
      ? []
      : [...requiredRoles, ...requiredScopes, ...R.map((p) => `${p.resource}:${p.action}`, requiredPermissions)];
  }

  return {
    verified,
    agentId: cred.identity.agentId,
    roles: extractRoleNames(cred),
    scopes: extractScopeNames(cred),
    permissions: extractPermissionStrings(cred),
    ...(missingRolesList.length > 0 ? { missingRoles: missingRolesList } : {}),
    ...(verified ? {} : { reason: "Missing required KYC attributes" }),
  };
};

// ── Predefined KYC Gates ─────────────────────────────────────────────────

/**
 * Standard KYC gates for common use cases.
 */
export const KycGates = {
  /**
   * Basic KYC verification - requires kyc-verified role.
   */
  basic: {
    requiredRoles: ["kyc-verified"],
    requireAll: true,
  } as const satisfies KycGateConfig,

  /**
   * AML/CFT compliance - requires KYC + sanctions + AML clearance.
   */
  amlCompliance: {
    requiredRoles: ["kyc-verified", "aml-cleared", "sanctions-clear"],
    requireAll: true,
  } as const satisfies KycGateConfig,

  /**
   * Stablecoin operations - requires KYC + stablecoin scope.
   */
  stablecoinPayment: {
    requiredRoles: ["kyc-verified"],
    requiredScopes: ["payment:stablecoin"],
    requireAll: true,
  } as const satisfies KycGateConfig,

  /**
   * Issuance operations - requires specific permissions.
   */
  stablecoinIssuance: {
    requiredRoles: ["kyc-verified"],
    requiredPermissions: [{ resource: "stablecoin:issue", action: "execute" }],
    requireAll: true,
  } as const satisfies KycGateConfig,

  /**
   * High-value payments - requires institutional KYC level.
   */
  institutional: {
    requiredRoles: ["institutional"],
    requireAll: true,
  } as const satisfies KycGateConfig,
} as const;
