# Verification: agent governed execution

**Feature**: `035-agent-governed-execution`

## Commands

Run from repository root where applicable.

```bash
cd crates/axiomregent && cargo test
cd crates/agent && cargo test
cd apps/desktop/src-tauri && cargo check
cd apps/desktop && pnpm run check
```

## Evidence

| Criterion | Result |
|-----------|--------|
| axiomregent unit + integration tests | `cargo test` in `crates/axiomregent` — green (2026-03-29) |
| agent crate | `cargo test` in `crates/agent` — green |
| Desktop typecheck | `pnpm run check` in `apps/desktop` — green |
| T001 spike | MCP via `--mcp-config` + stdio binary; probe port not MCP transport (findings file removed with .ai/ cleanup) |

### NF-001 (latency)

Governed path adds MCP subprocess startup and JSON-RPC handling. Permission check overhead measured by `governed_dispatch_latency` test:
- `permission_check_under_50ms`: 10,000 checks across 10 tools — sub-microsecond per call
- `permission_check_grants_fallback_under_50ms`: no-lease fallback path — sub-microsecond per call
- Both well within the 50ms NF-001 budget (governance overhead is negligible; tool execution dominates)

```bash
cd crates/axiomregent && cargo test --test governed_dispatch_latency
```

### Post-035 hardening (2026-03-29)

| Fix | Evidence | Status |
|-----|----------|--------|
| No-lease bypass (Risk 1) | `router/mod.rs:preflight_tool_permission` — falls back to session default grants; audit-logs `allowed_no_lease`/`denied_no_lease` | **Fixed** |
| max_tier rationale | `spec.md` contract notes — documents agent max_tier=3 vs claude max_tier=2 design decision | **Documented** |
| NF-001 benchmark | `tests/governed_dispatch_latency.rs` — 3 tests covering lease path, fallback path, denial correctness | **Added** |
| Scanner error wording | `scanner.rs:275` — now leads with "Re-run `spec-compiler compile`" | **Fixed** |
