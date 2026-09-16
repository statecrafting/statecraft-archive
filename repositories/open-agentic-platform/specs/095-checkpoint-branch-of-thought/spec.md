---
id: "095-checkpoint-branch-of-thought"
title: "Checkpoint Branch-of-Thought"
status: approved
implementation: complete
owner: bart
created: "2026-04-11"
kind: platform
domain: opc
risk: high
depends_on:
  - "092-workspace-runtime-threading"
  - "094-unified-artifact-store"
summary: >
  Elevate checkpoints from safety snapshots to a navigable branch-of-thought DAG.
  Populate git HEAD SHA and repo fingerprint on create, add branch_name/run_id
  scoping, introduce checkpoint.compare MCP tool, bind gate approvals to
  checkpoint IDs, and provide desktop branch visualization.
code_aliases: ["CHECKPOINT_BRANCHING"]
extends:
  - spec: "041-checkpoint-restore-ui"
    nature: additive
    unit: { kind: file, path: crates/axiomregent/src/checkpoint/provider.rs }
  - spec: "041-checkpoint-restore-ui"
    nature: additive
    unit: { kind: file, path: crates/axiomregent/src/checkpoint/types.rs }
  - spec: "041-checkpoint-restore-ui"
    nature: additive
    unit: { kind: file, path: crates/axiomregent/src/checkpoint/store.rs }
  - spec: "052-state-persistence"
    nature: additive
    unit: { kind: file, path: crates/orchestrator/src/gates.rs }
  - spec: "052-state-persistence"
    nature: additive
    unit: { kind: file, path: crates/orchestrator/src/manifest.rs }
---

# 095 — Checkpoint Branch-of-Thought

Parent plan: [089 Governed Convergence Plan](../089-governed-convergence-plan/spec.md)

## Problem

The checkpoint system is substantial (10 MCP tools, Merkle verification, CAS blob
store) but operates as safety/rewind snapshots rather than a reasoning tool:

- `CheckpointInfo.head_sha` is **always `None`** — the field exists but `do_create`
  never populates it
- `CheckpointInfo.fingerprint` stores `"{}"` — never computed
- The DAG is a tree (parent_id chain) with no branch name concept
- "Current" checkpoint is time-based (most recent `created_at`), not pointer-based
- No scoping by `branch_name` or `run_id`
- Gate approvals are disconnected from checkpoint state — no evidence binding
- Desktop shows a flat checkpoint list with no branch visualization

## Solution

Populate git and fingerprint data on checkpoint creation, add branch-aware scoping,
introduce structural comparison between checkpoints, bind approvals to specific
checkpoint states, and visualize the branch DAG in the desktop UI.

## Implementation Slices

### Slice 1: Populate head_sha on checkpoint create

In `do_create()`, run `git rev-parse HEAD` from the repo root and store the result
in `CheckpointInfo.head_sha`. Handle non-git directories gracefully (leave as `None`).

**Files**: `crates/axiomregent/src/checkpoint/provider.rs`

### Slice 2: Populate fingerprint on checkpoint create

Compute a repo fingerprint summary: `{file_count, total_size, top_extensions}` from
the entries already walked during checkpoint creation. Store as JSON in the
`fingerprint` field instead of `"{}"`.

**Files**: `crates/axiomregent/src/checkpoint/provider.rs`

### Slice 3: Add branch_name and run_id scoping

Add `branch_name: Option<String>` and `run_id: Option<String>` to `CheckpointInfo`.
Add corresponding columns to the hiqlite `checkpoints` table. Populate `branch_name`
from `git rev-parse --abbrev-ref HEAD` during `do_create`. Populate `run_id` from
`OPC_RUN_ID` env var if set. Update `list` and `timeline` MCP tools to accept optional
`branch_name` and `run_id` filter parameters.

**Files**: `crates/axiomregent/src/checkpoint/types.rs`,
`crates/axiomregent/src/checkpoint/store.rs`,
`crates/axiomregent/src/checkpoint/provider.rs`

### Slice 4: Add checkpoint.compare MCP tool

New MCP tool: `checkpoint.compare(checkpoint_a, checkpoint_b)` returning structural
and semantic diff:
- Files added/removed/modified (counts and paths)
- LOC delta (lines added, lines removed)
- Merkle root comparison
- Git SHA comparison (if both have head_sha)
- Fingerprint delta

Tier: Tier1 (read-only). Enables "compare two candidate implementations before
promotion."

**Files**: `crates/axiomregent/src/checkpoint/provider.rs`

### Slice 5: Bind approvals to checkpoint IDs

Orchestrator `StepGateConfig::Approval` gains optional `checkpoint_id: Option<String>`.
When a gate is reached in `evaluate_gate()`:
1. Auto-create a checkpoint (call `CheckpointProvider.do_create` or equivalent)
2. Bind the approval to that checkpoint ID
3. Include `checkpoint_id` and `merkle_root` in the gate event payload

The approval event emitted to Statecraft includes checkpoint evidence.

**Files**: `crates/orchestrator/src/gates.rs`,
`crates/orchestrator/src/manifest.rs`

### Slice 6: Desktop checkpoint timeline with branch visualization

Extend the checkpoint panel to:
- Show branch names alongside checkpoint entries
- Visualize divergence points (fork nodes)
- Display git SHA next to each checkpoint
- Add "Compare Branches" action between two selected checkpoints
- Show run_id grouping in the timeline

**Files**: `product/apps/opc/src/components/CheckpointPanel.tsx`

## Acceptance Criteria

- **SC-095-1**: Checkpoint creation records actual git HEAD SHA
- **SC-095-2**: Checkpoints can be filtered by branch_name and run_id
- **SC-095-3**: `checkpoint.compare` returns structural diff between two checkpoints
- **SC-095-4**: Gate approvals are bound to checkpoint IDs with Merkle root
- **SC-095-5**: Desktop shows checkpoint branches with divergence visualization
