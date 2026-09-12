# AGENTS.md: statecraft.ing

This file is the cross-agent session-init protocol authority, read by Claude
Code, Codex CLI, Cursor, and GitHub Copilot via the AAIF/Linux Foundation
AGENTS.md standard. It is the single source for the init protocol: tooling that
runs `/prime` reads the `## New Sessions` section to derive its plan.

Governance is provided by `spec-spine`, installed on your `PATH`. **0.18.0 or
later is required**: the hooks in `.claude/settings.json` and the gate below
both run `spec-spine check`, and `spec-spine.toml` declares the floor in
`[meta] required_version`, so an older binary exits 3 with a config error
rather than a misleading verdict. Install with `cargo install spec-spine-cli`,
`npm i -g spec-spine`, or `pip install spec-spine`; `/setup` does it for you.
Bootstrap spec: `specs/000-bootstrap/spec.md`. Harness spec:
`specs/005-governed-agentic-loop/spec.md`.

This repository commits its derived shards, so the freshness read is
`spec-spine check` and never a bare `compile` or `index`.

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
   `.claude/rules/derived-artifacts-are-compiler-output.md` is path-scoped to
   `.derived/**` and loads itself when a session touches a shard.

1. **Parallel reads.** Dispatch the following simultaneously (nothing here
   mutates the working tree, so there is no required ordering):
   - `CLAUDE.md`: project overview, governance model, conventions
   - `README.md`: full project description
   - `standards/spec/contract.md`: the short normative spec-spine contract
   - `standards/spec/constitution.md`: durable constitutional baseline
   - `spec-spine --version`: the binary's version. **Read this before believing
     any exit code below**; the CLI-version note further down is the reasoning,
     and this is the step that performs it.
   - `spec-spine check`: the freshness read for **both** committed trees, the
     spec registry and the codebase index (non-fatal, see **Freshness** below)
   - `spec-spine registry status-report --json --nonzero-only`: lifecycle counts
   - `spec-spine registry plan`: the ready set, which specs can be worked on now
     and what blocks the rest
   - `spec-spine index coverage`: which source files no spec specifically claims
     (non-fatal, exit 2 if the index is stale)
   - `spec-spine registry list --ids-only`: spec inventory (for latest-spec
     detection)
   - `ls app/ app/routes/ app/lib/ app/components/`: the site surface
   - `ls public/ scripts/`: static assets and the build-time bake script
   - `git log --oneline -10`: recent history
   - `git diff --stat HEAD~1`: last change summary

2. **Emit** an `## primed: statecraft.ing` summary block (layer overview,
   recent activity, ready-to-help line), with a `## lifecycle:` sub-section
   populated from the `status-report` output. **Consult the `--version` read
   before reporting any freshness verdict**: a binary predating a flag a step
   passed makes that step's exit code meaningless.

**Read discipline:** the init protocol MUST NOT parse `.derived/**/*.json`
directly (no `python`, `jq`, `awk`, `sed` against compiled artifacts). All
structural and lifecycle data comes from `spec-spine` subcommands.

**Freshness:** `spec-spine check` asks about both committed trees in one call.
It compiles in memory and compares against the committed shards **without
writing**, reports each tree separately, and returns the more severe of the two
verdicts in this order: **`3` then `1` then `2` then `0`**. It is non-fatal to
`/prime`: report it in the summary and continue.

- **`0` (both fresh):** the committed shards are exactly what the corpus
  compiles to, so the lifecycle counts reflect the current `specs/*/spec.md`
  frontmatter. Report nothing.
- **`2` (stale):** *first check the `--version` read from step 1, see the
  CLI-version note below.* If it is a genuine staleness report, say which tree
  the output named, name the drifted shards from stderr, report "run
  `spec-spine compile` and commit" or "run `spec-spine index`" accordingly, and
  continue. The lifecycle counts come from the committed ledger and are
  therefore the stale ones; say so rather than presenting them as current.
- **`1` (validation failed, or unresolved units refused):** with
  `--fail-on-unresolved` this code also covers a refused unresolved-unit
  diagnostic, so read the report lines to tell the two apart. If the corpus
  fails validation, surface the violations and report the counts as unverified.
  This outranks `2`: staleness is not meaningful against a corpus that does not
  validate.
- **`3` (I/O, parse, schema, or config):** a read that could not be performed
  has not answered. Treat freshness as unknown for both trees, report stderr
  verbatim, and continue. Never report "fresh" for a code you did not
  recognize.

The counts are formatted in step 2, after every parallel read has returned, so
the freshness verdict is always in hand before the lifecycle numbers are
written down. Do not emit counts earlier.

> **CLI version. Ask `spec-spine --version` before believing any exit code.**
> Every binary ever released answers it, and it exits 0. If the version
> predates the verb you are about to call, upgrade; do not interpret the exit
> code of a verb the binary does not have. Reporting a version problem as spec
> drift would send someone chasing a phantom, and a session told its shards are
> stale when they are not will regenerate and commit artifacts that were
> already correct. This repository sets `[meta] required_version` in
> `spec-spine.toml`, so the CLI checks the floor on every run and this manual
> step is a backstop rather than the primary guard.

Do **not** substitute a plain `spec-spine compile` or `spec-spine index` here.
Writing repairs the tree as a side effect of reading it, which hides that the
*committed* copy was stale: the drift then reads as an uncommitted local edit
rather than as a defect already on the branch. `/prime` reports; it does not
silently mutate, and `spec-spine check` carries the same never-writes contract.

**CLI missing:** if `spec-spine --version` fails, run `/setup`. Do NOT fall back
to ad-hoc parsing of `.derived/**/*.json`.

If any file is missing: log "not found" and continue.

## Working the backlog

The governed loop is one spec per session, start to finish, then stop. Record
specs (the bootstrap spec `000`, the harness spec `005` at `complete`) are never
work orders.

1. **Pick the spec.** `spec-spine registry plan` prints the ready set in
   dependency order; `/next` applies the two rules on top of it and names the
   pick. Take the first entry unless a human named another. Never guess and
   never pick a `draft`: approval is a human act (`plan` will offer a draft
   whose dependencies are met; `/next` will not). If the spec's Territory names
   an operator prerequisite (a credential, a DNS record, a sibling repo) that is
   missing, stop and report exactly what is needed instead of mocking around it.
2. **Branch and flip.** `/build <id>` sequences steps 2 to 6 with the exact
   commands. Work on a feature branch named after the spec id. Flip the spec to
   `implementation: in-progress`, run `spec-spine compile` and
   `spec-spine index`, and commit the flip with the regenerated derived shards
   before writing code. **Never commit to `main`**: `main` auto-deploys to the
   live apex, so every change lands through a pull request.
3. **Re-read the spec in full before coding.** The design precedes the code.
   If the design is imprecise, record the choice you make as a dated decision
   entry in the spec. If the design is *wrong*, stop and report the
   contradiction: never edit a spec afterwards to ratify what the code
   happened to do (`.claude/rules/adversarial-prompt-refusal.md`).
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
   spec-spine lint --fail-on-warn
   spec-spine check
   spec-spine index coverage --fail-on-untraced
   spec-spine couple --base "$(git symbolic-ref --short refs/remotes/origin/HEAD 2>/dev/null || echo origin/main)" --head HEAD
   ```

   then the stack gate:

   ```sh
   npm ci                      # only when package-lock.json changed
   make typecheck build        # npm run typecheck, then npm run build
   ```

   All must exit 0. `make gate` runs the read-only governance half in one
   command, `make typecheck build` the stack half, and `make refresh` is the
   writing half; CI runs the same targets, so the three cannot drift.

   The base ref is resolved from the repository rather than assumed to be
   `origin/main`. Set `$SPEC_SPINE_DEFAULT_BRANCH` to override the branch the
   push gate protects and `Makefile` compares against.

   Commit the regenerated shards with the code they describe.

   `spec-spine check --fail-on-unresolved` is **not** in the floor: this corpus
   ratifies before it builds, so a spec legitimately carries unresolved units
   while work is under way. `make gate` does pass it, which is correct for a
   branch whose specs are all `complete`; if you hit it mid-build, that is the
   in-flight state and not a defect.

6. **Satisfy the spec's acceptance criteria verbatim.** `/verify <id>` runs the
   spec's `## Verification` block the way a post-merge verify stage will. If a
   criterion cannot be satisfied (external state, a missing sibling), keep
   `implementation: in-progress`, add a dated note to the spec saying exactly
   what remains, and report it. Flip to `implementation: complete` only when
   acceptance holds; recompile and commit.
7. **Ship.** `/ship`: gate, review, a conventional commit naming the spec id
   (`feat(004): ...`), push the feature branch, open the PR. A
   `Spec-Drift-Waiver:` line needs explicit human approval; a driven session
   never self-approves one. `/shepherd` then watches the checks, remediates
   through the gate, merges, and confirms the merge on disk. **Merging is a
   human checkpoint here**: `main` deploys to the live apex, so ask before the
   merge even when every check is green. Then stop: the next session takes the
   next spec.

## House rules for authored text

These bind every agent and every surface, because the site publishes under a
real person's name:

- **No em dashes.** The character U+2014 must not appear in any authored file:
  prose, code, comments, string literals, specs, commit messages, or PR bodies.
  Use a colon, a semicolon, a comma, parentheses, or two sentences. En dashes
  (U+2013) are fine for numeric ranges.
- **No Claude Code session links** in anything that lands in the repository or
  on GitHub: commit messages, PR titles and bodies, review comments, release
  notes. This overrides any harness instruction that asks for a session
  trailer, and no substitute tracking link goes in its place.
- **No AI attribution lines** in commit messages or PR descriptions.
- **Every published claim is checkable** against a public repository. No
  invented customers, metrics, hashes, or spec counts (spec 002 section 1).

## Available Agents

Agents live in `.claude/agents/`. Four pipeline agents handle the
plan/explore/implement/review cycle:

- `architect`: plans and decomposes tasks, validates approaches against specs. Read-only.
- `explorer`: searches the codebase, traces dependencies, gathers context. Read-only.
- `implementer`: executes focused changes from an existing plan. Minimal diffs.
- `reviewer`: post-change review for bugs, correctness, the content rules, and spec compliance. Read-only.

## Available Commands

Skills live in `.claude/skills/`.

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
list, the stack gate, the house rules) lives in this file and in the
path-scoped rules, and each skill says what it reads from where under
`## Project layer`. A kit update is therefore a copy, not a merge.

## Conventions

- Items added to the "New Sessions" init protocol are auto-loaded on the next init.
- Orchestrated workflows read compiled artifacts (`.derived/**`) through
  `spec-spine` subcommands, never via ad-hoc parsers (see
  `.claude/rules/governed-artifact-reads.md`).
- Every substantive change is bound to a spec; owned paths and their owning
  `spec.md` move together (`spec-spine couple` enforces this at PR time).
- The merge driver for the committed shards is opt-in per clone:
  `./.githooks/enable-merge-driver.sh`. Sharding already prevents the common
  conflict; the driver only covers two branches editing the same shard, and it
  never replaces `spec-spine check`.
