// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Bartek Kus
// Feature: FEATUREGRAPH_REGISTRY
// Spec: spec/core/featuregraph.md

use anyhow::{Context, Result, anyhow};
use async_trait::async_trait;
use featuregraph::graph::{FeatureGraph, Violation};
use featuregraph::locate::{Selector, SelectorType, locate};
use featuregraph::preflight::{PreflightChecker, PreflightResponse};
use featuregraph::scanner::Scanner;
use serde::Serialize;
use serde_json::Value;
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

pub use featuregraph::preflight::{PreflightIntent, PreflightMode, PreflightRequest};

#[derive(Hash, Eq, PartialEq, Clone, Debug)]
pub enum GraphMode {
    Worktree,
    Snapshot(String),
}

#[derive(Hash, Eq, PartialEq, Clone, Debug)]
struct CacheKey {
    repo_root: PathBuf,
    mode: GraphMode,
}

#[derive(Serialize)]
pub struct FeatureOverview {
    pub feature_id: String,
    pub status: String,
    pub implementation: String,
    pub spec_path: String,
    pub impl_files_count: usize,
    pub test_files_count: usize,
}

pub struct FeatureTools {
    cache: Mutex<HashMap<CacheKey, Arc<FeatureGraph>>>,
}

impl Default for FeatureTools {
    fn default() -> Self {
        Self::new()
    }
}

impl FeatureTools {
    pub fn new() -> Self {
        Self {
            cache: Mutex::new(HashMap::new()),
        }
    }

    fn get_graph(&self, root: &Path, mode: GraphMode) -> Result<Arc<FeatureGraph>> {
        let key = CacheKey {
            repo_root: root.to_path_buf(),
            mode: mode.clone(),
        };

        // 1. Check Cache. Recover the guard on poison rather than
        // panicking: this is a best-effort scan cache, not a
        // correctness-critical invariant, so a prior panicking holder
        // shouldn't cascade into every subsequent feature-graph lookup.
        {
            let cache = self
                .cache
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            if let Some(graph) = cache.get(&key) {
                return Ok(graph.clone());
            }
        }

        // 2. Load Graph (Lock released during I/O)
        let graph = match &mode {
            GraphMode::Worktree => {
                let scanner = Scanner::new(root);
                scanner.scan().context("Failed to scan feature graph")?
            }
            GraphMode::Snapshot(_id) => {
                // Snapshot-mode scanning requires reading file contents from the checkpoint
                // blob store (apps/opc/src-tauri/src/checkpoint/storage.rs) rather than
                // the filesystem. This needs a cross-crate blob store trait that the desktop
                // checkpoint storage can implement. Deferred until the checkpoint storage API
                // is extracted into a shared crate. Use mode="worktree" for now.
                return Err(anyhow!(
                    "Snapshot mode feature graph scanning is not yet implemented. \
                     Use mode=\"worktree\" for gov.preflight and gov.drift."
                ));
            }
        };
        let graph = Arc::new(graph);

        // 3. Store Cache
        {
            let mut cache = self
                .cache
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            cache.insert(key, graph.clone());
        }

        Ok(graph)
    }

    pub fn invalidate(&self, root: &Path) {
        let mut cache = self
            .cache
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        // Invalidate Worktree entry for this root
        let key = CacheKey {
            repo_root: root.to_path_buf(),
            mode: GraphMode::Worktree,
        };
        cache.remove(&key);
    }

    pub fn locate(&self, root: &Path, selector_kind: &str, selector_value: &str) -> Result<Value> {
        // features.locate currently uses Worktree implicitly
        let graph = self.get_graph(root, GraphMode::Worktree)?;

        let kind = match selector_kind {
            "feature_id" => SelectorType::FeatureId,
            "spec_path" => SelectorType::SpecPath,
            "file_path" => SelectorType::FilePath,
            _ => return Err(anyhow!("Invalid selector type: {}", selector_kind)),
        };

        let selector = Selector {
            kind,
            value: selector_value.to_string(),
        };

        let matches = locate(&graph, &selector, &[]);
        Ok(serde_json::to_value(matches)?)
    }

    pub fn preflight(&self, root: &Path, req: PreflightRequest) -> Result<PreflightResponse> {
        let mode = match req.mode {
            PreflightMode::Worktree => GraphMode::Worktree,
            PreflightMode::Snapshot => {
                if let Some(id) = &req.snapshot_id {
                    GraphMode::Snapshot(id.clone())
                } else {
                    return Err(anyhow!("Snapshot ID required for snapshot mode"));
                }
            }
        };

        let graph = self.get_graph(root, mode)?;
        let checker = PreflightChecker::new(root);
        let response = checker.check(&graph, &req)?;
        Ok(response)
    }

    pub fn overview(
        &self,
        root: &Path,
        snapshot_id: Option<String>,
    ) -> Result<Vec<FeatureOverview>> {
        let mode = if let Some(id) = snapshot_id {
            GraphMode::Snapshot(id)
        } else {
            GraphMode::Worktree
        };
        let graph = self.get_graph(root, mode)?;

        let mut overview = Vec::new();
        for node in &graph.features {
            overview.push(FeatureOverview {
                feature_id: node.feature_id.clone(),
                status: node.status.clone(),
                implementation: node.implementation.clone(),
                spec_path: node.spec_path.clone(),
                impl_files_count: node.impl_files.len(),
                test_files_count: node.test_files.len(),
            });
        }
        // sort by feature_id
        overview.sort_by(|a, b| a.feature_id.cmp(&b.feature_id));
        Ok(overview)
    }

    pub fn impact(
        &self,
        root: &Path,
        changed_paths: Vec<String>,
        snapshot_id: Option<String>,
    ) -> Result<Vec<String>> {
        let mode = if let Some(id) = snapshot_id {
            GraphMode::Snapshot(id)
        } else {
            GraphMode::Worktree
        };
        let graph = self.get_graph(root, mode)?;

        let mut impacted_features = Vec::new();
        // Naive iteration for now (N * M) but safe given graph size.
        // Can build reverse index if needed.
        for node in &graph.features {
            let mut hit = false;
            for path in &changed_paths {
                // Determine if path belongs to this feature
                // 1. Check spec_path
                if &node.spec_path == path {
                    hit = true;
                }
                // 2. Check impl_files
                if node.impl_files.contains(path) {
                    hit = true;
                }
                // 3. Check test_files
                if node.test_files.contains(path) {
                    hit = true;
                }
                if hit {
                    break;
                }
            }
            if hit {
                impacted_features.push(node.feature_id.clone());
            }
        }
        impacted_features.sort();
        impacted_features.dedup();
        Ok(impacted_features)
    }

    pub fn drift(&self, root: &Path, snapshot_id: Option<String>) -> Result<Vec<Violation>> {
        let mode = if let Some(id) = snapshot_id {
            GraphMode::Snapshot(id)
        } else {
            GraphMode::Worktree
        };
        let graph = self.get_graph(root, mode)?;

        let mut all_violations = graph.violations.clone();
        for node in &graph.features {
            all_violations.extend(node.violations.clone());
        }

        all_violations.sort_by(|a, b| a.code.cmp(&b.code).then(a.path.cmp(&b.path)));
        Ok(all_violations)
    }
}

/// Spec 093: feature context for policy evaluation — IDs, max risk, statuses.
#[derive(Debug, Clone, Default)]
pub struct FeatureContext {
    pub feature_ids: Vec<String>,
    pub max_risk: Option<String>,
    pub statuses: Vec<String>,
}

impl FeatureTools {
    /// Spec 093: lookup feature context (IDs, max risk, statuses) for a set of file paths.
    /// Used by the MCP router to populate ToolCallContext before policy evaluation.
    pub fn feature_context_for_paths(
        &self,
        root: &Path,
        changed_paths: &[String],
    ) -> Result<FeatureContext> {
        let graph = self.get_graph(root, GraphMode::Worktree)?;
        let mut feature_ids = Vec::new();
        let mut risk_levels = Vec::new();
        let mut statuses = HashSet::new();

        for node in &graph.features {
            let hit = changed_paths.iter().any(|path| {
                &node.spec_path == path
                    || node.impl_files.contains(path)
                    || node.test_files.contains(path)
            });
            if hit {
                feature_ids.push(node.feature_id.clone());
                if !node.governance.is_empty() {
                    risk_levels.push(node.governance.clone());
                }
                if !node.status.is_empty() {
                    statuses.insert(node.status.clone());
                }
            }
        }

        feature_ids.sort();
        feature_ids.dedup();

        // Determine max risk: critical > high > medium > low
        let max_risk = risk_levels.into_iter().max_by_key(|r| match r.as_str() {
            "critical" => 4,
            "high" => 3,
            "medium" => 2,
            "low" => 1,
            _ => 0,
        });

        Ok(FeatureContext {
            feature_ids,
            max_risk,
            statuses: statuses.into_iter().collect(),
        })
    }
}

// 098 Slice 4: implement MutationPreflight for FeatureTools so the router can auto-run
// featuregraph preflight before dispatching mutation tools.
#[async_trait]
impl crate::router::MutationPreflight for FeatureTools {
    async fn check_mutation(
        &self,
        repo_root: &str,
        paths: &[String],
        intent: &str,
    ) -> Result<bool, String> {
        use featuregraph::preflight::{PreflightIntent, PreflightMode, PreflightRequest};

        let preflight_intent = match intent {
            "delete" => PreflightIntent::Delete,
            "refactor" => PreflightIntent::Refactor,
            "create" => PreflightIntent::Create,
            _ => PreflightIntent::Edit,
        };

        let request = PreflightRequest {
            intent: preflight_intent,
            mode: PreflightMode::Worktree,
            changed_paths: paths.to_vec(),
            snapshot_id: None,
        };

        match self.preflight(std::path::Path::new(repo_root), request) {
            Ok(response) => Ok(response.allowed),
            Err(e) => Err(e.to_string()),
        }
    }

    /// Spec 093: sync feature context lookup for policy enrichment.
    fn feature_context_sync(
        &self,
        repo_root: &str,
        paths: &[String],
    ) -> Result<crate::router::FeatureContextInfo, String> {
        let ctx = self
            .feature_context_for_paths(std::path::Path::new(repo_root), paths)
            .map_err(|e| e.to_string())?;
        Ok(crate::router::FeatureContextInfo {
            feature_ids: ctx.feature_ids,
            max_risk: ctx.max_risk,
            statuses: ctx.statuses,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use featuregraph::graph::{FeatureGraph, FeatureNode};

    /// Insert a pre-built graph into the cache so tests don't need a real repo.
    fn tools_with_graph(root: &Path, graph: FeatureGraph) -> FeatureTools {
        let tools = FeatureTools::new();
        let key = CacheKey {
            repo_root: root.to_path_buf(),
            mode: GraphMode::Worktree,
        };
        tools.cache.lock().unwrap().insert(key, Arc::new(graph));
        tools
    }

    fn test_graph() -> FeatureGraph {
        FeatureGraph {
            schema_version: "1.0".to_string(),
            graph_fingerprint: "test".to_string(),
            features: vec![
                FeatureNode {
                    feature_id: "FEAT_A".to_string(),
                    title: "Feature A".to_string(),
                    spec_path: "specs/001/spec.md".to_string(),
                    status: "approved".to_string(),
                    implementation: "complete".to_string(),
                    governance: "high".to_string(),
                    owner: "team-a".to_string(),
                    group: "core".to_string(),
                    depends_on: vec![],
                    impl_files: vec!["src/feat_a.rs".to_string()],
                    test_files: vec!["tests/feat_a.rs".to_string()],
                    violations: vec![],
                },
                FeatureNode {
                    feature_id: "FEAT_B".to_string(),
                    title: "Feature B".to_string(),
                    spec_path: "specs/002/spec.md".to_string(),
                    status: "draft".to_string(),
                    implementation: "pending".to_string(),
                    governance: "critical".to_string(),
                    owner: "team-b".to_string(),
                    group: "core".to_string(),
                    depends_on: vec!["FEAT_A".to_string()],
                    impl_files: vec!["src/feat_b.rs".to_string()],
                    test_files: vec![],
                    violations: vec![],
                },
                FeatureNode {
                    feature_id: "FEAT_C".to_string(),
                    title: "Feature C".to_string(),
                    spec_path: "specs/003/spec.md".to_string(),
                    status: "approved".to_string(),
                    implementation: "complete".to_string(),
                    governance: "low".to_string(),
                    owner: "team-c".to_string(),
                    group: "infra".to_string(),
                    depends_on: vec![],
                    impl_files: vec!["src/feat_c.rs".to_string()],
                    test_files: vec![],
                    violations: vec![],
                },
            ],
            violations: vec![],
        }
    }

    #[test]
    fn feature_context_single_file_hit() {
        let root = Path::new("/test/repo");
        let tools = tools_with_graph(root, test_graph());
        let ctx = tools
            .feature_context_for_paths(root, &["src/feat_a.rs".to_string()])
            .unwrap();
        assert_eq!(ctx.feature_ids, vec!["FEAT_A"]);
        assert_eq!(ctx.max_risk.as_deref(), Some("high"));
        assert!(ctx.statuses.contains(&"approved".to_string()));
    }

    #[test]
    fn feature_context_multiple_features() {
        let root = Path::new("/test/repo");
        let tools = tools_with_graph(root, test_graph());
        let ctx = tools
            .feature_context_for_paths(
                root,
                &["src/feat_a.rs".to_string(), "src/feat_b.rs".to_string()],
            )
            .unwrap();
        assert_eq!(ctx.feature_ids, vec!["FEAT_A", "FEAT_B"]);
        // critical > high → max should be critical
        assert_eq!(ctx.max_risk.as_deref(), Some("critical"));
        assert!(ctx.statuses.contains(&"approved".to_string()));
        assert!(ctx.statuses.contains(&"draft".to_string()));
    }

    #[test]
    fn feature_context_no_hits() {
        let root = Path::new("/test/repo");
        let tools = tools_with_graph(root, test_graph());
        let ctx = tools
            .feature_context_for_paths(root, &["src/unknown.rs".to_string()])
            .unwrap();
        assert!(ctx.feature_ids.is_empty());
        assert!(ctx.max_risk.is_none());
        assert!(ctx.statuses.is_empty());
    }

    #[test]
    fn feature_context_spec_path_hit() {
        let root = Path::new("/test/repo");
        let tools = tools_with_graph(root, test_graph());
        let ctx = tools
            .feature_context_for_paths(root, &["specs/002/spec.md".to_string()])
            .unwrap();
        assert_eq!(ctx.feature_ids, vec!["FEAT_B"]);
        assert_eq!(ctx.max_risk.as_deref(), Some("critical"));
        assert!(ctx.statuses.contains(&"draft".to_string()));
    }

    #[test]
    fn feature_context_test_file_hit() {
        let root = Path::new("/test/repo");
        let tools = tools_with_graph(root, test_graph());
        let ctx = tools
            .feature_context_for_paths(root, &["tests/feat_a.rs".to_string()])
            .unwrap();
        assert_eq!(ctx.feature_ids, vec!["FEAT_A"]);
        assert_eq!(ctx.max_risk.as_deref(), Some("high"));
    }
}
