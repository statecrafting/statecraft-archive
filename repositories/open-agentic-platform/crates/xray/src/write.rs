// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Bartek Kus
// Feature: XRAY_ANALYSIS
// Spec: spec/xray/analysis.md

use anyhow::{Context, Result};
use std::fs;
use std::io::Write;
use std::path::Path;

/// Atomically writes content to a file.
///
/// 1. Writes to path.tmp
/// 2. Renames path.tmp -> path
pub fn write_atomic(path: &Path, content: &[u8]) -> Result<()> {
    // Write to temp
    // Use `tempfile` crate to handle unique naming automatically.
    // Pattern: <filename>.tmp.<random> in the same directory.
    let dir = path.parent().unwrap_or_else(|| Path::new("."));
    fs::create_dir_all(dir).context("Failed to create parent directory")?;

    let mut temp = tempfile::Builder::new()
        .prefix(&format!(
            "{}.",
            path.file_name().unwrap_or_default().to_string_lossy()
        ))
        .suffix(".tmp")
        .tempfile_in(dir)
        .context("Failed to create temp file")?;

    temp.write_all(content)
        .context("Failed to write content to temp file")?;
    temp.flush().context("Failed to sync temp file")?;

    // Persist (Atomic Rename)
    temp.persist(path).context("Failed to persist file")?;

    Ok(())
}
