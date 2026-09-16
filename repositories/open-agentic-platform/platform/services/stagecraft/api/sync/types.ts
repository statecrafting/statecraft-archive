/**
 * Outbox / Inbox Sync Protocol — typed envelopes.
 *
 * Authority boundaries (per spec 087, amended by spec 119):
 *   - Statecraft is authoritative for identity, project, policy, grants,
 *     deployment/governance state, audit envelopes.
 *   - Desktop/OPC is authoritative for local execution progress, checkpoints,
 *     local agent/tool runs, local runtime observations.
 *
 * Sync is application/event-layer, NOT database replication.
 *
 * Spec 119: the session key is `orgId`. A connected OPC observes every
 * project in its org; project-scoped events carry `projectId` for desktop-
 * side filtering.
 *
 * Message flow:
 *   client -> server : ClientEnvelope   (inbox path)
 *   server -> client : ServerEnvelope   (outbox path)
 */
import type { StreamInOut } from "encore.dev/api";
import type { CatalogFrontmatter } from "../agents/frontmatter";

// ---------------------------------------------------------------------------
// Handshake
// ---------------------------------------------------------------------------

/** Sent by the client exactly once when opening the duplex stream. */
export interface SyncHandshake {
  /** Caller-generated UUID identifying this connection instance. */
  clientId: string;
  /** What kind of client is connecting. */
  clientKind: "desktop-opc" | "web-ui" | "agent-runner" | "unknown";
  /** Client software version — informational, for compat/debug. */
  clientVersion?: string;
  /**
   * Last server cursor the client observed, if any. The service MAY honour
   * this to replay missed messages once a durable outbox is wired in.
   */
  lastServerCursor?: string;
  /** Optional capabilities declared by the client. */
  capabilities?: string[];
}

// ---------------------------------------------------------------------------
// Common envelope metadata
// ---------------------------------------------------------------------------

/**
 * Envelope schema version.
 *
 * Spec 087 §5.3 FR-SYNC-003: every envelope MUST carry a schema version. The
 * current protocol is version 2 (spec 119 collapsed workspace → org as the
 * session key). The guard in `isClientEnvelope` rejects any other value.
 * Bumping this is a wire-format change and requires extending both the
 * TypeScript literal and the runtime guard in lock-step.
 */
export type EnvelopeSchemaVersion = 2;
export const ENVELOPE_SCHEMA_VERSION: EnvelopeSchemaVersion = 2;

/**
 * Spec 123 §7 — per-event-kind contract versions for the agent catalog and
 * project-binding envelopes. These are independent of the protocol-wide
 * `ENVELOPE_SCHEMA_VERSION` above (which guards `meta.v`); they document the
 * payload contract version that ships under each `kind`. Mirroring constants
 * (`AGENT_CATALOG_ENVELOPE_VERSION`, `PROJECT_AGENT_BINDING_ENVELOPE_VERSION`)
 * exist on the desktop side; a build-time mismatch surfaces as a Rust
 * compile error so a desktop / platform skew never reaches the wire.
 */
export const AGENT_CATALOG_ENVELOPE_VERSION = 2 as const;
export type AgentCatalogEnvelopeVersion = typeof AGENT_CATALOG_ENVELOPE_VERSION;

export const PROJECT_AGENT_BINDING_ENVELOPE_VERSION = 1 as const;
export type ProjectAgentBindingEnvelopeVersion =
  typeof PROJECT_AGENT_BINDING_ENVELOPE_VERSION;

/**
 * Spec 124 §6.1 — per-event-kind contract version for the `factory.run.*`
 * envelope family (stage_started, stage_completed, completed, failed,
 * cancelled). Independent of the protocol-wide `ENVELOPE_SCHEMA_VERSION` and
 * the spec-123 catalog/binding versions; the desktop mirror constant in
 * `apps/opc/src-tauri/src/commands/sync_client.rs` MUST equal this value
 * — a mismatch surfaces as a Rust build error before any wire skew is
 * possible.
 */
export const FACTORY_RUN_ENVELOPE_VERSION = 1 as const;
export type FactoryRunEnvelopeVersion = typeof FACTORY_RUN_ENVELOPE_VERSION;

/**
 * Spec 198 FR-005/FR-014 — per-event-kind contract version for the
 * run-grant envelope family (`factory.run.grant_request`, `.grant_renew`,
 * `.grant`, `.certificate_countersign`). Independent of
 * `FACTORY_RUN_ENVELOPE_VERSION` (the run lifecycle family is locked at 1;
 * grants are a new family, not a lifecycle payload change). The desktop
 * mirror constant in `apps/opc/src-tauri/src/commands/sync_client.rs` MUST
 * equal this value.
 *
 * v2 (spec 208 FR-001): `factory.run.grant_renew` gains optional
 * `agentProfile` for agent-profile-scoped org-halt renewal refusal (AC-3).
 */
export const FACTORY_RUN_GRANT_ENVELOPE_VERSION = 2 as const;
export type FactoryRunGrantEnvelopeVersion =
  typeof FACTORY_RUN_GRANT_ENVELOPE_VERSION;

/**
 * Spec 208 FR-001/FR-003: per-event-kind contract version for the org-halt
 * envelope family (`org.halt.activated`, `org.halt.lifted`, `org.halt.ack`).
 * Independent of the protocol-wide `ENVELOPE_SCHEMA_VERSION` (the kill-switch
 * adds variants to the existing v2 unions; it does not break the wire format,
 * which is the spec 124/198/207 precedent for adding a family). The desktop
 * mirror constant in `apps/opc/src-tauri/src/commands/sync_client.rs` MUST
 * equal this value; a skew surfaces as a Rust build error (spec 189 parity
 * discipline) before any wire drift is possible.
 */
export const ORG_HALT_ENVELOPE_VERSION = 1 as const;
export type OrgHaltEnvelopeVersion = typeof ORG_HALT_ENVELOPE_VERSION;

/**
 * Spec 198 FR-005 — attributable refusal reasons for run-grant issuance and
 * renewal. Every refusal is persisted (`factory_run_grants.status='refused'`)
 * — goal-shift and revocation refusals are governance evidence (ASI01 m4/m7),
 * not transient errors.
 */
export type RunGrantRefusalReason =
  | "unknown-run"
  | "not-admitted"
  | "envelope-mismatch"
  | "revoked"
  // Spec 208 FR-001/FR-002: an org/project-scoped halt refuses grant issuance
  // and renewal, so in-flight runs pause at the next stage boundary. The
  // refusal detail names the quarantine record (AC-2). Distinct from
  // "revoked" so the audit trail reads as a halt, not a content revocation.
  | "halted"
  | "goal-shift"
  | "capsule-mismatch"
  | "seq-conflict"
  | "signing-unconfigured"
  | "malformed";

/**
 * Spec 124 §3 — projection of spec-123 `ResolvedAgent` (carried inline in
 * `factory.run.stage_started` envelopes and persisted under
 * `factory_runs.source_shas.agents[]`). Field names MUST stay aligned with
 * `crates/factory-engine/src/agent_resolver.rs::ResolvedAgent` — the spec
 * 124 acceptance criterion A-9 grep gate (T088) and the spec 122 Stage CD
 * comparator both depend on the `(orgAgentId, version, contentHash)` triple.
 *
 * Wire convention: camelCase on the duplex envelope (matches the rest of
 * the `ClientEnvelopeWire` shape). The DB column `factory_runs.source_shas`
 * stores the snake_case form `{ org_agent_id, version, content_hash }` per
 * spec §3 — the platform-side reservation/handler converts on persist.
 */
export interface FactoryAgentRef {
  /** spec 123 `agent_catalog.id` — stable across versions per (org, name). */
  orgAgentId: string;
  /** Monotonic version on the catalog row. */
  version: number;
  /** sha-256 content hash from the catalog row at resolve time. */
  contentHash: string;
}

/**
 * Spec 139 Phase 3 (T073) — generalisation of `FactoryAgentRef` to any
 * substrate-tracked artifact (adapter, contract, skill, pattern, etc.).
 * The triple shape is identical; the field name change reflects that
 * spec 139 unified the agent catalog into the substrate, so the
 * "thing being pinned" is now an `artifact_id` rather than an
 * `org_agent_id`.
 *
 * **Backward-compat window (one release):** Encore handlers that record
 * stage progress accept BOTH `agentRef` and `artifactRef` shapes. Going
 * forward emit `artifactRef`. After the soak window the desktop drops
 * `agentRef` and Phase 4 prep removes the dual-acceptance from the
 * handlers.
 */
export interface FactoryArtifactRef {
  /** `factory_artifact_substrate.id` — stable across versions per (org, origin, path). */
  artifactId: string;
  /** Monotonic version on the substrate row. */
  version: number;
  /** sha-256 content hash from the substrate row at resolve time. */
  contentHash: string;
}

export interface EnvelopeMeta {
  /** Schema version — required; strict equality enforced at the boundary. */
  v: EnvelopeSchemaVersion;
  /** Unique event ID — UUID, set by sender. Used for ACK/NACK correlation. */
  eventId: string;
  /** ISO-8601 timestamp, set by sender. */
  sentAt: string;
  /** Optional correlation ID linking a response back to a request. */
  correlationId?: string;
  /** Optional causation ID linking this event to the event that produced it. */
  causationId?: string;
}

// ---------------------------------------------------------------------------
// Client -> Server (INBOX) messages
// ---------------------------------------------------------------------------

/**
 * Desktop/OPC-originated events that Statecraft should record or act on.
 * Each variant is a clearly-bounded desktop-authoritative signal — never a
 * control-plane mutation that would blur authority.
 *
 * INVARIANT (spec 087 §5.3, amended by spec 119):
 *   Extending this union is a *governance act*, not a types change. Any new
 *   variant MUST carry no control-plane authority (no policy/grant/deploy/
 *   org/project state mutation). A variant that asserts authoritative server
 *   state requires a spec amendment.
 */
export type ClientEnvelope =
  | ClientExecutionStatus
  | ClientCheckpointCreated
  | ClientArtifactEmitted
  | ClientRuntimeObserved
  | ClientAgentInvocation
  | ClientAuditCandidate
  | ClientFactoryRunAck
  | ClientFactoryRunStageStarted
  | ClientFactoryRunStageCompleted
  | ClientFactoryRunCompleted
  | ClientFactoryRunFailed
  | ClientFactoryRunCancelled
  | ClientFactoryRunGrantRequest
  | ClientFactoryRunGrantRenew
  | ClientAuditSegmentCountersignRequest
  | ClientAgentCatalogFetchRequest
  | ClientOrgHaltAck
  | ClientAck
  | ClientResyncRequest
  | ClientHeartbeat;

export interface ClientExecutionStatus {
  kind: "execution.status";
  meta: EnvelopeMeta;
  projectId: string;
  executionId: string;
  status: "started" | "progress" | "completed" | "failed" | "cancelled";
  progressPct?: number;
  message?: string;
}

export interface ClientCheckpointCreated {
  kind: "checkpoint.created";
  meta: EnvelopeMeta;
  projectId: string;
  checkpointId: string;
  label?: string;
  commitSha?: string;
}

export interface ClientArtifactEmitted {
  kind: "artifact.emitted";
  meta: EnvelopeMeta;
  projectId: string;
  executionId?: string;
  artifactType: string;
  contentHash: string;
  sizeBytes?: number;
  storageRef?: string;
}

export interface ClientRuntimeObserved {
  kind: "runtime.observed";
  meta: EnvelopeMeta;
  projectId?: string;
  observation:
    | "degraded"
    | "recovered"
    | "disk_pressure"
    | "network_loss"
    | "online";
  detail?: string;
}

export interface ClientAgentInvocation {
  kind: "agent.invocation";
  meta: EnvelopeMeta;
  projectId: string;
  agentId: string;
  toolCalls: number;
  durationMs: number;
  outcome: "ok" | "error" | "policy_denied";
  errorMessage?: string;
}

/**
 * Candidate audit events from the desktop. These are NOT final audit records —
 * Statecraft retains the right to reject, normalise or enrich them before
 * committing. This preserves Statecraft as the audit authority.
 */
export interface ClientAuditCandidate {
  kind: "audit.candidate";
  meta: EnvelopeMeta;
  action: string;
  targetType: string;
  targetId: string;
  details?: Record<string, unknown>;
}

/**
 * Desktop observation that a `factory.run.request` was received (spec 110 §2.2).
 *
 * This is an OBSERVATION of local intent — it does not assert server state,
 * so it fits within the 087 §5.3 extension rule for `ClientEnvelope`. The
 * `accepted: false` path is how policy/local-state declines surface back to
 * statecraft.
 */
export interface ClientFactoryRunAck {
  kind: "factory.run.ack";
  meta: EnvelopeMeta;
  /** Correlates to the `pipelineId` on the triggering `factory.run.request`. */
  pipelineId: string;
  /** Tab/execution session that accepted the request (spec 110 §2.4). */
  sessionId: string;
  /** Stable identifier for the OPC process that observed the request. */
  opcInstanceId: string;
  /** False when the desktop saw the request but declined it. */
  accepted: boolean;
  /** Present when `accepted === false`. Free-form, user-surfacable. */
  declineReason?: string;
  /** ISO-8601 timestamp of the observation. */
  observedAt: string;
}

// ---------------------------------------------------------------------------
// Spec 124 §6.1 — factory.run.* lifecycle envelopes
// ---------------------------------------------------------------------------
//
// OPC reserves a run via `POST /api/factory/runs` (spec 124 §4) and emits
// these envelopes over the duplex bus as the run progresses. The platform
// handler is idempotent on (run_id, stage_id, status) so at-least-once
// duplex delivery is safe (spec 124 §6).
//
// Authority invariant: these envelopes mutate `factory_runs` rows that
// belong to the caller's org; the handler enforces `org_id` match against
// the duplex session's authenticated identity (spec 124 §3).

/**
 * Spec 124 §6.1 — desktop announces a stage has started executing. The
 * platform handler appends a `{stage_id, status: "running", started_at,
 * agent_ref}` entry to `factory_runs.stage_progress` and flips the row's
 * `status` to `running` if it was `queued`.
 */
export interface ClientFactoryRunStageStarted {
  kind: "factory.run.stage_started";
  meta: EnvelopeMeta;
  /** `factory_runs.id` returned from the reservation POST (§4). */
  runId: string;
  /** Stage identifier (e.g. `s0`, `s1`, `s6a`). Free-form within the run. */
  stageId: string;
  /**
   * Projection of spec-123 ResolvedAgent for the agent driving this stage.
   * Persisted under `factory_runs.source_shas.agents[]`.
   *
   * **Spec 139 Phase 3 (T073) deprecation:** `agentRef` is the legacy
   * shape; new emitters SHOULD use `artifactRef` instead. Encore handlers
   * accept both during the one-release backward-compat window. Receiver
   * code resolves the triple via `agentRef ?? artifactRef` and treats
   * either as authoritative; the substrate guarantees `artifactId ===
   * orgAgentId` for migrated user-authored agents (migration 33 §1).
   */
  agentRef?: FactoryAgentRef;
  /**
   * Spec 139 Phase 3 (T073) — generalised triple referencing any
   * substrate artifact. Going forward this is the canonical field;
   * `agentRef` remains for one-release compat.
   */
  artifactRef?: FactoryArtifactRef;
  /** ISO-8601 wall-clock from the desktop. */
  startedAt: string;
}

/**
 * Spec 124 §6.1 — desktop announces a stage has finished. The handler
 * updates the matching `stage_progress` entry's `status` and `completedAt`.
 * Out-of-order delivery (completed before started) is tolerated — the
 * handler synthesises an entry rather than fail (spec 124 T032).
 */
export interface ClientFactoryRunStageCompleted {
  kind: "factory.run.stage_completed";
  meta: EnvelopeMeta;
  runId: string;
  stageId: string;
  /** Per-stage outcome — distinct from the run's terminal status. Named
   *  `stageOutcome` (not `outcome`) so the flat `ClientEnvelopeWire` union
   *  can keep the existing `agent.invocation.outcome` value set without
   *  widening it. */
  stageOutcome: "ok" | "failed" | "skipped";
  /** Optional error string when `stageOutcome === "failed"`. */
  error?: string;
  /** ISO-8601 of stage completion. */
  completedAt: string;
}

/**
 * Spec 124 §4 / §6.1 — terminal success. Sets the row's `status = 'ok'`,
 * `completed_at`, and `token_spend` (rolled-up totals across stages).
 */
export interface ClientFactoryRunCompleted {
  kind: "factory.run.completed";
  meta: EnvelopeMeta;
  runId: string;
  /** Per-stage rolled-up token usage. Shape mirrors the in-tree
   *  `factory_runs.token_spend` JSONB (`{ input, output, total }`). */
  tokenSpend: {
    input: number;
    output: number;
    total: number;
  };
  completedAt: string;
  /**
   * Spec 198 FR-014 — self-hash of the locally-emitted governance
   * certificate. When present (and a grant chain exists for the run),
   * statecraft verifies the chain it issued and replies with a targeted
   * `factory.run.certificate_countersign`. Absent on ungoverned/legacy
   * runs — the certificate then stays visibly unsealed.
   */
  certificateSha256?: string;
  /** Final grant sequence the engine holds (the chain length - 1). */
  seq?: number;
}

/**
 * Spec 124 §4 / §6.1 — terminal failure. Sets `status = 'failed'`,
 * `completed_at`, `error`. Partial `stage_progress` is preserved by the
 * handler — the failure does not overwrite the per-stage trail.
 */
export interface ClientFactoryRunFailed {
  kind: "factory.run.failed";
  meta: EnvelopeMeta;
  runId: string;
  /** Free-form error message; surfaced verbatim in the run-detail UI. */
  error: string;
  completedAt: string;
}

/**
 * Spec 124 §4 / §6.1 — user-initiated cancellation. Same shape as failed
 * but no `error` is required.
 */
export interface ClientFactoryRunCancelled {
  kind: "factory.run.cancelled";
  meta: EnvelopeMeta;
  runId: string;
  /** Optional reason recorded in audit; not required by spec. */
  reason?: string;
  completedAt: string;
}

/**
 * Spec 198 FR-005 — run-grant issuance request (the intent capsule, filed).
 * The engine submits the capsule content before stage s0; statecraft
 * validates it against the standing admission + revocations and replies
 * with a targeted `factory.run.grant`. A run that cannot obtain a grant
 * does not start governed execution (fail-closed engine-side).
 */
export interface ClientFactoryRunGrantRequest {
  kind: "factory.run.grant_request";
  meta: EnvelopeMeta;
  runId: string;
  projectId?: string;
  /** Stable goal identifier (ASI01 m7) — re-presented verbatim at renewal. */
  goalId: string;
  /** Declared goal, plain language; recorded for audit. */
  goal: string;
  constraints?: string[];
  /** sha-256 over the engine's canonical capsule serialization. */
  capsuleHash: string;
  /** The admitted envelope hash from the bundle's admission block. */
  envelopeHash: string;
  /** sha-256 of the frozen Build Spec; optional pre-freeze (s0/s1). */
  buildSpecHash?: string;
}

/**
 * Spec 198 FR-005 — grant renewal at a stage boundary ("signed per
 * execution cycle", ASI01 m5). Re-presents the goal id + capsule hash; a
 * goal shift or an intervening revocation refuses renewal and pauses the
 * run. `seq` increments monotonically from the issuance grant (seq 0).
 */
export interface ClientFactoryRunGrantRenew {
  kind: "factory.run.grant_renew";
  meta: EnvelopeMeta;
  runId: string;
  goalId: string;
  capsuleHash: string;
  seq: number;
  /** Stage boundary being entered (audit context only — OAP does not
   *  model run topology, P-2). */
  stageId?: string;
  /** Spec 208 FR-001: the agent profile (org_agent_id) about to execute
   *  this stage, resolved engine-side from the reservation-time stage-agent
   *  map. Lets an agent-profile-scoped org halt refuse renewal (AC-3);
   *  absent on issuance (a run spans multiple profiles over its life).
   *  Attribution only, same class as stageId; OAP does not model run
   *  topology (P-2). */
  agentProfile?: string;
  /** Frozen Build-Spec hash, presented from the freeze boundary onward.
   *  First presentation records it on the chain; a later change refuses
   *  with `capsule-mismatch` (the freeze is one-way). */
  buildSpecHash?: string;
}

/**
 * Desktop pulls the full body of an agent definition after a
 * `agent.catalog.snapshot` shows a `content_hash` that disagrees with its
 * local cache — or on explicit manual refresh (spec 111 §2.3, amended by
 * spec 119 to be project-scoped). The server replies with a targeted
 * `agent.catalog.updated` carrying the full frontmatter + body.
 *
 * The server resolves the agent's project from the catalog row and
 * verifies the project belongs to the session's authenticated org; the
 * desktop does not send a redundant cross-check field.
 */
export interface ClientAgentCatalogFetchRequest {
  kind: "agent.catalog.fetch_request";
  meta: EnvelopeMeta;
  /** Remote id returned in the snapshot entry. */
  agentId: string;
  reason: "cache_miss" | "hash_mismatch" | "manual_refresh";
  /** ISO-8601 of when the desktop noticed the delta. */
  observedAt: string;
}

/**
 * Spec 207 AC-4: the local side submits an audit segment HEAD (hash plus
 * metadata) over the duplex channel. Statecraft countersigns and persists
 * a seal row. Offline-first: the local side accumulates unanchored heads
 * and submits at reconnect.
 */
export interface ClientAuditSegmentCountersignRequest {
  kind: "audit.segment.countersign_request";
  meta: EnvelopeMeta;
  projectId?: string;
  sessionId: string;
  segmentId: string;
  segmentHeadHash: string;
  segmentRecordCount: number;
  firstRecordAt: string;
  lastRecordAt: string;
}

/**
 * Spec 208 FR-003: the engine acknowledges an `org.halt.activated` /
 * `org.halt.lifted` broadcast once it has reached its pause-and-checkpoint
 * boundary (for a halt) or completed re-admission (for a lift). The ack is the
 * measured propagation bound: statecraft appends a per-engine timestamp to the
 * quarantine record's `acks` array so the realized bound is an audited fact
 * after every pull.
 *
 * Authority note (087 §5.3): this carries no control-plane authority. It is a
 * desktop OBSERVATION that the engine paused, not a state mutation. The server
 * stamps the `clientId` from the authenticated duplex session (never trusting a
 * self-reported id on the wire), exactly as `audit.candidate` does.
 */
export interface ClientOrgHaltAck {
  kind: "org.halt.ack";
  meta: EnvelopeMeta;
  /** The `org_halts.id` from the broadcast being acknowledged. */
  haltId: string;
  /** Which broadcast this acks: the activation or the lift. Named `haltKind`
   *  (not `kind`) so it does not collide with the envelope discriminator. */
  haltKind: "halt" | "lift";
  /** ISO-8601 of when the engine reached its pause/checkpoint (halt) or
   *  re-admission (lift) boundary. */
  ackedAt: string;
}

/** Client acknowledging a previously-received server event. */
export interface ClientAck {
  kind: "sync.ack";
  meta: EnvelopeMeta;
  /** The server event being acknowledged. */
  serverEventId: string;
}

/**
 * Client requesting a full resync — e.g. after detecting a gap in server
 * cursors, or on reconnect.
 */
export interface ClientResyncRequest {
  kind: "sync.resync_request";
  meta: EnvelopeMeta;
  sinceCursor?: string;
  reason?: string;
}

export interface ClientHeartbeat {
  kind: "sync.heartbeat";
  meta: EnvelopeMeta;
}

// ---------------------------------------------------------------------------
// Server -> Client (OUTBOX) messages
// ---------------------------------------------------------------------------

/**
 * Statecraft-originated events describing authoritative state changes.
 * Also carries ACK/NACK for inbound client events.
 */
export type ServerEnvelope =
  | ServerPolicyUpdated
  | ServerGrantUpdated
  | ServerDeployStatus
  | ServerProjectUpdated
  | ServerFactoryEvent
  | ServerFactoryRunRequest
  | ServerFactoryRunGrant
  | ServerFactoryRunCertificateCountersign
  | ServerAuditSegmentCountersign
  | ServerOrgHaltActivated
  | ServerOrgHaltLifted
  | ServerAgentCatalogUpdated
  | ServerAgentCatalogSnapshot
  | ServerProjectAgentBindingUpdated
  | ServerProjectAgentBindingSnapshot
  | ServerProjectCatalogUpsert
  | ServerProjectCatalogSnapshotComplete
  | ServerAck
  | ServerNack
  | ServerResyncRequired
  | ServerHeartbeat
  | ServerHello;

/**
 * Spec 198 FR-005 — targeted reply to `factory.run.grant_request` /
 * `.grant_renew`. `granted: false` carries the attributable refusal; the
 * engine pauses the run and surfaces it (never proceeds unsigned).
 */
export interface ServerFactoryRunGrant {
  kind: "factory.run.grant";
  meta: ServerMeta;
  runId: string;
  granted: boolean;
  seq?: number;
  /** Compact JWS (`typ: oap-run-grant+jwt`), kid resolved via JWKS. */
  grantJws?: string;
  kid?: string;
  expiresAt?: string;
  refusedReason?: RunGrantRefusalReason;
  detail?: string;
}

/**
 * Spec 198 FR-014 — targeted reply after `factory.run.completed` carries a
 * `certificateSha256`: statecraft verified the engine's chain against the
 * grant sequence it issued and countersigned the certificate. The engine
 * patches `platform_countersign` into the persisted
 * `governance-certificate.json`. `countersigned: false` is attributable
 * (chain mismatch / no grant chain / signing unconfigured) — the
 * certificate then stays visibly unsealed.
 */
export interface ServerFactoryRunCertificateCountersign {
  kind: "factory.run.certificate_countersign";
  meta: ServerMeta;
  runId: string;
  countersigned: boolean;
  /** Compact JWS (`typ: oap-cert-countersign+jws`). */
  countersignJws?: string;
  kid?: string;
  refusedReason?: string;
}

/**
 * Spec 207 AC-4: targeted reply to `audit.segment.countersign_request`.
 * `countersigned: false` is attributable (signing unconfigured, internal
 * error) so the segment stays visibly unsealed rather than silently ignored.
 */
export interface ServerAuditSegmentCountersign {
  kind: "audit.segment.countersign";
  meta: ServerMeta;
  sessionId: string;
  segmentId: string;
  countersigned: boolean;
  /** Compact JWS (`typ: oap-audit-segment-countersign+jws`). */
  countersignJws?: string;
  kid?: string;
  refusedReason?: string;
}

/**
 * Spec 208 FR-001/FR-003: the org-wide kill-switch broadcast. Pushed over
 * every connected duplex channel in scope (the outbox-durable
 * `dispatchServerEvent` path, so a reconnecting engine replays it on resync)
 * so engines pause at the next instruction boundary without waiting for the
 * next grant renewal. Enforcement is already live before this fires: the
 * `org_halts` row is written and the fail-closed grant/serve/bind/registration
 * consults are in effect (Phase 1), so the broadcast accelerates the pause, it
 * does not gate it.
 *
 * The free-form quarantine reason rides the shared `detail` field (the
 * server-side free-form convention, as `factory.run.grant` refusals use), not
 * `reason` (whose wire union is the closed nack/resync set).
 */
export interface ServerOrgHaltActivated {
  kind: "org.halt.activated";
  meta: ServerMeta;
  /** The `org_halts.id` of the quarantine record (echoed back on the ack). */
  haltId: string;
  /** The halt scope (spec 208 §Scope lattice). */
  scope: "org" | "project" | "agent-profile";
  /** The scope target: org id, project id, or agent-profile slug. */
  scopeKey: string;
  /** The operator-supplied quarantine reason (audit evidence; surfaced to the
   *  engine for the pause notice). Carried on the shared `detail` wire field. */
  detail: string;
}

/**
 * Spec 208 FR-004: the lift broadcast, sent when an admin begins reintegration
 * (`halted` to `reintegrating`). The engine acknowledges with an
 * `org.halt.ack` carrying `haltKind: "lift"` once it has re-admitted, so the
 * lift's per-engine propagation bound is audited the same way the halt's is.
 */
export interface ServerOrgHaltLifted {
  kind: "org.halt.lifted";
  meta: ServerMeta;
  haltId: string;
  scope: "org" | "project" | "agent-profile";
  scopeKey: string;
}

export interface ServerMeta extends EnvelopeMeta {
  /**
   * Monotonic cursor issued by the server for outbound events within an
   * org. Clients MAY persist this and pass it back as
   * `SyncHandshake.lastServerCursor` on reconnect.
   *
   * This is best-effort in the in-memory implementation; a durable store
   * is required before clients can safely rely on it for replay.
   */
  orgCursor: string;
  orgId: string;
}

export interface ServerPolicyUpdated {
  kind: "policy.updated";
  meta: ServerMeta;
  policyBundleId: string;
  summary?: string;
}

export interface ServerGrantUpdated {
  kind: "grant.updated";
  meta: ServerMeta;
  userId: string;
  change: "granted" | "revoked" | "modified";
  details?: Record<string, unknown>;
}

export interface ServerDeployStatus {
  kind: "deploy.status";
  meta: ServerMeta;
  projectId: string;
  environmentId: string;
  status: "queued" | "running" | "succeeded" | "failed" | "rolled_back";
  detail?: string;
}

export interface ServerProjectUpdated {
  kind: "project.updated";
  meta: ServerMeta;
  projectId: string;
  change: "created" | "updated" | "deleted" | "repo_linked";
  details?: Record<string, unknown>;
}

/**
 * Factory pipeline events. Carried through the outbox so OPC and web clients
 * observe the same authoritative stream.
 */
export interface ServerFactoryEvent {
  kind: "factory.event";
  meta: ServerMeta;
  pipelineId: string;
  projectId: string;
  eventType: string;
  stageId?: string;
  actor?: string;
  details?: Record<string, unknown>;
}

/**
 * Knowledge-bundle reference carried on a `factory.run.request` (spec 110 §2.3).
 *
 * The desktop resolves each entry against a content-addressable cache at
 * `$OPC_CACHE_DIR/knowledge/<contentHash>` before passing local paths to the
 * factory engine; the hash is the trust boundary (mismatch ⇒ run fails).
 */
export interface KnowledgeBundle {
  /** Knowledge-object UUID on statecraft. */
  objectId: string;
  /** Suggested local filename (preserves extension for the engine). */
  filename: string;
  /** sha-256 of the object body — authoritative cache key. */
  contentHash: string;
  /** Presigned URL with a short TTL (15 min); regenerated on resync. */
  downloadUrl: string;
}

/**
 * Business-doc reference carried on a `factory.run.request` (spec 110 §2.1).
 *
 * Distinct from the file-local `BusinessDocRef` in `api/factory/factory.ts`
 * (which uses snake_case `storage_ref` to match HTTP shape); this is the
 * wire-level camelCase form used on the envelope.
 */
export interface EnvelopeBusinessDoc {
  name: string;
  storageRef: string;
}

/**
 * Statecraft directs a connected OPC to start a locally-executed factory run
 * (spec 110 §2.1).
 *
 * Authority invariant (087 §5.3): this IS a control-plane directive. The
 * request originates from an authenticated statecraft user; the desktop
 * enforces its local policy bundle before acting and replies with
 * `factory.run.ack` (`accepted: false`) when it declines. One OPC accepts;
 * others receive `sync.nack` for the same `meta.eventId`.
 */
export interface ServerFactoryRunRequest {
  kind: "factory.run.request";
  meta: ServerMeta;
  projectId: string;
  pipelineId: string;
  /** One of the KNOWN_ADAPTERS registered with the factory engine. */
  adapter: string;
  /** User who clicked Initialize (or invoked `oap-ctl run factory`). */
  actorUserId: string;
  /** Project knowledge objects attached to this run. */
  knowledge: KnowledgeBundle[];
  /** Explicit per-request doc uploads. Same shape as spec 108. */
  businessDocs: EnvelopeBusinessDoc[];
  /** Policy bundle id compiled server-side for this project. */
  policyBundleId: string;
  /** ISO-8601 when statecraft dispatched the request. */
  requestedAt: string;
  /** ISO-8601 after which statecraft will mark the pipeline `abandoned`. */
  deadlineAt: string;
}

/**
 * Entry shape for {@link ServerAgentCatalogSnapshot}. The snapshot is a
 * directory — names, versions, and content hashes only. Desktops compare
 * each `contentHash` against their local cache and pull missing bodies via
 * {@link ClientAgentCatalogFetchRequest} (spec 111 §2.3).
 */
export interface AgentCatalogSnapshotEntry {
  agentId: string;
  /** Org the agent belongs to (spec 123 — agents rescoped to org). */
  orgId: string;
  name: string;
  version: number;
  status: "published" | "retired";
  contentHash: string;
  updatedAt: string;
}

/**
 * Statecraft announces that an agent definition was published or retired
 * (spec 111 §2.3, amended by spec 123 to be org-scoped). Carries the
 * full frontmatter + body so connected OPCs can update their local caches
 * in one round-trip. Also used as the targeted reply to a
 * {@link ClientAgentCatalogFetchRequest}.
 */
export interface ServerAgentCatalogUpdated {
  kind: "agent.catalog.updated";
  meta: ServerMeta;
  /** Remote id — stable across versions within an (org, name) pair. */
  agentId: string;
  /** Org that owns the agent (spec 123 §7.1). */
  orgId: string;
  /** Catalog key (kebab-case, unique per org). */
  name: string;
  /** Monotonic per (org, name). */
  version: number;
  /** `published` puts the agent into the active catalog;
   *  `retired` removes it. Drafts never travel the wire. */
  status: "published" | "retired";
  /** sha-256 over canonical JSON of frontmatter + body (spec 111 §6). */
  contentHash: string;
  /** UnifiedFrontmatter mirrored from crates/agent-frontmatter. */
  frontmatter: CatalogFrontmatter;
  /** The agent's system prompt body. */
  bodyMarkdown: string;
  /** ISO-8601 of the underlying row's updated_at. */
  updatedAt: string;
}

/**
 * Full catalog replay on handshake or explicit resync (spec 111 §2.3,
 * amended by spec 119 to span every project in the session's org). The
 * snapshot is intentionally a directory — `entries` carry hashes only,
 * not bodies. Desktops diff against their local cache and pull individual
 * bodies via {@link ClientAgentCatalogFetchRequest} — this keeps reconnect
 * storms bounded for orgs with many large-prompt agents.
 */
export interface ServerAgentCatalogSnapshot {
  kind: "agent.catalog.snapshot";
  meta: ServerMeta;
  /** Currently-published entries across every project in the session's
   *  org. Retired agents are excluded; the desktop infers removal from
   *  absence. */
  entries: AgentCatalogSnapshotEntry[];
  /** ISO-8601 of when the snapshot was built. Informational. */
  generatedAt: string;
}

// ---------------------------------------------------------------------------
// Spec 123 §7.2 — Project agent binding envelopes
// ---------------------------------------------------------------------------

/**
 * Statecraft announces that a project's binding to an org agent changed.
 * Fans out only to OPCs whose claimed org matches; desktop-side filters
 * by `projectId` to apply only to the project the user has active.
 */
export interface ServerProjectAgentBindingUpdated {
  kind: "project.agent_binding.updated";
  meta: ServerMeta;
  orgId: string;
  projectId: string;
  bindingId: string;
  orgAgentId: string;
  agentName: string;
  pinnedVersion: number;
  pinnedContentHash: string;
  action: "bound" | "rebound" | "unbound";
  boundAt: string;
}

/** Per-project snapshot entry — one row per binding that points at a
 *  catalog row. Carries no body/frontmatter; desktops resolve those via
 *  `agent.catalog.fetch_request` against the org-wide catalog snapshot. */
export interface ProjectAgentBindingSnapshotEntry {
  bindingId: string;
  orgAgentId: string;
  agentName: string;
  pinnedVersion: number;
  pinnedContentHash: string;
}

/**
 * Per-project binding directory replay on handshake or explicit resync.
 * Sent ONCE PER PROJECT the user has access to — keeping the binding
 * snapshot fan-out independent of the catalog snapshot lets desktops
 * apply project-membership delta without repulling the org-wide catalog.
 */
export interface ServerProjectAgentBindingSnapshot {
  kind: "project.agent_binding.snapshot";
  meta: ServerMeta;
  orgId: string;
  projectId: string;
  bindings: ProjectAgentBindingSnapshotEntry[];
  generatedAt: string;
}

/**
 * Statecraft announces that a project was created/updated/deleted
 * (spec 112 §7). Reuses the spec 111 sync pattern: one wire message carries
 * everything OPC needs to surface the row in its "Projects" panel — no
 * secondary round-trip. Deletions are expressed by the `tombstone` flag so
 * desktops can prune local state without reconciling absence.
 */
export interface ServerProjectCatalogUpsert {
  kind: "project.catalog.upsert";
  meta: ServerMeta;
  /** UUID of the projects row. */
  projectId: string;
  /** Human-friendly display name and URL slug. */
  name: string;
  slug: string;
  description: string;
  /** Factory adapter row id this project is bound to; null for pre-112 projects. */
  factoryAdapterId: string | null;
  /** One of the factory-project-detect levels, as inferred by statecraft at create/import time. */
  detectionLevel:
    | "not_factory"
    | "scaffold_only"
    | "legacy_produced"
    | "acp_produced"
    | null;
  /** Primary repo metadata — the desktop uses this to clone on first open. */
  repo: {
    githubOrg: string;
    repoName: string;
    defaultBranch: string;
    cloneUrl: string;
    htmlUrl: string;
  } | null;
  /** Canonical opc:// deep link for this project. */
  opcDeepLink: string;
  /** Marks the project as deleted — desktops drop it from local state. */
  tombstone: boolean;
  /** ISO-8601 of the underlying row's updated_at. */
  updatedAt: string;
}

/**
 * Terminator emitted by statecraft after the post-handshake project
 * catalog snapshot has finished replaying for a given client — including
 * the zero-projects case where no {@link ServerProjectCatalogUpsert}
 * frames went out at all. Lets the desktop distinguish "still connecting"
 * from "connected; the org has no projects" without an arbitrary
 * client-side timeout.
 *
 * `entryCount` is the number of upserts the server sent during the
 * snapshot pass (informational; the desktop reconciles by `projectId`
 * regardless).
 */
export interface ServerProjectCatalogSnapshotComplete {
  kind: "project.catalog.snapshot.complete";
  meta: ServerMeta;
  orgId: string;
  /** Count of `project.catalog.upsert` frames sent in this snapshot pass. */
  entryCount: number;
  /** ISO-8601 of when the snapshot pass finished. Informational. */
  generatedAt: string;
}

/** Server accepted a client event and recorded it. */
export interface ServerAck {
  kind: "sync.ack";
  meta: ServerMeta;
  /** The client event being acknowledged. */
  clientEventId: string;
}

/** Server rejected a client event — validation/auth/org mismatch. */
export interface ServerNack {
  kind: "sync.nack";
  meta: ServerMeta;
  clientEventId: string;
  reason: "invalid" | "unauthorized" | "org_mismatch" | "internal_error";
  detail?: string;
}

/** Server informs the client it should perform a full resync. */
export interface ServerResyncRequired {
  kind: "sync.resync_required";
  meta: ServerMeta;
  reason: "cursor_gap" | "stale_cursor" | "server_restart";
}

export interface ServerHeartbeat {
  kind: "sync.heartbeat";
  meta: ServerMeta;
}

/** First message sent by server after handshake — carries session info. */
export interface ServerHello {
  kind: "sync.hello";
  meta: ServerMeta;
  sessionId: string;
  serverStartedAt: string;
  /** Any cursor gap the server detected vs the handshake cursor. */
  cursorGap?: boolean;
}

// ---------------------------------------------------------------------------
// Type guards / discriminators
// ---------------------------------------------------------------------------

export type ClientEnvelopeKind = ClientEnvelope["kind"];
export type ServerEnvelopeKind = ServerEnvelope["kind"];

// ---------------------------------------------------------------------------
// Wire-level interfaces for the Encore streaming boundary
// ---------------------------------------------------------------------------
//
// Encore.ts's schema parser cannot walk a union-typed alias at an API boundary
// (it expects a named interface). To keep the rich discriminated unions for
// internal narrowing, we expose flat "fat" interfaces that enumerate every
// possible field with optional typing. On the wire the JSON is identical —
// optional keys are simply omitted for variants that don't use them.
//
// INVARIANT: every `ClientEnvelope` / `ServerEnvelope` variant must be
// structurally assignable to its wire counterpart. The compile-time
// assertions at the bottom of this block pin that — adding a variant without
// widening the wire interface fails tsc.

/** Flat counterpart of {@link ClientEnvelope} for the Encore stream boundary. */
export interface ClientEnvelopeWire {
  // Kinds are inlined rather than referencing `ClientEnvelopeKind`; Encore's
  // schema parser cannot evaluate indexed-access types over a union alias.
  kind:
    | "execution.status"
    | "checkpoint.created"
    | "artifact.emitted"
    | "runtime.observed"
    | "agent.invocation"
    | "audit.candidate"
    | "factory.run.ack"
    | "factory.run.stage_started"
    | "factory.run.stage_completed"
    | "factory.run.completed"
    | "factory.run.failed"
    | "factory.run.cancelled"
    | "factory.run.grant_request"
    | "factory.run.grant_renew"
    | "audit.segment.countersign_request"
    | "agent.catalog.fetch_request"
    | "org.halt.ack"
    | "sync.ack"
    | "sync.resync_request"
    | "sync.heartbeat";
  meta: EnvelopeMeta;
  projectId?: string;
  executionId?: string;
  status?: "started" | "progress" | "completed" | "failed" | "cancelled";
  progressPct?: number;
  message?: string;
  checkpointId?: string;
  label?: string;
  commitSha?: string;
  artifactType?: string;
  contentHash?: string;
  sizeBytes?: number;
  storageRef?: string;
  observation?:
    | "degraded"
    | "recovered"
    | "disk_pressure"
    | "network_loss"
    | "online";
  detail?: string;
  agentId?: string;
  toolCalls?: number;
  durationMs?: number;
  outcome?: "ok" | "error" | "policy_denied";
  errorMessage?: string;
  action?: string;
  targetType?: string;
  targetId?: string;
  details?: Record<string, unknown>;
  serverEventId?: string;
  sinceCursor?: string;
  reason?: string;
  // spec 110 §2.2 — factory.run.ack fields
  pipelineId?: string;
  sessionId?: string;
  opcInstanceId?: string;
  accepted?: boolean;
  declineReason?: string;
  observedAt?: string;
  // spec 124 §6.1 — factory.run.* lifecycle fields. `runId`, `stageId`,
  // `agentRef`, `startedAt`, `completedAt`, `stageOutcome`, `error`,
  // `tokenSpend` are populated only on the relevant kinds; the wire shape
  // is a fat optional union per the existing convention. `stageOutcome` is
  // distinct from `outcome` (used by agent.invocation) — both coexist on
  // the wire.
  runId?: string;
  stageId?: string;
  agentRef?: FactoryAgentRef;
  startedAt?: string;
  completedAt?: string;
  stageOutcome?: "ok" | "failed" | "skipped";
  error?: string;
  tokenSpend?: {
    input: number;
    output: number;
    total: number;
  };
  // spec 198 FR-005/FR-014 — factory.run.grant_request / .grant_renew /
  // .completed countersign fields. `seq` is shared by renew (next sequence)
  // and completed (final sequence held).
  goalId?: string;
  goal?: string;
  constraints?: string[];
  capsuleHash?: string;
  envelopeHash?: string;
  buildSpecHash?: string;
  seq?: number;
  certificateSha256?: string;
  // spec 207 AC-4: audit.segment.countersign_request fields. `sessionId` is
  // declared above (shared with factory.run.ack).
  segmentId?: string;
  segmentHeadHash?: string;
  segmentRecordCount?: number;
  firstRecordAt?: string;
  lastRecordAt?: string;
  // spec 208 FR-003: org.halt.ack fields. `haltKind` (not `kind`) discriminates
  // the halt vs lift ack. `clientId` is NOT on the wire: the server stamps it
  // from the authenticated duplex session.
  haltId?: string;
  haltKind?: "halt" | "lift";
  ackedAt?: string;
}

/** Flat counterpart of {@link ServerEnvelope} for the Encore stream boundary. */
export interface ServerEnvelopeWire {
  kind:
    | "policy.updated"
    | "grant.updated"
    | "deploy.status"
    | "project.updated"
    | "factory.event"
    | "factory.run.request"
    | "factory.run.grant"
    | "factory.run.certificate_countersign"
    | "audit.segment.countersign"
    | "org.halt.activated"
    | "org.halt.lifted"
    | "agent.catalog.updated"
    | "agent.catalog.snapshot"
    | "project.agent_binding.updated"
    | "project.agent_binding.snapshot"
    | "project.catalog.upsert"
    | "project.catalog.snapshot.complete"
    | "sync.ack"
    | "sync.nack"
    | "sync.resync_required"
    | "sync.heartbeat"
    | "sync.hello";
  meta: ServerMeta;
  policyBundleId?: string;
  summary?: string;
  userId?: string;
  change?:
    | "granted"
    | "revoked"
    | "modified"
    | "created"
    | "updated"
    | "deleted"
    | "repo_linked";
  details?: Record<string, unknown>;
  projectId?: string;
  environmentId?: string;
  status?:
    | "queued"
    | "running"
    | "succeeded"
    | "failed"
    | "rolled_back"
    | "published"
    | "retired";
  detail?: string;
  pipelineId?: string;
  eventType?: string;
  stageId?: string;
  actor?: string;
  clientEventId?: string;
  reason?:
    | "invalid"
    | "unauthorized"
    | "org_mismatch"
    | "internal_error"
    | "cursor_gap"
    | "stale_cursor"
    | "server_restart";
  sessionId?: string;
  serverStartedAt?: string;
  cursorGap?: boolean;
  // spec 110 §2.1 — factory.run.request fields
  adapter?: string;
  actorUserId?: string;
  knowledge?: KnowledgeBundle[];
  businessDocs?: EnvelopeBusinessDoc[];
  requestedAt?: string;
  deadlineAt?: string;
  // spec 111 §2.3 — agent.catalog.updated / agent.catalog.snapshot fields
  // (orgId added by spec 123; the older `projectId` field at the top of
  // this wire union is shared with other variants and remains optional.)
  agentId?: string;
  orgId?: string;
  name?: string;
  version?: number;
  contentHash?: string;
  frontmatter?: CatalogFrontmatter;
  bodyMarkdown?: string;
  updatedAt?: string;
  entries?: AgentCatalogSnapshotEntry[];
  generatedAt?: string;
  // spec 123 §7.2 — project.agent_binding.updated / .snapshot fields.
  // The `action` field used by binding.updated is the wider `action?: string`
  // declared above (shared with audit.candidate); the binding-specific
  // values are "bound" | "rebound" | "unbound", which subset cleanly.
  bindingId?: string;
  orgAgentId?: string;
  agentName?: string;
  pinnedVersion?: number;
  pinnedContentHash?: string;
  boundAt?: string;
  bindings?: ProjectAgentBindingSnapshotEntry[];
  // spec 112 §7 — project.catalog.upsert fields (projectId, name, updatedAt
  // are already declared above).
  slug?: string;
  description?: string;
  factoryAdapterId?: string | null;
  detectionLevel?:
    | "not_factory"
    | "scaffold_only"
    | "legacy_produced"
    | "acp_produced"
    | null;
  repo?: {
    githubOrg: string;
    repoName: string;
    defaultBranch: string;
    cloneUrl: string;
    htmlUrl: string;
  } | null;
  opcDeepLink?: string;
  tombstone?: boolean;
  // spec 112 §7 / amendment — project.catalog.snapshot.complete field.
  // Count of catalog upserts in the just-finished handshake snapshot pass;
  // `generatedAt` above is the timestamp.
  entryCount?: number;
  // spec 198 FR-005/FR-014 — factory.run.grant / .certificate_countersign
  // fields (targeted replies to the grant family).
  runId?: string;
  granted?: boolean;
  seq?: number;
  grantJws?: string;
  kid?: string;
  expiresAt?: string;
  refusedReason?: RunGrantRefusalReason | string;
  countersigned?: boolean;
  countersignJws?: string;
  // spec 207 AC-4: audit.segment.countersign fields. `sessionId` is declared
  // above (shared with other variants).
  segmentId?: string;
  // spec 208 FR-001/FR-004: org.halt.activated / org.halt.lifted fields. The
  // free-form quarantine reason rides the shared `detail` field above (the
  // `reason` field is the closed nack/resync union). `scope`/`scopeKey` are
  // new; `haltId` is shared in name with the inbound ack but distinct here.
  haltId?: string;
  scope?: "org" | "project" | "agent-profile";
  scopeKey?: string;
}

// Compile-time assignability gates: every variant must fit the wire shape.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const _clientWireAssignable: ClientEnvelopeWire = null as unknown as ClientEnvelope;
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const _serverWireAssignable: ServerEnvelopeWire = null as unknown as ServerEnvelope;

const CLIENT_KINDS: ReadonlySet<ClientEnvelopeKind> = new Set<ClientEnvelopeKind>([
  "execution.status",
  "checkpoint.created",
  "artifact.emitted",
  "runtime.observed",
  "agent.invocation",
  "audit.candidate",
  "factory.run.ack",
  "factory.run.stage_started",
  "factory.run.stage_completed",
  "factory.run.completed",
  "factory.run.failed",
  "factory.run.cancelled",
  "factory.run.grant_request",
  "factory.run.grant_renew",
  "audit.segment.countersign_request",
  "agent.catalog.fetch_request",
  "org.halt.ack",
  "sync.ack",
  "sync.resync_request",
  "sync.heartbeat",
]);

export function isClientEnvelope(v: unknown): v is ClientEnvelope {
  if (!v || typeof v !== "object") return false;
  const r = v as { kind?: unknown; meta?: unknown };
  if (typeof r.kind !== "string") return false;
  if (!CLIENT_KINDS.has(r.kind as ClientEnvelopeKind)) return false;
  if (!r.meta || typeof r.meta !== "object") return false;
  const m = r.meta as { eventId?: unknown; sentAt?: unknown; v?: unknown };
  // Spec 087 §5.3 FR-SYNC-003: strict equality on schema version. A newer
  // client sending v=3 is rejected as "invalid" rather than silently falling
  // through a best-effort decoder.
  if (m.v !== ENVELOPE_SCHEMA_VERSION) return false;
  return typeof m.eventId === "string" && typeof m.sentAt === "string";
}

// ---------------------------------------------------------------------------
// Stream alias
// ---------------------------------------------------------------------------

export type SyncStream = StreamInOut<ClientEnvelopeWire, ServerEnvelopeWire>;
