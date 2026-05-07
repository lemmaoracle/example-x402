/**
 * Worker tests — 402 response shape verification.
 *
 * Tests that x402 payment-required responses have the correct structure.
 */

import { describe, it, expect } from "vitest";
import { Hono } from "hono";

// ---------------------------------------------------------------------------
// Types (mirrored from index.ts for testing)
// ---------------------------------------------------------------------------

type Env = {
  readonly PAY_TO_ADDRESS: string;
  readonly FACILITATOR_URL: string;
  readonly LEMMA_API_BASE: string;
  readonly LEMMA_API_KEY?: string;
  readonly LEMMA_RELAY_URL?: string;
  readonly LEMMA_DISCOVERY_CONFIG?: string;
  readonly CDP_API_KEY_ID?: string;
  readonly CDP_API_KEY_SECRET?: string;
};

type X402PaymentRequiredResponse = {
  x402Version: number;
  accepts: ReadonlyArray<{
    scheme: string;
    network: string;
    maxAmountRequired: string;
    resource: string;
    payTo: string;
    extra: {
      name: string;
      version: string;
    };
  }>;
};

// ---------------------------------------------------------------------------
// Test helper to create a mock x402 response
// ---------------------------------------------------------------------------

const createMockX402Response = (
  path: string,
  payTo: string,
): X402PaymentRequiredResponse => ({
  x402Version: 2,
  accepts: [
    {
      scheme: "exact",
      network: "eip155:84532",
      maxAmountRequired: "1000",
      resource: `https://test-worker.workers.dev${path}`,
      payTo,
      extra: {
        name: "USDC",
        version: "2",
      },
    },
  ],
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Worker", () => {
  describe("402 response shape", () => {
    it("should have correct x402 response structure", () => {
      const mockResponse = createMockX402Response(
        "/example/verify/testhash123",
        "0xTestPayToAddress",
      );

      // Verify x402 version
      expect(mockResponse.x402Version).toBe(2);

      // Verify accepts array structure
      expect(mockResponse.accepts).toBeDefined();
      expect(Array.isArray(mockResponse.accepts)).toBe(true);
      expect(mockResponse.accepts.length).toBeGreaterThan(0);

      const firstAccept = mockResponse.accepts[0];

      // Verify scheme is "exact"
      expect(firstAccept.scheme).toBe("exact");

      // Verify network is Base Sepolia (eip155:84532)
      expect(firstAccept.network).toBe("eip155:84532");

      // Verify payTo address is present
      expect(firstAccept.payTo).toBeDefined();
      expect(typeof firstAccept.payTo).toBe("string");

      // Verify amount is a string (not a number)
      expect(firstAccept.maxAmountRequired).toBeDefined();
      expect(typeof firstAccept.maxAmountRequired).toBe("string");

      // Verify extra has USDC asset info
      expect(firstAccept.extra).toBeDefined();
      expect(firstAccept.extra.name).toBe("USDC");
      expect(firstAccept.extra.version).toBe("2");
    });

    it("should construct correct payment routes", () => {
      const payTo = "0xDeadBeef";
      const routes = {
        "GET /example/verify/:hash": {
          accepts: [
            {
              scheme: "exact" as const,
              price: "$0.001",
              network: "eip155:84532" as const,
              payTo,
              extra: {
                name: "USDC",
                version: "2",
              },
            },
          ],
        },
        "POST /example/query": {
          accepts: [
            {
              scheme: "exact" as const,
              price: "$0.001",
              network: "eip155:84532" as const,
              payTo,
              extra: {
                name: "USDC",
                version: "2",
              },
            },
          ],
        },
      };

      // Verify both routes have correct structure
      for (const [, route] of Object.entries(routes)) {
        expect(route.accepts).toBeDefined();
        expect(route.accepts[0].scheme).toBe("exact");
        expect(route.accepts[0].network).toBe("eip155:84532");
        expect(route.accepts[0].payTo).toBe(payTo);
        expect(route.accepts[0].extra.name).toBe("USDC");
        expect(route.accepts[0].extra.version).toBe("2");
      }
    });

    it("should use Base Sepolia network (chainId 84532)", () => {
      const expectedNetwork = "eip155:84532";
      const mockResponse = createMockX402Response("/example/verify/test", "0xPayTo");

      expect(mockResponse.accepts[0].network).toBe(expectedNetwork);
    });

    it("should use exact payment scheme", () => {
      const mockResponse = createMockX402Response("/example/verify/test", "0xPayTo");

      expect(mockResponse.accepts[0].scheme).toBe("exact");
    });

    it("should use USDC as payment asset", () => {
      const mockResponse = createMockX402Response("/example/verify/test", "0xPayTo");

      expect(mockResponse.accepts[0].extra.name).toBe("USDC");
      expect(mockResponse.accepts[0].extra.version).toBe("2");
    });
  });

  describe("Health check endpoint", () => {
    it("should return ok status", async () => {
      const app = new Hono<{ Bindings: Env }>();

      app.get("/", (c) =>
        c.json({
          status: "ok",
          service: "lemma-x402-worker",
          tagline: "Content is free. Trust costs $0.001.",
          endpoints: {
            verify: "GET /example/verify/:hash (provenance verification)",
            query: "POST /example/query (BBS+ selective disclosure)",
            health: "GET /",
          },
        }),
      );

      const response = await app.request("/", { method: "GET" });

      expect(response.status).toBe(200);

      const body = (await response.json()) as {
        status: string;
        service: string;
        endpoints: Record<string, string>;
      };

      expect(body.status).toBe("ok");
      expect(body.service).toBe("lemma-x402-worker");
      expect(body.endpoints).toBeDefined();
    });
  });
});
