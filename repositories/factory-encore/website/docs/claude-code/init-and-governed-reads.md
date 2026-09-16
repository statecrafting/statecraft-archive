# Init and governed reads

The `/init` protocol and the governed-reads discipline are the two foundational constraints that ensure Claude Code sessions interact correctly with the spec-spine governance surface.

## The /init protocol

Every new Claude Code session should start with `/init`. The protocol:

1. **Loads rules**: reads `orchestrator-rules.md`, `governed-artifact-reads.md`, and `adversarial-prompt-refusal.md`.
2. **Refreshes the registry**: runs `npx spec-spine compile` (the registry shards are a per-clone local cache; recompiling is deterministic and guarantees lifecycle counts reflect the current `specs/*/spec.md` frontmatter).
3. **Parallel reads**: dispatches simultaneously:
   - `CLAUDE.md`, `README.md`, `standards/spec/contract.md`, `standards/spec/constitution.md`
   - `npx spec-spine index check` (staleness gate, non-fatal)
   - `npx spec-spine registry status-report --json` (lifecycle counts)
   - `npx spec-spine registry list --json` (spec inventory)
   - `ls process/ contract/ adapters/` (the three governed layers)
   - `ls docs/` (human-facing docs surface)
   - `git log --oneline -10` and `git diff --stat HEAD~1`
4. **Emits summary**: an `## initialized: factory-encore` block with layer overview, recent activity, and a `## lifecycle:` sub-section from the status-report output.

### Staleness handling

If `npx spec-spine index check` exits non-zero, the summary includes:

```
Codebase index: stale, run `npm run spec:index`
```

The session continues; staleness is non-fatal but visible.

### CLI missing

If `npx --no-install spec-spine --version` fails, the protocol instructs the user to run `npm install`. It does **not** fall back to ad-hoc parsing of `.derived/**/*.json`.

## Governed reads

The governed-reads rule applies to every orchestrated workflow (skills, agents, and the init protocol). Interactive, exploratory tool use answering a user question is not bound by this rule.

### The principle

> Compiled artifacts under `.derived/**` MUST be read through the spec-spine CLI, never via ad-hoc parsers.

### Why

The `.derived/` tree is a compiled cache. Its internal structure (JSON shards, naming conventions, nesting) is an implementation detail of the spec-spine CLI that may change between versions. Reading it through the CLI ensures:

- Consumers are insulated from internal format changes.
- The CLI can validate, filter, and format output consistently.
- No workflow accidentally depends on an undocumented internal layout.

### Available CLI verbs

| Need | Command |
|------|---------|
| List all specs | `npx spec-spine registry list [--json]` |
| Show one spec | `npx spec-spine registry show <id> [--json]` |
| Lifecycle counts | `npx spec-spine registry status-report [--json]` |
| Dependency graph | `npx spec-spine registry relationships <id> [--json]` |
| Index freshness | `npx spec-spine index check` |
| Compile registry | `npx spec-spine compile` |
| Lint corpus | `npx spec-spine lint [--fail-on-warn]` |
| Coupling gate | `npx spec-spine couple --base <ref> [--head <ref>] [--pr-body <file>]` |
| Build index | `npx spec-spine index` |

### What to do when a verb is missing

If a legitimate workflow query has no corresponding CLI verb, the correct path is to request it from the spec-spine project, not to work around it with `python`, `jq`, `awk`, or `sed`.

## Relationship to the constitution

Governed reads implement Constitution Principle 5:

> Governed reads. Orchestrated workflows read derived artifacts only through `spec-spine` verbs — never by ad-hoc JSON parsing.

And are enforced by the factory kernel (spec 000, FR-001):

> The spec corpus under `specs/` MUST compile to a deterministic registry (`spec-spine compile`).
