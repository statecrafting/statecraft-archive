// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Bartek Kus
// Spec: specs/122-stakeholder-doc-inversion/spec.md — FR-022 to FR-026

//! `QG-CD-01_StakeholderDocAlignment` — Stage CD's exit gate.
//!
//! Per FR-022:
//!
//!   * **PASS** when every diff in `stage-cd-diff.json` is `wording`.
//!     Wording diffs are recorded as warnings; the pipeline advances.
//!   * **FAIL** on any `scope`, `external-entity`, `ownership`, or
//!     `citation` diff.
//!   * **FAIL** on `structural` diffs UNLESS the operator has approved
//!     each one via FR-024.
//!
//! Workspace policy (FR-026) MAY require a co-approver for `scope` and
//! `ownership` force-approvals. When `WorkspaceCoApprovalPolicy::
//! ScopeOwnership` is set, a single `Force approve` is not enough —
//! the gate stays FAILing until a second operator's approval is
//! recorded on the same diff.
//!
//! The gate emits an `audit_log` payload of action
//! `factory.stage_cd_gate_evaluated` (FR-023) carrying the per-class
//! diff counts and the blocking-diff list. The caller writes the
//! payload to the audit-log sink; this module is pure / read-only over
//! its inputs.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

use crate::stages::stage_cd_comparator::{
    StageCdDiff, StageCdDiffFinding,
};

/// Workspace-policy hook for force-approve co-approval (FR-026).
#[derive(
    Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize,
)]
#[serde(rename_all = "kebab-case")]
pub enum WorkspaceCoApprovalPolicy {
    /// No co-approval required. Single force-approve passes the gate.
    #[default]
    None,
    /// `scope` and `ownership` force-approvals require a second
    /// operator. Other classes still pass on a single force-approve.
    ScopeOwnership,
}

#[derive(
    Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize,
)]
#[serde(rename_all = "camelCase")]
pub struct GateConfig {
    pub co_approval: WorkspaceCoApprovalPolicy,
}

/// Per-diff approval ledger. Each entry records up to two operators'
/// `Force approve` actions; the gate consults the ledger to decide
/// whether a `structural`-or-blocking diff is satisfied.
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApprovalLedger {
    /// Approvals keyed by `(doc, anchor)` joined as `"<doc>::<anchor>"`.
    /// A `Vec` of approvals supports the FR-026 dual-approver path.
    pub approvals: std::collections::BTreeMap<String, Vec<Approval>>,
}

impl ApprovalLedger {
    /// Derive the ledger from the persisted `DiffResolution` entries
    /// on a `StageCdDiff`. This is the canonical path the Tauri layer
    /// uses so the gate has a single authoritative source — operator
    /// actions write `DiffResolution` to disk; the gate reads only
    /// what's persisted.
    pub fn from_diff(diff: &StageCdDiff) -> Self {
        let mut out = Self::default();
        for finding in &diff.findings {
            if let Some(res) = &finding.resolution {
                let action = match res.action.as_str() {
                    "rejected" => ApprovalAction::Reject,
                    "accepted" => ApprovalAction::Accept,
                    "force-approved" => ApprovalAction::ForceApprove,
                    _ => continue,
                };
                let key = format!("{}::{}", finding.doc, finding.anchor);
                out.approvals.entry(key).or_default().push(Approval {
                    action,
                    actor: res.actor.clone(),
                    at: res.at,
                    reason: res.reason.clone(),
                });
            }
        }
        out
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Approval {
    pub action: ApprovalAction,
    pub actor: String,
    pub at: DateTime<Utc>,
    /// Operator-supplied free-text reason. Required (non-empty) for
    /// `force-approve` per FR-026; ignored for `reject` / `accept`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ApprovalAction {
    Reject,
    Accept,
    ForceApprove,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum GateDecision {
    /// Every diff is wording or has been resolved; pipeline advances.
    Pass,
    /// Wording diffs only; same as Pass but the audit payload records
    /// the warnings.
    PassWithWarnings,
    /// At least one blocking diff is unresolved.
    Fail,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GateResult {
    pub decision: GateDecision,
    pub blocking: Vec<BlockingDiff>,
    pub audit: AuditPayload,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BlockingDiff {
    pub doc: String,
    pub anchor: String,
    pub class: String,
    pub reason: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AuditPayload {
    /// Always `factory.stage_cd_gate_evaluated`.
    pub action: String,
    pub project: String,
    pub mode: String,
    pub decision: GateDecision,
    pub diff_counts: GateDiffCounts,
    pub blocking_diffs: Vec<String>,
    pub at: DateTime<Utc>,
}

#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GateDiffCounts {
    pub wording: u32,
    pub structural: u32,
    pub scope: u32,
    pub external_entity: u32,
    pub ownership: u32,
    pub citation: u32,
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

/// Evaluate `QG-CD-01_StakeholderDocAlignment` against a comparator
/// diff and an approval ledger. Pure: no I/O. The caller writes the
/// `AuditPayload` to the audit-log sink.
pub fn evaluate_qg_cd_01(
    diff: &StageCdDiff,
    config: &GateConfig,
    approvals: &ApprovalLedger,
    project_slug: &str,
    now: DateTime<Utc>,
) -> GateResult {
    let mut blocking: Vec<BlockingDiff> = Vec::new();
    let mut counts = GateDiffCounts::default();

    for finding in &diff.findings {
        match finding.class.as_str() {
            "wording" => counts.wording += 1,
            "structural" => {
                counts.structural += 1;
                if !is_resolved(finding, approvals, config) {
                    blocking.push(BlockingDiff {
                        doc: finding.doc.clone(),
                        anchor: finding.anchor.clone(),
                        class: "structural".to_string(),
                        reason: "structural diff requires explicit operator approval".to_string(),
                    });
                }
            }
            "scope" => {
                counts.scope += 1;
                if !is_resolved(finding, approvals, config) {
                    blocking.push(BlockingDiff {
                        doc: finding.doc.clone(),
                        anchor: finding.anchor.clone(),
                        class: "scope".to_string(),
                        reason: "scope diffs are gate-blocking unless force-approved".to_string(),
                    });
                }
            }
            "external-entity" => {
                counts.external_entity += 1;
                if !is_resolved(finding, approvals, config) {
                    blocking.push(BlockingDiff {
                        doc: finding.doc.clone(),
                        anchor: finding.anchor.clone(),
                        class: "external-entity".to_string(),
                        reason: "external-entity diffs are gate-blocking unless force-approved".to_string(),
                    });
                }
            }
            "ownership" => {
                counts.ownership += 1;
                if !is_resolved(finding, approvals, config) {
                    blocking.push(BlockingDiff {
                        doc: finding.doc.clone(),
                        anchor: finding.anchor.clone(),
                        class: "ownership".to_string(),
                        reason: "ownership diffs are gate-blocking unless force-approved".to_string(),
                    });
                }
            }
            "citation" => {
                counts.citation += 1;
                if !is_resolved(finding, approvals, config) {
                    blocking.push(BlockingDiff {
                        doc: finding.doc.clone(),
                        anchor: finding.anchor.clone(),
                        class: "citation".to_string(),
                        reason: "citation diffs are gate-blocking unless force-approved".to_string(),
                    });
                }
            }
            other => {
                // Unknown class — fail closed. A new class added by a
                // spec amendment that isn't wired here MUST block the
                // gate rather than silently pass.
                blocking.push(BlockingDiff {
                    doc: finding.doc.clone(),
                    anchor: finding.anchor.clone(),
                    class: other.to_string(),
                    reason: format!(
                        "unknown diff class '{other}': fail-closed default"
                    ),
                });
            }
        }
    }

    let decision = if !blocking.is_empty() {
        GateDecision::Fail
    } else if counts.wording > 0 {
        GateDecision::PassWithWarnings
    } else {
        GateDecision::Pass
    };

    let audit = AuditPayload {
        action: "factory.stage_cd_gate_evaluated".to_string(),
        project: project_slug.to_string(),
        mode: diff.mode.clone(),
        decision: decision.clone(),
        diff_counts: counts,
        blocking_diffs: blocking
            .iter()
            .map(|b| format!("{}::{}::{}", b.doc, b.anchor, b.class))
            .collect(),
        at: now,
    };

    GateResult {
        decision,
        blocking,
        audit,
    }
}

// ---------------------------------------------------------------------------
// Resolution check
// ---------------------------------------------------------------------------

/// True when the diff has been resolved by an operator action under
/// the workspace's co-approval policy.
fn is_resolved(
    finding: &StageCdDiffFinding,
    approvals: &ApprovalLedger,
    config: &GateConfig,
) -> bool {
    let key = format!("{}::{}", finding.doc, finding.anchor);
    let entries = match approvals.approvals.get(&key) {
        Some(v) => v,
        None => return false,
    };
    // `Reject candidate` always satisfies — the operator dismissed the
    // diff and the authored truth wins.
    if entries
        .iter()
        .any(|a| matches!(a.action, ApprovalAction::Reject))
    {
        return true;
    }
    // `Accept candidate` — operator merged the candidate; gate
    // satisfied for that anchor too.
    if entries
        .iter()
        .any(|a| matches!(a.action, ApprovalAction::Accept))
    {
        return true;
    }
    // `Force approve` — count force-approvals. Co-approval policy may
    // require two distinct actors for `scope` / `ownership`.
    let force_approvals: Vec<&Approval> = entries
        .iter()
        .filter(|a| matches!(a.action, ApprovalAction::ForceApprove))
        .collect();
    if force_approvals.is_empty() {
        return false;
    }
    let needs_co_approval = matches!(
        config.co_approval,
        WorkspaceCoApprovalPolicy::ScopeOwnership
    ) && matches!(finding.class.as_str(), "scope" | "ownership");
    if !needs_co_approval {
        return true;
    }
    // Co-approval required: at least two force-approvals from distinct
    // actors. The same actor pressing the button twice is not
    // sufficient.
    let mut actors = std::collections::BTreeSet::new();
    for fa in &force_approvals {
        actors.insert(fa.actor.as_str());
    }
    actors.len() >= 2
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use crate::stages::stage_cd_comparator::StageCdDiffCounts;
    use chrono::TimeZone;

    fn fixed_now() -> DateTime<Utc> {
        Utc.with_ymd_and_hms(2026, 4, 30, 12, 0, 0).unwrap()
    }

    fn finding(doc: &str, anchor: &str, class: &str) -> StageCdDiffFinding {
        StageCdDiffFinding {
            doc: doc.to_string(),
            anchor: anchor.to_string(),
            class: class.to_string(),
            authored_excerpt: None,
            candidate_excerpt: None,
            pairing: "exact-anchor".to_string(),
            resolution: None,
        }
    }

    fn diff_with(findings: Vec<StageCdDiffFinding>) -> StageCdDiff {
        StageCdDiff {
            generated_at: fixed_now(),
            mode: "compare".to_string(),
            findings,
            counts: StageCdDiffCounts::default(),
        }
    }

    fn ledger_with(
        key: &str,
        action: ApprovalAction,
        actor: &str,
    ) -> ApprovalLedger {
        let mut l = ApprovalLedger::default();
        l.approvals.insert(
            key.to_string(),
            vec![Approval {
                action,
                actor: actor.to_string(),
                at: fixed_now(),
                reason: matches!(action, ApprovalAction::ForceApprove)
                    .then(|| "policy approved".to_string()),
            }],
        );
        l
    }

    #[test]
    fn passes_with_no_findings() {
        let r = evaluate_qg_cd_01(
            &diff_with(vec![]),
            &GateConfig::default(),
            &ApprovalLedger::default(),
            "p",
            fixed_now(),
        );
        assert_eq!(r.decision, GateDecision::Pass);
    }

    #[test]
    fn passes_with_warnings_on_wording_only() {
        let r = evaluate_qg_cd_01(
            &diff_with(vec![finding("charter.md", "OBJ-1", "wording")]),
            &GateConfig::default(),
            &ApprovalLedger::default(),
            "p",
            fixed_now(),
        );
        assert_eq!(r.decision, GateDecision::PassWithWarnings);
        assert_eq!(r.blocking.len(), 0);
        assert_eq!(r.audit.diff_counts.wording, 1);
    }

    #[test]
    fn fails_on_scope() {
        let r = evaluate_qg_cd_01(
            &diff_with(vec![finding("charter.md", "OUT-SCOPE-3", "scope")]),
            &GateConfig::default(),
            &ApprovalLedger::default(),
            "p",
            fixed_now(),
        );
        assert_eq!(r.decision, GateDecision::Fail);
        assert_eq!(r.blocking.len(), 1);
        assert_eq!(r.blocking[0].class, "scope");
    }

    #[test]
    fn fails_on_external_entity() {
        let r = evaluate_qg_cd_01(
            &diff_with(vec![finding("charter.md", "OBJ-1", "external-entity")]),
            &GateConfig::default(),
            &ApprovalLedger::default(),
            "p",
            fixed_now(),
        );
        assert_eq!(r.decision, GateDecision::Fail);
    }

    #[test]
    fn fails_on_ownership() {
        let r = evaluate_qg_cd_01(
            &diff_with(vec![finding("charter.md", "OWNER-1", "ownership")]),
            &GateConfig::default(),
            &ApprovalLedger::default(),
            "p",
            fixed_now(),
        );
        assert_eq!(r.decision, GateDecision::Fail);
    }

    #[test]
    fn fails_on_citation() {
        let r = evaluate_qg_cd_01(
            &diff_with(vec![finding("charter.md", "OBJ-1", "citation")]),
            &GateConfig::default(),
            &ApprovalLedger::default(),
            "p",
            fixed_now(),
        );
        assert_eq!(r.decision, GateDecision::Fail);
    }

    #[test]
    fn fails_on_structural_without_approval() {
        let r = evaluate_qg_cd_01(
            &diff_with(vec![finding("charter.md", "OBJ-9", "structural")]),
            &GateConfig::default(),
            &ApprovalLedger::default(),
            "p",
            fixed_now(),
        );
        assert_eq!(r.decision, GateDecision::Fail);
    }

    #[test]
    fn passes_on_structural_with_explicit_approval() {
        let ledger = ledger_with(
            "charter.md::OBJ-9",
            ApprovalAction::ForceApprove,
            "alice",
        );
        let r = evaluate_qg_cd_01(
            &diff_with(vec![finding("charter.md", "OBJ-9", "structural")]),
            &GateConfig::default(),
            &ledger,
            "p",
            fixed_now(),
        );
        assert_eq!(r.decision, GateDecision::Pass);
    }

    #[test]
    fn reject_action_satisfies_diff() {
        let ledger =
            ledger_with("charter.md::OUT-SCOPE-3", ApprovalAction::Reject, "alice");
        let r = evaluate_qg_cd_01(
            &diff_with(vec![finding("charter.md", "OUT-SCOPE-3", "scope")]),
            &GateConfig::default(),
            &ledger,
            "p",
            fixed_now(),
        );
        assert_eq!(r.decision, GateDecision::Pass);
    }

    #[test]
    fn accept_action_satisfies_diff() {
        let ledger =
            ledger_with("charter.md::OBJ-1", ApprovalAction::Accept, "alice");
        let r = evaluate_qg_cd_01(
            &diff_with(vec![finding("charter.md", "OBJ-1", "ownership")]),
            &GateConfig::default(),
            &ledger,
            "p",
            fixed_now(),
        );
        assert_eq!(r.decision, GateDecision::Pass);
    }

    #[test]
    fn co_approval_policy_blocks_single_force_approve_on_scope() {
        let ledger = ledger_with(
            "charter.md::OUT-SCOPE-3",
            ApprovalAction::ForceApprove,
            "alice",
        );
        let r = evaluate_qg_cd_01(
            &diff_with(vec![finding("charter.md", "OUT-SCOPE-3", "scope")]),
            &GateConfig {
                co_approval: WorkspaceCoApprovalPolicy::ScopeOwnership,
            },
            &ledger,
            "p",
            fixed_now(),
        );
        assert_eq!(
            r.decision,
            GateDecision::Fail,
            "scope force-approve must require co-approver under policy"
        );
    }

    #[test]
    fn co_approval_policy_passes_with_two_distinct_force_approves() {
        let mut ledger = ApprovalLedger::default();
        ledger.approvals.insert(
            "charter.md::OUT-SCOPE-3".to_string(),
            vec![
                Approval {
                    action: ApprovalAction::ForceApprove,
                    actor: "alice".into(),
                    at: fixed_now(),
                    reason: Some("first".into()),
                },
                Approval {
                    action: ApprovalAction::ForceApprove,
                    actor: "bob".into(),
                    at: fixed_now(),
                    reason: Some("second".into()),
                },
            ],
        );
        let r = evaluate_qg_cd_01(
            &diff_with(vec![finding("charter.md", "OUT-SCOPE-3", "scope")]),
            &GateConfig {
                co_approval: WorkspaceCoApprovalPolicy::ScopeOwnership,
            },
            &ledger,
            "p",
            fixed_now(),
        );
        assert_eq!(r.decision, GateDecision::Pass);
    }

    #[test]
    fn co_approval_policy_does_not_apply_to_external_entity() {
        // FR-026 only requires co-approval for `scope` and `ownership`.
        let ledger = ledger_with(
            "charter.md::OBJ-1",
            ApprovalAction::ForceApprove,
            "alice",
        );
        let r = evaluate_qg_cd_01(
            &diff_with(vec![finding("charter.md", "OBJ-1", "external-entity")]),
            &GateConfig {
                co_approval: WorkspaceCoApprovalPolicy::ScopeOwnership,
            },
            &ledger,
            "p",
            fixed_now(),
        );
        assert_eq!(r.decision, GateDecision::Pass);
    }

    #[test]
    fn co_approval_two_actions_from_same_actor_does_not_pass() {
        // Same operator pressing force-approve twice is not a
        // co-approval. The second approver MUST be a distinct actor.
        let mut ledger = ApprovalLedger::default();
        ledger.approvals.insert(
            "charter.md::OUT-SCOPE-3".to_string(),
            vec![
                Approval {
                    action: ApprovalAction::ForceApprove,
                    actor: "alice".into(),
                    at: fixed_now(),
                    reason: Some("first".into()),
                },
                Approval {
                    action: ApprovalAction::ForceApprove,
                    actor: "alice".into(),
                    at: fixed_now(),
                    reason: Some("again".into()),
                },
            ],
        );
        let r = evaluate_qg_cd_01(
            &diff_with(vec![finding("charter.md", "OUT-SCOPE-3", "scope")]),
            &GateConfig {
                co_approval: WorkspaceCoApprovalPolicy::ScopeOwnership,
            },
            &ledger,
            "p",
            fixed_now(),
        );
        assert_eq!(r.decision, GateDecision::Fail);
    }

    #[test]
    fn unknown_diff_class_fails_closed() {
        // A future spec amendment that adds a new class MUST not
        // silently pass through this gate. Fail-closed default applies.
        let r = evaluate_qg_cd_01(
            &diff_with(vec![finding("charter.md", "OBJ-1", "unknown-class")]),
            &GateConfig::default(),
            &ApprovalLedger::default(),
            "p",
            fixed_now(),
        );
        assert_eq!(r.decision, GateDecision::Fail);
    }

    #[test]
    fn approval_ledger_from_diff_round_trips_resolutions() {
        // Reviewer pass 2: the on-disk diff is the single source of
        // truth. A persisted `DiffResolution` must reconstruct into
        // an `Approval` in the ledger so the gate has the same view
        // whether the JS hands it a ledger or the gate derives one.
        use crate::stages::stage_cd_comparator::DiffResolution;
        let mut diff = diff_with(vec![finding(
            "charter.md",
            "OUT-SCOPE-3",
            "scope",
        )]);
        diff.findings[0].resolution = Some(DiffResolution {
            action: "force-approved".to_string(),
            actor: "alice".to_string(),
            at: fixed_now(),
            reason: Some("policy approved".to_string()),
        });
        let ledger = ApprovalLedger::from_diff(&diff);
        let r = evaluate_qg_cd_01(
            &diff,
            &GateConfig::default(),
            &ledger,
            "p",
            fixed_now(),
        );
        assert_eq!(
            r.decision,
            GateDecision::Pass,
            "ledger derived from persisted resolution must satisfy the gate"
        );
    }

    #[test]
    fn audit_payload_carries_required_fields() {
        let r = evaluate_qg_cd_01(
            &diff_with(vec![
                finding("charter.md", "OBJ-1", "wording"),
                finding("charter.md", "OUT-SCOPE-3", "scope"),
            ]),
            &GateConfig::default(),
            &ApprovalLedger::default(),
            "example",
            fixed_now(),
        );
        assert_eq!(r.audit.action, "factory.stage_cd_gate_evaluated");
        assert_eq!(r.audit.project, "example");
        assert_eq!(r.audit.diff_counts.wording, 1);
        assert_eq!(r.audit.diff_counts.scope, 1);
        assert_eq!(r.audit.blocking_diffs.len(), 1);
    }
}
