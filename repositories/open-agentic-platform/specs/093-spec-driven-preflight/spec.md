---
id: "093-spec-driven-preflight"
title: "Spec-Driven Preflight and Gating"
status: approved
implementation: complete
owner: bart
created: "2026-04-11"
summary: >
  Connects the enriched spec registry (from Phase 0) to policy-kernel,
  featuregraph, and agent safety so that spec status, risk level, and
  dependency satisfaction gate execution before work starts.
depends_on:
  - "091-registry-enrichment"  # registry-enrichment (dependsOn, owner, risk fields)
  - "092-workspace-runtime-threading"  # workspace-runtime-threading (workspace_id everywhere)
code_aliases: ["SPEC_PREFLIGHT"]
kind: governance
domain: opc
risk: high
extends:
  - spec: "068-permission-runtime"
    nature: additive
    unit: { kind: file, path: crates/policy-kernel/src/lib.rs }
  - spec: "034-featuregraph-registry-scanner-fix"
    nature: additive
    unit: { kind: file, path: crates/featuregraph/src/preflight.rs }
  - spec: "036-safety-tier-governance"
    nature: additive
    unit: { kind: file, path: crates/agent/src/safety.rs }
---

# 093 — Spec-Driven Preflight and Gating

## 1. Problem Statement

Five crates operate in complete silos:

```
spec-compiler → registry.json → featuregraph (display only)
                                               ↕ NO CONNECTION ↕
agent::safety → hardcoded tool tiers (26 entries, static match)
                                               ↕ NO CONNECTION ↕
policy-kernel → ToolCallContext (no feature_id, no spec_status)
                                               ↕ NO CONNECTION ↕
xray → structural metrics (no feature attribution)
```

The enriched registry now carries `dependsOn`, `risk`, `owner`, and `status`
per feature (spec 091). Workspace threading (spec 092) ensures every execution
path carries a workspace context. But no consumer uses these fields to **gate**
runtime behavior — spec status, risk level, and dependency satisfaction are
display-only metadata.

This spec bridges the five silos by:

1. Wiring `governance_preflight` as a Tauri command (library code exists, no binding)
2. Extending `ToolCallContext` with spec-derived fields so policy gates can reason about features
3. Adding a spec-status gate (draft specs → read-only tool ceiling)
4. Adding a spec-risk gate (critical risk → manual confirmation required)
5. Adding a dependency gate (block work on features whose dependencies are still draft)
6. Replacing hardcoded tool tiers with a configurable `.oap/tool-tiers.toml`

## 2. Enabling Code Already Present

| Component | State | Gap |
|-----------|-------|-----|
| `PreflightChecker` | Full preflight logic with `ChangeTier` | Not wired as Tauri command |
| `FeatureGraphTools::governance_preflight()` | Library method | Not in `invoke_handler![]` |
| `ToolCallContext` | Carries tool_name, args, diff metrics | No `feature_ids`, `spec_statuses`, `max_spec_risk` |
| `PolicyBundle` gate chain | 4 gates (secrets, destructive, allowlist, diff) | No spec-status or spec-risk gate |
| `FeatureNode.status` | Populated from registry | Never gated on in `PreflightChecker` |
| `FeatureNode.governance` | Populated with `risk` value | Not used in `calculate_safety_tier()` |
| `FeatureNode.depends_on` | Populated from registry | No dependency satisfaction check |
| `agent::safety::get_tool_metadata()` | 26 hardcoded entries | No config file, no dynamic loading |
| `PolicyOutcome::Degrade` | Enum variant exists | No gate produces it |

## 3. Implementation Slices

### Slice 1 — Wire governance_preflight as Tauri command

**Files**: `product/apps/opc/src-tauri/src/commands/analysis.rs`, `product/apps/opc/src-tauri/src/lib.rs`

Register `governance_preflight` as a Tauri command that:
- Accepts `changed_files: Vec<String>` and `repo_root: String`
- Runs `FeatureGraphTools::governance_preflight()` with a worktree-mode `PreflightRequest`
- Returns `PreflightResponse` (safety_tier, violations, affected features, graph_fingerprint)

### Slice 2 — Extend ToolCallContext with spec fields

**Files**: `crates/policy-kernel/src/lib.rs`

Add three new fields to `ToolCallContext`:
- `feature_ids: Vec<String>` — IDs of features affected by the tool call's target files
- `max_spec_risk: Option<String>` — highest risk level among affected features (low/medium/high/critical)
- `spec_statuses: Vec<String>` — deduplicated statuses of affected features (draft/active/deprecated)

These fields are populated by the caller (featuregraph lookup) before policy evaluation.

### Slice 3 — Add spec-status gate

**Files**: `crates/policy-kernel/src/lib.rs`

New gate `gate_spec_status`:
- If `spec_statuses` contains `"draft"` → produce `Degrade` outcome with reason `policy:degrade:spec_status:draft_read_only`
- If `spec_statuses` contains `"deprecated"` → produce `Deny` with reason `policy:deny:spec_status:deprecated`
- Configurable: policy rules with `gate: "spec_status"` can override behavior
- Gate runs after secrets/destructive but before diff_size

### Slice 4 — Add spec-risk gate

**Files**: `crates/policy-kernel/src/lib.rs`

New gate `gate_spec_risk`:
- If `max_spec_risk` is `"critical"` → produce `Degrade` with reason `policy:degrade:spec_risk:critical_requires_confirmation`
- If `max_spec_risk` is `"high"` → produce `Degrade` with reason `policy:degrade:spec_risk:high_gated`
- `medium` / `low` / absent → no gate triggered
- Gate runs after spec_status gate

### Slice 5 — Add dependency gate to preflight

**Files**: `crates/featuregraph/src/preflight.rs`

Before approving work on changed files, check dependency satisfaction:
- For each affected feature, resolve `depends_on` feature IDs in the graph
- If any dependency has status `draft`, emit a `DEPENDENCY_NOT_READY` warning violation
- If any dependency is missing from the graph entirely, emit a `DEPENDENCY_MISSING` error violation
- Dependency violations escalate `calculate_safety_tier()`: missing deps → Tier3, draft deps → Tier2

### Slice 6 — Replace hardcoded tool tiers with .oap/tool-tiers.toml

**Files**: `crates/agent/src/safety.rs`, `.oap/tool-tiers.toml` (new)

- Create `.oap/tool-tiers.toml` with the current 26 hardcoded entries
- `get_tool_metadata()` loads from TOML file (cached via `OnceLock`), falls back to hardcoded defaults
- Add `load_tool_tiers(path)` function for explicit path loading
- Spec `risk` ceiling: when risk is known, tier cannot exceed the ceiling (critical → Tier1 max)

## 4. Acceptance Criteria

- **SC-093-1**: `governance_preflight` Tauri command returns affected features and ChangeTier for a file set
- **SC-093-2**: Tool dispatch on `draft` spec code is restricted to read-only (Degrade outcome) by default
- **SC-093-3**: Tool dispatch on `critical` risk spec code requires manual confirmation (Degrade outcome)
- **SC-093-4**: Dependency warnings appear when working on features with draft dependencies
- **SC-093-5**: Tool tier assignments are configurable via `.oap/tool-tiers.toml`
- **SC-093-6**: All existing policy-kernel tests continue to pass (backward compatible)

## 5. Non-Functional Requirements

- **NF-093-1**: New gates add < 1ms to evaluate() latency (no I/O in gate functions)
- **NF-093-2**: `.oap/tool-tiers.toml` is loaded once (OnceLock), not per-call
- **NF-093-3**: ToolCallContext extension is backward-compatible (new fields have defaults)
