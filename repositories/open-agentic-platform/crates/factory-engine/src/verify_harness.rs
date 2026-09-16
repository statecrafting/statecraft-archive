// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Bartek Kus
// Spec: specs/075-factory-workflow-engine/spec.md — FR-010

//! Native Rust verification harness for Factory pipeline gates.
//!
//! Runs stage gate checks directly using the Rust check runners in
//! `crate::checks` and `crate::gate`, replacing the former Python
//! subprocess bridge.

use crate::FactoryError;
use crate::gate::{self, GateCheckConfig};
use serde::{Deserialize, Serialize};
use std::path::Path;

/// Result of a gate check invocation.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct GateCheckResult {
    pub passed: bool,
    pub stage_id: String,
    pub checks: Vec<HarnessCheckResult>,
}

/// Individual check result within a gate.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct HarnessCheckResult {
    pub id: String,
    pub passed: bool,
    pub message: Option<String>,
}

/// Run Factory gate checks for a completed stage (FR-010).
///
/// Loads the checks configuration for the given stage from the verification
/// contract, then runs them natively in Rust.
pub async fn run_factory_gate_check(
    stage_id: &str,
    project_path: &Path,
    factory_root: &Path,
) -> Result<GateCheckResult, FactoryError> {
    let checks = load_stage_checks(stage_id, factory_root)?;

    let (passed, results) = gate::run_stage_gate(stage_id, project_path, &checks).await;

    Ok(GateCheckResult {
        passed,
        stage_id: stage_id.into(),
        checks: results
            .into_iter()
            .map(|r| HarnessCheckResult {
                id: r.id,
                passed: r.passed,
                message: Some(r.message),
            })
            .collect(),
    })
}

/// Load gate check configs for a stage from the verification contract.
///
/// Looks for `factory/contract/schemas/stage-outputs/{stage_id}.checks.yaml`
/// or falls back to an empty check list (pass-through).
fn load_stage_checks(
    stage_id: &str,
    factory_root: &Path,
) -> Result<Vec<GateCheckConfig>, FactoryError> {
    let checks_path = factory_root
        .join("contract")
        .join("schemas")
        .join("stage-outputs")
        .join(format!("{stage_id}.checks.yaml"));

    if !checks_path.exists() {
        // No checks file for this stage — pass through.
        return Ok(vec![]);
    }

    let content =
        std::fs::read_to_string(&checks_path).map_err(|e| FactoryError::VerificationHarness {
            reason: format!("failed to read checks file {}: {e}", checks_path.display()),
        })?;

    let checks: Vec<GateCheckConfig> =
        serde_yaml::from_str(&content).map_err(|e| FactoryError::VerificationHarness {
            reason: format!("failed to parse checks YAML {}: {e}", checks_path.display()),
        })?;

    Ok(checks)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn gate_check_with_no_checks_file_passes() {
        let dir = tempfile::TempDir::new().unwrap();
        // No checks file → empty check list → passes
        let result = run_factory_gate_check("s1", dir.path(), dir.path())
            .await
            .unwrap();
        assert!(result.passed);
        assert!(result.checks.is_empty());
    }

    #[tokio::test]
    async fn gate_check_with_artifact_check() {
        let dir = tempfile::TempDir::new().unwrap();
        let factory_root = dir.path().join("factory");
        let stage_dir = factory_root
            .join("contract")
            .join("schemas")
            .join("stage-outputs");
        std::fs::create_dir_all(&stage_dir).unwrap();

        // Create a checks file
        std::fs::write(
            stage_dir.join("s1.checks.yaml"),
            r#"- id: S1-001
  type: artifact-exists
  artifact: output.json
"#,
        )
        .unwrap();

        // Create the artifact in project_path
        let project = dir.path().join("project");
        std::fs::create_dir_all(&project).unwrap();
        std::fs::write(project.join("output.json"), r#"{"ok": true}"#).unwrap();

        let result = run_factory_gate_check("s1", &project, &factory_root)
            .await
            .unwrap();
        assert!(result.passed);
        assert_eq!(result.checks.len(), 1);
        assert!(result.checks[0].passed);
    }
}
