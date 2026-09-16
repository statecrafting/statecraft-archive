// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Bartek Kus
// Feature: GOVERNANCE_ENGINE
// Spec: specs/034-featuregraph-registry-scanner-fix/spec.md

use crate::graph::{FeatureGraph, FeatureNode, Violation};
use crate::scanner::HeaderParser;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet, VecDeque};
use std::path::{Path, PathBuf};
use xray::schema::XrayIndex;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PreflightIntent {
    Edit,
    Create,
    Delete,
    Refactor,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PreflightMode {
    Worktree,
    Snapshot,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PreflightRequest {
    pub intent: PreflightIntent,
    pub mode: PreflightMode,
    pub changed_paths: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub snapshot_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, PartialOrd, Ord)]
pub enum ChangeTier {
    #[serde(rename = "tier1")]
    Tier1, // Autonomous
    #[serde(rename = "tier2")]
    Tier2, // Gated
    #[serde(rename = "tier3")]
    Tier3, // Forbidden
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PreflightResponse {
    pub allowed: bool,
    pub safety_tier: ChangeTier,
    pub violations: Vec<Violation>,
    pub graph_fingerprint: String,
}

pub struct PreflightChecker {
    root: PathBuf,
    parser: HeaderParser,
}

impl PreflightChecker {
    pub fn new<P: AsRef<Path>>(root: P) -> Self {
        Self {
            root: root.as_ref().to_path_buf(),
            parser: HeaderParser::new(),
        }
    }

    pub fn check(
        &self,
        graph: &FeatureGraph,
        req: &PreflightRequest,
    ) -> Result<PreflightResponse, anyhow::Error> {
        let mut violations = Vec::new();
        let known_features: HashSet<&String> =
            graph.features.iter().map(|f| &f.feature_id).collect();

        // 1. Check Policy Violations
        self.check_policy_violations(req, &mut violations);

        // 1b. Spec 093 — Check dependency satisfaction for affected features
        self.check_dependency_satisfaction(graph, req, &mut violations);

        // 2. Check Feature Graph Consistency

        for rel_path in &req.changed_paths {
            let abs_path = self.root.join(rel_path);

            if !abs_path.exists() {
                continue;
            }

            if !is_eligible_file(rel_path) {
                continue;
            }

            match self.parser.parse_file(&abs_path) {
                Ok(header) => {
                    if let Some(fid) = &header.feature_id {
                        if !known_features.contains(fid) {
                            violations.push(Violation {
                                code: "DANGLING_FEATURE_ID".to_string(),
                                severity: "error".to_string(),
                                path: rel_path.clone(),
                                feature_id: Some(fid.clone()),
                                message: format!(
                                    "Feature '{}' is not defined in the feature manifest (registry.json or spec/features.yaml)",
                                    fid
                                ),
                                suggested_fix: Some(
                                    "Add feature to the compiled registry (spec-compiler) or spec/features.yaml"
                                        .to_string(),
                                ),
                            });
                        } else {
                            // Check SPEC_PATH_MISMATCH
                            if let Some(node) = graph.features.iter().find(|f| &f.feature_id == fid)
                                && let Some(declared) = &header.spec_path
                                && declared != &node.spec_path
                            {
                                violations.push(Violation {
                                    code: "SPEC_PATH_MISMATCH".to_string(),
                                    severity: "warning".to_string(),
                                    path: rel_path.clone(),
                                    feature_id: Some(fid.clone()),
                                    message: format!(
                                        "File declares spec {} but registry says {}",
                                        declared, node.spec_path
                                    ),
                                    suggested_fix: Some(format!(
                                        "Update header to Spec: {}",
                                        node.spec_path
                                    )),
                                });
                            }
                        }
                    }
                }
                Err(e) => {
                    violations.push(Violation {
                        code: "INVALID_HEADER_FORMAT".to_string(),
                        severity: "error".to_string(),
                        path: rel_path.clone(),
                        feature_id: None,
                        message: e.to_string(),
                        suggested_fix: Some("Fix header format".to_string()),
                    });
                }
            }
        }

        violations.sort_by(|a, b| a.code.cmp(&b.code).then(a.path.cmp(&b.path)));

        let safety_tier = self.calculate_safety_tier(req, &violations);

        // Tier 3 is never allowed
        let allowed = violations.is_empty() && safety_tier != ChangeTier::Tier3;

        Ok(PreflightResponse {
            allowed,
            safety_tier,
            violations,
            graph_fingerprint: graph.graph_fingerprint.clone(),
        })
    }

    /// Spec 093, Slice 5: for each feature affected by changed paths, verify that all
    /// `depends_on` entries are present in the graph and have status `active`.
    fn check_dependency_satisfaction(
        &self,
        graph: &FeatureGraph,
        req: &PreflightRequest,
        violations: &mut Vec<Violation>,
    ) {
        let feature_map: HashMap<&str, &FeatureNode> = graph
            .features
            .iter()
            .map(|f| (f.feature_id.as_str(), f))
            .collect();

        // Collect features affected by the changed paths
        let mut affected_features: HashSet<&str> = HashSet::new();
        for path in &req.changed_paths {
            for node in &graph.features {
                if node.impl_files.contains(path) || node.test_files.contains(path) {
                    affected_features.insert(&node.feature_id);
                }
            }
        }

        for &fid in &affected_features {
            let Some(node) = feature_map.get(fid) else {
                continue;
            };
            for dep_id in &node.depends_on {
                match feature_map.get(dep_id.as_str()) {
                    None => {
                        violations.push(Violation {
                            code: "DEPENDENCY_MISSING".to_string(),
                            severity: "error".to_string(),
                            path: node.spec_path.clone(),
                            feature_id: Some(fid.to_string()),
                            message: format!(
                                "Feature '{}' depends on '{}' which is not in the feature graph",
                                fid, dep_id
                            ),
                            suggested_fix: Some(format!(
                                "Add spec for dependency '{}' or remove it from depends_on",
                                dep_id
                            )),
                        });
                    }
                    Some(dep_node) if dep_node.status == "draft" => {
                        violations.push(Violation {
                            code: "DEPENDENCY_NOT_READY".to_string(),
                            severity: "warning".to_string(),
                            path: node.spec_path.clone(),
                            feature_id: Some(fid.to_string()),
                            message: format!(
                                "Feature '{}' depends on '{}' which is still draft",
                                fid, dep_id
                            ),
                            suggested_fix: Some(format!(
                                "Promote dependency '{}' to approved before working on '{}'",
                                dep_id, fid
                            )),
                        });
                    }
                    _ => {} // dependency is active or other non-draft status — ok
                }
            }
        }
    }

    fn check_policy_violations(&self, req: &PreflightRequest, violations: &mut Vec<Violation>) {
        for path in &req.changed_paths {
            // Policy: Do not edit generated files
            if path.contains("generated/") || path.ends_with(".gen.rs") {
                violations.push(Violation {
                    code: "EDIT_GENERATED_FILE".to_string(),
                    severity: "error".to_string(),
                    path: path.clone(),
                    feature_id: None,
                    message: "Manual edits to generated files are forbidden".to_string(),
                    suggested_fix: Some("Modify the source generator instead".to_string()),
                });
            }
        }
    }

    fn calculate_safety_tier(
        &self,
        req: &PreflightRequest,
        violations: &[Violation],
    ) -> ChangeTier {
        // If there are any errors (including DEPENDENCY_MISSING), it's Tier 3
        if violations.iter().any(|v| v.severity == "error") {
            return ChangeTier::Tier3;
        }

        // Spec 093: DEPENDENCY_NOT_READY warnings escalate to at least Tier 2
        let has_dependency_warnings = violations.iter().any(|v| v.code == "DEPENDENCY_NOT_READY");

        // Tier 1: Documentation only changes (unless dependency warnings)
        let all_docs = req.changed_paths.iter().all(|p| {
            p.ends_with(".md") || p.ends_with(".txt") || p.ends_with(".png") || p.ends_with(".jpg")
        });

        if all_docs && !has_dependency_warnings {
            return ChangeTier::Tier1;
        }

        // Tier 2: Code changes (Default)
        ChangeTier::Tier2
    }
}

// ---------------------------------------------------------------------------
// Blast radius analysis (096 Slice 2)
// ---------------------------------------------------------------------------

/// Blast radius of a set of changed files across the feature graph.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BlastRadius {
    /// Features directly affected by changed files.
    pub affected_features: Vec<String>,
    /// Features that transitively depend on affected features.
    pub downstream_features: Vec<String>,
    /// Total LOC across all files owned by affected + downstream features.
    pub total_loc_at_risk: u64,
    /// Maximum complexity across all files owned by affected + downstream features.
    pub max_complexity_at_risk: u64,
    /// Number of files owned by affected + downstream features.
    pub affected_file_count: usize,
    /// Maximum dependency depth reached in the downstream walk.
    pub dependency_depth: usize,
}

/// Compute the blast radius for a set of changed paths.
///
/// 1. Map changed paths to directly affected features.
/// 2. Walk the dependency graph in reverse (find all features that transitively
///    depend on affected ones).
/// 3. Accumulate LOC and complexity from xray index for all files owned by
///    affected + downstream features.
pub fn compute_blast_radius(
    graph: &FeatureGraph,
    index: &XrayIndex,
    changed_paths: &[String],
) -> BlastRadius {
    let file_map: HashMap<&str, &xray::schema::FileNode> =
        index.files.iter().map(|f| (f.path.as_str(), f)).collect();

    // Step 1: find directly affected features
    let mut affected: HashSet<&str> = HashSet::new();
    for path in changed_paths {
        for node in &graph.features {
            if node.impl_files.contains(path) || node.test_files.contains(path) {
                affected.insert(&node.feature_id);
            }
        }
    }

    // Build reverse dependency map: for each feature, which features depend on it?
    let mut reverse_deps: HashMap<&str, Vec<&str>> = HashMap::new();
    for node in &graph.features {
        for dep_id in &node.depends_on {
            reverse_deps
                .entry(dep_id.as_str())
                .or_default()
                .push(&node.feature_id);
        }
    }

    // Step 2: BFS to find all downstream features (those that transitively depend on affected)
    let mut downstream: HashSet<&str> = HashSet::new();
    let mut queue: VecDeque<(&str, usize)> = VecDeque::new();
    let mut max_depth: usize = 0;

    for &fid in &affected {
        queue.push_back((fid, 0));
    }

    while let Some((fid, depth)) = queue.pop_front() {
        if let Some(dependents) = reverse_deps.get(fid) {
            for &dep in dependents {
                if !affected.contains(dep) && downstream.insert(dep) {
                    let next_depth = depth + 1;
                    if next_depth > max_depth {
                        max_depth = next_depth;
                    }
                    queue.push_back((dep, next_depth));
                }
            }
        }
    }

    // Step 3: accumulate metrics from xray for all files in affected + downstream
    let all_features: HashSet<&str> = affected
        .iter()
        .copied()
        .chain(downstream.iter().copied())
        .collect();
    let feature_map: HashMap<&str, &FeatureNode> = graph
        .features
        .iter()
        .map(|f| (f.feature_id.as_str(), f))
        .collect();

    let mut total_loc: u64 = 0;
    let mut max_complexity: u64 = 0;
    let mut seen_files: HashSet<&str> = HashSet::new();

    for &fid in &all_features {
        if let Some(node) = feature_map.get(fid) {
            for path in node.impl_files.iter().chain(node.test_files.iter()) {
                if seen_files.insert(path.as_str())
                    && let Some(fnode) = file_map.get(path.as_str())
                {
                    total_loc += fnode.loc;
                    if fnode.complexity > max_complexity {
                        max_complexity = fnode.complexity;
                    }
                }
            }
        }
    }

    let mut affected_vec: Vec<String> = affected.iter().map(|s| s.to_string()).collect();
    affected_vec.sort();
    let mut downstream_vec: Vec<String> = downstream.iter().map(|s| s.to_string()).collect();
    downstream_vec.sort();

    BlastRadius {
        affected_features: affected_vec,
        downstream_features: downstream_vec,
        total_loc_at_risk: total_loc,
        max_complexity_at_risk: max_complexity,
        affected_file_count: seen_files.len(),
        dependency_depth: max_depth,
    }
}

fn is_eligible_file(path: &str) -> bool {
    let allowed_exts = [
        ".go", ".rs", ".ts", ".tsx", ".js", ".jsx", ".c", ".cc", ".cpp", ".h", ".hpp", ".java",
        ".kt", ".py", ".sh", ".bash", ".zsh",
    ];
    for ext in allowed_exts {
        if path.ends_with(ext) {
            return true;
        }
    }
    false
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::graph::{FeatureGraph, FeatureNode};
    use std::collections::BTreeMap;
    use std::fs::File;
    use std::io::Write;
    use xray::schema::{FileNode as XrayFileNode, RepoStats};

    fn make_node(id: &str, status: &str, deps: Vec<&str>, impl_files: Vec<&str>) -> FeatureNode {
        FeatureNode {
            feature_id: id.to_string(),
            title: format!("Feature {id}"),
            spec_path: format!("specs/{id}/spec.md"),
            status: status.to_string(),
            implementation: String::new(),
            governance: String::new(),
            owner: String::new(),
            group: String::new(),
            depends_on: deps.into_iter().map(String::from).collect(),
            impl_files: impl_files.into_iter().map(String::from).collect(),
            test_files: vec![],
            violations: vec![],
        }
    }

    #[test]
    fn sc093_4_dependency_not_ready_warning() {
        let mut graph = FeatureGraph::new();
        graph
            .features
            .push(make_node("DEP", "draft", vec![], vec![]));
        graph.features.push(make_node(
            "FEAT",
            "approved",
            vec!["DEP"],
            vec!["src/feat.rs"],
        ));

        let temp_dir = tempfile::tempdir().unwrap();
        let feat_path = temp_dir.path().join("src/feat.rs");
        std::fs::create_dir_all(feat_path.parent().unwrap()).unwrap();
        let mut f = File::create(&feat_path).unwrap();
        writeln!(f, "// Feature: FEAT").unwrap();

        let checker = PreflightChecker::new(temp_dir.path());
        let req = PreflightRequest {
            intent: PreflightIntent::Edit,
            mode: PreflightMode::Worktree,
            changed_paths: vec!["src/feat.rs".to_string()],
            snapshot_id: None,
        };

        let res = checker.check(&graph, &req).unwrap();
        let dep_violations: Vec<_> = res
            .violations
            .iter()
            .filter(|v| v.code == "DEPENDENCY_NOT_READY")
            .collect();
        assert_eq!(dep_violations.len(), 1);
        assert!(dep_violations[0].message.contains("DEP"));
        assert!(dep_violations[0].message.contains("still draft"));
        // Dependency warning escalates to at least Tier2
        assert!(res.safety_tier >= ChangeTier::Tier2);
    }

    #[test]
    fn sc093_4_dependency_missing_error() {
        let mut graph = FeatureGraph::new();
        graph.features.push(make_node(
            "FEAT",
            "approved",
            vec!["NONEXISTENT"],
            vec!["src/feat.rs"],
        ));

        let temp_dir = tempfile::tempdir().unwrap();
        let feat_path = temp_dir.path().join("src/feat.rs");
        std::fs::create_dir_all(feat_path.parent().unwrap()).unwrap();
        let mut f = File::create(&feat_path).unwrap();
        writeln!(f, "// Feature: FEAT").unwrap();

        let checker = PreflightChecker::new(temp_dir.path());
        let req = PreflightRequest {
            intent: PreflightIntent::Edit,
            mode: PreflightMode::Worktree,
            changed_paths: vec!["src/feat.rs".to_string()],
            snapshot_id: None,
        };

        let res = checker.check(&graph, &req).unwrap();
        let missing: Vec<_> = res
            .violations
            .iter()
            .filter(|v| v.code == "DEPENDENCY_MISSING")
            .collect();
        assert_eq!(missing.len(), 1);
        assert!(missing[0].message.contains("NONEXISTENT"));
        // Missing dependency is an error → Tier3
        assert_eq!(res.safety_tier, ChangeTier::Tier3);
        assert!(!res.allowed);
    }

    #[test]
    fn sc093_4_satisfied_dependencies_no_violation() {
        let mut graph = FeatureGraph::new();
        graph
            .features
            .push(make_node("DEP", "active", vec![], vec![]));
        graph.features.push(make_node(
            "FEAT",
            "approved",
            vec!["DEP"],
            vec!["src/feat.rs"],
        ));

        let temp_dir = tempfile::tempdir().unwrap();
        let feat_path = temp_dir.path().join("src/feat.rs");
        std::fs::create_dir_all(feat_path.parent().unwrap()).unwrap();
        let mut f = File::create(&feat_path).unwrap();
        writeln!(f, "// Feature: FEAT").unwrap();

        let checker = PreflightChecker::new(temp_dir.path());
        let req = PreflightRequest {
            intent: PreflightIntent::Edit,
            mode: PreflightMode::Worktree,
            changed_paths: vec!["src/feat.rs".to_string()],
            snapshot_id: None,
        };

        let res = checker.check(&graph, &req).unwrap();
        let dep_violations: Vec<_> = res
            .violations
            .iter()
            .filter(|v| v.code.starts_with("DEPENDENCY_"))
            .collect();
        assert!(dep_violations.is_empty());
    }

    #[test]
    fn test_preflight_dangling() {
        // Setup graph
        let mut graph = FeatureGraph::new();
        graph.features.push(FeatureNode {
            feature_id: "KNOWN".to_string(),
            title: "Known Feature".to_string(),
            spec_path: "spec/known.md".to_string(),
            status: "approved".to_string(),
            implementation: "complete".to_string(),
            governance: "high".to_string(),
            owner: "test-team".to_string(),
            group: "test".to_string(),
            depends_on: vec![],
            impl_files: vec![],
            test_files: vec![],
            violations: vec![],
        });

        // We need to trick is_eligible_file check or rename tempfile
        // Tempfile usually has random name. We can't easily control extension with NamedTempFile without builder.
        // Let's create a dir and write a file with extension.
        let temp_dir = tempfile::tempdir().unwrap();
        let file_path = temp_dir.path().join("test.rs");
        let mut f = File::create(&file_path).unwrap();
        writeln!(f, "// Feature: UNKNOWN").unwrap();

        let checker = PreflightChecker::new(temp_dir.path());
        let req = PreflightRequest {
            intent: PreflightIntent::Edit,
            mode: PreflightMode::Worktree,
            changed_paths: vec!["test.rs".to_string()],
            snapshot_id: None,
        };

        let res = checker.check(&graph, &req).unwrap();
        assert!(!res.allowed);
        assert_eq!(res.violations[0].code, "DANGLING_FEATURE_ID");
    }

    // -- Blast radius tests (096 Slice 2) --

    fn make_xray_file(path: &str, loc: u64, complexity: u64) -> XrayFileNode {
        XrayFileNode {
            path: path.into(),
            size: loc * 30,
            hash: "abc".into(),
            lang: "Rust".into(),
            loc,
            complexity,
            functions: Some(1),
            max_depth: None,
        }
    }

    fn make_xray_index(files: Vec<XrayFileNode>) -> XrayIndex {
        XrayIndex {
            schema_version: "1.2.0".into(),
            root: "test".into(),
            target: ".".into(),
            files,
            languages: BTreeMap::new(),
            top_dirs: BTreeMap::new(),
            module_files: vec![],
            stats: RepoStats {
                file_count: 0,
                total_size: 0,
            },
            digest: String::new(),
            prev_digest: None,
            changed_files: None,
            call_graph_summary: None,
            dependencies: None,
            fingerprint: None,
        }
    }

    #[test]
    fn sc096_2_blast_radius_direct_and_downstream() {
        let mut graph = FeatureGraph::new();
        // A is the root, B depends on A, C depends on B (chain: A -> B -> C)
        graph
            .features
            .push(make_node("A", "active", vec![], vec!["src/a.rs"]));
        graph
            .features
            .push(make_node("B", "active", vec!["A"], vec!["src/b.rs"]));
        graph
            .features
            .push(make_node("C", "active", vec!["B"], vec!["src/c.rs"]));
        // D is independent
        graph
            .features
            .push(make_node("D", "active", vec![], vec!["src/d.rs"]));

        let index = make_xray_index(vec![
            make_xray_file("src/a.rs", 100, 5),
            make_xray_file("src/b.rs", 200, 10),
            make_xray_file("src/c.rs", 150, 8),
            make_xray_file("src/d.rs", 50, 2),
        ]);

        // Change a.rs → affects A directly, B and C are downstream
        let br = compute_blast_radius(&graph, &index, &["src/a.rs".into()]);

        assert_eq!(br.affected_features, vec!["A"]);
        assert_eq!(br.downstream_features, vec!["B", "C"]);
        assert_eq!(br.total_loc_at_risk, 450); // 100 + 200 + 150
        assert_eq!(br.max_complexity_at_risk, 10);
        assert_eq!(br.affected_file_count, 3);
        assert_eq!(br.dependency_depth, 2); // A -> B -> C
    }

    #[test]
    fn sc096_2_blast_radius_no_downstream() {
        let mut graph = FeatureGraph::new();
        graph
            .features
            .push(make_node("A", "active", vec![], vec!["src/a.rs"]));

        let index = make_xray_index(vec![make_xray_file("src/a.rs", 100, 5)]);

        let br = compute_blast_radius(&graph, &index, &["src/a.rs".into()]);
        assert_eq!(br.affected_features, vec!["A"]);
        assert!(br.downstream_features.is_empty());
        assert_eq!(br.dependency_depth, 0);
    }

    #[test]
    fn sc096_2_blast_radius_unattributed_file() {
        let graph = FeatureGraph::new(); // no features
        let index = make_xray_index(vec![make_xray_file("src/orphan.rs", 100, 5)]);

        let br = compute_blast_radius(&graph, &index, &["src/orphan.rs".into()]);
        assert!(br.affected_features.is_empty());
        assert!(br.downstream_features.is_empty());
        assert_eq!(br.total_loc_at_risk, 0);
    }

    #[test]
    fn sc096_2_blast_radius_diamond_dependency() {
        // Diamond: A -> B, A -> C, B -> D, C -> D
        let mut graph = FeatureGraph::new();
        graph
            .features
            .push(make_node("A", "active", vec![], vec!["src/a.rs"]));
        graph
            .features
            .push(make_node("B", "active", vec!["A"], vec!["src/b.rs"]));
        graph
            .features
            .push(make_node("C", "active", vec!["A"], vec!["src/c.rs"]));
        graph
            .features
            .push(make_node("D", "active", vec!["B", "C"], vec!["src/d.rs"]));

        let index = make_xray_index(vec![
            make_xray_file("src/a.rs", 100, 5),
            make_xray_file("src/b.rs", 200, 10),
            make_xray_file("src/c.rs", 150, 8),
            make_xray_file("src/d.rs", 50, 3),
        ]);

        let br = compute_blast_radius(&graph, &index, &["src/a.rs".into()]);
        assert_eq!(br.affected_features, vec!["A"]);
        // B, C, D are all downstream
        assert!(br.downstream_features.contains(&"B".to_string()));
        assert!(br.downstream_features.contains(&"C".to_string()));
        assert!(br.downstream_features.contains(&"D".to_string()));
        assert_eq!(br.dependency_depth, 2); // A -> B/C -> D
    }

    #[test]
    fn sc096_2_blast_radius_multiple_changed_files() {
        // Two independent features, change files from both
        let mut graph = FeatureGraph::new();
        graph
            .features
            .push(make_node("X", "active", vec![], vec!["src/x.rs"]));
        graph
            .features
            .push(make_node("Y", "active", vec![], vec!["src/y.rs"]));

        let index = make_xray_index(vec![
            make_xray_file("src/x.rs", 100, 5),
            make_xray_file("src/y.rs", 200, 10),
        ]);

        let br = compute_blast_radius(&graph, &index, &["src/x.rs".into(), "src/y.rs".into()]);
        assert_eq!(br.affected_features.len(), 2);
        assert!(br.affected_features.contains(&"X".to_string()));
        assert!(br.affected_features.contains(&"Y".to_string()));
        assert!(br.downstream_features.is_empty()); // no dependents
    }

    #[test]
    fn sc096_2_blast_radius_deduplicates_downstream() {
        // A -> C, B -> C: change files from both A and B
        let mut graph = FeatureGraph::new();
        graph
            .features
            .push(make_node("A", "active", vec![], vec!["src/a.rs"]));
        graph
            .features
            .push(make_node("B", "active", vec![], vec!["src/b.rs"]));
        graph
            .features
            .push(make_node("C", "active", vec!["A", "B"], vec!["src/c.rs"]));

        let index = make_xray_index(vec![
            make_xray_file("src/a.rs", 100, 5),
            make_xray_file("src/b.rs", 100, 5),
            make_xray_file("src/c.rs", 200, 10),
        ]);

        let br = compute_blast_radius(&graph, &index, &["src/a.rs".into(), "src/b.rs".into()]);
        // C should appear only once in downstream despite two paths
        let c_count = br.downstream_features.iter().filter(|f| *f == "C").count();
        assert_eq!(c_count, 1, "C should appear exactly once in downstream");
    }
}
