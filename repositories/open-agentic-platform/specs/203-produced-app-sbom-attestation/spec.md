---
id: "203-produced-app-sbom-attestation"
title: "Produced-App SBOM and Dependency-Audit Attestation (ASI04 forward)"
feature_branch: "feat/203-produced-app-sbom-attestation"
status: approved
implementation: in-progress
kind: capability
domain: platform
created: "2026-06-11"
authors: ["open-agentic-platform"]
language: en
summary: >
  Apply OAP's own supply-chain discipline forward to what the factory
  produces. OAP ships per-target CycloneDX SBOMs and an aggregate release
  BOM for itself (specs 116/117), but a scaffolded application receives
  only a pinned lockfile — no SBOM, no dependency-vulnerability scan
  artifact, no lockfile-parity gate. An auditor holding a produced app's
  governance certificate (spec 168) cannot answer "what is in this
  application and was it scanned?" — the exact ASI04 question. This spec
  emits a CycloneDX BOM and a dependency-audit artifact at scaffold
  completion, binds their content hashes into the per-project governance
  certificate, and adds a lockfile/BOM parity gate to the tenant CI the
  born-with kernel (spec 167) seeds. Absence of a scanner is recorded
  visibly, never silently (the spec 200 FR-004 posture).
code_aliases: ["PRODUCED_APP_SBOM_ATTESTATION"]
compliance:
  - framework: "owasp-asi-2026"
    controls: ["ASI04"]
depends_on:
  - "167-born-with-spec-spine-kernel"
  - "168-per-project-governance-certificate"
  - "112-factory-project-lifecycle"
  - "116-supply-chain-policy-gates"
extends:
  # Same precedent as specs 196, 194, 193, 187, 183: a new spec adds a row
  # to the featuregraph golden.
  - spec: "034-featuregraph-registry-scanner-fix"
    nature: additive
    unit: { kind: file, path: crates/featuregraph/tests/golden/features_graph.json }
  # 203 adds its emitter-read round-trip test to 168's shared tenant-emission
  # integration suite, exactly as spec 220 does for its operator-key / corpus
  # tests. Additive: a new test fn, no change to 168's or 220's own cases.
  - spec: "168-per-project-governance-certificate"
    nature: additive
    unit: { kind: file, path: crates/factory-engine/tests/tenant_emission_integration.rs }
refines:
  - aspect: "kernel-sbom-vending"
    unit: { kind: file, path: crates/factory-engine/src/kernel_emission/emit.rs }
  - aspect: "sbom-artifact-binding"
    unit: { kind: file, path: crates/factory-engine/src/governance_certificate.rs }
  - aspect: "sbom-verify-path"
    unit: { kind: file, path: crates/factory-engine/src/bin/verify_certificate.rs }
  # The tenant emitter's SBOM read-path (FR-003 consumption side): the post-hoc
  # build_certificate.rs reads --sbom-dir, hashes the produced app's
  # .factory/sbom.cdx.json + audit.json, and binds them via the public
  # CertificateBuilder::sbom_artifact_binding(). Composes with spec 220 at the
  # tenant firing point; build_certificate.rs is co-claimed (220 extends it),
  # and the coupling gate is satisfied by any owner's spec.md edit.
  - aspect: "sbom-emitter-read-path"
    unit: { kind: file, path: crates/factory-engine/src/bin/build_certificate.rs }
  # NOTE: the prior `lockfile-parity-gate` aspect on tenant-ci.yml.tmpl was
  # dropped when spec 167's PR-2 retired that vendored-binary CI template. The
  # lockfile-parity gate now belongs to the npm tenant CI (the prebuilt
  # template's `spec-spine.yml`, external to OAP), so there is no in-OAP unit
  # to refine today; the aspect is owed to 203's npm-CI rewrite when it leaves
  # draft. 203's in-OAP kernel relationship is preserved via the emit.rs +
  # governance_certificate.rs refines above.
references:
  - role: context
    unit: { kind: file, path: platform/services/statecraft/api/factory/translator.ts }
  - role: context
    unit: { kind: file, path: docs/owasp-agentic-top-10-2026.md }
---

# Feature Specification: Produced-App SBOM and Dependency-Audit Attestation

**Feature Branch**: `203-produced-app-sbom-attestation`
**Created**: 2026-06-11
**Status**: Draft (follow-on filed by the ASI gap-closure pass)
**Input**: The ASI 2026 gap analysis (2026-06-10) found the most
asymmetric gap in the corpus: "OAP ships CycloneDX SBOMs for itself but
the scaffolded app gets only a pinned lockfile — no SBOM, no CVE scan
artifact, no lockfile-matches-manifest gate. The 'same discipline, applied
to ourselves' principle isn't yet applied *forward* to outputs."

## Purpose

The README's promise is that the provenance discipline applied to governed
agent execution is the discipline applied to the project's own releases.
For a factory, the claim that ultimately matters is the third leg: the
discipline applied to what it *produces*. Today the produced app's
supply-chain posture is: lockfile pinned (good), `.git` stripped (spec 112
§5.3, good), and nothing else. ASI04's mitigation 1 — provenance + SBOM,
operationalized with periodic attestation — has no produced-side artifact.

This spec makes the produced application carry its own bill of materials
and scan evidence, certificate-bound so the evidence is attested rather
than asserted.

## Functional requirements (sketch — refine before implementation)

- **FR-001 — BOM emission at scaffold completion.** The factory pipeline
  emits a CycloneDX BOM for the produced application, derived
  deterministically from the committed lockfile(s) of the scaffold output.
  Same inputs → byte-identical BOM (constitution Principle IV). The BOM is
  written into the produced tree as a tracked sidecar (location decided in
  plan.md; precedent: OAP's own `sbom-*.cdx.json` naming).
- **FR-002 — Dependency-audit artifact.** A dependency vulnerability scan
  (npm-audit/osv class; tool choice in plan.md) runs against the produced
  lockfile at scaffold time and writes a typed result artifact: tool,
  database timestamp, findings, severity counts. When no scanner or
  advisory database is available, the artifact records that absence
  explicitly with reason — a missing scan is visible evidence of a gap,
  never a silent skip.
- **FR-003 — Certificate binding.** The content hashes of the BOM and the
  audit artifact enter the per-project governance certificate's artifact
  list (spec 168). `verify-certificate` thereby detects post-hoc tampering
  with either; an auditor verifies the app's dependency evidence offline,
  without trusting the system that produced it (spec 102 FR-007 posture).
- **FR-004 — Tenant CI lockfile/BOM parity gate.** The kernel-seeded
  tenant CI gains a gate: the lockfile must satisfy the manifest, and the
  BOM must be regenerable from the lockfile to a matching hash. Drift in
  either direction fails the tenant PR with an attributable diagnostic.
- **FR-005 — Vended-tool pinning.** The BOM/audit tooling the tenant CI
  invokes is referenced through the `.kernel-version` pinned-toolchain
  mechanism (spec 167 FR-005), so the produced app's evidence chain does
  not float on whatever tool version the tenant happens to have.

## Acceptance criteria (sketch)

- **AC-1.** A fresh scaffold contains a CycloneDX BOM and an audit
  artifact; both hashes appear in the project's governance certificate and
  `verify-certificate` exits 0.
- **AC-2.** Tampering with the produced lockfile after emission fails the
  tenant CI parity gate; tampering with the BOM fails `verify-certificate`
  with a specific artifact-hash diagnostic.
- **AC-3.** Scaffolding with the scanner deliberately unavailable yields
  an audit artifact that records the absence and its reason; the
  certificate still binds it; nothing is silently skipped.
- **AC-4.** Two scaffolds from identical inputs produce byte-identical
  BOMs.

## Out of scope

- OAP's own release SBOMs (specs 116/117 own them; this spec is the
  produced-app leg only).
- Blocking policy on scan findings — what severity fails a tenant build is
  filed org policy; this spec guarantees the *evidence*, not the verdict.
- Agentic-dependency detection semantics (consumed by spec 210's
  falsifiability cross-check, which reads the BOM this spec emits).
- Container/image BOMs for deployed tenants (deployment is deployd-api
  territory; a future spec may extend attestation to images).

## Sequencing

Independent of spec 198's runtime closure. Requires spec 167's kernel
emission surface (present) and composes with spec 168's certificate; the
tenant CI gate (FR-004) lands with or after spec 209's enforcement
activation so the gate has a CI home that actually runs.

## Implementation status (2026-07-01)

**Cert-side contract delivered (Phase 1).** The factory-engine cert surface for
FR-002 (typed audit-record schema) and FR-003 (certificate binding + offline
verify) is implemented and tested:

- `SbomArtifactBinding { bomHash, auditHash, bomToolVersion }` on
  `GovernanceCertificate`, inside the content-binding hash + signature (bound at
  emission), skipped when absent so pre-1.7.0 certs stay byte-identical.
- `CertificateBuilder::sbom_artifact_binding(bom_hash, audit_hash, bom_tool_version)`,
  read-never-recompute (the spec 218 discipline: the builder is GIVEN the two
  hashes, it never regenerates the BOM).
- `verify_sbom_binding()` and the `verify-certificate --sbom-dir <dir>` flag:
  the four-outcome, fail-closed adjudication (Unbound / Verified / bom-or-audit
  mismatch / PRESENT-BUT-UNVERIFIED). Tampering with either on-disk artifact
  after emission fails verify with a named diagnostic (AC-2).
- `SbomAuditRecord` typed schema (FR-002) with the `present | absent`
  discriminated union: a missing scanner is recorded as visible evidence, never
  a silent skip (the spec 200 FR-004 posture, AC-3).
- Certificate version 1.6.0 to 1.7.0.

This unblocks spec 219's `verify-sbom` verb (its verify side extends the
certificate core rather than standing alone).

**Emitter read-path delivered (FR-003 consumption side).** The tenant emitter
(`build_certificate.rs`) now binds the produced app's SBOM + audit hashes into
the certificate it emits:

- A `--sbom-dir <root>` flag (with an `OAP_SBOM_DIR` env fallback) whose
  `resolve_sbom_binding()` reads `<root>/.factory/sbom.cdx.json` and
  `.factory/audit.json`, hashes both as bytes, lifts the BOM tool version from
  the BOM's own `metadata.tools`, and binds all three via the public
  `CertificateBuilder::sbom_artifact_binding()`. Read, never recompute: the
  emitter never regenerates the BOM. Applied only on the tenant (signer) build
  path, and fail-soft (an unreadable artifact warns and emits unbound, an
  unbound cert beating no cert), mirroring the FR-007 corpus read-path.
- `build_certificate.rs` is co-claimed with spec 220 (the tenant firing point
  where a run's SBOM (203) and corpus attestation (220 FR-007) compose into one
  certificate); the new `sbom-emitter-read-path` refines edge records 203's
  claim.
- An integration test (`sbom_binding_round_trips_fr003`) emits a bound
  certificate and round-trips it through `verify-certificate --sbom-dir`:
  matching artifacts verify, a tampered BOM fails (AC-2).

So the whole factory-engine cert surface for spec 203 (bind + verify + emit-side
read) is now in-tree. Only the BOM/audit **generation** and the tenant-CI gate
remain, and both are external (see below).

**Emission leg (FR-001 + BOM/audit generation) remains.** Generating
`.factory/sbom.cdx.json` and `.factory/audit.json` at scaffold completion is a
separate leg. A code trace resolved the plan's open question F2: the Rust
`emit_kernel` / `emit_project_kernel` surface the plan's `kernel-sbom-vending`
edge points at is **unwired in production** (spec 167 §2.4/§7 leaves it unwired
to avoid a double-emit; only tests call it). The production born-with emission,
and the only point at which a committed `package-lock.json` provably exists in
the produced tree, is statecraft's TypeScript scaffold path
(`platform/services/statecraft/api/projects/scaffold/perRequestScaffold.ts`),
which runs at project creation before any s0-s6 factory stage. Within the Rust
pipeline the earliest lockfile-bearing stage is `s6a-scaffold-init`
(post-`npm install`); the terminal scaffold stage is `s6h-final-validation`.
The emission leg therefore lands in the platform / tenant-CI layer, not
factory-engine; the `kernel-sbom-vending` edge is reconciled to the real hook
site when that leg is implemented (plan F3). This mirrors the corpus-binding
split (spec 218): factory-engine reads and binds artifacts it is given, an
upstream step generates them.

**Generation home (decided): the tenant CI, not the statecraft scaffold.** A
second trace weighed the two candidate hooks. The statecraft scaffold
(`perRequestScaffold.ts`) is the earliest point a committed lockfile exists, but
running `@cyclonedx/cyclonedx-npm` there means a network-fetching tool executing
inside the scaffold pod's `readOnlyRootFilesystem` posture (the tool is not a
statecraft dependency and would fetch on demand into a writable cache), a real
risk to production project creation. The tenant CI (the prebuilt template's
external `spec-spine.yml`, where spec 209's `verify-certificate` step and this
spec's FR-004 parity gate already live) has network and a writable filesystem,
and lets generation, the emitter firing (spec 220 FR-002), and verification
compose in one run. Generation is therefore specified in the tenant CI: the
first run generates and commits `.factory/sbom.cdx.json` + `.factory/audit.json`
(pinned `@cyclonedx/cyclonedx-npm` + `npm audit`), the emitter binds them via
`--sbom-dir` (now in-tree), and the FR-004 gate keeps the committed BOM
regenerable. This leg is external to OAP (template-encore), like FR-004 and spec
220 FR-002.

## Gate contract (FR-004)

The tenant CI lockfile/BOM parity gate is EXTERNAL to OAP (it lives in the npm
tenant CI, the prebuilt template's `spec-spine.yml`) and is sequenced with or
after spec 209's enforcement activation, which is now merged. Its contract,
which the external CI author implements against:

1. **Regenerable-BOM invariant.** The gate runs
   `npx --no-install @cyclonedx/cyclonedx-npm --output-format JSON --reproducible`
   against the committed lockfile and asserts the SHA-256 of the output equals
   the SHA-256 of the committed `.factory/sbom.cdx.json`. Same lockfile plus
   same pinned tool version yields a byte-identical BOM (constitution Principle
   IV, AC-4).
2. **Lockfile-satisfies-manifest.** `npm ci` (or an `npm install
   --package-lock-only` dry-run) must not mutate the lockfile: a lockfile that
   does not satisfy `package.json` fails the gate.
3. **Attributable failure.** Drift in either direction fails the tenant PR with
   a named diagnostic identifying which artifact drifted (lockfile vs BOM), so
   the tenant can attribute and fix it.

The BOM tool version the gate pins is the version recorded in the certificate's
`sbomArtifactBinding.bomToolVersion`, so the CI check and the cert agree on what
produced the evidence.

### CI-author note: committed-sidecar reframe (2026-07-01)

The external CI author (template-encore `spec-spine.yml`) implemented point 1
as **deterministic regeneration** rather than a mandatory committed sidecar. A
code trace surfaced a conflict with the "first run generates and commits" model:
the scaffold sets branch protection (required PR reviews) on the produced repo
(statecraft `configureBranchProtection`), so the CI cannot push a commit-back of
`.factory/sbom.cdx.json` to the default branch. The gate therefore:

1. regenerates the BOM twice per run and asserts the two are byte-identical
   (proving regenerability from the lockfile + pinned tool, AC-4), and
2. keeps the committed-sidecar drift check as an **opt-in**: if a tenant commits
   `.factory/sbom.cdx.json`, the gate additionally asserts the regenerated BOM
   matches the committed one (the literal point-1 comparison).

The durable, tamper-evident BOM record is the hash bound into the per-run
certificate (`sbomArtifactBinding.bomHash`, verified offline by
`verify-certificate --sbom-dir`), which does not depend on committing the sidecar
to a protected branch. Point 2 (lockfile-satisfies-manifest) is enforced by the
`npm ci` step, which refuses a lockfile that does not satisfy `package.json`.

## Residuals

- **R-1 (deferred): `.kernel-version` BOM-tool pin field.** The BOM tool version
  is recorded in `SbomArtifactBinding.bomToolVersion` inside the cert, which is
  sufficient for AC-1..AC-4. Whether it should ALSO appear as a dedicated field
  in `KernelVersion` / `CertificateToolchainRef` (for kernel-update propagation)
  is deferred; the cert binding already makes the version used at scaffold time
  visible and tamper-evident.
