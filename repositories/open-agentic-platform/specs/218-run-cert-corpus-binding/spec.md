---
id: "218-run-cert-corpus-binding"
title: "Run Certificate Corpus Binding (chain edge to the ledger seal)"
feature_branch: "feat/218-run-cert-corpus-binding"
status: approved
implementation: complete
kind: capability
domain: platform
created: "2026-06-16"
authors: ["open-agentic-platform"]
language: en
summary: >
  The governance run certificate (specs 102/168) already embeds spec-state
  hashes computed by re-reading the registry. The spec-spine ledger-seal
  capability (its own corpus, spec 023-ledger-seal) produces a reproducible,
  independently-verifiable CorpusAttestation over the spec corpus, with its own
  attestation_hash. This spec adds the chain edge: an additive, optional
  corpus_binding block on the run certificate that references that
  attestation_hash by value, forming a two-link audit chain. The corpus link is
  reproducible by any third party (spec-spine, per commit); the run link is
  signed but not reproducible (factory-engine, per run). The load-bearing
  requirement is structural, not a field: the cert builder populates the binding
  from a hash it is GIVEN (read from an upstream attestation artifact) and the
  cert crate is forbidden from depending on any corpus-compile or
  attestation-emit path. Read, never recompute. The boundary is enforced as a
  dependency-graph deny-rule, so it is a compile-time fact rather than a review
  convention.
code_aliases: ["RUN_CERT_CORPUS_BINDING"]
depends_on:
  - "102-governed-excellence"
  - "168-per-project-governance-certificate"
extends:
  - spec: "168-per-project-governance-certificate"
    nature: additive
    unit: { kind: file, path: crates/factory-engine/src/governance_certificate.rs }
  # Same featuregraph-golden precedent specs 196/194/193/187/183/209 follow: a
  # new spec adds a row to the golden.
  - spec: "034-featuregraph-registry-scanner-fix"
    nature: additive
    unit: { kind: file, path: crates/featuregraph/tests/golden/features_graph.json }
  # FR-002 crate-level boundary: the cargo-deny ban on the spec-spine CLI crate.
  # deny.toml is establishes:-owned by spec 116; its ban list is the designed
  # extension point (deny.toml comment, "populate via follow-up PRs"), so this
  # is an additive extends edge, not a refines.
  - spec: "116-supply-chain-policy-gates"
    nature: additive
    unit: { kind: file, path: deny.toml }
establishes:
  # FR-002 symbol-level boundary: clippy disallowed-methods forbids the
  # attestation-emit functions (attest, attest_json, verify_recompute,
  # verify_attestation_json) while allowing the reader seam (attestation_hash).
  # Workspace-wide config, but these functions are factory-engine-exclusive so it
  # constrains the cert crate alone. The corpus-compile leg (compile/compile_json)
  # is NOT banned: opc-decomposition-pipeline legitimately compiles the corpus
  # (accepted residual, see "The invariant"). New file this spec brings into
  # existence; rides the existing -D warnings clippy gate.
  - unit: { kind: file, path: clippy.toml }
refines:
  # Verify checks the LINK (claimed hash == supplied attestation hash), offline,
  # without recomputing the corpus.
  - aspect: "corpus-binding-verify"
    unit: { kind: file, path: crates/factory-engine/src/bin/verify_certificate.rs }
  # FR-002 runtime read path: factory_run.rs reads OAP_CORPUS_ATTESTATION_PATH,
  # hashes the supplied attestation via attestation_hash, and binds it into the
  # cert (read, never recompute).
  - aspect: "corpus-binding-read-path"
    unit: { kind: file, path: crates/factory-engine/src/bin/factory_run.rs }
references:
  - role: context
    unit: { kind: file, path: docs/adr/0002-governance-certificate-vended-distributable.md }
---

# Feature Specification: Run Certificate Corpus Binding

**Feature Branch**: `feat/218-run-cert-corpus-binding` (shares the physical
branch `feat/218-219-cert-vending` with spec 219, filed together)
**Created**: 2026-06-16
**Status**: Approved / implementation complete (the OAP half of the seam;
spec-spine corpus 023-ledger-seal is the other). Landed via #402; the FR-002
crate-level (`deny.toml`) and symbol-level (`clippy.toml`) guards are in main and
the corpus-binding behaviors are covered by `corpus_binding_tests` in
`governance_certificate.rs`.
**Input**: ADR 0002 untangled two objects the cert discussion had conflated. The
run certificate (run-provenance) is factory-engine's; a reproducible attestation
over the spec corpus is spec-spine's. The spec-spine ledger-seal spec
(023-ledger-seal) owns the corpus attestation. This spec adds the one field that
joins them, and the gate that keeps them joined-by-reference rather than
re-merged.

## Cross-corpus dependency (prose, not a registry edge)

This spec depends on a data contract owned by a spec in a different corpus: the
spec-spine ledger-seal spec (filed as `023-ledger-seal` in
`Work/spec-spine`). That spec owns `CorpusAttestation`, its
`attestation_hash` shape, and the `verify-attestation` verifier. This OAP spec
references that hash shape only. The dependency is a data-contract dependency on
the hash format, not a spec-registry edge: it is intentionally NOT listed in
`depends_on` (which carries OAP-corpus ids only), and is tracked here in prose
exactly as spec 209 tracks its template closing legs (spec 209 §refines
note). The cross-repo verifier handoff is recorded in
`docs/adr/0002-governance-certificate-vended-distributable.md`.

## Purpose

The run cert today re-derives spec-state hashes by reading the registry at run
time. That is a hash, but it is a hash the run cert computed for itself, so a
third party who wants to trust it must trust factory-engine's reading. The
ledger seal produces something stronger: a `CorpusAttestation` whose truth any
party can reproduce from the corpus alone, because spec-spine is a pure function
of `(config, file contents)`.

Binding the run cert to that attestation by hash gives the audit chain two links
with two trust models, each owned by its authority. The corpus link is
reproducible: hand it to a regulator and they re-run `spec-spine
verify-attestation --recompute` and get the same answer with no trust in us. The
run link is signed testimony of a side-effecting event that cannot be re-run, so
it can only be verified-as-signed, never reproduced. The seam between the two
falls exactly on the bounded-context boundary, which is the tell that it is the
right cut. A live gate proves the present; this chain lets a future steward
trust the past, and trust the corpus part of it without trusting us at all.

This spec adds no new cert semantics and no new attestation semantics. It adds
one referencing field, one link-check in verify, and one structural guard.

## The invariant (the load-bearing part)

**spec-spine computes the attestation and publishes its hash; factory-engine
reads that hash and never recomputes it.** The clean CI sequence is: step 1,
`spec-spine attest` emits the attestation and its `attestation_hash`; step 2, the
factory run reads that hash and writes it into `corpus_binding`. factory-engine
reads; spec-spine computes.

This is enforced structurally, not by convention.

> **Amendment (2026-06-21, implementation refinement).** The original draft said
> the cert crate "already depends only on the registry reader
> (`open_agentic_spec_registry_reader`)". That is stale post-spec-217 (engine
> swap): there is no separate reader crate. factory-engine now depends on the
> published `spec-spine-core` (`crates/factory-engine/Cargo.toml`), which exports
> from a single crate BOTH the reader seam (`attestation_hash`,
> `load_committed_registry`) AND the corpus-compile / attestation-emit functions
> (`attest`, `attest_json`, `verify_recompute`, `verify_attestation_json`,
> `compile`, `compile_json`). A crate-level deny-rule cannot distinguish
> functions inside one crate, so the boundary is enforced in two complementary
> layers below.

Per ADR 0002 §2 the cert crate reads spec state through the published
`spec-spine` library and never drives the compiler. This spec makes that a
guarded invariant in two layers, neither sufficient alone:

1. **Crate level (`deny.toml`).** A cargo-deny ban forbids factory-engine from
   depending on the `spec-spine-cli` binary crate, which carries the full
   corpus-compile / attestation-emit surface. (Extends spec 116's ban list.)
2. **Symbol level (`clippy.toml`).** clippy `disallowed-methods` forbids
   calling the attestation-emit functions (`attest`, `attest_json`,
   `verify_recompute`, `verify_attestation_json`) while permitting the reader
   seam (`attestation_hash`, the pure payload hash). clippy resolves by
   canonical path (the `*_json` variants are crate-root, the others
   module-level), so it is a compile-time fact promoted to a hard error by the
   existing `-D warnings` gate. The config is workspace-wide (clippy.toml is
   per-workspace, not per-crate); these four functions are used by no crate
   other than factory-engine, so the ban effectively constrains the cert crate
   alone.

**Accepted residual: the corpus-compile leg is not symbol-banned.** FR-002 also
names "corpus-compile" (`compile` / `compile_json`). Those cannot be banned by
the workspace-wide `clippy.toml` because `crates/opc-decomposition-pipeline`
legitimately compiles the corpus (`promotion.rs` calls `spec_spine_core::compile`).
factory-engine's non-recompute is instead assured architecturally: it reads the
committed registry via `load_committed_registry` and never calls `compile`, and
the cargo-deny ban keeps the emit CLI out of its graph. A factory-engine-scoped
compile guard would need a per-crate mechanism (e.g. a CI grep over
`crates/factory-engine/src/`), deferred as not worth the second mechanism here.

Recompute is therefore not a thing a reviewer must catch for the attestation-emit
surface: it is a thing the lint config makes impossible to compile-clean. The
corpus-compile surface is an architectural assurance, not a lint.

## Functional requirements

- **FR-001 (corpus binding field, additive, optional).** The run cert gains an
  additive `corpus_binding` block recording, by reference, the corpus attestation
  in effect at the run: `{ corpus_attestation_hash, spec_spine_version }`. It is
  optional on land: existing certs without it still verify, and absence is a
  named "unbound" state, not a failure. (Making it required is a later
  tightening, out of scope below.) The field is added to
  `crates/factory-engine/src/governance_certificate.rs` and serialized with
  `skip_serializing_if = "Option::is_none"` so unbound certs stay byte-identical
  to pre-binding payloads (the established additive-field discipline at
  `governance_certificate.rs:21-52`).
- **FR-002 (builder reads, never recomputes: the boundary gate).** The cert
  builder populates `corpus_binding` from a value it is GIVEN
  (`corpus_attestation_hash`): at run time `factory_run.rs` reads the upstream
  attestation artifact named by `OAP_CORPUS_ATTESTATION_PATH` (the same
  late-bound, operator-supplied-artifact pattern as `OAP_SIGNING_KEY_PATH`),
  deserialises the `CorpusAttestation`, and hashes it via
  `spec_spine_core::attest::attestation_hash`. The cert crate MUST NOT depend on
  any corpus-compile or attestation-emit path; the published-library reader seam
  (`attestation_hash`) is permitted. Enforced as a compile-time boundary in two
  layers (not review): a cargo-deny crate ban on `spec-spine-cli` (`deny.toml`)
  and a clippy `disallowed-methods` ban on the attestation-emit functions
  (`attest`, `attest_json`, `verify_recompute`, `verify_attestation_json`)
  (`clippy.toml`). The corpus-compile leg (`compile` / `compile_json`) is an
  accepted residual, not symbol-banned, because another workspace crate
  legitimately compiles the corpus; see "The invariant" for that residual and
  for why both layers are required post-spec-217.
- **FR-003 (verify checks the link by reference, offline).** `verify-certificate`
  (`crates/factory-engine/src/bin/verify_certificate.rs`) validates
  `corpus_binding` by checking the cert's claimed `corpus_attestation_hash`
  equals the hash of an attestation it is supplied via `--corpus-attestation
  <file>`, without recomputing the corpus. The attestation is an external
  artifact (the run does not write it into the run dir), so it is supplied
  explicitly, not auto-discovered. Verifying the attestation's own truth
  (recompute / signature) is delegated to spec-spine's `verify-attestation`. Two
  verifiers, two responsibilities, composed by reference; the run-cert verifier
  never invokes corpus recompute.
- **FR-004 (unbound and mismatch visibility).** A cert with no `corpus_binding`
  is reported "unbound" (named, legible). A binding whose hash does not match a
  supplied attestation fails with a named diagnostic. A binding present with no
  attestation supplied is reported "present-but-unverified," never silently
  passed. Skip-as-pass is forbidden, consistent with the cert's fail-closed
  posture (the spec 200 FR-004 stance).

## Acceptance criteria

- **AC-1.** A run cert built with an upstream attestation present carries
  `corpus_binding.corpus_attestation_hash` equal to that attestation's hash.
- **AC-2.** `verify-certificate` given the matching attestation reports the
  binding verified; given a mismatched attestation, fails naming the mismatch;
  given none, reports present-but-unverified.
- **AC-3.** The cert crate's dependency graph contains the registry reader but no
  attestation-emit / corpus-compile crate; adding such a dependency fails the
  deny-rule gate. (This is the structural form of read-not-recompute.)
- **AC-4.** An existing cert with no `corpus_binding` still verifies: additive,
  non-breaking, byte-identical when the field is absent.
- **AC-5.** The run-cert verifier path executes no corpus recompute; verifying
  the attestation's own truth is reached only through spec-spine
  `verify-attestation`. The chain composes; the responsibilities do not merge.

## Out of scope

- **The corpus attestation's format, emit, and verify.** The spec-spine
  ledger-seal spec (`023-ledger-seal`) owns `CorpusAttestation`, `attest`, the
  detached seal, and `verify-attestation`. This spec only references the
  resulting hash.
- **Making the binding required.** Lands optional; promotion to required follows
  once tenants reliably emit attestations (tracked against the tenant emit leg,
  residual R-2, not here).
- **Run-cert distribution / vending.** Spec 219 (tenant-tail verifier toolkit)
  owns vending the run-cert verifier to the tenant. This chain edge is orthogonal
  and can land in OAP ahead of it.
- **Signer / key provisioning** for either object (the seal's key is the
  ledger-seal spec's stated non-blocker; the run cert's signer is its pre-existing
  concern).

## Sequencing

FR-002's deny-rule can land immediately and independently: it is a pure guard
that holds even before any attestation exists, because it only forbids a
dependency. FR-001/003/004 depend on the attestation's `attestation_hash` format
being fixed (spec-spine corpus `023-ledger-seal`), since the binding references
it; they are additive to the run cert and land on factory-engine's own cadence
once that format is stable. The cross-corpus dependency on `023-ledger-seal` is a
data-contract dependency on the hash shape, not a spec-registry edge, and is
tracked in prose (see "Cross-corpus dependency" above) the way spec 209 tracks
its cross-repo legs.
