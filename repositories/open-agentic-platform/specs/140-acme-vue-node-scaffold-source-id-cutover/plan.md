# Implementation Plan: acme-vue-node Manifest Cutover to `scaffold_source_id`

**Branch**: `140-acme-vue-node-scaffold-source-id-cutover` | **Date**: 2026-05-06 | **Spec**: `./spec.md`
**Input**: Feature specification from `specs/140-acme-vue-node-scaffold-source-id-cutover/spec.md`

## Summary

Spec 140 finishes spec 139 §7.2's `template_remote` → `scaffold_source_id`
rename for the one adapter (`acme-vue-node`) that didn't get migrated in
139's Phase 2. The work is a focused, three-phase change: emit-side
rewrite of two projection paths, read-side rewrite of the scaffold
warmup + per-request scaffold consumers, and removal of the legacy
fallback in `scaffoldReadiness.ts`. A one-shot migration (36) backfills
existing org substrate so deploy-time cutover requires no operator
action.

**The load-bearing realignments:**

1. **Manifest carries ids, not URLs.** Adapter manifest emits
   `orchestration_source_id`/`scaffold_source_id`; URLs live in
   `factory_upstreams` and are resolved at clone time.
2. **Single source for the alias constant.**
   `OAP_NATIVE_ADAPTERS["acme-vue-node"].scaffoldSourceId` is the only
   string literal; emitters import it.
3. **De-dup priority flipped.** When both a template-origin synthetic
   and an `oap-self` `adapter-manifest` exist for the same name, the
   `oap-self` row wins (it carries the §7.2 manifest shape).
4. **Migration 36 is idempotent and one-shot.** Existing org substrate
   gets a synthetic `oap-self` `adapter-manifest` row written for
   acme-vue-node so the next request resolves through the new path
   without waiting on `/factory-sync`.

The plan keeps the spec 108 wire shape on
`/api/factory/{adapters,contracts,processes}` byte-stable for all
non-`template_remote` fields and replaces `template_remote` with
`scaffold_source_id` inside the projected manifest. The only external
consumer of that wire shape today is statecraft itself; no other
service is affected.

## Technical Context

**Languages**: TypeScript 5.x (statecraft Encore.ts), React Router v7
(statecraft web). No Rust changes (the OPC `factory_root.rs` /
`virtual_root.rs` layer is upstream of the manifest field rename and
unaffected).
**Primary Dependencies**: Drizzle ORM (PostgreSQL), Encore.ts cron +
PubSub (existing). No new dependencies.
**Storage**: PostgreSQL (statecraft). Touched tables:
`factory_artifact_substrate` (one new synthetic row per org via
migration 36), `factory_upstreams` (read-only — composite-PK lookup
by `(org_id, source_id)`). No schema changes.
**Testing**: `encore test` for statecraft API + DB tests; vitest for
pure helpers. Migration 36 covered by an Encore test asserting
idempotence on second run.
**Target Platform**: Encore.ts service in production AKS; web UI
served from same.
**Project Type**: Web-service amendment (no desktop app or Rust crate
changes).
**Performance Goals**: One additional `factory_upstreams` lookup per
warmup-resolver iteration and one per project create — both
sub-millisecond against the composite-PK index.
**Constraints**: The spec 108 wire shape on
`/api/factory/{adapters,contracts,processes}` continues to serve;
removing `template_remote` from inside the projected manifest is the
documented field rename. Migration 36 must be safe to re-run.
**Scale/Scope**: Today's corpus: 1 active org with one acme-vue-node
adapter row. Migration 36 writes one substrate row per org. Touched
production code: ~10 TypeScript files plus one SQL migration.

## Constitution Check

*GATE: Must pass before Phase 1. Re-check after Phase 3 (post-implementation).*

- **Principle I — markdown human truth.** Spec/plan/tasks remain
  markdown. ✅
- **Principle II — compiler-emitted JSON machine truth.** No new
  compiler artifacts. The substrate row written by migration 36 is a
  runtime DB row, not a compiler output. ✅
- **CONST-005 — spec/code coherence.** This amendment finishes a rename
  spec 139 §7.2 already declared canonical. The `implements:` list
  exposes every touched file to the spec-127/130/133 coupling gate. ✅
- **No backwards-compat shims** (project memory). The `hasTemplateRemote`
  fallback in `scaffoldReadiness.ts` and the `template_remote` field on
  `ScaffoldRequest` are deleted, not gated behind a feature flag. ✅
- **Governed-artifact-reads (spec 103).** No new `python`/`jq` against
  compiled artifacts. Encore handlers use Drizzle. ✅
- **Confirm before deleting credentials** (project memory). No PAT or
  credential rows are touched. Migration 36 only writes a substrate
  row. ✅
- **Schema version as compile-time const** (project memory). No schema
  version bump needed — `factory_artifact_substrate` shape is unchanged.
  Migration 36 writes a row that already conforms to the existing
  `SUBSTRATE_VERSION`. ✅

No violations expected.

## Project Structure

### Documentation (this feature)

```text
specs/140-acme-vue-node-scaffold-source-id-cutover/
├── spec.md       # Feature spec (drafted, this commit)
├── plan.md       # This file
└── tasks.md      # Implementation task list
```

### Source code touched

```text
platform/services/statecraft/
├── api/db/migrations/
│   └── 36_aim_vue_node_manifest_cutover.up.sql   # NEW — backfill synthetic oap-self row per org
├── api/factory/
│   ├── projection.ts                              # rewrite buildAdapter to emit scaffold_source_id; flip de-dup priority
│   ├── translator.ts                              # drop template_remote from ProjectionInputs/AdapterEmit
│   ├── substrateBrowser.ts                        # drop templateRemote injection comment + plumbing if unused
│   └── syncWorker.ts                              # update inline comment referencing template_remote on previously-unmanaged adapters
├── api/projects/
│   ├── scaffoldReadiness.ts                       # drop hasTemplateRemote field + legacy fallback branch
│   ├── create.ts                                  # resolve clone target via factory_upstreams.lookup(scaffold_source_id) instead of manifest.template_remote
│   └── scaffold/
│       ├── scheduler.ts                           # rewrite resolveWarmupContext: read scaffold_source_id, look up factory_upstreams, derive (repoUrl, ref)
│       ├── templateCache.ts                       # rename WarmupContext.templateRemote → scaffoldRepoUrl; defaultBranch → scaffoldRef
│       └── types.ts                               # remove template_remote from ScaffoldRequest
├── web/app/
│   ├── lib/projects-api.server.ts                 # drop hasTemplateRemote from ScaffoldReadiness type
│   └── routes/app.projects.new.tsx                # banner copy: drop "(§7.2 replaced the legacy template_remote)" parenthetical
└── CLAUDE.md                                      # update scaffold-warmup paragraph: scaffold_source_id instead of template_remote

specs/139-factory-artifact-substrate/spec.md       # Already amended (frontmatter + §1 callout, this commit)
```

**Structure Decision**: This amendment is a focused, file-bounded
change. No new top-level directories. The migration follows the
existing `NN_<descriptor>.up.sql` numbering pattern (next slot: 36).

## Phase 0 — Pre-flight Investigation

**Purpose**: Confirm the assumptions in §2 of the spec match production
reality before writing any code.

P0.1 **Confirm `factory_upstreams` shape post-Phase-4b.** Read the
schema for `factory_upstreams` and confirm composite-PK is
`(org_id, source_id)`. Confirm `role` enum admits
`'orchestration'` and `'scaffold'`. Confirm `repo_url` and `ref`
are NOT NULL. → `api/db/schema.ts` lines 759-785.

P0.2 **Confirm `OAP_NATIVE_ADAPTERS` carries the canonical alias.**
Verify `oapNativeSanitise.ts` declares
`scaffoldSourceId: "acme-vue-node-template"` for `acme-vue-node`.
Confirm spec 139 §7.2 example matches. Confirm no other production
file hardcodes the literal `"acme-vue-node-template"`.

P0.3 **Confirm OAP-native ingest paths for acme-vue-node.** Run a dry
read of `oapNativeIngest.ts::ingestOapNativeAdapter("acme-vue-node",
…)` against `_tmp/factory/adapters/acme-vue-node/` and confirm the
emitted manifest row carries `scaffold_source_id` post-sanitise.

P0.4 **Inventory all production reads of `template_remote`.** Re-run
the grep in spec §1 to confirm the five call sites are exhaustive.
Surface any test file that asserts the legacy field shape so it can
be migrated alongside the production change.

P0.5 **Inventory existing org substrate rows for acme-vue-node.** Query
`factory_artifact_substrate WHERE kind='adapter-manifest' AND
path='adapters/acme-vue-node/manifest.yaml'` for the active org. If
any rows exist, confirm migration 36 is a no-op for that org. If
zero rows exist, migration 36 inserts one.

**Output:** Phase 0 produces no spec changes; the findings inform
task ordering and are recorded inline in PR description if any
deviation from the spec's assumptions is found.

## Phase 1 — Emit-side rewrite + migration

**Purpose**: Stop emitting `template_remote`. Start emitting
`scaffold_source_id` from both projection paths. Backfill existing org
substrate.

**Sequence:**

1. **Rewrite `projection.ts::buildAdapter`** (lines 193-227) to
   construct a §7.2-compliant manifest. Imports
   `OAP_NATIVE_ADAPTERS["acme-vue-node"].scaffoldSourceId` from
   `oapNativeSanitise.ts`. Removes `template_remote` and
   `template_default_branch` writes. Adds
   `orchestration_source_id`, `scaffold_source_id`, `scaffold_runtime`
   keys with canonical acme-vue-node values.

2. **Flip de-dup priority** in `projection.ts:118`: when both
   template-origin synthetic and `oap-self` `adapter-manifest` exist
   for the same name, prefer the `oap-self` row.

3. **Update `translator.ts`** (lines 308, 355-356, 393, 414, 751-752,
   763, 970): drop the `templateRemote` option and its plumbing
   through `ProjectionInputs` / `AdapterEmit`. The translator's role
   is to mirror upstream content; it should not be writing manifest
   id fields. (The `oapNativeSanitise.ts` path already does this for
   adapter manifests.)

4. **Author migration 36** (`36_aim_vue_node_manifest_cutover.up.sql`):
   for every distinct `org_id` in `factory_artifact_substrate`,
   `INSERT … ON CONFLICT (org_id, origin, path, version) DO NOTHING`
   a synthetic `oap-self` `adapter-manifest` row at
   `adapters/acme-vue-node/manifest.yaml` with the §7.2-compliant body
   computed from a reusable SQL function or generated VALUES list.
   Idempotent on re-run.

5. **Test:** `api/factory/projection.test.ts` and
   `api/factory/translator.test.ts` updated to assert the new manifest
   shape. Migration 36 covered by an Encore test asserting two runs
   produce identical row counts.

**Phase 1 exit criterion:** A fresh `/factory-sync` against
`legacy-factory` + `acme-vue-node-template` produces acme-vue-node
adapter rows whose projected manifest contains `scaffold_source_id`
and does NOT contain `template_remote`. (Maps to AC-5.)

## Phase 2 — Read-side rewrite

**Purpose**: Move every consumer of the legacy field to the new
indirected lookup.

**Sequence:**

1. **Rewrite `scheduler.ts::resolveWarmupContext`** (lines 46-89):
   walk projected adapters, read `manifest.scaffold_source_id`,
   `SELECT repoUrl, ref FROM factory_upstreams WHERE org_id = ? AND
   source_id = ?`, derive `WarmupContext` from the result. The
   `WarmupResolution` discriminator's `"no-template-remote"` arm
   becomes `"no-scaffold-source-id"`; `"no-pat"` and `"no-adapters"`
   stand. Logs reference spec 139 §7.2.

2. **Rename `templateCache.ts::WarmupContext.templateRemote` →
   `scaffoldRepoUrl`** and `defaultBranch` → `scaffoldRef`. Update
   `runWarmup` and `startBackgroundRefresher` callers.

3. **Update `scaffold/types.ts`**: remove `template_remote: string`
   from `ScaffoldRequest`. The clone target is derived inside
   `perRequestScaffold.ts` from the resolved `factory_upstreams` row.

4. **Rewrite `create.ts:145-175`**: replace the direct
   `manifest.template_remote` read with the
   `factory_upstreams`-by-`scaffold_source_id` lookup. The
   `APIError.failedPrecondition` message updates to reference
   `scaffold_source_id`.

5. **Update `substrateBrowser.ts`** comment + any plumbing that
   referenced `template_remote` injection (line 29) — likely a
   comment-only change once §1 lands.

6. **Update `syncWorker.ts`** comment at line 142 to reference the
   new field.

7. **Test:** new `api/projects/scaffold/scheduler.test.ts` covers the
   `factory_upstreams` lookup branch including the `no-scaffold-source-id`
   resolution. `api/projects/scaffold/scaffold.test.ts` updated for the
   `WarmupContext` field rename.

**Phase 2 exit criterion:** `grep -r template_remote
platform/services/statecraft --include='*.ts' --exclude='*.test.ts'`
returns zero hits in production code (only schema/migration
historical comments remain). (Maps to AC-1.)

## Phase 3 — Readiness fallback removal + banner copy

**Purpose**: Drop the legacy fallback now that no manifest emits the
old field and no consumer reads it.

**Sequence:**

1. **`scaffoldReadiness.ts`**: delete the `hasTemplateRemote` field on
   `AdapterReadinessVerdict` and `ScaffoldReadinessResponse`. Delete
   the legacy-fallback branch in `createEligible`. Simplify the
   blocker resolution: `stale-adapter-manifest` fires when no adapter
   declares `scaffold_source_id`; `no-scaffold-source-resolved` fires
   when at least one declares but none resolve. Remove all comments
   referencing the "transition window" (lines 33-37, 53-58, 62-64).

2. **`web/app/lib/projects-api.server.ts`**: drop
   `hasTemplateRemote` from `ScaffoldReadiness` type.

3. **`web/app/routes/app.projects.new.tsx:655-670`**: simplify the
   `stale-adapter-manifest` banner copy. Drop the parenthetical
   "(§7.2 replaced the legacy `template_remote`)" — once Phase 1 + 2
   land, the legacy field is no longer relevant in user-visible
   guidance.

4. **`platform/services/statecraft/CLAUDE.md`**: update the
   scaffold-warmup paragraph in the "Factory project scaffold"
   section to reference `scaffold_source_id` instead of
   `template_remote`.

5. **Test:** existing readiness tests updated; one new test asserts
   the response no longer carries `hasTemplateRemote`.

**Phase 3 exit criterion:** All AC-1 through AC-7 in spec.md §6 pass.

## Test strategy

- **Unit (Vitest):** `oapNativeSanitise.ts`, projection helpers,
  manifest-builder pure functions.
- **Integration (encore test):** translator round-trip, projection
  output shape, `scaffoldReadiness` API response, `create.ts`
  pre-flight, scheduler resolver, migration 36 idempotence.
- **Coupling gate:** the `implements:` list on spec 140 covers every
  production file touched; the spec 127/130/133 coupling check should
  pass without warnings against the post-implementation tree.
- **Manual smoke (browser):** open `/app/projects/new` against a
  freshly-synced org and confirm the form unlocks; force a
  `stale-adapter-manifest` blocker by truncating substrate and
  confirm the banner copy renders without the legacy parenthetical.

## Risks and rollback

- **Migration 36 writes one row per org.** Rollback: delete the rows
  via a manual SQL or the future `36_..._down.sql`. The downstream
  reads tolerate the absence (the projection's template-origin
  synthetic still emits, but with the new manifest field shape after
  Phase 1).

- **Spec 108 wire shape change.** `template_remote` disappears from
  the manifest object inside `/api/factory/adapters` responses.
  External consumers today: zero (only statecraft itself). Rollback
  cost: revert the projection.ts change, no DB rollback needed.

- **Scheduler flakiness.** The new resolver issues one extra DB query
  per adapter checked. The cron runs every 30 minutes; query is on a
  composite-PK index. Rollback: revert `scheduler.ts`; the warmup
  fallback to in-memory walk is preserved in git history.

## Constitution re-check (post-implementation)

To be filled at end of Phase 3 — confirm all six bullets in
"Constitution Check" still hold and no new violations were introduced
during implementation.
