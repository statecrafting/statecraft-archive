---
id: "181-registry-consumer-unit-grammar-authority"
slug: registry-consumer-unit-grammar-authority
title: "registry-consumer authority resolver — unit-grammar parity with spec 154"
status: superseded
superseded_by: "217-spec-spine-engine-swap-collapse"
implementation: complete
owner: bart
created: "2026-05-24"
approved: "2026-05-24"
completed: "2026-05-24"
amended: "2026-06-15"
amendment_record: "216-spec-spine-library-grammar-adoption"
kind: governance
domain: substrate
risk: low
amends:
  - "034-featuregraph-registry-scanner-fix"
amends_sections: []
depends_on:
  - "002-registry-consumer-mvp"  # registry-consumer-mvp (the resolver this spec refines)
  - "130-spec-coupling-primary-owner"  # spec-relationship-graph (typed edges this spec must consume; canonical mixed-shape exemplar)
  - "152-path-co-authority"  # path-co-authority (section-anchor unit grammar)
  - "154-logical-unit-ownership-grammar"  # logical-unit-ownership-grammar (the unit shape this spec adds support for)
  - "155-logical-unit-resolution-semantics"  # logical-unit-resolution-semantics (path resolution rules the resolver must honor)
  - "180-opc-shell-codification"  # opc-shell-codification (the canonical regression case this spec unblocks)
code_aliases:
  - "AUTHORITY_RESOLVER_UNIT_GRAMMAR"
# 217 deleted the in-tree registry-consumer crate; the authority-resolver unit-grammar
# this spec refined is re-implemented in oap-registry-enrich (the by-authority verb).
# The refines code-unit is removed (path deleted); the 002 lineage (refines_specs) is
# retained. Superseded by 217.
refines:
  - aspect: "authority-resolver-unit-grammar-parity"
    refines_specs: ["002-registry-consumer-mvp"]
references:
  - role: forcing-function
    unit: { kind: file, path: specs/180-opc-shell-codification/spec.md }
  - role: unit-grammar-source
    unit: { kind: file, path: specs/154-logical-unit-ownership-grammar/spec.md }
  - role: graph-grammar-source
    unit: { kind: file, path: specs/130-spec-coupling-primary-owner/spec.md }
  - role: section-anchor-source
    unit: { kind: file, path: specs/152-path-co-authority/spec.md }
  - role: mixed-shape-exemplar
    unit: { kind: file, path: specs/130-spec-coupling-primary-owner/spec.md }
summary: >
  `registry-consumer`'s `authority_for_path` resolver
  (`tools/spec-spine/registry-consumer/src/lib.rs`) consumes only the
  legacy frontmatter shapes — `establishes: [<string>]` and `<edge>:
  [{ paths: [...] }]` for `extends` / `refines` / `co_authority`.
  Every post-154 spec's authority claims that use the typed unit
  grammar (`unit: { kind: ..., path: ... }`, per spec 154 §3) are
  invisible to `by-authority` queries even though the registry holds
  the claims. The canonical post-154 specs already shipping include
  172 (`opc-live-agent-session-introspection`), 174
  (`codification-gate`), 178 (`opc-directory-rename`), and 180
  (`opc-shell-codification`); none of their authority claims resolve
  through `by-authority` today. This spec binds parity: the resolver
  MUST consume both shapes across the four typed authority-bearing
  edges, preserve the section-anchor filter via spec 154's
  `kind: section` unit kind on `co_authority`, and demonstrate the
  parity by surfacing spec 180's `establishes:` claims through
  `by-authority` after implementation.
---

# 181 — registry-consumer authority resolver: unit-grammar parity

## 1. Problem

Spec 154 introduced the typed logical-unit grammar in 2026-05-19. By
2026-05-24 the unit-grammar form had been adopted across all post-154
specs as the canonical way to declare authority on the four bearing
edges (`establishes`, `extends`, `refines`, `co_authority`).

The reader surface — `tools/spec-spine/registry-consumer/src/lib.rs`
— was not migrated alongside. Its `authority_for_path` function
(`lib.rs:1398-1497` at time of authoring) consumes only the legacy
shapes:

```yaml
# Legacy — recognised by authority_for_path today
establishes:
  - crates/foo/src/lib.rs        # string entry
extends:
  - spec: "010-base"
    nature: additive
    paths: [crates/foo/src/lib.rs]  # paths: array
```

```yaml
# Unit grammar (spec 154) — NOT recognised by authority_for_path today
establishes:
  - unit: { kind: file, path: crates/foo/src/lib.rs }
extends:
  - spec: "010-base"
    nature: additive
    unit: { kind: file, path: crates/foo/src/lib.rs }
```

The asymmetry is empirical: querying `by-authority` on any path
claimed by 172, 174, 178, or 180 returns *"No specs claim authority
over"* even though the registry contains the claim. The gate's
authority view is therefore stale relative to the registry's
content; downstream consumers (orchestration, documentation
generation, coupling-gate diagnostics that consult the resolver) see
a thinner authority graph than the corpus actually declares.

The gap was identified during the authoring of spec 180 (the OPC
shell codification), which is the densest unit-grammar exerciser in
the corpus (15 `establishes:` entries + 3 `refines:` entries, all
unit-grammar form). Spec 180's AC-4 had to be reframed from "queries
resolve" to "registry holds the claim" because the resolver doesn't
see them. Spec 181 closes that gap as a direct precondition to
spec 180's full acceptance.

### 1.1 Why this is its own spec

The Phase 1 brief for spec 180 explicitly excluded source-file
edits: *"Modify any source file beyond `Cargo.toml` / `package.json`
for `oap.spec` claims"* is in the "What you will not do" list. The
brief existed to maintain the cognitive-posture firewall between
codification authoring (Phase 1) and implementation (Phase 2);
bundling a resolver fix into spec 180's PR would have violated that
firewall on a "small enough = exempt" basis — exactly the appetite
the spec/code coherence policy (CONST-005) defends against.

Spec 181 is the disciplined alternative: surgical, single-file, with
the test scaffolding already in place at `lib.rs:2256+`. It lands
*before* spec 180 so that 180's AC-4 can be verified empirically
rather than reframed as hollow.

## 2. Decision

`authority_for_path` MUST treat the unit-grammar form and the legacy
form as **equivalent inputs** for every authority-bearing edge it
consumes. Both shapes coexist in the corpus today (spec 130 is the
canonical mixed-shape exemplar — `git grep` confirms it carries both
`paths:` array entries and `unit:` typed entries across its
relationship fields) and the function MUST handle either shape
within the same edge array.

The migration is **strictly additive** per spec 153's invariant-
freeze framing: every authority claim the resolver accepts today
MUST continue to be accepted; the change widens the accepted-input
set without redefining the semantics of previously-accepted claims.

## 3. Functional Requirements

### FR-001 — `establishes:` parity

`authority_for_path(path, _)` MUST treat a path P as established by
spec X when X's `establishes:` array contains *either*:

- a string entry equal to P (legacy), **or**
- an object entry whose `unit.path` equals P **and** whose
  `unit.kind` is one of `{file, directory}` (spec 154 unit grammar
  for ownership-bearing kinds).

Mixed-shape arrays — one entry legacy-string, one entry unit-object,
in the same `establishes:` list — MUST be supported. Both entries
contribute to the established-set.

### FR-002 — `extends:` / `refines:` / `co_authority:` parity

Same parity for the three remaining authority-bearing edges. Each
entry MUST be checked for both:

- a legacy `paths: [<string>, ...]` array on the entry, **and**
- a unit-grammar `unit: { kind: file|directory, path: ... }` on the
  entry.

For `extends:` and `refines:`, both shapes contribute to the
authority set identically. For `co_authority:`, the parity carries
into the section-filter case (see FR-003).

### FR-003 — `co_authority:` section-filter preservation

Spec 152 §2.1 establishes the section-anchor mechanism. In the
legacy form, a section anchor sat as a sibling `section:` field on
the `co_authority:` entry alongside `paths:`. In the unit grammar
(per spec 154 §3 and spec 152's own frontmatter), the section
anchor is encoded *inside* the unit object as
`unit: { kind: section, file: <path>, anchor: <name> }`.

When `authority_for_path(P, Some(S))` is called against a unit-grammar
`co_authority:` entry:

- The entry matches when `unit.kind == "section"`, `unit.file == P`,
  and `unit.anchor == S`.
- A unit-grammar entry with `unit.kind ∈ {file, directory}` (no
  anchor) matches when `unit.path == P` and the caller's `S` is
  ignored (whole-file co-authority).
- The legacy section-filter behaviour is unchanged.

### FR-004 — legacy preservation (no regression)

The existing `authority_for_path_*` test family at
`tools/spec-spine/registry-consumer/src/lib.rs:2256+` MUST continue
to pass without modification. Legacy `paths:` / string-entry
consumption is not deprecated by this spec; the legacy shape remains
the primary form the existing corpus uses on pre-154 specs.

### FR-005 — new test coverage

New unit tests MUST be added — at minimum one
`authority_for_path_<edge>_unit_grammar` test per authority-bearing
edge:

- `authority_for_path_establishes_unit_grammar`
- `authority_for_path_extends_unit_grammar`
- `authority_for_path_refines_unit_grammar`
- `authority_for_path_co_authority_unit_grammar` (file/directory
  unit kind)
- `authority_for_path_co_authority_section_unit_grammar`
  (section unit kind, with `section: Some(s)` argument and
  positive + negative match cases)
- `authority_for_path_mixed_shapes` — fixture where one spec's
  `establishes:` array carries one legacy string entry and one
  unit-grammar object entry, and both paths resolve to the same
  spec. Spec 130 is the corpus-side mixed-shape exemplar; the
  fixture mirrors its structure synthetically.

### FR-006 — canonical regression case

After this spec's implementation lands, `registry-consumer
by-authority product/apps/opc/src/lib` MUST return
`180-opc-shell-codification`. The same property MUST hold for every
other unit-grammar path 180 establishes (e.g.,
`product/apps/opc/src/services`, `product/apps/opc/src/stores`,
`product/apps/opc/src-tauri/src/commands/usage.rs`), AND for the
three files 180 refines (`TabContent.tsx`, `TabContext.tsx`,
`useTabState.ts`).

This is the empirical demonstration the gap is closed: spec 180 is
the densest unit-grammar exerciser in the corpus, so verifying its
claims resolve doubles as a regression test for the broader resolver
work.

Spec 180's AC-4 is re-runnable against the post-181 reader without
modification to spec 180; the reframing in 180's current AC-4
("registry holds the claim") was conservative for the pre-181
reader. After 181 lands, 180's authority claims are queryable
substantively.

### FR-007 — incoming-edge derivation untouched

This spec MUST NOT modify:

- `refines_spec_refs` at `lib.rs:741+`
- `extends_spec_refs`, `supersedes_spec_refs`, `amends_spec_refs`,
  `co_authority_spec_refs`, `constrains_spec_refs` (the spec-level
  edge extractors)
- The incoming-edge derivation block at `lib.rs:1266-1295`

Those functions already consume the spec-level link via the
`refines_specs:` / `extends.spec:` / etc. fields and are correct
as-is (verified during spec 180 authoring: adding
`refines_specs: ["172-..."]` to 180's `refines:` entries made
`show-relationships 172` surface 180 as an incoming refines edge).
Scope of this spec is `authority_for_path` and any private helpers
it calls.

### FR-008 — scope discipline (single-tool change)

No edits to:

- `tools/spec-spine/spec-compiler/`
- `tools/spec-spine/codebase-indexer/`
- `tools/spec-spine/spec-code-coupling-check/`
- Any consumer of the registry outside `registry-consumer`

If parity work in those tools surfaces during implementation
(e.g., the coupling-gate's own authority view is independently
stale), that finding is **out of scope** and surfaced as a follow-up
spec, not absorbed into this spec's diff.

### FR-009: `supersedes:` parity (amended by spec 216 Phase 2b)

This spec's original FR set covered `establishes` / `extends` / `refines`
/ `co_authority`; `supersedes` was deliberately excluded. Spec 216 Phase 2b
(FR-013) amends `authority_for_path` to recognise the `supersedes` edge so
the query surface reports the same `authorities(P)` the coupling gate
enforces (spec 133 §3.2):

- A **partial**-scope `supersedes` entry confers visible authority on the
  successor over its `unit:` (relationship `supersedes`), reusing the same
  file/directory unit matching as `extends`/`refines`. A bare-string /
  `scope: full` entry confers no per-unit authority.
- The partially-superseded predecessor is **removed** from the path's
  authority set when a live successor supersedes it over that path. Full
  supersession is already excluded (the pre-existing `status == superseded`
  skip in `authority_for_path`).
- The `show-relationships` supersedes reader (`build_outgoing_edges`)
  surfaces the `unit:`-resolved path alongside legacy `paths:`.

This stays within FR-008's single-tool discipline (the change is confined
to `registry-consumer`). The companion gate-side filtering and the
codebase-index `supersedes` field that powers it live in spec 216 Phase 2b
(FR-010..FR-012) and spec 133 §3.2.

## 4. Acceptance

- **AC-1.** `cargo test --release --manifest-path
  tools/spec-spine/registry-consumer/Cargo.toml` passes. All
  pre-existing `authority_for_path_*` tests pass unmodified
  (FR-004); the six new tests required by FR-005 pass.
- **AC-2.** `make pr-prep` exits clean against `origin/main`.
- **AC-3.** `cargo run --release --manifest-path
  tools/spec-spine/spec-lint/Cargo.toml -- --fail-on-warn` exits 0;
  V-020 does not fire on this spec.
- **AC-4.** Empirical regression: after this spec's implementation
  lands, the following queries all return the expected authority:

  ```bash
  registry-consumer by-authority product/apps/opc/src/lib
  # → 180-opc-shell-codification

  registry-consumer by-authority product/apps/opc/src-tauri/src/commands/usage.rs
  # → 180-opc-shell-codification

  registry-consumer by-authority product/apps/opc/src/components/TabContent.tsx
  # → 180-opc-shell-codification (via refines)

  registry-consumer by-authority product/apps/opc/src/components/LiveSessionsPanel.tsx
  # → 172-opc-live-agent-session-introspection (via establishes)

  registry-consumer by-authority tools/oap/codification-gate
  # → 174-codification-gate (via establishes, kind: directory)
  ```

  Each query is documented in the spec's implementation tasks as a
  manual smoke-test step.

- **AC-5.** Spec 180's AC-4 is updated in a follow-up commit to
  remove the "pre-existing substrate gap" disclaimer and assert
  empirical resolution. (Out of scope for this PR; tracked as the
  immediate next action after 181 merges.)

## 5. Scope

### In scope (this spec)

- The four-edge parity refactor inside `authority_for_path`.
- The section-anchor adaptation for `kind: section` unit form.
- The six new tests.
- The mixed-shape coexistence test fixture.

### Out of scope

- **Parity in other consumers.** The codebase-indexer, the
  coupling-gate's own authority computation, the OAP enrichment
  surface (`tools/oap/oap-registry-enrich`), and any downstream
  consumer are out of scope. Each is its own audit; surfacing them
  is FR-008's permitted exit, not an in-scope extension.
- **Spec corpus migration.** Existing legacy-form claims remain
  legitimate (FR-004 preservation). This spec does NOT mandate
  rewriting pre-154 specs to the unit grammar. Any such migration
  is a separate spec under spec 154's grammar-adoption posture.
- **`origin: retroactive: true` audit.** Spec 130's mixed-shape
  pattern surfaces a question about whether the post-154 graph
  excision (constitution "Migration posture" §) has stalled at
  partial adoption; the question is real but separate from this
  resolver fix.
- **Surfacing the resolver gap in CI.** A CI-level guard that
  fails when `authority_for_path` returns empty for a path the
  registry knows about would close the discoverability gap
  structurally. That is a future spec — possibly a parity test
  walking the registry and asserting every unit-grammar claim
  resolves through `by-authority` — but it requires post-181's
  reader to be the green baseline.

## 6. Ordering and PR sequence

This spec lands **before** spec 180. The merge sequence:

1. **PR for spec 181** (this spec) — adds the resolver-fix spec to
   the corpus. No implementation in the same PR; the PR is the
   spec only.
2. **Implementation PR** — the ~50 line Rust diff + tests against
   spec 181's contract. Lands after spec 181 is approved.
3. **PR for spec 180** (the OPC codification) — lands with AC-4
   in its current ("registry holds the claim") form. The
   acceptance text is re-verified after step 2's implementation
   lands.
4. **Follow-up commit** — minor edit to spec 180's AC-4 removing
   the pre-existing-gap disclaimer once empirical resolution holds.

The ordering means spec 180 ships with a forward reference to a
just-landed parity fix; the dependency is honest and walkable via
`registry-consumer show-relationships`.

The alternative (land 180 first, then 181) leaves 180 in the
"hollow AC-4" state for the duration of 181's review cycle.
Preferring the cleaner ordering is a small operational cost
in exchange for spec 180 shipping with substantively-meeting
acceptance criteria from day one.

## 7. Risks and mitigations

- **Risk:** The implementation widens `authority_for_path` to
  consume both shapes but introduces a subtle behavioural change in
  edge cases (e.g., a malformed unit-grammar entry that happens to
  match an unintended path).
  **Mitigation:** FR-005's test coverage requires both positive
  matches AND a mixed-shape coexistence fixture. Edge cases that
  diverge from spec 154 §3's resolution rules are caught at
  spec-compiler time via V-021..V-024 (per spec 154 Segment 2 and
  spec 155's amendments) — by the time the unit reaches
  `authority_for_path`, the unit is grammar-clean.

- **Risk:** Section-anchor handling on `kind: section` units
  diverges from spec 152's intent because spec 152's section
  semantics predate the unit-grammar form and the migration may
  have lost nuance.
  **Mitigation:** Spec 152 §2.1's anchor-syntax table is normative.
  FR-003 cites it explicitly. Section-filter tests (FR-005) cover
  positive + negative match cases.

- **Risk:** Spec 130's mixed-shape exemplar turns out to be a
  transitional state that should have been cleaned up rather than
  preserved as a permanent pattern.
  **Mitigation:** Out of scope (§5). The resolver MUST support the
  pattern as it exists in the corpus today; whether the corpus
  should converge to a single shape is a separate authoring
  decision.

## 8. Cross-references

- **Spec 002** — registry-consumer MVP; the resolver this spec
  refines.
- **Spec 130** — spec-relationship-graph; defines the eight typed
  edges. Mixed-shape exemplar in the current corpus.
- **Spec 152** — path-co-authority; section-anchor unit grammar
  (the `kind: section` unit kind).
- **Spec 154** — logical-unit ownership grammar; introduces the
  unit-grammar form this spec adds reader-side support for.
- **Spec 155** — logical-unit resolution semantics; the path
  resolution rules the resolver-level parity must honour.
- **Spec 180** — OPC shell codification; the canonical regression
  case and the immediate forcing function for this spec.
- **Spec 153** — invariant-freeze additive evolution; the framing
  under which "the reader accepts more shapes" is a permissible
  evolution of the registry-consumer's authority surface.
