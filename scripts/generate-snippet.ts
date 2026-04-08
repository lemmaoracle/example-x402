/**
 * Snippet generator for Lemma attestation discovery.
 *
 * Generates the X-Lemma-Attestation header and <link> meta tag
 * for blog integration. Run once per article after Lemma registration.
 *
 * Usage:
 *   pnpm generate-snippet -- --docHash 0xabc123... [--worker-url https://...]
 *   pnpm generate-snippet -- --slug my-article [--worker-url https://...]
 */

const args = process.argv.slice(2);

const getArg = (name: string): string | undefined => {
  const idx = args.indexOf(`--${name}`);
  return idx !== -1 && args[idx + 1] ? args[idx + 1] : undefined;
};

const docHash = getArg("docHash") || getArg("doc-hash");
const slug = getArg("slug");
const workerUrl =
  getArg("worker-url") ||
  getArg("workerUrl") ||
  "https://workers.lemma.workers.dev";
const schema = getArg("schema") || "blog-article-v1";

if (!docHash && !slug) {
  console.error("Usage:");
  console.error(
    "  pnpm generate-snippet -- --docHash 0xabc123... [--worker-url URL]",
  );
  console.error(
    "  pnpm generate-snippet -- --slug my-article [--worker-url URL]",
  );
  console.error("\nOptions:");
  console.error("  --docHash      Document hash (0x-prefixed)");
  console.error("  --slug         Article slug (used as identifier)");
  console.error(
    `  --worker-url   Worker URL (default: ${workerUrl})`,
  );
  console.error(`  --schema       Schema name (default: ${schema})`);
  process.exit(1);
}

const identifier = docHash || slug;
const attestationUrl = `${workerUrl.replace(/\/$/, "")}/verify/${identifier}`;

console.log("=== Lemma Attestation Discovery Snippets ===\n");

// --- A: HTTP Headers ---
console.log("-- A: HTTP Response Headers --");
console.log("Add these headers in your server/CDN/middleware:\n");
console.log(`  X-Lemma-Attestation: ${attestationUrl}`);
console.log(`  X-Lemma-Schema: ${schema}`);

console.log("\nCloudflare Worker example:");
console.log(`
  // In your blog's Cloudflare Worker or middleware
  response.headers.set("X-Lemma-Attestation", "${attestationUrl}");
  response.headers.set("X-Lemma-Schema", "${schema}");
`);

console.log("Vercel middleware example:");
console.log(`
  // middleware.ts
  import { NextResponse } from "next/server";
  export function middleware(request) {
    const response = NextResponse.next();
    response.headers.set("X-Lemma-Attestation", "${attestationUrl}");
    response.headers.set("X-Lemma-Schema", "${schema}");
    return response;
  }
`);

// --- B: HTML Meta Tag ---
console.log("-- B: HTML <link> Meta Tag --");
console.log("Add this to your blog template's <head>:\n");
console.log(
  `  <link rel="lemma-attestation" href="${attestationUrl}" type="application/json+lemma" data-schema="${schema}" />`,
);

console.log("\nAstro/Next.js/Hugo template example:");
console.log(`
  <head>
    ...
    <link
      rel="lemma-attestation"
      href="${attestationUrl}"
      type="application/json+lemma"
      data-schema="${schema}"
    />
  </head>
`);

// --- Quick Copy ---
console.log("-- Quick Copy --");
console.log("Header:  ", `X-Lemma-Attestation: ${attestationUrl}`);
console.log(
  "Meta tag:",
  `<link rel="lemma-attestation" href="${attestationUrl}" type="application/json+lemma" />`,
);
