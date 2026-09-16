# Process agents

The process layer ships eight focused agents under `process/agents/`. Each agent has a narrow job, a small context budget, and declared safety boundaries in its YAML frontmatter.

## Agent inventory

| Agent | Stage | Safety tier | Mutation | Context budget |
|-------|-------|-------------|----------|----------------|
| Pipeline Orchestrator | (all) | tier1 | read-only | ~20k tokens |
| Business Requirements Analyst | 1 | tier1 | read-only | ~50k tokens |
| Service Designer | 2 | tier1 | read-only | ~35k tokens |
| Data Architect | 3 | tier1 | read-only | ~30k tokens |
| API Architect | 4 | tier1 | read-only | ~40k tokens |
| UI Architect | 5 | tier1 | read-only | ~30k tokens |
| Scaffolding Orchestrator | 6 | tier1 | read-only | ~20k tokens |
| Client Documentation Orchestrator | CD | tier1 | scoped-write | ~25k tokens |

## Frontmatter fields

Every process agent declares the following in its YAML frontmatter:

- **`stage`**: the pipeline stage this agent serves (omitted for the pipeline orchestrator, which coordinates all stages).
- **`safety_tier`**: the maximum privilege tier. All process agents are `tier1`.
- **`mutation`**: what the agent may write. Seven agents are `read-only`; the client-documentation orchestrator is `scoped-write` with `mutation_scope: ["requirements/client/**"]`.
- **`context_budget`**: the approximate token budget for the agent's working context.

## Governance envelope ceilings

The process governance envelope (`process/governance-envelope.yaml`) declares aggregate ceilings that must bound the per-agent frontmatter:

- **`max_tier`**: `tier1` (all agents are tier1).
- **`max_mutation`**: `scoped-write` (the ceiling is set by the single scoped-write agent).

OAP independently recomputes the aggregate from the agent frontmatter and confirms the declared ceilings bound it. This is a two-sided, fail-closed validation.

## Pipeline Orchestrator

Coordinates the end-to-end pipeline. It invokes each stage agent in order, runs the verification gate after each stage, persists pipeline state, and hands off to the scaffolding orchestrator. It holds no domain content of its own; it sequences and checks.

Key responsibilities:
- Run stages in order; never start stage N+1 until stage N's exit gate passes.
- Pause for human confirmation with deterministic facts only.
- Write pipeline state after every successful step.
- Resume from artifacts on disk rather than memory.

## Scaffolding Orchestrator

Sequences the adapter's code-generation agents against the frozen Build Specification at Stage 6. It never writes application code itself; it invokes the adapter's agents (data scaffolder, API scaffolder, UI scaffolder, configurer, trimmer) and runs the verification harness after each feature.

## Client Documentation Orchestrator

The only process agent with write permissions. It runs off the critical path (optional, never blocks the build), consumes Stage 1 and 2 outputs, and produces client-facing documentation under `requirements/client/`. Its scoped-write mutation is bounded to that directory only.
