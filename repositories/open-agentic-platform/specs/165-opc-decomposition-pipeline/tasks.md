# 165 — Tasks

## Landing 1 — deterministic backbone (merged, PR #205)

- [x] T-001 — Create branch `165-opc-decomposition-pipeline`.
- [x] T-002 — Author `plan.md` + tasks file.
- [x] T-003 — Scaffold `crates/opc-decomposition-pipeline/`.
- [x] T-004 — Stage 1: extraction via `artifact-extract`.
- [x] T-005 — Stage 2: structural fingerprint via `xray`.
- [x] T-006 — Stage 3: clustering (directory default; embeddings feature).
- [x] T-007 — Stage 4: call graph via `xray`.
- [x] T-008 — Stage 5: temporal lineage via `git log`.
- [x] T-009 — Stage 6: deterministic synthesiser.
- [x] T-010 — Orchestrator + run manifest persistence.
- [x] T-011 — Tauri commands (`decomposition_run` / `_list_runs` / `_get_run`).
- [x] T-012 — Integration tests (SC-001 / SC-002 / SC-003).
- [x] T-013 — Frontmatter `implementation: pending → in-progress` + `establishes:`.
- [x] T-014 — Codebase index regenerated.
- [x] T-015 — PR #205 opened and merged.

## Landing 2 — completion (this PR, branch `165-decomposition-completion`)

- [x] T-016 — **Stage caching (FR-007, SC-004).** Re-run lookup in
  `PipelineRunner`: stages 1-5 emit `StageStatus::Cached` and reuse prior
  output when the recomputed input hash matches the prior run's
  `content_hash`. Stage 6 always re-runs. Test: unchanged-tree second
  run is `Cached` for 1-5 and fast.
- [x] T-017 — **`Synthesiser` trait + deterministic impl.** Extract the
  current `render_spec` baseline behind a `Synthesiser` trait
  (`synthesise`, `identity`, `prompt_template_hash`). Default impl
  `DeterministicSynthesiser`. Wire the orchestrator to it. Mock double
  for tests. All existing synthesis tests stay green.
- [x] T-018 — **`ProviderSynthesiser` (feature `llm-synthesis`).** Behind
  the feature flag, depend on `provider-registry`; build a prompt from
  the evidence bundle; extract `AgentEvent::TextComplete`. Off by
  default; never exercised by CI (no network). Unit test via mock
  adapter only.
- [x] T-019 — **Governance certificate (FR-009, SC-006).** Depend on
  `factory-engine`; emit `governance-certificate.json` per run binding
  stage 1-5 hashes + synthesiser identity + prompt-template hash (§2.3) +
  promoted spec hashes. Test: emitted cert verifies via
  `factory_engine::verify_certificate` against the run dir.
- [x] T-020 — **Promotion flow (FR-008, SC-005).** `promote_spec(...)`
  writes `<project>/specs/NNN-slug/spec.md`, runs `spec-compiler compile
  --repo`, runs coupling gate `--paths-from`. Emits the certificate.
  Test against a fixture project repo.
- [x] T-021 — **`decomposition_promote` Tauri command.** Register in
  `src-tauri/src/lib.rs`; wrap `promote_spec` in `spawn_blocking`.
- [x] T-022 — **Checkpoint branch-of-thought (§2.2).** `CheckpointSink`
  trait in the pipeline crate (`anchor`, `fork`); `NoopCheckpointSink`
  opt-out; `FsCheckpointSink` filesystem DAG-ledger backend (the shipped
  default). Orchestrator anchors the evidence base (keyed by the evidence
  signature, so cache re-runs share an anchor) and forks per synthesis.
- [x] T-023 — **Branch-of-thought wired by default.** `PipelineRunner`
  defaults to `FsCheckpointSink`, so OPC runs (via the Tauri command)
  record the DAG with no extra wiring. **Engineering decision:** the
  spec-095 `CheckpointStore` is async + hiqlite-backed and resident in the
  axiomregent *sidecar process* (not linkable in-process); the filesystem
  ledger delivers the §2.2 branch-of-thought capability without pulling
  hiqlite into the pipeline or building a fragile sidecar-MCP client. An
  axiomregent-`CheckpointStore`-backed sink is a drop-in behind the same
  trait when cross-tool DAG sharing becomes load-bearing (preserves spec
  intent; not a spec edit — mirrors the landing-1 "xray over axiomregent
  for stage 3" decision).
- [x] T-024 — **TS api wrappers.** Add `decompositionRun` /
  `decompositionListRuns` / `decompositionGetRun` /
  `decompositionPromote` to `api.ts` + `apiAdapter.ts`.
- [x] T-025 — **React panel (FR-001).**
  `features/decomposition/DecompositionSurface.tsx` +
  `components/DecompositionPanel.tsx` + `decomposition` tab type +
  `TabContent` wiring. Action → staging browser → promote.
- [x] T-026 — **Panel vitest.** Cover load/error/empty/promote paths
  mocking `@/lib/apiAdapter`.
- [x] T-027 — **Spec 192 (persistent embedding cache).** Author
  `specs/192-decomposition-embedding-cache/spec.md` (spec-first).
- [x] T-028 — **Implement the embedding cache.** Content-addressed on-disk
  cache under `<output_root>/.embedding-cache/`; the `embeddings`-feature
  clustering path reads/writes it. Test cache hit on re-run.
- [x] T-029 — **Closure.** Flip spec 165 `implementation: complete`;
  regenerate codebase index + featuregraph golden (`UPDATE_GOLDEN=1`);
  `cargo clippy --workspace -- -D warnings`; `cargo test`; spec-lint;
  coupling gate. Add Spec-Drift-Waiver to PR body if golden/index churn
  requires it.
- [x] T-030 — **PR + CI watch.** Open PR, monitor checks, fix red.

## Deferred to future specs (unchanged from landing 1)

- F-001b — Synthesiser prompt-engineering *library* per project shape
  (spec 165 §5; the trait + a single provider impl land here, the
  template library does not).
- F-004b — Stage-6 model-selection *UX* / per-developer per-project
  overrides (spec 165 §5).
- Cross-project decomposition (spec 096 portfolio-intelligence).
- Self-improving synthesis from developer edits (spec 165 §5).
