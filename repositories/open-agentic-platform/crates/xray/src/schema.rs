// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Bartek Kus
// Feature: XRAY_ANALYSIS
// Spec: spec/xray/analysis.md

use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

/// Summary of call graph analysis, always available in the schema regardless of feature flags.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CallGraphSummary {
    /// Total number of functions identified across all scanned files.
    pub total_functions: usize,
    /// Total number of directed call edges in the graph.
    pub total_edges: usize,
    /// Functions with no incoming edges (potential entry points).
    pub entry_points: Vec<String>,
}

/// The authoritative file index.
/// MUST be Canonical JSON (keys sorted, no whitespace).
#[derive(Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct XrayIndex {
    /// Schema version (e.g. "1.0.0")
    pub schema_version: String,

    /// Repository root name (e.g. "axiomregent")
    pub root: String,

    /// Scan target relative to root (e.g. ".")
    pub target: String,

    /// List of file nodes, MUST be sorted by path.
    pub files: Vec<FileNode>,

    /// Count of files per language. Sorted by language name.
    pub languages: BTreeMap<String, usize>,

    /// Count of files in top-level directories. Sorted by directory name.
    pub top_dirs: BTreeMap<String, usize>,

    /// List of important module files (e.g. go.mod, Cargo.toml). Sorted by path.
    pub module_files: Vec<String>,

    /// Aggregate statistics.
    pub stats: RepoStats,

    /// SHA-256 digest of the content (excluding this field).
    pub digest: String,

    /// Digest of the previous index used for incremental scanning.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub prev_digest: Option<String>,

    /// Files that changed since the previous scan (new, modified, or deleted paths).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub changed_files: Option<Vec<String>>,

    /// Summary of call graph analysis (None if call graph analysis was not performed).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub call_graph_summary: Option<CallGraphSummary>,

    /// Dependency inventory (None if not analyzed).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub dependencies: Option<crate::analysis::deps::DependencyInventory>,

    /// Structural fingerprint (None if not computed).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub fingerprint: Option<crate::fingerprint::Fingerprint>,
}

#[derive(Debug, Serialize, Deserialize, PartialEq, Eq, Clone)]
#[serde(rename_all = "camelCase")]
pub struct FileNode {
    /// Relative path from repo root.
    pub path: String,

    /// File size in bytes.
    pub size: u64,

    /// SHA-256 content hash.
    pub hash: String,

    /// Detected language.
    pub lang: String,

    /// Lines of code.
    pub loc: u64,

    /// Calculated complexity score.
    pub complexity: u64,

    /// Number of function definitions (None if language not analyzable)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub functions: Option<u32>,

    /// Maximum nesting depth (None if language not analyzable)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_depth: Option<u32>,
}

#[derive(Debug, Serialize, Deserialize, PartialEq, Eq, Clone)]
#[serde(rename_all = "camelCase")]
pub struct RepoStats {
    pub file_count: usize,
    pub total_size: u64,
}

impl Default for XrayIndex {
    fn default() -> Self {
        Self {
            schema_version: "1.2.0".to_string(),
            root: "unknown".to_string(),
            target: ".".to_string(),
            files: vec![],
            languages: BTreeMap::new(),
            top_dirs: BTreeMap::new(),
            module_files: vec![],
            stats: RepoStats {
                file_count: 0,
                total_size: 0,
            },
            digest: "".to_string(),
            prev_digest: None,
            changed_files: None,
            call_graph_summary: None,
            dependencies: None,
            fingerprint: None,
        }
    }
}
