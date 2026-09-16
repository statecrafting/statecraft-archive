# Feature 001 — spec conformance checkpoint (2026-03-22)

**Verdict**: **Approved.** Feature 001 is the constitutional compiler baseline for this repo: implemented, tested, schema-gated in CI.

**Status**: **Closed** for MVP scope—no further compiler work unless Feature 000/001 text changes, schema drift, or an explicit scope decision. (Fixture + real-repo schema tests + golden + exit codes.)

## What is verified

- **`registry.json`** / **`build-meta.json`** emitted by `open_agentic_spec_compiler::compile` validate against Feature **000** JSON Schemas (`tests/schema_conformance.rs`, `jsonschema` crate).
- **Determinism**: golden test compares two separate compiler runs (`tests/golden.rs`).
- **Exit codes**: `0` success repo, `1` duplicate-id validation failure, `3` invalid UTF-8 spec (`tests/exit_codes.rs`).
- **CI**: `spec-conformance` workflow builds the compiler, runs `compile`, runs full `cargo test` for `tools/spec-spine/spec-compiler`.

## Governance

- **V-004** does not scan `.github/` (workflow YAML is tooling, not authored platform truth in the Feature 000 sense). Documented in [research.md](./research.md) R6.

## Stop line

Per Feature 001 plan: no further compiler churn unless Feature 000/001 text changes, schema mismatch, or intentional scope broadening.
