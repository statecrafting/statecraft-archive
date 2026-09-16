---
id: "084-opc-settings-reconciliation"
title: "OPC Scoped Settings Reconciliation"
feature_branch: "feat/084-opc-settings-reconciliation"
status: approved
implementation: complete
kind: product
domain: opc
created: "2026-04-08"
authors:
  - "open-agentic-platform"
language: en
summary: >
  Extends the OPC desktop three-scope config merge pattern (already working for
  hooks) to cover full Claude Code settings — permissions, defaultMode, and env.
  Adds Rust backend commands for scoped settings read/write, a TypeScript merge
  utility, and a Permissions tab in ProjectSettings UI.
code_aliases:
  - OPC_SETTINGS
  - SETTINGS_RECONCILIATION
establishes:
  - unit: { kind: file, path: product/apps/opc/src/lib/settingsManager.ts }
extends:
  - spec: "032-opc-inspect-governance-wiring-mvp"
    nature: additive
    unit: { kind: file, path: product/apps/opc/src-tauri/src/commands/claude.rs }
  - spec: "032-opc-inspect-governance-wiring-mvp"
    nature: additive
    unit: { kind: file, path: product/apps/opc/src/lib/api.ts }
  - spec: "032-opc-inspect-governance-wiring-mvp"
    nature: additive
    unit: { kind: file, path: product/apps/opc/src/components/ProjectSettings.tsx }
---

# 084 — OPC Scoped Settings Reconciliation

## Purpose

OPC desktop implements three-scope config merging for **hooks** (user / project /
local) via `get_hooks_config` / `update_hooks_config` Tauri commands and a
`hooksManager.ts` merge utility. However, main settings (permissions.allow,
permissions.deny, defaultMode) are hardcoded to read/write only
`~/.claude/settings.json`. The project-level `.claude/settings.json` (with
team-shared permissions) is not surfaced in the OPC UI.

This spec extends the existing hooks pattern to cover full settings, enabling
teams to share permission rules via project-scoped config while allowing
individual overrides at user and local scopes.

## Scope

### In Scope

- Rust backend: `get_scoped_settings` and `save_scoped_settings` Tauri commands
  (cloning the hooks path resolution pattern)
- TypeScript: `getScopedSettings`, `saveScopedSettings`, `getMergedSettings` API
  functions
- TypeScript: `SettingsManager` merge utility mirroring `hooksManager.ts`
- UI: Permissions tab in ProjectSettings with allow/deny rule editors and merged
  effective view
- Merge semantics: permissions.allow union + dedup, permissions.deny union +
  dedup, defaultMode last-writer-wins (local > project > user), env object spread

### Out of Scope

- Changes to Claude Code CLI settings format
- Hook configuration (already implemented)
- Remote/platform-sourced settings (future spec)

## Functional Requirements

| ID | Requirement |
|----|-------------|
| FR-001 | `get_scoped_settings(scope, project_path)` reads settings JSON for the given scope using the same path resolution as `get_hooks_config` |
| FR-002 | `save_scoped_settings(scope, settings, project_path)` writes full settings JSON for the given scope |
| FR-003 | `getMergedSettings(projectPath)` returns the merged result of all three scopes |
| FR-004 | Merge rule: `permissions.allow` is union + dedup across scopes |
| FR-005 | Merge rule: `permissions.deny` is union + dedup across scopes |
| FR-006 | Merge rule: `defaultMode` is last-writer-wins (local > project > user) |
| FR-007 | Merge rule: `env` is object spread (local > project > user) |
| FR-008 | ProjectSettings UI shows a Permissions tab with allow/deny rule editors |
| FR-009 | Permissions tab shows read-only "Effective (merged)" card with resolved config |

## Non-Functional Requirements

| ID | Requirement |
|----|-------------|
| NF-001 | Reuse existing hooks scope pattern — no new path resolution logic |
| NF-002 | Merge utility follows same structure as `hooksManager.ts` for consistency |

## Key Files

| File | Role |
|------|------|
| `product/apps/opc/src-tauri/src/commands/claude.rs` | Add scoped settings commands (after hooks commands ~2560) |
| `product/apps/opc/src-tauri/src/lib.rs` | Register new commands |
| `product/apps/opc/src/lib/api.ts` | Add API functions (after hooks API ~2012) |
| `product/apps/opc/src/lib/settingsManager.ts` | New — merge utility |
| `product/apps/opc/src/lib/hooksManager.ts` | Reference pattern to mirror |
| `product/apps/opc/src/components/ProjectSettings.tsx` | Add Permissions tab |
| `product/apps/opc/src/components/Settings.tsx:806-930` | Existing permissions UI to reuse |

## Verification

- `cargo build --manifest-path product/apps/opc/src-tauri/Cargo.toml` compiles
- `cd product/apps/opc && pnpm build` compiles
- Manual: ProjectSettings > Permissions tab loads project `.claude/settings.json` rules
- Manual: Edit and save — file updates correctly
- Manual: Effective merged view shows union of all scopes
