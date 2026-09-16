//! The trust window: a rolling-window scorer mapping weighted samples to a
//! graduated privilege level.
//!
//! `trust-window` keeps `WindowConfig` and `WindowSnapshot` as two separate
//! values that must both be supplied to reconstruct a scorer. This module's
//! self-describing envelope carries both, so a snapshot round-trips its own
//! configuration (direction, thresholds, decay) across stateless addon calls.
//! The degrade-only latch lives in the snapshot's `stuck_severity`, so it too
//! survives the round-trip.

use serde::{Deserialize, Serialize};
use trust_window::{Level, WindowConfig, WindowScorer, WindowSnapshot};

/// Self-contained trust state: the window plus the config it is scored under.
#[derive(Serialize, Deserialize, Default)]
struct TrustEnvelope {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    config: Option<WindowConfig>,
    #[serde(default)]
    window: WindowSnapshot,
}

/// The graduated level and its numeric score.
pub struct TrustLevelOut {
    pub level: String,
    pub score: f64,
}

fn parse_env(json: Option<&str>) -> Result<TrustEnvelope, String> {
    match json {
        Some(raw) => {
            let trimmed = raw.trim();
            if trimmed.is_empty() || trimmed == "null" {
                Ok(TrustEnvelope::default())
            } else {
                serde_json::from_str(raw).map_err(|err| format!("trust snapshot: {err}"))
            }
        }
        None => Ok(TrustEnvelope::default()),
    }
}

fn level_str(level: Level) -> String {
    match level {
        Level::Full => "full",
        Level::Restricted => "restricted",
        Level::ReadOnly => "read-only",
        Level::Suspended => "suspended",
    }
    .to_string()
}

/// Fold one sample into the window and return the updated envelope JSON.
/// A `null`/absent snapshot starts a fresh window under the default config.
pub fn sample(snapshot_json: Option<&str>, sample_json: &str) -> Result<String, String> {
    let mut envelope = parse_env(snapshot_json)?;
    let sample: trust_window::Sample =
        serde_json::from_str(sample_json).map_err(|err| format!("trust sample: {err}"))?;

    let config = envelope.config.clone().unwrap_or_default();
    let mut scorer = WindowScorer::from_snapshot(config, envelope.window.clone());
    scorer.record(sample);
    envelope.window = scorer.snapshot();

    serde_json::to_string(&envelope).map_err(|err| format!("serialize trust snapshot: {err}"))
}

/// Read the graduated level and score from a snapshot envelope.
pub fn level(snapshot_json: &str) -> Result<TrustLevelOut, String> {
    let envelope = parse_env(Some(snapshot_json))?;
    let config = envelope.config.unwrap_or_default();
    let scorer = WindowScorer::from_snapshot(config, envelope.window);
    Ok(TrustLevelOut {
        level: level_str(scorer.level()),
        score: scorer.score(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use trust_window::Direction;

    const ALIGNED: &str = r#"{"value":1.0,"weight":1.0}"#;
    const VIOLATION: &str = r#"{"value":0.0,"weight":1.0}"#;

    fn env_with(config: WindowConfig) -> String {
        serde_json::to_string(&TrustEnvelope {
            config: Some(config),
            window: WindowSnapshot::default(),
        })
        .unwrap()
    }

    fn apply(snapshot: String, sample_json: &str, times: usize) -> String {
        let mut snapshot = snapshot;
        for _ in 0..times {
            snapshot = sample(Some(&snapshot), sample_json).unwrap();
        }
        snapshot
    }

    #[test]
    fn fresh_window_is_full_trust() {
        let snapshot = sample(None, ALIGNED).unwrap();
        let out = level(&snapshot).unwrap();
        assert_eq!(out.level, "full");
        assert!((out.score - 1.0).abs() < 1e-9);
    }

    #[test]
    fn degrade_only_latches_and_does_not_self_promote() {
        let mut config = WindowConfig::default();
        config.window_size = 8;
        // default direction is DegradeOnly

        let snapshot = env_with(config);
        let after_violations = apply(snapshot, VIOLATION, 8);
        assert_eq!(level(&after_violations).unwrap().level, "suspended");

        // Recovery must not lift the latch: the level stays suspended even as
        // the raw score climbs back toward full.
        let after_recovery = apply(after_violations, ALIGNED, 8);
        assert_eq!(level(&after_recovery).unwrap().level, "suspended");
    }

    #[test]
    fn bidirectional_promotes_on_recovery() {
        let mut config = WindowConfig::default();
        config.window_size = 8;
        config.direction = Direction::Bidirectional;

        let snapshot = env_with(config);
        let after_violations = apply(snapshot, VIOLATION, 8);
        assert_eq!(level(&after_violations).unwrap().level, "suspended");

        let after_recovery = apply(after_violations, ALIGNED, 8);
        assert_eq!(level(&after_recovery).unwrap().level, "full");
    }

    #[test]
    fn config_round_trips_through_the_snapshot() {
        let mut config = WindowConfig::default();
        config.window_size = 8;
        config.direction = Direction::Bidirectional;

        // If config did not round-trip, the degrade-only default would latch
        // and this recovery-to-full assertion would fail.
        let snapshot = apply(env_with(config), VIOLATION, 8);
        let snapshot = apply(snapshot, ALIGNED, 8);
        assert_eq!(level(&snapshot).unwrap().level, "full");
    }
}
