# Tasks: Agent Catalog Org-Rescope

**Input**: `/specs/123-agent-catalog-org-rescope/`
**Prerequisites**: spec.md, plan.md
**Phases**: 0 (Foundations) → 1 (Schema) → 2 (API) → 3 (Duplex) → 4 (Org UI) → 5 (Project UI) → 6 (Desktop) → 7 (Factory resolver) → 8 (Closure)

Tasks are grouped by phase per `plan.md`. `[P]` = can run in parallel with other `[P]` tasks in the same phase. Each phase ends with a checkpoint that gates the commit.

---

## Phase 0 — Foundations

Shared types and constants. Blocks every later phase.

- [ ] **T001** Create the migration file `platform/services/statecraft/api/db/migrations/30_agent_catalog_org_rescope.up.sql` (header comment + empty body for now). Phase 1 fills it; Phase 0 just reserves the slot.
- [ ] **T002** [P] Update `platform/services/statecraft/api/db/schema.ts` Drizzle definitions: add `orgId` column on `agentCatalog`, `agentCatalogAudit`, `agentPolicies`; mark `projectId` on those three as `// removed by spec 123` with the column kept temporarily for migration codegen until Phase 1 lands. Add new `projectAgentBindings` table per spec §4.4. Export both updated tables.
- [ ] **T003** [P] Add the new audit actions to whichever module enumerates audit-action strings: `agent.binding_created`, `agent.binding_repinned`, `agent.binding_unbound`. The existing `agent.catalog.*` actions (spec 111) remain valid post-rescope.
- [ ] **T004** [P] Bump duplex envelope schema-version constants. In `platform/services/statecraft/api/sync/types.ts` (and the matching Rust crate types in `crates/factory-contracts` or wherever envelope versions are tracked), add:
  - `AGENT_CATALOG_ENVELOPE_VERSION: 2` (was `1`)
  - `PROJECT_AGENT_BINDING_ENVELOPE_VERSION: 1` (new)
  Compile-time `const`; mismatched desktop/platform builds must fail at type-check, not runtime.
- [ ] **T005** [P] Add `code_aliases: ["AGENT_CATALOG_ORG"]` is already in spec 123 frontmatter. Verify the codebase-indexer picks it up by running `./tools/spec-spine/codebase-indexer/target/release/codebase-indexer compile` and confirming spec 123 lands in `.derived/codebase-index/index.json` with the alias.

**Checkpoint:** `npm run typecheck` in `platform/services/statecraft` passes; `cargo check` at the workspace root passes; spec compiler emits no errors. Commit message: `chore(spec-123): foundations — schema scaffolds, envelope version bump, audit actions`.

---

## Phase 1 — Schema migration

Single migration, all-or-nothing. The dedup-and-bind backfill is the load-bearing step.

- [ ] **T010** In `30_agent_catalog_org_rescope.up.sql`, write the `org_id` column additions per spec §4.1, §4.2, §4.3:
  - `ALTER TABLE agent_catalog ADD COLUMN org_id TEXT NOT NULL DEFAULT 'default';`
  - same for `agent_catalog_audit`
  - same for `agent_policies`
- [ ] **T011** Backfill `org_id` on each table by joining through `projects.id → projects.org_id`. Three `UPDATE … FROM projects` statements.
- [ ] **T012** Drop the `'default'` defaults; drop the `project_id` columns; drop the old constraints (`agent_catalog_project_id_name_version_key`, `agent_policies_project_id_slug_key`); rebuild as `(org_id, name, version)` and `(org_id, slug)` per spec §4.1, §4.3.
- [ ] **T013** Drop indexes `agent_catalog_proj_name_idx`, `agent_catalog_proj_status_idx`, `agent_catalog_audit_proj_idx`. Create `agent_catalog_org_name_idx (org_id, name)`, `agent_catalog_org_status_idx (org_id, status)`, `agent_catalog_audit_org_idx (org_id, created_at DESC)`.
- [ ] **T014** Create `project_agent_bindings` per spec §4.4 (full DDL: id, project_id FK CASCADE, org_agent_id FK RESTRICT, pinned_version, pinned_content_hash, bound_by, bound_at, UNIQUE (project_id, org_agent_id), two indexes).
- [ ] **T015** Pre-flight script (idempotent SQL inside the migration): `SELECT org_id, name, count(DISTINCT content_hash) FROM agent_catalog GROUP BY org_id, name HAVING count(DISTINCT content_hash) > 1`. If any rows return, RAISE EXCEPTION with the conflict list. Migration aborts; operator reconciles by hand and re-runs.
- [ ] **T016** Dedup-and-bind backfill: for each `(org_id, name, content_hash)` group, keep the row with the lowest `id` as canonical (call it the "kept" row). For every project that previously owned a row in that group, INSERT into `project_agent_bindings (project_id, org_agent_id, pinned_version, pinned_content_hash, bound_by, bound_at)` using the kept row's id+version+hash. Then DELETE the absorbed (non-kept) rows.
- [ ] **T017** Migration log table `agent_catalog_migration_30_log` (created in this migration): records for each absorption `{absorbed_id, kept_id, project_id_added_as_binding, content_hash, decided_at}`. Survives the migration (audit trail).
- [ ] **T018** [P] Write the corresponding `30_agent_catalog_org_rescope.down.sql` for migration symmetry — re-add `project_id`, drop `org_id`, drop `project_agent_bindings`. Note: down-migration is best-effort (binding fan-in cannot perfectly reverse; document this in the file header).
- [ ] **T019** Apply the migration against a fresh dev DB seeded by `platform/services/statecraft/api/db/seed.ts` plus a fixture that creates 2 projects in 1 org, each with the same-name agent at the same content_hash, and one project with a uniquely-named agent. Assert post-migration: 2 rows in `agent_catalog` (one shared, one unique), 3 rows in `project_agent_bindings` (2 sharing the dedup'd row, 1 for the unique one), zero rows in the migration log for "conflict".
- [ ] **T020** [P] Apply the migration against a fixture with deliberate cross-project divergence (same name, different content_hash). Assert: migration aborts with the conflict list, no schema changes persisted (transactional rollback).

**Checkpoint:** Migration applies cleanly against the canonical dev DB. Reverse-migration applies cleanly. The dedup test (T019) and the abort test (T020) both pass. `npm run typecheck` in statecraft passes (Drizzle schema and runtime align). Commit message: `feat(statecraft, spec-123): schema migration 30 — agent catalog rescoped to org with project bindings`.

---

## Phase 2 — Statecraft API rewrite

`api/agents/catalog.ts` becomes org-scoped; `api/agents/bindings.ts` is the new project-side surface.

- [ ] **T030** Rewrite `platform/services/statecraft/api/agents/catalog.ts` for org scope:
  - Banner comment updated to `* Spec 123: agents are org-scoped; projects consume via bindings.`
  - All endpoints move to `/api/orgs/:orgId/agents` per spec §5.1. List, get, create, patch, publish, retire, fork.
  - Replace `verifyProjectInOrg` with `verifyOrgAccess(orgId, auth.orgId)` (one-line — same org).
  - RBAC: read = any org member; publish/retire/fork = `org:agents:publish` OR `org:admin` (floor: `org:admin` if the new role isn't yet wired through grants).
  - All `project_id` references in the Drizzle queries become `org_id`.
- [ ] **T031** Create `platform/services/statecraft/api/agents/bindings.ts`:
  - `GET /api/projects/:projectId/agents` — list bindings (joined with `agent_catalog` for name/version/status display).
  - `POST /api/projects/:projectId/agents/bind` — body `{ org_agent_id, version }`. Validates: agent belongs to project's org; version exists; resolves to `content_hash` server-side; rejects if already bound; rejects if target version's status is `retired` (I-B3); inserts binding row; emits `agent.binding_created` audit; broadcasts the `project.agent_binding.updated` envelope (Phase 3 wires the broadcast).
  - `PATCH /api/projects/:projectId/agents/:bindingId` — body `{ version }`. Same validation; updates `pinned_version` + `pinned_content_hash`; emits `agent.binding_repinned` audit; broadcasts.
  - `DELETE /api/projects/:projectId/agents/:bindingId` — removes binding; emits `agent.binding_unbound` audit; broadcasts.
- [ ] **T032** [P] Delete the project-scoped agent CRUD endpoints from the old `catalog.ts` (POST/PATCH/publish/retire/fork at `/api/projects/:projectId/agents`). The `GET /api/projects/:projectId/agents` route now lives in `bindings.ts` per T031.
- [ ] **T033** [P] Update any internal callers of the removed endpoints. Likely sites: `api/factory/*`, `api/sync/*`, anywhere a Stage CD comparator path resolves an agent. Most should switch to "list bindings then load org agent definition." Phase 7 also touches the Factory side.
- [ ] **T034** [P] Test `catalog.test.ts` — port the existing project-scoped tests to org scope. Existing test file `platform/services/statecraft/api/agents/catalog.test.ts` at HEAD covers the project shape; rewrite to org URLs and `org_id` assertions.
- [ ] **T035** [P] Test `bindings.test.ts` (new file): bind / repin / unbind happy path; reject binding to a retired version; reject binding twice for same `(project_id, org_agent_id)`; reject binding to an agent in a different org.
- [ ] **T036** [P] Test integrity check: a binding row whose `pinned_content_hash` no longer matches the catalog row at `(org_agent_id, pinned_version)` is detected by an integrity probe (`bindings.ts` exports `verifyBindingIntegrity()` for the spec 098 nightly job).

**Checkpoint:** `npm run typecheck` and `npm test` in `platform/services/statecraft` pass. The two test files cover the spec §5 surface. Commit message: `feat(statecraft, spec-123): org-scoped catalog API + project bindings module`.

---

## Phase 3 — Duplex envelopes

Catalog envelopes bump `v: 1 → v: 2`; binding envelopes are new at `v: 1`.

- [ ] **T040** In the shared envelope types module (TS side under `api/sync/types.ts`, Rust side wherever the duplex types are mirrored), define:
  - `AgentCatalogUpdated` at `v: 2` per spec §7.1 (`org_id` replaces `workspace_id`; otherwise identical to spec 111 §2.3).
  - `AgentCatalogSnapshot` at `v: 2` per spec §7.1.
  - `ProjectAgentBindingUpdated` at `v: 1` per spec §7.2.
  - `ProjectAgentBindingSnapshot` at `v: 1` per spec §7.2.
- [ ] **T041** Update `platform/services/statecraft/api/agents/relay.ts`:
  - All `workspace_id` fields in catalog envelope payloads become `org_id`.
  - Catalog fan-out: published/retired updates fan to all OPCs whose claimed org matches `org_id`.
  - Binding fan-out: binding updates fan only to OPCs that have the originating `project_id` "active" (per spec §7 last paragraph).
  - Reconnect snapshot: emit one `agent.catalog.snapshot` (org-wide) plus one `project.agent_binding.snapshot` per active project.
- [ ] **T042** [P] Update `platform/services/statecraft/api/sync/duplex.ts` envelope kind registry: add `project.agent_binding.updated` and `project.agent_binding.snapshot`. Reject any `v: 1` `agent.catalog.*` envelope (clean break per pre-alpha posture).
- [ ] **T043** [P] Test `relay.test.ts` (extend existing): reconnect snapshot includes the catalog snapshot AND the per-project binding snapshots; `v: 1` catalog payloads are rejected with a typed error.
- [ ] **T044** [P] Test compile-time enforcement: introduce a temporary mismatch between the desktop `AGENT_CATALOG_ENVELOPE_VERSION` constant and the platform's; verify the unified type-check (or `cargo check` if the constant is shared via the typed bindings) fails at build time. Revert the mismatch.

**Checkpoint:** Statecraft build passes; desktop's `cargo check` passes; envelope schema-version mismatch test confirms the build-time gate. Commit message: `feat(statecraft, opc, spec-123): duplex envelopes v2 catalog + v1 project bindings`.

---

## Phase 4 — Statecraft web: org Agents top-nav surface

Top-nav entry + the five org-catalog routes.

- [ ] **T050** Edit `platform/services/statecraft/web/app/routes/app.tsx` nav array (around line 34):
  ```ts
  { to: "/app", label: "Projects", end: true },
  { to: "/app/agents", label: "Agents", end: false },
  { to: "/app/factory", label: "Factory", end: false },
  ```
  Order matters — Agents between Projects and Factory.
- [ ] **T051** Create `platform/services/statecraft/web/app/routes/app.agents.tsx` — layout route (Outlet, breadcrumb, page chrome).
- [ ] **T052** [P] Create `platform/services/statecraft/web/app/routes/app.agents._index.tsx` — list view with draft / published / retired filters, search by name / model / tag.
- [ ] **T053** [P] Create `platform/services/statecraft/web/app/routes/app.agents.new.tsx` — create-draft form (frontmatter fields + body markdown editor). Validates against `agent-frontmatter` lint on save.
- [ ] **T054** [P] Create `platform/services/statecraft/web/app/routes/app.agents.$agentId.tsx` — detail view with edit-draft mode for `status: draft` rows; published rows are read-only with a "Fork" CTA.
- [ ] **T055** [P] Create `platform/services/statecraft/web/app/routes/app.agents.$agentId.publish.tsx` — publish confirmation modal (shows policy bundle requirements, lint result, content_hash).
- [ ] **T056** [P] Create `platform/services/statecraft/web/app/routes/app.agents.$agentId.history.tsx` — version history from `agent_catalog_audit`, ordered by `created_at DESC`, with diff view between adjacent versions.
- [ ] **T057** [P] Update `platform/services/statecraft/web/app/routes.ts` to register the new routes.
- [ ] **T058** [P] Visual smoke: log into statecraft web in dev, click `Agents` in top nav, create a draft, publish, view history. Capture as a manual checklist in PR description.

**Checkpoint:** `npm run typecheck` and `npm run build` in `platform/services/statecraft/web` pass. The dev server renders the new routes without console errors. Commit message: `feat(statecraft-web, spec-123): top-nav Agents surface — list/create/edit/publish/retire/fork/history`.

---

## Phase 5 — Statecraft web: project Agents tab as binding manager

Repurpose the project-side surface; delete 119-era authoring routes.

- [ ] **T060** Rewrite `platform/services/statecraft/web/app/routes/app.project.$projectId.agents._index.tsx`:
  - List bindings: each row shows `name @ vN (hash:abc1234)`, status indicator (`active` | `retired_upstream`), `bound_at`, actor, "Repin" / "Unbind" actions, and a "View definition" link to `/app/agents/:org_agent_id`.
  - "Add binding" button opens a modal with org-agent picker (filters to non-bound, non-retired); selecting one shows version dropdown defaulting to latest published.
- [ ] **T061** [P] Update `platform/services/statecraft/web/app/routes/app.project.$projectId.agents.tsx` (layout) — breadcrumb stays "Project / Agents"; remove any "Create draft" CTA from the layout chrome.
- [ ] **T062** [P] Delete `platform/services/statecraft/web/app/routes/app.project.$projectId.agents.new.tsx`.
- [ ] **T063** [P] Delete `platform/services/statecraft/web/app/routes/app.project.$projectId.agents.$agentId.publish.tsx`.
- [ ] **T064** [P] Delete `platform/services/statecraft/web/app/routes/app.project.$projectId.agents.$agentId.history.tsx` — history lives at the org level now; the project tab does not own definition history (the binding's audit trail is part of `project_audit_log`, surfaced inline on the binding row, not as a separate page).
- [ ] **T065** [P] Update `platform/services/statecraft/web/app/routes.ts` to remove the deleted routes and update the project agents route to point at the rewritten index.
- [ ] **T066** [P] Update the project Overview tile (in `app.project.$projectId._index.tsx` if Agents has a tile there) to read "Imported agents" and link to the bindings page.
- [ ] **T067** [P] Visual smoke: bind / repin / unbind in dev. Confirm retired-upstream indicator renders when an org agent is retired after binding.

**Checkpoint:** `npm run typecheck` and `npm run build` in statecraft web pass. The project Agents tab functions as a binding manager. Commit message: `feat(statecraft-web, spec-123): project Agents tab — binding manager`.

---

## Phase 6 — OPC desktop cache rebind

Schema bump and binding-aware listing on the desktop side.

- [ ] **T070** Update `product/apps/opc/src-tauri/src/commands/agent_catalog_sync.rs`:
  - Local SQLite `agents` table column rename: `workspace_id TEXT` → `org_id TEXT`. Migration writes the new schema and copies values during desktop startup if an existing DB is detected.
  - Envelope handler accepts `v: 2` `agent.catalog.updated` / `agent.catalog.snapshot` (per Phase 3 types). Rejects `v: 1` with a typed error and a "statecraft requires desktop update" toast (one shot per session).
  - New handler for `project.agent_binding.updated` and `project.agent_binding.snapshot` — maintains a local `project_agent_bindings` table (project_id, org_agent_id, pinned_version, pinned_content_hash).
- [ ] **T071** [P] Update `product/apps/opc/src-tauri/src/commands/agents.rs`:
  - `list_active_agents(project_id)` → returns org agents whose id appears in the desktop's local `project_agent_bindings` for that project, with the catalog row's frontmatter and body. This is the default `Agent.list()` source going forward.
  - `list_org_agents(org_id)` → returns the full org catalog (for ad-hoc browse). Surfaced via a "Browse org agents" affordance in the desktop UI (UI work in T073).
  - `.claude/agents/*.md` continues to list as `source: "file"` — unchanged.
- [ ] **T072** [P] Update `product/apps/opc/src-tauri/src/commands/statecraft_client.rs` and `sync_client.rs` for the v2 envelope wire format. Compile-time `const` for `AGENT_CATALOG_ENVELOPE_VERSION = 2` and `PROJECT_AGENT_BINDING_ENVELOPE_VERSION = 1`.
- [ ] **T073** [P] Desktop UI — the agent picker / catalog browser surfaces "Active for this project" (bindings) vs "All org agents" (browse). Specific UI files vary by where the picker lives; trace from `product/apps/opc/src/components/.../AgentPicker.*` and update.
- [ ] **T074** [P] Test `crates/agent-frontmatter/tests/ts_bindings.rs` — round-trip the v2 envelope shape through the Rust types. Existing tests for `UnifiedFrontmatter` are unchanged.
- [ ] **T075** [P] Manual smoke: launch desktop against migrated statecraft, confirm an org agent appears in list_org_agents but only bound ones appear in list_active_agents for the project.

**Checkpoint:** `cargo check` at workspace root passes. `cargo test --manifest-path crates/agent-frontmatter/Cargo.toml` passes. Desktop builds (`cargo tauri build` or the dev-equivalent typecheck). Commit message: `feat(opc, spec-123): desktop catalog rebind to org + binding-aware active list`.

---

## Phase 7 — Factory engine resolver

The seam between Factory pipelines and the org catalog.

- [ ] **T080** Create `crates/factory-engine/src/agent_resolver.rs`:
  - `pub struct AgentResolver { org_id: String, http: StatecraftClient }`.
  - `pub fn resolve(&self, reference: AgentReference) -> Result<ResolvedAgent>` where `AgentReference` is one of `ById { org_agent_id, version }`, `ByName { name, version }`, `ByNameLatest { name }`.
  - `ResolvedAgent` carries `org_agent_id`, `version`, `content_hash`, `frontmatter`, `body_markdown`.
  - Fail-loud on ambiguous name resolution (multiple org-agent rows match — should be impossible per uniqueness, but defensive).
  - In-process cache keyed by `(org_agent_id, version)` — entries valid for a run's lifetime.
- [ ] **T081** Thread the resolver through `crates/factory-engine/src/stages/stage_cd_comparator.rs` (spec 122). Where the stage today resolves "the comparator agent" implicitly, it now calls `agent_resolver.resolve(...)` and pins the resulting `content_hash` into the run's audit record.
- [ ] **T082** [P] Audit other Factory stages for implicit agent references (`crates/factory-engine/src/stages/*.rs`). Each gets the same treatment — one resolver call, content_hash captured in run audit.
- [ ] **T083** [P] Update `crates/factory-contracts` if pipelines today reference agents by name only; add a typed `AgentReference` enum that maps cleanly onto the resolver input.
- [ ] **T084** [P] Test `crates/factory-engine/tests/agent_resolver_test.rs`:
  - Resolve by id+version returns the matching row.
  - Resolve by name+version returns the matching row.
  - Resolve by name (latest) returns the highest published version.
  - Resolving a retired version returns a typed error.
  - Two resolves against different projects (within the same org, against the same agent reference) return identical `content_hash`. **This is the spec A-8 acceptance test.**
- [ ] **T085** [P] Integration test (end-to-end): two project rows in dev DB, both bound to the same org agent at v3. Run Stage CD comparator against both. Assert the run audit rows for both carry identical `agent_content_hash`. The diff classification grammar (spec 122) should now reflect *behavioural* drift only.

**Checkpoint:** `cargo test --manifest-path crates/factory-engine/Cargo.toml` passes. The two-projects-same-content-hash integration test passes. Commit message: `feat(factory-engine, spec-123): agent_resolver — stable identity for Factory→agent references`.

---

## Phase 8 — Closure: spec 119 amendment + acceptance gates + status flip

The final phase. Every prior phase's checkpoint already commits its slice; Phase 8 reconciles cross-spec metadata and flips spec 123 to approved.

- [ ] **T090** Edit `specs/119-project-as-unit-of-governance/spec.md`:
  - Frontmatter: add `amended: "2026-05-01"` and `amendment_record: "123"`.
  - Body: add a callout near the top of §1: `> **Amended by spec 123 (2026-05-01):** the agent-catalog scope decision in this spec is reverted by spec 123. The rest of the workspace→project collapse (knowledge, runs, grants, connectors, S3) stands. See spec 123 for the migration record.`
  - §4.3 row for `agent_policies`: append `(reverted to org_id by spec 123)`.
  - §4 narrative: add one sentence noting `agent_catalog` and `agent_catalog_audit` are reverted to `org_id` by spec 123.
- [ ] **T091** [P] Edit `specs/123-agent-catalog-org-rescope/spec.md` frontmatter:
  - `status: draft` → `status: approved`
  - `implementation: pending` → `implementation: complete`
- [ ] **T092** Run `./tools/spec-spine/spec-compiler/target/release/spec-compiler compile`. Verify `.derived/spec-registry/registry.json` carries `amends: ["119"]` on spec 123 and `amendment_record: "123"` on spec 119, with no schema-validation errors. (Spec A-9.)
- [ ] **T093** Run `./tools/spec-spine/codebase-indexer/target/release/codebase-indexer compile`. Verify `.derived/codebase-index/index.json` re-renders cleanly with spec 123 traced to its implementing paths and spec 111 / 119 traceability still resolves to active code. (Spec A-10.) Run `codebase-indexer render` to refresh `CODEBASE-INDEX.md`.
- [ ] **T094** [P] Run the grep gate from spec A-5: `grep -rn "agent_catalog\.project_id\|agent_catalog_audit\.project_id\|agent_policies\.project_id\|agentCatalog\.projectId" platform/services/statecraft crates product/apps/opc`. Must return zero hits outside historical migration files (27, 28), this spec's migration script (30), frozen superseded specs, and this spec's body.
- [ ] **T095** [P] Run `make ci` from the repo root. Must pass green. (Spec A-11.)
- [ ] **T096** [P] Verify acceptance criteria A-1 through A-11 from the spec one by one. For each, leave a one-line note in the PR description showing the verification artifact (test path, grep output, screenshot reference, etc.).
- [ ] **T097** Final commit message: `chore(spec-123): close — flip status approved + complete, amend 119, registry/index refresh`.

**Checkpoint:** Spec 123 is `status: approved`, `implementation: complete`. Spec 119 carries the amendment marker. `make ci` is green. Spec registry and codebase index are fresh. All acceptance criteria verified.

---

## Phase boundaries / commit cadence

Each phase ends with one commit. Eight phases → eight commits on the feature branch. The closure phase (Phase 8) carries the spec frontmatter flip and the cross-spec amendment edits; it does not introduce new code.

If any checkpoint fails, halt and surface the error per `.claude/rules/orchestrator-rules.md` Rule 4. Do not silently move to the next phase. Do not skip phases or merge them.
