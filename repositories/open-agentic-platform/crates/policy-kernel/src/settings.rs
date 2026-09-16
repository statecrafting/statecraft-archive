// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Bartek Kus

//! Settings schema for the 5-tier permission system (spec 068, FR-001–FR-003).
//!
//! Defines the permission rule format used in `settings.json` files at each tier.

use serde::{Deserialize, Serialize};

/// A single permission rule matching tool calls by name, path, and command globs.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct PermissionRule {
    /// Tool name pattern — exact match or glob (e.g. `"Bash"`, `"File*"`).
    pub tool: String,
    /// Optional file path glob patterns (e.g. `["src/**", "docs/**"]`).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub paths: Vec<String>,
    /// Optional command glob patterns for shell-like tools (e.g. `["cargo test *"]`).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub commands: Vec<String>,
    /// Human-readable reason (used in deny messages and audit logs).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
}

/// The default permission mode when no rule matches.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "lowercase")]
pub enum DefaultMode {
    /// Normal operation — tools require explicit allow or ask rules.
    #[default]
    Default,
    /// Bypass all permission checks (dangerous — for trusted envs only).
    Bypass,
    /// Read-only — deny all write/execute tools by default.
    ReadOnly,
}

/// Permission configuration block as it appears in a single settings file.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub struct PermissionSettings {
    /// Default mode when no rule matches (FR-004 fallthrough).
    #[serde(default)]
    pub default_mode: DefaultMode,
    /// Rules that auto-approve matching tool calls (FR-002).
    #[serde(default)]
    pub allow: Vec<PermissionRule>,
    /// Rules that auto-reject matching tool calls (FR-002).
    #[serde(default)]
    pub deny: Vec<PermissionRule>,
    /// Rules that require interactive approval (FR-002).
    #[serde(default)]
    pub ask: Vec<PermissionRule>,
}

/// Which settings tier a file belongs to (FR-001).
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
pub enum SettingsTier {
    /// Tier 5: built-in defaults (lowest priority).
    Defaults = 0,
    /// Tier 4: project-level `.claude/settings.json`.
    Project = 1,
    /// Tier 3: user-level `~/.claude/settings.json`.
    User = 2,
    /// Tier 2: environment variable overrides.
    Environment = 3,
    /// Tier 1: enterprise/remote policy (highest priority, immutable by lower tiers).
    Policy = 4,
}

impl SettingsTier {
    /// Returns true if this tier is immutable (cannot be overridden by lower tiers).
    pub fn is_immutable(&self) -> bool {
        matches!(self, SettingsTier::Policy)
    }
}

/// A single tier's settings file content (the full file, not just permissions).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
pub struct TierSettings {
    /// Permission rules from this tier.
    #[serde(default)]
    pub permissions: PermissionSettings,
}

/// Result of merging all 5 tiers (FR-001).
#[derive(Debug, Clone)]
pub struct MergedSettings {
    /// Effective default mode (highest-priority tier wins).
    pub default_mode: DefaultMode,
    /// Which tier set `default_mode` (SC-090-5 defense-in-depth: only Policy may set Bypass).
    pub default_mode_tier: Option<SettingsTier>,
    /// All allow rules aggregated across tiers, tagged with their source tier.
    pub allow_rules: Vec<(SettingsTier, PermissionRule)>,
    /// All deny rules aggregated across tiers, tagged with their source tier.
    pub deny_rules: Vec<(SettingsTier, PermissionRule)>,
    /// All ask rules aggregated across tiers, tagged with their source tier.
    pub ask_rules: Vec<(SettingsTier, PermissionRule)>,
}

impl Default for MergedSettings {
    fn default() -> Self {
        Self {
            default_mode: DefaultMode::Default,
            default_mode_tier: None,
            allow_rules: Vec::new(),
            deny_rules: Vec::new(),
            ask_rules: Vec::new(),
        }
    }
}
