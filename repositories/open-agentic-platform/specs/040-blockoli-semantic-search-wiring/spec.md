---
id: "040-blockoli-semantic-search-wiring"
title: "Blockoli semantic search — Tauri command wiring"
feature_branch: "040-blockoli-semantic-search-wiring"
status: superseded
implementation: n/a
superseded_by: "073-axiomregent-unification"
kind: product
domain: opc
created: "2026-03-29"
authors:
  - "open-agentic-platform"
language: en
summary: >
  Wire the existing blockoli semantic code search library into the desktop app
  by implementing the two stubbed Tauri commands (index + search), adding managed
  state for the VectorStore, and making SemanticSearchPanel functional end-to-end.
---

# Feature Specification: Blockoli semantic search — Tauri command wiring

## Purpose

The `crates/blockoli/` library provides production-grade semantic code search: AST-based code block extraction (via asterisk), fastembed 384-dimensional vector embeddings, KD-tree similarity search, and SQLite persistence with project isolation. The desktop app already has:

- **Backend stubs**: `blockoli_index_project` and `blockoli_search` in `commands/search.rs` (both `todo!()`), registered in the Tauri invoke handler.
- **Frontend component**: `SemanticSearchPanel.tsx` — search input, invoke calls, JSON result display. Fully implemented but non-functional because the commands panic.
- **Cargo dependency**: `blockoli` is already in the desktop crate's `Cargo.toml`.

This feature wires the library to the stubs, making semantic search work end-to-end from the desktop UI.

## Scope

### In scope

- **Managed state**: `BlockoliState` wrapping blockoli's `VectorStore` in Tauri-compatible managed state (following the `TitorState` pattern from Feature 038).
- **`blockoli_index_project` implementation**: create project in VectorStore, parse directory with asterisk indexer, generate embeddings, insert blocks. Return project info on success.
- **`blockoli_search` implementation**: query VectorStore for nearest vectors, return structured results.
- **SQLite path**: use Tauri's app data directory for the blockoli SQLite database (not the hardcoded `db/blockoli.sqlite`).
- **Graceful degradation**: if fastembed model initialization fails (e.g., download failure, disk space), return a structured error rather than panicking.
- **Asterisk config**: bundle a default `asterisk.toml` config for Rust + Python parsing (the two languages currently supported by the shipped grammars).

### Out of scope

- **UI changes**: `SemanticSearchPanel.tsx` already works. No frontend modifications needed.
- **New blockoli library features**: no changes to `crates/blockoli/` internals (embeddings, vector store, KD-tree).
- **Additional language grammars**: only Rust and Python are currently supported by asterisk's tree-sitter grammars. Adding more languages is a separate feature.
- **Incremental re-indexing**: initial implementation re-indexes the entire project on each `blockoli_index_project` call. Delta indexing is a future optimization.
- **`search_codebase` command**: the fourth search stub remains unimplemented (it has no UI consumer and unclear semantics).

## Requirements

### Functional

- **FR-001**: `BlockoliState` managed state holds a `VectorStore` instance initialized with a SQLite database in the Tauri app data directory. Registered via `app.manage()` during startup.
- **FR-002**: `blockoli_index_project(project_name, path)` creates a project in the VectorStore (if not already present), parses the directory with asterisk's `index_directory`, generates vector embeddings for all extracted code blocks, and inserts them. Returns a JSON object with `project_name` and `total_blocks` on success.
- **FR-003**: `blockoli_search(project_name, query)` searches the VectorStore for the 5 nearest code blocks matching the query. Returns the blockoli `NearestVectors` JSON shape (`{ nearest, k_nearest }`).
- **FR-004**: If the fastembed model fails to initialize (first embedding call triggers a ~30 MB model download), the command returns a structured error string, not a panic.
- **FR-005**: If `blockoli_search` is called for a project that has not been indexed, the command returns a structured error indicating the project does not exist.
- **FR-006**: The asterisk config for parsing is embedded as a const string in the command module (not read from a file path), using the existing `crates/asterisk/asterisk.toml` content.

### Non-functional

- **NF-001**: Indexing a project of ~1,500 files should complete within 60 seconds on the developer's machine. (Fastembed uses CPU inference; first run includes model download.)
- **NF-002**: Search latency (excluding cold model init) should be under 2 seconds for a project with ~10,000 indexed blocks.

## Architecture

### State management

```
BlockoliState {
    store: tokio::sync::Mutex<VectorStore>
}
```

`VectorStore::init_sqlite()` currently hardcodes `db/blockoli.sqlite`. The Tauri command must construct the SQLite path using the app data directory (via `app.path().app_data_dir()`) and open the connection there. This requires either:

- **(a)** Adding a `VectorStore::init_sqlite_at(path)` constructor to blockoli, or
- **(b)** Setting the working directory before init, or
- **(c)** Using `rusqlite::Connection::open(path)` directly and constructing `VectorStore::SQLiteStore(conn)`.

Option (c) is simplest — `VectorStore` is an enum with a single variant holding a `Connection`. Constructing it directly avoids modifying the library.

### Indexing flow

1. Acquire `BlockoliState` mutex
2. Create project if not exists (`store.create_project`)
3. Parse directory: `asterisk::indexer::index_directory(&config, &path)` → `(Vec<Block>, _, _)`
4. Generate embeddings: `Embeddings::generate_vector_set(code_strings)` → `Vec<Vector>`
5. Zip blocks + vectors → `Vec<EmbeddedBlock>`
6. Insert: `store.insert_blocks(project_name, embedded_blocks)`
7. Return success with block count

### Search flow

1. Acquire `BlockoliState` mutex
2. Check project exists (`store.does_project_exist`)
3. Search: `store.search(project_name, query)` → `NearestVectors`
4. Serialize and return

### Key integration points

| Component | File | Change |
|-----------|------|--------|
| Managed state | `product/apps/opc/src-tauri/src/commands/search.rs` | Add `BlockoliState`, init in setup |
| Index command | `product/apps/opc/src-tauri/src/commands/search.rs` | Implement `blockoli_index_project` |
| Search command | `product/apps/opc/src-tauri/src/commands/search.rs` | Implement `blockoli_search` |
| App setup | `product/apps/opc/src-tauri/src/lib.rs` | Register `BlockoliState` via `app.manage()` |
| (No frontend changes) | — | `SemanticSearchPanel.tsx` already invokes the correct commands |

## Success criteria

- **SC-001**: `blockoli_index_project` indexes a Rust project directory and returns block count > 0.
- **SC-002**: `blockoli_search` returns semantically relevant code blocks for a natural language query against an indexed project.
- **SC-003**: `SemanticSearchPanel` in the desktop app shows search results (not errors) after indexing.
- **SC-004**: Searching a non-existent project returns a structured error, not a panic.
- **SC-005**: The SQLite database is created in the Tauri app data directory, not in `db/blockoli.sqlite` relative to CWD.

## Contract notes

- `VectorStore` uses `parking_lot::Mutex` internally (via blockoli's `AppState`), but the Tauri managed state wraps it in `tokio::sync::Mutex` for async command compatibility. This double-lock is acceptable — the outer async mutex ensures only one command accesses the store at a time, and the inner sync mutex is held briefly during SQLite operations.
- The fastembed `MODEL` static in `encoder.rs` is initialized lazily on first use. The first embedding call triggers a ~30 MB model download from Hugging Face. This is a one-time cost per machine.
- `asterisk::indexer::index_directory` is synchronous and CPU-bound. For large projects, it should be called from a blocking task (`tokio::task::spawn_blocking` or equivalent). The Tauri `#[command]` async wrapper handles this.

## Risk

- **R-001**: fastembed model download may fail on air-gapped machines or slow connections. Mitigation: FR-004 requires graceful error handling. Future: bundle model with app binary.
- **R-002**: Large projects may cause high memory usage during embedding generation (all blocks loaded at once). Mitigation: NF-001 sets a practical size bound. Future: batch embedding generation.
- **R-003**: `VectorStore::init_sqlite()` hardcodes the DB path. Mitigation: construct `VectorStore::SQLiteStore(Connection::open(path))` directly.

## Supersession

This feature has been superseded by `073-axiomregent-unification`, which absorbs blockoli's semantic search capabilities directly into axiomregent as `search.*` tools.
