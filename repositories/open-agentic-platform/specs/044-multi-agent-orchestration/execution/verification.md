---
id: "044-multi-agent-orchestration::execution"
title: "Execution verification — Multi-Agent Orchestration"
feature_id: "044-multi-agent-orchestration"
---

## Commands

- `cargo test --manifest-path crates/orchestrator/Cargo.toml`
- `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml -- orchestrate_manifest`

## Evidence

- `crates/orchestrator`: all workflow manifest validation, dispatch, and e2e orchestration tests passing (including SC-001–SC-006 and SC-007 deferrals as documented in the spec findings).
- `apps/desktop/src-tauri`: Tauri commands `orchestrate_manifest`, `get_run_status`, `cancel_run`, and `cleanup_artifacts` build and exercise the real governed executor against the agent catalog for a sample three-step manifest.

