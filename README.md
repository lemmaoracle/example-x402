# Lemma ZK attributes × x402 micropayments on Base Sepolia

**Agentic payments run on x402. Agentic trust runs on Lemma.**

Lemma is a trust layer that attaches ZK-proven attributes — org IDs, roles, permission scopes, compliance flags — to AI agents before they pay with x402. You can drop it into your existing HTTP 402 payment flows so every agent-to-API or agent-to-agent payment cryptographically proves *who is paying* and *under what policy*.

<div align="center">
  
![Terminal demo showing the agent fetching content, making a micropayment via x402, and receiving verified attributes](assets/terminal.gif)

*Demo: Agent fetches content → discovers attestation → pays $0.001 via x402 → receives ZK-verified attributes → selectively discloses specific fields*
</div>

---

## Quick Start: Demo Steps (5 minutes)

Experience the 4-phase provenance verification demo where an agent pays and verifies data.

### 1. Start the Resource Worker
```bash
# Clone and install
git clone https://github.com/lemmaoracle/example-x402
cd example-x402
pnpm install

# Start the worker
pnpm dev:worker
```
The worker runs at `http://localhost:8787`.

### 2. Run the Agent
In another terminal, run the agent script to see the standard flow (fetch → unverified → pay → verified):
```bash
pnpm agent
```

For the advanced **BBS+ selective disclosure** flow (additionally queries for disclosed title/body):
```bash
pnpm agent:disclosure
```

---

## Why agents need more than a wallet

Agents can pay — but recipients can't tell who paid or under what authority. Lemma fills this gap:

| Feature | Without Lemma | With Lemma |
| :--- | :--- | :--- |
| **Identity** | Anonymous transfer | ZK-proven agent ID (issuer + role + policy) |
| **Authority** | "Trust me" self-report | On-chain verifiable attributes |
| **Authenticity** | No provenance on data received | Cryptographic integrity binding per response |

Drop in a few lines of middleware, and every x402 payment carries machine-verifiable proof of identity, authorization, and data authenticity.

## What This Demo Proves

A reference implementation of ZK-verified agent transactions — an x402 payment flow where every request carries cryptographic proof of data authenticity and payment settlement.

```text
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
  ├─ Attribute proof: author, date, integrity verified (Poseidon commitment)
  ├─ Payment proof: on-chain settlement confirmed (x402 facilitator)
  └─ Minimal disclosure: only requested fields revealed (BBS+ signatures)
      │
      ▼
  Verified Result
  "Author, date, integrity — all proven. Payment settled."
```

### What each layer proves

| Layer | What's proven | How (in this demo) |
| :--- | :--- | :--- |
| **Attribute Authenticity** | Author, date, and content integrity haven't been tampered with | `blog-article-v1` Poseidon commitment circuit + SHA-256 integrity binding |
| **Payment Settlement** | Payment occurred on-chain for the stated amount | x402 facilitator verify → settle on Base Sepolia |
| **Minimal Exposure** | The verifier sees only the attributes it needs — nothing more | BBS+ signatures over normalized attributes |

A blog article is the entry-point example. The architecture generalizes to any verifiable data: credentials, sensor readings, financial attestations, research outputs, on-chain events.

---

## Why This Matters

Every x402 payment in this demo carries machine-verifiable proof — not
just that money moved, but that specific attributes are authentic:

- **Verified provenance** — author, publication date, and content integrity are bound to a Poseidon commitment. Any tampering breaks the proof.
- **Pay-to-verify** — content is freely accessible; $0.001 USDC unlocks the ZK-verified attribute set that proves the content is real.
- **Need-to-know disclosure** — the verifier receives only the fields it requests. Full credentials stay private.

Cryptographic proof of data (Lemma) + native payment (x402) = **agents that can pay, verify, and act on trusted data**.

---


## How It Works

### Agent Experience (4 phases)

| Phase | Action | What's Proven |
| :--- | :--- | :--- |
| 1 | Agent fetches content normally | Data acquired (free, unverified) |
| 2 | Agent discovers `X-Lemma-Attestation` header | Attestation available |
| 3 | Agent pays $0.001 via x402 → receives verified attributes | Payment on-chain + data authenticity (ZK) |
| 4 | Agent compares content hash with integrity attribute | End-to-end integrity confirmed |

### Endpoints

| Endpoint | Method | Purpose |
| :--- | :--- | :--- |
| `/example/verify/:hash` | GET | Provenance verification (main) — verified attributes + proof status |
| `/example/query` | POST | Full query with BBS+ selective disclosure (advanced) |
| `/` | GET | Health check |

---

## Prerequisites & Deployment

- Node.js 20+
- pnpm 9+
- Wrangler CLI (installed as a project dependency)
- Base Sepolia wallet with test USDC ([faucet](https://faucet.circle.com/)) and ETH for gas
- Cloudflare account (free tier works)

### Deploy the worker

```bash
cp .env.example .env
# Edit .env: set PAY_TO_ADDRESS and AGENT_PRIVATE_KEY

npx wrangler secret put PAY_TO_ADDRESS --cwd packages/worker
npx wrangler secret put LEMMA_API_BASE --cwd packages/worker

pnpm deploy:worker
# → https://lemma-query.YOUR-SUBDOMAIN.workers.dev
```
Update `WORKER_URL` in `.env` with the deployed URL.

---

## Discovery: Integrate with Your Content Source

There are three ways to integrate Lemma with your content source, ranging from the most direct to standard discovery models.

### 1. Direct Middleware (The Primitive Way)
The most direct integration is to apply the x402 payment middleware directly to your resource endpoint. This is exactly what `packages/worker/src/index.ts` does.

```typescript
import { paymentMiddleware } from "@x402/hono";
import { HTTPFacilitatorClient, x402ResourceServer } from "@x402/core/server";
import { ExactEvmScheme } from "@x402/evm/exact/server";

// 1. Setup x402 facilitator and resource server
const facilitatorClient = new HTTPFacilitatorClient({ url: "https://x402-facilitator.lemma.workers.dev" });
const resourceServer = new x402ResourceServer(facilitatorClient)
  .register("eip155:84532", new ExactEvmScheme());

// 2. Define route requirements
const routes = {
  "GET /example/verify/:hash": {
    accepts: [{ scheme: "exact", price: "$0.001", network: "eip155:84532", payTo }],
    extensions: { lemma: { schema: "blog-article" } }
  }
};

// 3. Apply middleware
app.use("*", paymentMiddleware(routes, resourceServer));
```

### 2. AI User-Agent Redirection
Another primitive approach is to serve free content to humans but redirect AI agents to your Lemma x402 worker. We provide helper scripts in the `scripts/` directory for this:

- `scripts/ai-redirect.js`: Client-side JavaScript detection.
- `scripts/wordpress-ai-redirect.php`: WordPress plugin for server-side detection.

```javascript
// Simple User-Agent detection pattern
const aiPatterns = ['OpenAI', 'Claude', 'GPT', 'Bot', 'Crawler'];
const isAIAgent = aiPatterns.some(p => navigator.userAgent.includes(p));

if (isAIAgent) {
  // Redirect AI to the paid verification gateway
  window.location.href = `https://your-worker.workers.dev/ai-content/${slug}`;
}
```

### 3. Pull-Based Discovery
Lemma uses a pull-based discovery model. Your content source signals that attestation is available; compatible agents pick it up automatically.

**HTTP Response Header**
```http
X-Lemma-Attestation: https://your-worker.workers.dev/example/verify/0xabc123
X-Lemma-Schema: blog-article-v1
```

**HTML `<link>` meta tag**
```html
<link
  rel="lemma-attestation"
  href="https://your-worker.workers.dev/example/verify/0xabc123"
  type="application/json+lemma"
/>
```

---

## Advanced: Bring Your Own Data

This repository uses a blog article as an entry-point example (`blog-article-v1` schema), but the architecture generalizes to any verifiable data: credentials, sensor readings, financial attestations, or research outputs.

To use Lemma-x402 for your own custom data:
1. **Define a Schema:** Create a schema for your data structure using the Lemma SDK.
2. **Deploy a Circuit:** Write and compile a Circom circuit to prove the specific attributes of your data.
3. **Register:** Upload your artifacts and register them on the Lemma network.

---

## Advanced: Registering Content with Full Disclosure

If you want to register your own custom article with full HTML/Markdown content for AI agents to access after payment, you can use the content registration script.

### 1. Register Content

Modify `scripts/register-with-full-content.ts` with your custom article data, then run:

```bash
pnpm register:content
```

This creates a document with `blog-article-v1` schema, offering both a free tier proof (title, author, date) and a paid tier proof requiring `x402-payment-v1` circuit proof (body, full content).

### 2. Test the Custom Content x402 Flow

**2a. Unauthenticated access → 402 Payment Required**
```bash
curl -s http://localhost:8787/example/verify/<your-docHash> | jq
```

**2b. Paid access → 200 OK with verified provenance**
Generate an x402 payment, then:
```bash
curl -s -H "PAYMENT-SIGNATURE: <base64-encoded-payment-payload>" \
  http://localhost:8787/example/verify/<your-docHash> | jq
```

---

## Network

Base Sepolia (chainId 84532) — EVM-compatible, ideal for micropayment demos.

| Resource | URL |
| :--- | :--- |
| RPC | https://sepolia.base.org |
| Explorer | https://sepolia.basescan.org |
| Facilitator | https://x402-facilitator.lemma.workers.dev |
| USDC | `0x036CbD53842c5426634e7929541eC2318f3dCF7e` |

---

## Roadmap

This demo covers payment settlement, data authenticity, and selective disclosure. Lemma's schema design already carries `issuerId` / `subjectId` fields, which opens the door to:

- **Agent DID binding** — derive `did:key` from the agent's signing key and bind it to `issuerId`, so every payment is cryptographically linked to a specific principal.
- **Role and policy attributes** — attach org-level roles and permission scopes as verifiable attributes, enabling policy-gated payments.
- **On-chain DID verification** — add a Circom constraint that checks `authorHash == poseidon(did:key)` inside the circuit, making identity part of the ZK proof itself.

## Further Reading
- Cryptographic Trust Chains Between Agents — A2A collaboration in the API economy
- x402 Protocol Specification — HTTP-native payments
- Lemma Oracle — ZK-verified data attestations
