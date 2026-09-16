---
feature_id: "036-safety-tier-governance"
---

# Verification: safety tier governance

## Commands

```bash
cd crates/axiomregent && cargo test --test tool_tier_coverage
cd crates/agent && cargo test
cd crates/featuregraph && cargo test
```

## Evidence

| Criterion | Result |
|-----------|--------|
| Tool tier coverage test | `every_router_tool_has_explicit_tier` — green (2026-03-29) |
| Tier assignments match spec | `tier_assignments_match_spec` — green (2026-03-29) |
| Agent crate tests (ToolTier rename) | 9 passed (2026-03-29) |
| Featuregraph tests (ChangeTier rename) | 8 passed including golden (2026-03-29) |
| Full axiomregent suite | All tests green (2026-03-29) |
| Desktop Rust compilation | No compiler errors (build.rs Tauri config warning is pre-existing) |
