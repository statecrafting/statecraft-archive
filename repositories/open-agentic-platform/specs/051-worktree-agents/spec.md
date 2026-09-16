---
id: "051-worktree-agents"
title: "Background Agents with Git Worktree Isolation"
feature_branch: "051-worktree-agents"
status: approved
implementation: complete
kind: platform
domain: opc
created: "2026-03-29"
authors:
  - "open-agentic-platform"
language: en
summary: >
  Background agent system supporting up to N concurrent agents, each running in
  an isolated git worktree with its own branch. Agents run in skip-permissions
  mode with inactivity timeouts and lifecycle events. On completion, users get a
  diff preview and merge choice.
code_aliases:
  - WORKTREE_AGENTS
establishes:
  - unit: { kind: crate, id: "@opc/worktree-agents" }
  - unit: { kind: file, path: product/apps/opc/src-tauri/src/commands/worktree_agents.rs }
---

# Feature Specification: Background Agents with Git Worktree Isolation

## Purpose

Running multiple agent tasks concurrently today risks file conflicts — agents operating on the same working directory can overwrite each other's changes or corrupt uncommitted state. Consolidation sources — claudepal (background agent spawning), crystal (WorktreeManager) — each implement worktree-based isolation independently with incompatible lifecycle management, no shared concurrency limits, and no unified merge workflow.

This feature introduces a background agent system where each agent runs in its own git worktree on a dedicated branch. Agents operate in skip-permissions mode (pre-approved tool access) with inactivity timeouts. When an agent completes, the user reviews a diff preview and chooses whether to merge the changes back into their working branch.

## Scope

### In scope

- **Worktree lifecycle management**: Creating, tracking, and cleaning up git worktrees for background agents. Each worktree gets a unique branch derived from the current HEAD.
- **Concurrency control**: A configurable maximum number of concurrent background agents (default: 4). Excess requests are queued.
- **Skip-permissions mode**: Background agents run with a pre-approved permission set — no interactive prompts. The permission set is defined at spawn time.
- **Inactivity timeouts**: Agents that produce no output for a configurable duration (default: 5 minutes) are terminated and their worktree is preserved for inspection.
- **Lifecycle events**: Agents emit lifecycle events (spawned, running, tool_use, completed, failed, timed_out) that the UI and other systems can subscribe to.
- **Diff preview on completion**: When an agent completes, the system generates a diff between the agent's branch and the parent branch and presents it for review.
- **Merge workflow**: After reviewing the diff, the user can merge (fast-forward or squash), cherry-pick specific commits, or discard the agent's changes.
- **Worktree cleanup**: Completed or discarded worktrees and their branches are cleaned up automatically.

### Out of scope

- **Multi-repository worktrees**: Worktrees are created within the current repository only.
- **Agent collaboration**: Agents in different worktrees do not communicate with each other. Inter-agent coordination is a separate concern.
- **Conflict resolution UI**: If a merge produces conflicts, standard git conflict markers are written and the user resolves them manually. An interactive conflict resolution UI is deferred.
- **Remote push**: The system does not push agent branches to a remote. The user pushes after merge if desired.
- **Agent task planning**: This feature handles isolation and lifecycle. What the agent is instructed to do is determined by the caller.

## Requirements

### Functional

- **FR-001**: `spawnBackgroundAgent(task, options)` creates a new git worktree from the current HEAD, checks out a new branch (e.g., `agent/048-fix-typos`), and starts an agent session in that worktree.
- **FR-002**: The system enforces a configurable maximum concurrent agent count (default: 4). If the limit is reached, new spawn requests are queued in FIFO order and started as slots become available.
- **FR-003**: Background agents run in skip-permissions mode with a permission set specified at spawn time. The permission set defines which tools and patterns are pre-approved (integrating with the permission system from spec 049).
- **FR-004**: Each background agent has an inactivity timeout (default: 5 minutes, configurable). If the agent produces no events for the timeout duration, it is terminated. The worktree is preserved for inspection.
- **FR-005**: Agents emit lifecycle events: `spawned` (worktree created, agent starting), `running` (first output received), `tool_use` (tool invocation), `completed` (agent finished normally), `failed` (agent errored), `timed_out` (inactivity timeout reached).
- **FR-006**: On agent completion, `getAgentDiff(agentId)` returns the unified diff between the agent's branch and the parent branch, along with a commit log summary.
- **FR-007**: `mergeAgent(agentId, strategy)` merges the agent's branch into the parent branch using the specified strategy: `fast-forward`, `squash`, or `cherry-pick` (with commit selection).
- **FR-008**: `discardAgent(agentId)` deletes the agent's worktree and branch, cleaning up all resources.
- **FR-009**: `listAgents()` returns all active and recently completed background agents with their status, branch name, elapsed time, and last event.
- **FR-010**: The agent's worktree shares the repository's `.git` directory (standard git worktree behavior) but has its own working tree and index, ensuring isolation from the main working directory.

### Non-functional

- **NF-001**: Worktree creation completes in < 2 seconds for repositories up to 1GB.
- **NF-002**: Background agents do not degrade the interactive agent's responsiveness — they run in separate processes.
- **NF-003**: Worktree cleanup is idempotent — calling discard on an already-cleaned-up agent is a no-op.

## Architecture

### Component structure

```
packages/worktree-agents/
  src/
    index.ts                  — Public API: spawn, list, merge, discard, getAgentDiff
    types.ts                  — AgentHandle, AgentStatus, SpawnOptions, MergeStrategy
    worktree-manager.ts       — Git worktree create/list/remove operations
    agent-runner.ts           — Agent process lifecycle (start, monitor, timeout, stop)
    concurrency.ts            — Semaphore-based concurrency limiter with FIFO queue
    lifecycle-events.ts       — Event emitter for agent lifecycle events
    diff.ts                   — Diff generation between agent branch and parent
    merge.ts                  — Merge strategies (fast-forward, squash, cherry-pick)
    cleanup.ts                — Worktree and branch cleanup
```

### Spawn flow

```
User: spawnBackgroundAgent("Fix all typos in docs/", { maxTools: 50 })
  |
  v
Concurrency check: slots available?
  |
  NO  --> Queue request (FIFO)
  YES --> Continue
  |
  v
Create worktree:
  git worktree add .worktrees/agent-<id> -b agent/<id>-fix-typos
  |
  v
Start agent process in worktree directory
  - Skip-permissions mode with pre-approved tool set
  - Inactivity timeout timer started
  |
  v
Emit lifecycle event: "spawned"
  |
  v
Agent runs, producing events...
  - Each event resets inactivity timer
  - Tool use events emitted as lifecycle events
  |
  v
Agent completes / fails / times out
  |
  v
Emit lifecycle event: "completed" | "failed" | "timed_out"
  |
  v
Release concurrency slot, start next queued agent if any
```

### Completion and merge flow

```
Agent completed
  |
  v
User: getAgentDiff(agentId)
  |
  v
git diff main...agent/<id>-fix-typos
  + commit log summary
  |
  v
User reviews diff
  |
  +---> mergeAgent(agentId, "squash")
  |       git merge --squash agent/<id>-fix-typos
  |       git worktree remove .worktrees/agent-<id>
  |       git branch -d agent/<id>-fix-typos
  |
  +---> discardAgent(agentId)
          git worktree remove .worktrees/agent-<id>
          git branch -D agent/<id>-fix-typos
```

### Worktree layout

```
my-repo/                          (main working tree)
  .worktrees/
    agent-a1b2c3/                 (background agent 1)
    agent-d4e5f6/                 (background agent 2)
  .git/
    worktrees/
      agent-a1b2c3/              (git worktree metadata)
      agent-d4e5f6/
```

## Implementation approach

1. **Phase 1 — worktree manager**: Implement git worktree create, list, remove operations. Handle branch naming, directory layout, and cleanup.
2. **Phase 2 — concurrency control**: Implement the semaphore-based concurrency limiter with configurable max slots and FIFO queue.
3. **Phase 3 — agent runner**: Implement agent process lifecycle — spawning the Claude Code SDK in a worktree directory, monitoring output, enforcing inactivity timeouts.
4. **Phase 4 — lifecycle events**: Implement the event emitter and subscribe interface for agent lifecycle events.
5. **Phase 5 — diff and merge**: Implement diff generation between agent and parent branches, and the three merge strategies.
6. **Phase 6 — integration**: Wire into the desktop app and CLI so users can spawn, monitor, review, and merge background agents.

## Success criteria

- **SC-001**: Spawning a background agent creates a new git worktree and branch, starts the agent in that directory, and the main working tree is unaffected.
- **SC-002**: With max concurrency set to 2, spawning a third agent queues it until one of the first two completes.
- **SC-003**: An agent that produces no output for 5 minutes is terminated and its lifecycle event shows `timed_out`.
- **SC-004**: `getAgentDiff` returns a correct unified diff showing all changes the agent made.
- **SC-005**: `mergeAgent` with squash strategy applies all agent changes as a single commit on the parent branch.
- **SC-006**: `discardAgent` removes the worktree directory and deletes the agent branch, leaving no artifacts.

## Dependencies

| Spec | Relationship |
|------|-------------|
| 049-permission-system | Skip-permissions mode uses pre-approved permission sets defined by the permission system |
| 048-hookify-rule-engine | Hook rules apply within agent worktrees the same as the main session |
| 050-tool-renderer-system | Subagent container rendering displays background agent tool output |
| 035-agent-governed-execution | Background agents use governed execution for tool dispatch |

## Risk

- **R-001**: Git worktrees share the object store, so large concurrent operations (e.g., multiple agents writing large files) may cause contention on the `.git` directory. Mitigation: agents primarily read and make small edits; file-level locking in git handles concurrent access.
- **R-002**: Merge conflicts between the agent branch and parent branch (if the parent has moved) may be confusing. Mitigation: the diff preview shows the conflict potential, and the merge operation reports conflicts clearly rather than silently failing.
- **R-003**: Orphaned worktrees (from crashes) consume disk space. Mitigation: a periodic cleanup task detects worktrees whose agent process is no longer running and removes them after a grace period.
- **R-004**: Skip-permissions mode reduces safety guardrails. Mitigation: the pre-approved permission set is explicitly defined at spawn time and integrates with the safety tier system (spec 036) to enforce minimum safety standards.
