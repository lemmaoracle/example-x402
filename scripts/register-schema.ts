#!/usr/bin/env node
/**
 * Register blog-article-v1 schema with Lemma
 *
 * This script:
 * 1. Uploads normalize WASM and JS to Pinata
 * 2. Calculates WASM hash
 * 3. Registers the schema with Lemma SDK
 */

import { create, schemas } from "@lemmaoracle/sdk";
import type { LemmaClient, SchemaMeta } from "@lemmaoracle/spec";
import dotenv from "dotenv";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..");

// Load environment variables
dotenv.config({ path: path.join(PROJECT_ROOT, ".env") });

import { config } from "dotenv";
config();

const LEMMA_API_KEY = process.env.LEMMA_API_KEY;
const PINATA_API_KEY = process.env.PINATA_API_KEY;
const PINATA_SECRET_API_KEY = process.env.PINATA_SECRET_API_KEY;

/* ------------------------------------------------------------------ */
/*  Pinata Upload Functions (Functional Style)                        */
/* ------------------------------------------------------------------ */

type PinataUploadResponse = Readonly<{
  readonly IpfsHash: string;
  readonly PinSize: number;
  readonly Timestamp: string;
  readonly isDuplicate?: boolean;
}>;

const uploadToPinata = (filePath: string, fileName: string): Promise<PinataUploadResponse> => {
  const formData = new FormData();
  const file = fs.readFileSync(filePath);
  const blob = new Blob([file]);
  formData.append("file", blob, fileName);

  const metadata = JSON.stringify({
    name: fileName,
    keyvalues: {
      project: "example-x402",
      schema: "blog-article-v1",
      timestamp: Date.now().toString(),
    },
  });
  formData.append("pinataMetadata", metadata);

  const options = JSON.stringify({ cidVersion: 0 });
  formData.append("pinataOptions", options);

  return fetch("https://api.pinata.cloud/pinning/pinFileToIPFS", {
    method: "POST",
    headers: {
      pinata_api_key: PINATA_API_KEY!,
      pinata_secret_api_key: PINATA_SECRET_API_KEY!,
    },
    body: formData,
  })
    .then((res: Response) =>
      res.ok ? res.json() : Promise.reject(new Error(`Pinata upload failed: ${res.status}`)),
    )
    .then((data: unknown) => data as PinataUploadResponse);
};

const uploadFileToPinata = (filePath: string, fileName: string): Promise<string> => {
  if (!PINATA_API_KEY || !PINATA_SECRET_API_KEY) {
    return Promise.reject(
      new Error("PINATA_API_KEY and PINATA_SECRET_API_KEY environment variables are required"),
    );
  }
  return uploadToPinata(filePath, fileName)
    .then((response) => `ipfs://${response.IpfsHash}`)
    .catch((error) => Promise.reject(new Error(`Failed to upload ${fileName}: ${error.message}`)));
};

/* ------------------------------------------------------------------ */
/*  File Validation Functions                                         */
/* ------------------------------------------------------------------ */

const validateEnvironment = (): Promise<void> => {
  if (!LEMMA_API_KEY || !PINATA_API_KEY || !PINATA_SECRET_API_KEY) {
    return Promise.reject(
      new Error(
        "Missing required environment variables: LEMMA_API_KEY, PINATA_API_KEY, PINATA_SECRET_API_KEY",
      ),
    );
  }
  return Promise.resolve();
};

const checkFileExists = (filePath: string): Promise<void> => {
  if (fs.existsSync(filePath)) {
    return Promise.resolve();
  }
  return Promise.reject(new Error(`File not found: ${filePath}`));
};

/* ------------------------------------------------------------------ */
/*  Hash Calculation                                                  */
/* ------------------------------------------------------------------ */

const calculateWasmHash = (wasmPath: string): Promise<string> =>
  checkFileExists(wasmPath).then(() => {
    const wasmBuffer = fs.readFileSync(wasmPath);
    const hash = createHash("sha256");
    hash.update(wasmBuffer);
    return `0x${hash.digest("hex")}`;
  });

/* ------------------------------------------------------------------ */
/*  Schema Registration                                               */
/* ------------------------------------------------------------------ */

const createLemmaClient = (): LemmaClient =>
  create({
    apiBase: "https://workers.lemma.workers.dev",
    apiKey: LEMMA_API_KEY!,
  });

const registerSchema = (client: LemmaClient, schemaMeta: SchemaMeta): Promise<SchemaMeta> =>
  schemas.register(client, schemaMeta);

const buildSchemaMeta = (wasmHash: string, wasmIpfsUrl: string, jsIpfsUrl: string): SchemaMeta => ({
  id: "blog-article-v1",
  description: "Blog article schema for content integrity verification",
  normalize: {
    artifact: {
      type: "ipfs",
      wasm: wasmIpfsUrl,
      js: jsIpfsUrl,
    },
    hash: wasmHash,
    abi: {
      raw: { output: "bytes" },
      norm: { output: "bytes" },
    },
  },
  metadata: {
    type: "blog-article",
    version: "1.0.0",
    purpose: "Normalize blog article attributes for ZK proof verification",
    implementation: "rust-wasm",
    fields: ["author", "published", "integrity", "words", "lang"],
  },
});

/* ------------------------------------------------------------------ */
/*  Main Execution Pipeline                                           */
/* ------------------------------------------------------------------ */

const main = async (): Promise<void> => {
  try {
    console.log("🚀 Starting blog-article-v1 schema registration...");
    await validateEnvironment();

    const wasmPath = path.join(PROJECT_ROOT, "packages/normalize/pkg/normalize_bg.wasm");
    const jsPath = path.join(PROJECT_ROOT, "packages/normalize/pkg/normalize.js");

    console.log("1. Checking artifact files...");
    await Promise.all([checkFileExists(wasmPath), checkFileExists(jsPath)]);

    console.log("2. Calculating WASM hash...");
    const wasmHash = await calculateWasmHash(wasmPath);

    console.log("3. Uploading artifacts to Pinata...");
    const [wasmIpfsUrl, jsIpfsUrl] = await Promise.all([
      uploadFileToPinata(wasmPath, "normalize_bg.wasm"),
      uploadFileToPinata(jsPath, "normalize.js"),
    ]);

    console.log("4. Registering schema with Lemma...");
    const client = createLemmaClient();
    const schemaMeta = buildSchemaMeta(wasmHash, wasmIpfsUrl, jsIpfsUrl);
    const registeredSchema = await registerSchema(client, schemaMeta);

    console.log("\n✅ Schema registered successfully!");
    console.log(`📝 Schema ID: ${registeredSchema.id}`);
    console.log(`🔗 WASM Hash: ${registeredSchema.normalize.hash}`);
    console.log(`📦 WASM IPFS: ${wasmIpfsUrl}`);
    console.log(`📦 JS IPFS: ${jsIpfsUrl}`);
    console.log("\n🎉 Blog-article-v1 schema is now ready for use!");
  } catch (error: unknown) {
    console.error("\n❌ Error:", error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
};

// Execute main function
main();
