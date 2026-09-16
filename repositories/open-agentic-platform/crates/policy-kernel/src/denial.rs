// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Bartek Kus

//! Denial tracking with threshold-based escalation (spec 068, FR-005).
//!
//! Tracks consecutive denials per tool. After a configurable threshold,
//! escalates from interactive ask → blocking deny for the session.

use std::collections::HashMap;

/// What the system should do after a denial is recorded.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EscalationAction {
    /// Under threshold — continue with normal ask flow.
    Continue,
    /// At threshold — force interactive prompt.
    Escalate,
    /// Over threshold — block for the rest of the session.
    Block,
}

/// Per-tool consecutive denial counter (FR-005).
pub struct DenialTracker {
    counts: HashMap<String, u32>,
    threshold: u32,
}

impl DenialTracker {
    /// Create a tracker with the given escalation threshold (default: 3).
    pub fn new(threshold: u32) -> Self {
        Self {
            counts: HashMap::new(),
            threshold,
        }
    }

    /// Record a denial for the given tool. Returns the escalation action.
    pub fn record_denial(&mut self, tool: &str) -> EscalationAction {
        let count = self.counts.entry(tool.to_owned()).or_insert(0);
        *count += 1;

        if *count > self.threshold {
            EscalationAction::Block
        } else if *count == self.threshold {
            EscalationAction::Escalate
        } else {
            EscalationAction::Continue
        }
    }

    /// Record an approval — resets the consecutive denial counter for the tool.
    pub fn record_approval(&mut self, tool: &str) {
        self.counts.remove(tool);
    }

    /// Check the current escalation state without recording a new denial.
    pub fn check(&self, tool: &str) -> EscalationAction {
        match self.counts.get(tool) {
            None => EscalationAction::Continue,
            Some(&count) if count > self.threshold => EscalationAction::Block,
            Some(&count) if count == self.threshold => EscalationAction::Escalate,
            Some(_) => EscalationAction::Continue,
        }
    }

    /// Get the current denial count for a tool.
    pub fn count(&self, tool: &str) -> u32 {
        self.counts.get(tool).copied().unwrap_or(0)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fresh_tracker_returns_continue() {
        let tracker = DenialTracker::new(3);
        assert_eq!(tracker.check("Bash"), EscalationAction::Continue);
        assert_eq!(tracker.count("Bash"), 0);
    }

    #[test]
    fn escalation_progression() {
        let mut tracker = DenialTracker::new(3);

        assert_eq!(tracker.record_denial("Bash"), EscalationAction::Continue); // 1
        assert_eq!(tracker.record_denial("Bash"), EscalationAction::Continue); // 2
        assert_eq!(tracker.record_denial("Bash"), EscalationAction::Escalate); // 3 = threshold
        assert_eq!(tracker.record_denial("Bash"), EscalationAction::Block); // 4 > threshold
        assert_eq!(tracker.record_denial("Bash"), EscalationAction::Block); // stays blocked
    }

    #[test]
    fn approval_resets_counter() {
        let mut tracker = DenialTracker::new(3);
        tracker.record_denial("Bash");
        tracker.record_denial("Bash");
        assert_eq!(tracker.count("Bash"), 2);

        tracker.record_approval("Bash");
        assert_eq!(tracker.count("Bash"), 0);
        assert_eq!(tracker.check("Bash"), EscalationAction::Continue);
    }

    #[test]
    fn independent_tools() {
        let mut tracker = DenialTracker::new(2);
        tracker.record_denial("Bash");
        tracker.record_denial("Bash");
        assert_eq!(tracker.check("Bash"), EscalationAction::Escalate);
        assert_eq!(tracker.check("FileWrite"), EscalationAction::Continue);
    }

    #[test]
    fn threshold_one() {
        let mut tracker = DenialTracker::new(1);
        assert_eq!(tracker.record_denial("Bash"), EscalationAction::Escalate);
        assert_eq!(tracker.record_denial("Bash"), EscalationAction::Block);
    }
}
