// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Bartek Kus
// Spec: specs/168-per-project-governance-certificate/spec.md
//
// Integration coverage for spec 168 §FR-001 / §FR-002 / §FR-003 / §FR-004
// / §FR-005 / §FR-006 / §FR-007 — the tenant-emit and tenant-verify
// surface, exercised through the published `build-certificate` and
// `verify-certificate` binaries.

use factory_contracts::AdapterRegistry;
use factory_contracts::adapter_manifest::*;
use factory_engine::factory_root::FactoryRoot;
use factory_engine::kernel_emission::ToolchainMode;
use factory_engine::governance_certificate::SigningAttestationKind;
use factory_engine::{FactoryEngine, FactoryEngineConfig, GovernanceCertificate};
use std::path::{Path, PathBuf};
use std::process::Command;

fn bin_path(name: &str) -> PathBuf {
    // CARGO_BIN_EXE_<name> is populated by cargo when the test target
    // sits in the same package as the bin target.
    let env_key = format!("CARGO_BIN_EXE_{name}");
    std::env::var_os(&env_key)
        .map(PathBuf::from)
        .unwrap_or_else(|| panic!("env var {env_key} unset; cargo must run integration tests"))
}

fn write_stage_artifact(root: &Path, stage_id: &str, name: &str, body: &[u8]) {
    let stage_dir = root.join(stage_id);
    std::fs::create_dir_all(&stage_dir).unwrap();
    std::fs::write(stage_dir.join(name), body).unwrap();
}

fn read_certificate(path: &Path) -> GovernanceCertificate {
    let bytes = std::fs::read(path).expect("cert read");
    serde_json::from_slice(&bytes).expect("cert parse")
}

/// FR-002 + FR-003 + FR-007: tenant-mode requires signer flags. The
/// binary halts with a specific diagnostic and exit code 2 when the
/// flags are absent, rather than producing an unsigned certificate.
#[test]
fn tenant_mode_without_signer_halts_before_emission_fr007() {
    let tmp = tempfile::tempdir().unwrap();
    write_stage_artifact(tmp.path(), "tenant-codegen", "app.rs", b"fn main() {}");

    let output = Command::new(bin_path("build-certificate"))
        .arg(tmp.path())
        .arg("--tenant-mode")
        .output()
        .expect("spawn build-certificate");

    assert!(
        !output.status.success(),
        "tenant-mode without signer must NOT succeed"
    );
    assert_eq!(output.status.code(), Some(2));
    let stderr = String::from_utf8_lossy(&output.stderr);
    assert!(
        stderr.contains("anonymous signing forbidden")
            || stderr.contains("FR-007"),
        "stderr did not surface FR-007 diagnostic: {stderr}"
    );
    assert!(
        !tmp.path().join("governance-certificate.json").exists(),
        "tenant-mode halt must NOT have written a certificate"
    );
}

/// FR-002 + FR-003: a tenant-mode run with signer flags writes a
/// certificate whose JSON carries the signer fields with the supplied
/// values.
#[test]
fn tenant_mode_with_signer_emits_signed_certificate_fr003() {
    let tmp = tempfile::tempdir().unwrap();
    write_stage_artifact(tmp.path(), "tenant-codegen", "app.rs", b"fn main() {}");
    write_stage_artifact(tmp.path(), "tenant-bundle", "bundle.tar", b"<bytes>");

    let output = Command::new(bin_path("build-certificate"))
        .arg(tmp.path())
        .args(["--tenant-mode"])
        .args(["--signer-subject", "alice@tenant.example"])
        .args(["--signer-identity-provider", "rauthy@tenant-org"])
        .args(["--signer-session-id", "sess-42"])
        .args(["--stage-ids", "tenant-codegen,tenant-bundle"])
        .output()
        .expect("spawn build-certificate");

    assert!(
        output.status.success(),
        "tenant-mode with signer must succeed; stderr: {}",
        String::from_utf8_lossy(&output.stderr)
    );

    let cert_path = tmp.path().join("governance-certificate.json");
    assert!(cert_path.exists(), "certificate file missing");

    let cert = read_certificate(&cert_path);
    let signer = cert.signer.as_ref().expect("signer field missing");
    assert_eq!(signer.subject, "alice@tenant.example");
    assert_eq!(signer.identity_provider, "rauthy@tenant-org");
    assert_eq!(signer.session_id.as_deref(), Some("sess-42"));
    assert_eq!(cert.stages.len(), 2);
    assert_eq!(cert.stages[0].stage_id, "tenant-codegen");
    assert_eq!(cert.stages[1].stage_id, "tenant-bundle");
}

/// FR-004 + FR-005: verify-certificate accepts a clean tenant cert
/// offline (no network calls; only the cert file + artifact dir on disk).
#[test]
fn verify_accepts_clean_tenant_certificate_fr004() {
    let tmp = tempfile::tempdir().unwrap();
    write_stage_artifact(tmp.path(), "tenant-codegen", "app.rs", b"fn main() {}");

    let build = Command::new(bin_path("build-certificate"))
        .arg(tmp.path())
        .args(["--tenant-mode"])
        .args(["--signer-subject", "bob@tenant.example"])
        .args(["--signer-identity-provider", "github-actions@tenant/repo"])
        .args(["--stage-ids", "tenant-codegen"])
        .output()
        .expect("spawn build-certificate");
    assert!(build.status.success(), "build failed: {}", String::from_utf8_lossy(&build.stderr));

    let cert_path = tmp.path().join("governance-certificate.json");
    let verify = Command::new(bin_path("verify-certificate"))
        .arg(&cert_path)
        .args(["--artifact-dir", tmp.path().to_str().unwrap()])
        .output()
        .expect("spawn verify-certificate");
    assert!(
        verify.status.success(),
        "verifier rejected clean cert; stderr: {}; stdout: {}",
        String::from_utf8_lossy(&verify.stderr),
        String::from_utf8_lossy(&verify.stdout),
    );
}

/// FR-006: tampering with any artifact file referenced by the
/// certificate causes the verifier to exit non-zero with a specific
/// artifact-hash-mismatch diagnostic.
#[test]
fn verify_rejects_tampered_tenant_artifact_fr006() {
    let tmp = tempfile::tempdir().unwrap();
    write_stage_artifact(tmp.path(), "tenant-codegen", "app.rs", b"fn main() {}");

    let build = Command::new(bin_path("build-certificate"))
        .arg(tmp.path())
        .args(["--tenant-mode"])
        .args(["--signer-subject", "carol@tenant.example"])
        .args(["--signer-identity-provider", "rauthy@tenant-org"])
        .args(["--stage-ids", "tenant-codegen"])
        .output()
        .expect("spawn build-certificate");
    assert!(build.status.success(), "build failed: {}", String::from_utf8_lossy(&build.stderr));

    // Tamper the artifact AFTER the cert was sealed.
    std::fs::write(tmp.path().join("tenant-codegen/app.rs"), b"fn evil(){}").unwrap();

    let cert_path = tmp.path().join("governance-certificate.json");
    let verify = Command::new(bin_path("verify-certificate"))
        .arg(&cert_path)
        .args(["--artifact-dir", tmp.path().to_str().unwrap()])
        .output()
        .expect("spawn verify-certificate");
    assert!(
        !verify.status.success(),
        "verifier accepted tampered artifact; stdout: {}",
        String::from_utf8_lossy(&verify.stdout)
    );
    let combined = format!(
        "{}{}",
        String::from_utf8_lossy(&verify.stdout),
        String::from_utf8_lossy(&verify.stderr),
    );
    assert!(
        combined.contains("artifact hash mismatch")
            || combined.contains("hash mismatch"),
        "verifier output did not name the artifact hash mismatch: {combined}"
    );
}

/// FR-009: deterministic emission — the same inputs (modulo per-run
/// timestamp + ephemeral signing material, both of which are excluded
/// from artifact content) produce identical artifact hashes inside the
/// certificate's stage records.
#[test]
fn tenant_emission_is_artifact_hash_deterministic_fr009() {
    let tmp = tempfile::tempdir().unwrap();
    write_stage_artifact(tmp.path(), "tenant-codegen", "app.rs", b"fn main() {}");
    write_stage_artifact(tmp.path(), "tenant-codegen", "lib.rs", b"pub fn lib() {}");

    let invoke = || {
        let cert_dir = tempfile::tempdir().unwrap();
        let output = Command::new(bin_path("build-certificate"))
            .arg(tmp.path())
            .args(["--tenant-mode"])
            .args(["--signer-subject", "alice@tenant.example"])
            .args(["--signer-identity-provider", "rauthy@tenant-org"])
            .args(["--stage-ids", "tenant-codegen"])
            .args(["--out", cert_dir.path().join("c.json").to_str().unwrap()])
            .output()
            .expect("spawn build-certificate");
        assert!(output.status.success());
        let cert = read_certificate(&cert_dir.path().join("governance-certificate.json"));
        // tempdir lives until we move the cert out
        std::mem::forget(cert_dir);
        cert
    };

    let a = invoke();
    let b = invoke();
    assert_eq!(a.stages.len(), b.stages.len());
    for (sa, sb) in a.stages.iter().zip(b.stages.iter()) {
        assert_eq!(sa.stage_id, sb.stage_id);
        assert_eq!(sa.artifact_hashes, sb.artifact_hashes);
    }
}

/// SC-001 through SC-005 end-to-end — the closure narrative.
///
/// 1. FactoryEngine emits a born-with kernel into a tenant project root,
///    laying down `.factory/toolchain.yaml` + `.kernel-version` with
///    the certificate-toolchain field populated.
/// 2. The tenant project then runs its own pipeline (synthesised here
///    as a `.factory/runs/<run-id>/` directory with two stage outputs).
/// 3. `build-certificate --tenant-mode` against that run dir produces
///    a `governance-certificate.json` carrying the signer (SC-001).
/// 4. `verify-certificate` against the produced cert exits 0 (SC-002).
/// 5. Tampering an artifact and re-verifying exits 1 with the
///    artifact-hash-mismatch diagnostic (SC-003).
/// 6. The verifier consumes only local files — no network — so an
///    auditor can reproduce the verification offline using only the
///    tenant's working tree and the verifier binary (SC-004).
/// 7. `build-certificate --tenant-mode` without signer flags halts
///    before writing a certificate, exiting 2 with the FR-007
///    diagnostic (SC-005).
#[test]
fn spec_168_sc_001_through_005_end_to_end() {
    // ── Born-with kernel emission ──
    let oap_source = tempfile::tempdir().unwrap();
    write_oap_kernel_source(oap_source.path());
    let tenant = tempfile::tempdir().unwrap();

    let registry = AdapterRegistry::from_manifests(vec![minimal_acme_vue_encore_manifest()]);
    let cfg = FactoryEngineConfig {
        factory_root: FactoryRoot::Filesystem(PathBuf::from("factory")),
        project_path: PathBuf::from("."),
        concurrency_limit: 1,
    };
    let engine = FactoryEngine::with_adapters(cfg, registry);

    let report = engine
        .emit_project_kernel(
            "acme-vue-encore",
            tenant.path(),
            oap_source.path(),
            vec!["apps/".into(), "packages/".into()],
            Some("file://adapter-scopes.json#acme-vue-encore".into()),
            ToolchainMode::PinnedToolchain,
            "fixturecommit".into(),
        )
        .expect("kernel emission succeeded");

    // FR-001 + FR-008: kernel records the toolchain identity.
    let cert_tc = report
        .kernel_version
        .certificate_toolchain
        .as_ref()
        .expect("certificate_toolchain populated");
    assert_eq!(cert_tc.emitter, "build-certificate");
    assert_eq!(cert_tc.verifier, "verify-certificate");
    assert!(tenant.path().join(".factory/toolchain.yaml").exists());
    let toolchain_body =
        std::fs::read_to_string(tenant.path().join(".factory/toolchain.yaml")).unwrap();
    assert!(toolchain_body.contains("mode: \"pinned-toolchain\""));

    // ── Synthesised tenant pipeline run ──
    let run_dir = tenant.path().join(".factory/runs/run-abc");
    write_stage_artifact(&run_dir, "tenant-codegen", "app.rs", b"fn main(){}");
    write_stage_artifact(&run_dir, "tenant-bundle", "bundle.tar", b"<bytes>");

    // SC-005: emission without signer flags halts.
    let halt = Command::new(bin_path("build-certificate"))
        .arg(&run_dir)
        .args(["--tenant-mode"])
        .output()
        .expect("spawn build-certificate (halt path)");
    assert_eq!(halt.status.code(), Some(2), "SC-005 halt expected");
    assert!(
        !run_dir.join("governance-certificate.json").exists(),
        "SC-005: no certificate may exist after halt"
    );

    // SC-001: emission with signer flags writes the certificate.
    let emit = Command::new(bin_path("build-certificate"))
        .arg(&run_dir)
        .args(["--tenant-mode"])
        .args(["--signer-subject", "alice@tenant.example"])
        .args(["--signer-identity-provider", "rauthy@tenant-org"])
        .args(["--signer-session-id", "sess-e2e"])
        .args(["--stage-ids", "tenant-codegen,tenant-bundle"])
        .output()
        .expect("spawn build-certificate (emit path)");
    assert!(
        emit.status.success(),
        "SC-001 emission failed: {}",
        String::from_utf8_lossy(&emit.stderr)
    );
    let cert_path = run_dir.join("governance-certificate.json");
    assert!(cert_path.exists(), "SC-001: certificate file expected");

    let cert = read_certificate(&cert_path);
    let signer = cert.signer.as_ref().expect("signer populated");
    assert_eq!(signer.subject, "alice@tenant.example");
    assert_eq!(signer.identity_provider, "rauthy@tenant-org");

    // SC-002 + SC-004 (offline): verify-certificate accepts the clean cert
    // using only the tenant's working tree and the verifier binary.
    let ok = Command::new(bin_path("verify-certificate"))
        .arg(&cert_path)
        .args(["--artifact-dir", run_dir.to_str().unwrap()])
        .output()
        .expect("spawn verify-certificate (clean)");
    assert!(
        ok.status.success(),
        "SC-002 clean verify failed: {}",
        String::from_utf8_lossy(&ok.stderr)
    );

    // SC-003: tampering an artifact causes the verifier to exit 1 with
    // a specific artifact-hash-mismatch diagnostic.
    std::fs::write(run_dir.join("tenant-codegen/app.rs"), b"fn evil(){}").unwrap();
    let bad = Command::new(bin_path("verify-certificate"))
        .arg(&cert_path)
        .args(["--artifact-dir", run_dir.to_str().unwrap()])
        .output()
        .expect("spawn verify-certificate (tampered)");
    assert!(!bad.status.success(), "SC-003: tampered verify must fail");
    let bad_out = format!(
        "{}{}",
        String::from_utf8_lossy(&bad.stdout),
        String::from_utf8_lossy(&bad.stderr),
    );
    assert!(
        bad_out.contains("hash mismatch"),
        "SC-003: diagnostic must name the hash mismatch: {bad_out}"
    );
}

// ── Helpers reused by the end-to-end test ──

fn write_oap_kernel_source(root: &Path) {
    for (rel, body) in &[
        (
            "specs/000-bootstrap-spec-system/spec.md",
            "# spec 000\nfixture content\n",
        ),
        ("standards/spec/constitution.md", "# c\n"),
        ("standards/spec/contract.md", "# k\n"),
        ("standards/spec/templates/spec-template.md", "# tmpl\n"),
        (
            ".derived/spec-registry/registry.json",
            r#"{"specVersion":"0.1.0","specs":[]}"#,
        ),
    ] {
        let p = root.join(rel);
        std::fs::create_dir_all(p.parent().unwrap()).unwrap();
        std::fs::write(p, body).unwrap();
    }
}

fn minimal_acme_vue_encore_manifest() -> AdapterManifest {
    AdapterManifest {
        schema_version: "1.0.0".into(),
        adapter: AdapterIdentity {
            name: "acme-vue-encore".into(),
            display_name: "ACME Vue Node".into(),
            version: "0.1.0".into(),
            description: None,
        },
        stack: StackSpec {
            language: "typescript".into(),
            runtime: "node-22".into(),
            backend: BackendSpec {
                framework: "express-5".into(),
                description: "minimal".into(),
            },
            frontend: FrontendSpec {
                framework: "vue-3".into(),
                state_management: "pinia".into(),
                design_system: "none".into(),
                description: "minimal".into(),
            },
            database: None,
        },
        capabilities: Capabilities {
            dual_stack: false,
            bff_pattern: false,
            single_stack: true,
            session_auth: false,
            token_auth: false,
            api_key_auth: false,
            module_system: false,
            file_uploads: false,
            background_jobs: false,
            realtime: false,
            email_notifications: false,
            audit_logging: false,
            direct_sql: false,
            orm_based: false,
            api_proxy: false,
            extra: Default::default(),
        },
        supported_auth: vec![],
        supported_session_stores: None,
        commands: Commands {
            install: "npm install".into(),
            compile: "npm run build".into(),
            test: "npm test".into(),
            lint: "npm run lint".into(),
            dev: "npm run dev".into(),
            format_check: None,
            type_check: None,
            seed: None,
            feature_verify: vec![],
            extra: Default::default(),
        },
        directory_conventions: DirectoryConventions {
            api_service: None,
            api_controller: None,
            api_route: None,
            api_test: None,
            api_types: None,
            api_middleware: None,
            ui_view: None,
            ui_store: None,
            ui_route_config: None,
            ui_test: None,
            ui_component: None,
            migration: None,
            seed: None,
            schema_types: None,
            env_file: None,
            env_file_per_stack: None,
            extra: Default::default(),
        },
        patterns: Patterns {
            api: None,
            ui: None,
            data: None,
            page_types: None,
        },
        agents: Agents {
            api_scaffolder: "agents/api.md".into(),
            ui_scaffolder: "agents/ui.md".into(),
            data_scaffolder: "agents/data.md".into(),
            configurer: "agents/configurer.md".into(),
            trimmer: "agents/trimmer.md".into(),
            seed_generator: None,
            reviewer: None,
            security_auditor: None,
        },
        scaffold: Scaffold {
            source: ScaffoldSource::Local("scaffold/".into()),
            description: "base".into(),
            modules: std::collections::HashMap::new(),
            setup_commands: vec![],
            ..Default::default()
        },
        validation: Validation {
            invariants: vec![],
            invariants_file: None,
        },
        dual_stack: None,
        governance: None,
    }
}

/// Defensive: partial signer flags exit 2 with a specific diagnostic so
/// a misconfigured CI invocation does not silently fall through to an
/// unsigned cert (FR-007's intent at the CLI surface).
#[test]
fn partial_signer_flags_are_rejected_explicitly() {
    let tmp = tempfile::tempdir().unwrap();
    write_stage_artifact(tmp.path(), "tenant-codegen", "app.rs", b"fn main() {}");

    let output = Command::new(bin_path("build-certificate"))
        .arg(tmp.path())
        .args(["--signer-subject", "alice@tenant.example"])
        .output()
        .expect("spawn build-certificate");
    assert!(!output.status.success());
    assert_eq!(output.status.code(), Some(2));
    let stderr = String::from_utf8_lossy(&output.stderr);
    assert!(
        stderr.contains("requires --signer-identity-provider"),
        "stderr did not name the partial-flag requirement: {stderr}"
    );
}

/// Spec 220 FR-003: with `--require-operator-key` set and no operator key in
/// the environment, the binary refuses to emit an ephemeral-signed (untrusted)
/// certificate. It exits 2 and writes nothing.
#[test]
fn require_operator_key_halts_on_ephemeral_fr003() {
    let tmp = tempfile::tempdir().unwrap();
    write_stage_artifact(tmp.path(), "tenant-codegen", "app.rs", b"fn main() {}");

    let output = Command::new(bin_path("build-certificate"))
        .arg(tmp.path())
        .args(["--tenant-mode"])
        .args(["--signer-subject", "alice@tenant.example"])
        .args(["--signer-identity-provider", "rauthy@tenant-org"])
        .args(["--stage-ids", "tenant-codegen"])
        .arg("--require-operator-key")
        // Force the ephemeral path regardless of the ambient environment.
        .env_remove("OAP_SIGNING_KEY")
        .env_remove("OAP_SIGNING_KEY_PATH")
        .output()
        .expect("spawn build-certificate");

    assert_eq!(
        output.status.code(),
        Some(2),
        "require-operator-key with an ephemeral key must exit 2; stderr: {}",
        String::from_utf8_lossy(&output.stderr)
    );
    let stderr = String::from_utf8_lossy(&output.stderr);
    assert!(
        stderr.contains("--require-operator-key") && stderr.contains("ephemeral"),
        "stderr did not surface the FR-003 operator-key diagnostic: {stderr}"
    );
    assert!(
        !tmp.path().join("governance-certificate.json").exists(),
        "no certificate may be written when the operator-key guard fires"
    );
}

/// Spec 220 FR-003: with an operator-supplied `OAP_SIGNING_KEY` present,
/// `--require-operator-key` is satisfied and emission proceeds with an
/// Operator signing attestation.
#[test]
fn require_operator_key_passes_with_operator_key_fr003() {
    let tmp = tempfile::tempdir().unwrap();
    write_stage_artifact(tmp.path(), "tenant-codegen", "app.rs", b"fn main() {}");

    // A valid base64 32-byte Ed25519 seed (32 zero bytes => 43 'A' + '=').
    let operator_seed = format!("{}=", "A".repeat(43));

    let output = Command::new(bin_path("build-certificate"))
        .arg(tmp.path())
        .args(["--tenant-mode"])
        .args(["--signer-subject", "alice@tenant.example"])
        .args(["--signer-identity-provider", "rauthy@tenant-org"])
        .args(["--stage-ids", "tenant-codegen"])
        .arg("--require-operator-key")
        .env("OAP_SIGNING_KEY", &operator_seed)
        .env_remove("OAP_SIGNING_KEY_PATH")
        .output()
        .expect("spawn build-certificate");

    assert!(
        output.status.success(),
        "require-operator-key with an operator key must succeed; stderr: {}",
        String::from_utf8_lossy(&output.stderr)
    );
    let cert = read_certificate(&tmp.path().join("governance-certificate.json"));
    assert!(
        matches!(cert.signing_attestation.kind, SigningAttestationKind::Operator),
        "expected Operator signing attestation, got {:?}",
        cert.signing_attestation.kind
    );
}

/// Spec 220 FR-007 + AC-8: a supplied corpus attestation is bound into the
/// tenant certificate by hash (read, never recompute), and the round-trip
/// verifies: `verify-certificate --corpus-attestation` accepts the matching
/// attestation and rejects a mismatched one.
#[test]
fn corpus_binding_round_trips_fr007() {
    let tmp = tempfile::tempdir().unwrap();
    write_stage_artifact(tmp.path(), "tenant-codegen", "app.rs", b"fn main() {}");

    // A minimal but valid spec-spine CorpusAttestation (camelCase wire shape).
    let attestation = r#"{
        "schemaVersion": "0.1.0",
        "tool": { "name": "spec-spine", "version": "0.8.0" },
        "inputsManifestHash": "inputs-abc",
        "registryHash": "registry-1",
        "verdicts": {
            "compile": { "ok": true },
            "lint": { "ok": true, "findingsHash": "findings-0" }
        }
    }"#;
    let att_path = tmp.path().join("attestation.json");
    std::fs::write(&att_path, attestation).unwrap();

    let build = Command::new(bin_path("build-certificate"))
        .arg(tmp.path())
        .args(["--tenant-mode"])
        .args(["--signer-subject", "alice@tenant.example"])
        .args(["--signer-identity-provider", "rauthy@tenant-org"])
        .args(["--stage-ids", "tenant-codegen"])
        .args(["--corpus-attestation", att_path.to_str().unwrap()])
        .output()
        .expect("spawn build-certificate");
    assert!(
        build.status.success(),
        "corpus-bound emission failed: {}",
        String::from_utf8_lossy(&build.stderr)
    );

    let cert_path = tmp.path().join("governance-certificate.json");
    let cert = read_certificate(&cert_path);
    let binding = cert
        .corpus_binding
        .as_ref()
        .expect("corpus_binding must be present (FR-007)");
    assert!(
        !binding.corpus_attestation_hash.is_empty(),
        "corpus_attestation_hash must be populated"
    );
    assert_eq!(binding.spec_spine_version, "0.8.0");

    // AC-8: the verifier accepts the matching attestation (round-trip).
    let ok = Command::new(bin_path("verify-certificate"))
        .arg(&cert_path)
        .args(["--artifact-dir", tmp.path().to_str().unwrap()])
        .args(["--corpus-attestation", att_path.to_str().unwrap()])
        .output()
        .expect("spawn verify-certificate (matching)");
    assert!(
        ok.status.success(),
        "verifier rejected a matching corpus attestation; stderr: {}; stdout: {}",
        String::from_utf8_lossy(&ok.stderr),
        String::from_utf8_lossy(&ok.stdout),
    );

    // AC-8: a mismatched attestation fails verification.
    let other = attestation.replace("registry-1", "registry-DIFFERENT");
    let other_path = tmp.path().join("other.json");
    std::fs::write(&other_path, other).unwrap();
    let bad = Command::new(bin_path("verify-certificate"))
        .arg(&cert_path)
        .args(["--artifact-dir", tmp.path().to_str().unwrap()])
        .args(["--corpus-attestation", other_path.to_str().unwrap()])
        .output()
        .expect("spawn verify-certificate (mismatch)");
    assert!(
        !bad.status.success(),
        "verifier accepted a mismatched corpus attestation; stdout: {}",
        String::from_utf8_lossy(&bad.stdout)
    );
}

/// Spec 203 FR-003 / AC-2: the tenant emitter binds the produced app's SBOM +
/// audit artifacts (read, never recompute), the BOM tool version is lifted from
/// the BOM's own `metadata.tools`, and the binding round-trips through
/// `verify-certificate --sbom-dir` (matching passes, a tampered BOM fails).
#[test]
fn sbom_binding_round_trips_fr003() {
    let tmp = tempfile::tempdir().unwrap();
    write_stage_artifact(tmp.path(), "tenant-codegen", "app.rs", b"fn main() {}");

    // Minimal CycloneDX BOM (with metadata.tools) + audit artifact, laid out
    // under the produced-app `.factory/` exactly where the emitter reads them.
    let factory = tmp.path().join(".factory");
    std::fs::create_dir_all(&factory).unwrap();
    let bom = r#"{
        "bomFormat": "CycloneDX",
        "specVersion": "1.6",
        "metadata": { "tools": { "components": [
            { "type": "application", "name": "cyclonedx-npm", "version": "1.19.0" }
        ] } },
        "components": []
    }"#;
    std::fs::write(factory.join("sbom.cdx.json"), bom).unwrap();
    let audit =
        r#"{"tool":"npm-audit","ranAt":"2026-07-01T00:00:00Z","status":"absent","reason":"test fixture"}"#;
    std::fs::write(factory.join("audit.json"), audit).unwrap();

    let build = Command::new(bin_path("build-certificate"))
        .arg(tmp.path())
        .args(["--tenant-mode"])
        .args(["--signer-subject", "alice@tenant.example"])
        .args(["--signer-identity-provider", "rauthy@tenant-org"])
        .args(["--stage-ids", "tenant-codegen"])
        .args(["--sbom-dir", tmp.path().to_str().unwrap()])
        .output()
        .expect("spawn build-certificate");
    assert!(
        build.status.success(),
        "sbom-bound emission failed: {}",
        String::from_utf8_lossy(&build.stderr)
    );

    let cert_path = tmp.path().join("governance-certificate.json");
    let cert = read_certificate(&cert_path);
    let binding = cert
        .sbom_artifact_binding
        .as_ref()
        .expect("sbom_artifact_binding must be present (FR-003)");
    assert!(!binding.bom_hash.is_empty(), "bom_hash must be populated");
    assert!(
        !binding.audit_hash.is_empty(),
        "audit_hash must be populated"
    );
    assert_eq!(
        binding.bom_tool_version, "1.19.0",
        "BOM tool version must be read from the BOM's metadata.tools"
    );

    // AC-2 round-trip: the verifier accepts the matching on-disk artifacts.
    let ok = Command::new(bin_path("verify-certificate"))
        .arg(&cert_path)
        .args(["--artifact-dir", tmp.path().to_str().unwrap()])
        .args(["--sbom-dir", tmp.path().to_str().unwrap()])
        .output()
        .expect("spawn verify-certificate (matching)");
    assert!(
        ok.status.success(),
        "verifier rejected matching SBOM artifacts; stderr: {}; stdout: {}",
        String::from_utf8_lossy(&ok.stderr),
        String::from_utf8_lossy(&ok.stdout),
    );

    // AC-2 tamper: mutating the BOM after emission fails verification.
    std::fs::write(factory.join("sbom.cdx.json"), b"TAMPERED").unwrap();
    let bad = Command::new(bin_path("verify-certificate"))
        .arg(&cert_path)
        .args(["--artifact-dir", tmp.path().to_str().unwrap()])
        .args(["--sbom-dir", tmp.path().to_str().unwrap()])
        .output()
        .expect("spawn verify-certificate (tamper)");
    assert!(
        !bad.status.success(),
        "verifier accepted a tampered BOM; stdout: {}",
        String::from_utf8_lossy(&bad.stdout)
    );
}
