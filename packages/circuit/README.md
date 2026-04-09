# @example-x402/circuit

Circom circuit for blog article attribute commitment.

## Circuit: `circuit.circom` (formerly `blog-article-v1`)

A commitment-opening circuit proving knowledge of 5 article attributes:

| Signal | Type | Description |
|---|---|---|
| `authorHash` | private | `poseidon(utf8(author DID))` |
| `published` | private | Unix timestamp (seconds) |
| `integrityHash` | private | `poseidon(utf8(body))` |
| `words` | private | Word count |
| `langCode` | private | Numeric ISO 639-1 code |
| `commitment` | **public** | `poseidon(authorHash, published, integrityHash, words, langCode)` |

The single constraint verifies that the public commitment matches the Poseidon hash
of all private inputs.

## Build

```bash
pnpm install
pnpm build    # compile → setup → export verifier
```

The build script (`scripts/build.sh`) will:
1. Compile the circuit to R1CS, WASM, and sym files
2. Download Powers of Tau (14)
3. Perform Groth16 trusted setup
4. Export verification key (`build/verification_key.json`)
5. Export Solidity verifier contract (`build/CircuitVerifier.sol`)

## Deployment

```bash
# Set up environment variables (copy root .env.example to .env)
cd ../..  # Go to example-x402 root
cp .env.example .env
# Edit .env with your private key and RPC URLs

# Deploy to local node (from root)
pnpm -F circuit forge:deploy

# Deploy to Sepolia testnet (from root)
pnpm -F circuit forge:deploy:sepolia

# Deploy to Base Sepolia testnet (from root)
pnpm -F circuit forge:deploy:baseSepolia

# Deploy to Base mainnet (from root)
pnpm -F circuit forge:deploy:base
```

> **Note:** The example ships with pre-compiled artifacts deployed by Lemma.
> You only need to build if you modify the circuit.

## Future extensions

- Range proof on `published` (enforce freshness window)
- Membership proof on `authorHash` (trusted author allowlist)
- Minimum `words` threshold (content depth guarantee)
