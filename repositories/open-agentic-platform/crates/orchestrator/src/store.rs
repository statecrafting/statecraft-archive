// SPDX-License-Identifier: AGPL-3.0-or-later
// Feature 052: Storage trait abstractions for workflow state and event backends.
//
// These traits decouple the orchestrator dispatch loop and SSE layer from any
// concrete database implementation. The default backend is local SQLite
// (`SqliteWorkflowStore`); a distributed backend backed by hiqlite can be
// swapped in via the `distributed` feature flag.

use crate::OrchestratorError;
use crate::state::WorkflowState;
use async_trait::async_trait;
use serde_json::Value as JsonValue;
use uuid::Uuid;

/// Persisted workflow event row.
///
/// These rows are append-only (monotonically increasing `event_id`) and can be
/// consumed by higher-level SSE servers to provide offset-based replay.
///
/// The `scope` field distinguishes between event domains (e.g. `"workflow"` vs
/// `"conversation"`).  Legacy rows that pre-date the scope column will have
/// `scope = None` and are treated as `"workflow"` events.
#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
pub struct PersistedEvent {
    pub event_id: i64,
    pub workflow_id: Uuid,
    pub timestamp: String,
    pub event_type: String,
    pub payload: JsonValue,
    /// Event scope: `"workflow"`, `"conversation"`, or `None` for legacy rows.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub scope: Option<String>,
}

// ---------------------------------------------------------------------------
// WorkflowStore — persistence for workflow state and events
// ---------------------------------------------------------------------------

/// Backend-agnostic persistence for workflow state and append-only events.
///
/// Implementations must be `Send + Sync` so they can be shared behind an
/// `Arc<dyn WorkflowStore>` across the async dispatch loop and HTTP server.
#[async_trait]
pub trait WorkflowStore: Send + Sync {
    /// Upserts the full workflow state (workflow row + all step rows).
    async fn write_workflow_state(&self, state: &WorkflowState) -> Result<(), OrchestratorError>;

    /// Loads workflow state by ID. Returns `Ok(None)` if no row exists.
    async fn load_workflow_state(
        &self,
        workflow_id: Uuid,
    ) -> Result<Option<WorkflowState>, OrchestratorError>;

    /// Appends an event row and returns its monotonically-increasing event ID.
    async fn append_event(
        &self,
        workflow_id: Uuid,
        event_type: &str,
        payload: &JsonValue,
        timestamp: Option<String>,
    ) -> Result<i64, OrchestratorError>;

    /// Loads events with `event_id > from_event_id`, ordered ascending.
    async fn load_events_since(
        &self,
        workflow_id: Uuid,
        from_event_id: i64,
        limit: Option<u32>,
    ) -> Result<Vec<PersistedEvent>, OrchestratorError>;

    /// Appends a scoped event row and returns its monotonically-increasing event ID.
    ///
    /// The `scope` parameter distinguishes event domains (e.g. `"workflow"` vs
    /// `"conversation"`).  The `entity_id` is stored in the `workflow_id` column
    /// for backward compatibility.
    async fn append_scoped_event(
        &self,
        entity_id: Uuid,
        _scope: &str,
        event_type: &str,
        payload: &JsonValue,
        timestamp: Option<String>,
    ) -> Result<i64, OrchestratorError> {
        // Default implementation delegates to append_event (ignoring scope).
        self.append_event(entity_id, event_type, payload, timestamp)
            .await
    }

    /// Loads scoped events with `event_id > from_event_id`, filtered by scope.
    async fn load_scoped_events_since(
        &self,
        entity_id: Uuid,
        _scope: &str,
        from_event_id: i64,
        limit: Option<u32>,
    ) -> Result<Vec<PersistedEvent>, OrchestratorError> {
        // Default implementation delegates to load_events_since (ignoring scope).
        self.load_events_since(entity_id, from_event_id, limit)
            .await
    }
}

// ---------------------------------------------------------------------------
// EventNotifier — multi-subscriber event broadcasting
// ---------------------------------------------------------------------------

/// Backend-agnostic event notification layer.
///
/// The local implementation wraps `tokio::broadcast` channels keyed by
/// workflow ID. A distributed implementation can use hiqlite's Raft-replicated
/// listen/notify for cross-node delivery.
#[async_trait]
pub trait EventNotifier: Send + Sync {
    /// Push an event to all current subscribers for the given workflow.
    async fn notify(&self, workflow_id: Uuid, event: PersistedEvent);

    /// Subscribe to live events for a workflow and replay historical events
    /// from the store starting after `from_event_id`.
    ///
    /// The subscribe-first-then-load-history pattern avoids race conditions:
    /// events written between the SQLite read and the subscription are not lost.
    async fn subscribe_with_replay(
        &self,
        store: &dyn WorkflowStore,
        workflow_id: Uuid,
        from_event_id: i64,
    ) -> Result<ReplaySubscription, OrchestratorError>;
}

/// Combined replay + live event stream returned by `EventNotifier::subscribe_with_replay`.
pub struct ReplaySubscription {
    /// Historical events loaded from the store, ordered by ascending event_id.
    pub replay: Vec<PersistedEvent>,
    /// Highest event_id in `replay`, or the requested `from_event_id` if empty.
    /// Live events with `event_id <= high_water_mark` should be skipped (dedup).
    pub high_water_mark: i64,
    /// Live event receiver.
    pub subscriber: EventReceiver,
}

/// Opaque receiver handle for live broadcast events.
pub struct EventReceiver {
    rx: tokio::sync::broadcast::Receiver<PersistedEvent>,
}

impl EventReceiver {
    pub fn new(rx: tokio::sync::broadcast::Receiver<PersistedEvent>) -> Self {
        Self { rx }
    }

    /// Receives the next live event.
    pub async fn recv(
        &mut self,
    ) -> Result<PersistedEvent, tokio::sync::broadcast::error::RecvError> {
        self.rx.recv().await
    }
}
