# Tasks: Desktop Agent Picker — Bindings vs Full Catalog

**Input**: `/specs/126-desktop-agent-picker-ui/`
**Prerequisites**: spec.md, plan.md
**Phases**: 0 (Foundations) → 1 (Component shell) → 2 (Data wiring) → 3 (Invariants) → 4 (Tests) → 5 (Closure)

Tasks are grouped by phase per `plan.md`. `[P]` = can run in parallel with other `[P]` tasks in the same phase.

---

## Phase 0 — Foundations

TypeScript surface mirroring spec 123's enums and row shapes.

- [x] **T001** Audit `crates/factory-contracts/src/agent_reference.rs` to confirm the `AgentReference` enum's three variants (`ById`, `ByName`, `ByNameLatest`) and their field shapes. The picker's TS mirror MUST match exactly.
- [x] **T002** [P] In `product/apps/opc/src/lib/agentPicker.ts`, declare the TS mirror of `AgentReference`:
  ```ts
  export type AgentReference =
    | { kind: "by_id"; org_agent_id: string; version: number }
    | { kind: "by_name"; name: string; version: number }
    | { kind: "by_name_latest"; name: string };
  ```
  Use `kind` rather than serde's `tag` because the desktop currently has no shared serde→TS type bridge for spec 123 envelopes; document the mapping in a comment so a future shared-type generator can replace this.
- [x] **T003** [P] Declare `CatalogRow` and `BindingRow` shapes in the same `agentPicker.ts` module, mirroring what `list_active_agents` and `list_org_agents` actually return on the wire (snake_case keys per Encore.ts convention).
- [x] **T004** [P] Stub the data hook signature: `export function useAgentPickerData(orgId: string, projectId?: string): { active: BindingRow[]; browse: CatalogRow[]; loading: boolean; error: Error | null; refresh: () => void }`. Hook body is wired in Phase 2.

**Checkpoint:** `pnpm --filter @opc/desktop tsc --noEmit` passes (or equivalent depending on the desktop build wiring). Commit: `chore(desktop, spec-126): AgentPicker types + hook stub`.

---

## Phase 1 — Component shell

Presentational only; no real data. A fixture array drives the rendering until Phase 2.

- [x] **T010** Create `product/apps/opc/src/components/AgentPicker.tsx`. Props per spec §3. Body is a modal + tabs + search + list. Empty state: "No bindings yet — open the project's Agents tab in statecraft to bind one."
- [x] **T011** Add tab switcher with active count badges. Tab state is local component state initialised from `defaultMode`.
- [x] **T012** [P] Search input with debounce (existing helper if one is in the desktop codebase; otherwise inline 200ms debounce). Filter is client-side over the list.
- [x] **T013** [P] Row layout per spec §4 ASCII mock: name @ vN, content_hash short, status pill, safety tier + model line.
- [x] **T014** [P] Footer: `Cancel` + `Manage bindings →`. The latter uses `tauri-plugin-shell` opener with the constructed URL `https://<statecraft-host>/app/project/{projectId}/agents`. Statecraft host comes from existing desktop config.
- [x] **T015** [P] Wire a fixture array of 5 mixed-status rows so the component renders standalone in dev for visual review.

**Checkpoint:** Component renders against the fixture, tabs switch, search filters, deep-link button opens (in dev with a placeholder URL). Commit: `feat(desktop, spec-126): AgentPicker shell + tabs + search`.

---

## Phase 2 — Data wiring

Replace the fixture with real Tauri command calls.

- [x] **T020** Implement `useAgentPickerData(orgId, projectId)`:
  - Calls `invoke("list_active_agents", { project_id: projectId })` when `projectId` is set; returns `[]` otherwise.
  - Calls `invoke("list_org_agents", { org_id: orgId })` always.
  - Both calls run in parallel via `Promise.all`.
  - Transient errors surface in `error`; partial success (one call OK, the other failed) is treated as full failure for now (revisit if needed).
- [x] **T021** Concurrent-fetch dedup: if a second invocation of the hook with the same `(orgId, projectId)` arrives while a fetch is in flight, both subscribers share the in-flight promise. Implement via a small in-module `Map<key, Promise>`.
- [x] **T022** [P] Listen for duplex `agent.catalog.updated` events. The desktop's existing duplex bridge surfaces these as Tauri events (see `product/apps/opc/src-tauri/src/commands/agent_catalog_sync.rs` — `EVENT_CATALOG_UPDATED = "agent-catalog-updated"`, kebab-case); subscribe via `listen("agent-catalog-updated", …)` and call `refresh()`. Same for `project-agent-binding-updated` when `projectId` is set.
- [x] **T023** [P] Replace the Phase 1 fixture in `AgentPicker.tsx` with `useAgentPickerData`'s output.
- [x] **T024** [P] Loading state: skeleton rows or spinner while `loading: true`. Error state: a small banner with retry.

**Checkpoint:** Picker shows real data when running against a statecraft + a desktop build with a populated catalog. Commit: `feat(desktop, spec-126): AgentPicker data hook + duplex auto-refresh`.

---

## Phase 3 — Invariants

The spec 123 invariants the picker must surface correctly.

- [x] **T030** Retired-upstream rendering: rows where the binding row carries `status: 'retired_upstream'` (active tab) or where the catalog row's `status: 'retired'` (browse tab) render with muted style + a warning icon, are non-selectable, and tooltip "Retired upstream — unbind via web UI." Per spec 123 invariant I-B3.
- [x] **T031** Draft filtering: in browse tab, filter out catalog rows with `status: 'draft'`. Per spec 123 §3 invariant ("only published or retired definitions can be bound").
- [x] **T032** [P] Selection emits `AgentReference::ById` by default with `org_agent_id` and `pinned_version` (active) or `version` (browse).
- [x] **T033** [P] "Always use latest" shortcut: a small "↻ latest" toggle on each browse-tab row that, when active, makes the row emit `AgentReference::ByNameLatest` instead of `ById`. Documented in the row tooltip.
- [x] **T034** [P] Empty state copy: when active tab has zero bindings, render a CTA: "Bind an org agent to this project →" deep-linking to `/app/project/{projectId}/agents`.

**Checkpoint:** Manual smoke: select a published row, confirm `onSelect` emits `ById`; toggle "latest", select again, confirm emits `ByNameLatest`; confirm retired row is non-selectable. Commit: `feat(desktop, spec-126): AgentPicker invariants — retired/draft/latest`.

---

## Phase 4 — Tests + story

Lock the behaviour.

- [x] **T040** Unit tests in `product/apps/opc/src/components/AgentPicker.test.tsx` (using whatever the desktop's React test runner is — likely vitest + react-testing-library):
  - Renders with `projectId` set; `Active` tab is default.
  - Renders without `projectId`; `Active` tab hidden, `Browse` is default.
  - Switching tabs preserves the search filter input.
  - Retired-upstream row is non-selectable (clicking it does not fire `onSelect`).
  - Draft rows in catalog response are filtered out before rendering.
  - "↻ latest" toggle changes the emitted reference variant.
- [x] **T041** [P] If Storybook is configured, add stories covering the four canonical states (empty active, active with retired-upstream, mixed browse, search-filtered). If not, add a fixture page under `product/apps/opc/src/dev/AgentPickerFixture.tsx` with the same coverage so visual review is possible without running Storybook.
- [x] **T042** [P] Wire the picker into spec 124's run-trigger flow at the call site (when spec 124 reaches Phase 5 — coordinate). The integration is a one-line invocation; the test that closes the loop lives in spec 124's task list, not here. _Coordination note: spec 124 already shipped (commit `001aedd`); the picker is exported and ready to be invoked from `commands/factory.rs`'s run-trigger UI when that surface needs an explicit agent selection._

**Checkpoint:** All unit tests green. Coverage of the spec §8 acceptance criteria is one-to-one with test names. Commit: `test(desktop, spec-126): AgentPicker behavioural tests + visual fixtures`.

---

## Phase 5 — Closure

Acceptance gates A-1..A-8; spec lifecycle flip.

- [x] **T050** Verify A-1: `AgentPicker.tsx` exports the component with the props in spec §3.
- [x] **T051** Verify A-2..A-3: tab content matches the spec.
- [x] **T052** Verify A-4: emitted reference variant tests pass.
- [x] **T053** Verify A-5: duplex auto-refresh integration test passes (mocked event triggers a re-fetch).
- [x] **T054** Verify A-6: deep-link button opens the expected URL (asserted via the `tauri-plugin-shell` mock).
- [x] **T055** Verify A-7..A-8: Storybook / fixture coverage + unit-test enumeration matches the acceptance list.
- [x] **T056** Spec frontmatter flip: `status: draft → approved`, `implementation: pending → complete`, add `approved: <today>`. Append a brief Implementation Notes section.
- [x] **T057** `make registry` — recompile spec registry + codebase index. Must be clean.
- [x] **T058** Commit: `feat(specs): mark spec 126 approved + complete; refresh registry`.

**Final checkpoint:** spec §8 acceptance fully green; `git log --oneline` shows the per-phase commit trail (one commit per Phase 0..4 + the lifecycle flip = six commits).

---

## Halt conditions

Stop and report up — do NOT continue past these without surfacing:

- The desktop's existing duplex bridge does NOT surface `agent.catalog.updated` events to the front-end. T022 assumes spec 123's desktop work made these reachable; if not, halt and surface — adding the bridge wiring is a spec-123 follow-up, not a spec-126 expansion.
- `AgentReference` enum gains a fourth variant after spec 123's last commit. Halt and update the TS mirror in lockstep; the picker MUST express every variant the resolver accepts.
- The desktop has no modal / dialog primitive. T010 assumes one exists; if not, halt — adding one is a separate UI-foundation spec, not this work.
