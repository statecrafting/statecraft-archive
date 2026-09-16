//! FR-006 / FR-007: deterministic policy evaluation for a tool call against a compiled bundle.
//! FR-008 / SC-007 / SC-008: coherence scheduler (see [`coherence`]).
//! FR-009 / FR-010 / NF-004 / SC-009: proof-chain records (see [`proof_chain`]).
//!
//! ## Permission Runtime (spec 068)
//!
//! The permission runtime adds 5-tier settings layering, glob-based rule matching,
//! denial tracking with escalation, live settings reload, and audit logging.
//! See [`permission`], [`settings`], [`merge`], [`denial`], [`watcher`], [`audit`].

pub mod coherence;
pub mod proof_chain;

// --- spec 068: Permission Runtime and Settings Layering ---
pub mod audit;
pub mod denial;
pub mod merge;
pub mod permission;
pub mod settings;
#[cfg(feature = "native")]
pub mod watcher;

// --- spec 121: Workspace provenance policy slice ---
pub mod provenance_policy;

pub use coherence::{CoherenceScheduler, CoherenceSchedulerConfig, PrivilegeLevel};
pub use proof_chain::{
    NF004_MAX_BYTES_EXCLUDING_CONTEXT, ProofChainError, ProofChainWriter, ProofPrivilege,
    ProofRecord, ProofRecordDecision, compute_record_hash, nf004_payload_bytes, verify_proof_chain,
};

use action_gate_core::{ActionContext, Check, Decision, Gate, Outcome};
use regex::Regex;
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};
use std::sync::{Arc, OnceLock};

/// Policy rule as emitted by the policy compiler (`specs/047` fenced `policy` blocks).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct PolicyRule {
    pub id: String,
    pub description: String,
    pub mode: String,
    pub scope: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub gate: Option<String>,
    #[serde(rename = "sourcePath")]
    pub source_path: String,
    /// When `true` on a `destructive_operation` constitution rule, permits destructive patterns.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub allow_destructive: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub allowed_tools: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_diff_lines: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_diff_bytes: Option<u64>,
}

/// Active constitution + shards (subset of `policy-bundle.json`).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct PolicyBundle {
    pub constitution: Vec<PolicyRule>,
    pub shards: BTreeMap<String, Vec<PolicyRule>>,
}

/// Inputs for a single evaluation (NF-003: all data passed in — no host calls).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ToolCallContext {
    pub tool_name: String,
    /// Concatenated or JSON-serialized arguments for scanning.
    pub arguments_summary: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub proposed_file_content: Option<String>,
    /// Set for write/edit operations when diff metrics are known.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub diff_lines: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub diff_bytes: Option<u64>,
    /// Shard scope tags to merge (e.g. `domain:payments`). Constitution is always included.
    #[serde(default)]
    pub active_shard_scopes: Vec<String>,

    // --- spec 093: Spec-driven preflight fields ---
    /// Feature IDs affected by the tool call's target files (populated via featuregraph lookup).
    #[serde(default)]
    pub feature_ids: Vec<String>,
    /// Highest risk level among affected features: low / medium / high / critical.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_spec_risk: Option<String>,
    /// Deduplicated design statuses of affected features: draft / approved / superseded / retired.
    #[serde(default)]
    pub spec_statuses: Vec<String>,
    /// Deduplicated implementation statuses of affected features: pending / in-progress / complete / n/a.
    #[serde(default)]
    pub spec_impl_statuses: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum PolicyOutcome {
    Allow,
    Deny,
    Degrade,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct PolicyDecision {
    pub outcome: PolicyOutcome,
    /// Stable, machine-readable reason code + detail.
    pub reason: String,
    /// Rule ids consulted for this outcome (may be empty for unconditional allow).
    #[serde(default)]
    pub rule_ids: Vec<String>,
}

/// Core entrypoint (FR-006).
///
/// Spec 231: implemented over the extracted `action-gate` crate. OAP's six
/// domain checks are registered as `impl Check` in the original evaluation
/// order; the code-governance-shaped `ToolCallContext` maps to a domain-neutral
/// `ActionContext` (typed extras go into `attributes`, read only by OAP's own
/// checks, never by the gate core). The `PolicyDecision` shape, reason codes,
/// bundle-derived rule ids, and first-match short-circuit order are all
/// preserved, guarded by the tests below.
pub fn evaluate(ctx: &ToolCallContext, bundle: &PolicyBundle) -> PolicyDecision {
    let action_ctx = to_action_context(ctx);
    // Checks that consult the bundle share one Arc clone per evaluation.
    let shared = Arc::new(bundle.clone());
    let gate = Gate::builder()
        .check(SecretsCheck {
            bundle: shared.clone(),
        })
        .check(DestructiveCheck {
            bundle: shared.clone(),
        })
        .check(AllowlistCheck {
            bundle: shared.clone(),
        })
        .check(SpecStatusCheck)
        .check(SpecRiskCheck)
        .check(DiffSizeCheck { bundle: shared })
        .build();
    to_policy_decision(gate.evaluate(&action_ctx))
}

/// Map OAP's typed evaluation context onto the domain-neutral `ActionContext`.
/// The gate core never inspects `attributes`; only OAP's own checks do.
fn to_action_context(ctx: &ToolCallContext) -> ActionContext {
    use serde_json::json;
    let mut ac =
        ActionContext::new(ctx.tool_name.clone()).with_summary(ctx.arguments_summary.clone());
    if let Some(body) = &ctx.proposed_file_content {
        ac = ac.with_body(body.clone());
    }
    if let Some(dl) = ctx.diff_lines {
        ac = ac.with_attr("diff_lines", json!(dl));
    }
    if let Some(db) = ctx.diff_bytes {
        ac = ac.with_attr("diff_bytes", json!(db));
    }
    ac = ac.with_attr("active_shard_scopes", json!(ctx.active_shard_scopes));
    if let Some(risk) = &ctx.max_spec_risk {
        ac = ac.with_attr("max_spec_risk", json!(risk));
    }
    ac = ac.with_attr("spec_statuses", json!(ctx.spec_statuses));
    ac
}

/// Map a gate `Decision` back to OAP's `PolicyDecision`. OAP carries its
/// bundle-derived rule ids in the gate's `check_ids` field. The unconditional
/// allow keeps OAP's historical reason code.
fn to_policy_decision(d: Decision) -> PolicyDecision {
    match d.outcome {
        Outcome::Allow => PolicyDecision {
            outcome: PolicyOutcome::Allow,
            reason: "policy:allow:no_gate_triggered".into(),
            rule_ids: vec![],
        },
        Outcome::Deny => PolicyDecision {
            outcome: PolicyOutcome::Deny,
            reason: d.reason,
            rule_ids: d.check_ids,
        },
        Outcome::Degrade => PolicyDecision {
            outcome: PolicyOutcome::Degrade,
            reason: d.reason,
            rule_ids: d.check_ids,
        },
    }
}

/// Read a JSON string-array attribute as a `Vec<String>`.
fn attr_string_vec(ctx: &ActionContext, key: &str) -> Vec<String> {
    ctx.attr(key)
        .and_then(|v| v.as_array())
        .map(|a| {
            a.iter()
                .filter_map(|x| x.as_str().map(String::from))
                .collect()
        })
        .unwrap_or_default()
}

/// KERNEL:BUILTIN-SECRETS: deny when the payload matches a credential pattern.
struct SecretsCheck {
    bundle: Arc<PolicyBundle>,
}
impl Check for SecretsCheck {
    fn id(&self) -> &str {
        "secrets_scanner"
    }
    fn evaluate(&self, ctx: &ActionContext) -> Option<Decision> {
        let haystack = format!(
            "{}\n{}",
            ctx.payload_summary,
            ctx.payload_body.as_deref().unwrap_or("")
        );
        if !secrets_match(&haystack) {
            return None;
        }
        let rule_id = self
            .bundle
            .constitution
            .iter()
            .find(|r| r.mode == "enforce" && r.gate.as_deref() == Some("secrets_scanner"))
            .map(|r| r.id.clone())
            .unwrap_or_else(|| "KERNEL:BUILTIN-SECRETS".into());
        Some(Decision::deny(
            "policy:deny:secrets_scanner:pattern_match",
            vec![rule_id],
        ))
    }
}

/// Deny destructive operations unless the constitution explicitly permits them.
struct DestructiveCheck {
    bundle: Arc<PolicyBundle>,
}
impl Check for DestructiveCheck {
    fn id(&self) -> &str {
        "destructive_operation"
    }
    fn evaluate(&self, ctx: &ActionContext) -> Option<Decision> {
        if !destructive_match(&ctx.action, &ctx.payload_summary) {
            return None;
        }
        let permitted = self.bundle.constitution.iter().any(|r| {
            r.gate.as_deref() == Some("destructive_operation") && r.allow_destructive == Some(true)
        });
        if permitted {
            return None;
        }
        let rule_id = self
            .bundle
            .constitution
            .iter()
            .find(|r| r.gate.as_deref() == Some("destructive_operation") && r.mode == "enforce")
            .map(|r| r.id.clone())
            .unwrap_or_else(|| "KERNEL:BUILTIN-DESTRUCTIVE".into());
        Some(Decision::deny(
            "policy:deny:destructive_operation:matched_pattern",
            vec![rule_id],
        ))
    }
}

/// Deny tools absent from the merged (constitution + active-shard) allowlist.
struct AllowlistCheck {
    bundle: Arc<PolicyBundle>,
}
impl Check for AllowlistCheck {
    fn id(&self) -> &str {
        "tool_allowlist"
    }
    fn evaluate(&self, ctx: &ActionContext) -> Option<Decision> {
        let scopes = attr_string_vec(ctx, "active_shard_scopes");
        let mut allowed: Vec<String> = Vec::new();
        let mut originating_rule_ids: BTreeSet<String> = BTreeSet::new();
        for r in &self.bundle.constitution {
            if r.gate.as_deref() == Some("tool_allowlist") {
                originating_rule_ids.insert(r.id.clone());
                if let Some(ref tools) = r.allowed_tools {
                    allowed.extend(tools.iter().cloned());
                }
            }
        }
        for scope in &scopes {
            if let Some(rules) = self.bundle.shards.get(scope) {
                for r in rules {
                    if r.gate.as_deref() == Some("tool_allowlist") {
                        originating_rule_ids.insert(r.id.clone());
                        if let Some(ref tools) = r.allowed_tools {
                            allowed.extend(tools.iter().cloned());
                        }
                    }
                }
            }
        }
        if allowed.is_empty() {
            return None;
        }
        let set: BTreeSet<_> = allowed.into_iter().collect();
        if set.contains(&ctx.action) {
            None
        } else {
            Some(Decision::deny(
                "policy:deny:tool_allowlist:not_listed",
                originating_rule_ids.into_iter().collect(),
            ))
        }
    }
}

/// Spec 093, Slice 3: draft specs degrade to read-only; superseded/retired deny.
struct SpecStatusCheck;
impl Check for SpecStatusCheck {
    fn id(&self) -> &str {
        "spec_status"
    }
    fn evaluate(&self, ctx: &ActionContext) -> Option<Decision> {
        let statuses = attr_string_vec(ctx, "spec_statuses");
        if statuses.is_empty() {
            return None;
        }
        if statuses.iter().any(|s| s == "superseded" || s == "retired") {
            return Some(Decision::deny(
                "policy:deny:spec_status:superseded_or_retired",
                vec!["KERNEL:SPEC-STATUS".into()],
            ));
        }
        if statuses.iter().any(|s| s == "draft") {
            return Some(Decision::degrade(
                "policy:degrade:spec_status:draft_read_only",
                vec!["KERNEL:SPEC-STATUS".into()],
            ));
        }
        None
    }
}

/// Spec 093, Slice 4: critical/high spec risk degrades (gated); others allow.
struct SpecRiskCheck;
impl Check for SpecRiskCheck {
    fn id(&self) -> &str {
        "spec_risk"
    }
    fn evaluate(&self, ctx: &ActionContext) -> Option<Decision> {
        match ctx.attr_str("max_spec_risk") {
            Some("critical") => Some(Decision::degrade(
                "policy:degrade:spec_risk:critical_requires_confirmation",
                vec!["KERNEL:SPEC-RISK".into()],
            )),
            Some("high") => Some(Decision::degrade(
                "policy:degrade:spec_risk:high_gated",
                vec!["KERNEL:SPEC-RISK".into()],
            )),
            _ => None,
        }
    }
}

/// Deny diffs exceeding the tightest applicable line/byte limit.
struct DiffSizeCheck {
    bundle: Arc<PolicyBundle>,
}
impl Check for DiffSizeCheck {
    fn id(&self) -> &str {
        "diff_size_limiter"
    }
    fn evaluate(&self, ctx: &ActionContext) -> Option<Decision> {
        let scopes = attr_string_vec(ctx, "active_shard_scopes");
        let refs = applicable_rules_for_scopes(&self.bundle, &scopes);
        let (max_lines, max_bytes) = effective_diff_limits(&refs);

        let diff_lines = ctx
            .attr("diff_lines")
            .and_then(|v| v.as_u64())
            .map(|v| v as u32);
        if let (Some(dl), Some(limit)) = (diff_lines, max_lines)
            && dl > limit
        {
            let rule_id = refs
                .iter()
                .find(|r| {
                    r.gate.as_deref() == Some("diff_size_limiter")
                        && r.max_diff_lines == Some(limit)
                })
                .map(|r| r.id.clone())
                .unwrap_or_else(|| "KERNEL:BUILTIN-DIFF".into());
            return Some(Decision::deny(
                "policy:deny:diff_size_limiter:threshold_exceeded",
                vec![rule_id],
            ));
        }

        let diff_bytes = ctx.attr("diff_bytes").and_then(|v| v.as_u64());
        if let (Some(db), Some(limit)) = (diff_bytes, max_bytes)
            && db > limit
        {
            let rule_id = refs
                .iter()
                .find(|r| {
                    r.gate.as_deref() == Some("diff_size_limiter")
                        && r.max_diff_bytes == Some(limit)
                })
                .map(|r| r.id.clone())
                .unwrap_or_else(|| "KERNEL:BUILTIN-DIFF".into());
            return Some(Decision::deny(
                "policy:deny:diff_size_limiter:threshold_exceeded",
                vec![rule_id],
            ));
        }

        None
    }
}

fn applicable_rules_for_scopes<'a>(
    bundle: &'a PolicyBundle,
    scopes: &[String],
) -> Vec<&'a PolicyRule> {
    let mut v: Vec<&PolicyRule> = bundle.constitution.iter().collect();
    for scope in scopes {
        if let Some(rules) = bundle.shards.get(scope) {
            v.extend(rules.iter());
        }
    }
    v
}

fn effective_diff_limits(rules: &[&PolicyRule]) -> (Option<u32>, Option<u64>) {
    let mut min_lines: Option<u32> = None;
    let mut min_bytes: Option<u64> = None;
    for r in rules {
        if r.gate.as_deref() != Some("diff_size_limiter") {
            continue;
        }
        if let Some(ml) = r.max_diff_lines {
            min_lines = Some(match min_lines {
                None => ml,
                Some(x) => x.min(ml),
            });
        }
        if let Some(mb) = r.max_diff_bytes {
            min_bytes = Some(match min_bytes {
                None => mb,
                Some(x) => x.min(mb),
            });
        }
    }
    (min_lines, min_bytes)
}

fn secrets_match(haystack: &str) -> bool {
    for re in secret_regexes().iter() {
        if re.is_match(haystack) {
            return true;
        }
    }
    false
}

fn secret_regexes() -> &'static [Regex] {
    static RE: OnceLock<Vec<Regex>> = OnceLock::new();
    RE.get_or_init(|| {
        vec![
            Regex::new(r"(?i)sk-[a-zA-Z0-9]{20,}").expect("regex"),
            Regex::new(r"(?i)-----BEGIN [A-Z ]*PRIVATE KEY-----").expect("regex"),
            Regex::new(r#"(?i)(api[_-]?key|secret|token)\s*[:=]\s*['\"]?[a-zA-Z0-9_\-]{24,}"#)
                .expect("regex"),
        ]
    })
}

fn destructive_match(tool_name: &str, args: &str) -> bool {
    let combined = format!("{tool_name}\n{args}");
    let lower = combined.to_lowercase();
    DESTRUCTIVE_SUBSTRINGS.iter().any(|s| lower.contains(s))
}

static DESTRUCTIVE_SUBSTRINGS: &[&str] = &[
    "rm -rf",
    "rm -fr",
    "git reset --hard",
    "delete_file",
    "shred ",
    "mkfs.",
];

/// Serialize decision to canonical JSON bytes for determinism checks (sorted keys).
pub fn decision_to_canonical_json(decision: &PolicyDecision) -> String {
    let v = serde_json::to_value(decision).expect("decision json");
    canonical_json_sorted(v)
}

/// Canonical (recursively key-sorted) JSON serialization.
///
/// Spec 231: delegates to the extracted `canonical-keysort-json` crate, so
/// OAP is consumer-zero of the shared primitive rather than carrying its own
/// sorter. The `spec231_canonical_json_parity_with_extracted_crate` test pins
/// that this produces byte-identical output to the previous in-tree
/// implementation, so every proof-chain and audit-chain hash is unchanged.
pub(crate) fn canonical_json_sorted(v: serde_json::Value) -> String {
    canonical_keysort_json::to_canonical_string(&v)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn bundle_from_constitution(rules: Vec<PolicyRule>) -> PolicyBundle {
        PolicyBundle {
            constitution: rules,
            shards: BTreeMap::new(),
        }
    }

    #[test]
    fn sc003_destructive_operation_denies_with_rule_id() {
        let bundle = bundle_from_constitution(vec![PolicyRule {
            id: "D-1".into(),
            description: "block destructive".into(),
            mode: "enforce".into(),
            scope: "global".into(),
            gate: Some("destructive_operation".into()),
            source_path: "CLAUDE.md".into(),
            allow_destructive: None,
            allowed_tools: None,
            max_diff_lines: None,
            max_diff_bytes: None,
        }]);
        let ctx = ToolCallContext {
            tool_name: "bash".into(),
            arguments_summary: "rm -rf /tmp/x".into(),
            proposed_file_content: None,
            diff_lines: None,
            diff_bytes: None,
            active_shard_scopes: vec![],
            feature_ids: vec![],
            max_spec_risk: None,
            spec_statuses: vec![],
            spec_impl_statuses: vec![],
        };
        let d = evaluate(&ctx, &bundle);
        assert_eq!(d.outcome, PolicyOutcome::Deny);
        assert_eq!(d.rule_ids, vec!["D-1"]);
        assert!(d.reason.contains("destructive"));
    }

    #[test]
    fn sc004_secrets_scanner_denies_even_with_other_rules() {
        let bundle = bundle_from_constitution(vec![
            PolicyRule {
                id: "S-1".into(),
                description: "secrets".into(),
                mode: "enforce".into(),
                scope: "global".into(),
                gate: Some("secrets_scanner".into()),
                source_path: "CLAUDE.md".into(),
                allow_destructive: None,
                allowed_tools: None,
                max_diff_lines: None,
                max_diff_bytes: None,
            },
            PolicyRule {
                id: "D-1".into(),
                description: "destructive".into(),
                mode: "enforce".into(),
                scope: "global".into(),
                gate: Some("destructive_operation".into()),
                source_path: "CLAUDE.md".into(),
                allow_destructive: None,
                allowed_tools: None,
                max_diff_lines: None,
                max_diff_bytes: None,
            },
        ]);
        let ctx = ToolCallContext {
            tool_name: "write".into(),
            arguments_summary: r#"sk-123456789012345678901234567890"#.into(),
            proposed_file_content: None,
            diff_lines: None,
            diff_bytes: None,
            active_shard_scopes: vec![],
            feature_ids: vec![],
            max_spec_risk: None,
            spec_statuses: vec![],
            spec_impl_statuses: vec![],
        };
        let d = evaluate(&ctx, &bundle);
        assert_eq!(d.outcome, PolicyOutcome::Deny);
        assert_eq!(d.rule_ids, vec!["S-1"]);
        assert!(d.reason.contains("secrets"));
    }

    #[test]
    fn sc005_tool_allowlist_denies_unknown_tool() {
        let bundle = bundle_from_constitution(vec![PolicyRule {
            id: "T-1".into(),
            description: "tools".into(),
            mode: "enforce".into(),
            scope: "global".into(),
            gate: Some("tool_allowlist".into()),
            source_path: "CLAUDE.md".into(),
            allow_destructive: None,
            allowed_tools: Some(vec!["read_file".into(), "grep".into()]),
            max_diff_lines: None,
            max_diff_bytes: None,
        }]);
        let ctx = ToolCallContext {
            tool_name: "shell".into(),
            arguments_summary: "".into(),
            proposed_file_content: None,
            diff_lines: None,
            diff_bytes: None,
            active_shard_scopes: vec![],
            feature_ids: vec![],
            max_spec_risk: None,
            spec_statuses: vec![],
            spec_impl_statuses: vec![],
        };
        let d = evaluate(&ctx, &bundle);
        assert_eq!(d.outcome, PolicyOutcome::Deny);
        assert_eq!(d.rule_ids, vec!["T-1"]);
        assert!(d.reason.contains("tool_allowlist"));
    }

    #[test]
    fn p3_003_allowlist_merges_originating_rule_ids_from_shards() {
        let mut shards = BTreeMap::new();
        shards.insert(
            "domain:a".into(),
            vec![PolicyRule {
                id: "T-SHARD".into(),
                description: "shard tools".into(),
                mode: "enforce".into(),
                scope: "domain:a".into(),
                gate: Some("tool_allowlist".into()),
                source_path: ".claude/policies/a.md".into(),
                allow_destructive: None,
                allowed_tools: Some(vec!["read_file".into()]),
                max_diff_lines: None,
                max_diff_bytes: None,
            }],
        );
        let bundle = PolicyBundle {
            constitution: vec![PolicyRule {
                id: "T-CON".into(),
                description: "const tools".into(),
                mode: "enforce".into(),
                scope: "global".into(),
                gate: Some("tool_allowlist".into()),
                source_path: "CLAUDE.md".into(),
                allow_destructive: None,
                allowed_tools: Some(vec!["grep".into()]),
                max_diff_lines: None,
                max_diff_bytes: None,
            }],
            shards,
        };
        let ctx = ToolCallContext {
            tool_name: "bash".into(),
            arguments_summary: "".into(),
            proposed_file_content: None,
            diff_lines: None,
            diff_bytes: None,
            active_shard_scopes: vec!["domain:a".into()],
            feature_ids: vec![],
            max_spec_risk: None,
            spec_statuses: vec![],
            spec_impl_statuses: vec![],
        };
        let d = evaluate(&ctx, &bundle);
        assert_eq!(d.outcome, PolicyOutcome::Deny);
        assert_eq!(d.rule_ids, vec!["T-CON", "T-SHARD"]);
    }

    #[test]
    fn sc006_diff_size_limiter_denies_large_diff() {
        let bundle = bundle_from_constitution(vec![PolicyRule {
            id: "L-1".into(),
            description: "diff cap".into(),
            mode: "enforce".into(),
            scope: "global".into(),
            gate: Some("diff_size_limiter".into()),
            source_path: "CLAUDE.md".into(),
            allow_destructive: None,
            allowed_tools: None,
            max_diff_lines: Some(10),
            max_diff_bytes: None,
        }]);
        let ctx = ToolCallContext {
            tool_name: "apply_patch".into(),
            arguments_summary: "".into(),
            proposed_file_content: None,
            diff_lines: Some(100),
            diff_bytes: None,
            active_shard_scopes: vec![],
            feature_ids: vec![],
            max_spec_risk: None,
            spec_statuses: vec![],
            spec_impl_statuses: vec![],
        };
        let d = evaluate(&ctx, &bundle);
        assert_eq!(d.outcome, PolicyOutcome::Deny);
        assert_eq!(d.rule_ids, vec!["L-1"]);
        assert!(d.reason.contains("diff_size"));
    }

    #[test]
    fn determinism_identical_inputs_identical_canonical_json() {
        let bundle = bundle_from_constitution(vec![PolicyRule {
            id: "T-1".into(),
            description: "tools".into(),
            mode: "enforce".into(),
            scope: "global".into(),
            gate: Some("tool_allowlist".into()),
            source_path: "CLAUDE.md".into(),
            allow_destructive: None,
            allowed_tools: Some(vec!["a".into()]),
            max_diff_lines: None,
            max_diff_bytes: None,
        }]);
        let ctx = ToolCallContext {
            tool_name: "b".into(),
            arguments_summary: "".into(),
            proposed_file_content: None,
            diff_lines: None,
            diff_bytes: None,
            active_shard_scopes: vec![],
            feature_ids: vec![],
            max_spec_risk: None,
            spec_statuses: vec![],
            spec_impl_statuses: vec![],
        };
        let a = decision_to_canonical_json(&evaluate(&ctx, &bundle));
        let b = decision_to_canonical_json(&evaluate(&ctx, &bundle));
        assert_eq!(a, b);
    }

    /// Spec 231 linchpin: the extracted `canonical-keysort-json` crate must
    /// produce byte-identical output to OAP's in-tree `canonical_json_sorted`,
    /// or swapping the primitive would silently change every proof-chain and
    /// audit-chain hash. Verified across scalars, nesting, arrays of objects,
    /// unicode, and a real ProofRecord shape.
    #[test]
    fn spec231_canonical_json_parity_with_extracted_crate() {
        use serde_json::json;
        let cases = vec![
            json!({ "z": 1, "a": 2, "m": 3 }),
            json!({ "outer": { "z": 1, "a": 2 }, "alpha": { "y": 3, "b": 4 } }),
            json!([{ "z": 1, "a": 2 }, { "y": 3, "b": 4 }]),
            json!(null),
            json!(42),
            json!(2.5),
            json!("héllo \"wörld\" 日本語"),
            json!({ "nested": [1, { "b": 2, "a": [true, false, null] }], "x": "y" }),
            // A real ProofRecord shape (flat fields, the exact thing hashed).
            serde_json::to_value(ProofRecord {
                id: "00000000-0000-4000-8000-000000000001".into(),
                timestamp: "2026-07-14T00:00:00Z".into(),
                policy_bundle_hash: "sha256:aa".into(),
                rule_ids: vec!["R-1".into(), "R-2".into()],
                input_context_hash: "sha256:bb".into(),
                decision: ProofRecordDecision::Degrade,
                privilege_level: ProofPrivilege::ReadOnly,
                previous_record_hash: "sha256:cc".into(),
                record_hash: "sha256:dd".into(),
            })
            .unwrap(),
        ];
        for v in cases {
            let oap = canonical_json_sorted(v.clone());
            let extracted = canonical_keysort_json::to_canonical_string(&v);
            assert_eq!(oap, extracted, "canonical JSON diverged for {v:?}");
        }
    }

    // --- Spec 093: spec-status gate tests ---

    fn empty_bundle() -> PolicyBundle {
        bundle_from_constitution(vec![])
    }

    fn base_ctx() -> ToolCallContext {
        ToolCallContext {
            tool_name: "write_file".into(),
            arguments_summary: "".into(),
            proposed_file_content: None,
            diff_lines: None,
            diff_bytes: None,
            active_shard_scopes: vec![],
            feature_ids: vec![],
            max_spec_risk: None,
            spec_statuses: vec![],
            spec_impl_statuses: vec![],
        }
    }

    #[test]
    fn sc093_2_draft_status_degrades() {
        let bundle = empty_bundle();
        let mut ctx = base_ctx();
        ctx.spec_statuses = vec!["draft".into()];
        let d = evaluate(&ctx, &bundle);
        assert_eq!(d.outcome, PolicyOutcome::Degrade);
        assert!(d.reason.contains("draft_read_only"));
        assert_eq!(d.rule_ids, vec!["KERNEL:SPEC-STATUS"]);
    }

    #[test]
    fn sc093_superseded_status_denies() {
        let bundle = empty_bundle();
        let mut ctx = base_ctx();
        ctx.spec_statuses = vec!["superseded".into()];
        let d = evaluate(&ctx, &bundle);
        assert_eq!(d.outcome, PolicyOutcome::Deny);
        assert!(d.reason.contains("superseded_or_retired"));
    }

    #[test]
    fn sc093_retired_status_denies() {
        let bundle = empty_bundle();
        let mut ctx = base_ctx();
        ctx.spec_statuses = vec!["retired".into()];
        let d = evaluate(&ctx, &bundle);
        assert_eq!(d.outcome, PolicyOutcome::Deny);
        assert!(d.reason.contains("superseded_or_retired"));
    }

    #[test]
    fn sc093_approved_status_allows() {
        let bundle = empty_bundle();
        let mut ctx = base_ctx();
        ctx.spec_statuses = vec!["approved".into()];
        let d = evaluate(&ctx, &bundle);
        assert_eq!(d.outcome, PolicyOutcome::Allow);
    }

    #[test]
    fn sc093_empty_statuses_allows() {
        let bundle = empty_bundle();
        let ctx = base_ctx();
        let d = evaluate(&ctx, &bundle);
        assert_eq!(d.outcome, PolicyOutcome::Allow);
    }

    // --- Spec 093: spec-risk gate tests ---

    #[test]
    fn sc093_3_critical_risk_degrades() {
        let bundle = empty_bundle();
        let mut ctx = base_ctx();
        ctx.max_spec_risk = Some("critical".into());
        let d = evaluate(&ctx, &bundle);
        assert_eq!(d.outcome, PolicyOutcome::Degrade);
        assert!(d.reason.contains("critical_requires_confirmation"));
        assert_eq!(d.rule_ids, vec!["KERNEL:SPEC-RISK"]);
    }

    #[test]
    fn sc093_high_risk_degrades() {
        let bundle = empty_bundle();
        let mut ctx = base_ctx();
        ctx.max_spec_risk = Some("high".into());
        let d = evaluate(&ctx, &bundle);
        assert_eq!(d.outcome, PolicyOutcome::Degrade);
        assert!(d.reason.contains("high_gated"));
    }

    #[test]
    fn sc093_medium_risk_allows() {
        let bundle = empty_bundle();
        let mut ctx = base_ctx();
        ctx.max_spec_risk = Some("medium".into());
        let d = evaluate(&ctx, &bundle);
        assert_eq!(d.outcome, PolicyOutcome::Allow);
    }

    #[test]
    fn sc093_low_risk_allows() {
        let bundle = empty_bundle();
        let mut ctx = base_ctx();
        ctx.max_spec_risk = Some("low".into());
        let d = evaluate(&ctx, &bundle);
        assert_eq!(d.outcome, PolicyOutcome::Allow);
    }

    #[test]
    fn sc093_no_risk_allows() {
        let bundle = empty_bundle();
        let ctx = base_ctx();
        let d = evaluate(&ctx, &bundle);
        assert_eq!(d.outcome, PolicyOutcome::Allow);
    }

    #[test]
    fn sc093_status_gate_runs_before_risk_gate() {
        let bundle = empty_bundle();
        let mut ctx = base_ctx();
        ctx.spec_statuses = vec!["draft".into()];
        ctx.max_spec_risk = Some("critical".into());
        // Status gate (Degrade:draft) fires before risk gate
        let d = evaluate(&ctx, &bundle);
        assert_eq!(d.outcome, PolicyOutcome::Degrade);
        assert!(d.reason.contains("draft_read_only"));
    }
}
