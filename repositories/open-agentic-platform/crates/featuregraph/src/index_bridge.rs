// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Bartek Kus
// Spec: specs/102-governed-excellence/spec.md (FR-021, FR-022)

//! Bridge from the committed codebase index to featuregraph's `FeatureGraph`.
//!
//! FR-021: The codebase index is the single authoritative source of structural
//! spec-to-code traceability. This module reads its output to populate
//! FeatureGraph rather than performing independent source-file scanning.
//!
//! FR-022: The `// Feature:` header convention becomes optional enrichment;
//! this index-based path is the primary traceability source.
//!
//! Spec 217 engine swap: previously this module declared its own private
//! `CodebaseIndex` / `Traceability` / `TraceMapping` mirror structs and
//! deserialized the monolithic `.derived/codebase-index/index.json`. It now
//! reads the committed sharded index (`.derived/codebase-index/by-spec`,
//! `by-package`) through [`spec_spine_core::load_committed_index`] and consumes
//! the library's [`spec_spine_types::Traceability`] directly.
//!
//! Granularity note: the library resolves ownership edges to **file-level**
//! paths (e.g. `crates/factory-engine/src/lib.rs`) where the in-tree indexer
//! emitted **directory-level** paths (`crates/factory-engine`). `impl_files`
//! therefore carries finer paths after the swap.

use crate::graph::FeatureNode;
use spec_spine_core::load_committed_index;
use std::collections::HashMap;
use std::path::Path;

/// Load traceability mappings from the committed codebase index and produce
/// `FeatureNode` entries.
///
/// Returns a map of spec_id -> FeatureNode with `impl_files` populated from the
/// index. The caller can merge these with any scanner-derived enrichment.
pub fn load_from_index(repo_root: &Path) -> Result<HashMap<String, FeatureNode>, String> {
    let cfg = crate::load_spec_spine_config(repo_root);
    let index = load_committed_index(&cfg, repo_root).map_err(|e| format!("{e}"))?;

    let mut nodes = HashMap::new();

    for mapping in &index.traceability.mappings {
        let impl_files: Vec<String> = mapping
            .implementing_paths
            .iter()
            .map(|p| p.path.clone())
            .collect();

        let node = FeatureNode {
            feature_id: mapping.spec_id.clone(),
            title: String::new(), // populated from registry if needed
            spec_path: format!("specs/{}/spec.md", mapping.spec_id),
            // Library `spec_status` is `Option<String>`; featuregraph stores a
            // bare string (empty when absent).
            status: mapping.spec_status.clone().unwrap_or_default(),
            implementation: String::new(),
            governance: String::new(),
            owner: String::new(),
            group: String::new(),
            depends_on: mapping.depends_on.clone(),
            impl_files,
            test_files: Vec::new(),
            violations: Vec::new(),
        };

        nodes.insert(mapping.spec_id.clone(), node);
    }

    Ok(nodes)
}

/// Get orphaned specs and untraced code paths from the committed index.
pub fn load_diagnostics(repo_root: &Path) -> Result<(Vec<String>, Vec<String>), String> {
    let cfg = crate::load_spec_spine_config(repo_root);
    let index = load_committed_index(&cfg, repo_root).map_err(|e| format!("{e}"))?;

    Ok((
        index.traceability.orphaned_specs,
        index.traceability.untraced_code,
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Repo root, resolved from the crate manifest so the test is independent
    /// of cargo's working directory.
    fn repo_root() -> std::path::PathBuf {
        Path::new(env!("CARGO_MANIFEST_DIR")).join("../..")
    }

    /// Real-corpus seam test (spec 217): read OAP's committed index shards
    /// through the library and confirm the traceability section maps cleanly
    /// onto `FeatureNode`. Skips when shards are absent.
    #[test]
    fn load_from_committed_index() {
        let root = repo_root();
        if !root.join(".derived/codebase-index/by-spec").is_dir() {
            return;
        }

        let nodes = load_from_index(&root).unwrap();
        assert!(!nodes.is_empty(), "expected traceability mappings");

        let node = nodes
            .get("102-governed-excellence")
            .expect("spec 102 mapped in the index");
        assert!(!node.impl_files.is_empty());
        // Granularity: library emits file-level paths; assert by prefix rather
        // than the exact directory string the in-tree indexer used to emit.
        assert!(
            node.impl_files
                .iter()
                .any(|p| p.starts_with("crates/factory-engine")),
            "expected a factory-engine path, got {:?}",
            node.impl_files
        );
    }

    /// Diagnostics (orphaned specs / untraced code) load through the library.
    #[test]
    fn load_diagnostics_from_committed_index() {
        let root = repo_root();
        if !root.join(".derived/codebase-index/by-spec").is_dir() {
            return;
        }

        // Counts are corpus-dependent; this exercises the shape and the read
        // path without pinning a brittle number.
        let (_orphaned, _untraced) = load_diagnostics(&root).unwrap();
    }
}
