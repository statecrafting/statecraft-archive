// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Bartek Kus
// Feature: AGENT_AUTOMATION
// Spec: spec/agent/automation.md

use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
pub struct ChangesetMetaV1 {
    pub schema_version: String, // "v1"
    pub change_set_id: String,
    pub base_state_created_at: String, // ISO8601, derived from base state
    pub plan_sha256: String,
    pub repo_key: String,
    pub base_state: String,
    pub intent: String,
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
pub struct ImplementationPlanV1 {
    pub schema_version: String,
    pub goal: String,
    pub tasks: Vec<PlanTask>,
    pub tiers: Vec<String>,
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
pub struct PlanTask {
    pub id: String,
    pub step_type: String, // added step_type
    pub description: String,
    pub tool_calls: Vec<ToolCall>,
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
pub struct ToolCall {
    pub tool_name: String,
    pub arguments: serde_json::Value,
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
pub struct ChangesetStatusV1 {
    pub schema_version: String,
    pub state: String, // pending_validation, validated, approved, executed, failed
    pub validation: ValidationStatus,
    pub execution: ExecutionStatus,
    pub verification: Option<VerificationSummary>,
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
pub struct VerificationSummary {
    pub last_run: VerificationRunInfo,
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
pub struct VerificationRunInfo {
    pub profile: String,
    pub outcome: String,
    pub timestamp: String,
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
pub struct ValidationStatus {
    pub state: String, // valid, invalid
    pub checks: Vec<ValidationResult>,
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
pub struct ValidationResult {
    pub check_name: String,
    pub passed: bool,
    pub message: Option<String>,
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
pub struct ExecutionStatus {
    pub state: String, // pending, running, completed, failed
    pub steps_completed: usize,
    pub error: Option<String>,
    pub log: Vec<ExecutionEntry>,
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
pub struct ExecutionEntry {
    pub step_id: String,
    pub status: String,
    pub output: Option<String>,
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
pub struct LockFile {
    pub change_set_id: String,
    pub repo_key: String,
    pub base_state: String,
    pub base_state_created_at: String,
}
