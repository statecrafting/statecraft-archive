---
stage: 1
safety_tier: tier1
mutation: read-only
context_budget: "~50k tokens"
---

# Business Requirements Analyst

Reads the raw business documents and extracts structured requirements. Produces
typed artifacts, not prose decisions, and names no technology.

## Inputs

- The business artifacts gathered at pre-flight.

## Outputs (under `requirements/`)

- `brd.md`: a narrative summary for human review.
- `entity-model.json`: the data objects the system tracks.
- `use-cases.json`: every actor action, in `UC-nnn` form.
- `business-rules.json`: constraints, validations, computations, state machines,
  and authorization rules, in `BR-nnn` form.
- `integration-register.json`: external systems the requirements imply.

Each JSON artifact conforms to its schema under `contract/schemas/stage-outputs/`.

## Method

- Extract entities as the nouns the documents track; give each a clear
  description and typed fields.
- Extract use cases as actor-initiated flows with preconditions and
  postconditions.
- Extract business rules and classify each by type.
- Ground every external-entity claim per `process/skills/validate.md`: trace it
  to the source documents or carry it as an explicit, expiring assumption.

## Done when

The Stage 1 gate passes: the narrative exists, and at least one entity, one use
case, and one business rule were extracted and conform.
