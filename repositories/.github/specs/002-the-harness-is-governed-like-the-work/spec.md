---
id: "002-the-harness-is-governed-like-the-work"
title: "The harness is governed like the work"
status: approved
implementation: complete
created: "2026-09-11"
summary: >
  The agent harness (the cross-agent session protocol, the Claude Code skills
  and agents, the hooks and permission policy, the composite gate, and the CI
  workflow that runs it) is what an agent is permitted to do in this
  repository. It is therefore governed by a spec of its own, its files are
  folded into the index's global-inputs hash, and an edit to any of them
  without an edit to this spec is refused by the coupling gate as `C-001`.
origin:
  retroactive: true   # the kit was installed before the spec claimed it
depends_on:
  - "000-bootstrap"
establishes:
  - { kind: file, path: "AGENTS.md" }
  - { kind: file, path: "CLAUDE.md" }
  - { kind: file, path: ".claude/settings.json" }
  - { kind: directory, path: ".claude/skills/" }
  - { kind: directory, path: ".claude/agents/" }
  - { kind: file, path: ".mcp.json" }
  - { kind: file, path: "Makefile" }
  - { kind: file, path: ".github/workflows/govern.yml" }
  - { kind: directory, path: ".githooks/" }
---

# 002: The harness is governed like the work

## 1. Purpose

An ungoverned harness is a hole straight through the governance. If a session
can widen its own permission allow-list, drop a hook, or rewrite the gate
command list without any of that showing up as drift, then every guarantee the
rest of the corpus offers is a guarantee about the config that happened to be
in place when nobody was looking.

So the harness is claimed here, and the claim has teeth in two independent
ways. The coupling gate refuses a change to a claimed file that does not move
with its spec. The index folds these files into the global-inputs hash, so an
edit to any of them stales every shard in the ledger until the trees are
regenerated and committed, which makes the edit impossible to land quietly.

## 2. Territory

| Unit | What it is |
| --- | --- |
| `AGENTS.md` | The cross-agent session-init protocol, read by Claude Code, Codex CLI, Cursor and Copilot under the AAIF/Linux Foundation standard. The single source for the init protocol and for the gate command list. |
| `CLAUDE.md` | The Claude Code project overview: layer model, conventions, the pointers into the rest. |
| `.claude/settings.json` | The hooks and the permission allow-list. |
| `.claude/skills/` | The ten skills of the governed loop. |
| `.claude/agents/` | The four pipeline agents. |
| `.mcp.json` | The MCP server declaration. Empty here; a server added to it is a new tool an agent can reach, which is a harness change. |
| `Makefile` | The composite gate: `make gate` read-only, `make refresh` writing, `make verify SPEC=<id>`. |
| `.github/workflows/govern.yml` | The CI workflow that runs the same chain a session runs locally, on a push to the default branch and on every pull request. |
| `.githooks/` | The opt-in merge driver for the committed shard trees. |

The four standing rules under `.claude/rules/` are deliberately **not** here.
They belong to `000-bootstrap`, because they are what an agent loads in order
to be able to work at all, including the work of changing this spec. See 000 3.

## 3. Behavior

### 3.1 The skills stay byte-identical to the kit

Every `SKILL.md` is repository-invariant. The project layer (the binary
invocation, the version pin, the gate command list, the never-touch artefacts)
lives in `AGENTS.md` and in the path-scoped rules, and each skill ends with a
`## Project layer` section naming what it reads from where.

That is a maintenance property, not a style preference: it makes a kit update a
copy rather than a merge. A skill edited in place to encode something about
this repository has to be re-reconciled by hand at every upgrade, forever.

The loop is eight skills, plus the two it calls:

| Skill | Role |
| --- | --- |
| `/prime` | Execute the `## New Sessions` protocol in `AGENTS.md`. Reads only. |
| `/setup` | One-time contributor setup; installs the pinned binary and verifies the loop. |
| `/next` | Name the next work order from `registry plan`, minus drafts. Reads only. |
| `/build <id>` | One spec start to finish: preflight, branch, flip, implement, gate, verify, flip complete. |
| `/verify <id>` | Run the spec's `## Verification` block through `spec-spine verify`. |
| `/ship` | Gate, review, conventional commit, push the branch, open the PR. |
| `/shepherd` | Watch the PR's checks by head sha, classify, remediate, merge, confirm on disk. |
| `/spec` | Author a new spec at the next free ordinal, born `draft`. |
| `/commit` | Called by the loop: a conventional commit with the spec ordinal as scope. |
| `/code-review` | Called by the loop: review the working diff for drift and illegitimate mid-build spec edits. |

### 3.2 The hooks read; they do not write

The one sanctioned write is the registry recompile that follows an edit to a
`spec.md`, which is the compiler doing its own job on its own input.

| Event | What it does |
| --- | --- |
| `SessionStart` | Report registry and index freshness. |
| `PostToolUse` | Recompile the registry after a `spec.md` edit; check index staleness after an edit to a hashed input. |
| `PreToolUse` | Refuse a push to the default branch; block `gh pr create` on a stale index, uncommitted shards, or a red coupling gate without an inline `Spec-Drift-Waiver:`. |
| `Stop` | Report freshness again. |

Every hook acts on the repository the command targets, and says so when it
skips. A hook that repaired the tree would hide the defect it exists to find.

### 3.3 The hashed-input globs track the territory

`spec-spine.toml [index] extra_hashed_inputs` lists the harness files above, by
narrow pattern. The globs are narrow on purpose: a bare `.claude/**/*` would
fold in `.DS_Store` and `settings.local.json` and make the shard hashes
machine-dependent.

The glob form is the trap. `dir/**` matches directories and therefore no files;
every pattern in that list ends in a filename or in `/*`.

**Two lists, and they have to agree.** `extra_hashed_inputs` decides what
actually stales the ledger. The `case` statement in the `PostToolUse` hook
decides what an agent is *told about* the moment it edits one. A path in the
first and not the second stales the index silently, and the session finds out
at `gh pr create` instead of at the edit; a path in the second and not the
first produces a staleness warning for a file that stales nothing. Both lists
carry this repository's own additions (`README.md`, `profile/README.md`,
`.gitignore`, `.gitattributes`, `.githooks/*.sh`) and neither carries the
kit's `docs/design/` glob, because there is no such directory here.

### 3.4 A waiver is a human instrument

`Spec-Drift-Waiver:` needs explicit human approval and is cited in the pull
request body. A driven session never writes one on its own authority, and
`/shepherd` treats a coupling refusal whose only remedy is a waiver as CRITICAL:
it consumes no remediation round and goes to a human with its evidence.

### 3.5 The gate has one definition

`AGENTS.md` under "Working the backlog" is the definition. `make gate` runs the
read-only form of exactly that chain. A step CI enforces that the list omits is
a step every session skips, so the two stay identical or the drift is a defect
in this spec.

**CI runs that chain by two routes, and the reason is the waiver.** On a push
to the default branch `govern.yml` calls `make gate`. On a pull request it
spells the same four verbs inline, because `couple` there needs `--pr-body`,
and a body carrying a `Spec-Drift-Waiver:` line has no safe shell quoting: it
goes to a file, and a file has no quoting at all. The inline chain is the
`Makefile`'s `gate` recipe verb for verb, plus that one flag. Those are the two
copies that have to stay in step, and the acceptance below checks both against
the same verb list.

Because this corpus carries no code, the language halves of the `Makefile` and
of `govern.yml` are clean no-ops. They are guarded on a **manifest probe**, not
a command probe: a machine with `cargo` installed and no `Cargo.toml` is the
specify-first case, and probing for the tool answers the wrong question.

### 3.6 One deviation from the kit, in one line, recorded here

The kit's `gate` target and CI job both run `spec-spine index coverage
--fail-on-untraced`. Here the flag is dropped from both, and `[coupling]
require_ownership` is off to match.

The ownership ratchet walks the source files under a discovered package. A
manifest probe is what discovers one, and this repository has no manifest, so
the flag exits 1 reporting that it verified nothing rather than exiting 0
(spec 080: a gate that cannot ask says so). Keeping it would turn every gate
run red for a reason unrelated to any change under review, which is how a gate
teaches people to ignore it.

The read itself stays, unflagged, because its output is still the honest
answer: "no source files under any discovered package". Restore the flag, and
the config key with it, on the day this repository gains a manifest.

The skills are untouched by this. Each conditions the flag on `[coupling]
require_ownership`, which is off, so they already agree with `AGENTS.md`
without a single byte edited (3.1).

## 4. Out of scope

- The four standing rules: `000-bootstrap`.
- A domain-specialist agent. There is no framework here to specialise in.
- The merge driver's per-clone registration. `.githooks/` is owned here, but
  whether a given clone runs `enable-merge-driver.sh` is that clone's business
  and is recorded nowhere in the corpus.

## 5. Acceptance

Editing `.claude/settings.json` without editing this spec fails `spec-spine
couple` with `C-001`.

## Verification

```verify:cli
test -f AGENTS.md
test -f CLAUDE.md
test -f .claude/settings.json
test -f .mcp.json
test -f Makefile
test -f .github/workflows/govern.yml
test -x .githooks/enable-merge-driver.sh
# 3.1: ten skills and four agents, and no skill the loop does not call.
test "$(ls .claude/skills | wc -l | tr -d ' ')" = "10"
test "$(ls .claude/agents | wc -l | tr -d ' ')" = "4"
test -f .claude/skills/prime/SKILL.md
test -f .claude/skills/shepherd/SKILL.md
# 3.2: all four hook events are declared.
grep -qF '"SessionStart"' .claude/settings.json
grep -qF '"PostToolUse"' .claude/settings.json
grep -qF '"PreToolUse"' .claude/settings.json
grep -qF '"Stop"' .claude/settings.json
# 3.3: the harness files are hashed inputs, and no glob ends in the dead form.
grep -qF '".claude/settings.json",' spec-spine.toml
grep -qF '".claude/skills/*/SKILL.md",' spec-spine.toml
! spec-spine config show | grep -qE '"[^"]*\*\*"'
# 3.3: the hook's glob list carries this repository's own additions, and not
# the kit's docs/design glob.
grep -qF '*/.githooks/*.sh' .claude/settings.json
grep -qF '*/README.md' .claude/settings.json
grep -qF '*/.gitattributes' .claude/settings.json
! grep -qF 'docs/design' .claude/settings.json
# 3.5: the gate is one chain, and CI runs the Makefile rather than a second copy.
grep -qF 'Working the backlog' AGENTS.md
# 3.5: both CI routes exist, and the inline one is the Makefile recipe verb for
# verb. Compare the two lists directly rather than trusting either prose.
grep -qF 'make gate' .github/workflows/govern.yml
sed -n '/^gate:/,/^$/p' Makefile | sed -n 's/^\t$(SPEC_SPINE) \([a-z][a-z ]*\).*/\1/p' > "$TMPDIR/ss-make-verbs.txt"
sed -n '/Governed loop (pull request)/,/^$/p' .github/workflows/govern.yml | sed -n 's/^ *spec-spine \([a-z][a-z ]*\).*/\1/p' > "$TMPDIR/ss-ci-verbs.txt"
test -s "$TMPDIR/ss-make-verbs.txt"
diff "$TMPDIR/ss-make-verbs.txt" "$TMPDIR/ss-ci-verbs.txt"
# 5: the acceptance criterion, executed. Editing the harness without editing
# this spec is refused; editing both together is not.
printf '.claude/settings.json\n' > "$TMPDIR/ss-harness.txt"
! spec-spine couple --paths-from "$TMPDIR/ss-harness.txt"
spec-spine couple --paths-from "$TMPDIR/ss-harness.txt" 2>&1 | grep -qF 'C-001'
printf '.claude/settings.json\nspecs/002-the-harness-is-governed-like-the-work/spec.md\n' > "$TMPDIR/ss-harness-coupled.txt"
spec-spine couple --paths-from "$TMPDIR/ss-harness-coupled.txt"
# 3.6: the flag is gone from the Makefile, from CI and from the config, and the
# unflagged read is still there. The verb's own exit codes are the evidence:
# unflagged answers 0, flagged refuses rather than implying a clean answer.
# Recipe lines only: both files mention the flag in the comment that explains
# why it is gone, and a bare grep would read that explanation as the defect.
! grep -qE '^\t.*--fail-on-untraced' Makefile
! grep -qE '^ *spec-spine .*--fail-on-untraced' .github/workflows/govern.yml
grep -qE '^\t\$\(SPEC_SPINE\) index coverage$' Makefile
grep -qE '^ *spec-spine index coverage$' .github/workflows/govern.yml
spec-spine config show | grep -qE 'require_ownership *= *false'
spec-spine index coverage
! spec-spine index coverage --fail-on-untraced
```
