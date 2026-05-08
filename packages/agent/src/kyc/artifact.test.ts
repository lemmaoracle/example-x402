/**
 * KYC module tests — Identity artifact creation and verification.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  buildKycCredential,
  type BuildCredentialInput,
} from "./artifact.js";
import type { KycRole, KycScope, KycPermission, KycCredential } from "./types.js";
import type { AgentCredential } from "@lemmaoracle/agent";

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const sampleKycCredential: KycCredential = {
  roles: [{ name: "kyc-verified" }, { name: "aml-cleared" }],
  scopes: [{ name: "payment:stablecoin" }],
  permissions: [{ resource: "stablecoin:transfer", action: "execute" }],
};

const sampleCredentialInput: BuildCredentialInput = {
  agentId: "agent-001",
  subjectId: "subject-001",
  issuerId: "issuer-001",
  kyc: sampleKycCredential,
  spendLimit: 1000,
  currency: "USDC",
  validForSeconds: 3600,
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("KYC Artifact Builder", () => {
  describe("buildKycCredential", () => {
    it("should build an AgentCredential from KYC credential input", () => {
      const result = buildKycCredential(sampleCredentialInput);

      expect(result.schema).toBe("agent-credential-v1");
      expect(result.identity.agentId).toBe("agent-001");
      expect(result.identity.subjectId).toBe("subject-001");
    });

    it("should map KYC roles to authority.roles", () => {
      const result = buildKycCredential(sampleCredentialInput);

      expect(result.authority.roles).toHaveLength(2);
      expect(result.authority.roles[0].name).toBe("kyc-verified");
      expect(result.authority.roles[1].name).toBe("aml-cleared");
    });

    it("should map KYC scopes to authority.scopes", () => {
      const result = buildKycCredential(sampleCredentialInput);

      expect(result.authority.scopes).toHaveLength(1);
      expect(result.authority.scopes[0].name).toBe("payment:stablecoin");
    });

    it("should map KYC permissions to authority.permissions", () => {
      const result = buildKycCredential(sampleCredentialInput);

      expect(result.authority.permissions).toHaveLength(1);
      expect(result.authority.permissions[0].resource).toBe("stablecoin:transfer");
      expect(result.authority.permissions[0].action).toBe("execute");
    });

    it("should include financial data when provided", () => {
      const result = buildKycCredential(sampleCredentialInput);

      expect(result.financial).toBeDefined();
      expect(result.financial?.spendLimit).toBe(1000);
      expect(result.financial?.currency).toBe("USDC");
    });

    it("should not include financial data when not provided", () => {
      const input: BuildCredentialInput = {
        ...sampleCredentialInput,
        spendLimit: undefined,
        currency: undefined,
      };

      const result = buildKycCredential(input);
      expect(result.financial).toBeUndefined();
    });

    it("should set lifecycle timestamps correctly", () => {
      const before = Math.floor(Date.now() / 1000);
      const result = buildKycCredential({
        ...sampleCredentialInput,
        validForSeconds: 3600,
      });
      const after = Math.floor(Date.now() / 1000);

      expect(result.lifecycle.issuedAt).toBeGreaterThanOrEqual(before);
      expect(result.lifecycle.issuedAt).toBeLessThanOrEqual(after);
      expect(result.lifecycle.expiresAt).toBe(result.lifecycle.issuedAt + 3600);
    });

    it("should not set expiresAt when validForSeconds is not provided", () => {
      const input: BuildCredentialInput = {
        ...sampleCredentialInput,
        validForSeconds: undefined,
      };

      const result = buildKycCredential(input);
      expect(result.lifecycle.expiresAt).toBeUndefined();
    });

    it("should set revoked to false by default", () => {
      const result = buildKycCredential(sampleCredentialInput);
      expect(result.lifecycle.revoked).toBe(false);
    });

    it("should include provenance information", () => {
      const result = buildKycCredential(sampleCredentialInput);

      expect(result.provenance.issuerId).toBe("issuer-001");
      expect(result.provenance.sourceSystem).toBe("trust402-kyc");
    });

    it("should include controllerId and orgId when provided", () => {
      const input: BuildCredentialInput = {
        ...sampleCredentialInput,
        controllerId: "controller-001",
        orgId: "org-001",
      };

      const result = buildKycCredential(input);
      expect(result.identity.controllerId).toBe("controller-001");
      expect(result.identity.orgId).toBe("org-001");
    });

    it("should not include controllerId and orgId when not provided", () => {
      const result = buildKycCredential(sampleCredentialInput);

      expect(result.identity.controllerId).toBeUndefined();
      expect(result.identity.orgId).toBeUndefined();
    });
  });

  describe("KYC role types", () => {
    it("should accept standard KYC role names", () => {
      const roles: ReadonlyArray<KycRole> = [
        { name: "kyc-verified" },
        { name: "aml-cleared" },
        { name: "sanctions-clear" },
        { name: "accredited-investor" },
        { name: "institutional" },
      ];

      const input: BuildCredentialInput = {
        ...sampleCredentialInput,
        kyc: { ...sampleKycCredential, roles },
      };

      const result = buildKycCredential(input);
      expect(result.authority.roles).toHaveLength(5);
    });
  });

  describe("KYC scope types", () => {
    it("should accept standard KYC scope names", () => {
      const scopes: ReadonlyArray<KycScope> = [
        { name: "payment:stablecoin" },
        { name: "payment:fiat" },
        { name: "payment:crypto" },
        { name: "payment:cross-border" },
      ];

      const input: BuildCredentialInput = {
        ...sampleCredentialInput,
        kyc: { ...sampleKycCredential, scopes },
      };

      const result = buildKycCredential(input);
      expect(result.authority.scopes).toHaveLength(4);
    });
  });

  describe("KYC permission types", () => {
    it("should accept standard KYC permission combinations", () => {
      const permissions: ReadonlyArray<KycPermission> = [
        { resource: "stablecoin:issue", action: "execute" },
        { resource: "stablecoin:redeem", action: "execute" },
        { resource: "stablecoin:transfer", action: "read" },
        { resource: "fiat:on-ramp", action: "write" },
        { resource: "fiat:off-ramp", action: "execute" },
      ];

      const input: BuildCredentialInput = {
        ...sampleCredentialInput,
        kyc: { ...sampleKycCredential, permissions },
      };

      const result = buildKycCredential(input);
      expect(result.authority.permissions).toHaveLength(5);
    });
  });
});
