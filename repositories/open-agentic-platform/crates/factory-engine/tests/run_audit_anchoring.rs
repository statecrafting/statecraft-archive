// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Bartek Kus

//! Spec 207 AC-3 end-to-end: a factory run's hash-chained audit segment,
//! anchored into the governance certificate as a stage, is tamper-evident
//! under `verify_certificate`. This exercises the real
//! `write_run_audit_segment` + `generate_certificate_with_stage_ids` seam
//! that `factory-run`'s `emit_certificate` uses, then confirms the existing
//! artifact-hash check fails after the segment is altered on disk.

use factory_contracts::pipeline_state::{AuditEntry, AuditEvent};
use factory_engine::FactoryPipelineState;
use factory_engine::governance_certificate::{
    OAP_STAGE_IDS, generate_certificate_with_stage_ids, verify_certificate,
};
use factory_engine::run_audit_chain::{self, RUN_AUDIT_SEGMENT, RUN_AUDIT_STAGE_ID};

fn entry(stage: &str) -> AuditEntry {
    AuditEntry {
        timestamp: chrono::Utc::now(),
        event: AuditEvent::StageConfirmed,
        stage: Some(stage.into()),
        details: None,
    }
}

fn build_anchored_cert(
    run_dir: &std::path::Path,
) -> factory_engine::governance_certificate::GovernanceCertificate {
    let state = FactoryPipelineState::new("run-ac3", "aim-vue-encore");
    let mut stage_ids: Vec<&str> = OAP_STAGE_IDS.to_vec();
    stage_ids.push(RUN_AUDIT_STAGE_ID);
    generate_certificate_with_stage_ids(&state, "req-hash-ac3", run_dir, None, &stage_ids)
}

#[test]
fn run_audit_segment_anchored_and_tamper_evident() {
    let tmp = tempfile::tempdir().unwrap();
    let run_dir = tmp.path();

    run_audit_chain::write_run_audit_segment(
        run_dir,
        "run-ac3",
        &[entry("phase-1"), entry("transition"), entry("phase-2")],
    )
    .unwrap();

    let cert = build_anchored_cert(run_dir);

    // The segment is in the certificate's artifact list as the run-audit stage.
    let anchored = cert
        .stages
        .iter()
        .find(|s| s.stage_id == RUN_AUDIT_STAGE_ID)
        .expect("run-audit stage present in certificate");
    assert!(
        anchored.artifact_hashes.contains_key(RUN_AUDIT_SEGMENT),
        "segment file hash bound into the certificate"
    );

    // Clean: signature + self-hash + artifact hashes all verify.
    let clean = verify_certificate(&cert, Some(run_dir));
    assert!(clean.valid, "clean cert verifies: {:?}", clean.errors);

    // Tamper the segment on disk: verify_certificate must fail (AC-3).
    let seg = run_dir.join(RUN_AUDIT_STAGE_ID).join(RUN_AUDIT_SEGMENT);
    let mut content = std::fs::read_to_string(&seg).unwrap();
    content.push_str("{\"event\":\"StageConfirmed\",\"injected\":true}\n");
    std::fs::write(&seg, content).unwrap();

    let tampered = verify_certificate(&cert, Some(run_dir));
    assert!(
        !tampered.valid,
        "tampered run-audit segment must fail verify_certificate"
    );
    assert!(
        tampered
            .errors
            .iter()
            .any(|e| e.contains(RUN_AUDIT_SEGMENT)),
        "diagnostic names the tampered segment: {:?}",
        tampered.errors
    );
}
