// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Bartek Kus
// Spec: specs/202-run-blast-radius-governor/spec.md (FR-002, AC-1, AC-5)

//! Run blast-radius metering and circuit break (spec 202 FR-002).
//!
//! The [`RunBudgetMeter`] accumulates the per-step actuals the dispatch loop
//! already collects (tokens, cost, turns, dispatched-step count, run-level
//! wall-clock) and compares the running totals to the admitted per-run
//! ceilings ([`factory_contracts::AdmittedBudget`], produced by Slice A's
//! `apply_defaults`). [`BudgetGate`] wraps the meter behind the orchestrator's
//! [`PreStepGate`] trait: it records each completed step via `after_step` and,
//! at the next step boundary, fails the step closed (`Err`) if any ceiling is
//! exceeded. This composes with (never replaces) the existing
//! `GrantRenewalGate` (spec 198 FR-005) via [`ChainedPreStepGate`].
//!
//! ## Granularity (spec 202 §Code reality 4)
//!
//! Checks fire at step *entry* against accumulated actuals, so a breaching
//! step may overshoot its run-level ceiling by at most its own work. This
//! bounded overshoot is a stated contract of the design, not a gap.
//!
//! ## AC-5: no self-raise
//!
//! The meter exposes no method that raises a ceiling. The ceilings are moved
//! in at construction and are read-only thereafter; raising a budget requires
//! constructing a new meter from a new admission (a new envelope or an audited
//! override). The gate is structurally incapable of loosening its own limits.
//!
//! ## Scope: per-run only (this slice)
//!
//! `AdmittedBudget` carries both `ceiling_per_run` and `ceiling_per_stage`.
//! This meter enforces `ceiling_per_run` (the accumulated run-level ceiling,
//! AC-1). Per-stage enforcement (each single stage against the uniform
//! per-stage ceiling) is metered in the declared shape but not yet enforced;
//! it lands with the dispatch-path wiring slice. No acceptance criterion gates
//! per-stage enforcement.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::Instant;

use async_trait::async_trait;
use factory_contracts::{AdmittedBudget, BudgetSource, IntentDedupThreshold, RunBudgetAxis};
use sha2::{Digest, Sha256};

use crate::circuit_breaker::CircuitBreakerState;
use crate::{PreStepGate, StepActuals};

/// A breached per-run ceiling reported by [`RunBudgetMeter::check`]
/// (spec 202 FR-002). Carries the offending axis, its ceiling, and the
/// accumulated actual that exceeded it: the attributable trio AC-1 requires
/// the pause error to name.
#[derive(Debug, Clone, PartialEq)]
pub struct BudgetBreach {
    pub axis: RunBudgetAxis,
    pub ceiling: f64,
    pub actual: f64,
}

/// A per-axis consumption row for the governance certificate (spec 202 FR-005).
///
/// Unlike [`BudgetBreach`] (only the first offending axis), this reports EVERY
/// admitted axis at run termination: the ceiling, the accumulated actual, the
/// admission source, and whether the axis breached. The certificate binds these
/// inside its signed payload so the receipt shows how close the run came to each
/// ceiling (AC-4).
#[derive(Debug, Clone, PartialEq)]
pub struct RunBudgetConsumption {
    pub axis: RunBudgetAxis,
    pub ceiling: f64,
    pub actual: f64,
    pub source: BudgetSource,
    pub breached: bool,
}

/// Run-level meter accumulating per-axis actuals against admitted ceilings.
///
/// One meter governs one run. It is fed by [`RunBudgetMeter::record_step`]
/// (one call per completed step) and queried by [`RunBudgetMeter::check`]
/// (once per upcoming step boundary). All accumulation is monotonic; the
/// ceilings are immutable after construction (AC-5).
pub struct RunBudgetMeter {
    /// The admitted ceilings, one entry per axis. Immutable after construction.
    ceilings: Vec<AdmittedBudget>,
    /// Monotonic accumulated actual per axis (f64 for unified comparison).
    /// `WallClockSecs` is intentionally absent here: it is computed live from
    /// `run_start` at check time rather than accumulated.
    actuals: HashMap<RunBudgetAxis, f64>,
    /// Start of the run, for the `WallClockSecs` axis.
    run_start: Instant,
}

impl RunBudgetMeter {
    /// Construct a meter from the admitted budgets (Slice A `apply_defaults`).
    /// The run clock starts now.
    pub fn new(ceilings: Vec<AdmittedBudget>) -> Self {
        Self {
            ceilings,
            actuals: HashMap::new(),
            run_start: Instant::now(),
        }
    }

    /// Accumulate one completed step's actuals into the per-axis totals.
    ///
    /// Axis mapping (spec 202 FR-001):
    /// - `Tokens` += `tokens_used`
    /// - `CostUsd` += `cost_usd`
    /// - `ToolInvocations` += `num_turns` (the executor's post-step turn
    ///   accounting; a finer per-tool-call count is adopted when the executor
    ///   surfaces one)
    /// - `SpawnedAgents` += 1 (one dispatched step)
    /// - `FileMutations`: records 0: the executor does not report workspace
    ///   mutations post-step today (§Code reality 4), so no ceiling breach is
    ///   possible on this axis until a new observation point exists.
    /// - `WallClockSecs`: not accumulated here; computed live at check time.
    pub fn record_step(&mut self, actuals: &StepActuals) {
        *self.actuals.entry(RunBudgetAxis::Tokens).or_insert(0.0) +=
            actuals.tokens_used.unwrap_or(0) as f64;
        *self.actuals.entry(RunBudgetAxis::CostUsd).or_insert(0.0) +=
            actuals.cost_usd.unwrap_or(0.0);
        *self.actuals.entry(RunBudgetAxis::ToolInvocations).or_insert(0.0) +=
            actuals.num_turns.unwrap_or(0) as f64;
        *self
            .actuals
            .entry(RunBudgetAxis::SpawnedAgents)
            .or_insert(0.0) += 1.0;
        // FileMutations is metered at zero until the executor reports mutations.
        self.actuals.entry(RunBudgetAxis::FileMutations).or_insert(0.0);
    }

    /// The accumulated actual for one axis. `WallClockSecs` is derived live
    /// from the run start; all others are read from the accumulator.
    fn actual_for(&self, axis: RunBudgetAxis) -> f64 {
        match axis {
            RunBudgetAxis::WallClockSecs => self.run_start.elapsed().as_secs_f64(),
            other => self.actuals.get(&other).copied().unwrap_or(0.0),
        }
    }

    /// Return the first exceeded per-run ceiling, or `None` if all axes are
    /// within budget. Axes are checked in admitted (declaration) order, so the
    /// breach reported is deterministic.
    pub fn check(&self) -> Option<BudgetBreach> {
        for ab in &self.ceilings {
            let ceiling = ab.ceiling_per_run.as_f64();
            let actual = self.actual_for(ab.axis);
            if actual > ceiling {
                return Some(BudgetBreach {
                    axis: ab.axis,
                    ceiling,
                    actual,
                });
            }
        }
        None
    }

    /// Snapshot per-axis consumption for every admitted ceiling, for the
    /// certificate's `budget_consumption` record (spec 202 FR-005). One row per
    /// admitted axis in declaration order; `actual` and `breached` use the same
    /// per-run comparison as [`check`], so a row is `breached` iff `check` would
    /// report it. Call at run termination (success or halt).
    pub fn consumption(&self) -> Vec<RunBudgetConsumption> {
        self.ceilings
            .iter()
            .map(|ab| {
                let ceiling = ab.ceiling_per_run.as_f64();
                let actual = self.actual_for(ab.axis);
                RunBudgetConsumption {
                    axis: ab.axis,
                    ceiling,
                    actual,
                    source: ab.source,
                    breached: actual > ceiling,
                }
            })
            .collect()
    }
}

/// A [`PreStepGate`] that meters run blast-radius and breaks the circuit
/// (spec 202 FR-002). Holds the shared meter; `after_step` records the
/// just-completed step, `before_step` fails closed at the next boundary if a
/// ceiling is exceeded.
pub struct BudgetGate {
    meter: Arc<Mutex<RunBudgetMeter>>,
}

impl BudgetGate {
    /// Wrap a shared meter. The same `Arc<Mutex<RunBudgetMeter>>` may be shared
    /// across multiple dispatch phases (e.g. factory Phase 1 + Phase 2) so the
    /// run-level totals accumulate across the whole run.
    pub fn new(meter: Arc<Mutex<RunBudgetMeter>>) -> Self {
        Self { meter }
    }
}

#[async_trait]
impl PreStepGate for BudgetGate {
    async fn before_step(&self, step_id: &str) -> Result<(), String> {
        // Scope the lock so the guard drops before we build the error string;
        // no await is held across the lock.
        let breach = {
            let meter = self.meter.lock().expect("budget meter mutex poisoned");
            meter.check()
        };
        match breach {
            Some(b) => Err(format!(
                "budget ceiling exceeded: axis={:?} ceiling={} actual={} step={step_id} \
                 (spec 202 FR-002): raise the ceiling via a new admission or abort",
                b.axis, b.ceiling, b.actual,
            )),
            None => Ok(()),
        }
    }

    async fn after_step(&self, actuals: &StepActuals) {
        let mut meter = self.meter.lock().expect("budget meter mutex poisoned");
        meter.record_step(actuals);
    }
}

/// Composes several [`PreStepGate`]s into one, preserving order. `before_step`
/// runs each gate in turn and short-circuits on the first `Err` (so an earlier
/// gate's refusal is reported and later gates do not run); `after_step` is
/// forwarded to every gate.
///
/// This is how the budget gate composes with `GrantRenewalGate`
/// (spec 198 FR-005) without changing the single-`Option` `pre_step` dispatch
/// API: callers build `ChainedPreStepGate::new(vec![grant_renewal, budget])`
/// and pass it as the one `pre_step`.
pub struct ChainedPreStepGate {
    gates: Vec<Arc<dyn PreStepGate>>,
}

impl ChainedPreStepGate {
    pub fn new(gates: Vec<Arc<dyn PreStepGate>>) -> Self {
        Self { gates }
    }
}

#[async_trait]
impl PreStepGate for ChainedPreStepGate {
    async fn before_step(&self, step_id: &str) -> Result<(), String> {
        for gate in &self.gates {
            gate.before_step(step_id).await?;
        }
        Ok(())
    }

    async fn after_step(&self, actuals: &StepActuals) {
        for gate in &self.gates {
            gate.after_step(actuals).await;
        }
    }
}

// ── Oscillation detector (FR-003b) ───────────────────────────────────────────

/// FR-003(b): wires the previously-unwired `circuit_breaker` library into
/// dispatch as a peer [`PreStepGate`], composed via [`ChainedPreStepGate`]
/// alongside [`BudgetGate`] (and `GrantRenewalGate` when present). It is NOT
/// folded into [`RunBudgetMeter`]/`RunBudgetAxis`: a consecutive-failure streak
/// resets on success, trips on `>=` within a sliding window, and has no uniform
/// per-stage scope, so it is a peer detector rather than a monotonic axis (see
/// `factory_contracts::run_budget::OscillationThreshold`).
///
/// State lives in a caller-supplied `Arc<Mutex<CircuitBreakerState>>` so it is
/// shared across dispatch phases exactly like [`RunBudgetMeter`] (constructed
/// once per run-attempt; a resume gets a fresh instance, the same AC-5 "new
/// admission equals new meter" posture the budget gate already uses).
///
/// Detector input (spec 202 FR-003b, retry-count reframing): a step "wobbles"
/// when it needed at least one intra-step retry (`retry_count > 0`) or hard
/// failed. The dispatch loop returns `Err` on the first hard failure (spec 075
/// halt-on-failure), so a literal inter-stage failure loop cannot arise; the
/// realizable cross-step signal is consecutive retry-heavy steps.
pub struct OscillationGate {
    breaker: Arc<Mutex<CircuitBreakerState>>,
}

impl OscillationGate {
    pub fn new(breaker: Arc<Mutex<CircuitBreakerState>>) -> Self {
        Self { breaker }
    }
}

#[async_trait]
impl PreStepGate for OscillationGate {
    async fn before_step(&self, step_id: &str) -> Result<(), String> {
        let (tripped, consecutive_failures, threshold) = {
            let b = self
                .breaker
                .lock()
                .expect("oscillation breaker mutex poisoned");
            (b.is_tripped(), b.consecutive_failures, b.config.threshold)
        };
        if tripped {
            Err(format!(
                "oscillation detected: {consecutive_failures} consecutive step wobbles \
                 (threshold {threshold}) step={step_id} (spec 202 FR-003b): resume requires a \
                 human actor (raise the threshold via a new admission or abort)"
            ))
        } else {
            Ok(())
        }
    }

    async fn after_step(&self, actuals: &StepActuals) {
        // A "wobble": the step needed at least one intra-step retry before
        // reaching Success, or it hard-failed outright. See struct doc for why
        // `retry_count` (not just `success`) drives this: a hard failure alone
        // can never repeat within one dispatch_manifest call (halt-on-failure).
        let wobbled = !actuals.success || actuals.retry_count > 0;
        let mut b = self
            .breaker
            .lock()
            .expect("oscillation breaker mutex poisoned");
        if wobbled {
            let _ = b.record_failure();
        } else {
            b.record_success();
        }
    }
}

// ── Intent-dedup detector (FR-003a) ──────────────────────────────────────────

/// Normalize a raw instruction string for the intent signature (spec 202
/// FR-003a). The exact rule is CONTRACT: trim leading/trailing whitespace,
/// collapse every internal run of whitespace to a single ASCII space, and
/// lowercase the result. This is deliberately simple (no punctuation
/// stripping, no stemming) so the rule is auditable and reproducible from the
/// doc alone; it catches the realistic near-twin case (re-generated step
/// text that differs only in incidental whitespace/case) without attempting
/// semantic similarity, which is out of scope (spec 202 "Out of scope":
/// the governor counts, it does not evaluate).
fn normalize_instruction(instruction: &str) -> String {
    instruction.split_whitespace().collect::<Vec<_>>().join(" ").to_lowercase()
}

/// Compute the intent signature: SHA-256 hex of `goal_id + "\n" +
/// normalize(instruction)`. The step id is deliberately EXCLUDED so
/// dynamically generated near-twin steps (same goal, same normalized
/// instruction, different generated step id) collide, mirroring the
/// `derive_goal_id` hashing idiom in
/// `crates/factory-engine/src/intent_capsule.rs`.
fn intent_signature(goal_id: &str, instruction: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(goal_id.as_bytes());
    hasher.update(b"\n");
    hasher.update(normalize_instruction(instruction).as_bytes());
    format!("{:x}", hasher.finalize())
}

/// FR-003(a): detects repeated near-identical intents within a run, wired as
/// a peer [`PreStepGate`] alongside [`BudgetGate`] and [`OscillationGate`],
/// composed via [`ChainedPreStepGate`]. It is NOT folded into
/// [`RunBudgetMeter`]/`RunBudgetAxis`: a per-signature repeat count is scoped
/// to one intent signature rather than the whole run and has no uniform
/// per-stage shape, the same "refined against the oscillation precedent"
/// reasoning `IntentDedupThreshold` documents (see
/// `factory_contracts::run_budget::IntentDedupThreshold`).
///
/// Window: whole-run count in this slice (matching how [`RunBudgetMeter`]
/// treats the run) -- `threshold.window_secs` is carried in the contract but
/// platform-fixed/unused this slice, exactly like `OscillationThreshold`'s
/// `window_secs`.
///
/// Granularity (spec 202 §Code reality 4): `max_repeats` is a ceiling, checked
/// post-hoc at step entry against the accumulated per-signature count (`count >
/// max_repeats`), so up to `max_repeats + 1` occurrences of one signature may
/// run before the pause fires at the next boundary -- the same bounded
/// one-step overshoot [`BudgetGate`] has against a run-level ceiling, not an
/// off-by-one. (The `>` ceiling convention deliberately follows [`BudgetGate`]'s
/// `actual > ceiling`, not [`OscillationGate`]'s `>=` streak convention, which
/// models a different quantity.)
///
/// Response ordering (FR-003 "throttle first, break second"): for the
/// orchestrator's sequential dispatch there is no concurrency between steps
/// to rate-limit, so "throttle" is degenerate; this gate implements the
/// break only (fail-closed pause via `before_step`), the same MVP scope
/// `OscillationGate` takes for its trip response.
pub struct IntentDedupGate {
    goal_id: String,
    threshold: IntentDedupThreshold,
    /// intent_signature -> occurrence count, whole-run scope this slice.
    seen: Arc<Mutex<HashMap<String, u32>>>,
}

impl IntentDedupGate {
    pub fn new(goal_id: impl Into<String>, threshold: IntentDedupThreshold) -> Self {
        Self {
            goal_id: goal_id.into(),
            threshold,
            seen: Arc::new(Mutex::new(HashMap::new())),
        }
    }
}

#[async_trait]
impl PreStepGate for IntentDedupGate {
    async fn before_step(&self, step_id: &str) -> Result<(), String> {
        let breach = {
            let seen = self.seen.lock().expect("intent-dedup map mutex poisoned");
            // Deterministic selection: name the worst offender (highest count),
            // tie-broken by signature, so the diagnostic is reproducible even
            // when several signatures breach at once. `HashMap` iteration order
            // is otherwise unspecified; a plain `find` would name an arbitrary
            // breaching signature. Mirrors `BudgetGate`'s deterministic
            // declaration-order check.
            seen.iter()
                .filter(|&(_, &count)| count > self.threshold.max_repeats)
                .max_by(|(sig_a, count_a), (sig_b, count_b)| {
                    count_a.cmp(count_b).then_with(|| sig_a.cmp(sig_b))
                })
                .map(|(sig, &count)| (sig.clone(), count))
        };
        match breach {
            Some((sig, count)) => Err(format!(
                "repeated intent detected: signature {sig} occurred {count} times \
                 (threshold {}) goal={} step={step_id} (spec 202 FR-003a): resume requires a \
                 human actor (raise the threshold via a new admission or abort)",
                self.threshold.max_repeats, self.goal_id,
            )),
            None => Ok(()),
        }
    }

    async fn after_step(&self, actuals: &StepActuals) {
        // `None` means the caller did not thread instruction text through
        // this path (e.g. the hard-failure StepActuals literal); a no-op
        // keeps other gates' contracts unaffected.
        let Some(instruction) = actuals.instruction.as_deref() else {
            return;
        };
        // An instruction that normalizes to empty (blank or whitespace-only)
        // carries no intent signal to dedup on; counting it would collide
        // genuinely-distinct blank steps into one signature and could mispause
        // a healthy run. Skip it, the same no-op posture as `None` (a real
        // fan-out of empty steps stays bounded by the SpawnedAgents budget axis).
        if normalize_instruction(instruction).is_empty() {
            return;
        }
        let sig = intent_signature(&self.goal_id, instruction);
        let mut seen = self.seen.lock().expect("intent-dedup map mutex poisoned");
        *seen.entry(sig).or_insert(0) += 1;
    }
}

// ── Tests ──────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use factory_contracts::{apply_defaults, BudgetSource, BudgetValue};
    use std::sync::atomic::{AtomicUsize, Ordering};

    /// One admitted axis with a per-run ceiling, used to build focused meters.
    fn ceiling(axis: RunBudgetAxis, per_run: BudgetValue) -> AdmittedBudget {
        AdmittedBudget {
            axis,
            ceiling_per_run: per_run,
            ceiling_per_stage: None,
            source: BudgetSource::Declared,
        }
    }

    fn actuals(tokens: Option<u64>, cost: Option<f64>, turns: Option<u32>) -> StepActuals {
        StepActuals {
            step_id: "s".into(),
            tokens_used: tokens,
            cost_usd: cost,
            duration_ms: None,
            num_turns: turns,
            success: true,
            retry_count: 0,
            instruction: None,
        }
    }

    /// A step outcome for oscillation tests: `retry_count`/`success` drive the
    /// detector's wobble decision.
    fn wobbly_actuals(retry_count: u32, success: bool) -> StepActuals {
        StepActuals {
            step_id: "s".into(),
            tokens_used: None,
            cost_usd: None,
            duration_ms: None,
            num_turns: None,
            success,
            retry_count,
            instruction: None,
        }
    }

    /// A step outcome for intent-dedup tests: carries the raw instruction
    /// text that `IntentDedupGate::after_step` hashes.
    fn intent_actuals(step_id: &str, instruction: &str) -> StepActuals {
        StepActuals {
            step_id: step_id.into(),
            tokens_used: None,
            cost_usd: None,
            duration_ms: None,
            num_turns: None,
            success: true,
            retry_count: 0,
            instruction: Some(instruction.into()),
        }
    }

    use crate::circuit_breaker::{CircuitBreakerConfig, CircuitBreakerState};

    fn oscillation_gate(threshold: u32) -> (OscillationGate, Arc<Mutex<CircuitBreakerState>>) {
        let breaker = Arc::new(Mutex::new(CircuitBreakerState::new(CircuitBreakerConfig {
            threshold,
            window_secs: 300,
        })));
        (OscillationGate::new(breaker.clone()), breaker)
    }

    /// AC-2 (unit): the oscillation gate trips after `threshold` consecutive
    /// wobbling steps, and `before_step` then fails closed with an attributable
    /// message naming the count and threshold.
    #[tokio::test]
    async fn oscillation_gate_trips_after_threshold_wobbles() {
        let (gate, _breaker) = oscillation_gate(2);
        // Clean before any wobble.
        assert!(gate.before_step("s0").await.is_ok());
        // Two retry-heavy (but successful) steps: each is a wobble.
        gate.after_step(&wobbly_actuals(1, true)).await;
        gate.after_step(&wobbly_actuals(2, true)).await;
        let err = gate
            .before_step("s3")
            .await
            .expect_err("must trip after 2 wobbles at threshold 2");
        assert!(err.contains("oscillation detected"), "{err}");
        assert!(err.contains("threshold 2"), "{err}");
    }

    /// A successful step with no retries resets the streak, so the gate does
    /// not trip.
    #[tokio::test]
    async fn oscillation_gate_resets_on_clean_step() {
        let (gate, _breaker) = oscillation_gate(2);
        gate.after_step(&wobbly_actuals(1, true)).await;
        gate.after_step(&wobbly_actuals(0, true)).await; // clean: resets
        gate.after_step(&wobbly_actuals(1, true)).await;
        assert!(
            gate.before_step("s3").await.is_ok(),
            "one wobble after a reset must not trip"
        );
    }

    /// AC-2 (composition): a ChainedPreStepGate of [budget, oscillation] fires
    /// the OSCILLATION breach (not a budget breach) on repeated wobbles, and the
    /// run's wall-clock actual is far below its platform-default ceiling.
    #[tokio::test]
    async fn chain_fires_oscillation_before_wall_clock_budget() {
        let meter = Arc::new(Mutex::new(RunBudgetMeter::new(apply_defaults(&[]))));
        let budget_gate: Arc<dyn PreStepGate> = Arc::new(BudgetGate::new(meter.clone()));
        let (osc, _breaker) = oscillation_gate(2);
        let osc_gate: Arc<dyn PreStepGate> = Arc::new(osc);
        let chain = ChainedPreStepGate::new(vec![budget_gate, osc_gate]);

        chain.after_step(&wobbly_actuals(1, true)).await;
        chain.after_step(&wobbly_actuals(1, true)).await;
        let err = chain
            .before_step("s3")
            .await
            .expect_err("chain must fail closed on oscillation");
        assert!(err.contains("oscillation detected"), "{err}");
        assert!(
            !err.contains("budget ceiling exceeded"),
            "must be the oscillation gate, not a budget breach: {err}"
        );
        // The literal AC-2 claim: trips before exhausting the wall-clock budget.
        let rows = meter.lock().unwrap().consumption();
        let wall = rows
            .iter()
            .find(|r| r.axis == RunBudgetAxis::WallClockSecs)
            .expect("wall-clock row present");
        assert!(
            wall.actual < wall.ceiling,
            "wall-clock actual {} must be below ceiling {} at trip time",
            wall.actual,
            wall.ceiling
        );
    }

    // ── IntentDedupGate (FR-003a) ────────────────────────────────────────────

    fn intent_dedup_gate(max_repeats: u32) -> IntentDedupGate {
        IntentDedupGate::new(
            "goal-abc123",
            IntentDedupThreshold {
                max_repeats,
                window_secs: Some(300),
            },
        )
    }

    /// FR-003a: the gate trips after `max_repeats` occurrences of the SAME
    /// normalized instruction, and `before_step` fails closed with an
    /// attributable message naming the count and threshold.
    #[tokio::test]
    async fn intent_dedup_gate_trips_after_max_repeats_identical_instructions() {
        let gate = intent_dedup_gate(2);
        assert!(gate.before_step("s0").await.is_ok());
        gate.after_step(&intent_actuals("s0", "scaffold the widget")).await;
        gate.after_step(&intent_actuals("s1", "scaffold the widget")).await;
        // Two occurrences at threshold 2 is not yet a breach (count > max_repeats).
        assert!(gate.before_step("s2").await.is_ok());
        gate.after_step(&intent_actuals("s2", "scaffold the widget")).await;
        // Third occurrence exceeds max_repeats=2.
        let err = gate
            .before_step("s3")
            .await
            .expect_err("must trip after exceeding max_repeats identical instructions");
        assert!(err.contains("repeated intent detected"), "{err}");
        assert!(err.contains("threshold 2"), "{err}");
    }

    /// Distinct instructions never trip the gate, no matter how many are
    /// recorded, because each hashes to a different signature.
    #[tokio::test]
    async fn intent_dedup_gate_distinct_instructions_never_trip() {
        let gate = intent_dedup_gate(1);
        for i in 0..5 {
            gate.after_step(&intent_actuals("s", &format!("do distinct task {i}")))
                .await;
        }
        assert!(
            gate.before_step("s5").await.is_ok(),
            "distinct instructions must not trip the dedup gate"
        );
    }

    /// The step id is excluded from the intent signature: two steps with
    /// different ids but identical normalized instruction text collide.
    #[tokio::test]
    async fn intent_dedup_gate_step_id_excluded_from_signature() {
        let gate = intent_dedup_gate(1);
        gate.after_step(&intent_actuals("alpha", "  Scaffold   the Widget  "))
            .await;
        gate.after_step(&intent_actuals("bravo-generated-9", "scaffold the widget"))
            .await;
        let err = gate
            .before_step("s2")
            .await
            .expect_err("different step ids with identical normalized instructions must collide");
        assert!(err.contains("repeated intent detected"), "{err}");
    }

    /// A `None` instruction (e.g. the hard-failure `StepActuals` literal) is a
    /// no-op: it does not increment any signature's count.
    #[tokio::test]
    async fn intent_dedup_gate_none_instruction_is_noop() {
        let gate = intent_dedup_gate(0);
        gate.after_step(&wobbly_actuals(0, false)).await; // instruction: None
        assert!(
            gate.before_step("s0").await.is_ok(),
            "a None instruction must not be counted"
        );
    }

    /// A blank or whitespace-only instruction normalizes to empty and carries
    /// no intent signal; it is a no-op (does not increment any signature), so
    /// genuinely-distinct blank steps do not collide into a false pause. With
    /// `max_repeats = 0`, any counted occurrence would trip, so a clean
    /// `before_step` proves the blank steps were skipped.
    #[tokio::test]
    async fn intent_dedup_gate_blank_instruction_is_noop() {
        let gate = intent_dedup_gate(0);
        gate.after_step(&intent_actuals("s0", "")).await;
        gate.after_step(&intent_actuals("s1", "   \t  ")).await;
        assert!(
            gate.before_step("s2").await.is_ok(),
            "blank/whitespace-only instructions must not be counted"
        );
    }

    /// When two distinct signatures both breach, `before_step` deterministically
    /// names the worst offender (highest count), not an arbitrary HashMap entry,
    /// so the diagnostic is reproducible.
    #[tokio::test]
    async fn intent_dedup_gate_reports_worst_offender_deterministically() {
        let gate = intent_dedup_gate(1);
        // signature A: 3 occurrences; signature B: 2 occurrences (both > 1).
        for _ in 0..3 {
            gate.after_step(&intent_actuals("s", "alpha task")).await;
        }
        for _ in 0..2 {
            gate.after_step(&intent_actuals("s", "beta task")).await;
        }
        let err = gate
            .before_step("s9")
            .await
            .expect_err("both signatures breach; the gate must trip");
        assert!(
            err.contains("occurred 3 times"),
            "must deterministically name the higher-count offender: {err}"
        );
    }

    /// Composition: a `ChainedPreStepGate` of [budget, oscillation,
    /// intent_dedup] fires the INTENT breach (not a budget or oscillation
    /// breach) when the same instruction repeats past the dedup threshold,
    /// even though tokens/oscillation stay well within their own limits.
    #[tokio::test]
    async fn chain_fires_intent_dedup_not_budget_or_oscillation() {
        let meter = Arc::new(Mutex::new(RunBudgetMeter::new(apply_defaults(&[]))));
        let budget_gate: Arc<dyn PreStepGate> = Arc::new(BudgetGate::new(meter));
        let (osc, _breaker) = oscillation_gate(10); // high oscillation threshold: won't trip
        let osc_gate: Arc<dyn PreStepGate> = Arc::new(osc);
        let dedup_gate: Arc<dyn PreStepGate> = Arc::new(intent_dedup_gate(2));
        let chain = ChainedPreStepGate::new(vec![budget_gate, osc_gate, dedup_gate]);

        for i in 0..3 {
            chain
                .after_step(&intent_actuals(&format!("s{i}"), "repeat the same instruction"))
                .await;
        }
        let err = chain
            .before_step("s3")
            .await
            .expect_err("chain must fail closed on repeated intent");
        assert!(err.contains("repeated intent detected"), "{err}");
        assert!(
            !err.contains("budget ceiling exceeded") && !err.contains("oscillation detected"),
            "must be the intent-dedup gate, not budget/oscillation: {err}"
        );
    }

    /// AC-1: accumulated tokens over the ceiling produce a breach, and the gate
    /// fails the next step closed with an error naming axis, ceiling, actual.
    #[tokio::test]
    async fn tokens_breach_pauses_at_next_boundary() {
        let meter = RunBudgetMeter::new(vec![ceiling(
            RunBudgetAxis::Tokens,
            BudgetValue::Integer(100),
        )]);
        let meter = Arc::new(Mutex::new(meter));
        let gate = BudgetGate::new(meter.clone());

        // First boundary: nothing recorded, under budget -> Ok.
        assert!(gate.before_step("s0").await.is_ok());

        // A step burns 101 tokens (> ceiling 100).
        gate.after_step(&actuals(Some(101), None, None)).await;

        // Next boundary: breach -> Err naming the axis, ceiling, actual.
        let err = gate.before_step("s1").await.unwrap_err();
        assert!(err.contains("Tokens"), "error must name the axis: {err}");
        assert!(err.contains("100"), "error must name the ceiling: {err}");
        assert!(err.contains("101"), "error must name the actual: {err}");
        assert!(err.contains("s1"), "error must name the step: {err}");
    }

    /// A run under its ceiling never pauses.
    #[tokio::test]
    async fn under_ceiling_does_not_pause() {
        let meter = Arc::new(Mutex::new(RunBudgetMeter::new(vec![ceiling(
            RunBudgetAxis::Tokens,
            BudgetValue::Integer(1_000),
        )])));
        let gate = BudgetGate::new(meter);
        gate.after_step(&actuals(Some(400), None, None)).await;
        gate.after_step(&actuals(Some(400), None, None)).await;
        assert!(gate.before_step("s2").await.is_ok());
    }

    /// `spawned_agents` increments by one per recorded step and breaches when
    /// the dispatched-step count exceeds the ceiling.
    #[tokio::test]
    async fn spawned_agents_counts_per_step() {
        let meter = Arc::new(Mutex::new(RunBudgetMeter::new(vec![ceiling(
            RunBudgetAxis::SpawnedAgents,
            BudgetValue::Integer(2),
        )])));
        let gate = BudgetGate::new(meter);
        gate.after_step(&actuals(None, None, None)).await; // 1
        gate.after_step(&actuals(None, None, None)).await; // 2 (== ceiling, ok)
        assert!(gate.before_step("s2").await.is_ok());
        gate.after_step(&actuals(None, None, None)).await; // 3 (> ceiling)
        assert!(gate.before_step("s3").await.is_err());
    }

    /// `tool_invocations` accumulates the per-step `num_turns`.
    #[tokio::test]
    async fn tool_invocations_accumulate_turns() {
        let meter = Arc::new(Mutex::new(RunBudgetMeter::new(vec![ceiling(
            RunBudgetAxis::ToolInvocations,
            BudgetValue::Integer(5),
        )])));
        let gate = BudgetGate::new(meter);
        gate.after_step(&actuals(None, None, Some(3))).await;
        gate.after_step(&actuals(None, None, Some(3))).await; // 6 > 5
        assert!(gate.before_step("s2").await.is_err());
    }

    /// `file_mutations` is metered at zero and never breaches, even with a
    /// tight ceiling (the executor reports no mutations today).
    #[tokio::test]
    async fn file_mutations_never_breaches_today() {
        let meter = Arc::new(Mutex::new(RunBudgetMeter::new(vec![ceiling(
            RunBudgetAxis::FileMutations,
            BudgetValue::Integer(0),
        )])));
        let gate = BudgetGate::new(meter);
        for _ in 0..10 {
            gate.after_step(&actuals(Some(10), Some(1.0), Some(5))).await;
        }
        assert!(gate.before_step("s").await.is_ok());
    }

    /// AC-5: the meter cannot un-breach itself. Once over the ceiling, further
    /// recording keeps it breached: there is no method that raises the
    /// ceiling, so the only escape is a new admission (a new meter).
    #[tokio::test]
    async fn meter_cannot_self_raise() {
        let meter = RunBudgetMeter::new(vec![ceiling(
            RunBudgetAxis::Tokens,
            BudgetValue::Integer(10),
        )]);
        let meter = Arc::new(Mutex::new(meter));
        let gate = BudgetGate::new(meter.clone());
        gate.after_step(&actuals(Some(11), None, None)).await;
        assert!(gate.before_step("a").await.is_err());
        // More work cannot clear the breach.
        gate.after_step(&actuals(Some(100), None, None)).await;
        assert!(gate.before_step("b").await.is_err());
        // The breach reflects the immutable ceiling from construction.
        let breach = meter.lock().unwrap().check().unwrap();
        assert_eq!(breach.axis, RunBudgetAxis::Tokens);
        assert_eq!(breach.ceiling, 10.0);
    }

    /// Platform defaults (no declared budgets) admit all six axes and a normal
    /// run stays well under them.
    #[tokio::test]
    async fn platform_defaults_admit_a_normal_run() {
        let meter = Arc::new(Mutex::new(RunBudgetMeter::new(apply_defaults(&[]))));
        let gate = BudgetGate::new(meter);
        // A modest run: a handful of steps, modest tokens/cost/turns.
        for _ in 0..5 {
            gate.after_step(&actuals(Some(1_000), Some(0.1), Some(5))).await;
        }
        assert!(gate.before_step("s5").await.is_ok());
    }

    /// FR-005: `consumption()` reports one row per admitted axis with the
    /// ceiling, accumulated actual, source, and a `breached` flag consistent
    /// with `check()`.
    #[tokio::test]
    async fn consumption_reports_every_axis_with_breach_flag() {
        let meter = RunBudgetMeter::new(vec![
            ceiling(RunBudgetAxis::Tokens, BudgetValue::Integer(100)),
            ceiling(RunBudgetAxis::ToolInvocations, BudgetValue::Integer(10)),
        ]);
        let meter = Arc::new(Mutex::new(meter));
        let gate = BudgetGate::new(meter.clone());
        // 150 tokens (over 100), 3 turns (under 10).
        gate.after_step(&actuals(Some(150), None, Some(3))).await;

        let rows = meter.lock().unwrap().consumption();
        assert_eq!(rows.len(), 2, "one row per admitted axis");
        let tokens = rows
            .iter()
            .find(|r| r.axis == RunBudgetAxis::Tokens)
            .expect("tokens row present");
        assert_eq!(tokens.ceiling, 100.0);
        assert_eq!(tokens.actual, 150.0);
        assert!(tokens.breached, "150 > 100");
        assert_eq!(tokens.source, BudgetSource::Declared);
        let tools = rows
            .iter()
            .find(|r| r.axis == RunBudgetAxis::ToolInvocations)
            .expect("tool_invocations row present");
        assert!(!tools.breached, "3 <= 10 must not breach");
    }

    // ── ChainedPreStepGate ───────────────────────────────────────────────────

    struct CountingGate {
        before_calls: Arc<AtomicUsize>,
        after_calls: Arc<AtomicUsize>,
        fail: bool,
    }

    #[async_trait]
    impl PreStepGate for CountingGate {
        async fn before_step(&self, _step_id: &str) -> Result<(), String> {
            self.before_calls.fetch_add(1, Ordering::SeqCst);
            if self.fail {
                Err("refused".into())
            } else {
                Ok(())
            }
        }
        async fn after_step(&self, _actuals: &StepActuals) {
            self.after_calls.fetch_add(1, Ordering::SeqCst);
        }
    }

    /// The chain short-circuits `before_step` on the first refusal: a later
    /// gate is not consulted.
    #[tokio::test]
    async fn chain_short_circuits_on_first_err() {
        let first_before = Arc::new(AtomicUsize::new(0));
        let second_before = Arc::new(AtomicUsize::new(0));
        let chain = ChainedPreStepGate::new(vec![
            Arc::new(CountingGate {
                before_calls: first_before.clone(),
                after_calls: Arc::new(AtomicUsize::new(0)),
                fail: true,
            }),
            Arc::new(CountingGate {
                before_calls: second_before.clone(),
                after_calls: Arc::new(AtomicUsize::new(0)),
                fail: false,
            }),
        ]);
        assert!(chain.before_step("s").await.is_err());
        assert_eq!(first_before.load(Ordering::SeqCst), 1);
        assert_eq!(
            second_before.load(Ordering::SeqCst),
            0,
            "second gate must not run after the first refuses"
        );
    }

    /// When every gate clears, the chain returns `Ok` and forwards `after_step`
    /// to all gates.
    #[tokio::test]
    async fn chain_runs_all_gates_when_clear() {
        let a_after = Arc::new(AtomicUsize::new(0));
        let b_after = Arc::new(AtomicUsize::new(0));
        let chain = ChainedPreStepGate::new(vec![
            Arc::new(CountingGate {
                before_calls: Arc::new(AtomicUsize::new(0)),
                after_calls: a_after.clone(),
                fail: false,
            }),
            Arc::new(CountingGate {
                before_calls: Arc::new(AtomicUsize::new(0)),
                after_calls: b_after.clone(),
                fail: false,
            }),
        ]);
        assert!(chain.before_step("s").await.is_ok());
        chain.after_step(&actuals(Some(1), None, None)).await;
        assert_eq!(a_after.load(Ordering::SeqCst), 1);
        assert_eq!(b_after.load(Ordering::SeqCst), 1);
    }

    /// The budget gate composes behind a passing grant-renewal-style gate: the
    /// chain pauses when the budget breaches even though the first gate clears.
    #[tokio::test]
    async fn chain_pauses_on_budget_breach_behind_passing_gate() {
        let meter = Arc::new(Mutex::new(RunBudgetMeter::new(vec![ceiling(
            RunBudgetAxis::Tokens,
            BudgetValue::Integer(10),
        )])));
        let budget = Arc::new(BudgetGate::new(meter));
        let passing = Arc::new(CountingGate {
            before_calls: Arc::new(AtomicUsize::new(0)),
            after_calls: Arc::new(AtomicUsize::new(0)),
            fail: false,
        });
        let chain = ChainedPreStepGate::new(vec![passing, budget.clone()]);
        assert!(chain.before_step("s0").await.is_ok());
        chain.after_step(&actuals(Some(11), None, None)).await;
        let err = chain.before_step("s1").await.unwrap_err();
        assert!(err.contains("budget ceiling exceeded"), "got: {err}");
    }
}
