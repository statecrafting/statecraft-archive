---
id: "168-per-project-governance-certificate"
slug: per-project-governance-certificate
title: "Per-project governance certificate emission and tenant-side verifier"
status: approved
implementation: complete
owner: bart
created: "2026-05-22"
amended: "2026-06-20"
amendment_record: |
  amended by spec 178 (2026-05-24): mechanical regeneration of
  crates/featuregraph/tests/golden/features_graph.json reflecting the
  product/apps/desktop/* → product/apps/opc/* path rename in spec
  frontmatter. No semantic change to this spec's claims; fixture content
  updated 1:1 with the rename per the atomicity contract encoded by spec
  177. The body "Amendments received" section carries the authoritative
  dated callout.
  amended by spec 167 (2026-06-11), editorial cross-reference: §2.2/§2.3's
  references to "spec 167's FR-005 decision" and to refreshing tenant
  binaries now resolve to the pinned-toolchain (npm devDependency) mode —
  spec 167's vendored tools/spec-spine/ binary arm was retired in its
  2026-06-11 self-amendment. No change to spec 168's certificate emission
  or verifier contract; the verifier still ships with the kernel, now via
  the pinned spec-spine distribution rather than loose vendored binaries.
  amended by spec 167 (2026-06-12), PR-2 retirement touch: 168's extends
  edges on kernel_emission/{templates.rs,emit.rs} and
  tests/kernel_emission_integration.rs were edited when 167's PR-2 retired the
  vendored-binary CI workflow template + the scaffold-claim generator. 168's
  establishes target templates/kernel/toolchain.yaml.tmpl is UNCHANGED and the
  certificate_toolchain emission contract (FR-001/FR-008) is intact — the
  fallback emit_kernel still writes .factory/toolchain.yaml with the
  emitter/verifier pin. Editorial-on-168; the change is 167's.
  amended by spec 220 (2026-06-20), clarification: 168 FR-001/FR-002 (a tenant
  ships and fires the emitter, automatic at run completion) were
  capability-complete in-engine under 168 (the tenant-mode emitter requiring an
  attributable signer, the post-hoc build-certificate path from a run directory,
  and tests/tenant_emission_integration.rs all landed here), but the
  tenant-facing DELIVERY was not: spec 219 vended only the verify-only half
  (tenant-tail) and spec 209 FR-003 deferred the emitter, its firing, and the
  tenant signer identity. Spec 220 is that delivery. No change to 168's
  certificate format or verifier contract; this clarifies that 168's
  "implementation: complete" was capability-level and the tenant emit leg lands
  in spec 220. The body "Amendments received" section carries the dated callout.
kind: capability
domain: platform
risk: medium
depends_on:
  - "075-factory-workflow-engine"  # factory-workflow-engine
  - "102-governed-excellence"  # governed-excellence (the certificate substrate spec 168 extends)
  - "167-born-with-spec-spine-kernel"  # born-with kernel emission (tenants inherit the emission discipline)
code_aliases: ["TENANT_GOVERNANCE_CERTIFICATE", "PER_PROJECT_CERT_EMISSION"]
establishes:
  - unit: { kind: file, path: crates/factory-engine/tests/tenant_emission_integration.rs }
  - unit: { kind: file, path: crates/factory-engine/templates/kernel/toolchain.yaml.tmpl }
extends:
  - spec: "102-governed-excellence"
    nature: additive
    unit: { kind: file, path: crates/factory-engine/src/governance_certificate.rs }
  - spec: "102-governed-excellence"
    nature: additive
    unit: { kind: file, path: crates/factory-engine/src/lib.rs }
  - spec: "102-governed-excellence"
    nature: additive
    unit: { kind: file, path: crates/factory-engine/src/bin/build_certificate.rs }
  - spec: "102-governed-excellence"
    nature: additive
    unit: { kind: file, path: crates/factory-engine/src/bin/factory_run.rs }
  - spec: "167-born-with-spec-spine-kernel"
    nature: additive
    unit: { kind: file, path: crates/factory-engine/src/kernel_emission/mod.rs }
  - spec: "167-born-with-spec-spine-kernel"
    nature: additive
    unit: { kind: file, path: crates/factory-engine/src/kernel_emission/version.rs }
  - spec: "167-born-with-spec-spine-kernel"
    nature: additive
    unit: { kind: file, path: crates/factory-engine/src/kernel_emission/emit.rs }
  - spec: "167-born-with-spec-spine-kernel"
    nature: additive
    unit: { kind: file, path: crates/factory-engine/src/kernel_emission/templates.rs }
  - spec: "167-born-with-spec-spine-kernel"
    nature: additive
    unit: { kind: file, path: crates/factory-engine/tests/kernel_emission_integration.rs }
  - spec: "034-featuregraph-registry-scanner-fix"
    nature: additive
    unit: { kind: file, path: crates/featuregraph/tests/golden/features_graph.json }
references:
  - role: decomposition-source
    unit: { kind: file, path: docs/owasp/factory/AIDE-VELOCITY-OAP-INTENT.md }
  - role: substrate-spec
    unit: { kind: file, path: specs/102-governed-excellence/spec.md }
  - role: kernel-channel
    unit: { kind: file, path: specs/167-born-with-spec-spine-kernel/spec.md }
compliance:
  - framework: owasp-asi-2026
    controls: ["ASI04", "ASI09"]
summary: >
  Spec 102 emits `governance-certificate.json` per OAP
  factory run, binding requirements hash, frozen Build
  Spec hash, per-stage artifact hashes, and a self-
  authenticating SHA-256 over the canonical JSON. The
  companion verifier (`make verify-certificate`) does
  not trust the system that produced the certificate
  (FR-007 of spec 102).

  Today this discipline applies to OAP's *own* factory
  runs. Tenant projects produced by the substrate run
  their *own* factory pipelines (e.g., re-running an
  adapter to refresh a scaffold, or running a tenant-
  side codegen stage), and those runs need the same
  independently-verifiable governance chain. Without it,
  the trust chain breaks at the tenant boundary — an
  auditor verifying a tenant's pipeline runs has no
  cryptographic ground truth, only the tenant's own
  log narratives.

  Spec 168 extends spec 102 with a *tenant-emit* mode:
  the same certificate format, the same verifier, the
  same FR-007 posture (verifier does not trust the
  producer), now applied to tenant pipelines. Born-with
  tenants inherit emission via the spec 167 kernel;
  retrofit tenants opt in via the same pattern when
  the decomposition pipeline (spec 165) graduates
  their first specs.
---

# 168 — Per-project governance certificate emission

## 1. Problem

Spec 102 (`governed-excellence`) is OAP's load-bearing
ASI09 / ASI10 mitigation: every factory run emits a
self-authenticating `governance-certificate.json` that
binds requirements hash, Build Spec hash, per-stage
artifact hashes, and a SHA-256 over the canonical JSON.
`make verify-certificate` is the auditor's verifier and
does not trust the producer (FR-007).

This discipline applies to **OAP's own factory runs**.
The intent doc §7.4 names the gap:

> *"Every project the substrate produces or governs must
> inherit this emission discipline. Per §6.4, when OPC
> drives a factory run against a project, the project
> itself emits its own governance certificate under its
> `.factory/runs/<run-id>/` directory."*

The gap is concrete:

1. A born-with tenant produced via spec 167's kernel
   does not today emit a governance certificate when its
   own factory-engine runs (e.g., to refresh scaffolded
   code after a tenant-side spec edit).
2. An auditor inspecting a tenant project's compliance
   posture cannot verify cryptographically what the
   tenant's pipeline did — they have the tenant's
   narrative output (logs, build artifacts) but no
   self-authenticating evidence chain.
3. The substrate's auditor (verifying OAP) gets a
   complete chain for OAP itself, but the chain
   terminates at the tenant boundary. Tenant runs are a
   blind spot.

Closing the gap requires the tenant to ship the same
emission machinery: the certificate format, the
canonical-JSON serialisation, the SHA-256 anchor, and a
sibling verifier binary.

## 2. Decision

Extend spec 102 with a *tenant-emit* mode. The format
is unchanged; the producer is the tenant pipeline; the
verifier is shipped alongside the emitter so the
tenant's auditor can verify without trusting the
tenant's pipeline.

### 2.1 Tenant-emit semantics

When a tenant project's factory-engine (or equivalent
pipeline runner) completes a run, the runner writes
`<project>/.factory/runs/<run-id>/governance-certificate.json`
following the spec 102 format:

- `requirements_hash`: hash of the project's frozen
  requirements (the spec subset that drove this run).
- `build_spec_hash`: hash of the frozen Build Spec the
  pipeline executed.
- `stages[]`: per-stage entry with input/output
  artifact hashes.
- `signer`: per spec 102 FR-007 — identity of the
  agent (or human) that drove the run, attributable.
- `self_hash`: SHA-256 over the canonical JSON of the
  above.

The format is identical to spec 102's. The semantics
are identical (the chain is independently verifiable;
the auditor does not trust the producer). The only
difference is the producer's identity — a tenant
pipeline, not OAP's.

### 2.2 Verifier distribution

The tenant project ships a `verify-certificate` binary
alongside the emitter (or references a pinned-toolchain
version of it per spec 167's FR-005 decision). The
verifier:

- Reads the certificate file.
- Recomputes hashes against the artifact files at
  declared paths.
- Verifies the `self_hash` against canonical-JSON
  serialisation of the rest of the certificate.
- Exits 0 on clean; exits 1 on any mismatch with a
  specific diagnostic.

The verifier does *not* call out to OAP, a remote
service, or any network endpoint to validate. The
chain is verifiable from the tenant's working tree
alone.

### 2.3 Continuity with spec 167

Born-with tenants ship the emitter and verifier as
part of the spec 167 kernel emission. The kernel's
`.kernel-version` records which version of the
emitter/verifier the tenant carries; future kernel-
update propagation may refresh these binaries.

Retrofit tenants (spec 165 path) opt in to the
emitter when their first set of decomposition-pipeline
specs gets promoted. The retrofit promotion includes
installing the emitter/verifier on the same channel.

### 2.4 Stage shape for tenant runs

A tenant pipeline's stages may differ from OAP's
factory stages (the tenant's adapter has its own
stage grammar). Spec 168 does not require the
tenant's stage shape to match OAP's; it only requires
the stages to be representable as
`{stage_id, input_hashes, output_hashes,
runtime_metadata}` records. The certificate format is
flexible enough to accept the tenant's stage grammar.

## 3. Functional Requirements

- **FR-001** A tenant project produced via spec 167
  ships with both an emitter and a verifier (binaries
  or pinned-toolchain references per FR-005 of spec
  167).
- **FR-002** When the tenant's pipeline completes a
  run, the emitter writes
  `<project>/.factory/runs/<run-id>/governance-certificate.json`
  following spec 102's format. Emission is automatic
  at run completion (success or halt), not opt-in.
- **FR-003** The emitted certificate carries the same
  field shape as OAP's: requirements_hash,
  build_spec_hash, stages, signer, self_hash.
- **FR-004** The verifier binary, run against a
  produced certificate, exits 0 on clean. Exit-1
  diagnostics name the specific mismatching field
  (artifact hash, build_spec_hash, self_hash) per
  spec 102's diagnostic contract.
- **FR-005** The verifier is offline-capable: it
  reads only the certificate file and the artifact
  files at declared paths. No network calls.
- **FR-006** Tampering with any artifact file referenced
  by the certificate causes the verifier to exit 1
  with a specific artifact-hash-mismatch diagnostic.
- **FR-007** The signer field uses the tenant's
  identity model (whatever is configured — typically a
  Rauthy-issued JWT subject for human-driven runs,
  per spec 106 / 137). Anonymous signing is not
  permitted; a run with no identifiable signer halts
  before emitting.
- **FR-008** A retrofit tenant (spec 165 path) gains
  emitter/verifier installation as part of the
  decomposition pipeline's promotion step. The
  installation is recorded in the tenant's
  `.kernel-version` file.
- **FR-009** Re-running the tenant pipeline with the
  same inputs produces a certificate whose hashes are
  identical (deterministic emission, modulo the
  signer field which may carry per-run identity).

## 4. Success Criteria

- **SC-001** A born-with tenant's factory-engine run
  writes a `governance-certificate.json` under
  `<project>/.factory/runs/<run-id>/` automatically at
  completion.
- **SC-002** Running the tenant's `verify-certificate`
  binary against the certificate exits 0 (clean).
- **SC-003** Modifying any artifact file referenced by
  the certificate (or any field in the certificate
  itself) causes `verify-certificate` to exit 1 with
  a specific diagnostic.
- **SC-004** An auditor verifying tenant compliance
  can do so offline using only the tenant's working
  tree and the verifier binary; no network access to
  OAP or to the tenant's CI is required.
- **SC-005** A tenant pipeline that cannot identify a
  signer (e.g., misconfigured identity) halts before
  emission rather than producing a certificate with a
  null signer.

## 5. Scope

### In scope

- Tenant-side emitter and verifier distribution
  (binary or pinned-toolchain).
- The emission integration point in the tenant's
  pipeline runner.
- The stage-shape flexibility for tenant-specific
  pipeline grammars.
- The signer-identity binding to the tenant's
  identity model.

### Out of scope (deferred)

- **Tenant-to-OAP certificate uplink.** Aggregating
  tenant certificates into a portfolio-level audit
  view at the substrate is a separate concern. The
  certificate is self-authenticating; the
  *aggregation* (portfolio dashboard, cross-tenant
  attestation) is its own spec.
- **Long-term certificate retention policy.** Spec
  168 emits certificates per run; how long the tenant
  retains them is an operational decision, not part
  of the emission contract.
- **Cross-tenant certificate comparison.** Even with
  identical adapter + input set, two tenants'
  certificates differ at signer (per-tenant identity).
  Cross-tenant comparison logic is not part of this
  spec.
- **Schema evolution policy.** When spec 102's
  certificate format evolves, born-earlier tenants
  carry an older schema. Compatibility is owned by the
  kernel-update-propagation spec deferred from spec
  167.

## 6. Compliance

This spec is the tenant-side load-bearing piece of
**ASI04 (Agentic Supply Chain)**: a tenant's pipeline
produces verifiable provenance for every artifact it
emits. Combined with spec 116 (supply-chain policy
gates) inherited via the kernel and spec 117 (release
artifact attestations), the tenant's compliance chain
is structurally as strong as OAP's.

It is also the tenant-side **ASI09 (Human-Agent Trust
Exploitation)** mitigation: an auditor inspecting the
tenant does not depend on the tenant's narrative; they
verify cryptographically. The trust chain extends to
the tenant boundary without breaking.

## 7. Cross-references

- **INTENT doc** §6.4, §7.4, §9.9.
- **Spec 102** — governed-excellence; spec 168 extends
  with tenant-emit mode.
- **Spec 167** — born-with kernel; ships the emitter
  and verifier as part of the kernel.
- **Spec 165** — decomposition pipeline; retrofit
  channel installs the emitter/verifier at promotion
  time.
- **Spec 075** — factory-workflow-engine; the producer
  whose runs emit certificates.
- **Spec 116 / 117** — supply chain policy gates +
  release attestations; complementary discipline at
  ingest / release tiers.


## Amendments received

**Amendment 2026-05-24 (record: 178-opc-directory-rename).**
Spec 178 (opc-directory-rename, 2026-05-24): mechanical regeneration
of `crates/featuregraph/tests/golden/features_graph.json` reflecting
the `product/apps/desktop/*` → `product/apps/opc/*` path rename in
spec frontmatter. No semantic change to this spec's claims; fixture
content updated 1:1 with the rename per the atomicity contract
encoded by spec 177 (ci-orchestrator-pr-gate) — featuregraph-golden
is a required ci-gate check precisely so renames carry their fixture
refresh inside the rename PR.

**Amendment 2026-06-11 (record: 167-born-with-spec-spine-kernel), editorial.**
Spec 167's 2026-06-11 self-amendment retired its vendored
`tools/spec-spine/` binary distribution arm in favour of the published
`spec-spine` npm distribution shape (a pinned devDependency carrying the
prebuilt CLI). This spec's §2.2/§2.3 reference "spec 167's FR-005
decision" and the refresh of tenant binaries; those references now
resolve to the single `pinned-toolchain` mode. No change to spec 168's
certificate emission, verifier contract, or its `establishes:`/`extends:`
graph — the emitter and verifier still ship with the kernel, now obtained
through the pinned spec-spine distribution rather than loose vendored
binaries. Editorial cross-reference only.

**Amendment 2026-06-20 (record: 220-tenant-emit-governance-certificate), clarification.**
Spec 168's FR-001/FR-002 assert that a produced app ships and fires the
certificate emitter, automatic at run completion. That capability landed in 168
in-engine: the tenant-mode emitter requiring an attributable signer (the `Signer`
constructor rejects an empty subject, FR-007), the post-hoc `build-certificate`
path that reconstructs a certificate from a finished run directory, and the
`tests/tenant_emission_integration.rs` integration test. The tenant-facing
delivery did not land here: spec 219 vended only the verify-only half (tenant-tail,
verify-only by construction) and spec 209 FR-003 deferred the emitter, its firing,
and the tenant signer identity to a separate emit spec. Spec 220
(`tenant-emit-governance-certificate`) is that emit spec. This is a clarification,
not a supersession: 168's certificate format and verifier contract are unchanged.
Read 168's `implementation: complete` as capability-complete in-engine; the tenant
boundary is crossed (the emitter delivered, fired, and key-custodied) by spec 220.
