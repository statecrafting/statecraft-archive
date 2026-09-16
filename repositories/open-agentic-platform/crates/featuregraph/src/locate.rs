// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Bartek Kus
// Feature: FEATUREGRAPH_REGISTRY
// Spec: specs/034-featuregraph-registry-scanner-fix/spec.md

use crate::graph::{FeatureGraph, Violation};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SelectorType {
    FeatureId,
    SpecPath,
    FilePath,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Selector {
    #[serde(rename = "type")]
    pub kind: SelectorType,
    pub value: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Include {
    Spec,
    Implementation,
    Tests,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocatedFile {
    pub path: String,
    pub role: String,       // "spec", "implementation", "test"
    pub confidence: String, // "exact", "high", "medium", "low"
    #[serde(skip_serializing_if = "Option::is_none")]
    pub notes: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocateMatch {
    pub feature_id: String,
    pub spec_path: String,
    pub files: Vec<LocatedFile>,
    pub violations: Vec<Violation>,
}

pub fn locate(graph: &FeatureGraph, selector: &Selector, include: &[Include]) -> Vec<LocateMatch> {
    let mut matches = Vec::new();

    match selector.kind {
        SelectorType::FeatureId => {
            if let Some(node) = graph
                .features
                .iter()
                .find(|f| f.feature_id == selector.value)
            {
                matches.push(build_match(node, include));
            }
        }
        SelectorType::SpecPath => {
            // Exact match on spec path (normalized)
            let value = selector.value.replace('\\', "/");
            if let Some(node) = graph.features.iter().find(|f| f.spec_path == value) {
                matches.push(build_match(node, include));
            }
        }
        SelectorType::FilePath => {
            // Reverse lookup: find feature that owns this file
            let value = selector.value.replace('\\', "/");
            for node in &graph.features {
                let mut is_match = false;
                // Check spec
                if node.spec_path == value {
                    is_match = true;
                }
                // Check impl
                if node.impl_files.contains(&value) {
                    is_match = true;
                }
                // Check tests
                if node.test_files.contains(&value) {
                    is_match = true;
                }

                if is_match {
                    matches.push(build_match(node, include));
                }
            }
        }
    }

    // Sort matches
    matches.sort_by(|a, b| a.feature_id.cmp(&b.feature_id));
    matches
}

fn build_match(node: &crate::graph::FeatureNode, include: &[Include]) -> LocateMatch {
    let mut files = Vec::new();

    // Spec - exact confidence
    if include.is_empty() || include.iter().any(|i| matches!(i, Include::Spec)) {
        files.push(LocatedFile {
            path: node.spec_path.clone(),
            role: "spec".to_string(),
            confidence: "exact".to_string(),
            notes: None,
        });
    }

    // Implementation - high confidence
    if include.is_empty() || include.iter().any(|i| matches!(i, Include::Implementation)) {
        for path in &node.impl_files {
            files.push(LocatedFile {
                path: path.clone(),
                role: "implementation".to_string(),
                confidence: "high".to_string(),
                notes: None,
            });
        }
    }

    // Tests - high confidence
    if include.is_empty() || include.iter().any(|i| matches!(i, Include::Tests)) {
        for path in &node.test_files {
            files.push(LocatedFile {
                path: path.clone(),
                role: "test".to_string(),
                confidence: "high".to_string(),
                notes: None,
            });
        }
    }

    // Sort files by (role, path)
    files.sort_by(|a, b| a.role.cmp(&b.role).then(a.path.cmp(&b.path)));

    LocateMatch {
        feature_id: node.feature_id.clone(),
        spec_path: node.spec_path.clone(),
        files,
        violations: node.violations.clone(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::graph::{FeatureGraph, FeatureNode};

    fn mock_graph() -> FeatureGraph {
        let mut graph = FeatureGraph::new();
        graph.features.push(FeatureNode {
            feature_id: "FEATURE_A".to_string(),
            title: "Feature A".to_string(),
            spec_path: "spec/a.md".to_string(),
            status: "approved".to_string(),
            implementation: "complete".to_string(),
            governance: "high".to_string(),
            owner: "test-team".to_string(),
            group: "test".to_string(),
            depends_on: vec![],
            impl_files: vec!["src/a.rs".to_string()],
            test_files: vec!["tests/a_test.rs".to_string()],
            violations: vec![],
        });
        graph
    }

    #[test]
    fn test_locate_by_id() {
        let graph = mock_graph();
        let selector = Selector {
            kind: SelectorType::FeatureId,
            value: "FEATURE_A".to_string(),
        };
        let matches = locate(&graph, &selector, &[]);
        assert_eq!(matches.len(), 1);
        assert_eq!(matches[0].feature_id, "FEATURE_A");
        assert_eq!(matches[0].files.len(), 3); // spec, impl, test
    }

    #[test]
    fn test_locate_by_file() {
        let graph = mock_graph();
        let selector = Selector {
            kind: SelectorType::FilePath,
            value: "src/a.rs".to_string(),
        };
        let matches = locate(&graph, &selector, &[]);
        assert_eq!(matches.len(), 1);
        assert_eq!(matches[0].feature_id, "FEATURE_A");
    }
}
