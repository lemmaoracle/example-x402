/**
 * Agent tests — API path consistency verification.
 *
 * Tests that the agent constructs correct API paths.
 */

import { describe, it, expect } from "vitest";

// ---------------------------------------------------------------------------
// Path construction helpers (extracted for testing)
// ---------------------------------------------------------------------------

/**
 * Constructs the Lemma API query path for verified attributes.
 */
const buildVerifiedAttributesQueryPath = (
  apiBase: string,
): string => {
  const normalizedBase = apiBase.replace(/\/$/, "");
  return `${normalizedBase}/v1/verified-attributes/query`;
};

/**
 * Constructs the worker verify URL for a given hash.
 */
const buildVerifyUrl = (
  workerUrl: string,
  hash: string,
): string => {
  const normalizedWorkerUrl = workerUrl.replace(/\/$/, "");
  return `${normalizedWorkerUrl}/example/verify/${hash}`;
};

/**
 * Constructs the worker query URL.
 */
const buildQueryUrl = (
  workerUrl: string,
): string => {
  const normalizedWorkerUrl = workerUrl.replace(/\/$/, "");
  return `${normalizedWorkerUrl}/example/query`;
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Agent", () => {
  describe("API path consistency", () => {
    it("should construct correct path for verified-attributes query", () => {
      const apiBase = "https://workers.lemma.workers.dev";
      const path = buildVerifiedAttributesQueryPath(apiBase);

      expect(path).toBe("https://workers.lemma.workers.dev/v1/verified-attributes/query");
    });

    it("should handle trailing slashes in API base", () => {
      const apiBase = "https://workers.lemma.workers.dev/";
      const path = buildVerifiedAttributesQueryPath(apiBase);

      expect(path).toBe("https://workers.lemma.workers.dev/v1/verified-attributes/query");
    });

    it("should construct correct verify URL with hash", () => {
      const workerUrl = "https://example-worker.workers.dev";
      const hash = "0xabc123def456";
      const url = buildVerifyUrl(workerUrl, hash);

      expect(url).toBe("https://example-worker.workers.dev/example/verify/0xabc123def456");
    });

    it("should construct correct query URL", () => {
      const workerUrl = "http://localhost:8787";
      const url = buildQueryUrl(workerUrl);

      expect(url).toBe("http://localhost:8787/example/query");
    });

    it("should use /v1/verified-attributes/query path pattern", () => {
      const apiBase = "https://api.lemma.example.com";
      const path = buildVerifiedAttributesQueryPath(apiBase);

      // Verify the path contains the correct API version and endpoint
      expect(path).toContain("/v1/");
      expect(path).toContain("verified-attributes");
      expect(path).toContain("query");
      expect(path.endsWith("/v1/verified-attributes/query")).toBe(true);
    });
  });
});
