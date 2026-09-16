# Findings: how Codex stores and mutates state under ~/.codex

Observed 2026-09-09 on macOS (Darwin 25.5.0), Codex CLI 0.153.4 as bundled
by the Codex desktop app (`/Applications/ChatGPT.app/Contents/Resources/codex`,
build 26.903.61454), the desktop app running throughout. Instrument: an
`lstat` snapshot of every entry under `~/.codex` (size, mtime, inode, kind)
taken before and after each of three `codex exec --json` runs in a scratch
git repository, diffed; plus direct reads of the tree and read-only
`sqlite3` schema reads through the `immutable=1` URI form. Times below are
local. Every claim is tagged by how it was established:

- **[observed]**: directly captured by a snapshot diff or verified on disk
- **[decoded]**: read from existing artifacts (rollout archaeology, schema
  inspection, the CLI's help and string table)
- **[inferred]**: consistent with observations but not directly witnessed
- **OPEN**: unknown; do not treat surrounding text as an answer

The three captures (doc 03 §2): **C1** `--sandbox read-only`, a one-word
reply; **C2** `--sandbox workspace-write`, one shell command; **C3** an
invalid model, which failed. "Import residue" marks what only the desktop's
onboarding wrote: it imported every Claude Code transcript it found under
`~/.claude/projects` (fifty of them) as rollouts before any native session
ran.

Section headings are path patterns; `statecraft-sensor-codex explain <path>`
matches a path against them and appends the live event history from the
database.

---

## The session lifecycle (master timeline)

One `codex exec --json` in a fresh directory, C1 and C2 [observed]:

| when | event |
|---|---|
| start | `sessions/YYYY/MM/DD/rollout-<local ts>-<thread id>.jsonl` created with `session_meta` and the turn's context, then appended per item |
| start | `state_5.sqlite` gains a `threads` row (rollout path, cwd, source `exec`, sandbox policy, approval mode `never`); on C1 its `-wal` and `-shm` did not yet exist, on C2 they appeared |
| start | `thread_history_1.sqlite` created on C1 (the first native thread on this machine); `-wal` and `-shm` on C2 |
| start | `goals_1.sqlite-wal` and `-shm` created on C1, the WAL grew on C2 |
| start | `queue_1.sqlite-wal` grew |
| during | `logs_2.sqlite-wal` grew; `logs_2.sqlite` mtime moved without a size change (a checkpoint) |
| during | `models_cache.json` rewritten, same size, same inode |
| during | `cache/codex_apps_tools/<sha>.json` and `cache/codex_apps_server_info/<sha>.json` rewritten with new inodes (a replace) |
| during | every file under `.tmp/marketplaces/` and `plugins/cache/` re-stamped (mtime, and for the plugin cache new inodes) |
| C2 only | `config.toml` grew by one `[projects."<cwd>"] trust_level = "trusted"` table: the tool appended to the user's config |
| end | `memories_1.sqlite` mtime moved, size unchanged |
| end | `.tmp/` and `sessions/YYYY/MM/DD/` directory mtimes moved |

What survives: everything. Nothing observed was deleted at exit. `tmp/arg0/`
held one `codex-arg0<rand>/` shim directory from before the captures and
gained nothing during them; `shell_snapshots/` stayed empty [observed].
C3 (the failing run) still wrote its rollout and its `threads` row
[observed].

A fourth run, **C4**, was watched live by this sensor rather than diffed
(spec 115's acceptance smoke; 491 events in eleven seconds, none
unclassified). It added what a before-and-after diff cannot see: the
`tmp/arg0/codex-arg0<rand>/` shim directory is deleted and a fresh one
created at start (`.lock`, `applypatch`, `apply_patch`,
`codex-execve-wrapper`) and deleted again at exit, so a run leaves one
behind only when it did not exit cleanly; `thread-writer-locks/<thread id>.lock`
is created 0.3 s after start and deleted at exit; the rollout is created
about a second in and receives one large append at exit; `.tmp/git-<rand>/`
scratch checkouts and `.tmp/marketplaces/.staging/marketplace-upgrade-<rand>/`
are created and torn down mid-run (451 `marketplace` events); every WAL
in the root grows by one page at start and again at exit; `config.toml`
was not touched, because the directory was already trusted after C2
[observed C4].

## The config/state boundary

`config.toml`, `hooks.json`, `hooks/`, `AGENTS.md` and `skills/` are user
intent. Two of them are also written by the tool: `config.toml` receives
`[projects."<path>"]` trust tables when a directory is first run in (C2) and
`[hooks.state]` sha256 entries when a hook is trusted [observed for the
project table, decoded for the hook state from the file's contents]. The
sqlite family and `.codex-global-state.json` are machine-written runtime
state. `.codex-global-state.json` is rewritten by atomic replace with a
byte-identical `.bak` beside it [decoded: the two files have equal size and
content on disk; OPEN: no rewrite was captured because the desktop app,
not the CLI, owns it].

---

## `sessions/<yyyy>/<mm>/<dd>/rollout-<ts>-<id>.jsonl`

The transcript, one file per thread. `<ts>` is the local start time
(`2026-09-09T11-56-50`); `<id>` is the thread's UUIDv7, which is also the
`threads` primary key and the `thread_id` the `--json` stream announces
[observed C1]. Each line is `{"timestamp","type","payload"}`; `type` is
`session_meta` (first line: session id, cwd, originator `codex_exec`,
`cli_version`, `source` `exec`, `history_mode` `paginated`, the git commit
and branch, the base instructions in full, about 21 KB), `turn_context`,
`world_state` (the AGENTS.md text and the tool state), `response_item`
(`message` with `role` developer, user or assistant; `custom_tool_call` for
a shell command, whose `input` is a JavaScript call against `tools.exec_command`),
`event_msg` (`task_started`, `item_completed`, `token_count`,
`task_complete` with `last_agent_message` and `duration_ms`) and
`token_usage_record` [decoded C1, C2]. A trivial run is 15 lines and about
30 KB; a one-command run is about 70 KB [observed]. Imported Claude
sessions use the same envelope with `originator` `Codex Desktop` and
`source` `vscode`, and their `event_msg` items carry the imported text
(import residue). Appended as the thread runs; a shrink would be a
rewrite, which was never observed.

## `sessions/`

The transcript container. Directory mtimes under it move when a day's
first rollout is created [observed]. Nothing else lives here.

## `<name>_<n>.sqlite`

The runtime databases in the root, each with a numeric suffix that is a
schema generation, not a rotation index [decoded: each database holds a
`_sqlx_migrations` table]. Seen: `state_5.sqlite` (tables `threads`,
`projects`, `thread_sections`, `thread_artifacts`, `thread_dynamic_tools`,
`thread_spawn_edges`, `project_roots`, `project_idempotency_keys`,
`remote_control_enrollments`, `external_agent_config_imports`,
`backfill_state`, the rollout migration tables), `thread_history_1.sqlite`
(`thread_turns`, `thread_items`, `thread_realtime_items`, the projection
state; created by the first native thread, C1), `logs_1.sqlite` and
`logs_2.sqlite` (one `logs` table each; `logs_2` churns constantly),
`memories_1.sqlite` (`jobs`, `stage1_outputs`), `goals_1.sqlite`
(`thread_goals`, continuation deferrals), `queue_1.sqlite` (no tables yet)
[decoded]. The main file's mtime moves on checkpoint without a size change
[observed]; growth is a checkpoint that spilled pages. The sensor sees
these as files only and never opens them (spec 115 B-8).

## `<name>_<n>.sqlite-wal`

The write-ahead log of the database beside it. Created on the first write
after open, grows with every transaction, truncated or removed at
checkpoint [observed: `goals_1` and `state_5` gained theirs during the
captures; `logs_2`'s grew and was checkpointed]. A shrink here is routine
and not a signal.

## `<name>_<n>.sqlite-shm`

The shared-memory index for the WAL beside it, a fixed 32 KB [observed].
Appears with the WAL, changes without meaning.

## `sqlite/codex-dev.db`

The desktop app's own database (with `-wal` and `-shm` siblings), 4 MB
[observed on disk; its schema was not read]. The same three-file pattern
as the root databases.

## `.codex-global-state.json`

The desktop's persisted atom state: first-seen time, onboarding state, the
sidebar layout, the external-agent import selection and sync state
[decoded]. The analogue of `~/.claude.json`, but inside the root. OPEN:
the rewrite cadence; no rewrite fell inside a capture.

## `.codex-global-state.json.bak`

A byte-identical copy of the state file [decoded: equal size on disk].
[inferred] written before each rewrite, as a backup.

## `config.toml`

The user's configuration: `model`, `model_reasoning_effort`, the desktop's
`[desktop]` block, `[marketplaces.*]`, `[plugins.*]`, `[mcp_servers.*]`,
`[shell_environment_policy]`. The tool appends two kinds of table: `[hooks.state."<hooks.json>:<event>:<i>:<j>"]`
with a `trusted_hash` when a hook is trusted, and `[projects."<path>"]`
with `trust_level = "trusted"` when a directory is first run in [observed
C2: 4,033 to 4,183 bytes, same inode, the appended table verbatim]. A
size-only growth on the same inode is therefore the tool appending; a
replace is an editor or the desktop's settings flow.

## `hooks.json`

The hook table: `PreToolUse` with matchers over tool names and `SessionStart`
with `startup|resume`, the same shapes Claude Code uses [decoded]. Hooks
run only when their sha256 is in `config.toml`'s `[hooks.state]` or the
run passes `--dangerously-bypass-hook-trust` [decoded from `exec --help`].

## `hooks/`

The hook scripts `hooks.json` names [observed on disk: two Python scripts,
copies of the user's Claude hooks].

## `AGENTS.md`

The global instructions, read into every thread's `world_state` [decoded
C1]. On this machine a find-and-replace of the user's `CLAUDE.md` written
by the desktop's import (import residue).

## `skills/`

Skills, including a `.system/` set the app ships [observed on disk, 508 KB].
OPEN: when it changes.

## `plugins/`

The plugin store: `cache/<marketplace>/<plugin>/<version>/` checkouts,
`.remote-plugin-install-staging/`, `.plugin-appserver/`. Re-stamped with
new inodes on every run [observed C1, C2] and 316 MB on disk. A change
here is the app refreshing its cache, not the user.

## `.tmp/`

The app's scratch: `marketplaces/<name>/` git checkouts of each plugin
marketplace (6,842 files), `bundled-marketplaces/`, `plugins/`, and lock
files (`plugins.sync.lock`, `rollout-maintenance.lock`) [observed]. Every
file under `marketplaces/` is re-stamped on every run (1,451 diff lines per
capture), through a `marketplaces/.staging/marketplace-upgrade-<rand>/`
checkout and `git-<rand>/` scratch directories created and torn down
mid-run [observed C4]. Pure churn.

## `cache/`

`codex_apps_tools/<sha>.json` (1.1 MB, the served tool catalogue),
`codex_apps_server_info/<sha>.json`, `remote_plugin_catalog/`. The two JSON
files are replaced (new inode, same size) on every run [observed C1, C2].

## `auth.json`

The credentials: `auth_mode`, an `OPENAI_API_KEY` slot, the ChatGPT
`tokens`, `last_refresh` [decoded: keys only]. A secret; `peek` refuses it
(spec 115 B-4). OPEN: the refresh cadence.

## `installation_id`

One UUID, mode 644 [observed]. An identifier, not a secret.

## `models_cache.json`

The served model catalogue: `fetched_at`, `etag`, `client_version`, and
`models` with slug, visibility, reasoning levels and description [decoded].
Rewritten on every run with the same size and inode [observed C1, C2].

## `external_agent_session_imports.json`

The desktop's record of other agents' sessions it imported: per record the
source path under `~/.claude/projects`, its sha256, the imported thread id,
the import time and the title [decoded]. Import residue by definition.

## `vendor_imports/`

`skills-curated-cache.json` [observed on disk]. OPEN: what writes it.

## `computer-use/`

`Codex Computer Use.app`, a 70 MB application bundle the desktop installs
[observed]. Changes only on app update [inferred].

## `tmp/arg0/`

`codex-arg0<rand>/` shim directories the sandbox creates per exec, holding
`.lock`, `applypatch`, `apply_patch` and `codex-execve-wrapper` [observed
C4]. The previous run's directory is deleted and a new one created at
start, and the new one is deleted at clean exit [observed C4], so one left
on disk is the trace of a run that did not exit cleanly.

## `tmp/path/`

The shim `PATH` directory beside `arg0/` [observed on disk, empty].

## `shell_snapshots/`

Empty in every capture [observed]. [inferred] shell snapshots per thread,
as `<thread>.<nanos>.sh`, under the desktop's shell integration.

## `ipc/`

`ipc.sock`, the desktop's socket [observed].

## `thread-writer-locks/`

`.coordination.lock`, and `<thread id>.lock` for the running thread,
created 0.3 s after start and deleted at exit [observed C4]. A lock left
behind names a thread whose writer did not exit cleanly.

## `ambient-suggestions/`

One file per `<sha>` [observed, two on disk]. The desktop's suggestion
cache.

## `memories/`

Empty on disk since March [observed]; the memory system moved into
`memories_1.sqlite` [inferred].

## `.personality_migration`

A marker containing `v1` [observed]. Housekeeping.

## `.sandbox_migration`

A marker containing `v1` [observed]. Housekeeping.

## `.`

The root. Its mtime moves when a top-level entry appears, which C2 did
twice (the `state_5` and `thread_history_1` WAL siblings) [observed].
