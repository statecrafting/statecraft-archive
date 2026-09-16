---
feature_id: "021-registry-consumer-field-shape-invariants-contract-mvp"
---

# Changeset

Test and docs hardening only: add field-shape invariant tests in `tools/registry-consumer/tests/cli.rs`, add fixture `tests/fixtures/shape_contract/registry_optional_fields_omitted.json`, and add minimal README linkage for Feature 021. No runtime code changes in `src/`.

## Verification

- [x] `cargo test --manifest-path tools/registry-consumer/Cargo.toml --all`
- [x] `cargo build --release --manifest-path tools/registry-consumer/Cargo.toml`
- [x] `spec-compiler compile`
- [x] `spec-lint`
