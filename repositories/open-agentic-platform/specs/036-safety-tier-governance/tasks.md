---
feature_id: "036-safety-tier-governance"
---

# Tasks

- [x] **T001** — Expand `get_tool_tier()` to explicitly classify all 21 router tools per the proposed tier table in `spec.md`. Kept `write_file` legacy alias (still reachable via `internal_client.rs` and `validator.rs`).
- [x] **T002** — Add `tool_tier_coverage` test: asserts every router tool has explicit tier assignment + verifies spec tier assignments match code.
- [x] **T003** — Rename `agent::safety::Tier` → `ToolTier`. Added backwards-compatible `type Tier = ToolTier` alias. Updated `permissions.rs` to use `ToolTier`.
- [x] **T004** — Rename `featuregraph::preflight::SafetyTier` → `ChangeTier`. All references in `preflight.rs` updated.
- [x] **T005** — Added `get_tool_tier_assignments` Tauri command in `analysis.rs`. Returns per-tool tier map from `explicitly_classified_tools()`. Registered in `bindings.rs` and `lib.rs`.
- [x] **T006** — Updated `GovernanceSurface.tsx`: fetches tool tier assignments, displays collapsible per-tool tier list. Updated code references from `SafetyTier` to `ChangeTier`/`ToolTier`.
- [x] **T007** — Verified `requires_file_read/write/network` coverage: all reclassified tools already covered correctly.
- [ ] **T008** — Update `execution/verification.md` with test commands and results.
- [ ] **T009** — Run `spec-compiler compile` and verify registry includes Feature 036.
