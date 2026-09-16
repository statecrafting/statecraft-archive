// SPDX-License-Identifier: AGPL-3.0-or-later
// Spec 078 item 2.13: Noop end-to-end test — full Factory pipeline with mock dispatch.
//
// Validates:
// - Phase 1 manifest generates correct stages (s0–s5) from a real adapter
// - dispatch_manifest_noop runs Phase 1 when artifacts are pre-populated
// - transition_to_scaffolding produces Phase 2 manifest from a real Build Spec
// - dispatch_manifest_noop runs Phase 2 (s6a–s6g fan-out)
// - Policy bundle is returned (not discarded)
//
// Spec 108 §8 retired the in-tree `factory/` mirror. These tests probe the
// repo-root location so they continue to exercise the engine when a developer
// keeps a local checkout there, but skip cleanly when the directory is
// absent (CI, fresh clones). The proper fixture for these flows lives
// upstream in `legacy-factory` and lands in `factory_adapters` rows
// via the platform sync worker (spec 108 §5); a future spec will let this
// test materialise a fixture from those rows instead of the filesystem.

use factory_engine::{FactoryEngine, FactoryEngineConfig};
use orchestrator::{
    ArtifactManager, StepStatus, dispatch_manifest_noop, materialize_run_directory,
};
use std::path::PathBuf;

/// Resolve the (legacy in-tree) factory root relative to the crate
/// directory. Returns a path that may not exist after spec 108 §8.
fn factory_root() -> PathBuf {
    let crate_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    crate_dir.join("../../factory")
}

/// Resolve a build-spec example path.
fn build_spec_example() -> PathBuf {
    factory_root().join("contract/examples/community-grant-portal.build-spec.yaml")
}

/// Pre-populate all output artifacts for a manifest's steps so dispatch_manifest_noop succeeds.
fn populate_artifacts(
    am: &ArtifactManager,
    run_id: uuid::Uuid,
    manifest: &orchestrator::WorkflowManifest,
) {
    for step in &manifest.steps {
        for output in &step.outputs {
            let path = am.output_artifact_path(run_id, &step.id, output);
            if let Some(parent) = path.parent() {
                std::fs::create_dir_all(parent).unwrap();
            }
            std::fs::write(&path, format!("mock-artifact: {}/{output}", step.id)).unwrap();
        }
    }
}

#[test]
fn noop_e2e_phase1_generates_six_process_stages() {
    let factory_root = factory_root();
    if !factory_root.join("adapters/acme-vue-node").exists() {
        eprintln!(
            "skipping: in-tree factory/adapters/acme-vue-node fixture not present \
             (retired by spec 108 §8; the test runs only when a developer keeps a \
             local checkout)"
        );
        return;
    }

    let config = FactoryEngineConfig {
        factory_root: factory_engine::FactoryRoot::Filesystem(factory_root.clone()),
        project_path: PathBuf::from("."),
        concurrency_limit: 4,
    };

    let engine = FactoryEngine::new(config).expect("engine should initialize");

    // Use the community-grant-portal example business doc path as input.
    let biz_doc = build_spec_example();
    let result = engine
        .start_pipeline("acme-vue-node", &[biz_doc], None)
        .expect("start_pipeline should succeed");

    // Phase 1 manifest has 6 stages (s0–s5).
    assert_eq!(
        result.manifest.steps.len(),
        6,
        "Phase 1 should have 6 stages"
    );
    assert_eq!(result.manifest.steps[0].id, "s0-preflight");
    assert_eq!(result.manifest.steps[5].id, "s5-ui-specification");

    // Validate DAG ordering.
    let order = result
        .manifest
        .validate_and_order()
        .expect("Phase 1 manifest should validate");
    assert_eq!(
        order,
        vec![0, 1, 2, 3, 4, 5],
        "Phase 1 stages should be linear"
    );

    // Agent bridge should have registered agents from the factory directory.
    assert!(
        !result.agent_bridge.is_empty(),
        "agent bridge should have registered agents"
    );
}

#[test]
fn noop_e2e_full_pipeline_dispatch() {
    let factory_root = factory_root();
    if !factory_root.join("adapters/acme-vue-node").exists() {
        eprintln!(
            "skipping: in-tree factory/adapters/acme-vue-node fixture not present \
             (retired by spec 108 §8; the test runs only when a developer keeps a \
             local checkout)"
        );
        return;
    }

    let tmp = tempfile::tempdir().unwrap();
    let am = ArtifactManager::new(tmp.path());

    let config = FactoryEngineConfig {
        factory_root: factory_engine::FactoryRoot::Filesystem(factory_root.clone()),
        project_path: PathBuf::from("."),
        concurrency_limit: 4,
    };

    let engine = FactoryEngine::new(config).expect("engine should initialize");

    // ── Phase 1: Process stages ──────────────────────────────────────────
    let biz_doc = build_spec_example();
    let start = engine
        .start_pipeline("acme-vue-node", &[biz_doc], None)
        .expect("start_pipeline should succeed");

    let run_id = start.run_id;
    materialize_run_directory(&am, run_id, &start.manifest).unwrap();

    // Pre-populate all Phase 1 artifacts.
    populate_artifacts(&am, run_id, &start.manifest);

    // Noop dispatch Phase 1.
    let summary1 = dispatch_manifest_noop(&am, run_id, &start.manifest)
        .expect("Phase 1 noop dispatch should succeed");

    assert_eq!(summary1.steps.len(), 6);
    for step in &summary1.steps {
        assert!(
            matches!(step.status, StepStatus::Success),
            "Phase 1 step {} should be Success, got {:?}",
            step.step_id,
            step.status
        );
    }

    // ── Phase transition ─────────────────────────────────────────────────
    // Write a real build spec as the s5 output artifact (simulating the frozen Build Spec).
    let build_spec_artifact =
        am.output_artifact_path(run_id, "s5-ui-specification", "build-spec.yaml");
    let real_build_spec = std::fs::read_to_string(build_spec_example()).unwrap();
    std::fs::write(&build_spec_artifact, &real_build_spec).unwrap();

    let mut pipeline_state = start.pipeline_state;
    let transition = engine
        .transition_to_scaffolding(
            "acme-vue-node",
            &build_spec_artifact,
            &mut pipeline_state,
            None,
            None,
        )
        .expect("transition_to_scaffolding should succeed");

    // Policy bundle should contain adapter-scoped rules.
    assert!(
        !transition.policy_bundle.shards.is_empty(),
        "policy bundle should have at least one shard"
    );
    assert!(
        transition
            .policy_bundle
            .shards
            .contains_key("factory:acme-vue-node"),
        "policy bundle should have adapter-scoped shard"
    );

    // Phase 2 manifest should have many steps (entities + operations + pages + 4 fixed).
    let phase2 = &transition.manifest;
    assert!(
        phase2.steps.len() > 10,
        "Phase 2 should have >10 scaffold steps, got {}",
        phase2.steps.len()
    );

    // Verify s6a is first and s6h is last.
    assert_eq!(phase2.steps[0].id, "s6a-scaffold-init");
    assert_eq!(phase2.steps.last().unwrap().id, "s6h-final-validation");

    // Validate DAG ordering.
    let order2 = phase2
        .validate_and_order()
        .expect("Phase 2 manifest should validate");
    assert!(!order2.is_empty());

    // ── Phase 2: Scaffold noop dispatch ──────────────────────────────────
    // Pre-populate all Phase 2 artifacts.
    populate_artifacts(&am, run_id, phase2);

    let summary2 =
        dispatch_manifest_noop(&am, run_id, phase2).expect("Phase 2 noop dispatch should succeed");

    assert_eq!(summary2.steps.len(), phase2.steps.len());
    for step in &summary2.steps {
        assert!(
            matches!(step.status, StepStatus::Success),
            "Phase 2 step {} should be Success, got {:?}",
            step.step_id,
            step.status
        );
    }

    // Pipeline state should reflect scaffolding phase.
    assert!(
        pipeline_state.scaffolding.is_some(),
        "pipeline state should be in scaffolding phase"
    );

    eprintln!(
        "Full pipeline noop e2e: Phase 1 = {} stages, Phase 2 = {} scaffold steps, policy rules = {}",
        summary1.steps.len(),
        summary2.steps.len(),
        transition
            .policy_bundle
            .shards
            .values()
            .map(|r| r.len())
            .sum::<usize>()
    );
}
