---
id: "094-unified-artifact-store"
title: "Unified Artifact Store with Provenance"
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
  - "082-artifact-integrity-platform-hardening"
  - "092-workspace-runtime-threading"
summary: >
  Consolidate the two disconnected artifact stores (orchestrator ephemeral +
  factory CAS) into a unified content-addressed store with metadata, provenance
  lineage, and platform recording. Fixes hash-chain verification gap in the
  persisted dispatch path.
code_aliases: ["UNIFIED_ARTIFACT_STORE"]
establishes:
  - unit: { kind: file, path: crates/orchestrator/src/promotion.rs }
extends:
  - spec: "052-state-persistence"
    nature: additive
    unit: { kind: file, path: crates/orchestrator/src/artifact.rs }
  - spec: "052-state-persistence"
    nature: additive
    unit: { kind: file, path: crates/orchestrator/src/lib.rs }
  - spec: "075-factory-workflow-engine"
    nature: additive
    unit: { kind: file, path: crates/factory-engine/src/artifact_store.rs }
---

# 094 — Unified Artifact Store with Provenance

Parent plan: [089 Governed Convergence Plan](../089-governed-convergence-plan/spec.md)

> **Amended by spec 119 (2026-04-29):** the unit of governance referenced as `workspace`/`workspace_id` in this spec is now `project`/`project_id`. The artifact-store contract is unchanged; only the scope identifier renames. See spec 119 for the migration record.

## Problem

Two disconnected artifact stores exist with no integration:

| Store | Location | Purpose | Platform Integration |
|-------|----------|---------|---------------------|
| Orchestrator `ArtifactManager` | `$OAP_ARTIFACT_DIR/<run_id>/<step_id>/` | Ephemeral per-run | None |
| Factory `LocalArtifactStore` | `~/.oap/artifact-store/<hash[0:2]>/<hash>/` | Persistent CAS | None |

Specific gaps:
- Hash-chain input verification (`completed_hashes`) only works in the non-persisted
  dispatch path (`dispatch_manifest`) — the persisted path (`dispatch_manifest_persisted`)
  accumulates no hashes and performs no input integrity checks
- No artifact metadata beyond `filename -> SHA-256` (no tags, provenance, content-type)
- `StepSummaryEntry.output_hashes` written only to local `summary.json` — no platform recording
- No Statecraft API integration for artifacts (zero HTTP calls from artifact paths)
- `cleanup_run()` deletes everything; no cross-run reuse

## Solution

Unify the stores: `ArtifactManager` remains the ephemeral workspace, but completed
artifacts are promoted to `LocalArtifactStore` (CAS) with rich metadata in SQLite.
Provenance lineage tracks producer/consumer relationships. Platform recording enables
cross-project artifact discovery.

## Implementation Slices

### Slice 1: Fix hash-chain in persisted dispatch path

Add `completed_hashes: HashMap<String, HashMap<String, String>>` accumulator to
`dispatch_manifest_persisted`. After each step completes successfully, populate
the accumulator from `step_output_hashes`. Before each step starts, verify input
artifact integrity against the accumulator — matching the existing behavior in
`dispatch_manifest`.

**Files**: `crates/orchestrator/src/lib.rs`

### Slice 2: Consolidate artifact stores (ephemeral -> CAS)

Add a `promote_to_cas()` method to `ArtifactManager` that:
1. Accepts a reference to `LocalArtifactStore`
2. After step completion, copies each output artifact to the CAS via `store()`
3. Returns the CAS metadata (`StoredArtifact`) for each promoted file

Integrate into both dispatch paths: after a step succeeds and output hashes are
computed, call `promote_to_cas()` to persist in the content-addressed store.

**Files**: `crates/orchestrator/src/artifact.rs`, `crates/orchestrator/src/lib.rs`,
`crates/orchestrator/Cargo.toml`

### Slice 3: Add artifact metadata (SQLite artifact_records)

New struct `ArtifactRecord`:
```rust
pub struct ArtifactRecord {
    pub content_hash: String,
    pub filename: String,
    pub step_id: String,
    pub workflow_id: String,
    pub project_id: Option<String>,
    pub created_at: String,
    pub size_bytes: u64,
    pub content_type: Option<String>,
    pub producer_agent: Option<String>,
}
```

Store metadata in a SQLite `artifact_records` table alongside CAS blobs.
Query support: lookup by content_hash, by workflow_id, by project_id.

**Files**: `crates/factory-engine/src/artifact_store.rs`

### Slice 4: Add provenance lineage (produced_by / consumed_by)

New table `artifact_lineage`:
```sql
CREATE TABLE artifact_lineage (
    content_hash TEXT NOT NULL,
    relationship TEXT NOT NULL,  -- 'produced_by' | 'consumed_by'
    workflow_id TEXT NOT NULL,
    step_id TEXT NOT NULL,
    agent_id TEXT,
    created_at TEXT NOT NULL,
    PRIMARY KEY (content_hash, relationship, workflow_id, step_id)
);
```

Record `produced_by` when `promote_to_cas` stores an artifact.
Record `consumed_by` when `dispatch_with_verify` reads an input artifact.

Query support: "which steps consumed this artifact?" and "what produced this?"

**Files**: `crates/factory-engine/src/artifact_store.rs`

### Slice 5: Platform artifact recording (Statecraft endpoint)

After step completion + CAS storage, POST artifact metadata to Statecraft.

New Statecraft endpoints:
- `POST /api/projects/:id/artifacts` — record artifact metadata
- `GET /api/projects/:id/artifacts?content_hash=X` — cache-hit lookup

Activates spec 082 Phase 3 (cross-run persistence).

**Files**: `platform/services/statecraft/api/factory/factory.ts`,
`crates/orchestrator/src/lib.rs`

## Acceptance Criteria

- **SC-094-1**: Hash-chain verification works in both persisted and non-persisted dispatch paths
- **SC-094-2**: Completed step artifacts are stored in CAS with content-hash deduplication
- **SC-094-3**: `ArtifactRecord` carries provenance (producer step, consumer steps)
- **SC-094-4**: Statecraft stores artifact metadata and supports cache-hit lookup
- **SC-094-5**: Re-running a pipeline detects prior identical artifacts via content hash
