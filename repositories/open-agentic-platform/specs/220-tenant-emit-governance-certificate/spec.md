---
id: "220-tenant-emit-governance-certificate"
title: "Tenant-Emit Governance Certificate (the emitter, its firing, and the tenant signer identity)"
feature_branch: "feat/220-tenant-emit-governance-certificate"
status: approved
implementation: complete
kind: capability
domain: platform
created: "2026-06-20"
authors: ["open-agentic-platform"]
language: en
summary: >
  The residual R-2 emit leg. Spec 168 made the certificate emitter capable of
  tenant-mode emission (a required signer, the run-dir post-hoc path) and spec
  219 vended the verify-only half (tenant-tail). But the emitter never reached a
  produced app: tenant-tail is verify-only by construction, and spec 209 FR-003
  explicitly deferred the emitter, its firing, and the tenant signer identity to
  this spec. A born-with app can therefore re-check a certificate it is handed
  but cannot produce one of its own, so spec 209's verify-certificate CI step is
  wired but dormant and the audit chain still terminates at the tenant boundary.
  Spec 220 closes that: it delivers a tenant-side emitter (the post-hoc
  build-certificate path, which needs only a laid-out run directory and a signing
  key, not OAP's pipeline orchestration), fires it as the terminal step of a
  tenant run (the spec 168 FR-002 "automatic at completion" guarantee), and
  defines the tenant signer identity and key custody (an operator-supplied
  Ed25519 secret outside the agent's write scope, an attributable principal,
  anonymous signing forbidden). The emitted certificate is Ed25519-signed and
  self-authenticating but carries no platform countersign (a tenant run is
  outside OAP's admission/grant flow), so it verifies offline as
  "verifiable-but-unsealed" under tenant-tail verify-certificate. This activates
  spec 209's dormant verify step and extends the independently-verifiable audit
  chain one commit past handoff.
code_aliases: ["TENANT_EMIT_GOVERNANCE_CERTIFICATE", "TENANT_CERT_EMIT"]
compliance:
  # Same controls spec 168 carries: a tenant's pipeline producing verifiable
  # provenance (ASI04) and an auditor who does not depend on the tenant's
  # narrative (ASI09). 220 is the leg that makes 168's claims true tenant-side.
  - framework: "owasp-asi-2026"
    controls: ["ASI04", "ASI09"]
depends_on:
  - "102-governed-excellence"
  - "168-per-project-governance-certificate"
  - "167-born-with-spec-spine-kernel"
  - "198-factory-governance-envelope"
  - "209-tenant-kernel-ci-enforcement"
  - "218-run-cert-corpus-binding"
  - "219-tenant-tail-verifier-toolkit"
establishes:
  # Spec 220 FR-003 (OQ-3): the platform mints the tenant's Ed25519 signing key
  # and sets it as the produced repo's OAP_SIGNING_KEY Actions secret at project
  # creation (tenant = project = repo). New statecraft module: mint a 32-byte
  # Ed25519 seed (standard base64, the emitter's `decode_seed` shape) and PUT it
  # as a libsodium sealed-box Actions secret. Plus its unit test.
  - unit: { kind: file, path: platform/services/statecraft/api/projects/scaffold/tenantSigningKey.ts }
  - unit: { kind: file, path: platform/services/statecraft/api/projects/scaffold/tenantSigningKey.test.ts }
  # Spec 220 AC-2 (Option C): unit test for the born-with typed-client regen
  # step. New file created by this spec.
  - unit: { kind: file, path: platform/services/statecraft/api/projects/scaffold/regenerateProducedClient.test.ts }
extends:
  # Same featuregraph-golden precedent specs 196/194/193/187/183/209/219 follow.
  - spec: "034-featuregraph-registry-scanner-fix"
    nature: additive
    unit: { kind: file, path: crates/featuregraph/tests/golden/features_graph.json }
  # 220 additively extends the emitter 168 established: the post-hoc
  # build_certificate.rs gains a --require-operator-key flag (FR-003) that refuses
  # the ephemeral fallback in production, plus the tenant firing posture. Edit
  # confined to build_certificate.rs; governance_certificate.rs is untouched
  # (203/Dev1 owns the next cert-version bump there, see "Decisions" below).
  - spec: "168-per-project-governance-certificate"
    nature: additive
    unit: { kind: file, path: crates/factory-engine/src/bin/build_certificate.rs }
  # 220 extends 218's corpus binding (read, never recompute) from the in-process
  # factory_run.rs read-path to the post-hoc build_certificate.rs path, mirroring
  # the same pattern: read OAP_CORPUS_ATTESTATION_PATH, hash via the public
  # spec_spine_core::attest::attestation_hash reader seam, and call the public
  # CertificateBuilder::corpus_binding(). No cert schema change (reuses the 1.6.0
  # CorpusBinding); no governance_certificate.rs edit.
  - spec: "218-run-cert-corpus-binding"
    nature: additive
    unit: { kind: file, path: crates/factory-engine/src/bin/build_certificate.rs }
  # 220 adds its operator-key (FR-003) and corpus-binding (FR-007) tests to
  # 168's tenant-emission integration suite, the shared file 168 established
  # for these tests. Additive: new test fns, no change to 168's own cases.
  - spec: "168-per-project-governance-certificate"
    nature: additive
    unit: { kind: file, path: crates/factory-engine/tests/tenant_emission_integration.rs }
  # FR-003 provisioning is invoked from spec 112's Create flow: create.ts gains a
  # `provision-signing-key` step (mint + set the secret before the first push, so
  # commit #1's born-with CI fires build-certificate --require-operator-key against
  # a resolvable operator key) and records the signer public key in the
  # project.created audit. Additive edit to the spec-112-established file.
  - spec: "112-factory-project-lifecycle"
    nature: additive
    unit: { kind: file, path: platform/services/statecraft/api/projects/create.ts }
  # Spec 220 AC-2 (Option C): the born-with app must ship a typed Encore client
  # matching its FINAL composed graph (a profile that composes user-management
  # otherwise ships a client missing the user_management namespace, failing the
  # produced app's own `Typed client up-to-date` gate). perRequestScaffold.ts
  # gains regenerateProducedClient (npm install + `npm run gen:client` per apps/api
  # with the pinned CLI on PATH), invoked from create.ts before the index regen.
  # Additive edit to the spec-112 scaffold file.
  - spec: "112-factory-project-lifecycle"
    nature: additive
    unit: { kind: file, path: platform/services/statecraft/api/projects/scaffold/perRequestScaffold.ts }
  # Spec 220 AC-2 (Option C): the warmup provisions the pinned Encore CLI into the
  # PVC (ensureEncoreCli, official install.sh, version read from the template's
  # encore.dev pin) so the per-request client regen can run `encore gen client`.
  # Additive edit to the spec-112 warmup file.
  - spec: "112-factory-project-lifecycle"
    nature: additive
    unit: { kind: file, path: platform/services/statecraft/api/projects/scaffold/templateCache.ts }
  # The matching `provision-signing-key` ScaffoldStep union member is an additive
  # edit to the spec-140-established scaffold/types.ts.
  - spec: "140-acme-vue-node-scaffold-source-id-cutover"
    nature: additive
    unit: { kind: file, path: platform/services/statecraft/api/projects/scaffold/types.ts }
  # The signer minting needs libsodium-wrappers (Ed25519 seed + GitHub sealed-box
  # secret). Additive dependency on the spec-116-owned statecraft package.json;
  # spec 116's supply-chain gate independently audits the new dependency.
  - spec: "116-supply-chain-policy-gates"
    nature: additive
    unit: { kind: file, path: platform/services/statecraft/package.json }
refines:
  # Leg 3 (kernel wiring): 220 fills the emitter slot spec 219 left deferred
  # (`status: pending-spec-220`). The born-with kernel toolchain manifest now
  # pins the released `tenant-emit` npm package and its `build-certificate`
  # invoke, mirroring the tenant-tail verifier block 219 landed in this same
  # file (FR-001 "kernel-pinned next to tenant-tail and spec-spine"). Same
  # `refines:`-by-aspect authority pattern 219 used for the toolchain template.
  - aspect: "emitter-pin-tenant-emit"
    unit: { kind: file, path: crates/factory-engine/templates/kernel/toolchain.yaml.tmpl }
  # The render test in kernel_emission/templates.rs asserts the deferred
  # `pending-spec-220` marker; filling the slot flips that assertion to the
  # pinned tenant-emit emitter block in lockstep with the template. This edge
  # makes the test change coupling-gate clean (mirroring 219's
  # `toolchain-render-tests-npm-pin` edge for the same file).
  - aspect: "toolchain-render-tests-emitter-pin"
    unit: { kind: file, path: crates/factory-engine/src/kernel_emission/templates.rs }
amends:
  # Clarification (not supersession): 168 FR-001/FR-002 (a tenant ships and fires
  # the emitter, automatic at completion) were capability-complete in-engine under
  # 168; the tenant-facing DELIVERY is this spec. See "Relationship to spec 168"
  # below and 168's "Amendments received" callout, landed in the same change.
  - "168-per-project-governance-certificate"
references:
  # Extraction SOURCES and context (not authority). The emit core stays in OAP
  # and keeps working; whatever tenant distributable carries it is tracked in
  # prose (the same cross-repo posture spec 219 records for tenant-tail and spec
  # 209 records for the template-encore CI leg). These are NOT extends edges
  # because OAP's behavior is preserved, not extended.
  - role: context
    unit: { kind: file, path: crates/factory-engine/src/governance_certificate.rs }
  # build_certificate.rs was promoted from a context reference to an owning
  # extends edge (above): 220 now modifies it. governance_certificate.rs stays a
  # context reference: 220 calls its public API (CertificateBuilder::corpus_binding,
  # the Signer types) but does not edit it, leaving that file to 203/Dev1's bump.
  - role: context
    unit: { kind: file, path: crates/factory-engine/src/platform_jws.rs }
  - role: context
    unit: { kind: file, path: specs/168-per-project-governance-certificate/spec.md }
  - role: context
    unit: { kind: file, path: specs/209-tenant-kernel-ci-enforcement/spec.md }
  - role: context
    unit: { kind: file, path: specs/219-tenant-tail-verifier-toolkit/spec.md }
---

# Feature Specification: Tenant-Emit Governance Certificate

**Feature Branch**: `feat/220-tenant-emit-governance-certificate`
**Created**: 2026-06-20
**Status**: Draft, decisions resolved 2026-06-21 (the residual R-2 emit spec
deferred by specs 209 FR-003 and 219; OQ-1..OQ-4 are now decided, see "Decisions")
**Input**: Spec 219's R-1 read concluded that the certificate verify core extracts
cleanly (shipped as tenant-tail) while "the emitter (`build-certificate`) is
identity-bearing and harness-bound and is explicitly NOT here; it ships with its
firing in a future emit spec (residual R-2)." Spec 209 FR-003 reframed the same
boundary: the tenant-emit leg "is deferred to the future emit spec (residual
R-2): tenant-tail is verify-only by construction." This spec is R-2.

## Relationship to spec 168 (capability landed; delivery deferred to here)

Spec 168 (`per-project-governance-certificate`) is marked
`implementation: complete`, and at the **capability** level it is: the emitter
gained a tenant-mode path that requires an attributable signer
(`governance_certificate.rs` `Signer` constructor rejects an empty subject), a
post-hoc build path from a run directory (`build_certificate.rs`), and a tenant
emission integration test (`tenant_emission_integration.rs`). What 168 did **not**
deliver is the *tenant-facing* guarantee its FR-001/FR-002 assert: that a produced
app "ships with both an emitter and a verifier" and that "emission is automatic at
run completion." Spec 219 subsequently vended only the verifier (tenant-tail,
verify-only by construction), and spec 209 FR-003 deferred the emitter explicitly.
So today a produced app has the *capability's verifier half* but cannot emit.

Spec 220 delivers the missing half. It does not supersede spec 168; it is the
delivery vehicle for 168 FR-001/FR-002 at the tenant boundary. **Reconciliation
(surfaced, not silently absorbed):** spec 168's `implementation: complete` reads
at the tenant-facing level as more than was delivered. This spec carries an
`amends: 168` edge, and the clarification callout already landed in spec 168's
"Amendments received" section when this spec was filed (#397, 168 `amended:
2026-06-20`): 168's FR-001/FR-002 were capability-complete
in-engine (the tenant-mode emitter, the required-signer enforcement, the post-hoc
build path, and the integration test), and the tenant-facing delivery (vending the
emitter, firing it, and the tenant key custody) lands here. The clarification does
not flip 168's status; it records that "complete" was capability-level and that
the tenant boundary is crossed by spec 220.

## Purpose

The certificate is the load-bearing artifact: a self-authenticating
`governance-certificate.json` an auditor verifies without trusting the system that
produced it (spec 102 FR-007). Spec 168's thesis is that the same discipline must
extend to the tenant boundary, or "the single audit chain you hand a regulator" is
true up to handoff and unverifiable one commit later. Spec 219 delivered the
tenant's ability to *check* a certificate; spec 209 wired a `verify-certificate`
step into the seeded tenant CI. But with no tenant emitter, that step is dormant:
it verifies a certificate only "when one is present," and none ever is. The chain
still terminates at the tenant boundary.

This spec lets a produced app **produce** its own certificate, so the verify step
has something real to check and the audit chain crosses the boundary.

## What exists today (grounding the scope)

The emit core is **post-hoc**, which is what makes tenant emission tractable
without shipping OAP's pipeline engine:

- **`build-certificate` reconstructs a certificate from a finished run directory.**
  It scans `<run-dir>/<stage-id>/<artifact-files>`, computes SHA-256 over each
  file, reads the frozen Build Spec, and writes
  `<run-dir>/governance-certificate.json`. It does **not** re-run the pipeline or
  require `FactoryPipelineState`. It accepts `--signer-subject` /
  `--signer-identity-provider` and resolves the signing key from
  `OAP_SIGNING_KEY` / `OAP_SIGNING_KEY_PATH` (operator-supplied) or an ephemeral
  fallback (marked untrusted).
- **The signer is identity-bearing.** The `Signer` field (subject,
  identityProvider, sessionId) names the principal; its constructor rejects an
  empty/whitespace subject (168 FR-007: anonymous signing forbidden). The Ed25519
  signing key is operator-supplied and lives outside the agent's write scope (102
  FR-008.1).
- **The inter-stage manifest chain (spec 170) is optional.** The emitter
  reconstructs it from `<run-dir>/manifests/` + `keychain.json` if present, or
  establishes a fresh root key; a tenant that does not sign hand-offs still emits
  a valid certificate.
- **The platform countersign (spec 198 FR-014) is applied post-emission by
  statecraft on sync-back.** It is not part of emission. A certificate with no
  countersign is "verifiable-but-unsealed" and verifies offline (198 FR-014 AC-4).
- **tenant-tail `verify-certificate` already accepts this shape offline**
  (artifact-hash chain, Ed25519 signature, self-hash, optional inter-stage chain,
  optional platform seal, optional `--corpus-attestation`). The verifier round-trip
  is the contract spec 220 must satisfy.
- **The corpus-binding read-path exists in-process (spec 218).** `factory_run.rs`
  reads `OAP_CORPUS_ATTESTATION_PATH`, hashes the attestation via the public
  `spec_spine_core::attest::attestation_hash` reader seam, and binds it through
  `CertificateBuilder::corpus_binding()`. FR-007 mirrors that read-path onto the
  post-hoc `build_certificate.rs`; it is an extension of the emitter work, not a
  fourth independent gap.

The three concrete tenant-side gaps (the crux): **no emitter binary** reaches a
produced app, **no signer-key custody** model is defined for a tenant, and **no
firing point** invokes the emitter at a tenant run's completion.

## Functional requirements

- **FR-001: Tenant emitter delivered.** A produced app gains a vended emitter
  that runs the post-hoc certificate build against a tenant `.factory/runs/<run-id>/`
  directory and writes a signed `governance-certificate.json` there. Because spec
  219 makes tenant-tail verify-only **by construction** (no emitter verb, no
  emitter dependency, structurally testable), the emitter is a **separate**
  distributable, never a tenant-tail verb (preserving spec 219 FR-002 / AC-6).
  **Packaging (OQ-1, decided):** a dedicated `tenant-emit` repository, a sibling
  to tenant-tail. A Rust core with npm + py distributions produced at release,
  consuming the pinned `spec-spine`, carrying the same GitHub release/CI workflows
  tenant-tail does, and kernel-pinned so the born-with toolchain installs it next
  to tenant-tail and spec-spine. **License (OQ-2, decided):** Apache-2.0, matching
  tenant-tail and the rest of the vended toolchain (the sole copyright holder's
  prerogative, recorded here as an explicit decision). The emit core stays in OAP
  (`build_certificate.rs` + `governance_certificate.rs`); the `tenant-emit`
  distributable carries an extracted copy of both, kept in behavior parity exactly
  as tenant-tail does for the verifier. OAP-side, this spec modifies **only**
  `build_certificate.rs` (the FR-003 flag and the FR-007 corpus read-path);
  `governance_certificate.rs` is consumed through its public API and left
  unchanged for spec 203 (Dev1) to carry its next version bump.
- **FR-002: Firing at completion (automatic, not opt-in).** The tenant pipeline
  invokes the emitter as its terminal step on every run (success or halt),
  realizing spec 168 FR-002. In the born-with shape the firing is a step in the
  seeded CI / pipeline runner, the emit-side counterpart of the
  `verify-certificate` step spec 209 FR-001 already seeded. Once this step exists,
  spec 209's dormant verify step verifies a real certificate (closing that loop).
- **FR-003: Tenant signer identity and key custody.** Emission requires an
  attributable signer and a signing key the agent cannot mint:
  - The Ed25519 signing key is an **operator-supplied tenant secret** (a CI or
    deployment secret resolved via `OAP_SIGNING_KEY` / `OAP_SIGNING_KEY_PATH` or a
    tenant-scoped equivalent), held outside the repository and outside any agent's
    write scope (spec 102 FR-008.1 posture, spec 198 FR-014 "every agent is
    keyless" posture turned tenant-ward).
  - The `signer` field names the tenant principal: a Rauthy-issued JWT subject for
    human-driven runs (spec 168 FR-007, specs 106/137) or an attributable service
    identity for unattended runs.
  - **Anonymous signing is forbidden, and the ephemeral fallback is refused in
    production.** A run that cannot resolve a signer halts before emitting rather
    than writing a null-signer certificate (spec 168 FR-007, the spec 200 FR-004
    fail-closed posture). The ephemeral key fallback is dev-only and marks the
    certificate untrusted (`signing_attestation.kind: ephemeral`). A production
    tenant emission MUST pass the new `--require-operator-key` flag, under which the
    emitter exits non-zero with a named diagnostic if signing material resolves to
    `ephemeral` rather than `operator`. This is the **single OAP in-engine change**
    this spec makes: a CLI-level flag on `build_certificate.rs`. It is deliberately
    not pushed into `resolve_signing_material`, so OAP's own dev / CI runs keep
    their legitimate ephemeral path (confirmed by the OQ-4 read of the emit core).
  - **Key provisioning (OQ-3, decided).** Because a tenant is a project and a
    project is a repo, the platform that creates the project mints the tenant's
    Ed25519 key and sets it as the repo's CI secret (resolved by the emitter via
    `OAP_SIGNING_KEY` / `OAP_SIGNING_KEY_PATH`) at project-creation time. This
    collapses the apparent fork (a manually-configured CI secret vs a
    platform-issued per-tenant key) into one flow, and it is the same provisioning
    hook the deferred platform countersign / uplink (Out of scope) reuses to issue
    a sealing identity. A tenant that self-hosts may configure the CI secret by
    hand instead; the emitter contract is identical either way. Setting that
    secret hits GitHub's `/repos/{repo}/actions/secrets/*` endpoints, which are
    governed by the App installation's dedicated `secrets` permission (**not**
    `actions`): the Create-flow token broker must request `secrets: write` and
    the OAP GitHub App must be granted the repository Secrets permission, or the
    provisioning 403s at the public-key fetch ("Resource not accessible by
    integration") and fail-closes the scaffold before commit #1.
- **FR-004: Unsealed-but-verifiable posture.** A tenant run is outside OAP's
  admission/grant flow, so the emitted certificate carries **no platform
  countersign** (spec 198 FR-014). It is Ed25519-signed by the tenant signer and
  self-authenticating. tenant-tail `verify-certificate --allow-unsealed` accepts it
  offline and reports it "verifiable-but-unsealed" (198 FR-014 AC-4). As of
  tenant-tail 0.3.0 the platform seal is **required by default**, so an unsealed
  certificate exits 1 unless `--allow-unsealed` is passed; the born-with verify step
  passes it because a tenant run has no seal to adjudicate. A tenant that opts into a
  platform countersign drops the flag and supplies `--platform-jwks` instead. The
  platform countersign and the tenant-to-OAP certificate uplink are deferred (spec
  168 already defers the uplink; see Out of scope).
- **FR-005: Verifier round-trip closes the loop.** A certificate emitted under
  FR-001 verifies clean under tenant-tail `verify-certificate` (artifact-hash
  chain re-derived from the run dir, Ed25519 signature, self-hash). Tampering any
  referenced artifact, or any certificate field, fails verification with the spec
  102 / 168 diagnostic contract. The same certificate, fed to the spec 209 FR-001
  CI step, turns that step from dormant to enforcing. When the certificate carries
  a corpus binding (FR-007), the round-trip also covers it: tenant-tail
  `verify-certificate --corpus-attestation <file>` re-derives and matches the bound
  hash (spec 218 FR-003), and a mismatched or tampered attestation fails with the
  spec 218 diagnostic.
- **FR-006: Stage-grammar flexibility and determinism.** The emitter accepts the
  tenant's own stage shape (spec 168 §2.4: stages need only be representable as
  `{stage_id, input_hashes, output_hashes, runtime_metadata}`); it does not require
  the tenant pipeline to match OAP's s0..s6 grammar. Re-emitting from the same run
  directory produces byte-identical hashes (spec 168 FR-009), modulo the signer
  field which carries per-run identity.
- **FR-007: Tenant corpus binding (read, never recompute).** The tenant emitter
  binds the certificate to a corpus attestation over the tenant's **own** `specs/`
  corpus, the same chain edge spec 218 added to OAP's run cert, now extended to the
  post-hoc tenant path. The seeded tenant CI runs `spec-spine attest` over the
  produced app's corpus (every born-with app carries a `specs/` corpus and a pinned
  spec-spine, specs 167/209) to emit `attestation.json`; the emitter reads it via
  `OAP_CORPUS_ATTESTATION_PATH`, hashes it through the public
  `spec_spine_core::attest::attestation_hash` reader seam, and populates
  `corpus_binding` via the public `CertificateBuilder::corpus_binding()`. Read,
  never recompute (spec 218's load-bearing invariant): the emitter never compiles
  or re-attests the corpus, and the FR-002 deny/clippy guards (now in main) keep
  the extracted copy honest too. The binding is additive and optional exactly as in
  spec 218: an unbound tenant certificate is the named "unbound" state, not a
  failure. The bound attestation is the tenant's own governance ledger ("I ran a
  pipeline, and at this commit my spec corpus was in this consistent state"),
  distinct from OAP's platform corpus; the two certificates carry parallel,
  independently reproducible corpus links. **Scope confinement:** this wiring lands
  entirely in `build_certificate.rs` (mirroring the `factory_run.rs` read-path),
  reuses the 1.6.0 `CorpusBinding` with no schema change and no version bump, and
  does not touch `governance_certificate.rs` (left to spec 203's 1.7.0 SBOM bump).

## Acceptance criteria

- **AC-1.** A born-with app lays out a run under `.factory/runs/<run-id>/<stage-id>/`
  and, at run completion, the vended emitter writes a signed
  `governance-certificate.json` under that run directory with an attributable
  signer and `signing_attestation.kind: operator`.
- **AC-2.** tenant-tail `verify-certificate <cert> --artifact-dir <run-dir> --allow-unsealed`
  exits 0 on that certificate (the tenant cert is unsealed by design, FR-004, and
  tenant-tail 0.3.0 rejects an unsealed certificate by default); and the spec 209
  FR-001 seeded CI `verify-certificate` step, run against a produced app that now
  emits, verifies a real certificate green end-to-end (the dormant step activates).
- **AC-3.** Tampering any artifact the certificate references, or any certificate
  field, makes `verify-certificate` exit 1 with a specific mismatch diagnostic.
- **AC-4.** A run with no resolvable signer (no `signer-subject`, no identity
  context) halts before emission with an attributable error; no null-signer
  certificate is written.
- **AC-5.** The emitted certificate verifies fully offline (no network) under
  `--allow-unsealed`, where it is reported "verifiable-but-unsealed"; tenant-tail's
  default (seal required as of 0.3.0) fails it (there is no platform countersign on
  a tenant run).
- **AC-6.** The emitter is not reachable as a tenant-tail verb and tenant-tail's
  verify-only boundary (spec 219 FR-002, AC-6) is unbroken: the two tools remain
  distinct distributables.
- **AC-7.** Re-emitting from the same run directory yields identical artifact and
  certificate hashes (determinism), modulo the signer field.
- **AC-8.** With a tenant corpus attestation present, the emitted certificate
  carries `corpus_binding.corpus_attestation_hash` equal to that attestation's hash
  (FR-007), and tenant-tail `verify-certificate --corpus-attestation <file>`
  reports it verified; a mismatched or tampered attestation fails with the spec 218
  diagnostic; with no attestation supplied the certificate is emitted "unbound"
  (named, not a failure). The emitter performs no corpus recompute on any path.

## Out of scope

- **The platform countersign and the tenant-to-OAP uplink.** A tenant run does not
  pass through OAP's admission seal / run-grant / countersign flow (spec 198
  FR-014); the tenant certificate is unsealed by design. Sealing a tenant run, and
  aggregating tenant certificates into a portfolio audit view at the substrate, is
  the deferred uplink spec 168 already names. FR-004 relies on tenant-tail's
  `--allow-unsealed` opt-out (the seal is required by default as of tenant-tail
  0.3.0) until that uplink lands.
- **The certificate format and verdict logic.** Owned by specs 102/168 (cert),
  170 (inter-stage chain), 198 (platform seal), 121 (provenance). Spec 220 changes
  who emits and where the key lives, not what a valid certificate is.
- **The tenant pipeline / run-harness itself.** How a produced app lays out its own
  `.factory/runs/<run-id>/` (its adapter's stage grammar) is the tenant's pipeline
  concern; spec 220 requires only the post-hoc directory convention the emitter
  scans. Authoring a generic tenant pipeline runner is separate work.
- **Schema evolution across kernel generations.** When the spec 102 format evolves,
  born-earlier tenants carry an older emitter; compatibility is the deferred
  kernel-update-propagation concern (spec 167), not this spec.
- **OAP-side emission.** Specs 102/168 own OAP's own factory-run emission; 220 is
  strictly the tenant boundary.

## Decisions (the OQs, resolved)

The four open questions the draft carried are now decided; this section records the
resolution and the evidence behind it so implementation does not reopen them.

- **OQ-1 (packaging): a dedicated `tenant-emit` repository, kernel-pinned.** A
  sibling to tenant-tail: Rust core, npm + py at release, consuming the pinned
  spec-spine, with tenant-tail's GitHub workflows, pinned by the born-with kernel
  next to tenant-tail and spec-spine. Not folded into spec-spine (its ledger seal
  signs the corpus attestation, a different object than the run certificate, so the
  emitter cannot reuse it) and not a tenant-tail verb (spec 219's verify-only
  boundary is by construction). The dedicated-repo shape keeps the verify/emit
  separation legible while kernel-pinning keeps the binary, the operator key
  (OQ-3), and the firing step co-located.
- **OQ-2 (license): Apache-2.0**, matching tenant-tail and the rest of the vended
  toolchain.
- **OQ-3 (key provisioning): platform-mints-at-creation.** Tenant = project = repo,
  so the platform that creates the project mints the Ed25519 key and sets it as the
  repo CI secret at creation (see FR-003). The same hook the deferred uplink reuses
  to countersign.
- **OQ-4 (in-engine footprint): one CLI flag plus the corpus read-path, one file.**
  The OQ-4 read of the emit core confirmed the post-hoc path already carries the
  run-dir arg, `--tenant-mode`, the signer flags, `--stage-ids auto`, the `Signer`
  empty-subject rejection, and the unsealed-but-verifiable posture. The single
  genuine gap is FR-003's "production uses operator": the `--require-operator-key`
  flag on `build_certificate.rs` (CLI-level only). FR-007's corpus read-path is a
  second small addition to the same file, calling public API. Net OAP in-engine
  footprint: ~35 LOC in `build_certificate.rs`; `governance_certificate.rs`
  unchanged.

### Coordination with spec 203 (Dev1, produced-app SBOM attestation)

Spec 203's plan (merged via #403) is concurrently editing
`governance_certificate.rs` (new SBOM artifact structs after `CorpusBinding`, cert
version 1.6.0 -> 1.7.0) and references this spec's firing step. To avoid a
shared-file authority tangle and a version-bump race, spec 220 deliberately stays
out of `governance_certificate.rs`: it edits only `build_certificate.rs` and reaches
the cert types through their public API. Spec 203 owns the next cert-version bump;
spec 220 adds no field and no version. The two compose at the tenant firing point
(a tenant run generates its SBOM (203) and its corpus attestation (FR-007), then
emits one certificate (220) that can bind both), and that sequencing is the only
contract between them. This coordination is prose, not a registry edge (203 and 220
carry no formal relationship), tracked the way spec 218 tracks its cross-corpus
dependency.

## Sequencing

Implementable now, and the OQs are decided (see "Decisions"). The verifier and the
seeded `verify-certificate` CI step exist (specs 219 / 209); the emit core and its
post-hoc path exist in-engine; the certificate format, the corpus binding, and the
unsealed posture are settled (specs 102/168/198/218). The work splits into three
legs, mirroring the spec 219 shape (build the tenant distributable, then wire the
OAP-side leg that pins it):

1. **OAP engine (this repo, source of truth):** the `--require-operator-key` flag
   (FR-003) and the corpus read-path (FR-007) on `build_certificate.rs`, ~35 LOC in
   one file, plus a test. Lands first so the extracted copy is in behavior parity.
2. **`tenant-emit` repo (parallel session):** extract `build_certificate.rs` +
   `governance_certificate.rs`, package Rust + npm + py, port the
   `tenant_emission_integration` tests, consume the pinned spec-spine, carry
   tenant-tail's GitHub workflows, Apache-2.0, release (FR-001).
3. **OAP kernel wiring + closure:** the born-with kernel template pins the released
   `tenant-emit` and seeds the firing step (FR-002, the emit-side counterpart of
   the verify step spec 209 seeded) plus the `spec-spine attest` step (FR-007).

Closure is gated on AC-2: a real produced app emitting a certificate that the spec
209 CI step verifies green, which is also the end-to-end validation spec 209's own
AC-1 silently required, so landing this leg unblocks spec 209's closure.

## Implementation status (2026-07-01)

**OAP-side factory-engine cert work: landed (Legs 1 and 3-pin).** The engine
surface this spec owns is merged and tested on main:

- **Leg 1 (engine, #407).** `build_certificate.rs` carries the
  `--require-operator-key` flag (FR-003): a production tenant emission exits
  non-zero with a named diagnostic when signing material resolves to
  `ephemeral` rather than `operator`, so no untrusted certificate is written.
  It also carries the FR-007 corpus read-path: `resolve_corpus_binding()` reads
  `OAP_CORPUS_ATTESTATION_PATH` (or `--corpus-attestation`), hashes the supplied
  attestation via the public `spec_spine_core::attest::attestation_hash` seam,
  and binds it through `CertificateBuilder::corpus_binding()`. Read, never
  recompute: the emitter never compiles or re-attests the corpus. Three
  integration tests cover the operator-key halt, the operator-key pass, and the
  corpus round-trip (`tenant_emission_integration.rs`).
- **Leg 3 pin (#410).** The born-with kernel toolchain manifest
  (`toolchain.yaml.tmpl`) pins the vended `tenant-emit` emitter next to
  tenant-tail and spec-spine (FR-001 kernel-pinning); the `pending-spec-220`
  deferred marker is gone and the `templates.rs` render test asserts the pinned
  block.
- **Scope confinement held.** 220 touched only `build_certificate.rs` (engine)
  and the kernel template files; `governance_certificate.rs` was left untouched
  for spec 203's 1.7.0 SBOM bump, exactly as the "Coordination with spec 203"
  section required. No shared-file authority tangle occurred.

**2026-07-01: Legs 1 + 2 + FR-003 provisioning landed; only the live AC-2 run
remains, so implementation stays `in-progress` (not `complete`).** The three
external legs the prior status listed are now built:

1. **Leg 2 (`tenant-emit` published).** `tenant-emit@0.2.0` (unscoped) plus its
   five `@tenant-emit/cli-<triple>` platform packages are live on npm, so the
   kernel's `npx --no-install tenant-emit build-certificate` pin resolves.
   `build-certificate` carries the FR-003 `--require-operator-key`, FR-007
   `--corpus-attestation`, and spec 203 `--sbom-dir` flags.
2. **FR-002 firing step.** Seeded into the prebuilt template's external
   `spec-spine.yml` (`statecrafting/template-encore`), gated on `.kernel-version`
   so it is dormant in the template and active in a produced app: a terminal
   `tenant-emit build-certificate <run-dir> --tenant-mode --require-operator-key
   --sbom-dir . --corpus-attestation attestation.json` after SBOM/audit
   generation (spec 203 FR-001/FR-002) and the FR-004 parity gate, with the
   existing spec 209 `verify-certificate` step extended to re-check the SBOM and
   corpus bindings (`--sbom-dir` / `--corpus-attestation`).
3. **FR-003 key custody (OQ-3): provisioning now built.** Statecraft's Create
   flow mints a per-tenant Ed25519 seed and sets it as the produced repo's
   `OAP_SIGNING_KEY` Actions secret before the first push
   (`api/projects/scaffold/tenantSigningKey.ts`, wired from `create.ts`), so the
   born-with CI's `--require-operator-key` firing resolves an operator key rather
   than halting on the ephemeral fallback. The signer public key is recorded in
   the `project.created` audit for attribution.

**Remaining: the live AC-2 end-to-end.** With Legs 1-3 in place a real
produced-app run should emit a certificate the dormant spec 209 verify step then
accepts green. That single end-to-end demonstration (scaffold a tenant, let its
CI run) is the only closure gate left; the code path is complete. The OAP-side
cert engine and the platform-side key custody are done; the tenant boundary is
now crossed in code, pending the live-run confirmation.

**2026-07-01 (live AC-2 attempt 1): the first real scaffold surfaced a
broker-permission gap, now fixed.** The prior note's "the code path is complete"
was falsified by the first live create. The Create flow brokered its GitHub App
installation token with `{contents, administration, actions, workflows}` but
**not** `secrets`, so FR-003's `provisionTenantSigningKey` 403'd at the
Actions-secrets public-key fetch ("Resource not accessible by integration") and
fail-closed the scaffold before commit #1 (the repo was created but never
pushed; the scaffold job orphaned). Root cause: GitHub governs
`/repos/{repo}/actions/secrets/*` under the dedicated `secrets` permission, not
`actions` (the earlier `tenantSigningKey.ts` comment claiming `actions: write`
sufficed was wrong; the unit tests mock `fetch`, so only a live run caught it).
Fixed by adding `secrets: write` to the brokered token (`create.ts`) and
granting the OAP GitHub App the repository Secrets permission. AC-2 closure now
waits on a deploy of this fix plus a retried scaffold.

**2026-07-04 (live AC-2 attempt 2): the retried scaffold cleared the secrets
gap but surfaced a glibc floor, now fixed and deployed.** With `secrets: write`
brokered, the retried scaffold reached the produced-app regenerate-index step
(spec 112 §5.3), which runs the produced app's pinned
`@spec-spine/cli-linux-x64` inside the statecraft container. That binary is
built on `ubuntu-latest` (glibc 2.39) while statecraft's runtime base was
`node:22-slim` (Debian bookworm, glibc 2.36), so it aborted with
`GLIBC_2.39 not found`. Fixed by bumping the runtime base to
`node:22-trixie-slim` (glibc 2.41) in
`platform/services/statecraft/Dockerfile.base` (#512), deployed to Hetzner (CD
statecraft green on `4cb4f34b`).

**2026-07-04 (live AC-2 attempt 3): a Dual-variant scaffold fails regenerate-index
because the dual produced tree has no root `specs/` corpus. Confirmed a real
statecraft bug, not deployed skew or a source bug.** With the glibc floor cleared
the pinned binary executes and immediately exits 3: `spec-spine compile ... cannot
read specs dir .../spec220-ac2-verify/specs: No such file or directory`.
`regenerateProducedIndex` (`api/projects/scaffold/perRequestScaffold.ts`) runs one
`spec-spine compile` at the produced ROOT. A live read-only diagnostic on the
Hetzner `statecraft-api` pod disproved the deployed-skew hypothesis and pinned the
cause:
- The warmup caches are current: `_factory-cache` HEAD = `c988258` (factory-encore
  `main`, which DOES carry specs), `_template-cache` ships the full `specs/`
  corpus, and the live `_prebuilt/current` is keyed to both current SHAs.
- Single variants (`minimal`/`public`/`internal`) ship `specs/` + `spec-spine.toml`
  + `Makefile` + `tools/` at the produced root, so `compile` at root works.
- The Dual variant produces a two-sub-app monorepo: the dual root holds only
  `internal/` and `public/`, and each sub-app carries its OWN root-level `specs/`
  (`dual/internal/specs`, `dual/public/specs`). The dual root has no corpus, so the
  single root-level `compile` finds nothing and exits 3.

So `regenerateProducedIndex` assumes a single-app layout (one root `specs/`). AC-2
does not require the Dual variant, so the closure path is: (a) re-scaffold with a
Single variant, which passes regenerate-index and reaches commit #1 with a
committed `.derived`; and (b) as a separate follow-up, make `regenerateProducedIndex`
iterate per sub-app (`internal/`, `public/`) for the Dual variant rather than once
at the root. `implementation` stays `in-progress` pending the Single-variant
live run.

**2026-07-04 (live AC-2 attempt 4, Single variant): scaffold born-green, but the
produced app's own CI is red on two further born-with defects.** Re-scaffolded with
the Single (internal) variant. The scaffold SUCCEEDED: `statecrafting/spec220-ac2-single`
commit #1 (`a77a876b`) carries a committed `.derived/codebase-index/` (`by-spec` +
`by-package`) and a root `specs/` corpus, and the produced app's `spec-spine` CI job
passes the codebase-index staleness gate, confirming the attempt-3 diagnosis (Single
has a root corpus, so regenerate-index works). But the produced-app CI's cert path did
NOT run green:
- **Claim provenance verify (spec 209 FR-001 / spec 121) FAILED**, which SKIPPED the
  downstream "Emit governance certificate" (FR-002) and "verify-certificate" steps, so
  the AC-2 cert chain never executed. Cause: the step runs `tenant-tail verify-provenance
  --project . --fail-on-rejected`, which exits 1 on a fresh scaffold because there is no
  BRD (`brdNotFound=true`, `total=0` claims, `rejected=0`): "no BRD found under the
  project; nothing was verified". A born-green app with zero claims has nothing to
  reject, so this should be a vacuous pass; the fix belongs in tenant-tail (spec 219) or
  the born-with CI step (spec 209 FR-001), not in this spec.
- **`encore check` FAILED** separately: "unable to read static assets directory: No such
  file or directory". The produced app's Encore graph parse expects a static-assets dir
  (the built SPA) that is absent at check time. A produced-app born-with composition/CI
  defect, independent of the cert path.

AC-2 remains blocked on the provenance-verify-on-empty-BRD behavior (the cert emit and
verify steps are gated behind it). `implementation` stays `in-progress`.

**2026-07-05 (live AC-2 attempts 5-6, Single variant): the cert chain now runs green
through emit; the last cert-chain blocker is the unsealed-verify default.** The
attempt-4 blockers were cleared upstream: template-encore #36 seeds a born-with BRD
placeholder (empty-BRD provenance now a vacuous pass) and #39 carries the SPA build
placeholder into born-with apps (the `encore check` static-assets read succeeds). On
the push run for commit `b881510f` (which, unlike a Dependabot PR run, has signing-key
access), every cert-chain step is green through **Emit governance certificate** (a
real, operator-signed certificate is written), and the corpus + SBOM bindings both
verify. The chain fails at exactly one step:

- **Governance certificate verify FAILED** with a single error: the certificate is
  "verifiable-but-UNSEALED (no platform countersign) ... rejected by default (spec 198
  FR-014); pass --allow-unsealed to accept an unsealed certificate". This is not a
  defect: a tenant run is unsealed by design (FR-004, Out of scope). The cause is that
  **tenant-tail 0.3.0 (2026-07-03) inverted its default** -- the seal is now required
  by default and the old `--require-sealed` opt-in became a deprecated no-op, replaced
  by a new `--allow-unsealed` opt-out (tenant-tail CHANGELOG 0.3.0 "Breaking"). Spec
  220's AC-2/AC-5/FR-004 were written against the pre-0.3.0 semantics. **Resolution
  (this commit):** the born-with verify step now passes `--allow-unsealed`
  (template-encore `.github/workflows/spec-spine.yml`), and AC-2, AC-5, and FR-004 are
  amended to the 0.3.0 contract (seal-required-by-default, `--allow-unsealed` opt-out
  for the unsealed-by-design tenant cert). This is a faithful contract-sync: it aligns
  the acceptance criteria with both the tool's deliberate hardening and the spec's own
  unsealed-by-design tenant model, not a relaxation of the cert's verdict logic.

- **Typed client staleness FAILED (separate, off the cert-chain path).** The produced
  app's `Typed client up-to-date` CI job regenerates `apps/web/src/lib/encore-client.ts`
  from the produced app's own Encore graph and finds it missing the `user_management`
  service namespace (spec 003). Root cause is generator-side and **not** trivially a
  scaffold-time regen: the internal profile composes the `user-management` module into
  `apps/api`, but the committed client is copied verbatim from template-encore's base
  graph (auth/gateway/health/web) and never updated, because the scaffold runs the
  generator with `NO_INSTALL=true` (statecraft `templateCache.ts` warmup +
  `perRequestScaffold.ts`), which skips `encore gen client` entirely (setup-app.ts step
  4), and the warmup container has no Encore CLI or booted app to regenerate it offline.
  (`setup-app.ts` also writes the regenerated client to the wrong path,
  `apps/web/src/client.ts`, not `apps/web/src/lib/encore-client.ts`.) The fix is a
  born-with-contract choice -- splice a per-module client fragment during composition,
  or relocate the drift gate for born-with `Initial commit` -- tracked separately from
  this spec's cert chain.

AC-2's cert chain is one flag away from green; `implementation` stays `in-progress`
pending the re-scaffold that carries the `--allow-unsealed` verify step and the
typed-client fix.

**2026-07-06 (live AC-2 attempt 7, Single variant): the merged Option C fixes
deployed and the warmup+cache posture is correct, but the first re-scaffold failed
on a bug in the Option C CLI provisioning itself, now fixed.** All three PRs merged
(template-encore #42, factory-encore #16, OAP #519); statecraft redeployed
(`sha-dcabc54`); the warmup refreshed its caches to the merged SHAs (template
`3da8b679`, factory `0191d32c`) and published all four prebuilds. But the first
Single-internal scaffold (`spec220-ac2-single-4`) halted at
`regenerateProducedClient` with `npm run gen:client exited 127: sh: 1: encore: not
found`, orphaning the job before push (an empty repo was created and must be
reclaimed). Root cause: `ensureEncoreCli` provisioned the CLI via
`curl -fsSL https://encore.dev/install.sh | bash`, but the statecraft runtime image
is slim and ships **no curl/wget**; the missing-curl failure was masked because a
`curl | bash` pipeline exits with bash's status (0 on empty stdin), not curl's, so
the warmup logged `encore CLI: ready` and wrote the idempotency marker while the
binary was never installed. Fix (this change): download the pinned release tarball
(`https://d2f391esomvqpi.cloudfront.net/encore-<version>-linux_amd64.tar.gz`) with
node's `fetch`, streamed to disk, and extract with `tar` (both present in the image);
verify `encoreBin` exists before writing the marker so a partial install can never
masquerade as ready. `implementation` stays `in-progress` pending the redeploy of
this fix and a clean re-scaffold.

**2026-07-06 (live AC-2 attempt 8, Single variant): SUCCESS. A born-green scaffold
emitted and verified a real governance certificate end-to-end; AC-2 is satisfied
verbatim and `implementation` flips to `complete`.** After #524 (`c8a60621`, the
node-fetch+tar CLI provisioning) merged and statecraft redeployed, the re-scaffold
`statecrafting/spec220-ac2-single-4` was born green. Its born-with `Initial commit`
push ran the full cert chain in the `spec-spine` job (CI run 28809268503) to
completion, every step green:

- **Emit** (step 14, "Emit governance certificate", spec 220 FR-002 firing): the
  vended emitter fired at run completion and wrote an operator-signed
  `governance-certificate.json` under `.factory/runs/ci-28809268503/`
  (status=Complete, `signing_attestation.kind: operator`), satisfying AC-1.
- **Verify** (step 15, "Governance certificate verify", spec 209 FR-001 + spec 168):
  the spec 209 FR-001 seeded CI verify-certificate step, dormant until a produced
  app could emit, activated and reported the certificate VERIFIED under
  `--allow-unsealed` (the unsealed-by-design tenant posture, FR-004 / AC-5). This
  is the AC-2 done-when: a real produced app emits, and the seeded verifier verifies
  it green end-to-end.
- **Bindings**: tenant corpus attestation (step 13, FR-007, AC-8) and produced-app
  SBOM + audit + BOM/lockfile parity (steps 11-12, spec 203) all green.
- **Typed client** (`encore / Typed client up-to-date`): green, because the Option C
  warmup regenerated the born-with client at scaffold time so it now carries the
  `user_management` namespace (closing the attempt-4/6 typed-client blocker, which
  sat off the cert-chain path).
- The whole born-with `ci-gate`, `encore / API`, `encore / Web`, supply-chain, and
  workflow-pins jobs are all green.

The three fixes that closed it, all validated live: (1) `--allow-unsealed` on the
seeded verify step plus the AC-2/AC-5/FR-004 amendments to tenant-tail 0.3.0
semantics (template-encore #42, OAP #519); (2) Option C, the warmup provisioning the
pinned Encore CLI and regenerating the typed client at scaffold time (factory-encore
#16); and (3) the 7th-blocker self-fix, provisioning the CLI via node `fetch` + `tar`
after a masked `curl | bash` missing-curl failure (OAP #524).

The one remaining red on the produced repo is benign and out of AC-2 scope: the
`Deploy docs to GitHub Pages` workflow (spec 016 docs-website) hard-fails a fresh
repo whose Pages site is not yet enabled ("Get Pages site failed"); it is neither the
born-with ci-gate nor the cert chain, and carries no governance or scaffold defect. A
small template follow-up (the scaffold enables Pages, or the workflow tolerates its
absence) is owed separately.

With AC-1, AC-2, AC-5, and AC-8 all demonstrated green on a real produced app, spec
220's closure gate (a real produced app emitting a certificate the spec verifier
verifies green end-to-end) is met, so `implementation` moves from `in-progress` to
`complete`. Residual hardening of the CLI download (fetch timeout, tarball cleanup,
provenance docs) lands as a follow-up (OAP #525); it is robustness, not an AC gate.
