// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Bartek Kus
// Spec: specs/165-opc-decomposition-pipeline/spec.md
//
// End-to-end integration test for the decomposition pipeline.
// Asserts the success criteria SC-001 (≥1 draft spec emitted),
// SC-003 (`role: decomposition-origin` present), the FR-010 degraded
// behaviour (no knowledge bundle, no git, no embeddings), and the
// run-listing helper used by the Tauri command surface.

use std::fs;

use opc_decomposition_pipeline::{
    DegradedReason, PipelineConfig, PipelineRunner, StageId, StageStatus, list_runs, load_run,
};

fn fixture_project(root: &std::path::Path) {
    let crates_a = root.join("crates").join("alpha");
    let crates_b = root.join("crates").join("beta");
    let tools = root.join("tools");
    let docs = root.join("docs");
    fs::create_dir_all(&crates_a).unwrap();
    fs::create_dir_all(&crates_b).unwrap();
    fs::create_dir_all(&tools).unwrap();
    fs::create_dir_all(&docs).unwrap();

    fs::write(
        crates_a.join("Cargo.toml"),
        "[package]\nname = \"alpha\"\nversion = \"0.1.0\"\nedition = \"2024\"\n",
    )
    .unwrap();
    fs::write(crates_a.join("lib.rs"), "fn alpha_one() { alpha_two(); }\nfn alpha_two() {}\n")
        .unwrap();
    fs::write(crates_b.join("Cargo.toml"), "[package]\nname = \"beta\"\nversion = \"0.1.0\"\nedition = \"2024\"\n").unwrap();
    fs::write(crates_b.join("lib.rs"), "fn beta() {}\n").unwrap();
    fs::write(tools.join("main.rs"), "fn main() {}\n").unwrap();
    fs::write(docs.join("README.md"), "# fixture project").unwrap();
}

#[test]
fn full_pipeline_emits_drafts_and_records_manifest() {
    let project = tempfile::tempdir().unwrap();
    fixture_project(project.path());

    let output_root = project.path().join(".opc").join("decomposition");
    let cfg = PipelineConfig {
        project_root: project.path().to_path_buf(),
        knowledge_bundle: None,
        output_root: output_root.clone(),
        embeddings_enabled: false,
    };
    let run = PipelineRunner::new(cfg).run().unwrap();

    // 6 stage records persisted.
    assert_eq!(run.stages.len(), 6);

    // Stage IDs in the right order.
    let ids: Vec<StageId> = run.stages.iter().map(|s| s.id).collect();
    assert_eq!(
        ids,
        vec![
            StageId::Extraction,
            StageId::Fingerprint,
            StageId::Clustering,
            StageId::CallGraph,
            StageId::Lineage,
            StageId::Synthesis,
        ]
    );

    // FR-010 degraded markers: no bundle, no git, no embeddings.
    let extraction = &run.stages[0];
    assert_eq!(extraction.status, StageStatus::Degraded);
    assert_eq!(extraction.degraded, Some(DegradedReason::NoKnowledgeBundle));

    let lineage = &run.stages[4];
    assert_eq!(lineage.status, StageStatus::Degraded);
    assert_eq!(lineage.degraded, Some(DegradedReason::NoGitHistory));

    let clustering = &run.stages[2];
    assert_eq!(clustering.status, StageStatus::Degraded);
    assert_eq!(clustering.degraded, Some(DegradedReason::NoEmbeddingsBackend));

    // SC-001: ≥ 1 draft spec emitted.
    assert!(!run.emitted_specs.is_empty());

    // SC-003: emitted spec carries role: decomposition-origin.
    let run_dir = output_root.join(run.run_id.as_str());
    let first = run_dir
        .join("s6-synthesis")
        .join(&run.emitted_specs[0].relpath);
    let body = fs::read_to_string(&first).expect("emitted spec readable");
    assert!(body.contains("role: decomposition-origin"));
    assert!(body.contains("kind: code-fingerprint"));
    assert!(body.contains("kind: capability"));
    assert!(body.contains("retroactive: true"));
    assert!(body.contains("establishes:"));
    assert!(body.contains("- unit: { kind: file, path:"));

    // Manifest round-trips through the listing helper used by Tauri.
    let runs = list_runs(&output_root).unwrap();
    assert_eq!(runs.len(), 1);
    assert_eq!(runs[0].run_id, run.run_id);

    // load_run resolves by id.
    let direct = load_run(&output_root, &run.run_id).unwrap();
    assert!(direct.is_some());
}

#[test]
fn second_run_over_unchanged_tree_caches_deterministic_stages() {
    // SC-004 / FR-007: re-running against an unchanged working tree reuses
    // stages 1-5 (status: Cached) and only re-runs stage 6 (synthesis).
    let project = tempfile::tempdir().unwrap();
    fixture_project(project.path());
    let output_root = project.path().join(".opc").join("decomposition");

    let cfg = || PipelineConfig {
        project_root: project.path().to_path_buf(),
        knowledge_bundle: None,
        output_root: output_root.clone(),
        embeddings_enabled: false,
    };

    let run1 = PipelineRunner::new(cfg()).run().unwrap();
    // First run computes everything; nothing is cached.
    for s in &run1.stages {
        assert_ne!(s.status, StageStatus::Cached, "stage {:?} unexpectedly cached on first run", s.id);
    }

    let run2 = PipelineRunner::new(cfg()).run().unwrap();
    assert_ne!(run2.run_id, run1.run_id, "second run must get a distinct run id");

    // Stages 1-5 (extraction..lineage) reuse the prior run's output.
    for s in &run2.stages[..5] {
        assert_eq!(s.status, StageStatus::Cached, "stage {:?} should be cached on unchanged re-run", s.id);
    }
    // Cached stages preserve the prior run's content hash.
    for i in 0..5 {
        assert_eq!(
            run2.stages[i].content_hash, run1.stages[i].content_hash,
            "cached stage {:?} content hash drifted", run2.stages[i].id
        );
    }
    // Stage 6 (synthesis) always re-runs — it is the synthesis trajectory.
    assert_eq!(run2.stages[5].id, StageId::Synthesis);
    assert_ne!(run2.stages[5].status, StageStatus::Cached, "synthesis must re-run");
    // It still emits drafts.
    assert!(!run2.emitted_specs.is_empty());
}

#[test]
fn runs_over_same_evidence_share_anchor_distinct_trajectories() {
    // §2.2 branch-of-thought: two synthesis runs over the same evidence base
    // fork from one shared anchor as distinct trajectories.
    let project = tempfile::tempdir().unwrap();
    fixture_project(project.path());
    let output_root = project.path().join(".opc").join("decomposition");
    let cfg = || PipelineConfig {
        project_root: project.path().to_path_buf(),
        knowledge_bundle: None,
        output_root: output_root.clone(),
        embeddings_enabled: false,
    };
    let r1 = PipelineRunner::new(cfg()).run().unwrap();
    let r2 = PipelineRunner::new(cfg()).run().unwrap();

    assert!(!r1.checkpoint_anchor_id.is_empty(), "run should record an anchor");
    assert!(!r1.checkpoint_trajectory_id.is_empty(), "run should record a trajectory");
    assert_eq!(
        r1.checkpoint_anchor_id, r2.checkpoint_anchor_id,
        "same evidence base must reuse the anchor"
    );
    assert_ne!(
        r1.checkpoint_trajectory_id, r2.checkpoint_trajectory_id,
        "distinct runs must be distinct trajectories"
    );
}

#[test]
fn tree_change_invalidates_the_cache() {
    // FR-007 guard: a changed working tree must NOT reuse cached stages.
    let project = tempfile::tempdir().unwrap();
    fixture_project(project.path());
    let output_root = project.path().join(".opc").join("decomposition");
    let cfg = || PipelineConfig {
        project_root: project.path().to_path_buf(),
        knowledge_bundle: None,
        output_root: output_root.clone(),
        embeddings_enabled: false,
    };

    let _run1 = PipelineRunner::new(cfg()).run().unwrap();

    // Mutate a source file in the project tree.
    fs::write(
        project.path().join("crates").join("alpha").join("lib.rs"),
        "fn alpha_one() { alpha_two(); }\nfn alpha_two() { alpha_one(); }\nfn alpha_three() {}\n",
    )
    .unwrap();

    let run2 = PipelineRunner::new(cfg()).run().unwrap();
    // Fingerprint (stage 2) depends on the tree; it must NOT be cached.
    let fp = &run2.stages[1];
    assert_eq!(fp.id, StageId::Fingerprint);
    assert_ne!(fp.status, StageStatus::Cached, "fingerprint must recompute after a tree change");
}

#[test]
fn knowledge_bundle_drives_extraction_stage_to_complete() {
    let project = tempfile::tempdir().unwrap();
    fixture_project(project.path());
    let bundle = tempfile::tempdir().unwrap();
    fs::write(bundle.path().join("notes.md"), "# Notes\n\nbody.").unwrap();
    fs::write(bundle.path().join("data.json"), r#"{"x":1}"#).unwrap();

    let output_root = project.path().join(".opc").join("decomposition");
    let cfg = PipelineConfig {
        project_root: project.path().to_path_buf(),
        knowledge_bundle: Some(bundle.path().to_path_buf()),
        output_root: output_root.clone(),
        embeddings_enabled: false,
    };
    let run = PipelineRunner::new(cfg).run().unwrap();
    let extraction = &run.stages[0];
    assert_eq!(extraction.status, StageStatus::Complete);
}
