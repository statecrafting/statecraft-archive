// SPDX-License-Identifier: AGPL-3.0-or-later
// Feature 052 Phase 5: SSE event broadcaster with offset-based replay.
//
// This module re-exports the trait-based event notification types from
// `store` and `sqlite_state`. The concrete `LocalEventNotifier` implements
// the `EventNotifier` trait and satisfies:
//   FR-006  — live + replay streaming of workflow events
//   NF-002  — ≥ 50 concurrent subscribers per workflow
//   SC-004  — offset=0 yields all historical events then live

// Re-export the trait-based types for backward compatibility.
pub use crate::sqlite_state::{LocalEventNotifier, SqliteWorkflowStore};
pub use crate::store::{
    EventNotifier, EventReceiver, PersistedEvent, ReplaySubscription, WorkflowStore,
};

#[cfg(test)]
mod tests {
    use super::*;
    use crate::state::WorkflowState;
    use serde_json::Value as JsonValue;
    use uuid::Uuid;

    /// Helper: open a temp SQLite store and seed a workflow row.
    async fn setup_store_with_workflow() -> (tempfile::TempDir, SqliteWorkflowStore, Uuid) {
        let tmp = tempfile::tempdir().unwrap();
        let db_path = tmp.path().join("state.sqlite");
        let store = SqliteWorkflowStore::open(&db_path).expect("open store");
        let wf_id = Uuid::new_v4();
        let state = WorkflowState::new(
            wf_id,
            "sse-test",
            "2026-03-31T00:00:00Z".to_string(),
            Vec::<(String, String)>::new(),
            serde_json::Map::new(),
        );
        store
            .write_workflow_state(&state)
            .await
            .expect("seed workflow");
        (tmp, store, wf_id)
    }

    #[tokio::test]
    async fn broadcast_with_no_subscribers_returns_no_error() {
        let notifier = LocalEventNotifier::new();
        let event = PersistedEvent {
            event_id: 1,
            workflow_id: Uuid::new_v4(),
            timestamp: "1".to_string(),
            event_type: "step_started".to_string(),
            payload: JsonValue::String("test".to_string()),
            scope: None,
        };
        // Should not panic or error with zero subscribers.
        notifier.notify(event.workflow_id, event).await;
    }

    #[tokio::test]
    async fn live_subscriber_receives_broadcast_events() {
        let (_tmp, store, wf_id) = setup_store_with_workflow().await;
        let notifier = LocalEventNotifier::new();

        // Subscribe first (replay from 0, no history).
        let mut sub = notifier
            .subscribe_with_replay(&store, wf_id, 0)
            .await
            .expect("subscribe");
        assert!(sub.replay.is_empty());

        let event = PersistedEvent {
            event_id: 42,
            workflow_id: wf_id,
            timestamp: "1".to_string(),
            event_type: "step_completed".to_string(),
            payload: JsonValue::String("done".to_string()),
            scope: None,
        };
        notifier.notify(wf_id, event.clone()).await;

        let received = sub.subscriber.recv().await.expect("recv");
        assert_eq!(received.event_id, 42);
        assert_eq!(received.event_type, "step_completed");
    }

    #[tokio::test]
    async fn subscribe_with_replay_returns_historical_events() {
        let (_tmp, store, wf_id) = setup_store_with_workflow().await;
        let notifier = LocalEventNotifier::new();

        // Append 3 events to store.
        for i in 1..=3 {
            store
                .append_event(
                    wf_id,
                    &format!("event_{i}"),
                    &JsonValue::from(i as i64),
                    Some(format!("t{i}")),
                )
                .await
                .expect("append");
        }

        let sub = notifier
            .subscribe_with_replay(&store, wf_id, 0)
            .await
            .expect("replay");

        assert_eq!(sub.replay.len(), 3);
        assert_eq!(sub.replay[0].event_type, "event_1");
        assert_eq!(sub.replay[2].event_type, "event_3");
        assert_eq!(sub.high_water_mark, sub.replay[2].event_id);
    }

    #[tokio::test]
    async fn subscribe_with_replay_partial_offset() {
        let (_tmp, store, wf_id) = setup_store_with_workflow().await;
        let notifier = LocalEventNotifier::new();

        let e1 = store
            .append_event(wf_id, "a", &JsonValue::Null, Some("t1".to_string()))
            .await
            .expect("append");
        let _e2 = store
            .append_event(wf_id, "b", &JsonValue::Null, Some("t2".to_string()))
            .await
            .expect("append");
        let e3 = store
            .append_event(wf_id, "c", &JsonValue::Null, Some("t3".to_string()))
            .await
            .expect("append");

        // Replay from after e1 — should get e2 and e3.
        let sub = notifier
            .subscribe_with_replay(&store, wf_id, e1)
            .await
            .expect("replay");

        assert_eq!(sub.replay.len(), 2);
        assert_eq!(sub.replay[0].event_type, "b");
        assert_eq!(sub.replay[1].event_type, "c");
        assert_eq!(sub.high_water_mark, e3);
    }

    #[tokio::test]
    async fn subscribe_with_replay_empty_history() {
        let (_tmp, store, wf_id) = setup_store_with_workflow().await;
        let notifier = LocalEventNotifier::new();

        let sub = notifier
            .subscribe_with_replay(&store, wf_id, 0)
            .await
            .expect("replay");

        assert!(sub.replay.is_empty());
        assert_eq!(sub.high_water_mark, 0);
    }

    #[tokio::test]
    async fn replay_then_live_deduplication_pattern() {
        let (_tmp, store, wf_id) = setup_store_with_workflow().await;
        let notifier = LocalEventNotifier::new();

        // Append 2 events before subscribing.
        store
            .append_event(wf_id, "old_1", &JsonValue::Null, Some("t1".to_string()))
            .await
            .expect("append");
        let e2 = store
            .append_event(wf_id, "old_2", &JsonValue::Null, Some("t2".to_string()))
            .await
            .expect("append");

        let mut sub = notifier
            .subscribe_with_replay(&store, wf_id, 0)
            .await
            .expect("replay");

        assert_eq!(sub.replay.len(), 2);
        let hwm = sub.high_water_mark;
        assert_eq!(hwm, e2);

        // Simulate: notifier sends a duplicate (e2) and a new event (e3).
        let dup_event = PersistedEvent {
            event_id: e2,
            workflow_id: wf_id,
            timestamp: "t2".to_string(),
            event_type: "old_2".to_string(),
            payload: JsonValue::Null,
            scope: None,
        };
        notifier.notify(wf_id, dup_event).await;

        let new_event = PersistedEvent {
            event_id: e2 + 1,
            workflow_id: wf_id,
            timestamp: "t3".to_string(),
            event_type: "new_3".to_string(),
            payload: JsonValue::Null,
            scope: None,
        };
        notifier.notify(wf_id, new_event).await;

        // Consumer pattern: skip events <= high_water_mark.
        let live1 = sub.subscriber.recv().await.expect("recv");
        assert!(live1.event_id <= hwm, "should be dedup'd");

        let live2 = sub.subscriber.recv().await.expect("recv");
        assert!(live2.event_id > hwm);
        assert_eq!(live2.event_type, "new_3");
    }

    #[tokio::test]
    async fn cross_workflow_isolation_in_replay() {
        let (_tmp, store, wf_a) = setup_store_with_workflow().await;
        let notifier = LocalEventNotifier::new();

        // Create a second workflow.
        let wf_b = Uuid::new_v4();
        let state_b = WorkflowState::new(
            wf_b,
            "other",
            "2026-03-31T00:00:00Z".to_string(),
            Vec::<(String, String)>::new(),
            serde_json::Map::new(),
        );
        store
            .write_workflow_state(&state_b)
            .await
            .expect("seed wf_b");

        // Append events to both workflows.
        store
            .append_event(wf_a, "a_event", &JsonValue::Null, Some("t1".to_string()))
            .await
            .expect("append a");
        store
            .append_event(wf_b, "b_event", &JsonValue::Null, Some("t2".to_string()))
            .await
            .expect("append b");

        // Replay for workflow A should only see A's events.
        let sub_a = notifier
            .subscribe_with_replay(&store, wf_a, 0)
            .await
            .expect("replay a");
        assert_eq!(sub_a.replay.len(), 1);
        assert_eq!(sub_a.replay[0].event_type, "a_event");

        // Replay for workflow B should only see B's events.
        let sub_b = notifier
            .subscribe_with_replay(&store, wf_b, 0)
            .await
            .expect("replay b");
        assert_eq!(sub_b.replay.len(), 1);
        assert_eq!(sub_b.replay[0].event_type, "b_event");
    }
}
