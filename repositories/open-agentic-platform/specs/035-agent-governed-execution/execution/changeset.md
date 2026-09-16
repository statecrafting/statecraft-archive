---
feature_id: "035-agent-governed-execution"
---

# Changeset

## Scope

Governed agent execution through axiomregent — permission enforcement, safety tier gating, UI controls, audit logging.

## Files

| Area | Path |
|------|------|
| Spike / findings | `.ai/findings/035-mcp-spike.md` (removed — was pre-OSS handoff artifact) |
| Lease + grants | `crates/axiomregent/src/snapshot/lease.rs` |
| Router preflight + audit | `crates/axiomregent/src/router/mod.rs`, `crates/axiomregent/src/router/permissions.rs` |
| MCP binary env | `crates/axiomregent/src/main.rs` |
| Desktop launch | `apps/desktop/src-tauri/src/governed_claude.rs` |
| Agent / Claude / web | `apps/desktop/src-tauri/src/commands/agents.rs`, `claude.rs`, `web_server.rs` |
| opc-web stub | `apps/desktop/src-tauri/src/web_main.rs` (`sidecars` stub) |
| UI | `CreateAgent.tsx`, `AgentExecution.tsx`, `ClaudeCodeSession.tsx`, `api.ts`, `agentStore.ts` |
| Tests / golden | `crates/axiomregent/tests/*`, `tests/golden/tools_list.json` |

## Post-035 hardening (Slice A)

| Area | Path | Change |
|------|------|--------|
| Router preflight | `crates/axiomregent/src/router/mod.rs` | No-lease fallback uses session default grants instead of silent bypass |
| Permissions | `crates/axiomregent/src/router/permissions.rs` | Extract `check_grants()` for lease-less checks; `check_tool_permission` delegates to it |
| Lease store | `crates/axiomregent/src/snapshot/lease.rs` | Add `default_grants()` accessor |
| Permissions visibility | `crates/axiomregent/src/router/mod.rs` | `mod permissions` → `pub mod permissions` for test access |
| NF-001 benchmark | `crates/axiomregent/tests/governed_dispatch_latency.rs` | New: 3 tests for permission check latency + correctness |
| Spec contract notes | `specs/035-agent-governed-execution/spec.md` | Document max_tier rationale + no-lease fallback behavior |
| Scanner wording | `crates/featuregraph/src/scanner.rs` | MISSING_SPEC_FILE suggested_fix leads with `spec-compiler compile` |

## Verification

See [verification.md](./verification.md).
