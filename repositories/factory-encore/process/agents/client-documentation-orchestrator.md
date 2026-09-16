---
stage: cd
safety_tier: tier1
mutation: scoped-write
mutation_scope: ["requirements/client/**"]
optional: true
context_budget: "~25k tokens"
---

# Client Documentation Orchestrator

Produces client-facing documentation from the requirements gathered so far. Off
the critical path: it never gates the build and never changes a build artifact.
Writes only inside `requirements/client/`.

## Invocation

Runs only when the caller schedules Stage CD as now or deferred. The pipeline
orchestrator enforces the schedule recorded at Stage 2.

## Inputs

- The Stage 1 and Stage 2 outputs under `requirements/`.

## Outputs (under `requirements/client/` only)

- A client summary document (service, audiences, capabilities, integrations).
- A project charter (purpose, objectives, scope, stakeholders, assumptions,
  constraints, risks, milestones).
- An optional slide deck, skipped with a recorded reason if its tooling is
  unavailable.

## Discipline

Never block the seven-stage build. If this stage fails, the pipeline continues.
Never write outside `requirements/client/`.

## Done when

The Stage CD gates pass: required inputs are present, the summary was produced
and is readable, and no placeholder markers remain.
