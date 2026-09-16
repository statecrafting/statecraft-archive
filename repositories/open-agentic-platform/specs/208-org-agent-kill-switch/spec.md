---
id: "208-org-agent-kill-switch"
title: "Org-Wide Agent Kill Switch and Quarantine (ASI10 containment)"
feature_branch: "feat/208-org-agent-kill-switch"
status: draft
implementation: pending
kind: governance
domain: platform
created: "2026-06-11"
authors: ["open-agentic-platform"]
language: en
summary: >
  Containment today is precise but narrow: an operator can
  force-disconnect one session (spec 172), the four-key revocation
  lattice quarantines factory content (spec 198 FR-010), and Rauthy
  sessions can be revoked one principal at a time. What does not exist
  is the emergency stop ASI10 m4 and ASI04 m8 require: one
  admin-gated action that halts agent execution org-wide (pausing
  in-flight runs at the next boundary, refusing new sessions and grant
  issuance, revoking agent credentials) with propagation inside a stated
  bound, a quarantine record, and reintegration that requires fresh
  validation plus human approval. The switch composes the levers that
  already exist (grant renewal, duplex channels, revocation rows,
  session force-disconnect) rather than adding a parallel mechanism, and
  it is drilled: a kill switch that has never been pulled is decoration,
  so exercising it is an acceptance criterion, not an operational
  afterthought.
code_aliases: ["ORG_AGENT_KILL_SWITCH"]
compliance:
  - framework: "owasp-asi-2026"
    controls: ["ASI10", "ASI08"]
depends_on:
  - "198-factory-governance-envelope"
  - "172-opc-live-agent-session-introspection"
  - "106-rauthy-native-oidc-and-membership"
establishes:
  # Phase 1 (FR-001): the org_halts quarantine-record migration, the
  # admin-gated kill-switch verb, and its DB-bound enforcement test are
  # brought into existence by this spec.
  - unit: { kind: file, path: platform/services/statecraft/api/factory/orgHalt.ts }
  - unit: { kind: file, path: platform/services/statecraft/api/factory/orgHalt.test.ts }
  # Phase 5 (FR-005): the e2e kill-switch pull-and-lift drill fixture is brought
  # into existence by this spec, inside the spec-187 harness fixtures/ tree.
  - unit: { kind: file, path: product/apps/opc/tests-e2e/fixtures/208/org-halt-drill.e2e.ts }
extends:
  # The org scope is an additive widening of the revocation lattice
  # spec 198 FR-010 establishes. Phase 1 also exports requireFactoryConfigure
  # from revocations.ts so the halt verb reuses the exact factory:configure +
  # human-actor gate (additive, no behaviour change).
  - spec: "198-factory-governance-envelope"
    nature: additive
    unit: { kind: file, path: platform/services/statecraft/api/factory/revocations.ts }
  # Phase 3 (FR-001/AC-3): the agent-profile seam. The grant-renewal path is
  # taught to resolve the profile about to execute a stage (from the
  # reservation-time stage-agent map) and present it on factory.run.grant_renew,
  # so an agent-profile-scoped halt refuses renewal. These three OPC files
  # implement spec 198's grant-renewal contract; 208 additively extends them to
  # carry the halt-scoping profile. Renewal only (issuance has no single profile).
  - spec: "198-factory-governance-envelope"
    nature: additive
    unit: { kind: file, path: product/apps/opc/src-tauri/src/commands/run_governance.rs }
  - spec: "198-factory-governance-envelope"
    nature: additive
    unit: { kind: file, path: product/apps/opc/src-tauri/src/commands/factory.rs }
  - spec: "198-factory-governance-envelope"
    nature: additive
    unit: { kind: file, path: product/apps/opc/src-tauri/src/commands/factory_platform.rs }
  # Phase 5 (FR-005): the drill additively extends the spec-187 mock-statecraft
  # harness so the duplex stays bidirectional after the hello (push a
  # server->client org.halt.* frame, collect the client's org.halt.ack). The
  # spec-187 handshake modes are untouched; this is a pure surface addition.
  - spec: "187-opc-e2e-test-harness"
    nature: additive
    unit: { kind: file, path: product/apps/opc/tests-e2e/harness/mock_statecraft.ts }
  - spec: "187-opc-e2e-test-harness"
    nature: additive
    unit: { kind: file, path: product/apps/opc/tests-e2e/harness/mock_statecraft.test.ts }
  # Same precedent as specs 196, 194, 193, 187, 183: a new spec adds a row
  # to the featuregraph golden.
  - spec: "034-featuregraph-registry-scanner-fix"
    nature: additive
    unit: { kind: file, path: crates/featuregraph/tests/golden/features_graph.json }
refines:
  # Phase 1 (FR-001/FR-002): the org_halts table shape, the audit vocabulary,
  # the "halted" refusal reason, and the three fail-closed enforcement seams
  # (grant issuance/renewal, new-session registration, serve/bind) the switch
  # reuses rather than adding a parallel mechanism.
  - aspect: "org-halt-storage"
    unit: { kind: file, path: platform/services/statecraft/api/db/schema.ts }
  - aspect: "org-halt-audit-actions"
    unit: { kind: file, path: platform/services/statecraft/api/factory/auditActions.ts }
  - aspect: "org-halt-refusal-reason"
    unit: { kind: file, path: platform/services/statecraft/api/sync/types.ts }
  - aspect: "org-halt-grant-refusal"
    unit: { kind: file, path: platform/services/statecraft/api/factory/grantDuplexHandlers.ts }
  - aspect: "org-halt-session-refusal"
    unit: { kind: file, path: platform/services/statecraft/api/sync/duplex.ts }
  - aspect: "org-halt-serve-bind-refusal"
    unit: { kind: file, path: platform/services/statecraft/api/factory/admission.ts }
  - aspect: "org-halt-test-lane"
    unit: { kind: file, path: platform/services/statecraft/vite.config.ts }
  # Phase 2 (FR-001/FR-003): the org-halt broadcast over the duplex channel and
  # the engine-side pause-at-next-boundary + checkpoint. Declared for the
  # staged plan; the files are edited in PR-2 (feat/208-propagate).
  - aspect: "org-halt-propagation"
    unit: { kind: file, path: platform/services/statecraft/api/sync/service.ts }
  - aspect: "halt-aware-session-termination"
    unit: { kind: file, path: product/apps/opc/src-tauri/src/commands/live_sessions.rs }
  # Phase 2 (FR-003): the engine-side org.halt.* wire twin and the org.halt.ack
  # producer (the desktop mirror of the org-halt-refusal-reason envelope shape),
  # edited in PR-2 (feat/208-propagate).
  - aspect: "org-halt-engine-ack"
    unit: { kind: file, path: product/apps/opc/src-tauri/src/commands/sync_client.rs }
  # Phase 2 (FR-001): the org.halt.activated dispatch handler is registered on
  # the duplex dispatch table at desktop startup (the spec 207
  # command-registration-in-lib.rs precedent), edited in PR-2.
  - aspect: "org-halt-handler-registration"
    unit: { kind: file, path: product/apps/opc/src-tauri/src/lib.rs }
references:
  - role: context
    unit: { kind: file, path: docs/owasp-agentic-top-10-2026.md }
---

# Feature Specification: Org-Wide Agent Kill Switch and Quarantine

**Feature Branch**: `208-org-agent-kill-switch`
**Created**: 2026-06-11
**Status**: Draft (refined to implementable 2026-06-24; the sequencing
gate spec 198 `implementation: complete` is now satisfied, so the FRs and
ACs below are normative and testable, no longer a sketch)
**Input**: The ASI 2026 gap analysis (2026-06-10) found: "Four-key
revocation covers factory content; there is no 'halt all agents / revoke
all agent credentials org-wide' lever. Per-session force-disconnect (172)
is the only kill-switch." Cross-cutting principle 10: containment and
recovery are designed in before deployment, not improvised after
compromise.

## Purpose

The incident that motivates this spec is the one OAP's posture already
assumes possible: a supply-chain compromise (ASI04) or rogue-agent
divergence (ASI10) discovered *while agents are running across the org*.
The operator's first question is not "which session?", it is "how do I
stop everything, now, without losing forensic state?" Today the honest
answer is a loop over sessions and a hope that nothing re-connects.

The design constraint is composition: every primitive the switch needs
exists. Grant renewal (198 FR-005) gives a natural pause boundary;
revocation rows (198 FR-010) give fail-closed serve/bind/renewal checks;
the duplex channel reaches every connected engine; force-disconnect (172)
terminates an unresponsive one; checkpointing preserves state at the
kill. The switch is the org-scoped composition of these, plus the state
machine (active, halted, reintegrating) and its audit story.

## Design model: composition over a new mechanism

The switch adds no parallel control plane. It is a thin org-scoped verb
over five primitives that already ship, each at its established home:

| Primitive | Home (existing) | What the switch reuses it for |
|---|---|---|
| Revocation rows, fail-closed at serve / bind / grant | `api/factory/revocations.ts` (198 FR-010) | The halt reuses these fail-closed check sites (serve / bind / grant); each consults the halt record for scopes `org` / `project` / `agent-profile`. Whether the halt record lives in `factory_revocations` or a sibling table is the storage decision resolved in plan.md |
| Run-grant issue / renew over duplex | `api/factory/grantDuplexHandlers.ts` (198 FR-005) | Halt makes grant issuance and per-stage renewal refuse, which is how in-flight runs pause at the next stage boundary |
| Org-scoped duplex channel | `api/sync/service.ts` (one connection observes every project in the org) | The halt notice is broadcast to every connected engine; this is the `org-halt-propagation` seam |
| Session force-disconnect + checkpoint | `product/apps/opc/src-tauri/src/commands/live_sessions.rs` (172) | The graceful halt path checkpoints at the next boundary before the engine yields; an engine that does not acknowledge is force-disconnected as the fallback (172 itself kills then checkpoints). This is the `halt-aware-session-termination` seam |
| Agent NHI delegation/revocation index | spec 205 `nhi_delegation_index` (in progress) | FR-002 consumes it to revoke agent credentials org-wide; until 205 lands, the switch degrades to grant + session revocation (see Dependencies) |

The contract this spec locks is the *verb, scope lattice, state machine,
propagation bound, quarantine record, and drill*. The *storage shape*
(reuse `factory_revocations` with new scope kinds versus a sibling
`org_halts` table consulted by the same check sites) and the *duplex
frame shape* are mechanism decisions resolved in `plan.md`, in the
spec-205 precedent of deferring mechanism to the plan.

## State machine

Each halt scope is a state machine; lifting is staged, never a global
flip.

```text
   active ──[admin pulls halt: FR-001]──▶ halted
      ▲                                     │
      │                                     │ [admin initiates lift:
      │ [every affected scope               │  human actor id + fresh
      │  re-admitted & validated;           │  two-sided validation: FR-004]
      │  quarantine record closed]          ▼
      └──────────────────────────── reintegrating
```

- **active to halted** is set by the admin-gated halt verb (FR-001). The
  transition is atomic at the platform: the halt record is written before
  the broadcast, so a grant renewal racing the broadcast still fails
  closed.
- **halted to reintegrating** requires an explicit human actor id and
  fresh two-sided validation of every affected factory (FR-004); a
  service identity cannot initiate it (the spec 200 AC-4 pattern).
- **reintegrating to active** completes only when every affected scope
  has re-admitted and re-validated. Reintegration is staged: sessions are
  re-admitted per scope, not by one org-wide enable.

The diagram is the *scope* state. The halt *record* progresses `halted`
to `reintegrating` to `lifted` (the storage shape resolved in plan.md /
tasks.md PD-E); a scope is `active` exactly when it has no non-`lifted`
halt record, so the loop back to active is the record reaching `lifted`.
A `reintegrating` scope is still enforced (new sessions and grants
refused) until its staged re-admission completes.

## Scope lattice

The verb takes one of three scopes. The ASI10 quarantine case is rarely
all-or-nothing; a narrower halt that an operator dares to pull beats a
broad one nobody will.

- **`org`** halts all agent execution for the organisation: every
  project, every session, every agent profile.
- **`project`** halts a single project. Sibling projects keep running
  (proven by AC-3). Run-grants are already project-bound (they carry
  project + run id), so project-scoped grant refusal is exact.
- **`agent-profile`** halts every session of a named agent profile across
  the org (the surgical case: one compromised profile, the rest of the
  fleet untouched).

Scopes compose by union: an `org` halt subsumes any narrower active halt;
lifting the `org` halt does not lift an independently-pulled `project`
halt.

## Functional requirements

### FR-001: Halt verb

An admin-gated platform action sets a halt for one scope (the scope
lattice above). It requires the `factory:configure` org permission (the
`revocations.ts` precedent) and a non-empty reason (the reason is audit
evidence, not a toggle). While a halt is active for a scope:

- new agent sessions in that scope are refused at duplex registration;
- new run-grants and grant renewals in that scope are refused, so
  in-flight runs pause at the next stage boundary (the 198 FR-005
  semantics, not a forced mid-stage kill);
- a halt notice is pushed over every connected duplex channel in scope so
  engines pause at the next instruction boundary without waiting for the
  next renewal;
- engines checkpoint on halt: the halt-aware path checkpoints at the next
  boundary before the engine yields (the 172 force-disconnect, which kills
  then checkpoints, is the no-ack fallback). Containment must not destroy
  the forensic state it exists to protect.

### FR-002: Credential revocation propagation

Halt revokes outstanding run-grants in scope (serve-time and
issuance/renewal checks refuse them immediately) and, where spec 205 has
landed, agent NHIs via the `nhi_delegation_index` (an org / project /
agent-profile predicate over the index, the cascade spec 205 FR-004 / T021
exposes). Until spec 205 lands, FR-002 degrades to grant + session
revocation, which is sufficient for AC-1/AC-2 because OPC and every agent
are keyless (198 FR-014): a halted session holds only short-TTL grants and
a revocable Rauthy session, and loses all standing one stage boundary
after the grant refusal.

### FR-003: Propagation bound, stated and measured

The halt contract states its bound, and the realized bound is measurable
after every pull:

- **connected engines**: paused at the next instruction boundary
  (acknowledged over duplex);
- **disconnected engines**: refused at the reconnect handshake, which
  checks halt state fail-closed before any other traffic is served.

The quarantine record (FR-004) captures a per-engine acknowledgment
timestamp for the halt and for the lift, so the realized propagation bound
is an audited fact after every pull, drill or real, not a design promise.

### FR-004: Quarantine record and reintegration

The halt writes a quarantine record: who pulled it, why, the scope, and
evidence links. Lifting follows the spec 198 FR-010 lift contract
verbatim: fresh two-sided validation of the affected factories (a re-sync
re-evaluates admission) plus an explicit human actor id. A service
identity cannot lift (the spec 200 AC-4 pattern, enforced by the
`liftRevocationCore` auth precedent). Reintegration is staged: sessions
are re-admitted per scope, not by one global flip, and each re-admission
is recorded with its per-engine timestamp.

The reintegration completion count is windowed to the current cycle: a
lift-ack counts toward completion only while the scope is actively
`reintegrating`. A re-halt on a scope mid-reintegration (the D3 path)
re-asserts `halted` and resets the ack ledger, so a lift-ack from the
interrupted cycle that arrives late (an outbox resync replay landing
after the reset) is dropped rather than recorded; it would otherwise be
miscounted as a completed lift in the next cycle and complete
reintegration for an engine that never re-acknowledged. Engines re-ack on
the next lift broadcast per the resync-replay contract, so the drop is
lossless.

The symmetric case, a late *halt*-ack replay arriving after the scope has
left `halted` (moved to `reintegrating` or `lifted`), is written unchecked
today. Its direction is fail-safe: a stale halt-ack can only over-count
halt acknowledgements, at worst holding a scope in `reintegrating` because
a phantom acker is still expected to lift-ack, never completing a
premature `lifted`. It is recorded as deferred hardening in
`## Deferred hardening (Phase 3.1)` rather than fixed in the same change
that closed the dangerous lift-ack direction.

### FR-005: Drill requirement

The e2e harness (spec 187, `product/apps/opc/tests-e2e/`) exercises the
full pull-and-lift cycle on every release candidate: halt during a seeded
multi-session run, assert the propagation bound (FR-003), lift, assert
staged reintegration (FR-004). This is ASI01 m8's "verify rollback works"
applied to containment: a kill switch that has never been pulled is
decoration. The drill runs in the existing nightly e2e lane
(`.github/workflows/opc-e2e-nightly.yml`) against the harness's
`mock_statecraft` seam, not as a later promise.

## Acceptance criteria

- **AC-1.** With three concurrent sessions (one mid-run, one idle, one
  disconnected), an `org` halt: the mid-run session pauses and checkpoints
  at the next boundary; the idle session's next action is refused; the
  disconnected session is refused at the reconnect handshake. (FR-001,
  FR-003)
- **AC-2.** During a halt, grant issuance, grant renewal, and new session
  registration in scope are all refused with errors that name the
  quarantine record. (FR-001, FR-002)
- **AC-3.** A `project`-scoped halt leaves sibling projects' sessions
  running, and an `agent-profile`-scoped halt leaves other profiles'
  sessions running (the scope lattice is proven, not just the org case).
  (scope lattice, FR-001)
- **AC-4.** Lift requires a human actor id and fresh re-validation; the
  scanner / service identity is rejected; per-engine acknowledgment
  timestamps exist for both the halt and the lift. (FR-004)
- **AC-5.** The drill (FR-005) runs in the e2e harness and is green on a
  release candidate. (FR-005)
- **AC-6.** `make ci` / schema-parity (125/191) / coupling gate pass;
  codebase index and featuregraph golden regenerated for the spec add.
  (cross-cutting, mirrors 198 AC-9)
- **AC-7.** While a halt is `reintegrating` (not yet `lifted`), grant
  issuance, grant renewal, and new session registration in scope remain
  refused exactly as during `halted` (extends AC-2); the `reintegrating`
  -> `lifted` transition requires per-scope re-admission (every engine
  that halt-acked also lift-acks, and a lift-ack counts only after a fresh
  admission re-validation), not a bare state flip. (FR-004; closes the
  reintegrating-enforcement gap recorded in plan.md, issue #433)

## Out of scope

- Single-run budget circuit-breaking (spec 202; the governor bounds one
  run, the switch stops the fleet).
- Per-agent credential issuance (spec 205; FR-002 consumes its index when
  available, and degrades to grant + session revocation until then).
- Automated halt triggers (anomaly-detection-initiated halt is future
  work; this spec's actor is a human admin: automation proposing, a human
  pulling, is the ASI08-honest division).
- Content quarantine semantics (spec 198 FR-010 owns the four-key
  lattice; this spec widens scope, it does not redefine keys).
- Cross-org or platform-global halt (the verb is org-scoped; a
  platform-operator global stop is a separate authority and a separate
  spec).

## Dependencies and sequencing

- **spec 198 `implementation: complete`** (the sequencing gate) is
  satisfied as of 2026-06-12: grant machinery (FR-005) and revocation rows
  (FR-010) are the substrate the switch composes. **This gate is now
  green**, which is what makes this refinement (and subsequent
  implementation) admissible.
- **spec 172 `implementation: complete`**: the force-disconnect +
  checkpoint sequence is the `halt-aware-session-termination` reuse.
- **spec 205 (draft, in progress)**: FR-002 consumes its
  `nhi_delegation_index` for org-wide agent-credential revocation. The
  switch does not block on 205: it degrades to grant + session revocation
  (keyless posture, 198 FR-014). A coordination point recorded for
  `plan.md`: project-scoped NHI revocation needs a project key on the 205
  index (its T007 shape keys on `org_id` / `agent_profile` but not
  `project_id`); until that key exists, project-scoped revocation rides
  grants (which are project-bound) rather than the index.
- The drill (FR-005) lands with the spec 187 e2e harness integration, not
  as a later promise.

## Phasing (proposed; refine in plan.md)

1. **Halt verb + scope lattice + revocation-lattice widening.** The
   admin-gated verb, the quarantine record, and the fail-closed check at
   serve / bind / grant-issuance / grant-renewal / session-registration.
   This phase makes the halt *enforced* before it is *propagated*.
2. **Duplex propagation + halt-aware termination.** The org-halt broadcast
   over `api/sync/service.ts`, the engine-side pause-at-next-boundary +
   checkpoint in `live_sessions.rs`, and per-engine acknowledgment
   timestamps (FR-003).
3. **Reintegration.** Staged lift per scope, human-actor gate, fresh
   two-sided validation (FR-004), reusing the `liftRevocationCore`
   contract.
4. **Credential propagation closure.** Consume the spec 205 index when it
   lands (FR-002); until then the degraded grant + session path is the
   shipped behavior.
5. **Drill.** The e2e pull-and-lift cycle in the nightly lane (FR-005),
   the completion gate for the spec.

## Deferred hardening (Phase 3.1)

Two follow-ups surfaced by the FR-004 reintegration fix (the lift-ack
write-path guard, PR #502) are recorded here rather than left in a review
thread. Neither blocks the drill (FR-005) or the credential-closure phase;
both harden the `org_halts.acks` ledger against replay.

- **(a) Symmetric halt-ack write-path guard.** FR-004 guards the *lift*-ack
  write on `state === "reintegrating"`, but a late *halt*-ack replay (an
  outbox resync landing after the scope has moved to `reintegrating` or
  `lifted`) is appended unchecked, widening the recorded halt-acker set.
  The direction is fail-safe: a stale halt-ack can only over-count halt
  acknowledgements, at worst holding a scope in `reintegrating` because a
  phantom acker is still expected to lift-ack, never completing a premature
  `lifted`. The dangerous direction is already closed by PR #502. The guard
  mirrors that fix: append a halt-ack only while the scope is `halted`, and
  drop it otherwise as a benign no-op (the engine re-acks on the next
  broadcast per the resync-replay contract, so the drop is lossless).
- **(b) Dropped-ack audit trail.** The ack-drop paths (`not-reintegrating`,
  `duplicate`, and the (a) halt-ack drop above) only `log.info` today. A
  `FACTORY_ORG_HALT_ACK_DROPPED` audit action (or a `dropped: true` field
  on the existing engine-ack audit) closes a forensic gap on a
  safety-critical containment path: a dropped ack is otherwise invisible to
  the audit chain the rest of the switch is built to preserve.

Both land as one small follow-up (PR-3.1, tasks T023/T024). Because spec
208 is still `draft`, this is an ordinary refinement, not an amendment; the
section reaches `approved` with the Phase 5 drill's lifecycle flip (T022).
