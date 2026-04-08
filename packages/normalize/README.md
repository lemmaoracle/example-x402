# normalize

Blog article rowDoc → normDoc 変換 WASM (Rust)。

## ビルド

```bash
# wasm-pack が必要: curl https://rustwasm.github.io/wasm-pack/installer/init.sh -sSf | sh
pnpm build
```

出力: `pkg/normalize_bg.wasm` + SHA-256 ハッシュ

## abi (Lemma schemas.register 用)

```json
{
  "raw": { "title": "string", "author": "string", "body": "string", "publishedAt": "string", "lang": "string" },
  "norm": { "author": "string", "published": "i64", "integrity": "string", "words": "u32", "lang": "string" }
}
```

## テスト

```bash
cargo test
```
