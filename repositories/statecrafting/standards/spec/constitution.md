# Constitution (tier 2)

Durable principles that govern this corpus. This document is **tier 2**: it is
subordinate to the bootstrap spec, whose `unamendable` anchors it may not
contradict, and it governs all ordinary specs.

**Normative hierarchy (highest wins):**

1. the bootstrap spec (`000`): non-overridable.
2. this constitution.
3. the contract: a normative summary of the bootstrap spec.
4. ordinary specs: feature-level claims within this envelope.

When two specs conflict, resolve in this order, then by the typed authority
graph.

---

## I. Markdown-only authored truth

Authored truth lives only in markdown with YAML frontmatter. If a fact governs
the system, it is written in a `spec.md` (or a standards document), never in a
derived artifact.

## II. Compiler-owned JSON machine truth

Machine-consumable truth is emitted by the compiler into the derived tree and is
read only through `spec-spine` subcommands. Hand-editing a derived artifact is a
workflow violation; ad-hoc parsing of one (`jq`/`awk`/`sed`) is equally
forbidden, because a typed read fails at the deserializer instead of silently
encoding a stale assumption.

## III. Spec-first development

A change to behavior begins with a change to a spec: the spec declares the units
it owns and the typed edges to its neighbours before the code is written. The
coupling gate enforces this at PR time. The escape valve is a named, scoped
waiver in the PR body, never a silent edit to an owner spec.

## IV. Determinism and validation

Every artifact-producing function is a pure function of (config, file contents):
the same inputs produce byte-identical output. Validation is mechanical, so
staleness is detectable by content-hash comparison alone.

## V. Legacy as evidence

Code that predates a governing spec is evidence, not a violation: a spec
claiming it declares `origin.retroactive: true` rather than masquerading as a
fresh `establishes` claim. Code adopted from outside the corpus is specced **as
found**, and the behavior the adopting spec would not have chosen is recorded
under a `## Known defects` heading. A defect recorded there is not thereby
blessed: it is what a later spec is written against.

---

## VI. License is per-package, declared, and never inferred

This repository hosts packages under three different licenses (spec 001). Every
package states its own license in its manifest and carries its own LICENSE
file; a package's license is never assumed from the repository root or from a
neighbour. The root is Apache-2.0 as a default, not a claim.

The split follows customer reach, not any upstream's license. Packages a
stamped customer application touches stay unencumbered; control-plane internals
keep the AGPL shield; vendored upstream keeps whatever license it arrived with.
From that follows the one directional rule the graph cannot express on its own:
**no customer-reaching package may depend on an AGPL-3.0 one.**

This principle is machine-checked, not merely declared. The license tier of
every governed package is enumerated in the root `package.json`, and
`scripts/check-licenses.mjs` refuses a change where a manifest, a `Cargo.toml`,
a LICENSE file, the tier map, or `spec-spine.toml`'s package inventory disagree
with each other in either direction.

---

## Amendment

This constitution is changed by an ordinary spec that is `approved`, **claims
the affected text as an authority unit**, and contradicts no `unamendable`
anchor of the bootstrap spec.

The claim uses the ordinary ownership vocabulary over a section unit of this
file: `establishes` for a principle the spec adds, `refines` (with a named
`aspect`) for one it tightens, `co_authority` for one genuinely shared.

```yaml
refines:
  - aspect: "legacy-as-evidence"
    unit: { kind: section, file: "standards/spec/constitution.md", anchor: "v-legacy-as-evidence" }
```

The anchor is the heading slug, so `## V. Legacy as evidence` is
`v-legacy-as-evidence`. `amends` is **not** the instrument: its targets are spec
ids, and this file is not a spec.

Spec 008 claims `standards/spec/` as a directory unit so that editing these
documents is a governed act at all. That does not make it the author of this
constitution: a section claim by another spec sits inside that directory as an
ordinary edge and amends nobody. Directory ownership answers "may this file
change without a spec changing"; the section claim answers "which spec said
so".

Unlike an amended `spec.md`, which is a record of what the corpus held when it
was ratified and is therefore never edited to mention its successors, this
document is a standing statement of what is true now. It is edited in place, and
its history lives in the specs that claimed each section, and in git.
