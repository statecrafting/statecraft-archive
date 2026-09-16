// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Bartek Kus

//! Core types for the Skill and Command Factory (spec 071).
//!
//! Types shared with `agent-frontmatter` (spec 054) are re-exported from that
//! crate for backward compatibility. Downstream code can continue importing
//! `AllowedTools`, `HookHandlerType`, and `SkillHookDeclaration` from here.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;

// Re-export shared types from agent-frontmatter (spec 054).
pub use agent_frontmatter::{AllToolsMarker, AllowedTools, HookHandlerType};

/// Backward-compatible alias: `SkillHookDeclaration` is now `HookDeclaration`
/// in the `agent-frontmatter` crate.
pub type SkillHookDeclaration = agent_frontmatter::HookDeclaration;

/// Skill execution type (FR-004/005/006).
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SkillType {
    /// Render body as system prompt for sub-agent (FR-004).
    #[default]
    Prompt,
    /// Spawn independent sub-agent via dispatch (FR-005).
    Agent,
    /// Background execution, returns task ID (FR-006).
    Headless,
}

impl From<agent_frontmatter::AgentType> for SkillType {
    fn from(at: agent_frontmatter::AgentType) -> Self {
        match at {
            agent_frontmatter::AgentType::Prompt => SkillType::Prompt,
            agent_frontmatter::AgentType::Agent => SkillType::Agent,
            agent_frontmatter::AgentType::Headless => SkillType::Headless,
            // Factory-specific types map to Prompt (default) in skill context.
            agent_frontmatter::AgentType::Process | agent_frontmatter::AgentType::Scaffold => {
                SkillType::Prompt
            }
        }
    }
}

/// Parsed YAML frontmatter from a skill file (FR-001).
///
/// Wraps the unified frontmatter schema from `agent-frontmatter` (spec 054),
/// converting `AgentType` to `SkillType` for backward compatibility.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SkillFrontmatter {
    pub name: String,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(rename = "type", default)]
    pub skill_type: SkillType,
    #[serde(default)]
    pub allowed_tools: AllowedTools,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
    #[serde(default, skip_serializing_if = "HashMap::is_empty")]
    pub hooks: HashMap<String, Vec<SkillHookDeclaration>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub trigger: Option<String>,
}

impl From<agent_frontmatter::UnifiedFrontmatter> for SkillFrontmatter {
    fn from(uf: agent_frontmatter::UnifiedFrontmatter) -> Self {
        Self {
            name: uf.name,
            description: uf.description,
            skill_type: uf.agent_type.into(),
            allowed_tools: uf.allowed_tools,
            model: uf.model,
            hooks: uf.hooks,
            trigger: uf.trigger,
        }
    }
}

/// A fully parsed skill — frontmatter plus the markdown body (FR-001).
#[derive(Debug, Clone)]
pub struct ParsedSkill {
    pub frontmatter: SkillFrontmatter,
    /// The markdown body (prompt template). Contains `$ARGS` placeholder.
    pub body: String,
    /// Path to the source `.md` file.
    pub source_path: PathBuf,
}

impl ParsedSkill {
    /// Render the prompt body with `$ARGS` replaced.
    pub fn render_prompt(&self, args: &str) -> String {
        self.body.replace("$ARGS", args)
    }
}

/// Outcome of loading a single skill file (FR-009).
#[derive(Debug)]
pub enum SkillLoadResult {
    /// Parsed and ready to register.
    Ok(ParsedSkill),
    /// Loaded with warnings (e.g. deprecated field).
    Warning { skill: ParsedSkill, message: String },
    /// Failed to parse — non-fatal, other skills still load.
    Error { path: PathBuf, message: String },
}

impl SkillLoadResult {
    pub fn skill(&self) -> Option<&ParsedSkill> {
        match self {
            Self::Ok(s) | Self::Warning { skill: s, .. } => Some(s),
            Self::Error { .. } => None,
        }
    }

    pub fn is_error(&self) -> bool {
        matches!(self, Self::Error { .. })
    }
}

/// Aggregated result from `SkillFactory::load_from_dir` (FR-002).
#[derive(Debug)]
pub struct SkillFactoryLoadResult {
    /// Successfully loaded skills.
    pub skills: Vec<ParsedSkill>,
    /// Hook declarations collected from all loaded skills.
    pub hooks: Vec<CollectedHook>,
    /// Per-file load results (for diagnostics).
    pub results: Vec<SkillLoadResult>,
}

/// A hook declaration extracted from a skill, tagged with event type and skill name.
#[derive(Debug, Clone)]
pub struct CollectedHook {
    /// Event type key (e.g. "PreToolUse", "PostToolUse").
    pub event: String,
    /// The hook declaration from frontmatter.
    pub declaration: SkillHookDeclaration,
    /// Name of the skill that declared this hook.
    pub skill_name: String,
}
