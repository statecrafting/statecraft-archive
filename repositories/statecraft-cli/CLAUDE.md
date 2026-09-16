# CLAUDE.md: statecraft-cli

## Project Overview

The monorepo for the Statecraft family's tooling, daemons and CLI
packages (design doc 02 D24). Two packages, one corpus:

- the umbrella, one Rust binary named `statecraft` at the root, with
  two faces: CLI subcommands for humans and an MCP server (stdio) for
  agents, both calling the Statecraft control plane's API under the same
  identity, guards, and JSON shapes (thesis: `specs/101-cli-mcp-thesis`);
  and a local, account-less face that dispatches to member binaries
  (spec 108);
- the members under `members/`, a bun project: the sensor
  (`statecraft-sensor-claude`, specs 001-008), the engine
  (`statecraft-engine`, specs 010-041) and the Claude driver
  (`statecraft-driver-claude`, specs 014, 040, 043), packaged by spec
  042 and merged here by spec 110. Design ground truth for the engine is
  `docs/design/00-ecosystem-analysis.md`; the member seams are doc 01 and
  the monorepo and Rust sequence are doc 02.

The backlog is the spec corpus: `spec-spine registry plan` names the
ready set, and one session implements one spec (`AGENTS.md`, "Working
the backlog").

## Repository Structure

```
specs/       One corpus: 000-043 the members (observatory-born), 100-110 the umbrella
standards/   spec-spine constitution, contract, templates
.derived/    Compiler output (committed shards; never hand-edit)
.claude/     the spec-spine kit: skills, agents, rules, hooks (spec 109)
src/ tests/  the statecraft crate (spec 102 onward)
members/     the bun project: src/ (sensor, engine, driver), web/ (the UI), scripts/
docs/        design/ (the family's decision record), evidence/ (the attested bundle)
Makefile     `make gate` (read-only governed loop), `make refresh`
```

## Governance

Governed by spec-spine 0.18.0 or later (`spec-spine.toml`, owned by
spec 100; the harness by spec 109): specs are the source of truth;
read `.derived/**` only through `spec-spine` subcommands; after editing
any `specs/*/spec.md`, run `make refresh` and commit the shards with
the edit. Before every commit, `make gate` and the cargo gates below
must exit 0. `[coupling] require_ownership` is on: claim every new
source file in the implementing spec, in the same change.

## Build Commands

```bash
make refresh                 # spec-spine compile && spec-spine index
make gate                    # check, lint, index coverage, couple (read-only)
make verify SPEC=0NN         # one spec's declared acceptance
cargo fmt --check && cargo clippy --all-targets -- -D warnings
cargo test
cargo build --release        # target/release/statecraft
cd members && bun install && bun run typecheck && bun test   # the members
cd members && bun run build:member:engine                     # dist/statecraft-engine
```

`make test build fmt clippy` run the cargo half; `make members` runs the
bun half (typecheck, member builds, tests).

## Key Conventions

- **Guards are product surface.** The required `--posture` flag on
  stamps and the `--confirm <name>` on fleet remove exist by design;
  never add a bypass flag.
- **JSON output shapes are API.** The MCP face reuses the CLI's JSON
  envelopes; treat them as versioned contracts from the first verb.
- **The CLI never bypasses the platform.** No local stamping, no
  direct kubeconfig access; it triggers and watches governed verbs.
- Apache-2.0; rustls only (no native-tls).
- **The members' standing rules** (spec 110 D-6): `~/.claude` is observed,
  never written; `members/data/` is never committed; member specs 001-008
  describe shipped behavior of the sensor layer, defects included, so do
  not "fix" a recorded defect without coupling the change to its spec.
- **Runtime for the members is bun** (`bun members/src/index.ts <verb>`);
  there is no build step except `bun run build:member:*` for the member
  binaries, which `statecraft` discovers through `STATECRAFT_MEMBER_DIR`.
