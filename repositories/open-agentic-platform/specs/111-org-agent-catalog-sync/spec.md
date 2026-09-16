---
id: "111-org-agent-catalog-sync"
slug: org-agent-catalog-sync
title: Org-managed Agent Catalog Synced from Statecraft to OPC
status: approved
implementation: complete
owner: bart
created: "2026-04-21"
amended: "2026-05-05"
amendment_record: "139-factory-artifact-substrate"
kind: platform
domain: platform
summary: >
  Treats agents as organisational assets stored in statecraft and pushed to
  OPC via the duplex channel (spec 087 §5.3). Workspaces author, version,
  and govern agent definitions in the web UI; connected OPC instances
  receive them as a workspace-scoped catalog that local SQLite caches.
  The local `.claude/agents/` path remains available as a fallback for
  offline/personal agents; the authoritative catalog is remote. Documents
  the decision to keep model API keys on OPC machines.
depends_on:
  - "042-multi-provider-agent-registry"  # multi-provider-agent-registry (existing provider abstraction)
  - "054-agent-frontmatter-schema"  # agent-frontmatter-schema (the UnifiedFrontmatter contract)
  - "068-permission-runtime"  # permission-runtime (how policies attach)
  - "087-unified-workspace-architecture"  # unified-workspace-architecture (duplex channel + authority)
  - "090-governance-non-optionality"  # governance-non-optionality (no bypass of policy bundle)
  - "110-statecraft-to-opc-factory-trigger"  # statecraft-to-opc-factory-trigger (establishes the dispatcher pattern)
establishes:
  - unit: { kind: directory, path: platform/services/statecraft/api/agents }
  - unit: { kind: file, path: platform/services/statecraft/api/agents/catalog.ts }
  - unit: { kind: file, path: platform/services/statecraft/api/agents/relay.ts }
  - unit: { kind: directory, path: platform/services/statecraft/api/agents/frontmatter }
  - unit: { kind: file, path: platform/services/statecraft/api/sync/types.ts }
  - unit: { kind: file, path: platform/services/statecraft/api/sync/service.ts }
  - unit: { kind: file, path: platform/services/statecraft/api/sync/duplex.ts }
  - unit: { kind: file, path: platform/services/statecraft/api/sync/relay.ts }
  - unit: { kind: file, path: product/apps/opc/src-tauri/src/commands/agents.rs }
  - unit: { kind: file, path: product/apps/opc/src-tauri/src/commands/agent_catalog_sync.rs }
  - unit: { kind: file, path: product/apps/opc/src-tauri/src/commands/statecraft_client.rs }
references:
  - role: historical
    unit: { kind: file, path: platform/services/statecraft/web/app/routes/app.workspace.agents.tsx }
---

# 111 — Org-managed Agent Catalog Synced from Statecraft to OPC

> **Amended 2026-05-05 by spec [139](../139-factory-artifact-substrate/spec.md).**
> The `agent_catalog` table generalises into the
> `factory_artifact_substrate` as the `origin='user-authored'`,
> `kind='agent'` partition. The `/api/orgs/:orgId/agents/*` handlers
> re-point at the substrate in spec 139 Phase 4 narrow (`catalog.ts`)
> and Phase 4b (`bindings.ts`); the public API surface is preserved.
> `agent_catalog` and `agent_catalog_audit` are dropped by migration 35
> (Phase 4b). See [implementation-audit.md](./implementation-audit.md)
> for the full cutover trail.

## 1. Problem

Today every OPC user authors and stores agent definitions locally, in a
SQLite database under the Tauri app data dir (`agents.db`, managed by
`product/apps/opc/src-tauri/src/commands/agents.rs`). The on-disk
`.claude/agents/*.md` markdown catalog is also local. There is **no
mechanism** for a team to share a curated agent (specific prompt, model,
tools, hooks, safety tier) across desktops.

Consequences:

1. Every teammate rebuilds the same agent, or copies markdown files via
   version control.
2. Governance is per-desktop. A policy bundle change (spec 047) does not
   automatically invalidate agents that were approved under the prior
   bundle.
3. Factory pipelines that want to run with a specific stage-0 agent
   cannot reference it by ID — only by shipping the file via the repo.
4. The broader thesis "statecraft orchestrates, OPC executes" (087 §3.1,
   108 §7) is undermined: agent *definition* is execution-adjacent
   configuration and belongs on the platform side.

Spec 042 introduced a provider-registry abstraction but scoped it to
local provider wiring. Spec 054 unified the frontmatter format but said
nothing about where the files live. Spec 087 defined policy bundles that
travel web → desktop but did not extend the pattern to agents.

## 2. Decision

Make the **authoritative agent catalog** a statecraft workspace entity.
Desktops receive a workspace-scoped snapshot via the duplex channel and
cache it locally. Personal/offline agents (in `.claude/agents/*.md` or
locally-created via the desktop UI) continue to work, but are marked
`source: "local"` and do not shadow a remote agent of the same name.

### 2.1 Data model

New tables in statecraft (migration 21 — slot 20 was consumed by spec 110
Phase 3 `factory_pipelines.source`; slot 21 is the first free index after
the 2026-04-21 merge order):

```sql
CREATE TABLE agent_catalog (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id    UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    name            TEXT NOT NULL,                -- kebab-case, unique per workspace
    version         INTEGER NOT NULL DEFAULT 1,   -- monotonic per (workspace_id, name)
    status          TEXT NOT NULL,                -- draft | published | retired
    frontmatter     JSONB NOT NULL,               -- UnifiedFrontmatter serialised
    body_markdown   TEXT NOT NULL,                -- the agent's system prompt body
    content_hash    TEXT NOT NULL,                -- sha-256 over frontmatter+body
    created_by      UUID NOT NULL REFERENCES users(id),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (workspace_id, name, version)
);

CREATE INDEX agent_catalog_ws_name_idx ON agent_catalog (workspace_id, name);
CREATE INDEX agent_catalog_ws_status_idx ON agent_catalog (workspace_id, status);

-- Versioned audit of catalog mutations.
CREATE TABLE agent_catalog_audit (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agent_id        UUID NOT NULL REFERENCES agent_catalog(id) ON DELETE CASCADE,
    workspace_id    UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    action          TEXT NOT NULL,                -- create|publish|retire|fork|edit
    actor_user_id   UUID NOT NULL REFERENCES users(id),
    before          JSONB,
    after           JSONB,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

The `frontmatter` JSONB is a serialised `UnifiedFrontmatter` (crate
`agent-frontmatter`, spec 054). No schema drift — statecraft imports the
same type through a small shared TS mirror (auto-generated from the Rust
types, pattern already used elsewhere).

### 2.2 New API endpoints (statecraft)

All under `api/agents/`:

| Endpoint | Purpose |
|---|---|
| `POST /api/agents` | create draft agent in current workspace |
| `GET /api/agents` | list agents in workspace (filter by status) |
| `GET /api/agents/:id` | fetch full definition |
| `PATCH /api/agents/:id` | edit draft (bumps content_hash, not version) |
| `POST /api/agents/:id/publish` | draft → published; bumps `version`, triggers sync |
| `POST /api/agents/:id/retire` | published → retired; triggers removal from OPC caches |
| `POST /api/agents/:id/fork` | copy into a new draft, new name |

All require `auth: true`. RBAC: any workspace member can read; publish/
retire require `workspace:admin` or `agents:publish` role (new role).

### 2.3 Duplex envelope additions

New `ServerEnvelope` variants:

```ts
interface AgentCatalogUpdated {
  v: 1;
  kind: "agent.catalog.updated";
  event_id: string;
  workspace_id: string;
  agent_id: string;           // remote id
  name: string;               // catalog key
  version: number;
  status: "published" | "retired";
  content_hash: string;
  frontmatter: UnifiedFrontmatter;   // serialised
  body_markdown: string;
  updated_at: string;
}

interface AgentCatalogSnapshot {
  v: 1;
  kind: "agent.catalog.snapshot";    // full replay on reconnect
  event_id: string;
  workspace_id: string;
  entries: Array<{
    agent_id: string;
    name: string;
    version: number;
    status: "published" | "retired";
    content_hash: string;
    // NOTE: no frontmatter/body here — snapshot is a directory, not a
    // full dump. Desktop requests full bodies individually via
    // ClientEnvelope::agent.catalog.fetch_request (see below) when a
    // content_hash doesn't match its cache.
  }>;
}
```

And a `ClientEnvelope` variant (observation — within scope):

```ts
interface AgentCatalogFetchRequest {
  v: 1;
  kind: "agent.catalog.fetch_request";
  workspace_id: string;
  agent_id: string;
  reason: "cache_miss" | "hash_mismatch" | "manual_refresh";
  observed_at: string;
}
```

The server responds with a fresh `agent.catalog.updated` targeted at the
requesting session_id.

### 2.4 Desktop cache & merge semantics

The desktop maintains the local SQLite `agents` table but adds two
columns:

```sql
ALTER TABLE agents ADD COLUMN source TEXT NOT NULL DEFAULT 'local';
-- 'local' | 'remote'
ALTER TABLE agents ADD COLUMN remote_agent_id TEXT;
ALTER TABLE agents ADD COLUMN remote_version INTEGER;
ALTER TABLE agents ADD COLUMN remote_content_hash TEXT;
ALTER TABLE agents ADD COLUMN workspace_id TEXT;    -- set when source = 'remote'
```

Merge rules:

- A `remote` agent with a given `name` takes precedence over a `local`
  agent with the same name in the *same workspace context*. The local
  copy is preserved but hidden in the UI and excluded from tier-1
  catalog selection.
- A `local` agent outside any workspace (user created while offline) is
  always available.
- `.claude/agents/*.md` files in the current project are treated as
  `local`, `source: "file"` (new sub-kind). They act as ad-hoc agents
  for that project only.

On reconnect, the desktop:

1. Sends the last-seen `workspace_cursor` (per 087 §5.3).
2. Receives `agent.catalog.snapshot` with all currently-published entries.
3. For any entry where `content_hash` ≠ local cache, sends
   `agent.catalog.fetch_request` to pull the body.
4. Deletes `remote` rows whose `agent_id` is not in the snapshot (retired
   or deleted upstream).

### 2.5 Web UI

New page: `app.workspace.agents.tsx` and nested:

- `app.workspace.agents._index.tsx` — list view (draft/published/retired
  tabs, search by name or tag).
- `app.workspace.agents.new.tsx` — create draft.
- `app.workspace.agents.$agentId.tsx` — detail + markdown editor with
  frontmatter form fields for Tier-1/Tier-2 properties (type-safe, per
  spec 054).
- `app.workspace.agents.$agentId.publish.tsx` — publish confirmation
  modal; shows policy bundle requirements; logs audit.
- `app.workspace.agents.$agentId.history.tsx` — version history from
  `agent_catalog_audit`.

The editor runs the `agent-frontmatter` linter on save (via a server-side
API that calls the Rust crate via a small HTTP service, or — simpler —
ports the lint rules to a TS mirror). A draft that fails lint cannot be
published.

### 2.6 Policy bundle + governance

A published agent references the policy bundle that was active at
publication time. If the workspace's policy bundle is subsequently
updated, the agent is **not** automatically retired. Instead, publishing
emits an audit entry noting the bundle hash; executions of the agent
under a newer bundle include the drift delta in their audit candidate
(spec 098 territory). This keeps governance transparent without forcing
a retire-storm on every policy update.

## 3. Model API keys stay on OPC (design decision)

The 2026-04-21 architectural review considered proxying inference through
statecraft so that model API keys could be centrally managed. **Decided:
keys stay on OPC.** Rationale:

- Inference round-trips through a platform-hosted proxy add latency that
  user-facing agent streams cannot tolerate.
- Billing exposure, key rotation, and per-tenant metering become
  statecraft concerns that scope-creep the platform.
- Spec 087 NF-004 mandates OPC functions fully offline. A proxy path is
  incompatible with this guarantee without a parallel "direct mode" that
  undermines the centralisation.
- Prompt content privacy: routing all inference through statecraft
  creates a single-point log of every prompt/response. Desktop-local
  inference keeps conversations between the user and the model vendor.

Consequence: agent definitions travel remotely, but the model calls they
produce stay local. Secrets for provider access remain in the OS keychain
(spec 065). This spec explicitly **rules out** a `ServerEnvelope::api_key
.updated` variant — key distribution is out of band.

## 4. Non-goals

- **Agent *execution* pushed from statecraft.** This spec ships
  definitions; execution triggers are a separate concern. For factory,
  see spec 110. For general agent invocation, a future spec may define
  `ServerEnvelope::agent.invoke.request` using the same authority model.
- **Marketplace / cross-org sharing.** Agents are scoped to one
  workspace. Sharing between workspaces or publishing to a public
  registry is deferred.
- **Inline code execution in definitions.** An agent is a prompt + config.
  Any "tools" referenced are already bound by the tool-registry (spec
  067) — they are names the OPC side resolves locally.
- **Versioned rollback via remote control.** Rollback means authoring a
  new `published` version that matches the prior content. No in-place
  revert.

## 5. Open questions

1. **Name collisions across workspaces.** If a user belongs to multiple
   workspaces, and both publish an agent named `triage`, which is active
   in a given tab? Proposal: each tab is workspace-bound (spec 110 §2.4);
   the agent resolution is scoped to the tab's workspace. Cross-workspace
   visibility is an explicit user action (workspace switcher).
2. **Conflict resolution for concurrent edits.** Statecraft is single-
   writer-per-session (optimistic lock via `content_hash`); drafts can't
   collide. Open: do we want collaborative real-time editing on the
   draft markdown? Lean no — publication is the collaboration point.
3. **Body size.** Large system prompts (50k+ tokens) over the duplex
   channel are fine per-event but inflate snapshots on reconnect. Mitigate
   by keeping `agent.catalog.snapshot` as a directory (just hashes, no
   bodies), which forces lazy pull. Already in §2.3.

## 6. Verification

- Unit: `agent_catalog_audit` integrity; content_hash stability under
  frontmatter key ordering.
- Integration: publish → snapshot fan-out; retire → deletion propagation;
  reconnect with stale cache → fetch_request storm bounded by cursor.
- Desktop: merge precedence (remote beats local same-name); offline
  edit that conflicts with remote on reconnect produces a clear
  "local-only copy retained" UI signal.

## 7. Rollout

1. Migration 21; API endpoints without sync envelopes — admins can CRUD
   agents, but desktops don't receive them. **Shipped 2026-04-22.**
2. Extend `agent-frontmatter` types for the JSONB round-trip (shared
   type generator). **Shipped 2026-04-22.** See §7.2 for the contract.
3. Add `agent.catalog.snapshot` and `agent.catalog.updated` envelopes
   (desktop-side behind a feature flag in the statecraft client).
   **Shipped 2026-04-22.** See §7.3 for the contract.
4. Ship the web UI. **Shipped 2026-04-22.** See §7.4 for the contract.
5. Flip the desktop flag; remote agents become visible.
   **Shipped 2026-04-22.** See §7.5 for the contract.
6. Write migration notes for users with existing local agents (they
   remain local; publishing them to remote is a one-click action in the
   desktop UI — generates a draft in statecraft). **Shipped 2026-04-22.**
   See §7.7 for the contract.

### 7.2 Phase 2 — shared type generator contract

`crates/agent-frontmatter/src/types.rs` owns the authoritative
`UnifiedFrontmatter` shape. The TypeScript mirror lives under
`platform/services/statecraft/api/agents/frontmatter/`:

```
frontmatter/
  AgentType.ts              (generated)
  GovernanceRequirement.ts  (generated)
  HookDeclaration.ts        (generated)
  HookHandlerType.ts        (generated)
  MutationCapability.ts     (generated)
  SafetyTier.ts             (generated)
  UnifiedFrontmatter.ts     (generated)
  index.ts                  (hand-maintained — barrel + CatalogFrontmatter alias)
```

**Generator:** `ts-rs` (regular dep on `agent-frontmatter`). The derive
fires on every `cargo test` run for the crate; files are written to the
location pinned by `TS_RS_EXPORT_DIR` in repo-root `.cargo/config.toml`.

**Contributor workflow for schema changes:**

1. Edit the Rust types in `crates/agent-frontmatter/src/types.rs`.
2. Run `make agent-frontmatter-ts` to regenerate the TS mirror.
3. Commit the Rust and TS changes in the same PR.

**CI drift gate:** `make ci-agent-frontmatter-ts` regenerates the
mirror and fails if `git diff --exit-code` or an untracked-file scan
shows a drift. Wired into `.github/workflows/ci-crates.yml` on the
`agent-frontmatter` matrix slot, and into `make ci-statecraft` locally
(so `make ci` catches drift even during a statecraft-only edit session).

**Why `CatalogFrontmatter = UnifiedFrontmatter & { [key: string]: unknown }`:**
the Rust type preserves unknown keys via `#[serde(flatten)] extra`
(FR-013, spec 054). `ts-rs` can't express that on a named struct, so
`index.ts` re-introduces an open index signature on the TS side. Strict
fields stay strict; forward-compatible extras round-trip through JSONB
without a codegen bump.

**Why `computeContentHash` accepts `Record<string, unknown>`:** the
hash-stability invariant (§6) is about canonical JSON serialisation of
any shape, not whether the caller is typed as `CatalogFrontmatter`. The
wider signature lets the stability tests feed minimal objects while the
API endpoints still flow typed `CatalogFrontmatter` values in via
structural subtyping.

**JSONB round-trip guarantee.** `crates/agent-frontmatter/tests/ts_bindings.rs`
asserts that a fully-populated `UnifiedFrontmatter` (including `extra`
flatten keys, `SafetyTier::Tier2`, `AllowedTools::List`, and the `"*"`
wildcard) serde-round-trips through `serde_json::Value` without losing
or rewriting any field — the exact path taken on store and replay.

### 7.3 Phase 3 — duplex envelope contract

Landed 2026-04-22. Wires the catalog to the duplex channel established in
spec 087 §5.3 and exercised for factory in spec 110.

**Outbound (statecraft → OPC):**

- `agent.catalog.updated` is broadcast on every publish and retire (including
  the auto-retired prior row when a new version publishes). Also used as
  the targeted reply to `agent.catalog.fetch_request`.
- `agent.catalog.snapshot` is sent to a single client immediately after
  `sync.hello` on every handshake. Contains a directory of published
  entries (hashes, not bodies) so a reconnecting OPC can diff against its
  local cache and pull only the deltas. Retired agents are absent — the
  desktop infers removal from absence (§2.4).

**Inbound (OPC → statecraft):**

- `agent.catalog.fetch_request` carries `(workspaceId, agentId, reason)`
  where reason ∈ {`cache_miss`, `hash_mismatch`, `manual_refresh`}. The
  handler lives in `api/sync/service.ts` (inline with `handleInbound`,
  matching the audit-candidate pattern) — NOT in `api/agents/relay.ts`,
  which is outbound-only to avoid a module cycle with `sync/service`.
  The authenticated session's workspaceId wins over the claimed workspaceId;
  a mismatch is NACK'd as `workspace_mismatch` so a cross-workspace probe
  cannot leak membership. Drafts are NACK'd as `invalid` — they never
  travel the wire.

**Desktop posture during Phase 3:** the desktop's `sync_client.rs` recognises
both `agent.catalog.{updated,snapshot}` as known kinds (wire-level decode),
serialises the outbound `agent.catalog.fetch_request` frame, and has a typed
helper `send_agent_catalog_fetch_request` on `SyncClientInner`. No handler
is registered in the dispatch table during Phase 3 — cache integration and
the UI-facing events land in Phase 5 behind the feature flag. The decode
path must be live in Phase 3 so statecraft can start emitting without the
guard in `is_server_envelope` dropping the kinds.

**Why broadcast retired rows too.** Absence-means-removed semantics (§2.4)
only resolve on the next snapshot, which today fires at handshake. A
desktop that stays connected through a retire would otherwise never learn
the agent is gone. The `agent.catalog.updated { status: "retired" }`
envelope closes that gap — the desktop deletes the cache row on receipt
and the next snapshot confirms by omission.

### 7.4 Phase 4 — web UI contract

Landed 2026-04-22. Adds the statecraft-side authoring surface so workspace
admins can create, edit, publish, retire, and audit agent definitions
without touching the database or API by hand.

**Routes** (registered under the `/app` layout in `web/app/routes.ts`):

| Path | File | Purpose |
|---|---|---|
| `/app/workspace/agents` | `app.workspace.agents.tsx` | Section layout with an introductory header and `<Outlet />` |
| `/app/workspace/agents` (index) | `app.workspace.agents._index.tsx` | Status-tabbed list (all/draft/published/retired) with client-side name/tag search |
| `/app/workspace/agents/new` | `app.workspace.agents.new.tsx` | Create-draft form: name, Tier-1 frontmatter, body markdown |
| `/app/workspace/agents/:agentId` | `app.workspace.agents.$agentId.tsx` | Detail view — editable for drafts, read-only otherwise; supports save (with `expected_content_hash` optimistic lock), retire, fork |
| `/app/workspace/agents/:agentId/publish` | `app.workspace.agents.$agentId.publish.tsx` | Publish confirmation page — only drafts; redirects on success |
| `/app/workspace/agents/:agentId/history` | `app.workspace.agents.$agentId.history.tsx` | Append-only `agent_catalog_audit` trail for a single agent |

**API extension.** A new audit-list endpoint on the catalog module:

```
GET /api/agents/:id/audit
```

- Returns `{ entries: CatalogAuditEntry[] }` ordered by `created_at desc`,
  capped at 500. Snake_cased payload (`agent_id`, `actor_user_id`,
  `created_at`) to match the rest of the catalog API wire shape.
- Authorisation layers on top of the same `requireWorkspaceAuth` → load
  the catalog row under the workspace scope first, then query audit by
  `(agent_id, workspace_id)`. "Cannot read the agent → cannot read its
  audit."

**Auth + RBAC posture.** SSR loaders call `requireUser` and forward the
`__session` cookie to Encore. Write actions (publish, retire) reuse the
API-side `requirePublishRole`, which accepts `owner` and `admin` platform
roles. RBAC errors surface as APIError JSON and are unwrapped into the
inline error banner on the publish/retire routes.

**Optimistic locking.** The detail form carries `expected_content_hash`
as a hidden input. Server-side `patchAgent` rejects on mismatch with a
`content_hash mismatch` error, which the UI surfaces verbatim so the
user knows another session edited the draft. The same hash drives the
"hash changed" cache diff on the desktop side — the spec §6 invariant is
single-sourced from `computeContentHash`.

**Top-level nav.** `app.tsx` gains an "Agents" entry next to Dashboard
and Factory; the existing org-switcher and workspace pill are unchanged.

### 7.5 Phase 5 — desktop cache + dispatch contract

Landed 2026-04-22. Flips the OPC side from Phase 3's decode-only posture to
a fully wired cache so statecraft publish/retire events reach a connected
desktop in near-real time. Gated by the `OPC_REMOTE_AGENT_CATALOG` env var
so the default posture remains Phase 3 until operators explicitly opt in —
the feature flag exists because the desktop UI for surfacing remote vs.
local rows (§2.4 merge precedence) is a subsequent deliverable, and running
Phase 5 without that UI would let remote rows appear as ordinary agents.

**Desktop migration.** `agents::init_database` adds five tracking columns
plus a JSONB mirror on the existing `agents` SQLite table:

```sql
ALTER TABLE agents ADD COLUMN source TEXT NOT NULL DEFAULT 'local';
ALTER TABLE agents ADD COLUMN remote_agent_id TEXT;
ALTER TABLE agents ADD COLUMN remote_version INTEGER;
ALTER TABLE agents ADD COLUMN remote_content_hash TEXT;
ALTER TABLE agents ADD COLUMN workspace_id TEXT;
ALTER TABLE agents ADD COLUMN frontmatter_json TEXT;
CREATE UNIQUE INDEX agents_remote_id_uniq
    ON agents(remote_agent_id) WHERE remote_agent_id IS NOT NULL;
```

The partial index lets `remote_agent_id` be `NULL` on every legacy local
row while giving the remote-keyed upsert an atomic conflict target. The
`ON CONFLICT(remote_agent_id) WHERE remote_agent_id IS NOT NULL DO UPDATE`
form repeats the predicate verbatim because SQLite binds the upsert target
to the partial index only when the predicate matches literally.

**Cache module.** `product/apps/opc/src-tauri/src/commands/agent_catalog_sync.rs`
owns the Phase 5 surface:

- `feature_flag_enabled()` — env-var gate (`1|true|on|yes` enable; empty,
  `0|false|off` disable).
- `extract_remote_update(envelope)` — narrows a `ServerEnvelopeWire` to the
  row shape the DB needs. Returns `None` on missing required fields or an
  empty `workspace_id`, so a drifted server cannot poison the cache.
- `upsert_remote_agent(conn, update)` — stamps `source = 'remote'`, pulls
  `icon` and `model` out of frontmatter leniently (globe fallback for
  icon, `sonnet` fallback for model), and upserts on the partial index.
- `retire_remote_agent(conn, remote_agent_id)` — deletes by remote id.
  Idempotent: a retire for an unknown id is a zero-row no-op.
- `diff_snapshot(conn, workspace_id, entries)` — pure function returning a
  `Vec<SnapshotAction>` of `Fetch { CacheMiss | HashMismatch }` for
  drifted/missing rows and `Delete` for local rows absent from the
  snapshot. Scoped per workspace so a multi-tenant desktop cannot leak
  rows across workspaces. Non-`published` snapshot entries (which should
  never appear but could from a drifted server) are skipped.

**Dispatch handlers.** `register_agent_catalog_handlers(app)`:

- No-ops (logs once) when the feature flag is off.
- Installs `FnHandler` entries on `SyncClientState::dispatch_table()` for
  `agent.catalog.updated` and `agent.catalog.snapshot` when enabled.
- `agent.catalog.updated { published }` → upsert. `{ retired }` → delete.
  Any other status logs a warning and drops the frame so an out-of-band
  status string doesn't silently corrupt the cache.
- `agent.catalog.snapshot` → runs the diff, applies deletions first (so a
  reconnecting desktop settles monotonically), then spawns one async task
  that emits an `agent.catalog.fetch_request` per action on the outbound
  channel. A closed duplex drops pending fetches with a warn log — the
  next snapshot re-requests.
- Both handlers emit Tauri events (`agent-catalog-updated`,
  `agent-catalog-snapshot`) with `{ workspaceId, ... }` payloads so the
  frontend can refresh without polling.

**Feature flag lifecycle.** `lib.rs` calls the registrar unconditionally;
the gate lives inside so absence of the env var is a cheap info log rather
than a conditional `manage()` call. Phase 3 decode stays live either way —
when the flag is off, unknown-handler frames drop with the existing "no
handler registered" log, never crashing the reader.

### 7.6 Phase 5 verification surface

Unit coverage in `agent_catalog_sync::tests` (13 cases):

- Feature flag parsing (enabled/disabled strings).
- Envelope projection (required fields, missing field, empty workspace id).
- Upsert idempotency on repeated publishes (version + hash updated in
  place, row count stays at 1).
- Retire deletes only the targeted row; retire of unknown id is a no-op.
- Partial unique index allows multiple local rows with `NULL`
  `remote_agent_id`.
- Snapshot diff classifies cache miss, hash mismatch, and absence-delete
  independently; is scoped per workspace; skips retired snapshot entries.
- Icon/model derivation from frontmatter with correct fallbacks.

### 7.7 Phase 6 — local→remote publish contract

Landed 2026-04-22. Closes the migration path for users whose agents
predate the workspace catalog: a local SQLite row can seed a statecraft
draft with one click, without retyping the prompt into the web UI.

**Authority posture unchanged.** Phase 6 does not grant the desktop the
ability to *publish* — only to create a draft. Promoting the draft to
`published` still flows through `POST /api/agents/:id/publish`, which
requires `workspace:admin` (catalog.ts `requirePublishRole`). Non-admin
users can seed content; a workspace admin still reviews before it fans
out to other desktops via the Phase 3 envelopes.

**Command surface.**

```rust
#[tauri::command]
pub async fn publish_local_agent_to_workspace(
    db: State<AgentDb>,
    statecraft: State<StatecraftState>,
    agent_id: i64,
) -> Result<PublishLocalAgentResult, String>;
```

Lives in `product/apps/opc/src-tauri/src/commands/agent_catalog_publish.rs`.
Returns a `web_path` (`/app/workspace/agents/<remote_id>`) so the
frontend can open the statecraft detail page directly — the user lands
on the draft ready to publish.

**Preconditions enforced by the command:**

1. `StatecraftState` holds a configured client (base URL set).
2. The client carries a Rauthy JWT (spec 087 Phase 5) — workspaceId is
   read server-side from the `oap_workspace_id` claim, so the desktop
   does not need to pass it in the body.
3. The target row has `source = 'local'`. Publishing a row that is
   already a remote cache entry is a no-op the UI shouldn't offer, and
   the command rejects it explicitly so a mis-wired UI button cannot
   echo a remote row back through a second draft.

**Field mapping (local `agents` row → `CatalogFrontmatter` + body):**

| Local column        | Frontmatter key / body position                |
|---------------------|------------------------------------------------|
| `name`              | `name` (slugified) + `display_name` (original) |
| `icon`              | `icon`                                         |
| `model`             | `model`                                        |
| `default_task`      | `default_task` (extra field, JSONB-preserved)  |
| `enable_file_write` | → `mutation`                                   |
| `enable_network`    | → `mutation` (combined with `enable_file_write`)|
| `hooks` (JSON blob) | `hooks` when parseable as JSON object; else dropped |
| `system_prompt`     | `body_markdown`                                |
| first non-empty line of `system_prompt` | `description`                |

`safety_tier` is intentionally left unset on the draft. Local rows
carry only coarse boolean flags; the user must review and pin a tier in
the web UI before the admin publishes. This avoids laundering a Tier1
default onto a prompt that should have been Tier2.

**Slug normalisation.** Statecraft's `/api/agents` enforces
`^[a-z][a-z0-9]*(-[a-z0-9]+)*$`. The desktop's free-form names flow
through `slugify_agent_name`:

- lowercase ASCII;
- non-alphanumeric runs collapse to a single `-`;
- leading/trailing `-` are stripped;
- a leading digit is prefixed with `a-` so the regex anchor holds.

Input without any alphanumerics returns a caller-surfaced error — the
UI tells the user to rename the agent first rather than silently
fabricating a slug.

**Local row stays local.** The command does **not** touch the local
row's `source` column. The workflow is:

1. User clicks "Publish to workspace" on a local agent.
2. Desktop creates the draft in statecraft.
3. User (or a workspace admin) reviews + publishes via the web UI.
4. Published row fans back in via `agent.catalog.updated`.
5. Phase 5 cache ingestion inserts it as a `source='remote'` row.
6. Phase 3/5 merge semantics (§2.4) hide the `source='local'` copy in
   the desktop catalog list, since the remote row now shadows it.

The local copy is retained (not deleted) so a user who later leaves
the workspace, or whose workspace retires the remote row, still has
the original definition.

**Migration notes for pre-existing local agents:**

- Agents authored before spec 111 Phase 6 remain functional without
  any action. They carry `source = 'local'` and continue to appear in
  the desktop agent list exactly as before.
- `.claude/agents/*.md` project files are `source='local'` with
  sub-kind `file` (§2.4). Publishing these requires first importing
  them into the desktop catalog via the existing "Import Agent" flow,
  then running Publish to Workspace on the imported row.
- Agents that collide by slug with an already-published workspace
  agent will create a parallel draft (statecraft's
  `(workspace_id, name, version)` uniqueness permits multiple versions
  per name; `nextVersion` picks `max+1`). The workspace admin decides
  whether to publish the new version or retire it as a duplicate.
- `safety_tier` review is required before publication — the linter
  that runs on publish (§2.5) flags its absence, and the admin UI
  surfaces the flag as a red banner.
- Publishing does **not** export model API keys, keychain entries, or
  OAuth tokens. Per §3, those stay on the originating desktop.

**Unit coverage in `agent_catalog_publish::tests` (11 cases):**

- Slug handles spaces, mixed case, non-alphanumeric collapse, and
  edge inputs (digit-first, strip leading/trailing separators,
  empty/alnum-free rejection).
- Mapping populates Tier-1 fields (name, type, icon, model,
  display_name, description-from-first-line).
- Mutation derivation covers the four `(write, network)` quadrants;
  network-only clamps to read-only.
- `default_task` round-trips as an extra field; empty/`None` omits it.
- `hooks` round-trip when valid JSON object; non-JSON drops silently.
- Slug failure propagates up from `map_local_agent_to_payload`.
