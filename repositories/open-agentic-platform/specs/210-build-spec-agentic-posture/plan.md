# Implementation Plan: 210-build-spec-agentic-posture

Governs the OAP-side implementation of the `agentic_posture` Build Spec
field, its certificate binding, the SBOM falsifiability cross-check, and
the governed-posture envelope bridge. All FR-001 through FR-004 land in
one OAP PR.

## Design decisions (resolved from the sketch)

1. **Field shape.** `agentic_posture` is a single top-level Build Spec
   object `{ posture, surfaces[] }`. `posture` is a closed enum
   (`none | declared | governed`). Each surface is
   `{ kind, description, governance_envelope? }`. `kind` is a closed enum
   (`model-api | tool-surface | memory-persistence | human-approval-point`).
   The Rust field is `Option<AgenticPosture>`: `None` (absent) resolves to
   defaulted `none` at binding time. Mirrors the spec 197
   `implementation_status` optional-additive precedent.

2. **Certificate binding is a top-level block, not nested in
   `BuildSpecRecord`.** Every recent binding (corpus 1.6.0, SBOM 1.7.0,
   budget 1.8.0) is an optional top-level `skip_serializing_if` block
   inside the hash + signature. `agenticPostureBinding`
   (`{ posture, defaulted, surfaces }`) follows that precedent exactly;
   `CERTIFICATE_VERSION` 1.8.0 to 1.9.0.

3. **Watchlist home.** `standards/schemas/factory/agentic-sdk-watchlist.yaml`
   (versioned with the standard, human-auditable), embedded into
   `factory-engine` via `include_str!` so the verifier binary stays
   self-contained and deterministic. Single source of truth; a test
   parses the embedded copy and asserts it is well-formed and non-empty
   (fail-closed on a malformed watchlist). No second Rust-const copy (no
   drift).

4. **FR-004 envelope is inline, not a path reference.** The governed
   surface carries its governance envelope inline. Shape validation is
   deserialization into `factory_contracts::GovernanceEnvelope`. This
   keeps the certificate self-describing and verification self-contained
   (no produced-app tree needed to adjudicate the governed bridge).
   `factory-engine` gains its first use of `GovernanceEnvelope` (the dep
   already exists via `factory-contracts`).

5. **AC-1 amended to reality (no TS twin).** The Build Spec has no TS
   twin and is not in the schema-parity-check walker's three pairs.
   Parity is enforced by the Rust struct's own tests + the cross-repo
   `factory-schema-lockstep` (spec 212). Not inventing a TS twin. See the
   spec's AC-1 refinement note (pre-implementation-amendment discipline).

6. **Cross-repo lockstep leg is the single merge blocker.** Adding the
   field to OAP's `build-spec.schema.yaml` (Floor mode, spec 212) fails
   the fail-visible lockstep until the upstream `factory` contract
   mirrors it + spec 212 `pinned_ref` bump. The OAP-side diff is
   identical under every resolution; surfaced to the user at ship.

## Files touched (with coupling edges)

| File | Change | Edge (spec 210 frontmatter) |
|---|---|---|
| `standards/schemas/factory/build-spec.schema.yaml` | add `agentic_posture`, bump 1.1.0 to 1.2.0 | `extends` 197 |
| `standards/schemas/factory/agentic-sdk-watchlist.yaml` | NEW watchlist | `establishes` |
| `crates/factory-contracts/src/build_spec.rs` | types + field + `validate` + version-pin tests | `extends` 197 |
| `crates/factory-engine/src/governance_certificate.rs` | `AgenticPostureBinding`, cert 1.8.0 to 1.9.0, builder, internal-consistency verify, cross-check helper, `include_str!` watchlist, tests | `refines` (agentic-posture-certificate-binding) |
| `crates/factory-engine/src/bin/build_certificate.rs` | `resolve_posture_binding` + wire on signer path | `refines` (agentic-posture-emitter-read-path) |
| `crates/factory-engine/src/bin/verify_certificate.rs` | cross-check + `--sbom-dir` reuse + posture adjudication output | `refines` (agentic-posture-verify-path) |
| `crates/featuregraph/tests/golden/features_graph.json` | regen (210 draft to approved status flip) | `extends` 034 |
| `crates/factory-engine/tests/fixtures/agentic-posture/**` | NEW CycloneDX BOM + run-dir fixtures for AC-2/3/4 | (test fixtures under a refined path) |

No `lib.rs` re-export edits (bins import via module path
`factory_engine::governance_certificate::{…}` /
`factory_contracts::build_spec::{…}`), so no lib.rs coupling edge. The
posture well-formedness lives as a method on the type in `build_spec.rs`
(no `validation.rs` edit, so no 199 reverse-coupling).

## Verification strategy

- `AgenticPosture::validate` unit tests (none/declared/governed
  well-formedness, envelope shape) in `build_spec.rs`.
- Round-trip + version-pin tests in `build_spec.rs` (AC-1).
- Cert round-trip + tamper tests in `governance_certificate.rs` (AC-2):
  bound posture survives serialize/verify; a mutated bound posture fails
  the signature/hash check; absent field yields `none`/`defaulted:true`.
- Internal-consistency verify tests (declared-empty, governed-no-envelope,
  none-with-surfaces) in `governance_certificate.rs` (AC-4 half).
- SBOM cross-check tests with fixture CycloneDX BOMs
  (`@anthropic-ai/sdk` present gives fail naming package; absent gives
  pass; `declared` + present gives pass) (AC-3).
- Governed-envelope shape tests (conformant inline envelope passes;
  malformed fails) (AC-4).
- Watchlist well-formedness test (embedded copy parses, non-empty).
- Emitter test: build a cert from a fixture run dir whose
  `s5-ui-specification/build-spec.yaml` declares a posture; assert the
  binding records it (AC-2 emitter side).

## Local gates (in order)

1. `cargo test` on factory-contracts + factory-engine (unit + fixtures).
2. `cargo clippy` (via `make ci-fast` for Rust); pr-prep skips clippy.
3. `spec-spine compile` + `spec-lint` (spec validity).
4. Featuregraph golden regen: `make registry` then
   `UPDATE_GOLDEN=1 cargo test --manifest-path crates/featuregraph/Cargo.toml --test golden -- test_golden_graph`; commit the golden.
5. `make pr-prep` (codebase index regen + coupling gate vs origin/main).
6. `spec-spine index check` clean.

## Known non-local gates (CI)

- `ci-factory-schema-lockstep.yml` (spec 212): **will fail** on the Floor
  violation until the cross-repo mirror + `pinned_ref` bump. Tracked as
  the merge blocker (Sequencing).
- `ci-featuregraph-golden.yml`: caught locally by step 4 above.
- Coupling gate: satisfied by the frontmatter edges; watch for
  `references` reverse-coupling over-fire on 197/198/034 (Spec-Drift-Waiver
  if it fires on a non-owning edge).
