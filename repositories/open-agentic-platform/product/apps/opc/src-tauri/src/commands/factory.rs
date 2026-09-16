use chrono::Utc;
use factory_engine::{
    FactoryAgentBridge, FactoryEngine, FactoryEngineConfig, FactoryPipelineState,
    record_scaffold_completion, record_scaffold_failure,
};
use orchestrator::{
    AgentPromptLookup, ArtifactManager, ClaudeCodeExecutor, DispatchOptions, GateHandler,
    StepEvent, StepEventHandler, detect_resume_plan_for_run, dispatch_manifest,
    materialize_run_directory, promotion::SyncTracker,
};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::{HashMap, HashSet};
use std::path::PathBuf;
use std::sync::{Arc, LazyLock, Mutex};
use tauri::{AppHandle, Emitter, Manager};
use uuid::Uuid;

use super::factory_platform::{
    platform_context, prepare_run_root, FactoryError, RunEmitter,
};
use super::keychain::clone_token_load;
use super::statecraft_client::{StatecraftClient, StatecraftState};
use super::sync_client::{
    FactoryAgentRef, FactoryRunTokenSpend, FactoryStageOutcome, FnHandler,
    KnowledgeBundle as WireKnowledgeBundle, ServerEnvelopeWire, SyncClientState,
};

/// Sentinel meaning "no process name supplied — let the platform resolve
/// its current process." The client must NOT bake in a process name: the
/// platform owns process naming (spec 124 §6), so a rename there must not
/// require a desktop rebuild. When a name is absent, `prepare_run_root`
/// lists the org's processes and uses the platform's current name; when
/// the desktop forwards `bundle.processes[].name`, that name is used
/// verbatim. The empty string flows through to that resolution path —
/// it never reaches the platform as a literal process name.
const DEFAULT_PROCESS_NAME: &str = "";

/// Spec 112 §6.4.5 — load the project's clone token from the OS
/// keychain and surface it as `{ GITHUB_TOKEN: <value> }` for the
/// factory engine subprocess. Empty map when:
///   * no `project_id` is supplied (local-only pipeline run, no
///     statecraft binding),
///   * no clone token is stored (public repo, anonymous run), or
///   * the keychain read errors (logged once, run continues
///     anonymously — surfaces as 401 from GitHub if the run actually
///     needs auth, and the cockpit's refresh path takes over).
fn clone_token_env_for_project(project_id: Option<&str>) -> HashMap<String, String> {
    let Some(pid) = project_id else {
        return HashMap::new();
    };
    match clone_token_load(pid.to_string()) {
        Ok(Some(stored)) => {
            let mut env = HashMap::new();
            env.insert("GITHUB_TOKEN".to_string(), stored.value);
            env
        }
        Ok(None) => HashMap::new(),
        Err(err) => {
            eprintln!(
                "[factory] clone token load failed for project {pid}: {err}; \
                 starting run without GITHUB_TOKEN"
            );
            HashMap::new()
        }
    }
}

// ---------------------------------------------------------------------------
// Step event handler — bridges orchestrator's StepEvent stream to Tauri events
// so the desktop UI can render terminal-style live output during execution.
// Mirrors the existing `factory:*` event surface the React side already
// listens for in FactoryPipelineContext.
// ---------------------------------------------------------------------------

struct TauriStepEventHandler {
    app: AppHandle,
    run_id: String,
    /// Spec 124 §6 — duplex emitter shared with the run context. `None`
    /// for runs that never reserved a platform row (legacy code paths
    /// kept for tests). Production runs always have an emitter.
    emitter: Option<RunEmitter>,
    /// Spec 124 §6.1 — per-stage agent triple captured at reservation
    /// time. Looked up by `step_id` when emitting `factory.run.stage_started`.
    /// Stages without an entry emit a placeholder so the platform
    /// handler still sees a valid envelope.
    stage_agents: Arc<HashMap<String, FactoryAgentRef>>,
}

impl TauriStepEventHandler {
    fn new(
        app: AppHandle,
        run_id: String,
        emitter: Option<RunEmitter>,
        stage_agents: Arc<HashMap<String, FactoryAgentRef>>,
    ) -> Self {
        Self {
            app,
            run_id,
            emitter,
            stage_agents,
        }
    }

    fn agent_ref_for_step(&self, step_id: &str) -> FactoryAgentRef {
        self.stage_agents
            .get(step_id)
            .cloned()
            .unwrap_or_else(|| FactoryAgentRef {
                org_agent_id: String::new(),
                version: 0,
                content_hash: String::new(),
            })
    }
}

impl StepEventHandler for TauriStepEventHandler {
    fn handle(&self, event: StepEvent) {
        match event {
            StepEvent::StepStarted { step_id } => {
                let _ = self.app.emit(
                    "factory:step_started",
                    &serde_json::json!({
                        "runId": self.run_id,
                        "stepId": step_id,
                    }),
                );
                if let Some(emitter) = &self.emitter {
                    let emitter = emitter.clone();
                    let agent_ref = self.agent_ref_for_step(&step_id);
                    let stage_id = step_id.clone();
                    tokio::spawn(async move {
                        if let Err(e) = emitter.stage_started(&stage_id, agent_ref).await {
                            log::warn!(
                                "factory.run.stage_started emit failed for {stage_id}: {e}"
                            );
                        }
                    });
                }
            }
            StepEvent::AgentOutput { step_id, line } => {
                let _ = self.app.emit(
                    "factory:agent_output",
                    &serde_json::json!({
                        "runId": self.run_id,
                        "stepId": step_id,
                        "line": line,
                    }),
                );
            }
            StepEvent::StepCompleted {
                step_id,
                tokens_used,
            } => {
                let _ = self.app.emit(
                    "factory:step_completed",
                    &serde_json::json!({
                        "runId": self.run_id,
                        "stepId": step_id,
                        "tokenSpend": tokens_used.unwrap_or(0),
                        "artifacts": Vec::<String>::new(),
                    }),
                );
                if let Some(emitter) = &self.emitter {
                    let emitter = emitter.clone();
                    let stage_id = step_id.clone();
                    tokio::spawn(async move {
                        if let Err(e) = emitter
                            .stage_completed(&stage_id, FactoryStageOutcome::Ok, None)
                            .await
                        {
                            log::warn!(
                                "factory.run.stage_completed emit failed for {stage_id}: {e}"
                            );
                        }
                    });
                }
            }
            StepEvent::StepFailed { step_id, error } => {
                let _ = self.app.emit(
                    "factory:step_failed",
                    &serde_json::json!({
                        "runId": self.run_id,
                        "stepId": step_id,
                        "error": error,
                    }),
                );
                if let Some(emitter) = &self.emitter {
                    let emitter = emitter.clone();
                    let stage_id = step_id.clone();
                    let err_msg = error.clone();
                    tokio::spawn(async move {
                        if let Err(e) = emitter
                            .stage_completed(
                                &stage_id,
                                FactoryStageOutcome::Failed,
                                Some(err_msg),
                            )
                            .await
                        {
                            log::warn!(
                                "factory.run.stage_completed(failed) emit failed for {stage_id}: {e}"
                            );
                        }
                    });
                }
            }
        }
    }
}

// ---------------------------------------------------------------------------
// Serde types — frontend-facing shapes (preserved for React compatibility)
// ---------------------------------------------------------------------------

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct StartPipelineResponse {
    pub run_id: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct PipelineStatusResponse {
    pub run_id: String,
    pub phase: String, // "idle" | "process" | "scaffolding" | "complete" | "failed" | "paused"
    pub stages: Vec<StageInfo>,
    pub scaffolding: Option<ScaffoldingInfo>,
    pub total_tokens: u64,
    pub audit_trail: Vec<AuditEntry>,
    /// Adapter recorded at run start (live runs) or read from `state.json`
    /// (disk fallback). Empty for legacy runs that pre-date state.json
    /// being written before terminal phases. The desktop UI uses this to
    /// resume the run without depending on a separate adapter prop.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub adapter: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct StageInfo {
    pub id: String,
    pub name: String,
    pub status: String, // "pending" | "in_progress" | "completed" | "failed" | "awaiting_gate"
    pub token_spend: u64,
    pub artifacts: Vec<String>,
    pub started_at: Option<String>,
    pub completed_at: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ScaffoldingInfo {
    pub categories: Vec<CategoryInfo>,
    pub active_step_id: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct CategoryInfo {
    pub category: String,
    pub total: usize,
    pub completed: usize,
    pub failed: usize,
    pub in_progress: usize,
    pub steps: Vec<StepInfo>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct StepInfo {
    pub id: String,
    pub category: String,
    pub feature_name: String,
    pub status: String,
    pub retry_count: u32,
    pub max_retries: u32,
    pub last_error: Option<String>,
    pub token_spend: u64,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ArtifactInfo {
    pub name: String,
    pub path: String,
    pub size: u64,
    pub mime_type: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct AuditEntry {
    pub timestamp: String,
    pub action: String,
    pub stage_id: Option<String>,
    pub details: Option<String>,
    pub feedback: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct PipelineRunSummary {
    pub run_id: String,
    pub adapter: String,
    pub project_path: String,
    pub started_at: String,
    pub completed_at: Option<String>,
    pub phase: String,
    pub total_tokens: u64,
    /// Count of process stages with at least one output file on disk.
    /// Surfaced in the Pipeline History table so the user can see how far
    /// each run got without selecting it.
    #[serde(default)]
    pub stages_completed: u32,
    #[serde(default)]
    pub stages_total: u32,
    /// Display name of the highest-index completed stage; `None` when no
    /// stage produced an output yet.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_completed_stage: Option<String>,
}

// ---------------------------------------------------------------------------
// TauriGateHandler — bridges orchestrator gates to Tauri events + oneshots
// ---------------------------------------------------------------------------

/// Normalise a factory stage id to its `sN` prefix so ids that differ only by
/// their descriptive suffix join across vocabularies. OPC's local step ids are
/// `s4-api-specification` / `s5-ui-specification`; statecraft's `PIPELINE_STAGES`
/// use `s4-api-spec` / `s5-ui-spec`; the human sign-off surface labels them
/// `s1`/`s2`/`s3`. All share the leading `sN` token, which is the stable join
/// key. Returns `None` for anything that is not `s<digits>` (optionally
/// followed by `-suffix`).
fn stage_prefix(stage_id: &str) -> Option<String> {
    let head = stage_id.split('-').next()?;
    let digits = head.strip_prefix('s')?;
    if !digits.is_empty() && digits.bytes().all(|b| b.is_ascii_digit()) {
        Some(head.to_string())
    } else {
        None
    }
}

/// Given the currently-pending gate step ids, find the one whose stage-prefix
/// matches `stage_id` (see `stage_prefix`). This is the join that lets a
/// statecraft-web `stage_confirmed` (carrying `s4-api-spec` or the `s1` label)
/// resolve the OPC-local gate keyed `s4-api-specification`. When several
/// pending gates share a prefix (not expected), the lexically smallest is
/// chosen so the selection is deterministic.
fn match_pending_stage<'a>(
    pending_keys: impl Iterator<Item = &'a String>,
    stage_id: &str,
) -> Option<String> {
    let want = stage_prefix(stage_id)?;
    pending_keys
        .filter(|k| stage_prefix(k).as_deref() == Some(want.as_str()))
        .min()
        .cloned()
}

struct TauriGateHandler {
    app: AppHandle,
    pending: Mutex<HashMap<String, tokio::sync::oneshot::Sender<Result<(), String>>>>,
}

impl TauriGateHandler {
    fn new(app: AppHandle) -> Self {
        Self {
            app,
            pending: Mutex::new(HashMap::new()),
        }
    }

    /// Resolve a pending gate as approved.
    fn approve(&self, step_id: &str) -> Result<(), String> {
        let mut pending = self.pending.lock().map_err(|e| e.to_string())?;
        if let Some(tx) = pending.remove(step_id) {
            tx.send(Ok(()))
                .map_err(|_| "gate channel closed".to_string())
        } else {
            Err(format!("no pending gate for step {step_id}"))
        }
    }

    /// Resolve a pending gate as rejected.
    fn reject(&self, step_id: &str, feedback: &str) -> Result<(), String> {
        let mut pending = self.pending.lock().map_err(|e| e.to_string())?;
        if let Some(tx) = pending.remove(step_id) {
            tx.send(Err(format!("rejected: {feedback}")))
                .map_err(|_| "gate channel closed".to_string())
        } else {
            Err(format!("no pending gate for step {step_id}"))
        }
    }

    /// Resolve a pending gate matched by stage-prefix rather than exact step id
    /// (see `match_pending_stage`), returning the local step id that resolved.
    /// This is the path a gate approved on the statecraft web surface takes: the
    /// `stage_confirmed` `factory.event` carries statecraft's stage id, which
    /// only prefix-matches the OPC-local gate key.
    fn approve_by_prefix(&self, stage_id: &str) -> Result<String, String> {
        let mut pending = self.pending.lock().map_err(|e| e.to_string())?;
        let key = match_pending_stage(pending.keys(), stage_id)
            .ok_or_else(|| format!("no pending gate matching stage '{stage_id}'"))?;
        let tx = pending.remove(&key).expect("key came from match_pending_stage");
        tx.send(Ok(()))
            .map_err(|_| "gate channel closed".to_string())?;
        Ok(key)
    }

    /// Reject a pending gate matched by stage-prefix (see `approve_by_prefix`).
    fn reject_by_prefix(&self, stage_id: &str, feedback: &str) -> Result<String, String> {
        let mut pending = self.pending.lock().map_err(|e| e.to_string())?;
        let key = match_pending_stage(pending.keys(), stage_id)
            .ok_or_else(|| format!("no pending gate matching stage '{stage_id}'"))?;
        let tx = pending.remove(&key).expect("key came from match_pending_stage");
        tx.send(Err(format!("rejected: {feedback}")))
            .map_err(|_| "gate channel closed".to_string())?;
        Ok(key)
    }
}

#[async_trait::async_trait]
impl GateHandler for TauriGateHandler {
    async fn await_checkpoint(&self, step_id: &str, label: Option<&str>) -> Result<(), String> {
        let (tx, rx) = tokio::sync::oneshot::channel();
        {
            let mut pending = self.pending.lock().map_err(|e| e.to_string())?;
            pending.insert(step_id.to_string(), tx);
        }
        // The TS-side `FactoryGateReachedEvent` expects `stageId` /
        // `stageName` (matching the rest of the gate-confirm API surface).
        // When emitting `stepId` here, the React listener destructured
        // undefined, the dialog title rendered without a stage name, and
        // Confirm POSTed an empty `stage_id` so `gate_handler.approve("")`
        // never matched the pending oneshot. Emit the right field names
        // so the same step id round-trips back through `confirm_factory_stage`.
        self.app
            .emit(
                "factory:gate_reached",
                &serde_json::json!({
                    "stageId": step_id,
                    "stageName": label.unwrap_or(step_id),
                    "gateType": "checkpoint",
                }),
            )
            .map_err(|e| format!("emit gate_reached failed: {e}"))?;

        rx.await.map_err(|_| "gate channel closed".to_string())?
    }

    async fn await_approval(&self, step_id: &str, timeout_ms: u64) -> Result<(), String> {
        let (tx, rx) = tokio::sync::oneshot::channel();
        {
            let mut pending = self.pending.lock().map_err(|e| e.to_string())?;
            pending.insert(step_id.to_string(), tx);
        }
        self.app
            .emit(
                "factory:gate_reached",
                &serde_json::json!({
                    "stageId": step_id,
                    "stageName": step_id,
                    "gateType": "approval",
                    "timeoutMs": timeout_ms,
                }),
            )
            .map_err(|e| format!("emit gate_reached failed: {e}"))?;

        // The orchestrator's evaluate_gate wraps this call in tokio::time::timeout,
        // so we just wait for the UI to resolve the oneshot.
        rx.await.map_err(|_| "gate channel closed".to_string())?
    }
}

// ---------------------------------------------------------------------------
// BridgeLookup — adapts FactoryAgentBridge to AgentPromptLookup
// ---------------------------------------------------------------------------

struct BridgeLookup(Arc<FactoryAgentBridge>);

impl AgentPromptLookup for BridgeLookup {
    fn get_prompt(&self, agent_id: &str) -> Option<String> {
        self.0.get_prompt(agent_id).map(String::from)
    }
}

// ---------------------------------------------------------------------------
// Run context — replaces the fake in-memory state machine
// ---------------------------------------------------------------------------

struct FactoryRunContext {
    run_id: Uuid,
    gate_handler: Arc<TauriGateHandler>,
    pipeline_state: Mutex<FactoryPipelineState>,
    project_path: PathBuf,
    adapter_name: String,
    audit_trail: Mutex<Vec<AuditEntry>>,
    stage_status: Mutex<HashMap<String, StageTracker>>,
    /// The run's stage list (spec 076) — platform-derived ids + display
    /// names. `build_status_response` iterates this so the status it returns
    /// reflects the platform process definition, not a hardcoded skeleton.
    stage_defs: Vec<StageDef>,
    /// When set, lifecycle events are dual-written to this Statecraft project.
    statecraft_project_id: Option<String>,
    /// The Statecraft-assigned pipeline ID, captured from init_pipeline response.
    statecraft_pipeline_id: Mutex<Option<String>>,
    /// Tab/execution session that owns this run (spec 110 §2.4). Minted on
    /// tab creation for statecraft-triggered runs; a fresh UUID for OPC-direct
    /// runs. Surfaces back on `factory.run.ack` and on every `execution.status`
    /// the run emits.
    session_id: String,
    /// Spec 124 §3 — platform-issued `factory_runs.id`. The desktop emits
    /// every `factory.run.*` envelope keyed by this value.
    platform_run_id: String,
    /// Spec 124 §6 — duplex emitter shared with the step-event handler.
    emitter: RunEmitter,
}

#[derive(Clone, Debug)]
struct StageTracker {
    status: String,
    token_spend: u64,
    artifacts: Vec<String>,
    started_at: Option<String>,
    completed_at: Option<String>,
}

static FACTORY_RUNS: LazyLock<Mutex<HashMap<String, Arc<FactoryRunContext>>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

/// Dedupe set for `factory.run.request` envelopes (spec 110 §2.1: exactly-once
/// intent per pipeline_id). The server's outbox is at-least-once; the first
/// envelope wins and subsequent retries for the same `pipeline_id` become
/// no-ops. Entries live for the life of the OPC process — a retry after a
/// process restart is treated as a fresh request (the prior run persisted its
/// state to disk and statecraft correlates by pipeline_id regardless).
static FACTORY_RUN_REQUESTS_SEEN: LazyLock<Mutex<HashSet<String>>> =
    LazyLock::new(|| Mutex::new(HashSet::new()));

// ---------------------------------------------------------------------------
// Process stage constants (the 6 Factory pipeline stages)
// ---------------------------------------------------------------------------

/// Canonical six-stage pipeline. Post spec 076 this is the FALLBACK + the
/// display-name source: a live run seeds its stage list from the platform
/// process definition (so the structure is platform-owned, not client-baked),
/// and falls back to these when the definition can't be parsed. The names
/// here are the curated labels for the canonical ids.
const PROCESS_STAGES: &[(&str, &str)] = &[
    ("s0-preflight", "Pre-flight"),
    ("s1-business-requirements", "Business Requirements"),
    ("s2-service-requirements", "Service Requirements"),
    ("s3-data-model", "Data Model"),
    ("s4-api-specification", "API Specification"),
    ("s5-ui-specification", "UI Specification"),
];

/// A pipeline stage seeded for a run: load-bearing `id` (matches the engine
/// and duplex events) plus a cosmetic display `name`.
#[derive(Debug, Clone)]
pub struct StageDef {
    pub id: String,
    pub name: String,
}

/// Display name for a stage id: the curated label when the id is one of the
/// canonical six, else a titleised form of the id (drop a leading `sN-`
/// index, replace dashes with spaces, capitalise words) so a platform-defined
/// stage the client has never seen still renders a readable name.
fn stage_display_name(id: &str) -> String {
    if let Some((_, name)) = PROCESS_STAGES.iter().find(|(sid, _)| *sid == id) {
        return name.to_string();
    }
    // Strip a leading `sN-` ordering prefix (only when it really is one) so
    // ids like `adapter-handoff` keep their first word.
    let body = match id.split_once('-') {
        Some((prefix, rest))
            if prefix.len() >= 2
                && prefix.starts_with('s')
                && prefix[1..].chars().all(|c| c.is_ascii_digit()) =>
        {
            rest
        }
        _ => id,
    };
    body.split('-')
        .filter(|w| !w.is_empty())
        .map(|w| {
            let mut chars = w.chars();
            match chars.next() {
                Some(first) => first.to_uppercase().collect::<String>() + chars.as_str(),
                None => String::new(),
            }
        })
        .collect::<Vec<_>>()
        .join(" ")
}

/// Build the stage list for a run: the platform process definition's stage
/// ids when available (spec 076), else the canonical [`PROCESS_STAGES`]
/// fallback so a definition the client can't parse never yields an empty DAG.
fn stage_defs_for_run(stage_ids: &[String]) -> Vec<StageDef> {
    if stage_ids.is_empty() {
        return PROCESS_STAGES
            .iter()
            .map(|(id, name)| StageDef {
                id: id.to_string(),
                name: name.to_string(),
            })
            .collect();
    }
    stage_ids
        .iter()
        .map(|id| StageDef {
            id: id.clone(),
            name: stage_display_name(id),
        })
        .collect()
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

fn now_iso() -> String {
    Utc::now().format("%Y-%m-%dT%H:%M:%SZ").to_string()
}

/// Fire-and-forget: update pipeline status in Statecraft.
fn sc_update_status(
    sc: &StatecraftClient,
    project_id: &str,
    pipeline_id: &str,
    status: &str,
    current_stage: Option<&str>,
    error: Option<&str>,
    phase: Option<&str>,
) {
    let sc = sc.clone();
    let project_id = project_id.to_string();
    let pipeline_id = pipeline_id.to_string();
    let status = status.to_string();
    let current_stage = current_stage.map(String::from);
    let error = error.map(String::from);
    let phase = phase.map(String::from);
    tokio::spawn(async move {
        if let Err(e) = sc
            .update_pipeline_status(
                &project_id,
                &pipeline_id,
                &status,
                current_stage.as_deref(),
                error.as_deref(),
                phase.as_deref(),
            )
            .await
        {
            log::warn!("Statecraft status update failed ({status}): {e}");
        }
    });
}

/// Resolve the Statecraft client + project_id + pipeline_id triple if dual-write is active.
fn resolve_sc_context(
    ctx: &FactoryRunContext,
    sc_client: &Option<Arc<StatecraftClient>>,
) -> Option<(Arc<StatecraftClient>, String, String)> {
    let sc = sc_client.as_ref()?;
    let project_id = ctx.statecraft_project_id.as_ref()?;
    let pipeline_id = ctx.statecraft_pipeline_id.lock().ok()?.clone()?;
    Some((sc.clone(), project_id.clone(), pipeline_id))
}

/// Fire-and-forget: post step-level events from a dispatch summary to Statecraft.
/// When a `SyncTracker` is provided, records ack/fail for promotion eligibility (099 Slice 1).
fn sc_ingest_step_events(
    sc: &StatecraftClient,
    project_id: &str,
    pipeline_id: &str,
    summary: &orchestrator::RunSummary,
    phase: &str,
    sync_tracker: Option<&SyncTracker>,
) {
    let events: Vec<super::statecraft_client::OrchestratorEventReport> = summary
        .steps
        .iter()
        .flat_map(|step| {
            let mut evts = vec![super::statecraft_client::OrchestratorEventReport {
                event_type: "step_completed".into(),
                step_id: Some(step.step_id.clone()),
                timestamp: now_iso(),
                payload: Some(serde_json::json!({
                    "agent": step.agent,
                    "status": format!("{:?}", step.status),
                    "tokens_used": step.tokens_used,
                    "phase": phase,
                })),
            }];
            if matches!(
                step.status,
                orchestrator::StepStatus::Failure | orchestrator::StepStatus::VerificationFailed
            ) {
                evts[0].event_type = "step_failed".into();
            }
            evts
        })
        .collect();

    if events.is_empty() {
        return;
    }

    let event_count = events.len() as u32;
    let sc = sc.clone();
    let project_id = project_id.to_string();
    let pipeline_id = pipeline_id.to_string();
    let tracker = sync_tracker.cloned();
    tokio::spawn(async move {
        match sc.ingest_events(&project_id, &pipeline_id, &events).await {
            Ok(_) => {
                if let Some(ref t) = tracker {
                    t.record_events_ack(event_count);
                }
            }
            Err(e) => {
                log::warn!("Statecraft event ingestion failed: {e}");
                if let Some(ref t) = tracker {
                    t.record_events_fail(e.to_string());
                }
            }
        }
    });
}

/// Record step output artifacts to Statecraft for promotion eligibility (099).
fn sc_record_artifacts(
    sc: &StatecraftClient,
    project_id: &str,
    pipeline_id: &str,
    summary: &orchestrator::RunSummary,
    stage_id: &str,
    sync_tracker: Option<&SyncTracker>,
) {
    let mut artifacts = Vec::new();
    for step in &summary.steps {
        for (filename, hash) in &step.output_hashes {
            let size = step
                .output_artifacts
                .iter()
                .find(|p| {
                    p.file_name()
                        .map(|f| f.to_string_lossy() == filename.as_str())
                        .unwrap_or(false)
                })
                .and_then(|p| std::fs::metadata(p).ok())
                .map(|m| m.len())
                .unwrap_or(0);
            let ext = std::path::Path::new(filename)
                .extension()
                .map(|e| e.to_string_lossy().to_string())
                .unwrap_or_else(|| "unknown".to_string());
            artifacts.push(super::statecraft_client::ArtifactRecord {
                artifact_type: ext,
                content_hash: hash.clone(),
                storage_path: filename.clone(),
                size_bytes: size,
            });
        }
    }
    if artifacts.is_empty() {
        // No artifacts to record — still count as ack so sync succeeds.
        if let Some(t) = sync_tracker {
            t.record_artifacts_ack(0);
        }
        return;
    }

    let sc = sc.clone();
    let pid = project_id.to_string();
    let plid = pipeline_id.to_string();
    let sid = stage_id.to_string();
    let tracker = sync_tracker.cloned();
    let count = artifacts.len() as u32;

    tokio::spawn(async move {
        match sc.record_artifacts(&pid, &plid, &sid, &artifacts).await {
            Ok(_) => {
                if let Some(ref t) = tracker {
                    t.record_artifacts_ack(count);
                }
            }
            Err(e) => {
                log::warn!("Statecraft artifact recording failed: {e}");
                if let Some(ref t) = tracker {
                    t.record_artifacts_fail(e.to_string());
                }
            }
        }
    });
}

/// Infer the scaffold category from a step ID.
/// Step IDs follow patterns like "s6a-entity-*" (data), "s6b-api-*" (api), "s6c-ui-*" (ui), etc.
fn infer_scaffold_category(step_id: &str) -> String {
    if step_id.contains("entity") || step_id.starts_with("s6a") {
        "data".into()
    } else if step_id.contains("api") || step_id.starts_with("s6b") {
        "api".into()
    } else if step_id.contains("page") || step_id.contains("ui") || step_id.starts_with("s6c") {
        "ui".into()
    } else if step_id.contains("config") || step_id.starts_with("s6d") {
        "configure".into()
    } else if step_id.contains("trim") || step_id.starts_with("s6e") {
        "trim".into()
    } else if step_id.contains("valid") || step_id.starts_with("s6f") {
        "validate".into()
    } else {
        "data".into() // fallback
    }
}

fn mime_from_ext(name: &str) -> &'static str {
    let ext = name.rsplit('.').next().unwrap_or("").to_lowercase();
    match ext.as_str() {
        "md" => "markdown",
        "json" => "json",
        "yaml" | "yml" => "yaml",
        _ => "text",
    }
}

/// Spec 124 §6 — emit a terminal `factory.run.failed` envelope. Errors
/// are logged but never propagated; the duplex emitter spools to disk
/// when the stream is disconnected (T053).
async fn emit_terminal_failed(ctx: &FactoryRunContext, error: &str) {
    if let Err(e) = ctx.emitter.failed(error.to_string()).await {
        log::warn!(
            "factory.run.failed emit/spool failed for run {}: {e}",
            ctx.platform_run_id
        );
    }
}

/// Spec 124 §6 + spec 198 FR-009/FR-014 — emit the governance certificate
/// (bound to the admission + intent capsule when the run was governed),
/// report terminal completion carrying the certificate hash + final grant
/// seq, and patch the platform countersign into the persisted certificate
/// when the platform verifies the grant chain it issued. An unsealed
/// certificate is logged — visible, never silently equivalent to sealed.
async fn emit_terminal_completed(
    ctx: &FactoryRunContext,
    total_tokens: u64,
    governance: Option<&Arc<super::run_governance::RunGovernance>>,
    requirements_hash: &str,
    budget_consumption: Vec<factory_engine::governance_certificate::BudgetAxisRecord>,
) {
    // Pre-rollup the per-stage observations into the wire shape. The
    // platform handler stores `{input, output, total}`; the desktop's
    // orchestrator currently exposes a single combined count, so we
    // split evenly between input and output. The platform UI surfaces
    // the total as the headline number; the split is informational.
    let half = total_tokens / 2;
    let token_spend = FactoryRunTokenSpend {
        input: half,
        output: total_tokens - half,
        total: total_tokens,
    };

    let run_dir = ctx
        .project_path
        .join(".factory")
        .join("runs")
        .join(ctx.run_id.to_string());
    let binding = governance.map(|g| g.capsule_binding());
    // Clone out of the lock before any await (the guard is not Send).
    let pipeline_state = ctx.pipeline_state.lock().ok().map(|guard| guard.clone());
    let Some(pipeline_state) = pipeline_state else {
        if let Err(e) = ctx.emitter.completed(token_spend, None, None).await {
            log::warn!(
                "factory.run.completed emit/spool failed for run {}: {e}",
                ctx.platform_run_id
            );
        }
        return;
    };
    // Spec 102 FR-003 + 198 FR-009: every desktop run termination emits the
    // certificate under its run dir; empty stage-id list = filesystem
    // discovery of the run's actual step outputs.
    let cert = factory_engine::governance_certificate::generate_certificate_bound(
        &pipeline_state,
        requirements_hash,
        &run_dir,
        None,
        &[],
        binding.as_ref(),
        budget_consumption,
    );
    let cert_hash = cert.certificate_hash.clone();
    if let Err(e) = factory_engine::governance_certificate::persist_certificate(&cert, &run_dir) {
        log::warn!(
            "governance certificate persist failed for run {}: {e}",
            ctx.platform_run_id
        );
    }
    let final_seq = governance
        .map(|g| g.last_seq.load(std::sync::atomic::Ordering::Acquire));

    match ctx
        .emitter
        .completed(token_spend, Some(cert_hash), final_seq)
        .await
    {
        Ok(Some(cs)) if cs.countersigned => {
            if let (Some(jws), Some(gov)) = (cs.countersign_jws.as_deref(), governance) {
                let cert_path = run_dir.join("governance-certificate.json");
                match factory_engine::governance_certificate::apply_countersign(
                    &cert_path,
                    jws,
                    &gov.jwks,
                    Some(&ctx.platform_run_id),
                ) {
                    Ok(()) => log::info!(
                        "governance certificate SEALED (platform countersign) for run {}",
                        ctx.platform_run_id
                    ),
                    Err(e) => log::warn!(
                        "countersign apply failed — certificate stays unsealed for run {}: {e}",
                        ctx.platform_run_id
                    ),
                }
            }
        }
        Ok(Some(cs)) => log::warn!(
            "platform refused countersign for run {} — certificate stays visibly unsealed: {}",
            ctx.platform_run_id,
            cs.refused_reason.unwrap_or_default()
        ),
        Ok(None) => log::info!(
            "run {} completed without a live countersign round-trip — certificate stays visibly unsealed (spec 198 FR-014)",
            ctx.platform_run_id
        ),
        Err(e) => log::warn!(
            "factory.run.completed emit/spool failed for run {}: {e}",
            ctx.platform_run_id
        ),
    }
}

/// Spec 124 §6 — emit a terminal `factory.run.cancelled` envelope.
async fn emit_terminal_cancelled(ctx: &FactoryRunContext, reason: Option<String>) {
    if let Err(e) = ctx.emitter.cancelled(reason).await {
        log::warn!(
            "factory.run.cancelled emit/spool failed for run {}: {e}",
            ctx.platform_run_id
        );
    }
}

/// Build a PipelineStatusResponse from the live run context.
fn build_status_response(ctx: &FactoryRunContext) -> PipelineStatusResponse {
    let pipeline_state = ctx.pipeline_state.lock().unwrap();
    let stage_status = ctx.stage_status.lock().unwrap();
    let audit_trail = ctx.audit_trail.lock().unwrap();

    let phase = match pipeline_state.phase {
        factory_engine::FactoryPhase::Process => "process",
        factory_engine::FactoryPhase::Scaffolding => "scaffolding",
        factory_engine::FactoryPhase::Complete => "complete",
        factory_engine::FactoryPhase::Failed => "failed",
    };

    let stages: Vec<StageInfo> = ctx
        .stage_defs
        .iter()
        .map(|sd| {
            let tracker = stage_status.get(&sd.id);
            StageInfo {
                id: sd.id.clone(),
                name: sd.name.clone(),
                status: tracker
                    .map(|t| t.status.clone())
                    .unwrap_or_else(|| "pending".into()),
                token_spend: tracker.map(|t| t.token_spend).unwrap_or(0),
                artifacts: tracker.map(|t| t.artifacts.clone()).unwrap_or_default(),
                started_at: tracker.and_then(|t| t.started_at.clone()),
                completed_at: tracker.and_then(|t| t.completed_at.clone()),
            }
        })
        .collect();

    // Build scaffolding info from pipeline state if in scaffolding phase.
    let scaffolding = pipeline_state.scaffolding.as_ref().map(|sp| {
        // Entities
        let categories = vec![
            CategoryInfo {
                category: "data".into(),
                total: sp.entities_completed.len() + sp.entities_failed.len(),
                completed: sp.entities_completed.len(),
                failed: sp.entities_failed.len(),
                in_progress: 0,
                steps: sp
                    .entities_failed
                    .iter()
                    .map(|f| StepInfo {
                        id: f.step_id.clone(),
                        category: "data".into(),
                        feature_name: f.name.clone(),
                        status: "failed".into(),
                        retry_count: f.retries,
                        max_retries: 3,
                        last_error: Some(f.last_error.clone()),
                        token_spend: 0,
                    })
                    .collect(),
            },
            // Operations
            CategoryInfo {
                category: "api".into(),
                total: sp.operations_completed.len() + sp.operations_failed.len(),
                completed: sp.operations_completed.len(),
                failed: sp.operations_failed.len(),
                in_progress: 0,
                steps: sp
                    .operations_failed
                    .iter()
                    .map(|f| StepInfo {
                        id: f.step_id.clone(),
                        category: "api".into(),
                        feature_name: f.name.clone(),
                        status: "failed".into(),
                        retry_count: f.retries,
                        max_retries: 3,
                        last_error: Some(f.last_error.clone()),
                        token_spend: 0,
                    })
                    .collect(),
            },
            // Pages
            CategoryInfo {
                category: "ui".into(),
                total: sp.pages_completed.len() + sp.pages_failed.len(),
                completed: sp.pages_completed.len(),
                failed: sp.pages_failed.len(),
                in_progress: 0,
                steps: sp
                    .pages_failed
                    .iter()
                    .map(|f| StepInfo {
                        id: f.step_id.clone(),
                        category: "ui".into(),
                        feature_name: f.name.clone(),
                        status: "failed".into(),
                        retry_count: f.retries,
                        max_retries: 3,
                        last_error: Some(f.last_error.clone()),
                        token_spend: 0,
                    })
                    .collect(),
            },
        ];
        ScaffoldingInfo {
            categories,
            active_step_id: None,
        }
    });

    PipelineStatusResponse {
        run_id: ctx.run_id.to_string(),
        phase: phase.to_string(),
        stages,
        scaffolding,
        total_tokens: pipeline_state.total_tokens,
        audit_trail: audit_trail.clone(),
        adapter: Some(ctx.adapter_name.clone()),
    }
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

/// Adapter option for the desktop's adapter picker (spec 076). Mirrors the
/// platform's `GET /api/factory/adapters` summary — `name` + `version`.
#[derive(Debug, Clone, serde::Serialize)]
pub struct FactoryAdapterOption {
    pub name: String,
    pub version: String,
}

/// List the org's factory adapters so the desktop can populate its adapter
/// dropdown from platform data instead of a free-text field. The platform
/// owns adapter naming (spec 124 §6.2 establishes the same posture for
/// processes); the selectable set is whatever the org's substrate reports.
#[tauri::command]
pub async fn list_factory_adapters(app: AppHandle) -> Result<Vec<FactoryAdapterOption>, String> {
    let ctx = platform_context(&app).map_err(FactoryError::into_user_message)?;
    let adapters = ctx
        .client
        .list_adapters()
        .await
        .map_err(|e| FactoryError::from(e).into_user_message())?;
    Ok(adapters
        .into_iter()
        .map(|a| FactoryAdapterOption {
            name: a.name,
            version: a.version,
        })
        .collect())
}

/// Resolve the local project directory for a resume, with an actionable error.
///
/// A run surfaced from the platform run list carries no local filesystem path:
/// `list_factory_runs` now leaves `project_path` empty rather than emitting the
/// statecraft project UUID, which the old code canonicalised straight into a
/// raw `No such file or directory (os error 2)` when the user clicked Resume on
/// a project that has no local copy on this machine. Resume genuinely needs the
/// local directory that holds the run's `.factory/runs/<id>` artifacts, so when
/// the path is empty or does not resolve we point the user at the clone/open
/// handoff instead of surfacing a bare OS error. Unlike `start`, this does NOT
/// require a git clone: spec-110 envelope runs live under a non-git scratch
/// path and must remain resumable.
fn resolve_resume_project_path(raw_path: &str) -> Result<PathBuf, String> {
    const REMEDY: &str = "This run has no local copy on this machine. Open the \
        project in OPC (Open in OPC, then Clone locally) and start a fresh run, \
        or resume from the machine where it originally ran.";
    let trimmed = raw_path.trim();
    if trimmed.is_empty() {
        return Err(format!("cannot resume: no local project path. {REMEDY}"));
    }
    PathBuf::from(trimmed).canonicalize().map_err(|_| {
        format!("cannot resume: project not found locally at '{trimmed}'. {REMEDY}")
    })
}

/// Start a new Factory pipeline run.
///
/// Creates a real `FactoryEngine`, generates a Phase 1 manifest, and dispatches
/// it via the orchestrator's `dispatch_manifest`. Gates are bridged to Tauri
/// events so the React UI can confirm/reject them.
#[tauri::command]
pub async fn start_factory_pipeline(
    app: AppHandle,
    project_path: String,
    adapter_name: String,
    process_name: Option<String>,
    business_doc_paths: Vec<String>,
    statecraft_project_id: Option<String>,
    session_id: Option<String>,
) -> Result<StartPipelineResponse, String> {
    let process_name = process_name
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(|| DEFAULT_PROCESS_NAME.to_string());
    let project_path = PathBuf::from(&project_path);
    let doc_paths: Vec<PathBuf> = business_doc_paths.iter().map(PathBuf::from).collect();

    // Ensure project directory exists. NOTE: `start` intentionally accepts a
    // not-yet-existing path and creates it, because the spec-110 envelope
    // trigger (`handle_factory_run_request`) runs against a workspace-scoped
    // scratch path (`$OPC_CACHE_DIR/projects/<project_id>`) that is not a git
    // clone. Do not add a clone requirement here without wiring the envelope
    // flow to a real cloned project path first.
    std::fs::create_dir_all(&project_path)
        .map_err(|e| format!("create project dir failed: {e}"))?;
    let project_path = project_path
        .canonicalize()
        .map_err(|e| format!("resolve project path failed: {e}"))?;

    // Spec 124 §5/§6 — replace the spec-108 in-tree walk with a platform
    // reservation + content-addressed materialisation. `prepared.run_id`
    // is the platform-issued `factory_runs.id`; all subsequent
    // `factory.run.*` envelopes are keyed by it.
    let ctx_pf = platform_context(&app).map_err(FactoryError::into_user_message)?;
    let prepared = prepare_run_root(
        &ctx_pf,
        &adapter_name,
        &process_name,
        statecraft_project_id.as_deref(),
    )
    .await
    .map_err(FactoryError::into_user_message)?;
    let factory_root = prepared.engine_factory_root.clone();
    let platform_run_id = prepared.run_id.clone();

    // Build engine and start pipeline against the materialised cache.
    // Spec 139 Phase 3 (T072) — `factory_root` is wrapped in
    // `FactoryRoot::Filesystem` since `factory_platform_client` already
    // materialises the substrate content into a local directory. The
    // engine's enum variant signals "filesystem path" semantics
    // unambiguously; future runs that want pure HTTP-driven reads can
    // swap in `FactoryRoot::Virtual(...)` without changing the engine.
    let config = FactoryEngineConfig {
        factory_root: factory_engine::FactoryRoot::Filesystem(factory_root.clone()),
        project_path: project_path.clone(),
        concurrency_limit: 4,
    };
    let engine = FactoryEngine::new(config).map_err(|e| {
        // Spec 124 (2026-06-05): log factory engine failures so they land in
        // opc.log instead of being UI-only. Adapter discovery / manifest parse
        // failures surface here; the desktop cache writer now validates the
        // manifest shape earlier (factory-platform-client::write_adapter), but
        // engine-side faults still funnel through this map_err.
        log::error!("factory: engine init failed (adapter='{adapter_name}'): {e}");
        e.to_string()
    })?;

    let org_id: Option<String> = Some(ctx_pf.org_id.clone());

    let start = engine
        .start_pipeline(&adapter_name, &doc_paths, org_id.clone())
        .map_err(|e| {
            log::error!("factory: start_pipeline failed (adapter='{adapter_name}'): {e}");
            e.to_string()
        })?;

    let run_id = start.run_id;
    let run_id_str = run_id.to_string();

    // Set up artifact manager under the project directory. The cache root
    // (T043) is the platform-fed adapter/process tree; per-run scratch
    // (artifacts, logs) lives next to the project so the React UI can keep
    // pointing at it (spec 124 §5 — "Per-run scratch dir is NOT the cache
    // root").
    let artifact_dir = project_path.join(".factory").join("runs");
    let am = ArtifactManager::new(&artifact_dir);
    materialize_run_directory(&am, run_id, &start.manifest)
        .map_err(|e| format!("materialize run dir failed: {e}"))?;

    // Create gate handler and run context.
    let gate_handler = Arc::new(TauriGateHandler::new(app.clone()));
    let bridge = Arc::new(start.agent_bridge);

    let initial_audit = AuditEntry {
        timestamp: now_iso(),
        action: "pipeline_started".into(),
        stage_id: None,
        details: Some(format!(
            "adapter={} process={} platform_run_id={} docs={}",
            adapter_name,
            prepared.process_name,
            platform_run_id,
            business_doc_paths.join(",")
        )),
        feedback: None,
    };

    // Seed the per-stage tracker from the platform process definition (spec
    // 076) rather than a stage list compiled into the client. Falls back to
    // the canonical six when the definition can't be parsed.
    let stage_defs = stage_defs_for_run(&prepared.stage_ids);
    let mut initial_stages = HashMap::new();
    for sd in &stage_defs {
        initial_stages.insert(
            sd.id.clone(),
            StageTracker {
                status: "pending".into(),
                token_spend: 0,
                artifacts: vec![],
                started_at: None,
                completed_at: None,
            },
        );
    }

    let emitter = RunEmitter::new(&app, platform_run_id.clone())
        .map_err(FactoryError::into_user_message)?;

    let ctx = Arc::new(FactoryRunContext {
        run_id,
        gate_handler: gate_handler.clone(),
        pipeline_state: Mutex::new(start.pipeline_state),
        project_path: project_path.clone(),
        adapter_name: adapter_name.clone(),
        audit_trail: Mutex::new(vec![initial_audit]),
        stage_status: Mutex::new(initial_stages),
        stage_defs,
        statecraft_project_id: statecraft_project_id.clone(),
        statecraft_pipeline_id: Mutex::new(None),
        // Tab/execution session (spec 110 §2.4). Statecraft-triggered runs
        // pass the minted id from the envelope handler; OPC-direct runs
        // generate a fresh one so the invariant "every run has a session"
        // holds uniformly.
        session_id: session_id
            .filter(|s| !s.is_empty())
            .unwrap_or_else(|| Uuid::new_v4().to_string()),
        platform_run_id: platform_run_id.clone(),
        emitter: emitter.clone(),
    });

    FACTORY_RUNS
        .lock()
        .map_err(|e| e.to_string())?
        .insert(run_id_str.clone(), ctx.clone());

    // Spec 124 §6 — the platform row is born `queued` at reservation time;
    // the first stage_started envelope flips it to `running`. All
    // lifecycle/state-of-the-run updates flow over the duplex bus from
    // here on; no on-disk state.json is written.
    let _ = platform_run_id;

    // Dual-write: register pipeline with Statecraft (fire-and-forget).
    if let Some(sc_project_id) = &statecraft_project_id {
        let sc_opt: Option<Arc<StatecraftClient>> =
            app.try_state::<StatecraftState>().and_then(|s| s.current());
        if let Some(sc) = sc_opt {
            let pid = sc_project_id.clone();
            let adapter = adapter_name.clone();
            let docs: Vec<_> = business_doc_paths
                .iter()
                .map(|p| super::statecraft_client::BusinessDocRef {
                    name: PathBuf::from(p)
                        .file_name()
                        .and_then(|n| n.to_str())
                        .unwrap_or("unknown")
                        .to_string(),
                    storage_ref: p.clone(),
                })
                .collect();
            let ctx_init = ctx.clone();
            let app_for_init = app.clone();
            tokio::spawn(async move {
                match sc.init_pipeline(&pid, &adapter, &docs).await {
                    Ok(resp) => {
                        // Log the id triad so a repro can correlate the three
                        // identities in play: the OPC-local run_id, the platform
                        // reservation row (`platform_run_id`, the id the web UI
                        // shows), and the statecraft `pipeline_id` that inbound
                        // `factory.event` gate approvals are keyed on
                        // (find_run_by_pipeline). A web run_id that differs from
                        // this pipeline_id is the "gates approved on web, nothing
                        // happens locally" correlation miss.
                        log::info!(
                            "Statecraft pipeline registered: pipeline_id={} (local run_id={}, platform_run_id={})",
                            resp.pipeline_id, ctx_init.run_id, ctx_init.platform_run_id
                        );
                        if let Ok(mut guard) = ctx_init.statecraft_pipeline_id.lock() {
                            *guard = Some(resp.pipeline_id);
                        }
                    }
                    Err(e) => {
                        // Fail loud, not a silent warn: with no statecraft
                        // pipeline_id recorded, find_run_by_pipeline can never
                        // match this run, so every web-side gate approval for it
                        // is silently undeliverable (spec 076/124). Surface it in
                        // the UI so the operator sees that governance sign-off
                        // will not reach this run.
                        log::error!(
                            "Statecraft init_pipeline failed for local run_id={}: web gate approvals will NOT reach this run: {e}",
                            ctx_init.run_id
                        );
                        let _ = app_for_init.emit(
                            "factory:statecraft_correlation_failed",
                            &serde_json::json!({
                                "runId": ctx_init.run_id.to_string(),
                                "platformRunId": ctx_init.platform_run_id,
                                "error": e.to_string(),
                            }),
                        );
                    }
                }
            });
        }
    }

    // Emit start event immediately.
    app.emit(
        "factory:workflow_started",
        &serde_json::json!({
            "runId": run_id_str,
            "adapter": adapter_name,
            "projectPath": project_path.to_string_lossy(),
            "startedAt": now_iso(),
        }),
    )
    .map_err(|e| format!("emit factory:workflow_started failed: {e}"))?;

    // Spawn the dispatch in the background so the command returns immediately.
    let app_handle = app.clone();
    let manifest = start.manifest;
    let adapter_for_spawn = adapter_name.clone();
    let ctx_for_spawn = ctx.clone();
    let project_id_for_spawn = statecraft_project_id.clone();
    let sc_client: Option<Arc<StatecraftClient>> = statecraft_project_id
        .as_ref()
        .and_then(|_| app.try_state::<StatecraftState>())
        .and_then(|s| s.current());
    // Spec 124 §6.1 — per-stage agent triple captured at reservation time
    // is stamped onto every `factory.run.stage_started` envelope by the
    // step-event handler.
    let stage_agents: Arc<HashMap<String, FactoryAgentRef>> = Arc::new(
        prepared
            .stage_agents
            .iter()
            .cloned()
            .collect::<HashMap<_, _>>(),
    );
    let emitter_for_spawn = ctx.emitter.clone();

    // Spec 198 / spec 102 — requirements hash mirrors bin/factory_run.rs:
    // SHA-256 over the business-doc bytes the agents actually receive.
    // Persisted in the run dir so a resumed run binds the same intent.
    let requirements_hash = {
        let mut hasher = Sha256::new();
        for p in &business_doc_paths {
            if let Ok(bytes) = std::fs::read(p) {
                hasher.update(&bytes);
            }
        }
        hex::encode(hasher.finalize())
    };
    let _ = std::fs::write(
        artifact_dir.join(run_id.to_string()).join("requirements-hash.txt"),
        &requirements_hash,
    );

    // Derive governance mode once for the entire pipeline (098 Slice 2).
    let grants_json = crate::governed_claude::grants_json_claude_default();
    let (gov_plan, bypass_reason) = crate::governed_claude::plan_governed_from_binary(&grants_json)
        .map_err(|e| format!("factory start: {e}"))?;
    if let Some(reason) = &bypass_reason {
        eprintln!(
            "[governance] factory start falling back to bypass: {}",
            reason
        );
    }
    let governance_mode_str = match &gov_plan {
        crate::governed_claude::GovernedPlan::Governed { .. } => "governed".to_string(),
        crate::governed_claude::GovernedPlan::Bypass => "bypass".to_string(),
    };
    // Single SyncTracker shared across both phases (099 Slice 2).
    let sync_tracker = SyncTracker::new();

    tokio::spawn(async move {
        // Mark the start of the governance+execution task. Without this the
        // OPC log jumped straight from "Statecraft pipeline registered" to
        // silence whenever governance stalled, giving no signal the local
        // executor ever began (the UI sat at "Waiting for agent output").
        log::info!("factory run {run_id}: governance+execution task started");

        // Dual-write: mark pipeline as "running" in Statecraft.
        if let Some((sc, pid, plid)) = resolve_sc_context(&ctx_for_spawn, &sc_client) {
            sc_update_status(
                &sc,
                &pid,
                &plid,
                "running",
                Some("s0-preflight"),
                None,
                Some("process"),
            );
        }

        // Spec 198 FR-005/FR-014 — establish run governance before any stage
        // executes: verify the admission seal (ASI04 m1), file the intent
        // capsule, obtain the issuance grant. Project-bound runs are governed
        // fail-closed — a refusal halts the run before s0. An ad-hoc run (no
        // project binding / platform client) proceeds ungoverned and is
        // visibly logged; its factory content already passed the
        // admission-gated bundle, and its certificate stays unsealed.
        let governance = match (&sc_client, ctx_for_spawn.statecraft_project_id.as_deref()) {
            (Some(sc), Some(project_id)) => {
                let run_dir =
                    super::run_governance::run_dir_for(&project_path, &run_id.to_string());
                let goal = format!(
                    "factory run: adapter {adapter_for_spawn} for project {project_id}"
                );
                match super::run_governance::establish(
                    sc,
                    emitter_for_spawn.clone(),
                    project_id,
                    &ctx_for_spawn.platform_run_id,
                    &goal,
                    &run_dir,
                )
                .await
                {
                    Ok(g) => Some(g),
                    Err(e) => {
                        log::error!("run governance refused for run {run_id}: {e}");
                        ctx_for_spawn.pipeline_state.lock().unwrap().mark_failed();
                        emit_terminal_failed(&ctx_for_spawn, &e).await;
                        if let Some((sc2, pid, plid)) =
                            resolve_sc_context(&ctx_for_spawn, &sc_client)
                        {
                            sc_update_status(
                                &sc2,
                                &pid,
                                &plid,
                                "failed",
                                None,
                                Some(&e),
                                Some("process"),
                            );
                        }
                        app_handle
                            .emit(
                                "factory:workflow_failed",
                                &serde_json::json!({
                                    "runId": run_id.to_string(),
                                    "error": e,
                                    "phase": "process",
                                }),
                            )
                            .ok();
                        return;
                    }
                }
            }
            _ => {
                log::warn!(
                    "run {run_id} starts UNGOVERNED (no project binding / platform client) — \
                     no run-grant chain will exist and the certificate stays unsealed (spec 198 FR-005)"
                );
                None
            }
        };
        // Spec 202 FR-002: run-level blast-radius meter under platform
        // defaults (declared-envelope budgets are a follow-up; RunGovernance
        // carries only the envelope hash today). Held in scope for the
        // FR-005 certificate binding (spec 202 Slice C).
        let budget_meter = Arc::new(Mutex::new(orchestrator::RunBudgetMeter::new(
            factory_contracts::apply_defaults(&[]),
        )));
        // Spec 202 FR-002/FR-001/AC-3 + FR-003b: the budget gate and the
        // oscillation detector ride EVERY run under platform defaults (an
        // absent budget is fail-closed, not exempt), including the
        // ungoverned/bypass arm below where governance is None, exactly as the
        // CLI wires them. When governance is present they compose AFTER the
        // stage-boundary renewal gate (FR-005): grant-first, then budget, then
        // oscillation, short-circuit on the first Err (ChainedPreStepGate
        // order). Neither gate has a grant-chain dependency, so they ride alone
        // when governance is absent.
        let budget_gate: Arc<dyn orchestrator::PreStepGate> =
            Arc::new(orchestrator::BudgetGate::new(budget_meter.clone()));
        let oscillation_cfg = factory_contracts::apply_oscillation_default(None);
        let oscillation_breaker = Arc::new(Mutex::new(orchestrator::CircuitBreakerState::new(
            orchestrator::CircuitBreakerConfig {
                threshold: oscillation_cfg.consecutive_failures,
                window_secs: oscillation_cfg.window_secs.unwrap_or(300),
            },
        )));
        let oscillation_gate: Arc<dyn orchestrator::PreStepGate> =
            Arc::new(orchestrator::OscillationGate::new(oscillation_breaker.clone()));
        // Spec 202 FR-003a: the intent-dedup detector also rides every run
        // under platform defaults, same posture as budget/oscillation above.
        // The governed arm scopes the signature to the filed intent capsule's
        // goal_id (ASI01 m7); the ungoverned arm has no capsule, so it falls
        // back to a run-scoped id derived from the run's own uuid (no
        // cross-run correlation is needed there since there is nothing to
        // correlate against).
        let intent_goal_id = match governance.as_ref() {
            Some(gov) => gov.capsule.goal_id.clone(),
            None => factory_engine::intent_capsule::derive_goal_id(&run_id.to_string()),
        };
        let intent_dedup_gate: Arc<dyn orchestrator::PreStepGate> =
            Arc::new(orchestrator::IntentDedupGate::new(
                intent_goal_id,
                factory_contracts::apply_intent_dedup_default(None),
            ));
        let pre_step_gate: Option<Arc<dyn orchestrator::PreStepGate>> =
            Some(match governance.as_ref() {
                Some(gov) => {
                    let ctx_bs = ctx_for_spawn.clone();
                    let grant: Arc<dyn orchestrator::PreStepGate> =
                        Arc::new(super::run_governance::GrantRenewalGate::new(
                            gov.clone(),
                            Box::new(move || {
                                ctx_bs
                                    .pipeline_state
                                    .lock()
                                    .ok()
                                    .and_then(|ps| ps.build_spec_hash.clone())
                            }),
                            stage_agents.clone(),
                        ));
                    Arc::new(orchestrator::ChainedPreStepGate::new(vec![
                        grant,
                        budget_gate,
                        oscillation_gate,
                        intent_dedup_gate,
                    ])) as Arc<dyn orchestrator::PreStepGate>
                }
                None => Arc::new(orchestrator::ChainedPreStepGate::new(vec![
                    budget_gate,
                    oscillation_gate,
                    intent_dedup_gate,
                ])) as Arc<dyn orchestrator::PreStepGate>,
            });

        // Build executor with agent prompt lookup.
        // Spec 112 §6.4.5 — thread the project's clone token (if any) as
        // GITHUB_TOKEN into every spawned `claude` subprocess so axiomregent
        // authenticates against GitHub on the project's behalf without OPC's
        // own env being mutated.
        let lookup = Arc::new(BridgeLookup(bridge.clone()));
        let extra_env = clone_token_env_for_project(project_id_for_spawn.as_deref());
        let step_event_handler: Arc<dyn StepEventHandler> = Arc::new(TauriStepEventHandler::new(
            app_handle.clone(),
            run_id.to_string(),
            Some(emitter_for_spawn.clone()),
            stage_agents.clone(),
        ));
        let executor = Arc::new(
            ClaudeCodeExecutor::new(project_path.clone())
                .with_prompt_lookup(lookup)
                .with_max_turns(25)
                .with_extra_env(extra_env)
                .with_step_event_handler(step_event_handler)
                // Default base is 300s, which scales to Quick=75s — empirically
                // too tight for s0-preflight (reads 30 docx + verification +
                // report write). 900s gives Deep=15m, Investigate=7.5m,
                // Quick=3.75m, which fits the observed Phase 1 stages.
                .with_step_timeout(900),
        );

        let options = DispatchOptions {
            gate_handler: Some(gate_handler.clone() as Arc<dyn GateHandler>),
            project_root: Some(project_path.clone()),
            skip_completed_steps: HashSet::new(),
            cas: None,
            artifact_metadata: None,
            governance_mode: Some(governance_mode_str.clone()),
            sync_tracker: Some(sync_tracker.clone()),
            on_gate_checkpoint: None,
            // Factory-engine origin per spec 173 FR-001: project_path and
            // originating_session are NULL — the run is not session-initiated.
            project_path: None,
            originating_session: None,
            // Spec 198 FR-005 — grant renewal at every stage boundary.
            pre_step: pre_step_gate.clone(),
        };

        // Dispatch Phase 1 (s0–s5).
        let summary1 = match dispatch_manifest(
            &am,
            run_id,
            &manifest,
            bridge.clone(),
            executor.clone(),
            &options,
        )
        .await
        {
            Ok(s) => s,
            Err(e) => {
                log::error!("factory phase 1 dispatch failed for run {run_id}: {e}");
                ctx_for_spawn.pipeline_state.lock().unwrap().mark_failed();
                emit_terminal_failed(&ctx_for_spawn, &e.to_string()).await;
                if let Some((sc, pid, plid)) = resolve_sc_context(&ctx_for_spawn, &sc_client) {
                    sc_update_status(
                        &sc,
                        &pid,
                        &plid,
                        "failed",
                        None,
                        Some(&e.to_string()),
                        Some("process"),
                    );
                }
                app_handle
                    .emit(
                        "factory:workflow_failed",
                        &serde_json::json!({
                            "runId": run_id.to_string(),
                            "error": e.to_string(),
                            "phase": "process",
                        }),
                    )
                    .ok();
                return;
            }
        };

        // Update stage tracking from summary.
        {
            let mut stages = ctx_for_spawn.stage_status.lock().unwrap();
            for step in &summary1.steps {
                if let Some(tracker) = stages.get_mut(&step.step_id) {
                    tracker.status = match step.status {
                        orchestrator::StepStatus::Success => "completed",
                        orchestrator::StepStatus::Failure => "failed",
                        orchestrator::StepStatus::Skipped => "skipped",
                        orchestrator::StepStatus::Cancelled => "cancelled",
                        _ => "completed",
                    }
                    .into();
                    tracker.token_spend = step.tokens_used.unwrap_or(0);
                    tracker.completed_at = Some(now_iso());
                }
            }
            let mut ps = ctx_for_spawn.pipeline_state.lock().unwrap();
            let phase1_tokens: u64 = summary1.steps.iter().filter_map(|s| s.tokens_used).sum();
            ps.add_tokens(phase1_tokens);
        }

        app_handle
            .emit(
                "factory:phase1_completed",
                &serde_json::json!({
                    "runId": run_id.to_string(),
                    "steps": summary1.steps.len(),
                }),
            )
            .ok();

        // Dual-write: report Phase 1 token spend per stage to Statecraft.
        if let Some((sc, pid, plid)) = resolve_sc_context(&ctx_for_spawn, &sc_client) {
            let rid = run_id.to_string();
            for step in &summary1.steps {
                let tokens = step.tokens_used.unwrap_or(0);
                if tokens > 0 {
                    // Split evenly between prompt/completion as a rough estimate;
                    // the orchestrator doesn't track prompt vs completion separately.
                    let half = tokens / 2;
                    if let Err(e) = sc
                        .report_token_spend(
                            &pid,
                            &rid,
                            &step.step_id,
                            half,
                            tokens - half,
                            "claude-sonnet-4-20250514",
                        )
                        .await
                    {
                        log::warn!(
                            "Statecraft token-spend report failed for {}: {e}",
                            step.step_id
                        );
                    }
                }
            }
            // Ingest step-level events for audit trail.
            sc_ingest_step_events(&sc, &pid, &plid, &summary1, "process", Some(&sync_tracker));
            sc_record_artifacts(&sc, &pid, &plid, &summary1, "process", Some(&sync_tracker));
        }

        // Phase transition: read frozen Build Spec, generate Phase 2 manifest.
        let build_spec_path =
            am.output_artifact_path(run_id, "s5-ui-specification", "build-spec.yaml");
        if !build_spec_path.exists() {
            ctx_for_spawn.pipeline_state.lock().unwrap().mark_failed();
            let err_msg = format!("Build Spec not found at {}", build_spec_path.display());
            log::error!("factory transition failed for run {run_id}: {err_msg}");
            emit_terminal_failed(&ctx_for_spawn, &err_msg).await;
            if let Some((sc, pid, plid)) = resolve_sc_context(&ctx_for_spawn, &sc_client) {
                sc_update_status(
                    &sc,
                    &pid,
                    &plid,
                    "failed",
                    None,
                    Some(&err_msg),
                    Some("transition"),
                );
            }
            app_handle
                .emit(
                    "factory:workflow_failed",
                    &serde_json::json!({
                        "runId": run_id.to_string(),
                        "error": err_msg,
                        "phase": "transition",
                    }),
                )
                .ok();
            return;
        }

        let transition_result = {
            let mut ps = ctx_for_spawn.pipeline_state.lock().unwrap();
            engine.transition_to_scaffolding(
                &adapter_for_spawn,
                &build_spec_path,
                &mut ps,
                None, // org_override
                org_id.clone(),
            )
        };
        let transition = match transition_result {
            Ok(t) => t,
            Err(e) => {
                log::error!("factory transition_to_scaffolding failed for run {run_id}: {e}");
                ctx_for_spawn.pipeline_state.lock().unwrap().mark_failed();
                emit_terminal_failed(&ctx_for_spawn, &e.to_string()).await;
                if let Some((sc, pid, plid)) = resolve_sc_context(&ctx_for_spawn, &sc_client) {
                    sc_update_status(
                        &sc,
                        &pid,
                        &plid,
                        "failed",
                        None,
                        Some(&e.to_string()),
                        Some("transition"),
                    );
                }
                app_handle
                    .emit(
                        "factory:workflow_failed",
                        &serde_json::json!({
                            "runId": run_id.to_string(),
                            "error": e.to_string(),
                            "phase": "transition",
                        }),
                    )
                    .ok();
                return;
            }
        };

        app_handle
            .emit(
                "factory:phase_transition",
                &serde_json::json!({
                    "runId": run_id.to_string(),
                    "phase": "scaffolding",
                    "totalScaffoldSteps": transition.manifest.steps.len(),
                }),
            )
            .ok();

        // Dual-write: transition to scaffolding phase in Statecraft.
        if let Some((sc, pid, plid)) = resolve_sc_context(&ctx_for_spawn, &sc_client) {
            sc_update_status(
                &sc,
                &pid,
                &plid,
                "running",
                Some("s6-scaffolding"),
                None,
                Some("scaffold"),
            );
        }

        // Materialize Phase 2 run directory.
        if let Err(e) = materialize_run_directory(&am, run_id, &transition.manifest) {
            ctx_for_spawn.pipeline_state.lock().unwrap().mark_failed();
            let err_msg = format!("materialize phase 2 failed: {e}");
            log::error!("factory phase 2 materialize failed for run {run_id}: {err_msg}");
            emit_terminal_failed(&ctx_for_spawn, &err_msg).await;
            if let Some((sc, pid, plid)) = resolve_sc_context(&ctx_for_spawn, &sc_client) {
                sc_update_status(
                    &sc,
                    &pid,
                    &plid,
                    "failed",
                    None,
                    Some(&err_msg),
                    Some("scaffolding"),
                );
            }
            app_handle
                .emit(
                    "factory:workflow_failed",
                    &serde_json::json!({
                        "runId": run_id.to_string(),
                        "error": err_msg,
                        "phase": "scaffolding",
                    }),
                )
                .ok();
            return;
        }

        // Dispatch Phase 2 (s6a–s6g).
        let phase2_options = DispatchOptions {
            gate_handler: Some(gate_handler as Arc<dyn GateHandler>),
            project_root: Some(project_path.clone()),
            skip_completed_steps: HashSet::new(),
            cas: None,
            artifact_metadata: None,
            governance_mode: Some(governance_mode_str),
            sync_tracker: Some(sync_tracker.clone()),
            on_gate_checkpoint: None,
            // Factory-engine origin per spec 173 FR-001.
            project_path: None,
            originating_session: None,
            // Spec 198 FR-005 — the same renewal gate spans both phases
            // (one capsule, one monotonic grant chain).
            pre_step: pre_step_gate.clone(),
        };

        let summary2 = match dispatch_manifest(
            &am,
            run_id,
            &transition.manifest,
            bridge,
            executor,
            &phase2_options,
        )
        .await
        {
            Ok(s) => s,
            Err(e) => {
                log::error!("factory phase 2 dispatch failed for run {run_id}: {e}");
                ctx_for_spawn.pipeline_state.lock().unwrap().mark_failed();
                emit_terminal_failed(&ctx_for_spawn, &e.to_string()).await;
                if let Some((sc, pid, plid)) = resolve_sc_context(&ctx_for_spawn, &sc_client) {
                    sc_update_status(
                        &sc,
                        &pid,
                        &plid,
                        "failed",
                        None,
                        Some(&e.to_string()),
                        Some("scaffolding"),
                    );
                }
                app_handle
                    .emit(
                        "factory:workflow_failed",
                        &serde_json::json!({
                            "runId": run_id.to_string(),
                            "error": e.to_string(),
                            "phase": "scaffolding",
                        }),
                    )
                    .ok();
                return;
            }
        };

        // Update pipeline state from Phase 2 results.
        {
            let mut ps = ctx_for_spawn.pipeline_state.lock().unwrap();
            for step in &summary2.steps {
                let tokens = step.tokens_used.unwrap_or(0);
                match step.status {
                    orchestrator::StepStatus::Success => {
                        record_scaffold_completion(&mut ps, &step.step_id, tokens);
                    }
                    orchestrator::StepStatus::Failure => {
                        record_scaffold_failure(
                            &mut ps,
                            &step.step_id,
                            3, // max retries
                            "step failed after retries",
                        );
                    }
                    _ => {}
                }
            }
            ps.mark_complete();
        }

        // Persist final pipeline state to per-run scratch dir for resume
        // detection. The cache root (T043) is content-addressed and lives
        // elsewhere; this file is only consulted by `detect_resume_plan_for_run`.
        let state_path = project_path
            .join(".factory")
            .join("runs")
            .join(run_id.to_string())
            .join("pipeline-state.json");
        if let Ok(ps) = ctx_for_spawn.pipeline_state.lock() {
            let _ = ps.save_to_file(&state_path);
        }

        // Spec 124 §6 — terminal `factory.run.completed`, now carrying the
        // spec 198 certificate hash + final grant seq; the platform
        // handler stamps `status='ok'` and countersigns the certificate.
        let total_tokens = ctx_for_spawn
            .pipeline_state
            .lock()
            .map(|ps| ps.total_tokens)
            .unwrap_or(0);
        // Spec 202 FR-005: snapshot the run's budget meter into cert records.
        // Recover a poisoned lock (into_inner) so a panic never silently
        // downgrades the cert to the "unmetered" state.
        let budget_consumption: Vec<factory_engine::governance_certificate::BudgetAxisRecord> = {
            let snapshot = budget_meter
                .lock()
                .map(|m| m.consumption())
                .unwrap_or_else(|poisoned| poisoned.into_inner().consumption());
            snapshot
                .into_iter()
                .map(factory_engine::governance_certificate::BudgetAxisRecord::from)
                .collect()
        };
        emit_terminal_completed(
            &ctx_for_spawn,
            total_tokens,
            governance.as_ref(),
            &requirements_hash,
            budget_consumption,
        )
        .await;

        // Dual-write: report Phase 2 (scaffolding) token spend and scaffold progress to Statecraft.
        if let Some((sc, pid, plid)) = resolve_sc_context(&ctx_for_spawn, &sc_client) {
            let rid = run_id.to_string();
            let mut scaffold_total: u64 = 0;
            for step in &summary2.steps {
                let tokens = step.tokens_used.unwrap_or(0);
                scaffold_total += tokens;
            }
            if scaffold_total > 0 {
                let half = scaffold_total / 2;
                if let Err(e) = sc
                    .report_token_spend(
                        &pid,
                        &rid,
                        "s6-scaffolding",
                        half,
                        scaffold_total - half,
                        "claude-sonnet-4-20250514",
                    )
                    .await
                {
                    log::warn!("Statecraft token-spend report failed for s6-scaffolding: {e}");
                }
            }

            // Report scaffold feature progress.
            let features: Vec<super::statecraft_client::ScaffoldFeatureReport> = summary2
                .steps
                .iter()
                .map(|step| {
                    let tokens = step.tokens_used.unwrap_or(0);
                    let half = tokens / 2;
                    super::statecraft_client::ScaffoldFeatureReport {
                        feature_id: step.step_id.clone(),
                        category: infer_scaffold_category(&step.step_id),
                        status: match step.status {
                            orchestrator::StepStatus::Success => "completed".into(),
                            orchestrator::StepStatus::Failure => "failed".into(),
                            _ => "completed".into(),
                        },
                        retry_count: None,
                        last_error: None,
                        files_created: None,
                        prompt_tokens: Some(half),
                        completion_tokens: Some(tokens - half),
                    }
                })
                .collect();
            if !features.is_empty()
                && let Err(e) = sc.report_scaffold_progress(&pid, &plid, &features).await
            {
                log::warn!("Statecraft scaffold-progress report failed: {e}");
            }

            // Ingest step-level events for audit trail.
            sc_ingest_step_events(&sc, &pid, &plid, &summary2, "scaffold", Some(&sync_tracker));
            sc_record_artifacts(&sc, &pid, &plid, &summary2, "scaffold", Some(&sync_tracker));

            // Mark pipeline as completed in Statecraft.
            sc_update_status(&sc, &pid, &plid, "completed", None, None, None);
        }

        app_handle
            .emit(
                "factory:workflow_completed",
                &serde_json::json!({
                    "runId": run_id.to_string(),
                    "totalSteps": summary1.steps.len() + summary2.steps.len(),
                    "totalTokens": ctx_for_spawn.pipeline_state.lock().map(|ps| ps.total_tokens).unwrap_or(0),
                }),
            )
            .ok();
    });

    Ok(StartPipelineResponse { run_id: run_id_str })
}

/// Return the current status of a pipeline run.
///
/// Resolution order:
/// 1. In-memory `FACTORY_RUNS` (live or just-completed run).
/// 2. Platform fallback — `GET /api/factory/runs/:id` (spec 124 §4) when
///    the run isn't loaded in memory (after an OPC restart, runs
///    authored by another desktop, etc.). The legacy disk hydration path
///    (`state.json` walking) is gone: spec 108 §8 retired the in-tree
///    factory directory and spec 124 §6 makes the platform row the
///    source of truth for run history.
#[tauri::command]
pub async fn get_factory_pipeline_status(
    app: AppHandle,
    run_id: String,
    project_path: Option<String>,
) -> Result<PipelineStatusResponse, String> {
    let _ = project_path; // Tauri keeps the parameter for backwards compat;
    // the platform row is now the canonical source.
    {
        let runs = FACTORY_RUNS.lock().map_err(|e| e.to_string())?;
        if let Some(ctx) = runs.get(&run_id) {
            return Ok(build_status_response(ctx));
        }
    }

    match build_status_response_from_platform(&app, &run_id).await {
        Ok(Some(resp)) => Ok(resp),
        Ok(None) => Err(format!("run not found: {run_id}")),
        Err(e) => Err(e.into_user_message()),
    }
}

/// Spec 124 §4 — fetch a single run from the platform and project it
/// into the React-facing [`PipelineStatusResponse`]. Returns `Ok(None)`
/// when the platform reports the row does not exist for this org.
async fn build_status_response_from_platform(
    app: &AppHandle,
    run_id: &str,
) -> Result<Option<PipelineStatusResponse>, FactoryError> {
    let ctx = platform_context(app)?;
    let row = match ctx.client.get_run(run_id).await {
        Ok(r) => r,
        Err(factory_platform_client::FactoryClientError::NotFound(_)) => return Ok(None),
        Err(e) => return Err(e.into()),
    };

    // Project per-stage progress into the React StageInfo shape. Fill in
    // the canonical six-stage skeleton so the table renders consistently
    // even for runs that have only emitted a subset of stages so far.
    let mut stage_lookup: HashMap<String, &factory_platform_client::wire::RunStageProgressEntry> =
        HashMap::new();
    for entry in &row.stage_progress {
        stage_lookup.insert(entry.stage_id.clone(), entry);
    }

    let stages: Vec<StageInfo> = PROCESS_STAGES
        .iter()
        .map(|(id, name)| {
            let entry = stage_lookup.get(*id);
            StageInfo {
                id: id.to_string(),
                name: name.to_string(),
                status: entry
                    .map(|e| match e.status.as_str() {
                        "ok" => "completed".to_string(),
                        s => s.to_string(),
                    })
                    .unwrap_or_else(|| "pending".to_string()),
                token_spend: 0,
                artifacts: vec![],
                started_at: entry.map(|e| e.started_at.clone()),
                completed_at: entry.and_then(|e| e.completed_at.clone()),
            }
        })
        .collect();

    let phase = match row.status.as_str() {
        "queued" => "process",
        "running" => "process",
        "ok" => "complete",
        "failed" => "failed",
        "cancelled" => "failed",
        _ => "paused",
    }
    .to_string();

    let total_tokens = row
        .token_spend
        .as_ref()
        .map(|t| t.total.max(0) as u64)
        .unwrap_or(0);

    Ok(Some(PipelineStatusResponse {
        run_id: row.id.clone(),
        phase,
        stages,
        scaffolding: None,
        total_tokens,
        audit_trail: vec![],
        adapter: None,
    }))
}

/// Confirm a gate stage. Resolves the pending oneshot in TauriGateHandler.
#[tauri::command]
pub async fn confirm_factory_stage(
    app: AppHandle,
    run_id: String,
    stage_id: String,
) -> Result<(), String> {
    let sc_project_id;
    {
        let runs = FACTORY_RUNS.lock().map_err(|e| e.to_string())?;
        let ctx = runs
            .get(&run_id)
            .ok_or_else(|| format!("run not found: {run_id}"))?;

        ctx.gate_handler.approve(&stage_id)?;

        // Record in audit trail.
        ctx.audit_trail.lock().unwrap().push(AuditEntry {
            timestamp: now_iso(),
            action: "gate_confirmed".into(),
            stage_id: Some(stage_id.clone()),
            details: None,
            feedback: None,
        });

        sc_project_id = ctx.statecraft_project_id.clone();
    }

    // Dual-write: confirm stage in Statecraft (fire-and-forget).
    if let Some(pid) = sc_project_id {
        let sc_opt: Option<Arc<StatecraftClient>> =
            app.try_state::<StatecraftState>().and_then(|s| s.current());
        if let Some(sc) = sc_opt {
            let sid = stage_id;
            tokio::spawn(async move {
                if let Err(e) = sc.confirm_stage(&pid, &sid, None).await {
                    log::warn!("Statecraft confirm_stage failed for {sid}: {e}");
                }
            });
        }
    }

    Ok(())
}

/// Reject a gate stage. Resolves the pending oneshot with an error.
#[tauri::command]
pub async fn reject_factory_stage(
    app: AppHandle,
    run_id: String,
    stage_id: String,
    feedback: String,
) -> Result<(), String> {
    let sc_project_id;
    {
        let runs = FACTORY_RUNS.lock().map_err(|e| e.to_string())?;
        let ctx = runs
            .get(&run_id)
            .ok_or_else(|| format!("run not found: {run_id}"))?;

        ctx.gate_handler.reject(&stage_id, &feedback)?;

        ctx.audit_trail.lock().unwrap().push(AuditEntry {
            timestamp: now_iso(),
            action: "stage_rejected".into(),
            stage_id: Some(stage_id.clone()),
            details: None,
            feedback: Some(feedback.clone()),
        });

        sc_project_id = ctx.statecraft_project_id.clone();
    }

    app.emit(
        "factory:stage_rejected",
        &serde_json::json!({
            "runId": run_id,
            "stageId": stage_id,
            "feedback": feedback,
        }),
    )
    .map_err(|e| format!("emit factory:stage_rejected failed: {e}"))?;

    // Dual-write: reject stage in Statecraft (fire-and-forget).
    if let Some(pid) = sc_project_id {
        let sc_opt: Option<Arc<StatecraftClient>> =
            app.try_state::<StatecraftState>().and_then(|s| s.current());
        if let Some(sc) = sc_opt {
            let sid = stage_id;
            let fb = feedback;
            tokio::spawn(async move {
                if let Err(e) = sc.reject_stage(&pid, &sid, &fb).await {
                    log::warn!("Statecraft reject_stage failed for {sid}: {e}");
                }
            });
        }
    }

    Ok(())
}

/// Cancel a running Factory pipeline.
#[tauri::command]
pub async fn cancel_factory_pipeline(
    app: AppHandle,
    run_id: String,
    reason: String,
) -> Result<(), String> {
    let (sc_project_id, ctx_for_emit) = {
        let runs = FACTORY_RUNS.lock().map_err(|e| e.to_string())?;
        let ctx = runs
            .get(&run_id)
            .ok_or_else(|| format!("run not found: {run_id}"))?
            .clone();

        // Mark local pipeline as failed/cancelled
        ctx.pipeline_state.lock().unwrap().mark_failed();

        ctx.audit_trail.lock().unwrap().push(AuditEntry {
            timestamp: now_iso(),
            action: "pipeline_cancelled".into(),
            stage_id: None,
            details: Some(reason.clone()),
            feedback: None,
        });

        (ctx.statecraft_project_id.clone(), ctx)
    };

    // Spec 124 §6 — terminal `factory.run.cancelled`.
    emit_terminal_cancelled(&ctx_for_emit, Some(reason.clone())).await;

    app.emit(
        "factory:workflow_cancelled",
        &serde_json::json!({
            "runId": run_id,
            "reason": reason,
        }),
    )
    .map_err(|e| format!("emit factory:workflow_cancelled failed: {e}"))?;

    // Dual-write: cancel in Statecraft
    if let Some(pid) = sc_project_id {
        let sc_opt: Option<Arc<StatecraftClient>> =
            app.try_state::<StatecraftState>().and_then(|s| s.current());
        if let Some(sc) = sc_opt {
            tokio::spawn(async move {
                if let Err(e) = sc.cancel_pipeline(&pid, &reason).await {
                    log::warn!("Statecraft cancel_pipeline failed: {e}");
                }
            });
        }
    }

    Ok(())
}

/// Extract the adapter name from a run's `manifest.yaml`. Used for legacy
/// runs that pre-date `state.json` persistence — the manifest is the only
/// on-disk record of which adapter generated the workflow.
///
/// `manifest_gen.rs` embeds the adapter name into every step instruction as
/// a literal `Adapter: <name>` line (see e.g. `manifest_gen.rs:159`). This
/// function scans each step's instruction for that token, so it works for
/// both process and scaffold manifests without coupling to a top-level
/// metadata field that legacy manifests do not have.
fn adapter_from_manifest(manifest_path: &std::path::Path) -> Option<String> {
    let text = std::fs::read_to_string(manifest_path).ok()?;
    let value: serde_yaml::Value = serde_yaml::from_str(&text).ok()?;
    let steps = value.get("steps")?.as_sequence()?;
    for step in steps {
        let Some(instruction) = step.get("instruction").and_then(|v| v.as_str()) else {
            continue;
        };
        for line in instruction.lines() {
            let trimmed = line.trim();
            if let Some(rest) = trimmed.strip_prefix("Adapter:") {
                let name = rest.trim();
                if !name.is_empty() {
                    return Some(name.to_string());
                }
            }
        }
    }
    None
}

/// Spec 124 §4 / T054 — list Factory runs from the platform.
///
/// `project_path` is retained on the Tauri signature for backwards
/// compatibility with React callers, but the local on-disk run cache is
/// no longer the source of truth for run history (spec 108 §8 retired
/// the in-tree factory directory; spec 124 §6 made `factory_runs` rows
/// the canonical record). The platform endpoint scopes results to the
/// caller's organization automatically.
#[tauri::command]
pub async fn list_factory_runs(
    app: AppHandle,
    project_path: String,
) -> Result<Vec<PipelineRunSummary>, String> {
    let _ = project_path;

    let ctx = platform_context(&app).map_err(FactoryError::into_user_message)?;
    let rows = ctx
        .client
        .list_runs()
        .await
        .map_err(|e| FactoryError::from(e).into_user_message())?;

    let stages_total = PROCESS_STAGES.len() as u32;
    // The list endpoint returns a summary shape without per-stage
    // progress; the Runs tab table only needs status + timestamps + the
    // status pill at this granularity. Per-stage progress hydrates when
    // the user opens the detail drawer (which calls
    // `get_factory_pipeline_status`).
    let mut summaries: Vec<PipelineRunSummary> = rows
        .into_iter()
        .map(|row| {
            let phase = match row.status.as_str() {
                // Emit "process", not "running": the desktop's FactoryPhase
                // union has no "running" member, so it fell back to the
                // "Idle" badge for every queued/running platform run. This
                // matches the sibling mapping in
                // build_status_response_from_platform.
                "queued" | "running" => "process",
                "ok" => "complete",
                "failed" => "failed",
                "cancelled" => "failed",
                _ => "paused",
            }
            .to_string();
            let stages_completed = if row.status == "ok" { stages_total } else { 0 };
            PipelineRunSummary {
                run_id: row.id,
                adapter: String::new(),
                // The platform run list has no local filesystem path; it only
                // knows the statecraft project UUID. Emitting that UUID here
                // made Resume run `PathBuf::from(uuid).canonicalize()` -> ENOENT
                // ("resolve project path failed"). Leave it empty so the
                // frontend falls back to the open project's real clone path, or
                // disables Resume with a "clone locally" hint when there is none.
                project_path: String::new(),
                started_at: row.started_at,
                completed_at: row.completed_at,
                phase,
                total_tokens: 0,
                stages_completed,
                stages_total,
                last_completed_stage: None,
            }
        })
        .collect();

    summaries.sort_by(|a, b| b.started_at.cmp(&a.started_at));
    Ok(summaries)
}

/// List artifact files for a given run/step combination.
///
/// Resolution order for the artifact directory:
/// 1. Live `FACTORY_RUNS` entry's project path.
/// 2. Caller-supplied `project_path` (used by Pipeline History when the run
///    is hydrated from disk and isn't in `FACTORY_RUNS`).
/// 3. Legacy `~/.oap/artifacts/<run_id>/<step_id>` cache.
#[tauri::command]
pub async fn get_factory_artifacts(
    run_id: String,
    step_id: String,
    project_path: Option<String>,
) -> Result<Vec<ArtifactInfo>, String> {
    // Resolve project path from live context if available.
    let live_path = FACTORY_RUNS
        .lock()
        .map_err(|e| e.to_string())?
        .get(&run_id)
        .map(|ctx| ctx.project_path.clone());

    let base = if let Some(p) = live_path {
        p.join(".factory").join("runs").join(&run_id).join(&step_id)
    } else if let Some(p) = project_path.as_ref().filter(|s| !s.is_empty()) {
        PathBuf::from(p)
            .join(".factory")
            .join("runs")
            .join(&run_id)
            .join(&step_id)
    } else {
        let home = std::env::var("HOME").unwrap_or_else(|_| "/tmp".into());
        PathBuf::from(home)
            .join(".oap")
            .join("artifacts")
            .join(&run_id)
            .join(&step_id)
    };

    if !base.exists() {
        return Ok(vec![]);
    }

    let entries = std::fs::read_dir(&base).map_err(|e| format!("read artifact dir failed: {e}"))?;

    let mut artifacts = Vec::new();
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let name = path
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("")
            .to_string();
        let size = path.metadata().map(|m| m.len()).unwrap_or(0);
        let mime_type = mime_from_ext(&name).to_string();
        artifacts.push(ArtifactInfo {
            name,
            path: path.to_string_lossy().to_string(),
            size,
            mime_type,
        });
    }

    artifacts.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(artifacts)
}

/// Mark a failed scaffold step as skipped.
#[tauri::command]
pub async fn skip_factory_step(
    app: AppHandle,
    run_id: String,
    step_id: String,
) -> Result<(), String> {
    let runs = FACTORY_RUNS.lock().map_err(|e| e.to_string())?;
    let ctx = runs
        .get(&run_id)
        .ok_or_else(|| format!("run not found: {run_id}"))?;

    ctx.audit_trail.lock().unwrap().push(AuditEntry {
        timestamp: now_iso(),
        action: "step_skipped".into(),
        stage_id: Some(step_id.clone()),
        details: None,
        feedback: None,
    });

    app.emit(
        "factory:step_skipped",
        &serde_json::json!({
            "runId": run_id,
            "stepId": step_id,
        }),
    )
    .map_err(|e| format!("emit factory:step_skipped failed: {e}"))?;

    Ok(())
}

/// Resume a previously failed pipeline run. Spec 124 §8 declares
/// re-runs as immutable new rows, so this path reserves a fresh
/// `factory_runs.id` and emits envelopes against it; the old run's
/// platform row stays at its terminal status.
#[tauri::command]
pub async fn resume_factory_pipeline(
    app: AppHandle,
    run_id: String,
    project_path: String,
    adapter_name: String,
    process_name: Option<String>,
    statecraft_project_id: Option<String>,
) -> Result<(), String> {
    let process_name = process_name
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(|| DEFAULT_PROCESS_NAME.to_string());
    // Resolve the local project directory (see `resolve_resume_project_path`).
    // A run surfaced from the platform run list carries no local path, and the
    // old code canonicalised that empty/UUID string straight into the raw
    // "resolve project path failed: No such file or directory" error the user
    // saw when clicking Resume on a project that has no local copy here.
    let project_path = resolve_resume_project_path(&project_path)?;
    let run_uuid = Uuid::parse_str(&run_id).map_err(|e| format!("invalid run_id: {e}"))?;

    // Defence in depth: if the caller didn't resolve an adapter (legacy
    // history rows from before the frontend fix, or unusual deep-link state),
    // try to recover it from the run's `manifest.yaml`. `start_pipeline("",
    // ...)` would otherwise fail with `AdapterNotFound { name: "" }`.
    let adapter_name = if adapter_name.trim().is_empty() {
        let manifest_path = project_path
            .join(".factory")
            .join("runs")
            .join(&run_id)
            .join("manifest.yaml");
        adapter_from_manifest(&manifest_path).ok_or_else(|| {
            format!(
                "resume failed: adapter name is empty and could not be recovered from {}",
                manifest_path.display()
            )
        })?
    } else {
        adapter_name
    };

    // Spec 124 §5/§6 — authenticate against statecraft, reserve a new
    // platform row for the resumed attempt, and materialise the cache
    // root from the platform-fed adapter/process bodies.
    let ctx_pf = platform_context(&app).map_err(FactoryError::into_user_message)?;
    let prepared = prepare_run_root(
        &ctx_pf,
        &adapter_name,
        &process_name,
        statecraft_project_id.as_deref(),
    )
    .await
    .map_err(FactoryError::into_user_message)?;
    let factory_root = prepared.engine_factory_root.clone();
    let platform_run_id = prepared.run_id.clone();

    // Spec 139 Phase 3 (T072) — wrap the materialised path in the
    // `FactoryRoot::Filesystem` variant; resume mirrors the start-pipeline
    // construction.
    let config = FactoryEngineConfig {
        factory_root: factory_engine::FactoryRoot::Filesystem(factory_root.clone()),
        project_path: project_path.clone(),
        concurrency_limit: 4,
    };
    let engine = FactoryEngine::new(config).map_err(|e| e.to_string())?;

    let org_id: Option<String> = Some(ctx_pf.org_id.clone());

    let start = engine
        .start_pipeline(&adapter_name, &[], org_id)
        .map_err(|e| e.to_string())?;

    let artifact_dir = project_path.join(".factory").join("runs");
    let am = ArtifactManager::new(&artifact_dir);

    // Detect which steps are already completed.
    let skip_steps: HashSet<String> =
        match detect_resume_plan_for_run(&am, run_uuid, &start.manifest) {
            Ok(Some(plan)) => plan.completed_step_ids.into_iter().collect(),
            _ => HashSet::new(),
        };

    let gate_handler = Arc::new(TauriGateHandler::new(app.clone()));
    let bridge = Arc::new(start.agent_bridge);
    let lookup = Arc::new(BridgeLookup(bridge.clone()));
    // Spec 112 §6.4.5 — thread the project's clone token through resumed runs
    // too, so re-entry after a pause does not silently downgrade to anon.
    let extra_env = clone_token_env_for_project(statecraft_project_id.as_deref());
    let resume_emitter = RunEmitter::new(&app, platform_run_id.clone())
        .map_err(FactoryError::into_user_message)?;
    let stage_agents: Arc<HashMap<String, FactoryAgentRef>> = Arc::new(
        prepared
            .stage_agents
            .iter()
            .cloned()
            .collect::<HashMap<_, _>>(),
    );
    let step_event_handler: Arc<dyn StepEventHandler> = Arc::new(TauriStepEventHandler::new(
        app.clone(),
        run_uuid.to_string(),
        Some(resume_emitter.clone()),
        stage_agents.clone(),
    ));
    let executor = Arc::new(
        ClaudeCodeExecutor::new(project_path.clone())
            .with_prompt_lookup(lookup)
            .with_max_turns(25)
            .with_extra_env(extra_env)
            .with_step_event_handler(step_event_handler)
            // Match start_factory_pipeline's bumped budget (default 300 → 900).
            .with_step_timeout(900),
    );

    // Derive governance mode for resumed pipeline (098 Slice 2).
    let grants_json = crate::governed_claude::grants_json_claude_default();
    let (gov_plan, bypass_reason) = crate::governed_claude::plan_governed_from_binary(&grants_json)
        .map_err(|e| format!("factory resume: {e}"))?;
    if let Some(reason) = &bypass_reason {
        eprintln!(
            "[governance] factory resume falling back to bypass: {}",
            reason
        );
    }
    let governance_mode_str = match &gov_plan {
        crate::governed_claude::GovernedPlan::Governed { .. } => "governed".to_string(),
        crate::governed_claude::GovernedPlan::Bypass => "bypass".to_string(),
    };
    // Fresh SyncTracker for the resumed run (099 Slice 2).
    let sync_tracker = SyncTracker::new();

    let mut options = DispatchOptions {
        gate_handler: Some(gate_handler as Arc<dyn GateHandler>),
        project_root: Some(project_path.clone()),
        skip_completed_steps: skip_steps,
        cas: None,
        artifact_metadata: None,
        governance_mode: Some(governance_mode_str),
        sync_tracker: Some(sync_tracker),
        on_gate_checkpoint: None,
        // Factory-engine resume origin per spec 173 FR-001.
        project_path: None,
        originating_session: None,
        // Spec 198 FR-005 — set inside the spawn once governance is
        // established (the grant request is async).
        pre_step: None,
    };

    let app_handle = app.clone();
    let resume_emitter_for_spawn = resume_emitter.clone();
    // Spec 198 — resumed runs are governed like fresh ones. The grant
    // handler treats a re-request after restart as chain extension; the
    // capsule is deterministic (same goal text → same goal id), so a
    // resume that quietly changed objective would refuse as goal-shift.
    let sc_for_resume: Option<Arc<StatecraftClient>> = app
        .try_state::<StatecraftState>()
        .and_then(|s| s.current());
    let resume_project_id = statecraft_project_id.clone();
    let adapter_for_resume = adapter_name.clone();
    let project_path_for_resume = project_path.clone();
    let platform_run_id_for_resume = platform_run_id.clone();
    let manifest = start.manifest;
    let resume_pipeline_state = start.pipeline_state;
    tokio::spawn(async move {
        let run_dir = super::run_governance::run_dir_for(
            &project_path_for_resume,
            &run_uuid.to_string(),
        );
        let governance = match (&sc_for_resume, resume_project_id.as_deref()) {
            (Some(sc), Some(project_id)) => {
                let goal = format!(
                    "factory run: adapter {adapter_for_resume} for project {project_id}"
                );
                match super::run_governance::establish(
                    sc,
                    resume_emitter_for_spawn.clone(),
                    project_id,
                    &platform_run_id_for_resume,
                    &goal,
                    &run_dir,
                )
                .await
                {
                    Ok(g) => Some(g),
                    Err(e) => {
                        log::error!("run governance refused for resumed run {run_id}: {e}");
                        if let Err(emit_err) = resume_emitter_for_spawn.failed(e.clone()).await {
                            log::warn!(
                                "factory.run.failed (resume) emit/spool failed for run {run_id}: {emit_err}"
                            );
                        }
                        app_handle
                            .emit(
                                "factory:workflow_failed",
                                &serde_json::json!({ "runId": run_id, "error": e }),
                            )
                            .ok();
                        return;
                    }
                }
            }
            _ => {
                log::warn!(
                    "resumed run {run_id} starts UNGOVERNED (no project binding / platform \
                     client) — certificate stays unsealed (spec 198 FR-005)"
                );
                None
            }
        };
        // Spec 202 FR-002/AC-3: the resume path also meters run blast-radius
        // under platform defaults, on EVERY run including the ungoverned arm.
        // The meter is in-memory, so a resume re-admits at platform-default
        // ceilings and starts fresh run-level accumulation. For the governed
        // path this is the AC-5-sanctioned "new admission => new meter" (resume
        // is human-invoked and re-seals the platform admission via
        // run_governance::establish), not a silent auto-raise. Held for the
        // FR-005 certificate binding (spec 202 Slice C).
        let resume_budget_meter = Arc::new(Mutex::new(orchestrator::RunBudgetMeter::new(
            factory_contracts::apply_defaults(&[]),
        )));
        let resume_budget_gate: Arc<dyn orchestrator::PreStepGate> =
            Arc::new(orchestrator::BudgetGate::new(resume_budget_meter.clone()));
        // Spec 202 FR-003b: the resume path also detects oscillation, on every
        // run including the ungoverned arm, with a fresh breaker (same "new
        // admission => new meter" posture as the resume budget meter).
        let resume_oscillation_cfg = factory_contracts::apply_oscillation_default(None);
        let resume_oscillation_breaker = Arc::new(Mutex::new(
            orchestrator::CircuitBreakerState::new(orchestrator::CircuitBreakerConfig {
                threshold: resume_oscillation_cfg.consecutive_failures,
                window_secs: resume_oscillation_cfg.window_secs.unwrap_or(300),
            }),
        ));
        let resume_oscillation_gate: Arc<dyn orchestrator::PreStepGate> =
            Arc::new(orchestrator::OscillationGate::new(
                resume_oscillation_breaker.clone(),
            ));
        // Spec 202 FR-003a: the resume path also detects repeated
        // near-identical intents, on every run including the ungoverned arm,
        // with a fresh detector (same "new admission => new meter" posture
        // as the resume budget meter / oscillation breaker above).
        let resume_intent_goal_id = match governance.as_ref() {
            Some(gov) => gov.capsule.goal_id.clone(),
            None => factory_engine::intent_capsule::derive_goal_id(&run_id),
        };
        let resume_intent_dedup_gate: Arc<dyn orchestrator::PreStepGate> =
            Arc::new(orchestrator::IntentDedupGate::new(
                resume_intent_goal_id,
                factory_contracts::apply_intent_dedup_default(None),
            ));
        options.pre_step = Some(match governance.as_ref() {
            Some(gov) => {
                // The freshly-seeded resume state has no frozen Build-Spec hash;
                // the platform chain already holds it one-way if it was ever
                // presented before the restart.
                let bs = resume_pipeline_state.build_spec_hash.clone();
                let grant: Arc<dyn orchestrator::PreStepGate> =
                    Arc::new(super::run_governance::GrantRenewalGate::new(
                        gov.clone(),
                        Box::new(move || bs.clone()),
                        stage_agents.clone(),
                    ));
                Arc::new(orchestrator::ChainedPreStepGate::new(vec![
                    grant,
                    resume_budget_gate,
                    resume_oscillation_gate,
                    resume_intent_dedup_gate,
                ])) as Arc<dyn orchestrator::PreStepGate>
            }
            None => Arc::new(orchestrator::ChainedPreStepGate::new(vec![
                resume_budget_gate,
                resume_oscillation_gate,
                resume_intent_dedup_gate,
            ])) as Arc<dyn orchestrator::PreStepGate>,
        });

        match dispatch_manifest(&am, run_uuid, &manifest, bridge, executor, &options).await {
            Ok(summary) => {
                let total_tokens: u64 = summary.steps.iter().filter_map(|s| s.tokens_used).sum();
                let half = total_tokens / 2;
                let token_spend = FactoryRunTokenSpend {
                    input: half,
                    output: total_tokens - half,
                    total: total_tokens,
                };
                // Spec 198 FR-009/FR-014 — emit + (when live) seal the
                // certificate for the resumed run. The requirements hash
                // persisted at run start keeps the intent binding stable
                // across the restart.
                let requirements_hash = std::fs::read_to_string(
                    run_dir.join("requirements-hash.txt"),
                )
                .map(|s| s.trim().to_string())
                .unwrap_or_else(|_| {
                    hex::encode(Sha256::new().finalize())
                });
                let binding = governance.as_ref().map(|g| g.capsule_binding());
                // Spec 202 FR-005: snapshot the resumed run's budget meter.
                // Recover a poisoned lock (into_inner) so a panic never silently
                // downgrades the cert to the "unmetered" state.
                let budget_consumption: Vec<
                    factory_engine::governance_certificate::BudgetAxisRecord,
                > = {
                    let snapshot = resume_budget_meter
                        .lock()
                        .map(|m| m.consumption())
                        .unwrap_or_else(|poisoned| poisoned.into_inner().consumption());
                    snapshot
                        .into_iter()
                        .map(factory_engine::governance_certificate::BudgetAxisRecord::from)
                        .collect()
                };
                let cert = factory_engine::governance_certificate::generate_certificate_bound(
                    &resume_pipeline_state,
                    &requirements_hash,
                    &run_dir,
                    None,
                    &[],
                    binding.as_ref(),
                    budget_consumption,
                );
                let cert_hash = cert.certificate_hash.clone();
                if let Err(e) = factory_engine::governance_certificate::persist_certificate(
                    &cert, &run_dir,
                ) {
                    log::warn!("governance certificate persist failed for resumed run {run_id}: {e}");
                }
                let final_seq = governance
                    .as_ref()
                    .map(|g| g.last_seq.load(std::sync::atomic::Ordering::Acquire));
                match resume_emitter_for_spawn
                    .completed(token_spend, Some(cert_hash), final_seq)
                    .await
                {
                    Ok(Some(cs)) if cs.countersigned => {
                        if let (Some(jws), Some(gov)) =
                            (cs.countersign_jws.as_deref(), governance.as_ref())
                        {
                            let cert_path = run_dir.join("governance-certificate.json");
                            if let Err(e) =
                                factory_engine::governance_certificate::apply_countersign(
                                    &cert_path,
                                    jws,
                                    &gov.jwks,
                                    Some(&platform_run_id_for_resume),
                                )
                            {
                                log::warn!(
                                    "countersign apply failed for resumed run {run_id}: {e}"
                                );
                            }
                        }
                    }
                    Ok(Some(cs)) => log::warn!(
                        "platform refused countersign for resumed run {run_id}: {}",
                        cs.refused_reason.unwrap_or_default()
                    ),
                    Ok(None) => log::info!(
                        "resumed run {run_id} completed without a live countersign round-trip — certificate stays visibly unsealed"
                    ),
                    Err(emit_err) => log::warn!(
                        "factory.run.completed (resume) emit/spool failed for run {run_id}: {emit_err}"
                    ),
                }
                app_handle
                    .emit(
                        "factory:workflow_completed",
                        &serde_json::json!({ "runId": run_id }),
                    )
                    .ok();
            }
            Err(e) => {
                log::error!("factory dispatch failed for run {run_id}: {e}");
                if let Err(emit_err) = resume_emitter_for_spawn.failed(e.to_string()).await {
                    log::warn!(
                        "factory.run.failed (resume) emit/spool failed for run {run_id}: {emit_err}"
                    );
                }
                app_handle
                    .emit(
                        "factory:workflow_failed",
                        &serde_json::json!({
                            "runId": run_id,
                            "error": e.to_string(),
                        }),
                    )
                    .ok();
            }
        }
    });

    Ok(())
}

// ---------------------------------------------------------------------------
// Knowledge bundle materialisation (spec 110 §2.3)
// ---------------------------------------------------------------------------

/// Reasons a knowledge-bundle materialisation can fail. Each variant maps to
/// a distinct decline_reason on `factory.run.ack` so statecraft can record
/// why the run never started.
#[derive(Debug, thiserror::Error)]
pub enum KnowledgeMaterializationError {
    #[error("knowledge_hash_mismatch: expected {expected}, got {actual}")]
    HashMismatch { expected: String, actual: String },
    #[error("download failed for {object_id}: {source}")]
    Download {
        object_id: String,
        #[source]
        source: reqwest::Error,
    },
    #[error("cache I/O failed: {0}")]
    Io(#[from] std::io::Error),
    #[error("invalid content hash {0}: must be lowercase hex sha-256")]
    InvalidHash(String),
}

/// Resolve the OPC knowledge cache directory. Honours `OPC_CACHE_DIR` for
/// tests and sandboxes; falls back to the platform cache dir + `/opc`.
fn opc_cache_dir() -> PathBuf {
    if let Ok(dir) = std::env::var("OPC_CACHE_DIR") {
        return PathBuf::from(dir);
    }
    dirs::cache_dir()
        .unwrap_or_else(std::env::temp_dir)
        .join("opc")
}

/// Content-addressable cache root for materialised knowledge blobs.
pub fn knowledge_cache_dir() -> PathBuf {
    opc_cache_dir().join("knowledge")
}

fn is_lowercase_hex_sha256(s: &str) -> bool {
    s.len() == 64 && s.bytes().all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}

fn hash_file(path: &std::path::Path) -> std::io::Result<String> {
    use std::io::Read;
    let mut file = std::fs::File::open(path)?;
    let mut hasher = Sha256::new();
    let mut buf = [0u8; 64 * 1024];
    loop {
        let n = file.read(&mut buf)?;
        if n == 0 {
            break;
        }
        hasher.update(&buf[..n]);
    }
    Ok(hex::encode(hasher.finalize()))
}

/// Materialise a single knowledge bundle to a local path. Enforces the
/// content-hash trust boundary (§2.3): a mismatch fails the run.
///
/// Cache layout: `<cache_dir>/knowledge/<sha256>/<filename>`. Nesting under
/// the hash lets different filenames coexist for the same content while still
/// deduping by bytes.
pub async fn materialize_knowledge_bundle(
    bundle: &WireKnowledgeBundle,
) -> Result<PathBuf, KnowledgeMaterializationError> {
    materialize_knowledge_bundle_in(bundle, &knowledge_cache_dir()).await
}

/// Test-friendly variant: pins the cache root explicitly so unit tests can
/// isolate themselves without mutating process-global env state.
pub async fn materialize_knowledge_bundle_in(
    bundle: &WireKnowledgeBundle,
    cache_root: &std::path::Path,
) -> Result<PathBuf, KnowledgeMaterializationError> {
    if !is_lowercase_hex_sha256(&bundle.content_hash) {
        return Err(KnowledgeMaterializationError::InvalidHash(
            bundle.content_hash.clone(),
        ));
    }

    let hash_dir = cache_root.join(&bundle.content_hash);
    std::fs::create_dir_all(&hash_dir)?;
    let cache_path = hash_dir.join(&bundle.filename);

    // Cache hit — verify bytes haven't been tampered with since last write
    // before we hand the path to the engine.
    if cache_path.exists() {
        let observed = hash_file(&cache_path)?;
        if observed == bundle.content_hash {
            return Ok(cache_path);
        }
        // Corrupted cache entry — remove and fall through to re-download.
        let _ = std::fs::remove_file(&cache_path);
    }

    // Cache miss — download, stream-hash, write atomically.
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(60))
        .build()
        .map_err(|e| KnowledgeMaterializationError::Download {
            object_id: bundle.object_id.clone(),
            source: e,
        })?;

    let bytes = client
        .get(&bundle.download_url)
        .send()
        .await
        .and_then(|r| r.error_for_status())
        .map_err(|e| KnowledgeMaterializationError::Download {
            object_id: bundle.object_id.clone(),
            source: e,
        })?
        .bytes()
        .await
        .map_err(|e| KnowledgeMaterializationError::Download {
            object_id: bundle.object_id.clone(),
            source: e,
        })?;

    let mut hasher = Sha256::new();
    hasher.update(&bytes);
    let observed = hex::encode(hasher.finalize());
    if observed != bundle.content_hash {
        return Err(KnowledgeMaterializationError::HashMismatch {
            expected: bundle.content_hash.clone(),
            actual: observed,
        });
    }

    // Atomic write: land to a sibling temp file in the same directory, then
    // rename. Avoids a half-written cache entry on crash.
    let tmp = hash_dir.join(format!(".{}.partial", bundle.filename));
    std::fs::write(&tmp, &bytes)?;
    std::fs::rename(&tmp, &cache_path)?;

    Ok(cache_path)
}

// ---------------------------------------------------------------------------
// factory.run.request dispatch handler (spec 110 §2.1 + §8 Phase 4)
// ---------------------------------------------------------------------------

/// Minimal shape we extract from a `factory.run.request` envelope before
/// dispatching it to the engine. Mirrors [`ServerEnvelopeWire`] but narrowed
/// to the fields this handler actually reads.
struct InboundFactoryRun {
    pipeline_id: String,
    project_id: String,
    adapter: String,
    knowledge: Vec<WireKnowledgeBundle>,
    /// Names of any explicit `business_docs` carried on the envelope, distinct
    /// from the knowledge corpus. Carried for diagnostics only: unlike knowledge
    /// bundles (which ship a presigned `download_url`), a `business_docs` entry
    /// ships a bare `storage_ref` that OPC has no path to fetch, so these are
    /// surfaced (not silently dropped as before) and excluded from the run's
    /// inputs pending the presign+materialise follow-up.
    business_doc_names: Vec<String>,
}

fn extract_factory_run(envelope: &ServerEnvelopeWire) -> Option<InboundFactoryRun> {
    Some(InboundFactoryRun {
        pipeline_id: envelope.pipeline_id.clone()?,
        project_id: envelope.project_id.clone()?,
        adapter: envelope.adapter.clone()?,
        knowledge: envelope.knowledge.clone().unwrap_or_default(),
        business_doc_names: envelope
            .business_docs
            .as_ref()
            .map(|docs| docs.iter().map(|d| d.name.clone()).collect())
            .unwrap_or_default(),
    })
}

/// Register a `factory.run.request` handler on the given sync consumer
/// dispatch table. Wires the desktop end of spec 110 §8 Phase 4.
///
/// The handler:
///   - Dedupes by `pipeline_id` (§2.1 exactly-once intent).
///   - Materialises attached knowledge bundles into the content-addressable
///     cache and verifies each sha-256 (§2.3 trust boundary).
///   - Mints a `session_id` per accepted request (§2.4 tab session).
///   - Starts the local factory pipeline via `start_factory_pipeline` and
///     passes the minted session id through so progress frames can carry it.
///   - Emits `factory.run.ack` on the outbound channel — `accepted: true` on
///     the happy path, `accepted: false` with a structured decline_reason on
///     materialisation or engine start failures.
pub fn register_factory_run_handler(app: AppHandle, opc_instance_id: String) {
    let sync_state_present = app.try_state::<SyncClientState>().is_some();
    if !sync_state_present {
        log::warn!("register_factory_run_handler: SyncClientState not managed — skipping");
        return;
    }
    let dispatch = app.state::<SyncClientState>().dispatch_table();

    let app_for_handler = app.clone();
    let handler = FnHandler(move |envelope: &ServerEnvelopeWire| {
        let Some(run) = extract_factory_run(envelope) else {
            log::warn!(
                "factory.run.request missing required fields (pipeline_id/project_id/adapter) — ignoring"
            );
            return;
        };

        // Exactly-once dedupe by pipeline_id. A returning `true` from `insert`
        // means this is the first time we've seen this pipeline_id.
        let first_time = match FACTORY_RUN_REQUESTS_SEEN.lock() {
            Ok(mut g) => g.insert(run.pipeline_id.clone()),
            Err(_) => false,
        };
        if !first_time {
            log::info!(
                "factory.run.request duplicate for pipeline_id={} — ignored",
                run.pipeline_id
            );
            return;
        }

        let session_id = Uuid::new_v4().to_string();
        let app = app_for_handler.clone();
        let opc_id = opc_instance_id.clone();
        tauri::async_runtime::spawn(async move {
            handle_factory_run_request(app, opc_id, session_id, run).await;
        });
    });

    dispatch.register("factory.run.request", Arc::new(handler));
    log::info!("sync_client: factory.run.request dispatch handler registered");
}

/// Find the live run whose `statecraft_pipeline_id` matches `pipeline_id`.
///
/// `factory.event` frames are org-scoped broadcasts, so most desktops (and most
/// runs on this desktop) will not match: a `None` result is the common,
/// non-error case. The `FACTORY_RUNS` lock is released before the per-run
/// `statecraft_pipeline_id` mutexes are read so the two never nest.
fn find_run_by_pipeline(pipeline_id: &str) -> Option<(String, Arc<FactoryRunContext>)> {
    let candidates: Vec<(String, Arc<FactoryRunContext>)> = {
        let runs = FACTORY_RUNS.lock().ok()?;
        runs.iter().map(|(k, v)| (k.clone(), v.clone())).collect()
    };
    candidates.into_iter().find(|(_, ctx)| {
        ctx.statecraft_pipeline_id
            .lock()
            .ok()
            .and_then(|g| g.clone())
            .as_deref()
            == Some(pipeline_id)
    })
}

/// Minimal shape extracted from a `factory.event` envelope.
struct InboundFactoryEvent {
    pipeline_id: String,
    event_type: String,
    stage_id: Option<String>,
    feedback: Option<String>,
}

fn extract_factory_event(envelope: &ServerEnvelopeWire) -> Option<InboundFactoryEvent> {
    Some(InboundFactoryEvent {
        pipeline_id: envelope.pipeline_id.clone()?,
        event_type: envelope.event_type.clone()?,
        stage_id: envelope.stage_id.clone(),
        // stage_rejected carries operator feedback under details.reason/notes.
        feedback: envelope.details.as_ref().and_then(|d| {
            d.get("reason")
                .or_else(|| d.get("notes"))
                .and_then(|v| v.as_str())
                .map(str::to_string)
        }),
    })
}

/// Apply a decoded `factory.event` to the matching local run.
///
/// The load-bearing case is a gate approved/rejected on the statecraft web
/// surface: `confirm`/`reject` there publish `stage_confirmed`/`stage_rejected`
/// (`platform/services/statecraft/api/factory/factory.ts`), which is the only
/// path by which a web-side sign-off can resolve the OPC local pipeline's
/// pending gate oneshot. The symmetric OPC-side path (`confirm_factory_stage`)
/// already dual-writes to statecraft; this closes the loop the other direction.
/// An echo of a gate already resolved locally simply finds no pending gate and
/// no-ops (logged at debug, not error).
fn apply_factory_event(event: &InboundFactoryEvent) {
    let Some((run_id, ctx)) = find_run_by_pipeline(&event.pipeline_id) else {
        // Usually expected: factory.event is an org-scoped broadcast, so most
        // frames are for runs on other desktops. But this is ALSO the signature
        // of a correlation miss: a gate approved on the web for a run THIS
        // desktop is executing, under a pipeline_id that never got recorded in
        // its statecraft_pipeline_id. Logged at debug so a repro can compare
        // this id against the "Statecraft pipeline registered: pipeline_id=..."
        // line and tell the two cases apart.
        log::debug!(
            "factory.event {} for pipeline_id={} matched no local run",
            event.event_type, event.pipeline_id
        );
        return;
    };
    match event.event_type.as_str() {
        "stage_confirmed" => {
            let Some(stage_id) = event.stage_id.as_deref() else {
                log::warn!("factory.event stage_confirmed without stage_id (run {run_id})");
                return;
            };
            match ctx.gate_handler.approve_by_prefix(stage_id) {
                Ok(resolved) => log::info!(
                    "factory.event: remote stage_confirmed '{stage_id}' resolved local gate '{resolved}' (run {run_id})"
                ),
                // Common and benign: an echo of a gate already confirmed
                // locally, or an event for a stage not currently gating here.
                Err(e) => log::debug!(
                    "factory.event: stage_confirmed '{stage_id}' not applied (run {run_id}): {e}"
                ),
            }
        }
        "stage_rejected" => {
            let Some(stage_id) = event.stage_id.as_deref() else {
                log::warn!("factory.event stage_rejected without stage_id (run {run_id})");
                return;
            };
            let feedback = event.feedback.as_deref().unwrap_or("rejected on statecraft");
            match ctx.gate_handler.reject_by_prefix(stage_id, feedback) {
                Ok(resolved) => log::info!(
                    "factory.event: remote stage_rejected '{stage_id}' resolved local gate '{resolved}' (run {run_id})"
                ),
                Err(e) => log::debug!(
                    "factory.event: stage_rejected '{stage_id}' not applied (run {run_id}): {e}"
                ),
            }
        }
        // Terminal and informational events (pipeline_initialized,
        // pipeline_completed, pipeline_failed, deployment_triggered) are
        // surfaced by the run's own RunEmitter/status projection; there is no
        // local gate to resolve for them.
        other => log::debug!("factory.event: '{other}' for run {run_id} (no local gate action)"),
    }
}

/// Register a `factory.event` handler on the sync consumer dispatch table.
///
/// Mirrors `register_factory_run_handler`. `factory.event` frames were already
/// decoded by `ServerEnvelopeWire` but had no registered handler, so every one
/// was dropped with "no handler registered", including the `stage_confirmed`
/// frames that carry a statecraft-web gate approval back to the OPC run. The
/// handler body is synchronous (a fast oneshot resolve under a brief lock), so
/// unlike the run-request handler it does not spawn.
pub fn register_factory_event_handler(app: AppHandle) {
    let sync_state_present = app.try_state::<SyncClientState>().is_some();
    if !sync_state_present {
        log::warn!("register_factory_event_handler: SyncClientState not managed, skipping");
        return;
    }
    let dispatch = app.state::<SyncClientState>().dispatch_table();
    let handler = FnHandler(move |envelope: &ServerEnvelopeWire| {
        if let Some(event) = extract_factory_event(envelope) {
            apply_factory_event(&event);
        }
    });
    dispatch.register("factory.event", Arc::new(handler));
    log::info!("sync_client: factory.event dispatch handler registered");
}

/// Spec 120 FR-022 — pre-flight `s-1-extract` for orchestrated runs.
///
/// Builds typed `KnowledgeBundleRef`s from the materialised paths, runs the
/// extraction stage with `client = None` (yield-back disabled until the
/// duplex subscription lands in Phase 6 hardening), and returns the path to
/// the rendered `s1-context.md` artifact as the sole input for the LLM
/// stages. When the bundle contains a non-deterministic object the stage
/// fails fast with `NoStatecraftClient`; the caller surfaces it via the
/// run-ack channel.
async fn run_orchestrated_s_minus_1_extract(
    run: &InboundFactoryRun,
    materialised: &[(WireKnowledgeBundle, std::path::PathBuf)],
) -> Result<Vec<String>, String> {
    use factory_engine::artifact_store::LocalArtifactStore;
    use factory_engine::stages::s_minus_1_extract::{
        ExtractionStageConfig, KnowledgeBundleRef, render_s1_context_md, run_extraction_stage,
        sniff_mime_or_fallback,
    };

    if materialised.is_empty() {
        return Ok(Vec::new());
    }

    let bundles: Vec<KnowledgeBundleRef> = materialised
        .iter()
        .map(|(bundle, path)| KnowledgeBundleRef {
            local_path: path.clone(),
            object_id: bundle.object_id.clone(),
            source_content_hash: bundle.content_hash.clone(),
            mime: sniff_mime_or_fallback(path, None),
            filename: bundle.filename.clone(),
        })
        .collect();

    let store = LocalArtifactStore::from_env().map_err(|e| format!("artifact store: {e}"))?;
    let cfg = ExtractionStageConfig::from_env(run.project_id.clone());
    let report = run_extraction_stage(
        &bundles,
        &store,
        None,
        &cfg,
        tokio_util::sync::CancellationToken::new(),
    )
    .await
    .map_err(|e| e.to_string())?;
    let context_md = render_s1_context_md(&bundles, &report, &store)
        .map_err(|e| format!("render s1-context.md: {e}"))?;
    let stored = store
        .store_bytes(context_md.as_bytes(), "s1-context.md")
        .map_err(|e| format!("store s1-context.md: {e}"))?;
    Ok(vec![stored.storage_path])
}

async fn handle_factory_run_request(
    app: AppHandle,
    opc_instance_id: String,
    session_id: String,
    run: InboundFactoryRun,
) {
    // Surface, rather than silently drop, any explicit business_docs on the
    // envelope. `extract_factory_run` used to ignore the field entirely; OPC
    // still cannot materialise them (the envelope ships a bare `storage_ref`,
    // not a presigned `download_url` like knowledge bundles), so they are
    // excluded from this run's inputs, but the exclusion is now visible in the
    // log instead of invisible. Full support requires presigning these in the
    // statecraft relay (as knowledge is) and materialising them here.
    if !run.business_doc_names.is_empty() {
        log::warn!(
            "factory.run.request pipeline_id={} carries {} explicit business_docs OPC cannot yet materialise (storage_ref not presigned); excluded from inputs: {:?}",
            run.pipeline_id,
            run.business_doc_names.len(),
            run.business_doc_names
        );
    }

    // Step 1: materialise knowledge bundles. Hash mismatch is a trust-boundary
    // failure — decline the run and let statecraft mark it failed.
    let mut materialised: Vec<(WireKnowledgeBundle, std::path::PathBuf)> =
        Vec::with_capacity(run.knowledge.len());
    for bundle in &run.knowledge {
        match materialize_knowledge_bundle(bundle).await {
            Ok(p) => materialised.push((bundle.clone(), p)),
            Err(e) => {
                let decline = match &e {
                    KnowledgeMaterializationError::HashMismatch { .. } => {
                        "knowledge_hash_mismatch".to_string()
                    }
                    _ => format!("knowledge_materialization_failed: {e}"),
                };
                log::warn!(
                    "factory.run.request pipeline_id={} bundle={} failed: {e}",
                    run.pipeline_id,
                    bundle.object_id
                );
                send_factory_run_ack(
                    &app,
                    &run.pipeline_id,
                    &session_id,
                    &opc_instance_id,
                    false,
                    Some(decline),
                );
                return;
            }
        }
    }

    // Step 1b (spec 120 FR-022): run `s-1-extract` ahead of the LLM stages.
    // Deterministic objects emit typed `ExtractionOutput` to the unified
    // artifact store; RequiresAgent objects fail until the duplex
    // subscription is wired (Phase 6 hardening). The aggregated
    // `s1-context.md` becomes the single doc input for stage s0.
    let doc_paths = match run_orchestrated_s_minus_1_extract(&run, &materialised).await {
        Ok(paths) => paths,
        Err(reason) => {
            log::warn!(
                "factory.run.request pipeline_id={} s-1-extract failed: {reason}",
                run.pipeline_id
            );
            send_factory_run_ack(
                &app,
                &run.pipeline_id,
                &session_id,
                &opc_instance_id,
                false,
                Some(format!("s_minus_1_extract: {reason}")),
            );
            return;
        }
    };

    // Step 2: resolve a project_path. For the Phase 4 landing we use the
    // OPC workspace-scoped scratch path `$OPC_CACHE_DIR/projects/<project_id>`
    // when the frontend has no active project path. This keeps the envelope
    // flow self-contained while a future phase wires project paths through
    // the org catalog (spec 111).
    let project_path = opc_cache_dir()
        .join("projects")
        .join(&run.project_id)
        .to_string_lossy()
        .into_owned();

    // Step 3: start the pipeline with the minted session id. Spec 110
    // envelopes don't carry a process name yet, so `start_factory_pipeline`
    // falls back to its DEFAULT_PROCESS_NAME constant when None is passed.
    let result = start_factory_pipeline(
        app.clone(),
        project_path,
        run.adapter.clone(),
        None,
        doc_paths,
        Some(run.project_id.clone()),
        Some(session_id.clone()),
    )
    .await;

    match result {
        Ok(_) => {
            send_factory_run_ack(
                &app,
                &run.pipeline_id,
                &session_id,
                &opc_instance_id,
                true,
                None,
            );
        }
        Err(e) => {
            log::warn!(
                "factory.run.request pipeline_id={} engine start failed: {e}",
                run.pipeline_id
            );
            send_factory_run_ack(
                &app,
                &run.pipeline_id,
                &session_id,
                &opc_instance_id,
                false,
                Some(format!("engine_start_failed: {e}")),
            );
        }
    }
}

/// Fire a `factory.run.ack` on the outbound channel. No-op when the duplex
/// stream is not currently connected — the handler still executed so the
/// dedupe marker persists and a reconnect won't re-trigger the same run.
fn send_factory_run_ack(
    app: &AppHandle,
    pipeline_id: &str,
    session_id: &str,
    opc_instance_id: &str,
    accepted: bool,
    decline_reason: Option<String>,
) {
    let Some(sync) = app.try_state::<SyncClientState>() else {
        log::warn!("send_factory_run_ack: SyncClientState not managed");
        return;
    };
    let pipeline_id = pipeline_id.to_string();
    let session_id = session_id.to_string();
    let opc_instance_id = opc_instance_id.to_string();
    let sync_handle = sync.handle();
    tauri::async_runtime::spawn(async move {
        let sent = sync_handle
            .send_factory_run_ack(
                &pipeline_id,
                &session_id,
                &opc_instance_id,
                accepted,
                decline_reason.clone(),
            )
            .await;
        if !sent {
            log::warn!(
                "factory.run.ack not delivered (duplex disconnected) pipeline_id={}",
                pipeline_id
            );
        }
    });
}

// ---------------------------------------------------------------------------
// Tests (spec 110 Phase 4)
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use axum::{Router, body::Body, extract::State, http::StatusCode, response::Response, routing::get};
    use std::net::SocketAddr;
    use tokio::sync::oneshot;

    fn sha256_hex(bytes: &[u8]) -> String {
        let mut hasher = Sha256::new();
        hasher.update(bytes);
        hex::encode(hasher.finalize())
    }

    #[test]
    fn is_lowercase_hex_sha256_accepts_valid_hex() {
        let ok = "a".repeat(64);
        assert!(is_lowercase_hex_sha256(&ok));
        assert!(is_lowercase_hex_sha256(&sha256_hex(b"hello")));
    }

    #[test]
    fn is_lowercase_hex_sha256_rejects_bad_inputs() {
        assert!(!is_lowercase_hex_sha256(""));
        assert!(!is_lowercase_hex_sha256(&"a".repeat(63)));
        assert!(!is_lowercase_hex_sha256(&"A".repeat(64)), "uppercase rejected");
        assert!(!is_lowercase_hex_sha256(&"g".repeat(64)), "non-hex rejected");
    }

    #[test]
    fn resolve_resume_project_path_rejects_missing_and_accepts_existing() {
        // Empty path: a platform-projected run carries no local copy. The old
        // code surfaced a raw OS error; we now return an actionable message.
        let err = resolve_resume_project_path("   ").unwrap_err();
        assert!(err.contains("no local project path"), "got: {err}");

        // A path that does not exist reproduces the old UUID-as-path bug
        // (`PathBuf::from(uuid).canonicalize()` -> ENOENT). It must be an
        // actionable "not found locally" error, not the bare OS string.
        let missing = "/definitely/not/a/real/path/oap-resume-x9f3";
        let err = resolve_resume_project_path(missing).unwrap_err();
        assert!(err.contains("not found locally"), "got: {err}");
        assert!(!err.contains("os error"), "must not leak the raw OS error: {err}");

        // An existing directory resolves. We deliberately do NOT require a git
        // clone here (spec-110 scratch runs live under a non-git path), so the
        // crate manifest dir is a valid stand-in.
        let existing = env!("CARGO_MANIFEST_DIR");
        let ok = resolve_resume_project_path(existing).expect("existing dir resolves");
        assert!(ok.is_absolute());
    }

    #[test]
    fn stage_prefix_normalises_across_vocabularies() {
        assert_eq!(stage_prefix("s0-preflight").as_deref(), Some("s0"));
        assert_eq!(stage_prefix("s4-api-specification").as_deref(), Some("s4"));
        assert_eq!(stage_prefix("s4-api-spec").as_deref(), Some("s4"));
        assert_eq!(stage_prefix("s6-scaffolding").as_deref(), Some("s6"));
        assert_eq!(stage_prefix("s1").as_deref(), Some("s1"));
        // Not an `s<digits>` token.
        assert_eq!(stage_prefix("preflight"), None);
        assert_eq!(stage_prefix("stage-1"), None);
        assert_eq!(stage_prefix("sx-thing"), None);
        assert_eq!(stage_prefix(""), None);
    }

    #[test]
    fn match_pending_stage_reconciles_drifted_ids() {
        // Pending gates are keyed by the OPC-local step ids.
        let keys = vec![
            "s0-preflight".to_string(),
            "s4-api-specification".to_string(),
        ];
        // statecraft's PIPELINE_STAGES id joins the drifted OPC key.
        assert_eq!(
            match_pending_stage(keys.iter(), "s4-api-spec").as_deref(),
            Some("s4-api-specification")
        );
        // The bare sign-off label joins too.
        assert_eq!(
            match_pending_stage(keys.iter(), "s0").as_deref(),
            Some("s0-preflight")
        );
        // No gate pending for that stage prefix.
        assert_eq!(match_pending_stage(keys.iter(), "s2-service-requirements"), None);
        // Unrecognised stage id resolves to nothing rather than mis-joining.
        assert_eq!(match_pending_stage(keys.iter(), "garbage"), None);
    }

    #[test]
    fn stage_display_name_matches_ts_titleize_parity() {
        // Parity lock with the TS `stagesFromProcessDefinition` /
        // `titleizeStageId` in
        // product/apps/opc/src/components/factory/types.ts (test
        // `label parity with Rust stage_display_name`). The SAME
        // (input, expected) vector is asserted on both sides so the two
        // stage-label implementations cannot silently diverge.
        //
        // A leading `sN-` prefix is stripped ONLY when every char after `s`
        // is a digit — matching the TS `/^s\d+-/` regex. So `ss-something`
        // and `s1a-foo` are NOT stripped, and `s` alone (len 1) is never a
        // prefix. (This is the case the AI review claimed diverged; both
        // languages keep it intact and titleise to the same string.)
        let cases = [
            ("s0-preflight", "Pre-flight"),         // curated canonical label
            ("s6-scaffolding", "Scaffolding"),      // sN- stripped (all-digit)
            ("s10-deep-dive", "Deep Dive"),         // multi-digit prefix stripped
            ("s6a-entity-user", "S6a Entity User"), // "6a" not all-digit → kept
            ("ss-something", "Ss Something"),       // not stripped (disputed case)
            ("s1a-foo", "S1a Foo"),                 // "1a" not all-digit → kept
            ("s-foo", "S Foo"),                     // "s" alone is not an sN- prefix
            ("adapter-handoff", "Adapter Handoff"), // no prefix
        ];
        for (input, expected) in cases {
            assert_eq!(stage_display_name(input), expected, "input={input}");
        }
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn materialize_uses_cached_file_when_hash_matches() {
        let tmp = tempfile::tempdir().unwrap();
        let cache_root = tmp.path().join("knowledge");

        let payload = b"canonical bytes";
        let hash = sha256_hex(payload);
        let cache_path = cache_root.join(&hash).join("doc.md");
        std::fs::create_dir_all(cache_path.parent().unwrap()).unwrap();
        std::fs::write(&cache_path, payload).unwrap();

        let bundle = WireKnowledgeBundle {
            object_id: "k1".into(),
            filename: "doc.md".into(),
            content_hash: hash.clone(),
            // URL deliberately unreachable — a cache hit must not dial out.
            download_url: "http://127.0.0.1:1/does-not-exist".into(),
        };
        let got = materialize_knowledge_bundle_in(&bundle, &cache_root)
            .await
            .unwrap();
        assert_eq!(got, cache_path);
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn materialize_rejects_invalid_hash() {
        let tmp = tempfile::tempdir().unwrap();
        let bundle = WireKnowledgeBundle {
            object_id: "k1".into(),
            filename: "doc.md".into(),
            content_hash: "not-a-sha256".into(),
            download_url: "http://127.0.0.1:1".into(),
        };
        let err = materialize_knowledge_bundle_in(&bundle, tmp.path())
            .await
            .unwrap_err();
        assert!(matches!(
            err,
            KnowledgeMaterializationError::InvalidHash(_)
        ));
    }

    // Spin up a minimal axum server that serves a fixed byte body at /blob.
    // Returns the bound address plus a shutdown signal; drop the signal to
    // stop the server.
    async fn spawn_blob_server(body: Vec<u8>) -> (SocketAddr, oneshot::Sender<()>) {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        let (tx, rx) = oneshot::channel::<()>();

        async fn serve(State(body): State<Arc<Vec<u8>>>) -> Response {
            Response::builder()
                .status(StatusCode::OK)
                .body(Body::from(body.as_ref().clone()))
                .unwrap()
        }

        let app = Router::new()
            .route("/blob", get(serve))
            .with_state(Arc::new(body));

        tokio::spawn(async move {
            axum::serve(listener, app)
                .with_graceful_shutdown(async {
                    let _ = rx.await;
                })
                .await
                .unwrap();
        });
        (addr, tx)
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn materialize_downloads_and_caches_on_miss() {
        let tmp = tempfile::tempdir().unwrap();
        let cache_root = tmp.path().join("knowledge");

        let payload = b"streamed body".to_vec();
        let hash = sha256_hex(&payload);
        let (addr, _stop) = spawn_blob_server(payload.clone()).await;

        let bundle = WireKnowledgeBundle {
            object_id: "k1".into(),
            filename: "doc.md".into(),
            content_hash: hash.clone(),
            download_url: format!("http://{addr}/blob"),
        };

        let got = materialize_knowledge_bundle_in(&bundle, &cache_root)
            .await
            .unwrap();
        assert_eq!(std::fs::read(&got).unwrap(), payload);

        // Second call must be a cache hit — the partial/temp file should be
        // gone, only the canonical filename remains under the hash dir.
        let second = materialize_knowledge_bundle_in(&bundle, &cache_root)
            .await
            .unwrap();
        assert_eq!(second, got);
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn materialize_fails_on_hash_mismatch() {
        let tmp = tempfile::tempdir().unwrap();
        let cache_root = tmp.path().join("knowledge");

        let payload = b"actual bytes".to_vec();
        let (addr, _stop) = spawn_blob_server(payload).await;
        // Claim a different (valid-shape) hash so the downloaded bytes fail
        // verification. This is the trust-boundary case from spec 110 §2.3.
        let bogus_hash = "0".repeat(64);
        let bundle = WireKnowledgeBundle {
            object_id: "k1".into(),
            filename: "doc.md".into(),
            content_hash: bogus_hash,
            download_url: format!("http://{addr}/blob"),
        };
        let err = materialize_knowledge_bundle_in(&bundle, &cache_root)
            .await
            .unwrap_err();
        assert!(matches!(
            err,
            KnowledgeMaterializationError::HashMismatch { .. }
        ));
    }

    #[test]
    fn extract_factory_run_requires_pipeline_project_adapter() {
        // Missing pipeline_id — handler must reject (a malformed envelope
        // slipped past the schema guard).
        let env = ServerEnvelopeWire {
            kind: "factory.run.request".into(),
            meta: crate::commands::sync_client::ServerMeta {
                v: 1,
                event_id: "e".into(),
                sent_at: "2026-04-21T00:00:00Z".into(),
                correlation_id: None,
                causation_id: None,
                org_cursor: "c".into(),
                org_id: "org-1".into(),
            },
            policy_bundle_id: None,
            summary: None,
            user_id: None,
            change: None,
            details: None,
            project_id: Some("p".into()),
            environment_id: None,
            status: None,
            detail: None,
            pipeline_id: None,
            event_type: None,
            stage_id: None,
            actor: None,
            client_event_id: None,
            reason: None,
            session_id: None,
            server_started_at: None,
            cursor_gap: None,
            adapter: Some("rest".into()),
            actor_user_id: None,
            knowledge: None,
            business_docs: None,
            requested_at: None,
            deadline_at: None,
            agent_id: None,
            name: None,
            version: None,
            content_hash: None,
            frontmatter: None,
            body_markdown: None,
            updated_at: None,
            entries: None,
            generated_at: None,
            slug: None,
            description: None,
            org_id: None,
            factory_adapter_id: None,
            detection_level: None,
            repo: None,
            opc_deep_link: None,
            tombstone: None,
            binding_id: None,
            org_agent_id: None,
            agent_name: None,
            pinned_version: None,
            pinned_content_hash: None,
            bindings: None,
            bound_at: None,
            action: None,
            entry_count: None,
            run_id: None,
            granted: None,
            seq: None,
            grant_jws: None,
            kid: None,
            expires_at: None,
            refused_reason: None,
            countersigned: None,
            countersign_jws: None,
            halt_id: None,
            scope: None,
            scope_key: None,
        };
        assert!(extract_factory_run(&env).is_none());
    }

    #[test]
    fn extract_factory_run_populates_on_complete_envelope() {
        let env = ServerEnvelopeWire {
            kind: "factory.run.request".into(),
            meta: crate::commands::sync_client::ServerMeta {
                v: 1,
                event_id: "e".into(),
                sent_at: "2026-04-21T00:00:00Z".into(),
                correlation_id: None,
                causation_id: None,
                org_cursor: "c".into(),
                org_id: "org-1".into(),
            },
            policy_bundle_id: None,
            summary: None,
            user_id: None,
            change: None,
            details: None,
            project_id: Some("proj-1".into()),
            environment_id: None,
            status: None,
            detail: None,
            pipeline_id: Some("pl-1".into()),
            event_type: None,
            stage_id: None,
            actor: None,
            client_event_id: None,
            reason: None,
            session_id: None,
            server_started_at: None,
            cursor_gap: None,
            adapter: Some("rest".into()),
            actor_user_id: None,
            knowledge: Some(vec![WireKnowledgeBundle {
                object_id: "k1".into(),
                filename: "d.md".into(),
                content_hash: "a".repeat(64),
                download_url: "http://x/k1".into(),
            }]),
            business_docs: None,
            requested_at: None,
            deadline_at: None,
            agent_id: None,
            name: None,
            version: None,
            content_hash: None,
            frontmatter: None,
            body_markdown: None,
            updated_at: None,
            entries: None,
            generated_at: None,
            slug: None,
            description: None,
            org_id: None,
            factory_adapter_id: None,
            detection_level: None,
            repo: None,
            opc_deep_link: None,
            tombstone: None,
            binding_id: None,
            org_agent_id: None,
            agent_name: None,
            pinned_version: None,
            pinned_content_hash: None,
            bindings: None,
            bound_at: None,
            action: None,
            entry_count: None,
            run_id: None,
            granted: None,
            seq: None,
            grant_jws: None,
            kid: None,
            expires_at: None,
            refused_reason: None,
            countersigned: None,
            countersign_jws: None,
            halt_id: None,
            scope: None,
            scope_key: None,
        };
        let run = extract_factory_run(&env).unwrap();
        assert_eq!(run.pipeline_id, "pl-1");
        assert_eq!(run.project_id, "proj-1");
        assert_eq!(run.adapter, "rest");
        assert_eq!(run.knowledge.len(), 1);
    }

    // -----------------------------------------------------------------
    // Spec 124 T056 — full duplex emit sequence (desktop side).
    //
    // The full integration assertion (platform row reaches `status: ok`
    // with all stages recorded) is gated on `OAP_INTEGRATION=1` because
    // it requires a running statecraft + Postgres. The test below covers
    // the desktop's contribution to that path: the order, identity, and
    // payload of every `factory.run.*` envelope a successful run emits.
    // The platform-side assertion lives in
    // `platform/services/statecraft/api/factory/runs.test.ts` and the
    // duplex handler tests under spec 124 Phase 3.
    // -----------------------------------------------------------------

    #[tokio::test(flavor = "multi_thread")]
    async fn run_emitter_full_event_sequence_emits_in_order() {
        use crate::commands::factory_platform::RunEmitter;
        use crate::commands::sync_client::{
            FactoryAgentRef, FactoryRunTokenSpend, FactoryStageOutcome, OutboundFrame,
            SyncClientInner,
        };
        use std::sync::Arc;
        use tokio::sync::mpsc;

        let inner = Arc::new(SyncClientInner::default());
        let (tx, mut rx) = mpsc::channel::<OutboundFrame>(32);
        inner.set_outbound(Some(tx));

        let emitter = RunEmitter::from_inner(inner.clone(), "run-test-1".to_string());

        // Stage 0 — start + complete.
        let agent_s0 = FactoryAgentRef {
            org_agent_id: "ag-0".into(),
            version: 1,
            content_hash: "h-0".into(),
        };
        emitter.stage_started("s0-preflight", agent_s0.clone()).await.unwrap();
        emitter
            .stage_completed("s0-preflight", FactoryStageOutcome::Ok, None)
            .await
            .unwrap();

        // Stage 1 — start + complete.
        let agent_s1 = FactoryAgentRef {
            org_agent_id: "ag-1".into(),
            version: 2,
            content_hash: "h-1".into(),
        };
        emitter
            .stage_started("s1-business-requirements", agent_s1.clone())
            .await
            .unwrap();
        emitter
            .stage_completed("s1-business-requirements", FactoryStageOutcome::Ok, None)
            .await
            .unwrap();

        // Terminal — completed with token spend rollup.
        emitter
            .completed(
                FactoryRunTokenSpend {
                    input: 50,
                    output: 50,
                    total: 100,
                },
                None,
                None,
            )
            .await
            .unwrap();

        // Drain the captured frames in send-order and verify shape.
        let mut frames = Vec::new();
        while let Ok(f) = rx.try_recv() {
            frames.push(f);
        }
        assert_eq!(frames.len(), 5, "expected 5 frames, got {}", frames.len());

        match &frames[0] {
            OutboundFrame::FactoryRunStageStarted {
                run_id,
                stage_id,
                agent_ref,
                ..
            } => {
                assert_eq!(run_id, "run-test-1");
                assert_eq!(stage_id, "s0-preflight");
                assert_eq!(agent_ref, &agent_s0);
            }
            other => panic!("frame 0: expected stage_started, got {other:?}"),
        }
        match &frames[1] {
            OutboundFrame::FactoryRunStageCompleted {
                run_id,
                stage_id,
                stage_outcome,
                error,
                ..
            } => {
                assert_eq!(run_id, "run-test-1");
                assert_eq!(stage_id, "s0-preflight");
                assert_eq!(*stage_outcome, FactoryStageOutcome::Ok);
                assert!(error.is_none());
            }
            other => panic!("frame 1: expected stage_completed, got {other:?}"),
        }
        match &frames[2] {
            OutboundFrame::FactoryRunStageStarted {
                stage_id,
                agent_ref,
                ..
            } => {
                assert_eq!(stage_id, "s1-business-requirements");
                assert_eq!(agent_ref, &agent_s1);
            }
            other => panic!("frame 2: expected stage_started, got {other:?}"),
        }
        match &frames[3] {
            OutboundFrame::FactoryRunStageCompleted {
                stage_id,
                stage_outcome,
                ..
            } => {
                assert_eq!(stage_id, "s1-business-requirements");
                assert_eq!(*stage_outcome, FactoryStageOutcome::Ok);
            }
            other => panic!("frame 3: expected stage_completed, got {other:?}"),
        }
        match &frames[4] {
            OutboundFrame::FactoryRunCompleted {
                run_id,
                token_spend,
                ..
            } => {
                assert_eq!(run_id, "run-test-1");
                assert_eq!(token_spend.total, 100);
            }
            other => panic!("frame 4: expected completed, got {other:?}"),
        }
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn run_emitter_spools_to_disk_when_disconnected() {
        use crate::commands::factory_platform::{
            queue_len, replay_queue, ReplayQueueDirGuard, RunEmitter,
        };
        use crate::commands::sync_client::{
            FactoryAgentRef, FactoryStageOutcome, OutboundFrame, SyncClientInner,
        };
        use std::sync::Arc;
        use tokio::sync::mpsc;

        // Isolate the queue via the synchronised override, held for the
        // whole test so no sibling test can remap it mid-flight and no
        // process-global env is touched.
        let tmp = tempfile::tempdir().unwrap();
        let _guard = ReplayQueueDirGuard::install(tmp.path()).await;

        let inner = Arc::new(SyncClientInner::default());
        // Start disconnected — first emit goes to disk.
        let run_id = "run-spool-1".to_string();
        let emitter = RunEmitter::from_inner(inner.clone(), run_id.clone());

        emitter
            .stage_started(
                "s0",
                FactoryAgentRef {
                    org_agent_id: "ag-0".into(),
                    version: 1,
                    content_hash: "h".into(),
                },
            )
            .await
            .unwrap();
        emitter
            .stage_completed("s0", FactoryStageOutcome::Ok, None)
            .await
            .unwrap();

        assert_eq!(queue_len(&run_id).await, 2, "two events spooled to disk");

        // Reconnect: drain the queue.
        let (tx, mut rx) = mpsc::channel::<OutboundFrame>(8);
        inner.set_outbound(Some(tx));
        let drained = replay_queue(&run_id, &inner).await.unwrap();
        assert_eq!(drained, 2);
        assert_eq!(queue_len(&run_id).await, 0, "queue cleared after replay");

        let mut frames = Vec::new();
        while let Ok(f) = rx.try_recv() {
            frames.push(f);
        }
        assert_eq!(frames.len(), 2, "two frames replayed in order");
        assert!(matches!(
            frames[0],
            OutboundFrame::FactoryRunStageStarted { .. }
        ));
        assert!(matches!(
            frames[1],
            OutboundFrame::FactoryRunStageCompleted { .. }
        ));

        // The override is cleared and the test lock released when
        // `_guard` drops, even if an assertion above panics.
    }
}
