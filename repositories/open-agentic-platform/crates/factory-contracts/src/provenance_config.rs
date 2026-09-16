// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Bartek Kus
// Spec: specs/121-claim-provenance-enforcement/spec.md — FR-024, FR-025, FR-027, FR-028

//! Per-project provenance configuration loaded from `factory-config.yaml`
//! at the project root.
//!
//! `STRICT` is the default for ALL projects from the first run (operator's
//! directive — there is no permissive ramp). `PERMISSIVE` is an explicit,
//! audit-logged opt-in that requires a non-empty `reason` field so the
//! `factory.provenance_mode_changed` audit row carries a real human
//! justification (FR-027).

use serde::{Deserialize, Serialize};

/// QG-13 gate mode (FR-024).
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "UPPERCASE")]
pub enum FactoryProvenanceMode {
    /// FAIL on any `Rejected` claim. Pipeline does not advance.
    /// Default for ALL projects from the first run (operator's directive).
    #[default]
    Strict,
    /// WARN on `Rejected` claims; pipeline advances. Explicit opt-in only.
    Permissive,
}

/// Per-project `provenance:` block in `factory-config.yaml` (FR-025, FR-028).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProvenanceConfig {
    #[serde(default)]
    pub mode: FactoryProvenanceMode,
    /// Per-project assumption budget cap. Default 10 (FR-028).
    #[serde(default = "default_assumption_budget")]
    pub assumption_budget: u32,
    /// Required (non-empty) when `mode == Permissive`. Captured in the
    /// `factory.provenance_mode_changed` audit row.
    #[serde(default)]
    pub reason: String,
}

fn default_assumption_budget() -> u32 {
    10
}

impl Default for ProvenanceConfig {
    fn default() -> Self {
        ProvenanceConfig {
            mode: FactoryProvenanceMode::Strict,
            assumption_budget: 10,
            reason: String::new(),
        }
    }
}

/// Errors that can arise validating a `ProvenanceConfig` after parsing.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum ProvenanceConfigError {
    #[error("provenance.mode = PERMISSIVE requires a non-empty `reason` (spec 121 FR-027)")]
    PermissiveWithoutReason,
}

impl ProvenanceConfig {
    /// FR-027 invariant: `Permissive` mode MUST carry a non-empty reason
    /// so the audit row records the rationale. `Strict` mode does not
    /// require a reason.
    pub fn validate(&self) -> Result<(), ProvenanceConfigError> {
        if self.mode == FactoryProvenanceMode::Permissive
            && self.reason.trim().is_empty()
        {
            return Err(ProvenanceConfigError::PermissiveWithoutReason);
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_is_strict_with_budget_10() {
        let c = ProvenanceConfig::default();
        assert_eq!(c.mode, FactoryProvenanceMode::Strict);
        assert_eq!(c.assumption_budget, 10);
        assert!(c.reason.is_empty());
        assert!(c.validate().is_ok());
    }

    #[test]
    fn permissive_without_reason_is_invalid() {
        let c = ProvenanceConfig {
            mode: FactoryProvenanceMode::Permissive,
            assumption_budget: 10,
            reason: "".into(),
        };
        assert_eq!(
            c.validate(),
            Err(ProvenanceConfigError::PermissiveWithoutReason)
        );
    }

    #[test]
    fn permissive_with_reason_is_valid() {
        let c = ProvenanceConfig {
            mode: FactoryProvenanceMode::Permissive,
            assumption_budget: 20,
            reason: "the example BRD predates spec 121".into(),
        };
        assert!(c.validate().is_ok());
    }

    #[test]
    fn yaml_round_trip_strict() {
        let yaml = "mode: STRICT\nassumptionBudget: 5\nreason: \"\"\n";
        let parsed: ProvenanceConfig = serde_yaml::from_str(yaml).unwrap();
        assert_eq!(parsed.mode, FactoryProvenanceMode::Strict);
        assert_eq!(parsed.assumption_budget, 5);
    }

    #[test]
    fn yaml_round_trip_permissive_with_reason() {
        let yaml = "mode: PERMISSIVE\nassumptionBudget: 20\nreason: \"audit ramp\"\n";
        let parsed: ProvenanceConfig = serde_yaml::from_str(yaml).unwrap();
        assert_eq!(parsed.mode, FactoryProvenanceMode::Permissive);
        assert_eq!(parsed.reason, "audit ramp");
        assert!(parsed.validate().is_ok());
    }

    #[test]
    fn yaml_minimal_is_strict_default() {
        let yaml = "{}\n";
        let parsed: ProvenanceConfig = serde_yaml::from_str(yaml).unwrap();
        assert_eq!(parsed.mode, FactoryProvenanceMode::Strict);
        assert_eq!(parsed.assumption_budget, 10);
    }
}
