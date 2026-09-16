# 051 Phase 6 Verification

Date: 2026-03-30  
Owner: cursor

## Scope

Phase 6 integration for `051-worktree-agents`:

- Tauri command wiring for `spawnBackgroundAgent`, `listAgents`, `getAgentDiff`, `mergeAgent`, and `discardAgent`.
- Desktop API wrappers in `apps/desktop/src/lib/api.ts`.
- Merge flow chains cleanup (merge -> discard semantics).
- Cherry-pick failure path performs `git cherry-pick --abort`.

## Evidence

### Command surface (desktop/Tauri)

- Added `apps/desktop/src-tauri/src/commands/worktree_agents.rs`:
  - `spawn_background_agent`
  - `list_background_agents`
  - `get_agent_diff`
  - `merge_agent`
  - `discard_agent`
- Registered command module in:
  - `apps/desktop/src-tauri/src/commands/mod.rs`
  - `apps/desktop/src-tauri/src/lib.rs` (`app.manage(...)` + `invoke_handler`)
- Added frontend API wrappers in:
  - `apps/desktop/src/lib/api.ts`
  - `apps/desktop/src/lib/apiAdapter.ts`

### FR/SC mapping

- **FR-006 / SC-004**: `get_agent_diff` uses `git diff parent...agent` and `git log parent..agent`.
- **FR-007 / SC-005**: `merge_agent` supports `fast-forward`, `squash`, `cherry-pick`.
- **FR-008 / SC-006**: cleanup is chained after successful merge and exposed as standalone `discard_agent`.
- **P5-003 fix**: cherry-pick loop aborts with `git cherry-pick --abort` on first failure.
- **P5-004 fix**: merge command performs merge+discard chain per flow requirement.

### Validation runs

- `cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml` -> PASS

Notes:

- A workspace TypeScript check in `apps/desktop` reports pre-existing type errors in `src/lib/contextCompaction.ts`; these are unrelated to this slice and were not modified here.
