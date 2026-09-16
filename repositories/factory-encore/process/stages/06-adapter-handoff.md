# Stage 06: Adapter Handoff

**Sequence:** 6
**Agent:** scaffolding-orchestrator (invokes adapter agents)
**Mutation:** read-only orchestration; adapter agents perform scoped writes

## Purpose

Hand the frozen Build Specification to the bound adapter and orchestrate code
generation. The orchestrator never writes application code itself; it sequences
the adapter's agents one feature at a time and runs the verification harness
after each step.

## Inputs

- `.factory/build-spec.yaml` (frozen at Stage 5)
- `.factory/adapter-manifest.yaml` (resolved at pre-flight)

## Phases

1. **Initialize** the project from the adapter scaffold, install dependencies,
   and verify the project compiles.
2. **Data** scaffolding, per entity: invoke the adapter's data agent, then run
   the compile check.
3. **API** scaffolding, per operation: invoke the adapter's API agent for one
   operation, then run compile and test. Retry on failure up to the adapter's
   retry limit; record and continue on persistent failure.
4. **UI** scaffolding, per page: invoke the adapter's UI agent for one page,
   with the same verify-and-retry policy.
5. **Configure** project identity, auth, and environment wiring.
6. **Trim** scaffold artifacts that the chosen variant does not use.
7. **Final validation**: run the adapter's full build, test, lint, type-check,
   and format checks, plus the cross-stage traceability checks (every use case
   maps to code, every page has a covering test, no placeholder markers remain).

## Gates

- `scaffolding_gates`: each per-feature step passes its compile and test checks
  before the next feature begins.
- `final_validation`: the full build and all declared checks pass with no
  outstanding placeholders.

## Notes

Progress is written to `.factory/pipeline-state.json` after each feature, so a
crashed or paused run resumes from the first pending or failed item rather than
restarting. The set of available adapter agents (for example, an optional
reviewer or seed generator) is declared in the adapter manifest.
