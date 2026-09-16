---
id: "118-codex-harness"
title: "The Codex harness: the governed kit's second face, generated from the first, with its gate proven in a driven session"
status: approved
created: "2026-09-09"
implementation: complete
risk: medium
depends_on:
  - "109-governed-harness"
  - "116-codex-driver"
  - "117-project-driver"
establishes:
  - ".codex/hooks.json"
  - { kind: directory, path: ".codex/agents/" }
  - { kind: directory, path: ".agents/skills/" }
  - "scripts/codex-kit.py"
extends:
  # 109 owns the harness: AGENTS.md gains the Codex paragraph, the Makefile a
  # target, spec-spine.toml the two new hashed trees.
  - { spec: "109-governed-harness", unit: "AGENTS.md", nature: additive }
  - { spec: "109-governed-harness", unit: { kind: section, file: "Makefile", anchor: "codex-kit" }, nature: additive }
  - { spec: "110-corpus-merge", unit: "spec-spine.toml", nature: additive }
  # 116 owns the Codex driver: its argv gains the hook-trust flag (B-4).
  - { spec: "116-codex-driver", unit: { kind: symbol, id: "statecraft_driver_codex::Codex" }, nature: additive }
  - { spec: "116-codex-driver", unit: { kind: symbol, id: "statecraft_driver_codex::tests" }, nature: additive }
  - { spec: "116-codex-driver", unit: "members/src/members/driver-codex.test.ts", nature: additive }
references:
  - { unit: { kind: file, path: "docs/design/03-the-codex-provider.md" }, role: context }
summary: >
  The last spec of doc 03's plan (D40). A driven Codex session reads
  AGENTS.md, which is already the cross-agent protocol, finds skills
  under .agents/skills and agents under .codex/agents, and runs hooks
  from .codex/hooks.json. The desktop app's import wrote stale copies
  of all three into this checkout, unclaimed; this spec replaces them
  with a kit generated from the governed Claude kit by one script, so
  the two faces cannot drift: every skill byte-identical, every agent
  the same body in Codex's TOML shape, and the four hooks the same
  commands with two documented substitutions, because Codex exports no
  project-dir variable and delivers the project root as cwd on stdin
  instead. Two facts captured while designing it decide the rest.
  Codex's hook wire is Claude's (hook_event_name, tool_name Bash,
  tool_input.command, exit 2 with stderr to block), so the PR gate
  ports unchanged. And a project's hooks run only when trusted, else
  they are skipped with nothing on the stream, so the Codex driver
  passes the hook-trust bypass: for a session the orchestrator drives
  over a governed checkout, the hooks are the guard, and a flag that
  makes them run adds enforcement rather than removing it. The
  acceptance is the driven session doc 03 D40 asked for: a Codex
  session in a fixture checkout attempts gh pr create and the PR gate
  refuses it, observed on the stream once rather than inferred.
---

# 118: The Codex harness

## 1. Purpose

Spec 109 made the harness a governed unit so the loop a driven session
runs is the loop CI runs. A second provider needs the same kit in its
own shape, and the shape is nearly the same: Codex reads the same
`AGENTS.md`, the same `SKILL.md` files from a different directory, agent
definitions as TOML instead of Markdown frontmatter, and hooks in a
`hooks.json` whose wire is Claude's. What must not happen is a second
copy maintained by hand: 109 D-1 made agents a project-layer derivation
and skills a verbatim copy, and this spec keeps both properties by
generating the Codex face from the Claude one and refusing a checkout
where they differ.

## 2. Territory

Owned: `.codex/hooks.json`, `.codex/agents/` (four TOML files),
`.agents/skills/` (ten `SKILL.md` files) and `scripts/codex-kit.py`, the
generator with a `--check` mode.

Extended: `AGENTS.md` (a Codex paragraph under Available Commands), the
`Makefile` (a `codex-kit` target), `spec-spine.toml` (the two trees join
the hashed inputs so an edit stales the index), the Codex driver's argv
and its tests (B-4).

Not claimed: the user's `~/.codex` (observed, never written); `.codex/`
files the desktop app may add later (a project `config.toml`), which
would be discovered unclaimed by the ratchet.

## 3. Behavior

- **B-1 (skills, verbatim).** `.agents/skills/<name>/SKILL.md` is a
  byte-identical copy of `.claude/skills/<name>/SKILL.md` for every skill
  109 claims. A skill exists in one place and is copied, never edited on
  the Codex side; the `allowed-tools` frontmatter Codex does not read is
  carried anyway, because a divergent frontmatter is a second copy.
- **B-2 (agents, the same body in TOML).** `.codex/agents/<name>.toml`
  carries `name` and `description` from the Markdown frontmatter and the
  Markdown body, unchanged, as `developer_instructions` in a literal
  multi-line string. The `tools` and `model` keys have no Codex
  counterpart and are dropped; the project layer lives in the body and
  survives whole.
- **B-3 (hooks, the same commands with two substitutions).**
  `.codex/hooks.json` carries the four hooks of `.claude/settings.json`
  (the PR gate on `gh pr create`, the recompile after a spec edit, the
  session freshness line, the stop-time index repair) with the same
  matchers and the same commands, each wrapped once by the generator:
  the stdin JSON is read into a variable, `CLAUDE_PROJECT_DIR` is
  exported from its `cwd` field (Codex delivers the project root there
  and exports no variable), and the original command runs unchanged as
  a function fed that same JSON, so its own `jq` reads and its exit
  status (a blocking `exit 2` included) are what they were. The
  PostToolUse staleness pattern list gains the Codex kit's own paths.
- **B-4 (hooks run, by decision).** The Codex driver's argv gains
  `--dangerously-bypass-hook-trust`, after the sandbox flag and before
  the model. Without it a project's hooks are skipped silently (the
  capture in doc 03 §6 and this spec's status note), which would make the
  PR gate absent in exactly the sessions that need it. The flag runs
  hooks the checkout declares; the checkout is governed, its hooks are a
  claimed unit gated by `couple`, and the orchestrator drives only
  registered projects (025), which is the vetting the flag's own help
  text asks for.
- **B-5 (the generator).** `scripts/codex-kit.py` writes the three trees
  from the Claude kit; `--check` exits 1 and names every file that
  differs from what it would write, without writing. `make codex-kit`
  runs the writer. The generator is Python 3 with no dependencies, the
  interpreter the hooks already assume.
- **B-6 (the trees are hashed).** `.codex/**/*` and `.agents/**/*` join
  `[index] extra_hashed_inputs`, so an edit to either stales the index
  and the harness's shard, as an edit to `.claude/**` does.
- **B-7 (AGENTS.md says so).** A paragraph under Available Commands
  names the Codex face: where the skills and agents are, that they are
  generated (`make codex-kit`, checked by the spec's verification), and
  that a driven Codex session runs its hooks by B-4.

## 4. Functional requirements

- **FR-001.** `scripts/codex-kit.py --check` exits 0 on the committed
  tree; after any edit to a generated file or its source it exits 1 and
  names the file.
- **FR-002.** The Codex driver's crate test and the members' test assert
  the new argv element at its position for both postures.
- **FR-003.** The generated `hooks.json` parses; each command begins
  with the wrapper and derives `CLAUDE_PROJECT_DIR` from `cwd`; the PR
  gate's command, run by hand with the captured PreToolUse JSON on stdin
  (a `gh pr create` in a checkout whose gate fails), exits 2 with
  `[pr-gate] BLOCKED` on stderr.

## 5. Acceptance

- `python3 scripts/codex-kit.py --check` exits 0; `make gate`, the cargo
  gates and the members suite are green.
- The driven session (D40), recorded in the status note: a fixture git
  checkout carrying this spec's `.codex/hooks.json` and a `spec-spine.toml`
  whose gate fails, driven by `statecraft-driver-codex` through 043's
  seam with the prompt "run exactly: gh pr create ...", shows the PR
  gate's refusal on the stream and `gh pr create` never runs; the same
  session without B-4's flag shows the command run unrefused. The
  observed shape of a refusal on the stream is recorded so 116's table
  can be checked against it.

## Verification

```verify:cli
python3 scripts/codex-kit.py --check
```

```verify:cli
cargo test --workspace --locked -p statecraft-driver-codex
```

```verify:cli
cd members && bun test src/members/driver-codex.test.ts
```

## Status (2026-09-09)

Implemented. The generator replaced the desktop's import (fifteen files:
ten skills byte-identical, four agents, one hooks file; the import's
stale `init` skill removed as not generated), and `--check` passes on the
committed tree. FR-003 by hand: a clone of this checkout on a branch that
edits `src/main.rs` without its spec, the generated PR gate fed the
captured PreToolUse JSON with `gh pr create` and no project-dir variable
in the environment, exited 2 with `[pr-gate] BLOCKED: a committed shard
tree is stale`. The driven session (D40): `statecraft-driver-codex
session run` over that fixture, bypass posture, fast tier, asked to run
`gh pr create --title t --body b`; the stream carried the refusal as the
agent's own message, `Command blocked by PreToolUse hook: [pr-gate]
BLOCKED: ...`, the driver's stderr tail carried Codex's
`ERROR codex_core::tools::router: error=Command blocked by PreToolUse
hook`, and `gh` never ran. The control run without the flag ran
`gh pr create` unrefused (it failed on the fixture's remote, not on the
gate). What the shape tells 116's table: a hook refusal ends the turn as
`turn.completed`, so the session classifies `completed` by 014 B-4's
first rule and the refusal is read from the stream and the journal's
`resultTextTail`, not from the classification; the table's
`hook-blocked` rule would match this text only on a turn that fails,
which is how the Claude driver behaves over the same rule order.

## 6. Out of scope

A project-level `.codex/config.toml`. Codex's own permission rules
(`.rules` files). The Cursor face. Changing any skill's or agent's text
(that is 109's, and the kit update procedure's).

## 7. Resolved decisions

D-1 (2026-09-09). Born approved on doc 03 §7's authority (115 D-1).

D-2 (2026-09-09). Generated, not imported. The desktop's import wrote a
five-skill kit from an older revision with `.Codex/rules/` artifacts;
adopting it would have made the Codex face a fork on day one. The
generator makes drift a check failure instead of a review finding.

D-3 (2026-09-09). The hook-trust bypass is passed by the driver, not
recorded by the operator in `[hooks.state]`. The alternative needs a
hash per hook per checkout in the user's config, re-done on every edit
to `hooks.json`, and a driven session that silently lost its gate when
someone forgot. The flag is one line, and what it enables is a claimed,
gated unit.

D-5 (2026-09-09). The hook commands are wrapped, not rewritten. The
first draft of B-3 rewrote each `jq` read and each project-dir
reference; the wrapper leaves the Claude command byte-identical inside
a function, which is what lets a fix to a Claude hook reach Codex
without a second edit, and is what `--check` compares.

D-4 (2026-09-09). `hooks.json` is generated too, not hand-maintained,
even though the substitutions are only two. A hand copy is where a
fixed Claude hook stops reaching Codex.
