// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Bartek Kus
// Spec: specs/121-claim-provenance-enforcement/spec.md — FR-026

//! Workspace-level provenance policy slice (spec 121 FR-026).
//!
//! A workspace administrator can pin `STRICT` mode globally so that no
//! project under the workspace can relax to `PERMISSIVE` via its own
//! `factory-config.yaml`. Project config that conflicts with a pinned
//! workspace policy is silently overridden by the pin (the FR says
//! "MAY override"; the operator's directive is "if workspace pins
//! STRICT, project config cannot relax").
//!
//! The type lives in `policy-kernel` rather than `factory-contracts`
//! because a future workspace policy might reach further than just the
//! factory (e.g., overall organization-wide STRICT requirements). The
//! enum here is a tiny mirror of `factory_contracts::FactoryProvenanceMode`
//! to avoid a cross-crate dep cycle; `factory-engine` translates between
//! the two when wiring the gate.

use serde::{Deserialize, Serialize};

/// Workspace-pinned provenance mode. `Some(_)` means the project cannot
/// override; `None` means the project's `factory-config.yaml` is honoured.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "UPPERCASE")]
pub enum PinnedProvenanceMode {
    /// Force STRICT for every project under this workspace.
    Strict,
    /// Allow projects to opt into PERMISSIVE explicitly. (Effectively a
    /// no-op compared to `None`, but provided so the policy can be
    /// authored explicitly without being mistaken for "unset".)
    Permissive,
}

/// Workspace-level provenance policy.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceProvenancePolicy {
    /// When `Some`, project config cannot relax this mode.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pinned_mode: Option<PinnedProvenanceMode>,
    /// Workspace-wide ceiling on per-project `assumptionBudget`.
    /// Projects requesting a larger cap are clamped to this value.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub max_assumption_budget: Option<u32>,
}

impl WorkspaceProvenancePolicy {
    /// True when the workspace pins STRICT mode.
    pub fn pins_strict(&self) -> bool {
        matches!(self.pinned_mode, Some(PinnedProvenanceMode::Strict))
    }

    /// Clamp a project's requested budget to the workspace ceiling, if any.
    pub fn clamp_budget(&self, project_budget: u32) -> u32 {
        match self.max_assumption_budget {
            Some(ceiling) => project_budget.min(ceiling),
            None => project_budget,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_is_unpinned() {
        let p = WorkspaceProvenancePolicy::default();
        assert!(p.pinned_mode.is_none());
        assert!(!p.pins_strict());
        assert!(p.max_assumption_budget.is_none());
    }

    #[test]
    fn pins_strict_when_set() {
        let p = WorkspaceProvenancePolicy {
            pinned_mode: Some(PinnedProvenanceMode::Strict),
            max_assumption_budget: None,
        };
        assert!(p.pins_strict());
    }

    #[test]
    fn permissive_pin_is_not_strict_pin() {
        let p = WorkspaceProvenancePolicy {
            pinned_mode: Some(PinnedProvenanceMode::Permissive),
            max_assumption_budget: None,
        };
        assert!(!p.pins_strict());
    }

    #[test]
    fn clamp_budget_to_ceiling() {
        let p = WorkspaceProvenancePolicy {
            pinned_mode: None,
            max_assumption_budget: Some(5),
        };
        assert_eq!(p.clamp_budget(10), 5);
        assert_eq!(p.clamp_budget(3), 3);
    }

    #[test]
    fn yaml_round_trip() {
        let yaml = "pinnedMode: STRICT\nmaxAssumptionBudget: 5\n";
        let parsed: WorkspaceProvenancePolicy =
            serde_yaml::from_str(yaml).unwrap();
        assert!(parsed.pins_strict());
        assert_eq!(parsed.max_assumption_budget, Some(5));
    }
}
