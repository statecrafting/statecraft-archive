---
id: "044-multi-agent-orchestration"
title: "multi-agent orchestration with file-based artifact passing"
feature_branch: "044-multi-agent-orchestration"
status: superseded
implementation: n/a
superseded_by: "089-governed-convergence-plan"
kind: platform
domain: opc
created: "2026-03-29"
authors:
  - "open-agentic-platform"
language: en
summary: >
  Introduce an orchestrator that decomposes complex tasks into discrete steps, assigns each
  to a specialized agent, and passes intermediate results via filesystem artifacts instead of
  conversation context — achieving ~90% token reduction in multi-agent workflows while
  maintaining full auditability through a dependency graph and artifact lifecycle protocol.
code_aliases:
  - MULTI_AGENT_ORCHESTRATION
establishes:
  - unit: { kind: file, path: crates/orchestrator/src/lib.rs }
  - unit: { kind: file, path: crates/orchestrator/src/artifact.rs }
  - unit: { kind: file, path: crates/orchestrator/src/manifest.rs }
---

# Feature Specification: multi-agent orchestration with file-based artifact passing

## Supersession

This feature has been superseded by `089-governed-convergence-plan`, which drove the implementation of all core concepts from this spec — DAG dispatch, file-based artifact passing, effort levels, and workflow manifests — in `crates/orchestrator/`. The convergence phases (specs 094-099) then extended well beyond this spec's scope with artifact memory, checkpoint branching, promotion-grade mirroring, governance gates, and workspace-scoped persistence. The living implementation truth is `crates/orchestrator/src/` plus specs 089-099.

## Purpose

Multi-agent workflows today pass full intermediate results through conversation context. A research agent produces 40k tokens of analysis, which is then injected verbatim into a drafting agent's prompt, which in turn emits another large payload for a review agent. Each hop multiplies token consumption and risks exceeding context windows, while degrading response quality as context fills with stale intermediate material.

File-based artifact passing solves this: agents write results to well-known filesystem paths, and downstream agents read only the files they need. The orchestrator tracks dependencies between steps so that an agent is not dispatched until its input artifacts exist. Trigger phrases (quick, investigate, deep) control agent effort depth, allowing the same workflow graph to produce proportional output.

Sources: claude-code-by-agents, skills (deep-researcher), product-manager-cc-commands, agents, claudepal.

## Scope

### In scope

- **Orchestrator engine** — accepts a task description, decomposes it into a step graph, dispatches each step to a specialized agent, and collects completion status.
- **Artifact passing protocol** — agents write output to filesystem artifacts at conventional paths; downstream agents receive artifact paths as input rather than raw content.
- **Step dependency graph** — DAG model where each step declares its input artifacts (produced by prior steps) and output artifacts. The orchestrator topologically sorts and dispatches steps respecting dependencies.
- **Trigger phrase classification** — the orchestrator interprets effort-level directives (quick / investigate / deep) and propagates them to agent prompts, controlling output depth and token budget.
- **Artifact lifecycle management** — creation, retention, and cleanup of artifact files across workflow runs.
- **Workflow manifest** — declarative format for defining reusable multi-agent workflows.

### Out of scope

- **Distributed execution** — all agents run on the local machine; remote agent dispatch is a follow-on.
- **Real-time streaming between agents** — artifacts are complete files, not streaming pipes.
- **Agent capability negotiation** — agents are assumed to be pre-registered (see 042-multi-provider-agent-registry); this feature does not handle agent discovery.
- **Conflict resolution** — if two steps produce the same artifact path, this is a validation error, not a merge scenario.
- **Persistent workflow history** — run metadata lives for the duration of the session; cross-session persistence is a follow-on.

## Requirements

### Functional

- **FR-001**: The orchestrator accepts a natural-language task and produces a step dependency graph (DAG) with at least one step. Each step specifies: agent ID, input artifact paths, output artifact paths, and effort level.
- **FR-002**: Steps are dispatched in topological order. A step is not dispatched until all of its declared input artifacts exist on the filesystem.
- **FR-003**: Agents write output artifacts to `$OAP_ARTIFACT_DIR/<run_id>/<step_id>/` (default `$OAP_ARTIFACT_DIR` is `/tmp/oap-artifacts`). File names follow the pattern `<artifact_name>.md` (or other extensions as declared).
- **FR-004**: When an agent step is invoked, its system prompt includes the absolute paths of its input artifacts and a directive to read them via the filesystem rather than expecting content in the conversation.
- **FR-005**: Trigger phrases map to effort levels that constrain agent behavior:
  - **quick** — single-pass, < 2k token output per step, no sub-agent calls.
  - **investigate** — iterative with tool use, up to 10k token output per step.
  - **deep** — unrestricted depth, agents may spawn sub-workflows, no token cap.
- **FR-006**: The orchestrator emits a structured run summary upon completion listing each step, its agent, status (success/failure/skipped), artifact paths, and token usage.
- **FR-007**: A workflow can be defined declaratively in a YAML manifest and loaded by the orchestrator, bypassing natural-language decomposition.
- **FR-008**: If a step fails, downstream dependent steps are marked `skipped` and the orchestrator reports which artifact was missing or which step errored.

### Non-functional

- **NF-001**: Artifact-based passing reduces total token consumption by at least 80% compared to context-passing for a 3-step workflow with 20k-token intermediate results.
- **NF-002**: Orchestrator dispatch overhead (excluding agent execution time) is < 200ms per step.
- **NF-003**: Artifact files are readable by any agent runtime (plain text / markdown); no proprietary serialization.

## Architecture

### Orchestrator dispatch flow

```
User task + effort level
  |
  v
Orchestrator: decompose_task(task, effort_level)
  |
  v
Step dependency graph (DAG)
  |
  v
Topological sort -> dispatch queue
  |
  v
For each ready step (all input artifacts exist):
  |
  +---> Resolve agent from registry (042)
  |
  +---> Build agent prompt:
  |       - Step instruction
  |       - Input artifact paths (absolute)
  |       - Output artifact path convention
  |       - Effort level directive
  |
  +---> Dispatch agent execution (governed, via 035)
  |
  +---> Agent writes output artifact(s) to filesystem
  |
  +---> Orchestrator marks step complete, unlocks dependents
  |
  v
All steps complete (or failure cascade)
  |
  v
Run summary emitted
```

### Artifact directory layout

```
$OAP_ARTIFACT_DIR/
  <run_id>/
    manifest.yaml              # frozen copy of the step graph for this run
    summary.json               # run summary (written on completion)
    step-01-research/
      research_output.md       # artifact written by research agent
    step-02-draft/
      draft_output.md          # artifact written by drafting agent
    step-03-review/
      review_output.md         # artifact written by review agent
      review_annotations.json  # optional structured artifact
```

### Step dependency graph model

Each step is a node in a directed acyclic graph:

```yaml
steps:
  - id: step-01-research
    agent: deep-researcher
    effort: investigate
    inputs: []                           # no dependencies — root step
    outputs:
      - research_output.md
    instruction: "Research the topic and write findings."

  - id: step-02-draft
    agent: technical-writer
    effort: investigate
    inputs:
      - step-01-research/research_output.md
    outputs:
      - draft_output.md
    instruction: "Draft a document based on the research findings."

  - id: step-03-review
    agent: code-reviewer
    effort: quick
    inputs:
      - step-02-draft/draft_output.md
    outputs:
      - review_output.md
    instruction: "Review the draft for accuracy and clarity."
```

Validation rules:
- The graph must be acyclic (cycle detection at load time).
- Every input path must be an output of a prior step or a pre-existing file.
- No two steps may declare the same output path.

### Trigger phrase classification

| Trigger phrase | Effort level | Token budget per step | Agent behavior |
|---------------|-------------|----------------------|----------------|
| "quick" / "briefly" / "glance" | quick | < 2k tokens | Single pass, no tool use, concise output |
| "investigate" / "look into" / "analyze" | investigate | < 10k tokens | Iterative, tool use allowed, thorough output |
| "deep dive" / "exhaustive" / "comprehensive" | deep | Uncapped | Sub-workflows allowed, maximum depth |

The orchestrator extracts the effort level from the user's task phrasing. If no trigger phrase is detected, the default is `investigate`.

### Orchestrator contract

The orchestrator exposes the following interface:

| Operation | Input | Output |
|-----------|-------|--------|
| `orchestrate(task, effort?)` | Natural-language task, optional effort override | Run ID |
| `orchestrate_manifest(manifest_path)` | Path to YAML workflow manifest | Run ID |
| `get_run_status(run_id)` | Run ID | Step statuses, artifact paths, token usage |
| `cancel_run(run_id)` | Run ID | Acknowledgment; running step finishes, pending steps marked `cancelled` |
| `cleanup_artifacts(run_id)` | Run ID | Deletes artifact directory for the run |

Error semantics:
- `StepFailed { step_id, reason }` — an agent step returned a non-zero exit or failed to produce declared outputs.
- `DependencyMissing { step_id, artifact_path }` — a step's input artifact does not exist when dispatch is attempted.
- `CycleDetected { cycle }` — the step graph contains a cycle (validation-time error).
- `AgentNotFound { agent_id }` — referenced agent is not in the registry (042).

### Key integration points

| Component | File / Module | Role |
|-----------|--------------|------|
| Orchestrator engine | `crates/orchestrator/src/lib.rs` (new) | Task decomposition, DAG dispatch, run lifecycle |
| Artifact manager | `crates/orchestrator/src/artifact.rs` (new) | Artifact path resolution, cleanup, validation |
| Workflow manifest | `crates/orchestrator/src/manifest.rs` (new) | YAML manifest parsing and DAG construction |
| Trigger classifier | `crates/orchestrator/src/effort.rs` (new) | Effort level extraction from natural language |
| Agent dispatch | `commands/agents.rs` | Extended to accept artifact paths and effort directives |
| Agent registry | 042-multi-provider-agent-registry | Agent lookup by ID |
| Governed execution | 035-agent-governed-execution | Permission enforcement during agent dispatch |
| Tauri commands | `commands/orchestrator.rs` (new) | Expose orchestrator operations to UI |

## Success criteria

- **SC-001**: A 3-step workflow (research -> draft -> review) completes end-to-end with each agent reading input from filesystem artifacts, not conversation context.
- **SC-002**: Token usage for the 3-step workflow is at least 80% lower than an equivalent single-context approach (measured via token counters in the run summary).
- **SC-003**: A step with an unsatisfied dependency is not dispatched; the orchestrator reports `DependencyMissing` and marks downstream steps `skipped`.
- **SC-004**: A YAML workflow manifest loads, validates (acyclic, no duplicate outputs), and dispatches correctly.
- **SC-005**: Trigger phrases "quick", "investigate", and "deep dive" produce measurably different output sizes for the same task.
- **SC-006**: `cleanup_artifacts(run_id)` removes the entire run directory and its contents.
- **SC-007**: `execution/verification.md` records commands and results for all criteria.

## Contract notes

- Artifact paths are always absolute. Agents receive them as `$OAP_ARTIFACT_DIR/<run_id>/<step_id>/<filename>` — they must not assume relative paths.
- The run ID is a UUID v4, generated at orchestration start.
- Artifact files are plain text (Markdown, JSON, YAML). Binary artifacts are not supported in MVP.
- The orchestrator does not parse or validate artifact content — it only checks file existence. Content correctness is the agent's responsibility.
- Effort level is advisory: agents should respect token budgets but the orchestrator does not enforce hard truncation.
- Parallel dispatch: steps at the same topological level with no mutual dependencies may be dispatched concurrently. MVP may serialize for simplicity; concurrent dispatch is a fast-follow.
- The `manifest.yaml` frozen into the run directory is the authoritative record of what was planned, even if the original manifest file is later modified.

## Risk

- **R-001**: LLM-based task decomposition may produce poor step graphs for ambiguous tasks. Mitigation: support declarative YAML manifests as an escape hatch; iterate on decomposition prompts.
- **R-002**: Agents may not reliably write artifacts to the declared paths if the file-write instruction is lost in a long context. Mitigation: artifact path is injected as the final line of the agent's system prompt and repeated in the user message.
- **R-003**: Large artifact files (> 100k tokens) may still cause issues if an agent attempts to read the entire file into context. Mitigation: document best practices for chunked reading; consider artifact summarization in a follow-on.
- **R-004**: Effort-level classification from natural language may misfire. Mitigation: allow explicit `--effort` flag override; default to `investigate` when uncertain.
