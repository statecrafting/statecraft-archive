// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Bartek Kus
// Spec: specs/075-factory-workflow-engine/spec.md — FR-010

//! Stage gate orchestration — routes check configurations to check runners
//! and evaluates pass/fail for stage gates, feature gates, and invariants.

use crate::checks::{self, CheckResult};
use factory_contracts::adapter_manifest::{CheckType, Invariant, Severity};
use serde::Deserialize;
use std::path::{Path, PathBuf};

/// Configuration for a single gate check, deserialized from YAML.
#[derive(Clone, Debug, Deserialize)]
pub struct GateCheckConfig {
    pub id: String,
    #[serde(rename = "type", default)]
    pub check_type: String,
    #[serde(default)]
    pub severity: Option<String>,
    #[serde(default)]
    pub artifact: Option<String>,
    #[serde(default)]
    pub schema: Option<String>,
    #[serde(default)]
    pub pattern: Option<String>,
    #[serde(default)]
    pub command: Option<String>,
    #[serde(default)]
    pub scope: Option<String>,
    #[serde(default)]
    pub files: Option<Vec<String>>,
}

fn parse_severity(s: Option<&str>) -> Severity {
    match s {
        Some("warning") => Severity::Warning,
        _ => Severity::Error,
    }
}

/// Run all checks for a stage gate. Returns (all_passed, results).
pub async fn run_stage_gate(
    _stage_id: &str,
    project_root: &Path,
    checks_config: &[GateCheckConfig],
) -> (bool, Vec<CheckResult>) {
    let mut results = Vec::new();

    for check in checks_config {
        let severity = parse_severity(check.severity.as_deref());

        let result = match check.check_type.as_str() {
            "artifact-exists" => {
                let artifact = check.artifact.as_deref().unwrap_or("");
                checks::run_artifact_exists(&check.id, &project_root.join(artifact), severity)
            }
            "schema-validation" => {
                let artifact = check.artifact.as_deref().unwrap_or("");
                let schema = check.schema.as_deref().unwrap_or("");
                checks::run_schema_validation(
                    &check.id,
                    &project_root.join(artifact),
                    &project_root.join(schema),
                    severity,
                )
            }
            "grep-absent" => {
                let pattern = check.pattern.as_deref().unwrap_or("");
                let scope = check.scope.as_deref().unwrap_or(".");
                checks::run_grep_absent(
                    &check.id,
                    pattern,
                    &project_root.join(scope),
                    severity,
                    None,
                )
            }
            "grep-present" => {
                let pattern = check.pattern.as_deref().unwrap_or("");
                let scope = check.scope.as_deref().unwrap_or(".");
                checks::run_grep_present(&check.id, pattern, &project_root.join(scope), severity)
            }
            "command-succeeds" => {
                let command = check
                    .pattern
                    .as_deref()
                    .or(check.command.as_deref())
                    .unwrap_or("");
                checks::run_command(&check.id, command, project_root, severity, 120).await
            }
            "file-check" => {
                let paths: Vec<PathBuf> = check
                    .files
                    .as_deref()
                    .unwrap_or(&[])
                    .iter()
                    .map(|p| project_root.join(p))
                    .collect();
                let refs: Vec<&Path> = paths.iter().map(|p| p.as_path()).collect();
                checks::run_file_check(&check.id, &refs, severity)
            }
            unknown => CheckResult::fail(
                &check.id,
                format!("Unknown check type: {unknown}"),
                severity,
            ),
        };

        results.push(result);
    }

    let all_passed = results
        .iter()
        .all(|r| r.passed || matches!(r.severity, Severity::Warning));
    (all_passed, results)
}

/// Run verification after scaffolding a single feature.
///
/// Runs adapter build/test commands, then checks expected files exist.
/// Check IDs are formatted as `SF-{TYPE}-{N:03}`.
pub async fn run_feature_gate(
    _feature_id: &str,
    feature_type: &str,
    project_root: &Path,
    commands: &[String],
    expected_files: Option<&[PathBuf]>,
) -> (bool, Vec<CheckResult>) {
    let mut results = Vec::new();
    let type_upper = feature_type.to_uppercase();

    for (i, cmd) in commands.iter().enumerate() {
        let check_id = format!("SF-{type_upper}-{:03}", i + 1);
        let result = checks::run_command(&check_id, cmd, project_root, Severity::Error, 120).await;
        results.push(result);
    }

    if let Some(files) = expected_files {
        let check_id = format!("SF-{type_upper}-FILES");
        let refs: Vec<&Path> = files.iter().map(|p| p.as_path()).collect();
        results.push(checks::run_file_check(&check_id, &refs, Severity::Error));
    }

    let all_passed = results
        .iter()
        .all(|r| r.passed || matches!(r.severity, Severity::Warning));
    (all_passed, results)
}

/// Run adapter architecture invariants.
pub async fn run_invariants(
    project_root: &Path,
    invariants: &[Invariant],
) -> (bool, Vec<CheckResult>) {
    let mut results = Vec::new();

    for inv in invariants {
        let severity = inv.severity.clone();
        let pattern = &inv.check.pattern;
        let scope = &inv.check.scope;

        let result = match inv.check.check_type {
            CheckType::GrepAbsent => {
                checks::run_grep_absent(&inv.id, pattern, &project_root.join(scope), severity, None)
            }
            CheckType::GrepPresent => {
                checks::run_grep_present(&inv.id, pattern, &project_root.join(scope), severity)
            }
            CheckType::CommandSucceeds => {
                checks::run_command(&inv.id, pattern, project_root, severity, 120).await
            }
            CheckType::FileExists => {
                checks::run_artifact_exists(&inv.id, &project_root.join(pattern), severity)
            }
            CheckType::FileAbsent => {
                let path = project_root.join(pattern);
                if path.exists() {
                    CheckResult::fail(
                        &inv.id,
                        format!("File should not exist: {}", path.display()),
                        severity,
                    )
                } else {
                    CheckResult::pass(
                        &inv.id,
                        format!("File absent as expected: {}", path.display()),
                        severity,
                    )
                }
            }
        };

        results.push(result);
    }

    let all_passed = results
        .iter()
        .all(|r| r.passed || matches!(r.severity, Severity::Warning));
    (all_passed, results)
}

#[cfg(test)]
mod tests {
    use super::*;
    use factory_contracts::adapter_manifest::InvariantCheck;
    use std::io::Write;
    use tempfile::TempDir;

    fn tmp_file(dir: &TempDir, name: &str, content: &str) {
        let path = dir.path().join(name);
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).unwrap();
        }
        let mut f = std::fs::File::create(path).unwrap();
        f.write_all(content.as_bytes()).unwrap();
    }

    #[tokio::test]
    async fn stage_gate_routes_artifact_exists() {
        let dir = TempDir::new().unwrap();
        tmp_file(&dir, "output.json", r#"{"ok": true}"#);

        let checks = vec![GateCheckConfig {
            id: "S1-001".into(),
            check_type: "artifact-exists".into(),
            severity: None,
            artifact: Some("output.json".into()),
            schema: None,
            pattern: None,
            command: None,
            scope: None,
            files: None,
        }];

        let (passed, results) = run_stage_gate("s1", dir.path(), &checks).await;
        assert!(passed);
        assert_eq!(results.len(), 1);
        assert!(results[0].passed);
    }

    #[tokio::test]
    async fn stage_gate_unknown_type_fails() {
        let dir = TempDir::new().unwrap();
        let checks = vec![GateCheckConfig {
            id: "S1-099".into(),
            check_type: "magic".into(),
            severity: None,
            artifact: None,
            schema: None,
            pattern: None,
            command: None,
            scope: None,
            files: None,
        }];

        let (passed, results) = run_stage_gate("s1", dir.path(), &checks).await;
        assert!(!passed);
        assert!(results[0].message.contains("Unknown check type"));
    }

    #[tokio::test]
    async fn stage_gate_warning_does_not_block() {
        let dir = TempDir::new().unwrap();
        let checks = vec![GateCheckConfig {
            id: "S1-W01".into(),
            check_type: "artifact-exists".into(),
            severity: Some("warning".into()),
            artifact: Some("missing.json".into()),
            schema: None,
            pattern: None,
            command: None,
            scope: None,
            files: None,
        }];

        let (passed, _results) = run_stage_gate("s1", dir.path(), &checks).await;
        assert!(passed, "Warning-severity failure should not block the gate");
    }

    #[tokio::test]
    async fn feature_gate_runs_commands() {
        let dir = TempDir::new().unwrap();
        let commands = vec!["echo ok".to_string()];
        let (passed, results) =
            run_feature_gate("create-user", "api", dir.path(), &commands, None).await;
        assert!(passed);
        assert_eq!(results[0].id, "SF-API-001");
    }

    #[tokio::test]
    async fn invariants_file_absent() {
        let dir = TempDir::new().unwrap();
        let invariants = vec![Invariant {
            id: "INV-001".into(),
            description: "No .env file".into(),
            check: InvariantCheck {
                check_type: CheckType::FileAbsent,
                pattern: ".env".into(),
                scope: ".".into(),
            },
            severity: Severity::Error,
        }];

        let (passed, results) = run_invariants(dir.path(), &invariants).await;
        assert!(passed);
        assert!(results[0].message.contains("absent as expected"));
    }
}
