# Feature 047 — verification evidence (execution)

Canonical requirements live in `specs/047-governance-control-plane/spec.md`. This file records **commands and observed results** for success criteria that are validated by benchmarks or integration tests.

## SC-010 — kernel evaluation latency (NF-001)

**Intent:** Native policy kernel evaluation stays within the `< 5 ms` budget for a single decision (excluding I/O); SC-010 frames this as a 1000-evaluation benchmark.

**Commands:**

```bash
cargo bench --manifest-path crates/policy-kernel/Cargo.toml
```

**Benchmark:** `evaluate_x1000_allow_path` (Criterion) — runs 1000 × `evaluate()` per iteration on a fixed bundle + tool context.

**Observed (2026-03-30, Apple Silicon dev machine):** ~886–892 µs **total** for 1000 evaluations (~0.9 µs per call), far below 5 ms per single evaluation.

## NF-002 — compile time for large policy trees

**Intent:** Compiling a repo with up to 50 policy source files completes in under 2 seconds.

**Commands:**

```bash
cargo bench --manifest-path tools/policy-compiler/Cargo.toml
```

**Benchmark:** `compile_50_policy_sources` — one root `CLAUDE.md` plus 49 files under `.claude/policies/`.

**Observed (2026-03-30):** ~1.34–1.36 ms **per** `compile()` call (Criterion), well under the 2 s ceiling.

## SC-011 — axiomregent policy wire surface

**Intent:** Policy denial is distinguishable from Feature 035 permission denial at the JSON-RPC error `code`.

**Commands:**

```bash
cargo test --manifest-path crates/axiomregent/Cargo.toml --test policy_preflight_test
```

**Checks:** `POLICY_DENIED` when the loaded bundle’s gates deny the tool; `PERMISSION_DENIED` unchanged for grant/tier failures.

## Integration path (Phase 6)

**Dispatch order:** `check_grants` / `check_tool_permission` (tier + permission flags) → optional `open_agentic_policy_kernel::evaluate` when `repo_root` is present and `build/policy-bundles/policy-bundle.json` loads successfully → tool handler.

**Fallback:** Missing or unreadable bundle skips policy evaluation (Feature 035-only behavior), per spec risk note R-002.
