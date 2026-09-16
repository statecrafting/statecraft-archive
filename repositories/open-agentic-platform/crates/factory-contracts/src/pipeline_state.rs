// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Bartek Kus

//! Rust types for the Factory Pipeline State schema.
//!
//! Pipeline State tracks durable execution state for a delivery pipeline:
//! pipeline identity, stage progress, scaffolding progress, verification
//! results, error log, and audit trail.
//!
//! Written to: `{project-root}/.factory/pipeline-state.json`
//! Schema version: 1.0.0

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// Current Pipeline State contract version. Unchanged by spec 197; named here
/// per the `PROVENANCE_SCHEMA_VERSION` pattern so the version has one canonical
/// home rather than living only in fixtures.
pub const PIPELINE_STATE_SCHEMA_VERSION: &str = "1.0.0";

// ── Top-level Pipeline State ──────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PipelineState {
    pub schema_version: String,
    pub pipeline: PipelineIdentity,
    /// Keyed by stage identifier, e.g. "pre-flight", "business-requirements".
    pub stages: HashMap<String, StageEntry>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub scaffolding: Option<ScaffoldingProgress>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub verification: Option<VerificationResults>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub errors: Vec<ErrorEntry>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub audit: Vec<AuditEntry>,
}

// ── Pipeline Identity ─────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PipelineIdentity {
    pub id: String,
    pub factory_version: String,
    pub started_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub completed_at: Option<DateTime<Utc>>,
    pub status: PipelineStatus,
    pub adapter: AdapterInfo,
    pub build_spec: BuildSpecInfo,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum PipelineStatus {
    Running,
    Paused,
    Completed,
    Failed,
    Cancelled,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AdapterInfo {
    pub name: String,
    pub version: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BuildSpecInfo {
    pub path: String,
    pub hash: String,
}

// ── Stage Progress ────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StageEntry {
    pub status: StageStatus,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub started_at: Option<DateTime<Utc>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub completed_at: Option<DateTime<Utc>>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub artifacts: Vec<StageArtifact>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub gate: Option<Gate>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub agent: Option<AgentMetadata>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum StageStatus {
    Pending,
    InProgress,
    Completed,
    Failed,
    Skipped,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StageArtifact {
    pub path: String,
    #[serde(rename = "type")]
    pub artifact_type: String,
    pub hash: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Gate {
    pub passed: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub checked_at: Option<DateTime<Utc>>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub checks: Vec<GateCheck>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GateCheck {
    pub id: String,
    pub passed: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub severity: Option<CheckSeverity>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum CheckSeverity {
    Error,
    Warning,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentMetadata {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub prompt_tokens: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub completion_tokens: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub duration_seconds: Option<f64>,
}

// ── Scaffolding Progress ──────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScaffoldingProgress {
    pub data: ScaffoldingData,
    pub api: ScaffoldingApi,
    pub ui: ScaffoldingUi,
    pub configure: ScaffoldingConfigure,
    pub trim: ScaffoldingTrim,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ScaffoldingStatus {
    Pending,
    InProgress,
    Completed,
    Failed,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScaffoldingData {
    pub status: ScaffoldingStatus,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub entities_completed: Vec<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub entities_remaining: Vec<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub entities_failed: Vec<EntityFailure>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EntityFailure {
    pub entity: String,
    pub error: String,
    pub retries: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScaffoldingApi {
    pub status: ScaffoldingStatus,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub operations_completed: Vec<OperationCompleted>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub operations_remaining: Vec<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub operations_failed: Vec<OperationFailure>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OperationCompleted {
    pub operation_id: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub files_created: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub verified_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OperationFailure {
    pub operation_id: String,
    pub error: String,
    pub retries: u32,
    pub max_retries: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScaffoldingUi {
    pub status: ScaffoldingStatus,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub pages_completed: Vec<PageCompleted>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub pages_remaining: Vec<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub pages_failed: Vec<PageFailure>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PageCompleted {
    pub page_id: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub files_created: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub verified_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PageFailure {
    pub page_id: String,
    pub error: String,
    pub retries: u32,
    pub max_retries: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScaffoldingConfigure {
    pub status: ScaffoldingStatus,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub steps_completed: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScaffoldingTrim {
    pub status: ScaffoldingStatus,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub files_removed: Vec<String>,
}

// ── Verification Results ──────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VerificationResults {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_full_run: Option<LastFullRun>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub consistency: Vec<ConsistencyCheck>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LastFullRun {
    pub timestamp: DateTime<Utc>,
    pub passed: bool,
    pub results: VerificationRunResults,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VerificationRunResults {
    pub compile: CompileResult,
    pub test: TestResult,
    pub lint: LintResult,
    pub type_check: TypeCheckResult,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CompileResult {
    pub passed: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub output: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TestResult {
    pub passed: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub total: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub passed_count: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub failed_count: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub skipped_count: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub output: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LintResult {
    pub passed: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub warnings: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub errors: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub output: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TypeCheckResult {
    pub passed: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub output: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConsistencyCheck {
    pub check: String,
    pub passed: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub details: Option<String>,
}

// ── Error Log ─────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ErrorEntry {
    pub timestamp: DateTime<Utc>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub stage: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub feature: Option<String>,
    pub error_type: ErrorType,
    pub message: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub retry_number: Option<u32>,
    pub resolved: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum ErrorType {
    Compile,
    Test,
    Lint,
    Generation,
    Validation,
    System,
}

// ── Audit Trail ───────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuditEntry {
    pub timestamp: DateTime<Utc>,
    pub event: AuditEvent,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub stage: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub details: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum AuditEvent {
    StageConfirmed,
    StageRejected,
    FeatureFlagged,
    PipelinePaused,
    PipelineResumed,
    AdapterOverridden,
    ManualFixApplied,
}
