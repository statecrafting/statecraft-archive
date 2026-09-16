---
feature_id: "030-registry-consumer-internal-output-exit-refactor-mvp"
---

# Changeset

Internal refactor only in `tools/registry-consumer/src/main.rs`: centralize prefixed error/exit handling and JSON print-or-exit paths behind small helpers. No observable behavior change and no fixture updates.

## Verification

- [x] Full registry-consumer contract subset gate command path
- [x] `cargo test --manifest-path tools/registry-consumer/Cargo.toml --all`
- [x] `spec-compiler compile`
- [x] `spec-lint`
