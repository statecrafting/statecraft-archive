# FAQ / Troubleshooting

## General

### What is factory-encore?

A technology-agnostic software factory framework that separates the process of building software from the technology that ships it. It implements the Open Agentic Platform factory standard with a universal process layer, five formal contract schemas, and pluggable per-stack adapters.

### Is factory-encore an ORM or a code generator?

Neither. The process layer produces a Build Specification (not code). The adapter layer generates code, but only the `acme-vue-encore` adapter ships with this repository. The framework is the process, the contract, and the adapter interface.

### What is the relationship to OAP?

The Open Agentic Platform publishes the canonical contract schemas and provides the dispatch surface. factory-encore implements the factory standard OAP defines. The five contract schemas are mirrored from OAP, not forked.

### What is template-encore?

The lean baseline application that the `acme-vue-encore` generator clones. It is a separate repository (`stagecraft-ing/template-encore`) containing a complete Encore.ts + Vue 3 application with governance, auth, and database already wired. The generator copies it and composes modules into it.

## Setup

### `make setup` fails with "spec-spine: command not found"

Run `npm install` first. The `spec-spine` CLI is a devDependency installed from npm. It is not a global tool.

### The codebase index is stale after pulling

Run:

```bash
npm run spec:index
```

This regenerates the codebase index. The staleness gate (`spec-spine index check`) will pass after this.

### The lockstep gate fails

The `template-encore` baseline has changed upstream. Update the lockfile:

```bash
npm run lockstep:update
```

Then commit the updated `baseline.lock.json` as part of your PR.

## Generator

### Where does the generator find template-encore?

In order of precedence:

1. The `--source <path>` CLI flag.
2. The `TEMPLATE_ENCORE_SOURCE` environment variable.
3. A sibling directory named `template-encore` (i.e., `../template-encore`).

### The generated app fails `encore check`

Ensure you are using the Encore CLI version compatible with the template. The generator produces a standard Encore.ts application; `encore check` validates the service graph and typed endpoints.

### How do I add a module after generation?

Use the `add-module` script from the factory-encore repository:

```bash
npx tsx adapters/acme-vue-encore/scripts/add-module.ts \
  <module-name> \
  --root <path-to-generated-app>
```

See the [Add or remove a module](/docs/guides/add-or-remove-a-module) guide.

## Governance

### The coupling gate fails on my PR

The coupling gate (`spec-spine couple`) detected that you changed a code path owned by a spec without also editing that spec. You have two options:

1. **Edit the owning spec** to reflect your change (the intended workflow).
2. **Add a waiver** to your PR body: `Spec-Drift-Waiver: <reason>` (visible and auditable).

### Which paths are excluded from the coupling gate?

The bypass floor (declared in `spec-spine.toml`) excludes:

- `process/` — process-layer prose.
- `contract/` — mirrored schemas.
- `adapters/acme-vue-encore/agents/` — agent prompts.
- `adapters/acme-vue-encore/patterns/` — code-generation patterns.

The built-in bypass floor also covers `.github/`, `docs/`, `README.md`, lockfiles, and `.derived/`.

### How do I add a new spec?

1. Create `specs/NNN-slug/spec.md` with the required YAML frontmatter.
2. Ensure `domain` and `kind` are from the closed taxonomies in `spec-spine.toml`.
3. Run `npx spec-spine compile` and `npx spec-spine index` to update derived artifacts.
4. Verify with `make ci`.

## CI

### The AI PR review posted "review skipped" but CI is green

This is by design. The AI review follows the resilient pattern: a Claude API transient failure (overloaded, rate-limited, 5xx, timeout) passes `ci-gate` with a visible notice. A green CI run with a "review skipped" notice means the review did not happen, but the other gates (governance, generator tests, lockstep) all passed.

### Why are all external actions SHA-pinned?

To prevent supply-chain attacks via tag mutation. A tag can be force-pushed to point at a different commit; a SHA cannot. This is a security requirement from spec 000 (AC-4).

## Claude Code

### What does `/init` do?

It executes the cross-agent session-init protocol: loads rules, refreshes the registry, reads identity files, and emits a summary with lifecycle counts. See [Init and governed reads](/docs/claude-code/init-and-governed-reads).

### Can I parse `.derived/` files directly?

Not in orchestrated workflows (skills, agents, init). The governed-reads rule requires all reads of `.derived/**` to go through `npx spec-spine` verbs. Interactive exploration answering a user question is not bound by this rule.
