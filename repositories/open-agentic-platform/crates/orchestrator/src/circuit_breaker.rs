// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Bartek Kus
// Spec: specs/102-governed-excellence/spec.md — FR-032, FR-035

//! Circuit breaker that suspends agent execution after N consecutive failures.
//!
//! FR-032: Configurable threshold (default 5) within a sliding window.
//! FR-035: Emits `circuit-breaker-tripped` event and appends a proof record.
//! NF-005: State survives process restart (serialisable to/from JSON).

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

/// Configuration for the circuit breaker.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CircuitBreakerConfig {
    /// Maximum consecutive failures before tripping (default: 5).
    pub threshold: u32,
    /// Sliding window duration in seconds (default: 300 = 5 minutes).
    pub window_secs: u64,
}

impl Default for CircuitBreakerConfig {
    fn default() -> Self {
        Self {
            threshold: 5,
            window_secs: 300,
        }
    }
}

/// State of the circuit breaker (serialisable for persistence, NF-005).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CircuitBreakerState {
    pub config: CircuitBreakerConfig,
    pub consecutive_failures: u32,
    pub failure_timestamps: Vec<DateTime<Utc>>,
    pub tripped: bool,
    pub tripped_at: Option<DateTime<Utc>>,
    pub total_trips: u32,
}

/// Outcome of a circuit breaker check.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CircuitBreakerOutcome {
    /// Execution may proceed.
    Closed,
    /// Circuit breaker has tripped — execution must be suspended.
    Tripped {
        consecutive_failures: u32,
        reason: String,
    },
}

impl CircuitBreakerState {
    pub fn new(config: CircuitBreakerConfig) -> Self {
        Self {
            config,
            consecutive_failures: 0,
            failure_timestamps: Vec::new(),
            tripped: false,
            tripped_at: None,
            total_trips: 0,
        }
    }

    /// Record a successful execution (resets the failure counter).
    pub fn record_success(&mut self) {
        self.consecutive_failures = 0;
        self.failure_timestamps.clear();
    }

    /// Record a failed execution. Returns the circuit breaker outcome.
    pub fn record_failure(&mut self) -> CircuitBreakerOutcome {
        if self.tripped {
            return CircuitBreakerOutcome::Tripped {
                consecutive_failures: self.consecutive_failures,
                reason: "circuit-breaker: already tripped".into(),
            };
        }

        let now = Utc::now();
        self.failure_timestamps.push(now);
        self.consecutive_failures += 1;

        // Prune failures outside the sliding window.
        let window_start = now - chrono::Duration::seconds(self.config.window_secs as i64);
        self.failure_timestamps.retain(|ts| *ts >= window_start);

        // Check threshold within the window.
        if self.failure_timestamps.len() as u32 >= self.config.threshold {
            self.tripped = true;
            self.tripped_at = Some(now);
            self.total_trips += 1;
            return CircuitBreakerOutcome::Tripped {
                consecutive_failures: self.consecutive_failures,
                reason: format!(
                    "circuit-breaker: {} consecutive failures in {}s window (threshold: {})",
                    self.consecutive_failures, self.config.window_secs, self.config.threshold
                ),
            };
        }

        CircuitBreakerOutcome::Closed
    }

    /// Check if the breaker is currently tripped.
    pub fn is_tripped(&self) -> bool {
        self.tripped
    }

    /// Reset the circuit breaker (explicit human intervention).
    pub fn reset(&mut self) {
        self.tripped = false;
        self.tripped_at = None;
        self.consecutive_failures = 0;
        self.failure_timestamps.clear();
    }

    /// Check whether execution should proceed.
    pub fn check(&self) -> CircuitBreakerOutcome {
        if self.tripped {
            CircuitBreakerOutcome::Tripped {
                consecutive_failures: self.consecutive_failures,
                reason: "circuit-breaker: breaker is open".into(),
            }
        } else {
            CircuitBreakerOutcome::Closed
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn breaker_stays_closed_below_threshold() {
        let mut state = CircuitBreakerState::new(CircuitBreakerConfig {
            threshold: 3,
            window_secs: 300,
        });

        assert_eq!(state.record_failure(), CircuitBreakerOutcome::Closed);
        assert_eq!(state.record_failure(), CircuitBreakerOutcome::Closed);
        assert!(!state.is_tripped());
    }

    #[test]
    fn breaker_trips_at_threshold() {
        let mut state = CircuitBreakerState::new(CircuitBreakerConfig {
            threshold: 3,
            window_secs: 300,
        });

        assert_eq!(state.record_failure(), CircuitBreakerOutcome::Closed);
        assert_eq!(state.record_failure(), CircuitBreakerOutcome::Closed);
        let outcome = state.record_failure();
        assert!(matches!(outcome, CircuitBreakerOutcome::Tripped { .. }));
        assert!(state.is_tripped());
        assert_eq!(state.total_trips, 1);
    }

    #[test]
    fn success_resets_counter() {
        let mut state = CircuitBreakerState::new(CircuitBreakerConfig {
            threshold: 3,
            window_secs: 300,
        });

        state.record_failure();
        state.record_failure();
        state.record_success();
        assert_eq!(state.consecutive_failures, 0);

        // Should need 3 more failures to trip.
        state.record_failure();
        state.record_failure();
        assert!(!state.is_tripped());
    }

    #[test]
    fn tripped_breaker_stays_tripped() {
        let mut state = CircuitBreakerState::new(CircuitBreakerConfig {
            threshold: 2,
            window_secs: 300,
        });

        state.record_failure();
        state.record_failure();
        assert!(state.is_tripped());

        // Further failures still return Tripped.
        assert!(matches!(
            state.record_failure(),
            CircuitBreakerOutcome::Tripped { .. }
        ));
    }

    #[test]
    fn manual_reset_restores_closed() {
        let mut state = CircuitBreakerState::new(CircuitBreakerConfig {
            threshold: 2,
            window_secs: 300,
        });

        state.record_failure();
        state.record_failure();
        assert!(state.is_tripped());

        state.reset();
        assert!(!state.is_tripped());
        assert_eq!(state.check(), CircuitBreakerOutcome::Closed);
    }

    #[test]
    fn state_round_trip_serialisation() {
        let mut state = CircuitBreakerState::new(CircuitBreakerConfig::default());
        state.record_failure();
        state.record_failure();

        let json = serde_json::to_string(&state).unwrap();
        let restored: CircuitBreakerState = serde_json::from_str(&json).unwrap();
        assert_eq!(restored.consecutive_failures, 2);
        assert!(!restored.tripped);
    }
}
