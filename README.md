# Lemma ZK attributes × x402 micropayments on Base Sepolia

**Agentic payments run on x402. Agentic trust runs on Lemma.**

Lemma is a trust layer that attaches ZK-proven attributes — org IDs, roles, permission scopes, compliance flags — to AI agents before they pay with x402.  
You can drop it into your existing HTTP 402 payment flows so every agent-to-API or agent-to-agent payment cryptographically proves *who* is paying and *under what policy*.

- Keep your existing x402 HTTP 402 flow and add Lemma's attribute checks in a few lines.
- Prove the agent's issuer, role, and policy compliance as on-chain verifiable attributes.
- Combine with Base Sepolia-based micropayments to let agents pay each other safely and autonomously.

---

## Why agents need more than a wallet

Agents can pay — but recipients can't tell *who* paid or *under what authority*. Lemma fills this gap:

| Without Lemma | With Lemma |
|---|---|
| Anonymous transfer | ZK-proven agent ID (issuer + role + policy) |
| "Trust me" self-report | On-chain verifiable attributes |
| No provenance on data received | Cryptographic integrity binding per response |

Drop in a few lines of middleware, and every x402 payment carries machine-verifiable proof of identity, authorization, and data authenticity.

## What This Demo Proves

A reference implementation of **ZK-verified agent transactions** — an
x402 payment flow where every request carries cryptographic proof of
data authenticity and payment settlement.

```
Agent ──[fetches data freely]──▶ Content Source
  │                                     │
  │  "I have the data, but can I        │ X-Lemma-Attestation header
  │   trust it? And can anyone          │ signals: verification available
  │   trust that I verified it?"        │
  │                                     │
  ▼                                     │
  [$0.001 USDC via x402]               │
  │                                     │
  ▼                                     │
  Lemma Worker ◀────────────────────────┘
  │
  ├─ ZK proof: article attributes match a Poseidon commitment (blog-article-v1)
  ├─ BBS+ selective disclosure: reveal only the fields the agent needs
  └─ x402 settlement: facilitator verify → settle → on-chain confirmation
      │
      ▼
  Verified Result
  "Author, date, integrity — all proven. Payment settled."
```

### What each layer proves

| Layer | What's proven | How (in this demo) |
|-------|--------------|-----|
| **Payment Settlement** | Payment occurred on-chain for the stated amount | x402 facilitator verify → settle on Base Sepolia |
| **Data Authenticity** | Article attributes haven't been tampered with | `blog-article-v1` Poseidon commitment circuit + SHA-256 integrity binding |
| **Selective Disclosure** | Only requested fields are revealed, nothing more | BBS+ signature over normalized attributes |

A blog article is the entry-point example. The architecture generalizes to
any verifiable data: credentials, sensor readings, financial attestations,
research outputs, on-chain events.

---

## Why This Matters

With BBS+ selective disclosure, trust attributes are machine-verifiable
without exposing the full credential:

- **Selective proof** — prove specific attributes (author, publication date, integrity hash) to a verifier without revealing the rest.
- **Tamper detection** — SHA-256 content hash is bound to the Poseidon commitment; any modification breaks the proof.
- **Pay-to-verify** — free tier gives you unverified content; $0.001 USDC unlocks the ZK-verified attribute set via x402.

The combination is: cryptographic proof of data (Lemma) + native payment (x402) = **agents that can pay, verify, and act on trusted data**.

---

## Deployed Schemas & Circuits

No local artifacts needed. These are already deployed on the network:

| Type | ID | Purpose |
|------|-----|---------|
| Schema | `passthrough-v1` | Simple passthrough for any payload |
| Circuit | `x402-payment-v1` | Proves on-chain payment (Base Sepolia) |
| Schema | `blog-article-v1` | Blog article normalization |
| Circuit | `blog-article-v1` | Verifies blog article attributes |

## Demo Steps (5 minutes)

### Step 1: Register Content

Register a blog article with conditional disclosure (requires payment to
access full content):

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

#### 3b. Paid access → 200 OK with verified provenance

Generate an x402 payment (see [x402 docs](https://docs.x402.org/)), then:

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

The `PAYMENT-RESPONSE` header contains the settlement proof for
client-side verification.

---

## How It Works

### Agent Experience (4 phases)

| Phase | Action | What's Proven |
|-------|--------|---------------|
| 1 | Agent fetches content normally | Data acquired (free, unverified) |
| 2 | Agent discovers `X-Lemma-Attestation` header | Attestation available |
| 3 | Agent pays $0.001 via x402 → receives verified attributes | Payment on-chain + data authenticity (ZK) |
| 4 | Agent compares content hash with `integrity` attribute | End-to-end integrity confirmed |

### x402 Protocol Flow (inside the worker)

```
Client Request
  │
  ├─ No PAYMENT-SIGNATURE header?
  │   └─ 402 Payment Required (with Lemma attestation metadata)
  │
  ├─ PAYMENT-SIGNATURE present
  │   ├─ 1. Facilitator /verify  — pre-check (signature, amount, balance)
  │   ├─ 2. Facilitator /settle  — broadcast tx, wait for confirmation
  │   ├─ 3. Lemma API /verified-attributes/query
  │   │     └─ Settlement proof used as disclosure credential
  │   └─ 4. Return 200 + PAYMENT-RESPONSE header
  │
  └─ Invalid payment?
      └─ 402 with reason
```

### Endpoints

| Endpoint | Method | Purpose |
|----------|--------|---------|\
| `/verify/:hash` | GET | Provenance verification (main) — verified attributes + proof status |
| `/query` | POST | Full query with BBS+ selective disclosure (advanced) |
| `/` | GET | Health check |

---

## Prerequisites

- [Node.js](https://nodejs.org/) 20+
- [pnpm](https://pnpm.io/) 9+
- [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/) (installed as a project dependency)
- Base Sepolia wallet with test USDC ([faucet](https://faucet.circle.com)) and ETH for gas
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

## Discovery: Integrate with Your Content Source

Lemma uses a pull-based discovery model. Your content source signals that
attestation is available; compatible agents pick it up automatically.

### A: HTTP Response Header (recommended)

```
X-Lemma-Attestation: https://your-worker.workers.dev/verify/0xabc123
X-Lemma-Schema: blog-article-v1
```

Cloudflare Worker example:

```ts
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

```html
<link
  rel="lemma-attestation"
  href="https://your-worker.workers.dev/verify/0xabc123"
  type="application/json+lemma"
/>
```

### Snippet Generator

```bash
pnpm generate-snippet -- --docHash 0xabc123... --worker-url https://your-worker.workers.dev
```

---

## Registering Articles with Lemma

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
agent can receive disclosed fields alongside verified attributes.

This is how Lemma enables a verifiable trust model:
machine-readable trust attributes are selectively disclosed and verifiable, 
while human-auditable context remains private for review.

```bash
pnpm agent:disclosure
```

### Query Response

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

For quick demos, the worker includes AI detection endpoints that redirect
AI agents from a blog to the payment gateway. This is a demo convenience —
**for production, use the header/meta tag discovery approach above.**

```bash
node scripts/test-ai-detection.js
WORKER_URL=http://localhost:8787 node scripts/test-worker-endpoints.js
```

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
re-register:

```bash
cd packages/normalize && wasm-pack build --target web && cd ../..
cd packages/circuit && ./scripts/build.sh && cd ../..
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

Base Sepolia (chainId `84532`) — EVM-compatible, ideal for micropayment
demos.

| Resource | URL |
|----------|-----|
| RPC | `https://sepolia.base.org` |
| Explorer | `https://sepolia.basescan.org` |
| Facilitator | `https://x402-facilitator.lemma.workers.dev` |
| USDC | `0x036CbD53842c5426634e7929541eC2318f3dCF7e` |

Testnet tokens:
- **USDC**: [Circle Faucet](https://faucet.circle.com) — select Base Sepolia
- **ETH** (gas): Use a Base Sepolia faucet (e.g., [Base Faucet](https://www.alchemy.com/faucets/base-sepolia))

---

## Roadmap

This demo covers payment settlement, data authenticity, and selective disclosure. Lemma's schema design already carries `issuerId` / `subjectId` fields, which opens the door to:

- **Agent DID binding** — derive `did:key` from the agent's signing key and bind it to `issuerId`, so every payment is cryptographically linked to a specific principal.
- **Role and policy attributes** — attach org-level roles and permission scopes as verifiable attributes, enabling policy-gated payments.
- **On-chain DID verification** — add a Circom constraint that checks `authorHash == poseidon(did:key)` inside the circuit, making identity part of the ZK proof itself.

---

## Further Reading

- [Cryptographic Trust Chains Between Agents](https://lemma.frame00.com/blog/agent-cryptographic-trust-chain-a2a-api-economy) — A2A collaboration in the API economy
- [x402 Protocol Specification](https://x402.org) — HTTP-native payments
- [Lemma Oracle](https://lemma.frame00.com) — ZK-verified data attestations
