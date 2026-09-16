# Architecture

`factory-encore` is built on one idea: separate the process of building software
from the technology that implements it, and put a formal contract between them.
That separation is what lets the same pipeline target any stack and lets a new
stack arrive without touching the pipeline.

## The three layers

**Process** is universal. Its stages read business documents and produce a
structured specification. The process never names a framework, a language, or a
file path. It reasons about entities, use cases, rules, audiences, pages, and
operations, all technology-neutral.

**Contract** is the interface. Five schemas define the shapes that cross the
boundary: the Build Specification (the process output), the Adapter Manifest
(what an adapter declares), the Verification Contract (what must pass), the
Pipeline State (durable progress), and the Governance Envelope (the admission
brief). The contract is an open standard with a canonical home in the Open
Agentic Platform; this repository mirrors it.

**Adapter** is specific. Each adapter implements exactly one stack. It declares
its capabilities in a manifest, ships focused agents and code patterns, and names
the commands a verification harness runs. Adding a stack means adding an adapter.

## Why bounded-context agents

A single agent asked to be analyst, data modeler, API designer, frontend
developer, test writer, and reviewer at once carries an enormous instruction
payload. As context grows, important instructions get compressed away and
quality drifts between the first feature and the fiftieth.

The factory avoids this by giving each agent a narrow job and a small context.
A stage agent reads one slice of the specification and one pattern, and produces
one artifact. Its context is measured in single-digit thousands of tokens, not
hundreds of thousands, so quality stays consistent across a run.

## Why automated verification

No agent validates its own output. The adapter declares the build, test, and
lint commands; a verification harness runs them after each scaffolding step.
Per-stage gates are factory-owned and mechanical: they check the filesystem and
the artifacts, not an agent's claim that the work is done. This is why Stage 2's
phase B to phase C gate walks the journeys directory rather than trusting a
report.

## Why durable state

Pipeline state is written after every successful step. A crash or a pause is
recoverable: the orchestrator reads the state, skips completed work, and resumes
from the first pending or failed item. Re-running a stage writes a new pipeline
record and preserves the old artifacts for audit.

## The shape of a run

Pre-flight proves the run is startable. Stages 1 and 2 extract requirements and
shape the service. Stages 3 through 5 design the data model, the API, and the UI,
building the Build Specification and freezing it at Stage 5. Stage 6 hands the
frozen specification to the adapter and scaffolds the application one feature at
a time, verifying as it goes. An optional client-documentation stage runs off the
critical path and never blocks the build.
