---
id: "043-agent-organizer::execution"
title: "Execution verification — Agent Organizer"
feature_id: "043-agent-organizer"
---

## Commands

- `cargo test --manifest-path crates/agent/Cargo.toml`
- `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml -- plan_request`

## Evidence

- `crates/agent`: all organizer tests passing (complexity scoring, dispatch triggers, registry integration, deterministic planner).
- `apps/desktop/src-tauri`: `plan_request` Tauri command builds successfully and returns a JSON `ExecutionPlan` for sample inputs with and without agents in the SQLite catalog.

