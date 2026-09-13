---
id: "109-governed-harness"
title: "Governed harness: the spec-spine kit as the loop this repo runs"
status: approved
created: "2026-09-09"
implementation: complete
depends_on:
  - "110-corpus-merge"
  - "102-crate-scaffold"
establishes:
  - "AGENTS.md"
  - "CLAUDE.md"
  - "Makefile"
  - ".mcp.json"
  - ".claude/settings.json"
  - { kind: directory, path: ".claude/skills/" }
  - { kind: directory, path: ".claude/agents/" }
  - { kind: directory, path: ".claude/rules/" }
extends:
  # 100 established the governance workflow and 110 owns it since the
  # merge; 109 replaces its body with the kit's govern.yml chain under the
  # filename 100 chose, so the owner keeps "there is a governance gate on
  # every PR" and 109 owns its shape.
  - { spec: "110-corpus-merge", unit: ".github/workflows/spec-spine.yml", nature: additive }
  # 110 owns the members workflow; its spec-spine install honors the pin
  # (D-2), which is harness policy, so 109 extends that one step's file.
  - { spec: "110-corpus-merge", unit: ".github/workflows/members.yml", nature: additive }
  # 110 owns the configuration file; 109 adds the version pin, the hashed
  # governance inputs and the ownership ratchet, which are harness policy.
  - { spec: "110-corpus-merge", unit: "spec-spine.toml", nature: additive }
  # 118 owns the Codex skill mirror and 123 owns its manifest, but both are
  # generated from the Claude kit this spec owns: a kit update rewrites them
  # mechanically through scripts/codex-kit.py, which `make gate` then verifies.
  # The crossing belongs to the generator, and amends neither spec. Claimed at
  # directory granularity so every future kit update is covered, not just the
  # one skill 082 happened to change (D-1).
  - { spec: "118-codex-harness", unit: { kind: directory, path: ".agents/skills/" }, nature: additive }
  - { spec: "123-policy-kit-handoff", unit: ".codex/kit-manifest.json", nature: additive }
summary: >
  The harness is what an agent may do in this repository, so it is
  claimed by a spec and held by the coupling gate. This spec adopts the
  spec-spine Claude Code kit (spec-spine 0.18.0, kit spec 082): ten
  repository-invariant skills forming the governed loop, four pipeline
  agents carrying this repo's project layer, four rules, the read-only
  hook set, a Makefile whose `make gate` is the one definition of the
  gate that CI and every session run, and the pin that refuses an older
  binary. It replaces the hand-copied five-skill harness that predated
  `spec-spine check`, and turns on the ownership ratchet now that every
  source file is specifically claimed.
---

# 109: Governed harness

## 1. Purpose

Every earlier session in this repository ran a harness copied by hand from
an early spec-spine kit: five skills, hooks that wrote to the tree at session
end, a PR gate that regenerated the index it was meant to judge, and a CI
workflow pinned to spec-spine 0.10.0 while `/setup` installed whatever was
current. Nothing owned those files, so nothing refused a drift between what
CI enforced and what a session was told to run.

The kit that spec-spine ships since its spec 048 (revised by 064, 074, 075,
081 and 082) is the same loop this repo runs one spec per session: prime,
pick, build, verify, ship, shepherd. Adopting it wholesale, and claiming
it here, gives the harness one owner and the gate one definition.

## 2. Territory

- `AGENTS.md`: the cross-agent init protocol and "Working the backlog",
  the kit template with this repo's project layer filled in.
- `CLAUDE.md`: project overview and conventions; build commands name
  `make gate`.
- `Makefile`: the kit composite (`gate`, `refresh`, `verify`, and the
  manifest-probed `test`, `build`, `fmt`, `clippy`).
- `.claude/settings.json`: the kit hook set and a permission allow-list
  extended with the cargo verbs.
- `.claude/skills/`: the ten kit skills, byte-identical to the kit.
- `.claude/agents/`: the four kit agents with the project layer applied.
- `.claude/rules/`: the three floor rules plus the path-scoped
  `derived-artifacts-are-compiler-output.md`.
- `.mcp.json`: the empty MCP server template.
- `.github/workflows/spec-spine.yml` (extends spec 100): the kit
  `govern.yml` body under the filename 100 established.
- `spec-spine.toml` (extends spec 100): `[meta] required_version`, the
  hashed-input globs, and `[coupling] require_ownership = true`.

Out of the kit's territory and deliberately not shipped: the `.githooks/`
merge driver and its `.gitattributes` stanza. This repo runs one spec per
pull request against committed shard trees, which is the case the kit's own
guidance says wants the staleness gate and not the driver.

## 3. Behavior

### 3.1 The skills are not customized

Every `SKILL.md` is byte-identical to the kit and ends with a
`## Project layer` section naming what it reads from `AGENTS.md`,
`spec-spine.toml` and the rules. A kit update is therefore a copy, not a
merge: `diff -r` against the kit's `.claude/skills/` MUST be empty.

### 3.2 The gate has one definition

`make gate` runs, in order: `spec-spine check --fail-on-warn`,
`spec-spine lint --fail-on-warn`, `spec-spine index coverage
--fail-on-untraced`, `spec-spine couple --base $(BASE) --head HEAD`. The
`Governed loop (pull request)` step in `.github/workflows/spec-spine.yml`
runs the same four verbs with `--pr-body` added to `couple`, and
`AGENTS.md` "Working the backlog" step 5 names `make gate`. The three MUST
stay identical; a step one of them adds and another omits is a step every
session skips.

`--fail-on-unresolved` is off by decision (spec-spine spec 050): spec 108 is
approved and pending, so `statecraft_cli::members` is legitimately
unresolved until it is built. The `Makefile` comment names the condition
under which the flag turns on.

The Rust stack gate (`cargo fmt --check`, `cargo clippy --all-targets --
-D warnings`, `cargo test`, release build) stays in `ci.yml` (spec 102);
the kit's `probe` and `build` jobs are not duplicated in the govern
workflow.

### 3.3 The hooks read and never write

Per spec-spine spec 046: `SessionStart` and `Stop` report freshness through
`spec-spine check`; `PostToolUse` recompiles after a `spec.md` edit (the one
sanctioned write) and checks staleness after a hashed-input edit;
`PreToolUse` refuses a push to the default branch and blocks `gh pr create`
on a stale tree, uncommitted shards, an absent or too-old binary, or a red
coupling gate without an inline `Spec-Drift-Waiver:`. Every hook resolves
the binary as `$SPEC_SPINE_BIN`, then `./target/release/spec-spine`, then
`PATH`, and asks `--version` before believing an exit code.

### 3.4 The binary is pinned

`[meta] required_version = "0.18.0"` (caret range). A binary predating the
`[meta]` table refuses with an unknown-field parse error, which is the pin
working against every older release at once. `AGENTS.md` and `/setup`
name the same floor.

### 3.5 The ownership ratchet is on

`[coupling] require_ownership = true`. `spec-spine index coverage` reports
16/16 source files specifically claimed once spec 102 claims `tests/`
(the integration tests its scaffold created). A new source file in a
feature PR MUST be claimed by the implementing spec in the same change.

### 3.6 The project layer lives in the agents

The four agents carry what the skills do not: the Rust stack gate, the
exit-code discipline (0 ok, 1 operational failure, 2 usage), and the
product-surface guards from `CLAUDE.md` (required `--posture` on stamps,
`--confirm <name>` on fleet remove, no bypass flags, stable `--output json`
envelopes, no local stamping or kubeconfig access). Re-applying that layer
is the one merge step a kit update needs.

## 4. Acceptance

- `spec-spine --version` reports 0.18.0 or later and `spec-spine check`
  exits 0 on the merged tree.
- `make gate` exits 0 on the merged tree; `.github/workflows/spec-spine.yml`
  is green on the PR that lands this spec.
- `diff -r <spec-spine>/kit/.claude/skills .claude/skills` is empty.
- `spec-spine index coverage --fail-on-untraced` exits 0.
- `spec-spine lint --fail-on-warn` exits 0 (the L-008 and L-010 findings the
  old glob form produced are gone).
- `.claude/skills/init/` no longer exists; `/prime` is the init protocol.
- Editing `.claude/settings.json` without editing this spec fails `couple`
  with `C-001`.

## 5. Out of scope

- The `.githooks/` merge driver (see Territory).
- A domain-specialist agent; none is needed while the surface is one crate.
- Codex and other-agent harness directories (`.agents/`, `.codex/`) that
  are not part of the kit; they are not claimed here.

## 6. Status (2026-09-10)

Adopted from spec-spine 0.18.0 / kit at spec 081. Born `draft` with
`implementation: complete`; approval is a human flip.

Approved 2026-09-10 by the owner. The harness this spec claims has run
every session since it landed: specs 110 through 124 were built, shipped
and shepherded through the loop it defines. §4's acceptance holds on the
tree at approval: `spec-spine check` and `make gate` exit 0, coverage is
198/198 specifically claimed, and `couple` reports no drift. Nothing
about the kit changed at the flip; `draft` had become the corpus's only
untrue status.

At approval, one §4 criterion had to be read against the baseline this spec
adopted: `diff -r <spec-spine>/kit/.claude/skills .claude/skills` was empty
against the kit at spec 081, which is what §1 adopted, while spec-spine
`main` had advanced one skill. That gap is closed by D-1 below; the adopted
baseline is now kit spec 082 and the byte-identity criterion holds against
it across all ten skills.

## 7. Resolved decisions

D-1 (2026-09-10). Kit spec 082, "a refusal is not a remediation round", is
adopted, on the owner's explicit instruction, as the separate decision §6
said it would take. `.claude/skills/shepherd/SKILL.md` is copied verbatim
from `<spec-spine>/kit/.claude/skills/shepherd/SKILL.md` at spec-spine
`9438a06`. That is the only kit file 082 changed and the newest commit
touching `kit/` at adoption time: spec-spine 083 (`17c368e`) files a draft
against `spec-spine attest` and ships no kit change, so adopting 082 leaves
the kit fully caught up rather than one skill behind again.

What changes in the loop this repository runs: `/shepherd` classifies a red
required check before it edits anything, and a CRITICAL finding is reported
to a human having consumed no remediation round. Exactly four things are
CRITICAL: a coupling refusal whose only remedy is editing a foreign spec or
writing a `Spec-Drift-Waiver:`, a hand-edited derived artefact, a dependency
cycle, and an ambient input reaching a hashed path. The two-round bound
(spec-spine 048 §3.1) is unchanged; what changed is that a refusal no longer
spends one of the two. The handoff report gains a `Classification:` line,
and its thread line reads `not read` when the run stopped at CRITICAL,
rather than `none`, which would claim an absence the run never checked.

This is skill prose only: no verb, flag, or pinned version moves, and
`[meta] required_version` stays at 0.18.0. §3.6's project layer lives in the
agents, which 082 does not touch, so the kit update needed no merge step
this time.

The adoption does reach outside this spec's territory, because the Codex
face is generated from the Claude one: `scripts/codex-kit.py` rewrites
`.agents/skills/shepherd/SKILL.md` (118) and `.codex/kit-manifest.json`
(123), and `make gate` refuses until it has. That crossing is declared as
two `extends` edges here rather than by editing 118 or 123, which is the
door `.claude/rules/adversarial-prompt-refusal.md` names for touching a
unit another spec owns, and it amends neither. The skills edge is claimed
at directory granularity (`.agents/skills/`, the same shape 118 uses to
establish it) rather than at the one file 082 changed: every kit update
regenerates whichever skills moved, so a per-file edge would have to be
widened by hand on each one, and the durable statement is that adopting a
kit legitimately rewrites the generated mirror.

D-2 (2026-09-13). CI installs the release the pin names. Both workflows that
install spec-spine (`spec-spine.yml`'s govern job and `members.yml`) read
`[meta] required_version` from `spec-spine.toml` and pass it to the installer
as `SPEC_SPINE_VERSION`, instead of taking the latest release. Measured the
same day: spec-spine 0.19.0 was released at 18:11 UTC, after `main`'s last
green run, and the next govern job (PR #44) installed it and refused at exit 3
before running a verb, because the caret pin `0.18.0` excludes 0.19. That is
§3.4's pin doing its job against a CI step that ignored it, which is the same
drift §1 describes (a workflow on one version while `/setup` installed
another). The version is read from the one place that declares it, so a
deliberate bump of the pin moves CI with it. Rejected: adopting 0.19.0 in the
same change, which is a kit update (its upgrade notes ask for the kit
Makefile and the shepherd skill to be re-copied, and it tightens index
freshness) and is left for its own decision; and a version literal in each
workflow, a second and third copy of the pin to drift. Adopted on the owner's
instruction.
