//! Layer 3-5 types for the OAP-side enriched codebase index.
//!
//! Cut D W-07a: mirrored from `tools/codebase-indexer/src/types.rs`.
//! W-07c removes the duplicate from the generic indexer; this file
//! becomes the canonical home for AdapterRecord, Infrastructure,
//! NamedEntry, ToolEntry, WorkflowTrace, WorkflowTraceSource.

use serde::{Deserialize, Serialize};

// ── Layer 3: Factory Adapter Inventory ──────────────────────────────────────

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AdapterRecord {
    pub name: String,
    pub path: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub target_stack: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub phase_coverage: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub display_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub version: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stack_language: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stack_runtime: Option<String>,
}

// ── Layer 4: Tool & Infrastructure Inventory ────────────────────────────────

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Infrastructure {
    pub tools: Vec<ToolEntry>,
    pub agents: Vec<NamedEntry>,
    pub commands: Vec<NamedEntry>,
    pub rules: Vec<NamedEntry>,
    pub schemas: Vec<NamedEntry>,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolEntry {
    pub name: String,
    pub path: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub binaries: Option<Vec<String>>,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NamedEntry {
    pub name: String,
    pub path: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
}

// ── Layer 5: Workflow-to-Spec Traceability (spec 118) ───────────────────────

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct WorkflowTrace {
    pub path: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub specs: Vec<String>,
    pub source: WorkflowTraceSource,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum WorkflowTraceSource {
    Header,
    Allowlist,
    Unmapped,
}

// ── Diagnostics ─────────────────────────────────────────────────────────────

/// Mirrors `codebase_indexer::types::Diagnostic`. The enricher names
/// the type `EnrichDiagnostic` so consumers can distinguish at the
/// type level between generic-indexer diagnostics and enricher-emitted
/// diagnostics.
#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct EnrichDiagnostic {
    pub code: String,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub path: Option<String>,
}
