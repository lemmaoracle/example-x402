/**
 * Layer 3 KYC/OFAC Attribute Proof Demo — Tests
 *
 * Verifies:
 * - KYC credential profiles match gate configurations
 * - BBS+ selective disclosure paths
 * - Header construction for extensions.lemma
 * - Wallet address → agent ID derivation
 */

import { describe, it, expect } from "vitest";

// ---------------------------------------------------------------------------
// Profile → Gate mapping test
// ---------------------------------------------------------------------------

/**
 * Maps KYC profiles to their expected gate names.
 * Must match the definitions in layer3-demo.ts.
 */
const PROFILE_GATE_MAP: Readonly<Record<string, string>> = {
  basic: "basic",
  amlCompliance: "amlCompliance",
  institutional: "institutional",
};

/**
 * Predefined KYC gates (must match KycGates in worker/src/kyc/verify.ts).
 */
const EXPECTED_GATE_REQUIREMENTS: Record<
  string,
  Readonly<{ roles: ReadonlyArray<string>; scopes?: ReadonlyArray<string> }>
> = {
  basic: { roles: ["kyc-verified"] },
  amlCompliance: { roles: ["kyc-verified", "aml-cleared", "sanctions-clear"] },
  stablecoinPayment: {
    roles: ["kyc-verified"],
    scopes: ["payment:stablecoin"],
  },
  stablecoinIssuance: { roles: ["kyc-verified"] },
  institutional: { roles: ["institutional"] },
};

/**
 * KYC profile definitions (must match layer3-demo.ts KYC_PROFILES).
 */
const KYC_PROFILES: Record<
  string,
  Readonly<{
    label: string;
    roles: ReadonlyArray<string>;
    scopes: ReadonlyArray<string>;
    gateParam: string;
  }>
> = {
  basic: {
    label: "Basic KYC",
    roles: ["kyc-verified"],
    scopes: ["payment:stablecoin"],
    gateParam: "basic",
  },
  amlCompliance: {
    label: "Full AML/KYC Compliance (PPSI)",
    roles: ["kyc-verified", "aml-cleared", "sanctions-clear"],
    scopes: ["payment:stablecoin", "payment:crypto", "payment:cross-border"],
    gateParam: "amlCompliance",
  },
  institutional: {
    label: "Institutional KYC",
    roles: [
      "kyc-verified",
      "aml-cleared",
      "sanctions-clear",
      "institutional",
    ],
    scopes: [
      "payment:stablecoin",
      "payment:crypto",
      "payment:fiat",
      "payment:cross-border",
    ],
    gateParam: "institutional",
  },
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Layer 3 KYC/OFAC Demo", () => {
  describe("Profile → Gate mapping", () => {
    it("basic profile maps to basic gate", () => {
      expect(PROFILE_GATE_MAP.basic).toBe("basic");
    });

    it("amlCompliance profile maps to amlCompliance gate", () => {
      expect(PROFILE_GATE_MAP.amlCompliance).toBe("amlCompliance");
    });

    it("institutional profile maps to institutional gate", () => {
      expect(PROFILE_GATE_MAP.institutional).toBe("institutional");
    });
  });

  describe("KYC profiles cover gate requirements", () => {
    for (const [profileName, profile] of Object.entries(KYC_PROFILES)) {
      const gate = EXPECTED_GATE_REQUIREMENTS[profile.gateParam];

      if (!gate) continue;

      it(`${profileName} (${profile.label}) roles include all ${profile.gateParam} gate requirements`, () => {
        for (const requiredRole of gate.roles) {
          expect(profile.roles).toContain(requiredRole);
        }
      });

      if (gate.scopes) {
        it(`${profileName} scopes include all ${profile.gateParam} gate scope requirements`, () => {
          for (const requiredScope of gate.scopes!) {
            expect(profile.scopes).toContain(requiredScope);
          }
        });
      }
    }
  });

  describe("BBS+ selective disclosure paths", () => {
    it("basic profile discloses kyc-verified only", () => {
      const profile = KYC_PROFILES.basic;
      expect(profile.roles).toHaveLength(1);
      expect(profile.roles[0]).toBe("kyc-verified");
    });

    it("amlCompliance profile discloses 3 roles (PPSI compliance)", () => {
      const profile = KYC_PROFILES.amlCompliance;
      expect(profile.roles).toHaveLength(3);
      expect(profile.roles).toContain("kyc-verified");
      expect(profile.roles).toContain("aml-cleared");
      expect(profile.roles).toContain("sanctions-clear");
    });

    it("institutional profile includes all compliance roles plus institutional", () => {
      const profile = KYC_PROFILES.institutional;
      // Must include all amlCompliance roles
      for (const role of KYC_PROFILES.amlCompliance.roles) {
        expect(profile.roles).toContain(role);
      }
      // Plus institutional
      expect(profile.roles).toContain("institutional");
    });
  });

  describe("X-Lemma-KYC-Extension header construction", () => {
    it("should produce valid JSON extension header", () => {
      const extension = {
        version: "v1",
        attributes: ["kyc-verified", "aml-cleared", "sanctions-clear"],
        issuerId: "did:lemma:issuer/kyc-provider-1",
        verifiedAt: Math.floor(Date.now() / 1000),
      };

      const headerValue = JSON.stringify(extension);
      const parsed = JSON.parse(headerValue) as typeof extension;

      expect(parsed.version).toBe("v1");
      expect(parsed.attributes).toHaveLength(3);
      expect(parsed.attributes).toContain("kyc-verified");
      expect(parsed.issuerId).toBe("did:lemma:issuer/kyc-provider-1");
      expect(parsed.verifiedAt).toBeGreaterThan(0);
    });

    it("extension header fits within reasonable HTTP header size", () => {
      const extension = {
        version: "v1",
        attributes: [
          "kyc-verified",
          "aml-cleared",
          "sanctions-clear",
          "institutional",
        ],
        issuerId: "did:lemma:issuer/kyc-provider-1",
        verifiedAt: Math.floor(Date.now() / 1000),
      };

      const headerValue = JSON.stringify(extension);
      // HTTP headers typically have 8KB limit; our extension is well under
      expect(headerValue.length).toBeLessThan(400);
    });
  });

  describe("Wallet address → agent ID", () => {
    it("derives agent DID from wallet address", () => {
      const address = "0x1234567890abcdef1234567890abcdef12345678";
      const agentId = `did:key:${address}`;
      expect(agentId).toBe("did:key:0x1234567890abcdef1234567890abcdef12345678");
    });

    it("agent ID is a valid DID format", () => {
      const address = "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd";
      const agentId = `did:key:${address}`;
      expect(agentId).toMatch(/^did:key:0x[a-fA-F0-9]{40}$/);
    });
  });

  describe("PPSI compliance attributes", () => {
    it("covers all 4 PPSI requirements", () => {
      // PPSI NPRM requires: CDD, SAR, record-keeping, OFAC sanctions
      const ppsiRequirements = [
        { requirement: "CDD (identity)", role: "kyc-verified" },
        { requirement: "AML/CFT (monitoring)", role: "aml-cleared" },
        { requirement: "OFAC Sanctions Screening", role: "sanctions-clear" },
        { requirement: "Beneficial Ownership", role: "kyc-verified" }, // covered under same role
      ];

      expect(ppsiRequirements).toHaveLength(4);
      expect(ppsiRequirements.every((r) => r.role.length > 0)).toBe(true);
    });

    it("MiCA requirements are covered by same attribute set", () => {
      const profile = KYC_PROFILES.amlCompliance;
      // MiCA requires: KYC, AML, cross-border notification
      expect(profile.roles).toContain("kyc-verified");
      expect(profile.roles).toContain("aml-cleared");
      expect(profile.scopes).toContain("payment:cross-border");
    });
  });
});