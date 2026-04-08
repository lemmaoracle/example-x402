#!/usr/bin/env node
/**
 * Lemma artifact registration script.
 *
 * Uploads built WASM/zkey to Pinata IPFS, then registers
 * the schema and circuit with the Lemma API. Run once on initial deploy.
 *
 * Prerequisites:
 *   1. packages/normalize built with wasm-pack  → pkg/
 *   2. packages/circuit built with circom + snarkjs → build/
 *
 * Usage:
 *   node scripts/register-lemma-artifacts.mjs
 *
 * Required environment variables (.env):
 *   PINATA_API_KEY, PINATA_SECRET_API_KEY   — Pinata IPFS
 *   LEMMA_API_KEY                           — Lemma API
 *   VERIFIER_CONTRACT  (optional)           — on-chain verifier address
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { createHash } from "crypto";
import { create, schemas, circuits } from "@lemmaoracle/sdk";
import dotenv from "dotenv";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, "..", ".env") });

// ── Config ─────────────────────────────────────────────────────────

const PINATA_API_URL = "https://api.pinata.cloud/pinning/pinFileToIPFS";
const CHAIN_ID = 10143; // Monad testnet

const client = create({
  apiBase: process.env.LEMMA_API_BASE ?? "https://workers.lemma.workers.dev",
  apiKey: process.env.LEMMA_API_KEY ?? "",
});

// ── Artifact manifest ──────────────────────────────────────────────

const ARTIFACTS = {
  normalizeWasm: {
    path: path.join(__dirname, "..", "packages", "normalize", "pkg", "normalize_bg.wasm"),
    label: "Normalize WASM",
  },
  normalizeJs: {
    path: path.join(__dirname, "..", "packages", "normalize", "pkg", "normalize.js"),
    label: "Normalize JS glue",
  },
  circuitWasm: {
    path: path.join(__dirname, "..", "packages", "circuit", "build", "circuit_js", "circuit.wasm"),
    label: "Circuit WASM",
  },
  circuitZkey: {
    path: path.join(__dirname, "..", "packages", "circuit", "build", "circuit_final.zkey"),
    label: "Circuit ZKey",
  },
};

// ── Helpers ─────────────────────────────────────────────────────────

function sha256(filePath) {
  const buf = fs.readFileSync(filePath);
  return "0x" + createHash("sha256").update(buf).digest("hex");
}

async function uploadToPinata(filePath) {
  const apiKey = process.env.PINATA_API_KEY;
  const secretKey = process.env.PINATA_SECRET_API_KEY;
  if (!apiKey || !secretKey) {
    throw new Error("PINATA_API_KEY / PINATA_SECRET_API_KEY not set in .env");
  }

  const form = new FormData();
  const blob = new Blob([fs.readFileSync(filePath)]);
  form.append("file", blob, path.basename(filePath));
  form.append("pinataMetadata", JSON.stringify({ name: path.basename(filePath) }));

  const res = await fetch(PINATA_API_URL, {
    method: "POST",
    headers: { pinata_api_key: apiKey, pinata_secret_api_key: secretKey },
    body: form,
  });

  if (!res.ok) {
    throw new Error(`Pinata ${res.status}: ${await res.text()}`);
  }
  const { IpfsHash } = await res.json();
  return `ipfs://${IpfsHash}`;
}

// ── Main ────────────────────────────────────────────────────────────

async function main() {
  /* ---------- 1. Verify build artifacts exist ---------- */
  for (const [key, art] of Object.entries(ARTIFACTS)) {
    if (!fs.existsSync(art.path)) {
      console.error(`Missing: ${art.path}`);
      console.error("Run  wasm-pack build  /  circom + snarkjs  first.");
      process.exit(1);
    }
  }

  /* ---------- 2. Upload to IPFS ---------- */
  console.log("=== IPFS Upload ===\n");
  const urls = {};
  for (const [key, art] of Object.entries(ARTIFACTS)) {
    process.stdout.write(`  ${art.label} ... `);
    urls[key] = await uploadToPinata(art.path);
    console.log(urls[key]);
  }

  const normalizeWasmHash = sha256(ARTIFACTS.normalizeWasm.path);
  console.log(`\n  Normalize WASM SHA-256: ${normalizeWasmHash}`);

  /* ---------- 3. Register schema ---------- */
  console.log("\n=== Lemma Registration ===\n");
  console.log("  schema: blog-article ...");

  await schemas.register(client, {
    id: "blog-article",
    description: "Blog article schema — raw article to circuit-ready attributes",
    normalize: {
      artifact: {
        type: "ipfs",
        wasm: urls.normalizeWasm,
        js: urls.normalizeJs,
      },
      hash: normalizeWasmHash,
      abi: {
        raw: {
          title: "string",
          author: "string",
          body: "string",
          publishedAt: "string",
          lang: "string",
        },
        norm: {
          author: "string",
          published: "i64",
          integrity: "string",
          words: "u32",
          lang: "string",
        },
      },
    },
  });
  console.log("  done");

  /* ---------- 4. Register circuit ---------- */
  console.log("  circuit: blog-article-v1 ...");

  await circuits.register(client, {
    circuitId: "blog-article-v1",
    schema: "blog-article",
    description:
      "Poseidon commitment-opening for blog article attributes (Groth16)",
    inputs: ["commitment"],
    verifiers: [
      {
        type: "onchain",
        address:
          process.env.VERIFIER_CONTRACT ??
          "0x0000000000000000000000000000000000000000",
        chainId: CHAIN_ID,
        alg: "groth16-bn254-snarkjs",
      },
    ],
    artifact: {
      location: {
        type: "ipfs",
        wasm: urls.circuitWasm,
        zkey: urls.circuitZkey,
      },
    },
  });
  console.log("  done");

  console.log("\nAll artifacts uploaded and registered.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
