---
id: "035-agent-governed-execution"
title: "agent execution through governed dispatch"
feature_branch: "035-agent-governed-execution"
status: approved
implementation: complete
kind: platform
domain: opc
created: "2026-03-29"
authors:
  - "open-agentic-platform"
language: en
summary: >
  Route agent and Claude Code execution through axiomregent's governed dispatch so that
  stored permission flags (enable_file_read, enable_file_write, enable_network) and safety
  tiers are enforced at runtime — replacing the unconditional `--dangerously-skip-permissions`
  bypass in all seven execution paths.
code_aliases:
  - AGENT_AUTOMATION
extends:
  - spec: "033-axiomregent-activation"
    nature: additive
    unit: { kind: file, path: product/apps/opc/src-tauri/src/commands/agents.rs }
  - spec: "033-axiomregent-activation"
    nature: additive
    unit: { kind: file, path: product/apps/opc/src-tauri/src/commands/claude.rs }
---

# Feature Specification: agent governed execution

## Purpose

Today all agent and Claude Code execution unconditionally passes `--dangerously-skip-permissions` (7 call sites across `agents.rs`, `claude.rs`, `web_server.rs`). The SQLite `agents` table stores `enable_file_read`, `enable_file_write`, and `enable_network` flags, and the UI displays them, but they are never enforced. The `crates/agent/src/safety.rs` tier model classifies tools but is not consulted at dispatch time. axiomregent is live (Feature 033) but not in the execution path.

This feature closes the gap: agent execution flows through axiomregent's router, which enforces permission flags and safety tiers before dispatching tool calls.

## Scope

### In scope

- **Remove `--dangerously-skip-permissions`** from all 7 call sites (or replace with tier-aware flag selection).
- **Wire agent execution through axiomregent** — the desktop host sends tool-call requests to axiomregent's MCP router (via the sidecar port discovered at startup), which applies permission and tier checks before execution.
- **Enforce stored permission flags** — translate `enable_file_read`, `enable_file_write`, `enable_network` from the agents DB into axiomregent session metadata that gates tool dispatch.
- **Tier-gated dispatch** — axiomregent's router checks `safety.rs::get_tool_tier()` against the session's maximum allowed tier. Tier 2+ tools require explicit grant; Tier 3 tools require human confirmation or are blocked.
- **Expose permission controls in UI** — surface the three permission toggles in agent create/edit so users can actually configure them (currently hardcoded to defaults).
- **Audit trail** — axiomregent logs tool calls with tier, permission decision, and session ID to stderr (or a structured log target).

### Out of scope

- **Titor temporal safety** — checkpoint/restore commands remain stubs (separate feature).
- **Safety tier spec governance** — formalizing tier definitions in a spec is a follow-on; this feature uses the existing `safety.rs` classification as-is.
- **Cross-platform axiomregent binaries** — only macOS arm64 binary exists; other platforms degrade gracefully (033 residual).
- **Feature ID reconciliation** — kebab vs UPPERCASE IDs remain unbridged.
- **MCP protocol changes** — axiomregent's existing JSON-RPC protocol is sufficient; no new wire format.

## Requirements

### Functional

- **FR-001**: When an agent is executed, the desktop host sends tool-call requests to axiomregent's MCP router instead of (or in addition to) direct Claude CLI invocation with `--dangerously-skip-permissions`.
- **FR-002**: axiomregent's router consults `get_tool_tier(tool_name)` and the session's permission grants before dispatching each tool call. A `Tier2` tool with `enable_file_write=false` returns `PermissionDenied`.
- **FR-003**: The agent create/edit UI exposes toggles for `enable_file_read`, `enable_file_write`, and `enable_network`. Changes persist to SQLite and are read at execution time.
- **FR-004**: When axiomregent is unavailable (degraded state), execution falls back to the current direct-CLI path **with a visible warning** in the UI that governance is not enforced.
- **FR-005**: Each tool dispatch through axiomregent produces a structured log entry (tool name, tier, permission decision, timestamp) retrievable via `run.logs` or stderr.

### Non-functional

- **NF-001**: Governed dispatch adds < 50ms p99 latency per tool call over direct execution.
- **NF-002**: No regression to existing agent execution UX when axiomregent is healthy.

## Architecture

### Execution flow (governed)

```
UI execute_agent() / execute_claude_code()
  |
  v
Tauri command handler
  |
  +---> Read agent permissions from SQLite
  |
  +---> Check axiomregent sidecar port (SidecarState)
  |
  +---> [axiomregent available]
  |       |
  |       v
  |     Create governed session (lease + permission grants)
  |       |
  |       v
  |     Claude CLI invoked WITHOUT --dangerously-skip-permissions
  |     (or with axiomregent as MCP server providing governed tools)
  |       |
  |       v
  |     Tool calls routed through axiomregent router
  |       |
  |       v
  |     Router: check_tier() + check_permissions() -> dispatch or PermissionDenied
  |
  +---> [axiomregent unavailable]
          |
          v
        Fallback: direct CLI with --dangerously-skip-permissions
        + UI warning: "Governance bypass — axiomregent unavailable"
```

### Key integration points

| Component | File | Change |
|-----------|------|--------|
| Agent execution | `commands/agents.rs:774` | Replace hardcoded bypass with governed dispatch |
| Claude execute | `commands/claude.rs:969,1001,1036` | Same |
| Web server | `web_server.rs:494,607,695` | Same |
| axiomregent router | `router/mod.rs` | Add tier + permission check before tool dispatch |
| Safety tiers | `crates/agent/src/safety.rs` | Already exists — no changes needed |
| Permission error | `router/mod.rs:40` | `PermissionDenied` variant already exists |
| Lease extension | `snapshot/lease.rs` | Extend `Lease` struct with permission grants |
| UI agent form | `CreateAgent.tsx` | Add permission toggle controls |
| Frontend API | `api.ts` | Add permission fields to Agent interface and API calls |

## Success criteria

- **SC-001**: With axiomregent running, an agent with `enable_file_write=false` attempting `workspace.write_file` receives `PermissionDenied` and the tool call is blocked.
- **SC-002**: With axiomregent running, a Tier 1 tool (`gov.preflight`) executes without permission gates.
- **SC-003**: With axiomregent unavailable, execution falls back to direct CLI with a visible governance-bypass warning.
- **SC-004**: The agent create/edit UI shows functional permission toggles that persist to the database.
- **SC-005**: `execution/verification.md` records commands and results for all criteria.

## Contract notes

- axiomregent sidecar port is discovered via `SidecarState` (Feature 033).
- Lease IDs from `snapshot/lease.rs` serve as session tokens for permission binding.
- `AxiomRegentError::PermissionDenied` (router error code `PERMISSION_DENIED`) is the wire-level denial signal.
- Degraded fallback preserves the pre-035 behavior exactly — this is a non-breaking change for platforms without axiomregent.
- **Agent max_tier=3 vs Claude max_tier=2**: Agents receive `max_tier: 3` because their per-permission flags (`enable_file_read/write/network`) are the primary enforcement mechanism — the tier ceiling would redundantly block tools already gated by those flags. Interactive Claude Code sessions receive `max_tier: 2` as a blanket safety cap because they have all permissions enabled by default. This is intentional: agents are individually configurable; direct sessions use tier as the sole guardrail.
- **No-lease fallback**: Tool calls without a `lease_id` are checked against the session's default grants (from `OPC_GOVERNANCE_GRANTS` env or `claude_default()`). The fallback is audit-logged with `allowed_no_lease` / `denied_no_lease` decision tags.

## Risk

- **R-001**: Claude CLI may not support axiomregent as an MCP tool provider in all execution modes (execute, continue, resume). Mitigation: spike T001 to validate the integration pattern before full implementation.
- **R-002**: Latency overhead from MCP round-trips may be noticeable on complex agent plans. Mitigation: NF-001 measurement gate; batch tool calls where possible.
- **R-003**: Fallback path preserves the security gap for non-macOS platforms. Mitigation: document as known limitation; cross-platform binaries tracked separately.
