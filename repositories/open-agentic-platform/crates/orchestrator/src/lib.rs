// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Bartek Kus
// Spec: specs/044-multi-agent-orchestration/spec.md

//! Multi-agent orchestration with file-based artifact passing (Feature 044)
//! and workflow state persistence primitives (Feature 052).
//!
//! Phase 1: manifest parsing, DAG validation, artifact path helpers, effort classification.
//! Phase 2–3: JSON state persistence + checkpoints/approvals (Feature 052).
//! Phase 4: SQLite state backend (Feature 052).

pub mod agent_identity;
pub mod artifact;
pub mod budget_gate;
pub mod circuit_breaker;
pub mod claude_executor;
pub mod cli_gate;
pub mod effort;
pub mod gates;
#[cfg(feature = "distributed")]
pub mod hiqlite_store;
pub mod http;
pub mod manifest;
pub mod output_filter;
pub mod promotion;
pub mod provider_executor;
pub mod scheduler;
#[cfg(feature = "local-sqlite")]
pub mod sqlite_state;
#[cfg(feature = "local-sqlite")]
pub mod sse;
pub mod state;
pub mod store;
pub mod store_config;
pub mod verify;

pub use agent_identity::AgentIdentity;
#[cfg(feature = "local-sqlite")]
pub use artifact::ArtifactMetadataStore;
pub use artifact::{
    ArtifactLineage, ArtifactManager, ArtifactRecord, CasArtifact, ContentAddressedStore,
    DEFAULT_ARTIFACT_DIR, DEFAULT_CAS_DIR, LineageRelation,
};
pub use budget_gate::{
    BudgetBreach, BudgetGate, ChainedPreStepGate, IntentDedupGate, OscillationGate,
    RunBudgetConsumption, RunBudgetMeter,
};
pub use circuit_breaker::{CircuitBreakerConfig, CircuitBreakerState};
pub use claude_executor::{
    AgentPromptLookup, ClaudeCodeExecutor, StandardsResolver, StepEvent, StepEventHandler,
    ThinkingLevel,
};
pub use cli_gate::{AutoApproveGateHandler, CliGateHandler};
pub use effort::{EffortLevel, classify_from_task};
pub use gates::{GateError, GateHandler, GateOutcome, evaluate_gate, evaluate_gate_if_present};
#[cfg(feature = "distributed")]
pub use hiqlite_store::{HiqliteEventNotifier, HiqliteWorkflowStore};
pub use http::HttpState;
pub use manifest::ApprovalEscalation;
pub use manifest::{VerifyCommand, WorkflowManifest, WorkflowStep, split_input_ref};
pub use promotion::{
    PromotionCheck, PromotionEligibility, SyncStatus, SyncTracker, check_promotion_eligibility,
};
pub use provider_executor::{ProviderRegistryExecutor, parse_provider_model};
#[cfg(feature = "local-sqlite")]
pub use scheduler::SqliteSchedulerStore;
pub use scheduler::{
    CreateScheduleRequest, Schedule, ScheduleTrigger, ScheduledRunExecutor, SchedulerEngine,
    SchedulerStore, SessionContext as ScheduleSessionContext,
};
#[cfg(feature = "local-sqlite")]
pub use sqlite_state::{
    LocalEventNotifier, SqliteWorkflowStore, sqlite_db_path_for_run, sqlite_db_path_for_run_dir,
};
pub use state::{
    GateInfo, StepExecutionStatus, StepState, WorkflowState, WorkflowStateSummary, WorkflowStatus,
    load_workflow_state, state_file_path_for_run, state_file_path_for_run_dir,
    write_workflow_state_atomic,
};
pub use store::{EventNotifier, EventReceiver, PersistedEvent, ReplaySubscription, WorkflowStore};
pub use store_config::{PersistencePair, StoreBackend, build_persistence};
pub use verify::{VerifyOutcome, build_retry_instruction, run_verify_commands};

use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use serde_json::Value as JsonValue;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;
use thiserror::Error;
use uuid::Uuid;

/// Orchestrator-facing errors (044 contract + load-time validation).
#[derive(Debug, Error)]
pub enum OrchestratorError {
    #[error("cycle detected: {message}")]
    CycleDetected { message: String },
    #[error("invalid manifest: {reason}")]
    InvalidManifest { reason: String },
    #[error("dependency missing at step {step_id}: {artifact_path}")]
    DependencyMissing {
        step_id: String,
        artifact_path: PathBuf,
    },
    #[error("step failed: {step_id} — {reason}")]
    StepFailed { step_id: String, reason: String },
    #[error("agent not found: {agent_id}")]
    AgentNotFound { agent_id: String },
    #[error("state persistence error: {reason}")]
    StatePersistence { reason: String },
    #[error("verification failed at step {step_id}: {reason}")]
    VerificationFailed { step_id: String, reason: String },
}

/// Per-step status after or during a run (044 FR-006, FR-008, 075 FR-005).
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum StepStatus {
    Pending,
    Running,
    Success,
    Failure,
    /// Post-step verification failed (075 FR-005).
    VerificationFailed,
    Skipped,
    Cancelled,
}

/// Serializable run summary (044 FR-006).
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct RunSummary {
    pub run_id: Uuid,
    pub steps: Vec<StepSummaryEntry>,
    /// Workflow-level metadata: governance_mode, promotion result (097/098).
    #[serde(default, skip_serializing_if = "HashMap::is_empty")]
    pub metadata: HashMap<String, serde_json::Value>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct StepSummaryEntry {
    pub step_id: String,
    pub agent: String,
    pub status: StepStatus,
    pub input_artifacts: Vec<PathBuf>,
    pub output_artifacts: Vec<PathBuf>,
    pub tokens_used: Option<u64>,
    /// Total API cost in USD for this step.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cost_usd: Option<f64>,
    /// Wall-clock duration in milliseconds.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub duration_ms: Option<u64>,
    /// Number of agentic turns.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub num_turns: Option<u32>,
    /// Number of retries before success.
    #[serde(default, skip_serializing_if = "is_zero")]
    pub retry_count: u32,
    /// SHA-256 hex hashes of output artifacts, keyed by filename (082 FR-002).
    #[serde(default, skip_serializing_if = "HashMap::is_empty")]
    pub output_hashes: HashMap<String, String>,
}

fn is_zero(v: &u32) -> bool {
    *v == 0
}

/// Per-step actuals handed to a [`PreStepGate`] after a step completes, so a
/// metering gate (spec 202 FR-002 `BudgetGate`) can accumulate run-level
/// consumption. This is a thin projection of the metrics the dispatch loop
/// already records; it is not persisted (the canonical record stays
/// [`StepSummaryEntry`]).
#[derive(Clone, Debug, Default)]
pub struct StepActuals {
    pub step_id: String,
    pub tokens_used: Option<u64>,
    pub cost_usd: Option<f64>,
    pub duration_ms: Option<u64>,
    pub num_turns: Option<u32>,
    /// Whether the step reached `Success`. Consumed by the FR-003b oscillation
    /// detector (`OscillationGate`).
    pub success: bool,
    /// Intra-step retry count for this step (the `attempt` counter from
    /// `dispatch_with_verify`'s pre/post-verify retry loop). A step that
    /// eventually succeeded but needed retries has `retry_count > 0`; this is
    /// the realizable cross-step "wobble" signal the FR-003b oscillation
    /// detector feeds on (a hard failure halts the run, so it cannot repeat).
    pub retry_count: u32,
    /// The dispatched step's raw instruction text, consumed by the FR-003a
    /// intent-dedup detector (`IntentDedupGate`) to compute the intent
    /// signature. `None` on paths that do not populate it (e.g. the
    /// hard-failure branch, which is inert under halt-on-failure); a gate
    /// treats `None` as a no-op, same posture as an absent metric field.
    pub instruction: Option<String>,
}

#[derive(Clone, Debug)]
pub struct DispatchResult {
    pub tokens_used: Option<u64>,
    /// SHA-256 hex hashes of output artifacts, keyed by filename (082 FR-002).
    pub output_hashes: HashMap<String, String>,
    /// Session ID from the claude CLI, used for `--resume` on retries.
    pub session_id: Option<String>,
    /// Total API cost in USD for this step dispatch.
    pub cost_usd: Option<f64>,
    /// Wall-clock duration in milliseconds.
    pub duration_ms: Option<u64>,
    /// Number of agentic turns.
    pub num_turns: Option<u32>,
    /// Whether the run was governed or bypassed (098 Slice 1).
    pub governance_mode: Option<String>,
}

/// Plan for resuming a workflow from a previously persisted `state.json` (052 FR-003).
///
/// Callers can use this to:
/// - decide whether to offer a resume prompt (presence of completed + remaining steps)
/// - configure step-skipping in their own dispatch loop or UI.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct ResumePlan {
    /// IDs of steps that were already completed in the persisted state.
    pub completed_step_ids: Vec<String>,
    /// Index (into the manifest's `steps` array) of the first non-completed step.
    pub first_non_completed_step_index: usize,
}

#[derive(Clone, Debug)]
pub struct DispatchRequest {
    pub step_id: String,
    pub agent_id: String,
    pub effort: EffortLevel,
    pub system_prompt: String,
    pub input_artifacts: Vec<PathBuf>,
    pub output_artifacts: Vec<PathBuf>,
    /// If set, resume this claude session instead of starting fresh.
    pub resume_session_id: Option<String>,
    /// Active project ID for this execution (spec 119).
    pub project_id: Option<String>,
}

#[async_trait]
pub trait AgentRegistry: Send + Sync {
    async fn has_agent(&self, agent_id: &str) -> bool;
}

#[async_trait]
pub trait GovernedExecutor: Send + Sync {
    async fn dispatch_step(&self, request: DispatchRequest) -> Result<DispatchResult, String>;
}

/// Spec 198 FR-005 — awaited before each step executes. Used by the OPC
/// run path to renew the run-grant at every stage boundary; `Err(reason)`
/// fails the step fail-closed (the run pauses, the reason is surfaced).
#[async_trait]
pub trait PreStepGate: Send + Sync {
    async fn before_step(&self, step_id: &str) -> Result<(), String>;

    /// Called after each step completes, letting a metering gate accumulate
    /// run-level consumption (spec 202 FR-002). The default is a no-op, so
    /// non-metering gates (e.g. `GrantRenewalGate`) are unaffected and need no
    /// change. The dispatch loop invokes this on the success path with the
    /// just-completed step's actuals.
    async fn after_step(&self, _actuals: &StepActuals) {}
}

/// Optional dispatch configuration for gates and verification (052/075).
#[derive(Default)]
pub struct DispatchOptions {
    /// Gate handler for checkpoint/approval gates. If `None`, gates are skipped.
    pub gate_handler: Option<Arc<dyn GateHandler>>,
    /// Project root for verification commands. Required if any step has `post_verify`.
    pub project_root: Option<PathBuf>,
    /// Step IDs to skip (mark as Success without dispatch). Used for resume after failure.
    pub skip_completed_steps: std::collections::HashSet<String>,
    /// Content-addressed store for artifact promotion (094 Slice 2).
    /// If `Some`, completed step artifacts are promoted to CAS for cross-run persistence.
    pub cas: Option<Arc<ContentAddressedStore>>,
    /// Artifact metadata store for provenance recording (094 Slices 3-4).
    /// When `Some`, artifact records and lineage are persisted after CAS promotion.
    /// Wrapped in `Mutex` because `rusqlite::Connection` is `Send` but not `Sync`.
    #[cfg(feature = "local-sqlite")]
    pub artifact_metadata: Option<Arc<std::sync::Mutex<artifact::ArtifactMetadataStore>>>,
    /// Governance mode for this dispatch: `"governed"` or `"bypass"` (098 Slice 1).
    pub governance_mode: Option<String>,
    /// Platform sync tracker for promotion eligibility (099 Slice 2).
    pub sync_tracker: Option<promotion::SyncTracker>,
    /// Hook to create a checkpoint when a gate is reached (095 SC-095-4).
    /// Called with `(step_id, checkpoint_id)`, returns `Ok(merkle_root)` or an error.
    #[allow(clippy::type_complexity)]
    pub on_gate_checkpoint: Option<Arc<dyn Fn(&str, &str) -> Result<String, String> + Send + Sync>>,
    /// Filesystem project-path identity inherited from the spec 157 OPC
    /// session model. Identity key for spec 173 FR-001 / FR-002.
    /// `None` when the workflow is initiated outside OPC.
    pub project_path: Option<String>,
    /// OPC session UUID that initiated this workflow (spec 173 trace field).
    /// Consumed by spec 172's Live Sessions panel; not an identity key.
    /// `None` when the workflow is initiated outside OPC.
    pub originating_session: Option<String>,
    /// Spec 198 FR-005 — awaited before each step executes. Used by the OPC
    /// run path to renew the run-grant at every stage boundary; `Err(reason)`
    /// fails the step fail-closed (the run pauses, the reason is surfaced).
    pub pre_step: Option<Arc<dyn PreStepGate>>,
}

/// Outcome of gate evaluation in the non-persisted dispatch path.
enum GateAction {
    /// Gate cleared — proceed with dispatch.
    Proceed,
    /// Approval timed out with Skip escalation — skip this step.
    Skip,
}

/// Evaluate a gate in the simple (non-persisted) dispatch path.
async fn handle_gate_simple(
    step_id: &str,
    gate: &manifest::StepGateConfig,
    handler: &dyn GateHandler,
) -> Result<GateAction, OrchestratorError> {
    match gate {
        manifest::StepGateConfig::Checkpoint { label } => {
            handler
                .await_checkpoint(step_id, label.as_deref())
                .await
                .map_err(|e| OrchestratorError::StepFailed {
                    step_id: step_id.to_string(),
                    reason: format!("gate error: {e}"),
                })?;
            Ok(GateAction::Proceed)
        }
        manifest::StepGateConfig::Approval {
            timeout_ms,
            escalation,
            checkpoint_id: _,
        } => {
            let duration = Duration::from_millis(*timeout_ms);
            match tokio::time::timeout(duration, handler.await_approval(step_id, *timeout_ms)).await
            {
                Ok(Ok(())) => Ok(GateAction::Proceed),
                Ok(Err(e)) => Err(OrchestratorError::StepFailed {
                    step_id: step_id.to_string(),
                    reason: format!("gate error: {e}"),
                }),
                Err(_elapsed) => {
                    let esc = escalation
                        .clone()
                        .unwrap_or(manifest::ApprovalEscalation::Fail);
                    match esc {
                        manifest::ApprovalEscalation::Fail => Err(OrchestratorError::StepFailed {
                            step_id: step_id.to_string(),
                            reason: "approval gate timed out".to_string(),
                        }),
                        manifest::ApprovalEscalation::Skip => Ok(GateAction::Skip),
                        manifest::ApprovalEscalation::Notify => Ok(GateAction::Proceed),
                    }
                }
            }
        }
    }
}

/// Run the dispatch+verify retry loop for a single step (075 FR-005, FR-006).
/// Accumulated metrics from dispatching a step (possibly with retries).
struct StepMetrics {
    status: StepStatus,
    tokens_used: Option<u64>,
    cost_usd: Option<f64>,
    duration_ms: Option<u64>,
    num_turns: Option<u32>,
    retry_count: u32,
}

/// Dispatches a single step with optional post-verification and retry.
///
/// Returns accumulated metrics or an error.
#[allow(clippy::too_many_arguments)]
async fn dispatch_with_verify(
    step: &WorkflowStep,
    executor: &dyn GovernedExecutor,
    artifact_base: &ArtifactManager,
    run_id: Uuid,
    input_paths: &[PathBuf],
    output_paths: &[PathBuf],
    project_root: Option<&Path>,
    project_id: Option<&str>,
) -> Result<StepMetrics, OrchestratorError> {
    let max_retries = step.max_retries.unwrap_or(3);
    let mut attempt = 0u32;
    let mut total_tokens = 0u64;
    let mut total_cost = 0.0f64;
    let mut total_duration_ms = 0u64;
    let mut total_turns = 0u32;
    let original_prompt = build_step_system_prompt(artifact_base, run_id, step);
    let mut current_prompt = original_prompt.clone();
    let mut resume_session_id: Option<String> = None;

    loop {
        let request = DispatchRequest {
            step_id: step.id.clone(),
            agent_id: step.agent.clone(),
            effort: step.effort,
            system_prompt: current_prompt.clone(),
            input_artifacts: input_paths.to_vec(),
            output_artifacts: output_paths.to_vec(),
            resume_session_id: resume_session_id.clone(),
            project_id: project_id.map(str::to_owned),
        };

        let result = executor.dispatch_step(request).await.map_err(|reason| {
            OrchestratorError::StepFailed {
                step_id: step.id.clone(),
                reason,
            }
        })?;

        total_tokens += result.tokens_used.unwrap_or(0);
        total_cost += result.cost_usd.unwrap_or(0.0);
        total_duration_ms += result.duration_ms.unwrap_or(0);
        total_turns += result.num_turns.unwrap_or(0);
        // Capture session ID for potential retry continuation.
        if result.session_id.is_some() {
            resume_session_id = result.session_id.clone();
        }

        // Check declared outputs exist.
        if let Some(missing_output) = output_paths.iter().find(|p| !p.exists()) {
            return Err(OrchestratorError::StepFailed {
                step_id: step.id.clone(),
                reason: format!(
                    "agent did not produce declared output: {}",
                    missing_output.display()
                ),
            });
        }

        // Run fast pre-verification if configured — catches quick errors
        // (e.g., type errors) without running the full build+test suite.
        if let (Some(pre_cmds), Some(root)) = (&step.pre_verify, project_root) {
            match run_verify_commands(pre_cmds, root).await {
                VerifyOutcome::Passed => {
                    // Pre-check passed, continue to full post_verify below.
                }
                VerifyOutcome::Failed {
                    command,
                    output,
                    exit_code,
                    ..
                } => {
                    attempt += 1;
                    let detail = format!(
                        "pre-verify command `{command}` failed (exit {:?}):\n{output}",
                        exit_code
                    );
                    if attempt > max_retries {
                        return Err(OrchestratorError::VerificationFailed {
                            step_id: step.id.clone(),
                            reason: format!(
                                "pre-verification failed after {max_retries} retries:\n{detail}"
                            ),
                        });
                    }
                    current_prompt =
                        build_retry_instruction(&original_prompt, &detail, attempt, max_retries);
                    continue;
                }
            }
        }

        // Run post-step verification if configured (075 FR-005).
        if let (Some(verify_cmds), Some(root)) = (&step.post_verify, project_root) {
            match run_verify_commands(verify_cmds, root).await {
                VerifyOutcome::Passed => {
                    return Ok(StepMetrics {
                        status: StepStatus::Success,
                        tokens_used: Some(total_tokens),
                        cost_usd: if total_cost > 0.0 {
                            Some(total_cost)
                        } else {
                            None
                        },
                        duration_ms: if total_duration_ms > 0 {
                            Some(total_duration_ms)
                        } else {
                            None
                        },
                        num_turns: if total_turns > 0 {
                            Some(total_turns)
                        } else {
                            None
                        },
                        retry_count: attempt,
                    });
                }
                VerifyOutcome::Failed {
                    command,
                    output,
                    exit_code,
                    ..
                } => {
                    attempt += 1;
                    let detail = format!(
                        "verify command `{command}` failed (exit {:?}):\n{output}",
                        exit_code
                    );
                    if attempt > max_retries {
                        return Err(OrchestratorError::VerificationFailed {
                            step_id: step.id.clone(),
                            reason: format!(
                                "verification failed after {max_retries} retries:\n{detail}"
                            ),
                        });
                    }
                    // Rebuild prompt with failure context (075 FR-006).
                    // When resuming a session, use a focused retry message as the user prompt.
                    current_prompt =
                        build_retry_instruction(&original_prompt, &detail, attempt, max_retries);
                    continue;
                }
            }
        }

        // No verification configured — success.
        return Ok(StepMetrics {
            status: StepStatus::Success,
            tokens_used: Some(total_tokens),
            cost_usd: if total_cost > 0.0 {
                Some(total_cost)
            } else {
                None
            },
            duration_ms: if total_duration_ms > 0 {
                Some(total_duration_ms)
            } else {
                None
            },
            num_turns: if total_turns > 0 {
                Some(total_turns)
            } else {
                None
            },
            retry_count: attempt,
        });
    }
}

impl RunSummary {
    /// Persist `summary.json` under the run directory for this summary's `run_id`.
    pub fn write_to_disk(&self, artifact_base: &ArtifactManager) -> Result<(), OrchestratorError> {
        let run_dir = artifact_base.run_dir(self.run_id);
        let sj =
            serde_json::to_string_pretty(self).map_err(|e| OrchestratorError::InvalidManifest {
                reason: format!("serialize summary: {e}"),
            })?;
        std::fs::write(run_dir.join("summary.json"), sj).map_err(|e| {
            OrchestratorError::InvalidManifest {
                reason: format!("write summary.json: {e}"),
            }
        })?;
        Ok(())
    }
}

/// Writes frozen `manifest.yaml` and placeholder `summary.json` under the run directory.
///
/// If `phase_name` is provided, also writes `manifest-{phase_name}.yaml` to preserve
/// phase-specific manifests when the same run directory is reused across phases
/// (e.g., Phase 1 "process" and Phase 2 "scaffold"). The main `manifest.yaml` is
/// always overwritten to reflect the current/latest phase for resume detection.
pub fn materialize_run_directory(
    artifact_base: &ArtifactManager,
    run_id: Uuid,
    manifest: &WorkflowManifest,
) -> Result<PathBuf, OrchestratorError> {
    materialize_run_directory_with_phase(artifact_base, run_id, manifest, None)
}

/// Like [`materialize_run_directory`] but also writes a phase-specific manifest file.
pub fn materialize_run_directory_with_phase(
    artifact_base: &ArtifactManager,
    run_id: Uuid,
    manifest: &WorkflowManifest,
    phase_name: Option<&str>,
) -> Result<PathBuf, OrchestratorError> {
    let run_dir = artifact_base.run_dir(run_id);
    std::fs::create_dir_all(&run_dir).map_err(|e| OrchestratorError::InvalidManifest {
        reason: format!("create run dir: {e}"),
    })?;
    let yaml = serde_yaml::to_string(manifest).map_err(|e| OrchestratorError::InvalidManifest {
        reason: format!("serialize manifest: {e}"),
    })?;
    // Always write manifest.yaml (current/latest phase, used by resume).
    std::fs::write(run_dir.join("manifest.yaml"), &yaml).map_err(|e| {
        OrchestratorError::InvalidManifest {
            reason: format!("write manifest.yaml: {e}"),
        }
    })?;
    // Write phase-specific manifest if a phase name is provided.
    if let Some(phase) = phase_name {
        let phase_file = format!("manifest-{phase}.yaml");
        std::fs::write(run_dir.join(&phase_file), &yaml).map_err(|e| {
            OrchestratorError::InvalidManifest {
                reason: format!("write {phase_file}: {e}"),
            }
        })?;
    }
    // Only write a placeholder summary.json if one does not already exist,
    // so that resume state from a prior run is preserved.
    let summary_path = run_dir.join("summary.json");
    if !summary_path.exists() {
        let summary = RunSummary {
            run_id,
            steps: vec![],
            metadata: HashMap::new(),
        };
        let sj = serde_json::to_string_pretty(&summary).map_err(|e| {
            OrchestratorError::InvalidManifest {
                reason: format!("serialize summary: {e}"),
            }
        })?;
        std::fs::write(&summary_path, sj).map_err(|e| OrchestratorError::InvalidManifest {
            reason: format!("write summary.json: {e}"),
        })?;
    }
    Ok(run_dir)
}

/// Computes a resume plan for a given manifest from an existing workflow state.
///
/// The plan implements 052 FR-003:
/// - all steps marked `"completed"` in the state are considered eligible for skipping
/// - resume begins at the first manifest step that is **not** marked completed
pub fn compute_resume_plan_from_state(
    state: &WorkflowState,
    manifest: &WorkflowManifest,
) -> Option<ResumePlan> {
    // Map step id → status for quick lookup.
    let status_by_id: HashMap<&str, &StepExecutionStatus> = state
        .steps
        .iter()
        .map(|s| (s.id.as_str(), &s.status))
        .collect();

    // Collect all completed step ids that still exist in the manifest.
    let mut completed_ids = Vec::new();
    for step in &manifest.steps {
        if matches!(
            status_by_id.get(step.id.as_str()),
            Some(StepExecutionStatus::Completed)
        ) {
            completed_ids.push(step.id.clone());
        }
    }

    // Find the first manifest step that is *not* marked completed in the state.
    let mut first_non_completed_index: Option<usize> = None;
    for (idx, step) in manifest.steps.iter().enumerate() {
        let is_completed = matches!(
            status_by_id.get(step.id.as_str()),
            Some(StepExecutionStatus::Completed)
        );
        if !is_completed {
            first_non_completed_index = Some(idx);
            break;
        }
    }

    if completed_ids.is_empty() {
        // No completed steps at all — nothing to resume.
        None
    } else {
        Some(ResumePlan {
            completed_step_ids: completed_ids,
            // If all steps completed, point past the end so the dispatcher
            // skips everything and the caller can proceed to the next phase.
            first_non_completed_step_index: first_non_completed_index
                .unwrap_or(manifest.steps.len()),
        })
    }
}

/// Loads run state (if present) and computes a resume plan.
///
/// This is the main entry point for 052 Phase 2 resume detection:
/// callers can invoke it at startup to decide whether to offer a resume
/// prompt and which steps to skip if the user chooses to resume.
///
/// Checks `state.json` first (written by [`dispatch_manifest_persisted`]),
/// then falls back to `summary.json` (written by [`dispatch_manifest`])
/// so that `factory-run` and other non-persisted callers can resume.
pub fn detect_resume_plan_for_run(
    artifact_base: &ArtifactManager,
    run_id: Uuid,
    manifest: &WorkflowManifest,
) -> Result<Option<ResumePlan>, OrchestratorError> {
    // Primary path: state.json written by the persisted dispatcher.
    let state_path = state_file_path_for_run(artifact_base, run_id);
    if state_path.exists() {
        let state = load_workflow_state(&state_path)?;
        return Ok(compute_resume_plan_from_state(&state, manifest));
    }

    // Fallback: summary.json written by dispatch_manifest / RunSummary::write_to_disk.
    let summary_path = artifact_base.run_dir(run_id).join("summary.json");
    if !summary_path.exists() {
        return Ok(None);
    }

    let raw = std::fs::read_to_string(&summary_path).map_err(|e| {
        OrchestratorError::StatePersistence {
            reason: format!("read summary.json: {e}"),
        }
    })?;
    let summary: RunSummary =
        serde_json::from_str(&raw).map_err(|e| OrchestratorError::StatePersistence {
            reason: format!("parse summary.json: {e}"),
        })?;

    // Build completed set from the summary's step statuses.
    let completed_ids: Vec<String> = manifest
        .steps
        .iter()
        .filter(|step| {
            summary
                .steps
                .iter()
                .any(|e| e.step_id == step.id && matches!(e.status, StepStatus::Success))
        })
        .map(|step| step.id.clone())
        .collect();

    let first_non_completed_index = manifest
        .steps
        .iter()
        .position(|s| !completed_ids.contains(&s.id));

    if !completed_ids.is_empty() {
        return Ok(Some(ResumePlan {
            completed_step_ids: completed_ids,
            first_non_completed_step_index: first_non_completed_index
                .unwrap_or(manifest.steps.len()),
        }));
    }

    // Last-resort fallback: summary.json may have been corrupted (e.g. overwritten
    // with empty steps by a prior bug). Probe the filesystem — if all declared
    // output artifacts for a step exist on disk, consider that step completed.
    let fs_completed: Vec<String> = manifest
        .steps
        .iter()
        .filter(|step| {
            !step.outputs.is_empty()
                && step.outputs.iter().all(|o| {
                    artifact_base
                        .output_artifact_path(run_id, &step.id, o)
                        .exists()
                })
        })
        .map(|step| step.id.clone())
        .collect();

    if fs_completed.is_empty() {
        Ok(None)
    } else {
        let first_non = manifest
            .steps
            .iter()
            .position(|s| !fs_completed.contains(&s.id));
        Ok(Some(ResumePlan {
            completed_step_ids: fs_completed,
            first_non_completed_step_index: first_non.unwrap_or(manifest.steps.len()),
        }))
    }
}

/// Resolves absolute artifact paths for a step's declared inputs (044).
pub fn resolve_input_paths(
    artifact_base: &ArtifactManager,
    run_id: Uuid,
    step: &WorkflowStep,
) -> Vec<PathBuf> {
    let mut out = Vec::new();
    for input in &step.inputs {
        if let Some((producer_id, file)) = split_input_ref(input) {
            out.push(artifact_base.output_artifact_path(run_id, producer_id, file));
        } else {
            out.push(PathBuf::from(input));
        }
    }
    out
}

/// Builds a system prompt for a single workflow step that satisfies 044 FR-004:
/// - includes absolute input artifact paths
/// - carries an explicit effort directive.
pub fn build_step_system_prompt(
    artifact_base: &ArtifactManager,
    run_id: Uuid,
    step: &WorkflowStep,
) -> String {
    let input_paths = resolve_input_paths(artifact_base, run_id, step);

    let effort_text = match step.effort {
        EffortLevel::Quick => "quick — single-pass, very concise (< 2k tokens), no sub-agent calls",
        EffortLevel::Investigate => "investigate — thorough analysis with tools (< 10k tokens)",
        EffortLevel::Deep => {
            "deep — exhaustive exploration, unrestricted depth (no hard token cap)"
        }
    };

    let mut prompt = String::new();
    prompt.push_str("You are a specialized agent executing one step in a multi-step workflow.\n\n");
    prompt.push_str("Step instruction:\n");
    prompt.push_str(&step.instruction);
    prompt.push_str("\n\n");

    if !input_paths.is_empty() {
        prompt.push_str("Input artifact paths (absolute):\n");
        for p in &input_paths {
            prompt.push_str("- ");
            prompt.push_str(&p.to_string_lossy());
            prompt.push('\n');
        }
        prompt.push('\n');
        prompt.push_str("You must read any needed context from these filesystem paths instead of expecting their contents in the conversation.\n");
        prompt.push_str("Do not assume relative paths; always use the absolute paths listed above when opening files.\n\n");
    } else {
        prompt.push_str("This step has no upstream artifact dependencies.\n\n");
    }

    if !step.outputs.is_empty() {
        prompt.push_str("Output artifact paths (write your results here):\n");
        for o in &step.outputs {
            let p = artifact_base.output_artifact_path(run_id, &step.id, o);
            prompt.push_str("- ");
            prompt.push_str(&p.to_string_lossy());
            prompt.push('\n');
        }
        prompt.push('\n');
    }

    prompt.push_str("Effort level for this step:\n");
    prompt.push_str(effort_text);
    prompt.push('\n');

    prompt
}

/// Dispatches a manifest using a no-op executor:
/// - checks that all required input artifacts exist before "running" a step (FR-002)
/// - marks steps as [`StepStatus::Success`] without invoking any agents
/// - on missing input, marks the step as [`StepStatus::Failure`], cascades [`StepStatus::Skipped`]
///   to dependents (FR-008), writes `summary.json`, and returns [`OrchestratorError::DependencyMissing`].
///
/// This is a Phase 2 scaffolding dispatcher — higher layers can later swap the
/// no-op execution for real governed agent runs without changing summary semantics.
pub fn dispatch_manifest_noop(
    artifact_base: &ArtifactManager,
    run_id: Uuid,
    manifest: &WorkflowManifest,
) -> Result<RunSummary, OrchestratorError> {
    let order = manifest.validate_and_order()?;
    let steps = &manifest.steps;

    // Pre-compute dependency relationships: which steps depend on a given producer step.
    let mut dependents: HashMap<&str, Vec<usize>> = HashMap::new();
    for (idx, step) in steps.iter().enumerate() {
        for input in &step.inputs {
            if let Some((producer_id, _file)) = split_input_ref(input) {
                dependents.entry(producer_id).or_default().push(idx);
            }
        }
    }

    // Track per-step status; default to Pending until processed.
    let mut statuses: Vec<StepStatus> = vec![StepStatus::Pending; steps.len()];

    // Helper: does this step depend on any failed or skipped step?
    let step_depends_on_failed_or_skipped = |idx: usize, statuses: &[StepStatus]| -> bool {
        let step = &steps[idx];
        for input in &step.inputs {
            if let Some((producer_id, _file)) = split_input_ref(input)
                && let Some(prod_idx) = steps.iter().position(|s| s.id == producer_id)
            {
                match statuses[prod_idx] {
                    StepStatus::Failure | StepStatus::Skipped | StepStatus::Cancelled => {
                        return true;
                    }
                    _ => {}
                }
            }
        }
        false
    };

    // Helper: resolve input paths for a specific step.
    let resolve_inputs_for_step =
        |step: &WorkflowStep| -> Vec<PathBuf> { resolve_input_paths(artifact_base, run_id, step) };

    // Process steps in topological order.
    for &idx in &order {
        // Already marked skipped from an upstream failure: respect that and continue.
        if matches!(statuses[idx], StepStatus::Skipped) {
            continue;
        }

        // If any of this step's producers failed or were skipped, mark as skipped (FR-008).
        if step_depends_on_failed_or_skipped(idx, &statuses) {
            statuses[idx] = StepStatus::Skipped;
            continue;
        }

        let step = &steps[idx];
        let input_paths = resolve_inputs_for_step(step);

        // Enforce FR-002: a step is not dispatched until all inputs exist.
        if let Some((missing_idx, missing_path)) = input_paths
            .iter()
            .enumerate()
            .find(|(_, p)| !p.exists())
            .map(|(i, p)| (i, p.clone()))
        {
            // Mark this step as failed.
            statuses[idx] = StepStatus::Failure;

            // Cascade skipped to direct dependents; they in turn will be skipped when processed
            // if they depend on a failed or skipped step.
            if let Some(dep_idxs) = dependents.get(step.id.as_str()) {
                for &d in dep_idxs {
                    if matches!(statuses[d], StepStatus::Pending | StepStatus::Running) {
                        statuses[d] = StepStatus::Skipped;
                    }
                }
            }

            // Build and persist summary before returning the error (FR-006 + FR-008).
            let mut summary_entries = Vec::with_capacity(steps.len());
            for (i, s) in steps.iter().enumerate() {
                let resolved_inputs = resolve_inputs_for_step(s);
                let output_paths: Vec<PathBuf> = s
                    .outputs
                    .iter()
                    .map(|o| artifact_base.output_artifact_path(run_id, &s.id, o))
                    .collect();
                summary_entries.push(StepSummaryEntry {
                    step_id: s.id.clone(),
                    agent: s.agent.clone(),
                    status: statuses[i].clone(),
                    input_artifacts: resolved_inputs,
                    output_artifacts: output_paths,
                    tokens_used: None,
                    cost_usd: None,
                    duration_ms: None,
                    num_turns: None,
                    retry_count: 0,
                    output_hashes: HashMap::new(),
                });
            }

            let summary = RunSummary {
                run_id,
                steps: summary_entries,
                metadata: HashMap::new(),
            };
            summary.write_to_disk(artifact_base)?;

            // Report which artifact was missing for this step.
            let _failing_input = &step.inputs[missing_idx];
            let artifact_path = missing_path;
            return Err(OrchestratorError::DependencyMissing {
                step_id: step.id.clone(),
                artifact_path,
            });
        }

        // All inputs present: in the no-op dispatcher we just mark success.
        statuses[idx] = StepStatus::Success;
    }

    // Build final run summary with resolved artifact paths.
    let mut summary_entries = Vec::with_capacity(steps.len());
    for (i, step) in steps.iter().enumerate() {
        let input_paths = resolve_inputs_for_step(step);
        let output_paths: Vec<PathBuf> = step
            .outputs
            .iter()
            .map(|o| artifact_base.output_artifact_path(run_id, &step.id, o))
            .collect();
        summary_entries.push(StepSummaryEntry {
            step_id: step.id.clone(),
            agent: step.agent.clone(),
            status: statuses[i].clone(),
            input_artifacts: input_paths,
            output_artifacts: output_paths,
            tokens_used: None,
            cost_usd: None,
            duration_ms: None,
            num_turns: None,
            retry_count: 0,
            output_hashes: HashMap::new(),
        });
    }

    let summary = RunSummary {
        run_id,
        steps: summary_entries,
        metadata: HashMap::new(),
    };
    summary.write_to_disk(artifact_base)?;
    Ok(summary)
}

#[allow(clippy::too_many_arguments)]
fn build_summary(
    artifact_base: &ArtifactManager,
    run_id: Uuid,
    steps: &[WorkflowStep],
    statuses: &[StepStatus],
    tokens_used: &[Option<u64>],
    costs_usd: &[Option<f64>],
    durations_ms: &[Option<u64>],
    num_turns: &[Option<u32>],
    retry_counts: &[u32],
    output_hashes: &[HashMap<String, String>],
) -> RunSummary {
    let mut summary_entries = Vec::with_capacity(steps.len());
    for (i, step) in steps.iter().enumerate() {
        let input_paths = resolve_input_paths(artifact_base, run_id, step);
        let output_paths: Vec<PathBuf> = step
            .outputs
            .iter()
            .map(|o| artifact_base.output_artifact_path(run_id, &step.id, o))
            .collect();
        summary_entries.push(StepSummaryEntry {
            step_id: step.id.clone(),
            agent: step.agent.clone(),
            status: statuses[i].clone(),
            input_artifacts: input_paths,
            output_artifacts: output_paths,
            tokens_used: tokens_used[i],
            cost_usd: costs_usd.get(i).copied().flatten(),
            duration_ms: durations_ms.get(i).copied().flatten(),
            num_turns: num_turns.get(i).copied().flatten(),
            retry_count: retry_counts.get(i).copied().unwrap_or(0),
            output_hashes: output_hashes.get(i).cloned().unwrap_or_default(),
        });
    }
    RunSummary {
        run_id,
        steps: summary_entries,
        metadata: HashMap::new(),
    }
}

/// Async orchestrator dispatcher wired for agent-registry lookup and governed execution.
///
/// Supports optional gate evaluation (052) and post-step verification with retry (075).
pub async fn dispatch_manifest(
    artifact_base: &ArtifactManager,
    run_id: Uuid,
    manifest: &WorkflowManifest,
    registry: Arc<dyn AgentRegistry>,
    executor: Arc<dyn GovernedExecutor>,
    options: &DispatchOptions,
) -> Result<RunSummary, OrchestratorError> {
    let order = manifest.validate_and_order()?;
    let steps = &manifest.steps;

    let mut dependents: HashMap<&str, Vec<usize>> = HashMap::new();
    for (idx, step) in steps.iter().enumerate() {
        for input in &step.inputs {
            if let Some((producer_id, _file)) = split_input_ref(input) {
                dependents.entry(producer_id).or_default().push(idx);
            }
        }
    }

    let mut statuses: Vec<StepStatus> = vec![StepStatus::Pending; steps.len()];
    let mut tokens_used: Vec<Option<u64>> = vec![None; steps.len()];
    let mut costs_usd: Vec<Option<f64>> = vec![None; steps.len()];
    let mut durations_ms: Vec<Option<u64>> = vec![None; steps.len()];
    let mut num_turns: Vec<Option<u32>> = vec![None; steps.len()];
    let mut retry_counts: Vec<u32> = vec![0; steps.len()];
    let mut step_output_hashes: Vec<HashMap<String, String>> = vec![HashMap::new(); steps.len()];

    // Accumulated hashes from completed steps for input verification (082 FR-004).
    let mut completed_hashes: HashMap<String, HashMap<String, String>> = HashMap::new();

    let total_steps = order.len();
    let phase_start = std::time::Instant::now();

    for (step_num, &idx) in order.iter().enumerate() {
        if matches!(statuses[idx], StepStatus::Skipped | StepStatus::Cancelled) {
            continue;
        }

        let step = &steps[idx];

        // Resume support: skip steps that were already completed in a prior run.
        if options.skip_completed_steps.contains(&step.id) {
            statuses[idx] = StepStatus::Success;
            eprintln!(
                "  [{}/{}] {} (agent: {}) — skipped (resumed)",
                step_num + 1,
                total_steps,
                step.id,
                step.agent,
            );
            continue;
        }

        // Cache-hit detection: skip execution if all outputs are already in CAS (094 SC-094-5).
        #[cfg(feature = "local-sqlite")]
        if let (Some(cas), Some(meta_store)) = (&options.cas, &options.artifact_metadata)
            && let Some(cached) =
                artifact::check_step_cache(meta_store, cas, &step.id, &step.outputs)
        {
            // Restore cached artifacts to the run directory.
            let mut restored = true;
            let mut hashes = HashMap::new();
            for (filename, hash) in &cached {
                let target = artifact_base.output_artifact_path(run_id, &step.id, filename);
                if let Some(parent) = target.parent() {
                    let _ = std::fs::create_dir_all(parent);
                }
                if !cas.retrieve(hash, filename, &target).unwrap_or(false) {
                    restored = false;
                    break;
                }
                hashes.insert(filename.clone(), hash.clone());
            }
            if restored {
                statuses[idx] = StepStatus::Success;
                step_output_hashes[idx] = hashes.clone();
                completed_hashes.insert(step.id.clone(), hashes);
                eprintln!(
                    "  [{}/{}] {} (agent: {}) — cache hit (094)",
                    step_num + 1,
                    total_steps,
                    step.id,
                    step.agent,
                );
                continue;
            }
        }

        let input_paths = resolve_input_paths(artifact_base, run_id, step);
        if let Some(missing_path) = input_paths.iter().find(|p| !p.exists()).cloned() {
            statuses[idx] = StepStatus::Failure;
            if let Some(dep_idxs) = dependents.get(step.id.as_str()) {
                for &d in dep_idxs {
                    if matches!(statuses[d], StepStatus::Pending | StepStatus::Running) {
                        statuses[d] = StepStatus::Skipped;
                    }
                }
            }
            let summary = build_summary(
                artifact_base,
                run_id,
                steps,
                &statuses,
                &tokens_used,
                &costs_usd,
                &durations_ms,
                &num_turns,
                &retry_counts,
                &step_output_hashes,
            );
            summary.write_to_disk(artifact_base)?;
            return Err(OrchestratorError::DependencyMissing {
                step_id: step.id.clone(),
                artifact_path: missing_path,
            });
        }

        // Verify input artifact integrity (082 FR-004).
        for input in &step.inputs {
            if let Some((producer_id, file)) = split_input_ref(input)
                && let Some(producer_hashes) = completed_hashes.get(producer_id)
                && let Some(expected_hash) = producer_hashes.get(file)
            {
                let input_path = artifact_base.output_artifact_path(run_id, producer_id, file);
                match ArtifactManager::verify_artifact(&input_path, expected_hash) {
                    Ok(true) => {} // Hash matches
                    Ok(false) => {
                        statuses[idx] = StepStatus::Failure;
                        let summary = build_summary(
                            artifact_base,
                            run_id,
                            steps,
                            &statuses,
                            &tokens_used,
                            &costs_usd,
                            &durations_ms,
                            &num_turns,
                            &retry_counts,
                            &step_output_hashes,
                        );
                        summary.write_to_disk(artifact_base)?;
                        return Err(OrchestratorError::DependencyMissing {
                            step_id: step.id.clone(),
                            artifact_path: input_path,
                        });
                    }
                    Err(_) => {} // File read error already caught by existence check above
                }
            }
        }

        if !registry.has_agent(&step.agent).await {
            statuses[idx] = StepStatus::Failure;
            let summary = build_summary(
                artifact_base,
                run_id,
                steps,
                &statuses,
                &tokens_used,
                &costs_usd,
                &durations_ms,
                &num_turns,
                &retry_counts,
                &step_output_hashes,
            );
            summary.write_to_disk(artifact_base)?;
            return Err(OrchestratorError::AgentNotFound {
                agent_id: step.agent.clone(),
            });
        }

        // Gate evaluation (052 FR-004, FR-005).
        if let (Some(gate), Some(handler)) = (&step.gate, &options.gate_handler) {
            match handle_gate_simple(&step.id, gate, handler.as_ref()).await {
                Ok(GateAction::Skip) => {
                    statuses[idx] = StepStatus::Skipped;
                    continue;
                }
                Ok(GateAction::Proceed) => {}
                Err(e) => {
                    statuses[idx] = StepStatus::Failure;
                    if let Some(dep_idxs) = dependents.get(step.id.as_str()) {
                        for &d in dep_idxs {
                            if matches!(statuses[d], StepStatus::Pending | StepStatus::Running) {
                                statuses[d] = StepStatus::Skipped;
                            }
                        }
                    }
                    let summary = build_summary(
                        artifact_base,
                        run_id,
                        steps,
                        &statuses,
                        &tokens_used,
                        &costs_usd,
                        &durations_ms,
                        &num_turns,
                        &retry_counts,
                        &step_output_hashes,
                    );
                    summary.write_to_disk(artifact_base)?;
                    return Err(e);
                }
            }
        }

        // Spec 198 FR-005 — pre-step gate (run-grant renewal at every stage
        // boundary). Fail closed on Err: the step is marked failed and the
        // run halts; the reason is surfaced to the caller.
        if let Some(ref gate) = options.pre_step
            && let Err(reason) = gate.before_step(&step.id).await
        {
            statuses[idx] = StepStatus::Failure;
            if let Some(dep_idxs) = dependents.get(step.id.as_str()) {
                for &d in dep_idxs {
                    if matches!(statuses[d], StepStatus::Pending | StepStatus::Running) {
                        statuses[d] = StepStatus::Skipped;
                    }
                }
            }
            let summary = build_summary(
                artifact_base,
                run_id,
                steps,
                &statuses,
                &tokens_used,
                &costs_usd,
                &durations_ms,
                &num_turns,
                &retry_counts,
                &step_output_hashes,
            );
            summary.write_to_disk(artifact_base)?;
            return Err(OrchestratorError::StepFailed {
                step_id: step.id.clone(),
                reason,
            });
        }

        statuses[idx] = StepStatus::Running;
        eprintln!(
            "  [{}/{}] {} (agent: {}) — running...",
            step_num + 1,
            total_steps,
            step.id,
            step.agent,
        );
        let step_start = std::time::Instant::now();

        artifact_base
            .ensure_step_dir(run_id, &step.id)
            .map_err(|e| OrchestratorError::StepFailed {
                step_id: step.id.clone(),
                reason: format!("prepare output dir: {e}"),
            })?;

        let output_paths: Vec<PathBuf> = step
            .outputs
            .iter()
            .map(|o| artifact_base.output_artifact_path(run_id, &step.id, o))
            .collect();

        // Dispatch + verify/retry loop (075 FR-005, FR-006).
        match dispatch_with_verify(
            step,
            executor.as_ref(),
            artifact_base,
            run_id,
            &input_paths,
            &output_paths,
            options.project_root.as_deref(),
            manifest.project_id.as_deref(),
        )
        .await
        {
            Ok(metrics) => {
                let is_success = metrics.status == StepStatus::Success;
                statuses[idx] = metrics.status;
                tokens_used[idx] = metrics.tokens_used;
                costs_usd[idx] = metrics.cost_usd;
                durations_ms[idx] = metrics.duration_ms;
                num_turns[idx] = metrics.num_turns;
                retry_counts[idx] = metrics.retry_count;

                // Spec 202 FR-002: feed the just-completed step's actuals to
                // any metering gate so run-level budgets accumulate (a no-op
                // for non-metering gates such as GrantRenewalGate).
                if let Some(ref gate) = options.pre_step {
                    gate.after_step(&StepActuals {
                        step_id: step.id.clone(),
                        tokens_used: tokens_used[idx],
                        cost_usd: costs_usd[idx],
                        duration_ms: durations_ms[idx],
                        num_turns: num_turns[idx],
                        success: is_success,
                        retry_count: retry_counts[idx],
                        instruction: Some(step.instruction.clone()),
                    })
                    .await;
                }

                // Hash output artifacts (082 FR-003).
                if is_success {
                    let mut hashes = HashMap::new();
                    for (output_name, output_path) in step.outputs.iter().zip(output_paths.iter()) {
                        if let Ok(hash) = ArtifactManager::hash_artifact(output_path) {
                            hashes.insert(output_name.clone(), hash);
                        }
                    }
                    step_output_hashes[idx] = hashes.clone();
                    completed_hashes.insert(step.id.clone(), hashes);

                    // Promote to CAS for cross-run persistence (094 Slice 2).
                    if let Some(ref cas) = options.cas
                        && let Err(e) =
                            artifact_base.promote_to_cas(run_id, &step.id, &step.outputs, cas)
                    {
                        eprintln!("[094] CAS promotion warning for step {}: {e}", step.id);
                    }

                    // Record artifact metadata and provenance (094 Slices 3-4).
                    #[cfg(feature = "local-sqlite")]
                    if let Some(ref meta_store) = options.artifact_metadata {
                        record_artifact_metadata(
                            meta_store,
                            &step_output_hashes[idx],
                            step,
                            run_id,
                            None,
                            &output_paths,
                        );
                    }
                }

                let elapsed = step_start.elapsed();
                eprintln!(
                    "  [{}/{}] {} — {:?} ({:.1}s)",
                    step_num + 1,
                    total_steps,
                    step.id,
                    statuses[idx],
                    elapsed.as_secs_f64(),
                );
            }
            Err(e) => {
                let elapsed = step_start.elapsed();
                statuses[idx] = if matches!(e, OrchestratorError::VerificationFailed { .. }) {
                    StepStatus::VerificationFailed
                } else {
                    StepStatus::Failure
                };
                eprintln!(
                    "  [{}/{}] {} — {:?} ({:.1}s)",
                    step_num + 1,
                    total_steps,
                    step.id,
                    statuses[idx],
                    elapsed.as_secs_f64(),
                );
                if let Some(dep_idxs) = dependents.get(step.id.as_str()) {
                    for &d in dep_idxs {
                        if matches!(statuses[d], StepStatus::Pending | StepStatus::Running) {
                            statuses[d] = StepStatus::Skipped;
                        }
                    }
                }
                // Spec 202 FR-003b: record the hard failure to the oscillation
                // detector (via after_step) for consistency with the success
                // field's contract. Inert under halt-on-failure: this branch
                // returns and aborts the run, so no later before_step observes
                // the recorded failure; the realizable AC-2 signal is the
                // Ok-branch retry_count.
                if let Some(ref gate) = options.pre_step {
                    gate.after_step(&StepActuals {
                        step_id: step.id.clone(),
                        tokens_used: None,
                        cost_usd: None,
                        duration_ms: None,
                        num_turns: None,
                        success: false,
                        retry_count: 0,
                        instruction: None,
                    })
                    .await;
                }
                let summary = build_summary(
                    artifact_base,
                    run_id,
                    steps,
                    &statuses,
                    &tokens_used,
                    &costs_usd,
                    &durations_ms,
                    &num_turns,
                    &retry_counts,
                    &step_output_hashes,
                );
                summary.write_to_disk(artifact_base)?;
                return Err(e);
            }
        }
    }

    let phase_elapsed = phase_start.elapsed();
    eprintln!(
        "  Total phase duration: {:.1}s",
        phase_elapsed.as_secs_f64()
    );

    let mut summary = build_summary(
        artifact_base,
        run_id,
        steps,
        &statuses,
        &tokens_used,
        &costs_usd,
        &durations_ms,
        &num_turns,
        &retry_counts,
        &step_output_hashes,
    );
    // --- Promotion eligibility check (097 Slice 4, 098 Slice 2) ---
    let all_succeeded = statuses.iter().all(|s| matches!(s, StepStatus::Success));
    let promo_check = check_promotion_from_metadata(
        &options.governance_mode,
        &options.sync_tracker,
        all_succeeded,
        run_id,
    );
    if let Ok(v) = serde_json::to_value(&promo_check) {
        summary.metadata.insert("promotion".to_string(), v);
    }
    if let Some(ref gm) = options.governance_mode {
        summary
            .metadata
            .insert("governance_mode".to_string(), serde_json::json!(gm));
    }

    summary.write_to_disk(artifact_base)?;
    Ok(summary)
}

/// Run promotion eligibility check using dispatch options + sync tracker.
/// Returns a `PromotionCheck` without requiring a full `WorkflowState` (097/098).
fn check_promotion_from_metadata(
    governance_mode: &Option<String>,
    sync_tracker: &Option<promotion::SyncTracker>,
    steps_all_succeeded: bool,
    run_id: Uuid,
) -> promotion::PromotionCheck {
    let sync_status = match sync_tracker {
        Some(tracker) => tracker.to_sync_status(),
        None => promotion::SyncStatus::default(),
    };

    let gm = governance_mode.as_deref().unwrap_or("");
    let governance_active = gm == "governed";

    let mut reasons = Vec::new();

    // Non-persisted path has no project_id in DispatchOptions,
    // so always flag as missing.
    reasons.push("no project_id (non-persisted dispatch path)".to_string());

    if !governance_active {
        reasons.push(format!("governance mode is '{gm}', expected 'governed'"));
    }
    if !sync_status.events_synced {
        reasons.push("not all events were synced to platform".to_string());
    }
    if !sync_status.artifacts_recorded {
        reasons.push("not all artifacts were recorded".to_string());
    }
    if !steps_all_succeeded {
        reasons.push("not all steps completed successfully".to_string());
    }

    let eligibility = if reasons.is_empty() {
        promotion::PromotionEligibility::Eligible
    } else {
        promotion::PromotionEligibility::Ineligible { reasons }
    };

    promotion::PromotionCheck {
        workflow_id: run_id.to_string(),
        project_id: None,
        governance_active,
        events_synced: sync_status.events_synced,
        artifacts_recorded: sync_status.artifacts_recorded,
        all_steps_completed: steps_all_succeeded,
        eligibility,
    }
}

/// Record artifact metadata and provenance lineage after CAS promotion (094 Slices 3-4).
#[cfg(feature = "local-sqlite")]
fn record_artifact_metadata(
    store: &std::sync::Mutex<artifact::ArtifactMetadataStore>,
    output_hashes: &HashMap<String, String>,
    step: &manifest::WorkflowStep,
    run_id: Uuid,
    project_id: Option<&str>,
    output_paths: &[PathBuf],
) {
    let store = match store.lock() {
        Ok(guard) => guard,
        Err(e) => {
            eprintln!("[094] Artifact metadata store lock poisoned: {e}");
            return;
        }
    };
    let now = now_ts();
    for (filename, hash) in output_hashes {
        let size = output_paths
            .iter()
            .find(|p| {
                p.file_name()
                    .map(|f| f.to_string_lossy() == filename.as_str())
                    .unwrap_or(false)
            })
            .and_then(|p| std::fs::metadata(p).ok())
            .map(|m| m.len())
            .unwrap_or(0);

        let record = artifact::ArtifactRecord {
            content_hash: hash.clone(),
            filename: filename.clone(),
            step_id: step.id.clone(),
            workflow_id: run_id.to_string(),
            project_id: project_id.map(String::from),
            created_at: now.clone(),
            size_bytes: size,
            content_type: None,
            producer_agent: Some(step.agent.clone()),
        };
        if let Err(e) = store.record_artifact(&record) {
            eprintln!("[094] Artifact metadata warning for {filename}: {e}");
        }

        let lineage = artifact::ArtifactLineage {
            content_hash: hash.clone(),
            relationship: artifact::LineageRelation::ProducedBy,
            workflow_id: run_id.to_string(),
            step_id: step.id.clone(),
            agent_id: Some(step.agent.clone()),
            created_at: now.clone(),
        };
        if let Err(e) = store.record_lineage(&lineage) {
            eprintln!("[094] Lineage recording warning for {filename}: {e}");
        }
    }
}

/// Optional persistence context for wiring state persistence and event
/// broadcasting into the dispatch loop (052 Phase 6D).
pub struct PersistenceContext {
    pub store: Arc<dyn WorkflowStore>,
    pub notifier: Arc<dyn EventNotifier>,
}

/// Timestamp helper for event/state recording — mirrors the epoch-based format
/// used in `sqlite_state` and `gates` modules.
fn now_ts() -> String {
    use std::time::SystemTime;
    let duration = SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .unwrap_or_default();
    format!("{}.{:03}", duration.as_secs(), duration.subsec_millis())
}

/// Async orchestrator dispatcher with SQLite state persistence and event broadcasting (052 6D).
///
/// This wraps the same dispatch logic as [`dispatch_manifest`] but additionally:
/// - Creates a `WorkflowState` at workflow start and persists it to SQLite
/// - Appends `workflow_started`, `step_started`, `step_completed`/`step_failed`,
///   and `workflow_completed`/`workflow_failed` events
/// - Broadcasts each event to live SSE subscribers via `EventBroadcaster`
/// - Persists state after every step transition
pub async fn dispatch_manifest_persisted(
    artifact_base: &ArtifactManager,
    run_id: Uuid,
    manifest: &WorkflowManifest,
    registry: Arc<dyn AgentRegistry>,
    executor: Arc<dyn GovernedExecutor>,
    persistence: &PersistenceContext,
    options: &DispatchOptions,
) -> Result<RunSummary, OrchestratorError> {
    let order = manifest.validate_and_order()?;
    let steps = &manifest.steps;

    // --- Workflow start: create state + persist + emit event ---
    let step_defs: Vec<(String, String)> = steps
        .iter()
        .map(|s| (s.id.clone(), s.agent.clone()))
        .collect();

    let mut wf_metadata = serde_json::Map::new();
    if let Some(ref proj_id) = manifest.project_id {
        wf_metadata.insert("project_id".to_string(), JsonValue::String(proj_id.clone()));
    }
    // Thread governance_mode from DispatchOptions into persisted metadata (098 Slice 2).
    if let Some(ref gm) = options.governance_mode {
        wf_metadata.insert("governance_mode".to_string(), JsonValue::String(gm.clone()));
    }
    let mut wf_state = WorkflowState::new(
        run_id,
        manifest
            .steps
            .first()
            .map_or("workflow".to_string(), |s| s.agent.clone()),
        now_ts(),
        step_defs,
        wf_metadata,
    )
    .with_origin(
        options.project_path.clone(),
        options.originating_session.clone(),
    );
    wf_state.attach_gates_from_manifest(manifest);

    persist_and_emit(
        persistence,
        &wf_state,
        run_id,
        "workflow_started",
        &serde_json::json!({ "workflow_id": run_id.to_string() }),
    )
    .await?;

    // --- Pre-compute dependency graph ---
    let mut dependents: HashMap<&str, Vec<usize>> = HashMap::new();
    for (idx, step) in steps.iter().enumerate() {
        for input in &step.inputs {
            if let Some((producer_id, _file)) = split_input_ref(input) {
                dependents.entry(producer_id).or_default().push(idx);
            }
        }
    }

    let mut statuses: Vec<StepStatus> = vec![StepStatus::Pending; steps.len()];
    let mut tokens_used: Vec<Option<u64>> = vec![None; steps.len()];
    let mut costs_usd: Vec<Option<f64>> = vec![None; steps.len()];
    let mut durations_ms: Vec<Option<u64>> = vec![None; steps.len()];
    let mut num_turns: Vec<Option<u32>> = vec![None; steps.len()];
    let mut retry_counts: Vec<u32> = vec![0; steps.len()];
    let mut step_output_hashes: Vec<HashMap<String, String>> = vec![HashMap::new(); steps.len()];

    // Accumulated hashes from completed steps for input verification (082 FR-004, 094 Slice 1).
    let mut completed_hashes: HashMap<String, HashMap<String, String>> = HashMap::new();

    /// Helper: persist state + append event + broadcast.
    async fn persist_and_emit(
        persistence: &PersistenceContext,
        wf_state: &WorkflowState,
        run_id: Uuid,
        event_type: &str,
        payload: &JsonValue,
    ) -> Result<(), OrchestratorError> {
        persistence.store.write_workflow_state(wf_state).await?;
        let event_id = persistence
            .store
            .append_event(run_id, event_type, payload, None)
            .await?;
        let event = PersistedEvent {
            event_id,
            workflow_id: run_id,
            timestamp: now_ts(),
            event_type: event_type.to_string(),
            payload: payload.clone(),
            scope: Some("workflow".to_string()),
        };
        persistence.notifier.notify(run_id, event).await;
        Ok(())
    }

    for &idx in &order {
        if matches!(statuses[idx], StepStatus::Skipped | StepStatus::Cancelled) {
            continue;
        }

        let step = &steps[idx];

        // Skip completed steps on resume.
        if options.skip_completed_steps.contains(&step.id) {
            eprintln!("  Skipping completed step: {}", step.id);
            statuses[idx] = StepStatus::Success;
            continue;
        }

        // Cache-hit detection: skip execution if all outputs are already in CAS (094 SC-094-5).
        #[cfg(feature = "local-sqlite")]
        if let (Some(cas), Some(meta_store)) = (&options.cas, &options.artifact_metadata)
            && let Some(cached) =
                artifact::check_step_cache(meta_store, cas, &step.id, &step.outputs)
        {
            let mut restored = true;
            let mut hashes = HashMap::new();
            for (filename, hash) in &cached {
                let target = artifact_base.output_artifact_path(run_id, &step.id, filename);
                if let Some(parent) = target.parent() {
                    let _ = std::fs::create_dir_all(parent);
                }
                if !cas.retrieve(hash, filename, &target).unwrap_or(false) {
                    restored = false;
                    break;
                }
                hashes.insert(filename.clone(), hash.clone());
            }
            if restored {
                statuses[idx] = StepStatus::Success;
                step_output_hashes[idx] = hashes.clone();
                completed_hashes.insert(step.id.clone(), hashes);
                eprintln!("  Step {} — cache hit (094)", step.id);

                wf_state.mark_step_finished(
                    &step.id,
                    crate::state::StepExecutionStatus::CacheHit,
                    now_ts(),
                    None,
                    None,
                );
                persist_and_emit(
                    persistence,
                    &wf_state,
                    run_id,
                    "step_cache_hit",
                    &serde_json::json!({ "step_id": step.id }),
                )
                .await?;
                continue;
            }
        }

        let input_paths = resolve_input_paths(artifact_base, run_id, step);
        if let Some(missing_path) = input_paths.iter().find(|p| !p.exists()).cloned() {
            statuses[idx] = StepStatus::Failure;

            // Update state for failed step
            wf_state.mark_step_finished(
                &step.id,
                StepExecutionStatus::Failed,
                now_ts(),
                None,
                Some(serde_json::json!({ "error": format!("missing input: {}", missing_path.display()) })),
            );
            wf_state.status = WorkflowStatus::Failed;

            persist_and_emit(
                persistence,
                &wf_state,
                run_id,
                "step_failed",
                &serde_json::json!({ "step_id": step.id, "reason": format!("missing input: {}", missing_path.display()) }),
            )
            .await?;

            if let Some(dep_idxs) = dependents.get(step.id.as_str()) {
                for &d in dep_idxs {
                    if matches!(statuses[d], StepStatus::Pending | StepStatus::Running) {
                        statuses[d] = StepStatus::Skipped;
                    }
                }
            }
            let summary = build_summary(
                artifact_base,
                run_id,
                steps,
                &statuses,
                &tokens_used,
                &costs_usd,
                &durations_ms,
                &num_turns,
                &retry_counts,
                &step_output_hashes,
            );
            summary.write_to_disk(artifact_base)?;
            return Err(OrchestratorError::DependencyMissing {
                step_id: step.id.clone(),
                artifact_path: missing_path,
            });
        }

        // Verify input artifact integrity (082 FR-004, 094 Slice 1).
        for input in &step.inputs {
            if let Some((producer_id, file)) = split_input_ref(input)
                && let Some(producer_hashes) = completed_hashes.get(producer_id)
                && let Some(expected_hash) = producer_hashes.get(file)
            {
                let input_path = artifact_base.output_artifact_path(run_id, producer_id, file);
                match ArtifactManager::verify_artifact(&input_path, expected_hash) {
                    Ok(true) => {} // Hash matches
                    Ok(false) => {
                        statuses[idx] = StepStatus::Failure;

                        wf_state.mark_step_finished(
                            &step.id,
                            StepExecutionStatus::Failed,
                            now_ts(),
                            None,
                            Some(serde_json::json!({ "error": format!("artifact integrity check failed: {}", input_path.display()) })),
                        );
                        wf_state.status = WorkflowStatus::Failed;

                        persist_and_emit(
                            persistence,
                            &wf_state,
                            run_id,
                            "step_failed",
                            &serde_json::json!({ "step_id": step.id, "reason": format!("artifact integrity check failed: {}", input_path.display()) }),
                        )
                        .await?;

                        let summary = build_summary(
                            artifact_base,
                            run_id,
                            steps,
                            &statuses,
                            &tokens_used,
                            &costs_usd,
                            &durations_ms,
                            &num_turns,
                            &retry_counts,
                            &step_output_hashes,
                        );
                        summary.write_to_disk(artifact_base)?;
                        return Err(OrchestratorError::DependencyMissing {
                            step_id: step.id.clone(),
                            artifact_path: input_path,
                        });
                    }
                    Err(_) => {} // File read error already caught by existence check above
                }
            }
        }

        if !registry.has_agent(&step.agent).await {
            statuses[idx] = StepStatus::Failure;

            wf_state.mark_step_finished(
                &step.id,
                StepExecutionStatus::Failed,
                now_ts(),
                None,
                Some(serde_json::json!({ "error": format!("agent not found: {}", step.agent) })),
            );
            wf_state.status = WorkflowStatus::Failed;

            persist_and_emit(
                persistence,
                &wf_state,
                run_id,
                "step_failed",
                &serde_json::json!({ "step_id": step.id, "reason": format!("agent not found: {}", step.agent) }),
            )
            .await?;

            let summary = build_summary(
                artifact_base,
                run_id,
                steps,
                &statuses,
                &tokens_used,
                &costs_usd,
                &durations_ms,
                &num_turns,
                &retry_counts,
                &step_output_hashes,
            );
            summary.write_to_disk(artifact_base)?;
            return Err(OrchestratorError::AgentNotFound {
                agent_id: step.agent.clone(),
            });
        }

        // Gate evaluation with state persistence (052 FR-004, FR-005).
        if let (Some(gate), Some(handler)) = (&step.gate, &options.gate_handler) {
            let persist_fn = |s: &WorkflowState| {
                // Synchronous bridge: we can't await inside the closure so we
                // rely on the store's blocking write if available. For the async
                // path the gate evaluation already persists via persist_and_emit
                // before and after the handler call below.
                let _ = s; // state is persisted via persist_and_emit calls
                Ok(())
            };

            // Extract checkpoint_id from Approval gate if present (095 Slice 5).
            let gate_checkpoint_id = match gate {
                manifest::StepGateConfig::Approval { checkpoint_id, .. } => checkpoint_id.clone(),
                _ => None,
            };

            // Auto-create checkpoint on gate entry (095 SC-095-4).
            let gate_merkle_root = if let Some(ref hook) = options.on_gate_checkpoint {
                let cp_id = gate_checkpoint_id
                    .clone()
                    .unwrap_or_else(|| format!("gate-{}", step.id));
                match hook(&step.id, &cp_id) {
                    Ok(root) => Some(root),
                    Err(e) => {
                        eprintln!("[095] gate checkpoint creation warning: {e}");
                        None
                    }
                }
            } else {
                None
            };

            // Emit gate_reached event with checkpoint binding and merkle root.
            persist_and_emit(
                persistence,
                &wf_state,
                run_id,
                "gate_reached",
                &serde_json::json!({
                    "step_id": step.id,
                    "checkpoint_id": gate_checkpoint_id,
                    "merkle_root": gate_merkle_root,
                }),
            )
            .await?;

            let gate_outcome = evaluate_gate_if_present(
                &mut wf_state,
                &step.id,
                Some(gate),
                handler.as_ref(),
                persist_fn,
            )
            .await;

            match gate_outcome {
                Ok(Some(GateOutcome::Approved)) => {
                    persist_and_emit(
                        persistence,
                        &wf_state,
                        run_id,
                        "gate_approved",
                        &serde_json::json!({
                            "step_id": step.id,
                            "checkpoint_id": gate_checkpoint_id,
                            "merkle_root": gate_merkle_root,
                        }),
                    )
                    .await?;
                }
                Ok(Some(GateOutcome::TimedOut { escalation })) => {
                    match escalation {
                        manifest::ApprovalEscalation::Skip => {
                            statuses[idx] = StepStatus::Skipped;
                            wf_state.mark_step_finished(
                                &step.id,
                                StepExecutionStatus::Skipped,
                                now_ts(),
                                None,
                                Some(serde_json::json!({ "reason": "approval gate timed out, escalation: skip" })),
                            );
                            persist_and_emit(
                                persistence, &wf_state, run_id,
                                "step_skipped",
                                &serde_json::json!({ "step_id": step.id, "reason": "gate timeout skip" }),
                            ).await?;
                            continue;
                        }
                        manifest::ApprovalEscalation::Fail => {
                            statuses[idx] = StepStatus::Failure;
                            wf_state.mark_step_finished(
                                &step.id,
                                StepExecutionStatus::Failed,
                                now_ts(),
                                None,
                                Some(serde_json::json!({ "reason": "approval gate timed out" })),
                            );
                            wf_state.status = WorkflowStatus::Failed;
                            persist_and_emit(
                                persistence, &wf_state, run_id,
                                "step_failed",
                                &serde_json::json!({ "step_id": step.id, "reason": "approval gate timed out" }),
                            ).await?;
                            let summary = build_summary(
                                artifact_base,
                                run_id,
                                steps,
                                &statuses,
                                &tokens_used,
                                &costs_usd,
                                &durations_ms,
                                &num_turns,
                                &retry_counts,
                                &step_output_hashes,
                            );
                            summary.write_to_disk(artifact_base)?;
                            return Err(OrchestratorError::StepFailed {
                                step_id: step.id.clone(),
                                reason: "approval gate timed out".into(),
                            });
                        }
                        manifest::ApprovalEscalation::Notify => {
                            // Continue execution after notification.
                        }
                    }
                }
                Ok(None) => {} // no gate
                Err(e) => {
                    statuses[idx] = StepStatus::Failure;
                    wf_state.mark_step_finished(
                        &step.id,
                        StepExecutionStatus::Failed,
                        now_ts(),
                        None,
                        Some(serde_json::json!({ "error": e.to_string() })),
                    );
                    wf_state.status = WorkflowStatus::Failed;
                    persist_and_emit(
                        persistence,
                        &wf_state,
                        run_id,
                        "step_failed",
                        &serde_json::json!({ "step_id": step.id, "reason": e.to_string() }),
                    )
                    .await?;
                    let summary = build_summary(
                        artifact_base,
                        run_id,
                        steps,
                        &statuses,
                        &tokens_used,
                        &costs_usd,
                        &durations_ms,
                        &num_turns,
                        &retry_counts,
                        &step_output_hashes,
                    );
                    summary.write_to_disk(artifact_base)?;
                    return Err(OrchestratorError::StepFailed {
                        step_id: step.id.clone(),
                        reason: e.to_string(),
                    });
                }
            }
        }

        // Spec 198 FR-005 — pre-step gate (run-grant renewal at every stage
        // boundary). Fail closed on Err: the step is marked failed and the
        // run halts; the reason is surfaced to the caller.
        if let Some(ref gate) = options.pre_step
            && let Err(reason) = gate.before_step(&step.id).await
        {
            statuses[idx] = StepStatus::Failure;
            if let Some(dep_idxs) = dependents.get(step.id.as_str()) {
                for &d in dep_idxs {
                    if matches!(statuses[d], StepStatus::Pending | StepStatus::Running) {
                        statuses[d] = StepStatus::Skipped;
                    }
                }
            }
            wf_state.mark_step_finished(
                &step.id,
                StepExecutionStatus::Failed,
                now_ts(),
                None,
                Some(serde_json::json!({ "error": &reason })),
            );
            wf_state.status = WorkflowStatus::Failed;
            persist_and_emit(
                persistence,
                &wf_state,
                run_id,
                "step_failed",
                &serde_json::json!({ "step_id": step.id, "reason": &reason }),
            )
            .await?;
            let summary = build_summary(
                artifact_base,
                run_id,
                steps,
                &statuses,
                &tokens_used,
                &costs_usd,
                &durations_ms,
                &num_turns,
                &retry_counts,
                &step_output_hashes,
            );
            summary.write_to_disk(artifact_base)?;
            return Err(OrchestratorError::StepFailed {
                step_id: step.id.clone(),
                reason,
            });
        }

        // --- Step started ---
        statuses[idx] = StepStatus::Running;
        wf_state.mark_step_started(&step.id, now_ts());

        persist_and_emit(
            persistence,
            &wf_state,
            run_id,
            "step_started",
            &serde_json::json!({ "step_id": step.id }),
        )
        .await?;

        artifact_base
            .ensure_step_dir(run_id, &step.id)
            .map_err(|e| OrchestratorError::StepFailed {
                step_id: step.id.clone(),
                reason: format!("prepare output dir: {e}"),
            })?;

        let output_paths: Vec<PathBuf> = step
            .outputs
            .iter()
            .map(|o| artifact_base.output_artifact_path(run_id, &step.id, o))
            .collect();

        // Dispatch + verify/retry loop (075 FR-005, FR-006).
        match dispatch_with_verify(
            step,
            executor.as_ref(),
            artifact_base,
            run_id,
            &input_paths,
            &output_paths,
            options.project_root.as_deref(),
            manifest.project_id.as_deref(),
        )
        .await
        {
            Ok(metrics) => {
                let is_success = metrics.status == StepStatus::Success;
                statuses[idx] = metrics.status;
                tokens_used[idx] = metrics.tokens_used;
                costs_usd[idx] = metrics.cost_usd;
                durations_ms[idx] = metrics.duration_ms;
                num_turns[idx] = metrics.num_turns;
                retry_counts[idx] = metrics.retry_count;

                // Spec 202 FR-002: feed the just-completed step's actuals to
                // any metering gate so run-level budgets accumulate (a no-op
                // for non-metering gates such as GrantRenewalGate).
                if let Some(ref gate) = options.pre_step {
                    gate.after_step(&StepActuals {
                        step_id: step.id.clone(),
                        tokens_used: tokens_used[idx],
                        cost_usd: costs_usd[idx],
                        duration_ms: durations_ms[idx],
                        num_turns: num_turns[idx],
                        success: is_success,
                        retry_count: retry_counts[idx],
                        instruction: Some(step.instruction.clone()),
                    })
                    .await;
                }

                // Hash output artifacts (082 FR-003).
                if is_success {
                    let mut hashes = HashMap::new();
                    for (output_name, output_path) in step.outputs.iter().zip(output_paths.iter()) {
                        if let Ok(hash) = ArtifactManager::hash_artifact(output_path) {
                            hashes.insert(output_name.clone(), hash);
                        }
                    }
                    step_output_hashes[idx] = hashes.clone();
                    // Accumulate for input verification of downstream steps (094 Slice 1).
                    completed_hashes.insert(step.id.clone(), hashes);

                    // Promote to CAS for cross-run persistence (094 Slice 2).
                    if let Some(ref cas) = options.cas
                        && let Err(e) =
                            artifact_base.promote_to_cas(run_id, &step.id, &step.outputs, cas)
                    {
                        eprintln!("[094] CAS promotion warning for step {}: {e}", step.id);
                    }

                    // Record artifact metadata and provenance (094 Slices 3-4).
                    #[cfg(feature = "local-sqlite")]
                    if let Some(ref meta_store) = options.artifact_metadata {
                        let proj_id = wf_state
                            .metadata
                            .get("project_id")
                            .and_then(|v| v.as_str());
                        record_artifact_metadata(
                            meta_store,
                            &step_output_hashes[idx],
                            step,
                            run_id,
                            proj_id,
                            &output_paths,
                        );
                    }
                }

                wf_state.mark_step_finished(
                    &step.id,
                    StepExecutionStatus::Completed,
                    now_ts(),
                    None,
                    metrics
                        .tokens_used
                        .map(|t| serde_json::json!({ "tokens_used": t })),
                );

                persist_and_emit(
                    persistence,
                    &wf_state,
                    run_id,
                    "step_completed",
                    &serde_json::json!({ "step_id": step.id }),
                )
                .await?;
            }
            Err(e) => {
                let is_verify_fail = matches!(e, OrchestratorError::VerificationFailed { .. });
                statuses[idx] = if is_verify_fail {
                    StepStatus::VerificationFailed
                } else {
                    StepStatus::Failure
                };

                let event_type = if is_verify_fail {
                    "step_verification_failed"
                } else {
                    "step_failed"
                };

                wf_state.mark_step_finished(
                    &step.id,
                    StepExecutionStatus::Failed,
                    now_ts(),
                    None,
                    Some(serde_json::json!({ "error": e.to_string() })),
                );
                wf_state.status = WorkflowStatus::Failed;

                persist_and_emit(
                    persistence,
                    &wf_state,
                    run_id,
                    event_type,
                    &serde_json::json!({ "step_id": step.id, "reason": e.to_string() }),
                )
                .await?;

                if let Some(dep_idxs) = dependents.get(step.id.as_str()) {
                    for &d in dep_idxs {
                        if matches!(statuses[d], StepStatus::Pending | StepStatus::Running) {
                            statuses[d] = StepStatus::Skipped;
                        }
                    }
                }
                // Spec 202 FR-003b: record the hard failure to the oscillation
                // detector (via after_step) for consistency with the success
                // field's contract. Inert under halt-on-failure: this branch
                // returns and aborts the run, so no later before_step observes
                // the recorded failure; the realizable AC-2 signal is the
                // Ok-branch retry_count.
                if let Some(ref gate) = options.pre_step {
                    gate.after_step(&StepActuals {
                        step_id: step.id.clone(),
                        tokens_used: None,
                        cost_usd: None,
                        duration_ms: None,
                        num_turns: None,
                        success: false,
                        retry_count: 0,
                        instruction: None,
                    })
                    .await;
                }
                let summary = build_summary(
                    artifact_base,
                    run_id,
                    steps,
                    &statuses,
                    &tokens_used,
                    &costs_usd,
                    &durations_ms,
                    &num_turns,
                    &retry_counts,
                    &step_output_hashes,
                );
                summary.write_to_disk(artifact_base)?;
                return Err(e);
            }
        }
    }

    // --- Workflow completed: check promotion eligibility (spec 097 Slice 4) ---
    // Use real SyncTracker data when provided (099 Slice 2), otherwise default
    // to not-synced (all runs start as CompletedLocal without a tracker).
    let sync_status = match &options.sync_tracker {
        Some(tracker) => tracker.to_sync_status(),
        None => promotion::SyncStatus::default(),
    };
    let promo_check = promotion::check_promotion_eligibility(&wf_state, &sync_status);

    wf_state.status = match &promo_check.eligibility {
        promotion::PromotionEligibility::Eligible => WorkflowStatus::Completed,
        promotion::PromotionEligibility::Ineligible { .. } => WorkflowStatus::CompletedLocal,
    };

    // Persist promotion metadata in workflow state
    if let Ok(promo_json) = serde_json::to_value(&promo_check) {
        wf_state
            .metadata
            .insert("promotion".to_string(), promo_json);
    }

    persist_and_emit(
        persistence,
        &wf_state,
        run_id,
        "workflow_completed",
        &serde_json::json!({
            "workflow_id": run_id.to_string(),
            "promotion_eligible": matches!(promo_check.eligibility, promotion::PromotionEligibility::Eligible),
        }),
    )
    .await?;

    let summary = build_summary(
        artifact_base,
        run_id,
        steps,
        &statuses,
        &tokens_used,
        &costs_usd,
        &durations_ms,
        &num_turns,
        &retry_counts,
        &step_output_hashes,
    );
    summary.write_to_disk(artifact_base)?;
    Ok(summary)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::effort::EffortLevel;
    use std::collections::HashSet;
    use std::path::PathBuf;
    use std::sync::Mutex;

    struct MockRegistry {
        agents: HashSet<String>,
    }

    #[async_trait]
    impl AgentRegistry for MockRegistry {
        async fn has_agent(&self, agent_id: &str) -> bool {
            self.agents.contains(agent_id)
        }
    }

    struct MockExecutor {
        writes_outputs: bool,
        seen_prompts: Mutex<Vec<String>>,
    }

    #[async_trait]
    impl GovernedExecutor for MockExecutor {
        async fn dispatch_step(&self, request: DispatchRequest) -> Result<DispatchResult, String> {
            self.seen_prompts
                .lock()
                .unwrap()
                .push(request.system_prompt.clone());
            if self.writes_outputs {
                for path in request.output_artifacts {
                    if let Some(parent) = path.parent() {
                        std::fs::create_dir_all(parent).unwrap();
                    }
                    std::fs::write(path, "ok").unwrap();
                }
            }
            Ok(DispatchResult {
                tokens_used: Some(123),
                output_hashes: HashMap::new(),
                session_id: None,
                cost_usd: None,
                duration_ms: None,
                num_turns: None,
                governance_mode: None,
            })
        }
    }

    struct E2eArtifactExecutor;

    #[async_trait]
    impl GovernedExecutor for E2eArtifactExecutor {
        async fn dispatch_step(&self, request: DispatchRequest) -> Result<DispatchResult, String> {
            let output_path = request
                .output_artifacts
                .first()
                .ok_or_else(|| "missing declared output artifact".to_string())?;

            let input_contents = read_inputs(&request.input_artifacts)?;
            let payload = match request.effort {
                EffortLevel::Quick => format!("quick\ninputs:\n{}\n", input_contents),
                EffortLevel::Investigate => {
                    format!(
                        "investigate\ninputs:\n{}\nanalysis:\n{}\n",
                        input_contents,
                        "i".repeat(240)
                    )
                }
                EffortLevel::Deep => {
                    format!(
                        "deep\ninputs:\n{}\nanalysis:\n{}\n",
                        input_contents,
                        "d".repeat(640)
                    )
                }
            };

            if let Some(parent) = output_path.parent() {
                std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
            }
            std::fs::write(output_path, payload).map_err(|e| e.to_string())?;

            let tokens_used = match request.effort {
                EffortLevel::Quick => 50,
                EffortLevel::Investigate => 160,
                EffortLevel::Deep => 420,
            };
            Ok(DispatchResult {
                tokens_used: Some(tokens_used),
                output_hashes: HashMap::new(),
                session_id: None,
                cost_usd: None,
                duration_ms: None,
                num_turns: None,
                governance_mode: None,
            })
        }
    }

    fn read_inputs(inputs: &[PathBuf]) -> Result<String, String> {
        if inputs.is_empty() {
            return Ok("(none)".to_string());
        }
        let mut out = Vec::with_capacity(inputs.len());
        for input in inputs {
            let text = std::fs::read_to_string(input)
                .map_err(|e| format!("read input {} failed: {e}", input.display()))?;
            out.push(text);
        }
        Ok(out.join("\n---\n"))
    }

    #[test]
    fn materialize_run_writes_files() {
        let tmp = tempfile::tempdir().unwrap();
        let am = ArtifactManager::new(tmp.path());
        let run_id = Uuid::nil();
        let m = WorkflowManifest {
            steps: vec![WorkflowStep {
                id: "s1".into(),
                agent: "test-agent".into(),
                effort: EffortLevel::Quick,
                inputs: vec![],
                outputs: vec!["out.md".into()],
                instruction: "do".into(),
                gate: None,
                pre_verify: None,
                post_verify: None,
                max_retries: None,
            }],
            project_id: None,
        };
        let rd = materialize_run_directory(&am, run_id, &m).unwrap();
        assert!(rd.join("manifest.yaml").exists());
        assert!(rd.join("summary.json").exists());
    }

    #[test]
    fn compute_resume_plan_from_state_identifies_completed_and_first_remaining_step() {
        let wf_id = Uuid::new_v4();
        let mut meta = serde_json::Map::new();
        meta.insert("branch".to_string(), serde_json::json!("main"));

        // Manifest with three ordered steps.
        let manifest = WorkflowManifest {
            steps: vec![
                WorkflowStep {
                    id: "step-1".into(),
                    agent: "agent-a".into(),
                    effort: EffortLevel::Quick,
                    inputs: vec![],
                    outputs: vec!["out1.md".into()],
                    instruction: "do 1".into(),
                    gate: None,
                    pre_verify: None,
                    post_verify: None,
                    max_retries: None,
                },
                WorkflowStep {
                    id: "step-2".into(),
                    agent: "agent-b".into(),
                    effort: EffortLevel::Quick,
                    inputs: vec!["step-1/out1.md".into()],
                    outputs: vec!["out2.md".into()],
                    instruction: "do 2".into(),
                    gate: None,
                    pre_verify: None,
                    post_verify: None,
                    max_retries: None,
                },
                WorkflowStep {
                    id: "step-3".into(),
                    agent: "agent-c".into(),
                    effort: EffortLevel::Quick,
                    inputs: vec!["step-2/out2.md".into()],
                    outputs: vec!["out3.md".into()],
                    instruction: "do 3".into(),
                    gate: None,
                    pre_verify: None,
                    post_verify: None,
                    max_retries: None,
                },
            ],
            project_id: None,
        };

        // Persisted state with first two steps completed, third still pending.
        let mut state = WorkflowState::new(
            wf_id,
            "example-workflow",
            "2026-03-31T10:00:00Z".to_string(),
            manifest
                .steps
                .iter()
                .map(|s| (s.id.clone(), s.instruction.clone())),
            meta,
        );
        state.mark_step_started("step-1", "2026-03-31T10:00:01Z".to_string());
        state.mark_step_finished(
            "step-1",
            StepExecutionStatus::Completed,
            "2026-03-31T10:00:05Z".to_string(),
            Some(4000),
            None,
        );
        state.mark_step_started("step-2", "2026-03-31T10:00:06Z".to_string());
        state.mark_step_finished(
            "step-2",
            StepExecutionStatus::Completed,
            "2026-03-31T10:00:10Z".to_string(),
            Some(4000),
            None,
        );

        let plan = compute_resume_plan_from_state(&state, &manifest).expect("expected resume plan");
        assert_eq!(
            plan.completed_step_ids,
            vec!["step-1".to_string(), "step-2".to_string()]
        );
        assert_eq!(plan.first_non_completed_step_index, 2);
    }

    #[test]
    fn compute_resume_plan_from_state_returns_none_when_nothing_to_resume() {
        let wf_id = Uuid::new_v4();
        let state = WorkflowState::new(
            wf_id,
            "fresh-workflow",
            "2026-03-31T10:00:00Z".to_string(),
            vec![
                ("step-1".to_string(), "do 1".to_string()),
                ("step-2".to_string(), "do 2".to_string()),
            ],
            serde_json::Map::new(),
        );
        let manifest = WorkflowManifest {
            steps: vec![
                WorkflowStep {
                    id: "step-1".into(),
                    agent: "agent-a".into(),
                    effort: EffortLevel::Quick,
                    inputs: vec![],
                    outputs: vec!["out1.md".into()],
                    instruction: "do 1".into(),
                    gate: None,
                    pre_verify: None,
                    post_verify: None,
                    max_retries: None,
                },
                WorkflowStep {
                    id: "step-2".into(),
                    agent: "agent-b".into(),
                    effort: EffortLevel::Quick,
                    inputs: vec!["step-1/out1.md".into()],
                    outputs: vec!["out2.md".into()],
                    instruction: "do 2".into(),
                    gate: None,
                    pre_verify: None,
                    post_verify: None,
                    max_retries: None,
                },
            ],
            project_id: None,
        };

        // No steps are marked completed in the state, so there is no resume plan yet.
        assert!(compute_resume_plan_from_state(&state, &manifest).is_none());
    }

    #[test]
    fn detect_resume_plan_for_run_handles_missing_state_file() {
        let tmp = tempfile::tempdir().unwrap();
        let artifact_base = ArtifactManager::new(tmp.path());
        let run_id = Uuid::new_v4();

        let manifest = WorkflowManifest {
            steps: vec![WorkflowStep {
                id: "s1".into(),
                agent: "agent-a".into(),
                effort: EffortLevel::Quick,
                inputs: vec![],
                outputs: vec!["out.md".into()],
                instruction: "do".into(),
                gate: None,
                pre_verify: None,
                post_verify: None,
                max_retries: None,
            }],
            project_id: None,
        };

        let plan = detect_resume_plan_for_run(&artifact_base, run_id, &manifest).unwrap();
        assert!(plan.is_none());
    }

    #[test]
    fn detect_resume_plan_for_run_loads_state_and_computes_plan() {
        let tmp = tempfile::tempdir().unwrap();
        let artifact_base = ArtifactManager::new(tmp.path());
        let run_id = Uuid::new_v4();

        let manifest = WorkflowManifest {
            steps: vec![
                WorkflowStep {
                    id: "s1".into(),
                    agent: "agent-a".into(),
                    effort: EffortLevel::Quick,
                    inputs: vec![],
                    outputs: vec!["out1.md".into()],
                    instruction: "do 1".into(),
                    gate: None,
                    pre_verify: None,
                    post_verify: None,
                    max_retries: None,
                },
                WorkflowStep {
                    id: "s2".into(),
                    agent: "agent-b".into(),
                    effort: EffortLevel::Quick,
                    inputs: vec!["s1/out1.md".into()],
                    outputs: vec!["out2.md".into()],
                    instruction: "do 2".into(),
                    gate: None,
                    pre_verify: None,
                    post_verify: None,
                    max_retries: None,
                },
            ],
            project_id: None,
        };

        let path = state_file_path_for_run(&artifact_base, run_id);
        let mut meta = serde_json::Map::new();
        meta.insert("branch".to_string(), serde_json::json!("main"));
        let mut state = WorkflowState::new(
            run_id,
            "example-workflow",
            "2026-03-31T10:00:00Z".to_string(),
            manifest
                .steps
                .iter()
                .map(|s| (s.id.clone(), s.instruction.clone())),
            meta,
        );
        state.mark_step_started("s1", "2026-03-31T10:00:01Z".to_string());
        state.mark_step_finished(
            "s1",
            StepExecutionStatus::Completed,
            "2026-03-31T10:00:05Z".to_string(),
            Some(4000),
            None,
        );
        write_workflow_state_atomic(&path, &state).unwrap();

        let plan = detect_resume_plan_for_run(&artifact_base, run_id, &manifest)
            .unwrap()
            .expect("expected resume plan");
        assert_eq!(plan.completed_step_ids, vec!["s1".to_string()]);
        assert_eq!(plan.first_non_completed_step_index, 1);
    }

    #[test]
    fn detect_resume_plan_for_run_falls_back_to_summary_json() {
        let tmp = tempfile::tempdir().unwrap();
        let artifact_base = ArtifactManager::new(tmp.path());
        let run_id = Uuid::new_v4();

        let manifest = WorkflowManifest {
            steps: vec![
                WorkflowStep {
                    id: "s1".into(),
                    agent: "agent-a".into(),
                    effort: EffortLevel::Quick,
                    inputs: vec![],
                    outputs: vec!["out1.md".into()],
                    instruction: "do 1".into(),
                    gate: None,
                    pre_verify: None,
                    post_verify: None,
                    max_retries: None,
                },
                WorkflowStep {
                    id: "s2".into(),
                    agent: "agent-b".into(),
                    effort: EffortLevel::Quick,
                    inputs: vec!["s1/out1.md".into()],
                    outputs: vec!["out2.md".into()],
                    instruction: "do 2".into(),
                    gate: None,
                    pre_verify: None,
                    post_verify: None,
                    max_retries: None,
                },
            ],
            project_id: None,
        };

        // Write summary.json with s1 succeeded, s2 failed — no state.json.
        let run_dir = artifact_base.run_dir(run_id);
        std::fs::create_dir_all(&run_dir).unwrap();
        let summary = RunSummary {
            run_id,
            steps: vec![
                StepSummaryEntry {
                    step_id: "s1".into(),
                    agent: "agent-a".into(),
                    status: StepStatus::Success,
                    input_artifacts: vec![],
                    output_artifacts: vec![],
                    tokens_used: Some(100),
                    cost_usd: None,
                    duration_ms: None,
                    num_turns: None,
                    retry_count: 0,
                    output_hashes: HashMap::new(),
                },
                StepSummaryEntry {
                    step_id: "s2".into(),
                    agent: "agent-b".into(),
                    status: StepStatus::Failure,
                    input_artifacts: vec![],
                    output_artifacts: vec![],
                    tokens_used: None,
                    cost_usd: None,
                    duration_ms: None,
                    num_turns: None,
                    retry_count: 0,
                    output_hashes: HashMap::new(),
                },
            ],
            metadata: HashMap::new(),
        };
        let json = serde_json::to_string_pretty(&summary).unwrap();
        std::fs::write(run_dir.join("summary.json"), json).unwrap();

        let plan = detect_resume_plan_for_run(&artifact_base, run_id, &manifest)
            .unwrap()
            .expect("expected resume plan from summary.json");
        assert_eq!(plan.completed_step_ids, vec!["s1".to_string()]);
        assert_eq!(plan.first_non_completed_step_index, 1);
    }

    #[test]
    fn dispatch_noop_marks_all_steps_success_when_inputs_exist() {
        let tmp = tempfile::tempdir().unwrap();
        let am = ArtifactManager::new(tmp.path());
        let run_id = Uuid::new_v4();

        let manifest = WorkflowManifest {
            steps: vec![
                WorkflowStep {
                    id: "step-01".into(),
                    agent: "agent-a".into(),
                    effort: EffortLevel::Quick,
                    inputs: vec![],
                    outputs: vec!["out.md".into()],
                    instruction: "do a".into(),
                    gate: None,
                    pre_verify: None,
                    post_verify: None,
                    max_retries: None,
                },
                WorkflowStep {
                    id: "step-02".into(),
                    agent: "agent-b".into(),
                    effort: EffortLevel::Investigate,
                    inputs: vec!["step-01/out.md".into()],
                    outputs: vec!["out.md".into()],
                    instruction: "do b".into(),
                    gate: None,
                    pre_verify: None,
                    post_verify: None,
                    max_retries: None,
                },
            ],
            project_id: None,
        };

        // Materialize run dir and create the expected artifact for step-01.
        let run_dir = materialize_run_directory(&am, run_id, &manifest).unwrap();
        let step1_out = am.output_artifact_path(run_id, "step-01", "out.md");
        std::fs::create_dir_all(step1_out.parent().unwrap()).unwrap();
        std::fs::write(&step1_out, "ok").unwrap();

        let summary = dispatch_manifest_noop(&am, run_id, &manifest).unwrap();
        assert_eq!(summary.steps.len(), 2);
        assert!(
            summary
                .steps
                .iter()
                .all(|s| matches!(s.status, StepStatus::Success))
        );

        // Summary.json should have been updated.
        let summary_path = run_dir.join("summary.json");
        let contents = std::fs::read_to_string(summary_path).unwrap();
        assert!(contents.contains("\"step_id\": \"step-01\""));
        assert!(contents.contains("\"step_id\": \"step-02\""));
    }

    #[test]
    fn dispatch_noop_sets_failure_and_skipped_on_missing_input() {
        let tmp = tempfile::tempdir().unwrap();
        let am = ArtifactManager::new(tmp.path());
        let run_id = Uuid::new_v4();

        let manifest = WorkflowManifest {
            steps: vec![
                WorkflowStep {
                    id: "step-01".into(),
                    agent: "agent-a".into(),
                    effort: EffortLevel::Quick,
                    inputs: vec![],
                    outputs: vec!["out.md".into()],
                    instruction: "do a".into(),
                    gate: None,
                    pre_verify: None,
                    post_verify: None,
                    max_retries: None,
                },
                WorkflowStep {
                    id: "step-02".into(),
                    agent: "agent-b".into(),
                    effort: EffortLevel::Investigate,
                    inputs: vec!["step-01/out.md".into()],
                    outputs: vec!["out2.md".into()],
                    instruction: "do b".into(),
                    gate: None,
                    pre_verify: None,
                    post_verify: None,
                    max_retries: None,
                },
            ],
            project_id: None,
        };

        let run_dir = materialize_run_directory(&am, run_id, &manifest).unwrap();

        let err = dispatch_manifest_noop(&am, run_id, &manifest).unwrap_err();
        match err {
            OrchestratorError::DependencyMissing {
                step_id,
                artifact_path,
            } => {
                assert_eq!(step_id, "step-02");
                assert!(artifact_path.to_string_lossy().contains("step-01"));
            }
            other => panic!("expected DependencyMissing, got {other:?}"),
        }

        // Summary should reflect Failure for step-02 and Success or Pending for step-01.
        let contents = std::fs::read_to_string(run_dir.join("summary.json")).unwrap();
        assert!(contents.contains("\"step_id\": \"step-02\""));
        assert!(contents.contains("\"failure\"") || contents.contains("\"skipped\""));
    }

    #[test]
    fn build_step_system_prompt_includes_absolute_paths_and_effort() {
        let tmp = tempfile::tempdir().unwrap();
        let am = ArtifactManager::new(tmp.path());
        let run_id = Uuid::new_v4();

        let step = WorkflowStep {
            id: "s1".into(),
            agent: "agent-a".into(),
            effort: EffortLevel::Investigate,
            inputs: vec!["s0/in.md".into(), "/already/absolute.md".into()],
            outputs: vec!["out.md".into()],
            instruction: "Summarize the research artifacts.".into(),
            gate: None,
            pre_verify: None,
            post_verify: None,
            max_retries: None,
        };

        // Materialize a fake producer output so the relative ref resolves under the run dir.
        let producer_path = am.output_artifact_path(run_id, "s0", "in.md");
        std::fs::create_dir_all(producer_path.parent().unwrap()).unwrap();
        std::fs::write(&producer_path, "data").unwrap();

        let prompt = build_step_system_prompt(&am, run_id, &step);

        // Prompt should mention the absolute producer path and the explicit effort directive.
        assert!(prompt.contains(&*producer_path.to_string_lossy()));
        assert!(prompt.contains("/already/absolute.md"));
        assert!(prompt.contains("investigate — thorough analysis"));
        assert!(prompt.contains("filesystem paths instead of expecting their contents"));
        assert!(prompt.contains("Output artifact paths (write your results here):"));
        assert!(
            prompt.contains(
                &*am.output_artifact_path(run_id, "s1", "out.md")
                    .to_string_lossy()
            )
        );
    }

    #[test]
    fn build_step_system_prompt_handles_no_inputs() {
        let tmp = tempfile::tempdir().unwrap();
        let am = ArtifactManager::new(tmp.path());
        let run_id = Uuid::new_v4();
        let step = WorkflowStep {
            id: "s-root".into(),
            agent: "agent-a".into(),
            effort: EffortLevel::Quick,
            inputs: vec![],
            outputs: vec!["out.md".into()],
            instruction: "Do root work.".into(),
            gate: None,
            pre_verify: None,
            post_verify: None,
            max_retries: None,
        };
        let prompt = build_step_system_prompt(&am, run_id, &step);
        assert!(prompt.contains("This step has no upstream artifact dependencies."));
        assert!(prompt.contains("no sub-agent calls"));
    }

    #[tokio::test]
    async fn dispatch_manifest_async_writes_summary_and_tokens() {
        let tmp = tempfile::tempdir().unwrap();
        let am = ArtifactManager::new(tmp.path());
        let run_id = Uuid::new_v4();
        let manifest = WorkflowManifest {
            steps: vec![WorkflowStep {
                id: "step-01".into(),
                agent: "agent-a".into(),
                effort: EffortLevel::Investigate,
                inputs: vec![],
                outputs: vec!["out.md".into()],
                instruction: "Write output.".into(),
                gate: None,
                pre_verify: None,
                post_verify: None,
                max_retries: None,
            }],
            project_id: None,
        };
        materialize_run_directory(&am, run_id, &manifest).unwrap();

        let registry = Arc::new(MockRegistry {
            agents: HashSet::from(["agent-a".to_string()]),
        });
        let executor = Arc::new(MockExecutor {
            writes_outputs: true,
            seen_prompts: Mutex::new(vec![]),
        });

        let summary = dispatch_manifest(
            &am,
            run_id,
            &manifest,
            registry,
            executor,
            &DispatchOptions::default(),
        )
        .await
        .unwrap();
        assert_eq!(summary.steps.len(), 1);
        assert!(matches!(summary.steps[0].status, StepStatus::Success));
        assert_eq!(summary.steps[0].tokens_used, Some(123));
    }

    #[tokio::test]
    async fn dispatch_manifest_async_returns_agent_not_found() {
        let tmp = tempfile::tempdir().unwrap();
        let am = ArtifactManager::new(tmp.path());
        let run_id = Uuid::new_v4();
        let manifest = WorkflowManifest {
            steps: vec![WorkflowStep {
                id: "step-01".into(),
                agent: "missing-agent".into(),
                effort: EffortLevel::Quick,
                inputs: vec![],
                outputs: vec!["out.md".into()],
                instruction: "Write output.".into(),
                gate: None,
                pre_verify: None,
                post_verify: None,
                max_retries: None,
            }],
            project_id: None,
        };
        materialize_run_directory(&am, run_id, &manifest).unwrap();

        let registry = Arc::new(MockRegistry {
            agents: HashSet::new(),
        });
        let executor = Arc::new(MockExecutor {
            writes_outputs: true,
            seen_prompts: Mutex::new(vec![]),
        });

        let err = dispatch_manifest(
            &am,
            run_id,
            &manifest,
            registry,
            executor,
            &DispatchOptions::default(),
        )
        .await
        .unwrap_err();
        assert!(matches!(err, OrchestratorError::AgentNotFound { .. }));
    }

    #[tokio::test]
    async fn dispatch_manifest_e2e_three_step_workflow_validates_sc_001_002_005() {
        let tmp = tempfile::tempdir().unwrap();
        let am = ArtifactManager::new(tmp.path());
        let run_id = Uuid::new_v4();
        let manifest_yaml = r#"
steps:
  - id: step-01-research
    agent: agent-research
    effort: quick
    inputs: []
    outputs: ["research.md"]
    instruction: "Research the repository and produce notes."
  - id: step-02-draft
    agent: agent-draft
    effort: investigate
    inputs: ["step-01-research/research.md"]
    outputs: ["draft.md"]
    instruction: "Draft a proposal from research."
  - id: step-03-review
    agent: agent-review
    effort: deep
    inputs: ["step-02-draft/draft.md"]
    outputs: ["review.md"]
    instruction: "Review and harden the draft."
"#;
        let manifest: WorkflowManifest = serde_yaml::from_str(manifest_yaml).unwrap();
        materialize_run_directory(&am, run_id, &manifest).unwrap();

        let registry = Arc::new(MockRegistry {
            agents: HashSet::from([
                "agent-research".to_string(),
                "agent-draft".to_string(),
                "agent-review".to_string(),
            ]),
        });
        let executor = Arc::new(E2eArtifactExecutor);

        let summary = dispatch_manifest(
            &am,
            run_id,
            &manifest,
            registry,
            executor,
            &DispatchOptions::default(),
        )
        .await
        .unwrap();
        assert_eq!(summary.steps.len(), 3);
        assert!(
            summary
                .steps
                .iter()
                .all(|s| matches!(s.status, StepStatus::Success))
        );

        // SC-001: downstream steps consume upstream artifact content from filesystem.
        let step1_out = am.output_artifact_path(run_id, "step-01-research", "research.md");
        let step2_out = am.output_artifact_path(run_id, "step-02-draft", "draft.md");
        let step3_out = am.output_artifact_path(run_id, "step-03-review", "review.md");
        let step1_text = std::fs::read_to_string(step1_out).unwrap();
        let step2_text = std::fs::read_to_string(step2_out).unwrap();
        let step3_text = std::fs::read_to_string(step3_out).unwrap();
        assert!(step2_text.contains(&step1_text));
        assert!(step3_text.contains(&step2_text));

        // SC-002: token counters are present and lower than a plausible single-context baseline.
        let total_tokens: u64 = summary
            .steps
            .iter()
            .map(|s| s.tokens_used.unwrap_or(0))
            .sum();
        let single_context_baseline = 4000u64;
        assert!(total_tokens < (single_context_baseline / 5));

        // SC-005: effort levels generate measurably different output sizes.
        assert!(step1_text.len() < step2_text.len());
        assert!(step2_text.len() < step3_text.len());
    }

    // --- SC-098-6: E2E bypass run → ineligible promotion → CompletedLocal ---

    struct AlwaysPresentRegistry2;

    #[async_trait]
    impl AgentRegistry for AlwaysPresentRegistry2 {
        async fn has_agent(&self, _id: &str) -> bool {
            true
        }
    }

    struct FileWritingExecutor2;

    #[async_trait]
    impl GovernedExecutor for FileWritingExecutor2 {
        async fn dispatch_step(&self, request: DispatchRequest) -> Result<DispatchResult, String> {
            // Write output artifacts so verification passes.
            for path in &request.output_artifacts {
                if let Some(parent) = path.parent() {
                    std::fs::create_dir_all(parent).unwrap();
                }
                std::fs::write(path, "ok").unwrap();
            }
            Ok(DispatchResult {
                tokens_used: Some(50),
                output_hashes: HashMap::new(),
                session_id: None,
                cost_usd: None,
                duration_ms: None,
                num_turns: None,
                governance_mode: None,
            })
        }
    }

    #[tokio::test]
    async fn sc098_6_bypass_run_produces_completed_local() {
        use crate::sqlite_state::{LocalEventNotifier, SqliteWorkflowStore};
        use crate::state::WorkflowStatus;

        let tmp = tempfile::tempdir().unwrap();
        let am = ArtifactManager::new(tmp.path());
        let run_id = Uuid::new_v4();

        // Manifest with one step, scoped to a workspace
        let manifest = WorkflowManifest {
            steps: vec![WorkflowStep {
                id: "s1".into(),
                agent: "test-agent".into(),
                effort: EffortLevel::Quick,
                inputs: vec![],
                outputs: vec!["out.md".into()],
                instruction: "do something".into(),
                gate: None,
                pre_verify: None,
                post_verify: None,
                max_retries: None,
            }],
            project_id: Some("ws-test-098".into()),
        };

        materialize_run_directory(&am, run_id, &manifest).unwrap();

        let db_path = tmp.path().join("test.db");
        let store = Arc::new(SqliteWorkflowStore::open(&db_path).unwrap());
        let notifier = Arc::new(LocalEventNotifier::new());

        let persistence = PersistenceContext {
            store: store.clone(),
            notifier,
        };

        // Options with governance_mode = "bypass" (098 Slice 2 flow)
        let options = DispatchOptions {
            governance_mode: Some("bypass".to_string()),
            ..Default::default()
        };

        let _summary = dispatch_manifest_persisted(
            &am,
            run_id,
            &manifest,
            Arc::new(AlwaysPresentRegistry2),
            Arc::new(FileWritingExecutor2),
            &persistence,
            &options,
        )
        .await
        .unwrap();

        // Load persisted state and verify governance metadata
        let state = store.load_workflow_state(run_id).await.unwrap().unwrap();

        // SC-098-2: governance_mode is persisted in metadata
        let gov_mode = state
            .metadata
            .get("governance_mode")
            .and_then(|v| v.as_str());
        assert_eq!(gov_mode, Some("bypass"));

        // SC-098-3: promotion check flags bypass as ineligible
        let promo = state
            .metadata
            .get("promotion")
            .expect("promotion metadata missing");
        assert_eq!(
            promo.get("governance_active").and_then(|v| v.as_bool()),
            Some(false)
        );

        // SC-098-6: status is CompletedLocal (not Completed)
        assert!(
            matches!(state.status, WorkflowStatus::CompletedLocal),
            "expected CompletedLocal, got {:?}",
            state.status
        );
    }

    // --- Spec 198 FR-005: PreStepGate halts run on Err ---

    struct AlwaysFailGate;

    #[async_trait]
    impl PreStepGate for AlwaysFailGate {
        async fn before_step(&self, step_id: &str) -> Result<(), String> {
            Err(format!("grant refused for step {step_id}"))
        }
    }

    struct AlwaysPassGate;

    #[async_trait]
    impl PreStepGate for AlwaysPassGate {
        async fn before_step(&self, _step_id: &str) -> Result<(), String> {
            Ok(())
        }
    }

    struct AlwaysPresentRegistryForGate;

    #[async_trait]
    impl AgentRegistry for AlwaysPresentRegistryForGate {
        async fn has_agent(&self, _id: &str) -> bool {
            true
        }
    }

    struct WritingExecutorForGate;

    #[async_trait]
    impl GovernedExecutor for WritingExecutorForGate {
        async fn dispatch_step(&self, request: DispatchRequest) -> Result<DispatchResult, String> {
            for path in &request.output_artifacts {
                if let Some(parent) = path.parent() {
                    std::fs::create_dir_all(parent).unwrap();
                }
                std::fs::write(path, "ok").unwrap();
            }
            Ok(DispatchResult {
                tokens_used: Some(10),
                output_hashes: HashMap::new(),
                session_id: None,
                cost_usd: None,
                duration_ms: None,
                num_turns: None,
                governance_mode: None,
            })
        }
    }

    #[tokio::test]
    async fn pre_step_gate_err_fails_step_and_halts_run() {
        // A single-step manifest with a gate that always refuses: the run must
        // return StepFailed and the step status must be Failure.
        let tmp = tempfile::tempdir().unwrap();
        let am = ArtifactManager::new(tmp.path());
        let run_id = Uuid::new_v4();
        let manifest = WorkflowManifest {
            steps: vec![WorkflowStep {
                id: "s1".into(),
                agent: "agent-a".into(),
                effort: EffortLevel::Quick,
                inputs: vec![],
                outputs: vec!["out.md".into()],
                instruction: "work".into(),
                gate: None,
                pre_verify: None,
                post_verify: None,
                max_retries: None,
            }],
            project_id: None,
        };
        materialize_run_directory(&am, run_id, &manifest).unwrap();
        let options = DispatchOptions {
            pre_step: Some(Arc::new(AlwaysFailGate)),
            ..DispatchOptions::default()
        };
        let result = dispatch_manifest(
            &am,
            run_id,
            &manifest,
            Arc::new(AlwaysPresentRegistryForGate),
            Arc::new(WritingExecutorForGate),
            &options,
        )
        .await;
        match result {
            Err(OrchestratorError::StepFailed { step_id, reason }) => {
                assert_eq!(step_id, "s1");
                assert!(
                    reason.contains("grant refused"),
                    "unexpected reason: {reason}"
                );
            }
            other => panic!("expected StepFailed, got {other:?}"),
        }
    }

    #[tokio::test]
    async fn pre_step_gate_ok_does_not_block_run() {
        // A passing gate must not interfere with normal execution.
        let tmp = tempfile::tempdir().unwrap();
        let am = ArtifactManager::new(tmp.path());
        let run_id = Uuid::new_v4();
        let manifest = WorkflowManifest {
            steps: vec![WorkflowStep {
                id: "s1".into(),
                agent: "agent-a".into(),
                effort: EffortLevel::Quick,
                inputs: vec![],
                outputs: vec!["out.md".into()],
                instruction: "work".into(),
                gate: None,
                pre_verify: None,
                post_verify: None,
                max_retries: None,
            }],
            project_id: None,
        };
        materialize_run_directory(&am, run_id, &manifest).unwrap();
        let options = DispatchOptions {
            pre_step: Some(Arc::new(AlwaysPassGate)),
            ..DispatchOptions::default()
        };
        let summary = dispatch_manifest(
            &am,
            run_id,
            &manifest,
            Arc::new(AlwaysPresentRegistryForGate),
            Arc::new(WritingExecutorForGate),
            &options,
        )
        .await
        .unwrap();
        assert!(matches!(summary.steps[0].status, StepStatus::Success));
    }

    // --- Spec 202 FR-002: after_step delivers per-step actuals to the gate ---

    #[derive(Default)]
    struct RecordingGate {
        recorded: std::sync::Mutex<Vec<(String, Option<u64>)>>,
    }

    #[async_trait]
    impl PreStepGate for RecordingGate {
        async fn before_step(&self, _step_id: &str) -> Result<(), String> {
            Ok(())
        }
        async fn after_step(&self, actuals: &StepActuals) {
            self.recorded
                .lock()
                .unwrap()
                .push((actuals.step_id.clone(), actuals.tokens_used));
        }
    }

    #[tokio::test]
    async fn after_step_receives_actuals_for_each_completed_step() {
        let tmp = tempfile::tempdir().unwrap();
        let am = ArtifactManager::new(tmp.path());
        let run_id = Uuid::new_v4();
        let mk = |id: &str, out: &str| WorkflowStep {
            id: id.into(),
            agent: "agent-a".into(),
            effort: EffortLevel::Quick,
            inputs: vec![],
            outputs: vec![out.into()],
            instruction: "work".into(),
            gate: None,
            pre_verify: None,
            post_verify: None,
            max_retries: None,
        };
        let manifest = WorkflowManifest {
            steps: vec![mk("s1", "out1.md"), mk("s2", "out2.md")],
            project_id: None,
        };
        materialize_run_directory(&am, run_id, &manifest).unwrap();
        let gate = Arc::new(RecordingGate::default());
        let gate_dyn: Arc<dyn PreStepGate> = gate.clone();
        let options = DispatchOptions {
            pre_step: Some(gate_dyn),
            ..DispatchOptions::default()
        };
        dispatch_manifest(
            &am,
            run_id,
            &manifest,
            Arc::new(AlwaysPresentRegistryForGate),
            Arc::new(WritingExecutorForGate),
            &options,
        )
        .await
        .unwrap();
        let recorded = gate.recorded.lock().unwrap();
        assert_eq!(
            recorded.len(),
            2,
            "after_step must fire once per completed step"
        );
        let ids: Vec<&str> = recorded.iter().map(|(id, _)| id.as_str()).collect();
        assert!(ids.contains(&"s1"), "missing s1: {ids:?}");
        assert!(ids.contains(&"s2"), "missing s2: {ids:?}");
        // WritingExecutorForGate reports 10 tokens per step.
        assert!(
            recorded.iter().all(|(_, t)| *t == Some(10)),
            "actuals must carry per-step tokens: {recorded:?}"
        );
    }

    // --- Spec 202 AC-1: the WIRED budget gate pauses the run fail-closed at
    // the next step boundary once accumulated run actuals exceed an admitted
    // ceiling. This drives the real RunBudgetMeter + BudgetGate through
    // dispatch_manifest inside a ChainedPreStepGate (the exact production
    // topology the OPC wires: a passing gate first, the budget gate second,
    // short-circuit on the first Err), not the meter in isolation. The budget
    // meter is pre-seeded with a prior step's actuals so the run has already
    // exceeded its ceiling; the chained gate must then refuse the next boundary
    // with an attributable, axis-named error. Organic cross-step accumulation
    // and chain ordering are additionally covered by budget_gate's unit tests
    // (tokens_breach_pauses_at_next_boundary,
    // chain_pauses_on_budget_breach_behind_passing_gate). ---

    #[tokio::test]
    async fn wired_budget_gate_pauses_dispatch_on_breach() {
        let tmp = tempfile::tempdir().unwrap();
        let am = ArtifactManager::new(tmp.path());
        let run_id = Uuid::new_v4();
        let manifest = WorkflowManifest {
            steps: vec![WorkflowStep {
                id: "s1".into(),
                agent: "agent-a".into(),
                effort: EffortLevel::Quick,
                inputs: vec![],
                outputs: vec!["out1.md".into()],
                instruction: "work".into(),
                gate: None,
                pre_verify: None,
                post_verify: None,
                max_retries: None,
            }],
            project_id: None,
        };
        materialize_run_directory(&am, run_id, &manifest).unwrap();

        // Tokens ceiling of 5, meter pre-seeded with a prior step reporting 10
        // tokens: the run has already breached, so the next boundary fails closed.
        let ceilings = vec![factory_contracts::AdmittedBudget {
            axis: factory_contracts::RunBudgetAxis::Tokens,
            ceiling_per_run: factory_contracts::BudgetValue::Integer(5),
            ceiling_per_stage: None,
            source: factory_contracts::BudgetSource::Declared,
        }];
        let mut seeded = RunBudgetMeter::new(ceilings);
        seeded.record_step(&StepActuals {
            step_id: "prior".into(),
            tokens_used: Some(10),
            cost_usd: None,
            duration_ms: None,
            num_turns: None,
            success: true,
            retry_count: 0,
            instruction: None,
        });
        let meter = Arc::new(std::sync::Mutex::new(seeded));
        let budget_gate: Arc<dyn PreStepGate> = Arc::new(BudgetGate::new(meter));
        // A gate that always passes (empty ceilings => check() is always None),
        // standing in for the GrantRenewalGate that precedes the budget gate on
        // the governed OPC path. The chain must still fail closed on the budget
        // breach behind it.
        let passing_gate: Arc<dyn PreStepGate> = Arc::new(BudgetGate::new(Arc::new(
            std::sync::Mutex::new(RunBudgetMeter::new(vec![])),
        )));
        let chained: Arc<dyn PreStepGate> =
            Arc::new(ChainedPreStepGate::new(vec![passing_gate, budget_gate]));
        let options = DispatchOptions {
            pre_step: Some(chained),
            ..DispatchOptions::default()
        };
        let result = dispatch_manifest(
            &am,
            run_id,
            &manifest,
            Arc::new(AlwaysPresentRegistryForGate),
            Arc::new(WritingExecutorForGate),
            &options,
        )
        .await;
        match result {
            Err(OrchestratorError::StepFailed { step_id, reason }) => {
                assert_eq!(step_id, "s1", "the breaching boundary must fail closed");
                assert!(
                    reason.contains("budget ceiling exceeded"),
                    "reason must name the breach: {reason}"
                );
                assert!(reason.contains("Tokens"), "reason must name the axis: {reason}");
            }
            other => panic!("expected StepFailed at s1, got {other:?}"),
        }
    }

    // --- Spec 202 AC-2: the WIRED OscillationGate pauses the run fail-closed
    // when the consecutive-wobble circuit has tripped. This drives the real
    // OscillationGate through dispatch_manifest (the same seam the engine and
    // CLI wire), proving the gate's before_step Err propagates to a StepFailed.
    // The breaker is pre-tripped (mirroring wired_budget's pre-seeded meter)
    // because producing organic retry_count > 0 needs post_verify shell retries;
    // organic wobble-accumulation and the retry-count reframing are covered by
    // budget_gate's unit + composition tests (oscillation_gate_trips_after_
    // threshold_wobbles, chain_fires_oscillation_before_wall_clock_budget). ---

    #[tokio::test]
    async fn wired_oscillation_gate_pauses_dispatch_when_tripped() {
        let tmp = tempfile::tempdir().unwrap();
        let am = ArtifactManager::new(tmp.path());
        let run_id = Uuid::new_v4();
        let manifest = WorkflowManifest {
            steps: vec![WorkflowStep {
                id: "s1".into(),
                agent: "agent-a".into(),
                effort: EffortLevel::Quick,
                inputs: vec![],
                outputs: vec!["out1.md".into()],
                instruction: "work".into(),
                gate: None,
                pre_verify: None,
                post_verify: None,
                max_retries: None,
            }],
            project_id: None,
        };
        materialize_run_directory(&am, run_id, &manifest).unwrap();

        // A breaker at threshold 2, pre-tripped by two prior wobbles: the next
        // step boundary must fail closed with the oscillation diagnostic.
        let mut breaker = CircuitBreakerState::new(CircuitBreakerConfig {
            threshold: 2,
            window_secs: 300,
        });
        breaker.record_failure();
        breaker.record_failure();
        assert!(breaker.is_tripped(), "breaker must be pre-tripped");
        let osc_gate: Arc<dyn PreStepGate> =
            Arc::new(OscillationGate::new(Arc::new(std::sync::Mutex::new(breaker))));
        let options = DispatchOptions {
            pre_step: Some(osc_gate),
            ..DispatchOptions::default()
        };
        let result = dispatch_manifest(
            &am,
            run_id,
            &manifest,
            Arc::new(AlwaysPresentRegistryForGate),
            Arc::new(WritingExecutorForGate),
            &options,
        )
        .await;
        match result {
            Err(OrchestratorError::StepFailed { step_id, reason }) => {
                assert_eq!(step_id, "s1", "the tripped boundary must fail closed");
                assert!(
                    reason.contains("oscillation detected"),
                    "reason must name the oscillation breach: {reason}"
                );
            }
            other => panic!("expected StepFailed at s1, got {other:?}"),
        }
    }

    /// Wiring (spec 202 FR-003a): the real `dispatch_manifest` loop threads each
    /// successful step's instruction text into `IntentDedupGate::after_step`, so
    /// a run that repeats one instruction past `max_repeats` fails closed at the
    /// next boundary. This guards the success-path `StepActuals { instruction:
    /// Some(..) }` call site the `budget_gate.rs` unit tests (which hand-build
    /// `StepActuals`) cannot reach: a missed or mis-branched site would leave the
    /// count at zero and this test would not trip.
    #[tokio::test]
    async fn wired_intent_dedup_gate_pauses_dispatch_on_repeated_instruction() {
        let tmp = tempfile::tempdir().unwrap();
        let am = ArtifactManager::new(tmp.path());
        let run_id = Uuid::new_v4();
        // Three independent steps (no deps) sharing the SAME instruction.
        let step = |id: &str, out: &str| WorkflowStep {
            id: id.into(),
            agent: "agent-a".into(),
            effort: EffortLevel::Quick,
            inputs: vec![],
            outputs: vec![out.into()],
            instruction: "do the identical thing".into(),
            gate: None,
            pre_verify: None,
            post_verify: None,
            max_retries: None,
        };
        let manifest = WorkflowManifest {
            steps: vec![step("s0", "o0.md"), step("s1", "o1.md"), step("s2", "o2.md")],
            project_id: None,
        };
        materialize_run_directory(&am, run_id, &manifest).unwrap();

        // max_repeats=1: the loop records the first two identical steps (count
        // reaches 2), then the third boundary sees 2 > 1 and fails closed. This
        // can only trip if the success-path after_step threaded the instruction.
        let dedup: Arc<dyn PreStepGate> = Arc::new(budget_gate::IntentDedupGate::new(
            "goal-wired",
            factory_contracts::IntentDedupThreshold {
                max_repeats: 1,
                window_secs: Some(300),
            },
        ));
        let options = DispatchOptions {
            pre_step: Some(dedup),
            ..DispatchOptions::default()
        };
        let result = dispatch_manifest(
            &am,
            run_id,
            &manifest,
            Arc::new(AlwaysPresentRegistryForGate),
            Arc::new(WritingExecutorForGate),
            &options,
        )
        .await;
        match result {
            Err(OrchestratorError::StepFailed { reason, .. }) => {
                assert!(
                    reason.contains("repeated intent detected"),
                    "the run must fail closed on the repeated intent, proving the \
                     dispatch loop threaded step.instruction into after_step: {reason}"
                );
            }
            other => panic!("expected StepFailed from the intent-dedup gate, got {other:?}"),
        }
    }
}
