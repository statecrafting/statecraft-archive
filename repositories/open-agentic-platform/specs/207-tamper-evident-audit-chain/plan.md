# Implementation Plan: Tamper-Evident Audit Log Chain (spec 207)

> Refines the spec sketch into firm decisions, per the spec's own
> "refine before implementation" instruction. The spec body's
> FR-001..FR-004 and AC-1..AC-5 are sharpened in lockstep with this plan.

## Decision summary (the deferrals the spec left to plan.md)

1. **Chain shape reuse (FR-001).** The audit chain reuses the spec 047
   linkage discipline, not a second chain shape. `proof_chain.rs` already
   computes `record_hash = sha256(canonical_json(record without
   record_hash))`. We extract that into a content-agnostic primitive
   `link_record_hash(value, hash_field)` and make the existing
   `compute_record_hash` a thin wrapper. The audit writer consumes the
   same primitive. This is the `chain-reuse-for-audit` refinement on
   `proof_chain.rs`.

2. **Verifier home (FR-003).** A standalone `verify_audit_chain` binary
   under `crates/policy-kernel/src/bin/`, mirroring the existing
   `verify_proof_chain` sister binary (which itself mirrors
   factory-engine's `verify_certificate`). It shares no state with the
   producer and runs offline. The walk logic lives in `audit.rs`
   (`verify_audit_chain`) so it is unit-testable without spawning a
   process; the binary is a thin CLI shell.

3. **Statecraft DB audit rows (FR-001 carve-out).** Database-resident
   audit rows (`auditActions.ts`) are NOT file-chained by this spec.
   Honest posture: their anchoring story is the platform countersign
   (spec 198 FR-014) plus an append-only DB operational posture, not the
   per-record file chain. This is recorded here rather than pretending
   the file mechanism fits a relational table. No statecraft code changes
   in this phase.

4. **Anchoring split (FR-002).** The LOCAL half (segment head at
   rotation + cross-segment continuity) lands now because AC-2 and AC-5
   require it and it is fully offline. The CROSS-REPO half (run-scoped
   segments entering the governance certificate artifact list;
   session-scoped segments countersigned by statecraft per spec 198
   FR-014) is Phase 2 and rides the existing key infrastructure rather
   than duplicating it.

## Phase 1 (this PR): local chain + verifier

Scope = FR-001 + FR-003 + the local half of FR-002. Satisfies AC-1, AC-2,
AC-5 with local-only, deterministic tests.

### P1-a `proof_chain.rs` (refines: chain-reuse-for-audit)
- Add `pub fn link_record_hash(value: serde_json::Value, hash_field: &str)
  -> String`: strips `hash_field` from the object, canonicalises, returns
  `sha256:<hex>` via the existing `sha256_hex`.
- Reimplement `compute_record_hash` as `link_record_hash(value,
  "record_hash")`. Behaviour is byte-identical (regression-guarded by the
  existing spec 047 chain tests, which must stay green).

### P1-b `audit.rs` (refines: hash-chained-audit-records)
- Extend the written line with `previous_record_hash` and `record_hash`.
- `AuditLogger` carries `last_record_hash` (the chain head) and a
  `segment_id`.
- On open: if the file is non-empty, parse the last line and continue from
  its `record_hash`; if new/empty, seed a per-segment genesis marker
  `genesis:<segment_id>` (spec: "genesis-marked per segment").
- On `log`: build the line body (`timestamp` + entry fields +
  `previous_record_hash`), compute `record_hash` via `link_record_hash`,
  write, advance `last_record_hash`.
- On rotation (`maybe_rotate`): before moving the file, append a
  **segment head** line `{segment_head:true, segment_id, record_count,
  first_timestamp, last_timestamp, previous_record_hash, record_hash}`.
  The head's `record_hash` becomes the new chain head; the next segment's
  genesis `previous_record_hash` binds it (AC-5 continuity). The head's
  `record_count` is the truncation tripwire (AC-2).
- `pub fn verify_audit_chain(lines: &[serde_json::Value], expected_genesis:
  Option<&str>) -> Result<(), AuditChainError>`: walks records; for each
  recomputes `record_hash` (mismatch => name the index, AC-1); checks
  `previous_record_hash` links to the prior `record_hash` (broken link =>
  name the index, AC-2 mid-segment deletion); the first record's
  `previous_record_hash` must equal the genesis marker (or
  `expected_genesis` when chaining continuity); if a segment head is
  present, its `record_count` must equal the count of preceding data
  records (AC-2 closed-segment tail truncation).
- `AuditChainError` enum mirrors `ProofChainError`'s indexed-diagnostic
  shape.

### P1-c `verify_audit_chain` binary (NEW; establishes)
- `crates/policy-kernel/src/bin/verify_audit_chain.rs`: reads a JSONL
  segment file, parses lines to `Vec<Value>`, calls
  `audit::verify_audit_chain`, exits 0 / 1 (broken: prints the first bad
  record index and reason) / 2 (usage).
- `Cargo.toml`: new `[[bin]]` target. Re-export `verify_audit_chain` +
  `AuditChainError` from `lib.rs`.

### P1-d tests
- spec 047 regression: existing `proof_chain` tests stay green
  (proves the primitive extraction is behaviour-preserving).
- AC-1: flip one byte in record N => verifier errors naming N.
- AC-2: delete a mid-segment record => broken link at the splice;
  truncate a closed segment's tail => `record_count` mismatch.
- AC-5: rotation writes a head; next segment genesis binds the head.
- continuity-across-restart: reopen a logger on a non-empty file, log
  again, full chain verifies.

## Phase 2 (follow-on, NOT this PR): cross-repo anchoring

- **AC-3:** run-scoped segment head hash enters the run governance
  certificate artifact list (factory-engine); `verify-certificate` fails
  after tampering. Rides spec 102 / 198 phase-4 cert machinery.
- **AC-4:** session-scoped segments countersigned by statecraft (spec 198
  FR-014); offline sessions chain locally and anchor retroactively at next
  connection, with the unanchored window queryable. Offline-first,
  honestly degraded.

## FR-004 residual (stated, not eliminated)

The chain detects modification and mid-chain deletion. It cannot detect
deletion of an entire tail after the last anchor inside the open segment.
The anchoring cadence (rotation size/interval) IS the integrity budget:
the unanchored residual window is bounded by `MAX_SIZE_BYTES` (10 MB) per
segment. Recorded as accepted residual per the ASI08 residual-statement
discipline, not implied tamper-proofness.

## Coupling edges (land in the implementation PR, per the 196 precedent)

- `establishes:` `crates/policy-kernel/src/bin/verify_audit_chain.rs` (new
  verifier binary; FR-003 home was open at filing, decided here).
- `extends:` (additive) `crates/policy-kernel/Cargo.toml` (new `[[bin]]`
  target on the spec-047-owned manifest).
- `extends:` `crates/featuregraph/tests/golden/features_graph.json`
  (already declared; regenerate the golden after implementation).
- `refines:` `audit.rs` + `proof_chain.rs` (already declared).

## Verification commands

```bash
cargo test --manifest-path crates/policy-kernel/Cargo.toml
cargo build --release --manifest-path crates/policy-kernel/Cargo.toml --bin verify_audit_chain
make pr-prep   # regenerate codebase index + coupling gate vs origin/main
```

## Phase 2: cross-repo anchoring (FR-002, AC-3 + AC-4)

Phase 2 closes the open-segment residual by giving the chain an external
trust root. It ships as TWO PRs so the self-contained half lands first.

### Phase 2a (PR A): run-certificate anchoring (AC-3)

Factory runs gain a hash-chained run-audit segment, anchored into the run
governance certificate so `verify-certificate` catches tampering.

- **Run audit content.** `crates/factory-engine/src/harness_state.rs`
  `record_audit` exists but is never called. Wire it at the run lifecycle
  points in `crates/factory-engine/src/bin/factory_run.rs` (run start, each
  phase dispatch, transition, completion/halt) so the run accrues a real
  audit trail in `pipeline_state.audit` (factory_contracts `AuditEntry`:
  `{timestamp, event, stage, details}`).
- **Chain + write.** At run end, serialize `pipeline_state.audit` into a
  hash-chained JSONL segment at `<run_dir>/run-audit/run-audit.jsonl`. Each
  record is the `AuditEntry` JSON plus `previous_record_hash` +
  `record_hash`, computed through `policy_kernel::proof_chain::link_record_hash`
  (the SAME primitive the permission chain uses, FR-001). Genesis link is
  `genesis:<run_id>`. A new helper in factory-engine (e.g.
  `run_audit_chain.rs`) owns this; `verify_audit_chain` (content-agnostic)
  validates it.
- **Anchor.** Add a `run-audit` stage record to the certificate with
  `artifact_hashes = {"run-audit.jsonl": sha256(file)}` BEFORE the cert is
  hashed/signed. The existing `verify_certificate` artifact loop
  (`governance_certificate.rs`) reads `<run_dir>/run-audit/run-audit.jsonl`,
  re-hashes, and fails on any tamper (AC-3) with the existing artifact-hash
  diagnostic. Whole-file anchoring is the literal FR-002 reading ("segments
  anchor by entering the artifact list"); the per-record chain supplies the
  granular + offline story.
- **Coupling (PR A):** 207 `refines:` `factory_run.rs` (run-audit wiring),
  `harness_state.rs` (record_audit activation), `governance_certificate.rs`
  (the run-audit stage); `establishes:` the new `run_audit_chain.rs`. The
  cert crate already depends on policy-kernel.
- **Tests:** a run produces a verifying segment; tampering the segment file
  fails `verify-certificate`; `verify_audit_chain` passes on the segment.

### Phase 2b (PR B): platform countersign (AC-4)

Session-scoped segments are countersigned by statecraft (spec 198 FR-014:
statecraft seals, the local side is keyless), with offline-first retroactive
anchoring. Cross-repo; lands after 2a.

- **New duplex message** `audit.segment.countersign_request` /
  `audit.segment.countersign` in `sync/types.ts` carrying
  `{sessionId, segmentId, segmentHeadHash, segmentRecordCount, first/lastRecordAt}`.
- **New handler** `factory/auditSegmentHandlers.ts` (counterpart to the
  spec-198-owned `grantDuplexHandlers.ts`), signing with a NEW domain typ
  `oap-audit-segment-countersign+jws` via the existing `signFactoryJws`.
- **New table** `factory_session_audit_seals` (migration 45+): per
  `(org_id, session_id, segment_id)`, head hash, record_count, `unanchored`
  flag, `countersign_jws`, `countersigned_at`. Distinct from
  `factory_run_grants` (session scope, no seq/expiry, durability not expiry).
- **Offline-first.** The local side accumulates unanchored segment heads and
  submits them at next connection; the `unanchored` flag + the gap between
  local `last_record_at` and platform `countersigned_at` is the queryable
  window (FR-004 bound).
- **Coupling (PR B):** the `FactoryJwsTyp` union lives in spec-198-owned
  `signing-pure.ts`; 207 takes an additive `extends:` edge on it for the new
  typ (does not evolve 198's authority). 207 `establishes:`
  `auditSegmentHandlers.ts` + the migration; `refines:` `sync/service.ts`
  + `sync/types.ts` (dispatch + message shapes). Verify the coupling gate's
  candidate-owner list at PR time.
- **Risk:** touches the duplex/sync surface. PR B is sequenced after the
  `~/Dev` lane's 215 deploy/verify settles to avoid runtime ambiguity.

### Phase 2b split (revised 2026-06-20): producer-first

Implementation revealed PR B's plan had a hidden assumption. "The local side
accumulates unanchored segment heads" presumed a running local session audit
chain. There was none: Phase 1's `AuditLogger` is real but instantiated by zero
production code (`with_audit_logger` has no callers; `PermissionRuntime` is
constructed nowhere). The live governed-tool permission path is axiomregent's
`policy_preflight_response` / `audit_tool_dispatch`, not the dormant spec-068
runtime. A consumer-only client PR would be a dead consumer. So PR B is split:

- **PR B1 (server, DONE, #394 / `0889b27e`).** Statecraft countersign handler,
  seal table, signing typ, duplex dispatch. As above.
- **PR B2a (producer, THIS PR).** Wire the live session audit chain in
  axiomregent so a real chain runs, rotates, and emits closed segment heads.
  - `policy_kernel::audit::AuditLogger::log_value(Value)` (content-agnostic;
    `log(AuditEntry)` becomes a thin wrapper). The same primitive-reuse posture
    as Phase 2a's run-audit chain.
  - The axiomregent `Router` chains EVERY governed tool-dispatch decision via a
    `record_audit` helper (forward + chain) at the existing `audit_tool_dispatch`
    chokepoint; `set_audit_chain` attaches it at
    `<AXIOMREGENT_DATA_DIR>/audit/permissions.jsonl` (mirrors
    `set_preflight_checker`). Keyed by the agent process instance (the duplex
    `sessionId` arrives only at `sync.hello`, post-spawn).
  - Cross-process handoff to B2b: the producer runs in the axiomregent
    subprocess, the client in the Tauri process; they share disk via the
    parent-pinned `AXIOMREGENT_DATA_DIR`. No IPC.
  - **Coupling (B2a):** `establishes:` `crates/axiomregent/tests/session_audit_chain_test.rs`;
    `refines:` `crates/axiomregent/src/router/mod.rs` + `crates/axiomregent/src/main.rs`
    (spec-073-owned, behaviour-refined, not authority-evolved); the `audit.rs`
    change rides the existing `hash-chained-audit-records` edge.
- **PR B2b (client, NEXT).** OPC Tauri reads closed segment heads off the shared
  chain dir, submits each over the duplex `audit.segment.countersign_request` at
  reconnect (the proven `send_and_await_reply`/`reply_waiters` correlation),
  stores the returned countersignature, and exposes the unanchored window. The
  open segment plus any closed-but-uncountersigned segments ARE the FR-004
  window; submitting only closed (rotated) heads is faithful to that residual.
