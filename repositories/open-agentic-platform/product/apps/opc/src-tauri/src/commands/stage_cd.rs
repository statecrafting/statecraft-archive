// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Bartek Kus
// Spec: specs/122-stakeholder-doc-inversion/spec.md — FR-024, FR-025, FR-026, FR-030

//! Tauri commands for the desktop's StageCdReview surface.
//!
//! Wraps the library-layer operator actions in
//! `factory_engine::stages::stage_cd_actions` and the gate evaluator
//! in `factory_engine::stages::stage_cd_gate`. Mutating commands
//! re-read the on-disk diff after writing so the returned record
//! reflects the new resolution state immediately.
//!
//! Audit-log emission: every action returns an `ActionAuditPayload`
//! that the caller writes to the project's audit log. For Phase 5 we
//! return the payload as part of the command result so the desktop
//! can persist it via the existing audit-log sink — same pattern the
//! spec-121 commands use.

use factory_contracts::Utc;
use factory_engine::stages::stage_cd_actions::{
    self, AcceptInputs, ActionAuditPayload, ActionError,
};
use factory_engine::stages::stage_cd_comparator::StageCdDiff;
use factory_engine::stages::stage_cd_gate::{
    evaluate_qg_cd_01, ApprovalLedger, GateConfig, GateResult,
    WorkspaceCoApprovalPolicy,
};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StageCdActionResult {
    pub diff: StageCdDiff,
    pub audit: ActionAuditPayload,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StageCdGateResultDto {
    pub diff: StageCdDiff,
    pub gate: GateResult,
}

/// Read `<artifactStore>/stage-cd/stage-cd-diff.json`.
#[tauri::command]
pub async fn stage_cd_get_diff(
    artifact_store: String,
) -> Result<StageCdDiff, String> {
    let path = diff_path(Path::new(&artifact_store));
    let raw = std::fs::read_to_string(&path).map_err(|e| {
        format!("read {}: {e}", path.display())
    })?;
    serde_json::from_str(&raw).map_err(|e| e.to_string())
}

/// Re-evaluate `QG-CD-01` against the persisted diff. The approval
/// ledger is derived from the diff's `DiffResolution` entries — this
/// keeps the on-disk diff as the single source of truth and prevents
/// JS from drifting out of sync (a force-approve writes to the diff;
/// the next gate eval picks it up automatically).
#[tauri::command]
pub async fn stage_cd_evaluate_gate(
    artifact_store: String,
    project_slug: String,
    co_approval: Option<WorkspaceCoApprovalPolicy>,
) -> Result<StageCdGateResultDto, String> {
    let path = diff_path(Path::new(&artifact_store));
    let diff: StageCdDiff = read_diff(&path)?;
    let cfg = GateConfig {
        co_approval: co_approval.unwrap_or_default(),
    };
    let approvals = ApprovalLedger::from_diff(&diff);
    let gate = evaluate_qg_cd_01(
        &diff,
        &cfg,
        &approvals,
        &project_slug,
        Utc::now(),
    );
    Ok(StageCdGateResultDto { diff, gate })
}

/// Reject a candidate diff. Authored doc untouched. Persists the
/// updated diff record to the artifact store.
#[tauri::command]
pub async fn stage_cd_reject_candidate(
    artifact_store: String,
    project_slug: String,
    doc: String,
    anchor: String,
    actor: String,
) -> Result<StageCdActionResult, String> {
    let path = diff_path(Path::new(&artifact_store));
    let mut diff: StageCdDiff = read_diff(&path)?;
    let audit = stage_cd_actions::reject_candidate(
        &mut diff,
        &project_slug,
        &doc,
        &anchor,
        &actor,
        Utc::now(),
    );
    write_diff(&path, &diff)?;
    Ok(StageCdActionResult { diff, audit })
}

/// Accept a candidate diff: writes the candidate body to the authored
/// doc at the same anchor, bumps version, appends `appliedFrom`. THIS
/// IS THE ONLY OPERATOR ACTION THAT MUTATES PROJECT WORKSPACE FILES.
#[tauri::command]
pub async fn stage_cd_accept_candidate(
    artifact_store: String,
    project_slug: String,
    authored_path: String,
    candidate_path: String,
    anchor: String,
    actor: String,
    run_id: String,
) -> Result<StageCdActionResult, String> {
    let path = diff_path(Path::new(&artifact_store));
    let mut diff: StageCdDiff = read_diff(&path)?;
    let result = stage_cd_actions::accept_candidate(
        &mut diff,
        &AcceptInputs {
            project_slug: &project_slug,
            authored_path: Path::new(&authored_path),
            candidate_path: Path::new(&candidate_path),
            anchor: &anchor,
            actor: &actor,
            run_id: &run_id,
            now: Utc::now(),
        },
    )
    .map_err(|e: ActionError| e.to_string())?;
    write_diff(&path, &diff)?;
    Ok(StageCdActionResult {
        diff,
        audit: result,
    })
}

/// Force-approve a diff WITHOUT applying. Empty `reason` rejected at
/// the command boundary per FR-026.
#[tauri::command]
pub async fn stage_cd_force_approve(
    artifact_store: String,
    project_slug: String,
    doc: String,
    anchor: String,
    actor: String,
    reason: String,
) -> Result<StageCdActionResult, String> {
    let path = diff_path(Path::new(&artifact_store));
    let mut diff: StageCdDiff = read_diff(&path)?;
    let audit = stage_cd_actions::force_approve(
        &mut diff,
        &project_slug,
        &doc,
        &anchor,
        &actor,
        &reason,
        Utc::now(),
    )
    .map_err(|e: ActionError| e.to_string())?;
    write_diff(&path, &diff)?;
    Ok(StageCdActionResult { diff, audit })
}

// ---------------------------------------------------------------------------
// IO helpers
// ---------------------------------------------------------------------------

fn diff_path(artifact_store: &Path) -> PathBuf {
    artifact_store.join("stage-cd/stage-cd-diff.json")
}

fn read_diff(p: &Path) -> Result<StageCdDiff, String> {
    let raw = std::fs::read_to_string(p)
        .map_err(|e| format!("read {}: {e}", p.display()))?;
    serde_json::from_str(&raw).map_err(|e| e.to_string())
}

fn write_diff(p: &Path, diff: &StageCdDiff) -> Result<(), String> {
    if let Some(parent) = p.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let body =
        serde_json::to_string_pretty(diff).map_err(|e| e.to_string())?;
    std::fs::write(p, body).map_err(|e| e.to_string())
}
