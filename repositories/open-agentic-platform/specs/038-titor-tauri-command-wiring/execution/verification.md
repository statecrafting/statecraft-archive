---
feature: "038-titor-tauri-command-wiring"
---

# Verification: titor Tauri command wiring

## Desktop crate — `TitorState` round-trip (T009)

Exercises `get_or_init` → checkpoint ×2 → `list_checkpoints` → `verify_checkpoint` → `diff` → `restore` on a temp project tree; asserts storage `metadata.json` exists and restore reverts files.

```
$ cd apps/desktop/src-tauri && cargo test titor -- --nocapture
running 2 tests
test commands::titor::tests::require_titor_errors_without_init ... ok
test commands::titor::tests::round_trip_init_checkpoint_list_verify_diff_restore ... ok
test result: ok. 2 passed; 0 failed
```

`require_titor_errors_without_init` covers the “no instance for root” path (FR-007 / SC-006).

## spec-compiler (T011)

```
$ cargo build --release --manifest-path tools/spec-compiler/Cargo.toml
$ ./tools/spec-compiler/target/release/spec-compiler compile
```

Exit code **0**; registry updated under `build/spec-registry/`.

## Manual IPC (optional)

Tauri commands are registered in `apps/desktop/src-tauri/src/lib.rs` (`titor_init` … `titor_verify`). End-to-end IPC was not run here; the unit test above proves the same `Titor` operations the commands delegate to.
