---
id: "200-substrate-override-async-scanner"
title: "Substrate Override Async Scanner (ASI06 model-assisted detection)"
feature_branch: "200-override-async-scanner"
status: approved
implementation: complete
kind: platform
domain: platform
created: "2026-06-10"
authors: ["open-agentic-platform"]
language: en
summary: >
  The model-assisted leg of the substrate override-write contract (spec 198
  FR-013 d, ASI06 m2): an asynchronous scanner that inspects user_body
  revisions for poisoning patterns the deterministic gate cannot express as
  rules, and quarantines suspect artifacts via the spec 198 FR-010 revocation
  machinery pending human review. The cross-cutting principle is preserved
  verbatim: a model may DETECT, only rules may BLOCK — the scanner never
  rejects a write synchronously and never lifts its own quarantines.
code_aliases: ["SUBSTRATE_OVERRIDE_ASYNC_SCANNER"]
depends_on:
  - "198-factory-governance-envelope"
  - "139-factory-artifact-substrate"
establishes:
  - unit: { kind: file, path: platform/services/statecraft/api/factory/overrideScanCore.ts }
  - unit: { kind: file, path: platform/services/statecraft/api/factory/overrideScanEvents.ts }
  - unit: { kind: file, path: platform/services/statecraft/api/factory/overrideScanWorker.ts }
  - unit: { kind: file, path: platform/services/statecraft/api/factory/overrideScanScheduler.ts }
  - unit: { kind: file, path: platform/services/statecraft/api/factory/overrideScanPolicy.ts }
  - unit: { kind: file, path: platform/services/statecraft/api/factory/overrideScanPrompts.ts }
  - unit: { kind: file, path: platform/services/statecraft/api/factory/overrideScanRuns.test.ts }
  - unit: { kind: file, path: platform/services/statecraft/api/factory/overrideQuarantineEnforcement.test.ts }
  - unit: { kind: file, path: platform/services/statecraft/api/factory/overrideScanStructure.test.ts }
extends:
  # Spec adds always bump the featuregraph golden (corpus convention —
  # specs 190/194/195 carry the same edge).
  - spec: "034-featuregraph-registry-scanner-fix"
    nature: additive
    unit: { kind: file, path: crates/featuregraph/tests/golden/features_graph.json }
refines:
  # The write-path class the FR-013(a) gate already covers — every accepted
  # revision enqueues a scan (FR-001):
  - aspect: "override-write-async-scanning"
    unit: { kind: file, path: platform/services/statecraft/api/factory/artifacts.ts }
  - aspect: "override-write-async-scanning"
    unit: { kind: file, path: platform/services/statecraft/api/factory/conflicts.ts }
  - aspect: "override-write-async-scanning"
    unit: { kind: file, path: platform/services/statecraft/api/agents/catalog.ts }
  # FR-006 — verify-override refuses while the revision is quarantined:
  - aspect: "verify-quarantine-interplay"
    unit: { kind: file, path: platform/services/statecraft/api/factory/artifacts.ts }
  # FR-003 — consumed-override content hashes join the revocation sweep at
  # serve (bundle assembly) and grant issue/renew:
  - aspect: "consumed-override-revocation-sweep"
    unit: { kind: file, path: platform/services/statecraft/api/factory/admission.ts }
  - aspect: "consumed-override-revocation-sweep"
    unit: { kind: file, path: platform/services/statecraft/api/factory/grantDuplexHandlers.ts }
  # …including the approval summary's inline parity replica of the
  # consumed-overrides query (cycle-avoidance keeps it from importing
  # collectConsumedOverrides, so it is a second extension site):
  - aspect: "consumed-override-revocation-sweep"
    unit: { kind: file, path: platform/services/statecraft/api/factory/approvalSummary.ts }
  # FR-004 — mode-sensitive lift for content-hash quarantines:
  - aspect: "content-hash-quarantine-lift-mode"
    unit: { kind: file, path: platform/services/statecraft/api/factory/revocations.ts }
  # FR-003(c) — the exact read-path units serving user-authored agent
  # content, named by the implementing PR as the FR prescribes:
  - aspect: "consumed-override-revocation-sweep"
    unit: { kind: file, path: platform/services/statecraft/api/factory/runAgentRefs.ts }
  - aspect: "consumed-override-revocation-sweep"
    unit: { kind: file, path: platform/services/statecraft/api/factory/runs.ts }
  - aspect: "consumed-override-revocation-sweep"
    unit: { kind: file, path: platform/services/statecraft/api/projects/opcBundle.ts }
  # FR-008 — scan-run table + audit vocabulary ride the shared schema:
  - aspect: "scan-run-records"
    unit: { kind: file, path: platform/services/statecraft/api/db/schema.ts }
  # AC-8 — DB-bound suites join the spec 211 encore-test lane (the
  # exclude list IS the lane assignment):
  - aspect: "encore-test-lane-assignment"
    unit: { kind: file, path: platform/services/statecraft/vite.config.ts }
  # FR-001 — the scan-request topic must be declared in the self-host
  # infra configs (encore build fails closed on undeclared topics):
  - aspect: "override-scan-topic-declaration"
    unit: { kind: file, path: platform/services/statecraft/infra.config.json }
references:
  - role: context
    unit: { kind: file, path: platform/services/statecraft/api/factory/overrideGate.ts }
  - role: context
    unit: { kind: file, path: docs/owasp-agentic-top-10-2026.md }
  - role: analog
    unit: { kind: file, path: platform/services/statecraft/api/knowledge/extractionCore.ts }
---

# Feature Specification: Substrate Override Async Scanner

**Feature Branch**: `200-substrate-override-async-scanner`
**Created**: 2026-06-10
**Refined**: 2026-06-12 (sketch → implementable FRs; design findings below)
**Status**: Draft (follow-on stub filed by spec 198 phase 5, AC-7; implementation
gated on spec 198 `implementation: complete` — see §Sequencing)
**Input**: Spec 198 FR-013(d) names this spec as the asynchronous,
model-assisted leg of the `user_body` write contract. FR-013(a–c) — the
deterministic gate, provenance stamping, and the verified-flag trust class —
landed with spec 198; this spec owns what rules cannot express.

## Purpose

The deterministic gate (spec 198 FR-013 a, `overrideGate.ts`) refuses
carrier classes a regex can name: zero-width/bidi characters, hidden
comments, data URIs, encoded blobs, ANSI escapes, secret shapes. It cannot
name *semantic* poisoning: an override that subtly redirects an agent's
goal, weakens a verification instruction, or plants a plausible-looking
falsehood an LLM downstream will trust (ASI06 — memory and context
poisoning). Detection of that class is a judgment task, and judgment is
exactly what must never block synchronously (untrusted-model-output
composing with untrusted input). Hence the architecture spec 198 fixed:

> A model may **detect**; only rules may **block**.

## Design findings (2026-06-12 refinement)

Four facts about the as-built machinery shape the FRs; the sketch assumed
the first two away.

1. **Quarantine rows on override hashes are inert today.** The sketch's
   AC-2 assumed "serve/bind/grant paths refuse it with the existing FR-010
   errors". They do not: `collectConsumedOverrides`
   (`admission.ts:804–853`) enforces only the verified predicate, and the
   grant sweep (`grantDuplexHandlers.ts::sweepCompositionRevocations`)
   sweeps only admission-composition hashes — envelope, adapter manifests,
   agent digests, all pinned at admission time from *upstream* bytes. An
   override's content hash (`sha256(user_body)`, stamped by
   `applyOverrideCore`) appears in neither set. A scanner quarantine would
   be recorded and never enforced. **FR-003 closes this** — and is pure
   rule-layer work, valuable even before the model leg exists (it makes
   *manual* content-hash quarantines on overrides effective).
2. **The lift path over-blocks for the scanner's class.**
   `revocations.ts::liftRevocation` hard-refuses lifting any content-hash
   revocation ("fixed upstream bytes carry a new hash and re-enter via
   normal admission"). That rationale holds for upstream content, where a
   fix is by definition new bytes. It does not hold for a scanner false
   positive on an override: the *same* bytes are the desired state, and
   re-submitting them reproduces the same hash — still quarantined. Without
   a lift path, one false positive permanently bricks that content for the
   org. **FR-004 makes the lift mode-sensitive**, restoring spec 198
   FR-010's own contract ("reintegration from quarantine requires fresh
   two-sided validation plus human approval") for the quarantined mode
   while keeping `revoked` content-hash rows never-liftable.
3. **The policy slice precedent is project-scoped; the substrate is
   org-scoped.** Spec 115's `extractionPolicy.ts` resolves
   `build/policy/projects/{projectId}.json`; substrate rows carry only
   `org_id`. The scanner needs an org-scoped slice (**FR-005**), with the
   same deterministic fail-closed fallback: no policy → no model call →
   visible, audited skip.
4. **New audit actions need a constraint migration.** The spec 198
   correction (migration 46) exists because audit-action vocabulary
   widening was missed and the covering tests were outside CI. This spec
   adds scan-outcome actions to `ArtifactAuditAction`; the implementing PR
   MUST widen the `factory_artifact_substrate_audit` check constraint in
   the same migration, and the covering suites are DB-bound — they run in
   the spec 211 encore-test lane, which now gates merge.

## Functional requirements

- **FR-001 — Async dispatch with durable intent.** Every accepted
  `user_body` revision across the FR-013 write-path class —
  `artifacts.ts::applyOverrideCore`, the `conflicts.ts` `edit_and_accept`
  arm, and the user-authored agent writes in `agents/catalog.ts` (the same
  three call-sites as `assertOverrideGate`) — produces a scan run. Shape
  mirrors the spec 115 extraction pipeline (Topic + Subscription + run row
  + idempotency + staleness sweeper): a `factory_override_scan_runs` row
  (org, artifact, content hash, scanner/prompt version, status
  `queued|running|completed|failed|skipped`, verdict, rationale, cost,
  attempts, `last_event_at`) is inserted **inside the write transaction**
  (durable intent — deterministic bookkeeping, not model judgment); the
  PubSub publish (`factory-override-scan-request`, at-least-once) happens
  after commit; a cron sweeper re-drives queued rows whose publish was
  lost and fails stale `running` rows
  (`STATECRAFT_OVERRIDE_SCAN_STALE_AFTER_SEC`, default 600). Idempotency:
  an existing `queued|running|completed` run for `(org, artifact,
  content_hash, scanner_version)` within the dedupe window absorbs
  re-enqueues; `skipped` and `failed` runs do NOT absorb, so a revision
  re-saved after a budget grant gets a fresh scan (retroactive
  scan-on-grant of untouched content is out of scope — the audited skips
  are the operator's worklist). `scanner_version` subsumes the prompt
  registry version: a prompt-only update bumps it, so post-update
  re-enqueues are not deduped against pre-update runs. The write path's
  latency gains one row insert and NEVER waits on — or can be failed
  by — scanner judgment; the model client is imported only by the
  worker.
- **FR-002 — Quarantine-only outcome, rule-shaped.** A `flagged` verdict
  inserts a `factory_revocations` row (`scope_kind='content-hash'`,
  `key=<the run row's content hash>`, `mode='quarantined'`, `actor=NULL`
  service provenance, `reason` carrying scanner id + version, run id, and
  the model rationale as recorded evidence) plus a substrate audit row.
  The model's output selects between exactly two outcomes (clean /
  flagged); **the quarantine key comes from the run row, never from model
  output** — a poisoned rationale cannot aim the quarantine at a different
  artifact. Enforcement is entirely the rule layer's (FR-003); the scanner
  holds no enforcement surface of its own.
- **FR-003 — Enforcement: override hashes join the revocation sweep.**
  (a) `collectConsumedOverrides` additionally sweeps the collected
  override content hashes against unlifted content-hash revocations and
  refuses the serve fail-closed on any hit, mirroring the verified-
  predicate refusal; the spec 201 approval summary replicates this query
  inline (cycle-avoidance keeps `approvalSummary.ts` from importing it),
  so the same sweep MUST be added to that parity replica — extending the
  shared helper alone does not cover it. (b) Grant issuance/renewal extends its
  content-hash key set with the active override hashes for the org's
  admitted origin — propagating a quarantine into in-flight runs within
  one stage boundary, per spec 198's contract. (c) The serve path for
  user-authored agent content applies the same sweep; the implementing PR
  names the exact read-path units and adds their `refines:` edges in the
  same change.
- **FR-004 — Human reintegration; mode-sensitive lift.** Lifting becomes
  mode-aware for content-hash rows: `mode='revoked'` stays never-liftable
  (upstream rationale intact); `mode='quarantined'` is liftable only by an
  authenticated human with `factory:configure`, and the lift re-runs the
  deterministic gate (`runOverrideGate`) over the current revision as the
  fresh-validation leg — the row remains/returns `unverified`, so
  consumption under `overrides.require_verified` still demands a human
  verify (the two-sided reintegration spec 198 FR-010 prescribes). The
  scanner's service identity cannot lift (no authenticated session;
  `actor=NULL` provenance is rejected as a lifter by construction), and a
  clean re-scan is advisory evidence only — recorded on the run row,
  never auto-lifting.
- **FR-005 — Cost and policy gates, org-scoped.** Model invocation honours
  an org policy slice resolved from a compiled snapshot
  (`build/policy/orgs/{orgId}.json`; `STATECRAFT_OVERRIDE_SCAN_POLICY_DIR`
  override) with shape `{ scanAllowed, modelPin?, costCeilingUsdPerCall,
  costCeilingUsdPerDay }`, 30s cache, and a deterministic fallback of
  scanning-disabled. Disabled or over-ceiling → the run row completes
  `skipped` with an audited reason — absence of scanning is visible,
  never silent. Pre-flight per-call estimate and day-aggregate ceilings
  follow the spec 115 agent-extractor precedent (`agent-base.ts` cost
  gates), including its soft-ceiling posture stated here explicitly:
  the day aggregate counts committed costs only (no reservation), so
  concurrent in-flight scans may overshoot the daily ceiling by at most
  the sum of in-flight per-call estimates — accepted, with actual spend
  recorded per run row.
- **FR-006 — Verified-flag interplay.** Scanning is orthogonal to the
  FR-013(c) verified flag, and quarantine wins: the FR-003 sweep checks
  the hash regardless of `user_body_verified` (a quarantine on a verified
  override stands, fail-closed); `verifyOverrideCore` refuses
  (`failedPrecondition`, naming the revocation) while an unlifted
  quarantine names the row's current content hash — verification of a
  quarantined override is refused until the quarantine lifts.
- **FR-007 — Model invocation discipline.** The worker invokes a pinned
  model (policy `modelPin`, else a fixed default) with **no tools**
  (`assertNoTools` precedent), a versioned prompt from a registry with a
  recorded `promptFingerprint` (spec 115 FR-020 shape), and a structured
  verdict contract (`clean|flagged` + rationale). The override body is
  untrusted input and the rationale is untrusted output: it is stored and
  displayed as provenance-attached evidence, never parsed into further
  actions. Scanner failures retry within the worker's at-least-once
  delivery; exhausted retries land `failed` with the error recorded —
  a failed scan is visible and never blocks anything.
- **FR-008 — Audit vocabulary + constraint migration.**
  `ArtifactAuditAction` gains `artifact.scan_flagged`,
  `artifact.scan_clean`, `artifact.scan_skipped`, and
  `artifact.scan_failed`; the same migration widens the
  `factory_artifact_substrate_audit` action check constraint (the
  migration-46 lesson). DB-bound covering suites run in the spec 211
  encore-test CI lane.

## Acceptance criteria

- **AC-1.** A `user_body` write returns before any model work begins; the
  scan run row rides the write transaction; a lost publish is re-driven
  and a stale `running` row is failed by the sweeper (restart survival
  evidence). The model client module is imported only by the worker.
- **AC-2.** A seeded poisoning fixture produces a `factory_revocations`
  quarantine row naming the revision's content hash with recorded
  rationale; bundle assembly refuses the serve and grant issue/renew
  refuses the run, both with FR-010-class fail-closed errors naming the
  artifact.
- **AC-3.** No code path exists in which scanner output synchronously
  rejects a write (negative test posture: write-path modules hold no
  await on scan verdicts; the gate's rule set is untouched by this spec).
- **AC-4.** Lifting a scanner quarantine requires a human actor with
  `factory:configure`; the lift re-runs the deterministic gate and leaves
  the row unverified; a `revoked`-mode content-hash lift is still
  refused; no service-identity lift path exists.
- **AC-5.** `verify-override` on a quarantined revision is refused with an
  error naming the active revocation; after a human lift it succeeds.
- **AC-6.** With no org policy snapshot (or `scanAllowed: false`), a write
  produces a `skipped` run row and an `artifact.scan_skipped` audit row,
  and no model call occurs (suite runs without `ANTHROPIC_API_KEY`).
- **AC-7.** An adversarial fixture whose body instructs the scanner to
  quarantine a *different* artifact yields, at most, a quarantine of the
  fixture's own content hash — the key is provably sourced from the run
  row.
- **AC-8.** The DB-bound suites for FR-001/FR-003/FR-004/FR-008 execute in
  the spec 211 encore-test lane (lane-coverage guard lists them), and the
  audit-action constraint migration applies cleanly up and down.

## Out of scope

- The deterministic gate rules (spec 198 FR-013 a owns them; new
  rule-expressible classes graduate INTO `overrideGate.ts`, not here).
- Scanning upstream factory content (admitted via the spec 198 envelope;
  upstream trust is the admission gate's job).
- Knowledge-object extraction scanning (spec 115's pipeline owns its own
  content classes).
- A dedicated quarantine-review UI beyond the existing revocations
  endpoints and spec 201 approval surfaces (a follow-on may add one; the
  lift/verify contracts here are UI-agnostic).

## Open questions

- **OQ-1 — org-slice emission home.** Whether the policy compiler (spec
  047 / `tools/oap/policy-compiler`) grows an org-level output alongside
  `build/policy/projects/`, or the org slice starts as a hand-deployed
  snapshot consumed by the FR-005 resolver. Resolve in plan.md; the
  resolver contract above is fixed either way.
  **Resolved interim (2026-06-12, implementing PR):** the org slice starts
  as a hand-deployed snapshot at `build/policy/orgs/{orgId}.json`
  (`STATECRAFT_OVERRIDE_SCAN_POLICY_DIR` override). The resolver's
  fail-closed fallback makes the absent-snapshot state safe and audited
  (`skipped` runs are the operator's worklist). Growing the policy
  compiler an `orgs/` output remains open under spec 047's ownership —
  the resolver contract is unchanged when it lands.

## Phasing (proposed; refine in plan.md)

1. **Rules first (no model).** FR-003 sweep extension + FR-006 verify
   interplay + FR-004 mode-sensitive lift. Independently valuable: manual
   content-hash quarantines on overrides become enforceable end-to-end.
2. **Dispatch machinery.** FR-008 migration, run-row table, enqueue hooks
   at the three write sites, worker + sweeper with FR-005 policy
   resolution — landing as a visible no-op (`skipped`) until a policy
   grants budget.
3. **Model leg.** FR-007 prompt registry + client + verdict contract;
   FR-002 quarantine insertion; AC-2/AC-7 fixtures.
4. **CI hardening.** AC suites wired into the encore-test lane; negative
   posture checks (AC-3) in the vitest lane.

## Sequencing

Implementation is gated on spec 198 reaching `implementation: complete`
(first sealed admission + grant chain verified end-to-end), so the
quarantine machinery this spec leans on is runtime-proven first.

Gate status as of 2026-06-12: the first sealed admission landed 2026-06-11
(spec 198 implementation log; record `7cf82fae…`, seal verified against
the published JWKS); the end-to-end grant-chain verification is not yet
recorded, and spec 198 remains `implementation: in-progress`. This
refinement is the pre-implementation step the draft staged for itself
("refine before implementation"); phase 1's rule-layer work becomes
eligible the moment the gate discharges.

**Gate discharged (2026-06-12, later the same day):** spec 198 flipped
`implementation: complete` (its tasks.md gate — Statecraft-side envelope
merge + first real ADMIT — was met by the sealed admission above; the
flip records AC-5's bundle-boundary posture and the live-run AC-4
caveat honestly in its implementation log). Implementation proceeded in
the same session; see §Implementation log.

## Implementation log

- **2026-06-12 — full implementation lands; `implementation: complete`.**
  All four phases in one PR, in the spec's order:
  *Rules first* — FR-003(a) `collectConsumedOverrides` sweeps consumed
  override hashes (quarantine checked BEFORE the verified predicate;
  quarantine wins per FR-006), with the same sweep added inline to the
  spec 201 approval-summary parity replica; FR-003(b)
  `sweepCompositionRevocations` extends its content-hash key set with the
  org's active override hashes; FR-003(c) named the user-authored serve
  paths — `runAgentRefs.ts` (run resolution; new `QuarantinedAgentError`
  mapped to `failedPrecondition` in `runs.ts`) and
  `opcBundle.ts::loadPublishedAgents` (bundle assembly) — and their
  `refines:` edges ride this frontmatter; FR-004 `liftRevocation` is
  mode-sensitive (core split out as `liftRevocationCore` for the
  encore-test lane; `revoked` stays never-liftable, `quarantined` lifts
  re-run `runOverrideGate` over the current body and reset the rows to
  unverified); FR-006 `verifyOverrideCore` pre-flights the quarantine.
  *Dispatch machinery* — migration 47 (run-row table + audit-constraint
  widening in ONE migration, the migration-46 lesson), durable intent via
  `recordOverrideScanIntent` inside all four write transactions
  (`applyOverrideCore`, `edit_and_accept`, agent create + patch),
  post-commit publish, staleness sweeper cron (re-drives lost publishes,
  fails stale running rows).
  *Model leg* — worker-only model client (`overrideScanWorker.ts` is the
  single importer; the invoker is dependency-injected into
  `runOverrideScanWork` so the core stays model-free), versioned prompt
  registry with fingerprint, strict two-outcome `parseScanVerdict`,
  org-scoped fail-closed policy resolver, soft day-ceiling on committed
  costs, quarantine key sourced from the run row (AC-7).
  *CI hardening* — both DB-bound suites registered in the vite.config.ts
  exclude list (spec 211 lane derives coverage from it); structural AC-3
  suite in the vitest lane. Evidence: encore-test lane 23 files / 140
  tests green locally (`--fileParallelism=false`), bare-vitest lane 59
  files / 606 tests green, `tsc --noEmit` clean. `scanner_version`
  composes code + prompt versions (`1+prompt.1`). Status stays `draft`
  pending ratification (corpus precedent: 199/201/211).
