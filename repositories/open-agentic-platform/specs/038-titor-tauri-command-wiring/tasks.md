---
feature: "038-titor-tauri-command-wiring"
---

# Tasks: titor Tauri command wiring

## Implementation

- [x] **T001** — Create `TitorState` struct in `commands/titor.rs`
  - `Arc<RwLock<HashMap<PathBuf, Arc<Mutex<Titor>>>>>`
  - `new()`, `get_or_init(root_path, storage_path)`, `get(root_path)` methods
  - Thread-safe for async Tauri commands

- [x] **T002** — Register `TitorState` in Tauri app setup
  - Add `.manage(TitorState::new())` in `lib.rs` alongside existing managed states
  - Verify compilation with all 6 commands still registered

- [x] **T003** — Wire `titor_init` to persist instance in `TitorState`
  - Accept `tauri::State<TitorState>` parameter
  - Call `state.get_or_init(root_path, storage_path)` instead of discarding
  - Return storage path on success
  - Idempotent: return existing instance if already initialized

- [x] **T004** — Wire `titor_checkpoint` command
  - Retrieve `Titor` from `TitorState` by `root_path`
  - Call `titor.checkpoint(message)` under lock
  - Serialize `Checkpoint` metadata to `serde_json::Value`
  - Return error if no instance for root_path

- [x] **T005** — Wire `titor_list` command
  - Call `titor.list_checkpoints()` under lock
  - Serialize `Vec<Checkpoint>` to JSON array

- [x] **T006** — Wire `titor_restore` command
  - Call `titor.restore(checkpoint_id)` under lock
  - Return `RestoreResult` stats or `()`

- [x] **T007** — Wire `titor_diff` command
  - Call `titor.diff(id1, id2)` under lock
  - Serialize `CheckpointDiff` to JSON

- [x] **T008** — Wire `titor_verify` command
  - Call `titor.verify_checkpoint(checkpoint_id)` under lock
  - Serialize `VerificationReport` to JSON

- [x] **T009** — Verify round-trip: init → checkpoint → list → verify → diff → restore
  - Test on a real project directory
  - Confirm checkpoint files exist on disk
  - Confirm restore reverts state
  - Record results in `execution/verification.md`

## Closure

- [x] **T010** — Update `execution/verification.md` with test commands and results
- [x] **T011** — Run `spec-compiler compile` to update registry

## Notes

- **Existing `CheckpointState`** in `checkpoint/state.rs` is a separate checkpoint system — do not modify or unify in this feature.
- **`Titor` thread safety** — if `Titor` is not `Send`, use `std::sync::Mutex` + `spawn_blocking`. Check `crates/titor/src/titor.rs` for `Send`/`Sync` bounds.
- **Command signatures already exist** — all 6 commands are registered in `lib.rs:355-360`. Only the implementations change; no new IPC surface.
