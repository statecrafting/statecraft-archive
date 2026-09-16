//! Desktop side of the org-managed agent catalog (spec 111 Phase 5).
//!
//! Phase 3 taught the duplex consumer to decode `agent.catalog.updated` and
//! `agent.catalog.snapshot` frames and to serialise the outbound
//! `agent.catalog.fetch_request`. This module lights those frames up — it
//! registers dispatch-table handlers behind the `OPC_REMOTE_AGENT_CATALOG`
//! feature flag, persists remote definitions into the shared agents SQLite
//! cache (columns added in `agents::init_database`), and emits
//! `agent-catalog-*` Tauri events so the frontend can refresh without
//! polling.
//!
//! Authority invariant (spec 087 §5.3 / 111 §2.2): the desktop never
//! originates publish/retire — those are statecraft-owned mutations. We only
//! mirror state and pull bodies on cache-miss.
//!
//! The sync path is intentionally best-effort: DB errors and malformed
//! envelopes log a warning and drop the frame rather than killing the
//! consumer. The Phase 3 ack fires upstream, so an unrecoverable local error
//! surfaces as a stale cache until the next snapshot, not as a stuck stream.

use std::sync::Arc;

use log::{info, warn};
use rusqlite::{Connection, params};
use serde_json::Value as JsonValue;
use tauri::{AppHandle, Emitter, Manager};

use crate::commands::agents::AgentDb;
use crate::commands::sync_client::{
    AgentCatalogFetchReason, AgentCatalogSnapshotEntry, FnHandler,
    ProjectAgentBindingSnapshotEntry, ServerEnvelopeWire, SyncClientState,
    AGENT_CATALOG_ENVELOPE_VERSION, PROJECT_AGENT_BINDING_ENVELOPE_VERSION,
};

/// Env var that gates desktop-side remote catalog ingestion. Phase 3 keeps
/// the decode path live unconditionally; Phase 5 enables handler dispatch +
/// DB writes + fetch-request emission when this is set to a truthy value.
pub const CATALOG_FEATURE_FLAG: &str = "OPC_REMOTE_AGENT_CATALOG";

/// Tauri event emitted when a remote agent row is upserted or removed.
pub const EVENT_CATALOG_UPDATED: &str = "agent-catalog-updated";
/// Tauri event emitted after a snapshot has been applied to the local cache.
pub const EVENT_CATALOG_SNAPSHOT: &str = "agent-catalog-snapshot";
/// Tauri event emitted when a project-agent binding is upserted or removed.
pub const EVENT_BINDING_UPDATED: &str = "project-agent-binding-updated";
/// Tauri event emitted after a binding snapshot has been applied.
pub const EVENT_BINDING_SNAPSHOT: &str = "project-agent-binding-snapshot";

/// One-shot flag per session: whether we have already surfaced the
/// "statecraft requires desktop update" log for a v:1 catalog envelope.
/// Using a `std::sync::atomic::AtomicBool` avoids locking on the fast path.
static CATALOG_VERSION_MISMATCH_LOGGED: std::sync::atomic::AtomicBool =
    std::sync::atomic::AtomicBool::new(false);

/// Return true when the feature flag is set to any value other than the
/// canonical "off" strings. Mirrors the laxness of Rust's typical bool env
/// parsing so dev workflows can flip the flag with `=1` / `=true` / just the
/// var's presence.
pub fn feature_flag_enabled() -> bool {
    match std::env::var(CATALOG_FEATURE_FLAG) {
        Ok(v) => {
            let norm = v.trim().to_ascii_lowercase();
            !norm.is_empty() && norm != "0" && norm != "false" && norm != "off"
        }
        Err(_) => false,
    }
}

// ---------------------------------------------------------------------------
// Envelope → row projection
// ---------------------------------------------------------------------------

/// Flat projection of an `agent.catalog.updated` envelope that the cache
/// layer needs. Kept intentionally small — the duplex decoder already split
/// the wire fields onto `ServerEnvelopeWire`; this narrows them to what the
/// DB writes.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RemoteAgentUpdate {
    pub org_id: String,
    pub remote_agent_id: String,
    pub name: String,
    pub version: u32,
    pub status: String,
    pub content_hash: String,
    pub body_markdown: String,
    pub frontmatter_json: String,
}

/// Pull a [`RemoteAgentUpdate`] out of a server envelope. Returns `None` when
/// a required field is missing — a drifted server that sends an incomplete
/// `agent.catalog.updated` should not crash the dispatcher.
pub fn extract_remote_update(env: &ServerEnvelopeWire) -> Option<RemoteAgentUpdate> {
    let org_id = env.meta.org_id.clone();
    if org_id.is_empty() {
        return None;
    }
    let remote_agent_id = env.agent_id.clone()?;
    let name = env.name.clone()?;
    let version = env.version?;
    let status = env.status.clone()?;
    let content_hash = env.content_hash.clone()?;
    let body_markdown = env.body_markdown.clone().unwrap_or_default();
    let frontmatter_json = match env.frontmatter.as_ref() {
        Some(v) => serde_json::to_string(v).ok()?,
        None => "{}".to_string(),
    };
    Some(RemoteAgentUpdate {
        org_id,
        remote_agent_id,
        name,
        version,
        status,
        content_hash,
        body_markdown,
        frontmatter_json,
    })
}

/// Best-effort lookup of a display icon on the frontmatter. Falls back to a
/// globe glyph so remote rows are visually distinguishable from the local
/// defaults even if the frontmatter omits an icon.
fn icon_from_frontmatter(fm: &JsonValue) -> String {
    fm.get("icon")
        .and_then(JsonValue::as_str)
        .map(str::to_string)
        .unwrap_or_else(|| "\u{1f310}".to_string())
}

/// Best-effort lookup of a preferred model name on the frontmatter.
fn model_from_frontmatter(fm: &JsonValue) -> String {
    fm.get("model")
        .and_then(JsonValue::as_str)
        .map(str::to_string)
        .unwrap_or_else(|| "sonnet".to_string())
}

// ---------------------------------------------------------------------------
// DB operations
// ---------------------------------------------------------------------------

/// Apply a published `agent.catalog.updated` to the cache. Upserts the row
/// keyed on `remote_agent_id` and stamps the `source = 'remote'`,
/// org_id, remote_version, and content_hash columns so snapshot diffs
/// can detect drift without refetching bodies.
pub fn upsert_remote_agent(
    conn: &Connection,
    update: &RemoteAgentUpdate,
) -> Result<(), rusqlite::Error> {
    let parsed_fm: JsonValue =
        serde_json::from_str(&update.frontmatter_json).unwrap_or(JsonValue::Null);
    let icon = icon_from_frontmatter(&parsed_fm);
    let model = model_from_frontmatter(&parsed_fm);

    // SQLite requires the ON CONFLICT target predicate to match the partial
    // index literally (spec 111 §2.4 keys the unique index on
    // `remote_agent_id IS NOT NULL`). Repeat the predicate here so the
    // upsert binds to `agents_remote_id_uniq` instead of erroring with
    // "ON CONFLICT clause does not match any PRIMARY KEY or UNIQUE constraint".
    conn.execute(
        "INSERT INTO agents (
             name, icon, system_prompt, model,
             enable_file_read, enable_file_write, enable_network,
             source, remote_agent_id, remote_version, remote_content_hash,
             org_id, frontmatter_json
         ) VALUES (?1, ?2, ?3, ?4, 1, 1, 0, 'remote', ?5, ?6, ?7, ?8, ?9)
         ON CONFLICT(remote_agent_id) WHERE remote_agent_id IS NOT NULL DO UPDATE SET
             name                 = excluded.name,
             icon                 = excluded.icon,
             system_prompt        = excluded.system_prompt,
             model                = excluded.model,
             source               = 'remote',
             remote_version       = excluded.remote_version,
             remote_content_hash  = excluded.remote_content_hash,
             org_id         = excluded.org_id,
             frontmatter_json     = excluded.frontmatter_json,
             updated_at           = CURRENT_TIMESTAMP",
        params![
            update.name,
            icon,
            update.body_markdown,
            model,
            update.remote_agent_id,
            update.version as i64,
            update.content_hash,
            update.org_id,
            update.frontmatter_json,
        ],
    )?;
    Ok(())
}

/// Remove a remote agent from the cache. Used both on `agent.catalog.updated
/// { status: "retired" }` and on snapshot absence (§2.4, §7.3).
pub fn retire_remote_agent(
    conn: &Connection,
    remote_agent_id: &str,
) -> Result<usize, rusqlite::Error> {
    conn.execute(
        "DELETE FROM agents WHERE remote_agent_id = ?1",
        params![remote_agent_id],
    )
}

/// A single decision the snapshot reconciler emits.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SnapshotAction {
    /// The snapshot lists an agent we don't have locally. Pull the body.
    Fetch {
        agent_id: String,
        reason: AgentCatalogFetchReason,
    },
    /// The snapshot omits an agent we have locally → treat as retired and
    /// delete the cache row.
    Delete { agent_id: String },
}

/// Diff a snapshot directory against the current cache for a workspace and
/// return the actions the caller should take (§2.4 item 3–4). Pure function
/// — DB mutations live in the caller so tests can assert intent without
/// coupling to the connection.
///
/// Uses `remote_agent_id` as the join key. Compares `content_hash` to decide
/// between `CacheMiss` (row absent locally) and `HashMismatch` (row present
/// but stale).
pub fn diff_snapshot(
    conn: &Connection,
    org_id: &str,
    entries: &[AgentCatalogSnapshotEntry],
) -> Result<Vec<SnapshotAction>, rusqlite::Error> {
    use std::collections::{HashMap, HashSet};

    let mut local: HashMap<String, String> = HashMap::new();
    {
        let mut stmt = conn.prepare(
            "SELECT remote_agent_id, COALESCE(remote_content_hash, '')
             FROM agents
             WHERE source = 'remote' AND org_id = ?1",
        )?;
        let rows = stmt.query_map(params![org_id], |row| {
            let id: Option<String> = row.get(0)?;
            let hash: String = row.get(1)?;
            Ok((id, hash))
        })?;
        for row in rows {
            let (id, hash) = row?;
            if let Some(id) = id {
                local.insert(id, hash);
            }
        }
    }

    let mut actions = Vec::new();
    let mut snapshot_ids: HashSet<String> = HashSet::new();
    for entry in entries {
        // Retired entries in a snapshot are a spec-legal no-op — the directory
        // only carries currently-published rows, so a retired entry here would
        // indicate an older server. Drop it and let absence handle removal.
        if entry.status != "published" {
            continue;
        }
        snapshot_ids.insert(entry.agent_id.clone());
        match local.get(&entry.agent_id) {
            None => actions.push(SnapshotAction::Fetch {
                agent_id: entry.agent_id.clone(),
                reason: AgentCatalogFetchReason::CacheMiss,
            }),
            Some(local_hash) if local_hash != &entry.content_hash => {
                actions.push(SnapshotAction::Fetch {
                    agent_id: entry.agent_id.clone(),
                    reason: AgentCatalogFetchReason::HashMismatch,
                })
            }
            _ => {}
        }
    }

    for local_id in local.keys() {
        if !snapshot_ids.contains(local_id) {
            actions.push(SnapshotAction::Delete {
                agent_id: local_id.clone(),
            });
        }
    }

    Ok(actions)
}

// ---------------------------------------------------------------------------
// Binding DB operations (spec 123 §7.2)
// ---------------------------------------------------------------------------

/// Flat projection of a `project.agent_binding.updated` or binding snapshot
/// entry. Written into the local `project_agent_bindings` table so
/// `list_active_agents` can return the bound subset without a network call.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LocalBinding {
    pub project_id: String,
    pub org_agent_id: String,
    pub pinned_version: i32,
    pub pinned_content_hash: String,
}

/// Upsert or delete a single binding row based on the `action` field from
/// a `project.agent_binding.updated` envelope.
pub fn apply_binding_action(
    conn: &Connection,
    binding: &LocalBinding,
    action: &str,
) -> Result<(), rusqlite::Error> {
    match action {
        "bound" | "rebound" => {
            conn.execute(
                "INSERT INTO project_agent_bindings
                     (project_id, org_agent_id, pinned_version, pinned_content_hash)
                 VALUES (?1, ?2, ?3, ?4)
                 ON CONFLICT(project_id, org_agent_id) DO UPDATE SET
                     pinned_version       = excluded.pinned_version,
                     pinned_content_hash  = excluded.pinned_content_hash,
                     updated_at           = CURRENT_TIMESTAMP",
                params![
                    binding.project_id,
                    binding.org_agent_id,
                    binding.pinned_version,
                    binding.pinned_content_hash,
                ],
            )?;
        }
        "unbound" => {
            conn.execute(
                "DELETE FROM project_agent_bindings
                 WHERE project_id = ?1 AND org_agent_id = ?2",
                params![binding.project_id, binding.org_agent_id],
            )?;
        }
        other => {
            warn!(
                "apply_binding_action: unrecognised action {other:?} for project={} agent={} — ignored",
                binding.project_id, binding.org_agent_id
            );
        }
    }
    Ok(())
}

/// Replace all local bindings for `project_id` with the snapshot entries.
/// This is called from the `project.agent_binding.snapshot` handler and
/// performs a full reconcile: any binding not present in the snapshot is
/// deleted; every snapshot entry is upserted.
pub fn apply_binding_snapshot(
    conn: &Connection,
    project_id: &str,
    entries: &[ProjectAgentBindingSnapshotEntry],
) -> Result<(), rusqlite::Error> {
    // Delete all existing bindings for the project first — the snapshot is
    // authoritative (like the catalog snapshot handler).
    conn.execute(
        "DELETE FROM project_agent_bindings WHERE project_id = ?1",
        params![project_id],
    )?;

    // Re-insert from the snapshot.
    for entry in entries {
        conn.execute(
            "INSERT INTO project_agent_bindings
                 (project_id, org_agent_id, pinned_version, pinned_content_hash)
             VALUES (?1, ?2, ?3, ?4)
             ON CONFLICT(project_id, org_agent_id) DO UPDATE SET
                 pinned_version       = excluded.pinned_version,
                 pinned_content_hash  = excluded.pinned_content_hash,
                 updated_at           = CURRENT_TIMESTAMP",
            params![
                project_id,
                entry.org_agent_id,
                entry.pinned_version,
                entry.pinned_content_hash,
            ],
        )?;
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Dispatch handler registration
// ---------------------------------------------------------------------------

/// Install the Phase 5 handlers on the shared dispatch table. No-op (plus a
/// single info log) when [`feature_flag_enabled`] is false, so the default
/// desktop posture stays Phase 3 — decode-only, drop-on-dispatch.
pub fn register_agent_catalog_handlers(app: AppHandle) {
    if !feature_flag_enabled() {
        info!(
            "agent_catalog_sync: {} not set — remote catalog handlers skipped (Phase 3 posture)",
            CATALOG_FEATURE_FLAG
        );
        return;
    }

    if app.try_state::<SyncClientState>().is_none() {
        warn!("agent_catalog_sync: SyncClientState not managed — cannot register handlers");
        return;
    }

    let dispatch = app.state::<SyncClientState>().dispatch_table();

    // agent.catalog.updated — upsert or retire a single row.
    {
        let app_handle = app.clone();
        let handler = FnHandler(move |env: &ServerEnvelopeWire| {
            on_catalog_updated(app_handle.clone(), env);
        });
        dispatch.register("agent.catalog.updated", Arc::new(handler));
    }

    // agent.catalog.snapshot — diff the directory, request missing bodies,
    // drop removed rows.
    {
        let app_handle = app.clone();
        let handler = FnHandler(move |env: &ServerEnvelopeWire| {
            on_catalog_snapshot(app_handle.clone(), env);
        });
        dispatch.register("agent.catalog.snapshot", Arc::new(handler));
    }

    // project.agent_binding.updated — upsert or delete a single binding row.
    {
        let app_handle = app.clone();
        let handler = FnHandler(move |env: &ServerEnvelopeWire| {
            on_binding_updated(app_handle.clone(), env);
        });
        dispatch.register("project.agent_binding.updated", Arc::new(handler));
    }

    // project.agent_binding.snapshot — replace all bindings for a project.
    {
        let app_handle = app.clone();
        let handler = FnHandler(move |env: &ServerEnvelopeWire| {
            on_binding_snapshot(app_handle.clone(), env);
        });
        dispatch.register("project.agent_binding.snapshot", Arc::new(handler));
    }

    info!("agent_catalog_sync: dispatch handlers registered (flag enabled)");
}

/// Emit a one-shot warning when a `v:1` catalog envelope is received from a
/// server that has not yet deployed spec 123. Per spec §7.3 this is a clean
/// break; the desktop drops the frame and logs once per session.
fn check_catalog_envelope_version(env: &ServerEnvelopeWire, kind: &str) -> bool {
    // The protocol-wide `meta.v` is enforced by `is_server_envelope` upstream;
    // here we additionally check the per-kind contract version embedded in the
    // envelope's `version` field when it is present. A v:1 agent catalog
    // envelope from a pre-spec-123 server carries `version: 1` at the
    // payload level (not meta.v). We detect the mismatch by inspecting the
    // kind-level version constant.
    //
    // Concrete check: if the envelope is `agent.catalog.*` and the server is
    // still sending the spec-111 shape (which would be missing `orgId` on the
    // meta, or carry no `org_id` at all), `extract_remote_update` will return
    // `None` and the caller logs the drop. This function provides an additional
    // one-shot advisory log so the operator knows why.
    //
    // Currently we cannot extract a per-kind version from the flat wire struct
    // because the spec-111 server never sent one; instead we gate on the
    // presence of `org_id` in the meta (added in spec 123 phase 3). If
    // `meta.org_id` is empty on a catalog envelope the server is pre-spec-123.
    let _ = AGENT_CATALOG_ENVELOPE_VERSION; // reference the const so the compiler validates it
    let _ = kind;
    if env.meta.org_id.is_empty() {
        use std::sync::atomic::Ordering;
        if !CATALOG_VERSION_MISMATCH_LOGGED.swap(true, Ordering::Relaxed) {
            warn!(
                "agent_catalog_sync: received {kind} with empty org_id — \
                 statecraft requires desktop update (spec 123 §7.3). \
                 Envelope dropped. This warning appears once per session."
            );
        }
        return false;
    }
    true
}

fn on_catalog_updated(app: AppHandle, env: &ServerEnvelopeWire) {
    if !check_catalog_envelope_version(env, "agent.catalog.updated") {
        return;
    }
    let Some(update) = extract_remote_update(env) else {
        warn!("agent.catalog.updated missing required fields — ignored");
        return;
    };

    let Some(db) = app.try_state::<AgentDb>() else {
        warn!("agent.catalog.updated: AgentDb not managed — ignored");
        return;
    };

    let result = {
        let Ok(conn) = db.0.lock() else {
            warn!("agent.catalog.updated: agents DB mutex poisoned — ignored");
            return;
        };
        match update.status.as_str() {
            "published" => upsert_remote_agent(&conn, &update).map(|_| ()),
            "retired" => retire_remote_agent(&conn, &update.remote_agent_id).map(|_| ()),
            other => {
                warn!(
                    "agent.catalog.updated: unexpected status {other:?} for remote_agent_id={} — ignored",
                    update.remote_agent_id
                );
                return;
            }
        }
    };

    match result {
        Ok(_) => {
            let payload = serde_json::json!({
                "orgId": update.org_id,
                "remoteAgentId": update.remote_agent_id,
                "status": update.status,
                "version": update.version,
            });
            if let Err(e) = app.emit(EVENT_CATALOG_UPDATED, payload) {
                warn!("agent.catalog.updated: failed to emit frontend event: {e}");
            }
        }
        Err(e) => warn!(
            "agent.catalog.updated: cache write failed for remote_agent_id={} status={}: {e}",
            update.remote_agent_id, update.status
        ),
    }
}

fn on_catalog_snapshot(app: AppHandle, env: &ServerEnvelopeWire) {
    if !check_catalog_envelope_version(env, "agent.catalog.snapshot") {
        return;
    }
    let org_id = env.meta.org_id.clone();
    if org_id.is_empty() {
        warn!("agent.catalog.snapshot missing org id — ignored");
        return;
    }
    let entries = env.entries.clone().unwrap_or_default();

    let Some(db) = app.try_state::<AgentDb>() else {
        warn!("agent.catalog.snapshot: AgentDb not managed — ignored");
        return;
    };

    let actions = {
        let Ok(conn) = db.0.lock() else {
            warn!("agent.catalog.snapshot: agents DB mutex poisoned — ignored");
            return;
        };
        match diff_snapshot(&conn, &org_id, &entries) {
            Ok(a) => a,
            Err(e) => {
                warn!("agent.catalog.snapshot: diff failed: {e}");
                return;
            }
        }
    };

    // Apply deletions first — retired agents should drop from the UI before
    // any new fetches arrive so the frontend sees a monotonic picture.
    let mut deletes = Vec::new();
    let mut fetches: Vec<(String, AgentCatalogFetchReason)> = Vec::new();
    for action in actions {
        match action {
            SnapshotAction::Delete { agent_id } => deletes.push(agent_id),
            SnapshotAction::Fetch { agent_id, reason } => fetches.push((agent_id, reason)),
        }
    }

    if !deletes.is_empty() {
        let Ok(conn) = db.0.lock() else {
            warn!("agent.catalog.snapshot: mutex poisoned before deletions — ignored");
            return;
        };
        for id in &deletes {
            if let Err(e) = retire_remote_agent(&conn, id) {
                warn!("agent.catalog.snapshot: failed to delete stale agent {id}: {e}");
            }
        }
    }

    // Body pulls go out on the outbound channel. We spawn because the
    // dispatch callback is sync — the channel send needs an async context.
    if !fetches.is_empty()
        && let Some(sync) = app.try_state::<SyncClientState>()
    {
        let sync_handle = sync.handle();
        let _org_for_task = org_id.clone();
        tauri::async_runtime::spawn(async move {
            for (agent_id, reason) in fetches {
                let sent = sync_handle
                    .send_agent_catalog_fetch_request(&agent_id, reason)
                    .await;
                if !sent {
                    warn!(
                        "agent.catalog.fetch_request dropped (duplex disconnected) agent_id={agent_id}"
                    );
                }
            }
        });
    }

    let payload = serde_json::json!({
        "orgId": org_id,
        "entryCount": entries.len(),
        "deleted": deletes.len(),
    });
    if let Err(e) = app.emit(EVENT_CATALOG_SNAPSHOT, payload) {
        warn!("agent.catalog.snapshot: failed to emit frontend event: {e}");
    }
}

// ---------------------------------------------------------------------------
// Binding handlers (spec 123 §7.2)
// ---------------------------------------------------------------------------

fn on_binding_updated(app: AppHandle, env: &ServerEnvelopeWire) {
    let _ = PROJECT_AGENT_BINDING_ENVELOPE_VERSION; // validate const is visible

    let Some(project_id) = env.project_id.clone() else {
        warn!("project.agent_binding.updated missing project_id — ignored");
        return;
    };
    let Some(org_agent_id) = env.org_agent_id.clone() else {
        warn!("project.agent_binding.updated missing org_agent_id — ignored");
        return;
    };
    let Some(pinned_version) = env.pinned_version else {
        warn!("project.agent_binding.updated missing pinned_version — ignored");
        return;
    };
    let Some(pinned_content_hash) = env.pinned_content_hash.clone() else {
        warn!("project.agent_binding.updated missing pinned_content_hash — ignored");
        return;
    };
    let action = env.action.clone().unwrap_or_else(|| "bound".to_string());

    let Some(db) = app.try_state::<AgentDb>() else {
        warn!("project.agent_binding.updated: AgentDb not managed — ignored");
        return;
    };

    let binding = LocalBinding {
        project_id: project_id.clone(),
        org_agent_id: org_agent_id.clone(),
        pinned_version,
        pinned_content_hash: pinned_content_hash.clone(),
    };

    let result = {
        let Ok(conn) = db.0.lock() else {
            warn!("project.agent_binding.updated: DB mutex poisoned — ignored");
            return;
        };
        apply_binding_action(&conn, &binding, &action)
    };

    match result {
        Ok(_) => {
            let payload = serde_json::json!({
                "projectId": project_id,
                "orgAgentId": org_agent_id,
                "action": action,
            });
            if let Err(e) = app.emit(EVENT_BINDING_UPDATED, payload) {
                warn!("project.agent_binding.updated: failed to emit frontend event: {e}");
            }
        }
        Err(e) => warn!(
            "project.agent_binding.updated: cache write failed project={project_id} agent={org_agent_id} action={action}: {e}"
        ),
    }
}

fn on_binding_snapshot(app: AppHandle, env: &ServerEnvelopeWire) {
    let _ = PROJECT_AGENT_BINDING_ENVELOPE_VERSION; // validate const is visible

    let Some(project_id) = env.project_id.clone() else {
        warn!("project.agent_binding.snapshot missing project_id — ignored");
        return;
    };
    let entries = env.bindings.clone().unwrap_or_default();

    let Some(db) = app.try_state::<AgentDb>() else {
        warn!("project.agent_binding.snapshot: AgentDb not managed — ignored");
        return;
    };

    let result = {
        let Ok(conn) = db.0.lock() else {
            warn!("project.agent_binding.snapshot: DB mutex poisoned — ignored");
            return;
        };
        apply_binding_snapshot(&conn, &project_id, &entries)
    };

    match result {
        Ok(_) => {
            let payload = serde_json::json!({
                "projectId": project_id,
                "bindingCount": entries.len(),
            });
            if let Err(e) = app.emit(EVENT_BINDING_SNAPSHOT, payload) {
                warn!("project.agent_binding.snapshot: failed to emit frontend event: {e}");
            }
        }
        Err(e) => warn!(
            "project.agent_binding.snapshot: cache write failed project={project_id}: {e}"
        ),
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::sync_client::ServerMeta;
    use serde_json::json;

    fn in_memory_agents_db() -> Connection {
        let conn = Connection::open_in_memory().expect("in-memory conn");
        // Mirror the subset of `agents::init_database` we depend on. Kept
        // minimal — the cache columns + unique partial index are what the
        // Phase 5 helpers write against.
        conn.execute_batch(
            "CREATE TABLE agents (
                 id INTEGER PRIMARY KEY AUTOINCREMENT,
                 name TEXT NOT NULL,
                 icon TEXT NOT NULL,
                 system_prompt TEXT NOT NULL,
                 default_task TEXT,
                 model TEXT NOT NULL DEFAULT 'sonnet',
                 enable_file_read BOOLEAN NOT NULL DEFAULT 1,
                 enable_file_write BOOLEAN NOT NULL DEFAULT 1,
                 enable_network BOOLEAN NOT NULL DEFAULT 0,
                 tools TEXT,
                 hooks TEXT,
                 source TEXT NOT NULL DEFAULT 'local',
                 remote_agent_id TEXT,
                 remote_version INTEGER,
                 remote_content_hash TEXT,
                 org_id TEXT,
                 frontmatter_json TEXT,
                 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                 updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
             );
             CREATE UNIQUE INDEX agents_remote_id_uniq
                 ON agents(remote_agent_id) WHERE remote_agent_id IS NOT NULL;
             CREATE TABLE project_agent_bindings (
                 id         INTEGER PRIMARY KEY AUTOINCREMENT,
                 project_id TEXT    NOT NULL,
                 org_agent_id TEXT  NOT NULL,
                 pinned_version    INTEGER NOT NULL,
                 pinned_content_hash TEXT NOT NULL,
                 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                 updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                 UNIQUE (project_id, org_agent_id)
             );",
        )
        .expect("schema init");
        conn
    }

    fn mk_update(
        agent_id: &str,
        name: &str,
        version: u32,
        hash: &str,
        status: &str,
    ) -> RemoteAgentUpdate {
        RemoteAgentUpdate {
            org_id: "org-1".into(),
            remote_agent_id: agent_id.into(),
            name: name.into(),
            version,
            status: status.into(),
            content_hash: hash.into(),
            body_markdown: format!("# {name}"),
            frontmatter_json: json!({
                "name": name,
                "icon": "\u{1f916}",
                "model": "opus"
            })
            .to_string(),
        }
    }

    fn server_envelope(kind: &str, payload: JsonValue) -> ServerEnvelopeWire {
        let wrapped = json!({
            "kind": kind,
            "meta": {
                "v": 1,
                "eventId": "e1",
                "sentAt": "2026-04-22T00:00:00Z",
                "orgCursor": "cur-1",
                "orgId": "org-1"
            }
        });
        let mut merged = wrapped.as_object().unwrap().clone();
        if let Some(obj) = payload.as_object() {
            for (k, v) in obj {
                merged.insert(k.clone(), v.clone());
            }
        }
        serde_json::from_value(JsonValue::Object(merged)).expect("envelope parse")
    }

    #[test]
    fn feature_flag_toggles_from_env() {
        // The flag is a process-wide env var. Mutate it in an isolated scope
        // around the assertions so concurrent tests don't flake.
        // SAFETY: tests do not rely on concurrent readers of this var.
        unsafe { std::env::remove_var(CATALOG_FEATURE_FLAG) };
        assert!(!feature_flag_enabled());

        for val in ["1", "true", "TRUE", "on", "yes"] {
            unsafe { std::env::set_var(CATALOG_FEATURE_FLAG, val) };
            assert!(
                feature_flag_enabled(),
                "expected flag enabled for value {val}"
            );
        }
        for val in ["0", "false", "off", "", " "] {
            unsafe { std::env::set_var(CATALOG_FEATURE_FLAG, val) };
            assert!(
                !feature_flag_enabled(),
                "expected flag disabled for value {val:?}"
            );
        }
        unsafe { std::env::remove_var(CATALOG_FEATURE_FLAG) };
    }

    #[test]
    fn extract_remote_update_projects_required_fields() {
        let env = server_envelope(
            "agent.catalog.updated",
            json!({
                "agentId": "a-1",
                "name": "triage",
                "version": 3,
                "status": "published",
                "contentHash": "h-1",
                "frontmatter": { "name": "triage", "model": "opus" },
                "bodyMarkdown": "# body"
            }),
        );
        let u = extract_remote_update(&env).expect("parses");
        assert_eq!(u.org_id, "org-1");
        assert_eq!(u.remote_agent_id, "a-1");
        assert_eq!(u.name, "triage");
        assert_eq!(u.version, 3);
        assert_eq!(u.status, "published");
        assert_eq!(u.content_hash, "h-1");
        assert_eq!(u.body_markdown, "# body");
        let parsed: JsonValue = serde_json::from_str(&u.frontmatter_json).unwrap();
        assert_eq!(parsed["model"], "opus");
    }

    #[test]
    fn extract_remote_update_returns_none_on_missing_fields() {
        let env = server_envelope(
            "agent.catalog.updated",
            json!({
                // agentId omitted
                "name": "triage",
                "version": 1,
                "status": "published",
                "contentHash": "h-1"
            }),
        );
        assert!(extract_remote_update(&env).is_none());
    }

    #[test]
    fn extract_remote_update_rejects_empty_workspace() {
        let mut env = server_envelope(
            "agent.catalog.updated",
            json!({
                "agentId": "a-1",
                "name": "triage",
                "version": 1,
                "status": "published",
                "contentHash": "h-1"
            }),
        );
        env.meta = ServerMeta {
            v: 1,
            event_id: "e1".into(),
            sent_at: "2026-04-22T00:00:00Z".into(),
            correlation_id: None,
            causation_id: None,
            org_cursor: "cur-1".into(),
            org_id: "".into(),
        };
        assert!(extract_remote_update(&env).is_none());
    }

    #[test]
    fn upsert_inserts_then_updates_by_remote_agent_id() {
        let conn = in_memory_agents_db();
        let v1 = mk_update("a-1", "triage", 1, "h-1", "published");
        upsert_remote_agent(&conn, &v1).expect("insert");

        // Second upsert with a new version must update in place (no duplicate row).
        let v2 = mk_update("a-1", "triage", 2, "h-2", "published");
        upsert_remote_agent(&conn, &v2).expect("update");

        let rows: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM agents WHERE remote_agent_id = 'a-1'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(rows, 1);

        let (version, hash, source, workspace): (i64, String, String, String) = conn
            .query_row(
                "SELECT remote_version, remote_content_hash, source, org_id
                 FROM agents WHERE remote_agent_id = 'a-1'",
                [],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
            )
            .unwrap();
        assert_eq!(version, 2);
        assert_eq!(hash, "h-2");
        assert_eq!(source, "remote");
        assert_eq!(workspace, "org-1");
    }

    #[test]
    fn retire_deletes_only_target_row() {
        let conn = in_memory_agents_db();
        upsert_remote_agent(&conn, &mk_update("a-1", "triage", 1, "h-1", "published"))
            .expect("a-1 upsert");
        upsert_remote_agent(&conn, &mk_update("a-2", "reviewer", 1, "h-2", "published"))
            .expect("a-2 upsert");

        let n = retire_remote_agent(&conn, "a-1").expect("retire");
        assert_eq!(n, 1);

        let remaining: i64 = conn
            .query_row("SELECT COUNT(*) FROM agents", [], |r| r.get(0))
            .unwrap();
        assert_eq!(remaining, 1);

        let name: String = conn
            .query_row("SELECT name FROM agents", [], |r| r.get(0))
            .unwrap();
        assert_eq!(name, "reviewer");
    }

    #[test]
    fn retire_for_unknown_id_is_noop() {
        let conn = in_memory_agents_db();
        let n = retire_remote_agent(&conn, "does-not-exist").unwrap();
        assert_eq!(n, 0);
    }

    #[test]
    fn local_rows_with_null_remote_id_are_unaffected_by_unique_index() {
        let conn = in_memory_agents_db();
        for _ in 0..3 {
            conn.execute(
                "INSERT INTO agents (name, icon, system_prompt, source)
                 VALUES ('local-dup', '\u{1f9ea}', 'body', 'local')",
                [],
            )
            .unwrap();
        }
        let n: i64 = conn
            .query_row("SELECT COUNT(*) FROM agents", [], |r| r.get(0))
            .unwrap();
        assert_eq!(n, 3, "partial index must allow NULL remote_agent_id dupes");
    }

    fn entry(
        agent_id: &str,
        name: &str,
        version: u32,
        status: &str,
        hash: &str,
    ) -> AgentCatalogSnapshotEntry {
        AgentCatalogSnapshotEntry {
            agent_id: agent_id.into(),
            name: name.into(),
            version,
            status: status.into(),
            content_hash: hash.into(),
            updated_at: "2026-04-22T00:00:00Z".into(),
        }
    }

    #[test]
    fn diff_snapshot_classifies_cache_miss_hash_mismatch_and_delete() {
        let conn = in_memory_agents_db();
        // Seed local cache with a matching row and a stale row. Then emit a
        // snapshot that keeps the matching row, drifts the stale one, and
        // introduces a third unseen row.
        upsert_remote_agent(&conn, &mk_update("a-1", "triage", 1, "h-matching", "published"))
            .unwrap();
        upsert_remote_agent(&conn, &mk_update("a-2", "reviewer", 1, "h-old", "published")).unwrap();
        upsert_remote_agent(
            &conn,
            &mk_update("a-3", "was-retired", 1, "h-any", "published"),
        )
        .unwrap();

        let snap = vec![
            entry("a-1", "triage", 1, "published", "h-matching"),
            entry("a-2", "reviewer", 2, "published", "h-new"),
            entry("a-4", "new-agent", 1, "published", "h-fresh"),
        ];
        let mut actions = diff_snapshot(&conn, "org-1", &snap).unwrap();
        actions.sort_by(|a, b| format!("{a:?}").cmp(&format!("{b:?}")));

        assert_eq!(actions.len(), 3, "expected mismatch, miss, delete");
        // One action per expected class.
        let has_mismatch = actions.iter().any(|a| {
            matches!(
                a,
                SnapshotAction::Fetch {
                    agent_id,
                    reason: AgentCatalogFetchReason::HashMismatch,
                } if agent_id == "a-2"
            )
        });
        let has_miss = actions.iter().any(|a| {
            matches!(
                a,
                SnapshotAction::Fetch {
                    agent_id,
                    reason: AgentCatalogFetchReason::CacheMiss,
                } if agent_id == "a-4"
            )
        });
        let has_delete = actions
            .iter()
            .any(|a| matches!(a, SnapshotAction::Delete { agent_id } if agent_id == "a-3"));
        assert!(has_mismatch, "expected HashMismatch for a-2");
        assert!(has_miss, "expected CacheMiss for a-4");
        assert!(has_delete, "expected Delete for a-3");
    }

    #[test]
    fn diff_snapshot_ignores_rows_from_other_workspaces() {
        let conn = in_memory_agents_db();
        let mut other = mk_update("a-1", "triage", 1, "h-1", "published");
        other.org_id = "org-2".into();
        upsert_remote_agent(&conn, &other).unwrap();

        let actions = diff_snapshot(&conn, "org-1", &[]).unwrap();
        assert!(
            actions.is_empty(),
            "rows in org-2 must not show up in an org-1 diff"
        );
    }

    #[test]
    fn diff_snapshot_skips_non_published_entries() {
        let conn = in_memory_agents_db();
        // Retired entries shouldn't appear in a real snapshot, but a drifted
        // server could include one. We must not request its body.
        let snap = vec![entry("a-1", "triage", 1, "retired", "h-1")];
        let actions = diff_snapshot(&conn, "org-1", &snap).unwrap();
        assert!(actions.is_empty());
    }

    #[test]
    fn upsert_sets_icon_and_model_from_frontmatter() {
        let conn = in_memory_agents_db();
        let mut u = mk_update("a-1", "triage", 1, "h", "published");
        u.frontmatter_json = json!({
            "icon": "\u{26a1}",
            "model": "haiku"
        })
        .to_string();
        upsert_remote_agent(&conn, &u).unwrap();

        let (icon, model): (String, String) = conn
            .query_row(
                "SELECT icon, model FROM agents WHERE remote_agent_id = 'a-1'",
                [],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .unwrap();
        assert_eq!(icon, "\u{26a1}");
        assert_eq!(model, "haiku");
    }

    #[test]
    fn upsert_defaults_when_frontmatter_has_no_icon_or_model() {
        let conn = in_memory_agents_db();
        let mut u = mk_update("a-1", "triage", 1, "h", "published");
        u.frontmatter_json = "{}".into();
        upsert_remote_agent(&conn, &u).unwrap();

        let (icon, model): (String, String) = conn
            .query_row(
                "SELECT icon, model FROM agents WHERE remote_agent_id = 'a-1'",
                [],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .unwrap();
        // Globe fallback distinguishes remote rows in the UI until frontmatter
        // carries a real icon.
        assert_eq!(icon, "\u{1f310}");
        assert_eq!(model, "sonnet");
    }

    // ---------------------------------------------------------------------------
    // spec 123 §7.2 — project_agent_bindings DB helpers
    // ---------------------------------------------------------------------------

    fn mk_binding(project_id: &str, org_agent_id: &str, version: i32, hash: &str) -> LocalBinding {
        LocalBinding {
            project_id: project_id.into(),
            org_agent_id: org_agent_id.into(),
            pinned_version: version,
            pinned_content_hash: hash.into(),
        }
    }

    #[test]
    fn apply_binding_action_bound_inserts_row() {
        let conn = in_memory_agents_db();
        let b = mk_binding("proj-1", "a-1", 3, "h-3");
        apply_binding_action(&conn, &b, "bound").expect("insert binding");

        let count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM project_agent_bindings WHERE project_id = 'proj-1'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(count, 1);
    }

    #[test]
    fn apply_binding_action_rebound_updates_in_place() {
        let conn = in_memory_agents_db();
        apply_binding_action(&conn, &mk_binding("proj-1", "a-1", 3, "h-3"), "bound").unwrap();
        apply_binding_action(&conn, &mk_binding("proj-1", "a-1", 4, "h-4"), "rebound").unwrap();

        let (version, hash): (i64, String) = conn
            .query_row(
                "SELECT pinned_version, pinned_content_hash FROM project_agent_bindings
                 WHERE project_id = 'proj-1' AND org_agent_id = 'a-1'",
                [],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .unwrap();
        assert_eq!(version, 4);
        assert_eq!(hash, "h-4");

        let count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM project_agent_bindings",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(count, 1, "rebound must update, not insert a second row");
    }

    #[test]
    fn apply_binding_action_unbound_deletes_row() {
        let conn = in_memory_agents_db();
        apply_binding_action(&conn, &mk_binding("proj-1", "a-1", 3, "h-3"), "bound").unwrap();
        apply_binding_action(&conn, &mk_binding("proj-1", "a-1", 3, "h-3"), "unbound").unwrap();

        let count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM project_agent_bindings",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(count, 0, "unbound must delete the row");
    }

    #[test]
    fn apply_binding_snapshot_replaces_all_for_project() {
        let conn = in_memory_agents_db();
        // Seed two existing bindings.
        apply_binding_action(&conn, &mk_binding("proj-1", "a-1", 1, "h-1"), "bound").unwrap();
        apply_binding_action(&conn, &mk_binding("proj-1", "a-2", 1, "h-2"), "bound").unwrap();

        // Snapshot carries only a-1 (updated) and a new a-3; a-2 must be removed.
        let snapshot = vec![
            ProjectAgentBindingSnapshotEntry {
                binding_id: "bind-1".into(),
                org_agent_id: "a-1".into(),
                agent_name: "triage".into(),
                pinned_version: 2,
                pinned_content_hash: "h-1-v2".into(),
            },
            ProjectAgentBindingSnapshotEntry {
                binding_id: "bind-3".into(),
                org_agent_id: "a-3".into(),
                agent_name: "reviewer".into(),
                pinned_version: 1,
                pinned_content_hash: "h-3".into(),
            },
        ];
        apply_binding_snapshot(&conn, "proj-1", &snapshot).expect("snapshot apply");

        let count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM project_agent_bindings WHERE project_id = 'proj-1'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(count, 2, "snapshot must leave exactly 2 bindings");

        // a-1 must have been updated to v2.
        let version: i64 = conn
            .query_row(
                "SELECT pinned_version FROM project_agent_bindings
                 WHERE project_id = 'proj-1' AND org_agent_id = 'a-1'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(version, 2);

        // a-2 must no longer exist.
        let exists: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM project_agent_bindings WHERE org_agent_id = 'a-2'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(exists, 0, "a-2 must have been removed by snapshot reconcile");
    }

    #[test]
    fn apply_binding_snapshot_does_not_touch_other_projects() {
        let conn = in_memory_agents_db();
        // Binding for proj-2 must survive a snapshot for proj-1.
        apply_binding_action(&conn, &mk_binding("proj-2", "a-1", 1, "h-1"), "bound").unwrap();

        apply_binding_snapshot(&conn, "proj-1", &[]).expect("empty snapshot for proj-1");

        let count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM project_agent_bindings WHERE project_id = 'proj-2'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(count, 1, "proj-2 binding must not be affected by proj-1 snapshot");
    }
}
