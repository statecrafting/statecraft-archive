# OAP integration

`factory-encore` is an implementation of the Open Agentic Platform (OAP) factory
standard. OAP defines the contract and the governance surface; this repository
supplies the process layer that produces conformant artifacts and the
`acme-vue-encore` adapter (with its create-time generator) that consumes them.
This document maps the layers onto OAP.

## What OAP owns

OAP is the host platform. It publishes the canonical factory contract under
`standards/schemas/factory/` and provides the typed implementations and the
validation logic. The five schemas in `contract/schemas/` here mirror that
standard so the process and any adapter can be developed against a stable
interface.

OAP defines the contract and the governance surface. It does not ship process
stages, agent prompts, or adapters; those are authored by a factory like this
one.

## How the layers map

- **Contract.** OAP is the source of truth for the Build Specification, Adapter
  Manifest, Verification Contract, Pipeline State, and Governance Envelope. This
  repository mirrors the schema versions it targets (Build Spec and Adapter
  Manifest at 1.1.0; Verification, Pipeline State, and Governance Envelope at
  1.0.0).

- **Governance envelope (admission).** Before OAP admits a factory, the factory
  files a governance envelope: its objective class, its ceilings, the
  human-in-the-loop gate predicates it guarantees, and the artifact kinds it
  emits. OAP validates the envelope two ways: it checks the envelope against the
  schema, and it independently recomputes the aggregate from the factory's own
  agent frontmatter (the per-agent tier and mutation declarations) and confirms
  the declared ceilings bound it. The envelope at `process/governance-envelope.yaml`
  is this factory's brief.

- **Dispatch.** OAP runs each stage as a governed dispatch with a bounded
  context. The factory's small, single-purpose agent prompts are exactly the
  shape a per-step dispatch expects: one specification slice plus one pattern,
  not the whole pipeline.

- **State and artifacts.** Pipeline progress is written to a durable state
  document conformant to the Pipeline State schema, which makes a run resumable
  across dispatches. The artifacts a run emits (the Build Specification, the
  stage outputs, the pipeline state, and the handoff report) are the kinds the
  governance envelope declares.

## Reference specifications

The OAP specifications that define this surface are public in the OAP
repository. In brief:

- The factory contracts crate establishes the typed contract layer and the
  discovery, agent-loading, and pattern-resolution seams.
- The factory becomes a first-class, organization-scoped platform feature rather
  than repo-rooted files.
- The project lifecycle defines how projects are created, imported, and opened,
  anchored on conformance to the contract.
- Signed inter-stage manifests carry a cryptographic identity assertion between
  stages so a hand-off cannot be forged.
- The governance envelope is the admission contract described above.

Consult the OAP repository for the authoritative text; this document only
summarizes how `factory-encore` sits inside that platform.
