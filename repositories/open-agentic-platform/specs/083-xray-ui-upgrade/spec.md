---
id: "083-xray-ui-upgrade"
title: "Xray v1.2.0 UI Surface"
feature_branch: "feat/083-xray-ui-upgrade"
status: approved
implementation: complete
kind: product
domain: opc
created: "2026-04-08"
authors:
  - "open-agentic-platform"
language: en
summary: >
  Surfaces the full xray v1.2.0 schema in the OPC desktop InspectSurface panel.
  The Tauri backend already returns the complete XrayIndex (fingerprint, languages,
  dependencies, call graph, directory structure, incremental scan data), but the
  React UI only renders 4 stat cards, a digest, and a basic file table. This spec
  decomposes the monolithic InspectSurface into focused sub-components and wires
  all v1.2.0 fields into the desktop experience.
code_aliases:
  - XRAY_UI
  - INSPECT_SURFACE
extends:
  - spec: "032-opc-inspect-governance-wiring-mvp"
    nature: additive
    unit: { kind: crate, id: "@opc/desktop" }
---

# 083 — Xray v1.2.0 UI Surface

## Purpose

The xray Rust crate outputs a rich v1.2.0 schema with fingerprint, languages,
dependencies, call graph, directory structure, and incremental scan data. The
Tauri command (`analysis.rs:11`) already returns the full `XrayIndex` via
`serde_json::to_value(&index)`, but the InspectSurface UI (295 lines) only
displays a fraction of the available data. Users cannot see dependency inventory,
call graph topology, language distribution, or codebase fingerprint from the
desktop.

## Scope

### In Scope

- TypeScript type definitions mirroring Rust `crates/xray/src/schema.rs`
- View model mapper (`xrayViewModel.ts`) with defensive camelCase/snake_case handling
- 8 extracted sub-components: FingerprintBadge, Languages, TopDirs, ModuleFiles,
  Dependencies (collapsible), CallGraph (collapsible), StatCards, FileTable (enhanced)
- Recomposed InspectSurface with all v1.2.0 sections in visual hierarchy
- Incremental scan indicator bar when `prevDigest` is present
- Graceful degradation: optional sections hidden when data absent

### Out of Scope

- Changes to the xray Rust crate or Tauri backend commands
- New data collection or analysis features in xray
- Dependency vulnerability scanning or security analysis

## Functional Requirements

| ID | Requirement |
|----|-------------|
| FR-001 | Add TypeScript interfaces for XrayFileNode, CallGraphSummary, Dependency, DependencyInventory, Fingerprint, and XrayViewModel |
| FR-002 | Extract `toXrayViewModel` into standalone mapper handling both camelCase and snake_case field names |
| FR-003 | Render fingerprint badge row: classification, primaryLanguage, sizeBucket, schema version |
| FR-004 | Render language distribution as sorted badge pills (count descending) |
| FR-005 | Render top directories with folder icon and file counts |
| FR-006 | Render module files (Cargo.toml, package.json, etc.) as monospace pills |
| FR-007 | Render dependency inventory as collapsible section grouped by ecosystem |
| FR-008 | Render call graph summary as collapsible section with entry points list (capped at 20) |
| FR-009 | Enhance file table with complexity column and optional functions/maxDepth columns |
| FR-010 | Show incremental scan indicator when prevDigest is present with changed file count |
| FR-011 | All new sections render nothing (not empty containers) when their data is absent |

## Non-Functional Requirements

| ID | Requirement |
|----|-------------|
| NF-001 | No backend changes — pure frontend refactor |
| NF-002 | File table retains 200-file cap for rendering performance |
| NF-003 | Reuse existing Badge, details/summary, and stat card patterns from the desktop codebase |

## Key Files

| File | Role |
|------|------|
| `product/apps/opc/src/features/inspect/InspectSurface.tsx` | Main refactor target |
| `product/apps/opc/src/features/inspect/types.ts` | Type expansion |
| `product/apps/opc/src/features/inspect/xrayViewModel.ts` | New — view model mapper |
| `product/apps/opc/src/features/inspect/Xray*.tsx` | New — 8 sub-components |
| `crates/xray/src/schema.rs` | Reference for field names |

## Verification

- `cd product/apps/opc && pnpm build` — TypeScript compilation succeeds
- `cd product/apps/opc && pnpm lint` — lint pass
- Manual: scan a Rust project, verify all sections render
- Manual: scan a project with no dependencies/call graph — optional sections hidden
