---
id: "165-opc-decomposition-pipeline"
slug: opc-decomposition-pipeline
title: "OPC decomposition pipeline — reverse-engineering and born-with spec spawning"
status: approved
implementation: complete
owner: bart
created: "2026-05-22"
kind: capability
domain: opc
risk: high
depends_on:
  - "032-opc-inspect-governance-wiring-mvp"  # opc-inspect-governance-wiring-mvp (OPC integration substrate)
  - "073-axiomregent-unification"  # axiomregent-unification (semantic search + checkpoint substrate)
  - "095-checkpoint-branch-of-thought"  # checkpoint-branch-of-thought
  - "115-knowledge-extraction-pipeline"  # knowledge-extraction-pipeline
  - "120-factory-extraction-stage"  # factory-extraction-stage
  - "147-spec-kind-grammar"  # spec-kind-grammar
  - "154-logical-unit-ownership-grammar"  # logical-unit-ownership-grammar
  - "156-references-edge-provenance-grammar"  # references-edge-provenance-grammar
  - "161-knowledge-requirements-provenance-emission"  # knowledge-requirements-provenance-emission (emission contract this spec satisfies)
code_aliases: ["OPC_DECOMPOSITION", "REVERSE_ENGINEERING_PIPELINE", "BORN_WITH_PIPELINE"]
establishes:
  - unit: { kind: directory, path: crates/opc-decomposition-pipeline }
  - unit: { kind: file, path: product/apps/opc/src-tauri/src/commands/decomposition.rs }
  # FR-001 React panel (completion landing): the "Decompose project"
  # surface + its panel shim.
  - unit: { kind: directory, path: product/apps/opc/src/features/decomposition }
  - unit: { kind: file, path: product/apps/opc/src/components/DecompositionPanel.tsx }
extends:
  # The OPC desktop's Tauri command boundary is co-authored under the
  # spec-032 inspect-governance MVP. Spec 165 additively adds a new
  # command surface (decomposition_run / list_runs / get_run) and the
  # crate dependency wiring; the touch is mechanical command-table
  # extension, not behavioural change to spec 032's own claims.
  - spec: "032-opc-inspect-governance-wiring-mvp"
    nature: additive
    unit: { kind: file, path: product/apps/opc/src-tauri/Cargo.toml }
  - spec: "032-opc-inspect-governance-wiring-mvp"
    nature: additive
    unit: { kind: file, path: product/apps/opc/src-tauri/src/commands/mod.rs }
  - spec: "032-opc-inspect-governance-wiring-mvp"
    nature: additive
    unit: { kind: file, path: product/apps/opc/src-tauri/src/lib.rs }
  # The new spec (and spec 192) entering the registry regenerates the
  # featuregraph golden; an additive touch to spec 034's fixture.
  - spec: "034-featuregraph-registry-scanner-fix"
    nature: additive
    unit: { kind: file, path: crates/featuregraph/tests/golden/features_graph.json }
refines:
  # FR-001 panel wiring threads through the OPC shell's tab plumbing + the
  # frontend Tauri bindings, whose authority is spec 180 (spec 183 set the
  # precedent of refining 180 for api.ts). Additive case/branch + wrapper
  # additions (a new 'decomposition' tab type, lazy case, and the four
  # decomposition* api wrappers), not behavioural changes to spec 180.
  - aspect: "decomposition-panel-shell-wiring"
    unit: { kind: file, path: product/apps/opc/src/lib/api.ts }
    refines_specs: ["180-opc-shell-codification"]
  - aspect: "decomposition-panel-shell-wiring"
    unit: { kind: file, path: product/apps/opc/src/contexts/TabContext.tsx }
    refines_specs: ["180-opc-shell-codification"]
  - aspect: "decomposition-panel-shell-wiring"
    unit: { kind: file, path: product/apps/opc/src/components/TabContent.tsx }
    refines_specs: ["180-opc-shell-codification"]
references:
  - role: decomposition-source
    unit: { kind: file, path: docs/owasp/factory/AIDE-VELOCITY-OAP-INTENT.md }
  - role: extraction-substrate
    unit: { kind: file, path: specs/120-factory-extraction-stage/spec.md }
  - role: xray-substrate
    unit: { kind: directory, path: crates/xray }
  - role: semantic-substrate
    unit: { kind: directory, path: crates/axiomregent }
  - role: provenance-consumer
    unit: { kind: file, path: specs/161-knowledge-requirements-provenance-emission/spec.md }
  - role: target-renderer
    unit: { kind: file, path: specs/163-statecraft-requirements-view/spec.md }
compliance:
  - framework: owasp-asi-2026
    controls: ["ASI06"]
summary: >
  The six-stage OPC pipeline that produces draft specs
  from external evidence: (1) knowledge extraction via
  spec 120's deterministic Rust extractor, (2) structural
  fingerprinting via xray, (3) semantic clustering via
  axiomregent/search, (4) behavioural traversal via the
  call graph + cross-reference data, (5) temporal lineage
  via git history mapped to logical units per spec 154,
  and (6) LLM synthesis that consumes the structured
  evidence from stages 1–5 and emits draft specs.

  Both reverse-engineering (the agent-builder-console
  case — an existing repo with no spec spine) and
  born-with (factory-engine adapter output bundles)
  flow through the same pipeline. Emitted draft specs
  carry `status: draft`, `origin: retroactive: true`,
  a declared `kind:` per spec 147, declared logical
  units per spec 154, and `role: decomposition-origin`
  references with `provenance:` per spec 161 (the
  emission contract).

  Draft specs land in the project's repo under
  `<project>/specs/` and surface in the statecraft
  Requirements view (spec 163). The developer reviews
  them there: edits, refinements, rejection of bad
  derivations, splitting of over-broad specs.
  Approved specs become the execution contract OPC
  pulls back to drive factory runs against the project.
---

# 165 — OPC decomposition pipeline

## 1. Problem

Two project shapes need spec spawning from OPC:

1. **Reverse-engineering** — a project imported into statecraft
   without a pre-existing spec spine (the agent-builder-console
   pattern per intent doc §6.5). Its working tree exists; its
   knowledge bundles may exist; its specs do not. A developer
   wants OPC to scan the project and propose draft specs
   capturing what the code already does, so the spec spine
   becomes the project's authored truth going forward.
2. **Born-with** — a project produced by factory-engine from an
   adapter (per spec 167's born-with kernel emission). The
   adapter knows what it scaffolded; the spec spine should
   reflect that knowledge from the moment the project is born.

Both shapes share the same logical pipeline: structured evidence
about the project + an LLM synthesis step that emits draft specs.
The intent doc §6.5 names this explicitly:

> *"The same decomposition pipeline supports the born-with case
> (when factory-engine produces a new project from an adapter)
> and the retrofit case (agent-builder-console). In the born-with
> case the input is the adapter's output bundle rather than an
> imported codebase, and the draft specs are richer (the adapter
> knows what it scaffolded), but the synthesis stage and the
> review/approve flow are identical."*

OPC is the right home for the pipeline (not statecraft) because:

- The pipeline needs filesystem access to the project's working
  tree — OPC has it; statecraft doesn't.
- xray's structural fingerprinting and call graph live in
  `crates/xray`, consumed by OPC's panels today.
- The synthesis step benefits from being near the developer
  (review, branch-of-thought, checkpoint) — all OPC capabilities.
- Statecraft is the *receiver* of the resulting draft specs
  (rendering them via spec 163's Requirements view), not the
  producer.

What's missing today: the pipeline itself. OPC has the individual
substrates (extraction, xray, semantic search, checkpoint) but no
named pipeline that composes them into spec spawning.

## 2. Decision

Specify the six-stage pipeline in OPC. Each stage is a discrete
producer with typed inputs and outputs; stages 1–5 are
deterministic (no LLM); stage 6 is the synthesis step.

### 2.1 Stage inventory

1. **Extraction** — spec 120's `s-1-extract` stage. The
   deterministic Rust extractor in `crates/artifact-extract`
   reads knowledge objects (PDFs, DOCXs, images, raw text) and
   emits typed `ExtractionOutput` records. No LLM at this stage —
   provenance-bearing, page-bounded structured text.
2. **Structural fingerprint** — `crates/xray` traverses the
   working tree, emitting fingerprints, complexity scores,
   language map, lines of code, file history. Output is a
   content-addressed fingerprint that spec 161's
   `provenance.kind: code-fingerprint` can reference.
3. **Semantic clustering** — `crates/axiomregent` (via its
   `search` module) produces conceptual clusters over the
   codebase via vector matching. Output is a set of clusters,
   each tagged with representative file paths and a textual
   summary.
4. **Behavioural traversal** — call graph + cross-reference
   data from `crates/xray`'s call-graph subsystem. Output is a
   graph of "what calls what," surfacing functional implications
   that pure syntactic inspection would miss.
5. **Temporal lineage** — git history mapped to logical units
   (per spec 154 grammar) so that *when* a piece of behaviour
   was introduced is captured alongside *what* it does. Output
   is per-unit `(unit, first_commit, last_commit, churn)`
   tuples.
6. **LLM synthesis** — the synthesiser consumes the structured
   evidence from stages 1–5 and emits **draft specs**. Each
   spec carries:
   - `status: draft`
   - `origin: retroactive: true` (honestly: it was
     reverse-engineered, not authored from intent first; in the
     born-with case this marker is `retroactive: true` for the
     adapter-derived specs and may be `false` for any
     specs the adapter explicitly seeds with intent-first
     framing)
   - declared `kind:` per spec 147
   - declared `category:` for grouping projection
   - declared logical units (per spec 154) for any
     `establishes:` / `extends:` / `refines:` / `references:`
     edges claimed
   - `references:` entries with `role: decomposition-origin`
     and `provenance:` per spec 161's emission contract,
     pointing at the originating knowledge item(s) and/or
     xray fingerprint(s)

### 2.2 Pipeline execution semantics

- The pipeline runs as a checkpoint-backed branch-of-thought
  (per spec 095) so the developer can explore alternative
  decompositions of the same evidence without committing to
  one trajectory.
- Stages 1–5 are cached. Re-running the pipeline against an
  unchanged working tree skips them; only stage 6 reruns if
  the developer wants a new synthesis with a different
  framing prompt.
- Stage 6 emits to a staging area inside the project
  (e.g., `<project>/.opc/decomposition/<run-id>/`), not
  directly into `<project>/specs/`. The developer reviews
  staged specs and promotes them via an explicit action.
- Promotion writes the spec files into
  `<project>/specs/NNN-slug/spec.md` and runs the project's
  own spec-compiler to update the project's
  `.derived/spec-registry/registry.json`.

### 2.3 Determinism and reproducibility

Stages 1–5 are deterministic for fixed inputs (content-addressed
hashing throughout). Stage 6 is non-deterministic by nature (LLM
outputs vary). The governance certificate emitted at promotion
records:

- The content hash of each stage's output (1–5).
- The synthesiser's model identity + prompt template hash.
- The set of promoted spec file hashes.
- The signer (per spec 102 FR-007).

This makes any promoted decomposition independently verifiable:
an auditor can confirm "these specs were promoted from these
inputs by this synthesiser under this prompt."

## 3. Functional Requirements

- **FR-001** OPC exposes a "Decompose project" action at the
  project workspace level. Triggering it runs the six-stage
  pipeline against the project's working tree and (if
  available) the project's statecraft knowledge bundle.
- **FR-002** Stages 1–5 produce typed, content-addressed
  outputs persisted under `<project>/.opc/decomposition/<run-id>/`.
- **FR-003** Stage 6 emits draft specs into the staging area
  under the same run-id directory. Specs are not written
  directly into `<project>/specs/` without an explicit
  developer promotion action.
- **FR-004** Each emitted draft spec satisfies spec 161's
  emission contract: at least one `references:` entry with
  `role: decomposition-origin` and populated `provenance:`,
  pointing at the originating knowledge item or xray
  fingerprint.
- **FR-005** Each emitted draft spec satisfies spec 147's kind
  grammar: a declared `kind:` from the valid enum, an optional
  `shape:`, and an optional `category:`.
- **FR-006** Each emitted draft spec, where it claims code
  paths, satisfies spec 154's logical-unit grammar: paths are
  declared as units (`{ kind: file, path: ... }`,
  `{ kind: directory, path: ... }`, etc.).
- **FR-007** The developer can iterate stage 6 (re-synthesise
  with a different framing prompt) without re-running stages
  1–5, as long as the working-tree hash is unchanged.
- **FR-008** Promotion of a staged spec writes the spec.md
  file into `<project>/specs/NNN-slug/spec.md`, invokes the
  project's spec-compiler, and runs the project's coupling
  gate as a sanity check before the promotion completes.
- **FR-009** A governance certificate is emitted per
  decomposition run, binding stage outputs, synthesiser
  identity, and promoted spec hashes. Per spec 102, the
  certificate is independently verifiable.
- **FR-010** The pipeline degrades gracefully when individual
  substrates are unavailable: missing knowledge bundles → stage
  1 emits an empty `ExtractionOutput`; missing semantic search
  index → stage 3 falls back to xray-only clustering; missing
  git history → stage 5 emits `unknown` lineage. The
  synthesiser is informed of degraded inputs so its draft
  specs can reflect uncertainty (e.g., wider `category:`
  brackets).

## 4. Success Criteria

- **SC-001** Running the pipeline against an imported project
  with no prior spec spine emits ≥ 1 draft spec into the
  staging area within a bounded wall-clock budget (target:
  ≤ 5 minutes for a 50KLOC project).
- **SC-002** Each emitted draft spec passes spec-lint at
  warning severity or better (no spec-lint errors).
- **SC-003** Each emitted draft spec carries a
  `role: decomposition-origin` provenance entry that the
  Requirements view (spec 163) can render as a clickable
  badge.
- **SC-004** Re-running stages 1–5 against an unchanged tree
  is fast (≤ 30s) due to caching.
- **SC-005** A promoted spec set passes the project's own
  coupling gate (per spec 127) when run against the project's
  committed code.
- **SC-006** The governance certificate emitted at promotion
  verifies via `make verify-certificate` against the staged
  artifacts.

## 5. Scope

### In scope

- The six-stage pipeline definition and execution semantics.
- The OPC UI surface (action button, staging area browser,
  promotion flow).
- The governance certificate emission at promotion.
- Integration with spec 095 (checkpoint) for branch-of-thought
  decomposition trials.
- The degraded-input handling.

### Out of scope (deferred)

- **Synthesiser prompt-engineering libraries.** The
  synthesiser uses an open prompt template; the library of
  templates per project shape (web app, CLI, library) is a
  future spec.
- **Cross-project decomposition.** Spec 165 is per-project.
  Aggregating decompositions across a portfolio is owned by
  spec 096 (portfolio-intelligence).
- **Self-improving synthesis.** Feedback loops where developer
  edits to drafts inform future synthesis are out of scope;
  this spec covers a single-shot decomposition with explicit
  human review.
- **Stage 6 model selection UX.** The synthesiser's model
  choice is platform-level configuration; per-developer
  per-project overrides are a future enhancement.

## 6. Compliance

This pipeline is the consumer side of spec 156 (the typed
provenance edge) and the producer side of spec 161 (the
emission contract). Together they close the **ASI06 (Memory &
Context Poisoning)** loop: every spec the pipeline emits carries
a typed pointer back to the evidence it was derived from. If the
evidence is later identified as poisoned, the reverse lookup
("which specs were derived from this knowledge item?") is
deterministic via `git grep` over `specs/`.

Spec 165 does not by itself decontaminate poisoned sources — it
makes contamination *traceable* so that a separate poisoning
response (re-decomposition, supersession, or amendment) has the
data it needs.

## 7. Cross-references

- **INTENT doc** §6 (the full pipeline definition), §6.5
  (born-with vs retrofit).
- **Spec 120** — factory-extraction-stage; stage 1 substrate.
- **Spec 095** — checkpoint-branch-of-thought; pipeline
  execution mode.
- **Spec 154** — logical-unit ownership grammar; emitted-spec
  unit declarations.
- **Spec 156** — provenance grammar; the typed edge.
- **Spec 161** — emission contract; this spec satisfies it.
- **Spec 163** — Requirements view; the rendering consumer
  for promoted drafts.
- **Spec 102** — governed-excellence; the certificate emitted
  at promotion.
- **Spec 147** — kind grammar; emitted-spec `kind:` declarations.
- **`crates/xray`** — stages 2, 4, 5 substrate.
- **`crates/axiomregent`** (search module) — stage 3
  substrate.
