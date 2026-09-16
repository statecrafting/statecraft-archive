---
id: "108-factory-as-platform-feature"
slug: factory-as-platform-feature
title: Factory as a First-Class Platform Feature
status: approved
implementation: complete
owner: bart
created: "2026-04-20"
approved: "2026-05-01"
amended: "2026-05-05"
amendment_record: "139-factory-artifact-substrate"
kind: platform
domain: platform
summary: >
  Removes the repo-rooted `factory/` directory and reimplements adapters,
  contracts, processes, and upstream-map configuration as first-class entities
  inside statecraft. Factory becomes a governed, organisationally-scoped
  feature surfaced at `/app/factory`; Factory runs continue to execute via OPC
  but are orchestrated by the platform. Supersedes spec 088 for the upstream
  sync flow.
depends_on:
  - "074-factory-ingestion"  # factory-ingestion
  - "075-factory-workflow-engine"  # factory-workflow-engine
  - "087-unified-workspace-architecture"  # workspace-as-atom
  - "088-factory-upstream-sync"  # factory-upstream-sync (superseded)
supersedes:
  - "088-factory-upstream-sync"
---

# 108 — Factory as a First-Class Platform Feature

> **Amended 2026-05-05 by spec [139](../139-factory-artifact-substrate/spec.md).**
> Spec 139 replaces this spec's bucket-blob translator (§3 data model
> and §5 sync flow) with a content-addressed substrate; the
> `factory_adapters` / `factory_contracts` / `factory_processes` tables
> become Phase-1 projections over `factory_artifacts` and are dropped in
> Phase 4. Spec 139 also closes this spec's §7.1 OPC-checkout punt and
> lifts §9's "editing manifests via the UI" non-goal (overrides land
> on the substrate). The external API surface (`/api/factory/{adapters,
> contracts,processes}`) stays byte-stable through Phases 1-3.

## 1. Problem Statement

The repo-rooted `factory/` directory is currently an in-tree artifact:
adapters, contracts, and processes live as files translated from two upstream
GitHub sources by a CLI (`/factory-sync`, spec 088). This works for a single
repo operator, but it is invisible to the platform: orgs cannot see what
adapters they have, cannot browse contracts, cannot inspect a process
definition without reading source, and cannot vary configuration per workspace
without touching the checkout.

Projects live in the platform (`projects` / `project_repos`) but the factory
that processes them lives outside it. That split forces every run through
local tooling, blocks multi-tenant operation, and leaves upstream-map.yaml
hand-edited in the repo instead of declared per-organisation.

## 2. Decision

Make Factory a first-class platform feature owned by statecraft:

1. **Delete `factory/`** from the repo (adapters, contract JSON schemas,
   process definitions, upstream-map.yaml, docs).
2. **Persist factory state in PostgreSQL** under four new tables:
   `factory_upstreams`, `factory_adapters`, `factory_contracts`,
   `factory_processes`.
3. **Expose Encore APIs** under `api/factory/` for CRUD and sync against the
   GitHub upstream sources.
4. **Surface the UI at `/app/factory`** as a top-level nav entry alongside
   Dashboard — no longer scoped under a specific project.
5. **Keep run execution in OPC** — OPC pulls adapter/contract/process
   definitions from the platform via a signed contract (see §7), runs the
   7-stage pipeline locally, and streams progress back via the same duplex
   channel that powers workspace sync (`api/sync/duplex.ts`).
6. **Supersede spec 088** — upstream-map is no longer a YAML file but a
   database-backed config owned by an organisation. The translation protocol
   itself (how to map `legacy-factory/*` onto adapters/contracts/
   processes) is retained — only the storage layer and trigger mechanism
   change.

Projects *consume* the Factory. The mental model: a project is the subject;
the Factory is the execution engine. An org has one Factory configuration
(one pair of upstream sources) that applies to all of its projects.

## 3. Data Model

Added to `platform/services/statecraft/api/db/schema.ts`:

```ts
// One row per org — the GitHub sources that generate this org's factory.
// Replaces upstream-map.yaml.
factory_upstreams (
  org_id           uuid pk  references organizations(id),
  factory_source   text not null,  // e.g. "statecrafting/legacy-factory"
  factory_ref      text not null default 'main',
  template_source  text not null,  // e.g. "statecrafting/template"
  template_ref     text not null default 'main',
  last_synced_at   timestamptz,
  last_sync_sha    jsonb,  // { factory: "abc…", template: "def…" }
  last_sync_status text,   // pending | running | ok | failed
  last_sync_error  text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
)

// Derived from the factory upstream. Not editable; replaced on sync.
factory_adapters (
  id          uuid pk default gen_random_uuid(),
  org_id      uuid not null references organizations(id),
  name        text not null,         // e.g. "acme-vue-node"
  version     text not null,         // upstream tag or sha
  manifest    jsonb not null,        // adapter manifest body
  source_sha  text not null,         // upstream commit sha
  synced_at   timestamptz not null default now(),
  unique (org_id, name)
)

factory_contracts (
  id          uuid pk default gen_random_uuid(),
  org_id      uuid not null references organizations(id),
  name        text not null,         // "build-spec" | "pipeline-state" | ...
  version     text not null,
  schema      jsonb not null,        // JSON schema body
  source_sha  text not null,
  synced_at   timestamptz not null default now(),
  unique (org_id, name, version)
)

factory_processes (
  id          uuid pk default gen_random_uuid(),
  org_id      uuid not null references organizations(id),
  name        text not null,         // e.g. "7-stage-build"
  version     text not null,
  definition  jsonb not null,        // process definition (stages, agents, gates)
  source_sha  text not null,
  synced_at   timestamptz not null default now(),
  unique (org_id, name, version)
)
```

All four tables are org-scoped. A workspace inherits its org's Factory
configuration; no workspace-local overrides in this phase. Future work may
add `factory_overrides` keyed on workspace_id.

## 4. Encore APIs

New service `api/factory/`:

| Method | Path | Purpose |
|--------|------|---------|
| GET    | `/api/factory/upstreams` | Get current org's upstream config (or `null`). |
| POST   | `/api/factory/upstreams` | Create/update upstream config. Idempotent. |
| POST   | `/api/factory/upstreams/sync` | Kick off a sync run against the configured sources. Returns `sync_run_id`. |
| GET    | `/api/factory/upstreams/sync/:id` | Poll sync status. |
| GET    | `/api/factory/adapters` | List org adapters. |
| GET    | `/api/factory/adapters/:name` | Adapter detail (manifest JSON). |
| GET    | `/api/factory/contracts` | List org contracts. |
| GET    | `/api/factory/contracts/:name` | Contract detail (schema JSON). |
| GET    | `/api/factory/processes` | List org processes. |
| GET    | `/api/factory/processes/:name` | Process detail. |

All endpoints require `requireUser`. Mutations require role ≥ `admin` on the
org. Read endpoints are org-scoped; a user who belongs to the org sees that
org's factory.

## 5. Sync Flow

`POST /api/factory/upstreams/sync` runs server-side:

1. Load `factory_upstreams` for the org. Error if unset.
2. Clone both sources shallowly (using the org's GitHub App installation).
3. Apply the translation protocol currently defined by spec 088 §5 — walk the
   upstream layout and build adapter manifests, contract schemas, and
   process definitions in memory.
4. Upsert into `factory_adapters`, `factory_contracts`, `factory_processes`
   in a single transaction. Prune rows for items no longer present upstream.
5. Stamp `last_synced_at`, `last_sync_sha`, `last_sync_status = 'ok'`.

Failures set `last_sync_status = 'failed'` with `last_sync_error`; prior rows
are retained so a broken upstream does not empty out an org's factory.

## 6. UI — `/app/factory`

Tabs: **Overview**, **Upstreams**, **Adapters**, **Contracts**, **Processes**.

- **Overview** — current upstream config, last sync time and status, counts
  per resource, "Sync now" action.
- **Upstreams** — form for factory source, factory ref, template source,
  template ref. Admin-only edit; all members can read.
- **Adapters / Contracts / Processes** — list views with detail drawers
  showing the JSON body, source sha, and synced_at timestamp. Read-only —
  edits happen upstream, land via sync.

Phase 1 (this PR) ships the route shell and an Overview placeholder pointing
at this spec. Phase 2 adds the DB schema and upstreams form. Phase 3 wires
the sync worker. Phase 4 adds adapter/contract/process browsers.

## 7. OPC Interface Contract

OPC no longer reads `factory/` from the checkout. Instead, when a user starts
a Factory run in OPC:

1. OPC authenticates against statecraft using the existing desktop OIDC
   flow (spec 106/107).
2. OPC calls `GET /api/factory/adapters/:name`, `.../contracts/*`,
   `.../processes/:name` for the user's active org.
3. OPC executes the 7-stage pipeline locally, using the platform-served
   definitions as the source of truth.
4. OPC streams run events back over `api/sync/duplex.ts` into a new
   `factory_runs` table — defined and shipped under **spec 124**.

This mirrors the existing workspace duplex pattern: OPC is the execution
tier, statecraft is the orchestration and persistence tier.

### 7.1 Punt — desktop factory-run migration

The platform-side surface (`/api/factory/adapters`, `.../contracts/*`,
`.../processes/:name`) ships with this spec. Migrating the OPC desktop's
existing local execution path (`product/apps/opc/src-tauri/src/commands/factory.rs`)
off the in-tree `factory/` checkout and onto the platform API is a separate
effort with material complexity (auth, caching, run-state, offline
behaviour) and is **tracked under spec 124 (`opc-factory-run-platform-integration`)**.
Until 124 ships, OPC factory runs require the developer to keep a local
checkout of the upstream factory repo on disk; see the
`// TODO(spec-108-§7-punt)` marker on `resolve_factory_root` for the entry
point.

The factory-engine and factory-contracts crates already accept a configurable
`factory_root`; they remain path-agnostic and need no source change for the
follow-up.

Spec 124 also closes the §7.4 `factory_runs` deferral below — the table,
duplex event handlers, and run-history UI all land there.

## 8. Removals

Deleted from the repo in Phase 2:

- `factory/adapters/**`
- `factory/contracts/**`
- `factory/process/**`
- `factory/upstream-map.yaml`
- `factory/docs/**` (migrated into `platform/services/statecraft/docs/factory/`)
- `.claude/commands/factory-sync.md` (replaced by UI action)

Spec 088 is marked `superseded` and its implementation references are
retained for history. The translation protocol in 088 §5 is lifted verbatim
into the sync worker.

## 9. Non-Goals

- Editing adapter manifests / contracts / processes via the UI.
- Workspace-level factory overrides.
- Multi-factory-per-org (one active configuration per org is sufficient).
- Retention/versioning of historical syncs beyond the latest sha per entity.

## 10. Open Questions

- Should the sync worker run inline in the Encore service or as a PubSub job?
  Inline is simpler; the pubsub job lets us retry transparently. Default to
  inline for Phase 3, revisit if syncs exceed 30s.
- How do we handle an org that has not yet installed the OAP GitHub App?
  Answer: surface the same "install the GitHub App" CTA already used by the
  project creation form.

## 11. Implementation Notes

The spec landed across multiple commits between 2026-04-20 and 2026-05-01.
Phases 1–4 were already shipped on `main` when this spec's lifecycle was
flipped; the closing work was the §8 deletion plus downstream cleanups.

Per-phase artefacts:

- **Phase 1 (route shell + Overview):**
  `platform/services/statecraft/web/app/routes/app.factory.tsx` (tab strip),
  `app.factory._index.tsx` (Overview with counts, last-sync banner, "Sync now"
  button, recent runs table). Top-level nav entry in `app.tsx:35`.

- **Phase 2 (DB schema + Upstreams form):**
  `platform/services/statecraft/api/db/schema.ts:751–815` declares
  `factoryUpstreams`, `factoryAdapters`, `factoryContracts`, `factoryProcesses`;
  migration `api/db/migrations/18_factory_platform_feature.up.sql`. The
  Upstreams UI lives at `app.factory.upstreams.tsx`; the Encore handlers in
  `api/factory/upstreams.ts` (`getUpstreams`, `upsertUpstreams`).

- **Phase 3 (sync worker, async via spec 109 §5):**
  `api/factory/sync.ts` enqueues on `FactorySyncRequestTopic`,
  `api/factory/syncWorker.ts` is the PubSub subscription that runs
  `runSyncPipeline` in `api/factory/syncPipeline.ts` (clone → translate →
  upsert with prune). `api/factory/translator.ts` lifts the spec 088 §5
  translation protocol into the worker. Run state lands in
  `factory_sync_runs`; the polling endpoint is `api/factory/syncRuns.ts`.

- **Phase 4 (browsers):**
  `api/factory/browse.ts` (list/get for adapters, contracts, processes) +
  `web/app/routes/app.factory.{adapters,contracts,processes}.tsx` rendering
  through the shared `web/app/components/factory-browser.tsx`. List + detail
  drawer; reads only.

- **Removals (§8):**
  Closed by commit `chore(repo): retire in-tree factory/ directory (spec 108
  §8)` (2026-05-01) which deleted 176 files under `factory/`, updated
  doc-comments in `agent-frontmatter` / `factory-contracts`, regenerated the
  TS mirror, marked the OPC desktop's `resolve_factory_root` with the §7.1
  punt TODO, cleared spec 081's now-defunct `implements:` block, and added
  this spec's `implementation-audit.md`.

- **OAP-owned contract schemas relocation (2026-05-05 follow-up):**
  The §8 deletion removed `factory/contract/schemas/` along with the rest of
  the in-tree `factory/` tree, but `api/factory/oapContracts.ts` —
  introduced because upstream-map v2 sources do not carry `*.schema.*` files
  in main — still walked up looking for that path, returned an empty list on
  every sync, and left `/app/factory/contracts` reporting "No contracts yet".
  Resolved by relocating the nine OAP-owned schemas (now at
  `standards/schemas/factory/`; four top-level + five under
  `stage-outputs/`) and repointing the loader's walk-up target. The
  `OAP_FACTORY_SCHEMAS_DIR` override path is preserved for production
  containers that bind-mount the schemas elsewhere.

OPC desktop migration (§7.1 punt) and the `factory_runs` persistence
(§7.4) are tracked under **spec 124** (`opc-factory-run-platform-integration`).
That spec migrates `product/apps/opc/src-tauri/src/commands/factory.rs` to
fetch adapter / contract / process bodies from the API endpoints shipped
here, and adds the `factory_runs` table + duplex event handlers + Runs
UI.

The `make ci-schema-parity` gate is currently broken on `main` due to
the unrelated zod removal in commit `b6859d3`; that's tracked separately
under **spec 125** (`schema-parity-walker-rebuild`) and is not a
spec-108 regression.
