---
id: "207-tamper-evident-audit-chain"
title: "Tamper-Evident Audit Log Chain (ASI observability principle)"
feature_branch: "feat/207-tamper-evident-audit-chain"
status: approved
implementation: complete  # All five ACs landed across four PRs: Phase 1 local chain + independent verifier (AC-1/AC-2/AC-5, policy-kernel); Phase 2a run-certificate anchoring (AC-3, factory-engine); Phase 2b server countersign + seal table (AC-4 server, statecraft) and producer session-audit chain (axiomregent); Phase 2b client (this PR, AC-4 close): the OPC duplex consumer reads closed segment heads off the shared chain dir, submits each over audit.segment.countersign_request at reconnect, stores the countersignature, and exposes the unanchored window via the audit_unanchored_window command. Locally verified: cargo check (opc lib) clean, 46 sync_client unit tests green (8 new for the AC-4 client). Hardened after adversarial review: single-flight sweep guard (no overlapping sweeps on reconnect churn), blocking file I/O offloaded to spawn_blocking, atomic seal-store write (temp+rename) that reports persist success, and a read size cap. FR-004 is the stated, bounded residual (not eliminated): the open segment plus closed-but-uncountersigned segments are the unanchored window.
kind: governance
domain: tooling
created: "2026-06-11"
authors: ["open-agentic-platform"]
language: en
summary: >
  Extend the proof-chain discipline from policy decisions to the audit
  surfaces themselves. Spec 047 hash-chains policy decision proofs, but
  the JSONL audit logs the platform actually accumulates (permission
  decisions per spec 068 NF-003, session activity, factory run logs) are
  plain append-only files: deletable, editable, and unanchored — failing
  the cross-cutting ASI 2026 observability principle ("immutable, signed,
  tamper-evident logs") and the ASI08/ASI10 logging mitigations that
  every incident reconstruction depends on. This spec chains audit
  records (each record carries the previous record's hash), anchors
  segment heads at rotation — run-scoped logs into the governance
  certificate's artifact list, session-scoped logs via the spec 198
  FR-014 platform countersign when connected, locally chained when
  offline — and ships an independent verifier that does not trust the
  producer. Honest scope: a chain makes tampering EVIDENT, not
  impossible; anchoring bounds (not eliminates) silent-truncation.
code_aliases: ["TAMPER_EVIDENT_AUDIT_CHAIN"]
compliance:
  - framework: "owasp-asi-2026"
    controls: ["ASI08", "ASI10"]
depends_on:
  - "047-governance-control-plane"
  - "068-permission-runtime"
  - "102-governed-excellence"
  - "198-factory-governance-envelope"
establishes:
  # FR-003 (Phase 1): the independent audit-chain verifier. Its home was left
  # open at filing ("home decided in plan.md") and is decided in plan.md: a
  # sister binary to verify_proof_chain, in policy-kernel.
  - unit: { kind: file, path: crates/policy-kernel/src/bin/verify_audit_chain.rs }
  # FR-003 end-to-end coverage: the verifier CLI exit-code contract (clean
  # exits 0, tampered exits non-zero naming the record, no-arg exits usage).
  - unit: { kind: file, path: crates/policy-kernel/tests/verify_audit_chain_cli.rs }
  # FR-002 (Phase 2a, AC-3): the run-audit chain writer (factory run audit
  # serialized as a hash-chained segment, reusing the policy-kernel primitive).
  - unit: { kind: file, path: crates/factory-engine/src/run_audit_chain.rs }
  # AC-3 end-to-end: anchored segment is tamper-evident under verify_certificate.
  - unit: { kind: file, path: crates/factory-engine/tests/run_audit_anchoring.rs }
  # FR-002 (Phase 2b, AC-4): the statecraft session-audit countersign handler
  # (platform seals a submitted segment head; spec 198 FR-014 keyless-local).
  - unit: { kind: file, path: platform/services/statecraft/api/factory/auditSegmentHandlers.ts }
  - unit: { kind: file, path: platform/services/statecraft/api/factory/auditSegmentHandlers.test.ts }
  # The session-audit-seal table (one countersigned-segment row per
  # org/session/segment; idempotent on resubmission).
  # FR-001/FR-002 (Phase 2b producer, PR1): the axiomregent session-audit-chain
  # integration test. Proves every governed tool dispatch is hash-chained and
  # the independent walker verifies it offline (the producer the AC-4 client
  # consumes; a consumer-only PR2 would be a dead consumer without it).
  - unit: { kind: file, path: crates/axiomregent/tests/session_audit_chain_test.rs }
extends:
  # Same precedent as specs 196, 194, 193, 187, 183: a new spec adds a row
  # to the featuregraph golden.
  - spec: "034-featuregraph-registry-scanner-fix"
    nature: additive
    unit: { kind: file, path: crates/featuregraph/tests/golden/features_graph.json }
  # Phase 1: the new [[bin]] target for verify_audit_chain is an additive
  # extension of the spec-047-owned policy-kernel manifest.
  - spec: "047-governance-control-plane"
    nature: additive
    unit: { kind: file, path: crates/policy-kernel/Cargo.toml }
  # Phase 2b (AC-4): the new "oap-audit-segment-countersign+jws" type is an
  # additive member of the FactoryJwsTyp union that spec 198 FR-014 owns. 207
  # uses the signing authority; it does not evolve 198's authority.
  - spec: "198-factory-governance-envelope"
    nature: additive
    unit: { kind: file, path: platform/services/statecraft/api/factory/signing-pure.ts }
refines:
  - aspect: "hash-chained-audit-records"
    unit: { kind: file, path: crates/policy-kernel/src/audit.rs }
  - aspect: "chain-reuse-for-audit"
    unit: { kind: file, path: crates/policy-kernel/src/proof_chain.rs }
  # Phase 2a (AC-3): emit_certificate writes + anchors the run-audit segment,
  # and the run accrues phase confirmations into a local audit trail.
  - aspect: "run-audit-emission-and-anchoring"
    unit: { kind: file, path: crates/factory-engine/src/bin/factory_run.rs }
  # Module registration for the run-audit chain writer.
  - aspect: "run-audit-module-registration"
    unit: { kind: file, path: crates/factory-engine/src/lib.rs }
  # Phase 2b (AC-4): the duplex audit.segment.countersign_request contract.
  - aspect: "audit-segment-countersign-contract"
    unit: { kind: file, path: platform/services/statecraft/api/sync/types.ts }
  # Phase 2b (AC-4): dispatch routing for the countersign request.
  - aspect: "audit-segment-countersign-dispatch"
    unit: { kind: file, path: platform/services/statecraft/api/sync/service.ts }
  # Phase 2b (AC-4): the session-audit-seal Drizzle table definition.
  - aspect: "session-audit-seal-table"
    unit: { kind: file, path: platform/services/statecraft/api/db/schema.ts }
  # Phase 2b (AC-4): the FACTORY_AUDIT_SEGMENT_COUNTERSIGNED audit action
  # (upgraded from a context reference, since 207 now authors this constant).
  - aspect: "audit-segment-countersign-action"
    unit: { kind: file, path: platform/services/statecraft/api/factory/auditActions.ts }
  # Phase 2b (AC-4): auditSegmentHandlers.test.ts is DB-bound, so it joins the
  # spec 211 encore-test lane (the vite.config.ts exclude list IS the lane
  # assignment; bare vitest would fail it on a missing ENCORE_RUNTIME_LIB).
  - aspect: "encore-test-lane-assignment"
    unit: { kind: file, path: platform/services/statecraft/vite.config.ts }
  # Phase 2b producer (PR1): the axiomregent router hash-chains every governed
  # tool-dispatch decision into the session audit chain (set_audit_chain +
  # record_audit, reusing the policy-kernel AuditLogger's log_value). This is
  # the LIVE producer the AC-4 countersign client consumes; it refines the
  # spec-073-owned router's dispatch-audit aspect (it does not evolve 073's
  # authority over the router).
  - aspect: "session-audit-chain-producer"
    unit: { kind: file, path: crates/axiomregent/src/router/mod.rs }
  # Phase 2b producer (PR1): main.rs attaches the chain under the agent data
  # dir (`<AXIOMREGENT_DATA_DIR>/audit`), the path the OPC desktop recomputes
  # to read closed segment heads for countersign.
  - aspect: "session-audit-chain-wiring"
    unit: { kind: file, path: crates/axiomregent/src/main.rs }
  # Phase 2b client (PR B2b, AC-4 close): the OPC duplex consumer reads closed
  # segment heads off the shared chain dir and submits each over the duplex
  # audit.segment.countersign_request (proven send_and_await_reply correlation),
  # stores the returned countersignature, and exposes the unanchored window via
  # the audit_unanchored_window command. Refines the spec-110-owned duplex
  # consumer's reply-correlation surface; it does not evolve 110's authority.
  - aspect: "audit-segment-countersign-client"
    unit: { kind: file, path: product/apps/opc/src-tauri/src/commands/sync_client.rs }
  # Phase 2b client (PR B2b): the unanchored-window query command is registered
  # on the desktop command surface so the FR-004 residual is cockpit-queryable.
  - aspect: "audit-segment-countersign-command-registration"
    unit: { kind: file, path: product/apps/opc/src-tauri/src/lib.rs }
references:
  - role: machinery
    unit: { kind: file, path: platform/services/statecraft/api/factory/signing.ts }
  - role: context
    unit: { kind: file, path: docs/owasp-agentic-top-10-2026.md }
---

# Feature Specification: Tamper-Evident Audit Log Chain

**Feature Branch**: `207-tamper-evident-audit-chain`
**Created**: 2026-06-11
**Status**: Draft (follow-on filed by the ASI gap-closure pass)
**Input**: The ASI 2026 gap analysis (2026-06-10) found: "Policy
decisions get hash-chained proof records, but session/permission JSONL
logs are plain files." Every ASI entry's forensic mitigation (ASI02 m8,
ASI08 m10, ASI09 m2, ASI10 m1) presumes logs an attacker — or a rogue
agent with filesystem access — cannot quietly rewrite.

## Purpose

OAP's flagship audit artifact, the governance certificate, already
embodies the right trust posture: self-authenticating hashes plus an
independent verifier that does not trust the producer (spec 102 FR-007).
The day-to-day audit surfaces do not. A JSONL file under the user's home
directory is exactly as trustworthy as the last process with write access
to it — which, in an agentic environment, includes the agents being
audited. ASI10's "review logs for stealth infiltration" is circular if
the rogue agent can edit the review's input.

The fix is the discipline OAP already owns, applied uniformly: chain,
anchor, verify independently.

## Functional requirements

> Refined from the filing sketch per the spec's own instruction; the
> plan.md decisions are folded in. Phase 1 (this implementation) lands
> FR-001, FR-003, and the LOCAL half of FR-002. Phase 2 lands the
> cross-repo anchoring (run certificate + platform countersign). See
> Sequencing and the Implementation log.

- **FR-001 — Hash-chained records.** Every audit record carries the hash
  of its predecessor (genesis-marked per segment), reusing the spec 047
  proof-chain linkage rather than inventing a second chain shape. Applies
  to the policy-kernel audit writer (permission decisions, spec 068
  NF-003 logs) and to factory run logs; statecraft-side audit rows
  (database-resident) declare their anchoring story in plan.md rather
  than pretending the same mechanism fits.
- **FR-002 — Segment anchoring at rotation.** Log rotation closes a
  segment with a head record (segment hash, record count, time range).
  Run-scoped segments anchor by entering the run's governance certificate
  artifact list — tampering then fails `verify-certificate` with the
  existing artifact-hash diagnostic. Session-scoped segments anchor via
  the platform countersign (spec 198 FR-014: statecraft seals, the local
  side holds no signing keys) when a platform connection exists; offline
  sessions chain locally and anchor retroactively at next connection,
  with the unanchored window visible — offline-first, honestly degraded,
  never silently unverifiable.
- **FR-003 — Independent verifier.** A `verify-audit-chain` verb (home
  decided in plan.md; the `verify-certificate` sister-binary pattern)
  walks a segment chain and exits non-zero naming the first broken
  record. It shares no state with the producer and runs offline for
  locally-chained segments.
- **FR-004 — Stated residual.** The chain detects modification and
  mid-chain deletion; it cannot detect deletion of an entire tail after
  the last anchor. The anchoring cadence is therefore the integrity
  budget: the residual window is bounded by rotation size/interval, and
  the spec records this as the accepted residual rather than implying
  tamper-proofness (the ASI08 residual-statement discipline).

> **Refinement (Phase 1 honesty).** "Detects modification" holds only
> against the external anchor. A self-referential chain catches edits that
> do NOT recompute downstream hashes (in-place edits, mid-segment deletion,
> reordering). It does NOT, on its own, catch an edit that re-establishes
> internal consistency: a writer of an OPEN, not-yet-anchored segment can
> re-genesis and recompute every `record_hash` (whole-segment rewrite,
> head-prefix deletion, tail deletion) and the walker passes. That entire
> class is the Phase 1 residual until FR-002 anchoring (run certificate /
> platform countersign, Phase 2) supplies the external trust root. The
> residual is therefore broader than tail deletion alone; it is bounded by
> the anchoring cadence, not eliminated by the chain.

## Acceptance criteria

> Phase 1 satisfies AC-1, AC-2, AC-5 (local, offline, deterministic,
> covered by `crates/policy-kernel` unit + CLI tests). AC-3 and AC-4
> (cross-repo anchoring) are Phase 2.

- **AC-1.** Flipping one byte in record N of a segment: the verifier
  exits non-zero naming record N.
- **AC-2.** Deleting a record mid-segment breaks the chain at the splice
  and is detected; truncating the tail past the last anchor is detected
  via the anchor's record count.
- **AC-3.** A run-scoped segment's head hash appears in the run
  certificate; `verify-certificate` fails after segment tampering.
- **AC-4.** An offline session produces locally-chained segments that
  verify offline; reconnecting anchors them and the unanchored window is
  queryable.
- **AC-5.** Rotation preserves continuity: segment N+1's genesis binds
  segment N's head.

## Out of scope

- WORM storage, HSM anchoring, external transparency logs — deployment
  hardening above the platform countersign is org infrastructure.
- The content of audit records (specs 047/068/172 own their schemas;
  this spec adds linkage and anchoring, not fields beyond them).
- Statecraft database audit-row immutability enforcement (DB-side
  append-only is an operational posture; the plan.md decides what the
  platform can honestly attest about its own tables).
- Tamper *prevention* — explicitly: this spec delivers evidence, not
  immunity (FR-004).

## Sequencing

FR-001 and FR-003 are implementable now (policy-kernel is local and the
chain shape exists). FR-002's countersign anchoring follows spec 198
phase 4 machinery (landed) and should ride the same key infrastructure,
not duplicate it.

## Implementation log

**Phase 1 (2026-06-19).** Local chain + independent verifier, in
`crates/policy-kernel`. Plan and decisions: `plan.md`.

- **FR-001 (done).** The spec 047 record-hash linkage was extracted into a
  content-agnostic primitive `proof_chain::link_record_hash(value,
  hash_field)`; `compute_record_hash` is now a thin wrapper over it
  (behaviour byte-identical, guarded by the existing spec 047 chain
  tests). `audit::AuditLogger` writes each JSONL record with
  `previous_record_hash` + `record_hash` computed through that primitive;
  a fresh segment is genesis-marked, and a process restart on a non-empty
  file recovers the chain head and continues unbroken.
- **FR-002 (local half done; cross-repo deferred).** Rotation closes a
  segment with a `segment_head` record (`segment_id`, `record_count`,
  first/last timestamp); the head hash becomes the next segment's genesis
  binding (continuity), and the `record_count` is the closed-segment
  truncation tripwire. Run-certificate and platform-countersign anchoring
  (AC-3, AC-4) are Phase 2.
- **FR-003 (done).** `verify_audit_chain` binary (sister to
  `verify_proof_chain`): walks a segment, recomputes hashes, checks links,
  validates a trailing head's count, and exits non-zero naming the first
  broken record. `verify_audit_chain(records, expected_genesis)` is the
  unit-testable core; the binary is a thin CLI shell.
- **FR-004 (stated).** Until FR-002 anchoring lands (Phase 2), the open
  not-yet-anchored segment is the residual: any internally-consistent
  rewrite (whole-segment re-hash, head-prefix deletion, tail deletion)
  passes the self-referential walker. The chain catches only edits that
  fail to recompute downstream hashes. The 10 MB rotation size bounds the
  unanchored window; the external anchor closes the class. See the FR-004
  refinement note above (corrected after local review).

Carve-out (plan.md decision 3): statecraft database-resident audit rows
(`auditActions.ts`) are NOT file-chained; their honest anchoring story is
the platform countersign plus append-only DB posture, not the per-record
file chain. No statecraft code changes in Phase 1.

Coupling note: the implementation PR adds `establishes:` edges for the new
verifier binary and its CLI test, and an additive `extends:` edge on the
spec-047-owned `crates/policy-kernel/Cargo.toml` for the new `[[bin]]`
target, per the spec-196 "edge lands with the code" precedent.

**Phase 2a (2026-06-19, PR A): run-certificate anchoring (AC-3).** Factory
runs now emit a hash-chained run-audit segment, anchored into the run
governance certificate so `verify-certificate` catches tampering.

- **Chain (FR-001).** `crates/factory-engine/src/run_audit_chain.rs`
  serializes the run's audit trail to `<run_dir>/run-audit/run-audit.jsonl`,
  each record carrying `previous_record_hash` + `record_hash` via the SAME
  `policy_kernel::proof_chain::link_record_hash` primitive (genesis link
  `genesis:<run_id>`). `verify_audit_chain` (content-agnostic) validates it.
- **Anchor (FR-002, AC-3).** `factory-run`'s `emit_certificate` writes the
  segment then builds the certificate with stage list `OAP_STAGE_IDS +
  "run-audit"`, so the existing `stage_record_for` scan binds the segment
  file's SHA-256 into the cert and the existing `verify_certificate`
  artifact-hash loop catches any tamper. No bespoke certificate code: the
  segment is a stage artifact. Proven end-to-end by
  `tests/run_audit_anchoring.rs` (clean verifies; tampered segment fails,
  diagnostic names the segment).
- **Population.** The CLI's `FactoryPipelineState` is distinct from the
  harness `PipelineState` that carries the OPC-side audit vec (which is why
  `record_audit` was never wired), so the run audit is a binary-local
  `Vec<AuditEntry>` accruing a `StageConfirmed` per phase boundary
  (phase-1 / transition / phase-2). Per-gate recording inside the dispatch
  path is a deliberate follow-up; the mechanism is complete and anchored.
- **Coupling:** `establishes:` the new writer + anchoring test; `refines:`
  `factory_run.rs` + the factory-engine `lib.rs` module registration. No
  `governance_certificate.rs` change (the stage-scan is reused as-is).

**Phase 2b server side (2026-06-19, PR B1): platform countersign (AC-4,
statecraft half).** Statecraft can now seal a session-scoped audit segment
head (spec 198 FR-014: the platform signs, the local side is keyless).

- A new duplex message `audit.segment.countersign_request` carries
  `{sessionId, segmentId, segmentHeadHash, segmentRecordCount, first/lastRecordAt}`;
  `auditSegmentHandlers.ts` (mirroring `countersignRunCertificate`) signs the
  head with a new domain typ `oap-audit-segment-countersign+jws` via the
  existing `signFactoryJws`, and persists a row in the new
  `factory_session_audit_seals` table, idempotent on
  `(org_id, session_id, segment_id)` so reconnect resubmission is safe.
- The seal attests "the platform observed this segment head from this
  org/session at iat"; it does not gate on factory admission (unlike the
  run-grant countersign), because audit sealing is a universal observability
  capability, not an execution grant. The submitted head hash is taken on
  trust (the platform attests observation, not content; the local chain still
  has to match the head). The duplex auth layer supplies the authenticated
  org/session.
- The new typ is an additive member of the spec-198-owned `FactoryJwsTyp`
  (declared via an additive `extends` edge on 198). Tests:
  `auditSegmentHandlers.test.ts` (5 cases: positive, idempotent resubmit,
  distinct segments/sessions, refusal when unconfigured); grant tests
  unchanged (17/17).

**Phase 2b producer (2026-06-20, PR B2a): the local session audit chain.**
A pre-flight gap found while scoping the AC-4 client: the original B2 plan
("the local side accumulates unanchored segment heads") presumed a local
session audit chain that did **not exist** in production. Phase 1 built
`AuditLogger` + `PermissionRuntime::with_audit_logger`, but `with_audit_logger`
had zero callers and `PermissionRuntime` was constructed nowhere; the live
governed-tool permission path is axiomregent's `policy_preflight_response` /
`audit_tool_dispatch`, not the dormant spec-068 runtime. A consumer-only PR
would have been a dead consumer. Resolution (architect): producer-first.

- **Primitive (FR-001).** `policy_kernel::audit::AuditLogger` gains a
  content-agnostic `log_value(serde_json::Value)`; `log(AuditEntry)` is now a
  thin typed wrapper over it (behaviour byte-identical, guarded by the Phase 1
  chain tests). This mirrors the Phase 2a precedent of reusing the chain
  primitive content-agnostically rather than forcing a typed record shape.
- **Producer.** The axiomregent `Router` hash-chains **every** governed
  tool-dispatch decision (allowed / denied / allowed_no_lease /
  denied_no_lease / policy_denied) into a rotating session segment via a new
  `record_audit` helper (forwards via Seam B AND chains), reusing the same
  `audit_tool_dispatch` records already forwarded to the platform. The chain is
  attached by `set_audit_chain` (mirroring `set_preflight_checker`) at
  `<AXIOMREGENT_DATA_DIR>/audit/permissions.jsonl`. Keyed by the agent process
  instance: the duplex `sessionId` only arrives at `sync.hello`, after the
  sidecar is already spawned, so it cannot key the chain at startup.
- **Cross-process handoff.** The producer runs in the axiomregent subprocess;
  the AC-4 client (PR B2b) runs in the OPC Tauri process. They share disk: the
  Tauri parent pins `AXIOMREGENT_DATA_DIR` under `app_data_dir`, so the desktop
  recomputes the identical chain path to read closed segment heads. No IPC.
- **Coupling:** `establishes:` the integration test; `refines:` the spec-073
  router (`mod.rs`) + `main.rs`; the `audit.rs` change rides the existing
  `hash-chained-audit-records` refines edge.

**Phase 2b client side (PR B2b, DONE): OPC-side consumption.** Closes AC-4
end-to-end. The OPC duplex consumer (`commands/sync_client.rs`) now:

- Recomputes the producer's chain dir off the same `app_data_dir` the sidecar
  pins as `AXIOMREGENT_DATA_DIR` (`sidecars::spawn_axiomregent`), set on the
  `SyncClientInner` at spawn time. No IPC: the producer (axiomregent subprocess)
  and this client (Tauri process) share disk.
- On `sync.hello` (the moment the duplex session id arrives), spawns a detached
  sweep that enumerates closed (rotated) segments `permissions.jsonl.1..=5`,
  reads each trailing `segment_head`, skips those already in the local seal
  store (`countersigns.json`), and submits the rest over
  `audit.segment.countersign_request` using the proven `send_and_await_reply`
  reply-correlation (shared with grant + cert countersign). Each returned
  countersignature is persisted to the seal store. A refusal is logged and
  skipped; a transport failure stops the sweep and retries on next reconnect.
- Exposes the unanchored window (the open segment plus any
  closed-but-uncountersigned segments, the FR-004 bound) via the
  `audit_unanchored_window` Tauri command, so the residual is cockpit-queryable
  (AC-4 "the unanchored window is queryable").

The local side holds no signing keys (spec 198 FR-014): it attests the head
hash + metadata; statecraft signs. The seal upsert is idempotent on
`(org, session, segment)`, so reconnect resubmission is safe.

- **Coupling (B2b):** `refines:` `commands/sync_client.rs` (the AC-4 client
  behaviour on the spec-110-owned duplex consumer) + `src-tauri/src/lib.rs`
  (the query command registration); behaviour-refined, not authority-evolved.


## Security hardening amendment (2026-07-02)

Audit-log segment rotation no longer silently discards write, rename, or reopen errors: every previously swallowed failure on the tamper-evident chain segment-head write, the rotation renames, and the live-segment reopen is now logged, so a rotation fault cannot make future audit writes go dark unnoticed.

Recorded during the cross-subsystem security-hardening sweep; couples the security fixes in the code paths this spec authors to their owning spec per the spec 127 coupling gate.
