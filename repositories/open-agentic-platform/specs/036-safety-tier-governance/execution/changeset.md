---
feature_id: "036-safety-tier-governance"
---

# Changeset

## Scope

Formalize safety tier model: explicit tool classifications, enum reconciliation, UI per-tool display, coverage test.

## Files

| Area | Path | Change |
|------|------|--------|
| Tool tier definitions | `crates/agent/src/safety.rs` | `Tier` → `ToolTier` rename; expanded `get_tool_tier()` to cover all 21 tools; added `explicitly_classified_tools()` |
| Permission enforcement | `crates/axiomregent/src/router/permissions.rs` | Updated `Tier` → `ToolTier` imports |
| Change tier rename | `crates/featuregraph/src/preflight.rs` | `SafetyTier` → `ChangeTier` |
| Coverage test | `crates/axiomregent/tests/tool_tier_coverage.rs` | New: 2 tests (coverage + spec match) |
| Backend tier data | `apps/desktop/src-tauri/src/commands/analysis.rs` | New `get_tool_tier_assignments` command; updated comments and Tier3 label |
| Command registration | `apps/desktop/src-tauri/src/bindings.rs`, `lib.rs` | Register new command |
| Frontend API | `apps/desktop/src/lib/api.ts` | `ToolTierEntry` interface + `getToolTierAssignments()` method |
| Governance UI | `apps/desktop/src/features/governance/GovernanceSurface.tsx` | Per-tool tier display; updated enum references |

## Verification

See [verification.md](./verification.md).
