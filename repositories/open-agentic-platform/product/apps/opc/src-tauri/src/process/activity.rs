//! Spec 172 — Live agent-session introspection
//!
//! Per-session activity tracker. Records tool-call events and token usage in
//! a 60-second sliding window, exposes a snapshot used by the Live Sessions
//! panel to compute event rate, recent tool-call list, and status indicator.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::collections::VecDeque;

/// One tool invocation event recorded by the activity tracker.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolCallEvent {
    pub tool_name: String,
    pub started_at: DateTime<Utc>,
    pub duration_ms: u64,
    pub success: bool,
}

/// Snapshot of the activity tracker, suitable for rendering in the panel.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ActivitySnapshot {
    /// Tool calls in the last 60s.
    pub tool_calls_per_minute: u64,
    /// Token consumption (input + output) in the last 60s.
    pub tokens_per_minute: u64,
    /// Cumulative tool calls since session started.
    pub cumulative_tool_calls: u64,
    /// Cumulative tokens since session started.
    pub cumulative_tokens: u64,
    /// Most recent tool calls (newest first, capped to a small N).
    pub recent_tool_calls: Vec<ToolCallEvent>,
    /// Wall-clock of the most recent event, if any.
    pub last_event_at: Option<DateTime<Utc>>,
}

const SLIDING_WINDOW_SECS: i64 = 60;
const MAX_RECENT_TOOL_CALLS: usize = 10;

/// Tracks per-session activity in a 60s sliding window plus cumulative totals.
///
/// Cheap to construct; cheap to update; cheap to snapshot. Designed to live
/// inside a `Mutex` on the per-process `ProcessHandle`.
#[derive(Debug, Default)]
pub struct ActivityTracker {
    tool_call_events: VecDeque<ToolCallEvent>,
    token_events: VecDeque<TokenEvent>,
    cumulative_tool_calls: u64,
    cumulative_tokens: u64,
}

#[derive(Debug, Clone)]
struct TokenEvent {
    at: DateTime<Utc>,
    count: u64,
}

impl ActivityTracker {
    pub fn new() -> Self {
        Self::default()
    }

    /// Record a tool invocation. The event is added to the sliding window and
    /// to the recent-tool-calls ring.
    pub fn record_tool_call(&mut self, event: ToolCallEvent) {
        self.cumulative_tool_calls = self.cumulative_tool_calls.saturating_add(1);
        self.tool_call_events.push_back(event);
        self.prune_tool_calls(Utc::now());
    }

    /// Record token consumption (input + output for the most recent assistant
    /// turn, or any granularity the caller chooses to report).
    pub fn record_tokens(&mut self, count: u64) {
        self.cumulative_tokens = self.cumulative_tokens.saturating_add(count);
        self.token_events.push_back(TokenEvent {
            at: Utc::now(),
            count,
        });
        self.prune_tokens(Utc::now());
    }

    /// Drop events older than the sliding window. Called automatically before
    /// each snapshot, exposed for tests.
    pub fn prune(&mut self, now: DateTime<Utc>) {
        self.prune_tool_calls(now);
        self.prune_tokens(now);
    }

    fn prune_tool_calls(&mut self, now: DateTime<Utc>) {
        let cutoff = now - chrono::Duration::seconds(SLIDING_WINDOW_SECS);
        while let Some(front) = self.tool_call_events.front() {
            if front.started_at < cutoff {
                self.tool_call_events.pop_front();
            } else {
                break;
            }
        }
    }

    fn prune_tokens(&mut self, now: DateTime<Utc>) {
        let cutoff = now - chrono::Duration::seconds(SLIDING_WINDOW_SECS);
        while let Some(front) = self.token_events.front() {
            if front.at < cutoff {
                self.token_events.pop_front();
            } else {
                break;
            }
        }
    }

    /// Produce a snapshot. Prunes the windows as a side effect to keep the
    /// `tool_calls_per_minute` / `tokens_per_minute` figures honest.
    pub fn snapshot(&mut self) -> ActivitySnapshot {
        self.prune(Utc::now());

        let tokens_per_minute = self.token_events.iter().map(|e| e.count).sum();

        let last_event_at = match (
            self.tool_call_events.back().map(|e| e.started_at),
            self.token_events.back().map(|e| e.at),
        ) {
            (Some(a), Some(b)) => Some(a.max(b)),
            (Some(a), None) => Some(a),
            (None, Some(b)) => Some(b),
            (None, None) => None,
        };

        let mut recent: Vec<ToolCallEvent> = self.tool_call_events.iter().cloned().collect();
        recent.reverse();
        recent.truncate(MAX_RECENT_TOOL_CALLS);

        ActivitySnapshot {
            tool_calls_per_minute: self.tool_call_events.len() as u64,
            tokens_per_minute,
            cumulative_tool_calls: self.cumulative_tool_calls,
            cumulative_tokens: self.cumulative_tokens,
            recent_tool_calls: recent,
            last_event_at,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn event_at(name: &str, at: DateTime<Utc>) -> ToolCallEvent {
        ToolCallEvent {
            tool_name: name.into(),
            started_at: at,
            duration_ms: 42,
            success: true,
        }
    }

    #[test]
    fn empty_snapshot_is_zeroed() {
        let mut t = ActivityTracker::new();
        let s = t.snapshot();
        assert_eq!(s.tool_calls_per_minute, 0);
        assert_eq!(s.tokens_per_minute, 0);
        assert_eq!(s.cumulative_tool_calls, 0);
        assert_eq!(s.cumulative_tokens, 0);
        assert!(s.recent_tool_calls.is_empty());
        assert!(s.last_event_at.is_none());
    }

    #[test]
    fn recent_tool_calls_are_newest_first_and_capped() {
        let mut t = ActivityTracker::new();
        let now = Utc::now();
        for i in 0..(MAX_RECENT_TOOL_CALLS + 5) {
            t.record_tool_call(event_at(
                &format!("tool-{i}"),
                now + chrono::Duration::milliseconds(i as i64),
            ));
        }
        let s = t.snapshot();
        assert_eq!(s.recent_tool_calls.len(), MAX_RECENT_TOOL_CALLS);
        // Newest first: tool-14 should be at index 0.
        assert_eq!(
            s.recent_tool_calls.first().unwrap().tool_name,
            format!("tool-{}", MAX_RECENT_TOOL_CALLS + 4)
        );
        // Cumulative captures everything, regardless of recent-list cap.
        assert_eq!(s.cumulative_tool_calls, (MAX_RECENT_TOOL_CALLS + 5) as u64);
    }

    #[test]
    fn sliding_window_drops_old_events() {
        let mut t = ActivityTracker::new();
        let now = Utc::now();
        // Two old events (90s ago) and three fresh ones.
        let old = now - chrono::Duration::seconds(90);
        t.record_tool_call(event_at("old-1", old));
        t.record_tool_call(event_at("old-2", old));
        t.record_tool_call(event_at("fresh-1", now));
        t.record_tool_call(event_at("fresh-2", now));
        t.record_tool_call(event_at("fresh-3", now));

        let s = t.snapshot();
        // Only fresh events count toward per-minute rate.
        assert_eq!(s.tool_calls_per_minute, 3);
        // Cumulative still sees all 5.
        assert_eq!(s.cumulative_tool_calls, 5);
    }

    #[test]
    fn tokens_per_minute_sums_window() {
        let mut t = ActivityTracker::new();
        t.record_tokens(100);
        t.record_tokens(250);
        let s = t.snapshot();
        assert_eq!(s.tokens_per_minute, 350);
        assert_eq!(s.cumulative_tokens, 350);
    }

    #[test]
    fn prune_with_explicit_now_drops_expired_tokens() {
        let mut t = ActivityTracker::new();
        t.record_tokens(50);
        t.record_tokens(75);
        // Pretend the clock advanced past the window.
        let future = Utc::now() + chrono::Duration::seconds(120);
        t.prune(future);
        let s = t.snapshot();
        assert_eq!(s.tokens_per_minute, 0);
        // Cumulative remains.
        assert_eq!(s.cumulative_tokens, 125);
    }

    #[test]
    fn last_event_at_picks_the_latest_across_streams() {
        let mut t = ActivityTracker::new();
        let now = Utc::now();
        t.record_tool_call(event_at("a", now));
        // Force tokens to be a known-newer event.
        std::thread::sleep(std::time::Duration::from_millis(5));
        t.record_tokens(10);
        let s = t.snapshot();
        // last_event_at must reflect the more recent token event.
        let token_at = s.last_event_at.expect("last_event_at set");
        let tool_at = now;
        assert!(token_at >= tool_at);
    }
}
