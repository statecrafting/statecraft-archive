// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Bartek Kus

//! Plugin skill loading with name prefixing (FR-010).
//!
//! Scans `.claude/plugins/*/commands/*.md` and registers alongside bundled
//! skills. Plugin skills are prefixed `plugin-name:skill-name` to avoid
//! collisions with bundled skills.

use crate::factory::{load_skills_from_dir, prefix_skill_names};
use crate::types::{CollectedHook, ParsedSkill, SkillLoadResult};
use std::fs;
use std::path::Path;

/// Result of loading skills from all plugin directories.
#[derive(Debug)]
pub struct PluginLoadResult {
    pub plugin_name: String,
    pub skills: Vec<ParsedSkill>,
    pub hooks: Vec<CollectedHook>,
    pub results: Vec<SkillLoadResult>,
}

/// Scan the plugins directory and load skills from each plugin.
///
/// Expected layout: `plugins_dir/<plugin-name>/commands/*.md`
pub fn load_plugin_skills(plugins_dir: &Path) -> Vec<PluginLoadResult> {
    let mut all_results = Vec::new();

    let entries = match fs::read_dir(plugins_dir) {
        Ok(entries) => entries,
        Err(_) => return all_results, // No plugins directory — that's fine.
    };

    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }

        let plugin_name = path
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("unknown")
            .to_string();

        let commands_dir = path.join("commands");
        if !commands_dir.is_dir() {
            continue;
        }

        let mut loaded = load_skills_from_dir(&commands_dir);
        prefix_skill_names(&mut loaded.skills, &plugin_name);

        // Also prefix hook skill_name references.
        for hook in &mut loaded.hooks {
            hook.skill_name = format!("{plugin_name}:{}", hook.skill_name);
        }

        all_results.push(PluginLoadResult {
            plugin_name,
            skills: loaded.skills,
            hooks: loaded.hooks,
            results: loaded.results,
        });
    }

    all_results
}

/// Merge bundled skills with plugin skills (Contract note: bundled wins on collision).
///
/// Returns (merged_skills, merged_hooks, collision_warnings).
pub fn merge_skills(
    bundled: Vec<ParsedSkill>,
    plugin_results: Vec<PluginLoadResult>,
) -> (Vec<ParsedSkill>, Vec<CollectedHook>, Vec<String>) {
    let mut all_skills = bundled;
    let mut all_hooks = Vec::new();
    let mut warnings = Vec::new();

    let bundled_names: Vec<String> = all_skills
        .iter()
        .map(|s| s.frontmatter.name.clone())
        .collect();

    for plugin_result in plugin_results {
        all_hooks.extend(plugin_result.hooks);

        for skill in plugin_result.skills {
            // Plugin skills are already prefixed (plugin-name:skill-name),
            // but check raw name collision too.
            if bundled_names.contains(&skill.frontmatter.name) {
                warnings.push(format!(
                    "plugin skill '{}' collides with bundled skill — bundled wins",
                    skill.frontmatter.name
                ));
                continue;
            }
            all_skills.push(skill);
        }
    }

    (all_skills, all_hooks, warnings)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::AllowedTools;
    use std::fs;
    use tempfile::TempDir;

    fn write_file(dir: &Path, name: &str, content: &str) {
        fs::write(dir.join(name), content).unwrap();
    }

    #[test]
    fn load_from_plugin_directory() {
        let dir = TempDir::new().unwrap();
        let plugin_dir = dir.path().join("my-plugin").join("commands");
        fs::create_dir_all(&plugin_dir).unwrap();
        write_file(
            &plugin_dir,
            "deploy.md",
            "---\nname: deploy\n---\nDeploy $ARGS",
        );

        let results = load_plugin_skills(dir.path());
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].plugin_name, "my-plugin");
        assert_eq!(results[0].skills.len(), 1);
        assert_eq!(results[0].skills[0].frontmatter.name, "my-plugin:deploy");
    }

    #[test]
    fn no_plugins_dir_returns_empty() {
        let dir = TempDir::new().unwrap();
        let results = load_plugin_skills(&dir.path().join("nonexistent"));
        assert!(results.is_empty());
    }

    #[test]
    fn skips_non_directories() {
        let dir = TempDir::new().unwrap();
        fs::write(dir.path().join("not-a-dir.txt"), "file").unwrap();
        let results = load_plugin_skills(dir.path());
        assert!(results.is_empty());
    }

    #[test]
    fn skips_plugins_without_commands_dir() {
        let dir = TempDir::new().unwrap();
        fs::create_dir_all(dir.path().join("empty-plugin")).unwrap();
        let results = load_plugin_skills(dir.path());
        assert!(results.is_empty());
    }

    #[test]
    fn merge_bundled_wins_on_collision() {
        let bundled = vec![ParsedSkill {
            frontmatter: crate::types::SkillFrontmatter {
                name: "deploy".into(),
                description: Some("bundled deploy".into()),
                skill_type: crate::types::SkillType::Prompt,
                allowed_tools: AllowedTools::all(),
                model: None,
                hooks: Default::default(),
                trigger: None,
            },
            body: "bundled".into(),
            source_path: "bundled/deploy.md".into(),
        }];

        let plugin = PluginLoadResult {
            plugin_name: "ext".into(),
            skills: vec![ParsedSkill {
                frontmatter: crate::types::SkillFrontmatter {
                    name: "deploy".into(), // collision!
                    description: Some("plugin deploy".into()),
                    skill_type: crate::types::SkillType::Prompt,
                    allowed_tools: AllowedTools::all(),
                    model: None,
                    hooks: Default::default(),
                    trigger: None,
                },
                body: "plugin".into(),
                source_path: "plugins/ext/commands/deploy.md".into(),
            }],
            hooks: vec![],
            results: vec![],
        };

        let (merged, _hooks, warnings) = merge_skills(bundled, vec![plugin]);
        assert_eq!(merged.len(), 1);
        assert_eq!(
            merged[0].frontmatter.description.as_deref(),
            Some("bundled deploy")
        );
        assert_eq!(warnings.len(), 1);
    }

    #[test]
    fn merge_no_collision_includes_both() {
        let bundled = vec![ParsedSkill {
            frontmatter: crate::types::SkillFrontmatter {
                name: "commit".into(),
                description: None,
                skill_type: crate::types::SkillType::Prompt,
                allowed_tools: AllowedTools::all(),
                model: None,
                hooks: Default::default(),
                trigger: None,
            },
            body: "commit".into(),
            source_path: "commands/commit.md".into(),
        }];

        let plugin = PluginLoadResult {
            plugin_name: "ext".into(),
            skills: vec![ParsedSkill {
                frontmatter: crate::types::SkillFrontmatter {
                    name: "ext:deploy".into(),
                    description: None,
                    skill_type: crate::types::SkillType::Agent,
                    allowed_tools: AllowedTools::all(),
                    model: None,
                    hooks: Default::default(),
                    trigger: None,
                },
                body: "deploy".into(),
                source_path: "plugins/ext/commands/deploy.md".into(),
            }],
            hooks: vec![],
            results: vec![],
        };

        let (merged, _hooks, warnings) = merge_skills(bundled, vec![plugin]);
        assert_eq!(merged.len(), 2);
        assert!(warnings.is_empty());
    }

    #[test]
    fn plugin_hooks_get_prefixed_skill_name() {
        let dir = TempDir::new().unwrap();
        let plugin_dir = dir.path().join("security").join("commands");
        fs::create_dir_all(&plugin_dir).unwrap();
        write_file(
            &plugin_dir,
            "scan.md",
            r#"---
name: scan
hooks:
  PreToolUse:
    - name: block-dangerous
      type: bash
      run: "echo block"
---
Scan code
"#,
        );

        let results = load_plugin_skills(dir.path());
        assert_eq!(results[0].hooks.len(), 1);
        assert_eq!(results[0].hooks[0].skill_name, "security:scan");
    }
}
