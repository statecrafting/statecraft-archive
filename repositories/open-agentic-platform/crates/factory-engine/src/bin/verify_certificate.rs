// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Bartek Kus
// Spec: specs/102-governed-excellence/spec.md — FR-007
// Spec: specs/198-factory-governance-envelope/spec.md — FR-014 (platform seal)

//! CLI to independently verify a governance certificate.
//!
//! Exits 0 if the certificate is valid, 1 if any mismatch is detected.
//!
//! Usage:
//!   verify-certificate <path-to-certificate.json> [--artifact-dir <dir>]
//!       [--platform-jwks <file> | --jwks-url <url>] [--require-sealed]
//!
//! The offline artifact-chain check is unchanged and needs no keys. The
//! platform seal (spec 198 FR-014) is verified when a JWKS is supplied:
//! `--platform-jwks` reads a saved JWKS JSON file (air-gapped audit);
//! `--jwks-url` fetches `GET <statecraft>/api/factory/.well-known/jwks.json`.
//! A certificate with no countersign verifies as visibly UNSEALED (exit 0)
//! unless `--require-sealed` is set.

use clap::Parser;
use factory_engine::governance_certificate::{
    CorpusBindingOutcome, GovernanceCertificate, PostureCrossCheckOutcome, SbomBindingOutcome,
    cross_check_agentic_posture, verify_certificate_with_platform, verify_corpus_binding,
    verify_sbom_binding,
};
use factory_engine::platform_jws::PlatformJwks;
use factory_engine::{validate_spec_id_resolution, write_validation_warnings};
use std::path::PathBuf;

#[derive(Parser)]
#[command(
    name = "verify-certificate",
    about = "Verify a governance certificate by re-deriving hashes, checking proof chain integrity (spec 102 FR-007), and adjudicating the platform seal (spec 198 FR-014)"
)]
struct Cli {
    /// Path to the governance-certificate.json file.
    certificate: PathBuf,

    /// Optional directory containing stage artifacts for hash re-derivation.
    #[arg(long)]
    artifact_dir: Option<PathBuf>,

    /// Repository root used to locate `build/spec-registry/registry.json`
    /// for `intent.spec_id` resolution validation (Cut D W-10 / spec 102 G-2).
    /// Defaults to the current working directory.
    #[arg(long)]
    repo_root: Option<PathBuf>,

    /// Path to a saved platform JWKS JSON file (offline seal verification).
    #[arg(long, conflicts_with = "jwks_url")]
    platform_jwks: Option<PathBuf>,

    /// URL of the platform JWKS endpoint
    /// (e.g. https://statecraft.example/api/factory/.well-known/jwks.json).
    #[arg(long)]
    jwks_url: Option<String>,

    /// Fail (exit 1) when the certificate carries no verifiable platform
    /// countersign. Default posture reports unsealed certificates as a
    /// visible notice with exit 0.
    #[arg(long)]
    require_sealed: bool,

    /// Path to a CorpusAttestation JSON file (spec-spine ledger-seal output,
    /// spec 218 FR-003). Cert has binding + this file matches: reports VERIFIED.
    /// Matches the wrong attestation: fails (exit 1). Cert has binding but no
    /// file supplied: fails PRESENT-BUT-UNVERIFIED (exit 1). Cert has no
    /// binding: reports UNBOUND (notice, exit 0). The attestation's OWN truth
    /// is verified by `spec-spine verify-attestation`, not by this tool (AC-5).
    #[arg(long)]
    corpus_attestation: Option<PathBuf>,

    /// Produced-app root containing the SBOM artifacts (spec 203 FR-003). When
    /// supplied and the cert carries a `sbomArtifactBinding`, the BOM
    /// (.factory/sbom.cdx.json) and audit (.factory/audit.json) files are read,
    /// hashed, and compared against the binding. Present + match: VERIFIED.
    /// Present + mismatch: fails (exit 1). Cert has binding but no dir supplied:
    /// fails PRESENT-BUT-UNVERIFIED (exit 1, fail-closed). Cert has no binding:
    /// reports UNBOUND (notice, exit 0).
    #[arg(long)]
    sbom_dir: Option<PathBuf>,
}

fn load_jwks(cli: &Cli) -> Option<PlatformJwks> {
    if let Some(path) = &cli.platform_jwks {
        let raw = std::fs::read_to_string(path).unwrap_or_else(|e| {
            eprintln!("error: cannot read --platform-jwks {}: {e}", path.display());
            std::process::exit(2);
        });
        let jwks: PlatformJwks = serde_json::from_str(&raw).unwrap_or_else(|e| {
            eprintln!("error: --platform-jwks {} is not a JWKS JSON: {e}", path.display());
            std::process::exit(2);
        });
        return Some(jwks);
    }
    if let Some(url) = &cli.jwks_url {
        let rt = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .expect("tokio runtime");
        let jwks = rt.block_on(async {
            let resp = reqwest::get(url).await.map_err(|e| e.to_string())?;
            if !resp.status().is_success() {
                return Err(format!("HTTP {}", resp.status()));
            }
            resp.json::<PlatformJwks>().await.map_err(|e| e.to_string())
        });
        match jwks {
            Ok(j) => return Some(j),
            Err(e) => {
                eprintln!("error: --jwks-url {url} fetch failed: {e}");
                std::process::exit(2);
            }
        }
    }
    None
}

fn main() {
    let cli = Cli::parse();

    let json = match std::fs::read_to_string(&cli.certificate) {
        Ok(j) => j,
        Err(e) => {
            eprintln!("error: cannot read {}: {e}", cli.certificate.display());
            std::process::exit(2);
        }
    };

    let cert: GovernanceCertificate = match serde_json::from_str(&json) {
        Ok(c) => c,
        Err(e) => {
            eprintln!("error: invalid certificate JSON: {e}");
            std::process::exit(2);
        }
    };

    let jwks = load_jwks(&cli);
    let mut result = verify_certificate_with_platform(
        &cert,
        cli.artifact_dir.as_deref(),
        jwks.as_ref(),
        cli.require_sealed,
    );

    // Spec 218 FR-003 / FR-004: adjudicate the corpus binding against the
    // supplied attestation. Folds into the same notice/error channels so the
    // exit status reflects a mismatched or present-but-unverified binding.
    let corpus_label = match verify_corpus_binding(&cert, cli.corpus_attestation.as_deref()) {
        Ok(CorpusBindingOutcome::Unbound) => {
            result.notices.push("corpus binding: UNBOUND".into());
            "UNBOUND".to_string()
        }
        Ok(CorpusBindingOutcome::Verified { hash }) => {
            let short = &hash[..16.min(hash.len())];
            result
                .notices
                .push(format!("corpus binding: VERIFIED (attestation hash {short})"));
            format!("VERIFIED ({short})")
        }
        Err(e) => {
            result.errors.push(e);
            "INVALID".to_string()
        }
    };

    // Spec 203 FR-003: adjudicate the SBOM artifact binding against the on-disk
    // BOM + audit artifacts under --sbom-dir. Same notice/error channels so a
    // mismatched or present-but-unverified binding drives the exit status.
    let sbom_label = match verify_sbom_binding(&cert, cli.sbom_dir.as_deref()) {
        Ok(SbomBindingOutcome::Unbound) => {
            result.notices.push("sbom binding: UNBOUND".into());
            "UNBOUND".to_string()
        }
        Ok(SbomBindingOutcome::Verified { bom_hash, audit_hash }) => {
            let bom_short = &bom_hash[..16.min(bom_hash.len())];
            let audit_short = &audit_hash[..16.min(audit_hash.len())];
            result.notices.push(format!(
                "sbom binding: VERIFIED (bom {bom_short}, audit {audit_short})"
            ));
            format!("VERIFIED (bom {bom_short}, audit {audit_short})")
        }
        Err(e) => {
            result.errors.push(e);
            "INVALID".to_string()
        }
    };

    // Spec 210 FR-003: cross-check the bound agentic posture against the produced
    // app's CycloneDX BOM under --sbom-dir. A `none` posture (authored or
    // defaulted) contradicted by a watchlisted agent/LLM SDK dependency is folded
    // into errors (exit 1) naming the package; a watchlist miss is a
    // stated-residual notice, never a silent pass; a missing --sbom-dir is a
    // notice (the posture is already bound + internally consistency-checked, the
    // BOM is the optional falsifiability evidence).
    let posture_label = match cross_check_agentic_posture(&cert, cli.sbom_dir.as_deref()) {
        PostureCrossCheckOutcome::Unbound => {
            result
                .notices
                .push("agentic posture: UNSTATED (no binding)".into());
            "UNSTATED".to_string()
        }
        PostureCrossCheckOutcome::Declared => {
            result
                .notices
                .push("agentic posture: DECLARED (agency acknowledged)".into());
            "DECLARED".to_string()
        }
        PostureCrossCheckOutcome::ConsistentNone => {
            result.notices.push(
                "agentic posture: none, no watchlisted agent/LLM SDK in the BOM \
                 (NOTE: a watchlist miss is not proof of absence of agency; spec 210 FR-003)"
                    .into(),
            );
            "NONE (consistent)".to_string()
        }
        PostureCrossCheckOutcome::Contradicted { package, posture } => {
            result.errors.push(format!(
                "agentic posture `{posture}` is contradicted by SBOM dependency `{package}` \
                 (spec 210 FR-003): declare the agentic surface \
                 (agentic_posture: declared|governed) or remove the dependency"
            ));
            "CONTRADICTED".to_string()
        }
        PostureCrossCheckOutcome::UnverifiedNoDir => {
            result.notices.push(
                "agentic posture: none, PRESENT-BUT-UNVERIFIED (supply --sbom-dir to cross-check \
                 against the BOM; spec 210 FR-003)"
                    .into(),
            );
            "UNVERIFIED".to_string()
        }
        PostureCrossCheckOutcome::BomUnreadable { path, error } => {
            result.notices.push(format!(
                "agentic posture: none, BOM unreadable at {path}: {error} (cross-check skipped)"
            ));
            "BOM-UNREADABLE".to_string()
        }
    };
    result.valid = result.errors.is_empty();

    let repo_root = cli
        .repo_root
        .clone()
        .or_else(|| std::env::current_dir().ok())
        .unwrap_or_else(|| PathBuf::from("."));
    let warnings = validate_spec_id_resolution(&cert, &repo_root);
    match write_validation_warnings(&warnings, &cli.certificate) {
        Ok(Some(p)) => eprintln!(
            "validation warnings written: {} ({} warning(s))",
            p.display(),
            warnings.len()
        ),
        Ok(None) => {}
        Err(e) => eprintln!(
            "warning: failed to write validation warnings next to {}: {e}",
            cli.certificate.display()
        ),
    }

    for notice in &result.notices {
        eprintln!("notice: {notice}");
    }

    if result.valid {
        eprintln!(
            "governance certificate VERIFIED (pipeline: {}, status: {:?})",
            cert.pipeline_run_id, cert.status
        );
        eprintln!("  stages: {}", cert.stages.len());
        eprintln!("  proof chain records: {}", cert.proof_chain.record_count);
        eprintln!("  certificate hash: {}", &cert.certificate_hash[..16]);
        eprintln!(
            "  platform seal: {}",
            if cert.platform_countersign.is_some() {
                "present"
            } else {
                "ABSENT (unsealed)"
            }
        );
        eprintln!("  corpus binding: {corpus_label}");
        eprintln!("  sbom binding: {sbom_label}");
        eprintln!("  agentic posture: {posture_label}");
        std::process::exit(0);
    } else {
        eprintln!(
            "governance certificate INVALID ({} error(s)):",
            result.errors.len()
        );
        for err in &result.errors {
            eprintln!("  - {err}");
        }
        eprintln!("  corpus binding: {corpus_label}");
        eprintln!("  sbom binding: {sbom_label}");
        eprintln!("  agentic posture: {posture_label}");
        std::process::exit(1);
    }
}
