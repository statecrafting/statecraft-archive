---
id: "184-claude-shared-config-governance"
slug: claude-shared-config-governance
title: "Claude Code shared config governance — .mcp.json and .claude/settings.json as hashed inputs"
status: approved
implementation: complete
owner: bart
created: "2026-05-25"
kind: amendment
shape: mechanism-add
risk: low
domain: tooling
authors:
  - "bart"
language: en
code_aliases:
  - MCP_CONFIG_PATH
  - CLAUDE_SETTINGS_PATH
amended: "2026-06-18"
amendment_record: |
  amended by spec 188 (2026-05-30, Phase 4a) — the guarantee's STORAGE
  moved, behavior bit-for-bit unchanged. The `claudeConfigHash` slice that
  Phase 3 placed at `build.claudeConfigHash` inside the broad `index.json`
  is re-homed to its own tracked file `.derived/codebase-index/config-hash.json`
  (index schema 2.3.0 → 3.0.0). `check-config` now reads that file. The
  PR-time blocking guarantee this spec installed is identical — same two
  files, same hash, same `ci-config-hash` gate — only the storage location
  changed, so the broad index carries nothing governed (spec 188 §Phase 4).
  AC-4/AC-7 below are unaffected: `make index` still regenerates the slice
  and `check-config` still trips on a quiet edit.

  amended by spec 188 (2026-05-30, Phase 3) — the PR-time blocking
  guarantee is RE-HOMED, not weakened. When 184 landed, the guarantee
  ("a quiet edit to .mcp.json / .claude/settings.json cannot merge
  unacknowledged") was enforced by the broad `codebase-indexer check`
  staleness gate. Spec 188 Phase 3 drops that broad check as a per-PR gate
  (the broad index becomes a best-effort cache), so the guarantee is now
  carried by a dedicated narrow gate: `codebase-indexer check-config`
  (spec 101 FR-12) verifies a `build.claudeConfigHash` sub-hash over ONLY
  these two files, wired as the constitutional `ci-config-hash` PR workflow.
  The behavioral guarantee is unchanged (still PR-time, still blocking);
  only the mechanism narrowed. The FR-009 "back door" (a healer silently
  absorbing config drift) is closed **by construction**: spec 188's
  direct-push heal was retired (incompatible with `main`'s PR-required +
  signed-commits protection), so nothing on `main` regenerates-and-commits
  the index — there is no healer that could absorb drift. AC-4 and AC-7
  below carry inline notes recording the mechanism change.

  amended 2026-06-18 by spec 217 (engine-swap collapse): the in-tree codebase-indexer that provided the config-hash slice (check-config) was deleted; that logic is now in spec-spine-core (`spec-spine index check --slice claude-config`). The codebase-indexer edge is stripped (path deleted); this spec's authority over the hashed inputs (.mcp.json, .claude/settings.json) survives.
amends:
  - "101-codebase-index-mvp"
# 217 deleted the in-tree codebase-indexer; the config-hash slice (check-config) is
# now in spec-spine-core (spec-spine index check --slice claude-config). The
# codebase-indexer/src/lib.rs edge is stripped (deleted); this spec's authority over
# the hashed inputs (.mcp.json, .claude/settings.json) survives below. Amended by 217.
establishes:
  - unit: { kind: file, path: .mcp.json }
  - unit: { kind: file, path: .claude/settings.json }
references:
  - role: precedent
    unit: { kind: file, path: specs/179-domain-frontmatter-field/spec.md }
  - role: precedent
    unit: { kind: file, path: specs/182-claude-skills-migration/spec.md }
summary: >
  Bring two sibling Claude Code shared config files into the
  spec spine's governed-input set: `.mcp.json` (team-shared
  MCP server config at the repo root) and
  `.claude/settings.json` (permissions, hooks, statusLine,
  outputStyle, env). Both are quiet configuration files that
  change Claude Code behavior across every team member who
  opens the repo — a quiet edit to either has team-wide
  consequences identical in effect to a Cargo.toml or
  workflow YAML change, but unlike those they pass the
  spec/code coupling gate invisibly because the indexer does
  not hash them. This spec amends the indexer
  (`tools/spec-spine/codebase-indexer/src/lib.rs`) to add
  both files to the `collect_input_files` walk, amends spec
  101's documented input set to enumerate them, and declares
  `establishes:` over both so they are authority-owned.
  Behavior is unchanged: existing MCP servers continue to
  start exactly as configured; existing permissions and hooks
  continue to apply unchanged. After this spec lands, any
  edit to either file trips the codebase-index staleness
  gate. This closes the self-governance gap for hooks that
  guard other hashed inputs — editing the PostToolUse hook
  glob in `.claude/settings.json` now itself trips the gate,
  not just the inputs the hook protects.
---

# Feature Specification: Claude Code shared config governance

## Purpose

Two Claude Code config files at the project root sit
silently outside the spec spine's governance perimeter today:

1. **`.mcp.json`** — team-shared MCP server config. Controls
   which Model Context Protocol servers Claude Code starts
   for every team member.
2. **`.claude/settings.json`** — permissions allow/deny,
   hooks, statusLine, outputStyle, env, model. The harness's
   safety net (permission deny list) and enforcement layer
   (hooks) live here.

A change to either has the same blast radius as a change to
a `Cargo.toml` dependency, a `package.json` script, or a
`.github/workflows/*.yml` job: it affects every team member
silently on next session start.

But unlike those files, neither is in the codebase-indexer's
hashed-input set today (spec 101). A quiet edit slips past
the staleness gate, the spec/code-coupling check, and the
broader spec-spine governance posture. By the constitutional
principle that "every change is bound to a spec," this is a
gap.

The `.claude/settings.json` case is particularly load-bearing
because **the hooks defined in it guard other hashed inputs**.
Today the PostToolUse hook glob enumerates the paths that
matter (Cargo.toml, package.json, specs/*/spec.md, etc.) and
fires the indexer-staleness check when they change. But the
hook glob itself lives in `.claude/settings.json` — outside
the hashed set. So a quiet edit to the hook glob can silently
narrow what the gate protects, without the gate noticing.
This is the self-governance gap that justifies pulling
`.claude/settings.json` into the same hashed-input set as
the files it guards.

This spec closes both gaps by:

1. **Amending spec 101** to enumerate `.mcp.json` and
   `.claude/settings.json` as hashed inputs.
2. **Adding both files to the indexer walk** via two
   conditional single-file blocks in
   `tools/spec-spine/codebase-indexer/src/lib.rs::collect_input_files`.
3. **Establishing authority** — this spec's `establishes:`
   frontmatter units declare spec 184 as the canonical owner
   of both files. Any subsequent spec that wants to expand
   or replace either file's semantics amends spec 184.

The change is mechanical and additive. No existing MCP
server configuration changes; no existing permission or hook
behavior changes. The first time the indexer runs after this
spec lands, the hash baseline updates to include both files'
current contents, and from that point forward any edit to
either is visible.

## Retroactive authority over existing contents

`.mcp.json` and `.claude/settings.json` both exist on disk
at the moment this spec lands, with content authored before
spec 184 had authority over them. This is a normal artifact
of governance arriving after implementation — common across
specs that retrofit governance onto an existing codebase
(spec 178's renaming of an already-checked-in directory is
the closest precedent in this repo).

This spec **explicitly takes the current contents of both
files as the baseline state** at the moment spec 184's
authority begins. The baseline is whatever both files
contain in the commit that lands spec 184 (or in the PR
that lands them under spec 184's authority, if both ship
together — see "Relationship to spec 182" for that
sequencing detail).

Implications:

- The indexer's first hash of each file after spec 184
  lands establishes the canonical baseline; subsequent
  edits are deltas against that baseline, governed by
  spec 184's authority.
- Spec 184 does not retroactively review or sanction the
  baseline content. The baseline is taken as-is. Future
  audit work that finds the baseline content imperfect
  (e.g., the still-wildcard `Read(**)` / `Edit(**)` /
  `Write(**)` in settings.json — see "Known gaps in the
  baseline" below) is governed by follow-up specs, not by
  spec 184.
- If spec 184 lands as `status: draft` first and the file
  contents are revised before the spec is promoted to
  `approved`, the revised contents become the baseline.
  Spec 184's authority begins at promotion-to-approved,
  not at draft-creation.

This pattern — "establishing authority over existing
reality" — is load-bearing across this repo's governance
posture and worth naming explicitly so future spec authors
have the precedent.

## Scope

In scope (single PR):

- Amend `specs/101-codebase-index-mvp/spec.md` to add both
  `.mcp.json` (project root) and `.claude/settings.json` to
  the documented input set. Honor the spec's amendment
  convention (`amended:` + `amendment_record:` per spec 000).
- Update `tools/spec-spine/codebase-indexer/src/lib.rs` so
  `collect_input_files` includes both files when present.
  Two conditional single-file blocks modeled on the existing
  adapter-scopes JSON pattern (around line 543) and the
  workflow-allowlist pattern. If either file is absent, the
  indexer skips it cleanly (both are optional; not every
  consumer of this codebase will commit them).
- Update `CLAUDE.md`'s Claude Code Extension Points section
  to note that both files are hashed inputs and edits trip
  the staleness gate.
- Regenerate `.derived/codebase-index/index.json` via
  `make pr-prep` and commit the regenerated artifact.

Out of scope (explicit):

- Changing the contents of either file. The axiomregent
  MCP server stays exactly as configured; the permission
  allow/deny and hook bodies in `settings.json` stay
  exactly as configured.
- Adding new MCP servers or new permissions in the same PR.
  Such changes should land in their own PRs so each diff is
  reviewable in isolation.
- Hashing user-scope variants: `~/.claude.json`,
  `~/.claude/settings.json`, `.claude/settings.local.json`.
  Those files are per-user and outside the project surface;
  `settings.local.json` is gitignored by design.
- Schema validation of either file's contents. The indexer
  hashes bytes, not structure. A separate spec could later
  add JSON Schema validation if needed; this spec is
  visibility-only.
- Hashing other root-level Claude Code files that may be
  added later (e.g., `.worktreeinclude`). Each such addition
  gets its own amendment-of-101 spec when the file is
  introduced. (`.worktreeinclude` is documented-as-absent in
  CLAUDE.md per the worktree-posture decision; it does not
  exist today.)

## Mechanical change list

1. **Spec 101 amendment**: add both `.mcp.json` and
   `.claude/settings.json` to whichever section of
   `specs/101-codebase-index-mvp/spec.md` enumerates the
   indexer's input set. Use the same shape as the existing
   single-file inputs (the workflow allowlist at
   `tools/codebase-indexer/workflow-allowlist.toml` is the
   closest precedent — single optional file, hashed if
   present).
2. **Indexer source change**
   (`tools/spec-spine/codebase-indexer/src/lib.rs`): add two
   blocks near the existing single-file hashing logic (the
   `adapter_scopes` block around line 543 is a good model).
   Each block pushes `repo_root.join(<path>)` onto the files
   vector if `is_file()`. Paths: `.mcp.json` and
   `.claude/settings.json`. Roughly ten lines total
   including the two conditionals.
3. **CLAUDE.md update**: in the "Claude Code Extension
   Points" section, extend the `.mcp.json` bullet and the
   `.claude/` bullet noting that both files are hashed by
   the codebase indexer per spec 184, so edits trip the
   staleness gate the same as Cargo.toml or workflow YAML
   edits. Note: editing the PostToolUse hook glob in
   `settings.json` itself now trips the gate, making
   hook-glob edits **visible** in the index diff (a
   reviewer must still judge whether the edit narrowed or
   broadened protection — see AC-7's caveat).
4. **Generated index regeneration**: run `make pr-prep` (or
   `./tools/spec-spine/codebase-indexer/target/release/codebase-indexer compile`)
   and commit the new `.derived/codebase-index/index.json`.

## Acceptance criteria

- **AC-1:** Spec 101 lists both `.mcp.json` and
  `.claude/settings.json` in its enumerated input set with
  the matching amendment frontmatter (`amended:`,
  `amendment_record:`).
- **AC-2:** The indexer source diff at
  `tools/spec-spine/codebase-indexer/src/lib.rs` adds (does
  not replace) two blocks: one hashing `.mcp.json` if present
  at the repo root, one hashing `.claude/settings.json` if
  present.
- **AC-3:** `./tools/spec-spine/codebase-indexer/target/release/codebase-indexer dump-inputs`
  (or equivalent) lists both files among the hashed inputs
  when they exist at their expected paths.
- **AC-4:** After the PR lands, editing **either** file and
  running `codebase-indexer check` exits non-zero (the
  staleness gate now sees the edit). Editing the file and
  then running `make index` followed by `check` exits zero
  (clean regeneration round-trips). This test passes for
  both files independently.
  > **Amended by spec 188 Phase 3 (2026-05-30):** the *required PR-time*
  > mechanism is now `codebase-indexer check-config` (narrow, this slice
  > only), wired as `ci-config-hash`; the broad `check` referenced above is
  > no longer a required PR gate (the broad index is a best-effort cache).
  > The round-trip property holds identically
  > for `check-config`: editing either file then `make index` makes
  > `check-config` exit zero, and editing without regenerating makes it
  > exit non-zero — independently of any other input's freshness.
  > **Phase 4a (2026-05-30):** `check-config` reads the re-homed
  > `.derived/codebase-index/config-hash.json` rather than the broad index's
  > `build.claudeConfigHash`; the round-trip property is identical (`make
  > index` writes that file too).
- **AC-5:** `.derived/codebase-index/index.json` in the PR
  carries both content hashes; `git diff` shows the index
  changed because the input set grew by two entries.
- **AC-6:** `spec-code-coupling-check` against `origin/main`
  reports no orphaned paths. Spec 184 cites the indexer
  source change; the indexer source change is referenced by
  spec 184.
- **AC-7 (self-governance loop made visible — NOT closed):**
  Editing the PostToolUse hook glob in
  `.claude/settings.json` (e.g., adding or removing a path
  pattern) trips `codebase-indexer check`. Verify by adding
  a harmless extra pattern, running the check, observing
  non-zero exit. **What this AC does NOT prove**:
  content-hashing makes hook-glob edits *visible* in the
  index diff, but it cannot detect whether the edit
  *narrowed* the protected set vs. *broadened* it — both
  produce a hash change. A reviewer reading the diff must
  judge intent. Closing the loop fully (structural detection
  of protection narrowing) requires a separate small tool
  that parses the case statement and enumerates the
  protected path classes; that is a follow-up spec, not
  spec 184's scope. AC-7 is the visibility gate, not the
  narrowing gate.
  > **Amended by spec 188 Phase 3 (2026-05-30):** the visibility gate is
  > now carried by `codebase-indexer check-config` on every PR (the
  > constitutional `ci-config-hash` workflow), not the broad `check`.
  > Editing the PostToolUse hook glob still trips it (the glob lives in
  > `.claude/settings.json`, which is in the narrow slice). The "visible,
  > not narrowing" caveat is unchanged — a reviewer still judges intent.

## Risk and mitigation

- **Risk.** A repo that does not commit either file (the
  common case for many forks or downstream consumers) sees
  no behavioral change. The indexer's `is_file()` guard on
  both blocks makes inclusion conditional. *Mitigation:* none
  required — the indexer is already defensive about optional
  inputs (see the `process-stages` walk, the workflow-
  allowlist, the adapter-scopes JSON).
- **Risk.** The first commit that lands this spec changes
  the index hash for repos that have either file today (i.e.,
  this one). Anyone with a pending PR against `main` will
  see a merge-time staleness flag. *Mitigation:* the
  staleness flag is expected and resolvable by rebasing and
  rerunning `make index` — same rebase friction as any
  indexer input change.
- **Risk.** Future MCP server additions and permission/hook
  changes will trip the staleness gate, which is the desired
  behavior but may surprise contributors who don't realize
  these files are now hashed. *Mitigation:* the CLAUDE.md
  note added in this spec documents the relationship; the
  gate's own error message points at the regeneration
  command.
- **Risk.** A churn-heavy contributor (frequent permission
  experiments via `settings.local.json` mistakenly committed
  as `settings.json`) trips the gate constantly.
  *Mitigation:* `settings.local.json` is gitignored by Claude
  Code's design; the documented workflow is "experiment in
  local, promote to settings.json when stable." The gate
  surfacing churn is feature, not bug — it makes the
  promotion event reviewable.
- **Risk (JSON whitespace fragility).** The indexer hashes
  files byte-for-byte. An editor reformatting
  `.claude/settings.json` or `.mcp.json` (e.g., a different
  prettier config, a re-indent, normalized line endings)
  trips the staleness gate even when JSON semantics are
  unchanged. This produces gate noise on routine edits.
  *Mitigation:* The indexer must NOT special-case whitespace
  — hook command bodies inside `settings.json` are
  whitespace-sensitive shell strings; a "smart" hash that
  ignores whitespace would silently allow shell-command
  drift. The correct fix is contributor discipline:
  **edit `settings.json` and `.mcp.json` in place; do not
  reformat them**. Add a note to CLAUDE.md and consider an
  `.editorconfig` entry that pins indentation for these two
  files to whatever the current baseline uses.

## Known gaps in the baseline

The current baseline content of `.claude/settings.json`
(taken as-is per "Retroactive authority over existing
contents" above) contains gaps that this spec does NOT
address. They are documented here so future spec authors
have the starting list:

- **File-tool wildcards still broad.** The current allow
  list contains `Read(**)`, `Edit(**)`, `Write(**)`,
  `MultiEdit(**)` — these were not narrowed in the same
  pass that narrowed the `Bash(...)` patterns. File-tool
  blast radius is larger than Bash blast radius (a single
  `Edit` can rewrite any file in the tree), so the gap
  matters. A follow-up spec would either narrow these to
  specific path globs or add a `deny:` list for sensitive
  paths (e.g., deny `Edit(**/credentials.*)`,
  `Edit(**/secret*)`, `Edit(**/.env*)`).
- **MCP tool catch-all.** `mcp__*` allows every MCP tool
  invocation. Now that `.mcp.json` is governed, narrowing
  this to specific MCP tool patterns is a reasonable
  follow-up.
- **`Agent(*)` is unbounded.** Subagent invocations have
  their own internal tool restrictions, but the harness-
  level allow is still wide-open. Worth a separate spec
  decision on whether per-subagent-name patterns make
  sense (`Agent(architect)`, `Agent(reviewer)`, etc.).

These gaps are **accepted as the current safety posture**.
Tightening them is governed by follow-up specs. A specific
note on the file-tool wildcards: `Write(**)` combined with
`defaultMode: acceptEdits` means the harness can silently
overwrite any file in the tree without prompting. That is
a meaningful posture choice — not just paperwork omission —
and the choice was made deliberately during the permission-
narrowing pass (Bash patterns got the attention; file-tool
patterns were left for a follow-up). Spec 184 records the
posture; future specs revisit it.

## Baseline evolution record

First and subsequent content evolutions of the governed files
under spec 184's authority are recorded here, dated. Each entry
is the reviewer-facing intent declaration AC-7 calls for: the
hash gate proves the edit happened; this record declares its
direction.

### 2026-06-10 — hooks rework: guard-glob broadened, automation layers added

First content edit to `.claude/settings.json` since the
baseline was taken at the spec-184 landing PR (#247; the
baseline content itself dated from #234, which pre-dated
this spec's authority). `.mcp.json` is untouched. Direction
judgment per AC-7: **broadened**, on two axes.

1. **Guard glob broadened.** The PostToolUse staleness-check
   glob now includes `.claude/settings.json` and `.mcp.json`
   themselves — the in-file guard previously enumerated every
   hashed input *except* the two files this spec governs. The
   prompt-time guard now matches the PR-time `ci-config-hash`
   surface instead of lagging it.
2. **Automation layers added** (no existing guard removed or
   narrowed):
   - **SessionStart** — recompiles the spec registry on every
     session start, resume, and clear, and reports index
     freshness into session context. The registry is a
     gitignored cache; spec 103 FR-06 already mandates this
     recompile at `/init` — the hook extends the same
     guarantee to sessions where `/init` is not run.
   - **PreToolUse pr-gate** — on `gh pr create`, runs
     `make pr-prep`; blocks on a coupling failure unless a
     `Spec-Drift-Waiver` is inline in the PR body at creation,
     and blocks when pr-prep regenerates
     `.derived/codebase-index/` uncommitted (a broader local
     mirror: uncommitted drift anywhere in that directory's
     tracked files, which includes the `config-hash.json`
     slice that `ci-config-hash` gates).
   - **PreToolUse golden-prep** — commands containing
     `UPDATE_GOLDEN` get a registry recompile first (a stale
     registry yields silently-wrong goldens).
   - **PostToolUse** — edits to `specs/*/spec.md` trigger an
     immediate registry recompile, followed by the
     pre-existing index staleness check; the staleness check
     alone fires for every other hashed input (manifests,
     workflows, `.claude/**`, schemas).
   - **Stop** — upgraded from staleness *warning* to
     auto-heal via `make index` (write path goes through
     make so a stale indexer binary cannot write a poisoned
     hash; skipped during any active rebase, merge, or
     cherry-pick — the hook stays out of in-progress git
     operations entirely, and `index.json` conflicts
     specifically are owned by the spec-188 merge driver).

   Companion judgment layer: the `/ship` skill
   (`.claude/skills/ship/SKILL.md`, currently unclaimed by
   any spec) sequences gate → review → commit → PR so the
   hooks act as the deterministic net, not the workflow.

The known-gaps list above (file-tool wildcards, `mcp__*`,
`Agent(*)`) is unchanged by this edit and remains the
accepted posture pending follow-up specs.

### 2026-06-10 (second edit) — permissions slimmed to project-specific surface

Operator edit, same PR. Direction judgment per AC-7: the
**project-level allow surface narrowed sharply**. The generic
allows (cargo/npm/git/gh, shell utilities, `Read(**)` /
`Edit(**)` / `Write(**)` / `MultiEdit(**)`, `mcp__*`,
`Agent(*)`, `defaultMode: acceptEdits`) were removed from the
project file and re-homed to user-global settings
(`~/.claude/settings.json`), leaving only the repo-specific
binary-path allows (`./tools/**`, `./crates/**`,
`./target/**` release/debug binaries) and a publish/release
deny set (`cargo/npm/pnpm publish`, `gh release *`,
`gh repo delete/archive`).

Two consequences recorded honestly:

1. The "Known gaps in the baseline" list above is overtaken
   at project scope — the file-tool wildcards, `mcp__*`, and
   `Agent(*)` allows no longer exist in this file. Whether
   equivalent allows (and the destructive-ops denies that
   also left: `rm -rf`, force-push, hard-reset patterns) now
   live in user-global settings is **outside this spec's
   visibility** — the spec governs the project file only.
   The project-level guard narrowed; the effective per-user
   posture is no longer fully auditable from the repo. That
   trade was made deliberately: generic permissions belong
   to the operator, repo-specific surface to the repo.
2. Empty hook-event arrays (`UserPromptSubmit`,
   `PermissionRequest`, `ConfigChange`, `PreCompact`, etc.)
   were added as explicit scaffolding. No behavioral effect;
   they enumerate the available extension points so future
   hook additions are diff-visible against a named slot.

### 2026-06-10 (third edit) — SessionStart matcher widened to compaction

The session-freshness hook's matcher grows from
`startup|resume|clear` to `startup|resume|clear|compact`.
Direction judgment per AC-7: **automation coverage broadened;
no guard surface changed**. Rationale: compaction summarizes
the session context, so the freshness line injected at session
start can be summarized away while registry/index state drifts
mid-session. SessionStart is exempt from the stale-replay
behavior of mid-session hook output on resume — it re-runs on
every firing — and the `compact` matcher extends that same
re-injection guarantee to the post-compaction context window.
The hook command body, the permission arrays, and every other
hook event are byte-identical to the second-edit state.

## Follow-up tooling (not in this spec)

Two pieces of tooling are out of scope but worth naming so
future specs have the precedent:

1. **Permission smoke test** — a curated command list that
   should run cleanly without permission prompts. Run
   whenever the allow list narrows. Bakes the
   "classifier-accept ≠ verified" check into a repeatable
   artifact instead of a fresh-session ritual.

   **Execution surface (the design pitfall).** Claude Code's
   permission prompts go to an interactive surface — a
   standalone shell script running from outside Claude Code
   cannot observe them. The smoke test cannot be a plain
   `.sh` file invoked from the terminal. Three viable shapes:

   - **`/permission-smoke-test` skill** — runs inside a
     Claude Code session, dispatches the curated commands
     itself, infers prompt-occurrence from harness signals.
     Most native, requires the harness to expose the right
     observation hooks.
   - **External harness scripting Claude Code** — a script
     that drives a Claude Code session via its CLI/IDE
     interface, captures stdout/stderr, parses for
     prompt-indicating patterns. Possible but fragile to
     prompt-format changes.
   - **Manual checklist** — a CLAUDE.md or skills/-bundled
     checklist of "run these N commands in a fresh session,
     observe zero prompts." Lowest tech, no automation, but
     honest about the constraint.

   The follow-up spec would pick one. The "shell script"
   framing in earlier drafts of this spec was wrong because
   it didn't grapple with this execution-surface constraint.
2. **Structural hook-glob lint** — a tool that parses the
   `case` patterns in `.claude/settings.json`'s
   PostToolUse hook command, enumerates the protected
   path classes, and warns when a diff reduces the
   protected set. Closes AC-7's caveat: not just visible
   but *direction-aware*. Same level of effort as a small
   tools/oap/* binary.

Both are good candidates for the next governance pass once
the four-PR sequence introducing spec 184 lands.

## Relationship to spec 182

Spec 182 (claude-skills-migration) and spec 184 are
**independent** amendments to spec 101's indexer input set.
They can land in either order; both extend the input set
additively. Spec 182 adds `.claude/skills/**/*.md`; spec 184
adds `.mcp.json` and `.claude/settings.json`. If both land,
spec 101 receives two amendments and the indexer's
`collect_input_files` grows in three places (one directory
walk, two single-file blocks). Neither blocks the other.

A natural co-landing is fine but not required. If both land
together, the indexer change is one PR diff with three
additions; spec 101 receives two amendment frontmatter
updates in the same PR.

## References

- Spec **101-codebase-index-mvp** — the codebase-indexer
  whose input set is being extended.
- Spec **160** (factory adapter scopes JSON inclusion) — the
  precedent for adding a single optional root-relative file
  to the indexer walk.
- Spec **179-domain-frontmatter-field** — the precedent for
  `kind: amendment` + `shape: mechanism-add` spec shape.
- Spec **182-claude-skills-migration** — sibling amendment
  of spec 101, lands independently.
- Modern `.mcp.json` docs:
  <https://code.claude.com/docs/en/mcp>
- `.claude/` directory docs:
  <https://code.claude.com/docs/en/claude-directory>


## Security hardening amendment (2026-07-02)

Narrowed the Bash execute allowlist off the broad ./target/release/* and ./target/debug/* globs to the specific certificate binaries actually invoked, reducing the set of freshly built binaries that run without a permission gate.

Recorded during the cross-subsystem security-hardening sweep; couples the security fixes in the code paths this spec authors to their owning spec per the spec 127 coupling gate.
