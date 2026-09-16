// SPDX-License-Identifier: AGPL-3.0-or-later
// Feature 052: Hiqlite (distributed SQLite via Raft) backend for workflow
// state and events.
//
// This module provides the `HiqliteWorkflowStore` (WorkflowStore) and
// `HiqliteEventNotifier` (EventNotifier) implementations that replicate
// state and events across a multi-node Raft cluster using hiqlite.
//
// Gated behind `#[cfg(feature = "distributed")]`.

use crate::OrchestratorError;
use crate::state::{GateInfo, StepExecutionStatus, StepState, WorkflowState, WorkflowStatus};
use crate::store::{
    EventNotifier, EventReceiver, PersistedEvent, ReplaySubscription, WorkflowStore,
};
use async_trait::async_trait;
use hiqlite::{Client, Param, Params};
use serde_json::Value as JsonValue;
use std::borrow::Cow;
use std::sync::Arc;
use tokio::sync::broadcast;
use uuid::Uuid;

/// Default broadcast channel capacity for local notification fan-out.
const DEFAULT_CHANNEL_CAPACITY: usize = 1024;

/// Returns a timestamp string for events (epoch-based format).
fn now_ts() -> String {
    use std::time::SystemTime;
    let duration = SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .unwrap_or_default();
    format!("{}.{:03}", duration.as_secs(), duration.subsec_millis())
}

// ---------------------------------------------------------------------------
// Schema initialisation
// ---------------------------------------------------------------------------

/// SQL statements to initialise the workflow schema. Executed once at startup.
const SCHEMA_SQL: &[&str] = &[
    r#"CREATE TABLE IF NOT EXISTS workflows (
        workflow_id   TEXT PRIMARY KEY,
        workflow_name TEXT NOT NULL,
        status        TEXT NOT NULL,
        started_at    TEXT NOT NULL,
        completed_at  TEXT,
        metadata      TEXT
    )"#,
    r#"CREATE TABLE IF NOT EXISTS steps (
        step_id       TEXT PRIMARY KEY,
        workflow_id   TEXT NOT NULL REFERENCES workflows(workflow_id),
        step_index    INTEGER NOT NULL,
        name          TEXT NOT NULL,
        status        TEXT NOT NULL,
        started_at    TEXT,
        completed_at  TEXT,
        duration_ms   INTEGER,
        output        TEXT,
        gate_type     TEXT,
        gate_config   TEXT
    )"#,
    r#"CREATE TABLE IF NOT EXISTS events (
        event_id      INTEGER PRIMARY KEY AUTOINCREMENT,
        workflow_id   TEXT NOT NULL REFERENCES workflows(workflow_id),
        timestamp     TEXT NOT NULL,
        event_type    TEXT NOT NULL,
        payload       TEXT NOT NULL
    )"#,
];

// ---------------------------------------------------------------------------
// HiqliteWorkflowStore
// ---------------------------------------------------------------------------

/// Distributed workflow store backed by a hiqlite Raft cluster.
///
/// All writes go through Raft consensus. Reads are local for low latency.
#[derive(Clone)]
pub struct HiqliteWorkflowStore {
    client: Client,
}

impl HiqliteWorkflowStore {
    /// Wraps an existing hiqlite `Client`.
    pub fn new(client: Client) -> Self {
        Self { client }
    }

    /// Initialises the workflow schema (idempotent).
    pub async fn migrate(&self) -> Result<(), OrchestratorError> {
        for ddl in SCHEMA_SQL {
            self.client
                .execute(Cow::Borrowed(*ddl), vec![])
                .await
                .map_err(|e| OrchestratorError::StatePersistence {
                    reason: format!("hiqlite schema migration: {e}"),
                })?;
        }

        // Migration: add project_id column to workflows (099 Slice 4 (project-scoped per spec 119)).
        // Idempotent — ALTER TABLE ADD COLUMN fails if column already exists;
        // we ignore the error.
        let _ = self
            .client
            .execute(
                Cow::Borrowed("ALTER TABLE workflows ADD COLUMN project_id TEXT"),
                vec![],
            )
            .await;

        // Index for project-scoped queries (099 Slice 4).
        let _ = self
            .client
            .execute(
                Cow::Borrowed(
                    "CREATE INDEX IF NOT EXISTS idx_workflows_project ON workflows(project_id)",
                ),
                vec![],
            )
            .await;

        // Migration: add project_path and originating_session columns for the
        // OPC multi-session orchestrator binding (spec 173 FR-006). Idempotent
        // via the same ALTER-and-ignore pattern as project_id above.
        let _ = self
            .client
            .execute(
                Cow::Borrowed("ALTER TABLE workflows ADD COLUMN project_path TEXT"),
                vec![],
            )
            .await;
        let _ = self
            .client
            .execute(
                Cow::Borrowed("ALTER TABLE workflows ADD COLUMN originating_session TEXT"),
                vec![],
            )
            .await;
        // Index supporting spec 173 FR-003 (`workflows by-project-path` consumer surface).
        let _ = self
            .client
            .execute(
                Cow::Borrowed(
                    "CREATE INDEX IF NOT EXISTS idx_workflows_project_path ON workflows(project_path)",
                ),
                vec![],
            )
            .await;

        Ok(())
    }

    /// List workflow summaries for a given filesystem `project_path`
    /// (spec 173 FR-003, §2.2). Mirrors the SqliteWorkflowStore surface.
    pub async fn list_workflows_by_project_path(
        &self,
        project_path: &str,
        limit: Option<u32>,
    ) -> Result<Vec<crate::state::WorkflowStateSummary>, OrchestratorError> {
        let lim = limit.unwrap_or(50) as i64;
        let rows: Vec<ProjectSummaryRow> = self
            .client
            .query_as(
                "SELECT workflow_id, workflow_name, status, started_at, project_id,
                        project_path, originating_session
                 FROM workflows
                 WHERE project_path = $1
                 ORDER BY started_at DESC
                 LIMIT $2",
                vec![Param::Text(project_path.to_string()), Param::Integer(lim)],
            )
            .await
            .map_err(|e| OrchestratorError::StatePersistence {
                reason: format!("list_workflows_by_project_path: {e}"),
            })?;
        Ok(rows
            .into_iter()
            .map(|r| crate::state::WorkflowStateSummary {
                workflow_id: r.workflow_id,
                workflow_name: r.workflow_name,
                status: r.status,
                started_at: r.started_at,
                project_id: r.project_id,
                project_path: r.project_path,
                originating_session: r.originating_session,
                current_step_name: None,
                current_step_index: None,
                current_step_started_at: None,
                step_count: None,
            })
            .collect())
    }

    /// List workflow summaries for a given project_id (099 Slice 5 (project-scoped per spec 119)).
    pub async fn list_workflows_by_project(
        &self,
        project_id: &str,
        limit: Option<u32>,
    ) -> Result<Vec<crate::state::WorkflowStateSummary>, OrchestratorError> {
        let lim = limit.unwrap_or(50) as i64;
        let rows: Vec<ProjectSummaryRow> = self
            .client
            .query_as(
                "SELECT workflow_id, workflow_name, status, started_at, project_id,
                        project_path, originating_session
                 FROM workflows
                 WHERE project_id = $1
                 ORDER BY started_at DESC
                 LIMIT $2",
                vec![Param::Text(project_id.to_string()), Param::Integer(lim)],
            )
            .await
            .map_err(|e| OrchestratorError::StatePersistence {
                reason: format!("list_workflows_by_project: {e}"),
            })?;
        Ok(rows
            .into_iter()
            .map(|r| crate::state::WorkflowStateSummary {
                workflow_id: r.workflow_id,
                workflow_name: r.workflow_name,
                status: r.status,
                started_at: r.started_at,
                project_id: r.project_id,
                project_path: r.project_path,
                originating_session: r.originating_session,
                current_step_name: None,
                current_step_index: None,
                current_step_started_at: None,
                step_count: None,
            })
            .collect())
    }
}

#[async_trait]
impl WorkflowStore for HiqliteWorkflowStore {
    async fn write_workflow_state(&self, state: &WorkflowState) -> Result<(), OrchestratorError> {
        let wf_id_str = state.workflow_id.to_string();
        let status_str = workflow_status_to_str(&state.status).to_string();
        let metadata_json: Option<String> = if state.metadata.is_empty() {
            None
        } else {
            Some(serde_json::to_string(&state.metadata).map_err(|e| {
                OrchestratorError::StatePersistence {
                    reason: format!("serialize workflow metadata: {e}"),
                }
            })?)
        };

        // Build transaction: upsert workflow + delete old steps + insert new steps
        let mut queries: Vec<(Cow<'static, str>, Params)> = Vec::new();

        // Extract project_id from metadata for the dedicated column (099 Slice 4, renamed by spec 119).
        let project_id = state
            .metadata
            .get("project_id")
            .and_then(|v| v.as_str())
            .map(String::from);

        queries.push((
            Cow::Borrowed(
                r#"INSERT INTO workflows (workflow_id, workflow_name, status, started_at, completed_at, metadata,
                                          project_id, project_path, originating_session)
                   VALUES ($1, $2, $3, $4, NULL, $5, $6, $7, $8)
                   ON CONFLICT(workflow_id) DO UPDATE SET
                     workflow_name       = excluded.workflow_name,
                     status              = excluded.status,
                     started_at          = excluded.started_at,
                     completed_at        = excluded.completed_at,
                     metadata            = excluded.metadata,
                     project_id          = excluded.project_id,
                     project_path        = excluded.project_path,
                     originating_session = excluded.originating_session"#,
            ),
            vec![
                Param::Text(wf_id_str.clone()),
                Param::Text(state.workflow_name.clone()),
                Param::Text(status_str),
                Param::Text(state.started_at.clone()),
                metadata_json
                    .map(Param::Text)
                    .unwrap_or(Param::Null),
                project_id
                    .map(Param::Text)
                    .unwrap_or(Param::Null),
                state
                    .project_path
                    .clone()
                    .map(Param::Text)
                    .unwrap_or(Param::Null),
                state
                    .originating_session
                    .clone()
                    .map(Param::Text)
                    .unwrap_or(Param::Null),
            ],
        ));

        queries.push((
            Cow::Borrowed("DELETE FROM steps WHERE workflow_id = $1"),
            vec![Param::Text(wf_id_str.clone())],
        ));

        for (idx, step) in state.steps.iter().enumerate() {
            let status_str = step_status_to_str(&step.status).to_string();
            let output_json: Option<String> = step
                .output
                .as_ref()
                .map(|v| serde_json::to_string(v))
                .transpose()
                .map_err(|e| OrchestratorError::StatePersistence {
                    reason: format!("serialize step output: {e}"),
                })?;

            let (gate_type, gate_config) = step
                .gate
                .as_ref()
                .map(gate_info_to_sql_columns)
                .unwrap_or((None, None));

            queries.push((
                Cow::Borrowed(
                    r#"INSERT INTO steps (step_id, workflow_id, step_index, name, status,
                       started_at, completed_at, duration_ms, output, gate_type, gate_config)
                       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)"#,
                ),
                vec![
                    Param::Text(step.id.clone()),
                    Param::Text(wf_id_str.clone()),
                    Param::Integer(idx as i64),
                    Param::Text(step.name.clone()),
                    Param::Text(status_str),
                    step.started_at
                        .as_ref()
                        .map(|s| Param::Text(s.clone()))
                        .unwrap_or(Param::Null),
                    step.completed_at
                        .as_ref()
                        .map(|s| Param::Text(s.clone()))
                        .unwrap_or(Param::Null),
                    step.duration_ms
                        .map(|d| Param::Integer(d as i64))
                        .unwrap_or(Param::Null),
                    output_json.map(Param::Text).unwrap_or(Param::Null),
                    gate_type.map(Param::Text).unwrap_or(Param::Null),
                    gate_config.map(Param::Text).unwrap_or(Param::Null),
                ],
            ));
        }

        self.client
            .txn(queries)
            .await
            .map_err(|e| OrchestratorError::StatePersistence {
                reason: format!("hiqlite txn write_workflow_state: {e}"),
            })?;

        Ok(())
    }

    async fn load_workflow_state(
        &self,
        workflow_id: Uuid,
    ) -> Result<Option<WorkflowState>, OrchestratorError> {
        let wf_id_str = workflow_id.to_string();

        // Query workflow row
        let wf_rows: Vec<WorkflowRow> = self
            .client
            .query_as(
                "SELECT workflow_name, status, started_at, completed_at, metadata,
                        project_path, originating_session
                 FROM workflows WHERE workflow_id = $1",
                vec![Param::Text(wf_id_str.clone())],
            )
            .await
            .map_err(|e| OrchestratorError::StatePersistence {
                reason: format!("hiqlite query workflow: {e}"),
            })?;

        let wf_row = match wf_rows.into_iter().next() {
            Some(r) => r,
            None => return Ok(None),
        };

        let status = workflow_status_from_str(&wf_row.status).map_err(|msg| {
            OrchestratorError::StatePersistence {
                reason: format!("invalid workflow status '{}': {msg}", wf_row.status),
            }
        })?;

        let metadata = if let Some(text) = &wf_row.metadata {
            match serde_json::from_str::<JsonValue>(text) {
                Ok(JsonValue::Object(map)) => map,
                _ => serde_json::Map::new(),
            }
        } else {
            serde_json::Map::new()
        };

        // Query steps ordered by step_index
        let step_rows: Vec<StepRow> = self
            .client
            .query_as(
                r#"SELECT step_id, step_index, name, status, started_at, completed_at,
                   duration_ms, output, gate_type, gate_config
                   FROM steps WHERE workflow_id = $1 ORDER BY step_index ASC"#,
                vec![Param::Text(wf_id_str)],
            )
            .await
            .map_err(|e| OrchestratorError::StatePersistence {
                reason: format!("hiqlite query steps: {e}"),
            })?;

        let mut steps = Vec::with_capacity(step_rows.len());
        for row in step_rows {
            let step_status = step_status_from_str(&row.status).map_err(|msg| {
                OrchestratorError::StatePersistence {
                    reason: format!("invalid step status '{}': {msg}", row.status),
                }
            })?;

            let output = row
                .output
                .as_ref()
                .and_then(|text| serde_json::from_str::<JsonValue>(text).ok());

            let gate = row
                .gate_type
                .as_ref()
                .map(|gt| sql_columns_to_gate_info(gt, row.gate_config.as_deref()))
                .transpose()?;

            steps.push(StepState {
                id: row.step_id,
                name: row.name,
                status: step_status,
                started_at: row.started_at,
                completed_at: row.completed_at,
                duration_ms: row.duration_ms.map(|d| d as u64),
                output,
                gate,
            });
        }

        Ok(Some(WorkflowState {
            version: 1,
            workflow_id,
            workflow_name: wf_row.workflow_name,
            started_at: wf_row.started_at,
            status,
            current_step_index: None,
            steps,
            metadata,
            project_path: wf_row.project_path,
            originating_session: wf_row.originating_session,
        }))
    }

    async fn append_event(
        &self,
        workflow_id: Uuid,
        event_type: &str,
        payload: &JsonValue,
        timestamp: Option<String>,
    ) -> Result<i64, OrchestratorError> {
        let wf_id_str = workflow_id.to_string();
        let ts = timestamp.unwrap_or_else(now_ts);
        let payload_json =
            serde_json::to_string(payload).map_err(|e| OrchestratorError::StatePersistence {
                reason: format!("serialize event payload: {e}"),
            })?;

        // Use RETURNING to get the auto-generated event_id back from Raft leader.
        let row: EventIdRow = self
            .client
            .execute_returning_map_one(
                Cow::Borrowed(
                    "INSERT INTO events (workflow_id, timestamp, event_type, payload) VALUES ($1, $2, $3, $4) RETURNING event_id",
                ),
                vec![
                    Param::Text(wf_id_str),
                    Param::Text(ts),
                    Param::Text(event_type.to_string()),
                    Param::Text(payload_json),
                ],
            )
            .await
            .map_err(|e| OrchestratorError::StatePersistence {
                reason: format!("hiqlite append_event: {e}"),
            })?;

        Ok(row.event_id)
    }

    async fn load_events_since(
        &self,
        workflow_id: Uuid,
        from_event_id: i64,
        limit: Option<u32>,
    ) -> Result<Vec<PersistedEvent>, OrchestratorError> {
        let wf_id_str = workflow_id.to_string();
        let effective_limit: i64 = limit.map_or(i64::MAX, |l| l as i64);

        let rows: Vec<EventRow> = self
            .client
            .query_as(
                r#"SELECT event_id, workflow_id, timestamp, event_type, payload
                   FROM events
                   WHERE workflow_id = $1 AND event_id > $2
                   ORDER BY event_id ASC
                   LIMIT $3"#,
                vec![
                    Param::Text(wf_id_str),
                    Param::Integer(from_event_id),
                    Param::Integer(effective_limit),
                ],
            )
            .await
            .map_err(|e| OrchestratorError::StatePersistence {
                reason: format!("hiqlite load_events_since: {e}"),
            })?;

        let mut out = Vec::with_capacity(rows.len());
        for row in rows {
            let parsed_wf_id = Uuid::parse_str(&row.workflow_id).map_err(|e| {
                OrchestratorError::StatePersistence {
                    reason: format!("decode workflow_id: {e}"),
                }
            })?;
            let payload: JsonValue = serde_json::from_str(&row.payload).map_err(|e| {
                OrchestratorError::StatePersistence {
                    reason: format!("decode event payload: {e}"),
                }
            })?;
            out.push(PersistedEvent {
                event_id: row.event_id,
                workflow_id: parsed_wf_id,
                timestamp: row.timestamp,
                event_type: row.event_type,
                payload,
                scope: None,
            });
        }

        Ok(out)
    }
}

// ---------------------------------------------------------------------------
// HiqliteEventNotifier — listen/notify + local broadcast fan-out
// ---------------------------------------------------------------------------

/// Event notifier backed by hiqlite's Raft-replicated listen/notify.
///
/// For local subscribers (SSE endpoints on this node), events are also
/// fanned out via a `tokio::broadcast` channel per workflow since hiqlite's
/// listen/notify is a cluster-wide topic, not per-subscriber.
#[derive(Clone)]
pub struct HiqliteEventNotifier {
    client: Client,
    /// Local broadcast fan-out for SSE subscribers on this node.
    local_tx: Arc<tokio::sync::broadcast::Sender<PersistedEvent>>,
}

impl HiqliteEventNotifier {
    pub fn new(client: Client) -> Self {
        let (tx, _) = broadcast::channel(DEFAULT_CHANNEL_CAPACITY);
        Self {
            client,
            local_tx: Arc::new(tx),
        }
    }
}

#[async_trait]
impl EventNotifier for HiqliteEventNotifier {
    async fn notify(&self, _workflow_id: Uuid, event: PersistedEvent) {
        // Fan out to local SSE subscribers.
        let _ = self.local_tx.send(event.clone());

        // Publish via Raft listen/notify for cross-node delivery.
        let _ = self.client.notify(&event).await;
    }

    async fn subscribe_with_replay(
        &self,
        store: &dyn WorkflowStore,
        workflow_id: Uuid,
        from_event_id: i64,
    ) -> Result<ReplaySubscription, OrchestratorError> {
        // Subscribe to local broadcast first to avoid missing events.
        let subscriber = EventReceiver::new(self.local_tx.subscribe());

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
// Serde row types for query_as deserialization
// ---------------------------------------------------------------------------

#[derive(serde::Deserialize)]
struct ProjectSummaryRow {
    workflow_id: String,
    workflow_name: String,
    status: String,
    started_at: String,
    project_id: Option<String>,
    #[serde(default)]
    project_path: Option<String>,
    #[serde(default)]
    originating_session: Option<String>,
}

#[derive(serde::Deserialize)]
struct WorkflowRow {
    workflow_name: String,
    status: String,
    started_at: String,
    #[allow(dead_code)]
    completed_at: Option<String>,
    metadata: Option<String>,
    #[serde(default)]
    project_path: Option<String>,
    #[serde(default)]
    originating_session: Option<String>,
}

#[derive(serde::Deserialize)]
struct StepRow {
    step_id: String,
    #[allow(dead_code)]
    step_index: i64,
    name: String,
    status: String,
    started_at: Option<String>,
    completed_at: Option<String>,
    duration_ms: Option<i64>,
    output: Option<String>,
    gate_type: Option<String>,
    gate_config: Option<String>,
}

#[derive(serde::Deserialize)]
struct EventRow {
    event_id: i64,
    workflow_id: String,
    timestamp: String,
    event_type: String,
    payload: String,
}

/// Row type for extracting `event_id` from INSERT ... RETURNING.
struct EventIdRow {
    event_id: i64,
}

impl<'a, 'r> From<&'a mut hiqlite::Row<'r>> for EventIdRow {
    fn from(row: &'a mut hiqlite::Row<'r>) -> Self {
        Self {
            event_id: row.get("event_id"),
        }
    }
}

// ---------------------------------------------------------------------------
// Conversion helpers (shared with sqlite_state.rs)
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
        .map(|v| serde_json::to_string(v))
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
                reason: format!("decode gate_config json: {e}"),
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
