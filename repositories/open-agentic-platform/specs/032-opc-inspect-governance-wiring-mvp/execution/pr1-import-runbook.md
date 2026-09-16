# PR-1 Runbook: Consolidation gate activation (T000 + T000a)

Feature: `032-opc-inspect-governance-wiring-mvp`  
Objective: Import required OPC trees and prove baseline health before any 032 behavior work.

## Scope guard (hard)

Allowed in PR-1:

- Import trees:
  - `apps/desktop`
  - `apps/desktop/src-tauri` (or actual consolidated Tauri backend path)
  - `packages/mcp-client`
- Workspace/path/build fixes required to make baseline checks runnable
- Baseline evidence updates in `execution/verification.md`

Not allowed in PR-1:

- T003+ behavior work for inspect/git/governance/action flows
- New UI/command features not required for import stabilization

## Suggested import sequence

1. Bring in OPC trees with history-preserving method where practical.
2. Normalize paths to target monorepo layout (desktop app, tauri backend, shared package).
3. Apply minimal compatibility fixes required for build/test discovery.
4. Record every non-trivial shim/path fix under the "Temporary shims / path fixes" row in `verification.md`.

## T000a baseline checks (must record)

Populate `execution/verification.md` with:

- desktop frontend install result
- desktop frontend build result
- Tauri/backend compile result
- workspace resolution including `packages/mcp-client`
- baseline tests and pass/fail summary
- temporary import shims/path fixes
- known non-032 breakages (if degraded baseline)

## Exit criteria for PR-1

- Imported trees are present at agreed paths.
- Baseline verification evidence table is fully filled.
- Any non-green baseline is explicitly documented as degraded with bounded cause.
- PR diff is behavior-neutral for Feature 032 scope.
