# Stage 01: Business Requirements

**Sequence:** 1
**Agent:** business-requirements-analyst
**Mutation:** read-only (writes requirement artifacts)

## Purpose

Read the raw business documents and extract structured, machine-readable
requirements. This stage turns prose into typed artifacts that every later stage
consumes. It makes no technology decisions.

## Inputs

- The business artifacts gathered at pre-flight.

## Outputs

Written under `requirements/`:

- `brd.md`: a narrative business requirements summary for human review.
- `entity-model.json`: the nouns the system tracks, conformant to
  `stage-outputs/entity-model.schema.json`.
- `use-cases.json`: every action an actor performs, in `UC-nnn` form,
  conformant to `stage-outputs/use-cases.schema.json`.
- `business-rules.json`: constraints, validations, computations, state
  machines, and authorization rules, in `BR-nnn` form, conformant to
  `stage-outputs/business-rules.schema.json`.
- `integration-register.json`: external systems the requirements imply
  (file storage, data ingestion, email, identity provider, external API,
  message queue).

## Gates

The Stage 1 gate must pass before Stage 2 starts:

- `S1-001` The narrative `brd.md` exists.
- `S1-002` At least one entity was extracted and the entity model conforms.
- `S1-003` At least one use case was extracted and conforms.
- `S1-004` At least one business rule was extracted and conforms.

## Notes

Every claim that names an external entity must be grounded. See
`process/skills/validate.md` for the external-provenance rule that the Stage 1
gate enforces: a named external system is either traced to the source documents
or carried as an explicit, expiring assumption, never invented silently.
