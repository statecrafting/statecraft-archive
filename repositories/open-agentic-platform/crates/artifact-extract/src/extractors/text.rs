// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Bartek Kus
// Spec: specs/120-factory-extraction-stage/spec.md — FR-005, FR-006, FR-009

//! Deterministic-text extractor. Mirrors statecraft's
//! `deterministic-text.ts`. Handles `text/plain`, `text/markdown`,
//! `application/json`, `text/csv` — decode bytes as UTF-8 (lossy) and
//! return as `text`. No format-specific parsing.

use crate::{ExtractError, check_size};
use factory_contracts::knowledge::{ExtractionOutput, Extractor};
use serde_json::json;
use std::collections::HashMap;
use std::path::Path;

pub const KIND: &str = "deterministic-text";
pub const VERSION: &str = "1";
pub const MAX_BYTES: u64 = 50 * 1024 * 1024;

pub fn extract(path: &Path, declared_mime: &str) -> Result<ExtractionOutput, ExtractError> {
    let size = check_size(path, MAX_BYTES)?;
    let bytes = std::fs::read(path).map_err(|e| ExtractError::io(path, e))?;
    let text = String::from_utf8_lossy(&bytes).into_owned();
    let line_count = count_lines(&text);

    let mut metadata = HashMap::new();
    metadata.insert("lineCount".into(), json!(line_count));
    metadata.insert("bytesDecoded".into(), json!(size));
    metadata.insert("declaredMime".into(), json!(declared_mime));

    Ok(ExtractionOutput {
        text,
        pages: None,
        language: None,
        outline: None,
        metadata,
        extractor: Extractor {
            kind: KIND.into(),
            version: VERSION.into(),
            agent_run: None,
        },
    })
}

fn count_lines(text: &str) -> u64 {
    text.lines().count() as u64
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use tempfile::NamedTempFile;

    #[test]
    fn plain_text_round_trips() {
        let mut f = NamedTempFile::new().unwrap();
        write!(f, "line one\nline two\n").unwrap();
        let out = extract(f.path(), "text/plain").unwrap();
        assert_eq!(out.text, "line one\nline two\n");
        assert_eq!(out.extractor.kind, KIND);
        assert_eq!(out.extractor.version, VERSION);
        assert!(out.metadata.contains_key("lineCount"));
        assert_eq!(out.metadata.get("declaredMime").unwrap(), "text/plain");
    }

    #[test]
    fn markdown_metadata_records_declared_mime() {
        let mut f = NamedTempFile::new().unwrap();
        write!(f, "# Title\n\nbody").unwrap();
        let out = extract(f.path(), "text/markdown").unwrap();
        assert!(out.text.contains("# Title"));
        assert_eq!(out.metadata.get("declaredMime").unwrap(), "text/markdown");
    }

    #[test]
    fn json_is_returned_as_text_no_special_handling() {
        let mut f = NamedTempFile::new().unwrap();
        write!(f, r#"{{"a":1}}"#).unwrap();
        let out = extract(f.path(), "application/json").unwrap();
        assert_eq!(out.text, r#"{"a":1}"#);
    }

    #[test]
    fn csv_is_returned_as_text() {
        let mut f = NamedTempFile::new().unwrap();
        write!(f, "a,b,c\n1,2,3\n").unwrap();
        let out = extract(f.path(), "text/csv").unwrap();
        assert_eq!(out.text, "a,b,c\n1,2,3\n");
    }

    #[test]
    fn invalid_utf8_is_replaced_not_failed() {
        let mut f = NamedTempFile::new().unwrap();
        f.write_all(&[0x68, 0x69, 0xff, 0xfe]).unwrap();
        let out = extract(f.path(), "text/plain").unwrap();
        assert!(out.text.starts_with("hi"));
        assert!(out.text.contains('\u{FFFD}'));
    }

    #[test]
    fn empty_file_is_typed_error() {
        let f = NamedTempFile::new().unwrap();
        let err = extract(f.path(), "text/plain").unwrap_err();
        assert!(matches!(err, ExtractError::EmptyInput));
    }

    #[test]
    fn oversize_input_is_typed_error() {
        let mut f = NamedTempFile::new().unwrap();
        let big = vec![b'a'; (MAX_BYTES as usize) + 1];
        f.write_all(&big).unwrap();
        let err = extract(f.path(), "text/plain").unwrap_err();
        assert!(matches!(err, ExtractError::TooLarge { .. }));
    }
}
