# Stage 00: Pre-Flight

**Sequence:** 0
**Agent:** pipeline-orchestrator
**Mutation:** writes pipeline state only

## Purpose

Confirm the run can proceed before any analysis begins, and initialize durable
pipeline state. Pre-flight does not interpret business documents; it verifies
that the inputs are present and that a named adapter exists and is well-formed.

## Inputs

- The raw business artifacts the caller provided.
- The adapter name to bind this run to.

## Outputs

- `.factory/pipeline-state.json`: initialized with `status: running` and every
  stage marked `pending`, conformant to `pipeline-state.schema.yaml`.
- `.factory/adapter-manifest.yaml`: a resolved copy of the bound adapter's
  manifest, so later stages read a stable snapshot.

## Gates

The pre-flight gate (`PF`) must pass before Stage 1 starts:

- The adapter manifest is present and conforms to `adapter-manifest.schema.yaml`.
- The adapter declares the agents and pattern files its manifest references.
- The business artifacts are readable.
- Pipeline state was written and conforms to `pipeline-state.schema.yaml`.

## Notes

Pre-flight deliberately does not check capability match (whether the adapter can
satisfy the eventual variant and auth methods). That check needs the deployment
variant, which is not known until Stage 2. Pre-flight only proves the run is
startable.
