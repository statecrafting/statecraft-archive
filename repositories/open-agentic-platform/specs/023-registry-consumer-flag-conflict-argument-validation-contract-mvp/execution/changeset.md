---
feature_id: "023-registry-consumer-flag-conflict-argument-validation-contract-mvp"
---

# Changeset

Test and docs hardening only: add argument-layer stderr fixtures under `tools/registry-consumer/tests/fixtures/arg_contract/expected/`, add five argument-validation contract tests in `tests/cli.rs`, and add minimal README feature linkage for 023. No runtime code changes in `src/`.

## Verification

- [x] `cargo test --manifest-path tools/registry-consumer/Cargo.toml --all`
- [x] `cargo build --release --manifest-path tools/registry-consumer/Cargo.toml`
- [x] `spec-compiler compile`
- [x] `spec-lint`
