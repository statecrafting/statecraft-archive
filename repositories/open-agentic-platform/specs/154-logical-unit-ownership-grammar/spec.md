---
id: "154-logical-unit-ownership-grammar"
slug: logical-unit-ownership-grammar
title: "Logical-unit ownership grammar — value typing for relationship-graph fields"
status: approved
implementation: complete
closed: "2026-05-22"
owner: bart
created: "2026-05-20"
approved: "2026-05-20"
amended: "2026-06-18"
amendment_record: |
  Amended 2026-05-24 by 155-logical-unit-resolution-semantics.
  Re-amended 2026-06-14 by 216-spec-spine-library-grammar-adoption: the
  2026-06-14 bare-id `amends` clarification callout added to §5 (PR #358) is
  formalised here as a spec-recorded amendment. Spec 216 Phase 1 converges the
  spec-compiler onto the bare-id `amends` grammar this section documents; a
  non-string `amends` entry is now a hard V-033 compile error rather than a
  silent empty-list collapse.
  Re-amended 2026-06-15 by 216-spec-spine-library-grammar-adoption (Phase 2b):
  the codebase-index `TraceMapping` (this spec's index unit surface) gains an
  additive `supersedes` field carrying each spec's partial-supersession edges
  with the `unit:` resolved to its physical path(s), so the coupling gate can
  filter superseded predecessors from `authorities(P)`. Index schema bumped
  3.0.0 -> 3.1.0 (additive; `codebase-index.schema.json` widened), and the
  indexer's `unit:`-to-path resolution (spec_scanner) is reused for the new
  field. FR-010 of spec 216.
  amended 2026-06-18 by spec 217 (engine-swap collapse): the in-tree spec-compiler, codebase-indexer, and spec-code-coupling-check that implemented unit-grammar resolution were deleted; that logic is now in spec-spine-core. All edges on those deleted paths are stripped; the surviving edges (registry schema, spec-lint overlay, featuregraph golden) carry this spec's live authority, and the codebase-index schema edge is dropped with the in-tree codebase-index.schema.json (Workstream D).
kind: governance
domain: substrate
risk: medium
depends_on:
  - "130-spec-coupling-primary-owner"
  - "153-invariant-freeze-additive-evolution"
code_aliases: ["LOGICAL_UNIT_OWNERSHIP", "UNIT_GRAMMAR"]
# 217 deleted the in-tree spec-compiler, codebase-indexer, and spec-code-coupling-check;
# the unit-grammar resolution they implemented is now in spec-spine-core. All edges on
# those deleted paths (codebase-indexer Cargo.toml/lib/spec_scanner/types/xref/resolver/
# tests/benches, coupling-check lib, spec-compiler lib + tests) plus the two deleted
# crate-unit references are stripped. The surviving edges (registry schema, the
# spec-lint overlay, the featuregraph golden) carry this spec's live authority over
# the unit grammar; the codebase-index schema edge is dropped with the in-tree
# codebase-index.schema.json (Workstream D, now the library shard schemas). Amended by 217.
extends:
  - spec: "130-spec-coupling-primary-owner"
    nature: additive
    unit: { kind: file, path: standards/schemas/spec-spine/registry.schema.json }
  - spec: "006-conformance-lint-mvp"
    nature: additive
    unit: { kind: file, path: tools/spec-spine/spec-lint/src/lib.rs }
  - spec: "006-conformance-lint-mvp"
    nature: additive
    unit: { kind: file, path: tools/spec-spine/spec-lint/tests/lint.rs }
  - spec: "034-featuregraph-registry-scanner-fix"
    nature: additive
    unit: { kind: file, path: crates/featuregraph/tests/golden/features_graph.json }
summary: >
  Spec 130 §2 defines eight relationship fields (establishes, extends,
  refines, supersedes, amends, co_authority, constrains, origin) that
  carry **file paths** as values. Path-based ownership conflates
  *what behavior does this spec govern* (logical identity) with
  *where does that behavior currently sit* (physical location). Any
  path-shape edit reads as a spec-relevant change even when no
  contract changes. Tier 1 of the spec-spine cleanup pass surfaced
  this concretely via a Spec-Drift-Waiver covering five paths of
  pure structural movement.

  This spec adds a **logical-unit grammar** for the values inside
  relationship fields. Six unit kinds — crate, symbol, module,
  section, directory, file — express ownership as logical identity.
  The codebase-indexer resolves units to physical locations at index
  time; the coupling gate fires on logical-unit drift, not path
  churn. Refactor invariance becomes a structural property of
  ownership.

  This spec also adds a ninth relationship — `references:` —
  declaratively non-owning. References are visible to the indexer
  for provenance and navigation but ignored by the coupling gate.

  Path-string values remain valid (parsed as `file:` units) for
  backwards compatibility until the corpus migration completes and
  legacy form is excised in a later segment of the Tier 2 sequence.
---

# 154 — Logical-unit ownership grammar

## 1. Problem

Spec 130 §2 enumerates the eight first-class relationship edges between
specs and code: `establishes`, `extends`, `refines`, `supersedes`,
`amends`, `co_authority`, `constrains`, `origin`. The relationship
*kinds* are precise — each edge encodes one specific governance
relationship. The relationship *values* are not: every relationship
field that carries a target carries a **file path** (or a list of file
paths).

A file path answers two questions simultaneously:

1. **Logical identity** — what behavior does this spec govern?
2. **Physical location** — where does that behavior currently sit?

These are different questions. Logical identity is stable under
refactor (rename a function, move a crate, restructure a module — the
spec's authority over the *behavior* is unchanged). Physical location
is not (every path-shape edit reads as a spec-relevant change to a
path-comparing gate).

The coupling gate (spec 133) operates over paths, so it fires on every
path-shape edit. Refactors that change no behavior still trip the
gate. The institutional response has been the
`Spec-Drift-Waiver:` PR-body annotation (see
`feedback_dep_refresh_waiver.md` for the precedent and the Tier 1
canonical-json promotion PR for a concrete instance). Waivers are
useful as escape valves but represent an unbounded growth of policy
exceptions documenting the gate's structural inability to model the
actual concept. The waiver count grows linearly with refactor
frequency; the correctness of the ownership model should be invariant
under refactor.

The fix is to separate logical identity from physical location
explicitly. Specs declare *what behavior they govern* (logical units);
the codebase-indexer resolves units to physical locations at index
time; the coupling gate operates over the resolved graph.

## 2. Decision

Introduce a **unit grammar** as the value type for every
relationship-graph field that today carries paths. Six unit kinds
cover the observed ownership shapes across the corpus:

```
unit         := crate-unit | symbol-unit | module-unit | section-unit | directory-unit | file-unit
crate-unit   := { kind: "crate",     id:   <workspace-member-name> }
symbol-unit  := { kind: "symbol",    id:   <rust-path> }
module-unit  := { kind: "module",    id:   <rust-path> }
section-unit := { kind: "section",   file: <file-path>, anchor: <anchor-name> }
directory-unit := { kind: "directory", path: <workspace-relative-path> }
file-unit    := { kind: "file",      path: <file-path> }
```

Each relationship-field item carries exactly one `unit:`. Items
carrying multiple targets split into multiple items, each with its
own unit.

The grammar is forward-compatible with the eight relationship kinds
defined in spec 130. This spec extends 130 additively (legacy
path-string values remain valid; typed unit values are additionally
accepted) and introduces no breaking change to the registry schema.
The extension is permissible under spec 130's `invariant-freeze` on
`registry.schema.json` as clarified by spec 153 (additive evolution
preserves the invariant).

## 3. Unit kinds — semantics and resolution

Resolution is deterministic, total over the corpus, and consumed by
the codebase-indexer and the coupling gate as a typed graph. The
resolver's behavior per kind:

### 3.1 `crate:`

```yaml
{ kind: crate, id: canonical-json }
```

Identifies a workspace member by manifest name. Resolution:

- Validate `id` appears in the root `Cargo.toml` `[workspace] members`
  array. Compile-time check; missing crate is a hard error.
- Resolves to the glob `<member-path>/**` excluding the resolver's
  standard exclusion set (§3.7).

Use when a spec governs an entire crate as a unit. Refactor invariance:
moving the crate's directory within the workspace does not change the
unit. Renaming the crate IS a unit change (the `id` is the stable
identifier).

Applies equally to Rust crates and to npm packages declared as
workspace members of `product/` (the workspace boundary is the
manifest, not the language).

### 3.2 `symbol:`

```yaml
{ kind: symbol, id: canonical_json::canonicalize_value }
```

Identifies a single named symbol (function, type, constant, trait) by
**fully-qualified Rust item path**. The `id` carries the path only —
the sequence of `::`-separated identifiers naming the item. `id`
values containing `<` or `>` are rejected at parse time. These
characters appear only in type-expression, turbofish, or
qualified-path syntax — none of which are part of an item's path
identity. V-024 (malformed unit declaration) fires on `kind: symbol`
units whose `id` contains `<` or `>`.

*Amended 2026-05-21 by [spec 155](../155-logical-unit-resolution-semantics/spec.md) — see §2.1 for amendment rationale.*

Resolution:

- Look up the symbol in the codebase-indexer's symbol index
  (consuming xray's symbol-extraction pass).
- Resolves to a `(file, line-range)` tuple. Missing symbol is a hard
  error.

Use when a spec governs a specific named symbol. Refactor invariance:
moving the symbol within its module (line shuffling, ordering changes)
does not change the unit. Renaming the symbol or moving it to a
different module IS a unit change — the symbol's fully-qualified path
is the stable identifier.

Specs wanting refactor-invariance over symbol names should claim the
enclosing `module:` or `crate:` instead.

### 3.3 `module:`

```yaml
{ kind: module, id: canonical_json::tests }
```

Identifies a Rust module by fully-qualified path. Resolution:

- Look up the module in the codebase-indexer's module index.
- Resolves to the file range corresponding to the module's
  declaration. For file-modules, the range is the whole file
  (`<module>.rs` or `<module>/mod.rs`). For inline modules, the
  range is bounded by the module's declaration site; exact span
  boundary is a resolver implementation concern. **Missing module
  is a hard error.**

*Amended 2026-05-21 by [spec 155](../155-logical-unit-resolution-semantics/spec.md) — see §2.2 for amendment rationale.*

Use when a spec governs a coherent module subtree without claiming
every symbol within it. Refactor invariance: adding new symbols to
the module without changing the module's identity does not change the
unit. Renaming or restructuring the module IS a unit change.

### 3.4 `section:`

```yaml
{ kind: section, file: Makefile, anchor: deploy-azure }
```

Identifies a named section within a file. The anchor's semantics
depend on the file kind per the existing rules in spec 152:

| File kind | Anchor semantics |
|---|---|
| Makefile | Target group (consecutive targets sharing a prefix or a `# region:` marker) |
| Workflow YAML | `jobs.<name>` |
| Source file (Rust, TS, etc.) | `// region: <name>` marker |
| Markdown | Heading slug (GFM convention) |
| Shell script | `# region: <name>` marker |
| TOML / YAML config | Top-level table or `# region: <name>` marker |

Resolution: the resolver dispatches to a per-file-kind anchor parser
keyed on extension. Missing anchor is a hard error.

Use when a spec governs a discrete section of a multi-spec file
(canonical case: the repo-root `Makefile` where several specs each
own a target group). The legacy `co_authority.section:` field becomes
a `section:` unit inside `co_authority.unit:`; the relationship-level
`section:` field is no longer needed.

### 3.5 `directory:`

```yaml
{ kind: directory, path: platform/gitops/clusters/hetzner-prod }
```

Identifies a coherent tree of files that does not correspond to a
workspace-member crate. Resolution:

- Resolves to the glob `<path>/**` excluding the resolver's standard
  exclusion set (§3.7). **Missing directory is a hard error.**

*Amended 2026-05-21 by [spec 155](../155-logical-unit-resolution-semantics/spec.md) — see §2.3 for amendment rationale.*

Use when a spec governs a non-crate tree as a unit (canonical cases:
TypeScript modules within a statecraft API, infrastructure manifest
trees, gitops cluster directories). Distinct from `crate:` (which
carries workspace-member semantics with manifest validation) and from
`file:` (which targets a single file).

Per the Tier 2 design conversation: `directory:` does NOT carry
per-unit exclusion lists. Resolver-defined exclusions are
workspace-wide doctrine; spec-local exclusions would let two specs
claiming `directory: foo` resolve differently, which is the
discrepancy class the unit grammar is designed to eliminate. If a
spec genuinely needs different exclusions, the right answer is to
enumerate `file:` units or surface the case as a grammar refinement
with concrete evidence.

### 3.6 `file:`

```yaml
{ kind: file, path: deny.toml }
```

Identifies a single file. Resolution: literal path match in the
worktree. Missing file is a hard error unless the diff has a git
rename trace covering it (in which case the resolver follows the
rename). **Rename-trace evaluation is a property of the coupling
gate's diff context, not the resolver's compile context: during
`codebase-indexer compile`, where no diff is available, a missing
file is unconditionally a hard error.**

*Amended 2026-05-21 by [spec 155](../155-logical-unit-resolution-semantics/spec.md) — see §2.4 for amendment rationale.*

Use when no other unit kind fits — single-file ownership of a
configuration artifact, schema file, dotfile, etc. The legacy
path-string form parses as a `file:` unit during the
backwards-compatibility window.

### 3.7 Standard exclusions

The resolver applies these exclusions to every `crate:` and
`directory:` glob.

**Baseline list (contract floor):**

- `target/**`
- `node_modules/**`
- `.derived/**`
- `dist/**`
- `build/**` (legacy pre-`.derived/` artifact location)
- `.next/**`

**`.gitignore` honoring (worktree-derived, additive):**

The resolver also excludes any path matched by a `.gitignore` file
**committed to the repository tree**. Per-clone and per-user exclusion
sources are explicitly NOT honored, because they would make resolution
non-deterministic across machines:

- `.gitignore` files in the repository tree — **honored**
- `.git/info/exclude` — NOT honored (per-clone, not committed)
- Global `core.excludesFile` — NOT honored (per-user)
- `.ignore` files (non-VCS, ripgrep-style convention) — NOT honored

The implementation uses `ignore::WalkBuilder` configured with
`git_ignore(true)`, `git_exclude(false)`, `git_global(false)`. The
baseline list above remains the floor: even if a project's
`.gitignore` does not include `target/` etc., the resolver still
excludes them.

The exclusion set is part of the resolver's contract. Additions to
the baseline list require a spec amendment to this section. The
`.gitignore`-honoring clause itself is the contract — what each
consuming repo's `.gitignore` actually contains is repo-local and
does not require a spec edit to evolve.

*Amended 2026-05-24 — `.gitignore`-honoring clause added (committed
files only; per-clone/per-user sources excluded by configuration).
Drove this: macOS `.DS_Store`, fetched sidecar binaries under
`product/apps/opc/src-tauri/binaries/`, and Tauri-generated
`product/apps/opc/src-tauri/gen/schemas/*.json` were leaking into
`index.json` `locations:` arrays based on the committer's local
working-tree state, producing non-deterministic regeneration on every
fresh `make setup`. The §3.7 baseline list is preserved unchanged as a
defensive floor for repos whose `.gitignore` omits the canonical build
artifact directories.*

## 4. The `references:` relationship — ninth edge, non-owning

```yaml
references:
  - role: evidence       # optional; presentation-only
    unit: { kind: symbol, id: canonical_json::canonicalize_value }
```

`references:` declares that this spec *mentions* a unit without
*owning* it. Common uses:

- **Evidence** — the spec cites the code as proof of a pattern or
  empirical observation.
- **Illustration** — the spec uses the code as a worked example
  illustrating a principle.
- **Informs** — the spec's design is shaped by the code's existence
  without constraining the code's evolution.

The optional `role:` field is **presentation-only** and is open-
vocabulary. The coupling gate treats every `references:` entry
uniformly: a referenced unit is NOT part of the spec's authority
surface, and edits to a referenced unit do NOT require an edit to
this spec.

**Existence is also non-owning** *(clarified by Segment 6, the "4'"
repair)*. Because `references:` declares no ownership, the validator
does NOT enforce target existence: an explicit
`{ kind: directory|file|crate, ... }` unit inside `references:`
whose target is absent from the worktree does NOT fire V-021/V-022/
V-023, and the codebase-indexer does NOT emit I-008/I-108/I-007 for
the same absence. Bare-string and explicit-typed entries behave
identically on the non-owning field — the surface-syntax bit
(`was_explicit`) drives existence semantics only on owning fields
(`establishes`, `extends`, `refines`, `supersedes`, `amends`,
`co_authority`, `constrains`). This makes `role: planned` (and any
other open-vocabulary role value) a viable authoring channel for
aspirational targets the spec gestures at without claiming.
Resolution still runs structurally — a `references:` unit whose
target *does* exist surfaces its `locations` in the resolved-unit
list; one whose target is absent surfaces with empty `locations`
and no diagnostic, mirroring spec 156's dangling-provenance
treatment.

The codebase-indexer surfaces references in the codebase index for
navigation and provenance (a unit might be referenced as evidence by
multiple specs without being owned by any of them).

`references:` makes **principle specs first-class**. A spec that
describes a discipline — like spec 153's invariant-freeze
interpretation, or a future serialization-ordering principle spec —
can declare `references:` to the code that exemplifies the
principle without claiming `establishes:` paths that the principle
doesn't own.

## 5. Relationship-field shape

Every relationship item carries the relationship's metadata fields
plus a `unit:`:

```yaml
establishes:
  - unit: { kind: crate, id: factory-engine }

extends:
  - spec: "002-registry-consumer-mvp"
    nature: additive
    unit: { kind: crate, id: open_agentic_spec_registry_reader }

refines:
  - aspect: json-serialization
    unit: { kind: symbol, id: open_agentic_spec_registry_reader::serialize_json_compact_or_pretty }

supersedes:
  - spec: "040-blockoli-semantic-search-wiring"
    scope: full
    # unit omitted for full supersession (replaces all of predecessor's units)

amends:
  - "047-governance-control-plane"   # bare id: owns the predecessor's spec.md, no code authority

co_authority:
  - with_specs: ["104-makefile-ci-parity-contract"]
    unit: { kind: section, file: Makefile, anchor: supply-chain }

constrains:
  - flavor: invariant-freeze
    unit: { kind: file, path: standards/schemas/spec-spine/registry.schema.json }

references:
  - role: evidence
    unit: { kind: symbol, id: canonical_json::canonicalize_value }
```

Naming notes:

- The relationship-level discriminator field uses `flavor:` where
  spec 130 used `kind:`, to avoid collision with `unit.kind`. This
  affects `constrains` and `amends`. The legacy `kind:` is accepted
  by the parser during the backwards-compatibility window (mapped to
  `flavor:`) and excised in the corpus migration.
- The legacy `co_authority.section:` and `co_authority.paths:`
  fields are accepted by the parser and synthesized into a
  `section:` unit during the compatibility window.
- The legacy bare-string form (`- "tools/foo/bar.rs"`) is accepted
  and parsed as `{ kind: file, path: "tools/foo/bar.rs" }`.
- `amends:` is a **bare-id list** (`amends: ["NNN", ...]`): it owns the
  amended spec's `spec.md` only and carries no code authority, so it takes
  no `unit:`. The whole-spec object form (`{spec, flavor}`) still parses in
  OAP but is deprecated in guidance, and a `unit:` on `amends` is inert at
  the gate. Claim code via `refines:`/`extends:`, never via `amends`
  (PR #358; the standalone spec-spine library accepts bare-id `amends`
  only). See spec 130 §2.5.

## 6. Authority computation under unit ownership

The authority function from spec 130 §5 is unchanged in shape but
operates over units instead of paths:

```
authorities(U) = {
  spec : (spec establishes U)
       ∨ (spec extends U.spec ∧ U ∈ spec.extends.units)
       ∨ (spec refines U.aspect ∧ U ∈ spec.refines.units)
       ∨ (spec co_authority U)
  ∧ ¬ ∃ later_spec :
       (later_spec supersedes spec, scope=full)
     ∨ (later_spec supersedes spec, scope=partial ∧ U ∈ later_spec.supersedes.units)
}
```

The coupling gate's diff-time check becomes:

1. **Diff hunk → logical units.** A hunk on `crates/canonical-json/src/lib.rs:35`
   reverse-resolves (via the indexer's symbol index) to
   `symbol:canonical_json::canonicalize_value` and (via the crate
   index) to `crate:canonical-json`.
2. **Spec edit → logical units.** A spec.md edit forward-resolves
   to the units the spec claims.
3. **Authority match.** The diff's unit set must intersect a spec
   edit's unit set under the authority function.

Refactor invariance is a direct consequence: file relocation that
preserves the symbol's fully-qualified path produces identical
pre/post unit sets. Crate relocation that preserves the manifest
`name` produces identical pre/post unit sets. Symbol rename or
cross-crate move produces a unit change and correctly triggers the
gate.

## 7. Rename semantics

The unit grammar treats different kinds of rename differently:

| Rename | Unit identity | Spec-relevant? |
|---|---|---|
| Move file within workspace, path changes only | `crate:` / `module:` / `symbol:` unaffected; `file:` / `directory:` / `section:` change | Only if spec claims the affected location-kind |
| Rename symbol (function/type/constant) | `symbol:` changes | Yes — symbol id is the contract |
| Move symbol to different module | `symbol:` and `module:` change | Yes |
| Rename a crate's manifest `name` | `crate:` changes | Yes |
| Reorder targets within a Makefile, anchor preserved | `section:` unaffected | No |
| Restructure a directory tree internally | `directory:` unaffected unless tree boundary moves | No |

The principle: **logical identity is what the unit declares to be
stable**. Specs wanting refactor invariance over a specific kind of
rename express ownership at the level whose identity is stable
under that rename.

## 8. Backwards-compatibility contract

This spec extends spec 130 additively. The parse-time and
runtime-resolution behavior during the migration window:

- **Bare path string** (`- "crates/foo/src/lib.rs"`) parses as
  `{ kind: file, path: "crates/foo/src/lib.rs" }`. No spec author
  must rewrite anything to keep the corpus valid.
- **Legacy `paths:` list** inside an `extends` / `refines` /
  `co_authority` item splits into multiple items, one per path,
  each carrying `unit: { kind: file, path: <X> }`.
- **Legacy `co_authority.section:`** synthesizes into
  `unit: { kind: section, file: <path>, anchor: <section> }`.
- **Legacy `constrains.kind:`** is mapped to `constrains.flavor:`.
- **A soft lint** (`L-005` — reserved) fires when a legacy
  `file:` unit could resolve cleanly to a `crate:`, `module:`, or
  `symbol:` unit. Lint, not error — migration is a separate Tier 2
  segment.

The migration window ends when the corpus-migration segment of Tier
2 completes. A subsequent segment excises the legacy parse paths
entirely; bare path strings in relationship fields become a hard
parse error pointing to this spec.

## 9. Scope

### In scope (this commit)

- Author the unit grammar in this spec (this commit lands only the
  spec.md; spec-compiler implementation is the next Tier 2 segment).
- The grammar is forward-compatible with all observed ownership
  shapes in the current corpus (dry-run results captured in the
  commit body of this commit).
- The `references:` relationship is defined here as part of the
  grammar (not as a separate spec, because its definition is
  inseparable from the unit-typed value shape).

### Out of scope (deferred to later Tier 2 segments)

- **Spec-compiler implementation** — parsing unit-typed values,
  type-checking `crate:` against workspace members, mapping legacy
  shapes to unit form. Lands in Segment 2.
- **Codebase-indexer resolver** — the symbol/module/section/file/
  directory/crate resolution pipeline that produces the typed
  resolved graph. Lands in Segment 3.
- **Coupling gate refactor** — consuming the resolved graph instead
  of the path list. Lands in Segment 4.
- **Corpus migration** — converting every spec's relationship fields
  from path lists to unit-typed declarations. Lands in Segment 5.
  Folds in deferred Tier 1 items (Spec 151 co_authority cleanup;
  spec_scanner `supersedes`/`constrains` walk — both become
  structural under the resolved-graph world).
- **Legacy excision** — removing the bare-path-string parse path and
  the soft lint. Lands in Segment 6.

## 10. Acceptance

- This spec parses cleanly under the existing spec-compiler (no
  schema change is needed for spec.md authoring; the schema change
  for unit-typed values lands in Segment 2).
- The grammar covers all observed ownership shapes across the
  representative-spec dry-run captured in this commit's body.
- `registry-consumer show 154-logical-unit-ownership-grammar` returns
  a well-formed feature record.
- `registry-consumer validate-graph` returns no problems.
- `spec-code-coupling-check` passes (this commit touches only
  spec.md + derived files).

## 11. Cross-references

- **Spec 130** (extended by this spec) — the eight-relationship graph
  whose values gain typing here.
- **Spec 153** — invariant-freeze backward-compatibility framing;
  enables this spec's additive schema change.
- **Spec 132** — constitutional invariant-freeze; canonical instance
  whose interpretation is unchanged in surface and refined by spec
  153's amendment to spec 130.
- **Spec 152** — path-co-authority; section-anchor semantics consumed
  by this spec's `section:` unit kind.
- **Spec 127** — spec-code-coupling-workflow; the workflow surface
  consuming the resolved graph after Segment 4 lands.
- **Spec 133** — coupling-gate; authority-derivation algorithm
  refactored to consume units in Segment 4.
- **Tier 1 cleanup PR** (open at commit time) — motivating empirical
  case for the redesign; carries the canonical Spec-Drift-Waiver
  precedent that the unit grammar eliminates structurally.

## 12. Closure — Segments 1–6 landed

Spec 154 ships across six segments, each landing as a separate commit
on `main`. This section is the close-out record (amendment 2026-05-22
flipping `implementation: pending → complete`).

| Segment | Surface | Commit |
|---|---|---|
| 1 | `LogicalUnit` enum on `tools/shared/spec-types` and round-trip serialisation | (initial spec landing) |
| 2 | Spec-compiler typed-unit parser + V-021..V-024 validation rules | (compiler integration) |
| 3 | Codebase-indexer resolver — per-kind dispatch, symbol/module index, anchor parsers (Makefile, workflow YAML, region marker, markdown heading) | `bfa6e060` (resolved-unit API surface, Segment 4 commit groups Segment 3 lands too) |
| 4 | `tools/spec-spine/spec-code-coupling-check` resolved-unit API surface; coupling gate consumes the resolver | `bfa6e060` feat(spec-code-coupling-check): spec 154 Segment 4 |
| 5 | Corpus migration to typed logical-unit declarations (142 spec.md files migrated; one-shot `tools/oap/spec-unit-migrate` retained as historical artifact) | `beb1e3e6` feat(spec-154): Segment 5 — corpus migration |
| 6 | Orphan resolution + legacy excision (this segment) | (this commit) |

**Segment 6 in detail.** Eighty I-101 / I-108 orphans cleared across
the corpus, then the bare-string `establishes:` parse arm and the
legacy `extends/refines/supersedes/co_authority/constrains/amends.paths`
sub-list arms were excised from `tools/spec-spine/spec-compiler/src/lib.rs`.
L-005 promoted from `info` to `error` severity; I-108 retired
(`MissingFile` now always emits the blocking I-008 regardless of
authoring shape). `RegionMarkerParser` extended to accept the
`# region:` prefix for shell / YAML / TOML / `.env` files per spec 152 §2.1.
The anchor-parser dispatch routes `.yaml` files by path: workflow YAML
(`.github/workflows/`) gets the `jobs.<name>` parser; every other YAML
gets the region-marker parser.

**The 4' refinement.** Mid-segment, the original handoff's
recommendation that aspirational paths move to `references:role:planned`
collided with the existing validator: explicit-typed units inside
`references:` fired V-021..V-023 just like owning fields. The user
clarified the intended semantics — references is non-owning by design
(spec 154 §4), so existence validation should route off the wrapping
field rather than the unit's surface syntax. §4 was amended with an
"existence is also non-owning" paragraph; `parse_references_field` in
the spec-compiler and `build_resolved_unit` in the codebase-indexer
were both updated to skip existence diagnostics for `references:`
entries. Tests pin both layers
(`references_explicit_units_skip_existence_validation`,
`references_field_skips_existence_diagnostics`).

**V-020 widened.** Spec-lint's V-020 ("spec lacks relationship fields")
was a seven-edge check; spec 154 §4 added `references:` as the ninth
edge. Segment 6 widened V-020 to count `references:` (and
`superseded_by:` / `composition.requires:` / `selects:` for the
governance-lifecycle and profile-spec cases) as relationship-satisfying.
This keeps the corpus clean after approved-complete specs move their
eroded code surface from `establishes:` to `references:role:historical`.

**Post-excision orphan disposition.** Drafts that intend to land
crates use `references:role:planned`. Approved-complete specs whose
code paths were refactored away use `references:role:historical`.
Approved-deferred use `references:role:deferred`. Path-moved cases
were fixed in place (typo in spec 144 — `crates/Cargo.lock` →
`Cargo.lock`). Superseded specs (038, 040, 088) had their bare-string
`establishes:` entries deleted entirely. Spec 151 lost its
`values-hetzner.yaml` co-authority entry (the file is intentionally
deleted as part of its own migration; the spec body documents this in
§13 — the co-authority claim was vestigial).

**Toolchain state at closure.** `make pr-prep` clean. `cargo test
--release --workspace` clean (1469 tests passed, 0 failed). Compiler
validation passes with zero violations. Codebase index has zero
warnings and zero errors. Spec-lint `--fail-on-warn` exits 0.


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

**Amendment 2026-06-14 (record: 216-spec-spine-library-grammar-adoption).**
Spec 216 Phase 1 formalises the 2026-06-14 bare-id `amends` clarification
callout in §5 (added by PR #358) as a spec-recorded amendment, and converges
the OAP spec-compiler onto the bare-id grammar this section documents: a
non-string `amends` entry is now a hard V-033 compile error rather than the
former silent empty-list collapse. No change to this spec's `amends` shape
(it already specified bare-id); the convergence is on the compiler's failure
mode only.
