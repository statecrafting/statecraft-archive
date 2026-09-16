# Bounded-context agents

A single agent asked to be analyst, data modeler, API designer, frontend developer, test writer, and reviewer at once carries an enormous instruction payload. As context grows, important instructions get compressed away and quality drifts between the first feature and the fiftieth.

## The bounded-context principle

The factory avoids this by giving each agent a narrow job and a small context. A stage agent reads one slice of the specification and one pattern, and produces one artifact. Its context is measured in single-digit thousands of tokens, not hundreds of thousands, so quality stays consistent across a run.

## How it works in practice

Each process agent declares its boundaries in YAML frontmatter:

| Field | Purpose |
|-------|---------|
| `stage` | Which pipeline stage this agent serves (or omitted for orchestrators). |
| `safety_tier` | The maximum privilege tier (all process agents are `tier1`). |
| `mutation` | What the agent may write (`read-only` or `scoped-write` with an explicit scope). |
| `context_budget` | The approximate token budget for the agent's working context. |

The eight process agents each own a single stage or coordination role. None of them holds the whole pipeline in memory. The orchestrator sequences them, but each agent receives only the inputs relevant to its stage.

## Why this matters for quality

When an agent's context is small and focused:

- Instructions are never compressed away by context window pressure.
- The agent cannot accidentally reference artifacts from a different stage.
- Quality is consistent whether the run produces three features or thirty.
- Failures are isolated to a single stage and can be retried without re-running the pipeline.

## Relationship to OAP dispatch

The Open Agentic Platform runs each stage as a governed dispatch with a bounded context. The factory's small, single-purpose agent prompts are exactly the shape a per-step dispatch expects: one specification slice plus one pattern, not the whole pipeline. This alignment is by design; the bounded-context model maps directly onto OAP's dispatch surface.
