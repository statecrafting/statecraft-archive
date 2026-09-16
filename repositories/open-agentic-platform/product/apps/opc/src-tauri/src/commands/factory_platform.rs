// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Bartek Kus
// Spec: specs/124-opc-factory-run-platform-integration/spec.md
//   - §5 platform fetch replaces the spec-108 in-tree walk-up
//   - §6 reservation flow + duplex emit lifecycle
//   - T050..T055 OPC migration (Phase 5)

//! Bridge between the desktop's factory commands and `factory-platform-client`.
//!
//! Responsibilities of this module:
//!
//!   * Wrap [`StatecraftClient::auth_token`] as an [`OidcTokenProvider`] —
//!     the "no token" path surfaces as `MissingToken`, never as an empty
//!     bearer header.
//!   * Build a `(PlatformClient, AgentResolver, base_url, org_id)` quad
//!     from the desktop's app state in one place so the run-start and
//!     resume paths stay symmetric.
//!   * Resolve every stage's agent reference up-front so a retired binding
//!     fails BEFORE reservation (spec 124 §4.1) with structured info
//!     suitable for a deep-link UI message.
//!   * Reserve the run on the platform, materialise the cache root, and
//!     return a [`PreparedRun`] the caller can hand to `FactoryEngine`.
//!   * Emit `factory.run.*` envelopes through [`SyncClientInner`] and
//!     spool them to an on-disk replay queue when the duplex stream is
//!     disconnected (spec 124 §6 / T053).
//!   * Map [`FactoryClientError`] / [`ResolveError`] into a typed
//!     [`FactoryError`] whose `RetiredAgent` variant carries the data
//!     the UI needs to deep-link the user to the project's binding page.

use async_trait::async_trait;
use chrono::Utc;
use factory_engine::agent_resolver::{
    AgentReference as EngineAgentReference, AgentResolver, ResolveError,
};
use factory_platform_client::{
    walk_process_for_agent_refs, FactoryClientError, OidcTokenProvider, PlatformClient,
    ReserveRunRequest, RunReservation, RunRoot,
};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::Arc;
use tauri::{AppHandle, Manager};
use tokio::io::AsyncBufReadExt;
use uuid::Uuid;

use super::statecraft_client::{StatecraftClient, StatecraftState};
use super::sync_client::{
    FactoryAgentRef, FactoryRunTokenSpend, FactoryStageOutcome, SyncClientInner, SyncClientState,
};

// ---------------------------------------------------------------------------
// FactoryError — typed errors for the desktop factory command surface
// ---------------------------------------------------------------------------

/// Errors returned by the desktop's factory command path (spec 124 Phase 5).
///
/// `Display` for each variant is what the React UI shows to the user; the
/// `RetiredAgent` variant deliberately embeds the deep-link path so the UI
/// can render a clickable affordance without parsing structured fields.
#[derive(Debug, thiserror::Error)]
pub enum FactoryError {
    /// No `StatecraftClient` is loaded — the desktop is not signed in or
    /// has not picked an active workspace.
    #[error("not signed in to statecraft (no active session)")]
    NoStatecraft,

    /// The active statecraft session has no `org_id` populated.
    #[error("no active organization (sign-in incomplete)")]
    NoOrgId,

    /// The OIDC token provider returned no token. UX: prompt the user to
    /// sign in again.
    #[error("missing OIDC access token — please sign in again")]
    MissingToken,

    /// Spec 124 §4.1 / T055 — a project's agent binding points at a row
    /// that has been retired upstream. The UI deep-links the user to the
    /// project's binding management page (`/app/project/{id}/agents`).
    /// `agent_name` may be empty for `ById` references that don't carry a
    /// name in the process definition.
    #[error(
        "agent \"{agent_name}\" ({org_agent_id} v{version}) is retired upstream. \
         Open project bindings: /app/project/{}/agents",
        project_id.as_deref().unwrap_or("<ad-hoc>")
    )]
    RetiredAgent {
        agent_name: String,
        org_agent_id: String,
        version: i64,
        project_id: Option<String>,
    },

    /// Catch-all for other resolver errors (NotFound, AmbiguousName,
    /// VersionMismatch, transport).
    #[error("agent resolver error: {0}")]
    Resolver(String),

    /// `POST /api/factory/runs` failed with a non-RetiredAgent error.
    #[error("factory run reservation failed: {0}")]
    Reservation(String),

    /// Materialisation of the per-run cache root failed.
    #[error("failed to materialise run cache: {0}")]
    Materialisation(String),

    /// Underlying `factory-engine` start/dispatch error.
    #[error("factory engine error: {0}")]
    Engine(String),

    /// Local I/O error (replay queue, project path).
    #[error("io error: {0}")]
    Io(String),

    /// Any other unstructured failure.
    #[error("{0}")]
    Other(String),
}

impl FactoryError {
    /// Convert to a `String` suitable for a Tauri command return value.
    /// `Display` already includes the deep-link for `RetiredAgent`.
    pub fn into_user_message(self) -> String {
        self.to_string()
    }
}

impl From<FactoryClientError> for FactoryError {
    fn from(e: FactoryClientError) -> Self {
        match e {
            FactoryClientError::MissingToken => FactoryError::MissingToken,
            FactoryClientError::TokenProvider(m) => FactoryError::MissingToken
                .also(format!("token provider: {m}"))
                .unwrap_or(FactoryError::Other(format!("token provider: {m}"))),
            FactoryClientError::RetiredAgent(body) => {
                // Server-side path returns a 412 with body shaped like
                //   `agent "<name>" (<org_agent_id> v<version>) is retired upstream`
                // — parse it into the structured variant so the UI can
                // deep-link without string-sniffing.
                parse_retired_agent_body(&body).unwrap_or(FactoryError::Other(format!(
                    "retired agent: {body}"
                )))
            }
            FactoryClientError::AgentDrift(m) => FactoryError::Materialisation(format!(
                "source_shas / resolver drift: {m}"
            )),
            FactoryClientError::Resolver(m) => FactoryError::Resolver(m),
            FactoryClientError::CacheIo(m) => FactoryError::Materialisation(m),
            FactoryClientError::Network(m) => FactoryError::Reservation(format!("network: {m}")),
            FactoryClientError::NotFound(m) => FactoryError::Reservation(format!("not found: {m}")),
            FactoryClientError::Http { status, body } => {
                FactoryError::Reservation(format!("http {status}: {body}"))
            }
            FactoryClientError::Decode(m) => FactoryError::Reservation(format!("decode: {m}")),
            FactoryClientError::InvalidPathComponent { field, value } => {
                // A platform-supplied name (adapter/contract/agent/role) failed
                // the path-component guard in factory-platform-client. Treat it
                // as a materialisation failure so the UI surfaces the rejected
                // value rather than silently proceeding.
                FactoryError::Materialisation(format!(
                    "invalid path component in {field}: {value}"
                ))
            }
        }
    }
}

impl FactoryError {
    /// No-op chain helper to keep the `From<FactoryClientError>` impl tidy.
    fn also(self, _: String) -> Option<FactoryError> {
        Some(self)
    }
}

/// Parse the platform-side `RetiredAgentError.message` body into a typed
/// variant. Format produced by `runAgentRefs.ts`:
///
/// ```text
/// agent "<name>" (<org_agent_id> v<version>) is retired upstream
/// ```
///
/// Returns `None` when the body does not match the expected shape; the
/// caller falls back to a generic [`FactoryError::Other`] in that case.
fn parse_retired_agent_body(body: &str) -> Option<FactoryError> {
    let after_agent = body.strip_prefix("agent \"")?;
    let (name, rest) = after_agent.split_once("\" (")?;
    let (id_and_v, _tail) = rest.split_once(")")?;
    let (org_agent_id, v_part) = id_and_v.split_once(' ')?;
    let version_str = v_part.strip_prefix('v')?;
    let version: i64 = version_str.parse().ok()?;
    Some(FactoryError::RetiredAgent {
        agent_name: name.to_string(),
        org_agent_id: org_agent_id.to_string(),
        version,
        project_id: None,
    })
}

// ---------------------------------------------------------------------------
// OIDC token provider — wraps StatecraftClient::auth_token()
// ---------------------------------------------------------------------------

/// Surfaces the desktop's persisted Rauthy JWT to `factory-platform-client`.
///
/// `StatecraftClient::auth_token()` returns `Option<String>`; this provider
/// converts an empty string to `Ok(None)` so the platform client's
/// `MissingToken` path fires uniformly. The platform client is responsible
/// for refresh policy — see spec 112 §6.3 in `statecraft_client.rs`.
pub struct StatecraftOidcProvider(pub Arc<StatecraftClient>);

#[async_trait]
impl OidcTokenProvider for StatecraftOidcProvider {
    async fn fetch_token(&self) -> Result<Option<String>, FactoryClientError> {
        Ok(self.0.auth_token().filter(|s| !s.is_empty()))
    }
}

// ---------------------------------------------------------------------------
// Platform context — bundle of everything a run start needs
// ---------------------------------------------------------------------------

/// Bundle of dependencies a run-start path needs to talk to the platform.
/// Constructed once via [`platform_context`] and threaded through the rest
/// of the pipeline.
pub struct PlatformContext {
    pub client: PlatformClient,
    pub resolver: AgentResolver,
    pub org_id: String,
    pub base_url: String,
}

/// Build a [`PlatformContext`] from the desktop's app state.
pub fn platform_context(app: &AppHandle) -> Result<PlatformContext, FactoryError> {
    let sc_state = app
        .try_state::<StatecraftState>()
        .ok_or(FactoryError::NoStatecraft)?;
    let sc = sc_state.current().ok_or(FactoryError::NoStatecraft)?;
    let org_id = sc.org_id();
    if org_id.is_empty() {
        return Err(FactoryError::NoOrgId);
    }
    let base_url = sc.base_url().to_string();
    let provider: Arc<dyn OidcTokenProvider> = Arc::new(StatecraftOidcProvider(sc.clone()));
    let client = PlatformClient::new(base_url.clone(), provider);
    let resolver = AgentResolver::new(org_id.clone(), Box::new(client.clone()));
    Ok(PlatformContext {
        client,
        resolver,
        org_id,
        base_url,
    })
}

// ---------------------------------------------------------------------------
// Stage walker — pairs each AgentReference with its owning stage_id
// ---------------------------------------------------------------------------

/// Per-stage agent reference extracted from the process body. The platform
/// client's `walk_process_for_agent_refs` returns a flat list in stage
/// order; this walker preserves the stage_id so the desktop can stamp each
/// `factory.run.stage_started` envelope with the correct `agent_ref`.
///
/// Currently only the `stages: [...]` shape is supported — that is the
/// shape the in-tree process YAML used (spec 108 §6) and the shape the
/// statecraft `factory_processes.definition` mirrors. Unknown shapes
/// degrade to "no agent ref for this stage", which is non-fatal.
pub fn walk_stage_agents(
    process_definition: &serde_json::Value,
) -> Vec<(String, EngineAgentReference)> {
    let mut out = Vec::new();
    let Some(stages) = process_definition.get("stages").and_then(|v| v.as_array()) else {
        return out;
    };
    for stage in stages {
        let Some(stage_id) = stage.get("id").and_then(|v| v.as_str()) else {
            continue;
        };
        let Some(agent_ref) = stage.get("agent_ref") else {
            continue;
        };
        let refs = walk_process_for_agent_refs(agent_ref);
        if let Some(first) = refs.into_iter().next() {
            out.push((stage_id.to_string(), first));
        }
    }
    out
}

/// Extract every stage id from a process definition's `stages: [...]`
/// array, in document order. Unlike [`walk_stage_agents`] this does NOT
/// require a per-stage `agent_ref` — it captures the full structural stage
/// list so the desktop can seed its per-stage tracking and DAG from the
/// platform's process definition rather than a stage list compiled into
/// the client (spec 076). Returns empty for an unrecognised shape; callers
/// fall back to their built-in default in that case.
pub fn walk_stage_ids(process_definition: &serde_json::Value) -> Vec<String> {
    let Some(stages) = process_definition.get("stages").and_then(|v| v.as_array()) else {
        return Vec::new();
    };
    stages
        .iter()
        .filter_map(|s| s.get("id").and_then(|v| v.as_str()))
        // Drop empty-string ids (parity with the TS `stagesFromProcessDefinition`
        // `id.length > 0` guard in types.ts): an empty id would seed a stage
        // tracker that the engine's `factory:step_started` / `gate_reached`
        // events can never match, leaving that stage stuck at `pending` forever.
        .filter(|id| !id.is_empty())
        .map(String::from)
        .collect()
}

// ---------------------------------------------------------------------------
// PreparedRun — the result of a successful platform-side reservation
// ---------------------------------------------------------------------------

/// Result of [`prepare_run_root`]. `engine_factory_root` is the cache path
/// `FactoryEngine::new` consumes via `FactoryEngineConfig.factory_root`;
/// `run_id` is the platform-issued UUID the desktop emits envelopes
/// against.
pub struct PreparedRun {
    pub run_id: String,
    /// The process name the run was reserved against. When the caller
    /// passed an explicit name this echoes it; when it passed none, this
    /// is the name resolved from the platform's process list (spec 124 §6
    /// — the platform owns process naming). Callers use it for audit/log
    /// lines instead of re-deriving the default.
    pub process_name: String,
    pub run_root: RunRoot,
    pub engine_factory_root: PathBuf,
    /// `(stage_id, agent_ref)` pairs in stage order. The desktop stamps
    /// `factory.run.stage_started` with the matching entry by `stage_id`.
    pub stage_agents: Vec<(String, FactoryAgentRef)>,
    /// Same triples by index in `source_shas.agents[]` for downstream
    /// completeness (e.g. token-spend rollup).
    pub source_agents: Vec<FactoryAgentRef>,
    /// Every stage id from the platform process definition, in order
    /// (spec 076). The desktop seeds its per-stage tracking + DAG from this
    /// instead of a hardcoded stage list. Empty when the definition shape is
    /// unrecognised — the caller then falls back to its built-in default.
    pub stage_ids: Vec<String>,
}

impl PreparedRun {
    /// Look up the agent triple for a given stage. Returns `None` for
    /// process definitions that do not embed an `agent_ref:` block under
    /// the stage.
    pub fn agent_for_stage(&self, stage_id: &str) -> Option<FactoryAgentRef> {
        self.stage_agents
            .iter()
            .find(|(sid, _)| sid == stage_id)
            .map(|(_, ar)| ar.clone())
    }
}

/// Reserve a run on the platform, resolve every agent reference (failing
/// fast with [`FactoryError::RetiredAgent`] when applicable), and
/// materialise the per-run cache root.
///
/// Returns a [`PreparedRun`] the caller hands to `FactoryEngine::new`.
pub async fn prepare_run_root(
    ctx: &PlatformContext,
    adapter_name: &str,
    process_name: &str,
    project_id: Option<&str>,
) -> Result<PreparedRun, FactoryError> {
    let client_run_id = Uuid::new_v4().to_string();

    // Spec 124 §6 — the platform owns process naming. When the caller
    // supplies a name (the desktop forwards the bundle's current process
    // name) we use it verbatim. When it supplies none — a no-bundle or
    // programmatic caller — we resolve the name from the platform's
    // process list rather than from a name compiled into the client, so a
    // rename on the platform never requires a desktop rebuild.
    let resolved_process_name: String = if process_name.trim().is_empty() {
        let mut processes = ctx.client.list_processes().await?;
        // `listProcesses` returns name-sorted; sort again so the pick is
        // deterministic regardless of server ordering. Today every org has
        // exactly one process; the first is the default until a process
        // picker lands (spec 124 §6 step 1, Phase 7).
        processes.sort_by(|a, b| a.name.cmp(&b.name));
        processes.into_iter().next().map(|p| p.name).ok_or_else(|| {
            FactoryError::Reservation(
                "no factory process configured for this organization".to_string(),
            )
        })?
    } else {
        process_name.to_string()
    };
    let process_name: &str = &resolved_process_name;

    // Pre-flight resolver walk: catch retired bindings before the server
    // round-trip so the UI deep-link surfaces with full structured info.
    let process = ctx.client.get_process(process_name).await?;
    let stage_pairs = walk_stage_agents(&process.definition);
    let stage_ids = walk_stage_ids(&process.definition);
    for (_stage_id, reference) in &stage_pairs {
        if let Err(e) = ctx.resolver.resolve(reference.clone()).await {
            return Err(map_resolve_err(e, reference, project_id));
        }
    }

    let reservation: RunReservation = ctx
        .client
        .reserve_run(ReserveRunRequest {
            adapter_name: adapter_name.to_string(),
            process_name: process_name.to_string(),
            project_id: project_id.map(String::from),
            client_run_id,
        })
        .await
        .map_err(|e| {
            // The server-side T020 also rejects retired bindings; preserve
            // the structured RetiredAgent path even when the desktop's
            // resolver passed (e.g. cache staleness window).
            let mut err: FactoryError = e.into();
            if let FactoryError::RetiredAgent {
                project_id: ref mut pid,
                ..
            } = err
            {
                *pid = project_id.map(String::from);
            }
            err
        })?;

    let run_root = ctx
        .client
        .materialise_run_root(&reservation, adapter_name, process_name, &ctx.resolver)
        .await
        .map_err(FactoryError::from)?;

    let source_agents: Vec<FactoryAgentRef> = reservation
        .source_shas
        .agents
        .iter()
        .map(|w| FactoryAgentRef {
            org_agent_id: w.org_agent_id.clone(),
            version: w.version,
            content_hash: w.content_hash.clone(),
        })
        .collect();

    // Map walked stage refs to the reservation's resolved triples in
    // stage-order. The two walks match because the materialiser cross-
    // checks them (spec 124 T043) — but be defensive: pair by index, and
    // skip missing entries cleanly.
    let stage_agents: Vec<(String, FactoryAgentRef)> = stage_pairs
        .into_iter()
        .zip(source_agents.iter())
        .map(|((sid, _), triple)| (sid, triple.clone()))
        .collect();

    let engine_factory_root = run_root.path.clone();

    Ok(PreparedRun {
        run_id: reservation.run_id,
        process_name: resolved_process_name,
        run_root,
        engine_factory_root,
        stage_agents,
        source_agents,
        stage_ids,
    })
}

fn map_resolve_err(
    e: ResolveError,
    reference: &EngineAgentReference,
    project_id: Option<&str>,
) -> FactoryError {
    match e {
        ResolveError::RetiredAgent {
            org_agent_id,
            version,
        } => FactoryError::RetiredAgent {
            agent_name: agent_name_from_reference(reference),
            org_agent_id,
            version,
            project_id: project_id.map(String::from),
        },
        ResolveError::NotFound { reference: r } => {
            FactoryError::Resolver(format!("not found: {r}"))
        }
        ResolveError::AmbiguousName { name, count } => {
            FactoryError::Resolver(format!("ambiguous name {name}: {count} matches"))
        }
        ResolveError::VersionMismatch { requested, actual } => FactoryError::Resolver(format!(
            "version mismatch: requested {requested}, catalog has {actual}",
        )),
        ResolveError::Client(c) => FactoryError::Resolver(c.to_string()),
    }
}

fn agent_name_from_reference(r: &EngineAgentReference) -> String {
    match r {
        EngineAgentReference::ById { org_agent_id, .. } => org_agent_id.clone(),
        EngineAgentReference::ByName { name, .. }
        | EngineAgentReference::ByNameLatest { name } => name.clone(),
    }
}

// ---------------------------------------------------------------------------
// On-disk replay queue — spec 124 T053
// ---------------------------------------------------------------------------

/// Maximum events stored per run before the queue is considered overflowed.
/// Exceeding this budget marks the run failed locally (spec 124 T053).
pub const REPLAY_QUEUE_MAX: usize = 1000;

/// Test-only mutex serialising the tests that install a
/// [`REPLAY_QUEUE_DIR_OVERRIDE`]. They share one global override slot, so
/// two running in parallel would clobber each other's temp dir; this lock
/// makes each hold the slot across its `.await` points. A
/// `std::sync::MutexGuard` held across `.await` is a clippy-flagged
/// footgun under a multi-thread tokio runtime, so this is a
/// `tokio::sync::Mutex`.
#[cfg(test)]
static REPLAY_QUEUE_TEST_LOCK: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

/// Test-only override for the replay-queue base directory. Tests set this
/// (via [`ReplayQueueDirGuard`]) instead of mutating the process-global
/// `XDG_DATA_HOME`. Mutating `std::env` for test isolation is a data race
/// against every sibling test that reads any env var concurrently
/// (undefined behaviour in Rust 2024), and the source of the
/// `run_emitter_spools_to_disk` flake that ejected product PRs from the
/// merge queue. A synchronised override touches no global environ table,
/// so that data race is gone.
///
/// The slot is still process-global (as the `XDG_DATA_HOME` it replaces
/// was), so every test that reaches [`replay_queue_dir`] must install it
/// through [`ReplayQueueDirGuard`], which serialises on
/// [`REPLAY_QUEUE_TEST_LOCK`]. An unguarded test driving the queue while a
/// guarded test held the slot would read the guarded test's dir; the guard
/// is the contract that prevents that.
#[cfg(test)]
static REPLAY_QUEUE_DIR_OVERRIDE: std::sync::Mutex<Option<PathBuf>> = std::sync::Mutex::new(None);

/// RAII handle held for the duration of a test that needs an isolated
/// replay-queue directory. Acquires [`REPLAY_QUEUE_TEST_LOCK`] and installs
/// `dir` as the [`REPLAY_QUEUE_DIR_OVERRIDE`]; on drop it clears the
/// override and releases the lock, so a panicking assertion cannot strand
/// a deleted temp dir for a sibling test to read.
#[cfg(test)]
#[must_use = "dropping the guard immediately releases the test lock and clears the queue-dir override, defeating isolation"]
pub struct ReplayQueueDirGuard {
    _lock: tokio::sync::MutexGuard<'static, ()>,
}

#[cfg(test)]
impl ReplayQueueDirGuard {
    /// Serialise on the test lock, then point the replay queue at `dir`.
    pub async fn install(dir: &std::path::Path) -> Self {
        let lock = REPLAY_QUEUE_TEST_LOCK.lock().await;
        *REPLAY_QUEUE_DIR_OVERRIDE
            .lock()
            .unwrap_or_else(|e| e.into_inner()) = Some(dir.to_path_buf());
        Self { _lock: lock }
    }
}

#[cfg(test)]
impl Drop for ReplayQueueDirGuard {
    fn drop(&mut self) {
        *REPLAY_QUEUE_DIR_OVERRIDE
            .lock()
            .unwrap_or_else(|e| e.into_inner()) = None;
    }
}

/// Pure precedence for the replay-queue base directory: explicit
/// `XDG_DATA_HOME` (when non-empty), then the platform data dir, then the
/// system temp dir. Split from [`replay_queue_dir`] so tests exercise the
/// precedence by argument rather than by mutating process-global env. The
/// `data_dir` fallback is a closure so it is not computed when the env
/// branch wins, preserving the original short-circuit.
fn resolve_replay_queue_dir(
    xdg_data_home: Option<&str>,
    data_dir: impl FnOnce() -> Option<PathBuf>,
) -> PathBuf {
    if let Some(explicit) = xdg_data_home.filter(|v| !v.is_empty()) {
        return PathBuf::from(explicit)
            .join("oap")
            .join("factory-run-events");
    }
    if let Some(data) = data_dir() {
        return data.join("oap").join("factory-run-events");
    }
    std::env::temp_dir()
        .join("oap")
        .join("factory-run-events")
}

/// Resolve `$XDG_DATA_HOME/oap/factory-run-events/`. Falls back to
/// `dirs::data_dir()` and finally to a temp directory. In test builds a
/// [`REPLAY_QUEUE_DIR_OVERRIDE`], when set, takes precedence so isolation
/// never depends on mutating process-global env.
pub fn replay_queue_dir() -> PathBuf {
    #[cfg(test)]
    {
        let override_dir = REPLAY_QUEUE_DIR_OVERRIDE
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .clone();
        if let Some(dir) = override_dir {
            return dir.join("oap").join("factory-run-events");
        }
    }
    resolve_replay_queue_dir(
        std::env::var("XDG_DATA_HOME").ok().as_deref(),
        dirs::data_dir,
    )
}

fn replay_queue_path(run_id: &str) -> PathBuf {
    replay_queue_dir().join(format!("{run_id}.ndjson"))
}

fn replay_queue_path_in(dir: &std::path::Path, run_id: &str) -> PathBuf {
    dir.join(format!("{run_id}.ndjson"))
}

/// Persisted shape of a queued frame. The variants mirror the
/// `factory.run.*` `OutboundFrame` set; reconstructed on replay through
/// the typed `send_factory_run_*` helpers so envelope-version drift
/// surfaces at compile time.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum QueuedFrame {
    StageStarted {
        run_id: String,
        stage_id: String,
        agent_ref: FactoryAgentRef,
    },
    StageCompleted {
        run_id: String,
        stage_id: String,
        outcome: FactoryStageOutcome,
        error: Option<String>,
    },
    Completed {
        run_id: String,
        token_spend: FactoryRunTokenSpend,
        /// Spec 198 FR-014 — SHA-256 hex of the governance certificate. When
        /// present, the platform performs a countersign. Grants are NOT spooled
        /// (fail-closed); the certificate hash is spooled so it is presented on
        /// reconnect-replay even if the countersign reply is unavailable.
        #[serde(default)]
        certificate_sha256: Option<String>,
        /// Final grant sequence number at run close (spec 198 FR-014).
        #[serde(default)]
        final_seq: Option<i64>,
    },
    Failed {
        run_id: String,
        error: String,
    },
    Cancelled {
        run_id: String,
        reason: Option<String>,
    },
}

/// Append a single frame line to the run's NDJSON queue. Resolves the
/// queue directory once so a concurrent change to the resolved location
/// between the create-dir and open-file calls cannot strand a write.
pub async fn enqueue_frame(run_id: &str, frame: &QueuedFrame) -> Result<(), FactoryError> {
    use tokio::io::AsyncWriteExt;
    let dir = replay_queue_dir();
    tokio::fs::create_dir_all(&dir)
        .await
        .map_err(|e| FactoryError::Io(format!("create replay dir: {e}")))?;
    let path = replay_queue_path_in(&dir, run_id);
    let mut line = serde_json::to_string(frame)
        .map_err(|e| FactoryError::Io(format!("serialise queued frame: {e}")))?;
    line.push('\n');
    let mut f = tokio::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
        .await
        .map_err(|e| FactoryError::Io(format!("open replay queue {}: {e}", path.display())))?;
    f.write_all(line.as_bytes())
        .await
        .map_err(|e| FactoryError::Io(format!("write replay queue: {e}")))?;
    Ok(())
}

/// Count the number of frames currently spooled for `run_id`. Used to
/// enforce [`REPLAY_QUEUE_MAX`] without loading the whole file.
pub async fn queue_len(run_id: &str) -> usize {
    let path = replay_queue_path(run_id);
    let Ok(file) = tokio::fs::File::open(&path).await else {
        return 0;
    };
    let mut reader = tokio::io::BufReader::new(file);
    let mut line = String::new();
    let mut count = 0usize;
    loop {
        line.clear();
        match reader.read_line(&mut line).await {
            Ok(0) => return count,
            Ok(_) => count += 1,
            Err(_) => return count,
        }
    }
}

/// Replay every queued frame for `run_id` through `sync` and clear the
/// file on success. Frames are emitted in append order to preserve the
/// `(run_id, stage_id, status)` ordering the platform handler expects.
pub async fn replay_queue(run_id: &str, sync: &SyncClientInner) -> Result<usize, FactoryError> {
    let path = replay_queue_path(run_id);
    if !path.exists() {
        return Ok(0);
    }
    let bytes = tokio::fs::read(&path)
        .await
        .map_err(|e| FactoryError::Io(format!("read replay queue: {e}")))?;
    let mut sent = 0usize;
    for line in bytes.split(|b| *b == b'\n') {
        if line.is_empty() {
            continue;
        }
        let frame: QueuedFrame = match serde_json::from_slice(line) {
            Ok(f) => f,
            Err(e) => {
                log::warn!(
                    "replay_queue: dropping malformed line in {}: {e}",
                    path.display()
                );
                continue;
            }
        };
        if !dispatch_queued(sync, &frame).await {
            // Still disconnected — stop replay and leave the queue intact
            // so the next reconnect tries again.
            return Ok(sent);
        }
        sent += 1;
    }
    let _ = tokio::fs::remove_file(&path).await;
    Ok(sent)
}

async fn dispatch_queued(sync: &SyncClientInner, frame: &QueuedFrame) -> bool {
    match frame {
        QueuedFrame::StageStarted {
            run_id,
            stage_id,
            agent_ref,
        } => {
            sync.send_factory_run_stage_started(run_id, stage_id, agent_ref.clone())
                .await
        }
        QueuedFrame::StageCompleted {
            run_id,
            stage_id,
            outcome,
            error,
        } => {
            sync.send_factory_run_stage_completed(run_id, stage_id, *outcome, error.clone())
                .await
        }
        QueuedFrame::Completed {
            run_id,
            token_spend,
            certificate_sha256,
            final_seq,
        } => {
            // Replay path: emit completed with the cert hash if present so
            // the platform records it even without a live countersign reply.
            use super::sync_client::{OutboundFrame, new_meta};
            let frame = OutboundFrame::FactoryRunCompleted {
                meta: new_meta(),
                run_id: run_id.clone(),
                token_spend: token_spend.clone(),
                completed_at: now_iso(),
                certificate_sha256: certificate_sha256.clone(),
                seq: *final_seq,
            };
            sync.send(frame).await
        }
        QueuedFrame::Failed { run_id, error } => {
            sync.send_factory_run_failed(run_id, error.clone()).await
        }
        QueuedFrame::Cancelled { run_id, reason } => {
            sync.send_factory_run_cancelled(run_id, reason.clone()).await
        }
    }
}

/// Convert a `factory.run.grant` server reply into a typed [`GrantOutcome`].
fn map_grant_reply(
    reply: super::sync_client::ServerEnvelopeWire,
) -> Result<GrantOutcome, FactoryError> {
    match reply.granted {
        Some(true) => Ok(GrantOutcome::Granted {
            seq: reply.seq.unwrap_or(0),
            grant_jws: reply.grant_jws.unwrap_or_default(),
            kid: reply.kid.unwrap_or_default(),
            expires_at: reply.expires_at,
        }),
        _ => Ok(GrantOutcome::Refused {
            reason: reply
                .refused_reason
                .unwrap_or_else(|| "no reason provided".to_string()),
            detail: reply.detail,
        }),
    }
}

// ---------------------------------------------------------------------------
// Spec 198 FR-005 / FR-014 — grant / countersign outcome types
// ---------------------------------------------------------------------------

/// Outcome of a `factory.run.grant_request` or `factory.run.grant_renew`.
/// Returned by [`RunEmitter::request_grant`] and [`RunEmitter::renew_grant`].
#[derive(Debug, Clone)]
pub enum GrantOutcome {
    /// Grant issued. `seq` is the monotonically-increasing sequence number
    /// the server assigned; present on every successful grant.
    Granted {
        seq: i64,
        grant_jws: String,
        kid: String,
        expires_at: Option<String>,
    },
    /// Server refused the grant request. The run must halt fail-closed.
    Refused {
        reason: String,
        /// Optional additional detail from the server.
        detail: Option<String>,
    },
}

/// Outcome of the certificate countersign embedded in
/// [`RunEmitter::completed`]. `None` is returned when the emitter was
/// disconnected and could not perform a live countersign exchange.
#[derive(Debug, Clone)]
pub struct CountersignOutcome {
    pub countersigned: bool,
    pub countersign_jws: Option<String>,
    pub kid: Option<String>,
    pub refused_reason: Option<String>,
}

/// Arguments for [`RunEmitter::request_grant`] (spec 198 FR-005).
pub struct GrantRequestArgs<'a> {
    pub goal_id: &'a str,
    pub goal: &'a str,
    pub capsule_hash: &'a str,
    pub envelope_hash: &'a str,
    pub build_spec_hash: Option<&'a str>,
    pub project_id: Option<&'a str>,
    pub constraints: Option<Vec<String>>,
}

/// Arguments for [`RunEmitter::renew_grant`] (spec 198 FR-005).
pub struct GrantRenewArgs<'a> {
    pub goal_id: &'a str,
    pub capsule_hash: &'a str,
    pub seq: i64,
    pub stage_id: Option<&'a str>,
    /// Spec 208 FR-001: agent profile (org_agent_id) about to run this stage,
    /// resolved from the reservation-time stage-agent map; drives
    /// agent-profile-scoped org-halt renewal refusal (AC-3).
    pub agent_profile: Option<&'a str>,
    pub build_spec_hash: Option<&'a str>,
}

// ---------------------------------------------------------------------------
// Run emitter — sends a frame, falls back to the on-disk queue on failure
// ---------------------------------------------------------------------------

/// Owns the duplex handle + the local replay queue for a single in-flight
/// run. Cloning is cheap — only the `Arc<SyncClientInner>` and `String`
/// are duplicated.
#[derive(Clone)]
pub struct RunEmitter {
    sync: Arc<SyncClientInner>,
    run_id: String,
    /// Set when the queue overflows ([`REPLAY_QUEUE_MAX`]) so subsequent
    /// emits stop spooling — a flooded run is already failed locally.
    overflowed: Arc<std::sync::atomic::AtomicBool>,
}

impl RunEmitter {
    pub fn new(app: &AppHandle, run_id: String) -> Result<Self, FactoryError> {
        let sync_state = app
            .try_state::<SyncClientState>()
            .ok_or_else(|| FactoryError::Other("SyncClientState not managed".into()))?;
        Ok(Self {
            sync: sync_state.handle(),
            run_id,
            overflowed: Arc::new(std::sync::atomic::AtomicBool::new(false)),
        })
    }

    /// Test seam: build an emitter from an explicit `SyncClientInner`
    /// without going through Tauri state. The integration tests in
    /// `commands/factory.rs` use this to drive a full
    /// stage_started → stage_completed → completed sequence against a
    /// captured outbound channel.
    #[doc(hidden)]
    pub fn from_inner(sync: Arc<SyncClientInner>, run_id: String) -> Self {
        Self {
            sync,
            run_id,
            overflowed: Arc::new(std::sync::atomic::AtomicBool::new(false)),
        }
    }

    pub fn run_id(&self) -> &str {
        &self.run_id
    }

    pub fn overflowed(&self) -> bool {
        self.overflowed.load(std::sync::atomic::Ordering::Acquire)
    }

    async fn try_send_or_queue(&self, frame: QueuedFrame) -> Result<(), FactoryError> {
        if self.overflowed() {
            return Err(FactoryError::Other(format!(
                "run {} replay queue overflowed (>{} events)",
                self.run_id, REPLAY_QUEUE_MAX
            )));
        }
        let sent = dispatch_queued(&self.sync, &frame).await;
        if sent {
            return Ok(());
        }
        // Disconnected — spool to disk. Cap enforced before writing.
        let current = queue_len(&self.run_id).await;
        if current >= REPLAY_QUEUE_MAX {
            self.overflowed
                .store(true, std::sync::atomic::Ordering::Release);
            return Err(FactoryError::Other(format!(
                "run {} replay queue overflowed (>{} events)",
                self.run_id, REPLAY_QUEUE_MAX
            )));
        }
        enqueue_frame(&self.run_id, &frame).await
    }

    pub async fn stage_started(
        &self,
        stage_id: &str,
        agent_ref: FactoryAgentRef,
    ) -> Result<(), FactoryError> {
        self.try_send_or_queue(QueuedFrame::StageStarted {
            run_id: self.run_id.clone(),
            stage_id: stage_id.to_string(),
            agent_ref,
        })
        .await
    }

    pub async fn stage_completed(
        &self,
        stage_id: &str,
        outcome: FactoryStageOutcome,
        error: Option<String>,
    ) -> Result<(), FactoryError> {
        self.try_send_or_queue(QueuedFrame::StageCompleted {
            run_id: self.run_id.clone(),
            stage_id: stage_id.to_string(),
            outcome,
            error,
        })
        .await
    }

    /// Spec 198 FR-005 — request the initial run-grant from the platform.
    /// Fail-closed: a disconnected duplex or a 30-second timeout returns `Err`.
    /// Grants are NOT spooled to the replay queue.
    pub async fn request_grant(
        &self,
        args: GrantRequestArgs<'_>,
    ) -> Result<GrantOutcome, FactoryError> {
        use super::sync_client::{EnvelopeMeta, OutboundFrame};
        let event_id = uuid::Uuid::new_v4().to_string();
        let frame = OutboundFrame::FactoryRunGrantRequest {
            meta: EnvelopeMeta {
                v: super::sync_client::ENVELOPE_SCHEMA_VERSION,
                event_id: event_id.clone(),
                sent_at: now_iso(),
                correlation_id: None,
                causation_id: None,
            },
            run_id: self.run_id.clone(),
            goal_id: args.goal_id.to_string(),
            goal: args.goal.to_string(),
            capsule_hash: args.capsule_hash.to_string(),
            envelope_hash: args.envelope_hash.to_string(),
            build_spec_hash: args.build_spec_hash.map(str::to_string),
            project_id: args.project_id.map(str::to_string),
            constraints: args.constraints,
        };
        let reply = self
            .sync
            .send_and_await_reply(frame, event_id)
            .await
            .map_err(FactoryError::Other)?;
        map_grant_reply(reply)
    }

    /// Spec 198 FR-005 — renew the run-grant at a stage boundary.
    /// Fail-closed: same semantics as `request_grant`.
    /// Grants are NOT spooled to the replay queue.
    pub async fn renew_grant(
        &self,
        args: GrantRenewArgs<'_>,
    ) -> Result<GrantOutcome, FactoryError> {
        use super::sync_client::{EnvelopeMeta, OutboundFrame};
        let event_id = uuid::Uuid::new_v4().to_string();
        let frame = OutboundFrame::FactoryRunGrantRenew {
            meta: EnvelopeMeta {
                v: super::sync_client::ENVELOPE_SCHEMA_VERSION,
                event_id: event_id.clone(),
                sent_at: now_iso(),
                correlation_id: None,
                causation_id: None,
            },
            run_id: self.run_id.clone(),
            goal_id: args.goal_id.to_string(),
            capsule_hash: args.capsule_hash.to_string(),
            seq: args.seq,
            stage_id: args.stage_id.map(str::to_string),
            agent_profile: args.agent_profile.map(str::to_string),
            build_spec_hash: args.build_spec_hash.map(str::to_string),
        };
        let reply = self
            .sync
            .send_and_await_reply(frame, event_id)
            .await
            .map_err(FactoryError::Other)?;
        map_grant_reply(reply)
    }

    /// Spec 124 §6.1 / Spec 198 FR-014 — terminal success.
    ///
    /// When `certificate_sha256` and `final_seq` are supplied, sends a
    /// `factory.run.completed` that requests a certificate countersign from
    /// the platform and awaits the reply. The countersign is fire-and-forget
    /// on failure (log, do not fail the run).
    ///
    /// Returns `Ok(Some(CountersignOutcome))` when a live reply was received,
    /// `Ok(None)` when the stream was disconnected (frame was spooled without
    /// a countersign attempt).
    pub async fn completed(
        &self,
        token_spend: FactoryRunTokenSpend,
        certificate_sha256: Option<String>,
        final_seq: Option<i64>,
    ) -> Result<Option<CountersignOutcome>, FactoryError> {
        // If we have cert fields, use send_and_await_reply so the platform
        // can countersign. If the stream is disconnected, fall back to the
        // normal spool path (no countersign on replay).
        if certificate_sha256.is_some() || final_seq.is_some() {
            use super::sync_client::{EnvelopeMeta, OutboundFrame};
            let event_id = uuid::Uuid::new_v4().to_string();
            let frame = OutboundFrame::FactoryRunCompleted {
                meta: EnvelopeMeta {
                    v: super::sync_client::ENVELOPE_SCHEMA_VERSION,
                    event_id: event_id.clone(),
                    sent_at: now_iso(),
                    correlation_id: None,
                    causation_id: None,
                },
                run_id: self.run_id.clone(),
                token_spend: token_spend.clone(),
                completed_at: now_iso(),
                certificate_sha256: certificate_sha256.clone(),
                seq: final_seq,
            };
            match self.sync.send_and_await_reply(frame, event_id).await {
                Ok(reply) => {
                    let outcome = CountersignOutcome {
                        countersigned: reply.countersigned.unwrap_or(false),
                        countersign_jws: reply.countersign_jws,
                        kid: reply.kid,
                        refused_reason: reply.refused_reason,
                    };
                    return Ok(Some(outcome));
                }
                Err(e) => {
                    // Disconnected or timed out — spool the frame (without a
                    // live countersign) and log. The cert hash is preserved in
                    // the queued frame so the platform records it on replay.
                    log::warn!(
                        "factory_platform: countersign send_and_await_reply failed ({e}); \
                         spooling completed frame without live countersign"
                    );
                    self.try_send_or_queue(QueuedFrame::Completed {
                        run_id: self.run_id.clone(),
                        token_spend,
                        certificate_sha256,
                        final_seq,
                    })
                    .await?;
                    return Ok(None);
                }
            }
        }
        self.try_send_or_queue(QueuedFrame::Completed {
            run_id: self.run_id.clone(),
            token_spend,
            certificate_sha256: None,
            final_seq: None,
        })
        .await?;
        Ok(None)
    }

    pub async fn failed(&self, error: String) -> Result<(), FactoryError> {
        self.try_send_or_queue(QueuedFrame::Failed {
            run_id: self.run_id.clone(),
            error,
        })
        .await
    }

    pub async fn cancelled(&self, reason: Option<String>) -> Result<(), FactoryError> {
        self.try_send_or_queue(QueuedFrame::Cancelled {
            run_id: self.run_id.clone(),
            reason,
        })
        .await
    }

    /// Best-effort drain of any leftover frames after the duplex stream
    /// reconnects. Called from reconnect handlers; safe to invoke even
    /// when nothing is queued.
    pub async fn drain(&self) -> Result<usize, FactoryError> {
        replay_queue(&self.run_id, &self.sync).await
    }
}

// ---------------------------------------------------------------------------
// ISO timestamp helper — kept here so the duplex helpers in this file
// don't pull a chrono dep through commands/factory.rs.
// ---------------------------------------------------------------------------

pub fn now_iso() -> String {
    Utc::now().format("%Y-%m-%dT%H:%M:%SZ").to_string()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn parse_retired_agent_body_extracts_triple() {
        let body = "agent \"extract\" (org-agent-1 v3) is retired upstream";
        let err = parse_retired_agent_body(body).unwrap();
        match err {
            FactoryError::RetiredAgent {
                agent_name,
                org_agent_id,
                version,
                project_id,
            } => {
                assert_eq!(agent_name, "extract");
                assert_eq!(org_agent_id, "org-agent-1");
                assert_eq!(version, 3);
                assert!(project_id.is_none());
            }
            other => panic!("expected RetiredAgent, got {other:?}"),
        }
    }

    #[test]
    fn parse_retired_agent_body_returns_none_for_garbage() {
        assert!(parse_retired_agent_body("not a retired-agent body").is_none());
        assert!(parse_retired_agent_body("agent \"x\"").is_none());
    }

    #[test]
    fn walk_stage_agents_pairs_stage_with_first_ref() {
        let proc_def = json!({
            "stages": [
                { "id": "s0", "agent_ref": { "by_name_latest": { "name": "extract" } } },
                { "id": "s1", "agent_ref": { "by_name": { "name": "design", "version": 2 } } },
            ]
        });
        let pairs = walk_stage_agents(&proc_def);
        assert_eq!(pairs.len(), 2);
        assert_eq!(pairs[0].0, "s0");
        assert_eq!(pairs[1].0, "s1");
    }

    #[test]
    fn walk_stage_agents_skips_stages_without_agent_ref() {
        let proc_def = json!({
            "stages": [
                { "id": "s0" },
                { "id": "s1", "agent_ref": { "by_name_latest": { "name": "design" } } },
            ]
        });
        let pairs = walk_stage_agents(&proc_def);
        assert_eq!(pairs.len(), 1);
        assert_eq!(pairs[0].0, "s1");
    }

    #[test]
    fn walk_stage_ids_collects_ids_in_document_order() {
        let proc_def = json!({
            "stages": [
                { "id": "s0-preflight" },
                { "id": "s1-business-requirements" },
            ]
        });
        assert_eq!(
            walk_stage_ids(&proc_def),
            vec![
                "s0-preflight".to_string(),
                "s1-business-requirements".to_string(),
            ]
        );
    }

    #[test]
    fn walk_stage_ids_skips_empty_and_missing_ids_parity_with_ts() {
        // Parity with the TS `stagesFromProcessDefinition` (types.ts), which
        // guards `id.length > 0`. An empty-string id must be dropped — seeding
        // it as a stage tracker would leave a stage the engine's events can
        // never match stuck at `pending` forever. Stages with no `id` at all
        // are likewise skipped.
        let proc_def = json!({
            "stages": [
                { "id": "s0" },
                { "id": "" },
                { "no_id": true },
                { "id": "s1" },
            ]
        });
        assert_eq!(
            walk_stage_ids(&proc_def),
            vec!["s0".to_string(), "s1".to_string()]
        );
    }

    #[test]
    fn factory_error_retired_agent_message_includes_deep_link() {
        let err = FactoryError::RetiredAgent {
            agent_name: "extract".into(),
            org_agent_id: "ag-1".into(),
            version: 2,
            project_id: Some("p-1".into()),
        };
        let s = err.to_string();
        assert!(s.contains("extract"));
        assert!(s.contains("ag-1"));
        assert!(s.contains("v2"));
        assert!(s.contains("/app/project/p-1/agents"));
    }

    #[test]
    fn factory_error_retired_agent_ad_hoc_run_renders_placeholder() {
        let err = FactoryError::RetiredAgent {
            agent_name: "extract".into(),
            org_agent_id: "ag-1".into(),
            version: 2,
            project_id: None,
        };
        let s = err.to_string();
        assert!(s.contains("/app/project/<ad-hoc>/agents"));
    }

    #[test]
    fn replay_queue_dir_honours_xdg_data_home() {
        // Exercise the pure precedence resolver directly: no process-global
        // env mutation, so nothing to race against or restore. The data-dir
        // fallback is a closure so it is never invoked when XDG wins.
        assert_eq!(
            resolve_replay_queue_dir(Some("/tmp/oap-test-data"), || None),
            PathBuf::from("/tmp/oap-test-data")
                .join("oap")
                .join("factory-run-events")
        );
        // An empty XDG_DATA_HOME falls through to the platform data dir.
        assert_eq!(
            resolve_replay_queue_dir(Some(""), || Some(PathBuf::from("/data"))),
            PathBuf::from("/data").join("oap").join("factory-run-events")
        );
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn replay_queue_dir_returns_installed_override() {
        // Drive the public entrypoint (not just the pure resolver) so the
        // #[cfg(test)] override branch and its path join stay covered.
        let tmp = tempfile::tempdir().unwrap();
        let _guard = ReplayQueueDirGuard::install(tmp.path()).await;
        assert_eq!(
            replay_queue_dir(),
            tmp.path().join("oap").join("factory-run-events")
        );
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn enqueue_then_count_matches_appended_lines() {
        let tmp = tempfile::tempdir().unwrap();
        // Isolate the queue via the synchronised override, not env.
        let _guard = ReplayQueueDirGuard::install(tmp.path()).await;
        let run_id = "test-run-enqueue";
        let frame = QueuedFrame::Failed {
            run_id: run_id.to_string(),
            error: "boom".into(),
        };
        for _ in 0..3 {
            enqueue_frame(run_id, &frame).await.unwrap();
        }
        assert_eq!(queue_len(run_id).await, 3);
    }

    // ── Spec 198 FR-005 — wire-field-name contract tests ─────────────────────
    //
    // The platform handler parses outbound grant frames by the exact camelCase
    // field names defined in `platform/services/statecraft/api/sync/types.ts`.
    // These tests lock those names at compile time on the Rust side so a rename
    // or typo surfaces here rather than as a silent wire mismatch.

    #[test]
    fn grant_request_frame_serializes_with_exact_wire_field_names() {
        use crate::commands::sync_client::{EnvelopeMeta, OutboundFrame, ENVELOPE_SCHEMA_VERSION};
        let frame = OutboundFrame::FactoryRunGrantRequest {
            meta: EnvelopeMeta {
                v: ENVELOPE_SCHEMA_VERSION,
                event_id: "e-1".into(),
                sent_at: "2026-06-09T00:00:00Z".into(),
                correlation_id: None,
                causation_id: None,
            },
            run_id: "run-1".into(),
            goal_id: "goal-abcd1234abcd1234".into(),
            goal: "build the portal".into(),
            capsule_hash: "cap-hash".into(),
            envelope_hash: "env-hash".into(),
            build_spec_hash: Some("bs-hash".into()),
            project_id: Some("proj-1".into()),
            constraints: Some(vec!["no-deploy-without-gate".into()]),
        };
        let json = serde_json::to_value(&frame).unwrap();
        // Exact wire field names (camelCase as defined in types.ts).
        assert_eq!(json["kind"], "factory.run.grant_request");
        assert_eq!(json["runId"], "run-1");
        assert_eq!(json["goalId"], "goal-abcd1234abcd1234");
        assert_eq!(json["goal"], "build the portal");
        assert_eq!(json["capsuleHash"], "cap-hash");
        assert_eq!(json["envelopeHash"], "env-hash");
        assert_eq!(json["buildSpecHash"], "bs-hash");
        assert_eq!(json["projectId"], "proj-1");
        assert_eq!(json["constraints"][0], "no-deploy-without-gate");
    }

    #[test]
    fn grant_renew_frame_serializes_with_exact_wire_field_names() {
        use crate::commands::sync_client::{EnvelopeMeta, OutboundFrame, ENVELOPE_SCHEMA_VERSION};
        let frame = OutboundFrame::FactoryRunGrantRenew {
            meta: EnvelopeMeta {
                v: ENVELOPE_SCHEMA_VERSION,
                event_id: "e-2".into(),
                sent_at: "2026-06-09T00:00:01Z".into(),
                correlation_id: None,
                causation_id: None,
            },
            run_id: "run-1".into(),
            goal_id: "goal-abcd1234abcd1234".into(),
            capsule_hash: "cap-hash".into(),
            seq: 2,
            stage_id: Some("phase-2".into()),
            agent_profile: Some("api-scaffolder".into()),
            build_spec_hash: Some("bs-hash".into()),
        };
        let json = serde_json::to_value(&frame).unwrap();
        assert_eq!(json["kind"], "factory.run.grant_renew");
        assert_eq!(json["runId"], "run-1");
        assert_eq!(json["goalId"], "goal-abcd1234abcd1234");
        assert_eq!(json["capsuleHash"], "cap-hash");
        assert_eq!(json["seq"], 2);
        assert_eq!(json["stageId"], "phase-2");
        // Spec 208 FR-001/AC-3: the agent profile rides the exact camelCase wire
        // name the server reads (grantDuplexHandlers.ts evt.agentProfile).
        assert_eq!(json["agentProfile"], "api-scaffolder");
        assert_eq!(json["buildSpecHash"], "bs-hash");
    }
}
