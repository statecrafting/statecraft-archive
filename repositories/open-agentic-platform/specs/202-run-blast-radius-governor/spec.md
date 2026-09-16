---
id: "202-run-blast-radius-governor"
title: "Run Blast-Radius Governor (ASI08 cascading-failure caps)"
feature_branch: "feat/202-run-blast-radius-governor"
status: approved
implementation: complete  # All five FRs landed across PR1 #469 (FR-002 meter + circuit break), Slice C #472 (FR-005 cert binding), Slice D #481 (FR-003b oscillation), Slice E #486 (FR-003a intent-dedup), Slice F #492 (FR-003c queue-storm detection), Slice G (FR-004 approval-velocity counter, this PR). AC-1 through AC-7 all satisfied. AC-6 pt1 (max_total_tokens removed from the engine config) landed in PR1. AC-6 pt2 (subsume FactoryPipelineState.total_tokens into the meter's tokens axis) was WITHDRAWN on investigation (2026-07-02, user-ratified): the two counters are not redundant. total_tokens is the persisted, poll-surfaced UI total (build_status_response -> PipelineStatusResponse; serialized to .factory/pipeline-state.json), whereas the RunBudgetMeter is an in-memory, per-spawn accumulator feeding only the budget gate + cert snapshot and is not in scope at the status endpoint. Removing total_tokens would be a behavior-bearing refactor, not a cleanup, so it is kept by design; AC-6 is satisfied by pt1 and the "no two accumulators coexist" clause is retracted. See §Acceptance criteria AC-6 note.
kind: governance
domain: platform
created: "2026-06-11"
authors: ["open-agentic-platform"]
language: en
summary: >
  Close the one ASI 2026 control whose residual is stated but unowned. Spec
  198's all-ten table marks ASI08 (Cascading Failures) "partial — residual
  stated" and names blast-radius caps as follow-on; this spec is that
  follow-on. Existing levers (halt-on-failure, stop-hook 166, HITL gate
  predicates 198 FR-008, introspection 172) are reactive gates — they fire
  on an observed failure or at a declared checkpoint. What is missing is the
  quantitative ceiling between gates: per-run and per-stage budgets (tool
  invocations, file mutations, spawned work, wall-clock, cost), metered by
  the engine and circuit-breaking fail-closed when exceeded, plus fan-out
  and feedback-loop detection (ASI08 m6/m7, ASI02 m5 adaptive tool
  budgeting). A run that exceeds its admitted budget pauses at the next
  instruction boundary and requires a human resume; consumption actuals are
  bound into the governance certificate so the receipt shows how close the
  run came to its ceiling.
code_aliases: ["RUN_BLAST_RADIUS_GOVERNOR"]
compliance:
  - framework: "owasp-asi-2026"
    controls: ["ASI02", "ASI08"]
depends_on:
  - "198-factory-governance-envelope"
  - "166-opc-stop-hook-gate-chain"
  - "172-opc-live-agent-session-introspection"
  - "075-factory-workflow-engine"
establishes:
  # Slice A (FR-001): new run_budget module
  - unit: { kind: file, path: crates/factory-contracts/src/run_budget.rs }
  # Slice A (FR-001): governance_envelope gains budgets: field
  - unit: { kind: file, path: crates/factory-contracts/src/governance_envelope.rs }
  # Slice B (FR-002): run-level meter + budget PreStepGate + gate chain
  - unit: { kind: file, path: crates/orchestrator/src/budget_gate.rs }
  # Slice F (FR-003c): platform-side queue-storm detection, owned module.
  - unit: { kind: file, path: platform/services/statecraft/api/factory/queueStormGate.ts }
  - unit: { kind: file, path: platform/services/statecraft/api/factory/queueStormGate.test.ts }
  # Slice G (FR-004): approval-velocity counter, owned modules (pure classifier
  # + DB half) and their tests. The pure test runs bare-vitest; the DB test is
  # encore-lane (vite.config.ts exclude, covered by the existing Slice F
  # encore-test-lane-assignment refines edge).
  - unit: { kind: file, path: platform/services/statecraft/api/factory/approvalVelocity-pure.ts }
  - unit: { kind: file, path: platform/services/statecraft/api/factory/approvalVelocity.ts }
  - unit: { kind: file, path: platform/services/statecraft/api/factory/approvalVelocity-pure.test.ts }
  - unit: { kind: file, path: platform/services/statecraft/api/factory/approvalVelocity.test.ts }
  # Slice G follow-up (FR-004 perf): the composite index serving the
  # approval-velocity read on audit_log (actor_user_id, action, created_at).
  # audit_log carried no indexes, so loadActorApprovalTimestamps was a
  # sequential scan over an append-only, monotonically growing table. It is
  # numbered 3 (renumbered from 2 to sit after #499's backfill, which is itself
  # the first migration since the #454/#455 baseline reset). api/db is co-owned
  # by spec 119's directory claim; this file-level establishes makes 202 the
  # specific owner so the coupling gate resolves to the motivating spec.
  - unit: { kind: file, path: platform/services/statecraft/api/db/migrations/3_audit_log_actor_action_created_idx.up.sql }
extends:
  # Budget declarations are an additive, ASI08-tagged section of the
  # envelope schema spec 198 establishes.
  - spec: "198-factory-governance-envelope"
    nature: additive
    unit: { kind: file, path: standards/schemas/factory/governance-envelope.schema.yaml }
  # Same precedent as specs 196, 194, 193, 187, 183: a new spec adds a row
  # to the featuregraph golden.
  - spec: "034-featuregraph-registry-scanner-fix"
    nature: additive
    unit: { kind: file, path: crates/featuregraph/tests/golden/features_graph.json }
refines:
  - aspect: "run-budget-metering"
    unit: { kind: file, path: crates/orchestrator/src/lib.rs }
  # Slice B (FR-002): orchestrator takes a factory-contracts dependency for the
  # RunBudget* meter types consumed by budget_gate.rs.
  - aspect: "run-budget-metering"
    unit: { kind: file, path: crates/orchestrator/Cargo.toml }
  # Slice A (FR-001): factory-contracts re-exports the new RunBudget* types.
  - aspect: "run-budget-contract-exports"
    unit: { kind: file, path: crates/factory-contracts/src/lib.rs }
  # Slice A (FR-001): the schema-version-pin test tracks the 1.0.0 -> 1.1.0 bump.
  - aspect: "schema-version-pin"
    unit: { kind: file, path: crates/factory-contracts/src/build_spec.rs }
  # PR1 wiring (FR-002): the meter + BudgetGate are composed into the live
  # dispatch path (OPC command + CLI bin) and the dead max_total_tokens
  # ceiling is retired from the engine config (AC-6, first half).
  - aspect: "run-budget-metering"
    unit: { kind: file, path: crates/factory-engine/src/engine.rs }
  - aspect: "run-budget-metering"
    unit: { kind: file, path: crates/factory-engine/src/bin/factory_run.rs }
  - aspect: "run-budget-metering"
    unit: { kind: file, path: product/apps/opc/src-tauri/src/commands/factory.rs }
  # Slice C (FR-005/AC-4): the certificate gains the budget_consumption record,
  # its verify checks (per-axis consistency + axis-completeness), and the
  # 1.7.0 -> 1.8.0 version bump; the CLI + OPC emission paths thread the meter
  # snapshot into the signed payload.
  - aspect: "budget-consumption-certificate-binding"
    unit: { kind: file, path: crates/factory-engine/src/governance_certificate.rs }
  # Slice F (FR-003c): the detection call in reserveRunCore, marked with a
  # `// region: queue-storm-gate (spec 202 FR-003c)` anchor. runs.ts is
  # co-authored (spec 124 establishes; spec 200 refines "consumed-override-
  # revocation-sweep"); this is a third, independent refines aspect.
  - aspect: "queue-storm-detection"
    unit: { kind: file, path: platform/services/statecraft/api/factory/runs.ts }
  # Slice F (FR-003c): the new FACTORY_RUN_STORM_DETECTED audit constant.
  - aspect: "queue-storm-audit-actions"
    unit: { kind: file, path: platform/services/statecraft/api/factory/auditActions.ts }
  # Slice F (FR-003c): the new test file joins the encore-test-only exclude
  # list, same lane-assignment aspect spec 200 used for the same file.
  - aspect: "encore-test-lane-assignment"
    unit: { kind: file, path: platform/services/statecraft/vite.config.ts }
  # Slice F (FR-003c): STATECRAFT_FACTORY_MAX_RUNS_IN_FLIGHT env-knob doc.
  - aspect: "queue-storm-env-knob-docs"
    unit: { kind: file, path: platform/services/statecraft/CLAUDE.md }
  # Slice G (FR-004): approval-velocity is surfaced on the run-approval context
  # response and recorded on the approve path. approvalSummary.ts is spec 201's
  # module (establishes); this is a section-scoped refine that adds the FR-004
  # measurement/record call sites + the read-only `approvalVelocity` field,
  # without touching the hashed ApprovalSummary contract in approvalSummary-pure.ts.
  - aspect: "approval-velocity-surface"
    unit: { kind: file, path: platform/services/statecraft/api/factory/approvalSummary.ts }
  # Slice G (FR-004): the new FACTORY_RUN_APPROVAL_VELOCITY_ANOMALY audit
  # constant (auditActions.ts already covered by the Slice F queue-storm-audit
  # aspect, but the FR-004 constant is a distinct addition worth its own edge).
  - aspect: "approval-velocity-audit-action"
    unit: { kind: file, path: platform/services/statecraft/api/factory/auditActions.ts }
references:
  - role: enforcer
    unit: { kind: crate, id: factory-engine }
  - role: context
    unit: { kind: file, path: platform/services/statecraft/api/factory/runsScheduler.ts }
  - role: context
    unit: { kind: file, path: docs/owasp-agentic-top-10-2026.md }
  # Surfaces surveyed by the 2026-06-12 refinement pass (non-owning;
  # implementation claims land with the implementation PR):
  - role: pause-channel-precedent
    unit: { kind: file, path: product/apps/opc/src-tauri/src/commands/run_governance.rs }
  - role: trip-pattern-library
    unit: { kind: file, path: crates/orchestrator/src/circuit_breaker.rs }
---

# Feature Specification: Run Blast-Radius Governor

**Feature Branch**: `202-run-blast-radius-governor`
**Created**: 2026-06-11
**Refined**: 2026-06-12 (sketch FRs hardened against the surveyed metering
surfaces; see §Code reality)
**Status**: Approved, implementation complete (2026-07-01). Originally filed
as a follow-on by the ASI gap-closure pass (named in spec 198's all-ten table,
ASI08 row); all five FRs have since landed (see plan.md). The AC-6 pt2
token-accumulator cleanup (originally tracked as PR1b) was withdrawn on
investigation (see §Acceptance criteria "Implementation status (AC-6
residual)").
**Input**: Spec 198 §"All-ten ASI coverage" records ASI08 as the only
control that is *partial with an unowned residual*: "blast-radius caps are
follow-on". ASI06's residual got spec 200 and ASI09's got spec 201 at
filing time; ASI08's did not. This spec gives it an owner.

## Purpose

ASI08 is about propagation and amplification, not the initial defect. OAP
already interposes gates — per-stage verification fails closed (075), the
stop-hook chain blocks session close (166), HITL predicates are declared in
the admitted envelope (198 FR-008), and an operator can watch and
force-disconnect a session (172). All of these are *event-shaped*: they
fire at a boundary or on an observed failure. Between boundaries, a
misbehaving run is unbounded — a feedback loop, a retry storm, or a
fan-out of repeated near-identical intents can do arbitrary work before
any gate is consulted (the ASI08 detection hooks: rapid fan-out,
oscillating retries, downstream queue storms, repeated identical intents).

The governor adds the *quantity* dimension: declared ceilings, engine-side
metering, and a circuit breaker between planner and executor (ASI08 m7),
composing with — never replacing — the existing gates.

## Code reality: the metering surfaces (surveyed 2026-06-12)

The refinement pass grounded each FR in what exists today. Five findings
shape the design:

1. **The instruction boundary exists and is step-shaped.** The
   orchestrator dispatch loop consults the `PreStepGate` trait
   (`crates/orchestrator/src/lib.rs`) once per step, before dispatch, on
   both the persisted and non-persisted paths; a gate `Err` fails the
   step closed, cascades `Skipped` to dependents, and persists the run
   summary. The live implementation is `GrantRenewalGate`
   (`product/apps/opc/src-tauri/src/commands/run_governance.rs`), the
   spec 198 FR-005 pause channel this spec reuses.
2. **Per-step actuals are already collected; run-level accumulation is
   not.** Every dispatched step records `tokens_used`, `cost_usd`,
   `duration_ms`, `num_turns`, and `retry_count` into the run summary.
   Nothing accumulates these across steps, and nothing compares any of
   them to a ceiling. `FactoryPipelineState.total_tokens` is the one
   cross-phase accumulator, and it too is never checked.
3. **One ceiling is a dead stub.** `FactoryEngineConfig.max_total_tokens`
   (annotated NF-002) is declared, hardcoded `None` at the CLI
   entrypoint, and read nowhere. FR-002 activates or retires it; after
   this spec no declared-but-unenforced ceiling remains (AC-6).
4. **Within a step the run is opaque.** The executor runs the agent as a
   subprocess and observes tool calls only from post-exit accounting.
   Budget checks therefore fire at step entry against accumulated
   actuals; a breaching step can overshoot its run-level ceiling by at
   most one step's work, with in-step wall-clock already bounded by the
   executor's per-step, effort-scaled timeout. This bounded overshoot is
   an accepted contract of the design: it is metered, surfaced, and
   certificate-visible, not silently absorbed.
5. **The platform scheduler is a sweeper, not a queue.**
   `platform/services/statecraft/api/factory/runsScheduler.ts` flips
   stale runs to `failed` on a cron using `last_event_at`; there is no
   runs-in-flight counter and no enqueue-rate observation. FR-003's
   queue-storm lever is a new count gate at run submission, not a
   modification of the sweeper.

Supporting surfaces: the oscillation-trip pattern already exists as an
unwired library (`crates/orchestrator/src/circuit_breaker.rs`, spec 102
FR-032/FR-035, consecutive-failure trip; a library today, not wired into
dispatch); the certificate extension point is `CertificateBuilder` plus
`verify_certificate` (`crates/factory-engine/src/governance_certificate.rs`,
schema v1.5.0), with `SandboxExecutionRecord.resource_peak` as the existing
precedent for quantitative per-stage binding. Naming note:
`crates/factory-contracts/src/budget.rs` already exports `AssumptionBudget`
(spec 121, claim provenance, unrelated); the governor's types take a
distinct `RunBudget*` prefix to avoid collision.

## Functional requirements

- **FR-001 — Declared budgets in the envelope.** The governance envelope
  gains an additive `budgets:` section, every field ASI08-tagged inline
  (the spec 198 FR-002 idiom: the brief cites its statutes). Shape
  discipline: the envelope is predicate-shaped, never topology-shaped
  (198 P-2), so budgets are declared at two scopes only: `per_run`
  (ceiling on the whole run) and `per_stage` (a uniform ceiling no single
  stage may exceed); a stage-id-keyed map is inadmissible, since stage
  ids are run topology OAP does not model. Axes, each optional:
  - `tool_invocations` — as reported by the executor's post-step turn
    accounting today; a finer per-tool-call count is adopted when the
    executor surfaces one.
  - `file_mutations` — requires a new post-step workspace-accounting
    observation point (the executor does not report mutations today).
  - `spawned_agents` — dispatched step count, including the dynamically
    generated Phase-2 scaffold manifest, whose step count is bounded at
    generation time, not only during dispatch.
  - `wall_clock_secs` — run-level elapsed time (per-step timeouts
    already exist and are unchanged; see §Overlaps).
  - `tokens` / `cost_usd` — the existing per-step actuals, accumulated.

  Budgets are admitted like every other envelope field (two-sided
  validation, 198 FR-001/FR-003). An absent budget does NOT mean
  unlimited: platform defaults apply fail-closed, and the admission
  record shows each defaulted axis with `source: platform-default`. Org
  policy may tighten, never loosen, the platform defaults (the spec 047
  five-tier merge direction). Versioning: the schema bumps 1.0.0 → 1.1.0
  with the Rust twin (`GOVERNANCE_ENVELOPE_SCHEMA_VERSION`,
  `crates/factory-contracts/src/governance_envelope.rs`) updated in the
  same PR; the version is a compile-time const, so a mismatch fails at
  parse. Lockstep posture: `governance-envelope.schema.yaml` is Tier B in
  the spec 212 checker, so the addition is OAP-unilateral and
  factory adopts on its own schedule.
- **FR-002 — Engine-side metering and circuit break.** A run-level
  `RunBudgetMeter` accumulates the per-step actuals the orchestrator
  already collects (§Code reality 2), one accumulator per admitted axis.
  A budget gate implementing `PreStepGate` checks the meter against the
  admitted ceilings at every step boundary, ordered after
  `GrantRenewalGate` and composing with it, never replacing it. Exceeding
  any ceiling pauses the run at the next step boundary with the same
  pause semantics as a failed grant renewal (198 FR-005): the step fails
  closed before dispatch, the breach surfaces via introspection (172)
  with an attributable record naming axis, ceiling, and actual, and
  resume requires an explicit human actor with either a raised ceiling
  (a new admission or an audited override, AC-5) or an abort. The engine
  never silently resumes and never auto-raises a budget. Granularity
  contract: checks fire at step entry, so a single step may overshoot by
  at most its own work (§Code reality 4); the overshoot is metered and
  certificate-visible. This FR also discharges the dead stub:
  `max_total_tokens` is either enforced through the meter or removed
  (AC-6).
- **FR-003 — Fan-out and feedback-loop detection.** Beyond static
  ceilings, the governor detects the ASI08 propagation signatures, each
  with thresholds declared as envelope fields, never hardcoded (a peer
  top-level `intent_dedup:` field for signature (a), mirroring the peer
  `oscillation:` field for signature (b); refined against that same
  precedent, see FR-003a/FR-003b, rather than the `budgets:` axis this FR
  originally proposed for (a): a per-signature repeat count is not a
  monotonic run-total axis either, the same reason (b)'s
  consecutive-failure streak is not one. A `budgets:`-shaped count gate
  remains only for the platform-side signature (c)):
  - *(a) Repeated near-identical intents* within a run, engine-side,
    declared as the peer envelope field `intent_dedup:`
    (`IntentDedupThreshold`: `max_repeats`, `window_secs`). Intent
    identity is the run's goal id plus a step signature:
    `SHA-256_hex(goal_id + "\n" + normalize(instruction))`, mirroring
    the `goal_id` construction in
    `crates/factory-engine/src/intent_capsule.rs`. The step id is
    excluded from the hash so dynamically generated near-twin steps
    collide; `normalize` = trim, collapse internal whitespace runs to a
    single space, lowercase (fixed at implementation, documented as
    contract on the Rust twin). Platform default `max_repeats: 3`,
    deliberately tighter than oscillation's `consecutive_failures: 5`:
    a literal repeated instruction has no "still making forward
    progress" reading the way a self-correcting retry streak does.
    Detection window: whole-run count in this slice (`window_secs` is
    carried in the contract, platform-fixed/unused, mirroring
    `OscillationThreshold.window_secs`). Slice E bumps the
    governance-envelope schema 1.2.0 -> 1.3.0 to add the `intent_dedup:`
    field, landing the YAML and the Rust twin
    (`GOVERNANCE_ENVELOPE_SCHEMA_VERSION`) in the same PR under the same
    lockstep discipline AC-7 established for the 1.1.0/1.2.0 bumps.
  - *(b) Oscillating retry/compensation loops (observed as consecutive
    retry-heavy steps under fail-fast dispatch; see the implementation
    note below).* Inputs
    are the per-step `retry_count` and the step failure/retry sequence
    the orchestrator already records; the detector reuses the
    consecutive-trip pattern of `circuit_breaker.rs` (102
    FR-032/FR-035), wiring the today-unwired library into dispatch.
    Implementation note (refined against dispatch reality): the
    orchestrator halts on the first hard step failure (spec 075
    halt-on-failure, orchestrator rule 4), so a literal inter-stage
    failure loop cannot arise in a live run; the realizable cross-step
    signal is therefore consecutive retry-heavy steps (`retry_count > 0`
    on steps that eventually succeeded), which the detector feeds on. A
    step "wobbles" when it needed at least one intra-step retry or hard
    failed; the circuit breaks at a declared consecutive-wobble threshold
    (the envelope `oscillation:` field, platform-default fail-closed).
    Slice D bumps the governance-envelope schema 1.1.0 -> 1.2.0 to add the
    `oscillation:` field, landing the YAML and the Rust twin
    (`GOVERNANCE_ENVELOPE_SCHEMA_VERSION`) in the same PR under the same
    lockstep discipline AC-7 established for the 1.1.0 bump.
  - *(c) Queue storms, platform-side.* Runs-in-flight per org
    (`queued` + `running`) counted at run submission against a
    configurable ceiling; a new count gate, the staleness sweeper is
    unchanged (§Code reality 5). **Landed detection-only** (Slice F,
    `platform/services/statecraft/api/factory/queueStormGate.ts`): at or
    over the ceiling, `detectQueueStorm` logs a warning and writes a
    `factory.run.storm_detected` audit row naming the org, the observed
    count, and the ceiling; the run is still admitted either way. This
    supersedes the earlier plan-time sketch (a `resourceExhausted` 429
    refusal): (c) is a platform-config ceiling read from
    `STATECRAFT_FACTORY_MAX_RUNS_IN_FLIGHT` (default 25), not yet an
    admitted `budgets:` threshold (FR-001), so refusing on it would block
    real work on a value the org never admitted. Enforcement is deferred to
    the envelope-carried threshold, matching Sequencing's "detection-only,
    thresholds from platform config until the envelope carries them"
    posture already stated for this signature.

  Response order: detection throttles first (rate cap), breaks second
  (pause via the FR-002 channel). Implementation note for (a) and (b)
  (refined against dispatch reality, same posture as (b)'s note above):
  the orchestrator's dispatch loop is sequential, so there is no
  concurrency between steps to rate-limit; "throttle" is degenerate on
  this substrate. Both detectors implement the break only (fail-closed
  pause) as the MVP response; the throttle tier is not silently
  dropped, it is recorded here as not yet realizable, pending a
  concurrent dispatch substrate that would make it load-bearing.
- **FR-004 — Approval-velocity (governance-drift) counter.** Bulk
  rubber-stamping is ASI08's governance-drift vulnerability. The governor
  counts approvals per actor per window and surfaces anomalous approval
  velocity on the approval surfaces, composing with spec 201's
  fact-grounded `ApprovalSummary` evidence rows and `summaryHash` audit
  trail; it records, it does not block — blocking on human behaviour is
  an org-policy decision, not a platform hardcode (the 198 FR-013
  posture: depth of policy is org-filed).

  **Landed (Slice G, this PR); as-built refinements of the plan sketch,
  mirroring the D/E/F design-note precedent:**
  - *Surface, not hash.* The velocity is surfaced as a read-only
    `approvalVelocity` field on the `GET /api/factory/runs/:id/approval-context`
    response, NOT folded into the hashed `ApprovalSummary`. Velocity is actor-
    and time-dependent, so putting it inside the summary hash would break the
    spec 201 FR-003(b) replay guard (a re-assembly moments later would differ).
    `approvalSummary-pure.ts` (the hashed contract) is untouched; only the
    wrapper `approvalSummary.ts` gains the field and the call sites.
  - *Record on write, measure on read.* The `POST .../approve` path, after the
    `gate_approved` row is committed, writes a
    `factory.run.approval_velocity_anomaly` audit row when the rate is anomalous
    (`api/factory/approvalVelocity.ts::detectApprovalVelocity`, fail-open). The
    GET context path only measures (read-only), preserving spec 201 FR-003
    preview purity. Both paths are records-only and never block an approval.
  - *Org scoping via the run join.* `audit_log` has no `org_id` column, so the
    actor's `gate_approved` rows are scoped to the caller's org by joining to
    `factory_runs` (`targetType = "factory_runs"`, `targetId = <run uuid>`) on
    the org, matching the plan's `(actor_id, org_id, window)` key.
  - *The read is indexed (follow-up migration).* `loadActorApprovalTimestamps`
    filters `audit_log` on equality `(actor_user_id, action)` plus a
    `created_at >= cutoff` range. `audit_log` carried no indexes at all, so the
    read (and every other `audit_log` read) was a sequential scan over an
    append-only, monotonically growing table. Migration
    `3_audit_log_actor_action_created_idx.up.sql` (renumbered from 2 to sit
    after #499's backfill migration) adds the composite btree
    `(actor_user_id, action, created_at)`; the planner picks it for this exact
    predicate, with `target_type` left as a cheap post-filter.
  - *Thresholds are platform config.* Window and threshold are env knobs
    (`STATECRAFT_FACTORY_APPROVAL_VELOCITY_WINDOW_SEC` / `_THRESHOLD`, defaults
    60s / 10), the same "platform config until the envelope carries an
    authoritative threshold" posture FR-003(c) landed with.
- **FR-005 — Certificate binding of consumption actuals.** The
  governance certificate gains a `budget_consumption` record inside the
  signed payload (covered by the content hash and Ed25519 signature;
  certificate schema bumps 1.5.0 → 1.6.0): per admitted axis, `{ceiling,
  actual, source: declared | platform-default, breached}` at termination
  (success or halt). `verify-certificate` gains two checks: every
  admitted axis is present, and the actuals are internally consistent
  with the per-stage records; tampering with an actual fails
  verification with an axis-specific diagnostic (the spec 102 FR-007
  posture: the verifier does not trust the producer). A run that
  circuit-broke is visibly marked, mirroring how halts already surface.

## Overlaps with existing machinery (refine, do not duplicate)

- **Per-step wall-clock timeouts** (executor, effort-scaled) and
  **per-step retry caps** (`max_retries` in manifest generation) stay as
  they are: they bound a single step. The governor's axes bound the run
  and the uniform per-stage ceiling; FR-003 (b)'s oscillation detection
  is inter-stage, orthogonal to the intra-step retry cap.
- **Approval-gate `timeout_ms`** (process-phase HITL wait with
  escalation) is an operational timeout, not a budget; FR-004 counts
  approval velocity, a different quantity.
- **`FactoryPipelineState.total_tokens`** is the prototype accumulator;
  FR-002 subsumes it into the per-axis meter rather than adding a second
  token counter.

## Acceptance criteria

- **AC-1.** A run whose accumulated tool-invocation actuals exceed the
  admitted budget pauses fail-closed at the next step boundary: the next
  step does not dispatch, the attributable error names the axis, the
  ceiling, and the actual, and resume requires a human actor id.
- **AC-2.** A seeded oscillation fixture trips the oscillation detector
  before exhausting the run's wall-clock budget. Because the orchestrator
  halts on the first hard step failure (spec 075, orchestrator rule 4),
  the realizable fixture is successive steps that each require an
  intra-step retry (`retry_count > 0`), not a literal inter-stage failure
  loop (which halt-on-failure precludes); the detector's input is the
  per-step `retry_count` (see FR-003b implementation note).
- **AC-3.** A factory admitted with no `budgets:` section runs under
  platform defaults; the admission record shows every defaulted axis
  with `source: platform-default`.
- **AC-4.** The emitted certificate carries `{ceiling, actual, source,
  breached}` per admitted axis inside the signed payload; tampering with
  an actual fails `verify-certificate` with an axis-specific diagnostic.
- **AC-5.** No code path raises a budget without a new admission or an
  audited human override.
- **AC-6.** No declared-but-unenforced ceiling remains in the engine
  configuration: `max_total_tokens` is enforced through the meter or
  removed. (The criterion originally also required
  `FactoryPipelineState.total_tokens` to be subsumed by the meter's
  `tokens` axis so that "no two independent token accumulators coexist";
  that clause was withdrawn on investigation, see the residual note below.
  The two counters are not redundant: one is the persisted UI total, the
  other the in-memory budget meter.)
- **AC-7.** The envelope schema 1.1.0 and its Rust twin land in the same
  PR; schema-parity (125/191) and the factory-schema-lockstep lane (212)
  are green.

> **Implementation status (AC-6 residual).** This spec flipped to
> `implementation: complete` on 2026-07-01 (user-ratified) with all five FRs
> landed. AC-6 pt1 (retire the dead `max_total_tokens` engine-config stub)
> landed in PR1 #469. AC-6 pt2 (subsume `FactoryPipelineState.total_tokens`
> into the meter's `tokens` axis so no two independent token accumulators
> coexist) was tracked as a follow-up (PR1b) and then **withdrawn on
> investigation (2026-07-02, user-ratified)**: the two counters are not
> redundant, so pt2's removal premise does not hold.
>
> The investigation (surveying the OPC read path the original §Code reality
> point 2 did not fully trace): `FactoryPipelineState.total_tokens` is the
> **persisted, poll-surfaced UI total**. It is read by `build_status_response`
> (`product/apps/opc/src-tauri/src/commands/factory.rs:1005`) into the desktop
> `PipelineStatusResponse`, read again by `emit_terminal_completed`
> (`factory.rs:1832`), and serialized into `.factory/pipeline-state.json`. The
> `RunBudgetMeter`'s `tokens` axis (FR-002) is a **separate, in-memory,
> per-spawn** accumulator (`factory.rs:1393`) that feeds only the budget gate
> and the certificate snapshot; it never persists and is out of scope at the
> status-poll command. Making the meter the single source would mean persisting
> it and threading it into the status path (a behavior-bearing refactor that
> changes the desktop `PipelineStatusResponse` contract), not the mechanical
> cleanup the flip anticipated.
>
> `total_tokens` is therefore **kept by design** as the UI/persistence surface,
> and AC-6 is satisfied by pt1 alone. The "no two accumulators coexist" clause
> is retracted: the counters serve different layers (persisted UI total vs.
> in-memory budget/cert meter) and their coexistence is correct, not drift.

## Out of scope

- The kill switch (org-wide halt is spec 208; the governor bounds a single
  run, it does not stop the fleet).
- Org risk-budget *values* — what the right ceilings are is filed org
  policy (the spec 198 FR-013 posture: depth of policy is org-filed, not
  OAP-hardcoded).
- Model-quality or semantic judgment of whether work is "useful" — the
  governor counts, it does not evaluate.
- HITL gate declaration and presentation (specs 198 FR-008 and 201).
- Per-tool-call interception inside a step. Sub-step granularity is
  executor-internal; the governor's boundary is the orchestrator step,
  and the bounded overshoot that follows is a stated contract (§Code
  reality 4), not a gap this spec closes.

## Sequencing

Gated on spec 198 reaching `implementation: complete` (the budgets section
rides the envelope schema and the pause semantics ride grant renewal,
198 FR-005). Two parts may land earlier behind a non-blocking flag because
they do not ride the envelope: FR-003 (c)'s platform-side runs-in-flight
counter (detection-only, thresholds from platform config until the
envelope carries them; **landed**, Slice F) and FR-004's approval-velocity
counter (records, never blocks; **landed**, Slice G). The 2026-06-12 refinement
is intentionally pre-gate: the FRs are implementable the day 198 flips.
