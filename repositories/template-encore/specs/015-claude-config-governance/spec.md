---
id: "015-claude-config-governance"
title: "Claude Code shared config governance: .mcp.json and .claude/settings.json as hashed inputs"
status: approved
created: "2026-06-10"
owner: bart
kind: governance
domain: agentic
risk: low
implementation: complete
depends_on: ["000-bootstrap"]
code_aliases: ["CLAUDE_CONFIG"]
summary: >
  Team-shared agentic configuration — .mcp.json (MCP servers) and
  .claude/settings.json (permissions, hooks) — is governed content: both
  files are hashed index inputs via spec-spine.toml's [index]
  extra_hashed_inputs, so a quiet edit to either is visible as index
  staleness on the PR. Files are edited in place, never reformatted (hook
  bodies are whitespace-sensitive shell strings).
establishes:
  - ".mcp.json"
  - ".claude/settings.json"
---

# 015 — Claude Code shared config governance: .mcp.json and .claude/settings.json as hashed inputs

## 1. Purpose

Two Claude Code configuration files at the project root govern the agentic
environment for every team member who opens this repository:

- **`.mcp.json`** — team-shared MCP server configuration. Controls which
  Model Context Protocol servers Claude Code starts in each session.
- **`.claude/settings.json`** — permissions allow/deny list, hooks,
  `statusLine`, `outputStyle`, `env`, model. The harness's safety net and
  enforcement layer live here.

A quiet edit to either file has the same blast radius as a change to a
`package.json` script or a `.github/workflows/*.yml` job: it affects every
team member on next session start. This spec places both files under the
spec-spine's governance perimeter by listing them as hashed index inputs,
so any edit is visible as index staleness on the next PR.

## 2. Territory

This spec owns `.mcp.json` and `.claude/settings.json`. The `.claude/skills/`
and `.claude/agents/` surfaces are owned by spec `014-claude-skills`. The
hashing mechanism itself is governed by the `spec-spine.toml` `[index]`
section (spec `000-bootstrap`).

## 3. Behavior

### FR-01: Both files are hashed index inputs

`spec-spine.toml`'s `[index] extra_hashed_inputs` MUST include the `.claude/**`
glob (which covers `.claude/settings.json`) and `.mcp.json` as a standalone
entry. After this configuration is in place:

- Editing either file and running `npx spec-spine index check` MUST exit
  non-zero.
- Regenerating the index (`npx spec-spine index`) and re-running the check
  MUST exit zero.

### FR-02: Edit-in-place discipline

Both files MUST be edited in place. They MUST NOT be reformatted by
auto-formatters (Prettier, editor auto-indent, line-ending normalizers, or
similar). The reason is not cosmetic: hook command bodies inside
`.claude/settings.json` are whitespace-sensitive shell strings. A "smart"
hasher that ignores whitespace would silently allow shell-command drift while
reporting no change. Because the indexer hashes bytes, editor reformatting
trips the staleness gate on a semantically unchanged file. The correct
workflow is: edit the specific value that needs to change; leave surrounding
whitespace intact.

### FR-03: Self-governance loop

The PostToolUse hook glob in `.claude/settings.json` enumerates the paths
the harness watches for staleness. Because `.claude/settings.json` is itself
a hashed input, a quiet edit to the hook glob is now visible in the index
diff. A reviewer reading the diff MUST judge whether the edit narrowed or
broadened the protected path set — content-hashing surfaces the change, it
does not classify its direction.

### FR-04: User-scope files are excluded

The per-user files `~/.claude.json`, `~/.claude/settings.json`, and the
project-local `.claude/settings.local.json` are outside the governed surface.
`settings.local.json` is gitignored by Claude Code's design; only the
committed project-scope files are governed.

### FR-05: Governing existing content

Both files existed before this spec declared authority over them. The current
contents of both files at the commit that establishes this spec are the
baseline. This spec does not retroactively review baseline content; it governs
all subsequent edits as deltas against that baseline.

## 4. Acceptance criteria

- **AC-1:** `spec-spine.toml` contains `.mcp.json` in `extra_hashed_inputs`
  and `.claude/**` (or an equivalent glob covering `.claude/settings.json`)
  in the same list.
- **AC-2:** Editing `.mcp.json` and running `npx spec-spine index check` exits
  non-zero. Running `npx spec-spine index` followed by `npx spec-spine index
  check` exits zero.
- **AC-3:** Editing `.claude/settings.json` and running
  `npx spec-spine index check` exits non-zero. Running `npx spec-spine index`
  followed by `npx spec-spine index check` exits zero.
- **AC-4:** The committed `.derived/codebase-index/by-spec/015-claude-config-governance.json`
  index shard maps both files as owned, hashed inputs, so editing either trips
  `npx spec-spine index check`.
- **AC-5:** `npx spec-spine couple --base origin/main` exits 0 with this spec,
  both governed files, and the updated index in the same diff.

## 5. Out of scope

- Changing the current contents of either file. The existing MCP server
  configuration and the existing permission allow/deny and hook bodies stay
  exactly as configured; changes to their content land in their own PRs.
- Schema validation of either file's contents. The index hashes bytes. A
  separate spec may later add JSON Schema validation.
- Hashing the user-scope or local-override variants (see FR-04).
- Narrowing the `Read(**)` / `Edit(**)` / `Write(**)` file-tool wildcards or
  the `mcp__*` catch-all currently in `.claude/settings.json`. Those are
  accepted as the current safety posture and are tracked for future refinement
  under a separate spec.

## 6. Design notes

The self-governance property is the key motivation: the PostToolUse hook in
`.claude/settings.json` guards the other hashed inputs (it fires the index
staleness check when a watched file changes). Keeping the hook glob outside
the hashed set would mean a quiet narrowing of what the hook protects could
slip past the gate. Adding `.claude/settings.json` to the hashed set closes
that gap: the hook now guards itself.
