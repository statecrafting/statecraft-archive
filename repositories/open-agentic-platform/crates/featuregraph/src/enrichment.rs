// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Bartek Kus
// Feature: PORTFOLIO_INTELLIGENCE
// Spec: specs/096-portfolio-intelligence/spec.md

use crate::graph::{FeatureGraph, FeatureNode};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use xray::schema::{FileNode, XrayIndex};

/// A feature enriched with structural metrics from xray (096 Slice 1).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EnrichedFeature {
    pub feature_id: String,
    pub title: String,
    pub status: String,
    pub implementation: String,
    pub owner: String,
    /// Spec risk level from registry (low/medium/high/critical).
    pub risk: String,
    pub spec_path: String,
    pub depends_on: Vec<String>,
    pub impl_file_count: usize,
    pub test_file_count: usize,
    /// Total lines of code across implementation files.
    pub total_loc: u64,
    /// Maximum cyclomatic complexity across implementation files.
    pub max_complexity: u64,
    /// Average complexity across implementation files (0.0 if no files).
    pub avg_complexity: f64,
    /// Total function definitions across implementation files.
    pub total_functions: u32,
    /// Total lines of code across test files.
    pub test_loc: u64,
    /// test_loc / (total_loc + test_loc), or 0.0 if both are zero.
    pub test_coverage_ratio: f64,
}

/// Bridge xray structural metrics with featuregraph feature attribution.
///
/// For each feature in the graph, looks up its impl and test files in the xray
/// index and accumulates LOC, complexity, and function counts.
pub fn enrich_features_with_metrics(
    graph: &FeatureGraph,
    index: &XrayIndex,
) -> Vec<EnrichedFeature> {
    let file_map: HashMap<&str, &FileNode> =
        index.files.iter().map(|f| (f.path.as_str(), f)).collect();

    graph
        .features
        .iter()
        .map(|node| enrich_one(node, &file_map))
        .collect()
}

fn enrich_one(node: &FeatureNode, file_map: &HashMap<&str, &FileNode>) -> EnrichedFeature {
    let mut total_loc: u64 = 0;
    let mut max_complexity: u64 = 0;
    let mut complexity_sum: u64 = 0;
    let mut complexity_count: u64 = 0;
    let mut total_functions: u32 = 0;
    let mut impl_file_count: usize = 0;

    for path in &node.impl_files {
        if let Some(fnode) = file_map.get(path.as_str()) {
            impl_file_count += 1;
            total_loc += fnode.loc;
            if fnode.complexity > max_complexity {
                max_complexity = fnode.complexity;
            }
            complexity_sum += fnode.complexity;
            complexity_count += 1;
            total_functions += fnode.functions.unwrap_or(0);
        }
    }

    let mut test_loc: u64 = 0;
    let mut test_file_count: usize = 0;
    for path in &node.test_files {
        if let Some(fnode) = file_map.get(path.as_str()) {
            test_file_count += 1;
            test_loc += fnode.loc;
        }
    }

    let avg_complexity = if complexity_count > 0 {
        complexity_sum as f64 / complexity_count as f64
    } else {
        0.0
    };

    let combined = total_loc + test_loc;
    let test_coverage_ratio = if combined > 0 {
        test_loc as f64 / combined as f64
    } else {
        0.0
    };

    EnrichedFeature {
        feature_id: node.feature_id.clone(),
        title: node.title.clone(),
        status: node.status.clone(),
        implementation: node.implementation.clone(),
        owner: node.owner.clone(),
        risk: node.governance.clone(),
        spec_path: node.spec_path.clone(),
        depends_on: node.depends_on.clone(),
        impl_file_count,
        test_file_count,
        total_loc,
        max_complexity,
        avg_complexity,
        total_functions,
        test_loc,
        test_coverage_ratio,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::graph::{FeatureGraph, FeatureNode};
    use std::collections::BTreeMap;
    use xray::schema::{FileNode, RepoStats, XrayIndex};

    fn make_feature(id: &str, impl_files: Vec<&str>, test_files: Vec<&str>) -> FeatureNode {
        FeatureNode {
            feature_id: id.into(),
            title: format!("Feature {id}"),
            spec_path: format!("specs/{id}/spec.md"),
            status: "approved".into(),
            implementation: "complete".into(),
            governance: String::new(),
            owner: "bart".into(),
            group: String::new(),
            depends_on: vec![],
            impl_files: impl_files.into_iter().map(String::from).collect(),
            test_files: test_files.into_iter().map(String::from).collect(),
            violations: vec![],
        }
    }

    fn make_file(path: &str, loc: u64, complexity: u64, functions: u32) -> FileNode {
        FileNode {
            path: path.into(),
            size: loc * 30,
            hash: "abc".into(),
            lang: "Rust".into(),
            loc,
            complexity,
            functions: Some(functions),
            max_depth: None,
        }
    }

    fn make_index(files: Vec<FileNode>) -> XrayIndex {
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
    fn sc096_1_enriched_features_carry_xray_metrics() {
        let mut graph = FeatureGraph::new();
        graph.features.push(make_feature(
            "FEAT_A",
            vec!["src/a.rs", "src/b.rs"],
            vec!["tests/a_test.rs"],
        ));

        let index = make_index(vec![
            make_file("src/a.rs", 100, 5, 3),
            make_file("src/b.rs", 200, 12, 7),
            make_file("tests/a_test.rs", 50, 2, 2),
        ]);

        let enriched = enrich_features_with_metrics(&graph, &index);
        assert_eq!(enriched.len(), 1);

        let e = &enriched[0];
        assert_eq!(e.feature_id, "FEAT_A");
        assert_eq!(e.impl_file_count, 2);
        assert_eq!(e.test_file_count, 1);
        assert_eq!(e.total_loc, 300);
        assert_eq!(e.max_complexity, 12);
        assert!((e.avg_complexity - 8.5).abs() < 0.01);
        assert_eq!(e.total_functions, 10);
        assert_eq!(e.test_loc, 50);
        // test_coverage_ratio = 50 / (300 + 50) = 0.1428...
        assert!((e.test_coverage_ratio - 50.0 / 350.0).abs() < 0.001);
    }

    #[test]
    fn feature_with_no_matching_files_gets_zeroes() {
        let mut graph = FeatureGraph::new();
        graph
            .features
            .push(make_feature("ORPHAN", vec!["missing.rs"], vec![]));

        let index = make_index(vec![]);
        let enriched = enrich_features_with_metrics(&graph, &index);

        assert_eq!(enriched[0].total_loc, 0);
        assert_eq!(enriched[0].max_complexity, 0);
        assert_eq!(enriched[0].avg_complexity, 0.0);
        assert_eq!(enriched[0].test_coverage_ratio, 0.0);
    }
}
