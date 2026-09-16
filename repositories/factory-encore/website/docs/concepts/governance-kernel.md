# Governance kernel

Because factory-encore carries governed code (the deterministic generator), it earns a governance kernel. The kernel is provided by the published [`spec-spine`](https://www.npmjs.com/package/spec-spine) npm package (`spec-spine@0.8.0` in devDependencies), invoked as `npx spec-spine <verb>` or through the `npm run spec:*` scripts.

## The spec-spine model

The governance model has four pillars:

### 1. Spec registry

Every spec lives under `specs/NNN-slug/spec.md` with YAML frontmatter declaring its id, title, status, domain, kind, dependencies, and the files it establishes. `spec-spine compile` emits a deterministic registry under `.derived/spec-registry/`.

### 2. Codebase index

`spec-spine index` maps every spec to the code it owns, producing shards under `.derived/codebase-index/`. The staleness gate (`spec-spine index check`) verifies the committed index is current; a stale index fails CI.

### 3. PR-time coupling gate

`spec-spine couple` is the PR-time gate. It refuses code that drifts from its owning `spec.md`: if a code path claimed by a spec changes, the owning spec must also be edited in the same PR. The escape hatch is a visible `Spec-Drift-Waiver:` line in the PR body, never a silent skip.

### 4. Corpus conformance lint

`spec-spine lint --fail-on-warn` checks the corpus for structural conformance: closed taxonomies (domains and kinds declared in `spec-spine.toml`), required frontmatter fields, and naming conventions.

## Refusal over rationalization

A spec is never edited to retroactively justify an action that contradicts its design. If the coupling gate fails because code and its owning spec disagree, the correct response is to surface the contradiction and let a human resolve it, not to amend the spec to match the code. Waivers are visible and auditable.

## The constitution

The repository's durable principles are recorded in `standards/spec/constitution.md`:

1. **Markdown-authored truth.** All authored truth lives in markdown with YAML frontmatter.
2. **Determinism.** Every derived artifact is a pure function of inputs.
3. **Spec-first.** Code changes ship with the spec that owns the code.
4. **Closed taxonomies.** `kind` and `domain` are closed enums.
5. **Governed reads.** Orchestrated workflows read derived artifacts only through `spec-spine` verbs.
6. **Refusal over rationalization.** A spec is never edited to retroactively justify drift.

## What is hashed

The codebase index hashes the always-hashed core (manifests, `specs/*/spec.md`, `spec-spine.toml`) plus extra inputs declared in `spec-spine.toml`:

- `standards/**`
- `.github/workflows/**`

Notably, `.claude/**`, `AGENTS.md`, and `CLAUDE.md` are **not** hashed by the index in this repository. Editing them does not trip the staleness gate. This differs from the OAP parent repo's posture.

## The coupling bypass floor

Certain paths are excluded from the coupling gate because they are authored prose, not spec-owned generator code:

- `process/`
- `contract/`
- `adapters/acme-vue-encore/agents/`
- `adapters/acme-vue-encore/patterns/`

These paths can be edited without a corresponding spec change. The built-in bypass floor also covers `.github/`, `docs/`, `README.md`, lockfiles, and `.derived/`.
