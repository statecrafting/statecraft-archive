// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Bartek Kus

//! Rust contract types for the Factory delivery engine (spec 074).
//!
//! This crate provides typed Rust representations of all four Factory contract
//! schemas: Build Spec, Adapter Manifest, Pipeline State, and Verification
//! Contract. It also provides adapter discovery, agent prompt loading, pattern
//! resolution, and schema validation.

pub mod adapter_manifest;
pub mod adapter_registry;
pub mod agent_loader;
pub mod agent_reference;
pub mod budget;
pub mod build_spec;
pub mod governance_envelope;
pub mod knowledge;
pub mod namespace;
pub mod pattern_resolver;
pub mod pipeline_state;
pub mod provenance;
pub mod provenance_config;
pub mod run_budget;
pub mod sandbox;
pub mod stakeholder_docs;
pub mod validation;
pub mod verification;

pub use adapter_manifest::{
    AdapterGovernance, AdapterManifest, ScaffoldExecution,
    ADAPTER_MANIFEST_ACCEPTED_SCHEMA_VERSIONS, ADAPTER_MANIFEST_SCHEMA_VERSION,
};
pub use adapter_registry::AdapterRegistry;
pub use governance_envelope::{
    covered_by, reconcile_adapter, reconcile_process, GovernanceEnvelope, ReconcileViolation,
    GOVERNANCE_ENVELOPE_SCHEMA_VERSION,
};
pub use run_budget::{
    apply_defaults, apply_intent_dedup_default, apply_oscillation_default, AdmittedBudget,
    BudgetSource, BudgetValue, IntentDedupThreshold, OscillationThreshold, RunBudgetAxis,
    RunBudgetCeiling, PLATFORM_DEFAULT_BUDGETS, PLATFORM_DEFAULT_INTENT_DEDUP,
    PLATFORM_DEFAULT_OSCILLATION_THRESHOLD,
};
pub use agent_loader::AgentPrompt;
pub use agent_reference::AgentReference;
pub use budget::AssumptionBudget;
pub use build_spec::{BuildSpec, BUILD_SPEC_SCHEMA_VERSION};
pub use pattern_resolver::PatternResolver;
pub use pipeline_state::{PipelineState, PIPELINE_STATE_SCHEMA_VERSION};
pub use provenance::{
    anchor_canonical_tokens, anchor_hash, quote_hash,
    PROVENANCE_SCHEMA_VERSION,
};
pub use provenance_config::{
    FactoryProvenanceMode, ProvenanceConfig, ProvenanceConfigError,
};
pub use stakeholder_docs::{
    AnchorKind, AnchoredSection, AppliedFromEntry, AuthoringStatus, DocKind,
    SectionAnchor, SemVer, StakeholderDoc, StakeholderDocParseError,
    StakeholderFrontmatter, STAKEHOLDER_DOC_SCHEMA_VERSION,
};
pub use verification::VerificationContract;

/// Re-export of `chrono::DateTime`, `Utc`, and `TimeZone` so downstream
/// crates that consume contract types like `AssumptionTag.expires_at`
/// can name them without adding `chrono` as a direct dependency. The
/// `provenance-validator` crate (FR-001 caps its `[dependencies]` at the
/// five enumerated crates) consumes the chrono types exclusively through
/// this re-export.
pub use chrono::{DateTime, TimeZone, Utc};

/// Wall-clock timestamp helper for callers that need `now` without
/// pulling `chrono` into their own `[dependencies]`. Used by
/// `provenance-validator`'s audit binary entry point.
pub fn now_utc() -> DateTime<Utc> {
    Utc::now()
}
