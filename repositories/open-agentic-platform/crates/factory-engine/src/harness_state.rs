// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Bartek Kus
// Spec: specs/075-factory-workflow-engine/spec.md — FR-010

//! Pipeline state manager — durable execution state for crash recovery.
//!
//! Manages the on-disk `.factory/pipeline-state.json` file using the typed
//! `PipelineState` struct from `factory-contracts`.

use chrono::Utc;
use factory_contracts::pipeline_state::{
    AdapterInfo, AuditEntry, AuditEvent, BuildSpecInfo, ErrorEntry, ErrorType, Gate,
    OperationCompleted, OperationFailure, PageCompleted, PageFailure, PipelineIdentity,
    PipelineState, PipelineStatus, ScaffoldingApi, ScaffoldingConfigure, ScaffoldingData,
    ScaffoldingProgress, ScaffoldingStatus, ScaffoldingTrim, ScaffoldingUi, StageEntry,
    StageStatus, VerificationResults,
};
use std::collections::HashMap;
use std::path::Path;
use uuid::Uuid;

/// Create a fresh pipeline-state.json and write it to disk.
pub fn init_state(
    adapter_name: &str,
    adapter_version: &str,
    build_spec_path: &str,
    build_spec_hash: &str,
    state_path: &Path,
) -> std::io::Result<PipelineState> {
    let now = Utc::now();
    let state = PipelineState {
        schema_version: "1.0.0".into(),
        pipeline: PipelineIdentity {
            id: Uuid::new_v4().to_string(),
            factory_version: "0.1.0".into(),
            started_at: now,
            updated_at: now,
            completed_at: None,
            status: PipelineStatus::Running,
            adapter: AdapterInfo {
                name: adapter_name.into(),
                version: adapter_version.into(),
            },
            build_spec: BuildSpecInfo {
                path: build_spec_path.into(),
                hash: build_spec_hash.into(),
            },
        },
        stages: HashMap::new(),
        scaffolding: Some(ScaffoldingProgress {
            data: ScaffoldingData {
                status: ScaffoldingStatus::Pending,
                entities_completed: vec![],
                entities_remaining: vec![],
                entities_failed: vec![],
            },
            api: ScaffoldingApi {
                status: ScaffoldingStatus::Pending,
                operations_completed: vec![],
                operations_remaining: vec![],
                operations_failed: vec![],
            },
            ui: ScaffoldingUi {
                status: ScaffoldingStatus::Pending,
                pages_completed: vec![],
                pages_remaining: vec![],
                pages_failed: vec![],
            },
            configure: ScaffoldingConfigure {
                status: ScaffoldingStatus::Pending,
                steps_completed: vec![],
            },
            trim: ScaffoldingTrim {
                status: ScaffoldingStatus::Pending,
                files_removed: vec![],
            },
        }),
        verification: Some(VerificationResults {
            last_full_run: None,
            consistency: vec![],
        }),
        errors: vec![],
        audit: vec![],
    };

    write_state(&state, state_path)?;
    Ok(state)
}

/// Load existing pipeline state, or None if not found.
pub fn load_state(state_path: &Path) -> Option<PipelineState> {
    let content = std::fs::read_to_string(state_path).ok()?;
    serde_json::from_str(&content).ok()
}

/// Persist state to disk, updating the `updated_at` timestamp.
pub fn save_state(state: &mut PipelineState, state_path: &Path) -> std::io::Result<()> {
    state.pipeline.updated_at = Utc::now();
    write_state(state, state_path)
}

/// Update a stage's status, artifacts, and gate results.
pub fn update_stage(
    state: &mut PipelineState,
    stage_id: &str,
    status: StageStatus,
    artifacts: Option<Vec<factory_contracts::pipeline_state::StageArtifact>>,
    gate: Option<Gate>,
) {
    let stage = state
        .stages
        .entry(stage_id.to_string())
        .or_insert_with(|| StageEntry {
            status: StageStatus::Pending,
            started_at: None,
            completed_at: None,
            artifacts: vec![],
            gate: None,
            agent: None,
        });

    if status == StageStatus::InProgress && stage.started_at.is_none() {
        stage.started_at = Some(Utc::now());
    }
    if status == StageStatus::Completed || status == StageStatus::Failed {
        stage.completed_at = Some(Utc::now());
    }

    stage.status = status;

    if let Some(arts) = artifacts {
        stage.artifacts = arts;
    }
    if let Some(g) = gate {
        stage.gate = Some(g);
    }
}

/// Mark an API operation as successfully scaffolded.
pub fn record_operation_completed(
    state: &mut PipelineState,
    operation_id: &str,
    files_created: Vec<String>,
) {
    if let Some(ref mut scaffolding) = state.scaffolding {
        scaffolding
            .api
            .operations_completed
            .push(OperationCompleted {
                operation_id: operation_id.into(),
                files_created,
                verified_at: Some(Utc::now()),
            });
        scaffolding
            .api
            .operations_remaining
            .retain(|id| id != operation_id);
    }
}

/// Mark an API operation as failed after max retries.
pub fn record_operation_failed(
    state: &mut PipelineState,
    operation_id: &str,
    error: &str,
    retries: u32,
    max_retries: u32,
) {
    if let Some(ref mut scaffolding) = state.scaffolding {
        scaffolding.api.operations_failed.push(OperationFailure {
            operation_id: operation_id.into(),
            error: error.into(),
            retries,
            max_retries,
        });
        scaffolding
            .api
            .operations_remaining
            .retain(|id| id != operation_id);
    }
}

/// Mark a UI page as successfully scaffolded.
pub fn record_page_completed(state: &mut PipelineState, page_id: &str, files_created: Vec<String>) {
    if let Some(ref mut scaffolding) = state.scaffolding {
        scaffolding.ui.pages_completed.push(PageCompleted {
            page_id: page_id.into(),
            files_created,
            verified_at: Some(Utc::now()),
        });
        scaffolding.ui.pages_remaining.retain(|id| id != page_id);
    }
}

/// Mark a UI page as failed after max retries.
pub fn record_page_failed(
    state: &mut PipelineState,
    page_id: &str,
    error: &str,
    retries: u32,
    max_retries: u32,
) {
    if let Some(ref mut scaffolding) = state.scaffolding {
        scaffolding.ui.pages_failed.push(PageFailure {
            page_id: page_id.into(),
            error: error.into(),
            retries,
            max_retries,
        });
        scaffolding.ui.pages_remaining.retain(|id| id != page_id);
    }
}

/// Check if an operation has already been scaffolded (for resume).
pub fn is_operation_done(state: &PipelineState, operation_id: &str) -> bool {
    state
        .scaffolding
        .as_ref()
        .map(|s| {
            s.api
                .operations_completed
                .iter()
                .any(|op| op.operation_id == operation_id)
        })
        .unwrap_or(false)
}

/// Check if a page has already been scaffolded (for resume).
pub fn is_page_done(state: &PipelineState, page_id: &str) -> bool {
    state
        .scaffolding
        .as_ref()
        .map(|s| s.ui.pages_completed.iter().any(|p| p.page_id == page_id))
        .unwrap_or(false)
}

/// Append to the persistent error log.
pub fn record_error(
    state: &mut PipelineState,
    stage: &str,
    error_type: ErrorType,
    message: &str,
    feature: Option<&str>,
    retry_number: u32,
) {
    state.errors.push(ErrorEntry {
        timestamp: Utc::now(),
        stage: Some(stage.into()),
        feature: feature.map(String::from),
        error_type,
        message: message.into(),
        retry_number: Some(retry_number),
        resolved: false,
    });
}

/// Record a human confirmation or override.
pub fn record_audit(
    state: &mut PipelineState,
    event: AuditEvent,
    stage: &str,
    details: Option<&str>,
) {
    state.audit.push(AuditEntry {
        timestamp: Utc::now(),
        event,
        stage: Some(stage.into()),
        details: details.map(String::from),
    });
}

/// Construct a `StageArtifact` with a SHA-256 hash of the file content (082 FR-005).
///
/// This ensures that the `hash` field in `StageArtifact` is always populated
/// with the artifact's content hash, enabling downstream integrity verification.
pub fn make_hashed_artifact(
    path: &std::path::Path,
    artifact_type: &str,
) -> std::io::Result<factory_contracts::pipeline_state::StageArtifact> {
    let hash = crate::preflight::hash_file(path)?;
    Ok(factory_contracts::pipeline_state::StageArtifact {
        path: path.display().to_string(),
        artifact_type: artifact_type.into(),
        hash,
    })
}

/// Mark the pipeline as completed or failed.
pub fn complete_pipeline(state: &mut PipelineState, success: bool) {
    state.pipeline.status = if success {
        PipelineStatus::Completed
    } else {
        PipelineStatus::Failed
    };
    state.pipeline.completed_at = Some(Utc::now());
}

fn write_state(state: &PipelineState, path: &Path) -> std::io::Result<()> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let json = serde_json::to_string_pretty(state)?;
    std::fs::write(path, json)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[test]
    fn init_creates_file() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join(".factory/pipeline-state.json");
        let state = init_state("acme-vue-encore", "1.0.0", "spec.yaml", "abc123", &path).unwrap();
        assert!(path.exists());
        assert_eq!(state.pipeline.status, PipelineStatus::Running);
        assert!(!state.pipeline.id.is_empty());
    }

    #[test]
    fn load_state_returns_none_for_missing() {
        let dir = TempDir::new().unwrap();
        assert!(load_state(&dir.path().join("nope.json")).is_none());
    }

    #[test]
    fn load_state_roundtrip() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("state.json");
        let state = init_state("test", "1.0", "spec.yaml", "hash", &path).unwrap();
        let loaded = load_state(&path).unwrap();
        assert_eq!(loaded.pipeline.id, state.pipeline.id);
    }

    #[test]
    fn save_updates_timestamp() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("state.json");
        let mut state = init_state("test", "1.0", "spec.yaml", "hash", &path).unwrap();
        let before = state.pipeline.updated_at;
        std::thread::sleep(std::time::Duration::from_millis(10));
        save_state(&mut state, &path).unwrap();
        assert!(state.pipeline.updated_at > before);
    }

    #[test]
    fn update_stage_sets_timestamps() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("state.json");
        let mut state = init_state("test", "1.0", "spec.yaml", "hash", &path).unwrap();

        update_stage(&mut state, "s1", StageStatus::InProgress, None, None);
        assert!(state.stages["s1"].started_at.is_some());
        assert!(state.stages["s1"].completed_at.is_none());

        update_stage(&mut state, "s1", StageStatus::Completed, None, None);
        assert!(state.stages["s1"].completed_at.is_some());
    }

    #[test]
    fn record_operation_completed_and_check() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("state.json");
        let mut state = init_state("test", "1.0", "spec.yaml", "hash", &path).unwrap();

        // Add to remaining first
        if let Some(ref mut s) = state.scaffolding {
            s.api.operations_remaining.push("create-user".into());
        }

        record_operation_completed(&mut state, "create-user", vec!["api/users.ts".into()]);
        assert!(is_operation_done(&state, "create-user"));
        assert!(!is_operation_done(&state, "delete-user"));

        // Verify removed from remaining
        let remaining = &state.scaffolding.as_ref().unwrap().api.operations_remaining;
        assert!(!remaining.contains(&"create-user".to_string()));
    }

    #[test]
    fn record_operation_failed_removes_from_remaining() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("state.json");
        let mut state = init_state("test", "1.0", "spec.yaml", "hash", &path).unwrap();

        if let Some(ref mut s) = state.scaffolding {
            s.api.operations_remaining.push("bad-op".into());
        }

        record_operation_failed(&mut state, "bad-op", "compile error", 3, 3);
        let api = &state.scaffolding.as_ref().unwrap().api;
        assert!(!api.operations_remaining.contains(&"bad-op".to_string()));
        assert_eq!(api.operations_failed.len(), 1);
    }

    #[test]
    fn record_page_completed_and_check() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("state.json");
        let mut state = init_state("test", "1.0", "spec.yaml", "hash", &path).unwrap();

        record_page_completed(&mut state, "dashboard", vec!["pages/dashboard.vue".into()]);
        assert!(is_page_done(&state, "dashboard"));
        assert!(!is_page_done(&state, "settings"));
    }

    #[test]
    fn record_error_appends() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("state.json");
        let mut state = init_state("test", "1.0", "spec.yaml", "hash", &path).unwrap();

        record_error(&mut state, "s3", ErrorType::Compile, "type error", None, 0);
        record_error(
            &mut state,
            "s3",
            ErrorType::Compile,
            "type error",
            Some("create-user"),
            1,
        );
        assert_eq!(state.errors.len(), 2);
        assert_eq!(state.errors[1].retry_number, Some(1));
    }

    #[test]
    fn complete_pipeline_success() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("state.json");
        let mut state = init_state("test", "1.0", "spec.yaml", "hash", &path).unwrap();

        complete_pipeline(&mut state, true);
        assert_eq!(state.pipeline.status, PipelineStatus::Completed);
        assert!(state.pipeline.completed_at.is_some());
    }

    #[test]
    fn complete_pipeline_failure() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("state.json");
        let mut state = init_state("test", "1.0", "spec.yaml", "hash", &path).unwrap();

        complete_pipeline(&mut state, false);
        assert_eq!(state.pipeline.status, PipelineStatus::Failed);
        assert!(state.pipeline.completed_at.is_some());
    }
}
