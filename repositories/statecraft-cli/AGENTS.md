# AGENTS.md: statecraft-cli

This file is the cross-agent session-init protocol authority, read by Claude
Code, Codex CLI, Cursor, and GitHub Copilot via the AAIF/Linux Foundation
AGENTS.md standard. It is the single source for the init protocol: tooling that
runs `/prime` reads the `## New Sessions` section to derive its plan.

Governance is provided by `spec-spine` **0.18.0 or later** (installed on your
`PATH`: `cargo install spec-spine-cli --locked`, or the installer at
statecrafting/spec-spine; `spec-spine.toml [meta] required_version` pins it).
All governed reads of compiled artifacts go through its CLI. Bootstrap spec:
`specs/100-bootstrap/spec.md`. The harness this file heads (skills, agents,
hooks, `Makefile`, the govern workflow) is claimed by spec 109.

> Keep the protocol in sync by editing this file, never the `/prime` skill.

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
   - `README.md`: full project description
   - `standards/spec/contract.md`: the short normative spec-spine contract
   - `standards/spec/constitution.md`: durable constitutional baseline
   - `spec-spine --version`: the binary's version. **Read this before believing
     any exit code below** (spec 074 3.7); the CLI-version note further down is
     the reasoning, and this is the step that performs it.
   - `spec-spine check`: the freshness read for **both** committed trees, the spec
     registry and the codebase index (spec 075; non-fatal, see **Freshness** below)
   - `spec-spine registry status-report --json --nonzero-only`: lifecycle counts
   - `spec-spine registry plan`: the ready set (spec 038): which specs can be worked on now and what blocks the rest
   - `spec-spine index coverage`: which source files no spec specifically claims (spec 032; non-fatal, exit 2 if the index is stale)
   - `spec-spine registry list --ids-only`: spec inventory (for latest-spec detection)
   - `ls src/ src/verbs/ tests/ members/src/ members/src/orchestrator/`:
     application surface discovery (the clap command tree and its tests;
     the members' sensor, engine and driver)
   - `specs/101-cli-mcp-thesis/spec.md`: the decided constraints (binary
     name `statecraft`, Rust, stdio MCP, Apache-2.0, rustls only, no TUI)
   - `git log --oneline -10`: recent history
   - `git diff --stat HEAD~1`: last change summary

2. **Emit** an `## primed: statecraft-cli` summary block (layer overview,
   recent activity, ready-to-help line), with a `## lifecycle:` sub-section
   populated from the `status-report` output. **Consult the `--version` read
   before reporting any freshness verdict**: a binary predating a flag a step
   passed makes that step's exit code meaningless.

**Read discipline:** the init protocol MUST NOT parse `.derived/**/*.json`
directly (no `python`, `jq`, `awk`, `sed` against compiled artifacts). All
structural and lifecycle data comes from `spec-spine` subcommands.

**Freshness:** if you commit your derived artifacts, `spec-spine check` (spec
075) asks about both committed trees in one call. It compiles in memory and
compares against the committed shards **without writing**, reports each tree
separately, and returns the more severe of the two verdicts in this order:
**`3` then `1` then `2` then `0`**. It is non-fatal to `/prime`: report it in
the summary and continue.

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

If the index is not built and `render` fails, report "Codebase index: not
built" and continue without structural counts.

The counts are formatted in step 2, after every parallel read has returned, so
the freshness verdict is always in hand before the lifecycle numbers are
written down. Do not emit counts earlier.

> **CLI version. Ask `spec-spine --version` before believing any exit code.**
> Every binary ever released answers it, and it exits 0. If the version
> predates the verb you are about to call, upgrade; do not interpret the exit
> code of a verb the binary does not have. Reporting a version problem as spec
> drift would send someone chasing a phantom, and a session told its shards are
> stale when they are not will regenerate and commit artifacts that were
> already correct.
>
> One call, and it works against every version including ones predating every
> flag. Since spec 063 a new CLI maps every usage error to **exit 3**, so exit 2
> means staleness and nothing else; but the binary that reports the wrong code
> is by definition the old one, so a procedure that may be talking to one cannot
> rely on that. Where the repository sets `[meta] required_version` (spec 062),
> the CLI checks on every run and this manual step is unnecessary.

Do **not** substitute a plain `spec-spine compile` or `spec-spine index` here.
Writing repairs the tree as a side effect of reading it, which hides that the
*committed* copy was stale: the drift then reads as an uncommitted local edit
rather than as a defect already on the branch. `/prime` reports; it does not
silently mutate, and `spec-spine check` carries the same never-writes contract.

If you **gitignore** the derived directory instead, there is nothing committed
to compare against and the freshness read would report everything missing. Drop
`spec-spine check`, and instead run plain `spec-spine compile` and `spec-spine
index` **before** the rest of step 1: those two write the artifacts that the
`registry` and `index` reads below them consume, so for this variant only, step
1 is no longer order-free.

**CLI missing:** if `spec-spine --version` fails, run `/setup`. Do NOT fall back
to ad-hoc parsing of `.derived/**/*.json`.

If any file is missing: log "not found" and continue.

## Working the backlog

The governed loop is one spec per session, start to finish, then stop. It is
what `spec-spine registry plan`, the in-flight leniency (specs 025, 041, 044)
and the ownership ratchet (spec 032) exist to serve. Record specs (the
bootstrap spec, a thesis, a harness spec at `n-a` or `complete`) are never
work orders.

1. **Pick the spec.** `spec-spine registry plan` prints the ready set in
   dependency order; `/next` applies the two rules on top of it and names the
   pick. Take the first entry unless a human named another. Never guess and
   never pick a `draft`: approval is a human act (`plan` will offer a draft
   whose dependencies are met; `/next` will not). If the spec's
   Territory names an operator prerequisite (a credential, a bucket, a
   cluster) that is missing, stop and report exactly what is needed instead
   of mocking around it.
2. **Branch and flip.** `/build <id>` sequences steps 2 to 6 with the exact
   commands. Work on a feature branch named after the spec id.
   Flip the spec to `implementation: in-progress`, run `spec-spine compile`
   and `spec-spine index`, and commit the flip with the regenerated derived
   shards before writing code. Never commit to `main`.
3. **Re-read the spec in full before coding.** The design precedes the code.
   If the design is imprecise, record the choice you make as a dated decision
   entry in the spec. If the design is *wrong*, stop and report the
   contradiction: never edit a spec afterwards to ratify what the code
   happened to do (`.claude/rules/adversarial-prompt-refusal.md`).
4. **Implement within the territory.** Every file you add must be claimed by
   the spec you are implementing, in the same change (`C-002` refuses an
   unclaimed source file). Touching a unit another spec owns requires an
   `extends` edge on that spec's unit, declared in your spec's frontmatter;
   that amends nobody. Never edit the derived directory by hand.
5. **Run the gate before every commit.** The governance floor, in this
   order (`compile` and `index` write; the checks follow):

   ```sh
   spec-spine compile
   spec-spine index
   make gate          # check --fail-on-warn, lint --fail-on-warn,
                      # index coverage --fail-on-untraced, couple
   cargo fmt --check
   cargo clippy --all-targets -- -D warnings
   cargo test
   make members       # in members/: bun run typecheck, the member builds, bun test
   ```

   The cargo half applies to a change under `src/` or `tests/`; the bun
   half to one under `members/`; a change to both runs both.

   `make gate` is the read-only half exactly as `.github/workflows/spec-spine.yml`
   runs it; `make refresh` is the writing half (`compile` + `index`). The
   base ref is resolved from the repository rather than assumed to be
   `origin/main` (spec 072). Set `$SPEC_SPINE_DEFAULT_BRANCH` to override
   the branch the push gate protects and `Makefile` compares against.

   All must exit 0. Commit the regenerated shards with the code they describe.
   Keep this list, the `Makefile` and the CI job identical: the skills tell
   their reader to run "the gate as `AGENTS.md` lists it", so a step CI
   enforces and this list omits is a step every session skips.
   `[coupling] require_ownership` is on, so every new source file must be
   claimed in the implementing spec in the same change (`C-002`).
   `check --fail-on-unresolved` is deliberately off (spec 050): spec 108 is
   approved and pending, so its symbol unit is legitimately unresolved until
   it is built. Turn the flag on in `Makefile` and CI once it is.
6. **Satisfy the spec's acceptance criteria verbatim.** `/verify <id>` runs
   the spec's `## Verification` block the way the post-merge verify stage
   will. If a criterion cannot
   be satisfied (external state, a missing sibling), keep `implementation:
   in-progress`, add a dated note to the spec saying exactly what remains,
   and report it. Flip to `implementation: complete` only when acceptance
   holds; recompile and commit. The gate then holds the spec to every unit it
   claims (spec 041).
7. **Ship.** `/ship`: gate, review, a conventional commit naming the spec id
   (`feat(011): ...`), push the feature branch, open the PR. A
   `Spec-Drift-Waiver:` line needs explicit human approval; a driven session
   never self-approves one. `/shepherd` then watches the checks, remediates
   through the gate, merges, and confirms the merge on disk. Then stop: the
   next session takes the next spec.

## Available Agents

Agents live in `.claude/agents/`. Four pipeline agents handle the
plan/explore/implement/review cycle:

- `architect`: plans and decomposes tasks, validates approaches against specs. Read-only.
- `explorer`: searches the codebase, traces dependencies, gathers context. Read-only.
- `implementer`: executes focused changes from an existing plan. Minimal diffs.
- `reviewer`: post-change review for bugs, correctness, performance, spec compliance. Read-only.

The four carry this repo's project layer: the Rust stack gate, the exit-code
discipline, and the product-surface guards (`--posture` required on stamps,
`--confirm <name>` on fleet remove, no bypass flags, stable `--output json`
envelopes, no local stamping or kubeconfig access). See `CLAUDE.md`.

## Available Commands

Skills live in `.claude/skills/`:

The governed loop, in the order "Working the backlog" runs it:

- `/prime`: prime a session (this protocol).
- `/setup`: one-time contributor setup; installs the pinned spec-spine and verifies the governed loop.
- `/next`: name the next work order from `registry plan`, minus drafts, with in-flight specs and blockers reported. Read-only.
- `/build <id>`: implement one spec start to finish: preflight, branch, flip, implement, gate, verify, flip complete.
- `/verify <id>`: run the spec's `## Verification` block locally through `spec-spine verify <id>` (needs spec-spine 0.15.0 or later).
- `/ship`: run the gate, review, commit on the feature branch, open the PR.
- `/shepherd`: watch the PR's checks by head sha, remediate through the gate, merge, confirm on disk.
- `/spec`: author a new spec at the next free ordinal, born `draft`; approval stays a human flip.

The skills the loop calls:

- `/commit`: create a git commit with an impact-focused conventional message, spec ordinal as scope. `main` requires signed commits, so PRs merge with `gh pr merge --squash`.
- `/code-review`: review the working diff for correctness bugs, spec drift, and illegitimate mid-build spec edits.

The Codex face of the same kit (spec 118): a Codex session finds these
skills under `.agents/skills/`, the four agents as `.codex/agents/*.toml`,
and the four hooks in `.codex/hooks.json`, all generated from `.claude/` by
`make codex-kit` and checked by `python3 scripts/codex-kit.py --check`.
Never edit the generated copies; edit `.claude/` and regenerate. A driven
Codex session runs the hooks because the Codex driver passes
`--dangerously-bypass-hook-trust` (118 B-4): without it Codex skips a
project's hooks silently, and the PR gate would be absent in exactly the
sessions that need it.

Every skill is repository-invariant: the project layer (the binary
invocation, the version pin, the gate command list, the stack gate, the
never-touch artefacts) lives in this file and in the path-scoped rules, and
each skill says what it reads from where under `## Project layer`.

## Conventions

- Items added to the "New Sessions" init protocol are auto-loaded on the next init.
- Orchestrated workflows read compiled artifacts (`.derived/**`) through
  `spec-spine` subcommands, never via ad-hoc parsers (see
  `.claude/rules/governed-artifact-reads.md`).
- Every substantive change is bound to a spec; owned paths and their owning
  `spec.md` move together (`spec-spine couple` enforces this at PR time).
- Cross-repo prerequisites (a control-plane endpoint, an enrahitu spec, a
  member binary) are reported, never mocked around: a spec whose territory
  names one that is missing stays `in-progress` with a dated note.
- Never use the em dash character (U+2014) in anything authored here; the
  reviewer agent checks for it, along with session links and AI attribution.
