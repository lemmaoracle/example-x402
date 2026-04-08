# normalize

Rust WASM that converts a raw blog article (rowDoc) into circuit-ready attributes (normDoc).

## Build

```bash
# Requires wasm-pack: curl https://rustwasm.github.io/wasm-pack/installer/init.sh -sSf | sh
pnpm build
```

Output: `pkg/normalize_bg.wasm` + SHA-256 hash

## ABI (for Lemma schemas.register)

```json
{
  "raw": { "title": "string", "author": "string", "body": "string", "publishedAt": "string", "lang": "string" },
  "norm": { "author": "string", "published": "i64", "integrity": "string", "words": "u32", "lang": "string" }
}
```

## Test

```bash
cargo test
```
