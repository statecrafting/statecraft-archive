//! Desktop side of the workspace project catalog (spec 112 §7 / Phase 8).
//!
//! Statecraft broadcasts `project.catalog.upsert` envelopes whenever a
//! project is created, imported, deleted, or replayed during a handshake
//! snapshot. This module registers a dispatch-table handler that
//! projects each frame onto a Tauri event the frontend listens for, so
//! the OPC Projects panel updates without a restart and without polling.
//!
//! Authority invariant (spec 087 §5.3 / 112 §7): the desktop never
//! originates the upsert — those are statecraft-owned mutations. We
//! mirror state into an in-memory frontend store. Restart or
//! reconnect re-runs the handshake snapshot, so a missed upsert never
//! leaves the panel permanently stale.
//!
//! Like the agent catalog sync (`agent_catalog_sync.rs`), the path is
//! best-effort: malformed envelopes log a warning and drop the frame
//! rather than killing the consumer.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use log::{info, warn};
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};

use crate::commands::sync_client::{
    FnHandler, ProjectCatalogRepo, ServerEnvelopeWire, SyncClientState,
};

/// Tauri event emitted when a project upsert (or tombstone) arrives.
pub const EVENT_PROJECT_CATALOG_UPSERT: &str = "project-catalog-upsert";

/// Tauri event emitted when the post-handshake snapshot pass finishes
/// (including the empty-org case where no upsert frames arrived). The
/// frontend store flips its `hydrated` flag to `true` on this event so
/// the Projects panel can distinguish "still connecting" from "connected;
/// the org has zero projects".
pub const EVENT_PROJECT_CATALOG_SNAPSHOT_COMPLETE: &str =
    "project-catalog-snapshot-complete";

/// Flat projection of a `project.catalog.snapshot.complete` envelope.
/// Carries the count of upsert frames the server sent in the
/// just-finished pass; the frontend only needs the signal that the
/// pass is over, but the payload is informational.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectCatalogSnapshotCompleteEvent {
    pub org_id: String,
    pub entry_count: u32,
    pub generated_at: String,
}

/// Pull a [`ProjectCatalogSnapshotCompleteEvent`] out of a server
/// envelope. Returns `None` if `orgId` is missing (the only required
/// field — counts default to zero, timestamps default to empty so a
/// drifted server can't crash the dispatcher).
pub fn extract_snapshot_complete(
    env: &ServerEnvelopeWire,
) -> Option<ProjectCatalogSnapshotCompleteEvent> {
    let org_id = env.org_id.clone().or_else(|| {
        let m = &env.meta.org_id;
        if m.is_empty() { None } else { Some(m.clone()) }
    })?;
    Some(ProjectCatalogSnapshotCompleteEvent {
        org_id,
        entry_count: env.entry_count.unwrap_or(0),
        generated_at: env.generated_at.clone().unwrap_or_default(),
    })
}

/// Flat projection of a `project.catalog.upsert` envelope. The
/// frontend store maintains entries keyed on `project_id`; tombstones
/// drop the row.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectCatalogUpsertEvent {
    pub project_id: String,
    pub org_id: String,
    pub name: String,
    pub slug: String,
    pub description: String,
    pub factory_adapter_id: Option<String>,
    pub detection_level: Option<String>,
    pub repo: Option<ProjectCatalogRepo>,
    pub opc_deep_link: String,
    pub tombstone: bool,
    pub updated_at: String,
}

/// Pull a [`ProjectCatalogUpsertEvent`] out of a server envelope.
/// Returns `None` when a required field is missing — a drifted server
/// that emits an incomplete frame should not crash the dispatcher.
pub fn extract_upsert(env: &ServerEnvelopeWire) -> Option<ProjectCatalogUpsertEvent> {
    let project_id = env.project_id.clone()?;
    let org_id = env
        .org_id
        .clone()
        .or_else(|| {
            // Fall back to the meta org id if the payload omits the
            // explicit field. Both statecraft snapshots and live broadcasts
            // populate the payload form, but accepting the meta form keeps
            // the parser tolerant.
            let m = &env.meta.org_id;
            if m.is_empty() { None } else { Some(m.clone()) }
        })?;
    let name = env.name.clone()?;
    let slug = env.slug.clone().unwrap_or_default();
    let description = env.description.clone().unwrap_or_default();
    let factory_adapter_id = env.factory_adapter_id.clone();
    let detection_level = env.detection_level.clone();
    let repo = env.repo.clone();
    let opc_deep_link = env.opc_deep_link.clone().unwrap_or_default();
    let tombstone = env.tombstone.unwrap_or(false);
    let updated_at = env.updated_at.clone().unwrap_or_default();

    Some(ProjectCatalogUpsertEvent {
        project_id,
        org_id,
        name,
        slug,
        description,
        factory_adapter_id,
        detection_level,
        repo,
        opc_deep_link,
        tombstone,
        updated_at,
    })
}

// ---------------------------------------------------------------------------
// Pull-side cache — closes the late-listener race (the "stuck Connecting…")
// ---------------------------------------------------------------------------

/// In-memory mirror of the project catalog, updated by the duplex handlers
/// as upserts / snapshot-complete arrive.
///
/// The dispatch handlers fire the moment the duplex handshake delivers the
/// snapshot — which is **before** the Projects panel mounts and registers
/// its Tauri event listeners (the panel only renders after the boot gate
/// opens, and the boot gate opens only after `sync.hello`, i.e. after the
/// snapshot was already sent). Tauri does not buffer events for listeners
/// attached later, so a panel subscribing after the snapshot fired would
/// otherwise never hydrate — the permanent "Connecting to statecraft…"
/// state. This cache lets a late subscriber pull the current catalog via
/// [`get_project_catalog`] instead of waiting for the next duplex reconnect.
#[derive(Default)]
pub struct ProjectCatalogCache {
    inner: Mutex<ProjectCatalogCacheInner>,
}

#[derive(Default)]
struct ProjectCatalogCacheInner {
    by_id: HashMap<String, ProjectCatalogUpsertEvent>,
    /// Mirrors the frontend store's `hydrated` flag: set once either an
    /// upsert OR a snapshot-complete frame has been observed.
    hydrated: bool,
}

impl ProjectCatalogCache {
    fn apply_upsert(&self, ev: &ProjectCatalogUpsertEvent) {
        let mut g = self.inner.lock().unwrap_or_else(|p| p.into_inner());
        if ev.tombstone {
            g.by_id.remove(&ev.project_id);
        } else {
            g.by_id.insert(ev.project_id.clone(), ev.clone());
        }
        g.hydrated = true;
    }

    fn mark_complete(&self) {
        self.inner.lock().unwrap_or_else(|p| p.into_inner()).hydrated = true;
    }

    /// Drop every cached entry and reset hydration. Called when the session
    /// ends (logout) or the active server changes, so a subsequent sign-in —
    /// possibly a different user or org in the same OPC process — never
    /// observes the prior session's catalog before its fresh handshake
    /// snapshot arrives. Idempotent and cheap.
    pub fn clear(&self) {
        let mut g = self.inner.lock().unwrap_or_else(|p| p.into_inner());
        g.by_id.clear();
        g.hydrated = false;
    }

    fn snapshot(&self) -> ProjectCatalogSnapshot {
        let g = self.inner.lock().unwrap_or_else(|p| p.into_inner());
        ProjectCatalogSnapshot {
            entries: g.by_id.values().cloned().collect(),
            hydrated: g.hydrated,
        }
    }
}

/// Current desktop view of the catalog, returned by [`get_project_catalog`].
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectCatalogSnapshot {
    pub entries: Vec<ProjectCatalogUpsertEvent>,
    pub hydrated: bool,
}

/// Pull the desktop's current project catalog (spec 112 §7). The Projects
/// panel calls this immediately after registering its duplex listeners so
/// a snapshot that arrived during the handshake — before the listeners
/// were attached — is recovered instead of leaving the panel stuck on
/// "Connecting to statecraft…". Idempotent and cheap; safe to call when
/// statecraft is disabled (returns an empty, un-hydrated snapshot).
#[tauri::command]
pub fn get_project_catalog(app: AppHandle) -> ProjectCatalogSnapshot {
    match app.try_state::<ProjectCatalogCache>() {
        Some(cache) => cache.snapshot(),
        None => ProjectCatalogSnapshot {
            entries: Vec::new(),
            hydrated: false,
        },
    }
}

/// Install the Phase 8 handler on the shared dispatch table. No-op
/// (plus a single info log) when the duplex `SyncClientState` has not
/// been managed yet — the consumer wires it up at app startup, so this
/// is a defensive guard rather than a normal path.
pub fn register_project_catalog_handlers(app: AppHandle) {
    if app.try_state::<SyncClientState>().is_none() {
        warn!("project_catalog_sync: SyncClientState not managed — cannot register handlers");
        return;
    }

    let dispatch = app.state::<SyncClientState>().dispatch_table();

    let app_handle = app.clone();
    let handler = FnHandler(move |env: &ServerEnvelopeWire| {
        on_project_upsert(app_handle.clone(), env);
    });
    dispatch.register("project.catalog.upsert", Arc::new(handler));

    let app_handle = app.clone();
    let complete_handler = FnHandler(move |env: &ServerEnvelopeWire| {
        on_snapshot_complete(app_handle.clone(), env);
    });
    dispatch.register(
        "project.catalog.snapshot.complete",
        Arc::new(complete_handler),
    );

    info!("project_catalog_sync: dispatch handler registered");
}

fn on_project_upsert(app: AppHandle, env: &ServerEnvelopeWire) {
    let Some(payload) = extract_upsert(env) else {
        warn!("project.catalog.upsert missing required fields — ignored");
        return;
    };
    // Mirror into the pull-side cache first so a late `get_project_catalog`
    // sees this row even if the live event below outraces the listener.
    if let Some(cache) = app.try_state::<ProjectCatalogCache>() {
        cache.apply_upsert(&payload);
    }
    if let Err(e) = app.emit(EVENT_PROJECT_CATALOG_UPSERT, &payload) {
        warn!("project.catalog.upsert: failed to emit frontend event: {e}");
    }
}

fn on_snapshot_complete(app: AppHandle, env: &ServerEnvelopeWire) {
    let Some(payload) = extract_snapshot_complete(env) else {
        warn!("project.catalog.snapshot.complete missing orgId — ignored");
        return;
    };
    if let Some(cache) = app.try_state::<ProjectCatalogCache>() {
        cache.mark_complete();
    }
    if let Err(e) = app.emit(EVENT_PROJECT_CATALOG_SNAPSHOT_COMPLETE, &payload) {
        warn!(
            "project.catalog.snapshot.complete: failed to emit frontend event: {e}"
        );
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::sync_client::ServerMeta;
    use serde_json::{Value as JsonValue, json};

    fn server_envelope(kind: &str, payload: JsonValue) -> ServerEnvelopeWire {
        let mut wrapped = json!({
            "kind": kind,
            "meta": {
                "v": 1,
                "eventId": "e1",
                "sentAt": "2026-04-27T00:00:00Z",
                "orgCursor": "cur-1",
                "orgId": "org-1"
            }
        })
        .as_object()
        .unwrap()
        .clone();
        if let Some(obj) = payload.as_object() {
            for (k, v) in obj {
                wrapped.insert(k.clone(), v.clone());
            }
        }
        serde_json::from_value(JsonValue::Object(wrapped)).expect("envelope parse")
    }

    #[test]
    fn extract_upsert_projects_required_fields() {
        let env = server_envelope(
            "project.catalog.upsert",
            json!({
                "projectId": "p-1",
                "orgId": "org-1",
                "name": "Alpha",
                "slug": "alpha",
                "description": "first",
                "factoryAdapterId": "ad-1",
                "detectionLevel": "scaffold_only",
                "repo": {
                    "githubOrg": "acme",
                    "repoName": "alpha",
                    "defaultBranch": "main",
                    "cloneUrl": "https://github.com/acme/alpha.git",
                    "htmlUrl": "https://github.com/acme/alpha"
                },
                "opcDeepLink": "opc://project/open?project_id=p-1",
                "tombstone": false,
                "updatedAt": "2026-04-27T00:00:00Z"
            }),
        );
        let u = extract_upsert(&env).expect("parses");
        assert_eq!(u.project_id, "p-1");
        assert_eq!(u.org_id, "org-1");
        assert_eq!(u.name, "Alpha");
        assert_eq!(u.slug, "alpha");
        assert_eq!(u.factory_adapter_id.as_deref(), Some("ad-1"));
        assert_eq!(u.detection_level.as_deref(), Some("scaffold_only"));
        let repo = u.repo.expect("repo present");
        assert_eq!(repo.github_org, "acme");
        assert_eq!(repo.repo_name, "alpha");
        assert!(!u.tombstone);
    }

    #[test]
    fn extract_upsert_falls_back_to_meta_org_id() {
        let mut env = server_envelope(
            "project.catalog.upsert",
            json!({
                "projectId": "p-1",
                "name": "Alpha",
                "tombstone": false
            }),
        );
        // Drop the payload orgId so the meta fallback kicks in.
        env.org_id = None;
        let u = extract_upsert(&env).expect("parses with meta fallback");
        assert_eq!(u.org_id, "org-1");
    }

    #[test]
    fn extract_upsert_returns_none_on_missing_project_id() {
        let env = server_envelope(
            "project.catalog.upsert",
            json!({
                "name": "Alpha",
                "orgId": "org-1"
            }),
        );
        assert!(extract_upsert(&env).is_none());
    }

    #[test]
    fn extract_upsert_rejects_empty_org_in_meta_and_payload() {
        let mut env = server_envelope(
            "project.catalog.upsert",
            json!({
                "projectId": "p-1",
                "name": "Alpha"
            }),
        );
        env.org_id = None;
        env.meta = ServerMeta {
            v: 1,
            event_id: "e1".into(),
            sent_at: "2026-04-27T00:00:00Z".into(),
            correlation_id: None,
            causation_id: None,
            org_cursor: "cur-1".into(),
            org_id: "".into(),
        };
        assert!(extract_upsert(&env).is_none());
    }

    #[test]
    fn extract_upsert_carries_tombstone_flag() {
        let env = server_envelope(
            "project.catalog.upsert",
            json!({
                "projectId": "p-1",
                "orgId": "org-1",
                "name": "Alpha",
                "tombstone": true
            }),
        );
        let u = extract_upsert(&env).expect("parses");
        assert!(u.tombstone);
    }

    #[test]
    fn extract_snapshot_complete_projects_required_fields() {
        let env = server_envelope(
            "project.catalog.snapshot.complete",
            json!({
                "orgId": "org-1",
                "entryCount": 3,
                "generatedAt": "2026-05-25T00:00:00Z"
            }),
        );
        let c = extract_snapshot_complete(&env).expect("parses");
        assert_eq!(c.org_id, "org-1");
        assert_eq!(c.entry_count, 3);
        assert_eq!(c.generated_at, "2026-05-25T00:00:00Z");
    }

    #[test]
    fn extract_snapshot_complete_zero_entries_is_valid() {
        // The whole point of this envelope: zero projects in the org must
        // still produce a valid frame so the desktop can flip out of the
        // "connecting" state without an arbitrary timeout.
        let env = server_envelope(
            "project.catalog.snapshot.complete",
            json!({
                "orgId": "org-1",
                "entryCount": 0,
                "generatedAt": "2026-05-25T00:00:00Z"
            }),
        );
        let c = extract_snapshot_complete(&env).expect("parses");
        assert_eq!(c.entry_count, 0);
    }

    #[test]
    fn extract_snapshot_complete_falls_back_to_meta_org_id() {
        let mut env = server_envelope(
            "project.catalog.snapshot.complete",
            json!({ "entryCount": 0, "generatedAt": "2026-05-25T00:00:00Z" }),
        );
        env.org_id = None;
        let c = extract_snapshot_complete(&env).expect("parses with meta fallback");
        assert_eq!(c.org_id, "org-1");
    }

    #[test]
    fn extract_snapshot_complete_returns_none_without_org_id() {
        let mut env = server_envelope(
            "project.catalog.snapshot.complete",
            json!({ "entryCount": 0 }),
        );
        env.org_id = None;
        env.meta = ServerMeta {
            v: 1,
            event_id: "e1".into(),
            sent_at: "2026-05-25T00:00:00Z".into(),
            correlation_id: None,
            causation_id: None,
            org_cursor: "cur-1".into(),
            org_id: "".into(),
        };
        assert!(extract_snapshot_complete(&env).is_none());
    }

    #[test]
    fn clear_drops_entries_and_resets_hydration() {
        // Session-end invariant: after clear() a late `get_project_catalog`
        // sees an empty, un-hydrated snapshot — so a re-login (possibly a
        // different org in the same process) re-waits for its own handshake
        // snapshot instead of surfacing the prior session's projects.
        let cache = ProjectCatalogCache::default();
        let ev = extract_upsert(&server_envelope(
            "project.catalog.upsert",
            json!({ "projectId": "p-1", "orgId": "org-1", "name": "Alpha" }),
        ))
        .expect("parses");
        cache.apply_upsert(&ev);

        let before = cache.snapshot();
        assert_eq!(before.entries.len(), 1);
        assert!(before.hydrated);

        cache.clear();

        let after = cache.snapshot();
        assert!(after.entries.is_empty());
        assert!(!after.hydrated);
    }
}
