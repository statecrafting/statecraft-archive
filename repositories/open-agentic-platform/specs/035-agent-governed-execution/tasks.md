# Tasks: agent governed execution

**Input**: `/specs/035-agent-governed-execution/`
**Prerequisites**: Features **033** (axiomregent alive), **034** (registry scanner)

## Phase 0: Spike

- [x] T001 Validate axiomregent-as-MCP-server integration pattern: can Claude CLI use axiomregent's port as an `--mcp-server` for governed tool dispatch? Produce a findings doc with the viable wiring pattern (or an alternative if MCP server mode is insufficient).

## Phase 1: Permission infrastructure

- [x] T002 Extend axiomregent `Lease` struct with permission grants (`enable_file_read`, `enable_file_write`, `enable_network`, `max_tier: Tier`). Add a `check_permission(tool_name, lease)` function that consults `get_tool_tier()` + grant flags.
- [x] T003 Wire `check_permission` into `Router::handle_request()` before tool dispatch. Return `PermissionDenied` for denied calls. Unit tests for each tier/permission combination.

## Phase 2: Desktop integration

- [x] T004 Replace `--dangerously-skip-permissions` in `agents.rs:execute_agent()` with governed dispatch through axiomregent sidecar port. Read agent permission flags from SQLite and pass them as session metadata.
- [x] T005 Replace `--dangerously-skip-permissions` in `claude.rs` (3 sites: execute, continue, resume) with governed dispatch. Default permissions for non-agent Claude sessions: all enabled, max tier 2.
- [x] T006 Replace `--dangerously-skip-permissions` in `web_server.rs` (3 sites) with governed dispatch matching T005 pattern.
- [x] T007 Implement fallback: when `SidecarState::axiomregent_port` is `None`, fall back to direct CLI with `--dangerously-skip-permissions` + emit a `governance_bypassed` event to the frontend.

## Phase 3: UI

- [x] T008 Add permission toggle controls (enable_file_read, enable_file_write, enable_network) to agent create/edit UI (`CreateAgent.tsx`). Wire through `api.ts` Agent interface and `createAgent`/`updateAgent` API calls.
- [x] T009 Show governance status indicator in execution UI: "Governed" (green) when axiomregent is routing, "Bypass" (amber) when fallback is active.

## Phase 4: Observability

- [x] T010 Add structured audit logging in axiomregent router: tool name, tier, permission decision, session/lease ID, timestamp. Output to stderr (consistent with 033 probe port pattern).

## Phase 5: Closure

- [x] T011 `cargo test -p axiomregent`, `cargo test -p agent`, desktop `pnpm run check` green. Latency measurement (NF-001).
- [x] T012 Update `execution/changeset.md` and `execution/verification.md`
- [x] T013 Set spec `status: active` when verification proves delivery
