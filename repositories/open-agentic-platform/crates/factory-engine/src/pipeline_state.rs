// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Bartek Kus
// Spec: specs/075-factory-workflow-engine/spec.md — FR-009

//! Factory-specific pipeline state maintained alongside the orchestrator's `WorkflowState`.

use serde::{Deserialize, Serialize};

/// Current phase of an Factory pipeline.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum FactoryPhase {
    /// Process stages (s0–s5): deriving the Build Spec.
    Process,
    /// Scaffolding (s6a–s6g): generating code from the Build Spec.
    Scaffolding,
    /// Pipeline completed successfully.
    Complete,
    /// Pipeline failed and halted.
    Failed,
}

/// Factory-specific state tracked alongside the generic `WorkflowState` (FR-009).
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct FactoryPipelineState {
    /// Unique pipeline identifier (matches the workflow's `run_id`).
    pub pipeline_id: String,
    /// Adapter name.
    pub adapter: String,
    /// SHA-256 hash of the frozen Build Spec (set after stage 5 approval).
    pub build_spec_hash: Option<String>,
    /// Current pipeline phase.
    pub phase: FactoryPhase,
    /// Scaffolding progress (populated during Phase 2).
    pub scaffolding: Option<ScaffoldingProgress>,
    /// Cumulative token usage across the pipeline.
    pub total_tokens: u64,
    /// ID of the most recent completed pipeline for the same project/adapter (082 FR-022).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub previous_pipeline_id: Option<String>,
    /// `s-1-extract` summary recorded by the engine when the typed-extraction
    /// path is taken (spec 120 FR-015).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub s1_extract_summary: Option<S1ExtractSummary>,
}

/// Summary of one `s-1-extract` invocation, surfaced in the OPC pipeline view
/// (spec 120 FR-015).
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub struct S1ExtractSummary {
    pub objects_processed: u32,
    pub deterministic_count: u32,
    pub agent_yielded_count: u32,
    pub failed_count: u32,
}

/// Detailed scaffolding progress tracking.
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub struct ScaffoldingProgress {
    pub entities_completed: Vec<String>,
    pub entities_failed: Vec<FailedFeature>,
    #[serde(default)]
    pub seed_completed: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub seed_failed: Option<FailedFeature>,
    pub operations_completed: Vec<String>,
    pub operations_failed: Vec<FailedFeature>,
    pub pages_completed: Vec<String>,
    pub pages_failed: Vec<FailedFeature>,
}

/// A scaffolding feature that failed after all retries.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct FailedFeature {
    pub name: String,
    pub step_id: String,
    pub retries: u32,
    pub last_error: String,
}

impl FactoryPipelineState {
    /// Create initial state for a new pipeline.
    pub fn new(pipeline_id: impl Into<String>, adapter: impl Into<String>) -> Self {
        Self {
            pipeline_id: pipeline_id.into(),
            adapter: adapter.into(),
            build_spec_hash: None,
            phase: FactoryPhase::Process,
            scaffolding: None,
            total_tokens: 0,
            previous_pipeline_id: None,
            s1_extract_summary: None,
        }
    }

    /// Record the result of an `s-1-extract` run for downstream surfacing.
    pub fn record_extraction_summary(
        &mut self,
        report: &crate::stages::s_minus_1_extract::ExtractionStageReport,
    ) {
        self.s1_extract_summary = Some(S1ExtractSummary {
            objects_processed: (report.stored.len() + report.failed.len()) as u32,
            deterministic_count: report.deterministic_count,
            agent_yielded_count: report.agent_yielded_count,
            failed_count: report.failed.len() as u32,
        });
    }

    /// Transition to scaffolding phase after Build Spec freeze.
    pub fn transition_to_scaffolding(&mut self, build_spec_hash: String) {
        self.build_spec_hash = Some(build_spec_hash);
        self.phase = FactoryPhase::Scaffolding;
        self.scaffolding = Some(ScaffoldingProgress::default());
    }

    /// Mark pipeline as complete.
    pub fn mark_complete(&mut self) {
        self.phase = FactoryPhase::Complete;
    }

    /// Mark pipeline as failed.
    pub fn mark_failed(&mut self) {
        self.phase = FactoryPhase::Failed;
    }

    /// Record entity completion.
    pub fn entity_completed(&mut self, name: impl Into<String>) {
        if let Some(ref mut sp) = self.scaffolding {
            sp.entities_completed.push(name.into());
        }
    }

    /// Record entity failure.
    pub fn entity_failed(&mut self, feature: FailedFeature) {
        if let Some(ref mut sp) = self.scaffolding {
            sp.entities_failed.push(feature);
        }
    }

    /// Record seed step completion.
    pub fn seed_completed(&mut self) {
        if let Some(ref mut sp) = self.scaffolding {
            sp.seed_completed = true;
        }
    }

    /// Record seed step failure.
    pub fn seed_failed(&mut self, feature: FailedFeature) {
        if let Some(ref mut sp) = self.scaffolding {
            sp.seed_failed = Some(feature);
        }
    }

    /// Record operation completion.
    pub fn operation_completed(&mut self, name: impl Into<String>) {
        if let Some(ref mut sp) = self.scaffolding {
            sp.operations_completed.push(name.into());
        }
    }

    /// Record operation failure.
    pub fn operation_failed(&mut self, feature: FailedFeature) {
        if let Some(ref mut sp) = self.scaffolding {
            sp.operations_failed.push(feature);
        }
    }

    /// Record page completion.
    pub fn page_completed(&mut self, name: impl Into<String>) {
        if let Some(ref mut sp) = self.scaffolding {
            sp.pages_completed.push(name.into());
        }
    }

    /// Record page failure.
    pub fn page_failed(&mut self, feature: FailedFeature) {
        if let Some(ref mut sp) = self.scaffolding {
            sp.pages_failed.push(feature);
        }
    }

    /// Add token usage.
    pub fn add_tokens(&mut self, tokens: u64) {
        self.total_tokens += tokens;
    }

    /// Persist state as JSON to a file path.
    pub fn save_to_file(&self, path: &std::path::Path) -> std::io::Result<()> {
        let json = serde_json::to_string_pretty(self).map_err(std::io::Error::other)?;
        std::fs::write(path, json)
    }

    /// Load state from a JSON file.
    pub fn load_from_file(path: &std::path::Path) -> std::io::Result<Self> {
        let json = std::fs::read_to_string(path)?;
        serde_json::from_str(&json).map_err(std::io::Error::other)
    }
}

impl ScaffoldingProgress {
    /// Total features attempted.
    pub fn total_attempted(&self) -> usize {
        self.entities_completed.len()
            + self.entities_failed.len()
            + self.operations_completed.len()
            + self.operations_failed.len()
            + self.pages_completed.len()
            + self.pages_failed.len()
    }

    /// Total features that succeeded.
    pub fn total_succeeded(&self) -> usize {
        self.entities_completed.len() + self.operations_completed.len() + self.pages_completed.len()
    }

    /// Total features that failed.
    pub fn total_failed(&self) -> usize {
        self.entities_failed.len() + self.operations_failed.len() + self.pages_failed.len()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn initial_state() {
        let state = FactoryPipelineState::new("run-123", "acme-vue-encore");
        assert_eq!(state.phase, FactoryPhase::Process);
        assert!(state.build_spec_hash.is_none());
        assert!(state.scaffolding.is_none());
    }

    #[test]
    fn phase_transitions() {
        let mut state = FactoryPipelineState::new("run-123", "acme-vue-encore");

        state.transition_to_scaffolding("abc123def".into());
        assert_eq!(state.phase, FactoryPhase::Scaffolding);
        assert_eq!(state.build_spec_hash.as_deref(), Some("abc123def"));
        assert!(state.scaffolding.is_some());

        state.entity_completed("Organization");
        state.entity_completed("Site");
        assert_eq!(
            state.scaffolding.as_ref().unwrap().entities_completed.len(),
            2
        );

        state.mark_complete();
        assert_eq!(state.phase, FactoryPhase::Complete);
    }

    #[test]
    fn scaffolding_progress_counts() {
        let mut sp = ScaffoldingProgress::default();
        sp.entities_completed.push("Org".into());
        sp.entities_completed.push("Site".into());
        sp.operations_completed.push("list-orgs".into());
        sp.pages_failed.push(FailedFeature {
            name: "dashboard".into(),
            step_id: "s6d-ui-dashboard".into(),
            retries: 3,
            last_error: "compile error".into(),
        });

        assert_eq!(sp.total_succeeded(), 3);
        assert_eq!(sp.total_failed(), 1);
        assert_eq!(sp.total_attempted(), 4);
    }

    #[test]
    fn round_trip_serialization() {
        let mut state = FactoryPipelineState::new("run-456", "acme-vue-encore");
        state.transition_to_scaffolding("hash".into());
        state.entity_completed("Widget");
        state.add_tokens(5000);

        let json = serde_json::to_string(&state).unwrap();
        let restored: FactoryPipelineState = serde_json::from_str(&json).unwrap();
        assert_eq!(restored.pipeline_id, "run-456");
        assert_eq!(restored.total_tokens, 5000);
        assert_eq!(
            restored.scaffolding.unwrap().entities_completed,
            vec!["Widget"]
        );
    }
}
