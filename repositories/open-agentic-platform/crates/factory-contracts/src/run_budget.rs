// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Bartek Kus
// Spec: specs/202-run-blast-radius-governor/spec.md (FR-001, AC-3)

//! Run blast-radius budget types (spec 202 FR-001).
//!
//! These types carry the declared per-axis ceilings a factory files inside the
//! governance envelope and the admitted budgets produced after merging declared
//! values with platform defaults. The `RunBudget*` prefix is intentional to
//! avoid collision with `AssumptionBudget` (spec 121) in `crate::budget`.
//!
//! Policy direction (spec 047 five-tier merge): platform defaults are the
//! FLOOR of restriction. Org policy may only tighten, never loosen, the
//! platform defaults. `apply_defaults` enforces this: a declared ceiling
//! looser than the platform default is clamped back to the platform default.

use serde::{Deserialize, Serialize};

// ── Axis ──────────────────────────────────────────────────────────────────────

/// The six dimensions on which a run's blast radius is governed (ASI08 m6).
/// Serialized as snake_case strings to match the governance-envelope schema
/// enum values.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RunBudgetAxis {
    /// Tool invocations as reported by the executor's post-step turn
    /// accounting. A finer per-call count is adopted when the executor
    /// surfaces one.
    ToolInvocations,
    /// File-system mutations observed post-step. The executor does not report
    /// mutations today; this axis records 0 until a new observation point is
    /// added (no ceiling breach is possible until then).
    FileMutations,
    /// Dispatched step count, including dynamically generated Phase-2 scaffold
    /// manifest steps whose count is bounded at generation time.
    SpawnedAgents,
    /// Elapsed wall-clock seconds for the whole run. Per-step timeouts are
    /// unchanged; this axis bounds the run in aggregate.
    WallClockSecs,
    /// Token usage accumulated across all steps.
    Tokens,
    /// Dollar cost accumulated across all steps.
    CostUsd,
}

impl RunBudgetAxis {
    /// All six axes in declaration order. Used by `apply_defaults` to ensure
    /// every axis is represented in the admitted result.
    pub const ALL: [RunBudgetAxis; 6] = [
        RunBudgetAxis::ToolInvocations,
        RunBudgetAxis::FileMutations,
        RunBudgetAxis::SpawnedAgents,
        RunBudgetAxis::WallClockSecs,
        RunBudgetAxis::Tokens,
        RunBudgetAxis::CostUsd,
    ];
}

// ── Budget value ───────────────────────────────────────────────────────────────

/// A budget ceiling value. Integer for count-based axes (tool invocations,
/// file mutations, spawned agents, tokens); float for cost_usd and
/// wall_clock_secs (which may have sub-unit precision).
///
/// Serialized as an untagged number so the JSON/YAML representation is a
/// plain `42` or `0.50` with no wrapper object.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum BudgetValue {
    /// Integer ceiling (tool invocations, file mutations, spawned agents,
    /// tokens).
    Integer(u64),
    /// Floating-point ceiling (cost_usd, wall_clock_secs).
    Float(f64),
}

impl BudgetValue {
    /// Convert to f64 for unified comparison regardless of variant.
    pub fn as_f64(self) -> f64 {
        match self {
            BudgetValue::Integer(n) => n as f64,
            BudgetValue::Float(f) => f,
        }
    }
}

// ── Source ─────────────────────────────────────────────────────────────────────

/// Indicates whether a budget ceiling came from the factory-filed declaration
/// or was supplied by the platform because no declaration was present (AC-3).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum BudgetSource {
    /// The ceiling was declared in the governance envelope's `budgets:` section.
    #[serde(rename = "declared")]
    Declared,
    /// The ceiling was supplied by the platform defaults because the factory
    /// did not declare a value for this axis. An absent budget does NOT mean
    /// unlimited (spec 202 FR-001).
    #[serde(rename = "platform-default")]
    PlatformDefault,
}

// ── Declared shape (on the envelope) ──────────────────────────────────────────

/// One entry in the governance envelope's `budgets:` section. Carries the
/// factory's declared ceiling at up to two scopes: per-run and per-stage
/// (uniform across all stages). Both are optional; a missing scope means
/// the factory defers that scope to the platform default (spec 202 FR-001).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RunBudgetCeiling {
    pub axis: RunBudgetAxis,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub per_run: Option<BudgetValue>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub per_stage: Option<BudgetValue>,
}

// ── Admitted shape (post-default-merge) ───────────────────────────────────────

/// The post-default-merge admitted budget for one axis. One `AdmittedBudget`
/// exists per axis in the admitted list (six total). `ceiling_per_run` is
/// always present (the platform default is never None). `ceiling_per_stage` is
/// None when the platform has no per-stage default for the axis and the factory
/// declared none.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AdmittedBudget {
    pub axis: RunBudgetAxis,
    /// The effective per-run ceiling after applying platform defaults and the
    /// tighten-only policy (spec 047). Always present.
    pub ceiling_per_run: BudgetValue,
    /// The effective per-stage ceiling, or None if neither platform defaults
    /// nor the factory declaration supplies one for this axis.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ceiling_per_stage: Option<BudgetValue>,
    /// Whether this ceiling came from a factory declaration or the platform.
    pub source: BudgetSource,
}

// ── Platform defaults ──────────────────────────────────────────────────────────

/// Platform-default budgets applied when the governance envelope omits a
/// `budgets:` section or omits a particular axis.
///
/// These values are CONSERVATIVE ceilings reflecting the platform's baseline
/// blast-radius policy. Org policy may TIGHTEN (lower) them via the
/// governance envelope but NEVER loosen them beyond these values
/// (spec 047 five-tier merge direction). The actual production values for a
/// given org are org-filed policy; these constants are the system floor
/// (spec 202 Out-of-scope: "org risk-budget values are filed org policy").
///
/// Rationale for each value:
///   - tool_invocations 200: a typical well-scoped run uses fewer than 50
///     tool calls; 200 is 4x headroom before a feedback-loop pattern triggers.
///   - file_mutations 100: the executor does not report mutations today so
///     this ceiling cannot breach yet; it documents the intended platform floor.
///   - spawned_agents 50: a two-phase factory run has O(10) steps; 50 is 5x.
///   - wall_clock_secs 3600: one hour; individual step timeouts are shorter.
///   - tokens 500_000: roughly 375 pages of text; sufficient for complex runs.
///   - cost_usd 5.0: USD $5 per run; conservative enough to surface runaway.
pub const PLATFORM_DEFAULT_BUDGETS: &[AdmittedBudget] = &[
    AdmittedBudget {
        axis: RunBudgetAxis::ToolInvocations,
        ceiling_per_run: BudgetValue::Integer(200),
        ceiling_per_stage: Some(BudgetValue::Integer(50)),
        source: BudgetSource::PlatformDefault,
    },
    AdmittedBudget {
        axis: RunBudgetAxis::FileMutations,
        ceiling_per_run: BudgetValue::Integer(100),
        ceiling_per_stage: Some(BudgetValue::Integer(30)),
        source: BudgetSource::PlatformDefault,
    },
    AdmittedBudget {
        axis: RunBudgetAxis::SpawnedAgents,
        ceiling_per_run: BudgetValue::Integer(50),
        ceiling_per_stage: None,
        source: BudgetSource::PlatformDefault,
    },
    AdmittedBudget {
        axis: RunBudgetAxis::WallClockSecs,
        ceiling_per_run: BudgetValue::Float(3600.0),
        ceiling_per_stage: Some(BudgetValue::Float(900.0)),
        source: BudgetSource::PlatformDefault,
    },
    AdmittedBudget {
        axis: RunBudgetAxis::Tokens,
        ceiling_per_run: BudgetValue::Integer(500_000),
        ceiling_per_stage: Some(BudgetValue::Integer(100_000)),
        source: BudgetSource::PlatformDefault,
    },
    AdmittedBudget {
        axis: RunBudgetAxis::CostUsd,
        ceiling_per_run: BudgetValue::Float(5.0),
        ceiling_per_stage: Some(BudgetValue::Float(1.0)),
        source: BudgetSource::PlatformDefault,
    },
];

// ── Default merge ──────────────────────────────────────────────────────────────

/// Merge the factory-declared budget ceilings with the platform defaults.
///
/// Returns a `Vec<AdmittedBudget>` with exactly one entry per axis (six
/// total, in `RunBudgetAxis::ALL` order). Policy (spec 047 five-tier merge,
/// spec 202 FR-001):
///
/// - An axis absent from `declared` takes the full platform default (source:
///   `PlatformDefault`).
/// - A declared ceiling TIGHTER (lower) than the platform default is
///   honoured (source: `Declared`).
/// - A declared ceiling LOOSER (higher) than the platform default is CLAMPED
///   to the platform default (source: `PlatformDefault`). Policy tightens,
///   never loosens.
///
/// This is AC-3: a factory admitted with no `budgets:` section runs under
/// platform defaults, and the admission record shows every defaulted axis
/// with `source: platform-default`.
pub fn apply_defaults(declared: &[RunBudgetCeiling]) -> Vec<AdmittedBudget> {
    RunBudgetAxis::ALL
        .iter()
        .map(|&axis| {
            let platform = PLATFORM_DEFAULT_BUDGETS
                .iter()
                .find(|d| d.axis == axis)
                .expect("PLATFORM_DEFAULT_BUDGETS covers all axes");

            let decl = declared.iter().find(|d| d.axis == axis);

            match decl {
                None => {
                    // No declaration: use platform default entirely.
                    AdmittedBudget {
                        axis,
                        ceiling_per_run: platform.ceiling_per_run,
                        ceiling_per_stage: platform.ceiling_per_stage,
                        source: BudgetSource::PlatformDefault,
                    }
                }
                Some(d) => {
                    // Apply tighten-only policy per-scope independently.
                    let (ceil_run, run_source) = tighten(d.per_run, platform.ceiling_per_run);
                    let ceil_stage = tighten_opt(d.per_stage, platform.ceiling_per_stage);

                    // Source is Declared only when the per-run ceiling was
                    // tighter than the platform default; otherwise the
                    // platform default dominates and the source is
                    // PlatformDefault. Per-stage does not independently
                    // determine source in the admission record.
                    AdmittedBudget {
                        axis,
                        ceiling_per_run: ceil_run,
                        ceiling_per_stage: ceil_stage,
                        source: run_source,
                    }
                }
            }
        })
        .collect()
}

/// Return `(effective_ceiling, source)` applying the tighten-only rule for a
/// single scope. When `declared` is None the platform default is used.
fn tighten(declared: Option<BudgetValue>, platform: BudgetValue) -> (BudgetValue, BudgetSource) {
    match declared {
        None => (platform, BudgetSource::PlatformDefault),
        Some(d) => {
            if d.as_f64() <= platform.as_f64() {
                // Declared is tighter: honour it.
                (d, BudgetSource::Declared)
            } else {
                // Declared is looser: clamp to platform default.
                (platform, BudgetSource::PlatformDefault)
            }
        }
    }
}

/// Tighten-only policy for an optional scope (per_stage). When neither the
/// declared value nor the platform default supplies a value for this scope,
/// the result is None.
fn tighten_opt(
    declared: Option<BudgetValue>,
    platform: Option<BudgetValue>,
) -> Option<BudgetValue> {
    match (declared, platform) {
        (None, p) => p,
        (Some(d), None) => {
            // Factory declares a per-stage ceiling the platform has no
            // default for. The declaration is more restrictive than no
            // limit, so honour it (tighter than None).
            Some(d)
        }
        (Some(d), Some(p)) => {
            if d.as_f64() <= p.as_f64() {
                Some(d)
            } else {
                Some(p) // clamp to platform default
            }
        }
    }
}

// ── Oscillation threshold (peer, NOT a RunBudgetAxis) ────────────────────────

/// Declared oscillation / circuit-breaker trip threshold (ASI08 m7; spec 202
/// FR-003b). Deliberately NOT a `RunBudgetAxis` variant: the six axes are
/// monotonic run-total accumulators checked with strict `actual > ceiling`, but
/// a consecutive-failure streak (a) resets on success rather than accumulating,
/// (b) trips on `>=` within a sliding time window (not `>`), and (c) has no
/// sensible uniform `per_stage` scope. Modelling it as an axis would force it
/// into every governance certificate and collide with the certificate's strict
/// axis-agnostic consistency invariant. It is therefore its own envelope field.
///
/// `window_secs` is platform-fixed in this slice: unlike every axis ceiling, a
/// shorter window is looser (not tighter), so it does not fit the tighten-only
/// merge direction; only `consecutive_failures` is tighten-only mergeable.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct OscillationThreshold {
    /// Consecutive step wobbles (steps that needed at least one intra-step
    /// retry, or hard-failed) before the circuit breaks. Declared, never
    /// hardcoded (spec 202 FR-003 preamble).
    pub consecutive_failures: u32,
    /// Sliding-window width for the consecutive-failure count. Platform-fixed
    /// in this slice: `apply_oscillation_default` currently ignores any declared
    /// value (see the struct-level doc); only `consecutive_failures` is
    /// tighten-only mergeable.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub window_secs: Option<u64>,
}

/// Platform-default oscillation threshold. Mirrors
/// `circuit_breaker::CircuitBreakerConfig::default()` (threshold 5, window
/// 300s), reused rather than re-litigated since spec 102 already shipped these
/// values. An absent envelope `oscillation:` field applies this fail-closed,
/// the same posture as an absent budget axis (spec 202 FR-001).
pub const PLATFORM_DEFAULT_OSCILLATION_THRESHOLD: OscillationThreshold = OscillationThreshold {
    consecutive_failures: 5,
    window_secs: Some(300),
};

/// Merge a declared oscillation threshold with the platform default. Only
/// `consecutive_failures` is tighten-only mergeable (a lower streak limit is
/// tighter); `window_secs` stays at the platform default in this slice (see
/// [`OscillationThreshold`] doc). A declared streak looser than the platform
/// default is clamped, matching [`apply_defaults`]' tighten-only direction.
pub fn apply_oscillation_default(declared: Option<OscillationThreshold>) -> OscillationThreshold {
    match declared {
        None => PLATFORM_DEFAULT_OSCILLATION_THRESHOLD,
        Some(d)
            if d.consecutive_failures
                <= PLATFORM_DEFAULT_OSCILLATION_THRESHOLD.consecutive_failures =>
        {
            OscillationThreshold {
                consecutive_failures: d.consecutive_failures,
                window_secs: PLATFORM_DEFAULT_OSCILLATION_THRESHOLD.window_secs,
            }
        }
        Some(_) => PLATFORM_DEFAULT_OSCILLATION_THRESHOLD,
    }
}

// ── Intent-dedup threshold (peer, NOT a RunBudgetAxis) ───────────────────────

/// Declared repeated-near-identical-intent trip threshold (ASI08 m6/m7; spec
/// 202 FR-003a). Deliberately NOT a `RunBudgetAxis` variant, refined against
/// the same precedent [`OscillationThreshold`] already documents: the six
/// axes are monotonic run-total accumulators bound into the certificate's
/// per-axis consistency invariant, but a per-signature repeat count (a) is
/// scoped to one intent signature rather than the whole run, and (b) has no
/// sensible uniform `per_stage` scope. Modelling it as an axis would force it
/// into every governance certificate the same way the oscillation streak
/// would have. It is therefore its own peer envelope field, `intent_dedup:`.
///
/// `window_secs` is platform-fixed in this slice, the same posture as
/// `OscillationThreshold.window_secs`: the detector counts occurrences over
/// the whole run rather than sliding a window, so a declared value is
/// carried in the contract but currently ignored; only `max_repeats` is
/// tighten-only mergeable.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct IntentDedupThreshold {
    /// Occurrences of one intent signature (the run's `goal_id` plus the
    /// step's normalized instruction text, step id excluded) tolerated
    /// before the run pauses fail-closed. Declared, never hardcoded (spec
    /// 202 FR-003 preamble).
    pub max_repeats: u32,
    /// Sliding-window width for the per-signature repeat count.
    /// Platform-fixed in this slice: `apply_intent_dedup_default` currently
    /// ignores any declared value (see the struct-level doc); only
    /// `max_repeats` is tighten-only mergeable.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub window_secs: Option<u64>,
}

/// Platform-default intent-dedup threshold. `max_repeats: 3` is deliberately
/// lower than oscillation's `consecutive_failures: 5`: a consecutive-failure
/// streak can legitimately need a few retries to self-correct, but three
/// occurrences of the SAME (or near-identical) instruction text is already a
/// loop signature regardless of whether each attempt individually succeeded;
/// there is no comparable "still making forward progress" reading of a
/// literal repeat. `window_secs` mirrors oscillation's platform-fixed 300s for
/// symmetry, though it is unused this slice (the detector counts over the
/// whole run).
pub const PLATFORM_DEFAULT_INTENT_DEDUP: IntentDedupThreshold = IntentDedupThreshold {
    max_repeats: 3,
    window_secs: Some(300),
};

/// Merge a declared intent-dedup threshold with the platform default. Only
/// `max_repeats` is tighten-only mergeable (a lower repeat cap is tighter);
/// `window_secs` stays at the platform default in this slice (see
/// [`IntentDedupThreshold`] doc). A declared cap looser than the platform
/// default is clamped, matching [`apply_defaults`]' and
/// [`apply_oscillation_default`]'s tighten-only direction.
pub fn apply_intent_dedup_default(declared: Option<IntentDedupThreshold>) -> IntentDedupThreshold {
    match declared {
        None => PLATFORM_DEFAULT_INTENT_DEDUP,
        Some(d) if d.max_repeats <= PLATFORM_DEFAULT_INTENT_DEDUP.max_repeats => {
            IntentDedupThreshold {
                max_repeats: d.max_repeats,
                window_secs: PLATFORM_DEFAULT_INTENT_DEDUP.window_secs,
            }
        }
        Some(_) => PLATFORM_DEFAULT_INTENT_DEDUP,
    }
}

// ── Tests ──────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    /// AC-3: no declared budgets -> all six axes present with source
    /// PlatformDefault.
    #[test]
    fn no_declared_budgets_produces_all_six_axes_as_platform_defaults() {
        let admitted = apply_defaults(&[]);
        assert_eq!(admitted.len(), 6, "must have one entry per axis");
        for ab in &admitted {
            assert_eq!(
                ab.source,
                BudgetSource::PlatformDefault,
                "axis {:?} should be PlatformDefault when nothing declared",
                ab.axis
            );
        }
        // Verify all six axes are present.
        for axis in RunBudgetAxis::ALL {
            assert!(
                admitted.iter().any(|ab| ab.axis == axis),
                "missing axis {:?}",
                axis
            );
        }
    }

    /// A declared tokens ceiling tighter than the platform default is kept with
    /// source Declared.
    #[test]
    fn declared_tokens_ceiling_tighter_than_default_is_kept() {
        // Platform default for tokens is 500_000. Declare 10_000 (tighter).
        let declared = vec![RunBudgetCeiling {
            axis: RunBudgetAxis::Tokens,
            per_run: Some(BudgetValue::Integer(10_000)),
            per_stage: None,
        }];
        let admitted = apply_defaults(&declared);
        assert_eq!(admitted.len(), 6);

        let tokens = admitted
            .iter()
            .find(|ab| ab.axis == RunBudgetAxis::Tokens)
            .unwrap();
        assert_eq!(
            tokens.source,
            BudgetSource::Declared,
            "tighter declaration should be Declared"
        );
        assert_eq!(
            tokens.ceiling_per_run,
            BudgetValue::Integer(10_000),
            "tighter ceiling should be honoured"
        );

        // All other axes should still be PlatformDefault.
        for ab in admitted.iter().filter(|ab| ab.axis != RunBudgetAxis::Tokens) {
            assert_eq!(
                ab.source,
                BudgetSource::PlatformDefault,
                "undeclared axis {:?} should be PlatformDefault",
                ab.axis
            );
        }
    }

    /// A declared ceiling looser than the platform default is clamped to the
    /// platform default (source: PlatformDefault).
    #[test]
    fn declared_ceiling_looser_than_default_is_clamped() {
        // Platform default for tool_invocations per_run is 200. Declare 9999
        // (much looser).
        let declared = vec![RunBudgetCeiling {
            axis: RunBudgetAxis::ToolInvocations,
            per_run: Some(BudgetValue::Integer(9_999)),
            per_stage: None,
        }];
        let admitted = apply_defaults(&declared);

        let tool = admitted
            .iter()
            .find(|ab| ab.axis == RunBudgetAxis::ToolInvocations)
            .unwrap();
        assert_eq!(
            tool.source,
            BudgetSource::PlatformDefault,
            "looser declaration should be clamped to PlatformDefault"
        );
        assert_eq!(
            tool.ceiling_per_run,
            BudgetValue::Integer(200),
            "ceiling should be clamped to platform default of 200"
        );
    }

    /// A declared cost_usd ceiling tighter than the platform default (float
    /// comparison) is kept.
    #[test]
    fn declared_cost_usd_tighter_than_default_is_kept() {
        // Platform default for cost_usd per_run is 5.0. Declare 0.50 (tighter).
        let declared = vec![RunBudgetCeiling {
            axis: RunBudgetAxis::CostUsd,
            per_run: Some(BudgetValue::Float(0.50)),
            per_stage: None,
        }];
        let admitted = apply_defaults(&declared);

        let cost = admitted
            .iter()
            .find(|ab| ab.axis == RunBudgetAxis::CostUsd)
            .unwrap();
        assert_eq!(cost.source, BudgetSource::Declared);
        // Compare as f64 to handle float representation.
        assert!(
            (cost.ceiling_per_run.as_f64() - 0.50).abs() < 1e-9,
            "tighter cost ceiling should be honoured: got {:?}",
            cost.ceiling_per_run
        );
    }

    /// A declared cost_usd ceiling looser than the platform default (float) is
    /// clamped.
    #[test]
    fn declared_cost_usd_looser_than_default_is_clamped() {
        // Platform default is 5.0. Declare 999.0 (much looser).
        let declared = vec![RunBudgetCeiling {
            axis: RunBudgetAxis::CostUsd,
            per_run: Some(BudgetValue::Float(999.0)),
            per_stage: None,
        }];
        let admitted = apply_defaults(&declared);

        let cost = admitted
            .iter()
            .find(|ab| ab.axis == RunBudgetAxis::CostUsd)
            .unwrap();
        assert_eq!(cost.source, BudgetSource::PlatformDefault);
        assert!(
            (cost.ceiling_per_run.as_f64() - 5.0).abs() < 1e-9,
            "ceiling should be clamped to platform default 5.0: got {:?}",
            cost.ceiling_per_run
        );
    }

    /// Serialize and deserialize RunBudgetAxis as snake_case strings.
    #[test]
    fn axis_serializes_as_snake_case() {
        let axes = vec![
            (RunBudgetAxis::ToolInvocations, "\"tool_invocations\""),
            (RunBudgetAxis::FileMutations, "\"file_mutations\""),
            (RunBudgetAxis::SpawnedAgents, "\"spawned_agents\""),
            (RunBudgetAxis::WallClockSecs, "\"wall_clock_secs\""),
            (RunBudgetAxis::Tokens, "\"tokens\""),
            (RunBudgetAxis::CostUsd, "\"cost_usd\""),
        ];
        for (axis, expected) in axes {
            let s = serde_json::to_string(&axis).unwrap();
            assert_eq!(s, expected, "axis {:?} serialized incorrectly", axis);
        }
    }

    /// BudgetSource serializes as "declared" and "platform-default".
    #[test]
    fn budget_source_serializes_correctly() {
        assert_eq!(
            serde_json::to_string(&BudgetSource::Declared).unwrap(),
            "\"declared\""
        );
        assert_eq!(
            serde_json::to_string(&BudgetSource::PlatformDefault).unwrap(),
            "\"platform-default\""
        );
    }

    /// BudgetValue integer and float round-trip through JSON.
    #[test]
    fn budget_value_round_trips() {
        let int_val = BudgetValue::Integer(42);
        let json = serde_json::to_string(&int_val).unwrap();
        assert_eq!(json, "42");
        let back: BudgetValue = serde_json::from_str(&json).unwrap();
        assert_eq!(back, BudgetValue::Integer(42));

        let float_val = BudgetValue::Float(3.14);
        let json = serde_json::to_string(&float_val).unwrap();
        let back: BudgetValue = serde_json::from_str(&json).unwrap();
        assert!((back.as_f64() - 3.14).abs() < 1e-9);
    }

    /// FR-003b: an absent oscillation threshold takes the platform default; a
    /// declared streak tighter than the default is honoured; a looser one is
    /// clamped; window_secs always stays at the platform default.
    #[test]
    fn apply_oscillation_default_is_tighten_only() {
        // Absent -> platform default (5 / 300s).
        assert_eq!(
            apply_oscillation_default(None),
            PLATFORM_DEFAULT_OSCILLATION_THRESHOLD
        );

        // Tighter declared streak is honoured; window stays platform-fixed.
        let tighter = apply_oscillation_default(Some(OscillationThreshold {
            consecutive_failures: 2,
            window_secs: Some(30),
        }));
        assert_eq!(tighter.consecutive_failures, 2);
        assert_eq!(
            tighter.window_secs,
            PLATFORM_DEFAULT_OSCILLATION_THRESHOLD.window_secs,
            "window_secs is platform-fixed in this slice"
        );

        // Looser declared streak is clamped to the platform default.
        let looser = apply_oscillation_default(Some(OscillationThreshold {
            consecutive_failures: 99,
            window_secs: None,
        }));
        assert_eq!(looser, PLATFORM_DEFAULT_OSCILLATION_THRESHOLD);
    }

    /// The oscillation threshold round-trips through JSON with window_secs
    /// omitted when absent.
    #[test]
    fn oscillation_threshold_round_trips() {
        let with_window = OscillationThreshold {
            consecutive_failures: 3,
            window_secs: Some(120),
        };
        let json = serde_json::to_string(&with_window).unwrap();
        assert_eq!(
            serde_json::from_str::<OscillationThreshold>(&json).unwrap(),
            with_window
        );

        let no_window = OscillationThreshold {
            consecutive_failures: 4,
            window_secs: None,
        };
        let json = serde_json::to_string(&no_window).unwrap();
        assert!(
            !json.contains("window_secs"),
            "absent window_secs must be skipped: {json}"
        );
        assert_eq!(
            serde_json::from_str::<OscillationThreshold>(&json).unwrap(),
            no_window
        );
    }

    /// FR-003a: an absent intent-dedup threshold takes the platform default;
    /// a declared cap tighter than the default is honoured; a looser one is
    /// clamped; window_secs always stays at the platform default.
    #[test]
    fn apply_intent_dedup_default_is_tighten_only() {
        // Absent -> platform default (3 / 300s).
        assert_eq!(
            apply_intent_dedup_default(None),
            PLATFORM_DEFAULT_INTENT_DEDUP
        );

        // Tighter declared cap is honoured; window stays platform-fixed.
        let tighter = apply_intent_dedup_default(Some(IntentDedupThreshold {
            max_repeats: 1,
            window_secs: Some(30),
        }));
        assert_eq!(tighter.max_repeats, 1);
        assert_eq!(
            tighter.window_secs,
            PLATFORM_DEFAULT_INTENT_DEDUP.window_secs,
            "window_secs is platform-fixed in this slice"
        );

        // Looser declared cap is clamped to the platform default.
        let looser = apply_intent_dedup_default(Some(IntentDedupThreshold {
            max_repeats: 99,
            window_secs: None,
        }));
        assert_eq!(looser, PLATFORM_DEFAULT_INTENT_DEDUP);
    }

    /// The intent-dedup threshold round-trips through JSON with window_secs
    /// omitted when absent.
    #[test]
    fn intent_dedup_threshold_round_trips() {
        let with_window = IntentDedupThreshold {
            max_repeats: 2,
            window_secs: Some(120),
        };
        let json = serde_json::to_string(&with_window).unwrap();
        assert_eq!(
            serde_json::from_str::<IntentDedupThreshold>(&json).unwrap(),
            with_window
        );

        let no_window = IntentDedupThreshold {
            max_repeats: 4,
            window_secs: None,
        };
        let json = serde_json::to_string(&no_window).unwrap();
        assert!(
            !json.contains("window_secs"),
            "absent window_secs must be skipped: {json}"
        );
        assert_eq!(
            serde_json::from_str::<IntentDedupThreshold>(&json).unwrap(),
            no_window
        );
    }
}
