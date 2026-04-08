//! Lemma normalize WASM for blog-article schema.
//!
//! WASM export signature (required by Lemma SDK):
//!   normalize(raw_json: string) -> string
//!
//! Input  (BlogArticle — raw document):
//!   { "title": "...", "author": "did:...", "body": "...", "publishedAt": "ISO 8601", "lang": "en" }
//!
//! Output (NormArticle — circuit-ready attributes):
//!   { "author": "did:...", "published": 1712534400, "integrity": "ab12…", "words": 1500, "lang": "en" }

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use wasm_bindgen::prelude::*;

// ── Input ──────────────────────────────────────────────────────────

/// Raw blog article document (rowDoc).
#[derive(Deserialize)]
struct BlogArticle {
    #[allow(dead_code)]
    title: String,
    author: String,
    body: String,
    #[serde(rename = "publishedAt")]
    published_at: String,
    lang: String,
}

// ── Output ─────────────────────────────────────────────────────────

/// Normalized article attributes (normDoc).
///
/// These fields map 1:1 to the blog-article-v1 circuit's private inputs
/// and become the verified attributes stored in Lemma after proof verification.
#[derive(Serialize)]
struct NormArticle {
    /// Author identifier (DID or address), passed through unchanged.
    author: String,
    /// Publication timestamp as unix seconds.
    published: i64,
    /// SHA-256 hex digest of the article body (content integrity).
    integrity: String,
    /// Word count of the article body.
    words: u32,
    /// ISO 639-1 language code, passed through unchanged.
    lang: String,
}

// ── Helpers ────────────────────────────────────────────────────────

/// Count whitespace-delimited words.
/// For CJK text (no spaces between words), falls back to character count / 2
/// as a rough approximation.
fn count_words(text: &str) -> u32 {
    let trimmed = text.trim();
    if trimmed.is_empty() {
        return 0;
    }
    let ws_count = trimmed.split_whitespace().count() as u32;
    // If very few whitespace tokens but many characters, likely CJK
    if ws_count <= 2 && trimmed.chars().count() > 20 {
        (trimmed.chars().count() as u32) / 2
    } else {
        ws_count
    }
}

/// SHA-256 hex digest of a string.
fn sha256_hex(input: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(input.as_bytes());
    let result = hasher.finalize();
    result.iter().map(|b| format!("{:02x}", b)).collect()
}

/// Parse a subset of ISO 8601 date-time strings to unix seconds.
///
/// Supports:
///   "2026-04-08T00:00:00Z"
///   "2026-04-08T12:30:00+09:00"
///   "2026-04-08"  (midnight UTC)
///
/// Panics on unparseable input (fail-fast in WASM context).
fn iso_to_unix(iso: &str) -> i64 {
    let s = iso.trim();

    // Extract date part (always YYYY-MM-DD)
    let date_str = &s[..10.min(s.len())];
    let parts: Vec<&str> = date_str.split('-').collect();
    if parts.len() != 3 {
        panic!("normalize: invalid date in publishedAt: {}", iso);
    }
    let year: i64 = parts[0].parse().expect("normalize: invalid year");
    let month: i64 = parts[1].parse().expect("normalize: invalid month");
    let day: i64 = parts[2].parse().expect("normalize: invalid day");

    // Days from year 0 to unix epoch (1970-01-01)
    fn days_from_civil(y: i64, m: i64, d: i64) -> i64 {
        let y = if m <= 2 { y - 1 } else { y };
        let era = if y >= 0 { y } else { y - 399 } / 400;
        let yoe = y - era * 400;
        let doy = (153 * (if m > 2 { m - 3 } else { m + 9 }) + 2) / 5 + d - 1;
        let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
        era * 146097 + doe - 719468
    }

    let epoch_days = days_from_civil(year, month, day);
    let mut secs = epoch_days * 86400;

    // Parse time if present ("T" separator)
    if s.len() > 10 && s.as_bytes().get(10) == Some(&b'T') {
        let time_rest = &s[11..];
        // Extract HH:MM:SS
        let time_str = if time_rest.len() >= 8 {
            &time_rest[..8]
        } else {
            time_rest
        };
        let tp: Vec<&str> = time_str.split(':').collect();
        if tp.len() >= 2 {
            let h: i64 = tp[0].parse().unwrap_or(0);
            let m: i64 = tp[1].parse().unwrap_or(0);
            let s_val: i64 = if tp.len() >= 3 {
                tp[2].parse().unwrap_or(0)
            } else {
                0
            };
            secs += h * 3600 + m * 60 + s_val;
        }

        // Handle timezone offset (after time digits)
        let tz_start = 8.min(time_rest.len());
        let tz_part = time_rest[tz_start..].trim();
        if !tz_part.is_empty() && tz_part != "Z" {
            let sign: i64 = if tz_part.starts_with('-') { 1 } else { -1 };
            let offset_str = &tz_part[1..];
            let offset_parts: Vec<&str> = offset_str.split(':').collect();
            if !offset_parts.is_empty() {
                let oh: i64 = offset_parts[0].parse().unwrap_or(0);
                let om: i64 = if offset_parts.len() > 1 {
                    offset_parts[1].parse().unwrap_or(0)
                } else {
                    0
                };
                secs += sign * (oh * 3600 + om * 60);
            }
        }
    }

    secs
}

// ── Entry point ────────────────────────────────────────────────────

/// Entry point called by Lemma SDK's `define()`.
/// Must be exported as `normalize` and accept/return JSON strings.
///
/// Input:  Blog article JSON string (rowDoc)
/// Output: Normalized article attributes (normDoc)
#[wasm_bindgen]
pub fn normalize(raw_json: &str) -> String {
    let article: BlogArticle =
        serde_json::from_str(raw_json).expect("normalize: invalid blog article JSON input");

    let norm = NormArticle {
        author: article.author,
        published: iso_to_unix(&article.published_at),
        integrity: sha256_hex(&article.body),
        words: count_words(&article.body),
        lang: article.lang,
    };

    serde_json::to_string(&norm).expect("normalize: serialization error")
}

// ── Tests ──────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_english_article() {
        let input = r#"{
            "title": "ZK Proofs Explained",
            "author": "did:example:alice",
            "body": "Zero-knowledge proofs allow one party to prove to another that a statement is true.",
            "publishedAt": "2026-04-01T00:00:00Z",
            "lang": "en"
        }"#;
        let out: serde_json::Value = serde_json::from_str(&normalize(input)).unwrap();
        assert_eq!(out["author"], "did:example:alice");
        assert_eq!(out["published"], 1775001600_i64);
        assert_eq!(out["words"], 14);
        assert_eq!(out["lang"], "en");
        // integrity is a 64-char hex SHA-256
        assert_eq!(out["integrity"].as_str().unwrap().len(), 64);
    }

    #[test]
    fn test_positive_tz_offset() {
        let input = r#"{
            "title": "The Future of Blockchain",
            "author": "did:example:charlie",
            "body": "Blockchain technology has been an internet challenge for years. Traditional payment systems made micropayments too costly.",
            "publishedAt": "2026-04-08T09:00:00+09:00",
            "lang": "ja"
        }"#;
        let out: serde_json::Value = serde_json::from_str(&normalize(input)).unwrap();
        assert_eq!(out["author"], "did:example:charlie");
        // 2026-04-08T09:00:00+09:00 = 2026-04-08T00:00:00Z
        assert_eq!(out["published"], 1775606400_i64);
        assert_eq!(out["lang"], "ja");
        assert_eq!(out["words"], 16);
    }

    #[test]
    fn test_date_only() {
        let input = r#"{
            "title": "Test",
            "author": "did:example:test",
            "body": "hello world",
            "publishedAt": "2026-04-08",
            "lang": "en"
        }"#;
        let out: serde_json::Value = serde_json::from_str(&normalize(input)).unwrap();
        assert_eq!(out["published"], 1775606400_i64);
        assert_eq!(out["words"], 2);
    }

    #[test]
    fn test_integrity_deterministic() {
        let body = "Same content produces same hash.";
        let input = format!(
            r#"{{ "title": "A", "author": "did:x", "body": "{}", "publishedAt": "2026-01-01", "lang": "en" }}"#,
            body
        );
        let out1: serde_json::Value = serde_json::from_str(&normalize(&input)).unwrap();
        let out2: serde_json::Value = serde_json::from_str(&normalize(&input)).unwrap();
        assert_eq!(out1["integrity"], out2["integrity"]);
    }

    #[test]
    fn test_iso_to_unix_basic() {
        assert_eq!(iso_to_unix("1970-01-01T00:00:00Z"), 0);
        assert_eq!(iso_to_unix("2026-04-08T00:00:00Z"), 1775606400);
    }
}
