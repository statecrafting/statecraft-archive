// SPDX-License-Identifier: AGPL-3.0-or-later
// Feature 052 Phase 6: Cross-module integration tests (crash resume + SSE replay + full stack).

use async_trait::async_trait;
use orchestrator::{
    AgentRegistry, DispatchOptions, DispatchRequest, DispatchResult, GovernedExecutor,
    PersistenceContext, StepExecutionStatus, WorkflowState, compute_resume_plan_from_state,
    state_file_path_for_run, write_workflow_state_atomic,
};
use orchestrator::{
    ArtifactManager, EventNotifier, LocalEventNotifier, SqliteWorkflowStore, WorkflowManifest,
    WorkflowStep, WorkflowStore, sqlite_db_path_for_run,
};
use serde_json::Value as JsonValue;
use std::collections::HashSet;
use std::sync::Arc;
use uuid::Uuid;

/// Integration-style verification that a workflow which has partially
/// completed can be resumed from the last completed step using the JSON
/// state backend.
#[test]
fn integration_052_crash_resume_from_state_file() {
    let tmp = tempfile::tempdir().unwrap();
    let artifact_base = ArtifactManager::new(tmp.path());
    let wf_id = Uuid::new_v4();

    // Three-step manifest with linear dependencies.
    let manifest = WorkflowManifest {
        steps: vec![
            WorkflowStep {
                id: "step-1".into(),
                agent: "agent-a".into(),
                effort: orchestrator::EffortLevel::Quick,
                inputs: vec![],
                outputs: vec!["out1.md".into()],
                instruction: "do 1".into(),
                gate: None,
                pre_verify: None,
                post_verify: None,
                max_retries: None,
            },
            WorkflowStep {
                id: "step-2".into(),
                agent: "agent-b".into(),
                effort: orchestrator::EffortLevel::Quick,
                inputs: vec!["step-1/out1.md".into()],
                outputs: vec!["out2.md".into()],
                instruction: "do 2".into(),
                gate: None,
                pre_verify: None,
                post_verify: None,
                max_retries: None,
            },
            WorkflowStep {
                id: "step-3".into(),
                agent: "agent-c".into(),
                effort: orchestrator::EffortLevel::Quick,
                inputs: vec!["step-2/out2.md".into()],
                outputs: vec!["out3.md".into()],
                instruction: "do 3".into(),
                gate: None,
                pre_verify: None,
                post_verify: None,
                max_retries: None,
            },
        ],
        project_id: None,
    };

    // Simulate a run where the first two steps have completed and a crash occurs
    // before the third step executes.
    let mut meta = serde_json::Map::new();
    meta.insert("branch".to_string(), JsonValue::from("main"));
    let mut state = WorkflowState::new(
        wf_id,
        "integration-052",
        "2026-03-31T10:00:00Z".to_string(),
        manifest
            .steps
            .iter()
            .map(|s| (s.id.clone(), s.instruction.clone())),
        meta,
    );
    state.mark_step_started("step-1", "2026-03-31T10:00:01Z".to_string());
    state.mark_step_finished(
        "step-1",
        StepExecutionStatus::Completed,
        "2026-03-31T10:00:05Z".to_string(),
        Some(4000),
        None,
    );
    state.mark_step_started("step-2", "2026-03-31T10:00:06Z".to_string());
    state.mark_step_finished(
        "step-2",
        StepExecutionStatus::Completed,
        "2026-03-31T10:00:10Z".to_string(),
        Some(4000),
        None,
    );

    let path = state_file_path_for_run(&artifact_base, wf_id);
    write_workflow_state_atomic(&path, &state).unwrap();

    // "Crash": drop in-memory state, then reload only from JSON state file and recompute plan.
    let loaded = orchestrator::load_workflow_state(&path).unwrap();
    let plan = compute_resume_plan_from_state(&loaded, &manifest).expect("expected resume plan");

    assert_eq!(
        plan.completed_step_ids,
        vec!["step-1".to_string(), "step-2".to_string()]
    );
    assert_eq!(plan.first_non_completed_step_index, 2);
}

/// Integration-style verification that events written through the SQLite
/// backend can be replayed via the LocalEventNotifier using the same workflow id.
#[tokio::test]
async fn integration_052_sse_replay_round_trip() {
    let tmp = tempfile::tempdir().unwrap();
    let artifact_base = ArtifactManager::new(tmp.path());
    let wf_id = Uuid::new_v4();

    // Seed a minimal workflow row so events satisfy the FK constraint.
    let state = WorkflowState::new(
        wf_id,
        "events-integration",
        "2026-03-31T00:00:00Z".to_string(),
        Vec::<(String, String)>::new(),
        serde_json::Map::new(),
    );
    let db_path = sqlite_db_path_for_run(&artifact_base, wf_id);
    let store = SqliteWorkflowStore::open(&db_path).expect("open sqlite store");
    store
        .write_workflow_state(&state)
        .await
        .expect("write initial workflow state");

    // Append a few events via the store.
    let e1 = store
        .append_event(
            wf_id,
            "step_started",
            &JsonValue::from("step-1"),
            Some("t1".to_string()),
        )
        .await
        .expect("append e1");
    let _e2 = store
        .append_event(
            wf_id,
            "step_completed",
            &JsonValue::from("step-1"),
            Some("t2".to_string()),
        )
        .await
        .expect("append e2");
    let e3 = store
        .append_event(
            wf_id,
            "step_started",
            &JsonValue::from("step-2"),
            Some("t3".to_string()),
        )
        .await
        .expect("append e3");

    assert!(e1 < e3);

    // Subscribe with replay from offset 0 and assert we see the full history.
    let notifier = LocalEventNotifier::new();
    let sub = notifier
        .subscribe_with_replay(&store, wf_id, 0)
        .await
        .expect("subscribe with replay");

    assert_eq!(sub.replay.len(), 3);
    assert_eq!(sub.replay[0].event_type, "step_started");
    assert_eq!(sub.replay[0].event_id, e1);
    assert_eq!(sub.replay[2].event_id, e3);
    assert_eq!(sub.high_water_mark, e3);
}

// --- Test helpers for full-stack 6D test ---

struct TestRegistry {
    agents: HashSet<String>,
}

#[async_trait]
impl AgentRegistry for TestRegistry {
    async fn has_agent(&self, agent_id: &str) -> bool {
        self.agents.contains(agent_id)
    }
}

struct TestExecutor {
    writes_outputs: bool,
}

#[async_trait]
impl GovernedExecutor for TestExecutor {
    async fn dispatch_step(&self, request: DispatchRequest) -> Result<DispatchResult, String> {
        if self.writes_outputs {
            for path in &request.output_artifacts {
                if let Some(parent) = path.parent() {
                    std::fs::create_dir_all(parent).unwrap();
                }
                std::fs::write(path, "ok").unwrap();
            }
        }
        Ok(DispatchResult {
            tokens_used: Some(100),
            output_hashes: std::collections::HashMap::new(),
            session_id: None,
            cost_usd: None,
            duration_ms: None,
            num_turns: None,
            governance_mode: None,
        })
    }
}

/// Full-stack integration test (P6C-004): manifest → dispatch_manifest_persisted →
/// state persisted to SQLite → events emitted → crash → resume plan → SSE replay
/// sees entire event history.
#[tokio::test]
async fn integration_052_full_stack_dispatch_persist_crash_resume_sse() {
    let tmp = tempfile::tempdir().unwrap();
    let artifact_base = ArtifactManager::new(tmp.path());
    let wf_id = Uuid::new_v4();

    // Materialize run dir so outputs can be written.
    orchestrator::materialize_run_directory(
        &artifact_base,
        wf_id,
        &WorkflowManifest {
            steps: vec![
                WorkflowStep {
                    id: "step-1".into(),
                    agent: "agent-a".into(),
                    effort: orchestrator::EffortLevel::Quick,
                    inputs: vec![],
                    outputs: vec!["out1.md".into()],
                    instruction: "do 1".into(),
                    gate: None,
                    pre_verify: None,
                    post_verify: None,
                    max_retries: None,
                },
                WorkflowStep {
                    id: "step-2".into(),
                    agent: "agent-a".into(),
                    effort: orchestrator::EffortLevel::Quick,
                    inputs: vec!["step-1/out1.md".into()],
                    outputs: vec!["out2.md".into()],
                    instruction: "do 2".into(),
                    gate: None,
                    pre_verify: None,
                    post_verify: None,
                    max_retries: None,
                },
                WorkflowStep {
                    id: "step-3".into(),
                    agent: "agent-a".into(),
                    effort: orchestrator::EffortLevel::Quick,
                    inputs: vec!["step-2/out2.md".into()],
                    outputs: vec!["out3.md".into()],
                    instruction: "do 3".into(),
                    gate: None,
                    pre_verify: None,
                    post_verify: None,
                    max_retries: None,
                },
            ],
            project_id: None,
        },
    )
    .unwrap();

    let manifest = WorkflowManifest {
        steps: vec![
            WorkflowStep {
                id: "step-1".into(),
                agent: "agent-a".into(),
                effort: orchestrator::EffortLevel::Quick,
                inputs: vec![],
                outputs: vec!["out1.md".into()],
                instruction: "do 1".into(),
                gate: None,
                pre_verify: None,
                post_verify: None,
                max_retries: None,
            },
            WorkflowStep {
                id: "step-2".into(),
                agent: "agent-a".into(),
                effort: orchestrator::EffortLevel::Quick,
                inputs: vec!["step-1/out1.md".into()],
                outputs: vec!["out2.md".into()],
                instruction: "do 2".into(),
                gate: None,
                pre_verify: None,
                post_verify: None,
                max_retries: None,
            },
            WorkflowStep {
                id: "step-3".into(),
                agent: "agent-a".into(),
                effort: orchestrator::EffortLevel::Quick,
                inputs: vec!["step-2/out2.md".into()],
                outputs: vec!["out3.md".into()],
                instruction: "do 3".into(),
                gate: None,
                pre_verify: None,
                post_verify: None,
                max_retries: None,
            },
        ],
        project_id: None,
    };

    let mut agents = HashSet::new();
    agents.insert("agent-a".to_string());
    let registry = Arc::new(TestRegistry { agents });
    let executor = Arc::new(TestExecutor {
        writes_outputs: true,
    });

    // Set up persistence with trait objects
    let db_path = sqlite_db_path_for_run(&artifact_base, wf_id);
    let store: Arc<dyn WorkflowStore> = Arc::new(SqliteWorkflowStore::open(&db_path).unwrap());
    let notifier: Arc<dyn EventNotifier> = Arc::new(LocalEventNotifier::new());

    let persistence = PersistenceContext {
        store: Arc::clone(&store),
        notifier: Arc::clone(&notifier),
    };

    // Dispatch with persistence
    let summary = orchestrator::dispatch_manifest_persisted(
        &artifact_base,
        wf_id,
        &manifest,
        registry,
        executor,
        &persistence,
        &DispatchOptions::default(),
    )
    .await
    .expect("dispatch should succeed");

    // Verify summary: all 3 steps succeeded
    assert_eq!(summary.steps.len(), 3);
    for step in &summary.steps {
        assert_eq!(
            format!("{:?}", step.status),
            "Success",
            "step {} should be Success",
            step.step_id
        );
        assert_eq!(step.tokens_used, Some(100));
    }

    // Verify SQLite state: workflow should be CompletedLocal (spec 097)
    // because no platform sync was performed — promotion requires events_synced + artifacts_recorded.
    let loaded = store
        .load_workflow_state(wf_id)
        .await
        .unwrap()
        .expect("state should exist");
    assert_eq!(loaded.status, orchestrator::WorkflowStatus::CompletedLocal);
    assert_eq!(loaded.steps.len(), 3);
    for step in &loaded.steps {
        assert_eq!(step.status, StepExecutionStatus::Completed);
    }

    // Verify events in SQLite: workflow_started + (step_started + step_completed) × 3 + workflow_completed = 8
    let events = store.load_events_since(wf_id, 0, None).await.unwrap();
    assert_eq!(
        events.len(),
        8,
        "expected 8 events (1 wf_started + 3×2 step events + 1 wf_completed)"
    );
    assert_eq!(events[0].event_type, "workflow_started");
    assert_eq!(events[1].event_type, "step_started");
    assert_eq!(events[2].event_type, "step_completed");
    assert_eq!(events[3].event_type, "step_started");
    assert_eq!(events[4].event_type, "step_completed");
    assert_eq!(events[5].event_type, "step_started");
    assert_eq!(events[6].event_type, "step_completed");
    assert_eq!(events[7].event_type, "workflow_completed");

    // Simulate crash: drop all in-memory state, re-open store, replay via SSE
    let db_path2 = sqlite_db_path_for_run(&artifact_base, wf_id);
    let store2 = SqliteWorkflowStore::open(&db_path2).unwrap();

    // Verify crash resume: state should show CompletedLocal (spec 097 — no platform sync)
    let loaded_after_crash = store2
        .load_workflow_state(wf_id)
        .await
        .unwrap()
        .expect("state after crash");
    assert_eq!(
        loaded_after_crash.status,
        orchestrator::WorkflowStatus::CompletedLocal
    );
    let plan = compute_resume_plan_from_state(&loaded_after_crash, &manifest);
    // All steps complete → resume plan skips everything (index past end).
    let plan = plan.expect("all steps completed should still yield a resume plan");
    assert_eq!(plan.completed_step_ids.len(), manifest.steps.len());
    assert_eq!(plan.first_non_completed_step_index, manifest.steps.len());

    // SSE replay from offset 0 should return full event history
    let notifier2 = LocalEventNotifier::new();
    let sub = notifier2
        .subscribe_with_replay(&store2, wf_id, 0)
        .await
        .expect("subscribe with replay after crash");
    assert_eq!(sub.replay.len(), 8);
    assert_eq!(sub.replay[0].event_type, "workflow_started");
    assert_eq!(sub.replay[7].event_type, "workflow_completed");

    // Partial offset replay
    let mid_offset = sub.replay[3].event_id;
    let sub2 = notifier2
        .subscribe_with_replay(&store2, wf_id, mid_offset)
        .await
        .expect("subscribe with partial offset");
    assert_eq!(sub2.replay.len(), 4);
}
