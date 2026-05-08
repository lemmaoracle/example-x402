/**
 * KYC verification tests — Worker-side enforcement.
 */

import { describe, it, expect } from "vitest";
import {
  verifyKycGate,
  hasRole,
  hasScope,
  hasPermission,
  isExpired,
  isRevoked,
  KycGates,
  extractCredential,
  extractIdentityArtifact,
  type KycVerificationResult,
} from "./verify.js";
import type { AgentCredential } from "@lemmaoracle/agent";
import type { IdentityArtifact } from "@trust402/protocol";

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const createCredential = (
  overrides: Partial<AgentCredential> = {},
): AgentCredential => ({
  schema: "agent-credential-v1",
  identity: {
    agentId: "agent-001",
    subjectId: "subject-001",
  },
  authority: {
    roles: [{ name: "kyc-verified" }],
    scopes: [{ name: "payment:stablecoin" }],
    permissions: [{ resource: "stablecoin:transfer", action: "execute" }],
  },
  lifecycle: {
    issuedAt: Math.floor(Date.now() / 1000),
    revoked: false,
  },
  provenance: {
    issuerId: "issuer-001",
    sourceSystem: "trust402-kyc",
  },
  ...overrides,
});

const createIdentityArtifact = (
  credential: AgentCredential = createCredential(),
  overrides: Partial<IdentityArtifact> = {},
): IdentityArtifact => ({
  commitOutput: {
    root: "1234567890123456789012345678901234567890123456789012345678901234",
    salt: "0".repeat(64),
    sectionHashes: {
      identityHash: "a".repeat(64),
      authorityHash: "b".repeat(64),
      financialHash: "c".repeat(64),
      lifecycleHash: "d".repeat(64),
      provenanceHash: "e".repeat(64),
    },
    normalized: {
      schema: "agent-identity-authority-v1",
      identity: {
        agentId: credential.identity.agentId,
        subjectId: credential.identity.subjectId,
        controllerId: credential.identity.controllerId ?? "",
        orgId: credential.identity.orgId ?? "",
      },
      authority: {
        roles: credential.authority.roles.map((r) => r.name).join(","),
        scopes: credential.authority.scopes.map((s) => s.name).join(","),
        permissions: credential.authority.permissions.map((p) => `${p.resource}:${p.action}`).join(","),
      },
      financial: {
        spendLimit: "1000",
        currency: "USDC",
        paymentPolicy: "",
      },
      lifecycle: {
        issuedAt: String(credential.lifecycle.issuedAt),
        expiresAt: String(credential.lifecycle.expiresAt ?? 0),
        revoked: "false",
        revocationRef: "",
      },
      provenance: {
        issuerId: credential.provenance.issuerId,
        sourceSystem: credential.provenance.sourceSystem ?? "",
        generatorId: credential.provenance.generatorId ?? "",
        chainId: "84532",
        network: "base-sepolia",
      },
    },
  },
  identityProof: {
    proof: "test-proof",
    inputs: ["input1", "input2"],
  },
  docHash: "test-doc-hash",
  credential,
  ...overrides,
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("KYC Verification", () => {
  describe("hasRole", () => {
    it("should return true when credential has the role", () => {
      const cred = createCredential();
      expect(hasRole(cred, "kyc-verified")).toBe(true);
    });

    it("should return false when credential lacks the role", () => {
      const cred = createCredential();
      expect(hasRole(cred, "aml-cleared")).toBe(false);
    });

    it("should check multiple roles correctly", () => {
      const cred = createCredential({
        authority: {
          roles: [
            { name: "kyc-verified" },
            { name: "aml-cleared" },
            { name: "sanctions-clear" },
          ],
          scopes: [],
          permissions: [],
        },
      });

      expect(hasRole(cred, "kyc-verified")).toBe(true);
      expect(hasRole(cred, "aml-cleared")).toBe(true);
      expect(hasRole(cred, "sanctions-clear")).toBe(true);
      expect(hasRole(cred, "institutional")).toBe(false);
    });
  });

  describe("hasScope", () => {
    it("should return true when credential has the scope", () => {
      const cred = createCredential();
      expect(hasScope(cred, "payment:stablecoin")).toBe(true);
    });

    it("should return false when credential lacks the scope", () => {
      const cred = createCredential();
      expect(hasScope(cred, "payment:fiat")).toBe(false);
    });
  });

  describe("hasPermission", () => {
    it("should return true when credential has the permission", () => {
      const cred = createCredential();
      expect(hasPermission(cred, "stablecoin:transfer", "execute")).toBe(true);
    });

    it("should return false when action does not match", () => {
      const cred = createCredential();
      expect(hasPermission(cred, "stablecoin:transfer", "read")).toBe(false);
    });

    it("should return false when resource does not match", () => {
      const cred = createCredential();
      expect(hasPermission(cred, "stablecoin:issue", "execute")).toBe(false);
    });
  });

  describe("isExpired", () => {
    it("should return false for credential without expiry", () => {
      const cred = createCredential();
      expect(isExpired(cred)).toBe(false);
    });

    it("should return false for non-expired credential", () => {
      const cred = createCredential({
        lifecycle: {
          issuedAt: Math.floor(Date.now() / 1000) - 3600,
          expiresAt: Math.floor(Date.now() / 1000) + 3600,
          revoked: false,
        },
      });
      expect(isExpired(cred)).toBe(false);
    });

    it("should return true for expired credential", () => {
      const cred = createCredential({
        lifecycle: {
          issuedAt: Math.floor(Date.now() / 1000) - 7200,
          expiresAt: Math.floor(Date.now() / 1000) - 3600,
          revoked: false,
        },
      });
      expect(isExpired(cred)).toBe(true);
    });
  });

  describe("isRevoked", () => {
    it("should return false for non-revoked credential", () => {
      const cred = createCredential();
      expect(isRevoked(cred)).toBe(false);
    });

    it("should return true for revoked credential", () => {
      const cred = createCredential({
        lifecycle: {
          issuedAt: Math.floor(Date.now() / 1000),
          revoked: true,
        },
      });
      expect(isRevoked(cred)).toBe(true);
    });
  });

  describe("verifyKycGate", () => {
    it("should verify basic KYC gate with matching role", () => {
      const cred = createCredential();
      const result = verifyKycGate(cred, KycGates.basic);

      expect(result.verified).toBe(true);
      expect(result.agentId).toBe("agent-001");
      expect(result.roles).toContain("kyc-verified");
    });

    it("should reject when missing required role", () => {
      const cred = createCredential({
        authority: {
          roles: [],
          scopes: [],
          permissions: [],
        },
      });

      const result = verifyKycGate(cred, KycGates.basic);

      expect(result.verified).toBe(false);
      expect(result.reason).toBe("Missing required KYC attributes");
      expect(result.missingRoles).toContain("kyc-verified");
    });

    it("should verify AML compliance gate with all required roles", () => {
      const cred = createCredential({
        authority: {
          roles: [
            { name: "kyc-verified" },
            { name: "aml-cleared" },
            { name: "sanctions-clear" },
          ],
          scopes: [],
          permissions: [],
        },
      });

      const result = verifyKycGate(cred, KycGates.amlCompliance);

      expect(result.verified).toBe(true);
    });

    it("should reject AML compliance gate with missing role", () => {
      const cred = createCredential({
        authority: {
          roles: [{ name: "kyc-verified" }, { name: "aml-cleared" }],
          scopes: [],
          permissions: [],
        },
      });

      const result = verifyKycGate(cred, KycGates.amlCompliance);

      expect(result.verified).toBe(false);
      expect(result.missingRoles).toContain("sanctions-clear");
    });

    it("should verify stablecoin payment gate with matching scope", () => {
      const cred = createCredential();
      const result = verifyKycGate(cred, KycGates.stablecoinPayment);

      expect(result.verified).toBe(true);
      expect(result.scopes).toContain("payment:stablecoin");
    });

    it("should reject stablecoin payment gate without scope", () => {
      const cred = createCredential({
        authority: {
          roles: [{ name: "kyc-verified" }],
          scopes: [],
          permissions: [],
        },
      });

      const result = verifyKycGate(cred, KycGates.stablecoinPayment);

      expect(result.verified).toBe(false);
    });

    it("should verify issuance gate with matching permission", () => {
      const cred = createCredential({
        authority: {
          roles: [{ name: "kyc-verified" }],
          scopes: [],
          permissions: [{ resource: "stablecoin:issue", action: "execute" }],
        },
      });

      const result = verifyKycGate(cred, KycGates.stablecoinIssuance);

      expect(result.verified).toBe(true);
    });

    it("should verify institutional gate for institutional role", () => {
      const cred = createCredential({
        authority: {
          roles: [{ name: "institutional" }],
          scopes: [],
          permissions: [],
        },
      });

      const result = verifyKycGate(cred, KycGates.institutional);

      expect(result.verified).toBe(true);
    });

    it("should reject expired credential", () => {
      const cred = createCredential({
        lifecycle: {
          issuedAt: Math.floor(Date.now() / 1000) - 7200,
          expiresAt: Math.floor(Date.now() / 1000) - 3600,
          revoked: false,
        },
      });

      const result = verifyKycGate(cred, KycGates.basic);

      expect(result.verified).toBe(false);
      expect(result.reason).toBe("Credential expired");
    });

    it("should reject revoked credential", () => {
      const cred = createCredential({
        lifecycle: {
          issuedAt: Math.floor(Date.now() / 1000),
          revoked: true,
        },
      });

      const result = verifyKycGate(cred, KycGates.basic);

      expect(result.verified).toBe(false);
      expect(result.reason).toBe("Credential revoked");
    });

    it("should support requireAll: false for any-one semantics", () => {
      const cred = createCredential({
        authority: {
          roles: [{ name: "aml-cleared" }],
          scopes: [],
          permissions: [],
        },
      });

      const gate = {
        requiredRoles: ["kyc-verified", "aml-cleared", "sanctions-clear"],
        requireAll: false,
      };

      const result = verifyKycGate(cred, gate);

      expect(result.verified).toBe(true);
    });

    it("should reject all-requireAll: false when no requirements are met", () => {
      const cred = createCredential({
        authority: {
          roles: [{ name: "some-other-role" }],
          scopes: [],
          permissions: [],
        },
      });

      const gate = {
        requiredRoles: ["kyc-verified", "aml-cleared"],
        requireAll: false,
      };

      const result = verifyKycGate(cred, gate);

      expect(result.verified).toBe(false);
    });
  });

  describe("extractIdentityArtifact", () => {
    it("should extract valid IdentityArtifact from X-PAYMENT-IDENTITY header", () => {
      const credential = createCredential();
      const artifact = createIdentityArtifact(credential);
      const encoded = btoa(JSON.stringify(artifact));
      const headers = { "X-PAYMENT-IDENTITY": encoded };

      const result = extractIdentityArtifact(headers);

      expect(result).not.toBeNull();
      expect(result?.docHash).toBe("test-doc-hash");
      expect(result?.credential.identity.agentId).toBe("agent-001");
    });

    it("should return null for missing header", () => {
      const headers = {};
      const result = extractIdentityArtifact(headers);
      expect(result).toBeNull();
    });

    it("should return null for invalid base64", () => {
      const headers = { "X-PAYMENT-IDENTITY": "not-valid-base64!!!" };
      const result = extractIdentityArtifact(headers);
      expect(result).toBeNull();
    });

    it("should return null for invalid JSON", () => {
      const headers = { "X-PAYMENT-IDENTITY": btoa("not json") };
      const result = extractIdentityArtifact(headers);
      expect(result).toBeNull();
    });
  });

  describe("extractCredential", () => {
    it("should extract credential from X-PAYMENT-IDENTITY header", () => {
      const credential = createCredential();
      const artifact = createIdentityArtifact(credential);
      const encoded = btoa(JSON.stringify(artifact));
      const headers = { "X-PAYMENT-IDENTITY": encoded };

      const result = extractCredential(headers);

      expect(result).not.toBeNull();
      expect(result?.identity.agentId).toBe("agent-001");
    });

    it("should fallback to X-Lemma-Credential header for backward compatibility", () => {
      const cred = createCredential();
      const encoded = btoa(JSON.stringify(cred));
      const headers = { "X-Lemma-Credential": encoded };

      const result = extractCredential(headers);

      expect(result).not.toBeNull();
      expect(result?.identity.agentId).toBe("agent-001");
    });

    it("should prefer X-PAYMENT-IDENTITY over X-Lemma-Credential", () => {
      const cred1 = createCredential({
        identity: { agentId: "agent-001", subjectId: "subject-001" },
      });
      const cred2 = createCredential({
        identity: { agentId: "agent-002", subjectId: "subject-002" },
      });

      const artifact = createIdentityArtifact(cred1);
      const headers = {
        "X-PAYMENT-IDENTITY": btoa(JSON.stringify(artifact)),
        "X-Lemma-Credential": btoa(JSON.stringify(cred2)),
      };

      const result = extractCredential(headers);

      // Should use X-PAYMENT-IDENTITY
      expect(result?.identity.agentId).toBe("agent-001");
    });

    it("should return null for missing headers", () => {
      const headers: Record<string, string | undefined> = {};
      const result = extractCredential(headers);
      expect(result).toBeNull();
    });

    it("should return null for invalid base64", () => {
      const headers = { "X-Lemma-Credential": "not-valid-base64!!!" };
      const result = extractCredential(headers);
      expect(result).toBeNull();
    });

    it("should return null for invalid JSON", () => {
      const headers = { "X-Lemma-Credential": btoa("not json") };
      const result = extractCredential(headers);
      expect(result).toBeNull();
    });
  });
});
