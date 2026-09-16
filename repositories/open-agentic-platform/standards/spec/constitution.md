# open-agentic-platform Constitution

## Normative hierarchy (read this first)

Contributors MUST resolve conflicts in this order (**highest wins first**):

1. **`specs/000-bootstrap-spec-system/spec.md`** — constitutional bootstrap for specs and registry contracts.
2. **This file** (`standards/spec/constitution.md`) — durable principles; subordinate to Feature 000 where they differ.
3. **`standards/spec/contract.md`** — short summary; subordinate to both above.

The name “constitution” here does **not** imply this file overrides Feature 000. When in doubt, open Feature 000.

## Core Principles

### I. Markdown-Only Authored Truth

All human-authored durable truth in this repository is expressed as Markdown (`.md`). Optional YAML may appear **only** as **frontmatter inside** a markdown file. Standalone YAML files are not an authoring channel for platform truth.

### II. Compiler-Owned JSON Machine Truth

Machine-consumable registries, indices, and normalized spec metadata live in JSON **produced only** by the designated spec compiler. Hand-edited JSON in compiler output paths is a workflow violation.

### III. Spec-First Development

Features are specified before implementation; implementation is justified by specs under `specs/`. Feature `000-bootstrap-spec-system` is the constitutional baseline for how specs and compiled registries behave.

### IV. Determinism and Validation

The spec compiler must be deterministic for the same committed inputs. Validation rules (including rejection of forbidden standalone YAML) are product requirements, not suggestions.

### V. Legacy Inputs Are Non-Normative

Repositories used for reverse engineering (for example `opc`, `platform`) are **evidence only**. They are not sources of truth for this repository. Provenance must be declared in feature text when legacy concepts inform a design.

## Spec Relationship Graph

Spec governance operates over an explicit relationship graph, not a flat claim list. Every spec declares its relationships to code and to other specs via typed frontmatter fields; the coupling gate derives authority over each code path from the graph; co-authority and named-anchor sectioning support shared resources.

### Thesis

A spec touches the world by claiming code paths. The flat `implements:` field conflated establishment, extension, refinement, supersession, amendment, co-authorship, and constraint into one undifferentiated list, producing multi-claim noise at PR-time and no way to distinguish current authority from historical claimant. The relationship graph replaces that with eight typed edges. The graph is the canonical representation; `implements:` is preserved as a derived projection for backward compatibility.

### The eight relationships

The full normative definition lives in spec 130 (`spec-relationship-graph`). Summary:

1. **`establishes:`** — code paths this spec brought into existence. Authoritative until superseded.
2. **`extends:`** — additive surface extension of a predecessor spec (`additive` or `wrapping` nature).
3. **`refines:`** — behavior tightening of an *aspect* across one or more paths.
4. **`supersedes:`** — replacement of a predecessor (`full` or `partial` scope).
5. **`amends:`** — non-replacing patch to a predecessor (`clarification`, `correction`, `restriction`).
6. **`co_authority:`** — section-scoped shared authority on a path (canonical use: the repo-root `Makefile`).
7. **`constrains:`** — meta-authority over how others may shape code (canonical kind: `invariant-freeze`).
8. **`origin: retroactive: true`** — bootstrap marker for specs whose existing `implements:` paths predate the graph.

### Authority as a derived property

Authority over a path is computed from the graph, not declared directly. The function `authorities(P)` returns the set of specs currently authoritative on path P, accounting for full and partial supersession. The coupling gate (spec 133) consumes this function; consumers needing authority queries call into the same library API rather than re-deriving.

### Co-authority and sectioning

When a single path is governed by multiple specs (the canonical case is the repo-root `Makefile`, where ~eight specs each govern a distinct target group), each spec declares `co_authority:` with a named section anchor. The coupling gate matches diff hunks to sections per per-file-type rules (Makefile target groups, workflow `jobs.<name>`, source-file `// region: <name>` markers, markdown heading slugs) and requires the section-owning spec's spec.md to be edited. Section semantics and the empty-authority-by-rule patterns are owned by spec 152 (`path-co-authority`).

### Constraints as meta-authority

A spec with `constrains:` does not claim behavior authority over the listed paths; it declares invariants the paths must satisfy as they evolve. The coupling gate evaluates constraints separately from authority satisfaction; constraint violations produce a distinct failure mode (exit code 3) with different remediation (revert the violating edit or amend the constraining spec to widen the invariant). Spec 132 (`constitutional-invariant-freeze`) is the canonical `invariant-freeze` instance.

### Well-formedness

Every spec declares its relationships explicitly. A spec with no relationship fields and no `origin: retroactive: true` produces spec-lint **V-020** (emission live in `tools/spec-spine/spec-lint`; severity: warning). The corpus is self-describing — `git grep` over `establishes:` answers "who created this path?" deterministically. After the corpus-maturity annotation pass (side quest II, 2026-05-20), V-020 fires on zero specs.

`origin: retroactive: true` is reserved for genuine foundational bootstrap (spec 000 and a small set of analogous instances). Specs the first surgery marked retroactive purely as a stopgap have been migrated to honest annotations during the corpus-maturity pass; a future commit will reduce the retroactive set to its irreducible bootstrap core.

`implements:` is preserved in registry output as a derived view (union of paths from `establishes`, `extends.paths`, `refines.paths`, `co_authority.paths`). Authors no longer write `implements:` directly; `spec-spine compile` emits it for compatibility. Removal of the derived view is the final step of the relationship-graph excision pass.

### Migration posture

The relationship-graph landing is staged. Side quest I (2026-05-19) installed the model: schema, parser, and gate accept both legacy `implements:` and typed relationship fields. Side quest II (2026-05-20) populated the model corpus-wide: 117 specs newly annotated, V-020 emission live, the graph queryable through `spec-spine registry` (new verbs: `show-relationships`, `show-supersession-chain`, `show-constraints-on`, `validate-graph`) and `oap-registry-enrich` (`by-authority`). The remaining stages — section-matching runtime activation (spec 152 §3) and full `implements:` excision (Concern 1 case (a)) — land in subsequent commits without revisiting the eight relationship fields, which are now locked.

## Additional Constraints

- Feature directories use the pattern `specs/NNN-kebab-case/` with matching `id` in frontmatter. Authoritative specs live under **repo-root `specs/`**, not under `standards/spec/`.
- The compiled registry format is versioned (`specVersion`) and described by JSON Schema in Feature 000. Deterministic output is sharded under **`.derived/spec-registry/by-spec/`**; **`build-meta.json`** holds non-deterministic wall-clock metadata only.

## Development Workflow

- Create feature specs manually in `specs/NNN-slug/spec.md` using the template in `standards/spec/templates/spec-template.md`.
- Use feature branches named `NNN-short-name`.
- Read `standards/spec/contract.md` and Feature 000 before adding new authoring formats or tooling outputs.

## Governance

Amendments to principles in this file require alignment with Feature 000 (or its successor bootstrap spec) and review of downstream consumers.

**Version**: 1.1.0 | **Ratified**: 2026-03-22 | **Last Amended**: 2026-05-20
