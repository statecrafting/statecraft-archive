---
id: "043-agent-organizer"
title: "agent organizer and meta-orchestrator"
feature_branch: "043-agent-organizer"
status: approved
implementation: complete
kind: platform
domain: opc
created: "2026-03-29"
authors:
  - "open-agentic-platform"
language: en
summary: >
  A meta-orchestrator agent that triages incoming requests, scores complexity, decides
  whether to delegate or handle directly, assembles optimal agent teams with phased
  workflows and dependency management, and routes planning work to Haiku while reserving
  Sonnet/Opus for execution — replacing ad-hoc agent selection with governed dispatch.
code_aliases:
  - AGENT_ORGANIZER
extends:
  - spec: "004-spec-to-execution-bridge-mvp"
    nature: additive
    unit: { kind: file, path: crates/agent/src/complexity.rs }
  - spec: "004-spec-to-execution-bridge-mvp"
    nature: additive
    unit: { kind: file, path: crates/agent/src/dispatch.rs }
  - spec: "004-spec-to-execution-bridge-mvp"
    nature: additive
    unit: { kind: file, path: crates/agent/src/plan.rs }
  - spec: "004-spec-to-execution-bridge-mvp"
    nature: additive
    unit: { kind: crate, id: orchestrator }
---

# Feature Specification: agent organizer and meta-orchestrator

## Purpose

Today, agent selection in OAP is manual: the user picks an agent from the registry and executes it. There is no system-level intelligence for decomposing a complex request into sub-tasks, selecting the right agents for each sub-task, ordering execution phases, or deciding whether a request is simple enough to handle directly without agent delegation. Users must understand the agent catalog to make good choices, and multi-agent workflows require manual coordination.

This feature introduces an Agent Organizer — a lightweight meta-orchestrator that sits at the front of the agent execution pipeline. It analyzes incoming requests, scores their complexity, applies dispatch rules (delegate vs. handle directly), assembles agent teams when delegation is warranted, defines phased workflows with dependency tracking, and routes its own planning work to the cheapest model (Haiku) since it never implements — only plans.

Sources: claude-code-sub-agents (agent-organizer + dispatch protocol), claudepal (complexity scoring), agents (agent teams).

## Scope

### In scope

- **Complexity scoring algorithm** — a deterministic heuristic that analyzes the incoming prompt to produce a numeric complexity score, used to drive the delegate-vs-direct decision.
- **Dispatch protocol** — clear rules for when to delegate to an agent team vs. handle the request directly, including mandatory delegation triggers and mandatory direct-handling triggers.
- **Team assembly** — given a delegation decision, select the optimal set of agents (typically 3 for focused tasks, more for complex multi-domain work) from the agent registry, with justifications.
- **Phased workflow definition** — decompose the delegated task into ordered phases with explicit dependencies, inputs, outputs, and success gates between phases.
- **Model routing** — the organizer itself runs on Haiku (cheapest model); assembled agents run on Sonnet or Opus based on task requirements.
- **Integration with agent registry** — the organizer reads available agents from the registry (Feature 042) and selects from what is actually available.
- **Structured output contract** — the organizer emits a JSON plan document consumed by the execution layer.

### Out of scope

- **Agent execution runtime** — this feature defines the plan; execution of the assembled workflow is handled by the existing agent execution path (Feature 035) and future multi-agent orchestration.
- **File-based artifact passing** — inter-agent communication via filesystem artifacts is a separate orchestration concern.
- **Agent creation** — the organizer selects from existing agents; it does not create new agent definitions.
- **UI for plan visualization** — a future feature may render the phased workflow in the desktop app.
- **Learning/feedback loops** — the organizer does not adapt its scoring or selection based on past execution outcomes.

## Requirements

### Functional

- **FR-001**: The organizer exposes a `plan(request: string, context?: PlanContext)` interface that accepts a user request and returns a structured execution plan.
- **FR-002**: The complexity scoring algorithm produces a numeric score (0-100) from the input prompt using the signals defined in the Architecture section. The score is included in the plan output for auditability.
- **FR-003**: Requests with complexity score <= 25 (simple) are marked as `direct` — no agent delegation. The plan output indicates the request should be handled by the current session.
- **FR-004**: Requests with complexity score > 25 are marked as `delegated` and include a team composition, phased workflow, and per-agent justification.
- **FR-005**: Mandatory delegation triggers override the complexity score: any request involving code generation, multi-file refactoring, debugging across modules, architecture analysis, feature implementation, test suite creation, or documentation generation is always delegated regardless of score.
- **FR-006**: Mandatory direct-handling triggers override the complexity score: single-file edits, simple questions, configuration changes, and single-command operations are always handled directly regardless of score.
- **FR-007**: The team composition includes 1-5 agents selected from the registry, each with a role label and delegation justification.
- **FR-008**: The phased workflow defines ordered phases, where each phase specifies: agent(s), task description, input dependencies (outputs from prior phases), expected output artifact, and a success gate (condition to proceed).
- **FR-009**: The organizer itself runs on `haiku` model. Agent assignments in the plan specify the recommended model tier (`haiku`, `sonnet`, or `opus`) based on task complexity within each phase.
- **FR-010**: When the agent registry is unavailable or empty, the organizer degrades to always returning `direct` plans with a warning.

### Non-functional

- **NF-001**: Planning latency (organizer execution time) is < 3 seconds p95 on Haiku for requests under 2000 tokens.
- **NF-002**: The complexity scoring algorithm is deterministic — the same input always produces the same score (no LLM involvement in scoring).
- **NF-003**: The plan output is valid JSON conforming to the `ExecutionPlan` schema defined in this spec.

## Architecture

### Complexity scoring algorithm

The scoring algorithm is a deterministic heuristic (no LLM call) that analyzes the raw prompt text. It produces a score from 0 to 100 by summing weighted signals:

| Signal | Weight | Measurement |
|--------|--------|-------------|
| Prompt length | 0-20 | Linear scale: 0 at <=50 chars, 20 at >=2000 chars |
| Action verb count | 0-20 | Count of imperative verbs (create, build, implement, refactor, fix, add, remove, update, migrate, deploy, test, review, analyze, design, optimize). 1 verb = 5, 2 = 10, 3 = 15, 4+ = 20 |
| Multi-step connectors | 0-20 | Count of sequencing words (then, after, next, finally, first, also, additionally, followed by, once, before). Each adds 5, capped at 20 |
| Technology breadth | 0-15 | Count of distinct technology domains mentioned (frontend, backend, database, API, infrastructure, testing, security, CI/CD). Each adds 5, capped at 15 |
| Scope indicators | 0-15 | Presence of scope-expanding phrases: "across all" (+5), "entire codebase" (+5), "end-to-end" (+5), "full-stack" (+5), "comprehensive" (+5), capped at 15 |
| File/path references | 0-10 | Count of file paths or glob patterns mentioned. 1-2 = 3, 3-5 = 6, 6+ = 10 |

**Score bands:**
- 0-25: **Simple** — handle directly
- 26-50: **Moderate** — delegate to 1-2 agents
- 51-75: **Complex** — delegate to 2-3 agents
- 76-100: **Highly complex** — delegate to 3-5 agents

### Dispatch protocol

```
Request arrives
  |
  v
Apply mandatory triggers
  |
  +---> [Mandatory DIRECT triggers matched]
  |       "single file edit", "what is", "how do I",
  |       "run command", "config change", "explain"
  |       |
  |       v
  |     Return plan: { mode: "direct" }
  |
  +---> [Mandatory DELEGATE triggers matched]
  |       "implement feature", "refactor", "debug across",
  |       "create test suite", "generate docs", "build",
  |       "review PR", "analyze architecture", "migrate"
  |       |
  |       v
  |     Score complexity -> assemble team -> phased workflow
  |
  +---> [No mandatory trigger]
          |
          v
        Score complexity
          |
          +---> score <= 25 -> Return plan: { mode: "direct" }
          +---> score > 25  -> Assemble team -> phased workflow
```

**NEVER delegate:**
- Conversational questions ("what is X?", "explain Y")
- Single-command execution ("run tests", "build project")
- Simple lookups ("show me file X", "what's the status of Y")
- Configuration tweaks ("set X to Y", "enable feature Z")

**ALWAYS delegate:**
- Multi-file code generation or refactoring
- Cross-module debugging or investigation
- Architecture design or review
- Full test suite creation
- Documentation generation for multiple components
- Feature implementation spanning frontend and backend
- Security audits or performance analysis

### Team assembly rules

When delegation is warranted, the organizer selects agents using these rules:

1. **Query the agent registry** for all available agents with their capability descriptions.
2. **Match capabilities to task requirements** — the organizer (running on Haiku) analyzes the request against agent descriptions to find the best fits.
3. **Prefer focused teams** — default to 3 agents unless the task clearly requires more or fewer. One agent per concern (e.g., one for implementation, one for testing, one for review).
4. **Assign roles** — each agent gets a role label: `lead` (primary implementer), `support` (secondary/specialized), `reviewer` (quality gate).
5. **Include justification** — each agent selection includes a one-sentence reason explaining why this agent was chosen for this task.
6. **Model assignment** — planning/analysis agents get `sonnet`; implementation agents get `sonnet` or `opus` based on task difficulty; review agents get `sonnet`.

### Phased workflow definition

Each delegated plan includes a phased workflow:

```json
{
  "phases": [
    {
      "id": "phase-1",
      "name": "Analysis",
      "agents": ["backend-architect"],
      "task": "Analyze current API structure and identify integration points",
      "depends_on": [],
      "output": "analysis-report.md",
      "success_gate": "Report identifies all affected endpoints and data models",
      "model": "sonnet"
    },
    {
      "id": "phase-2",
      "name": "Implementation",
      "agents": ["full-stack-developer", "typescript-pro"],
      "task": "Implement the feature based on analysis report",
      "depends_on": ["phase-1"],
      "output": "implementation files",
      "success_gate": "All new code compiles and existing tests pass",
      "model": "opus"
    },
    {
      "id": "phase-3",
      "name": "Verification",
      "agents": ["code-reviewer"],
      "task": "Review implementation against requirements and architecture standards",
      "depends_on": ["phase-2"],
      "output": "review-report.md",
      "success_gate": "No critical or high-severity findings",
      "model": "sonnet"
    }
  ]
}
```

Phases execute sequentially by default. Phases with no dependency overlap may execute in parallel (indicated by sharing the same `depends_on` set).

### ExecutionPlan output schema

```typescript
interface ExecutionPlan {
  request_id: string;               // UUID for tracing
  mode: "direct" | "delegated";     // dispatch decision
  complexity: {
    score: number;                   // 0-100
    band: "simple" | "moderate" | "complex" | "highly_complex";
    signals: Record<string, number>; // individual signal scores
    mandatory_trigger?: string;      // if a mandatory rule fired, which one
  };
  team?: {                           // present when mode = "delegated"
    agents: Array<{
      agent_id: string;              // registry ID
      role: "lead" | "support" | "reviewer";
      justification: string;
      model: "haiku" | "sonnet" | "opus";
    }>;
  };
  workflow?: {                       // present when mode = "delegated"
    phases: Array<{
      id: string;
      name: string;
      agents: string[];              // agent_ids
      task: string;
      depends_on: string[];          // phase IDs
      output: string;
      success_gate: string;
      model: "haiku" | "sonnet" | "opus";
    }>;
  };
  warnings?: string[];               // degraded state warnings
}
```

### Key integration points

| Component | File | Change |
|-----------|------|--------|
| Organizer agent definition | `product/packages/agents/orchestration/agent-organizer.md` | New agent definition with system prompt |
| Complexity scorer | `crates/agent/src/complexity.rs` | New module: deterministic scoring algorithm |
| Dispatch protocol | `crates/agent/src/dispatch.rs` | New module: trigger matching + score-based routing |
| Plan schema | `crates/agent/src/plan.rs` | New module: `ExecutionPlan` struct + JSON serialization |
| Registry integration | `crates/agent/src/registry.rs` | Read available agents for team assembly |
| Tauri command | `product/apps/opc/src-tauri/src/commands/agents.rs` | New `plan_request` command exposing organizer to UI |
| Agent organizer prompt | `product/packages/agents/orchestration/agent-organizer.md` | Haiku-targeted prompt for team assembly and workflow definition |

## Success criteria

- **SC-001**: Given a simple request ("fix the typo in README.md"), the organizer returns `mode: "direct"` with complexity score <= 25.
- **SC-002**: Given a complex request ("implement user authentication with OAuth2 across the API and frontend, add tests, and update the docs"), the organizer returns `mode: "delegated"` with a team of 2-4 agents and a multi-phase workflow.
- **SC-003**: Mandatory delegation triggers always produce `mode: "delegated"` regardless of prompt length or other signals.
- **SC-004**: Mandatory direct-handling triggers always produce `mode: "direct"` regardless of complexity score.
- **SC-005**: The complexity scorer is deterministic: identical inputs produce identical scores across invocations.
- **SC-006**: The organizer runs on Haiku and completes planning in < 3 seconds for typical requests.
- **SC-007**: When the agent registry is empty, the organizer returns `mode: "direct"` with a warning.
- **SC-008**: `execution/verification.md` records commands and results for all criteria.

## Contract notes

- The complexity scoring algorithm is intentionally simple and deterministic (no LLM in the scoring loop). The LLM (Haiku) is only used for team assembly and workflow definition after the dispatch decision is made.
- Mandatory triggers are evaluated as substring/pattern matches against the raw prompt, before complexity scoring runs. They provide predictable behavior for common request shapes.
- The `ExecutionPlan` JSON schema is the contract between the organizer and the execution layer. Changes require a spec revision.
- Agent IDs in the plan reference the agent registry (Feature 042). If a referenced agent is not available at execution time, the execution layer must handle gracefully (skip or substitute).
- The organizer does not execute agents — it produces a plan. A separate execution runtime (future feature or existing agent execution path via Feature 035) consumes the plan.
- Model routing is advisory: the execution layer may override model selection based on availability or cost constraints.
- The score band thresholds (25/50/75) and signal weights are initial calibration values. They should be tuned based on observed dispatch accuracy once the system is live, via a spec revision.

## Risk

- **R-001**: The deterministic scoring heuristic may misclassify edge cases (e.g., a short prompt requesting a massive refactor). Mitigation: mandatory triggers catch the most common edge cases; score thresholds can be tuned post-launch.
- **R-002**: Haiku may produce lower-quality team assembly and workflow definitions compared to Sonnet. Mitigation: the organizer prompt is highly structured with examples; if quality is insufficient, the model can be upgraded to Sonnet with a modest cost increase.
- **R-003**: The agent registry (Feature 042) is a dependency — if it is not yet implemented, the organizer cannot assemble teams. Mitigation: the organizer degrades to direct-only mode when the registry is unavailable (FR-010).
- **R-004**: Phased workflows may be overly rigid for tasks that benefit from iterative exploration. Mitigation: the execution layer can re-invoke the organizer mid-workflow if a phase fails its success gate, allowing plan revision.
