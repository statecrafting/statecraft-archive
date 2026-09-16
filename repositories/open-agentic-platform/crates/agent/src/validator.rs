// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Bartek Kus
// Feature: AGENT_AUTOMATION
// Spec: spec/agent/automation.md

use crate::canonical::json_sha256;
use crate::schemas::*;
use anyhow::{Context, Result};
use std::fs;
use std::path::Path;

pub trait McpClient {
    fn preflight(&self, mode: &str, changed_paths: Vec<String>) -> Result<bool>;
    fn drift(&self, mode: &str) -> Result<bool>; // true if drift exists
    fn get_drift(&self, _exclude_prefix: Option<&str>) -> Result<Vec<String>> {
        Ok(vec![])
    }
    fn impact(&self, mode: &str, changed_paths: Vec<String>) -> Result<String>; // "high", "low", etc.
    fn call_tool(&self, name: &str, args: &serde_json::Value) -> Result<serde_json::Value>;
    fn acquire_lease(&self) -> Result<String>;
}

pub struct Validator;

impl Validator {
    pub fn write_status(changeset_path: &Path, status: &ChangesetStatusV1) -> Result<()> {
        let bytes = crate::canonical::to_canonical_json(status)?;
        fs::write(changeset_path.join("05-status.json"), bytes)?;
        Ok(())
    }

    pub fn validate<C: McpClient>(changeset_path: &Path, client: &C) -> Result<ChangesetStatusV1> {
        let status = Self::do_validate(changeset_path, client)?;
        Self::write_status(changeset_path, &status)?;
        Ok(status)
    }

    fn do_validate<C: McpClient>(changeset_path: &Path, client: &C) -> Result<ChangesetStatusV1> {
        let mut results = Vec::new();

        // 1. Folder structure & Meta
        let meta_path = changeset_path.join("00-meta.json");
        if !meta_path.exists() {
            return Ok(fail("structure", "Missing 00-meta.json"));
        }

        // 2. Load Meta
        let meta_bytes = fs::read(&meta_path).context("Failed to read 00-meta.json")?;
        let meta: ChangesetMetaV1 =
            serde_json::from_slice(&meta_bytes).context("Failed to parse 00-meta.json")?;

        // Check ID matches folder name
        let folder_name = changeset_path
            .file_name()
            .and_then(|n| n.to_str())
            .context("Invalid folder name")?;

        if meta.change_set_id != folder_name {
            return Ok(fail(
                "integrity",
                "Folder name does not match meta.change_set_id",
            ));
        }

        // 3. Load Plan & Verify Hash
        let plan_path = changeset_path.join("02-implementation-plan.json");
        if !plan_path.exists() {
            return Ok(fail("structure", "Missing 02-implementation-plan.json"));
        }
        let plan_bytes = fs::read(&plan_path).context("Failed to read plan")?;
        let plan: ImplementationPlanV1 =
            serde_json::from_slice(&plan_bytes).context("Failed to parse plan")?;

        // Canonical hash check
        let calculated_hash = json_sha256(&plan)?;
        if calculated_hash != meta.plan_sha256 {
            return Ok(fail(
                "integrity",
                &format!(
                    "Plan hash mismatch. Meta: {}, Calc: {}",
                    meta.plan_sha256, calculated_hash
                ),
            ));
        }

        results.push(pass("integrity", "Hashes match"));

        // Extract changed paths from plan before governance checks
        let mut changed_paths = Vec::new();
        for task in &plan.tasks {
            for tool_call in &task.tool_calls {
                if (tool_call.tool_name == "write_file"
                    || tool_call.tool_name == "workspace.write_file"
                    || tool_call.tool_name == "repo.write_file")
                    && let Some(path) = tool_call.arguments.get("path").and_then(|v| v.as_str())
                {
                    changed_paths.push(path.to_string());
                }
                if (tool_call.tool_name == "workspace.delete"
                    || tool_call.tool_name == "repo.delete")
                    && let Some(path) = tool_call.arguments.get("path").and_then(|v| v.as_str())
                {
                    changed_paths.push(path.to_string());
                }
                if (tool_call.tool_name == "workspace.apply_patch"
                    || tool_call.tool_name == "repo.apply_patch")
                    && let Some(patch) = tool_call.arguments.get("patch").and_then(|v| v.as_str())
                {
                    for line in patch.lines() {
                        if let Some(path_part) = line.strip_prefix("+++ ") {
                            let clean = path_part
                                .trim()
                                .strip_prefix("b/")
                                .unwrap_or(path_part.trim());
                            if clean != "/dev/null" {
                                changed_paths.push(clean.to_string());
                            }
                        }
                    }
                }
            }
        }

        // 4. MCP Checks
        // Preflight
        match client.preflight("standard", changed_paths.clone()) {
            Ok(true) => results.push(pass("preflight", "Passed")),
            Ok(false) => {
                let status = fail_with_results("preflight", "Preflight check failed", results);
                return Ok(status);
            }
            Err(e) => {
                return Ok(fail_with_results(
                    "preflight",
                    &format!("Error: {}", e),
                    results,
                ));
            }
        }

        // Drift
        match client.drift("check") {
            Ok(false) => results.push(pass("drift", "No drift detected")),
            Ok(true) => return Ok(fail_with_results("drift", "Drift detected", results)),
            Err(e) => {
                return Ok(fail_with_results(
                    "drift",
                    &format!("Error: {}", e),
                    results,
                ));
            }
        }

        // Impact
        match client.impact("standard", changed_paths) {
            Ok(impact) => {
                results.push(pass("impact", &format!("Impact assessment: {}", impact)));
                // Decide state based on impact?
                // User: "If impact touches high-impact... 'pending_review'"
                // User: "Tier 2 requires changes/<id>/APPROVED marker"
                // For now, let's say if impact is "high", we mark as valid? Or do we set state to "pending_approval"?
                // The status struct has `state`.
                // Let's assume validation passes if integrity is good.
                // The *Executability* depends on Tier.
                // But Validator produces 05-status.json.
                // User: "If drift violations exist -> reject... If impact touches high -> 'pending_review'".

                let state = match impact.trim().to_lowercase().as_str() {
                    "low" | "none" => "validated".to_string(),
                    _ => "pending_review".to_string(), // Default to safe/high for "high" or unknown
                };

                Ok(ChangesetStatusV1 {
                    schema_version: "v1".to_string(),
                    state,
                    validation: ValidationStatus {
                        state: "valid".to_string(),
                        checks: results,
                    },
                    execution: ExecutionStatus {
                        state: "pending".to_string(),
                        steps_completed: 0,
                        error: None,
                        log: vec![],
                    },
                    verification: None,
                })
            }
            Err(e) => Ok(fail_with_results(
                "impact",
                &format!("Error: {}", e),
                results,
            )),
        }
    }
}

fn pass(name: &str, msg: &str) -> ValidationResult {
    ValidationResult {
        check_name: name.to_string(),
        passed: true,
        message: Some(msg.to_string()),
    }
}

fn fail(name: &str, msg: &str) -> ChangesetStatusV1 {
    ChangesetStatusV1 {
        schema_version: "v1".to_string(),
        state: "failed".to_string(),
        validation: ValidationStatus {
            state: "invalid".to_string(),
            checks: vec![ValidationResult {
                check_name: name.to_string(),
                passed: false,
                message: Some(msg.to_string()),
            }],
        },
        execution: ExecutionStatus {
            state: "failed".to_string(),
            steps_completed: 0,
            error: None,
            log: vec![],
        },
        verification: None,
    }
}

fn fail_with_results(
    name: &str,
    msg: &str,
    mut checks: Vec<ValidationResult>,
) -> ChangesetStatusV1 {
    checks.push(ValidationResult {
        check_name: name.to_string(),
        passed: false,
        message: Some(msg.to_string()),
    });
    ChangesetStatusV1 {
        schema_version: "v1".to_string(),
        state: "failed".to_string(),
        validation: ValidationStatus {
            state: "invalid".to_string(),
            checks,
        },
        execution: ExecutionStatus {
            state: "failed".to_string(),
            steps_completed: 0,
            error: None,
            log: vec![],
        },
        verification: None,
    }
}
