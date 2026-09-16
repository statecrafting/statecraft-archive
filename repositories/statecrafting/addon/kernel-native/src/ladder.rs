// SPDX-License-Identifier: Apache-2.0

//! Trust-window scoring over consumer-persisted snapshots.
//!
//! The scorer never touches a database and never sees a clock: the snapshot is
//! loaded from and persisted back to the consumer's store, which is what keeps
//! scoring deterministic (same sample sequence, same score and level). Mapping
//! domain review outcomes onto samples is the consumer's vocabulary, not the
//! kernel's (chancery's `ReviewOutcome` is the worked example).

use serde::{Deserialize, Serialize};
use trust_window::{Level, Sample, WindowConfig, WindowScorer, WindowSnapshot};

/// The result of scoring new samples against a (possibly rehydrated) window.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScoreResult {
    pub score: f64,
    pub level: Level,
    /// The new snapshot to persist back to the consumer's store.
    pub snapshot: WindowSnapshot,
}

/// Score new samples against a window. Pass `None` for a fresh window.
pub fn score(
    config: WindowConfig,
    snapshot: Option<WindowSnapshot>,
    samples: &[Sample],
) -> ScoreResult {
    let mut scorer = match snapshot {
        Some(s) => WindowScorer::from_snapshot(config, s),
        None => WindowScorer::new(config),
    };
    for s in samples {
        scorer.record(*s);
    }
    ScoreResult {
        score: scorer.score(),
        level: scorer.level(),
        snapshot: scorer.snapshot(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn scoring_is_deterministic_and_snapshot_resumes() {
        let cfg = WindowConfig::default();
        let up: Vec<Sample> = (0..15).map(|_| Sample::new(1.0)).collect();
        let first = score(cfg.clone(), None, &up);
        let again = score(cfg.clone(), None, &up);
        assert_eq!(first.score, again.score);
        assert_eq!(first.level, again.level);

        let resumed = score(cfg, Some(first.snapshot.clone()), &[]);
        assert_eq!(resumed.score, first.score);
    }
}
