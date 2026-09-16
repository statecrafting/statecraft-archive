---
id: "041-checkpoint-restore-ui"
title: "Checkpoint / Restore UI — desktop panel"
feature_branch: "041-checkpoint-restore-ui"
status: approved
implementation: complete
kind: product
domain: opc
created: "2026-03-29"
authors:
  - "open-agentic-platform"
summary: >
  Add a dedicated Checkpoint panel to the desktop app that exposes titor's
  temporal safety capabilities through a project-scoped UI: initialize tracking,
  create named checkpoints, list/restore/diff/verify checkpoints.
establishes:
  - unit: { kind: file, path: product/apps/opc/src/features/checkpoint/CheckpointSurface.tsx }
  - unit: { kind: file, path: product/apps/opc/src/features/checkpoint/useCheckpointFlow.ts }
  - unit: { kind: file, path: product/apps/opc/src/features/checkpoint/types.ts }
---

# Feature Specification: Checkpoint / Restore UI — desktop panel

## Purpose

Feature 038 wired the titor library's six Tauri commands (`titor_init`, `titor_checkpoint`, `titor_list`, `titor_restore`, `titor_diff`, `titor_verify`). The backend is fully functional but unreachable from the desktop UI — no panel invokes these commands. This feature adds a singleton "Checkpoint" tab that gives users direct access to titor's temporal safety net.

## Scope

### In scope

- **Singleton tab**: `checkpoint` tab type in the tab system, accessible from the titlebar tools dropdown (following the governance/xray/semantic-search pattern).
- **Feature directory**: `product/apps/opc/src/features/checkpoint/` with `CheckpointSurface.tsx`, `useCheckpointFlow.ts`, and `types.ts`.
- **Project initialization**: Text input for project root path + "Initialize" button that calls `titor_init`.
- **Checkpoint creation**: "Create checkpoint" button with optional message input; calls `titor_checkpoint`.
- **Checkpoint list**: Displays all checkpoints for the initialized project (id, timestamp, description, file count, size) via `titor_list`.
- **Restore action**: Per-checkpoint "Restore" button with confirmation dialog; calls `titor_restore`.
- **Diff view**: Select two checkpoints to diff; displays added/modified/deleted file counts and file list via `titor_diff`.
- **Verify action**: Per-checkpoint "Verify" button; shows integrity report (valid/invalid, file counts, errors) via `titor_verify`.
- **State machine**: `idle` -> `loading` -> `ready` (initialized, showing checkpoint list) | `error`. Sub-operations (create, restore, verify, diff) use local loading states within the `ready` state.

### Out of scope

- **Agent-session scoped checkpoints**: This panel is project-scoped (user picks a directory). Per-agent-session checkpointing is a future feature.
- **Automatic/scheduled checkpoints**: Manual only.
- **Timeline visualization**: Simple list view, no graph/timeline UI.
- **File content diff**: Shows file-level changes (added/modified/deleted) but not inline content diffs.

## Requirements

### Functional

- **FR-001**: A "Checkpoint" entry appears in the titlebar tools dropdown menu. Clicking it opens/focuses a singleton `checkpoint` tab.
- **FR-002**: The panel shows a project path input and "Initialize" button. Calling `titor_init` transitions the panel to the `ready` state showing the checkpoint list.
- **FR-003**: In `ready` state, a "Create checkpoint" control with an optional message field calls `titor_checkpoint` and refreshes the list.
- **FR-004**: The checkpoint list displays each checkpoint's description (or "unnamed"), timestamp (relative, e.g. "2 min ago"), file count, and total size. Most recent checkpoints appear first.
- **FR-005**: Each checkpoint row has a "Restore" button. Clicking it shows a confirmation prompt. On confirm, calls `titor_restore` and refreshes the list.
- **FR-006**: A "Diff" mode allows selecting two checkpoints. Calls `titor_diff` and displays added/modified/deleted file counts with a file path list.
- **FR-007**: Each checkpoint row has a "Verify" button. Calls `titor_verify` and shows a pass/fail badge with detail expandable (files checked, errors).
- **FR-008**: All titor command errors are displayed inline as styled error messages, never as panics or uncaught exceptions.

### Non-functional

- **NF-001**: The checkpoint list refreshes automatically after create/restore operations without manual reload.
- **NF-002**: The panel follows existing Surface component patterns (padding, typography, color tokens, loading spinners).

## Architecture

### Tab integration

| File | Change |
|------|--------|
| `contexts/TabContext.tsx` | Add `'checkpoint'` to `Tab['type']` union |
| `hooks/useTabState.ts` | Add `createCheckpointTab()` singleton factory |
| `components/TabContent.tsx` | Add lazy-loaded `CheckpointPanel` case |
| `components/CustomTitlebar.tsx` | Add `onCheckpointClick` prop + dropdown entry |
| `App.tsx` | Wire `onCheckpointClick={() => createCheckpointTab()}` |

### Feature structure

```
product/apps/opc/src/features/checkpoint/
  CheckpointSurface.tsx   — main panel component
  useCheckpointFlow.ts    — state machine + titor command wrappers
  types.ts                — TypeScript interfaces for checkpoint data
```

### State machine

```
idle ──[init]──> loading ──> ready { checkpoints[], projectRoot }
                    │               │
                    └── error ◄─────┘ (any command failure)
```

Within `ready`, sub-operations (create, restore, verify, diff) use component-local `busy` flags.

### Tauri command invocation

All titor commands are invoked via `invoke()` from `@tauri-apps/api/core`:
```typescript
import { invoke } from "@tauri-apps/api/core";
await invoke<string>("titor_init", { rootPath, storagePath: null });
await invoke<Checkpoint>("titor_checkpoint", { rootPath, message });
await invoke<Checkpoint[]>("titor_list", { rootPath });
await invoke("titor_restore", { rootPath, checkpointId });
await invoke<CheckpointDiff>("titor_diff", { rootPath, id1, id2 });
await invoke<VerificationReport>("titor_verify", { rootPath, checkpointId });
```

## Success criteria

- **SC-001**: "Checkpoint" appears in the titlebar tools dropdown and opens a singleton tab.
- **SC-002**: Initializing a project path, creating a checkpoint, and seeing it in the list works end-to-end.
- **SC-003**: Restoring to a previous checkpoint reverts the project directory (confirmed by re-listing).
- **SC-004**: Diffing two checkpoints shows correct added/modified/deleted counts.
- **SC-005**: Verifying a checkpoint shows a valid/invalid status.
- **SC-006**: Errors from uninitialized projects or invalid paths display gracefully in the panel.

## Risk

- **R-001**: `titor_restore` is destructive — overwrites files. Mitigation: FR-005 requires confirmation dialog before restore.
- **R-002**: Large projects may have slow checkpoint creation. Mitigation: loading spinners + NF-001 keeps UI responsive.
