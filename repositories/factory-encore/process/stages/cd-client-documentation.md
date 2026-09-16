# Stage CD: Client Documentation (optional)

**Sequence:** runs after Stage 2, before Stage 3
**Agent:** client-documentation-orchestrator
**Mutation:** scoped-write to `requirements/client/`
**Optional:** yes

## Purpose

Produce client-facing documentation from the requirements gathered so far. This
stage is off the critical path: it never gates the build and never changes any
build artifact.

## Scheduling

The caller chooses when Stage 2 hands off: run it now, skip it, or defer it. The
default is skip. The choice is recorded in the Stage 2 handoff and is fixed for
the run.

## Inputs

- The Stage 1 and Stage 2 outputs under `requirements/`.

## Outputs

Written only under `requirements/client/`:

- A client summary document (the service, its audiences, capabilities, and
  integrations).
- A project charter (purpose, objectives, scope, stakeholders, assumptions,
  constraints, risks, milestones).
- An optional slide deck, skipped with a recorded reason if its tooling is
  unavailable.

## Gates

- `CD-001` The required inputs are present.
- `CD-002` The summary document was produced and is readable.
- `CD-003` No placeholder markers remain in the output.

## Notes

This stage must never block the seven-stage build. If it fails, the pipeline
continues. It writes only inside `requirements/client/` and never touches
`requirements/` at large, the Build Specification, or pipeline artifacts.
