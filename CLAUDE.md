# CLAUDE.md: statecraft.ing

## Project Overview

The marketing and docs site for the Statecraft product family: a fully static
React Router v7 site (framework mode, prerendered, harvesting the OAP-era
statecraft web app and its spec-registry viewer) deployed to GitHub Pages under
statecraft.ing. The scaffold is governed by `specs/001-site-scaffold/spec.md`,
the launch copy by `specs/002-launch-content/spec.md`. No backend, no analytics,
no runtime external requests: the site must never become operational work.

## Repository Structure

```
specs/       Feature specs, the authoritative design record
standards/   spec-spine constitution, contract, templates
.derived/    Compiler output (committed shards; never hand-edit)
app/         Routes, layouts, components, and the lib modules they read
public/      Static assets; public/data/ is baked at build time, not committed
scripts/     bake-registry.mjs, the build-time registry bake
.claude/     The agentic harness: skills, agents, rules, hooks (spec 005)
.githooks/   Opt-in merge driver for the committed shards (spec 005)
```

## Governance

Governed by spec-spine (`spec-spine.toml`, owned by spec 000; the harness keys
amended by spec 005). Specs are the source of truth. Read `.derived/**` only
through `spec-spine` subcommands, never with `jq` or `grep`. After editing any
`specs/*/spec.md`, run `spec-spine compile && spec-spine index` and commit the
shards with the edit.

**spec-spine 0.18.0 or later is required.** `spec-spine.toml` declares the
floor in `[meta] required_version`, and the session hooks, the `Makefile` and
CI all call `spec-spine check`, which arrived in that release.

The full protocol (session init, the backlog loop, the gate command list, the
house rules for authored text) lives in `AGENTS.md`. That file is the project
layer every skill and every agent reads; this one is the orientation.

## Build Commands

```bash
make gate                 # the governed loop, read-only, in the required order
make typecheck build      # the stack gate: npm run typecheck, then npm run build
make refresh              # the writing half: recompute the committed shards
make verify SPEC=005      # one spec's declared acceptance

npm ci && npm run dev     # local dev (predev bakes the registry payload)
```

`make gate` and `make typecheck build` must both exit 0 before every commit.
CI runs the same targets, so the two cannot drift.

## The governed loop

One session implements one spec, start to finish, then stops. `/prime` to
orient, `/next` to pick, `/build <id>` to implement, `/verify <id>` for the
acceptance block, `/ship` to open the PR, `/shepherd` to land it. `AGENTS.md`
is the authority for every step.

`main` auto-deploys to the live apex. Never commit or push to `main`: the
`PreToolUse` hook refuses it, every change lands through a pull request, and
merging is a human checkpoint even when the checks are green.

## Key Conventions

- Every published claim must be checkable against a public repo; the status
  section tracks the real milestone ladder, never aspiration.
- Static only: no SSR, no forms, no third-party scripts.
- Voice: engineer-to-engineer, no startup theater (spec 002 section 1).
- No em dashes (U+2014) in any authored file, and no session links or AI
  attribution in commit messages or PR bodies (`AGENTS.md`, House rules).
- Every source file is claimed by a spec: `[coupling] require_ownership` is on,
  so an unclaimed file is refused at PR time.
