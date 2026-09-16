# The Relationship Graph

A specification touches the world by claiming code paths. In early versions of OAP, this was done via a flat `implements:` list. However, this conflated many different types of relationships (creation, modification, replacement, and shared ownership) into one noisy list.

To solve this, OAP introduced the **Spec Relationship Graph** (Spec 130). Every spec now declares its relationships to code and to other specs via typed frontmatter fields.

## The Eight Typed Edges

The relationship graph is built from eight distinct edge types:

1. **`establishes:`**: Code paths this spec brought into existence. The spec is authoritative over these paths until superseded.
2. **`extends:`**: An additive surface extension of a predecessor spec (either `additive` or `wrapping` in nature).
3. **`refines:`**: A behavioral tightening of a specific *aspect* across one or more paths.
4. **`supersedes:`**: The replacement of a predecessor spec, either `full` or `partial`.
5. **`amends:`**: A non-replacing patch to a predecessor (e.g., `clarification`, `correction`, or `restriction`).
6. **`co_authority:`**: Section-scoped shared authority on a single path. The canonical example is the repo-root `Makefile`, where different specs govern different target groups.
7. **`constrains:`**: Meta-authority over how others may shape code. A constraining spec does not claim behavior authority; it declares invariants that the paths must satisfy as they evolve (e.g., `invariant-freeze`).
8. **`origin: retroactive: true`**: A bootstrap marker for foundational specs whose existing paths predate the implementation of the graph.

## Authority as a Derived Property

Authority over a code path is not declared directly; it is a derived property computed from the graph. 

The function `authorities(P)` returns the set of specs currently authoritative on path `P`, accounting for full and partial supersession. The Coupling Gate (Spec 133) consumes this function to determine which specs must be updated when a file is modified.

The legacy `implements:` field is no longer authored directly. Instead, the `spec-spine` compiler derives it as a backward-compatibility projection by unioning the paths from `establishes`, `extends.paths`, `refines.paths`, and `co_authority.paths`.
