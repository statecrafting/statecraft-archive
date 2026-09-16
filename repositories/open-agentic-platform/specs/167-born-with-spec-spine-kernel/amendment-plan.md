# Amendment Plan — Spec 167 (born-with spec-spine kernel) ⇄ published npm spec-spine

> **Status:** PLAN-FIRST deliverable for WS5 of the OAP gap-closure. This file
> is *not* indexer-hashed (no `spec.md` in path); it edits no spec or code.
> It proposes the diff; the amendment PR and implementation PR(s) execute it.
>
> **Revised 2026-06-11** after the Dev2-lane evaluation (relay:
> `~/DevWork/agent-relay.md`): verdict "sound and verifiably accurate,
> approve the direction"; E1–E3 corrected and G1–G5 closed below; OQ
> positions annotated with Dev2's reads.

## Executive summary

Spec 167's §2.2 ("tenant-resident binaries"), its §2.1.5 GitHub-workflow shape,
and FR-005 ("vendor binaries OR pinned-toolchain reference") were authored
(2026-05-22/23) *before* the `spec-spine` npm package existed and before
template proved the distribution shape. The spec still describes the
kernel as a tree of pre-compiled Rust binaries under `<project>/tools/spec-spine/`
plus a tenant CI that `exec`s them directly. The proven, shipping reality
(template PR #56, 2026-06) is the *opposite*: a `spec-spine` npm
devDependency (pinned, prebuilt-binary-bearing), a root `spec-spine.toml`, a
born-clean `specs/` corpus, `standards/spec/`, committed `.derived/` artifacts,
and a `spec-spine.yml` CI gate invoking `npx --no-install spec-spine {compile,lint,index check,couple}`.
No binaries are vendored into the tenant tree. This plan amends 167 in place to
make the npm distribution shape the canonical born-with emission, retires the
vendored-binary design (collapsing FR-005's dual mode to a single
`npm-devdependency` mode while preserving `.kernel-version`'s mode field for
forward-compat), and — critically — **relocates the auto-fire from the dormant
`factory-engine` Rust path to the live statecraft Create flow** (`create.ts` →
`perRequestScaffold.ts`), because that is the path every produced project
actually traverses; the Rust `emit_project_kernel` was never wired and is
orthogonal to production. The amendment must be careful to stay inside its lane:
spec 209 (drafted the same day) owns *enforcement activation* (making the seeded
CI fail-the-PR and auto-emitting certificates); spec 167's amendment owns only
the *distribution-shape correction* and the *placement* of emission. Sequencing
is a spec-only amendment PR first (167 self-amend; 112/168 receive appended
callouts only if their narrative names the vendored shape — 075 is most likely
untouched in PR 1, per the body's analysis), then implementation PR(s) that
swap the vendored-binary templates for the npm shape and wire emission into
the prebuilt-template path.

---

## Stale claims audit

Anchors are to `specs/167-born-with-spec-spine-kernel/spec.md` as it stands
(read 2026-06-11). Each entry cites the stale text and the reality that
contradicts it.

### S1 — §2.2 "Tenant-resident binaries" (spec.md:158–175) — STALE, retire

> *"The kernel emission includes: a pre-compiled `spec-compiler` binary… a
> pre-compiled `spec-code-coupling-check`… `codebase-indexer`… `spec-lint`…
> emitted under `<project>/tools/spec-spine/`."*

Contradicted by the published package. `spec-spine`'s npm shim
(`spec-spine/npm/package.json`) ships the prebuilt binary
through `optionalDependencies` (`@spec-spine/cli-{darwin-arm64,…}`) and a
`bin: { "spec-spine": "bin/spec-spine.js" }` launcher. The tenant gets one CLI
on `PATH` via `npm ci`; it does **not** receive four loose binaries under
`tools/spec-spine/`. template carries **no** `tools/spec-spine/`
directory (confirmed: `ls` shows none; the binary arrives via
`node_modules/.bin/spec-spine`). §2.2's "Alternative: pinned-toolchain
reference" is the closest to reality but is framed as a fallback, not the
primary; in truth the npm devDependency *is* the pinned-toolchain reference.

### S2 — §2.1.5 tenant gate wiring (spec.md:143–149) + the emitted template — STALE shape

> *"`<project>/.github/workflows/ci-spec-code-coupling.yml`… that invokes a
> tenant-resident `spec-code-coupling-check`… `<project>/Makefile`… target
> `pr-prep` invoking the codebase-indexer + coupling gate."*

The emitted template (`crates/factory-engine/templates/kernel/tenant-ci.yml.tmpl:27–51`)
hard-codes a "Verify tenant-resident spine binaries exist" step that loops over
`codebase-indexer spec-code-coupling-check spec-compiler spec-lint` under
`@@binaries_dir@@` and `exec`s them. The proven shape
(`template/.github/workflows/spec-spine.yml:34–60`) is
`npm ci` then `npx --no-install spec-spine {compile,lint --fail-on-warn,index check,couple}`.
Subcommand names also drifted: 167 emits `spec-code-coupling-check`; the npm CLI
uses `spec-spine couple`. Workflow filename drifted too:
`ci-spec-code-coupling.yml` (167) vs `spec-spine.yml` (proven).

### S3 — FR-005 dual-mode (spec.md:217–219) — PARTIALLY STALE, collapse

> *"Tenant-resident spec-spine binaries (§2.2) are included… OR the project's CI
> references a pinned-version OAP toolchain distribution. The chosen mode is
> recorded in `.kernel-version`."*

The `vendor-binaries` arm is now dead — nothing ships it and template
never used it. Reality is a single mode: an npm devDependency pinned to an exact
`spec-spine` version. Recommendation: keep the *mechanism* of recording a mode
in `.kernel-version` (forward-compat; cheap), but the canonical value becomes a
new variant (e.g. `npm-devdependency`). See "Replacement design → toolchain
mode" for how to handle the existing `ToolchainMode` enum without a hostile
serde break.

### S4 — §2.1.1 / FR-002 "verbatim copy of OAP's spec 000" (spec.md:131, 205–207) — STALE seed content

> *"`<project>/specs/000-bootstrap-spec-system/spec.md` — verbatim copy of OAP's
> current spec 000."*

Two problems. (a) **Wrong spec 000.** OAP's `specs/000-bootstrap-spec-system/spec.md`
is OAP's *internal substrate* bootstrap; a produced npm project does not want
OAP's substrate-flavoured spec 000. template authored a *different*,
project-appropriate `000-bootstrap` (id `"000-bootstrap"`, title "Bootstrap: the
spec-spine governance contract for **this template**",
`template/specs/000-bootstrap/spec.md`) whose body
explicitly says governance comes from the published npm package. (b) **The
verbatim-copy/`gather.rs` path** (`crates/factory-engine/src/kernel_emission/gather.rs:36–52,82–129`)
reads OAP's own `standards/spec/` and OAP's own compiled
`.derived/spec-registry/registry.json` — these are OAP-internal artifacts
(domains/kinds taxonomies, frontmatter known-keys) that do not match a produced
project's `spec-spine.toml`. The proven shape ships template-appropriate
`standards/spec/{constitution,contract,templates/*}` and a `.derived/` compiled
*from the tenant's own corpus*, not copied from OAP.

### S5 — §2.1 missing `spec-spine.toml` (spec.md:127–157) — OMISSION

The proven shape's load-bearing config file —
`template/spec-spine.toml` (declares `[domains].allowed`,
`[kind].allowed`, `[layout]`, `[index].extra_hashed_inputs`, `[coupling]`,
`[branding]`) — is **absent** from 167's kernel-contents list entirely. Without
it the tenant CLI has no taxonomy/layout config and cannot run `--fail-on-warn`.
This is the single most important addition.

### S6 — §2.1.6 / FR-004 adapter-seeded scaffold-claim as a *separate* spec (spec.md:150–156, 213–215) — RECONCILE with born-clean corpus

167 emits one synthetic draft `specs/001-<adapter>-scaffold-claim/spec.md`
(`crates/factory-engine/src/kernel_emission/adapter_specs.rs:45–121`,
slug `acme-vue-encore-scaffold-claim`, owner `tenant`, status `draft`). The proven
shape instead ships a **born-clean 21-spec corpus** (template PR #56
"born-clean 21-spec corpus") where `000-bootstrap` is approved and `001…020`
describe the actual scaffolded architecture. These are not contradictory but
they are different theories of "what the kernel seeds." Decision needed (see
Open questions OQ-1): does born-with seed (a) the full template corpus that
travels *with the prebuilt template*, or (b) a single synthetic scaffold-claim
draft generated at emission? The proven path is (a) — the corpus is part of the
prebuilt tree, copied wholesale by `perRequestScaffold.ts`'s `cpAsync`. The
synthetic-draft generator is then dead code for the npm path.

### S7 — §6 + FR-001/§7 "factory-engine pipeline gains the kernel-emission step" (spec.md:122, 261, 356–364) — WRONG INSERTION LAYER

167 assumes the auto-fire lives in `factory-engine`'s Phase-2 transition
("before the first adapter write in Phase 2", spec.md:362–364). But the live
production Create path is **statecraft**, not the Rust engine: spec 112
`platform/services/statecraft/api/projects/create.ts:271–326` scaffolds by
copying a prebuilt template tree (`scaffoldFromPrebuilt`,
`perRequestScaffold.ts:60–138`) and pushing commit #1. The Rust
`FactoryEngine::emit_project_kernel` (`crates/factory-engine/src/engine.rs:347–394`)
is reachable and unit-tested but **no transition calls it** (confirmed: only
test files reference it). For the npm distribution shape, the kernel is *already
inside the prebuilt template*, so "emission" in production means "the prebuilt
template carries the spine, and the Create flow does nothing extra" — see
Auto-fire placement.

### S8 — §7 "Implementation status" + "Done" FR claims (spec.md:312–384) — describes the vendored-binary library as complete

The whole §7 narrates the vendored-binary `kernel_emission` module as the
landed contract. It must be re-narrated: the module landed, but the chosen
distribution mode it implements is being superseded by the npm shape. This is a
*self-amendment* of the implementation-status section, not a deletion of the
historical record (history-by-construction; keep the dated entry, append the
correction).

### Not stale (preserve)

- §2.3 `.kernel-version` anchoring (spec.md:177–197) — the marker concept is
  sound and is the substrate spec 209 builds on. Keep; only the
  `toolchain_mode` value-space changes (S3).
- §5 "Out of scope → kernel-update propagation / retrofit (spec 165)" — still
  correct.
- The spec 168 amendment (`.factory/toolchain.yaml`, `certificate_toolchain`
  field) — already landed; the amendment must not regress it (see Spec-graph
  mechanics → 168 coupling).

---

## Replacement design

The born-with kernel emits the **npm spec-spine distribution shape**, identical
in structure to template. Concretely, a produced project's commit #1
carries:

| Artifact | Source | Replaces (167) |
|---|---|---|
| `spec-spine` devDependency in root `package.json`, **exact-pinned** (e.g. `"spec-spine": "0.2.0"`), plus top-level `"spec-spine": { "spec": "000-bootstrap" }` manifest-metadata | the prebuilt template's `package.json` | §2.2 vendored binaries |
| `spec-spine.toml` at repo root (domains/kind taxonomies, layout, `[index].extra_hashed_inputs`, `[coupling]`, `[branding]`) | template-appropriate config, not OAP's | §2.1 omission (S5) |
| `standards/spec/{constitution.md,contract.md,templates/*}` | template-appropriate standards | §2.1.2 (was verbatim OAP copy) |
| `specs/` born-clean corpus (`000-bootstrap` approved + adapter-described specs) | the prebuilt template's corpus | §2.1.1 + §2.1.6 synthetic draft |
| `.derived/{spec-registry/registry.json,spec-registry/build-meta.json,codebase-index/index.json}` compiled **from the tenant's own corpus** | `npx spec-spine compile && spec-spine index compile` over the tenant tree | §2.1.3 (was OAP's registry copied) |
| `.github/workflows/spec-spine.yml` invoking `npx --no-install spec-spine {compile,lint --fail-on-warn,index check,couple}` | template's proven workflow | §2.1.5 + tenant-ci.yml.tmpl |
| `Makefile` `pr-prep` target driving the same npm CLI | template's Makefile | §2.1.5 |
| `.kernel-version` marker (kept) with `toolchain_mode: pinned-toolchain` (the OQ-4 option-1 enum value; the npm devDep IS the pinned toolchain — see E2 note under Toolchain mode) and the pinned `spec-spine` version | emitter | §2.3 (mode semantics re-documented) |
| `.factory/toolchain.yaml` + `.factory/pipeline-state.json` L0 seed | spec 168 + spec 112 (already shipping) | unchanged |

### Toolchain mode (resolving S3 without a hostile serde break)

`ToolchainMode` (`crates/factory-engine/src/kernel_emission/version.rs:85–92`) is
`#[serde(rename_all = "kebab-case")]` with `VendorBinaries | PinnedToolchain`.
The npm shape is effectively `PinnedToolchain` semantically (CI references a
pinned distribution). Cleanest amendment-compatible options, in preference order:

1. **Re-document `PinnedToolchain` as "npm devDependency (the canonical mode)"**
   and deprecate `VendorBinaries` (keep the variant for `.kernel-version`
   backward-compat, mark it dead in the spec). No enum/serde change → no
   round-trip break for the spec-168 fixtures that emit `vendor-binaries`. This
   is the lowest-risk path; the spec text carries the semantic correction.
2. Add a third variant `NpmDevdependency` and make it the default. Higher blast
   radius: the spec-168 `.kernel-version` round-trip tests and
   `tenant_emission_integration.rs` assert specific mode strings; a new default
   would touch those fixtures and is implementation, not spec, churn.

**Recommend option 1** for the amendment; the implementation PR can pursue
option 2 later if a distinct mode string is judged worth it. Either way the spec
states: the canonical born-with toolchain is the pinned `spec-spine` npm
devDependency; vendored loose binaries are retired.

**E2 consistency rule (Dev2):** option 1 binds the stamp's value — the
statecraft-written `.kernel-version` records `toolchain_mode: pinned-toolchain`
(the existing kebab-case serde value, `version.rs:85–92`), NOT a literal
`npm-devdependency` string, which would fail `KernelVersion::from_yaml` the
moment Rust propagation tooling reads it. Wanting `npm-devdependency` as the
recorded value IS option 2 and carries its fixture blast radius. The earlier
draft of this plan contradicted itself here; resolved to option 1 throughout.

### What the kernel seeds as the project's first spec(s)

The proven answer is **the prebuilt template's born-clean corpus travels with
the template** (template ships `000-bootstrap` … `020-…`). The
emitter does not synthesize a scaffold-claim spec in the npm path. The spec
should state: the kernel's seed corpus is the adapter's own curated corpus
shipped in the prebuilt tree, with `000-bootstrap` (approved, governance kind)
as the constitutional anchor. The synthetic `build_scaffold_claim_spec`
generator (`adapter_specs.rs`) becomes either (a) dead code retired in the
implementation PR, or (b) repurposed for adapters that ship *no* corpus (a
fallback seed). OQ-1 asks Bart to choose; the plan's recommendation is (b) —
keep it as a documented fallback so a corpus-less adapter still births
non-empty authority, but make the prebuilt-corpus path primary.

### v0.2.0 emitted-config defaults (forward-looking)

The task brief notes spec-spine v0.2.0 adds `[coupling] auto_waive_dependency_only`
and governance-projection hashing of npm manifests. **Caveat from the read:** the
checkout at `spec-spine` is still `0.1.0` (Cargo.toml:14,
npm/package.json version 0.1.0); the v0.2.0 features are *not yet present* in
that tree (grep for `auto_waive`/`governance-projection` found only `PR5-HANDOFF.md`).
So this is a *future* pin. The amendment should:

- Pin the emitted devDep to the version that is actually published when the
  implementation PR lands (today that is `0.1.0`, as template pins; the
  brief says "soon 0.2.0"). Do **not** hard-code `0.2.0` in the spec; state the
  pin-source rule (below) instead.
- When 0.2.0 publishes, the emitted `spec-spine.toml` should default
  `[coupling].auto_waive_dependency_only = true` (so a lockfile-only dependency
  bump does not trip the tenant coupling gate — the exact dependabot-vs-coupling
  pain recorded for template) and rely on governance-projection hashing
  of npm manifests for the index inputs. These are *emitted-config* defaults,
  not 167 contract clauses — name them in the spec as "recommended emitted
  defaults, tracked to the spec-spine version pinned."

### Version pinning policy (resolving FR-005's pin question)

Single source of truth for the emitted `spec-spine` devDep pin: **the prebuilt
template's own `package.json`**. Because the npm shape's kernel *is* the prebuilt
template tree (copied wholesale by `perRequestScaffold.ts`), the pin the tenant
receives is whatever the warmed prebuilt template declares. That means:

- The pin is governed at the template (adapter source) level, exact-pinned
  (`"spec-spine": "0.1.0"`, not `^`/`~`), consistent with template today.
- `.kernel-version` records the resolved pin (read from the scaffolded
  `package.json`) so propagation/audit can see which CLI version a tenant was
  born under. This replaces 167's `factory_engine_version` as the load-bearing
  toolchain pin for the npm path (factory-engine no longer vends the toolchain).
- OAP does not independently re-pin; the adapter (template) owns the pin. The
  spec states this explicitly to avoid a two-source drift.

---

## Auto-fire placement

The central correction (S7): **emission's home is the statecraft Create flow,
not a `factory-engine` Rust transition.**

### Why not the factory-engine transition

167 §7 (spec.md:356–364) scopes the auto-fire as a `transition_to_*` hook in
`factory-engine` "before the first adapter write in Phase 2." But for npm
produced projects the live path never goes through that engine transition for
scaffold materialization — `create.ts` copies a prebuilt tree. Wiring
`emit_project_kernel` into `transition_to_scaffolding`
(`engine.rs:163–221`) would emit a *second*, OAP-flavoured, vendored-binary
kernel on top of the npm one — **silently** (E1 correction, Dev2): the
`refuse_existing_kernel` guard (`emit.rs:202–217`) checks exactly two markers,
`.kernel-version` and `specs/000-bootstrap-spec-system/spec.md`, and the
prebuilt corpus carries NEITHER (its bootstrap lives at the different slug
`specs/000-bootstrap/`, and no `.kernel-version` exists until PR 2's stamp).
So today the guard would NOT fire and the double-emission would land
unchallenged. The conclusion is therefore *stronger* than the earlier draft
stated: the engine path is not just dormant — wiring it would corrupt produced
projects undetected. PR 2's `.kernel-version` stamp incidentally turns the
guard into a real defence.

### Where emission actually belongs

Because the kernel ships *inside the prebuilt template tree*, "emission" in the
npm model is a property of the warmed template, copied to the project by
`scaffoldFromPrebuilt` (`perRequestScaffold.ts:82–88`, the `cpAsync` of the
prebuilt dir into `destDir`). The required wiring is therefore:

1. **Template-source obligation (primary).** The adapter's prebuilt template
   (template) MUST carry the full npm spine kernel (it already does, PR
   #56). The warmup path (`scheduler.ts` / `templateCache.ts`) materializes the
   prebuilt tree *including* `specs/`, `standards/spec/`, `spec-spine.toml`,
   `.github/workflows/spec-spine.yml`, and committed `.derived/`. Spec 167's
   FR-001 ("every produced project includes a populated kernel before any
   adapter code lands") is satisfied *by construction* because the kernel is the
   floor of the template.

2. **`.kernel-version` stamp (additive, the one new write).** The Create flow
   should write/refresh `.kernel-version` at scaffold time, recording the
   resolved `spec-spine` pin (from the scaffolded `package.json`), the adapter
   identity + manifest hash (already available in `create.ts` — `adapterRef`,
   `manifest`), the source SHA, and `toolchain_mode: pinned-toolchain` (per the E2
   consistency rule). Natural
   home: alongside `buildL0PipelineStateSeed` / `perRequestScaffold.ts`'s "drop
   the L0 seed" step (`perRequestScaffold.ts:121–129`), i.e. a sibling
   `buildKernelVersionStamp` helper writing `.kernel-version` into the tree
   before `gitInitAndPush`. This is the single mechanical addition to the live
   path. **Ownership (G4, Dev2):** the new helper is claimed by **167** via an
   `extends:` edge into the scaffold path (nature: additive, unit: the new
   helper file under
   `platform/services/statecraft/api/projects/scaffold/`) — `.kernel-version`
   is 167's concept; 112 receives the appended self-amend narrative entry but
   does not claim the file. Decided so PR 2 lands no orphaned unit. (It is small enough that it could even be a static file committed into
   the template, but generating it at scaffold time is better because the
   adapter identity + repo SHA are only known then.)

3. **Re-compile `.derived/` against the tenant corpus (optional, decision).**
   template commits `.derived/` built from its own corpus. If the
   produced project's corpus == the template's corpus verbatim (no per-project
   spec injection at scaffold time), the committed `.derived/` is already
   correct and no recompile is needed. If the Create flow injects/edits any spec
   (it currently does not — it only writes `.factory/pipeline-state.json`, which
   `spec-spine.toml`'s bypass floor ignores), a `spec-spine compile && index
   compile` pass is needed before commit #1. Recommendation: keep the no-inject
   invariant so the committed `.derived/` stays valid and the Create flow does
   *not* need the CLI at scaffold time. OQ-2 surfaces this.

### Relationship to spec 209 (do not collide)

Spec 209 (`specs/209-tenant-kernel-ci-enforcement/spec.md`, draft, depends_on
167/168/112) explicitly owns: making the seeded CI *enforcing* (fail-the-PR),
auto-firing kernel emission *and* certificate emission from pipeline
transitions, and verifying vended-tool integrity. **The 167 amendment must not
implement 209's enforcement leg.** The clean division:

- **167 amendment (WS5):** corrects the *distribution shape* (npm not vendored
  binaries) and *names the correct emission layer* (statecraft prebuilt path +
  `.kernel-version` stamp). It makes 167 describe reality.
- **209 (separate):** activates *enforcement* (advisory→blocking CI, cert
  auto-emit, tool-integrity verify). 209 already lists
  `extends: 167 … tenant-ci.yml.tmpl` — after the 167 amendment, 209's extend
  target may shift from the Rust template file to the npm `spec-spine.yml`
  shape. **And the repoint is bigger than an anchor move (G3, Dev2):** 209
  also carries `refines:` edges on `kernel_emission/emit.rs`
  (emission-auto-fire) and `version.rs` (vended-binary-integrity), and its
  "verify vended-tool integrity" leg presumes vendored binaries. Under the npm
  shape that leg becomes npm-pin / lockfile / package-provenance verification —
  a premise rewrite, not an anchor repoint. The 167 amendment's §6 cross-ref
  must say so explicitly so 209's owner re-derives that leg rather than
  mechanically repointing it. Same owner (bart); graph-truthful resolution
  either way: repoint/rewrite the claim rather than leave 209 extending a
  retired template.

---

## Spec-graph mechanics

### Amend in place, do not supersede

This is an **amendment**, not a supersession. 167's *decision* (every produced
project ships with a spine kernel; `.kernel-version` anchors propagation) is
unchanged and correct. Only the *distribution mechanism* (§2.2, §2.1.5, FR-005)
and the *emission layer* (§7) are corrected. Per `standards/spec/contract.md:28`:

> *"A spec may **amend** earlier specs in place… by carrying `amends: [<id>]`.
> Amended specs carry `amended: <date>` and `amendment_record: <amender-id>`
> plus an in-body callout. This is distinct from supersession."*

There are two viable structures:

- **(A) Self-amendment of 167.** 167 amends *itself* (the established precedent
  on spec 112, which carries multiple dated `self-amended` entries in its
  `amendment_record`, and on spec 075). **E3 correction (Dev2):** 167's
  frontmatter today has `amended: "2026-05-23"` but **no** `amendment_record:`
  field at all — the spec-178 amendment exists only as a body section dated
  2026-05-24, mismatching the frontmatter date. Per `contract.md:28` (amended
  specs carry BOTH fields) 167 is currently slightly non-conformant. PR 1
  therefore **introduces** `amendment_record:` (seeding it with the
  reconstructed 178 entry, reconciling the 05-23/05-24 date discrepancy in
  favour of the body's dated record) and appends the new `2026-06-11`
  self-amend entry; plus a new in-body `> **Amended (2026-06-11), self.**`
  callout above §2.2. No new spec id is minted. **Recommended** — the change
  is a correction of 167's own design to match shipped reality, exactly the
  self-amendment shape.

- **(B) A new amending spec** (e.g. a WS5-numbered spec) carrying
  `amends: ["167"]`, with 167 receiving the `amended:`/`amendment_record:`
  callout pointing at it. Heavier; warranted only if Bart wants a standalone
  artifact for the npm-reconciliation decision. Given 209/203 already exist as
  the forward-looking specs, minting another feels like spec-sprawl.

**Recommendation: (A) self-amendment**, unless Bart prefers a named record
(OQ-3).

### Append, don't introduce, on 075/112/168

Per the task constraint and the live frontmatter:

- **075** already carries `amended:`/`amendment_record:` (amender 199,
  `specs/075-factory-workflow-engine/spec.md:23–34`). If the implementation PR
  touches `engine.rs`/`lib.rs` (167's `extends:` targets on 075), the 075 record
  gets a **new appended** entry — it does not introduce the fields. But note: if
  the amendment *retires* the engine auto-fire idea (S7) rather than wiring it,
  075 may not need a code touch at all. Likely 075 is untouched by the spec-only
  amendment PR.
- **112** already carries `amended:`/`amendment_record:` with multiple
  self-amend entries (`specs/112-factory-project-lifecycle/spec.md:6+`). The
  *implementation* PR that adds the `.kernel-version` stamp to `create.ts`/
  `perRequestScaffold.ts` will touch 112's territory → **append** a dated
  self-amend entry to 112's `amendment_record` describing the kernel-version
  stamp addition to the Create flow. 112 is the spec that should grow the
  "Create flow writes `.kernel-version`" clause.
- **168** is `implementation: complete` and `extends: 167` on the
  `kernel_emission/*` files. The 167 amendment must **not** regress 168's
  `.factory/toolchain.yaml` / `certificate_toolchain` additions
  (`version.rs:23–48`, `emit.rs:134–152`). If the implementation PR rewrites the
  kernel templates, 168's `establishes: toolchain.yaml.tmpl` and its
  `certificate_toolchain` round-trip tests are coupled — touching them appends a
  168 self-amend entry. Keep the toolchain.yaml concept; it maps cleanly onto the
  npm shape (the `.factory/toolchain.yaml` can record the pinned `spec-spine`
  CLI version instead of loose binary paths).

### Coupling-gate consequences

- **Spec-only amendment PR** (167 self-amend + appended callouts on 075/112/168
  if their narrative references the vendored-binary shape): touches only
  `specs/*/spec.md` files. The codebase-indexer hashes `specs/*/spec.md`
  (per CLAUDE.md `collect_input_files`), so editing 167's `spec.md` changes the
  index hash → the PR must regenerate the index (`make pr-prep`). No code files
  change, so the coupling gate sees spec-only churn — clean.
- **Implementation PR(s)** touch `crates/factory-engine/templates/kernel/*`
  (retire/rewrite `tenant-ci.yml.tmpl`), `crates/factory-engine/src/kernel_emission/*`
  (retire vendored-binary emission OR repoint to npm shape), and statecraft
  `create.ts`/`perRequestScaffold.ts` (add `.kernel-version` stamp). These are
  167/112/168 territory. Per the memory note on graph-truthful resolution and
  the spec-code coupling gate: **the spec amendment and the code change that
  retires the vendored templates should be coordinated so the owning spec (167)
  reflects the retirement before/with the code retirement** — do not land code
  that deletes `tenant-ci.yml.tmpl` while 167 still establishes it
  (spec.md:30 `establishes: tenant-ci.yml.tmpl`). If the template file is
  renamed/replaced, 167's `establishes:` block must be updated *in the same PR*
  as the file move (the coupling gate enforces establishes-target existence).
  This is the standard "both must land together" pitfall — the spec-only PR
  cannot delete the `establishes:` row without the code PR, and the code PR
  cannot delete the file without the spec edit. **Sequence: spec-only amendment
  PR narrates the intent and the appended callouts but keeps `establishes:`
  rows pointing at still-present files; the implementation PR does the file
  swap AND the `establishes:` repoint atomically.**
- **featuregraph golden** (`crates/featuregraph/tests/golden/features_graph.json`,
  167's `extends: 034`): if any 167 frontmatter relationship edge changes
  (e.g. `establishes:` rows repointed), the golden must be regenerated
  (`UPDATE_GOLDEN=1`) in the same PR — this is a required CI gate (per the
  spec-178 amendment precedent in 167 itself, spec.md:389–397, and the
  pre-push memory note).

---

## Phasing

**PR 1 — Spec-only amendment (167 self-amend).** No code.
- Edit `specs/167-born-with-spec-spine-kernel/spec.md`:
  - **Introduce** `amendment_record:` (E3 — the field does not exist today):
    seed with the reconstructed spec-178 entry (reconciling the frontmatter
    `amended: 2026-05-23` vs body `2026-05-24` date mismatch), then the new
    `2026-06-11` self-amend entry; bump `amended:` to `"2026-06-11"`.
  - Add an in-body `> **Amended (2026-06-11), self.**` callout above §2.2.
  - **Flip `implementation: complete` → `in-progress`** (G1): after PR 1 the
    spec describes the npm shape while landed code still implements vendored
    emission — leaving `complete` standing would be the backfill smell this
    plan otherwise avoids. The §7 re-narration carries the matching dated
    "contract amended ahead of implementation; code swap lands in the
    follow-up PR" line. (Golden consequence: an `implementation:` flip shifts
    the featuregraph golden — regenerate in PR 1; 167 already extends 034 on
    the golden, so the regen is coupling-clean.)
  - Rewrite §2.1 to add `spec-spine.toml` + npm devDep to kernel contents (S5);
    §2.1.2/2.1.3 to "template-appropriate standards + tenant-compiled `.derived/`"
    (S4); §2.2 to retire vendored binaries → npm pinned devDependency (S1);
    §2.1.5 to the `spec-spine.yml` / `npx spec-spine couple` shape (S2); FR-005
    to the single pinned-toolchain (npm devDep) mode with the mode field
    preserved (S3 + E2); §7 to re-narrate the implemented-then-superseded
    distribution mechanism (S8); §6 cross-refs to add spec-spine npm package +
    specs 209/203 (incl. the G3 premise-rewrite note) + 112 Create flow.
  - **Sweep every FR/SC (G2)** — also stale beyond the list above: FR-002
    ("pre-compiled from the kernel specs"), FR-004/§2.1.6 (gated on OQ-1 but
    the decided position must land in PR 1), FR-008 ("tenant-resident or
    pinned-toolchain binaries"), FR-009 (deterministic emission re-anchors to
    prebuilt-template content + a stamp whose `emitted_at`/source SHA
    legitimately vary — "hash-equal `.kernel-version`" must be reworded), and
    SC-001 (names retired `acme-vue-node`). Audit the full FR/SC list during
    authoring; do not stop at the S1–S8 anchors.
  - Keep all `establishes:` rows pointing at still-present files (the template
    swap happens in PR 2).
- Append dated self-amend callouts to 112/168 **only if** their narrative text
  references the vendored-binary shape (audit during authoring; likely a light
  touch or none for the spec-only PR). 075 is most likely untouched (G5).
- Run `make pr-prep` (regenerate index — `spec.md` edits change the hash) and
  regenerate the featuregraph golden (required by the G1 implementation flip;
  also if any relationship edge changed).

**PR 2 — Implementation: statecraft `.kernel-version` stamp + template
retirement.** Code, riding 112/167/168.
- Add `buildKernelVersionStamp` (sibling of `seedPipelineState.ts`, actual
  path `platform/services/statecraft/api/projects/scaffold/`) and write
  `.kernel-version` into the scaffold tree in `perRequestScaffold.ts` before
  push; thread adapter identity from `create.ts`. The stamp records
  `toolchain_mode: pinned-toolchain` (E2). **167 claims the new helper** via
  an added `extends:` edge (G4); 112 gets the narrative self-amend only.
- Retire/rewrite `crates/factory-engine/templates/kernel/tenant-ci.yml.tmpl`
  to the npm `spec-spine.yml` shape (or delete it if the template-source owns
  CI emission); repoint 167's `establishes:` row atomically; regenerate golden.
- Decide the fate of `kernel_emission/{emit,gather,adapter_specs,templates}.rs`
  vendored-binary code: retire or repurpose-as-fallback per OQ-1. If retired,
  167's `establishes:` units for those files must be removed in the same PR (or
  repointed) — coupling-gate coupled.
- Append the dated self-amend entry to 112 (Create flow now writes
  `.kernel-version`) and to 168 if its templates moved.
- `make ci-strict` before merge (touches Rust + statecraft + specs).

**PR 3 (optional, hand to 209 owner) — enforcement activation.** *Not WS5.*
209 makes the seeded CI blocking and auto-emits certificates; flagged here only
so its `extends: 167 tenant-ci.yml.tmpl` anchor is repointed after PR 2 swaps
the template.

---

## Open questions

- **OQ-1 (seed corpus theory).** Does born-with seed (a) the full born-clean
  corpus that travels with the prebuilt template (the proven template
  path), or (b) the single synthetic `scaffold-claim` draft from
  `adapter_specs.rs`? Plan's recommendation: (a) primary, (b) retained as a
  code fallback. **Dev2's leaner read:** tie to OQ-6 — retire the generator
  (git history preserves it) and document the fallback CONCEPT in spec text
  only; no corpus-less adapter exists and the no-compat-concerns posture
  applies. **RESOLVED (Bart, 2026-06-11): retire the generator** — PR 2
  deletes `build_scaffold_claim_spec`; the corpus-less-adapter fallback
  survives as spec-text concept only. PR 1's §2.1.6/FR-004 rewrite encodes
  this position.

- **OQ-2 (`.derived/` at scaffold time).** Keep the no-spec-injection invariant
  (Create flow writes only `.factory/*`, never a `specs/*` file) so the prebuilt
  template's committed `.derived/` stays valid and the Create flow needs no CLI
  run? Or allow per-project spec injection at scaffold time (requiring a
  `spec-spine compile && index compile` pass before commit #1)? Recommendation:
  keep the invariant — Dev2 strongly agrees (keeps the Create flow CLI-free
  and the committed `.derived/` valid). **Confirm.**

- **OQ-3 (amendment structure).** Self-amend 167 in place (recommended), or mint
  a new WS5-numbered amending spec carrying `amends: ["167"]`? Given 209/203
  already exist, self-amend avoids spec-sprawl. Dev2 agrees (with the E3
  correction: PR 1 *introduces* `amendment_record:`, it does not append).
  **Confirm preference.**

- **OQ-4 (`ToolchainMode` enum).** Re-document `PinnedToolchain` as the npm mode
  and deprecate `VendorBinaries` (no serde change, recommended), or add a new
  `NpmDevdependency` variant + default (touches spec-168 fixtures)? Spec-level
  recommendation is the no-change path (option 1) — Dev2 agrees, contingent on
  the E2 consistency rule (the stamp then writes `pinned-toolchain`).

- **OQ-5 (devDep pin source + v0.2.0 timing).** Confirm the pin is owned by the
  adapter/template `package.json` (single source of truth), exact-pinned, with
  `.kernel-version` recording the resolved value. And confirm whether the
  implementation PR should land against the currently-published `spec-spine`
  `0.1.0` (what `spec-spine` and template are at
  today) and *follow up* for 0.2.0's `auto_waive_dependency_only` +
  governance-projection defaults — since v0.2.0 is not yet present in the
  spec-spine checkout. Recommendation: land against the published version at
  PR-time; do not hard-code `0.2.0` in the spec. Dev2 agrees (template
  package.json owns the pin).

- **OQ-6 (factory-engine vendored-binary code disposition).** When the
  vendored-binary `kernel_emission` path is superseded, do we (a) delete it,
  (b) keep it behind a documented `vendor-binaries` mode for non-npm adapters
  (rust-axum-style produced projects that have no npm), or (c) keep as
  reference? This matters because not every future adapter is npm-shaped — a
  Rust-produced project would want a Cargo/`spec-spine` (cargo-installed) shape,
  not an npm devDep. The npm shape is correct for the *current* adapter
  (acme-vue-encore); the spec should say "npm distribution for npm-shaped
  adapters; the distribution shape is adapter-determined" rather than "npm
  always." **This is the deepest design question** — it decides whether 167
  becomes "npm-only" or "distribution-shape is per-adapter, npm is the first
  realized one." Recommendation: the latter (keep §2.2's pluralism but make npm
  the canonical/only-implemented mode), which preserves room for a future Rust
  adapter without re-amending 167.
