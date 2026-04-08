/**
 * Normalize a raw blog article (rowDoc) into circuit-ready field elements (normDoc).
 *
 * The normDoc is a 5-element array matching the private inputs of the
 * blog-article-v1 Circom circuit, plus the derived public commitment.
 *
 * Production note: this module can be compiled to WASM (via assemblyscript
 * or wasm-pack) for use inside Cloudflare Workers or browser environments.
 * The TypeScript version here is the reference implementation.
 */

// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — circomlibjs ships without proper type declarations
import { buildPoseidon } from "circomlibjs";
import { langToCode } from "./lang.js";

export { langToCode, codeToLang } from "./lang.js";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

/** Raw blog article — the input document before normalization. */
export type RowDoc = Readonly<{
  /** Article title. */
  title: string;
  /** Author identifier (DID, address, or handle). */
  author: string;
  /** Full article body text. */
  body: string;
  /** ISO 8601 publication date (e.g. "2026-04-08T00:00:00Z"). */
  publishedAt: string;
  /** ISO 639-1 language code (e.g. "en", "ja"). */
  lang: string;
}>;

/** Normalized document — circuit-ready field elements. */
export type NormDoc = Readonly<{
  /** poseidon(utf8(author)) */
  authorHash: bigint;
  /** Unix timestamp in seconds. */
  published: bigint;
  /** poseidon(utf8(body)) */
  integrityHash: bigint;
  /** Word count of the body. */
  words: bigint;
  /** Numeric ISO 639-1 code. */
  langCode: bigint;
  /** poseidon(authorHash, published, integrityHash, words, langCode) */
  commitment: bigint;
}>;

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

/** Count words in a string (split on whitespace). */
const countWords = (text: string): number =>
  text.trim().split(/\s+/).filter(Boolean).length;

/** Convert a UTF-8 string to a bigint array for Poseidon (one element). */
const utf8ToBigInt = (s: string): bigint =>
  BigInt("0x" + Buffer.from(s, "utf-8").toString("hex"));

/* ------------------------------------------------------------------ */
/*  Poseidon singleton                                                 */
/* ------------------------------------------------------------------ */

type PoseidonFn = (inputs: bigint[]) => Uint8Array;
type PoseidonModule = { F: { toObject: (v: Uint8Array) => bigint } };

let _poseidon: PoseidonFn | null = null;
let _F: PoseidonModule["F"] | null = null;

const getPoseidon = async (): Promise<{
  hash: (...inputs: bigint[]) => bigint;
}> => {
  if (!_poseidon) {
    const mod = (await buildPoseidon()) as PoseidonFn & PoseidonModule;
    _poseidon = mod;
    _F = mod.F;
  }
  return {
    hash: (...inputs: bigint[]): bigint =>
      _F!.toObject(_poseidon!(inputs)),
  };
};

/* ------------------------------------------------------------------ */
/*  Core: normalize                                                    */
/* ------------------------------------------------------------------ */

/**
 * Convert a raw blog article into a normalized document with Poseidon hashes.
 *
 * The returned `NormDoc` fields map 1:1 to the `blog-article-v1` circuit:
 *   - private inputs: authorHash, published, integrityHash, words, langCode
 *   - public input:   commitment
 */
export const normalize = async (row: RowDoc): Promise<NormDoc> => {
  const poseidon = await getPoseidon();

  const authorHash = poseidon.hash(utf8ToBigInt(row.author));
  const published = BigInt(Math.floor(new Date(row.publishedAt).getTime() / 1000));
  const integrityHash = poseidon.hash(utf8ToBigInt(row.body));
  const words = BigInt(countWords(row.body));
  const langCode = BigInt(langToCode(row.lang));

  const commitment = poseidon.hash(
    authorHash,
    published,
    integrityHash,
    words,
    langCode,
  );

  return {
    authorHash,
    published,
    integrityHash,
    words,
    langCode,
    commitment,
  };
};

/**
 * Convert a NormDoc to a flat array of string-encoded field elements,
 * suitable for circuit input JSON or Lemma's `inputs` field.
 *
 * Order: [authorHash, published, integrityHash, words, langCode, commitment]
 */
export const toInputs = (norm: NormDoc): ReadonlyArray<string> => [
  norm.authorHash.toString(),
  norm.published.toString(),
  norm.integrityHash.toString(),
  norm.words.toString(),
  norm.langCode.toString(),
  norm.commitment.toString(),
];
