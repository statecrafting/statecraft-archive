---
name: setup
description: One-time contributor setup — run `make setup` (npm install + compile + index), verify `npx --no-install spec-spine --version` works, verify governed reads (`npx spec-spine registry status-report`).
allowed-tools: Bash, Read
---

# Setup

Get a fresh clone operational. After this completes, `/init` can report lifecycle and structural counts through the spec-spine CLI (no ad-hoc parsing of `.derived/**/*.json` — see spec 000).

`make setup` is the canonical contributor entry point. It runs `npm install` (which pulls the `spec-spine` CLI as a devDependency), compiles the spec-registry shards, and builds the codebase-index shards. This skill runs it and then verifies the CLI and governed reads actually work.

## Process

### 1. Run `make setup`

```bash
make setup
```

This is the single source of truth for contributor setup — never duplicate its steps here. If a new prerequisite or build target is needed, add it to `make setup` (and any CI workflow that runs it) rather than hard-coding `npm install` invocations into this skill.

Halt on non-zero exit and surface the failing step verbatim. `make check-deps` (run as the first step of `make setup`) enumerates host prerequisites (node, npm, git) so a missing tool will name itself.

### 2. Verify the spec-spine CLI

Confirm the CLI installed correctly:

```bash
npx --no-install spec-spine --version
```

If this fails, `npm install` did not complete successfully. Instruct the user to re-run `make setup`. Do NOT fall back to ad-hoc parsing of `.derived/**/*.json`.

### 3. Verify governed reads

Smoke-test the same calls `/init` makes. Passing here means `/init` will work on this clone:

```bash
npx --no-install spec-spine index check
npx --no-install spec-spine registry status-report --json
npx --no-install spec-spine registry list --json | head -5
```

If `npx spec-spine index check` exits non-zero the index is stale — run `make spine-index` and re-check. Do **not** parse `.derived/**/*.json` directly to "verify" success; that violates the governed-reads rule (spec 000 FR-09).

### 4. Emit summary

Report exactly:

```
## setup: <project-name>

**make setup:** {ok / failed at <step>}
**spec-spine CLI:** {version string / MISSING — run npm install}
**Governed reads verified:**
  - index check: {fresh / stale — run make spine-index}
  - registry status-report: {N specs across <statuses>}
  - registry list: {N spec ids}

Next: run `/init` to load full session context.
```

If any step failed, surface the exact command, exit code, and last 20 lines of stderr. Do not invent counts — only report values that came back from the CLI.

## Rules

- `make setup` owns the build steps. This skill does not duplicate or reorder them.
- Halt on first failure. Do not silently continue past a missing prerequisite.
- Never parse `.derived/**/*.json` directly in any verification step. Use `npx spec-spine` verbs.
- Idempotent: safe to re-run. `npm install` is a no-op when the lock file is satisfied.
