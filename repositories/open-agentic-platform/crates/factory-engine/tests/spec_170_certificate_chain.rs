// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Bartek Kus
// Spec: specs/170-signed-inter-stage-manifests/spec.md
//
// SC-001 through SC-005 end-to-end coverage at the certificate boundary
// and the `verify-certificate` CLI boundary.

use factory_engine::governance_certificate::{
    CertificateBuilder, IntentRecord, persist_certificate,
};
use factory_engine::inter_stage_manifest::StageHandoffSigner;
use factory_engine::{InterStageChainRecord, verify_certificate};
use std::collections::BTreeMap;
use std::path::PathBuf;
use tempfile::TempDir;

/// Build a sealed certificate that embeds a full s0→s1→s2 inter-stage
/// chain. Returns the temp dir (kept alive) and the cert path.
fn build_sealed_cert_with_chain(run_id: &str) -> (TempDir, PathBuf) {
    let tmp = TempDir::new().unwrap();
    let run_dir = tmp.path().join("run");
    std::fs::create_dir_all(&run_dir).unwrap();

    let mut signer = StageHandoffSigner::establish(run_id, &run_dir).unwrap();
    let mut manifests = Vec::new();
    for (from, to) in [("s0", "s1"), ("s1", "s2"), ("s2", "s3")] {
        let mut hashes = BTreeMap::new();
        hashes.insert(
            format!("{from}-out.json"),
            factory_engine::governance_certificate::sha256_bytes(from.as_bytes()),
        );
        let m = signer
            .sign_handoff(from, to, hashes, BTreeMap::new())
            .unwrap();
        manifests.push(m);
    }
    let chain_record = InterStageChainRecord {
        key_chain: signer.finalize(),
        manifests,
    };

    let cert = CertificateBuilder::new(
        run_id,
        IntentRecord {
            requirements_hash: "req".into(),
            spec_id: None,
            spec_hash: None,
        },
    )
    .build_spec_hash("bs")
    .inter_stage_chain(chain_record)
    .build();

    let cert_dir = tmp.path().join("cert");
    persist_certificate(&cert, &cert_dir).unwrap();
    let cert_path = cert_dir.join("governance-certificate.json");
    (tmp, cert_path)
}

/// SC-001: a normal pipeline run produces a chain that validates at
/// every link AND at certificate-verify time.
#[test]
fn sc_001_normal_run_chain_validates_at_cert_verify() {
    let (_keep, cert_path) = build_sealed_cert_with_chain("run-sc001");
    let json = std::fs::read_to_string(&cert_path).unwrap();
    let cert: factory_engine::GovernanceCertificate = serde_json::from_str(&json).unwrap();
    let result = verify_certificate(&cert, None);
    assert!(
        result.valid,
        "normal cert with chain should verify; errors: {:?}",
        result.errors
    );
}

/// SC-002: an adversarial mutation of an artifact_hash inside a
/// manifest causes verify-certificate to surface the manifest-level
/// signature failure.
#[test]
fn sc_002_tampered_artifact_hash_breaks_cert_verify() {
    let (_keep, cert_path) = build_sealed_cert_with_chain("run-sc002");
    let json = std::fs::read_to_string(&cert_path).unwrap();
    let mut cert: factory_engine::GovernanceCertificate = serde_json::from_str(&json).unwrap();
    {
        let chain = cert.inter_stage_chain.as_mut().unwrap();
        chain.manifests[0]
            .artifact_hashes
            .insert("s0-out.json".into(), "TAMPERED".into());
    }
    let result = verify_certificate(&cert, None);
    assert!(!result.valid);
    assert!(
        result
            .errors
            .iter()
            .any(|e| e.contains("inter-stage manifest s0→s1")),
        "expected manifest-level diagnostic; errors: {:?}",
        result.errors
    );
}

/// SC-003: a manifest swapped from run-A into run-B's certificate is
/// rejected because the chain's run_id no longer matches the
/// certificate's pipeline_run_id (the chain is run-A's, the cert is
/// run-B's).
#[test]
fn sc_003_cross_run_swap_rejected_by_cert_verify() {
    let (_keep_a, cert_path_a) = build_sealed_cert_with_chain("run-sc003a");
    let json_a = std::fs::read_to_string(&cert_path_a).unwrap();
    let cert_a: factory_engine::GovernanceCertificate = serde_json::from_str(&json_a).unwrap();

    // Build run-B's cert WITHOUT a chain.
    let cert_b = CertificateBuilder::new(
        "run-sc003b",
        IntentRecord {
            requirements_hash: "req".into(),
            spec_id: None,
            spec_hash: None,
        },
    )
    .build_spec_hash("bs")
    .build();

    // Implant run-A's chain into run-B's cert.
    let mut tampered = cert_b.clone();
    tampered.inter_stage_chain = cert_a.inter_stage_chain.clone();

    let result = verify_certificate(&tampered, None);
    assert!(!result.valid);
    assert!(
        result
            .errors
            .iter()
            .any(|e| e.contains("does not match certificate pipeline_run_id")),
        "expected cross-run diagnostic; errors: {:?}",
        result.errors
    );
}

/// SC-004: `verify-certificate` CLI validates BOTH the run-level
/// certificate AND the embedded inter-stage manifest chain offline.
///
/// We invoke the compiled binary to mirror what `make verify-certificate`
/// drives end-to-end.
#[test]
fn sc_004_verify_certificate_cli_validates_chain_offline() {
    let (_keep, cert_path) = build_sealed_cert_with_chain("run-sc004");
    let bin = env!("CARGO_BIN_EXE_verify-certificate");
    let output = std::process::Command::new(bin)
        .arg(&cert_path)
        .output()
        .expect("verify-certificate runs");
    assert!(
        output.status.success(),
        "verify-certificate exit {} stderr={}",
        output.status,
        String::from_utf8_lossy(&output.stderr)
    );
    let stderr = String::from_utf8_lossy(&output.stderr);
    assert!(stderr.contains("VERIFIED"), "stderr: {stderr}");
}

/// SC-004 negative: tamper the persisted cert on disk, the CLI exits
/// non-zero with the manifest-level diagnostic surfaced to the
/// auditor.
#[test]
fn sc_004_cli_rejects_tampered_chain() {
    let (_keep, cert_path) = build_sealed_cert_with_chain("run-sc004-tamper");
    let json = std::fs::read_to_string(&cert_path).unwrap();
    let mut cert: factory_engine::GovernanceCertificate = serde_json::from_str(&json).unwrap();
    {
        let chain = cert.inter_stage_chain.as_mut().unwrap();
        chain.manifests[1]
            .artifact_hashes
            .insert("s1-out.json".into(), "BAD".into());
    }
    std::fs::write(&cert_path, serde_json::to_string_pretty(&cert).unwrap()).unwrap();

    let bin = env!("CARGO_BIN_EXE_verify-certificate");
    let output = std::process::Command::new(bin)
        .arg(&cert_path)
        .output()
        .expect("verify-certificate runs");
    assert!(!output.status.success(), "tampered cert should fail");
    let stderr = String::from_utf8_lossy(&output.stderr);
    assert!(
        stderr.contains("inter-stage manifest"),
        "stderr should name the manifest failure; got: {stderr}"
    );
}

/// SC-005: fan-out branches each contribute their own signed manifest;
/// the certificate's chain replays all branches independently and the
/// auditor sees them as distinct verification records.
#[test]
fn sc_005_fanout_chain_verifies_branch_by_branch() {
    let tmp = TempDir::new().unwrap();
    let run_dir = tmp.path().join("run");
    std::fs::create_dir_all(&run_dir).unwrap();
    let mut signer = StageHandoffSigner::establish("run-sc005", &run_dir).unwrap();

    // s5 fans out to three downstream stages — each receives a
    // separately signed manifest (same artifact body, different `to_stage`).
    let mut s5_hashes = BTreeMap::new();
    s5_hashes.insert(
        "build-spec.yaml".into(),
        factory_engine::governance_certificate::sha256_bytes(b"build-spec"),
    );

    let mut manifests = Vec::new();
    for to in ["s6a-scaffold-init", "s6b-data-Org", "s6c-api-orgs-list"] {
        let m = signer
            .sign_handoff("s5", to, s5_hashes.clone(), BTreeMap::new())
            .unwrap();
        manifests.push(m);
    }
    // Each branch signs its own onward hand-off to s6h.
    for from in ["s6a-scaffold-init", "s6b-data-Org", "s6c-api-orgs-list"] {
        let m = signer
            .sign_handoff(
                from,
                "s6h-final-validation",
                BTreeMap::new(),
                BTreeMap::new(),
            )
            .unwrap();
        manifests.push(m);
    }

    let chain_record = InterStageChainRecord {
        key_chain: signer.finalize(),
        manifests,
    };
    let cert = CertificateBuilder::new(
        "run-sc005",
        IntentRecord {
            requirements_hash: "req".into(),
            spec_id: None,
            spec_hash: None,
        },
    )
    .build_spec_hash("bs")
    .inter_stage_chain(chain_record)
    .build();

    let result = verify_certificate(&cert, None);
    assert!(
        result.valid,
        "fan-out chain should verify; errors: {:?}",
        result.errors
    );

    // Chain anchors three downstream branches + their onward hand-offs.
    let chain = cert.inter_stage_chain.as_ref().unwrap();
    assert_eq!(chain.manifests.len(), 6, "3 fan-out + 3 onward");
    let fanout: Vec<&str> = chain
        .manifests
        .iter()
        .filter(|m| m.from_stage == "s5")
        .map(|m| m.to_stage.as_str())
        .collect();
    assert_eq!(
        fanout,
        vec!["s6a-scaffold-init", "s6b-data-Org", "s6c-api-orgs-list"]
    );
}
