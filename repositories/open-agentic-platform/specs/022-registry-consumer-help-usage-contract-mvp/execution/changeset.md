---
feature_id: "022-registry-consumer-help-usage-contract-mvp"
---

# Changeset

Test and docs hardening only: add fixture transcripts under `tools/registry-consumer/tests/fixtures/help_contract/expected/`, add four help/usage contract tests in `tests/cli.rs`, and add minimal README feature linkage for 022. No runtime code changes in `src/`.

## Verification

- [x] `cargo test --manifest-path tools/registry-consumer/Cargo.toml --all`
- [x] `cargo build --release --manifest-path tools/registry-consumer/Cargo.toml`
- [x] `spec-compiler compile`
- [x] `spec-lint`
