// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Bartek Kus
// Feature: AGENT_AUTOMATION
// Spec: spec/agent/automation.md

use crate::feature_tools::FeatureTools;
use crate::internal_client::InternalClient;
use crate::workspace::WorkspaceTools;
use agent::agent::AgentConfig;
use agent::executor::Executor;
use anyhow::{Result, anyhow};
use serde_json::{Value, json};
use std::path::Path;
use std::sync::Arc;

pub struct AgentTools {
    pub workspace: Arc<WorkspaceTools>,
    pub features: Arc<FeatureTools>,
}

impl AgentTools {
    pub fn new(workspace: Arc<WorkspaceTools>, features: Arc<FeatureTools>) -> Self {
        Self {
            workspace,
            features,
        }
    }

    pub fn propose(&self, repo_root: &Path, config: AgentConfig) -> Result<Value> {
        let root = repo_root.canonicalize()?;

        let changeset_path = agent::agent::generate_changeset(&root, config)?;
        let id = changeset_path
            .file_name()
            .and_then(|n| n.to_str())
            .ok_or_else(|| anyhow!("Invalid changeset path"))?;

        Ok(json!({
            "changeset_id": id,
            "path": changeset_path.to_string_lossy(),
            "status": "proposed"
        }))
    }

    pub fn execute(&self, repo_root: &Path, changeset_id: &str) -> Result<Value> {
        let root = repo_root.canonicalize()?;
        let changeset_path = root.join("changes").join(changeset_id);

        if !changeset_path.exists() {
            return Err(anyhow!("Changeset {} not found", changeset_id));
        }

        let client = InternalClient {
            repo_root: root.clone(),
            workspace: self.workspace.clone(),
            features: self.features.clone(),
        };

        Executor::execute(&changeset_path, &client)?;

        let walkthrough_path = changeset_path.join("04-walkthrough.md");
        let walkthrough = if walkthrough_path.exists() {
            std::fs::read_to_string(walkthrough_path)?
        } else {
            "No walkthrough generated".to_string()
        };

        Ok(json!({
            "changeset_id": changeset_id,
            "status": "executed",
            "walkthrough": walkthrough
        }))
    }

    pub fn verify(&self, repo_root: &Path, changeset_id: &str, profile: &str) -> Result<Value> {
        let root = repo_root.canonicalize()?;

        let client = InternalClient {
            repo_root: root.clone(),
            workspace: self.workspace.clone(),
            features: self.features.clone(),
        };

        let valid =
            agent::verification::engine::VerifyEngine::run(&root, changeset_id, profile, &client)?;

        Ok(json!({
            "changeset_id": changeset_id,
            "profile": profile,
            "valid": valid,
            "status": "verified"
        }))
    }
}
