---
id: "087-unified-workspace-architecture"
slug: unified-workspace-architecture
title: Unified Project Architecture
status: approved
implementation: complete
owner: bart
created: "2026-04-09"
amended: "2026-06-07"
amendment_record: "183-opc-boot-precondition-gate"
summary: >
  Unified architecture connecting web and desktop planes into one system with
  a first-class knowledge intake domain and project-scoped entity hierarchy.
  §5.3 adds the duplex sync substrate contract (FR-SYNC-001..010). Originally
  authored as "Unified Workspace Architecture" (2026-04-09); amended by spec
  119 (2026-04-29) when the workspace layer was collapsed into project,
  by spec 143 (2026-05-08) to add the browser-reachability requirement to
  NF-002 for the object-store endpoint backing presigned uploads, and by
  spec 183 (2026-06-07) adding FR-SYNC-011 — the stream-identity-scoped
  reconnect teardown that closes the server-side duplex reconnect race
  wedging the boot gate.
code_aliases: ["UNIFIED_PROJECT"]
depends_on:
  - "074-factory-ingestion"  # factory-ingestion
  - "075-factory-workflow-engine"  # factory-workflow-engine
  - "076-factory-desktop-panel"  # factory-desktop-panel
  - "077-statecraft-factory-api"  # statecraft-factory-api
  - "078-platform-completion-plan"  # platform-completion-plan
  - "080-github-identity-onboarding"  # github-identity-onboarding
  - "082-artifact-integrity-platform-hardening"  # artifact-integrity-platform-hardening
kind: architecture
domain: platform
risk: high
establishes:
  - unit: { kind: file, path: platform/services/statecraft/api/sync/types.ts }
  - unit: { kind: file, path: platform/services/statecraft/api/sync/service.ts }
  - unit: { kind: file, path: platform/services/statecraft/api/sync/duplex.ts }
  - unit: { kind: file, path: platform/services/statecraft/api/sync/relay.ts }
  - unit: { kind: file, path: platform/services/statecraft/api/sync/store.ts }
  - unit: { kind: file, path: platform/services/statecraft/api/sync/registry.ts }
references:
  - role: historical
    unit: { kind: directory, path: product/packages/project-sdk }
---

# 087 — Unified Project Architecture

> **Amended by spec 119 (2026-04-29):** the unit of identity, governance, collaboration, knowledge intake, and factory execution described in this spec is now `project`, not `workspace`. The workspace layer was originally introduced (in this spec, 2026-04-09) as a multi-project governance container with a shared knowledge corpus; spec 119 collapsed it into project after the clone pipeline (specs 113, 114) displaced the cross-project knowledge-sharing case. The narrative below has been updated. Schema diagrams in §9 are retained as historical record; the canonical post-amendment schema is in spec 119 §4. Code alias renamed `UNIFIED_WORKSPACE` → `UNIFIED_PROJECT`.

## 1. Problem Statement

Open Agentic Platform has two user-facing planes (web and desktop), a delivery engine (factory), and an organisational control plane (statecraft). All are individually functional but architecturally siloed: separate auth paths, separate state models, and no shared project abstraction. Users experience three tools rather than one system.

Additionally, the business documents that feed factory pipelines are treated as loose attachments rather than a first-class knowledge substrate. Documents may arrive from direct upload, SharePoint, or other enterprise sources, but there is no normalisation layer, no provenance model, and no project-scoped knowledge domain.

This spec defines the unified architecture that makes the two planes parts of one system, elevates knowledge intake to a first-class project domain, and positions the factory as an execution artifact that transforms project knowledge into project output.

## 2. Core Model

### 2.1 Entity Hierarchy

```
GitHub Organization (trust anchor)
  └── Project (operational container)
        ├── Identity & Membership
        │     ├── members[] (via GitHub org membership + RBAC roles)
        │     └── service accounts[] (M2M tokens)
        │
        ├── Repos[] (GitHub repositories — primary + auxiliary)
        ├── Environments[] (preview / dev / staging / prod)
        │
        ├── Knowledge Intake
        │     ├── source_connectors[] (upload, SharePoint, S3, Azure Blob, GCS)
        │     ├── knowledge_objects[] (canonical normalised documents)
        │     ├── extraction_state[] (OCR, classification, structured output)
        │     └── provenance[] (source origin, sync state, version history)
        │
        ├── Factory
        │     ├── scoped to: project
        │     ├── consumes: project knowledge_objects
        │     └── produces: project artifacts + repository changes
        │
        ├── Policy Bundle (compiled governance rules)
        │
        ├── Grants (per-user permission matrix)
        │
        └── Audit Trail (append-only event log)
```

### 2.2 Key Relationships

- A **Project** is scoped to exactly one GitHub Organization (the trust anchor).
- A **Project** owns one or more GitHub repositories.
- **Knowledge Objects** belong to the Project. Cross-project use happens via the clone pipeline (specs 113, 114), which copies knowledge into the destination project — a successor model to the workspace-shared corpus originally proposed in this spec.
- A **Factory** is scoped to a project. It consumes the project's Knowledge Objects and produces project artifacts.
- The **Policy Bundle** is project-scoped and includes factory policy shards.

### 2.3 Project Definition

> The project is the unit of identity, governance, collaboration, and knowledge intake. Business documents may enter through direct upload or enterprise connectors such as SharePoint, but are normalised into the project's object storage with provenance preserved. Code repositories bind to the project; factories act as the execution artifact that transforms project knowledge into software outcomes across the desktop and web planes.

A Project is the unit of:
- **Billing** — token spend, compute, storage
- **Governance** — policy bundle scope
- **Collaboration** — team membership boundary
- **Knowledge** — canonical document substrate
- **Factory execution** — one active factory per project

## 3. Two Planes, One System

### 3.1 Plane Responsibilities

#### Web Plane — statecraft.ing

The web plane is the governance, management, and collaboration surface. It is read-heavy: observe, govern, approve, configure.

**Owns:**
1. Identity and onboarding — GitHub OAuth, Rauthy sessions, org discovery, project creation
2. Project administration — team invites, role assignment, billing, usage dashboards
3. Project lifecycle — create project, link repos, configure environments, set auto-deploy rules
4. Knowledge intake — connector configuration, document import, extraction monitoring, object browsing
5. Pipeline overview — read-only dashboard of active factory pipelines across projects in the org
6. Gate approval (web) — approve/reject factory stages from the browser (for stakeholders without OPC)
7. Deploy promotion — promote builds between environments, trigger rollbacks
8. Audit and compliance — full audit trail viewer, export, retention policies

**Does NOT:**
- Execute Claude Code sessions
- Run factory pipeline stages
- Generate code or scaffolding
- Directly interact with the filesystem or git

#### Desktop Plane — OPC

The desktop plane is the execution surface. It is write-heavy: execute, generate, verify, commit.

**Owns:**
1. Local execution — Claude Code sessions, agent runs, worktree-based parallel agents
2. Factory stage execution — runs the 7-stage pipeline locally via `crates/factory-engine`
3. Code generation — scaffold fan-out, adapter-specific code generation
4. Git operations — commit, branch, checkpoint, restore, diff
5. Governance enforcement — axiomregent sidecar, permission gating, safety tiers
6. Artifact inspection — view generated files, diffs, build outputs
7. Gate approval (local) — approve/reject stages from the desktop (for active developers)
8. Offline capability — all of the above works without platform connectivity

**Does NOT:**
- Manage team membership or billing
- Store the authoritative audit trail
- Own identity (receives identity from the platform)
- Make deployment decisions (requests deployments via the platform)

### 3.2 Factory Position

The Factory is the execution artifact of the project:
- Scoped by project
- Fed by the project's knowledge objects
- Executed locally on the desktop plane
- Observed and governed through the web plane

Factory initiation can happen from either plane, but execution always happens on Desktop because code generation requires filesystem access, agent execution requires local compute, git operations require a local working tree, and governance enforcement requires the axiomregent sidecar.

## 4. Knowledge Intake Domain

### 4.1 Architecture

```
External Sources                    Project
┌──────────────┐                   ┌──────────────────────────────┐
│  Direct      │──── upload ──────→│                              │
│  Upload      │                   │   Canonical Object Store     │
├──────────────┤                   │   (S3-compatible)            │
│  SharePoint  │──── connector ──→│                              │
│  Online      │     sync/import  │   knowledge_objects[]        │
├──────────────┤                   │     ├── content (blob)       │
│  Azure Blob  │──── connector ──→│     ├── content_hash         │
│  / S3 / GCS  │     import       │     ├── mime_type            │
├──────────────┤                   │     ├── extraction_state     │
│  Future      │──── connector ──→│     ├── classification[]     │
│  Connectors  │                   │     ├── provenance           │
└──────────────┘                   │     │    ├── source_type     │
                                   │     │    ├── source_uri      │
                                   │     │    ├── imported_at     │
                                   │     │    ├── last_synced_at  │
                                   │     │    └── version_id      │
                                   │     └── structured_extract   │
                                   │                              │
                                   │   source_connectors[]        │
                                   │     ├── type (sharepoint,    │
                                   │     │   s3, upload, ...)     │
                                   │     ├── config (encrypted)   │
                                   │     ├── sync_schedule        │
                                   │     └── status               │
                                   └──────────────────────────────┘
```

### 4.2 Design Principles

1. **Canonical storage, not pass-through.** All documents are materialised into the project's S3-compatible object store regardless of source. S3 is the normalisation layer, not just "where uploads go."

2. **Connectors are origins, not authorities.** SharePoint, Azure Blob, GCS, etc. are external knowledge sources. After intake, the platform treats documents as project knowledge objects in canonical storage. This prevents split-brain document models.

3. **Provenance is preserved.** Every knowledge object carries provenance metadata linking back to its source connector, original URI, sync timestamp, and version. This enables re-sync, audit, and traceability without keeping the external source as a live dependency.

4. **Project-scoped, not cross-project.** Knowledge objects belong to one project. Cross-project use happens via the clone pipeline (specs 113, 114), which copies knowledge into the destination project. The original spec proposed cross-project sharing via `document_bindings`; that table was retired by spec 119 along with the workspace layer.

5. **Extraction is a pipeline stage.** After intake, documents pass through extraction (OCR, text extraction), classification (by platform concern: client, API, data, infra), and structured output generation. This state is tracked per knowledge object.

6. **Factory consumes normalised knowledge.** A factory's document input is a selection of knowledge objects from the project store. The factory does not know or care whether a document came from upload or SharePoint — it operates over a consistent document model.

### 4.3 Knowledge Object Lifecycle

```
source → intake/import → canonical storage → extraction → classification → selectable
                                                                              │
                                                              ┌───────────────┘
                                                              ▼
                                                    Factory pipeline
                                                    (selected documents
                                                     become stage 0-1 input)
```

States: `imported` → `extracting` → `extracted` → `classified` → `available`

A knowledge object in state `available` can be bound to a project and selected as input to a factory pipeline.

### 4.4 Connector Model

| Connector Type | Auth | Sync | Notes |
|---------------|------|------|-------|
| `upload` | Session (user-initiated) | One-shot | Direct browser/API upload |
| `sharepoint` | OAuth2 (Microsoft Graph) | Scheduled or on-demand | Folder-level sync, delta query |
| `azure-blob` | SAS token or managed identity | Scheduled | Container/prefix scoped |
| `s3` | IAM role or access key | Scheduled | Bucket/prefix scoped |
| `gcs` | Service account | Scheduled | Bucket/prefix scoped |

Connectors are project-scoped configuration objects. Adding a new connector type requires implementing a single `SourceConnector` trait/interface — no changes to the core knowledge object model.

## 5. Sync Protocol

### 5.1 Authoritative Ownership

| Domain | Authoritative Plane | Sync Direction |
|--------|-------------------|----------------|
| Identity & membership | Web (Statecraft) | Web → Desktop |
| Policy bundles | Web (Statecraft) | Web → Desktop |
| Audit trail | Web (Statecraft) | Desktop → Web |
| Knowledge objects | Web (Statecraft) | Web → Desktop (metadata only) |
| Pipeline execution state | Desktop (OPC) | Desktop → Web |
| Artifact content | Desktop (OPC) | Desktop → Web (hashes + upload) |
| Checkpoint state | Desktop (OPC) | Local only |
| Local git state | Desktop (OPC) | Local only |

> **Per spec 119:** sync envelopes carry `projectId` rather than `workspaceId`. The wire-format symbol rename is part of the spec 119 migration; the authority split itself is unchanged.

### 5.2 Communication

```
┌──────────────┐                           ┌──────────────┐
│  STATECRAFT  │                           │     OPC      │
│  (web plane) │                           │  (desktop)   │
│              │                           │              │
│              │──── WebSocket ────────────→│              │
│              │     push: policy change,   │              │
│              │     gate approval,         │              │
│              │     deploy status,         │              │
│              │     knowledge object ready │              │
│              │                           │              │
│              │←── HTTP POST ─────────────│              │
│              │    push: stage complete,   │              │
│              │    token spend,            │              │
│              │    artifact hash,          │              │
│              │    audit events            │              │
└──────────────┘                           └──────────────┘
```

A WebSocket relay on Statecraft pushes events to connected OPC instances, scoped by project. OPC pushes state updates to Statecraft via HTTP POST (fire-and-forget, best-effort — failures never block local execution).

### 5.3 Duplex Sync Substrate

> Added 2026-04-20. Supersedes the "HTTP POST + WebSocket push" model of §5.2 for new consumers. The legacy `projectEventStream` streamOut and `ingestOpcEvent` HTTP endpoint are retained during migration (see FR-SYNC-010). Envelope and cursor identifier names use project-scoped form per spec 119; the substrate's authority split and protocol are unchanged.

The canonical sync channel between Statecraft and OPC is an **authenticated duplex WebSocket** at `POST /api/sync/duplex` (Encore `api.streamInOut`). A single bidirectional stream carries a disjoint pair of typed envelope unions — `ClientEnvelope` (desktop → server) and `ServerEnvelope` (server → desktop) — with project cursors, ACK/NACK semantics, and resync on reconnect.

Implementation: `platform/services/statecraft/api/sync/` — `types.ts`, `service.ts`, `duplex.ts`, `registry.ts`, `store.ts`, `relay.ts`.

#### Authority Invariant (Type-System-Enforced)

The envelope union encodes the §5.1 authority split in TypeScript:

- `ClientEnvelope` variants carry **no control-plane authority**. They are desktop-authoritative signals: local execution progress, checkpoints, artifacts, runtime observations, audit *candidates*, and the three transport variants (`sync.ack`, `sync.heartbeat`, `sync.resync_request`).
- `ServerEnvelope` variants carry all control-plane truth: `policy.updated`, `grant.updated`, `deploy.status`, `project.updated`, `factory.event`, plus transport. (The original 087 §5.3 also listed `workspace.updated`; spec 119 retired the workspace entity, and the variant collapses into `project.updated`.)
- **Extension rule.** Adding a new `ClientEnvelope` variant is a **governance act**, not a types change. A variant that asserts authoritative server state (e.g. "policy override", "deploy trigger") requires a spec amendment; a variant that reports a local observation is within scope.

`audit.candidate` is the one inbound variant that results in a durable write. Statecraft normalises the action (`opc.` prefix), stamps `actor_user_id` from the authenticated JWT, and writes to `audit_log` — the desktop cannot forge the actor or the project.

#### Functional Requirements

| ID | Requirement | Severity | Status |
|----|-------------|:--------:|:------:|
| **FR-SYNC-001** | The stream MUST be opened with `auth: true`; `projectId` MUST be read from `getAuthData()`, never from the handshake. A handshake with no project in the auth token is NACKed and the stream closed. | correctness | shipped |
| **FR-SYNC-002** | Before `registry.register`, the handler MUST verify the authenticated user holds an active membership for the project (a `project_members` row for that user/project, OR `org_memberships.status = 'active'` for an org-level member). JWT-claimed `oap_project_id` alone is NOT sufficient. | **correctness — blocker** | not shipped |
| **FR-SYNC-003** | Every envelope's `meta` MUST carry `v: 1`. The inbound guard enforces strict equality; mismatched or missing `v` is rejected as `invalid`. Bumping the protocol is a wire-format change: the `EnvelopeSchemaVersion` literal and the guard move together. | correctness | shipped |
| **FR-SYNC-004** | `ClientAuditCandidate` MUST be written as `audit_log` with server-stamped `actor_user_id`, `projectId`, and `clientId`. Client-supplied timestamps and actors are ignored. | correctness | shipped |
| **FR-SYNC-005** | The outbox and inbox MUST persist to Postgres (`sync_outbox(project_id, cursor, event_id, payload, created_at)`, `sync_outbox_delivery(project_id, event_id, client_id, acked_at)`, `sync_inbox(...)`). The in-memory stores in `store.ts` are a foundation; the interfaces (`OutboxStore`, `InboxStore`, `CursorIssuer`) exist specifically to accept a Drizzle-backed swap without touching `service.ts` or `duplex.ts`. | durability | not shipped |
| **FR-SYNC-006** | When statecraft runs with replicas > 1, `dispatchServerEvent` MUST fan out via PubSub (or equivalent) so every replica's local registry sees every project event. Without this, a producer on replica A does not reach a client connected to replica B. | correctness (multi-replica) | not shipped |
| **FR-SYNC-007** | The broadcast loop MUST apply backpressure: a slow client MUST NOT stall other clients. Implementation options: per-client bounded send queue with drop policy, or concurrent sends with a per-client deadline. | liveness | not shipped |
| **FR-SYNC-008** | Metrics MUST be exposed: `sync_connections_total`, `sync_events_inbound_total{kind,status}`, `sync_events_outbound_total{kind}`, `sync_ack_latency_seconds`. | observability | not shipped |
| **FR-SYNC-009** | Inbound MUST be rate-limited per `clientId` (token-bucket, default 100/s, burst 200). Excess events are NACKed with `reason: "invalid"` and `detail: "rate_limited"`. | abuse resistance | not shipped |
| **FR-SYNC-010** | The legacy `projectEventStream` streamOut + `ingestOpcEvent` HTTP POST path in `api/sync/sync.ts` MUST be decommissioned once `web/`, `product/apps/opc`, and `product/packages/project-sdk` are migrated to the duplex. Coexistence is additive, not permanent. | hygiene | migration tracked |
| **FR-SYNC-011** | Session teardown MUST be **stream-identity-scoped**. The desktop reuses a stable `clientId` across reconnects, so a new connection can occupy the `(orgId, clientId)` registry slot while the prior connection is still tearing down. `registry.unregister` MUST NOT evict the slot when a *newer* session's stream already holds it — the dying connection's `finally` passes its own `stream` and the registry deletes only on a stream-identity match. Without this guard the old connection orphans the live reconnect, whose next heartbeat then collapses it before `sync.hello`, wedging the spec-183 boot gate in a connect→close→reconnect loop. | correctness — blocker | shipped |

#### Retention Calculus (In-Memory Stores)

The in-memory outbox cap is `MAX_OUTBOX_PER_PROJECT = 500` (`store.ts`). At a target project event rate of **~10 events/s** (factory progress + audit + periodic deploy/grant changes), this retains roughly **50 seconds** of history. At a burst rate of **50 events/s** (e.g., factory stage fan-out), retention falls to **10 seconds**.

A client that reconnects after a gap greater than the retained window receives `sync.resync_required(reason: "cursor_gap")` and must refetch state via existing REST endpoints. This is acceptable while statecraft deploys take single-digit seconds; it is NOT acceptable for deploys exceeding the retention window or for any scenario where in-flight state cannot be refetched. FR-SYNC-005 removes this constraint.

The in-memory inbox cap is `MAX_INBOX_HISTORY = 1000` and is used only for debug/inspection; audit candidates are durably written regardless.

#### Reconnect Session-Identity Teardown (FR-SYNC-011)

The registry is keyed `(orgId, clientId)` and the desktop reuses one `clientId` across reconnects (spec 183 — the `client_id` survives a settings-driven re-spawn). Every reconnect therefore collides on the same slot:

1. Conn **A** is registered and awaiting its inbound loop.
2. The desktop reconnects (e.g. spec 183's sign-in `reconnect_statecraft_duplex`) → Conn **B**, same `clientId`. `register` closes A's stream and installs B.
3. A's inbound loop ends (its stream was just closed) → A's `finally` runs `registry.unregister(orgId, clientId)`.
4. A *clientId-only* delete here removes **B's** entry — B is orphaned; its next heartbeat finds no session, flips `heartbeatAlive = false`, and B's loop breaks and closes. The client sees connect → close with **no `sync.hello`**, reconnects, and the cycle repeats.

The fix: `unregister(orgId, clientId, stream?)` deletes only when the registered session's `stream` matches the caller's (`registry.ts`); the duplex handler's `finally` passes its own `stream` (`duplex.ts`). `register`'s replace-and-close of a superseded session is retained — only the teardown is identity-scoped. Server-originated prunes (`sendTo`/`broadcastOrg`) pass no `stream` and act on the session they just fetched, so their behaviour is unchanged. This corrects the residual *server-side* race left after spec 183's #303/#305 *client-side* reconnect fixes.

#### Membership Gate Design (FR-SYNC-002)

The gate is a single pre-`register` check inside `duplex.ts`:

```ts
const hasMembership = await membership.isActiveMember({
  userId: auth.userID,
  projectId,
});
if (!hasMembership) {
  // NACK with reason: "unauthorized", detail: "no project membership"
  await stream.close();
  return;
}
```

`membership.isActiveMember` resolves by joining `project_members` (direct project membership) or `org_memberships` (for org-level members with implicit access). A permission grant that shrinks membership without rotating the JWT MUST take effect within the next connection; existing connections MAY remain until next handshake (documented as an accepted tradeoff).

#### Schema Versioning Design (FR-SYNC-003)

- `EnvelopeSchemaVersion = 1` is a TypeScript literal type exported from `types.ts`.
- Every envelope sender writes `meta.v = ENVELOPE_SCHEMA_VERSION`.
- The inbound guard `isClientEnvelope` rejects `m.v !== 1` as invalid.
- Protocol bumps are lock-step: literal type + runtime guard update together, and the change is noted in this spec with a version compatibility matrix.
- Future direction: when v2 ships, the server MAY accept both `1` and `2` for inbound and send `v` matching the client's announced version from the handshake. That is out of scope until there is a second version.

## 6. Identity Consolidation

```
GitHub App Installation ──→ Organization (trust anchor)
GitHub OAuth             ──→ User identity + org membership
Rauthy                   ──→ Session tokens (JWT) for both planes
                              M2M tokens for OPC ↔ Statecraft
```

One identity, two sessions:
- **Web session:** Rauthy-issued JWT in browser cookie, project-scoped
- **Desktop session:** Rauthy-issued JWT in OS keychain, project-scoped
- Both obtained via GitHub OAuth (web redirects to browser, desktop uses `opc://` deep-link callback)

Password-based auth is removed once Rauthy is fully wired (spec 080).

## 7. Shared Component Architecture

```
packages/
  @opc/ui/                ← shared React component library (exists)
  @opc/types/             ← shared TypeScript types (exists)
  @opc/project-sdk/       ← NEW: project domain client (originally @opc/workspace-sdk; renamed by spec 119)
    ├── project.ts         — Project, KnowledgeObject types
    ├── knowledge.ts       — Knowledge intake types and state machine
    ├── factory.ts         — Factory pipeline state machine
    ├── sync.ts            — WebSocket + HTTP sync protocol
    └── auth.ts            — Token management (Rauthy JWT)
```

`@opc/project-sdk` is consumed by both the Statecraft web UI and the OPC React frontend, ensuring identical domain models and state rendering across planes.

## 8. Implementation Phases

### Phase 1: Project Foundation

- Add `projects` table to Statecraft schema (originally proposed `workspaces` + `projects`; collapsed to a single `projects` table by spec 119)
- Project CRUD endpoints
- Replace `DEFAULT_ORG_ID` with project-scoped queries across all Statecraft endpoints
- Add project sync to OPC's `StatecraftClient`
- Create `@opc/project-sdk` package with core types

### Phase 2: Knowledge Intake Domain

- Add `knowledge_objects`, `source_connectors` tables (originally also included `document_bindings`; retired by spec 119 along with the workspace layer)
- Knowledge object CRUD + upload endpoint
- S3-compatible object store integration (MinIO for local dev, S3/Azure Blob for prod)
- Extraction pipeline (OCR, text extraction, classification)
- Provenance tracking
- Factory pipeline wiring: stage 0 pre-flight reads selected knowledge objects

### Phase 3: Web UI + Sync Channel

- Statecraft web UI (React SPA sharing `@opc/ui`)
- WebSocket relay on Statecraft (project-scoped event channel)
- OPC WebSocket client for real-time updates
- Factory pipeline dashboard (web)
- Knowledge object browser and selection UI (web)
- Deploy status and promotion UI (web)

### Phase 4: Connector Framework

- `SourceConnector` trait/interface with pluggable implementations
- SharePoint Online connector (Microsoft Graph API, OAuth2, delta sync)
- Upload connector (finalise as the reference implementation)
- Connector configuration UI in project settings
- Scheduled sync with change detection

### Phase 5: Identity + Governance Hardening

- Remove password auth from Statecraft
- OIDC JWT enforcement on all seams (A, B, C, D) per spec 082
- OS keychain storage for desktop session
- Unified RBAC model in `@opc/project-sdk`

## 9. Database Schema Additions (Statecraft)

> **Historical record (2026-04-09):** the schema below was the original proposal in this spec. Spec 119 (2026-04-29) collapsed `workspaces` into `projects`, retired `document_bindings`, and renamed `workspace_id` → `project_id` on `source_connectors`, `knowledge_objects`, and downstream consumers. The canonical post-amendment schema lives in spec 119 §4. The original SQL is retained verbatim below for traceability.

```sql
-- Workspace: operational container scoped to a GitHub org
-- (Retired by spec 119; properties moved onto `projects`.)
CREATE TABLE workspaces (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL REFERENCES organizations(id),
    name TEXT NOT NULL,
    slug TEXT NOT NULL,
    object_store_bucket TEXT NOT NULL,  -- S3-compatible bucket for this workspace
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(org_id, slug)
);

-- Source connector: external knowledge source configuration
-- (Spec 119: workspace_id renamed to project_id.)
CREATE TABLE source_connectors (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES workspaces(id),
    type TEXT NOT NULL,          -- 'upload' | 'sharepoint' | 's3' | 'azure-blob' | 'gcs'
    name TEXT NOT NULL,
    config_encrypted JSONB,      -- connector-specific config (credentials encrypted)
    sync_schedule TEXT,           -- cron expression for scheduled sync
    status TEXT NOT NULL DEFAULT 'active',
    last_synced_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Knowledge object: canonical normalised document in workspace store
-- (Spec 119: workspace_id renamed to project_id; CAS uniqueness now keyed on project_id.)
CREATE TABLE knowledge_objects (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES workspaces(id),
    connector_id UUID REFERENCES source_connectors(id),
    storage_key TEXT NOT NULL,    -- S3 object key within workspace bucket
    filename TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    size_bytes BIGINT NOT NULL,
    content_hash TEXT NOT NULL,   -- SHA-256 of content
    state TEXT NOT NULL DEFAULT 'imported',  -- imported|extracting|extracted|classified|available
    extraction_output JSONB,     -- structured extraction result
    classification JSONB,        -- platform concern tags
    provenance JSONB NOT NULL,   -- { source_type, source_uri, imported_at, version_id }
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Document binding: links knowledge objects to projects
-- (Retired by spec 119; cross-project sharing displaced by clone copy.)
CREATE TABLE document_bindings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES projects(id),
    knowledge_object_id UUID NOT NULL REFERENCES knowledge_objects(id),
    bound_by UUID NOT NULL REFERENCES users(id),
    bound_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(project_id, knowledge_object_id)
);
```

## 10. Non-Functional Requirements

- **NF-001:** Knowledge objects must be immutable once in state `available`. Updates create new versions with provenance linking to the prior version.
- **NF-002:** The object store must be S3-compatible (MinIO for local dev, any S3-compatible provider for production). The endpoint used for browser-issued presigned URLs MUST be reachable from the browser origin under TLS — separately configurable from the server-side endpoint where the two diverge. _(Browser-reachability clause added by spec 143 amendment, 2026-05-08; see spec 143 for the dual-endpoint storage client design and Hetzner ingress topology. Pre-amendment text was silent on browser-reachability, which let the Hetzner deployment ship with a cluster-internal `S3_ENDPOINT` that no browser PUT could reach — see spec 143 §1 evidence ledger.)_
- **NF-003:** Adding a new connector type requires implementing one trait/interface and registering it — no changes to the knowledge object model or factory integration.
- **NF-004:** OPC must function fully offline. Platform connectivity is optional for all execution operations. Sync happens opportunistically when connectivity is available.
- **NF-005:** The WebSocket relay must be project-scoped. An OPC instance only receives events for projects it is authenticated to.
- **NF-006:** Factory policy shards are project-scoped and travel with the pipeline — they must not require live platform connectivity during execution.
- **NF-007** _(maintenance, 2026-05-05):_ `platform/services/statecraft/package-lock.json` is regenerated under npm 10 to match the CI runtime; the lockfile shape is non-load-bearing for spec semantics but is owned by 087 (and joint-claimed by 077, 080) for the spec/code coupling gate. Lockfile churn from npm version drift does not require a content amendment to this spec — recording the maintenance event here is sufficient.
- **NF-007.1** _(maintenance, 2026-05-05):_ second `package-lock.json` regen under npm 10 cut alongside the OPC desktop v0.3.2 + axiomregent v0.1.5 release. Same maintenance pattern as NF-007.

## 11. End-State Model Summary

```
GitHub org          = trust anchor
Project             = operational container (identity, governance,
                      collaboration, knowledge intake, repos,
                      environments, factory execution)
Knowledge store     = canonical project document substrate
Factory             = execution artifact that transforms project
                      knowledge into project output
Desktop (OPC)       = execution plane
Web (statecraft.ing)= governance and management plane
```

The factory is not merely turning prompts into code. It is operating over a governed body of project knowledge. Cross-project knowledge use happens via the clone pipeline (specs 113, 114), which copies into the destination — superseding the original 087 model where multiple projects shared a workspace knowledge corpus via `document_bindings`.

## 12. Open issues / follow-ups (amendment, 2026-05-08)

This section was opened by the spec 143 implementation (Hetzner end-to-end deploy on 2026-05-08) surfacing a data-integrity finding that belongs on this spec's surface — `object_store_bucket` is defined here in §9 / NF-002. Future entries land here.

**FU-005 — Bucket-name-length validation at project creation.** S3 (and S3-compatible backends including MinIO) rejects bucket names longer than 63 characters per the AWS S3 bucket-naming rules. Statecraft project creation currently composes `object_store_bucket` (defined here in §9, browser-reachability requirement added in NF-002 by spec 143) by concatenating an `oap-statecrafting-` prefix with the project slug; long project names produce buckets that exceed the ceiling and silently fail to be created in MinIO when the first upload is requested. The project row is otherwise valid, so the failure is invisible to the project list — it manifests only when `mc share upload` / `putObject` is finally called and errors with "Bucket name cannot be longer than 63 characters".

Empirical evidence (Hetzner cluster, 2026-05-08): a project named "Acme Vendor Onboarding and Eligibility Determination Services Portal" produced bucket `oap-statecrafting-acme-example-portal` (over the 63-char bucket limit). The bucket was never created in MinIO; every upload to that project would have failed at the storage layer. Surfaced during spec 143 deploy validation when the validate script's `ORDER BY created_at ASC LIMIT 1` query happened to pick this project as the canary - see spec 143 §12 FU-004(a) for the script-side fixture fix.

Required fix at the schema / project-creation surface (this is the **production data-integrity** fix; the script-side fix lives on spec 143 as FU-004(a)):

1. **Runtime guard at project creation.** Statecraft's project-creation handler MUST reject (or truncate with a deterministic suffix) a composed bucket name whose length exceeds 63 characters. Surface as `APIError.invalidArgument` with a user-facing diagnostic naming the limit, the prefix, and the slug headroom (`63 - length("oap-statecrafting-") = 44 chars` available for the slug).

2. **Schema-level CHECK constraint.** Add `CHECK (length(object_store_bucket) <= 63)` in a new migration on the `projects` table (or wherever the column ended up post-spec 119). The constraint protects against any future composer that drifts away from the slug-based shape.

3. **Backfill audit.** `SELECT id, name, length(object_store_bucket) FROM projects WHERE length(object_store_bucket) > 63;` enumerates the affected set. The 2026-05-08 audit found at least one row (the project named above). Existing violators need a remediation plan — likely a deterministic rehash to a 32-char prefix-keyed shape (e.g. `oap-statecrafting-<sha256(slug)[:32]>`), since renaming a project's bucket post-hoc requires either a data move (none, in this case — the bucket was never created) or, for projects with extant blobs, a migration that copies objects bucket-to-bucket and updates `storage_key` references in `knowledge_objects`.

4. **Slug derivation review.** The slug component should itself be length-bounded at the slug-derivation surface (likely the project-creation API handler or a UI-side pre-check), so the user gets feedback at name-entry time rather than at first-upload time. AWS S3 bucket names also restrict character set (lowercase, digits, hyphens, no consecutive hyphens, etc.); the derivation should cover those constraints in the same pass.

Cross-reference:
- Spec 143 §12 FU-004(a) — script-side fix to skip invalid buckets in the validate canary; complements but does not replace this fix.
- Spec 119 — collapsed workspace into project; the `object_store_bucket` column moved with the collapse but the constraint did not exist in either pre- or post-spec-119 schema.
- Spec 113 — project rename / clone; if rename re-derives the bucket, the same length guard must apply at rename time, otherwise a project that was created under the limit can drift over it via rename.

Both FU-004 (test surface) and FU-005 (production surface) must land for the upload chain to be robust against arbitrary user-named projects. FU-005 is the load-bearing fix; FU-004 is the test-side defence so future deploys catch the failure mode before it reaches production data.
