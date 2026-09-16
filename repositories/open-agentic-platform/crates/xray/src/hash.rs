// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Bartek Kus
// Feature: XRAY_ANALYSIS
// Spec: spec/xray/analysis.md

use anyhow::{Context, Result};
use sha2::{Digest, Sha256};
use std::fs::File;
use std::io::{BufReader, Read};
use std::path::Path;

/// Computes the SHA-256 hash of a file.
/// Returns "sha256:<hex>" string.
/// If file cannot be read, returns error (caller handles fallback/skip).
pub fn compute_file_hash(path: &Path) -> Result<String> {
    let file = File::open(path).context("Failed to open file for hashing")?;
    let mut reader = BufReader::new(file);
    let mut hasher = Sha256::new();
    let mut buffer = [0; 8192];

    loop {
        let count = reader
            .read(&mut buffer)
            .context("Failed to read file for hashing")?;
        if count == 0 {
            break;
        }
        hasher.update(&buffer[..count]);
    }

    let result = hasher.finalize();
    Ok(format!("sha256:{}", hex::encode(result)))
}
