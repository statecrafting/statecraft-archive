// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Bartek Kus
// Feature: AGENT_AUTOMATION
// Spec: spec/agent/automation.md

use agent::agent::{AgentConfig, generate_changeset};
use agent::executor::Executor;
use agent::schemas::{LockFile, PlanTask, ToolCall};
use agent::validator::{McpClient, Validator};
use anyhow::Result;
use std::fs;

struct MockMcp {
    impact_result: String,
}

impl McpClient for MockMcp {
    fn preflight(&self, _mode: &str, _changed_paths: Vec<String>) -> Result<bool> {
        Ok(true)
    }
    fn drift(&self, _mode: &str) -> Result<bool> {
        Ok(false)
    }
    fn impact(&self, _mode: &str, _changed_paths: Vec<String>) -> Result<String> {
        Ok(self.impact_result.clone())
    }
    fn call_tool(&self, name: &str, _args: &serde_json::Value) -> Result<serde_json::Value> {
        Ok(serde_json::json!({"status": "executed", "tool": name}))
    }
    fn acquire_lease(&self) -> Result<String> {
        Ok("mock-lease".to_string())
    }
}

fn create_config() -> AgentConfig {
    let task = PlanTask {
        id: "task-1".to_string(),
        step_type: "edit".to_string(),
        description: "Do something".to_string(),
        tool_calls: vec![ToolCall {
            tool_name: "workspace.write_file".to_string(),
            arguments: serde_json::json!({"path": "foo.txt", "content": "aGVsbG8="}),
        }],
    };

    AgentConfig {
        subject: "Fix Bug".to_string(),
        repo_key: "github.com/owner/repo".to_string(),
        base_state: "abcdef123".to_string(),
        goal: "Fix the bug".to_string(),
        tasks: vec![task],
        tiers: vec!["tier2".to_string()],
        architecture_doc: "# Arch".to_string(),
        base_state_created_at: "2024-01-01T00:00:00Z".to_string(),
    }
}

#[test]
fn test_end_to_end_flow() -> Result<()> {
    let tmp_dir = tempfile::tempdir()?;
    let root = tmp_dir.path();
    let config = create_config();

    // Generate changesets
    let path1 = generate_changeset(root, config.clone())?;
    assert!(path1.exists());

    // Validate path1
    let mock = MockMcp {
        impact_result: "low".to_string(),
    };
    let status = Validator::validate(&path1, &mock)?;
    assert_eq!(status.state, "validated");

    // ASSERTION: 05-status.json must exist
    assert!(
        path1.join("05-status.json").exists(),
        "05-status.json should exist after validation"
    );

    // Execute
    fs::write(path1.join("APPROVED"), "")?;
    Executor::execute(&path1, &mock)?;

    // Verify status updated
    let status_bytes = fs::read(path1.join("05-status.json"))?;
    let final_status: agent::schemas::ChangesetStatusV1 = serde_json::from_slice(&status_bytes)?;

    assert_eq!(final_status.state, "executed");
    assert_eq!(final_status.execution.state, "completed");
    assert_eq!(final_status.execution.steps_completed, 1);

    // ASSERTION: 04-walkthrough.md exists
    assert!(
        path1.join("04-walkthrough.md").exists(),
        "04-walkthrough.md should exist after execution"
    );

    Ok(())
}

#[test]
fn test_multiple_tool_calls_counting() -> Result<()> {
    let tmp_dir = tempfile::tempdir()?;
    let root = tmp_dir.path();
    let mut config = create_config();
    // Modify task to have 2 tool calls
    config.tasks[0].tool_calls.push(ToolCall {
        tool_name: "workspace.write_file".to_string(),
        arguments: serde_json::json!({"path": "bar.txt", "content": "aGVsbG8="}),
    });

    let path = generate_changeset(root, config)?;
    let mock = MockMcp {
        impact_result: "low".to_string(),
    };

    fs::write(path.join("APPROVED"), "")?;
    Executor::execute(&path, &mock)?;

    let status_bytes = fs::read(path.join("05-status.json"))?;
    let final_status: agent::schemas::ChangesetStatusV1 = serde_json::from_slice(&status_bytes)?;

    assert_eq!(
        final_status.execution.steps_completed, 2,
        "Should count 2 tool calls"
    );
    Ok(())
}

#[test]
fn test_high_impact_requires_approval() -> Result<()> {
    let tmp_dir = tempfile::tempdir()?;
    let root = tmp_dir.path();
    let config = create_config();

    let path = generate_changeset(root, config)?;
    let mock = MockMcp {
        impact_result: "high".to_string(),
    };

    // Validate -> should show pending_review
    let status = Validator::validate(&path, &mock)?;
    assert_eq!(status.state, "pending_review");

    // Execute -> should fail without APPROVED
    let result = Executor::execute(&path, &mock);
    assert!(result.is_err());
    assert!(
        result
            .unwrap_err()
            .to_string()
            .contains("requires APPROVED marker")
    );

    // Add APPROVED
    fs::write(path.join("APPROVED"), "")?;

    // Execute -> should succeed
    Executor::execute(&path, &mock)?;
    Ok(())
}

#[test]
fn test_tier3_never_executes_even_with_approval() -> Result<()> {
    let tmp_dir = tempfile::tempdir()?;
    let root = tmp_dir.path();
    let mut config = create_config();
    config.tiers = vec!["tier3".to_string()];

    let path = generate_changeset(root, config)?;
    let mock = MockMcp {
        impact_result: "low".to_string(),
    };

    // Even if APPROVED exists, tier3 must never execute
    fs::write(path.join("APPROVED"), "")?;

    let result = Executor::execute(&path, &mock);
    assert!(result.is_err());
    assert!(
        result
            .unwrap_err()
            .to_string()
            .contains("Tier 3 changesets cannot be executed automatically")
    );

    Ok(())
}

struct StatefulMockMcp {
    pub drift_calls: std::cell::RefCell<usize>,
}

impl McpClient for StatefulMockMcp {
    fn preflight(&self, _mode: &str, _changed_paths: Vec<String>) -> Result<bool> {
        Ok(true)
    }
    fn drift(&self, _mode: &str) -> Result<bool> {
        let mut calls = self.drift_calls.borrow_mut();
        *calls += 1;
        // 1st call: Validator (false = no drift)
        // 2nd call: Executor post-check (true = drift detected)
        if *calls > 1 { Ok(true) } else { Ok(false) }
    }
    fn impact(&self, _mode: &str, _changed_paths: Vec<String>) -> Result<String> {
        Ok("low".to_string())
    }
    fn call_tool(&self, name: &str, _args: &serde_json::Value) -> Result<serde_json::Value> {
        Ok(serde_json::json!({"status": "executed", "tool": name}))
    }
    fn acquire_lease(&self) -> Result<String> {
        Ok("mock-lease".to_string())
    }
}

#[test]
fn test_post_execution_drift_failure() -> Result<()> {
    let tmp_dir = tempfile::tempdir()?;
    let root = tmp_dir.path();
    let config = create_config();

    let path = generate_changeset(root, config)?;
    let mock = StatefulMockMcp {
        drift_calls: std::cell::RefCell::new(0),
    };

    // Executor runs validation internally. validation check -> call 1 (false). execution... post-check -> call 2 (true).
    fs::write(path.join("APPROVED"), "")?;
    let result = Executor::execute(&path, &mock);

    assert!(result.is_err());
    assert!(
        result
            .unwrap_err()
            .to_string()
            .contains("Post-execution drift detected")
    );

    // Check 05-status.json
    let status_bytes = fs::read(path.join("05-status.json"))?;
    let status: agent::schemas::ChangesetStatusV1 = serde_json::from_slice(&status_bytes)?;

    assert_eq!(status.state, "failed");
    assert_eq!(
        status.execution.error,
        Some("Post-execution drift detected".to_string())
    );

    Ok(())
}

struct LockInspectionMcp {
    pub changeset_path: std::path::PathBuf,
    pub expected_created_at: String,
}

impl McpClient for LockInspectionMcp {
    fn preflight(&self, _mode: &str, _changed_paths: Vec<String>) -> Result<bool> {
        Ok(true)
    }
    fn drift(&self, _mode: &str) -> Result<bool> {
        Ok(false)
    }
    fn impact(&self, _mode: &str, _changed_paths: Vec<String>) -> Result<String> {
        Ok("low".to_string())
    }
    fn call_tool(&self, name: &str, _args: &serde_json::Value) -> Result<serde_json::Value> {
        // Inspect lockfile HERE, while it must exist
        let id = self.changeset_path.file_name().unwrap().to_str().unwrap();
        let lock_path = self
            .changeset_path
            .parent()
            .unwrap()
            .join(".locks")
            .join(id);

        assert!(lock_path.exists(), "Lockfile must exist during execution");

        let bytes = fs::read(&lock_path)?;
        let lock: LockFile = serde_json::from_slice(&bytes)?;

        assert_eq!(lock.change_set_id, id);
        assert_eq!(lock.base_state_created_at, self.expected_created_at);

        // Verify canonical encoding
        let canonical_bytes = agent::canonical::to_canonical_json(&lock)?;
        assert_eq!(
            bytes, canonical_bytes,
            "Lockfile on disk must match canonical JSON bytes"
        );

        Ok(serde_json::json!({"status": "executed", "tool": name}))
    }
    fn acquire_lease(&self) -> Result<String> {
        Ok("mock-lease".to_string())
    }
}

#[test]
fn test_lockfile_determinism() -> Result<()> {
    let tmp_dir = tempfile::tempdir()?;
    let root = tmp_dir.path();
    let config = create_config();
    let created_at = config.base_state_created_at.clone();

    let path = generate_changeset(root, config)?;
    let mock = LockInspectionMcp {
        changeset_path: path.clone(),
        expected_created_at: created_at,
    };

    // This will trigger call_tool, which checks the lockfile
    fs::write(path.join("APPROVED"), "")?;
    Executor::execute(&path, &mock)?;

    // Verify it's gone after
    let id = path.file_name().unwrap().to_str().unwrap();
    let lock_path = path.parent().unwrap().join(".locks").join(id);
    assert!(
        !lock_path.exists(),
        "Lockfile should be removed after execution"
    );

    Ok(())
}

#[test]
fn test_validation_empty_fields_fail() {
    let tmp_dir = tempfile::tempdir().unwrap();
    let root = tmp_dir.path();
    let mut config = create_config();
    config.subject = "".to_string();

    let result = generate_changeset(root, config);
    assert!(result.is_err());
    assert!(
        result
            .unwrap_err()
            .to_string()
            .contains("Subject cannot be empty")
    );
}

#[test]
fn test_validation_tier_mismatch_fails() {
    let tmp_dir = tempfile::tempdir().unwrap();
    let root = tmp_dir.path();
    let mut config = create_config();

    // Config claims Tier 1
    config.tiers = vec!["tier1".to_string()];

    // But uses 'write_file' which is Tier 2 (from create_config default task)
    // create_config uses write_file.

    let result = generate_changeset(root, config);
    assert!(result.is_err());
    let err_msg = result.unwrap_err().to_string();
    assert!(err_msg.contains("Plan requires tier2"));
    assert!(err_msg.contains("declared tier1"));
}

#[test]
fn test_validation_tier_correct_succeeds() -> Result<()> {
    let tmp_dir = tempfile::tempdir()?;
    let root = tmp_dir.path();
    let mut config = create_config();

    // Claim Tier 2 (create_config default matches this now, but let's be explicit if we override)
    config.tiers = vec!["tier2".to_string()];

    let path = generate_changeset(root, config)?;
    assert!(path.exists());
    Ok(())
}
