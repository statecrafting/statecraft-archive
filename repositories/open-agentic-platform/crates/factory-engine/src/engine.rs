// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Bartek Kus
// Spec: specs/075-factory-workflow-engine/spec.md

//! Two-phase Factory execution engine.
//!
//! Orchestrates:
//! 1. Phase 1 (Process): stages s0–s5 producing a Build Spec
//! 2. Phase transition: Build Spec freeze → generate Phase 2 manifest
//! 3. Phase 2 (Scaffolding): dynamic fan-out from Build Spec (s6a–s6g)
//!
//! Uses the orchestrator primitives for dispatch, gates, state persistence,
//! and artifact management. Adds Factory-specific verification, retry logic,
//! and pipeline state tracking.

use crate::FactoryError;
use crate::agent_bridge::FactoryAgentBridge;
use crate::artifact_store::LocalArtifactStore;
use crate::factory_root::FactoryRoot;
use crate::inter_stage_manifest::{InterStageManifest, StageHandoffSigner};
use crate::manifest_gen::{generate_process_manifest, generate_scaffold_manifest};
use crate::pipeline_state::{FactoryPipelineState, FailedFeature};
use crate::policy_shard::generate_factory_policy_shard;
use crate::statecraft_client::StatecraftClient;
use crate::stages::s_minus_1_extract::{
    ExtractionStageConfig, ExtractionStageReport, KnowledgeBundleRef, render_s1_context_md,
    run_extraction_stage,
};
use crate::verify_harness::run_factory_gate_check;
use factory_contracts::AdapterRegistry;
use factory_contracts::build_spec::BuildSpec;
use orchestrator::manifest::WorkflowManifest;
use policy_kernel::PolicyBundle;
use sha2::{Digest, Sha256};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tokio_util::sync::CancellationToken;
use uuid::Uuid;

/// Configuration for the Factory engine.
///
/// Spec 139 Phase 3 (T070) — `factory_root` is now a [`FactoryRoot`] enum
/// so the OPC desktop can wire a HTTP-backed [`VirtualRoot`] without
/// changing the engine's internal `&Path` flow. Existing tests + the
/// `factory-run` CLI continue to work via the [`FactoryRoot::Filesystem`]
/// variant; that path is the [`Default`].
#[derive(Clone, Debug)]
pub struct FactoryEngineConfig {
    /// Source of factory content. Filesystem variant carries a path to a
    /// `factory/` checkout; Virtual variant materialises substrate
    /// content into a local cache before engine reads.
    pub factory_root: FactoryRoot,
    /// Path to the target project directory.
    pub project_path: PathBuf,
    /// Maximum concurrent scaffolding steps (NF-001).
    pub concurrency_limit: usize,
}

impl Default for FactoryEngineConfig {
    fn default() -> Self {
        Self {
            factory_root: FactoryRoot::Filesystem(PathBuf::from("factory")),
            project_path: PathBuf::from("."),
            concurrency_limit: 4,
        }
    }
}

/// The Factory two-phase workflow engine.
///
/// Coordinates process stages, Build Spec freeze, and scaffolding fan-out
/// using OAP orchestrator primitives.
pub struct FactoryEngine {
    config: FactoryEngineConfig,
    adapter_registry: AdapterRegistry,
}

impl FactoryEngine {
    /// Create a new engine with adapter discovery.
    pub fn new(config: FactoryEngineConfig) -> Result<Self, FactoryError> {
        let adapter_registry = AdapterRegistry::discover(config.factory_root.local_path())
            .map_err(|e| FactoryError::AdapterNotFound {
                name: format!("discovery failed: {e}"),
            })?;

        Ok(Self {
            config,
            adapter_registry,
        })
    }

    /// Create an engine with pre-loaded adapters (for testing).
    pub fn with_adapters(config: FactoryEngineConfig, adapter_registry: AdapterRegistry) -> Self {
        Self {
            config,
            adapter_registry,
        }
    }

    /// Start a new Factory pipeline.
    ///
    /// Returns the `run_id` and the initial `FactoryPipelineState`.
    ///
    /// This generates the Phase 1 manifest and returns it for dispatch.
    /// The caller is responsible for dispatching via the orchestrator.
    pub fn start_pipeline(
        &self,
        adapter_name: &str,
        business_doc_paths: &[PathBuf],
        project_id: Option<String>,
    ) -> Result<PipelineStartResult, FactoryError> {
        let adapter = self.adapter_registry.get(adapter_name).ok_or_else(|| {
            FactoryError::AdapterNotFound {
                name: adapter_name.into(),
            }
        })?;

        let run_id = Uuid::new_v4();

        // Generate Phase 1 manifest.
        let phase1_manifest = generate_process_manifest(
            adapter,
            business_doc_paths,
            self.config.factory_root.local_path(),
            project_id,
        )?;

        // Create agent bridge.
        let process_agents = factory_contracts::agent_loader::load_process_agents(
            self.config.factory_root.local_path(),
        )
        .unwrap_or_default();
        let adapter_path = self
            .config
            .factory_root
            .local_path()
            .join("adapters")
            .join(adapter_name);
        let adapter_agents =
            factory_contracts::agent_loader::load_adapter_agents(&adapter_path).unwrap_or_default();
        let agent_bridge = FactoryAgentBridge::new(process_agents, adapter_agents);

        // Create initial pipeline state.
        let pipeline_state = FactoryPipelineState::new(run_id.to_string(), adapter_name);

        Ok(PipelineStartResult {
            run_id,
            manifest: phase1_manifest,
            agent_bridge,
            pipeline_state,
        })
    }

    /// Perform the phase transition from Process to Scaffolding.
    ///
    /// Called after stage s5 completes and the Build Spec is frozen.
    /// Reads the Build Spec artifact, hashes it, generates the Phase 2 manifest.
    ///
    /// `org_override` injects `project.org` when the agent-produced spec omits it.
    pub fn transition_to_scaffolding(
        &self,
        adapter_name: &str,
        build_spec_path: &Path,
        pipeline_state: &mut FactoryPipelineState,
        org_override: Option<&str>,
        project_id: Option<String>,
    ) -> Result<PhaseTransitionResult, FactoryError> {
        let adapter = self.adapter_registry.get(adapter_name).ok_or_else(|| {
            FactoryError::AdapterNotFound {
                name: adapter_name.into(),
            }
        })?;

        // Read and parse the Build Spec.
        let build_spec_yaml = std::fs::read_to_string(build_spec_path).map_err(|e| {
            FactoryError::InvalidBuildSpec {
                reason: format!("read {}: {e}", build_spec_path.display()),
            }
        })?;

        let mut build_spec: BuildSpec =
            serde_yaml::from_str(&build_spec_yaml).map_err(|e| FactoryError::InvalidBuildSpec {
                reason: format!("parse: {e}"),
            })?;

        // Inject org if the agent omitted it and the operator supplied one.
        if build_spec.project.org.is_empty()
            && let Some(org) = org_override
        {
            build_spec.project.org = org.to_string();
        }

        // Hash the frozen Build Spec.
        let hash = {
            let mut hasher = Sha256::new();
            hasher.update(build_spec_yaml.as_bytes());
            format!("{:x}", hasher.finalize())
        };

        // Transition pipeline state.
        pipeline_state.transition_to_scaffolding(hash);

        // Generate policy shard (FR-008).
        let policy_bundle = generate_factory_policy_shard(adapter, &build_spec);

        // Generate Phase 2 manifest (FR-003).
        let phase2_manifest = generate_scaffold_manifest(
            &build_spec,
            adapter,
            self.config.factory_root.local_path(),
            project_id,
        )?;

        Ok(PhaseTransitionResult {
            manifest: phase2_manifest,
            policy_bundle,
        })
    }

    /// Run gate checks for a completed stage (FR-010).
    pub async fn run_gate_checks(
        &self,
        stage_id: &str,
    ) -> Result<crate::verify_harness::GateCheckResult, FactoryError> {
        run_factory_gate_check(
            stage_id,
            &self.config.project_path,
            self.config.factory_root.local_path(),
        )
        .await
    }

    /// Start a pipeline that runs `s-1-extract` first against typed bundle
    /// refs (spec 120 FR-010 to FR-015). The extraction stage writes typed
    /// `ExtractionOutput` artifacts to `store`, renders an `s1-context.md`
    /// aggregating them, and the manifest's first stage receives that
    /// rendered file as its sole input.
    ///
    /// The `client` argument provides the yield-back transport. Pass
    /// `None` for environments where `RequiresAgent` should hard-fail
    /// (CLI standalone with no statecraft reachable).
    pub async fn start_pipeline_extracting(
        &self,
        adapter_name: &str,
        bundles: &[KnowledgeBundleRef],
        store: &LocalArtifactStore,
        client: Option<Arc<dyn StatecraftClient>>,
        project_id: Option<String>,
        cancel: CancellationToken,
    ) -> Result<ExtractingPipelineStartResult, FactoryError> {
        let cfg = ExtractionStageConfig::from_env(project_id.clone().unwrap_or_default());
        let report = run_extraction_stage(bundles, store, client, &cfg, cancel).await?;
        let context_md = render_s1_context_md(bundles, &report, store).map_err(|e| {
            FactoryError::ManifestGeneration {
                reason: format!("render s1-context.md: {e}"),
            }
        })?;
        let context_artifact = store
            .store_bytes(context_md.as_bytes(), "s1-context.md")
            .map_err(|e| FactoryError::ManifestGeneration {
                reason: format!("store s1-context.md: {e}"),
            })?;
        let business_doc_paths = vec![PathBuf::from(&context_artifact.storage_path)];
        let mut start = self.start_pipeline(adapter_name, &business_doc_paths, project_id)?;
        start.pipeline_state.record_extraction_summary(&report);
        Ok(ExtractingPipelineStartResult {
            run_id: start.run_id,
            manifest: start.manifest,
            agent_bridge: start.agent_bridge,
            pipeline_state: start.pipeline_state,
            extraction: report,
            s1_context_path: PathBuf::from(context_artifact.storage_path),
        })
    }

    /// Get the engine configuration.
    pub fn config(&self) -> &FactoryEngineConfig {
        &self.config
    }

    /// Establish a signed-handoff session for a run (spec 170).
    ///
    /// Generates the run's root Ed25519 signing key, writes the empty
    /// [`crate::inter_stage_manifest::RunKeyChain`] under
    /// `<run_dir>/keychain.json`, and returns the live
    /// [`StageHandoffSigner`]. The caller drives the session: sign at
    /// every dispatching boundary, verify at every receiving boundary,
    /// and finalize at run completion to compose the chain into the
    /// governance certificate (spec 102 / 170 FR-007).
    pub fn establish_signing_session(
        &self,
        run_id: impl Into<String>,
        run_dir: impl Into<PathBuf>,
    ) -> Result<StageHandoffSigner, FactoryError> {
        Ok(StageHandoffSigner::establish(run_id, run_dir)?)
    }

    /// Convenience: hash a set of stage output files on disk, sign the
    /// hand-off manifest, persist it under `<run_dir>/manifests/`.
    ///
    /// `artifact_paths` is a sequence of `(name, absolute_path)` pairs;
    /// names become the keys in `artifact_hashes`. Missing files
    /// produce a typed [`FactoryError::SignedHandoff`] without panicking.
    pub fn seal_stage_handoff(
        &self,
        signer: &mut StageHandoffSigner,
        from_stage: &str,
        to_stage: &str,
        artifact_paths: &[(String, PathBuf)],
        metadata: std::collections::BTreeMap<String, serde_json::Value>,
    ) -> Result<InterStageManifest, FactoryError> {
        let mut artifact_hashes = std::collections::BTreeMap::new();
        for (name, path) in artifact_paths {
            let contents = std::fs::read(path).map_err(|e| FactoryError::SignedHandoff {
                reason: format!("read {}: {e}", path.display()),
            })?;
            artifact_hashes.insert(
                name.clone(),
                crate::governance_certificate::sha256_bytes(&contents),
            );
        }
        let manifest = signer.sign_handoff(from_stage, to_stage, artifact_hashes, metadata)?;
        Ok(manifest)
    }

    /// Get the adapter registry.
    pub fn adapter_registry(&self) -> &AdapterRegistry {
        &self.adapter_registry
    }

    /// Emit a born-with spec-spine kernel into `target_root` (spec 167).
    ///
    /// Resolves the named adapter from the registry, builds the
    /// [`kernel_emission::AdapterIdentity`] from the manifest, and writes
    /// the kernel + tenant gate wiring + `.kernel-version` marker.
    ///
    /// This is the production entry point for the born-with channel.
    /// Pipeline wiring (when, in the s0–s6 stage list, this fires) is
    /// the responsibility of the caller; the method itself is pure.
    #[allow(clippy::too_many_arguments)] // each parameter is a distinct
    // emission contract input (adapter / target / source / paths /
    // manifest URI / mode / commit). A wrapper struct would add noise
    // without removing the parameters.
    pub fn emit_project_kernel(
        &self,
        adapter_name: &str,
        target_root: &Path,
        oap_repo_root: &Path,
        scaffolded_paths: Vec<String>,
        adapter_manifest_uri: Option<String>,
        toolchain_mode: crate::kernel_emission::ToolchainMode,
        source_commit: String,
    ) -> Result<crate::kernel_emission::KernelEmissionReport, FactoryError> {
        let manifest = self.adapter_registry.get(adapter_name).ok_or_else(|| {
            FactoryError::AdapterNotFound {
                name: adapter_name.into(),
            }
        })?;

        // Hash the adapter manifest payload for `.kernel-version`.
        let manifest_yaml =
            serde_yaml::to_string(&manifest).map_err(|e| FactoryError::InvalidBuildSpec {
                reason: format!("adapter-manifest serialize: {e}"),
            })?;
        let manifest_hash =
            crate::kernel_emission::gather::hash_adapter_manifest(manifest_yaml.as_bytes());

        let adapter_identity = crate::kernel_emission::AdapterIdentity {
            id: manifest.adapter.name.clone(),
            version: manifest.adapter.version.clone(),
            manifest_hash,
        };

        let cfg = crate::kernel_emission::KernelEmissionConfig {
            source: crate::kernel_emission::KernelSource::from_repo_root(
                oap_repo_root.to_path_buf(),
            ),
            target_root: target_root.to_path_buf(),
            adapter: adapter_identity,
            scaffolded_paths,
            adapter_manifest_uri,
            toolchain_mode,
            source_commit,
            emitted_at: None,
            gate_context: None,
        };

        crate::kernel_emission::emit_kernel(&cfg).map_err(|e| FactoryError::InvalidBuildSpec {
            reason: format!("kernel emission failed: {e}"),
        })
    }
}

/// Result of starting a pipeline.
pub struct PipelineStartResult {
    /// Unique run identifier.
    pub run_id: Uuid,
    /// Phase 1 (process) manifest ready for dispatch.
    pub manifest: WorkflowManifest,
    /// Agent bridge for the pipeline.
    pub agent_bridge: FactoryAgentBridge,
    /// Initial pipeline state.
    pub pipeline_state: FactoryPipelineState,
}

/// Result of starting a pipeline that ran `s-1-extract` first
/// (spec 120 FR-010 to FR-015).
pub struct ExtractingPipelineStartResult {
    pub run_id: Uuid,
    pub manifest: WorkflowManifest,
    pub agent_bridge: FactoryAgentBridge,
    pub pipeline_state: FactoryPipelineState,
    pub extraction: ExtractionStageReport,
    /// Path to the rendered `s1-context.md` artifact in the artifact store.
    pub s1_context_path: PathBuf,
}

/// Result of the Phase 1→2 transition (Build Spec freeze → scaffolding).
pub struct PhaseTransitionResult {
    /// Phase 2 (scaffolding) manifest ready for dispatch.
    pub manifest: WorkflowManifest,
    /// Policy bundle generated from the adapter manifest and Build Spec (FR-008).
    /// Callers should apply this to the axiomregent permission runtime.
    pub policy_bundle: PolicyBundle,
}

/// Classify a scaffolding step ID to determine what it produced.
pub fn classify_scaffold_step(step_id: &str) -> ScaffoldStepKind {
    if step_id == "s6b-seed" {
        ScaffoldStepKind::Seed
    } else if step_id.starts_with("s6b-data-") {
        ScaffoldStepKind::Entity(step_id.strip_prefix("s6b-data-").unwrap().into())
    } else if step_id.starts_with("s6c-api-") {
        ScaffoldStepKind::Operation(step_id.strip_prefix("s6c-api-").unwrap().into())
    } else if step_id.starts_with("s6d-ui-") {
        ScaffoldStepKind::Page(step_id.strip_prefix("s6d-ui-").unwrap().into())
    } else if step_id == "s6a-scaffold-init" {
        ScaffoldStepKind::Init
    } else if step_id == "s6e-configure" {
        ScaffoldStepKind::Configure
    } else if step_id == "s6f-trim" {
        ScaffoldStepKind::Trim
    } else if step_id == "s6g-review" {
        ScaffoldStepKind::Review
    } else if step_id == "s6h-final-validation" {
        ScaffoldStepKind::FinalValidation
    } else {
        ScaffoldStepKind::Unknown(step_id.into())
    }
}

/// Classification of scaffold step types.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum ScaffoldStepKind {
    Init,
    Entity(String),
    Seed,
    Operation(String),
    Page(String),
    Configure,
    Trim,
    Review,
    FinalValidation,
    Unknown(String),
}

/// Update pipeline state from a completed scaffolding step.
pub fn record_scaffold_completion(state: &mut FactoryPipelineState, step_id: &str, tokens: u64) {
    state.add_tokens(tokens);
    match classify_scaffold_step(step_id) {
        ScaffoldStepKind::Entity(name) => state.entity_completed(name),
        ScaffoldStepKind::Seed => state.seed_completed(),
        ScaffoldStepKind::Operation(name) => state.operation_completed(name),
        ScaffoldStepKind::Page(name) => state.page_completed(name),
        _ => {}
    }
}

/// Update pipeline state from a failed scaffolding step.
pub fn record_scaffold_failure(
    state: &mut FactoryPipelineState,
    step_id: &str,
    retries: u32,
    error: &str,
) {
    let feature = FailedFeature {
        name: step_id.into(),
        step_id: step_id.into(),
        retries,
        last_error: error.into(),
    };
    match classify_scaffold_step(step_id) {
        ScaffoldStepKind::Entity(_) => state.entity_failed(feature),
        ScaffoldStepKind::Seed => state.seed_failed(feature),
        ScaffoldStepKind::Operation(_) => state.operation_failed(feature),
        ScaffoldStepKind::Page(_) => state.page_failed(feature),
        _ => {}
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn classify_step_ids() {
        assert_eq!(
            classify_scaffold_step("s6b-data-Organization"),
            ScaffoldStepKind::Entity("Organization".into())
        );
        assert_eq!(classify_scaffold_step("s6b-seed"), ScaffoldStepKind::Seed);
        assert_eq!(
            classify_scaffold_step("s6c-api-orgs-list"),
            ScaffoldStepKind::Operation("orgs-list".into())
        );
        assert_eq!(
            classify_scaffold_step("s6d-ui-dashboard"),
            ScaffoldStepKind::Page("dashboard".into())
        );
        assert_eq!(
            classify_scaffold_step("s6a-scaffold-init"),
            ScaffoldStepKind::Init
        );
        assert_eq!(
            classify_scaffold_step("s6g-review"),
            ScaffoldStepKind::Review
        );
        assert_eq!(
            classify_scaffold_step("s6h-final-validation"),
            ScaffoldStepKind::FinalValidation
        );
    }

    #[test]
    fn record_completion_updates_state() {
        let mut state = FactoryPipelineState::new("test", "adapter");
        state.transition_to_scaffolding("hash".into());

        record_scaffold_completion(&mut state, "s6b-data-Org", 1000);
        record_scaffold_completion(&mut state, "s6c-api-orgs-list", 2000);
        record_scaffold_completion(&mut state, "s6d-ui-dashboard", 500);

        assert_eq!(state.total_tokens, 3500);
        let sp = state.scaffolding.as_ref().unwrap();
        assert_eq!(sp.entities_completed, vec!["Org"]);
        assert_eq!(sp.operations_completed, vec!["orgs-list"]);
        assert_eq!(sp.pages_completed, vec!["dashboard"]);
    }

    #[test]
    fn record_failure_updates_state() {
        let mut state = FactoryPipelineState::new("test", "adapter");
        state.transition_to_scaffolding("hash".into());

        record_scaffold_failure(&mut state, "s6b-data-Widget", 3, "compile error");

        let sp = state.scaffolding.as_ref().unwrap();
        assert_eq!(sp.entities_failed.len(), 1);
        assert_eq!(sp.entities_failed[0].retries, 3);
    }
}
