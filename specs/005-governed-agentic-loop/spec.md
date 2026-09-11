---
id: "005-governed-agentic-loop"
title: "The governed agentic loop: the spec-spine kit as this repository's harness"
status: approved
created: "2026-09-11"
implementation: complete
depends_on:
  - "000-bootstrap"
establishes:
  - "AGENTS.md"
  - "CLAUDE.md"
  - "Makefile"
  - ".mcp.json"
  - ".gitattributes"
  - ".claude/settings.json"
  - { kind: directory, path: ".claude/agents/" }
  - { kind: directory, path: ".claude/rules/" }
  - { kind: directory, path: ".claude/skills/" }
  - { kind: directory, path: ".githooks/" }
extends:
  - spec: "000-bootstrap"
    paths:
      - "spec-spine.toml"
      - ".github/workflows/spec-spine.yml"
summary: >
  The harness is what an agent may do in this repository, so it gets an owner
  and the coupling gate holds it. This spec adopts the spec-spine kit at
  0.18.0: ten skills that sequence the governed loop (prime, setup, next,
  build, verify, ship, shepherd, spec, and the commit and code-review skills
  the loop calls), four pipeline agents, four behavioral rules, read-only
  session hooks, a Makefile composite gate, an opt-in merge driver for the
  committed shards, and the AGENTS.md protocol every one of them reads as its
  project layer. It also repairs three defects the upgrade exposed in the
  governance config: five `extra_hashed_inputs` globs that matched no files,
  a CI workflow pinned four minor versions behind the corpus it judged, and
  generated typegen output counted as unclaimed source. With those fixed the
  ownership ratchet can be turned on honestly.
---

# 005: The governed agentic loop

## 1. Purpose

Everything that tells an agent how to work in this repository was, until now,
unowned: `AGENTS.md`, `CLAUDE.md`, and the whole of `.claude/` sat outside the
authority graph. Spec 000 claims `spec-spine.toml` and the CI workflow;
nothing claimed the harness those two are supposed to defend. An edit to the
session hooks, the permission allow-list, or the backlog protocol was
therefore an ungoverned change to the rules of governance itself.

This spec gives the harness an owner. The coupling gate now refuses a change
to `.claude/settings.json` that does not travel with a change to this file,
which is the property the rest of the corpus already has and the harness did
not.

The second reason is drift. The harness in this repository was the kit as it
stood at spec-spine 0.10.0: five skills, three rules, a session-init protocol
whose steps predate `spec-spine check`, `registry plan`, and `verify`. The
binary has moved eight minor versions since. Adopting the current kit is not
cosmetic: the loop it encodes (pick, branch, flip, build, gate, verify, ship,
shepherd) is the one the newer verbs exist to serve.

## 2. Territory

- **Owns the harness.** `AGENTS.md` (the cross-agent init and backlog
  protocol), `CLAUDE.md` (the project overview every session loads),
  `.claude/settings.json` (hooks and permissions), `.claude/agents/`,
  `.claude/rules/`, `.claude/skills/`, `.mcp.json`, `Makefile`, `.githooks/`,
  and `.gitattributes`.
- **Extends spec 000 on two units it does not own.** `spec-spine.toml` and
  `.github/workflows/spec-spine.yml` belong to the bootstrap spec. Section 5
  changes both, so this spec declares an `extends` edge on each rather than
  amending spec 000: the bootstrap spec's claims are unchanged, and the tier-1
  document stays untouched.
- **Does not own the site.** Nothing under `app/`, `public/`, or `scripts/`
  moves. This spec adds no runtime code and changes no published byte.
- **Does not own `standards/spec/`.** The constitution, the contract, and the
  templates remain unclaimed, exactly as before this spec. Section 6 says why
  that is deferred rather than folded in here.

## 3. Behavior

### 3.1 The ten skills are byte-identical to the kit

Every `SKILL.md` under `.claude/skills/` MUST be a verbatim copy of the
spec-spine kit's. Each one ends with a `## Project layer` section naming what
it reads from `AGENTS.md`, `spec-spine.toml`, and the path-scoped rules: the
binary invocation, the version floor, the gate command list, the stack gate,
the house rules. Keeping the project layer there and out of the skills is what
makes a kit update a copy rather than a merge.

The four agents under `.claude/agents/` are the exception and carry this
repository's specifics: the site surface table, the stack gate
(`npm run typecheck && npm run build`), the static-only constraint, and the
content rules spec 001 section 2 and spec 002 section 1 impose. The kit ships
them with `<your source tree>` placeholders precisely so an adopter fills them.

The old `/init` skill is removed. `/prime` replaces it, and the protocol it
dispatches to lives in `AGENTS.md` so Codex CLI, Cursor, and Copilot read the
same steps.

### 3.2 The hooks read and never write, with one sanctioned exception

| hook | trigger | what it does |
| --- | --- | --- |
| `SessionStart` | startup, resume, clear, compact | reports both committed trees through `spec-spine check`, after establishing the binary understands the verb |
| `PostToolUse` | `Edit`, `Write` | recompiles the registry after a `specs/*/spec.md` edit (the one sanctioned write); reports `check` after an edit to any hashed governance input |
| `PreToolUse` | `Bash` | refuses a push that would update the default branch; refuses `gh pr create` on a stale tree, uncommitted shards, or a red coupling gate without an inline waiver |
| `Stop` | any | reports staleness and explicitly does not repair it |

The `Stop` hook MUST NOT regenerate. A session that has ended cannot commit
the regenerated shards, so writing there leaves `.derived/` dirty and the next
session refuses to start on dirt the harness produced itself. The previous
hook set did regenerate on `Stop`; that is the behavior this spec removes.

Every hook resolves its target from the repository the command acts on, not
from the session's project directory, so a multi-repo session cannot recompile
the wrong tree.

### 3.3 The push gate protects the branch that deploys

`main` auto-deploys to the live apex (spec 001). The `PreToolUse` hook
therefore refuses any push that would update the resolved default branch, and
`AGENTS.md` makes merging a human checkpoint even when every check is green.
The branch name is resolved from `$SPEC_SPINE_DEFAULT_BRANCH`, then the
remote's own `HEAD`, then `main`; a tag push carries its own refspec, updates
no branch, and is allowed.

### 3.4 One gate definition, three callers

`make gate` is the read-only governance chain; `make refresh` is the writing
half. A session runs it, CI runs it, and `AGENTS.md` section "Run the gate
before every commit" lists the same commands. Three callers, one definition,
so they cannot drift.

The language targets in `Makefile` are guarded on a manifest probe rather than
a command probe: a machine with `cargo` installed and no `Cargo.toml` is not a
Rust repository, and probing for the tool answers the wrong question. The npm
half of that probe is written as an `if` rather than the kit's
`test -f X && cmd || echo skipping`: the `||` form swallows a non-zero exit
from the command itself and reports a skip, which would turn a failing build
into a green target on the one manifest this repository actually has.

### 3.5 The config repairs the upgrade exposed

Three defects, all of them silent before the binary got new enough to name
them:

- **Five dead globs.** `standards/**`, `.github/workflows/**`,
  `.claude/agents/**`, `.claude/rules/**` and `.claude/skills/**` matched
  DIRECTORIES only, never the files under them, so none of those governance
  surfaces had ever contributed a byte to any content hash. The index was
  signing a ledger that had not read the harness. Each is rewritten to a file
  glob, and `spec-spine lint` reports the old form as `L-010`.
- **A CI pin four minor versions behind.** `.github/workflows/spec-spine.yml`
  installed `v0.10.0` to judge a corpus governed at 0.18.0. Section 5 moves it
  to the `make gate` chain at the current floor.
- **Generated output counted as source.** `.react-router/` is React Router's
  typegen output: gitignored, regenerated by `npm run typecheck`, authored by
  nobody. Fourteen generated declaration files sat in the unclaimed column and
  made the ownership ratchet impossible to turn on honestly. It is now a
  resolver exclusion, along with `public/data/`, the build-time registry bake.

With those three fixed, coverage is total and `[coupling] require_ownership`
is turned on: a changed source file that no spec specifically claims is
`C-002`, and `spec-spine index coverage --fail-on-untraced` refuses it in the
gate. There is no debt to grandfather, which is the only honest moment to set
that ratchet.

`[lint] unwitnessed_allowed` declares the counterpart gap in writing. A bare
file unit carries no span, and only span-backing files enter a shard hash, so
the twenty-three files under `app/` and the two root configs are claimed but
unhashed. Folding `app/**` into `extra_hashed_inputs` would restale every
shard on every routine page edit, which is the wrong trade for a tree of
source. They stay defended by the coupling gate and the ratchet; what the gap
costs is that `spec-spine check` will not call the index stale for an edit to
one of them, and this key says so rather than leaving it invisible.

`[meta] required_version = ">=0.18.0"` states the floor. A floor and not an
exact pin: the failure guarded is one-directional, a binary older than the
corpus it judges.

### 3.6 The merge driver is opt-in and never replaces the gate

`.githooks/` carries the merge driver for the committed shard trees and
`.gitattributes` registers it on the shard globs. Nothing happens until
`./.githooks/enable-merge-driver.sh` registers it in a clone's own git config.

Sharding already removes the common conflict: two pull requests touching
different specs write disjoint shard files. The driver covers only the
same-shard case, and it resolves a textual conflict by regenerating from the
merged tree. What proves the result correct is `spec-spine check` on the merge
commit, which runs whether or not the driver is registered.

## 4. Acceptance

- `.claude/skills/` holds exactly ten skills (`build`, `code-review`,
  `commit`, `next`, `prime`, `setup`, `shepherd`, `ship`, `spec`, `verify`),
  each byte-identical to the spec-spine 0.18.0 kit, and `/init` is gone.
- `.claude/rules/` holds the four kit rules, including
  `derived-artifacts-are-compiler-output.md` scoped to `.derived/**`.
- `.claude/agents/` holds the four kit agents with every `<your source tree>`
  and `<your build command>` placeholder replaced by this repository's values,
  and the reviewer carries the content rules from spec 001 section 2 and spec
  002 section 1.
- `AGENTS.md` names the version floor, the gate command list including the npm
  stack gate, the house rules for authored text, and the human checkpoint on
  merge.
- `spec-spine lint --fail-on-warn` exits 0 with zero warnings: the five L-010
  glob warnings and the twenty-five L-008 unwitnessed-claim warnings are both
  resolved, the first by fixing the globs and the second by declaring the gap.
- `spec-spine index coverage --fail-on-untraced` exits 0: every source file the
  resolver sees is specifically claimed.
- `spec-spine couple` against the base is clean with no `Spec-Drift-Waiver:`.
  Editing `spec-spine.toml` and the CI workflow is cleared by this spec's
  `extends` edges on spec 000, not by a waiver.
- `make gate` exits 0, `make typecheck build` exits 0, and
  `.github/workflows/spec-spine.yml` runs the same chain at the same floor.
- No authored file added or changed by this spec contains U+2014.

## 5. What changes in spec 000's territory

Two units, both through `extends`, neither by amending the bootstrap spec:

- **`spec-spine.toml`**: adds `[meta] required_version`, fixes the five dead
  globs and extends the hashed set to the harness files, excludes `.react-router/`
  and `public/data/` from the resolver, turns on `require_ownership` and
  `auto_waive_dependency_only`, and adds `[lint] unwitnessed_allowed`.
- **`.github/workflows/spec-spine.yml`**: replaces the hand-written four-step
  chain pinned at `v0.10.0` with `make gate` at the 0.18.0 floor, plus the npm
  typecheck and build. The file keeps its name and its owner; only its body
  changes. Adding a second workflow under the kit's own `govern.yml` name was
  rejected: it would leave two governance workflows, one of them stale, and
  removing the old one would orphan a unit spec 000 still claims.

## 6. Out of scope

- **`standards/spec/`.** The constitution, the contract and the two templates
  are still the 0.10.0-era scaffold, and the current ones carry material the
  loop reads: the lifecycle table that gives `implementation: pending` its
  meaning, and an `implementation` key in the spec template. Refreshing them
  is a change to tier-2 and tier-3 normative documents and deserves its own
  spec, with the ownership question (nothing claims `standards/` today)
  settled in the same change.
- **The site.** No route, component, or published byte changes.
- **A domain-specialist agent.** The kit suggests one (a read-only agent
  loading React Router reference docs). Not added here; the four pipeline
  agents cover the current loop.
- **Registering the merge driver.** It is opt-in per clone by design, so this
  spec ships it and does not enable it.

## 7. Decisions

- **2026-09-11: the harness gets its own spec rather than an extension of
  spec 000.** The kit's guidance is to claim the harness in a spec of its own
  and let the coupling gate hold it. Folding it into the bootstrap spec would
  put the session hooks inside a tier-1 document whose `unamendable` anchors
  are meant to be stable, and every hook edit would then be an edit to the
  spec that defines what a spec is. Rejected for that reason.
- **2026-09-11: the CI workflow keeps its filename.** The kit ships
  `govern.yml`; this repository already has `.github/workflows/spec-spine.yml`
  claimed by spec 000. Rewriting the body in place keeps one governance
  workflow and keeps spec 000's unit resolved. The alternative, adding
  `govern.yml` and deleting `spec-spine.yml`, would require editing the
  bootstrap spec's `establishes` list to drop a file, which is a governance
  act this spec has no authority to perform.
- **2026-09-11: `require_ownership` is turned on in the same change that makes
  it true.** It could have been deferred behind the `.react-router/` exclusion.
  Turning a ratchet on while coverage is already total is the only moment it
  costs nothing; deferring it means turning it on later against whatever debt
  has accumulated in between.
- **2026-09-11: the npm manifest probes in `Makefile` diverge from the kit.**
  The kit writes every guarded target as
  `@test -f <manifest> && <cmd> || echo "skipping"`. On a repository that has
  the manifest, a failing `<cmd>` falls into the `||` branch and the target
  exits 0 having printed "skipping", so a broken build reads as a pass. The
  cargo lines keep the kit's form because this repository has no `Cargo.toml`
  and they are unreachable; the `package.json` lines are rewritten as `if`
  statements. Leaving the kit form for a manifest that exists was rejected:
  `make build` is in the gate this spec tells every session to trust.
- **2026-09-11: `check --fail-on-unresolved` stays out of the per-commit
  floor.** This corpus ratifies before it builds, so a spec legitimately
  carries unresolved units while work is under way. `make gate` passes the
  flag, which is right for a branch whose specs are all complete;
  `AGENTS.md` says so explicitly rather than leaving a session to discover
  the difference by hitting it.

## Verification

```verify:cli
spec-spine lint --fail-on-warn
spec-spine check
spec-spine index coverage --fail-on-untraced
test -f AGENTS.md
test -f Makefile
test -f .mcp.json
test -f .gitattributes
test -f .claude/settings.json
test -x .githooks/enable-merge-driver.sh
test -x .githooks/merge-derived-index.sh
test ! -d .claude/skills/init
sh -c 'test "$(ls -1 .claude/skills/*/SKILL.md | wc -l | tr -d " ")" = 10'
sh -c 'test "$(ls -1 .claude/rules/*.md | wc -l | tr -d " ")" = 4'
sh -c 'test "$(ls -1 .claude/agents/*.md | wc -l | tr -d " ")" = 4'
sh -c '! grep -rl "$(printf "\342\200\224")" AGENTS.md CLAUDE.md Makefile .claude .githooks specs/005-governed-agentic-loop'
```
