// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Bartek Kus
// Feature: AGENT_AUTOMATION
// Spec: spec/agent/automation.md

use crate::schemas::*;
use crate::validator::{McpClient, Validator};
use anyhow::{Context, Result, bail};
use std::fs;
use std::path::Path;

pub struct Executor;

// Allowlist of tools
// repo.* are the canonical names; workspace.* are backward-compat aliases kept for existing changesets
const ALLOWLIST: &[&str] = &[
    "gov.preflight",
    "gov.drift",
    "repo.apply_patch",
    "repo.write_file",
    "repo.delete",
    "workspace.apply_patch",
    "snapshot.create",
    "snapshot.info",
    "workspace.write_file",
    "workspace.delete",
];

impl Executor {
    pub fn execute<C: McpClient>(changeset_path: &Path, client: &C) -> Result<()> {
        // 1. Lock
        let changeset_id = changeset_path
            .file_name()
            .and_then(|n| n.to_str())
            .context("Invalid changeset path")?;

        // Need meta for lockfile context
        let meta_path = changeset_path.join("00-meta.json");
        let meta_bytes = fs::read(&meta_path).context("Failed to read 00-meta.json")?;
        let meta: ChangesetMetaV1 = serde_json::from_slice(&meta_bytes)?;

        let lock_dir = changeset_path.parent().unwrap().join(".locks");
        if !lock_dir.exists() {
            fs::create_dir_all(&lock_dir)?;
        }
        let lock_path = lock_dir.join(changeset_id);

        if lock_path.exists() {
            bail!("Changeset {} is locked", changeset_id);
        }

        let lock_file = LockFile {
            change_set_id: changeset_id.to_string(),
            repo_key: meta.repo_key,
            base_state: meta.base_state,
            base_state_created_at: meta.base_state_created_at,
        };
        let lock_bytes = crate::canonical::to_canonical_json(&lock_file)?;
        fs::write(&lock_path, lock_bytes)?;

        let result = Self::run_execution(changeset_path, client);

        // Unlock
        let _ = fs::remove_file(lock_path);

        result
    }

    fn run_execution<C: McpClient>(changeset_path: &Path, client: &C) -> Result<()> {
        // 2. Validate Status
        let status = Validator::validate(changeset_path, client)?;
        if status.state == "failed" || status.validation.state != "valid" {
            bail!("Changeset validation failed");
        }

        // Pending Review Check
        if status.state == "pending_review" {
            let approved_marker = changeset_path.join("APPROVED");
            if !approved_marker.exists() {
                bail!("Pending review requires APPROVED marker");
            }
        }

        // Tier check
        let plan_path = changeset_path.join("02-implementation-plan.json");
        let plan_bytes = fs::read(&plan_path)?;
        let plan: ImplementationPlanV1 = serde_json::from_slice(&plan_bytes)?;

        if plan.tiers.contains(&"tier3".to_string()) {
            bail!("Tier 3 changesets cannot be executed automatically");
        }

        if plan.tiers.contains(&"tier2".to_string()) {
            let approved_marker = changeset_path.join("APPROVED");
            if !approved_marker.exists() {
                bail!("Tier 2 requires APPROVED marker");
            }
        }

        // 3. Execution Loop
        let mut job_log = Vec::new();
        job_log.extend(status.execution.log.clone());
        let mut steps_completed = 0;

        for task in &plan.tasks {
            for tool_call in &task.tool_calls {
                if !ALLOWLIST.contains(&tool_call.tool_name.as_str()) {
                    bail!("Tool {} is not allowlisted", tool_call.tool_name);
                }

                // Resolve {{lease_id}} template — acquire a fresh lease per workspace step
                let resolved_args = if contains_lease_template(&tool_call.arguments) {
                    let lease_id = client.acquire_lease()?;
                    resolve_template_vars(&tool_call.arguments, &lease_id)
                } else {
                    tool_call.arguments.clone()
                };

                // Call tool
                match client.call_tool(&tool_call.tool_name, &resolved_args) {
                    Ok(output) => {
                        job_log.push(ExecutionEntry {
                            step_id: task.id.clone(),
                            status: "success".to_string(),
                            output: Some(output.to_string()),
                        });
                        steps_completed += 1;
                    }
                    Err(e) => {
                        job_log.push(ExecutionEntry {
                            step_id: task.id.clone(),
                            status: "failed".to_string(),
                            output: Some(e.to_string()),
                        });

                        let final_status = ChangesetStatusV1 {
                            schema_version: "v1".to_string(),
                            state: "failed".to_string(),
                            validation: status.validation.clone(),
                            execution: ExecutionStatus {
                                state: "failed".to_string(),
                                steps_completed,
                                error: Some(format!("Tool failed: {}", e)),
                                log: job_log,
                            },
                            verification: None,
                        };
                        Validator::write_status(changeset_path, &final_status)?;
                        bail!("Tool execution failed: {}", e);
                    }
                }
            }
        }

        // 4. Post-check (Drift)
        if client.drift("check")? {
            let final_status = ChangesetStatusV1 {
                schema_version: "v1".to_string(),
                state: "failed".to_string(),
                validation: status.validation.clone(),
                execution: ExecutionStatus {
                    state: "failed".to_string(),
                    steps_completed,
                    error: Some("Post-execution drift detected".to_string()),
                    log: job_log,
                },
                verification: None,
            };
            Validator::write_status(changeset_path, &final_status)?;
            bail!("Post-execution drift detected");
        }

        // Write Walkthrough
        Self::write_walkthrough(changeset_path, &plan, &job_log)?;

        // 5. Finalize
        let final_status = ChangesetStatusV1 {
            schema_version: "v1".to_string(),
            state: "executed".to_string(),
            validation: status.validation.clone(),
            execution: ExecutionStatus {
                state: "completed".to_string(),
                steps_completed,
                error: None,
                log: job_log,
            },
            verification: None,
        };
        Validator::write_status(changeset_path, &final_status)?;

        Ok(())
    }

    fn write_walkthrough(
        changeset_path: &Path,
        plan: &ImplementationPlanV1,
        log: &[ExecutionEntry],
    ) -> Result<()> {
        let mut s = String::new();
        s.push_str(&format!("# Walkthrough: {}\n\n", plan.goal));

        s.push_str("## Execution Log\n\n");
        for entry in log {
            s.push_str(&format!("### Step: {}\n", entry.step_id));
            s.push_str(&format!("**Status**: {}\n", entry.status));
            if let Some(output) = &entry.output {
                s.push_str("```\n");
                s.push_str(output);
                s.push_str("\n```\n");
            }
        }

        fs::write(changeset_path.join("04-walkthrough.md"), s)?;
        Ok(())
    }
}

fn contains_lease_template(value: &serde_json::Value) -> bool {
    match value {
        serde_json::Value::String(s) => s.contains("{{lease_id}}"),
        serde_json::Value::Object(map) => map.values().any(contains_lease_template),
        serde_json::Value::Array(arr) => arr.iter().any(contains_lease_template),
        _ => false,
    }
}

fn resolve_template_vars(value: &serde_json::Value, lease_id: &str) -> serde_json::Value {
    match value {
        serde_json::Value::String(s) => {
            serde_json::Value::String(s.replace("{{lease_id}}", lease_id))
        }
        serde_json::Value::Object(map) => serde_json::Value::Object(
            map.iter()
                .map(|(k, v)| (k.clone(), resolve_template_vars(v, lease_id)))
                .collect(),
        ),
        serde_json::Value::Array(arr) => serde_json::Value::Array(
            arr.iter()
                .map(|v| resolve_template_vars(v, lease_id))
                .collect(),
        ),
        other => other.clone(),
    }
}
