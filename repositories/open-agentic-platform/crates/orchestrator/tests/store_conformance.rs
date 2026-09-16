// SPDX-License-Identifier: AGPL-3.0-or-later
// Feature 052: Backend-agnostic conformance tests for WorkflowStore.
//
// These tests verify that any WorkflowStore implementation satisfies the
// contract expected by the orchestrator dispatch loop and SSE layer.
// Currently exercised against the local-sqlite backend; the hiqlite backend
// can be plugged in when a single-node cluster is available.

#[cfg(feature = "local-sqlite")]
mod sqlite_conformance {
    use orchestrator::{
        EventNotifier, LocalEventNotifier, PersistedEvent, SqliteWorkflowStore,
        StepExecutionStatus, WorkflowState, WorkflowStore,
    };
    use serde_json::Value as JsonValue;
    use uuid::Uuid;

    /// Helper: create a temp SQLite store.
    fn make_store() -> (tempfile::TempDir, SqliteWorkflowStore) {
        let tmp = tempfile::tempdir().unwrap();
        let db_path = tmp.path().join("conformance.sqlite");
        let store = SqliteWorkflowStore::open(&db_path).expect("open store");
        (tmp, store)
    }

    /// Helper: seed a workflow with the given steps.
    fn make_workflow(wf_id: Uuid, step_ids: &[(&str, &str)]) -> WorkflowState {
        WorkflowState::new(
            wf_id,
            "conformance-test",
            "2026-04-01T00:00:00Z".to_string(),
            step_ids
                .iter()
                .map(|(id, name)| (id.to_string(), name.to_string())),
            serde_json::Map::new(),
        )
    }

    // -----------------------------------------------------------------------
    // WorkflowStore conformance
    // -----------------------------------------------------------------------

    #[tokio::test]
    async fn write_and_load_round_trips_workflow() {
        let (_tmp, store) = make_store();
        let wf_id = Uuid::new_v4();
        let state = make_workflow(wf_id, &[("s1", "step-one"), ("s2", "step-two")]);

        store.write_workflow_state(&state).await.unwrap();
        let loaded = store.load_workflow_state(wf_id).await.unwrap().unwrap();

        assert_eq!(loaded.workflow_id, wf_id);
        assert_eq!(loaded.workflow_name, "conformance-test");
        assert_eq!(loaded.steps.len(), 2);
        assert_eq!(loaded.steps[0].id, "s1");
        assert_eq!(loaded.steps[1].id, "s2");
    }

    #[tokio::test]
    async fn load_nonexistent_workflow_returns_none() {
        let (_tmp, store) = make_store();
        let result = store.load_workflow_state(Uuid::new_v4()).await.unwrap();
        assert!(result.is_none());
    }

    #[tokio::test]
    async fn write_overwrites_previous_state() {
        let (_tmp, store) = make_store();
        let wf_id = Uuid::new_v4();

        let mut state = make_workflow(wf_id, &[("s1", "lint"), ("s2", "test")]);
        store.write_workflow_state(&state).await.unwrap();

        // Mark step 1 completed and update.
        state.mark_step_started("s1", "2026-04-01T00:01:00Z".to_string());
        state.mark_step_finished(
            "s1",
            StepExecutionStatus::Completed,
            "2026-04-01T00:02:00Z".to_string(),
            Some(1000),
            Some(serde_json::json!({"result": "ok"})),
        );
        store.write_workflow_state(&state).await.unwrap();

        let loaded = store.load_workflow_state(wf_id).await.unwrap().unwrap();
        assert_eq!(loaded.steps[0].status, StepExecutionStatus::Completed);
        assert!(loaded.steps[0].output.is_some());
    }

    #[tokio::test]
    async fn events_have_monotonically_increasing_ids() {
        let (_tmp, store) = make_store();
        let wf_id = Uuid::new_v4();
        store
            .write_workflow_state(&make_workflow(wf_id, &[]))
            .await
            .unwrap();

        let e1 = store
            .append_event(wf_id, "a", &JsonValue::Null, Some("t1".into()))
            .await
            .unwrap();
        let e2 = store
            .append_event(wf_id, "b", &JsonValue::Null, Some("t2".into()))
            .await
            .unwrap();
        let e3 = store
            .append_event(wf_id, "c", &JsonValue::Null, Some("t3".into()))
            .await
            .unwrap();

        assert!(e1 < e2, "event IDs must be monotonically increasing");
        assert!(e2 < e3, "event IDs must be monotonically increasing");
    }

    #[tokio::test]
    async fn load_events_respects_offset_and_limit() {
        let (_tmp, store) = make_store();
        let wf_id = Uuid::new_v4();
        store
            .write_workflow_state(&make_workflow(wf_id, &[]))
            .await
            .unwrap();

        let e1 = store
            .append_event(wf_id, "a", &JsonValue::from(1), Some("t1".into()))
            .await
            .unwrap();
        let e2 = store
            .append_event(wf_id, "b", &JsonValue::from(2), Some("t2".into()))
            .await
            .unwrap();
        let _e3 = store
            .append_event(wf_id, "c", &JsonValue::from(3), Some("t3".into()))
            .await
            .unwrap();

        // Offset: events after e1
        let after_e1 = store.load_events_since(wf_id, e1, None).await.unwrap();
        assert_eq!(after_e1.len(), 2);
        assert_eq!(after_e1[0].event_id, e2);

        // Limit: first 1 event only
        let first_one = store.load_events_since(wf_id, 0, Some(1)).await.unwrap();
        assert_eq!(first_one.len(), 1);
        assert_eq!(first_one[0].event_id, e1);
    }

    #[tokio::test]
    async fn events_are_isolated_by_workflow() {
        let (_tmp, store) = make_store();
        let wf_a = Uuid::new_v4();
        let wf_b = Uuid::new_v4();
        store
            .write_workflow_state(&make_workflow(wf_a, &[]))
            .await
            .unwrap();
        store
            .write_workflow_state(&make_workflow(wf_b, &[]))
            .await
            .unwrap();

        store
            .append_event(wf_a, "a_event", &JsonValue::Null, Some("t1".into()))
            .await
            .unwrap();
        store
            .append_event(wf_b, "b_event", &JsonValue::Null, Some("t2".into()))
            .await
            .unwrap();

        let a_events = store.load_events_since(wf_a, 0, None).await.unwrap();
        assert_eq!(a_events.len(), 1);
        assert_eq!(a_events[0].event_type, "a_event");

        let b_events = store.load_events_since(wf_b, 0, None).await.unwrap();
        assert_eq!(b_events.len(), 1);
        assert_eq!(b_events[0].event_type, "b_event");
    }

    #[tokio::test]
    async fn event_payload_round_trips_json() {
        let (_tmp, store) = make_store();
        let wf_id = Uuid::new_v4();
        store
            .write_workflow_state(&make_workflow(wf_id, &[]))
            .await
            .unwrap();

        let complex_payload = serde_json::json!({
            "step_id": "step-1",
            "nested": { "key": "value", "count": 42 },
            "array": [1, 2, 3]
        });

        store
            .append_event(wf_id, "complex", &complex_payload, Some("t1".into()))
            .await
            .unwrap();

        let events = store.load_events_since(wf_id, 0, None).await.unwrap();
        assert_eq!(events[0].payload, complex_payload);
    }

    // -----------------------------------------------------------------------
    // EventNotifier conformance
    // -----------------------------------------------------------------------

    #[tokio::test]
    async fn notifier_replay_returns_historical_events() {
        let (_tmp, store) = make_store();
        let notifier = LocalEventNotifier::new();
        let wf_id = Uuid::new_v4();
        store
            .write_workflow_state(&make_workflow(wf_id, &[]))
            .await
            .unwrap();

        // Append events to the store.
        for i in 1..=3 {
            store
                .append_event(
                    wf_id,
                    &format!("evt_{i}"),
                    &JsonValue::from(i as i64),
                    Some(format!("t{i}")),
                )
                .await
                .unwrap();
        }

        let sub = notifier
            .subscribe_with_replay(&store, wf_id, 0)
            .await
            .unwrap();

        assert_eq!(sub.replay.len(), 3);
        assert_eq!(sub.replay[0].event_type, "evt_1");
        assert_eq!(sub.replay[2].event_type, "evt_3");
        assert_eq!(sub.high_water_mark, sub.replay[2].event_id);
    }

    #[tokio::test]
    async fn notifier_live_events_received_after_subscribe() {
        let (_tmp, store) = make_store();
        let notifier = LocalEventNotifier::new();
        let wf_id = Uuid::new_v4();
        store
            .write_workflow_state(&make_workflow(wf_id, &[]))
            .await
            .unwrap();

        let mut sub = notifier
            .subscribe_with_replay(&store, wf_id, 0)
            .await
            .unwrap();

        // Notify after subscribing.
        let event = PersistedEvent {
            event_id: 100,
            workflow_id: wf_id,
            timestamp: "t1".into(),
            event_type: "live_event".into(),
            payload: JsonValue::String("hello".into()),
            scope: None,
        };
        notifier.notify(wf_id, event).await;

        let received = sub.subscriber.recv().await.unwrap();
        assert_eq!(received.event_type, "live_event");
        assert_eq!(received.event_id, 100);
    }

    #[tokio::test]
    async fn notifier_high_water_mark_enables_dedup() {
        let (_tmp, store) = make_store();
        let notifier = LocalEventNotifier::new();
        let wf_id = Uuid::new_v4();
        store
            .write_workflow_state(&make_workflow(wf_id, &[]))
            .await
            .unwrap();

        let e1 = store
            .append_event(wf_id, "old", &JsonValue::Null, Some("t1".into()))
            .await
            .unwrap();

        let sub = notifier
            .subscribe_with_replay(&store, wf_id, 0)
            .await
            .unwrap();

        // The high_water_mark should be e1.
        assert_eq!(sub.high_water_mark, e1);

        // A new event with event_id > high_water_mark should be kept.
        // A duplicate with event_id <= high_water_mark should be skipped.
        // (The dedup logic is in the consumer — http.rs — but the contract
        // is that high_water_mark is set correctly.)
        assert_eq!(sub.replay.len(), 1);
    }
}
