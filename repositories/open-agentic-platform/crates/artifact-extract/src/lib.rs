// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Bartek Kus
// Spec: specs/120-factory-extraction-stage/spec.md — FR-005 through FR-009, FR-027

//! Deterministic artifact extraction for the Factory `s-1-extract` stage.
//!
//! Produces typed `factory_contracts::knowledge::ExtractionOutput` from a
//! local file given its declared mime type. The crate is canonical:
//! `crates/factory-engine` consumes it; the legacy flat-`.txt`-with-header
//! pipeline is removed (FR-027).
//!
//! No model client is permitted — anything outside the deterministic
//! predicate set surfaces `ExtractError::RequiresAgent` so the caller can
//! yield to statecraft's spec-115 worker. The lint at `tests/no_llm_deps.rs`
//! enforces FR-007.

pub mod extractors;

use factory_contracts::knowledge::ExtractionOutput;
use std::path::{Path, PathBuf};
use thiserror::Error;

/// Mime types handled by the deterministic-text extractor.
pub const DETERMINISTIC_TEXT_MIMES: &[&str] = &[
    "text/plain",
    "text/markdown",
    "application/json",
    "text/csv",
];

pub const PDF_MIME: &str = "application/pdf";
pub const DOCX_MIME: &str =
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

/// Extract a single file deterministically.
///
/// Dispatches by `mime`. Anything outside the deterministic predicate set
/// returns `RequiresAgent` with a suggested kind.
pub fn extract_deterministic(input: &Path, mime: &str) -> Result<ExtractionOutput, ExtractError> {
    if DETERMINISTIC_TEXT_MIMES.contains(&mime) {
        extractors::text::extract(input, mime)
    } else if mime == PDF_MIME {
        extractors::pdf::extract(input)
    } else if mime == DOCX_MIME {
        extractors::docx::extract(input)
    } else {
        Err(ExtractError::RequiresAgent {
            suggested_kind: suggest_agent_kind(mime),
            reason: format!("mime '{mime}' is not in the deterministic predicate set"),
        })
    }
}

fn suggest_agent_kind(mime: &str) -> String {
    if mime.starts_with("image/") {
        "agent-image-vision".into()
    } else {
        "agent-pdf-vision".into()
    }
}

#[derive(Debug, Error)]
pub enum ExtractError {
    #[error("requires agent extraction (kind={suggested_kind}): {reason}")]
    RequiresAgent {
        suggested_kind: String,
        reason: String,
    },
    #[error("input larger than {limit} bytes (actual={actual})")]
    TooLarge { limit: u64, actual: u64 },
    #[error("input file is empty")]
    EmptyInput,
    #[error("io error on {0}: {1}")]
    Io(PathBuf, #[source] std::io::Error),
    #[error("parse error in {extractor}: {reason}")]
    Parse { extractor: String, reason: String },
}

impl ExtractError {
    pub(crate) fn io(path: &Path, e: std::io::Error) -> Self {
        Self::Io(path.to_path_buf(), e)
    }
    pub(crate) fn parse(extractor: &str, reason: impl Into<String>) -> Self {
        Self::Parse {
            extractor: extractor.into(),
            reason: reason.into(),
        }
    }
}

pub(crate) fn check_size(path: &Path, limit: u64) -> Result<u64, ExtractError> {
    let meta = std::fs::metadata(path).map_err(|e| ExtractError::io(path, e))?;
    let actual = meta.len();
    if actual > limit {
        return Err(ExtractError::TooLarge { limit, actual });
    }
    if actual == 0 {
        return Err(ExtractError::EmptyInput);
    }
    Ok(actual)
}
