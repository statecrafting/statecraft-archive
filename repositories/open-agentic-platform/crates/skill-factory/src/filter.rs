// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Bartek Kus

//! Tool allow-list enforcement (FR-003, NF-003).
//!
//! Computes the effective set of tools a skill may use:
//!   effective = (allowed_tools ∩ available_tools) − denied_tools

use crate::types::AllowedTools;

/// Compute the effective tool set for a skill execution.
///
/// - `allowed`: the skill's declared `allowed_tools` (from frontmatter)
/// - `available`: all tool names currently registered
/// - `denied`: tool names blocked by the permission runtime (spec 068)
///
/// Returns the list of tool names the skill may actually use.
pub fn compute_effective_tools(
    allowed: &AllowedTools,
    available: &[String],
    denied: &[String],
) -> Vec<String> {
    let candidates: Vec<&String> = match allowed {
        AllowedTools::All(_) => available.iter().collect(),
        AllowedTools::List(list) => list
            .iter()
            .filter(|t| available.iter().any(|a| a == *t))
            .collect(),
    };

    candidates
        .into_iter()
        .filter(|t| !denied.iter().any(|d| d == *t))
        .cloned()
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tools(names: &[&str]) -> Vec<String> {
        names.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn wildcard_returns_all_minus_denied() {
        let effective = compute_effective_tools(
            &AllowedTools::all(),
            &tools(&["Bash", "FileRead", "Grep", "Write"]),
            &tools(&["Write"]),
        );
        assert_eq!(effective, tools(&["Bash", "FileRead", "Grep"]));
    }

    #[test]
    fn specific_list_intersects_with_available() {
        let effective = compute_effective_tools(
            &AllowedTools::list(tools(&["Bash", "FileRead", "NotAvailable"])),
            &tools(&["Bash", "FileRead", "Grep"]),
            &[],
        );
        assert_eq!(effective, tools(&["Bash", "FileRead"]));
    }

    #[test]
    fn denied_tools_removed_from_specific_list() {
        let effective = compute_effective_tools(
            &AllowedTools::list(tools(&["Bash", "FileRead"])),
            &tools(&["Bash", "FileRead", "Grep"]),
            &tools(&["FileRead"]),
        );
        assert_eq!(effective, tools(&["Bash"]));
    }

    #[test]
    fn empty_available_returns_empty() {
        let effective = compute_effective_tools(&AllowedTools::list(tools(&["Bash"])), &[], &[]);
        assert!(effective.is_empty());
    }

    #[test]
    fn empty_allowed_list_returns_empty() {
        let effective = compute_effective_tools(
            &AllowedTools::list(vec![]),
            &tools(&["Bash", "FileRead"]),
            &[],
        );
        assert!(effective.is_empty());
    }
}
