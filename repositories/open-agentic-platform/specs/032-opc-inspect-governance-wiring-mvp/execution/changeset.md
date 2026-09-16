---
feature_id: "032-opc-inspect-governance-wiring-mvp"
---

# Changeset

Slice 1 implementation batch for OPC inspect + governance wiring.

**PR-1:** **Complete (merged to `main`).** Import + T000a baseline + spec-compiler V-004 fix (PR-1.2); evidence in [`verification.md`](./verification.md).  
**PR-2:** **Complete (merged to `main`).** T003 inspect shell — `InspectSurface` + `useInspectFlow` / `xray_scan_project`.  
**PR-3:** **Complete (merged to `main`).** T007 — native git context panel (`useGitContext` / `GitContextSurface`).  
**PR-4:** **Complete (merged to `main`).** T006 — gitctx MCP enrichment (Rust stdio bridge, `@opc/mcp-client`, additive enrichment); see [`t006-checklist.md`](./t006-checklist.md).
**PR-5:** **Complete.** T004–T005 inspect journey wiring on `feat/032-t004-t005-inspect-wiring` — shared adapter path for inspect entrypoint, explicit inspect panel hydration (summary + indexed files), and bounded degraded/error states.
**PR-6:** **Complete (merged).** T008–T009 governance wiring — adapter-routed governance overview, compiled-registry + featuregraph hydration, and explicit degraded/unavailable/error states.

**T010–T011 (this batch on `main`):** Registry `featureSummaries` emitted from `read_registry_summary` for “View spec” follow-up; `MarkdownEditor` + `claude-md` tab support optional absolute spec path; `RegistrySpecFollowUp` on Xray and Governance surfaces; vitest unit tests for `actions.ts`. Docs: [`apps/desktop/README.md`](../../../../apps/desktop/README.md), root [`README.md`](../../../../README.md) pointer.

**T012–T013:** Vitest + `RegistrySpecFollowUp` component tests; full verification commands recorded in [`verification.md`](./verification.md) (2026-03-28).

## In-scope tasks

- **Done:** T000–T013 (including T010–T013 on `main` as of 2026-03-28).
- **Next:** Post-032 product work per `plan.md` / new features (out of scope for this changeset).

## Planned touch targets

- Inspect: `apps/desktop/src/features/inspect/*`
- Git context: `apps/desktop/src/features/git/*`, `packages/mcp-client/src/index.ts`
- Governance: `apps/desktop/src/features/governance/*`, `apps/desktop/src-tauri/src/commands/analysis.rs`
- Action handoff: `apps/desktop/src/features/inspect/actions.ts`, `RegistrySpecFollowUp.tsx`
- Tests: inspect/git/governance panel tests and backend command tests

## Approval and safety notes

- Any repository-mutating automation or destructive command path requires explicit review approval before execution.
- External runner invocations must be listed in `execution/verification.md` with purpose and preconditions.

## Governance evidence

- Fixtures touched: `none`
- Spec/doc touchpoints: `specs/032-opc-inspect-governance-wiring-mvp/tasks.md`, `specs/032-opc-inspect-governance-wiring-mvp/execution/verification.md`, `specs/032-opc-inspect-governance-wiring-mvp/execution/changeset.md`, `specs/032-opc-inspect-governance-wiring-mvp/plan.md`, `specs/032-opc-inspect-governance-wiring-mvp/execution/pr1-import-runbook.md`
