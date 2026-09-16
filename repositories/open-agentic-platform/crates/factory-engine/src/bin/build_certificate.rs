// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Bartek Kus
// Spec: specs/102-governed-excellence/spec.md — FR-003, FR-009
// Spec: specs/168-per-project-governance-certificate/spec.md — FR-001, FR-002, FR-003, FR-007

//! CLI to build a governance certificate from an existing factory run
//! directory, without re-running the pipeline.
//!
//! Useful for retroactive certification (auditor receives a run directory
//! and wants the certificate) and for the `make build-certificate FILE=...`
//! demo flow that pairs with `verify-certificate` to close the OWASP ASI
//! traceability story end-to-end.
//!
//! The run directory layout matches the orchestrator's `ArtifactManager`:
//! `<run-dir>/<step-id>/<artifact-files>`. The build-spec hash is derived
//! from `<run-dir>/s5-ui-specification/build-spec.yaml` when present.
//!
//! Tenant emission (spec 168):
//!   - `--tenant-mode` enables FR-007 (halt-if-no-signer); the binary
//!     exits with code 2 and a specific diagnostic if no signer is
//!     supplied.
//!   - `--signer-subject` / `--signer-identity-provider` (+ optional
//!     `--signer-session-id`) bind the principal's identity into the
//!     certificate's new `signer` field (FR-003).
//!   - `--stage-ids` overrides the OAP-default s0..s5 stage list with a
//!     comma-separated list the tenant pipeline actually emits (§2.4).
//!     Pass `--stage-ids=auto` (or any single-token value `auto`) to
//!     trigger filesystem discovery (lexicographic order over
//!     `<run-dir>/`'s subdirectories).
//!
//! Spec 220 (tenant emit, R-2):
//!   - `--require-operator-key` refuses the ephemeral signing-key fallback:
//!     the binary exits non-zero if signing material resolves to an
//!     ephemeral key rather than an operator-supplied one (OAP_SIGNING_KEY
//!     / OAP_SIGNING_KEY_PATH). Production tenant emission must pass this;
//!     OAP's own dev runs do not (FR-003).
//!   - `--corpus-attestation <path>` (or the OAP_CORPUS_ATTESTATION_PATH env
//!     var) binds a spec-spine CorpusAttestation into the certificate by
//!     hash (read, never recompute), mirroring the factory_run.rs read-path
//!     (spec 218 FR-002). Applied on the tenant (signer) build path (FR-007).
//!
//! Usage:
//!   build-certificate <run-dir> \
//!     [--adapter <name>] [--requirements-hash <hash>] \
//!     [--business-docs <path> ...] [--out <path>] \
//!     [--tenant-mode] \
//!     [--signer-subject <subject> --signer-identity-provider <provider>] \
//!     [--signer-session-id <id>] \
//!     [--stage-ids <comma-sep-or-auto>]

use clap::Parser;
use factory_engine::{
    CertificateBuilder, CertificateBuildError, FactoryPipelineState, OAP_STAGE_IDS, Signer,
    generate_certificate_with_stage_ids,
    governance_certificate::{
        AgenticPostureBinding, ChainIntegrity, CorpusBinding, IntentRecord, ProofChainSummary,
        SBOM_AUDIT_RELPATH, SBOM_BOM_RELPATH, SbomArtifactBinding, SigningAttestationKind,
        VerificationOutcome, VerificationRecord, sha256_bytes, sha256_file,
    },
    persist_certificate, validate_spec_id_resolution, write_validation_warnings,
};
use sha2::{Digest, Sha256};
use std::path::PathBuf;

#[derive(Parser)]
#[command(
    name = "build-certificate",
    about = "Build a governance certificate from a factory run directory (spec 102 FR-003; spec 168 FR-002)"
)]
struct Cli {
    /// Path to the factory run directory (`.factory/runs/<run_id>`).
    run_dir: PathBuf,

    /// Adapter name. Defaults to `unknown` if not supplied.
    #[arg(long, default_value = "unknown")]
    adapter: String,

    /// SHA-256 of the input requirements documents. If `--business-docs`
    /// is supplied, the hash is computed from those files and this flag
    /// is ignored.
    #[arg(long)]
    requirements_hash: Option<String>,

    /// Optional requirement document paths. When supplied, their concatenated
    /// SHA-256 is recorded as `intent.requirementsHash`.
    #[arg(long, num_args = 1..)]
    business_docs: Vec<PathBuf>,

    /// Override certificate output path. Defaults to
    /// `<run-dir>/governance-certificate.json`.
    #[arg(long)]
    out: Option<PathBuf>,

    /// Repository root used to locate `build/spec-registry/registry.json`
    /// for `intent.spec_id` resolution validation (Cut D W-10 / spec 102 G-2).
    /// Defaults to the current working directory.
    #[arg(long)]
    repo_root: Option<PathBuf>,

    /// Spec 168 §FR-007 — when set, the binary halts before emission if
    /// no signer is provided. Required for tenant-emit runs.
    #[arg(long, default_value_t = false)]
    tenant_mode: bool,

    /// Spec 168 §FR-003 — principal identifier (typically a Rauthy JWT
    /// subject for human-driven tenant runs).
    #[arg(long)]
    signer_subject: Option<String>,

    /// Spec 168 §FR-003 — system that attested the subject (e.g.
    /// `rauthy@<tenant-org>` or `github-actions@<repo>`).
    #[arg(long)]
    signer_identity_provider: Option<String>,

    /// Spec 168 §FR-003 — optional run-scoped session id.
    #[arg(long)]
    signer_session_id: Option<String>,

    /// Spec 168 §2.4 — comma-separated stage IDs to record in the
    /// certificate, in the given order. Use `auto` to trigger
    /// filesystem discovery (every subdirectory of `<run-dir>`,
    /// lexicographic). Omit to use OAP's default s0..s5 list.
    #[arg(long)]
    stage_ids: Option<String>,

    /// Spec 220 FR-003: refuse the ephemeral signing-key fallback. When set,
    /// the binary exits non-zero (code 2) if signing material resolves to an
    /// ephemeral key rather than an operator-supplied one (OAP_SIGNING_KEY /
    /// OAP_SIGNING_KEY_PATH). A production tenant emission must pass this so
    /// it can never silently emit an untrusted certificate; OAP's own dev /
    /// CI runs leave it off.
    #[arg(long, default_value_t = false)]
    require_operator_key: bool,

    /// Spec 220 FR-007: path to a spec-spine CorpusAttestation JSON to bind
    /// into the certificate by hash (read, never recompute). Falls back to
    /// the OAP_CORPUS_ATTESTATION_PATH env var. Applied on the tenant
    /// (signer) build path; mirrors the factory_run.rs read-path.
    #[arg(long)]
    corpus_attestation: Option<PathBuf>,

    /// Spec 203 FR-003: produced-app root whose `.factory/sbom.cdx.json` and
    /// `.factory/audit.json` are bound into the certificate by content hash
    /// (read, never recompute). Falls back to the OAP_SBOM_DIR env var. Applied
    /// on the tenant (signer) build path. The BOM tool version is read from the
    /// BOM's own `metadata.tools`. When unset (or a file is unreadable) the cert
    /// is emitted unbound, exactly like the corpus binding.
    #[arg(long)]
    sbom_dir: Option<PathBuf>,
}

fn main() {
    let cli = Cli::parse();

    if !cli.run_dir.is_dir() {
        eprintln!(
            "error: run directory does not exist: {}",
            cli.run_dir.display()
        );
        std::process::exit(2);
    }

    let pipeline_id = cli
        .run_dir
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("unknown")
        .to_string();

    let mut state = FactoryPipelineState::new(&pipeline_id, &cli.adapter);

    // Lift the build-spec hash from disk if the frozen artifact is present.
    let build_spec_path = cli
        .run_dir
        .join("s5-ui-specification")
        .join("build-spec.yaml");
    if build_spec_path.is_file() {
        match sha256_file(&build_spec_path) {
            Ok(hash) => state.transition_to_scaffolding(hash),
            Err(e) => eprintln!(
                "warning: could not hash build-spec at {}: {e}",
                build_spec_path.display()
            ),
        }
    }

    let requirements_hash = if !cli.business_docs.is_empty() {
        let mut hasher = Sha256::new();
        for p in &cli.business_docs {
            match std::fs::read(p) {
                Ok(bytes) => hasher.update(&bytes),
                Err(e) => {
                    eprintln!("warning: could not read {}: {e}", p.display());
                }
            }
        }
        format!("{:x}", hasher.finalize())
    } else {
        cli.requirements_hash.clone().unwrap_or_default()
    };

    let signer = match build_signer(&cli) {
        Ok(s) => s,
        Err(e) => {
            eprintln!("error: {e}");
            std::process::exit(2);
        }
    };

    if cli.tenant_mode && signer.is_none() {
        eprintln!(
            "error: --tenant-mode requires --signer-subject and \
             --signer-identity-provider (spec 168 FR-007: anonymous \
             signing forbidden — a run with no identifiable signer halts \
             before emitting)"
        );
        std::process::exit(2);
    }

    let corpus_binding = resolve_corpus_binding(&cli);
    let sbom_binding = resolve_sbom_binding(&cli);
    let posture_binding = resolve_posture_binding(&cli);

    let cert = match build_certificate(
        &cli,
        &state,
        &requirements_hash,
        signer,
        corpus_binding,
        sbom_binding,
        posture_binding,
    ) {
        Ok(c) => c,
        Err(e) => {
            eprintln!("error: {e}");
            std::process::exit(2);
        }
    };

    // Spec 220 FR-003: a production tenant emission must use an operator key.
    // The cert is built but not yet persisted, so exiting here writes nothing.
    if cli.require_operator_key
        && matches!(cert.signing_attestation.kind, SigningAttestationKind::Ephemeral)
    {
        eprintln!(
            "error: --require-operator-key was set but the signing material \
             resolved to an ephemeral key (spec 220 FR-003). A production \
             tenant emission must supply an operator key via OAP_SIGNING_KEY \
             or OAP_SIGNING_KEY_PATH; refusing to emit an untrusted certificate."
        );
        std::process::exit(2);
    }

    let out_dir = match cli.out.as_ref() {
        Some(p) => p
            .parent()
            .map(PathBuf::from)
            .unwrap_or_else(|| PathBuf::from(".")),
        None => cli.run_dir.clone(),
    };

    if let Err(e) = persist_certificate(&cert, &out_dir) {
        eprintln!("error: failed to persist certificate at {}: {e}", out_dir.display());
        std::process::exit(1);
    }

    let cert_path = out_dir.join("governance-certificate.json");
    println!(
        "governance certificate written: {} (status={:?}, stages={}, hash={}…)",
        cert_path.display(),
        cert.status,
        cert.stages.len(),
        &cert.certificate_hash[..16]
    );

    let repo_root = cli
        .repo_root
        .clone()
        .or_else(|| std::env::current_dir().ok())
        .unwrap_or_else(|| PathBuf::from("."));
    let warnings = validate_spec_id_resolution(&cert, &repo_root);
    match write_validation_warnings(&warnings, &cert_path) {
        Ok(Some(p)) => eprintln!(
            "validation warnings written: {} ({} warning(s))",
            p.display(),
            warnings.len()
        ),
        Ok(None) => {}
        Err(e) => eprintln!(
            "warning: failed to write validation warnings next to {}: {e}",
            cert_path.display()
        ),
    }
}

/// Env var carrying the path to a spec-spine `CorpusAttestation` JSON
/// (spec 220 FR-007, mirroring factory_run.rs / spec 218 FR-002). When set
/// (or `--corpus-attestation` is passed), the cert is bound to the
/// attestation's hash; when unset, the cert is emitted unbound.
const ENV_CORPUS_ATTESTATION_PATH: &str = "OAP_CORPUS_ATTESTATION_PATH";

/// Spec 220 FR-007: resolve the corpus binding from `--corpus-attestation`
/// or the `OAP_CORPUS_ATTESTATION_PATH` env var. Read, never recompute: the
/// supplied `CorpusAttestation` payload is hashed via the public
/// `spec_spine_core::attest::attestation_hash` reader seam; the emitter never
/// compiles or re-attests the corpus. Returns `None` (cert stays unbound)
/// when no path is given or the artifact is unreadable / malformed; failures
/// warn but never block emission (an unbound cert beats no cert).
fn resolve_corpus_binding(cli: &Cli) -> Option<CorpusBinding> {
    let path: String = cli
        .corpus_attestation
        .as_ref()
        .map(|p| p.to_string_lossy().into_owned())
        .or_else(|| std::env::var(ENV_CORPUS_ATTESTATION_PATH).ok())?;
    let raw = match std::fs::read_to_string(&path) {
        Ok(r) => r,
        Err(e) => {
            eprintln!("warning: corpus attestation {path} unreadable: {e} (cert unbound)");
            return None;
        }
    };
    let attestation: spec_spine_types::attest::CorpusAttestation =
        match serde_json::from_str(&raw) {
            Ok(a) => a,
            Err(e) => {
                eprintln!("warning: {path} is not a CorpusAttestation: {e} (cert unbound)");
                return None;
            }
        };
    match spec_spine_core::attest::attestation_hash(&attestation) {
        Ok(hash) => Some(CorpusBinding {
            corpus_attestation_hash: hash,
            spec_spine_version: attestation.tool.version,
        }),
        Err(e) => {
            eprintln!("warning: attestation_hash failed: {e} (cert unbound)");
            None
        }
    }
}

/// Env var carrying the produced-app root whose `.factory/sbom.cdx.json` and
/// `.factory/audit.json` are bound into the certificate (spec 203 FR-003).
/// Alternative to `--sbom-dir`.
const ENV_SBOM_DIR: &str = "OAP_SBOM_DIR";

/// Spec 203 FR-003: resolve the SBOM artifact binding from `--sbom-dir` or the
/// `OAP_SBOM_DIR` env var. Read, never recompute: the produced BOM and audit
/// artifacts are hashed as bytes; the emitter never regenerates the BOM. The
/// BOM tool version is read from the BOM's own `metadata.tools`. Returns `None`
/// (cert stays unbound) when no dir is given or either artifact is unreadable;
/// failures warn but never block emission (an unbound cert beats no cert),
/// mirroring `resolve_corpus_binding`.
fn resolve_sbom_binding(cli: &Cli) -> Option<SbomArtifactBinding> {
    let root: PathBuf = cli
        .sbom_dir
        .clone()
        .or_else(|| std::env::var(ENV_SBOM_DIR).ok().map(PathBuf::from))?;
    let bom_path = root.join(SBOM_BOM_RELPATH);
    let audit_path = root.join(SBOM_AUDIT_RELPATH);
    let bom_bytes = match std::fs::read(&bom_path) {
        Ok(b) => b,
        Err(e) => {
            eprintln!(
                "warning: SBOM {} unreadable: {e} (cert unbound)",
                bom_path.display()
            );
            return None;
        }
    };
    let audit_hash = match sha256_file(&audit_path) {
        Ok(h) => h,
        Err(e) => {
            eprintln!(
                "warning: audit artifact {} unreadable: {e} (cert unbound)",
                audit_path.display()
            );
            return None;
        }
    };
    Some(SbomArtifactBinding {
        bom_hash: sha256_bytes(&bom_bytes),
        audit_hash,
        bom_tool_version: read_bom_tool_version(&bom_bytes),
    })
}

/// Spec 210 FR-002: resolve the agentic-posture binding from the frozen Build
/// Spec at `<run-dir>/s5-ui-specification/build-spec.yaml` (read, never
/// recompute). Returns:
/// - `None` when no Build Spec is present or it does not parse (the posture is
///   left UNSTATED on the cert, never silently equivalent to authored `none`).
/// - `Some(none/defaulted)` when the Build Spec is read but omits
///   `agentic_posture` ("nobody asked").
/// - `Some(authored)` when the Build Spec declares a posture.
///
/// Bound on the tenant (signer) build path, mirroring `resolve_sbom_binding`:
/// the posture is a property of the produced application, whose trust artifact
/// is the tenant certificate.
fn resolve_posture_binding(cli: &Cli) -> Option<AgenticPostureBinding> {
    let build_spec_path = cli
        .run_dir
        .join("s5-ui-specification")
        .join("build-spec.yaml");
    let raw = std::fs::read_to_string(&build_spec_path).ok()?;
    let build_spec: factory_contracts::build_spec::BuildSpec = match serde_yaml::from_str(&raw) {
        Ok(bs) => bs,
        Err(e) => {
            eprintln!(
                "warning: Build Spec at {} did not parse for agentic_posture: {e} \
                 (posture unstated)",
                build_spec_path.display()
            );
            return None;
        }
    };
    Some(AgenticPostureBinding::from_build_spec(
        build_spec.agentic_posture.as_ref(),
    ))
}

/// Read the BOM generator's version from a CycloneDX BOM's `metadata.tools`,
/// tolerating both the 1.5+ `tools.components[]` shape and the legacy `tools[]`
/// array. Prefers a tool whose name contains "cyclonedx"; falls back to the
/// first entry carrying a version, then to "unknown". Reading one field for
/// provenance does not recompute the BOM: the byte hash above still spans the
/// full file.
fn read_bom_tool_version(bom_bytes: &[u8]) -> String {
    let Ok(v) = serde_json::from_slice::<serde_json::Value>(bom_bytes) else {
        return "unknown".to_string();
    };
    let tools = &v["metadata"]["tools"];
    let entries = tools["components"].as_array().or_else(|| tools.as_array());
    if let Some(arr) = entries {
        let pick = arr
            .iter()
            .find(|c| {
                c["name"]
                    .as_str()
                    .is_some_and(|n| n.to_ascii_lowercase().contains("cyclonedx"))
            })
            .or_else(|| arr.iter().find(|c| c["version"].is_string()));
        if let Some(ver) = pick.and_then(|c| c["version"].as_str()) {
            return ver.to_string();
        }
    }
    "unknown".to_string()
}

/// Parse the signer flags, returning `Ok(None)` when no signer was supplied,
/// `Ok(Some(_))` when fully populated, and an error string when partial.
fn build_signer(cli: &Cli) -> Result<Option<Signer>, String> {
    match (
        cli.signer_subject.as_deref(),
        cli.signer_identity_provider.as_deref(),
    ) {
        (None, None) => Ok(None),
        (Some(_), None) => Err(
            "--signer-subject requires --signer-identity-provider \
             (spec 168 FR-003)"
                .into(),
        ),
        (None, Some(_)) => Err(
            "--signer-identity-provider requires --signer-subject \
             (spec 168 FR-003)"
                .into(),
        ),
        (Some(subject), Some(provider)) => {
            let mut s = Signer::new(subject, provider).map_err(|e| e.to_string())?;
            if let Some(sid) = cli.signer_session_id.as_deref() {
                s = s.with_session_id(sid);
            }
            Ok(Some(s))
        }
    }
}

/// Build the certificate, dispatching on stage_ids and tenant_mode flags.
fn build_certificate(
    cli: &Cli,
    state: &FactoryPipelineState,
    requirements_hash: &str,
    signer: Option<Signer>,
    corpus_binding: Option<CorpusBinding>,
    sbom_binding: Option<SbomArtifactBinding>,
    posture_binding: Option<AgenticPostureBinding>,
) -> Result<factory_engine::GovernanceCertificate, String> {
    if signer.is_none() && corpus_binding.is_some() {
        eprintln!(
            "warning: a corpus attestation was supplied but no signer; corpus \
             binding is applied only on the tenant (signer) build path (spec \
             220 FR-007). Emitting without corpus binding."
        );
    }
    if signer.is_none() && sbom_binding.is_some() {
        eprintln!(
            "warning: an SBOM directory was supplied but no signer; the SBOM \
             binding is applied only on the tenant (signer) build path (spec \
             203 FR-003). Emitting without SBOM binding."
        );
    }

    let stage_ids_owned: Option<Vec<String>> = cli
        .stage_ids
        .as_deref()
        .filter(|s| !s.eq_ignore_ascii_case("auto"))
        .map(|s| s.split(',').map(|t| t.trim().to_string()).collect());

    // No signer + no custom stages → keep the existing fast path.
    if signer.is_none() && cli.stage_ids.is_none() {
        return Ok(generate_certificate_with_stage_ids(
            state,
            requirements_hash,
            &cli.run_dir,
            None,
            OAP_STAGE_IDS,
        ));
    }

    // Build via the builder so we can attach signer + tenant stage IDs.
    let stage_ids_slice: Vec<&str> = match stage_ids_owned.as_ref() {
        Some(v) => v.iter().map(|s| s.as_str()).collect(),
        // `--stage-ids auto` or no explicit list with a signer attached —
        // default to filesystem discovery for tenant mode so we don't
        // silently bake OAP's s0..s5 list into a tenant certificate.
        None if cli.tenant_mode || cli.stage_ids.is_some() => Vec::new(),
        None => OAP_STAGE_IDS.to_vec(),
    };

    let cert = generate_certificate_with_stage_ids(
        state,
        requirements_hash,
        &cli.run_dir,
        None,
        &stage_ids_slice,
    );

    if let Some(signer) = signer {
        // Re-bake the certificate via the builder so the signer is
        // present in the canonical content the hash + signature attest.
        let intent = IntentRecord {
            requirements_hash: requirements_hash.to_string(),
            spec_id: None,
            spec_hash: None,
        };
        let proof_chain = ProofChainSummary {
            record_count: 0,
            first_record_hash: None,
            last_record_hash: None,
            chain_integrity: ChainIntegrity::Empty,
        };
        let verification = VerificationRecord {
            compile: VerificationOutcome::Skipped,
            test: VerificationOutcome::Skipped,
            lint: VerificationOutcome::Skipped,
            typecheck: VerificationOutcome::Skipped,
            security_scan: VerificationOutcome::Skipped,
        };
        let mut builder = CertificateBuilder::new(&state.pipeline_id, intent)
            .build_spec_hash(state.build_spec_hash.clone().unwrap_or_default())
            .stages(cert.stages.clone())
            .verification(verification)
            .proof_chain(proof_chain)
            .signer(signer);
        // Spec 220 FR-007: bind the tenant's corpus attestation (read, never
        // recompute) when one was supplied.
        if let Some(cb) = corpus_binding {
            builder = builder.corpus_binding(cb.corpus_attestation_hash, cb.spec_spine_version);
        }
        // Spec 203 FR-003: bind the produced app's SBOM + audit artifact hashes
        // (read, never recompute) when a --sbom-dir was supplied.
        if let Some(sb) = sbom_binding {
            builder = builder.sbom_artifact_binding(sb.bom_hash, sb.audit_hash, sb.bom_tool_version);
        }
        // Spec 210 FR-002: bind the produced app's declared agentic posture,
        // read off the frozen Build Spec (read, never recompute). Present
        // whenever a Build Spec was read: an omitted `agentic_posture` binds
        // `none`/`defaulted: true` (visibly defaulted, never silently equivalent
        // to authored `none`).
        if let Some(pb) = posture_binding {
            builder = builder.agentic_posture_binding(pb);
        }
        let signed = builder
            .build_tenant()
            .map_err(|e: CertificateBuildError| e.to_string())?;
        return Ok(signed);
    }

    Ok(cert)
}
