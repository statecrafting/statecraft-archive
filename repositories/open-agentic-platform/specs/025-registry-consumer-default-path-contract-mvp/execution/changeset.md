---
feature_id: "025-registry-consumer-default-path-contract-mvp"
---

# Changeset

Test and docs hardening only: add default-path fixture transcripts under `tools/registry-consumer/tests/fixtures/default_path_contract/expected/`, add two omitted-`--registry-path` contract tests in `tests/cli.rs`, and add minimal README feature linkage for 025. No runtime code changes in `src/`.

## Verification

- [x] `cargo test --manifest-path tools/registry-consumer/Cargo.toml --all`
- [x] `cargo build --release --manifest-path tools/registry-consumer/Cargo.toml`
- [x] `spec-compiler compile`
- [x] `spec-lint`
