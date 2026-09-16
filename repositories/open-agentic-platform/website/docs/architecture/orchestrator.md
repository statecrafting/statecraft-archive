# Orchestrator

The Orchestrator (`crates/orchestrator/`) is the execution engine responsible for running multi-step workflows, such as the Factory Pipeline. It manages state, dependencies, agent dispatch, and validation gates.

## Core Concepts

### WorkflowManifest
Every workflow is defined by a `WorkflowManifest`. This manifest declares the steps, their inputs and outputs, the assigned agents, effort levels, required gates, and post-step verification commands.

### DAG Validation
The orchestrator performs a topological sort on the steps defined in the manifest. This ensures that steps are executed in the correct dependency order. If the Directed Acyclic Graph (DAG) contains cycles or missing dependencies, validation fails before execution begins.

### Artifact Passing
Unlike conversational agent loops that rely on context windows, the orchestrator uses file-based artifact passing. Each step reads from absolute paths and writes to declared output paths. This ensures that intermediate state is durable and inspectable.

### Verify and Retry
A critical feature of the orchestrator is its verify-and-retry loop. After a step generates code, the orchestrator runs the verification commands defined in the manifest (e.g., `cargo check` or `tsc`). 

If the verification fails, the orchestrator does not immediately halt. Instead, it rebuilds the prompt, appending the `stderr` output, and asks the agent to fix the error. This process retries up to three times before escalating.

### Gates
The orchestrator enforces two types of human-in-the-loop gates:
- **Checkpoint**: Pauses execution to allow a human to review the intermediate artifacts.
- **Approval**: Requires explicit human consent to proceed, often with a timeout and escalation path.

### State Persistence and SSE
Execution state is persisted to a SQLite backend, allowing workflows to survive crashes and resume seamlessly. 

As the workflow progresses, the orchestrator emits Server-Sent Events (SSE). The OPC desktop application consumes this event stream to provide real-time visualization of the pipeline DAG and artifact generation.
