# Tasks: Org-Wide Agent Kill Switch and Quarantine

**Input**: [plan.md](plan.md) (storage decision: dedicated `org_halts`
table, enforcement reuses the existing check sites; propagation decision:
outbox-durable broadcast), [spec.md](spec.md) FR-001..FR-005.
**Format**: `[ID] [P?] Description`. [P] = parallelizable (different
files, no dependency). Phase 1 = PR-1 (`feat/208-enforce`); Phase 2 = PR-2
(`feat/208-propagate`); Phase 3 = PR-3 (`feat/208-scope-reintegrate`);
Phase 3.1 = PR-3.1 (`feat/208-ack-hardening`); Phase 4 = PR-4
(`feat/208-credential-closure`); Phase 5 = PR-5 (`feat/208-drill`).

**Sequencing gates** (from spec.md §Dependencies + plan.md §Sequencing):

- **Phases 1-3 and 5 are landable now.** The cross-spec gate (spec 198
  `implementation: complete`) is green as of 2026-06-12; FR-002 ships its
  degraded grant + session path until spec 205 lands.
- **Phase 4 is blocked on spec 205** reaching its Phase 3 (spec 205's own
  T020-T023, not to be confused with this spec's T019-T022): the
  `nhi_delegation_index` and the revocation cascade must exist. Spec 205
  T023 is the handoff contract this phase consumes.
- **Migration number** is the next-free number at landing. The highest
  landed migration as of 2026-06-24 is `52_audit_two_principal` (spec 205
  Phase 0, #419; migrations 47-52 landed since the spec 198 log's "46"
  baseline), so the next-free is 53 today. Do not hard-code; confirm
  next-free at landing (called `NN` below).

## Pre-implementation decisions (2026-06-24 seam survey)

The seam survey of the four composition surfaces found the ground truth
each task builds on. Resolutions recorded here so no task silently
re-decides them.

- **PD-A: `org_halts` is a new table; `factory_revocations` is
  untouched.** Per plan.md §Storage decision, the halt record is a
  dedicated table because the revocation row shape
  (`schema.ts:1141-1156`: `createdAt` / `liftedAt` / `liftedBy`, binary)
  cannot hold per-engine ack timestamps (FR-003) or a `reintegrating`
  substate (FR-004). No column change and no CHECK-constraint widening on
  `factory_revocations`; we do not mint revocation rows for halts.
- **PD-B: one enforcement seam covers issuance AND renewal.**
  `grantPreflight` (`grantDuplexHandlers.ts:337-372`) runs
  `sweepCompositionRevocations` at line 363 and is called by both
  `handleGrantRequest` (line 403) and `handleGrantRenew` (line 598).
  Adding the org-halt consult inside `grantPreflight` (a sibling query for
  active `org_halts` in scope, returning `{ok:false, reason:"halted",
  detail: haltId}`) therefore refuses issuance and renewal from one
  insertion point. In-flight runs lose renewal at the next stage boundary
  without the run being touched.
- **PD-C: the broadcast is `dispatchServerEvent`, the ack is an inbound
  dispatch arm.** `dispatchServerEvent` (`sync/service.ts:255-283`)
  persists to the outbox before `broadcastOrg`, so a reconnecting engine
  replays the halt on `sync.resync_request` (`service.ts:102-105` ->
  `deliverResync:549`). The handlers in `grantDuplexHandlers.ts` only
  RETURN reply envelopes (line 23-25 comment); the dispatcher sends. The
  `org.halt.ack` is a new arm in `handleInbound` (`service.ts:76-201`)
  alongside `grantDispatch` / `auditSegmentDispatch` / `runDispatch`.
  `sendTargetedServerEvent` (`service.ts:294`) is NOT used (it skips the
  outbox).
- **PD-D: the halt-aware termination is a NEW path, not
  `force_disconnect_session`.** `force_disconnect_session`
  (`live_sessions.rs:309-404`) is a hard kill: it calls
  `kill_session_process` (step 2, line 331) BEFORE
  `create_forensic_checkpoint` (step 3, line 337). The halt path must
  pause-at-boundary: signal the bridge via a new IPC message type (e.g.
  `{"type":"halt"}`) through `ClaudeBridgeIpcState`, the same stdin
  channel `send_bridge_abort` (lines 406-432) uses for `{"type":"abort"}`;
  the engine's tool-loop checks at the boundary and self-checkpoints via
  the reusable `CheckpointState::create_checkpoint`
  (`live_sessions.rs:452-481`) BEFORE exiting, then sends `org.halt.ack`.
  `force_disconnect_session` remains the fallback for an engine that does
  not ack within the propagation bound.
- **PD-E: `org_halts` shape.** Columns: `id uuid PK`, `org_id uuid NOT
  NULL`, `scope text` (`org` | `project` | `agent-profile`), `scope_key
  text` (org id / project id / profile slug), `state text` (`halted` |
  `reintegrating` | `lifted`), `reason text NOT NULL`, `pulled_by uuid
  NOT NULL` FK->`users.id`, `pulled_at timestamptz`, `lifted_by uuid
  NULL`, `lifted_at timestamptz NULL`, `acks jsonb NOT NULL DEFAULT '[]'`
  (each entry `{clientId, ackedAt, kind: 'halt'|'lift'}`). Absence of a
  non-`lifted` row for a scope = that scope is active. Partial index on
  `(org_id, scope, scope_key) WHERE state != 'lifted'` (the hot-path
  liveness lookup the plan's performance goal budgets). The index excludes
  only `lifted`, not `reintegrating`, deliberately: a `reintegrating` scope
  still refuses new sessions and grants until its staged re-admission
  completes and the record flips to `lifted` (FR-004).

## Phase 1 (PR-1): Enforce (FR-001 refusals, FR-002 grant leg, FR-004 lift gate)

**Enforcement boundary (PR-1 review decision, 2026-06-24).** Phase 1
enforces `org` and `project` scopes only. `pullHalt` **rejects**
`scope='agent-profile'` (`APIError.unimplemented`): no Phase-1 seam carries
the agent profile (the duplex handshake is per-OPC-connection, the grant is
run/project bound), so accepting an agent-profile halt would audit it
"active" while enforcing nothing, the false-containment a kill switch must
not ship. The `isHaltedInScope` agent-profile branch stays implemented and
unit-tested for the phase that adds a profile-carrying seam. **AC-3's
agent-profile leg therefore moves to that phase** (the Phase 3 scope-lattice
proofs T015 must first introduce the seam, or land agent-profile enforcement
explicitly); the org + project legs of the scope lattice are proven in PR-1.

- [x] T001 Migration `NN_org_halts.up.sql` / `.down.sql`: the `org_halts`
      table per PD-E + the partial liveness index; drizzle `db/schema.ts`
      table + inferred types in the same commit. (FIPS rule: no `md5()` in
      migration SQL; trivially satisfied.)
- [x] T002 `api/factory/orgHalt.ts` (NEW): `pullHalt`
      (`POST /api/factory/org-halts`) requires `factory:configure` (the
      `requireFactoryConfigure` precedent, `revocations.ts:36`) and a
      non-empty `reason`; writes the `org_halts` row `state='halted'`;
      audits `factory.org_halt.activated`. `liftHalt`
      (`POST /api/factory/org-halts/:id/lift`) reuses the
      `liftRevocationCore` human-actor gate (`revocations.ts:152`): an
      authenticated human only, service identity rejected; transitions
      `halted -> reintegrating` (the staged completion lands in Phase 3).
      Pure helper `isHaltedInScope(orgId, {projectId?, agentProfile?})`
      returning the active halt id or null (the consult T004/T005 import).
- [x] T003 `api/factory/auditActions.ts`: add
      `FACTORY_ORG_HALT_ACTIVATED`, `FACTORY_ORG_HALT_LIFTED`,
      `FACTORY_ORG_HALT_ENGINE_ACK` constants + union-type members
      (mirrors the existing spec 124/198/201/207 constant pattern).
- [x] T004 Grant-path enforcement: `grantPreflight`
      (`grantDuplexHandlers.ts:337-372`) gains the `isHaltedInScope`
      consult adjacent to `sweepCompositionRevocations` (line 363),
      returning `{ok:false, reason:"halted", detail: haltId}` so both
      `handleGrantRequest` (403) and `handleGrantRenew` (598) refuse with
      an error naming the halt record (PD-B). The grant refusal audits
      `factory.run.grant_refused` with the halt id in metadata.
- [x] T005 Serve/bind + session-registration refusal: the serve/bind
      callers of `admission.isFactoryAdmitted` and the `register` path in
      `api/sync/duplex.ts` consult `isHaltedInScope` and refuse a new
      agent session in scope (FR-001). Confirm the exact `duplex.ts`
      register line at implementation (the survey read `service.ts` /
      `registry.ts`, not `duplex.ts`).
- [x] T006 DB-bound tests (encore lane, fixtures per
      `grantDuplexHandlers.test.ts` conventions) for AC-2: grant issuance,
      grant renewal, and new session registration in scope are all refused
      with errors naming the halt record; a sibling-scope session is
      unaffected. `vite.config.ts` exclude additions so it rides the spec
      211 encore-test lane.
- [ ] T007 Gate PR-1: spec 208 frontmatter gains `establishes:` (the
      migration, `orgHalt.ts`, `auditActions.ts`) and `refines:`
      (`grantDuplexHandlers.ts`, `api/sync/duplex.ts`); registry recompile
      **before** `UPDATE_GOLDEN=1` (frontmatter edits move the featuregraph
      golden; 208 carries the `extends: 034` edge); codebase index regen;
      `make pr-prep` after the LAST commit.

## Phase 2 (PR-2): Propagate (FR-001 broadcast, FR-003)

- [ ] T008 `api/sync/types.ts`: new `ServerEnvelope` variants
      `org.halt.activated` / `org.halt.lifted` and a `ClientEnvelope`
      variant `org.halt.ack`; bump the envelope version (spec 189 parity);
      update the Rust twin so schema-parity (125/191) stays green.
- [ ] T009 `api/sync/service.ts` `broadcastOrgHalt`: after the `org_halts`
      row write (atomicity: row before broadcast, FR-001), call
      `dispatchServerEvent(orgId, {kind:"org.halt.activated", haltId,
      scope, scopeKey, reason})` (PD-C); the lift path broadcasts
      `org.halt.lifted`. This is the `org-halt-propagation` refine aspect.
- [ ] T010 `api/sync/service.ts` inbound ack dispatch: a new arm in
      `handleInbound` (76-201) routes `org.halt.ack` to append
      `{clientId, ackedAt, kind}` to `org_halts.acks` (FR-003 per-engine
      timestamp); audit `factory.org_halt.engine_ack`.
- [ ] T011 `product/apps/opc/src-tauri/src/commands/sync_client.rs`:
      handle the inbound `org.halt.activated` frame by invoking the T012
      halt-aware path; send `org.halt.ack` after the checkpoint completes.
- [ ] T012 `product/apps/opc/src-tauri/src/commands/live_sessions.rs`:
      the halt-aware termination path per PD-D (new IPC `{"type":"halt"}`
      via `ClaudeBridgeIpcState`; pause at boundary; self-checkpoint via
      `CheckpointState::create_checkpoint`; `force_disconnect_session` is
      the no-ack fallback). This is the `halt-aware-session-termination`
      refine aspect. Rust unit test for the boundary-pause + checkpoint
      ordering (checkpoint BEFORE exit, the inverse of force-disconnect).
- [ ] T013 AC-1 integration (DB-bound + harness): three concurrent
      sessions (one mid-run, one idle, one disconnected) under an `org`
      halt: mid-run pauses and checkpoints at the next boundary; idle's
      next action is refused; disconnected is refused at the reconnect
      handshake. Per-engine ack timestamps recorded (AC-4 ack leg).
- [ ] T014 Gate PR-2: frontmatter `refines:` expands to `types.ts` +
      `sync_client.rs` (`service.ts` is already declared); `npm run gen`
      if the endpoint surface changed; registry recompile -> golden ->
      index regen; `make pr-prep` after the LAST commit.

## Phase 3 (PR-3): Scope + reintegrate (AC-3, FR-004 staged)

- [ ] T015 Scope-lattice proofs: a `project`-scoped halt leaves sibling
      projects' sessions running; an `agent-profile`-scoped halt leaves
      other profiles' sessions running (AC-3). Tests exercise the
      `isHaltedInScope` predicate for all three scopes and the union
      composition (an `org` halt subsumes a narrower active halt; lifting
      `org` does not lift an independent `project` halt).
- [ ] T016 Staged reintegration: `liftHalt` drives `halted ->
      reintegrating`; per-scope re-admission re-evaluates admission via a
      re-sync (FR-004, the `liftRevocationCore` "lifting alone does not
      re-admit" precedent, `revocations.ts:259`); `state -> lifted` only
      when every affected scope has re-admitted; each re-admission appends
      a per-engine timestamp to `acks` (`kind:'lift'`).
- [ ] T017 AC-4 reintegration-leg test: lift requires a human actor id and
      fresh re-validation; the scanner / service identity is rejected;
      per-engine acknowledgment timestamps exist for both the halt and the
      lift.
- [ ] T018 Gate PR-3: frontmatter unchanged unless new files appear;
      registry -> golden (only if frontmatter moved) -> index; `make
      pr-prep`.

## Phase 3.1 (PR-3.1): Ack-ledger hardening (FR-004 follow-ups)

Two follow-ups from the PR #502 reintegration fix (spec.md `## Deferred
hardening (Phase 3.1)`). Both harden the `org_halts.acks` ledger against
replay; neither blocks Phase 4 or Phase 5. Land as one small PR. Not on the
critical path to the Phase 5 drill.

- [x] T023 Symmetric halt-ack write-path guard: `orgHaltAckDispatch`
      (`api/sync/service.ts`) appends a `kind:'halt'` ack only while
      `row.state === "halted"`; a halt-ack arriving after the scope moved
      to `reintegrating` / `lifted` is dropped as a benign no-op (the
      mirror of the lift-ack guard PR #502 added, `return
      "not-halted"`-style). Regression tests: a stale halt-ack while
      `reintegrating` and while `lifted` does not widen the recorded
      halt-acker set.
- [x] T024 Dropped-ack audit trail: emit `FACTORY_ORG_HALT_ACK_DROPPED`
      (new `api/factory/auditActions.ts` constant + union member, the T003
      pattern) or a `dropped:true` field on the existing engine-ack audit,
      on every drop path (`not-reintegrating`, `duplicate`, and the T023
      stale-halt-ack drop), so a dropped ack is visible in the audit chain
      rather than only `log.info`. Test: a dropped ack writes the audit row.
- [x] T025 Gate PR-3.1: paths are already 208-owned (`api/sync/service.ts`
      is the declared `org-halt-propagation` refine aspect;
      `api/factory/auditActions.ts` is `establishes:`), so no frontmatter
      change is expected; registry -> golden (only if frontmatter moves) ->
      index; `make pr-prep`.

## Phase 4 (PR-4, blocked on spec 205): Credential closure (FR-002 full)

- [ ] T019 Consume the spec 205 `nhi_delegation_index`: an `org`- or
      `agent-profile`-scoped halt sweeps the index (revoke every live
      chained NHI in scope, the spec 205 T021 cascade); a `project`-scoped
      halt rides grant refusal until the 205 index gains a `project_id`
      key (plan.md §Known gaps), which is a spec-205 coordination item.
      FR-002 reaches full closure here; until this phase, the shipped
      behavior is the degraded grant + session path.
- [ ] T020 Tests + gate PR-4: NHI revocation in scope proven; the
      degraded-path regression stays green; frontmatter `refines:` /
      `depends_on:` updated if the 205 index module is imported; registry
      -> golden -> index; `make pr-prep`.

## Phase 5 (PR-5): Drill (FR-005, AC-5)

- [x] T021 FR-005 drill: a `tests-e2e/fixtures/208/` seeded multi-session
      run + a harness drill against the `mock_statecraft` seam: pull the
      halt during the seeded run, assert the propagation bound (FR-003,
      connected paused at next boundary / disconnected refused at reconnect
      handshake), lift, assert staged reintegration (FR-004). Wire into the
      nightly lane (`.github/workflows/opc-e2e-nightly.yml`) if the harness
      does not auto-discover the test (co_authority with spec 187).
      Landed `product/apps/opc/tests-e2e/fixtures/208/org-halt-drill.e2e.ts`
      on the extended `mock_statecraft` seam (`push`/`waitForFrame` added to
      the spec-187 harness). Auto-discovered by the `fixtures/**/*.e2e.ts`
      glob, so no workflow edit was needed. Honest scope of the client drill:
      the **connected** leg is real (the seeded cockpit runs
      `on_org_halt_activated` and emits `org.halt.ack` for both the halt and
      the lift kinds, the FR-003/FR-004 audited ack); the literal
      pause-and-checkpoint of a running session is not asserted because
      seeding a live session needs a Tauri invoke the harness cannot reach
      (`withGlobalTauri` is off, no `window.__TAURI__`), so the ack is the
      propagation-bound evidence. The **disconnected** leg is modeled by the
      spec-187 `handshake-rejects` mode (the OPC sync client has no local
      halt-awareness; refusal is the server's job) and asserts the boot gate
      stays sticky. The **idle "next action refused"** leg (AC-1) is
      statecraft-side grant/registration refusal, covered by `orgHalt.test.ts`,
      not re-faked in the client drill. AC-5 ("green on a release candidate")
      is proven by the first nightly run after merge, which the T022 lifecycle
      flip depends on.
- [ ] T022 Gate PR-5 + closure: AC-1..AC-6 evidence sweep; lifecycle flips
      (`implementation:` per evidence; the `status: approved` flip is a
      separate named-trigger decision, not automatic, per the spec
      199/201/205 complete-but-draft precedent); registry -> golden ->
      index; `make pr-prep`.

## Dependencies

- T001 -> {T002, T004, T005} (table + helper before consults); T002 -> T004
      + T005 (the `isHaltedInScope` helper); T003 -> {T002, T004, T010}
      (audit constants); T006 last in Phase 1; T007 after the LAST Phase 1
      commit.
- T008 -> {T009, T010, T011} (envelope variants before producers /
      consumers); T012 -> T011 (the Rust path before its frame handler);
      T013 after T009-T012; T014 last in Phase 2.
- T015 + T016 -> T017; Phase 3 depends on Phase 2's broadcast + acks.
- T023 + T024 -> T025; Phase 3.1 depends on Phase 3 (the reintegration
      state machine + the `org_halts.acks` ledger it hardens). Not a
      dependency of Phase 4 or Phase 5.
- Phase 4 (T019) depends on spec 205 Phase 3 (its T020-T023); cross-spec
      gate, not landable until then.
- T021 depends on Phases 1-3 (a real pull-and-lift to drill); T022 is the
      closure gate.

## Out of scope (recorded, not lost)

- Single-run budget circuit-breaking (spec 202): the governor bounds one
  run; the switch stops the fleet.
- Automated halt triggers (anomaly-detection-initiated): this spec's actor
  is a human admin (the ASI08-honest division: automation proposes, a
  human pulls).
- Content quarantine semantics (spec 198 FR-010 owns the four-key
  lattice): this spec widens scope, it does not redefine keys.
- Cross-org / platform-global halt: the verb is org-scoped; a
  platform-operator global stop is a separate authority and spec.
- A `project_id` key on the spec 205 `nhi_delegation_index`: a spec-205
  coordination item that strengthens project-scoped NHI revocation; until
  it lands, project-scoped credential revocation rides grants.
- Multi-replica live broadcast fan-out: a `registry.ts` PubSub/Redis
  concern (registry-wide, not halt-specific); the outbox-durable broadcast
  is replica-safe for delivery on reconnect.
