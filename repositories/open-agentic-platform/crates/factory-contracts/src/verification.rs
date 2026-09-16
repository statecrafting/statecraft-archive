// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Bartek Kus

//! Rust types for the Factory Verification Contract schema.
//!
//! A Verification Contract defines the gate checks that must pass at each stage
//! of the delivery pipeline: pre-flight, stage gates, scaffolding gates, and
//! final validation.

use serde::{Deserialize, Serialize};

// ── Top-level Verification Contract ───────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VerificationContract {
    pub version: String,
    pub preflight: PreFlight,
    pub stage_gates: Vec<StageGate>,
    pub scaffolding_gates: Vec<ScaffoldingGate>,
    pub final_validation: FinalValidation,
}

// ── Pre-Flight ────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PreFlight {
    pub checks: Vec<PreFlightCheck>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PreFlightCheck {
    pub id: String,
    pub name: String,
    pub description: String,
    pub check_type: PreFlightCheckType,
    #[serde(default)]
    pub required: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub config: Option<serde_yaml::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum PreFlightCheckType {
    SchemaValidation,
    AdapterAvailability,
    DependencyCheck,
    EnvironmentCheck,
    PermissionCheck,
    Custom,
}

// ── Stage Gates ───────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StageGate {
    pub stage: u8,
    pub name: String,
    pub checks: Vec<GateCheckDef>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub approval_required: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub timeout_minutes: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GateCheckDef {
    pub id: String,
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    pub check_type: GateCheckType,
    #[serde(default)]
    pub required: bool,
    #[serde(default)]
    pub blocking: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub config: Option<serde_yaml::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum GateCheckType {
    ArtifactExists,
    ArtifactSchema,
    ContentCheck,
    CrossReference,
    Completeness,
    ConsistencyCheck,
    HumanReview,
    Custom,
}

// ── Scaffolding Gates ─────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScaffoldingGate {
    pub step_id: String,
    pub name: String,
    pub checks: Vec<ScaffoldCheckDef>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScaffoldCheckDef {
    pub id: String,
    pub name: String,
    pub check_type: ScaffoldCheckType,
    #[serde(default)]
    pub required: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub command: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub expected_exit_code: Option<i32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub config: Option<serde_yaml::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum ScaffoldCheckType {
    Compile,
    Lint,
    Test,
    TypeCheck,
    FormatCheck,
    FileExists,
    ContentMatch,
    Custom,
}

// ── Final Validation ──────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FinalValidation {
    pub checks: Vec<FinalCheckDef>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub feature_verification: Option<FeatureVerification>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FinalCheckDef {
    pub id: String,
    pub name: String,
    pub check_type: FinalCheckType,
    #[serde(default)]
    pub required: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub command: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub config: Option<serde_yaml::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum FinalCheckType {
    FullCompile,
    FullTest,
    IntegrationTest,
    CoverageThreshold,
    SecurityScan,
    PerformanceBaseline,
    TraceabilityCheck,
    Custom,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FeatureVerification {
    pub enabled: bool,
    pub commands: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub min_coverage_percent: Option<f64>,
}
