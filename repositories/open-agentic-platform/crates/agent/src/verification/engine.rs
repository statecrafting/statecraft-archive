// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Bartek Kus
// Feature: VERIFY_PROTOCOL
// Spec: spec/verification.yaml

use crate::schemas::{ChangesetStatusV1, VerificationRunInfo, VerificationSummary};
use crate::validator::{McpClient, Validator};
use crate::verification::config::{Cmd, ReadOnlyMode, VerificationConfig};
use crate::verification::runner::{ConstrainedRunner, StepResult};
use anyhow::{Result, bail};
use serde::{Deserialize, Serialize};

use std::collections::BTreeMap;
use std::fs;
use std::path::Path;

#[derive(Serialize, Deserialize)]
pub struct VerifyResultArtifact {
    pub version: u32,
    pub changeset_id: String,
    pub profile: String,
    pub skill: String,
    pub determinism: String,
    pub tier: u8,
    pub repo_snapshot_before: String,
    pub repo_snapshot_after: String,
    pub tracked_drift: TrackedDrift,
    #[serde(default)]
    pub toolchain: Option<BTreeMap<String, StepResult>>,
    pub steps: Vec<StepResultWithName>,
    pub summary: VerifySummary,
}

#[derive(Serialize, Deserialize)]
pub struct TrackedDrift {
    pub mode: String,
    pub changed_files: Vec<String>,
}

#[derive(Serialize, Deserialize)]
pub struct StepResultWithName {
    pub name: String,
    pub cmd: Cmd,
    pub workdir: String,
    pub timeout_ms: u64,
    pub network: String,
    pub read_only: String,
    pub env_allowlist: Vec<String>,
    #[serde(flatten)]
    pub result: StepResult,
}

#[derive(Serialize, Deserialize)]
pub struct VerifySummary {
    pub overall_exit_code: i32,
    pub duration_ms: u64,
}

pub struct VerifyEngine;

impl VerifyEngine {
    pub fn run<C: McpClient>(
        repo_root: &Path,
        changeset_id: &str,
        profile_name: &str,
        client: &C,
    ) -> Result<bool> {
        let changeset_path = repo_root.join("changes").join(changeset_id);
        if !changeset_path.exists() {
            bail!("Changeset {} not found", changeset_id);
        }

        // 1. Load Config
        let config_path = repo_root.join("spec/verification.yaml");
        if !config_path.exists() {
            bail!("spec/verification.yaml not found");
        }
        let config_str = fs::read_to_string(&config_path)?;
        let config = VerificationConfig::parse(&config_str)?;

        // 2. Resolve Profile
        let profile = config
            .profiles
            .get(profile_name)
            .ok_or_else(|| anyhow::anyhow!("Profile '{}' not found", profile_name))?;

        // 3. Prepare Verify Dir
        let verify_dir = changeset_path.join("verify");
        if !verify_dir.exists() {
            fs::create_dir_all(&verify_dir)?;
        }

        // 4. Run Toolchain Checks
        let mut toolchain_results = BTreeMap::new();
        // Just run default "rust" toolchain if present? Or all?
        // Let's assume we run all defined toolchains for evidence.
        if !config.toolchains.is_empty() {
            for tc in config.toolchains.values() {
                for check in &tc.required {
                    let step_cfg = crate::verification::config::StepConfig {
                        name: "toolchain_check".to_string(), // Dummy name
                        cmd: check.cmd.clone(),
                        workdir: None,
                        timeout_ms: None,
                        network: None,
                        read_only: None,
                        env_allowlist: None,
                        env: None,
                    };
                    let res = ConstrainedRunner::run_step(&step_cfg, repo_root)?;
                    // Use command string as key
                    let cmd_str = match &check.cmd {
                        Cmd::String(s) => s.clone(),
                        Cmd::Argv(v) => v.join(" "),
                    };
                    toolchain_results.insert(cmd_str, res);
                }
            }
        }

        // Write _toolchain.json if not empty?
        if !toolchain_results.is_empty() {
            let tc_artifact_path = verify_dir.join("_toolchain.json");
            let bytes = crate::canonical::to_canonical_json(&toolchain_results)?;
            fs::write(tc_artifact_path, bytes)?;
        }

        let mut overall_success = true;

        // 5. Run Skills
        for skill_id in &profile.include {
            let skill = config.skills.get(skill_id).ok_or_else(|| {
                anyhow::anyhow!("Skill '{}' not found in verification config", skill_id)
            })?;

            let mut steps_results = Vec::new();
            let mut skill_duration = 0;
            let mut skill_exit = 0;

            let exclude_prefix = format!("changes/{}/verify", changeset_id);

            // Check drift before
            let _drift_before = client.get_drift(Some(&exclude_prefix))?;

            // Capture snapshot before skill steps (best-effort; falls back to "unknown" on error)
            let repo_snapshot_before = client
                .call_tool("snapshot.create", &serde_json::json!({}))
                .ok()
                .and_then(|v| {
                    v.get("snapshot_id")
                        .and_then(|s| s.as_str())
                        .map(|s| s.to_string())
                })
                .unwrap_or_else(|| "unknown".to_string());

            for step in &skill.steps {
                let res = ConstrainedRunner::run_step(step, repo_root)?;

                skill_duration += res.duration_ms;
                if res.exit_code != 0 && skill_exit == 0 {
                    skill_exit = res.exit_code;
                }

                let drift_after_step = client.get_drift(Some(&exclude_prefix))?;

                let ro_mode = step.read_only.unwrap_or(config.defaults.read_only);
                if ro_mode != ReadOnlyMode::Off && !drift_after_step.is_empty() {
                    overall_success = false;
                    // Mark exit code as failing if drift occurred in RO mode
                    if skill_exit == 0 {
                        skill_exit = 1;
                    }
                }

                steps_results.push(StepResultWithName {
                    name: step.name.clone(),
                    cmd: step.cmd.clone(),
                    workdir: step
                        .workdir
                        .clone()
                        .unwrap_or(config.defaults.workdir.clone()),
                    timeout_ms: step.timeout_ms.unwrap_or(config.defaults.timeout_ms),
                    network: format!("{:?}", step.network.unwrap_or(config.defaults.network)),
                    read_only: format!("{:?}", ro_mode),
                    env_allowlist: step
                        .env_allowlist
                        .clone()
                        .unwrap_or(config.defaults.env_allowlist.clone()),
                    result: res,
                });
            }

            // Check Drift After Skill
            let drift_after = client.get_drift(Some(&exclude_prefix))?;

            // Capture snapshot after skill steps (best-effort; falls back to "unknown" on error)
            let repo_snapshot_after = client
                .call_tool("snapshot.create", &serde_json::json!({}))
                .ok()
                .and_then(|v| {
                    v.get("snapshot_id")
                        .and_then(|s| s.as_str())
                        .map(|s| s.to_string())
                })
                .unwrap_or_else(|| "unknown".to_string());

            // Write Artifact
            let safe_skill_id = skill_id.replace("/", "_");
            let artifact_path = verify_dir.join(format!("{}.json", safe_skill_id));

            let artifact = VerifyResultArtifact {
                version: 1,
                changeset_id: changeset_id.to_string(),
                profile: profile_name.to_string(),
                skill: skill_id.clone(),
                determinism: format!("{:?}", skill.determinism),
                tier: skill.tier,
                repo_snapshot_before,
                repo_snapshot_after,
                tracked_drift: TrackedDrift {
                    mode: "tracked".to_string(),
                    changed_files: drift_after, // Current drift state
                },
                toolchain: None, // We moved toolchain to separate file
                steps: steps_results,
                summary: VerifySummary {
                    overall_exit_code: skill_exit,
                    duration_ms: skill_duration,
                },
            };

            let canonical_bytes = crate::canonical::to_canonical_json(&artifact)?;
            fs::write(artifact_path, canonical_bytes)?;

            if skill_exit != 0 {
                overall_success = false;
            }
        }

        // 6. Update Status
        let status_path = changeset_path.join("05-status.json");
        if status_path.exists() {
            let bytes = fs::read(&status_path)?;
            let mut status: ChangesetStatusV1 = serde_json::from_slice(&bytes)?;

            status.verification = Some(VerificationSummary {
                last_run: VerificationRunInfo {
                    profile: profile_name.to_string(),
                    outcome: if overall_success {
                        "passed".to_string()
                    } else {
                        "failed".to_string()
                    },
                    timestamp: chrono::Utc::now().to_rfc3339(),
                },
            });

            Validator::write_status(&changeset_path, &status)?;
        }

        Ok(overall_success)
    }
}
