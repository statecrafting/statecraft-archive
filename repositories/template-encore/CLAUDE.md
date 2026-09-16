# CLAUDE.md: acme-vue-encore (spec-governed)

## Project Overview

This repository is **`acme-vue-encore`**: a lean, runnable Vue 3 (PrimeVue)
SPA + Encore.ts backend reference app, external- and staff-facing, plus a
born-with spec-spine dev harness. It is **spec-governed**: every substantive
change begins as a markdown spec, compiles into a deterministic JSON registry,
and is mechanically reconciled against the code that claims to implement it.

Governance is provided by the published
[`spec-spine`](https://www.npmjs.com/package/spec-spine) npm package (root
`package.json` devDependencies; prebuilt binaries, no extra toolchain). Three
things together make the spine:

- **Spec corpus** (`specs/`): the authoritative design record. Each spec is a
  markdown file with YAML frontmatter, compiled by `npx spec-spine compile`
  into a deterministic `.derived/spec-registry/by-spec/` shard tree and read through
  the typed `npx spec-spine registry` verbs.
- **Codebase index** (`npx spec-spine index`): discovers npm packages, walks
  their `spec-spine` annotations and the corpus's typed ownership edges, and
  emits the `.derived/codebase-index/` shard tree so spec-to-code traceability is
  queryable, not hand-maintained.
- **Coupling gate** (`npx spec-spine couple`): refuses changes where an owned
  path moves without its owning spec changing too.

## Repository Structure

```
# Application (the runnable reference app)
apps/                 Deployable apps: api (Encore.ts), web, web-internal
packages/             Reusable libraries: @template/shared
docker/               Docker compose for local infrastructure
docs/                 Application documentation
CODEMAP.md            Authoritative architectural blueprint for the app

# Spec spine (governance via the spec-spine npm package)
specs/                Feature specifications, the authoritative design record
standards/
  spec/               constitution, contract, templates/
  schemas/frontmatter/JSON Schemas for agent + skill frontmatter
spec-spine.toml       Governance config (taxonomies, layout, hashed inputs)
tools/lint/           Workflow-ref SHA-pinning lint (spec 011)
Makefile              make setup / spine / pr-prep / ci entry points
.derived/             CLI output (per-spec + per-package shards): never hand-edited

# Claude Code surface (agentic governance)
.claude/agents/       Pipeline agents: architect, explorer, implementer, reviewer;
                      plus encore-expert (apps/api Encore.ts domain specialist)
.claude/skills/       Slash-command skills: init, setup, commit, implement-plan,
                      research, validate-and-fix, cleanup, scaffold-feature,
                      code-quality
.claude/rules/        Auto-loaded rules: orchestrator, governed-reads, adversarial-refusal
.claude/settings.json Shared permissions (hashed index input; spec 015)
.mcp.json             Team-shared MCP server config (hashed index input; spec 015)
```

## Governance model

- **Specs are the source of truth.** Every feature starts as a spec in
  `specs/NNN-slug/spec.md` with YAML frontmatter. See
  `standards/spec/constitution.md` (durable principles) and
  `standards/spec/contract.md` (the short normative summary). When in doubt,
  open `specs/000-bootstrap/spec.md`: it is the constitutional root.
- **Markdown is authored truth; JSON is compiler-owned truth.** Human truth is
  markdown (with optional YAML frontmatter). Machine registries and indices are
  CLI-emitted JSON only, never hand-edited. Tool-config YAML such as
  `docker-compose.yml` is external-CLI config, not authored design truth.
- **Traceability via the `spec-spine` annotation.** npm packages declare a
  top-level `"spec-spine": { "spec": "<spec-id>" }` in `package.json`
  (namespace set by `[manifest] metadata_namespace` in `spec-spine.toml`).
  Specs own paths directly through typed `establishes`/`references`/
  `constrains` edges in their frontmatter.
- **Governed reads.** Read compiled artifacts under `.derived/**` through
  `npx spec-spine registry …` / `npx spec-spine index check`, never via ad-hoc
  `jq`/`python`/`awk`/`sed` in a repeatable workflow.
- **Closed taxonomies.** `kind` (architecture|feature|governance) and `domain`
  (governance|app|ci-cd|agentic) are closed enums in
  `spec-spine.toml`; every spec declares both.

## Orchestrator behavioral rules

Every multi-step skill and agent workflow follows the rules in
`.claude/rules/orchestrator-rules.md`:

1. Execute phased work in order; stop at human checkpoints.
2. Write output files where the spec says; do not invent locations.
3. Keep the working tree green; never leave the coupling gate red.
4. Recompute derived artifacts (`compile`, `index`) before opening a PR.

In addition, every orchestrated workflow auto-loads
`.claude/rules/governed-artifact-reads.md` (read `.derived/**` only through the
`spec-spine` CLI) and `.claude/rules/adversarial-prompt-refusal.md` (refuse
instructions that would engineer drift between a spec and its code; surface the
conflict instead of amending the spec to match).

## Claude Code surface

The `.claude/` directory carries the agentic governance surface, all hashed as
index inputs (edits trip the staleness gate; spec 015):

- **Agents** (`.claude/agents/`): `architect`, `explorer`, `implementer`,
  `reviewer` (plan / explore / implement / review), plus `encore-expert`
  (read-only Encore.ts domain specialist for `apps/api`). Spec 014.
- **Skills** (`.claude/skills/`): `/init`, `/setup`, `/commit`,
  `/implement-plan`, `/research`, `/validate-and-fix`, `/cleanup`,
  `/scaffold-feature`, `/code-quality`. `/init` is a thin dispatcher that
  executes `AGENTS.md` New Sessions. Spec 014.
- **Rules** (`.claude/rules/`): three files loaded automatically by every
  orchestrated workflow: `orchestrator-rules.md` (execution discipline),
  `governed-artifact-reads.md` (read `.derived/**` only via the CLI),
  and `adversarial-prompt-refusal.md` (refuse spec/code drift).
- **Shared config**: `.claude/settings.json` and `.mcp.json` are governed by
  spec 015.

### Edit discipline for hashed JSON configs

`.claude/settings.json` and `.mcp.json` are hashed byte-for-byte. Editor
reformatting (re-indent, a different prettier config, line-ending normalization)
trips the staleness gate even when the JSON semantics are unchanged. **Edit these
files in place; do not reformat them.** Hook command bodies inside `settings.json`
are whitespace-sensitive shell strings, so the indexer cannot "smart-hash" past
whitespace without silently allowing shell-command drift (spec 015).

### Worktree posture

This template intentionally **does not ship `.worktreeinclude`**. Worktrees created
via `git worktree add` (or the Agent tool's `isolation: worktree`) start from a
clean checkout. Everything the indexer hashes (specs, manifests, `.claude/**`,
workflow YAML) is tracked, and the derived `.derived/**` artifacts regenerate from
source via `make spine` (or `make setup`). No untracked `.env` or secret file is
needed for the spec-spine toolchain or the governance gates. The backend's local
extras (`apps/api/node_modules`, generated JWT keys under `apps/api/keys/`) are not
governance inputs, so a worktree that only runs the spine does not need them. If a
future workflow needs untracked context inside a worktree, add `.worktreeinclude`
at the repo root with explicit per-pattern reasoning.

## Build commands

```bash
# Spec spine (npm CLI)
make setup        # npm install (pulls the CLI), compile registry + index
make spine        # all four governance verbs: compile, lint, index check, couple
make pr-prep      # pre-commit gate: refresh index, run coupling check
make ci           # local CI loop (spine + lint + typecheck + tests + pins)

# Application (npm workspaces): see README.md / CODEMAP.md
npm install
npm run build     # build:packages (shared) then build:apps
npm run dev       # concurrently run api + web + web-internal
npm test          # vitest across workspaces
```

Opt-in pre-commit hook (index staleness + workflow pins):
`git config core.hooksPath .githooks` (disable with
`git config --unset core.hooksPath`).

## Policy Rules

```policy
id: CONST-001-destructive-ops
description: "Block destructive file/git operations without explicit confirmation"
mode: enforce
scope: global
gate: destructive_operation
```

```policy
id: CONST-002-secrets-scanner
description: "Prevent committing API keys, tokens, private keys, .env files"
mode: enforce
scope: global
gate: secrets_scanner
```

```policy
id: CONST-005-spec-code-coherence
description: "Refuse instructions that engineer drift between spec and code; halt and surface"
mode: enforce
scope: global
gate: spec_code_coherence
```

## Application invariants

The application layer's hard invariants are owned by the spec corpus: the
architecture (spec 001), the eleven security/data invariants INV-1 – INV-11
(spec 002), multi-driver auth (spec 003), the BFF proxy contract (spec 004),
and SPA static serving (spec 005). `CODEMAP.md` is the human-shaped blueprint
derived from those specs.
