---
id: "147-spec-kind-grammar"
title: "Spec-kind grammar: typed kinds, shape and category dimensions, governance-lifecycle fields, and primary-owner promotion"
status: approved
created: "2026-05-13"
approved: "2026-05-17"
amended: "2026-06-18"
amendment_record: |
  amended 2026-06-18 by spec 217 (engine-swap collapse): the in-tree spec-compiler and codebase-indexer that implemented the kind-grammar parse (V-012..V-019) and scanner were deleted; those checks moved to spec-spine-core. The spec-compiler, codebase-indexer spec_scanner, and codebase-indexer lib edges are stripped (paths deleted); the surviving spec-lint overlay edge (W-130/131/132) and the registry.schema.json edge are retained.
authors: ["open-agentic-platform"]
kind: amendment
domain: substrate
shape: mechanism-add
risk: high
owner: "open-agentic-platform"
implementation: complete  # Phase 1 landed (f3ce6d1e spec-compiler V-012..V-019 + registry schema 1.5.0; 6d88179d spec-lint W-130/131/132 + severity tiers; 221d2c77 codebase-indexer primary flag + index schema 1.4.0; 20df53d2 spec 000/128 amendment records; 28d6af23 amends-list expansion). Phase 2 landed (28-spec kind backfill across 087, 088, 089, 090, 091, 092, 093, 094, 095, 096, 097, 098, 099, 100, 108, 109, 110, 111, 112, 113, 115, 120, 121, 122, 123, 124, 125, 126 + V-012 → error in spec-compiler; corpus now 148 specs, all with valid `kind:`). Phase 3 landed (proving-ground triplet: 148-auth-driver-registry + 149-saml-auth-driver + 150-example-tenant-profile, exercising V-013/V-014/V-015/V-017 cleanly at warning severity; AC-006 — registry-consumer --kind/--shape/--category filters + tests; AC-008 — featuregraph consumes implements: from registry.json via load_from_registry + typed ImplementsField). Phase 4 landed (W-002/W-003 rewired from prose scans to frontmatter-presence checks against `superseded_by:` / `retirement_rationale:`; prose-scan helpers removed from spec-lint; V-018 and V-019 promoted to error severity in spec-compiler — the 4 superseded specs already carry valid `superseded_by:` pointers via Phase 1's KNOWN_KEYS routing; spec-compiler integration tests migrated from stale-prone `target/debug/spec-compiler` fallback to `env!("CARGO_BIN_EXE_spec-compiler")` resolution).
summary: |
  Third amendment to spec 000. Promotes `kind` from inert metadata to a
  validated enum. Adds `shape` (kind-refinement) and `category` (cross-cutting
  tags) as new universal frontmatter dimensions. Introduces three new kinds —
  capability, registry, profile — with per-kind structural fields, enabling
  the spec spine to absorb capability-and-profile composition (the model
  surfaced by surveys of legacy-factory and acme-vue-node). Promotes
  `implements:` to registry-serialized output and adds a `primary` flag to
  implements claims, resolving spec 130 OQ-1. Introduces governance-lifecycle
  fields (`supersedes`, `superseded_by`, `retirement_rationale`) that
  retire the prose-scan workarounds W-002 and W-003.
amends: ["000-bootstrap-spec-system", "128-spec-lint-default-fail-on-warn", "001-spec-compiler-mvp", "006-conformance-lint-mvp", "101-codebase-index-mvp", "132-constitutional-invariant-freeze", "133-amends-aware-coupling-gate"]
amends_sections: []
# 217 deleted the in-tree spec-compiler + codebase-indexer; the kind-grammar parse
# (V-012..V-019) and scanner moved to spec-spine-core. The spec-compiler, codebase-indexer
# spec_scanner, and codebase-indexer lib edges are stripped (paths deleted). The
# surviving spec-lint overlay edge (W-130/131/132, the crate survives) and the
# registry.schema.json edge are retained, as is the spec-types refines below.
# Amended by 217.
extends:
  - spec: "006-conformance-lint-mvp"
    nature: additive
    unit: { kind: file, path: tools/spec-spine/spec-lint/src/lib.rs }
  - spec: "132-constitutional-invariant-freeze"
    nature: additive
    unit: { kind: file, path: standards/schemas/spec-spine/registry.schema.json }
refines:
  - aspect: "kind-grammar-corpus-backfill"
    unit: { kind: file, path: tools/shared/spec-types/src/lib.rs }
compliance:
  - framework: owasp-asi-2026
    controls: ["ASI01", "ASI03"]
---

## Constitutional positioning — option (a) eligibility

This amendment proceeds under spec 000 §238–243 as an in-place amendment of
the constitutional bootstrap. Per the verification pass conducted before
drafting, none of spec 000's 14 frozen anchors (V-001..V-010,
markdown-truth-boundary, json-truth-boundary, determinism-requirement,
directory-name-equals-id) is modified by this amendment, provided four
commitments hold. This section states the commitments explicitly so
reviewers can verify option-(a) eligibility before reading further.

Spec 147 classifies itself per the grammar it introduces:
`kind: amendment`, `shape: mechanism-add`. Per the (kind, shape)
table this amendment establishes, this is the precise
self-description. Precedent specs 119 and 132 (both `kind:
governance`) are not reclassified — see §Out of scope.

The `amends:` list is `["000", "128", "001", "006", "101", "132",
"133"]`. The spec/code coupling gate (spec 127, amended by 130/133)
surfaces each tool surface that 147 modifies as a real amendment of
the spec that owns it: 001 (spec-compiler, gains V-012..V-019), 006
(spec-lint, gains W-130/131/132 and the severity-tier registration
mechanism that spec 128 §7 governs), 101 (codebase-index, gains the
`primary` flag and bumps the index schema 1.3.0 → 1.4.0), 132 (the
registry schema 1.4.0 surface that 132 froze, now bumped to 1.5.0
with new field declarations), and 133 (the index schema 1.3.0
surface that 133 extended, now extended further). These specs all
gain `amended:` / `amendment_record:` frontmatter and a body
callout per spec 119's convention.

**Commitment 1 — Optionality.** Every new universal frontmatter field
introduced by this amendment (`kind` as enum, `shape`, `category`,
`supersedes`, `superseded_by`, `retirement_rationale`)
is OPTIONAL. The required-keys set defined by spec 000 §Markdown document
grammar (id, title, status, created, summary) is not enlarged. Per-kind
structural fields are required only conditionally, gated by the value of
`kind`. V-002 (required-keys + id-matches-directory) is therefore NOT
TOUCHED.

**Commitment 2 — V-code allocation.** New validation invariants
introduced by this amendment occupy V-012 through V-019. The reserved
range V-006..V-010 (frozen by spec 132) is not populated. V-006..V-010
remain NOT TOUCHED.

**Commitment 3 — extraFrontmatter cap preserved.** All new fields enter
`KNOWN_KEYS` as explicitly-documented extensions per spec 000
spec.md:85. The 8-key cap on `extraFrontmatter` is unchanged. The
markdown-truth-boundary anchor remains NOT TOUCHED.

**Commitment 4 — Spec 128's fail-on-warn posture preserved at the
warning tier.** This amendment introduces an info severity tier
for W-codes (see §Lint changes and the companion amendment to spec
128). The strict posture established by spec 128
(`--fail-on-warn` default, zero warning-tier firings against the
corpus) is preserved at the warning tier. The info tier is
additive; no existing W-code is reclassified by this amendment.
Spec 128 has no frozen anchors, so amending it carries no
unamendable-list risk.

With these four commitments, `amends_sections:` is empty, V-011 does
not fire at compile time, and the amendment lands cleanly under spec
000's own supersession-avoidance rule.

## Motivation

Three surveys conducted in sequence converged on the same finding:

1. The spec spine today has structural uniformity (every spec has the
   same required fields, the same kind-agnostic validators, the same
   universal frontmatter grammar) and an inert `kind` field carrying
   13 empirical values with no enforcement.

2. Two external dependencies of open-agentic-platform —
   `legacy-factory` (a markdown-skill-driven Claude agent
   framework) and `acme-vue-node` (a monorepo enterprise application
   template) — encode capability-and-profile composition in bespoke
   ways that resist absorption into OAP because the spine has no
   vocabulary to express them. Their absorption is the long-term
   goal driving this amendment.

3. The codebase's realized + planned query inventory shows
   workarounds (prose scanning for W-002/W-003, hardcoded spec-id
   lists, short-form prefix resolution duplicated across three call
   sites) that a richer typed grammar would eliminate.

The amendment is the smallest constitutional change that enables all
three: absorption of external capability-and-profile composition into
OAP-native specs, elimination of the workarounds, and a typed kind
vocabulary that the tooling ecosystem can validate against.

## Grammar additions

### `kind` — promoted to validated enum

`kind` becomes a closed enum. The starting vocabulary is the union of
the 13 values empirically present in the corpus plus three new values
introduced by this amendment:

```
platform                    | platform-delivery     | governance
product                     | amendment             | tooling
desktop                     | process               | ui
architecture                | constitutional-bootstrap
migration                   | product-consolidation
capability                  | registry              | profile
```

Specs without a `kind:` value (28 of 147 at the time of this
amendment) continue to compile. Specs declaring a `kind:` value
outside this enum fail V-012.

The vocabulary is additive: future amendments may add new kinds. This
amendment establishes the precedent that kind-additions are
non-supersession-grade changes.

### `shape` — kind-refinement

`shape` is an optional refinement within `kind`. Where `kind` answers
"what is this spec," `shape` answers "what structural variant within
that kind." Validation rules are table-driven on (kind, shape) pairs.

The starting (kind, shape) table (canonical form in
`data-model.md` §`shape: string`; this table is a narrative
summary):

| kind         | shape values                                                                                                                  |
|--------------|-------------------------------------------------------------------------------------------------------------------------------|
| capability   | `driver`, `module`, `web-snippet`, `middleware-stack`                                                                         |
| registry     | (no shapes; single-shape kind)                                                                                                |
| profile      | (no shapes; single-shape kind)                                                                                                |
| amendment    | `field-addition`, `field-modification`, `mechanism-add`, `mechanism-modification`, `bug-fix`, `retirement-record`, `consolidation` |

Other kinds may use `shape` without a declared vocabulary; the
validator emits an informational diagnostic but does not fail. The
table grows by amendment as new shapes prove themselves in absorbed
content.

When `shape: web-snippet` is declared on a capability spec, at
least one `provides.registrations[].kind` MUST be `web-snippet`
to link the two `web-snippet` occurrences across the (kind, shape)
table and the registrations enum. The compiler enforces this as
part of V-013's capability path.

### `category` — cross-cutting tags

`category` is an optional list of free-form string tags that group
specs along axes orthogonal to `kind`. Multiple categories per spec
is the norm. The tooling consumes this for navigation, filtering,
and cross-cutting reports.

The amendment does not enforce a closed vocabulary on `category`. The
linter emits a warning on truly novel values (W-130). The conventional
starting vocabulary is declared in `data-model.md` §`category`;
that table is canonical and tooling consumes it directly. The
vocabulary is expected to grow.

### Governance-lifecycle fields

Four new fields retire prose-scan workarounds and structure the
amendment / supersession / retirement lifecycle:

- `supersedes: [<id>]` — list of spec ids this spec replaces. Present
  when this spec is a successor.
- `superseded_by: <id>` — single spec id that replaces this spec.
  Present when `status: superseded`.
- `retirement_rationale: { reason: <enum>, summary: <string>, references: [<id>] }`
  — structured retirement record. Required when `status: retired`.
  `reason` enum: `obsolete`, `replaced`, `withdrawn`, `merged`,
  `archived`.

Amendments classify their structural shape via the existing
`shape:` field using the `kind: amendment` row of the (kind, shape)
table above. No parallel `changeset_kind:` field is introduced —
one representation, one validator.

W-002 (status superseded but body lacks replacement pointer) and
W-003 (status retired but body lacks rationale) are retired. Their
prose-scan implementations in tools/spec-spine/spec-lint/src/lib.rs are
replaced by frontmatter-presence checks: W-002 becomes "status
superseded but `superseded_by:` absent"; W-003 becomes "status
retired but `retirement_rationale:` absent." The W-codes are
preserved; the check changes.

W-004 (changeset.md exists without verification.md) is NOT a
prose-scan and is not affected by this amendment.

## New kinds — per-kind structural contracts

### `kind: capability`

Required fields for `kind: capability`:

- `implements: <registry-id>` — the registry kind this capability
  satisfies. (Note: this is the spec-id of a `kind: registry` spec,
  distinct from the existing `implements:` field whose items declare
  code-path claims. See §implements promotion below for the
  reconciliation.)
- `provides:` — structured contribution declaration:
  ```yaml
  provides:
    registrations: [{ kind: api|auth-driver|side-effect|auth-export|web-snippet, ... }]
    files: [<path-glob>]
    env_vars: [{ key, required, default, description, sensitive }]
  ```
- `composition.requires: [<id>]` — hard dependencies on other
  capabilities or specs. Lives under the `composition:` namespace
  (see below). Distinct from top-level `depends_on:`, which
  remains the narrative cross-cutting dependency field;
  `composition.requires:` is the capability-graph edge that V-013
  enforces and the tooling consumes for capability composition
  reasoning.

Optional fields:

- `selectable_by: <env-var>` — the environment variable that selects
  this capability among alternatives in a registry. Optional;
  SHOULD be set when this capability is one of multiple
  implementations of a single registry. When present, V-015
  verifies it equals the target registry's `selector:` value.
- `composition.soft_requires: [<id>]` — capabilities whose env
  vars this capability reads as fallback but does not strictly
  require.
- `composition.conflicts: [<id>]` — mutual-exclusion declarations.

#### `composition:` namespace

The capability-graph fields `requires:`, `soft_requires:`, and
`conflicts:` are nested under a top-level `composition:` key:

```yaml
composition:
  requires: [<id>, ...]
  soft_requires: [<id>, ...]
  conflicts: [<id>, ...]
```

This namespace is shared with `kind: profile` (which uses
`composition.requires:` as its required-capabilities list). The
namespace exists so future composition primitives (`enables:`,
`replaces_at_runtime:`, etc.) slot in without polluting top-level
frontmatter. `selects:` (profile only) stays top-level — it is
structurally a map (registry-id → capability-id) representing
constraint resolution, not a graph edge.

### `kind: registry`

Required fields:

- `selector: <env-var>` — the environment variable consumers use to
  pick an implementation.
- `member_contract: <spec-id-or-trait-name>` — reference to the
  spec or trait declaration that members must satisfy.

Optional fields:

- `default: <value>` — fallback when no selection is made.
- `production_forbidden: [<value>]` — values that fail validation
  when `NODE_ENV=production` or equivalent.

### `kind: profile`

Required fields:

- `identity: { name, jurisdiction, citizen_term, contacts, urls }` —
  structured identity record. Consolidates the brand-string leak
  sites surveyed in acme-vue-node.
- `selects: { <registry-id>: <capability-id> }` — map of registry
  spec-id to chosen capability spec-id. Top-level (not under
  `composition:`); see §`composition:` namespace above.
- `composition.requires: [<capability-id>]` — capabilities that
  must be present regardless of selection (foundational
  capabilities like security-core). Nested under `composition:`
  per the namespace introduced for `kind: capability`.

Optional fields:

- `composition.conflicts: [<capability-id>]` — mutual-exclusion
  declarations against capabilities the profile would otherwise
  admit.
- `policy: { ... }` — structured policy values applied by the
  profile. The shape of `policy:` is itself kind-dependent on the
  selected capabilities and is validated against capability
  declarations rather than against a global schema.

## `implements:` promotion

Currently `implements:` is parsed by the compiler (tools/spec-spine/spec-compiler/src/lib.rs:45)
but is not serialized to registry.json. The amendment promotes it to
a first-class registry field.

Two semantic surfaces share the name `implements:` today:

1. The frontmatter list of `{ path: <string> }` items declaring code-paths
   the spec implements. (Surveyed; appears in many specs.)
2. The newly-introduced `kind: capability` declaration that this
   capability satisfies a registry.

The amendment disambiguates by **shape**, not by rename:

- `implements:` as a list of records → code-path claims (legacy
  meaning preserved).
- `implements:` as a single scalar string → registry-membership
  declaration (new meaning, only valid for `kind: capability`).

The compiler distinguishes by YAML type at parse time. V-014
enforces: if `kind: capability` and `implements:` is present, it
MUST be a scalar string; otherwise it MUST be a list. Mixed forms
fail.

### `primary` flag on implements items

The code-path-claim form of `implements:` gains an optional `primary: true`
flag per item:

```yaml
implements:
  - path: crates/foo/src/lib.rs
    primary: true
  - path: crates/foo/src/helpers.rs
```

This resolves spec 130 OQ-1. The any-one-claimant heuristic remains
the default; `primary: true` declares per-claim primary ownership
when reverse code → spec attribution needs to disambiguate.

V-016 enforces a corpus-wide invariant: for any given path, at
most one spec across the corpus declares `primary: true`. This
makes "for path X, which single spec is primary owner" a typed
question with a deterministic answer — the constraint spec 130
OQ-1 was scoped to solve. The codebase-index downgrades to the
any-one-claimant heuristic when no `primary:` flag is set,
preserving backward compatibility for paths not yet annotated.

## Validation rules

New validation invariants V-012 through V-019:

- **V-012** — `kind` enum membership. If `kind:` is present, value
  MUST be in the declared enum. (See §`kind` above.)
- **V-013** — Per-kind required fields. If `kind: capability`,
  `implements:`, `provides:`, and `composition.requires:` MUST be
  present; and if `shape: web-snippet`, at least one
  `provides.registrations[].kind` MUST be `web-snippet`. If
  `kind: registry`, `selector:` and `member_contract:` MUST be
  present. If `kind: profile`, `identity:`, `selects:`, and
  `composition.requires:` MUST be present. V-013 is silent on
  `kind: amendment` — required fields for amendments are governed
  by spec 119's amendment convention (`amends:`, `amends_sections:`,
  amender-side body callout), not by per-kind structural
  validation. The (kind, shape) table classifies amendments
  structurally but does not impose additional required-keys.
- **V-014** — `implements:` shape consistency. Scalar form valid
  only for `kind: capability`; list form valid for all other kinds
  declaring it.
- **V-015** — Capability/registry link integrity. If `kind: capability`
  and `implements:` is a scalar, the target MUST resolve to a spec
  with `kind: registry`.
- **V-016** — Primary-flag uniqueness (corpus-wide). For any given
  path appearing in any spec's `implements:` list, at most one
  spec across the corpus declares `primary: true`. Resolves the
  "for path X, which single spec is primary owner" question.
- **V-017** — Profile selects-target validity. For each entry in a
  profile's `selects:` map, the key MUST resolve to a `kind: registry`
  spec and the value MUST resolve to a `kind: capability` spec
  whose `implements:` matches the registry id.
- **V-018** — Retirement rationale presence. If `status: retired`,
  `retirement_rationale:` MUST be present.
- **V-019** — Supersession back-link. If `status: superseded`,
  `superseded_by:` MUST be present and MUST resolve to an existing
  spec id.

V-002 (required-keys + id-matches-directory) and V-011
(amends_sections ∩ unamendable) remain unchanged. The new V-codes
do not occupy reserved slots V-006..V-010.

## Lint changes

W-002 and W-003 prose-scan implementations replaced by
frontmatter-presence checks (see §Governance-lifecycle fields).

New W-codes registered with explicit severity, per the info tier
this amendment introduces to spec 128:

- **W-130** — `category:` value not in conventional vocabulary.
  Emits a list of similar known values. **Severity: info.** The
  conventional vocabulary is intentionally open; novel values
  are surfaced but not blocking.
- **W-131** — `shape:` value not in the declared (kind, shape)
  table. **Severity: warning.** The table is meant to grow by
  amendment; novel shape values must trigger explicit table
  updates rather than silently passing.
- **W-132** — Capability declares `selectable_by:` but is not
  referenced by any `kind: registry` spec's known members.
  **Severity: info.** Surfaces orphan capabilities for review;
  not a contract violation in itself.

Severity is intrinsic to the W-code, declared at registration in
`tools/spec-spine/spec-lint/src/lib.rs`. Info-tier diagnostics emit to the
standard diagnostic stream but are exempt from `--fail-on-warn`;
warning-tier diagnostics gate CI under spec 128's strict posture.
See spec 128 §"Amendment 147 — Severity tiers" for the tier
contract.

## Migration

Backfill plan for the 147 existing specs:

1. **`kind:` backfill (mandatory before V-012 activates).** The 28
   specs without `kind:` are reviewed and assigned a kind value
   from the enum. Empirical kinds (platform, governance, etc.)
   require no change for the 119 specs that already declare them.

2. **`shape:` backfill (opt-in).** Existing specs may add `shape:`
   declarations during the amendment's grace period. No spec is
   required to add shape; the field is purely opt-in for v1.

3. **`category:` backfill (opt-in).** Surfaced categories from the
   ≥12 cross-cutting concerns surveyed (security, auth, data, etc.)
   are applied to the ~30 specs where signal is strong from spec
   title and content. Other specs may add categories incrementally.

4. **Governance-lifecycle backfill (auto-promoted; no source
   edits).** The 4 superseded specs (038, 040, 044, 088) already
   carry `superseded_by:` in their frontmatter today; the compiler
   currently routes those keys into `extraFrontmatter`. Phase 1's
   KNOWN_KEYS extension promotes `superseded_by:` to a top-level
   `FeatureRecord` field automatically — no spec source edits are
   required. Spec 132's amendment-record convention is preserved;
   `amendment_record:` and `amends:` remain the primary
   amendment-relationship fields. No retired specs exist in the
   current corpus.

5. **`implements:` promotion (no spec changes required).** The
   existing `implements:` field continues to parse. Specs gain
   registry-serialized output without source changes. New capability
   specs use the scalar form.

6. **`primary:` flag (opt-in).** No existing spec needs primary
   flags applied. Specs that wish to disambiguate per-claim
   ownership add `primary: true` to relevant items.

Migration is staged:

- **Phase 1 (amendment landing):** spec-compiler accepts new fields;
  new V-codes emit warnings (not errors); registry.json schema bumps
  to 1.5.0. Existing specs continue to compile.
- **Phase 2 (after 28-spec kind backfill):** V-012 promoted from
  warning to error.
- **Phase 3 (after capability/registry/profile authoring begins):**
  V-013, V-014, V-015, V-017 continue to emit at warning severity
  against the new-kind specs and surface any contract drift.
  Promotion of these validators to error severity is deferred to
  a separate follow-on amendment after a critical mass of
  new-kind specs has exercised the contract against unforeseen
  cases. Phase 3 within 147 lands the proving-ground specs only;
  contract enforcement is a distinct constitutional act with its
  own scrutiny. (See §Out of scope.)
- **Phase 4 (after KNOWN_KEYS auto-promotion confirms the
  superseded specs):** V-018, V-019 promoted to errors. W-002 and
  W-003 prose-scan helpers retired and replaced with
  frontmatter-presence checks.

V-016 (corpus-wide primary-flag uniqueness) activates immediately
at error severity; the current corpus has zero `primary:`
declarations, so the invariant is vacuously satisfied on day one.

## Tooling impact

- **tools/spec-spine/spec-compiler/** — extend `KNOWN_KEYS` with the new
  fields. Add `kind` enum constant. Add per-kind required-field
  table. Emit `implements:` to registry. Add V-012..V-019
  implementations. Bump SPEC_VERSION to 1.5.0.
- **tools/spec-spine/spec-lint/** — rewire W-002 and W-003 from prose scans to
  frontmatter checks. Add W-130, W-131, W-132. Add (kind, shape)
  validation table.
- **tools/spec-spine/registry-consumer/** — add filters for `--kind`,
  `--shape`, `--category`. Wire `implementation_report` to a CLI
  command (currently library-only; resolves a pre-existing gap).
- **crates/featuregraph/** — ingest `implements:` (now serialized)
  for spec → code joins instead of relying on the codebase-index.
  Add capability/registry/profile aware queries.
- **tools/spec-spine/codebase-indexer/** — consume `primary: true` flag for
  primary-owner attribution; downgrade to any-one-claimant when
  absent.
- **contracts/registry.schema.json** — bump to 1.5.0. Add field
  declarations (see contracts/registry.schema.json.patch).

## Out of scope

The following are NOT introduced by this amendment, with reasoning:

- **`references:` as a typed list of out-of-band policy citations.**
  Pre-drafting verification showed the citation population
  resolves to ~13 policy-grade IDs (5 CONST + 8 ASI), which the
  existing `compliance:` field already accommodates for ASI and
  which `depends_on:` covers for internal CONST references. A new
  field is not earned by the evidence.

- **Per-target ([[bin]], [lib]) spec annotation.** Deferred per the
  existing reserved `CargoMetadataModule` TraceSource variant. A
  future amendment may activate it.

- **Full spec body as queryable text.** Explicitly deferred by spec
  000 data-model.md:69 (body out of scope for MVP). This amendment
  does not modify that boundary.

- **Lifting the 8-key `extraFrontmatter` cap.** Commitment 3 of
  option-(a) eligibility preserves the cap. New structure enters
  KNOWN_KEYS as documented extensions.

- **Reorganizing the `compliance:` field shape.** Spec 116 already
  anticipates multi-framework expansion; the existing `{framework,
  controls}` structure suffices. This amendment leaves
  `compliance:` unchanged.

- **Making `kind`, `shape`, or `category` required.** Commitment 1
  of option-(a) eligibility preserves the existing required-keys
  set. A future amendment may promote `kind` to required after
  full corpus backfill.

- **Closing spec 130 OQ-1.** The `primary:` flag mechanism
  introduced by this amendment (with corpus-wide V-016) is the
  proving ground for primary-owner ownership. Whether spec 130
  OQ-1 closes on this evidence — and what spec 130's updated
  status text reads — ships as a separate follow-on amendment
  after soak time, not as part of 147.

- **Promotion of V-013..V-017 to error severity.** Phase 3 of
  this amendment lands proving-ground specs at warning severity.
  Promotion to error severity is qualitatively enabled by
  open-ended new-kind authoring, not by a closed-ended backfill;
  it ships as a separate follow-on constitutional act with its
  own scrutiny. Distinct from V-012, whose Phase 2 promotion
  IS enabled by a closed-ended 28-spec backfill and stays in
  this amendment.

- **Reclassifying specs 119 and 132 to `kind: amendment`.** Spec
  147 establishes that amendments use `kind: amendment` with the
  appropriate shape. Retroactive reclassification of the prior
  two constitutional amendments (119, 132) is deferred. The
  historical record stands; future amendments use the grammar
  147 introduces.

## Acceptance criteria

- AC-001: Spec 000 is amended as follows: the scalar
  `amendment_record:` field at spec 000:10 is overwritten to
  `"147-spec-kind-grammar"`; the `amended:` field is updated to
  `"2026-05-13"`; and a sentence is appended to spec 000's
  `summary:` field matching the existing 119/132 narration
  pattern — verbatim: "Amended by spec 147 (2026-05-13) to
  promote `kind` to a validated enum, introduce per-kind
  structural grammar (`shape`, `category`, capability/registry/profile
  kinds), and add governance-lifecycle frontmatter fields." This
  follows the established scalar-overwrites-latest convention
  (the prior 119→132 transition overwrote the scalar without
  list-promotion, with body narration preserving the sequence).
  No frozen anchor content is modified. `amends_sections: []` on
  this spec.
- AC-002: registry.schema.json version bumped to 1.5.0 with all new
  fields declared.
- AC-003: spec-compiler emits V-012..V-019 at warning severity in
  Phase 1; existing 147 specs continue to produce valid
  registry.json.
- AC-004: 28 specs lacking `kind:` are backfilled and Phase 2 V-012
  promotion is enacted.
- AC-005: spec-lint W-002 and W-003 implementations rewired;
  prose-scan helpers removed.
- AC-006: registry-consumer gains `--kind`, `--shape`, `--category`
  filter flags.
- AC-007: At least one capability spec, one registry spec, and one
  profile spec land in the corpus exercising the new kinds
  end-to-end. V-013, V-014, V-015, V-017 fire at warning severity
  against the new-kind specs and surface any contract violations;
  promotion of those validators to error severity is out of scope
  for this amendment (see §Out of scope).
- AC-008: featuregraph consumes `implements:` from registry.json (no
  longer dependent on codebase-index for the join).
- AC-010: Spec 128 is amended in place to introduce an info
  severity tier for spec-lint W-codes. W-130 and W-132 are
  registered at info severity; W-131 at warning. The empty-W-set
  posture (zero warning-tier firings against the current corpus,
  per spec 128's 2026-05-02 audit) is preserved at the warning
  tier. Spec 128's frontmatter gains
  `amended: "2026-05-13"` and
  `amendment_record: "147-spec-kind-grammar"`.

## Code aliases

```
KIND_ENUM_GRAMMAR
CAPABILITY_KIND_CONTRACT
REGISTRY_KIND_CONTRACT
PROFILE_KIND_CONTRACT
IMPLEMENTS_PROMOTION
PRIMARY_OWNER_FLAG
GOVERNANCE_LIFECYCLE_FIELDS
```

## Compliance

Compliance declaration is in this spec's frontmatter (`compliance:`
key); see `registry-consumer compliance-report --framework
owasp-asi-2026` for the tooling-consumed view. ASI01 (Governance
of AI assets) and ASI03 (Specification as contract) are advanced
by typed kind grammar with enforced validation.
