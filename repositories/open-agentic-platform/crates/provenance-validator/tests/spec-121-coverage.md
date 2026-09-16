# Spec 121 — Success Criteria Coverage Map

This map traces every success criterion (SC) in
`specs/121-claim-provenance-enforcement/spec.md §6` to the test that
proves it. Future contributors who change validator behaviour can
re-run the named test to confirm the SC still holds; if a test moves
or is renamed, the corresponding row here MUST be updated in the same
PR.

## Status conventions

- `covered` — A test in this crate (`provenance-validator`) asserts the SC.
- `covered (cross-crate)` — The asserting test lives in another workspace
  crate (`factory-engine`, `factory-contracts`, …); the SC is still
  proven, just not in this crate's test binary.
- `deferred — see note` — The SC depends on a feature explicitly deferred
  to a later spec / phase. The note explains what is missing and what
  will close it.

## Map

| SC | Description (from §6) | Test path : test name | Crate | Status |
|----|-----------------------|-----------------------|-------|--------|
| SC-001 | Running validator on the example BRD in audit mode reports STK-13, INT-003, SN-022 as Rejected | `crates/provenance-validator/tests/sc001_audit.rs::sc001_audit_rejects_stk13_int003_sn022_against_fixture` | provenance-validator | covered |
| SC-002 | Fault-injected fabrication is blocked at the gate in STRICT mode 100% of the time | `crates/factory-engine/src/stages/quality_gates.rs::tests::strict_fabricated_claim_fails` | factory-engine | covered (cross-crate) |
| SC-003 | ASSUMPTION-tagged INT-* produces zero references in DDL/services/UI/tests; CI honor check confirms | `crates/factory-engine/src/stages/cascade_check.rs::tests::cascade_check_flags_vendor_reference` + `cascade_check_passes_clean_artifacts` + `per_anchor_invariant_rename_still_flagged` | factory-engine | covered (cross-crate) |
| SC-004 | Re-running Stage 1 on a project whose charter has been reworded preserves all BR-NNN IDs | `crates/factory-contracts/src/provenance.rs::tests::anchor_hash_property_reword_invariant` | factory-contracts | covered (cross-crate) — algorithm only; full id-registry round-trip deferred (see note SC-004) |
| SC-005 | Corpus replacement orphans every DERIVED claim whose quoteHash no longer matches | _none_ | _none_ | deferred — see note SC-005 |
| SC-006 | PERMISSIVE mode WARNs on Rejected; STRICT mode blocks | `crates/factory-engine/src/stages/quality_gates.rs::tests::permissive_fabricated_claim_warns` + `strict_fabricated_claim_fails` | factory-engine | covered (cross-crate) |
| SC-007 | Assumption budget exhaustion fails the gate cleanly with `assumption_budget_exceeded` | `crates/factory-engine/src/stages/quality_gates.rs::tests::budget_one_two_assumptions_fails_in_strict` + `budget_overflow_fails_even_in_permissive` | factory-engine | covered (cross-crate) |
| SC-008 | An ASSUMPTION whose `expiresAt` is in the past is treated as Rejected on next gate evaluation | `crates/factory-engine/src/stages/quality_gates.rs::tests::expired_assumption_fails_strict` + `crates/provenance-validator/tests/validator_tests.rs::t05_expired_assumption_becomes_rejected` | factory-engine + provenance-validator | covered (cross-crate) |
| SC-009 | Anchor-hash collision detection FAILs Stage 1 with `provenance.duplicate_anchor` | `crates/provenance-validator/tests/validator_tests.rs::t03_anchor_hash_collision_both_rejected` | provenance-validator | covered |
| SC-010 | Validator is byte-deterministic: two runs produce identical `provenance.json` | `crates/provenance-validator/tests/validator_tests.rs::t01_byte_determinism_two_runs_identical` + `crates/provenance-validator/tests/sc001_audit.rs::sc001_audit_is_deterministic_against_fixture` | provenance-validator | covered |
| SC-011 | Schema parity check FAILs CI on any drift between Rust and TS provenance schema | `crates/factory-contracts/src/provenance.rs::tests::fingerprint_drift_is_detected` + `tools/oap/schema-parity-check/index.mjs` (extended in Phase 1) | factory-contracts + tooling | covered (cross-crate) |
| SC-012 | `provenance-validator audit` on a legacy-corpus project produces `synthesizedCorpus: true` and approximately-correct findings | `crates/provenance-validator/tests/validator_tests.rs::t10_audit_synthesis_from_txt_flags_synthesized` + `crates/provenance-validator/tests/sc001_audit.rs::sc001_audit_rejects_stk13_int003_sn022_against_fixture` | provenance-validator | covered |

## Notes

### SC-004 — algorithm only

`anchor_hash_property_reword_invariant` covers the FR-011 normalisation
algorithm: a charter reword that swaps articles and modal verbs
produces the same `anchor_hash`, so the same `BR-NNN` ID would be
returned by an `id-registry.json` lookup. The full round-trip — mint
ID on first run, recover same ID on second run after reword,
zero-delta downstream artifacts — requires the live Stage 1 gate's
`id-registry.json` write path (FR-014 atomic counter), which Phase 4
deferred. Spec 122 (stakeholder-doc inversion) is the natural home for
the end-to-end fixture; the algorithm is the load-bearing piece and
is covered today.

### SC-005 — corpus drift workflow deferred

SC-005 requires the FR-022 corpus-drift workflow: when
`extractedCorpusHash` changes between runs, walk every prior `Derived`
claim's `quoteHash` against the new corpus, downgrade orphans to
`AssumptionOrphaned`, and emit a drift report. Phase 3 deferred this
explicitly: the `validate()` entry point only runs against the
*current* corpus and routes verify-time `HashMismatch` to a hard
`Rejected{quote_hash_mismatch}` per FR-020 (which catches forgery),
not to the orphan path. The orphan path activates between runs, not
at verify time, and is a separate operation.

This is genuinely uncovered. A partial test (e.g., manually
constructing an `AssumptionOrphaned` record and asserting the budget
gate handles it) would cover the *budget* invariant (already proven
by SC-007) but NOT the drift-detection invariant SC-005 names. To
keep the coverage map honest, SC-005 stays `deferred`. Closing it
requires:

1. A `compare_corpus_hashes(prev, current)` operation that walks
   prior `Derived` claims and re-runs `verify_citation`.
2. The `AssumptionOrphaned` route at the deferred `HashMismatch`
   branch (which today routes to `Rejected{quote_hash_mismatch}`).
3. A drift report artifact alongside `provenance.json`.
4. A test fixture with two corpus snapshots that exercises the path
   end-to-end.

This is its own spec issue; tracking it separately is the right call.

## Crate-by-crate test count

| Crate | Tests touching spec 121 |
|-------|------------------------:|
| factory-contracts | 24 (anchor_hash, quote_hash, schema fingerprint, ProvenanceConfig, AssumptionBudget) |
| provenance-validator | 65 (allowlist + corpus + citation + manifest + validator + bin + integration) |
| factory-engine | 16 (quality_gates + cascade_check) |
| desktop tauri | 4 (provenance commands) |
| desktop UI | 8 (ProvenanceReport + ProvenanceHealthPanel) |
| tools/oap/assumption-cascade-check | 4 (lib + bin) |
| **Total** | **~121 tests across 6 crates** |

Counts approximate as of Phase 7 close. Run
`cargo test --manifest-path crates/provenance-validator/Cargo.toml`
+ each adjacent crate's `cargo test` to verify the live count.
