// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Bartek Kus
// Spec: specs/170-signed-inter-stage-manifests/spec.md
//
// End-to-end chain tests covering the s0–s5 sequential hand-offs and the
// s5 → s6a/s6b/s6c fan-out, plus tamper and cross-run-swap guards
// (SC-001, SC-002, SC-003, SC-005).

use factory_engine::inter_stage_manifest::{
    InterStageManifest, ManifestError, RunKeyChain, StageHandoffSigner, verify_manifest,
};
use std::collections::BTreeMap;
use std::path::PathBuf;
use tempfile::TempDir;

fn write_artifact(dir: &std::path::Path, name: &str, body: &str) -> PathBuf {
    std::fs::create_dir_all(dir).unwrap();
    let path = dir.join(name);
    std::fs::write(&path, body).unwrap();
    path
}

/// Walk a sequential s0 → s1 → s2 → s3 → s4 → s5 chain. Each hand-off
/// is signed by the dispatching stage; the next stage verifies before
/// consuming (FR-001, FR-003). Returns the final chain for downstream
/// composition.
#[test]
fn sequential_chain_signs_and_verifies_every_handoff() {
    let tmp = TempDir::new().unwrap();
    let run_dir = tmp.path().join("run");
    std::fs::create_dir_all(&run_dir).unwrap();
    let mut signer =
        StageHandoffSigner::establish("run-seq", &run_dir).expect("establish signing session");

    let stages = ["s0", "s1", "s2", "s3", "s4", "s5"];
    let mut manifests = Vec::new();

    // Each stage writes one artifact, then hands off to the next.
    for window in stages.windows(2) {
        let (from, to) = (window[0], window[1]);
        let stage_dir = run_dir.join(from);
        let artifact = write_artifact(&stage_dir, "out.json", &format!("payload for {from}"));
        let mut hashes = BTreeMap::new();
        let bytes = std::fs::read(&artifact).unwrap();
        let hash = factory_engine::governance_certificate::sha256_bytes(&bytes);
        hashes.insert("out.json".into(), hash);

        let manifest = signer
            .sign_handoff(from, to, hashes, BTreeMap::new())
            .expect("sign handoff");
        // The receiving stage validates before consuming.
        signer
            .verify_handoff(&manifest, to)
            .expect("verify at receiver");
        manifests.push(manifest);
    }

    let chain = signer.finalize();
    assert_eq!(chain.run_id, "run-seq");
    // 5 hand-offs ⇒ 5 stages contributed ephemeral keys.
    for from in &stages[..stages.len() - 1] {
        assert!(
            chain.stage_keys.contains_key(*from),
            "chain missing key for {from}"
        );
    }
    // Offline re-verification using only the persisted chain (FR-006).
    for manifest in &manifests {
        verify_manifest(manifest, &chain, Some(&manifest.to_stage)).expect("re-verify offline");
    }
}

/// Fan-out from s5 to s6a, s6b, s6c. Each branch receives the same s5
/// manifest, validates s5's signature, then independently signs its own
/// output for downstream consumption (FR-008, SC-005).
#[test]
fn fanout_branches_validate_s5_then_sign_independently() {
    let tmp = TempDir::new().unwrap();
    let run_dir = tmp.path().join("run-fanout");
    std::fs::create_dir_all(&run_dir).unwrap();
    let mut signer = StageHandoffSigner::establish("run-fan", &run_dir).unwrap();

    // s5 produces a single manifest delivered to each branch. We sign
    // hand-offs `s5 → s6a`, `s5 → s6b`, `s5 → s6c` separately because
    // each branch is its own receiver in the certificate chain. The
    // signing material (s5's ephemeral key) is identical across the
    // three because it's deterministic in `(root, s5)`.
    let s5_artifact = write_artifact(&run_dir.join("s5"), "build-spec.yaml", "spec: y");
    let s5_bytes = std::fs::read(&s5_artifact).unwrap();
    let s5_hash = factory_engine::governance_certificate::sha256_bytes(&s5_bytes);
    let mut s5_hashes = BTreeMap::new();
    s5_hashes.insert("build-spec.yaml".into(), s5_hash);

    let m5a = signer
        .sign_handoff(
            "s5",
            "s6a-scaffold-init",
            s5_hashes.clone(),
            BTreeMap::new(),
        )
        .unwrap();
    let m5b = signer
        .sign_handoff("s5", "s6b-data-Org", s5_hashes.clone(), BTreeMap::new())
        .unwrap();
    let m5c = signer
        .sign_handoff(
            "s5",
            "s6c-api-orgs-list",
            s5_hashes.clone(),
            BTreeMap::new(),
        )
        .unwrap();

    // s5's signer fingerprint is the same in all three (deterministic).
    assert_eq!(m5a.signer.ephemeral_key_id, m5b.signer.ephemeral_key_id);
    assert_eq!(m5a.signer.ephemeral_key_id, m5c.signer.ephemeral_key_id);

    // Each branch validates s5's hand-off, then signs its own output
    // for s6h (final-validation). FR-008: a branch can fail independently.
    for (from, to) in [
        ("s6a-scaffold-init", "s6h-final-validation"),
        ("s6b-data-Org", "s6h-final-validation"),
        ("s6c-api-orgs-list", "s6h-final-validation"),
    ] {
        let branch_artifact =
            write_artifact(&run_dir.join(from), "result.json", &format!("from {from}"));
        let bytes = std::fs::read(&branch_artifact).unwrap();
        let mut hashes = BTreeMap::new();
        hashes.insert(
            "result.json".into(),
            factory_engine::governance_certificate::sha256_bytes(&bytes),
        );
        let m = signer
            .sign_handoff(from, to, hashes, BTreeMap::new())
            .unwrap();
        signer.verify_handoff(&m, to).expect("branch verify");
    }

    // A single mis-signed fan-out branch only affects its downstream
    // consumption. We simulate by tampering m5b's artifact_hashes; the
    // other two manifests still verify cleanly.
    let mut tampered_m5b: InterStageManifest = m5b.clone();
    tampered_m5b
        .artifact_hashes
        .insert("build-spec.yaml".into(), "tampered".into());

    let err = signer
        .verify_handoff(&tampered_m5b, "s6b-data-Org")
        .unwrap_err();
    assert!(
        matches!(err, ManifestError::SignatureInvalid(_)),
        "expected SignatureInvalid, got {err:?}"
    );
    // m5a + m5c still pass.
    signer
        .verify_handoff(&m5a, "s6a-scaffold-init")
        .expect("m5a still valid");
    signer
        .verify_handoff(&m5c, "s6c-api-orgs-list")
        .expect("m5c still valid");
}

/// SC-003: a manifest from another run is rejected when presented to
/// this run's chain.
#[test]
fn cross_run_swap_is_rejected_offline() {
    let tmp = TempDir::new().unwrap();
    let dir_a = tmp.path().join("run-A");
    let dir_b = tmp.path().join("run-B");
    std::fs::create_dir_all(&dir_a).unwrap();
    std::fs::create_dir_all(&dir_b).unwrap();

    let mut signer_a = StageHandoffSigner::establish("run-A", &dir_a).unwrap();
    let manifest_a = signer_a
        .sign_handoff("s0", "s1", BTreeMap::new(), BTreeMap::new())
        .unwrap();

    let signer_b = StageHandoffSigner::establish("run-B", &dir_b).unwrap();
    // run-B's chain doesn't know about run-A's keys, and the run_id
    // mismatch trips first.
    let err = signer_b.verify_handoff(&manifest_a, "s1").unwrap_err();
    assert!(
        matches!(err, ManifestError::RunIdMismatch { .. }),
        "expected RunIdMismatch, got {err:?}"
    );
}

/// SC-004 precondition: validation is offline-capable. Load the chain
/// from disk in a fresh process-equivalent context (no in-memory state),
/// then verify a hand-off.
#[test]
fn offline_chain_load_verifies_handoff() {
    let tmp = TempDir::new().unwrap();
    let run_dir = tmp.path().join("run-offline");
    std::fs::create_dir_all(&run_dir).unwrap();
    let manifest;
    {
        let mut signer = StageHandoffSigner::establish("run-off", &run_dir).unwrap();
        manifest = signer
            .sign_handoff("s3", "s4", BTreeMap::new(), BTreeMap::new())
            .unwrap();
    }
    let chain_path = run_dir.join(factory_engine::inter_stage_manifest::KEYCHAIN_FILENAME);
    let chain = RunKeyChain::load_from_file(&chain_path).unwrap();
    verify_manifest(&manifest, &chain, Some("s4")).expect("offline verify");
}

/// Engine-level convenience entry: `establish_signing_session` +
/// `seal_stage_handoff` give the orchestrator a one-call path that
/// hashes artifacts from disk and produces a signed manifest. Smoke
/// test for the wiring used by `factory-run`.
#[test]
fn engine_seal_stage_handoff_hashes_disk_artifacts() {
    use factory_contracts::AdapterRegistry;
    use factory_engine::{FactoryEngine, FactoryEngineConfig};

    let tmp = TempDir::new().unwrap();
    let run_dir = tmp.path().join("run-engine");
    std::fs::create_dir_all(&run_dir).unwrap();

    // Engine config with an empty adapter registry — we only exercise
    // the signing helpers, not adapter discovery.
    let cfg = FactoryEngineConfig {
        factory_root: factory_engine::FactoryRoot::Filesystem(tmp.path().to_path_buf()),
        project_path: tmp.path().to_path_buf(),
        concurrency_limit: 1,
    };
    let engine = FactoryEngine::with_adapters(cfg, AdapterRegistry::from_manifests(Vec::new()));

    let mut signer = engine
        .establish_signing_session("run-engine", run_dir.clone())
        .unwrap();

    let stage_dir = run_dir.join("s2");
    let path = write_artifact(&stage_dir, "service.yaml", "kind: Service");
    let artifact_paths = vec![("service.yaml".to_string(), path.clone())];

    let manifest = engine
        .seal_stage_handoff(&mut signer, "s2", "s3", &artifact_paths, BTreeMap::new())
        .unwrap();

    signer.verify_handoff(&manifest, "s3").unwrap();
    // The hash matches the on-disk content.
    let bytes = std::fs::read(&path).unwrap();
    let expected = factory_engine::governance_certificate::sha256_bytes(&bytes);
    assert_eq!(
        manifest.artifact_hashes.get("service.yaml"),
        Some(&expected)
    );
}
