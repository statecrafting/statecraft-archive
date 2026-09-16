// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Bartek Kus

//! Frontmatter extraction and parsing for agent/skill markdown files (spec 054).

use crate::types::UnifiedFrontmatter;
use std::path::Path;

/// Errors that can occur during frontmatter parsing.
#[derive(Debug)]
pub enum ParseError {
    /// The file has no YAML frontmatter delimiters (`---`).
    MissingFrontmatter { path: String },
    /// The YAML frontmatter is malformed.
    InvalidYaml {
        path: String,
        source: serde_yaml::Error,
    },
}

impl std::fmt::Display for ParseError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ParseError::MissingFrontmatter { path } => {
                write!(f, "missing frontmatter in {path}")
            }
            ParseError::InvalidYaml { path, source } => {
                write!(f, "invalid YAML frontmatter in {path}: {source}")
            }
        }
    }
}

impl std::error::Error for ParseError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            ParseError::InvalidYaml { source, .. } => Some(source),
            _ => None,
        }
    }
}

/// Parse a markdown file's YAML frontmatter into a `UnifiedFrontmatter`.
///
/// Returns the parsed frontmatter (with derivation rules applied) and the
/// remaining markdown body. The `path` argument is used for error messages only.
///
/// # Frontmatter format
///
/// ```text
/// ---
/// name: my-agent
/// description: ...
/// ---
///
/// Markdown body here.
/// ```
pub fn parse_frontmatter(
    content: &str,
    path: &Path,
) -> Result<(UnifiedFrontmatter, String), ParseError> {
    let path_str = path.display().to_string();
    let (yaml_str, body) = split_frontmatter(content, &path_str)?;

    let mut fm: UnifiedFrontmatter =
        serde_yaml::from_str(&yaml_str).map_err(|e| ParseError::InvalidYaml {
            path: path_str,
            source: e,
        })?;

    fm.apply_derivations();

    Ok((fm, body))
}

/// Parse frontmatter from a YAML string only (no markdown splitting).
///
/// Useful when the frontmatter has already been extracted.
pub fn parse_frontmatter_yaml(yaml: &str) -> Result<UnifiedFrontmatter, serde_yaml::Error> {
    let mut fm: UnifiedFrontmatter = serde_yaml::from_str(yaml)?;
    fm.apply_derivations();
    Ok(fm)
}

/// Split a markdown file into (frontmatter_yaml, body).
fn split_frontmatter(content: &str, path: &str) -> Result<(String, String), ParseError> {
    // Strip optional BOM.
    let content = content.strip_prefix('\u{feff}').unwrap_or(content);
    let trimmed = content.trim_start();

    if !trimmed.starts_with("---") {
        return Err(ParseError::MissingFrontmatter {
            path: path.to_string(),
        });
    }

    let after_first = &trimmed[3..];
    // Skip the newline after the opening `---`.
    let after_newline = after_first
        .strip_prefix('\n')
        .or_else(|| after_first.strip_prefix("\r\n"))
        .unwrap_or(after_first);

    if let Some(end_idx) = after_newline.find("\n---") {
        let yaml = after_newline[..end_idx].to_string();
        let rest = &after_newline[end_idx + 4..];
        // Skip optional newline after closing `---`.
        let body = rest
            .strip_prefix('\n')
            .or_else(|| rest.strip_prefix("\r\n"))
            .unwrap_or(rest)
            .to_string();
        Ok((yaml, body))
    } else {
        Err(ParseError::MissingFrontmatter {
            path: path.to_string(),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::*;
    use std::path::PathBuf;

    fn test_path(name: &str) -> PathBuf {
        PathBuf::from(format!("/test/{name}"))
    }

    // -- Claude Code agent format --

    #[test]
    fn parse_claude_code_agent() {
        let content = r#"---
name: reviewer
description: Use this agent to review code changes for bugs, security issues, and performance.
tools:
  - Read
  - Grep
  - Glob
  - Bash
  - LS
model: sonnet
---

# Reviewer Agent

Review code changes.
"#;
        let (fm, body) = parse_frontmatter(content, &test_path("reviewer.md")).unwrap();
        assert_eq!(fm.name, "reviewer");
        assert_eq!(
            fm.description.as_deref(),
            Some(
                "Use this agent to review code changes for bugs, security issues, and performance."
            )
        );
        assert_eq!(fm.agent_type, AgentType::Prompt);
        assert_eq!(fm.model.as_deref(), Some("sonnet"));
        assert_eq!(
            fm.allowed_tools,
            AllowedTools::list(vec![
                "Read".into(),
                "Grep".into(),
                "Glob".into(),
                "Bash".into(),
                "LS".into()
            ])
        );
        assert!(body.contains("# Reviewer Agent"));
    }

    // -- Factory agent format (aliases) --

    #[test]
    fn parse_factory_agent_with_aliases() {
        let content = r#"---
id: requirements-agent
role: requirements-analyst
tier: 1
model_hint: opus
stage: 1
context_budget: "~50K tokens"
---

You are a requirements analyst.
"#;
        let (fm, body) = parse_frontmatter(content, &test_path("requirements.md")).unwrap();
        assert_eq!(fm.name, "requirements-agent");
        assert_eq!(fm.display_name.as_deref(), Some("requirements-analyst"));
        assert_eq!(fm.safety_tier, Some(SafetyTier::Tier1));
        assert_eq!(fm.model.as_deref(), Some("opus"));
        assert_eq!(fm.stage, Some(1));
        assert_eq!(fm.context_budget.as_deref(), Some("~50K tokens"));
        assert!(body.contains("requirements analyst"));
    }

    // -- Skill format --

    #[test]
    fn parse_skill_format() {
        let content = r#"---
name: research
description: Deep research with parallel sub-agents and query classification
type: agent
allowed_tools:
  - Read
  - Write
  - Bash
  - WebSearch
trigger: "when the user asks for deep research"
---

Research $ARGS
"#;
        let (fm, body) = parse_frontmatter(content, &test_path("research.md")).unwrap();
        assert_eq!(fm.name, "research");
        assert_eq!(fm.agent_type, AgentType::Agent);
        assert_eq!(
            fm.allowed_tools,
            AllowedTools::list(vec![
                "Read".into(),
                "Write".into(),
                "Bash".into(),
                "WebSearch".into()
            ])
        );
        assert_eq!(
            fm.trigger.as_deref(),
            Some("when the user asks for deep research")
        );
        assert!(body.contains("$ARGS"));
    }

    // -- SafetyTier deserialization --

    #[test]
    fn safety_tier_from_string() {
        let yaml = "name: test\nsafety_tier: tier2\n";
        let fm = parse_frontmatter_yaml(yaml).unwrap();
        assert_eq!(fm.safety_tier, Some(SafetyTier::Tier2));
    }

    #[test]
    fn safety_tier_from_integer() {
        let yaml = "name: test\ntier: 3\n";
        let fm = parse_frontmatter_yaml(yaml).unwrap();
        assert_eq!(fm.safety_tier, Some(SafetyTier::Tier3));
    }

    #[test]
    fn safety_tier_from_integer_1() {
        let yaml = "name: test\ntier: 1\n";
        let fm = parse_frontmatter_yaml(yaml).unwrap();
        assert_eq!(fm.safety_tier, Some(SafetyTier::Tier1));
    }

    // -- Derivation rules (FR-015) --

    #[test]
    fn process_type_derives_tier1_readonly_opus() {
        let yaml = "name: process-agent\ntype: process\n";
        let fm = parse_frontmatter_yaml(yaml).unwrap();
        assert_eq!(fm.safety_tier, Some(SafetyTier::Tier1));
        assert_eq!(fm.mutation, Some(MutationCapability::ReadOnly));
        assert_eq!(fm.model.as_deref(), Some("opus"));
    }

    #[test]
    fn scaffold_type_derives_tier2_readwrite_sonnet() {
        let yaml = "name: scaffold-agent\ntype: scaffold\n";
        let fm = parse_frontmatter_yaml(yaml).unwrap();
        assert_eq!(fm.safety_tier, Some(SafetyTier::Tier2));
        assert_eq!(fm.mutation, Some(MutationCapability::ReadWrite));
        assert_eq!(fm.model.as_deref(), Some("sonnet"));
    }

    #[test]
    fn mutation_derived_from_safety_tier() {
        let yaml = "name: test\nsafety_tier: tier3\n";
        let fm = parse_frontmatter_yaml(yaml).unwrap();
        assert_eq!(fm.mutation, Some(MutationCapability::Full));
    }

    #[test]
    fn explicit_mutation_not_overridden() {
        let yaml = "name: test\nsafety_tier: tier3\nmutation: read-only\n";
        let fm = parse_frontmatter_yaml(yaml).unwrap();
        assert_eq!(fm.mutation, Some(MutationCapability::ReadOnly));
    }

    #[test]
    fn process_type_explicit_model_not_overridden() {
        let yaml = "name: test\ntype: process\nmodel: haiku\n";
        let fm = parse_frontmatter_yaml(yaml).unwrap();
        assert_eq!(fm.model.as_deref(), Some("haiku"));
    }

    // -- Forward compatibility (FR-013) --

    #[test]
    fn unknown_fields_preserved_in_extra() {
        let yaml = "name: test\ncustom_field: hello\nanother: 42\n";
        let fm = parse_frontmatter_yaml(yaml).unwrap();
        assert_eq!(
            fm.extra.get("custom_field").and_then(|v| v.as_str()),
            Some("hello")
        );
        assert_eq!(fm.extra.get("another").and_then(|v| v.as_i64()), Some(42));
    }

    // -- AllowedTools --

    #[test]
    fn allowed_tools_wildcard() {
        let yaml = "name: test\nallowed_tools: \"*\"\n";
        let fm = parse_frontmatter_yaml(yaml).unwrap();
        assert!(fm.allowed_tools.is_all());
    }

    #[test]
    fn allowed_tools_default_is_wildcard() {
        let yaml = "name: test\n";
        let fm = parse_frontmatter_yaml(yaml).unwrap();
        assert!(fm.allowed_tools.is_all());
    }

    #[test]
    fn tools_alias_for_allowed_tools() {
        let yaml = "name: test\ntools:\n  - Read\n  - Bash\n";
        let fm = parse_frontmatter_yaml(yaml).unwrap();
        assert_eq!(
            fm.allowed_tools,
            AllowedTools::list(vec!["Read".into(), "Bash".into()])
        );
    }

    // -- Hooks --

    #[test]
    fn hooks_parsed_correctly() {
        let yaml = r#"name: test
hooks:
  PostToolUse:
    - name: verify
      type: bash
      if: "tool == 'Bash'"
      run: "echo ok"
"#;
        let fm = parse_frontmatter_yaml(yaml).unwrap();
        assert_eq!(fm.hooks.len(), 1);
        let hooks = &fm.hooks["PostToolUse"];
        assert_eq!(hooks.len(), 1);
        assert_eq!(hooks[0].name, "verify");
        assert_eq!(hooks[0].handler_type, HookHandlerType::Bash);
        assert_eq!(hooks[0].condition.as_deref(), Some("tool == 'Bash'"));
        assert_eq!(hooks[0].run, "echo ok");
    }

    // -- Governance --

    #[test]
    fn governance_defaults_to_none() {
        let yaml = "name: test\n";
        let fm = parse_frontmatter_yaml(yaml).unwrap();
        assert_eq!(fm.governance, None);
    }

    #[test]
    fn governance_enforced() {
        let yaml = "name: test\ngovernance: enforced\n";
        let fm = parse_frontmatter_yaml(yaml).unwrap();
        assert_eq!(fm.governance, Some(GovernanceRequirement::Enforced));
    }

    // -- Error handling --

    #[test]
    fn missing_frontmatter_error() {
        let content = "Just plain markdown, no frontmatter";
        let result = parse_frontmatter(content, &test_path("plain.md"));
        assert!(matches!(result, Err(ParseError::MissingFrontmatter { .. })));
    }

    #[test]
    fn invalid_yaml_error_includes_path() {
        let content = "---\n[invalid yaml\n---\nbody";
        let result = parse_frontmatter(content, &test_path("bad.md"));
        match result {
            Err(ParseError::InvalidYaml { path, .. }) => {
                assert!(path.contains("bad.md"));
            }
            other => panic!("expected InvalidYaml, got {other:?}"),
        }
    }

    #[test]
    fn missing_name_is_yaml_error() {
        let content = "---\ndescription: no name field\n---\nbody";
        let result = parse_frontmatter(content, &test_path("noname.md"));
        assert!(matches!(result, Err(ParseError::InvalidYaml { .. })));
    }

    // -- Round-trip serialization (FR-013) --

    #[test]
    fn round_trip_preserves_fields() {
        let yaml = r#"name: round-trip
description: Test round-trip
type: agent
model: sonnet
safety_tier: tier2
mutation: read-write
governance: advisory
custom_field: preserved
"#;
        let fm = parse_frontmatter_yaml(yaml).unwrap();
        let json = serde_json::to_value(&fm).unwrap();
        assert_eq!(json["name"], "round-trip");
        assert_eq!(json["type"], "agent");
        assert_eq!(json["safety_tier"], "tier2");
        assert_eq!(json["mutation"], "read-write");
        assert_eq!(json["governance"], "advisory");
        assert_eq!(json["custom_field"], "preserved");
    }

    // -- Comprehensive: all three formats parse through single parser --

    #[test]
    fn sc001_all_formats_parse() {
        // Claude Code agent
        let cc = "---\nname: architect\ntools:\n  - Read\nmodel: sonnet\n---\nbody";
        assert!(parse_frontmatter(cc, &test_path("architect.md")).is_ok());

        // Factory agent
        let factory = "---\nid: req-agent\nrole: analyst\ntier: 1\nmodel_hint: opus\n---\nbody";
        assert!(parse_frontmatter(factory, &test_path("req.md")).is_ok());

        // Skill
        let skill = "---\nname: commit\ntype: prompt\nallowed_tools:\n  - Bash\n---\nbody";
        assert!(parse_frontmatter(skill, &test_path("commit.md")).is_ok());
    }
}
