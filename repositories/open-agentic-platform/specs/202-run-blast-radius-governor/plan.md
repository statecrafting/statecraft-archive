# Implementation Plan: spec 202 (Run Blast-Radius Governor)

**Spec**: `specs/202-run-blast-radius-governor/spec.md`
**Gate cleared**: spec 198 `implementation: complete` (confirmed in task prompt)
**Plan date**: 2026-06-24

---

## Surface-drift findings (2026-06-24 survey vs 2026-06-12 spec refinement)

| Finding | Impact |
|---------|--------|
| `CERTIFICATE_VERSION` is already `"1.6.0"` (spec 218 FR-001 landed it). The spec text says `1.5.0 -> 1.6.0`; this is stale. The correct bump for spec 202 is `1.6.0 -> 1.7.0`. | **AC-4/FR-005 lockstep bump must be corrected in the PR.** The `CERTIFICATE_VERSION` const, the version check in `verify_certificate`, all test fixtures that assert the version string, and the doc comment on the const all need updating to `"1.7.0"`. |
| `FactoryPipelineState.total_tokens` accumulates tokens via `add_tokens()` in `pipeline_state.rs`. `FactoryEngineConfig.max_total_tokens` is declared and defaulted `None` in `engine.rs`, read nowhere, not enforced. Both confirmed present. | AC-6 pt1: remove `max_total_tokens` or enforce it via the meter (the meter is simpler; retire the stub and wire the meter), landed in PR1. The pt2 "subsume `total_tokens`" plan was later withdrawn on investigation: `total_tokens` is the persisted UI total, not redundant with the in-memory per-spawn meter (see §Summary). |
| `GovernanceEnvelope` (and the schema file) are at `schema_version: "1.0.0"`. The Rust twin const is `GOVERNANCE_ENVELOPE_SCHEMA_VERSION = "1.0.0"`. The 1.1.0 bump is clean. | No drift; plan proceeds as written. |
| `crates/orchestrator/src/circuit_breaker.rs` is a complete, tested library. It is not imported anywhere in the orchestrator dispatch loops (confirmed by reading `lib.rs`: no `circuit_breaker` import in the dispatch path). | FR-003(b) wires this library. The precedent was correctly described in the spec. |
| `IntentCapsule.derive_goal_id()` uses `"goal-" + first 16 hex chars of SHA-256(goal_text)`. FR-003(a) says the step signature hashes `goal_id + normalized instruction text` with step id excluded. The normalization rule ("fixed at implementation") is intentionally left to the implementer. | No drift; the hash construction is derivable from the existing `derive_goal_id` pattern. |
| `GrantRenewalGate` in `run_governance.rs` is the sole wired `PreStepGate` today. The dispatch loop checks `options.pre_step` as a single `Option<Arc<dyn PreStepGate>>`. To compose the budget gate with `GrantRenewalGate` a chain wrapper is needed, or `DispatchOptions.pre_step` must become a `Vec`. | See Slice B design note. |
| `runs.ts::reserveRunCore` performs the admission check and writes the row. There is no existing runs-in-flight count at this call site. FR-003(c) adds one. `runsScheduler.ts` is confirmed unchanged (sweeper only). | Platform-side gate is additive to `reserveRunCore`. |
| Spec 202 `extends` frontmatter declares two edges. The `refines` edge points at `crates/orchestrator/src/lib.rs`. `references` edges point at the cert file, circuit-breaker, run_governance, and runsScheduler. The coupling gate enforces `refines` and `establishes` (non-`references`) edge paths exist and are owned by this spec. Any file edited in implementation that is NOT covered by the frontmatter graph will trip the coupling gate. | The `extends` edges cover the envelope schema and featuregraph golden. The `refines` edge covers `lib.rs`. But edits in Slice A (`factory-contracts/src/budget.rs`, `factory-contracts/src/governance_envelope.rs`) and Slice C (`factory-engine/src/governance_certificate.rs`) are not covered. The frontmatter must gain `establishes:` entries for those files before or in the same PR as each slice. See coupling note in each slice. |

---

## Coupling-graph gap: required frontmatter additions

The spec's current frontmatter has no `establishes:` entries. The coupling gate requires that every file edited or created by this spec either (a) sits under a path covered by an `establishes:` edge, or (b) is declared as a `refines:` unit. The files below need coverage:

| File to be edited | Required frontmatter edge |
|---|---|
| `crates/factory-contracts/src/governance_envelope.rs` | `establishes:` unit (kind: file) |
| `standards/schemas/factory/governance-envelope.schema.yaml` | already covered by `extends: 198` unit (the `extends` edge owns the path) |
| `crates/factory-contracts/src/lib.rs` (re-exports) | `establishes:` unit (kind: crate, id: factory-contracts) OR a file-level entry |
| `crates/factory-contracts/src/run_budget.rs` (new file) | `establishes:` unit (kind: file) |
| `crates/orchestrator/src/budget_gate.rs` (new file) | `establishes:` unit (kind: file) |
| `crates/orchestrator/src/lib.rs` | covered by `refines:` already |
| `crates/factory-engine/src/governance_certificate.rs` | `establishes:` unit (kind: file); currently only a `references:` role |
| `crates/factory-engine/src/lib.rs` (re-exports) | `establishes:` unit (kind: crate, id: factory-engine) OR file-level |
| `platform/services/statecraft/api/factory/runs.ts` | currently a `references: context` unit; needs promotion to `establishes:` or `refines:` |
| `crates/featuregraph/tests/golden/features_graph.json` | covered by `extends: 034` unit |

**Rule of thumb for each PR**: update `specs/202-run-blast-radius-governor/spec.md` frontmatter in the same commit as the implementation files, or the coupling gate will fail. Do not add edges speculatively; add them in the PR whose diff touches that file.

---

## Slice decomposition

### Slice A: FR-001 Budget types + envelope schema 1.0.0 -> 1.1.0 (AC-3, AC-7)

**Land this first.** It is the dependency root: FR-002 (meter + gate), FR-003(b/c) thresholds, and FR-005 (certificate binding) all depend on the `RunBudget*` type shape being stable in `factory-contracts`.

**FR/AC coverage**: FR-001 fully, AC-3 (platform defaults visible at admission), AC-7 (schema-parity and lockstep in same PR).

**Files created/edited**:

- `crates/factory-contracts/src/run_budget.rs` (new)
  - `RunBudgetAxis` enum: `ToolInvocations`, `FileMutations`, `SpawnedAgents`, `WallClockSecs`, `Tokens`, `CostUsd`
  - `RunBudgetCeiling` struct: `{ axis: RunBudgetAxis, per_run: Option<BudgetValue>, per_stage: Option<BudgetValue> }` where `BudgetValue` is an enum over integer and float to handle token counts vs dollar amounts
  - `BudgetSource` enum: `Declared`, `PlatformDefault`
  - `AdmittedBudget` struct: `{ axis: RunBudgetAxis, ceiling_per_run: BudgetValue, ceiling_per_stage: Option<BudgetValue>, source: BudgetSource }`, one entry per axis (populated with defaults when absent from the envelope)
  - `PLATFORM_DEFAULT_BUDGETS: &[AdmittedBudget]` compile-time platform defaults (values are policy, picked at implementation; must be non-zero and conservative)
  - `fn apply_defaults(declared: &[RunBudgetCeiling]) -> Vec<AdmittedBudget>` merges declared ceilings with defaults; any declared value tightens but cannot exceed the platform default (the spec 047 five-tier direction: policy tightens, never loosens)

- `crates/factory-contracts/src/governance_envelope.rs`
  - Add `budgets: Vec<RunBudgetCeiling>` field to `GovernanceEnvelope` (optional/default empty, so existing instances deserialize cleanly)
  - Bump `GOVERNANCE_ENVELOPE_SCHEMA_VERSION` from `"1.0.0"` to `"1.1.0"`
  - Update `version_const_anchor` test

- `crates/factory-contracts/src/lib.rs`
  - `pub mod run_budget;` and re-exports

- `standards/schemas/factory/governance-envelope.schema.yaml`
  - Bump header comment version from `1.0.0` to `1.1.0`
  - Add `budgets:` section after `overrides:`:

```yaml
# BUDGETS -- run blast-radius ceilings  [ASI08 m6/m7; spec 202 FR-001]
#
# Optional. When absent, platform defaults apply fail-closed. Per-axis
# ceilings at two scopes only (predicate-shaped, never topology-shaped, P-2):
#   per_run:   ceiling on the whole run
#   per_stage: uniform ceiling no single stage may exceed
# Absent budget does NOT mean unlimited (AC-3).
budgets:
  - axis: string            # "tool_invocations" | "file_mutations" |
                            # "spawned_agents" | "wall_clock_secs" |
                            # "tokens" | "cost_usd"                 [ASI08 m6]
    per_run: number         # Optional ceiling for the whole run
    per_stage: number       # Optional uniform per-stage ceiling
```

**Hook-in**: The `apply_defaults` function is called by the platform admission path (in `factory-contracts`); the admitted budget list is what the engine receives alongside the envelope.

**Frontmatter additions to `spec.md`** (same PR):
- Add `establishes:` entry for `crates/factory-contracts/src/run_budget.rs` (kind: file)
- Add `establishes:` entry for `crates/factory-contracts/src/governance_envelope.rs` (kind: file)
- The `extends: 198` edge already covers `standards/schemas/factory/governance-envelope.schema.yaml`

**Tests**:
- `run_budget.rs` unit tests: `apply_defaults` with no declared budgets produces all six axes with `source: PlatformDefault`; a declared `tokens` ceiling tighter than the default passes; a declared ceiling looser than the platform default is clamped (AC-3)
- `governance_envelope.rs` tests: `version_const_anchor` updated to `"1.1.0"`; round-trip YAML with `budgets:` section; `budgets: []` (absent) round-trips cleanly
- Existing `envelope_yaml_round_trips` must still pass

**Lockstep verification**:
- `make ci-schema-parity` must pass (schema-parity checker walks the YAML schema and the Rust twin)
- `make factory-schema-lockstep` must pass or gracefully skip if no factory checkout is present (Tier B: OAP-unilateral addition)

**Schema-parity constraint (AC-7)**: The `GOVERNANCE_ENVELOPE_SCHEMA_VERSION` const and the YAML schema version header must change atomically in the same commit. The schema-parity checker (spec 125/191) will fail if they diverge. Both files are in this slice.

---

### Slice B: FR-002 Run-level meter + budget PreStepGate + AC-6 dead-stub discharge (AC-1, AC-5, AC-6)

> **AC-6 status (read this before the AC-6 bullets below).** Slice B / PR1 #469
> landed AC-6 pt1 only (retire the `max_total_tokens` engine-config stub). AC-6
> pt2 (remove `FactoryPipelineState.total_tokens` / `add_tokens()` so no two
> token accumulators coexist) was split to a follow-up, PR1b, and then
> **withdrawn on investigation (2026-07-02, user-ratified)**: the two counters
> are not redundant. `total_tokens` is the persisted, poll-surfaced UI total
> (`build_status_response` -> `PipelineStatusResponse`, serialized to
> `.factory/pipeline-state.json`); the `RunBudgetMeter` is an in-memory,
> per-spawn accumulator feeding only the budget gate + cert snapshot and is out
> of scope at the status-poll command. The "remove `total_tokens`" bullets in
> this section are therefore **moot** (they describe PR1b's original intended
> work, which is not being done). See the plan Summary and spec.md
> "Implementation status (AC-6 residual)" for the authoritative disclosure.

**Depends on**: Slice A (needs `AdmittedBudget`, `RunBudgetAxis`).

**FR/AC coverage**: FR-002 fully, AC-1 (budget-exceed pauses the run), AC-5 (no silent resume), AC-6 (dead stubs retired).

**Files created/edited**:

- `crates/orchestrator/src/budget_gate.rs` (new)

  `RunBudgetMeter`:
  - `struct RunBudgetMeter { ceilings: Vec<AdmittedBudget>, axes: HashMap<RunBudgetAxis, f64>, run_start: Instant }`
  - `fn record_step(&mut self, step: &StepSummaryEntry)` adds `tokens_used`, `cost_usd`, `duration_ms` (converted to secs), `retry_count` (tool invocations proxy for now; `file_mutations` recorded as 0 until executor surfaces them; `spawned_agents` is +1 per dispatched step)
  - `fn check(&self) -> Option<BudgetBreach>` returns `Some(BudgetBreach { axis, ceiling, actual })` for the first exceeded ceiling; `None` if all clear

  `BudgetGate` implementing `PreStepGate`:
  - `struct BudgetGate { meter: Arc<Mutex<RunBudgetMeter>> }`
  - `async fn before_step(&self, step_id: &str) -> Result<(), String>` locks meter, calls `check()`, formats the attributable error message (`"budget ceiling exceeded: axis={axis} ceiling={ceiling} actual={actual} step={step_id}"`) and returns `Err` if breached
  - AC-1: the `Err` propagates to `dispatch_manifest`'s `pre_step` branch, which already fails the step closed, cascades `Skipped` to dependents, and persists the run summary; no new dispatch-loop changes needed
  - AC-5: the meter has no `raise_ceiling` method; raising requires a new `AdmittedBudget` slice (a new envelope or an audited override); the gate is structurally incapable of self-raising

  Gate composition with `GrantRenewalGate`:
  - Add `struct ChainedPreStepGate { gates: Vec<Arc<dyn PreStepGate>> }` implementing `PreStepGate` where `before_step` calls each gate in order and short-circuits on the first `Err`
  - Callers construct `ChainedPreStepGate { gates: vec![grant_renewal_gate, budget_gate] }`; `DispatchOptions.pre_step` stays `Option<Arc<dyn PreStepGate>>` (no breaking change to the dispatch API)

- `crates/orchestrator/src/lib.rs`
  - Add `pub mod budget_gate;`
  - Re-export `BudgetGate`, `RunBudgetMeter`, `ChainedPreStepGate`, `BudgetBreach`
  - After step completion in `dispatch_manifest`, call `meter.lock().unwrap().record_step(&step_summary_entry)` (the meter is shared via `Arc<Mutex<RunBudgetMeter>>` threaded through `DispatchOptions`)

  `DispatchOptions` addition:
  - `pub budget_meter: Option<Arc<Mutex<RunBudgetMeter>>>`: when `Some`, the dispatcher records the completed step into the meter after each successful dispatch (the gate fires at step entry before the next step; the first-step check against pre-run defaults fires on step-0 entry)

- `crates/factory-engine/src/engine.rs` and `crates/factory-engine/src/bin/factory_run.rs`
  - Remove `max_total_tokens: Option<u64>` from `FactoryEngineConfig` (AC-6: retire the dead stub). Update the six call sites that set `max_total_tokens: None` to not pass the field.
  - The engine wires `AdmittedBudget` from the admitted envelope into a `RunBudgetMeter` and sets it into `DispatchOptions.budget_meter`

- `crates/factory-contracts/src/pipeline_state.rs`
  - Remove `total_tokens: u64` and `add_tokens()` from `FactoryPipelineState` (AC-6: no two independent token accumulators). Update callers that call `add_tokens()` to use the meter's `tokens` axis instead. Update `total_tokens: 0` field in `new()` and all test fixtures.

**Frontmatter additions to `spec.md`** (same PR):
- Add `establishes:` entry for `crates/orchestrator/src/budget_gate.rs` (kind: file)
- Existing `refines:` entry for `crates/orchestrator/src/lib.rs` covers that file

**Tests** (in `crates/orchestrator/tests/` or inline):
- AC-1: construct a `RunBudgetMeter` with a `tokens` ceiling of 100; call `record_step` with a step showing `tokens_used: 101`; assert `check()` returns `Some(BudgetBreach { axis: Tokens, .. })`; wire into a `BudgetGate` and confirm `before_step` returns `Err` with axis/ceiling/actual in the message
- AC-5: confirm `RunBudgetMeter` has no public method that raises a ceiling; `check()` uses the immutable ceiling from construction
- AC-6: confirm `FactoryEngineConfig` no longer has `max_total_tokens`; confirm `FactoryPipelineState` no longer has `total_tokens`
- `ChainedPreStepGate`: first gate `Err` short-circuits; second gate not called; both clear returns `Ok`

---

### Slice C: FR-005 Certificate binding of consumption actuals (AC-4)

**Depends on**: Slice A (needs `AdmittedBudget`), Slice B (needs the meter's output shape for the `budget_consumption` record).

**FR/AC coverage**: FR-005 fully, AC-4 (certificate carries actuals; tampering fails verify).

**Files edited**:

- `crates/factory-engine/src/governance_certificate.rs`
  - Bump `CERTIFICATE_VERSION` from `"1.6.0"` to `"1.7.0"` (see drift finding above)
  - Add `BudgetAxisRecord` struct: `{ axis: String, ceiling: f64, actual: f64, source: String, breached: bool }` (using `String` for axis and source to keep the JSON schema human-readable and version-independent)
  - Add `pub budget_consumption: Option<Vec<BudgetAxisRecord>>` to `GovernanceCertificate` with `#[serde(default, skip_serializing_if = "Option::is_none")]` so pre-1.7.0 fixtures stay byte-identical
  - Add `CertificateBuilder::budget_consumption(mut self, record: Vec<BudgetAxisRecord>) -> Self` builder method
  - Update `verify_certificate`:
    - New check: if `budget_consumption` is `Some`, verify that every admitted axis is present in the record (axis completeness); if any axis is missing, push an error naming the axis
    - New check: for each `BudgetAxisRecord`, verify `actual >= 0.0` and `ceiling > 0.0` (internal consistency); verify `breached == (actual > ceiling)` (consistency between the flag and the numbers); tampering with `actual` to hide a breach will either flip the `breached` flag (caught by the consistency check) or leave it `true` (the certificate accurately records the breach, which is acceptable)
    - Both checks add axis-specific diagnostics (e.g. `"budget_consumption: axis 'tokens' actual -1 is not valid"`)
    - Existing signature check catches any other tampering

  Update `CERTIFICATE_VERSION` docstring:
  - Add `/// 1.7.0 (spec 202 FR-005) added the optional 'budgetConsumption' record inside the signed payload.`

**Frontmatter additions to `spec.md`** (same PR):
- Add `establishes:` entry for `crates/factory-engine/src/governance_certificate.rs` (kind: file); currently only a `references:` role

**Tests**:
- AC-4 happy path: build a cert with `budget_consumption` record; verify round-trip JSON; call `verify_certificate` and confirm `valid: true`
- AC-4 tamper: build a cert; tamper with `actual` on one axis (increase it above `ceiling` while setting `breached: false`); call `verify_certificate`; confirm the `breached` consistency check fires with an axis-specific diagnostic
- AC-4 tamper via signature: tamper with `actual` directly in the JSON bytes; the Ed25519 signature check (which runs first) catches it before the budget checks are reached; the existing signature test pattern applies
- Pre-1.7.0 fixture: a cert with no `budget_consumption` must still verify cleanly (`absent = None`; the axis-presence check is skipped when the field is absent)
- `version_const_anchor` test updated to `"1.7.0"`

**Second lockstep constraint**: `CERTIFICATE_VERSION` is in `factory-engine` (not `factory-contracts`). The spec 212 factory-schema-lockstep checks `standards/schemas/factory/` against the factory source repo's `contract/schemas/`. The certificate schema is not currently a checked schema in that lane (the governance-certificate is an OAP-internal artifact, not a factory-filed contract). Confirm with `make factory-schema-lockstep`; if the cert schema is absent from the factory's `contract/schemas/`, no lockstep action is required for Slice C.

---

### Slice D: FR-003(b) Oscillation detector (AC-2)

**Depends on**: PR1 (the governor is wired into dispatch via `options.pre_step` as a `ChainedPreStepGate`; the oscillation gate composes into the same chain and pauses through the same channel). Note: the axis meter is threaded via `options.pre_step`, not a `DispatchOptions.budget_meter` field (that field was never added).

**FR/AC coverage**: FR-003(b) fully, AC-2 (as amended: successive retry-heavy steps trip the detector before wall-clock exhaustion).

**Design note (as-built, supersedes the earlier axis proposal)**: the trip threshold is a **peer top-level `oscillation:` envelope field** (`OscillationThreshold { consecutive_failures, window_secs }`), NOT a 7th `RunBudgetAxis`/`budgets.axis`. The axis approach was evaluated and rejected: because Slice C's certificate completeness derives `admitted_axis_names()` from `RunBudgetAxis::ALL`, a 7th axis would force the oscillation signal into every certificate's `budget_consumption`, require a `CERTIFICATE_VERSION` bump, and collide with verify's strict `breached == (actual > ceiling)` invariant since `circuit_breaker` trips on `>=` within a sliding window. A consecutive-failure streak also resets on success and has no uniform `per_stage` scope, so it is categorically not a monotonic budget axis. The peer approach was user-ratified; it touches no certificate and needs zero new frontmatter edges.

**Detector-input reframing (as-built, user-ratified)**: `dispatch_manifest` returns `Err` and aborts on the first hard step failure (spec 075 halt-on-failure, orchestrator rule 4), so a literal inter-stage failure loop cannot arise in a live run. The realizable cross-step signal is consecutive retry-heavy steps: a step "wobbles" when `!success || retry_count > 0`. AC-2's fixture is therefore successive retry-heavy steps, not "two consecutive step failures".

**Files created/edited**:

- `crates/factory-contracts/src/run_budget.rs`: `OscillationThreshold` type, `PLATFORM_DEFAULT_OSCILLATION_THRESHOLD` (5 / 300s, mirroring `CircuitBreakerConfig::default()`), `apply_oscillation_default()` (tighten-only on `consecutive_failures`; `window_secs` platform-fixed this slice). Re-export from `lib.rs`.
- `crates/factory-contracts/src/governance_envelope.rs`: `oscillation: Option<OscillationThreshold>` field; `GOVERNANCE_ENVELOPE_SCHEMA_VERSION` 1.1.0 -> 1.2.0 (twin of the schema YAML bump). `standards/schemas/factory/governance-envelope.schema.yaml` gains the peer `oscillation:` section (covered by the existing `extends: 198` edge).
- `crates/orchestrator/src/budget_gate.rs`: `OscillationGate` (a `PreStepGate`) wrapping `circuit_breaker::CircuitBreakerState` **unmodified**, shared via `Arc<Mutex<..>>`. `before_step` fails closed when `is_tripped()`; `after_step` records failure on a wobble, success otherwise.
- `crates/orchestrator/src/lib.rs`: `StepActuals.retry_count: u32`, threaded at both Ok-branch `after_step` sites; the `Err`-branch `after_step` is closed for contract consistency (inert under halt-on-failure).
- Wiring at the 4 dispatch sites (`bin/factory_run.rs` both phases share one breaker; OPC `factory.rs` start + resume, governed and ungoverned arms), each composing `oscillation_gate` into the `ChainedPreStepGate` after the budget gate.

**Threshold source**: parity with the six budget axes: the schema/twin field is declarable, but no call site threads a declared value yet (every site calls `apply_oscillation_default(None)`, exactly as the budget gate calls `apply_defaults(&[])`); admission threading of declared values into the OPC is the same pre-existing deferral PR1 documented for all axes.

**Tests** (AC-2): unit (`OscillationGate` trips after `threshold` wobbles and resets on a clean step), composition (a `ChainedPreStepGate[budget, oscillation]` fires the oscillation breach with the wall-clock actual far below its 3600s ceiling), and integration (a pre-tripped breaker through `dispatch_manifest` returns `StepFailed` naming the oscillation breach).

---

### Slice E: FR-003(a) Intent-hash deduplication detector (independent) -- LANDED

**Depends on**: Slice A (needs the threshold-declaration pattern). Does NOT depend on Slice B or C.

**FR/AC coverage**: FR-003(a).

**Design note (as-built, supersedes the earlier `StepSignatureCache` proposal)**: mirroring Slice D's precedent, the trip threshold is a **peer top-level `intent_dedup:` envelope field** (`IntentDedupThreshold { max_repeats, window_secs }`), NOT a `budgets.axis` count. The earlier `StepSignatureCache`/`IntentRepeatBreach` sketch (below, superseded) never named where the threshold itself lived; once FR-003 was read against the oscillation precedent it was clear a per-signature repeat count has the same shape problem as a consecutive-failure streak: it is not a monotonic run-total accumulator, so it does not belong on `RunBudgetAxis`/`budgets:`. It is declared, gated, and defaulted exactly like `OscillationThreshold`.

**Files created/edited**:

- `crates/factory-contracts/src/run_budget.rs`: `IntentDedupThreshold` type, `PLATFORM_DEFAULT_INTENT_DEDUP` (`max_repeats: 3, window_secs: Some(300)`; tighter than oscillation's 5 because a literal repeat has no "still making progress" reading), `apply_intent_dedup_default()` (tighten-only on `max_repeats`; `window_secs` platform-fixed this slice). Re-exported from `lib.rs`.
- `crates/factory-contracts/src/governance_envelope.rs`: `intent_dedup: Option<IntentDedupThreshold>` field; `GOVERNANCE_ENVELOPE_SCHEMA_VERSION` 1.2.0 -> 1.3.0 (twin of the schema YAML bump). `standards/schemas/factory/governance-envelope.schema.yaml` gains the peer `intent_dedup:` section (covered by the existing `extends: 198` edge). `crates/factory-contracts/src/build_spec.rs`'s `sibling_contract_schema_versions_are_pinned` test updated to `"1.3.0"`.
- `crates/orchestrator/src/budget_gate.rs`: `IntentDedupGate` (a `PreStepGate`) with `normalize_instruction` (trim, collapse internal whitespace to one space, lowercase; documented as contract) and `intent_signature` (`SHA-256_hex(goal_id + "\n" + normalize(instruction))`, step id excluded). `before_step` fails closed when any signature's whole-run count exceeds `max_repeats`; `after_step` increments the count keyed by signature, a no-op when `actuals.instruction` is `None`.
- `crates/orchestrator/src/lib.rs`: `StepActuals.instruction: Option<String>`, threaded at the two Ok-branch `after_step` sites (`Some(step.instruction.clone())`); the two `Err`-branch sites pass `None` (inert under halt-on-failure, same posture as retry_count's FR-003b precedent).
- Wiring at the same 4 dispatch sites Slice D touched (`bin/factory_run.rs` both phases share one gate instance via an `Arc<dyn PreStepGate>` clone so the repeat count is run-level; OPC `factory.rs` start + resume, governed and ungoverned arms), each composing `intent_dedup_gate` into the `ChainedPreStepGate` after the oscillation gate. The governed arm scopes the signature to the filed intent capsule's `goal_id`; the ungoverned arm (no capsule) falls back to a run-id-derived goal id (no cross-run correlation needed there).

**Response ordering (FR-003 "throttle first, break second")**: for the orchestrator's sequential dispatch there is no concurrency between steps to rate-limit, so "throttle" is degenerate, the same finding Slice D's `OscillationGate` already established. This slice implements the break only; the spec's FR-003 "Response order" paragraph now carries an implementation note recording this rather than silently dropping the throttle tier.

**Tests** (`crates/orchestrator/src/budget_gate.rs`): gate trips after `max_repeats` identical instructions; distinct instructions never trip; step id is excluded from the signature (different ids, identical normalized instruction, collide); a `None` instruction is a no-op; a `ChainedPreStepGate[budget, oscillation, intent_dedup]` fires the intent breach, not budget/oscillation, on repeated identical intents. `crates/factory-contracts/src/run_budget.rs`: tighten-only merge test + JSON round-trip test mirroring the oscillation pair. `crates/factory-contracts/src/governance_envelope.rs`: round-trip with/without `intent_dedup:` mirroring the oscillation pair; `version_const_anchor` updated to `"1.3.0"`.

<details>
<summary>Superseded pre-implementation sketch (StepSignatureCache design, not built)</summary>

- `crates/orchestrator/src/budget_gate.rs` (extend)
  - `StepSignatureCache`:
    - `fn step_signature(goal_id: &str, instruction: &str) -> String`: SHA-256 of `goal_id + normalize(instruction)` where `normalize` collapses runs of whitespace and lowercases (the normalization rule fixed at implementation per spec)
    - `struct StepSignatureCache { seen: HashMap<String, u32>, threshold: u32 }`
    - `fn record(&mut self, goal_id: &str, instruction: &str) -> Option<IntentRepeatBreach>`: inserts/increments count; returns `Some(IntentRepeatBreach)` when count exceeds threshold
  - `IntentRepeatBreach` struct: `{ signature: String, count: u32, threshold: u32 }`
  - Wire into `BudgetGate.before_step` or into the step-dispatch path via `RunBudgetMeter`

- `crates/orchestrator/src/lib.rs`
  - Before dispatching a step, record the step's instruction in the cache

**Tests**:
- Two steps with identical instructions and the same `goal_id`: `record` on step 2 returns `Some` when threshold is 1.
- Step id excluded: two steps with identical instructions but different step ids collide (step id is excluded from the hash per spec).
- Normalization: `"  foo  bar  "` and `"foo bar"` produce the same signature.

</details>

---

### Slice F: FR-003(c) Platform queue-storm gate (independent) -- LANDED

**Depends on**: Slice A is helpful for the ceiling type pattern, but this slice can land before Slice A; it reads a `STATECRAFT_FACTORY_MAX_RUNS_IN_FLIGHT` env var or a platform config value until the envelope carries the threshold.

**FR/AC coverage**: FR-003(c).

**Design note (as-built, supersedes the earlier enforce sketch below)**: the
user locked a detection-only decision for this landing: the gate counts,
logs, and audits; it never throws and never blocks. The original sketch
(a `resourceExhausted` 429 throw against a bare env-var ceiling) is
superseded for the same reason Slice D/E's axis sketches were superseded:
`STATECRAFT_FACTORY_MAX_RUNS_IN_FLIGHT` is platform config, not an admitted
`budgets:` threshold (FR-001) or a peer envelope field like `oscillation:`/
`intent_dedup:`; refusing real work on an org-invisible, unadmitted value
would be an enforcement action with no admission record behind it. This
matches the Sequencing paragraph's own framing for (c): "detection-only,
thresholds from platform config until the envelope carries them."
Enforcement is deferred to that later envelope-carried threshold.

**Files added/edited (as-built)**:

- `platform/services/statecraft/api/factory/queueStormGate.ts` (new,
  established by this spec): `maxRunsInFlight()` reads
  `STATECRAFT_FACTORY_MAX_RUNS_IN_FLIGHT` with a parsed default of 25
  (justification in the module doc comment, mirroring the `max_repeats: 3`
  reasoning shape for FR-003(a)); `detectQueueStorm(ctx)` counts the org's
  `queued`/`running` rows and, at or over the ceiling, `log.warn`s and
  writes a `factory.run.storm_detected` audit row (new constant in
  `auditActions.ts`). Always resolves; never throws.
- `platform/services/statecraft/api/factory/runs.ts` -- in
  `reserveRunCore`, one `await detectQueueStorm({...})` call inside a
  `// region: queue-storm-gate (spec 202 FR-003c)` / `// endregion` marker
  pair, placed after the idempotent fast path and before
  `loadSubstrateForOrg` (detection does not need the resolved
  adapter/process to fire).
- `platform/services/statecraft/api/factory/auditActions.ts` --
  `FACTORY_RUN_STORM_DETECTED` constant plus its `FactoryRunAuditAction`
  union member.
- `platform/services/statecraft/vite.config.ts` -- the new test file joins
  the encore-test-only exclude list (live DB).
- `platform/services/statecraft/CLAUDE.md` -- documents the
  `STATECRAFT_FACTORY_MAX_RUNS_IN_FLIGHT` knob.
- The sweeper (`runsScheduler.ts`) is NOT modified (confirmed per spec
  §Code reality 5).

**Frontmatter additions to `spec.md`** (same PR): `establishes` for the new
`queueStormGate.ts` (+ its test file); `refines` aspects for `runs.ts`
("queue-storm-detection"), `auditActions.ts`
("queue-storm-audit-actions"), `vite.config.ts`
("encore-test-lane-assignment", same aspect name spec 200 used for the
same lane-assignment edit), and `CLAUDE.md`
("queue-storm-env-knob-docs").

**Tests** (`queueStormGate.test.ts`, fixture family `33333333-...`):
over-ceiling still admits (`reserved: true`) and writes the
`storm_detected` audit row; under-ceiling admits with no audit row;
terminal-status (`ok`/`failed`/`cancelled`) rows do not count toward
in-flight; plus a direct unit group for `maxRunsInFlight()`'s env-parsing
(default, valid override, invalid-override fallback).

<details>
<summary>Earlier sketch (superseded; kept for the historical record)</summary>

The original plan proposed an enforce path:

```typescript
const [{ count: inFlight }] = await db
  .select({ count: sql<number>`count(*)::int` })
  .from(factoryRuns)
  .where(
    and(
      eq(factoryRuns.orgId, auth.orgId),
      inArray(factoryRuns.status, ["queued", "running"]),
    ),
  );
const maxInFlight = runsInFlightCeiling();
if (inFlight >= maxInFlight) {
  throw APIError.resourceExhausted(
    `org has ${inFlight} runs in flight (ceiling: ${maxInFlight}); ` +
    `wait for a run to complete or raise the ceiling via org policy (spec 202 FR-003c)`
  );
}
```

This is not what landed (see the design note above); it is retained here
so the "throw" idiom is discoverable when a future PR wires the
envelope-carried threshold and revisits enforcement.

</details>

---

### Slice G: FR-004 Approval-velocity counter (independent) -- LANDED

**Depends on**: Nothing from the above slices. Can land any time after spec 198 is complete.

**FR/AC coverage**: FR-004 (records, does not block).

**Design note (as-built, from the PR-time spec 201 survey; supersedes the sketch below)**:
the deferred survey ran at PR time and reshaped two points of the sketch, the
same way the D/E/F design notes did:

1. *Surface on the endpoint response, not inside `ApprovalSummary`.* The sketch
   said "surface via a new diagnostic field in `ApprovalSummary`". But
   `ApprovalSummary` is the spec 201 hashed contract (`summaryHash` over a
   deterministic field set), and its FR-003(b) replay guard refuses an approve
   whose re-assembled hash drifts. Approval velocity is actor- and
   time-dependent, so folding it into the hash would make every summary
   momentarily stale and break the replay guard. The velocity is therefore a
   read-only `approvalVelocity` field on the `RunApprovalContextResponse`
   endpoint shape, and the hashed contract in `approvalSummary-pure.ts` is
   untouched. Only the wrapper `approvalSummary.ts` changes.

2. *Org scoping via the run join, because `audit_log` has no `org_id`.* The
   sketch's key was `(actor_id, org_id, window_start)`. The recorded fact is
   `audit_log.actor_user_id`; there is no `org_id` column. Approvals are
   `gate_approved` rows with `targetType = "factory_runs"`, `targetId = <run
   uuid>`, so the org is recovered by joining to `factory_runs` on `org_id`
   (casting the uuid to text for the text `target_id`). Actor-scoped count,
   fenced to the caller's org.

The rest of the sketch stands: records-only, never blocks; N-in-a-window test
fixture; composes with spec 201's ratification trail (it counts the
`gate_approved` rows spec 201 writes).

**Files added/edited (as-built)**:

- `platform/services/statecraft/api/factory/approvalVelocity-pure.ts` (new,
  established): `ApprovalVelocity` interface, the env-knob readers
  (`approvalVelocityWindowSecs` / `approvalVelocityThreshold`, defaults 60s /
  10, same `positiveIntEnv` idiom as `maxRunsInFlight`), and the pure
  `computeApprovalVelocity(timestamps, nowIso, windowSecs, threshold)`
  classifier (`anomalous = count >= threshold`, mirroring `detectQueueStorm`'s
  at-or-over convention).
- `platform/services/statecraft/api/factory/approvalVelocity.ts` (new,
  established): the DB half. `measureApprovalVelocity(ctx)` (read-only,
  fail-open, returns null on DB error) does the org-scoped join count and the
  pure classify; `detectApprovalVelocity(ctx)` (approve-path, fully fail-open)
  records a `factory.run.approval_velocity_anomaly` audit row when anomalous.
- `platform/services/statecraft/api/factory/approvalSummary.ts` (refined,
  aspect `approval-velocity-surface`): `approvalVelocity?` field on
  `RunApprovalContextResponse`; `measureApprovalVelocity` call in
  `getRunApprovalContextCore` (surface, both branches); `detectApprovalVelocity`
  call in `approveRunGateCore` after the `gate_approved` insert.
- `platform/services/statecraft/api/factory/auditActions.ts` (refined, aspect
  `approval-velocity-audit-action`): `FACTORY_RUN_APPROVAL_VELOCITY_ANOMALY`
  constant + union member.
- `platform/services/statecraft/vite.config.ts` (covered by the existing Slice
  F `encore-test-lane-assignment` refine): the new DB test file joins the
  encore-lane exclude list.
- `platform/services/statecraft/CLAUDE.md` (covered by the existing Slice F
  `queue-storm-env-knob-docs` refine): the two velocity env knobs documented.

**Tests**: `approvalVelocity-pure.test.ts` (bare vitest) covers the windowing +
threshold boundary + env parsing (the FR-004 N-in-a-window assertion, cheap and
DB-free); `approvalVelocity.test.ts` (encore lane, fixture family
`44444444-...`) covers the org-scoped join count, the anomaly-record path, the
window exclusion, and org isolation against a second org's approvals by the same
actor.

Note: This slice is the least constrained by the dependency tree and the least
risky (no blocking gate). It landed last without blocking any other AC.

<details>
<summary>Superseded pre-survey sketch (not built as written)</summary>

**Files to edit**: The approval surfaces in the platform (`approvalSummary.ts` and `approvalSummaryEndpoint.ts` in `platform/services/statecraft/api/factory/`). The gate predicates are filed via the envelope; the velocity counter counts approvals per actor per window and surfaces anomalous velocity.

Since FR-004 is detection-only (records, never blocks) and it composes with spec 201's `ApprovalSummary` evidence rows, this slice requires surveying spec 201's surfaces to understand the exact integration point. That survey is deferred to PR time. Scope: add a velocity accumulator per `(actor_id, org_id, window_start)` at the approval-grant path, surface via a new diagnostic field in `ApprovalSummary`, and add a test fixture with N approvals in a short window asserting the `anomalous_velocity: true` flag appears.

</details>

---

## Dependency order and PR recommendation

```
Slice A (FR-001, AC-3, AC-7) -- LAND FIRST
    |
    +---> Slice B (FR-002, AC-1, AC-5, AC-6)
    |         |
    |         +---> Slice C (FR-005, AC-4)
    |         |
    |         +---> Slice D (FR-003b, AC-2)
    |         |
    |         +---> Slice E (FR-003a)  [can also start from A alone]
    |
    +---> Slice F (FR-003c)  [independent of B/C/D/E]
    |
    +---> Slice G (FR-004)   [fully independent]
```

**First PR: Slice A.** Rationale: it is the dependency root; nothing else ships cleanly without stable `RunBudget*` types. It also carries the mandatory AC-7 schema-parity lockstep, which CI enforces and which is the highest-risk gate to fail silently. Landing Slice A first surfaces any schema-parity tool friction before the larger PRs arrive.

---

## Summary

| Slice | FRs | ACs | First PR? |
|-------|-----|-----|-----------|
| A | FR-001 | AC-3, AC-7 | **Yes** |
| B | FR-002 | AC-1, AC-5, AC-6 | No (needs A) |
| C | FR-005 | AC-4 | No (needs A + B) |
| D | FR-003(b) | AC-2 | No (needs B) |
| E | FR-003(a) | (none stated) | No (needs A) |
| F | FR-003(c) | (none stated) | No (independent) |
| G | FR-004 | (none stated) | No (independent) |

All seven slices landed (PR1 #469, C #472, D #481, E #486, F #492, G this PR; B rode PR1). `spec.md` flipped to `status: approved` / `implementation: complete` on 2026-07-01 (user-ratified). One acceptance-criterion detail was corrected after the flip: AC-6 pt2 (subsume `FactoryPipelineState.total_tokens` into the meter's `tokens` axis so no two independent accumulators coexist) was tracked as a follow-up (PR1b) and then withdrawn on investigation (2026-07-02, user-ratified). The two counters are not redundant: `total_tokens` is the persisted, poll-surfaced UI total (`build_status_response` -> `PipelineStatusResponse`, serialized to `.factory/pipeline-state.json`), whereas the `RunBudgetMeter`'s `tokens` axis is an in-memory, per-spawn accumulator feeding only the budget gate + certificate snapshot and out of scope at the status-poll command. `total_tokens` is kept by design; AC-6 is satisfied by pt1. See spec.md §Acceptance criteria "Implementation status (AC-6 residual)".

---

## Risks and open questions

1. **`CERTIFICATE_VERSION` drift (critical)**: The spec says `1.5.0 -> 1.6.0` but 1.6.0 has already landed for spec 218. Slice C must bump to `1.7.0` not `1.6.0`. If spec 218 is not yet in `main` at PR time, confirm with `git log` on the const; otherwise this is a firm correction.

2. **`DispatchOptions.pre_step` is a single `Option`**: Composing `GrantRenewalGate` and `BudgetGate` requires either (a) the `ChainedPreStepGate` wrapper proposed in Slice B, or (b) changing the field to `Vec`. Option (a) is non-breaking and preferred. Option (b) is a larger surface change and needs coupling review against all `DispatchOptions` construction sites.

3. **`file_mutations` axis is zero-valued today**: The executor does not report workspace mutations post-step; the axis records 0 until the executor is updated (a future spec). The axis is admitted and metered (with ceiling `None` or a conservative default meaning "no limit until metered"), but no ceiling breach is ever triggered on it today. This is correct per the spec's bounded-overshoot contract; document in code comments.

4. **`spawned_agents` vs. step count**: The spec says `spawned_agents` is "dispatched step count, including the dynamically generated Phase-2 scaffold manifest, whose step count is bounded at generation time, not only during dispatch." The Phase-2 step count is known at manifest generation (`manifest.steps.len()`). The meter should accept a `record_phase_plan(step_count: usize)` call from the engine at Phase-2 manifest generation to pre-charge the `spawned_agents` axis, not wait for each step to dispatch.

5. **Coupling gate on `runs.ts` (Slice F)**: The current `references: context` role does not grant ownership. Before editing `runs.ts`, the Slice F PR must update `spec.md` to add a `refines:` or `establishes:` edge for that file. Failure to do this will cause the coupling gate to fire in CI.

6. **Featuregraph golden**: The golden at `crates/featuregraph/tests/golden/features_graph.json` already has spec 202's row with `impl_files: []`. After any slice lands implementation files, the `impl_files` list in the golden will be out of date. Run `UPDATE_GOLDEN=1 cargo test -p featuregraph` in each PR's `make pr-prep` step to regenerate the golden before pushing.

7. **CONST-005 risk**: None identified. The implementation adds budget machinery and certificate fields; it does not propose modifying a spec to justify an action that contradicts the spec's design. The certificate version correction (1.6.0 -> 1.7.0) is a factual alignment, not a retroactive justification.
