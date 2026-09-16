// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Bartek Kus
// Spec: specs/165-opc-decomposition-pipeline/spec.md — FR-009 / SC-006
//
// SC-006: the governance certificate emitted per run verifies via the same
// path `make verify-certificate` uses — factory_engine::verify_certificate.
// We run the pipeline, load the persisted certificate, and verify it against
// the run directory (the artifact dir), asserting no errors. We also assert
// tamper-detection: mutating a stage artifact makes verification fail.

use std::fs;

use factory_engine::governance_certificate::{GovernanceCertificate, verify_certificate};
use opc_decomposition_pipeline::{PipelineConfig, PipelineRunner};

fn fixture_project(root: &std::path::Path) {
    let crates_a = root.join("crates").join("alpha");
    let tools = root.join("tools");
    fs::create_dir_all(&crates_a).unwrap();
    fs::create_dir_all(&tools).unwrap();
    fs::write(crates_a.join("lib.rs"), "fn alpha() { helper(); }\nfn helper() {}\n").unwrap();
    fs::write(tools.join("main.rs"), "fn main() {}\n").unwrap();
}

fn run_and_load(
) -> (tempfile::TempDir, std::path::PathBuf, GovernanceCertificate) {
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
    let run_root = output_root.join(run.run_id.as_str());
    let cert_path = run_root.join("governance-certificate.json");
    assert!(cert_path.is_file(), "certificate not emitted at {cert_path:?}");
    let cert: GovernanceCertificate =
        serde_json::from_slice(&fs::read(&cert_path).unwrap()).unwrap();
    (project, run_root, cert)
}

#[test]
fn emitted_certificate_verifies_against_run_artifacts() {
    let (_project, run_root, cert) = run_and_load();

    // Binds the governing spec and the synthesiser config.
    assert_eq!(cert.intent.spec_id.as_deref(), Some("165-opc-decomposition-pipeline"));
    assert!(!cert.build_spec.hash.is_empty(), "build_spec_hash should bind the synthesiser");
    // All six stages are present.
    assert_eq!(cert.stages.len(), 6);

    let result = verify_certificate(&cert, Some(&run_root));
    assert!(result.valid, "certificate should verify; errors: {:?}", result.errors);
}

#[test]
fn tampering_with_a_stage_artifact_fails_verification() {
    let (_project, run_root, cert) = run_and_load();

    // Mutate a bound artifact (the xray fingerprint) after certification.
    let fp = run_root.join("s2-fingerprint").join("fingerprint.json");
    assert!(fp.is_file());
    fs::write(&fp, b"{\"tampered\":true}").unwrap();

    let result = verify_certificate(&cert, Some(&run_root));
    assert!(!result.valid, "tampered artifact must fail verification");
    assert!(
        result.errors.iter().any(|e| e.contains("s2-fingerprint")),
        "expected a fingerprint artifact mismatch; got {:?}",
        result.errors
    );
}
