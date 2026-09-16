---
id: "099-workspace-scoped-persistence"
title: "Project-Scoped Persistence"
status: approved
implementation: complete
owner: bart
created: "2026-04-11"
amended: "2026-04-29"
amendment_record: "119-project-as-unit-of-governance"
kind: platform
domain: opc
risk: medium
depends_on:
  - "092-workspace-runtime-threading"
  - "094-unified-artifact-store"
  - "097-promotion-grade-mirror"
code_aliases: ["PROJECT_SCOPED_PERSISTENCE"]
extends:
  - spec: "052-state-persistence"
    nature: additive
    unit: { kind: file, path: crates/orchestrator/src/sqlite_state.rs }
  - spec: "052-state-persistence"
    nature: additive
    unit: { kind: file, path: crates/orchestrator/src/hiqlite_store.rs }
  - spec: "097-promotion-grade-mirror"
    nature: additive
    unit: { kind: file, path: crates/orchestrator/src/promotion.rs }
  - spec: "097-promotion-grade-mirror"
    nature: additive
    unit: { kind: file, path: crates/orchestrator/src/lib.rs }
summary: >
  Make persistence project-native and sync-trackable. Replace fire-and-forget
  Statecraft calls with tracked acknowledgement, update SyncStatus in the
  promotion check, and add project_id columns to workflow persistence stores.
  Originally authored against workspace_id; amended by spec 119 when workspace
  was collapsed into project.
---

# 099 — Project-Scoped Persistence

Parent plan: [089 Governed Convergence](../089-governed-convergence-plan/plan.md) — Phase 5

> **Amended by spec 119 (2026-04-29):** the persistence scope identifier is now `project_id`, not `workspace_id`. Code alias `WORKSPACE_SCOPED_PERSISTENCE` → `PROJECT_SCOPED_PERSISTENCE`. The persistence and sync-tracking contract is unchanged; only the scope identifier renames. See spec 119 for the migration record.

## Problem

Two persistence subsystems fail to serve the governed execution model:

1. **SyncStatus is always default.** `lib.rs` line 1804 hardcodes `SyncStatus::default()` (all
   `false`) with a `TODO(097)` comment. All Statecraft calls in `factory.rs` use `tokio::spawn`
   fire-and-forget — the `EventIngestionResponse { ingested }` and
   `RecordArtifactsResponse { recorded }` return values are discarded inside spawned tasks.
   Consequently, all workflows complete as `CompletedLocal` regardless of actual sync state.

2. **Workflow stores lack project_id.** The `workflows` table in both `sqlite_state.rs` and
   `hiqlite_store.rs` has no `project_id` column. Project_id lives only in the
   `WorkflowState.metadata` JSON bag, making it impossible to efficiently query "all runs for
   project X" at the storage layer. The artifact store at `artifact.rs` already has
   `project_id TEXT` + index, proving the pattern works.

## Solution

Replace fire-and-forget with tracked acknowledgement, plumb real SyncStatus into the promotion
check, and add project_id as a first-class column in both persistence stores.

### Slice 1: SyncTracker struct + factory integration

Add `SyncTracker` to `crates/orchestrator/src/promotion.rs`:

```rust
#[derive(Debug, Clone, Default)]
pub struct SyncTracker {
    inner: Arc<Mutex<SyncTrackerInner>>,
}

#[derive(Debug, Default)]
struct SyncTrackerInner {
    events_acked: u32,
    events_failed: u32,
    artifacts_acked: u32,
    artifacts_failed: u32,
    last_error: Option<String>,
}
```

Methods: `record_events_ack(count)`, `record_events_fail(err)`, `record_artifacts_ack(count)`,
`record_artifacts_fail(err)`, `to_sync_status() -> SyncStatus`.

In `factory.rs`, modify fire-and-forget calls to capture the `SyncTracker` reference inside
spawned tasks. On success: `tracker.record_events_ack(resp.ingested)`. On failure:
`tracker.record_events_fail(e.to_string())`.

**Files**: `crates/orchestrator/src/promotion.rs`, `product/apps/opc/src-tauri/src/commands/factory.rs`

### Slice 2: SyncStatus plumbing into promotion

Add `pub sync_tracker: Option<SyncTracker>` to `DispatchOptions`.

Replace `lib.rs` line 1804:
```rust
let sync_status = match &options.sync_tracker {
    Some(tracker) => tracker.to_sync_status(),
    None => promotion::SyncStatus::default(),
};
```

In `factory.rs`, pass the per-run `SyncTracker` through `DispatchOptions.sync_tracker`.

**Files**: `crates/orchestrator/src/lib.rs`, `product/apps/opc/src-tauri/src/commands/factory.rs`

### Slice 3: project_id column in SQLite store

Follow the proven `PRAGMA table_info` migration pattern from `sqlite_state.rs` lines 130-156:

```rust
let has_proj_id: bool = /* PRAGMA table_info(workflows) check */;
if !has_proj_id {
    conn.execute_batch(
        "ALTER TABLE workflows ADD COLUMN project_id TEXT;
         CREATE INDEX IF NOT EXISTS idx_workflows_project ON workflows(project_id);"
    );
}
```

In `write_workflow_state_sync`, extract `project_id` from `state.metadata["project_id"]`
and populate the column. Update INSERT/UPSERT SQL to include `project_id`.

**Files**: `crates/orchestrator/src/sqlite_state.rs`

### Slice 4: project_id column in Hiqlite store

Apply idempotent `ALTER TABLE` in `migrate()` (following pattern from
`axiomregent/src/db/mod.rs:139`):

```rust
let _ = self.client.execute(
    Cow::Borrowed("ALTER TABLE workflows ADD COLUMN project_id TEXT"),
    vec![],
).await;
```

Update `write_workflow_state` INSERT SQL to include `project_id`.

**Files**: `crates/orchestrator/src/hiqlite_store.rs`

### Slice 5: list_workflows_by_project query + Tauri command

Add query method to both stores:
```rust
async fn list_workflows_by_project(
    &self, project_id: &str, limit: Option<u32>,
) -> Result<Vec<WorkflowStateSummary>, OrchestratorError>;
```

Add `WorkflowStateSummary` struct (workflow_id, name, status, started_at, project_id) to
avoid loading all steps per workflow.

Add Tauri command `list_project_workflows` and register in `lib.rs` invoke_handler.

**Files**: `crates/orchestrator/src/sqlite_state.rs`, `crates/orchestrator/src/hiqlite_store.rs`,
`product/apps/opc/src-tauri/src/commands/orchestrator.rs`, `product/apps/opc/src-tauri/src/lib.rs`

## Acceptance Criteria

- **SC-099-1**: `SyncTracker` collects event ingestion and artifact recording acknowledgements from Statecraft responses
- **SC-099-2**: `SyncStatus` passed to `check_promotion_eligibility` reflects actual Statecraft sync state, not hardcoded defaults
- **SC-099-3**: Workflows that successfully sync events and artifacts are marked `Completed` (not `CompletedLocal`)
- **SC-099-4**: `workflows` table in SQLite store has `project_id TEXT` column with index, populated on write
- **SC-099-5**: `workflows` table in Hiqlite store has `project_id TEXT` column, populated on write
- **SC-099-6**: `list_workflows_by_project()` returns workflows filtered by project_id
