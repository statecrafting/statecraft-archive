// SPDX-License-Identifier: AGPL-3.0-or-later
// Feature 079: SQLite-backed scheduler store.

use super::store::{
    CreateScheduleRequest, Schedule, ScheduleTrigger, SchedulerStore, SessionContext,
};
use crate::OrchestratorError;
use async_trait::async_trait;
use rusqlite::{Connection, params};
use std::sync::{Arc, Mutex as StdMutex};
use std::time::{SystemTime, UNIX_EPOCH};

/// SQLite-backed store for schedule definitions (Feature 079).
#[derive(Clone)]
pub struct SqliteSchedulerStore {
    conn: Arc<StdMutex<Connection>>,
}

impl SqliteSchedulerStore {
    /// Opens (or creates) the scheduler tables in an existing SQLite connection.
    pub fn new(conn: Arc<StdMutex<Connection>>) -> Result<Self, OrchestratorError> {
        {
            let guard = conn
                .lock()
                .map_err(|e| OrchestratorError::StatePersistence {
                    reason: format!("lock sqlite connection for scheduler init: {e}"),
                })?;
            guard
                .execute_batch(
                    r#"
                    CREATE TABLE IF NOT EXISTS schedules (
                        id              TEXT PRIMARY KEY,
                        name            TEXT NOT NULL,
                        prompt          TEXT NOT NULL,
                        session_context TEXT,
                        cron_expr       TEXT,
                        event_type      TEXT,
                        enabled         INTEGER NOT NULL DEFAULT 1,
                        last_run_at     INTEGER,
                        created_at      INTEGER NOT NULL
                    );
                    CREATE INDEX IF NOT EXISTS idx_schedules_enabled
                        ON schedules(enabled);
                    "#,
                )
                .map_err(|e| OrchestratorError::StatePersistence {
                    reason: format!("initialize scheduler schema: {e}"),
                })?;
        }
        Ok(Self { conn })
    }

    /// Creates a fresh store with its own SQLite database (for testing).
    pub fn open(path: &std::path::Path) -> Result<Self, OrchestratorError> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).map_err(|e| OrchestratorError::StatePersistence {
                reason: format!("create scheduler db dir {}: {e}", parent.display()),
            })?;
        }
        let conn = Connection::open(path).map_err(|e| OrchestratorError::StatePersistence {
            reason: format!("open scheduler sqlite db {}: {e}", path.display()),
        })?;
        conn.pragma_update(None, "journal_mode", "WAL")
            .map_err(|e| OrchestratorError::StatePersistence {
                reason: format!("enable WAL for scheduler db: {e}"),
            })?;
        Self::new(Arc::new(StdMutex::new(conn)))
    }

    fn now_epoch() -> i64 {
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs() as i64
    }
}

// ---------------------------------------------------------------------------
// SchedulerStore trait implementation
// ---------------------------------------------------------------------------

#[async_trait]
impl SchedulerStore for SqliteSchedulerStore {
    async fn create_schedule(
        &self,
        req: CreateScheduleRequest,
    ) -> Result<Schedule, OrchestratorError> {
        let conn = Arc::clone(&self.conn);
        tokio::task::spawn_blocking(move || {
            let guard = conn
                .lock()
                .map_err(|e| OrchestratorError::StatePersistence {
                    reason: format!("lock sqlite connection: {e}"),
                })?;
            let id = uuid::Uuid::new_v4().to_string();
            let created_at = SqliteSchedulerStore::now_epoch();
            let (cron_expr, event_type) = match &req.trigger {
                ScheduleTrigger::Cron { expr } => (Some(expr.clone()), None),
                ScheduleTrigger::Event { event_type } => (None, Some(event_type.clone())),
            };
            let session_ctx_json = req
                .session_context
                .as_ref()
                .map(|sc| serde_json::to_string(sc).unwrap_or_default());

            guard
                .execute(
                    r#"
                    INSERT INTO schedules (
                        id, name, prompt, session_context, cron_expr,
                        event_type, enabled, last_run_at, created_at
                    )
                    VALUES (?1, ?2, ?3, ?4, ?5, ?6, 1, NULL, ?7)
                    "#,
                    params![
                        id,
                        req.name,
                        req.prompt,
                        session_ctx_json,
                        cron_expr,
                        event_type,
                        created_at,
                    ],
                )
                .map_err(|e| OrchestratorError::StatePersistence {
                    reason: format!("insert schedule row: {e}"),
                })?;

            Ok(Schedule {
                id,
                name: req.name,
                prompt: req.prompt,
                session_context: req.session_context,
                trigger: req.trigger,
                enabled: true,
                last_run_at: None,
                created_at,
            })
        })
        .await
        .map_err(|e| OrchestratorError::StatePersistence {
            reason: format!("spawn_blocking join: {e}"),
        })?
    }

    async fn get_schedule(&self, id: &str) -> Result<Option<Schedule>, OrchestratorError> {
        let conn = Arc::clone(&self.conn);
        let id = id.to_string();
        tokio::task::spawn_blocking(move || {
            let guard = conn
                .lock()
                .map_err(|e| OrchestratorError::StatePersistence {
                    reason: format!("lock sqlite connection: {e}"),
                })?;
            row_to_schedule_opt(&guard, &id)
        })
        .await
        .map_err(|e| OrchestratorError::StatePersistence {
            reason: format!("spawn_blocking join: {e}"),
        })?
    }

    async fn list_schedules(&self) -> Result<Vec<Schedule>, OrchestratorError> {
        let conn = Arc::clone(&self.conn);
        tokio::task::spawn_blocking(move || {
            let guard = conn
                .lock()
                .map_err(|e| OrchestratorError::StatePersistence {
                    reason: format!("lock sqlite connection: {e}"),
                })?;
            query_schedules(
                &guard,
                "SELECT * FROM schedules ORDER BY created_at DESC",
                &[],
            )
        })
        .await
        .map_err(|e| OrchestratorError::StatePersistence {
            reason: format!("spawn_blocking join: {e}"),
        })?
    }

    async fn delete_schedule(&self, id: &str) -> Result<bool, OrchestratorError> {
        let conn = Arc::clone(&self.conn);
        let id = id.to_string();
        tokio::task::spawn_blocking(move || {
            let guard = conn
                .lock()
                .map_err(|e| OrchestratorError::StatePersistence {
                    reason: format!("lock sqlite connection: {e}"),
                })?;
            let affected = guard
                .execute("DELETE FROM schedules WHERE id = ?1", params![id])
                .map_err(|e| OrchestratorError::StatePersistence {
                    reason: format!("delete schedule: {e}"),
                })?;
            Ok(affected > 0)
        })
        .await
        .map_err(|e| OrchestratorError::StatePersistence {
            reason: format!("spawn_blocking join: {e}"),
        })?
    }

    async fn toggle_schedule(&self, id: &str, enabled: bool) -> Result<(), OrchestratorError> {
        let conn = Arc::clone(&self.conn);
        let id = id.to_string();
        tokio::task::spawn_blocking(move || {
            let guard = conn
                .lock()
                .map_err(|e| OrchestratorError::StatePersistence {
                    reason: format!("lock sqlite connection: {e}"),
                })?;
            guard
                .execute(
                    "UPDATE schedules SET enabled = ?1 WHERE id = ?2",
                    params![enabled as i32, id],
                )
                .map_err(|e| OrchestratorError::StatePersistence {
                    reason: format!("toggle schedule: {e}"),
                })?;
            Ok(())
        })
        .await
        .map_err(|e| OrchestratorError::StatePersistence {
            reason: format!("spawn_blocking join: {e}"),
        })?
    }

    async fn update_last_run(&self, id: &str, timestamp: i64) -> Result<(), OrchestratorError> {
        let conn = Arc::clone(&self.conn);
        let id = id.to_string();
        tokio::task::spawn_blocking(move || {
            let guard = conn
                .lock()
                .map_err(|e| OrchestratorError::StatePersistence {
                    reason: format!("lock sqlite connection: {e}"),
                })?;
            guard
                .execute(
                    "UPDATE schedules SET last_run_at = ?1 WHERE id = ?2",
                    params![timestamp, id],
                )
                .map_err(|e| OrchestratorError::StatePersistence {
                    reason: format!("update last_run_at: {e}"),
                })?;
            Ok(())
        })
        .await
        .map_err(|e| OrchestratorError::StatePersistence {
            reason: format!("spawn_blocking join: {e}"),
        })?
    }

    async fn list_enabled_cron_schedules(&self) -> Result<Vec<Schedule>, OrchestratorError> {
        let conn = Arc::clone(&self.conn);
        tokio::task::spawn_blocking(move || {
            let guard = conn.lock().map_err(|e| OrchestratorError::StatePersistence {
                reason: format!("lock sqlite connection: {e}"),
            })?;
            query_schedules(
                &guard,
                "SELECT * FROM schedules WHERE enabled = 1 AND cron_expr IS NOT NULL ORDER BY created_at",
                &[],
            )
        })
        .await
        .map_err(|e| OrchestratorError::StatePersistence {
            reason: format!("spawn_blocking join: {e}"),
        })?
    }

    async fn list_enabled_event_schedules(
        &self,
        event_type: &str,
    ) -> Result<Vec<Schedule>, OrchestratorError> {
        let conn = Arc::clone(&self.conn);
        let event_type = event_type.to_string();
        tokio::task::spawn_blocking(move || {
            let guard = conn.lock().map_err(|e| OrchestratorError::StatePersistence {
                reason: format!("lock sqlite connection: {e}"),
            })?;
            let mut stmt = guard
                .prepare(
                    "SELECT * FROM schedules WHERE enabled = 1 AND event_type = ?1 ORDER BY created_at",
                )
                .map_err(|e| OrchestratorError::StatePersistence {
                    reason: format!("prepare event schedules query: {e}"),
                })?;
            let rows = stmt
                .query_map(params![event_type], row_to_schedule)
                .map_err(|e| OrchestratorError::StatePersistence {
                    reason: format!("query event schedules: {e}"),
                })?;
            let mut out = Vec::new();
            for row in rows {
                out.push(row.map_err(|e| OrchestratorError::StatePersistence {
                    reason: format!("iterate schedule rows: {e}"),
                })?);
            }
            Ok(out)
        })
        .await
        .map_err(|e| OrchestratorError::StatePersistence {
            reason: format!("spawn_blocking join: {e}"),
        })?
    }
}

// ---------------------------------------------------------------------------
// Row mapping helpers
// ---------------------------------------------------------------------------

fn row_to_schedule(row: &rusqlite::Row<'_>) -> rusqlite::Result<Schedule> {
    let id: String = row.get("id")?;
    let name: String = row.get("name")?;
    let prompt: String = row.get("prompt")?;
    let session_ctx_text: Option<String> = row.get("session_context")?;
    let cron_expr: Option<String> = row.get("cron_expr")?;
    let event_type: Option<String> = row.get("event_type")?;
    let enabled: i32 = row.get("enabled")?;
    let last_run_at: Option<i64> = row.get("last_run_at")?;
    let created_at: i64 = row.get("created_at")?;

    let session_context = session_ctx_text
        .as_deref()
        .and_then(|s| serde_json::from_str::<SessionContext>(s).ok());

    let trigger = if let Some(expr) = cron_expr {
        ScheduleTrigger::Cron { expr }
    } else if let Some(et) = event_type {
        ScheduleTrigger::Event { event_type: et }
    } else {
        // Shouldn't happen due to CHECK constraint; default to empty cron.
        ScheduleTrigger::Cron {
            expr: String::new(),
        }
    };

    Ok(Schedule {
        id,
        name,
        prompt,
        session_context,
        trigger,
        enabled: enabled != 0,
        last_run_at,
        created_at,
    })
}

fn row_to_schedule_opt(conn: &Connection, id: &str) -> Result<Option<Schedule>, OrchestratorError> {
    use rusqlite::OptionalExtension;
    let mut stmt = conn
        .prepare("SELECT * FROM schedules WHERE id = ?1")
        .map_err(|e| OrchestratorError::StatePersistence {
            reason: format!("prepare schedule select: {e}"),
        })?;
    stmt.query_row(params![id], row_to_schedule)
        .optional()
        .map_err(|e| OrchestratorError::StatePersistence {
            reason: format!("query schedule by id: {e}"),
        })
}

fn query_schedules(
    conn: &Connection,
    sql: &str,
    params: &[&dyn rusqlite::types::ToSql],
) -> Result<Vec<Schedule>, OrchestratorError> {
    let mut stmt = conn
        .prepare(sql)
        .map_err(|e| OrchestratorError::StatePersistence {
            reason: format!("prepare schedules query: {e}"),
        })?;
    let rows = stmt.query_map(params, row_to_schedule).map_err(|e| {
        OrchestratorError::StatePersistence {
            reason: format!("query schedules: {e}"),
        }
    })?;
    let mut out = Vec::new();
    for row in rows {
        out.push(row.map_err(|e| OrchestratorError::StatePersistence {
            reason: format!("iterate schedule rows: {e}"),
        })?);
    }
    Ok(out)
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    async fn setup_store() -> (tempfile::TempDir, SqliteSchedulerStore) {
        let tmp = tempfile::tempdir().unwrap();
        let db_path = tmp.path().join("scheduler.sqlite");
        let store = SqliteSchedulerStore::open(&db_path).expect("open scheduler store");
        (tmp, store)
    }

    #[tokio::test]
    async fn create_and_list_schedules() {
        let (_tmp, store) = setup_store().await;

        let s1 = store
            .create_schedule(CreateScheduleRequest {
                name: "daily-lint".into(),
                prompt: "run lint".into(),
                session_context: None,
                trigger: ScheduleTrigger::Cron {
                    expr: "0 9 * * *".into(),
                },
            })
            .await
            .expect("create s1");
        assert!(s1.enabled);

        let s2 = store
            .create_schedule(CreateScheduleRequest {
                name: "on-stop".into(),
                prompt: "summarize session".into(),
                session_context: Some(SessionContext {
                    cwd: Some("/tmp".into()),
                    model: None,
                    provider: None,
                }),
                trigger: ScheduleTrigger::Event {
                    event_type: "SessionStop".into(),
                },
            })
            .await
            .expect("create s2");

        let all = store.list_schedules().await.expect("list");
        assert_eq!(all.len(), 2);

        let loaded = store.get_schedule(&s2.id).await.expect("get").unwrap();
        assert_eq!(loaded.name, "on-stop");
        assert!(loaded.session_context.is_some());
    }

    #[tokio::test]
    async fn delete_removes_row() {
        let (_tmp, store) = setup_store().await;

        let s = store
            .create_schedule(CreateScheduleRequest {
                name: "doomed".into(),
                prompt: "bye".into(),
                session_context: None,
                trigger: ScheduleTrigger::Cron {
                    expr: "* * * * *".into(),
                },
            })
            .await
            .expect("create");

        assert!(store.delete_schedule(&s.id).await.expect("delete"));
        assert!(store.list_schedules().await.expect("list").is_empty());
        assert!(!store.delete_schedule(&s.id).await.expect("delete again"));
    }

    #[tokio::test]
    async fn toggle_changes_enabled_flag() {
        let (_tmp, store) = setup_store().await;

        let s = store
            .create_schedule(CreateScheduleRequest {
                name: "toggler".into(),
                prompt: "test".into(),
                session_context: None,
                trigger: ScheduleTrigger::Cron {
                    expr: "0 0 * * *".into(),
                },
            })
            .await
            .expect("create");

        assert!(s.enabled);
        store
            .toggle_schedule(&s.id, false)
            .await
            .expect("toggle off");
        let loaded = store.get_schedule(&s.id).await.expect("get").unwrap();
        assert!(!loaded.enabled);

        store.toggle_schedule(&s.id, true).await.expect("toggle on");
        let loaded = store.get_schedule(&s.id).await.expect("get").unwrap();
        assert!(loaded.enabled);
    }

    #[tokio::test]
    async fn list_enabled_cron_filters_correctly() {
        let (_tmp, store) = setup_store().await;

        // Create: cron+enabled, cron+disabled, event+enabled
        let cron_enabled = store
            .create_schedule(CreateScheduleRequest {
                name: "cron-on".into(),
                prompt: "a".into(),
                session_context: None,
                trigger: ScheduleTrigger::Cron {
                    expr: "0 9 * * *".into(),
                },
            })
            .await
            .expect("create");

        let cron_disabled = store
            .create_schedule(CreateScheduleRequest {
                name: "cron-off".into(),
                prompt: "b".into(),
                session_context: None,
                trigger: ScheduleTrigger::Cron {
                    expr: "0 10 * * *".into(),
                },
            })
            .await
            .expect("create");
        store
            .toggle_schedule(&cron_disabled.id, false)
            .await
            .expect("disable");

        let _event_enabled = store
            .create_schedule(CreateScheduleRequest {
                name: "event-on".into(),
                prompt: "c".into(),
                session_context: None,
                trigger: ScheduleTrigger::Event {
                    event_type: "SessionStop".into(),
                },
            })
            .await
            .expect("create");

        let cron_schedules = store
            .list_enabled_cron_schedules()
            .await
            .expect("list cron");
        assert_eq!(cron_schedules.len(), 1);
        assert_eq!(cron_schedules[0].id, cron_enabled.id);
    }

    #[tokio::test]
    async fn list_enabled_event_filters_by_type() {
        let (_tmp, store) = setup_store().await;

        store
            .create_schedule(CreateScheduleRequest {
                name: "on-start".into(),
                prompt: "a".into(),
                session_context: None,
                trigger: ScheduleTrigger::Event {
                    event_type: "SessionStart".into(),
                },
            })
            .await
            .expect("create");

        store
            .create_schedule(CreateScheduleRequest {
                name: "on-change".into(),
                prompt: "b".into(),
                session_context: None,
                trigger: ScheduleTrigger::Event {
                    event_type: "FileChanged".into(),
                },
            })
            .await
            .expect("create");

        let start_schedules = store
            .list_enabled_event_schedules("SessionStart")
            .await
            .expect("list");
        assert_eq!(start_schedules.len(), 1);
        assert_eq!(start_schedules[0].name, "on-start");

        let change_schedules = store
            .list_enabled_event_schedules("FileChanged")
            .await
            .expect("list");
        assert_eq!(change_schedules.len(), 1);

        let none_schedules = store
            .list_enabled_event_schedules("PostToolUse")
            .await
            .expect("list");
        assert!(none_schedules.is_empty());
    }

    #[tokio::test]
    async fn update_last_run_persists() {
        let (_tmp, store) = setup_store().await;

        let s = store
            .create_schedule(CreateScheduleRequest {
                name: "runner".into(),
                prompt: "go".into(),
                session_context: None,
                trigger: ScheduleTrigger::Cron {
                    expr: "* * * * *".into(),
                },
            })
            .await
            .expect("create");

        assert!(s.last_run_at.is_none());

        store
            .update_last_run(&s.id, 1712345678)
            .await
            .expect("update");
        let loaded = store.get_schedule(&s.id).await.expect("get").unwrap();
        assert_eq!(loaded.last_run_at, Some(1712345678));
    }
}
