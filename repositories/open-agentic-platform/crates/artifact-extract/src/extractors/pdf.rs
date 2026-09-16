// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Bartek Kus
// Spec: specs/120-factory-extraction-stage/spec.md — FR-005, FR-006, FR-009

//! Deterministic embedded-text PDF extractor. Mirrors statecraft's
//! `deterministic-pdf-embedded.ts`.
//!
//! Below the per-page median text density threshold the extractor returns
//! `RequiresAgent { suggested_kind: "agent-pdf-vision" }` so the stage can
//! yield to the spec-115 worker; OPC never invokes a model itself.

use crate::{ExtractError, check_size};
use factory_contracts::knowledge::{ExtractionOutput, ExtractionPage, Extractor};
use serde_json::json;
use std::collections::HashMap;
use std::path::Path;

pub const KIND: &str = "deterministic-pdf-embedded";
pub const VERSION: &str = "1";
pub const MAX_BYTES: u64 = 200 * 1024 * 1024;
const DEFAULT_MIN_MEDIAN_CHARS: u64 = 80;
const PDF_FORM_FEED: char = '\u{C}';

fn min_median_chars() -> u64 {
    std::env::var("STATECRAFT_EXTRACT_PDF_MIN_MEDIAN_CHARS")
        .ok()
        .and_then(|v| v.parse::<u64>().ok())
        .unwrap_or(DEFAULT_MIN_MEDIAN_CHARS)
}

pub fn extract(path: &Path) -> Result<ExtractionOutput, ExtractError> {
    check_size(path, MAX_BYTES)?;
    let bytes = std::fs::read(path).map_err(|e| ExtractError::io(path, e))?;
    let raw = pdf_extract::extract_text_from_mem(&bytes)
        .map_err(|e| ExtractError::parse(KIND, format!("pdf-extract: {e}")))?;

    let pages = split_pages(&raw);
    let trimmed_lengths: Vec<u64> = pages
        .iter()
        .map(|p| p.text.trim().chars().count() as u64)
        .collect();
    let median = median_u64(&trimmed_lengths);
    let threshold = min_median_chars();

    if median < threshold {
        return Err(ExtractError::RequiresAgent {
            suggested_kind: "agent-pdf-vision".into(),
            reason: format!(
                "embedded-text PDF median {median} chars/page < threshold {threshold}; route to agent vision"
            ),
        });
    }

    let mut metadata = HashMap::new();
    metadata.insert("pageCount".into(), json!(pages.len()));
    metadata.insert("medianPageChars".into(), json!(median));

    let language = detect_language(&raw);
    let body = raw.trim().to_string();

    Ok(ExtractionOutput {
        text: body,
        pages: Some(pages),
        language,
        outline: Some(Vec::new()),
        metadata,
        extractor: Extractor {
            kind: KIND.into(),
            version: VERSION.into(),
            agent_run: None,
        },
    })
}

fn split_pages(raw: &str) -> Vec<ExtractionPage> {
    let chunks: Vec<&str> = raw.split(PDF_FORM_FEED).collect();
    let last = chunks.len().saturating_sub(1);
    chunks
        .into_iter()
        .enumerate()
        .filter_map(|(i, t)| {
            let trimmed_end = t.trim_end_matches('\n');
            if i == last && trimmed_end.is_empty() {
                None
            } else {
                Some(ExtractionPage {
                    index: i as u64,
                    text: trimmed_end.to_string(),
                    bbox: None,
                })
            }
        })
        .collect()
}

fn median_u64(values: &[u64]) -> u64 {
    if values.is_empty() {
        return 0;
    }
    let mut sorted = values.to_vec();
    sorted.sort_unstable();
    let mid = sorted.len() / 2;
    if sorted.len().is_multiple_of(2) {
        (sorted[mid - 1] + sorted[mid]) / 2
    } else {
        sorted[mid]
    }
}

const STOPWORDS: &[(&str, &[&str])] = &[
    ("en", &["the", "and", "of", "to", "in", "is", "that", "it", "for", "with"]),
    ("fr", &["le", "la", "les", "de", "et", "à", "un", "une", "des", "que"]),
    ("es", &["el", "la", "los", "las", "de", "que", "y", "en", "un", "una"]),
    ("de", &["der", "die", "das", "und", "ist", "in", "ein", "zu", "den", "von"]),
    ("it", &["il", "la", "di", "che", "è", "e", "un", "una", "per", "non"]),
    ("pt", &["o", "a", "de", "que", "e", "do", "da", "em", "um", "para"]),
    ("nl", &["de", "het", "een", "van", "en", "in", "is", "op", "dat", "te"]),
    ("pl", &["i", "w", "na", "z", "do", "że", "jest", "się", "to", "nie"]),
];

fn detect_language(text: &str) -> Option<String> {
    let sample: String = text.chars().take(4000).collect::<String>().to_lowercase();
    let token_count = sample.split_whitespace().count();
    if token_count < 30 {
        return None;
    }
    let mut best: Option<(&str, usize)> = None;
    for (lang, words) in STOPWORDS {
        let mut score = 0;
        for w in *words {
            score += count_word_occurrences(&sample, w);
        }
        match best {
            Some((_, prev)) if score <= prev => {}
            _ => best = Some((lang, score)),
        }
    }
    best.filter(|(_, s)| *s > 0).map(|(l, _)| l.to_string())
}

fn count_word_occurrences(haystack: &str, needle: &str) -> usize {
    let mut count = 0;
    for tok in haystack.split(|c: char| !c.is_alphabetic()) {
        if tok == needle {
            count += 1;
        }
    }
    count
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn median_handles_even_and_odd() {
        assert_eq!(median_u64(&[]), 0);
        assert_eq!(median_u64(&[5]), 5);
        assert_eq!(median_u64(&[1, 2, 3]), 2);
        assert_eq!(median_u64(&[1, 2, 3, 4]), 2); // (2+3)/2 = 2 in integer math
    }

    #[test]
    fn split_pages_uses_form_feed_separator() {
        let raw = "page1\u{C}page2\u{C}page3";
        let pages = split_pages(raw);
        assert_eq!(pages.len(), 3);
        assert_eq!(pages[0].text, "page1");
        assert_eq!(pages[1].index, 1);
        assert_eq!(pages[2].text, "page3");
    }

    #[test]
    fn split_pages_drops_trailing_empty_form_feed() {
        let raw = "page1\u{C}";
        let pages = split_pages(raw);
        assert_eq!(pages.len(), 1);
    }

    #[test]
    fn detect_language_returns_none_for_short_input() {
        assert!(detect_language("only seven words here for testing now").is_none());
    }
}
