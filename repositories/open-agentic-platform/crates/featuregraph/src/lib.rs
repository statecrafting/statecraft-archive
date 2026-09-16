// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Bartek Kus
// Feature: FEATUREGRAPH_REGISTRY
// Spec: specs/034-featuregraph-registry-scanner-fix/spec.md

pub mod enrichment;
pub mod graph;
pub mod index_bridge;
pub mod locate;
pub mod preflight;
pub mod registry_source;
pub mod scanner;
pub mod tools;

/// Load the spec-spine [`Config`](spec_spine_types::Config) for a repo.
///
/// Spec 217 engine swap: `load_committed_registry` / `load_committed_index`
/// take an explicit `(&Config, repo_root)` (the library does no manifest
/// auto-discovery). We read the committed `spec-spine.toml` when present and
/// fall back to `Config::default()` (which already points `derived_dir` at
/// `.derived`) for trees without a manifest.
pub(crate) fn load_spec_spine_config(repo_root: &std::path::Path) -> spec_spine_types::Config {
    std::fs::read_to_string(repo_root.join("spec-spine.toml"))
        .ok()
        .and_then(|src| spec_spine_types::load_config(&src).ok())
        .unwrap_or_default()
}
