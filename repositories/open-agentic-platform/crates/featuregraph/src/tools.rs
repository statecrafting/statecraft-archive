// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Bartek Kus
// Feature: FEATUREGRAPH_REGISTRY
// Spec: specs/034-featuregraph-registry-scanner-fix/spec.md

use crate::scanner::Scanner;
use anyhow::{Result, anyhow};
use std::collections::HashSet;
use std::path::Path;

pub struct FeatureGraphTools {
    // Cache placeholder
}

impl Default for FeatureGraphTools {
    fn default() -> Self {
        Self::new()
    }
}

impl FeatureGraphTools {
    pub fn new() -> Self {
        Self {}
    }

    pub fn features_overview(
        &self,
        repo_root: &Path,
        _snapshot_id: Option<String>,
    ) -> Result<serde_json::Value> {
        // Only Worktree supported for now
        let scanner = Scanner::new(repo_root);
        let graph = scanner.scan()?;
        let json = serde_json::to_value(graph)?;
        Ok(json)
    }

    pub fn features_locate(
        &self,
        repo_root: &Path,
        feature_id: Option<String>,
        spec_path: Option<String>,
        file_path: Option<String>,
    ) -> Result<serde_json::Value> {
        let scanner = Scanner::new(repo_root);
        let graph = scanner.scan()?;

        if let Some(fid) = feature_id {
            if let Some(node) = graph.features.iter().find(|f| f.feature_id == fid) {
                return Ok(serde_json::to_value(node)?);
            }
            return Err(anyhow!("Feature ID not found: {}", fid));
        }

        if let Some(spath) = spec_path {
            if let Some(node) = graph.features.iter().find(|f| f.spec_path == spath) {
                return Ok(serde_json::to_value(node)?);
            }
            return Err(anyhow!("Spec path not found: {}", spath));
        }

        if let Some(fpath) = file_path {
            // Check impl files
            if let Some(node) = graph
                .features
                .iter()
                .find(|f| f.impl_files.contains(&fpath))
            {
                return Ok(serde_json::to_value(node)?);
            }
            // Check test files
            if let Some(node) = graph
                .features
                .iter()
                .find(|f| f.test_files.contains(&fpath))
            {
                return Ok(serde_json::to_value(node)?);
            }
            return Err(anyhow!("File not owned by any feature: {}", fpath));
        }

        Err(anyhow!("Must provide feature_id, spec_path, or file_path"))
    }

    pub fn governance_preflight(
        &self,
        repo_root: &Path,
        request: serde_json::Value,
    ) -> Result<serde_json::Value> {
        let req: crate::preflight::PreflightRequest = serde_json::from_value(request)?;
        let scanner = Scanner::new(repo_root);
        let graph = scanner.scan()?;

        let checker = crate::preflight::PreflightChecker::new(repo_root);
        let response = checker.check(&graph, &req)?;

        let json = serde_json::to_value(response)?;
        Ok(json)
    }

    pub fn governance_drift(&self, repo_root: &Path) -> Result<serde_json::Value> {
        let scanner = Scanner::new(repo_root);
        let graph = scanner.scan()?;

        let mut all_violations = graph.violations.clone();
        for node in &graph.features {
            all_violations.extend(node.violations.clone());
        }
        all_violations.sort_by(|a, b| a.code.cmp(&b.code).then(a.path.cmp(&b.path)));

        let has_violations = !all_violations.is_empty();
        Ok(serde_json::json!({
            "has_violations": has_violations,
            "violations": all_violations
        }))
    }

    pub fn features_impact(&self, repo_root: &str, paths: &[String]) -> Result<serde_json::Value> {
        let scanner = Scanner::new(repo_root);
        let graph = scanner.scan()?;

        let mut impacts = Vec::new();
        let mut affected_feature_ids: HashSet<String> = HashSet::new();

        for path in paths {
            let mut found_feature_id: Option<String> = None;
            let mut found_spec_path: Option<String> = None;
            let mut found_status = "unattributed".to_string();

            for node in &graph.features {
                if node.impl_files.contains(path) || node.test_files.contains(path) {
                    found_feature_id = Some(node.feature_id.clone());
                    found_spec_path = Some(node.spec_path.clone());
                    found_status = node.status.clone();
                    affected_feature_ids.insert(node.feature_id.clone());
                    break;
                }
            }

            impacts.push(serde_json::json!({
                "path": path,
                "feature_id": found_feature_id,
                "spec_path": found_spec_path,
                "status": found_status,
            }));
        }

        Ok(serde_json::json!({
            "impacts": impacts,
            "total_paths": paths.len(),
            "affected_features": affected_feature_ids.len(),
        }))
    }
}
