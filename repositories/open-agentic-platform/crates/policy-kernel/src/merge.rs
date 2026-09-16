// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Bartek Kus

//! 5-tier settings merge (spec 068, FR-001, FR-008, NF-002).
//!
//! Loads settings from each tier and merges them with strict priority:
//! policy > env > user > project > defaults.
//!
//! - Scalar keys: highest-priority tier wins.
//! - Permission rules: aggregated across all tiers (deny > allow > ask by eval order).
//! - Policy-tier deny rules are immutable — lower tiers cannot override them (FR-008).

use std::path::{Path, PathBuf};

use crate::settings::{
    DefaultMode, MergedSettings, PermissionSettings, SettingsTier, TierSettings,
};

/// Paths for the file-based settings tiers.
#[derive(Debug, Clone)]
pub struct SettingsPaths {
    /// Tier 1: enterprise/managed policy file.
    pub policy: Option<PathBuf>,
    /// Tier 3: user settings (`~/.claude/settings.json`).
    pub user: Option<PathBuf>,
    /// Tier 4: project settings (`.claude/settings.json` at git root).
    pub project: Option<PathBuf>,
}

impl SettingsPaths {
    /// All file paths that should be watched for changes (FR-006).
    pub fn watch_paths(&self) -> Vec<&Path> {
        [&self.policy, &self.user, &self.project]
            .iter()
            .filter_map(|p| p.as_deref())
            .collect()
    }
}

/// Load a single tier settings file. Returns default if the file doesn't exist or is invalid.
fn load_tier_file(path: &Path) -> TierSettings {
    match std::fs::read_to_string(path) {
        Ok(content) => serde_json::from_str(&content).unwrap_or_default(),
        Err(_) => TierSettings::default(),
    }
}

/// Read environment-variable overrides (Tier 2).
///
/// Recognized variables:
/// - `OAP_PERMISSION_MODE` → sets `defaultMode` ("default", "bypass", "read-only")
fn load_env_tier() -> PermissionSettings {
    let mut settings = PermissionSettings::default();
    if let Ok(mode) = std::env::var("OAP_PERMISSION_MODE") {
        settings.default_mode = match mode.to_lowercase().as_str() {
            "bypass" => DefaultMode::Bypass,
            "read-only" | "readonly" => DefaultMode::ReadOnly,
            _ => DefaultMode::Default,
        };
    }
    settings
}

/// Built-in defaults (Tier 5) — safe baseline.
fn builtin_defaults() -> PermissionSettings {
    PermissionSettings {
        default_mode: DefaultMode::Default,
        allow: Vec::new(),
        deny: Vec::new(),
        ask: Vec::new(),
    }
}

fn tier_name(tier: SettingsTier) -> &'static str {
    match tier {
        SettingsTier::Policy => "policy",
        SettingsTier::Environment => "environment",
        SettingsTier::User => "user",
        SettingsTier::Project => "project",
        SettingsTier::Defaults => "defaults",
    }
}

/// Merge all 5 tiers into a single [`MergedSettings`] (FR-001, NF-002).
///
/// This function is idempotent: calling it twice with the same inputs produces
/// the same result.
pub fn merge_settings(paths: &SettingsPaths) -> MergedSettings {
    // Load each tier.
    let tiers: Vec<(SettingsTier, PermissionSettings)> = vec![
        (SettingsTier::Defaults, builtin_defaults()),
        (
            SettingsTier::Project,
            paths
                .project
                .as_deref()
                .map(|p| load_tier_file(p).permissions)
                .unwrap_or_default(),
        ),
        (
            SettingsTier::User,
            paths
                .user
                .as_deref()
                .map(|p| load_tier_file(p).permissions)
                .unwrap_or_default(),
        ),
        (SettingsTier::Environment, load_env_tier()),
        (
            SettingsTier::Policy,
            paths
                .policy
                .as_deref()
                .map(|p| load_tier_file(p).permissions)
                .unwrap_or_default(),
        ),
    ];

    // Scalar: highest-tier non-default value wins.
    // Spec 090-6: only the Policy tier (Tier 1) may set DefaultMode::Bypass.
    // Non-policy bypass is overridden to Default with a warning.
    let (default_mode, default_mode_tier) = match tiers
        .iter()
        .rev()
        .find(|(_, s)| s.default_mode != DefaultMode::Default)
    {
        Some((tier, settings)) if settings.default_mode == DefaultMode::Bypass => {
            if tier.is_immutable() {
                (DefaultMode::Bypass, Some(*tier))
            } else {
                eprintln!(
                    "[policy-kernel] DefaultMode::Bypass set at {} tier — overriding to Default \
                     (only Policy tier may enable bypass)",
                    tier_name(*tier)
                );
                (DefaultMode::Default, Some(*tier))
            }
        }
        Some((tier, settings)) => (settings.default_mode, Some(*tier)),
        None => (DefaultMode::Default, None),
    };

    // Rules: aggregate across all tiers, tagged with source.
    let mut allow_rules = Vec::new();
    let mut deny_rules = Vec::new();
    let mut ask_rules = Vec::new();

    for (tier, settings) in &tiers {
        for rule in &settings.allow {
            allow_rules.push((*tier, rule.clone()));
        }
        for rule in &settings.deny {
            deny_rules.push((*tier, rule.clone()));
        }
        for rule in &settings.ask {
            ask_rules.push((*tier, rule.clone()));
        }
    }

    MergedSettings {
        default_mode,
        default_mode_tier,
        allow_rules,
        deny_rules,
        ask_rules,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::settings::PermissionRule;
    use std::io::Write;
    use tempfile::NamedTempFile;

    fn write_settings_file(settings: &TierSettings) -> NamedTempFile {
        let mut f = NamedTempFile::new().unwrap();
        let json = serde_json::to_string(settings).unwrap();
        f.write_all(json.as_bytes()).unwrap();
        f
    }

    #[test]
    fn merge_empty_paths_returns_defaults() {
        let paths = SettingsPaths {
            policy: None,
            user: None,
            project: None,
        };
        let merged = merge_settings(&paths);
        assert_eq!(merged.default_mode, DefaultMode::Default);
        assert!(merged.allow_rules.is_empty());
        assert!(merged.deny_rules.is_empty());
        assert!(merged.ask_rules.is_empty());
    }

    #[test]
    fn policy_tier_overrides_user_default_mode() {
        let user_settings = TierSettings {
            permissions: PermissionSettings {
                default_mode: DefaultMode::Bypass,
                ..Default::default()
            },
        };
        let policy_settings = TierSettings {
            permissions: PermissionSettings {
                default_mode: DefaultMode::ReadOnly,
                ..Default::default()
            },
        };
        let user_file = write_settings_file(&user_settings);
        let policy_file = write_settings_file(&policy_settings);
        let paths = SettingsPaths {
            policy: Some(policy_file.path().to_path_buf()),
            user: Some(user_file.path().to_path_buf()),
            project: None,
        };
        let merged = merge_settings(&paths);
        assert_eq!(merged.default_mode, DefaultMode::ReadOnly);
    }

    #[test]
    fn rules_aggregate_across_tiers() {
        let user_settings = TierSettings {
            permissions: PermissionSettings {
                allow: vec![PermissionRule {
                    tool: "FileRead".into(),
                    paths: vec!["src/**".into()],
                    commands: vec![],
                    reason: None,
                }],
                ..Default::default()
            },
        };
        let policy_settings = TierSettings {
            permissions: PermissionSettings {
                deny: vec![PermissionRule {
                    tool: "Bash".into(),
                    paths: vec![],
                    commands: vec!["rm -rf *".into()],
                    reason: Some("dangerous".into()),
                }],
                ..Default::default()
            },
        };
        let user_file = write_settings_file(&user_settings);
        let policy_file = write_settings_file(&policy_settings);
        let paths = SettingsPaths {
            policy: Some(policy_file.path().to_path_buf()),
            user: Some(user_file.path().to_path_buf()),
            project: None,
        };
        let merged = merge_settings(&paths);
        assert_eq!(merged.allow_rules.len(), 1);
        assert_eq!(merged.allow_rules[0].0, SettingsTier::User);
        assert_eq!(merged.deny_rules.len(), 1);
        assert_eq!(merged.deny_rules[0].0, SettingsTier::Policy);
    }

    #[test]
    fn idempotent_merge() {
        let paths = SettingsPaths {
            policy: None,
            user: None,
            project: None,
        };
        let a = merge_settings(&paths);
        let b = merge_settings(&paths);
        assert_eq!(a.default_mode, b.default_mode);
        assert_eq!(a.allow_rules.len(), b.allow_rules.len());
        assert_eq!(a.deny_rules.len(), b.deny_rules.len());
        assert_eq!(a.ask_rules.len(), b.ask_rules.len());
    }

    #[test]
    fn non_policy_bypass_overridden_to_default() {
        // Spec 090-6: only the Policy tier may set DefaultMode::Bypass.
        let user_settings = TierSettings {
            permissions: PermissionSettings {
                default_mode: DefaultMode::Bypass,
                ..Default::default()
            },
        };
        let user_file = write_settings_file(&user_settings);
        let paths = SettingsPaths {
            policy: None,
            user: Some(user_file.path().to_path_buf()),
            project: None,
        };
        let merged = merge_settings(&paths);
        assert_eq!(
            merged.default_mode,
            DefaultMode::Default,
            "user-tier bypass must be overridden to Default"
        );
    }

    #[test]
    fn policy_tier_bypass_is_allowed() {
        let policy_settings = TierSettings {
            permissions: PermissionSettings {
                default_mode: DefaultMode::Bypass,
                ..Default::default()
            },
        };
        let policy_file = write_settings_file(&policy_settings);
        let paths = SettingsPaths {
            policy: Some(policy_file.path().to_path_buf()),
            user: None,
            project: None,
        };
        let merged = merge_settings(&paths);
        assert_eq!(
            merged.default_mode,
            DefaultMode::Bypass,
            "policy-tier bypass must be honored"
        );
    }
}
