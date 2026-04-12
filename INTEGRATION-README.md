# Lemma x x402 Integration - Example-x402

This repository contains the example circuit implementation for the Lemma x x402 integration demo.

## 📋 Overview

The `example-x402` circuit demonstrates:
- Blog article attribute verification
- Integration with Lemma schemas
- Deployment to Monad Testnet
- Proof generation and verification

## 🔧 Setup

### 1. Environment Configuration

Copy the environment template:
```bash
cp .env.example .env
```

Edit `.env` with your actual credentials:
- `LEMMA_API_KEY` - Your Lemma API key
- `PINATA_API_KEY` - For IPFS uploads (optional)
- `EXAMPLE_VERIFIER_ADDRESS` - Deployed verifier contract

### 2. Circuit Build

Build the example circuit:
```bash
cd packages/circuit
# Run build script (check package.json for exact command)
npm run build
```

Fix G2 encoding bug (required for Ethereum compatibility):
```bash
node scripts/fix-verifier.mjs
```

### 3. Lemma Registration

Register the circuit with Lemma:
```bash
# Using TypeScript script
npx tsx scripts/register-example-x402-final.ts

# Or using JavaScript version
node scripts/register-lemma-artifacts.mjs
```

## 🏗️ Architecture

### Circuit Components
- **Circuit:** `example-circuit` - Blog article attribute verification
- **Schema:** `blog-article-v1` - Already registered on Lemma
- **Verifier:** `0x354cc716ffc02F57Ff7B0bDd465E9C7f12b785E9` - Deployed on Monad Testnet

### File Structure
```
example-x402/
├── packages/
│   ├── circuit/
│   │   ├── circuits/           # Circuit definitions
│   │   ├── scripts/
│   │   │   ├── fix-verifier.mjs  # G2 encoding fix
│   │   │   └── build.sh        # Build script
│   │   └── build/             # Generated artifacts
│   └── normalize/            # Schema normalization
├── scripts/
│   ├── register-example-x402-final.ts  # Lemma registration
│   └── register-lemma-artifacts.mjs    # Legacy registration
├── .env.example              # Environment template
└── INTEGRATION-README.md     # This file
```

## 🔗 Integration with Lemma

### Registered Resources
- **Schema:** `blog-article-v1` (referenced by circuit)
- **Circuit:** `example-circuit-v1.2` (uses actual verifier address)
- **Verifier:** Deployed smart contract on Monad Testnet

### Usage in Applications
```javascript
// Reference the circuit in your application
const circuitConfig = {
  circuitId: 'example-circuit-v1.2',
  schema: 'blog-article-v1',
  verifier: '0x354cc716ffc02F57Ff7B0bDd465E9C7f12b785E9'
};
```

## 🚀 Deployment

### 1. Build Circuit
```bash
cd packages/circuit
./scripts/build.sh
```

### 2. Fix Verifier
```bash
node scripts/fix-verifier.mjs
```

### 3. Deploy Verifier
```bash
# Using Foundry
forge create --rpc-url $RPC_URL \
  --private-key $PRIVATE_KEY \
  build/CircuitVerifier.sol:CircuitVerifier
```

### 4. Register with Lemma
```bash
npx tsx scripts/register-example-x402-final.ts
```

## 🔍 Verification

Check circuit status on Lemma:
```bash
curl -H "Authorization: Bearer $LEMMA_API_KEY" \
  https://api.lemma.oracle.com/api/v1/circuits/example-circuit-v1.2
```

## 📚 Related Repositories

- **`lemmaoracle/lemma`** - Main Lemma repository with passthrough schema
- **`lemmaoracle/example-x402`** - This repository (example circuit)
- **Lemma Documentation** - https://docs.lemma.oracle.com

## 🛠️ Troubleshooting

### Common Issues

1. **G2 Encoding Error**
   - Run `fix-verifier.mjs` after building
   - Required for Ethereum/EVM compatibility

2. **Missing Environment Variables**
   - Ensure `.env` file exists with `LEMMA_API_KEY`

3. **API Registration Failed**
   - Check if circuit already exists (409 conflict)
   - Verify API key has correct permissions

### Debugging
```bash
# Check build artifacts
ls -la packages/circuit/build/

# Test API connectivity
curl -H "Authorization: Bearer $LEMMA_API_KEY" \
  https://api.lemma.oracle.com/api/v1/schemas/blog-article-v1
```

## 📄 License

MIT License - See LICENSE file for details.

## 🤝 Contributing

See CONTRIBUTING.md for development guidelines.

---

**Integration Status:** ✅ Ready for Lemma x x402 demo
**Last Updated:** 2026-04-12
**Version:** 1.2