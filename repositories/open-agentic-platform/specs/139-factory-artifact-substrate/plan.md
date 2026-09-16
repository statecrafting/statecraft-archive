# Implementation Plan: Factory Artifact Substrate

**Branch**: `139-factory-artifact-substrate` | **Date**: 2026-05-05 | **Spec**: `./spec.md`
**Input**: Feature specification from `specs/139-factory-artifact-substrate/spec.md`

## Summary

Spec 139 replaces spec 108's bucket-blob translator with a content-addressed
substrate (`factory_artifact_substrate`) and unifies it with the spec 111/123
`agent_catalog`. The plan delivers this in four sequenced phases that
preserve spec 108's external API surface continuously — no migration
"big bang", no API break window.

**The load-bearing realignments** (versus spec 108's model):

1. **Storage shape:** one row per upstream file (verbatim), versioned and
   content-hashed, indexed by `(org_id, origin, path)`. JSONB blobs
   become *projections* over rows, not the storage primitive.
2. **Override surface:** every artifact carries an optional `user_body`.
   Sync workers cannot overwrite user overrides; conflicts surface to a
   resolution UI.
3. **Pinning universality:** spec 123's `project_agent_bindings` mechanism
   becomes `factory_bindings`, applicable to *any* kind (adapter,
   contract, skill, pattern, sample). Replay of a recorded factory run
   reproduces byte-identical prompts.
4. **Adapter symmetry:** every adapter declares `(orchestration_source_id,
   scaffold_source_id)`. The current OAP-native vapor (no scaffold for
   `next-prisma`/`rust-axum`/`encore-react`) becomes a fillable gap.
5. **OPC parity:** the desktop's local-checkout path is replaced by a
   `VirtualRoot` resolved against the platform API. Closes spec 108 §7.1.

The plan deliberately keeps Phase 1 dual-write (substrate authoritative
underneath; legacy projection on top) so spec 108's APIs continue
serving with no consumer change. Legacy tables are dropped only in
Phase 4, after a release-soak with the substrate as primary read.

## Technical Context

**Languages**: TypeScript 5.x (statecraft Encore.ts), Rust 1.95.0
(factory-engine, factory-contracts, OPC desktop), React Router v7
(statecraft web).
**Primary Dependencies**: Drizzle ORM (PostgreSQL), Encore.ts PubSub,
existing `factory-engine` / `factory-contracts` crates, axiomregent
policy kernel (no version bump expected). New: a CodeMirror merge-view
component for the conflict resolution UI in Phase 1 (or shipped
without merge-view in Phase 1, added in Phase 2).
**Storage**: PostgreSQL (statecraft). New tables:
`factory_artifact_substrate`, `factory_artifact_substrate_audit`, `factory_bindings`.
Generalised: `factory_upstreams`. Migrated and dropped: `agent_catalog`,
`agent_catalog_audit`, `project_agent_bindings`, `factory_adapters`,
`factory_contracts`, `factory_processes`.
**Testing**: `encore test` for statecraft API and DB tests; `cargo test`
for the factory-engine `VirtualRoot`; integration tests for the OPC
desktop `factory.rs` migration.
**Target Platform**: Encore.ts service in production AKS; OPC desktop on
macOS (Apple Silicon only per project memory) and Linux/Windows.
**Project Type**: Full-stack web service + Rust library + desktop app —
the cross-cutting nature of the change is the entire reason this spec
exists.
**Performance Goals**: Sync of `legacy-factory` (≈ 122 files) under
10 s wall-time. Per-artifact path read from the substrate under 50 ms p95
(API + cache lookup). VirtualRoot first-use under 2 s for an entire run
manifest fetch.
**Constraints**: Spec 108's external API surface (`/api/factory/{adapters,
contracts,processes}`) must remain backward-compatible across Phases 1–3.
No live consumer breaks until Phase 4. Migration of historical
`factory_runs` audit rows must not invalidate them.
**Scale/Scope**: Today's corpus: 1 active org, ≈ 122 artifacts after
sync of `legacy-factory` + `template`. Design accepts 10× corpus
growth and 100× org count without restructuring.

## Constitution Check

*GATE: Must pass before Phase 1. Re-check before Phase 4 finalisation.*

- **Principle I — markdown human truth.** Spec/plan/tasks remain
  markdown. ✅
- **Principle II — compiler-emitted JSON machine truth.** Substrate
  rows are not compiler artifacts — they are runtime DB rows in a
  governed table. The factory-contracts schemas under
  `standards/schemas/factory/` remain compile-time-canonical
  per spec 112 §3.2 (with `SCHEMA_VERSION` const). Statecraft
  continues to mirror them per-org for runtime policy lookup, now via
  the substrate (`origin='oap-self'`, `kind='contract-schema'`). ✅
- **CONST-005 — spec/code coherence.** This spec amends three live
  specs (108, 111, 123). The amendments are explicit `amends:` frontmatter,
  not back-dated edits. Implementation lands phase-by-phase with
  spec 127/130/133 coupling gate visibility on each phase. ✅
- **No backwards-compat shims** (project memory). Phases 1–3 keep the
  spec 108 API surface working *because the substrate underneath is
  authoritative and the legacy tables are projections* — not because a
  shim is preserving deprecated behaviour. Phase 4's drop is clean. ✅
- **Governed-artifact-reads (spec 103).** No `python`/`jq` against
  compiled artifacts in any phase. Encore handlers use Drizzle; OPC
  uses the typed `VirtualRoot`. ✅
- **Confirm before deleting credentials** (project memory). Migration
  of `factory_upstream_pats` is read-only in this spec — no PAT row
  is touched. ✅
- **Schema version as compile-time const** (project memory). The
  `factory_artifact_substrate` row format is versioned via a `SUBSTRATE_VERSION`
  const in a shared TS module + a Rust mirror in `factory-engine`. Phase 1
  task includes this. ✅

No violations expected.

## Project Structure

### Documentation (this feature)

```text
specs/139-factory-artifact-substrate/
├── spec.md       # Feature spec
├── plan.md       # This file
└── tasks.md      # Implementation task list
```

### Source code touched (anticipated)

```text
platform/services/statecraft/
├── api/db/schema.ts                            # add factory_artifact_substrate, factory_artifact_substrate_audit, factory_bindings; generalise factory_upstreams
├── api/db/migrations/
│   ├── NN_factory_artifact_substrate.up.sql    # Phase 1 migration
│   ├── NN_migrate_agent_catalog.up.sql         # Phase 2 backfill
│   └── NN_drop_legacy_factory_tables.up.sql    # Phase 4 drop
├── api/factory/
│   ├── translator.ts                           # rewrite: verbatim mirror replacing categorical projection
│   ├── syncPipeline.ts                         # rewrite to drive substrate; legacy projection emitted from substrate
│   ├── upstreams.ts                            # extend to N-per-org with role/subpath
│   ├── browse.ts                               # backed by substrate views in Phase 1; remains source-shape stable
│   ├── artifacts.ts                            # NEW — kind-filtered + by-path endpoints
│   ├── conflicts.ts                            # NEW — diverged-list + resolution endpoints
│   ├── bindings.ts                             # NEW — factory_bindings CRUD (replaces project_agent_bindings)
│   └── projection.ts                           # NEW — view-builder emitting legacy adapters/contracts/processes shapes from substrate
├── api/agents/                                 # Phase 2: surface backed by substrate, route preserved
└── web/app/routes/
    ├── app.factory.adapters.tsx                # unchanged in Phase 1; upgraded with override/conflict UI in Phase 2
    ├── app.factory.contracts.tsx               # ditto
    ├── app.factory.processes.tsx               # ditto
    └── app.factory.artifacts.tsx               # NEW — kind-filtered browser + override editor + conflict resolver

product/apps/opc/src-tauri/src/commands/
└── factory.rs                                  # Phase 3: replace resolve_factory_root with VirtualRoot client; delete §7-punt TODO

crates/
├── factory-engine/src/
│   ├── factory_root.rs                         # NEW — abstract over filesystem and VirtualRoot
│   └── virtual_root.rs                         # NEW — HTTP client + cache for substrate-backed reads
└── factory-contracts/src/                      # extend with optional artifact_ref shape (spec 124 generalisation)

specs/108-factory-as-platform-feature/spec.md   # add amendment_record back-link to 139
specs/111-org-agent-catalog-sync/spec.md        # add amendment_record back-link to 139
specs/123-agent-catalog-org-rescope/spec.md     # add amendment_record back-link to 139
```

**Structure Decision**: This spec is a cross-cutting refactor; the
project layout is the existing OAP layout. No new top-level directories.
The new files are scoped to existing module boundaries.

## Phase 0 — Pre-flight Investigation

**Purpose**: Surface unknowns before committing to row schemas and
migration ordering.

P0.1 **Walk the upstream end-to-end.** Clone
`statecrafting/legacy-factory@<latest>` and
`statecrafting/template@<latest>` into a scratch dir. For every
file:
- Compute `kind` per the §4.2 predicates from the spec.
- Record any file that does not classify into a kind (the spec
  enumerates 10 kinds; surface gaps).
- Record any frontmatter quirk (missing `id`, missing `parent`,
  declared `tier`/`tools_required`).
- Record candidate bundles per §4.3 path conventions; produce a list.

Output: `specs/139-factory-artifact-substrate/research.md` with the
walk inventory. Decisions to make from it:

- D-1 Final kind taxonomy (any additions to §4.2)?
- D-2 Bundle inventory (the full list of bundle predicates).
- D-3 Sample HTML files: confirmed routing into `kind='sample-html'`,
  with `bundle_id` linking each sample to its parent page-type skill.

P0.2 **Audit existing `agent_catalog` content.** Query the prod schema:

```sql
SELECT org_id, name, version, status, length(body_markdown), content_hash
FROM agent_catalog
ORDER BY org_id, name, version;
```

Confirm: every row has frontmatter (jsonb), body_markdown (text), and
content_hash (text) populated. Any nulls = a Phase 2 migration edge
case.

P0.3 **OAP-native adapter content audit.** For each of `next-prisma`,
`rust-axum`, `encore-react` (sourced from the user's local copy of the
former in-tree files; the location is irrelevant to this spec, only
the content matters):
- Validate every `manifest.yaml` parses as YAML.
- Validate every `agents/*.md` has frontmatter with an `id`.
- Validate every `patterns/**/*.md` is well-formed.
- List dependencies referenced by patterns that don't exist (e.g.
  `Spec 067 — tool registry` invocations) — these are sanitization
  candidates per spec §11 risk 5.

Output: `research.md` second section. Decision D-4: ingest verbatim or
ingest sanitized; Phase 2 ingestion task carries the choice.

P0.4 **OPC factory-engine API audit.** Read
`crates/factory-engine/src/lib.rs` and confirm `factory_root: PathBuf`
is the only filesystem access pattern. If multiple call sites hard-code
filesystem reads outside the abstraction, list them — they need an
abstraction extraction in Phase 3.

**Checkpoint**: Phase 0 ends with `research.md` written and four
decisions (D-1, D-2, D-3, D-4) recorded. Phases 1–4 cannot start until
those decisions are documented in `research.md`.

### Phase 0 outcomes (locked 2026-05-05)

Phase 0 ran. `research.md` is at `specs/139-factory-artifact-substrate/research.md`.
The walk surfaced 5 candidate new kinds (≥ 3 halt threshold fired);
user direction resolved as follows and the spec was edited to reflect:

- **D-1 — Kind taxonomy:** add **one** new kind, `page-type-reference`
  (20 files in `Client_Interface/page-types/{authenticated,public}/
  page-type-*.md`). The other four candidates collapse:
  `sitemap-template` (3 files) → existing `reference-data`;
  `derived-summary` (1 file, `digest.md`) → existing `reference-data`
  (frontmatter-less .md is acceptable);
  `runtime-script` (2 Python files) and `binary-asset` (3 PNG/POTX
  files) → **excluded from sync** (preserves the spec 088/108
  `Orchestrator/scripts/` exclusion). Substrate row body columns stay
  text-only; no `bytea` columns. Path-predicate precedence rule
  locked: path-based predicates win over frontmatter-based.
  `factory-orchestration-tm.md` classifies as `process-stage` by path.
- **D-2 — Bundle inventory:** 11 bundles (the agent's 13 minus
  `ppt-generator` and `docx-generator` which are excluded by D-1's
  scripts-exclusion). Locked into spec §4.3.
- **D-3 — Sample-HTML routing:** keep §4.2 predicate as written; sync
  emits `parentless-sample-html` warnings for the 3 orphans
  (`settings-hub.html`, `accessibility-page.html`, `privacy-page.html`)
  which enter substrate with `bundle_id = NULL`. Multi-sample bundles
  (e.g. `form-step-{1,2}.html`) supported natively. Locked into §4.3.
- **D-4 — OAP-native adapter ingestion:** ingest sanitised, with four
  mechanical fixes carried by T054:
  1. Update `stack.runtime: node-24` in `next-prisma` (was `node-22`)
     and `encore-react` (was `node-20`) manifests at ingest. `rust-axum`
     keeps `native`.
  2. Inject `orchestration_source_id` / `scaffold_source_id` /
     `scaffold_runtime` per-adapter (additive, by T055).
  3. Pick `validation/invariants.yaml` as canonical; drop the
     duplicate `manifest.yaml.validation` block.
  4. Auto-generate minimal frontmatter on patterns at ingest:
     `id: <adapter>-pattern-<rel-path-kebab>`, `adapter: <name>`,
     `category: <api|data|page-types|ui>`. Required for substrate
     addressability.

**Phase 1 unblocked.** Migration filename is
`32_factory_artifact_substrate.up.sql` (HEAD is migration 31).
OQ-1 (`agent_catalog_audit.action: "fork"` mapping) deferred to
T051 in Phase 2 — non-blocking for Phase 1.

## Phase 1 — Substrate online, dual-write

**Purpose**: Land the new tables, the verbatim sync, and the projection
that emits the legacy table shapes from the substrate. Spec 108's API
surface continues to serve.

Order of operations:

1. Migration introducing `factory_artifact_substrate`, `factory_artifact_substrate_audit`,
   `factory_bindings`. Generalise `factory_upstreams` (add `source_id`,
   `role`, `subpath`; keep legacy `factory_source` / `template_source`
   columns nullable for the transition).
2. `SUBSTRATE_VERSION` const in a shared TS module
   (`api/factory/substrate.ts`). Mirror it in `crates/factory-engine`.
3. Rewrite `translator.ts` as a verbatim walk: per file, compute
   `kind`/`frontmatter`/`content_hash`, emit a substrate row.
4. Rewrite `syncPipeline.ts` to drive the substrate transactionally.
5. Implement `projection.ts`: SELECT from substrate, emit the legacy
   `factory_adapters`/`factory_contracts`/`factory_processes` JSONB
   shapes. The existing `browse.ts` reads from the projection (no API
   contract change). Phase 4 removes the projection by replacing
   `browse.ts` with substrate-direct reads.
6. New endpoints: `GET /api/factory/artifacts` (kind-filtered, paged),
   `GET /api/factory/artifacts/by-path`, `GET /api/factory/artifacts/:id`,
   `POST /api/factory/artifacts/:id/override`,
   `DELETE /api/factory/artifacts/:id/override`,
   `GET /api/factory/artifacts/conflicts`,
   `POST /api/factory/artifacts/:id/resolve`.
7. UI: new route `/app/factory/artifacts` with kind filter, override
   editor, conflict list. Phase 1 ships keep-mine / take-upstream
   resolution; edit-and-accept is Phase 2 (per §11 risk 1).

**Test strategy:**

- `encore test` for the new substrate writes and reads.
- A round-trip test: walk a fixture upstream → substrate → projection
  → assert the projection's JSONB equals what the legacy translator
  would have produced for the same input. (Locks Phase-1's
  no-consumer-break invariant.)
- A property test: for any sequence of (sync, override, sync, …)
  ops, `effective_body` always equals `coalesce(user_body,
  upstream_body)` and `conflict_state` machine never enters an
  undocumented value.

**Checkpoint**: spec 108's existing `/api/factory/{adapters,contracts,
processes}` endpoints serve byte-identical responses (asserted by the
round-trip test). New `/api/factory/artifacts/*` endpoints functional.
Conflict UI lists divergent rows. Phase 2 unblocked.

## Phase 2 — Migrate `agent_catalog` and OAP-native adapters

**Purpose**: Move all spec 111/123 content into the substrate; ingest the
three OAP-native adapters; light up the symmetric `scaffold_source_id`
gate.

Order:

1. **`agent_catalog` backfill migration.** Idempotent `INSERT … ON
   CONFLICT DO NOTHING` mapping every `agent_catalog` row to a
   `factory_artifact_substrate` row with `origin='user-authored'`,
   `kind='agent'`, `path='user-authored/' || name || '.md'`. Carry
   `frontmatter`, `body_markdown` (→ `user_body`), `content_hash`,
   `version`, `status`, timestamps. `upstream_*` columns NULL.
2. **`agent_catalog_audit` backfill.** Map each audit row into
   `factory_artifact_substrate_audit` with the equivalent `action`. Audit
   semantics preserved.
3. **`project_agent_bindings` backfill.** Map every binding to
   `factory_bindings` (verbatim — `org_agent_id` → `artifact_id`,
   `pinned_version` and `pinned_content_hash` carry over).
4. **Org-agent UI re-pointed at substrate.** The existing
   `/api/agents/*` endpoints continue to work, but their handlers read
   from the substrate (filtered to `origin='user-authored'`).
   `agent_catalog` table becomes unused but is not dropped (Phase 4).
5. **OAP-native adapter ingestion.** For each of `next-prisma`,
   `rust-axum`, `encore-react`: ingest the existing content (decision
   D-4 from Phase 0 — verbatim or sanitised) into substrate rows
   under `origin='oap-self'`, `path='adapters/<name>/<rel>'`.
6. **Adapter manifest format extension.** Add
   `orchestration_source_id` and `scaffold_source_id` to the manifest
   shape. `acme-vue-node` carries `legacy-factory` /
   `acme-vue-node-template`. The three OAP-native adapters carry their
   `oap-*` source ids.
7. **`scaffoldReadiness.ts` extension.** The endpoint now returns a
   per-adapter eligibility verdict that includes
   `scaffold_source_resolved: bool`. The web Create form surfaces a
   blocker per missing scaffold source. The current silent-reject
   path is removed.
8. **Conflict UI: edit-and-accept** (deferred from Phase 1 if needed).

**Test strategy:**

- Migration test: snapshot `agent_catalog` + `project_agent_bindings`
  before; run migration; assert every row has a corresponding
  substrate row with byte-equal content_hash.
- E2E test: a project that today binds an org agent at v3 continues
  to dispatch successfully through the substrate-backed binding.
- E2E test: `next-prisma` is selectable in the Create form; submit
  produces a clear "no scaffold source configured" blocker; once a
  scaffold source is registered, Create succeeds end-to-end.

**Checkpoint**: All four adapters Create-eligible with documented
sources. Existing org-agent flows function with no UI surface change.
Audit log shows artifact-level lifecycle for every artifact.

## Phase 3 — OPC virtual factory_root

**Purpose**: Close spec 108 §7.1. OPC factory runs use the platform
substrate as their `factory_root`; recorded runs replay reproducibly.

**Scope (locked from Phase 0 §4.3 audit):** virtualisation covers
`factory_root` proper only — the 10 surgery sites enumerated in
`research.md` §4.2. `LocalArtifactStore.base_dir` and
`StageCdInputs.artifact_store` remain filesystem-anchored; they are
per-run output stores, not factory-content stores. Spec 139 §8 carries
this scope statement; this plan section pre-commits to it.

Order:

1. **`factory-engine` abstraction.** Lift the `factory_root: PathBuf`
   field to an enum `FactoryRoot::{Filesystem(PathBuf), Virtual(VirtualRoot)}`.
   Existing tests continue to pass against the filesystem variant.
2. **`VirtualRoot` implementation.** HTTP client over the platform's
   `/api/factory/artifacts/*` endpoints. Local cache on disk under
   `~/.cache/oap/factory/<org>/<content_hash>` keyed by content_hash
   (immutable cache).
3. **`product/apps/opc/src-tauri/src/commands/factory.rs` migration.**
   Replace `resolve_factory_root()` with `FactoryRoot::Virtual(...)`.
   Delete the `// TODO(spec-108-§7-punt)` marker.
4. **Spec 124 `agent_ref` generalisation.** Add `artifact_ref` shape
   (`{ artifact_id, version, content_hash }`) alongside the existing
   `agent_ref` (`{ org_agent_id, version, content_hash }`). One-release
   compatibility window: handlers accept both; emit
   `artifact_ref` going forward.
5. **`factory_runs` consumers updated.** Stage progress entries record
   `artifact_ref` per skill dispatched. Replay reads the substrate by
   artifact id + content_hash and reconstructs the prompt
   byte-identically.

**Test strategy:**

- `cargo test` for `VirtualRoot` against a mock HTTP server.
- Integration test: a recorded factory run from Phase 2 replays
  through `VirtualRoot` and produces byte-identical prompt strings.
- Offline test: with the cache populated, `VirtualRoot` operates
  without network.

**Checkpoint**: OPC desktop ships without the `_tmp/factory` (or any
local) checkout. The §7-punt TODO is gone. Recorded runs replay
reproducibly online and offline (cache-warm).

## Phase 4 — Retire legacy

**Purpose**: Drop the projection and the legacy tables. Surface area
shrinks. No consumer regression.

Order:

1. **Read-shadow window.** Before dropping anything: turn on a
   logging mode that records every read against the legacy tables.
   Bake for one release with zero recorded reads. Coverage MUST span
   BOTH surfaces:
   - `browse.ts` reads against `factory_adapters` /
     `factory_contracts` / `factory_processes` (the spec 108 surface).
   - `api/agents/*` reads against `agent_catalog` /
     `agent_catalog_audit` (Phase 2 T053 deviation: T053 mirrored
     writes to substrate but kept reads on the legacy table; the read
     swap was deferred to Phase 4 prep). The Phase 4 zero-read bake
     gate is zero across **both** surfaces — drop runs only when
     neither surface has logged a legacy-table read for one release.
2. **Replace `browse.ts` with substrate-direct.** The endpoint
   responses remain shape-stable; the projection is removed.
   Simultaneously re-point `api/agents/*` reads at the substrate
   (Phase 2 T053 follow-up): list / get / audit handlers stop reading
   `agent_catalog` and start reading `factory_artifact_substrate` with
   `origin='user-authored'` filter. The wire shape (CatalogAgent)
   stays stable; the publication ternary is recovered from
   `frontmatter.publication_status` injected by Phase 2's mirror.
3. **Drop legacy tables.** Migration `NN_drop_legacy_factory_tables.up.sql`:
   `DROP TABLE factory_adapters, factory_contracts, factory_processes,
   agent_catalog, agent_catalog_audit, project_agent_bindings`.
   Drop `factory_upstreams` legacy columns
   (`factory_source`, `template_source`).
4. **Documentation sweep.** Spec 108 implementation-audit gets a
   section noting "§3 superseded by 139". Spec 111 / 123 get the
   same. CLAUDE.md (root, platform, statecraft) updated.

**Test strategy:**

- Schema diff between Phase 3 end-state and Phase 4 end-state asserts
  only the listed tables/columns dropped.
- Full E2E: every spec 108 / 111 / 123 acceptance scenario passes
  against the substrate-only state.

**Checkpoint**: Legacy is gone. The substrate is the only store. The
spec 108 / 111 / 123 acceptance suites are green against the new
state. SC-001..SC-006 measurable.

## Phase 4b — agent_catalog cutover (deferred from Phase 4)

**Status (as of 2026-05-05):** Phase 4 shipped a *narrow* drop —
migration 34 dropped the spec 108 trio (`factory_adapters`,
`factory_contracts`, `factory_processes`) and the substrate is the only
authoritative store for that data. The spec 111 / 123 family
(`agent_catalog`, `agent_catalog_audit`, `project_agent_bindings`) was
intentionally left in place because `api/agents/bindings.ts` (org-side
binding handlers) still queries them. Phase 4b finishes the cutover.

**Why split.** Phase 4's primary goal — replacing spec 108's bucket-blob
storage primitive — landed clean: `browse.ts`, `opcBundle.ts`,
`runs.ts`, `create.ts`, `import.ts`, `scaffoldReadiness.ts`,
`scheduler.ts`, `relay.ts`, `catalog.ts` all read+write the substrate
exclusively. The `bindings.ts` rewrite is comparable in scope to the
Phase 2 T053 catalog rewrite and merits a focused session with
DB-backed test coverage rather than being squeezed into a single PR.

### Phase 4b tasks

- **B-1 `bindings.ts` re-point.** Replace the `agent_catalog` +
  `project_agent_bindings` queries with `factory_artifact_substrate` +
  `factory_bindings`. The wire shape (org-side `/api/agents/.../bind`
  endpoints) stays stable; readers project the spec 111 ternary from
  `frontmatter.publication_status` (Phase 2 mirror seeded this; Phase 4
  catalog handlers maintain it). Spec 123 invariants I-B1..I-B4 carry
  over verbatim.
- **B-2 DB-backed integration tests for bindings.** Mirror the existing
  spec 124 `runs.test.ts` pattern: live-DB tests under `encore test`,
  excluded from `npm test`. Cover the four binding lifecycle paths
  (bind / repin / unbind / reject-retired) end-to-end against the
  substrate.
- **B-3 Migration 35 — drop the spec 111 / 123 family.** `DROP TABLE
  agent_catalog, agent_catalog_audit, project_agent_bindings`. Drop the
  `factory_upstreams.factory_source / factory_ref / template_source /
  template_ref` legacy columns at the same time (their column drop was
  also deferred from Phase 4 because the legacy GET/POST
  `/api/factory/upstreams` endpoint still backs the singleton wire shape
  via these columns; B-3 re-points that endpoint at the
  `factory_upstreams.repo_url / ref / role` shape simultaneously).
- **B-4 Supersession docs on specs 111 + 123.** Spec 108 received its
  `§3 superseded by 139` note in Phase 4; specs 111 and 123 receive
  equivalent supersession sections after their data model fully
  retires. The Phase 1 `amendment_record:` back-links remain.
- **B-5 Final lifecycle flip.** Spec 139's frontmatter moves to
  `status: approved`, `implementation: complete`, `closed:
  <YYYY-MM-DD>`, with an `implements:` block enumerating the actual
  touched paths (paths must EXIST at activation time per CONST-005).

### Phase 4b checkpoint

- Codebase grep is zero across all six legacy table names in non-test
  code (Phase 4 cleared 3 of 6; Phase 4b clears the remaining 3).
- Migration 35 runs clean against the Phase 4 end-state schema in dev.
- All 362+ vitest tests + Phase 3 cargo tests stay green.
- Spec 139 lifecycle is `approved` / `complete` with verified
  `implements:` paths.

## Risks and Mitigations

| Risk | Mitigation |
|---|---|
| Phase 1 round-trip parity bug — projection emits a slightly different JSONB shape than the old translator | Snapshot test against current production DB content; fail loudly on any difference; gate Phase 2 on test green |
| Phase 2 backfill data loss — orphaned `agent_catalog_audit` rows or unmapped statuses | Read-only dry-run of every backfill in CI; manual review of the dry-run output before running for real |
| Phase 3 cache poisoning — VirtualRoot cache keyed on content_hash but body fetched via origin/path could mismatch | Cache key = `(org_id, artifact_id, content_hash)`; integrity-check on read (recompute hash) |
| Phase 4 hidden consumer — code path that reads legacy tables not detected by the read-shadow log | Schema-level grep on `factory_adapters`/`factory_processes`/`factory_contracts` in the codebase before drop; require zero hits in non-test code |
| Spec coupling gate noise — three amends entries trigger primary-owner heuristic on adjacent specs | Already covered by spec 130 + 133; add the amendment_record back-links to 108/111/123 in the same PR that lands Phase 1 |
| OAP-native scaffold content quality (D-4) — ingesting demonstrably wrong content produces buggy adapters | Decision D-4 in Phase 0 explicitly addresses sanitisation; if D-4 picks "ingest verbatim", a follow-up sanitisation spec is filed before Phase 2 ships |

## Rollback Strategy

Each phase is independently reversible:

- **Phase 1:** drop the new tables; the legacy tables continue to be
  written by a reverted `syncPipeline.ts`. No user data lost (the
  override surface didn't exist yet).
- **Phase 2:** the `agent_catalog` table was not dropped; revert the
  handler re-point and the substrate stops being read. User-authored
  content is dual-present.
- **Phase 3:** revert `factory.rs` to the filesystem variant; the
  `// TODO(spec-108-§7-punt)` marker comes back. OPC operates against
  a local checkout again.
- **Phase 4:** the irreversible step. Only proceed after the
  read-shadow has been zero for one release. Backups of the dropped
  tables are retained per the platform's standard backup policy.

## Open Decisions Tracked Outside the Spec

These are known-unknowns the plan does not resolve; they're tracked
for the implementation to settle:

- **Branch naming for the OAP-native upstream sources.** If using
  `oap-self`, the branch name (`main` vs a dedicated factory branch)
  is a runtime config decision per org.
- **Conflict resolution UI library.** CodeMirror merge view (`@codemirror/merge`,
  MIT — license verified) is the planned editor for `edit_and_accept`
  resolution. Phase 2 (T058) shipped a textarea-based 3-pane stand-in
  with the wire shape locked
  (`POST /api/factory/artifacts/:id/resolve` with
  `action='edit_and_accept', body: string`). The CodeMirror upgrade is
  a pure UI swap on `web/app/components/artifact-merge-editor.tsx` —
  bookmarked as a follow-up task; no API change required.
- **Migration window for spec 124's `agent_ref` → `artifact_ref`.** One
  release as currently planned, but a longer window is acceptable if
  external consumers of the `factory_runs` event stream are
  identified during Phase 3.
