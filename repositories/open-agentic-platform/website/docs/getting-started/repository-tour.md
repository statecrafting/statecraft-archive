# Repository Tour

The Open Agentic Platform is a large monorepo encompassing over 200 specifications, numerous Rust crates, a Tauri desktop application, and an Encore.ts control plane. Understanding the layout is critical for navigating the codebase.

## Directory Layout

| Path | Description |
|---|---|
| `specs/` | The authoritative spec spine. Contains over 220 Markdown specs organized in `NNN-slug` directories. |
| `tools/` | Rust CLIs and tooling. Includes the OAP-specific `spec-lint` and overlay tools like `oap-registry-enrich` and `oap-code-index-enrich`. (Note: The generic `spec-spine` engine is published externally on crates.io). |
| `crates/` | Library crates providing core functionality, such as `factory-engine`, `factory-contracts`, `policy-kernel`, `orchestrator`, `agent`, `tool-registry`, and `axiomregent`. |
| `product/apps/opc/` | The OPC desktop application. A local cockpit built with Tauri v2, React, and TypeScript. |
| `platform/` | The control plane services and infrastructure. Includes Identity (Rauthy), `deployd-api`, the `statecraft` SaaS, Helm charts, and Terraform configurations. |
| `.derived/` | Compiler-emitted machine truth. Contains `spec-registry/` and `codebase-index/`. These files are generated automatically and must be read through consumer binaries only. |
| `.claude/` | Agent and command definitions used by the development environment. This directory is a first-class part of the workflow, housing skills, agents, and rules. |

## Where the Three Layers Live

The three-layer model of OAP maps directly to this repository structure:

1. **The Spec Spine**: Located in `specs/` (the human-authored truth) and `.derived/` (the machine-consumable JSON truth).
2. **The Platform**: Located in `platform/`, housing the service plane that provides identity, orchestration, and governance APIs.
3. **The OPC Desktop**: Located in `product/apps/opc/`, providing the local execution surface and hosting the `axiomregent` MCP server (defined in `crates/axiomregent/`).
