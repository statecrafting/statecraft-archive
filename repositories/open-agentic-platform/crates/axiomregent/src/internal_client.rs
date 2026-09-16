// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Bartek Kus
// Feature: AGENT_AUTOMATION
// Spec: spec/agent/automation.md

use crate::feature_tools::{FeatureTools, PreflightMode, PreflightRequest};
use crate::lease::Fingerprint;
use crate::workspace::WorkspaceTools;
use agent::validator::McpClient;
use anyhow::{Context, Result, anyhow};
use std::path::PathBuf;
use std::sync::Arc;

pub struct InternalClient {
    pub repo_root: PathBuf,
    pub workspace: Arc<WorkspaceTools>,
    pub features: Arc<FeatureTools>,
}

impl McpClient for InternalClient {
    fn preflight(&self, mode: &str, changed_paths: Vec<String>) -> Result<bool> {
        let mode_enum = match mode {
            "standard" => PreflightMode::Worktree,
            _ => PreflightMode::Worktree,
        };
        let req = PreflightRequest {
            mode: mode_enum,
            snapshot_id: None,
            intent: crate::feature_tools::PreflightIntent::Edit,
            changed_paths,
        };

        let response = self.features.preflight(&self.repo_root, req)?;
        Ok(response.allowed)
    }

    fn drift(&self, _mode: &str) -> Result<bool> {
        // mode "check" usually
        let violations = self.features.drift(&self.repo_root, None)?;
        Ok(!violations.is_empty())
    }

    fn get_drift(&self, exclude_prefix: Option<&str>) -> Result<Vec<String>> {
        // Use git status --porcelain to find modified files
        let output = std::process::Command::new("git")
            .arg("status")
            .arg("--porcelain")
            .current_dir(&self.repo_root)
            .output()
            .context("Failed to run git status")?;

        if !output.status.success() {
            return Err(anyhow!("git status failed"));
        }

        let stdout = String::from_utf8_lossy(&output.stdout);
        let mut violations = Vec::new();
        for line in stdout.lines() {
            // Line format: "XY PATH"
            // XY are status codes.
            if line.len() > 3 {
                let path = line[3..].to_string();
                if exclude_prefix.is_some_and(|prefix| path.starts_with(prefix)) {
                    continue;
                }
                violations.push(path);
            }
        }
        Ok(violations)
    }

    fn impact(&self, _mode: &str, changed_paths: Vec<String>) -> Result<String> {
        // Doc-only changes (markdown, text, images) are low-impact: no code governance required.
        let all_docs = !changed_paths.is_empty()
            && changed_paths.iter().all(|p| {
                p.ends_with(".md")
                    || p.ends_with(".txt")
                    || p.ends_with(".png")
                    || p.ends_with(".jpg")
                    || p.ends_with(".svg")
            });
        if all_docs {
            return Ok("low".to_string());
        }

        let impacted = self.features.impact(&self.repo_root, changed_paths, None)?;
        if impacted.is_empty() {
            Ok("none".to_string())
        } else {
            Ok("high".to_string())
        }
    }

    fn call_tool(&self, name: &str, args: &serde_json::Value) -> Result<serde_json::Value> {
        match name {
            "write_file" | "workspace.write_file" | "repo.write_file" => {
                let path = args
                    .get("path")
                    .and_then(|v| v.as_str())
                    .ok_or_else(|| anyhow!("Missing path"))?;
                let content_base64 = args
                    .get("content_base64")
                    .or_else(|| args.get("content"))
                    .and_then(|v| v.as_str())
                    .ok_or_else(|| anyhow!("Missing content_base64"))?;

                let lease_id = args
                    .get("lease_id")
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string());
                let create_dirs = args
                    .get("create_dirs")
                    .and_then(|v| v.as_bool())
                    .unwrap_or(false);
                let dry_run = args
                    .get("dry_run")
                    .and_then(|v| v.as_bool())
                    .unwrap_or(false);

                tokio::task::block_in_place(|| {
                    tokio::runtime::Handle::current().block_on(self.workspace.write_file(
                        &self.repo_root,
                        path,
                        content_base64,
                        lease_id,
                        create_dirs,
                        dry_run,
                    ))
                })?;
                self.features.invalidate(&self.repo_root);
                Ok(serde_json::json!({"status": "success"}))
            }
            "snapshot.create" | "checkpoint.create" => Err(anyhow!(
                "snapshot.create is deprecated; use checkpoint.create via MCP router"
            )),
            "workspace.apply_patch" | "repo.apply_patch" => {
                let patch = args
                    .get("patch")
                    .and_then(|v| v.as_str())
                    .ok_or_else(|| anyhow!("Missing patch"))?;
                let mode = args
                    .get("mode")
                    .and_then(|v| v.as_str())
                    .unwrap_or("worktree");
                let lease_id = args
                    .get("lease_id")
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string());

                let result = tokio::task::block_in_place(|| {
                    tokio::runtime::Handle::current().block_on(self.workspace.apply_patch(
                        &self.repo_root,
                        patch,
                        mode,
                        lease_id,
                        None,
                        None,
                        false,
                        false,
                    ))
                });
                if result.is_ok() {
                    self.features.invalidate(&self.repo_root);
                }
                result
            }
            "workspace.delete" | "repo.delete" => {
                let path = args
                    .get("path")
                    .and_then(|v| v.as_str())
                    .ok_or_else(|| anyhow!("Missing path"))?;
                let lease_id = args
                    .get("lease_id")
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string());
                let dry_run = args
                    .get("dry_run")
                    .and_then(|v| v.as_bool())
                    .unwrap_or(false);

                tokio::task::block_in_place(|| {
                    tokio::runtime::Handle::current().block_on(self.workspace.delete(
                        &self.repo_root,
                        path,
                        lease_id,
                        dry_run,
                    ))
                })?;
                self.features.invalidate(&self.repo_root);
                Ok(serde_json::json!({"status": "success"}))
            }
            "gov.preflight" => {
                let mode = args
                    .get("mode")
                    .and_then(|v| v.as_str())
                    .unwrap_or("standard");
                let changed_paths = args
                    .get("changed_paths")
                    .and_then(|v| v.as_array())
                    .map(|arr| {
                        arr.iter()
                            .filter_map(|v| v.as_str().map(|s| s.to_string()))
                            .collect::<Vec<_>>()
                    })
                    .unwrap_or_default();
                let allowed = self.preflight(mode, changed_paths)?;
                Ok(serde_json::json!({"allowed": allowed}))
            }
            "gov.drift" => {
                let violations = self.features.drift(&self.repo_root, None)?;
                let has_violations = !violations.is_empty();
                Ok(serde_json::json!({
                    "has_violations": has_violations,
                    "violations": violations
                }))
            }
            "features.impact" => {
                let changed_paths = args
                    .get("paths")
                    .and_then(|v| v.as_array())
                    .map(|arr| {
                        arr.iter()
                            .filter_map(|v| v.as_str().map(|s| s.to_string()))
                            .collect::<Vec<_>>()
                    })
                    .unwrap_or_default();
                let impact = self.impact("check", changed_paths)?;
                Ok(serde_json::json!({"impact": impact}))
            }
            _ => Err(anyhow!("Tool {} not found", name)),
        }
    }

    fn acquire_lease(&self) -> Result<String> {
        tokio::task::block_in_place(|| {
            let handle = tokio::runtime::Handle::current();
            let fp = handle.block_on(Fingerprint::compute(&self.repo_root))?;
            handle.block_on(self.workspace.lease_store.issue(fp))
        })
    }
}
