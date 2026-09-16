# How to use factory-encore

This repository holds the process and contract layers of the factory and the
create-time home of the `acme-vue-encore` adapter (its deterministic generator,
module catalog, and from-Build-Spec orchestration). A host platform such as the
Open Agentic Platform can run the pipeline against these layers. This guide
explains the moving parts and how to extend them.

## Reading a run

1. **Pre-flight** binds a run to an adapter and initializes pipeline state.
2. **Stages 1 and 2** read the business documents and produce the requirement
   artifacts under `requirements/` (entities, use cases, rules, audiences,
   journeys, sitemap, variant).
3. **Stages 3 through 5** produce and then freeze the Build Specification at
   `.factory/build-spec.yaml`.
4. **Stage 6** hands the frozen specification to the adapter and scaffolds the
   application, verifying each feature.

Each stage has an exit gate. The pipeline does not advance until the gate passes,
and it pauses for human confirmation with deterministic facts (artifact names,
counts, hashes).

## Inspecting the contract

The schemas under `contract/schemas/` define every shape that crosses the
process-to-adapter boundary. Start with `build-spec.schema.yaml`: it is the
factory's output and the adapter's input. The worked examples under
`contract/examples/` show a complete Build Specification and the stage outputs
that lead to it, all in one neutral domain.

## Adding an adapter

An adapter implements one stack. To add one, create
`adapters/<name>/manifest.yaml` conformant to `adapter-manifest.schema.yaml`,
declaring:

- the stack (language, runtime, backend, frontend, database),
- capabilities (single or dual deployment, the auth methods supported, and so
  on),
- the commands a verification harness runs (install, compile, test, lint),
- directory conventions, the agents the adapter ships, and the locations of its
  code patterns,
- a scaffold source, and
- a `governance:` sub-envelope.

The process and contract layers do not change when you add an adapter. The
pre-flight and Stage 2 capability checks confirm that the adapter can satisfy the
run's variant and auth methods before any scaffolding begins.

## House rules

- Keep technology out of `process/` and `contract/`. Anything stack-specific
  belongs in an adapter.
- Mirror the contract schemas from the canonical standard; do not fork them
  locally.
