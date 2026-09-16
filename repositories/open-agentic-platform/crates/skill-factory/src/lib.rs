// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Bartek Kus

//! # skill-factory
//!
//! Skill and Command Factory — spec 071.
//!
//! Formalizes the skill/command pattern: each skill is a self-contained unit
//! with a prompt template, allowed tool list, handler type, and optional hooks.
//! Skills are discoverable from `.claude/commands/` files and plugin manifests.
//! The factory pattern enables one-file skill authoring with automatic
//! registration into the tool registry.

pub mod factory;
pub mod filter;
pub mod parser;
pub mod plugin;
pub mod tool_def;
pub mod types;

// Re-export primary types for ergonomic imports.
pub use factory::load_skills_from_dir;
pub use filter::compute_effective_tools;
pub use parser::parse_skill_file;
pub use plugin::{load_plugin_skills, merge_skills};
pub use tool_def::SkillToolDef;
pub use types::{
    AllowedTools, CollectedHook, ParsedSkill, SkillFactoryLoadResult, SkillFrontmatter,
    SkillHookDeclaration, SkillLoadResult, SkillType,
};

// Re-export additional agent-frontmatter types for downstream consumers.
pub use agent_frontmatter::HookHandlerType;
