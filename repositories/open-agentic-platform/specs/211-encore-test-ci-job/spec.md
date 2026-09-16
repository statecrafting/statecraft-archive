---
id: "211-encore-test-ci-job"
title: "Encore-Test CI Job (ASI09 verification integrity — the encore-test CI gap, closed)"
feature_branch: "feat/211-encore-test-ci-job"
status: approved
implementation: complete
kind: governance
domain: tooling
created: "2026-06-11"
amended: "2026-06-12"
amendment_record: |
  self-amended (2026-06-12) — implementation PR. The first-ever execution
  of the encore lane validated this spec's premise harder than its text
  anticipated: 11 of the 22 DB-bound files failed on accumulated rot
  (dropped-table seeds from the spec 139 migrations 34/35, a never-valid
  projects.created_by omission in the spec 137 suites, a stale enum
  literal in spec 115's seed, mock-runtime assumptions in spec 143's
  suite) — none of it ever visible because nothing ran the lane. FR-001
  is refined from "full suite minus check.test.ts" to the DB-bound set
  derived from the vite.config.ts exclude list (the two lanes partition
  the suite; pure suites already gate in ci-statecraft.yml, and
  mock-runtime suites like storage.dualClient.test.ts are bare-lane by
  design). FR-002's fast-lane decision is recorded: strict-only. Adds
  establishes: edges for the lane, the coverage-guard script, and the
  parity fixtures; implementation flipped pending → in-progress. See
  §Implementation log. Completion flip (in-progress → complete) rode the
  follow-up commit after the lane went green on main — see
  §Implementation log "FR-005 discharged".
authors: ["open-agentic-platform"]
language: en
summary: >
  Close the encore-test CI gap: the bare-vitest exclude list in
  statecraft's vite.config.ts assigns 22 DB-bound test files (specs 115,
  124, 137, 139–143, 198, 201) to the `encore test` lane, but no CI job
  runs that lane — CI runs bare vitest only, so DB-bound acceptance
  suites never execute before merge. The gap already shipped a real
  violation invisibly (spec 198's FR-013 correction note: audit INSERTs
  violating a live check constraint, covered by a test CI never ran).
  This spec adds an enforcing encore-test CI job dispatched from the
  spec-177 orchestrator, a Makefile mirror per the spec-104 parity
  contract, and a lane-coverage guard so a file excluded from bare
  vitest cannot silently skip both lanes. Its completion is the named
  trigger for spec 198's ASI09 row flipping to "Solid" and spec 201's
  implementation flipping to complete.
code_aliases: ["ENCORE_TEST_CI_JOB"]
compliance:
  - framework: "owasp-asi-2026"
    controls: ["ASI09"]
depends_on:
  - "104-makefile-ci-parity-contract"
  - "135-fast-ci-as-default"
  - "177-ci-orchestrator-pr-gate"
  - "198-factory-governance-envelope"
  - "201-anti-blind-approval-ui"
establishes:
  # The enforcing DB-bound lane (FR-001/FR-004), dispatched from the
  # spec-177 orchestrator. Same establishes shape as specs 191/212.
  - unit: { kind: file, path: .github/workflows/ci-statecraft-encore.yml }
  # The lane-coverage guard (FR-003): derives the DB-bound set from the
  # vite.config.ts exclude list and cross-checks reporter output so a file
  # can never silently skip both lanes.
  - unit: { kind: file, path: platform/services/statecraft/scripts/encore-test-lane.mjs }
  # The ci-parity-check aligned/divergent fixtures proving the run-mirror
  # detects a missing ci-statecraft-encore mirror (AC-4) — spec 191/212
  # precedent.
  - unit: { kind: file, path: tools/oap/ci-parity-check/tests/fixtures/aligned/.github/workflows/ci-statecraft-encore.yml }
  - unit: { kind: file, path: tools/oap/ci-parity-check/tests/fixtures/divergent/.github/workflows/ci-statecraft-encore.yml }
extends:
  # The spec-177 orchestrator gains a route dispatching the new job
  # (same shape as spec 191's ci-schema-parity route).
  - spec: "177-ci-orchestrator-pr-gate"
    nature: additive
    unit: { kind: file, path: .github/workflows/ci.yml }
  # The new workflow is classified enforcing in ci-parity-check's
  # ENFORCING_WORKFLOWS so the Makefile↔CI run-mirror covers it.
  - spec: "104-makefile-ci-parity-contract"
    nature: additive
    unit: { kind: file, path: tools/oap/ci-parity-check/src/lib.rs }
  # The aligned ci-parity-check fixture Makefile gains a mirroring recipe
  # so the new enforcing workflow's run-mirror fixture stays green (spec
  # 212 precedent; 104 owns the ci-parity-check crate subtree).
  - spec: "104-makefile-ci-parity-contract"
    nature: additive
    unit: { kind: file, path: tools/oap/ci-parity-check/tests/fixtures/aligned/Makefile }
  # Same precedent as specs 196, 194, 193, 187, 183 and the 202–210
  # batch: a new spec adds a row to the featuregraph golden.
  - spec: "034-featuregraph-registry-scanner-fix"
    nature: additive
    unit: { kind: file, path: crates/featuregraph/tests/golden/features_graph.json }
co_authority:
  # The root Makefile gains a `ci-statecraft-encore` target group (the
  # `## tag: ci-statecraft-encore` section) wired into the ci-strict
  # family. 104 is the omnipresent Makefile-parity co-author (same shape
  # as specs 116/212 use for their anchors).
  - with_specs:
      - "104-makefile-ci-parity-contract"
    unit: { kind: section, file: Makefile, anchor: ci-statecraft-encore }
references:
  # The lane assignment this spec enforces coverage of. The
  # `encore-test-gating` aspect of this file is owned by spec 201; this
  # spec consumes the exclude list as input, it does not reshape it.
  - role: context
    unit: { kind: file, path: platform/services/statecraft/vite.config.ts }
  # The sibling workflow whose pinned encore CLI version and npm setup
  # the new job mirrors.
  - role: context
    unit: { kind: file, path: .github/workflows/ci-statecraft.yml }
  - role: context
    unit: { kind: file, path: docs/owasp-agentic-top-10-2026.md }
---

# Feature Specification: Encore-Test CI Job

**Feature Branch**: `211-encore-test-ci-job`
**Created**: 2026-06-11
**Status**: Draft (files the last acknowledged-but-unfiled item from the
ASI 2026 gap-closure pass)
**Input**: Spec 198's FR-013 correction note and ASI09 table row, and
spec 201's phase-4 closeout amendment, all name "the encore-test CI gap,
discovered 2026-06-11" as a process follow-up tracked outside any spec.
This spec is that follow-up, filed.

## Purpose

Statecraft's test suite is split into two lanes by
`platform/services/statecraft/vite.config.ts`: pure suites run under
bare vitest (what `npm test` and CI execute), and DB-bound suites —
excluded under bare vitest — run only under `encore test`, which sets
`ENCORE_RUNTIME_LIB` and provisions per-test databases. The exclude
list currently assigns 22 files across ten specs (115, 124, 137,
139–143, 198, 201) to the encore lane. No CI job runs that lane.

The consequence is structural, not hypothetical: a spec's DB-bound
acceptance suites can be written, pass locally, and then silently stop
protecting anything, because nothing in the merge path ever executes
them. Spec 198's FR-013 correction note records the proven instance —
the phase 5 implementation emitted audit actions that violated the
migration-32 check constraint on every real-database INSERT, the
covering test (`overrideTrustClass.test.ts`) was encore-test-gated, and
the violation shipped invisibly. A verification loop with an
unexercised lane is the same defect OAP's own gates exist to prevent: a
covenant without a gate decays (spec 209's framing, applied to OAP
itself).

The gap is also the named blocker for two documented lifecycle flips:
spec 198's ASI09 row reads "'Solid' awaits spec 201 AC-1–AC-5 verified
**in CI**", and spec 201 holds `implementation: in-progress` solely
because its DB-bound AC suites cannot run in CI. ASI09 (Human-Agent
Trust) is the driving control — a human approving on the basis of AC
suites that never run is exactly the blind trust the control names —
and the fix is continuous-validation discipline applied to OAP's own
verification loop.

## Functional requirements (sketch — refine before implementation)

- **FR-001 — Enforcing encore-test workflow.** A reusable workflow
  (working name `ci-statecraft-encore.yml`) dispatched from the
  spec-177 orchestrator on the statecraft route, running `encore test`
  with the same pinned Encore CLI version the existing
  `ci-statecraft.yml` installs for codegen, so the vite-config encore
  lane (the full suite minus `check.test.ts`) executes against
  Encore-provisioned per-test databases. A red lane fails the PR
  through the spec-177 gate composition, and runs identically in
  `merge_group`.
- **FR-002 — Makefile mirror per the parity contract.** A
  `make ci-statecraft-encore` target mirrors the workflow recipe; the
  workflow is classified in `ci-parity-check`'s `ENFORCING_WORKFLOWS`
  (spec 104) with aligned/divergent fixtures proving drift detection;
  the target joins `make ci-strict`. Whether it also joins the fast
  `make ci` lane is a measured spec-135 decision — only if warm runtime
  fits the ~5-minute budget; otherwise strict-only, with the
  measurement recorded.
- **FR-003 — Lane-coverage guard (skip-as-pass forbidden).** The two
  lanes must partition the suite, not leak: a guard asserts that every
  file in the bare-vitest exclude list actually executed in the encore
  lane (reporter output cross-checked against the exclude list, or an
  equivalent executed-file assertion). A DB-bound file skipped in both
  lanes is a CI failure naming the file — the spec 200 FR-004 /
  spec 209 FR-005 posture, applied to OAP's own test surface.
- **FR-004 — Runtime provisioning, fail-visible.** The job provisions
  the encore daemon and test databases on the hosted runner; a
  provisioning failure (daemon unreachable, image pull, migration
  error) fails with the cause surfaced, never skipped-green. No
  external network reliance beyond pinned tool installs (spec 158
  SHA-pinning applies to any new action refs).
- **FR-005 — The named trigger, discharged.** When the spec 201 AC
  suites (`approvalSummaryEndpoint.test.ts`) and the spec 198 FR-013
  suites (`overrideTrustClass.test.ts`, `grantDuplexHandlers.test.ts`)
  run green in this job, the flips those specs document fire: spec
  198's ASI09 row → "Solid"; spec 201 `implementation:` → `complete`.
  This spec's completion is the precondition both texts cite.

## Acceptance criteria (sketch)

- **AC-1.** A PR run executes `approvalSummaryEndpoint.test.ts` and
  `overrideTrustClass.test.ts` in CI and their results gate merge — the
  named trigger for the spec 198/201 flips is mechanically dischargeable.
- **AC-2.** Every file in the bare-vitest exclude list executes in the
  encore lane; removing a file from both lanes turns CI red naming the
  file (lane-coverage guard proven by fixture or seeded mutation).
- **AC-3.** A seeded DB-bound violation of the class that shipped
  invisibly (e.g. reverting the migration-46 constraint widening from
  spec 198's correction note) fails the PR.
- **AC-4.** `ci-parity-check` is green with the new workflow classified
  enforcing: the Makefile mirror exists, and the divergent fixture
  proves drift detection.
- **AC-5.** The job runs in `merge_group` with the same blocking
  semantics as on PRs (spec 177's gate composition, no PR-only carve-out).

## Out of scope

- **Lane assignment.** Which suites are DB-bound is owned by each
  suite's spec; the vite.config.ts `encore-test-gating` aspect is
  spec 201's. This spec enforces coverage of the assignment, it does
  not move files between lanes.
- **Restructuring `ci-statecraft.yml`'s existing jobs.** The bare-vitest
  job stays as-is; this spec adds a sibling lane, not a rewrite.
- **Tenant-side CI** (spec 209 owns the produced-app analog).
- **Changing the `make ci` default composition** (spec 135 owns the
  fast-lane budget; FR-002 records the decision rule, not a new
  default).

## Sequencing

Implementable now — every dependency is landed machinery: the Encore
CLI is already version-pinned in CI for codegen, the exclude-list lane
assignment is live, and the spec-177 orchestrator already routes
statecraft changes. Completion is the named trigger for spec 198's
ASI09 "Solid" flip and spec 201's `implementation: complete` (both
texts cite this spec). Per the gap-batch convention, relationship edges
above point only at verified existing paths; `establishes:` edges for
the new workflow file and its parity fixtures ride the implementation
PR that creates them (the spec 191 precedent).

## Implementation log (2026-06-12)

### The first run proved the premise — at scale

The first-ever execution of the encore lane (local, Encore CLI 1.57.8 —
the same version CI pins) found **11 of the 22 DB-bound files failing on
accumulated rot**, every instance invisible until now because nothing in
the merge path ran the lane. By error class:

1. **Dropped-table seeds** — the spec 124 quartet
   (`runsMigration`, `runs`, `runDuplexHandlers`, `runsScheduler`) and
   the spec 139 trio (`agentCatalogMigration.dryrun`, `dispatch`,
   `createOapNative`) seeded `factory_adapters` / `factory_processes` /
   `agent_catalog` / `project_agent_bindings`, all dropped by
   migrations 34/35 (the spec 139 substrate cutover, 2026-05-05). The
   `runs.test.ts` suite additionally pre-dated the spec 199 reservation
   rewrite (substrate + spec 198 admission resolution).
   (Update 2026-06-27: `createOapNative.test.ts` was deleted and removed
   from the `vite.config.ts` exclude list. The OAP-native adapter concept
   it exercised (`next-prisma`, the retired `scaffold_source_id` JSONB
   probe) is dead: factory-encore + template-encore are OAP's native
   factory implementation. Of the spec 139 trio above, only `dispatch`
   now remains in the live encore lane (`agentCatalogMigration` became a
   pure-functional bare-lane test during this spec's implementation, and
   `createOapNative` is now deleted); the lane-coverage guard derives the
   set from the exclude list, so the count adjusts automatically.)
2. **Never-valid seeds** — the spec 137 migration suites (`40_`, `41_`)
   insert `projects` rows without `created_by`, NOT NULL since
   migration 5. These suites never passed under `encore test` at all —
   written, excluded from bare vitest, and trusted.
3. **Stale enum literal** — spec 115's
   `listKnowledgeObjects.integration` seeded
   `knowledge_extraction_run_status = 'succeeded'`, not a value of the
   enum.
4. **Mock-runtime assumptions** — spec 143's `requestUpload.integration`
   called the `api()` wrapper directly (null auth context under the real
   runtime) and presumed live S3; repaired with an explicit auth mock
   and a presign stub, DB assertions unchanged.

Fixing the hook failures exposed a second layer the first run couldn't
reach: (5) **dependency-upgrade rot** — drizzle-orm now wraps query
failures in `DrizzleQueryError`, so every
`.rejects.toThrow(/constraint-name/)` assertion in the migration suites
matched nothing; repaired by asserting `cause.constraint`, which is
stricter than the original regexes. And (6) **constraint-tightening
rot** — migration 41 tightened `enabled_requires_secrets` after the
migration-40 suite was written, so its enabled=true fixtures now
require the secret columns (the exact AC-3 class, observed in the
wild).

All repairs preserve the suites' pinned contracts against today's
schema, with these recorded exceptions: `runsMigration`'s
adapter-FK-rejection test pins a constraint migration 34 deliberately
removed (deleted; text-column behaviour covered by
`38_factory_id_columns_to_text.test.ts`);
`agentCatalogMigration.dryrun.test.ts` replays a one-time backfill
whose source tables no longer exist at HEAD (deleted, with its
exclude-list entry); and `runs.test.ts`'s two binding-centric cases
(retired-binding rejection, cross-project comparator) pin the
pre-spec-199 reservation path — spec 199's `byKind` process definitions
carry no embedded agent references, so `source_shas.agents[]` is
structurally empty through `reserveRunCore`; the binding/retired
semantics remain covered at the `runAgentRefs.ts` surface, and a new
case covering the spec-198 admission gate (the check that actually
guards reservations today) was added in their place.

### FR-001 refined: the lane runs the DB-bound set, not the full suite

The sketch said "the full suite minus `check.test.ts`". The first run
falsified that: bare-lane suites that exercise the bare-vitest mocks by
design (`storage.dualClient.test.ts` pins S3 endpoints via the
`encore.dev/config` env mock) fail under the real runtime, and pure
suites already gate in `ci-statecraft.yml` — running them twice buys
nothing. The lane therefore executes exactly the **DB-bound set**: the
bare-vitest exclude list minus the universal both-lane excludes
(`node_modules`, `dist`, `check.test.ts`), derived mechanically from
`vite.config.ts` by `scripts/encore-test-lane.mjs list`. This is the
partition FR-003 already named: bare vitest runs the pure suites, the
encore lane runs the DB-bound suites, nothing runs in neither.

### FR-003 as built

`encore-test-lane.mjs` enforces four failure modes, each naming its
subject: (a) a DB-bound exclude glob matching no file on disk (deleted
or renamed suite with a phantom entry); (b) a DB-bound file absent from
the encore run's JSON reporter output; (c) a DB-bound file present but
executing zero non-skipped tests (hook failure or skip-as-pass); (d) an
encore-side exclude entry beyond the universal allowlist — the AC-2
leak, where adding a file to both exclude lists would remove it from
both lanes; widening the allowlist requires editing the guard script
itself, making the decision a reviewable diff.

### Sequential file execution is part of the lane contract

Repeated runs surfaced two isolation flaws no single run could show:
`dispatch.test.ts` and `approvalSummaryEndpoint.test.ts` shared the same
fixture org/user ids (`88888888-…`), so one suite's substrate cleanup
destroyed the other's admitted envelope mid-run (re-keyed to a unique
family); and the migration-replay suites mutate corpus-wide state by
design — migration 36 inserts a synthetic manifest row for **every org
in the database**, so any concurrently-running suite's org-scoped
counts drift. The lane therefore runs vitest with
`--fileParallelism=false`: DB-bound suites sharing one database execute
sequentially. That is the correctness posture, not a tuning choice —
recorded here so nobody "optimises" it back. Verified: three
consecutive runs (fresh database + two reused) all green, 126 tests,
~10–15s per run.

### FR-004 as built: the lane runs unlinked from Encore Cloud

The first CI execution failed before any test ran: `encore test` on an
app linked to Encore Cloud (`encore.app` carries the app id) fetches
development secret values from `api.encore.cloud` at startup and
hard-fails unauthenticated. Authenticating CI to Encore's platform
would violate this spec's own FR-004 (no external network reliance
beyond pinned tool installs), so the lane strips the app id in the
runner's checkout before running — an unlinked app stays fully local.
Secrets resolve unset, which is sound for this lane: no DB-bound suite
reads real secret values (the spec-198 signing suites inject throwaway
keypairs via `process.env`; the S3-dependent paths are mocked or
bare-lane). Verified locally: the full DB-bound set is green with the
id stripped and no network access to the Encore platform. Local
`make ci-statecraft-encore` runs against the developer's own checkout,
where an `encore auth` session (or the same unlink) covers the gap.

### FR-002 decision: strict-lane only

Measured 2026-06-12 (M1 Pro, warm): the DB-bound set runs in well under
a minute including daemon startup — runtime would fit the spec-135
budget. The lane is strict-only anyway: it requires the Encore CLI and
a Docker daemon, dependencies `make ci` must not impose on the daily
loop. `make ci-statecraft-encore` joins `make ci-strict`; the decision
rule and measurement are recorded here per FR-002.

### FR-005 status

`approvalSummaryEndpoint.test.ts` (spec 201, 10 tests),
`overrideTrustClass.test.ts` (spec 198, 7 tests), and
`grantDuplexHandlers.test.ts` (spec 198, 17 tests) all pass in the
lane. The spec 198 ASI09 "Solid" flip and spec 201
`implementation: complete` flip fire once this lane is green on `main`
— a follow-up edit to those specs citing the live run, not part of this
PR.

### FR-005 discharged (2026-06-12, completion flip)

The lane merged to `main` in `a58755be` (PR #347). Live evidence: the
PR-lane run 27419049946 and the merge-queue validation run 27419855931
(`merge_group` — AC-5's posture, the encore lane executing against the
exact speculative tree that became `main`) both green: 126 tests across
the 21 DB-bound files, coverage guard confirming every file executed,
the three named-trigger suites among them. Accordingly, in one commit
citing this evidence and per the staged plan in all three texts: spec
198's ASI09 row flips to "Solid", spec 201's `implementation:` flips to
`complete`, and this spec's `implementation:` flips to `complete`.
