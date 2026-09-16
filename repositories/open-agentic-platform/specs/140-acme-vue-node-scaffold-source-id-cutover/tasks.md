---
description: "Task list for spec 140 — acme-vue-node manifest cutover to scaffold_source_id"
---

# Tasks: acme-vue-node Manifest Cutover to `scaffold_source_id`

**Input**: `specs/140-acme-vue-node-scaffold-source-id-cutover/spec.md` + `plan.md`
**Prerequisites**: `plan.md` (required), `spec.md` (required for §-anchors)

**Tests**: included — finishing the spec 139 §7.2 contract is a
data-shape change; every phase ships with tests asserting the new
shape and the absence of the legacy field.

## Format: `[ID] [P?] [Phase] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Phase]**: Maps to `plan.md` phase (P0–P3)
- File paths in descriptions are exact

## Path Conventions

- Statecraft API: `platform/services/statecraft/api/`
- Statecraft web: `platform/services/statecraft/web/`
- Statecraft DB: `platform/services/statecraft/api/db/`

---

## Phase 0: Pre-flight Investigation

**Purpose**: Confirm the assumptions in spec.md §2 match production
reality before writing any code. Per `plan.md` §Phase 0, findings are
inline in PR description if any deviation surfaces.

- [ ] T001 [P0] Confirm spec 140 frontmatter compiles cleanly:
      `./tools/spec-spine/spec-compiler/target/release/spec-compiler compile`
      and verify exit 0 + spec 140 appears as `kind: amendment`,
      `amends: ["139"]` in
      `.derived/spec-registry/registry.json` via
      `./tools/spec-spine/registry-consumer/target/release/registry-consumer show 140-acme-vue-node-scaffold-source-id-cutover`.
- [ ] T002 [P0] Verify `factory_upstreams` schema (composite-PK
      `(org_id, source_id)`, `role` enum admits `'orchestration'` /
      `'scaffold'`, `repo_url` / `ref` NOT NULL).
      → `platform/services/statecraft/api/db/schema.ts:759-785`.
- [ ] T003 [P0] Verify `OAP_NATIVE_ADAPTERS["acme-vue-node"]
      .scaffoldSourceId === "acme-vue-node-template"` in
      `platform/services/statecraft/api/factory/oapNativeSanitise.ts`.
      Grep production code for the literal `"acme-vue-node-template"`
      to confirm there are no other hardcoded copies.
- [ ] T004 [P0] Re-run the inventory grep from spec §1:
      `grep -rn "template_remote\|templateRemote"
      platform/services/statecraft --include='*.ts' --exclude='*.test.ts'`
      and confirm the five call sites (scaffoldReadiness,
      scheduler, templateCache, types, create) are exhaustive. List
      any test file that asserts the legacy field shape.
- [ ] T005 [P0] Read existing acme-vue-node substrate row(s) for the
      active org:
      `SELECT org_id, origin, path, kind FROM factory_artifact_substrate
       WHERE kind='adapter-manifest' AND path='adapters/acme-vue-node/manifest.yaml'`.
      Record whether migration 36 will be a no-op or an insert for
      that org.

**Checkpoint**: Spec 140 compiles; assumptions confirmed; production
inventory matches §1. Phase 1 cannot start until this checkpoint clears.

---

## Phase 1: Emit-side rewrite + migration

**Purpose**: Stop emitting `template_remote`. Start emitting
`scaffold_source_id` from both projection paths. Backfill existing
org substrate so deploy-time cutover requires no operator action.

### Tests for Phase 1

> **NOTE: Write these tests FIRST and ensure they FAIL before
> implementation.**

- [ ] T010 [P] [P1] Test:
      `platform/services/statecraft/api/factory/projection.test.ts`
      asserts `buildAdapter` output for acme-vue-node carries
      `scaffold_source_id: "acme-vue-node-template"`,
      `orchestration_source_id`, `scaffold_runtime: "node-24"`, and
      does NOT carry `template_remote` / `template_default_branch`.
- [ ] T011 [P] [P1] Test:
      `platform/services/statecraft/api/factory/projection.test.ts`
      asserts the de-dup priority — when both a template-origin
      synthetic and an `oap-self` `adapter-manifest` row exist for
      `acme-vue-node`, the `oap-self` row wins.
- [ ] T012 [P] [P1] Test:
      `platform/services/statecraft/api/factory/translator.test.ts`
      asserts the translator no longer writes `template_remote` into
      any row's projected manifest.
- [ ] T013 [P] [P1] Test (Encore):
      `platform/services/statecraft/api/db/migrations/36_aim_vue_node_manifest_cutover.test.ts`
      runs migration 36 twice; asserts second run is a no-op
      (identical row count + no audit row written by the second
      pass).

### Implementation

- [ ] T020 [P1] Rewrite `projection.ts::buildAdapter` (lines
      193-227): import
      `OAP_NATIVE_ADAPTERS["acme-vue-node"].scaffoldSourceId` from
      `oapNativeSanitise.ts`; emit `orchestration_source_id`,
      `scaffold_source_id`, `scaffold_runtime`; remove
      `template_remote` and `template_default_branch` writes.
- [ ] T021 [P1] Flip de-dup priority in `projection.ts:118`: when both
      template-origin synthetic and `oap-self` `adapter-manifest`
      exist for the same name, prefer the `oap-self` row.
- [ ] T022 [P1] Update `translator.ts` (lines 308, 355-356, 393, 414,
      751-752, 763, 970): drop the `templateRemote` option and its
      plumbing through `ProjectionInputs` / `AdapterEmit`.
- [ ] T023 [P1] Update `substrateBrowser.ts` (line 29): remove the
      `templateRemote` injection comment + plumbing if unused
      post-T022.
- [ ] T024 [P1] Author `api/db/migrations/36_aim_vue_node_manifest_cutover.up.sql`:
      one synthetic `oap-self` `adapter-manifest` row per distinct
      `org_id` in `factory_artifact_substrate`, at
      `path='adapters/acme-vue-node/manifest.yaml'`, carrying the
      §7.2-compliant body. Idempotent via
      `ON CONFLICT (org_id, origin, path, version) DO NOTHING`.
      Audit row written via the existing
      `factory_artifact_substrate_audit` trigger or explicit insert.
- [ ] T025 [P1] Run T010–T013 → green.

**Phase 1 exit:** A fresh `/factory-sync` against
`legacy-factory` + `acme-vue-node-template` produces
acme-vue-node adapter rows whose projected manifest contains
`scaffold_source_id` and does NOT contain `template_remote`. (AC-5.)

---

## Phase 2: Read-side rewrite

**Purpose**: Move every consumer of the legacy field to the new
indirected lookup via `factory_upstreams`.

### Tests for Phase 2

- [ ] T030 [P] [P2] New test:
      `platform/services/statecraft/api/projects/scaffold/scheduler.test.ts`
      covers `resolveWarmupContext`'s new branches:
      `"no-scaffold-source-id"` when no adapter declares the field,
      `"no-pat"` when the field is declared but PAT is missing,
      `"ok"` when both are present and `factory_upstreams` resolves.
- [ ] T031 [P] [P2] Test:
      `api/projects/scaffold/scaffold.test.ts` updated for the
      `WarmupContext` field rename
      (`templateRemote` → `scaffoldRepoUrl`,
      `defaultBranch` → `scaffoldRef`).
- [ ] T032 [P] [P2] Test (Encore):
      `api/projects/create.test.ts` asserts the `APIError.failedPrecondition`
      message references `scaffold_source_id`, not
      `template_remote`, when an adapter manifest lacks the field.

### Implementation

- [ ] T040 [P2] Rewrite `scaffold/scheduler.ts::resolveWarmupContext`
      (lines 46-89): walk projected adapters, read
      `manifest.scaffold_source_id`,
      `SELECT repo_url, ref FROM factory_upstreams
       WHERE org_id = ? AND source_id = ?`,
      derive `WarmupContext` from the result. Rename
      `WarmupResolution`'s `"no-template-remote"` arm to
      `"no-scaffold-source-id"`. Update the
      `messages` map in `reportUnresolvable` to reference spec 139 §7.2.
- [ ] T041 [P2] Rename `scaffold/templateCache.ts::WarmupContext.templateRemote`
      → `scaffoldRepoUrl`; `defaultBranch` → `scaffoldRef`. Update
      `runWarmup` and `startBackgroundRefresher` callers; touch the
      comment block at line 81.
- [ ] T042 [P2] Update `scaffold/types.ts`: remove
      `template_remote: string` from `ScaffoldRequest`. Audit callers
      in `perRequestScaffold.ts` to ensure the clone target is
      derived inside the service from the resolved `factory_upstreams`
      row.
- [ ] T043 [P2] Rewrite `api/projects/create.ts:145-175`: replace the
      direct `manifest.template_remote` read with the
      `factory_upstreams`-by-`scaffold_source_id` lookup. Update the
      `APIError.failedPrecondition` message to reference
      `scaffold_source_id`. Update the section-header comment at
      line 145.
- [ ] T044 [P2] Update `syncWorker.ts:142` inline comment to
      reference the new field.
- [ ] T045 [P2] Run T030–T032 → green; run full
      `npm test --prefix platform/services/statecraft` and ensure
      no regressions.

**Phase 2 exit:**
`grep -r template_remote platform/services/statecraft --include='*.ts' --exclude='*.test.ts'`
returns zero hits in production code (only schema/migration
historical comments remain). (AC-1.)

---

## Phase 3: Readiness fallback removal + banner copy + docs

**Purpose**: Drop the legacy fallback now that no manifest emits the
old field and no consumer reads it. Align UI copy and CLAUDE.md.

### Tests for Phase 3

- [ ] T050 [P] [P3] Test:
      `api/projects/scaffoldReadiness.test.ts` asserts the response
      no longer carries `hasTemplateRemote` (top-level or per-adapter)
      and that `createEligible` is solely a function of
      `scaffoldSourceResolved`.
- [ ] T051 [P] [P3] Test:
      `api/projects/scaffoldReadiness.test.ts` asserts the
      `stale-adapter-manifest` blocker fires only when no adapter
      declares `scaffold_source_id`, and the
      `no-scaffold-source-resolved` blocker fires when at least one
      declares but none resolve.

### Implementation

- [ ] T060 [P3] Rewrite `api/projects/scaffoldReadiness.ts`: delete
      `hasTemplateRemote` from `AdapterReadinessVerdict` and
      `ScaffoldReadinessResponse`. Delete the legacy-fallback branch
      in `createEligible`. Simplify the blocker resolution logic.
      Remove all comments referencing the "transition window" (lines
      33-37, 53-58, 62-64).
- [ ] T061 [P3] Update
      `web/app/lib/projects-api.server.ts:304`: drop
      `hasTemplateRemote` from `ScaffoldReadiness` type.
- [ ] T062 [P3] Update
      `web/app/routes/app.projects.new.tsx:655-670`: simplify the
      `stale-adapter-manifest` banner copy. Drop the parenthetical
      "(§7.2 replaced the legacy `template_remote`)" — once Phase 1
      + 2 land, the legacy field is no longer relevant in
      user-visible guidance. The banner reads: "Adapter manifest
      needs refreshing. Your existing factory adapter rows predate
      the spec 139 translator change and lack the `scaffold_source_id`
      field the scaffold layer needs. Visit /app/factory and trigger
      a sync — once it completes the warmup will start automatically
      and the form will unlock."
- [ ] T063 [P3] Update
      `platform/services/statecraft/CLAUDE.md`: in the "Factory
      project scaffold" section, change the scaffold-warmup
      paragraph to reference `scaffold_source_id` instead of
      `template_remote`. Update the phase-tracking note to call out
      spec 140's cutover.
- [ ] T064 [P3] Run T050–T051 → green; run full
      `encore test` and `npm test` and ensure no regressions.

**Phase 3 exit:** All AC-1 through AC-7 in spec.md §6 pass.

---

## Phase 4: Validation + spec close

**Purpose**: Verify acceptance criteria, refresh registries, mark
spec implementation complete.

- [ ] T070 [P4] Run `make ci` (fast local CI loop, spec 134/135).
      Confirm exit 0.
- [ ] T071 [P4] Run
      `./tools/spec-spine/spec-code-coupling-check/target/release/spec-code-coupling-check`
      and confirm spec 140's `implements:` list covers every touched
      production file with no warnings. (AC-7.)
- [ ] T072 [P4] Recompile spec registry + codebase index:
      `./tools/spec-spine/spec-compiler/target/release/spec-compiler compile`
      and `./tools/spec-spine/codebase-indexer/target/release/codebase-indexer compile && render`.
- [ ] T073 [P4] Smoke-test in browser: open `/app/projects/new`
      against a freshly-synced org and confirm the form unlocks.
      Force a `stale-adapter-manifest` blocker by truncating the
      org's substrate adapter rows and confirm the banner copy
      renders without the legacy parenthetical.
- [ ] T074 [P4] Update spec 140 frontmatter:
      `implementation: complete`, `closed: "<today>"`. Recompile
      registry. Confirm `registry-consumer status-report` reflects
      the change.
- [ ] T075 [P4] Update spec 139's `amendment_record` block in §11
      "post-close fixes" with a one-paragraph note pointing at spec
      140's closure (precedent: the SC-001 / SC-004 closure
      paragraphs).
- [ ] T076 [P4] Commit + open PR. Title:
      `feat(spec-140): acme-vue-node manifest cutover — scaffold_source_id replaces template_remote`.

**Phase 4 exit:** Spec 140 is `implementation: complete`; CI green;
PR open. The remaining work is review + merge.

---

## Acceptance criteria mapping

| AC | Tasks |
|---|---|
| AC-1 (no production reads of `template_remote`) | T040, T041, T042, T043, T044, T060 |
| AC-2 (single source for `scaffoldSourceId` literal) | T020 |
| AC-3 (`hasTemplateRemote` removed from API response) | T060, T061 |
| AC-4 (migration 36 idempotent) | T013, T024 |
| AC-5 (fresh sync emits new field) | T010, T020, T021, T025 (Phase 1 exit) |
| AC-6 (Create form gates on `scaffold_source_id` only) | T060, T062 |
| AC-7 (coupling gate clean) | T071 |

---

## Quick reference — key file:line anchors

| File | Lines | Phase | Action |
|---|---|---|---|
| `api/factory/projection.ts` | 116-120 | 1 | Flip de-dup priority |
| `api/factory/projection.ts` | 193-227 | 1 | Rewrite buildAdapter |
| `api/factory/translator.ts` | 308, 355-356, 393, 414, 751-752, 763, 970 | 1 | Drop templateRemote plumbing |
| `api/factory/substrateBrowser.ts` | 29 | 1 | Remove templateRemote comment |
| `api/factory/syncWorker.ts` | 142 | 2 | Update comment |
| `api/db/migrations/36_*.up.sql` | new file | 1 | Migration 36 |
| `api/projects/scaffold/scheduler.ts` | 46-89, 97 | 2 | Rewrite resolver + log strings |
| `api/projects/scaffold/templateCache.ts` | 81 + WarmupContext shape | 2 | Field rename |
| `api/projects/scaffold/types.ts` | 27 | 2 | Drop template_remote |
| `api/projects/create.ts` | 145, 166-175 | 2 | Rewrite resolver |
| `api/projects/scaffoldReadiness.ts` | 33-37, 53-58, 62-64, 90-105, 165-200 | 3 | Drop legacy fallback |
| `web/app/lib/projects-api.server.ts` | 304 | 3 | Drop hasTemplateRemote type field |
| `web/app/routes/app.projects.new.tsx` | 655-670 | 3 | Simplify banner |
| `platform/services/statecraft/CLAUDE.md` | "Factory project scaffold" section | 3 | Update field name |
