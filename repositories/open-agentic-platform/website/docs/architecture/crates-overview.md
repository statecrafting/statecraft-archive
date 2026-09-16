# Crates Overview

The Open Agentic Platform is heavily built on Rust. The `crates/` directory contains the library crates that power the platform's core logic, orchestration, and desktop backend.

## Key Library Crates

| Crate | Description |
|---|---|
| `factory-engine` | Implements the two-phase Factory pipeline logic and handles Governance Certificate emission. |
| `factory-contracts` | Defines the shared types and schemas used across the factory ecosystem. |
| `policy-kernel` | The enforcement engine that evaluates safety tiers and policy rules against agent actions. |
| `orchestrator` | Executes multi-step DAG workflows with verify-and-retry logic and state persistence. |
| `agent` | Core agent interaction traits and LLM provider abstractions. |
| `tool-registry` | Manages the registration, schema validation, and tier classification of tools available to agents. |
| `axiomregent` | The governed MCP server sidecar. It unifies Git context, semantic search, and policy enforcement into a single process. |

## Traceability

Because OAP enforces spec-first development, every crate is bound to a governing specification. This binding is declared in the crate's `Cargo.toml` file using the `[package.metadata.oap]` table.

For a complete, up-to-date mapping of every crate to its governing spec, consult the [Codebase Index](../spec-spine-workflow/codebase-index).
