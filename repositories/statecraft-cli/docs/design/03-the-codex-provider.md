# The Codex provider: a second universe and a second driver over the same cores

Date: 2026-09-09. Input: direct reads of `~/.codex` on the machine this
family runs on (the tree, `config.toml`, `hooks.json`, `AGENTS.md`, the
sqlite schemas read through `sqlite3 -readonly` with `immutable=1`, the
rollout files under `sessions/`), the Codex CLI bundled with the desktop
app (`/Applications/ChatGPT.app/Contents/Resources/codex`, `codex-cli
0.153.4`, its `exec --help` and its string table), three live captures of
`codex exec --json` run under a before-and-after `lstat` snapshot of the
whole tree, and this repository's crates and members as they stand after
spec 114. This document continues `02-the-monorepo-and-the-rust-sequence.md`
and takes up the sentence its §11 ends on: a Codex sensor is a `Universe` and
a rule table, a Codex driver is a `Provider`, and the one engine change is a
per-project driver choice. Claims cited here were measured on disk on the
date above; §9 lists what was not.

Decision numbering continues the sequence: 02 owns D24-D30, this document
owns D31 onward.

## 1. The method, and why it is the same one

Specs 001-008 were written over a sensor that had already run for weeks
against `~/.claude`, and the table in `classify.ts` is a transcription of
`FINDINGS.md`, the evidence file that records what each path in that tree
turned out to mean. The table is only as good as the observation behind it,
which is why 003 makes `unclassified` a loud first-class outcome rather than
an error: a path the table does not know is a Claude Code behavior the
observation had not seen.

The same method applies to `~/.codex`, with one difference that matters. The
Claude tree was observed as it filled up under ordinary use. The Codex tree
on this machine is a day old, and fifty of its fifty-three sessions are not
Codex sessions at all: the desktop app's onboarding imported every Claude
Code transcript under `~/.claude/projects` and re-encoded each one as a
rollout (`external_agent_session_imports.json` records the source path, the
sha256 and the imported thread id of each). That residue is useful in
exactly one way: it shows the rollout envelope and the `threads` table
populated at scale. It says nothing about what a native session writes,
and the three captures in §2 are what does.

- **D31 (evidence before table):** the Codex classification table is
  transcribed from a FINDINGS file that records observed writes, one entry
  per path family, each entry citing the capture that produced it. A rule
  with no observation behind it is not written; the path lands in
  `unclassified` until it is seen. This is 003 B-2 applied to a tree that
  has barely been observed, and it is what keeps the table honest on the
  day the Codex CLI changes its layout.

## 2. What `~/.codex` is

The tree has three layers that the Claude tree keeps in two.

**User intent.** `config.toml` (model, reasoning effort, the desktop's
settings, marketplaces, plugins, MCP servers, the shell environment policy,
and two things the tool itself appends: `[hooks.state]`, a sha256 per
hook that records the user's trust, and `[projects."<path>"]` with a
`trust_level` per directory the user has run in), `hooks.json` and
`hooks/` (the same hook shapes Claude Code uses, `PreToolUse` and
`SessionStart` with matchers), `AGENTS.md` (the global instructions, here a
find-and-replace of the user's `CLAUDE.md`), `skills/`, `plugins/` and
`.tmp/marketplaces/` (git checkouts of plugin marketplaces, 6,842 files on
this machine, rewritten wholesale on every launch).

**Runtime state, in sqlite.** Where Claude Code keeps one JSON file
(`~/.claude.json`) and rewrites it atomically, Codex keeps a family of
sqlite databases in the root, each named `<name>_<generation>.sqlite` where
the numeric suffix is a schema generation and not a rotation index:
`state_5.sqlite` (`threads`, `projects`, `thread_sections`,
`external_agent_config_imports`, the rollout migration tables),
`thread_history_1.sqlite` (`thread_turns` and `thread_items`, created on
the first native session), `logs_1.sqlite` and `logs_2.sqlite`, `memories_1.sqlite`,
`goals_1.sqlite`, `queue_1.sqlite`, and the desktop's own
`sqlite/codex-dev.db`. Each has a `-wal` and a `-shm` sibling that appear,
grow, and are truncated at checkpoint, so a shrink is routine here and must
not carry the loud label 003 gives a transcript that shrank. One JSON state
file survives: `.codex-global-state.json`, the desktop's persisted atom
state, with a byte-identical `.bak` beside it; it is rewritten by atomic
replace, which makes it the analogue of `~/.claude.json`, but it sits
inside the root rather than beside it.

**Transcripts.** `sessions/YYYY/MM/DD/rollout-<UTC timestamp>-<thread id>.jsonl`,
one file per thread, appended as the thread runs. The envelope is
`{timestamp, type, payload}` with `type` one of `session_meta` (once,
first: session id, cwd, originator, `cli_version`, `source`, the git
commit and branch, the base instructions in full), `turn_context`,
`world_state`, `response_item` (the model-facing items: `message`,
`custom_tool_call`, `function_call`, `reasoning`), `event_msg`
(`task_started`, `item_completed`, `token_count`, `task_complete`) and
`token_usage_record`. The thread id is a UUIDv7, so the filename sorts by
creation time; the timestamp in the name is the session's start in local
time while `session_meta.timestamp` is UTC. The `threads` row in
`state_5.sqlite` holds the rollout path, the sandbox policy and approval
mode the thread ran under, its token total and its first user message.

**Secrets and identifiers.** `auth.json` holds the auth mode, an API key
slot and the ChatGPT tokens; it is a secret and `peek` must refuse it
outright rather than mask it. `installation_id` and the `[hooks.state]`
hashes are identifiers, not secrets. `models_cache.json` is the served
model catalogue with an etag; it is rewritten on every launch with the
same size.

**Noise with no Claude analogue.** `tmp/arg0/codex-arg0<rand>/` (shim
directories per sandboxed exec), `shell_snapshots/` (empty in every
capture), `ipc/ipc.sock`, `thread-writer-locks/`, `ambient-suggestions/<sha>`,
`cache/codex_apps_*` (rewritten each launch), `vendor_imports/`,
`computer-use/` (a 70 MB app bundle) and the migration markers
`.personality_migration` and `.sandbox_migration`.

### The three captures

Each capture snapshotted every entry under `~/.codex` with `lstat` (size,
mtime, inode, kind), ran one `codex exec --json` in a scratch git
repository, snapshotted again, and diffed.

| Capture | Prompt | What changed |
|---|---|---|
| 1, `--sandbox read-only` | "Reply with the word pong" | one rollout (15 lines), `thread_history_1.sqlite` created, `state_5.sqlite` (a `threads` row), `goals_1` and `queue_1` WALs grew, `logs_2` WAL grew, `memories_1` mtime, `models_cache.json` rewritten same size, `cache/codex_apps_*` rewritten, the plugin cache re-stamped, all of `.tmp/marketplaces` re-stamped (1,451 diff lines) |
| 2, `--sandbox workspace-write`, one shell command | "echo hi > note.txt, then say done" | the same set, plus `config.toml` grew by one `[projects."<path>"] trust_level = "trusted"` table, and `state_5` and `thread_history_1` gained WAL and SHM siblings |
| 3, `-m no-such-model-xyz` | "pong" | a rollout was still written; stdout carried an `item.completed` of type `error`, then `error`, then `turn.failed`; exit 1 |

Capture 2 is the one to remember: a non-interactive run edited the user's
config file. Under a sensor, that is a `config` event caused by the tool,
not by the user, and the table labels it as such rather than pretending
every write to `config.toml` is an edit.

- **D32 (the Codex universe):** the observed root is `$CODEX_HOME`, else
  `~/.codex`, recursive, with no sibling state file: the state file the
  core's `Universe` names is `.codex-global-state.json` inside the root,
  displayed by its relative name. The ignore rule is the Claude one
  (`.DS_Store`, editor litter) plus nothing: the marketplace checkouts and
  the app bundle are classified as what they are (`marketplace`,
  `bundle`) and left to the table, because hiding them at the walker would
  hide the day they change shape. The read-only invariant (001 B-7) binds
  the Codex sensor exactly as it binds the Claude one; `sqlite` is read,
  when it is read at all, through the immutable URI form so that no WAL is
  ever created by the observer.

- **D33 (the kind vocabulary is shared where the meaning is shared):** the
  Codex table reuses a 003 kind wherever the same downstream consumer would
  key on it (`transcript`, `config`, `hook-file`, `plugin`, `cache`,
  `state-file`, `state-backup`, `daemon`, `root`, `unclassified`) and
  introduces kinds only for things the Claude tree does not have
  (`sqlite`, `sqlite-wal`, `sqlite-shm`, `marketplace`, `bundle`,
  `shim`, `secret`, `identity`, `import`). A consumer that counts
  transcripts across providers gets one answer.

## 3. The stream `codex exec --json` writes

The driver's parser reads stdout, not the rollout, and the stream is
smaller than Claude's. Every line is `{"type": ...}`:

| Event | Fields | The 014 boundary it maps to |
|---|---|---|
| `thread.started` | `thread_id` | `system/init`: the session id |
| `turn.started` | none | |
| `item.started`, `item.completed` | `item: {id, type, ...}`; types seen: `agent_message {text}`, `command_execution {command, aggregated_output, exit_code, status}`, `error {message}` | streamed verbatim; the last `agent_message` is the result text |
| `turn.completed` | `usage: {input_tokens, cached_input_tokens, cache_write_input_tokens, output_tokens, reasoning_output_tokens}` | `result` with `is_error: false` |
| `turn.failed` | `error: {message}` | `result` with `is_error: true` |
| `error` | `message` | folded into the result's text when `turn.failed` follows |

There is no cost field anywhere; the driver journals `totalCostUsd` as
null and never prices tokens from `models_cache.json`. There is no turn
count; `numTurns` is null. The prompt is read from stdin when the
positional argument is `-`. The final message is also available through
`--output-last-message <file>`, which the driver does not use because the
stream already carries it and the driver owns no scratch file.

The invocation maps onto 032's posture as follows. `bypass` is
`--dangerously-bypass-approvals-and-sandbox`. `guarded` is `--sandbox
workspace-write`; Codex has no tool allowlist, so the profile's lists
cannot be honoured and the driver says so. `--model` is `-m`. `--max-turns`
has no counterpart; the core's wall-clock deadline is the only cap. MCP
configuration is per-server `-c mcp_servers.<name>.*` overrides rather
than a file, and a strict set would need `--ignore-user-config`, which
also drops `[hooks.state]` and with it every hook's trust. Color is
`--color never`. Hooks run only when their sha256 is in `[hooks.state]` or
`--dangerously-bypass-hook-trust` is passed.

- **D34 (the Codex driver's tier is `basic`, and it names what it lacks):**
  the manifest declares `capabilityTier: "basic"` and the driver's
  `session.init` extras carry `degraded: ["tool-allowlist", "max-turns",
  "cost"]` whenever the request asked for one of them. The engine already
  refuses `mcpConfigPath` against a `basic` driver (043 B-6) and journals
  `driver.degraded`; the other three are journaled by the driver in the
  same spirit (01 D22): a session that ran without a turn cap says so in
  the journal, never silently.

- **D35 (`codex exec` on stdin, never a shell):** argv is
  `exec --json --color never -C <repo> [posture] [-m <model>] -`, the
  prompt on stdin and closed. `codex` is not on `PATH` on this machine
  (the desktop app bundles it), so the binary is `STATECRAFT_CODEX_BIN`,
  else `codex`, and a missing binary is a driver failure (exit 1) with the
  path it looked for, not a classification.

- **D36 (the termination table comes from the binary's own vocabulary):**
  the rule table transcribes strings found in the 0.153.4 binary and in
  capture 3: auth (`Not logged in`, `codex login`, `unauthorized`, `Auth
  required`, `access token could not be refreshed`, 401), quota (`You've
  hit your usage limit`, `usage_limit_exceeded`, `rate_limit_exceeded`,
  `rate limit exceeded`, 429; the reset form is `Try again at <time>`),
  hook-blocked (`blocked by PreToolUse hook`, `Blocked by hook`, `blocked
  by policy`), transient (`stream disconnected`, `server_overloaded`,
  `http_connection_failed`, `response_stream_connection_failed`,
  `Reconnecting`, 502, 503). `context_window_exceeded` and
  `session_budget_exceeded` have no 014 kind and classify as `crashed`
  with the message as detail; they are candidates for a kind of their own
  once observed live. No native quota, auth or hook refusal has been
  captured yet, and 014 D-9's mechanism (journal the unmatched tail) is
  how the table grows.

## 4. Where the transcript is

Claude's transcript path is a pure function of the repo and the session id.
Codex's is not: the filename carries the local start time, which the driver
does not know from the thread id alone. The driver resolves it after the
session by globbing `$CODEX_HOME/sessions/*/*/*/rollout-*-<thread id>.jsonl`
and returns the one match, or null. It never opens `state_5.sqlite` for
this, because a driver that reads the provider's database is a sensor
concern dressed as a driver one, and because the sqlite read would be
against a database the running `codex` still holds open.

- **D37 (attribution through the thread id):** joining a sensor event to a
  driven session goes through the thread id the driver saw in
  `thread.started`, which is also the suffix of the rollout filename and
  the primary key of the `threads` table. The Codex table's `transcript`
  label carries the thread id's first eight characters, as 003 B-5 does
  for Claude's session id, so the two join on the same key.

## 5. The engine's one change

043 B-5 finds `statecraft-driver-<name>` by name and B-8 lets
`STATECRAFT_DRIVER_BIN` override it, but every production call site asks
for the default name, `claude`. Doc 02 §11 nominated 032's profile as the
home for the choice, and that is where it goes.

- **D38 (the driver is part of the posture):** an execution profile gains
  an optional `driver` field (`"claude"` or `"codex"`, default `"claude"`
  when absent, so every existing chain folds unchanged). It is registry
  state like `mode`, set through the same `project.profile.set` record,
  journaled in the session intent like the rest of the profile (032 B-5),
  and rendered on every surface that shows the posture (032 B-6). The
  engine passes it to `createProcessDriver({name})` at each of the four
  production sites, and nothing else in the engine learns the word
  `codex`. A driver name whose member cannot be discovered fails the
  session as `crashed` with the three locations searched (043 B-5), which
  is the existing behavior, now reachable.

- **D39 (the profile's lists are provider-relative, and say so):** the
  guarded baseline tool list in `profile.ts` names Claude tools. It is not
  renamed or moved; a Codex driver receives it on the wire and declares in
  its degradation list that it could not apply it. Making the posture
  vocabulary provider-neutral is a larger design (a capability grammar
  both providers map onto) and is deferred until a second guarded provider
  exists to design it against.

## 6. The harness on the Codex side

A driven Codex session reads `AGENTS.md`, which is already the cross-agent
protocol (109), and finds skills under `.agents/skills/<name>/SKILL.md`
and hooks under `.codex/hooks.json`. The desktop app's import wrote both
into this checkout from the Claude kit, unclaimed and unreviewed, with the
find-and-replace artifacts the import leaves (`~/.Codex/hooks`,
`Codex.ai/code/session`). Two facts change what the kit must be on this
side. Hooks only run when trusted, so the PR gate a driven session relies
on (017) is silently absent in a checkout whose `.codex/hooks.json` hash
is not in the user's `[hooks.state]`. And Codex exports no
`CLAUDE_PROJECT_DIR`, so a hook script that resolves the project root
from that variable resolves it to `.`.

- **D40 (the Codex kit is claimed, and its gate is proven, not assumed):**
  `.codex/` and `.agents/skills/` become governed units of a spec of their
  own, derived from the Claude kit by the same rule 109 uses for agents
  (the project layer re-applied, nothing copied blind). Its acceptance is
  a driven Codex session in a fixture checkout that runs the governed loop
  and is refused by the PR gate hook, so that hook-blocked is observed
  once rather than inferred. Until that spec lands, the imported files are
  not part of the repository.

## 7. The spec plan

| Step | Spec | Lands |
|---|---|---|
| The Codex universe | 115 | this document, `crates/statecraft-sensor-codex` with its FINDINGS, the three seams the core needed (a state file inside the root, a peek deny list, an OpenAI key pattern in the redactor) |
| The Codex driver | 116 | `crates/statecraft-driver-codex`, and in the core the three hardcodes 114 left (`error_max_turns`, the forced `reference` tier, the `observatory` usage string) opened as `Provider` methods |
| The driver choice | 117 | the `driver` field of the profile, threaded through the four spawn sites, set and shown by the CLI and the API, proven by driving the Rust Codex driver from the TypeScript engine |
| The Codex harness | 118 | `.codex/` and `.agents/skills/` as governed units, the hook-trust and project-root facts handled, one driven session refused by the gate |

Each spec is born approved on this document's authority, as 043 and 110
through 114 were on doc 02's, because the person who owns the corpus asked
for the sequence to run to completion in one instruction and the decisions
are recorded here rather than left to the sessions. Each is built, shipped
and shepherded as its own pull request in the governed loop.

## 8. Where this stands (2026-09-09)

Recorded the day the sequence ran, as doc 02 §11 was.

| Step | Spec | Landed as |
|---|---|---|
| The Codex universe | 115 | `statecraft-sensor-codex` over the core, FINDINGS with four captures, three core seams (state file inside the root, `never_peek`, the OpenAI key rule); 491 live events, none unclassified (#23) |
| The Codex driver | 116 | `statecraft-driver-codex`, `basic` tier with the degradations declared; three `Provider` defaults and the `try again` reset form in the core; the real Codex driven through the seam (#24) |
| The driver choice | 117 | `profile.driver`, `--driver` on both verbs, `via codex` in the posture cell, the profile-following facade at the daemon's spawn site, parity kept in the Rust profile and the 111 fixture (#25) |
| The Codex harness | 118 | `.agents/skills`, `.codex/agents`, `.codex/hooks.json` generated from `.claude/` by `scripts/codex-kit.py`; the hook-trust bypass in the driver's argv; the PR gate observed refusing a driven session (#26) |

Two of §9's open questions closed on the way. A project's hooks are
skipped silently without trust (118's control run), which is why D40's
flag is in the driver. A hook refusal ends a Codex turn as
`turn.completed`, so it classifies `completed` and is read from the
stream and `resultTextTail`; the `hook-blocked` rule fires only on a turn
that fails, which is 014 B-4's order and the Claude driver's behavior
too. What is still open: a native quota or auth refusal on the `--json`
stream has not been seen, and D36's table waits on the first one.

What "Codex-ready" now means, concretely: register a project with
`--profile guarded --driver codex` and the scheduler drives it with the
Rust Codex driver, its sessions journal `profile.driver: "codex"` and
`degraded: ["cost"]`, the Codex sensor classifies what those sessions
write under `~/.codex`, and the driven session runs the same skills,
agents and PR gate the Claude one does. A third provider is the same
four steps, and D31's capture comes first.

## 9. Not verified

- What a native Codex quota, auth or hook refusal prints on the `--json`
  stream. D36's table is transcribed from the binary and from one 400
  response; the first live refusal is the test, and 014 D-9 is the
  correction path.
- Whether `--sandbox workspace-write` under `exec` ever blocks on an
  approval prompt with no terminal. Capture 2 ran one command without one;
  the `threads` row recorded `approval_mode: never` for `exec`.
- Whether the desktop app rewrites `.tmp/marketplaces` on a timer as well
  as on launch. Both captures re-stamped it; neither was a launch.
- The Cursor tree, which the desktop's import also names as a provider.
  Nothing here is designed against it.

## 10. Sources

Measured on disk 2026-09-09: `~/.codex` (the tree listing, `du`, the file
type census, `config.toml`, `hooks.json`, `AGENTS.md`,
`external_agent_session_imports.json`, `.codex-global-state.json`, the
schemas of `state_5.sqlite`, `thread_history_1.sqlite`, `logs_*.sqlite`,
`memories_1.sqlite`, `goals_1.sqlite` read with `sqlite3 -readonly
"file:...?immutable=1"`, and the rollout files); the bundled CLI's
`--version`, `--help`, `exec --help` and `strings` output; the three
captures' snapshots, streams and stderr; this repository's
`crates/statecraft-sensor-core/src/lib.rs`, `verbs.rs`, `redact.rs`,
`watcher.rs`, `crates/statecraft-driver-core/src/lib.rs`, `session.rs`,
`protocol.rs`, `crates/statecraft-driver-claude/src/main.rs`,
`members/src/orchestrator/driver.ts`, `profile.ts`, `daemon.ts`,
`stages/build.ts`, `stages/verify.ts`, `commands/orchestrator.ts`, and
`src/members.rs`.
