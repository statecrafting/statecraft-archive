# Implementation Plan: OPC inspect + governance wiring

**Spec**: [spec.md](./spec.md)  
**Feature**: `032-opc-inspect-governance-wiring-mvp`

## Summary

Implement the first product-facing consolidation slice by wiring existing inspect, git context, and governance capability into one coherent OPC journey. Prioritize connecting existing sidecar/crate paths before introducing new backend logic.

## PR sequencing (consolidation gate first)

The next objective is **PR-1 only**: activate the consolidation gate for Feature 032. Subsequent PRs stay thin and ordered.

| PR | Scope | Goal |
|----|--------|------|
| **PR-1** | **Consolidation gate** — T000 + T000a | Import required OPC trees (`product/apps/opc`, Tauri backend at repo path e.g. `product/apps/opc/src-tauri`, `product/packages/mcp-client`). Restore workspace compile. **No Feature 032 product behavior** except minimal shims/path fixes strictly required for baseline green, or **documented** baseline-degraded gaps. Record full **T000a** evidence in [`execution/verification.md`](./execution/verification.md). |
| **PR-2** | **T003 inspect shell only** | Inspect UI contract + state model + tests; minimal plumbing so the desktop surface can consume the inspect path cleanly. **No** git context, **no** governance wiring, **no** action handoff (defer T004–T011 until after PR-2 unless a tiny inspect-only stub is unavoidable and called out in the PR). |

After PR-1, the first implementation PR should be **small and vertical**: prove imported UI + inspect contract before layering git/governance.

## Technical approach

1. **Inspect surface orchestration**
   - Define/confirm inspect UI contract payload and explicit loading/error/degraded states.
   - Ensure inspect entrypoint drives xray + panel updates in a single user flow.

2. **Git context wiring**
   - **T006 (done, PR-4):** Rust-owned MCP over stdio to bundled `gitctx-mcp`; `@opc/mcp-client` wraps Tauri commands; additive gitctx enrichment on top of native git (PR-3).
   - Native git remains authoritative; enrichment failures degrade without breaking the panel.

3. **Governance wiring**
   - Connect governance/feature status panel to compiled registry + featuregraph outputs.
   - Replace stubbed command/data paths with real integration or clearly bounded temporary degraded mode.

4. **Action affordance**
   - Add one bounded follow-up action from inspect results.
   - Keep action scope narrow and deterministic.

5. **Contract evidence**
   - Add/refresh deterministic tests (unit/integration/snapshot/fixture as appropriate).
   - Record verification commands and results under this feature's execution artifacts.

## File-level touch map (T003-T011)

Consolidated OPC trees are present under `product/apps/opc/`, `product/packages/*`, `crates/*`. **T003 (PR-2)** implemented the inspect shell under `product/apps/opc/src/features/inspect/` and rewired `XrayPanel` to render `InspectSurface`.

### T003-T005 Inspect journey wiring

- `product/apps/opc/src/features/inspect/InspectSurface.tsx` (inspect shell UI)
- `product/apps/opc/src/features/inspect/types.ts` (inspect UI contract types)
- `product/apps/opc/src/features/inspect/useInspectFlow.ts` (state machine: idle/loading/success/error/degraded)
- `product/apps/opc/src/features/inspect/xrayResult.ts` (pure xray payload classification for degraded)
- `product/apps/opc/src/lib/apiAdapter.ts` (inspect entrypoint wiring if routed through shared adapter)
- `product/apps/opc/src/features/inspect/__tests__/InspectSurface.test.tsx`

### T006-T007 Git context integration

**PR-3 (native path):** `product/apps/opc/src/features/git/{types.ts,useGitContext.ts,GitContextSurface.tsx}`, `product/apps/opc/src/components/GitContextPanel.tsx` — uses `commands.gitCurrentBranch`, `gitStatus`, `gitAheadBehind` from `@/lib/bindings` (not MCP).

- `product/packages/mcp-client/src/index.ts` (**T006 / PR-4:** Tauri `invoke` wrapper — not browser stdio)
- `product/apps/opc/src/features/git/__tests__/*` (deferred — no Vitest in desktop yet)

### T008-T009 Governance integration

- `product/apps/opc/src/features/governance/GovernancePanel.tsx`
- `product/apps/opc/src/features/governance/useGovernanceStatus.ts`
- `product/apps/opc/src-tauri/src/commands/analysis.rs` (featuregraph command wiring; remove stubs)
- `product/apps/opc/src-tauri/src/commands/mod.rs` (command export/registration updates)
- `product/apps/opc/src/features/governance/__tests__/GovernancePanel.test.tsx`
- `product/apps/opc/src-tauri/tests/featuregraph_commands.rs` (or existing command test module)

### T010 Action handoff

- `product/apps/opc/src/features/inspect/actions.ts`
- `product/apps/opc/src/features/inspect/InspectSurface.tsx` (wire one bounded follow-up action)
- `product/apps/opc/src/features/inspect/__tests__/inspect-actions.test.tsx`

### T011 Docs

- `product/apps/opc/README.md` (inspect/governance usage path, if this doc exists after import)
- `README.md` (monorepo-level slice note if user flow is documented there)
- `specs/032-opc-inspect-governance-wiring-mvp/execution/changeset.md` (governance evidence paths)

## Baseline verification expectations (T000a)

Before T003-T011 starts, verify and record:

- desktop frontend workspace installs/builds for baseline
- Tauri backend compiles for baseline
- `product/packages/mcp-client` resolves in workspace package graph
- existing baseline tests run clean enough to establish a pre-032 starting point

## Scope controls

- One vertical slice only: Inspect + Git Context + Governance wiring.
- No expansion into broad cockpit workflows.
- No platform control-plane module delivery in this feature.
- Any contract redefinition is out of scope and must be classified separately.

## Deliverables

- `specs/032-opc-inspect-governance-wiring-mvp/spec.md`
- `specs/032-opc-inspect-governance-wiring-mvp/plan.md`
- `specs/032-opc-inspect-governance-wiring-mvp/tasks.md`
- `specs/032-opc-inspect-governance-wiring-mvp/execution/changeset.md`
- `specs/032-opc-inspect-governance-wiring-mvp/execution/verification.md`
