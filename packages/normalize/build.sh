#!/usr/bin/env bash
# Builds the normalize WASM and outputs SHA-256 hash for Lemma schema registration.
set -euo pipefail

wasm-pack build --target web --out-dir pkg

WASM_FILE="pkg/normalize_bg.wasm"
JS_FILE="pkg/normalize.js"
HASH=$(sha256sum "$WASM_FILE" | awk '{print $1}')

echo ""
echo "✅ WASM build complete"
echo "   WASM   : $WASM_FILE"
echo "   JS shim: $JS_FILE"
echo "   SHA-256: $HASH"
echo ""
echo "Register with Lemma:"
echo "  normalize.artifact.wasm = <upload $WASM_FILE to IPFS or HTTPS>"
echo "  normalize.artifact.js   = <upload $JS_FILE to IPFS or HTTPS>"
echo "  normalize.hash          = 0x$HASH"
