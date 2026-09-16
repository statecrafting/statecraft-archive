// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Bartek Kus
// Feature: 055-yaml-standards-schema

//! Formats resolved standards as prompt-ready markdown (Phase 6).
//!
//! The output is byte-identical to the TypeScript `formatStandardsForPrompt()`
//! in `packages/yaml-standards-schema/src/integration.ts`.

use crate::types::{AntiPattern, CodingStandard, StandardRule};

/// Options for formatting standards into prompt text.
#[derive(Debug, Clone)]
pub struct FormatOptions {
    /// Include anti-patterns in output (default: true).
    pub include_anti_patterns: bool,
    /// Include examples in output (default: false — saves tokens).
    pub include_examples: bool,
    /// Maximum number of standards to include (default: unlimited).
    pub max_standards: Option<usize>,
}

impl Default for FormatOptions {
    fn default() -> Self {
        Self {
            include_anti_patterns: true,
            include_examples: false,
            max_standards: None,
        }
    }
}

/// Result of formatting standards for prompt injection.
#[derive(Debug, Clone)]
pub struct FormattedStandards {
    /// Markdown text ready for injection into system prompts.
    pub prompt_text: String,
    /// Number of standards included.
    pub standard_count: usize,
    /// IDs of standards included (for traceability).
    pub standard_ids: Vec<String>,
}

fn format_rule(rule: &StandardRule) -> String {
    format!(
        "- {}: {}\n  Rationale: {}",
        rule.verb, rule.subject, rule.rationale
    )
}

fn format_anti_pattern(ap: &AntiPattern) -> String {
    format!(
        "- Avoid: `{}`\n  Use instead: `{}`",
        ap.pattern, ap.correction
    )
}

fn format_standard(standard: &CodingStandard, options: &FormatOptions) -> String {
    let mut lines: Vec<String> = Vec::new();

    lines.push(format!("### {} [{}]", standard.id, standard.priority));
    lines.push(format!("Category: {}", standard.category));
    if let Some(ref context) = standard.context {
        lines.push(format!("Context: {context}"));
    }

    lines.push(String::new());
    lines.push("**Rules:**".to_string());
    for rule in &standard.rules {
        lines.push(format_rule(rule));
    }

    if options.include_anti_patterns && !standard.anti_patterns.is_empty() {
        lines.push(String::new());
        lines.push("**Anti-patterns:**".to_string());
        for ap in &standard.anti_patterns {
            lines.push(format_anti_pattern(ap));
        }
    }

    if options.include_examples && !standard.examples.is_empty() {
        lines.push(String::new());
        lines.push("**Examples:**".to_string());
        for ex in &standard.examples {
            lines.push(format!("- Bad: `{}`", ex.bad.trim()));
            lines.push(format!("  Good: `{}`", ex.good.trim()));
            lines.push(format!("  Why: {}", ex.explanation));
        }
    }

    lines.join("\n")
}

/// Format a resolved set of standards into a prompt-ready text block.
///
/// The output is a Markdown section suitable for appending to an agent's
/// system prompt. Standards are assumed to already be sorted (by priority
/// then id). The text is designed to be concise to minimize context window
/// usage (R-003 mitigation).
///
/// Produces output identical to the TypeScript `formatStandardsForPrompt()`.
pub fn format_standards_for_prompt(
    standards: &[CodingStandard],
    options: &FormatOptions,
) -> FormattedStandards {
    let standards = if let Some(max) = options.max_standards {
        &standards[..max.min(standards.len())]
    } else {
        standards
    };

    if standards.is_empty() {
        return FormattedStandards {
            prompt_text: String::new(),
            standard_count: 0,
            standard_ids: vec![],
        };
    }

    let sections: Vec<String> = standards
        .iter()
        .map(|s| format_standard(s, options))
        .collect();

    let count = standards.len();
    let applies = if count == 1 {
        "standard applies"
    } else {
        "standards apply"
    };

    let mut prompt_text = format!(
        "## Applicable Coding Standards\n\nThe following {count} coding {applies} to this task. Follow these rules when generating or reviewing code.\n\n"
    );

    for (i, section) in sections.iter().enumerate() {
        if i > 0 {
            prompt_text.push_str("\n\n---\n\n");
        }
        prompt_text.push_str(section);
    }

    FormattedStandards {
        prompt_text,
        standard_count: count,
        standard_ids: standards.iter().map(|s| s.id.clone()).collect(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::*;

    fn make_standard(id: &str, priority: StandardPriority) -> CodingStandard {
        CodingStandard {
            id: id.into(),
            category: "testing".into(),
            priority,
            status: StandardStatus::Active,
            context: Some("Applies to tests".into()),
            tags: vec!["typescript".into()],
            rules: vec![StandardRule {
                verb: RuleVerb::ALWAYS,
                subject: "write unit tests".into(),
                rationale: "tests prevent regressions".into(),
            }],
            anti_patterns: vec![AntiPattern {
                pattern: "test.skip()".into(),
                correction: "remove the skip".into(),
            }],
            examples: vec![],
        }
    }

    #[test]
    fn format_empty_returns_empty() {
        let result = format_standards_for_prompt(&[], &FormatOptions::default());
        assert_eq!(result.prompt_text, "");
        assert_eq!(result.standard_count, 0);
        assert!(result.standard_ids.is_empty());
    }

    #[test]
    fn format_single_standard() {
        let standards = vec![make_standard("test-001", StandardPriority::High)];
        let result = format_standards_for_prompt(&standards, &FormatOptions::default());

        assert!(
            result
                .prompt_text
                .starts_with("## Applicable Coding Standards")
        );
        assert!(result.prompt_text.contains("1 coding standard applies"));
        assert!(result.prompt_text.contains("### test-001 [high]"));
        assert!(result.prompt_text.contains("Category: testing"));
        assert!(result.prompt_text.contains("Context: Applies to tests"));
        assert!(result.prompt_text.contains("**Rules:**"));
        assert!(result.prompt_text.contains("- ALWAYS: write unit tests"));
        assert!(result.prompt_text.contains("**Anti-patterns:**"));
        assert!(result.prompt_text.contains("- Avoid: `test.skip()`"));
        assert_eq!(result.standard_count, 1);
        assert_eq!(result.standard_ids, vec!["test-001"]);
    }

    #[test]
    fn format_multiple_standards_with_separator() {
        let standards = vec![
            make_standard("a-001", StandardPriority::Critical),
            make_standard("b-001", StandardPriority::Low),
        ];
        let result = format_standards_for_prompt(&standards, &FormatOptions::default());

        assert!(result.prompt_text.contains("2 coding standards apply"));
        assert!(result.prompt_text.contains("### a-001 [critical]"));
        assert!(result.prompt_text.contains("\n\n---\n\n"));
        assert!(result.prompt_text.contains("### b-001 [low]"));
        assert_eq!(result.standard_count, 2);
    }

    #[test]
    fn format_without_anti_patterns() {
        let standards = vec![make_standard("test-001", StandardPriority::High)];
        let opts = FormatOptions {
            include_anti_patterns: false,
            ..Default::default()
        };
        let result = format_standards_for_prompt(&standards, &opts);
        assert!(!result.prompt_text.contains("Anti-patterns"));
    }

    #[test]
    fn format_with_max_standards() {
        let standards = vec![
            make_standard("a", StandardPriority::High),
            make_standard("b", StandardPriority::Low),
            make_standard("c", StandardPriority::Medium),
        ];
        let opts = FormatOptions {
            max_standards: Some(2),
            ..Default::default()
        };
        let result = format_standards_for_prompt(&standards, &opts);
        assert_eq!(result.standard_count, 2);
        assert_eq!(result.standard_ids, vec!["a", "b"]);
    }
}
