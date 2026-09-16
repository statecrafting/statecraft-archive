# acme-vue-encore: the generator/product split and the born-with line

> Directional decision record. Lives in `docs/analysis/` for now; it is
> directional rather than analytical, so reclassify it to an ADR (or
> `docs/` root) on the next docs cleanup. Date: 2026-06-23. Companion to
> [`factory-encore-sync-current-state.md`](./factory-encore-sync-current-state.md),
> which established the current-state mechanics this record acts on.
>
> Status: **agreed direction.** Execution is handed to the working
> sessions in `statecrafting/factory-encore` and
> `statecrafting/template-encore`; the per-repo handoffs are derived
> from this record.

---

## 0. One-paragraph thesis

The meaningful boundary in the factory/template system is **create-time
(the generator) vs runtime (the product plus its born-with harness)**,
and that boundary cuts across the current repo split rather than along
it. Today `template-encore` wears two hats: it is both a runnable
reference app and the generator that scaffolds copies of itself. Splitting
those hats (generator into the factory, lean product plus born-with
harness staying as the public reference app) makes three boundaries
coincide that are currently tangled: create-time/runtime,
stack-agnostic/stack-specific, and the (now moot, both-public) visibility
seam.

## 1. Decisions locked

1. **Both `factory-encore` and `template-encore` are public.** Consumers
   may use them privately; that is their choice, not a constraint we
   impose. No secrecy-driven fork-parameterization of the scaffold seam is
   required; the scaffold source can be a plain public reference.
2. **Product identity is `acme-vue-encore`.** Folder names are not the
   naming convention; the `-encore` suffix is just the stack. The factory
   adapter manifest's `adapter.name` moves from `encore-vue` to
   `acme-vue-encore`, matching the OAP corpus and statecraft's lookup key.
3. **The generator (`scripts/` + `modules/`) moves from `template-encore`
   to `factory-encore`** (into the adapter). The produced app never
   re-scaffolds itself, so the generator does not belong in the product.
4. **Materialization changes from "copy superset then trim" to "lean
   baseline + compose."** The product is a clean baseline; the factory
   composes modules in per Build Spec. Composing up beats trimming down.
5. **Generator-governing meta-specs move with the generator into
   `factory-encore`, which adopts spec-spine** to govern its now-code
   surface (generator + module catalog) and gains CI on the OAP resilient
   pattern. App-describing specs stay with the product as born-with specs.

## 2. The principle: create-time vs runtime

```
GENERATOR  (create-time; produces apps; must NOT ship into them)
   = scripts/  +  modules/  +  the from-Build-Spec transformation skills
     (analyze / configure / trim)  +  FAC-S* gates  +  generator meta-specs
   -> FACTORY (factory-encore, inside the acme-vue-encore adapter)

PRODUCT + BORN-WITH HARNESS  (runtime; ships with every produced app;
                              self-sufficient for ongoing agentic dev)
   = apps/ + packages/ + docker/ + config
     +  standards/ + spec-spine.toml + seeded app-specs (the born-with kernel)
     +  .claude/ dev skills (scaffold-feature, code-quality)
     +  CODEMAP.md
   -> PRODUCT (template-encore, the public acme-vue-encore reference app)
```

`orchestration/` itself splits along this line:

- **From-spec skills** (`analyze`, `configure`, `trim`) shape the initial
  app from a Build Spec at create time -> factory/adapter.
- **Dev skills** (`scaffold-feature`, `code-quality`) are used forever
  after, by a human or by OPC working offline -> born-with the product,
  relocated into `.claude/skills/`.
- **`validate`** splits: template-quality checks (0..15) ship born-with;
  the `FAC-S*` boundary and traceability gate stay factory-side.
- **`template-orchestrator.md`** is the create-time orchestration of this
  stack -> factory/adapter (it becomes the adapter's build orchestration).

## 3. What moves where

| Artifact (today in template-encore) | Target | Why |
|---|---|---|
| `scripts/` (+ `scripts/lib/`, tests) | factory-encore adapter | create-time generator |
| `modules/` (catalog + manifests + files) | factory-encore adapter | parts the generator composes; stack-specific |
| `orchestration/` from-spec skills (analyze, configure, trim) | factory-encore adapter | create-time variant shaping |
| `orchestration/template-orchestrator.md` | factory-encore adapter | create-time build orchestration |
| `orchestration/` dev skills (scaffold-feature, code-quality) | template-encore `.claude/skills/` | ongoing dev; born-with |
| `orchestration/validate` | SPLIT: checks 0..15 -> template `.claude`; FAC-S* -> factory | quality is the product's, gates are the factory's |
| generator/module meta-specs (e.g. 007..010, 020) | factory-encore `specs/` | they govern the generator |
| app-architecture/invariant specs (001, 002) | stay in template-encore as born-with app-specs | they describe what the app IS |
| `apps/`, `packages/`, `docker/`, root config | stay in template-encore | the product |
| `standards/`, `spec-spine.toml`, `.claude/` | stay in template-encore; new copy stood up in factory-encore | both repos are now governed |

## 4. Sorting rules (apply locally, do not hand-assign every file from here)

- **Specs:** a spec that describes the generator or the module system ->
  factory. A spec that describes the produced app's architecture or
  frozen invariants -> stays with the product as a born-with app-spec. The
  invariant specs (001 architecture, 002 security/data) are the *contract*
  between generator and app: the generator must produce apps that satisfy
  them, the app must maintain them. Recommendation: the product keeps
  001/002; the factory adapter pins their content hashes via a lockstep
  check so the generator cannot drift from the app's frozen invariants.
  Meta-spec removal is **supersession with content relocation, not
  deletion**: a generator meta-spec that a KEEP spec references (e.g. 005
  ceding FR-004 wiring to 010) must have its still-load-bearing content
  migrated into the product spec that depends on it before the meta-spec
  leaves, so the corpus stays referentially honest (CONST-005). Bare
  deletion that leaves dangling `path:line` references is a spec/code
  coherence violation, not a clean move.
- **Orchestration skills:** if a skill needs a Build Spec or references
  `FAC-S*` / pipeline stages, it is create-time -> factory. If it is pure
  Vue+Encore/ESLint/TS knowledge usable with no factory present, it is
  dev-time -> born-with the product.

## 5. Two-phase, two-repo plan

The product must stay green and runnable throughout (it is the public
reference). Sequence:

- **Phase 1 (factory-encore):** stand up spec-spine substrate + CI
  (package.json, vitest, tsx, `spec-spine` pin, `standards/`,
  `spec-spine.toml`, the OAP resilient ai-pr-review + ci-gate pattern).
  Bring the generator (`scripts/` + `modules/`) and its meta-specs in.
  Rename the adapter to `acme-vue-encore`. Reimplement the generator as
  "lean baseline + compose" cloning the template-encore baseline. Get
  factory CI green with the generator authoritative there.
- **Phase 2 (template-encore):** once the factory generator is
  authoritative, remove `scripts/` + `modules/` + generator meta-specs
  from the product. Relocate the dev skills (scaffold-feature,
  code-quality) into `.claude/skills/`. Strip the factory-pipeline framing
  from `orchestration/` (it left for the factory). Seed born-with
  app-specs describing the app. Rename identity to `acme-vue-encore`. The
  `EXCLUDED_TOP_LEVEL` decision is now moot here: the product is the
  baseline, not a self-generator; what a produced app carries is the
  factory generator's concern.
- **Phase 3 (handshake):** a lockstep CI check (the OAP spec-212 pattern)
  binds the factory generator and module catalog to the template baseline
  structure and the 001/002 invariant hashes. Build the mechanism in
  Phase 1, but pin the 001/002 hashes only here, after Phase 2 finalizes
  those specs. Phase 2 must edit 001 to absorb wiring orphaned by the
  meta-spec removal (see the supersession rule in section 4), so pinning
  earlier would lock a hash that is about to change. This keeps the
  directional `factory -> template` pointer enforceable instead of prose.
  Pin against template-encore's **merged main** ref, so Phase 2 must push
  and merge first. Factory Phase 1 may merge independently with the pin
  deferred (its lockstep is green in the deferred state); the Phase 3 pin
  is then a small follow-up commit on the factory that sets the 001/002
  hashes and `pinnedRef` to template-encore's new main SHA.

## 6. Why the line is meaningful (the test applied)

Keeping the two repos separate is justified only because, after this
restructure, the repo line coincides with three real boundaries at once:

- **create-time vs runtime** (generator vs product+harness),
- **stack-agnostic vs stack-specific** (the factory pipeline is agnostic;
  the adapter and product are Vue+Encore-specific),
- **independent reuse** (one factory can drive other baselines; the
  product is one public reference instance).

Collapsing them would re-tangle all three and destroy the standalone
property of the product. The visibility seam (public methodology vs
private product) is no longer load-bearing because both are public, but
the other two boundaries are, so the line stays.

## 7. Open items to confirm during execution

1. **Baseline location.** Recommended (A): the baseline app is authored in
   template-encore; the factory generator clones it and composes modules.
   Template stays the human-maintained lean app. (Alternative (B):
   template becomes a generated output checked in for reference; rejected
   for now because consumers fork the product directly.)
2. **001/002 home.** Recommended: born-with the product, hash-pinned by
   the factory via lockstep. Confirm during the spec-sorting pass.
3. **Module baseline membership.** Decide which current modules are core
   (ship in the lean baseline: auth, gateway, health, db, security-core)
   vs composable extras (user-management admin views, the connectivity
   test). The generator composes the extras.
