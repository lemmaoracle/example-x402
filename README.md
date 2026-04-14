# Lemma × x402: AI reads the web. AI pays for truth.

**Content is free. Trust costs $0.001.** — [Lemma](https://lemmaoracle.com) × [x402](https://x402.org) on Monad Testnet.

An AI agent fetches content from the web for free. When it discovers a Lemma
attestation is available, it autonomously pays $0.001 USDC to verify provenance —
author, publication date, content integrity — all backed by ZK proofs.

> **This demo uses a blog article as the entry-point example.**
> The real story is bigger: as AI agents autonomously browse, procure, and act on
> web data, they need a way to *pay for verified truth* — not just raw content.
> Lemma + x402 is the infrastructure layer that makes that possible for any
> verifiable data: research reports, credentials, IoT sensor readings,
> financial attestations, on-chain events, and beyond.

```
Any content source ──[200 OK]──▶ AI Agent
        │                              │
        │  X-Lemma-Attestation header  "I have the data.
        │  <link rel="lemma-attestation">  But can I trust it?"
        │                              │
        │                              ▼
        │                       [$0.001 USDC]
        │                              │
        │                              ▼
        └──────────── Worker (/verify) ──▶ Verified Attributes + ZK proof
                      "Yes — author, date, integrity all check out."
```

### Why this matters for AI agents

When an AI agent acts autonomously — browsing the web, placing orders,
making decisions based on external data — it cannot inherently trust what it
reads. Today, agents either trust everything (risky) or verify nothing (useless).

Lemma × x402 introduces a third path: **pay a micropayment, get a ZK-verified
attestation**. No API keys. No sign-up. No billing form. Just HTTP.

This works because:
- **x402** turns any HTTP endpoint into a pay-per-use resource, with no
  pre-registration required from either party
- **Lemma** issues ZK proofs that attest to data attributes without revealing
  the underlying content
- Together, an agent can selectively verify what matters — and pay only for
  the trust it needs

## Deployed Schemas & Circuits

No local artifacts needed. These are already deployed on the network:

| Type | ID | Purpose |
|------|-----|---------|\
| Schema | `passthrough-v1` | Simple passthrough for any payload |
| Circuit | `x402-payment-v1` | Proves on-chain payment (Monad Testnet) |
| Schema | `blog-article-v1` | Blog article normalization |
| Circuit | `blog-article-v1` | Verifies blog article attributes |

## Demo Steps (5 minutes)

### Step 1: Register Content

Register a blog article with a conditional disclosure (requires payment to access full content):

```bash
pnpm register:content
```

This creates:
- A document with `blog-article-v1` schema
- **Free tier proof**: verifiable without payment (title, author, date)
- **Paid tier proof**: requires `x402-payment-v1` circuit proof (body, full content)

The script outputs a `docHash` — you will use this in Step 3.

> **Note**: Skip this step if you already have a registered docHash.

### Step 2: Start the Resource Worker

```bash
pnpm dev:worker
```

The worker runs at `http://localhost:8787`.

### Step 3: Test the x402 Flow

#### 3a. Unauthenticated access → 402 Payment Required

```bash
curl -s http://localhost:8787/verify/<your-docHash> | jq
```

Response:
```json
{
  "error": "payment_required",
  "message": "Content is free. Trust costs $0.001.",
  "paymentRequirements": { ... }
}
```

#### 3b. Paid access → 200 OK with disclosed content

Generate a x402 payment (see [x402 docs](https://docs.x402.org/)), then:

```bash
curl -s -H "PAYMENT-SIGNATURE: <base64-encoded-payment-payload>" \
  http://localhost:8787/verify/<your-docHash> | jq
```

Response:
```json
{
  "results": [
    {
      "docHash": "0x...",
      "schema": "blog-article-v1",
      "issuerId": "...",
      "subjectId": "...",
      "disclosed": { "body": "...", "fullContent": "..." },
      "proof": { "status": "verified", "circuitId": "blog-article-v1" }
    }
  ]
}
```

The `PAYMENT-RESPONSE` header contains the settlement proof for client-side verification.

## Prerequisites

- [Node.js](https://nodejs.org/) 20+
- [pnpm](https://pnpm.io/) 9+
- [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/) (installed as a project dependency)
- Monad Testnet wallet with test USDC ([faucet](https://faucet.circle.com)) and MON for gas
- Cloudflare account (free tier works)

## Quick Start

### 1. Clone and install

```bash
git clone https://github.com/lemmaoracle/example-x402
cd example-x402
pnpm install
```

### 2. Configure

```bash
cp .env.example .env
# Edit .env: set PAY_TO_ADDRESS and AGENT_PRIVATE_KEY
```

### 3. Deploy the worker

```bash
npx wrangler secret put PAY_TO_ADDRESS --cwd packages/worker
npx wrangler secret put LEMMA_API_BASE --cwd packages/worker

pnpm deploy:worker
# → https://lemma-query.YOUR-SUBDOMAIN.workers.dev
```

Update `WORKER_URL` in `.env` with the deployed URL.

### 4. Run the agent

```bash
pnpm agent
# 4-phase flow: fetch → unverified → pay → verified
```

For the advanced BBS+ selective disclosure flow:

```bash
pnpm agent:disclosure
# Additionally queries POST /query for disclosed title/body
```

---

## How It Works

### Agent Experience (4 phases)

| Phase | Action | Result |
|-------|--------|--------|
| 1 | Agent fetches content normally | Data acquired (free) |
| 2 | Agent displays content | Marked as **unverified** |
| 3 | Agent discovers `X-Lemma-Attestation` header → pays $0.001 | Verified Attributes received |
| 4 | Agent compares content hash with `integrity` attribute | Content marked as **verified** |

### Endpoints

| Endpoint | Method | Purpose |
|----------|--------|---------|\
| `/verify/:hash` | GET | Provenance verification (main) — returns verified attributes + proof status |
| `/query` | POST | Full query with BBS+ selective disclosure (advanced) |
| `/` | GET | Health check |

### 402 Response (before payment)

When an agent hits `GET /verify/:hash` without payment, the worker returns
`402 Payment Required` with attestation metadata:

```json
{
  "lemmaAttestation": {
    "schema": "blog-article",
    "verifiable": ["author", "published", "integrity", "words", "lang"]
  }
}
```

### Verified Response (after payment)

```json
{
  "results": [{
    "docHash": "0x...",
    "schema": "blog-article",
    "attributes": {
      "author": "did:example:alice",
      "published": 1775001600,
      "words": 1500,
      "lang": "en",
      "integrity": "ab12..."
    },
    "proof": {
      "status": "verified",
      "circuitId": "blog-article-v1"
    }
  }]
}
```

The agent compares its locally computed SHA-256 of the blog content against
the `integrity` attribute. If they match, the content is authentic.

---

## Discovery: Integrate with Your Content Source

Lemma uses a pull-based discovery model. Your content source signals that attestation
is available; compatible agents pick it up automatically.

### A: HTTP Response Header (recommended)

Add these headers in your server, CDN, or middleware:

```
X-Lemma-Attestation: https://your-worker.workers.dev/verify/0xabc123
X-Lemma-Schema: blog-article-v1
```

Cloudflare Worker example:

```ts
// In your content source's Worker or middleware
export default {
  async fetch(request, env) {
    const response = await env.CONTENT.fetch(request);
    const newResponse = new Response(response.body, response);
    newResponse.headers.set(
      "X-Lemma-Attestation",
      `https://your-worker.workers.dev/verify/${docHash}`
    );
    newResponse.headers.set("X-Lemma-Schema", "blog-article-v1");
    return newResponse;
  },
};
```

### B: HTML `<link>` meta tag

Add one line to your page template's `<head>`:

```html
<link
  rel="lemma-attestation"
  href="https://your-worker.workers.dev/verify/0xabc123"
  type="application/json+lemma"
/>
```

Like `agent-permissions.json`, this is a lightweight declaration — only
compatible agents react to it; everything else ignores it.

### Snippet Generator

Use the provided script to generate both snippets for an article:

```bash
pnpm generate-snippet -- --docHash 0xabc123... --worker-url https://your-worker.workers.dev
```

---

## Registering Articles with Lemma

This section covers the registration pipeline — how your blog articles
get attested by Lemma so the `/verify` endpoint can serve them.

### Step 1: Generate a BBS+ key pair (one-time)

```bash
pnpm generate-keypair
```

Save `secretKey` as a CI secret (`LEMMA_BBS_SECRET_KEY`).

### Step 2: Normalize and commit

```ts
import { schemas, define, prepare } from "@lemmaoracle/sdk";

const client = { apiBase: "https://workers.lemma.workers.dev" };

const schemaMeta = await schemas.getById(client, "blog-article");
const schema = await define(schemaMeta);

const prep = await prepare(client, {
  schema: schema.id,
  payload: {
    title:       "My Blog Post",
    author:      "did:example:you",
    body:        "Full article body text...",
    publishedAt: "2026-04-08T12:00:00Z",
    lang:        "en",
  },
});

// prep.normalized  → { author, published, integrity, words, lang }
// prep.commitments → { root, leaves, randomness }
```

### Step 3: Sign and create selective disclosure

```ts
import { disclose } from "@lemmaoracle/sdk";

const header = new TextEncoder().encode("blog-article-v1");

const payload = {
  author:    prep.normalized.author,
  body:      article.body,
  integrity: prep.normalized.integrity,
  lang:      prep.normalized.lang,
  published: String(prep.normalized.published),
  title:     article.title,
  words:     String(prep.normalized.words),
};

const messages = disclose.payloadToMessages(payload);
const signed = await disclose.sign(client, {
  messages,
  secretKey,
  header,
  issuerId: "did:example:you",
});

// Selective disclosure: reveal title + body
// Sorted keys: author, body, integrity, lang, published, title, words
//              0       1     2          3     4          5      6
const TITLE_IDX = 5;
const BODY_IDX  = 1;

const revealed = await disclose.reveal(client, {
  signature: signed.signature,
  messages:  signed.messages,
  publicKey: signed.publicKey,
  indexes:   [BODY_IDX, TITLE_IDX],
  header,
});

const sd = disclose.toSelectiveDisclosure(revealed, {
  publicKey: signed.publicKey,
  header,
  count: messages.length,
});
```

### Step 4: Register with Lemma

```ts
import { documents, proofs } from "@lemmaoracle/sdk";

const docHash = `0x${prep.normalized.integrity}`;

await documents.register(client, {
  schema: schema.id,
  docHash,
  issuerId:  "did:example:you",
  subjectId: "did:example:you",
  attributes: prep.normalized,
  commitments: {
    scheme: "poseidon",
    root: prep.commitments.root,
    leaves: prep.commitments.leaves,
    randomness: prep.commitments.randomness,
  },
});

await proofs.submit(client, {
  docHash,
  circuitId: "blog-article-v1",
  proof:     "",
  inputs:    [
    prep.normalized.author,
    String(prep.normalized.published),
    prep.normalized.integrity,
    String(prep.normalized.words),
    prep.normalized.lang,
  ],
  disclosure: sd,
});
```

### GitHub Action Example

```yaml
# .github/workflows/register-articles.yml
name: Register articles with Lemma
on:
  push:
    paths: ["content/**"]

jobs:
  register:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - run: pnpm install

      - name: Register new/changed articles
        env:
          LEMMA_BBS_SECRET_KEY: ${{ secrets.LEMMA_BBS_SECRET_KEY }}
          LEMMA_API_BASE: https://workers.lemma.workers.dev
        run: pnpm tsx scripts/register.ts
```

---

## Advanced: BBS+ Selective Disclosure

The `POST /query` endpoint provides full BBS+ selective disclosure — the
agent can receive disclosed title/body alongside verified attributes. This
is Lemma's core technical differentiator and useful for agents that need
the actual content, not just provenance.

```bash
# Run agent with disclosure
pnpm agent:disclosure
```

The agent script uses the `--with-disclosure` flag to additionally query
the `/query` endpoint after the standard verification flow.

### Query Response (after payment)

```json
{
  "results": [{
    "docHash": "0x...",
    "schema": "blog-article",
    "attributes": {
      "author": "did:example:alice",
      "published": 1775001600,
      "words": 1500,
      "lang": "en",
      "integrity": "ab12..."
    },
    "disclosed": {
      "title": "ZK Proofs Explained",
      "body": "Zero-knowledge proofs allow one party to prove..."
    },
    "proof": { "status": "verified", "circuitId": "blog-article-v1" }
  }],
  "hasMore": false
}
```

---

## Demo Helper: AI Redirection

For quick 5-minute demos, the worker includes AI detection endpoints that
redirect AI agents from a blog to the payment gateway. This is a convenience
for demonstrations — **for production, use the header/meta tag discovery
approach described above.**

```bash
# Test AI detection (no worker needed)
node scripts/test-ai-detection.js

# Test worker endpoints (requires running worker)
WORKER_URL=http://localhost:8787 node scripts/test-worker-endpoints.js
```

See `scripts/ai-redirect.js` (static blogs) and `scripts/wordpress-ai-redirect.php`
(WordPress) for integration examples.

---

## Project Structure

```
packages/
  worker/      Cloudflare Worker — Hono + x402, /verify + /query endpoints
  agent/       Node.js agent — 4-phase provenance verification demo
  circuit/     Circom circuit — blog-article-v1 (Poseidon commitment, pre-deployed)
  normalize/   Rust WASM — rowDoc → normDoc conversion (pre-deployed)
scripts/
  generate-snippet.ts           Generate X-Lemma-Attestation header + <link> tag
  register-lemma-artifacts.mjs  Upload WASM/zkey to IPFS + register schema & circuit
  check-balance.ts              Check agent wallet USDC balance on Monad Testnet
  generate-bbs-keypair.ts       Generate BBS+ key pair for selective disclosure
  register-with-full-content.ts Register articles with full content support
  ai-redirect.js                JavaScript for AI redirection (demo helper)
  wordpress-ai-redirect.php     WordPress AI redirection plugin (demo helper)
  test-ai-detection.js          Test AI detection logic
  test-worker-endpoints.js      Test worker endpoints
```

## Register Custom Artifacts

If you modify `packages/normalize` or `packages/circuit`, rebuild and
re-register the artifacts with Lemma:

```bash
# 1. Build normalize WASM
cd packages/normalize && wasm-pack build --target web && cd ../..

# 2. Build circuit (circom + snarkjs)
cd packages/circuit && ./scripts/build.sh && cd ../..

# 3. Upload to IPFS + register schema & circuit in one step
cp .env.example .env   # fill in PINATA_API_KEY, PINATA_SECRET_API_KEY, LEMMA_API_KEY
pnpm register
```

## Attribute Schema

| Attribute | Type | Description |
|---|---|---|
| `author` | string (DID) | Provable authorship identity |
| `published` | number (unix sec) | Publication timestamp for freshness |
| `integrity` | string (SHA-256 hex) | Body content hash, tamper detection |
| `words` | number | Word count, content depth indicator |
| `lang` | string (ISO 639-1) | Language for relevance filtering |

## Network

Monad Testnet (chainId `10143`) — Monad's public testnet, EVM-compatible, ideal for micropayment demos.
RPC: `https://testnet-rpc.monad.xyz`
Explorer: `https://testnet.monadexplorer.com`
Facilitator: `https://x402-facilitator.lemma.workers.dev`
USDC: `0x534b2f3A21130d7a60830c2Df862319e593943A3`

To get testnet tokens:
- **USDC**: [Circle Faucet](https://faucet.circle.com) — select Monad Testnet
- **MON** (gas): Use the Monad faucet
