---
id: "092-workspace-runtime-threading"
title: "Project Runtime Threading"
status: approved
implementation: complete
owner: bart
created: "2026-04-11"
amended: "2026-04-29"
amendment_record: "119-project-as-unit-of-governance"
kind: platform
domain: opc
risk: high
depends_on:
  - "087-unified-workspace-architecture"
  - "090-governance-non-optionality"
summary: >
  Make project_id flow as a first-class value through every execution path:
  desktop UI, ClaudeExecutionRequest, orchestrator manifests, checkpoints,
  factory contracts, and spawned Claude processes. Originally authored against
  workspace_id (spec 087); amended by spec 119 when workspace was collapsed
  into project.
code_aliases: ["PROJECT_THREADING"]
extends:
  - spec: "052-state-persistence"
    nature: additive
    unit: { kind: file, path: crates/orchestrator/src/manifest.rs }
  - spec: "052-state-persistence"
    nature: additive
    unit: { kind: file, path: crates/orchestrator/src/state.rs }
  - spec: "052-state-persistence"
    nature: additive
    unit: { kind: file, path: crates/orchestrator/src/lib.rs }
  - spec: "041-checkpoint-restore-ui"
    nature: additive
    unit: { kind: file, path: crates/axiomregent/src/checkpoint/types.rs }
  - spec: "041-checkpoint-restore-ui"
    nature: additive
    unit: { kind: file, path: crates/axiomregent/src/checkpoint/provider.rs }
  - spec: "041-checkpoint-restore-ui"
    nature: additive
    unit: { kind: file, path: crates/axiomregent/src/checkpoint/store.rs }
---

# 092 — Project Runtime Threading

Parent plan: [089 Governed Convergence Plan](../089-governed-convergence-plan/spec.md)

> **Amended by spec 119 (2026-04-29):** the unit of governance threaded by this spec is now `project_id`, not `workspace_id`. Code aliases, env vars, and Tauri commands rename accordingly (`OPC_WORKSPACE_ID` → `OPC_PROJECT_ID`, `set_active_workspace` → `set_active_project`, `workspace-changed` event → `project-changed`, code alias `WORKSPACE_THREADING` → `PROJECT_THREADING`). The threading invariant is unchanged; only the identifier renames. See spec 119 for the migration record.

## Problem

Project_id exists only in Statecraft (DB + JWT) and flows into exactly two
places: grants fetch (`OPC_PROJECT_ID` env var in `governed_claude.rs`) and
factory API bodies (optional on 10 of 11 endpoints). The orchestrator,
checkpoints, factory contracts, and Claude execution all ignore it.

Without project threading, governance boundaries are meaningless — any
execution can access any project's resources, and checkpoints cannot be
scoped to the project that created them.

| Gap | Location |
|-----|----------|
| No Tauri command for project selection | `commands/statecraft_client.rs` |
| `ClaudeExecutionRequest` lacks project_id | `web_server.rs` |
| `WorkflowManifest` lacks project_id | `crates/orchestrator/src/manifest.rs` |
| `CheckpointInfo` lacks project_id | `crates/axiomregent/src/checkpoint/types.rs` |
| Factory API accepts missing projectId | `platform/services/statecraft/api/factory/factory.ts` |
| `WorkspaceTools` name collision | `crates/axiomregent/src/workspace/mod.rs` (historical — see slice 6) |

## Implementation Slices

### 1. Programmatic project selection in desktop (2 days)

- Add Tauri command `set_active_project(project_id)` that:
  - Sets `StatecraftClient.project_id`
  - Sets `OPC_PROJECT_ID` process env var
  - Fetches grants from platform and updates `SidecarState.grants_json`
  - Emits `project-changed` event
- Files: `commands/statecraft_client.rs`, `product/apps/opc/src-tauri/src/commands/agents.rs`

### 2. Thread project_id into ClaudeExecutionRequest (1 day)

- Add `project_id: Option<String>` to `ClaudeExecutionRequest`
- Pass through to governed_claude as `OPC_PROJECT_ID` env on spawned process
- Files: `web_server.rs`, `commands/claude.rs`

### 3. Thread project_id into orchestrator (1 day)

- Add `project_id: Option<String>` to `WorkflowManifest`
- Persist in `WorkflowState.metadata["project_id"]`
- Pass to `DispatchRequest` → inject as env var on spawned claude processes
- Files: `crates/orchestrator/src/manifest.rs`, `crates/orchestrator/src/state.rs`,
  `crates/orchestrator/src/lib.rs`

### 4. Thread project_id into checkpoints (1 day)

- Add `project_id: Option<String>` to `CheckpointInfo`
- Populate from `OPC_PROJECT_ID` env in `do_create`
- Add project_id filter to `list` and `timeline` queries
- Files: `crates/axiomregent/src/checkpoint/types.rs`,
  `crates/axiomregent/src/checkpoint/provider.rs`,
  `crates/axiomregent/src/checkpoint/store.rs`

### 5. Make factory project_id mandatory (1 day)

- Change `projectId` from optional to required in all Statecraft factory API
  request types (currently required only on `InitRequest`)
- `verifyProjectInScope()` runs unconditionally (renamed from `verifyProjectInWorkspace` per spec 119)
- Add `project_id` to factory contract `build-spec.schema.yaml`
- Files: `platform/services/statecraft/api/factory/factory.ts`,
  `factory/contract/schemas/build-spec.schema.yaml`

### 6. Rename axiomregent WorkspaceTools (0.5 day)

- Rename `WorkspaceTools` to `RepoMutationTools` for descriptive clarity (originally
  motivated by name collision with the workspace-as-container concept introduced
  by spec 087; that motivation dissolved when spec 119 collapsed workspace into
  project, but the rename remains valid on its own merit)
- Update MCP tool names from `workspace.*` to `repo.*`
- Add backward-compat aliases so `workspace.*` calls still work
- Files: `crates/axiomregent/src/workspace/mod.rs`,
  `crates/axiomregent/src/router/legacy_provider.rs`

## Acceptance Criteria

- SC-092-1: Changing project via `set_active_project` updates grants, env
  var, and emits `project-changed` event
- SC-092-2: `WorkflowState` persists `project_id` in metadata
- SC-092-3: Checkpoints list filters by `project_id` when provided
- SC-092-4: Factory API rejects requests without `projectId`
- SC-092-5: `workspace.*` tool calls still work (backward compat alias retained from the original rename)

## Dependencies

| Spec | Relationship |
|------|-------------|
| 087-unified-workspace-architecture | Project entity model (amended by 119) |
| 090-governance-non-optionality | Governance bypass closure (prerequisite) |
| 093-spec-driven-preflight | Consumes project-scoped context (downstream) |
| 094-unified-artifact-store | Project-scoped artifact storage (downstream) |
| 095-checkpoint-branch-of-thought | Checkpoint project filtering (downstream) |
| 119-project-as-unit-of-governance | Renames the threaded identifier from workspace_id to project_id |
