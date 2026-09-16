// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Bartek Kus
// Feature: FEATUREGRAPH_REGISTRY
// Spec: specs/034-featuregraph-registry-scanner-fix/spec.md

use serde::{Deserialize, Serialize};

/// Represents a specific violation of a feature's invariants or rules.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Violation {
    /// The unique error code for the violation.
    pub code: String,
    /// The severity level of the violation (e.g., "error", "warning").
    pub severity: String,
    /// The file path where the violation occurred.
    pub path: String,
    /// The ID of the feature related to this violation, if applicable.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub feature_id: Option<String>,
    /// A descriptive message explaining the violation.
    pub message: String,
    /// A suggested fix for the violation, if available.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub suggested_fix: Option<String>,
}

/// Represents a single node in the feature graph, corresponding to a documented feature.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct FeatureNode {
    /// The unique identifier for the feature (e.g., "MCP_ROUTER").
    pub feature_id: String,
    /// The human-readable title of the feature.
    #[serde(default)]
    pub title: String,
    /// The path to the feature's specification file.
    pub spec_path: String,
    /// The design lifecycle status (draft/approved/superseded/retired).
    #[serde(default)]
    pub status: String,
    /// The implementation lifecycle status (pending/in-progress/complete/n/a).
    #[serde(default)]
    pub implementation: String,
    /// The governance risk level (low/medium/high/critical).
    #[serde(default)]
    pub governance: String,
    /// The team that owns this feature.
    #[serde(default)]
    pub owner: String,
    /// The logical group this feature belongs to.
    #[serde(default)]
    pub group: String,
    /// List of feature IDs that this feature depends on.
    #[serde(default)]
    pub depends_on: Vec<String>,
    /// List of source files that implement this feature.
    pub impl_files: Vec<String>,
    /// List of test files that verify this feature.
    pub test_files: Vec<String>,
    /// List of violations found associated with this feature.
    pub violations: Vec<Violation>,
}

/// The root structure representing the entire graph of features and their relationships.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct FeatureGraph {
    /// The version of the schema used for this graph.
    pub schema_version: String,
    /// A fingerprint hash of the graph structure for change detection.
    pub graph_fingerprint: String,
    // Use BTreeMap for deterministic serialization
    /// The collection of feature nodes in the graph.
    pub features: Vec<FeatureNode>,
    /// Global violations that are not specific to a single feature.
    pub violations: Vec<Violation>,
}

impl FeatureGraph {
    pub fn new() -> Self {
        Self {
            schema_version: "1.0".to_string(),
            graph_fingerprint: String::new(),
            features: Vec::new(),
            violations: Vec::new(),
        }
    }
}

impl Default for FeatureGraph {
    fn default() -> Self {
        Self::new()
    }
}
