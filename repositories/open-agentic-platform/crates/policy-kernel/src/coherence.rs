//! FR-008 / SC-007 / SC-008: rolling-window coherence score and monotonic privilege degradation.
//! No wall clock — deterministic given the recorded action sequence.

use serde::{Deserialize, Serialize};
use trust_window::{Direction, Level, LevelThresholds, Sample, WindowConfig, WindowScorer};

/// Privilege level derived from coherence (FR-008).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum PrivilegeLevel {
    /// coherence >= 0.8 — all permitted operations available.
    Full,
    /// 0.5 <= coherence < 0.8 — destructive operations require confirmation.
    Restricted,
    /// 0.2 <= coherence < 0.5 — only read operations permitted.
    ReadOnly,
    /// coherence < 0.2 — all operations blocked pending human review.
    Suspended,
}

impl PrivilegeLevel {
    /// Higher = less permissive (worse).
    #[inline]
    pub fn severity(self) -> u8 {
        match self {
            PrivilegeLevel::Full => 0,
            PrivilegeLevel::Restricted => 1,
            PrivilegeLevel::ReadOnly => 2,
            PrivilegeLevel::Suspended => 3,
        }
    }

    /// Worst (most restrictive) of two levels.
    #[inline]
    pub fn max_severity(a: Self, b: Self) -> Self {
        if a.severity() >= b.severity() { a } else { b }
    }
}

/// Tunable coherence scheduler (defaults match `specs/047` narrative).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CoherenceSchedulerConfig {
    /// Rolling window length (default 50).
    pub window_size: usize,
    /// Per-position weight for the newest action is 1.0; each step older multiplies by this (default 0.95).
    pub decay_lambda: f64,
    /// SC-007: when policy-violating actions in the window reach this count, privilege is at least `Restricted`.
    pub violation_count_for_restricted: u32,
}

impl Default for CoherenceSchedulerConfig {
    fn default() -> Self {
        Self {
            window_size: 50,
            decay_lambda: 0.95,
            violation_count_for_restricted: 3,
        }
    }
}

/// Rolling-window coherence + monotonic session degradation (SC-008).
///
/// Spec 231: implemented over the extracted `trust-window` scorer
/// (`Direction::DegradeOnly`), so OAP is consumer-zero of the shared primitive.
/// `PrivilegeLevel` and this type's public API are unchanged; the scoring math
/// is identical (a boolean action is a `Sample::aligned`), guarded by the tests
/// below. There are no external consumers of this module today.
#[derive(Debug, Clone, PartialEq)]
pub struct CoherenceScheduler {
    config: CoherenceSchedulerConfig,
    scorer: WindowScorer,
}

impl CoherenceScheduler {
    pub fn new(config: CoherenceSchedulerConfig) -> Self {
        let scorer = WindowScorer::new(window_config(&config));
        Self { config, scorer }
    }

    pub fn with_defaults() -> Self {
        Self::new(CoherenceSchedulerConfig::default())
    }

    pub fn config(&self) -> &CoherenceSchedulerConfig {
        &self.config
    }

    /// Record one action. `aligned` is `false` when the policy layer intervened (deny, degrade, or counted warn).
    pub fn record_action(&mut self, aligned: bool) {
        self.scorer.record(Sample::aligned(aligned));
    }

    /// Convenience: treat deny/degrade outcomes as non-aligned.
    pub fn record_from_policy_outcome(&mut self, outcome: &super::PolicyOutcome) {
        self.record_action(matches!(outcome, super::PolicyOutcome::Allow));
    }

    /// Human explicitly restores maximum privilege: clears the rolling window and monotonic latch (SC-008).
    pub fn human_restore(&mut self) {
        self.scorer.restore_max();
    }

    /// Weighted coherence in \[0, 1\] from the rolling window (spec: aligned/total with decay weighting).
    pub fn coherence_score(&self) -> f64 {
        self.scorer.score()
    }

    /// Policy-violating action count in the current window.
    pub fn violation_count(&self) -> u32 {
        self.scorer.violation_count()
    }

    /// Level implied by coherence thresholds only (before violation floor and monotonic cap).
    pub fn level_from_score(score: f64) -> PrivilegeLevel {
        from_level(default_thresholds().level_of(score))
    }

    /// Raw level from score + SC-007 violation floor.
    pub fn raw_privilege_level(&self) -> PrivilegeLevel {
        from_level(self.scorer.raw_level())
    }

    /// Effective level with monotonic degradation (SC-008).
    pub fn effective_privilege_level(&self) -> PrivilegeLevel {
        from_level(self.scorer.level())
    }
}

/// The FR-008 coherence bands (Full >= 0.8, Restricted >= 0.5, ReadOnly >= 0.2).
fn default_thresholds() -> LevelThresholds {
    LevelThresholds {
        full: 0.8,
        restricted: 0.5,
        read_only: 0.2,
    }
}

/// Build the trust-window config from OAP's coherence config: degrade-only, the
/// FR-008 bands, and the SC-007 violation floor. A boolean `false` action is a
/// value-0.0 sample, so the 0.5 violation threshold reproduces OAP's count.
fn window_config(c: &CoherenceSchedulerConfig) -> WindowConfig {
    WindowConfig {
        window_size: c.window_size,
        direction: Direction::DegradeOnly,
        decay_lambda: c.decay_lambda,
        thresholds: default_thresholds(),
        violation_threshold: 0.5,
        violation_floor: c.violation_count_for_restricted,
        promote_min_samples: 0,
    }
}

fn from_level(level: Level) -> PrivilegeLevel {
    match level {
        Level::Full => PrivilegeLevel::Full,
        Level::Restricted => PrivilegeLevel::Restricted,
        Level::ReadOnly => PrivilegeLevel::ReadOnly,
        Level::Suspended => PrivilegeLevel::Suspended,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sc007_violations_force_at_least_restricted() {
        let cfg = CoherenceSchedulerConfig {
            violation_count_for_restricted: 2,
            window_size: 10,
            decay_lambda: 1.0,
        };
        let mut s = CoherenceScheduler::new(cfg);
        // Score alone would be Full (8/10 aligned), but SC-007 forces at least Restricted.
        for _ in 0..8 {
            s.record_action(true);
        }
        s.record_action(false);
        s.record_action(false);
        assert_eq!(s.coherence_score(), 0.8);
        assert_eq!(s.raw_privilege_level(), PrivilegeLevel::Restricted);
    }

    #[test]
    fn sc008_monotonic_no_self_promotion() {
        let cfg = CoherenceSchedulerConfig {
            window_size: 20,
            violation_count_for_restricted: 100,
            decay_lambda: 1.0,
        };
        let mut s = CoherenceScheduler::new(cfg);
        // Uniform window: 10/20 aligned → 0.5 → Restricted (FR-008 band)
        for _ in 0..10 {
            s.record_action(true);
        }
        for _ in 0..10 {
            s.record_action(false);
        }
        assert_eq!(s.raw_privilege_level(), PrivilegeLevel::Restricted);
        assert_eq!(s.effective_privilege_level(), PrivilegeLevel::Restricted);
        // Flush window with all-aligned actions — raw returns to Full, effective stays latched
        for _ in 0..40 {
            s.record_action(true);
        }
        assert_eq!(s.coherence_score(), 1.0);
        assert_eq!(s.raw_privilege_level(), PrivilegeLevel::Full);
        assert_eq!(
            s.effective_privilege_level(),
            PrivilegeLevel::Restricted,
            "must not self-promote to Full"
        );
        s.human_restore();
        assert_eq!(s.effective_privilege_level(), PrivilegeLevel::Full);
    }

    #[test]
    fn threshold_crossing_read_only_and_suspended() {
        let cfg = CoherenceSchedulerConfig {
            window_size: 10,
            violation_count_for_restricted: 100, // disable SC-007 floor for this test
            ..CoherenceSchedulerConfig::default()
        };
        let mut s = CoherenceScheduler::new(cfg.clone());
        // 30% aligned → between 0.2 and 0.5 → ReadOnly
        for _ in 0..3 {
            s.record_action(true);
        }
        for _ in 0..7 {
            s.record_action(false);
        }
        assert_eq!(s.raw_privilege_level(), PrivilegeLevel::ReadOnly);
        let mut s2 = CoherenceScheduler::new(cfg.clone());
        for _ in 0..10 {
            s2.record_action(false);
        }
        assert_eq!(s2.raw_privilege_level(), PrivilegeLevel::Suspended);
    }

    #[test]
    fn weighted_window_favors_recent() {
        let cfg = CoherenceSchedulerConfig {
            window_size: 4,
            decay_lambda: 0.5,
            ..CoherenceSchedulerConfig::default()
        };
        let mut s = CoherenceScheduler::new(cfg);
        s.record_action(true);
        s.record_action(true);
        s.record_action(false);
        s.record_action(false);
        // Weights oldest→newest: 0.125, 0.25, 0.5, 1.0 → aligned on first two only
        let w = [0.125_f64, 0.25, 0.5, 1.0];
        let expected = (w[0] + w[1]) / w.iter().sum::<f64>();
        assert!((s.coherence_score() - expected).abs() < 1e-9);
    }
}
