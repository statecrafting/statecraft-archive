# Implementation Plan: Org-Wide Agent Kill Switch and Quarantine

**Branch**: `feat/208-org-agent-kill-switch` | **Date**: 2026-06-24 | **Spec**: [spec.md](spec.md)
**Input**: Feature specification from `/specs/208-org-agent-kill-switch/spec.md`,
plus the 2026-06-24 seam survey of the four composition surfaces
(`grantDuplexHandlers.ts`, `sync/service.ts`, `live_sessions.rs`,
`db/schema.ts`) recorded under Pre-implementation decisions in
[tasks.md](tasks.md).

## Summary

Spec 208 adds one admin-gated org-scoped emergency stop that pauses agent
execution, refuses new sessions and grants, and revokes agent credentials,
with a stated propagation bound, a quarantine record, and a staged,
human-gated reintegration. The spec deferred two decisions to this plan:
**(1) the storage shape** (reuse `factory_revocations` scope kinds versus a
sibling table) and **(2) the duplex frame shape** for propagation. This
plan resolves both and records the architecture they imply: a dedicated
`org_halts` record that carries the halt finite-state machine and
per-engine acknowledgments, with **enforcement reusing the existing
fail-closed check sites** rather than minting a parallel mechanism.

## Storage decision (the question spec.md delegates here)

**Decision.** The halt record lives in a new **`org_halts`** table.
Enforcement (grant refusal, serve/bind refusal, session-registration
refusal) reuses the existing revocation check path by teaching
`grantPreflight` / `sweepCompositionRevocations`
(`grantDuplexHandlers.ts:363`) and the serve/bind callers of
`admission.isFactoryAdmitted` to **also consult active `org_halts` rows in
scope**. We do **not** mint `factory_revocations` rows for halts.

**Rejected: overloading `factory_revocations.scopeKind` with `org` /
`project` / `agent-profile`.** It is mechanically possible (the `key`
column is untyped `text`, so only the `scope_kind` CHECK constraint would
widen, `schema.ts:1141-1156`), and the spec's `extends: revocations.ts`
edge invites it. We reject it for two reasons:

1. **Semantic conflation.** The four revocation keys are admission-graph
   *node* types (factory / adapter / agent / content-hash). A halt is a
   *temporal org-scoped* emergency stop along an orthogonal dimension.
   Spec 198 was deliberate that "one mechanism, four keys" means four node
   types; adding three scope dimensions to the same enum erodes that.
2. **Shape mismatch.** FR-003 needs **per-engine acknowledgment
   timestamps** and FR-004 needs a **`reintegrating` substate distinct
   from `lifted`**. The `factory_revocations` row shape
   (`createdAt` / `liftedAt` / `liftedBy`, binary) cannot hold either
   without halt-only bolt-on columns that no revocation ever uses. A
   dedicated table is the honest home.

**How the `extends: revocations.ts` edge is honored.** The edge is
additive widening of the *fail-closed check path*, not of the row schema:
`sweepCompositionRevocations` gains an org-halt consult so the same
preflight that already refuses revoked admissions now also refuses
halted scopes. The `liftRevocationCore` human-actor gate
(`revocations.ts:152`, "a service identity cannot lift", spec 200 AC-4) is
the **pattern** the org-halt lift reuses, not the row it mutates.

## Propagation decision (the second deferred question)

**Decision.** The halt notice is an **outbox-durable org broadcast** via
`dispatchServerEvent` (`sync/service.ts:255`), not a targeted send. New
`ServerEnvelope` variants `org.halt.activated` / `org.halt.lifted` and a
`ClientEnvelope` variant `org.halt.ack` (spec 189 envelope-version bump;
schema-parity 125/191). Durability matters: `dispatchServerEvent` persists
to the outbox before fan-out, so an engine that reconnects after the
broadcast replays the halt on `sync.resync_request`
(`service.ts:102-105` -> `deliverResync:549`). The targeted
`sendTargetedServerEvent` (`service.ts:294`) is wrong here (it skips the
outbox by design).

## FR mapping

| FR | Mechanism | Primary seam |
|---|---|---|
| FR-001 halt verb + refusals | New `orgHalt.ts` writes `org_halts`; preflight + serve/bind + duplex registration consult it fail-closed | `grantDuplexHandlers.ts:363`, `admission.isFactoryAdmitted`, `sync/duplex.ts` register path |
| FR-002 credential revocation | Grant refusal at issuance/renewal (immediate); NHI cascade over `nhi_delegation_index` when spec 205 lands; degrade to grant + session until then | `grantPreflight:337-372`; spec 205 FR-004 index |
| FR-003 propagation bound | Outbox broadcast + per-engine `org.halt.ack` recorded as timestamps on the `org_halts` record | `dispatchServerEvent:255`; `handleInbound:76` ack dispatch |
| FR-004 quarantine record + reintegration | `org_halts` record lifecycle (`halted` -> `reintegrating` -> `lifted`; a scope is `active` when it has no non-`lifted` record); human-actor lift gate reusing the `liftRevocationCore` precedent; staged per-scope re-admission | `revocations.ts:152` (pattern), new `org_halts` state column |
| FR-005 drill | e2e pull-and-lift against `mock_statecraft` in the nightly lane | `product/apps/opc/tests-e2e/`, `opc-e2e-nightly.yml` |

## Technical Context

**Language/Version**: TypeScript (Encore.ts statecraft, npm) for the verb,
storage, enforcement, and propagation; Rust (OPC Tauri) for the
halt-aware termination path and the ack send; the featuregraph golden moves
on the spec frontmatter edit.
**Primary Dependencies**: existing run-grant fabric (spec 198 phase 4,
`grantDuplexHandlers.ts`), the org-scoped duplex (`sync/service.ts` +
`registry.ts`), the spec 172 checkpoint infrastructure (`CheckpointState`,
`live_sessions.rs:452-481`), the spec 187 e2e harness.
**Storage**: statecraft Postgres. New `org_halts` table (one migration);
no column change to `factory_revocations`. Per-engine acks are a JSONB
column on `org_halts` (1:many per halt, halt-local; a child table is
over-modeling for the access pattern).
**Testing**: statecraft DB-bound tests on the spec 211 encore-test lane
(the enforcement and ack suites are DB-bound, like
`grantDuplexHandlers.test.ts`); pure vitest for the selector/predicate
helpers; Rust unit for the `live_sessions.rs` halt path; the FR-005 drill
in `tests-e2e`.
**Target Platform**: platform services (K8s) for the verb/storage; OPC
desktop for the engine-side pause. OPC stays keyless (198 FR-014): it
receives a halt notice and acks; it mints nothing.
**Project Type**: web-service (platform control plane) + desktop-app
(engine-side termination).
**Performance Goals**: the halt enforcement adds exactly one indexed
`org_halts` liveness lookup per grant preflight (partial index on active
rows); the broadcast is O(connected engines) over the existing
`broadcastOrg` fan-out.
**Constraints**: the enforcement entry MUST be written before the
broadcast (FR-001 atomicity: a grant renewal racing the broadcast still
fails closed); the drill is a release-candidate gate (FR-005), not
optional.
**Scale/Scope**: O(1) active halts per org in the common case; O(10-100)
connected engines per org for the broadcast and ack collection.

### Known gaps and their carriers

- **Project-scoped NHI revocation needs a key the 205 index lacks.** The
  spec 205 `nhi_delegation_index` (its T007 shape) keys on `org_id`,
  `agent_profile`, `human_user_id`, `session_client_id` but **not
  `project_id`**. An `org`-scoped or `agent-profile`-scoped halt can sweep
  it directly; a `project`-scoped halt cannot until a project key is added.
  Carrier until then: run-grants are project-bound, so project-scoped
  credential revocation rides grant refusal (FR-002 degraded path), which
  is sufficient for AC-2/AC-3. A project key on the 205 index is a
  coordination item, not a 208 blocker.
- **Session registration refusal seam is in `duplex.ts`, not
  `service.ts`.** The seam survey confirmed `register`/`unregister` live in
  `api/sync/duplex.ts` (the Encore duplex endpoint), which
  `service.ts` does not own. FR-001's "new agent sessions refused at duplex
  registration" lands in `duplex.ts`; the exact line is confirmed at
  implementation (the survey read `service.ts`/`registry.ts`, not
  `duplex.ts`).
- **Horizontal scale-out.** `registry.ts:9-13` documents that the
  in-memory registry needs PubSub/Redis fan-out for multi-replica. The
  outbox-durable broadcast (the propagation decision) is replica-safe for
  *delivery on reconnect*; live fan-out across replicas inherits the
  existing registry limitation and is out of scope here (it is a
  registry-wide concern, not a halt-specific one).
- **Migration number.** The highest landed migration as of 2026-06-24 is
  `52_audit_two_principal` (spec 205 Phase 0, #419; migrations 47-52
  landed since the spec 198 log's "46" baseline). Spec 208's migration is
  the next-free number determined at landing (53 today); do not hard-code,
  confirm next-free at landing.
- **Halt-pull authorization has no negative-test AC.** FR-001 requires the
  `factory:configure` org permission to pull a halt, and AC-4 gives the
  *lift* path a negative test (a service identity is rejected), but no AC
  asserts the symmetric property for the *pull* path: an actor lacking
  `factory:configure` calling the halt verb is refused, with no halt
  record written and no state transition. For an org-wide emergency stop
  the pull-side authorization boundary deserves an explicit AC with a
  negative test, not only the FR-001 prose requirement. Carrier: add the
  AC alongside the halt-verb tasks (it mirrors the AC-4 lift rejection
  against the FR-001 `factory:configure` precedent). The authorization is
  already specified in FR-001, so this closes a test-coverage gap, not a
  design hole.
- **Re-halt during `reintegrating` is implied, not drawn.** The state
  machine is record-based: a scope is `active` exactly when it has no
  non-`lifted` halt record, and a `reintegrating` scope is still enforced
  (new sessions and grants refused). A second halt pulled during
  reintegration therefore writes another halt record and the scope stays
  enforced fail-closed, and scope union (the scope lattice) covers a
  broader halt landing on a narrower reintegration. The behaviour is safe,
  but the diagram shows only `reintegrating to active`, not a
  `reintegrating to halted` re-assertion. Carrier: make the re-halt
  transition explicit when PD-E (tasks.md) resolves the `org_halts` record
  shape; no safety change, since a `reintegrating` scope already refuses
  new sessions and grants.
  **Resolved (Phase 3, 2026-07-02):** `pullHaltCore` now handles the
  `reintegrating -> halted` re-assertion explicitly, adopting the new reason
  and resetting the `acks` ledger so reintegration recounts cleanly
  (`FACTORY_ORG_HALT_REASSERTED` audit; row-locked CAS).
- **`reintegrating` enforcement is stated but not AC-covered.** The State
  machine section states that a `reintegrating` scope is still enforced
  (new sessions and grants refused) until its staged re-admission
  completes, and the re-halt gap above leans on exactly that property to
  argue a second halt during reintegration stays fail-closed. AC-2
  asserts refusal during a halt, but no AC unambiguously extends that to
  the `reintegrating` phase: the State machine states the property in
  prose, separately from AC-2, so the invariant the safety argument
  rests on is currently untested. Carrier: add an AC extending the AC-2
  assertion (grant issuance, grant renewal, and new session registration
  in scope are refused) to the `reintegrating` state, written alongside
  the FR-004 reintegration tasks. Closing it also grounds the re-halt
  gap's safety claim, which depends on this invariant.
  **Resolved (Phase 3, 2026-07-02):** AC-7 (spec.md) now extends the AC-2
  refusal assertion to the `reintegrating` state, with a DB-bound test that
  drives a halt into `reintegrating` and asserts grant renewal is still
  refused (closes issue #433).

## Constitution Check

- **Principle I/II**: this plan is markdown; no compiler-owned JSON is
  authored. The featuregraph golden moves only on the spec frontmatter
  edit (regenerated, not hand-edited).
- **Principle III**: implementation is justified by spec 208 (refined to
  implementable 2026-06-24); the relationship graph is declared in the
  spec frontmatter (`extends:` revocations.ts + featuregraph golden,
  `refines:` service.ts + live_sessions.rs). At implementation the
  frontmatter gains `establishes:` for the new files (the `org_halts`
  migration, `orgHalt.ts`, the audit-action constants) and `refines:` for
  the additional edited surfaces (`grantDuplexHandlers.ts`, `duplex.ts`,
  `sync_client.rs`, `types.ts`); the coupling gate enforces the declared
  graph, so the gate tasks expand it (tasks.md).
- **CONST-005**: no spec edit is required to make any gate pass. This plan
  resolves the storage and propagation mechanisms spec.md explicitly
  delegated to it; the spec refinement that preceded it de-hedged the FRs
  without altering any relationship edge.

**Gate: PASS.**

## Project Structure

### Documentation (this feature)

```text
specs/208-org-agent-kill-switch/
├── spec.md              # Feature specification (refined to implementable 2026-06-24)
├── plan.md              # This file
└── tasks.md             # Task breakdown
```

### Source Code (repository root)

```text
platform/services/statecraft/api/factory/
├── orgHalt.ts                 # NEW (establishes): halt + lift verbs, org_halts CRUD,
│                              #   broadcast trigger, scope-predicate helpers
├── revocations.ts             # extend (extends edge): export the org-halt consult helper;
│                              #   reuse the liftRevocationCore human-actor gate pattern
├── grantDuplexHandlers.ts     # refine: sweepCompositionRevocations / grantPreflight
│                              #   consult active org_halts in scope (line 363 seam)
└── auditActions.ts            # extend: org-halt audit-action constants

platform/services/statecraft/api/sync/
├── service.ts                 # refine (org-halt-propagation): broadcastOrgHalt via
│                              #   dispatchServerEvent; inbound org.halt.ack dispatch
├── duplex.ts                  # refine: refuse session registration when org-halt active
└── types.ts                   # new ServerEnvelope/ClientEnvelope variants
                               #   (org.halt.activated / org.halt.lifted / org.halt.ack);
                               #   spec 189 envelope-version bump

platform/services/statecraft/api/db/
├── migrations/NN_org_halts.up.sql / .down.sql   # NEW (establishes): org_halts table
└── schema.ts                  # drizzle org_halts table + types

product/apps/opc/src-tauri/src/commands/
├── live_sessions.rs           # refine (halt-aware-session-termination): pause-at-boundary
│                              #   + checkpoint path (distinct from force-disconnect hard kill)
└── sync_client.rs             # refine: handle org.halt.activated frame; send org.halt.ack

product/apps/opc/tests-e2e/
├── fixtures/208/              # NEW: seeded multi-session run fixture
└── harness/<drill>.test.ts    # NEW: FR-005 pull-and-lift drill against mock_statecraft

.github/workflows/opc-e2e-nightly.yml   # co_authority (spec 187): wire the drill into the
                                        #   nightly lane IF the harness does not auto-discover

crates/featuregraph/tests/golden/features_graph.json   # +1 row (extends: 034)
```

**Structure Decision**: enforcement, storage, and propagation land in
statecraft (the platform control plane is the only thing that can refuse a
grant or broadcast to the org). OPC gains one halt-aware termination path
and an ack send, both keyless. The drill lands in the existing e2e harness.

## Phases

- **Phase 1: Enforce (FR-001 refusals, FR-002 grant leg, FR-004 lift
  gate).** `org_halts` table + migration; `orgHalt.ts` halt/lift verbs; the
  org-halt consult in `grantPreflight` and the serve/bind callers; the
  human-actor lift gate. Lands behind the broadcast: the halt is
  *enforced* before it is *propagated*. AC-2 (DB-bound) closes here.
- **Phase 2: Propagate (FR-001 broadcast, FR-003).** `broadcastOrgHalt`
  over `dispatchServerEvent`; the `org.halt.*` envelope variants + version
  bump; the OPC halt-aware termination path + ack; per-engine ack
  timestamps on `org_halts`. AC-1 closes here.
- **Phase 3: Scope + reintegrate (AC-3, FR-004 staged).** `project` and
  `agent-profile` scope proofs; staged per-scope re-admission; the
  `reintegrating` substate. AC-3 and AC-4's reintegration leg close here.
  **Landed 2026-07-02 (PR `feat/208-scope-reintegrate`).** The agent-profile
  leg was built (option a, not deferred): the engine resolves the profile
  about to execute a stage from its reservation-time `stage_agents` map and
  presents it on `factory.run.grant_renew` (`FACTORY_RUN_GRANT_ENVELOPE_VERSION`
  1 -> 2), so `isHaltedInScope`'s agent-profile arm gates a real fact and
  `pullHaltCore`'s Phase-1 rejection is removed. Enforcement is at grant
  **renewal** only: issuance carries no single profile (a run spans several),
  and the first renewal fires before s0, so a halted profile is refused before
  any agent output. Staged reintegration completes `reintegrating -> lifted`
  when every engine that halt-acked has also lift-acked (computed over the
  `acks` ledger, no new column; `FACTORY_ORG_HALT_REINTEGRATED` audit); a
  lift-ack counts only after a fresh admission re-validation (the D2 two-sided
  check, mirroring `liftRevocationCore`). The OPC side gained an
  `org.halt.lifted` dispatch handler that sends the lift-ack. AC-7 closes the
  reintegrating-enforcement gap; the re-halt gap is closed by re-asserting
  `halted` + resetting the ack ledger on a pull landing on a `reintegrating`
  scope (`FACTORY_ORG_HALT_REASSERTED` audit).
- **Phase 4: Credential closure (FR-002 full).** Consume the spec 205
  `nhi_delegation_index` cascade when it lands; until then the degraded
  grant + session path is the shipped behavior.
- **Phase 5: Drill (FR-005, AC-5).** The pull-and-lift cycle in the
  nightly lane; the completion gate for the spec.

AC coverage: AC-2 -> Phase 1; AC-1 + AC-4 (halt-ack leg) -> Phase 2;
AC-3 + AC-4 (lift-ack + reintegration leg) -> Phase 3; AC-5 -> Phase 5;
AC-6 -> every phase's gate tasks. FR-002's full closure spans Phase 1
(grant leg, the shipped degraded path) and Phase 4 (NHI leg, when 205
lands).

## Sequencing

- The cross-spec gate (spec 198 `implementation: complete`) is **green**
  (2026-06-12), so Phases 1-3 and 5 are landable now against the degraded
  FR-002 path.
- Phase 4 is gated on spec 205 reaching the point where its
  `nhi_delegation_index` and revocation cascade exist (its Phase 3 / T020-T023).
  The spec-205 handoff (its T023) is the contract this phase consumes.
- Phase 5 (the drill) integrates with the spec 187 harness and is the
  release-candidate completion gate, not a later promise.

## Complexity Tracking

No constitution violations to justify; table intentionally empty. The one
non-trivial design call (new table versus scopeKind overload) is resolved
under Storage decision with the rejected alternative recorded.
