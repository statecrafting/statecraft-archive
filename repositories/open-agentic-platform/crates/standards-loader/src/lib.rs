// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Bartek Kus
// Feature: 055-yaml-standards-schema

//! Loads, resolves, and formats YAML coding standards for prompt injection.
//!
//! This crate provides the Rust-native equivalent of the TypeScript
//! `@opc/yaml-standards-schema` integration module. It reads standards from
//! the three-tier directory structure (`standards/{official,community,local}/`),
//! resolves overrides, applies category/tag filters, and formats the result
//! as prompt-ready markdown.

pub mod formatter;
pub mod loader;
pub mod resolver;
pub mod types;

pub use formatter::{FormatOptions, FormattedStandards, format_standards_for_prompt};
pub use loader::{LoadError, TieredStandards, load_all_tiers, load_standards_from_dir};
pub use resolver::{StandardsFilter, resolve_standards};
pub use types::*;

use std::path::Path;

/// High-level API: load standards, resolve with filters, and format for prompt injection.
///
/// This is the Rust equivalent of the TypeScript `resolveAndFormat()`.
pub fn resolve_and_format(
    project_root: &Path,
    filter: Option<&StandardsFilter>,
    format_options: &FormatOptions,
) -> Result<FormattedStandards, LoadError> {
    let tiers = load_all_tiers(project_root)?;
    let resolved = resolve_standards(&tiers, filter);
    Ok(format_standards_for_prompt(&resolved, format_options))
}

/// High-level API: compose a system prompt by appending applicable standards.
///
/// Returns the base prompt unchanged if no standards match the filter.
/// This is the Rust equivalent of the TypeScript `composeSystemPrompt()`.
pub fn compose_system_prompt(
    base_prompt: &str,
    project_root: &Path,
    filter: Option<&StandardsFilter>,
    format_options: &FormatOptions,
) -> Result<(String, FormattedStandards), LoadError> {
    let result = resolve_and_format(project_root, filter, format_options)?;

    if result.standard_count == 0 {
        return Ok((base_prompt.to_string(), result));
    }

    let prompt = format!("{}\n\n{}", base_prompt, result.prompt_text);
    Ok((prompt, result))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    fn repo_root() -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .unwrap()
            .parent()
            .unwrap()
            .to_path_buf()
    }

    #[test]
    fn resolve_and_format_integration() {
        let result = resolve_and_format(&repo_root(), None, &FormatOptions::default()).unwrap();

        assert!(
            result.standard_count >= 10,
            "Expected at least 10 standards, got {}",
            result.standard_count
        );
        assert!(
            result
                .prompt_text
                .contains("## Applicable Coding Standards")
        );
        assert_eq!(result.standard_ids.len(), result.standard_count);
    }

    #[test]
    fn resolve_and_format_with_category_filter() {
        let filter = StandardsFilter {
            category: Some("security".into()),
            tags: vec![],
        };
        let result =
            resolve_and_format(&repo_root(), Some(&filter), &FormatOptions::default()).unwrap();

        assert!(result.standard_count >= 1);
        for id in &result.standard_ids {
            assert!(
                id.starts_with("security"),
                "Expected security standard, got {id}"
            );
        }
    }

    #[test]
    fn resolve_and_format_with_tag_filter() {
        let filter = StandardsFilter {
            category: None,
            tags: vec!["typescript".into()],
        };
        let result =
            resolve_and_format(&repo_root(), Some(&filter), &FormatOptions::default()).unwrap();

        assert!(
            result.standard_count >= 1,
            "Expected at least one standard matching 'typescript' tag"
        );
    }

    #[test]
    fn compose_system_prompt_appends_standards() {
        let (prompt, integration) = compose_system_prompt(
            "You are a code reviewer.",
            &repo_root(),
            None,
            &FormatOptions::default(),
        )
        .unwrap();

        assert!(prompt.starts_with("You are a code reviewer."));
        assert!(prompt.contains("## Applicable Coding Standards"));
        assert!(integration.standard_count >= 10);
    }

    #[test]
    fn compose_system_prompt_returns_base_when_no_match() {
        let filter = StandardsFilter {
            category: Some("nonexistent-category".into()),
            tags: vec![],
        };
        let (prompt, integration) = compose_system_prompt(
            "Base prompt.",
            &repo_root(),
            Some(&filter),
            &FormatOptions::default(),
        )
        .unwrap();

        assert_eq!(prompt, "Base prompt.");
        assert_eq!(integration.standard_count, 0);
    }
}
