// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Bartek Kus
// Feature: XRAY_ANALYSIS
// Spec: spec/xray/analysis.md

use crate::canonical::to_canonical_json;
use crate::schema::XrayIndex;
use anyhow::Result;
use sha2::{Digest, Sha256};

/// Calculates the repository digest.
///
/// The digest is: SHA-256( CanonicalJSON( Index( digest="" ) ) )
///
/// 1. Clone the index.
/// 2. Set digest to empty string.
/// 3. Serialize to canonical JSON.
/// 4. Hash it.
pub fn calculate_digest(index: &XrayIndex) -> Result<String> {
    // Enforce invariants before hashing.
    // The digest MUST certify the validity of the structure.
    // We check invariants on the input index (except digest field which is ignored).
    // Note: checking unique paths, sortedness, etc.
    super::canonical::validate_invariants(index)?;

    let clone = XrayIndex {
        schema_version: index.schema_version.clone(),
        root: index.root.clone(),
        target: index.target.clone(),
        files: index.files.clone(),
        languages: index.languages.clone(), // BTreeMaps are already sorted
        top_dirs: index.top_dirs.clone(),
        module_files: index.module_files.clone(),
        stats: index.stats.clone(),
        digest: "".to_string(), // MUST be empty for calculation
        // Incremental metadata excluded from digest — they describe the scan, not the repo
        prev_digest: None,
        changed_files: None,
        // Analysis metadata excluded from digest — computed separately
        call_graph_summary: None,
        dependencies: None,
        fingerprint: None,
    };

    // Sorting REMOVED. We rely on validate_invariants to ensure it's already sorted.

    let bytes = to_canonical_json(&clone)?;
    let mut hasher = Sha256::new();
    hasher.update(&bytes);
    let result = hasher.finalize();

    Ok(hex::encode(result))
}
