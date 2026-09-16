// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Bartek Kus

//! SkillFactory — directory scanner, validator, and registrar (FR-002).

use crate::parser::parse_skill_file;
use crate::types::{CollectedHook, ParsedSkill, SkillFactoryLoadResult, SkillLoadResult};
use std::fs;
use std::path::Path;

/// Scan a directory for `.md` skill files, parse each, and collect results.
///
/// Invalid frontmatter produces a warning/error per file but does not prevent
/// other skills from loading (FR-009).
pub fn load_skills_from_dir(dir: &Path) -> SkillFactoryLoadResult {
    let mut results = Vec::new();
    let mut skills = Vec::new();
    let mut hooks = Vec::new();

    let md_files = list_markdown_files(dir);

    for path in md_files {
        let content = match fs::read_to_string(&path) {
            Ok(c) => c,
            Err(e) => {
                results.push(SkillLoadResult::Error {
                    path: path.clone(),
                    message: format!("failed to read file: {e}"),
                });
                continue;
            }
        };

        let result = parse_skill_file(&content, &path);

        // Extract hooks from successfully parsed skills (FR-008).
        if let Some(skill) = result.skill() {
            collect_hooks(skill, &mut hooks);
            skills.push(skill.clone());
        }

        results.push(result);
    }

    SkillFactoryLoadResult {
        skills,
        hooks,
        results,
    }
}

/// Collect hook declarations from a parsed skill into the aggregated list.
fn collect_hooks(skill: &ParsedSkill, hooks: &mut Vec<CollectedHook>) {
    for (event, declarations) in &skill.frontmatter.hooks {
        for decl in declarations {
            hooks.push(CollectedHook {
                event: event.clone(),
                declaration: decl.clone(),
                skill_name: skill.frontmatter.name.clone(),
            });
        }
    }
}

/// List all `.md` files in a directory (non-recursive).
fn list_markdown_files(dir: &Path) -> Vec<std::path::PathBuf> {
    let pattern = dir.join("*.md");
    let pattern_str = pattern.to_string_lossy();
    let mut files: Vec<_> = glob::glob(&pattern_str)
        .unwrap_or_else(|_| panic!("invalid glob pattern: {pattern_str}"))
        .filter_map(|entry| entry.ok())
        .collect();
    files.sort();
    files
}

/// Apply a name prefix to all skills (used for plugin skill namespacing).
pub fn prefix_skill_names(skills: &mut [ParsedSkill], prefix: &str) {
    for skill in skills {
        skill.frontmatter.name = format!("{prefix}:{}", skill.frontmatter.name);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::TempDir;

    fn write_skill(dir: &Path, name: &str, content: &str) {
        fs::write(dir.join(name), content).unwrap();
    }

    #[test]
    fn load_empty_directory() {
        let dir = TempDir::new().unwrap();
        let result = load_skills_from_dir(dir.path());
        assert!(result.skills.is_empty());
        assert!(result.results.is_empty());
    }

    #[test]
    fn load_valid_skills() {
        let dir = TempDir::new().unwrap();
        write_skill(
            dir.path(),
            "commit.md",
            "---\nname: commit\ndescription: Commit changes\n---\nCommit $ARGS",
        );
        write_skill(
            dir.path(),
            "review.md",
            "---\nname: review\ntype: agent\n---\nReview $ARGS",
        );

        let result = load_skills_from_dir(dir.path());
        assert_eq!(result.skills.len(), 2);
        assert_eq!(result.results.len(), 2);
        assert!(!result.results.iter().any(|r| r.is_error()));
    }

    #[test]
    fn load_with_invalid_file_continues() {
        let dir = TempDir::new().unwrap();
        write_skill(dir.path(), "good.md", "---\nname: good\n---\nbody");
        write_skill(dir.path(), "bad.md", "---\n[invalid yaml\n---\nbody");
        write_skill(
            dir.path(),
            "also-good.md",
            "---\nname: also-good\n---\nbody",
        );

        let result = load_skills_from_dir(dir.path());
        // 2 valid + 0 from bad
        assert_eq!(result.skills.len(), 2);
        // 3 total results
        assert_eq!(result.results.len(), 3);
        assert_eq!(result.results.iter().filter(|r| r.is_error()).count(), 1);
    }

    #[test]
    fn load_backward_compat_no_frontmatter() {
        let dir = TempDir::new().unwrap();
        write_skill(dir.path(), "plain.md", "Just a prompt\nWith $ARGS");

        let result = load_skills_from_dir(dir.path());
        assert_eq!(result.skills.len(), 1);
        assert_eq!(result.skills[0].frontmatter.name, "plain");
        assert!(result.skills[0].frontmatter.allowed_tools.is_all());
    }

    #[test]
    fn load_collects_hooks() {
        let dir = TempDir::new().unwrap();
        write_skill(
            dir.path(),
            "hooked.md",
            r#"---
name: hooked
hooks:
  PreToolUse:
    - name: guard
      type: bash
      run: "echo guard"
  PostToolUse:
    - name: audit
      type: bash
      run: "echo audit"
---
body
"#,
        );

        let result = load_skills_from_dir(dir.path());
        assert_eq!(result.hooks.len(), 2);
        let events: Vec<&str> = result.hooks.iter().map(|h| h.event.as_str()).collect();
        assert!(events.contains(&"PreToolUse"), "missing PreToolUse");
        assert!(events.contains(&"PostToolUse"), "missing PostToolUse");
        assert!(result.hooks.iter().all(|h| h.skill_name == "hooked"));
    }

    #[test]
    fn prefix_skill_names_applies_prefix() {
        let dir = TempDir::new().unwrap();
        write_skill(dir.path(), "a.md", "---\nname: skill-a\n---\nbody");
        write_skill(dir.path(), "b.md", "---\nname: skill-b\n---\nbody");

        let mut result = load_skills_from_dir(dir.path());
        prefix_skill_names(&mut result.skills, "my-plugin");

        assert_eq!(result.skills[0].frontmatter.name, "my-plugin:skill-a");
        assert_eq!(result.skills[1].frontmatter.name, "my-plugin:skill-b");
    }

    #[test]
    fn ignores_non_md_files() {
        let dir = TempDir::new().unwrap();
        write_skill(dir.path(), "skill.md", "---\nname: skill\n---\nbody");
        write_skill(dir.path(), "notes.txt", "not a skill");
        write_skill(dir.path(), "data.json", "{}");

        let result = load_skills_from_dir(dir.path());
        assert_eq!(result.skills.len(), 1);
    }
}
