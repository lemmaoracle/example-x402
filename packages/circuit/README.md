# @example-x402/circuit

Circom circuit for blog article attribute commitment.

## `blog-article-v1`

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
pnpm build    # compile → build/blog-article-v1.{r1cs,wasm,sym}
pnpm setup    # trusted setup → build/blog-article-v1.zkey
pnpm export-vkey  # → build/verification_key.json
```

> **Note:** The example ships with pre-compiled artifacts deployed by Lemma.
> You only need to build if you modify the circuit.

## Future extensions

- Range proof on `published` (enforce freshness window)
- Membership proof on `authorHash` (trusted author allowlist)
- Minimum `words` threshold (content depth guarantee)
