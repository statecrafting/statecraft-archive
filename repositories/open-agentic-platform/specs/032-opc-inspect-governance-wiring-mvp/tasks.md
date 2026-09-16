# Tasks: OPC inspect + governance wiring

**Input**: `/specs/032-opc-inspect-governance-wiring-mvp/`  
**Prerequisites**: Features **000-004**, **029-031**

**Feature status**: **Complete** — T000–T013 done (see `execution/verification.md`). Registry frontmatter **`status`** stays **`active`** per Feature **000/003** enum.

## Phase 0: Consolidation gate (blocking)

**PR-1 objective:** complete T000 + T000a only — import + baseline evidence; behavior-neutral except fixes required for baseline green or explicitly documented degraded baseline.

- [x] T000 Import OPC code trees required for this slice:
  - `product/apps/opc`
  - `product/apps/opc/src-tauri` (or the repository’s actual Tauri backend path after consolidation)
  - `product/packages/mcp-client`
- [x] T000a Verify imported trees build/test at baseline before Feature 032 wiring starts
  - frontend workspace installs/builds for desktop app baseline
  - Tauri backend compiles for desktop baseline
  - `product/packages/mcp-client` resolves as a workspace package
  - existing baseline tests are run and recorded in `execution/verification.md` before 032 wiring changes

**PR-2 objective (first thin implementation PR after import):** **T003 only** — inspect contract + state model + deterministic tests; minimal inspect shell if needed. **Exclude** T004–T011 (no git/governance/action in the same PR unless an unavoidable inspect-only stub is documented).

## Phase 1: Spec and execution artifacts

- [x] T001 Add `spec.md`, `plan.md`, and `tasks.md`
- [x] T002 Add `execution/changeset.md` and `execution/verification.md` templates

## Phase 2: Inspect journey wiring

- [x] T003 Define/confirm inspect UI contract and state model (success/loading/error/degraded) — **PR-2** (`feat/032-pr2-inspect-shell`)
- [x] T004 Wire inspect entrypoint to execute inspect flow and hydrate panels — **PR-5** (`feat/032-t004-t005-inspect-wiring`)
- [x] T005 Replace inspect placeholder states with explicit real or degraded states — **PR-5** (`feat/032-t004-t005-inspect-wiring`)

## Phase 3: Git context integration

- [x] T006 Complete frontend MCP path used by git context panel — **merged PR #4** (`feat/032-pr4-t006-gitctx-sidecar`); gate: [`execution/t006-checklist.md`](./execution/t006-checklist.md). Rust-owned stdio bridge + `@opc/mcp-client` + additive `useGitCtxEnrichment`; native git unchanged from PR-3.
- [x] T007 Wire git context panel to live git data and explicit panel states — **PR-3** (`feat/032-pr3-git-context`): `commands.gitCurrentBranch`, `gitStatus`, `gitAheadBehind` via `useGitContext` / `GitContextSurface`

### PR-3 slice (user milestone: “T004–T005 git hydration”)

- [x] Git context: branch / detached HEAD / clean vs dirty / ahead–behind / status entries
- [x] Placeholder copy removed from `GitContextPanel`; failures bounded to git panel only

## Phase 4: Governance integration

- [x] T008 Wire governance/feature status panel to compiled registry outputs — **PR-6** (`feat/032-t008-t009-governance-wiring`)
- [x] T009 Replace stubbed governance command/data path with real integration and deterministic tests — **PR-6** (`feat/032-t008-t009-governance-wiring`)

## Phase 5: Action path and docs

- [x] T010 Add one bounded follow-up action from inspect results
- [x] T011 Update user-facing docs for inspect/governance path and operator usage notes

## Phase 6: Verification

- [x] T012 Run targeted test suites for touched UI/backend packages
- [x] T013 Run full relevant validation path and record outcomes in `execution/verification.md`

## Dependencies

- T000-T000a before T003-T013
- T003-T005 before T010
- T006-T007 and T008-T009 before T010
- T010-T011 before T012-T013

## Strict implementation sequence and per-file DoD

### T003 Inspect contract

- Files:
  - `product/apps/opc/src/features/inspect/types.ts`
  - `product/apps/opc/src/features/inspect/useInspectFlow.ts`
  - `product/apps/opc/src/features/inspect/__tests__/InspectSurface.test.tsx`
- Done when:
  - success/loading/error/degraded states are typed
  - inspect payload shape is documented in code-level types
  - state transitions are covered by deterministic tests

### T004-T005 Inspect surface wiring

- Files:
  - `product/apps/opc/src/features/inspect/InspectSurface.tsx`
  - `product/apps/opc/src/lib/apiAdapter.ts`
  - `product/apps/opc/src/features/inspect/__tests__/InspectSurface.test.tsx`
- Done when:
  - inspect entrypoint hydrates inspect surface; **full** git + governance hydration is **later PRs** after PR-2 (T003-only thin slice)
  - placeholder states are removed for the inspect path
  - degraded and error states render explicitly and predictably

### T006-T007 Git context integration

- Files:
  - `product/packages/mcp-client/src/index.ts`
  - `product/apps/opc/src-tauri/src/commands/mcp.rs`
  - `product/apps/opc/src-tauri/src/sidecars.rs`
  - `product/apps/opc/src/components/GitContextPanel.tsx`
  - `product/apps/opc/src/features/git/GitContextSurface.tsx`
  - `product/apps/opc/src/features/git/useGitContext.ts`
  - `product/apps/opc/src/features/git/useGitCtxEnrichment.ts`
  - `product/apps/opc/src/features/git/__tests__/GitContextPanel.test.tsx`
  - `product/apps/opc/src/features/git/__tests__/fixtures/*.json`
- Done when:
  - panel renders live branch/head/cleanliness/repository identity
  - gitctx enrichment is additive; degraded/absent enrichment is explicit without breaking native git
  - deterministic fixture-backed coverage exists for success/degraded/error panel states

### T008-T009 Governance integration

- Files:
  - `product/apps/opc/src/components/GovernancePanel.tsx`
  - `product/apps/opc/src/features/governance/GovernanceSurface.tsx`
  - `product/apps/opc/src/features/governance/useGovernanceStatus.ts`
  - `product/apps/opc/src-tauri/src/commands/analysis.rs`
  - `product/apps/opc/src-tauri/src/commands/mod.rs`
  - `product/apps/opc/src/features/governance/__tests__/GovernancePanel.test.tsx`
  - `product/apps/opc/src-tauri/tests/featuregraph_commands.rs`
- Done when:
  - panel renders state from the compiled registry artifact and featuregraph command path
  - stubs are removed or explicitly degraded with bounded behavior
  - backend command tests cover success/unavailable/error paths

### T010 Action handoff

- Files:
  - `product/apps/opc/src/features/inspect/actions.ts`
  - `product/apps/opc/src/features/inspect/InspectSurface.tsx`
  - `product/apps/opc/src/features/inspect/__tests__/inspect-actions.test.tsx`
- Done when:
  - one bounded follow-up action is executable from inspect results
  - action target is deterministic and reviewable in tests

### T011 Docs

- Files:
  - `product/apps/opc/README.md`
  - `README.md`
  - `specs/032-opc-inspect-governance-wiring-mvp/execution/changeset.md`
- Done when:
  - inspect/governance user flow is documented
  - governance evidence paths are filled with touched files
