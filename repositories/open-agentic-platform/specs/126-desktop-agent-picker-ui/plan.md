# Implementation Plan: Desktop Agent Picker — Bindings vs Full Catalog

**Spec**: [spec.md](./spec.md)
**Feature**: `126-desktop-agent-picker-ui`
**Date**: 2026-05-01
**Branch**: `126-desktop-agent-picker-ui`

## Summary

Close spec 123 T073 (which shipped as a no-op because the desktop
agent picker didn't exist). Add `AgentPicker.tsx` and the supporting
`agentPicker.ts` data hook to the desktop. The picker reads through
the spec 123 Tauri commands `list_active_agents(project_id)` and
`list_org_agents(org_id)`, surfaces retired-upstream bindings per
spec 123 invariant I-B3, and emits an `AgentReference` (spec 123
`factory-contracts`) for callers — primarily spec 124's run-trigger
flow. No backend or duplex changes; this is purely a desktop UI
addition.

## Sequencing

| Phase | Focus | Spec sections |
|-------|-------|---------------|
| **0** | Foundations: TypeScript surface mirroring spec 123's `AgentReference` enum + `CatalogRow` shape; data hook scaffold | §3, §5 |
| **1** | Component shell: tabs (Active / Browse), search input, list virtualisation; presentational only | §4 |
| **2** | Data wiring: `useAgentPickerData` hook calls the Tauri commands, listens on duplex updates, deduplicates concurrent fetches | §5 |
| **3** | Invariants: retired-upstream rendering, draft filtering, "always use latest" shortcut, deep-link to web UI for bindings | §2, §4 |
| **4** | Tests + story: unit tests covering tab state / retired non-selectable / reference variant emission; Storybook (or equivalent) coverage of the four canonical states | §8 A-7, A-8 |
| **5** | Closure: A-1..A-8 verified; spec 126 frontmatter flips to `status: approved` / `implementation: complete` | §8 |

Phases 0–3 are sequential; Phase 4 is independent of Phase 3 but
gates merge. Phase 5 is closure. Total component scope ≤ 400 lines of
component + hook + types.

## Approach decisions

- **Read-only.** Spec §7 non-goal. Bind / repin / unbind stays on the
  web UI; the picker emits a reference and steps aside. Keeps the
  component small and the governance line bright.
- **One component, two tabs.** A separate "AgentBindings" view and an
  "AgentBrowser" view would force two surfaces to maintain. The tabs
  switch implementation, the props don't.
- **Output is `AgentReference`, not a fetched body.** Resolution is
  spec 123's `AgentResolver` job; the picker stays UI-only and
  doesn't reach into `factory-engine`. Callers get a stable identity
  + version pair.
- **Duplex-driven auto-refresh.** Spec 123's `v: 2` catalog envelope
  already lands at the desktop SQLite cache; the picker subscribes to
  cache update events and revalidates rather than polling.
- **No Storybook hard requirement.** The repo doesn't currently use
  Storybook; the visual coverage requirement is satisfied by a
  manual fixture page or a vitest-react-testing-library story-style
  test if Storybook is absent.
- **Modal by default.** Matches the existing `AgentsModal.tsx`
  precedent. The picker is invoked from the spec-124 run-trigger UI
  via a button; the modal centers, focuses, and traps focus.
- **`cmdk`-style search inline.** Don't pull in a new dependency if
  the existing UI primitive already covers it; otherwise a thin
  filter input is fine.
- **Deep-link for binding mutations.** `Manage bindings →` opens
  `https://<statecraft-host>/app/project/{projectId}/agents` via
  `tauri-plugin-shell` to keep the desktop bind-free.

## Risks

- **Cache drift between desktop SQLite and statecraft.** If the
  desktop's catalog cache (spec 111 §2.4 / spec 123 §6.3) misses an
  update, the picker shows stale data. Mitigation: the picker
  subscribes to the duplex update events; a manual "refresh" button
  bypasses the cache and re-invokes the command. Stale data is a
  recoverable read, not a correctness violation.
- **Retired-upstream rendering inconsistency.** If the binding row
  says `status: retired_upstream` but the catalog row's actual
  status is something else (a transient race), the picker may
  mis-render. Mitigation: trust the binding row's `status` field
  (spec 123 §4.4 invariant I-B3); display whatever it says.
- **`AgentReference` shape drift.** If spec 123's enum gains a
  variant, the picker must learn it. Mitigation: import
  `AgentReference` from a shared TS module sourced from spec 123 (the
  current canonical Rust home is `crates/factory-contracts/src/agent_reference.rs`;
  the TS mirror lives next to spec 123's API endpoints if one exists,
  otherwise the picker declares a narrow type with a CI-equivalent
  exhaustiveness check).
- **Modal focus / a11y.** A native focus trap is non-trivial without
  a UI library. Mitigation: reuse the existing modal primitive if
  one exists in the desktop codebase (`AgentsModal.tsx` likely has
  it); otherwise add one minimal helper.
- **Filter state lost on tab switch.** A naive implementation
  re-mounts each tab's children. Mitigation: lift filter state into
  the parent component; tab content is conditionally rendered, not
  re-mounted.

## References

- Spec: [`./spec.md`](./spec.md)
- Tasks: [`./tasks.md`](./tasks.md)
- Pattern reuse:
  - Spec 123 §6.3 — desktop binding-aware list semantics; the
    picker is the UI affordance for those commands
  - Spec 123 §7.1 — `agent.catalog.updated` envelope (v: 2) drives
    auto-refresh
  - Spec 124 §4.1 — primary consumer; the picker feeds an
    `AgentReference` into the run-trigger flow
- Existing primitives this spec touches:
  - `product/apps/opc/src/components/AgentPicker.tsx` (new)
  - `product/apps/opc/src/lib/agentPicker.ts` (new)
  - Reuses the existing modal / dialog primitive (e.g. from
    `AgentsModal.tsx`); does NOT replace it
- Cross-crate dependencies: none. Pure UI; consumes existing Tauri
  commands shipped by spec 123.
- Related specs: 111 (origin of duplex-cached agent surface), 123
  (binding model + commands), 124 (primary consumer of the picker's
  output)
