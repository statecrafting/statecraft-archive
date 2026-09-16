//! Duplex sync consumer for the statecraft control plane (spec 110 Phase 2).
//!
//! Opens the authenticated `/api/sync/duplex` WebSocket, performs the
//! handshake via query parameters (the Encore stream convention), and runs
//! a resilient read/write loop:
//!
//!   - Receives `ServerEnvelope` frames and routes them through a
//!     registration-based dispatch table. Unknown kinds log and no-op so
//!     this bootstraps safely ahead of spec 110 §4 and spec 111.
//!   - Answers `sync.heartbeat` frames with matching client heartbeats and
//!     records the last observed workspace cursor.
//!   - Auto-reconnects with exponential backoff on disconnect; passes the
//!     last observed cursor back as `lastServerCursor` on reconnect so the
//!     server can detect gaps (see 087 §5.3, duplex.ts).
//!
//! Authority invariant (087 §5.3): the desktop MUST NOT forge
//! `ServerEnvelope` frames. This module is read/ack/dispatch only. Outbound
//! traffic is limited to `sync.heartbeat`, `sync.ack`, and `sync.resync_request`;
//! progress envelopes like `execution.status` live on the StatecraftClient
//! HTTP path today and will migrate to this stream in a later phase.

use futures_util::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, RwLock};
use std::time::Duration;
use tokio::net::TcpStream;
use tokio::sync::{Mutex, mpsc, oneshot};
use tokio::task::JoinHandle;
use tokio::time::interval;
use tokio_tungstenite::tungstenite::client::IntoClientRequest;
use tokio_tungstenite::tungstenite::protocol::Message;
use tokio_tungstenite::{MaybeTlsStream, WebSocketStream};

use super::statecraft_client::StatecraftClient;

/// The duplex protocol version this client speaks. Must match
/// `ENVELOPE_SCHEMA_VERSION` in `platform/services/statecraft/api/sync/types.ts`,
/// which spec 119 bumped to **v2** when it collapsed the duplex session key
/// from `workspaceId` to `orgId`. The desktop already carries the v2 *struct*
/// shapes (`ServerMeta.org_cursor` / `org_id`), but this constant lagged at 1,
/// so every server frame failed the `is_server_envelope` version check and
/// `sync.hello` was never received. That was silent before spec 183, then a
/// hard boot-gate block once FR-T2(b) gated the cockpit on `sync.hello`
/// receipt. Bumping to 2 restores parity with the deployed server.
pub const ENVELOPE_SCHEMA_VERSION: u8 = 2;

/// Spec 123 §7 — per-event-kind contract version constants. Mirror the TS
/// counterparts in `platform/services/statecraft/api/sync/types.ts`. Kept as
/// `pub const` so a desktop / platform skew on the catalog or binding
/// payload contract surfaces as a build-time mismatch (Rust-side tests
/// reference these constants directly; TS-side handlers reference the TS
/// ones).
pub const AGENT_CATALOG_ENVELOPE_VERSION: u8 = 2;
pub const PROJECT_AGENT_BINDING_ENVELOPE_VERSION: u8 = 1;

/// Spec 124 §6.1 — per-event-kind contract version for the `factory.run.*`
/// lifecycle envelope family (stage_started, stage_completed, completed,
/// failed, cancelled). Mirrors the TS constant `FACTORY_RUN_ENVELOPE_VERSION`
/// in `platform/services/statecraft/api/sync/types.ts`. A desktop / platform
/// skew on this constant surfaces as a Rust build error before any wire
/// drift is possible.
pub const FACTORY_RUN_ENVELOPE_VERSION: u8 = 1;

/// Spec 198 FR-005 / FR-014 — per-event-kind contract version for the
/// `factory.run.grant` and `factory.run.certificate_countersign` envelope
/// family. Mirrors `FACTORY_RUN_GRANT_ENVELOPE_VERSION` in
/// `platform/services/statecraft/api/sync/types.ts`. A desktop / platform
/// skew on this constant surfaces as a Rust build error.
/// v2 (spec 208 FR-001): `factory.run.grant_renew` gains optional
/// `agent_profile` for agent-profile-scoped org-halt renewal refusal (AC-3).
pub const FACTORY_RUN_GRANT_ENVELOPE_VERSION: u8 = 2;

/// Spec 208 FR-001/FR-003: per-event-kind contract version for the org-halt
/// envelope family (`org.halt.activated`, `org.halt.lifted`, `org.halt.ack`).
/// Mirrors `ORG_HALT_ENVELOPE_VERSION` in
/// `platform/services/statecraft/api/sync/types.ts`. A desktop / platform skew
/// on this constant surfaces as a Rust build error (the
/// `org_halt_envelope_version_matches_documented_constant` lock test) before
/// any wire drift is possible (spec 189 parity discipline).
pub const ORG_HALT_ENVELOPE_VERSION: u8 = 1;

// ---------------------------------------------------------------------------
// Wire-level envelope types (mirror the typescript wire shapes)
// ---------------------------------------------------------------------------

/// Envelope meta carried by every frame on the stream.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EnvelopeMeta {
    /// Schema version — strict equality with [`ENVELOPE_SCHEMA_VERSION`].
    pub v: u8,
    pub event_id: String,
    pub sent_at: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub correlation_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub causation_id: Option<String>,
}

/// Meta on server-originated envelopes — extends [`EnvelopeMeta`] with the
/// org cursor and org id the server assigned (spec 119 collapsed the former
/// `workspace` session key to `org`).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ServerMeta {
    pub v: u8,
    pub event_id: String,
    pub sent_at: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub correlation_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub causation_id: Option<String>,
    pub org_cursor: String,
    pub org_id: String,
}

/// Flat counterpart of `ServerEnvelopeWire` in
/// `platform/services/statecraft/api/sync/types.ts`.
///
/// All payload fields are optional because a single concrete frame only
/// populates the subset relevant to its `kind`. Callers narrow by reading
/// `kind` first.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ServerEnvelopeWire {
    pub kind: String,
    pub meta: ServerMeta,
    #[serde(default)]
    pub policy_bundle_id: Option<String>,
    #[serde(default)]
    pub summary: Option<String>,
    #[serde(default)]
    pub user_id: Option<String>,
    #[serde(default)]
    pub change: Option<String>,
    #[serde(default)]
    pub details: Option<Value>,
    #[serde(default)]
    pub project_id: Option<String>,
    #[serde(default)]
    pub environment_id: Option<String>,
    #[serde(default)]
    pub status: Option<String>,
    #[serde(default)]
    pub detail: Option<String>,
    #[serde(default)]
    pub pipeline_id: Option<String>,
    #[serde(default)]
    pub event_type: Option<String>,
    #[serde(default)]
    pub stage_id: Option<String>,
    #[serde(default)]
    pub actor: Option<String>,
    #[serde(default)]
    pub client_event_id: Option<String>,
    #[serde(default)]
    pub reason: Option<String>,
    #[serde(default)]
    pub session_id: Option<String>,
    #[serde(default)]
    pub server_started_at: Option<String>,
    #[serde(default)]
    pub cursor_gap: Option<bool>,
    // spec 110 §2.1 — factory.run.request fields
    #[serde(default)]
    pub adapter: Option<String>,
    #[serde(default)]
    pub actor_user_id: Option<String>,
    #[serde(default)]
    pub knowledge: Option<Vec<KnowledgeBundle>>,
    #[serde(default)]
    pub business_docs: Option<Vec<EnvelopeBusinessDoc>>,
    #[serde(default)]
    pub requested_at: Option<String>,
    #[serde(default)]
    pub deadline_at: Option<String>,
    // spec 111 §2.3 — agent.catalog.updated / agent.catalog.snapshot fields.
    // Bodies and frontmatter are decoded as `serde_json::Value` because the
    // `CatalogFrontmatter` TS type is an `UnifiedFrontmatter & { [k]: unknown }`
    // union whose `extra` flatten keys are opaque to the Rust decoder; the
    // desktop cache preserves them through the JSONB round-trip.
    #[serde(default)]
    pub agent_id: Option<String>,
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub version: Option<u32>,
    #[serde(default)]
    pub content_hash: Option<String>,
    #[serde(default)]
    pub frontmatter: Option<Value>,
    #[serde(default)]
    pub body_markdown: Option<String>,
    #[serde(default)]
    pub updated_at: Option<String>,
    #[serde(default)]
    pub entries: Option<Vec<AgentCatalogSnapshotEntry>>,
    #[serde(default)]
    pub generated_at: Option<String>,
    // spec 112 §7 — project.catalog.upsert fields.
    #[serde(default)]
    pub slug: Option<String>,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub org_id: Option<String>,
    #[serde(default)]
    pub factory_adapter_id: Option<String>,
    #[serde(default)]
    pub detection_level: Option<String>,
    #[serde(default)]
    pub repo: Option<ProjectCatalogRepo>,
    #[serde(default)]
    pub opc_deep_link: Option<String>,
    #[serde(default)]
    pub tombstone: Option<bool>,
    // spec 123 §7.2 — project.agent_binding.updated fields.
    #[serde(default)]
    pub binding_id: Option<String>,
    #[serde(default)]
    pub org_agent_id: Option<String>,
    #[serde(default)]
    pub agent_name: Option<String>,
    #[serde(default)]
    pub pinned_version: Option<i32>,
    #[serde(default)]
    pub pinned_content_hash: Option<String>,
    // spec 123 §7.2 — project.agent_binding.snapshot fields.
    #[serde(default)]
    pub bindings: Option<Vec<ProjectAgentBindingSnapshotEntry>>,
    #[serde(default)]
    pub bound_at: Option<String>,
    // spec 123 §7.1 — AgentCatalogSnapshot also carries org_id on the envelope
    // itself (mirrored from meta.org_id for convenience). Shared with project
    // catalog upsert via the existing `org_id` field above.
    // `action` is used by project.agent_binding.updated.
    #[serde(default)]
    pub action: Option<String>,
    // spec 112 §7 amendment — project.catalog.snapshot.complete `entryCount`
    // (informational count of upsert frames in the just-finished pass).
    #[serde(default)]
    pub entry_count: Option<u32>,
    // Spec 198 FR-005 / FR-014 — factory.run.grant and
    // factory.run.certificate_countersign reply fields.
    #[serde(default)]
    pub run_id: Option<String>,
    #[serde(default)]
    pub granted: Option<bool>,
    /// Monotonically-increasing grant sequence number. TS `number` → Rust `i64`.
    #[serde(default)]
    pub seq: Option<i64>,
    #[serde(default)]
    pub grant_jws: Option<String>,
    #[serde(default)]
    pub kid: Option<String>,
    #[serde(default)]
    pub expires_at: Option<String>,
    #[serde(default)]
    pub refused_reason: Option<String>,
    #[serde(default)]
    pub countersigned: Option<bool>,
    #[serde(default)]
    pub countersign_jws: Option<String>,
    // Spec 208 FR-001/FR-004: org.halt.activated / org.halt.lifted fields. The
    // free-form quarantine reason rides the shared `detail` field above (the
    // `reason` field is a closed nack/resync union on the server wire).
    #[serde(default)]
    pub halt_id: Option<String>,
    #[serde(default)]
    pub scope: Option<String>,
    #[serde(default)]
    pub scope_key: Option<String>,
}

/// Mirror of {@link ProjectAgentBindingSnapshotEntry} from statecraft's
/// `api/sync/types.ts` (spec 123 §7.2). Carries the hashes-only directory
/// of per-project agent bindings so the desktop can diff its local cache
/// without refetching full catalog rows.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectAgentBindingSnapshotEntry {
    pub binding_id: String,
    pub org_agent_id: String,
    pub agent_name: String,
    pub pinned_version: i32,
    pub pinned_content_hash: String,
}

/// Mirror of the {@link ServerProjectCatalogUpsert} `repo` sub-object
/// from statecraft's `api/sync/types.ts` (spec 112 §7).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectCatalogRepo {
    pub github_org: String,
    pub repo_name: String,
    pub default_branch: String,
    pub clone_url: String,
    pub html_url: String,
}

/// Mirror of {@link AgentCatalogSnapshotEntry} from statecraft's
/// `api/sync/types.ts`. The snapshot is a directory (hashes only) so the
/// desktop can diff its local cache and pull bodies lazily via
/// `agent.catalog.fetch_request` (spec 111 §2.3).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentCatalogSnapshotEntry {
    pub agent_id: String,
    pub name: String,
    pub version: u32,
    pub status: String,
    pub content_hash: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KnowledgeBundle {
    pub object_id: String,
    pub filename: String,
    pub content_hash: String,
    pub download_url: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EnvelopeBusinessDoc {
    pub name: String,
    pub storage_ref: String,
}

/// Spec 124 §3 — projection of spec-123 `ResolvedAgent` carried inline on
/// `factory.run.stage_started` envelopes. Mirrors the TS `FactoryAgentRef`
/// type in `platform/services/statecraft/api/sync/types.ts`. Field names
/// MUST stay aligned with `factory_engine::agent_resolver::ResolvedAgent` —
/// the spec 124 A-9 grep gate (T088) and the spec 122 Stage CD comparator
/// both depend on this triple.
///
/// Wire convention: camelCase on the duplex bus (matches the rest of the
/// envelope wire shape). The DB column `factory_runs.source_shas` stores
/// the snake_case form per spec §3 — the platform-side reservation/handler
/// converts on persist.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct FactoryAgentRef {
    pub org_agent_id: String,
    pub version: i64,
    pub content_hash: String,
}

/// Spec 124 §6.1 — token-spend roll-up shipped on `factory.run.completed`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct FactoryRunTokenSpend {
    pub input: u64,
    pub output: u64,
    pub total: u64,
}

/// Spec 124 §6.1 — per-stage outcome on `factory.run.stage_completed`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum FactoryStageOutcome {
    Ok,
    Failed,
    Skipped,
}

/// Set of server envelope kinds this client accepts. Guarding at the
/// boundary stops a drifted server or a hostile proxy from slipping an
/// unknown kind through serde's default decoder.
const SERVER_KINDS: &[&str] = &[
    "policy.updated",
    "grant.updated",
    "deploy.status",
    "workspace.updated",
    "project.updated",
    "factory.event",
    "factory.run.request",
    "agent.catalog.updated",
    "agent.catalog.snapshot",
    // spec 123 §7.2 — project-binding envelopes at v1.
    "project.agent_binding.updated",
    "project.agent_binding.snapshot",
    "project.catalog.upsert",
    // spec 112 §7 amendment — snapshot-complete terminator so the desktop
    // can distinguish "connecting" from "connected; zero projects".
    "project.catalog.snapshot.complete",
    "sync.ack",
    "sync.nack",
    "sync.resync_required",
    "sync.heartbeat",
    "sync.hello",
    // Spec 198 FR-005 / FR-014 — grant issuance/renewal reply and certificate
    // countersign reply. These are reply-correlated frames routed via
    // reply_waiters before the normal dispatch path.
    "factory.run.grant",
    "factory.run.certificate_countersign",
    // Spec 207 AC-4 - reply-correlated frame for the session-audit segment
    // countersign (routed via reply_waiters, like the two above).
    "audit.segment.countersign",
    // Spec 208 FR-001/FR-003 - org-wide kill-switch broadcasts. `activated`
    // drives the halt-aware termination path (live_sessions.rs); `lifted` is
    // accepted now (so the reintegration handler can register in Phase 3)
    // without being rejected at the boundary today.
    "org.halt.activated",
    "org.halt.lifted",
];

/// Mirrors `isClientEnvelope` on the statecraft side — enforces schema
/// version and a known kind. Returns `true` when the frame is safe to
/// dispatch.
pub fn is_server_envelope(raw: &ServerEnvelopeWire) -> bool {
    raw.meta.v == ENVELOPE_SCHEMA_VERSION && SERVER_KINDS.contains(&raw.kind.as_str())
}

// ---------------------------------------------------------------------------
// Outbound frames (what the desktop can write back on the wire)
// ---------------------------------------------------------------------------

/// Outbound envelope variants the consumer knows how to emit. Richer client
/// variants (execution.status, audit.candidate) are added in later phases
/// via their own typed constructors.
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum OutboundFrame {
    #[serde(rename = "sync.heartbeat")]
    Heartbeat { meta: EnvelopeMeta },
    #[serde(rename = "sync.ack")]
    Ack {
        meta: EnvelopeMeta,
        #[serde(rename = "serverEventId")]
        server_event_id: String,
    },
    #[serde(rename = "sync.resync_request")]
    ResyncRequest {
        meta: EnvelopeMeta,
        #[serde(rename = "sinceCursor", skip_serializing_if = "Option::is_none")]
        since_cursor: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        reason: Option<String>,
    },
    /// Spec 110 §2.2 — desktop observation that a `factory.run.request` was
    /// received. Carries the minted tab `session_id` and the OPC instance id
    /// so statecraft can distinguish multiple desktops competing for the same
    /// run (the first ack wins; others will receive `sync.nack`).
    #[serde(rename = "factory.run.ack")]
    FactoryRunAck {
        meta: EnvelopeMeta,
        #[serde(rename = "pipelineId")]
        pipeline_id: String,
        #[serde(rename = "sessionId")]
        session_id: String,
        #[serde(rename = "opcInstanceId")]
        opc_instance_id: String,
        accepted: bool,
        #[serde(rename = "declineReason", skip_serializing_if = "Option::is_none")]
        decline_reason: Option<String>,
        #[serde(rename = "observedAt")]
        observed_at: String,
    },
    /// Spec 111 §2.3 — desktop requests the full body of an agent whose hash
    /// from the snapshot does not match its local cache. The statecraft side
    /// replies with a targeted `agent.catalog.updated`. Reason is a small
    /// closed set so the server can log/aggregate cache-miss patterns.
    #[serde(rename = "agent.catalog.fetch_request")]
    AgentCatalogFetchRequest {
        meta: EnvelopeMeta,
        #[serde(rename = "agentId")]
        agent_id: String,
        reason: AgentCatalogFetchReason,
        #[serde(rename = "observedAt")]
        observed_at: String,
    },
    /// Spec 124 §6.1 — desktop announces a stage has started executing.
    /// Platform handler appends a `(stage_id, status: running, started_at,
    /// agent_ref)` entry to `factory_runs.stage_progress` and flips the
    /// row's status from `queued` to `running` if needed.
    #[serde(rename = "factory.run.stage_started")]
    FactoryRunStageStarted {
        meta: EnvelopeMeta,
        #[serde(rename = "runId")]
        run_id: String,
        #[serde(rename = "stageId")]
        stage_id: String,
        #[serde(rename = "agentRef")]
        agent_ref: FactoryAgentRef,
        #[serde(rename = "startedAt")]
        started_at: String,
    },
    /// Spec 124 §6.1 — desktop announces a stage has finished. Updates the
    /// matching `stage_progress` entry's status + completedAt. Out-of-order
    /// delivery (completed before started) is tolerated (T032).
    #[serde(rename = "factory.run.stage_completed")]
    FactoryRunStageCompleted {
        meta: EnvelopeMeta,
        #[serde(rename = "runId")]
        run_id: String,
        #[serde(rename = "stageId")]
        stage_id: String,
        #[serde(rename = "stageOutcome")]
        stage_outcome: FactoryStageOutcome,
        #[serde(skip_serializing_if = "Option::is_none")]
        error: Option<String>,
        #[serde(rename = "completedAt")]
        completed_at: String,
    },
    /// Spec 124 §6.1 / Spec 198 FR-014 — terminal success. Sets row's status
    /// = `ok`, `completed_at`, and the rolled-up `token_spend`. When
    /// `certificate_sha256` is set the server performs a countersign and
    /// replies with `factory.run.certificate_countersign` on the same
    /// correlationId.
    #[serde(rename = "factory.run.completed")]
    FactoryRunCompleted {
        meta: EnvelopeMeta,
        #[serde(rename = "runId")]
        run_id: String,
        #[serde(rename = "tokenSpend")]
        token_spend: FactoryRunTokenSpend,
        #[serde(rename = "completedAt")]
        completed_at: String,
        /// SHA-256 hex of the governance certificate (spec 198 FR-014). When
        /// present the server performs a countersign on the certificate.
        #[serde(rename = "certificateSha256", skip_serializing_if = "Option::is_none")]
        certificate_sha256: Option<String>,
        /// Final grant sequence number at run close (spec 198 FR-014). Must
        /// match the most-recently issued grant's `seq` so the server can
        /// close the grant chain.
        #[serde(skip_serializing_if = "Option::is_none")]
        seq: Option<i64>,
    },
    /// Spec 124 §6.1 — terminal failure. Sets row's status = `failed`,
    /// `completed_at`, and `error`. Partial `stage_progress` is preserved.
    #[serde(rename = "factory.run.failed")]
    FactoryRunFailed {
        meta: EnvelopeMeta,
        #[serde(rename = "runId")]
        run_id: String,
        error: String,
        #[serde(rename = "completedAt")]
        completed_at: String,
    },
    /// Spec 124 §6.1 — user-initiated cancellation. Same shape as failed
    /// but `error` is replaced by an optional `reason`.
    #[serde(rename = "factory.run.cancelled")]
    FactoryRunCancelled {
        meta: EnvelopeMeta,
        #[serde(rename = "runId")]
        run_id: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        reason: Option<String>,
        #[serde(rename = "completedAt")]
        completed_at: String,
    },
    /// Spec 198 FR-005 — desktop requests an initial run-grant at the start
    /// of a factory run. The intent capsule hash is presented so the server
    /// can verify goal stability. The server replies with
    /// `factory.run.grant` correlated via `meta.correlationId`.
    ///
    /// Grants MUST NOT be spooled to the replay queue: a disconnected
    /// session is fail-closed (no grant = no execution).
    #[serde(rename = "factory.run.grant_request")]
    FactoryRunGrantRequest {
        meta: EnvelopeMeta,
        #[serde(rename = "runId")]
        run_id: String,
        #[serde(rename = "goalId")]
        goal_id: String,
        /// Plain-language goal text (for audit surfaces).
        goal: String,
        #[serde(rename = "capsuleHash")]
        capsule_hash: String,
        #[serde(rename = "envelopeHash")]
        envelope_hash: String,
        #[serde(rename = "buildSpecHash", skip_serializing_if = "Option::is_none")]
        build_spec_hash: Option<String>,
        #[serde(rename = "projectId", skip_serializing_if = "Option::is_none")]
        project_id: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        constraints: Option<Vec<String>>,
    },
    /// Spec 198 FR-005 — desktop renews a run-grant at each stage boundary.
    /// `seq` must be exactly `last_seq + 1`; `stage_id` identifies which
    /// stage is about to begin. The server replies with `factory.run.grant`
    /// correlated via `meta.correlationId`.
    ///
    /// Grants MUST NOT be spooled to the replay queue.
    #[serde(rename = "factory.run.grant_renew")]
    FactoryRunGrantRenew {
        meta: EnvelopeMeta,
        #[serde(rename = "runId")]
        run_id: String,
        #[serde(rename = "goalId")]
        goal_id: String,
        #[serde(rename = "capsuleHash")]
        capsule_hash: String,
        seq: i64,
        #[serde(rename = "stageId", skip_serializing_if = "Option::is_none")]
        stage_id: Option<String>,
        /// Spec 208 FR-001: agent profile (org_agent_id) about to execute this
        /// stage, resolved from the reservation-time stage-agent map. Lets an
        /// agent-profile-scoped org halt refuse renewal (AC-3). Attribution
        /// only, same class as `stage_id`.
        #[serde(rename = "agentProfile", skip_serializing_if = "Option::is_none")]
        agent_profile: Option<String>,
        #[serde(rename = "buildSpecHash", skip_serializing_if = "Option::is_none")]
        build_spec_hash: Option<String>,
    },
    /// Spec 207 AC-4 - the desktop submits a closed (rotated) audit segment
    /// HEAD for platform countersign. The local side is keyless (spec 198
    /// FR-014): it sends the head hash plus metadata, statecraft signs and
    /// persists a seal row, and replies with `audit.segment.countersign`
    /// correlated via `meta.correlationId`. Offline-first: heads accumulate
    /// while disconnected and are swept at reconnect (idempotent on the seal's
    /// `(org, session, segment)` key).
    #[serde(rename = "audit.segment.countersign_request")]
    AuditSegmentCountersignRequest {
        meta: EnvelopeMeta,
        #[serde(rename = "projectId", skip_serializing_if = "Option::is_none")]
        project_id: Option<String>,
        #[serde(rename = "sessionId")]
        session_id: String,
        #[serde(rename = "segmentId")]
        segment_id: String,
        #[serde(rename = "segmentHeadHash")]
        segment_head_hash: String,
        #[serde(rename = "segmentRecordCount")]
        segment_record_count: u64,
        #[serde(rename = "firstRecordAt")]
        first_record_at: String,
        #[serde(rename = "lastRecordAt")]
        last_record_at: String,
    },
    /// Spec 208 FR-003 - the engine acknowledges an `org.halt.activated` /
    /// `org.halt.lifted` broadcast once it has reached its pause-and-checkpoint
    /// (halt) or re-admission (lift) boundary, so statecraft records this
    /// engine's per-broadcast propagation bound on the quarantine record. The
    /// `clientId` is NOT on the wire: statecraft stamps it from the
    /// authenticated duplex session (the audit.candidate trust posture).
    #[serde(rename = "org.halt.ack")]
    OrgHaltAck {
        meta: EnvelopeMeta,
        #[serde(rename = "haltId")]
        halt_id: String,
        #[serde(rename = "haltKind")]
        halt_kind: OrgHaltAckKind,
        #[serde(rename = "ackedAt")]
        acked_at: String,
    },
}

/// Reason enum for {@link OutboundFrame::AgentCatalogFetchRequest}. Mirrors
/// the closed set in statecraft's `ClientAgentCatalogFetchRequest.reason`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum AgentCatalogFetchReason {
    CacheMiss,
    HashMismatch,
    ManualRefresh,
}

/// Spec 208 FR-003 - which org-halt broadcast an `org.halt.ack` answers.
/// Serialises to `"halt"` / `"lift"`, matching the `haltKind` field on the
/// statecraft `ClientOrgHaltAck` wire shape and the `org_halts.acks[].kind`
/// column.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum OrgHaltAckKind {
    Halt,
    Lift,
}

// ---------------------------------------------------------------------------
// Handler trait + dispatch table
// ---------------------------------------------------------------------------

/// Handler for a single server envelope kind. Spec 110 §10 requires the
/// dispatch surface be extensible enough that spec 111's
/// `agent.catalog.updated` can register without refactoring the consumer.
pub trait EnvelopeHandler: Send + Sync {
    fn handle(&self, envelope: &ServerEnvelopeWire);
}

/// Boxed handler for a single function. Convenience for the bootstrap.
pub struct FnHandler<F: Fn(&ServerEnvelopeWire) + Send + Sync + 'static>(pub F);

impl<F> EnvelopeHandler for FnHandler<F>
where
    F: Fn(&ServerEnvelopeWire) + Send + Sync + 'static,
{
    fn handle(&self, envelope: &ServerEnvelopeWire) {
        (self.0)(envelope)
    }
}

/// Thread-safe registry keyed by `kind`. Follows the pattern spec 110 §10
/// calls out: `HashMap<&'static str, Arc<dyn EnvelopeHandler>>` or equivalent.
#[derive(Default)]
pub struct DispatchTable {
    inner: RwLock<HashMap<String, Arc<dyn EnvelopeHandler>>>,
}

impl DispatchTable {
    pub fn new() -> Self {
        Self::default()
    }

    /// Register a handler for a given envelope kind. Replaces any existing
    /// handler for the same kind.
    pub fn register(&self, kind: &str, handler: Arc<dyn EnvelopeHandler>) {
        if let Ok(mut g) = self.inner.write() {
            g.insert(kind.to_string(), handler);
        }
    }

    /// Lookup the handler for a kind, if one is registered.
    pub fn get(&self, kind: &str) -> Option<Arc<dyn EnvelopeHandler>> {
        self.inner.read().ok().and_then(|g| g.get(kind).cloned())
    }

    /// Test-only: list registered kinds for assertions.
    #[cfg(test)]
    pub fn kinds(&self) -> Vec<String> {
        self.inner
            .read()
            .map(|g| g.keys().cloned().collect())
            .unwrap_or_default()
    }
}

// ---------------------------------------------------------------------------
// Client state
// ---------------------------------------------------------------------------

/// Configuration for the duplex consumer.
#[derive(Debug, Clone)]
pub struct SyncClientConfig {
    /// Statecraft HTTP base URL (e.g. `https://statecraft.ing`). Converted
    /// to ws:// or wss:// internally.
    pub base_url: String,
    /// Stable client identifier for this OPC process. Persisted across
    /// reconnects.
    pub client_id: String,
    /// Human-readable client version — informational only.
    pub client_version: Option<String>,
}

/// Stable per-process OPC instance identity, exposed as Tauri managed state so
/// the duplex `client_id` survives a settings-driven re-spawn (spec 183
/// FR-T2(a): `commands::settings::set_statecraft_base_url` re-spawns the
/// consumer on a base-URL change). Mirrors the id used for `factory.run.ack`
/// correlation (spec 110 §2.2), so desktop logs and the envelopes statecraft
/// receives stay aligned across a URL switch.
pub struct OpcInstanceId(pub String);

/// Shared inner state for the duplex consumer. Held in an `Arc` so external
/// modules (e.g. the factory.run.request handler) can clone a handle and
/// post `factory.run.ack` frames without touching the Tauri state registry
/// on each call.
#[derive(Default)]
pub struct SyncClientInner {
    dispatch: Arc<DispatchTable>,
    last_cursor: Arc<RwLock<Option<String>>>,
    /// Sender for the currently-connected duplex session. `None` whenever the
    /// socket is disconnected; external callers treat a `None` as "best-effort
    /// drop" rather than blocking.
    outbound: RwLock<Option<mpsc::Sender<OutboundFrame>>>,
    /// Spec 183 FR-T2(b) — flipped to `true` when statecraft sends `sync.hello`
    /// over the duplex stream, which is the server's acknowledgment that the
    /// handshake was accepted for the claimed `(clientId, orgId)` pair. The
    /// boot-gate consumer reads this via `sync_hello_received()`. Stays `true`
    /// across the lifetime of the duplex consumer; FR-T5(b) precondition-loss
    /// signalling is a separate concern (the give-up signal lands in a later
    /// stage of the spec 183 implementation).
    sync_hello_received: std::sync::atomic::AtomicBool,
    /// Spec 198 FR-005 / FR-014 — reply-correlation map for request/reply
    /// frames (`factory.run.grant`, `factory.run.certificate_countersign`).
    /// Keyed by the outbound frame's `meta.eventId`; the value is a oneshot
    /// sender that `resolve_reply_waiter` calls when the correlated inbound
    /// frame arrives (matched by `meta.correlationId`).
    ///
    /// Uses `std::sync::Mutex` (not tokio) so it can be locked from both
    /// sync (`resolve_reply_waiter`) and async (`send_and_await_reply`) contexts.
    reply_waiters: std::sync::Mutex<HashMap<String, oneshot::Sender<ServerEnvelopeWire>>>,
    /// Spec 207 AC-4 - the duplex session id carried on `sync.hello`. Used as
    /// the scope key when the desktop submits closed audit segment heads for
    /// platform countersign (the seal is keyed `(org, session, segment)`).
    session_id: RwLock<Option<String>>,
    /// Spec 207 AC-4 - the axiomregent producer's audit chain directory
    /// (`<AXIOMREGENT_DATA_DIR>/audit`), recomputed by the desktop from the same
    /// `app_data_dir` the OPC sidecar pins (see `sidecars::spawn_axiomregent`),
    /// so the AC-4 sweep reads closed segment heads off the shared disk. Set at
    /// spawn time; `None` disables the sweep (e.g. headless builds without an
    /// app data dir).
    audit_chain_dir: RwLock<Option<PathBuf>>,
    /// Spec 207 AC-4 - in-flight guard for the countersign sweep. `sync.hello`
    /// fires on every (re)connect, so without this a reconnect burst would spawn
    /// overlapping sweeps that race the seal store. Only the task that flips
    /// this `false -> true` runs; a `SweepGuard` resets it on completion or
    /// panic.
    audit_sweep_active: std::sync::atomic::AtomicBool,
}

/// Spec 207 AC-4 - resets [`SyncClientInner::audit_sweep_active`] when the sweep
/// task ends (normally or by panic), so a future `sync.hello` can start the next
/// sweep. Holds an `Arc` because the task is detached and outlives the caller.
struct SweepGuard(Arc<SyncClientInner>);

impl Drop for SweepGuard {
    fn drop(&mut self) {
        self.0
            .audit_sweep_active
            .store(false, std::sync::atomic::Ordering::Release);
    }
}

impl SyncClientInner {
    pub(crate) fn set_outbound(&self, tx: Option<mpsc::Sender<OutboundFrame>>) {
        if let Ok(mut g) = self.outbound.write() {
            *g = tx;
        }
    }

    /// Spec 183 FR-T2(b) — `sync.hello` observability. Returns `true` once
    /// statecraft has acknowledged the handshake for this consumer.
    pub fn sync_hello_received(&self) -> bool {
        self.sync_hello_received
            .load(std::sync::atomic::Ordering::Acquire)
    }

    pub(crate) fn mark_sync_hello_received(&self) {
        self.sync_hello_received
            .store(true, std::sync::atomic::Ordering::Release);
    }

    /// Spec 183 FR-T5(b) — reset the sync_hello receipt when the duplex
    /// give-up threshold is crossed. Without this, the boot gate would
    /// continue to report `org_session_ready=true` against a dead duplex
    /// even after a precondition-loss event was emitted, leaving the
    /// cockpit branch ambiguous about whether to restore to boot.
    pub(crate) fn reset_sync_hello_received(&self) {
        self.sync_hello_received
            .store(false, std::sync::atomic::Ordering::Release);
    }

    fn current_outbound(&self) -> Option<mpsc::Sender<OutboundFrame>> {
        self.outbound.read().ok().and_then(|g| g.clone())
    }

    /// Emit a pre-built outbound frame if the duplex stream is connected.
    /// Returns `true` when the frame was queued on the outbound channel.
    pub async fn send(&self, frame: OutboundFrame) -> bool {
        let Some(tx) = self.current_outbound() else {
            return false;
        };
        tx.send(frame).await.is_ok()
    }

    /// Emit a typed `agent.catalog.fetch_request` frame (spec 111 §2.3).
    /// Kept behind the catalog feature flag at the desktop caller site —
    /// this function does not gate itself so tests can exercise the wire
    /// path without flipping a flag. Returns `false` if the duplex stream
    /// is not connected.
    pub async fn send_agent_catalog_fetch_request(
        &self,
        agent_id: &str,
        reason: AgentCatalogFetchReason,
    ) -> bool {
        let frame = OutboundFrame::AgentCatalogFetchRequest {
            meta: new_meta(),
            agent_id: agent_id.to_string(),
            reason,
            observed_at: chrono::Utc::now().to_rfc3339(),
        };
        self.send(frame).await
    }

    /// Emit a typed `factory.run.ack` frame (spec 110 §2.2). Returns `false`
    /// when the duplex stream is not currently connected — callers log but
    /// do not retry; the dedupe marker prevents re-ack on reconnect.
    pub async fn send_factory_run_ack(
        &self,
        pipeline_id: &str,
        session_id: &str,
        opc_instance_id: &str,
        accepted: bool,
        decline_reason: Option<String>,
    ) -> bool {
        let frame = OutboundFrame::FactoryRunAck {
            meta: new_meta(),
            pipeline_id: pipeline_id.to_string(),
            session_id: session_id.to_string(),
            opc_instance_id: opc_instance_id.to_string(),
            accepted,
            decline_reason,
            observed_at: chrono::Utc::now().to_rfc3339(),
        };
        self.send(frame).await
    }

    /// Spec 208 FR-003 - emit an `org.halt.ack` for a halt or lift broadcast,
    /// stamping the boundary timestamp now. Returns `false` when the duplex
    /// stream is disconnected; the caller logs but does not retry, because the
    /// quarantine record is reconstructed for a reconnecting engine off the
    /// outbox on resync (the broadcast is outbox-durable).
    pub async fn send_org_halt_ack(&self, halt_id: &str, halt_kind: OrgHaltAckKind) -> bool {
        let frame = OutboundFrame::OrgHaltAck {
            meta: new_meta(),
            halt_id: halt_id.to_string(),
            halt_kind,
            acked_at: chrono::Utc::now().to_rfc3339(),
        };
        self.send(frame).await
    }

    /// Spec 124 §6.1 — emit `factory.run.stage_started`. Returns `false`
    /// when the duplex stream is not connected; callers should enqueue the
    /// frame onto the on-disk replay buffer (Phase 5 T053).
    pub async fn send_factory_run_stage_started(
        &self,
        run_id: &str,
        stage_id: &str,
        agent_ref: FactoryAgentRef,
    ) -> bool {
        let frame = OutboundFrame::FactoryRunStageStarted {
            meta: new_meta(),
            run_id: run_id.to_string(),
            stage_id: stage_id.to_string(),
            agent_ref,
            started_at: chrono::Utc::now().to_rfc3339(),
        };
        self.send(frame).await
    }

    /// Spec 124 §6.1 — emit `factory.run.stage_completed`.
    pub async fn send_factory_run_stage_completed(
        &self,
        run_id: &str,
        stage_id: &str,
        stage_outcome: FactoryStageOutcome,
        error: Option<String>,
    ) -> bool {
        let frame = OutboundFrame::FactoryRunStageCompleted {
            meta: new_meta(),
            run_id: run_id.to_string(),
            stage_id: stage_id.to_string(),
            stage_outcome,
            error,
            completed_at: chrono::Utc::now().to_rfc3339(),
        };
        self.send(frame).await
    }

    /// Spec 124 §6.1 — emit terminal `factory.run.completed` (no certificate
    /// binding). For certificate-bound completion use `send_and_await_reply`
    /// directly with a `FactoryRunCompleted` frame carrying `certificate_sha256`
    /// and `seq` (spec 198 FR-014).
    pub async fn send_factory_run_completed(
        &self,
        run_id: &str,
        token_spend: FactoryRunTokenSpend,
    ) -> bool {
        let frame = OutboundFrame::FactoryRunCompleted {
            meta: new_meta(),
            run_id: run_id.to_string(),
            token_spend,
            completed_at: chrono::Utc::now().to_rfc3339(),
            certificate_sha256: None,
            seq: None,
        };
        self.send(frame).await
    }

    /// Spec 124 §6.1 — emit terminal `factory.run.failed`.
    pub async fn send_factory_run_failed(&self, run_id: &str, error: String) -> bool {
        let frame = OutboundFrame::FactoryRunFailed {
            meta: new_meta(),
            run_id: run_id.to_string(),
            error,
            completed_at: chrono::Utc::now().to_rfc3339(),
        };
        self.send(frame).await
    }

    /// Spec 198 FR-005 / FR-014 — if `correlation_id` matches a pending waiter,
    /// deliver the reply envelope and remove the waiter. Returns `true` when a
    /// waiter was resolved; returns `false` (and the caller logs a warning) when
    /// no waiter is registered for this correlation id.
    pub(crate) fn resolve_reply_waiter(&self, envelope: ServerEnvelopeWire) -> bool {
        let Some(ref cid) = envelope.meta.correlation_id.clone() else {
            return false;
        };
        let tx = {
            let Ok(mut map) = self.reply_waiters.lock() else {
                return false;
            };
            map.remove(cid.as_str())
        };
        match tx {
            Some(sender) => {
                // Ignore the send error: the waiter may have timed out and
                // dropped the receiver already. The frame is simply discarded.
                let _ = sender.send(envelope);
                true
            }
            None => false,
        }
    }

    /// Spec 198 FR-005 / FR-014 — send an outbound frame that expects a
    /// correlated reply, then await the reply with a 30-second timeout.
    ///
    /// The frame's `meta.eventId` is used as the waiter key. If the duplex
    /// stream is not connected, or if the timeout fires, an error is returned
    /// so callers can fail closed (no grant = no execution).
    pub(crate) async fn send_and_await_reply(
        &self,
        frame: OutboundFrame,
        event_id: String,
    ) -> Result<ServerEnvelopeWire, String> {
        let (tx, rx) = oneshot::channel::<ServerEnvelopeWire>();
        {
            let Ok(mut map) = self.reply_waiters.lock() else {
                return Err("reply_waiters lock poisoned".into());
            };
            map.insert(event_id.clone(), tx);
        }
        // Bound the outbound send, not just the reply wait below. `send` queues
        // on a *bounded* mpsc (`tx.send(frame).await`), so if the duplex WS
        // writer task is stalled (a dead-but-undetected connection) this await
        // can block indefinitely, wedging the run before governance completes
        // with no signal which phase blocked (the "Waiting for agent output"
        // silent stall). Failing closed here keeps the handshake bounded end to
        // end so `establish()` returns an actionable error instead of hanging.
        let sent = match tokio::time::timeout(
            std::time::Duration::from_secs(10),
            self.send(frame),
        )
        .await
        {
            Ok(sent) => sent,
            Err(_) => {
                if let Ok(mut map) = self.reply_waiters.lock() {
                    map.remove(&event_id);
                }
                return Err(
                    "duplex outbound send stalled (>10 s); failing closed rather than wedging the run"
                        .into(),
                );
            }
        };
        if !sent {
            // Remove the waiter we just registered so it doesn't leak.
            if let Ok(mut map) = self.reply_waiters.lock() {
                map.remove(&event_id);
            }
            return Err("duplex stream disconnected; cannot send request".into());
        }
        match tokio::time::timeout(std::time::Duration::from_secs(30), rx).await {
            Ok(Ok(reply)) => Ok(reply),
            Ok(Err(_)) => Err("reply channel dropped before response arrived".into()),
            Err(_) => {
                if let Ok(mut map) = self.reply_waiters.lock() {
                    map.remove(&event_id);
                }
                Err("duplex request timed out after 30 s".into())
            }
        }
    }

    /// Spec 198 FR-005 / FR-014 — emit terminal `factory.run.cancelled`.
    pub async fn send_factory_run_cancelled(
        &self,
        run_id: &str,
        reason: Option<String>,
    ) -> bool {
        let frame = OutboundFrame::FactoryRunCancelled {
            meta: new_meta(),
            run_id: run_id.to_string(),
            reason,
            completed_at: chrono::Utc::now().to_rfc3339(),
        };
        self.send(frame).await
    }

    /// Spec 207 AC-4 - record the duplex session id observed on `sync.hello`.
    pub(crate) fn set_session_id(&self, session_id: Option<String>) {
        if let Ok(mut g) = self.session_id.write() {
            *g = session_id;
        }
    }

    /// Spec 207 AC-4 - the last observed duplex session id, if connected.
    pub fn session_id(&self) -> Option<String> {
        self.session_id.read().ok().and_then(|g| g.clone())
    }

    /// Spec 207 AC-4 - pin the producer's audit chain directory so the
    /// reconnect sweep and the unanchored-window query read the shared disk.
    pub(crate) fn set_audit_chain_dir(&self, dir: PathBuf) {
        if let Ok(mut g) = self.audit_chain_dir.write() {
            *g = Some(dir);
        }
    }

    /// Spec 207 AC-4 - the producer's audit chain directory, if pinned.
    pub(crate) fn audit_chain_dir(&self) -> Option<PathBuf> {
        self.audit_chain_dir.read().ok().and_then(|g| g.clone())
    }

    /// Spec 207 AC-4 - submit one closed audit segment HEAD for platform
    /// countersign and await the correlated reply (the proven
    /// `send_and_await_reply` correlation, like the grant + cert paths). The
    /// local side holds no signing keys; it attests the head hash and metadata
    /// and statecraft returns a short-lived JWS. Errors propagate so the sweep
    /// can stop and retry on the next reconnect.
    pub(crate) async fn submit_audit_segment_countersign(
        &self,
        session_id: &str,
        head: &SegmentHead,
    ) -> Result<AuditSegmentCountersignOutcome, String> {
        let event_id = uuid::Uuid::new_v4().to_string();
        let frame = OutboundFrame::AuditSegmentCountersignRequest {
            meta: EnvelopeMeta {
                v: ENVELOPE_SCHEMA_VERSION,
                event_id: event_id.clone(),
                sent_at: chrono::Utc::now().to_rfc3339(),
                correlation_id: None,
                causation_id: None,
            },
            project_id: None,
            session_id: session_id.to_string(),
            segment_id: head.segment_id.clone(),
            segment_head_hash: head.segment_head_hash.clone(),
            segment_record_count: head.segment_record_count,
            first_record_at: head.first_record_at.clone(),
            last_record_at: head.last_record_at.clone(),
        };
        // The reply is matched to this request by `meta.correlationId` (the
        // event_id above), so the segment it seals is the one we submitted; we
        // key the outcome by `head.segment_id` rather than re-reading it off the
        // wire (the duplex `ServerEnvelopeWire` carries the shared countersign
        // fields, and serde ignores the reply's echoed `segmentId`).
        let reply = self.send_and_await_reply(frame, event_id).await?;
        Ok(AuditSegmentCountersignOutcome {
            segment_id: head.segment_id.clone(),
            countersigned: reply.countersigned.unwrap_or(false),
            countersign_jws: reply.countersign_jws,
            kid: reply.kid,
            refused_reason: reply.refused_reason,
        })
    }
}

/// Tauri-managed handle to the background duplex consumer.
pub struct SyncClientState {
    inner: Arc<SyncClientInner>,
    join: Mutex<Option<JoinHandle<()>>>,
}

impl Default for SyncClientState {
    fn default() -> Self {
        Self {
            inner: Arc::new(SyncClientInner::default()),
            join: Mutex::new(None),
        }
    }
}

impl SyncClientState {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn dispatch_table(&self) -> Arc<DispatchTable> {
        self.inner.dispatch.clone()
    }

    pub fn last_cursor(&self) -> Option<String> {
        self.inner.last_cursor.read().ok().and_then(|g| g.clone())
    }

    /// Spec 183 FR-T2(b) — boot-gate observer surface. Returns `true` once
    /// statecraft has emitted `sync.hello` on the active duplex stream.
    pub fn sync_hello_received(&self) -> bool {
        self.inner.sync_hello_received()
    }

    /// Clone the inner handle. Callers hold it across async tasks without
    /// touching `AppHandle` on every send.
    ///
    /// Named `handle()` rather than `inner()` because Tauri's `State<T>`
    /// already exposes `.inner() -> &T`, which would shadow this method on
    /// managed-state call sites.
    pub fn handle(&self) -> Arc<SyncClientInner> {
        self.inner.clone()
    }

    /// Spawn the background reconnect loop. If an existing task is running it
    /// is aborted and awaited first (so a re-spawn never overlaps two loops),
    /// then the new loop is launched. The
    /// AppHandle is threaded through so the reconnect loop can emit the
    /// FR-T5(b) precondition-loss event when it crosses the give-up
    /// threshold (spec 183 stage C). `auth` is the Statecraft client handle
    /// the loop uses to resolve and refresh the bearer JWT at connect time
    /// (spec 110 / 183) rather than from a launch-time snapshot.
    ///
    /// Spawn-time binding (spec 183 FR-T2(a)): `auth` is an
    /// `Arc<StatecraftClient>` captured *now*. The Arc-sharing invariant — that
    /// a write through any `StatecraftState::current()` handle is visible to
    /// this loop — holds for that client's lifetime. A base-URL change
    /// (`commands::settings::set_statecraft_base_url` → `StatecraftState::replace`)
    /// installs a *new* client and **re-spawns this consumer** against it (the
    /// re-`spawn` aborts and awaits the prior task first), so the loop follows the URL
    /// change rather than keeping the old handle. Between spawns the running
    /// loop is always bound to the client it was spawned with.
    pub async fn spawn(
        &self,
        config: SyncClientConfig,
        auth: Arc<StatecraftClient>,
        app: tauri::AppHandle,
    ) {
        // Spec 207 AC-4: recompute the producer's audit chain dir off the same
        // `app_data_dir` the OPC sidecar pins as AXIOMREGENT_DATA_DIR
        // (`sidecars::spawn_axiomregent`), so the reconnect sweep reads closed
        // segment heads from the shared disk. A missing dir disables the sweep.
        {
            use tauri::Manager as _;
            if let Ok(base) = app.path().app_data_dir() {
                self.inner
                    .set_audit_chain_dir(audit_chain_dir_under(&base));
            }
        }

        // `self.join` is a *tokio* mutex, so holding the guard across the
        // `.await` below is sound — the std-`Mutex` "never hold across await"
        // rule does not apply to `tokio::sync::Mutex`. The hold is deliberate:
        // take → abort → await → store must be atomic so two re-spawns can
        // never overlap or orphan a task (releasing the lock mid-teardown would
        // let a concurrent spawn install its own handle, which we'd then
        // clobber). The hold is brief — `abort()` wakes the loop at its next
        // cancellation point, and every await in `run_forever` is one, so
        // `prev.await` returns promptly — and `run_forever` never locks
        // `self.join`, so there is no deadlock.
        let mut guard = self.join.lock().await;
        if let Some(prev) = guard.take() {
            // Abort the prior loop AND await its teardown before starting the
            // new one, so a user-triggered re-spawn (settings URL change) never
            // briefly runs two loops bound to different clients (spec 183
            // FR-T2(a)). abort() alone only signals cancellation.
            prev.abort();
            let _ = prev.await;
        }
        let inner = self.inner.clone();
        let task = tokio::spawn(async move {
            run_forever(config, auth, inner, app).await;
        });
        *guard = Some(task);
    }

    /// Stop the background consumer if running.
    pub async fn shutdown(&self) {
        let mut guard = self.join.lock().await;
        if let Some(task) = guard.take() {
            task.abort();
        }
    }
}

// ---------------------------------------------------------------------------
// Reconnect loop
// ---------------------------------------------------------------------------

const MIN_BACKOFF: Duration = Duration::from_secs(1);
const MAX_BACKOFF: Duration = Duration::from_secs(60);
const HEARTBEAT_INTERVAL: Duration = Duration::from_secs(25);

/// Spec 183 FR-T5(b) — duplex give-up threshold. After this many
/// consecutive failed `connect_and_run` attempts, the reconnect loop
/// emits a precondition-loss event and resets the sync_hello receipt
/// flag. The loop keeps trying (the user may fix the underlying issue
/// — e.g., corporate proxy unblocked); when a subsequent reconnect
/// succeeds and `sync.hello` arrives again, the boot gate naturally
/// re-opens. Threshold value is implementer's choice per FR-T5(b);
/// 5 consecutive failures puts the give-up signal at roughly 31s
/// (1+2+4+8+16) into a continuous outage, which is past the "network
/// blip" boundary without making the user wait minutes.
const DUPLEX_GIVE_UP_FAILURES: u32 = 5;

/// Cap on consecutive refresh-then-still-401 cycles within a single outage
/// before we stop treating the 401 as "recoverable" and let it count toward
/// the give-up threshold. Guards against a hot-loop if the server keeps
/// rejecting a freshly minted token (e.g. clock skew between the desktop and
/// Rauthy). Reset on every clean connection so a long-lived session that
/// expires repeatedly over its lifetime is not penalised.
const MAX_REFRESHES_PER_OUTAGE: u32 = 3;

/// Poll interval while the consumer is running but no Statecraft JWT exists
/// yet (e.g. launched before the user signed in). Kept short and *separate*
/// from the connect-failure backoff so a sign-in is picked up within a few
/// seconds — without hammering the keychain or attempting unauthenticated
/// upgrades that would 401-spam the log.
const WAIT_FOR_TOKEN: Duration = Duration::from_secs(3);

/// Outcome of a single duplex connection attempt. A 401 on the WebSocket
/// upgrade is recoverable (the bearer is stale → refresh and retry); every
/// other failure is transient and handled by plain backoff.
enum ConnectError {
    Unauthorized(String),
    Transient(String),
}

impl std::fmt::Display for ConnectError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ConnectError::Unauthorized(m) | ConnectError::Transient(m) => write!(f, "{m}"),
        }
    }
}

/// Resolve the bearer token at connect time: prefer the in-memory value, then
/// fall back to a keychain reload. The reload covers a consumer that started
/// before the user signed in — OAuth sign-in persists the session to the OS
/// keychain (the shared source of truth across `StatecraftClient` clones), so
/// reloading here lets the loop pick it up without a re-spawn. Returns `None`
/// when no session exists yet.
///
/// The keychain read is blocking OS I/O (on macOS, `SecKeychainFind…`), so it
/// runs under `spawn_blocking` to avoid stalling the tokio worker that drives
/// this loop; the cheap in-memory apply (`adopt_token`) stays on this task.
async fn resolve_token(auth: &StatecraftClient) -> Option<String> {
    if let Some(token) = auth.auth_token() {
        return Some(token);
    }
    let from_keychain = tokio::task::spawn_blocking(
        crate::commands::statecraft_client::read_session_token_from_keychain,
    )
    .await
    .ok()
    .flatten();
    if let Some(token) = from_keychain {
        auth.adopt_token(&token);
        return Some(token);
    }
    None
}

/// Re-read the persisted session off the executor and apply it in-memory.
/// Called when a silent JWT refresh fails, to pick up a session a fresh
/// sign-in may have written out from under the loop. Best-effort: a missing
/// session leaves the in-memory token untouched and the next `resolve_token`
/// drops to the idle wait.
async fn reload_session_token(auth: &StatecraftClient) {
    if let Some(token) = tokio::task::spawn_blocking(
        crate::commands::statecraft_client::read_session_token_from_keychain,
    )
    .await
    .ok()
    .flatten()
    {
        auth.adopt_token(&token);
    }
}

async fn run_forever(
    config: SyncClientConfig,
    auth: Arc<StatecraftClient>,
    inner: Arc<SyncClientInner>,
    app: tauri::AppHandle,
) {
    // Spec 183 (post-approval hardening): a loop-entry log so a wedged
    // consumer is never silent. If this line appears but no subsequent
    // "connecting"/"idle" line does, the hang is in token resolution; if
    // it never appears at all, the task died before the loop ever ran —
    // the spawn/managed-state ordering race this hardening closed.
    log::info!(
        "sync_client: reconnect loop entered (client_id={})",
        config.client_id
    );
    let mut backoff = MIN_BACKOFF;
    let mut consecutive_failures: u32 = 0;
    let mut refreshes_this_outage: u32 = 0;
    let mut give_up_emitted = false;
    let mut announced_waiting = false;
    loop {
        // Resolve the bearer fresh each attempt instead of from a launch
        // snapshot. Without a token we wait (short poll) rather than attempting
        // an upgrade that is guaranteed to 401 — this is the idle pre-sign-in
        // state, not a failure.
        let token = match resolve_token(&auth).await {
            Some(token) => {
                announced_waiting = false;
                token
            }
            None => {
                if !announced_waiting {
                    log::info!(
                        "sync_client: duplex consumer idle — no Statecraft JWT yet, waiting for sign-in"
                    );
                    announced_waiting = true;
                }
                tokio::time::sleep(WAIT_FOR_TOKEN).await;
                continue;
            }
        };

        let cursor_snapshot = inner.last_cursor.read().ok().and_then(|g| g.clone());
        match connect_and_run(&config, &token, cursor_snapshot, &inner).await {
            Ok(()) => {
                log::info!("sync_client: duplex stream closed cleanly — reconnecting");
                backoff = MIN_BACKOFF;
                consecutive_failures = 0;
                refreshes_this_outage = 0;
                if give_up_emitted {
                    log::info!(
                        "sync_client: duplex recovered from give-up state — boot gate will re-open on next sync.hello"
                    );
                    give_up_emitted = false;
                }
            }
            Err(err) => {
                match err {
                    // The bearer was rejected. Drive the same silent Rauthy
                    // refresh the REST path uses (reads the rotating
                    // refresh_token from the keychain). A refresh-recovered
                    // 401 is a *session expiry*, not an unreachable service:
                    // retry promptly on the new bearer and do NOT advance the
                    // give-up counter (that threshold means "service
                    // unreachable", not "token rotated"). The per-outage
                    // refresh budget bounds a pathological refresh→still-401
                    // hot-loop (e.g. clock skew) so the give-up signal stays
                    // reachable. This is the fix for the boot-gate hang:
                    // previously the loop retried the same expired JWT forever
                    // (401 → 60s → 401 …) and `sync.hello` never arrived.
                    ConnectError::Unauthorized(msg)
                        if refreshes_this_outage < MAX_REFRESHES_PER_OUTAGE =>
                    {
                        log::warn!(
                            "sync_client: duplex unauthorized — refreshing JWT: {msg}"
                        );
                        match auth.refresh_jwt().await {
                            Ok(()) => {
                                log::info!(
                                    "sync_client: Statecraft JWT refreshed — retrying duplex promptly with new bearer"
                                );
                                // Surface the silent recovery to the frontend so
                                // AuthContext re-checks status instead of leaving
                                // a stale "Sign in" prompt for a session that was
                                // just refreshed under it (spec 183 — never
                                // re-prompt while a valid session can be restored).
                                {
                                    use tauri::Emitter as _;
                                    let _ = app.emit("session-refreshed", ());
                                }
                                refreshes_this_outage += 1;
                                // Recoverable session expiry: reset the backoff
                                // so a token that rotated mid-outage is not
                                // penalised by an earlier transient failure's
                                // grown backoff, retry promptly (the ~1s sleep
                                // lets the new bearer propagate), and skip the
                                // give-up counting + backoff growth at the
                                // bottom of the loop.
                                backoff = MIN_BACKOFF;
                                inner.set_outbound(None);
                                tokio::time::sleep(backoff).await;
                                continue;
                            }
                            Err(e) => {
                                // Refresh failed (no/expired refresh_token).
                                // Reload the keychain off-thread in case a fresh
                                // sign-in replaced the session out from under us;
                                // if not, the next resolve_token returns None and
                                // we drop back to the idle wait. A genuine
                                // failure, so it counts toward give-up.
                                log::warn!(
                                    "sync_client: JWT refresh failed ({e}) — reloading keychain session"
                                );
                                reload_session_token(&auth).await;
                                consecutive_failures += 1;
                            }
                        }
                    }
                    // Refresh budget exhausted this outage → treat the 401 as a
                    // genuine failure so the give-up threshold stays reachable.
                    ConnectError::Unauthorized(msg) => {
                        consecutive_failures += 1;
                        log::warn!(
                            "sync_client: repeated 401s despite refresh (attempt #{consecutive_failures}) — backing off: {msg}"
                        );
                    }
                    ConnectError::Transient(msg) => {
                        consecutive_failures += 1;
                        log::warn!(
                            "sync_client: duplex stream error (attempt #{consecutive_failures}) — reconnecting in {:?}: {msg}",
                            backoff
                        );
                    }
                }

                // FR-T5(b) — give-up signal. Fires once per outage; resets
                // when reconnect succeeds. Resetting sync_hello_received
                // is mandatory so the boot gate's org_session_ready flips
                // false in step with the emitted event.
                if consecutive_failures >= DUPLEX_GIVE_UP_FAILURES && !give_up_emitted {
                    log::warn!(
                        "sync_client: duplex give-up threshold ({DUPLEX_GIVE_UP_FAILURES}) crossed — emitting precondition-loss"
                    );
                    inner.reset_sync_hello_received();
                    crate::sidecars::emit_precondition_lost(
                        &app,
                        "duplex",
                        &format!(
                            "reconnect attempts ({consecutive_failures}) exceeded threshold ({DUPLEX_GIVE_UP_FAILURES})"
                        ),
                    );
                    give_up_emitted = true;
                }
            }
        }
        // Clear the outbound channel so external callers stop enqueuing
        // frames onto a dead session while we wait to reconnect.
        inner.set_outbound(None);
        tokio::time::sleep(backoff).await;
        backoff = std::cmp::min(backoff * 2, MAX_BACKOFF);
    }
}

/// Convert a statecraft HTTP base URL to the ws:// or wss:// duplex URL
/// with the handshake query parameters appended.
fn build_duplex_url(base_url: &str, client_id: &str, cursor: Option<&str>) -> String {
    let trimmed = base_url.trim_end_matches('/');
    let ws_base = if let Some(rest) = trimmed.strip_prefix("https://") {
        format!("wss://{rest}")
    } else if let Some(rest) = trimmed.strip_prefix("http://") {
        format!("ws://{rest}")
    } else {
        trimmed.to_string()
    };
    let mut url = format!(
        "{ws_base}/api/sync/duplex?clientId={}&clientKind=desktop-opc",
        urlencode(client_id)
    );
    if let Some(c) = cursor {
        url.push_str("&lastServerCursor=");
        url.push_str(&urlencode(c));
    }
    url
}

/// Minimal percent-encoder for the handshake query values. The
/// `reqwest::Url` crate would work but we want to avoid a fresh dep when
/// these inputs are UUID-shaped.
fn urlencode(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for b in s.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(b as char)
            }
            _ => {
                out.push('%');
                out.push_str(&format!("{b:02X}"));
            }
        }
    }
    out
}

type WsStream = WebSocketStream<MaybeTlsStream<TcpStream>>;

async fn connect_and_run(
    config: &SyncClientConfig,
    token: &str,
    cursor: Option<String>,
    inner: &Arc<SyncClientInner>,
) -> Result<(), ConnectError> {
    let url = build_duplex_url(&config.base_url, &config.client_id, cursor.as_deref());
    log::info!("sync_client: connecting to {url}");

    let mut req = url
        .into_client_request()
        .map_err(|e| ConnectError::Transient(format!("build handshake request: {e}")))?;
    req.headers_mut().insert(
        "Authorization",
        format!("Bearer {token}")
            .parse()
            .map_err(|e| ConnectError::Transient(format!("bad auth header: {e}")))?,
    );

    let (stream, _response) = match tokio_tungstenite::connect_async(req).await {
        Ok(pair) => pair,
        Err(e) => {
            // tungstenite surfaces an HTTP error on the upgrade as
            // `Error::Http` *before* the socket is established. A 401 there is
            // the stale-bearer case the reconnect loop recovers via refresh;
            // everything else is transient.
            if let tokio_tungstenite::tungstenite::Error::Http(ref resp) = e
                && resp.status().as_u16() == 401
            {
                return Err(ConnectError::Unauthorized(format!("connect: {e}")));
            }
            return Err(ConnectError::Transient(format!("connect: {e}")));
        }
    };

    log::info!(
        "sync_client: duplex connected (client_id={})",
        config.client_id
    );

    run_duplex_session(stream, inner)
        .await
        .map_err(ConnectError::Transient)
}

async fn run_duplex_session(
    stream: WsStream,
    inner: &Arc<SyncClientInner>,
) -> Result<(), String> {
    let (mut sink, mut source) = stream.split();
    let (out_tx, mut out_rx) = mpsc::channel::<OutboundFrame>(32);
    // Publish the sender so external handlers (factory.run.request, etc.)
    // can emit acks while this session is alive.
    inner.set_outbound(Some(out_tx.clone()));
    let dispatch = &inner.dispatch;
    let last_cursor = &inner.last_cursor;

    // Heartbeat producer — independent task so a slow server read doesn't
    // block outbound heartbeats.
    let hb_tx = out_tx.clone();
    let heartbeat_task = tokio::spawn(async move {
        let mut ticker = interval(HEARTBEAT_INTERVAL);
        ticker.tick().await; // consume the immediate first tick
        loop {
            ticker.tick().await;
            let frame = OutboundFrame::Heartbeat {
                meta: new_meta(),
            };
            if hb_tx.send(frame).await.is_err() {
                break;
            }
        }
    });

    // Outbound writer — drains the mpsc channel onto the socket.
    let writer_task = tokio::spawn(async move {
        while let Some(frame) = out_rx.recv().await {
            let json = match serde_json::to_string(&frame) {
                Ok(j) => j,
                Err(e) => {
                    log::warn!("sync_client: serialize outbound: {e}");
                    continue;
                }
            };
            if let Err(e) = sink.send(Message::Text(json.into())).await {
                log::warn!("sync_client: outbound send failed: {e}");
                break;
            }
        }
    });

    // Inbound reader — blocks on the socket and dispatches.
    let read_result = async {
        while let Some(frame) = source.next().await {
            let msg = frame.map_err(|e| format!("read: {e}"))?;
            match msg {
                Message::Text(text) => {
                    handle_text_frame(&text, dispatch, last_cursor, &out_tx, inner).await;
                }
                Message::Binary(bytes) => {
                    match std::str::from_utf8(&bytes) {
                        Ok(text) => {
                            handle_text_frame(text, dispatch, last_cursor, &out_tx, inner).await;
                        }
                        Err(_) => log::warn!("sync_client: non-utf8 binary frame ignored"),
                    }
                }
                Message::Ping(_) | Message::Pong(_) => {}
                Message::Close(_) => {
                    log::info!("sync_client: server closed the duplex stream");
                    return Ok(());
                }
                Message::Frame(_) => {}
            }
        }
        Ok(())
    }
    .await;

    heartbeat_task.abort();
    inner.set_outbound(None);
    drop(out_tx);
    let _ = writer_task.await;
    read_result
}

async fn handle_text_frame(
    text: &str,
    dispatch: &Arc<DispatchTable>,
    last_cursor: &Arc<RwLock<Option<String>>>,
    out_tx: &mpsc::Sender<OutboundFrame>,
    inner: &Arc<SyncClientInner>,
) {
    let envelope: ServerEnvelopeWire = match serde_json::from_str(text) {
        Ok(e) => e,
        Err(e) => {
            log::warn!("sync_client: malformed envelope ({e}) — ignored");
            return;
        }
    };

    if !is_server_envelope(&envelope) {
        log::warn!(
            "sync_client: rejected envelope with unknown kind or bad schema: kind={} v={}",
            envelope.kind,
            envelope.meta.v
        );
        return;
    }

    // Update the last observed org cursor so we can resume on reconnect.
    if !envelope.meta.org_cursor.is_empty()
        && let Ok(mut g) = last_cursor.write()
    {
        *g = Some(envelope.meta.org_cursor.clone());
    }

    // Spec 198 FR-005 / FR-014 — reply-correlated frames are routed to the
    // registered waiter FIRST, before the normal dispatch path. If no waiter
    // is registered (unexpected unsolicited delivery), log a warning and drop.
    if matches!(
        envelope.kind.as_str(),
        "factory.run.grant"
            | "factory.run.certificate_countersign"
            | "audit.segment.countersign"
    ) {
        let kind = envelope.kind.clone();
        if !inner.resolve_reply_waiter(envelope) {
            log::warn!(
                "sync_client: received {kind} with no registered waiter (correlationId missing or stale) — dropped",
            );
        }
        return;
    }

    match envelope.kind.as_str() {
        "sync.heartbeat" => {
            // Server-side heartbeat. Our own heartbeat task handles the
            // outbound side; nothing more to do here.
        }
        "sync.resync_required" => {
            log::info!(
                "sync_client: server requested resync (reason={:?})",
                envelope.reason
            );
            let cursor = last_cursor.read().ok().and_then(|g| g.clone());
            let _ = out_tx
                .send(OutboundFrame::ResyncRequest {
                    meta: new_meta(),
                    since_cursor: cursor,
                    reason: Some("server_requested".to_string()),
                })
                .await;
        }
        "sync.hello" => {
            log::info!(
                "sync_client: duplex hello received (session_id={:?}, cursor_gap={:?})",
                envelope.session_id,
                envelope.cursor_gap
            );
            // Spec 183 FR-T2(b): the boot-gate's org-session readiness flag
            // flips on this envelope's receipt, which proves statecraft accepted
            // the handshake for the claimed (clientId, orgId).
            inner.mark_sync_hello_received();
            // Spec 207 AC-4: at (re)connect, submit any closed-but-unanchored
            // audit segment heads for platform countersign. Runs detached so
            // the read loop is never blocked; a transport failure mid-sweep
            // simply retries on the next reconnect. The duplex session id (the
            // seal scope key) only arrives here, on `sync.hello`.
            inner.set_session_id(envelope.session_id.clone());
            if let (Some(chain_dir), Some(session_id)) =
                (inner.audit_chain_dir(), envelope.session_id.clone())
            {
                // Only start a sweep when none is in flight (reconnect churn can
                // deliver `sync.hello` repeatedly). The SweepGuard resets the
                // flag when the task ends, even on panic.
                use std::sync::atomic::Ordering;
                if inner
                    .audit_sweep_active
                    .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
                    .is_ok()
                {
                    let inner = inner.clone();
                    tokio::spawn(async move {
                        let _guard = SweepGuard(inner.clone());
                        run_audit_countersign_sweep(&inner, chain_dir, session_id).await;
                    });
                }
            }
        }
        "sync.ack" | "sync.nack" => {
            // No inbox to reconcile yet — tracked in a later phase.
        }
        _ => {
            // Ack authoritative events before dispatching so a slow handler
            // doesn't stall the server's outbox tracking.
            let event_id = envelope.meta.event_id.clone();
            let _ = out_tx
                .send(OutboundFrame::Ack {
                    meta: new_meta(),
                    server_event_id: event_id,
                })
                .await;

            if let Some(handler) = dispatch.get(&envelope.kind) {
                handler.handle(&envelope);
            } else {
                log::info!(
                    "sync_client: received {} — no handler registered",
                    envelope.kind
                );
            }
        }
    }
}

pub(crate) fn new_meta() -> EnvelopeMeta {
    EnvelopeMeta {
        v: ENVELOPE_SCHEMA_VERSION,
        event_id: uuid::Uuid::new_v4().to_string(),
        sent_at: chrono::Utc::now().to_rfc3339(),
        correlation_id: None,
        causation_id: None,
    }
}

// ---------------------------------------------------------------------------
// Spec 207 AC-4 - session-audit segment countersign (OPC client side)
// ---------------------------------------------------------------------------
//
// The axiomregent sidecar (the producer, PR B2a) hash-chains every governed
// tool dispatch into a rotating segment under `<AXIOMREGENT_DATA_DIR>/audit`.
// The open segment is `permissions.jsonl`; rotation closes it with a
// `segment_head` record and shifts it to `permissions.jsonl.1` .. `.5` (see
// `policy_kernel::audit`). This module reads those closed segment heads off the
// shared disk and submits each for platform countersign, completing AC-4
// end-to-end. The local side holds no signing keys (spec 198 FR-014): it only
// attests the head hash + metadata; statecraft signs and persists the seal.

/// Open-segment file name written by the producer (`policy_kernel::audit`).
const AUDIT_SEGMENT_FILE: &str = "permissions.jsonl";
/// Closed-segment rotations the producer retains (`permissions.jsonl.1..=N`).
const MAX_AUDIT_ROTATIONS: usize = 5;
/// Local record of which closed segments statecraft has already countersigned,
/// so the sweep does not resubmit on every reconnect. Lives in the chain dir
/// (the producer only ever writes `permissions.jsonl*`, never this file).
const SEAL_STORE_FILE: &str = "countersigns.json";
/// Upper bound on a segment file we will read whole. The producer rotates at
/// 10 MB (`policy_kernel::audit::MAX_SIZE_BYTES`), so a legitimate segment is
/// always under this; the cap stops a pathological or hostile oversized file
/// (an attacker with local write access to the data dir) from OOM-ing the read.
const MAX_SEGMENT_READ_BYTES: u64 = 64 * 1024 * 1024;

/// Read a file whole only when it is within [`MAX_SEGMENT_READ_BYTES`].
/// Oversized or unreadable files yield `None` (the segment is skipped rather
/// than risking an unbounded allocation on the reading thread).
fn read_capped(path: &Path) -> Option<String> {
    let len = std::fs::metadata(path).ok()?.len();
    if len > MAX_SEGMENT_READ_BYTES {
        log::warn!(
            "sync_client: audit segment {} is {len} bytes (> {MAX_SEGMENT_READ_BYTES} cap); skipping",
            path.display()
        );
        return None;
    }
    std::fs::read_to_string(path).ok()
}

/// The producer's audit chain directory under the OPC-pinned data dir. Mirrors
/// `sidecars::spawn_axiomregent` (`<app_data_dir>/axiomregent/data`) plus the
/// `set_audit_chain(data_dir.join("audit"))` the agent applies on startup.
pub(crate) fn audit_chain_dir_under(app_data_dir: &Path) -> PathBuf {
    app_data_dir
        .join("axiomregent")
        .join("data")
        .join("audit")
}

/// A closed audit segment's head, read off the shared chain dir. Field names
/// map the producer's segment-head record (`policy_kernel::audit::build_head`)
/// onto the `audit.segment.countersign_request` wire shape.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SegmentHead {
    pub segment_id: String,
    /// The head record's own `record_hash` (anchors the closed segment).
    pub segment_head_hash: String,
    pub segment_record_count: u64,
    pub first_record_at: String,
    pub last_record_at: String,
}

/// Result of a single countersign submission (the parsed reply).
#[derive(Debug, Clone)]
pub struct AuditSegmentCountersignOutcome {
    pub segment_id: String,
    pub countersigned: bool,
    pub countersign_jws: Option<String>,
    pub kid: Option<String>,
    pub refused_reason: Option<String>,
}

/// The unanchored window (FR-004 residual surface): the still-open segment plus
/// any closed segments not yet countersigned. Serialised to the frontend.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct UnanchoredWindow {
    /// Records in the still-open (never-rotated) segment, which has no external
    /// anchor yet and is the broadest part of the residual.
    pub open_segment_record_count: u64,
    /// Closed (rotated) segments awaiting countersign.
    pub unsealed_closed_segments: Vec<UnanchoredSegment>,
    /// Closed segments already countersigned (anchored, out of the window).
    pub sealed_segment_count: usize,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct UnanchoredSegment {
    pub segment_id: String,
    pub record_count: u64,
    pub first_record_at: String,
    pub last_record_at: String,
}

/// Parse a closed segment file's trailing `segment_head` record into a
/// [`SegmentHead`]. Returns `None` when the file is absent, empty, or its last
/// line is not a segment head (an open or malformed segment is simply skipped).
fn read_segment_head(path: &Path) -> Option<SegmentHead> {
    let content = read_capped(path)?;
    let last = content.lines().rev().find(|l| !l.trim().is_empty())?;
    let v: Value = serde_json::from_str(last).ok()?;
    if v.get("segment_head").and_then(Value::as_bool) != Some(true) {
        return None;
    }
    Some(SegmentHead {
        segment_id: v.get("segment_id").and_then(Value::as_str)?.to_string(),
        segment_head_hash: v.get("record_hash").and_then(Value::as_str)?.to_string(),
        segment_record_count: v.get("record_count").and_then(Value::as_u64)?,
        first_record_at: v
            .get("first_timestamp")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string(),
        last_record_at: v
            .get("last_timestamp")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string(),
    })
}

/// Enumerate the heads of all retained closed segments (`permissions.jsonl.1`
/// through `.MAX_AUDIT_ROTATIONS`), newest first.
fn closed_segment_heads(chain_dir: &Path) -> Vec<SegmentHead> {
    let mut heads = Vec::new();
    for n in 1..=MAX_AUDIT_ROTATIONS {
        let p = chain_dir.join(format!("{AUDIT_SEGMENT_FILE}.{n}"));
        if let Some(head) = read_segment_head(&p) {
            heads.push(head);
        }
    }
    heads
}

fn seal_store_path(chain_dir: &Path) -> PathBuf {
    chain_dir.join(SEAL_STORE_FILE)
}

/// Load the local seal record (`segment_id` -> countersign metadata). A missing
/// or unparseable store reads as empty (the sweep re-submits, which is safe:
/// the platform upsert is idempotent on `(org, session, segment)`).
fn load_seals(chain_dir: &Path) -> serde_json::Map<String, Value> {
    std::fs::read_to_string(seal_store_path(chain_dir))
        .ok()
        .and_then(|s| serde_json::from_str::<Value>(&s).ok())
        .and_then(|v| v.as_object().cloned())
        .unwrap_or_default()
}

/// Persist one countersignature into the local seal store. Returns `true` only
/// when the write durably landed. The replace is atomic (write a temp sibling,
/// then rename over the target) so a crash mid-write can never leave a torn
/// `countersigns.json` that `load_seals` would read as empty (which would
/// re-submit every already-sealed segment).
fn record_seal(chain_dir: &Path, outcome: &AuditSegmentCountersignOutcome) -> bool {
    let mut seals = load_seals(chain_dir);
    seals.insert(
        outcome.segment_id.clone(),
        serde_json::json!({
            "countersignJws": outcome.countersign_jws,
            "kid": outcome.kid,
            "countersignedAt": chrono::Utc::now().to_rfc3339(),
        }),
    );
    let Ok(serialized) = serde_json::to_string_pretty(&Value::Object(seals)) else {
        return false;
    };
    let tmp_path = chain_dir.join(format!("{SEAL_STORE_FILE}.tmp"));
    if std::fs::write(&tmp_path, serialized).is_err() {
        return false;
    }
    std::fs::rename(&tmp_path, seal_store_path(chain_dir)).is_ok()
}

/// Spec 207 AC-4 - submit every closed-but-unsealed segment head for platform
/// countersign, recording each returned countersignature locally. Best-effort:
/// a refusal is logged and skipped; a transport failure stops the sweep so the
/// next reconnect retries from where it left off. Serialised by the caller's
/// in-flight guard (`audit_sweep_active`), so the seal-store read/write below is
/// the only writer for the duration of a sweep. Blocking file I/O is offloaded
/// to `spawn_blocking` (the file's keychain-read precedent), keeping the tokio
/// worker free for the duplex stream while a (up to 10 MB) segment is read.
async fn run_audit_countersign_sweep(
    inner: &SyncClientInner,
    chain_dir: PathBuf,
    session_id: String,
) {
    // Enumerate closed segments + load the seal store off the async runtime.
    let dir = chain_dir.clone();
    let Ok((heads, sealed)) =
        tokio::task::spawn_blocking(move || (closed_segment_heads(&dir), load_seals(&dir))).await
    else {
        return;
    };
    if heads.is_empty() {
        return;
    }
    let mut anchored = 0usize;
    for head in heads {
        if sealed.contains_key(&head.segment_id) {
            continue;
        }
        match inner
            .submit_audit_segment_countersign(&session_id, &head)
            .await
        {
            Ok(outcome) if outcome.countersigned => {
                let dir = chain_dir.clone();
                let to_persist = outcome.clone();
                let persisted =
                    tokio::task::spawn_blocking(move || record_seal(&dir, &to_persist)).await;
                if matches!(persisted, Ok(true)) {
                    anchored += 1;
                } else {
                    // The platform sealed it but the local store write failed.
                    // Safe: the seal upsert is idempotent on (org, session,
                    // segment), so the next reconnect re-submits and re-records.
                    log::warn!(
                        "sync_client: audit segment {} sealed by platform but local seal-store write failed; will re-record on next reconnect",
                        head.segment_id
                    );
                }
            }
            Ok(outcome) => {
                log::warn!(
                    "sync_client: audit segment {} countersign refused: {}",
                    head.segment_id,
                    outcome.refused_reason.as_deref().unwrap_or("unattributed")
                );
            }
            Err(e) => {
                log::warn!(
                    "sync_client: audit segment {} countersign failed ({e}) - will retry on next reconnect",
                    head.segment_id
                );
                break;
            }
        }
    }
    if anchored > 0 {
        log::info!("sync_client: anchored {anchored} audit segment head(s) via platform countersign");
    }
}

/// Count the data records in the still-open segment (excludes any trailing head,
/// which only a closed segment carries).
fn open_segment_record_count(chain_dir: &Path) -> u64 {
    let path = chain_dir.join(AUDIT_SEGMENT_FILE);
    let Some(content) = read_capped(&path) else {
        return 0;
    };
    content
        .lines()
        .filter(|l| !l.trim().is_empty())
        .filter_map(|l| serde_json::from_str::<Value>(l).ok())
        .filter(|v| v.get("segment_head").and_then(Value::as_bool) != Some(true))
        .count() as u64
}

/// Spec 207 AC-4 / FR-004 - compute the unanchored window from the chain dir on
/// disk: the open segment plus closed segments not yet in the local seal store.
pub(crate) fn compute_unanchored_window(chain_dir: &Path) -> UnanchoredWindow {
    let sealed = load_seals(chain_dir);
    let mut unsealed = Vec::new();
    let mut sealed_count = 0usize;
    for head in closed_segment_heads(chain_dir) {
        if sealed.contains_key(&head.segment_id) {
            sealed_count += 1;
        } else {
            unsealed.push(UnanchoredSegment {
                segment_id: head.segment_id,
                record_count: head.segment_record_count,
                first_record_at: head.first_record_at,
                last_record_at: head.last_record_at,
            });
        }
    }
    UnanchoredWindow {
        open_segment_record_count: open_segment_record_count(chain_dir),
        unsealed_closed_segments: unsealed,
        sealed_segment_count: sealed_count,
    }
}

/// Spec 207 AC-4 / FR-004 - the cockpit-queryable unanchored audit window: the
/// open segment plus any closed-but-uncountersigned segments. Honest residual
/// surface (the chain makes tampering evident only against an external anchor).
#[tauri::command]
pub fn audit_unanchored_window(app: tauri::AppHandle) -> Result<UnanchoredWindow, String> {
    use tauri::Manager as _;
    let base = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("app_data_dir unavailable: {e}"))?;
    Ok(compute_unanchored_window(&audit_chain_dir_under(&base)))
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    fn meta(v: u8, cursor: &str) -> ServerMeta {
        ServerMeta {
            v,
            event_id: "evt-1".into(),
            sent_at: "2026-04-21T00:00:00Z".into(),
            correlation_id: None,
            causation_id: None,
            org_cursor: cursor.into(),
            org_id: "org-1".into(),
        }
    }

    fn empty_envelope(kind: &str, v: u8) -> ServerEnvelopeWire {
        ServerEnvelopeWire {
            kind: kind.into(),
            meta: meta(v, "c1"),
            policy_bundle_id: None,
            summary: None,
            user_id: None,
            change: None,
            details: None,
            project_id: None,
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
            adapter: None,
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
        }
    }

    #[test]
    fn accepts_known_kinds_at_current_version() {
        for kind in [
            "factory.run.request",
            "factory.event",
            "sync.hello",
            "sync.heartbeat",
            "policy.updated",
            "project.catalog.upsert",
            "project.catalog.snapshot.complete",
        ] {
            assert!(
                is_server_envelope(&empty_envelope(kind, ENVELOPE_SCHEMA_VERSION)),
                "kind {kind} should pass the guard",
            );
        }
    }

    #[test]
    fn project_catalog_upsert_deserializes_from_wire_json() {
        // Mirrors the shape statecraft emits per spec 112 §7 — repo block
        // with camelCase fields and optional detectionLevel.
        let raw = r#"{
          "kind": "project.catalog.upsert",
          "meta": {
            "v": 2,
            "eventId": "e1",
            "sentAt": "2026-04-23T00:00:00Z",
            "orgCursor": "c-1",
            "orgId": "org-1"
          },
          "projectId": "p-1",
          "orgId": "org-1",
          "name": "Portal",
          "slug": "portal",
          "description": "desc",
          "factoryAdapterId": "adap-1",
          "detectionLevel": "scaffold_only",
          "repo": {
            "githubOrg": "acme",
            "repoName": "portal",
            "defaultBranch": "main",
            "cloneUrl": "https://github.com/acme/portal.git",
            "htmlUrl": "https://github.com/acme/portal"
          },
          "opcDeepLink": "opc://project/open?project_id=p-1&url=https%3A%2F%2Fgithub.com%2Facme%2Fportal.git&level=scaffold_only",
          "tombstone": false,
          "updatedAt": "2026-04-23T00:00:01Z"
        }"#;
        let env: ServerEnvelopeWire = serde_json::from_str(raw).expect("parses");
        assert!(is_server_envelope(&env));
        assert_eq!(env.kind, "project.catalog.upsert");
        assert_eq!(env.project_id.as_deref(), Some("p-1"));
        assert_eq!(env.name.as_deref(), Some("Portal"));
        assert_eq!(env.slug.as_deref(), Some("portal"));
        assert_eq!(env.detection_level.as_deref(), Some("scaffold_only"));
        assert_eq!(env.tombstone, Some(false));
        let repo = env.repo.expect("repo present");
        assert_eq!(repo.github_org, "acme");
        assert_eq!(repo.repo_name, "portal");
        assert_eq!(repo.default_branch, "main");
    }

    #[test]
    fn rejects_unknown_kind() {
        assert!(!is_server_envelope(&empty_envelope(
            "totally.made.up",
            ENVELOPE_SCHEMA_VERSION
        )));
    }

    #[test]
    fn rejects_wrong_schema_version() {
        // Post spec-119 the wire is v2 (see ENVELOPE_SCHEMA_VERSION). A frame
        // carrying the retired v1 — or any future version — must be rejected
        // by the strict-equality guard, even when the kind is otherwise known.
        assert!(!is_server_envelope(&empty_envelope("sync.hello", 1)));
        assert!(!is_server_envelope(&empty_envelope("sync.hello", 99)));
        // Sanity: the current version is accepted.
        assert!(is_server_envelope(&empty_envelope(
            "sync.hello",
            ENVELOPE_SCHEMA_VERSION
        )));
    }

    #[test]
    fn factory_run_request_deserializes_from_wire_json() {
        // Sample mirrors what statecraft sends — camelCase field names, with
        // knowledge and businessDocs arrays.
        let raw = r#"{
          "kind": "factory.run.request",
          "meta": {
            "v": 2,
            "eventId": "e1",
            "sentAt": "2026-04-21T00:00:00Z",
            "orgCursor": "cur-42",
            "orgId": "org-1"
          },
          "projectId": "p1",
          "pipelineId": "pl-1",
          "adapter": "rest",
          "actorUserId": "u1",
          "knowledge": [
            {
              "objectId": "k1",
              "filename": "spec.md",
              "contentHash": "abc",
              "downloadUrl": "https://example/k1"
            }
          ],
          "businessDocs": [{"name": "doc", "storageRef": "s3://x"}],
          "policyBundleId": "pb-1",
          "requestedAt": "2026-04-21T00:00:01Z",
          "deadlineAt": "2026-04-21T01:00:00Z"
        }"#;
        let env: ServerEnvelopeWire = serde_json::from_str(raw).expect("deserialize");
        assert!(is_server_envelope(&env));
        assert_eq!(env.pipeline_id.as_deref(), Some("pl-1"));
        assert_eq!(env.adapter.as_deref(), Some("rest"));
        assert_eq!(env.knowledge.as_ref().unwrap().len(), 1);
        assert_eq!(
            env.knowledge.as_ref().unwrap()[0].content_hash,
            "abc".to_string()
        );
        assert_eq!(env.meta.org_cursor, "cur-42");
    }

    #[test]
    fn dispatch_table_registers_and_dispatches() {
        use std::sync::atomic::{AtomicUsize, Ordering};
        let count = Arc::new(AtomicUsize::new(0));
        let c = count.clone();
        let table = DispatchTable::new();
        table.register(
            "factory.run.request",
            Arc::new(FnHandler(move |_env| {
                c.fetch_add(1, Ordering::SeqCst);
            })),
        );
        assert!(table.kinds().contains(&"factory.run.request".to_string()));

        let handler = table
            .get("factory.run.request")
            .expect("handler should be registered");
        handler.handle(&empty_envelope("factory.run.request", 1));
        handler.handle(&empty_envelope("factory.run.request", 1));
        assert_eq!(count.load(Ordering::SeqCst), 2);

        assert!(table.get("unknown.kind").is_none());
    }

    #[test]
    fn dispatch_table_replaces_existing_handler() {
        use std::sync::atomic::{AtomicUsize, Ordering};
        let hits = Arc::new(AtomicUsize::new(0));
        let h2 = hits.clone();
        let table = DispatchTable::new();
        table.register(
            "factory.event",
            Arc::new(FnHandler(|_env| {
                panic!("old handler should have been replaced");
            })),
        );
        table.register(
            "factory.event",
            Arc::new(FnHandler(move |_env| {
                h2.fetch_add(1, Ordering::SeqCst);
            })),
        );
        table
            .get("factory.event")
            .unwrap()
            .handle(&empty_envelope("factory.event", 1));
        assert_eq!(hits.load(Ordering::SeqCst), 1);
    }

    #[test]
    fn build_duplex_url_handles_https_http_and_cursor() {
        assert_eq!(
            build_duplex_url("https://statecraft.ing/", "cid-1", None),
            "wss://statecraft.ing/api/sync/duplex?clientId=cid-1&clientKind=desktop-opc"
        );
        assert_eq!(
            build_duplex_url("http://localhost:4000", "cid-1", Some("cur/42")),
            "ws://localhost:4000/api/sync/duplex?clientId=cid-1&clientKind=desktop-opc&lastServerCursor=cur%2F42"
        );
    }

    #[test]
    fn urlencode_escapes_reserved_chars() {
        assert_eq!(urlencode("abc-123.~_"), "abc-123.~_");
        assert_eq!(urlencode("a b/c?d"), "a%20b%2Fc%3Fd");
    }

    #[test]
    fn malformed_json_is_dropped_without_panic() {
        // Regression: a stray non-envelope frame must not crash the reader.
        let env: Result<ServerEnvelopeWire, _> = serde_json::from_str("{\"kind\":123}");
        assert!(env.is_err());
    }

    #[test]
    fn factory_run_ack_serializes_to_camelcase_wire_shape() {
        // Spec 110 §2.2: the wire shape must match statecraft's
        // ClientFactoryRunAck exactly — camelCase keys, the right `kind`,
        // and optional fields omitted when unset.
        let frame = OutboundFrame::FactoryRunAck {
            meta: EnvelopeMeta {
                v: ENVELOPE_SCHEMA_VERSION,
                event_id: "e1".into(),
                sent_at: "2026-04-21T00:00:00Z".into(),
                correlation_id: None,
                causation_id: None,
            },
            pipeline_id: "pl-1".into(),
            session_id: "s-1".into(),
            opc_instance_id: "opc-1".into(),
            accepted: true,
            decline_reason: None,
            observed_at: "2026-04-21T00:00:01Z".into(),
        };
        let json = serde_json::to_value(&frame).unwrap();
        assert_eq!(json["kind"], "factory.run.ack");
        assert_eq!(json["pipelineId"], "pl-1");
        assert_eq!(json["sessionId"], "s-1");
        assert_eq!(json["opcInstanceId"], "opc-1");
        assert_eq!(json["accepted"], true);
        assert!(
            json.get("declineReason").is_none(),
            "declineReason must be omitted when None"
        );
        assert_eq!(json["observedAt"], "2026-04-21T00:00:01Z");
        assert_eq!(json["meta"]["v"], ENVELOPE_SCHEMA_VERSION);
        assert_eq!(json["meta"]["eventId"], "e1");
    }

    #[test]
    fn factory_run_ack_include_decline_reason_when_rejected() {
        let frame = OutboundFrame::FactoryRunAck {
            meta: EnvelopeMeta {
                v: ENVELOPE_SCHEMA_VERSION,
                event_id: "e1".into(),
                sent_at: "2026-04-21T00:00:00Z".into(),
                correlation_id: None,
                causation_id: None,
            },
            pipeline_id: "pl-1".into(),
            session_id: "s-1".into(),
            opc_instance_id: "opc-1".into(),
            accepted: false,
            decline_reason: Some("knowledge_hash_mismatch".into()),
            observed_at: "2026-04-21T00:00:01Z".into(),
        };
        let json = serde_json::to_value(&frame).unwrap();
        assert_eq!(json["accepted"], false);
        assert_eq!(json["declineReason"], "knowledge_hash_mismatch");
    }

    // spec 111 §2.3 — agent.catalog.{updated,snapshot} must be recognised as
    // known SERVER→CLIENT kinds so the duplex consumer doesn't drop them.
    #[test]
    fn accepts_agent_catalog_kinds_at_current_version() {
        for kind in ["agent.catalog.updated", "agent.catalog.snapshot"] {
            assert!(
                is_server_envelope(&empty_envelope(kind, ENVELOPE_SCHEMA_VERSION)),
                "kind {kind} should pass the guard",
            );
        }
    }

    #[test]
    fn agent_catalog_updated_deserializes_from_wire_json() {
        // Triple-# raw delimiter so the JSON body "# body" (which contains a
        // `"#` sequence) doesn't terminate the Rust raw literal early.
        let raw = r###"{
          "kind": "agent.catalog.updated",
          "meta": {
            "v": 2,
            "eventId": "e-ag",
            "sentAt": "2026-04-22T00:00:00Z",
            "orgCursor": "cur-1",
            "orgId": "org-1"
          },
          "agentId": "a-1",
          "name": "triage",
          "version": 2,
          "status": "published",
          "contentHash": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          "frontmatter": {"name": "triage", "extra": {"k": "v"}},
          "bodyMarkdown": "# body",
          "updatedAt": "2026-04-22T00:05:00Z"
        }"###;
        let env: ServerEnvelopeWire = serde_json::from_str(raw).expect("deserialize");
        assert!(is_server_envelope(&env));
        assert_eq!(env.agent_id.as_deref(), Some("a-1"));
        assert_eq!(env.name.as_deref(), Some("triage"));
        assert_eq!(env.version, Some(2));
        assert_eq!(env.status.as_deref(), Some("published"));
        assert_eq!(env.body_markdown.as_deref(), Some("# body"));
        // Frontmatter is decoded as serde_json::Value so the extra flatten
        // keys round-trip opaquely on the desktop side.
        assert_eq!(
            env.frontmatter.as_ref().and_then(|v| v.get("name")),
            Some(&Value::String("triage".into()))
        );
    }

    #[test]
    fn agent_catalog_snapshot_deserializes_directory_entries() {
        let raw = r#"{
          "kind": "agent.catalog.snapshot",
          "meta": {
            "v": 2,
            "eventId": "e-snap",
            "sentAt": "2026-04-22T00:00:00Z",
            "orgCursor": "cur-2",
            "orgId": "org-1"
          },
          "entries": [
            {
              "agentId": "a-1",
              "name": "triage",
              "version": 2,
              "status": "published",
              "contentHash": "aaaa",
              "updatedAt": "2026-04-22T00:05:00Z"
            }
          ],
          "generatedAt": "2026-04-22T00:06:00Z"
        }"#;
        let env: ServerEnvelopeWire = serde_json::from_str(raw).expect("deserialize");
        assert!(is_server_envelope(&env));
        let entries = env.entries.as_ref().expect("entries present");
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].agent_id, "a-1");
        assert_eq!(entries[0].status, "published");
        assert_eq!(env.generated_at.as_deref(), Some("2026-04-22T00:06:00Z"));
    }

    #[test]
    fn agent_catalog_fetch_request_serializes_to_camelcase_wire_shape() {
        // Spec 111 §2.3 — reason is a closed set; verify the snake_case
        // serde rename produces the expected wire strings.
        let frame = OutboundFrame::AgentCatalogFetchRequest {
            meta: EnvelopeMeta {
                v: ENVELOPE_SCHEMA_VERSION,
                event_id: "e1".into(),
                sent_at: "2026-04-22T00:00:00Z".into(),
                correlation_id: None,
                causation_id: None,
            },
            agent_id: "a-1".into(),
            reason: AgentCatalogFetchReason::HashMismatch,
            observed_at: "2026-04-22T00:00:01Z".into(),
        };
        let json = serde_json::to_value(&frame).unwrap();
        assert_eq!(json["kind"], "agent.catalog.fetch_request");
        assert_eq!(json["agentId"], "a-1");
        assert_eq!(json["reason"], "hash_mismatch");
        assert_eq!(json["observedAt"], "2026-04-22T00:00:01Z");
        assert_eq!(json["meta"]["v"], ENVELOPE_SCHEMA_VERSION);
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn send_agent_catalog_fetch_request_emits_frame_when_connected() {
        let inner = Arc::new(SyncClientInner::default());
        let (tx, mut rx) = mpsc::channel::<OutboundFrame>(8);
        inner.set_outbound(Some(tx));

        let sent = inner
            .send_agent_catalog_fetch_request(
                "a-1",
                AgentCatalogFetchReason::CacheMiss,
            )
            .await;
        assert!(sent);

        let frame = rx.recv().await.expect("frame on channel");
        match frame {
            OutboundFrame::AgentCatalogFetchRequest {
                agent_id,
                reason,
                ..
            } => {
                assert_eq!(agent_id, "a-1");
                assert!(matches!(reason, AgentCatalogFetchReason::CacheMiss));
            }
            other => panic!("unexpected frame: {other:?}"),
        }
    }

    // spec 123 §7.2 — project.agent_binding.{updated,snapshot} must be
    // recognised as known SERVER→CLIENT kinds.
    #[test]
    fn accepts_project_agent_binding_kinds_at_current_version() {
        for kind in [
            "project.agent_binding.updated",
            "project.agent_binding.snapshot",
        ] {
            assert!(
                is_server_envelope(&empty_envelope(kind, ENVELOPE_SCHEMA_VERSION)),
                "kind {kind} should pass the guard",
            );
        }
    }

    #[test]
    fn project_agent_binding_updated_deserializes_from_wire_json() {
        let raw = r#"{
          "kind": "project.agent_binding.updated",
          "meta": {
            "v": 2,
            "eventId": "e-bind",
            "sentAt": "2026-05-01T00:00:00Z",
            "orgCursor": "cur-3",
            "orgId": "org-1"
          },
          "projectId": "proj-1",
          "bindingId": "bind-1",
          "orgAgentId": "a-1",
          "agentName": "triage",
          "pinnedVersion": 3,
          "pinnedContentHash": "h-3",
          "action": "bound",
          "boundAt": "2026-05-01T00:00:01Z"
        }"#;
        let env: ServerEnvelopeWire = serde_json::from_str(raw).expect("deserialize");
        assert!(is_server_envelope(&env));
        assert_eq!(env.project_id.as_deref(), Some("proj-1"));
        assert_eq!(env.binding_id.as_deref(), Some("bind-1"));
        assert_eq!(env.org_agent_id.as_deref(), Some("a-1"));
        assert_eq!(env.agent_name.as_deref(), Some("triage"));
        assert_eq!(env.pinned_version, Some(3));
        assert_eq!(env.pinned_content_hash.as_deref(), Some("h-3"));
        assert_eq!(env.action.as_deref(), Some("bound"));
        assert_eq!(env.bound_at.as_deref(), Some("2026-05-01T00:00:01Z"));
    }

    #[test]
    fn project_agent_binding_snapshot_deserializes_from_wire_json() {
        let raw = r#"{
          "kind": "project.agent_binding.snapshot",
          "meta": {
            "v": 2,
            "eventId": "e-bsnap",
            "sentAt": "2026-05-01T00:00:00Z",
            "orgCursor": "cur-4",
            "orgId": "org-1"
          },
          "projectId": "proj-1",
          "bindings": [
            {
              "bindingId": "bind-1",
              "orgAgentId": "a-1",
              "agentName": "triage",
              "pinnedVersion": 3,
              "pinnedContentHash": "h-3"
            }
          ]
        }"#;
        let env: ServerEnvelopeWire = serde_json::from_str(raw).expect("deserialize");
        assert!(is_server_envelope(&env));
        assert_eq!(env.project_id.as_deref(), Some("proj-1"));
        let bindings = env.bindings.as_ref().expect("bindings present");
        assert_eq!(bindings.len(), 1);
        assert_eq!(bindings[0].binding_id, "bind-1");
        assert_eq!(bindings[0].org_agent_id, "a-1");
        assert_eq!(bindings[0].agent_name, "triage");
        assert_eq!(bindings[0].pinned_version, 3);
        assert_eq!(bindings[0].pinned_content_hash, "h-3");
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn send_without_active_session_returns_false() {
        // External handlers call send() before the duplex stream connects.
        // The contract is best-effort drop — return false, never block.
        let inner = Arc::new(SyncClientInner::default());
        let sent = inner
            .send_factory_run_ack("pl", "sid", "opc", true, None)
            .await;
        assert!(!sent);
    }

    // spec 124 §6.1 — factory.run.* lifecycle envelope round-trips. Each
    // outbound frame must serialise to camelCase wire JSON the platform
    // ClientEnvelopeWire can decode, with the per-kind contract version
    // mirrored from the TS constant.

    #[test]
    fn factory_run_envelope_version_matches_documented_constant() {
        // Phase 0 lock — bumping FACTORY_RUN_ENVELOPE_VERSION must happen
        // here AND in `platform/services/statecraft/api/sync/types.ts` in
        // lock-step. The compile-time mismatch would surface in T036's
        // platform-side handler tests, but the Rust-side assertion is
        // simpler to read in review.
        assert_eq!(FACTORY_RUN_ENVELOPE_VERSION, 1);
    }

    #[test]
    fn factory_run_stage_started_serializes_to_camelcase_wire_shape() {
        let frame = OutboundFrame::FactoryRunStageStarted {
            meta: EnvelopeMeta {
                v: ENVELOPE_SCHEMA_VERSION,
                event_id: "e1".into(),
                sent_at: "2026-05-01T00:00:00Z".into(),
                correlation_id: None,
                causation_id: None,
            },
            run_id: "r-1".into(),
            stage_id: "s0".into(),
            agent_ref: FactoryAgentRef {
                org_agent_id: "a-1".into(),
                version: 3,
                content_hash: "h-3".into(),
            },
            started_at: "2026-05-01T00:00:01Z".into(),
        };
        let json = serde_json::to_value(&frame).unwrap();
        assert_eq!(json["kind"], "factory.run.stage_started");
        assert_eq!(json["runId"], "r-1");
        assert_eq!(json["stageId"], "s0");
        assert_eq!(json["agentRef"]["orgAgentId"], "a-1");
        assert_eq!(json["agentRef"]["version"], 3);
        assert_eq!(json["agentRef"]["contentHash"], "h-3");
        assert_eq!(json["startedAt"], "2026-05-01T00:00:01Z");
        assert_eq!(json["meta"]["v"], ENVELOPE_SCHEMA_VERSION);
    }

    #[test]
    fn factory_run_stage_completed_serializes_outcome_as_snake_case() {
        let frame = OutboundFrame::FactoryRunStageCompleted {
            meta: EnvelopeMeta {
                v: ENVELOPE_SCHEMA_VERSION,
                event_id: "e1".into(),
                sent_at: "2026-05-01T00:00:00Z".into(),
                correlation_id: None,
                causation_id: None,
            },
            run_id: "r-1".into(),
            stage_id: "s0".into(),
            stage_outcome: FactoryStageOutcome::Failed,
            error: Some("oops".into()),
            completed_at: "2026-05-01T00:01:00Z".into(),
        };
        let json = serde_json::to_value(&frame).unwrap();
        assert_eq!(json["kind"], "factory.run.stage_completed");
        assert_eq!(json["stageOutcome"], "failed");
        assert_eq!(json["error"], "oops");
        assert_eq!(json["completedAt"], "2026-05-01T00:01:00Z");
    }

    #[test]
    fn factory_run_stage_completed_omits_error_when_ok() {
        let frame = OutboundFrame::FactoryRunStageCompleted {
            meta: EnvelopeMeta {
                v: ENVELOPE_SCHEMA_VERSION,
                event_id: "e1".into(),
                sent_at: "2026-05-01T00:00:00Z".into(),
                correlation_id: None,
                causation_id: None,
            },
            run_id: "r-1".into(),
            stage_id: "s0".into(),
            stage_outcome: FactoryStageOutcome::Ok,
            error: None,
            completed_at: "2026-05-01T00:01:00Z".into(),
        };
        let json = serde_json::to_value(&frame).unwrap();
        assert_eq!(json["stageOutcome"], "ok");
        assert!(
            json.get("error").is_none(),
            "error must be omitted when None — kept off the wire to mirror the TS optional shape"
        );
    }

    #[test]
    fn factory_run_completed_carries_token_spend() {
        let frame = OutboundFrame::FactoryRunCompleted {
            meta: EnvelopeMeta {
                v: ENVELOPE_SCHEMA_VERSION,
                event_id: "e1".into(),
                sent_at: "2026-05-01T00:00:00Z".into(),
                correlation_id: None,
                causation_id: None,
            },
            run_id: "r-1".into(),
            token_spend: FactoryRunTokenSpend {
                input: 100,
                output: 250,
                total: 350,
            },
            completed_at: "2026-05-01T00:05:00Z".into(),
            certificate_sha256: None,
            seq: None,
        };
        let json = serde_json::to_value(&frame).unwrap();
        assert_eq!(json["kind"], "factory.run.completed");
        assert_eq!(json["tokenSpend"]["input"], 100);
        assert_eq!(json["tokenSpend"]["output"], 250);
        assert_eq!(json["tokenSpend"]["total"], 350);
        // Spec 198 FR-014 — optional cert fields must be absent from the wire
        // when None to keep backward compat with statecraft pre-198 handlers.
        assert!(json.get("certificateSha256").is_none());
        assert!(json.get("seq").is_none());
    }

    #[test]
    fn factory_run_failed_serializes_error_inline() {
        let frame = OutboundFrame::FactoryRunFailed {
            meta: EnvelopeMeta {
                v: ENVELOPE_SCHEMA_VERSION,
                event_id: "e1".into(),
                sent_at: "2026-05-01T00:00:00Z".into(),
                correlation_id: None,
                causation_id: None,
            },
            run_id: "r-1".into(),
            error: "stage s2 failed: pattern resolver missing".into(),
            completed_at: "2026-05-01T00:02:00Z".into(),
        };
        let json = serde_json::to_value(&frame).unwrap();
        assert_eq!(json["kind"], "factory.run.failed");
        assert_eq!(
            json["error"],
            "stage s2 failed: pattern resolver missing"
        );
        assert_eq!(json["completedAt"], "2026-05-01T00:02:00Z");
    }

    #[test]
    fn factory_run_cancelled_omits_reason_when_unset() {
        let frame = OutboundFrame::FactoryRunCancelled {
            meta: EnvelopeMeta {
                v: ENVELOPE_SCHEMA_VERSION,
                event_id: "e1".into(),
                sent_at: "2026-05-01T00:00:00Z".into(),
                correlation_id: None,
                causation_id: None,
            },
            run_id: "r-1".into(),
            reason: None,
            completed_at: "2026-05-01T00:03:00Z".into(),
        };
        let json = serde_json::to_value(&frame).unwrap();
        assert_eq!(json["kind"], "factory.run.cancelled");
        assert!(json.get("reason").is_none());
        assert_eq!(json["completedAt"], "2026-05-01T00:03:00Z");
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn send_factory_run_stage_started_emits_frame_when_connected() {
        let inner = Arc::new(SyncClientInner::default());
        let (tx, mut rx) = mpsc::channel::<OutboundFrame>(8);
        inner.set_outbound(Some(tx));

        let agent_ref = FactoryAgentRef {
            org_agent_id: "a-1".into(),
            version: 2,
            content_hash: "h-2".into(),
        };
        let sent = inner
            .send_factory_run_stage_started("r-1", "s0", agent_ref.clone())
            .await;
        assert!(sent);

        let frame = rx.recv().await.expect("frame on channel");
        match frame {
            OutboundFrame::FactoryRunStageStarted {
                run_id,
                stage_id,
                agent_ref: got,
                ..
            } => {
                assert_eq!(run_id, "r-1");
                assert_eq!(stage_id, "s0");
                assert_eq!(got, agent_ref);
            }
            other => panic!("unexpected frame: {other:?}"),
        }
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn send_with_active_session_enqueues_on_channel() {
        let inner = Arc::new(SyncClientInner::default());
        let (tx, mut rx) = mpsc::channel::<OutboundFrame>(8);
        inner.set_outbound(Some(tx));

        let sent = inner
            .send_factory_run_ack("pl", "sid", "opc", true, None)
            .await;
        assert!(sent);

        let frame = rx.recv().await.expect("frame on channel");
        match frame {
            OutboundFrame::FactoryRunAck {
                pipeline_id,
                session_id,
                opc_instance_id,
                accepted,
                ..
            } => {
                assert_eq!(pipeline_id, "pl");
                assert_eq!(session_id, "sid");
                assert_eq!(opc_instance_id, "opc");
                assert!(accepted);
            }
            other => panic!("unexpected frame: {other:?}"),
        }
    }

    // ── Spec 183 FR-T2(b) — sync.hello observer ──────────────────────────
    //
    // AC-6 binds: statecraft emits `sync.hello` on accepted handshake; the
    // desktop's observer in `sync_client.rs` MUST flip the org-session
    // readiness flag exactly when that envelope arrives. The
    // primitive-level test pins the inner flag state machine; the
    // dispatch-level test drives a real JSON envelope through
    // `handle_text_frame` to assert the wire→flag path.

    #[test]
    fn sync_hello_flag_starts_false_and_flips_via_primitives() {
        let inner = SyncClientInner::default();
        assert!(!inner.sync_hello_received(), "default state is false");
        inner.mark_sync_hello_received();
        assert!(inner.sync_hello_received(), "mark flips to true");
        inner.reset_sync_hello_received();
        assert!(
            !inner.sync_hello_received(),
            "reset returns to false (FR-T5(b) give-up reset path)",
        );
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn dispatch_sync_hello_envelope_flips_observer_flag() {
        let inner = Arc::new(SyncClientInner::default());
        let dispatch = Arc::new(DispatchTable::new());
        let last_cursor = Arc::new(RwLock::new(None::<String>));
        // out_tx is required by handle_text_frame but the sync.hello arm
        // doesn't push to it; a never-receiving sink is fine here.
        let (tx, _rx) = mpsc::channel::<OutboundFrame>(8);

        assert!(
            !inner.sync_hello_received(),
            "pre-dispatch: org-session gate is closed",
        );

        // Mirror the wire shape statecraft emits on an accepted handshake
        // (`api/sync/duplex.ts` line 121, kind `sync.hello`). The schema
        // version is v=2 per the envelope-version guard (spec 119).
        let hello = r#"{
            "kind": "sync.hello",
            "meta": {
                "v": 2,
                "eventId": "evt-hello-1",
                "sentAt": "2026-05-25T00:00:00Z",
                "orgCursor": "cur-hello-1",
                "orgId": "org-1"
            },
            "sessionId": "session-abc",
            "cursorGap": false,
            "serverStartedAt": "2026-05-25T00:00:00Z"
        }"#;

        handle_text_frame(hello, &dispatch, &last_cursor, &tx, &inner).await;

        assert!(
            inner.sync_hello_received(),
            "post-dispatch: FR-T2(b) org-session readiness flips on sync.hello receipt",
        );
        // The envelope also updates the last-observed org cursor (resume
        // anchor for reconnect); confirm that side-effect lands.
        assert_eq!(
            last_cursor.read().unwrap().as_deref(),
            Some("cur-hello-1"),
        );
    }

    // ── Spec 198 FR-005 / FR-014 — grant envelope constants + reply-correlation

    #[test]
    fn factory_run_grant_envelope_version_matches_documented_constant() {
        // Phase 0 lock — bumping FACTORY_RUN_GRANT_ENVELOPE_VERSION must happen
        // here AND in `platform/services/statecraft/api/sync/types.ts` in
        // lock-step.
        assert_eq!(FACTORY_RUN_GRANT_ENVELOPE_VERSION, 2);
    }

    // Spec 208 FR-001/FR-003: org-halt envelope constant + ack wire shape.

    #[test]
    fn org_halt_envelope_version_matches_documented_constant() {
        // Lock: bumping ORG_HALT_ENVELOPE_VERSION must happen here AND in
        // `platform/services/statecraft/api/sync/types.ts` in lock-step (spec
        // 189 parity discipline).
        assert_eq!(ORG_HALT_ENVELOPE_VERSION, 1);
    }

    #[test]
    fn org_halt_ack_serializes_with_correct_wire_field_names() {
        let frame = OutboundFrame::OrgHaltAck {
            meta: EnvelopeMeta {
                v: ENVELOPE_SCHEMA_VERSION,
                event_id: "e-halt-ack-1".into(),
                sent_at: "2026-06-25T00:00:00Z".into(),
                correlation_id: None,
                causation_id: None,
            },
            halt_id: "halt-1".into(),
            halt_kind: OrgHaltAckKind::Halt,
            acked_at: "2026-06-25T00:00:01Z".into(),
        };
        let v = serde_json::to_value(&frame).expect("serialize org.halt.ack");
        assert_eq!(v["kind"], "org.halt.ack");
        assert_eq!(v["haltId"], "halt-1");
        // The halt-vs-lift discriminator rides `haltKind`, not the envelope
        // `kind`, and serialises lowercase to match the TS wire + the
        // `org_halts.acks[].kind` column.
        assert_eq!(v["haltKind"], "halt");
        assert_eq!(v["ackedAt"], "2026-06-25T00:00:01Z");
        assert_eq!(
            serde_json::to_value(OrgHaltAckKind::Lift).expect("serialize lift kind"),
            serde_json::json!("lift"),
        );
    }

    #[test]
    fn factory_run_grant_request_serializes_with_correct_wire_field_names() {
        let frame = OutboundFrame::FactoryRunGrantRequest {
            meta: EnvelopeMeta {
                v: ENVELOPE_SCHEMA_VERSION,
                event_id: "e-gr1".into(),
                sent_at: "2026-06-09T00:00:00Z".into(),
                correlation_id: None,
                causation_id: None,
            },
            run_id: "run-1".into(),
            goal_id: "goal-abcd1234abcd1234".into(),
            goal: "scaffold the portal".into(),
            capsule_hash: "cafebabe".into(),
            envelope_hash: "deadbeef".into(),
            build_spec_hash: Some("bsbsbsbs".into()),
            project_id: Some("proj-1".into()),
            constraints: Some(vec!["no-deploy-without-gate".into()]),
        };
        let json = serde_json::to_value(&frame).unwrap();
        assert_eq!(json["kind"], "factory.run.grant_request");
        assert_eq!(json["runId"], "run-1");
        assert_eq!(json["goalId"], "goal-abcd1234abcd1234");
        assert_eq!(json["goal"], "scaffold the portal");
        assert_eq!(json["capsuleHash"], "cafebabe");
        assert_eq!(json["envelopeHash"], "deadbeef");
        assert_eq!(json["buildSpecHash"], "bsbsbsbs");
        assert_eq!(json["projectId"], "proj-1");
    }

    #[test]
    fn factory_run_grant_renew_serializes_with_correct_wire_field_names() {
        let frame = OutboundFrame::FactoryRunGrantRenew {
            meta: EnvelopeMeta {
                v: ENVELOPE_SCHEMA_VERSION,
                event_id: "e-grr1".into(),
                sent_at: "2026-06-09T00:00:01Z".into(),
                correlation_id: None,
                causation_id: None,
            },
            run_id: "run-1".into(),
            goal_id: "goal-abcd1234abcd1234".into(),
            capsule_hash: "cafebabe".into(),
            seq: 2,
            stage_id: Some("phase-1".into()),
            agent_profile: Some("api-scaffolder".into()),
            build_spec_hash: Some("bsbsbsbs".into()),
        };
        let json = serde_json::to_value(&frame).unwrap();
        assert_eq!(json["kind"], "factory.run.grant_renew");
        assert_eq!(json["runId"], "run-1");
        assert_eq!(json["goalId"], "goal-abcd1234abcd1234");
        assert_eq!(json["capsuleHash"], "cafebabe");
        assert_eq!(json["seq"], 2);
        assert_eq!(json["stageId"], "phase-1");
        // Spec 208 FR-001/AC-3: the agent profile rides `agentProfile` on the
        // wire, the exact key grantDuplexHandlers.ts reads as evt.agentProfile.
        assert_eq!(json["agentProfile"], "api-scaffolder");
        assert_eq!(json["buildSpecHash"], "bsbsbsbs");
    }

    #[test]
    fn resolve_reply_waiter_delivers_to_registered_waiter() {
        let inner = SyncClientInner::default();
        let (tx, mut rx) = oneshot::channel::<ServerEnvelopeWire>();
        {
            inner
                .reply_waiters
                .lock()
                .unwrap()
                .insert("evt-1".into(), tx);
        }
        // Build an inbound envelope whose correlationId matches the waiter key.
        let mut env = empty_envelope("factory.run.grant", ENVELOPE_SCHEMA_VERSION);
        env.meta.correlation_id = Some("evt-1".into());
        env.granted = Some(true);
        let resolved = inner.resolve_reply_waiter(env);
        assert!(resolved, "waiter must be resolved");
        let delivered = rx.try_recv().expect("reply was delivered");
        assert_eq!(delivered.granted, Some(true));
    }

    #[test]
    fn resolve_reply_waiter_returns_false_when_no_waiter() {
        let inner = SyncClientInner::default();
        let mut env = empty_envelope("factory.run.grant", ENVELOPE_SCHEMA_VERSION);
        env.meta.correlation_id = Some("unknown-id".into());
        let resolved = inner.resolve_reply_waiter(env);
        assert!(!resolved, "no waiter registered — must return false");
    }

    #[test]
    fn resolve_reply_waiter_returns_false_when_no_correlation_id() {
        let inner = SyncClientInner::default();
        let (tx, _rx) = oneshot::channel::<ServerEnvelopeWire>();
        inner
            .reply_waiters
            .lock()
            .unwrap()
            .insert("evt-x".into(), tx);
        // Envelope with no correlationId cannot match any waiter.
        let env = empty_envelope("factory.run.grant", ENVELOPE_SCHEMA_VERSION);
        let resolved = inner.resolve_reply_waiter(env);
        assert!(!resolved);
    }

    // Spec 207 AC-4: session-audit segment countersign (OPC client side).

    #[test]
    fn accepts_audit_segment_countersign_kind() {
        // The reply must be a recognised SERVER->CLIENT kind so the duplex
        // consumer routes it to the reply waiter rather than dropping it.
        assert!(is_server_envelope(&empty_envelope(
            "audit.segment.countersign",
            ENVELOPE_SCHEMA_VERSION
        )));
    }

    #[test]
    fn audit_segment_countersign_request_serializes_to_camelcase_wire_shape() {
        // Must match `ClientAuditSegmentCountersignRequest` in
        // `platform/services/statecraft/api/sync/types.ts` exactly.
        let frame = OutboundFrame::AuditSegmentCountersignRequest {
            meta: EnvelopeMeta {
                v: ENVELOPE_SCHEMA_VERSION,
                event_id: "evt-as1".into(),
                sent_at: "2026-06-20T00:00:00Z".into(),
                correlation_id: None,
                causation_id: None,
            },
            project_id: None,
            session_id: "sess-1".into(),
            segment_id: "seg-1".into(),
            segment_head_hash: "sha256:head1".into(),
            segment_record_count: 7,
            first_record_at: "2026-06-20T00:00:00Z".into(),
            last_record_at: "2026-06-20T00:00:09Z".into(),
        };
        let json = serde_json::to_value(&frame).unwrap();
        assert_eq!(json["kind"], "audit.segment.countersign_request");
        assert_eq!(json["sessionId"], "sess-1");
        assert_eq!(json["segmentId"], "seg-1");
        assert_eq!(json["segmentHeadHash"], "sha256:head1");
        assert_eq!(json["segmentRecordCount"], 7);
        assert_eq!(json["firstRecordAt"], "2026-06-20T00:00:00Z");
        assert_eq!(json["lastRecordAt"], "2026-06-20T00:00:09Z");
        // projectId is optional and omitted when None.
        assert!(json.get("projectId").is_none());
        assert_eq!(json["meta"]["eventId"], "evt-as1");
    }

    #[test]
    fn audit_segment_countersign_reply_deserializes_from_wire_json() {
        // Mirrors the `ServerAuditSegmentCountersign` success reply shape.
        let raw = r#"{
          "kind": "audit.segment.countersign",
          "meta": {
            "v": 2,
            "eventId": "e-reply",
            "sentAt": "2026-06-20T00:00:10Z",
            "correlationId": "evt-as1",
            "orgCursor": "cur-1",
            "orgId": "org-1"
          },
          "sessionId": "sess-1",
          "segmentId": "seg-1",
          "countersigned": true,
          "countersignJws": "eyJ.jws.sig",
          "kid": "fk-2026-06"
        }"#;
        let env: ServerEnvelopeWire = serde_json::from_str(raw).expect("deserialize");
        assert!(is_server_envelope(&env));
        assert_eq!(env.session_id.as_deref(), Some("sess-1"));
        // The reply's echoed `segmentId` is ignored by serde (the client keys
        // the outcome off the submitted head + the reply correlation instead).
        assert_eq!(env.countersigned, Some(true));
        assert_eq!(env.countersign_jws.as_deref(), Some("eyJ.jws.sig"));
        assert_eq!(env.kid.as_deref(), Some("fk-2026-06"));
        assert_eq!(env.meta.correlation_id.as_deref(), Some("evt-as1"));
    }

    /// Write a closed segment file (data records + a trailing segment head)
    /// mirroring the producer's `policy_kernel::audit` rotation output.
    fn write_closed_segment(path: &Path, seg_id: &str, data_count: u64, head_hash: &str) {
        let mut lines = Vec::new();
        for i in 0..data_count {
            // Fixed timestamp: the value is irrelevant to any assertion (only
            // the trailing head is read), and a constant avoids malformed
            // seconds for data_count > 9.
            lines.push(format!(
                r#"{{"tool":"t{i}","decision":"allowed","timestamp":"2026-06-20T00:00:00Z","previous_record_hash":"p{i}","record_hash":"r{i}"}}"#
            ));
        }
        lines.push(format!(
            r#"{{"segment_head":true,"segment_id":"{seg_id}","record_count":{data_count},"first_timestamp":"2026-06-20T00:00:00Z","last_timestamp":"2026-06-20T00:00:09Z","previous_record_hash":"plast","record_hash":"{head_hash}"}}"#
        ));
        std::fs::write(path, format!("{}\n", lines.join("\n"))).unwrap();
    }

    #[test]
    fn read_segment_head_parses_trailing_head_and_skips_open_segment() {
        let tmp = tempfile::TempDir::new().unwrap();
        let closed = tmp.path().join("permissions.jsonl.1");
        write_closed_segment(&closed, "seg-a", 3, "sha256:head-a");
        let head = read_segment_head(&closed).expect("closed segment has a head");
        assert_eq!(head.segment_id, "seg-a");
        assert_eq!(head.segment_head_hash, "sha256:head-a");
        assert_eq!(head.segment_record_count, 3);
        assert_eq!(head.first_record_at, "2026-06-20T00:00:00Z");
        assert_eq!(head.last_record_at, "2026-06-20T00:00:09Z");

        // An open segment (no trailing head) yields None.
        let open = tmp.path().join("permissions.jsonl");
        std::fs::write(
            &open,
            "{\"tool\":\"x\",\"decision\":\"allowed\",\"record_hash\":\"o1\"}\n",
        )
        .unwrap();
        assert!(read_segment_head(&open).is_none());
        // A missing file yields None too.
        assert!(read_segment_head(&tmp.path().join("nope.jsonl.2")).is_none());
    }

    #[test]
    fn closed_segment_heads_enumerates_rotations() {
        let tmp = tempfile::TempDir::new().unwrap();
        write_closed_segment(&tmp.path().join("permissions.jsonl.1"), "seg-1", 2, "h1");
        write_closed_segment(&tmp.path().join("permissions.jsonl.2"), "seg-2", 4, "h2");
        // Gap at .3, .4, .5 (enumeration skips absent rotations).
        let heads = closed_segment_heads(tmp.path());
        assert_eq!(heads.len(), 2);
        assert_eq!(heads[0].segment_id, "seg-1");
        assert_eq!(heads[1].segment_id, "seg-2");
    }

    #[test]
    fn seal_store_round_trip_and_unanchored_window() {
        let tmp = tempfile::TempDir::new().unwrap();
        // Two closed segments + one open segment with 1 record.
        write_closed_segment(&tmp.path().join("permissions.jsonl.1"), "seg-1", 2, "h1");
        write_closed_segment(&tmp.path().join("permissions.jsonl.2"), "seg-2", 5, "h2");
        std::fs::write(
            &tmp.path().join("permissions.jsonl"),
            "{\"tool\":\"x\",\"decision\":\"allowed\",\"record_hash\":\"o1\"}\n",
        )
        .unwrap();

        // Before any seal: open(1) + both closed unsealed, none sealed.
        let w0 = compute_unanchored_window(tmp.path());
        assert_eq!(w0.open_segment_record_count, 1);
        assert_eq!(w0.unsealed_closed_segments.len(), 2);
        assert_eq!(w0.sealed_segment_count, 0);

        // Seal seg-1 and recompute: it leaves the window.
        assert!(record_seal(
            tmp.path(),
            &AuditSegmentCountersignOutcome {
                segment_id: "seg-1".into(),
                countersigned: true,
                countersign_jws: Some("jws-1".into()),
                kid: Some("kid-1".into()),
                refused_reason: None,
            },
        ));
        assert!(load_seals(tmp.path()).contains_key("seg-1"));
        // The atomic-replace temp file must not linger.
        assert!(!tmp.path().join("countersigns.json.tmp").exists());
        let w1 = compute_unanchored_window(tmp.path());
        assert_eq!(w1.sealed_segment_count, 1);
        assert_eq!(w1.unsealed_closed_segments.len(), 1);
        assert_eq!(w1.unsealed_closed_segments[0].segment_id, "seg-2");
        assert_eq!(w1.unsealed_closed_segments[0].record_count, 5);
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn submit_audit_segment_countersign_round_trips_reply() {
        let inner = Arc::new(SyncClientInner::default());
        let (tx, mut rx) = mpsc::channel::<OutboundFrame>(8);
        inner.set_outbound(Some(tx));

        // Responder: drain the request, mint a correlated reply, resolve it.
        let responder = {
            let inner = inner.clone();
            tokio::spawn(async move {
                let frame = rx.recv().await.expect("request frame");
                // Echo the request's segment id back to prove the client keys
                // the outcome off the head it submitted, not the wire echo.
                let (event_id, segment_id) = match frame {
                    OutboundFrame::AuditSegmentCountersignRequest {
                        meta, segment_id, ..
                    } => (meta.event_id, segment_id),
                    other => panic!("unexpected frame: {other:?}"),
                };
                assert_eq!(segment_id, "seg-9");
                let mut reply =
                    empty_envelope("audit.segment.countersign", ENVELOPE_SCHEMA_VERSION);
                reply.meta.correlation_id = Some(event_id);
                reply.session_id = Some("sess-1".into());
                reply.countersigned = Some(true);
                reply.countersign_jws = Some("jws-xyz".into());
                reply.kid = Some("fk-2026-06".into());
                assert!(inner.resolve_reply_waiter(reply), "waiter resolved");
            })
        };

        let head = SegmentHead {
            segment_id: "seg-9".into(),
            segment_head_hash: "sha256:head9".into(),
            segment_record_count: 4,
            first_record_at: "2026-06-20T00:00:00Z".into(),
            last_record_at: "2026-06-20T00:00:09Z".into(),
        };
        let outcome = inner
            .submit_audit_segment_countersign("sess-1", &head)
            .await
            .expect("countersign round-trips");
        assert!(outcome.countersigned);
        assert_eq!(outcome.segment_id, "seg-9");
        assert_eq!(outcome.countersign_jws.as_deref(), Some("jws-xyz"));
        assert_eq!(outcome.kid.as_deref(), Some("fk-2026-06"));
        responder.await.unwrap();
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn submit_audit_segment_countersign_maps_refusal() {
        // An attributable refusal (countersigned=false) must surface its reason
        // rather than be reported as sealed (the sweep then logs + skips it).
        let inner = Arc::new(SyncClientInner::default());
        let (tx, mut rx) = mpsc::channel::<OutboundFrame>(8);
        inner.set_outbound(Some(tx));

        let responder = {
            let inner = inner.clone();
            tokio::spawn(async move {
                let frame = rx.recv().await.expect("request frame");
                let event_id = match frame {
                    OutboundFrame::AuditSegmentCountersignRequest { meta, .. } => meta.event_id,
                    other => panic!("unexpected frame: {other:?}"),
                };
                let mut reply =
                    empty_envelope("audit.segment.countersign", ENVELOPE_SCHEMA_VERSION);
                reply.meta.correlation_id = Some(event_id);
                reply.countersigned = Some(false);
                reply.refused_reason = Some("signing authority not configured (FR-014)".into());
                assert!(inner.resolve_reply_waiter(reply));
            })
        };

        let head = SegmentHead {
            segment_id: "seg-r".into(),
            segment_head_hash: "sha256:headr".into(),
            segment_record_count: 1,
            first_record_at: "2026-06-20T00:00:00Z".into(),
            last_record_at: "2026-06-20T00:00:01Z".into(),
        };
        let outcome = inner
            .submit_audit_segment_countersign("sess-1", &head)
            .await
            .expect("reply received");
        assert!(!outcome.countersigned);
        assert_eq!(
            outcome.refused_reason.as_deref(),
            Some("signing authority not configured (FR-014)")
        );
        assert!(outcome.countersign_jws.is_none());
        responder.await.unwrap();
    }
}
