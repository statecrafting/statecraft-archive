---
id: "008-session-harness"
title: "The session harness: what an agent may do here, claimed by a spec"
status: approved
created: "2026-09-11"
implementation: complete
depends_on:
  - "000-bootstrap"
extends:
  # The version floor, the corrected hashed-input globs and the ownership
  # ratchet are additions to the config spec 000 owns and keeps owning. This
  # spec does not take the config; it adds the keys its harness needs.
  - { spec: "000-bootstrap", unit: "spec-spine.toml", nature: additive }
  # The README gains a paragraph naming the harness and a Governance section
  # pointing at `make gate` instead of the retired command list. Spec 001 owns
  # that file for its package and license table and says nothing about how the
  # gate is run, so this adds to the file without touching 001's subject.
  - { spec: "001-packages-thesis", unit: "README.md", nature: additive }
establishes:
  - { kind: file, path: "AGENTS.md" }
  - { kind: file, path: "CLAUDE.md" }
  - { kind: file, path: "Makefile" }
  - { kind: file, path: ".mcp.json" }
  - { kind: file, path: ".gitattributes" }
  - { kind: file, path: ".claude/settings.json" }
  - { kind: directory, path: ".claude/rules/" }
  - { kind: directory, path: ".claude/agents/" }
  - { kind: directory, path: ".claude/skills/" }
  - { kind: directory, path: ".githooks/" }
  - { kind: directory, path: "standards/spec/" }
  - { kind: file, path: ".github/workflows/govern.yml" }
summary: >
  This repository was born governed but not harnessed: it had a corpus, a
  config and a CI gate, and nothing that told an agent how to work in it.
  Sessions therefore improvised the loop, and the one surface that decides
  what an agent may do was the one surface no spec claimed. Install the
  spec-spine kit (ten skills, four agents, four rules, the hooks, the
  composite gate) and claim every file it is judged by, so an edit to the
  harness is a governed change like any other. The CI gate moves from the
  hand-rolled `spec-spine.yml` to the kit's `govern.yml`, which runs the same
  `make gate` chain a session runs locally. `spec-spine.toml` gains the version
  floor the kit's verbs require, and its three `dir/**` hashed-input patterns
  are corrected: written that way they matched directories only, so the
  constitution, the contract and every workflow had never entered a single
  content hash.
---

# 008: The session harness

## 1. Purpose

Spec 000 says this repository is born governed: the spine exists before the
first package. It does, and the five packages of spec 001's ladder all
arrived under it. What never arrived is the other half of governance, the
part that acts on a working tree rather than judging one.

The gap showed up as improvisation. A session opening this repository found
`specs/`, `.derived/`, `spec-spine.toml` and a CI workflow, and nothing that
said which spec to take next, what to run before committing, what a
`Spec-Drift-Waiver:` is for, or that the derived shards are compiler output.
Each of those had to be rederived from the corpus every time, which is both
wasteful and unreliable. The cautionary precedent spec 000 section 1 already
records, statecraft's `Rename (#24)` hand-editing derived shards, is precisely
that failure mode reaching a tree: nothing in it told the session not to.

The second and sharper gap is that the harness is itself the most
security-relevant surface in a governed repository, because it is the
statement of what an agent may do, and here it would have been the one
surface no spec claimed. A file that stales the ledger but no spec claims is
a file the coupling gate cannot refuse an edit to. Spec 000 section 2 makes
ownership exclusive and total by design; an unclaimed harness is a hole in
exactly that property.

This spec closes both: install the harness, and claim it.

## 2. Territory

Twelve units, listed in the frontmatter, which fall into four groups.

**The protocol.** `AGENTS.md` is the cross-agent session-init authority read
by Claude Code, Codex CLI, Cursor and Copilot through the AAIF/Linux
Foundation standard; `CLAUDE.md` is the repository orientation. Between them
they carry every project-specific value the skills read: the binary
invocation, the version pin, the gate command list, the stack gate, the
never-touch artefacts.

**The session harness.** `.claude/settings.json` (hooks and the permission
policy), `.claude/skills/` (ten), `.claude/agents/` (four),
`.claude/rules/` (four), and `.mcp.json`.

**The build half.** `Makefile`, which is the single definition of the gate,
and `.github/workflows/govern.yml`, which runs it in CI.

**The git-level plumbing.** `.githooks/` (the opt-in merge driver for the
committed shard trees) and `.gitattributes` (the stanza that registers it),
plus `standards/spec/`, which had no owner before this spec and is the tier-2
text every spec in the corpus is judged against.

Two units outside that territory are touched additively rather than taken.
`spec-spine.toml` stays spec 000's: this spec adds the version floor, the
corrected globs and the ownership ratchet to it. `README.md` stays spec 001's,
which owns it for the package and license table: this spec adds a paragraph
naming the harness and repoints the Governance section at `make gate`, since
the commands it listed are the retired ones. Both are declared as `extends`
edges in the frontmatter, which is what the coupling gate reads; a claim on a
path beats the generic README bypass, so without the second edge a one-line
README fix here would have come back as `C-001` against a thesis spec that has
nothing to say about it.

`standards/spec/` is claimed as a directory unit, not to make this spec the
author of the constitution, but so that editing it is a governed act at all.
The constitution's own Amendment section is unchanged and still governs
principle-level change: an ordinary approved spec claims the affected heading
as a section unit and says what it is changing. A section claim inside a
directory this spec owns is an ordinary `extends` edge and amends nobody.

## 3. Behavior

### 3.1 The kit is copied, not adapted

Every `SKILL.md` and every rule is byte-identical to the spec-spine kit at
the version this spec landed. That is the kit's own contract: the skills are
repository-invariant and each ends with a `## Project layer` section naming
what it reads from `AGENTS.md`, `spec-spine.toml` and the path-scoped rules.
Keeping them identical makes a kit update a copy rather than a merge, and
makes the question "has our harness drifted from upstream" answerable with
`diff`.

The four agents are the exception the kit sanctions: they carry placeholders
for the source tree and the build command, which here resolve to `addon/`,
`packages/` and `vendor/encore/`, and to `npm run typecheck` plus
`npm run build` inside a touched addon.

### 3.2 The hooks read and never write, with one exception

`SessionStart` and `Stop` report registry and index freshness.
`PostToolUse` recompiles the registry after a `spec.md` edit, which is the
one sanctioned write, because the session is live and can commit the
recompiled shards with the edit that staled them; it also reports staleness
after an edit to any hashed governance path. `PreToolUse` refuses a push that
would update the default branch and blocks `gh pr create` on a stale tree,
uncommitted shards, or a red coupling gate with no inline
`Spec-Drift-Waiver:`.

A hook that writes at session end would be worse than useless here: it would
leave `.derived/` dirty for whoever comes next, and an orchestrator that
refuses to start on a dirty tree would then never start.

Every hook resolves its target from the repository the command acts on rather
than the session's project directory, which matters in this codebase's normal
working arrangement: statecrafting is edited side by side with its three
consumers, and an edit in a sibling checkout must not recompile this one.

`.claude/settings.json` is the one harness file that is not byte-identical to
the kit, and the kit says so: its `PostToolUse` glob list is the adopter's to
tune against `[index] extra_hashed_inputs`. Two entries are added here,
`*/.gitattributes` and `*/.githooks/*.sh`, so that editing either reports
staleness at the moment of the edit rather than at the next gate. The
difference from upstream is exactly those two globs, which keeps a kit update
a one-line merge for this file and a plain copy for every other.

### 3.3 The gate has one definition

`make gate` is the governed loop, read-only throughout:

```sh
spec-spine check --fail-on-unresolved --fail-on-warn
spec-spine lint --fail-on-warn
spec-spine index coverage --fail-on-untraced
spec-spine couple --base $(BASE) --head HEAD
```

`make refresh` is the writing pair (`compile`, `index`) for a session that
has edited a spec and can commit the regenerated shards.

**Both legs of `govern.yml` run `make gate`, and neither restates the
chain.** The kit ships a `govern.yml` whose pull-request leg spells the four
commands out, because the coupling gate has to be handed the pull-request
body and a `make` target had nowhere to put it. That is a second definition
of the gate, and two definitions drift the first time one of them is edited.
The `gate` target here takes a `PR_BODY` variable instead, empty locally and
set to a file path in CI, so the pull-request leg differs from the push leg
in the two values it passes and in nothing else. The body reaches the gate as
a file rather than an argument: a body containing a `Spec-Drift-Waiver:` line
has no safe shell quoting, and a file has no quoting at all.

`AGENTS.md` carries the same list in prose, because the skills are written
against "the gate as `AGENTS.md` lists it". That leaves two places the chain
is written down rather than three, and acceptance criterion 4 is what holds
them together.

The stack gate beside it is `make typecheck test licenses`. Rust hygiene
(`make fmt`, `make clippy`) is deliberately outside the gate: three of the
four addon workspaces are not rustfmt-clean today, and reformatting them is a
change to code owned by specs 003, 005 and 006, not to this harness. The
targets exist and work, so the cleanup is one command away for the spec that
claims it.

### 3.4 What is hashed is what is claimed

`[index] extra_hashed_inputs` carried three patterns written as `dir/**`:
`standards/**`, `.github/workflows/**` and `.claude/rules/**`. In the `glob`
crate that form matches directories only, so all three contributed zero bytes
to every content hash. The constitution, the contract, the spec template and
every workflow in this repository had therefore never entered a shard hash,
and `lint` had been reporting it as L-010 against a config nobody re-read.
They are now written as file globs.

The same read surfaced four L-008 warnings: `README.md` (spec 001),
`publish.yml` (spec 002), `build.yml` (spec 007) and the governance workflow
(spec 000) were each claimed by a spec while sitting outside every content
hash, which means their contents could change without staling anything. The
corrected globs cover all four.

The list and this spec's `establishes` are deliberately the same set. Every
path folded into the global scalar is owned by exactly one spec, and every
unit this spec claims is folded into the scalar. That symmetry is what makes
the gate total: without it, a file can stale the ledger that no spec can be
made to answer for, or a spec can claim a file whose edits nothing notices.

`[coupling] require_ownership` is turned on in the same change. The ratchet
was already met (`index coverage` reports every source file in the tree
specifically claimed), so the knob defends a property that holds today rather
than creating a backlog.

### 3.5 The governance workflow transfers from spec 000

`.github/workflows/spec-spine.yml` is deleted and
`.github/workflows/govern.yml` takes its place. This is the ownership
transfer spec 000 section 2 describes, run in the direction of the harness:
spec 000 drops the path from its `establishes` in the same change that adds
the replacement here. The edge is transferred, not duplicated.

The rewrite is not cosmetic. The old workflow pinned spec-spine v0.10.0,
eight releases behind the floor the kit's verbs need, and its first step was a
writing `spec-spine compile`. A gate that repairs the tree it is judging
cannot report that the committed shards were stale, which is the single
defect this repository's own bootstrap spec warns about in section 1 and
which CI was structurally incapable of catching. The replacement is read-only
and pinned to the version the floor names.

Everything the old workflow did that was this repository's own is kept: the
license gate (spec 001 section 3, spec 005 section 3.3) still runs on every
pull request, now through `make licenses`. The TypeScript surface gains a
gate it never had: `npm run typecheck` and `npm test` existed as scripts and
no workflow ran them.

### 3.6 The merge driver is opt-in and never replaces the gate

`.githooks/` carries a merge driver that resolves a conflict in a committed
shard by regenerating from the merged tree, and `.gitattributes` registers it
on the shard globs. It does nothing until
`./.githooks/enable-merge-driver.sh` writes to a clone's `.git/config`, which
is not committed, so every clone runs it once or never.

Sharding already removes the common conflict: two pull requests touching
different specs or different packages write disjoint shard files. The driver
is for the case sharding does not cover, and what proves its output correct
is `spec-spine check` on the merge commit, which runs whether or not the
driver is registered.

## 4. Out of scope

**The constitution's content.** This spec claims `standards/spec/` so that
edits to it are governed, and refreshes those documents to the spec-spine
0.18.0 text in the same change, preserving this repository's own additions
(the per-package licensing principle, the package-inventory clause). It does
not author new principles. Principle VI onward remains this corpus's to
write, through the constitution's own Amendment section.

**Reformatting the Rust.** Named in 3.3 and left to whichever spec claims it.

**The addon build matrix.** Spec 007's `build.yml` is untouched. It is
path-filtered to `addon/**` because a release-profile build of four napi-rs
crates on three platforms costs minutes, and folding it into the governance
workflow would charge every specs-only pull request for it.

**Orchestration across repositories.** The harness drives one spec per
session in this repository. That statecrafting's packages are consumed by
three repositories with three different licenses is spec 001's subject, and
each consumer runs its own spine and its own harness.

## 5. Acceptance

1. `make gate` exits 0 on a clean checkout, and every step in it is
   read-only: running it leaves `git status --short -- .derived/` empty.
2. `spec-spine lint --fail-on-warn` exits 0, so no `[index]` pattern matches
   directories only and no claimed file sits outside every content hash.
3. Every `SKILL.md` and every file under `.claude/rules/` is byte-identical
   to the spec-spine kit it came from, and no `<bracketed>` placeholder
   survives anywhere in `.claude/` or `AGENTS.md`.
4. The gate command list in `AGENTS.md` and the `gate` target in `Makefile`
   name the same four commands in the same order, and `govern.yml` invokes
   that target on both event legs: no line in it runs a `spec-spine` gate verb
   directly.
5. Editing `.claude/settings.json` without editing this spec fails
   `spec-spine couple` with `C-001`, and the same holds for every other unit
   in the frontmatter.
6. `.github/workflows/spec-spine.yml` no longer exists, spec 000 no longer
   claims it, and the license gate still runs on every pull request.

## 6. Implementation record

Landed 2026-09-11, on the pull request that introduced it: as with spec 007,
the harness is inside the gate that judges it, so the first green run of
`govern.yml` is this spec's own acceptance evidence.

**Ratification.** This spec was authored by an agent session and set to
`status: approved` on the maintainer's explicit instruction, given before the
work began. That is worth recording rather than leaving implicit, because the
kit this spec installs contains the rule that ratification is a human act and
that an agent never flips a spec it wrote from `draft` to `approved` on its
own authority. The rule is not weakened by this spec; it is the reason the
exception is written down here instead of passing unremarked. Every spec
authored under the harness from here is born `draft`.

**The version floor.** `[meta] required_version = ">=0.18.0"` and the exact
`SPEC_SPINE_VERSION=v0.18.0` in `govern.yml` are two different instruments
and both are wanted: the floor refuses a contributor's stale local binary at
the call, and the exact pin makes CI reproducible, which is what makes
`/setup`'s claim that "a local pass on another version proves nothing" true.

## Verification

Each line below is one command: a fence's body line is a command, so no line
may depend on a variable another line set.

```verify:cli
# 2 the harness is present, all of it.
test -f AGENTS.md
test -f CLAUDE.md
test -f Makefile
test -f .mcp.json
test -f .claude/settings.json
test -x .githooks/enable-merge-driver.sh
test -x .githooks/merge-derived-index.sh
# 3.1 ten skills, four agents, four rules.
test 10 -eq "$(ls .claude/skills | wc -l | tr -d ' ')"
test 4 -eq "$(ls .claude/agents | wc -l | tr -d ' ')"
test 4 -eq "$(ls .claude/rules | wc -l | tr -d ' ')"
# 5.3 no placeholder survived the copy.
! grep -rq '<your ' .claude
! grep -q '<bracketed>' AGENTS.md
! grep -q '<your-project>' AGENTS.md
# 3.5 the old workflow is retired and its replacement is at the kit's path.
! test -f .github/workflows/spec-spine.yml
test -f .github/workflows/govern.yml
# 5.6 the license gate survived the rewrite.
grep -q 'make licenses' .github/workflows/govern.yml
# 5.4 the gate has one definition: govern.yml calls the target on both legs
# and runs no gate verb of its own.
test 2 -eq "$(grep -c 'make gate BASE=' .github/workflows/govern.yml | tr -d ' ')"
! grep -qE '^[[:space:]]*spec-spine +(check|lint|index|couple)' .github/workflows/govern.yml
# 5.2 and 5.1 the governed loop is green and read-only.
make gate
git diff --quiet -- .derived/
# 3.3 the stack gate AGENTS.md names.
make typecheck
make test
make licenses
```
