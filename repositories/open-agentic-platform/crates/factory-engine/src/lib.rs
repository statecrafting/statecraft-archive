// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Bartek Kus
// Spec: specs/075-factory-workflow-engine/spec.md

//! Factory Workflow Engine — two-phase orchestration, manifest generation,
//! native verification harness, and policy shard generation (spec 075).
//!
//! This crate extends the OAP orchestrator to natively support Factory pipeline
//! workflows: process stages (s0–s5) that produce a Build Spec, followed by
//! dynamic scaffolding fan-out (s6a–s6g) derived from the Build Spec content.

pub mod agent_bridge;
pub mod agent_resolver;
pub mod artifact_store;
pub mod checks;
pub mod engine;
pub mod factory_root;
pub mod gate;
pub mod governance_certificate;
pub mod harness_state;
pub mod intent_capsule;
pub mod inter_stage_manifest;
pub mod kernel_emission;
pub mod manifest_gen;
pub mod migration;
pub mod pipeline_state;
pub mod platform_jws;
pub mod policy_shard;
pub mod preflight;
pub mod project_config;
pub mod run_audit_chain;
pub mod sandbox;
pub mod statecraft_client;
pub mod stages;
pub mod standards_resolver;
pub mod substrate_version;
pub mod topo_sort;
pub mod verify_harness;
pub mod virtual_root;

pub use factory_root::FactoryRoot;
pub use substrate_version::SUBSTRATE_VERSION;
pub use virtual_root::{ArtifactFetcher, ArtifactRef, VirtualRoot, VirtualRootError};

pub use agent_bridge::FactoryAgentBridge;
pub use engine::{
    FactoryEngine, FactoryEngineConfig, PhaseTransitionResult, PipelineStartResult,
    ScaffoldStepKind, classify_scaffold_step, record_scaffold_completion, record_scaffold_failure,
};
pub use governance_certificate::{
    CertificateBuildError, CertificateBuilder, GovernanceCertificate, InterStageChainRecord,
    OAP_STAGE_IDS, Signer, SignerError, generate_certificate, generate_certificate_with_stage_ids,
    persist_certificate, validate_spec_id_resolution, verify_certificate,
    write_validation_warnings,
};
pub use inter_stage_manifest::{
    InterStageManifest, KEYCHAIN_FILENAME, ManifestError, ManifestSignInputs, ManifestSigner,
    RunKeyChain, StageHandoffSigner, StageKeyRecord, compute_manifest_signature,
    fingerprint_of_pubkey, load_manifest, persist_manifest, sign_manifest, verify_manifest,
};
pub use manifest_gen::{generate_process_manifest, generate_scaffold_manifest};
pub use pipeline_state::{FactoryPhase, FactoryPipelineState, ScaffoldingProgress};
pub use policy_shard::generate_factory_policy_shard;
pub use sandbox::{BackendDescriptor, NullSandboxClient, SandboxClient, SandboxError};
pub use standards_resolver::FactoryStandardsResolver;
pub use verify_harness::run_factory_gate_check;

use thiserror::Error;

/// Errors specific to the Factory workflow engine.
#[derive(Debug, Error)]
pub enum FactoryError {
    #[error("adapter not found: {name}")]
    AdapterNotFound { name: String },

    #[error("invalid build spec: {reason}")]
    InvalidBuildSpec { reason: String },

    #[error("manifest generation failed: {reason}")]
    ManifestGeneration { reason: String },

    #[error("circular entity reference: {cycle}")]
    CircularReference { cycle: String },

    #[error("verification harness failed: {reason}")]
    VerificationHarness { reason: String },

    #[error("phase transition error: {reason}")]
    PhaseTransition { reason: String },

    #[error("orchestrator error: {0}")]
    Orchestrator(#[from] orchestrator::OrchestratorError),

    #[error("s-1-extract stage failed: {0}")]
    Extract(#[from] stages::s_minus_1_extract::ExtractStageError),

    #[error("QG-13 ExternalProvenance gate blocked: {reason}; rejected_ids={rejected_ids:?}")]
    ProvenanceGateFail {
        reason: String,
        rejected_ids: Vec<factory_contracts::provenance::ClaimId>,
    },

    #[error("project config error: {0}")]
    ProjectConfig(#[from] project_config::ProjectConfigError),

    /// Spec 162 §FR-009 — adapter-emitted code cannot be exercised
    /// because no sandbox backend can satisfy the request (or the
    /// backend rejected it). The pipeline halts; there is no
    /// host-execution fallback.
    #[error("sandbox refusal ({category}): {diagnostic}")]
    SandboxRefusal {
        category: &'static str,
        diagnostic: String,
    },

    /// Spec 170 §FR-003 — inter-stage manifest signing or validation
    /// failed. Includes signature mismatch, unknown signer, cross-run
    /// swap, persistence I/O failure.
    #[error("signed inter-stage manifest error: {reason}")]
    SignedHandoff { reason: String },
}

impl From<inter_stage_manifest::ManifestError> for FactoryError {
    fn from(value: inter_stage_manifest::ManifestError) -> Self {
        FactoryError::SignedHandoff {
            reason: value.to_string(),
        }
    }
}
