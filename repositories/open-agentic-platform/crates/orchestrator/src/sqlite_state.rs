// SPDX-License-Identifier: AGPL-3.0-or-later
// Feature 052 Phase 4: SQLite backend for workflow state and events.
//
// This module provides the local-SQLite implementation of `WorkflowStore` and
// `EventNotifier` (defined in `store.rs`).  It wraps a `rusqlite::Connection`
// in an `Arc<std::sync::Mutex<>>` so the async trait methods can safely call
// into the synchronous rusqlite API via `tokio::task::spawn_blocking`.

use crate::OrchestratorError;
use crate::artifact::ArtifactManager;
use crate::state::{GateInfo, StepExecutionStatus, StepState, WorkflowState, WorkflowStatus};
use crate::store::{
    EventNotifier, EventReceiver, PersistedEvent, ReplaySubscription, WorkflowStore,
};
use async_trait::async_trait;
use dashmap::DashMap;
use rusqlite::{Connection, OptionalExtension, params};
use serde_json::Value as JsonValue;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex as StdMutex};
use tokio::sync::broadcast;
use uuid::Uuid;

/// Computes the canonical SQLite database path for a given run directory.
pub fn sqlite_db_path_for_run_dir(run_dir: &Path) -> PathBuf {
    run_dir.join("state.sqlite")
}

/// Computes the canonical SQLite database path for a workflow using the artifact manager.
pub fn sqlite_db_path_for_run(artifact_base: &ArtifactManager, workflow_id: Uuid) -> PathBuf {
    let run_dir = artifact_base.run_dir(workflow_id);
    sqlite_db_path_for_run_dir(&run_dir)
}

/// SQLite-backed store for workflow state and events (052 FR-001, FR-002, FR-007).
///
/// The connection is wrapped in `Arc<std::sync::Mutex<>>` so it can be shared
/// across async tasks via `spawn_blocking`.
#[derive(Clone)]
pub struct SqliteWorkflowStore {
    conn: Arc<StdMutex<Connection>>,
}

/// Default broadcast channel capacity — sized for NF-002 (50 concurrent
/// subscribers) with headroom for burst writes before slow readers catch up.
const DEFAULT_CHANNEL_CAPACITY: usize = 1024;

/// Returns a timestamp string for events. This mirrors the lightweight epoch-based
/// format used in `gates::chrono_now_iso` without depending on that private helper.
fn sqlite_now_ts() -> String {
    use std::time::SystemTime;
    let duration = SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .unwrap_or_default();
    let secs = duration.as_secs();
    let millis = duration.subsec_millis();
    format!("{secs}.{millis:03}")
}

impl SqliteWorkflowStore {
    /// Opens (or creates) a SQLite database at `path`, enabling WAL mode and
    /// initializing the schema if needed.
    pub fn open(path: &Path) -> Result<Self, OrchestratorError> {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).map_err(|e| OrchestratorError::StatePersistence {
                reason: format!("create sqlite state dir {}: {e}", parent.display()),
            })?;
        }

        let conn = Connection::open(path).map_err(|e| OrchestratorError::StatePersistence {
            reason: format!("open sqlite state db {}: {e}", path.display()),
        })?;

        // Enable WAL mode for better concurrent read performance (052 NF-001).
        conn.pragma_update(None, "journal_mode", "WAL")
            .map_err(|e| OrchestratorError::StatePersistence {
                reason: format!("enable WAL journal mode on {}: {e}", path.display()),
            })?;

        // Disable FK enforcement so conversation-scoped events can be inserted
        // without a corresponding workflows row.  The events table schema
        // declares a REFERENCES clause for backward compatibility but the
        // constraint is logically optional for non-workflow scopes.
        conn.pragma_update(None, "foreign_keys", "OFF")
            .map_err(|e| OrchestratorError::StatePersistence {
                reason: format!("disable foreign_keys pragma on {}: {e}", path.display()),
            })?;

        // Initialize schema if it does not exist yet.
        conn.execute_batch(
            r#"
            CREATE TABLE IF NOT EXISTS workflows (
              workflow_id   TEXT PRIMARY KEY,
              workflow_name TEXT NOT NULL,
              status        TEXT NOT NULL,
              started_at    TEXT NOT NULL,
              completed_at  TEXT,
              metadata      TEXT
            );

            CREATE TABLE IF NOT EXISTS steps (
              step_id       TEXT NOT NULL,
              workflow_id   TEXT NOT NULL REFERENCES workflows(workflow_id),
              step_index    INTEGER NOT NULL,
              name          TEXT NOT NULL,
              status        TEXT NOT NULL,
              started_at    TEXT,
              completed_at  TEXT,
              duration_ms   INTEGER,
              output        TEXT,
              gate_type     TEXT,
              gate_config   TEXT,
              PRIMARY KEY (workflow_id, step_id)
            );

            CREATE TABLE IF NOT EXISTS events (
              event_id      INTEGER PRIMARY KEY AUTOINCREMENT,
              workflow_id   TEXT NOT NULL REFERENCES workflows(workflow_id),
              timestamp     TEXT NOT NULL,
              event_type    TEXT NOT NULL,
              payload       TEXT NOT NULL
            );
            "#,
        )
        .map_err(|e| OrchestratorError::StatePersistence {
            reason: format!("initialize sqlite schema in {}: {e}", path.display()),
        })?;

        // Migration: add `scope` column for multi-domain event support (workflow
        // vs conversation).  Existing rows default to 'workflow'.  The migration
        // is idempotent — ALTER TABLE ADD COLUMN fails silently if the column
        // already exists.
        let has_scope: bool = conn
            .prepare("PRAGMA table_info(events)")
            .and_then(|mut stmt| {
                let rows = stmt.query_map([], |row| {
                    let name: String = row.get(1)?;
                    Ok(name)
                })?;
                let mut found = false;
                for name in rows {
                    if name.map(|n| n == "scope").unwrap_or(false) {
                        found = true;
                        break;
                    }
                }
                Ok(found)
            })
            .unwrap_or(false);

        if !has_scope {
            let _ = conn.execute_batch(
                "ALTER TABLE events ADD COLUMN scope TEXT NOT NULL DEFAULT 'workflow';",
            );
        }

        // Migration: add `project_id` column to `workflows` table for
        // project-scoped queries (099 Slice 3 (project-scoped per spec 119)).  Idempotent — mirrors the
        // `scope` migration pattern above.
        let has_project_id: bool = conn
            .prepare("PRAGMA table_info(workflows)")
            .and_then(|mut stmt| {
                let rows = stmt.query_map([], |row| {
                    let name: String = row.get(1)?;
                    Ok(name)
                })?;
                let mut found = false;
                for name in rows {
                    if name.map(|n| n == "project_id").unwrap_or(false) {
                        found = true;
                        break;
                    }
                }
                Ok(found)
            })
            .unwrap_or(false);

        if !has_project_id {
            let _ = conn.execute_batch(
                "ALTER TABLE workflows ADD COLUMN project_id TEXT;
                 CREATE INDEX IF NOT EXISTS idx_workflows_project ON workflows(project_id);",
            );
        }

        // Migration: add `project_path` and `originating_session` columns
        // for the OPC multi-session orchestrator binding (spec 173 FR-006).
        // Idempotent — column presence checked via PRAGMA table_info before
        // issuing the ALTER. Pre-spec-173 rows surface as SQL NULL → Rust
        // `Option::None` without backfill.
        let workflow_cols: std::collections::HashSet<String> = conn
            .prepare("PRAGMA table_info(workflows)")
            .and_then(|mut stmt| {
                let rows = stmt.query_map([], |row| {
                    let name: String = row.get(1)?;
                    Ok(name)
                })?;
                let mut set = std::collections::HashSet::new();
                for name in rows.flatten() {
                    set.insert(name);
                }
                Ok(set)
            })
            .unwrap_or_default();

        if !workflow_cols.contains("project_path") {
            let _ = conn.execute_batch(
                "ALTER TABLE workflows ADD COLUMN project_path TEXT;
                 CREATE INDEX IF NOT EXISTS idx_workflows_project_path ON workflows(project_path);",
            );
        }
        if !workflow_cols.contains("originating_session") {
            let _ = conn.execute_batch(
                "ALTER TABLE workflows ADD COLUMN originating_session TEXT;",
            );
        }

        Ok(SqliteWorkflowStore {
            conn: Arc::new(StdMutex::new(conn)),
        })
    }

    // --- Synchronous helpers (called inside spawn_blocking) -----------------

    fn write_workflow_state_sync(
        conn: &mut Connection,
        state: &WorkflowState,
    ) -> Result<(), OrchestratorError> {
        let tx = conn
            .transaction()
            .map_err(|e| OrchestratorError::StatePersistence {
                reason: format!("begin sqlite transaction: {e}"),
            })?;

        let wf_id_str = state.workflow_id.to_string();
        let status_str = workflow_status_to_str(&state.status);
        let metadata_json = if state.metadata.is_empty() {
            None
        } else {
            Some(serde_json::to_string(&state.metadata).map_err(|e| {
                OrchestratorError::StatePersistence {
                    reason: format!("serialize workflow metadata to json: {e}"),
                }
            })?)
        };

        // Extract project_id from metadata for the dedicated column (099 Slice 3, renamed by spec 119).
        let project_id = state
            .metadata
            .get("project_id")
            .and_then(|v| v.as_str())
            .map(String::from);

        tx.execute(
            r#"
            INSERT INTO workflows (
              workflow_id, workflow_name, status, started_at, completed_at, metadata,
              project_id, project_path, originating_session
            )
            VALUES (?1, ?2, ?3, ?4, NULL, ?5, ?6, ?7, ?8)
            ON CONFLICT(workflow_id) DO UPDATE SET
              workflow_name       = excluded.workflow_name,
              status              = excluded.status,
              started_at          = excluded.started_at,
              completed_at        = excluded.completed_at,
              metadata            = excluded.metadata,
              project_id          = excluded.project_id,
              project_path        = excluded.project_path,
              originating_session = excluded.originating_session
            "#,
            params![
                wf_id_str,
                state.workflow_name,
                status_str,
                state.started_at,
                metadata_json,
                project_id,
                state.project_path,
                state.originating_session,
            ],
        )
        .map_err(|e| OrchestratorError::StatePersistence {
            reason: format!("upsert workflow row in sqlite: {e}"),
        })?;

        for (idx, step) in state.steps.iter().enumerate() {
            let status_str = step_status_to_str(&step.status);
            let output_json = step
                .output
                .as_ref()
                .map(serde_json::to_string)
                .transpose()
                .map_err(|e| OrchestratorError::StatePersistence {
                    reason: format!("serialize step output json for {}: {e}", step.id),
                })?;

            let (gate_type, gate_config) = step
                .gate
                .as_ref()
                .map(gate_info_to_sql_columns)
                .unwrap_or((None, None));

            tx.execute(
                r#"
                INSERT INTO steps (
                  step_id,
                  workflow_id,
                  step_index,
                  name,
                  status,
                  started_at,
                  completed_at,
                  duration_ms,
                  output,
                  gate_type,
                  gate_config
                )
                VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)
                ON CONFLICT(workflow_id, step_id) DO UPDATE SET
                  status       = excluded.status,
                  started_at   = excluded.started_at,
                  completed_at = excluded.completed_at,
                  duration_ms  = excluded.duration_ms,
                  output       = excluded.output,
                  gate_type    = excluded.gate_type,
                  gate_config  = excluded.gate_config
                "#,
                params![
                    step.id,
                    wf_id_str,
                    idx as i64,
                    step.name,
                    status_str,
                    step.started_at,
                    step.completed_at,
                    step.duration_ms.map(|d| d as i64),
                    output_json,
                    gate_type,
                    gate_config,
                ],
            )
            .map_err(|e| OrchestratorError::StatePersistence {
                reason: format!("upsert step row {} in sqlite: {e}", step.id),
            })?;
        }

        tx.commit()
            .map_err(|e| OrchestratorError::StatePersistence {
                reason: format!("commit sqlite transaction: {e}"),
            })?;

        Ok(())
    }

    fn load_workflow_state_sync(
        conn: &Connection,
        workflow_id: Uuid,
    ) -> Result<Option<WorkflowState>, OrchestratorError> {
        let wf_id_str = workflow_id.to_string();

        let mut stmt = conn
            .prepare(
                r#"
                SELECT workflow_name, status, started_at, completed_at, metadata,
                       project_path, originating_session
                FROM workflows
                WHERE workflow_id = ?1
                "#,
            )
            .map_err(|e| OrchestratorError::StatePersistence {
                reason: format!("prepare workflow select in sqlite: {e}"),
            })?;

        let wf_row = stmt
            .query_row([&wf_id_str], |row| {
                let name: String = row.get(0)?;
                let status_str: String = row.get(1)?;
                let started_at: String = row.get(2)?;
                let _completed_at: Option<String> = row.get(3)?;
                let metadata_text: Option<String> = row.get(4)?;
                let project_path: Option<String> = row.get(5)?;
                let originating_session: Option<String> = row.get(6)?;
                Ok((
                    name,
                    status_str,
                    started_at,
                    metadata_text,
                    project_path,
                    originating_session,
                ))
            })
            .optional()
            .map_err(|e| OrchestratorError::StatePersistence {
                reason: format!("query workflow row in sqlite: {e}"),
            })?;

        let Some((
            workflow_name,
            status_str,
            started_at,
            metadata_text,
            project_path,
            originating_session,
        )) = wf_row
        else {
            return Ok(None);
        };

        let status = workflow_status_from_str(&status_str).map_err(|msg| {
            OrchestratorError::StatePersistence {
                reason: format!("invalid workflow status '{status_str}' in sqlite: {msg}"),
            }
        })?;

        let metadata = if let Some(text) = metadata_text {
            let value: JsonValue =
                serde_json::from_str(&text).map_err(|e| OrchestratorError::StatePersistence {
                    reason: format!("decode workflow metadata json from sqlite: {e}"),
                })?;
            match value {
                JsonValue::Object(map) => map,
                _ => serde_json::Map::new(),
            }
        } else {
            serde_json::Map::new()
        };

        // Load steps ordered by step_index.
        let mut stmt_steps = conn
            .prepare(
                r#"
                SELECT
                  step_id,
                  step_index,
                  name,
                  status,
                  started_at,
                  completed_at,
                  duration_ms,
                  output,
                  gate_type,
                  gate_config
                FROM steps
                WHERE workflow_id = ?1
                ORDER BY step_index ASC
                "#,
            )
            .map_err(|e| OrchestratorError::StatePersistence {
                reason: format!("prepare steps select in sqlite: {e}"),
            })?;

        let mut steps: Vec<StepState> = Vec::new();

        let rows = stmt_steps
            .query_map([&wf_id_str], |row| {
                let step_id: String = row.get(0)?;
                let _index: i64 = row.get(1)?;
                let name: String = row.get(2)?;
                let status_str: String = row.get(3)?;
                let started_at: Option<String> = row.get(4)?;
                let completed_at: Option<String> = row.get(5)?;
                let duration_ms: Option<i64> = row.get(6)?;
                let output_text: Option<String> = row.get(7)?;
                let gate_type: Option<String> = row.get(8)?;
                let gate_config_text: Option<String> = row.get(9)?;

                Ok((
                    step_id,
                    name,
                    status_str,
                    started_at,
                    completed_at,
                    duration_ms,
                    output_text,
                    gate_type,
                    gate_config_text,
                ))
            })
            .map_err(|e| OrchestratorError::StatePersistence {
                reason: format!("query steps for workflow in sqlite: {e}"),
            })?;

        for row in rows {
            let (
                step_id,
                name,
                status_str,
                started_at,
                completed_at,
                duration_ms,
                output_text,
                gate_type,
                gate_config_text,
            ) = row.map_err(|e| OrchestratorError::StatePersistence {
                reason: format!("iterate step rows for workflow in sqlite: {e}"),
            })?;

            let status = step_status_from_str(&status_str).map_err(|msg| {
                OrchestratorError::StatePersistence {
                    reason: format!("invalid step status '{status_str}' in sqlite: {msg}"),
                }
            })?;

            let output = if let Some(text) = output_text {
                let value: JsonValue = serde_json::from_str(&text).map_err(|e| {
                    OrchestratorError::StatePersistence {
                        reason: format!("decode step output json from sqlite: {e}"),
                    }
                })?;
                Some(value)
            } else {
                None
            };

            let gate = if let Some(gate_type_str) = gate_type {
                Some(sql_columns_to_gate_info(
                    &gate_type_str,
                    gate_config_text.as_deref(),
                )?)
            } else {
                None
            };

            steps.push(StepState {
                id: step_id,
                name,
                status,
                started_at,
                completed_at,
                duration_ms: duration_ms.map(|d| d as u64),
                output,
                gate,
            });
        }

        let state = WorkflowState {
            version: 1,
            workflow_id,
            workflow_name,
            started_at,
            status,
            current_step_index: None,
            steps,
            metadata,
            project_path,
            originating_session,
        };

        Ok(Some(state))
    }

    fn append_event_sync(
        conn: &Connection,
        workflow_id: Uuid,
        event_type: &str,
        payload: &JsonValue,
        timestamp: Option<String>,
    ) -> Result<i64, OrchestratorError> {
        Self::append_scoped_event_sync(
            conn,
            workflow_id,
            "workflow",
            event_type,
            payload,
            timestamp,
        )
    }

    fn append_scoped_event_sync(
        conn: &Connection,
        entity_id: Uuid,
        scope: &str,
        event_type: &str,
        payload: &JsonValue,
        timestamp: Option<String>,
    ) -> Result<i64, OrchestratorError> {
        let id_str = entity_id.to_string();
        let ts = timestamp.unwrap_or_else(sqlite_now_ts);
        let payload_json =
            serde_json::to_string(payload).map_err(|e| OrchestratorError::StatePersistence {
                reason: format!("serialize event payload to json: {e}"),
            })?;

        conn.execute(
            r#"
                INSERT INTO events (
                  workflow_id,
                  timestamp,
                  event_type,
                  payload,
                  scope
                )
                VALUES (?1, ?2, ?3, ?4, ?5)
                "#,
            params![id_str, ts, event_type, payload_json, scope],
        )
        .map_err(|e| OrchestratorError::StatePersistence {
            reason: format!("insert {scope} event row in sqlite: {e}"),
        })?;

        Ok(conn.last_insert_rowid())
    }

    fn load_events_since_sync(
        conn: &Connection,
        workflow_id: Uuid,
        from_event_id: i64,
        limit: Option<u32>,
    ) -> Result<Vec<PersistedEvent>, OrchestratorError> {
        // Backward-compatible: loads all events regardless of scope.
        Self::load_scoped_events_since_sync(conn, workflow_id, None, from_event_id, limit)
    }

    fn load_scoped_events_since_sync(
        conn: &Connection,
        entity_id: Uuid,
        scope: Option<&str>,
        from_event_id: i64,
        limit: Option<u32>,
    ) -> Result<Vec<PersistedEvent>, OrchestratorError> {
        let id_str = entity_id.to_string();
        let effective_limit: i64 = limit.map_or(i64::MAX, |l| l as i64);

        let (sql, params_vec): (&str, Vec<Box<dyn rusqlite::types::ToSql>>) = if let Some(s) = scope
        {
            (
                r#"
                SELECT event_id, workflow_id, timestamp, event_type, payload, scope
                FROM events
                WHERE workflow_id = ?1 AND event_id > ?2 AND scope = ?3
                ORDER BY event_id ASC
                LIMIT ?4
                "#,
                vec![
                    Box::new(id_str) as Box<dyn rusqlite::types::ToSql>,
                    Box::new(from_event_id),
                    Box::new(s.to_string()),
                    Box::new(effective_limit),
                ],
            )
        } else {
            (
                r#"
                SELECT event_id, workflow_id, timestamp, event_type, payload, scope
                FROM events
                WHERE workflow_id = ?1 AND event_id > ?2
                ORDER BY event_id ASC
                LIMIT ?3
                "#,
                vec![
                    Box::new(id_str) as Box<dyn rusqlite::types::ToSql>,
                    Box::new(from_event_id),
                    Box::new(effective_limit),
                ],
            )
        };

        let mut stmt = conn
            .prepare(sql)
            .map_err(|e| OrchestratorError::StatePersistence {
                reason: format!("prepare events select in sqlite: {e}"),
            })?;

        let params_refs: Vec<&dyn rusqlite::types::ToSql> =
            params_vec.iter().map(|b| b.as_ref()).collect();

        let rows = stmt
            .query_map(params_refs.as_slice(), |row| {
                let event_id: i64 = row.get(0)?;
                let wf_id_text: String = row.get(1)?;
                let timestamp: String = row.get(2)?;
                let event_type: String = row.get(3)?;
                let payload_text: String = row.get(4)?;
                let scope: Option<String> = row.get(5).ok();
                Ok((
                    event_id,
                    wf_id_text,
                    timestamp,
                    event_type,
                    payload_text,
                    scope,
                ))
            })
            .map_err(|e| OrchestratorError::StatePersistence {
                reason: format!("query events for entity in sqlite: {e}"),
            })?;

        let mut out = Vec::new();
        for row in rows {
            let (event_id, wf_id_text, timestamp, event_type, payload_text, scope) =
                row.map_err(|e| OrchestratorError::StatePersistence {
                    reason: format!("iterate event rows in sqlite: {e}"),
                })?;

            let parsed_id =
                Uuid::parse_str(&wf_id_text).map_err(|e| OrchestratorError::StatePersistence {
                    reason: format!("decode entity uuid from sqlite events: {e}"),
                })?;

            let payload: JsonValue = serde_json::from_str(&payload_text).map_err(|e| {
                OrchestratorError::StatePersistence {
                    reason: format!("decode event payload json from sqlite: {e}"),
                }
            })?;

            out.push(PersistedEvent {
                event_id,
                workflow_id: parsed_id,
                timestamp,
                event_type,
                payload,
                scope,
            });
        }

        Ok(out)
    }
}

// ---------------------------------------------------------------------------
// Workspace-scoped queries (099 Slice 5, spec 173 §2.2)
// ---------------------------------------------------------------------------

impl SqliteWorkflowStore {
    /// List workflow summaries for a given filesystem `project_path`
    /// (spec 173 FR-003, §2.2). Results are sorted by `started_at` DESC
    /// (most recent first) to support spec 172's Live Sessions panel.
    ///
    /// `project_path` is the spec 157 JSONL-authoritative filesystem path.
    /// Two OPC sessions for the same workstation path accumulate in the
    /// same bucket; the orchestrator does not disambiguate by developer
    /// identity (spec 173 FR-005, inheriting spec 157 §4).
    ///
    /// Workflows initiated outside OPC (`project_path` IS NULL) are
    /// excluded from this surface — they remain reachable via the
    /// existing per-task and per-project-id surfaces.
    pub async fn list_workflows_by_project_path(
        &self,
        project_path: &str,
        limit: Option<u32>,
    ) -> Result<Vec<crate::state::WorkflowStateSummary>, OrchestratorError> {
        let conn = Arc::clone(&self.conn);
        let path = project_path.to_string();
        let lim = limit.unwrap_or(50) as i64;
        tokio::task::spawn_blocking(move || {
            let guard = conn
                .lock()
                .map_err(|e| OrchestratorError::StatePersistence {
                    reason: format!("lock sqlite conn: {e}"),
                })?;
            let mut stmt = guard
                .prepare(
                    "SELECT workflow_id, workflow_name, status, started_at, project_id,
                            project_path, originating_session
                     FROM workflows
                     WHERE project_path = ?1
                     ORDER BY started_at DESC
                     LIMIT ?2",
                )
                .map_err(|e| OrchestratorError::StatePersistence {
                    reason: format!("prepare list_workflows_by_project_path: {e}"),
                })?;
            let rows = stmt
                .query_map(rusqlite::params![path, lim], |row| {
                    Ok(crate::state::WorkflowStateSummary {
                        workflow_id: row.get(0)?,
                        workflow_name: row.get(1)?,
                        status: row.get(2)?,
                        started_at: row.get(3)?,
                        project_id: row.get(4)?,
                        project_path: row.get(5)?,
                        originating_session: row.get(6)?,
                        current_step_name: None,
                        current_step_index: None,
                        current_step_started_at: None,
                        step_count: None,
                    })
                })
                .map_err(|e| OrchestratorError::StatePersistence {
                    reason: format!("query list_workflows_by_project_path: {e}"),
                })?;
            let mut results = Vec::new();
            for row in rows {
                results.push(row.map_err(|e| OrchestratorError::StatePersistence {
                    reason: format!("map row: {e}"),
                })?);
            }
            Ok(results)
        })
        .await
        .map_err(|e| OrchestratorError::StatePersistence {
            reason: format!("spawn_blocking: {e}"),
        })?
    }

    /// List workflow summaries for a given project_id (099 Slice 5 (project-scoped per spec 119)).
    pub async fn list_workflows_by_project(
        &self,
        project_id: &str,
        limit: Option<u32>,
    ) -> Result<Vec<crate::state::WorkflowStateSummary>, OrchestratorError> {
        let conn = Arc::clone(&self.conn);
        let proj_id = project_id.to_string();
        let lim = limit.unwrap_or(50) as i64;
        tokio::task::spawn_blocking(move || {
            let guard = conn
                .lock()
                .map_err(|e| OrchestratorError::StatePersistence {
                    reason: format!("lock sqlite conn: {e}"),
                })?;
            let mut stmt = guard
                .prepare(
                    "SELECT workflow_id, workflow_name, status, started_at, project_id,
                            project_path, originating_session
                     FROM workflows
                     WHERE project_id = ?1
                     ORDER BY started_at DESC
                     LIMIT ?2",
                )
                .map_err(|e| OrchestratorError::StatePersistence {
                    reason: format!("prepare list_workflows_by_project: {e}"),
                })?;
            let rows = stmt
                .query_map(rusqlite::params![proj_id, lim], |row| {
                    Ok(crate::state::WorkflowStateSummary {
                        workflow_id: row.get(0)?,
                        workflow_name: row.get(1)?,
                        status: row.get(2)?,
                        started_at: row.get(3)?,
                        project_id: row.get(4)?,
                        project_path: row.get(5)?,
                        originating_session: row.get(6)?,
                        current_step_name: None,
                        current_step_index: None,
                        current_step_started_at: None,
                        step_count: None,
                    })
                })
                .map_err(|e| OrchestratorError::StatePersistence {
                    reason: format!("query list_workflows_by_project: {e}"),
                })?;
            let mut results = Vec::new();
            for row in rows {
                results.push(row.map_err(|e| OrchestratorError::StatePersistence {
                    reason: format!("map row: {e}"),
                })?);
            }
            Ok(results)
        })
        .await
        .map_err(|e| OrchestratorError::StatePersistence {
            reason: format!("spawn_blocking: {e}"),
        })?
    }

    /// Spec 172 §2.4 — list workflows whose status is `running` or
    /// `awaiting_checkpoint`, enriched with the currently-running step from
    /// the `steps` table. The returned summary is the orchestrator's
    /// consumer surface for the Live Sessions panel; per spec 103 the panel
    /// MUST NOT parse the underlying SQLite rows directly.
    pub async fn list_active_workflows(
        &self,
        limit: Option<u32>,
    ) -> Result<Vec<crate::state::WorkflowStateSummary>, OrchestratorError> {
        let conn = Arc::clone(&self.conn);
        let lim = limit.unwrap_or(50) as i64;
        tokio::task::spawn_blocking(move || {
            let guard = conn
                .lock()
                .map_err(|e| OrchestratorError::StatePersistence {
                    reason: format!("lock sqlite conn: {e}"),
                })?;

            let mut stmt = guard
                .prepare(
                    "SELECT workflow_id, workflow_name, status, started_at, project_id,
                            project_path, originating_session
                     FROM workflows
                     WHERE status IN ('running', 'awaiting_checkpoint')
                     ORDER BY started_at DESC
                     LIMIT ?1",
                )
                .map_err(|e| OrchestratorError::StatePersistence {
                    reason: format!("prepare list_active_workflows: {e}"),
                })?;

            let rows = stmt
                .query_map(rusqlite::params![lim], |row| {
                    Ok(crate::state::WorkflowStateSummary {
                        workflow_id: row.get(0)?,
                        workflow_name: row.get(1)?,
                        status: row.get(2)?,
                        started_at: row.get(3)?,
                        project_id: row.get(4)?,
                        project_path: row.get(5)?,
                        originating_session: row.get(6)?,
                        current_step_name: None,
                        current_step_index: None,
                        current_step_started_at: None,
                        step_count: None,
                    })
                })
                .map_err(|e| OrchestratorError::StatePersistence {
                    reason: format!("query list_active_workflows: {e}"),
                })?;

            let mut summaries: Vec<crate::state::WorkflowStateSummary> = Vec::new();
            for row in rows {
                summaries.push(row.map_err(|e| OrchestratorError::StatePersistence {
                    reason: format!("map active workflow row: {e}"),
                })?);
            }

            // Enrich each summary with its currently-running step (or first
            // pending step if no running step exists yet) and the total step
            // count. Empty result -> the summary keeps `None` everywhere.
            for s in summaries.iter_mut() {
                let mut step_stmt = guard
                    .prepare(
                        "SELECT step_index, name, started_at
                         FROM steps
                         WHERE workflow_id = ?1 AND status = 'running'
                         ORDER BY step_index ASC
                         LIMIT 1",
                    )
                    .map_err(|e| OrchestratorError::StatePersistence {
                        reason: format!("prepare active step lookup: {e}"),
                    })?;

                let row_opt = step_stmt
                    .query_row(rusqlite::params![s.workflow_id.clone()], |row| {
                        let idx: i64 = row.get(0)?;
                        let name: String = row.get(1)?;
                        let started_at: Option<String> = row.get(2)?;
                        Ok((idx, name, started_at))
                    })
                    .optional()
                    .map_err(|e| OrchestratorError::StatePersistence {
                        reason: format!("query active step: {e}"),
                    })?;

                if let Some((idx, name, started_at)) = row_opt {
                    s.current_step_index = Some(idx as u32);
                    s.current_step_name = Some(name);
                    s.current_step_started_at = started_at;
                }

                let count: i64 = guard
                    .query_row(
                        "SELECT COUNT(*) FROM steps WHERE workflow_id = ?1",
                        rusqlite::params![s.workflow_id.clone()],
                        |row| row.get(0),
                    )
                    .unwrap_or(0);
                if count > 0 {
                    s.step_count = Some(count as u32);
                }
            }

            Ok(summaries)
        })
        .await
        .map_err(|e| OrchestratorError::StatePersistence {
            reason: format!("spawn_blocking: {e}"),
        })?
    }
}

// ---------------------------------------------------------------------------
// WorkflowStore trait implementation
// ---------------------------------------------------------------------------

#[async_trait]
impl WorkflowStore for SqliteWorkflowStore {
    async fn write_workflow_state(&self, state: &WorkflowState) -> Result<(), OrchestratorError> {
        let conn = Arc::clone(&self.conn);
        let state = state.clone();
        tokio::task::spawn_blocking(move || {
            let mut guard = conn
                .lock()
                .map_err(|e| OrchestratorError::StatePersistence {
                    reason: format!("lock sqlite connection: {e}"),
                })?;
            Self::write_workflow_state_sync(&mut guard, &state)
        })
        .await
        .map_err(|e| OrchestratorError::StatePersistence {
            reason: format!("spawn_blocking join: {e}"),
        })?
    }

    async fn load_workflow_state(
        &self,
        workflow_id: Uuid,
    ) -> Result<Option<WorkflowState>, OrchestratorError> {
        let conn = Arc::clone(&self.conn);
        tokio::task::spawn_blocking(move || {
            let guard = conn
                .lock()
                .map_err(|e| OrchestratorError::StatePersistence {
                    reason: format!("lock sqlite connection: {e}"),
                })?;
            Self::load_workflow_state_sync(&guard, workflow_id)
        })
        .await
        .map_err(|e| OrchestratorError::StatePersistence {
            reason: format!("spawn_blocking join: {e}"),
        })?
    }

    async fn append_event(
        &self,
        workflow_id: Uuid,
        event_type: &str,
        payload: &JsonValue,
        timestamp: Option<String>,
    ) -> Result<i64, OrchestratorError> {
        let conn = Arc::clone(&self.conn);
        let event_type = event_type.to_string();
        let payload = payload.clone();
        tokio::task::spawn_blocking(move || {
            let guard = conn
                .lock()
                .map_err(|e| OrchestratorError::StatePersistence {
                    reason: format!("lock sqlite connection: {e}"),
                })?;
            Self::append_event_sync(&guard, workflow_id, &event_type, &payload, timestamp)
        })
        .await
        .map_err(|e| OrchestratorError::StatePersistence {
            reason: format!("spawn_blocking join: {e}"),
        })?
    }

    async fn load_events_since(
        &self,
        workflow_id: Uuid,
        from_event_id: i64,
        limit: Option<u32>,
    ) -> Result<Vec<PersistedEvent>, OrchestratorError> {
        let conn = Arc::clone(&self.conn);
        tokio::task::spawn_blocking(move || {
            let guard = conn
                .lock()
                .map_err(|e| OrchestratorError::StatePersistence {
                    reason: format!("lock sqlite connection: {e}"),
                })?;
            Self::load_events_since_sync(&guard, workflow_id, from_event_id, limit)
        })
        .await
        .map_err(|e| OrchestratorError::StatePersistence {
            reason: format!("spawn_blocking join: {e}"),
        })?
    }

    async fn append_scoped_event(
        &self,
        entity_id: Uuid,
        scope: &str,
        event_type: &str,
        payload: &JsonValue,
        timestamp: Option<String>,
    ) -> Result<i64, OrchestratorError> {
        let conn = Arc::clone(&self.conn);
        let scope = scope.to_string();
        let event_type = event_type.to_string();
        let payload = payload.clone();
        tokio::task::spawn_blocking(move || {
            let guard = conn
                .lock()
                .map_err(|e| OrchestratorError::StatePersistence {
                    reason: format!("lock sqlite connection: {e}"),
                })?;
            Self::append_scoped_event_sync(
                &guard,
                entity_id,
                &scope,
                &event_type,
                &payload,
                timestamp,
            )
        })
        .await
        .map_err(|e| OrchestratorError::StatePersistence {
            reason: format!("spawn_blocking join: {e}"),
        })?
    }

    async fn load_scoped_events_since(
        &self,
        entity_id: Uuid,
        scope: &str,
        from_event_id: i64,
        limit: Option<u32>,
    ) -> Result<Vec<PersistedEvent>, OrchestratorError> {
        let conn = Arc::clone(&self.conn);
        let scope = scope.to_string();
        tokio::task::spawn_blocking(move || {
            let guard = conn
                .lock()
                .map_err(|e| OrchestratorError::StatePersistence {
                    reason: format!("lock sqlite connection: {e}"),
                })?;
            Self::load_scoped_events_since_sync(
                &guard,
                entity_id,
                Some(&scope),
                from_event_id,
                limit,
            )
        })
        .await
        .map_err(|e| OrchestratorError::StatePersistence {
            reason: format!("spawn_blocking join: {e}"),
        })?
    }
}

// ---------------------------------------------------------------------------
// LocalEventNotifier — in-process broadcast via tokio channels
// ---------------------------------------------------------------------------

/// In-process event notification layer backed by `tokio::broadcast` channels.
///
/// Maintains a `DashMap<Uuid, broadcast::Sender>` keyed by workflow ID so each
/// workflow has an isolated broadcast channel.
#[derive(Clone)]
pub struct LocalEventNotifier {
    channels: Arc<DashMap<Uuid, broadcast::Sender<PersistedEvent>>>,
}

impl LocalEventNotifier {
    pub fn new() -> Self {
        Self {
            channels: Arc::new(DashMap::new()),
        }
    }

    /// Ensures a broadcast channel exists for the given workflow, returning
    /// the sender.
    fn ensure_channel(&self, workflow_id: Uuid) -> broadcast::Sender<PersistedEvent> {
        self.channels
            .entry(workflow_id)
            .or_insert_with(|| broadcast::channel(DEFAULT_CHANNEL_CAPACITY).0)
            .clone()
    }
}

impl Default for LocalEventNotifier {
    fn default() -> Self {
        Self::new()
    }
}

#[async_trait]
impl EventNotifier for LocalEventNotifier {
    async fn notify(&self, workflow_id: Uuid, event: PersistedEvent) {
        let tx = self.ensure_channel(workflow_id);
        // Returns Err only when there are zero receivers — normal, not an error.
        let _ = tx.send(event);
    }

    async fn subscribe_with_replay(
        &self,
        store: &dyn WorkflowStore,
        workflow_id: Uuid,
        from_event_id: i64,
    ) -> Result<ReplaySubscription, OrchestratorError> {
        // Subscribe first so we don't miss events written between the store
        // read and subscription.
        let tx = self.ensure_channel(workflow_id);
        let subscriber = EventReceiver::new(tx.subscribe());

        // Load historical events from the store.
        let replay = store
            .load_events_since(workflow_id, from_event_id, None)
            .await?;

        let high_water_mark = replay.last().map(|e| e.event_id).unwrap_or(from_event_id);

        Ok(ReplaySubscription {
            replay,
            high_water_mark,
            subscriber,
        })
    }
}

// ---------------------------------------------------------------------------
// Conversion helpers
// ---------------------------------------------------------------------------

fn workflow_status_to_str(status: &WorkflowStatus) -> &'static str {
    match status {
        WorkflowStatus::Running => "running",
        WorkflowStatus::Completed => "completed",
        WorkflowStatus::CompletedLocal => "completed_local",
        WorkflowStatus::Failed => "failed",
        WorkflowStatus::TimedOut => "timed_out",
        WorkflowStatus::AwaitingCheckpoint => "awaiting_checkpoint",
    }
}

fn workflow_status_from_str(s: &str) -> Result<WorkflowStatus, &'static str> {
    match s {
        "running" => Ok(WorkflowStatus::Running),
        "completed" => Ok(WorkflowStatus::Completed),
        "completed_local" => Ok(WorkflowStatus::CompletedLocal),
        "failed" => Ok(WorkflowStatus::Failed),
        "timed_out" => Ok(WorkflowStatus::TimedOut),
        "awaiting_checkpoint" => Ok(WorkflowStatus::AwaitingCheckpoint),
        _ => Err("unrecognized workflow status"),
    }
}

fn step_status_to_str(status: &StepExecutionStatus) -> &'static str {
    match status {
        StepExecutionStatus::Pending => "pending",
        StepExecutionStatus::Running => "running",
        StepExecutionStatus::Completed => "completed",
        StepExecutionStatus::Failed => "failed",
        StepExecutionStatus::Skipped => "skipped",
        StepExecutionStatus::CacheHit => "cache_hit",
    }
}

fn step_status_from_str(s: &str) -> Result<StepExecutionStatus, &'static str> {
    match s {
        "pending" => Ok(StepExecutionStatus::Pending),
        "running" => Ok(StepExecutionStatus::Running),
        "completed" => Ok(StepExecutionStatus::Completed),
        "failed" => Ok(StepExecutionStatus::Failed),
        "skipped" => Ok(StepExecutionStatus::Skipped),
        "cache_hit" => Ok(StepExecutionStatus::CacheHit),
        _ => Err("unrecognized step status"),
    }
}

fn gate_info_to_sql_columns(gate: &GateInfo) -> (Option<String>, Option<String>) {
    let gate_type = Some(gate.gate_type.clone());
    let config_json = gate
        .config
        .as_ref()
        .map(serde_json::to_string)
        .transpose()
        .ok()
        .flatten();
    (gate_type, config_json)
}

fn sql_columns_to_gate_info(
    gate_type: &str,
    gate_config_json: Option<&str>,
) -> Result<GateInfo, OrchestratorError> {
    let config = if let Some(text) = gate_config_json {
        let value: JsonValue =
            serde_json::from_str(text).map_err(|e| OrchestratorError::StatePersistence {
                reason: format!("decode gate_config json from sqlite: {e}"),
            })?;
        Some(value)
    } else {
        None
    };

    Ok(GateInfo {
        gate_type: gate_type.to_string(),
        timeout_ms: None,
        config,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::state::WorkflowState;

    #[tokio::test]
    async fn sqlite_round_trip_matches_json_state_for_basic_fields() {
        let tmp = tempfile::tempdir().unwrap();
        let artifact_base = ArtifactManager::new(tmp.path());
        let wf_id = Uuid::new_v4();

        let mut meta = serde_json::Map::new();
        meta.insert("branch".to_string(), JsonValue::from("main"));

        let mut state = WorkflowState::new(
            wf_id,
            "deploy-staging",
            "2026-03-29T10:00:00Z".to_string(),
            vec![("step_001".to_string(), "lint".to_string())],
            meta,
        );
        state.mark_step_started("step_001", "2026-03-29T10:00:01Z".to_string());
        state.mark_step_finished(
            "step_001",
            StepExecutionStatus::Completed,
            "2026-03-29T10:00:05Z".to_string(),
            Some(4000),
            Some(serde_json::json!({"summary": "ok"})),
        );

        let db_path = sqlite_db_path_for_run(&artifact_base, wf_id);
        let store = SqliteWorkflowStore::open(&db_path).expect("open sqlite store");
        store
            .write_workflow_state(&state)
            .await
            .expect("write sqlite state");

        let loaded = store
            .load_workflow_state(wf_id)
            .await
            .expect("load sqlite state")
            .expect("expected workflow row");

        assert_eq!(loaded.workflow_id, state.workflow_id);
        assert_eq!(loaded.workflow_name, state.workflow_name);
        assert_eq!(loaded.status, state.status);
        assert_eq!(loaded.steps.len(), 1);
        assert_eq!(loaded.steps[0].id, "step_001");
        assert_eq!(loaded.steps[0].status, StepExecutionStatus::Completed);
        assert_eq!(
            loaded
                .metadata
                .get("branch")
                .and_then(|v| v.as_str())
                .unwrap_or(""),
            "main"
        );
    }

    #[test]
    fn sqlite_store_enables_wal_mode() {
        let tmp = tempfile::tempdir().unwrap();
        let db_path = tmp.path().join("state.sqlite");
        let store = SqliteWorkflowStore::open(&db_path).expect("open sqlite store");

        let conn = store.conn.lock().unwrap();
        let mode: String = conn
            .query_row("PRAGMA journal_mode", [], |row| row.get(0))
            .expect("query journal_mode");

        assert_eq!(mode.to_lowercase(), "wal");
    }

    #[tokio::test]
    async fn append_and_load_events_since_respects_offset_and_limit() {
        let tmp = tempfile::tempdir().unwrap();
        let db_path = tmp.path().join("state.sqlite");
        let store = SqliteWorkflowStore::open(&db_path).expect("open sqlite store");

        let wf_id = Uuid::new_v4();

        // Ensure a corresponding workflow row exists to satisfy the FK constraint.
        let state = WorkflowState::new(
            wf_id,
            "events-test",
            "2026-03-31T00:00:00Z".to_string(),
            Vec::<(String, String)>::new(),
            serde_json::Map::new(),
        );
        store
            .write_workflow_state(&state)
            .await
            .expect("seed workflow row for events");

        // Append three events with simple payloads.
        let e1 = store
            .append_event(
                wf_id,
                "step_started",
                &JsonValue::from("step-1"),
                Some("t1".to_string()),
            )
            .await
            .expect("append event 1");
        let e2 = store
            .append_event(
                wf_id,
                "step_completed",
                &JsonValue::from("step-1"),
                Some("t2".to_string()),
            )
            .await
            .expect("append event 2");
        let e3 = store
            .append_event(
                wf_id,
                "step_started",
                &JsonValue::from("step-2"),
                Some("t3".to_string()),
            )
            .await
            .expect("append event 3");

        assert!(
            e1 < e2 && e2 < e3,
            "event ids should be monotonically increasing"
        );

        // Load all events from offset 0.
        let all_events = store
            .load_events_since(wf_id, 0, None)
            .await
            .expect("load events since 0");
        assert_eq!(all_events.len(), 3);
        assert_eq!(all_events[0].event_id, e1);
        assert_eq!(all_events[1].event_id, e2);
        assert_eq!(all_events[2].event_id, e3);

        // Load from the second event id.
        let tail_events = store
            .load_events_since(wf_id, e1, None)
            .await
            .expect("load events since e1");
        assert_eq!(tail_events.len(), 2);
        assert_eq!(tail_events[0].event_id, e2);
        assert_eq!(tail_events[1].event_id, e3);

        // Load with a limit of 1 from the start.
        let limited_events = store
            .load_events_since(wf_id, 0, Some(1))
            .await
            .expect("load limited events");
        assert_eq!(limited_events.len(), 1);
        assert_eq!(limited_events[0].event_id, e1);
    }

    #[tokio::test]
    async fn scoped_events_are_isolated_by_scope() {
        let tmp = tempfile::tempdir().unwrap();
        let db_path = tmp.path().join("state.sqlite");
        let store = SqliteWorkflowStore::open(&db_path).expect("open sqlite store");

        // Use the same entity_id for both scopes to prove isolation.
        let entity_id = Uuid::new_v4();

        // Seed a workflow row so the FK on workflow_id is satisfied.
        let state = WorkflowState::new(
            entity_id,
            "scope-test",
            "2026-04-05T00:00:00Z".to_string(),
            Vec::<(String, String)>::new(),
            serde_json::Map::new(),
        );
        store
            .write_workflow_state(&state)
            .await
            .expect("seed workflow row");

        // Append one workflow event and one conversation event.
        let _wf_eid = store
            .append_scoped_event(
                entity_id,
                "workflow",
                "step_started",
                &JsonValue::from("step-1"),
                Some("t1".to_string()),
            )
            .await
            .expect("append workflow event");

        let conv_eid = store
            .append_scoped_event(
                entity_id,
                "conversation",
                "message",
                &JsonValue::from("hello"),
                Some("t2".to_string()),
            )
            .await
            .expect("append conversation event");

        // Loading workflow-scoped events should return only the workflow event.
        let wf_events = store
            .load_scoped_events_since(entity_id, "workflow", 0, None)
            .await
            .expect("load workflow events");
        assert_eq!(wf_events.len(), 1);
        assert_eq!(wf_events[0].event_type, "step_started");
        assert_eq!(wf_events[0].scope.as_deref(), Some("workflow"));

        // Loading conversation-scoped events should return only the conversation event.
        let conv_events = store
            .load_scoped_events_since(entity_id, "conversation", 0, None)
            .await
            .expect("load conversation events");
        assert_eq!(conv_events.len(), 1);
        assert_eq!(conv_events[0].event_id, conv_eid);
        assert_eq!(conv_events[0].event_type, "message");
        assert_eq!(conv_events[0].scope.as_deref(), Some("conversation"));

        // The unscoped load_events_since should return both.
        let all_events = store
            .load_events_since(entity_id, 0, None)
            .await
            .expect("load all events");
        assert_eq!(all_events.len(), 2);
    }

    #[tokio::test]
    async fn conversation_events_do_not_require_workflow_row() {
        let tmp = tempfile::tempdir().unwrap();
        let db_path = tmp.path().join("state.sqlite");
        let store = SqliteWorkflowStore::open(&db_path).expect("open sqlite store");

        // Use a session UUID that has no corresponding workflow row.
        let session_id = Uuid::new_v4();

        // This should succeed because FK enforcement is off by default in SQLite.
        let eid = store
            .append_scoped_event(
                session_id,
                "conversation",
                "user_message",
                &JsonValue::from("how are you?"),
                Some("t1".to_string()),
            )
            .await
            .expect("append conversation event without workflow row");

        assert!(eid > 0);

        let events = store
            .load_scoped_events_since(session_id, "conversation", 0, None)
            .await
            .expect("load conversation events");
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].event_type, "user_message");
    }

    #[tokio::test]
    async fn list_active_workflows_filters_by_running_status_and_enriches_step() {
        let tmp = tempfile::tempdir().unwrap();
        let db_path = tmp.path().join("state.sqlite");
        let store = SqliteWorkflowStore::open(&db_path).expect("open sqlite store");

        // One running workflow with a running step.
        let running_id = Uuid::new_v4();
        let mut running = WorkflowState::new(
            running_id,
            "deploy-prod",
            "2026-05-23T10:00:00Z".to_string(),
            vec![
                ("step_001".to_string(), "lint".to_string()),
                ("step_002".to_string(), "deploy".to_string()),
            ],
            serde_json::Map::new(),
        );
        running.status = WorkflowStatus::Running;
        running.mark_step_started("step_002", "2026-05-23T10:00:10Z".to_string());
        store
            .write_workflow_state(&running)
            .await
            .expect("seed running");

        // One completed workflow — must be filtered out.
        let done_id = Uuid::new_v4();
        let mut done = WorkflowState::new(
            done_id,
            "deploy-staging",
            "2026-05-23T09:00:00Z".to_string(),
            vec![("step_a".to_string(), "lint".to_string())],
            serde_json::Map::new(),
        );
        done.status = WorkflowStatus::Completed;
        store.write_workflow_state(&done).await.expect("seed done");

        let active = store
            .list_active_workflows(None)
            .await
            .expect("list active");

        assert_eq!(active.len(), 1, "only running workflow should be returned");
        let s = &active[0];
        assert_eq!(s.workflow_id, running_id.to_string());
        assert_eq!(s.status, "running");
        assert_eq!(s.current_step_name.as_deref(), Some("deploy"));
        assert_eq!(s.current_step_index, Some(1));
        assert_eq!(s.step_count, Some(2));
        assert_eq!(
            s.current_step_started_at.as_deref(),
            Some("2026-05-23T10:00:10Z")
        );
    }

    #[tokio::test]
    async fn scope_migration_is_idempotent() {
        let tmp = tempfile::tempdir().unwrap();
        let db_path = tmp.path().join("state.sqlite");

        // Open twice — the migration should be idempotent.
        let _store1 = SqliteWorkflowStore::open(&db_path).expect("first open");
        let store2 = SqliteWorkflowStore::open(&db_path).expect("second open");

        // Verify we can still append scoped events after double-open.
        let session_id = Uuid::new_v4();
        let eid = store2
            .append_scoped_event(
                session_id,
                "conversation",
                "test",
                &JsonValue::from("ok"),
                None,
            )
            .await
            .expect("append after double open");
        assert!(eid > 0);
    }

    // -----------------------------------------------------------------------
    // Spec 173: OPC multi-session orchestrator binding
    // -----------------------------------------------------------------------

    /// Helper: persist a workflow row with optional origin fields.
    async fn seed_workflow_with_origin(
        store: &SqliteWorkflowStore,
        workflow_id: Uuid,
        started_at: &str,
        project_path: Option<&str>,
        originating_session: Option<&str>,
    ) {
        let state = WorkflowState::new(
            workflow_id,
            "spec-173-workflow",
            started_at.to_string(),
            Vec::<(String, String)>::new(),
            serde_json::Map::new(),
        )
        .with_origin(
            project_path.map(String::from),
            originating_session.map(String::from),
        );
        store
            .write_workflow_state(&state)
            .await
            .expect("seed workflow row");
    }

    /// SC-001: an OPC-initiated workflow carries `project_path` matching the
    /// spec 157 JSONL-authoritative path.
    #[tokio::test]
    async fn spec_173_sc001_opc_origin_round_trips() {
        let tmp = tempfile::tempdir().unwrap();
        let db_path = tmp.path().join("state.sqlite");
        let store = SqliteWorkflowStore::open(&db_path).expect("open sqlite store");

        let workflow_id = Uuid::new_v4();
        let session_id = Uuid::new_v4().to_string();
        let project_path = "open-agentic-platform";

        seed_workflow_with_origin(
            &store,
            workflow_id,
            "2026-05-23T10:00:00Z",
            Some(project_path),
            Some(&session_id),
        )
        .await;

        let loaded = store
            .load_workflow_state(workflow_id)
            .await
            .expect("load")
            .expect("workflow row present");

        assert_eq!(loaded.project_path.as_deref(), Some(project_path));
        assert_eq!(loaded.originating_session.as_deref(), Some(session_id.as_str()));
    }

    /// SC-002: querying workflows by project path returns all workflows for
    /// that path, across sessions and developers, sorted by recency.
    #[tokio::test]
    async fn spec_173_sc002_list_by_project_path_sorted_by_recency() {
        let tmp = tempfile::tempdir().unwrap();
        let db_path = tmp.path().join("state.sqlite");
        let store = SqliteWorkflowStore::open(&db_path).expect("open sqlite store");

        let project_path = "open-agentic-platform";
        let other_path = "other-repo";

        // Two OPC sessions for the same project — represents the spec 157
        // multi-session-per-path discipline.
        let session_a = Uuid::new_v4().to_string();
        let session_b = Uuid::new_v4().to_string();

        let wf_old = Uuid::new_v4();
        let wf_mid = Uuid::new_v4();
        let wf_new = Uuid::new_v4();
        let wf_other = Uuid::new_v4();

        seed_workflow_with_origin(
            &store,
            wf_old,
            "2026-05-20T10:00:00Z",
            Some(project_path),
            Some(&session_a),
        )
        .await;
        seed_workflow_with_origin(
            &store,
            wf_mid,
            "2026-05-21T10:00:00Z",
            Some(project_path),
            Some(&session_b),
        )
        .await;
        seed_workflow_with_origin(
            &store,
            wf_new,
            "2026-05-22T10:00:00Z",
            Some(project_path),
            Some(&session_a),
        )
        .await;
        seed_workflow_with_origin(
            &store,
            wf_other,
            "2026-05-22T10:00:00Z",
            Some(other_path),
            Some(&session_a),
        )
        .await;

        let results = store
            .list_workflows_by_project_path(project_path, None)
            .await
            .expect("list_workflows_by_project_path");

        // FR-005 non-disambiguation: both sessions' workflows accumulate in
        // the same bucket.
        assert_eq!(results.len(), 3);

        // Sorted by recency (most recent first).
        assert_eq!(results[0].workflow_id, wf_new.to_string());
        assert_eq!(results[1].workflow_id, wf_mid.to_string());
        assert_eq!(results[2].workflow_id, wf_old.to_string());

        // The other-path workflow is excluded — distinct buckets.
        assert!(
            !results.iter().any(|r| r.workflow_id == wf_other.to_string()),
            "list_workflows_by_project_path must not leak across project paths"
        );

        // originating_session round-trips on the summary surface so spec 172
        // can render the "Originating agent / session" column.
        assert!(
            results.iter().all(|r| r.originating_session.is_some()),
            "originating_session must be carried on the summary surface for spec 172"
        );
    }

    /// SC-003: a workflow initiated outside OPC persists with
    /// `project_path: null` and surfaces correctly through existing consumer
    /// surfaces (load_workflow_state).
    #[tokio::test]
    async fn spec_173_sc003_non_opc_origin_persists_null() {
        let tmp = tempfile::tempdir().unwrap();
        let db_path = tmp.path().join("state.sqlite");
        let store = SqliteWorkflowStore::open(&db_path).expect("open sqlite store");

        let workflow_id = Uuid::new_v4();
        // CLI / factory-engine origin: both fields None.
        seed_workflow_with_origin(
            &store,
            workflow_id,
            "2026-05-23T10:00:00Z",
            None,
            None,
        )
        .await;

        let loaded = store
            .load_workflow_state(workflow_id)
            .await
            .expect("load")
            .expect("workflow row present");

        assert!(loaded.project_path.is_none(), "non-OPC origin -> NULL project_path");
        assert!(
            loaded.originating_session.is_none(),
            "non-OPC origin -> NULL originating_session"
        );

        // Non-OPC origins are excluded from the by-project-path surface
        // (it filters on project_path = $1) but remain reachable via
        // load_workflow_state — proving "surfaces correctly through existing
        // consumer surfaces" in SC-003.
        let empty = store
            .list_workflows_by_project_path("/no/such/path", None)
            .await
            .expect("list_workflows_by_project_path");
        assert!(empty.is_empty());
    }

    /// SC-004: the persistence schema is backward-compatible — existing
    /// pre-spec-173 workflow rows remain readable.
    ///
    /// Simulates an existing row by writing a workflow without origin fields
    /// directly through the SQL surface (NULLs for the new columns), then
    /// asserts the loader surfaces them as None and the by-project-path
    /// surface does not crash.
    #[tokio::test]
    async fn spec_173_sc004_backward_compatible_load() {
        let tmp = tempfile::tempdir().unwrap();
        let db_path = tmp.path().join("state.sqlite");
        let store = SqliteWorkflowStore::open(&db_path).expect("open sqlite store");

        // Insert a row using the legacy column set only (no project_path /
        // originating_session) — mirrors what a pre-spec-173 binary writes
        // after running the additive migration.
        let workflow_id = Uuid::new_v4();
        {
            let guard = store.conn.lock().unwrap();
            guard
                .execute(
                    "INSERT INTO workflows (workflow_id, workflow_name, status, started_at)
                     VALUES (?1, ?2, ?3, ?4)",
                    rusqlite::params![
                        workflow_id.to_string(),
                        "legacy-workflow",
                        "running",
                        "2026-05-19T10:00:00Z",
                    ],
                )
                .expect("insert legacy row");
        }

        // FR-006: SQL NULL must surface as Rust Option::None without
        // explicit handling or migration.
        let loaded = store
            .load_workflow_state(workflow_id)
            .await
            .expect("load legacy workflow")
            .expect("legacy row present");

        assert_eq!(loaded.workflow_name, "legacy-workflow");
        assert!(loaded.project_path.is_none());
        assert!(loaded.originating_session.is_none());

        // The new consumer surface does not match this row but does not
        // panic — proving the column was added cleanly to the legacy table.
        let empty = store
            .list_workflows_by_project_path("open-agentic-platform", None)
            .await
            .expect("list_workflows_by_project_path on legacy DB");
        assert!(empty.is_empty());
    }

    /// FR-006: the spec 173 migration is idempotent — opening the store
    /// twice MUST NOT fail or duplicate columns.
    #[tokio::test]
    async fn spec_173_migration_is_idempotent() {
        let tmp = tempfile::tempdir().unwrap();
        let db_path = tmp.path().join("state.sqlite");

        let _store1 = SqliteWorkflowStore::open(&db_path).expect("first open");
        let store2 = SqliteWorkflowStore::open(&db_path).expect("second open");

        // After re-open, writes that exercise the new columns still succeed.
        let workflow_id = Uuid::new_v4();
        seed_workflow_with_origin(
            &store2,
            workflow_id,
            "2026-05-23T10:00:00Z",
            Some("/tmp/proj"),
            Some("session-x"),
        )
        .await;
        let loaded = store2
            .load_workflow_state(workflow_id)
            .await
            .expect("load")
            .expect("row present");
        assert_eq!(loaded.project_path.as_deref(), Some("/tmp/proj"));
        assert_eq!(loaded.originating_session.as_deref(), Some("session-x"));
    }
}
