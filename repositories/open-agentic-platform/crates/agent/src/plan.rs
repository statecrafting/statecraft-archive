// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Bartek Kus
// Feature: 043-agent-organizer — ExecutionPlan JSON contract (specs/043-agent-organizer/spec.md)

use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

/// Optional caller context for `plan(request, context?)` (FR-001).
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
pub struct PlanContext {
    /// When set, used as the plan `request_id`; otherwise the API may generate one.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub request_id: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PlanMode {
    Direct,
    Delegated,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ComplexityBand {
    Simple,
    Moderate,
    Complex,
    HighlyComplex,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AgentRole {
    Lead,
    Support,
    Reviewer,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ModelTier {
    Haiku,
    Sonnet,
    Opus,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct TeamAgent {
    pub agent_id: String,
    pub role: AgentRole,
    pub justification: String,
    pub model: ModelTier,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct TeamBlock {
    pub agents: Vec<TeamAgent>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct WorkflowPhase {
    pub id: String,
    pub name: String,
    pub agents: Vec<String>,
    pub task: String,
    pub depends_on: Vec<String>,
    pub output: String,
    pub success_gate: String,
    pub model: ModelTier,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct WorkflowBlock {
    pub phases: Vec<WorkflowPhase>,
}

/// Per-signal contributions and aggregate score from deterministic scoring (FR-002).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ComplexityBreakdown {
    pub score: u8,
    pub band: ComplexityBand,
    /// Individual signal contributions (same keys as Architecture table in spec 043).
    pub signals: BTreeMap<String, f64>,
}

/// Complexity block embedded in [`ExecutionPlan`] (includes optional mandatory trigger from Phase 2).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ComplexityBlock {
    pub score: u8,
    pub band: ComplexityBand,
    pub signals: BTreeMap<String, f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub mandatory_trigger: Option<String>,
}

impl From<ComplexityBreakdown> for ComplexityBlock {
    fn from(value: ComplexityBreakdown) -> Self {
        Self {
            score: value.score,
            band: value.band,
            signals: value.signals,
            mandatory_trigger: None,
        }
    }
}

/// JSON execution plan consumed by the orchestration layer (NF-003).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ExecutionPlan {
    pub request_id: String,
    pub mode: PlanMode,
    pub complexity: ComplexityBlock,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub team: Option<TeamBlock>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub workflow: Option<WorkflowBlock>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub warnings: Option<Vec<String>>,
}

/// Map numeric score to band per spec § Architecture (score bands).
pub fn band_from_score(score: u8) -> ComplexityBand {
    match score {
        0..=25 => ComplexityBand::Simple,
        26..=50 => ComplexityBand::Moderate,
        51..=75 => ComplexityBand::Complex,
        _ => ComplexityBand::HighlyComplex,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn execution_plan_round_trips_json() {
        let plan = ExecutionPlan {
            request_id: "req-1".to_string(),
            mode: PlanMode::Direct,
            complexity: ComplexityBlock {
                score: 10,
                band: ComplexityBand::Simple,
                signals: BTreeMap::from([("prompt_length".to_string(), 5.0)]),
                mandatory_trigger: None,
            },
            team: None,
            workflow: None,
            warnings: Some(vec!["registry empty".to_string()]),
        };
        let json = serde_json::to_string_pretty(&plan).expect("serialize");
        let back: ExecutionPlan = serde_json::from_str(&json).expect("deserialize");
        assert_eq!(plan, back);
    }

    #[test]
    fn band_boundaries_match_spec() {
        assert_eq!(band_from_score(25), ComplexityBand::Simple);
        assert_eq!(band_from_score(26), ComplexityBand::Moderate);
        assert_eq!(band_from_score(50), ComplexityBand::Moderate);
        assert_eq!(band_from_score(51), ComplexityBand::Complex);
        assert_eq!(band_from_score(75), ComplexityBand::Complex);
        assert_eq!(band_from_score(76), ComplexityBand::HighlyComplex);
        assert_eq!(band_from_score(100), ComplexityBand::HighlyComplex);
    }
}
