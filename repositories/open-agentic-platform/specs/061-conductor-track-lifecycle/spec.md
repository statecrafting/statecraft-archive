---
id: "061-conductor-track-lifecycle"
title: "Conductor Track Lifecycle"
feature_branch: "061-conductor-track-lifecycle"
status: approved
implementation: complete
kind: platform
domain: opc
created: "2026-03-29"
amended: "2026-05-30"
amendment_record: |
  amended by spec 182 (2026-05-30) — the `/implement-plan` command
  this spec established was migrated verbatim to the skills surface
  (`.claude/skills/implement-plan/SKILL.md`) and the legacy command
  file deleted in the spec-182 deprecation PR. Because spec 182
  establishes the skill file, 061's `establishes:` claim on the now-
  deleted command file is converted to a `references:` (role:
  historical) edge on the skill successor. No behavioral change.
authors:
  - "open-agentic-platform"
language: en
summary: >
  Spec-driven work units ("tracks") with a formal lifecycle: Pending, In Progress,
  Complete, Archived. Each track is a directory containing spec.md, plan.md, and
  metadata.json. The conductor agent manages track transitions with TDD phase
  checkpoints. Tracks are git-aware, enabling logical-unit revert when a track
  fails. The plan-implementer skill executes plan steps within a track context.
code_aliases:
  - CONDUCTOR_TRACK
sources:
  - agents/conductor
  - skills/plan-implementer
  - developer-cc-commands
establishes:
  - unit: { kind: directory, path: product/packages/conductor-track }
references:
  - role: historical
    unit: { kind: file, path: .claude/skills/implement-plan/SKILL.md }
  - role: historical
    unit: { kind: file, path: .claude/agents/conductor.md }
---

# Feature Specification: Conductor Track Lifecycle

> **Amended by spec 182 (2026-05-30).** The `/implement-plan` command
> this spec established was migrated verbatim to
> `.claude/skills/implement-plan/SKILL.md` and the legacy command file
> deleted in the spec-182 deprecation PR. Spec 182 establishes the
> skill file; 061's prior `establishes:` claim is recorded as a
> `references:` (historical) edge. No behavioral change.

## Purpose

Work in the platform currently lacks a formal unit of organization. Developers and agents operate on loosely defined tasks with no structured lifecycle, no consistent artifact layout, and no way to atomically revert a logical unit of work. When a multi-step implementation fails partway through, there is no clean mechanism to roll back to the pre-track state.

This feature introduces "tracks" as the fundamental work unit managed by the conductor agent. Each track has a well-defined lifecycle, a standard directory structure with spec, plan, and metadata artifacts, TDD phase checkpoints to ensure quality gates, and git-aware boundaries that enable reverting an entire logical unit of work.

## Scope

### In scope

- **Track lifecycle state machine**: States Pending -> In Progress -> Complete -> Archived, with defined transitions and guard conditions.
- **Track directory structure**: Each track is a directory containing `spec.md`, `plan.md`, and `metadata.json` with standardized schemas.
- **Conductor agent integration**: The conductor agent creates, transitions, and monitors tracks. It owns the lifecycle state machine.
- **Plan-implementer skill binding**: The plan-implementer skill executes within a track context, reading `plan.md` and updating `metadata.json` as steps complete.
- **TDD phase checkpoints**: Each track phase (Red, Green, Refactor) must pass defined criteria before the track can advance.
- **Git-aware revert**: Each track records its git boundary (start commit, branch) so the entire track can be reverted as a logical unit.
- **Developer CC commands**: CLI commands for listing, inspecting, transitioning, and reverting tracks.

### Out of scope

- **Multi-track orchestration**: Parallel track execution and inter-track dependencies are a follow-on concern.
- **Track templates**: Pre-built track templates for common patterns (e.g., "add API endpoint") are deferred.
- **UI visualization**: Visual track boards or Kanban views are not part of this feature.
- **Automated track creation from issues**: Deriving tracks from GitHub issues is a separate integration.

## Requirements

### Functional

- **FR-001**: A track is created by the conductor agent with a unique id, a `spec.md` describing the work, and initial state `Pending`.
- **FR-002**: Track state transitions follow the state machine: `Pending -> In Progress -> Complete -> Archived`. Invalid transitions are rejected with a descriptive error.
- **FR-003**: Transitioning from `Pending` to `In Progress` generates a `plan.md` (via the plan-implementer skill) and records the current git HEAD as the track's start boundary.
- **FR-004**: Each track directory contains exactly three artifacts: `spec.md` (what to build), `plan.md` (how to build it, with ordered steps), and `metadata.json` (state, timestamps, git refs, phase checkpoints).
- **FR-005**: The plan-implementer skill operates within a track context: it reads `plan.md` for the step sequence and updates `metadata.json` as each step completes.
- **FR-006**: TDD phase checkpoints require: (a) Red phase — failing test(s) written, (b) Green phase — tests pass with minimal implementation, (c) Refactor phase — code cleaned up, tests still pass. Each phase is recorded in `metadata.json`.
- **FR-007**: Reverting a track resets the git state to the track's start boundary commit, removing all commits made during the track's execution.
- **FR-008**: The `track list` command shows all tracks with their current state, creation date, and last activity timestamp.
- **FR-009**: The `track inspect <id>` command shows full track metadata including plan progress and phase checkpoints.
- **FR-010**: Transitioning to `Complete` requires all plan steps to be marked done and all TDD phases to have passed.

### Non-functional

- **NF-001**: Track metadata reads and writes complete in < 50ms for tracks with up to 100 plan steps.
- **NF-002**: Git revert of a track with up to 50 commits completes in < 5 seconds.
- **NF-003**: Track directory structure is self-contained and portable — moving the directory preserves all track information.

## Architecture

### Track directory structure

```
tracks/
  <track-id>/
    spec.md          — What to build (authored by conductor or human)
    plan.md          — Ordered implementation steps (generated by plan-implementer)
    metadata.json    — Machine-readable state, timestamps, git refs, checkpoints
```

### metadata.json schema

```typescript
interface TrackMetadata {
  id: string;
  title: string;
  state: "pending" | "in_progress" | "complete" | "archived";
  createdAt: string;   // ISO 8601
  updatedAt: string;   // ISO 8601
  git: {
    startCommit: string;       // SHA at track start
    branch: string;            // Branch the track operates on
    endCommit?: string;        // SHA at track completion
  };
  plan: {
    totalSteps: number;
    completedSteps: number;
    steps: PlanStep[];
  };
  tdd: {
    red: PhaseCheckpoint | null;
    green: PhaseCheckpoint | null;
    refactor: PhaseCheckpoint | null;
  };
}

interface PlanStep {
  index: number;
  description: string;
  status: "pending" | "in_progress" | "done" | "skipped";
  completedAt?: string;
}

interface PhaseCheckpoint {
  passedAt: string;
  commitSha: string;
  testResults?: { passed: number; failed: number; skipped: number };
}
```

### State machine

```
  [Pending]
      |
      | start() — generates plan.md, records git start boundary
      v
  [In Progress]
      |
      | complete() — all steps done, all TDD phases passed
      v
  [Complete]
      |
      | archive()
      v
  [Archived]

  Any state except Archived:
      |
      | revert() — git reset to start boundary
      v
  [Reverted] (terminal, track directory removed or marked reverted)
```

### Conductor and plan-implementer interaction

```
Conductor agent
  |
  +---> Creates track (spec.md, metadata.json with state=pending)
  |
  +---> Transitions to in_progress
  |       |
  |       +---> plan-implementer skill generates plan.md
  |       +---> Records git start boundary
  |
  +---> Monitors plan-implementer execution
  |       |
  |       +---> plan-implementer reads plan.md steps
  |       +---> For each step: execute, update metadata.json
  |       +---> At phase boundaries: run TDD checkpoint
  |
  +---> Transitions to complete when all gates pass
  |
  +---> Transitions to archived when no longer needed
```

## Implementation approach

1. **Phase 1 — track data model and storage**: Define `TrackMetadata`, `PlanStep`, `PhaseCheckpoint` types and implement read/write operations for the track directory structure.
2. **Phase 2 — state machine**: Implement the track lifecycle state machine with guard conditions for each transition.
3. **Phase 3 — conductor integration**: Wire the conductor agent to create and transition tracks, generating `spec.md` from task descriptions.
4. **Phase 4 — plan-implementer binding**: Update the plan-implementer skill to operate within a track context, reading steps from `plan.md` and updating `metadata.json`.
5. **Phase 5 — TDD checkpoints**: Implement phase checkpoint validation (test runner integration) and gate transitions on checkpoint passage.
6. **Phase 6 — git-aware revert**: Implement track revert by resetting to the recorded start commit, with safety checks for uncommitted changes.
7. **Phase 7 — CLI commands**: Add `track list`, `track inspect`, `track revert`, and `track archive` developer commands.

## Success criteria

- **SC-001**: The conductor agent can create a track, transition it through Pending -> In Progress -> Complete -> Archived, with all artifacts generated at each stage.
- **SC-002**: The plan-implementer skill reads `plan.md` steps within a track and updates `metadata.json` progress after each step.
- **SC-003**: TDD phase checkpoints block the transition to Complete if any phase has not passed.
- **SC-004**: Reverting an in-progress track with 10 commits resets git to the start boundary and marks the track as reverted.
- **SC-005**: `track list` and `track inspect` display accurate state and progress information.

## Dependencies

| Spec | Relationship |
|------|-------------|
| 042-multi-provider-agent-registry | Conductor agent uses providers from the registry for plan generation |
| 035-agent-governed-execution | Track operations are governed actions subject to safety tier rules |

## Risk

- **R-001**: Git revert of a track could conflict with other concurrent work on the same branch. Mitigation: tracks operate on dedicated branches by default; revert checks for uncommitted changes and concurrent modifications before proceeding.
- **R-002**: TDD phase checkpoints depend on a working test runner. Mitigation: phase checkpoints can be manually overridden by the conductor with an explicit reason recorded in metadata.
- **R-003**: Large tracks with many plan steps could become unwieldy. Mitigation: the conductor can split large specs into multiple smaller tracks as a pre-processing step.
