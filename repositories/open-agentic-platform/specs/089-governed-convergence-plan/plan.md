# Implementation Plan: Governed Convergence

**Branch**: `089-governed-convergence-plan` | **Date**: 2026-04-11 | **Spec**: [spec.md](spec.md)

## Summary

Converge seven architectural primitives into the non-optional default execution path
across six phases, guided by a validated gap analysis against actual implementation state.

## Technical Context

**Language/Version**: Rust 1.x (crates), TypeScript (desktop + platform)
**Primary Dependencies**: Tauri v2, Encore.ts, hiqlite, axiomregent, tokio, sha2
**Storage**: SQLite (orchestrator, checkpoints), PostgreSQL (Statecraft), S3-compatible (knowledge objects)
**Testing**: cargo test, vitest, integration tests
**Target Platform**: macOS (primary), Linux, Windows (axiomregent cross-compile)
**Project Type**: Desktop app + platform services + CLI tools

## Execution Order

### Phase 0 — Foundation Hardening (090 + 091)

**Parallel tracks**: Governance hardening (090) and registry enrichment (091) have no
dependencies on each other and can be developed concurrently.

```
Track A (090): [1] orchestrator bypass → [2] web_server race → [3] LeaseStore default
               → [4] degradation logging → [5] cross-platform binary → [6] Bypass guard
Track B (091): [1] depends_on field → [2] owner field → [3] risk field
               → [4] featuregraph reads → [5] recompile + validate
```

**Gate**: Both tracks complete before Phase 1 begins.

### Phase 1 — Workspace Envelope (092)

Sequential: each slice builds on the prior.

```
[1] Programmatic workspace selection → [2] ClaudeExecutionRequest threading
→ [3] Orchestrator threading → [4] Checkpoint threading → [5] Factory mandatory
→ [6] Rename WorkspaceTools
```

**Gate**: Workspace_id flows through all execution paths before Phases 2/3 begin.

### Phase 2 + Phase 3 — Parallel Development

Phase 2 (spec-driven preflight, 093) and Phase 3 (artifact memory 094 + checkpoint
branching 095) can run in parallel after Phase 1.

```
Phase 2 Track:  [1] Wire preflight command → [2] ToolCallContext + spec fields
                → [3] spec-status gate → [4] spec-risk gate → [5] dependency gate
                → [6] configurable tool tiers

Phase 3 Track A (094): [1] Fix hash-chain → [2] Consolidate stores → [3] Add metadata
                       → [4] Add provenance → [5] Platform recording

Phase 3 Track B (095): [1] head_sha → [2] fingerprint → [3] branch_name + run_id
                       → [4] checkpoint.compare → [5] approval binding
                       → [6] desktop visualization
```

**Gate**: All three specs complete before Phase 4 begins.

### Phase 4 — Intelligence + Promotion (096 + 097)

Parallel tracks: Portfolio intelligence (096) and promotion-grade mirror (097) are
independent.

```
Track A (096): [1] xray-featuregraph bridge → [2] blast radius → [3] drift command
               → [4] portfolio dashboard

Track B (097): [1] Promotion eligibility → [2] OIDC seam auth → [3] Mandatory sync
               → [4] Promotion API → [5] Desktop indicator
```

**Gate**: Both tracks complete before Phase 5 begins.

### Phase 5 — Convergence Stitching (098 + 099)

Closes four wiring defects that prevent Phases 0–4 subsystems from composing into the
governed execution model. Parallel tracks.

```
Track A (098): [1] DispatchResult/Options fields → [2] GovernedPlan capture + metadata
               → [3] Positive-assertion promotion gate → [4] Mutation preflight in router
               → [5] E2E integration test

Track B (099): [1] SyncTracker struct → [2] SyncStatus plumbing
               [3] SQLite workspace_id migration ─┬─ [5] list_workflows_by_workspace
               [4] Hiqlite workspace_id migration ─┘
```

## Effort Estimates (Implementation Slices)

| Phase | Spec | Slices | Estimated Days |
|-------|------|--------|---------------|
| 0 | 090 Governance Non-Optionality | 6 | 7 |
| 0 | 091 Registry Enrichment | 5 | 3.5 |
| 1 | 092 Workspace Runtime Threading | 6 | 6.5 |
| 2 | 093 Spec-Driven Preflight | 6 | 7 |
| 3 | 094 Unified Artifact Store | 5 | 7 |
| 3 | 095 Checkpoint Branch-of-Thought | 6 | 6 |
| 4 | 096 Portfolio Intelligence | 4 | 5.5 |
| 4 | 097 Promotion-Grade Mirror | 5 | 7 |
| 5 | 098 Governance Enforcement Stitching | 5 | 4 |
| 5 | 099 Workspace-Scoped Persistence | 5 | 4 |
| | **Total** | **53 slices** | **~57.5 days** |

With Phase 0 tracks parallel (~7 days), Phase 2+3 parallel (~7 days), and Phase 4
tracks parallel (~7 days), the critical path compresses to approximately:

```
Phase 0: ~7 days → Phase 1: ~6.5 days → Phase 2+3: ~7 days → Phase 4: ~7 days → Phase 5: ~4 days
Critical path: ~31.5 days
```

## Key Technical Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Governance bypass | Constrain, don't remove | Feature flag for transition; strict mode opt-in initially |
| Workspace threading | Option<String> first | Incremental; mandatory enforcement after validation |
| Tool tier source | TOML config file | Readable, versionable, workspace-overridable |
| Artifact consolidation | CAS additive | Ephemeral path unchanged; CAS is additional persistence |
| Spec gating | Warn mode first | Tune false positives before enforce mode |
| OIDC adoption | Additive with static fallback | No breaking change to existing deployments |
| Checkpoint branching | Extend existing tree | No migration; new fields are Optional |

## File Impact Summary

### High-Impact Files (touched by 3+ specs)

| File | Specs |
|------|-------|
| `crates/orchestrator/src/lib.rs` | 092, 093, 094, 097 |
| `crates/axiomregent/src/checkpoint/provider.rs` | 092, 095 |
| `crates/axiomregent/src/checkpoint/types.rs` | 092, 095 |
| `crates/policy-kernel/src/lib.rs` | 090, 093 |
| `product/apps/opc/src-tauri/src/commands/analysis.rs` | 093, 096 |
| `product/apps/opc/src-tauri/src/governed_claude.rs` | 090, 092 |
| `platform/services/statecraft/api/factory/factory.ts` | 092, 094, 097 |
| `tools/spec-spine/spec-compiler/src/lib.rs` | 091 |
| `crates/featuregraph/src/preflight.rs` | 093, 096 |

### New Files

| File | Spec | Purpose |
|------|------|---------|
| `.oap/tool-tiers.toml` | 093 | Configurable tool tier assignments |
| `crates/featuregraph/src/enrichment.rs` | 096 | xray-featuregraph bridge |
| `crates/orchestrator/src/promotion.rs` | 097 | Promotion eligibility checker |
| `crates/axiomregent/src/router/oidc_client.rs` | 097 | OIDC client_credentials |
| `platform/services/statecraft/api/auth/m2mAuth.ts` | 097 | Shared JWT validation |
