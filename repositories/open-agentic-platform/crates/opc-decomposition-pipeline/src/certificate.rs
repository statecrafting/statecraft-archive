// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Bartek Kus
// Spec: specs/165-opc-decomposition-pipeline/spec.md — FR-009 / §2.3 / SC-006

//! Governance certificate emission for a decomposition run.
//!
//! Reuses factory-engine's `GovernanceCertificate` (spec 102 / 168) so a
//! promoted decomposition verifies with the *same* `make verify-certificate`
//! binary (SC-006) — no bespoke verifier. The certificate binds, per
//! spec 165 §2.3:
//!
//!   - the content hash of each stage's output (stages 1-5, and 6's specs),
//!     as per-file SHA-256 entries the verifier re-derives from disk;
//!   - the synthesiser identity + prompt-template hash (via `build_spec_hash`
//!     and the bound `s6-synthesis/synthesiser.json` artifact);
//!   - the promoted/staged spec file hashes (the `s6-synthesis/specs/**`
//!     artifacts);
//!   - the signer (spec 102 FR-007) — resolved by factory-engine from
//!     `OAP_SIGNING_KEY` / `OAP_SIGNING_KEY_PATH`, else an ephemeral key.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use factory_engine::governance_certificate::{
    CertificateBuilder, GovernanceCertificate, IntentRecord, StageOutcome,
    StageRecord as CertStageRecord, persist_certificate, sha256_bytes,
};
use sha2::{Digest, Sha256};

use crate::error::PipelineError;
use crate::types::{PipelineRun, StageStatus};

/// The spec that governs decomposition certificates; recorded as the
/// certificate's `intent.spec_id` so an auditor can resolve it.
const GOVERNING_SPEC_ID: &str = "165-opc-decomposition-pipeline";

/// File name the certificate is persisted under, inside the run directory.
pub const CERTIFICATE_FILENAME: &str = "governance-certificate.json";

/// Map a pipeline stage status onto the certificate's coarse outcome.
/// Complete / Cached / Degraded all produced bound output; only Failed is
/// a failure and only Pending is a non-run.
fn outcome_for(status: StageStatus) -> StageOutcome {
    match status {
        StageStatus::Failed => StageOutcome::Failed,
        StageStatus::Pending => StageOutcome::Skipped,
        _ => StageOutcome::Passed,
    }
}

/// Per-file SHA-256 map for a stage directory, keyed by path relative to
/// the stage dir (forward-slash). Matches `verify_certificate`'s
/// per-artifact re-derivation, which reads `<artifact_dir>/<stage_id>/<key>`
/// and compares its SHA-256 to the recorded value.
fn per_file_hashes(stage_dir: &Path) -> Result<BTreeMap<String, String>, PipelineError> {
    let mut map = BTreeMap::new();
    if !stage_dir.is_dir() {
        return Ok(map);
    }
    for entry in walkdir::WalkDir::new(stage_dir)
        .sort_by_file_name()
        .into_iter()
        .filter_map(|e| e.ok())
        .filter(|e| e.file_type().is_file())
    {
        let path = entry.path();
        let rel = path.strip_prefix(stage_dir).unwrap_or(path);
        let key = rel.to_string_lossy().replace('\\', "/");
        let bytes = std::fs::read(path).map_err(|e| PipelineError::io(path, e))?;
        map.insert(key, sha256_bytes(&bytes));
    }
    Ok(map)
}

/// Build and persist the governance certificate for a completed run.
///
/// `run_root` is the run directory (`<output_root>/<run_id>/`) — the same
/// path passed to `verify_certificate(..., Some(run_root))` and to
/// `make verify-certificate ARTIFACT_DIR=<run_root>`. Returns the path to
/// the written certificate.
pub fn emit(run: &PipelineRun, run_root: &Path) -> Result<PathBuf, PipelineError> {
    let cert = build(run, run_root)?;
    persist_certificate(&cert, run_root).map_err(|e| PipelineError::io(run_root, e))?;
    Ok(run_root.join(CERTIFICATE_FILENAME))
}

/// Construct the certificate without persisting it (exposed for testing).
pub fn build(run: &PipelineRun, run_root: &Path) -> Result<GovernanceCertificate, PipelineError> {
    // Intent: the evidence this run consumed, bound by its content signature.
    let mut h = Sha256::new();
    h.update(run.tree_signature.as_bytes());
    h.update(b"\0");
    h.update(run.knowledge_signature.as_bytes());
    let requirements_hash = hex::encode(h.finalize());

    let intent = IntentRecord {
        requirements_hash,
        spec_id: Some(GOVERNING_SPEC_ID.to_string()),
        spec_hash: None,
    };

    // build_spec_hash binds the synthesiser identity + prompt-template hash
    // (§2.3) cryptographically. The human-readable values also live in the
    // bound s6-synthesis/synthesiser.json artifact.
    let build_spec_hash = hex::encode(Sha256::digest(
        format!("{}:{}", run.synthesiser_identity, run.prompt_template_hash).as_bytes(),
    ));

    let mut cert_stages = Vec::with_capacity(run.stages.len());
    for s in &run.stages {
        let stage_dir = run_root.join(s.id.dir_name());
        cert_stages.push(CertStageRecord {
            stage_id: s.id.dir_name(),
            status: outcome_for(s.status),
            artifact_hashes: per_file_hashes(&stage_dir)?,
            gate_result: None,
            duration_ms: None,
            sandbox_execution: None,
        });
    }

    Ok(CertificateBuilder::new(run.run_id.as_str(), intent)
        .build_spec_hash(build_spec_hash)
        .stages(cert_stages)
        .build())
}
