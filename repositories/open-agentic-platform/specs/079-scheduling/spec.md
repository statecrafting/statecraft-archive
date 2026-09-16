---
id: "079-scheduling"
title: "Scheduled Agent Execution"
feature_branch: "feat/079-scheduling"
status: approved
implementation: complete
kind: product
domain: opc
created: "2026-04-05"
authors:
  - "open-agentic-platform"
language: en
summary: >
  Adds cron-based and lifecycle-event-triggered scheduling for recurring agent
  execution.  Schedules are persisted in SQLite, evaluated by a 60-second tick
  engine, and dispatched through the existing orchestrator infrastructure.
code_aliases:
  - SCHEDULED_AGENT_EXECUTION
sources:
  - claudepal
extends:
  - spec: "004-spec-to-execution-bridge-mvp"
    nature: additive
    unit: { kind: crate, id: orchestrator }
---

# 079 — Scheduled Agent Execution

## Purpose

Enable recurring and event-driven agent execution without manual intervention.
Use cases include nightly lint runs, post-session summaries, periodic health
checks, and automated code review on file changes.

## Scope

### In scope

- **Cron triggers**: Full POSIX cron expressions via the `cron` crate.
- **Event triggers**: Lifecycle events from spec 069 (SessionStart, SessionStop,
  PreToolUse, PostToolUse, UserPromptSubmit, FileChanged).
- **SQLite persistence**: `schedules` table with CRUD operations.
- **Tick engine**: 60-second interval loop evaluating due cron schedules.
- **HTTP routes**: REST CRUD for schedule management.
- **Desktop UI**: ScheduleDialog + SchedulePanel components.
- **Executor trait**: Pluggable execution backend (Tauri, CLI, test mock).

### Out of scope (deferred)

- Worktree isolation for scheduled agents (future integration with spec 051).
- Policy kernel permission checks on scheduled execution (future spec 068 integration).
- Distributed scheduling across multiple nodes.

## Architecture

```
┌──────────────────────┐
│   SchedulerEngine    │──── tokio::time::interval(60s) ─── evaluate_cron_schedules()
│                      │
│  on_lifecycle_event()│◄── HookRuntime (spec 069) dispatches lifecycle events
└──────────┬───────────┘
           │
           ▼
┌──────────────────────┐     ┌─────────────────────────────┐
│  SchedulerStore      │────►│  SqliteSchedulerStore       │
│  (trait)             │     │  (schedules table, WAL)     │
└──────────────────────┘     └─────────────────────────────┘
           │
           ▼
┌──────────────────────┐
│ ScheduledRunExecutor │──── impl: TauriExecutor | MockExecutor
│ (trait)              │
└──────────────────────┘
```

## Data Model

```sql
CREATE TABLE schedules (
    id              TEXT PRIMARY KEY,
    name            TEXT NOT NULL,
    prompt          TEXT NOT NULL,
    session_context TEXT,         -- JSON: {cwd, model, provider}
    cron_expr       TEXT,         -- POSIX cron (mutually exclusive with event_type)
    event_type      TEXT,         -- lifecycle event name
    enabled         INTEGER NOT NULL DEFAULT 1,
    last_run_at     INTEGER,      -- epoch seconds
    created_at      INTEGER NOT NULL
);
```

## Dependencies

- **Spec 052** (state persistence): shares SQLite infrastructure.
- **Spec 069** (lifecycle hooks): event trigger taxonomy.
- **Spec 051** (worktree agents): future integration for isolated execution.
