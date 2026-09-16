// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Bartek Kus
// Spec: specs/044-multi-agent-orchestration/spec.md

use serde::{Deserialize, Serialize};

/// Effort level controls per-step token budget and agent behavior (044 FR-005).
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum EffortLevel {
    Quick,
    #[default]
    Investigate,
    Deep,
}

impl EffortLevel {
    /// Token budget advisory per step (044 FR-005). `Deep` has no cap (`None`).
    pub fn token_budget_hint(&self) -> Option<u32> {
        match self {
            EffortLevel::Quick => Some(2_000),
            EffortLevel::Investigate => Some(10_000),
            EffortLevel::Deep => None,
        }
    }
}

/// Classify effort from natural-language task text. Default: `Investigate` (044).
pub fn classify_from_task(text: &str) -> EffortLevel {
    let t = text.to_lowercase();

    if t.contains("deep dive") || t.contains("exhaustive") || t.contains("comprehensive") {
        return EffortLevel::Deep;
    }

    if t.contains("quick")
        || t.contains("briefly")
        || t.contains("glance")
        || t.contains(" at a glance")
    {
        return EffortLevel::Quick;
    }

    if t.contains("investigate")
        || t.contains("look into")
        || t.contains("analyze")
        || t.contains("analyse")
    {
        return EffortLevel::Investigate;
    }

    EffortLevel::Investigate
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_investigate_when_no_phrase() {
        assert_eq!(
            classify_from_task("fix the login bug"),
            EffortLevel::Investigate
        );
    }

    #[test]
    fn quick_phrases() {
        assert_eq!(classify_from_task("quick summary"), EffortLevel::Quick);
        assert_eq!(classify_from_task("Briefly list items"), EffortLevel::Quick);
    }

    #[test]
    fn deep_phrases() {
        assert_eq!(
            classify_from_task("deep dive into the compiler"),
            EffortLevel::Deep
        );
    }
}
