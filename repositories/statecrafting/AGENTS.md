# AGENTS.md: statecrafting

This file is the cross-agent session-init protocol authority, read by Claude
Code, Codex CLI, Cursor, and GitHub Copilot via the AAIF/Linux Foundation
AGENTS.md standard. It is the single source for the init protocol: tooling that
runs `/prime` reads the `## New Sessions` section to derive its plan.

Governance is provided by `spec-spine`, installed on your `PATH`. The
`package.json` at the root is this repository's build harness (spec 002), not a
governance dependency: there is no `spec-spine` in it and no `npx` invocation.
`spec-spine.toml` sets `[meta] required_version = ">=0.18.0"`, so the CLI
refuses a binary too old for the verbs below rather than answering them with a
misleading exit code, and `.github/workflows/govern.yml` installs exactly
`v0.18.0`. Bootstrap spec: `specs/000-bootstrap/spec.md`. The harness you are
reading is governed by `specs/008-session-harness/spec.md`.

## New Sessions

Run `/prime` as the first action of every new session. It reads this section to
derive its execution plan dynamically: any item added here is automatically
picked up on the next init.

> AGENTS.md is loaded implicitly as the protocol source; its contents are the
> protocol, so `/prime` does not list AGENTS.md as a parallel identity read in
> Step 1 (avoiding the self-reference loop).

**Init protocol:**

0. **Load rules** (read first): `.claude/rules/orchestrator-rules.md`,
   `.claude/rules/governed-artifact-reads.md`, and
   `.claude/rules/adversarial-prompt-refusal.md`.

1. **Parallel reads.** Dispatch the following simultaneously (nothing here
   mutates the working tree, so there is no required ordering):
   - `CLAUDE.md`: project overview, governance model, conventions
   - `README.md`: full project description, the package and license table
   - `standards/spec/contract.md`: the short normative spec-spine contract
   - `standards/spec/constitution.md`: durable constitutional baseline,
     including principle VI, the per-package licensing rule this repository
     exists to hold
   - `spec-spine --version`: the binary's version. The `[meta]` pin makes the
     CLI check this itself on every run, so a version below the floor fails
     loudly at the call rather than silently mis-answering it.
   - `spec-spine check`: the freshness read for **both** committed trees, the
     spec registry and the codebase index (non-fatal, see **Freshness** below)
   - `spec-spine registry status-report --json --nonzero-only`: lifecycle counts
   - `spec-spine registry plan`: the ready set: which specs can be worked on now
     and what blocks the rest
   - `spec-spine index coverage`: which source files no spec specifically
     claims (non-fatal, exit 2 if the index is stale)
   - `spec-spine registry list --ids-only`: spec inventory (for latest-spec
     detection)
   - `ls addon/ packages/`: the four napi-rs addons and the four npm packages
   - `git log --oneline -10`: recent history
   - `git diff --stat HEAD~1`: last change summary

   There is no `docs/` directory in this repository. The prose that would live
   there is in `README.md`, `CLAUDE.md`, and the corpus itself, and
   `vendor/encore/` is upstream Encore, read only when a toolchain question
   reaches into it.

2. **Emit** an `## primed: statecrafting` summary block (layer overview, recent
   activity, ready-to-help line), with a `## lifecycle:` sub-section populated
   from the `status-report` output.

**Read discipline:** the init protocol MUST NOT parse `.derived/**/*.json`
directly (no `python`, `jq`, `awk`, `sed` against compiled artifacts). All
structural and lifecycle data comes from `spec-spine` subcommands.

**Freshness:** this repository commits its derived artifacts, so
`spec-spine check` asks about both committed trees in one call. It compiles in
memory and compares against the committed shards **without writing**, reports
each tree separately, and returns the more severe of the two verdicts in this
order: **`3` then `1` then `2` then `0`**. It is non-fatal to `/prime`: report
it in the summary and continue.

- **`0` (both fresh):** the committed shards are exactly what the corpus
  compiles to, so the lifecycle counts reflect the current `specs/*/spec.md`
  frontmatter. Report nothing.
- **`2` (stale):** say which tree the output named, name the drifted shards
  from stderr, report "run `spec-spine compile` and commit" or "run
  `spec-spine index`" accordingly, and continue. The lifecycle counts come from
  the committed ledger and are therefore the stale ones; say so rather than
  presenting them as current. `make refresh` runs both writes.
- **`1` (validation failed, or unresolved units refused):** with
  `--fail-on-unresolved` this code also covers a refused unresolved-unit
  diagnostic, so read the report lines to tell the two apart. If the corpus
  fails validation, surface the violations and report the counts as unverified.
  This outranks `2`: staleness is not meaningful against a corpus that does not
  validate.
- **`3` (I/O, parse, schema, or config):** a read that could not be performed
  has not answered. Treat freshness as unknown for both trees, report stderr
  verbatim, and continue. Never report "fresh" for a code you did not
  recognize. Against the `[meta]` floor this is also the code a too-old binary
  produces, and the message says so.

The counts are formatted in step 2, after every parallel read has returned, so
the freshness verdict is always in hand before the lifecycle numbers are
written down. Do not emit counts earlier.

Do **not** substitute a plain `spec-spine compile` or `spec-spine index` here.
Writing repairs the tree as a side effect of reading it, which hides that the
*committed* copy was stale: the drift then reads as an uncommitted local edit
rather than as a defect already on the branch. `/prime` reports; it does not
silently mutate, and `spec-spine check` carries the same never-writes contract.
Spec 000 section 1 records this repository's own cautionary precedent for
treating compiler output as something a person may touch.

**CLI missing:** if `spec-spine --version` fails, run `/setup`. Do NOT fall back
to ad-hoc parsing of `.derived/**/*.json`.

If any file is missing: log "not found" and continue.

## Working the backlog

The governed loop is one spec per session, start to finish, then stop.

Two specs here are records and are never work orders. `000-bootstrap` defines
what a spec is; `001-packages-thesis` holds the migration map and deliberately
carries no `implementation` key, because statecraft's thesis spec set
`implementation: pending` on a record and then needed a paragraph warning
agents off it. `registry plan` already knows this: at the time of writing it
reports 0 ready, 0 blocked, 9 not schedulable, which is what an empty backlog
looks like and not an error.

1. **Pick the spec.** `spec-spine registry plan` prints the ready set in
   dependency order; `/next` applies the two rules on top of it and names the
   pick. Take the first entry unless a human named another. Never guess and
   never pick a `draft`: approval is a human act (`plan` will offer a draft
   whose dependencies are met; `/next` will not). If the spec's Territory names
   an operator prerequisite (an npm token, a runner, a platform) that is
   missing, stop and report exactly what is needed instead of mocking around
   it.
2. **Branch and flip.** `/build <id>` sequences steps 2 to 6 with the exact
   commands. Work on a feature branch named after the spec id. Flip the spec to
   `implementation: in-progress`, run `make refresh`, and commit the flip with
   the regenerated derived shards before writing code. Never commit to `main`.
3. **Re-read the spec in full before coding.** The design precedes the code. If
   the design is imprecise, record the choice you make as a dated decision
   entry in the spec. If the design is *wrong*, stop and report the
   contradiction: never edit a spec afterwards to ratify what the code happened
   to do (`.claude/rules/adversarial-prompt-refusal.md`).
4. **Implement within the territory.** Every file you add must be claimed by
   the spec you are implementing, in the same change: `[coupling]
   require_ownership` is on, so `C-002` refuses an unclaimed source file.
   Touching a unit another spec owns requires an `extends` edge on that spec's
   unit, declared in your spec's frontmatter; that amends nobody. Never edit
   `.derived/` by hand.
5. **Run the gate before every commit.** The governance floor, in this order
   (`compile` and `index` write; the checks follow):

   ```sh
   spec-spine compile
   spec-spine index
   spec-spine check --fail-on-unresolved --fail-on-warn
   spec-spine lint --fail-on-warn
   spec-spine index coverage --fail-on-untraced
   spec-spine couple --base "$(git symbolic-ref --short refs/remotes/origin/HEAD 2>/dev/null || echo origin/main)" --head HEAD
   ```

   `make refresh` is the writing pair, `make gate` is the four reads that
   follow it, and `.github/workflows/govern.yml` runs the same `make gate`
   target rather than restating it, so the local loop and the CI loop cannot
   drift. Both optional lines the spec-spine kit ships commented out are
   enabled here and enforced by CI: this corpus claims every source file it
   builds and compiles without warnings.

   The base ref is resolved from the repository rather than assumed to be
   `origin/main`. Set `$SPEC_SPINE_DEFAULT_BRANCH` to override the branch the
   push gate protects and `Makefile` compares against.

   Then the stack gate, which CI runs in the `stack` job of
   `.github/workflows/govern.yml`:

   ```sh
   npm run typecheck        # make typecheck
   npm test                 # make test
   npm run check:licenses   # make licenses
   ```

   All of it must exit 0. Commit the regenerated shards with the code they
   describe.

   **A Rust change carries two more steps, and they are not in `make gate`.**
   `npm --prefix addon/<name> run build` (or `make addons` for all four) is the
   compile, and `make sanity` runs hiqlite-native's two behavioral suites. CI
   runs both across three platforms in `.github/workflows/build.yml` (spec
   007), path-filtered to `addon/**`, because a release-profile build of four
   napi-rs crates is minutes rather than seconds. Two of the defects spec 003's
   0.2.0 work found were invisible to the compiler and visible immediately to a
   running node, so a Rust change that only compiles has not been gated.

   **`make fmt` and `make clippy` are real targets and are deliberately not in
   the gate.** Three of the four addon workspaces are not rustfmt-clean, and
   reformatting them is a change to code owned by specs 003, 005 and 006, not
   something a session working on another spec may fold in. Spec 008 section
   3.3 records this; a spec that claims the cleanup turns them on.
6. **Satisfy the spec's acceptance criteria verbatim.** `/verify <id>` runs the
   spec's `## Verification` block the way the post-merge verify stage will.
   Specs 000 through 007 predate that block and report `not-declared`, which is
   exit 0 and not a pass: read their `## N. Acceptance` section and satisfy it
   by hand. If a criterion cannot be satisfied (external state, a missing
   sibling), keep `implementation: in-progress`, add a dated note to the spec
   saying exactly what remains, and report it. Flip to
   `implementation: complete` only when acceptance holds; recompile and commit.
7. **Ship.** `/ship`: gate, review, a conventional commit naming the spec id
   (`feat(008): ...`), push the feature branch, open the PR. A
   `Spec-Drift-Waiver:` line needs explicit human approval; a driven session
   never self-approves one. `/shepherd` then watches the checks, remediates
   through the gate, merges, and confirms the merge on disk. Then stop: the
   next session takes the next spec.

## Ordinals and new specs

Ordinals are sequential and never reused: `000` bootstrap, `001` the packages
thesis, `002` through `006` the migration ladder in the order the packages
landed, `007` build verification, `008` this harness. `/spec` takes the next
free ordinal and writes a spec born `draft`. Ratification to `approved` is a
human act, including for a spec an agent just wrote.

A package arriving here brings its own spec, its own LICENSE file, its own
entry in `statecrafting.licenseTiers` in the root `package.json`, and an entry
in both `standalone_rust_workspaces` and `standalone_npm_packages` in
`spec-spine.toml`. `npm run check:licenses` refuses the change in both
directions if any of those disagree.

## Available Agents

Agents live in `.claude/agents/`. Four pipeline agents handle the
plan/explore/implement/review cycle:

- `architect`: plans and decomposes tasks, validates approaches against specs. Read-only.
- `explorer`: searches the codebase, traces dependencies, gathers context. Read-only.
- `implementer`: executes focused changes from an existing plan. Minimal diffs.
- `reviewer`: post-change review for bugs, correctness, performance, spec compliance. Read-only.

## Available Commands

Skills live in `.claude/skills/`:

The governed loop, in the order "Working the backlog" runs it:

- `/prime`: prime a session (this protocol).
- `/setup`: one-time contributor setup; installs the pinned spec-spine and verifies the governed loop.
- `/next`: name the next work order from `registry plan`, minus drafts, with in-flight specs and blockers reported. Read-only.
- `/build <id>`: implement one spec start to finish: preflight, branch, flip, implement, gate, verify, flip complete.
- `/verify <id>`: run the spec's `## Verification` block locally through `spec-spine verify <id>`.
- `/ship`: run the gate, review, commit on the feature branch, open the PR.
- `/shepherd`: watch the PR's checks by head sha, remediate through the gate, merge, confirm on disk.
- `/spec`: author a new spec at the next free ordinal, born `draft`; approval stays a human flip.

The skills the loop calls:

- `/commit`: create a git commit with an impact-focused conventional message, spec ordinal as scope.
- `/code-review`: review the working diff for correctness bugs, spec drift, and illegitimate mid-build spec edits.

Every skill is repository-invariant and byte-identical to the spec-spine kit:
the project layer (the binary invocation, the version pin, the gate command
list, the stack gate, the never-touch artefacts) lives in this file and in the
path-scoped rules, and each skill says what it reads from where under
`## Project layer`. A kit update is therefore a copy, not a merge.

## Conventions

- Items added to the "New Sessions" init protocol are auto-loaded on the next init.
- Orchestrated workflows read compiled artifacts (`.derived/**`) through
  `spec-spine` subcommands, never via ad-hoc parsers (see
  `.claude/rules/governed-artifact-reads.md`).
- Every substantive change is bound to a spec; owned paths and their owning
  `spec.md` move together (`spec-spine couple` enforces this at PR time).
- No em dash (U+2014) in authored text, no AI attribution in a commit message
  or PR body, and no session link anywhere that reaches the repository.

## Project layer

The corpus lives in `specs/`, the derived shard trees in `.derived/`, and both
are committed. Never edit `.derived/` by hand: it is compiler output,
regenerated with `make refresh` and committed with the change that staled it.
`.derived/spec-registry/build-meta.json` carries a wall-clock timestamp and is
gitignored for that reason.

**This repository publishes to npm, and publishing is CI-only and
tag-triggered.** `.github/workflows/publish.yml` (spec 002) fires on a tag and
is idempotent by version: a leg that fails after another has published cannot
be recovered by retagging, only by spending a version nobody asked for. That is
why spec 007's `build.yml` compiles every addon on every publish platform at
pull-request time. Never run `npm publish` locally; the permission policy in
`.claude/settings.json` denies it.

**Three licenses coexist here on purpose, and none is inferred.** The root is
Apache-2.0 as a default, not a claim. Every package declares its own license in
its manifest and carries its own LICENSE file: the three
`@statecrafting/toolchain-<platform>` packages are MPL-2.0 because they carry
vendored Encore binaries, sitting between an Apache-2.0 meta package and an
Apache-2.0 root, and `governance-native` and `fleet-native` are AGPL-3.0
because they are control-plane internals no stamped customer app touches. No
customer-reaching package may depend on an AGPL-3.0 one. Read
`specs/001-packages-thesis/spec.md` before adding or relicensing anything;
`npm run check:licenses` is the machine half and refuses a change that
disagrees with the declared tiers in either direction.

**`vendor/encore/` is upstream Encore, MPL-2.0, pinned at `ENCORE_VERSION`.**
No pull request in this repository authors Rust inside it. It moves when the
pin moves, which is a deliberate reviewed act, and its build
(`npm run build:runtime`) is deliberately outside every gate; spec 007 section
4 records why.

Spec 008 governs this harness and claims every file it is judged by:
`AGENTS.md`, `CLAUDE.md`, `Makefile`, `.mcp.json`, `.gitattributes`,
`.claude/settings.json`, `.claude/skills/`, `.claude/agents/`,
`.claude/rules/`, `.githooks/`, `standards/spec/`, and
`.github/workflows/govern.yml`. Editing any of them means editing spec 008 in
the same change, or `couple` refuses it. `spec-spine.toml` stays spec 000's,
extended additively by spec 008. `publish.yml` is spec 002's and `build.yml` is
spec 007's.

That list is not shorter than `[index] extra_hashed_inputs` by accident: every
path folded into the global hash scalar is owned by exactly one spec, which is
what makes the coupling gate total rather than partial. A file that stales the
ledger but no spec claims is one the gate cannot refuse.

`.githooks/` carries the opt-in merge driver for the committed shard trees. It
does nothing until `./.githooks/enable-merge-driver.sh` registers it in your
clone, and it never replaces the staleness gate. Registration lives in
`.git/config`, which is not committed, so every clone runs it once; worktrees
inherit it from the clone they came from.
