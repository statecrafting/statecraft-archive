---
id: "182-claude-skills-migration"
slug: claude-skills-migration
title: "Migrate .claude/commands/ to .claude/skills/ (modern Claude Code surface)"
status: approved
implementation: complete
owner: bart
created: "2026-05-25"
approved: "2026-05-26"
amended: "2026-06-18"
amendment_record: |
  amended 2026-06-18 by spec 217 (engine-swap collapse): the in-tree codebase-indexer that hashed the skills surface this spec extended was deleted; that hashing is now in spec-spine-core. The codebase-indexer edge is stripped (path deleted); this spec's authority is the .claude/skills/** surface it establishes.
kind: migration
domain: tooling
risk: low
authors:
  - "bart"
language: en
code_aliases:
  - CLAUDE_SKILLS_DIR
amends:
  - "071-skill-command-factory"
  - "101-codebase-index-mvp"
  - "061-conductor-track-lifecycle"
  - "134-fast-local-ci-mode"
  - "135-fast-ci-as-default"
  - "104-makefile-ci-parity-contract"
  - "103-init-protocol-governed-reads"
amends_sections: []
# 217 deleted the in-tree codebase-indexer; the workflow/skills hashing this spec
# extended is now in spec-spine-core (spec-spine index). The codebase-indexer/src/lib.rs
# edge is stripped (path deleted); this spec's authority is the .claude/skills/**
# surface it establishes (below). Amended by 217.
establishes:
  - unit: { kind: directory, path: .claude/skills/init }
  - unit: { kind: file, path: .claude/skills/init/SKILL.md }
  - unit: { kind: directory, path: .claude/skills/setup }
  - unit: { kind: file, path: .claude/skills/setup/SKILL.md }
  - unit: { kind: directory, path: .claude/skills/commit }
  - unit: { kind: file, path: .claude/skills/commit/SKILL.md }
  - unit: { kind: directory, path: .claude/skills/code-review }
  - unit: { kind: file, path: .claude/skills/code-review/SKILL.md }
  - unit: { kind: directory, path: .claude/skills/implement-plan }
  - unit: { kind: file, path: .claude/skills/implement-plan/SKILL.md }
  - unit: { kind: directory, path: .claude/skills/research }
  - unit: { kind: file, path: .claude/skills/research/SKILL.md }
  - unit: { kind: directory, path: .claude/skills/validate-and-fix }
  - unit: { kind: file, path: .claude/skills/validate-and-fix/SKILL.md }
  - unit: { kind: directory, path: .claude/skills/cleanup }
  - unit: { kind: file, path: .claude/skills/cleanup/SKILL.md }
  - unit: { kind: directory, path: .claude/skills/refactor-claude-md }
  - unit: { kind: file, path: .claude/skills/refactor-claude-md/SKILL.md }
  - unit: { kind: file, path: specs/182-claude-skills-migration/baseline-init.txt }
references:
  - role: precedent
    unit: { kind: file, path: specs/178-opc-directory-rename/spec.md }
  - role: precedent
    unit: { kind: file, path: specs/105-scripts-to-binaries-migration/spec.md }
summary: >
  Mechanical migration of the ten single-file commands under
  `.claude/commands/` to the modern Claude Code skills surface at
  `.claude/skills/<name>/SKILL.md`. Per the current Claude Code
  docs, "commands and skills are now the same mechanism" and
  skills are the recommended successor because they support
  bundling supporting files alongside the SKILL.md entrypoint.
  Today the ten OAP commands (`init`, `setup`, `commit`,
  `code-review`, `review-branch`, `implement-plan`, `research`,
  `validate-and-fix`, `cleanup`, `refactor-claude-md`) are inline
  single-file prompts; migrating to the folder-per-skill form is
  the precondition for splitting their inline checklists, fixture
  references, and protocol bodies out as sibling files where it
  makes the prompt clearer. Behavior is unchanged: each `/name`
  invocation continues to resolve to the same prompt body.
  The migration touches two other specs: 101 (indexer's
  hashed-input set adds `.claude/skills/`) and 071
  (acknowledges skills as the primary surface). AGENTS.md
  is **preserved unchanged** as the canonical cross-agent
  session-init protocol authority — it is now an open
  standard stewarded by the Linux Foundation's Agentic AI
  Foundation (AAIF) and is read by OpenAI Codex, Cursor,
  GitHub Copilot, and other agents in addition to Claude
  Code. Spec 103's `establishes:` over AGENTS.md stays
  unmodified. The new `.claude/skills/init/SKILL.md` is a
  thin Claude-Code-specific dispatcher that reads AGENTS.md
  and executes the protocol described there; the protocol
  body's canonical location does not change.
---

# Feature Specification: Migrate `.claude/commands/` to `.claude/skills/`

## Purpose

Bring the project's Claude Code extension layout into alignment with
the modern `.claude/` surface documented at
<https://code.claude.com/docs/en/claude-directory>. Two concrete wins:

1. **Thin dispatcher for `/init`.** Today `commands/init.md`
   inlines the AGENTS.md New Sessions protocol as a literal
   step list — duplicating content that AGENTS.md is already
   canonical for. In the skills form, `skills/init/SKILL.md`
   becomes a thin dispatcher that reads AGENTS.md and executes
   the protocol declared there. AGENTS.md stays as the
   single source of truth; the dispatcher is a Claude-Code-
   specific executor of a cross-agent protocol.
2. **Future-proofing.** The docs are explicit: "for new workflows,
   use skills/ instead." Single-file commands remain supported but
   are explicitly the legacy form. Migrating now lets new entries
   under `.claude/skills/` follow one consistent pattern instead of
   accumulating in two parallel locations.

The migration is mechanical for nine of the ten commands —
each becomes a skill directory with a `SKILL.md` whose body
is verbatim. The init skill is the exception: it inverts the
current "inlined protocol" pattern back to "dispatcher reads
AGENTS.md," matching the AAIF-standard expectation that
AGENTS.md is the canonical cross-agent protocol surface.

## Why AGENTS.md is preserved (not relocated, not deleted)

AGENTS.md is now an open standard under the Linux Foundation's
Agentic AI Foundation (AAIF) — the same body that stewards
MCP. The format has 60,000+ adopting repositories and is read
by OpenAI Codex, Cursor, GitHub Copilot, and other coding
agents. Claude Code is the **outlier**, not the standard:
CLAUDE.md is the proprietary Claude-Code-specific file;
AGENTS.md is the cross-agent canonical surface.

Earlier drafts of this spec proposed relocating the protocol
body into a Claude-Code-internal `new-sessions-protocol.md`
sibling. That was the wrong call. It would have cut OAP off
from Codex CLI, Cursor, Copilot, and any future coding agent
that opens this repo, while gaining nothing — the dispatcher
can read AGENTS.md directly with no intermediate file.

The clean separation:

- **AGENTS.md** — cross-agent, vendor-neutral, governed by
  spec 103. Describes the protocol declaratively. Any agent
  that opens this repo reads it and executes the protocol in
  its own way.
- **`.claude/skills/init/SKILL.md`** — Claude-Code-specific
  dispatcher. Implementation. Reads AGENTS.md and translates
  it into Claude Code's parallel tool calls. If Codex CLI
  lands here tomorrow, it gets its own dispatcher under
  whatever path Codex expects; AGENTS.md does not move.

This matches the constitutional posture: the protocol is
authority, the dispatcher is implementation; the dispatcher
is the harness layer, the protocol is the project surface.

## Scope

This spec describes a **two-PR migration with an explicit
transition window**. Wholesale swap from `commands/` to
`skills/` in one PR is rejected because anyone with staged
`commands/` files (or a forked branch mid-merge) would land in
an inconsistent state. The transition window keeps both
locations functional while the migration completes.

In scope (migration PR):

- Amend spec **101-codebase-index-mvp** to add `.claude/skills/`
  to the documented indexer input set. Honor the spec's
  amendment convention (`amended:` + `amendment_record:` per
  spec 000). This lands **first** in the migration PR's diff
  ordering; everything else assumes it.
- Spec **103-init-protocol-governed-reads** is **not
  amended**. AGENTS.md remains the canonical protocol body
  per spec 103's existing `establishes:` unit. The skill
  dispatcher is implementation that reads the protocol body;
  the protocol body's authority and location are unchanged.
- Amend spec **071-skill-command-factory** to acknowledge that
  the OAP repository now treats skills as the primary surface.
  No behavioral change to the factory mechanism.
- Update `tools/spec-spine/codebase-indexer/src/lib.rs` so the
  `collect_input_files` walk hashes the **union** of
  `.claude/{agents,commands,rules,skills}` (not a swap). The
  one-line change near line 568 adds `.claude/skills` to the
  subdir array. Both `commands/` and `skills/` are hashed for
  the duration of the transition window.
- Create ten new skill directories under `.claude/skills/`:
  `init`, `setup`, `commit`, `code-review`, `review-branch`,
  `implement-plan`, `research`, `validate-and-fix`, `cleanup`,
  `refactor-claude-md`. Each contains a `SKILL.md` with the
  former command body copied verbatim.
- **`skills/init/SKILL.md` is a thin dispatcher that reads
  AGENTS.md.** Claude Code's `/init` invocation resolves to
  `skills/init/SKILL.md` (skill > command precedence over
  the legacy `commands/init.md`). The new SKILL.md does not
  duplicate the protocol body. Instead it instructs Claude
  Code to read AGENTS.md § New Sessions and execute the
  protocol declared there. AGENTS.md remains the single
  source of truth for the session-init protocol across all
  agents (Claude Code, Codex CLI, Cursor, Copilot, etc.).
  This decouples the protocol (governed, cross-agent,
  vendor-neutral) from the dispatcher (Claude-Code-specific,
  thin, implementation detail).
- **Validate equivalence (nine non-init skills only).** For
  each of the nine non-init migrated skills, run a diff
  between the former `commands/<n>.md` body and the new
  `skills/<n>/SKILL.md` body (minus the frontmatter `name:`
  field). The diff must be empty modulo frontmatter
  rewording. Record this in the PR description. The init
  skill is excluded from this check — it is intentionally
  rewritten as a dispatcher per the AGENTS.md preservation
  rationale; its equivalence is verified via AC-9
  (structural equivalence against baseline-init.txt), not
  via body diff.
- Update `CLAUDE.md`'s "Claude Code Extension Points" bullet
  to name `.claude/skills/` as the primary surface and
  `.claude/commands/` as the legacy form being phased out.
- Regenerate `.derived/codebase-index/index.json` via
  `make pr-prep` and commit the regenerated artifact in the
  same PR.

Deprecation PR (follow-up, not this PR):

- Delete the ten files under `.claude/commands/` once at
  least one full session has exercised the new skill
  invocations in main without regression. The `.claude/commands`
  directory itself remains in the indexer walk so future
  legacy adds (if any) continue to be hashed; the directory
  will simply be empty.
- AGENTS.md is preserved at the repo root unchanged across
  both PRs; the deprecation PR does not touch it.

Out of scope (explicit):

- Splitting inline checklists or protocol bodies from any
  SKILL.md other than `init`. The other nine SKILL.md files
  are byte-for-byte copies of the former command bodies.
  Splitting them out as bundled sibling files is a follow-up
  unit per skill.
- Changing the invocation behavior of any command. `/init`,
  `/setup`, etc., continue to resolve to the same prompt
  (init's prompt is now dispatched via reading AGENTS.md
  directly; the rendered dispatch behavior is structurally
  equivalent per AC-9).
- Adding new skills beyond the ten enumerated.
- Changing the codebase-indexer's behavior beyond the input-set
  addition. No new diagnostics, no new layers, no removal of
  the `commands/` walk entry.
- Removing the `.claude/commands/` walk entry. The transition
  window keeps both paths hashed.
- Auto-generating SKILL.md content. The verbatim copy is the
  contract.

## Mechanical change list (migration PR)

The PR's diff is the union of, **in this commit ordering**:

1. **Spec 101 amendment**: add `.claude/skills/` to whichever
   section of `specs/101-codebase-index-mvp/spec.md` enumerates
   the indexer's input set. Honor the spec's amendment
   convention (`amended:` + `amendment_record:` per spec 000).
2. **Spec 071 amendment**: append an acknowledgement that
   skills are the primary surface in the OAP repo. Wording is
   load-bearing; route through the spec's owner.
3. **Indexer source**
   (`tools/spec-spine/codebase-indexer/src/lib.rs` near
   line 568): add `.claude/skills` to the subdir array. The
   resulting set is `[".claude/agents", ".claude/commands",
   ".claude/rules", ".claude/skills"]`. **Union, not swap.**
4. **Skill directories** (`.claude/skills/`): create ten new
   `<name>/SKILL.md` files. Nine of them are verbatim copies
   of the former `.claude/commands/<name>.md` bodies.
5. **Init skill dispatcher** (`.claude/skills/init/SKILL.md`):
   the only SKILL.md that is NOT a verbatim copy. It is
   rewritten as a thin dispatcher: a short frontmatter, a
   one-line instruction to read AGENTS.md § New Sessions, and
   a delegation note. The legacy `commands/init.md` body's
   step list does not migrate verbatim because AGENTS.md is
   already the source of those steps; the legacy file was an
   inline executor of an external protocol. The new SKILL.md
   restores that separation cleanly.
6. **AGENTS.md unchanged.** No edits, no relocation, no
   deletion. AGENTS.md remains the canonical protocol body.
7. **Root documentation**: update `CLAUDE.md`'s "Claude Code
   Extension Points" bullet to name `.claude/skills/` as the
   primary surface and `.claude/commands/` as the legacy form.
   The AGENTS.md bullet in CLAUDE.md is preserved as-is
   (still pointing at AGENTS.md as the cross-agent protocol).
8. **`.claude/commands/` left in place.** The ten legacy
   files remain. The skill-over-command precedence means
   they are inert; they will be deleted in the deprecation PR.
9. **Generated index**: regenerate
   `.derived/codebase-index/index.json` via `make pr-prep` and
   commit the result.

## Acceptance criteria — ordered prerequisites

The AC list is **ordered**: each step assumes the prior steps
have landed in the migration PR's commit graph (or are landing
together atomically). Reviewers should verify the order in the
diff itself, not just final state.

- **AC-1 (specs first):** The two amended specs (101, 071)
  each carry the `.claude/skills/` path references and the
  proper amendment frontmatter (`amended:`,
  `amendment_record:`). Verify by reading the spec diffs
  before the indexer or skill diffs. Spec 103 is not amended;
  AGENTS.md is preserved as the canonical protocol body.
- **AC-2 (indexer is union, not swap):** The change in
  `tools/spec-spine/codebase-indexer/src/lib.rs` adds
  `.claude/skills` to the `collect_input_files` subdir array
  while preserving `.claude/commands`. Diff shows insertion,
  not replacement. The hashed-input set is the strict
  superset of the pre-migration set.
- **AC-3 (skills created and validated):** `ls .claude/skills/`
  lists exactly the ten skill directories enumerated; each
  contains a `SKILL.md`. Nine of the SKILL.md bodies are
  byte-for-byte equal (post-frontmatter-normalization) to the
  former `commands/<n>.md`. The init SKILL.md is the
  exception: it is a thin dispatcher that reads AGENTS.md.
  The init dispatcher MUST NOT inline the protocol body
  (that would create duplicate canonical locations).

  **Init dispatcher negative checks (concrete and
  falsifiable):**
  1. `wc -l .claude/skills/init/SKILL.md` returns a count
     under 30 lines. The thin-dispatcher form is
     structurally short; a verbatim copy of the legacy
     `commands/init.md` body would be ~80+ lines.
  2. `grep -E "registry-consumer status-report|codebase-indexer
     check|parallel reads" .claude/skills/init/SKILL.md`
     returns zero matches. These are concrete protocol-body
     phrases that exist in `commands/init.md` and AGENTS.md
     but MUST NOT appear in the dispatcher (their presence
     in the dispatcher would mean it inlined the protocol
     rather than reading AGENTS.md).
  3. `grep -F "AGENTS.md" .claude/skills/init/SKILL.md`
     returns at least one match (the dispatcher must
     reference AGENTS.md to do its job).

  Together, the three checks make "dispatcher, not verbatim
  copy" a falsifiable invariant rather than a stated
  intent.
- **AC-4 (commands still present during transition):**
  `ls .claude/commands/` still contains the ten legacy files.
  They are **not** deleted in this PR. (Deletion is the
  deprecation PR, a separate landing event.)
- **AC-5 (docs updated, AGENTS.md preserved):** `CLAUDE.md`
  names `.claude/skills/` as the primary surface in the
  Claude Code Extension Points section. The AGENTS.md bullet
  in CLAUDE.md is unchanged (AGENTS.md remains the
  cross-agent protocol authority per the AAIF standard).
  `ls AGENTS.md` returns the file on the PR branch
  identically to `main`. A grep for `.claude/commands/`
  across `specs/**/*.md` returns only references explicitly
  marked as "legacy" or "transition". Spec 103's
  `AGENTS.md` references and `establishes:` unit are
  unchanged.
- **AC-6 (index regenerated and clean):**
  `codebase-indexer check` exits 0. The PR includes the
  regenerated `.derived/codebase-index/index.json`.
- **AC-7 (coupling gate clean):**
  `spec-code-coupling-check` against `origin/main` reports no
  orphaned paths. Specifically the two spec amendments
  (101, 071) each cite the indexer source change and vice
  versa.
- **AC-8 (invocations equivalent):** `/init`, `/setup`,
  `/commit`, `/code-review`, `/review-branch`,
  `/implement-plan`, `/research`, `/validate-and-fix`,
  `/cleanup`, `/refactor-claude-md` resolve to the new
  SKILL.md bodies in a fresh Claude Code session. (Skill
  precedence over commands per the docs means the new path
  wins automatically.)
- **AC-9 (init dispatch structurally equivalent to baseline):**
  Byte-identical-transcript comparison fails on non-
  determinism — timestamps in tool outputs, parallel-read
  dispatch order (Claude Code is free to dispatch a parallel
  batch in any order), git log churn between baseline and
  verification captures, registry-consumer status counts that
  shift as specs land. The correct success criterion is
  **structural equivalence**, defined below.

  **Baseline shape (not a transcript).** Before opening the
  migration PR, capture a structured manifest by running
  `/init` against `main` (commands/init.md → AGENTS.md) and
  serializing the dispatch into
  `specs/182-claude-skills-migration/baseline-init.txt`
  with this shape (extraction rules below the manifest):

  ```
  PROTOCOL_SOURCE_HASH: <sha256 of AGENTS.md "New Sessions" section>
  TOOLS_INVOKED: <sorted set of tool names: Bash, Read, ...>
  FILES_READ: <sorted set of absolute paths read>
  PARALLEL_BATCHES:
    BATCH_1: <sorted set of tool calls in batch 1>
    BATCH_2: <sorted set of tool calls in batch 2>
    ...
  SEQUENTIAL_STEPS:
    STEP_1: <single tool call>
    STEP_2: <single tool call>
    ...
  ```

  Parallel batches preserve the dispatcher's *batching*
  decision (which calls go in the same parallel block)
  without overspecifying within-batch order, which Claude
  Code does not commit to. Sequential steps preserve
  ordering where AGENTS.md prescribes it.

  **Extraction rules (deterministic).** Spurious manifest
  divergence between baseline and verification captures is
  prevented by fixing extraction precisely:

  - `PROTOCOL_SOURCE_HASH`: sha256 over the body of
    AGENTS.md's "New Sessions" section, where the body is
    defined as **the lines starting at the `## New Sessions`
    heading inclusive, ending immediately before the next
    `## ` heading exclusive (or EOF if no further heading
    exists)**. Trailing whitespace stripped per line. No
    final-newline normalization (the file's trailing
    newline state is part of the hashed content).
  - `FILES_READ`: paths normalized to **repo-relative**
    (i.e., relative to the directory containing `.git`)
    before set comparison. Absolute paths captured by the
    dispatcher in any machine's local filesystem are
    transformed; CI and developer-machine captures produce
    identical manifests.
  - Tool names in `TOOLS_INVOKED` are the harness's canonical
    tool identifiers (e.g., `Bash`, `Read`, `Grep` — not
    `bash`, not `read`). Case-sensitive.

  **Verification.** Post-migration, capture the same
  manifest from a fresh `/init` invocation against the PR
  branch (skills/init/SKILL.md → AGENTS.md). The two
  manifests MUST satisfy:
  1. `PROTOCOL_SOURCE_HASH` identical (AGENTS.md unchanged).
  2. `TOOLS_INVOKED` identical as sets.
  3. `FILES_READ` identical as sets.
  4. Same number of `PARALLEL_BATCHES`; each batch's call
     set identical.
  5. Same `SEQUENTIAL_STEPS` ordering and call identity.

  Tool-output bodies are NOT compared — those are the
  non-deterministic part. The manifest captures structure
  only.

  Any divergence in (1)-(5) fails AC-9 and the migration
  does not land. The baseline artifact stays in the spec
  directory after merge so the deprecation PR (PR 2) can
  rerun the same comparison against its own `/init`
  invocation.

  **Why this shape.** Byte-identical is wrong because
  non-determinism would fail it spuriously. "Same set of
  tool calls" alone is too weak — it doesn't preserve the
  ordered structure AGENTS.md prescribes. The manifest's
  batched-set + ordered-sequential split preserves the
  meaningful structure (what the dispatcher did, in what
  order it matters) and discards the noise (timestamps,
  output bodies, within-batch order).

## Risk and mitigation

- **Risk.** Some spec body somewhere names `.claude/commands/`
  in a way the migration misses, leaving stale path text.
  *Mitigation:* the grep gate in AC-6 catches this. The
  AGENTS.md "self-extending" note about commands is the most
  likely candidate.
- **Risk.** The indexer walk gracefully handles missing
  `.claude/commands/` (it checks `dir.is_dir()` before
  walking), but if the directory is removed entirely, future
  command additions silently won't be hashed. *Mitigation:*
  keep the directory in place (empty) and keep the walk.
- **Risk.** A skill and a command of the same name in
  different scopes (project vs. user) interact via skill
  precedence. *Mitigation:* the user-scope `~/.claude/commands/`
  and `~/.claude/skills/` are outside this repo. The migration
  only touches project scope.

## Migration plan

**Two PRs, with a deliberate transition window between them.**

### PR 1 — migration (this spec)

Atomic landing of:

1. Spec amendments (101, 071). Spec 103 is not touched.
2. Indexer source change (union walk).
3. Ten skill directories under `.claude/skills/`. Nine
   contain verbatim SKILL.md copies of the former command
   bodies; `skills/init/SKILL.md` is a thin dispatcher that
   reads AGENTS.md.
4. AGENTS.md is preserved at the repo root unchanged. The
   protocol body lives there and only there.
5. `CLAUDE.md` doc updates (Extension Points bullet only;
   the AGENTS.md bullet is preserved).
6. Regenerated `.derived/codebase-index/index.json`.

After PR 1 lands, both `.claude/commands/` and `.claude/skills/`
exist. Claude Code's skill-over-command precedence means the
new paths win automatically; the legacy command files stay
inert but discoverable.

### Transition window

A minimum of one full week, or until the next routine merge
batch, whichever is longer. During the window, watch for:

- Any subagent or skill that names a `.claude/commands/` path
  in its body (would silently break if commands disappeared).
- Any external orchestrator (CI, hooks, IDE integrations)
  that lists or reads `commands/`.
- Any spec edit that resurrects a `commands/` reference.

### PR 2 — deprecation (follow-up)

Atomic landing of:

1. Delete the ten files under `.claude/commands/`. The directory is
   kept (empty, via `.gitkeep`) so the indexer walk root and any
   future single-file command remain hashed.
2. Repoint the four sibling specs whose typed relationship-graph
   edges targeted the migrated command files (the content moved
   verbatim to the skills surface):
   - **061** — `establishes:` on the deleted `implement-plan.md` is
     converted to a `references:` (role: historical) edge on
     `.claude/skills/implement-plan/SKILL.md`. Spec 182 (PR 1)
     already establishes that file, so 061 must not re-establish it.
   - **134** — `refines:` (`ci-fast-validation`) repointed to
     `.claude/skills/validate-and-fix/SKILL.md`.
   - **135** — `extends:` (wrapping) repointed to
     `.claude/skills/validate-and-fix/SKILL.md`.
   - **104** — `co_authority:` section claim (`process` anchor, shared
     with spec 000) and the SC-05 body references repointed to
     `.claude/skills/validate-and-fix/SKILL.md`.
   This spec amends 061/134/135/104 (see `amends:`); each carries an
   `amended:`/`amendment_record:` note. Without this step the deletion
   would orphan four live edges in the authority graph (surfaced by the
   spec-127/133 coupling gate, which PR 2's original plan had not
   anticipated).
3. Regenerate the codebase index (the file deletions change the
   hash set).
4. Update the doc surface that names `.claude/commands/` as the active
   command location: CLAUDE.md's Extension Points bullet,
   `docs/ARCHITECTURE.md`, `docs/CONTRIBUTING.md`, and the **Available
   Commands listing** in AGENTS.md. The AGENTS.md edit couples to
   spec 103 (which `refines:` AGENTS.md), so this spec also amends 103
   with a note scoping the change to the listing-path correction.

AGENTS.md's **protocol body** (`## New Sessions`) is **not** touched in
PR 2; only the stale path in its Available Commands listing is
corrected (`.claude/commands/` → `.claude/skills/`). 103's governed-reads
aspect (FR-01) and AGENTS.md's cross-agent protocol authority are
unchanged across both PRs.

The `commands/` walk entry in the indexer stays in place — if
a future contributor adds a single-file command for any
reason, it should still be hashed.

## Post-migration evolution

### 2026-06-10 — `/review-branch` retired, absorbed into `/code-review` v2

`.claude/skills/review-branch/` (established by this spec in the
ten-skill migration) is deleted. Its unique content — the
cross-platform portability checklist for the three-OS Tauri target —
moved into `/code-review`'s Stage 0 triage; the remaining ~70% of its
checklist overlapped `/code-review`'s finder dimensions and carried
web-app-template categories (N+1 queries, re-renders) with no referent
in this repo. `/code-review` was simultaneously restructured into a
staged adversarial form (decorrelated warm + cold finders, per-finding
refuters, declared-trade-offs ledger) after PR #317 demonstrated both
failure modes the split design had: author-rationale anchoring in
context-rich review, and hallucination in context-free review. The
skill count goes ten → nine plus the post-182 additions (`/ship`,
`/shepherd-prs`). The `establishes:` entries for the deleted paths are
removed from the frontmatter — the indexer flags dangling
`establishes:` as I-007/I-008 errors, so git history plus this section
are the record of their creation and removal, matching how prior
retirements kept the index diagnostics clean.

### 2026-06-16: setup + validate-and-fix skills updated for spec 188 Phase 4b

Spec 188 Phase 4b de-committed the broad codebase index (`.gitignore`-d, rebuilt
on demand) and retired the broad `codebase-indexer check` staleness gate. The two
skills this spec establishes that referenced that gate are updated accordingly:
`setup/SKILL.md` and `validate-and-fix/SKILL.md` now run `codebase-indexer
compile` (regenerate) rather than `check` (verify a committed artifact). No skill
contract changes; only the governed-read command each skill documents. Recorded
here because this spec owns those skill files.

## References

- Modern `.claude/` directory docs:
  <https://code.claude.com/docs/en/claude-directory>
- Skills docs: <https://code.claude.com/docs/en/skills>
- Precedent: spec **178-opc-directory-rename** (same pattern,
  same risk class, same amends-then-rename structure).
- Precedent: spec **105-scripts-to-binaries-migration** (a
  larger mechanical migration with the same multi-spec-amend
  shape).


## Drift cleanup amendment (2026-07-02)

Acknowledging the 2026-07-02 provenance cleanup in spec 178 (opc-directory-rename), which removed a stale reference to an ephemeral /tmp brief path that never existed in-repo. This note satisfies the spec 127 coupling gate for the co-authored spec.md path and does not change the skills-migration surface this spec governs.
