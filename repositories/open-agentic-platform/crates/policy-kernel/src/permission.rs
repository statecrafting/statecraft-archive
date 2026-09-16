// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Bartek Kus

//! Permission rule evaluator (spec 068, FR-002–FR-004, FR-007, NF-001).
//!
//! Evaluates a tool call against the merged permission rules using glob matching.
//! Evaluation order: deny rules → allow rules → ask rules → default mode.

use glob::Pattern;
use serde::{Deserialize, Serialize};
use std::sync::{Arc, RwLock};

use crate::audit::{AuditEntry, AuditLogger};
use crate::denial::{DenialTracker, EscalationAction};
use crate::settings::{DefaultMode, MergedSettings, PermissionRule, SettingsTier};

/// Outcome of a permission evaluation (FR-002).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum PermissionDecision {
    /// Tool call is auto-approved.
    Allow,
    /// Tool call is blocked.
    Deny(String),
    /// Interactive approval required.
    Ask(String),
}

/// Context for evaluating a single tool call (FR-007).
#[derive(Debug, Clone)]
pub struct PermissionContext {
    /// The tool being invoked (e.g. `"Bash"`, `"FileRead"`).
    pub tool_name: String,
    /// File path being accessed (if applicable).
    pub file_path: Option<String>,
    /// Command being run (for shell-like tools).
    pub command: Option<String>,
}

/// Which rule matched (for audit logging).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MatchedRule {
    pub tier: String,
    pub action: String,
    pub tool_pattern: String,
}

/// The core permission runtime (FR-004, FR-007).
///
/// Thread-safe: settings are behind an `Arc<RwLock>` so the watcher can
/// swap them without stopping evaluation.
pub struct PermissionRuntime {
    settings: Arc<RwLock<MergedSettings>>,
    denial_tracker: Arc<RwLock<DenialTracker>>,
    audit_logger: Option<Arc<AuditLogger>>,
}

impl PermissionRuntime {
    /// Create a new runtime with initial merged settings.
    pub fn new(settings: MergedSettings) -> Self {
        Self {
            settings: Arc::new(RwLock::new(settings)),
            denial_tracker: Arc::new(RwLock::new(DenialTracker::new(3))),
            audit_logger: None,
        }
    }

    /// Create a runtime with a custom denial threshold.
    pub fn with_denial_threshold(settings: MergedSettings, threshold: u32) -> Self {
        Self {
            settings: Arc::new(RwLock::new(settings)),
            denial_tracker: Arc::new(RwLock::new(DenialTracker::new(threshold))),
            audit_logger: None,
        }
    }

    /// Attach an audit logger.
    pub fn with_audit_logger(mut self, logger: Arc<AuditLogger>) -> Self {
        self.audit_logger = Some(logger);
        self
    }

    /// Get a clone of the settings Arc for the watcher to update.
    pub fn settings_handle(&self) -> Arc<RwLock<MergedSettings>> {
        Arc::clone(&self.settings)
    }

    /// Get a clone of the denial tracker Arc.
    pub fn denial_tracker_handle(&self) -> Arc<RwLock<DenialTracker>> {
        Arc::clone(&self.denial_tracker)
    }

    /// Core evaluation (FR-004, FR-007).
    ///
    /// 1. Check deny rules (any match → Deny)
    /// 2. Check allow rules (any match → Allow)
    /// 3. Check ask rules (any match → Ask)
    /// 4. Apply defaultMode
    /// 5. Log decision to audit trail
    pub fn evaluate(&self, ctx: &PermissionContext) -> PermissionDecision {
        let settings = self.settings.read().expect("settings lock poisoned");

        // Step 1: deny rules (FR-004).
        for (tier, rule) in &settings.deny_rules {
            if rule_matches(rule, ctx) {
                let reason = rule.reason.clone().unwrap_or_else(|| {
                    format!("denied by {} rule for '{}'", tier_name(*tier), rule.tool)
                });
                let decision = PermissionDecision::Deny(reason.clone());

                // Track denial for escalation (FR-005).
                if let Ok(mut tracker) = self.denial_tracker.write() {
                    tracker.record_denial(&ctx.tool_name);
                }

                self.log_decision(
                    ctx,
                    &decision,
                    Some(MatchedRule {
                        tier: tier_name(*tier),
                        action: "deny".into(),
                        tool_pattern: rule.tool.clone(),
                    }),
                );
                return decision;
            }
        }

        // Step 2: allow rules (FR-004).
        for (tier, rule) in &settings.allow_rules {
            if rule_matches(rule, ctx) {
                let decision = PermissionDecision::Allow;

                // Reset denial counter on approval (FR-005).
                if let Ok(mut tracker) = self.denial_tracker.write() {
                    tracker.record_approval(&ctx.tool_name);
                }

                self.log_decision(
                    ctx,
                    &decision,
                    Some(MatchedRule {
                        tier: tier_name(*tier),
                        action: "allow".into(),
                        tool_pattern: rule.tool.clone(),
                    }),
                );
                return decision;
            }
        }

        // Step 3: ask rules (FR-004).
        for (tier, rule) in &settings.ask_rules {
            if rule_matches(rule, ctx) {
                // Check escalation before asking (FR-005).
                let escalation = self.check_escalation(ctx);
                let decision = match escalation {
                    EscalationAction::Block => PermissionDecision::Deny(format!(
                        "blocked after repeated denials of '{}'",
                        ctx.tool_name
                    )),
                    _ => PermissionDecision::Ask(format!(
                        "confirm use of '{}' (matched {} ask rule)",
                        ctx.tool_name,
                        tier_name(*tier),
                    )),
                };
                self.log_decision(
                    ctx,
                    &decision,
                    Some(MatchedRule {
                        tier: tier_name(*tier),
                        action: "ask".into(),
                        tool_pattern: rule.tool.clone(),
                    }),
                );
                return decision;
            }
        }

        // Step 4: default mode (FR-004 fallthrough).
        // SC-090-5 defense-in-depth: Bypass is only valid from the Policy tier.
        // The merge layer already guards this, but we double-check here in case
        // MergedSettings was constructed directly without going through merge_settings().
        let decision = match settings.default_mode {
            DefaultMode::Bypass if settings.default_mode_tier.is_some_and(|t| t.is_immutable()) => {
                PermissionDecision::Allow
            }
            DefaultMode::Bypass => {
                eprintln!(
                    "[policy-kernel] DefaultMode::Bypass without Policy tier provenance \
                     — downgrading to Ask (SC-090-5)"
                );
                PermissionDecision::Ask(
                    "bypass mode not authorized by policy tier — confirmation required".into(),
                )
            }
            DefaultMode::ReadOnly => PermissionDecision::Deny(
                "read-only mode — write/execute operations denied by default".into(),
            ),
            DefaultMode::Default => {
                let escalation = self.check_escalation(ctx);
                match escalation {
                    EscalationAction::Block => PermissionDecision::Deny(format!(
                        "blocked after repeated denials of '{}'",
                        ctx.tool_name
                    )),
                    _ => PermissionDecision::Ask(format!(
                        "no explicit rule for '{}' — confirmation required",
                        ctx.tool_name
                    )),
                }
            }
        };

        self.log_decision(ctx, &decision, None);
        decision
    }

    fn check_escalation(&self, ctx: &PermissionContext) -> EscalationAction {
        self.denial_tracker
            .read()
            .map(|tracker| tracker.check(&ctx.tool_name))
            .unwrap_or(EscalationAction::Continue)
    }

    fn log_decision(
        &self,
        ctx: &PermissionContext,
        decision: &PermissionDecision,
        matched_rule: Option<MatchedRule>,
    ) {
        if let Some(logger) = &self.audit_logger {
            let entry = AuditEntry {
                tool_name: ctx.tool_name.clone(),
                file_path: ctx.file_path.clone(),
                command: ctx.command.clone(),
                decision: format!("{:?}", decision),
                matched_rule,
            };
            logger.log(entry);
        }
    }
}

/// Check if a permission rule matches a tool call context (FR-003).
fn rule_matches(rule: &PermissionRule, ctx: &PermissionContext) -> bool {
    // Tool name must match (exact or glob).
    if !glob_matches(&rule.tool, &ctx.tool_name) {
        return false;
    }

    // If rule specifies path patterns, at least one must match.
    if !rule.paths.is_empty() {
        match &ctx.file_path {
            Some(path) => {
                if !rule.paths.iter().any(|p| glob_matches(p, path)) {
                    return false;
                }
            }
            None => return false,
        }
    }

    // If rule specifies command patterns, at least one must match.
    if !rule.commands.is_empty() {
        match &ctx.command {
            Some(cmd) => {
                if !rule.commands.iter().any(|c| glob_matches(c, cmd)) {
                    return false;
                }
            }
            None => return false,
        }
    }

    true
}

/// Glob pattern matching with fallback to exact match.
///
/// Uses `glob::Pattern` for patterns containing wildcards (`*`, `?`, `[`).
/// Falls back to case-sensitive exact match for plain strings.
fn glob_matches(pattern: &str, value: &str) -> bool {
    if pattern.contains('*') || pattern.contains('?') || pattern.contains('[') {
        Pattern::new(pattern)
            .map(|p| p.matches(value))
            .unwrap_or(false)
    } else {
        pattern == value
    }
}

fn tier_name(tier: SettingsTier) -> String {
    match tier {
        SettingsTier::Policy => "policy".into(),
        SettingsTier::Environment => "environment".into(),
        SettingsTier::User => "user".into(),
        SettingsTier::Project => "project".into(),
        SettingsTier::Defaults => "defaults".into(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::settings::PermissionRule;

    fn rule(tool: &str) -> PermissionRule {
        PermissionRule {
            tool: tool.into(),
            paths: vec![],
            commands: vec![],
            reason: None,
        }
    }

    fn ctx(tool: &str) -> PermissionContext {
        PermissionContext {
            tool_name: tool.into(),
            file_path: None,
            command: None,
        }
    }

    #[test]
    fn exact_tool_match() {
        let r = rule("Bash");
        assert!(rule_matches(&r, &ctx("Bash")));
        assert!(!rule_matches(&r, &ctx("FileRead")));
    }

    #[test]
    fn glob_tool_match() {
        let r = rule("File*");
        assert!(rule_matches(&r, &ctx("FileRead")));
        assert!(rule_matches(&r, &ctx("FileWrite")));
        assert!(!rule_matches(&r, &ctx("Bash")));
    }

    #[test]
    fn path_pattern_matching() {
        let r = PermissionRule {
            tool: "FileRead".into(),
            paths: vec!["src/**".into(), "docs/**".into()],
            commands: vec![],
            reason: None,
        };
        let mut c = ctx("FileRead");
        c.file_path = Some("src/main.rs".into());
        assert!(rule_matches(&r, &c));

        c.file_path = Some("target/debug/main".into());
        assert!(!rule_matches(&r, &c));

        // No file path provided but rule requires it.
        c.file_path = None;
        assert!(!rule_matches(&r, &c));
    }

    #[test]
    fn command_pattern_matching() {
        let r = PermissionRule {
            tool: "Bash".into(),
            paths: vec![],
            commands: vec!["cargo test *".into(), "git status".into()],
            reason: None,
        };
        let mut c = ctx("Bash");
        c.command = Some("cargo test --release".into());
        assert!(rule_matches(&r, &c));

        c.command = Some("git status".into());
        assert!(rule_matches(&r, &c));

        c.command = Some("rm -rf /".into());
        assert!(!rule_matches(&r, &c));
    }

    #[test]
    fn deny_before_allow() {
        let settings = MergedSettings {
            deny_rules: vec![(SettingsTier::Policy, rule("Bash"))],
            allow_rules: vec![(SettingsTier::User, rule("Bash"))],
            ..Default::default()
        };
        let runtime = PermissionRuntime::new(settings);
        let result = runtime.evaluate(&ctx("Bash"));
        assert!(matches!(result, PermissionDecision::Deny(_)));
    }

    #[test]
    fn allow_before_ask() {
        let settings = MergedSettings {
            allow_rules: vec![(SettingsTier::User, rule("FileRead"))],
            ask_rules: vec![(SettingsTier::Project, rule("FileRead"))],
            ..Default::default()
        };
        let runtime = PermissionRuntime::new(settings);
        assert_eq!(
            runtime.evaluate(&ctx("FileRead")),
            PermissionDecision::Allow
        );
    }

    #[test]
    fn policy_tier_bypass_allows() {
        // SC-090-5: Bypass with Policy tier provenance → Allow.
        let settings = MergedSettings {
            default_mode: DefaultMode::Bypass,
            default_mode_tier: Some(SettingsTier::Policy),
            ..Default::default()
        };
        let runtime = PermissionRuntime::new(settings);
        assert_eq!(
            runtime.evaluate(&ctx("anything")),
            PermissionDecision::Allow
        );
    }

    #[test]
    fn non_policy_bypass_downgrades_to_ask() {
        // SC-090-5: Bypass without Policy provenance → Ask.
        let settings = MergedSettings {
            default_mode: DefaultMode::Bypass,
            default_mode_tier: Some(SettingsTier::User),
            ..Default::default()
        };
        let runtime = PermissionRuntime::new(settings);
        assert!(matches!(
            runtime.evaluate(&ctx("anything")),
            PermissionDecision::Ask(_)
        ));
    }

    #[test]
    fn bypass_without_tier_downgrades_to_ask() {
        // SC-090-5: Bypass with no tier info (direct construction) → Ask.
        let settings = MergedSettings {
            default_mode: DefaultMode::Bypass,
            ..Default::default()
        };
        let runtime = PermissionRuntime::new(settings);
        assert!(matches!(
            runtime.evaluate(&ctx("anything")),
            PermissionDecision::Ask(_)
        ));
    }

    #[test]
    fn default_mode_readonly_denies() {
        let settings = MergedSettings {
            default_mode: DefaultMode::ReadOnly,
            ..Default::default()
        };
        let runtime = PermissionRuntime::new(settings);
        assert!(matches!(
            runtime.evaluate(&ctx("FileWrite")),
            PermissionDecision::Deny(_)
        ));
    }

    #[test]
    fn policy_deny_cannot_be_overridden_by_user_allow() {
        // FR-008: policy deny + user allow → deny wins.
        let settings = MergedSettings {
            deny_rules: vec![(SettingsTier::Policy, rule("Bash"))],
            allow_rules: vec![(SettingsTier::User, rule("Bash"))],
            ..Default::default()
        };
        let runtime = PermissionRuntime::new(settings);
        assert!(matches!(
            runtime.evaluate(&ctx("Bash")),
            PermissionDecision::Deny(_)
        ));
    }

    #[test]
    fn escalation_after_threshold() {
        let settings = MergedSettings {
            ask_rules: vec![(SettingsTier::User, rule("Bash"))],
            ..Default::default()
        };
        let runtime = PermissionRuntime::with_denial_threshold(settings, 2);

        // Simulate 3 denials (exceeds threshold of 2 → Block).
        {
            let handle = runtime.denial_tracker_handle();
            let mut tracker = handle.write().unwrap();
            tracker.record_denial("Bash");
            tracker.record_denial("Bash");
            tracker.record_denial("Bash");
        }

        let result = runtime.evaluate(&ctx("Bash"));
        // After threshold, ask escalates to block.
        assert!(matches!(result, PermissionDecision::Deny(_)));
    }
}
