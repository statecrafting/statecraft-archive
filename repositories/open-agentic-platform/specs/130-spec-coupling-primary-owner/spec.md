---
id: "130-spec-coupling-primary-owner"
slug: spec-relationship-graph
title: "Spec Relationship Graph — eight first-class edges between specs and code"
status: approved
implementation: complete
amended: "2026-06-18"
amendment_record: |
  Amended 2026-05-20 by 153-invariant-freeze-additive-evolution.
  Re-amended 2026-06-14 by 216-spec-spine-library-grammar-adoption on two
  sections. §2.5: the 2026-06-14 bare-id `amends` clarification callout
  (PR #358) is formalised as a spec-recorded amendment; Phase 1 converges the
  spec-compiler onto the bare-id `amends` grammar, with a non-string `amends`
  entry now a hard V-033 compile error rather than a silent empty-list
  collapse. §2.4: Phase 2a reconciles the `supersedes` doc-template `paths:` to
  the canonical `unit:` form (spec 154 §6), and converges the compiler to emit
  the structured partial form with a malformed entry rejected by V-034.
  amended 2026-06-18 by spec 217 (engine-swap collapse): the in-tree spec-compiler and codebase-indexer that parsed and emitted the relationship graph were deleted; that logic is now in spec-spine-core. Both extends code-units are stripped (paths deleted); the establishes edges (spec-types overlay and registry.schema.json) and constrains edge (frozen schema) survive.
owner: bart
created: "2026-05-02"
approved: "2026-05-19"
kind: governance
domain: substrate
risk: low
depends_on:
  - "000-bootstrap-spec-system"
  - "001-spec-compiler-mvp"
  - "101-codebase-index-mvp"
code_aliases: ["SPEC_RELATIONSHIP_GRAPH"]
establishes:
  - unit: { kind: file, path: tools/shared/spec-types/src/lib.rs }
  - unit: { kind: file, path: standards/schemas/spec-spine/registry.schema.json }
# 217 deleted the in-tree spec-compiler + codebase-indexer; the relationship-graph
# parse/emit + scanner are now in spec-spine-core. Both extends code-units are
# stripped (paths deleted). This spec's establishes (spec-types overlay lib.rs +
# registry.schema.json) and constrains (frozen schema) survive. Amended by 217.
constrains:
  - flavor: invariant-freeze
    unit: { kind: file, path: standards/schemas/spec-spine/registry.schema.json }
summary: >
  Spec governance operates over an explicit relationship graph. Eight
  frontmatter fields — establishes, extends, refines, supersedes, amends,
  co_authority, constrains, origin — encode how specs relate to code and
  to each other. Authority over each code path is derived from the graph;
  the coupling gate (spec 133) consumes the derivation; co-authority and
  named-anchor sectioning (spec 152) support shared resources. `implements:`
  is preserved as a *derived* view computed from the union of paths
  appearing in establishes, extends.paths, refines.paths, and
  co_authority.paths — authors no longer write `implements:` directly; the
  spec-compiler emits it for consumer compatibility.
---

# 130 — Spec Relationship Graph

## 1. Thesis

A spec touches the world by claiming code paths. Until this spec landed,
those claims were expressed via a single `implements:` field — a flat
list that conflated *establishment*, *extension*, *refinement*,
*supersession*, *amendment*, *co-authorship*, and *constraint*. Multiple
specs claiming the same path produced "multi-claim noise" at PR-time:
the coupling gate reported every claimant, with no way to distinguish
*current authority* from *historical claimant*.

The relationship graph replaces that flat field with eight typed edges.
Each edge encodes one specific kind of governance relationship between a
spec and a path (or between two specs). The graph is the canonical
representation; `implements:` is a derived projection preserved for
backward compatibility.

## 2. The eight relationship fields

The fields below are normative. Their semantics are the contract for
spec-compiler parsing, registry schema acceptance, spec-lint enforcement
(V-020), and coupling-gate authority derivation (spec 133).

### 2.1 `establishes:` — one-time creation

```yaml
establishes:
  - <path>
  - <path>
```

A spec **establishes** a path when this is the spec that brought the
path into existence. Authoritative on the path until superseded.

A path appears under `establishes:` in at most one spec across the
corpus. (V-021 — reserved — will enforce this at compile-time after the
corpus is curated.)

### 2.2 `extends:` — additive surface extension

```yaml
extends:
  - spec: <predecessor-id>
    paths: [<path>, ...]
    nature: additive | wrapping
```

A spec **extends** a predecessor when it adds to that predecessor's
authority surface without replacing it. The predecessor remains
authoritative on its full surface; this spec is an additional authority
on the listed paths.

- `nature: additive` — new code lives alongside the predecessor's.
- `nature: wrapping` — new code wraps the predecessor's invocation
  surface (e.g. middleware, adapter shells, decorators).

`paths` is a subset of the predecessor's surface; declaring paths the
predecessor never claimed is a well-formedness error (V-022 reserved).

### 2.3 `refines:` — behavior tightening across paths

```yaml
refines:
  - paths: [<path>, ...]
    aspect: <short-tag>
    refines_specs: [<id>, ...]   # optional
```

A spec **refines** a behavior when it tightens an *aspect* of how
existing code must behave. Refinement is path-scoped (the aspect applies
to the listed paths) and optionally spec-scoped (when it refines
behavior owned by specific predecessor specs).

`aspect` is open-vocabulary kebab-case (`error-shape`, `logging-format`,
`retry-policy`, `cache-eviction`, …). The vocabulary is not enumerated
because refinement aspects are inherently domain-specific.

### 2.4 `supersedes:` — replacement

```yaml
supersedes:
  - spec: <predecessor-id>
    scope: full | partial
    unit: { kind: file|directory|crate|module|symbol|section, ... }  # partial: the unit whose authority transfers
    note: <prose scope, when no single unit captures it>
    rationale: <one-line>
```

> **Clarification (2026-06-14, reconciled by spec 216 Phase 2a): the
> canonical partial-scope key is `unit:`, not `paths:`.** This template
> originally showed `paths: [<path>, ...]`. Spec 154 §6 modernised the
> relationship-field grammar to logical units; the standalone spec-spine
> library and every live partial-supersession spec (114, 199, 214) use
> `unit:` (or a prose `note:`). `paths:` is the pre-154 form and is used by
> no live spec. Spec 216 Phase 2a converges OAP's spec-compiler on `unit:`,
> emits the structured partial form into the registry, and rejects a
> malformed `supersedes` entry with V-034 (the silent-drop was the
> `supersedes` analogue of the spec 125 `amends` defect). A partial entry
> may scope by `unit:` or by a prose `note:` with no unit; `unit:` is not
> required.

A spec **supersedes** a predecessor when it replaces the predecessor's
authority. Supersession resolution is computed by the gate as part of
authority derivation (spec 133 §3).

- `scope: full`: predecessor is no longer authoritative on any path.
- `scope: partial`: predecessor remains authoritative on its other units;
  this spec takes over the named `unit:` (or the prose `note:` scope).

Legacy shape (`supersedes: ["NNN", ...]`) is accepted and treated as
`scope: full` for each id. Authoring new supersessions in the structured
form is preferred.

### 2.5 `amends:` — non-replacing patch

> **Clarification (2026-06-14, PR #358): bare-id is the canonical `amends`
> shape; `amends` carries no code authority.** PR #358 standardized the
> corpus on `amends: ["NNN-slug", ...]`, and the standalone spec-spine
> library accepts bare-id `amends` only. An `amends` edge grants
> co-authority over the predecessor's `spec.md` (the id names it; no
> `unit:`/`paths:` is needed or honored) and confers no authority over
> code. A `unit:`/`paths:` slot on `amends` is inert at the coupling gate:
> parking code units on `amends` was the spec 125 defect PR #358 corrected
> (those units cleared no ownership). When a spec needs authority over code
> it changes, declare `refines:` or `extends:` units, which the gate honors
> (the gate's amends-awareness, spec 133, keys only on the bare id). The
> structured object form shown below still parses in OAP today but is
> deprecated in guidance; its parser arm is slated for removal under the
> spec-spine library-adoption work.

```yaml
amends:
  - spec: <amended-id>
    change_type: clarification | correction | restriction
    paths: [<path>, ...]
```

A spec **amends** a predecessor when it patches the predecessor's
behavior without claiming new code or replacing the predecessor.
Amendments touch the amended spec's spec.md (via §-anchor edits) but
typically not its code surface.

- `clarification` — restates intent; no behavior change.
- `correction` — fixes a stated invariant that the code did not match.
- `restriction` — narrows the predecessor's previously-broad license.

Canonical shape (`amends: ["NNN", ...]`): a bare id list, treated as
`change_type: clarification`. The coupling gate (spec 133 amends-awareness)
expands the owner set of `specs/<NNN>/spec.md` to include amenders; no code
paths are claimed. For the structured object form and its deprecation, see
the clarification callout above and spec 154 §5.

### 2.6 `co_authority:` — section-scoped shared resource

```yaml
co_authority:
  - paths: [<path>]
    section: <named-anchor>
    with_specs: [<id>, ...]
```

Two or more specs may **co-author** a single path when each governs a
non-overlapping section. Section semantics, anchor syntax, and diff-to-
section matching are owned by spec 152 (path-co-authority).

The canonical use: the repo-root `Makefile`, where each of specs
102/104/105/116/127/128/134/135 governs a target group, and supply-
chain edits should require touching the supply-chain spec, not all
eight Makefile-touching specs.

### 2.7 `constrains:` — meta-authority

```yaml
constrains:
  - spec: <id>           # optional; constraints can be path-only
    kind: invariant-freeze | <other>
    paths: [<path>, ...]
```

A spec **constrains** other specs by declaring invariants over how code
under the listed paths may evolve. Constraint specs are not behavior
authorities; the coupling gate evaluates them as a separate satisfaction
condition (spec 133 §4).

`kind` is open-vocabulary. The initial idiom is `invariant-freeze`,
exemplified by spec 132 (constitutional-invariant-freeze).

> **Amended by spec 153 (2026-05-20):** the frozen-evolution clause
> below replaces the original "future amendments cannot widen it."
> The original wording conflated *widening* (a schema-evolution
> operation) with *breaking* (a stability outcome). See spec 153 §1
> for the diagnosis.

Once a registry field or schema element is declared frozen, future
amendments must preserve backward compatibility: every document valid
under the frozen form must remain valid under the amended form, and
the semantics of previously-valid documents must be unchanged.
Strictly additive evolution — accepting new document shapes while
preserving all previously-valid documents and their semantics —
preserves the invariant. Non-additive changes (narrowing the accepted
set, redefining the semantics of existing documents, or removing
surface) require explicit re-freeze via a new `constrains:`
declaration or supersession of the constraining spec.

### 2.8 `origin:` — bootstrap marker

```yaml
origin:
  retroactive: true
  paths: [<path>, ...]
```

A spec carries `origin: retroactive: true` when its `implements:` paths
predate the relationship graph and have not yet been curated into typed
edges. The gate treats retroactively-marked specs as `establishes:` on
their existing `implements:` paths (single-spec authority, no
relationship metadata).

This field is the migration mechanism: it lets the corpus pass spec-lint
V-020 ("no relationship fields") without forcing every spec to be
curated immediately. The curated-annotation pass replaces `origin:
retroactive: true` with the typed edges that describe what the spec
actually does.

## 3. The derived `implements:` view

Authors no longer write `implements:` directly. The spec-compiler emits
it into the registry as a derived projection:

```
implements(P) = establishes(P)
              ∪ { p | p ∈ extends.paths }
              ∪ { p | p ∈ refines.paths }
              ∪ { p | p ∈ co_authority.paths }
```

Consumers of `implements:` (codebase-indexer's Layer 2 traceability,
registry-consumer's `show` output, downstream init protocols) see the
same shape regardless of whether the spec is authored in legacy mode
(explicit `implements:`) or the new model. The compatibility is
deterministic and emits in the same registry schema.

When a spec authors both relationship fields and `implements:` (a
transitional state), the explicit `implements:` is preserved as-is; the
derivation pass is a no-op. This supports incremental migration.

## 4. Well-formedness rules

The rules below are normative. Spec-compiler reads them as V-codes; new
codes are reserved (compiler emission is staged with corpus curation).

- **W-1.** `establishes`, `extends`, `refines`, `supersedes`, `amends`,
  `co_authority`, `constrains` are all optional. A spec may declare any
  subset. A spec with no relationship fields and no `origin: retroactive:
  true` triggers **V-020** (warning; promotes to error after curated pass).
- **W-2.** `extends.paths` must be a subset of the extended spec's
  current authority surface. (V-022 reserved.)
- **W-3.** `supersedes.scope: partial` requires `paths`. `supersedes.scope:
  full` rejects `paths`. (V-023 reserved.)
- **W-4.** A path may appear under at most one spec's `establishes:`.
  (V-021 reserved.)
- **W-5.** `extends:` and `refines:` may co-exist on the same spec for
  the same path — a spec can extend a predecessor and refine a cross-
  cutting concern simultaneously.
- **W-6.** `co_authority` `section` must match a per-file-type anchor
  pattern (spec 152 §2). (V-024 reserved.)

## 5. Authority as a derived property

Authority over a path is not declared directly — it is computed from
the graph. The algorithm is owned by spec 133 (coupling-gate) §3. The
shape of the answer is:

```
authorities(P) = {
  spec :
    (spec establishes P)
    ∨ (spec extends Y where P ∈ extends.paths)
    ∨ (spec refines P)
    ∨ (spec co_authority P)
  ∧ ¬ ∃ later_spec :
       (later_spec supersedes spec, scope=full)
     ∨ (later_spec supersedes spec, scope=partial ∧ P ∈ paths)
}
```

`amends:` edits are gate-satisfying touches but not behavior
authorities. `constrains:` specs are checked separately.

## 6. Constitutional declaration

The constitution (`.specify/memory/constitution.md` §Spec Relationship
Graph) normatively declares the model. This spec is the foundational
instance — it establishes the relationship-graph schema fields, extends
the spec-compiler's parser, and constrains the registry schema (an
invariant-freeze on the eight field names and their typing).

## 7. Cross-references

- Spec 127 — spec-code-coupling-workflow (CI job, make target, contributor flow)
- Spec 133 — coupling-gate (authority derivation algorithm and gate logic)
- Spec 152 — path-co-authority (named-anchor sectioning and empty-authority-by-rule patterns)
- Spec 101 — codebase-index-mvp (Layer 2 traceability — consumes derived `implements:`)
- Spec 132 — constitutional-invariant-freeze (canonical example of `constrains: kind: invariant-freeze`)
- Spec 147 — spec-kind-grammar (universal dimensions; orthogonal to relationship graph)
