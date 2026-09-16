# Constitution (tier 2)

Durable principles for this repository, subordinate to the factory kernel
(`specs/000-factory-kernel/spec.md`) where they differ.

1. **Markdown-authored truth.** All authored truth lives in markdown with
   YAML frontmatter. Derived JSON under `.derived/` is owned by the
   spec-spine CLI and never hand-edited.
2. **Determinism.** Every derived artifact is a pure function of (config,
   file contents). Same inputs ⇒ byte-identical output; the committed index
   hash is the staleness gate.
3. **Spec-first.** Code changes ship with the spec that owns the code. The
   coupling gate (`npx spec-spine couple`) makes drift refusable at PR
   time; waivers are visible PR-body lines, never silent.
4. **Closed taxonomies.** `kind` and `domain` are closed enums declared in
   `spec-spine.toml`; every spec declares both.
5. **Governed reads.** Orchestrated workflows read derived artifacts only
   through `npx spec-spine` verbs — never by ad-hoc JSON parsing.
6. **Refusal over rationalisation.** A spec is never edited to
   retroactively justify an action that contradicts its design. Surface the
   conflict; let a human resolve it.
