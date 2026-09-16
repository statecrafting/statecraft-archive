---
id: "209-tenant-kernel-ci-enforcement"
title: "Tenant Kernel CI Enforcement Activation (ASI04 continuous validation)"
feature_branch: "feat/209-tenant-kernel-ci-enforcement"
status: approved
implementation: complete
kind: capability
domain: platform
created: "2026-06-11"
authors: ["open-agentic-platform"]
language: en
summary: >
  Convert the produced application from ASI-aware to ASI-enforcing. The
  born-with kernel (spec 167) seeds every produced project with the spec
  spine, validators, and a tenant CI workflow — but the machinery is
  carried, not wired: kernel emission does not auto-fire from pipeline
  transitions, tenant runs do not auto-emit governance certificates
  (spec 168's tenant-emit leg), and the seeded CI does not actually run
  the inherited gates (registry compile, spec-lint, coupling gate,
  provenance validator, certificate verify). A produced app that makes
  an unprovenance claim or drifts spec-from-code is not structurally
  prevented from merging it — the gates only fire on OAP's side. This
  spec is the activation: the seeded CI becomes enforcing
  (fail-the-PR, not advisory), emission and certificate auto-fire close
  the documented deferrals of specs 167/168, and the tenant CI verifies
  vended-tool integrity against .kernel-version before trusting any
  vended binary.
code_aliases: ["TENANT_KERNEL_CI_ENFORCEMENT"]
compliance:
  - framework: "owasp-asi-2026"
    controls: ["ASI04"]
depends_on:
  - "167-born-with-spec-spine-kernel"
  - "168-per-project-governance-certificate"
  - "112-factory-project-lifecycle"
extends:
  - spec: "168-per-project-governance-certificate"
    nature: additive
    unit: { kind: file, path: crates/factory-engine/src/governance_certificate.rs }
  # Same precedent as specs 196, 194, 193, 187, 183: a new spec adds a row
  # to the featuregraph golden.
  - spec: "034-featuregraph-registry-scanner-fix"
    nature: additive
    unit: { kind: file, path: crates/featuregraph/tests/golden/features_graph.json }
refines:
  # The prior `extends: 167 -> tenant-ci.yml.tmpl` edge was dropped when spec
  # 167's PR-2 retired the vendored-binary CI template. 209's enforcing-CI
  # premise targets the npm tenant CI: the prebuilt template's `spec-spine.yml`
  # (`npx --no-install spec-spine couple`), which lives in template, not
  # OAP. Those CI gates (FR-001/004/005 + spec 203's parity gate) are the
  # cross-repo closing leg and carry no in-OAP authority target. The in-OAP
  # anchors below are the live production surfaces this spec refines:
  #   * born-with-kernel-completeness: the fail-closed assertion FR-002 adds to
  #     the statecraft TypeScript Create flow, honouring spec 167 §2.4/§7 (the
  #     engine `emit_project_kernel` auto-fire stays deliberately unwired to
  #     avoid double-emit).
  #   * vended-binary-integrity: under the npm shape this is npm-pin
  #     verification; the OAP half is the `spec_spine_version` field added to
  #     `KernelVersion` so `.kernel-version` round-trips the pin the TS stamp
  #     already writes (kernelVersionStamp.ts). The CI comparison step is the
  #     template closing leg.
  #   * kernel-version-field-propagation: the engine-fallback construction in
  #     emit.rs threads the new `spec_spine_version` field (set to None: the
  #     non-npm path carries no npm pin).
  - aspect: "born-with-kernel-completeness"
    unit: { kind: file, path: platform/services/statecraft/api/projects/scaffold/perRequestScaffold.ts }
  - aspect: "vended-binary-integrity"
    unit: { kind: file, path: crates/factory-engine/src/kernel_emission/version.rs }
  - aspect: "kernel-version-field-propagation"
    unit: { kind: file, path: crates/factory-engine/src/kernel_emission/emit.rs }
references:
  - role: context
    unit: { kind: file, path: crates/factory-engine/src/stages/quality_gates.rs }
  - role: context
    unit: { kind: file, path: docs/owasp-agentic-top-10-2026.md }
---

# Feature Specification: Tenant Kernel CI Enforcement Activation

**Feature Branch**: `209-tenant-kernel-ci-enforcement`
**Created**: 2026-06-11
**Status**: Approved (in-scope FRs FR-001/002/004/005 landed; FR-003 deferred to spec 220)
**Input**: The ASI 2026 gap analysis (2026-06-10) concluded: "The factory
produces applications that are born with a governance kernel but lack
the live runtime enforcement machinery to prevent violations of that
governance. The produced app is ASI-aware but not ASI-enforcing."

## Purpose

Specs 167 and 168 deliberately landed mechanism-first and documented
their activation deferrals: emission is callable and tested but no
pipeline transition fires it; the certificate emitter ships in the
kernel but tenant runs do not invoke it; the seeded tenant CI exists as
a template whose gates are scaffolding. Each deferral was honest — and
each is now the difference between a governed deliverable and a
deliverable that merely contains governance documents.

The activation matters for the same reason OAP's own gates matter: a
covenant without a gate decays. A tenant team that inherits a spec
spine but can merge drift will merge drift; six months later the
kernel's registry describes an application that no longer exists, and
the "single audit chain you can hand to a regulator" claim quietly
stops being true one commit past handoff.

This spec is scoped to *activation* of existing machinery. It adds no
new gate semantics — every gate it wires is one OAP already runs on
itself.

## Functional requirements

> **Refinement note (2026-06-19).** Filed as a sketch; this revision
> grounds the open FRs on the now-vended tenant verification surface.
> FR-002 landed in PR #366. tenant-tail (spec 219) is published to npm
> (`tenant-tail@0.1.0` plus its five `@tenant-tail/cli-<os>-<cpu>`
> platform packages), so the run-side verifiers FR-001 invokes now exist
> as a consumable pin. FR-004 is rewritten to the npm-pin / `npm ci`
> sha512 integrity model that spec 219 FR-006 established, replacing the
> earlier "content hash against `.kernel-version`" wording (the amendment
> spec 219 tracked against this spec). FR-003 (the certificate *emit*
> leg) is deferred to the future emit spec (residual R-2): tenant-tail is
> verify-only by construction, so emission is not part of this
> activation. The "sketch, refine before implementation" qualifier is
> retired for FR-001/004/005; they are implementable as written.

> **Closure note (2026-06-24).** FR-001/004/005 landed. The enforcing
> tenant CI lives in template-encore's `.github/workflows/spec-spine.yml`
> (committed since that repo's initial commit): blocking `spec-spine
> compile` / `lint --fail-on-warn` / `index check` / `couple`, then
> `tenant-tail verify-provenance --fail-on-rejected` and
> `verify-certificate`, gated by `npm ci` sha512 integrity plus the
> born-with `spec_spine_version` pin-equality check, with no
> `|| true` / `continue-on-error` masking any gate exit. With FR-002
> delivered (PR #366) and FR-003 deferred to spec 220, every in-scope FR
> is satisfied, so this spec is approved / implementation complete. The
> cross-repo CI legs carry no in-OAP authority target (see Sequencing);
> the end-to-end produced-app green run is spec 210's falsifiability
> check, which this spec precedes.

- **FR-001: Enforcing tenant CI.** The seeded GitHub Actions workflow
  (template-encore's `.github/workflows/spec-spine.yml`) runs as a
  blocking gate, not advisory. Against the tenant's own spine and run
  artifacts it executes:
  - **spec-spine** (the vended `spec-spine` npm pin): `compile`, `lint`,
    and `couple` (the spec/code coupling gate against the tenant's own
    spine). These are already present in the seeded workflow.
  - **tenant-tail** (the vended `tenant-tail` npm pin, spec 219):
    `verify-provenance --project . --fail-on-rejected` over
    factory-written claims, and `verify-certificate` over the project's
    `governance-certificate.json` when one is present.

  A non-zero gate fails the tenant PR. Because `verify-provenance`
  defaults to a diagnostic exit 0, the CI step MUST pass
  `--fail-on-rejected` for the gate to be enforcing (see FR-005).
  Per-CI-platform templates beyond GitHub Actions remain the spec 167
  deferral they already are.
- **FR-002: Born-with kernel completeness (fail-closed). [Delivered, PR #366.]**
  The live project-creation flow (statecraft's TypeScript Create path,
  `perRequestScaffold.ts`) writes the `.kernel-version` stamp and then
  asserts it is present and complete (parses, with a non-empty
  `spec_spine_version` and adapter identity) before creation completes; a
  missing or partial kernel fails creation with an attributable error,
  never a silent skip (the spec 200 FR-004 posture). This honours spec
  167 §2.4/§7: the live emission layer is the Create flow, not the
  `FactoryEngine` transition, so wiring the engine `emit_project_kernel`
  auto-fire would double-emit. The fail-closed *guarantee* the original
  "production pipeline auto-fire" deferral named is delivered here against
  the TypeScript path; the engine path stays the orthogonal non-npm
  fallback (OQ-6) spec 167 designed it to be.
- **FR-003: Tenant-emit certificate auto-fire. [Deferred to the emit spec
  (residual R-2).]** A tenant-side factory run emitting its governance
  certificate at termination under `.factory/runs/<run-id>/` is the
  spec 168 FR-002 tenant-emit leg. It is *not* delivered by this
  activation: tenant-tail (spec 219) is verify-only by construction, and
  the emitter (`build-certificate`) is identity-bearing and harness-bound,
  so it ships with its firing in a separate emit spec, not here. FR-001
  verifies a certificate *when one is present*; producing one on the
  tenant side is the deferred leg. Recorded here to keep the activation's
  eventual shape honest.
- **FR-004: Vended-tool integrity (npm-pin model).** The tenant pins
  `spec-spine` and `tenant-tail` as exact-version npm devDependencies
  (the pins recorded in `.kernel-version`, spec 167 FR-005). Integrity is
  the `npm ci` sha512 lockfile verification, which covers each package
  and its `@scope/cli-<os>-<cpu>` platform subpackages generically and
  aborts on a tampered lockfile entry (spec 219 FR-006). The tenant CI
  MUST install with `npm ci` (never `npm install`, which would not gate
  on the lockfile). The born-with `spec-spine` pin is recorded in
  `.kernel-version` (`kernel.spec_spine_version`, spec 167 FR-005); CI
  asserts the installed `spec-spine` version equals it, so a produced app
  cannot silently drift its governance toolchain away from the version it
  was born under (a mismatch fails the build naming the package).
  `tenant-tail` and the rest of the npm-vended toolchain are covered by
  the `npm ci` lockfile sha512 verification over their exact-version pins;
  tenant-tail is not recorded in `.kernel-version` today (the stamp
  predates the toolkit), and recording its pin there is a tracked future
  hardening (OQ-1). The produced app's gates must not be satisfiable by
  swapping the gatekeeper (ASI04 m6, continuous validation; the spec 102
  do-not-trust-the-producer posture applied to tooling). This supersedes
  the earlier "verify its content hash against `.kernel-version`" wording:
  the vended toolchain is npm packages, not loose binaries, so the
  lockfile sha512 (all tools) plus a born-with pin-equality check
  (`spec-spine`) is the integrity surface.
- **FR-005: Degraded-mode visibility.** A gate that cannot run (the
  `npx --no-install` resolution fails because a pin is missing, or
  advisory data is unreachable) fails visibly with a reason; skip-as-pass
  is forbidden across all seeded gates (the spec 200 FR-004 posture,
  uniformly applied). The enforcing posture for each verb's exit-code
  contract is explicit: `verify-provenance` runs with `--fail-on-rejected`
  (its default exit 0 is diagnostic only); `verify-certificate` fails on a
  bad certificate, and the workflow passes `--require-sealed` where a
  platform countersign is expected (otherwise an unsealed certificate is a
  visible exit-0 notice, never a silent pass). The workflow MUST NOT mask
  a gate's non-zero exit with `|| true` or `continue-on-error`.

## Acceptance criteria (sketch)

- **AC-1.** A freshly produced project's first CI run executes all
  seeded gates green, end-to-end from `git push` with no manual setup.
- **AC-2.** A seeded drift fixture (code edit without spine edit) fails
  the tenant coupling gate; a seeded unprovenance claim fails the
  validator; both fail the PR, not a log line.
- **AC-3.** The vended verifier accepts a governance certificate when one
  is present: the enforcing CI verifies every `governance-certificate.json`
  it finds and fails on a bad one. The tenant-side certificate *emit* and
  leave-behind-on-halt behavior (a run *producing* the certificate) is the
  FR-003 leg deferred to spec 220 and is demonstrated there, not by this
  activation (see Out of scope and FR-003). Reconciled at closure
  (2026-06-24) from the original sketch, which conflated verify-when-present
  with the deferred emit leg.
- **AC-4.** Tampering with a vended binary fails tenant CI with a hash
  diagnostic naming the binary.
- **AC-5.** Deleting a gate binary yields a visible failure with reason,
  not a skipped-green run.

## Out of scope

- New gate semantics (every wired gate exists; specs 127/130/133 own
  coupling semantics, 121 owns provenance, 168 owns the certificate).
- The certificate *emit* leg (FR-003 / spec 168 FR-002). Deferred to the
  emit spec (residual R-2); tenant-tail is verify-only and carries no
  emitter (spec 219 FR-002).
- The tenant-tail toolkit's own implementation, release matrix, and npm
  distribution. Governed by spec 219 and tenant-tail's own `specs/`
  corpus; this spec only consumes the published pin.
- The SBOM/dependency parity gate content (spec 203 defines it; this
  spec provides the enforcing CI home it lands in). The `verify-sbom`
  verb stays staged in tenant-tail until spec 203's core exists.
- Tenant retrofit beyond born-with projects (spec 165's promotion path;
  retrofit activation follows the same contract once that path emits
  kernels).
- OAP-side CI (specs 104/135/177 own it).

## Sequencing

FR-002 is delivered (PR #366). The tenant-tail vend blocker is cleared:
spec 219 published `tenant-tail@0.1.0` and its platform packages to npm,
so the run-side verifiers FR-001 invokes are a consumable pin. The
template-encore CI activation (FR-001/004/005) **landed** in
`.github/workflows/spec-spine.yml` (committed since that repo's initial
commit), which carries no in-OAP authority target (the same cross-repo
posture spec 219 records for its own closing legs). This spec coordinates
with spec 203 (whose parity gate lands in the CI surface this spec makes
enforcing) and precedes spec 210's falsifiability check for the same
reason. FR-003 (the emit leg) waits on the emit spec (spec 220, residual
R-2) and does not gate this activation.

## Open questions

- **OQ-1: record the `tenant-tail` pin in `.kernel-version`.** The
  born-with stamp records `kernel.spec_spine_version` but not a
  `tenant-tail` version (the stamp predates the toolkit). Today
  tenant-tail integrity rests on the `npm ci` lockfile sha512 (FR-004),
  which is sufficient for tamper-detection; recording the born-with
  `tenant-tail` pin would additionally let CI assert the verifier itself
  has not drifted from birth, symmetric with the `spec-spine` check. This
  is an OAP-side stamp change (`kernelVersionStamp.ts` + `version.rs`),
  deferred as a hardening rather than a blocker.
