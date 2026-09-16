---
feature_id: "007-registry-consumer-status-report-mvp"
title: "Status-report command for registry-consumer"
---

# Changeset: Registry consumer status reporting

## Scope

- Add `status-report` command to `tools/registry-consumer`.
- Surface lifecycle counts and optional id lists.
- Add tests and docs for the new command.

## References

- **Spec:** [../spec.md](../spec.md)
- **Plan:** [../plan.md](../plan.md)
- **Tasks:** [../tasks.md](../tasks.md)

## Approval

Human-reviewed local implementation pass. No destructive operations.

## Verification checklist

- [x] `spec-compiler compile` succeeds
- [x] `cargo test --manifest-path tools/registry-consumer/Cargo.toml` succeeds
- [x] `status-report` output verified on current repo

