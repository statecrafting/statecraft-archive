// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Bartek Kus
// Feature: XRAY_ANALYSIS
// Spec: spec/xray/analysis.md

use crate::schema::XrayIndex;
use anyhow::{Context, Result};
use canonical_json::canonicalize_value;

/// Serializes the index to **Canonical JSON** (object keys sorted lexicographically, no extra whitespace).
///
/// Determinism requirements:
/// - All JSON objects MUST have keys sorted (lexicographically).
/// - Arrays MUST already be deterministically ordered by the caller/spec (e.g., files sorted by path).
/// - Output MUST be compact (no pretty-print / no whitespace variance).
///
/// Key sorting is delegated to [`canonical_json::canonicalize_value`], the
/// shared workspace helper that encodes the explicit-ordering principle at
/// the serialization boundary.
pub fn to_canonical_json(index: &XrayIndex) -> Result<Vec<u8>> {
    // Enforce invariants before serialization
    validate_invariants(index)?;

    let value = serde_json::to_value(index).context("Failed to convert index to JSON value")?;
    let canon = canonicalize_value(value);
    serde_json::to_vec(&canon).context("Failed to serialize canonical JSON")
}

/// Validates that the index is sorted correctly and adheres to invariants.
pub fn validate_invariants(index: &XrayIndex) -> Result<()> {
    // 1. Check files are strictly sorted by path
    for (i, window) in index.files.windows(2).enumerate() {
        if window[0].path >= window[1].path {
            if window[0].path == window[1].path {
                anyhow::bail!("Duplicate file path at index {}: {}", i, window[0].path);
            }
            anyhow::bail!(
                "Files not sorted at index {}: {} >= {}",
                i,
                window[0].path,
                window[1].path
            );
        }
    }

    // 2. Check module_files are strictly sorted and unique
    for (i, window) in index.module_files.windows(2).enumerate() {
        if window[0] >= window[1] {
            if window[0] == window[1] {
                anyhow::bail!("Duplicate module file at index {}: {}", i, window[0]);
            }
            anyhow::bail!(
                "Module files not sorted at index {}: {} >= {}",
                i,
                window[0],
                window[1]
            );
        }
    }

    // 3. Stats consistency
    if index.files.len() != index.stats.file_count {
        anyhow::bail!(
            "File count mismatch: files.len()={} vs stats.file_count={}",
            index.files.len(),
            index.stats.file_count
        );
    }

    let computed_size: u64 = index.files.iter().map(|f| f.size).sum();
    if computed_size != index.stats.total_size {
        anyhow::bail!(
            "Total size mismatch: computed={} vs stats.total_size={}",
            computed_size,
            index.stats.total_size
        );
    }

    // 4. Validate Languages Aggregate
    // Map MUST match exactly the counts from the files (excluding "Unknown").
    let mut computed_langs: std::collections::BTreeMap<String, usize> =
        std::collections::BTreeMap::new();
    for f in &index.files {
        if f.lang != "Unknown" {
            *computed_langs.entry(f.lang.clone()).or_insert(0) += 1;
        }
    }
    // Compare computed_langs vs index.languages
    if computed_langs != index.languages {
        anyhow::bail!(
            "Languages aggregate mismatch. Computed from files: {:?}, stored: {:?}",
            computed_langs,
            index.languages
        );
    }

    // 5. Validate Top Dirs Aggregate
    // Map MUST match exactly the counts from the files.
    // Logic: first segment before '/', else "."
    let mut computed_top_dirs: std::collections::BTreeMap<String, usize> =
        std::collections::BTreeMap::new();
    for f in &index.files {
        let top_dir = if let Some(idx) = f.path.find('/') {
            f.path[..idx].to_string()
        } else {
            ".".to_string()
        };
        *computed_top_dirs.entry(top_dir).or_insert(0) += 1;
    }
    if computed_top_dirs != index.top_dirs {
        anyhow::bail!(
            "Top directories aggregate mismatch. Computed from files: {:?}, stored: {:?}",
            computed_top_dirs,
            index.top_dirs
        );
    }

    Ok(())
}
