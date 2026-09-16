// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Bartek Kus

//! Quality linter for agent and skill frontmatter (spec 054, FR-014).
//!
//! Validates:
//! - Required fields present (`name`)
//! - `description` minimum length (50 characters recommended)
//! - `name` follows kebab-case
//! - `allowed_tools` non-empty for agents declaring tool use

use crate::types::{AllowedTools, UnifiedFrontmatter};
use std::path::Path;

/// Severity level for lint diagnostics.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Severity {
    Error,
    Warning,
}

/// A single lint diagnostic.
#[derive(Debug, Clone)]
pub struct LintDiagnostic {
    pub severity: Severity,
    pub rule: &'static str,
    pub message: String,
    pub path: String,
}

impl std::fmt::Display for LintDiagnostic {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let sev = match self.severity {
            Severity::Error => "error",
            Severity::Warning => "warning",
        };
        write!(f, "{sev}[{}]: {} ({})", self.rule, self.message, self.path)
    }
}

/// Lint a parsed `UnifiedFrontmatter` and return all diagnostics.
pub fn lint_frontmatter(fm: &UnifiedFrontmatter, path: &Path) -> Vec<LintDiagnostic> {
    let path_str = path.display().to_string();
    let mut diags = Vec::new();

    // L-001: name must not be empty (required field).
    if fm.name.is_empty() {
        diags.push(LintDiagnostic {
            severity: Severity::Error,
            rule: "L-001",
            message: "name field is required and must not be empty".into(),
            path: path_str.clone(),
        });
    }

    // L-002: name should be kebab-case.
    if !fm.name.is_empty() && !is_kebab_case(&fm.name) {
        diags.push(LintDiagnostic {
            severity: Severity::Warning,
            rule: "L-002",
            message: format!(
                "name '{}' is not kebab-case (expected lowercase, hyphens only)",
                fm.name
            ),
            path: path_str.clone(),
        });
    }

    // L-003: description should be at least 50 characters.
    match &fm.description {
        None => {
            diags.push(LintDiagnostic {
                severity: Severity::Warning,
                rule: "L-003",
                message: "description is missing (recommended minimum 50 characters)".into(),
                path: path_str.clone(),
            });
        }
        Some(desc) if desc.len() < 50 => {
            diags.push(LintDiagnostic {
                severity: Severity::Warning,
                rule: "L-003",
                message: format!(
                    "description is {} characters (recommended minimum 50)",
                    desc.len()
                ),
                path: path_str.clone(),
            });
        }
        _ => {}
    }

    // L-004: allowed_tools list should not be empty for agents that declare tool use.
    if let AllowedTools::List(tools) = &fm.allowed_tools
        && tools.is_empty()
    {
        diags.push(LintDiagnostic {
            severity: Severity::Warning,
            rule: "L-004",
            message: "allowed_tools list is empty — agent will have no tools".into(),
            path: path_str.clone(),
        });
    }

    // L-005: hook declarations should have non-empty name and run.
    for (event, hooks) in &fm.hooks {
        for hook in hooks {
            if hook.name.is_empty() {
                diags.push(LintDiagnostic {
                    severity: Severity::Error,
                    rule: "L-005",
                    message: format!("hook in event '{event}' has empty name"),
                    path: path_str.clone(),
                });
            }
            if hook.run.is_empty() {
                diags.push(LintDiagnostic {
                    severity: Severity::Error,
                    rule: "L-005",
                    message: format!(
                        "hook '{}' in event '{event}' has empty run command",
                        hook.name
                    ),
                    path: path_str.clone(),
                });
            }
        }
    }

    diags
}

/// Check whether a string is valid kebab-case: lowercase alphanumeric + hyphens,
/// not starting or ending with a hyphen, no consecutive hyphens.
fn is_kebab_case(s: &str) -> bool {
    if s.is_empty() {
        return false;
    }
    if s.starts_with('-') || s.ends_with('-') {
        return false;
    }
    if s.contains("--") {
        return false;
    }
    s.chars()
        .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::parse_frontmatter_yaml;
    use std::path::PathBuf;

    fn lint(yaml: &str) -> Vec<LintDiagnostic> {
        let fm = parse_frontmatter_yaml(yaml).unwrap();
        lint_frontmatter(&fm, &PathBuf::from("test.md"))
    }

    #[test]
    fn sc004_missing_name_is_error() {
        // Can't produce empty name via parse (serde requires it), but we
        // test the lint function directly.
        let mut fm = parse_frontmatter_yaml("name: x\n").unwrap();
        fm.name = String::new();
        let diags = lint_frontmatter(&fm, &PathBuf::from("test.md"));
        assert!(diags.iter().any(|d| d.rule == "L-001"));
    }

    #[test]
    fn sc004_non_kebab_case_name_warns() {
        let diags = lint("name: MyAgent\n");
        assert!(diags.iter().any(|d| d.rule == "L-002"));
    }

    #[test]
    fn kebab_case_name_no_warning() {
        let diags = lint("name: my-agent\n");
        assert!(!diags.iter().any(|d| d.rule == "L-002"));
    }

    #[test]
    fn sc004_short_description_warns() {
        let diags = lint("name: test\ndescription: short\n");
        assert!(diags.iter().any(|d| d.rule == "L-003"));
    }

    #[test]
    fn long_description_no_warning() {
        let desc = "a".repeat(60);
        let diags = lint(&format!("name: test\ndescription: {desc}\n"));
        assert!(!diags.iter().any(|d| d.rule == "L-003"));
    }

    #[test]
    fn missing_description_warns() {
        let diags = lint("name: test\n");
        assert!(diags.iter().any(|d| d.rule == "L-003"));
    }

    #[test]
    fn empty_tools_list_warns() {
        let diags = lint("name: test\nallowed_tools: []\n");
        assert!(diags.iter().any(|d| d.rule == "L-004"));
    }

    #[test]
    fn wildcard_tools_no_warning() {
        let diags = lint(
            "name: test-agent\ndescription: A test agent that does enough things to pass the minimum length check here.\nallowed_tools: \"*\"\n",
        );
        assert!(!diags.iter().any(|d| d.rule == "L-004"));
    }

    #[test]
    fn is_kebab_case_valid() {
        assert!(is_kebab_case("my-agent"));
        assert!(is_kebab_case("agent"));
        assert!(is_kebab_case("a-1-b"));
        assert!(is_kebab_case("x"));
    }

    #[test]
    fn is_kebab_case_invalid() {
        assert!(!is_kebab_case("MyAgent"));
        assert!(!is_kebab_case("-leading"));
        assert!(!is_kebab_case("trailing-"));
        assert!(!is_kebab_case("double--hyphen"));
        assert!(!is_kebab_case("UPPER"));
        assert!(!is_kebab_case("has_underscore"));
        assert!(!is_kebab_case(""));
    }
}
