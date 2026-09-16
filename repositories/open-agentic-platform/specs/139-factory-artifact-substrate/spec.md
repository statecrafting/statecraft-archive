---
id: "139-factory-artifact-substrate"
slug: factory-artifact-substrate
title: "Factory artifact substrate — verbatim mirror, per-org override, unified Agent/Skill/Adapter/Contract storage"
status: approved
implementation: complete
owner: bart
created: "2026-05-05"
closed: "2026-05-05"
amended: "2026-06-09"
amendment_record: "199-factory-thin-consumer-sync"
kind: architecture
domain: platform
risk: high
amends: ["108-factory-as-platform-feature", "111-org-agent-catalog-sync", "123-agent-catalog-org-rescope"]
depends_on:
  - "082-artifact-integrity-platform-hardening"  # artifact-integrity-platform-hardening (owns existing `factory_artifacts` SQL table; substrate uses `factory_artifact_substrate` to avoid collision)
  - "094-unified-artifact-store"  # unified-artifact-store (extended spec 082's table with project/producer columns; orthogonal to substrate)
  - "108-factory-as-platform-feature"  # factory-as-platform-feature (replaces §3 data model + §9 non-goals)
  - "111-org-agent-catalog-sync"  # org-agent-catalog-sync (generalises agent_catalog into the substrate)
  - "112-factory-project-lifecycle"  # factory-project-lifecycle (Create/Import flow consumes the substrate)
  - "123-agent-catalog-org-rescope"  # agent-catalog-org-rescope (binding mechanism becomes universal)
  - "124-opc-factory-run-platform-integration"  # opc-factory-run-platform-integration (closes spec 108 §7.1 punt)
code_aliases: ["FACTORY_ARTIFACT_SUBSTRATE"]
establishes:
  - unit: { kind: file, path: platform/services/statecraft/api/factory/substrate.ts }
  - unit: { kind: file, path: crates/factory-engine/src/substrate_version.rs }
  - unit: { kind: file, path: platform/services/statecraft/api/factory/agentCatalogMigration.ts }
  - unit: { kind: file, path: platform/services/statecraft/api/factory/oapContracts.ts }
  - unit: { kind: file, path: crates/factory-engine/src/factory_root.rs }
  - unit: { kind: file, path: crates/factory-engine/src/virtual_root.rs }
  - unit: { kind: file, path: platform/services/statecraft/api/factory/substrateBrowser.ts }
  - unit: { kind: file, path: platform/services/statecraft/api/factory/runAgentRefs.ts }
extends:
  - spec: "108-factory-as-platform-feature"
    nature: wrapping
    unit: { kind: file, path: platform/services/statecraft/api/factory/translator.ts }
  - spec: "108-factory-as-platform-feature"
    nature: wrapping
    unit: { kind: file, path: platform/services/statecraft/api/factory/syncPipeline.ts }
  - spec: "108-factory-as-platform-feature"
    nature: wrapping
    unit: { kind: file, path: platform/services/statecraft/api/factory/syncWorker.ts }
  - spec: "108-factory-as-platform-feature"
    nature: wrapping
    unit: { kind: file, path: platform/services/statecraft/api/factory/artifacts.ts }
  - spec: "108-factory-as-platform-feature"
    nature: wrapping
    unit: { kind: file, path: platform/services/statecraft/api/factory/conflicts.ts }
  - spec: "108-factory-as-platform-feature"
    nature: wrapping
    unit: { kind: file, path: platform/services/statecraft/api/factory/bindings.ts }
  - spec: "108-factory-as-platform-feature"
    nature: wrapping
    unit: { kind: file, path: platform/services/statecraft/api/factory/upstreams.ts }
  - spec: "108-factory-as-platform-feature"
    nature: wrapping
    unit: { kind: file, path: platform/services/statecraft/web/app/routes/app.factory.artifacts.tsx }
  - spec: "108-factory-as-platform-feature"
    nature: wrapping
    unit: { kind: file, path: platform/services/statecraft/web/app/components/artifact-merge-editor.tsx }
  - spec: "108-factory-as-platform-feature"
    nature: wrapping
    unit: { kind: file, path: platform/services/statecraft/api/factory/browse.ts }
  - spec: "111-org-agent-catalog-sync"
    nature: wrapping
    unit: { kind: file, path: platform/services/statecraft/api/agents/catalog.ts }
  - spec: "111-org-agent-catalog-sync"
    nature: wrapping
    unit: { kind: file, path: platform/services/statecraft/api/agents/relay.ts }
  - spec: "111-org-agent-catalog-sync"
    nature: wrapping
    unit: { kind: file, path: platform/services/statecraft/api/sync/service.ts }
  - spec: "123-agent-catalog-org-rescope"
    nature: wrapping
    unit: { kind: file, path: platform/services/statecraft/api/agents/bindings.ts }
refines:
  - aspect: "factory-engine-substrate"
    unit: { kind: file, path: crates/factory-engine/src/engine.rs }
  - aspect: "factory-engine-substrate"
    unit: { kind: file, path: product/apps/opc/src-tauri/src/commands/factory.rs }
  - aspect: "factory-engine-substrate"
    unit: { kind: file, path: platform/services/statecraft/api/projects/opcBundle.ts }
  - aspect: "factory-engine-substrate"
    unit: { kind: file, path: platform/services/statecraft/api/projects/create.ts }
  - aspect: "factory-engine-substrate"
    unit: { kind: file, path: platform/services/statecraft/api/projects/import.ts }
  - aspect: "factory-engine-substrate"
    unit: { kind: file, path: platform/services/statecraft/api/projects/scaffoldReadiness.ts }
  - aspect: "factory-engine-substrate"
    unit: { kind: file, path: platform/services/statecraft/api/db/schema.ts }
references:
  # Spec 199 amendment (2026-06-09): the thin-consumer cutover deleted the
  # ingest sanitiser and the categorical projection these claims owned.
  # Historical pointers retained, non-owning.
  - role: historical
    unit: { kind: file, path: platform/services/statecraft/api/factory/oapNativeIngest.ts }
  - role: historical
    unit: { kind: file, path: platform/services/statecraft/api/factory/oapNativeSanitise.ts }
  - role: historical
    unit: { kind: file, path: platform/services/statecraft/api/factory/projection.ts }
summary: >
  Replace the spec 108 bucket-blob translator with a content-addressed
  substrate (`factory_artifact_substrate`) that mirrors upstream Factory and
  Template repos verbatim, allows per-org override of any file, and
  generalises spec 111's `agent_catalog` into the same row shape so
  Adapters, Contracts, Processes, Agents, and Skills become facets over a
  single store. Symmetrises upstream sourcing across all four adapters
  (resolves the `next-prisma`/`rust-axum`/`encore-react` "no upstream
  scaffold" gap) and closes spec 108 §7.1 (OPC factory_root checkout
  punt) by exposing every artifact at a stable `(origin, path,
  content_hash)` triple.
---

# 139 — Factory Artifact Substrate

> **Amended 2026-06-09 by spec [199](../199-factory-thin-consumer-sync/spec.md).**
> The thin-consumer cutover deleted `oapNativeIngest.ts`,
> `oapNativeSanitise.ts`, and `projection.ts` (the read-time categorical
> translation this spec kept for compat after Phase 4). Their owning
> claims here move to non-owning `references: role: historical`; the
> substrate mirror itself — this spec's core — is unchanged.

> **Amended 2026-05-06 by spec [140](../140-acme-vue-node-scaffold-source-id-cutover/spec.md).**
> §7.2's `template_remote` → `scaffold_source_id` rename landed for the
> three OAP-native adapters in Phase 2 but never reached the synthetic
> `acme-vue-node` adapter that `projection.ts::buildAdapter` emits. Spec
> 140 finishes the rename and drops the legacy fallback in
> `scaffoldReadiness.ts`.

## 1. Problem Statement

Spec 108 ("Factory as a first-class platform feature") replaced the
in-tree `factory/` directory with four org-scoped tables —
`factory_upstreams`, `factory_adapters`, `factory_contracts`,
`factory_processes`. The translation worker (`api/factory/translator.ts`,
~707 LOC) walks the upstream `Factory Agent/` and `template/` trees and
projects them into JSONB blobs keyed by synthetic categories
(`controllers`, `client_interface`, `requirements.{system,service,client}`,
`database`, `other`, `references`, `stages[]`, `orchestrator`).

Six structural problems with this approach surfaced as adjacent specs
landed:

1. **Fidelity loss.** The translator drops file identity. A skill's
   YAML frontmatter `id` (the upstream's documented dispatch key per
   `factory-orchestration.md` "skills resolve by frontmatter `id`, not
   by path") survives, but the path/source/sha trail does not. HTML
   sample files under `Factory Agent/Client_Interface/page-types/*/samples/`
   are dropped on the floor by the regex classification entirely.
2. **No per-row addressing.** A file's content is an array element
   inside a JSONB column. There is no stable identifier to pin against.
   Spec 124 added `factory_runs.stage_progress[].agent_ref =
   { org_agent_id, version, content_hash }` for user-authored agents
   from `agent_catalog` — but the same audit primitive cannot apply to
   upstream-mirrored skills, because they have no row identity.
3. **Read-only by design.** Spec 108 §9 declared "editing manifests /
   contracts / processes via the UI" a non-goal. Sync prunes rows
   missing upstream. Orgs cannot diverge from upstream without forking
   the upstream repo.
4. **OAP-native adapters are vapor on the scaffold side.** Of the four
   adapters in `factory/adapters/` (`acme-vue-node`, `next-prisma`,
   `rust-axum`, `encore-react`), only `acme-vue-node` has a real upstream
   scaffold tree (the `template` repo cloned at create-time by
   `templateCache.ts`). The other three ship a `scaffold/README.md`
   placeholder and nothing else. Spec 112 §5.4's runtime gate
   (`scaffold.runtime != node-24` → reject) silently masks this — a
   user picking `next-prisma` cannot actually create a project.
5. **Two parallel agent inventories.** `agent_catalog` (spec 111,
   rescoped per spec 123) holds versioned, content-hashed,
   per-org-bindable user-authored agents. `factory_processes.definition.
   agents.{requirements.system,…}` holds upstream-mirrored skill bodies
   as anonymous JSONB array entries. Same conceptual artifact, two
   incompatible storage models, two pinning stories, two audit shapes.
6. **OPC checkout dependency persists.** Spec 108 §7.1 explicitly
   punted migrating `product/apps/opc/src-tauri/src/commands/factory.rs`
   off the local `factory/` checkout because the platform-served bucket
   blob can't be addressed by path the way a checkout can. Spec 124
   was supposed to close this; the `// TODO(spec-108-§7-punt)` marker
   on `resolve_factory_root` remains.

The common root cause: spec 108 chose a categorical projection of
upstream content instead of mirroring it. The shape we projected
into is tightly coupled to the GoA upstream's specific layout and
inhibits override, audit, OPC parity, and cross-adapter symmetry.

## 2. Decision

Replace the `factory_adapters` / `factory_contracts` / `factory_processes`
storage with a single content-addressed substrate, generalise
`agent_catalog` into it, and expose Adapters / Contracts / Processes /
Agents / Skills as **kind-filtered views** over the substrate. Mirror
upstream sources verbatim, with per-org override.

The current tables are not deleted in Phase 1 — the substrate is
introduced as the new authoritative store and the existing tables
become projections (or are migrated and the existing tables retired in
Phase 4). This preserves the live spec 108 API surface during the
transition.

### 2.1 Substrate

> **Naming note (Phase 1 implementation discovery, 2026-05-05):** the
> table is `factory_artifact_substrate`, not the cleaner
> `factory_artifacts`, because the latter name is already taken by
> spec 082's per-pipeline-run artifact registry (created in migration
> 8, extended by spec 094 Slice 5 with project/producer columns,
> consumed by `api/projects/projects.ts`, `api/admin/storage.ts`, the
> `factory.rs` Tauri command, and others). The spec 082 table tracks
> per-run produced artifacts (pipeline_id, stage_id, content_hash,
> storage_path) — orthogonal to the substrate's role
> (org-scoped, content-addressed, override-aware sync of upstream
> content). Renaming spec 082's table to free up `factory_artifacts`
> would have a much larger blast radius (≥ 4 consumer call sites,
> Rust crate references, prod data) and would itself require a
> dedicated rename spec — out of scope here.

```sql
factory_artifact_substrate (
  id              uuid pk default gen_random_uuid(),
  org_id          uuid not null references organizations(id),

  origin          text not null,        -- see §4 origin taxonomy
  path            text not null,        -- repo-relative POSIX path, verbatim
  kind            text not null,        -- see §4 kind taxonomy
  bundle_id       uuid,                 -- optional grouping; see §4.3

  version         integer not null default 1,
  status          text not null default 'active',  -- 'active' | 'retired'

  -- Bodies ----------------------------------------------------------
  upstream_sha    text,                 -- commit sha at last sync; null when origin='user-authored' or origin='oap-self'
  upstream_body   text,                 -- last-synced upstream content; null when origin='user-authored'
  user_body       text,                 -- per-org override; null when no override
  user_modified_at timestamptz,
  user_modified_by uuid,

  -- Effective resolution -------------------------------------------
  effective_body  text generated always as (coalesce(user_body, upstream_body)) stored,
  content_hash    text not null,        -- sha256 of effective_body
  frontmatter     jsonb,                -- parsed YAML frontmatter when applicable; null for non-md kinds

  -- Conflict state -------------------------------------------------
  conflict_state  text,                 -- null | 'ok' | 'diverged'
  conflict_upstream_sha text,           -- upstream_sha at the moment user override was authored
  conflict_resolved_at timestamptz,
  conflict_resolved_by uuid,

  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  unique (org_id, origin, path, version)
)

factory_artifact_substrate_audit (
  id           uuid pk default gen_random_uuid(),
  artifact_id  uuid not null,
  org_id       uuid not null,
  action       text not null,           -- see §6.4
  actor_user_id uuid,                   -- null for sync-worker actions
  before       jsonb,
  after        jsonb,
  created_at   timestamptz not null default now()
)

factory_bindings (
  id                   uuid pk default gen_random_uuid(),
  project_id           uuid not null references projects(id),
  artifact_id          uuid not null references factory_artifact_substrate(id),
  pinned_version       integer not null,
  pinned_content_hash  text not null,
  bound_by             uuid not null,
  bound_at             timestamptz not null default now(),
  unique (project_id, artifact_id)
)
```

`factory_bindings` generalises `project_agent_bindings` (spec 123). The
binding shape is identical: pin by `(version, content_hash)`,
no definition override on the binding row, retired-upstream stays
readable but cannot be repinned (spec 123 invariants I-B1..I-B4 carry
over verbatim, applied to **any** kind).

### 2.2 Upstreams

`factory_upstreams` is generalised away from the two-fixed-column
("`factory_source` + `template_source`") shape into N per-source rows:

```sql
factory_upstreams (
  org_id        uuid not null references organizations(id),
  source_id     text not null,          -- see §3.1 — stable per-org identifier for this upstream
  repo_url      text not null,          -- 'statecrafting/legacy-factory'
  ref           text not null default 'main',
  subpath       text,                   -- optional: 'Factory Agent/' | 'orchestration/' | null for whole repo
  role          text not null,          -- 'orchestration' | 'scaffold' | 'mixed' | 'oap-self'
  primary key (org_id, source_id)
)
```

Adapter manifests declare which `source_id`s they consume:

```yaml
# in a factory_artifact_substrate row of kind='adapter-manifest'
name: acme-vue-node
orchestration_source_id: legacy-factory
scaffold_source_id: acme-vue-node-template
```

For OAP-native adapters, the same shape applies — `orchestration_source_id`
and `scaffold_source_id` may point at separate repos owned by the OAP
org, OR at sub-paths of this monorepo (role = `oap-self`, repo_url =
`<this-repo>`, subpath = `apps/scaffolds/next-prisma/` or similar).
The sync engine treats both transparently.

## 3. Scope

### 3.1 In Scope

- New tables: `factory_artifact_substrate`, `factory_artifact_substrate_audit`,
  `factory_bindings`. Migration of `agent_catalog`,
  `agent_catalog_audit`, `project_agent_bindings`, `factory_adapters`,
  `factory_contracts`, `factory_processes` into the substrate.
- Generalisation of `factory_upstreams` to N-per-org with role/subpath.
- Verbatim sync (replace categorical translation with file-by-file
  mirror; preserve frontmatter, body, sha, path).
- Per-org override of any artifact body, with three-way merge against
  upstream changes and a `conflict_state` machine.
- Symmetric scaffold/orchestration sourcing for all four adapters
  (`acme-vue-node`, `next-prisma`, `rust-axum`, `encore-react`); seed
  three new OAP-controlled upstream sources for the formerly-vapor
  three.
- Kind-filtered API endpoints (`/api/factory/artifacts?kind=…`) and a
  path-addressed read endpoint (`/api/factory/artifacts/by-path?…`).
- OPC contract: `factory_root` becomes a virtual root resolved against
  the platform API by `(origin, path)` — closes spec 108 §7.1.
- Per-skill tier ceiling derived from frontmatter at sync time; carried
  through to axiomregent at dispatch.
- Universal binding pinning: any project run can declare it was
  executed against `(adapter@hash, skill1@hash, skill2@hash, …)` and
  reproduce the exact prompts on replay.

### 3.2 Non-Goals

- **Mirroring the `template` scaffold tree (`apps/`, `product/packages/`,
  `modules/`, `scripts/`) into the substrate.** The scaffold remains
  clone-and-discard at create-time. Only the `orchestration/` subpath
  is mirrored. The same rule applies to OAP-native scaffolds.
- **A user-authored adapter UI in this spec.** Editing existing
  upstream-mirrored adapter agents/patterns is in scope; authoring an
  adapter from scratch via the UI is a follow-up.
- **Cross-org sharing of artifacts.** All rows remain org-scoped.
  Sharing is a future spec.
- **Backfilling pinning for runs that pre-date the substrate.** Runs
  recorded under the bucket-blob model carry their own JSONB-frozen
  audit; they remain readable but are not retroactively re-bound.
- **Editing the substrate from OPC.** OPC is a read consumer in this
  spec. Editing happens on statecraft (`/app/factory/...`).

## 4. Origin / Kind / Bundle Taxonomy

### 4.1 Origin

A stable string keyed against `factory_upstreams.source_id`. Each org
has its own set:

| Origin example          | Source                                    | Editable per-org? |
|-------------------------|-------------------------------------------|-------------------|
| `legacy-factory`  | upstream Factory repo                     | yes (override)    |
| `acme-vue-node-template` | upstream Template repo (orchestration only) | yes (override)  |
| `oap-next-prisma`       | OAP-controlled upstream (orchestration)   | yes (override)    |
| `oap-next-prisma-scaffold` | OAP-controlled upstream (scaffold zip)  | yes (override)    |
| `oap-rust-axum`         | OAP-controlled upstream                   | yes               |
| `oap-encore-react`      | OAP-controlled upstream                   | yes               |
| `oap-self`              | sub-path of `<this-repo>` (bootstrap path) | yes               |
| `user-authored`         | created in statecraft UI                  | yes (always)      |

`user-authored` is the new home for spec 111's existing `agent_catalog`
content. Migration is mechanical: `(org_id, name, version)` → `(org_id,
'user-authored', 'user-authored/' || name || '.md', version)`. Existing
content_hash, frontmatter, body, audit history all carry over.

### 4.2 Kind

| Kind                  | Path predicate (illustrative)                          | Notes |
|-----------------------|--------------------------------------------------------|-------|
| `agent`               | frontmatter `type: agent` or `parent: none/null`       | top-level orchestrating skill |
| `skill`               | frontmatter `parent: <agent-id>`                       | sub-skill dispatched by an agent |
| `process-stage`       | path matches `process/stages/*.md` or `Factory Agent/Orchestrator/factory-orchestration-(s\d+\|cd\|tm\|xf).md` | factory pipeline stage |
| `adapter-manifest`    | path = `adapters/<name>/manifest.yaml`                 | per-adapter declaration |
| `contract-schema`     | path matches `*.schema.{json,yaml,yml}`                | machine contract |
| `pattern`             | path matches `adapters/<name>/patterns/**`             | code-gen pattern |
| `page-type-reference` | path matches `**/page-types/{authenticated,public}/page-type-*.md` (frontmatter `type: reference`, no `parent:`) | spec-side counterpart of `sample-html`; consumed by `ci-design-system` |
| `sample-html`         | path matches `**/samples/*.html`                       | structural reference for assembly |
| `reference-data`      | `Factory Agent/Requirements/{System,Service}/**.json`, sitemap-template `*.json`, frontmatter-less reference markdown (e.g. `digest.md`) | not a schema, not an example; load-bearing structured/derived data |
| `invariant`           | path matches `adapters/<name>/validation/invariants.yaml` | adapter-owned validation rules |
| `pipeline-orchestrator` | top-level `factory-orchestration.md`                 | unique per process source |

Kind is computed at sync time from path + frontmatter, stored on the
row, and re-computed on every sync. Misclassification is a sync-worker
bug fix, not a data fix.

**Precedence rule.** Path-based predicates win over frontmatter-based
predicates when both apply. Concretely: `Factory Agent/Orchestrator/
factory-orchestration-*.md` files declare `parent: factory-orchestrator`
in frontmatter (which would match `skill`) but match the
`process-stage` path predicate first — so they classify as
`process-stage`. The sync worker evaluates predicates in the table's
listed order; first match wins.

**Sync exclusions (preserved from spec 088 §5 / spec 108 translator).**
The substrate does **not** ingest `Factory Agent/Orchestrator/scripts/`
(Python runtime scripts and binary deck assets — org-specific distribution
tooling, not part of the generalisable factory contract surface). The
substrate's text-only body columns (§2.1) are sufficient because
binary content is out of sync scope. If a future spec needs to sync
binary assets, that spec adds `bytea` columns alongside the existing
text columns rather than back-fitting the substrate.

### 4.3 Bundle

Some upstream artifacts are tightly coupled and meaningless in
isolation. `bundle_id` (uuid) groups rows that must be synced together
and presented together. Bundles are a sync-time concern: the worker
derives them from path conventions (locked below), the consumer APIs
surface them as a unit.

**Bundle inventory (locked at Phase 0 from upstream walk):** 11
deterministic path predicates, mutually exclusive in the current
corpus. Sync worker assigns one `bundle_id` per match.

| Bundle name | Path predicate | Coupling rationale |
|---|---|---|
| `service-catalog` | `Requirements/System/service-catalog.json` ∪ `Requirements/System/service-specs/*.openapi.json` | Catalog references slug → 1:1 OpenAPI mapping |
| `fetch-meta` | `Requirements/System/service-specs/{_fetch-summary.json, digest.md}` | Both derived from same OpenAPI scrape run |
| `stage-2-pipeline` | `Requirements/Service/{service-requirements-orchestrator,service-description,audience-identification,audience-journey-map,future-state,sitemap}.md` | Phase A→B→C dependency chain |
| `sitemap-templates` | `Requirements/Service/sitemap-template-*.json` | All consumed together by `svc-sitemap` |
| `factory-stage-s2` | `Orchestrator/factory-orchestration-s2.md` ∪ `stage-2-pipeline` members | Stage envelope + execution body |
| `client-doc-stage` | `Orchestrator/factory-orchestration-cd.md` ∪ `Requirements/Client/{client-document,project-charter,html-report-assembler,document-formatting}.md` | `cd` orchestrates two parallel branches |
| `page-type-authenticated` | `Client_Interface/page-types/authenticated/page-type-*.md` ∪ `…/samples/*.html` | Each `.md` is the spec for the same-named HTML |
| `page-type-public` | `Client_Interface/page-types/public/page-type-*.md` ∪ `…/samples/*.html` | Same rationale, `public` viewType |
| `ci-agent` | `Client_Interface/{client-interface-orchestration,content-specification,design-system}.md` | `ci-orchestrator` references both sub-agents |
| `api-agent` | `Controllers/api-{orchestrator,builder,reviewer,security,rest-standards,web-standards}.md` | `api-orchestrator` references all sub-agents |
| `template-orchestrator` | `orchestration/template-orchestrator.md` ∪ `orchestration/skills/*.md` | Entire Repo B; orchestrator references all skills |

**Sample-HTML orphans.** Three samples (`settings-hub.html`,
`accessibility-page.html`, `privacy-page.html`) lack a parent
`page-type-*.md`. Sync worker emits a `parentless-sample-html` warning
(not error) and the row enters the substrate with `bundle_id = NULL`.
The conflict UI surfaces these for manual binding.

**Multi-sample bundles.** A page-type can have multiple HTML samples
(e.g. `form-step-1.html` + `form-step-2.html` both under
`ci-page-public-form-step`). The bundle predicate naturally handles
this — N samples per parent skill within one bundle.

## 5. Sync Flow (replaces spec 108 §5)

`POST /api/factory/upstreams/:source_id/sync`:

1. Resolve `factory_upstreams(org_id, source_id)`. Error if unset.
2. Clone the configured `repo_url@ref` shallowly into a temp directory,
   scoped to `subpath` if set.
3. **Walk the tree verbatim.** For every file, compute `content_hash =
   sha256(body)`. Match it against the existing
   `factory_artifact_substrate(org_id, origin=source_id, path)` row (if any).
4. **Per-row decision:**
   - **No existing row:** insert with `upstream_sha`, `upstream_body`,
     `content_hash`, `kind` (computed), `frontmatter` (parsed when
     applicable). `user_body = NULL`. `conflict_state = 'ok'`.
   - **Existing row, no user override (`user_body IS NULL`):**
     fast-forward — overwrite `upstream_sha`, `upstream_body`. Bump
     `version` only if `content_hash` changed (so historical bindings
     remain valid). `conflict_state = 'ok'`.
   - **Existing row, user override present, upstream content
     unchanged:** no-op.
   - **Existing row, user override present, upstream content changed
     since `conflict_upstream_sha`:** mark `conflict_state =
     'diverged'`. Update `upstream_sha`, `upstream_body`. Do not
     touch `user_body`. Surface in the UI for resolution.
5. **Prune.** Files present in the previous sync but absent from this
   one are marked `status = 'retired'`. `user_body` is preserved
   (the user's override survives upstream removal) but no new bindings
   can be created against retired rows.
6. Stamp `last_synced_at`, `last_sync_sha`, `last_sync_status='ok'`.

A failed sync (clone error, parse error) sets
`last_sync_status='failed'` and leaves all rows untouched. **No
partial writes** — the entire `walk + diff + apply` runs inside one
`db.transaction(...)`.

### 5.1 Conflict resolution UI

`/app/factory/artifacts?conflict=diverged` lists rows with
`conflict_state='diverged'`. Resolution actions per-row:

- **Keep mine** — clear `conflict_state`, set
  `conflict_resolved_at/by`. `user_body` becomes the new effective.
- **Take upstream** — set `user_body = NULL`,
  `conflict_state = 'ok'`. Override is dropped.
- **Edit and accept** — open editor pre-populated with a 3-way
  diff view. Save writes a new `user_body` and clears
  `conflict_state`.

Each resolution writes a `factory_artifact_substrate_audit` row with
`action = 'artifact.conflict_resolved'`, before/after the
effective body and the `conflict_*` columns.

## 6. Override and Resolution Semantics

### 6.1 Effective body

`effective_body = COALESCE(user_body, upstream_body)`. Computed as a
generated stored column so consumers select one canonical field.

### 6.2 Frontmatter `id` resolution (cross-origin)

Multiple artifacts can share a frontmatter `id` across origins (a user
override of `business-requirements` exists alongside the
upstream-mirrored one). Dispatch resolution is **scoped to a process**:
the process declares its `(origin, path)` ordering, and skills are
resolved within that origin first, falling back to other origins only
if the process explicitly opts in. Default behaviour: process-local
resolution, no cross-origin fallback.

A process originating from `legacy-factory` resolves
`business-requirements` against rows where
`origin='legacy-factory'`. A user-authored process that lists
`business-requirements` resolves against `origin='user-authored'`
first, then declines if not found — it does **not** silently fall
through to `legacy-factory`. This prevents accidental
override-by-collision.

### 6.3 Per-skill tier ceiling

Frontmatter declares (where applicable):

```yaml
tier: 2                          # axiomregent tier ceiling
tools_required: [Read, Edit]     # tools the skill needs
tools_optional: [WebFetch]       # tools the skill may use
```

At sync time, the worker computes `max_tier = MAX(tier_for(t) for t in
tools_required ∪ tools_optional)` if `tier` is unset, otherwise honours
the declared `tier`. axiomregent reads `max_tier` at dispatch and
enforces it as the ceiling for the dispatched Claude session
regardless of the parent agent's tier.

### 6.4 Audit actions

`factory_artifact_substrate_audit.action` values:

| Action | When |
|---|---|
| `artifact.synced` | Sync worker created or fast-forwarded a row |
| `artifact.retired` | Sync worker pruned a row (upstream removal) |
| `artifact.overridden` | User saved a `user_body` |
| `artifact.override_cleared` | User dropped their override |
| `artifact.conflict_detected` | Sync surfaced a divergence |
| `artifact.conflict_resolved` | User picked keep-mine / take-upstream / edit-and-accept |
| `artifact.forked` | User copied an existing artifact as the seed for a derivative (carries over from spec 111 `agent_catalog_audit.action='fork'`; mapped 1:1 by Phase 2 T051) |

`factory_bindings` mutations land in the global `audit_log` under
`action = factory.binding_{created,repinned,unbound}` (mirrors spec 123
naming, generalised away from `agent.*`).

## 7. Symmetric Upstream Sourcing for OAP-Native Adapters

The current `next-prisma`, `rust-axum`, `encore-react` adapters cannot
scaffold a buildable project (§1 problem 4). This spec resolves the
asymmetry by giving each adapter a real **scaffold source** alongside
its orchestration files.

### 7.1 Sourcing options per adapter

| Adapter | Orchestration source | Scaffold source |
|---|---|---|
| `acme-vue-node` | `legacy-factory` (subpath `Factory Agent/`) | `acme-vue-node-template` (subpath `orchestration/` mirrored, scaffold tree clone-at-create) |
| `next-prisma` | `oap-next-prisma` (or `oap-self` subpath) | `oap-next-prisma-scaffold` (or `oap-self` subpath) |
| `rust-axum` | `oap-rust-axum` (or `oap-self` subpath) | `oap-rust-axum-scaffold` (or `oap-self` subpath) |
| `encore-react` | `oap-encore-react` (or `oap-self` subpath) | `oap-encore-react-scaffold` (or `oap-self` subpath) |

For bootstrap, all OAP-native sources may use `origin='oap-self'`
pointing at sub-paths of this monorepo. As an adapter matures, the
sub-path is extracted into a separate repo and the org's
`factory_upstreams` row is updated — no consumer change required.

### 7.2 Adapter manifest changes

The adapter manifest's `template_remote` field (today only set for
`acme-vue-node`) is replaced by:

```yaml
orchestration_source_id: oap-next-prisma     # required
scaffold_source_id: oap-next-prisma-scaffold # required for Create-eligibility
scaffold_runtime: node-24                    # carries forward (spec 112 §10)
```

`scaffoldReadiness.ts` (spec 112 Phase 5) is extended: an adapter is
Create-eligible iff its declared `scaffold_source_id` resolves to a
row in the org's `factory_upstreams` AND the corresponding scaffold
runtime is supported. Today's silent rejection (spec 112 §5.4) becomes
an explicit blocker the UI can surface.

### 7.3 Lifting the existing OAP-native adapter content

Today's `factory/adapters/{next-prisma,rust-axum,encore-react}/**` is
the seed for the new substrate (per the user's correction in the
analysis preceding this spec, the on-disk location is irrelevant —
what matters is that this content gets re-homed). Phase 2 of this spec
ingests that content into `factory_artifact_substrate` rows under
`origin='oap-self'`, `path='adapters/<name>/<rel>'`, and the source
is wired into `factory_upstreams` per org.

## 8. OPC Contract (closes spec 108 §7.1)

OPC's `product/apps/opc/src-tauri/src/commands/factory.rs::resolve_factory_root()`
is replaced by a **virtual factory_root** backed by the platform API.

The `factory-engine` and `factory-contracts` crates already accept a
configurable `factory_root: PathBuf | VirtualRoot`. The `VirtualRoot`
implementation:

1. On open, fetches a manifest:
   `GET /api/factory/artifacts?fields=path,origin,version,content_hash`.
2. On `read_to_string(path)`, fetches:
   `GET /api/factory/artifacts/by-path?path=<…>&origin=<…>` returning
   `effective_body`. Caches by `(origin, path, content_hash)` in
   memory and on disk under `~/.cache/oap/factory/<org>/<hash>`.
3. On `set_pin(project_id, paths[])`, posts to
   `POST /api/factory/bindings` with each `(artifact_id, version,
   content_hash)`. The platform inserts `factory_bindings` rows and
   returns the resolved set.

This means **OPC factory runs are reproducible**: the run records
each dispatched skill's content_hash; replaying the run resolves
each hash against the (versioned, immutable) `factory_artifact_substrate`
row, producing byte-identical prompts even after upstream has
moved on.

The `// TODO(spec-108-§7-punt)` marker on `resolve_factory_root` is
deleted in Phase 3.

## 9. Migration Path

The existing live tables are not deleted in Phase 1.

### Phase 1 — Substrate online, dual-write

- New migration creates `factory_artifact_substrate`,
  `factory_artifact_substrate_audit`, `factory_bindings`. New
  `factory_upstreams` columns (`source_id`, `subpath`, `role`); existing
  `factory_source` / `template_source` retained as legacy.
- Sync worker rewritten to populate `factory_artifact_substrate` verbatim.
  Existing categorical projection writes to the old tables continue,
  driven by a view-builder that reads `factory_artifact_substrate` and emits
  the `definition` / `manifest` / `schema` JSONB shapes.
- Existing API endpoints (`/api/factory/{adapters,contracts,
  processes}`) unchanged in shape; backed by the projection.
- New endpoints `/api/factory/artifacts/*` ship.

### Phase 2 — Migrate `agent_catalog` and OAP-native adapters

- Backfill: every `agent_catalog` row → `factory_artifact_substrate` with
  `origin='user-authored'`, `kind='agent'`. Audit history copies into
  `factory_artifact_substrate_audit` with `action='artifact.synced'` for the
  initial create and the existing `agent_catalog_audit` mapped per row.
- `project_agent_bindings` rows → `factory_bindings` (verbatim columns;
  `org_agent_id` becomes `artifact_id`).
- Existing `factory/adapters/{next-prisma,rust-axum,encore-react}/**`
  ingested as `origin='oap-self'`, paths preserved.

### Phase 3 — OPC virtual factory_root

- Implement `VirtualRoot` in `factory-engine`/`factory-contracts`.
  **Scope:** virtualisation covers `factory_root` proper only.
  `LocalArtifactStore.base_dir` (the `~/.oap/artifact-store` root) and
  `StageCdInputs.artifact_store` remain filesystem-anchored. They are
  per-run output stores, not factory-content stores; virtualising them
  is out of scope for this spec.
- Migrate `product/apps/opc/src-tauri/src/commands/factory.rs`. Delete
  the spec 108 §7.1 punt TODO.
- Spec 124's `agent_ref` shape extended: `agent_ref` becomes
  `artifact_ref = { artifact_id, version, content_hash }`. Backwards
  compatibility window: handlers accept both shapes for one release.

### Phase 4 — Retire legacy tables

Phase 4 split into two commits because the spec 108 trio retired cleanly
in a single PR while the spec 111/123 family required a focused
substrate-direct rewrite of `api/agents/bindings.ts` with DB-backed
test coverage.

**Phase 4 narrow (migration 34, 2026-05-05):** drop `factory_adapters`,
`factory_contracts`, `factory_processes`. Reads project from the
substrate via `loadSubstrateForOrg` + `projectSubstrateToLegacy`;
spec 108's `/api/factory/{adapters,contracts,processes}` endpoints
continue to serve kind-filtered views with no external API break.
`api/agents/catalog.ts` rewritten substrate-direct.

**Phase 4b (migration 35, 2026-05-05):** drop `agent_catalog`,
`agent_catalog_audit`, `project_agent_bindings`, and the four legacy
`factory_upstreams` per-side columns (`factory_source`, `factory_ref`,
`template_source`, `template_ref`). `api/agents/bindings.ts` rewritten
substrate-direct with the spec 098 integrity probe re-pointed at
`factory_bindings ⨝ factory_artifact_substrate`. The legacy singleton
upstream wire shape composes from two N-per-org rows
(`legacy-mixed` for the factory side, `legacy-template-mixed` for the
template side); the wire shape is preserved byte-stable.

## 10. Symmetry With Existing Specs

| Spec | Relationship |
|---|---|
| 108 (factory-as-platform-feature) | Amends §3 (data model) and §9 (non-goals: editing). §4 (APIs), §5 (sync flow), §6 (UI), §7 (OPC contract) refined; §7.1 punt closed. |
| 111 (org-agent-catalog-sync) | Amends. `agent_catalog` becomes the `origin='user-authored'` partition of `factory_artifact_substrate`. UI surface preserved; backed by the substrate. |
| 123 (agent-catalog-org-rescope) | Amends. Binding mechanism (`project_agent_bindings`) becomes universal `factory_bindings`. Invariants I-B1..I-B4 carry over verbatim, applied to all kinds. |
| 124 (opc-factory-run-platform-integration) | Refines `factory_runs.stage_progress[].agent_ref` shape (rename to `artifact_ref`, generalise to any kind). One-release backward-compat window. |
| 112 (factory-project-lifecycle) | `scaffoldReadiness.ts` extended to check `scaffold_source_id` resolution. The runtime gate (§5.4) becomes an explicit Create blocker surfaced in the UI rather than a silent reject. |
| 088 (factory-upstream-sync, superseded) | No new relationship. The translation protocol it lifted is replaced wholesale by verbatim mirror. |

## 11. Risks and Open Questions

1. **Three-way merge UX is new ground for statecraft.** The
   `conflict_state` machine is straightforward; the editor UI for
   "edit and accept" with an inline 3-way diff requires a CodeMirror
   merge view or equivalent. If that is too much for Phase 1, ship
   with keep-mine / take-upstream only; defer edit-and-accept.
2. **Kind taxonomy — locked at 11 kinds.** §4.2 enumerates 11 kinds
   after Phase 0 walk (added `page-type-reference`; 5 candidate kinds
   surfaced during the walk were either folded into existing kinds —
   `sitemap-template`/`derived-summary` → `reference-data` — or
   excluded from sync — `runtime-script`/`binary-asset` via the
   preserved `Orchestrator/scripts/` exclusion). `factory-orchestration-tm.md`
   stays in `process-stage` per the path-predicate precedence rule.
   Future upstream changes that introduce a new file shape are
   sync-worker iteration surface; the sync emits an
   `unclassified-artifact` warning and the row enters with `kind=NULL`
   for triage rather than auto-extending the enum.
3. **Bundle inventory — locked at 11 bundles.** §4.3 enumerates the
   full path-predicate set. Future upstream additions land as new
   predicates via amendment.
4. **Migration of historical `factory_runs` audit.** Runs recorded
   under the bucket-blob model carry their own JSONB-frozen audit;
   they remain readable but are not retroactively re-bound (§3.2
   non-goal). If a compliance use case requires retroactive binding,
   it is a follow-up spec.
5. **OAP-native scaffold seed origins.** §7.3 says today's
   `factory/adapters/{three}/**` content is the seed. The `_tmp/`
   prefix on the actual on-disk location is irrelevant — the content
   itself is what's ingested. If the content is already
   substantively wrong (e.g. patterns reference dependencies that
   don't exist), the seed should be sanitized in Phase 2, not
   ingested verbatim.
6. **`oap-self` security model.** Sync from this monorepo means
   statecraft pulls from a remote it (in production) does not own.
   `oap-self` should resolve to a pinned ref + signed commits in
   production; in dev it can be a local checkout. The
   `factory_upstream_pats` mechanism (spec 109) accommodates this
   without change.
7. **Race between sync and override.** A user editing an artifact
   while sync runs: the sync transaction takes a row-level lock
   per artifact; the override save retries on conflict. UI shows
   "sync in progress" disable state.

## 12. Success Criteria

> **Post-close fixes recorded 2026-05-05.** SC-001 and SC-004 were not
> fully met at the initial close (Phase 4b commit `378cbe8`). The
> deficiencies — and the same-day follow-on commit that closed them —
> are documented after each criterion below.

- **SC-001 (substrate fidelity):** A sync of `legacy-factory`
  produces `factory_artifact_substrate` rows whose `effective_body` content
  hashes equal the upstream file hashes byte-for-byte. No file is
  dropped; no synthetic categorisation reshapes content.
  - _Post-close gap:_ the OAP-owned contract schemas under
    `standards/schemas/factory/` (9 files, declared
    "compile-time-canonical" in plan.md Constitution Check / Principle
    II) were dropped from the substrate at first cutover because
    `tasks.md` did not file a task to ingest them and the orphaned
    `loadOapOwnedContracts` helper had no callers. Result: the
    `/app/factory/contracts` tab showed 0 of 9 schemas.
  - _Resolution:_ `loadOapOwnedSubstrateRows()` (rewritten
    `oapContracts.ts`) now emits substrate row drafts under
    `(origin='oap-self', kind='contract-schema')` with the
    repo-relative path. `runSyncPipeline` merges the drafts into the
    per-sync row set so `applyDualWrite` writes them atomically and the
    prune/retire step under `oap-self` works uniformly with upstream
    origins. `loadSubstrateForOrg` and
    `projectSubstrateToLegacy::buildContracts` accept the third origin
    so the legacy wire shape carries the OAP-self schemas. C count
    restored: 9.

- **SC-002 (override survival):** A user override of any artifact
  survives an upstream sync that does not change the same path.
  An upstream sync that does change the same path produces
  `conflict_state='diverged'` and never overwrites `user_body`.

- **SC-003 (binding reproducibility):** A factory run recorded
  with `factory_bindings` against artifact content_hashes can be
  replayed N months later and produce byte-identical prompts even
  after upstream has moved on. Verified by hash equality on
  rendered prompt strings, not just artifact bodies.

- **SC-004 (OAP-native parity):** All four adapters (`acme-vue-node`,
  `next-prisma`, `rust-axum`, `encore-react`) pass
  `scaffoldReadiness.ts` and can scaffold a buildable project.
  No adapter is silently rejected by the runtime gate.
  - _Post-close gap (Part 1):_ `ingestAllOapNativeAdapters` /
    `ingestOapNativeAdapter` were fully implemented with tests but had
    zero production callers; the three OAP-native adapter trees never
    entered the substrate organically.
  - _Post-close gap (Part 2):_ `projection.ts::buildAdapter` was
    hardcoded to emit a single synthetic `acme-vue-node` row from
    template-origin content, so even when OAP-native adapter manifests
    were in the substrate they would not surface in the legacy
    `factory_adapters` wire shape; A count would stay at 1.
  - _Resolution:_ added `loadOapNativeAdapterSubstrateRows()` to
    `oapNativeIngest.ts` and wired it into `runSyncPipeline` alongside
    the contract-schema ingest. Generalised `buildAdapter` →
    `buildOapNativeAdapters` to emit one `AdapterTranslation` per
    `kind='adapter-manifest'` substrate row (parsed YAML manifest +
    companion patterns/agents/invariants exposed via `__companion`).
    Updated `countByLegacyKind` to count adapter-manifest rows in
    addition to the synthetic acme-vue-node count. Adapter source root
    resolves via `OAP_NATIVE_ADAPTERS_DIR` env var with walk-up
    fallback to `_tmp/factory/adapters/` (mirrors the
    `OAP_FACTORY_SCHEMAS_DIR` pattern). Per-adapter readiness in
    `scaffoldReadiness.ts` already gates on `scaffold_source_id` per
    Phase 2 T056.
  - _Post-close gap (Part 3):_ §7.2 declared `template_remote` is
    replaced by `orchestration_source_id` + `scaffold_source_id` for
    every adapter, but Phase 2's rename only landed for the OAP-native
    trio (`next-prisma`, `rust-axum`, `encore-react`) via
    `oapNativeSanitise.ts:96`. The synthetic `acme-vue-node` adapter
    that `projection.ts::buildAdapter` emits from template-origin
    substrate rows still carried `template_remote` only, and five
    downstream consumers (scheduler, templateCache, create, scaffold
    types, scaffoldReadiness fallback) read that legacy field
    directly. Result: the §7.2 contract was nominally complete but the
    one adapter that originated `template_remote` in the first place
    never made the switch.
  - _Resolution:_ closed by spec
    [`140-acme-vue-node-scaffold-source-id-cutover`](../140-acme-vue-node-scaffold-source-id-cutover/spec.md)
    (closed 2026-05-06, three commits on branch
    `140-acme-vue-node-scaffold-source-id-cutover`). Both projection
    paths now emit the §7.2 trio sourced from a single
    `OAP_NATIVE_ADAPTERS["acme-vue-node"]` constant; the de-dup priority
    in `projectSubstrateToLegacy` is flipped so the `oap-self`
    `adapter-manifest` row wins on collision; the scaffold layer
    resolves the clone target via `factory_upstreams (org_id,
    source_id=manifest.scaffold_source_id)`; the `hasTemplateRemote`
    fallback is gone end-to-end. Migration 36 backfills a synthetic
    `oap-self` `adapter-manifest` row per existing org so deploy-time
    cutover requires no operator action.

- **SC-005 (OPC parity):** OPC factory runs use the virtual
  factory_root with no local checkout. The
  `// TODO(spec-108-§7-punt)` marker is deleted. Replay of a
  recorded run produces byte-identical prompts whether OPC is
  online (fresh fetch) or offline (cache hit).
  - _Status:_ `FactoryRoot::Filesystem` / `FactoryRoot::Virtual` enum
    landed; OPC `factory.rs` materialises through
    `factory_platform_client::materialise_run_root` into a content-
    addressed local cache before wrapping in
    `FactoryRoot::Filesystem`. Substantively meets the contract (no
    upstream checkout; replay-deterministic via cache hits) though the
    pure-HTTP `VirtualRoot` path is built as infrastructure rather
    than activated as the dispatch path. Acceptable per §8 design
    note. Pure-HTTP activation remains available for future change
    without engine-side modification.

- **SC-006 (axiomregent enforcement):** Every dispatched skill
  carries a `max_tier` derived from frontmatter; axiomregent
  enforces the ceiling at dispatch and emits an audit row when
  the ceiling is hit.

## 13. Out of Scope (revisit after Phase 4)

- Cross-org artifact sharing.
- Author-an-adapter-from-scratch UI.
- Multi-factory-per-org (today: one configuration per org).
- Mirroring scaffold content (apps/, product/packages/, modules/) into the
  substrate. Scaffold remains clone-and-discard.
- Editing the substrate from OPC.

---

> **Authorship note:** This spec replaces the spec 108 bucket-blob with
> a content-addressed substrate. It is consciously larger in scope than
> a typical amendment because the unification of `agent_catalog` (spec
> 111/123) with `factory_processes` (spec 108) is the load-bearing
> realignment that the smaller scopes prevent. The phased migration
> (§9) keeps spec 108's external API surface stable while the substrate
> takes over underneath.

---

## 14. Post-approval hardening: adapter-manifest projection guard (2026-06-05)

`getAdapter` (`api/factory/browse.ts`) returned `found.manifest` verbatim.
For an org whose substrate has no `adapter-manifest` row,
`projectSubstrateToLegacy` falls back to `buildAdapter`'s knowledge/
orchestration bundle (keys: `entry` / `orchestrator` /
`orchestration_source_id`, no `schema_version`). Serving that as an adapter
manifest made the OPC factory engine fail deep in startup with a cryptic
`missing field 'schema_version'`.

Hardening: `getAdapter` validates that the projected manifest carries a
string `schema_version` and otherwise throws `APIError.internal` with a
clear operator message (plus a `log.error`), instead of silently shipping a
non-manifest document. This is a guard only — it does not change the
projection or the substrate.

Known follow-up (NOT in this change): for an org to actually *resolve* a
real `acme-vue-node` manifest, the substrate must hold its spec-074
`manifest.yaml` as an `oap-self` row. That requires (a) un-skipping
`acme-vue-node` in `loadOapNativeAdapterSubstrateRows` (`oapNativeIngest.ts`,
the `// already in upstream sync` continue), scoped so upstream-mirrored
orchestration/skills are not duplicated; (b) `sanitiseManifest`
(`oapNativeSanitise.ts`) to stop deleting the `validation` block, which the
desktop's `AdapterManifest` requires (so the row, once seeded, actually
parses); and (c) a verified `OAP_NATIVE_ADAPTERS_DIR` mount carrying that
`manifest.yaml`. Deferred because (b)/(c) are contract- and
deployment-level and need the mount confirmed first.
