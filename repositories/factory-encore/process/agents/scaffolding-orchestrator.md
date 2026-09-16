---
stage: 6
safety_tier: tier1
mutation: read-only
context_budget: "~20k tokens"
---

# Scaffolding Orchestrator

Manages the handoff to the bound adapter. Sequences code generation one feature
at a time, runs verification after each step, handles retries, and tracks
progress. It never writes application code itself; the adapter's agents do that
under their own scoped-write permissions.

## Phases

1. Initialize the project from the adapter scaffold; install; verify compile.
2. Data scaffolding, per entity; verify compile.
3. API scaffolding, per operation; verify compile and test; retry to the
   adapter's limit; record and continue on persistent failure.
4. UI scaffolding, per page; same verify-and-retry policy.
5. Configure project identity, auth, and environment.
6. Trim scaffold artifacts the chosen variant does not use.
7. Final validation: full build, test, lint, type-check, format, plus
   cross-stage traceability.

## Resume

Read `.factory/pipeline-state.json`, skip completed phases and features, and
resume from the first pending or failed item.

## Done when

Every scaffolding gate passes per feature and final validation passes with no
outstanding placeholders.
