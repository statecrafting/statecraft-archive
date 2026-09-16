// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Bartek Kus
// Feature: XRAY_ANALYSIS
// Spec: spec/xray/analysis.md

use anyhow::{Context, Result};
use std::path::{Path, PathBuf};

// Export modules so they can be used
pub mod analysis;
pub mod canonical;
pub mod context;
pub mod digest;
pub mod docs;
pub mod fingerprint;
pub mod hash;
pub mod history;
pub mod language;
pub mod loc;
pub mod policy;
pub mod schema;
pub mod tools;
pub mod traversal;
pub mod write;

#[cfg(test)]
mod invariant_tests;

// Re-export key structs
pub use docs::DocsGenerator;
pub use schema::XrayIndex;

/// Run an incremental scan comparing against a previous index.
/// Files whose hash matches the previous scan are reused without re-analysis.
pub fn scan_target_incremental(
    target: &Path,
    output: Option<PathBuf>,
    previous: &Path,
) -> Result<XrayIndex> {
    use std::collections::HashMap;

    // Load previous index
    let prev_bytes = std::fs::read(previous)
        .with_context(|| format!("Failed to read previous index: {}", previous.display()))?;
    let prev_index: XrayIndex =
        serde_json::from_slice(&prev_bytes).context("Failed to parse previous index JSON")?;

    // Build lookup: path → FileNode from previous scan
    let prev_map: HashMap<String, &schema::FileNode> = prev_index
        .files
        .iter()
        .map(|f| (f.path.clone(), f))
        .collect();

    // Run current scan (gets fresh hashes for all files)
    let scan_result = traversal::scan_target(target)?;

    // Diff: find changed files
    let current_paths: std::collections::HashSet<String> =
        scan_result.files.iter().map(|f| f.path.clone()).collect();
    let prev_paths: std::collections::HashSet<String> =
        prev_index.files.iter().map(|f| f.path.clone()).collect();

    let mut changed = Vec::new();

    // New or modified files
    for f in &scan_result.files {
        match prev_map.get(&f.path) {
            Some(prev_f) if prev_f.hash == f.hash && prev_f.size == f.size => {
                // Unchanged — not added to changed list
            }
            _ => {
                changed.push(f.path.clone());
            }
        }
    }

    // Deleted files (in prev but not in current)
    for path in &prev_paths {
        if !current_paths.contains(path) {
            changed.push(path.clone());
        }
    }

    changed.sort();

    let repo_slug = target
        .file_name()
        .unwrap_or_default()
        .to_string_lossy()
        .to_string();

    let mut index = XrayIndex {
        root: repo_slug,
        target: target.to_string_lossy().to_string(),
        files: scan_result.files,
        stats: scan_result.stats,
        languages: scan_result.languages,
        top_dirs: scan_result.top_dirs,
        module_files: scan_result.module_files,
        prev_digest: Some(prev_index.digest.clone()),
        changed_files: Some(changed),
        ..Default::default()
    };

    let digest_str = digest::calculate_digest(&index)?;
    index.digest = digest_str;

    let bytes = canonical::to_canonical_json(&index)?;

    if let Some(ref out_dir) = output {
        let out_file = out_dir.join("index.json");
        write::write_atomic(&out_file, &bytes)?;
        // Append to history
        let history_file = out_dir.join("history.jsonl");
        history::append_history(&history_file, &index)?;
        println!("XRAY incremental scan complete. Digest: {}", index.digest);
        println!(
            "Changed files: {}",
            index.changed_files.as_ref().map_or(0, |c| c.len())
        );
        println!("Written to: {}", out_file.display());
    }

    Ok(index)
}

/// Run a complete scan sequence on a target directory
pub fn scan_target(target: &Path, output: Option<PathBuf>) -> Result<XrayIndex> {
    let repo_slug = target
        .file_name()
        .unwrap_or_default()
        .to_string_lossy()
        .to_string();

    // 1. Scan Target
    let scan_result = traversal::scan_target(target)?;

    // 2. Build Index
    let mut index = XrayIndex {
        root: repo_slug.clone(),
        target: target.to_string_lossy().to_string(),
        files: scan_result.files,
        stats: scan_result.stats,
        languages: scan_result.languages,
        top_dirs: scan_result.top_dirs,
        module_files: scan_result.module_files,
        ..Default::default()
    };

    // 3. Compute digest
    let digest_str = digest::calculate_digest(&index)?;
    index.digest = digest_str;

    // 4. Serialize (validation step)
    let bytes = canonical::to_canonical_json(&index)?;

    // 5. Determine output path and write if requested
    if let Some(ref out_dir) = output {
        let out_file = out_dir.join("index.json");
        write::write_atomic(&out_file, &bytes)?;
        // Append to history
        let history_file = out_dir.join("history.jsonl");
        history::append_history(&history_file, &index)?;
        println!("XRAY scan complete. Digest: {}", index.digest);
        println!("Written to: {}", out_file.display());
    }

    Ok(index)
}
