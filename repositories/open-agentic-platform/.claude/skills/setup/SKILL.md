---
name: setup
description: One-time contributor setup — run `make setup` and verify governed reads work end-to-end so `/init` can report lifecycle and structural counts.
allowed-tools: Bash, Read
---

# Setup

Get a fresh clone operational. After this completes, `/init` can report lifecycle and structural counts through governed consumer binaries (no ad-hoc parsing of `build/**/*.json` — see spec 103).

`make setup` is the canonical contributor entry point. It installs the spec-spine CLI (`cargo install spec-spine-cli --version 0.10.0 --locked`), builds OAP-specific tools, compiles the spec registry and codebase index shards under `.derived/`, and fetches the axiomregent sidecar. This command runs it and then verifies the binaries the init protocol depends on actually return.

## Process

### 1. Run `make setup`

```bash
make setup
```

This is the single source of truth for contributor setup — never duplicate its steps here. If a new prerequisite or build target is needed, add it to `make setup` (and the workflow that runs it) rather than hard-coding cargo invocations into this command.

Halt on non-zero exit and surface the failing step verbatim. `make check-deps` (run as the first step of `make setup`) enumerates the host prerequisites — rust, pnpm, bun, node, gh — so a missing tool will name itself.

### 2. Verify governed reads

Smoke-test the same calls `/init` makes. Passing here means `/init` will work on this clone:

```bash
spec-spine index
spec-spine registry status-report --json --nonzero-only
spec-spine registry list --ids-only | wc -l
```

`spec-spine index` (re)generates the gitignored structural index (spec 188 Phase 4b: the broad index is a rebuilt-on-demand artifact, never committed). Do **not** parse `.derived/**/*.json` directly to "verify" success; that violates spec 103 governed reads.

### 3. Emit summary

Report exactly:

```
## setup: open-agentic-platform

**make setup:** {ok / failed at <step>}
**Governed reads verified:**
  - spec-spine index: {ok}
  - spec-spine registry status-report: {N specs across <statuses>}
  - spec-spine registry list --ids-only: {N spec ids}

Next: run `/init` to load full session context.
```

If any step failed, surface the exact command, exit code, and last 20 lines of stderr. Do not invent counts — only report values that came back from a consumer binary.

## Rules

- `make setup` owns the build steps. This command does not duplicate or reorder them.
- Halt on first failure. Do not silently continue past a missing prerequisite.
- Never parse `build/**/*.json` directly in any verification step. Use the consumer binaries (spec 103).
- Idempotent: safe to re-run. Cargo skips up-to-date crates; `pnpm install` is fast on warm cache.
