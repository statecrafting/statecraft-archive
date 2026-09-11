---
id: "013-agent-harness"
title: "The agent harness: the spec-spine kit as statecraft's governed loop"
status: draft
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
  - { kind: directory, path: ".claude/" }
  - { kind: directory, path: ".githooks/" }
extends:
  - unit: "spec-spine.toml"
    spec: "000-bootstrap"
  - unit: ".github/workflows/spec-spine.yml"
    spec: "000-bootstrap"
  - unit: "specs/001-statecraft-thesis/spec.md"
    spec: "001-statecraft-thesis"
summary: >
  The harness is what an agent may do in this repository, so it is claimed
  by a spec and held by the coupling gate rather than living as untracked
  convention. statecraft adopts the spec-spine kit whole (ten skills, four
  pipeline agents, four rules, the read-only session hooks, the composite
  Makefile gate) at the 0.18.0 floor, and moves the project layer that the
  skills read into AGENTS.md so the skills stay byte-identical to the kit
  and a kit update is a copy rather than a merge. Three defects the adoption
  exposed are fixed here: the harness globs matched directories and hashed
  nothing, the session hooks repaired the tree they were reading, and the
  CI gate ran a writing `compile` against the branch it was judging.
---

# 013: The agent harness

Link a compilation unit to this spec via `[package.metadata.spec-spine].spec`
in its manifest, a `// Spec:` header, or the edges above.

## 1. Purpose

Every spec from 000 to 012 governs what statecraft *is*. This one governs
how it gets built: the session protocol an agent runs at the start of a
session, the skills that carry it from "pick a spec" to "confirm the merge
on disk", the rules it may not violate, and the gate it must pass before a
commit. That surface has been present since 000 and owned by nobody, which
is the one place in a governed repository where "specs are the source of
truth" was not true of itself.

The content is not statecraft's invention. It is the spec-spine kit, the
loop that library ships for its adopters, taken at the newest published
floor. What is statecraft's is the **project layer**: the binary
invocation, the version pin, the gate command list, the stack gate, the
never-touch artefacts. The kit's design puts that layer in `AGENTS.md` and
keeps every `SKILL.md` repository-invariant, so this spec's job is to place
the project layer correctly and then leave the skills alone.

## 2. Territory

This spec owns the harness:

| Unit | What it carries |
|---|---|
| `AGENTS.md` | The cross-agent init protocol and the project layer every skill reads |
| `CLAUDE.md` | The project overview, conventions, and build commands |
| `.claude/skills/` | The kit's ten skills, byte-identical to the kit |
| `.claude/agents/` | The four kit pipeline agents plus `encore-expert`, statecraft's own |
| `.claude/rules/` | The three unconditional rules plus one path-scoped rule |
| `.claude/settings.json` | The session hooks and the permission policy |
| `.mcp.json` | The MCP server declaration (empty; servers are configured per user) |
| `Makefile` | The composite gate: `gate`, `refresh`, `verify`, `stack` |
| `.githooks/` | The opt-in merge driver for the committed shard trees |
| `.gitattributes` | Registers that driver on the shard globs |

Two units stay with spec 000 and are reached by an `extends` edge, because
they are the bootstrap spec's territory and this spec only changes their
contents:

- `spec-spine.toml`: the version pin, the hashed-input globs, the resolver
  exclusion, the lint exceptions, and the ownership ratchet (section 5).
- `.github/workflows/spec-spine.yml`: the CI gate, rewritten to run the
  same read-only chain as `make gate` (section 4.3).

Out of this spec's territory and unchanged: `.github/workflows/verify.yml`
(spec 002's stack gate), and the `image.yml`, `ai-pr-review.yml` and
`ai-changelog.yml` workflows (spec 009).

## 3. Behavior

### 3.1 The session protocol

`AGENTS.md` is the single source for the init protocol. `/prime` derives its
execution plan from the `## New Sessions` section, so an item added there is
picked up on the next init without editing a skill. The protocol reads, and
never writes: `spec-spine check` compares both committed shard trees against
what the corpus compiles to in memory. The predecessor protocol ran
`spec-spine compile` at session start, which repaired a stale committed tree
as a side effect of reading it and so hid the defect it should have
reported.

### 3.2 The ten skills

`.claude/skills/` carries the loop in the order `AGENTS.md` "Working the
backlog" runs it: `/prime`, `/setup`, `/next`, `/build`, `/verify`, `/ship`,
`/shepherd`, `/spec`, plus the two the loop calls, `/commit` and
`/code-review`. Each ends with a `## Project layer` section naming what it
reads from `AGENTS.md`, `spec-spine.toml` and the rules. **No `SKILL.md` is
edited for this repository.** The previous harness carried five skills, one
of which (`/init`) was the pre-kit name for `/prime`; it is removed rather
than kept as an alias, because two names for the session protocol is how the
protocol drifts.

### 3.3 The hooks read and never write

`.claude/settings.json` declares four hooks, and the contract they share is
that a hook reports rather than repairs:

| Hook | Does |
|---|---|
| `SessionStart` | Reports registry and index freshness from `spec-spine check` |
| `PostToolUse` | Recompiles the registry after a `spec.md` edit (the one sanctioned write, because a live session can commit the result), and reports index staleness after any hashed-input edit |
| `PreToolUse` | Refuses a push that would update the default branch, and refuses `gh pr create` on a stale tree, uncommitted shards, or a red coupling gate without an inline `Spec-Drift-Waiver:` |
| `Stop` | Reports staleness at session end without regenerating |

Each resolves the binary and the default branch for **the repository the
command targets**, not the session's project, which is what makes them
correct in a multi-checkout session. The `Stop` hook previously ran
`spec-spine index` and left `.derived/` dirty for whoever came next; it now
reports and stops.

### 3.4 The rules

Three rules are unconditional because they are about how to work at all:
`orchestrator-rules.md`, `governed-artifact-reads.md`,
`adversarial-prompt-refusal.md`. One,
`derived-artifacts-are-compiler-output.md`, carries `paths:` frontmatter
scoped to `.derived/**` and loads only when a session has a shard open. The
scoped rule does not replace the unconditional one and cannot: the mistake
`governed-artifact-reads.md` prevents is reaching for `jq` **instead of** a
subcommand, and an agent about to make that mistake may never open a file
under `.derived/`.

### 3.5 The composite gate

`make gate` is the whole governed loop, read-only, in the order the chain
requires; `make refresh` is the writing half for a session that has edited a
spec and can commit the regenerated shards. `make stack` is statecraft's
own: the npm half that mirrors `.github/workflows/verify.yml`. The `gate`
target is byte-identical to the kit's, so a kit update stays a copy.

## 4. What the adoption fixed

### 4.1 The harness was nominally hashed and actually was not

`[index] extra_hashed_inputs` listed `.claude/agents/**`, `.claude/rules/**`,
`.claude/skills/**`, `standards/**` and `.github/workflows/**`. That glob
form matches **directories**, so it contributed no bytes to any content hash:
every one of those files could change without staling a single shard, and the
lint said so five times (`L-010`). The form that folds the files under a
directory into the global-inputs hash is `dir/**/*`. Corrected here, with
`AGENTS.md`, `CLAUDE.md`, `Makefile`, `.githooks/**/*` and `scripts/**/*`
added, so the whole harness is witnessed.

### 4.2 The committed registry was compiled by an older binary

Every committed registry shard carried `specVersion 1.1.0`; the 0.18.0
compiler emits `1.2.0`. The drift was invisible because the session hook and
CI both ran a writing `compile`, which rewrote the shards instead of
reporting them. The shard trees are regenerated at the pinned floor in this
change, and `[meta] required_version = ">=0.18.0"` now refuses a binary below
it: the coupling gate's built-in bypass list is compiled into the binary, so
two versions can judge the same diff differently.

### 4.3 CI repaired the tree it was judging

`.github/workflows/spec-spine.yml` ran `spec-spine compile` (writing) at
v0.10.0, then checked the index it had just rewritten. It now installs the
pinned floor and runs the same read-only chain as `make gate`. The workflow
name and the job id are deliberately unchanged: they are the required status
check on the protected branch.

### 4.4 A record spec blocked the planner

`001-statecraft-thesis` carried `implementation: pending`. The thesis is a
record: no code landing makes it complete, and `AGENTS.md` has said so in
prose since the corpus began. The scheduler could not read prose, so
`registry plan` offered the thesis as ready work and reported specs 010 and
011 as blocked on a dependency that would never resolve. It moves to `n-a`,
which is the value the lifecycle table reserves for exactly this, and the
ready set becomes truthful: 010 ready, 009 blocked on 010, 011 blocked on
009. `/next` reads that value, which is why the kit's `/next` skill needs no
per-project list of which specs are records.

## 5. Configuration changes in spec 000's file

Recorded here, and cross-referenced by an amendment note in
`specs/000-bootstrap/spec.md`, following the precedent spec 012 set for the
same file.

### 5.1 The ownership ratchet is on

`[index] resolver_exclusions` gains `encore.gen`. It is Encore's generated
client surface: gitignored, rewritten by every `npm run build:app`, and
therefore claimable by no spec. Its 54 files were the entire reason
`spec-spine index coverage` reported 76.6 percent and
`--fail-on-untraced` was red. With it excluded, coverage is 177 of 177
source files specifically claimed, so `[coupling] require_ownership = true`
is turned on in the same change: the ratchet is only honest on a corpus that
has retired its coverage debt.

### 5.2 The lint exceptions are explicit

`[lint] unwitnessed_allowed` names the eleven claimed paths that are
deliberately in no content hash, so `lint --fail-on-warn` can join the gate
without suppressing anything silently. `spec-spine check` still reports the
count. The entries, and why each is there:

- `README.md`, `package-lock.json`: already in the coupling bypass floor;
  hashing them would restamp every shard on a lockfile bump.
- `tsconfig.json`, `vitest.config.ts`, `vitest.setup.ts`, `.env.example`,
  `.dockerignore`: build and example configuration claimed by specs 002,
  003 and 009 as territory markers, not as governance surface.
- `docker/compose.postgres.yml`,
  `infra/gitops/clusters/statecraft-hetzner/statecraft-kustomization.yaml`,
  `backend/auth/github-identity.ts`: single files inside trees whose
  governance already rides on their owning spec's shard.
- `app-model.json`: generated by `npm run extract:model` on every build,
  so folding it into the global scalar would restamp all fourteen shards
  on a routine build. Its freshness is already gated, by
  `npm run check:model` in `.github/workflows/verify.yml`.

Four more claimed paths moved the other way, into `extra_hashed_inputs`,
because they are hand-authored governance surface that changes rarely:
`encore.app`, `infra.config.json`, `infra.config.dev.json`, and
`.gitattributes`, whose content binds the merge driver to the shard globs.

## 6. Acceptance

1. `spec-spine --version` reports 0.18.0 or later, and `spec-spine config
   show` reports `required_version = ">=0.18.0"`, `require_ownership = true`
   and `encore.gen` among the resolver exclusions.
2. `make gate` exits 0: `check --fail-on-unresolved --fail-on-warn`,
   `lint --fail-on-warn`, `index coverage --fail-on-untraced` and `couple`
   all clean.
3. `spec-spine index coverage` reports 0 unclaimed and 0 floor-only files.
4. `.claude/skills/` holds exactly ten directories, and each `SKILL.md` is
   byte-identical to the kit's copy of it.
5. `.claude/rules/` holds four rules, exactly one of which carries `paths:`
   frontmatter.
6. `spec-spine index owner` names this spec for `AGENTS.md`, `CLAUDE.md`,
   `Makefile` and `.claude/settings.json`.
7. No `extra_hashed_inputs` entry ends in a bare `**`.
8. The stack gate is unaffected: `make stack` behaves exactly as
   `.github/workflows/verify.yml` did before this change.

## Verification

Each line is one command (spec 049 3.2). Acceptance item 8 is verify.yml's
own job and is deliberately not re-run here: this spec changes no npm input.
The workflow check strips comment lines before looking for a writing verb,
because the workflow's own comment explains the writing form it replaced.

```verify:cli
spec-spine check --fail-on-unresolved --fail-on-warn
spec-spine lint --fail-on-warn
spec-spine index coverage --fail-on-untraced
spec-spine config show | grep -qF 'required_version = ">=0.18.0"'
spec-spine config show | grep -qF 'require_ownership = true'
spec-spine config show | grep -qF 'encore.gen'
test "$(ls .claude/skills | wc -l | tr -d ' ')" = 10
test "$(ls .claude/rules | wc -l | tr -d ' ')" = 4
test "$(grep -l '^paths:' .claude/rules/*.md | wc -l | tr -d ' ')" = 1
test ! -e .claude/skills/init
spec-spine index owner AGENTS.md | grep -q 013-agent-harness
spec-spine index owner CLAUDE.md | grep -q 013-agent-harness
spec-spine index owner Makefile | grep -q 013-agent-harness
spec-spine index owner .claude/settings.json | grep -q 013-agent-harness
! grep -qE '"[^"]*\*\*",' spec-spine.toml
! grep -vE '^[[:space:]]*#' .github/workflows/spec-spine.yml | grep -q 'spec-spine compile'
grep -q 'SPEC_SPINE_VERSION=v0.18.0' .github/workflows/spec-spine.yml
```

## 7. Out of scope

- **The spec corpus's own lint debt beyond section 5.2.** The four claimed
  paths that moved into `extra_hashed_inputs` and the ten that are excepted
  are the whole of it; no other spec's claims are touched.
- **`[domains]` and `[kind]` taxonomies.** Both stay empty and free-text.
- **A domain-specialist agent beyond `encore-expert`.** The kit's pattern
  allows more; statecraft needs one.
- **The merge driver as a default.** `.githooks/` ships, and it stays
  opt-in per clone: nothing happens until
  `./.githooks/enable-merge-driver.sh` registers it. Sharding already
  removes the common conflict.
- **Flipping this spec to `approved`.** It is born `draft`, and approval is
  a human act.
