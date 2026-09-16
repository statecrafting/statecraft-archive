---
id: "052-state-persistence"
title: "State Persistence for Resumable Workflows"
feature_branch: "052-state-persistence"
status: approved
implementation: complete
kind: platform
domain: opc
created: "2026-03-29"
authors:
  - "open-agentic-platform"
language: en
summary: >
  Orchestrator commands persist workflow progress to state files (state.json or
  SQLite) so that interrupted workflows can be resumed from the last completed
  step. State is created at workflow start, updated after each step, and checked
  on startup to offer resume. Checkpoint and approval gates pause execution
  until operator confirmation. An append-only stream server with SSE replay
  provides live and historical visibility into workflow progress.
code_aliases:
  - STATE_PERSISTENCE
  - WORKFLOW_RESUME
extends:
  - spec: "004-spec-to-execution-bridge-mvp"
    nature: additive
    unit: { kind: crate, id: orchestrator }
sources:
  - agents
  - claudepal
  - crystal
---

# Feature Specification: State Persistence for Resumable Workflows

## Purpose

Long-running orchestrator workflows (multi-step builds, deployments, migration pipelines) currently execute without durable progress tracking. If a process crashes, loses connectivity, or is intentionally stopped, all progress is lost and the entire workflow must restart from scratch. Multiple consolidation sources — agents (task queue), claudepal (session persistence), crystal (CLI pipeline state) — each implement ad-hoc persistence with incompatible formats and no shared resume protocol.

This feature introduces a unified state persistence layer that tracks workflow progress step-by-step, enables deterministic resume from the last completed checkpoint, and provides an append-only event stream with SSE replay for observability.

## Scope

### In scope

- **State file format**: A well-defined schema for `state.json` (for simple workflows) and SQLite (for workflows requiring concurrent access or large state) that records workflow id, step history, current step, status, and metadata.
- **Lifecycle hooks**: Automatic state creation at workflow start, state update after each step completes or fails, and state cleanup on workflow completion.
- **Resume detection**: On startup, the orchestrator checks for existing state files and offers to resume from the last completed step rather than restarting.
- **Checkpoint gates**: Named checkpoints where execution pauses until explicit operator approval before proceeding.
- **Approval gates**: Pre-defined points requiring human confirmation, with configurable timeout and escalation behavior.
- **Append-only stream server**: An SSE endpoint that streams workflow events in real time and supports replay from any offset for late-joining clients.
- **State query API**: Functions to inspect workflow status, list completed and pending steps, and retrieve step-level output.

### Out of scope

- **Distributed workflow coordination**: Multi-node workflow execution and distributed locking are not addressed here; this feature covers single-orchestrator persistence.
- **State migration tooling**: Schema versioning and migration of state files across spec versions is a follow-on concern.
- **UI for workflow management**: No desktop or web UI changes; consumers use CLI or API.
- **Long-term event archival**: The append-only stream is ephemeral to the workflow lifetime; archival to external stores is separate.

## Requirements

### Functional

- **FR-001**: The orchestrator creates a state file (`state.json` or SQLite database) at the beginning of every workflow, recording workflow id, start time, step definitions, and initial status `"running"`.
- **FR-002**: After each step completes, the state file is updated atomically with the step's status (`"completed"` | `"failed"` | `"skipped"`), output summary, duration, and timestamp.
- **FR-003**: On startup, if a state file exists for the current workflow context, the orchestrator detects it and offers resume. Resume skips all steps marked `"completed"` and begins execution at the first non-completed step.
- **FR-004**: Checkpoint gates are declared in the workflow definition. When a checkpoint is reached, execution pauses and the state is written with status `"awaiting_checkpoint"`. Execution resumes only after explicit operator confirmation via CLI prompt or API call.
- **FR-005**: Approval gates support configurable timeouts. If no approval is received within the timeout, the workflow transitions to `"timed_out"` and follows the configured escalation policy (fail, skip, or notify).
- **FR-006**: An SSE endpoint streams all workflow events (step start, step complete, checkpoint reached, error) as they occur. Clients connecting after workflow start can replay from any event offset.
- **FR-007**: The state query API returns the full workflow state including all step statuses, current position, elapsed time, and any pending gates.
- **FR-008**: State files use atomic writes (write-to-temp then rename) to prevent corruption from crashes during write.

### Non-functional

- **NF-001**: State file update latency is < 10ms p99 for JSON, < 5ms p99 for SQLite WAL mode.
- **NF-002**: The SSE stream server supports at least 50 concurrent subscribers per workflow without degradation.
- **NF-003**: State files are human-readable (JSON) or inspectable (SQLite) for debugging without specialized tooling.

## Architecture

### State file schema (JSON)

```json
{
  "version": 1,
  "workflowId": "wf_abc123",
  "workflowName": "deploy-staging",
  "startedAt": "2026-03-29T10:00:00Z",
  "status": "running",
  "currentStepIndex": 2,
  "steps": [
    {
      "id": "step_001",
      "name": "lint",
      "status": "completed",
      "startedAt": "2026-03-29T10:00:01Z",
      "completedAt": "2026-03-29T10:00:05Z",
      "durationMs": 4000,
      "output": { "summary": "No lint errors" }
    },
    {
      "id": "step_002",
      "name": "test",
      "status": "completed",
      "startedAt": "2026-03-29T10:00:05Z",
      "completedAt": "2026-03-29T10:00:30Z",
      "durationMs": 25000,
      "output": { "summary": "42 tests passed" }
    },
    {
      "id": "step_003",
      "name": "deploy",
      "status": "pending",
      "gate": { "type": "approval", "timeoutMs": 300000 }
    }
  ],
  "metadata": {
    "branch": "feature/new-api",
    "triggeredBy": "user@example.com"
  }
}
```

### SQLite schema

```sql
CREATE TABLE workflows (
  workflow_id   TEXT PRIMARY KEY,
  workflow_name TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'running',
  started_at    TEXT NOT NULL,
  completed_at  TEXT,
  metadata      TEXT  -- JSON blob
);

CREATE TABLE steps (
  step_id       TEXT PRIMARY KEY,
  workflow_id   TEXT NOT NULL REFERENCES workflows(workflow_id),
  step_index    INTEGER NOT NULL,
  name          TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'pending',
  started_at    TEXT,
  completed_at  TEXT,
  duration_ms   INTEGER,
  output        TEXT,  -- JSON blob
  gate_type     TEXT,
  gate_config   TEXT   -- JSON blob
);

CREATE TABLE events (
  event_id      INTEGER PRIMARY KEY AUTOINCREMENT,
  workflow_id   TEXT NOT NULL REFERENCES workflows(workflow_id),
  timestamp     TEXT NOT NULL,
  event_type    TEXT NOT NULL,
  payload       TEXT NOT NULL  -- JSON blob
);
```

### SSE stream architecture

```
Workflow executor
  |
  +---> Step completes ---> Write to state file
  |                    ---> Append to events table / in-memory ring buffer
  |                    ---> Push to SSE broadcaster
  |
SSE broadcaster
  |
  +---> Connected clients receive live events
  |
  +---> New client connects with ?offset=N
  |       |
  |       v
  |     Replay events from offset N, then stream live
```

### Resume flow

```
Orchestrator startup
  |
  +---> Check for existing state file in workflow directory
  |
  +---> State file found?
  |       |
  |       YES ---> Parse state, find last completed step
  |       |         |
  |       |         v
  |       |       Prompt: "Resume from step 3/5 (deploy)? [Y/n]"
  |       |         |
  |       |         Y ---> Skip completed steps, execute from current
  |       |         N ---> Archive old state, start fresh
  |       |
  |       NO ---> Create new state file, execute from step 1
```

## Implementation approach

1. **Phase 1 -- state file core**: Implement the JSON state file writer with atomic writes, step lifecycle hooks (create, update, complete), and the state query API.
2. **Phase 2 -- resume detection**: Add startup detection of existing state files, resume prompt, and step-skipping logic.
3. **Phase 3 -- checkpoint and approval gates**: Implement gate declarations in workflow definitions, pause/resume mechanics, timeout handling, and escalation policies.
4. **Phase 4 -- SQLite backend**: Add SQLite as an alternative backend for workflows requiring concurrent access, with WAL mode and the events table for append-only logging.
5. **Phase 5 -- SSE stream server**: Implement the append-only event broadcaster with offset-based replay for late-joining clients.
6. **Phase 6 -- integration**: Wire state persistence into existing orchestrator commands and verify end-to-end resume across crash scenarios.

## Success criteria

- **SC-001**: A workflow that crashes mid-execution can be resumed from the last completed step by rerunning the same command, with no step re-execution for already-completed steps.
- **SC-002**: Checkpoint gates pause execution and persist `"awaiting_checkpoint"` status; execution resumes only after explicit operator confirmation.
- **SC-003**: Approval gates that exceed their timeout transition the workflow to the configured escalation outcome (fail, skip, or notify).
- **SC-004**: An SSE client connecting mid-workflow with `?offset=0` receives all historical events followed by live events.
- **SC-005**: State files survive process crashes without corruption (atomic write verification).
- **SC-006**: The state query API returns accurate workflow status at any point during execution.

## Dependencies

| Spec | Relationship |
|------|-------------|
| 035-agent-governed-execution | Governed execution dispatches steps that this feature persists |
| 042-multi-provider-agent-registry | Provider sessions may need to be re-established on resume |

## Risk

- **R-001**: State file corruption from non-atomic writes on certain filesystems. Mitigation: use write-to-temp-then-rename pattern; verify atomicity in integration tests on target platforms.
- **R-002**: Resume may produce different results if external state has changed between crash and resume (e.g., upstream API changes). Mitigation: document that resume guarantees step-skip but not idempotency of the environment; recommend idempotent step design.
- **R-003**: Large workflows with many steps may produce large state files. Mitigation: SQLite backend handles large state efficiently; JSON backend is recommended only for workflows under 100 steps.


## Security hardening amendment (2026-07-02)

Documented the security boundary on run_verify_commands and the claude executor spawn where config and spec-derived command strings run via the shell, referencing the spec-162 sandbox contract as the isolation point; execution semantics are unchanged.

Recorded during the cross-subsystem security-hardening sweep; couples the security fixes in the code paths this spec authors to their owning spec per the spec 127 coupling gate.
