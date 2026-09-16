---
id: "153-invariant-freeze-additive-evolution"
slug: invariant-freeze-additive-evolution
title: "Invariant-freeze semantics — backward-compatibility framing"
status: approved
implementation: complete
amends: ["130-spec-coupling-primary-owner"]
amends_sections: ["constrains-meta-authority"]
owner: bart
created: "2026-05-20"
approved: "2026-05-20"
kind: governance
domain: substrate
risk: low
depends_on:
  - "130-spec-coupling-primary-owner"
code_aliases: ["INVARIANT_FREEZE_BACKWARD_COMPAT"]
summary: >
  Spec 130 §2.7 introduces `constrains: kind: invariant-freeze` with the
  clause "future amendments cannot widen it." The plain-text reading is
  imprecise: in schema-evolution terms, widening means accepting more
  documents (strict superset), which is exactly what additive evolution
  does and which does not invalidate previously-valid documents. This
  spec amends §2.7 with precise framing: invariant-freeze enforces
  backward compatibility, permitting strictly additive evolution that
  preserves all previously-valid documents and their semantics.
  Non-additive changes (narrowing, semantic redefinition, surface
  removal) require explicit re-freeze via a new `constrains:`
  declaration or supersession. The amendment is general — applies to
  every `invariant-freeze` instance — and is motivated by the Tier 2
  logical-unit ownership grammar's additive registry-schema extension.
---

# 153 — Invariant-freeze: backward-compatibility framing

## 1. Problem

Spec 130 §2.7 introduced the `invariant-freeze` constraint kind with the
language:

> Once a registry field or schema element is declared frozen, future
> amendments cannot widen it.

The plain-text reading does not parse cleanly under schema-evolution
semantics:

- **Widening** = accepting more documents (strict superset). Additive
  evolution widens. Additive evolution does not invalidate
  previously-valid documents — that is its defining property.
- **Narrowing** = accepting fewer documents (strict subset). Narrowing
  invalidates documents that were valid before.

Under the plain reading "cannot widen," additive evolution is
prohibited. The intent, however, is clearly backward compatibility:
prohibiting *breaking* changes, permitting non-breaking additions. The
original wording conflated *widening* (a technical schema-evolution
operation) with *breaking* (a stability outcome) and produced language
that prohibits the safe operation while leaving the unsafe one
under-specified.

This imprecision surfaced concretely when work began on a logical-unit
ownership grammar that requires extending
`standards/schemas/spec-spine/registry.schema.json` — the file spec
130's own `constrains:` clause names. The proposed extension is purely
additive (legacy path-string values remain valid; typed logical-unit
values are additionally accepted). Whether this "widening" is permitted
under §2.7's plain reading is ambiguous on its face. Resolving the
ambiguity by stealth — applying a loose reading without making the
principle explicit — would establish a precedent by accident. The
disciplined move is to state the principle.

## 2. Amendment

Spec 130 §2.7's frozen-evolution clause is replaced with precise
schema-evolution semantics:

> Once a registry field or schema element is declared frozen, future
> amendments must preserve backward compatibility: every document
> valid under the frozen form must remain valid under the amended
> form, and the semantics of previously-valid documents must be
> unchanged. Strictly additive evolution — accepting new document
> shapes while preserving all previously-valid documents and their
> semantics — preserves the invariant. Non-additive changes
> (narrowing the accepted set, redefining the semantics of existing
> documents, or removing surface) require explicit re-freeze via a
> new `constrains:` declaration or supersession of the constraining
> spec.

This framing:

1. **Names the invariant in operational terms.** Backward compatibility
   is what the constraint actually protects.
2. **Permits additive evolution explicitly** with the right
   preconditions — strict superset of accepted documents, no semantic
   change to previously-valid documents.
3. **Specifies the prohibited operations precisely**: narrowing,
   semantic redefinition, surface removal.
4. **Specifies the path forward for non-additive changes**: explicit
   re-freeze via a new `constrains:` declaration or supersession of the
   constraining spec.

## 3. Scope

### In scope (this commit)

- Amend spec 130 §2.7's frozen-evolution clause as above.
- Set spec 130's `amended:` and `amendment_record:` frontmatter.
- Add an in-body callout to spec 130's §2.7 noting the amendment and
  pointing here.

### Out of scope (and intentionally so)

- **Migration of existing invariant-freeze instances.** Spec 130 and
  spec 132 each declare `constrains: kind: invariant-freeze`. Both
  inherit the refined semantics automatically — no per-instance edits
  required. This is how layered specification is supposed to work: one
  definitional change, automatic uptake everywhere it applies. Reaching
  into instances to re-assert the now-precise semantics would conflate
  *fixing the definition* with *re-asserting each application*, which
  is the kind of conflation Tier 2 exists to eliminate.
- **A new `constrains:` kind, flavor, or sub-grammar.** The amendment
  is purely semantic. The frontmatter shape is unchanged.
- **The motivating schema change itself.** The logical-unit ownership
  grammar lands in a separate spec; this spec only enables that work
  by making the additive-evolution interpretation explicit.

## 4. Consequences

### For spec 132 (constitutional-invariant-freeze)

Spec 132 applies `invariant-freeze` to spec 000's anchors via the
`unamendable:` / `amends_sections:` / V-011 mechanism. The refined
semantics carry through unchanged: additive amendments to spec 000
(new optional sections, new optional frontmatter fields, expanded
permissive language) preserve the freeze if they do not invalidate
prior valid spec 000 documents or redefine the semantics of existing
ones. Narrowing amendments (renaming a field, removing a section,
tightening a previously-permissive rule) require re-freeze of the
affected anchor or supersession of spec 000.

The `unamendable:` mechanism itself is unchanged. Anchors listed there
remain off-limits to amendment regardless of additivity; V-011
continues to fire on `amends_sections ∩ unamendable ≠ ∅`. The refined
§2.7 semantics govern *what counts as a permissible amendment* in the
spaces where amendment is allowed.

### For spec 130 (this spec amends 130)

Spec 130's `constrains: kind: invariant-freeze` on
`standards/schemas/spec-spine/registry.schema.json` is now
interpretable in precise terms: schema extensions that add optional
fields or new union variants preserve the freeze; changes that
invalidate prior registry documents or change the meaning of existing
fields require re-freeze.

### For future invariant-freeze declarations

Any future spec declaring `constrains: kind: invariant-freeze` carries
the refined semantics by reference. Authors no longer need to argue
each instance from first principles. The pattern is: declare the
freeze, cite spec 130 §2.7 (as amended by this spec), proceed.

## 5. Acceptance

- Spec 130 §2.7's frozen-evolution clause carries the refined wording.
- Spec 130's frontmatter declares `amended: "2026-05-20"` and
  `amendment_record: "153-invariant-freeze-additive-evolution"`.
- An in-body callout in spec 130 §2.7 points to this spec as the
  amender of the clause.
- Spec-compiler accepts this spec (V-011 does not fire — spec 130 has
  no `unamendable:` list).
- Coupling gate is unaffected (this amendment touches spec text, not
  the gate's algorithm).

## 6. Cross-references

- Spec 000 — bootstrap-spec-system (the constitutional baseline; remains
  amendable under the refined semantics)
- Spec 130 — spec-relationship-graph (amended by this spec; §2.7
  carries the precise framing after this amendment lands)
- Spec 132 — constitutional-invariant-freeze (canonical instance,
  unchanged in surface; refined in interpretation by inheritance)
- Spec 152 — path-co-authority (section-anchor semantics, unaffected)
- The forthcoming logical-unit ownership grammar spec — motivating
  case that surfaced §2.7's imprecision; lands as the next segment in
  the Tier 2 ownership-redesign sequence
