// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Bartek Kus

//! Rust twin of the Governance Envelope schema (spec 198).
//!
//! The governance envelope is the admission contract a factory files for OAP
//! to admit it: a process envelope (`process/governance-envelope.yaml` in the
//! factory source) plus per-adapter sub-envelopes (the `governance:` section
//! of each adapter manifest — see [`crate::adapter_manifest::AdapterGovernance`]).
//! OAP validates the envelope two-sidedly (spec 198 FR-003): it must conform
//! to the schema AND reconcile against the factory's own atomic declarations
//! (agent frontmatter tiers/mutations, adapter scopes). This module carries
//! the process-envelope types and the recompute-and-reconcile logic; the
//! canonical schema lives at
//! `standards/schemas/factory/governance-envelope.schema.yaml`.
//!
//! Reconciliation is **fail-closed** (spec 198 P-5): a missing declaration,
//! an unknown pattern, or a declaration that exceeds its ceiling is a
//! violation, never a warning.

use agent_frontmatter::{MutationCapability, SafetyTier, UnifiedFrontmatter};
use serde::{Deserialize, Serialize};

use crate::adapter_manifest::AdapterGovernance;
use crate::run_budget::{IntentDedupThreshold, OscillationThreshold, RunBudgetCeiling};

/// Governance Envelope contract version (spec 198 FR-002). Pinned at compile
/// time per the `PROVENANCE_SCHEMA_VERSION` pattern; instance mismatches fail
/// at parse validation, not at runtime.
///
/// 1.1.0 (spec 202 FR-001): additive `budgets:` section carrying per-axis
/// run blast-radius ceilings (ASI08 m6/m7). Backward-compatible: envelopes
/// without a `budgets:` section deserialize with `budgets: []` and the engine
/// applies platform defaults fail-closed (AC-3).
///
/// 1.2.0 (spec 202 FR-003b): additive `oscillation:` field carrying the
/// consecutive-failure circuit-breaker trip threshold (ASI08 m7). Declared
/// separately from `budgets:` because a failure streak is not a monotonic
/// run-total axis (see `OscillationThreshold`). Additive within 1.2.0: an
/// absent `oscillation:` field deserializes to `None` and the engine applies
/// the platform default fail-closed. Note this is not cross-version
/// acceptance: `validate_governance_envelope_semantics` rejects an envelope
/// pinned to a prior `schema_version` by strict equality, the same as every
/// prior bump.
///
/// 1.3.0 (spec 202 FR-003a): additive `intent_dedup:` field carrying the
/// repeated-near-identical-intent trip threshold (ASI08 m6/m7). Declared as
/// a peer field alongside `oscillation:`, refined against that same
/// precedent rather than a `budgets:` axis (see `IntentDedupThreshold`).
/// Additive within 1.3.0: an absent `intent_dedup:` field deserializes to
/// `None` and the engine applies the platform default fail-closed, the same
/// posture as every prior optional field.
pub const GOVERNANCE_ENVELOPE_SCHEMA_VERSION: &str = "1.3.0";

// ── Process envelope ──────────────────────────────────────────────────

/// The process-layer half of the governance envelope: the brief the factory
/// files about its run (spec 198 FR-012). Predicate-shaped, never
/// topology-shaped (P-2): it declares obligations that hold, not stages.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GovernanceEnvelope {
    pub schema_version: String,
    pub process: ProcessIdentity,
    pub ceilings: Ceilings,
    /// HITL gate predicates (ASI09; spec 198 FR-008). Never stage topology.
    pub gates: Vec<GatePredicate>,
    /// Emitted-artifact manifest, by kind (ASI04 m1 / ASI07).
    pub emits: Vec<EmitKind>,
    pub constituents: Constituents,
    /// Per-org substrate-override consumption policy (ASI06 m9; FR-013 c).
    pub overrides: OverridePolicy,
    /// Per-axis run blast-radius ceilings (ASI08 m6/m7; spec 202 FR-001).
    /// When absent (empty vec), the engine applies platform defaults
    /// fail-closed; the admission record shows each defaulted axis with
    /// `source: platform-default` (AC-3). Absent does NOT mean unlimited.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub budgets: Vec<RunBudgetCeiling>,
    /// Consecutive-failure circuit-breaker trip threshold (ASI08 m7; spec 202
    /// FR-003b). Declared separately from `budgets:` (a failure streak is not a
    /// monotonic axis, see `OscillationThreshold`). When absent, the platform
    /// default applies fail-closed (same posture as an absent budget axis).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub oscillation: Option<OscillationThreshold>,
    /// Repeated-near-identical-intent trip threshold (ASI08 m6/m7; spec 202
    /// FR-003a). Declared as a peer field alongside `oscillation:`, not a
    /// `budgets:` axis (a per-signature repeat count is not a monotonic
    /// run-total axis, see `IntentDedupThreshold`). When absent, the platform
    /// default applies fail-closed (same posture as an absent budget axis).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub intent_dedup: Option<IntentDedupThreshold>,
}

/// Identity + intent-capsule template (ASI01 m5/m7; spec 198 FR-005).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProcessIdentity {
    pub id: String,
    /// The objective class each run's concrete intent capsule must
    /// instantiate; out-of-class objectives are inadmissible.
    pub objective_class: String,
    /// Stable goal-identifier scheme (ASI01 m7), e.g. `build-spec:<project>`.
    pub goal_identifier_scheme: String,
}

/// Aggregate ceilings recomputed-and-reconciled against agent frontmatter
/// (spec 198 FR-003; ASI02 m1). A declared ceiling any constituent exceeds
/// is an admission failure.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Ceilings {
    pub max_tier: SafetyTier,
    pub max_mutation: MutationCapability,
}

/// A declared HITL obligation (ASI09; spec 198 FR-008), e.g.
/// `approval-before-build-spec-freeze`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GatePredicate {
    pub predicate: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
}

/// One artifact kind a conformant run emits (no paths — paths are run
/// topology, which OAP does not model).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EmitKind {
    pub kind: String,
}

/// Pointers to the atomic declarations the envelope composes (P-4: one home
/// per fact — referenced, never copied).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Constituents {
    /// Glob for the process agents whose frontmatter is reconciled,
    /// e.g. `process/agents/*.md`.
    pub agents: String,
}

/// ASI06 m9 consumption predicate for per-org `user_body` overrides.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OverridePolicy {
    pub require_verified: bool,
}

// ── Recompute-and-reconcile (spec 198 FR-003) ─────────────────────────

/// One reconciliation failure. Every variant names the agent and the exact
/// declaration that failed, so admission refusals are attributable
/// (spec 198 AC-2).
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ReconcileViolation {
    /// Agent frontmatter lacks a `safety_tier` (after spec 054 derivations)
    /// — ambiguity fails closed.
    MissingTier { agent: String },
    /// Agent frontmatter lacks a `mutation` (after spec 054 derivations).
    MissingMutation { agent: String },
    /// Declared tier exceeds the envelope ceiling.
    TierExceedsCeiling {
        agent: String,
        declared: SafetyTier,
        ceiling: SafetyTier,
    },
    /// Declared mutation exceeds the envelope ceiling.
    MutationExceedsCeiling {
        agent: String,
        declared: MutationCapability,
        ceiling: MutationCapability,
    },
    /// `mutation: scoped-write` declared without a `mutation_scope`.
    ScopedWriteWithoutScope { agent: String },
    /// A `mutation_scope` glob is not covered by the sub-envelope's
    /// `file_write_scope` (conservative coverage: unknown patterns fail
    /// closed).
    ScopeOutsideWriteScope { agent: String, scope: String },
    /// `mutation: full` at the adapter layer — unscoped write always exceeds
    /// the scaffold boundary.
    FullMutationAtAdapterLayer { agent: String },
}

impl std::fmt::Display for ReconcileViolation {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::MissingTier { agent } => {
                write!(f, "agent '{agent}' declares no safety_tier (fail-closed)")
            }
            Self::MissingMutation { agent } => {
                write!(f, "agent '{agent}' declares no mutation (fail-closed)")
            }
            Self::TierExceedsCeiling {
                agent,
                declared,
                ceiling,
            } => write!(
                f,
                "agent '{agent}' declares safety_tier {} above the envelope ceiling {}",
                declared.as_str(),
                ceiling.as_str()
            ),
            Self::MutationExceedsCeiling {
                agent,
                declared,
                ceiling,
            } => write!(
                f,
                "agent '{agent}' declares mutation {declared:?} above the envelope ceiling {ceiling:?}"
            ),
            Self::ScopedWriteWithoutScope { agent } => write!(
                f,
                "agent '{agent}' declares scoped-write without a mutation_scope"
            ),
            Self::ScopeOutsideWriteScope { agent, scope } => write!(
                f,
                "agent '{agent}' mutation_scope '{scope}' is not covered by the adapter's file_write_scope"
            ),
            Self::FullMutationAtAdapterLayer { agent } => write!(
                f,
                "agent '{agent}' declares mutation 'full' — unscoped write exceeds the scaffold boundary"
            ),
        }
    }
}

/// Reconcile the process envelope's declared ceilings against the process
/// agents' frontmatter (spec 198 FR-003 side 2, process layer). The process
/// envelope carries no `file_write_scope`; scoped-write agents reconcile for
/// scope *presence* and ceiling only.
pub fn reconcile_process(
    envelope: &GovernanceEnvelope,
    agents: &[UnifiedFrontmatter],
) -> Vec<ReconcileViolation> {
    let mut violations = Vec::new();
    for agent in agents {
        check_common(
            agent,
            envelope.ceilings.max_tier,
            envelope.ceilings.max_mutation,
            &mut violations,
        );
    }
    violations
}

/// Reconcile an adapter sub-envelope against the adapter agents' frontmatter
/// (spec 198 FR-003 side 2, scaffold boundary). The adapter layer's mutation
/// ceiling is structural: `read-write` is bounded by `file_write_scope` at
/// enforcement, `scoped-write` must be covered by it, and `full` is always a
/// violation.
pub fn reconcile_adapter(
    governance: &AdapterGovernance,
    agents: &[UnifiedFrontmatter],
) -> Vec<ReconcileViolation> {
    let mut violations = Vec::new();
    for agent in agents {
        let name = agent.name.clone();
        match agent.safety_tier {
            None => violations.push(ReconcileViolation::MissingTier { agent: name.clone() }),
            Some(tier) if tier > governance.max_tier => {
                violations.push(ReconcileViolation::TierExceedsCeiling {
                    agent: name.clone(),
                    declared: tier,
                    ceiling: governance.max_tier,
                });
            }
            Some(_) => {}
        }
        match agent.mutation {
            None => violations.push(ReconcileViolation::MissingMutation { agent: name.clone() }),
            Some(MutationCapability::Full) => {
                violations.push(ReconcileViolation::FullMutationAtAdapterLayer {
                    agent: name.clone(),
                });
            }
            Some(MutationCapability::ScopedWrite) => {
                if agent.mutation_scope.is_empty() {
                    violations
                        .push(ReconcileViolation::ScopedWriteWithoutScope { agent: name.clone() });
                }
                for scope in &agent.mutation_scope {
                    if !covered_by(scope, &governance.file_write_scope) {
                        violations.push(ReconcileViolation::ScopeOutsideWriteScope {
                            agent: name.clone(),
                            scope: scope.clone(),
                        });
                    }
                }
            }
            Some(_) => {}
        }
    }
    violations
}

fn check_common(
    agent: &UnifiedFrontmatter,
    max_tier: SafetyTier,
    max_mutation: MutationCapability,
    violations: &mut Vec<ReconcileViolation>,
) {
    let name = agent.name.clone();
    match agent.safety_tier {
        None => violations.push(ReconcileViolation::MissingTier { agent: name.clone() }),
        Some(tier) if tier > max_tier => {
            violations.push(ReconcileViolation::TierExceedsCeiling {
                agent: name.clone(),
                declared: tier,
                ceiling: max_tier,
            });
        }
        Some(_) => {}
    }
    match agent.mutation {
        None => violations.push(ReconcileViolation::MissingMutation { agent: name.clone() }),
        Some(m) if m > max_mutation => {
            violations.push(ReconcileViolation::MutationExceedsCeiling {
                agent: name.clone(),
                declared: m,
                ceiling: max_mutation,
            });
        }
        Some(MutationCapability::ScopedWrite) if agent.mutation_scope.is_empty() => {
            violations.push(ReconcileViolation::ScopedWriteWithoutScope { agent: name });
        }
        Some(_) => {}
    }
}

// ── Conservative glob coverage ────────────────────────────────────────

/// True iff `scope` is covered by at least one `write_globs` entry.
///
/// Coverage is deliberately conservative (fail-closed, spec 198 FR-003):
/// exact equality, or a `<prefix>/**` write glob covering anything at or
/// under `<prefix>`. Any pattern shape this function does not understand is
/// NOT covered.
pub fn covered_by(scope: &str, write_globs: &[String]) -> bool {
    write_globs.iter().any(|w| glob_covers(w, scope))
}

fn glob_covers(write_glob: &str, scope: &str) -> bool {
    if write_glob == scope {
        return true;
    }
    if let Some(prefix) = write_glob.strip_suffix("/**") {
        return scope == prefix || scope.starts_with(&format!("{prefix}/"));
    }
    false
}

#[cfg(test)]
mod tests {
    use super::*;
    use agent_frontmatter::AgentType;

    fn agent(
        name: &str,
        tier: SafetyTier,
        mutation: MutationCapability,
        scope: &[&str],
    ) -> UnifiedFrontmatter {
        let yaml = format!("name: {name}\n");
        let mut fm: UnifiedFrontmatter = serde_yaml::from_str(&yaml).unwrap();
        fm.agent_type = AgentType::Process;
        fm.safety_tier = Some(tier);
        fm.mutation = Some(mutation);
        fm.mutation_scope = scope.iter().map(|s| s.to_string()).collect();
        fm
    }

    fn envelope(max_tier: SafetyTier, max_mutation: MutationCapability) -> GovernanceEnvelope {
        GovernanceEnvelope {
            schema_version: GOVERNANCE_ENVELOPE_SCHEMA_VERSION.to_string(),
            process: ProcessIdentity {
                id: "factory-process".into(),
                objective_class: "Produce a frozen Build Specification".into(),
                goal_identifier_scheme: "build-spec:<project>".into(),
            },
            ceilings: Ceilings {
                max_tier,
                max_mutation,
            },
            gates: vec![GatePredicate {
                predicate: "approval-before-build-spec-freeze".into(),
                description: None,
            }],
            emits: vec![EmitKind {
                kind: "build-spec".into(),
            }],
            constituents: Constituents {
                agents: "process/agents/*.md".into(),
            },
            overrides: OverridePolicy {
                require_verified: false,
            },
            budgets: vec![],
            oscillation: None,
            intent_dedup: None,
        }
    }

    fn adapter_gov(write_scope: &[&str]) -> AdapterGovernance {
        AdapterGovernance {
            max_tier: SafetyTier::Tier2,
            file_write_scope: write_scope.iter().map(|s| s.to_string()).collect(),
            file_write_denied: vec![".env".into(), "**/.env".into()],
            allowed_commands_from: "commands".into(),
            scaffold_execution: crate::adapter_manifest::ScaffoldExecution {
                entry_points_from: vec!["scaffold.entry_point".into()],
                setup_commands_from: "scaffold.setup_commands".into(),
                isolation: "sandbox-required".into(),
            },
            agents_from: "agents".into(),
        }
    }

    #[test]
    fn version_const_anchor() {
        assert_eq!(GOVERNANCE_ENVELOPE_SCHEMA_VERSION, "1.3.0");
    }

    #[test]
    fn mutation_lattice_orders_correctly() {
        assert!(MutationCapability::ReadOnly < MutationCapability::ScopedWrite);
        assert!(MutationCapability::ScopedWrite < MutationCapability::ReadWrite);
        assert!(MutationCapability::ReadWrite < MutationCapability::Full);
    }

    #[test]
    fn conformant_process_layer_reconciles_clean() {
        let env = envelope(SafetyTier::Tier1, MutationCapability::ScopedWrite);
        let agents = vec![
            agent(
                "pipeline-orchestrator",
                SafetyTier::Tier1,
                MutationCapability::ReadOnly,
                &[],
            ),
            agent(
                "client-documentation-orchestrator",
                SafetyTier::Tier1,
                MutationCapability::ScopedWrite,
                &["requirements/client/**"],
            ),
        ];
        assert!(reconcile_process(&env, &agents).is_empty());
    }

    #[test]
    fn tier_above_ceiling_is_refused() {
        let env = envelope(SafetyTier::Tier1, MutationCapability::ReadOnly);
        let agents = vec![agent(
            "rogue",
            SafetyTier::Tier2,
            MutationCapability::ReadOnly,
            &[],
        )];
        let v = reconcile_process(&env, &agents);
        assert!(matches!(
            v.as_slice(),
            [ReconcileViolation::TierExceedsCeiling { .. }]
        ));
    }

    #[test]
    fn mutation_above_ceiling_is_refused() {
        let env = envelope(SafetyTier::Tier1, MutationCapability::ReadOnly);
        let agents = vec![agent(
            "writer",
            SafetyTier::Tier1,
            MutationCapability::ScopedWrite,
            &["requirements/client/**"],
        )];
        let v = reconcile_process(&env, &agents);
        assert!(matches!(
            v.as_slice(),
            [ReconcileViolation::MutationExceedsCeiling { .. }]
        ));
    }

    #[test]
    fn scoped_write_without_scope_is_refused() {
        let env = envelope(SafetyTier::Tier1, MutationCapability::ScopedWrite);
        let agents = vec![agent(
            "cd-orchestrator",
            SafetyTier::Tier1,
            MutationCapability::ScopedWrite,
            &[],
        )];
        let v = reconcile_process(&env, &agents);
        assert!(matches!(
            v.as_slice(),
            [ReconcileViolation::ScopedWriteWithoutScope { .. }]
        ));
    }

    #[test]
    fn missing_declarations_fail_closed() {
        let env = envelope(SafetyTier::Tier2, MutationCapability::Full);
        let yaml = "name: undeclared\n";
        let fm: UnifiedFrontmatter = serde_yaml::from_str(yaml).unwrap();
        // No apply_derivations: simulates a raw frontmatter with no tier.
        let v = reconcile_process(&env, &[fm]);
        assert_eq!(v.len(), 2);
        assert!(matches!(v[0], ReconcileViolation::MissingTier { .. }));
        assert!(matches!(v[1], ReconcileViolation::MissingMutation { .. }));
    }

    #[test]
    fn adapter_scopes_must_be_covered() {
        let gov = adapter_gov(&["apps/api/**", "apps/web/**", "package.json"]);
        let agents = vec![
            agent(
                "api-scaffolder",
                SafetyTier::Tier2,
                MutationCapability::ScopedWrite,
                &["apps/api/**"],
            ),
            agent(
                "trimmer",
                SafetyTier::Tier2,
                MutationCapability::ScopedWrite,
                &["apps/web/**", "package.json"],
            ),
        ];
        assert!(reconcile_adapter(&gov, &agents).is_empty());
    }

    #[test]
    fn scope_outside_write_scope_is_refused() {
        let gov = adapter_gov(&["apps/api/**"]);
        let agents = vec![agent(
            "ui-scaffolder",
            SafetyTier::Tier2,
            MutationCapability::ScopedWrite,
            &["apps/web/**"],
        )];
        let v = reconcile_adapter(&gov, &agents);
        assert!(matches!(
            v.as_slice(),
            [ReconcileViolation::ScopeOutsideWriteScope { .. }]
        ));
    }

    #[test]
    fn full_mutation_at_adapter_layer_is_refused() {
        let gov = adapter_gov(&["apps/api/**"]);
        let agents = vec![agent(
            "rogue-writer",
            SafetyTier::Tier2,
            MutationCapability::Full,
            &[],
        )];
        let v = reconcile_adapter(&gov, &agents);
        assert!(matches!(
            v.as_slice(),
            [ReconcileViolation::FullMutationAtAdapterLayer { .. }]
        ));
    }

    #[test]
    fn glob_coverage_is_conservative() {
        // exact + prefix coverage
        assert!(covered_by("apps/api/**", &["apps/api/**".into()]));
        assert!(covered_by("apps/api/**", &["apps/**".into()]));
        assert!(covered_by("apps/api/db/file.sql", &["apps/api/**".into()]));
        assert!(covered_by("package.json", &["package.json".into()]));
        // not covered: sibling dir, unknown pattern shapes fail closed
        assert!(!covered_by("apps/web/**", &["apps/api/**".into()]));
        assert!(!covered_by("package.json", &["*.json".into()]));
        assert!(!covered_by(".env", &["apps/**".into()]));
    }

    #[test]
    fn envelope_yaml_round_trips() {
        let env = envelope(SafetyTier::Tier1, MutationCapability::ScopedWrite);
        let yaml = serde_yaml::to_string(&env).unwrap();
        let back: GovernanceEnvelope = serde_yaml::from_str(&yaml).unwrap();
        assert_eq!(back.process.id, "factory-process");
        assert_eq!(back.ceilings.max_tier, SafetyTier::Tier1);
        assert!(!back.overrides.require_verified);
    }

    /// An envelope with a `budgets:` section round-trips through YAML.
    #[test]
    fn envelope_with_budgets_round_trips() {
        use crate::run_budget::{BudgetValue, RunBudgetAxis, RunBudgetCeiling};

        let mut env = envelope(SafetyTier::Tier1, MutationCapability::ReadOnly);
        env.budgets = vec![RunBudgetCeiling {
            axis: RunBudgetAxis::Tokens,
            per_run: Some(BudgetValue::Integer(50_000)),
            per_stage: Some(BudgetValue::Integer(10_000)),
        }];
        let yaml = serde_yaml::to_string(&env).unwrap();
        let back: GovernanceEnvelope = serde_yaml::from_str(&yaml).unwrap();
        assert_eq!(back.budgets.len(), 1);
        assert_eq!(back.budgets[0].axis, RunBudgetAxis::Tokens);
        assert_eq!(back.budgets[0].per_run, Some(BudgetValue::Integer(50_000)));
        assert_eq!(
            back.budgets[0].per_stage,
            Some(BudgetValue::Integer(10_000))
        );
    }

    /// An envelope with no `budgets:` section deserializes with `budgets` as
    /// an empty vec (backward compatibility; serde default).
    #[test]
    fn envelope_without_budgets_deserializes_with_empty_vec() {
        // This YAML matches the 1.0.0 shape (no budgets field).
        let yaml = "schema_version: \"1.1.0\"\n\
                    process:\n\
                    \x20 id: factory-process\n\
                    \x20 objective_class: Produce a frozen Build Specification\n\
                    \x20 goal_identifier_scheme: build-spec:<project>\n\
                    ceilings:\n\
                    \x20 max_tier: tier1\n\
                    \x20 max_mutation: read-only\n\
                    gates:\n\
                    \x20 - predicate: approval-before-build-spec-freeze\n\
                    emits:\n\
                    \x20 - kind: build-spec\n\
                    constituents:\n\
                    \x20 agents: process/agents/*.md\n\
                    overrides:\n\
                    \x20 require_verified: false\n";
        let env: GovernanceEnvelope = serde_yaml::from_str(yaml).unwrap();
        assert!(
            env.budgets.is_empty(),
            "envelope without budgets: section should deserialize with empty vec"
        );
    }

    /// FR-003b: an envelope with an `oscillation:` field round-trips through
    /// YAML.
    #[test]
    fn envelope_with_oscillation_round_trips() {
        let mut env = envelope(SafetyTier::Tier1, MutationCapability::ReadOnly);
        env.oscillation = Some(OscillationThreshold {
            consecutive_failures: 3,
            window_secs: Some(120),
        });
        let yaml = serde_yaml::to_string(&env).unwrap();
        let back: GovernanceEnvelope = serde_yaml::from_str(&yaml).unwrap();
        assert_eq!(
            back.oscillation,
            Some(OscillationThreshold {
                consecutive_failures: 3,
                window_secs: Some(120),
            })
        );
    }

    /// FR-003b: an envelope with no `oscillation:` field deserializes to
    /// `None` (backward compatibility; the engine applies the platform default
    /// fail-closed).
    #[test]
    fn envelope_without_oscillation_deserializes_to_none() {
        let env = envelope(SafetyTier::Tier1, MutationCapability::ReadOnly);
        let yaml = serde_yaml::to_string(&env).unwrap();
        assert!(
            !yaml.contains("oscillation"),
            "absent oscillation must be skipped in serialization: {yaml}"
        );
        let back: GovernanceEnvelope = serde_yaml::from_str(&yaml).unwrap();
        assert!(back.oscillation.is_none());
    }

    /// FR-003a: an envelope with an `intent_dedup:` field round-trips through
    /// YAML.
    #[test]
    fn envelope_with_intent_dedup_round_trips() {
        let mut env = envelope(SafetyTier::Tier1, MutationCapability::ReadOnly);
        env.intent_dedup = Some(IntentDedupThreshold {
            max_repeats: 2,
            window_secs: Some(120),
        });
        let yaml = serde_yaml::to_string(&env).unwrap();
        let back: GovernanceEnvelope = serde_yaml::from_str(&yaml).unwrap();
        assert_eq!(
            back.intent_dedup,
            Some(IntentDedupThreshold {
                max_repeats: 2,
                window_secs: Some(120),
            })
        );
    }

    /// FR-003a: an envelope with no `intent_dedup:` field deserializes to
    /// `None` (backward compatibility; the engine applies the platform
    /// default fail-closed).
    #[test]
    fn envelope_without_intent_dedup_deserializes_to_none() {
        let env = envelope(SafetyTier::Tier1, MutationCapability::ReadOnly);
        let yaml = serde_yaml::to_string(&env).unwrap();
        assert!(
            !yaml.contains("intent_dedup"),
            "absent intent_dedup must be skipped in serialization: {yaml}"
        );
        let back: GovernanceEnvelope = serde_yaml::from_str(&yaml).unwrap();
        assert!(back.intent_dedup.is_none());
    }
}
