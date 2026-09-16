---
id: "219-tenant-tail-verifier-toolkit"
title: "Tenant-Tail Verifier Toolkit (the vended tenant verification surface)"
feature_branch: "feat/219-tenant-tail-verifier-toolkit"
status: approved
implementation: complete
kind: capability
domain: platform
created: "2026-06-16"
authors: ["open-agentic-platform"]
language: en
summary: >
  209 FR-001 enumerates the gates the seeded tenant CI must run: spec-spine's
  (compile, lint, couple, index, registry) plus run-side verifiers that live in
  factory-engine in-tree and reach no tenant. spec-spine's gates are vended over
  npm via its own distribution spec; the run-side verifiers are not vended at
  all. This spec defines and vends tenant-tail: a single npm-distributed,
  verify-only CLI that lives in its OWN repository (mirroring spec-spine's
  repo/crate/npm shape), one pin, one integrity surface. It bookends the spine:
  the spine compiles the corpus, the tail verifies the factory's paperwork. Per
  the R-1 read (residuals note, 2026-06-16) only TWO verify cores exist as code
  and extract cleanly today: the certificate core (102/168/198/170) and the
  provenance validator (121, already its own crate crates/provenance-validator).
  The toolkit ships those two verbs now (verify-certificate, verify-provenance);
  verify-sbom is a forward-declared third verb that lands when its core exists
  (spec 203 is an unimplemented draft and, by its own refines map, its verify
  side extends the certificate core rather than standing alone). The emitter
  (build-certificate) is identity-bearing and harness-bound and is explicitly NOT
  here; it ships with its firing in a future emit spec (residual R-2). Completion
  criterion: with spec-spine and tenant-tail both vended, every gate 209 FR-001
  names has a vended source, which is what makes 209 AC-1 structurally reachable.
code_aliases: ["TENANT_TAIL", "TENANT_TAIL_VERIFIER_TOOLKIT"]
compliance:
  # Grounded, not invented: 209 FR-004 maps vended-tool integrity to ASI04
  # (do-not-trust-the-producer applied to tooling); 209 FR-001 places provenance
  # + certificate verification under ASI04 continuous validation.
  - framework: "owasp-asi-2026"
    controls: ["ASI04"]
depends_on:
  - "102-governed-excellence"
  - "168-per-project-governance-certificate"
  - "198-factory-governance-envelope"
  - "170-signed-inter-stage-manifests"
  - "121-claim-provenance-enforcement"
extends:
  # Same featuregraph-golden precedent specs 196/194/193/187/183/209 follow.
  - spec: "034-featuregraph-registry-scanner-fix"
    nature: additive
    unit: { kind: file, path: crates/featuregraph/tests/golden/features_graph.json }
refines:
  # FR-006: the stale cargo-install template path is retired in favour of the
  # tenant-tail npm pin.
  - aspect: "retire-cargo-install-path"
    unit: { kind: file, path: crates/factory-engine/templates/kernel/toolchain.yaml.tmpl }
  # FR-006 footprint (plan.md Decision 1): the template rewrite breaks the render
  # tests in kernel_emission/templates.rs, which assert the cargo-install `--tag`
  # line and the `@@binaries_dir@@/verify-certificate` invoke path. Those tests
  # move to the npm-pin verifier invocation in lockstep with the template; this
  # edge declares the authority that makes the test change coupling-gate clean.
  - aspect: "toolchain-render-tests-npm-pin"
    unit: { kind: file, path: crates/factory-engine/src/kernel_emission/templates.rs }
references:
  # Extraction SOURCES (context, not authority): the cores stay in OAP and keep
  # working; tenant-tail carries a standalone copy kept in behavior parity. These
  # are NOT extends edges because OAP's behavior is preserved, not extended; the
  # vended surface lives in a separate repo (see "Repository topology" below).
  - role: context
    unit: { kind: file, path: crates/factory-engine/src/governance_certificate.rs }
  - role: context
    unit: { kind: file, path: crates/provenance-validator/src/validator.rs }
  - role: context
    unit: { kind: file, path: specs/209-tenant-kernel-ci-enforcement/spec.md }
  - role: context
    unit: { kind: file, path: docs/adr/0002-governance-certificate-vended-distributable.md }
---

# Feature Specification: Tenant-Tail Verifier Toolkit

**Feature Branch**: `feat/219-tenant-tail-verifier-toolkit` (shares the physical
branch `feat/218-219-cert-vending` with spec 218, filed together)
**Created**: 2026-06-16
**Status**: Approved, implementation complete (supersedes the cert-only distribution sketch in ADR 0002)
**Input**: ADR 0002 found the run certificate un-vended and recommended a second
distributable. The R-1 read (residuals note, 2026-06-16) confirmed which cores
actually exist and extract cleanly, and the user chose the two-verbs-now /
staged-verify-sbom scope. This spec vends the verification surface that exists.

## Grounding note (status: complete, 2026-06-21)

The cross-repo bulk shipped. The `tenant-tail` repository
(`github.com/bartekus/tenant-tail`, npm `tenant-tail@0.1.0`, Apache-2.0) carries
both verify cores and verbs (`verify-certificate`, `verify-provenance`), the npm
wrapper, full spec-spine CI parity, and its own dogfooded `specs/` corpus. A
read-only re-verification on 2026-06-21 confirmed the standalone three-crate
workspace, both verbs present, and no `build-certificate` verb or factory-engine
dependency anywhere (AC-1, AC-6). That satisfies FR-001 through FR-005 and AC-1
through AC-7 in the tenant-tail repo, the cross-repo posture "Repository topology"
records.

The OAP-side leg is **FR-006 / AC-8** only, landed in this change: the
`toolchain.yaml.tmpl` cargo-install path is retired and the verifier homed on the
`tenant-tail` npm pin. Grounding that edit showed FR-006's footprint is two OAP
files, not one: the template plus the render tests in
`kernel_emission/templates.rs` that assert the retired cargo-install text. A
second `refines` edge (`toolchain-render-tests-npm-pin`) is added for that file;
`version.rs` is unchanged because the recorded verb name `verify-certificate`
survives the npm pin. The emitter (`build-certificate`) is deferred to spec 220
(R-2) and is named as pending in the template, not prescribed here. Decisions are
recorded in `plan.md`.

## Repository topology (grounded, supersedes the ADR 0002 OAP-internal-crate sketch)

ADR 0002 §6 sketched the cert tool as an OAP-internal crate. The grounded
decision is different and is recorded here as the reality the rest of the spec
rests on: **tenant-tail is its OWN repository** (`tenant-tail`),
mirroring spec-spine's repo/crate/npm shape (a Cargo workspace of typed/core/cli
crates, an `npm/` wrapper with `@<scope>/cli-<os>-<cpu>` optionalDependencies, a
release workflow, and a `specs/` corpus governed by spec-spine as a dev-time npm
dependency). It is licensed Apache-2.0 to match spec-spine, not OAP's AGPL-3.0
(see "Licensing" below).

Consequences for this OAP spec's authority graph:

- The tenant-tail crate, npm wrapper, release matrix, and its own `specs/` corpus
  live in the tenant-tail repository, so they are NOT OAP registry edges. They
  are tracked in prose here, exactly as spec 209 tracks its template
  closing legs (there is no in-OAP authority target to claim). The tenant-tail
  repo's internal structure is governed by tenant-tail's OWN specs/ corpus, the
  same dogfooding pattern by which spec-spine's distribution is governed by
  spec-spine's own `007-distribution`, not by an OAP spec.
- This spec's OAP-side code change is retiring the cargo-install template path
  (FR-006), which spans two `refines` edges: the template
  (`toolchain.yaml.tmpl`) and the render tests in `kernel_emission/templates.rs`
  that assert its content (see the Grounding note for why the test edit is part
  of the footprint). The verify cores
  (`governance_certificate.rs`, `crates/provenance-validator`) are referenced as
  extraction SOURCES (context), not claimed as authority: OAP keeps them and
  their behavior is preserved (behavior parity, FR-001), so there is nothing for
  this spec to extend in OAP.

## Purpose

A produced application is meant to inherit a verification surface, not a single
gate. 209 FR-001 lists it: spec-spine's gates over the corpus, plus the tenant
re-checking the run-side things the factory asserted about the build. spec-spine
vends its half. The run-side verifiers live in factory-engine and never cross the
handoff. So today a tenant inherits the ability to check its specs and not the
ability to check its run paperwork, and "the single audit chain you hand a
regulator" is true up to handoff and unverifiable one commit later.

The un-vended run-side verifiers are one bounded context. Each is the tenant
re-running a check against an artifact the factory produced, with no trust in the
producer (spec 102), needing no signing identity and no network. That is one
role, so it is one tool: the same judgment that kept the certificate out of
spec-spine and spec-spine's verbs in one CLI. Per-tool packages would fragment
into many pins and version-skew surfaces against the one factory whose output
they all check; the toolkit collapses that to one pin, one integrity surface, one
staleness story.

`tenant-tail` bookends `spec-spine`: spine to tail, the spine compiles the corpus
and the tail reads the factory's telltales. It is verify-only, by design and all
the way down to the package boundary. The emitter, `build-certificate`, is the
opposite role: identity-bearing, non-reproducible, harness-bound. Shipping it
here would vend a tool inert in the tenant until a harness and a signer exist
(residual R-2), and would re-mix the emit/verify cut the rest of this
architecture keeps clean. It ships with its firing, not here.

## What exists today (the R-1 read, grounding FR-001's scope)

The R-1 read (residuals note "R-1 read: findings", 2026-06-16) verified each
candidate verify core against the actual code:

- **Certificate core: exists, extracts cleanly (a bounded module set).** Lives in
  `crates/factory-engine/src/governance_certificate.rs` plus three self-contained
  crypto+serde sibling modules (`inter_stage_manifest`, `platform_jws`,
  `pipeline_state`) and a thin `factory_contracts::sandbox` slice. The only
  spec-spine edge is one warn-only function, `validate_spec_id_resolution`
  (`governance_certificate.rs:1402-1426`), feature-gated off for the vended build.
- **Provenance core: exists as its own crate, sheds clean.**
  `crates/provenance-validator` already depends only on `factory-contracts` +
  ubiquitous crates; zero factory-engine imports, zero spec-spine edges. Its
  public `validate()` is pure (`crates/provenance-validator/src/validator.rs`).
- **SBOM core: does not exist.** Spec 203 (`203-produced-app-sbom-attestation`) is
  an unimplemented draft. By its own `refines` map its verify side would land
  inside the certificate verifier, i.e. it is an extension of the cert core, not a
  third standalone core. verify-sbom is therefore staged (see "Staged third
  verb"), not shipped in this spec.

## Functional requirements (refined in plan.md; FR-006 / AC-8 landed)

- **FR-001 (tenant-tail toolkit: two verify cores, one CLI).** The tenant-tail
  repository hosts a standalone, verify-only CLI exposing two verbs:
  `verify-certificate` (cert core: governance certificate + platform JWS per spec
  198 + inter-stage manifest per spec 170) and `verify-provenance` (spec 121's
  validator, normalized to a `verify-*` verb). The CLI builds without
  factory-engine. Each verb is behavior-equivalent to its in-tree counterpart;
  any diff between the vended verb and the in-tree path is warn-only and surfaced,
  never silent. The cores stay in OAP; tenant-tail carries an extracted standalone
  copy kept in parity (a parity check is owned by tenant-tail's corpus).
- **FR-002 (verify-only boundary: emit excluded, structurally).** tenant-tail
  contains no emitter. `build-certificate` is not a verb, not a bin, and not a
  dependency; its absence is testable. The toolkit's posture is read-only,
  offline-capable, identity-free (spec 102's do-not-trust-the-producer turned
  tenant-ward). The emitter ships in the emit spec (R-2) bound to its harness and
  signer.
- **FR-003 (the spec-spine reader seam is feature-gated off for the vended
  build).** The certificate core's one spec-spine edge, `validate_spec_id_resolution`,
  is warn-only (it writes a sibling `validation-warnings.json`, never changing the
  verify verdict; `governance_certificate.rs:1431-1459`). The vended tenant-tail
  build compiles with this seam OFF (standalone, links no spec-spine crate);
  factory-engine's in-tree consumption keeps it ON. This is the only DAG-back-edge
  candidate and it is removable without verdict change.
- **FR-004 (per-platform release binaries with provenance).** tenant-tail's
  release pipeline builds the CLI for each supported platform triple and attaches
  it with the same SBOM + provenance attestation treatment spec-spine's release
  applies (mirroring spec-spine `021-release-supply-chain-artifacts`). This release
  matrix lives in the tenant-tail repository (its own `release.yml`), not in OAP's
  `release-tools.yml`. It is the one genuinely net-new piece of infrastructure.
- **FR-005 (npm wrapper distribution, mirror spec-spine).** tenant-tail publishes a
  main `tenant-tail` npm package carrying no binary, declaring
  `@<scope>/cli-<os>-<cpu>` optionalDependencies keyed by os/cpu, a pure
  exec-and-forward launcher resolving the platform package, and a publish-time
  platform-package generator (the analogue of spec-spine's
  `generate-platform-packages.js`, assembled from release archives, never
  committed). All of this lives in the tenant-tail repository.
- **FR-006 (one pin, one integrity surface; retire the cargo-install path).** The
  tenant pins `tenant-tail` as one exact-version devDependency next to spec-spine;
  integrity is the existing `npm ci` sha512 lockfile verification, which covers the
  package and its `@scope/cli-*` subpackages generically. One pin verifies both
  verbs. The stale `cargo install --git ... --bin build-certificate --bin
  verify-certificate` path in `crates/factory-engine/templates/kernel/toolchain.yaml.tmpl`
  (line 26) is retired/rewritten to the npm-pin model: it presumes a tenant Rust
  toolchain the npm migration deleted. This realizes 168 FR-001 and 121's
  tenant-side reach and supplies the integrity model 209 FR-004's owed rewrite
  targets. (The template pin + CI step is the cross-repo closing leg; no
  in-OAP authority target.)

## Staged third verb (verify-sbom)

`verify-sbom` is forward-declared, not shipped. Its core does not exist: spec 203
is an unimplemented draft, and by its own `refines` map the verify side lands
inside the certificate verifier (an additive BOM-artifact field + check) rather
than as a separate core. When spec 203 is implemented, `verify-sbom` joins
tenant-tail as the third verb under the same one-pin / one-integrity model, with
no change to the packaging or distribution this spec establishes. Tracking it as a
named, staged verb (rather than silently dropping it) keeps the toolkit's design
honest about its eventual shape.

## Licensing (delta surfaced, decision recorded)

The extracted cores carry `AGPL-3.0-or-later` SPDX headers
(`governance_certificate.rs:1`), and OAP is AGPL-3.0; tenant-tail mirrors
spec-spine's Apache-2.0. Relicensing the extracted verify-only code to Apache-2.0
is the prerogative of the sole copyright holder (the repository's declared
copyright, "Bartek Kus"). The tenant-tail repository is therefore Apache-2.0; the
relicense of the extracted source is an explicit, owner-authorized act recorded
in the tenant-tail handoff, not an oversight.

## Acceptance criteria (refined in plan.md; verify legs satisfied cross-repo, AC-8 landed here)

- **AC-1.** tenant-tail builds standalone (its CLI, no factory-engine in the
  path); both verbs present; each accepts what its in-tree counterpart accepts
  (behavior parity per verb, warn-only diff acceptable and surfaced).
- **AC-2.** A release run produces tenant-tail for every supported triple, each
  with an SBOM and provenance attestation, attached to the release.
- **AC-3.** Installing the main npm package on each platform resolves the matching
  `@scope/cli-<os>-<cpu>` and the launcher forwards; `npm ci` verifies sha512 and
  aborts on a tampered lockfile entry.
- **AC-4.** A tenant with tenant-tail pinned runs `npx --no-install tenant-tail
  verify-certificate|verify-provenance ...` offline; each accepts a valid artifact
  and fails an invalid one with a named diagnostic.
- **AC-5 (completion criterion).** spec-spine's vended gates plus tenant-tail's two
  verbs equal every run-side gate 209 FR-001 names that has an implemented core:
  every such seeded gate now has a vended source. This is the precondition 209
  AC-1 silently required.
- **AC-6.** tenant-tail's dependency graph and verb set contain no emitter:
  `build-certificate` is absent. The verify-only boundary is structurally true,
  not documented.
- **AC-7.** The vended build links no spec-spine crate (FR-003 seam off);
  factory-engine's in-tree build keeps the seam on. Dropping the seam changes no
  verify verdict.
- **AC-8.** `toolchain.yaml.tmpl` no longer references `cargo install --git`; the
  tenant-tail npm pin is the documented path.

## Out of scope

- **Gate semantics.** Specs 102/168/198/170 (cert), 121 (provenance) own them.
  Extraction changes packaging and consolidates verbs; behavior is preserved per
  AC-1.
- **verify-sbom and spec 203.** Staged, not shipped (see "Staged third verb"). Its
  core must be implemented under spec 203 before the verb exists.
- **The emitter and its firing.** `build-certificate` + the tenant pipeline-run
  harness + signer identity ship together in the emit spec (residual R-2).
- **The corpus attestation (spec-spine 023-ledger-seal) and the run-cert chain
  edge (OAP spec 218).** Sibling specs, independent cadence.
- **209 enforcement activation.** 209 owns turning the seeded CI enforcing;
  tenant-tail supplies the verifiers 209 FR-001 invokes. The 209 FR-004 wording
  rewrite to the npm-pin model is an owed amendment tracked against 209.
- **The tenant-tail repository's internal structure.** Governed by tenant-tail's
  OWN specs/ corpus (spec-spine-dogfooded), not by this OAP spec. This spec
  references it in prose only.
- **Release cadence binding.** Whether spec 193 pairs tenant-tail's release to
  spec-spine's is 193's call (ADR 0002 §9 OQ-3).

## Sequencing

Realized (all legs landed): FR-001 (extraction) through FR-005 (npm wrapper)
shipped in the tenant-tail repo; FR-006 (retire the template path) landed in this
OAP change. The original sequence and its rationale follow.

FR-001 (extraction into the tenant-tail repo) was the prerequisite for everything
and was unblocked: the R-1 read confirmed both cores extract cleanly and the seam
is removable. Then FR-004 (release matrix), FR-005 (npm wrapper), FR-006 (tenant
pin + retire the template path). The verify surface became reachable at FR-006,
which homes 209 FR-001's implemented gate set and is the real precondition for 209
AC-1. The emit half (168 FR-002 / 209 FR-003) stays in R-2 and is not delivered
here. verify-sbom stays staged until spec 203 is implemented.
