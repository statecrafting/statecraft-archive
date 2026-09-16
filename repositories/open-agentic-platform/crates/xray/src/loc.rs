// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Bartek Kus
// Feature: XRAY_ANALYSIS
// Spec: spec/xray/analysis.md

use anyhow::{Context, Result};
use std::fs::File;
use std::io::{BufReader, Read};
use std::path::Path;

pub const LOC_BIG_FILE_CAP_BYTES: u64 = 2 * 1024 * 1024; // 2MB

#[derive(Debug, PartialEq, Eq)]
pub struct LocStats {
    pub loc: u64,
    pub size: u64,
    pub skipped: bool,
}

/// Computes LOC Stats for a given file path.
///
/// Rules:
/// - If file > 2MB, return skipped=true, loc=0.
/// - If file content is not valid UTF-8, return skipped=true, loc=0.
/// - Count newlines.
pub fn compute_loc(path: &Path) -> Result<LocStats> {
    let metadata = std::fs::metadata(path).context("Failed to get file metadata")?;
    let size = metadata.len();

    if size > LOC_BIG_FILE_CAP_BYTES {
        return Ok(LocStats {
            loc: 0,
            size,
            skipped: true,
        });
    }

    if size == 0 {
        return Ok(LocStats {
            loc: 0,
            size: 0,
            skipped: false,
        });
    }

    let file = File::open(path).context("Failed to open file")?;
    let mut reader = BufReader::new(file);
    let mut content = Vec::new();

    // Read all to check UTF-8 validitity and simplicity.
    // For 2MB max, reading into memory is acceptable and safer for UTF-8 check.
    reader
        .read_to_end(&mut content)
        .context("Failed to read file content")?;

    match String::from_utf8(content) {
        Ok(text) => {
            // Count lines.
            // We count lines as number of lines with content, or just newlines?
            // "Standard" `wc -l` counts newlines.
            // If the last line has no newline, it might not be counted by some tools.
            // Let's adopt a standard: count split by '\n'.
            // Actually, `.lines()` in Rust iterates over lines.
            // Empty string "" has 0 lines.
            // "a" has 1 line.
            // "a\n" has 1 line? or 2?
            // "a\nb" has 2 lines.

            // We use `lines().count()` which counts lines *terminated* or *separated* by \n.
            // Edge cases:
            // "a\n" -> 1 line
            // "a" -> 1 line
            // "" -> 0 lines
            // "a\nb" -> 2 lines
            // This is "Logical Lines", distinct from POSIX `wc -l` which counts newlines.
            // This behavior is LOCKED for XRAY determinism.
            let loc = text.lines().count() as u64;

            // Re-verify edge case:
            // "a\n" -> lines() yields ["a"]. count = 1.
            // "a"   -> lines() yields ["a"]. count = 1.
            // ""    -> lines() yields []. count = 0.
            // This seems reasonable for "Loc".

            Ok(LocStats {
                loc,
                size,
                skipped: false,
            })
        }
        Err(_) => {
            // Invalid UTF-8
            Ok(LocStats {
                loc: 0,
                size,
                skipped: true,
            })
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use tempfile::NamedTempFile;

    #[test]
    fn test_empty_file() {
        let file = NamedTempFile::new().unwrap();
        let stats = compute_loc(file.path()).unwrap();
        assert_eq!(stats.loc, 0);
        assert!(!stats.skipped);
    }

    #[test]
    fn test_normal_file() {
        let mut file = NamedTempFile::new().unwrap();
        writeln!(file, "line1").unwrap();
        writeln!(file, "line2").unwrap();
        let stats = compute_loc(file.path()).unwrap();
        assert_eq!(stats.loc, 2);
    }

    #[test]
    fn test_no_trailing_newline() {
        let mut file = NamedTempFile::new().unwrap();
        write!(file, "line1\nline2").unwrap(); // 2 lines
        let stats = compute_loc(file.path()).unwrap();
        assert_eq!(stats.loc, 2);
    }

    #[test]
    fn test_single_line_no_newline() {
        let mut file = NamedTempFile::new().unwrap();
        write!(file, "line1").unwrap(); // 1 line
        let stats = compute_loc(file.path()).unwrap();
        assert_eq!(stats.loc, 1);
    }

    #[test]
    fn test_crlf_normalization() {
        let mut file = NamedTempFile::new().unwrap();
        write!(file, "line1\r\nline2").unwrap();
        let stats = compute_loc(file.path()).unwrap();
        assert_eq!(stats.loc, 2);
    }

    #[test]
    fn test_binary_skipped() {
        let mut file = NamedTempFile::new().unwrap();
        // invalid utf8 sequence
        file.write_all(&[0, 159, 146, 150]).unwrap();
        let stats = compute_loc(file.path()).unwrap();
        assert!(stats.skipped);
        assert_eq!(stats.loc, 0);
    }

    #[test]
    fn test_large_file_skipped() {
        let mut file = NamedTempFile::new().unwrap();
        let big_data = vec![b'a'; (LOC_BIG_FILE_CAP_BYTES + 1) as usize];
        file.write_all(&big_data).unwrap();
        let stats = compute_loc(file.path()).unwrap();
        assert!(stats.skipped);
        assert_eq!(stats.loc, 0);
    }
}
