# The pipeline and gates

The factory-encore process layer runs as an ordered pipeline of stages. Each stage has a mechanical exit gate that must pass before the pipeline advances. Gates check the filesystem and the artifacts, not an agent's claim that the work is done.

## The shape of a run

A run progresses through the following stages in order:

| Stage | Name | Purpose |
|-------|------|---------|
| 00 | Pre-flight | Proves the run is startable; binds to an adapter; initializes pipeline state. |
| 01 | Business Requirements | Extracts entities, use cases, and business rules from source documents. |
| 02 | Service Requirements | Shapes the service: audiences, journeys, sitemap, variant selection. |
| 03 | Data Model | Designs the entity-relationship model and produces the data model specification. |
| 04 | API Specification | Specifies operations, endpoints, and the API surface. |
| 05 | UI Specification | Specifies pages, views, and the UI surface; freezes the Build Specification. |
| 06 | Adapter Handoff | Hands the frozen specification to the adapter; scaffolds the application feature by feature. |
| CD | Client Documentation | Optional stage that produces client-facing summaries; never blocks the build. |

## Ordered stages with exit gates

The pipeline does not advance until the current stage's exit gate passes. Each gate is factory-owned and mechanical: it checks the filesystem for the expected artifacts rather than trusting an agent's self-assessment.

For example, Stage 02 has an internal phase gate between Phase B and Phase C. The gate walks the `requirements/journeys/` directory to confirm that journey maps exist for every declared audience before allowing the stage to proceed to its final phase. This is a filesystem check, not a model-generated report.

## Why automated verification

No agent validates its own output. The adapter declares the build, test, and lint commands; a verification harness runs them after each scaffolding step. This separation ensures that:

- Quality is consistent across a run regardless of context window pressure.
- Failures are caught mechanically and retried, not masked by optimistic self-reports.
- The verification contract is declarative and auditable.

## Why durable state

Pipeline state is written after every successful step. A crash or a pause is recoverable: the orchestrator reads the state, skips completed work, and resumes from the first pending or failed item. Re-running a stage writes a new pipeline record and preserves the old artifacts for audit.

The Pipeline State schema (`pipeline-state.schema.yaml`) defines the durable structure: stage progress, scaffolding status, verification results, and an audit trail.

## Human-in-the-loop gates

The pipeline pauses for human confirmation at stage boundaries, presenting deterministic facts (artifact names, counts, hashes). It never presents model-generated rationales. The governance envelope declares four predicates:

1. **Approval before Build Spec freeze**: a human approval gate exists before the Build Specification is frozen at Stage 5.
2. **Checkpoint before any scoped write**: a checkpoint gate exists before any stage whose agents exceed read-only mutation.
3. **Plain-language summaries**: gate prompts present deterministic facts only.
4. **Preview with no side effects**: rendering a preview of any artifact performs no state-changing or network calls.
