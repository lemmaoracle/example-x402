#!/usr/bin/env bash
# Compile circuit → trusted setup → export verifier contract
set -euo pipefail

CIRCUIT="circuits/circuit.circom"
BUILD_DIR="build"
PTAU="build/pot14_final.ptau"
LIBS_DIR="$BUILD_DIR/libs"

mkdir -p "$BUILD_DIR"

# circom2 (WASM) cannot follow symlinks, which breaks with pnpm's symlinked
# node_modules. Copy circomlib into the build directory as real files.
rm -rf "$LIBS_DIR"
mkdir -p "$LIBS_DIR"
cp -rL node_modules/circomlib "$LIBS_DIR/circomlib"

echo "1/5  Compiling circuit..."
npx circom2 "$CIRCUIT" --r1cs --wasm --sym -o "$BUILD_DIR" -l "$LIBS_DIR"

echo "2/5  Downloading Powers of Tau (Hermez, 14)..."
if [ ! -f "$PTAU" ]; then
  curl -L -o "$PTAU" \
    "https://storage.googleapis.com/zkevm/ptau/powersOfTau28_hez_final_14.ptau"
fi

echo "3/5  Groth16 setup..."
npx snarkjs groth16 setup \
  "$BUILD_DIR/circuit.r1cs" \
  "$PTAU" \
  "$BUILD_DIR/circuit_0000.zkey"

echo "4/5  Contributing to phase 2 (demo only — not secure for production)..."
echo "demo_entropy_mizu_dako_2026" | npx snarkjs zkey contribute \
  "$BUILD_DIR/circuit_0000.zkey" \
  "$BUILD_DIR/circuit_final.zkey" \
  --name="Demo contribution" -v

echo "5/5  Exporting verification key and Solidity verifier..."
# Export verification key (for off-chain verification)
npx snarkjs zkey export verificationkey \
  "$BUILD_DIR/circuit_final.zkey" \
  "$BUILD_DIR/verification_key.json"

# Export Solidity verifier contract
npx snarkjs zkey export solidityverifier \
  "$BUILD_DIR/circuit_final.zkey" \
  "$BUILD_DIR/CircuitVerifier.sol"

echo ""
echo "✅ Build complete"
echo "   WASM : $BUILD_DIR/circuit_js/circuit.wasm"
echo "   zkey : $BUILD_DIR/circuit_final.zkey"
echo "   Verification key: $BUILD_DIR/verification_key.json"
echo "   Verifier contract: $BUILD_DIR/CircuitVerifier.sol"
echo ""
echo "Upload wasm + zkey to IPFS and register with:"
echo "  circuits.register(client, { circuitId: 'circuit', ... })"