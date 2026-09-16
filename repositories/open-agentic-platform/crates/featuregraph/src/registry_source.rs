// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Bartek Kus
// Feature: FEATUREGRAPH_REGISTRY

//! Load feature manifest entries from the **committed spec registry**.
//!
//! Spec 217 engine swap: this module previously parsed the monolithic
//! `.derived/spec-registry/registry.json` through the former in-tree typed
//! reader. It now reads the committed
//! sharded registry (`.derived/spec-registry/by-spec/*.json`) through the
//! published library's [`spec_spine_core::load_committed_registry`], returning
//! [`spec_spine_types::SpecRecord`]s directly.
//!
//! Field mapping for featuregraph's consumers (see
//! [`crate::scanner::FeatureEntry::from_registry_record`]): the production
//! scanner reads `id`, `title`, `status`, `spec_path`, `risk`, `owner`,
//! `implementation`, `depends_on`, and `code_aliases` -- all present on
//! `SpecRecord`. The legacy `implements:` field is gone from the library
//! (replaced by the eight typed relationship edges); featuregraph never read
//! it in production (traceability comes from the codebase index, see
//! [`crate::index_bridge`]).

use spec_spine_types::SpecRecord;
use std::path::Path;

/// Adapter alias for the typed spec record. Was `srr::Feature`; now the
/// library's `SpecRecord` (spec 217 engine swap).
pub type RegistryFeatureRecord = SpecRecord;

/// Assemble the committed registry shards under `repo_root` and return the spec
/// records (sorted by id for determinism). Delegates to
/// [`spec_spine_core::load_committed_registry`]; errors map to `anyhow::Error`
/// to keep the existing call sites unchanged.
pub fn load_registry_records(repo_root: &Path) -> anyhow::Result<Vec<SpecRecord>> {
    let cfg = crate::load_spec_spine_config(repo_root);
    let registry = spec_spine_core::load_committed_registry(&cfg, repo_root)
        .map_err(|e| anyhow::anyhow!("{e}"))?;
    let mut specs = registry.specs;
    specs.sort_by(|a, b| a.id.cmp(&b.id));
    Ok(specs)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Repo root, resolved from the crate manifest so the test is independent
    /// of cargo's working directory.
    fn repo_root() -> std::path::PathBuf {
        Path::new(env!("CARGO_MANIFEST_DIR")).join("../..")
    }

    /// Real-corpus seam test (spec 217): read OAP's committed registry shards
    /// through the library and confirm the records carry every field
    /// featuregraph's scanner consumes. Skips when shards are absent (e.g. a
    /// fresh clone before `spec-spine compile`).
    #[test]
    fn loads_committed_registry_from_repo_root() {
        let root = repo_root();
        if !root.join(".derived/spec-registry/by-spec").is_dir() {
            return;
        }

        let records = load_registry_records(&root).unwrap();
        assert!(
            records.len() >= 200,
            "expected the full corpus, got {}",
            records.len()
        );

        // The two fields that were `Option` in the in-tree reader and are
        // required `String` in the library: confirm none are empty corpus-wide,
        // so dropping `.unwrap_or_default()` in the scanner adapter is sound.
        assert!(
            records
                .iter()
                .all(|r| !r.title.is_empty() && !r.spec_path.is_empty()),
            "every record must carry a non-empty title and spec_path"
        );

        // Sorted by id.
        assert!(records.windows(2).all(|w| w[0].id <= w[1].id));

        // A known spec's code aliases survive the swap.
        let fg = records
            .iter()
            .find(|r| r.id == "034-featuregraph-registry-scanner-fix")
            .expect("spec 034 present in corpus");
        assert!(
            fg.code_aliases.contains(&"FEATUREGRAPH_REGISTRY".to_string()),
            "code_aliases preserved, got {:?}",
            fg.code_aliases
        );
    }
}
