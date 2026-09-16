# AGENTS.md: statecraft

This file is the cross-agent session-init protocol authority, read by Claude
Code, Codex CLI, Cursor, and GitHub Copilot via the AAIF/Linux Foundation
AGENTS.md standard. It is the single source for the init protocol: tooling that
runs `/prime` reads the `## New Sessions` section to derive its plan.

> Governed by `specs/013-agent-harness/spec.md`.

Governance is provided by `spec-spine`, installed on your `PATH`
(`cargo install spec-spine-cli`, or `install.sh` as CI does). **The floor is
0.18.0**, declared in `spec-spine.toml [meta] required_version` and installed by
`.github/workflows/spec-spine.yml`, so a binary below it refuses every verb
rather than judging the tree with a different built-in bypass list. Do not reach
for `npx spec-spine`: this repository is governed by the PATH binary, and the
npm distribution is not installed here. Bootstrap spec:
`specs/000-bootstrap/spec.md`.

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
   `.claude/rules/adversarial-prompt-refusal.md`. The fourth rule,
   `derived-artifacts-are-compiler-output.md`, is path-scoped to `.derived/**`
   and loads on touch.

1. **Parallel reads.** Dispatch the following simultaneously (nothing here
   mutates the working tree, so there is no required ordering):
   - `CLAUDE.md`: project overview, governance model, conventions
   - `README.md`: full project description and product-family map
   - `standards/spec/contract.md`: the short normative spec-spine contract
   - `standards/spec/constitution.md`: durable constitutional baseline
   - `spec-spine --version`: the binary's version. **Read this before believing
     any exit code below** (spec 074 3.7); the CLI-version note further down is
     the reasoning, and this is the step that performs it.
   - `spec-spine check`: the freshness read for **both** committed trees, the
     spec registry and the codebase index (spec 075; non-fatal, see
     **Freshness** below)
   - `spec-spine registry status-report --json --nonzero-only`: lifecycle counts
   - `spec-spine registry plan`: the ready set (spec 038): which specs can be
     worked on now and what blocks the rest
   - `spec-spine index coverage`: which source files no spec specifically claims
     (spec 032; non-fatal, exit 2 if the index is stale)
   - `spec-spine index diagnostics`: the unresolved-unit diagnostics the
     committed index records (spec 050; non-fatal, empty output means none)
   - `spec-spine registry list --ids-only`: spec inventory (for latest-spec
     detection)
   - `ls backend/ frontend/ frontend-admin/ infra/`: the service and surface map
   - `ls specs/`: the spec corpus
   - `git log --oneline -10`: recent history
   - `git diff --stat HEAD~1`: last change summary

2. **Emit** a `## primed: statecraft` summary block: the service-layer
   overview, a `## lifecycle:` sub-section populated from the `status-report`
   output with the `registry plan` ready/blocked line beneath it, the freshness
   verdicts, the unresolved-unit count from `index diagnostics`, recent
   activity, and a "ready to help with" line. **Consult the `--version` read
   before reporting any freshness verdict**: a binary predating a flag a step
   passed makes that step's exit code meaningless.

3. **Orient on the thesis.** `specs/001-statecraft-thesis/spec.md` section 3
   (the service map) and section 6 (the milestone ladder) define what gets
   built next and in what order. 001 is a record, not a work order.

**Read discipline:** the init protocol MUST NOT parse `.derived/**/*.json`
directly (no `python`, `jq`, `awk`, `sed` against compiled artifacts). All
structural and lifecycle data comes from `spec-spine` subcommands.

**Freshness:** statecraft **commits** its compiled artifacts as per-unit shard
trees (`.derived/spec-registry/by-spec/*.json` and
`.derived/codebase-index/{by-spec,by-package}/*.json`; only
`.derived/**/build-meta.json` is gitignored). The committed shard set is the
reference for every lifecycle query, so `/prime` has to know whether it is
current.

`spec-spine check` (spec 075) asks about both trees in one call. It compiles in
memory and compares against the committed shards **without writing**, reports
each tree separately, and returns the more severe of the two verdicts in this
order: **`3` then `1` then `2` then `0`**. It is non-fatal to `/prime`: report
it in the summary and continue.

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

If the index is not built and `index render` fails, report "Codebase index: not
built" and continue without structural counts.

The counts are formatted in step 2, after every parallel read has returned, so
the freshness verdict is always in hand before the lifecycle numbers are
written down. Do not emit counts earlier.

**Unresolved units:** `spec-spine index diagnostics` (spec 050) lists the
`W-001` / `W-002` diagnostics the committed index records: a unit an owning spec
claims that does not resolve yet. Empty output means none. Report the count, and
name the specs when there are any: a spec under way legitimately claims
territory it has not written yet, so these are work in flight, not defects. The
gate half is `check --fail-on-unresolved`, which `make gate` and CI both run.

> **CLI version. Ask `spec-spine --version` before believing any exit code.**
> Every binary ever released answers it, and it exits 0. If the version
> predates the verb you are about to call, upgrade; do not interpret the exit
> code of a verb the binary does not have. Reporting a version problem as spec
> drift would send someone chasing a phantom, and a session told its shards are
> stale when they are not will regenerate and commit artifacts that were
> already correct.
>
> Since spec 063 a new CLI maps every usage error to **exit 3**, so exit 2 means
> staleness and nothing else; but the binary that reports the wrong code is by
> definition the old one, so a procedure that may be talking to one cannot rely
> on that. This repository pins `[meta] required_version = ">=0.18.0"`, which
> the CLI checks on every run (spec 062), so in practice the pin answers this
> before you do.

Do **not** substitute a plain `spec-spine compile` or `spec-spine index` here.
Writing repairs the tree as a side effect of reading it, which hides that the
*committed* copy was stale: the drift then reads as an uncommitted local edit
rather than as a defect already on the branch. `/prime` reports; it does not
silently mutate, and `spec-spine check` carries the same never-writes contract.

**CLI missing:** if `spec-spine --version` fails, run `/setup`. Do NOT fall back
to ad-hoc parsing of `.derived/**/*.json`.

If any file is missing: log "not found" and continue.

## Working the backlog

The governed loop is one spec per session, start to finish, then stop. One spec
per pull request.

statecraft is a **ratify-then-build** corpus: a spec is authored and approved by
a human before it is implemented, so a session picks from approved specs and
never from a `draft`. `/spec` files a new one born `draft`; the flip to
`approved` is the human's.

Record specs are never work orders: `000-bootstrap` (settled: `approved` with no
`implementation` key), `001-statecraft-thesis` and `013-agent-harness`. Their
`implementation` value says so, which is what `/next` reads.

1. **Pick the spec.** `spec-spine registry plan` prints the ready set in
   dependency order; `/next` applies the approval and in-flight rules on top of
   it and names the pick. Take the first entry unless a human named another.
   If the spec's Territory, "Cross-repo dependency" or "Operator prerequisites"
   section names something missing (a credential, a cluster, sibling-repo work),
   stop and report exactly what is needed instead of mocking around it.
2. **Branch and flip.** `/build <id>` sequences steps 2 to 6 with the exact
   commands. Work on a feature branch named after the spec id. Flip the spec to
   `implementation: in-progress`, run `spec-spine compile` and `spec-spine
   index`, and commit the flip with the regenerated shards before writing code.
   **Never commit to `main`**: it is branch-protected, and the push gate refuses
   a push that would update it.
3. **Re-read the spec in full before coding.** The design precedes the code. If
   the design is imprecise, record the choice you make as a dated decision entry
   in the spec. If the design is *wrong*, stop and report the contradiction:
   never edit a spec afterwards to ratify what the code happened to do
   (`.claude/rules/adversarial-prompt-refusal.md`).
4. **Implement within the territory.** Every file you add must be claimed by the
   spec you are implementing, in the same change. `[coupling] require_ownership`
   is **on**, so `C-002` refuses a changed source file that no spec specifically
   claims. Touching a unit another spec owns requires an `extends` edge on that
   spec's unit, declared in your spec's frontmatter; that amends nobody. Never
   edit `.derived/` by hand.
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

   `make refresh` is the first two; `make gate` is the four checks, which is
   what CI runs. The base ref is resolved from the repository rather than
   assumed to be `origin/main` (spec 072). Set `$SPEC_SPINE_DEFAULT_BRANCH` to
   override the branch the push gate protects and the `Makefile` compares
   against.

   Then **the stack gate**, `make stack`, which mirrors
   `.github/workflows/verify.yml`:

   ```sh
   npm run build:web && npm run build:web-admin && npm run build:app
   npm run check:model
   npm run typecheck && npm --prefix frontend run typecheck
   npm test && npm --prefix frontend test
   ```

   All must exit 0. Commit the regenerated shards with the code they describe.
   Keep this list and the two CI workflows identical: the skills tell their
   reader to run "the gate as `AGENTS.md` lists it", so a step CI enforces and
   this list omits is a step every session skips.

   **Toolchain:** Node 24 and npm (`engines.node >= 24`). There is no cargo
   here: the governance and fleet addons are pinned `@statecrafting/*` packages
   (specs 006 and 008), not in-tree crates. A local run needs
   `npm run generate-keys` before the backend will serve logins.
6. **Satisfy the spec's acceptance criteria verbatim.** `/verify <id>` runs the
   spec's `## Verification` block through `spec-spine verify <id>`. If a
   criterion cannot be satisfied (external state, a missing sibling-repo
   change), keep `implementation: in-progress`, add a dated Status note to the
   spec saying exactly what remains, and report it. Flip to
   `implementation: complete` only when acceptance holds, in the implementing
   PR (precedent: specs 003 and 008), then recompile and commit.
7. **Ship.** `/ship`: gate, review, a conventional commit naming the spec id
   (`feat(011): ...`), push the feature branch, open the PR. A
   `Spec-Drift-Waiver:` line needs explicit human approval; a driven session
   never self-approves one. `/shepherd` then watches the checks, remediates
   through the gate, merges, and confirms the merge on disk. Then stop: the
   next session takes the next spec.

**Never-touch artefacts.** `.derived/**` is compiler output (hand-edit it and
the ledger disagrees with what it describes). `encore.gen/**` is Encore's
generated client surface, gitignored and rewritten by every `npm run build:app`;
it is excluded from the resolver and the coverage walk. `keys/**` and any `.env`
are local secrets and never land in a commit.

**Cross-repo discipline.** statecraft sits beside `enrahitu`, `statecrafting`
and other checkouts. Never `cd` out of this repository to run a gate: use
`git -C <path>` instead. A `cd` into a sibling persists for the rest of the
session and makes the next gate run green in the wrong tree.

## Available Agents

Agents live in `.claude/agents/`. Four pipeline agents handle the
plan/explore/implement/review cycle, plus one domain specialist:

- `architect`: plans and decomposes tasks, validates approaches against specs. Read-only.
- `explorer`: searches the codebase, traces dependencies, gathers context. Read-only.
- `implementer`: executes focused changes from an existing plan. Minimal diffs.
- `reviewer`: post-change review for bugs, correctness, performance, spec compliance. Read-only.
- `encore-expert`: Encore.ts framework and backend implementation questions:
  `api()` endpoints, services, auth drivers, CoreLedger entities, the `lib/`
  security primitives. Read-only.

## Available Commands

Skills live in `.claude/skills/` (one `SKILL.md` per folder). They are the
kit's ten, byte-identical to the spec-spine kit: the project layer lives in this
file, not in the skills.

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

Every skill is repository-invariant and ends with a `## Project layer` section
naming what it reads from here, from `spec-spine.toml`, and from the
path-scoped rules. Keep the project layer here and a kit update stays a copy
rather than a merge.

## Conventions

- Items added to the "New Sessions" init protocol are auto-loaded on the next init.
- Specs are numbered `NNN-slug` in the order they are filed; `/spec` takes the
  next free ordinal. The thesis is `001`, and section 3 of it is the service map
  every new service spec must fit.
- Agents must be self-contained within `.claude/agents/`: no cross-project dependencies.
- Orchestrated workflows read compiled artifacts (`.derived/**`) through
  `spec-spine` subcommands, never via ad-hoc parsers (see
  `.claude/rules/governed-artifact-reads.md`).
- Every substantive change is bound to a spec; owned paths and their owning
  `spec.md` move together (`spec-spine couple` enforces this at PR time).
- License boundaries are load-bearing: this repo is AGPL-3.0, while the enrahitu
  template and statecraft-cli are Apache-2.0 in their own repos. Note the
  license implication in the PR when code crosses the boundary.
