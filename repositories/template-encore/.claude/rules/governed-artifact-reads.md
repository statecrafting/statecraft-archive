# Governed artifact reads

These rules apply to every orchestrated workflow in this project — skills under `.claude/skills/**`, agents under `.claude/agents/**`, and the init protocol in `AGENTS.md`. Interactive, exploratory tool use answering a user question is not bound by this file.

> Governed by spec **`000-bootstrap`** (FR-09). Principle: compiled artifacts under `.derived/**` MUST be read through the spec-spine CLI, never via ad-hoc parsers.

## Consumer: the `spec-spine` CLI

All reads of `.derived/**/*.json` go through `npx spec-spine` subcommands:

| Artifact | CLI verb |
|----------|----------|
| `.derived/spec-registry/by-spec/*.json` | `npx spec-spine registry list [--json]` |
| | `npx spec-spine registry show <id> [--json]` |
| | `npx spec-spine registry status-report [--json]` |
| | `npx spec-spine registry relationships <id> [--json]` |
| `.derived/codebase-index/` shard tree | `npx spec-spine index check` |

If a subcommand is missing for a legitimate workflow query, the correct path is to request it from the spec-spine project — not to work around it with `python`, `jq`, `awk`, `sed`, or similar.

## Bad pattern

```bash
# Reaches past the CLI, guesses the JSON shape, breaks silently on schema drift.
# Worse under 0.5.0 sharding: there is no single file; you must glob and merge shards.
python3 -c "import glob; print(len(glob.glob('.derived/spec-registry/by-spec/*.json')))"
jq -s 'length' .derived/spec-registry/by-spec/*.json
```

## Good pattern

```bash
# Governed read. Typed at the tool boundary. Fails loudly on schema drift.
npx spec-spine index check
npx spec-spine registry status-report --json
npx spec-spine registry list --json
npx spec-spine registry show 000-bootstrap --json
```

## Exceptions

- A human running `jq` at the shell to inspect an artifact interactively is not an orchestrated workflow. The rule binds repeatable protocol steps, not debugging.
- If `npx --no-install spec-spine --version` fails, workflows MUST instruct the user to run `npm install` (or `make setup`) — NOT silently fall back to ad-hoc parsing.
