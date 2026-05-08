/**
 * KYC-specific types for Trust402 identity proof system.
 *
 * These types encode KYC attributes as roles, scopes, and permissions
 * within the AgentCredential structure.
 */

import type { ReadonlyDeep } from "type-fest";

// ── KYC Roles ─────────────────────────────────────────────────────────────

/**
 * Standard KYC verification roles.
 *
 * These roles indicate the level of identity verification the agent has completed.
 */
export type KycRole = Readonly<{
  name:
    | "kyc-verified"
    | "aml-cleared"
    | "sanctions-clear"
    | "accredited-investor"
    | "institutional";
}>;

/**
 * Array of KYC roles.
 */
export type KycRoles = ReadonlyArray<KycRole>;

// ── KYC Scopes ────────────────────────────────────────────────────────────

/**
 * KYC scopes define the operational boundaries for payments.
 */
export type KycScope = Readonly<{
  name:
    | "payment:stablecoin"
    | "payment:fiat"
    | "payment:crypto"
    | "payment:cross-border";
}>;

/**
 * Array of KYC scopes.
 */
export type KycScopes = ReadonlyArray<KycScope>;

// ── KYC Permissions ───────────────────────────────────────────────────────

/**
 * KYC permissions define specific actions the agent can perform.
 */
export type KycPermission = Readonly<{
  resource:
    | "stablecoin:issue"
    | "stablecoin:redeem"
    | "stablecoin:transfer"
    | "fiat:on-ramp"
    | "fiat:off-ramp";
  action: "execute" | "read" | "write";
}>;

/**
 * Array of KYC permissions.
 */
export type KycPermissions = ReadonlyArray<KycPermission>;

// ── KYC Credential ────────────────────────────────────────────────────────

/**
 * Full KYC credential structure for an agent.
 */
export type KycCredential = ReadonlyDeep<{
  roles: KycRoles;
  scopes: KycScopes;
  permissions: KycPermissions;
}>;

// ── KYC Verification Result ───────────────────────────────────────────────

/**
 * Result of KYC verification on the worker side.
 */
export type KycVerificationResult = Readonly<{
  verified: boolean;
  agentId?: string;
  roles: ReadonlyArray<string>;
  scopes: ReadonlyArray<string>;
  permissions: ReadonlyArray<string>;
  missingRoles?: ReadonlyArray<string>;
  reason?: string;
}>;

// ── KYC Gate Configuration ───────────────────────────────────────────────

/**
 * Configuration for KYC gate requirements.
 * Defines which roles/scopes/permissions are required to access a resource.
 */
export type KycGateConfig = Readonly<{
  requiredRoles?: ReadonlyArray<string>;
  requiredScopes?: ReadonlyArray<string>;
  requiredPermissions?: ReadonlyArray<{ resource: string; action: string }>;
  requireAll?: boolean; // If true, all requirements must be met. If false, any one is sufficient.
}>;
