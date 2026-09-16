// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Bartek Kus
// Feature: 043-agent-organizer — dispatch protocol (specs/043-agent-organizer/spec.md § Dispatch protocol)

use regex::Regex;
use std::sync::LazyLock;

/// Outcome of mandatory trigger evaluation (before score-based branch).
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum MandatoryOutcome {
    /// FR-006 / NEVER delegate list — direct handling regardless of score.
    Direct(&'static str),
    /// FR-005 / ALWAYS delegate list — delegation regardless of score.
    Delegated(&'static str),
    /// No mandatory rule; use complexity score (FR-003 / FR-004).
    None,
}

/// Spec § Dispatch protocol — ordered substring checks (case-insensitive).
/// More specific phrases (e.g. `build project`) appear before generic delegate `build`.
static DIRECT_SUBSTRINGS: &[(&str, &str)] = &[
    // NEVER — single-command execution (diagram "build" is delegate; narrow first)
    ("build project", "never_single_command"),
    ("run the tests", "never_single_command"),
    ("run tests", "never_single_command"),
    ("run test", "never_single_command"),
    ("cargo test", "never_single_command"),
    ("npm test", "never_single_command"),
    ("pnpm test", "never_single_command"),
    ("yarn test", "never_single_command"),
    ("pytest", "never_single_command"),
    ("mvn test", "never_single_command"),
    ("dotnet test", "never_single_command"),
    // NEVER — simple lookups
    ("show me", "never_simple_lookup"),
    ("show the", "never_simple_lookup"),
    ("what's the status", "never_simple_lookup"),
    ("status of", "never_simple_lookup"),
    ("where is", "never_simple_lookup"),
    ("where's", "never_simple_lookup"),
    ("find file", "never_simple_lookup"),
    ("open file", "never_simple_lookup"),
    ("locate ", "never_simple_lookup"),
    // NEVER — configuration tweaks
    ("enable feature", "never_config_tweak"),
    ("disable feature", "never_config_tweak"),
    ("toggle ", "never_config_tweak"),
    ("turn on ", "never_config_tweak"),
    ("turn off ", "never_config_tweak"),
    // NEVER — conversational + diagram direct
    ("what is", "diagram_what_is"),
    ("what's", "diagram_whats"),
    ("who is", "never_conversational"),
    ("how does", "never_conversational"),
    ("why is", "never_conversational"),
    ("why does", "never_conversational"),
    ("how do i", "diagram_how_do_i"),
    ("single file edit", "diagram_single_file_edit"),
    ("run command", "diagram_run_command"),
    ("config change", "diagram_config_change"),
];

static EXPLAIN_DIRECT: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?i)\bexplain\b").expect("explain word boundary"));

/// ALWAYS delegate — multi-domain / cross-cutting (prose list).
static DELEGATE_SUBSTRINGS: &[(&str, &str)] = &[
    ("multi-file", "always_multi_file"),
    ("multiple files", "always_multi_file"),
    ("across files", "always_multi_file"),
    ("cross-module", "always_cross_module"),
    ("cross module", "always_cross_module"),
    ("across modules", "always_cross_module"),
    ("architecture design", "always_architecture"),
    ("architecture review", "always_architecture"),
    ("full test suite", "always_full_test_suite"),
    ("multiple components", "always_multi_component"),
    ("multi-component", "always_multi_component"),
    ("security audit", "always_security_audit"),
    ("performance analysis", "always_performance_analysis"),
    // Diagram mandatory delegate
    ("implement feature", "diagram_implement_feature"),
    ("debug across", "diagram_debug_across"),
    ("create test suite", "diagram_create_test_suite"),
    ("generate docs", "diagram_generate_docs"),
    ("review pr", "diagram_review_pr"),
    ("analyze architecture", "diagram_analyze_architecture"),
];

/// Single-token or short delegate triggers (substring — catches "refactoring", etc.).
static DELEGATE_SUBSTRINGS_SHORT: &[(&str, &str)] = &[
    ("refactor", "diagram_refactor"),
    ("migrate", "diagram_migrate"),
];

/// `\bbuild\b` — avoids matching "building" as a delegate-only hit when inappropriate.
static DELEGATE_BUILD: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?i)\bbuild\b").expect("delegate build"));

/// Evaluate mandatory triggers per spec: direct branch first, then delegate, then score (contract notes).
pub fn evaluate_mandatory_triggers(prompt: &str) -> MandatoryOutcome {
    let lower = prompt.to_lowercase();

    for (needle, label) in DIRECT_SUBSTRINGS {
        if lower.contains(needle) {
            return MandatoryOutcome::Direct(label);
        }
    }
    if EXPLAIN_DIRECT.is_match(prompt) {
        return MandatoryOutcome::Direct("diagram_explain");
    }

    if lower.contains("frontend") && lower.contains("backend") {
        return MandatoryOutcome::Delegated("always_frontend_backend");
    }

    for (needle, label) in DELEGATE_SUBSTRINGS {
        if lower.contains(needle) {
            return MandatoryOutcome::Delegated(label);
        }
    }
    for (needle, label) in DELEGATE_SUBSTRINGS_SHORT {
        if lower.contains(needle) {
            return MandatoryOutcome::Delegated(label);
        }
    }
    if DELEGATE_BUILD.is_match(prompt) {
        return MandatoryOutcome::Delegated("diagram_build");
    }

    MandatoryOutcome::None
}
