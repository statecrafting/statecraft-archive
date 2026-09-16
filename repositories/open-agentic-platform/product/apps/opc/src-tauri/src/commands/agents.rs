use agent::{
    AgentRegistryEntry, AgentRegistrySnapshot,
    plan::{AgentRole as OrganizerAgentRole, ComplexityBand, ExecutionPlan},
};
use anyhow::Result;
use chrono;
use dirs;
use log::{debug, error, info, warn};
use reqwest;
use rusqlite::{Connection, Result as SqliteResult, params};
use serde::{Deserialize, Serialize};
use serde_json::Value as JsonValue;
use specta::Type;
use std::io::{BufRead, BufReader, Write};
use std::process::Stdio;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager, State};

use crate::sidecars::SidecarState;
// Sidecar support removed; using system binary execution only
use tokio::io::{AsyncBufReadExt, BufReader as TokioBufReader};
use tokio::process::Command;

/// Finds the full path to the claude binary
/// This is necessary because macOS apps have a limited PATH environment
fn find_claude_binary(app_handle: &AppHandle) -> Result<String, String> {
    crate::claude_binary::find_claude_binary(app_handle)
}

/// Result of [`execute_agent`] (Feature 035): run id + governance mode for the UI.
#[derive(Debug, Serialize, Deserialize, Clone, specta::Type)]
pub struct ExecuteAgentResponse {
    pub run_id: i64,
    pub governance_mode: String,
    pub governance_bypass_reason: Option<String>,
}

/// Represents a CC Agent stored in the database
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Agent {
    pub id: Option<i64>,
    pub name: String,
    pub icon: String,
    pub system_prompt: String,
    pub default_task: Option<String>,
    pub model: String,
    pub enable_file_read: bool,
    pub enable_file_write: bool,
    pub enable_network: bool,
    pub hooks: Option<String>, // JSON string of hooks configuration
    pub created_at: String,
    pub updated_at: String,
}

/// Project-bound agent row (spec 126 §3). Joins `project_agent_bindings`
/// with `agents` so the desktop picker surfaces both the binding's pinned
/// version/hash and the catalog row's display fields. When the upstream
/// catalog row is gone (`retire_remote_agent` deleted it), the binding
/// remains and `status = "retired_upstream"` so the operator can see
/// what to unbind via the web UI (spec 123 invariant I-B3).
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct AgentBindingRow {
    pub binding_id: i64,
    pub project_id: String,
    pub org_agent_id: String,
    pub pinned_version: i64,
    pub pinned_content_hash: String,
    pub status: String,
    pub agent_id: Option<i64>,
    pub name: Option<String>,
    pub icon: Option<String>,
    pub model: Option<String>,
    pub frontmatter_json: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

/// Org catalog row (spec 126 §3). Returned by `list_org_agents` for the
/// browse tab. The local cache only stores published rows (drafts skip the
/// upsert in `agent_catalog_sync`, retirements DELETE), so the rows here
/// are always treated as `published`.
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct AgentCatalogRow {
    pub agent_id: i64,
    pub org_agent_id: String,
    pub name: String,
    pub icon: String,
    pub model: String,
    pub version: i64,
    pub content_hash: String,
    pub status: String,
    pub frontmatter_json: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

/// Represents an agent execution run
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct AgentRun {
    pub id: Option<i64>,
    pub agent_id: i64,
    pub agent_name: String,
    pub agent_icon: String,
    pub task: String,
    pub model: String,
    pub project_path: String,
    pub session_id: String, // UUID session ID from Claude Code
    pub status: String,     // 'pending', 'running', 'completed', 'failed', 'cancelled'
    pub pid: Option<u32>,
    pub process_started_at: Option<String>,
    pub created_at: String,
    pub completed_at: Option<String>,
}

/// Represents runtime metrics calculated from JSONL
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct AgentRunMetrics {
    pub duration_ms: Option<i64>,
    pub total_tokens: Option<i64>,
    pub cost_usd: Option<f64>,
    pub message_count: Option<i64>,
}

/// Combined agent run with real-time metrics
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct AgentRunWithMetrics {
    #[serde(flatten)]
    pub run: AgentRun,
    pub metrics: Option<AgentRunMetrics>,
    pub output: Option<String>, // Real-time JSONL content
}

/// Agent export format
#[derive(Debug, Serialize, Deserialize)]
pub struct AgentExport {
    pub version: u32,
    pub exported_at: String,
    pub agent: AgentData,
}

/// Agent data within export
#[derive(Debug, Serialize, Deserialize)]
pub struct AgentData {
    pub name: String,
    pub icon: String,
    pub system_prompt: String,
    pub default_task: Option<String>,
    pub model: String,
    pub hooks: Option<String>,
}

/// Database connection state
pub struct AgentDb(pub Mutex<Connection>);

// ============================================================================
// Agent organizer (043) — thin ExecutionPlan DTO for Tauri
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct PlanContextInput {
    #[serde(default)]
    pub request_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct ComplexityDto {
    pub score: u8,
    pub band: String,
    pub signals: std::collections::BTreeMap<String, f64>,
    pub mandatory_trigger: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct TeamAgentDto {
    pub agent_id: String,
    pub role: String,
    pub justification: String,
    pub model: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct TeamBlockDto {
    pub agents: Vec<TeamAgentDto>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct WorkflowPhaseDto {
    pub id: String,
    pub name: String,
    pub agents: Vec<String>,
    pub task: String,
    pub depends_on: Vec<String>,
    pub output: String,
    pub success_gate: String,
    pub model: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct WorkflowBlockDto {
    pub phases: Vec<WorkflowPhaseDto>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct ExecutionPlanDto {
    pub request_id: String,
    pub mode: String,
    pub complexity: ComplexityDto,
    pub team: Option<TeamBlockDto>,
    pub workflow: Option<WorkflowBlockDto>,
    pub warnings: Option<Vec<String>>,
}

impl From<&ExecutionPlan> for ExecutionPlanDto {
    fn from(plan: &ExecutionPlan) -> Self {
        fn band_to_string(band: ComplexityBand) -> String {
            match band {
                ComplexityBand::Simple => "simple",
                ComplexityBand::Moderate => "moderate",
                ComplexityBand::Complex => "complex",
                ComplexityBand::HighlyComplex => "highly_complex",
            }
            .to_string()
        }

        fn role_to_string(role: OrganizerAgentRole) -> String {
            match role {
                OrganizerAgentRole::Lead => "lead",
                OrganizerAgentRole::Support => "support",
                OrganizerAgentRole::Reviewer => "reviewer",
            }
            .to_string()
        }

        fn model_to_string(model: agent::plan::ModelTier) -> String {
            match model {
                agent::plan::ModelTier::Haiku => "haiku",
                agent::plan::ModelTier::Sonnet => "sonnet",
                agent::plan::ModelTier::Opus => "opus",
            }
            .to_string()
        }

        let complexity = &plan.complexity;
        let team = plan.team.as_ref().map(|t| TeamBlockDto {
            agents: t
                .agents
                .iter()
                .map(|a| TeamAgentDto {
                    agent_id: a.agent_id.clone(),
                    role: role_to_string(a.role),
                    justification: a.justification.clone(),
                    model: model_to_string(a.model),
                })
                .collect(),
        });
        let workflow = plan.workflow.as_ref().map(|w| WorkflowBlockDto {
            phases: w
                .phases
                .iter()
                .map(|p| WorkflowPhaseDto {
                    id: p.id.clone(),
                    name: p.name.clone(),
                    agents: p.agents.clone(),
                    task: p.task.clone(),
                    depends_on: p.depends_on.clone(),
                    output: p.output.clone(),
                    success_gate: p.success_gate.clone(),
                    model: model_to_string(p.model),
                })
                .collect(),
        });

        ExecutionPlanDto {
            request_id: plan.request_id.clone(),
            mode: match plan.mode {
                agent::plan::PlanMode::Direct => "direct".to_string(),
                agent::plan::PlanMode::Delegated => "delegated".to_string(),
            },
            complexity: ComplexityDto {
                score: complexity.score,
                band: band_to_string(complexity.band),
                signals: complexity.signals.clone(),
                mandatory_trigger: complexity.mandatory_trigger.clone(),
            },
            team,
            workflow,
            warnings: plan.warnings.clone(),
        }
    }
}

/// Real-time JSONL reading and processing functions
impl AgentRunMetrics {
    /// Calculate metrics from JSONL content
    pub fn from_jsonl(jsonl_content: &str) -> Self {
        let mut total_tokens = 0i64;
        let mut cost_usd = 0.0f64;
        let mut message_count = 0i64;
        let mut start_time: Option<chrono::DateTime<chrono::Utc>> = None;
        let mut end_time: Option<chrono::DateTime<chrono::Utc>> = None;

        for line in jsonl_content.lines() {
            if let Ok(json) = serde_json::from_str::<JsonValue>(line) {
                message_count += 1;

                // Track timestamps
                if let Some(timestamp_str) = json.get("timestamp").and_then(|t| t.as_str())
                    && let Ok(timestamp) = chrono::DateTime::parse_from_rfc3339(timestamp_str)
                {
                    let utc_time = timestamp.with_timezone(&chrono::Utc);
                    if start_time.is_none() || utc_time < start_time.unwrap() {
                        start_time = Some(utc_time);
                    }
                    if end_time.is_none() || utc_time > end_time.unwrap() {
                        end_time = Some(utc_time);
                    }
                }

                // Extract token usage - check both top-level and nested message.usage
                let usage = json
                    .get("usage")
                    .or_else(|| json.get("message").and_then(|m| m.get("usage")));

                if let Some(usage) = usage {
                    if let Some(input_tokens) = usage.get("input_tokens").and_then(|t| t.as_i64()) {
                        total_tokens += input_tokens;
                    }
                    if let Some(output_tokens) = usage.get("output_tokens").and_then(|t| t.as_i64())
                    {
                        total_tokens += output_tokens;
                    }
                }

                // Extract cost information
                if let Some(cost) = json.get("cost").and_then(|c| c.as_f64()) {
                    cost_usd += cost;
                }
            }
        }

        let duration_ms = match (start_time, end_time) {
            (Some(start), Some(end)) => Some((end - start).num_milliseconds()),
            _ => None,
        };

        Self {
            duration_ms,
            total_tokens: if total_tokens > 0 {
                Some(total_tokens)
            } else {
                None
            },
            cost_usd: if cost_usd > 0.0 { Some(cost_usd) } else { None },
            message_count: if message_count > 0 {
                Some(message_count)
            } else {
                None
            },
        }
    }
}

fn load_agent_registry_snapshot(conn: &Connection) -> Result<AgentRegistrySnapshot, String> {
    let mut stmt = conn
        .prepare(
            "SELECT id, name, system_prompt, default_task FROM agents ORDER BY created_at DESC",
        )
        .map_err(|e| format!("prepare agent registry query failed: {}", e))?;

    let rows = stmt
        .query_map([], |row| {
            let id: i64 = row.get(0)?;
            let _name: String = row.get(1)?;
            let system_prompt: String = row.get(2)?;
            let default_task: Option<String> = row.get(3)?;

            let description = default_task
                .filter(|s| !s.trim().is_empty())
                .unwrap_or_else(|| system_prompt.lines().next().unwrap_or("agent").to_string());

            Ok(AgentRegistryEntry {
                id: format!("agent-{}", id),
                description,
                agent_type: None,
                model: None,
                tags: Vec::new(),
                safety_tier: None,
            })
        })
        .map_err(|e| format!("query agent registry failed: {}", e))?
        .collect::<std::result::Result<Vec<_>, _>>()
        .map_err(|e| format!("collect agent registry failed: {}", e))?;

    Ok(AgentRegistrySnapshot { agents: rows })
}

/// Read JSONL content from a session file
pub async fn read_session_jsonl(session_id: &str, project_path: &str) -> Result<String, String> {
    let claude_dir = dirs::home_dir()
        .ok_or("Failed to get home directory")?
        .join(".claude")
        .join("projects");

    // Encode project path to match Claude Code's directory naming
    let encoded_project = project_path.replace('/', "-");
    let project_dir = claude_dir.join(&encoded_project);
    let session_file = project_dir.join(format!("{}.jsonl", session_id));

    if !session_file.exists() {
        return Err(format!(
            "Session file not found: {}",
            session_file.display()
        ));
    }

    match tokio::fs::read_to_string(&session_file).await {
        Ok(content) => Ok(content),
        Err(e) => Err(format!("Failed to read session file: {}", e)),
    }
}

/// Plan an execution strategy for a free-form request using the Agent Organizer (043).
///
/// This command loads the current agent catalog from the SQLite database,
/// builds an `AgentRegistrySnapshot`, and calls `agent::plan()` to produce
/// a structured `ExecutionPlan`. The result is mapped into a thin DTO so
/// TypeScript bindings stay simple while the Rust contract remains canonical.
#[tauri::command]
pub async fn plan_request(
    db: State<'_, AgentDb>,
    request: String,
    context: Option<PlanContextInput>,
) -> Result<ExecutionPlanDto, String> {
    if request.trim().is_empty() {
        return Err("request cannot be empty".to_string());
    }

    let ctx = agent::plan::PlanContext {
        request_id: context.and_then(|c| c.request_id),
    };

    let snapshot = {
        let conn = db.0.lock().map_err(|e| e.to_string())?;
        load_agent_registry_snapshot(&conn)?
    };

    let plan = agent::plan(&request, &ctx, &snapshot);
    Ok(ExecutionPlanDto::from(&plan))
}

/// Get agent run with real-time metrics
pub async fn get_agent_run_with_metrics(run: AgentRun) -> AgentRunWithMetrics {
    match read_session_jsonl(&run.session_id, &run.project_path).await {
        Ok(jsonl_content) => {
            let metrics = AgentRunMetrics::from_jsonl(&jsonl_content);
            AgentRunWithMetrics {
                run,
                metrics: Some(metrics),
                output: Some(jsonl_content),
            }
        }
        Err(e) => {
            log::warn!("Failed to read JSONL for session {}: {}", run.session_id, e);
            AgentRunWithMetrics {
                run,
                metrics: None,
                output: None,
            }
        }
    }
}

/// Initialize the agents database
pub fn init_database(app: &AppHandle) -> SqliteResult<Connection> {
    let app_dir = app
        .path()
        .app_data_dir()
        .expect("Failed to get app data dir");
    std::fs::create_dir_all(&app_dir).expect("Failed to create app data dir");

    let db_path = app_dir.join("agents.db");
    let conn = Connection::open(db_path)?;

    // Create agents table
    conn.execute(
        "CREATE TABLE IF NOT EXISTS agents (
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
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        )",
        [],
    )?;

    // Add columns to existing table if they don't exist
    let _ = conn.execute("ALTER TABLE agents ADD COLUMN default_task TEXT", []);
    let _ = conn.execute(
        "ALTER TABLE agents ADD COLUMN model TEXT DEFAULT 'sonnet'",
        [],
    );
    let _ = conn.execute("ALTER TABLE agents ADD COLUMN hooks TEXT", []);
    let _ = conn.execute(
        "ALTER TABLE agents ADD COLUMN enable_file_read BOOLEAN DEFAULT 1",
        [],
    );
    let _ = conn.execute(
        "ALTER TABLE agents ADD COLUMN enable_file_write BOOLEAN DEFAULT 1",
        [],
    );
    let _ = conn.execute(
        "ALTER TABLE agents ADD COLUMN enable_network BOOLEAN DEFAULT 0",
        [],
    );
    let _ = conn.execute("ALTER TABLE agents ADD COLUMN tools TEXT", []);

    // spec 111 §2.4 — remote catalog cache columns. `source` discriminates
    // local authoring (the legacy path) from statecraft-managed definitions
    // sync'd over the duplex channel; the `remote_*` fields mirror the
    // authoritative row so the desktop can diff snapshots without refetching
    // bodies on every reconnect.
    let _ = conn.execute(
        "ALTER TABLE agents ADD COLUMN source TEXT NOT NULL DEFAULT 'local'",
        [],
    );
    let _ = conn.execute("ALTER TABLE agents ADD COLUMN remote_agent_id TEXT", []);
    let _ = conn.execute("ALTER TABLE agents ADD COLUMN remote_version INTEGER", []);
    let _ = conn.execute(
        "ALTER TABLE agents ADD COLUMN remote_content_hash TEXT",
        [],
    );
    // Spec 119: the duplex session key is org_id. The local agent cache
    // stores rows by their owning org so a reconnect with a different org
    // sees a fresh slate. The column was previously named after the legacy
    // workspace primitive; new installs land directly on the org name.
    let _ = conn.execute("ALTER TABLE agents ADD COLUMN org_id TEXT", []);
    let _ = conn.execute("ALTER TABLE agents ADD COLUMN frontmatter_json TEXT", []);
    // Partial-unique index so upserts keyed on `remote_agent_id` are atomic
    // while local rows (NULL remote_agent_id) remain unconstrained.
    conn.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS agents_remote_id_uniq
         ON agents(remote_agent_id) WHERE remote_agent_id IS NOT NULL",
        [],
    )?;

    // spec 123 §7.2 — local mirror of `project_agent_bindings`. Tracks which
    // org agents are bound to which project so `list_active_agents(project_id)`
    // can return the bound subset without hitting the network. Populated by the
    // `project.agent_binding.updated` and `project.agent_binding.snapshot`
    // duplex handlers in `agent_catalog_sync.rs`.
    conn.execute(
        "CREATE TABLE IF NOT EXISTS project_agent_bindings (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            project_id TEXT    NOT NULL,
            org_agent_id TEXT  NOT NULL,
            pinned_version    INTEGER NOT NULL,
            pinned_content_hash TEXT NOT NULL,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            UNIQUE (project_id, org_agent_id)
        )",
        [],
    )?;
    conn.execute(
        "CREATE INDEX IF NOT EXISTS project_agent_bindings_project_idx
         ON project_agent_bindings (project_id)",
        [],
    )?;
    conn.execute(
        "CREATE INDEX IF NOT EXISTS project_agent_bindings_agent_idx
         ON project_agent_bindings (org_agent_id)",
        [],
    )?;

    // Create agent_runs table
    conn.execute(
        "CREATE TABLE IF NOT EXISTS agent_runs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            agent_id INTEGER NOT NULL,
            agent_name TEXT NOT NULL,
            agent_icon TEXT NOT NULL,
            task TEXT NOT NULL,
            model TEXT NOT NULL,
            project_path TEXT NOT NULL,
            session_id TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'pending',
            pid INTEGER,
            process_started_at TEXT,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            completed_at TEXT,
            FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE
        )",
        [],
    )?;

    // Migrate existing agent_runs table if needed
    let _ = conn.execute("ALTER TABLE agent_runs ADD COLUMN session_id TEXT", []);
    let _ = conn.execute(
        "ALTER TABLE agent_runs ADD COLUMN status TEXT DEFAULT 'pending'",
        [],
    );
    let _ = conn.execute("ALTER TABLE agent_runs ADD COLUMN pid INTEGER", []);
    let _ = conn.execute(
        "ALTER TABLE agent_runs ADD COLUMN process_started_at TEXT",
        [],
    );

    // Drop old columns that are no longer needed (data is now read from JSONL files)
    // Note: SQLite doesn't support DROP COLUMN, so we'll ignore errors for existing columns
    let _ = conn.execute(
        "UPDATE agent_runs SET session_id = '' WHERE session_id IS NULL",
        [],
    );
    let _ = conn.execute("UPDATE agent_runs SET status = 'completed' WHERE status IS NULL AND completed_at IS NOT NULL", []);
    let _ = conn.execute("UPDATE agent_runs SET status = 'failed' WHERE status IS NULL AND completed_at IS NOT NULL AND session_id = ''", []);
    let _ = conn.execute(
        "UPDATE agent_runs SET status = 'pending' WHERE status IS NULL",
        [],
    );

    // Create trigger to update the updated_at timestamp
    conn.execute(
        "CREATE TRIGGER IF NOT EXISTS update_agent_timestamp 
         AFTER UPDATE ON agents 
         FOR EACH ROW
         BEGIN
             UPDATE agents SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
         END",
        [],
    )?;

    // Create settings table for app-wide settings
    conn.execute(
        "CREATE TABLE IF NOT EXISTS app_settings (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        )",
        [],
    )?;

    // Create trigger to update the updated_at timestamp
    conn.execute(
        "CREATE TRIGGER IF NOT EXISTS update_app_settings_timestamp 
         AFTER UPDATE ON app_settings 
         FOR EACH ROW
         BEGIN
             UPDATE app_settings SET updated_at = CURRENT_TIMESTAMP WHERE key = NEW.key;
         END",
        [],
    )?;

    Ok(conn)
}

/// List all agents
#[tauri::command]
pub async fn list_agents(db: State<'_, AgentDb>) -> Result<Vec<Agent>, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;

    let mut stmt = conn
        .prepare("SELECT id, name, icon, system_prompt, default_task, model, enable_file_read, enable_file_write, enable_network, hooks, created_at, updated_at FROM agents ORDER BY created_at DESC")
        .map_err(|e| e.to_string())?;

    let agents = stmt
        .query_map([], |row| {
            Ok(Agent {
                id: Some(row.get(0)?),
                name: row.get(1)?,
                icon: row.get(2)?,
                system_prompt: row.get(3)?,
                default_task: row.get(4)?,
                model: row
                    .get::<_, String>(5)
                    .unwrap_or_else(|_| "sonnet".to_string()),
                enable_file_read: row.get::<_, bool>(6).unwrap_or(true),
                enable_file_write: row.get::<_, bool>(7).unwrap_or(true),
                enable_network: row.get::<_, bool>(8).unwrap_or(false),
                hooks: row.get(9)?,
                created_at: row.get(10)?,
                updated_at: row.get(11)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    Ok(agents)
}

/// Return the project's org-agent bindings joined with the cached catalog
/// rows (spec 123 §6.3, spec 126 §3). LEFT JOIN so retired-upstream
/// bindings (where `retire_remote_agent` deleted the agents row) still
/// surface — those rows carry `status = "retired_upstream"` and NULL
/// catalog fields so the picker can render them non-selectable per
/// spec 123 invariant I-B3.
#[tauri::command]
pub async fn list_active_agents(
    db: State<'_, AgentDb>,
    project_id: String,
) -> Result<Vec<AgentBindingRow>, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;

    let mut stmt = conn
        .prepare(
            "SELECT b.id,
                    b.project_id,
                    b.org_agent_id,
                    b.pinned_version,
                    b.pinned_content_hash,
                    b.created_at,
                    b.updated_at,
                    a.id,
                    a.name,
                    a.icon,
                    a.model,
                    a.frontmatter_json
             FROM project_agent_bindings b
             LEFT JOIN agents a
               ON a.remote_agent_id = b.org_agent_id
              AND a.source = 'remote'
             WHERE b.project_id = ?1
             ORDER BY COALESCE(a.name, b.org_agent_id) ASC",
        )
        .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map(params![project_id], |row| {
            let agent_id: Option<i64> = row.get(7)?;
            let status = if agent_id.is_some() {
                "active".to_string()
            } else {
                "retired_upstream".to_string()
            };
            Ok(AgentBindingRow {
                binding_id: row.get(0)?,
                project_id: row.get(1)?,
                org_agent_id: row.get(2)?,
                pinned_version: row.get(3)?,
                pinned_content_hash: row.get(4)?,
                created_at: row.get(5)?,
                updated_at: row.get(6)?,
                agent_id,
                name: row.get(8)?,
                icon: row.get(9)?,
                model: row.get(10)?,
                frontmatter_json: row.get(11)?,
                status,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    Ok(rows)
}

/// Return the full org catalog for ad-hoc browsing (spec 123 §6.3,
/// spec 126 §3). The local cache only ever stores published rows
/// (`agent_catalog_sync::handle_catalog_updated` skips drafts and
/// `retire_remote_agent` deletes retired rows), so every row returned
/// here is treated as `published`.
#[tauri::command]
pub async fn list_org_agents(
    db: State<'_, AgentDb>,
    org_id: String,
) -> Result<Vec<AgentCatalogRow>, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;

    let mut stmt = conn
        .prepare(
            "SELECT id,
                    remote_agent_id,
                    name,
                    icon,
                    model,
                    remote_version,
                    remote_content_hash,
                    frontmatter_json,
                    created_at,
                    updated_at
             FROM agents
             WHERE source = 'remote'
               AND org_id = ?1
               AND remote_agent_id IS NOT NULL
               AND remote_version IS NOT NULL
               AND remote_content_hash IS NOT NULL
             ORDER BY name ASC",
        )
        .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map(params![org_id], |row| {
            Ok(AgentCatalogRow {
                agent_id: row.get(0)?,
                org_agent_id: row.get(1)?,
                name: row.get(2)?,
                icon: row.get(3)?,
                model: row.get(4)?,
                version: row.get(5)?,
                content_hash: row.get(6)?,
                frontmatter_json: row.get(7)?,
                created_at: row.get(8)?,
                updated_at: row.get(9)?,
                status: "published".to_string(),
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    Ok(rows)
}

/// Create a new agent
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn create_agent(
    db: State<'_, AgentDb>,
    name: String,
    icon: String,
    system_prompt: String,
    default_task: Option<String>,
    model: Option<String>,
    enable_file_read: Option<bool>,
    enable_file_write: Option<bool>,
    enable_network: Option<bool>,
    hooks: Option<String>,
) -> Result<Agent, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let model = model.unwrap_or_else(|| "sonnet".to_string());
    let enable_file_read = enable_file_read.unwrap_or(true);
    let enable_file_write = enable_file_write.unwrap_or(true);
    let enable_network = enable_network.unwrap_or(false);

    conn.execute(
        "INSERT INTO agents (name, icon, system_prompt, default_task, model, enable_file_read, enable_file_write, enable_network, hooks) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
        params![name, icon, system_prompt, default_task, model, enable_file_read, enable_file_write, enable_network, hooks],
    )
    .map_err(|e| e.to_string())?;

    let id = conn.last_insert_rowid();

    // Fetch the created agent
    let agent = conn
        .query_row(
            "SELECT id, name, icon, system_prompt, default_task, model, enable_file_read, enable_file_write, enable_network, hooks, created_at, updated_at FROM agents WHERE id = ?1",
            params![id],
            |row| {
                Ok(Agent {
                    id: Some(row.get(0)?),
                    name: row.get(1)?,
                    icon: row.get(2)?,
                    system_prompt: row.get(3)?,
                    default_task: row.get(4)?,
                    model: row.get(5)?,
                    enable_file_read: row.get(6)?,
                    enable_file_write: row.get(7)?,
                    enable_network: row.get(8)?,
                    hooks: row.get(9)?,
                    created_at: row.get(10)?,
                    updated_at: row.get(11)?,
                })
            },
        )
        .map_err(|e| e.to_string())?;

    Ok(agent)
}

/// Update an existing agent
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn update_agent(
    db: State<'_, AgentDb>,
    id: i64,
    name: String,
    icon: String,
    system_prompt: String,
    default_task: Option<String>,
    model: Option<String>,
    enable_file_read: Option<bool>,
    enable_file_write: Option<bool>,
    enable_network: Option<bool>,
    hooks: Option<String>,
) -> Result<Agent, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let model = model.unwrap_or_else(|| "sonnet".to_string());

    // Build dynamic query based on provided parameters
    let mut query =
        "UPDATE agents SET name = ?1, icon = ?2, system_prompt = ?3, default_task = ?4, model = ?5, hooks = ?6"
            .to_string();
    let mut params_vec: Vec<Box<dyn rusqlite::ToSql>> = vec![
        Box::new(name),
        Box::new(icon),
        Box::new(system_prompt),
        Box::new(default_task),
        Box::new(model),
        Box::new(hooks),
    ];
    let mut param_count = 6;

    if let Some(efr) = enable_file_read {
        param_count += 1;
        query.push_str(&format!(", enable_file_read = ?{}", param_count));
        params_vec.push(Box::new(efr));
    }
    if let Some(efw) = enable_file_write {
        param_count += 1;
        query.push_str(&format!(", enable_file_write = ?{}", param_count));
        params_vec.push(Box::new(efw));
    }
    if let Some(en) = enable_network {
        param_count += 1;
        query.push_str(&format!(", enable_network = ?{}", param_count));
        params_vec.push(Box::new(en));
    }

    param_count += 1;
    query.push_str(&format!(" WHERE id = ?{}", param_count));
    params_vec.push(Box::new(id));

    conn.execute(
        &query,
        rusqlite::params_from_iter(params_vec.iter().map(|p| p.as_ref())),
    )
    .map_err(|e| e.to_string())?;

    // Fetch the updated agent
    let agent = conn
        .query_row(
            "SELECT id, name, icon, system_prompt, default_task, model, enable_file_read, enable_file_write, enable_network, hooks, created_at, updated_at FROM agents WHERE id = ?1",
            params![id],
            |row| {
                Ok(Agent {
                    id: Some(row.get(0)?),
                    name: row.get(1)?,
                    icon: row.get(2)?,
                    system_prompt: row.get(3)?,
                    default_task: row.get(4)?,
                    model: row.get(5)?,
                    enable_file_read: row.get(6)?,
                    enable_file_write: row.get(7)?,
                    enable_network: row.get(8)?,
                    hooks: row.get(9)?,
                    created_at: row.get(10)?,
                    updated_at: row.get(11)?,
                })
            },
        )
        .map_err(|e| e.to_string())?;

    Ok(agent)
}

/// Delete an agent
#[tauri::command]
pub async fn delete_agent(db: State<'_, AgentDb>, id: i64) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;

    conn.execute("DELETE FROM agents WHERE id = ?1", params![id])
        .map_err(|e| e.to_string())?;

    Ok(())
}

/// Get a single agent by ID
#[tauri::command]
pub async fn get_agent(db: State<'_, AgentDb>, id: i64) -> Result<Agent, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;

    let agent = conn
        .query_row(
            "SELECT id, name, icon, system_prompt, default_task, model, enable_file_read, enable_file_write, enable_network, hooks, created_at, updated_at FROM agents WHERE id = ?1",
            params![id],
            |row| {
                Ok(Agent {
                    id: Some(row.get(0)?),
                    name: row.get(1)?,
                    icon: row.get(2)?,
                    system_prompt: row.get(3)?,
                    default_task: row.get(4)?,
                    model: row.get::<_, String>(5).unwrap_or_else(|_| "sonnet".to_string()),
                    enable_file_read: row.get::<_, bool>(6).unwrap_or(true),
                    enable_file_write: row.get::<_, bool>(7).unwrap_or(true),
                    enable_network: row.get::<_, bool>(8).unwrap_or(false),
                    hooks: row.get(9)?,
                    created_at: row.get(10)?,
                    updated_at: row.get(11)?,
                })
            },
        )
        .map_err(|e| e.to_string())?;

    Ok(agent)
}

/// List agent runs (optionally filtered by agent_id)
#[tauri::command]
pub async fn list_agent_runs(
    db: State<'_, AgentDb>,
    agent_id: Option<i64>,
) -> Result<Vec<AgentRun>, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;

    let query = if agent_id.is_some() {
        "SELECT id, agent_id, agent_name, agent_icon, task, model, project_path, session_id, status, pid, process_started_at, created_at, completed_at 
         FROM agent_runs WHERE agent_id = ?1 ORDER BY created_at DESC"
    } else {
        "SELECT id, agent_id, agent_name, agent_icon, task, model, project_path, session_id, status, pid, process_started_at, created_at, completed_at 
         FROM agent_runs ORDER BY created_at DESC"
    };

    let mut stmt = conn.prepare(query).map_err(|e| e.to_string())?;

    let run_mapper = |row: &rusqlite::Row| -> rusqlite::Result<AgentRun> {
        Ok(AgentRun {
            id: Some(row.get(0)?),
            agent_id: row.get(1)?,
            agent_name: row.get(2)?,
            agent_icon: row.get(3)?,
            task: row.get(4)?,
            model: row.get(5)?,
            project_path: row.get(6)?,
            session_id: row.get(7)?,
            status: row
                .get::<_, String>(8)
                .unwrap_or_else(|_| "pending".to_string()),
            pid: row
                .get::<_, Option<i64>>(9)
                .ok()
                .flatten()
                .map(|p| p as u32),
            process_started_at: row.get(10)?,
            created_at: row.get(11)?,
            completed_at: row.get(12)?,
        })
    };

    let runs = if let Some(aid) = agent_id {
        stmt.query_map(params![aid], run_mapper)
    } else {
        stmt.query_map(params![], run_mapper)
    }
    .map_err(|e| e.to_string())?
    .collect::<Result<Vec<_>, _>>()
    .map_err(|e| e.to_string())?;

    Ok(runs)
}

/// Get a single agent run by ID
#[tauri::command]
pub async fn get_agent_run(db: State<'_, AgentDb>, id: i64) -> Result<AgentRun, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;

    let run = conn
        .query_row(
            "SELECT id, agent_id, agent_name, agent_icon, task, model, project_path, session_id, status, pid, process_started_at, created_at, completed_at 
             FROM agent_runs WHERE id = ?1",
            params![id],
            |row| {
                Ok(AgentRun {
                    id: Some(row.get(0)?),
                    agent_id: row.get(1)?,
                    agent_name: row.get(2)?,
                    agent_icon: row.get(3)?,
                    task: row.get(4)?,
                    model: row.get(5)?,
                    project_path: row.get(6)?,
                    session_id: row.get(7)?,
                    status: row.get::<_, String>(8).unwrap_or_else(|_| "pending".to_string()),
                    pid: row.get::<_, Option<i64>>(9).ok().flatten().map(|p| p as u32),
                    process_started_at: row.get(10)?,
                    created_at: row.get(11)?,
                    completed_at: row.get(12)?,
                })
            },
        )
        .map_err(|e| e.to_string())?;

    Ok(run)
}

/// Get agent run with real-time metrics from JSONL
#[tauri::command]
pub async fn get_agent_run_with_real_time_metrics(
    db: State<'_, AgentDb>,
    id: i64,
) -> Result<AgentRunWithMetrics, String> {
    let run = get_agent_run(db, id).await?;
    Ok(get_agent_run_with_metrics(run).await)
}

/// List agent runs with real-time metrics from JSONL
#[tauri::command]
pub async fn list_agent_runs_with_metrics(
    db: State<'_, AgentDb>,
    agent_id: Option<i64>,
) -> Result<Vec<AgentRunWithMetrics>, String> {
    let runs = list_agent_runs(db, agent_id).await?;
    let mut runs_with_metrics = Vec::new();

    for run in runs {
        let run_with_metrics = get_agent_run_with_metrics(run).await;
        runs_with_metrics.push(run_with_metrics);
    }

    Ok(runs_with_metrics)
}

/// Outcome of the Seam D pre-flight authorization check.
enum AgentAuthOutcome {
    /// Platform says authorized, or no policy row exists (allow by default).
    Allowed,
    /// Platform explicitly denied the agent. Execution MUST NOT proceed.
    Denied(String),
    /// Platform unreachable or not configured. Execution may proceed (graceful degradation).
    Unavailable(String),
}

/// Seam D: pre-flight check against platform agent authorization.
async fn check_agent_authorized(slug: &str, session_org_id: Option<String>) -> AgentAuthOutcome {
    let api_url = match std::env::var("PLATFORM_API_URL")
        .ok()
        .filter(|v| !v.is_empty())
    {
        Some(u) => u,
        None => return AgentAuthOutcome::Unavailable("PLATFORM_API_URL not set".into()),
    };
    let token = match std::env::var("PLATFORM_M2M_TOKEN")
        .ok()
        .filter(|v| !v.is_empty())
    {
        Some(t) => t,
        None => return AgentAuthOutcome::Unavailable("PLATFORM_M2M_TOKEN not set".into()),
    };

    // The platform's `isAgentAuthorized` seam requires the caller's org id
    // as a query parameter (the earlier hardcoded "default" org bucket was
    // removed so block policies bind per-org). The org id comes primarily
    // from the authenticated statecraft session (StatecraftState.org_id),
    // resolved by the caller; the PLATFORM_ORG_ID env var is an override /
    // fallback for headless or pre-login contexts, mirroring the
    // PLATFORM_API_URL / PLATFORM_M2M_TOKEN config pattern. When neither is
    // available the request omits the parameter and the platform returns
    // 400, which maps to Unavailable (graceful degradation) below, so an
    // unconfigured desktop is no worse off than one that cannot reach the
    // platform at all.
    let org_id = session_org_id.filter(|v| !v.is_empty()).or_else(|| {
        std::env::var("PLATFORM_ORG_ID")
            .ok()
            .filter(|v| !v.is_empty())
    });
    let mut url = format!(
        "{}/agents/{}/authorized",
        api_url.trim_end_matches('/'),
        slug
    );
    if let Some(org_id) = org_id {
        url.push_str(&format!("?orgId={}", org_id));
    }

    let client = match reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(3))
        .build()
    {
        Ok(c) => c,
        Err(e) => return AgentAuthOutcome::Unavailable(e.to_string()),
    };

    let resp = match client.get(&url).bearer_auth(&token).send().await {
        Ok(r) => r,
        Err(e) => return AgentAuthOutcome::Unavailable(format!("platform request failed: {e}")),
    };

    match resp.status().as_u16() {
        200 => AgentAuthOutcome::Allowed,
        403 => {
            // Try to extract the reason from the JSON response body.
            let reason = resp
                .json::<serde_json::Value>()
                .await
                .ok()
                .and_then(|v| v.get("message").and_then(|m| m.as_str().map(String::from)))
                .unwrap_or_else(|| format!("agent '{slug}' blocked by org policy"));
            AgentAuthOutcome::Denied(reason)
        }
        404 => AgentAuthOutcome::Allowed, // Unknown agent — allow by default.
        status => {
            AgentAuthOutcome::Unavailable(format!("unexpected status {status} from platform"))
        }
    }
}

/// Validate that project_path is safe to use for agent execution.
fn validate_project_path(path: &str) -> Result<std::path::PathBuf, String> {
    let path = std::path::PathBuf::from(path);
    if !path.is_absolute() {
        return Err("project_path must be absolute".into());
    }
    let canonical = path
        .canonicalize()
        .map_err(|e| format!("Invalid project path: {}", e))?;
    if !canonical.is_dir() {
        return Err("project_path must be an existing directory".into());
    }
    let s = canonical.to_string_lossy();
    if s == "/"
        || s.starts_with("/System")
        || s.starts_with("/usr/")
        || s.starts_with("/bin")
        || s.starts_with("/sbin")
    {
        return Err(format!(
            "project_path must not be a system directory: {}",
            s
        ));
    }
    Ok(canonical)
}

/// Execute a CC agent with streaming output
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn execute_agent(
    app: AppHandle,
    agent_id: i64,
    project_path: String,
    task: String,
    model: Option<String>,
    db: State<'_, AgentDb>,
    registry: State<'_, crate::process::ProcessRegistryState>,
    sidecar: State<'_, SidecarState>,
) -> Result<ExecuteAgentResponse, String> {
    info!("Executing agent {} with task: {}", agent_id, task);

    let project_path = validate_project_path(&project_path)?;
    let project_path = project_path.to_string_lossy().to_string();

    // Get the agent from database
    let agent = get_agent(db.clone(), agent_id).await?;
    let execution_model = model.unwrap_or(agent.model.clone());

    // Create .claude/settings.json with agent hooks if it doesn't exist
    if let Some(hooks_json) = &agent.hooks {
        let claude_dir = std::path::Path::new(&project_path).join(".claude");
        let settings_path = claude_dir.join("settings.json");

        // Create .claude directory if it doesn't exist
        if !claude_dir.exists() {
            std::fs::create_dir_all(&claude_dir)
                .map_err(|e| format!("Failed to create .claude directory: {}", e))?;
            info!("Created .claude directory at: {:?}", claude_dir);
        }

        // Check if settings.json already exists
        if !settings_path.exists() {
            // Parse the hooks JSON
            let hooks: serde_json::Value = serde_json::from_str(hooks_json)
                .map_err(|e| format!("Failed to parse agent hooks: {}", e))?;

            // Create a settings object with just the hooks
            let settings = serde_json::json!({
                "hooks": hooks
            });

            // Write the settings file
            let settings_content = serde_json::to_string_pretty(&settings)
                .map_err(|e| format!("Failed to serialize settings: {}", e))?;

            {
                let parent = settings_path
                    .parent()
                    .ok_or("settings.json path has no parent")?;
                let mut tmp = tempfile::NamedTempFile::new_in(parent)
                    .map_err(|e| format!("Failed to create temp file: {}", e))?;
                tmp.write_all(settings_content.as_bytes())
                    .map_err(|e| format!("Failed to write temp file: {}", e))?;
                tmp.persist(&settings_path)
                    .map_err(|e| format!("Failed to persist settings.json: {}", e))?;
            }

            info!(
                "Created settings.json with agent hooks at: {:?}",
                settings_path
            );
        } else {
            info!("settings.json already exists at: {:?}", settings_path);
        }
    }

    // Create a new run record
    let run_id = {
        let conn = db.0.lock().map_err(|e| e.to_string())?;
        conn.execute(
            "INSERT INTO agent_runs (agent_id, agent_name, agent_icon, task, model, project_path, session_id) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![agent_id, agent.name, agent.icon, task, execution_model, project_path, ""],
        )
        .map_err(|e| e.to_string())?;
        conn.last_insert_rowid()
    };

    // Find Claude binary
    info!("Running agent '{}'", agent.name);
    let claude_path = match find_claude_binary(&app) {
        Ok(path) => path,
        Err(e) => {
            error!("Failed to find claude binary: {}", e);
            return Err(e);
        }
    };

    // Seam D: platform agent authorization pre-flight.
    // Source the org id from the authenticated statecraft session so the
    // per-org block policy binds without a separately-configured env var
    // (check_agent_authorized falls back to PLATFORM_ORG_ID when the session
    // is not yet established). Mirrors the StatecraftState lookup in
    // sidecars.rs::boot_gate_status.
    let session_org_id = app
        .try_state::<crate::commands::statecraft_client::StatecraftState>()
        .and_then(|sc_state| sc_state.current())
        .map(|client| client.org_id())
        .filter(|id| !id.is_empty());
    let slug = agent.name.to_lowercase().replace(' ', "-");
    match check_agent_authorized(&slug, session_org_id).await {
        AgentAuthOutcome::Allowed => {}
        AgentAuthOutcome::Denied(reason) => {
            error!("Agent '{}' blocked by platform: {}", slug, reason);
            return Err(format!("Agent blocked by org policy: {reason}"));
        }
        AgentAuthOutcome::Unavailable(reason) => {
            warn!("Agent '{}' platform auth unavailable: {}", slug, reason);
        }
    }

    let announce_port = *sidecar.axiomregent_port.lock().unwrap();
    let grants_json = crate::governed_claude::grants_json_for_agent(&agent);
    let (plan, bypass_reason) = crate::governed_claude::plan_governed(announce_port, grants_json)?;
    if let Some(reason) = &bypass_reason {
        eprintln!(
            "[governance] execute_agent falling back to bypass: {}",
            reason
        );
    }
    let mode = match &plan {
        crate::governed_claude::GovernedPlan::Governed { .. } => "governed",
        crate::governed_claude::GovernedPlan::Bypass => "bypass",
    };
    let _ = app.emit(
        "governance-mode",
        serde_json::json!({ "mode": mode, "run_id": run_id, "governance_bypass_reason": bypass_reason }),
    );

    // Build arguments (governed: MCP axiomregent; bypass: skip-permissions)
    let mut args = vec![
        "-p".to_string(),
        task.clone(),
        "--system-prompt".to_string(),
        agent.system_prompt.clone(),
        "--model".to_string(),
        execution_model.clone(),
        "--output-format".to_string(),
        "stream-json".to_string(),
        "--verbose".to_string(),
    ];
    crate::governed_claude::append_claude_governance_args(&mut args, &plan);

    // Always use system binary execution (sidecar removed)
    spawn_agent_system(
        app,
        run_id,
        agent_id,
        agent.name.clone(),
        claude_path,
        args,
        project_path,
        task,
        execution_model,
        db,
        registry,
    )
    .await?;
    Ok(ExecuteAgentResponse {
        run_id,
        governance_mode: mode.to_string(),
        governance_bypass_reason: bypass_reason,
    })
}

/// Creates a system binary command for agent execution
fn create_agent_system_command(
    claude_path: &str,
    args: Vec<String>,
    project_path: &str,
) -> Command {
    let mut cmd = create_command_with_env(claude_path);

    // Add all arguments
    for arg in args {
        cmd.arg(arg);
    }

    cmd.current_dir(project_path)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    cmd
}

/// Spawn agent using system binary command
#[allow(clippy::too_many_arguments)]
async fn spawn_agent_system(
    app: AppHandle,
    run_id: i64,
    agent_id: i64,
    agent_name: String,
    claude_path: String,
    args: Vec<String>,
    project_path: String,
    task: String,
    execution_model: String,
    db: State<'_, AgentDb>,
    registry: State<'_, crate::process::ProcessRegistryState>,
) -> Result<i64, String> {
    // Build the command
    let mut cmd = create_agent_system_command(&claude_path, args, &project_path);

    // Spawn the process
    info!("🚀 Spawning Claude system process...");
    let mut child = cmd.spawn().map_err(|e| {
        error!("❌ Failed to spawn Claude process: {}", e);
        format!("Failed to spawn Claude: {}", e)
    })?;

    info!("🔌 Using Stdio::null() for stdin - no input expected");

    // Get the PID and register the process
    let pid = child.id().unwrap_or(0);
    let now = chrono::Utc::now().to_rfc3339();
    info!("✅ Claude process spawned successfully with PID: {}", pid);

    // Update the database with PID and status
    {
        let conn = db.0.lock().map_err(|e| e.to_string())?;
        conn.execute(
            "UPDATE agent_runs SET status = 'running', pid = ?1, process_started_at = ?2 WHERE id = ?3",
            params![pid as i64, now, run_id],
        ).map_err(|e| e.to_string())?;
        info!("📝 Updated database with running status and PID");
    }

    // Get stdout and stderr
    let stdout = child.stdout.take().ok_or("Failed to get stdout")?;
    let stderr = child.stderr.take().ok_or("Failed to get stderr")?;
    info!("📡 Set up stdout/stderr readers");

    // Create readers
    let stdout_reader = TokioBufReader::new(stdout);
    let stderr_reader = TokioBufReader::new(stderr);

    // Create variables we need for the spawned tasks
    let app_dir = app
        .path()
        .app_data_dir()
        .expect("Failed to get app data dir");
    let db_path = app_dir.join("agents.db");

    // Shared state for collecting session ID and live output
    let session_id = std::sync::Arc::new(Mutex::new(String::new()));
    let live_output = std::sync::Arc::new(Mutex::new(String::new()));
    let start_time = std::time::Instant::now();

    // Spawn tasks to read stdout and stderr
    let app_handle = app.clone();
    let session_id_clone = session_id.clone();
    let live_output_clone = live_output.clone();
    let registry_clone = registry.0.clone();
    let first_output = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
    let first_output_clone = first_output.clone();
    let db_path_for_stdout = db_path.clone(); // Clone the db_path for the stdout task

    let stdout_task = tokio::spawn(async move {
        info!("📖 Starting to read Claude stdout...");
        let mut lines = stdout_reader.lines();
        let mut line_count = 0;

        while let Ok(Some(line)) = lines.next_line().await {
            line_count += 1;

            // Log first output
            if !first_output_clone.load(std::sync::atomic::Ordering::Relaxed) {
                info!(
                    "🎉 First output received from Claude process! Line: {}",
                    line
                );
                first_output_clone.store(true, std::sync::atomic::Ordering::Relaxed);
            }

            if line_count <= 5 {
                info!("stdout[{}]: {}", line_count, line);
            } else {
                debug!("stdout[{}]: {}", line_count, line);
            }

            // Store live output in both local buffer and registry
            if let Ok(mut output) = live_output_clone.lock() {
                output.push_str(&line);
                output.push('\n');
            }

            // Also store in process registry for cross-session access
            let _ = registry_clone.append_live_output(run_id, &line);

            // Extract session ID from JSONL output
            if let Ok(json) = serde_json::from_str::<JsonValue>(&line) {
                // Claude Code uses "session_id" (underscore), not "sessionId"
                if json.get("type").and_then(|t| t.as_str()) == Some("system")
                    && json.get("subtype").and_then(|s| s.as_str()) == Some("init")
                    && let Some(sid) = json.get("session_id").and_then(|s| s.as_str())
                    && let Ok(mut current_session_id) = session_id_clone.lock()
                    && current_session_id.is_empty()
                {
                    *current_session_id = sid.to_string();
                    info!("🔑 Extracted session ID: {}", sid);

                    // Update database immediately with session ID
                    if let Ok(conn) = Connection::open(&db_path_for_stdout) {
                        match conn.execute(
                            "UPDATE agent_runs SET session_id = ?1 WHERE id = ?2",
                            params![sid, run_id],
                        ) {
                            Ok(rows) => {
                                if rows > 0 {
                                    info!(
                                        "✅ Updated agent run {} with session ID immediately",
                                        run_id
                                    );
                                }
                            }
                            Err(e) => {
                                error!("❌ Failed to update session ID immediately: {}", e);
                            }
                        }
                    }
                }
            }

            // Emit the line to the frontend with run_id for isolation
            let _ = app_handle.emit(&format!("agent-output:{}", run_id), &line);
            // Also emit to the generic event for backward compatibility
            let _ = app_handle.emit("agent-output", &line);
        }

        info!(
            "📖 Finished reading Claude stdout. Total lines: {}",
            line_count
        );
    });

    let app_handle_stderr = app.clone();
    let first_error = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
    let first_error_clone = first_error.clone();

    let stderr_task = tokio::spawn(async move {
        info!("📖 Starting to read Claude stderr...");
        let mut lines = stderr_reader.lines();
        let mut error_count = 0;

        while let Ok(Some(line)) = lines.next_line().await {
            error_count += 1;

            // Log first error
            if !first_error_clone.load(std::sync::atomic::Ordering::Relaxed) {
                warn!("⚠️ First error output from Claude process! Line: {}", line);
                first_error_clone.store(true, std::sync::atomic::Ordering::Relaxed);
            }

            error!("stderr[{}]: {}", error_count, line);
            // Emit error lines to the frontend with run_id for isolation
            let _ = app_handle_stderr.emit(&format!("agent-error:{}", run_id), &line);
            // Also emit to the generic event for backward compatibility
            let _ = app_handle_stderr.emit("agent-error", &line);
        }

        if error_count > 0 {
            warn!(
                "📖 Finished reading Claude stderr. Total error lines: {}",
                error_count
            );
        } else {
            info!("📖 Finished reading Claude stderr. No errors.");
        }
    });

    // Register the process in the registry for live output tracking (after stdout/stderr setup)
    registry
        .0
        .register_process(
            run_id,
            agent_id,
            agent_name,
            pid,
            project_path.clone(),
            task.clone(),
            execution_model.clone(),
            child,
        )
        .map_err(|e| format!("Failed to register process: {}", e))?;
    info!("📋 Registered process in registry");

    let db_path_for_monitor = db_path.clone(); // Clone for the monitor task

    // Monitor process status and wait for completion
    tokio::spawn(async move {
        info!("🕐 Starting process monitoring...");

        // Wait for first output with timeout
        for i in 0..300 {
            // 30 seconds (300 * 100ms)
            if first_output.load(std::sync::atomic::Ordering::Relaxed) {
                info!(
                    "✅ Output detected after {}ms, continuing normal execution",
                    i * 100
                );
                break;
            }

            if i == 299 {
                warn!("⏰ TIMEOUT: No output from Claude process after 30 seconds");
                warn!("💡 This usually means:");
                warn!("   1. Claude process is waiting for user input");
                warn!("   3. Claude failed to initialize but didn't report an error");
                warn!("   4. Network connectivity issues");
                warn!("   5. Authentication issues (API key not found/invalid)");

                // Process timed out - kill it via PID
                warn!(
                    "🔍 Process likely stuck waiting for input, attempting to kill PID: {}",
                    pid
                );
                let kill_result = std::process::Command::new("kill")
                    .arg("-TERM")
                    .arg(pid.to_string())
                    .output();

                match kill_result {
                    Ok(output) if output.status.success() => {
                        warn!("🔍 Successfully sent TERM signal to process");
                    }
                    Ok(_) => {
                        warn!("🔍 Failed to kill process with TERM, trying KILL");
                        let _ = std::process::Command::new("kill")
                            .arg("-KILL")
                            .arg(pid.to_string())
                            .output();
                    }
                    Err(e) => {
                        warn!("🔍 Error killing process: {}", e);
                    }
                }

                // Update database
                if let Ok(conn) = Connection::open(&db_path_for_monitor) {
                    let _ = conn.execute(
                        "UPDATE agent_runs SET status = 'failed', completed_at = CURRENT_TIMESTAMP WHERE id = ?1",
                        params![run_id],
                    );
                }

                let _ = app.emit("agent-complete", false);
                let _ = app.emit(&format!("agent-complete:{}", run_id), false);
                return;
            }

            tokio::time::sleep(tokio::time::Duration::from_millis(100)).await;
        }

        // Wait for reading tasks to complete
        info!("⏳ Waiting for stdout/stderr reading to complete...");
        let _ = stdout_task.await;
        let _ = stderr_task.await;

        let duration_ms = start_time.elapsed().as_millis() as i64;
        info!("⏱️ Process execution took {} ms", duration_ms);

        // Get the session ID that was extracted
        let extracted_session_id = if let Ok(sid) = session_id.lock() {
            sid.clone()
        } else {
            String::new()
        };

        // Wait for process completion and update status
        info!("✅ Claude process execution monitoring complete");

        // Update the run record with session ID and mark as completed - open a new connection
        if let Ok(conn) = Connection::open(&db_path_for_monitor) {
            info!(
                "🔄 Updating database with extracted session ID: {}",
                extracted_session_id
            );
            match conn.execute(
                "UPDATE agent_runs SET session_id = ?1, status = 'completed', completed_at = CURRENT_TIMESTAMP WHERE id = ?2",
                params![extracted_session_id, run_id],
            ) {
                Ok(rows_affected) => {
                    if rows_affected > 0 {
                        info!("✅ Successfully updated agent run {} with session ID: {}", run_id, extracted_session_id);
                    } else {
                        warn!("⚠️ No rows affected when updating agent run {} with session ID", run_id);
                    }
                }
                Err(e) => {
                    error!("❌ Failed to update agent run {} with session ID: {}", run_id, e);
                }
            }
        } else {
            error!(
                "❌ Failed to open database to update session ID for run {}",
                run_id
            );
        }

        // Cleanup will be handled by the cleanup_finished_processes function

        let _ = app.emit("agent-complete", true);
        let _ = app.emit(&format!("agent-complete:{}", run_id), true);
    });

    Ok(run_id)
}

/// List all currently running agent sessions
#[tauri::command]
pub async fn list_running_sessions(
    db: State<'_, AgentDb>,
    registry: State<'_, crate::process::ProcessRegistryState>,
) -> Result<Vec<AgentRun>, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;

    // First get all running sessions from the database
    let mut stmt = conn.prepare(
        "SELECT id, agent_id, agent_name, agent_icon, task, model, project_path, session_id, status, pid, process_started_at, created_at, completed_at 
         FROM agent_runs WHERE status = 'running' ORDER BY process_started_at DESC"
    ).map_err(|e| e.to_string())?;

    let mut runs = stmt
        .query_map([], |row| {
            Ok(AgentRun {
                id: Some(row.get(0)?),
                agent_id: row.get(1)?,
                agent_name: row.get(2)?,
                agent_icon: row.get(3)?,
                task: row.get(4)?,
                model: row.get(5)?,
                project_path: row.get(6)?,
                session_id: row.get(7)?,
                status: row
                    .get::<_, String>(8)
                    .unwrap_or_else(|_| "pending".to_string()),
                pid: row
                    .get::<_, Option<i64>>(9)
                    .ok()
                    .flatten()
                    .map(|p| p as u32),
                process_started_at: row.get(10)?,
                created_at: row.get(11)?,
                completed_at: row.get(12)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    drop(stmt);
    drop(conn);

    // Cross-check with the process registry to ensure accuracy
    // Get actually running processes from the registry
    let registry_processes = registry.0.get_running_agent_processes()?;
    let registry_run_ids: std::collections::HashSet<i64> =
        registry_processes.iter().map(|p| p.run_id).collect();

    // Filter out any database entries that aren't actually running in the registry
    // This handles cases where processes crashed without updating the database
    runs.retain(|run| {
        if let Some(run_id) = run.id {
            registry_run_ids.contains(&run_id)
        } else {
            false
        }
    });

    Ok(runs)
}

/// Kill a running agent session
#[tauri::command]
pub async fn kill_agent_session(
    app: AppHandle,
    db: State<'_, AgentDb>,
    registry: State<'_, crate::process::ProcessRegistryState>,
    run_id: i64,
) -> Result<bool, String> {
    info!("Attempting to kill agent session {}", run_id);

    // First try to kill using the process registry
    let killed_via_registry = match registry.0.kill_process(run_id).await {
        Ok(success) => {
            if success {
                info!("Successfully killed process {} via registry", run_id);
                true
            } else {
                warn!("Process {} not found in registry", run_id);
                false
            }
        }
        Err(e) => {
            warn!("Failed to kill process {} via registry: {}", run_id, e);
            false
        }
    };

    // If registry kill didn't work, try fallback with PID from database
    if !killed_via_registry {
        let pid_result = {
            let conn = db.0.lock().map_err(|e| e.to_string())?;
            conn.query_row(
                "SELECT pid FROM agent_runs WHERE id = ?1 AND status = 'running'",
                params![run_id],
                |row| row.get::<_, Option<i64>>(0),
            )
            .map_err(|e| e.to_string())?
        };

        if let Some(pid) = pid_result {
            info!("Attempting fallback kill for PID {} from database", pid);
            let _ = registry.0.kill_process_by_pid(run_id, pid as u32)?;
        }
    }

    // Update the database to mark as cancelled
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let updated = conn.execute(
        "UPDATE agent_runs SET status = 'cancelled', completed_at = CURRENT_TIMESTAMP WHERE id = ?1 AND status = 'running'",
        params![run_id],
    ).map_err(|e| e.to_string())?;

    // Emit cancellation event with run_id for proper isolation
    let _ = app.emit(&format!("agent-cancelled:{}", run_id), true);

    Ok(updated > 0 || killed_via_registry)
}

/// Get the status of a specific agent session
#[tauri::command]
pub async fn get_session_status(
    db: State<'_, AgentDb>,
    run_id: i64,
) -> Result<Option<String>, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;

    match conn.query_row(
        "SELECT status FROM agent_runs WHERE id = ?1",
        params![run_id],
        |row| row.get::<_, String>(0),
    ) {
        Ok(status) => Ok(Some(status)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

/// Cleanup finished processes and update their status
#[tauri::command]
pub async fn cleanup_finished_processes(db: State<'_, AgentDb>) -> Result<Vec<i64>, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;

    // Get all running processes
    let mut stmt = conn
        .prepare("SELECT id, pid FROM agent_runs WHERE status = 'running' AND pid IS NOT NULL")
        .map_err(|e| e.to_string())?;

    let running_processes = stmt
        .query_map([], |row| Ok((row.get::<_, i64>(0)?, row.get::<_, i64>(1)?)))
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    drop(stmt);

    let mut cleaned_up = Vec::new();

    for (run_id, pid) in running_processes {
        // Check if the process is still running
        let is_running = if cfg!(target_os = "windows") {
            // On Windows, use tasklist to check if process exists
            match std::process::Command::new("tasklist")
                .args(["/FI", &format!("PID eq {}", pid)])
                .args(["/FO", "CSV"])
                .output()
            {
                Ok(output) => {
                    let output_str = String::from_utf8_lossy(&output.stdout);
                    output_str.lines().count() > 1 // Header + process line if exists
                }
                Err(_) => false,
            }
        } else {
            // On Unix-like systems, use kill -0 to check if process exists
            match std::process::Command::new("kill")
                .args(["-0", &pid.to_string()])
                .output()
            {
                Ok(output) => output.status.success(),
                Err(_) => false,
            }
        };

        if !is_running {
            // Process has finished, update status
            let updated = conn.execute(
                "UPDATE agent_runs SET status = 'completed', completed_at = CURRENT_TIMESTAMP WHERE id = ?1",
                params![run_id],
            ).map_err(|e| e.to_string())?;

            if updated > 0 {
                cleaned_up.push(run_id);
                info!(
                    "Marked agent run {} as completed (PID {} no longer running)",
                    run_id, pid
                );
            }
        }
    }

    Ok(cleaned_up)
}

/// Get live output from a running process
#[tauri::command]
pub async fn get_live_session_output(
    registry: State<'_, crate::process::ProcessRegistryState>,
    run_id: i64,
) -> Result<String, String> {
    registry.0.get_live_output(run_id)
}

/// Get real-time output for a running session by reading its JSONL file with live output fallback
#[tauri::command]
pub async fn get_session_output(
    db: State<'_, AgentDb>,
    registry: State<'_, crate::process::ProcessRegistryState>,
    run_id: i64,
) -> Result<String, String> {
    // Get the session information
    let run = get_agent_run(db, run_id).await?;

    // If no session ID yet, try to get live output from registry
    if run.session_id.is_empty() {
        let live_output = registry.0.get_live_output(run_id)?;
        if !live_output.is_empty() {
            return Ok(live_output);
        }
        return Ok(String::new());
    }

    // Get the Claude directory
    let claude_dir = dirs::home_dir()
        .ok_or("Failed to get home directory")?
        .join(".claude");

    // Find the correct project directory by searching for the session file
    let projects_dir = claude_dir.join("projects");

    // Check if projects directory exists
    if !projects_dir.exists() {
        log::error!("Projects directory not found at: {:?}", projects_dir);
        return Err("Projects directory not found".to_string());
    }

    // Search for the session file in all project directories
    let mut session_file_path = None;
    log::info!(
        "Searching for session file {} in all project directories",
        run.session_id
    );

    if let Ok(entries) = std::fs::read_dir(&projects_dir) {
        for entry in entries.filter_map(Result::ok) {
            let path = entry.path();
            if path.is_dir() {
                let dir_name = path.file_name().unwrap_or_default().to_string_lossy();
                log::debug!("Checking project directory: {}", dir_name);

                let potential_session_file = path.join(format!("{}.jsonl", run.session_id));
                if potential_session_file.exists() {
                    log::info!("Found session file at: {:?}", potential_session_file);
                    session_file_path = Some(potential_session_file);
                    break;
                } else {
                    log::debug!("Session file not found in: {}", dir_name);
                }
            }
        }
    } else {
        log::error!("Failed to read projects directory");
    }

    // If we found the session file, read it
    if let Some(session_path) = session_file_path {
        match tokio::fs::read_to_string(&session_path).await {
            Ok(content) => Ok(content),
            Err(e) => {
                log::error!(
                    "Failed to read session file {}: {}",
                    session_path.display(),
                    e
                );
                // Fallback to live output if file read fails
                let live_output = registry.0.get_live_output(run_id)?;
                Ok(live_output)
            }
        }
    } else {
        // If session file not found, try the old method as fallback
        log::warn!(
            "Session file not found for {}, trying legacy method",
            run.session_id
        );
        match read_session_jsonl(&run.session_id, &run.project_path).await {
            Ok(content) => Ok(content),
            Err(_) => {
                // Final fallback to live output
                let live_output = registry.0.get_live_output(run_id)?;
                Ok(live_output)
            }
        }
    }
}

/// Stream real-time session output by watching the JSONL file
#[tauri::command]
pub async fn stream_session_output(
    app: AppHandle,
    db: State<'_, AgentDb>,
    run_id: i64,
) -> Result<(), String> {
    // Get the session information
    let run = get_agent_run(db, run_id).await?;

    // If no session ID yet, can't stream
    if run.session_id.is_empty() {
        return Err("Session not started yet".to_string());
    }

    let session_id = run.session_id.clone();
    let project_path = run.project_path.clone();

    // Spawn a task to monitor the file
    tokio::spawn(async move {
        let claude_dir = match dirs::home_dir() {
            Some(home) => home.join(".claude").join("projects"),
            None => return,
        };

        let encoded_project = project_path.replace('/', "-");
        let project_dir = claude_dir.join(&encoded_project);
        let session_file = project_dir.join(format!("{}.jsonl", session_id));

        let mut last_size = 0u64;

        // Monitor file changes continuously while session is running
        loop {
            if session_file.exists() {
                if let Ok(metadata) = tokio::fs::metadata(&session_file).await {
                    let current_size = metadata.len();

                    if current_size > last_size {
                        // File has grown, read new content
                        if let Ok(content) = tokio::fs::read_to_string(&session_file).await {
                            let _ = app
                                .emit("session-output-update", &format!("{}:{}", run_id, content));
                        }
                        last_size = current_size;
                    }
                }
            } else {
                // If session file doesn't exist yet, keep waiting
                tokio::time::sleep(tokio::time::Duration::from_secs(2)).await;
                continue;
            }

            // Check if the session is still running by querying the database
            // If the session is no longer running, stop streaming
            if let Ok(conn) = rusqlite::Connection::open(
                app.path()
                    .app_data_dir()
                    .expect("Failed to get app data dir")
                    .join("agents.db"),
            ) {
                if let Ok(status) = conn.query_row(
                    "SELECT status FROM agent_runs WHERE id = ?1",
                    rusqlite::params![run_id],
                    |row| row.get::<_, String>(0),
                ) {
                    if status != "running" {
                        debug!("Session {} is no longer running, stopping stream", run_id);
                        break;
                    }
                } else {
                    // If we can't query the status, assume it's still running
                    debug!(
                        "Could not query session status for {}, continuing stream",
                        run_id
                    );
                }
            }

            tokio::time::sleep(tokio::time::Duration::from_millis(500)).await;
        }

        debug!("Stopped streaming for session {}", run_id);
    });

    Ok(())
}

/// Export a single agent to JSON format
#[tauri::command]
pub async fn export_agent(db: State<'_, AgentDb>, id: i64) -> Result<String, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;

    // Fetch the agent
    let agent = conn
        .query_row(
            "SELECT name, icon, system_prompt, default_task, model, hooks FROM agents WHERE id = ?1",
            params![id],
            |row| {
                Ok(serde_json::json!({
                    "name": row.get::<_, String>(0)?,
                    "icon": row.get::<_, String>(1)?,
                    "system_prompt": row.get::<_, String>(2)?,
                    "default_task": row.get::<_, Option<String>>(3)?,
                    "model": row.get::<_, String>(4)?,
                    "hooks": row.get::<_, Option<String>>(5)?
                }))
            },
        )
        .map_err(|e| format!("Failed to fetch agent: {}", e))?;

    // Create the export wrapper
    let export_data = serde_json::json!({
        "version": 1,
        "exported_at": chrono::Utc::now().to_rfc3339(),
        "agent": agent
    });

    // Convert to pretty JSON string
    serde_json::to_string_pretty(&export_data)
        .map_err(|e| format!("Failed to serialize agent: {}", e))
}

/// Export agent to file with native dialog
#[tauri::command]
pub async fn export_agent_to_file(
    db: State<'_, AgentDb>,
    id: i64,
    file_path: String,
) -> Result<(), String> {
    // Get the JSON data
    let json_data = export_agent(db, id).await?;

    // Write to file
    let target = std::path::Path::new(&file_path);
    {
        let parent = target.parent().ok_or("Export file path has no parent")?;
        let mut tmp = tempfile::NamedTempFile::new_in(parent)
            .map_err(|e| format!("Failed to create temp file: {}", e))?;
        tmp.write_all(json_data.as_bytes())
            .map_err(|e| format!("Failed to write temp file: {}", e))?;
        tmp.persist(target)
            .map_err(|e| format!("Failed to persist file: {}", e))?;
    }

    Ok(())
}

/// Get the stored Claude binary path from settings
#[tauri::command]
pub async fn get_claude_binary_path(db: State<'_, AgentDb>) -> Result<Option<String>, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;

    match conn.query_row(
        "SELECT value FROM app_settings WHERE key = 'claude_binary_path'",
        [],
        |row| row.get::<_, String>(0),
    ) {
        Ok(path) => Ok(Some(path)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(e) => Err(format!("Failed to get Claude binary path: {}", e)),
    }
}

/// Set the Claude binary path in settings
#[tauri::command]
pub async fn set_claude_binary_path(db: State<'_, AgentDb>, path: String) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;

    // Validate that the path exists and is executable
    let path_buf = std::path::PathBuf::from(&path);
    if !path_buf.exists() {
        return Err(format!("File does not exist: {}", path));
    }

    // Check if it's executable (on Unix systems)
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let metadata = std::fs::metadata(&path_buf)
            .map_err(|e| format!("Failed to read file metadata: {}", e))?;
        let permissions = metadata.permissions();
        if permissions.mode() & 0o111 == 0 {
            return Err(format!("File is not executable: {}", path));
        }
    }

    // Insert or update the setting
    conn.execute(
        "INSERT INTO app_settings (key, value) VALUES ('claude_binary_path', ?1)
         ON CONFLICT(key) DO UPDATE SET value = ?1",
        params![path],
    )
    .map_err(|e| format!("Failed to save Claude binary path: {}", e))?;

    Ok(())
}

/// List all available Claude installations on the system
#[tauri::command]
pub async fn list_claude_installations(
    _app: AppHandle,
) -> Result<Vec<crate::claude_binary::ClaudeInstallation>, String> {
    let installations = crate::claude_binary::discover_claude_installations();

    if installations.is_empty() {
        return Err("No Claude Code installations found on the system".to_string());
    }

    Ok(installations)
}

/// Helper function to create a tokio Command with proper environment variables
/// This ensures commands like Claude can find Node.js and other dependencies
fn create_command_with_env(program: &str) -> Command {
    // Convert std::process::Command to tokio::process::Command
    let _std_cmd = crate::claude_binary::create_command_with_env(program);

    // Create a new tokio Command from the program path
    let mut tokio_cmd = Command::new(program);

    // Copy over all environment variables from the std::process::Command
    // This is a workaround since we can't directly convert between the two types
    for (key, value) in std::env::vars() {
        if key == "PATH"
            || key == "HOME"
            || key == "USER"
            || key == "SHELL"
            || key == "LANG"
            || key == "LC_ALL"
            || key.starts_with("LC_")
            || key == "NODE_PATH"
            || key == "NVM_DIR"
            || key == "NVM_BIN"
            || key == "HOMEBREW_PREFIX"
            || key == "HOMEBREW_CELLAR"
        {
            tokio_cmd.env(&key, &value);
        }
    }

    // Add NVM support if the program is in an NVM directory
    if program.contains("/.nvm/versions/node/")
        && let Some(node_bin_dir) = std::path::Path::new(program).parent()
    {
        let current_path = std::env::var("PATH").unwrap_or_default();
        let node_bin_str = node_bin_dir.to_string_lossy();
        if !current_path.contains(node_bin_str.as_ref()) {
            let new_path = format!("{}:{}", node_bin_str, current_path);
            tokio_cmd.env("PATH", new_path);
        }
    }

    // Ensure PATH contains common Homebrew locations
    if let Ok(existing_path) = std::env::var("PATH") {
        let mut paths: Vec<&str> = existing_path.split(':').collect();
        for p in ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin"].iter() {
            if !paths.contains(p) {
                paths.push(p);
            }
        }
        let joined = paths.join(":");
        tokio_cmd.env("PATH", joined);
    } else {
        tokio_cmd.env("PATH", "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin");
    }

    tokio_cmd
}

/// Import an agent from JSON data
#[tauri::command]
pub async fn import_agent(db: State<'_, AgentDb>, json_data: String) -> Result<Agent, String> {
    // Parse the JSON data
    let export_data: AgentExport =
        serde_json::from_str(&json_data).map_err(|e| format!("Invalid JSON format: {}", e))?;

    // Validate version
    if export_data.version != 1 {
        return Err(format!(
            "Unsupported export version: {}. This version of the app only supports version 1.",
            export_data.version
        ));
    }

    let agent_data = export_data.agent;
    let conn = db.0.lock().map_err(|e| e.to_string())?;

    // Check if an agent with the same name already exists
    let existing_count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM agents WHERE name = ?1",
            params![agent_data.name],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;

    // If agent with same name exists, append a suffix
    let final_name = if existing_count > 0 {
        format!("{} (Imported)", agent_data.name)
    } else {
        agent_data.name
    };

    // Create the agent
    conn.execute(
        "INSERT INTO agents (name, icon, system_prompt, default_task, model, enable_file_read, enable_file_write, enable_network, hooks) VALUES (?1, ?2, ?3, ?4, ?5, 1, 1, 0, ?6)",
        params![
            final_name,
            agent_data.icon,
            agent_data.system_prompt,
            agent_data.default_task,
            agent_data.model,
            agent_data.hooks
        ],
    )
    .map_err(|e| format!("Failed to create agent: {}", e))?;

    let id = conn.last_insert_rowid();

    // Fetch the created agent
    let agent = conn
        .query_row(
            "SELECT id, name, icon, system_prompt, default_task, model, enable_file_read, enable_file_write, enable_network, hooks, created_at, updated_at FROM agents WHERE id = ?1",
            params![id],
            |row| {
                Ok(Agent {
                    id: Some(row.get(0)?),
                    name: row.get(1)?,
                    icon: row.get(2)?,
                    system_prompt: row.get(3)?,
                    default_task: row.get(4)?,
                    model: row.get(5)?,
                    enable_file_read: row.get(6)?,
                    enable_file_write: row.get(7)?,
                    enable_network: row.get(8)?,
                    hooks: row.get(9)?,
                    created_at: row.get(10)?,
                    updated_at: row.get(11)?,
                })
            },
        )
        .map_err(|e| format!("Failed to fetch created agent: {}", e))?;

    Ok(agent)
}

/// Import agent from file
#[tauri::command]
pub async fn import_agent_from_file(
    db: State<'_, AgentDb>,
    file_path: String,
) -> Result<Agent, String> {
    // Read the file
    let mut json_data =
        std::fs::read_to_string(&file_path).map_err(|e| format!("Failed to read file: {}", e))?;

    // Normalize potential BOM and whitespace issues
    if json_data.starts_with('\u{feff}') {
        json_data = json_data.trim_start_matches('\u{feff}').to_string();
    }
    // Also trim leading/trailing whitespace to avoid parse surprises
    json_data = json_data.trim().to_string();

    // Import the agent
    import_agent(db, json_data).await
}

// GitHub Agent Import functionality

/// Represents a GitHub agent file from the API
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct GitHubAgentFile {
    pub name: String,
    pub path: String,
    pub download_url: String,
    pub size: i64,
    pub sha: String,
}

/// Represents the GitHub API response for directory contents
#[derive(Debug, Deserialize)]
struct GitHubApiResponse {
    name: String,
    path: String,
    sha: String,
    size: i64,
    download_url: Option<String>,
    #[serde(rename = "type")]
    file_type: String,
}

/// Fetch list of agents from GitHub repository
#[tauri::command]
pub async fn fetch_github_agents() -> Result<Vec<GitHubAgentFile>, String> {
    info!("Fetching agents from GitHub repository...");

    let client = reqwest::Client::new();
    let url = "https://api.github.com/repos/getAsterisk/opc/contents/cc_agents";

    let response = client
        .get(url)
        .header("Accept", "application/vnd.github+json")
        .header("User-Agent", "opc-App")
        .send()
        .await
        .map_err(|e| format!("Failed to fetch from GitHub: {}", e))?;

    if !response.status().is_success() {
        let status = response.status();
        let error_text = response.text().await.unwrap_or_default();
        return Err(format!("GitHub API error ({}): {}", status, error_text));
    }

    let api_files: Vec<GitHubApiResponse> = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse GitHub response: {}", e))?;

    // Filter only .opc.json agent files
    let agent_files: Vec<GitHubAgentFile> = api_files
        .into_iter()
        .filter(|f| f.name.ends_with(".opc.json") && f.file_type == "file")
        .filter_map(|f| {
            f.download_url.map(|download_url| GitHubAgentFile {
                name: f.name,
                path: f.path,
                download_url,
                size: f.size,
                sha: f.sha,
            })
        })
        .collect();

    info!("Found {} agents on GitHub", agent_files.len());
    Ok(agent_files)
}

/// Fetch and preview a specific agent from GitHub
#[tauri::command]
pub async fn fetch_github_agent_content(download_url: String) -> Result<AgentExport, String> {
    info!("Fetching agent content from: {}", download_url);

    let client = reqwest::Client::new();
    let response = client
        .get(&download_url)
        .header("Accept", "application/json")
        .header("User-Agent", "opc-App")
        .send()
        .await
        .map_err(|e| format!("Failed to download agent: {}", e))?;

    if !response.status().is_success() {
        return Err(format!(
            "Failed to download agent: HTTP {}",
            response.status()
        ));
    }

    let json_text = response
        .text()
        .await
        .map_err(|e| format!("Failed to read response: {}", e))?;

    // Parse and validate the agent data
    let export_data: AgentExport = serde_json::from_str(&json_text)
        .map_err(|e| format!("Invalid agent JSON format: {}", e))?;

    // Validate version
    if export_data.version != 1 {
        return Err(format!(
            "Unsupported agent version: {}",
            export_data.version
        ));
    }

    Ok(export_data)
}

/// Import an agent directly from GitHub
#[tauri::command]
pub async fn import_agent_from_github(
    db: State<'_, AgentDb>,
    download_url: String,
) -> Result<Agent, String> {
    info!("Importing agent from GitHub: {}", download_url);

    // First, fetch the agent content
    let export_data = fetch_github_agent_content(download_url).await?;

    // Convert to JSON string and use existing import logic
    let json_data = serde_json::to_string(&export_data)
        .map_err(|e| format!("Failed to serialize agent data: {}", e))?;

    // Import using existing function
    import_agent(db, json_data).await
}

/// Load agent session history from JSONL file
/// Similar to Claude Code's load_session_history, but searches across all project directories
#[tauri::command]
pub async fn load_agent_session_history(
    session_id: String,
) -> Result<Vec<serde_json::Value>, String> {
    log::info!("Loading agent session history for session: {}", session_id);

    let claude_dir = dirs::home_dir()
        .ok_or("Failed to get home directory")?
        .join(".claude");

    let projects_dir = claude_dir.join("projects");

    if !projects_dir.exists() {
        log::error!("Projects directory not found at: {:?}", projects_dir);
        return Err("Projects directory not found".to_string());
    }

    // Search for the session file in all project directories
    let mut session_file_path = None;
    log::info!(
        "Searching for session file {} in all project directories",
        session_id
    );

    if let Ok(entries) = std::fs::read_dir(&projects_dir) {
        for entry in entries.filter_map(Result::ok) {
            let path = entry.path();
            if path.is_dir() {
                let dir_name = path.file_name().unwrap_or_default().to_string_lossy();
                log::debug!("Checking project directory: {}", dir_name);

                let potential_session_file = path.join(format!("{}.jsonl", session_id));
                if potential_session_file.exists() {
                    log::info!("Found session file at: {:?}", potential_session_file);
                    session_file_path = Some(potential_session_file);
                    break;
                } else {
                    log::debug!("Session file not found in: {}", dir_name);
                }
            }
        }
    } else {
        log::error!("Failed to read projects directory");
    }

    if let Some(session_path) = session_file_path {
        let file = std::fs::File::open(&session_path)
            .map_err(|e| format!("Failed to open session file: {}", e))?;

        let reader = BufReader::new(file);
        let mut messages = Vec::new();

        for line in reader.lines() {
            if let Ok(line) = line
                && let Ok(json) = serde_json::from_str::<serde_json::Value>(&line)
            {
                messages.push(json);
            }
        }

        Ok(messages)
    } else {
        Err(format!("Session file not found: {}", session_id))
    }
}

