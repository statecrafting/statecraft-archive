// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Bartek Kus
// Feature: AGENT_AUTOMATION
// Spec: spec/agent/automation.md

use crate::canonical::{json_sha256, to_canonical_json};
use crate::id::derive_changeset_id;
use crate::safety::{ToolTier, calculate_plan_tier};
use crate::schemas::*;
use anyhow::{Result, anyhow};
use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentConfig {
    pub subject: String,
    pub repo_key: String,
    pub base_state: String,
    pub goal: String,
    pub tasks: Vec<PlanTask>,
    pub tiers: Vec<String>,
    pub architecture_doc: String,
    pub base_state_created_at: String,
}

pub fn generate_changeset(root_dir: &Path, config: AgentConfig) -> Result<PathBuf> {
    validate_config(&config)?;

    let updates_dir = root_dir.join("changes");
    if !updates_dir.exists() {
        fs::create_dir_all(&updates_dir)?;
    }

    // 1. Derive ID
    let mut existing = Vec::new();
    // We tolerate if read_dir fails (e.g. permission), assume none.
    if let Ok(entries) = fs::read_dir(&updates_dir) {
        for entry in entries.flatten() {
            // Check if dir
            if entry.file_type().map(|t| t.is_dir()).unwrap_or(false)
                && let Ok(name) = entry.file_name().into_string()
            {
                existing.push(name);
            }
        }
    }

    let id = derive_changeset_id(&config.subject, &existing);
    let changeset_dir = updates_dir.join(&id);
    if !changeset_dir.exists() {
        fs::create_dir(&changeset_dir)?;
    }

    // 2. 01-architecture.md
    fs::write(
        changeset_dir.join("01-architecture.md"),
        &config.architecture_doc,
    )?;

    // 3. 02-implementation-plan.json
    let plan = ImplementationPlanV1 {
        schema_version: "v1".to_string(),
        goal: config.goal,
        tasks: config.tasks.clone(),
        tiers: config.tiers.clone(),
    };
    let plan_bytes = to_canonical_json(&plan)?;
    fs::write(
        changeset_dir.join("02-implementation-plan.json"),
        &plan_bytes,
    )?;
    let plan_sha256 = json_sha256(&plan)?;

    // 4. 03-task-list.md
    let task_list_md = generate_task_list_md(&plan);
    fs::write(changeset_dir.join("03-task-list.md"), task_list_md)?;

    // 5. 00-meta.json
    let meta = ChangesetMetaV1 {
        schema_version: "v1".to_string(),
        change_set_id: id.clone(),
        base_state_created_at: config.base_state_created_at,
        plan_sha256,
        repo_key: config.repo_key,
        base_state: config.base_state,
        intent: config.subject,
    };
    let meta_bytes = to_canonical_json(&meta)?;
    fs::write(changeset_dir.join("00-meta.json"), meta_bytes)?;

    Ok(changeset_dir)
}

fn validate_config(config: &AgentConfig) -> Result<()> {
    if config.subject.trim().is_empty() {
        return Err(anyhow!("Subject cannot be empty"));
    }
    if config.repo_key.trim().is_empty() {
        return Err(anyhow!("Repo key cannot be empty"));
    }
    if config.goal.trim().is_empty() {
        return Err(anyhow!("Goal cannot be empty"));
    }
    if config.tasks.is_empty() {
        return Err(anyhow!("Plan must have at least one task"));
    }

    // Tier Verification
    let calculated_tier = calculate_plan_tier(&config.tasks);
    let declared_tier = config
        .tiers
        .first()
        .and_then(|s| s.parse::<ToolTier>().ok())
        .ok_or_else(|| anyhow!("Invalid or missing tier declaration"))?;

    if calculated_tier > declared_tier {
        return Err(anyhow!(
            "Plan requires {} but declared {}. tools used exceed declared tier limits.",
            calculated_tier.as_str(),
            declared_tier.as_str()
        ));
    }

    Ok(())
}

fn generate_task_list_md(plan: &ImplementationPlanV1) -> String {
    let mut s = String::new();
    s.push_str(&format!("# Task List: {}\n\n", plan.goal));
    for task in &plan.tasks {
        s.push_str(&format!("- [ ] **{}**: {}\n", task.id, task.description));
        // Indent tool use for visibility
        for call in &task.tool_calls {
            s.push_str(&format!("  <!-- Tool: {} -->\n", call.tool_name));
        }
    }
    s
}
