---
feature_id: "009-registry-consumer-status-report-nonzero-mvp"
title: "Nonzero-only status report rows"
---

# Changeset: Registry consumer status-report nonzero filtering

## Scope

- Add `--nonzero-only` for `status-report`.
- Apply filtering consistently to text and JSON modes.
- Add tests and docs for the new flag.

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
- [x] `status-report --nonzero-only` output verified
- [x] `status-report --json --nonzero-only` output verified
