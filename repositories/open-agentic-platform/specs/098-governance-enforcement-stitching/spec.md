---
id: "098-governance-enforcement-stitching"
title: "Governance Enforcement Stitching"
status: approved
implementation: complete
owner: bart
created: "2026-04-11"
kind: governance
domain: opc
risk: high
depends_on:
  - "090-governance-non-optionality"
  - "093-spec-driven-preflight"
  - "097-promotion-grade-mirror"
code_aliases: ["GOVERNANCE_ENFORCEMENT_STITCHING"]
extends:
  - spec: "097-promotion-grade-mirror"
    nature: additive
    unit: { kind: file, path: crates/orchestrator/src/promotion.rs }
  - spec: "097-promotion-grade-mirror"
    nature: additive
    unit: { kind: file, path: crates/orchestrator/src/lib.rs }
  - spec: "033-axiomregent-activation"
    nature: additive
    unit: { kind: file, path: crates/axiomregent/src/router/mod.rs }
  - spec: "033-axiomregent-activation"
    nature: additive
    unit: { kind: file, path: crates/axiomregent/src/router/permissions.rs }
summary: >
  Wire governance mode into live workflow metadata and make MCP router preflight
  blocking for mutation tools. Closes two stitching defects that leave governance
  advisory rather than constitutional.
---

# 098 — Governance Enforcement Stitching

Parent plan: [089 Governed Convergence](../089-governed-convergence-plan/plan.md) — Phase 5

## Problem

Two independently-implemented governance subsystems fail to compose:

1. **Governance mode is determined but lost.** `governed_claude.rs:plan_governed_from_binary()`
   computes a `GovernedPlan` (Governed or Bypass) at dispatch time, but this information never
   flows into `DispatchResult` or `WorkflowState.metadata`. The promotion eligibility check at
   `promotion.rs` lines 58-63 reads `governance_mode` from metadata and defaults to `"unknown"`
   when absent. Since `"unknown" != "bypass"`, bypassed runs silently pass the governance check,
   making promotion eligibility unreliable.

2. **MCP mutation preflight is advisory.** The router at `router/mod.rs` runs
   `preflight_tool_permission()` (tier/permission grants) before dispatching tools, but
   `gov.preflight` exists only as a tool the AI can call voluntarily. Mutation tools
   (`repo.write_file`, `repo.apply_patch`, `repo.delete`) dispatch after passing only the grants
   check. An agent calling `repo.write_file` directly via MCP bypasses the validator's
   `client.preflight()` enforcement. Additionally, `apply_risk_ceiling()` in `safety.rs` is
   defined and tested but never called from production code.

## Solution

Close both enforcement gaps: thread governance mode through the dispatch chain into persisted
metadata, and make the MCP router auto-run featuregraph preflight before allowing mutations.

### Slice 1: governance_mode field in DispatchResult + DispatchOptions

Add `pub governance_mode: Option<String>` to both structs in `crates/orchestrator/src/lib.rs`.
Field is `Option` for backward compatibility — defaults to `None` in existing callers.

**Files**: `crates/orchestrator/src/lib.rs`

### Slice 2: Capture GovernedPlan and thread to metadata

In `dispatch_via_governed_claude` (`product/apps/opc/src-tauri/src/commands/orchestrator.rs`),
derive `"governed"` or `"bypass"` from the `GovernedPlan` variant and set it on
`DispatchResult.governance_mode`.

In `dispatch_manifest_persisted` (`crates/orchestrator/src/lib.rs`), read
`options.governance_mode` and insert into `wf_metadata`:

```rust
if let Some(ref gm) = options.governance_mode {
    wf_metadata.insert("governance_mode".to_string(), JsonValue::String(gm.clone()));
}
```

Thread the same into the non-persisted `dispatch_manifest` path's `RunSummary.metadata`.

**Files**: `crates/orchestrator/src/lib.rs`, `product/apps/opc/src-tauri/src/commands/orchestrator.rs`

### Slice 3: Positive-assertion promotion gate

Change `promotion.rs` line 63 from negative exclusion:
```rust
let governance_active = governance_mode != "bypass";
```
to positive assertion:
```rust
let governance_active = governance_mode == "governed";
```

This ensures runs with missing or unknown governance mode are correctly marked ineligible.

**Files**: `crates/orchestrator/src/promotion.rs`

### Slice 4: Mutation preflight enforcement in MCP router

Define a `MutationPreflight` trait:
```rust
#[async_trait]
pub trait MutationPreflight: Send + Sync {
    async fn check_mutation(&self, repo_root: &str, paths: &[String], intent: &str)
        -> Result<bool, String>;
}
```

Add `preflight_checker: Option<Arc<dyn MutationPreflight>>` to the `Router` struct.
Implement `MutationPreflight` for `FeatureTools`.

Add `run_mutation_preflight` method to Router that:
- Checks `get_tool_metadata(name).requires_file_write`
- Extracts `changed_paths` from mutation tool arguments
- Calls `preflight_checker.check_mutation(repo_root, &paths, intent)`
- Returns JSON-RPC error if `allowed == false`

Insert in `handle_request` after `preflight_tool_permission`, before dlock acquisition.

Wire `apply_risk_ceiling()` from `agent::safety` into `check_grants()` in `permissions.rs`.

**Files**: `crates/axiomregent/src/router/mod.rs`, `crates/axiomregent/src/router/permissions.rs`,
`crates/axiomregent/src/feature_tools.rs`, `crates/agent/src/safety.rs`

### Slice 5: End-to-end integration test

Test the full governance-to-promotion chain:
1. Create workflow with `GovernedPlan::Bypass`
2. Run through `dispatch_manifest_persisted`
3. Assert `metadata["governance_mode"] == "bypass"`
4. Assert `PromotionCheck.governance_active == false`
5. Assert `WorkflowStatus::CompletedLocal`

**Files**: `crates/orchestrator/src/lib.rs`, `crates/orchestrator/tests/integration_052.rs`

## Acceptance Criteria

- **SC-098-1**: `DispatchResult` carries `governance_mode` populated from `GovernedPlan`
- **SC-098-2**: `WorkflowState.metadata["governance_mode"]` is set to `"governed"` or `"bypass"` for all persisted workflow runs
- **SC-098-3**: `check_promotion_eligibility` marks runs without explicit `"governed"` mode as ineligible
- **SC-098-4**: MCP mutation tools (`repo.write_file`, `repo.apply_patch`, `repo.delete`) are blocked when featuregraph preflight returns `allowed: false`
- **SC-098-5**: `apply_risk_ceiling()` is called in the router's permission check path
- **SC-098-6**: End-to-end test confirms bypass run produces `CompletedLocal` status
