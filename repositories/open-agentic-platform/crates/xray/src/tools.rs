// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Bartek Kus
// Feature: XRAY_ANALYSIS
// Spec: spec/xray/analysis.md

use crate::{history, scan_target, scan_target_incremental};
use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::path::Path;

#[derive(Serialize, Deserialize)]
pub struct ScanResult {
    pub digest: String,
    pub files_count: usize,
    pub index: Value,
}

pub struct XrayTools;

impl XrayTools {
    pub fn new() -> Self {
        Self
    }

    /// Run a scan on the repository or a subdirectory
    pub fn xray_scan(&self, repo_root: &Path, path: Option<String>) -> Result<Value> {
        let target_path = if let Some(p) = path {
            repo_root.join(p)
        } else {
            repo_root.to_path_buf()
        };

        // Security check: ensure target is within repo_root
        if !target_path.starts_with(repo_root) {
            return Err(anyhow::anyhow!(
                "Target path must be within repository root"
            ));
        }

        // Run the scan
        let index = scan_target(&target_path, None).context("Failed to scan target")?;

        // Convert to JSON
        let index_json = serde_json::to_value(&index)?;

        Ok(index_json)
    }

    /// Run an incremental scan comparing against a previous index
    pub fn xray_scan_incremental(
        &self,
        repo_root: &Path,
        previous_index: &Path,
        path: Option<String>,
    ) -> Result<Value> {
        let target_path = if let Some(p) = path {
            repo_root.join(p)
        } else {
            repo_root.to_path_buf()
        };

        if !target_path.starts_with(repo_root) {
            return Err(anyhow::anyhow!(
                "Target path must be within repository root"
            ));
        }

        let index = scan_target_incremental(&target_path, None, previous_index)
            .context("Failed to run incremental scan")?;

        Ok(serde_json::to_value(&index)?)
    }
    /// Get churn report from scan history
    pub fn xray_churn(&self, repo_root: &Path, top_n: usize) -> Result<Value> {
        let history_path = repo_root
            .join(".axiomregent")
            .join("data")
            .join("history.jsonl");
        let entries = history::load_history(&history_path)?;
        let churn = history::churn_report(&entries, top_n);
        let growth = history::growth_report(&entries);

        Ok(serde_json::json!({
            "churn": churn,
            "growth": growth,
            "totalScans": entries.len()
        }))
    }

    /// Build a call graph for the repository (or a subdirectory) and return a summary.
    ///
    /// Requires the `analysis-call-graph` feature to be enabled.
    #[cfg(feature = "analysis-call-graph")]
    pub fn xray_call_graph(&self, repo_root: &Path, path: Option<String>) -> Result<Value> {
        let target_path = if let Some(p) = path {
            repo_root.join(p)
        } else {
            repo_root.to_path_buf()
        };

        if !target_path.starts_with(repo_root) {
            return Err(anyhow::anyhow!(
                "Target path must be within repository root"
            ));
        }

        let (_graph, summary) = crate::analysis::call_graph::analyze_directory(&target_path);

        Ok(serde_json::to_value(&summary)?)
    }

    /// Analyze dependencies from module files in the repository.
    pub fn xray_deps(&self, repo_root: &Path) -> Result<Value> {
        // First scan to get module_files list
        let index = scan_target(repo_root, None).context("Failed to scan for deps")?;
        let inventory = crate::analysis::deps::analyze_dependencies(repo_root, &index.module_files)
            .context("Failed to analyze dependencies")?;
        Ok(serde_json::to_value(&inventory)?)
    }

    /// Build a context plan: which files to read for a given task and token budget.
    pub fn xray_context(&self, repo_root: &Path, task: String, max_tokens: usize) -> Result<Value> {
        let index = scan_target(repo_root, None).context("Failed to scan for context")?;
        let history_path = repo_root
            .join(".axiomregent")
            .join("data")
            .join("history.jsonl");
        let hp = if history_path.exists() {
            Some(history_path.as_path())
        } else {
            None
        };

        let budget = crate::context::ContextBudget { max_tokens, task };
        let plan = crate::context::build_context_plan(&index, &budget, hp);
        Ok(serde_json::to_value(&plan)?)
    }

    /// Generate a structural fingerprint for the repository.
    pub fn xray_fingerprint(&self, repo_root: &Path) -> Result<Value> {
        let index = scan_target(repo_root, None).context("Failed to scan for fingerprint")?;
        let fp = crate::fingerprint::generate_fingerprint(&index);
        Ok(serde_json::to_value(&fp)?)
    }

    /// Evaluate policy rules against the repository.
    pub fn xray_policy(&self, repo_root: &Path) -> Result<Value> {
        let index = scan_target(repo_root, None).context("Failed to scan for policy")?;
        let config = crate::policy::load_policy(repo_root);
        let report = crate::policy::evaluate(&index, &config);
        Ok(serde_json::to_value(&report)?)
    }
}

impl Default for XrayTools {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::tempdir;

    #[test]
    fn test_xray_scan_basic() {
        let dir = tempdir().unwrap();
        let root = dir.path();

        // Create some files
        fs::write(root.join("test.txt"), "hello world").unwrap();
        fs::create_dir(root.join("src")).unwrap();
        fs::write(root.join("src/main.rs"), "fn main() {}").unwrap();

        let tools = XrayTools::new();
        let result = tools.xray_scan(root, None).expect("Scan failed");

        // Verify result structure
        assert!(result.is_object());
        let root_node = result.as_object().unwrap();

        assert!(root_node.contains_key("digest"));
        assert!(root_node.contains_key("files"));

        let files = root_node["files"].as_array().expect("files array");
        assert_eq!(files.len(), 2);
    }

    #[test]
    fn test_xray_scan_subdir() {
        let dir = tempdir().unwrap();
        let root = dir.path();

        fs::create_dir(root.join("sub")).unwrap();
        fs::write(root.join("sub/foo.txt"), "foo").unwrap();

        let tools = XrayTools::new();
        let result = tools
            .xray_scan(root, Some("sub".to_string()))
            .expect("Scan failed");

        let files = result["files"].as_array().unwrap();
        assert_eq!(files.len(), 1);
        assert_eq!(files[0]["path"], "foo.txt"); // Scanner returns relative to scan root
        // xray::scan_target uses to_string_lossy of the path relative to scan target or something.
        // Let's check xray implementation if needed, but for now assuming it works.
    }
}
