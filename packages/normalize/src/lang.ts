/**
 * ISO 639-1 → numeric code mapping for circuit input.
 *
 * Circom signals are field elements (integers), so language codes need a
 * deterministic numeric representation. We use a compact mapping — only
 * languages likely to appear in the demo are listed; extend as needed.
 */

const LANG_MAP: Readonly<Record<string, number>> = {
  en: 1,
  ja: 2,
  zh: 3,
  ko: 4,
  es: 5,
  fr: 6,
  de: 7,
  pt: 8,
  ru: 9,
  ar: 10,
} as const;

/** Convert an ISO 639-1 code to a numeric field element. Defaults to 0 (unknown). */
export const langToCode = (lang: string): number =>
  LANG_MAP[lang.toLowerCase()] ?? 0;

/** Reverse lookup for display. */
export const codeToLang = (code: number): string =>
  Object.entries(LANG_MAP).find(([, v]) => v === code)?.[0] ?? "unknown";
