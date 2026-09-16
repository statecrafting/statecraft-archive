---
feature_id: "010-registry-consumer-status-report-json-contract-mvp"
title: "Stable JSON contract tests for status-report"
---

# Changeset: Registry consumer status-report JSON contract tests

## Scope

- Add fixture-based contract tests for `status-report --json`.
- Add fixture-based contract tests for `status-report --json --nonzero-only`.
- Document JSON mode as stable automation interface.

## References

- **Spec:** [../spec.md](../spec.md)
- **Plan:** [../plan.md](../plan.md)
- **Tasks:** [../tasks.md](../tasks.md)

## Approval

Human-reviewed local implementation pass. No destructive operations.

## Verification checklist

- [x] `cargo test --manifest-path tools/registry-consumer/Cargo.toml` succeeds
- [x] `cargo build --release --manifest-path tools/registry-consumer/Cargo.toml` succeeds
- [x] `spec-compiler compile` succeeds
- [x] `spec-lint` succeeds
- [x] `status-report --json` output verified
- [x] `status-report --json --nonzero-only` output verified
