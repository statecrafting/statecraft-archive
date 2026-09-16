// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Bartek Kus

//! Cross-session event propagation via hiqlite listen/notify (FR-006).
//!
//! Events are emitted at mutation points and consumed by a background
//! listener task that updates local caches and logs state changes.

use hiqlite::Client;
use serde::{Deserialize, Serialize};

// Event type constants
pub const EVENT_CHECKPOINT_CREATED: &str = "checkpoint.created";
pub const EVENT_INDEX_UPDATED: &str = "index.updated";
pub const EVENT_LEASE_ACQUIRED: &str = "lease.acquired";
pub const EVENT_LEASE_RELEASED: &str = "lease.released";
pub const EVENT_POLICY_UPDATED: &str = "policy.updated";

/// Payload envelope for cross-session events.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EventPayload {
    pub event_type: String,
    pub data: serde_json::Value,
    pub timestamp: String,
}

/// Emit a cross-session event via hiqlite listen/notify.
///
/// This is fire-and-forget: errors are logged but do not fail the caller.
pub async fn emit(client: &Client, event_type: &str, data: serde_json::Value) {
    let payload = EventPayload {
        event_type: event_type.to_string(),
        data,
        timestamp: chrono::Utc::now().to_rfc3339(),
    };

    if let Err(e) = client.notify(&payload).await {
        log::warn!("failed to emit event {}: {}", event_type, e);
    }
}

/// Spawn a background task that listens for cross-session events.
///
/// The listener logs received events and can be extended to invalidate
/// caches or update local state.
pub fn spawn_event_listener(client: Client) {
    tokio::spawn(async move {
        log::info!("cross-session event listener started");

        // hiqlite's listen API blocks until the next event arrives.
        // We call listen_after_start in a loop to process only events
        // that occurred after this process started.
        loop {
            match client.listen_after_start::<EventPayload>().await {
                Ok(payload) => {
                    handle_event(&payload);
                }
                Err(e) => {
                    log::warn!("event listener recv error: {}", e);
                    // On channel error, break out of the loop
                    break;
                }
            }
        }

        log::info!("cross-session event listener stopped");
    });
}

fn handle_event(payload: &EventPayload) {
    match payload.event_type.as_str() {
        EVENT_CHECKPOINT_CREATED => {
            log::info!("cross-session: checkpoint created — {}", payload.data);
            // Future: invalidate lease fingerprint for affected repo
        }
        EVENT_INDEX_UPDATED => {
            log::info!("cross-session: search index updated — {}", payload.data);
            // Future: invalidate kd-tree cache for the project
        }
        EVENT_LEASE_ACQUIRED => {
            log::info!("cross-session: lease acquired — {}", payload.data);
        }
        EVENT_LEASE_RELEASED => {
            log::info!("cross-session: lease released — {}", payload.data);
        }
        EVENT_POLICY_UPDATED => {
            log::info!("cross-session: policy updated — {}", payload.data);
            // Future: reload policy bundle from KV cache
        }
        other => {
            log::debug!("cross-session: unknown event type: {}", other);
        }
    }
}
