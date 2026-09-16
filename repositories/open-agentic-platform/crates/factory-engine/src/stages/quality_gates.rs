// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Bartek Kus
// Spec: specs/121-claim-provenance-enforcement/spec.md — FR-004, FR-023 to FR-031

//! Stage 1 quality gates — `QG-13_ExternalProvenance` lives here.
//!
//! `evaluate_qg13` wires the spec-121 validator into the factory's gate
//! machinery. The validator already runs `catch_unwind` internally, so a
//! validator panic surfaces here as `ValidationReport.panic_reason` and
//! the gate returns `Fail{reason: "qg13_validator_panic"}` (FR-005).
//!
//! In `STRICT` mode (default), any `Rejected` claim FAILs the gate; the
//! pipeline does not advance. In `PERMISSIVE` mode the same condition
//! WARNs — the operator's explicit, audit-logged opt-in for retrofitting
//! contaminated projects (FR-024, FR-025).

use chrono::{DateTime, Utc};
use factory_contracts::knowledge::ExtractionOutput;
use factory_contracts::provenance::{Claim, ClaimId};
use factory_contracts::{
    AssumptionBudget, FactoryProvenanceMode, ProvenanceConfig,
};
use policy_kernel::provenance_policy::WorkspaceProvenancePolicy;
use provenance_validator::{
    derive_allowlist, validate, Allowlist, ClaimRecord, Corpus, CorpusEntry,
    ProjectContext, ValidationReport,
};
use serde::{Deserialize, Serialize};

/// Stage 1's emitted claims + the corpus context the gate needs.
///
/// Phase 4 keeps this struct minimal — Phase 5 may extend it with
/// cascade-skip metadata.
#[derive(Debug, Clone)]
pub struct Stage1Outputs {
    pub claims: Vec<Claim>,
    /// Spec-120 typed extraction artifacts in source-key order. The gate
    /// builds a `Corpus` from this slice and runs every `verify_citation`
    /// against it.
    pub corpus_entries: Vec<CorpusEntry>,
    pub project_name: String,
    pub project_slug: String,
    pub workspace_name: String,
    /// `provenance.json`'s carried-in `Assumption`/`AssumptionOrphaned`
    /// count from the prior run (FR-029 budget seed). Defaults to 0 for
    /// a fresh project.
    pub existing_assumption_count: u32,
}

/// Aggregate gate outcome.
#[derive(Debug, Clone, PartialEq)]
pub enum QualityGateResult {
    Pass {
        report: Box<ValidationReport>,
        audit: ProvenanceAuditPayload,
    },
    Warn {
        warnings: Vec<RejectedDetail>,
        report: Box<ValidationReport>,
        audit: ProvenanceAuditPayload,
    },
    Fail {
        reason: String,
        rejected_ids: Vec<ClaimId>,
        rejected_details: Vec<RejectedDetail>,
        report: Box<ValidationReport>,
        audit: ProvenanceAuditPayload,
    },
}

impl QualityGateResult {
    /// True only when the gate definitively passes. `Warn` and `Fail`
    /// both return false; the caller decides whether to advance the
    /// pipeline.
    pub fn passed(&self) -> bool {
        matches!(self, QualityGateResult::Pass { .. })
    }

    /// True when the gate blocks pipeline advancement. `Pass` and `Warn`
    /// return false; only `Fail` blocks.
    pub fn blocked(&self) -> bool {
        matches!(self, QualityGateResult::Fail { .. })
    }

    pub fn report(&self) -> &ValidationReport {
        match self {
            QualityGateResult::Pass { report, .. }
            | QualityGateResult::Warn { report, .. }
            | QualityGateResult::Fail { report, .. } => report,
        }
    }
}

/// Single rejected-claim detail included in `Warn`/`Fail` results.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RejectedDetail {
    pub claim_id: ClaimId,
    pub reason: String,
}

/// `audit_log` payload emitted for every gate run (FR-040).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProvenanceAuditPayload {
    pub action: String,
    pub project: String,
    pub total_claims: u32,
    pub derived_count: u32,
    pub assumption_count: u32,
    pub assumption_orphaned_count: u32,
    pub rejected_count: u32,
    /// Effective gate mode after workspace-pin override.
    pub effective_mode: FactoryProvenanceMode,
    /// `true` when the workspace policy override changed the mode from
    /// what the project's `factory-config.yaml` requested.
    pub workspace_pin_applied: bool,
}

/// FR-004 + FR-024: evaluate Stage 1 against the provenance contract.
///
/// `now` is the wall clock at the time of evaluation; tests inject a
/// fixed value to exercise the FR-030 expiry path deterministically.
pub fn evaluate_qg13(
    stage1_outputs: &Stage1Outputs,
    config: &ProvenanceConfig,
    workspace_policy: Option<&WorkspaceProvenancePolicy>,
    now: DateTime<Utc>,
) -> QualityGateResult {
    // Step 1: resolve effective mode. Workspace STRICT pin overrides any
    // project PERMISSIVE setting (FR-026).
    let project_mode = config.mode;
    let pinned_strict = workspace_policy.map(|w| w.pins_strict()).unwrap_or(false);
    let effective_mode = if pinned_strict {
        FactoryProvenanceMode::Strict
    } else {
        project_mode
    };
    let workspace_pin_applied =
        pinned_strict && project_mode == FactoryProvenanceMode::Permissive;

    // Step 2: clamp the project's assumption budget to the workspace
    // ceiling (if any).
    let effective_cap = match workspace_policy {
        Some(w) => w.clamp_budget(config.assumption_budget),
        None => config.assumption_budget,
    };

    // Step 3: build the validator inputs.
    let corpus = Corpus::from_entries(stage1_outputs.corpus_entries.clone());
    let corpus_outputs: Vec<ExtractionOutput> = corpus
        .entries()
        .iter()
        .map(|e| e.output.clone())
        .collect();
    let allowlist: Allowlist = derive_allowlist(&ProjectContext {
        corpus: &corpus_outputs,
        project_name: &stage1_outputs.project_name,
        project_slug: &stage1_outputs.project_slug,
        workspace_name: &stage1_outputs.workspace_name,
        entity_model_yaml: None,
        charter_vocabulary: None,
        capitalized_token_frequency_threshold: 1,
    });
    let budget = AssumptionBudget {
        cap: effective_cap,
        used: stage1_outputs.existing_assumption_count,
    };

    // Step 4: run the validator. `validate()` wraps `catch_unwind` so a
    // panic surfaces here as `report.panic_reason`, never an unwound
    // panic.
    let report = validate(
        &stage1_outputs.claims,
        &corpus,
        &allowlist,
        &budget,
        now,
    );

    // Step 5: panic guard (FR-005). Always Fail; never depends on mode.
    if let Some(panic_reason) = &report.panic_reason {
        let audit = build_audit_payload(
            &stage1_outputs.project_slug,
            &report,
            effective_mode,
            workspace_pin_applied,
        );
        let rejected_details = collect_rejected(&report.claims);
        return QualityGateResult::Fail {
            reason: format!("qg13_validator_panic: {panic_reason}"),
            rejected_ids: rejected_details
                .iter()
                .map(|d| d.claim_id.clone())
                .collect(),
            rejected_details,
            report: Box::new(report),
            audit,
        };
    }

    // Step 6: budget overflow check. FR-029 is unconditional: the gate
    // MUST refuse to admit ASSUMPTION claims that exceed the cap.
    // PERMISSIVE mode does NOT relax this — PERMISSIVE loosens the
    // rejection-of-unbacked-claims gate only.
    //
    // Signal: any per-claim rejection with reason `assumption_budget_exceeded`
    // means the validator already refused an ASSUMPTION admission. The
    // gate must surface this as a hard Fail in either mode (the slot
    // counter at this point reflects ONLY the admitted claims, so a
    // simple `consumed > cap` comparison undercounts — a refused claim
    // does not consume a slot).
    let audit = build_audit_payload(
        &stage1_outputs.project_slug,
        &report,
        effective_mode,
        workspace_pin_applied,
    );

    let rejected_details = collect_rejected(&report.claims);
    let budget_overflow = rejected_details
        .iter()
        .any(|d| d.reason == "assumption_budget_exceeded");

    if budget_overflow {
        let rejected_ids: Vec<ClaimId> = rejected_details
            .iter()
            .map(|d| d.claim_id.clone())
            .collect();
        return QualityGateResult::Fail {
            reason: "assumption_budget_exceeded".into(),
            rejected_ids,
            rejected_details,
            report: Box::new(report),
            audit,
        };
    }

    if rejected_details.is_empty() {
        return QualityGateResult::Pass {
            report: Box::new(report),
            audit,
        };
    }

    let rejected_ids: Vec<ClaimId> = rejected_details
        .iter()
        .map(|d| d.claim_id.clone())
        .collect();

    match effective_mode {
        FactoryProvenanceMode::Strict => QualityGateResult::Fail {
            reason: "qg13_blocked".into(),
            rejected_ids,
            rejected_details,
            report: Box::new(report),
            audit,
        },
        FactoryProvenanceMode::Permissive => QualityGateResult::Warn {
            warnings: rejected_details,
            report: Box::new(report),
            audit,
        },
    }
}

fn collect_rejected(claims: &[ClaimRecord]) -> Vec<RejectedDetail> {
    claims
        .iter()
        .filter_map(|r| match &r.provenance_mode {
            factory_contracts::provenance::ProvenanceMode::Rejected {
                reason,
            } => Some(RejectedDetail {
                claim_id: r.id.clone(),
                reason: reason.clone(),
            }),
            _ => None,
        })
        .collect()
}

fn build_audit_payload(
    project: &str,
    report: &ValidationReport,
    effective_mode: FactoryProvenanceMode,
    workspace_pin_applied: bool,
) -> ProvenanceAuditPayload {
    ProvenanceAuditPayload {
        action: "factory.provenance_validated".into(),
        project: project.to_string(),
        total_claims: report.summary.total,
        derived_count: report.summary.derived_count,
        assumption_count: report.summary.assumption_count,
        assumption_orphaned_count: report.summary.assumption_orphaned_count,
        rejected_count: report.summary.rejected_count,
        effective_mode,
        workspace_pin_applied,
    }
}

/// FR-027 helper: synthesise the `factory.provenance_mode_changed` audit
/// payload when the gate's effective mode differs from the prior run.
/// Callers compare the prior mode (loaded from `provenance.json` or the
/// last audit entry) against `effective_mode` and emit this row when
/// they differ.
pub fn build_mode_change_payload(
    project: &str,
    actor: &str,
    from: FactoryProvenanceMode,
    to: FactoryProvenanceMode,
    reason: &str,
) -> ModeChangePayload {
    ModeChangePayload {
        action: "factory.provenance_mode_changed".into(),
        project: project.to_string(),
        actor: actor.to_string(),
        from,
        to,
        reason: reason.to_string(),
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModeChangePayload {
    pub action: String,
    pub project: String,
    pub actor: String,
    pub from: FactoryProvenanceMode,
    pub to: FactoryProvenanceMode,
    pub reason: String,
}

/// FR-040 / §5.3 helper: build `factory.assumption_skip_emitted` audit
/// payload for one Stage 4 / Stage 5 artifact that was skipped because
/// its origin claim is `Assumption` or `AssumptionOrphaned`.
pub fn build_skip_payload(
    project: &str,
    claim_id: factory_contracts::provenance::ClaimId,
    anchor_hash: factory_contracts::provenance::AnchorHash,
    stage: u8,
    artifact_kind: &str,
    description: &str,
) -> factory_contracts::provenance::AssumptionSkipPayload {
    factory_contracts::provenance::AssumptionSkipPayload {
        action: "factory.assumption_skip_emitted".into(),
        project: project.to_string(),
        claim_id,
        anchor_hash,
        stage,
        artifact_kind: artifact_kind.to_string(),
        description: description.to_string(),
    }
}

/// Persist the latest `ValidationReport` to the project's
/// `<project>/.artifacts/provenance.json` for downstream tauri commands
/// (Phase 6) to read without re-running the validator. Atomic
/// write-then-rename so a crashed run never leaves a half-written file.
///
/// The file is overwritten on every gate evaluation; cumulative state
/// across runs (id-registry, etc.) lives in sibling files.
pub fn persist_provenance_report(
    project_root: &std::path::Path,
    report: &provenance_validator::ValidationReport,
) -> std::io::Result<std::path::PathBuf> {
    let artifacts_dir = project_root.join(".artifacts");
    std::fs::create_dir_all(&artifacts_dir)?;
    let dest = artifacts_dir.join("provenance.json");
    let tmp = artifacts_dir.join("provenance.json.tmp");
    let body = serde_json::to_vec_pretty(report).map_err(|e| {
        std::io::Error::new(std::io::ErrorKind::InvalidData, e)
    })?;
    std::fs::write(&tmp, body)?;
    std::fs::rename(&tmp, &dest)?;
    Ok(dest)
}

/// Read the persisted provenance report, returning `None` when no file
/// exists yet (fresh project).
pub fn load_provenance_report(
    project_root: &std::path::Path,
) -> std::io::Result<Option<provenance_validator::ValidationReport>> {
    let path = project_root.join(".artifacts/provenance.json");
    if !path.exists() {
        return Ok(None);
    }
    let bytes = std::fs::read(&path)?;
    let report: provenance_validator::ValidationReport =
        serde_json::from_slice(&bytes).map_err(|e| {
            std::io::Error::new(std::io::ErrorKind::InvalidData, e)
        })?;
    Ok(Some(report))
}

/// FR-035 helper: build the `factory.provenance_promoted` audit payload
/// when an operator approves a candidate citation that flips an
/// `Assumption` (or `AssumptionOrphaned`) claim to `Derived`. The
/// transition workflow itself lives in Phase 6's desktop UI; this
/// helper provides the contract type the writer of the audit row
/// consumes.
pub fn build_promotion_payload(
    claim_id: factory_contracts::provenance::ClaimId,
    from_mode: factory_contracts::provenance::ProvenanceMode,
    to_mode: factory_contracts::provenance::ProvenanceMode,
    citation: factory_contracts::provenance::Citation,
    actor: &str,
) -> factory_contracts::provenance::PromotionAuditPayload {
    factory_contracts::provenance::PromotionAuditPayload {
        action: "factory.provenance_promoted".into(),
        claim_id,
        from_mode,
        to_mode,
        citation,
        actor: actor.to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::TimeZone;
    use factory_contracts::provenance::{
        anchor_hash, AssumptionTag, ClaimKind, ProvenanceMode,
    };

    fn fixed_now() -> DateTime<Utc> {
        Utc.with_ymd_and_hms(2026, 5, 1, 12, 0, 0).unwrap()
    }

    fn make_claim(
        id: &str,
        kind: ClaimKind,
        text: &str,
        assumption: Option<AssumptionTag>,
    ) -> Claim {
        Claim {
            id: ClaimId(id.into()),
            kind,
            stage: 1,
            minted_at: fixed_now(),
            text: text.into(),
            anchor_hash: anchor_hash(text),
            provenance_mode: ProvenanceMode::Derived,
            citations: vec![],
            assumption,
            names_external_entity: false,
            extracted_entity_candidates: vec![],
            candidate_promotion: None,
        }
    }

    fn outputs_with(
        claims: Vec<Claim>,
        existing_assumption_count: u32,
    ) -> Stage1Outputs {
        Stage1Outputs {
            claims,
            corpus_entries: vec![],
            project_name: "test project".into(),
            project_slug: "test-project".into(),
            workspace_name: "test-workspace".into(),
            existing_assumption_count,
        }
    }

    // ---------- STRICT mode happy path ----------

    #[test]
    fn strict_mode_internal_claim_passes() {
        // No external entity → Derived; no rejection; gate Passes.
        let claim = make_claim(
            "BR-001",
            ClaimKind::Br,
            "applicants must be registered",
            None,
        );
        let outs = outputs_with(vec![claim], 0);
        let r = evaluate_qg13(
            &outs,
            &ProvenanceConfig::default(),
            None,
            fixed_now(),
        );
        assert!(r.passed());
    }

    // ---------- STRICT vs PERMISSIVE divergence ----------

    #[test]
    fn strict_fabricated_claim_fails() {
        // Naming an external entity ("Frobozz Engine") with no citation
        // and no assumption → Rejected → STRICT FAILs.
        let claim = make_claim(
            "STK-13",
            ClaimKind::Stk,
            "Frobozz Engine emits rotation events",
            None,
        );
        let outs = outputs_with(vec![claim], 0);
        let r = evaluate_qg13(
            &outs,
            &ProvenanceConfig::default(),
            None,
            fixed_now(),
        );
        assert!(matches!(r, QualityGateResult::Fail { ref reason, .. } if reason == "qg13_blocked"));
        assert!(r.blocked());
    }

    #[test]
    fn permissive_fabricated_claim_warns() {
        let claim = make_claim(
            "STK-13",
            ClaimKind::Stk,
            "Frobozz Engine emits rotation events",
            None,
        );
        let outs = outputs_with(vec![claim], 0);
        let cfg = ProvenanceConfig {
            mode: FactoryProvenanceMode::Permissive,
            assumption_budget: 10,
            reason: "ramp".into(),
        };
        let r = evaluate_qg13(&outs, &cfg, None, fixed_now());
        assert!(matches!(r, QualityGateResult::Warn { .. }));
        assert!(!r.blocked());
    }

    // ---------- Workspace pin override ----------

    #[test]
    fn workspace_pin_overrides_permissive_project_config() {
        use policy_kernel::provenance_policy::PinnedProvenanceMode;
        let claim = make_claim(
            "STK-13",
            ClaimKind::Stk,
            "Frobozz Engine emits rotation events",
            None,
        );
        let outs = outputs_with(vec![claim], 0);
        let cfg = ProvenanceConfig {
            mode: FactoryProvenanceMode::Permissive,
            assumption_budget: 10,
            reason: "ramp".into(),
        };
        let pin = WorkspaceProvenancePolicy {
            pinned_mode: Some(PinnedProvenanceMode::Strict),
            max_assumption_budget: None,
        };
        let r = evaluate_qg13(&outs, &cfg, Some(&pin), fixed_now());
        match r {
            QualityGateResult::Fail {
                reason,
                ref audit,
                ..
            } => {
                assert_eq!(reason, "qg13_blocked");
                assert!(audit.workspace_pin_applied);
                assert_eq!(audit.effective_mode, FactoryProvenanceMode::Strict);
            }
            other => panic!(
                "expected Fail with workspace pin applied, got {other:?}",
            ),
        }
    }

    // ---------- Assumption budget enforcement ----------

    #[test]
    fn budget_overflow_fails_even_in_permissive() {
        // FR-029 invariant: budget enforcement is unconditional. PERMISSIVE
        // mode loosens unbacked-claim rejection but does NOT permit
        // exceeding the assumption budget.
        let tag = AssumptionTag {
            owner: "ops".into(),
            rationale: "x".into(),
            expires_at: Utc.with_ymd_and_hms(2027, 1, 1, 0, 0, 0).unwrap(),
            tagged_at: fixed_now(),
        };
        let outs = outputs_with(
            vec![
                make_claim(
                    "INT-001",
                    ClaimKind::Int,
                    "first assumption",
                    Some(tag.clone()),
                ),
                make_claim(
                    "INT-002",
                    ClaimKind::Int,
                    "second assumption",
                    Some(tag),
                ),
            ],
            0,
        );
        let cfg = ProvenanceConfig {
            mode: FactoryProvenanceMode::Permissive,
            assumption_budget: 1,
            reason: "ramp".into(),
        };
        let r = evaluate_qg13(&outs, &cfg, None, fixed_now());
        match r {
            QualityGateResult::Fail { reason, .. } => {
                assert_eq!(reason, "assumption_budget_exceeded");
            }
            other => panic!(
                "PERMISSIVE mode must still Fail on budget overflow, got {other:?}",
            ),
        }
    }

    #[test]
    fn budget_one_two_assumptions_fails_in_strict() {
        let tag = AssumptionTag {
            owner: "ops".into(),
            rationale: "pending Globex Finance".into(),
            expires_at: Utc.with_ymd_and_hms(2027, 1, 1, 0, 0, 0).unwrap(),
            tagged_at: fixed_now(),
        };
        let outs = outputs_with(
            vec![
                make_claim(
                    "INT-001",
                    ClaimKind::Int,
                    "first assumption",
                    Some(tag.clone()),
                ),
                make_claim(
                    "INT-002",
                    ClaimKind::Int,
                    "second assumption",
                    Some(tag),
                ),
            ],
            0,
        );
        let cfg = ProvenanceConfig {
            mode: FactoryProvenanceMode::Strict,
            assumption_budget: 1,
            reason: String::new(),
        };
        let r = evaluate_qg13(&outs, &cfg, None, fixed_now());
        assert!(matches!(r, QualityGateResult::Fail { .. }));
    }

    #[test]
    fn expired_assumption_fails_strict() {
        let expired = AssumptionTag {
            owner: "ops".into(),
            rationale: "stale".into(),
            expires_at: Utc.with_ymd_and_hms(2020, 1, 1, 0, 0, 0).unwrap(),
            tagged_at: Utc.with_ymd_and_hms(2019, 12, 1, 0, 0, 0).unwrap(),
        };
        let outs = outputs_with(
            vec![make_claim(
                "INT-001",
                ClaimKind::Int,
                "stale",
                Some(expired),
            )],
            0,
        );
        let r = evaluate_qg13(
            &outs,
            &ProvenanceConfig::default(),
            None,
            fixed_now(),
        );
        assert!(matches!(r, QualityGateResult::Fail { ref rejected_details, .. } if !rejected_details.is_empty()));
    }

    // ---------- Audit payload emission ----------

    #[test]
    fn audit_payload_carries_validated_action() {
        let claim = make_claim("BR-001", ClaimKind::Br, "internal", None);
        let outs = outputs_with(vec![claim], 0);
        let r = evaluate_qg13(
            &outs,
            &ProvenanceConfig::default(),
            None,
            fixed_now(),
        );
        let audit = match &r {
            QualityGateResult::Pass { audit, .. } => audit,
            QualityGateResult::Warn { audit, .. } => audit,
            QualityGateResult::Fail { audit, .. } => audit,
        };
        assert_eq!(audit.action, "factory.provenance_validated");
        assert_eq!(audit.project, "test-project");
        assert!(!audit.workspace_pin_applied);
    }

    #[test]
    fn persist_and_load_round_trip() {
        let dir = tempfile::tempdir().unwrap();
        let claim = make_claim(
            "BR-001",
            ClaimKind::Br,
            "applicants must be registered",
            None,
        );
        let outs = outputs_with(vec![claim], 0);
        let r = evaluate_qg13(
            &outs,
            &ProvenanceConfig::default(),
            None,
            fixed_now(),
        );
        let report = match r {
            QualityGateResult::Pass { report, .. } => *report,
            QualityGateResult::Warn { report, .. } => *report,
            QualityGateResult::Fail { report, .. } => *report,
        };
        let path = persist_provenance_report(dir.path(), &report).unwrap();
        assert!(path.exists());
        let loaded = load_provenance_report(dir.path()).unwrap().unwrap();
        assert_eq!(loaded, report);
    }

    #[test]
    fn load_provenance_returns_none_when_absent() {
        let dir = tempfile::tempdir().unwrap();
        let loaded = load_provenance_report(dir.path()).unwrap();
        assert!(loaded.is_none());
    }

    #[test]
    fn skip_payload_carries_correct_action() {
        let p = build_skip_payload(
            "test-project",
            ClaimId("INT-003".into()),
            factory_contracts::provenance::AnchorHash("abc".into()),
            4,
            "ddl_table",
            "table payment_request (skipped)",
        );
        assert_eq!(p.action, "factory.assumption_skip_emitted");
        assert_eq!(p.stage, 4);
        assert_eq!(p.artifact_kind, "ddl_table");
        assert_eq!(p.claim_id.0, "INT-003");
    }

    #[test]
    fn promotion_payload_carries_correct_action() {
        use factory_contracts::provenance::{
            Citation, ProvenanceMode, QuoteHash,
        };
        use std::path::PathBuf;
        let cit = Citation {
            source: PathBuf::from("doc.txt"),
            line_range: (1, 1),
            quote: "x".into(),
            quote_hash: QuoteHash("h".into()),
        };
        let p = build_promotion_payload(
            ClaimId("INT-003".into()),
            ProvenanceMode::Assumption,
            ProvenanceMode::Derived,
            cit,
            "ops@example.com",
        );
        assert_eq!(p.action, "factory.provenance_promoted");
        assert_eq!(p.from_mode, ProvenanceMode::Assumption);
        assert_eq!(p.to_mode, ProvenanceMode::Derived);
        assert_eq!(p.actor, "ops@example.com");
    }

    #[test]
    fn mode_change_payload_carries_correct_action() {
        let p = build_mode_change_payload(
            "test-project",
            "ops@example.com",
            FactoryProvenanceMode::Permissive,
            FactoryProvenanceMode::Strict,
            "ramp complete",
        );
        assert_eq!(p.action, "factory.provenance_mode_changed");
        assert_eq!(p.from, FactoryProvenanceMode::Permissive);
        assert_eq!(p.to, FactoryProvenanceMode::Strict);
        assert_eq!(p.reason, "ramp complete");
    }

    // ---------- Determinism ----------

    #[test]
    fn evaluate_qg13_is_deterministic_for_fixed_now() {
        let claim = make_claim(
            "STK-13",
            ClaimKind::Stk,
            "Frobozz Engine emits rotation events",
            None,
        );
        let outs = outputs_with(vec![claim], 0);
        let cfg = ProvenanceConfig::default();
        let r1 = evaluate_qg13(&outs, &cfg, None, fixed_now());
        let r2 = evaluate_qg13(&outs, &cfg, None, fixed_now());
        // Both fail with the same shape; report serialisation is byte-stable.
        let s1 = serde_json::to_string(r1.report()).unwrap();
        let s2 = serde_json::to_string(r2.report()).unwrap();
        assert_eq!(s1, s2);
    }

    // ---------- Workspace budget clamp ----------

    #[test]
    fn workspace_budget_clamp_lowers_project_request() {
        let tag = AssumptionTag {
            owner: "ops".into(),
            rationale: "x".into(),
            expires_at: Utc.with_ymd_and_hms(2027, 1, 1, 0, 0, 0).unwrap(),
            tagged_at: fixed_now(),
        };
        // Project asks for cap=10; workspace clamps to cap=1; two
        // assumptions submitted; gate must reject the second.
        let outs = outputs_with(
            vec![
                make_claim(
                    "INT-001",
                    ClaimKind::Int,
                    "a",
                    Some(tag.clone()),
                ),
                make_claim("INT-002", ClaimKind::Int, "b", Some(tag)),
            ],
            0,
        );
        let cfg = ProvenanceConfig {
            mode: FactoryProvenanceMode::Strict,
            assumption_budget: 10,
            reason: String::new(),
        };
        let pin = WorkspaceProvenancePolicy {
            pinned_mode: None,
            max_assumption_budget: Some(1),
        };
        let r = evaluate_qg13(&outs, &cfg, Some(&pin), fixed_now());
        assert!(matches!(r, QualityGateResult::Fail { .. }));
    }
}
