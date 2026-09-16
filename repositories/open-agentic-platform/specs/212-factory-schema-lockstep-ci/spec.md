---
id: "212-factory-schema-lockstep-ci"
title: "Factory Schema Lockstep CI (cross-repo contract parity, automated)"
feature_branch: "feat/212-factory-schema-lockstep-ci"
status: approved
implementation: complete
kind: governance
domain: tooling
created: "2026-06-11"
amended: "2026-06-23"
amendment_record: |
  self-amended (2026-06-12) — comparison-model correction, implementation PR.
  A full file-by-file diff against the pinned ref (factory@cc1139f)
  falsified the original FIELD-LEVEL structural-parity premise for three of
  the ten lockstep files: adapter-manifest.schema.yaml is adapter-specialised
  by design (spec 197 FR-007 explicitly scoped its richer command/convention
  set out), and build-spec.schema.yaml + stage-outputs/sitemap.schema.json
  carry factory-side ADDITIVE evolution (workspace_id, the larger page_type
  catalog). Spec 197 AC-8 only verified the narrow 1.1.0 delta
  (provisioning_model + implementation_status), not whole-file parity.
  §"Semantic diff", §"The lockstep set", FR-001, AC-1, AC-2 are rewritten to a
  three-mode comparison (exact parity / directional floor / section-scoped
  directional floor) that is true at the pin and still falsifiable. Adds
  pinned_ref and the establishes: edges for the tool + two lanes + fixtures.
  implementation flipped pending → in-progress.

  self-amended (2026-06-12, second) — dual_stack joins the section scope;
  implementation closes. A live OPC adapter-load failure proved dual_stack is
  cross-repo contract surface, not an adapter-determined detail: OAP's mirror
  (and its Rust parser + consumer) sat on the legacy stack model
  (audience_to_stack/stacks) while factory's manifest had moved to the
  variant model (audience_to_variant/variants) — drift the gate could not see
  because §"The lockstep set" excluded dual_stack from the section-scoped
  compare. PR #344 realigned all three OAP artifacts to the variant model;
  this amendment widens the gate's adapter-manifest scope to {schema_version,
  governance, dual_stack} so that drift class fails CI from now on.
  §"The lockstep set", FR-001, and AC-2(c) are updated in lockstep with the
  tool's include_top_keys. implementation flipped in-progress → complete
  (evidence in §Implementation log).

  self-amended (2026-06-23, third): pin bump + name-agnostic reshape. The
  upstream contract source was rebuilt clean-room and the
  UPSTREAM_FACTORY_SOURCE variable repointed (2026-06-21); pinned_ref moves
  cc1139f -> 427f499, the current upstream contract commit, re-verified in
  lockstep here (parity holds on every mode). The spec's live-mechanism prose
  is de-named: repo identity (org-qualified paths, repo@ref syntax) is
  operational config resolved from UPSTREAM_FACTORY_SOURCE, not spec truth, so
  a future rename is a zero-spec-edit variable flip and only a clean-room
  content change bumps the pin (this one). Adds §"Upstream source identity is
  operational, not spec truth". Five stage-output schema titles are
  de-em-dashed (em-dash to hyphen) to restore exact parity with the upstream
  mirror and clear a house-style violation; no contract-shape change. Dated
  historical verification notes (@cc1139f) are left intact as records.

  self-amended (2026-07-08, fourth): pin bump for the spec 210 agentic_posture
  contract mirror. OAP's build-spec.schema.yaml gains the top-level
  agentic_posture object (spec 210 FR-001, schema 1.1.0 -> 1.2.0), a Floor-mode
  file, so the upstream factory contract must mirror it; factory-encore#21 adds
  the same field + version bump. pinned_ref moves 427f499 -> a87daf6, the
  upstream commit carrying the mirror, re-verified in lockstep here (Floor
  parity holds on every mode). No lockstep-set or compare-mode change.
# The upstream-contract ref the PR lane checks against; the repo itself is
# resolved operationally from the UPSTREAM_FACTORY_SOURCE variable, not named
# here (see §"Upstream source identity is operational, not spec truth").
# Bumping it is a coupling-gated spec edit (FR-007). Re-verified in lockstep at
# this SHA 2026-07-08 against the configured upstream source (the spec 210
# agentic_posture contract mirror, factory-encore#21); the prior pin (427f499)
# was verified 2026-06-23, and cc1139f 2026-06-12 (spec 197 AC-8 / spec 198).
pinned_ref: "a87daf6f642cc16ff3c40937019a27c3fe2d55dc"
authors: ["open-agentic-platform"]
language: en
summary: >
  Spec 197 declares the factory Build Spec an open standard that the owned
  upstream source mirrors, and spec 197 AC-8 / spec 198 both verified that
  mirror BY HAND ("verified directly against factory origin/main @ cc1139f").
  A hand diff is not a gate: the next upstream-source edit, or the next OAP
  schema bump, can silently diverge the two contract surfaces and nothing
  fails. This spec automates the lockstep: an OAP-side enforcing CI job that
  fetches the configured upstream source's contract/schemas/** at a committed
  pin and asserts structural agreement against standards/schemas/factory/**
  under a three-mode comparison (exact parity for the shared surface; a
  directional floor where OAP fields must persist on the upstream side but
  upstream additions pass; a section-scoped floor for the adapter-specialised
  manifest). Byte-equality is impossible: the surfaces carry divergent
  comments, additive evolution, and adapter-specific sections by design. A
  spec-197 FR-005 guard additionally asserts no GoA-specific concept entered
  either contract surface. Two lanes: a PR-time check against the committed
  pin, and a scheduled check against the upstream source @ main that catches
  upstream drift the pin hasn't yet absorbed. The upstream source stays
  gate-free (spec_spine: false); enforcement is unidirectional, OAP-side.
code_aliases: ["FACTORY_SCHEMA_LOCKSTEP_CI"]
compliance:
  - framework: "owasp-asi-2026"
    controls: ["ASI07"]
establishes:
  # The cross-repo lockstep checker (FR-001/FR-002). A new Rust crate under
  # tools/oap/, modelled on ci-parity-check (NOT the JS schema-parity-check).
  - unit: { kind: directory, path: tools/oap/factory-schema-lockstep }
  # The two CI lanes (FR-003 PR-time, FR-004 cron). Same establishes shape
  # spec 191 used for ci-schema-parity.yml.
  - unit: { kind: file, path: .github/workflows/ci-factory-schema-lockstep.yml }
  - unit: { kind: file, path: .github/workflows/ci-factory-schema-lockstep-cron.yml }
  # The ci-parity-check aligned/divergent fixtures proving the run-mirror
  # detects drift (FR-006 / AC-7) — same precedent as spec 191's fixtures.
  - unit: { kind: file, path: tools/oap/ci-parity-check/tests/fixtures/aligned/.github/workflows/ci-factory-schema-lockstep.yml }
  - unit: { kind: file, path: tools/oap/ci-parity-check/tests/fixtures/divergent/.github/workflows/ci-factory-schema-lockstep.yml }
extends:
  # The spec-177 orchestrator gains a route dispatching the new job, the
  # same shape spec 191 used for ci-schema-parity.
  - spec: "177-ci-orchestrator-pr-gate"
    nature: additive
    unit: { kind: file, path: .github/workflows/ci.yml }
  # The new workflow is classified enforcing in ci-parity-check's
  # ENFORCING_WORKFLOWS so the Makefile↔CI run-mirror covers it (spec 104).
  - spec: "104-makefile-ci-parity-contract"
    nature: additive
    unit: { kind: file, path: tools/oap/ci-parity-check/src/lib.rs }
  # The aligned ci-parity-check fixture Makefile gains a mirroring recipe so
  # the new enforcing workflow's run-mirror fixture stays green (104 owns the
  # ci-parity-check crate subtree via package metadata; this is additive).
  - spec: "104-makefile-ci-parity-contract"
    nature: additive
    unit: { kind: file, path: tools/oap/ci-parity-check/tests/fixtures/aligned/Makefile }
  # Same precedent as specs 196, 194, 193, 187, 183 and the 202–211 batch:
  # a new spec adds a row to the featuregraph golden.
  - spec: "034-featuregraph-registry-scanner-fix"
    nature: additive
    unit: { kind: file, path: crates/featuregraph/tests/golden/features_graph.json }
co_authority:
  # The root Makefile gains a `factory-schema-lockstep` target group (the
  # `## tag: factory-schema-lockstep` section) wired into the ci-strict family.
  # 104 is the omnipresent Makefile-parity co-author (same shape spec 116 uses
  # for its `supply-chain` anchor). This makes 212 a Makefile claimant so its
  # own spec edit satisfies the coupling gate for the target + ci-strict wiring.
  - with_specs:
      - "104-makefile-ci-parity-contract"
    unit: { kind: section, file: Makefile, anchor: factory-schema-lockstep }
references:
  # The open-standard contract whose cross-repo mirror this gate makes
  # falsifiable. Spec 197 AC-8 is the manual check this automates; its FR-005 is
  # the GoA-concept rejection this asserts mechanically. This spec does not
  # reshape 197's contract surface — it watches it — so this is a reference,
  # not an extends.
  - role: gate-declaration
    unit: { kind: file, path: specs/197-factory-contract-open-standard-extensions/spec.md }
  # The canonical schema set under lockstep. This gate reads these files; it
  # does not author or own them (specs 074/197/198 do).
  - role: context
    unit: { kind: directory, path: standards/schemas/factory }
  # The sibling cross-Rust↔TS parity tool whose CI wiring shape (spec 191)
  # this job mirrors — but whose fingerprint walker it does NOT reuse (that
  # tool never parses standards/schemas/factory/*.yaml; see §4).
  - role: context
    unit: { kind: directory, path: tools/oap/schema-parity-check }
  # The original owned upstream source that seeded this lockstep's far side.
  # The live source is now resolved operationally from UPSTREAM_FACTORY_SOURCE
  # (see §"Upstream source identity is operational, not spec truth");
  # spec_spine: false by declaration (upstream-map.yaml), so no gates run there
  # and this check is the OAP-side enforcement. Retained as a historical
  # reference, not the live target.
  - role: historical
    unit: { kind: directory, path: factory }
---

# Feature Specification: Factory Schema Lockstep CI

**Feature Branch**: `212-factory-schema-lockstep-ci`
**Created**: 2026-06-11
**Status**: Draft (WS4 of the OAP gap-closure pass)
**Input**: Spec 197's FR-006 promises the canonical YAML schema and the
owned upstream source stay "in lockstep", and AC-8
records that lockstep as *verified* — but the verification note reads
"verified directly against factory `origin/main` @ `cc1139f`",
i.e. a one-time manual diff. Spec 198 §AC closes the first sealed
admission for the owned upstream source and likewise leans on a
hand check. The lockstep that two approved specs depend on has never been
gated. This spec is that gate.

## Purpose

The factory Build Spec contract is an open standard (spec 197 FR-001):
OAP authors it under `standards/schemas/factory/**`, and the upstream
source mirrors it under `contract/schemas/**` because the owned factory consumes
the same contract OAP defines. Two approved specs assert the two surfaces
are identical, and both verified it by eye on a specific SHA.

A hand diff decays the instant either side moves. The upstream source is
`spec_spine: false` by declaration (`upstream-map.yaml`) — it runs **no**
spec-spine gates, by design, because it is plain OAP-conformant content,
not a governed spine. So the only place this lockstep can be enforced is
OAP's CI, looking outward. Without that, the failure mode is exactly the
one OAP's gates exist to prevent: a contract claim (spec 197 AC-8) that
was true at one commit and quietly stops being true one edit later, with
no signal. The same covenant-without-a-gate decay specs 209/211 name for
OAP's own verification loop, applied to the cross-repo contract surface.

This is **ASI07 (Insecure Inter-Agent / Inter-Component Communications)**
applied across the repo boundary: the factory and OAP exchange a typed
contract, and a silent skew on either side breaks that contract the same
way a duplex envelope-version skew breaks the desktop↔server stream
(spec 189). Spec 198 already credits schema-parity (125/191) for ASI07 on
the Rust↔TS axis; this closes the third axis — OAP↔factory.

It is scoped to a **gate over existing artifacts**. It adds no new contract
field and changes no schema; it asserts that two already-authored surfaces
agree, and that neither has acquired a GoA-specific concept spec 197 FR-005 forbids.

## Why not extend the existing schema-parity-check (§4 of the design)

The instinct is to extend `tools/oap/schema-parity-check` (specs 125/191).
It does not fit. That tool compares a **statecraft TypeScript** descriptor
(`SchemaNode`, walked by `walk-descriptor.mjs`) against a **Rust**
fingerprint emitted by `crates/factory-contracts` during `cargo test`. It
never reads `standards/schemas/factory/*.yaml` — its inputs are `.ts`
modules and `.derived/schema-parity/*.json`, and it requires a TS runtime
(bun) precisely to import those modules. Cross-repo YAML↔YAML parity shares
none of that machinery: no Rust fingerprint, no TS import, no descriptor
export. Bolting a YAML-vs-YAML mode onto it would mean a second,
unrelated comparison engine wearing the same name, and would entangle the
spec-191 `schema_parity` route (scoped to `factory-contracts` + statecraft
`knowledge/governance/sync`) with a route that has nothing to do with
those paths. A **separate, focused check** with its own route and its own
`ENFORCING_WORKFLOWS` entry is cleaner and keeps spec 191's gate
single-purpose. (Decision; the alternative — generalize the existing tool —
is recorded and rejected here.)

## Key design positions

### Upstream source identity is operational, not spec truth

What this gate enforces is **contract structure** (the schema shape and the
folder layout of `contract/schemas/**`), not the identity of the repository
that carries it. The repo is resolved at runtime from the
`UPSTREAM_FACTORY_SOURCE` Actions variable (today
`statecrafting/factory-encore`); the spec deliberately does not name it. The
name is irrelevant: today it is `factory-encore`, tomorrow it may be `factory`
again, and the gate behaves identically either way as long as the schema set
and folder structure agree.

Two consequences follow, and they are the whole point of this section:

- **A rename is a zero-spec-edit change.** If the upstream repo is renamed
  (same git history), the `pinned_ref` SHA stays valid and only the variable
  flips: no spec edit, no coupling-gate fire. Repo identity lives in
  operational config, where churn belongs.
- **Only a clean-room content change bumps the pin.** A brand-new contract
  source with fresh history (as the 2026-06-21 `factory-encore` rebuild was)
  changes the SHA, so `pinned_ref` moves. That is precisely the case worth a
  visible, coupling-gated review (FR-007): a new contract source is itself a
  contract-surface event.

Accordingly the prose below speaks of "the configured upstream source" and
"the upstream source @ main" rather than a hardcoded repo path. Dated
historical notes (e.g. "verified @ `cc1139f`") keep their original repo
wording because they record what was true at a past commit, not the live
mechanism.

### Pin source — two lanes (committed pin + cron against main)

**Decision: a committed pin file lives in OAP, read at PR-time; a second
scheduled lane checks the upstream source @ main directly.**

The admitted `factory_sha` (spec 198) lives in the deployed statecraft DB,
which CI cannot reach — rejected as the pin source. Three viable homes for
a committed pin were weighed:

1. **A standalone pin file** (e.g. `factory/factory.pin`) — rejected:
   a bare ref in a non-markdown file is exactly the standalone-data channel
   the constitution Principle I forbids for authored truth.
2. **This spec's own frontmatter** — a single `pinned_ref` field carrying
   the SHA, read by the check. Honors Principle I (truth is markdown
   frontmatter) and Principle II is untouched (the check reads source, not
   a compiler artifact). **Chosen.** Bumping the pin is a spec edit, which
   the coupling gate already governs, so a pin move is reviewable and
   attributable by construction.
3. **The committed factory checkout** — OAP does not vendor
   factory; rejected (no such checkout exists, and adding one
   duplicates the contract OAP already authors).

A pin alone catches OAP-side drift but goes stale silently: if
the upstream source moves ahead, the PR lane keeps passing against the old pin
while the real surfaces diverge. So a **second lane** runs on a schedule
(cron) and on `workflow_dispatch`, fetching the upstream source @ main and
running the same parity assertion. A red cron lane is the signal "upstream
moved; bump the pin and reconcile". This is the two-lane design: PR-time is
**pinned and blocking** (deterministic, no network flake gates a PR on
content the PR didn't touch); the cron is **against-main and advisory-to-a-
human** (opens/annotates an issue rather than failing a PR that has nothing
to do with the drift).

### Fetch auth — authenticated cross-org fetch, PAT secret

A `gh api` fetch of the configured upstream source returns **404** for the
authenticated CI identity at spec time — the repo is private or org-gated
to the statecrafting CI token's scope. The check therefore cannot assume
anonymous fetch. **Decision:** the workflow fetches via an authenticated
sparse checkout / `gh api` using a repo-scoped PAT stored as an Actions
secret (working name `UPSTREAM_SOURCES_RO_TOKEN`, read-only contents scope on
the configured upstream source). If org policy later makes the repo
public, the token becomes optional and the workflow falls back to anonymous
fetch — but the spec assumes private until verified otherwise.
**Fail-visible:** a missing or unauthorized token fails the job with
"cannot fetch factory at <ref>; check UPSTREAM_SOURCES_RO_TOKEN" — it
is **never** skipped-green (the spec 200 FR-004 / spec 209 FR-005 posture).
Only the cron lane needs the network every run; the PR lane needs it only
when a lockstep-set file actually changed (the route below), bounding the
secret's blast radius and the flake surface.

> **Design correction (2026-06-12), self-amend.** The original §"Semantic
> diff" + §"lockstep set" (below, as authored 2026-06-11) asserted the two
> contract surfaces are in **field-level structural parity**, differing only
> in comments and free-form example values, and that a single value-ignoring
> rule covers the lot. A full file-by-file diff against the very pin this
> spec names (`factory@cc1139f`) falsifies that premise for three of
> the ten files, and **spec 197 had already documented why**:
>
> - **`adapter-manifest.schema.yaml` is adapter-specialised by design**, not
>   value-divergent. factory's manifest carries Encore-shaped
>   `directory_conventions` (`api_service_def`/`bff_proxy`/`db_definition` vs
>   OAP's generic `api_controller`/`api_route`), a restructured `dual_stack`
>   (`variants`/`audience_to_variant` vs `stacks`/`audience_to_stack`),
>   object-valued `scaffold.source`, a `create_eligible` field, and extra
>   `commands` (`gen_client`/`generate_keys`/`migrate`/`graph_check`/
>   `pre_verify`/`post_verify`). These are different *field sets*, and
>   **spec 197 FR-007 explicitly scoped them out**: "The reference adapter
>   (`acme-vue-encore`) declares a richer command set … **not yet** in OAP's
>   canonical manifest schema — explicitly out of this spec's scope."
> - **`build-spec.schema.yaml` and `stage-outputs/sitemap.schema.json`** —
>   factory has **additively evolved** them: `project.workspace_id`
>   and a larger `ui.pages[].page_type` enum (the 24-type service-design
>   catalog). Both are factory-side *additions* over the OAP open standard.
> - **What spec 197 AC-8 actually verified** at `cc1139f` is narrow:
>   "`schema_version: "1.1.0"`, `provisioning_model` required with the
>   identical enum, `implementation_status` optional with the identical
>   enum." It did **not** assert whole-file structural parity, and AC-4 says
>   bringing build-spec under an automated parity walker is future work.
>
> A gate built on the false premise is **red on arrival against its own
> pin** — which is neither the green-on-arrival model this spec describes nor
> honest about what 197 established. The correction below replaces the single
> field-level rule with a **three-mode comparison** that is true at `cc1139f`
> and still falsifiable (a removed/renamed open-standard field, a narrowed
> enum, or a GoA concept entering the contract all still fail). The remaining
> seven files **are** in parity (verified below) and stay hard-fail. FR-001,
> AC-1, and AC-2 are rewritten to match; the lockstep-set classification
> gains explicit per-file modes. This is a refinement of a draft spec before
> implementation, recorded as a self-amend per history-by-construction.

### Semantic diff — three comparison modes, not one

A full diff of the ten lockstep files against `factory@cc1139f`
(recorded above) shows three distinct relationships, not one. The tool
parses each file (YAML or JSON), drops comments (YAML parsing discards them)
and free-form prose values (JSON Schema `description` strings), and compares
the **structural shape** — key paths, requiredness, enum value sets, nesting
— under the mode the spec assigns that file:

1. **Exact structural parity (hard-fail on any divergence).** The genuinely
   shared, org-agnostic, no-additive-evolution surface. Any field
   added/removed/renamed, any enum changed, any requiredness change on
   **either** side fails. These files are meant to stay identical.
2. **Directional floor (OAP is the floor; factory may extend).** Every field
   path and enum value present in the OAP surface MUST be present on the
   factory side (no removal, rename, or enum-narrowing on the consumer);
   factory-side **additions are permitted**. This is the open-standard
   reading: OAP authors an extensible base, the owned adapter may carry more.
   It catches the drift that matters (a dropped `provisioning_model`, a
   renamed contract field, a narrowed enum) while tolerating the real,
   benign additive evolution at the pin (`workspace_id`, the larger
   page-type catalog).
3. **Section-scoped directional floor.** For an **adapter-specialised** file,
   compare only the contract-governed sections under the directional-floor
   rule; declare the adapter-determined sections out of structural compare.

The comparison is the contract shape, not the prose around it. Where a real
divergence exists the gate names the field path and the side that carries
it, in the spec-191 diff-reporting style (`<path>: present in OAP only`).

### The lockstep set — per-file modes (and the Tier-B gap)

The lockstep files and the mode each is compared under (the authored source
of truth — Principle I; the tool mirrors this table as data validated by
fixtures, and moving a file between modes is a coupling-gated edit to this
spec, like the pin):

- **Exact parity:** `pipeline-state.schema.yaml`, `verification.schema.yaml`
  (byte-identical at `cc1139f`); `stage-outputs/business-rules.schema.json`,
  `entity-model.schema.json`, `use-cases.schema.json` (byte-identical); and
  `stage-outputs/audiences.schema.json` (identical modulo one `description`
  string, which the prose-ignoring rule drops).
- **Directional floor:** `build-spec.schema.yaml` and
  `stage-outputs/sitemap.schema.json` — every OAP field/enum-value must
  persist on the factory side; factory additions (`workspace_id`, the extra
  page types) pass.
- **Section-scoped directional floor:** `adapter-manifest.schema.yaml` —
  compare `schema_version`, the **`governance:` sub-envelope**
  (spec 198 FR-012: `max_tier`, `file_write_scope`, `file_write_denied`,
  `allowed_commands_from`, `scaffold_execution{entry_points_from,
  setup_commands_from, isolation}`, `agents_from`), and **`dual_stack`**
  under the floor rule. `dual_stack` joined the scope 2026-06-12 (second
  self-amend): its audience→variant mapping is consumed by OPC's adapter
  loading path, so it is cross-repo contract surface — the live OPC failure
  that motivated the widening was exactly a stack→variant model drift
  (`audience_to_stack`/`stacks` vs `audience_to_variant`/`variants`) sitting
  outside the gate's then-coverage, and the two subtrees are aligned at the
  pin since PR #344. The adapter-determined sections (`adapter`, `stack`,
  `capabilities`, `supported_auth`, `commands`, `directory_conventions`,
  `patterns`, `agents`, `scaffold`, `validation`) remain **excluded** from
  structural compare, per 197 FR-007.

**Tier B — present-on-OAP, expected-but-absent on factory**
(`governance-envelope.schema.yaml` today). The gate reports this as a
**named, expected gap** with the spec-198 obligation cited — advisory in the
PR lane (it is a known authoring debt, not a regression a PR introduced), and
the cron lane's signal that the gap has been closed when the file appears and
must then graduate to an exact/floor mode. The gate must not let a Tier-B gap
silently mask a *real* divergence in any of the modes above — gap
classification is per-file and explicit, never a catch-all.

### The lockstep route (PR-lane trigger)

The PR lane dispatches from the spec-177 orchestrator only when the diff
touches the lockstep surface: `standards/schemas/factory/**`, the checker
tool's own directory, the lockstep workflow file, or this spec's `spec.md`
(a pin bump or tier move). Any other PR skips the job entirely — no
network fetch, no token exposure, which is the blast-radius bound the
fetch-auth section relies on. The route is defined here so AC-1's trigger
condition is falsifiable rather than implied.

### Spec-197-FR-005 GoA-concept guard — denylist token scan, both surfaces

Spec 197 FR-005 rejects two GoA concepts from the contract: **security
classification labels** (`Public`/`Protected A`/`Protected B`/`Protected
C`) and the **external service catalogue** (the GoA OpenAPI/capability
taxonomy). Spec 197 AC-6 already asserts no such token appears in
`standards/schemas/factory/` or `crates/factory-contracts/src/` — but only
for the OAP side, and only by intent. **Decision:** a denylist token scan
(case-insensitive, word-boundary) over **both** the OAP and the fetched
factory contract surfaces, with the denylist defined by citation to
spec 197 FR-005 (the enumerated label set and
service-catalogue identifiers). The label set is covered in two forms:
`Protected\s+[ABC]` verbatim (unambiguous), and `Public` only
context-bound — as part of the four-label enumeration or adjacent to
classification vocabulary — because the bare word `Public` appears in
ordinary schema prose and a naive token match would drown the guard in
false positives; the exact context-binding is fixed at implementation with
fixtures for both the caught and the deliberately-not-caught cases. A
match on either side fails the lane naming the file, line, and the
spec-197 FR-005 clause it violates. This is a guard,
not a parser — it does not understand YAML; it asserts the rejected
vocabulary never entered the open standard on *either* repo, which is the
mechanizable reading of "no GoA-specific concepts in the contract layer".
The denylist is the gate's single source of forbidden vocabulary and cites
spec 197 FR-005 as its authority, so widening it is a spec-coupled edit.

### Free-disk-space composite — not needed (recorded)

The spec-135 FR-05a `free-disk-space` composite exists
(`.github/actions/free-disk-space`) for disk-heavy Rust/Docker jobs. This
job is a sparse fetch plus a small Node/bun YAML compare — no large
toolchain, no Docker image, no `target/`. It does **not** use the composite,
and recording that here pre-empts the reflexive "add free-disk-space"
review note.

## Functional requirements (sketch — refine before implementation)

- **FR-001 — Cross-repo lockstep check (the tool).** A small OAP-side
  checker (binary `factory-schema-lockstep`, a sibling Rust crate under
  `tools/oap/`, **not** an extension of the JS `schema-parity-check` per §4)
  that, given a local factory contract tree, parses each lockstep file
  on both sides and asserts structural agreement **under the per-file mode
  the spec assigns** (§"The lockstep set"): *exact parity* for the shared
  surface, *directional floor* for `build-spec`/`sitemap` (OAP fields must
  persist on factory; factory additions pass), and *section-scoped
  directional floor* for the adapter-specialised `adapter-manifest`
  (`schema_version`, the `governance:` sub-envelope, and `dual_stack`).
  Comments and
  free-form prose (`description`) values are ignored in every mode.
  Divergence exits non-zero naming the file and field path and the mode it
  violated; Tier-B gaps are reported with their spec-198 citation and do not
  fail the PR lane. The per-file mode table is compiled into the tool as data
  and asserted against fixtures, so a spec edit to the table is the only way
  to move a file between modes.
- **FR-002 — Spec-197-FR-005 GoA-concept guard.** The same tool scans both contract
  surfaces for the spec-197 FR-005 denylist vocabulary; a match fails
  naming file:line and the spec-197 FR-005 clause it violates.
- **FR-003 — PR lane (pinned, blocking).** A reusable workflow dispatched
  from the spec-177 orchestrator on the lockstep route (defined above)
  sparse-fetches ONLY `contract/schemas/**` from factory at the pin
  in this spec's frontmatter (`pinned_ref`) — never a full clone,
  runs FR-001/FR-002, and blocks the PR on any compare-mode divergence or a
  spec-197 FR-005 guard hit. Runs identically in `merge_group`. SHA-pinned action refs
  (spec 158). Fail-visible on fetch/auth failure (never skipped-green).
- **FR-004 — Cron lane (against main, human-routed).** A scheduled
  (+ `workflow_dispatch`) lane sparse-fetches the upstream source @ main, runs
  the same assertions, and on divergence opens/annotates a tracking issue
  ("upstream drifted from pin `<ref>`; reconcile and bump") rather than
  failing an unrelated PR. Catches the stale-pin failure mode the PR lane
  structurally cannot. The lane declares `permissions: issues: write`
  explicitly (the fetch token stays read-only and separate), and
  deduplicates: it searches for an open issue by the lane's label and
  updates it rather than filing a new one per run — an advisory channel
  noisy enough to be ignored is the skipped-green failure mode in another
  coat.
- **FR-006 — Makefile mirror + parity classification (spec 104).** A
  `make factory-schema-lockstep` target mirrors the PR-lane recipe; the
  workflow is added to `ci-parity-check`'s `ENFORCING_WORKFLOWS` with
  aligned/divergent fixtures proving drift detection; the target joins
  `make ci-strict`. Whether it also joins fast `make ci` is a measured
  spec-135 decision — it needs a network fetch, so default to strict-only
  unless the fetch is cheap enough and reliable enough for the ~5-minute
  budget, with the measurement recorded (the spec 211 FR-002 rule).
- **FR-007 — Pin lives in frontmatter (Principle I).** The checked
  factory ref is a `pinned_ref` field in this spec's frontmatter, not
  a standalone data file. Bumping it is a coupling-gated spec edit, so a pin
  move is attributable and reviewable.

## Acceptance criteria (sketch)

- **AC-1.** A PR that **removes or renames** a field in
  `standards/schemas/factory/build-spec.schema.yaml`, or **narrows** one of
  its enums, such that an OAP open-standard field/value is no longer present
  on the factory side at the pinned ref, fails the PR lane naming the field
  path and the side that carries it (the directional-floor rule). Equally, a
  PR that adds/removes/renames a field in an **exact-parity** file (e.g.
  `pipeline-state.schema.yaml`) without the matching factory edit fails.
- **AC-2.** Differences that the modes are designed to tolerate do **not**
  fail: (a) comment-only or `description`-prose-only differences in any file
  (the `audiences` description-string class); (b) factory-side **additions**
  in a directional-floor file (`workspace_id`, the extra `page_type` enum
  values present at `cc1139f`); and (c) divergence in an adapter-specialised
  section of `adapter-manifest.schema.yaml` (`directory_conventions`,
  `commands`, …) — these are excluded from structural compare per 197
  FR-007. (`dual_stack` was in this excluded list until the 2026-06-12
  second self-amend moved it into the compared scope.)
- **AC-3.** A GoA-specific token (e.g. `Protected B`, or a service-catalogue
  identifier from spec 197 FR-005) introduced into either contract surface fails the
  guard naming file:line and the FR-005 clause.
- **AC-4.** `governance-envelope.schema.yaml` present on OAP and absent on
  factory is reported as a named Tier-B expected gap citing spec 198
  — advisory in the PR lane — and does not mask a real compare-mode
  divergence in the same run (gap classification is per-file, proven by a
  fixture that pairs a Tier-B gap with an exact/floor break and asserts the
  run still fails on the break).
- **AC-5.** The cron lane, run against the upstream source @ main when it has
  drifted ahead of the pin, opens/annotates a tracking issue and does not
  fail an unrelated PR; bumping `pinned_ref` to the new ref turns the PR
  lane green again.
- **AC-6.** A missing/unauthorized `UPSTREAM_SOURCES_RO_TOKEN` fails the job
  with the fetch diagnostic — never skipped-green (spec 200 FR-004 posture).
- **AC-7.** `ci-parity-check` is green with the new workflow classified
  enforcing: the Makefile mirror exists token-for-token, and the divergent
  fixture proves drift detection (spec 104).
- **AC-8.** The job runs in `merge_group` with the same blocking semantics
  as on PRs (spec 177 gate composition, no PR-only carve-out); action refs
  are SHA-pinned (spec 158).

## Out of scope

- **Contract field changes.** This gate watches the contract; specs
  074/197/198/210 own its shape. It adds and removes no field.
- **factory-side CI.** factory is `spec_spine: false` by
  declaration; enforcement is unidirectional, OAP-side. This spec does not
  add gates to factory.
- **The Rust↔TS structural-parity gate** (specs 125/191) — a different axis
  on different files; this spec adds the third (OAP↔factory) axis and
  does not touch the first.
- **Admitted-`factory_sha` reconciliation** (spec 198). The deployed
  admission SHA is a runtime fact in the statecraft DB; this gate's pin is a
  build-time, CI-reachable surrogate. Aligning the two is a separate concern.
- **Generalizing `schema-parity-check`** — recorded and rejected in §4.

## Sequencing

Implementable now — every dependency is landed machinery: the contract
surfaces exist on both sides at a known SHA (spec 197 AC-8 verified
`cc1139f`), the spec-177 orchestrator already routes added jobs (the
spec-191 precedent), `ci-parity-check` already classifies enforcing
workflows, and a read-only cross-org fetch is a solved CI pattern given the
PAT secret. Per the gap-batch convention, the relationship edges above point
only at verified existing paths; the `establishes:` edges for the new tool,
the workflow file, and the parity fixtures ride the implementation PR that
creates them (the spec 191 precedent). The `pinned_ref` field is added to
this spec's frontmatter when the implementation lands, pinned to the then-
current factory contract SHA. Two implementation-PR obligations
the AI review surfaced, recorded so they are not rediscovered: (a) adding
`pinned_ref` to this frontmatter and the `establishes:` edges is a spec
edit riding the implementation PR — which the coupling gate then accepts
as the authority edit for the new paths; (b) the implementation PR's edits
to the two `extends:` units above (`ci.yml`, ci-parity-check `lib.rs`)
fire the coupling gate against their existing authorities — this spec's
edit in the same PR satisfies it via the extends edges (the spec-191
precedent).

## Implementation log

- **2026-06-12 — Implementation landed (PR #342).** The
  `factory-schema-lockstep` crate (three-mode structural compare + spec-197
  FR-005 GoA guard, unit + integration test suite), both lanes
  (`ci-factory-schema-lockstep.yml`, `ci-factory-schema-lockstep-cron.yml`),
  the spec-177 orchestrator route, the `make factory-schema-lockstep` mirror
  wired into `ci-strict`, and the `ENFORCING_WORKFLOWS` classification with
  aligned/divergent fixtures (AC-7). First live PR-lane evidence: green on
  PR #344 (run 27411230274, job "cross-repo contract parity"), a PR that
  touched `standards/schemas/factory/**` and exercised the route, the
  sparse fetch at the pin, and the compare end-to-end.
- **2026-06-12 — Cron lane first live run (FR-004 mechanics).** Manual
  `workflow_dispatch` of the cron lane (run 27412429070): authenticated
  sparse fetch of `factory@main`, full check green, no tracking
  issue filed — the fetch-auth, compare, and quiet-when-aligned paths are
  live-verified. The drift→issue path (AC-5) remains fixture/code-reviewed
  only until upstream actually drifts; the lane is active on its schedule.
- **2026-06-12 — dual_stack widening; implementation → complete.** With the
  widened `include_top_keys` and OAP's mirror still on the legacy stack
  model (pre-#344 main), the local gate run against the pinned tree
  (`factory@cc1139f`) failed naming exactly the live drift:
  `dual_stack.audience_to_stack` and `dual_stack.stacks` present in OAP
  only — the widened gate detects the drift class that caused the OPC
  adapter-load failure. After PR #344's variant-model realignment the same
  run is green, and the widened PR lane gates the very PR that lands this
  amendment (its green lockstep check is the live widened-scope evidence,
  enforced by the merge queue rather than asserted here).
