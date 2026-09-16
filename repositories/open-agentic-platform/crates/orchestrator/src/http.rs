// SPDX-License-Identifier: AGPL-3.0-or-later
// Feature 052 Phase 6: HTTP surface for workflow state and events.
//
// This module exposes an Axum router with a single SSE endpoint:
//
//   GET /workflows/:id/events?offset=0
//
// It uses the `WorkflowStore` and `EventNotifier` traits so the SSE endpoint
// works with both the local SQLite backend and a future distributed backend.

use crate::OrchestratorError;
use crate::store::{EventNotifier, ReplaySubscription, WorkflowStore};
use axum::Router;
use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::response::sse::{Event, KeepAlive, Sse};
use futures_util::Stream;
use futures_util::stream::{self, StreamExt};
use serde::Deserialize;
use std::convert::Infallible;
use std::sync::Arc;
use std::time::Duration;

/// Shared state for the HTTP server: a workflow store and an event notifier.
#[derive(Clone)]
pub struct HttpState {
    pub store: Arc<dyn WorkflowStore>,
    pub notifier: Arc<dyn EventNotifier>,
}

/// Query parameters for the SSE endpoint.
#[derive(Debug, Deserialize)]
pub struct EventsQuery {
    /// Starting event offset (inclusive of `from_event_id + 1`).
    #[serde(default)]
    pub offset: i64,
}

/// Builds an Axum router with workflow and conversation SSE endpoints.
pub fn router(state: HttpState) -> Router {
    Router::new()
        .route(
            "/workflows/:id/events",
            axum::routing::get(workflow_events_sse),
        )
        .route(
            "/conversations/:session_id/events",
            axum::routing::get(conversation_events_sse),
        )
        .with_state(state)
}

async fn workflow_events_sse(
    State(state): State<HttpState>,
    Path(workflow_id): Path<uuid::Uuid>,
    Query(query): Query<EventsQuery>,
) -> impl IntoResponse {
    // Load replay + live subscription via the notifier trait.
    let replay_subscription = match state
        .notifier
        .subscribe_with_replay(state.store.as_ref(), workflow_id, query.offset)
        .await
    {
        Ok(sub) => sub,
        Err(OrchestratorError::StatePersistence { reason }) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("state persistence error: {reason}"),
            )
                .into_response();
        }
        Err(other) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("error subscribing to events: {other}"),
            )
                .into_response();
        }
    };

    let stream = build_sse_stream(replay_subscription);

    Sse::new(stream)
        .keep_alive(
            KeepAlive::new()
                .interval(Duration::from_secs(15))
                .text("keep-alive"),
        )
        .into_response()
}

/// SSE endpoint for conversation-scoped durable streams.
///
/// Uses the same `build_sse_stream` infrastructure as workflow events but
/// scoped to conversation events only.  Session IDs and workflow IDs are both
/// v4 UUIDs so they naturally partition the `LocalEventNotifier` channel space.
async fn conversation_events_sse(
    State(state): State<HttpState>,
    Path(session_id): Path<uuid::Uuid>,
    Query(query): Query<EventsQuery>,
) -> impl IntoResponse {
    // Subscribe to live events first (avoids race with store load).
    let replay_subscription = match state
        .notifier
        .subscribe_with_replay(state.store.as_ref(), session_id, query.offset)
        .await
    {
        Ok(sub) => sub,
        Err(OrchestratorError::StatePersistence { reason }) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("state persistence error: {reason}"),
            )
                .into_response();
        }
        Err(other) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("error subscribing to conversation events: {other}"),
            )
                .into_response();
        }
    };

    let stream = build_sse_stream(replay_subscription);

    Sse::new(stream)
        .keep_alive(
            KeepAlive::new()
                .interval(Duration::from_secs(15))
                .text("keep-alive"),
        )
        .into_response()
}

fn build_sse_stream(
    sub: ReplaySubscription,
) -> impl Stream<Item = Result<Event, Infallible>> + Send + 'static {
    let ReplaySubscription {
        replay,
        high_water_mark,
        mut subscriber,
    } = sub;

    // First, send all replay events in order.
    let replay_iter = replay.into_iter().map(|event| {
        let json = serde_json::to_string(&event).unwrap_or_else(|_| "{}".to_string());
        Ok(Event::default().id(event.event_id.to_string()).data(json))
    });

    // Then, stream live events, skipping those with event_id <= high_water_mark.
    let live_stream = async_stream::stream! {
        let mut current_hwm = high_water_mark;
        loop {
            match subscriber.recv().await {
                Ok(event) => {
                    if event.event_id <= current_hwm {
                        continue;
                    }
                    current_hwm = event.event_id;
                    let json = serde_json::to_string(&event).unwrap_or_else(|_| "{}".to_string());
                    let sse_event = Event::default().id(event.event_id.to_string()).data(json);
                    yield Ok(sse_event);
                }
                Err(_lagged) => {
                    // On lagged subscribers, clients should reconnect with a higher offset.
                    continue;
                }
            }
        }
    };

    let replay_stream = stream::iter(replay_iter);
    replay_stream.chain(live_stream)
}
