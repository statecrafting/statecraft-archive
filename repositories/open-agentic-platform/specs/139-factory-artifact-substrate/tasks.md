---
description: "Task list for spec 139 — factory artifact substrate"
---

# Tasks: Factory Artifact Substrate

**Input**: `specs/139-factory-artifact-substrate/spec.md` + `plan.md`
**Prerequisites**: `plan.md` (required), `spec.md` (required for §-anchors)

**Tests**: included — substrate is a load-bearing data primitive; every
phase ships with the test types named in `plan.md` "Test strategy"
sections (round-trip, migration dry-run, integration, replay).

## Format: `[ID] [P?] [Phase] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Phase]**: Maps to `plan.md` phase (P0–P4)
- File paths in descriptions are exact

## Path Conventions

- Statecraft API: `platform/services/statecraft/api/`
- Statecraft web: `platform/services/statecraft/web/`
- Statecraft DB: `platform/services/statecraft/api/db/`
- Factory engine (Rust): `crates/factory-engine/`
- Factory contracts (Rust): `crates/factory-contracts/`
- OPC desktop: `product/apps/opc/src-tauri/src/commands/`

---

## Phase 0: Setup + Investigation (Foundational)

**Purpose**: Surface unknowns before committing to row schemas. Per
`plan.md` §Phase 0, the four decisions D-1..D-4 are recorded in
`specs/139-factory-artifact-substrate/research.md` before any
implementation task starts.

- [ ] T001 [P0] Confirm spec 139 frontmatter compiles cleanly:
      `./tools/spec-spine/spec-compiler/target/release/spec-compiler compile`
      and verify exit 0 + spec 139 appears in
      `.derived/spec-registry/registry.json`.
- [ ] T002 [P0] Walk `legacy-factory@<latest>` and
      `template@<latest>` end-to-end. For every file: classify by §4.2
      kind; record frontmatter quirks; record bundle candidates per
      §4.3. Output to
      `specs/139-factory-artifact-substrate/research.md` §1.
- [ ] T003 [P0] Audit prod `agent_catalog` content (read-only query).
      Confirm every row has populated `frontmatter`, `body_markdown`,
      `content_hash`. List nulls/edge-cases. Output to `research.md`
      §2.
- [ ] T004 [P0] Audit OAP-native adapter content
      (`next-prisma`, `rust-axum`, `encore-react`). Validate
      `manifest.yaml` parses; every `agents/*.md` has `id` frontmatter;
      every `patterns/**/*.md` is well-formed. List references to
      non-existent dependencies. Output to `research.md` §3.
- [ ] T005 [P0] Audit factory-engine filesystem access. Read
      `crates/factory-engine/src/lib.rs` and surrounding modules; list
      every call site that hard-codes a filesystem read outside a
      `factory_root: PathBuf` argument. Output to `research.md` §4.
- [ ] T006 [P0] Record decisions in `research.md`:
      D-1 final kind taxonomy (any additions to §4.2);
      D-2 bundle inventory (full predicate list);
      D-3 sample-html routing confirmed;
      D-4 ingest-verbatim vs sanitised for OAP-native adapter content.

**Checkpoint**: `research.md` exists with §§1-4 and the four decisions.
**Phase 1 cannot start until this checkpoint clears.**

---

## Phase 1: Substrate online, dual-write

**Purpose**: Land the substrate, the verbatim sync, and the projection.
Spec 108's external API surface continues to serve byte-identical
responses.

### Tests for Phase 1

> **NOTE: Write these tests FIRST and ensure they FAIL before
> implementation.**

- [ ] T010 [P] [P1] Round-trip parity test in
      `api/factory/projection.test.ts`: walk a fixture upstream → run
      the new translator into substrate → run projection → assert
      output JSONB equals the legacy translator's output for the same
      fixture. Locks the no-consumer-break invariant.
- [ ] T011 [P] [P1] Property test in `api/factory/substrate.test.ts`:
      for any sequence of (sync, override, sync, …) ops, assert
      `effective_body == coalesce(user_body, upstream_body)` and
      `conflict_state ∈ {null, 'ok', 'diverged'}`. Use small-step
      arbitraries.
- [ ] T012 [P] [P1] Integration test in
      `api/factory/conflicts.test.ts`: simulate upstream change after
      user override; assert `conflict_state='diverged'` and
      `user_body` untouched.
- [ ] T013 [P] [P1] API test in `api/factory/artifacts.test.ts`:
      `GET /api/factory/artifacts?kind=…` paginates and filters
      correctly; `GET /api/factory/artifacts/by-path` returns
      effective body and content_hash.

### Implementation for Phase 1

- [ ] T020 [P1] Create migration
      `api/db/migrations/NN_factory_artifact_substrate.up.sql` (and
      `.down.sql`): `factory_artifact_substrate`, `factory_artifact_substrate_audit`,
      `factory_bindings`. Generalise `factory_upstreams` (add
      `source_id`, `role`, `subpath`; legacy
      `factory_source`/`template_source` remain nullable).
      `effective_body` is a generated stored column.
- [ ] T021 [P1] Add Drizzle schema declarations in
      `api/db/schema.ts` for the three new tables and the
      `factory_upstreams` extensions. Mirror `FactoryArtifact*` types.
      Bump shared `SUBSTRATE_VERSION` const in
      `api/factory/substrate.ts` (NEW file).
- [ ] T022 [P1] Mirror `SUBSTRATE_VERSION` in
      `crates/factory-engine/src/substrate_version.rs` (NEW). Compile-time
      const per project memory; mismatches must fail at build.
- [ ] T023 [P1] Rewrite `api/factory/translator.ts` from the
      categorical projection into a verbatim walker:
      per-file → compute kind/frontmatter/content_hash → emit
      substrate row. Old function signatures preserved or
      re-implemented; remove the `requirements.{system,service,client}`
      bucket synthesis entirely.
- [ ] T024 [P1] Rewrite `api/factory/syncPipeline.ts` to drive the
      substrate transactionally per `spec.md` §5: clone → walk →
      per-row decision (no-row / fast-forward / no-op /
      mark-diverged) → prune to retired → stamp upstream sync state.
      All in one `db.transaction(...)`.
- [ ] T025 [P1] Implement `api/factory/projection.ts` (NEW):
      builds the legacy `factory_adapters`/`factory_contracts`/
      `factory_processes` JSONB shapes by SELECT-ing from substrate.
      `browse.ts` continues to serve from the projection — no API
      contract change.
- [ ] T026 [P1] Implement new endpoints in `api/factory/artifacts.ts`
      (NEW): `GET /api/factory/artifacts` (kind-filtered, paged);
      `GET /api/factory/artifacts/by-path`;
      `GET /api/factory/artifacts/:id`;
      `POST /api/factory/artifacts/:id/override`;
      `DELETE /api/factory/artifacts/:id/override`.
- [ ] T027 [P1] Implement conflict endpoints in
      `api/factory/conflicts.ts` (NEW):
      `GET /api/factory/artifacts/conflicts`;
      `POST /api/factory/artifacts/:id/resolve` with body
      `{ action: 'keep_mine' | 'take_upstream' | 'edit_and_accept',
        body?: string }`. Edit-and-accept may be deferred to Phase 2 —
      Phase 1 ships keep-mine + take-upstream only.
- [ ] T028 [P1] Implement `api/factory/bindings.ts` (NEW):
      `POST /api/factory/bindings` (create);
      `GET /api/factory/bindings?project_id=…` (list);
      `DELETE /api/factory/bindings/:id` (unbind).
      Reuses spec 123 invariants I-B1..I-B4 verbatim.
- [ ] T029 [P1] Generalise `api/factory/upstreams.ts` to N-per-org
      with role/subpath. Legacy `factory_source`/`template_source`
      reads handled by a compatibility branch that also writes the
      new `source_id` rows on next save.
- [ ] T030 [P1] Web route `web/app/routes/app.factory.artifacts.tsx`
      (NEW): kind filter, list view, detail drawer with override
      editor (textarea in Phase 1; CodeMirror merge view in Phase 2),
      conflict list pane.
- [ ] T031 [P1] Audit `factory_artifact_substrate_audit` writes from every
      handler that mutates a row. Action enum per `spec.md` §6.4.
- [ ] T032 [P1] Add `amendment_record:` back-links to specs 108, 111,
      123 frontmatter — pointing to spec 139. Lands in this same PR
      so the spec 127/130/133 coupling gate sees the amender. **Per
      project memory: governance docs land in the same PR as spec
      activation. CONST-005 trigger check: this is amendment back-fill,
      not drift engineering — explicit `amends:` declared up-front.**

**Checkpoint (Phase 1)**: round-trip parity test green; spec 108 API
endpoints serve byte-identical responses; `/api/factory/artifacts/*`
functional; conflict UI lists divergent rows. Substrate is
authoritative underneath, projection on top.

---

## Phase 2: Migrate `agent_catalog` and OAP-native adapters

**Purpose**: Move spec 111/123 content into the substrate; ingest the
three OAP-native adapters; light up the symmetric `scaffold_source_id`
gate.

### Tests for Phase 2

- [ ] T040 [P] [P2] Migration dry-run test in
      `api/db/migrations/NN_migrate_agent_catalog.dryrun.test.ts`:
      snapshot `agent_catalog`/`agent_catalog_audit`/
      `project_agent_bindings`; run migration in-memory; assert every
      source row has a corresponding substrate row with byte-equal
      content_hash and frontmatter.
- [ ] T041 [P] [P2] E2E test in
      `api/agents/dispatch.test.ts`: a project that today binds an
      org agent at v3 continues to dispatch successfully through the
      substrate-backed binding (`factory_bindings` table).
- [~] T042 [P] [P2] RETIRED 2026-06-27. E2E test in
      `api/projects/scaffold/createOapNative.test.ts`: `next-prisma`
      is selectable; submit produces a clear "no scaffold source
      configured" blocker; once a scaffold source is registered,
      Create succeeds end-to-end.
      Retired: the OAP-native adapter concept (and `next-prisma`) is dead;
      factory-encore + template-encore are OAP's native factory
      implementation. The test file was deleted.

### Implementation for Phase 2

- [ ] T050 [P2] Create migration
      `api/db/migrations/NN_migrate_agent_catalog.up.sql`:
      idempotent INSERT mapping every `agent_catalog` row to a
      `factory_artifact_substrate` row with `origin='user-authored'`,
      `kind='agent'`, `path='user-authored/' || name || '.md'`. Carry
      `frontmatter`, `body_markdown` → `user_body`, `content_hash`,
      `version`, `status`, timestamps. Upstream columns NULL.
- [ ] T051 [P2] Migration: `agent_catalog_audit` rows → 
      `factory_artifact_substrate_audit` with mapped `action` values.
      Original timestamps preserved.
- [ ] T052 [P2] Migration: `project_agent_bindings` rows →
      `factory_bindings` (verbatim columns; `org_agent_id` →
      `artifact_id` resolved via the substrate row inserted in T050).
- [ ] T053 [P2] Re-point `api/agents/*` handlers at the substrate.
      Filter to `origin='user-authored'`. Public API surface
      unchanged. `agent_catalog` table remains in the schema but
      nobody reads from it.
- [ ] T054 [P2] OAP-native adapter ingestion. Per decision D-4 from
      Phase 0: ingest `next-prisma`, `rust-axum`, `encore-react`
      content into substrate rows under `origin='oap-self'`,
      `path='adapters/<name>/<rel>'`. Idempotent — running twice
      produces no duplicates.
- [ ] T055 [P2] Adapter manifest format extension. Add
      `orchestration_source_id` and `scaffold_source_id` fields.
      `acme-vue-node` carries `legacy-factory` /
      `acme-vue-node-template`. The three OAP-native adapters carry
      their `oap-*` source ids. Validate via translator on next sync.
- [ ] T056 [P2] Extend `api/projects/scaffoldReadiness.ts` with
      per-adapter eligibility verdict including
      `scaffold_source_resolved: bool`. The current spec 112 §5.4
      silent-reject path is removed.
- [ ] T057 [P2] Web Create form: surface the per-adapter blocker. The
      adapter picker shows readiness state per option; submit on a
      not-ready adapter shows the blocker with action link.
- [ ] T058 [P2] Edit-and-accept conflict resolution UI in
      `web/app/components/artifact-merge-editor.tsx` (NEW). Use
      CodeMirror 6 merge view (license check first). Wire to
      `POST /api/factory/artifacts/:id/resolve` with
      `action: 'edit_and_accept'`.

**Checkpoint (Phase 2)**: All four adapters Create-eligible. Existing
org-agent flows function with no UI surface change. Audit log shows
artifact-level lifecycle for every artifact, including for spec 111
content (now in substrate).

---

## Phase 3: OPC virtual factory_root

**Purpose**: Close spec 108 §7.1. OPC factory runs use the platform
substrate as their `factory_root`; recorded runs replay reproducibly.

### Tests for Phase 3

- [ ] T060 [P] [P3] `cargo test` for `VirtualRoot` in
      `crates/factory-engine/tests/virtual_root.rs` against a mock
      HTTP server (wiremock or similar).
- [ ] T061 [P] [P3] Replay test in
      `crates/factory-engine/tests/run_replay.rs`: a recorded
      factory run with `artifact_ref` entries replays through
      `VirtualRoot` and produces byte-identical prompt strings.
- [ ] T062 [P] [P3] Offline test: pre-populate the cache; assert
      `VirtualRoot` operates without network reachability.

### Implementation for Phase 3

- [ ] T070 [P3] Lift `factory_root: PathBuf` to
      `enum FactoryRoot { Filesystem(PathBuf), Virtual(VirtualRoot) }`
      in `crates/factory-engine/src/factory_root.rs` (NEW). Existing
      filesystem-variant call sites continue to compile.
- [ ] T071 [P3] Implement `crates/factory-engine/src/virtual_root.rs`
      (NEW): HTTP client over `/api/factory/artifacts/by-path` and
      `/api/factory/artifacts?fields=…`. Cache to
      `~/.cache/oap/factory/<org>/<content_hash>`. Cache key is
      `(org_id, artifact_id, content_hash)`; integrity-check on
      read (recompute hash, fail loudly on mismatch).
- [ ] T072 [P3] Migrate `product/apps/opc/src-tauri/src/commands/factory.rs`:
      replace `resolve_factory_root()` with `FactoryRoot::Virtual(...)`.
      Delete the `// TODO(spec-108-§7-punt)` marker comment.
- [ ] T073 [P3] Spec 124 generalisation. Add `artifact_ref`
      `{ artifact_id, version, content_hash }` shape to
      `crates/factory-contracts/src/run.rs` (or the equivalent
      module) alongside the existing `agent_ref`. Encore handlers
      accept both for one release.
- [ ] T074 [P3] Update `factory_runs.stage_progress` writers to emit
      `artifact_ref` going forward. Encore handlers in
      `api/factory/runDuplexHandlers.ts` accept both shapes during
      the migration window.

**Checkpoint (Phase 3)**: OPC ships with no local-checkout dependency.
The §7-punt TODO is gone. Recorded runs replay reproducibly online and
offline (cache-warm).

---

## Phase 4: Retire legacy

**Purpose**: Drop the projection and the legacy tables. No consumer
regression.

### Tests for Phase 4

- [ ] T080 [P] [P4] Schema-diff assertion test: snapshot Phase 3
      end-state schema; run Phase 4 migration; assert only the listed
      tables/columns dropped.
- [ ] T081 [P] [P4] Full E2E suite from specs 108, 111, 123 acceptance
      scenarios passes against the substrate-only state. (Pull each
      spec's acceptance criteria; assert green.)

### Implementation for Phase 4

- [ ] T090 [P4] Read-shadow logging in `api/factory/browse.ts`: log
      every read against the legacy tables. Bake for one release
      (≥ 14 days in prod) with zero reads recorded before proceeding.
- [ ] T091 [P4] Replace `api/factory/browse.ts` with substrate-direct
      reads. Remove `api/factory/projection.ts`. API response shapes
      preserved.
- [ ] T092 [P4] Codebase grep for `factory_adapters`,
      `factory_processes`, `factory_contracts`, `agent_catalog`,
      `agent_catalog_audit`, `project_agent_bindings` in non-test
      code. Require zero hits before proceeding.
- [ ] T093 [P4] Migration
      `api/db/migrations/NN_drop_legacy_factory_tables.up.sql`:
      `DROP TABLE factory_adapters, factory_contracts,
      factory_processes, agent_catalog, agent_catalog_audit,
      project_agent_bindings`. Drop `factory_upstreams.factory_source`
      and `factory_upstreams.template_source` columns.
- [ ] T094 [P4] Spec 108 implementation-audit gets a section
      "§3 superseded by 139" with link. Spec 111 and 123 get the
      equivalent.
- [ ] T095 [P4] CLAUDE.md sweep: root, `platform/`, and
      `platform/services/statecraft/` get the new substrate model
      reflected. The "Factory tables" listing in
      `platform/CLAUDE.md` updated. Per project memory: governance
      docs land in the activation PR.
- [ ] T096 [P4] Flip spec 139 lifecycle: `status: approved`,
      `implementation: complete`, `closed: <YYYY-MM-DD>`, add
      `implements:` block listing the touched paths. Run
      `spec-compiler compile` and verify exit 0 + correct status.

**Checkpoint (Phase 4)**: Substrate is the only store. SC-001..SC-006
measurable and green.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 0 (Setup + Investigation)**: Blocks all other phases.
  Decisions D-1..D-4 must be recorded in `research.md`.
- **Phase 1 (Substrate online)**: Depends on Phase 0. Cannot proceed
  until round-trip parity test (T010) is written and the substrate's
  schema is locked.
- **Phase 2 (Migrate)**: Depends on Phase 1 substrate being
  authoritative and projection green. Cannot proceed if Phase 1's
  no-consumer-break invariant has any failing assertion.
- **Phase 3 (OPC virtual root)**: Depends on Phase 2 ingestion of
  OAP-native adapters (otherwise OPC's adapter list is incomplete).
- **Phase 4 (Retire legacy)**: Depends on Phases 1–3 + a full release
  bake of zero legacy reads from T090.

### Within Each Phase

- Tests written first; verified failing before implementation.
- Migration before handler changes (handlers depend on tables).
- Handlers before web routes (UI depends on API).
- Audit-log writes added alongside every mutation handler — not
  retrofitted later.

### Parallel Opportunities

- All [P] tasks within a phase can run in parallel.
- Phase 0 audits T002/T003/T004/T005 are independent — fully parallel.
- Phase 1 tests T010-T013 are independent — parallel.
- Phase 1 implementation tasks T020-T031 mostly serialise on schema +
  translator; T026/T027/T028/T030 are parallel after T021.
- Phase 2 backfills T050/T051/T052 are sequential (foreign-key
  ordering); T054 is parallel with the agent_catalog migration.

---

## Halt Conditions

Halt and consult before proceeding if:

- Phase 0 research surfaces ≥ 3 kind-taxonomy gaps. The §4.2 enum may
  need substantive redesign before Phase 1.
- Phase 1 round-trip parity test cannot be made green for more than
  one fixture file (suggests the legacy translator's output is
  non-deterministic or the projection's mapping is incomplete).
- Phase 2 backfill dry-run reports ≥ 1% data divergence between
  source `agent_catalog` rows and target `factory_artifact_substrate` rows.
- Phase 3 replay test produces non-byte-identical prompts. The
  reproducibility guarantee (SC-003, SC-005) is the spec's load-bearing
  audit primitive — non-negotiable.
- Phase 4 read-shadow records any read against legacy tables in the
  bake window. Investigate, fix, restart bake.

Per `.claude/rules/orchestrator-rules.md` Rule 4 (halt on failure):
treat any halt as a stop point requiring user direction, not a
retry-with-tweak loop.

---

## Notes

- Each phase's tests live alongside the code they test (Encore.ts
  convention).
- Migrations are idempotent and reversible (every `up.sql` has a
  `down.sql`).
- Per project memory: confirm before deleting credentials —
  `factory_upstream_pats` is read-only across all phases.
- Per project memory: schema versions are compile-time consts —
  `SUBSTRATE_VERSION` lives in TS + Rust simultaneously.
- Per project memory: governance docs land in the same PR as spec
  activation — Phase 4's T094/T095/T096 close the loop.
- CONST-005 / CONST-005-spec-code-coherence: this spec amends three
  live specs explicitly via `amends:` frontmatter; back-links land in
  Phase 1 T032. No back-dated edits to satisfy a gate; no spec edited
  to make this PR pass.
