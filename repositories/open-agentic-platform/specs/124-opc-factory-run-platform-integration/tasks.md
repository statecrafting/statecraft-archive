# Tasks: OPC Factory-Run Platform Integration

**Input**: `/specs/124-opc-factory-run-platform-integration/`
**Prerequisites**: spec.md, plan.md
**Phases**: 0 (Foundations) → 1 (Schema) → 2 (API) → 3 (Duplex) → 4 (Platform client crate) → 5 (OPC migration) → 6 (Sweeper) → 7 (UI) → 8 (Closure)

Tasks are grouped by phase per `plan.md`. `[P]` = can run in parallel with other `[P]` tasks in the same phase. Each phase ends with a checkpoint that gates the commit.

---

## Phase 0 — Foundations

Shared types + constants. Blocks every later phase.

- [ ] **T001** Reserve the migration slot at `platform/services/statecraft/api/db/migrations/31_create_factory_runs.up.sql` (header comment + empty body). Phase 1 fills it.
- [ ] **T002** [P] Add the `factory.run.*` envelope kinds to the shared envelope-type module:
  - `FactoryRunStageStarted`, `FactoryRunStageCompleted`, `FactoryRunCompleted`, `FactoryRunFailed`, `FactoryRunCancelled` per spec §6.1.
  - Compile-time const `FACTORY_RUN_ENVELOPE_VERSION: 1`. Mirror in Rust types if `crates/factory-contracts` is the duplex shared crate; mismatched desktop / platform builds fail at type-check.
- [ ] **T003** [P] Source-shas agent triple. Spec 123 shipped `crates/factory-contracts/src/agent_reference.rs` (`AgentReference` enum: `ById | ByName | ByNameLatest`) and `crates/factory-engine/src/agent_resolver.rs` (`ResolvedAgent { org_agent_id, version, content_hash, frontmatter, body_markdown }`). Spec 124 does NOT introduce a separate `AgentRef` type: the `source_shas.agents[]` rows are derived by projecting `ResolvedAgent` to `{ org_agent_id, version, content_hash }` at reservation time. On the TypeScript side, declare a single `FactoryAgentRef = Pick<…>` shape in `platform/services/statecraft/api/factory/runs.ts` matching the projected fields by name. CI gate (T088 in Phase 8) asserts the projection compiles against the live `ResolvedAgent`.
- [ ] **T004** [P] Add audit-action strings: `factory.run.reserved`, `factory.run.completed`, `factory.run.failed`, `factory.run.cancelled`, `factory.run.swept`. The actor for `factory.run.reserved` is the user; for `factory.run.swept` it is the system user (spec 119 `2_seed_system_user`).
- [ ] **T005** [P] Cache-root layout helper. Add a small pure helper in `crates/factory-platform-client` (Phase 4 will own this crate; Phase 0 just lays out the path-shaping module): `cache_root_for(source_shas) -> PathBuf` returning `$XDG_CACHE_HOME/oap-factory/<short_run_sha>/`. Unit-tested.
- [ ] **T006** [P] OIDC desktop-client wiring confirmation. Verify `product/apps/opc/src-tauri/src/auth/` has the access-token getter that the platform client (Phase 4) will use; if missing, add a thin wrapper. No new tokens issued; reuse spec 106/107 plumbing.

**Checkpoint:** `npx tsc --noEmit` in `platform/services/statecraft` passes; `cargo check` at the workspace root passes; the new envelope types serialise round-trip in a unit test. Commit: `chore(spec-124): foundations — envelope types, audit actions, cache-root helper`.

---

## Phase 1 — Schema migration

`factory_runs` table only. No churn against existing rows; spec 123's `30` runs first.

- [ ] **T010** In `31_create_factory_runs.up.sql`, write the table DDL per spec §3:
  ```sql
  CREATE TABLE factory_runs (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      org_id UUID NOT NULL REFERENCES organizations(id),
      project_id UUID REFERENCES projects(id),
      triggered_by UUID NOT NULL REFERENCES users(id),
      adapter_id UUID NOT NULL REFERENCES factory_adapters(id),
      process_id UUID NOT NULL REFERENCES factory_processes(id),
      status TEXT NOT NULL,
      stage_progress JSONB NOT NULL DEFAULT '[]',
      token_spend JSONB,
      error TEXT,
      source_shas JSONB NOT NULL,
      started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      completed_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  ```
- [ ] **T011** Add CHECK constraint enforcing `status IN ('queued','running','ok','failed','cancelled')`.
- [ ] **T012** Indexes: `(org_id, started_at DESC)` for run history; partial index on `(org_id) WHERE status IN ('queued','running')` for in-flight view. Both per spec §3.
- [ ] **T013** Migration ordering guard: at the top of `31_create_factory_runs.up.sql`, add a SQL `DO $$ ... RAISE EXCEPTION ... END $$;` block that fails if `agent_catalog.org_id` does not exist (spec 123 migration 30 must have run). Documents the dependency and aborts loud on out-of-order application.
- [ ] **T014** [P] Update `platform/services/statecraft/api/db/schema.ts` Drizzle definitions: add `factoryRuns` table mirroring the SQL DDL; export it.
- [ ] **T015** [P] Write `31_create_factory_runs.down.sql`: `DROP TABLE factory_runs CASCADE;`. Migration symmetry; document that any test rows are lost.
- [ ] **T016** [P] In-DB tests: apply the migration against a dev DB seeded with one organization, one project, one adapter, one process. Assert table exists; assert FK CASCADE/RESTRICT semantics by deleting the project (CASCADE-ed `factory_runs` row gone) and attempting to delete the adapter (rejected — RESTRICT, since spec 124 §3 doesn't specify; default Postgres FK is NO ACTION which is functionally equivalent here, accept either).

**Checkpoint:** Migration applies cleanly on top of spec 123's `30`. Reverse-migration applies cleanly. The Drizzle schema and the SQL agree (no diff after `npx drizzle-kit generate`). Commit: `feat(statecraft, spec-124): schema migration 31 — factory_runs table`.

---

## Phase 2 — Statecraft API

`api/factory/runs.ts` is the only mutation REST surface (the reservation); reads are list + detail.

- [ ] **T020** Create `platform/services/statecraft/api/factory/runs.ts`:
  - `POST /api/factory/runs` — body `{ adapter_name, process_name, project_id?, client_run_id }`. Resolves `adapter_id` and `process_id` from `factory_adapters` / `factory_processes` by `(org_id, name)`. Validates the project (if provided) belongs to the caller's org. Idempotent on `client_run_id`: if a row already exists with that client id, return its current state. Inserts the row in `status: 'queued'` and writes `source_shas` from the resolved IDs + agent triples — the latter computed by walking the process definition for `AgentReference` instances (`crates/factory-contracts/src/agent_reference.rs`); for `ById`/`ByName(version)` references, look up the catalog row directly; for `ByNameLatest`, pick the highest published version. If `project_id` is provided, prefer the version pinned in `project_agent_bindings` over the process's declared `ByNameLatest`; reject the reservation if any binding is `retired_upstream` (spec 123 invariant I-B3). Returns `{ run_id, source_shas }`.
  - `GET /api/factory/runs?status=&adapter=&limit=&before=` — list runs for the caller's org, default 50 newest first, accept status / adapter filter, cursor pagination by `started_at`.
  - `GET /api/factory/runs/:id` — single run. 404 if foreign org. Returns the full row including `stage_progress`.
- [ ] **T021** [P] `runs.test.ts` — happy path reservation, idempotent reservation, foreign-org reject, retired-binding reject, list pagination, list filter combos, single-run 404 for foreign org. At least one test asserts `source_shas.agents[]` is populated when the process references agents.
- [ ] **T022** [P] Document the agent-refs resolver path (called from T020 reservation). It reads the process definition from `factory_processes` and walks for `agent_ref:` keys; for each, looks up `(org_agent_id, version, content_hash)` via spec 123's binding (or directly via `agent_catalog` for ad-hoc runs without a project). The resolver lives next to `runs.ts` (e.g. `api/factory/runAgentRefs.ts`); kept thin so the desktop's `agent_resolver` (spec 123) does the heavy lifting at run time.
- [ ] **T023** [P] Reservation idempotency: write a test that fires the same `client_run_id` twice in a hot loop; assert exactly one row created and both calls return the same `run_id`.

**Checkpoint:** `npx tsc --noEmit` and `npm test` in statecraft pass. The reservation endpoint covers the four canonical cases (new, idempotent-replay, foreign-org, retired-binding-reject). Commit: `feat(statecraft, spec-124): /api/factory/runs reservation + read endpoints`.

---

## Phase 3 — Duplex handlers

Catalog `factory.run.*` envelope kinds in the duplex registry; idempotent platform-side write path.

- [ ] **T030** In `platform/services/statecraft/api/sync/duplex.ts`, register the five `factory.run.*` envelope kinds (T002 types). Reject envelopes whose `org_id` does not match the duplex connection's auth identity.
- [ ] **T031** Implement the `factory.run.stage_started` handler:
  - Look up the run by `run_id` and verify `org_id` match.
  - If the matching `(stage_id, status: "running")` entry already exists in `stage_progress`, no-op (idempotent re-delivery).
  - Otherwise append `{ stage_id, status: "running", started_at, agent_ref }` to `stage_progress`; flip `factory_runs.status` from `queued` to `running` if it was queued.
- [ ] **T032** Implement `factory.run.stage_completed`: locate the matching `stage_progress` entry; update its `status` and `completed_at`; if no matching `stage_started` was seen (out-of-order delivery), append a synthesised entry rather than fail (defence in depth — at-least-once).
- [ ] **T033** Implement `factory.run.completed`: set `status = 'ok'`, `completed_at`, `token_spend` (the rolled-up totals from the desktop's per-stage observations); emit `factory.run.completed` audit row.
- [ ] **T034** Implement `factory.run.failed`: set `status = 'failed'`, `completed_at`, `error`; preserve partial `stage_progress` (do not overwrite); emit `factory.run.failed` audit row.
- [ ] **T035** Implement `factory.run.cancelled`: same shape as failed but `status = 'cancelled'`; `error` optional; emit `factory.run.cancelled` audit row.
- [ ] **T036** [P] Tests covering: in-order delivery; out-of-order delivery (stage_completed before stage_started); duplicate-event idempotency; foreign-org reject; envelope-version mismatch reject (a `v: 0` envelope is rejected with a clear error before any DB write).

**Checkpoint:** `npm test` passes including the new duplex handler tests. The four terminal-state events all leave `factory_runs` in a fully populated state. Commit: `feat(statecraft, spec-124): duplex handlers for factory.run.* envelopes`.

---

## Phase 4 — Platform client crate

A new lib crate `crates/factory-platform-client` so the desktop's command code stays thin.

- [ ] **T040** Scaffold `crates/factory-platform-client/Cargo.toml` with `[package.metadata.oap] spec = "124-opc-factory-run-platform-integration"`. Add to the workspace `crates/Cargo.toml`. Crate exports a single `PlatformClient` struct.
- [ ] **T041** Implement `PlatformClient::new(base_url, oidc_token_provider)`. The provider is a trait object whose desktop implementation reuses the spec 106/107 token plumbing. Tokens are refreshed by the provider, not by the client. The same struct also implements spec 123's `factory_engine::agent_resolver::CatalogClient` trait, so a single client instance can be passed both to spec 124's run pipeline and to `AgentResolver::new(org_id, Box::new(platform_client.clone()))`.
- [ ] **T042** Implement typed REST methods:
  - `get_adapter(name) -> Result<AdapterBody>`
  - `get_contract(name) -> Result<ContractBody>`
  - `get_process(name) -> Result<ProcessBody>`
  - `reserve_run(req) -> Result<RunReservation>` (POST /runs)
  - `get_run(id) -> Result<RunRow>`
  Each method retries idempotent GETs on transient errors; the reservation POST does NOT auto-retry (the server is idempotent on `client_run_id`, but the desktop should observe a conflict and decide what to do).
- [ ] **T043** Implement `materialise_run_root(reservation, agent_resolver) -> Result<RunRoot>`:
  - Computes the cache directory path from `reservation.source_shas` via T005's helper.
  - If the directory already exists with the expected SHAs, returns it (warm cache).
  - Otherwise writes the adapter, contracts, process bodies into the in-tree-shaped layout (`adapters/<name>/manifest.yaml`, `process/stages/...`, `contract/<name>.schema.json`).
  - For each agent reference in the process definition, builds an `AgentReference` (spec 123 `factory-contracts::agent_reference`) and calls `agent_resolver.resolve(reference)` (spec 123 `factory-engine::agent_resolver::AgentResolver`). Writes the resulting `ResolvedAgent.body_markdown` plus the YAML-serialised `frontmatter` (with frontmatter delimiters) into `process/agents/<role>.md` and `adapters/<adapter_name>/agents/<role>.md`. Cross-checks the resolved `(org_agent_id, version, content_hash)` triple against `reservation.source_shas.agents[]`; mismatches abort the materialisation (drift between server-side reservation and client-side resolver).
  - Returns `RunRoot { path, source_shas }`.
- [ ] **T044** [P] Unit tests against a mock HTTP server: cache-miss path materialises files; cache-hit path skips fetches; partial materialisation failure cleans up the temp dir (no half-built cache).
- [ ] **T045** [P] Add a thin `factory-platform-client` integration test that exercises the full path against a running statecraft on `localhost:4000` (skipped by default; gated on `OAP_INTEGRATION=1`).

**Checkpoint:** `cargo check` and `cargo test` pass for the new crate. Mock-server tests cover the warm/cold cache and partial-failure paths. Commit: `feat(crates, spec-124): factory-platform-client — typed REST + content-addressed cache`.

---

## Phase 5 — OPC migration

`commands/factory.rs` switches from the in-tree walk-up to the platform client. Deletes the spec 108 §7.1 punt marker.

- [ ] **T050** In `product/apps/opc/src-tauri/src/commands/factory.rs`, replace `resolve_factory_root()` and its callers with `materialise_run_root` from the platform client. The call signature changes from a sync `Result<PathBuf, String>` to `async Result<RunRoot, FactoryError>` — propagate the async out as needed (the existing Tauri command surface already supports async).
- [ ] **T051** Delete `resolve_factory_root` entirely (function body, callers' fallbacks, error string about "not found"). The `// TODO(spec-108-§7-punt)` marker goes with it.
- [ ] **T052** Replace the local `state.json` write with duplex emits:
  - On run start: `POST /api/factory/runs` (reservation) → emit `factory.run.stage_started` for the first stage.
  - Per stage: emit `factory.run.stage_started` and `factory.run.stage_completed` around the stage execution.
  - On terminal: emit `factory.run.completed` / `factory.run.failed` / `factory.run.cancelled` with the final `token_spend` rollup.
- [ ] **T053** Local replay queue. If the duplex connection drops, queue events on disk under `$XDG_DATA_HOME/oap/factory-run-events/<run_id>.ndjson`; on reconnect, replay in order. Bound the on-disk queue at 1000 events per run; if exceeded, mark the run failed locally and surface to the user.
- [ ] **T054** [P] Update the existing `list_factory_runs` Tauri command to read from the platform's `GET /api/factory/runs` instead of walking local `state.json` files. Local on-disk run cache becomes a per-run scratch directory only, not the source of truth for run history.
- [ ] **T055** [P] Retired-binding handling: spec 123's `ResolveError::RetiredAgent { org_agent_id, version }` is the typed signal returned by `AgentResolver::resolve` when the catalog row is retired. Before reservation, walk the process's agent refs through `agent_resolver`; map any `ResolveError::RetiredAgent` to a typed `FactoryError::RetiredAgent { agent_name, org_agent_id, version, project_id }` and surface a UI message that deep-links to the project's binding page (`/app/project/{id}/agents`). Server-side T020 enforces the same check by joining `project_agent_bindings.status = 'retired_upstream'`; client and server must agree on the rejection criteria.
- [ ] **T056** [P] Test: a desktop integration test that reserves a run, emits the full event sequence, and asserts the platform-side row reaches `status: 'ok'` with all stages recorded.

**Checkpoint:** `cargo check` for `product/apps/opc/src-tauri` passes; `cargo test` passes; `rg "factory/(adapters|contracts|process|upstream-map)" product/apps/opc` returns zero hits except inside test fixtures already documented under spec 108 §7. Commit: `feat(desktop, spec-124): commands/factory.rs runs against the platform; resolve_factory_root deleted`.

---

## Phase 6 — Sweeper

A cron that turns a stuck `running` row into `failed` after a timeout.

- [ ] **T060** Create `platform/services/statecraft/api/factory/runsScheduler.ts`. Modelled on `api/knowledge/scheduler.ts` (extraction-staleness-sweeper, spec 115). Cron interval: 60s.
- [ ] **T061** Implement `sweepStaleFactoryRuns()`:
  - Selects `factory_runs` where `status IN ('queued','running')` and `last_event_at < now() - <timeout>`.
  - Computes the per-run timeout as `max_stage_duration × 2` (default 30 minutes; configurable via `STATECRAFT_FACTORY_RUN_STALE_AFTER_SEC`).
  - Updates `status = 'failed'`, `error = 'sweeper: no events for <duration>'`, `completed_at = now()`.
  - Emits `factory.run.swept` audit row.
- [ ] **T062** [P] Tests: stale `running` row gets swept; freshly-active row is not swept; `queued` row past timeout is also swept (the desktop never followed through with the first stage_started).
- [ ] **T063** [P] Document the env knob in the statecraft `CLAUDE.md` under "Env knobs" alongside the spec 115 ones.

**Checkpoint:** Sweeper test suite passes. The cron is registered in the Encore service (no new infrastructure). Commit: `feat(statecraft, spec-124): runs staleness sweeper`.

---

## Phase 7 — UI

Runs tab + detail drawer on `/app/factory`. Live updates via duplex.

- [ ] **T070** Add `platform/services/statecraft/web/app/routes/app.factory.runs._index.tsx` (Runs tab list view):
  - Table with columns: status pill, queued/started time, duration, adapter, process, project (linked), trigger user.
  - Filters: status (multi-select), adapter (single-select), date range (default last 14 days).
  - Cursor pagination by `started_at`.
- [ ] **T071** Add `platform/services/statecraft/web/app/routes/app.factory.runs.$runId.tsx` (run detail):
  - Header: status, adapter, process, project link, trigger user, duration.
  - Stage progress list: each entry shows status pill + time + agent_ref short hash + (on hover) the resolved triple.
  - Token spend summary; error block when status is failed.
  - Live update: while `status IN ('queued','running')`, poll the duplex bridge for run-scoped envelopes and revalidate the loader on each.
- [ ] **T072** [P] Add the "Runs" tab to the Factory shell (`app.factory.tsx`): `{ to: "/app/factory/runs", label: "Runs", end: false }`. Order: Overview, Upstreams, Runs, Adapters, Contracts, Processes.
- [ ] **T073** [P] Loaders + actions wire to the new endpoints (`runs.ts`). Use the existing `lib/factory-api.server.ts` helpers; add new functions `listFactoryRuns`, `getFactoryRun`.
- [ ] **T074** [P] Tests / fixtures: a vitest case that renders the run detail with a mocked duplex stream and asserts the stage progress updates as events arrive.
- [ ] **T075** [P] Empty-state copy: zero runs returns a "no runs yet" placeholder pointing the operator to the desktop ("Trigger a run from the OAP desktop app to see it here.").

**Checkpoint:** `npx tsc --noEmit` and `npm test` pass. Manual smoke test: open `/app/factory/runs`, verify list renders; open a row, verify stage list. Commit: `feat(statecraft, spec-124): /app/factory Runs tab + detail`.

---

## Phase 8 — Closure

Acceptance gates A-1..A-9; spec lifecycle flip; final CI.

- [ ] **T080** Verify A-1: `commands/factory.rs` no longer references `resolve_factory_root`. `git grep` returns nothing.
- [ ] **T081** Verify A-2: `rg "factory/(adapters|contracts|process|upstream-map)" apps/ crates/` returns only the test-fixture skips documented under spec 108 §7.
- [ ] **T082** Verify A-3: `factory_runs` migration is recorded in `migrations/` and applied; the four duplex handlers (T031..T035) covered by integration tests against a real Postgres (`encore test`).
- [ ] **T083** Verify A-4: a factory run from the desktop produces a `factory_runs` row visible at `/app/factory/runs` before the first stage completes.
- [ ] **T084** Verify A-5: `make ci-schema-parity` treats `factory_runs` as a normal statecraft table (no special-casing). This is automatically true since `factory_runs` is not in the parity walker's allowlist; assert by running `make ci-schema-parity` post-migration (will only go green after spec 125 lands; until then this is documented as expected).
- [ ] **T085** Verify A-6: spec 108 §7.1 and §7.4 reference 124 (already done in spec 108 commit `7b430b4`).
- [ ] **T086** Verify A-7: migration filename is `31_create_factory_runs.up.sql` and applies cleanly on top of spec 123's `30`. Ordering guard from T013 fires correctly when run out-of-order against a DB that hasn't applied 30.
- [ ] **T087** Verify A-8: integration test in `runs.test.ts` reserves two runs against the same `(adapter, process)` for two different projects; asserts both reservations write identical `source_shas.agents[].content_hash` arrays.
- [ ] **T088** Verify A-9: `rg "agent_catalog" product/apps/opc/src-tauri/src/commands/factory.rs` returns zero hits. `rg "AgentRef" product/apps/opc/src-tauri/src/commands/factory.rs` shows it imported from spec-123's owning module, not redeclared. CI gate.
- [ ] **T089** Spec frontmatter flip: `status: draft → approved`, `implementation: pending → complete`, add `approved: <today>`. Append §11 Implementation Notes summarising what shipped per phase.
- [ ] **T090** `make registry` — recompile spec registry + codebase index. Must be clean (zero new diagnostics).
- [ ] **T091** `make ci` — final gate. Must be green (assumes spec 125 has landed first; if spec 125 is still in flight, document the expected schema-parity failure as carry-over).
- [ ] **T092** Commit: `feat(specs): mark spec 124 approved + complete; refresh registry`.

**Final checkpoint:** the punch list in spec §10 (A-1..A-9) is all green; `git log --oneline` shows the per-phase commit trail (one commit per Phase 0..7 + the lifecycle flip = nine commits).

---

## Halt conditions

Stop and report up — do NOT continue past these without surfacing:

- Migration `30` (spec 123) has not been applied to the target DB. `31` MUST run on top of it; the T013 guard aborts loud rather than silently.
- The `factory.run.*` envelope-version constant disagrees between desktop and platform. This is a build error, not a runtime issue, and indicates Phase 0 work was missed.
- `agent_resolver` returns ambiguous results (a process references an agent name resolvable to multiple bindings). Spec 123 § resolver tests cover this; if the resolver returns ambiguous, abort the reservation and surface to the user with the conflict list — do NOT pick one.
- Cache write contention causes silent partial materialisation. Phase 4's atomic-rename guard is the prevention; if it fails, halt and surface — do NOT proceed with a half-built cache.
- A schema-parity failure on `factory_runs`. Should not happen (the table has no Rust mirror), but if `make ci-schema-parity` complains, halt — the failure is informative.
