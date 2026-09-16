// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Bartek Kus

//! # agent-frontmatter
//!
//! Unified Agent and Skill Frontmatter Schema — spec 054.
//!
//! Thin shared crate defining the canonical frontmatter types for all agent
//! and skill definition files in the Open Agentic Platform. Depended on by
//! `skill-factory`, `factory-contracts`, and `agent`.
//!
//! ## Dependencies
//!
//! Intentionally minimal: `serde`, `serde_yaml`, `serde_json` only.
//! Must NOT depend on `agent`, `skill-factory`, or `factory-contracts`.

pub mod lint;
pub mod parser;
pub mod types;

// Re-export primary types for ergonomic imports.
pub use lint::{LintDiagnostic, Severity, lint_frontmatter};
pub use parser::{ParseError, parse_frontmatter, parse_frontmatter_yaml};
pub use types::{
    AgentType, AllToolsMarker, AllowedTools, GovernanceRequirement, HookDeclaration,
    HookHandlerType, MutationCapability, SafetyTier, UnifiedFrontmatter,
};
