---
id: "000-bootstrap"
title: "Bootstrap spec system"
status: approved
created: "2026-07-14"
summary: >
  Foundational contract: authored truth lives only in markdown (+ YAML
  frontmatter); machine-consumable truth is compiler-emitted JSON only;
  every artifact is a deterministic function of (config, file contents);
  a typed authority graph governs who-owns-what. This repository is born
  governed: the spine exists before the first line of product code.
establishes:
  - "spec-spine.toml"
  - ".github/workflows/spec-spine.yml"
  - { kind: directory, path: "standards/spec/" }
unamendable:
  - "markdown-truth-boundary"
  - "json-truth-boundary"
  - "determinism-requirement"
  - "typed-authority-graph"
  - "refusal-rule"
---

# 000: Bootstrap spec system

This is the spec that defines what a spec *is*. Ordinary specs live under
`specs/`. Each compilation unit links back here (or to a more specific
spec) via `[package.metadata.spec-spine].spec` in its manifest, a
`// Spec:` comment header, or a spec's ownership edge.

## 1. The authoring / derived boundary

Humans author markdown; the compiler owns the JSON. Never hand-edit a
derived artifact.

## 2. The typed authority graph

Specs declare typed edges (`establishes`, `extends`, `refines`,
`supersedes`, `amends`, `co_authority`, `constrains`, `references`) and
the units they own (file / section / symbol / directory / crate / module).
Authority is derived by walking the graph.

## Amendment (2026-07-22): spec 012 config pointers

Spec 012 (frontend-admin adoption) makes two coordinated edits in this
spec's `spec-spine.toml`: `frontend-admin` joins
`standalone_npm_packages` (the operator dashboard is a standalone npm
package on the chassis convention, spec-linked to 012), and
`app-manifest.json` joins `[index] extra_hashed_inputs` (the model
manifest is governance surface; edits to it must trip index staleness).
See specs/012-frontend-admin-adoption/spec.md §5.1.

## Amendment (2026-09-11): spec 013 harness adoption

Spec 013 (the agent harness) reaches two units of this spec through
`extends` edges and refreshes a third that this spec now claims outright.

**`spec-spine.toml`.** Five coordinated edits, all detailed in
specs/013-agent-harness/spec.md sections 4 and 5:

1. `[meta] required_version = ">=0.18.0"`: the governing floor. The
   coupling gate's built-in bypass list is compiled into the binary, so a
   version below the floor judges the same diff differently.
2. `[index] extra_hashed_inputs`: every entry that ended in a bare `**`
   is rewritten as `**/*`. The bare form matches directories and so
   contributed no bytes to any content hash, which meant the agent
   harness, the standards tree and the workflows were nominally hashed
   and actually were not (`L-010`). `AGENTS.md`, `CLAUDE.md`, `Makefile`,
   `.githooks/**/*`, `.gitattributes`, `scripts/**/*`, `encore.app`,
   `infra.config.json` and `infra.config.dev.json` join the list.
3. `[index] resolver_exclusions` gains `encore.gen`: Encore's generated
   client surface is gitignored and rewritten by every build, so no spec
   can claim it, and its presence in the coverage walk was the only thing
   holding coverage at 76.6 percent.
4. `[coupling] require_ownership = true`: with `encore.gen` excluded,
   coverage is 100 percent, so the ownership ratchet is honest. `C-002`
   now refuses a changed source file that no spec specifically claims.
5. `[lint] unwitnessed_allowed`: the eleven claimed paths deliberately in
   no content hash, named one by one so `lint --fail-on-warn` can join the
   gate without suppressing anything silently.

**`.github/workflows/spec-spine.yml`.** Rewritten to install the pinned
floor and run the read-only `make gate` chain. The previous form ran a
writing `spec-spine compile` and then checked the index it had just
rewritten, which is how a registry compiled by a v0.10.0 binary reached
the default branch unnoticed. The workflow name and the job id are
unchanged: they are the required status check on the protected branch.

**`standards/spec/`.** This spec now claims the standards tree it always
defined, as a directory unit, and spec 013 refreshes its contents to the
0.18.0 scaffold: `contract.md` gains the lifecycle-as-scheduling table
and the `amends`-is-declared-once rule, `constitution.md` gains the
normative hierarchy and its own Amendment section, and
`templates/spec-template.md` gains the `implementation` key. The
constitution's five principles are the four this repository already held,
restated, plus "legacy as evidence" extended with the `## Known defects`
convention. Nothing statecraft-specific was dropped.
