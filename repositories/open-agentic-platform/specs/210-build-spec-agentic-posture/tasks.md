# Tasks: 210-build-spec-agentic-posture

Ordered. Each task is a self-contained unit with its own test coverage.

## T-001: Schema field (FR-001, contract side)
- `standards/schemas/factory/build-spec.schema.yaml`: add the top-level
  `agentic_posture` object (posture enum + surfaces + surface kind enum +
  inline `governance_envelope` for governed); bump `schema_version`
  1.1.0 to 1.2.0 + changelog comment.
- Done when: schema documents the field per the spec Model section.

## T-002: Rust twin types + validate (FR-001)
- `crates/factory-contracts/src/build_spec.rs`: add `AgenticPosture`,
  `PostureLevel`, `AgenticSurface`, `SurfaceKind`; add
  `Option<AgenticPosture>` field to `BuildSpec`; add
  `AgenticPosture::validate` (none-empty / declared-nonempty /
  governed-envelope rules); bump `BUILD_SPEC_SCHEMA_VERSION` to 1.2.0 and
  the version-pin tests.
- Tests: parse absent (None); parse authored none/declared/governed;
  validate rejects declared-empty, governed-missing-envelope,
  none-with-surfaces; round-trip.
- Done when: `cargo test -p factory-contracts` green.

## T-003: Certificate binding block (FR-002, cert side)
- `crates/factory-engine/src/governance_certificate.rs`: add
  `AgenticPostureBinding { posture, defaulted, surfaces }` +
  `CertAgenticSurface` (mirrors the build-spec surface, envelope as
  `serde_json::Value` for shape-preserving bind); add the optional
  top-level field (skip when absent, inside hash + signature); bump
  `CERTIFICATE_VERSION` 1.8.0 to 1.9.0 + header changelog; add
  `CertificateBuilder::agentic_posture_binding`; wire the builder field
  through `new`/`build`.
- Tests: round-trip with a bound posture; absent stays byte-identical to
  1.8.0-shaped payload; version assertion updated to 1.9.0.
- Done when: `cargo test -p factory-engine` cert tests green.

## T-004: Internal-consistency verify (FR-003 no-SBOM half + FR-004 shape)
- `governance_certificate.rs` `verify_certificate`: add a block (after
  the budget block) that, when `agentic_posture_binding` is present,
  rejects declared/governed-empty, none-with-surfaces,
  governed-surface-without-envelope, and a governed surface whose inline
  envelope does not deserialize as `factory_contracts::GovernanceEnvelope`.
- Tests: each inconsistency fails; a consistent binding passes.
- Done when: verify tests green.

## T-005: Watchlist data + loader (FR-003 SBOM half, data)
- `standards/schemas/factory/agentic-sdk-watchlist.yaml`: NEW. Versioned
  header + a list of `{ ecosystem, name, note }` for known agent/LLM SDK
  packages (npm-focused for produced apps; include purl-prefix matching).
- `governance_certificate.rs`: `include_str!` the watchlist, parse it,
  expose a matcher over CycloneDX `components[]` (name + purl).
- Tests: embedded watchlist parses + non-empty; matcher hits
  `@anthropic-ai/sdk`, misses a plain web dep.
- Done when: watchlist + matcher tests green.

## T-006: SBOM cross-check helper + verify-bin wiring (FR-003 SBOM half)
- `governance_certificate.rs`: `cross_check_agentic_posture(cert, sbom_dir)`
  reads `<sbom_dir>/.factory/sbom.cdx.json`, walks components, matches the
  watchlist; returns an outcome (Unbound/Consistent/Contradicted{package,
  posture}/UnverifiedNoDir/WatchlistMiss-notice).
- `crates/factory-engine/src/bin/verify_certificate.rs`: call it in the
  `--sbom-dir` path alongside `verify_sbom_binding`; fold Contradicted
  into `errors` (exit 1) naming package + declaration; emit the
  posture label + watchlist-miss notice.
- Tests: fixture BOMs drive contradicted / consistent / declared-pass.
- Done when: cross-check unit + bin behaviour verified.

## T-007: Emitter read-path (FR-002 emit side)
- `crates/factory-engine/src/bin/build_certificate.rs`:
  `resolve_posture_binding(run_dir)` reads
  `s5-ui-specification/build-spec.yaml`, parses `agentic_posture` via
  `factory_contracts::build_spec::BuildSpec`, produces the binding
  (absent field or absent spec gives none/defaulted); bind on the signer
  path (mirrors `resolve_sbom_binding`).
- Tests / fixture: a run dir with an authored-posture build spec yields a
  cert that records it (AC-2 emitter side).
- Done when: emitter test green.

## T-008: Fixtures + AC coverage
- `crates/factory-engine/tests/fixtures/agentic-posture/`: CycloneDX BOMs
  (with/without `@anthropic-ai/sdk`), a run dir with an authored-posture
  build spec, a conformant + a malformed governance envelope.
- Integration test asserting AC-2 / AC-3 / AC-4 end to end via the
  library API.
- Done when: `cargo test -p factory-engine` green.

## T-009: Goldens + index + local gates
- `make registry`; regen featuregraph golden
  (`UPDATE_GOLDEN=1 cargo test ... test_golden_graph`); commit.
- `make ci-fast` (clippy) + targeted `cargo test`.
- `make pr-prep` (index + coupling gate).
- Done when: all local gates green; `spec-spine index check` clean.

## T-010: Ship + cross-repo decision
- `/ship`-style: coupling gate, local review, conventional commits, PR.
- Surface the spec 212 lockstep cross-repo leg (mirror + `pinned_ref`)
  with a recommendation.
- Done when: PR open; cross-repo leg decided with the user.

## T-011: Shepherd to merge
- Rerun infra flakes, triage review comments adversarially, enqueue when
  green (contingent on the cross-repo leg landing), verify merged main.
