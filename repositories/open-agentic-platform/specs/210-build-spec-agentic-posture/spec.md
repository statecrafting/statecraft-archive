---
id: "210-build-spec-agentic-posture"
title: "Build Spec Agentic-Posture Declaration (Least Agency for produced apps)"
feature_branch: "feat/210-build-spec-agentic-posture"
status: approved
implementation: complete
kind: governance
domain: platform
created: "2026-06-11"
authors: ["open-agentic-platform"]
language: en
summary: >
  Make the produced application's agentic surface a declared,
  falsifiable contract fact. Produced apps are conventional web
  applications today, but nothing STATES that: the Build Spec is silent
  on whether the application embeds model calls, tools, or agent loops,
  so a tenant that later adds an LLM SDK acquires an ungoverned agentic
  surface while still carrying OAP's governance certificate, and the
  certificate then implies a coverage it does not have. This spec adds
  an open-standard Build Spec field, agentic_posture: none | declared |
  governed, binds it into the governance certificate, and makes it
  falsifiable by cross-checking the declaration against the produced
  app's SBOM (spec 203): posture "none" with a known agent/LLM SDK in
  the dependency tree fails verification with an attributable
  diagnostic. "Declared" requires the agentic surfaces to be enumerated;
  "governed" requires each surface to carry a governance envelope
  (the spec 198 schema, reused at application level), bridging the
  spec 198 contract from the factory run to the thing the factory built.
  This is cross-cutting principle 1 (Least Agency) applied to outputs:
  autonomy is a deliberate, stated choice, never a silent acquisition.
code_aliases: ["BUILD_SPEC_AGENTIC_POSTURE"]
compliance:
  - framework: "owasp-asi-2026"
    controls: ["ASI02", "ASI10"]
depends_on:
  - "197-factory-contract-open-standard-extensions"
  - "198-factory-governance-envelope"
  - "203-produced-app-sbom-attestation"
  - "168-per-project-governance-certificate"
extends:
  - spec: "197-factory-contract-open-standard-extensions"
    nature: additive
    unit: { kind: file, path: standards/schemas/factory/build-spec.schema.yaml }
  # The Rust twin of the Build Spec contract gains the same additive field +
  # type (spec 197's open-standard discipline: minor bump, absent field
  # defaults).
  - spec: "197-factory-contract-open-standard-extensions"
    nature: additive
    unit: { kind: file, path: crates/factory-contracts/src/build_spec.rs }
  # Same precedent as specs 196, 194, 193, 187, 183, 203: a new spec adds a row
  # to the featuregraph golden (here: 210's own draft->approved status flip).
  - spec: "034-featuregraph-registry-scanner-fix"
    nature: additive
    unit: { kind: file, path: crates/featuregraph/tests/golden/features_graph.json }
establishes:
  # The agent/LLM SDK watchlist: data, versioned with the standard (FR-003).
  # A new file this spec brings into existence; embedded into the verifier via
  # include_str! so the binary stays self-contained and deterministic.
  - unit: { kind: file, path: standards/schemas/factory/agentic-sdk-watchlist.yaml }
refines:
  # FR-002: the posture binding block on the certificate.
  - aspect: "agentic-posture-certificate-binding"
    unit: { kind: file, path: crates/factory-engine/src/governance_certificate.rs }
  # FR-002: the emitter reads the posture off the frozen Build Spec and binds it
  # (mirrors 203's sbom-emitter-read-path aspect on the same file).
  - aspect: "agentic-posture-emitter-read-path"
    unit: { kind: file, path: crates/factory-engine/src/bin/build_certificate.rs }
  # FR-003: the SBOM cross-check + posture adjudication in the verify bin
  # (mirrors 203's sbom-verify-path aspect on the same file).
  - aspect: "agentic-posture-verify-path"
    unit: { kind: file, path: crates/factory-engine/src/bin/verify_certificate.rs }
references:
  - role: gate-declaration
    unit: { kind: file, path: standards/schemas/factory/governance-envelope.schema.yaml }
  - role: context
    unit: { kind: file, path: docs/owasp-agentic-top-10-2026.md }
---

# Feature Specification: Build Spec Agentic-Posture Declaration

**Feature Branch**: `feat/210-build-spec-agentic-posture`
**Created**: 2026-06-11
**Refined**: 2026-07-08 (sketch to implementation-ready)
**Completed**: 2026-07-08 (live AC-2 evidence on a real produced app; see Implementation status)
**Status**: Approved (complete)
**Input**: Spec 198's out-of-scope section assigns the produced app's
own ASI posture to "its Build Spec + governance certificate, not the
factory-run envelope" and defers Build Spec field changes to "spec 197 /
future contract specs". This is that future contract spec. The ASI 2026
gap analysis (2026-06-10) framed the hole: "if a tenant embeds agents
later, nothing is inherited and the certificate is silent."

## Purpose

The ASI Top 10's first cross-cutting principle is Least Agency: do not
deploy autonomy where it is not needed, and, by extension, never
acquire it without deciding to. OAP enforces a great deal about how the
factory *run* behaves and currently nothing about whether the *product*
is itself an agentic application. The silence has a concrete failure
mode: OAP's governance certificate travels with the produced app as its
trust artifact, and an auditor reading it today cannot distinguish "this
application has no agentic surface" from "nobody asked."

A declaration field fixes the semantics only if it is falsifiable,
otherwise it is paperwork. The falsifiability comes from evidence OAP
already holds: the produced app's SBOM (spec 203, landed). A dependency
on a known model-SDK family is not proof of an agent loop, but it is
exactly the tripwire that forces the declaration to be revisited: the
cross-check turns "posture: none" from an assertion into a verified
claim with a named contradiction when it breaks.

## Model

The posture is a single top-level Build Spec object:

```yaml
agentic_posture:
  posture: none | declared | governed        # required when the object is present
  surfaces:                                    # required non-empty for declared/governed
    - kind: model-api | tool-surface | memory-persistence | human-approval-point
      description: string                      # human elaboration
      governance_envelope:                     # required for every surface under `governed`
        <a spec-198 governance-envelope object, validated for shape>
```

- **`none`**: the application embeds no model calls, agent loops, tool
  surfaces, or persistent agent memory. `surfaces` must be empty.
- **`declared`**: agentic surfaces exist and are enumerated (`surfaces`
  non-empty). Each surface names what it is (`kind`) and describes it.
- **`governed`**: declared, plus every surface carries an inline
  `governance_envelope` conforming (in shape) to the spec 198
  governance-envelope schema, the same contract grammar OAP itself is
  governed by, reused at application level.

**Absent field means `none`, recorded as defaulted.** A pre-existing
Build Spec with no `agentic_posture` block is treated as `none`, but the
certificate binding records `defaulted: true` so an auditor can tell
"authored none" (someone decided) from "defaulted none" (nobody asked).
This distinction is the whole point of the Purpose section and is a hard
requirement of the binding, not cosmetic.

## Functional requirements

- **FR-001 (Schema field).** `build-spec.schema.yaml` gains the
  top-level `agentic_posture` object above as an additive, open-standard
  extension following spec 197's versioning discipline (minor bump
  1.1.0 to 1.2.0). The Rust twin `factory-contracts/src/build_spec.rs`
  gains the matching `Option<AgenticPosture>` field (absent means `None`,
  resolved to defaulted `none` at binding time) plus the
  `AgenticPosture`, `PostureLevel`, `AgenticSurface`, and `SurfaceKind`
  types. A well-formedness method (`AgenticPosture::validate`) enforces:
  `none` implies empty surfaces; `declared`/`governed` imply non-empty
  surfaces; `governed` implies every surface carries a
  `governance_envelope` that deserializes as a
  `factory_contracts::GovernanceEnvelope` (shape). The version-pin tests
  in `build_spec.rs` track the bump.
- **FR-002 (Certificate binding).** A new optional top-level
  `agenticPostureBinding` block is added to the governance certificate
  (`{ posture, defaulted, surfaces }`), inside the hash + signature
  (bound at emission), `skip_serializing_if` absent so pre-existing certs
  stay byte-identical. `CERTIFICATE_VERSION` bumps 1.8.0 to 1.9.0. The
  binding mirrors the corpus/SBOM/budget precedent exactly: a
  `CertificateBuilder::agentic_posture_binding` method, and an emitter
  read-path (`build_certificate.rs`) that reads the posture off the
  frozen Build Spec at `<run-dir>/s5-ui-specification/build-spec.yaml`
  and binds it on the tenant (signer) path. Absent Build Spec or absent
  field yields a `none`/`defaulted` binding. Read, never recompute.
- **FR-003 (Falsifiability cross-check).** Enforcement splits by whether
  the on-disk SBOM is needed:
  - **Internal consistency** (no SBOM needed, in `verify_certificate`,
    like the spec 202 budget check): a bound `declared`/`governed`
    posture with empty surfaces fails; a bound `none` with non-empty
    surfaces fails; a `governed` surface with no governance envelope
    fails. Bound at emission, so raw byte tamper is already caught by the
    signature check; these reject a validly-signed but self-inconsistent
    binding.
  - **SBOM cross-check** (needs `--sbom-dir`, in the verify bin alongside
    `verify_sbom_binding`): the produced app's CycloneDX BOM
    (`.factory/sbom.cdx.json`) `components[]` are matched against the
    agent/LLM SDK **watchlist**. A bound (or defaulted) `none` posture
    with a watchlist match fails with a diagnostic naming the package and
    the contradicted declaration. `declared`/`governed` do not fail on a
    match (agency was declared). The watchlist is data
    (`standards/schemas/factory/agentic-sdk-watchlist.yaml`), versioned
    with the standard, embedded into the verifier via `include_str!`. A
    **watchlist miss is a stated residual**: absence of a match is not
    proof of absence of agency, and the verifier says so (a notice, not a
    silent pass).
- **FR-004 (Governed-posture bridge).** For `governed`, each surface's
  inline `governance_envelope` is validated against the spec 198 schema
  by shape (it must deserialize as a `factory_contracts::GovernanceEnvelope`
  with a recognised `schema_version`). Shape validation only: runtime
  admission of the app's own agents is the tenant's deployment concern
  and explicitly out of scope. The bridge gives a tenant that chooses
  agency the same contract grammar OAP itself is governed by:
  inheritance by standard, not by fork. The envelope is carried inline
  (not by external path) so the certificate is self-describing and
  verification is self-contained (no produced-app tree needed at verify
  time to adjudicate the governed bridge).

## Acceptance criteria

- **AC-1.** Build Spec schema bump parses both pre-existing specs
  (absent field means defaulted `none`) and authored postures; the Rust
  twin's version-pin + round-trip tests are green; the
  `factory-schema-lockstep` floor gate (spec 212) accepts the additive
  field once the upstream `factory` contract mirrors it (see Sequencing,
  the cross-repo leg).

  > **Refinement note (2026-07-08).** The original AC-1 read
  > "schema-parity (125/191) green across the Rust/TS twins." Ground
  > truth at refinement time: the Build Spec has **no** TS twin (the
  > desktop consumer types the parsed spec as `any`), and `build_spec.rs`
  > is **not** one of the three pairs the schema-parity-check walker
  > (specs 125/191) covers (knowledge / provenance / stakeholder_docs).
  > The Build Spec contract's real cross-surface parity is enforced by
  > (a) the Rust struct's own deserialization + version-pin + semantic
  > tests and (b) the cross-*repo* `factory-schema-lockstep` gate
  > (spec 212, which does cover `build-spec.schema.yaml` in Floor mode).
  > Inventing a TS twin for the Build Spec is out of scope for this
  > contract spec (no consumer exists to keep in parity). AC-1 is amended
  > to the mechanisms that exist rather than backfilled to a twin that
  > does not: the pre-implementation-amendment discipline.
- **AC-2.** The certificate emitted from a run whose frozen Build Spec
  declares a posture records that posture (`agenticPostureBinding`);
  tampering the bound posture fails `verify-certificate` (signature +
  hash). A run whose Build Spec omits the field yields a
  `none`/`defaulted: true` binding, visibly defaulted, never silently
  equivalent to authored `none`.
- **AC-3.** Fixture: a produced app declaring `none` (or defaulting to
  it) with an `@anthropic-ai/sdk`-class dependency in its
  `.factory/sbom.cdx.json` fails the cross-check, the diagnostic naming
  the package and the contradicted declaration; removing the dependency,
  or moving the declaration to `declared`, passes.
- **AC-4.** Fixture: a `governed` posture with a surface whose inline
  governance envelope is missing or non-conformant fails (internal
  consistency / shape); a `governed` posture whose surfaces each carry a
  conformant envelope passes shape validation.

## Out of scope

- Runtime governance of the produced app's agents (the tenant's
  deployment owns admission/enforcement; OAP provides the contract
  grammar, spec 198 the schema).
- The SBOM emission itself (spec 203, landed).
- A TS twin for the Build Spec / wiring `build_spec.rs` into the
  schema-parity-check walker (no consumer exists; see AC-1 refinement
  note).
- An agentic starter kit / scaffolding for governed agent surfaces in
  produced apps: a worthwhile future adapter concern, deliberately not
  smuggled into a contract spec.
- Build Spec fields beyond `agentic_posture` (spec 197 and future
  contract specs own their own extensions).

## Sequencing

After spec 203 (landed: the cross-check needs the SBOM to exist) and
following spec 197's open-standard change discipline. FR-001 through
FR-004 land together in one OAP-side PR (the certificate binding reads
the posture from the Build Spec, so the field and the binding are
inseparable; the cross-check and bridge complete the falsifiability the
field promises).

**Cross-repo leg (merge dependency).** Adding `agentic_posture` to OAP's
`build-spec.schema.yaml`, a Floor-mode file in the spec 212
`factory-schema-lockstep` set, makes OAP carry a top-level key the
upstream `factory` contract lacks, which the Floor rule reports as
"present in OAP only (floor: factory must mirror it)". This gate is
fail-visible by design (spec 212 FR-003 / AC-6: never skipped-green), so
the OAP PR cannot merge until the upstream `factory` contract mirrors the
field and spec 212's `pinned_ref` is bumped to a commit that includes it.
This leg is a known, anticipated part of this spec (it was recorded when
210 was filed) and is tracked as the single external blocker on merge; it
does not change the OAP-side diff.

## ASI mapping

- **ASI02 (Autonomy)**: Least Agency applied to outputs. The produced
  app's autonomy is a declared, bounded fact, not a silent acquisition.
- **ASI10 (Governance)**: the certificate, the app's trust artifact,
  states the app's agentic surface explicitly and falsifiably, and the
  `governed` bridge inherits OAP's own envelope grammar.

## Implementation status

**2026-07-08: complete. FR-001 through FR-004 landed, and AC-2 is
satisfied verbatim on a real produced app.** The OAP-side diff (the
schema field + Rust twin, the certificate binding, the emitter read-path,
and the SBOM cross-check verifier) landed in #543; the cross-repo merge
leg (Sequencing) cleared when the upstream `factory` contract mirrored
the field, `template-encore` main `e94395b` (#46) pinned the born-with
tools to `tenant-emit 0.3.0` / `tenant-tail 0.4.0` and authored
`agentic_posture: none` into the born-with cert step, and the
`spec-spine` CLI pin moved to 0.10.0 (#544) so the `factory-schema-lockstep`
floor gate (spec 212) accepts the additive key.

**Live AC-2 evidence.** A `Single`-internal produced app,
`statecrafting/spec210-ac2-single-1` (mock auth), was scaffolded from a
warmup on template `e94395b`. Its born-with `Initial commit` push ran the
cert chain in the `spec-spine` job to completion, green (CI run
`28992039382`, job `86033823150`):

- **Authored posture, not defaulted.** The born-with CI writes
  `s5-ui-specification/build-spec.yaml` with `agentic_posture: { posture:
  none }` present, so the emitter binds `agenticPostureBinding: { posture:
  none, defaulted: false }` (FR-002): visibly authored, never silently
  equivalent to a defaulted `none`.
- **Emit** (FR-002 firing on the tenant/signer path): `tenant-emit
  build-certificate` read the posture off the frozen Build Spec and wrote
  an operator-signed `governance-certificate.json` under
  `.factory/runs/ci-28992039382/` (`::notice::emitted ...`).
- **Verify** (`tenant-tail 0.4.0`, spec 219): the seeded verify step
  reported `governance certificate VERIFIED`, and the FR-003 SBOM
  cross-check (`--sbom-dir .`) reported `agentic posture: none, no
  watchlisted agent/LLM SDK in the BOM`: the consistent-`none` verdict,
  with the watchlist-miss residual surfaced as a notice, not a silent pass
  (FR-003). The corpus and SBOM artifact bindings also verified.

AC-1 (schema bump + Rust twin version-pin / round-trip tests +
`factory-schema-lockstep` floor), AC-3 (the `@anthropic-ai/sdk`-class
SBOM-contradiction fixture), and AC-4 (the `governed`-envelope shape
fixture) landed with #543, along with the AC-2 tamper-rejection and
defaulted-`none` unit fixtures; this run demonstrates the AC-2
authored-`none` emit-and-verify path end-to-end on a real produced app.

The one red on the produced repo is benign and out of AC-2 scope: the
`encore / Typed client up-to-date` job failed on a transient Encore daemon
timeout (`dialing daemon: context deadline exceeded` during `encore gen
client`), a re-runnable CI flake that sits off the cert-chain path and
carries no governance or scaffold defect; the cert chain runs in the
independent, green `spec-spine` job. A re-run of the failed jobs cleared
the flake, so the produced run `28992039382` is now fully green end to end
(`encore / Typed client up-to-date`, `spec-spine`, and `ci-gate` all
pass).
