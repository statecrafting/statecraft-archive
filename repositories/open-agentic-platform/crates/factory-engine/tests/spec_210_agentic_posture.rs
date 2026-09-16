// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Bartek Kus
// Spec: specs/210-build-spec-agentic-posture/spec.md
//
// End-to-end coverage for spec 210, exercised through the real
// `build-certificate` and `verify-certificate` binaries:
//   - AC-2 (emitter side): a run whose frozen Build Spec declares a posture
//     yields a certificate that records it; an omitted field yields
//     none/defaulted:true.
//   - AC-3 (falsifiability): a `none` posture contradicted by an
//     `@anthropic-ai/sdk`-class dependency in the produced app's SBOM fails
//     `verify-certificate --sbom-dir`; a clean BOM passes.

use factory_engine::GovernanceCertificate;
use std::path::{Path, PathBuf};
use std::process::Command;

fn bin_path(name: &str) -> PathBuf {
    let env_key = format!("CARGO_BIN_EXE_{name}");
    std::env::var_os(&env_key)
        .map(PathBuf::from)
        .unwrap_or_else(|| panic!("env var {env_key} unset; cargo must run integration tests"))
}

fn read_certificate(path: &Path) -> GovernanceCertificate {
    let bytes = std::fs::read(path).expect("cert read");
    serde_json::from_slice(&bytes).expect("cert parse")
}

/// A minimal parseable Build Spec (schema 1.2.0), with an optional
/// `agentic_posture` block appended.
fn build_spec_yaml(posture_block: Option<&str>) -> String {
    let mut yaml = String::from(
        r#"schema_version: "1.2.0"
project:
  name: test-app
  display_name: Test App
  org: test-org
  description: A test application
  variant: single-public
auth:
  audiences:
    staff:
      method: oidc
      provisioning_model: admin-only
      roles:
        - role_code: admin
          display_name: Administrator
          description: Admin role
data_model:
  entities: []
business_rules: []
api:
  resources: []
ui:
  pages: []
"#,
    );
    if let Some(block) = posture_block {
        yaml.push_str(block);
    }
    yaml
}

/// Build a run dir with the frozen Build Spec at `s5-ui-specification/build-spec.yaml`.
fn run_dir_with_posture(posture_block: Option<&str>) -> tempfile::TempDir {
    let dir = tempfile::tempdir().unwrap();
    let stage = dir.path().join("s5-ui-specification");
    std::fs::create_dir_all(&stage).unwrap();
    std::fs::write(stage.join("build-spec.yaml"), build_spec_yaml(posture_block)).unwrap();
    dir
}

/// Emit a signed (tenant-path) certificate from a run dir.
fn emit_cert(run_dir: &Path) -> GovernanceCertificate {
    let out = Command::new(bin_path("build-certificate"))
        .arg(run_dir)
        .args(["--signer-subject", "alice@tenant.example"])
        .args(["--signer-identity-provider", "rauthy@tenant-org"])
        .output()
        .expect("spawn build-certificate");
    assert!(
        out.status.success(),
        "build-certificate failed: {}",
        String::from_utf8_lossy(&out.stderr)
    );
    read_certificate(&run_dir.join("governance-certificate.json"))
}

/// Write a produced-app root whose `.factory/sbom.cdx.json` lists the given
/// npm dependencies, and return its temp dir.
fn sbom_dir_with(deps: &[(&str, &str)]) -> tempfile::TempDir {
    let dir = tempfile::tempdir().unwrap();
    let factory = dir.path().join(".factory");
    std::fs::create_dir_all(&factory).unwrap();
    let components: Vec<serde_json::Value> = deps
        .iter()
        .map(|(name, ver)| {
            serde_json::json!({
                "type": "library",
                "name": name,
                "version": ver,
                "purl": format!("pkg:npm/{}@{}", name.replace('@', "%40"), ver)
            })
        })
        .collect();
    let bom = serde_json::json!({
        "bomFormat": "CycloneDX",
        "specVersion": "1.6",
        "components": components
    });
    std::fs::write(
        factory.join("sbom.cdx.json"),
        serde_json::to_vec_pretty(&bom).unwrap(),
    )
    .unwrap();
    dir
}

fn verify(cert_path: &Path, sbom_dir: Option<&Path>) -> std::process::Output {
    let mut cmd = Command::new(bin_path("verify-certificate"));
    cmd.arg(cert_path);
    if let Some(d) = sbom_dir {
        cmd.args(["--sbom-dir", d.to_str().unwrap()]);
    }
    cmd.output().expect("spawn verify-certificate")
}

/// AC-2 (emitter side): an authored posture is recorded on the certificate,
/// with `defaulted: false`.
#[test]
fn ac2_authored_posture_is_recorded() {
    let run = run_dir_with_posture(Some(
        "agentic_posture:\n  posture: declared\n  surfaces:\n    - kind: model-api\n      description: chat completion\n",
    ));
    let cert = emit_cert(run.path());
    let binding = cert
        .agentic_posture_binding
        .expect("cert must record the agentic posture binding");
    assert_eq!(binding.posture, "declared");
    assert!(!binding.defaulted, "an authored posture is not defaulted");
    assert_eq!(binding.surfaces.len(), 1);
    assert_eq!(binding.surfaces[0].kind, "model-api");
}

/// AC-2: a Build Spec that omits `agentic_posture` yields a none/defaulted
/// binding, visibly defaulted (never silently equivalent to authored none).
#[test]
fn ac2_omitted_field_is_defaulted_none() {
    let run = run_dir_with_posture(None);
    let cert = emit_cert(run.path());
    let binding = cert
        .agentic_posture_binding
        .expect("cert must record a defaulted posture binding");
    assert_eq!(binding.posture, "none");
    assert!(binding.defaulted, "an omitted field must be marked defaulted");
    assert!(binding.surfaces.is_empty());
}

/// AC-3: a `none` posture contradicted by an `@anthropic-ai/sdk`-class
/// dependency fails `verify-certificate --sbom-dir`, naming the package;
/// a clean BOM passes; declaring the agency passes even with the SDK present.
#[test]
fn ac3_none_posture_falsified_by_sbom() {
    // (a) none + SDK dependency -> exit 1, diagnostic names the package.
    let none_run = run_dir_with_posture(Some("agentic_posture:\n  posture: none\n"));
    let none_cert_dir = none_run.path().to_path_buf();
    emit_cert(&none_cert_dir);
    let cert_path = none_cert_dir.join("governance-certificate.json");

    let with_sdk = sbom_dir_with(&[("react", "18.0.0"), ("@anthropic-ai/sdk", "0.30.0")]);
    let out = verify(&cert_path, Some(with_sdk.path()));
    assert_eq!(
        out.status.code(),
        Some(1),
        "none + SDK must fail verify (stderr: {})",
        String::from_utf8_lossy(&out.stderr)
    );
    let stderr = String::from_utf8_lossy(&out.stderr);
    assert!(
        stderr.contains("@anthropic-ai/sdk") && stderr.contains("contradicted"),
        "diagnostic must name the package + contradiction: {stderr}"
    );

    // (b) same cert, clean BOM -> exit 0 (consistent none, stated-residual notice).
    let clean = sbom_dir_with(&[("react", "18.0.0"), ("express", "4.19.0")]);
    let out = verify(&cert_path, Some(clean.path()));
    assert_eq!(
        out.status.code(),
        Some(0),
        "none + clean BOM must pass (stderr: {})",
        String::from_utf8_lossy(&out.stderr)
    );

    // (c) declared posture + SDK present -> exit 0 (agency acknowledged).
    let declared_run = run_dir_with_posture(Some(
        "agentic_posture:\n  posture: declared\n  surfaces:\n    - kind: model-api\n",
    ));
    emit_cert(declared_run.path());
    let declared_cert = declared_run.path().join("governance-certificate.json");
    let out = verify(&declared_cert, Some(with_sdk.path()));
    assert_eq!(
        out.status.code(),
        Some(0),
        "declared + SDK must pass (stderr: {})",
        String::from_utf8_lossy(&out.stderr)
    );
}
