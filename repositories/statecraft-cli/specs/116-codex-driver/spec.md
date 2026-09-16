---
id: "116-codex-driver"
title: "The Codex driver: a second Provider over the same core, with the tier and the degradations it declares"
status: approved
created: "2026-09-09"
implementation: complete
risk: medium
depends_on:
  - "114-driver-port"
  - "115-codex-sensor"
  - "043-driver-seam"
  - "032-execution-profiles"
establishes:
  - { kind: crate, id: "statecraft-driver-codex" }
  - { kind: directory, path: "crates/statecraft-driver-codex/" }
  - "members/src/members/driver-codex.test.ts"
extends:
  # 114 owns the driver core and the Claude crate. Three hardcodes the
  # first port left become Provider methods with defaults (B-1); the
  # Claude crate names the one it relied on.
  - { spec: "114-driver-port", unit: { kind: symbol, id: "statecraft_driver_core::Provider" }, nature: additive }
  - { spec: "114-driver-port", unit: { kind: symbol, id: "statecraft_driver_core::session::run_session" }, nature: additive }
  - { spec: "114-driver-port", unit: { kind: symbol, id: "statecraft_driver_core::protocol::manifest" }, nature: additive }
  - { spec: "114-driver-port", unit: { kind: symbol, id: "statecraft_driver_core::protocol::models_verb" }, nature: additive }
  - { spec: "114-driver-port", unit: { kind: symbol, id: "statecraft_driver_core::classify::reset_patterns" }, nature: additive }
  - { spec: "114-driver-port", unit: { kind: symbol, id: "statecraft_driver_core::classify::tests" }, nature: additive }
  - { spec: "114-driver-port", unit: { kind: symbol, id: "statecraft_driver_core::session::tests" }, nature: additive }
  - { spec: "114-driver-port", unit: { kind: symbol, id: "statecraft_driver_claude::Claude" }, nature: additive }
  - { spec: "102-crate-scaffold", unit: "Cargo.lock", nature: additive }
  - { spec: "110-corpus-merge", unit: ".github/workflows/members.yml", nature: additive }
references:
  - { unit: { kind: file, path: "docs/design/03-the-codex-provider.md" }, role: context }
  - { unit: { kind: file, path: "specs/014-session-driver/spec.md" }, role: context }
summary: >
  The second thin crate doc 02 D26 promised and doc 03 §3 designs:
  statecraft-driver-codex implements statecraft-driver-core's Provider
  for codex exec --json. The argv is exec on stdin with the posture
  mapped onto Codex's sandbox flags (D35), the env drops the OpenAI key
  so the file-based auth wins, the parser reads thread.started,
  item.completed, turn.completed and turn.failed into the core's init
  and result boundaries, the transcript is found by its thread id under
  the sessions tree, the model pair is gpt-6-astra and gpt-5.6-luna,
  and the termination table is transcribed from the binary's own
  vocabulary (D36). What Codex cannot do is declared, not hidden (D34):
  the manifest says basic, and session.init carries the degradations
  the request incurred (a tool allowlist it cannot apply, a turn cap it
  cannot set, a cost it cannot report). Building it against the core
  found three places 114 had shaped around Claude, and each becomes a
  Provider method with a default: the subtype that means the turn cap
  was hit, the tier the manifest declares, and the usage line's name.
  Over a fake codex script the driver emits the events 014 promises for
  every classification, and 043's engine drives it through the seam
  with STATECRAFT_DRIVER_BIN. A live smoke drives the real binary once.
---

# 116: The Codex driver

## 1. Purpose

Spec 114 ended with "a Codex driver is then the second thin crate, which
is what ready for Codex means on the driver side". This spec is that
crate, and the proof that 114 B-1's line is where it claimed to be. Where
the core turned out to know Claude after all, the fix is a `Provider`
method with a default, so the Claude crate keeps its behavior by naming
it and the Codex crate names something else.

The driver's honesty matters more than its coverage. Codex has no turn
cap, no tool allowlist and no cost figure. A driver that silently ran
without them would make the journal lie about the posture a session had;
doc 01 D22 says a degraded capability is journaled, never silent, and
this spec applies that to every gap.

## 2. Territory

Owned: `crates/statecraft-driver-codex/` (a binary named
`statecraft-driver-codex`; `Cargo.toml`, `src/main.rs`) and the members'
test `members/src/members/driver-codex.test.ts`, which drives the Rust
binary through 043's seam over a fake `codex` script.

Extended: the core's `Provider` trait, `run_session`, `manifest` and
`models_verb`; the Claude crate's `Claude` (one method named); the
lockfile; the members workflow.

Not claimed: the engine, which needs no change to run this driver when
`STATECRAFT_DRIVER_BIN` names it (043 B-8); the per-project choice is
spec 117.

## 3. Behavior

- **B-1 (three seams in the core).** `Provider` gains three methods with
  defaults: `max_turns_subtype() -> Option<&'static str>` (default
  `None`; the Claude crate returns `Some("error_max_turns")`, which
  `run_session` now reads instead of carrying the string itself),
  `capability_tier() -> CapabilityTier` (default `Reference`; the
  manifest reads it), and `spawn_extras(&SpawnSpec) -> Value` (default
  an empty object; merged into `session.init` beside `init_extras`, so a
  provider can say what the request made it give up). The `models`
  verb's usage line names the provider instead of `observatory`. The
  core's neutrality test refuses `codex` as it refuses the other name.
- **B-2 (argv, D35).** `exec --json --color never` then the posture:
  `bypass` is `--dangerously-bypass-approvals-and-sandbox`; `guarded` is
  `--sandbox workspace-write`. Then `-m <model>` when a model resolved,
  and last `-`, so the prompt is read from stdin. The core spawns in the
  repo, so `-C` is not passed. `max_turns` and `mcp_config_path` produce
  no argv. The binary is `STATECRAFT_CODEX_BIN`, else `codex`.
- **B-3 (env).** `OPENAI_API_KEY` is removed from the child's environment
  so `auth.json` decides the auth mode, and `NO_COLOR=1` is set.
  Everything else is inherited.
- **B-4 (the parser).** `thread.started` is `Init` with `thread_id`.
  `item.completed` with an `agent_message` item remembers its text;
  with an `error` item remembers its message; `error` remembers its
  message. `turn.completed` is `Result` with `is_error: false`, subtype
  `completed`, the last agent message as the text, `usage` as Codex
  reports it (`input_tokens`, `cached_input_tokens`,
  `cache_write_input_tokens`, `output_tokens`,
  `reasoning_output_tokens`), no cost and no turn count. `turn.failed`
  is `Result` with `is_error: true`, subtype `failed`, and the failure's
  message (its own `error.message`, else the last remembered error) as
  the text. Everything else is `Other` and streams verbatim.
- **B-5 (the transcript).** `transcript_path` walks
  `$CODEX_HOME`-or-`~/.codex` `/sessions/<yyyy>/<mm>/<dd>/` for the one
  file named `rollout-*-<thread id>.jsonl` and returns it, or `None`
  when none exists yet. It opens no database (doc 03 §4).
- **B-6 (models).** The pair is `("gpt-6-astra", "gpt-5.6-luna")`.
- **B-7 (the table, D36).** In order: auth (`not logged in`, `codex
  login`, `unauthorized`, `auth required`, `access token could not be
  refreshed`, `401`), quota (`hit your usage limit`,
  `usage_limit_exceeded`, `rate_limit_exceeded`, `rate limit`, `429`,
  `too many requests`), hook-blocked (`blocked by PreToolUse hook`,
  `Blocked by hook`, `blocked by policy`), transient (`stream
  disconnected`, `server_overloaded`, `http_connection_failed`,
  `response_stream_connection_failed`, `reconnecting`, `502`, `503`).
  The core's reset extraction gains the `try again at|in <time>` form
  beside `resets at|in`, the same four shapes after either, so a Codex
  quota result carries `resetAtMs` the way a Claude one does.
- **B-8 (declared, not hidden, D34).** The manifest is 042's with name
  `statecraft-driver-codex`, verbs `models` and `session`, tier `basic`.
  `init_extras` is `{"codexBin": <bin>}`. `spawn_extras` is
  `{"degraded": [...]}` listing, in this order and only when incurred:
  `tool-allowlist` (the profile carried an allowed or disallowed list),
  `max-turns` (the request carried one), `mcp-config` (the request
  carried a path, which 043 B-6 should already have refused), and
  always `cost`, because the result's cost is null by construction.

## 4. Functional requirements

- **FR-001.** Crate tests: the argv for bypass and guarded profiles, with
  and without a model; the env scrub; the parser over the four captured
  streams of doc 03 (a completed turn, a turn with a command, a failed
  turn, and a turn whose `error` precedes `turn.failed`); the transcript
  walk over a fixture sessions tree; every rule matches its example
  and the reset form extracts; the degradation list for each trigger.
- **FR-002.** Core tests: the three defaults hold for a provider that
  names none; a provider's `spawn_extras` appears in `session.init`;
  `max_turns_subtype` `None` never classifies `max-turns`.
- **FR-003.** The members' test builds the Rust binary, writes a fake
  `codex` script per fixture (completed, failed with a quota message
  carrying `Try again at`, auth, hook-blocked, transient, crashed with
  a non-zero exit, timeout under a short deadline), and asserts the
  `session.init` payload (with `codexBin` and `degraded`), the
  classification kind, detail and reset for each, and that 043's
  `createProcessDriver` with `STATECRAFT_DRIVER_BIN` at the binary
  journals `session.init` and `session.result` through the seam; the
  manifest declares `basic`.
- **FR-004.** The Claude driver's parity test (114 FR-003) still passes.

## 5. Acceptance

- `cargo test --workspace`, clippy and fmt clean.
- `cd members && bun test src/members/driver-codex.test.ts` and
  `src/members/driver-parity.test.ts` pass.
- `STATECRAFT_MEMBER_DIR=<dir> statecraft members list` shows both
  drivers; `statecraft driver-codex models` prints the pair.
- A live smoke, recorded in the status note: 043's seam with
  `STATECRAFT_DRIVER_BIN` at the binary and `STATECRAFT_CODEX_BIN` at the
  bundled CLI drives one fast-tier turn of the real Codex to a
  `completed` result whose `session.init` carries the degradation list
  and whose transcript path names the rollout the sensor saw.

## Verification

```verify:cli
cargo test --workspace --locked -p statecraft-driver-core -p statecraft-driver-codex -p statecraft-driver-claude
```

```verify:cli
cd members && bun test src/members/driver-codex.test.ts src/members/driver-parity.test.ts
```

## Status (2026-09-09)

Implemented. The crate's six tests and the core's two new ones passed on
the first run; the members' test (twelve cases: the manifest and `models`,
seven fixtures through `session run` with the argv and the stdin prompt
checked, the bypass argv, a bad request, and 043's seam) passed on the
first run too, and 114's parity test still passes. The umbrella listed
both drivers from a managed directory. The live smoke drove the real
bundled Codex through `createProcessDriver({name: "codex"})` with
`STATECRAFT_DRIVER_BIN` at the binary, guarded posture, fast tier:
`completed` in 5.8 s on `gpt-5.6-luna`, `session.init` carrying
`codexBin` and `degraded: ["cost"]`, usage of 16,170 input tokens, cost
and turn count null, and `transcriptPath` resolved to the rollout under
`~/.codex/sessions/2026/09/09/`. One thing the build found and the spec
now records (D-5): the core's reset extraction knew only the `resets at`
form, so `Try again at` joined it as a core pattern.

## 6. Out of scope

The engine's per-project driver choice (117). A provider-neutral posture
vocabulary (doc 03 D39). MCP configuration for Codex. Pricing tokens.
Hook trust (118). A TypeScript Codex driver.

## 7. Resolved decisions

D-1 (2026-09-09). Born approved on doc 03 §7's authority (115 D-1).

D-2 (2026-09-09). The parser keeps state (the last agent message, the
last error) behind a mutex inside the provider, because the core's
`parse_event` is one line in and one event out and Codex's final text
arrives on a line before the one that ends the turn. Rejected: changing
the trait to hand the provider the whole stream, which would move the
overflow and deadline logic every provider shares.

D-3 (2026-09-09). Defaults on the new trait methods, not required
methods. A required method would make every provider name a turn-cap
subtype most providers do not have; the default is the honest answer
and the Claude crate's override is one line.

D-5 (2026-09-09). The reset form is a core pattern, not a provider
rewrite. Building the crate found that the core's extraction knew only
`resets at`; the Codex form is `Try again at`. Rewriting the result text
in the provider to fool the core was rejected: the journal would then
carry words the provider never said. The core's patterns accept both
prefixes, which names no provider.

D-4 (2026-09-09). `cost` is always in the degradation list. A consumer
that sums costs across drivers must be able to tell "zero" from "not
reported", and the list is where the driver says which.
