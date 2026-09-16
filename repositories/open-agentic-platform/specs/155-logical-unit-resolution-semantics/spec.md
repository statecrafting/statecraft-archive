---
id: "155-logical-unit-resolution-semantics"
slug: logical-unit-resolution-semantics
title: "Logical-unit resolution semantics — precision fixes surfaced by Segment 3 design"
status: approved
implementation: complete  # Commit A (spec landing + spec 154 §§3.2/3.3/3.5/3.6 amendments + Segment 3 design doc OQ-1..OQ-4 closures) landed at b941bf60; Commit B (V-024 predicate rejecting `<` / `>` in `kind: symbol` id + regression tests v024_fires_on_symbol_id_with_generics, v024_fires_on_symbol_id_with_lifetime, v024_does_not_fire_on_clean_symbol_path, v024_does_not_fire_on_symbol_with_underscore_and_digit) landed at fda92edc. Merged via PR #185 (2eda5720, 2026-05-21). All §5 acceptance criteria verified verbatim 2026-05-22: amended language is in spec 154 (lines 195-322), `amended: "2026-05-22"` + `amendment_record: "155-logical-unit-resolution-semantics"` in 154's frontmatter, in-body callouts present in each amended section, V-024 fires on Foo<T> per LogicalUnitParseError::SymbolIdNotItemPath at tools/shared/spec-types/src/lib.rs:355+462, V-011 does not fire (spec 154 has no `unamendable:` list), Segment 3 design doc header line 5 records OQ-1..OQ-4 closure by spec 155, codebase-indexer check exit=0.
closed: "2026-05-22"
amends: ["154-logical-unit-ownership-grammar"]
amends_sections:
  - "symbol-kind"
  - "module-kind"
  - "directory-kind"
  - "file-kind"
owner: bart
created: "2026-05-21"
approved: "2026-05-21"
amended: "2026-06-18"
amendment_record: |
  amended 2026-06-18 by spec 217 (engine-swap collapse): the in-tree spec-compiler that housed the V-024 unit-resolution predicate was deleted; that logic is now in spec-spine-core/types. The spec-compiler test edge is stripped (path deleted); the spec-types overlay edge (where the resolution rules live) survives.
kind: governance
domain: substrate
risk: low
depends_on:
  - "154-logical-unit-ownership-grammar"
code_aliases: ["UNIT_RESOLUTION_SEMANTICS"]
# 217 deleted the in-tree spec-compiler; the V-024 unit-resolution predicate this spec
# added is now in spec-spine-core/types. The spec-compiler test edge is stripped (path
# deleted); the spec-types overlay edge (where the resolution rules live) survives.
# Amended by 217.
extends:
  - spec: "001-spec-compiler-mvp"
    nature: additive
    unit: { kind: file, path: tools/shared/spec-types/src/lib.rs }
references:
  - role: motivating-case
    unit: { kind: file, path: specs/154-logical-unit-ownership-grammar/segment-3-design.md }
summary: >
  Spec 154's Segment 3 design pass surfaced four sites where the unit
  grammar's prose left resolution behavior under-specified. §3.2
  (`symbol:`) does not distinguish a Rust path (an item identifier)
  from a type expression (a path with generic parameters), letting
  two authors target the same symbol with different surface syntax —
  the conflation the Tier 2 sequence exists to eliminate. §3.3
  (`module:`) and §3.5 (`directory:`) are silent on the
  missing-unit case, while §3.1 (`crate:`), §3.2 (`symbol:`), and §3.4
  (`section:`) explicitly state hard error; silence on three of six
  kinds produces incoherent asymmetry. §3.6 (`file:`)'s rename-trace
  exception is correct at gate time but ambiguous at compile time
  where no diff is available. This spec amends 154 §§3.2, 3.3, 3.5,
  and 3.6 with precise language. The amendments are strictly
  clarifying — every existing unit declaration valid under 154's
  prior reading remains valid — and unblock Segment 3 implementation
  by closing the silences before code lands.
---

# 155 — Logical-unit resolution semantics

## 1. Problem

Spec 154 §3 defines six logical-unit kinds with per-kind resolution
behavior. The Segment 3 design pass (read-only, architect-agent,
[`segment-3-design.md`](../154-logical-unit-ownership-grammar/segment-3-design.md))
surfaced four sites where the prose underspecifies resolution and
produces decisions-by-stealth at implementation time:

- **§3.2 (`symbol:`) on generics.** The text reads "fully-qualified
  Rust path" without distinguishing a path (item identifier) from a
  type expression (path with generic parameters). Two authors writing
  `canonical_json::Foo` and `canonical_json::Foo<T>` target the same
  underlying item via different surface syntax. The resolver's symbol
  index keys items by their path, not by type expressions, so both
  declarations would silently resolve to the same location — the
  exact conflation Tier 2 is built to eliminate. The spec must reject
  type-expression syntax in `id`, not silently normalize.

- **§3.3 (`module:`) on missing modules.** The resolution bullet
  ("Look up the module in the codebase-indexer's module index")
  does not state what happens when the lookup fails. §3.1 and §3.2
  state "hard error" explicitly; §3.3 is silent. Implementations
  that pick soft-warn would produce asymmetry across the six kinds
  without spec basis.

- **§3.5 (`directory:`) on missing directories.** §3.5's resolution
  bullet ("Resolves to the glob `<path>/**`") similarly does not
  state what happens when `<path>` does not exist as a directory in
  the worktree. The plausible reading "the glob expands to the empty
  set, no error" silently swallows broken declarations. §3.1 and §3.6
  hard-error on missing crates and missing files; §3.5 must be
  symmetric.

- **§3.6 (`file:`) on rename-trace evaluation timing.** §3.6 says
  "Missing file is a hard error unless the diff has a git rename
  trace covering it." This is correct in the coupling gate's diff
  context (where a diff is available) but ambiguous in the
  `codebase-indexer compile` context (where there is no diff and
  therefore no rename trace to consult). The resolver is a pure
  function of worktree state; rename-trace following is a property of
  the gate's diff-walk, not the resolver. The text needs a one-line
  clarification stating where the trace evaluation lives.

The Segment 3 design doc flagged all four as open questions
(OQ-1, OQ-2, OQ-3, OQ-4) and refused to proceed to implementation
until they were closed in the spec — the
`feedback_pre_implementation_spec_amendments` discipline applied
to a concrete case.

## 2. Amendment

### 2.1 §3.2 (`symbol:`) — generics

The phrase "fully-qualified Rust path" in §3.2 is replaced with:

> Identifies a single named symbol (function, type, constant, trait)
> by **fully-qualified Rust item path**. The `id` carries the path
> only — the sequence of `::`-separated identifiers naming the item.
> `id` values containing `<` or `>` are rejected at parse time.
> These characters appear only in type-expression, turbofish, or
> qualified-path syntax — none of which are part of an item's path
> identity. V-024 (malformed unit declaration) is amended to fire
> on `kind: symbol` units whose `id` contains `<` or `>`.

The §3.2 resolution bullet retains its existing "Missing symbol is a
hard error" wording.

### 2.2 §3.3 (`module:`) — missing-module behavior

The §3.3 resolution bullets are amended to mirror §3.1 and §3.2
exactly:

> - Look up the module in the codebase-indexer's module index.
> - Resolves to the file range corresponding to the module's
>   declaration. For file-modules, the range is the whole file
>   (`<module>.rs` or `<module>/mod.rs`). For inline modules, the
>   range is bounded by the module's declaration site; exact span
>   boundary is a resolver implementation concern (see Segment 3
>   design doc, OQ-7). **Missing module is a hard error.**

### 2.3 §3.5 (`directory:`) — missing-directory behavior

The §3.5 resolution bullet is amended to mirror §3.1 and §3.6:

> - Resolves to the glob `<path>/**` excluding the resolver's
>   standard exclusion set (§3.7). **Missing directory is a hard
>   error.**

The plausible objection — "a spec might claim a directory created in
the same commit as the spec edit" — does not apply: the resolver runs
against the worktree at compile time, which is post-creation. A
directory absent at compile time is a broken declaration of the same
class as a missing crate or missing file.

### 2.4 §3.6 (`file:`) — rename-trace timing clarification

The §3.6 resolution paragraph is amended to add a clarifying sentence
after the existing rename-trace sentence:

> Identifies a single file. Resolution: literal path match in the
> worktree. Missing file is a hard error unless the diff has a git
> rename trace covering it (in which case the resolver follows the
> rename). **Rename-trace evaluation is a property of the coupling
> gate's diff context, not the resolver's compile context: during
> `codebase-indexer compile`, where no diff is available, a missing
> file is unconditionally a hard error.**

This makes explicit the resolver's status as a pure function of
worktree state. Diff-aware semantics live in the gate (spec 133, and
spec 154's Segment 4).

## 3. Scope

### In scope (this spec)

This spec is the amendment text. Implementation lands in two adjacent
commits:

**Commit A — spec landing (this spec text):**

- Add spec 155 (this file) declaring the amendments per §2.
- Apply the amended language to spec 154 §§3.2, 3.3, 3.5, 3.6 in
  place per §2.
- Set spec 154's `amended:` and `amendment_record:` frontmatter
  fields.
- Add in-body callouts in each amended section of spec 154 pointing
  here.
- Regenerate `.derived/codebase-index/index.json` (new spec + edited
  154 are codebase-indexer inputs; staleness gate covers this).

**Commit B — enforcement (V-024 amendment):**

- Update `tools/spec-spine/spec-compiler/src/lib.rs`'s V-024
  predicate to fire on `kind: symbol` units whose `id` contains
  `<` or `>`.
- Add a regression test asserting V-024 fires on
  `{ kind: symbol, id: "Foo<T>" }` and does not fire on the
  cleanly-pathed control case.

Both commits land in the same PR or branch, in sequence (A before B).
The amend-FIRST-then-implement discipline is satisfied: amendment
text is authoritative before the predicate change that enforces it.

### Out of scope (and intentionally so)

- **Segment 3 resolver implementation.** This spec is a precursor;
  the resolver lands separately.
- **A re-do of Segment 2.** PR #183's V-021..V-024 implementation
  remains correct. Only the V-024 case for `kind: symbol` gains the
  new generic-parameter rejection.
- **The other three OQs from the Segment 3 design.** OQ-5 (schema
  consumer compatibility), OQ-6 (tree-sitter grammar vendoring),
  and OQ-7 (inline-module span boundary) are mechanical
  verification or implementation-detail decisions, not spec-shape
  questions. They are closed in the Segment 3 design doc itself,
  not here.

## 4. Consequences

### For spec 154

The four amended sections gain precise resolution rules. Every
existing unit declaration in the corpus that was valid under the
prior reading remains valid: the corpus today contains no `kind:
symbol` units with generic-parameter syntax (Segment 2's V-021..V-024
parse-then-typecheck pass would have surfaced any), no `kind: module`
or `kind: directory` declarations pointing at non-existent units, and
no `kind: file` declarations whose validity hinged on a compile-time
rename-trace reading. The amendments are clarifying, not narrowing.

### For Segment 3 implementation

All four OQs in
[`specs/154-logical-unit-ownership-grammar/segment-3-design.md`](../154-logical-unit-ownership-grammar/segment-3-design.md)
§11 (OQ-1 through OQ-4) are now closed by spec authority. The design
doc gets a follow-up edit to incorporate the amended language and
remove the OQ-1..OQ-4 entries before implementation begins.

### For invariant-freeze (spec 130 §2.7 / spec 153)

This spec exercises spec 153's "strictly additive evolution preserves
backward compatibility" framing. The amendments add precision to
existing rules; they do not narrow the accepted set, redefine the
semantics of previously-valid documents, or remove surface. The
invariant-freeze on
`standards/schemas/spec-spine/registry.schema.json` is undisturbed:
no schema field is added, removed, or retyped.

### For V-024 in spec-compiler

V-024's existing condition set ("malformed unit declaration —
unknown `kind:` value, missing required field for the declared kind,
or not a string / mapping shape") gains one additional sub-condition
for `kind: symbol`: `id` containing `<` or `>` is malformed. The
existing V-024 emission path covers the new case; only the predicate
expands. Implementation lands in the same commit as this spec.

## 5. Acceptance

- Spec 154 §§3.2, 3.3, 3.5, 3.6 carry the amended language verbatim
  per §2.
- Spec 154's frontmatter declares `amended: "2026-05-21"` and
  `amendment_record: "155-logical-unit-resolution-semantics"`.
- Each amended section has an in-body callout pointing to this spec.
- Spec-compiler V-024 fires on `{ kind: symbol, id: "Foo<T>" }` with
  a clear message naming the generic-syntax violation. A regression
  test covers the case.
- Spec-compiler accepts this spec (V-011 does not fire — spec 154 has
  no `unamendable:` list).
- The Segment 3 design doc is updated to incorporate the amended
  language and close OQ-1..OQ-4.
- Codebase index regenerated; staleness gate green.

## 6. Cross-references

- **Spec 130** — spec-relationship-graph; spec 154 extends 130's
  relationship-field shape with logical units.
- **Spec 153** — invariant-freeze backward-compatibility framing;
  this amendment exercises that framing on a concrete additive case.
- **Spec 154** — logical-unit ownership grammar; the spec amended by
  this one. §§3.2, 3.3, 3.5, 3.6 carry the precise language after
  this amendment lands.
- **Spec 154 Segment 3 design doc** —
  [`specs/154-logical-unit-ownership-grammar/segment-3-design.md`](../154-logical-unit-ownership-grammar/segment-3-design.md);
  motivating-case for this amendment; updated to close OQ-1..OQ-4
  as part of this spec's closure.
- **Auto-memory:** `feedback_pre_implementation_spec_amendments` —
  the user-mandate that motivated this spec being authored as a
  precursor to Segment 3 rather than as a code-level decision. (See
  `~/.claude/projects/-Users-bart-Dev2-open-agentic-platform/memory/`.)
