# example-x402

**Pay-per-query ZK-verified blog articles in 5 minutes** — [Lemma](https://lemmaoracle.com) × [x402](https://x402.org) on Monad testnet.

An AI agent pays a Cloudflare Worker a micro-fee per query. The worker forwards
the request to the Lemma API, returning ZK-verified attributes and BBS+ selective
disclosures (title, body) only after payment clears.

> This demo uses blog articles as the example, but Lemma works with any verifiable
> data — research reports, credentials, IoT sensor readings, financial attestations, etc.

```
                         402 PAYMENT-REQUIRED
                  ┌─── { extra.lemmaAttestation.hints } ───┐
                  │   "3 articles, en/ja, Alice/Bob/Charlie" │
                  │   AI decides: worth $0.001?              │
                  └──────────────────────────────────────────┘
                              │ yes → auto-pay
                              ▼
Agent ──[$0.001 USDC]──▶ Worker ──[Lemma query]──▶ ZK attributes + disclosed content
```

## Prerequisites

- [Node.js](https://nodejs.org/) 20+
- [pnpm](https://pnpm.io/) 9+
- [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/) (installed as a project dependency)
- Monad testnet wallet with test USDC ([faucet](https://testnet.monad.xyz))
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
# Agent queries the worker, auto-pays via x402, prints ZK-verified articles
```

---

## Integrate with Your Blog

This section explains how to register your own blog articles with Lemma
so they appear in query results behind the x402 paywall.

The registration pipeline runs in your existing tooling — GitHub Actions,
WordPress hooks, Astro build scripts, a CLI, etc. There is no separate
service to deploy.

### Step 1: Generate a BBS+ key pair (one-time)

Run the provided npm script to generate a BBS+ key pair:

```bash
pnpm generate-keypair
```

The script will output:
- `secretKey` (hex): Store securely as an environment variable (`LEMMA_BBS_SECRET_KEY`)
- `publicKey` (hex): Share with Lemma during issuer registration

Example output:
```
Generating BBS+ key pair for Lemma selective disclosure...

=== IMPORTANT: Save these keys securely ===

SECRET KEY (hex):
0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef

PUBLIC KEY (hex):
fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210

=== Usage Instructions ===
1. Store the SECRET KEY as an environment variable (e.g., LEMMA_BBS_SECRET_KEY)
2. Share the PUBLIC KEY with Lemma during issuer registration
3. Never commit the secret key to version control!

You can set the secret key as an environment variable:
export LEMMA_BBS_SECRET_KEY="0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
```

Save `secretKey` as a CI secret (`LEMMA_BBS_SECRET_KEY`).
You will not need to regenerate this unless you rotate keys.

### Step 2: Normalize and commit

The SDK fetches the deployed schema artifact (including the normalize WASM)
and runs normalization + Poseidon commitment in a single call:

```ts
import { schemas, define, prepare } from "@lemmaoracle/sdk";

const client = { apiBase: "https://api.lemmaoracle.com" };

// Fetch the deployed schema (includes normalize WASM artifact)
const schemaMeta = await schemas.getById(client, "blog-article");
const schema = await define(schemaMeta);

// prepare() calls the normalize WASM internally — no manual import needed
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
// prep.depth       → Merkle tree depth
```

No manual WASM import is needed — `prepare` resolves the artifact
registered with the schema and runs it internally.

### Step 3: Sign and create selective disclosure

```ts
import { disclose } from "@lemmaoracle/sdk";

const header = new TextEncoder().encode("blog-article-v1");

// All attributes as a flat object — keys are sorted deterministically
// by payloadToMessages into "key:value" strings for BBS+ signing.
const payload = {
  author:    prep.normalized.author,
  body:      article.body,       // full body goes into BBS+ message vector
  integrity: prep.normalized.integrity,
  lang:      prep.normalized.lang,
  published: String(prep.normalized.published),
  title:     article.title,      // full title goes into BBS+ message vector
  words:     String(prep.normalized.words),
};

// Sign all attributes
const messages = disclose.payloadToMessages(payload);
const signed = await disclose.sign(client, {
  messages,
  secretKey,   // from Step 1
  header,
  issuerId: "did:example:you",
});

// Selective disclosure: reveal title + body (hide everything else)
// Indexes correspond to the sorted key order of payload.
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
// sd is a SelectiveDisclosure object ready for Lemma submission
```

### Step 4: Register with Lemma

```ts
import { documents, proofs } from "@lemmaoracle/sdk";

const docHash = `0x${prep.normalized.integrity}`;

// 4a. Register the document
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

// 4b. Submit proof with selective disclosure
await proofs.submit(client, {
  docHash,
  circuitId: "blog-article-v1",
  proof:     "",  // placeholder — production: snarkjs.groth16.fullProve output
  inputs:    [prep.normalized.author, String(prep.normalized.published), prep.normalized.integrity, String(prep.normalized.words), prep.normalized.lang],
  disclosure: sd,
});
```

### Example: GitHub Action

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
          LEMMA_API_BASE: https://api.lemmaoracle.com
        run: |
          # Your script that:
          # 1. Finds changed .md files in content/
          # 2. Parses frontmatter (title, author, lang, date)
          # 3. Runs Steps 2–4 above for each article
          pnpm tsx scripts/register.ts
```

### Example: WordPress hook (conceptual)

```php
add_action('publish_post', function($post_id) {
    $post = get_post($post_id);
    // Call a Node.js sidecar or serverless function
    // that runs Steps 2–4 with the post content
    wp_remote_post('https://your-lambda.example.com/register', [
        'body' => json_encode([
            'title' => $post->post_title,
            'body'  => wp_strip_all_tags($post->post_content),
            'lang'  => get_locale(),
        ]),
    ]);
});
```

---

## Project Structure

```
packages/
  worker/      Cloudflare Worker — Hono + x402-hono, payment gating + disclosure extraction
  agent/       Node.js agent — @x402/fetch auto-payment
  circuit/     Circom circuit — blog-article-v1 (Poseidon commitment, pre-deployed by Lemma)
  normalize/   Rust WASM — rowDoc → normDoc conversion (pre-deployed by Lemma)
scripts/
  register-lemma-artifacts.mjs   Upload WASM/zkey to IPFS + register schema & circuit
  check-balance.ts               Check agent wallet USDC balance on Monad testnet
  generate-bbs-keypair.ts        Generate BBS+ key pair for selective disclosure
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

The script uploads all four artifacts (normalize WASM/JS, circuit WASM/zkey)
to Pinata IPFS, then registers the `blog-article` schema and `blog-article-v1`
circuit with the Lemma API. Run once per deployment.

## How It Works

### Phase 1: Pre-payment (402 hints)

When the agent hits `POST /query` without payment, the worker returns `402 Payment Required`
with quality hints in `extra.lemmaAttestation`:

```json
{
  "lemmaAttestation": {
    "circuitId": "blog-article-v1",
    "schema": "blog-article",
    "hints": {
      "attributes": ["author", "published", "words", "lang", "integrity"],
      "authors": ["did:example:alice", "did:example:bob"],
      "freshness": "2026-04-08",
      "langs": ["en", "ja"],
      "count": 3
    }
  }
}
```

These hints are visible but unverified. The AI agent uses them to decide whether
the content is worth paying for.

### Phase 2: Post-payment (ZK-verified response)

After `@x402/fetch` auto-pays, the worker queries Lemma and returns a simplified response:

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

The `attributes` are ZK-verified and match the 402 hints. The `disclosed` content
is extracted from the BBS+ selective disclosure envelope — cryptographic data
(proof, publicKey, indexes) is stripped for cleanliness.

## Attribute Schema

| Attribute | Type | Description |
|---|---|---|
| `author` | string (DID) | Provable authorship identity |
| `published` | number (unix sec) | Publication timestamp for freshness |
| `integrity` | string (SHA-256 hex) | Body content hash, tamper detection |
| `words` | number | Word count, content depth indicator |
| `lang` | string (ISO 639-1) | Language for relevance filtering |

## Network

Monad testnet (chainId `10143`) — fast, EVM-compatible, ideal for micropayment demos.
RPC: `https://testnet-rpc.monad.xyz`
