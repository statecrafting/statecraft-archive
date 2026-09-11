# CLAUDE.md: statecraft

## Project Overview

statecraft is the governed agentic delivery control plane: tenants
(per-customer GitHub App installations), factory (stamps apps from the
enrahitu template via its versioned `template.toml` contract), fleet
(operates stamped governed cells; deployd's orchestration core as an
in-process napi addon), and the governance UI. It is itself the first
production EnRaHiTu app, on a two-plane model: the platform is one
EnRaHiTu app, every tenant app is another, independent one. The thesis,
consolidation record, service map, and milestone ladder live in
`specs/001-statecraft-thesis/spec.md` (rewritten ground-up 2026-07-19
from the grand-refactor realignment).

The services of specs 002 through 008 have landed; the spec spine stays
the authoritative design record, and new surfaces land under their own
numbered specs as their build starts.

## Repository Structure

```
specs/       Feature specs, the authoritative design record
standards/   spec-spine constitution, contract, templates
.derived/    Compiler output (committed shards; never hand-edit)
AGENTS.md    The cross-agent session protocol and the gate command list
Makefile     `make gate` (read-only loop), `make refresh`, `make stack`
.claude/     The spec-spine kit: ten skills, five agents, four rules
.githooks/   Opt-in merge driver for the committed shard trees
```

Service layout (spec 001 §3): `backend/` (the Encore.ts app: `auth/`,
`idp/`, `core/`, `tenants/`, `factory/`, `fleet/`, `governance/`, plus
chassis plumbing; the fleet-native and governance-native napi addons are
pinned @statecrafting/* dependencies, no longer in-tree),
`frontend/` (governance UI); `frontend-admin/` (flag-gated operator
dashboard) arrives with the substrate rewrite.

## Governance

This repo is governed by spec-spine (`spec-spine.toml`, owned by spec 000):

- **Specs are the source of truth.** Every substantive change is bound to
  a spec under `specs/NNN-slug/spec.md`; owned paths and their owning spec
  move together (`spec-spine couple` enforces this at PR time; waiver
  keyword `Spec-Drift-Waiver:` in the PR body).
- **Governed reads.** Read `.derived/**` only through `spec-spine`
  subcommands (`registry list/show/status-report`, `index
  check/render/orphans`); never ad-hoc `jq`/`python` parsers
  (`.claude/rules/governed-artifact-reads.md`).
- **After editing any `specs/*/spec.md`**: run
  `spec-spine compile && spec-spine index` (or `make refresh`) and commit
  the regenerated `.derived/` shards with the spec edit.
- **The ownership ratchet is on.** `[coupling] require_ownership = true`,
  so `C-002` refuses a changed source file that no spec specifically
  claims. Claim every new file in the spec you are implementing, in the
  same change.
- **The agent harness is governed too** (spec 013): `AGENTS.md`,
  `CLAUDE.md`, `.claude/**`, `Makefile` and `.githooks/**` are hashed
  index inputs, so editing one stales the index until it is regenerated
  and committed. `AGENTS.md` is the project layer the ten skills read;
  the skills themselves are byte-identical to the spec-spine kit and are
  updated by copying, never by hand-editing.

## Build Commands

```bash
make refresh   # spec-spine compile + index: the writing half
make gate      # the read-only governed loop, exactly what CI runs:
               #   check --fail-on-unresolved --fail-on-warn
               #   lint --fail-on-warn
               #   index coverage --fail-on-untraced
               #   couple --base <resolved default branch> --head HEAD
make stack     # the npm half: build both SPAs + the app, check:model,
               # typecheck, vitest (mirrors .github/workflows/verify.yml)
make verify SPEC=013   # one spec's declared `## Verification` block
```

Requires `spec-spine` **0.18.0 or later** (`cargo install spec-spine-cli`),
pinned in `spec-spine.toml [meta] required_version` and installed at that
version by CI. Node 24 and npm for the stack half. Run `/setup` once in a
new checkout and `/prime` at the start of every session.

## Key Conventions

- **License boundaries are load-bearing.** This repo is AGPL-3.0; the
  enrahitu template and statecraft-cli are Apache-2.0 in their own repos.
  Do not move code across the boundary without noting the license
  implication in the PR.
- **The factory consumes `template.toml` and nothing else** (enrahitu
  spec 009). Never reach into template internals from factory code.
- **CoreLedger is the data API** (enrahitu specs 003/011): the control
  plane runs the Postgres driver; no direct SQL client and no Encore
  `SQLDatabase` anywhere.
- **Fleet v1 targets hetzner-k3s** (spec 001 §3); the unit of placement
  is "EnRaHiTu container + volume + ingress".
