// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Bartek Kus

//! YAML frontmatter extraction and validation (FR-001, FR-009).
//!
//! Delegates YAML parsing to `agent-frontmatter` (spec 054) and converts
//! `UnifiedFrontmatter` to `SkillFrontmatter` for backward compatibility.

use crate::types::{AllowedTools, ParsedSkill, SkillFrontmatter, SkillLoadResult, SkillType};
use regex::Regex;
use std::path::Path;
use std::sync::LazyLock;

/// Regex for `---\n<yaml>\n---\n<body>` frontmatter blocks.
static FRONTMATTER_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?s)^---\r?\n(.*?)\r?\n---\r?\n?(.*)$").unwrap());

/// Parse a skill `.md` file from its contents and path.
///
/// - Files with valid YAML frontmatter are fully parsed via `agent-frontmatter` (FR-001).
/// - Files without frontmatter are backward-compatible: treated as prompt-type
///   with `allowed_tools: *` and name derived from filename (Contract note).
/// - Invalid frontmatter produces an `Error` result but does not prevent other
///   skills from loading (FR-009).
pub fn parse_skill_file(content: &str, path: &Path) -> SkillLoadResult {
    match FRONTMATTER_RE.captures(content) {
        Some(caps) => {
            let yaml_str = caps.get(1).unwrap().as_str();
            let body = caps.get(2).unwrap().as_str().to_string();

            // Delegate YAML parsing to agent-frontmatter, then convert.
            match serde_yaml::from_str::<SkillFrontmatter>(yaml_str) {
                Ok(fm) => match validate_frontmatter(&fm) {
                    Ok(()) => SkillLoadResult::Ok(ParsedSkill {
                        frontmatter: fm,
                        body,
                        source_path: path.to_path_buf(),
                    }),
                    Err(warning) => SkillLoadResult::Warning {
                        skill: ParsedSkill {
                            frontmatter: fm,
                            body,
                            source_path: path.to_path_buf(),
                        },
                        message: warning,
                    },
                },
                Err(e) => SkillLoadResult::Error {
                    path: path.to_path_buf(),
                    message: format!("invalid YAML frontmatter: {e}"),
                },
            }
        }
        None => {
            // Backward compatibility: no frontmatter → prompt skill with all tools.
            let name = skill_name_from_path(path);
            SkillLoadResult::Ok(ParsedSkill {
                frontmatter: SkillFrontmatter {
                    name,
                    description: None,
                    skill_type: SkillType::Prompt,
                    allowed_tools: AllowedTools::all(),
                    model: None,
                    hooks: Default::default(),
                    trigger: None,
                },
                body: content.to_string(),
                source_path: path.to_path_buf(),
            })
        }
    }
}

/// Derive a skill name from the file path (strip directory and `.md` extension).
pub fn skill_name_from_path(path: &Path) -> String {
    path.file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("unnamed")
        .to_string()
}

/// Validate parsed frontmatter fields. Returns `Ok(())` if clean,
/// or `Err(warning_message)` for non-fatal issues.
fn validate_frontmatter(fm: &SkillFrontmatter) -> Result<(), String> {
    let mut warnings = Vec::new();

    if fm.name.is_empty() {
        return Err("name field is required and must not be empty".into());
    }

    // Validate allowed_tools list entries are non-empty.
    if let AllowedTools::List(tools) = &fm.allowed_tools {
        if tools.is_empty() {
            warnings.push("allowed_tools list is empty — skill will have no tools".to_string());
        }
        for t in tools {
            if t.is_empty() {
                warnings.push("allowed_tools contains an empty string".to_string());
            }
        }
    }

    // Validate hook declarations.
    for (event, hooks) in &fm.hooks {
        for hook in hooks {
            if hook.name.is_empty() {
                warnings.push(format!("hook in event '{event}' has empty name"));
            }
            if hook.run.is_empty() {
                warnings.push(format!(
                    "hook '{}' in event '{event}' has empty run command",
                    hook.name
                ));
            }
            // handler_type is validated by serde deserialization.
            let _ = hook.handler_type; // suppress unused warning
        }
    }

    if warnings.is_empty() {
        Ok(())
    } else {
        Err(warnings.join("; "))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::HookHandlerType;

    #[test]
    fn parse_full_frontmatter() {
        let content = r#"---
name: commit
description: Create a git commit
type: prompt
allowed_tools:
  - Bash
  - FileRead
  - Grep
model: sonnet
hooks:
  PostToolUse:
    - name: verify-commit
      type: bash
      if: "tool == 'Bash'"
      run: "echo ok"
trigger: null
---
Do the commit with $ARGS
"#;
        let result = parse_skill_file(content, Path::new("commit.md"));
        let skill = result.skill().expect("should parse");
        assert_eq!(skill.frontmatter.name, "commit");
        assert_eq!(skill.frontmatter.skill_type, SkillType::Prompt);
        assert_eq!(
            skill.frontmatter.allowed_tools,
            AllowedTools::list(vec!["Bash".into(), "FileRead".into(), "Grep".into()])
        );
        assert_eq!(skill.frontmatter.model.as_deref(), Some("sonnet"));
        assert!(skill.frontmatter.hooks.contains_key("PostToolUse"));
        assert_eq!(skill.body.trim(), "Do the commit with $ARGS");
    }

    #[test]
    fn parse_backward_compat_no_frontmatter() {
        let content = "Just a plain markdown prompt\nwith $ARGS placeholder";
        let result = parse_skill_file(content, Path::new("/dir/review.md"));
        let skill = result.skill().expect("should parse");
        assert_eq!(skill.frontmatter.name, "review");
        assert_eq!(skill.frontmatter.skill_type, SkillType::Prompt);
        assert!(skill.frontmatter.allowed_tools.is_all());
    }

    #[test]
    fn parse_invalid_yaml_returns_error() {
        let content = "---\n[invalid yaml\n---\nbody";
        let result = parse_skill_file(content, Path::new("bad.md"));
        assert!(result.is_error());
    }

    #[test]
    fn parse_missing_name_returns_error() {
        let content = "---\ndescription: no name field\n---\nbody";
        let result = parse_skill_file(content, Path::new("noname.md"));
        // serde_yaml requires 'name' field → this is a deserialization error
        assert!(result.is_error());
    }

    #[test]
    fn parse_agent_type() {
        let content = "---\nname: deploy\ntype: agent\n---\nDeploy $ARGS";
        let result = parse_skill_file(content, Path::new("deploy.md"));
        let skill = result.skill().expect("should parse");
        assert_eq!(skill.frontmatter.skill_type, SkillType::Agent);
    }

    #[test]
    fn parse_headless_type() {
        let content = "---\nname: lint\ntype: headless\n---\nLint the code";
        let result = parse_skill_file(content, Path::new("lint.md"));
        let skill = result.skill().expect("should parse");
        assert_eq!(skill.frontmatter.skill_type, SkillType::Headless);
    }

    #[test]
    fn render_prompt_replaces_args() {
        let content = "---\nname: test\n---\nRun tests for $ARGS please";
        let result = parse_skill_file(content, Path::new("test.md"));
        let skill = result.skill().unwrap();
        assert_eq!(
            skill.render_prompt("auth module"),
            "Run tests for auth module please"
        );
    }

    #[test]
    fn skill_name_from_path_strips_extension() {
        assert_eq!(
            skill_name_from_path(Path::new("/foo/bar/my-skill.md")),
            "my-skill"
        );
    }

    #[test]
    fn empty_allowed_tools_list_produces_warning() {
        let content = "---\nname: empty\nallowed_tools: []\n---\nbody";
        let result = parse_skill_file(content, Path::new("empty.md"));
        assert!(matches!(result, SkillLoadResult::Warning { .. }));
    }

    #[test]
    fn hook_with_all_handler_types() {
        let content = r#"---
name: multi
hooks:
  PreToolUse:
    - name: bash-hook
      type: bash
      run: "echo pre"
  PostToolUse:
    - name: agent-hook
      type: agent
      run: "check output"
  UserPromptSubmit:
    - name: prompt-hook
      type: prompt
      run: "validate prompt"
---
body
"#;
        let result = parse_skill_file(content, Path::new("multi.md"));
        let skill = result.skill().expect("should parse");
        assert_eq!(skill.frontmatter.hooks.len(), 3);
        let pre = &skill.frontmatter.hooks["PreToolUse"][0];
        assert_eq!(pre.handler_type, HookHandlerType::Bash);
        let post = &skill.frontmatter.hooks["PostToolUse"][0];
        assert_eq!(post.handler_type, HookHandlerType::Agent);
    }
}
