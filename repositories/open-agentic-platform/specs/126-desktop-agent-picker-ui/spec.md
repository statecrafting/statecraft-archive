---
id: "126-desktop-agent-picker-ui"
slug: desktop-agent-picker-ui
title: Desktop Agent Picker — Bindings vs Full Catalog
status: approved
implementation: complete
owner: bart
created: "2026-05-01"
approved: "2026-05-01"
kind: desktop
domain: opc
risk: low
summary: >
  Closes spec 123 T073, which was a no-op because the desktop AgentPicker
  surface didn't exist yet. Add a single AgentPicker component to the
  desktop that surfaces "Active for this project" (org agents bound via
  `project_agent_bindings`) versus "All org agents" (full catalog,
  ad-hoc browse). Calls the spec 123 desktop commands `list_active_agents(project_id)`
  and `list_org_agents(org_id)`. Renders the spec 123 invariants
  (`status: retired_upstream`, `pinned_version`, `pinned_content_hash`)
  faithfully so an operator can tell at a glance whether a binding is
  current. Does not reach into spec 124's run pipeline; the picker's
  output is an `AgentReference` (spec 123 `factory-contracts`) that
  callers consume.
depends_on:
  - "111-org-agent-catalog-sync"  # original duplex-cached agent surface; UI plugs into the existing cache
  - "123-agent-catalog-org-rescope"  # source of bindings + retired_upstream invariant + desktop commands
  - "124-opc-factory-run-platform-integration"  # primary consumer (Run reservation builds AgentReferences from picker output)
extends:
  - spec: "123-agent-catalog-org-rescope"
    nature: additive
    unit: { kind: file, path: product/apps/opc/src/components/AgentPicker.tsx }
  - spec: "123-agent-catalog-org-rescope"
    nature: additive
    unit: { kind: file, path: product/apps/opc/src/lib/agentPicker.ts }
---

# 126 — Desktop Agent Picker — Bindings vs Full Catalog

## 1. Problem Statement

Spec 123 added two desktop Tauri commands —
`list_active_agents(project_id)` (returns the project's bindings, joined
with the org catalog) and `list_org_agents(org_id)` (returns the full
org catalog) — and reserved T073 for the UI that would surface them.
T073 shipped as a no-op in spec 123 because the desktop has no agent
picker today: the existing components (`Agents.tsx`, `AgentsModal.tsx`,
`CreateAgent.tsx`, `GitHubAgentBrowser.tsx`) target the file-source
`.claude/agents/*.md` flow (spec 111 §2.4), not the org catalog.

Without a picker:

1. A Factory run from the desktop (spec 124) cannot let the operator
   choose which org agent to bind into a stage — the run is forced to
   resolve from whatever the process definition embedded.
2. An ad-hoc invocation against the org catalog has no UI affordance;
   the catalog data is sitting in the desktop's local SQLite cache
   (spec 111 §2.4 / spec 123 §6.3) but invisible.
3. Operators cannot see retired-upstream bindings, breaking spec 123
   invariant I-B3's user-facing promise ("retired-agent bindings
   remain visible read-only").
4. The "Browse org agents" affordance spec 123 §6.3 calls out is
   un-implemented; the only path to seeing the org catalog is the
   statecraft web UI.

## 2. Decision

Ship a single `AgentPicker` React component on the desktop that
covers both modes (project-bound and full catalog) behind one
toggle. No backend work — the spec 123 commands already exist.

1. **One component, two tabs:** `Active for this project` (default
   when a project is active) and `All org agents` (default for ad-hoc
   contexts). Toggling preserves filter state.
2. **Inputs:** `{ orgId, projectId? }`. When `projectId` is omitted,
   the "Active" tab is hidden.
3. **Output:** an `AgentReference` (spec 123
   `factory-contracts::agent_reference`) — `ById` for explicit picks,
   `ByNameLatest` only when the operator clicks the "Always use latest"
   shortcut on a binding. Callers (spec 124's run-trigger flow,
   ad-hoc agent invocation) consume the reference; the picker does
   not perform resolution itself.
4. **Surfaced invariants:**
   - Retired-upstream bindings show with a muted style + an icon and
     are non-selectable (cannot bind/use; can only unbind via the web
     UI).
   - Pinned version is shown next to the agent name as `name @ vN`
     with `content_hash` short-form on hover.
   - Catalog rows in `draft` status are filtered out (cannot bind
     drafts — spec 123 §3 invariant).
5. **No write paths.** Bind / repin / unbind are spec 123's web UI
   responsibility (`/app/project/{id}/agents`); this picker is
   read-only. Operators who want to bind navigate via a deep-link
   button: "Manage bindings →".

## 3. Component Surface

```ts
// product/apps/opc/src/components/AgentPicker.tsx

export interface AgentPickerProps {
  orgId: string;
  projectId?: string;
  /** Called when the operator confirms a selection. Reference shape per
   *  spec 123 factory-contracts. The picker emits ByNameLatest only
   *  when the explicit "always use latest" shortcut is selected. */
  onSelect: (reference: AgentReference) => void;
  /** Optional default mode override. Defaults to "active" when
   *  projectId is set, "browse" otherwise. */
  defaultMode?: "active" | "browse";
  /** Optional filter narrowing the displayed agents (e.g. by safety
   *  tier or model). Pure client-side — does not affect data fetched. */
  filter?: AgentFilter;
}

export type AgentFilter = (row: CatalogRow) => boolean;
```

`AgentPicker` is a presentational component; data fetching lives in a
small `product/apps/opc/src/lib/agentPicker.ts` module that wraps the Tauri
`invoke` calls behind a `useAgentPickerData(orgId, projectId)` hook.
The hook handles loading/error states, deduplicates concurrent fetches
within the same `orgId`, and listens on the duplex cache update events
(spec 111 §2.3, bumped to v: 2 by spec 123) so the picker auto-refreshes
when an agent is published or retired upstream.

## 4. UI Structure

```
┌───────────────────────────────────────────────────┐
│  AgentPicker                                      │
│  ┌─────────────────┬─────────────────┐            │
│  │ Active (5)      │ All org agents  │            │
│  └─────────────────┴─────────────────┘            │
│                                                   │
│  [ search by name / tag ]    [filter ▾]           │
│                                                   │
│  ┌─────────────────────────────────────────────┐  │
│  │ ▢  reviewer @ v3  · sha:a3f2…  · published  │  │
│  │    Safety tier 1 · model: opus-4.6          │  │
│  ├─────────────────────────────────────────────┤  │
│  │ ✕  extractor @ v2  · sha:9c11…  · RETIRED   │  │
│  │    Upstream retired — unbind via web UI     │  │
│  ├─────────────────────────────────────────────┤  │
│  │ ▢  scaffolder @ v7 · sha:c8d2…  · published │  │
│  │    Safety tier 2 · model: sonnet-4.6        │  │
│  └─────────────────────────────────────────────┘  │
│                                                   │
│  [ Cancel ]            [ Manage bindings → ]      │
└───────────────────────────────────────────────────┘
```

Tab counts come from `list_active_agents` (project-bound) and
`list_org_agents` (full catalog) respectively. Sort defaults to last-
used (active) / name-asc (browse), togglable.

## 5. Data Flow

```
AgentPicker.tsx
  ├─ useAgentPickerData(orgId, projectId)        ← hook
  │    ├─ invoke("list_active_agents", { project_id })
  │    └─ invoke("list_org_agents", { org_id })
  └─ onSelect(AgentReference)                    ← emitted from row click
       └─ caller (spec 124 run-trigger / ad-hoc invocation)
            └─ AgentResolver::resolve(reference)  (factory-engine)
```

The duplex cache (`product/apps/opc/src-tauri/src/commands/agent_catalog_sync.rs`,
spec 123 §8.3) is the source of truth on the desktop; the picker reads
through the Tauri commands rather than re-implementing cache logic.

## 6. Integration Points

1. **Spec 124 Run reservation flow.** The desktop's
   `commands/factory.rs` (post-spec-124) builds a reservation request
   that lists explicit `AgentReference`s. The AgentPicker is the UI
   the operator uses to make those choices when the process
   definition is open-ended (e.g. "pick which reviewer to use for
   stage 4"). For pipelines whose process definitions hard-code agent
   references, the picker is bypassed.
2. **Ad-hoc agent invocation.** A future "Run an agent ad-hoc"
   affordance (out of scope here) will use the picker in browse mode.
3. **Project Agents tab on the desktop.** The desktop project-agents
   surface (if and when one exists) reuses the picker in active mode.

## 7. Non-Goals

- Authoring agents on the desktop. Authoring lives in the web UI
  (spec 123 §6.1); the desktop is read-only.
- Bind / repin / unbind. Web UI only (spec 123 §6.2).
- Multi-select. The picker emits one `AgentReference`. A multi-stage
  pipeline that needs multiple selections renders multiple pickers
  (one per stage).
- Showing local file-source agents (`.claude/agents/*.md`, spec 111
  §2.4) in the same list. Local file agents continue to flow through
  the existing `Agents.tsx` UI; the catalog picker is org-only.
- Custom RBAC. Read access matches what the desktop already has via
  spec 106/107 OIDC; no new role.

## 8. Acceptance

A-1. `AgentPicker` is exported from `product/apps/opc/src/components/AgentPicker.tsx`
     with the props in §3.
A-2. Active tab lists only `project_agent_bindings` rows for the
     given `projectId`, joined with the catalog, including retired-
     upstream bindings (rendered non-selectable).
A-3. Browse tab lists every published or retired catalog row for the
     org; drafts are filtered out.
A-4. `onSelect` emits an `AgentReference::ById` by default; the
     "always use latest" shortcut emits `AgentReference::ByNameLatest`.
A-5. The picker auto-refreshes when a duplex `agent.catalog.updated`
     envelope arrives (spec 123 §7.1 v: 2).
A-6. `Manage bindings →` deep-links to the statecraft web UI at
     `/app/project/{projectId}/agents` (uses `tauri-plugin-shell`
     opener).
A-7. Storybook (or equivalent) story renders all four states: empty
     active, populated active with one retired-upstream, browse with
     mixed published/retired, search-filtered.
A-8. Unit tests cover: tab switching preserves filter state; retired-
     upstream rows are non-selectable; `onSelect` emits the correct
     reference variant.

## 9. Open Questions

- Should the picker integrate with the desktop's existing search
  primitive (`product/apps/opc/src/components/CommandPalette` or similar)
  for keyboard-only picking? Default: render a `cmdk`-style search
  input inline; broader command-palette integration deferred.
- Where does the picker live by default? Likely as a modal dialog
  invoked from the spec-124 run-trigger UI; could also be a sidebar
  panel. Default: modal — matches `AgentsModal.tsx` precedent. Revisit
  if the run-trigger flow grows.
- Should it surface the full `frontmatter` (safety tier, model, tags)
  inline, or hide behind a "Show details" toggle? Default: inline for
  active, collapsed for browse (the catalog can be large).

## 10. Implementation Notes (2026-05-01)

What shipped on branch `126-desktop-agent-picker-ui`:

- **Component**: `product/apps/opc/src/components/AgentPicker.tsx` exports
  `AgentPicker` (hook-driven container) and `AgentPickerView`
  (presentational). Surface matches §3 plus `open`/`onOpenChange` for
  modal control. Reuses `@opc/ui/{dialog,tabs,button,badge,input}`.
- **Data hook**: `product/apps/opc/src/lib/agentPicker.ts` declares the
  `AgentReference` TS mirror (kind-discriminated; serde→TS bridge note
  per T002), `BindingRow`/`CatalogRow`, and `useAgentPickerData`.
  Concurrent fetches dedup via an in-module `Map<key, Promise>`;
  duplex Tauri events (`agent-catalog-updated`,
  `agent-catalog-snapshot`, `project-agent-binding-updated`,
  `project-agent-binding-snapshot`) trigger `refresh()`.
- **Backend wire**: `list_active_agents` and `list_org_agents` in
  `product/apps/opc/src-tauri/src/commands/agents.rs` now return
  `AgentBindingRow` (LEFT JOIN with bindings, surfaces `pinned_version`
  + `pinned_content_hash` + derived `status`) and `AgentCatalogRow`
  (catalog cache row with `remote_version` + `remote_content_hash`).
- **Invariants**:
  - Retired-upstream bindings: derived from the JOIN missing its
    catalog partner (spec 123's `retire_remote_agent` DELETEs the
    catalog row); status is set in Rust to `"retired_upstream"` and
    rendered muted, non-selectable, with the unbind tooltip.
  - Draft filtering on browse: defensive in TS (`status !== "draft"`).
    The spec 123 catalog cache already skips drafts in the upsert
    path, so this is belt-and-braces.
  - "↻ latest" toggle: per-agent state in `AgentPickerView`; selection
    handler emits `ByNameLatest` when toggled, `ById` otherwise.
- **Tests**: 10 unit tests in `AgentPicker.test.tsx` covering
  A-2..A-6, the latest toggle, draft filtering, and the duplex
  auto-refresh integration. Fixture page at
  `product/apps/opc/src/dev/AgentPickerFixture.tsx` for visual review
  (Storybook absent from the desktop app).
- **Deviation worth flagging**: the picker exposes the bindings'
  `pinned_version` + `pinned_content_hash` directly. Spec 123's
  binding schema (`project_agent_bindings`) carries no `name` column,
  so retired-upstream rows show the bare `org_agent_id` UUID until
  spec 123 backfills a denormalised name. Not blocking — the row is
  non-selectable anyway and the operator's only action is "unbind via
  web UI". File a spec 123 follow-up if the UX needs the name.
