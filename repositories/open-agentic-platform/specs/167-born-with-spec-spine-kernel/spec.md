---
id: "167-born-with-spec-spine-kernel"
slug: born-with-spec-spine-kernel
title: "Born-with spec-spine kernel emission — every produced project ships with a spine"
status: approved
implementation: in-progress
owner: bart
created: "2026-05-22"
amended: "2026-06-12"
amendment_record: |
  amended by spec 178 (2026-05-24): mechanical regeneration of
  crates/featuregraph/tests/golden/features_graph.json reflecting the
  product/apps/desktop/* → product/apps/opc/* path rename in spec
  frontmatter. No semantic change to this spec's claims; fixture content
  updated 1:1 with the rename per the atomicity contract encoded by spec 177
  (featuregraph-golden is a required ci-gate check so renames carry their
  fixture refresh inside the rename PR). The body record below carries the
  authoritative dated callout; this frontmatter entry reconciles the prior
  amended: "2026-05-23" date to the body's 2026-05-24 record.
  self-amended (2026-06-11) — distribution-shape correction. §2.1, §2.2,
  §2.4, FR-002/004/005/008/009, SC-001 and §7 are re-narrated so the
  canonical born-with kernel is the published spec-spine npm distribution
  shape (pinned devDependency + spec-spine.toml + born-clean corpus +
  committed .derived/ + spec-spine.yml CI), proven shipping reality
  (template PR #56, 2026-06), retiring §2.2's vendored
  tools/spec-spine/ binaries. The emission layer is corrected from the
  dormant factory-engine Rust transition to the live statecraft prebuilt
  Create flow; the one additive write (the .kernel-version stamp) lands in
  the follow-up implementation PR. implementation flipped complete →
  in-progress: the contract is amended ahead of the code swap. Distribution
  shape stays adapter-determined (npm is the first realized mode); spec 209
  owns enforcement activation, not this amendment.
  self-amended (2026-06-12) — PR-2 implementation. The .kernel-version stamp
  is now WRITTEN by the live statecraft Create flow
  (platform/services/statecraft/api/projects/scaffold/kernelVersionStamp.ts,
  wired into perRequestScaffold.ts before push): it records the resolved
  spec-spine npm pin (read from the scaffolded package.json; root for single
  profiles, public/ for dual), adapter identity + manifest hash, source SHA,
  and toolchain_mode: pinned-toolchain (spec 168 E2). The vendored-binary CI
  template (templates/kernel/tenant-ci.yml.tmpl) + its render_tenant_workflow,
  and the synthetic scaffold-claim generator (kernel_emission/adapter_specs.rs
  + build_scaffold_claim_spec) are retired; their establishes rows are removed
  with the files. The Rust emit_kernel path remains the adapter-determined
  fallback (OQ-6). 167 claims the new helper via an extends edge into spec
  112's scaffold path (plan G4); 112 + 168 carry appended narrative entries.
kind: capability
domain: platform
risk: high
depends_on:
  - "000-bootstrap-spec-system"  # bootstrap-spec-system (the kernel content)
  - "001-spec-compiler-mvp"  # spec-compiler-mvp
  - "075-factory-workflow-engine"  # factory-workflow-engine
  - "120-factory-extraction-stage"  # factory-extraction-stage (the spec this spec extends per intent doc §9.8)
  - "127-spec-code-coupling-gate"  # spec-code-coupling-gate (kernel includes coupling gate wiring)
  - "147-spec-kind-grammar"  # spec-kind-grammar
  - "165-opc-decomposition-pipeline"  # opc-decomposition-pipeline (born-with case routes through this)
code_aliases: ["BORN_WITH_KERNEL", "SPEC_SPINE_KERNEL_EMISSION"]
establishes:
  - unit: { kind: directory, path: crates/factory-engine/src/kernel_emission }
  - unit: { kind: file, path: crates/factory-engine/src/kernel_emission/mod.rs }
  - unit: { kind: file, path: crates/factory-engine/src/kernel_emission/version.rs }
  - unit: { kind: file, path: crates/factory-engine/src/kernel_emission/gather.rs }
  - unit: { kind: file, path: crates/factory-engine/src/kernel_emission/templates.rs }
  - unit: { kind: file, path: crates/factory-engine/src/kernel_emission/emit.rs }
  # tenant-ci.yml.tmpl + adapter_specs.rs were retired in the PR-2 npm-kernel
  # impl (the vendored-binary CI template + the synthetic scaffold-claim
  # generator); their establishes rows are removed with the files.
  - unit: { kind: file, path: crates/factory-engine/templates/kernel/tenant.makefile.tmpl }
  - unit: { kind: file, path: crates/factory-engine/tests/kernel_emission_integration.rs }
extends:
  - spec: "120-factory-extraction-stage"
    nature: additive
    unit: { kind: directory, path: crates/factory-engine }
  - spec: "075-factory-workflow-engine"
    nature: additive
    unit: { kind: file, path: crates/factory-engine/src/engine.rs }
  - spec: "075-factory-workflow-engine"
    nature: additive
    unit: { kind: file, path: crates/factory-engine/src/lib.rs }
  # The .kernel-version born-with stamp is 167's concept, written into the live
  # statecraft Create flow (spec 112's scaffold path). 167 claims the new
  # helper additively; 112 carries the narrative self-amend (PR-2 / plan G4).
  - spec: "112-factory-project-lifecycle"
    nature: additive
    unit: { kind: file, path: platform/services/statecraft/api/projects/scaffold/kernelVersionStamp.ts }
  - spec: "034-featuregraph-registry-scanner-fix"
    nature: additive
    unit: { kind: file, path: crates/featuregraph/tests/golden/features_graph.json }
references:
  - role: decomposition-source
    unit: { kind: file, path: docs/owasp/factory/AIDE-VELOCITY-OAP-INTENT.md }
  - role: kernel-source
    unit: { kind: file, path: specs/000-bootstrap-spec-system/spec.md }
  - role: contract-substrate
    unit: { kind: directory, path: standards/spec }
  - role: gate-substrate
    unit: { kind: file, path: tools/spec-spine/spec-code-coupling-check/Cargo.toml }
summary: >
  When the factory produces a new project from an
  adapter, the resulting repo MUST ship with a
  pre-populated spec-spine kernel in the published
  `spec-spine` npm distribution shape: a pinned
  `spec-spine` devDependency, a root `spec-spine.toml`,
  a born-clean `specs/` corpus (`000-bootstrap` approved)
  with template-appropriate `standards/spec/`, committed
  `.derived/` artifacts compiled from the tenant's own
  corpus, and a `spec-spine.yml` CI gate invoking
  `npx --no-install spec-spine {compile,lint,index check,couple}`
  — the tenant-side analogue of the coupling gate
  (127/130/133). No spec-spine binaries are vendored into
  the tenant tree; the pinned npm devDependency *is* the
  pinned-toolchain. (Amended 2026-06-11: the original
  vendored-binary `tools/spec-spine/` shape is retired;
  see §2.2 and §7.)

  The kernel is *versioned* and *content-hash-anchored*.
  When OAP refines its own spec-spine (e.g., the
  130/152 relationship-graph work), tenants born earlier
  carry an older kernel. The kernel hash recorded in
  the tenant's repo is the substrate for spec 167's
  companion kernel-update propagation (deferred to
  follow-up spec).

  Spec 167 turns OAP from "a substrate that runs spec-
  spined work" into "a substrate that *produces* spec-
  spined projects by construction." Every project the
  factory emits inherits the discipline as a matter of
  birth.
---

# 167 — Born-with spec-spine kernel emission

## 1. Problem

OAP's spec spine is the load-bearing governance kernel: 160
specs compile deterministically to `registry.json`; drift
between code and spec fails CI; the relationship graph captures
who establishes / extends / refines / supersedes / amends what;
the coupling gate (127/130/133) is the structural defence
against engineered drift.

A tenant project produced by factory-engine today does *not*
inherit this discipline. The intent doc §6 names the gap:

> *"OAP's spec-spine is not only the substrate's internal
> governance — it is a **portable governance kernel** that every
> tenant project should carry inside itself. Two channels:
> Born-with [factory emits the kernel into the scaffold] and
> Retrofit [the same kernel installed after the fact, scanning
> existing code to seed relationships]."*

The retrofit channel is owned by spec 165 (the decomposition
pipeline applied to imported projects). The born-with channel
needs its own spec because the production-time semantics differ:

- The factory adapter knows what it scaffolded — it can seed
  the kernel with richer initial specs than a retrofit can.
- The factory pipeline runs once at project creation; the
  kernel emission is a one-shot, not an iterative refinement.
- The kernel-hash anchoring lets OAP track *which kernel
  version each tenant was born under* so kernel updates can
  propagate cleanly.

Without spec 167, every L2 capability in the convergence work
(state-machine concurrency primitives, governance certificate,
identity scopes, drift gates, sandboxing) has to be re-asserted
per tenant by hand. With it, the substrate ships the discipline
as a kernel and the tenant inherits it as a matter of birth.

## 2. Decision

Every project the factory produces ships with a fully-populated
spec-spine kernel *before* any adapter-specific code lands, in
the **published `spec-spine` npm distribution shape**. The
canonical reality (proven by template PR #56, 2026-06)
is a pinned `spec-spine` devDependency that carries the prebuilt
CLI, a root `spec-spine.toml`, a born-clean `specs/` corpus,
template-appropriate `standards/spec/`, committed `.derived/`
artifacts compiled from the tenant's own corpus, and a
`spec-spine.yml` CI gate — not a tree of loose binaries under
`<project>/tools/spec-spine/`.

The kernel travels *inside the adapter's prebuilt template tree*
(§2.4), so for the live production path "emission" means the
prebuilt template carries the spine and the Create flow copies it
wholesale (spec 112's `scaffoldFromPrebuilt`) plus writes one
additive marker — the `.kernel-version` stamp (§2.3). The
distribution shape is *adapter-determined*; npm is the first
realized mode (§2.2).

### 2.1 Kernel contents

The emitted kernel — the floor of the adapter's prebuilt template,
identical in structure to template — includes:

1. **`<project>/package.json`** — declares the `spec-spine`
   devDependency, **exact-pinned** (e.g. `"spec-spine": "0.1.0"`,
   not `^`/`~`), plus a top-level `"spec-spine": { "spec":
   "000-bootstrap" }` manifest-metadata anchor. The pinned npm
   package carries the prebuilt CLI via its `optionalDependencies`
   platform shims and a `bin: { "spec-spine": ... }` launcher, so
   `npm ci` puts one `spec-spine` CLI on `PATH`
   (`node_modules/.bin/spec-spine`). This devDependency *is* the
   pinned-toolchain (§2.2).
2. **`<project>/spec-spine.toml`** — the load-bearing root config
   declaring `[domains].allowed`, `[kind].allowed`, `[layout]`,
   `[index].extra_hashed_inputs`, `[coupling]`, and `[branding]`.
   Template-appropriate (not a copy of OAP's internal taxonomy);
   without it the tenant CLI has no taxonomy/layout config and
   cannot run `--fail-on-warn`.
3. **`<project>/specs/`** — the adapter's born-clean corpus
   (`000-bootstrap` approved, governance kind, as the
   constitutional anchor; `001…NNN` describing the scaffolded
   architecture). This corpus is *template-appropriate* — a
   produced project does not want OAP's internal-substrate spec
   000. See §2.1.6.
4. **`<project>/standards/spec/`** — directory tree:
   `constitution.md`, `contract.md`, `templates/*`.
   Template-appropriate standards (the spec-spine standard
   graduated for the produced project), not a verbatim copy of
   OAP's `standards/spec/`.
5. **`<project>/.derived/`** — committed `spec-registry/registry.json`,
   `spec-registry/build-meta.json`, and `codebase-index/index.json`
   compiled **from the tenant's own corpus** (`npx spec-spine
   compile && npx spec-spine index compile` over the tenant tree),
   not OAP's registry copied in.
6. **`<project>/.kernel-version`** — a marker file recording the
   kernel source SHA, content anchor, resolved `spec-spine` pin,
   `toolchain_mode`, and adapter identity (§2.3).
7. **Tenant-side gate wiring**:
   - `<project>/.github/workflows/spec-spine.yml` (or
     platform-equivalent CI config) that runs `npm ci` then
     `npx --no-install spec-spine {compile, lint --fail-on-warn,
     index check, couple}` against the tenant's own spec spine.
     The subcommand is `spec-spine couple` — the npm CLI's
     equivalent of OAP's coupling gate (127/130/133).
   - `<project>/Makefile` (or platform-equivalent) target
     `pr-prep` driving the same npm CLI (index regen + couple).
8. **Adapter-seeded initial specs** — the corpus above (§2.1.3)
   *is* the seed. The adapter's curated specs declare appropriate
   `kind:` per spec 147, claim logical units for the scaffolded
   code per spec 154, and may carry `references:` to the adapter's
   manifest (per spec 161's provenance grammar, kind `knowledge`
   with the adapter manifest URI as the source). See §2.1.6.

#### 2.1.6 Seed-corpus theory

The kernel's seed is the **adapter's own born-clean corpus shipped
in the prebuilt tree** (the proven template path), copied
wholesale into the produced project. The factory does *not*
synthesize a single scaffold-claim draft at emission for npm-shaped
adapters; the prebuilt corpus is primary.

A corpus-less adapter (one that ships no `specs/`) remains a
*concept* in this contract — such an adapter could fall back to a
single generated scaffold-claim draft so birth still yields
non-empty authority — but no such adapter exists today and the
generator is not part of the npm path. (History note: the original
`build_scaffold_claim_spec` generator implemented the synthetic
draft; it is retired in the follow-up implementation PR. See §7.)

### 2.2 Distribution shape: pinned npm devDependency

> **Amended (2026-06-11), self.** §2.2 originally specified
> *vendored* spec-spine binaries (`spec-compiler`,
> `spec-code-coupling-check`, `codebase-indexer`, `spec-lint`)
> emitted as loose files under `<project>/tools/spec-spine/`, with
> a `pinned-toolchain-reference` alternative left as an
> implementation choice. That vendored-binary shape is **retired**.
> The proven shipping reality (template PR #56, 2026-06)
> carries **no** `tools/spec-spine/` directory: the CLI arrives via
> the pinned `spec-spine` npm devDependency, which is precisely the
> `pinned-toolchain` mode the original §2.2 framed as the fallback.
> The fallback is now the canonical (and only realized) mode. The
> historical vendored design is preserved in §7's implementation
> record.

The kernel does **not** vendor loose binaries into the tenant tree.
The tenant's toolchain is the **pinned `spec-spine` npm
devDependency** declared in `package.json` (§2.1.1). On `npm ci`
the package's `optionalDependencies` resolve the host-platform
prebuilt-binary shim and expose a single `spec-spine` launcher on
`PATH`; the tenant CI invokes it as `npx --no-install spec-spine
…`. This is the `pinned-toolchain` mode recorded in
`.kernel-version` (§2.3); there is no separate "vendor-binaries"
arm in the shipping shape.

**Distribution shape is adapter-determined.** npm is the first —
and currently only — realized mode, correct for the current
npm-shaped adapter (acme-vue-encore). A future non-npm adapter
(e.g. a Rust-produced project) would carry a `spec-spine` obtained
through its own ecosystem's pinned-distribution channel (a
cargo-installed CLI, say), recorded under the same
`.kernel-version` `toolchain_mode` field. The contract is "the
born-with toolchain is a pinned spec-spine distribution chosen by
the adapter," not "npm always." The retired `vendor-binaries`
enum value is kept for `.kernel-version` backward-compatibility
(§2.3) but is not emitted by any shipping adapter.

### 2.3 Kernel version anchoring

The `<project>/.kernel-version` file is the load-bearing
substrate for propagation. The anchoring concept is unchanged
from the original design; under the npm shape the load-bearing
toolchain pin is the resolved `spec-spine` devDependency version
(read from the scaffolded `package.json`), not a factory-engine
version. It records:

```yaml
kernel:
  source_commit: <SHA>
  source_hash: <content-hash>
  spec_spine_version: <resolved-pin>   # the exact spec-spine npm pin the tenant was born under
  toolchain_mode: pinned-toolchain      # the npm devDependency IS the pinned toolchain (§2.2)
  emitted_at: <ISO-8601>
adapter:
  id: <adapter-id>
  version: <semver>
  manifest_hash: <content-hash>
```

`toolchain_mode` uses the existing `pinned-toolchain` enum value
(the `vendor-binaries` value is retained for backward-compat but
not emitted — §2.2). Recording the *resolved* `spec_spine_version`
lets propagation/audit see which CLI version a tenant carries.

Future kernel-update propagation reads this file to decide
whether a tenant is "up-to-date" with current spec-spine
refinements. The propagation mechanism itself is out of scope
for spec 167 (deferred to a follow-up spec named in §6).

### 2.4 Emission layer: the live Create flow

Because the kernel travels inside the adapter's prebuilt template
tree, "emission" in production is a property of the warmed
template, copied to the produced project by spec 112's
`scaffoldFromPrebuilt` (the `cpAsync` of the prebuilt dir into the
destination). FR-001 ("every produced project ships a populated
kernel before any adapter code lands") is therefore satisfied *by
construction* — the kernel is the floor of the template.

The single mechanical addition to the live path is the
`.kernel-version` stamp (§2.3), written/refreshed at scaffold time
alongside the L0 pipeline-state seed (spec 112), because the
adapter identity, manifest hash, resolved `spec-spine` pin, and
source SHA are only known then. This is the one new write; it
lands in the follow-up implementation PR (§7).

The dormant `factory-engine` Rust transition is **not** the
emission layer. Wiring `emit_project_kernel` into a
`transition_to_*` hook would emit a second, vendored-flavoured
kernel on top of the npm one — and would do so *silently*: the
`refuse_existing_kernel` guard keys on `.kernel-version` and
`specs/000-bootstrap-spec-system/spec.md`, and the prebuilt corpus
carries neither (its bootstrap lives at the slug `specs/000-bootstrap/`,
and no `.kernel-version` exists until the stamp lands). The
production Create path never traverses that engine transition for
scaffold materialization; it copies the prebuilt tree.

## 3. Functional Requirements

- **FR-001** Every project the factory produces from an adapter
  includes a populated spec-spine kernel before any
  adapter-specific code lands in the project's working tree. For
  npm-shaped adapters this is satisfied by construction — the
  kernel is the floor of the prebuilt template, copied wholesale
  by the live Create flow (§2.4).
- **FR-002** The kernel includes the core files / directories
  named in §2.1: `package.json` (pinned `spec-spine` devDep),
  `spec-spine.toml`, the born-clean `specs/` corpus,
  `standards/spec/`, the committed `.derived/` artifacts compiled
  from the tenant's own corpus, and `.kernel-version`. The
  `.derived/` artifacts are compiled from the tenant corpus, not
  copied from OAP.
- **FR-003** The kernel includes tenant-side gate wiring (§2.1
  item 7) whose default platform target is GitHub Actions (`spec-spine.yml`
  invoking `npx --no-install spec-spine …`); alternate CI
  platforms (GitLab CI, Azure Pipelines) are supported via
  per-adapter overrides.
- **FR-004** The adapter contributes the project's initial specs
  as the born-clean corpus it ships in the prebuilt tree (§2.1.3,
  §2.1.6). Each spec satisfies spec 147 grammar, spec 154 unit
  grammar, and (if derived from the adapter manifest) spec 161
  emission contract. A corpus-less adapter MAY fall back to a
  single generated scaffold-claim draft (concept only; not the
  npm path — §2.1.6).
- **FR-005** The tenant's toolchain is a **pinned `spec-spine`
  distribution** chosen by the adapter; for npm-shaped adapters it
  is the exact-pinned `spec-spine` npm devDependency (§2.2). No
  loose binaries are vendored into the tenant tree. The mode is
  recorded in `.kernel-version` as `toolchain_mode:
  pinned-toolchain` (§2.3).
- **FR-006** The `.kernel-version` file records the kernel source
  fields, the resolved `spec_spine_version` pin, `toolchain_mode`,
  and the adapter fields (§2.3). The file is authoritative;
  tampering is detected by the future propagation mechanism.
- **FR-007** Running `make pr-prep` (or the platform-equivalent
  target, driving `npx --no-install spec-spine`) in a born-with
  project succeeds against the emitted kernel content — `couple`,
  `lint`, and `index check` all pass at project birth.
- **FR-008** A tenant project's CI runs the coupling gate
  (`spec-spine couple`) against the project's *own* spec spine,
  not against OAP's. The gate uses the pinned `spec-spine` npm
  devDependency (the pinned-toolchain — §2.2), resolved on `PATH`
  via `npm ci`.
- **FR-009** Re-running the scaffold on the same adapter +
  prebuilt-template SHA produces an identical kernel *content*:
  the corpus, `standards/spec/`, `spec-spine.toml`, and committed
  `.derived/` are byte-identical because they are the same
  prebuilt tree. Determinism is verified over the prebuilt-template
  content, not over `.kernel-version` — whose `emitted_at` and
  per-run source SHA legitimately vary per scaffold and are
  therefore excluded from the equality check.

## 4. Success Criteria

- **SC-001** A new project produced from `acme-vue-encore` (or
  any production-supported adapter) contains the full
  kernel at the first commit (pinned `spec-spine` devDep,
  `spec-spine.toml`, born-clean corpus, `standards/spec/`,
  committed `.derived/`, `spec-spine.yml`); the project's own
  coupling gate (`npx --no-install spec-spine couple`) passes
  against the initial commit.
- **SC-002** The `.kernel-version` file in the produced
  project records the correct source commit, content hash,
  resolved `spec_spine_version` pin, `toolchain_mode:
  pinned-toolchain`, and adapter metadata.
- **SC-003** Running the project's CI workflow on a
  hand-introduced spec/code drift (e.g., a code edit
  without a matching spec edit) fails the coupling gate.
- **SC-004** Two scaffolds from the same adapter +
  prebuilt-template SHA produce kernels whose corpus,
  `standards/spec/`, `spec-spine.toml`, and committed
  `.derived/` are byte-identical (deterministic emission;
  `.kernel-version`'s `emitted_at` / source SHA excluded —
  FR-009).
- **SC-005** A born-with project displays its initial specs
  in statecraft's Requirements view (spec 163), the corpus
  carrying its declared provenance.

## 5. Scope

### In scope

- The kernel content definition (the npm distribution shape —
  §2.1).
- The emission layer: the prebuilt template carries the kernel;
  the live statecraft Create flow copies it and writes the
  `.kernel-version` stamp (§2.4).
- The tenant-side gate wiring template (`spec-spine.yml` /
  `pr-prep`).
- The pinned `spec-spine` distribution reference (the npm
  devDependency — §2.2; the distribution shape is
  adapter-determined).
- The `.kernel-version` marker file.

### Out of scope (deferred to follow-up spec)

- **Kernel-update propagation cadence and compatibility
  policy.** Intent doc §7 OQ-8 names this as an open
  question. When OAP refines its own spec-spine, how do
  born-earlier tenants opt into the refinement? The
  `.kernel-version` file is the substrate; the propagation
  mechanism is its own spec.
- **Non-npm adapter distribution shapes.** The first cut ships
  the npm distribution for npm-shaped adapters. A Rust- or
  other-ecosystem-produced project would carry a `spec-spine`
  obtained through its own pinned-distribution channel (§2.2);
  realizing those modes is out of scope here.
- **Kernel customisation per tenant.** The kernel is the
  adapter's canonical kernel; tenants may not edit the
  `000-bootstrap` constitutional anchor or `standards/spec/`.
  They may add new specs and (post-birth) refine their own
  corpus normally.
- **Enforcement activation (spec 209).** Making the seeded CI
  fail-the-PR and auto-emitting governance certificates from
  pipeline transitions is owned by spec 209, not this spec
  (§6).
- **Retrofit channel.** Spec 165 owns the retrofit case
  (decomposition pipeline applied to existing projects).
  Spec 167 covers born-with only.

## 6. Cross-references

- **INTENT doc** §6.5, §9.8.
- **`spec-spine` npm package** — the published distribution
  whose shape (pinned devDependency carrying the prebuilt CLI,
  `spec-spine.toml`, born-clean corpus, committed `.derived/`,
  `spec-spine.yml` invoking `npx --no-install spec-spine
  {compile,lint,index check,couple}`) is the canonical born-with
  kernel. Proven shipping reality: template PR #56
  (2026-06). The pinned devDependency *is* the pinned-toolchain
  (§2.2).
- **Spec 000** — bootstrap-spec-system; the conceptual source of
  the corpus anchor. Note: a produced project ships a
  *template-appropriate* `000-bootstrap` (not a verbatim copy of
  OAP's internal substrate spec 000) — §2.1.3.
- **Spec 112** — factory-project-lifecycle; the **live** Create
  flow (`create.ts` → `scaffoldFromPrebuilt`) is the production
  emission path that copies the prebuilt kernel and writes the
  `.kernel-version` stamp (§2.4). The implementation PR's stamp
  helper is claimed by this spec via an added `extends:` edge.
- **Spec 120** — factory-extraction-stage; spec 167
  `extends:` this for the born-with seeding case.
- **Spec 075** — factory-workflow-engine; the original design
  scoped the auto-fire as an engine transition. The corrected
  emission layer is spec 112's Create flow (§2.4); the dormant
  engine transition is *not* wired (and wiring it would
  double-emit silently).
- **Spec 127 / 130 / 133** — coupling gate; tenant CI
  wiring invokes the equivalent `npx --no-install spec-spine
  couple`.
- **Spec 147** — kind grammar; adapter-seeded specs declare
  `kind:`.
- **Spec 154** — logical-unit grammar; adapter-seeded specs
  declare units.
- **Spec 156 / 161** — provenance grammar / emission
  contract; adapter-seeded specs use these to point at the
  adapter manifest.
- **Spec 165** — decomposition pipeline; born-with case
  routes through this for stages 2–6 (xray, semantic,
  callgraph, lineage, synthesis) when adapter content is
  insufficient to seed specs directly.
- **Spec 168** — per-project governance certificate; ships the
  emitter and verifier as part of the kernel. Its FR-005
  reference resolves to the `pinned-toolchain` (npm devDep)
  mode now that the vendored arm is retired (§2.2).
- **Spec 203** — produced-app SBOM attestation; complementary
  produced-project supply-chain discipline carried by the kernel.
- **Spec 209** — tenant-kernel-ci-enforcement; owns *enforcement
  activation* (making the seeded CI fail-the-PR, auto-emitting
  certificates, verifying tool integrity) — explicitly NOT this
  amendment. **Note for 209's owner (G3):** 209 carries `refines:`
  edges on `kernel_emission/emit.rs` and `version.rs` and a
  "verify vended-tool integrity" leg that *presume vendored
  binaries*. Under the npm shape that leg becomes npm-pin /
  lockfile / package-provenance verification — a **premise
  rewrite**, not a mechanical anchor repoint. Re-derive the leg
  against the npm distribution rather than repointing it at the
  retired template.
- **Follow-up — kernel-update propagation spec.** Open
  per intent doc §7 OQ-8.

## 7. Implementation status

> **Amended (2026-06-11), self.** The vendored-binary
> `kernel_emission` library described in the 2026-05-23 record
> below **landed and is preserved as history** — but the
> *distribution mode it implements* (vendored `tools/spec-spine/`
> binaries, an emitted `tenant-ci.yml.tmpl` looping over them, a
> `factory-engine` auto-fire) is **superseded** by the npm
> distribution shape (§2.1, §2.2) and the corrected emission layer
> (§2.4). The contract is amended ahead of the implementation:
> `implementation:` is flipped `complete → in-progress` because
> the landed code still implements the vendored shape while the
> contract now describes the npm shape. The code swap — retiring
> the vendored templates and the `build_scaffold_claim_spec`
> generator, repointing the `establishes:` rows, and adding the
> statecraft `.kernel-version` stamp helper (claimed by this spec
> via a new `extends:` edge into the scaffold path) — lands in the
> follow-up implementation PR. No claim below is deleted; this
> record corrects which design is canonical.

### 7.1 Implementation status (2026-05-23, vendored-binary cut — superseded distribution mode)

The kernel-emission contract lands as a library at
`crates/factory-engine/src/kernel_emission/` plus a thin
`FactoryEngine::emit_project_kernel` entry point. The cut is
deliberate: the contract is settled and tested; the production
pipeline auto-fire and the binary-vending step are scoped as
follow-ups so the contract can land without dragging in
release-engineering plumbing.

> The distribution mode this cut implements is superseded as of
> 2026-06-11 (see the §7 amendment callout). The dated record is
> retained by construction.

#### Done (vendored-binary cut)

- **FR-001 / FR-002.** `emit_kernel()` writes spec 000,
  `standards/spec/**`, the pre-compiled registry, the
  `.kernel-version` marker, tenant gate wiring (workflow +
  Makefile), and the adapter-seeded scaffold-claim spec in
  one atomic call. Test:
  `kernel_emission::emit::tests::emits_full_kernel_layout`.
- **FR-003.** Default platform target is GitHub Actions
  (`crates/factory-engine/templates/kernel/tenant-ci.yml.tmpl`).
  Per-adapter overrides for GitLab CI / Azure Pipelines are
  parametric via `TenantGateContext` but ship without
  per-platform branching; see Deferred below.
- **FR-004.** `build_scaffold_claim_spec()` emits one draft
  conforming to spec 147 (`kind: capability`), spec 154
  (`establishes:` units from the adapter scaffold paths or a
  repo-root fallback), and — when an adapter manifest URI is
  provided — spec 161 (`references: knowledge-source`).
  Test:
  `kernel_emission::adapter_specs::tests::body_includes_required_frontmatter_keys`.
- **FR-005 (mode field).** `ToolchainMode::VendorBinaries` /
  `PinnedToolchain` is recorded in `.kernel-version`. The
  actual vending of the binaries themselves is Deferred.
- **FR-006.** `.kernel-version` round-trips through
  `KernelVersion::{to_yaml, from_yaml}` with the four
  `kernel.*` fields and three `adapter.*` fields plus
  `toolchain_mode`.
- **FR-008.** The emitted workflow invokes the tenant-resident
  `spec-code-coupling-check` against the tenant's own base/head
  refs.
- **FR-009.** `compute_kernel_hash()` over sorted entries is
  deterministic. Test:
  `kernel_emission::emit::tests::deterministic_emission_yields_hash_equal_kernels`.

#### Deferred at the vendored-binary cut (historical)

- **Production pipeline auto-fire.** `emit_project_kernel` is
  reachable on `FactoryEngine` and unit-tested, but no
  `transition_to_*` hook fires it automatically. *(2026-06-11
  correction: this auto-fire is deliberately NOT wired — §2.4 —
  because the live emission layer is the statecraft Create flow,
  not the engine transition. Wiring it would double-emit
  silently. The engine path is orthogonal to production.)*
- **Tenant binary vending (FR-005 binaries side).** Cross-target
  builds for the spec-spine binaries through the OAP release
  pipeline (spec 117); the kernel-emitter recorded the mode but
  did not copy binaries into `<project>/tools/spec-spine/`.
  *(2026-06-11 correction: binary vending is retired — the npm
  devDependency carries the prebuilt CLI via its platform shims;
  no loose binaries are vendored. §2.2.)*
- **Per-CI-platform overrides (FR-003 alternates).** GitLab
  CI / Azure Pipelines templates not bundled. The
  `TenantGateContext` substitution machinery accepts the
  context the alternate templates would need.
- **SC-001 / SC-005 full E2E.** Driving a real adapter factory
  run end-to-end and verifying the produced project's CI passes
  and its specs surface in statecraft's Requirements view (spec
  163). The contract tests demonstrate the kernel content is
  well-formed.

### 7.2 Follow-up implementation plan (2026-06-11, npm distribution shape)

The amendment lands the contract; the code swap lands next:

- **Template-source obligation (satisfied by construction).** The
  adapter's prebuilt template (template, PR #56) already
  carries the full npm spine kernel — `package.json` pinned
  `spec-spine` devDep, `spec-spine.toml`, the born-clean corpus,
  `standards/spec/`, committed `.derived/`, and `spec-spine.yml`.
  The live Create flow copies it wholesale (§2.4); no engine
  auto-fire is wired.
- **`.kernel-version` stamp (the one new write).** A
  `buildKernelVersionStamp` helper (sibling of the L0
  pipeline-state seed under
  `platform/services/statecraft/api/projects/scaffold/`) writes
  `.kernel-version` into the scaffold tree before push, recording
  the resolved `spec-spine` pin (read from the scaffolded
  `package.json`), adapter identity + manifest hash, source SHA,
  and `toolchain_mode: pinned-toolchain`. This spec claims the
  helper via a new `extends:` edge into the scaffold path (added
  in the implementation PR, not here).
- **Template + emitter retirement.** The implementation PR
  retires/rewrites `tenant-ci.yml.tmpl` to the `spec-spine.yml`
  shape (or removes it if the template-source owns CI emission),
  repoints this spec's `establishes:` rows atomically, retires
  `build_scaffold_claim_spec` (the corpus-less fallback survives
  as concept only — §2.1.6), and regenerates the featuregraph
  golden. The pin is owned by the adapter/template `package.json`
  (single source of truth, exact-pinned); OAP does not re-pin.
- **No-spec-injection invariant (kept).** The Create flow writes
  only `.factory/*` (pipeline-state seed + the `.kernel-version`
  stamp), never a `specs/*` file, so the prebuilt template's
  committed `.derived/` stays valid and the Create flow needs no
  CLI run at scaffold time.

> **PR-1 graph posture.** This amendment keeps every
> `establishes:`/`extends:` row pointing at still-present files
> (the template swap and the new stamp-helper edge land in the
> implementation PR). The `implementation:` flip regenerates the
> featuregraph golden in this PR; the edge is coupling-clean via
> the existing `extends: 034` row.


## Amendments received

**Amendment 2026-05-24 (record: 178-opc-directory-rename).**
Spec 178 (opc-directory-rename, 2026-05-24): mechanical regeneration
of `crates/featuregraph/tests/golden/features_graph.json` reflecting
the `product/apps/desktop/*` → `product/apps/opc/*` path rename in
spec frontmatter. No semantic change to this spec's claims; fixture
content updated 1:1 with the rename per the atomicity contract
encoded by spec 177 (ci-orchestrator-pr-gate) — featuregraph-golden
is a required ci-gate check precisely so renames carry their fixture
refresh inside the rename PR. *(This is the authoritative dated
record; the frontmatter `amendment_record:` reconciles its prior
`amended: "2026-05-23"` date to this body's 2026-05-24 entry.)*

**Self-amendment 2026-06-11 (distribution-shape correction).**
§2.1, §2.2, §2.4, FR-002/004/005/008/009, SC-001/002/004/005,
§5, §6, and §7 are re-narrated so the canonical born-with kernel is
the published `spec-spine` npm distribution shape — a pinned
devDependency carrying the prebuilt CLI, a root `spec-spine.toml`, a
born-clean `specs/` corpus, template-appropriate `standards/spec/`,
committed `.derived/` compiled from the tenant's own corpus, and a
`spec-spine.yml` CI gate invoking `npx --no-install spec-spine
{compile,lint,index check,couple}`. The vendored `tools/spec-spine/`
binary shape (original §2.2) is retired; the proven shipping reality
is template PR #56 (2026-06), which carries no
`tools/spec-spine/` tree. The emission layer is corrected from the
dormant `factory-engine` Rust transition to the live statecraft
prebuilt Create flow (spec 112); the one additive write — the
`.kernel-version` stamp — lands in the follow-up implementation PR.
`implementation:` flipped `complete → in-progress`: the contract is
amended ahead of the code swap. Distribution shape stays
adapter-determined (npm is the first realized mode). Spec 209 owns
enforcement activation, not this amendment (§6 G3 note). The
2026-05-23 vendored-binary implementation record is preserved in §7
by construction — this amendment corrects which design is canonical,
not the historical fact that the vendored module landed.
