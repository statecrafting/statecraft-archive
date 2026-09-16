// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Bartek Kus
// Spec: specs/122-stakeholder-doc-inversion/spec.md (SC-001..SC-012)

//! End-to-end test for spec 122. Drives the synthetic Globex fixture
//! through the full Stage CD orchestrator, exercising:
//!
//!   * SC-001: scope-flip pairing via Jaccard >= 0.6 + classification
//!     `scope` + gate FAIL.
//!   * SC-004: reclassification migration on a pre-spec-122 project
//!     shape (legacy `requirements/client/`).
//!
//! The remaining SC-002..SC-012 are pinned by per-module unit tests
//! and cross-referenced from `spec-122-coverage.md` alongside this
//! file. Each one MUST have at least one passing test.

use chrono::TimeZone;
use chrono::{DateTime, Utc};
use factory_engine::migration::stakeholder_docs::{
    migrate_stakeholder_docs, MigrateOptions, MigrationOutcome,
};
use factory_engine::stages::stage_cd::{
    run_stage_cd, StageCdInputs, StageCdMode,
};
use factory_engine::stages::stage_cd_gate::{
    evaluate_qg_cd_01, ApprovalLedger, GateConfig, GateDecision,
};
use std::fs;
use std::path::{Path, PathBuf};

fn fixed_now() -> DateTime<Utc> {
    Utc.with_ymd_and_hms(2026, 4, 30, 12, 0, 0).unwrap()
}

fn fixture_root() -> PathBuf {
    let crate_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    crate_dir.join("tests/fixtures/payment-scope-stage-cd")
}

/// Copy a directory tree recursively into `dst`. The fixture is
/// read-only; tests work on a copy.
fn copy_tree(src: &Path, dst: &Path) {
    if src.is_file() {
        fs::create_dir_all(dst.parent().unwrap()).unwrap();
        fs::copy(src, dst).unwrap();
        return;
    }
    fs::create_dir_all(dst).unwrap();
    for entry in fs::read_dir(src).unwrap() {
        let entry = entry.unwrap();
        let from = entry.path();
        let to = dst.join(from.file_name().unwrap());
        if from.is_dir() {
            copy_tree(&from, &to);
        } else {
            fs::copy(&from, &to).unwrap();
        }
    }
}

/// SC-001: replicates the example forensic in a pinned synthetic
/// fixture. Runs Stage CD against the authored doc + supplies the
/// pre-built candidate the fixture ships, then asserts:
///
///   1. The comparator pairs the authored `OUT-SCOPE-3` to the
///      candidate `IN-SCOPE-7` via Jaccard similarity (>= 0.6 over the
///      canonical token bag).
///   2. The diff is classified `scope` because the anchor kind
///      changed (`OUT-SCOPE` to `IN-SCOPE`).
///   3. `QG-CD-01_StakeholderDocAlignment` returns FAIL with one
///      blocking diff for the `OUT-SCOPE-3` to `IN-SCOPE-7` pair.
///   4. The pipeline does NOT advance.
///   5. The authored `charter.md` bytes are unchanged after the run.
#[test]
fn sc_001_scope_flip_blocks_gate() {
    let dir = tempfile::tempdir().unwrap();
    copy_tree(&fixture_root(), dir.path());

    // Capture authored bytes BEFORE Stage CD runs; the test asserts
    // they're byte-identical AFTER the run.
    let authored_charter =
        dir.path().join("requirements/stakeholder/charter.md");
    let before = fs::read(&authored_charter).unwrap();

    // The fixture ships a candidate already; run_stage_cd's Phase 1
    // would overwrite it with a deterministic-from-BRD generation. To
    // keep the fixture authoritative, supply a BRD that produces an
    // empty candidate and rely on the fixture's existing candidate
    // being read by the comparator. The simplest path is to invoke
    // the comparator directly with the fixture paths.
    use factory_engine::stages::stage_cd_comparator::{
        run as run_comparator, ComparatorInputs, ComparatorMode,
    };
    let diff = run_comparator(&ComparatorInputs {
        project: dir.path().to_path_buf(),
        artifact_store: dir.path().join("runs/run-001"),
        candidate_charter: dir.path().join(
            "runs/run-001/stage-cd/charter.candidate.md",
        ),
        candidate_client_document: dir.path().join(
            "runs/run-001/stage-cd/client-document.candidate.md",
        ),
        authored_charter: authored_charter.clone(),
        authored_client_document: dir
            .path()
            .join("requirements/stakeholder/client-document.md"),
        mode: ComparatorMode::Standard,
        now: fixed_now(),
        corpus: vec![],
        project_name: "example".into(),
        project_slug: "example".into(),
        workspace_name: "ws".into(),
        known_owners: vec![],
    })
    .expect("comparator should succeed against fixture");

    // (1) + (2): scope diff exists, paired by Jaccard.
    let scope = diff
        .findings
        .iter()
        .find(|f| f.class == "scope")
        .expect("synthetic fixture must surface a scope diff");
    assert_eq!(
        scope.pairing, "jaccard",
        "OUT-SCOPE-3 ↔ IN-SCOPE-7 must pair via Jaccard, not exact-anchor: {scope:?}"
    );
    assert_eq!(scope.doc, "charter.md");
    // The authored anchor is OUT-SCOPE-3; that's the side the gate
    // surfaces because pairing keys on the authored anchor.
    assert_eq!(scope.anchor, "OUT-SCOPE-3");

    // (3): gate FAIL with one blocking diff.
    let gate = evaluate_qg_cd_01(
        &diff,
        &GateConfig::default(),
        &ApprovalLedger::default(),
        "example",
        fixed_now(),
    );
    assert_eq!(
        gate.decision,
        GateDecision::Fail,
        "synthetic scope flip must FAIL the gate"
    );
    assert!(
        gate.blocking
            .iter()
            .any(|b| b.class == "scope" && b.anchor == "OUT-SCOPE-3"),
        "blocking diff must include the OUT-SCOPE-3 scope flip: {:?}",
        gate.blocking
    );

    // (5): authored doc bytes unchanged after the run. SC-008 also
    // pins this, but the e2e fixture replays it under realistic
    // conditions.
    let after = fs::read(&authored_charter).unwrap();
    assert_eq!(
        before, after,
        "FR-017 violation: comparator mutated the authored charter"
    );
}

/// SC-001 cont.: verify that `run_stage_cd` driven end-to-end
/// (Phase 1 candidate generation + Phase 2 comparator) surfaces a
/// scope-class blocker when the BRD encodes a scope flip, regardless
/// of the specific pairing path taken. The deterministic Phase 1
/// generator produces a candidate that, paired against the
/// fixture's authored doc, classifies into `scope` either via the
/// anchor-kind-change rule (FR-019 first clause) OR the body
/// scope-flip phrase regex (FR-019 second clause). Both clauses are
/// gate-blocking; this test pins that whichever clause fires, the
/// gate evaluates FAIL.
///
/// The test does NOT lock the specific pairing path; that's what
/// the unit tests (`scope_when_anchor_kind_changes` for kind change,
/// `scope_class_fires_on_body_scope_flip_phrase` for the body
/// regex) do. This e2e test's job is to prove run_stage_cd to
/// comparator to gate is honest under realistic generator output.
#[tokio::test]
async fn sc_001_drives_through_run_stage_cd_with_synthetic_brd() {
    let dir = tempfile::tempdir().unwrap();
    copy_tree(&fixture_root(), dir.path());

    // Synthetic BRD whose `Now in scope.` body triggers the
    // scope-flip phrase regex when paired against an authored body
    // that doesn't contain the phrase.
    let brd = "# BRD\n\n### In Scope: Payment processing finance Globex integration\n\nNow in scope.\n";

    let result = run_stage_cd(&StageCdInputs {
        project: dir.path().to_path_buf(),
        run_id: "run-001".into(),
        artifact_store: dir.path().join("runs/run-001"),
        brd: brd.to_string(),
        now: fixed_now(),
        corpus: vec![],
        project_name: "example".into(),
        project_slug: "example".into(),
        workspace_name: "ws".into(),
        known_owners: vec![],
        agent_resolver: None,
        comparator_agent_ref: None,
    })
    .await
    .expect("stage CD should succeed");
    assert_eq!(result.mode, StageCdMode::Compare);
    let diff_path = result.diff_path.expect("compare-mode produces a diff");
    let raw = fs::read_to_string(&diff_path).unwrap();
    let diff: serde_json::Value = serde_json::from_str(&raw).unwrap();
    let scope_count = diff["counts"]["scope"].as_u64().unwrap_or(0);
    assert!(
        scope_count >= 1,
        "synthetic BRD with `In Scope: ... Globex integration` + `Now in scope` body must produce >=1 scope diff: {raw}"
    );
    // Drive through gate evaluation too; SC-001 says the pipeline
    // is blocked, not just that a diff is recorded.
    let parsed_diff: factory_engine::stages::stage_cd_comparator::StageCdDiff =
        serde_json::from_str(&raw).unwrap();
    let gate = evaluate_qg_cd_01(
        &parsed_diff,
        &GateConfig::default(),
        &ApprovalLedger::default(),
        "example",
        fixed_now(),
    );
    assert_eq!(
        gate.decision,
        GateDecision::Fail,
        "scope-bearing diff must FAIL the gate"
    );
}

/// SC-004: reclassification migration on a synthetic legacy project
/// (files under `requirements/client/`). Asserts:
///
///   1. Files move to `requirements/stakeholder/`.
///   2. Anchors are inserted with inline `anchorHash` comments
///      (FR-029).
///   3. Frontmatter carries `migrated: true`, `migratedFrom`.
///   4. Migration report at `requirements/audit/stakeholder-doc-
///      migration.md` lists every section AND flags `Globex` as an
///      external-entity finding.
///   5. Re-running migration on the result returns `AlreadyMigrated`.
#[test]
fn sc_004_reclassification_migration_on_synthetic_shape() {
    let dir = tempfile::tempdir().unwrap();
    let legacy_dir = dir.path().join("requirements/client");
    fs::create_dir_all(&legacy_dir).unwrap();
    fs::write(
        legacy_dir.join("charter.md"),
        r#"# Charter

### Objectives

Reduce form-correction cycles.

### Out of Scope

Payment processing.
"#,
    )
    .unwrap();
    fs::write(
        legacy_dir.join("client-document.md"),
        r#"# Client Document

### Globex Integration

The system must integrate with Globex for payments.
"#,
    )
    .unwrap();

    let opts = MigrateOptions {
        project: dir.path().to_path_buf(),
        keep_legacy: false,
        corpus: vec![],
        project_name: "example".into(),
        project_slug: "example".into(),
        workspace_name: "ws".into(),
        now: fixed_now(),
    };
    let outcome = migrate_stakeholder_docs(&opts).unwrap();
    let report_path = match outcome {
        MigrationOutcome::Migrated { report_path, .. } => report_path,
        other => panic!("expected Migrated, got {other:?}"),
    };

    // (1) files moved
    assert!(!legacy_dir.join("charter.md").exists());
    assert!(dir
        .path()
        .join("requirements/stakeholder/charter.md")
        .is_file());
    assert!(dir
        .path()
        .join("requirements/stakeholder/client-document.md")
        .is_file());

    // (2) anchorHash inline + (3) migrated frontmatter
    let charter = fs::read_to_string(
        dir.path().join("requirements/stakeholder/charter.md"),
    )
    .unwrap();
    assert!(charter.contains("<!-- anchorHash: sha256:"));
    assert!(charter.contains("migrated: true"));
    assert!(charter.contains("migratedFrom:"));

    // (4) report lists Globex
    let report = fs::read_to_string(&report_path).unwrap();
    assert!(report.contains("# Stakeholder Doc Migration"));
    assert!(
        report.contains("Globex"),
        "migration report must flag Globex as external entity: {report}"
    );

    // (5) idempotency: re-run is no-op
    let again = migrate_stakeholder_docs(&opts).unwrap();
    assert!(matches!(again, MigrationOutcome::AlreadyMigrated { .. }));
}
