---
id: "152-path-co-authority"
slug: path-co-authority
title: "Path Co-Authority — named-anchor sectioning and empty-authority-by-rule"
status: approved
implementation: complete
owner: bart
created: "2026-05-19"
approved: "2026-05-19"
amended: "2026-06-18"
amendment_record: |
  amended 2026-05-24 by spec 176 (amends-aware-section-satisfaction-parity): fixed the section-scoped satisfaction predicate in check_coupling_section_aware to also honour amends:/amendmentRecord: substitutes, matching whole-file coupling behaviour.
  amended 2026-06-18 by spec 217 (engine-swap collapse): the in-tree spec-code-coupling-check that implemented section-matching was deleted; that logic is now in spec-spine-core. The extends-133 coupling-check edge and co_authority section unit on the deleted path are stripped; this spec's surviving authority is the spec-types overlay (extends-130, the named-anchor grammar).
kind: governance
domain: substrate
risk: low
depends_on:
  - "130-spec-coupling-primary-owner"
  - "133-amends-aware-coupling-gate"
code_aliases: ["PATH_CO_AUTHORITY"]
# 217 deleted the in-tree spec-code-coupling-check; section-matching is now in
# spec-spine-core. The extends-133 coupling-check edge and the co_authority section
# unit (both on the deleted path) are stripped. This spec's surviving authority is the
# spec-types overlay (extends-130, the named-anchor grammar). Amended by 217.
extends:
  - spec: "130-spec-coupling-primary-owner"
    nature: additive
    unit: { kind: file, path: tools/shared/spec-types/src/lib.rs }
summary: >
  Named-anchor sectioning, diff-to-section matching, and the
  empty-authority-by-rule mechanism. The substrate that lets one path be
  governed by multiple specs with non-overlapping authority (canonical
  example: the repo-root Makefile, where each of ~eight specs governs a
  distinct target group), and lets specific paths legitimately have no
  governing spec (vendored code, generated artifacts, well-known
  boilerplate). Replaces the file-level bypass list that previously sat
  outside the spec spine.
---

# 152 — Path Co-Authority

> **Amended 2026-05-24 by spec 176 (`amends-aware-section-satisfaction-parity`,
> `kind: amendment, shape: bug-fix`).** Spec 176 fixes the
> section-scoped satisfaction predicate in
> `check_coupling_section_aware`: previously it consulted only the
> direct `section_spec_ids` set, missing the `amends:` and
> `amendmentRecord:` substitutes that whole-file coupling already
> honoured. The section mechanism this spec defines (§2.2 diff-to-
> section matching) is unchanged; only the predicate downstream now
> composes the OwnerSet identically to the whole-file branch.

## 1. Concern

Two distinct mechanisms live here:

1. **Named-anchor sectioning** — how a single file can be governed by
   multiple specs with non-overlapping authority. Each section is named
   by an anchor; each spec's `co_authority:` entry claims one or more
   sections; the coupling gate matches diff hunks to sections and
   requires the section-owning spec's spec.md to be edited.
2. **Empty-authority-by-rule** — patterns of paths that legitimately
   have no governing spec. The gate treats edits to these paths as
   satisfied without requiring a spec touch.

Both mechanisms are consumed by the coupling gate (spec 133); neither
involves graph derivation (spec 130) directly. This spec's body is the
**substrate** that makes per-section and per-pattern authority
expressible.

## 2. Named-anchor sectioning

### 2.1 Anchor syntax

A `co_authority:` entry's `section` field names an anchor whose
syntax depends on file type. Each per-file-type rule is normative:

| File type | Anchor syntax | Example |
|---|---|---|
| Markdown (`*.md`) | A heading slug (kebab-case derived from heading text) | `co_authority: { paths: [README.md], section: cli-reference }` |
| Makefile | A target name or target-group label declared by `## tag: <name>` comment | `co_authority: { paths: [Makefile], section: supply-chain }` |
| GitHub workflow (`*.yml` under `.github/workflows/`) | A `jobs.<name>` job id | `co_authority: { paths: [.github/workflows/ci-statecraft.yml], section: encore-build }` |
| Rust source | A `// region: <name>` / `// endregion` block | `co_authority: { paths: [tools/spec-spine/spec-code-coupling-check/src/lib.rs], section: section-matching }` |
| TypeScript source | A `// region: <name>` / `// endregion` block | (same syntax as Rust) |
| Other source files | Same `// region:` / `// endregion` convention | (per-language comment syntax) |

The `// region:` / `// endregion` convention is opt-in: a source file
with no region markers has whole-file authority, identical to the
pre-co-authority model. Adding `co_authority:` entries to a file
requires also adding the region markers — the gate has no implicit
section discovery.

### 2.2 Diff-to-section matching

When the gate processes a diff hunk H touching path P, and P has at
least one `co_authority:` claim, the gate matches H to a section using
the per-file-type rule:

- **Markdown**: H falls within section S if H's line numbers are
  between S's heading and the next heading at the same or higher level.
- **Makefile**: H falls within section S if H's line numbers are
  between the `## tag: S` line and the next `## tag:` line (or EOF).
- **Workflow**: H falls within section S if H's line numbers are
  within the YAML span of `jobs.S`.
- **Source with regions**: H falls within section S if H's line numbers
  are between `// region: S` and the matching `// endregion`.

If H falls outside any named section (a hunk in the Makefile's preamble
before any `## tag:` marker, or in a Rust file before the first
`// region:`), the gate reports it as `section: (unsectioned)` and
falls back to whole-file authority for that hunk.

If H crosses multiple sections (rare but possible — a single hunk
spanning two `// region:` blocks), the gate splits the hunk and
processes each sub-hunk independently.

### 2.3 Co-authority satisfaction

A diff hunk H in section S of path P is satisfied when at least one
spec in `authorities(P, S)` (per spec 133 §3) is edited in the same
diff. If no spec claims S, the gate falls back to `authorities(P)`
(whole-file authorities); if that is also empty, the empty-authority-
by-rule check fires.

## 3. Empty-authority-by-rule

Some paths legitimately have no governing spec. The gate must
distinguish "no spec exists, this path needs one" (failure) from "no
spec is appropriate, this is empty by rule" (success). This section
codifies the rules.

### 3.1 Pattern syntax

An empty-authority-by-rule pattern is a path prefix or glob:

- **Prefix** — `path-prefix/` matches all paths under the prefix.
- **Suffix glob** — `**/*.suffix` matches by extension across the tree.
- **Exact** — `exact/path/file.ext` matches one path.

Patterns are listed in this spec's body (below) and consumed by the
gate at startup. No external file holds the patterns — this spec's
body is the canonical source.

### 3.2 Empty-authority-by-rule patterns

The following patterns are exempt from authority requirement at gate
time. Each entry includes the rationale:

- **`.github/`** — CI metadata governed by spec 118's `# Spec:` header
  convention, not by this diff-based gate. The header convention is
  workflow-level traceability; coupling at file level would double-
  govern.
- **`docs/`** — Human-authored documentation tree. Substantive
  documentation about a feature lives in that feature's spec.md;
  `docs/` is for cross-cutting prose (architecture overviews, ADRs,
  contributor guides) that doesn't map cleanly to a single spec.
- **`README.md`** — Root README. Cross-cutting; surveyed by spec 122
  (stakeholder-doc-inversion).
- **`CLAUDE.md`** — Claude Code project instructions. Process file, not
  a behavior surface.
- **`DEVELOPERS.md`** — Contributor onboarding. Cross-cutting prose.
- **`LICENSE`** — Project license. Legal artifact, not a behavior
  surface.
- **`CHANGELOG.md`** — Auto-generated and human-edited release log.
- **`CODEOWNERS`** — GitHub ownership metadata.
- **`.gitignore`, `.gitattributes`** — Git tree configuration.
- **`.specify/memory/constitution.md`** — Constitutional declarations.
  Governed by the constitutional amendment process described in spec
  000 §3, not by this gate.
- **`Cargo.lock`** — Cargo dependency lockfile. Authoritative dependency
  resolution; the corresponding `Cargo.toml` has the authority claim.
- **`pnpm-lock.yaml`, `package-lock.json`** — Node lockfiles. Same
  rationale as `Cargo.lock` — the `package.json` carries the claim.
- **`build/`** — Compiled artifact output. Spec 002 series and spec 101
  govern the *compiler*; the output is a derived artifact, not a
  behavior surface.
- **Vendored grammars under `grammars/`** — Imported third-party
  grammars. Updates come from upstream tarballs; substantive changes
  are made to the vendoring spec, not to the imported file.

### 3.3 Adding new patterns

A new empty-authority-by-rule pattern is added by amending this spec.
The pattern must:

- Have a clear rationale (what makes it empty-authority?).
- Be narrow (specific prefix or suffix, not a broad glob like `*.md`).
- Not silently shadow a path that has a current authority spec
  (the gate logs a warning if a pattern matches a path also claimed
  by some spec).

Removing a pattern is treated as a `constrains: kind: invariant-freeze`
amendment — patterns are durable because they reflect real architecture
decisions (e.g., "documentation is not coupling-tracked").

## 4. Relationship to the bypass file

Prior to this spec, the empty-authority patterns lived in
`.github/spec-coupling-bypass.txt` — an external file outside the spec
spine, governed by no spec. This commit deletes that file; its
patterns are codified in §3.2 above.

The migration was lossless: every prefix in the bypass file appears in
§3.2 with explicit rationale. The act of moving them into a spec body
made the rationales reviewable in PRs (rather than buried in commit
history of an outside-the-spine config file).

## 5. Gate integration

The coupling gate (spec 133 §3, §4) calls into this spec's mechanism
at two points:

- During `authorities(P, S)` derivation, the gate consults each spec's
  `co_authority:` entries to find which spec governs S on P.
- During the empty-authority-by-rule check, the gate matches the edited
  path against the §3.2 patterns and exempts matched paths from the
  authority-required rule.

Both points are pure functions of the spec corpus and the diff; neither
has external state. This is the architectural property that lets the
gate be re-run deterministically across runs and re-implementable in
audit tools without divergence.

## 6. Cross-references

- Spec 127 — workflow contract
- Spec 130 — relationship-graph field semantics (where `co_authority:`
  is defined)
- Spec 133 — coupling-gate (consumes the section-match and empty-
  authority-by-rule mechanisms)
- Spec 118 — workflow-spec-traceability (the `# Spec:` header
  convention that governs `.github/`)
- Spec 122 — stakeholder-doc-inversion (governs cross-cutting prose
  surface)
