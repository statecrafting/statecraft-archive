# 165 — Implementation plan

> Status: completion landing (full feature).
> Owner: bart
> Branches: `165-opc-decomposition-pipeline` (backbone, merged PR #205),
> `165-decomposition-completion` (this landing).

## Landing history

### Landing 1 — deterministic backbone (merged, PR #205)

Delivered the deterministic backbone of the pipeline:

- Stages 1-5 wired to existing substrates (`artifact-extract`, `xray`).
- Stage 6 as a **deterministic baseline synthesiser** emitting a draft
  `spec.md` satisfying the spec 161 emission contract, spec 147 kind
  grammar, and spec 154 logical-unit grammar.
- Run persistence under `<project>/.opc/decomposition/<run-id>/`.
- Tauri command surface (`decomposition_run` / `decomposition_list_runs`
  / `decomposition_get_run`) in `product/apps/opc/src-tauri`.
- Fixture-based integration tests proving SC-001 / SC-002 / SC-003.

### Landing 2 — completion (this PR)

Completes spec 165 to **all ten FRs and all six SCs**, taking
`implementation:` from `in-progress` to `complete`. Every item below was
already part of spec 165's *contract* (its FRs / §5 in-scope list); the
backbone PR deferred them to a follow-up PR for size reasons. This is
that follow-up.

The scope decision to land the full feature in one PR is the owner's
(2026-05-31). It does not contradict the spec: FR-007/008/009 and the
§2.2 checkpoint mode and FR-001 UI are all already contracted. The only
genuinely *new* contract — a persistent embedding cache — is split into
its own spec (see "New spec" below), authored before its implementation
per spec-first discipline.

## Completion phases (each phase = TDD red→green + one commit)

1. **Stage caching (FR-007, SC-004).** `PipelineRunner` gains a re-run
   path: before executing stages 1-5, look up the most recent prior run
   for the same `project_root`; if a stage's recomputed input hash
   matches the prior `StageRecord.content_hash`, copy the cached output
   and mark `StageStatus::Cached` instead of re-running. Stage 6 always
   re-runs (it is the synthesis trajectory). Test: second run over an
   unchanged tree emits `Cached` for stages 1-5 and completes fast.

2. **LLM-backed synthesiser (§2.1 stage 6).** Introduce a `Synthesiser`
   trait (`synthesise(&SynthesisInput) -> SynthesisOutcome`, plus
   `identity()` and `prompt_template_hash()`). Two impls:
   - `DeterministicSynthesiser` — the current `render_spec`; default,
     CI-safe, no network.
   - `ProviderSynthesiser` — feature-gated (`llm-synthesis`), holds a
     `provider-registry` adapter, builds a prompt from the evidence
     bundle, extracts `AgentEvent::TextComplete`. Off by default so CI
     never hits the network. Tested via a `MockSynthesiser` trait double.
   Deferred to future specs (spec 165 §5, unchanged): the prompt-template
   *library* per project shape, and the model-selection *UX*.

3. **Governance certificate (FR-009, SC-006).** Depend on
   `factory-engine` and use its `CertificateBuilder` /
   `generate_certificate_with_stage_ids` / `persist_certificate`. Emit
   `governance-certificate.json` into the run dir binding: stage 1-5
   output hashes, the synthesiser identity + prompt-template hash
   (§2.3), and promoted spec file hashes. Verifiable via the existing
   `make verify-certificate FILE=… ARTIFACT_DIR=…` (binary-agnostic; no
   Makefile change). Ed25519 signing resolves from `OAP_SIGNING_KEY` /
   `OAP_SIGNING_KEY_PATH`, else ephemeral.

4. **Promotion flow (FR-008, SC-005).** `promote_spec(run, slug, dest)`
   writes the staged `spec.md` into `<project>/specs/NNN-slug/spec.md`,
   shells out to the project's `spec-compiler compile --repo <project>`,
   then runs the coupling gate (`--paths-from` the new spec path) as a
   sanity check. Emits the certificate (phase 3) at promotion. A new
   `decomposition_promote` Tauri command exposes it.

5. **Checkpoint branch-of-thought (§2.2).** Define a light
   `CheckpointSink` trait in the pipeline crate (`anchor(run)` after
   stages 1-5; `fork(anchor, label)` per stage-6 re-synthesis trial) so
   the core crate keeps its light dependency set. The Tauri layer
   provides an axiomregent-`CheckpointStore`-backed impl; tests use a
   recording mock. A no-op default sink keeps non-OPC callers working.

6. **React panel (FR-001).** `features/decomposition/DecompositionSurface.tsx`
   + `components/DecompositionPanel.tsx` shim, a `decomposition` tab
   type, TS api wrappers (`decompositionRun` / `…ListRuns` / `…GetRun` /
   `…Promote`) in `api.ts` + `apiAdapter.ts`, vitest coverage mocking
   `@/lib/apiAdapter`. Action button → staging browser → promote.

7. **Persistent embedding cache (new spec 192).** Author
   `specs/192-decomposition-embedding-cache/spec.md` first (spec-first),
   then implement a content-addressed on-disk embedding cache under
   `<output_root>/.embedding-cache/` keyed by file content hash, so the
   `embeddings`-feature clustering path reuses vectors across runs.
   Closes plan-§"Substrate decisions" follow-up F-006 without pulling
   hiqlite into the pipeline crate.

8. **Closure.** Flip spec 165 `implementation: complete`; update this
   plan + tasks; regenerate `.derived/codebase-index/` and the
   featuregraph golden; run `cargo clippy --workspace -D warnings`,
   `cargo test`, spec-lint, coupling gate. Commit.

9. **PR + CI watch.** Open the PR; iterate until all checks are green.

## Substrate decisions (carried from landing 1, still in force)

### Stage 3 substrate: xray, not axiomregent (default path)

The default build uses `xray/analysis-embeddings`-free directory
clustering (FR-010 degraded path is the default). The `embeddings`
feature adds fastembed vector clustering. Phase 7's cache accelerates the
`embeddings` path; it does not change the default. axiomregent-backed
persistent indexing remains a further future option, noted in spec 192.

### Stage 6 synthesiser: trait with deterministic default

Landing 2 generalises the baseline into the `Synthesiser` trait. The
deterministic impl stays the default and the sole CI-exercised path; the
provider-backed impl is feature-gated. The trait is the seam spec 165 §5
anticipated ("a future PR swaps the `Synthesiser` trait impl").

## Risks

- **factory-engine dep weight.** Adds the certificate stack to the
  pipeline crate's build. Acceptable: it is a workspace path dep already
  compiled by CI. The `verify-certificate` binary is reused, not rebuilt
  here.
- **axiomregent in the core crate.** Avoided by the `CheckpointSink`
  trait seam (phase 5); the heavy dep stays in the Tauri layer that
  already boots axiomregent.
- **LLM non-determinism in CI.** Avoided by feature-gating the
  provider impl and exercising only the deterministic / mock path in
  tests. No API key is ever required by CI.
- **CONST-005.** No spec is edited to justify an action. FR-007/008/009,
  §2.2, FR-001 are already contracted; plan/tasks scoping is updated to
  match the owner's land-it-all decision. The one new contract
  (embedding cache) is authored as spec 192 before its code.
- **Diff size (CONST-004 warn).** The PR is large by design (full
  feature). Mitigated by per-phase commits for bisect-safe history.
