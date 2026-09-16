# Spec 122 — Success Criteria Coverage Map

Each `SC-NNN` from `specs/122-stakeholder-doc-inversion/spec.md` §6 maps
to at least one passing test. New contributors verifying the spec is
honoured can run the named test and trace the assertion back to the
SC text.

| SC | Description | Test | Path |
|----|-------------|------|------|
| SC-001 | Synthetic Globex scope flip blocks QG-CD-01 100% of the time. | `sc_001_scope_flip_blocks_gate` (kind-change pairing via Jaccard), `sc_001_drives_through_run_stage_cd_with_synthetic_brd` (body-regex via run_stage_cd), `scope_when_anchor_kind_changes` (unit), `scope_class_fires_on_body_scope_flip_phrase` (unit) | `crates/factory-engine/tests/spec_122_e2e.rs`, `crates/factory-engine/src/stages/stage_cd_comparator.rs` |
| SC-002 | Wording-only diff (anchorHash matches, no scope/entity/owner/citation deltas) passes the gate. | `wording_when_anchor_hash_matches_and_body_rewords` + `passes_with_warnings_on_wording_only` | `crates/factory-engine/src/stages/stage_cd_comparator.rs`, `stage_cd_gate.rs` |
| SC-003 | Bootstrap on a fresh project runs Stage CD in `seed` mode and does not block the gate. | `seed_mode_when_authored_absent` | `crates/factory-engine/src/stages/stage_cd.rs` |
| SC-004 | Reclassification migration on synthetic legacy project: moves files, inserts anchors, runs spec-121 validator, produces report flagging Globex. | `sc_004_reclassification_migration_on_synthetic_shape` (e2e) + the unit suite at `migration::stakeholder_docs::tests::*` | `crates/factory-engine/tests/spec_122_e2e.rs`, `crates/factory-engine/src/migration/stakeholder_docs.rs` |
| SC-005 | Authored citation whose `quoteHash` no longer matches → orphaned → diff `citation` → gate blocks. | `citation_class_fires_when_citation_orphaned`, `section_level_citations_revalidate_via_spec_121` | `crates/factory-engine/src/stages/stage_cd_comparator.rs` |
| SC-006 | Diff classification is byte-deterministic. | `stage_cd_diff_is_byte_deterministic` | `crates/factory-engine/src/stages/stage_cd_comparator.rs` |
| SC-007 | Force-approve requires non-empty reason; empty rejected, audit-logged with full identity. | `force_approve_rejects_empty_reason`, `force_approve_rejects_whitespace_only_reason`, `force_approve_accepts_non_empty_reason_and_audit_logs` | `crates/factory-engine/src/stages/stage_cd_actions.rs` |
| SC-008 | Authored docs NEVER modified by Stage CD without explicit `Accept candidate`. | `compare_mode_does_not_modify_authored_doc_bytes` (Phase 3) + the e2e fixture's `before == after` byte check | `crates/factory-engine/src/stages/stage_cd.rs`, `tests/spec_122_e2e.rs` |
| SC-009 | `stakeholder-doc-lint` emits W-122-001..W-122-005 across fixtures covering each condition. | `w_122_001_fires_on_anchorless_heading`, `w_122_002_fires_on_version_bump_without_applied_from`, `w_122_003_fires_on_duplicate_anchor`, `w_122_004_fires_on_unknown_citation_source`, `w_122_005_fires_on_unallowed_external_entity` | `tools/oap/stakeholder-doc-lint/src/lib.rs` |
| SC-010 | Migration is idempotent (re-run produces zero file mutations). | `migration_is_idempotent` (unit) + `sc_004_reclassification_migration_on_synthetic_shape` (e2e - re-runs via `AlreadyMigrated`) | `crates/factory-engine/src/migration/stakeholder_docs.rs`, `tests/spec_122_e2e.rs` |
| SC-011 | Seed mode does NOT write to the project workspace; only artifact-store candidates created. | `seed_mode_does_not_create_anything_under_project_workspace` | `crates/factory-engine/src/stages/stage_cd.rs` |
| SC-012 | Schema parity check fails CI on any drift between `stakeholder_docs.rs` and the (eventual) TS mirror. | `fingerprint_drift_is_detected` (Rust-side regression) + the null-safe TS-mirror block in `tools/oap/schema-parity-check/index.mjs` (activates when the TS mirror lands) | `crates/factory-contracts/src/stakeholder_docs.rs`, `tools/oap/schema-parity-check/index.mjs` |

## Cross-cutting load-bearing tests (not tied to a single SC)

| Invariant | Test | Path |
|-----------|------|------|
| FR-027 anchor_hash UNCHANGED at the comparator layer. | `comparator_uses_spec_121_anchor_hash_unchanged` | `crates/factory-engine/src/stages/stage_cd_comparator.rs` |
| FR-028 W-122-003 (duplicate anchor) blocks the comparator. | `duplicate_anchor_in_authored_doc_blocks_comparator` | `crates/factory-engine/src/stages/stage_cd_comparator.rs` |
| FR-036 no-reverse-cascade — authored-doc edit between runs does not modify Stage 1 outputs. | `authored_doc_edit_between_runs_does_not_modify_stage1_outputs` | `crates/factory-engine/src/stages/stage_cd.rs` |
| FR-026 co-approval policy — scope/ownership force-approve requires two distinct actors. | `co_approval_policy_blocks_single_force_approve_on_scope`, `co_approval_policy_passes_with_two_distinct_force_approves`, `co_approval_two_actions_from_same_actor_does_not_pass` | `crates/factory-engine/src/stages/stage_cd_gate.rs` |
| FR-025 atomic authored-doc rewrite via tmp-rename. | `accept_candidate_writes_atomically_via_tmp_rename` | `crates/factory-engine/src/stages/stage_cd_actions.rs` |
| FR-025 multi-section preservation — accept at one anchor preserves other sections byte-for-byte. | `accept_candidate_preserves_other_sections_byte_for_byte` | `crates/factory-engine/src/stages/stage_cd_actions.rs` |
| FR-019 priority chain — ownership before external-entity for known-owner changes. | `ownership_class_fires_when_owner_token_changes` | `crates/factory-engine/src/stages/stage_cd_comparator.rs` |
| Approval ledger derived from persisted DiffResolution (single source of truth for the gate). | `approval_ledger_from_diff_round_trips_resolutions` | `crates/factory-engine/src/stages/stage_cd_gate.rs` |

## Running the suite

```bash
# All Phase 4–7 unit tests
cargo test --manifest-path crates/factory-engine/Cargo.toml --lib stages::stage_cd

# Phase 1 lint
cargo test --manifest-path tools/oap/stakeholder-doc-lint/Cargo.toml

# Phase 2 migration unit suite
cargo test --manifest-path crates/factory-engine/Cargo.toml --lib migration::

# Phase 8 end-to-end fixture
cargo test --manifest-path crates/factory-engine/Cargo.toml --test spec_122_e2e

# Schema parity (covers stakeholder_doc fingerprint)
make ci-schema-parity
```
