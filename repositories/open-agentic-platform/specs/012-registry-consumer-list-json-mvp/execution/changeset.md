---
feature_id: "012-registry-consumer-list-json-mvp"
title: "List JSON output for registry-consumer"
---

# Changeset: Registry consumer list JSON output

## Scope

- Add `list --json` with stable array output and existing filters.

## References

- **Spec:** [../spec.md](../spec.md)
- **Plan:** [../plan.md](../plan.md)
- **Tasks:** [../tasks.md](../tasks.md)

## Verification checklist

- [x] `cargo test --manifest-path tools/registry-consumer/Cargo.toml`
- [x] `cargo build --release --manifest-path tools/registry-consumer/Cargo.toml`
- [x] `spec-compiler compile`
- [x] `spec-lint`
