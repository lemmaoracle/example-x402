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
- [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/) (`npm i -g wrangler`)
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
# Set secrets in Cloudflare (do not commit .env)
wrangler secret put PAY_TO_ADDRESS --cwd packages/worker
wrangler secret put LEMMA_API_BASE --cwd packages/worker

pnpm deploy:worker
# → https://lemma-query.YOUR-SUBDOMAIN.workers.dev
```

Update `WORKER_URL` in `.env` with the deployed URL.

### 4. Run the agent

```bash
pnpm agent
# Agent queries the worker, auto-pays via x402, prints ZK-verified articles
```

## Project Structure

```
packages/
  worker/      Cloudflare Worker — Hono + x402-hono, payment gating + disclosure extraction
  agent/       Node.js agent — @x402/fetch auto-payment
  circuit/     Circom circuit — blog-article-v1 (Poseidon commitment opening)
  normalize/   rowDoc → normDoc conversion (TypeScript, WASM-compilable)
  generator/   Cloudflare Worker — blog article registration with Lemma
scripts/
  check-balance.ts   Check agent wallet USDC balance on Monad testnet
```

## How It Works

### Phase 1: Pre-payment (402 hints)

When the agent hits `POST /query` without payment, the worker returns `402 Payment Required`
with quality hints in the `extra.lemmaAttestation` field:

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
      "published": 1712534400,
      "words": 1500,
      "lang": "en",
      "integrity": "1234..."
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
| `integrity` | string (Poseidon hash) | Body content hash, tamper detection |
| `words` | number | Word count, content depth indicator |
| `lang` | string (ISO 639-1) | Language for relevance filtering |

## Circuit: `blog-article-v1`

A Poseidon commitment-opening circuit with 5 private inputs (the attributes above)
and 1 public input (the commitment hash). Proves knowledge of attribute values
without revealing them on-chain.

Future extensions: range proofs on `published` (enforce freshness), membership
proofs on `author` (trusted author allowlists), minimum `words` thresholds.

## Pre-deployed Artifacts

The `circuit`, `normalize`, and `generator` packages are pre-deployed by Lemma
for this demo. If the example works as-is, no redeployment is needed. Modify and
redeploy only if you want to customize the attribute schema or circuit.

## Disclosure Gating

The `disclosure` field in the query opts-in to receiving BBS+ selective disclosures.
Documents registered without a `condition` return disclosures freely (payment is
the only gate). To add ZK-proof-based access control on top:

```json
{ "disclosure": { "...", "condition": { "circuitId": "your-circuit-id" } } }
```

See [lemmaoracle/workers PR #24](https://github.com/lemmaoracle/workers/pull/24)
for the `disclosure.condition` implementation.

## Network

Monad testnet (chainId `10143`) — fast, EVM-compatible, ideal for micropayment demos.
RPC: `https://testnet-rpc.monad.xyz`
