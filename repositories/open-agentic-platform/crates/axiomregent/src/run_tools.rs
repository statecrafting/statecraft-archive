// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Bartek Kus
// Feature: TASK_RUNNER
// Spec: spec/run/skills.md

use anyhow::{Context, Result};
use chrono::Utc;
use hiqlite::{Client, Param};
use log::error;
use run::{RunConfig, Runner, StateStore, registry};
use serde::Deserialize;
use std::borrow::Cow;
use std::collections::HashMap;
use std::env;
use std::fs::{self, File};
use std::path::{Path, PathBuf};
use std::thread;
use uuid::Uuid;

pub struct RunTools {
    client: Client,
    state_dir: PathBuf,
    run_root: PathBuf,
}

impl RunTools {
    pub fn new(client: Client, root: &Path) -> Self {
        let state_dir = root.join(".axiomregent/run");
        let logs_dir = state_dir.join("logs");
        fs::create_dir_all(&logs_dir).unwrap_or(());
        Self {
            client,
            state_dir,
            run_root: root.to_path_buf(),
        }
    }

    pub async fn execute(
        &self,
        skill: String,
        env_vars: Option<HashMap<String, String>>,
    ) -> Result<serde_json::Value> {
        let run_id = Uuid::new_v4().to_string();
        let logs_path = self.state_dir.join("logs").join(format!("{}.log", run_id));
        let logs_path_str = logs_path.to_string_lossy().into_owned();
        let started_at = Utc::now().to_rfc3339();
        let run_root_str = self.run_root.to_string_lossy().into_owned();

        // Insert the initial run record into hiqlite
        self.client
            .execute(
                Cow::Borrowed(
                    "INSERT INTO runs \
                     (run_id, skill_name, repo_root, status, exit_code, log_path, started_at, completed_at) \
                     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)",
                ),
                vec![
                    Param::Text(run_id.clone()),
                    Param::Text(skill.clone()),
                    Param::Text(run_root_str.clone()),
                    Param::Text("running".to_string()),
                    Param::Null,
                    Param::Text(logs_path_str.clone()),
                    Param::Text(started_at),
                    Param::Null,
                ],
            )
            .await?;

        let client_clone = self.client.clone();
        let run_id_clone = run_id.clone();
        let state_dir_str = self.state_dir.to_string_lossy().into_owned();
        let rt_handle = tokio::runtime::Handle::current();

        thread::spawn(move || {
            let log_file = match File::create(&logs_path) {
                Ok(f) => f,
                Err(e) => {
                    error!("Failed to create log file: {}", e);
                    let rt = rt_handle.clone();
                    rt.block_on(async {
                        let _ = client_clone
                            .execute(
                                Cow::Borrowed(
                                    "UPDATE runs SET status = $1, completed_at = $2 WHERE run_id = $3",
                                ),
                                vec![
                                    Param::Text("fail".to_string()),
                                    Param::Text(Utc::now().to_rfc3339()),
                                    Param::Text(run_id_clone.clone()),
                                ],
                            )
                            .await;
                    });
                    return;
                }
            };

            // Setup RunConfig
            let current_exe = env::current_exe().unwrap_or_else(|_| "axiomregent".into());
            let bin_path = current_exe.to_string_lossy().into_owned();

            let config = RunConfig {
                json: false,
                state_dir: state_dir_str.clone(),
                fail_on_warning: false,
                files0: false,
                bin_path,
                stdin_buffer: None,
                env: env_vars.unwrap_or_default(),
            };

            let store = StateStore::new(&state_dir_str);
            let registry = registry::get_registry(Some(Path::new(&run_root_str)));
            let runner = Runner::new(registry, store, config, Some(Box::new(log_file)));

            let result = runner.run_specific(&[skill]);

            let (status, exit_code) = match result {
                Ok(true) => ("pass".to_string(), 0i64),
                Ok(false) => ("fail".to_string(), 1i64),
                Err(_) => ("fail".to_string(), 1i64),
            };

            rt_handle.block_on(async {
                let _ = client_clone
                    .execute(
                        Cow::Borrowed(
                            "UPDATE runs SET status = $1, exit_code = $2, completed_at = $3 \
                             WHERE run_id = $4",
                        ),
                        vec![
                            Param::Text(status),
                            Param::Integer(exit_code),
                            Param::Text(Utc::now().to_rfc3339()),
                            Param::Text(run_id_clone),
                        ],
                    )
                    .await;
            });
        });

        Ok(serde_json::json!({"run_id": run_id}))
    }

    pub async fn status(&self, run_id: &str) -> Result<serde_json::Value> {
        #[derive(Deserialize)]
        struct RunRow {
            status: String,
            exit_code: Option<i64>,
            started_at: String,
            completed_at: Option<String>,
        }

        let rows: Vec<RunRow> = self
            .client
            .query_as(
                "SELECT status, exit_code, started_at, completed_at \
                 FROM runs WHERE run_id = $1",
                vec![Param::Text(run_id.to_string())],
            )
            .await?;

        if let Some(row) = rows.into_iter().next() {
            Ok(serde_json::json!({
                "run_id": run_id,
                "status": row.status,
                "start_time": row.started_at,
                "end_time": row.completed_at,
                "exit_code": row.exit_code,
                "note": null
            }))
        } else {
            Ok(serde_json::json!({ "run_id": run_id, "status": "unknown" }))
        }
    }

    pub async fn logs(
        &self,
        run_id: &str,
        offset: Option<u64>,
        limit: Option<u64>,
    ) -> Result<serde_json::Value> {
        #[derive(Deserialize)]
        struct LogPathRow {
            log_path: Option<String>,
        }

        let rows: Vec<LogPathRow> = self
            .client
            .query_as(
                "SELECT log_path FROM runs WHERE run_id = $1",
                vec![Param::Text(run_id.to_string())],
            )
            .await?;

        let logs_path = match rows.into_iter().next() {
            Some(row) => match row.log_path {
                Some(p) => PathBuf::from(p),
                None => {
                    return Ok(serde_json::json!({
                        "run_id": run_id,
                        "lines": [],
                        "total": 0,
                        "truncated": false
                    }));
                }
            },
            None => {
                return Ok(serde_json::json!({
                    "run_id": run_id,
                    "lines": [],
                    "total": 0,
                    "truncated": false
                }));
            }
        };

        if !logs_path.exists() {
            return Ok(serde_json::json!({
                "run_id": run_id,
                "lines": [],
                "total": 0,
                "truncated": false
            }));
        }

        let contents = fs::read_to_string(&logs_path).context("reading log file")?;
        let all_lines: Vec<&str> = contents.lines().collect();
        let total = all_lines.len() as u64;

        let line_offset = offset.unwrap_or(0) as usize;
        let sliced: &[&str] = if line_offset < all_lines.len() {
            &all_lines[line_offset..]
        } else {
            &[]
        };

        let (lines, truncated) = if let Some(lim) = limit {
            let lim = lim as usize;
            if sliced.len() > lim {
                (&sliced[..lim], true)
            } else {
                (sliced, false)
            }
        } else {
            (sliced, false)
        };

        Ok(serde_json::json!({
            "run_id": run_id,
            "lines": lines,
            "total": total,
            "truncated": truncated
        }))
    }
}
