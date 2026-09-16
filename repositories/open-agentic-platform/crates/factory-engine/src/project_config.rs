// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Bartek Kus
// Spec: specs/121-claim-provenance-enforcement/spec.md — FR-025, FR-028

//! Per-project `factory-config.yaml` loader.
//!
//! The config file lives at `<project_root>/factory-config.yaml` and
//! carries the spec-121 `provenance:` block (`mode`, `assumptionBudget`,
//! `reason`). Absence of the file or the key block yields the default
//! STRICT + budget=10 (no PERMISSIVE ramp — operator's directive).

use factory_contracts::{ProvenanceConfig, ProvenanceConfigError};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

/// Whole-file shape of `factory-config.yaml`. Only the `provenance:`
/// block is owned by spec 121; future specs may add other top-level
/// keys (build adapter selection, etc.).
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FactoryProjectConfig {
    /// spec-121 provenance configuration (FR-025, FR-028). Defaults to
    /// STRICT/10 when absent.
    #[serde(default)]
    pub provenance: ProvenanceConfig,
}

#[derive(Debug, thiserror::Error)]
pub enum ProjectConfigError {
    #[error("io error reading {0}: {1}")]
    Io(PathBuf, std::io::Error),
    #[error("yaml parse error in {0}: {1}")]
    Yaml(PathBuf, serde_yaml::Error),
    #[error(transparent)]
    Provenance(#[from] ProvenanceConfigError),
}

/// Load `<project_root>/factory-config.yaml`. Returns the default
/// `FactoryProjectConfig` (STRICT, budget 10) when the file is absent.
/// Validates the loaded config against `ProvenanceConfig::validate` so
/// PERMISSIVE without a reason is a parse-time error (FR-027).
pub fn load_project_config(
    project_root: &Path,
) -> Result<FactoryProjectConfig, ProjectConfigError> {
    let path = project_root.join("factory-config.yaml");
    if !path.exists() {
        return Ok(FactoryProjectConfig::default());
    }
    let bytes = std::fs::read(&path)
        .map_err(|e| ProjectConfigError::Io(path.clone(), e))?;
    let parsed: FactoryProjectConfig = serde_yaml::from_slice(&bytes)
        .map_err(|e| ProjectConfigError::Yaml(path.clone(), e))?;
    parsed.provenance.validate()?;
    Ok(parsed)
}

#[cfg(test)]
mod tests {
    use super::*;
    use factory_contracts::FactoryProvenanceMode;

    #[test]
    fn missing_file_returns_default() {
        let dir = tempfile::tempdir().unwrap();
        let cfg = load_project_config(dir.path()).unwrap();
        assert_eq!(cfg.provenance.mode, FactoryProvenanceMode::Strict);
        assert_eq!(cfg.provenance.assumption_budget, 10);
    }

    #[test]
    fn empty_file_yields_default() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("factory-config.yaml"), "{}\n").unwrap();
        let cfg = load_project_config(dir.path()).unwrap();
        assert_eq!(cfg.provenance.mode, FactoryProvenanceMode::Strict);
    }

    #[test]
    fn explicit_strict_with_custom_budget() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(
            dir.path().join("factory-config.yaml"),
            "provenance:\n  mode: STRICT\n  assumptionBudget: 3\n",
        )
        .unwrap();
        let cfg = load_project_config(dir.path()).unwrap();
        assert_eq!(cfg.provenance.mode, FactoryProvenanceMode::Strict);
        assert_eq!(cfg.provenance.assumption_budget, 3);
    }

    #[test]
    fn permissive_without_reason_errors() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(
            dir.path().join("factory-config.yaml"),
            "provenance:\n  mode: PERMISSIVE\n  assumptionBudget: 5\n",
        )
        .unwrap();
        let err = load_project_config(dir.path()).unwrap_err();
        assert!(matches!(
            err,
            ProjectConfigError::Provenance(
                ProvenanceConfigError::PermissiveWithoutReason
            )
        ));
    }

    #[test]
    fn permissive_with_reason_is_accepted() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(
            dir.path().join("factory-config.yaml"),
            "provenance:\n  mode: PERMISSIVE\n  assumptionBudget: 5\n  reason: \"audit ramp\"\n",
        )
        .unwrap();
        let cfg = load_project_config(dir.path()).unwrap();
        assert_eq!(cfg.provenance.mode, FactoryProvenanceMode::Permissive);
        assert_eq!(cfg.provenance.reason, "audit ramp");
    }

    #[test]
    fn malformed_yaml_errors() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(
            dir.path().join("factory-config.yaml"),
            "provenance:\n  mode: WHATEVER\n",
        )
        .unwrap();
        let err = load_project_config(dir.path()).unwrap_err();
        assert!(matches!(err, ProjectConfigError::Yaml(_, _)));
    }
}
