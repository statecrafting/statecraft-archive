---
feature_id: "011-registry-consumer-status-report-status-filter-mvp"
title: "Status-report status filtering"
---

# Changeset: Registry consumer status-report status filter

## Scope

- Add `--status <value>` filtering to `status-report`.
- Support text and JSON mode filtering.
- Add tests, docs, and verification artifact.

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
- [x] `status-report --status active` output verified
- [x] `status-report --json --status active` output verified
