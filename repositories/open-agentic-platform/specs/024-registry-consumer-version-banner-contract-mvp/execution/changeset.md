---
feature_id: "024-registry-consumer-version-banner-contract-mvp"
---

# Changeset

Test and docs hardening only: add fixture transcript `tools/registry-consumer/tests/fixtures/version_contract/expected/top_level.version.txt`, add one top-level `--version` contract test in `tests/cli.rs`, and add minimal README feature linkage for 024. No runtime code changes in `src/`.

## Verification

- [x] `cargo test --manifest-path tools/registry-consumer/Cargo.toml --all`
- [x] `cargo build --release --manifest-path tools/registry-consumer/Cargo.toml`
- [x] `spec-compiler compile`
- [x] `spec-lint`
