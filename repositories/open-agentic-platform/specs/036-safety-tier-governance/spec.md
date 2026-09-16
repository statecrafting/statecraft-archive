---
id: "036-safety-tier-governance"
title: "safety tier governance"
feature_branch: "036-safety-tier-governance"
status: approved
implementation: complete
kind: platform
domain: opc
created: "2026-03-29"
authors:
  - "open-agentic-platform"
language: en
summary: >
  Formalize the safety tier model (Tier1=Autonomous, Tier2=Gated, Tier3=Manual) in a
  spec-governed definition, fix 13 tools that incorrectly default to Tier3, reconcile the
  dual SafetyTier enums, and surface per-tool tier assignments in the governance UI.
code_aliases: ["SAFETY_TIER_GOVERNANCE"]
refines:
  - aspect: "safety-tier-classification"
    unit: { kind: file, path: crates/agent/src/safety.rs }
  - aspect: "safety-tier-classification"
    unit: { kind: directory, path: crates/axiomregent/src/router }
establishes:
  - unit: { kind: crate, id: tool-registry }
  - unit: { kind: crate, id: open_agentic_policy_kernel }
---

# Feature Specification: safety tier governance

## Purpose

The safety tier model is now enforcement-critical: Feature 035 consults `get_tool_tier()` on every tool dispatch through axiomregent's router, and the result determines whether a call is allowed or blocked based on the session's `max_tier` ceiling. However, tier definitions and assignments exist only in code (`crates/agent/src/safety.rs`), with no spec authority. Thirteen of twenty-one router tools default to Tier3 (the most restrictive) because they lack explicit classification — including read-only tools like `snapshot.read`, `xray.scan`, and `run.logs` that should be Tier1.

Additionally, two separate `SafetyTier` enums exist (`agent::safety::Tier` for tool dispatch, `featuregraph::preflight::SafetyTier` for change classification) with identical names but different semantics. The governance UI displays hardcoded tier labels from `analysis.rs` rather than deriving them from the authoritative tier definitions.

This feature formalizes the tier model so that assignments are auditable, the UI reflects actual enforcement state, and new tools cannot be added without explicit tier classification.

## Scope

### In scope

- **Spec-govern tier definitions** — document the three tiers, their semantics, and the criteria for assignment.
- **Classify all 21 router tools** — every tool in axiomregent's `tools/list` gets an explicit tier assignment in `get_tool_tier()`, eliminating the Tier3 catch-all for known tools.
- **Reconcile dual enums** — either unify `agent::safety::Tier` and `featuregraph::preflight::SafetyTier` into a shared type, or document the distinction as intentional with a clear naming convention.
- **Surface per-tool tier assignments in UI** — governance panel shows which tools are Tier1/2/3, not just the tier reference labels.
- **Add a compile-time or test-time check** that every tool in the router's `tools/list` has an explicit tier assignment (no silent Tier3 defaults for known tools).

### Out of scope

- **Tier enforcement changes** — the enforcement logic in `permissions.rs` is correct and unchanged. This feature governs the *input data* (assignments), not the *enforcement mechanism*.
- **Dynamic tier configuration** — tiers remain code-defined. A future feature could make them configurable via spec files, but this feature establishes the governance foundation.
- **Permission flag changes** — `enable_file_read/write/network` flags are orthogonal to tiers and not modified.
- **Cross-platform axiomregent binaries** (033 residual).

## Requirements

### Functional

- **FR-001**: Every tool in axiomregent's `tools/list` response has an explicit entry in `get_tool_tier()`. The Tier3 catch-all applies only to truly unknown/external tool names, not to tools the router itself exposes.
- **FR-002**: A test asserts that the set of tools in `tools/list` matches the set of tools with explicit tier assignments. Adding a tool to the router without classifying it fails the test.
- **FR-003**: The governance UI displays per-tool tier assignments (tool name + tier label), not just the three-tier reference table.
- **FR-004**: The dual `SafetyTier` enums are either unified into a single shared crate type or explicitly documented as distinct systems with different naming to avoid confusion.

### Non-functional

- **NF-001**: No regression to existing tier enforcement behavior (Tier1 tools still pass, Tier2+ tools still require sufficient `max_tier`).
- **NF-002**: Tier assignment data is derivable from code (no external config files required).

## Architecture

### Proposed tier assignments for currently-unclassified tools

| Tool | Current (default) | Proposed | Rationale |
|------|-------------------|----------|-----------|
| `snapshot.list` | Tier3 | **Tier1** | Read-only: lists existing snapshots |
| `snapshot.read` | Tier3 | **Tier1** | Read-only: reads snapshot content |
| `snapshot.grep` | Tier3 | **Tier1** | Read-only: searches snapshot content |
| `snapshot.diff` | Tier3 | **Tier1** | Read-only: compares snapshots |
| `snapshot.changes` | Tier3 | **Tier1** | Read-only: lists changed files |
| `snapshot.export` | Tier3 | **Tier1** | Read-only: exports snapshot as archive |
| `xray.scan` | Tier3 | **Tier1** | Read-only: scans code structure |
| `run.status` | Tier3 | **Tier1** | Read-only: checks command status |
| `run.logs` | Tier3 | **Tier1** | Read-only: reads command output |
| `run.execute` | Tier3 | **Tier3** | Executes arbitrary commands — correctly dangerous |
| `agent.verify` | Tier3 | **Tier1** | Read-only: validates agent plan |
| `agent.propose` | Tier3 | **Tier2** | Creates an agent proposal (write, but bounded) |
| `agent.execute` | Tier3 | **Tier3** | Executes agent plan — correctly dangerous |

### Enum reconciliation

**Recommended approach:** Keep both enums but rename to clarify scope:
- `agent::safety::Tier` → `agent::safety::ToolTier` (governs tool dispatch permissions)
- `featuregraph::preflight::SafetyTier` → `featuregraph::preflight::ChangeTier` (governs change classification)

This avoids a shared dependency between unrelated crates while making the distinction explicit.

### Key integration points

| Component | File | Change |
|-----------|------|--------|
| Tool tier assignments | `crates/agent/src/safety.rs` | Expand `get_tool_tier()` to cover all 21 tools |
| Tier enum rename | `crates/agent/src/safety.rs` | `Tier` → `ToolTier` |
| Change tier rename | `crates/featuregraph/src/preflight.rs` | `SafetyTier` → `ChangeTier` |
| Coverage test | `crates/axiomregent/tests/` | New test: tools_list tools == get_tool_tier explicit entries |
| UI tier display | `GovernanceSurface.tsx` | Show per-tool tier assignments from backend |
| Backend tier data | `analysis.rs` | Emit per-tool tier map alongside tier reference |

## Success criteria

- **SC-001**: `cargo test` includes a test that fails if a tool is added to the router without an explicit tier assignment.
- **SC-002**: `get_tool_tier()` has explicit entries for all 21 current router tools (no catch-all hits for known tools).
- **SC-003**: The governance UI shows per-tool tier assignments.
- **SC-004**: The dual enum types have distinct names reflecting their different domains.
- **SC-005**: `execution/verification.md` records commands and results.

## Contract notes

- Tier assignments in this spec are **proposed** — review by claude before implementation. The key judgment call is `snapshot.export` (Tier1 vs Tier2: export creates a file, but reads existing data).
- The `write_file` entry in `get_tool_tier()` (line 47) appears to be a legacy alias for `workspace.write_file`. Confirm whether it's still reachable or can be removed.
- Renaming enums is a breaking change for any external consumers. Currently both enums are crate-internal, so the blast radius is contained.
- The `permissions.rs` functions `requires_file_read/write/network` should also be checked for coverage against all 21 tools after tier reclassification.

## Risk

- **R-001**: Reclassifying tools from Tier3 to Tier1/2 relaxes security for sessions with `max_tier < 3`. Mitigation: only read-only tools are promoted; the permission flags (`enable_file_read`) provide a second enforcement layer.
- **R-002**: Enum rename touches many files. Mitigation: mechanical find-and-replace; existing tests catch regressions.
