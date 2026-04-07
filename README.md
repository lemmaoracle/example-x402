# example-x402

**Pay-per-query ZK attribute API in 5 minutes** — Lemma × [x402](https://x402.org) on Monad testnet.

An AI agent pays a Cloudflare Worker micro-fee per query. The worker forwards the request to the
Lemma API, returning ZK-verified attributes only after payment clears.

```
Agent ──[x402 $0.001 USDC]──▶ Worker ──[Lemma query]──▶ ZK attributes
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
# Agent queries the worker, auto-pays via x402, prints ZK attributes
```

## Project Structure

```
packages/
  worker/   Cloudflare Worker — Hono + x402-hono middleware
  agent/    Node.js agent — @x402/fetch auto-payment
scripts/
  check-balance.ts   Check agent wallet USDC balance on Monad testnet
```

## How It Works

1. **Agent** calls `GET /query` on the worker using `@x402/fetch`
2. Worker returns `402 Payment Required` with payment details
3. `@x402/fetch` automatically signs and broadcasts a USDC payment on Monad testnet
4. Worker verifies payment via `@x402/evm` (self-verify mode — Monad not supported by public facilitator)
5. Worker queries Lemma with `disclosure: { proof: "", inputs: [] }` opt-in
6. ZK-verified attributes returned to the agent

## Disclosure Gating

The `disclosure` field opts-in to receiving BBS+ selective disclosures. Documents registered
without a `condition` return disclosures freely (payment at the worker level is the only gate).

To add ZK-proof-based access control on top, register the document with:
```json
{ "disclosure": { ..., "condition": { "circuitId": "your-circuit-id" } } }
```
Then supply a valid proof in `disclosure.proof` / `disclosure.inputs`.

## Network

Monad testnet (chainId `10143`) — fast, EVM-compatible, ideal for micropayment demos.
RPC: `https://testnet-rpc.monad.xyz`
