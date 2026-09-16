// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Bartek Kus
// Feature: SKILL_COMMAND_FACTORY
// Spec: specs/071-skill-command-factory/spec.md

//! SkillProvider — bridges skill-factory into axiomregent as a ToolProvider.
//!
//! Loads `.claude/commands/*.md` skill files via the skill-factory crate
//! and exposes them as MCP tools with the `skill.` prefix.

use async_trait::async_trait;
use serde_json::{Map, Value, json};
use std::path::Path;

use crate::router::provider::{ToolPermissions, ToolProvider};
use skill_factory::{SkillToolDef, load_skills_from_dir};
use tool_registry::{ToolContext, ToolDef};

/// MCP tool provider that exposes loaded skill commands.
///
/// Each skill is registered as `skill.<name>` in the MCP tool namespace.
/// Skills default to Tier2 (gated) since they execute prompts or spawn agents.
pub struct SkillProvider {
    skills: Vec<SkillToolDef>,
}

const SKILL_PREFIX: &str = "skill.";

impl SkillProvider {
    /// Load all skill files from the given commands directory.
    ///
    /// Logs warnings for any files that fail to parse but does not fail overall
    /// (consistent with skill-factory's per-file error handling — FR-009).
    pub fn load(commands_dir: &Path) -> Self {
        if !commands_dir.is_dir() {
            log::warn!(
                "skill commands directory does not exist: {}",
                commands_dir.display()
            );
            return Self { skills: vec![] };
        }

        let result = load_skills_from_dir(commands_dir);

        for load_result in &result.results {
            if load_result.is_error() {
                log::warn!("skill load warning: {:?}", load_result);
            }
        }

        let skills: Vec<SkillToolDef> = result
            .skills
            .into_iter()
            .map(|skill| SkillToolDef {
                skill,
                denied_tools: vec![],
                dispatch: None,
                headless_spawn: None,
            })
            .collect();

        log::info!(
            "loaded {} skill(s) from {}",
            skills.len(),
            commands_dir.display()
        );

        Self { skills }
    }

    /// Find a skill by its unprefixed name.
    fn find_skill(&self, unprefixed_name: &str) -> Option<&SkillToolDef> {
        self.skills.iter().find(|s| s.name() == unprefixed_name)
    }

    /// Return the prefixed tool name for a skill.
    fn prefixed_name(skill_name: &str) -> String {
        format!("{SKILL_PREFIX}{skill_name}")
    }
}

#[async_trait]
impl ToolProvider for SkillProvider {
    fn tool_schemas(&self) -> Vec<Value> {
        self.skills
            .iter()
            .map(|skill| {
                json!({
                    "name": Self::prefixed_name(skill.name()),
                    "description": skill.description(),
                    "inputSchema": skill.input_schema()
                })
            })
            .collect()
    }

    async fn handle(&self, name: &str, args: &Map<String, Value>) -> Option<anyhow::Result<Value>> {
        let unprefixed = name.strip_prefix(SKILL_PREFIX)?;
        let skill = self.find_skill(unprefixed)?;

        // Build the input Value from the args map.
        let input = Value::Object(args.clone());
        let mut ctx = ToolContext::empty();

        match skill.execute(input, &mut ctx) {
            Ok(result) => {
                if result.is_error {
                    Some(Err(anyhow::anyhow!(
                        "skill {} error: {}",
                        name,
                        result.content
                    )))
                } else {
                    Some(Ok(result.content))
                }
            }
            Err(e) => Some(Err(e)),
        }
    }

    fn tier(&self, name: &str) -> Option<agent::safety::ToolTier> {
        let unprefixed = name.strip_prefix(SKILL_PREFIX)?;
        self.find_skill(unprefixed)?;
        // All skills are Tier2 (gated) — they execute prompts or spawn agents.
        Some(agent::safety::ToolTier::Tier2)
    }

    fn permissions(&self, name: &str) -> Option<ToolPermissions> {
        let unprefixed = name.strip_prefix(SKILL_PREFIX)?;
        let skill = self.find_skill(unprefixed)?;

        // All skills require file_read (they read skill prompts and context).
        // Headless skills also require network (they spawn background tasks).
        let requires_network = matches!(
            skill.skill.frontmatter.skill_type,
            skill_factory::SkillType::Headless
        );

        Some(ToolPermissions {
            requires_file_read: true,
            requires_file_write: false,
            requires_network,
        })
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
    fn load_from_nonexistent_dir_returns_empty() {
        let provider = SkillProvider::load(Path::new("/nonexistent/dir"));
        assert!(provider.tool_schemas().is_empty());
    }

    #[test]
    fn load_skills_produces_prefixed_schemas() {
        let dir = TempDir::new().unwrap();
        write_skill(
            dir.path(),
            "commit.md",
            "---\nname: commit\ndescription: Create a commit\n---\nCommit $ARGS",
        );
        write_skill(
            dir.path(),
            "review.md",
            "---\nname: review\ntype: agent\ndescription: Review code\n---\nReview $ARGS",
        );

        let provider = SkillProvider::load(dir.path());
        let schemas = provider.tool_schemas();
        assert_eq!(schemas.len(), 2);

        let names: Vec<&str> = schemas
            .iter()
            .map(|s| s["name"].as_str().unwrap())
            .collect();
        assert!(names.contains(&"skill.commit"));
        assert!(names.contains(&"skill.review"));
    }

    #[test]
    fn tier_returns_tier2_for_known_skills() {
        let dir = TempDir::new().unwrap();
        write_skill(dir.path(), "test.md", "---\nname: test\n---\nbody");

        let provider = SkillProvider::load(dir.path());
        assert_eq!(
            provider.tier("skill.test"),
            Some(agent::safety::ToolTier::Tier2)
        );
        assert_eq!(provider.tier("skill.unknown"), None);
        assert_eq!(provider.tier("not_a_skill"), None);
    }

    #[test]
    fn permissions_headless_requires_network() {
        let dir = TempDir::new().unwrap();
        write_skill(
            dir.path(),
            "bg.md",
            "---\nname: bg\ntype: headless\n---\nbg task",
        );
        write_skill(
            dir.path(),
            "fg.md",
            "---\nname: fg\ntype: prompt\n---\nfg task",
        );

        let provider = SkillProvider::load(dir.path());

        let bg_perms = provider.permissions("skill.bg").unwrap();
        assert!(bg_perms.requires_file_read);
        assert!(bg_perms.requires_network);

        let fg_perms = provider.permissions("skill.fg").unwrap();
        assert!(fg_perms.requires_file_read);
        assert!(!fg_perms.requires_network);
    }

    #[tokio::test]
    async fn handle_returns_none_for_unknown() {
        let dir = TempDir::new().unwrap();
        let provider = SkillProvider::load(dir.path());
        let result = provider.handle("skill.nope", &Map::new()).await;
        assert!(result.is_none());
    }

    #[tokio::test]
    async fn handle_executes_skill_and_returns_content() {
        let dir = TempDir::new().unwrap();
        write_skill(
            dir.path(),
            "greet.md",
            "---\nname: greet\n---\nHello $ARGS!",
        );

        let provider = SkillProvider::load(dir.path());
        let mut args = Map::new();
        args.insert("args".to_string(), Value::String("world".to_string()));

        let result = provider.handle("skill.greet", &args).await;
        assert!(result.is_some());
        let value = result.unwrap().unwrap();
        assert_eq!(value.as_str().unwrap(), "Hello world!");
    }
}
