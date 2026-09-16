---
id: "090-governance-non-optionality"
title: "Governance Non-Optionality"
status: approved
implementation: complete
owner: bart
created: "2026-04-11"
kind: governance
domain: opc
risk: high
depends_on:
  - "033-axiomregent-activation"
  - "068-permission-runtime"
summary: >
  Eliminate all silent bypass surfaces so governance is the non-optional default.
  Four bypass paths (orchestrator inline, web_server env race, LeaseStore permissive
  default, DefaultMode::Bypass at non-policy tier) are closed or guarded. Axiomregent
  cross-platform builds reduce the platform gap.
code_aliases: ["GOVERNANCE_NON_OPTION"]
extends:
  - spec: "033-axiomregent-activation"
    nature: additive
    unit: { kind: file, path: crates/axiomregent/src/lease.rs }
  - spec: "068-permission-runtime"
    nature: additive
    unit: { kind: file, path: crates/policy-kernel/src/permission.rs }
  - spec: "068-permission-runtime"
    nature: additive
    unit: { kind: file, path: crates/policy-kernel/src/merge.rs }
  - spec: "035-agent-governed-execution"
    nature: additive
    unit: { kind: file, path: product/apps/opc/src-tauri/src/commands/orchestrator.rs }
---

# 090 — Governance Non-Optionality

Parent plan: [089 Governed Convergence Plan](../089-governed-convergence-plan/spec.md)

## Problem

Governance infrastructure exists (axiomregent, MCP routing, policy-kernel) but remains
operationally optional. Four bypass surfaces allow silent fallback:

| Location | Mechanism |
|----------|-----------|
| `orchestrator.rs:dispatch_via_governed_claude()` | Inline `--dangerously-skip-permissions` |
| `web_server.rs` | `OPC_AXIOMREGENT_PORT` env var race |
| `lease.rs:LeaseStore::new()` | Defaults to `test_permissive()` (max_tier: 3) |
| `permission.rs:DefaultMode::Bypass` | Any settings tier can enable bypass |

Additional risks:
- axiomregent ships only for macOS aarch64 — all other platforms always bypass
- `LeaseStore::new()` defaults to `test_permissive()` — footgun for non-test code

## Implementation Slices

### 1. Eliminate silent orchestrator bypass (1 day)
- Refactor `dispatch_via_governed_claude()` in `commands/orchestrator.rs` to call shared `plan_governed()` instead of inline duplication
- Emit `governance-mode` event from orchestrator path
- Files: `product/apps/opc/src-tauri/src/commands/orchestrator.rs`

### 2. Fix web_server port detection race (0.5 day)
- Replace `std::env::var("OPC_AXIOMREGENT_PORT")` in `web_server.rs` with shared `SidecarState` or watch pattern
- Files: `product/apps/opc/src-tauri/src/web_server.rs`, `product/apps/opc/src-tauri/src/sidecars.rs`

### 3. Fix LeaseStore default (0.5 day)
- Change `LeaseStore::new()` default from `test_permissive()` to `claude_default()` (max_tier: 2)
- Move `test_permissive()` to a `#[cfg(test)]` helper
- Files: `crates/axiomregent/src/lease.rs`

### 4. Add governance degradation logging (1 day)
- When `GovernedPlan::Bypass` is selected, log structured warning with reason
- Add `governance_bypass_reason` field to the `governance-mode` event payload
- Desktop UI: amber badge shows reason tooltip on hover
- Files: `governed_claude.rs`, `AgentExecution.tsx`, `ClaudeCodeSession.tsx`

### 5. Cross-platform axiomregent binary (3 days, extends spec 037)
- Add CI build targets for `x86_64-unknown-linux-gnu`, `aarch64-unknown-linux-gnu` _(Intel Mac `x86_64-apple-darwin` dropped 2026-04-15)_
- Bundle all targets in Tauri sidecar config
- Files: `.github/workflows/`, `product/apps/opc/src-tauri/tauri.conf.json`

### 6. Guard DefaultMode::Bypass at policy tier (1 day)
- `PermissionRuntime::evaluate()`: if `DefaultMode::Bypass` at non-Policy tier, log warning and fall through to `Ask`
- Only Policy tier (Tier 1) may enable bypass mode
- Files: `crates/policy-kernel/src/permission.rs`, `crates/policy-kernel/src/merge.rs`

## Acceptance Criteria

- SC-090-1: No Claude Code session starts with `--dangerously-skip-permissions` when axiomregent is running
- SC-090-2: Orchestrator dispatch emits `governance-mode` event
- SC-090-3: web_server correctly detects axiomregent port even when set after process start
- SC-090-4: `LeaseStore::new()` in non-test code uses `claude_default()` grants
- SC-090-5: `OAP_PERMISSION_MODE=bypass` at env/user/project tier is overridden to `ask`

## Dependencies

| Spec | Relationship |
|------|-------------|
| 033-axiomregent-activation | Base sidecar infrastructure |
| 035-agent-governed-execution | Governed dispatch model |
| 036-safety-tier-governance | Tool tier model |
| 037-cross-platform-axiomregent | Cross-platform binary (extended by slice 5) |
| 068-permission-runtime | Permission evaluation |
