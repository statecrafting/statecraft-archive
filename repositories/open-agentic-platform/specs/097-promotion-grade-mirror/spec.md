---
id: "097-promotion-grade-mirror"
title: "Promotion-Grade Platform Mirror"
status: approved
implementation: complete
owner: bart
created: "2026-04-11"
kind: platform
domain: opc
risk: high
depends_on:
  - "080-github-identity-onboarding"
  - "082-artifact-integrity-platform-hardening"
  - "092-workspace-runtime-threading"
  - "094-unified-artifact-store"
summary: >
  Elevate platform sync from fire-and-forget to promotion-grade. Define run
  promotion eligibility, add CompletedLocal status for local-only completions,
  create a Statecraft promotion validation endpoint, and integrate eligibility
  checks into the orchestrator completion path.
code_aliases: ["PROMOTION_GRADE_MIRROR"]
establishes:
  - unit: { kind: file, path: crates/orchestrator/src/promotion.rs }
extends:
  - spec: "052-state-persistence"
    nature: additive
    unit: { kind: file, path: crates/orchestrator/src/state.rs }
  - spec: "052-state-persistence"
    nature: additive
    unit: { kind: file, path: crates/orchestrator/src/lib.rs }
---

# 097 — Promotion-Grade Platform Mirror

Parent plan: [089 Governed Convergence Plan](../089-governed-convergence-plan/spec.md)

## Problem

Statecraft sync is fire-and-forget by design:

> `StatecraftClient` comment: "all remote calls are best-effort and never block local execution"

This means:
- A completed workflow has no guarantee that its artifacts and events were recorded
  on the platform
- No distinction exists between a fully-synced completion (all evidence on platform)
  and a local-only completion (events/artifacts missing from platform)
- `WorkflowStatus` has `Completed | Failed | TimedOut | AwaitingCheckpoint` — no
  status distinguishes synced vs. unsynced completions
- No API endpoint validates whether a completed run has complete evidence on the
  platform (all events acknowledged, all artifacts recorded)
- Workspace_id is threaded (spec 092) but nothing uses it to determine promotion
  eligibility
- Governance mode tracking (spec 090) records whether governance was active, but
  this is not factored into any completion quality assessment

For the platform to serve as organizational truth for promoted runs, the local
client must distinguish between promotion-eligible and local-only completions.

## Solution

Add a `CompletedLocal` workflow status for runs that finish without full platform
sync. Define promotion eligibility as a structured check (governance active,
workspace present, events synced, artifacts recorded). Add a Statecraft endpoint
that validates promotion eligibility server-side. Integrate the check into the
orchestrator workflow completion path.

## Implementation Slices

### Slice 1: Define run promotion eligibility

New module `crates/orchestrator/src/promotion.rs`:

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum PromotionEligibility {
    Eligible,
    Ineligible { reasons: Vec<String> },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PromotionCheck {
    pub workflow_id: String,
    pub workspace_id: Option<String>,
    pub governance_active: bool,
    pub events_synced: bool,
    pub artifacts_recorded: bool,
    pub all_steps_completed: bool,
    pub eligibility: PromotionEligibility,
}
```

Function: `check_promotion_eligibility(state: &WorkflowState, sync_status: &SyncStatus) -> PromotionCheck`

Checks:
1. `workspace_id` is present in workflow metadata (not `None`)
2. Governance was active during the run (metadata `"governance_mode"` != `"bypass"`)
3. All events were acknowledged by platform (`sync_status.events_synced`)
4. All artifacts were recorded to platform (`sync_status.artifacts_recorded`)
5. All steps completed successfully (no `Failed` or `Skipped` steps)

**Files**: new `crates/orchestrator/src/promotion.rs`, `crates/orchestrator/src/lib.rs`

### Slice 2: Add `CompletedLocal` status

Add `CompletedLocal` variant to `WorkflowStatus`:

```rust
pub enum WorkflowStatus {
    Running,
    Completed,        // fully synced — promotion-eligible
    CompletedLocal,   // finished but platform sync incomplete
    Failed,
    TimedOut,
    AwaitingCheckpoint,
}
```

Add `SyncStatus` tracking struct:

```rust
pub struct SyncStatus {
    pub events_synced: bool,
    pub artifacts_recorded: bool,
    pub last_sync_error: Option<String>,
}
```

When a workflow's last step completes successfully:
- If promotion check passes → `Completed`
- If promotion check fails (missing sync, missing workspace, etc.) → `CompletedLocal`

**Files**: `crates/orchestrator/src/state.rs`

### Slice 3: Statecraft promotion API endpoint

New endpoint in `platform/services/statecraft/api/factory/factory.ts`:

```typescript
// POST /api/workspaces/:workspaceId/promotions
interface PromotionRequest {
  workflowId: string;
  pipelineId: string;
}

interface PromotionResult {
  eligible: boolean;
  promotionId?: string;
  missingRecords: string[];
}
```

Validation logic:
1. Check pipeline exists and belongs to workspace
2. Check all expected stages have records in `factory_stages`
3. Check all expected artifacts have records in `factory_artifacts`
4. Check audit log has completion event
5. If all present → create promotion record, return `eligible: true` with `promotionId`

New table `promotions`:
```sql
CREATE TABLE promotions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL,
  pipeline_id UUID NOT NULL,
  workflow_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'promoted',
  promoted_by TEXT,
  promoted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  evidence JSONB NOT NULL DEFAULT '{}'
);
```

**Files**: `platform/services/statecraft/api/factory/factory.ts`,
`platform/services/statecraft/api/db/schema.ts`,
new migration `platform/services/statecraft/api/db/migrations/11_promotions.up.sql`

### Slice 4: Integrate promotion check into orchestrator completion

In the orchestrator workflow completion path (`dispatch_manifest` and
`dispatch_manifest_persisted`), after the final step succeeds:

1. Compute `SyncStatus` from accumulated event/artifact tracking
2. Run `check_promotion_eligibility`
3. Set `WorkflowStatus::Completed` or `WorkflowStatus::CompletedLocal`
4. Store `PromotionCheck` result in `WorkflowState.metadata["promotion"]`
5. Persist updated state

**Files**: `crates/orchestrator/src/lib.rs`

## Acceptance Criteria

- **SC-097-1**: `CompletedLocal` status distinguishes local-only from fully-synced completions
- **SC-097-2**: `PromotionCheck` validates workspace, governance, event sync, and artifact recording
- **SC-097-3**: Statecraft promotion endpoint validates artifact + event completeness server-side
- **SC-097-4**: Orchestrator automatically sets `CompletedLocal` when platform sync is incomplete
- **SC-097-5**: Promotion metadata is persisted in `WorkflowState.metadata`
