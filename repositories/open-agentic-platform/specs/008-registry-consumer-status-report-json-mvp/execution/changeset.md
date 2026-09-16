---
feature_id: "008-registry-consumer-status-report-json-mvp"
title: "Machine-readable JSON mode for status-report"
---

# Changeset: Registry consumer status-report JSON output

## Milestone note

Feature **007** is recorded as the first fully delivered user-facing slice through the **000-006** governance spine; this feature treats that delivery as baseline.

## Scope

- Add `--json` output mode to `status-report`.
- Keep existing human-readable mode and trust semantics unchanged.
- Add tests and docs for machine-readable output.

## References

- **Spec:** [../spec.md](../spec.md)
- **Plan:** [../plan.md](../plan.md)
- **Tasks:** [../tasks.md](../tasks.md)

## Approval

Human-reviewed local implementation pass. No destructive operations.

## Verification checklist

- [x] `spec-compiler compile` succeeds
- [x] `spec-lint` succeeds
- [x] `cargo test --manifest-path tools/registry-consumer/Cargo.toml` succeeds
- [x] `status-report --json` output verified on current repo
