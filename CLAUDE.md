# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with
code in this repository.

## What this repo is

The shared native packages behind the statecraft product family: four napi-rs
addons and the Encore build toolchain that statecraft, enrahitu and chancery
all consume. It publishes eight npm packages under one `@statecrafting/*`
scope, and it exists because those packages were previously scattered across
three repositories under three scopes that had stopped describing ownership.

| Surface | Path | What it is |
|---|---|---|
| napi-rs addons | `addon/{hiqlite,kernel,governance,fleet}-native/` | Four standalone cargo workspaces, each also an npm package (specs 003 to 006) |
| Build toolchain | `packages/toolchain*/` | The Encore build drivers plus three per-platform binary packages (spec 002) |
| Vendored Encore | `vendor/encore/` | Upstream encoredev/encore, MPL-2.0, pinned at `ENCORE_VERSION` |
| Governance | `specs/`, `standards/spec/`, `.derived/` | The spine; `.derived/` is compiler output and committed |
| Harness | `AGENTS.md`, `.claude/`, `Makefile`, `.githooks/` | The session harness (spec 008) |

There is no root `Cargo.toml`. The Rust in this tree lives in four standalone
workspaces under `addon/` plus the vendored Encore workspace, which is why the
`Makefile` targets name workspaces directly instead of probing the root.

## Commands

```sh
make gate                # read-only: the whole governed loop, in order
make refresh             # writing: recompute the committed shard trees
make verify SPEC=008     # one spec's declared acceptance

make typecheck           # npm run typecheck (tsc --noEmit)
make test                # npm test (vitest)
make licenses            # npm run check:licenses, the license-tier gate

make addons              # build all four napi-rs addons for this host
make sanity              # hiqlite-native's two behavioral suites
make fmt clippy          # Rust hygiene, NOT part of gate (see below)
```

`make gate` plus `make typecheck test licenses` is what
`.github/workflows/govern.yml` runs on every pull request, through the same
file, so the local loop and the CI loop cannot drift. A Rust change adds
`make addons` and `make sanity`, which CI runs across three platforms in
`.github/workflows/build.yml` (spec 007), path-filtered to `addon/**`.

`make fmt` and `make clippy` work and are deliberately outside `gate`: three of
the four addon workspaces are not rustfmt-clean, and reformatting them is a
change to code owned by specs 003, 005 and 006. Spec 008 section 3.3 records
this; a spec that claims the cleanup turns them on.

Node 24 or later. `npm run build:runtime` compiles the vendored Encore
workspace and is the most expensive build here by a wide margin; it is outside
every gate, and spec 007 section 4 says why that is a decision and not an
oversight.

## Invariants that constrain changes

- **Three licenses coexist, and none is inferred.** The root is Apache-2.0 as a
  default, not a claim. The three `@statecrafting/toolchain-<platform>`
  packages are MPL-2.0 because they carry vendored Encore binaries;
  `governance-native` and `fleet-native` are AGPL-3.0 because they are
  control-plane internals no stamped customer app touches. **No
  customer-reaching package may depend on an AGPL-3.0 one.** Every package
  declares its own license in its manifest and carries its own LICENSE file.
  Read `specs/001-packages-thesis/spec.md` before adding or relicensing
  anything. The machine half is `scripts/check-licenses.mjs`, which checks the
  `statecrafting.licenseTiers` map in the root `package.json` against
  `spec-spine.toml`'s package inventory in both directions: a package in one
  and not the other fails.
- **Publishing is CI-only and tag-triggered, and idempotent by version.**
  `publish.yml` skips a version already on npm, so a leg that fails after
  another has published cannot be recovered by retagging, only by spending a
  version nobody asked for. Never run `npm publish` locally; the permission
  policy in `.claude/settings.json` denies it.
- **A napi binary is named twice.** `napi.targets` in a package manifest and
  the `cp` in `publish.yml` both spell the triple, in two files. Spec 007's
  gate asserts the filename exists on each leg so a rename fails at
  pull-request time rather than with `cp: No such file` against a spent tag.
- **`vendor/encore/` is upstream and pinned.** No pull request here authors
  Rust inside it. It moves when `ENCORE_VERSION` moves.
- **Compiling is not evidence.** Two of the defects spec 003's 0.2.0 work found
  were invisible to the compiler and immediate to a running node: a unit
  variant that serialized as the string `"Null"` where JSON `null` was
  intended, and a lock handle dropped Rust-side that turned a lease into a
  silent no-op. `make sanity` is the check that would have caught both.

## Spec governance

`specs/` holds this repository's own corpus, compiled to committed shards under
`.derived/`. Nine specs: `000` bootstrap, `001` the packages thesis (a record,
never a work order), `002` to `006` the migration ladder in the order the
packages landed, `007` build verification, `008` this harness.

Governance runs on the published `spec-spine` binary installed on `PATH`
(`cargo install spec-spine-cli`, or `npm i -g spec-spine`). The root
`package.json` is a build harness, not a governance dependency: there is no
`npx spec-spine` here. `spec-spine.toml` sets
`[meta] required_version = ">=0.18.0"`, so a binary too old for the verbs the
harness calls is refused at the call with a config error rather than answering
with a misleading exit code, and `govern.yml` installs exactly `v0.18.0`.
Install or upgrade with `/setup`.

Read compiled artifacts only through `spec-spine` subcommands, never with `jq`,
`grep`, `python`, `awk` or `sed` over the shard JSON
(`.claude/rules/governed-artifact-reads.md`). Spec 000 section 1 records this
repository's own cautionary precedent: a sibling repo renamed derived shards by
hand instead of recompiling, and the index reported STALE until a later session
noticed. A hand-edit that looks like a rename is still a hand-edit.

`AGENTS.md` is the cross-agent protocol and the authority for the gate command
list; `.claude/` carries the session harness (ten skills, four agents, four
rules) and is a byte-identical copy of the spec-spine kit, so a kit update is a
copy rather than a merge. Spec 008 claims every file the gate judges it by:
`AGENTS.md`, `CLAUDE.md`, `Makefile`, `.mcp.json`, `.gitattributes`,
`.claude/settings.json`, `.claude/skills/`, `.claude/agents/`,
`.claude/rules/`, `.githooks/`, `standards/spec/` and `govern.yml`. Every path
in `[index] extra_hashed_inputs` is owned by exactly one spec. Editing any of
them requires editing spec 008 in the same change, or `spec-spine couple`
refuses the pull request. `spec-spine.toml` stays spec 000's; `publish.yml` is
spec 002's and `build.yml` is spec 007's.

`[coupling] require_ownership` is on, so a changed source file no spec
specifically claims is refused as `C-002`. `index coverage --fail-on-untraced`
is the local half and runs inside `make gate`.

Ratification is a human act. An agent never advances a spec's `status` from
`draft` to `approved`, including a spec it just wrote. Spec 008 is the one
exception on record and says so in its own implementation record.

Never resolve a coupling failure by rewriting a spec to match code already
written. Surface the contradiction instead; a `Spec-Drift-Waiver:` is a human
instrument and an agent never writes one on its own authority
(`.claude/rules/adversarial-prompt-refusal.md`).

To enable the derived-artifact merge driver in a fresh clone, run
`./.githooks/enable-merge-driver.sh` once. It writes only to `.git/config` and
never replaces the staleness gate.

## Authored text

No em dash (U+2014) anywhere: chat, code, comments, string literals, docs,
specs, commit messages, PR bodies. Use a colon, semicolon, comma, parentheses,
or two sentences. En dashes are fine for numeric ranges. No AI attribution in a
commit message or PR description, and no Claude Code session link in anything
that reaches the repository or GitHub.
