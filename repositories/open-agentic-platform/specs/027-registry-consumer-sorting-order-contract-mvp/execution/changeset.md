---
feature_id: "027-registry-consumer-sorting-order-contract-mvp"
---

# Changeset

Test and docs hardening only: add sorting-order fixture `tools/registry-consumer/tests/fixtures/sorting_contract/registry_unsorted_allow_invalid.json`, add three explicit sorting-order contract tests in `tests/cli.rs`, and add minimal README feature linkage for 027. No runtime code changes in `src/`.

## Verification

- [x] `cargo test --manifest-path tools/registry-consumer/Cargo.toml --all`
- [x] `cargo build --release --manifest-path tools/registry-consumer/Cargo.toml`
- [x] `spec-compiler compile`
- [x] `spec-lint`
