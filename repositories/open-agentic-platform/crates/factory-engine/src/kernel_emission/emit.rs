// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Bartek Kus
// Spec: specs/167-born-with-spec-spine-kernel/spec.md

//! Kernel emission writer for the adapter-determined fallback path
//! (spec 167 §2.1, FR-001 / FR-002 / FR-009).
//!
//! > **Distribution-shape note (spec 167 self-amend, 2026-06-11).** The
//! > canonical born-with kernel is the published `spec-spine` npm
//! > distribution, materialised by statecraft's Create flow; this Rust path
//! > is the fallback for non-npm adapters (OQ-6). The vendored-binary CI
//! > workflow and the synthetic scaffold-claim spec it used to write are
//! > retired — the npm shape ships CI from the prebuilt template and a
//! > born-clean corpus.
//!
//! `emit_kernel()` writes the kernel files, the tenant Makefile + toolchain
//! manifest (spec 168), and the `.kernel-version` marker. Emission is
//! deterministic in the content-hash sense — two invocations on identical
//! inputs produce hash-equal kernels.

use std::path::{Path, PathBuf};

use chrono::{DateTime, Utc};

use super::gather::{KernelContent, KernelSource, compute_kernel_hash, gather_kernel_content};
use super::templates::{
    TenantGateContext, TenantToolchainContext, render_tenant_makefile, render_tenant_toolchain,
};
use super::version::{
    AdapterIdentity, CertificateToolchainRef, KernelOrigin, KernelVersion, ToolchainMode,
};
use super::KernelEmissionError;

/// FR-005: mode is recorded in `.kernel-version` so propagation knows how
/// the tenant's spine binaries are sourced.
pub use super::version::ToolchainMode as EmissionMode;

/// Configuration for [`emit_kernel`].
#[derive(Debug, Clone)]
pub struct KernelEmissionConfig {
    pub source: KernelSource,
    pub target_root: PathBuf,
    pub adapter: AdapterIdentity,
    /// Reserved for the corpus-less-adapter fallback (spec 167 OQ-1): the
    /// synthetic scaffold-claim generator that consumed these is retired (the
    /// npm shape ships a born-clean corpus), so `emit_kernel` no longer reads
    /// them. Kept on the config so a future fallback generator can populate
    /// the seed-spec `establishes:` block (spec 154) without an API break.
    pub scaffolded_paths: Vec<String>,
    /// Reserved for the corpus-less-adapter fallback (spec 167 OQ-1); see
    /// `scaffolded_paths`. Was the adapter-manifest URI a seed spec would
    /// reference (spec 161).
    pub adapter_manifest_uri: Option<String>,
    /// Toolchain distribution mode (FR-005).
    pub toolchain_mode: ToolchainMode,
    /// OAP source commit SHA to record in `.kernel-version`. Empty
    /// string when emission runs outside a git working tree.
    pub source_commit: String,
    /// Timestamp recorded into `.kernel-version`. Defaults to `Utc::now()`
    /// when the caller passes `None`. Excluded from hash determinism.
    pub emitted_at: Option<DateTime<Utc>>,
    /// Override the rendered tenant CI / Makefile context. Defaults to
    /// [`TenantGateContext::default`].
    pub gate_context: Option<TenantGateContext>,
}

/// Report returned by [`emit_kernel`] — the full list of relative paths
/// that were written, plus the kernel content hash that landed in
/// `.kernel-version`.
#[derive(Debug, Clone)]
pub struct KernelEmissionReport {
    pub kernel_hash: String,
    pub written_paths: Vec<PathBuf>,
    pub kernel_version: KernelVersion,
}

/// Emit a born-with spec-spine kernel into `target_root`.
///
/// The target root must exist and either be empty or contain only
/// dotfiles the tenant created before the kernel landed (the caller
/// chooses the target; the writer refuses to overwrite preexisting
/// non-empty kernel structures — see [`KernelEmissionError::TargetNotEmpty`]).
pub fn emit_kernel(
    cfg: &KernelEmissionConfig,
) -> Result<KernelEmissionReport, KernelEmissionError> {
    let content = gather_kernel_content(&cfg.source)?;
    let kernel_hash = compute_kernel_hash(&content);

    if !cfg.target_root.exists() {
        std::fs::create_dir_all(&cfg.target_root)?;
    }

    refuse_existing_kernel(&cfg.target_root)?;

    let mut written: Vec<PathBuf> = Vec::new();

    // 1-3. Write gathered kernel content (spec 000, standards/spec/**,
    // pre-compiled registry.json).
    write_kernel_content(&cfg.target_root, &content, &mut written)?;

    // 4. .kernel-version — records origin + adapter + toolchain mode
    //    AND, since spec 168, the certificate emitter/verifier identity
    //    (FR-001 / FR-008).
    let emitted_at = cfg.emitted_at.unwrap_or_else(Utc::now);
    let factory_engine_version = env!("CARGO_PKG_VERSION").to_string();
    let kernel_version = KernelVersion {
        kernel: KernelOrigin {
            source_commit: cfg.source_commit.clone(),
            source_hash: kernel_hash.clone(),
            factory_engine_version: factory_engine_version.clone(),
            emitted_at,
            // The non-npm engine fallback (OQ-6) carries no npm pin; the npm
            // distribution path stamps spec_spine_version via statecraft's TS
            // Create flow (spec 209 FR-004 / kernelVersionStamp.ts).
            spec_spine_version: None,
        },
        adapter: cfg.adapter.clone(),
        toolchain_mode: cfg.toolchain_mode,
        certificate_toolchain: Some(CertificateToolchainRef::for_version(
            &factory_engine_version,
        )),
    };
    let yaml = kernel_version
        .to_yaml()
        .map_err(|e| KernelEmissionError::Serialization(e.to_string()))?;
    write_file(&cfg.target_root, Path::new(".kernel-version"), yaml.as_bytes(), &mut written)?;

    // 5. Tenant Makefile target. (The vendored-binary CI workflow template
    //    was retired — the npm born-with kernel ships CI from the prebuilt
    //    template's `spec-spine.yml`; spec 167 self-amend.)
    let gate_ctx = cfg.gate_context.clone().unwrap_or_default();
    let makefile = render_tenant_makefile(&gate_ctx)?;
    write_file(
        &cfg.target_root,
        Path::new("Makefile"),
        makefile.as_bytes(),
        &mut written,
    )?;

    // 6. Spec 168 — `.factory/toolchain.yaml` with emitter / verifier
    //    pin (FR-001). Written regardless of distribution mode: in
    //    `vendor-binaries` mode the `install` block is documentation,
    //    and in `pinned-toolchain` mode the tenant CI uses it directly.
    let toolchain_ctx = TenantToolchainContext::new(
        &gate_ctx,
        &factory_engine_version,
        match cfg.toolchain_mode {
            ToolchainMode::VendorBinaries => "vendor-binaries",
            ToolchainMode::PinnedToolchain => "pinned-toolchain",
        },
    );
    let toolchain_yaml = render_tenant_toolchain(&toolchain_ctx)?;
    write_file(
        &cfg.target_root,
        Path::new(".factory/toolchain.yaml"),
        toolchain_yaml.as_bytes(),
        &mut written,
    )?;

    // (The adapter-seeded scaffold-claim spec draft was retired — spec 167
    //  OQ-1. The npm born-with kernel ships a born-clean corpus from the
    //  prebuilt template; a corpus-less-adapter fallback is spec-text only.)

    written.sort();

    Ok(KernelEmissionReport {
        kernel_hash,
        written_paths: written,
        kernel_version,
    })
}

fn write_kernel_content(
    target_root: &Path,
    content: &KernelContent,
    written: &mut Vec<PathBuf>,
) -> Result<(), KernelEmissionError> {
    for entry in &content.entries {
        write_file(target_root, &entry.relative_path, &entry.bytes, written)?;
    }
    Ok(())
}

fn write_file(
    target_root: &Path,
    rel: &Path,
    bytes: &[u8],
    written: &mut Vec<PathBuf>,
) -> Result<(), KernelEmissionError> {
    let abs = target_root.join(rel);
    if let Some(parent) = abs.parent() {
        std::fs::create_dir_all(parent)?;
    }
    std::fs::write(&abs, bytes)?;
    written.push(rel.to_path_buf());
    Ok(())
}

fn refuse_existing_kernel(target_root: &Path) -> Result<(), KernelEmissionError> {
    // The target is considered "already kernelled" if `.kernel-version`
    // or `specs/000-bootstrap-spec-system/spec.md` already exists. The
    // born-with channel is one-shot at project birth; mid-life
    // re-emission is the kernel-update propagation spec's concern.
    let markers = [
        target_root.join(".kernel-version"),
        target_root.join("specs/000-bootstrap-spec-system/spec.md"),
    ];
    for m in markers {
        if m.exists() {
            return Err(KernelEmissionError::TargetNotEmpty(m.display().to_string()));
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn write_source_fixture(root: &Path) {
        for (rel, body) in &[
            (
                "specs/000-bootstrap-spec-system/spec.md",
                "# spec 000\n",
            ),
            ("standards/spec/constitution.md", "# c\n"),
            ("standards/spec/contract.md", "# k\n"),
            (
                "standards/spec/templates/spec-template.md",
                "# tmpl\n",
            ),
            (
                ".derived/spec-registry/registry.json",
                r#"{"specVersion":"0.1.0","specs":[]}"#,
            ),
        ] {
            let p = root.join(rel);
            fs::create_dir_all(p.parent().unwrap()).unwrap();
            fs::write(p, body).unwrap();
        }
    }

    fn fixed_timestamp() -> DateTime<Utc> {
        use chrono::TimeZone;
        Utc.with_ymd_and_hms(2026, 5, 23, 12, 0, 0).unwrap()
    }

    fn make_config(source_root: &Path, target_root: PathBuf) -> KernelEmissionConfig {
        KernelEmissionConfig {
            source: KernelSource::from_repo_root(source_root.to_path_buf()),
            target_root,
            adapter: AdapterIdentity {
                id: "acme-vue-encore".into(),
                version: "0.1.0".into(),
                manifest_hash: "abc".into(),
            },
            scaffolded_paths: vec!["apps/".into(), "packages/".into()],
            adapter_manifest_uri: Some("file://adapter-scopes.json#acme-vue-encore".into()),
            toolchain_mode: ToolchainMode::VendorBinaries,
            source_commit: "deadbeefcafef00d".into(),
            emitted_at: Some(fixed_timestamp()),
            gate_context: None,
        }
    }

    #[test]
    fn emits_full_kernel_layout() {
        let source = tempfile::tempdir().unwrap();
        write_source_fixture(source.path());
        let target = tempfile::tempdir().unwrap();
        let cfg = make_config(source.path(), target.path().to_path_buf());

        let report = emit_kernel(&cfg).unwrap();

        for rel in &[
            "specs/000-bootstrap-spec-system/spec.md",
            "standards/spec/constitution.md",
            "standards/spec/contract.md",
            "standards/spec/templates/spec-template.md",
            ".derived/spec-registry/registry.json",
            ".kernel-version",
            "Makefile",
            ".factory/toolchain.yaml",
        ] {
            let abs = target.path().join(rel);
            assert!(abs.exists(), "missing emitted file: {rel}");
            assert!(report.written_paths.iter().any(|p| p == Path::new(rel)));
        }

        // The retired surfaces are NOT emitted (spec 167 self-amend): the
        // vendored-binary CI workflow and the synthetic scaffold-claim spec.
        assert!(!target.path().join(".github/workflows/ci-spec-code-coupling.yml").exists());
        assert!(!target.path().join("specs/001-acme-vue-encore-scaffold-claim/spec.md").exists());

        // `.kernel-version` round-trips back to the struct we wrote.
        let yaml = fs::read_to_string(target.path().join(".kernel-version")).unwrap();
        let parsed = KernelVersion::from_yaml(&yaml).unwrap();
        assert_eq!(parsed.kernel.source_commit, "deadbeefcafef00d");
        assert_eq!(parsed.kernel.source_hash, report.kernel_hash);
        assert_eq!(parsed.adapter.id, "acme-vue-encore");
        assert_eq!(parsed.toolchain_mode, ToolchainMode::VendorBinaries);
    }

    #[test]
    fn deterministic_emission_yields_hash_equal_kernels() {
        // FR-009: re-running on the same inputs produces an identical
        // kernel hash and an identical content-hash signature for the
        // copied tree.
        let source = tempfile::tempdir().unwrap();
        write_source_fixture(source.path());

        let target_a = tempfile::tempdir().unwrap();
        let target_b = tempfile::tempdir().unwrap();
        let cfg_a = make_config(source.path(), target_a.path().to_path_buf());
        let cfg_b = make_config(source.path(), target_b.path().to_path_buf());

        let report_a = emit_kernel(&cfg_a).unwrap();
        let report_b = emit_kernel(&cfg_b).unwrap();

        assert_eq!(report_a.kernel_hash, report_b.kernel_hash);

        // Every kernel-content path is byte-identical across the two targets.
        // We compare only the gathered kernel files (the .kernel-version
        // file embeds the wall-clock timestamp, which is excluded from
        // determinism per the spec).
        for rel in &[
            "specs/000-bootstrap-spec-system/spec.md",
            "standards/spec/constitution.md",
            "standards/spec/contract.md",
            "standards/spec/templates/spec-template.md",
            ".derived/spec-registry/registry.json",
        ] {
            let a = fs::read(target_a.path().join(rel)).unwrap();
            let b = fs::read(target_b.path().join(rel)).unwrap();
            assert_eq!(a, b, "byte mismatch in deterministic emission for {rel}");
        }
    }

    #[test]
    fn refuses_to_overwrite_existing_kernel() {
        let source = tempfile::tempdir().unwrap();
        write_source_fixture(source.path());
        let target = tempfile::tempdir().unwrap();
        let cfg = make_config(source.path(), target.path().to_path_buf());

        // First emission succeeds.
        emit_kernel(&cfg).unwrap();
        // Second emission into the same target refuses.
        let err = emit_kernel(&cfg).unwrap_err();
        assert!(matches!(err, KernelEmissionError::TargetNotEmpty(_)));
    }

    #[test]
    fn missing_source_propagates_error() {
        let target = tempfile::tempdir().unwrap();
        let source_dir = tempfile::tempdir().unwrap();
        // Don't populate source_dir; spec 000 is missing.
        let cfg = make_config(source_dir.path(), target.path().to_path_buf());
        let err = emit_kernel(&cfg).unwrap_err();
        assert!(matches!(err, KernelEmissionError::SourceIncomplete(_)));
    }

    // ── spec 168 §FR-001 / §FR-008 — kernel ships toolchain ref ──

    #[test]
    fn kernel_emits_factory_toolchain_yaml_referencing_cert_binaries() {
        let source = tempfile::tempdir().unwrap();
        write_source_fixture(source.path());
        let target = tempfile::tempdir().unwrap();
        let cfg = make_config(source.path(), target.path().to_path_buf());

        let report = emit_kernel(&cfg).unwrap();

        let toolchain_path = target.path().join(".factory/toolchain.yaml");
        assert!(
            toolchain_path.exists(),
            "kernel must emit .factory/toolchain.yaml (spec 168 FR-001)"
        );
        assert!(
            report
                .written_paths
                .iter()
                .any(|p| p == Path::new(".factory/toolchain.yaml")),
            "written_paths must include the toolchain manifest"
        );

        let body = fs::read_to_string(&toolchain_path).unwrap();
        assert!(body.contains("build-certificate"));
        assert!(body.contains("verify-certificate"));
        assert!(body.contains("vendor-binaries"));
    }

    #[test]
    fn kernel_version_records_certificate_toolchain_field() {
        let source = tempfile::tempdir().unwrap();
        write_source_fixture(source.path());
        let target = tempfile::tempdir().unwrap();
        let cfg = make_config(source.path(), target.path().to_path_buf());

        let report = emit_kernel(&cfg).unwrap();

        let cert_tc = report
            .kernel_version
            .certificate_toolchain
            .as_ref()
            .expect("certificate_toolchain must be populated (spec 168 FR-008)");
        assert_eq!(cert_tc.emitter, "build-certificate");
        assert_eq!(cert_tc.verifier, "verify-certificate");
        assert_eq!(
            cert_tc.factory_engine_version,
            env!("CARGO_PKG_VERSION"),
        );

        let yaml = fs::read_to_string(target.path().join(".kernel-version")).unwrap();
        assert!(yaml.contains("certificate_toolchain"));
        assert!(yaml.contains("emitter: build-certificate"));
        assert!(yaml.contains("verifier: verify-certificate"));
    }

    #[test]
    fn kernel_toolchain_yaml_reflects_pinned_mode_when_selected() {
        let source = tempfile::tempdir().unwrap();
        write_source_fixture(source.path());
        let target = tempfile::tempdir().unwrap();
        let mut cfg = make_config(source.path(), target.path().to_path_buf());
        cfg.toolchain_mode = ToolchainMode::PinnedToolchain;

        emit_kernel(&cfg).unwrap();

        let body =
            fs::read_to_string(target.path().join(".factory/toolchain.yaml")).unwrap();
        assert!(body.contains("mode: \"pinned-toolchain\""));
        assert!(!body.contains("mode: \"vendor-binaries\""));
    }
}
