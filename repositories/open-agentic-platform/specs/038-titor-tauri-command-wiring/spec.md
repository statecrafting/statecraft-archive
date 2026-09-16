---
id: "038-titor-tauri-command-wiring"
title: "titor Tauri command wiring"
feature_branch: "038-titor-tauri-command-wiring"
status: superseded
implementation: n/a
superseded_by: "073-axiomregent-unification"
kind: platform
domain: opc
created: "2026-03-29"
authors:
  - "open-agentic-platform"
language: en
summary: >
  Wire the five stubbed titor Tauri commands (checkpoint, list, restore, diff,
  verify) to the production-ready titor library crate via a new TitorState in
  Tauri AppState, enabling checkpoint/restore from the desktop UI.
---

# Feature Specification: titor Tauri command wiring

## Purpose

The `titor` library crate (`crates/titor/`) is production-grade (~17k LOC) with checkpoint, restore, diff, verify, timeline, and GC capabilities. However, the desktop app cannot use any of it: 5 of 6 Tauri commands in `commands/titor.rs` are `todo!()`, and `titor_init` creates an instance but discards it immediately. This is the last HIGH item in the authority-map.

This feature wires the existing library API to the existing Tauri command signatures through a new `TitorState` that persists `Titor` instances keyed by root path.

## Scope

### In scope

- **`TitorState`** — a Tauri-managed state struct that holds `HashMap<PathBuf, Arc<Mutex<Titor>>>` instances, keyed by project root path. Thread-safe for async Tauri commands.
- **Fix `titor_init`** — persist the created `Titor` instance into `TitorState` instead of discarding it. Return success with storage path.
- **Wire 5 commands** — `titor_checkpoint`, `titor_list`, `titor_restore`, `titor_diff`, `titor_verify` delegate to the corresponding `Titor` methods on the instance retrieved from `TitorState`.
- **Error handling** — return structured errors when no instance exists for a root path (user must call `titor_init` first).
- **Verification** — round-trip: init → checkpoint → list → verify → diff → restore on a test project directory.

### Out of scope

- **Desktop UI for checkpoint/restore** — this feature wires the backend commands only. UI is a follow-on.
- **Agent execution integration** — automatic checkpointing before agent actions is a separate feature that builds on this wiring.
- **`CheckpointManager` unification** — the existing `checkpoint/` module is a separate system. Unifying with titor is a future architecture decision, not part of this feature.
- **GC, timeline, fork commands** — titor supports these but no Tauri commands exist yet. Adding new command signatures is out of scope; only wiring existing ones.

## Requirements

### Functional

- **FR-001**: `titor_init(root_path, storage_path)` creates a `Titor` instance and persists it in `TitorState`. Subsequent calls with the same `root_path` return the existing instance (idempotent).
- **FR-002**: `titor_checkpoint(root_path, message)` creates a checkpoint via `titor.checkpoint()` and returns serialized `Checkpoint` metadata (id, timestamp, file count, description).
- **FR-003**: `titor_list(root_path)` returns all checkpoints via `titor.list_checkpoints()` as a JSON array.
- **FR-004**: `titor_restore(root_path, checkpoint_id)` restores to the specified checkpoint via `titor.restore()`.
- **FR-005**: `titor_diff(root_path, id1, id2)` returns the diff between two checkpoints via `titor.diff()` as serialized JSON.
- **FR-006**: `titor_verify(root_path, checkpoint_id)` verifies checkpoint integrity via `titor.verify_checkpoint()` and returns the verification report.
- **FR-007**: All commands return `Err(String)` with a clear message if no `Titor` instance exists for the given `root_path`.

### Non-functional

- **NF-001**: Checkpoint creation for a typical project directory (< 10k files) completes within 5 seconds.
- **NF-002**: `TitorState` access does not block other Tauri commands (uses `tokio::sync::Mutex` or `RwLock` appropriately).

## Architecture

### TitorState design

```
TitorState {
    instances: Arc<RwLock<HashMap<PathBuf, Arc<Mutex<Titor>>>>>
}
```

- **Outer `RwLock`**: allows concurrent reads of the instance map (e.g., multiple `titor_list` calls for different roots).
- **Inner `Mutex<Titor>`**: serializes operations on a single Titor instance (checkpoint and restore must not interleave).
- Registered in Tauri via `.manage(TitorState::new())` alongside existing managed states.

### Command flow

```
titor_checkpoint(root_path, message)
  → state.instances.read() → get Arc<Mutex<Titor>> for root_path
  → titor.lock() → titor.checkpoint(message)
  → serialize Checkpoint → return JSON
```

### Key integration points

| Component | File | Change |
|-----------|------|--------|
| TitorState | `product/apps/opc/src-tauri/src/commands/titor.rs` | New struct + impl |
| titor_init | `product/apps/opc/src-tauri/src/commands/titor.rs` | Wire to TitorState |
| 5 command stubs | `product/apps/opc/src-tauri/src/commands/titor.rs` | Replace `todo!()` with delegation |
| App setup | `product/apps/opc/src-tauri/src/lib.rs` | `.manage(TitorState::new())` |
| Tauri config | `tauri.conf.json` | No change (commands already registered) |

### Reference: existing CheckpointState pattern

`checkpoint/state.rs` demonstrates the established pattern: `Arc<RwLock<HashMap<K, Arc<V>>>>` keyed by session ID. `TitorState` follows the same pattern but keyed by `PathBuf` (root path) since titor instances are project-scoped, not session-scoped.

## Success criteria

- **SC-001**: `titor_init` followed by `titor_checkpoint` creates a verifiable checkpoint on disk.
- **SC-002**: `titor_list` returns the checkpoint created in SC-001.
- **SC-003**: `titor_verify` confirms the checkpoint's integrity.
- **SC-004**: `titor_diff` between two checkpoints shows the correct file changes.
- **SC-005**: `titor_restore` reverts the project directory to the checkpointed state.
- **SC-006**: All commands return appropriate errors when called without prior `titor_init`.

## Contract notes

- The 6 Tauri commands are already registered in `lib.rs:355-360`. No new IPC surface is needed.
- `Titor` instances are not `Send` by default if they hold `rusqlite::Connection`. Verify thread-safety or wrap appropriately. The `checkpoint/manager.rs` pattern (which also uses SQLite-backed storage) shows the working approach.
- `serde_json::Value` return types on the existing command signatures are flexible — serialize whatever the titor library returns.

## Risk

- **R-001**: `Titor` may not be `Send + Sync` due to internal SQLite connection. Mitigation: wrap in `Mutex` (same pattern as `CheckpointManager`). If `Titor` is not `Send`, use `std::sync::Mutex` and `spawn_blocking` for operations.
- **R-002**: Large project directories may cause slow checkpoints. Mitigation: NF-001 sets 5-second target; titor's compression and parallel workers are configurable via `TitorBuilder`.

## Supersession

This feature has been superseded by `073-axiomregent-unification`, which absorbs titor's checkpoint/restore capabilities directly into axiomregent's unified MCP tool surface.
