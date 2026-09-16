// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Bartek Kus

use async_trait::async_trait;
use serde_json::{Map, Value, json};
use std::path::Path;
use std::sync::Arc;

use crate::agent_tools::AgentTools;
use crate::run_tools::RunTools;
use crate::workspace::RepoMutationTools;
use featuregraph::tools::FeatureGraphTools;
use xray::tools::XrayTools;

use super::provider::{ToolPermissions, ToolProvider};

/// Maps legacy `workspace.*` tool names to the canonical `repo.*` names.
/// Called at the top of `handle`, `tier`, and `permissions` so old names are
/// transparently forwarded without duplicating dispatch logic.
fn normalize_repo_tool_name(name: &str) -> &str {
    match name {
        "workspace.write_file" => "repo.write_file",
        "workspace.delete" => "repo.delete",
        "workspace.apply_patch" => "repo.apply_patch",
        _ => name,
    }
}

pub struct LegacyToolProvider {
    pub workspace_tools: Arc<RepoMutationTools>,
    pub featuregraph_tools: Arc<FeatureGraphTools>,
    pub xray_tools: Arc<XrayTools>,
    pub agent_tools: Arc<AgentTools>,
    pub run_tools: Arc<RunTools>,
}

#[async_trait]
impl ToolProvider for LegacyToolProvider {
    fn tool_schemas(&self) -> Vec<Value> {
        vec![
            // FeatureGraph Tools
            json!({
                "name": "features.impact",
                "description": "Given a list of changed file paths, returns which features are affected. Use before proposing any edit to understand governance scope and ownership.",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "repo_root": {
                            "type": "string",
                            "description": "Absolute path to the repository root."
                        },
                        "paths": {
                            "type": "array",
                            "items": { "type": "string" },
                            "description": "List of file paths (relative to repo_root or absolute) to analyze for feature attribution."
                        }
                    },
                    "required": ["repo_root", "paths"]
                }
            }),
            // Governance Tools
            json!({
                "name": "gov.preflight",
                "description": "Check governance policy for proposed changes",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "repo_root": { "type": "string" },
                        "intent": { "type": "string", "description": "Natural-language description of planned change" },
                        "mode": { "type": "string", "enum": ["worktree", "snapshot"] },
                        "changed_paths": { "type": "array", "items": { "type": "string" } },
                        "snapshot_id": { "type": "string" }
                    },
                    "required": ["repo_root", "intent", "mode", "changed_paths"]
                }
            }),
            json!({
                "name": "gov.drift",
                "description": "Check for drift and violations",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "repo_root": { "type": "string" }
                    },
                    "required": ["repo_root"]
                }
            }),
            // Xray Tools
            json!({
                "name": "xray.scan",
                "description": "Scan repository to build index",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "repo_root": { "type": "string" },
                        "path": { "type": "string" }
                    },
                    "required": ["repo_root"]
                }
            }),
            // Agent Protocol Tools
            json!({
                "name": "agent.propose",
                "description": "Create a structured changeset artifact in changes/ (does not execute)",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "repo_root": { "type": "string" },
                        "subject": { "type": "string" },
                        "repo_key": { "type": "string" },
                        "base_state": { "type": "string" },
                        "goal": { "type": "string" },
                        "tasks": {
                            "type": "array",
                            "items": { "type": "object" }
                        },
                        "tiers": {
                            "type": "array",
                            "items": { "type": "string" }
                        },
                        "architecture_doc": { "type": "string" },
                        "base_state_created_at": { "type": "string" }
                    },
                    "required": ["repo_root", "subject", "repo_key", "goal", "tasks"]
                }
            }),
            json!({
                "name": "agent.execute",
                "description": "Execute a proposed changeset by replaying its tool_calls against the allowlisted tools",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "repo_root": { "type": "string" },
                        "changeset_id": { "type": "string" }
                    },
                    "required": ["repo_root", "changeset_id"]
                }
            }),
            json!({
                "name": "agent.verify",
                "description": "Validate a changeset's artifacts and post-execution state",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "repo_root": { "type": "string" },
                        "changeset_id": { "type": "string" },
                        "profile": { "type": "string" }
                    },
                    "required": ["repo_root", "changeset_id"]
                }
            }),
            // Run Tools
            json!({
                "name": "run.execute",
                "description": "Execute a run skill",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "skill": { "type": "string" },
                        "env": { "type": "object" }
                    },
                    "required": ["skill"]
                }
            }),
            json!({
                "name": "run.status",
                "description": "Get run status",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "run_id": { "type": "string" }
                    },
                    "required": ["run_id"]
                }
            }),
            json!({
                "name": "run.logs",
                "description": "Get run logs",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "run_id": { "type": "string" },
                        "offset": { "type": "integer" },
                        "limit": { "type": "integer" }
                    },
                    "required": ["run_id"]
                }
            }),
            // Repo Mutation Tools (canonical repo.* names)
            json!({
                "name": "repo.write_file",
                "description": "Write file content inside the repository worktree",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "repo_root": { "type": "string" },
                        "path": { "type": "string" },
                        "content_base64": { "type": "string" },
                        "lease_id": { "type": "string" },
                        "create_dirs": { "type": "boolean" },
                        "dry_run": { "type": "boolean" }
                    },
                    "required": ["repo_root", "path", "content_base64", "lease_id"]
                }
            }),
            json!({
                "name": "repo.delete",
                "description": "Delete a file or directory inside the repository worktree",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "repo_root": { "type": "string" },
                        "path": { "type": "string" },
                        "lease_id": { "type": "string" },
                        "dry_run": { "type": "boolean" }
                    },
                    "required": ["repo_root", "path", "lease_id"]
                }
            }),
            json!({
                "name": "repo.apply_patch",
                "description": "Apply a unified diff patch to the repository worktree",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "repo_root": { "type": "string" },
                        "patch": { "type": "string" },
                        "mode": { "type": "string", "enum": ["worktree", "snapshot"] },
                        "lease_id": { "type": "string" },
                        "snapshot_id": { "type": "string" },
                        "strip": { "type": "integer" },
                        "reject_on_conflict": { "type": "boolean" },
                        "dry_run": { "type": "boolean" }
                    },
                    "required": ["repo_root", "patch", "mode"]
                }
            }),
            // Backward-compatible workspace.* aliases
            json!({
                "name": "workspace.write_file",
                "description": "[Alias for repo.write_file] Write file content inside the repository worktree",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "repo_root": { "type": "string" },
                        "path": { "type": "string" },
                        "content_base64": { "type": "string" },
                        "lease_id": { "type": "string" },
                        "create_dirs": { "type": "boolean" },
                        "dry_run": { "type": "boolean" }
                    },
                    "required": ["repo_root", "path", "content_base64", "lease_id"]
                }
            }),
            json!({
                "name": "workspace.delete",
                "description": "[Alias for repo.delete] Delete a file or directory inside the repository worktree",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "repo_root": { "type": "string" },
                        "path": { "type": "string" },
                        "lease_id": { "type": "string" },
                        "dry_run": { "type": "boolean" }
                    },
                    "required": ["repo_root", "path", "lease_id"]
                }
            }),
            json!({
                "name": "workspace.apply_patch",
                "description": "[Alias for repo.apply_patch] Apply a unified diff patch to the repository worktree",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "repo_root": { "type": "string" },
                        "patch": { "type": "string" },
                        "mode": { "type": "string", "enum": ["worktree", "snapshot"] },
                        "lease_id": { "type": "string" },
                        "snapshot_id": { "type": "string" },
                        "strip": { "type": "integer" },
                        "reject_on_conflict": { "type": "boolean" },
                        "dry_run": { "type": "boolean" }
                    },
                    "required": ["repo_root", "patch", "mode"]
                }
            }),
        ]
    }

    async fn handle(&self, name: &str, args: &Map<String, Value>) -> Option<anyhow::Result<Value>> {
        let name = normalize_repo_tool_name(name);
        match name {
            // --- FeatureGraph Tools ---
            "features.impact" => {
                let repo_root = match args.get("repo_root").and_then(|v| v.as_str()) {
                    Some(v) => v,
                    None => return Some(Err(anyhow::anyhow!("repo_root required"))),
                };
                let paths: Vec<String> = args
                    .get("paths")
                    .and_then(|v| v.as_array())
                    .map(|arr| {
                        arr.iter()
                            .filter_map(|v| v.as_str().map(String::from))
                            .collect()
                    })
                    .unwrap_or_default();
                Some(self.featuregraph_tools.features_impact(repo_root, &paths))
            }

            "gov.preflight" => {
                let repo_root = match args.get("repo_root").and_then(|v| v.as_str()) {
                    Some(v) => Path::new(v),
                    None => return Some(Err(anyhow::anyhow!("repo_root required"))),
                };
                Some(
                    self.featuregraph_tools
                        .governance_preflight(repo_root, Value::Object(args.clone())),
                )
            }

            "gov.drift" => {
                let repo_root = match args.get("repo_root").and_then(|v| v.as_str()) {
                    Some(v) => Path::new(v),
                    None => return Some(Err(anyhow::anyhow!("repo_root required"))),
                };
                Some(self.featuregraph_tools.governance_drift(repo_root))
            }

            // --- Xray Tools ---
            "xray.scan" => {
                let repo_root = match args.get("repo_root").and_then(|v| v.as_str()) {
                    Some(v) => Path::new(v),
                    None => return Some(Err(anyhow::anyhow!("repo_root required"))),
                };
                let path = args.get("path").and_then(|v| v.as_str()).map(String::from);
                Some(self.xray_tools.xray_scan(repo_root, path))
            }

            // --- Agent Protocol Tools ---
            "agent.propose" => {
                let repo_root = match args.get("repo_root").and_then(|v| v.as_str()) {
                    Some(v) => Path::new(v),
                    None => return Some(Err(anyhow::anyhow!("repo_root required"))),
                };
                let config_res: Result<agent::agent::AgentConfig, _> =
                    serde_json::from_value(Value::Object(args.clone()));
                match config_res {
                    Ok(config) => Some(self.agent_tools.propose(repo_root, config)),
                    Err(e) => Some(Err(anyhow::anyhow!("Invalid AgentConfig: {}", e))),
                }
            }

            "agent.execute" => {
                let repo_root = match args.get("repo_root").and_then(|v| v.as_str()) {
                    Some(v) => Path::new(v),
                    None => return Some(Err(anyhow::anyhow!("repo_root required"))),
                };
                let changeset_id = match args.get("changeset_id").and_then(|v| v.as_str()) {
                    Some(v) => v,
                    None => return Some(Err(anyhow::anyhow!("changeset_id required"))),
                };
                Some(self.agent_tools.execute(repo_root, changeset_id))
            }

            "agent.verify" => {
                let repo_root = match args.get("repo_root").and_then(|v| v.as_str()) {
                    Some(v) => Path::new(v),
                    None => return Some(Err(anyhow::anyhow!("repo_root required"))),
                };
                let changeset_id = match args.get("changeset_id").and_then(|v| v.as_str()) {
                    Some(v) => v,
                    None => return Some(Err(anyhow::anyhow!("changeset_id required"))),
                };
                let profile = args.get("profile").and_then(|v| v.as_str()).unwrap_or("pr");
                Some(self.agent_tools.verify(repo_root, changeset_id, profile))
            }

            // --- Run Tools ---
            "run.execute" => {
                let skill = match args.get("skill").and_then(|v| v.as_str()) {
                    Some(v) => v.to_string(),
                    None => return Some(Err(anyhow::anyhow!("skill required"))),
                };
                let env = args.get("env").and_then(|v| v.as_object()).map(|obj| {
                    obj.iter()
                        .filter_map(|(k, v)| v.as_str().map(|s| (k.clone(), s.to_string())))
                        .collect()
                });
                Some(self.run_tools.execute(skill, env).await)
            }

            "run.status" => {
                let run_id = match args.get("run_id").and_then(|v| v.as_str()) {
                    Some(v) => v,
                    None => return Some(Err(anyhow::anyhow!("run_id required"))),
                };
                Some(self.run_tools.status(run_id).await)
            }

            "run.logs" => {
                let run_id = match args.get("run_id").and_then(|v| v.as_str()) {
                    Some(v) => v,
                    None => return Some(Err(anyhow::anyhow!("run_id required"))),
                };
                let offset = args.get("offset").and_then(|v| v.as_u64());
                let limit = args.get("limit").and_then(|v| v.as_u64());
                Some(self.run_tools.logs(run_id, offset, limit).await)
            }

            // --- Repo Mutation Tools ---
            "repo.write_file" => {
                let repo_root = match args.get("repo_root").and_then(|v| v.as_str()) {
                    Some(v) => Path::new(v),
                    None => return Some(Err(anyhow::anyhow!("repo_root required"))),
                };
                let path = match args.get("path").and_then(|v| v.as_str()) {
                    Some(v) => v,
                    None => return Some(Err(anyhow::anyhow!("path required"))),
                };
                let content_base64 = match args.get("content_base64").and_then(|v| v.as_str()) {
                    Some(v) => v,
                    None => return Some(Err(anyhow::anyhow!("content_base64 required"))),
                };
                let lease_id = args
                    .get("lease_id")
                    .and_then(|v| v.as_str())
                    .map(String::from);
                let create_dirs = args
                    .get("create_dirs")
                    .and_then(|v| v.as_bool())
                    .unwrap_or(false);
                let dry_run = args
                    .get("dry_run")
                    .and_then(|v| v.as_bool())
                    .unwrap_or(false);
                Some(
                    self.workspace_tools
                        .write_file(
                            repo_root,
                            path,
                            content_base64,
                            lease_id,
                            create_dirs,
                            dry_run,
                        )
                        .await
                        .map(|_| json!({"status": "ok"})),
                )
            }

            "repo.delete" => {
                let repo_root = match args.get("repo_root").and_then(|v| v.as_str()) {
                    Some(v) => Path::new(v),
                    None => return Some(Err(anyhow::anyhow!("repo_root required"))),
                };
                let path = match args.get("path").and_then(|v| v.as_str()) {
                    Some(v) => v,
                    None => return Some(Err(anyhow::anyhow!("path required"))),
                };
                let lease_id = args
                    .get("lease_id")
                    .and_then(|v| v.as_str())
                    .map(String::from);
                let dry_run = args
                    .get("dry_run")
                    .and_then(|v| v.as_bool())
                    .unwrap_or(false);
                Some(
                    self.workspace_tools
                        .delete(repo_root, path, lease_id, dry_run)
                        .await
                        .map(|_| json!({"status": "ok"})),
                )
            }

            "repo.apply_patch" => {
                let repo_root = match args.get("repo_root").and_then(|v| v.as_str()) {
                    Some(v) => Path::new(v),
                    None => return Some(Err(anyhow::anyhow!("repo_root required"))),
                };
                let patch = match args.get("patch").and_then(|v| v.as_str()) {
                    Some(v) => v,
                    None => return Some(Err(anyhow::anyhow!("patch required"))),
                };
                let mode = match args.get("mode").and_then(|v| v.as_str()) {
                    Some(v) => v,
                    None => return Some(Err(anyhow::anyhow!("mode required"))),
                };
                let lease_id = args
                    .get("lease_id")
                    .and_then(|v| v.as_str())
                    .map(String::from);
                let snapshot_id = args
                    .get("snapshot_id")
                    .and_then(|v| v.as_str())
                    .map(String::from);
                let strip = args
                    .get("strip")
                    .and_then(|v| v.as_u64())
                    .map(|v| v as usize);
                let reject_on_conflict = args
                    .get("reject_on_conflict")
                    .and_then(|v| v.as_bool())
                    .unwrap_or(false);
                let dry_run = args
                    .get("dry_run")
                    .and_then(|v| v.as_bool())
                    .unwrap_or(false);
                Some(
                    self.workspace_tools
                        .apply_patch(
                            repo_root,
                            patch,
                            mode,
                            lease_id,
                            snapshot_id,
                            strip,
                            reject_on_conflict,
                            dry_run,
                        )
                        .await,
                )
            }

            _ => None,
        }
    }

    fn tier(&self, name: &str) -> Option<agent::safety::ToolTier> {
        let name = normalize_repo_tool_name(name);
        match name {
            "features.impact" | "gov.preflight" | "gov.drift" | "xray.scan" | "agent.verify"
            | "run.status" | "run.logs" | "repo.write_file" | "repo.delete"
            | "repo.apply_patch" | "agent.propose" | "agent.execute" | "run.execute" => {
                Some(agent::safety::get_tool_tier(name))
            }
            _ => None,
        }
    }

    fn permissions(&self, name: &str) -> Option<ToolPermissions> {
        let name = normalize_repo_tool_name(name);
        if self.tier(name).is_some() {
            Some(ToolPermissions {
                requires_file_read: matches!(
                    name,
                    "gov.preflight"
                        | "gov.drift"
                        | "features.impact"
                        | "xray.scan"
                        | "agent.verify"
                ),
                requires_file_write: matches!(
                    name,
                    "repo.write_file"
                        | "repo.delete"
                        | "repo.apply_patch"
                        | "agent.propose"
                        | "agent.execute"
                ),
                requires_network: matches!(
                    name,
                    "run.execute" | "run.status" | "run.logs" | "agent.execute"
                ),
            })
        } else {
            None
        }
    }
}
