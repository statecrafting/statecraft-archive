---
id: "033-axiomregent-activation"
title: "axiomregent sidecar activation and governance surface"
feature_branch: "033-axiomregent-activation"
status: approved
implementation: complete
kind: platform
domain: opc
created: "2026-03-29"
authors:
  - "open-agentic-platform"
language: en
summary: >
  Activate the bundled axiomregent sidecar at OPC desktop startup, verify bundling and
  port discovery, expose governed tools in the MCP UI, and surface safety-tier visibility
  — without rerouting all agent execution in this slice.
code_aliases:
  - MCP_ROUTER
  - MCP_ROUTER_CONTRACT
  - MCP_SNAPSHOT_WORKSPACE
  - MCP_TOOLS
owner: bart
risk: medium
establishes:
  - unit: { kind: file, path: crates/axiomregent/src/lib.rs }
references:
  - role: historical
    unit: { kind: file, path: product/apps/opc/src-tauri/src/commands/sidecars.rs }
---

# Feature Specification: axiomregent activation

## Purpose

The **axiomregent** crate and Tauri **sidecar** wiring exist (`spawn_axiomregent`, `SidecarState`, `tauri.conf.json` external binary), but the sidecar is **not started** from the desktop shell. This feature makes that governed runtime **live** and **inspectable** so downstream work (agent routing, permission enforcement) can attach to a real control plane.

## Scope

### In scope

- Call **`spawn_axiomregent`** during app startup when policy allows (see tasks for gating).
- Verify **sidecar binary** packaging per target (macOS/Windows/Linux as supported).
- **Port discovery** from stderr (`OPC_AXIOMREGENT_PORT=`; stdout remains MCP-framed) integrated with existing `SidecarState`.
- **MCP management UI**: list/discover axiomregent tools alongside existing MCP bridges (e.g. gitctx) where architecture permits.
- **Safety tier** visibility in governance or settings surfaces (read-only display tied to existing `safety.rs` semantics).

### Out of scope

- Rerouting **all** Claude/agent execution through axiomregent (separate feature).
- Removing **`--dangerously-skip-permissions`** (depends on routing feature).
- **featuregraph** scanner / `registry.json` adaptation (Feature **034**-class).
- **Titor** Tauri command implementations.

## Requirements

- **FR-001**: On supported builds, the desktop app **starts** the axiomregent sidecar and records its port in `SidecarState` when startup succeeds.
- **FR-002**: Failure to spawn or parse the port produces a **bounded, explicit** degraded state (log + optional UI notice); the app must not crash.
- **FR-003**: Operators can **see** that axiomregent is up (or why not) without reading logs only.
- **FR-004**: No change to **registry-consumer** contracts (029–031) beyond incidental dependency bumps.

## Success criteria

- **SC-001**: A developer can confirm axiomregent is running from the UI or documented probe on at least one supported platform.
- **SC-002**: `execution/verification.md` records commands and results for spawn + smoke.

## Contract notes

- Sidecar name and binary path remain **`tauri.conf.json`**-authoritative until changed by this spec’s tasks.
