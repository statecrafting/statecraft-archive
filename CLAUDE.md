# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working in this
repository.

## What this is

The statecrafting organisation's `.github` repository. It holds the org profile
GitHub renders at **github.com/statecrafting** (`profile/README.md`) and the
community health files the whole organisation inherits from here. There is no
application code: no Cargo workspace, no npm package, no test suite.

It is governed by [**spec-spine**](https://github.com/statecrafting/spec-spine),
the same authority ledger that governs every other repository in the family.
That is deliberate. A front door that claims the organisation refuses
machine-generated change it cannot trace would be a poor advertisement if the
front door itself were edited by whoever showed up.

**`AGENTS.md` outranks this file for how work is done here.** It is the
cross-agent authority (Claude Code, Codex CLI, Cursor, Copilot, under the
AAIF/Linux Foundation `AGENTS.md` standard), it holds the session protocol
`/prime` executes, and its "Working the backlog" section is the operating loop.
**The gate chain is defined there, not here.** This file does not restate it:
an earlier revision of the same pattern in a sibling repository restated the
chain, silently dropped three `--fail-on-*` flags, and left a list that still
read like the gate.

## The corpus

| Spec | Owns |
| --- | --- |
| `000-bootstrap` | The substrate: `spec-spine.toml`, `standards/`, `.claude/rules/`, `.gitignore`, `.gitattributes`. |
| `001-the-profile-is-the-org-front-door` | The rendered surfaces: `README.md`, `profile/README.md`, `profile/artifacts/`. |
| `002-the-harness-is-governed-like-the-work` | The harness: `AGENTS.md`, this file, `.claude/settings.json`, `.claude/skills/`, `.claude/agents/`, `.mcp.json`, `Makefile`, `.github/workflows/govern.yml`, `.githooks/`. |

Every tracked path is claimed by one of the three. What enforces that is
**C-001**: change a claimed path without an authoring edit to its owning spec
and `spec-spine couple` refuses the diff. A new file needs an ownership edge on
the spec that introduces it **in the same change**.

`[coupling] require_ownership` (C-002, the ownership ratchet) is off. It walks
the source files under a discovered package and there is no manifest here to
discover one from, so turning it on would assert nothing while making the
skills add a `--fail-on-untraced` flag that exits 1 having verified nothing.
`spec-spine.toml` carries the full reasoning.

## Commands

`make gate` is the whole governed loop, read-only, in the order the chain
requires. `make refresh` is the writing half for a session that has edited a
spec and can commit the regenerated shards.

```sh
make gate                  # the read-only chain, as AGENTS.md defines it
make refresh               # spec-spine compile && spec-spine index
make verify SPEC=001       # one spec's declared acceptance
```

The individual verbs, as a reference rather than a sequence:

```sh
spec-spine compile          # -> .derived/spec-registry/by-spec/<id>.json shards
spec-spine index            # -> .derived/codebase-index/ shards
spec-spine check            # BOTH freshness reads in one verb; never writes
spec-spine lint             # corpus conformance (L- codes)
spec-spine index coverage   # which tracked files no spec specifically claims
spec-spine index owner <path>  # which specs own one path, and how
spec-spine couple           # the PR-time drift gate
spec-spine registry plan    # the ready set: workable now vs blocked
spec-spine verify <id>      # run a spec's `## Verification` block
```

The `--fail-on-*` flags are what turn a read into a refusal. Take the spelling
from the fenced block in `AGENTS.md`, flags included, and not from here.

`make test build fmt clippy` exist and are clean no-ops. They are guarded on a
**manifest probe**, not a command probe: a machine with `cargo` installed and no
`Cargo.toml` is the specify-first case, and probing for the tool answers the
wrong question.

## Reading the ledger

`.derived/` is compiler output. Read it through `spec-spine` subcommands, never
with `jq`, `python`, `awk` or `sed`, and never edit a shard by hand
(`.claude/rules/governed-artifact-reads.md`,
`.claude/rules/derived-artifacts-are-compiler-output.md`).

The shard trees are committed. That is what makes `spec-spine check` a freshness
gate on a pull request: CI compares what the corpus compiles to against what the
branch committed, rather than recomputing and trusting itself. The one exception
is `.derived/**/build-meta.json`, which carries wall-clock metadata, is
gitignored, and must never be committed.

## Working here

One session, one spec, then stop. Follow `AGENTS.md` "Working the backlog";
`/next` names the pick, `/build <id>` sequences it, `/ship` and `/shepherd` land
it.

Two things about this repository in particular:

1. **`profile/README.md` is public the moment it merges.** It is the
   organisation's front door. Every project it lists, every license badge, and
   every link is a factual claim about another repository; check the claim
   against that repository rather than inferring it from the group the entry was
   filed under.
2. **Prose is the deliverable.** There is no compiler to catch a mistake and no
   test to go red. The gate checks that the change was authorised by a spec, not
   that the sentence is true. That part is on the reader.

## Conventions

- Never use the em dash character. Use a colon, a semicolon, a comma,
  parentheses, or two sentences. This applies to specs, prose, commit messages
  and pull request bodies alike.
- Conventional commits, with the spec ordinal as the scope: `docs(001): ...`,
  `feat(002): ...`, `chore(002): ratify (draft -> approved)`.
- Never commit to the default branch. One spec per branch, one spec per pull
  request.
- A `Spec-Drift-Waiver:` line needs explicit human approval and is cited in the
  pull request body. A driven session never writes one on its own authority.
