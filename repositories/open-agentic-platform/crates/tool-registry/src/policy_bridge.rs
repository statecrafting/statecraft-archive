// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Bartek Kus
// Spec: specs/102-governed-excellence/spec.md — FR-011, FR-014, FR-018

//! Concrete `PolicyEvaluator` bridge from tool-registry to policy-kernel.
//!
//! Translates between the tool-registry's `PolicyEvaluator` trait and the
//! policy-kernel's `evaluate()` function. Every permission decision produces
//! a `ProofRecord` in the proof chain (FR-018).

use crate::types::{PermissionResult, PolicyEvaluator};

/// Configuration for the policy bridge.
pub struct PolicyBridgeConfig {
    /// The compiled policy bundle (constitution + shards).
    pub bundle: policy_kernel::PolicyBundle,
    /// Feature IDs governing the current execution context (FR-015).
    pub feature_ids: Vec<String>,
    /// Active shard scopes to merge into evaluations.
    pub active_shard_scopes: Vec<String>,
}

/// Bridges `tool-registry::PolicyEvaluator` to `policy_kernel::evaluate()`.
///
/// FR-011: concrete implementation of the `PolicyEvaluator` trait.
/// FR-014: composes tool-registry → policy-kernel → proof-chain.
/// FR-018: every decision produces a `ProofRecord`.
pub struct PolicyKernelBridge {
    bundle: policy_kernel::PolicyBundle,
    feature_ids: Vec<String>,
    active_shard_scopes: Vec<String>,
}

impl PolicyKernelBridge {
    pub fn new(config: PolicyBridgeConfig) -> Self {
        Self {
            bundle: config.bundle,
            feature_ids: config.feature_ids,
            active_shard_scopes: config.active_shard_scopes,
        }
    }

    /// Create a bridge with just a policy bundle (convenience).
    pub fn from_bundle(bundle: policy_kernel::PolicyBundle) -> Self {
        Self {
            bundle,
            feature_ids: Vec::new(),
            active_shard_scopes: Vec::new(),
        }
    }
}

impl PolicyEvaluator for PolicyKernelBridge {
    fn evaluate(&self, tool_name: &str, arguments_summary: &str) -> PermissionResult {
        let ctx = policy_kernel::ToolCallContext {
            tool_name: tool_name.to_string(),
            arguments_summary: arguments_summary.to_string(),
            proposed_file_content: None,
            diff_lines: None,
            diff_bytes: None,
            active_shard_scopes: self.active_shard_scopes.clone(),
            feature_ids: self.feature_ids.clone(),
            max_spec_risk: None,
            spec_statuses: Vec::new(),
            spec_impl_statuses: Vec::new(),
        };

        let decision = policy_kernel::evaluate(&ctx, &self.bundle);

        match decision.outcome {
            policy_kernel::PolicyOutcome::Allow => PermissionResult::Allow,
            policy_kernel::PolicyOutcome::Deny => PermissionResult::Deny(decision.reason),
            policy_kernel::PolicyOutcome::Degrade => {
                PermissionResult::Ask(format!("policy degraded: {}", decision.reason))
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::BTreeMap;

    fn empty_bundle() -> policy_kernel::PolicyBundle {
        policy_kernel::PolicyBundle {
            constitution: vec![],
            shards: BTreeMap::new(),
        }
    }

    #[test]
    fn bridge_allows_when_no_gates_trigger() {
        let bridge = PolicyKernelBridge::from_bundle(empty_bundle());
        let result = bridge.evaluate("file_read", "/some/path");
        assert_eq!(result, PermissionResult::Allow);
    }

    #[test]
    fn bridge_denies_on_secrets_detection() {
        let bundle = policy_kernel::PolicyBundle {
            constitution: vec![policy_kernel::PolicyRule {
                id: "CONST-002".into(),
                description: "secrets scanner".into(),
                mode: "enforce".into(),
                scope: "global".into(),
                gate: Some("secrets_scanner".into()),
                source_path: "test".into(),
                allow_destructive: None,
                allowed_tools: None,
                max_diff_lines: None,
                max_diff_bytes: None,
            }],
            shards: BTreeMap::new(),
        };

        let bridge = PolicyKernelBridge::from_bundle(bundle);
        // Arguments containing a secret pattern (sk- followed by 20+ alphanumeric chars).
        let result = bridge.evaluate("file_write", "sk-abcdefghijklmnopqrstuvwxyz012345");
        assert!(matches!(result, PermissionResult::Deny(_)));
    }

    #[test]
    fn bridge_with_feature_ids() {
        let config = PolicyBridgeConfig {
            bundle: empty_bundle(),
            feature_ids: vec!["102-governed-excellence".into()],
            active_shard_scopes: vec!["factory".into()],
        };

        let bridge = PolicyKernelBridge::new(config);
        let result = bridge.evaluate("file_read", "");
        assert_eq!(result, PermissionResult::Allow);
    }
}
