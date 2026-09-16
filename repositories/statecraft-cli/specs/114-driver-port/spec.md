---
id: "114-driver-port"
title: "The driver in Rust: a provider-neutral core and the Claude driver, the last seam before a second provider"
status: approved
created: "2026-09-09"
implementation: complete
depends_on:
  - "111-contract-crate"
  - "043-driver-seam"
  - "014-session-driver"
  - "040-session-models"
  - "032-execution-profiles"
establishes:
  - { kind: crate, id: "statecraft-driver-core" }
  - { kind: directory, path: "crates/statecraft-driver-core/" }
  - { kind: crate, id: "statecraft-driver-claude" }
  - { kind: directory, path: "crates/statecraft-driver-claude/" }
  - "members/src/members/driver-parity.test.ts"
extends:
  - { spec: "102-crate-scaffold", unit: "Cargo.lock", nature: additive }
  - { spec: "110-corpus-merge", unit: ".github/workflows/members.yml", nature: additive }
references:
  - { unit: { kind: file, path: "docs/design/02-the-monorepo-and-the-rust-sequence.md" }, role: context }
  - { unit: { kind: file, path: "docs/design/01-umbrella-cli-and-member-seams.md" }, role: context }
summary: >
  Doc 02 D30 let the Claude driver stay TypeScript indefinitely, on the
  argument that a polyglot driver family is the strongest evidence the
  seam is real. Spec 043 proved the seam with exactly that: a Rust
  umbrella, a TypeScript engine and a TypeScript driver meeting at a
  process. What D26 still owes is the driver family's own split, a
  provider-neutral core and a thin per-provider crate, so that a second
  driver is invocation flags, a stream format, termination signals and
  a model table, and nothing else. This spec builds that split in Rust
  and proves it with the provider that exists. statecraft-driver-core
  is spec 014's session driver with the provider removed: it reads the
  043 request, spawns whatever the provider names with argv only,
  delivers the prompt on stdin, streams the provider's stdout through
  the provider's parser, enforces the deadline and the shutdown kill,
  classifies the termination through the provider's rule table, and
  emits the journal, stream and result events the engine consumes.
  statecraft-driver-claude is the argv, the env scrub, the stream-json
  parser, the transcript path, the default model pair, the rule table
  and the manifest. Over spec 014's own fixture scripts, the Rust driver
  and the TypeScript driver emit identical event streams, and the
  TypeScript engine drives the Rust driver through 043's seam unchanged.
  A Codex driver is then the second thin crate, which is what "ready for
  Codex" means on the driver side; the sensor side was 112.
---

# 114: The driver in Rust

## 1. Purpose

Doc 01 §3 measured the Claude coupling at fourteen files, four of them
holding forty-seven of the mentions, and 043 moved every one of them
behind one seam. The driver member that resulted is still the whole of
`session.ts`: the spawn, the stream parse, the deadline, the kill and the
classification are one function with `claude` in its argv. A Codex driver
written against that would copy the function and change the strings,
which is the retrofit D26 exists to prevent.

The core this spec builds is the part a second provider must not have to
write: everything about running a child process to completion under a
deadline with an event stream and an honest classification. The Claude
crate is the part only Claude knows. The proof that the line is in the
right place is the parity test: the Rust driver and the TypeScript driver
answer spec 014's fixtures identically, and 043's engine cannot tell
them apart.

## 2. Territory

Owned: `crates/statecraft-driver-core/` (a library), `crates/statecraft-driver-claude/`
(a binary named `statecraft-driver-claude`), and the parity test
`members/src/members/driver-parity.test.ts`.

Extended: the lockfile (102), the members workflow (110).

Not claimed: the TypeScript driver (`session.ts`, `driver-session.ts`,
`classify-termination.ts`, `models.ts`), which keeps serving
`observatory` and the TypeScript `statecraft-driver-claude` build until
a later spec retires it; the engine's seam (043), which needs no change.

## 3. Behavior

- **B-1 (the core names no provider).** `statecraft-driver-core` exports
  `Provider`, the trait a thin crate implements: the binary and the env
  var that overrides it, the argv for a request (prompt never on argv),
  the child env, the parse of one stdout line into `Init {session_id}`,
  `Result {..}` or `Other`, the transcript path for a session id, the
  default model pair, the termination rule table, and the extra fields
  its `session.init` record carries. Everything else is the core:
  `run_session` (spawn with argv only, prompt on stdin then closed,
  bounded overflow of unparseable lines, tail-bounded stderr, the
  deadline as SIGTERM then SIGKILL after the grace, the shutdown kill on
  SIGTERM or SIGINT, the two-second pipe drain after exit), `classify`
  (014 B-4's order over the provider's table, with the reset-time
  extraction of 014 FR-002), the 043 protocol (`session run`: request
  on stdin, `journal` / `stream` / `result` lines on stdout, exit 0 for
  any outcome, 3 for a bad request, 1 for a driver failure), and the
  `models` verb over the provider's pair. A test reads the core's sources
  and refuses a provider's name (FR-005).
- **B-2 (the Claude crate).** `statecraft-driver-claude` implements the
  trait: `claude` overridden by `STATECRAFT_CLAUDE_BIN`; argv
  `-p --output-format stream-json --verbose` plus 032 B-3's derivation
  (`--dangerously-skip-permissions`, or `--permission-mode=acceptEdits`
  with `--allowed-tools=` and `--disallowed-tools=` joined as one element
  each, the guarded baseline when no list is set), `--model`,
  `--max-turns`, `--mcp-config <path> --strict-mcp-config`; the child env
  with `ANTHROPIC_API_KEY` removed and `NO_COLOR=1`; the stream-json
  `system/init` and `result` events; the transcript path under
  `~/.claude/projects/<slug>/<id>.jsonl`; the pair `claude-opus-5` /
  `claude-sonnet-5`; 014's rule table in order; and the 042 manifest
  (`reference`, verbs `models` and `session`).
- **B-3 (identical events).** Over the same fake provider script and the
  same request, the Rust driver's stdout carries the TypeScript driver's
  events, compared as JSON values (the TypeScript lines are not canonical
  bytes, so key order is not the claim) once `ts` and `durationMs` are
  normalized: the
  `session.init` payload (`claudeBin`, `repo`, `model`, `maxTurns`,
  `timeoutMs`, `sessionId`, `profile`), every `stream` event verbatim, the
  `session.result` payload with 014's fourteen fields, and the
  `SessionResult`. The classification kinds, details and reset times
  match for completed, quota (with each reset form), auth, hook-blocked,
  transient, max-turns, timeout and crashed.
- **B-4 (the engine cannot tell).** With `STATECRAFT_DRIVER_BIN` pointed
  at the Rust binary, 043's `createProcessDriver` drives a session to the
  same journal records the TypeScript driver produces, and the profile
  spawn path (032's tests) sees the same argv.

## 4. Functional requirements

- **FR-001.** Core unit tests over a fake provider: the prompt reaches
  stdin only; the overflow cap and the stderr tail bound; deadline then
  grace; the classification order (completed beats a kill, killed beats
  timeout, max-turns beats the table, auth before quota); reset
  extraction for the ISO, relative, epoch and clock forms.
- **FR-002.** Claude crate tests: the argv for bypass and guarded
  profiles equals 032's derivation byte for byte; the env scrub; the
  transcript slug; every rule in the table matches its 014 example.
- **FR-003.** The parity test runs `bun members/src/members/driver.ts
  session run` and the Rust binary over spec 014's fixture scripts
  (completed with cost and usage, quota with a reset hint, auth, max
  turns, a timeout, a crash with stderr, an unparseable-stdout overflow)
  and asserts identical event streams after normalizing `ts` and
  `durationMs`; and drives `createProcessDriver` against the Rust binary
  through a journal, comparing records with the TypeScript-driven ones.
- **FR-004.** The manifest equals spec 111's driver fixture modulo
  version; `models` prints what the TypeScript verb prints.
- **FR-005.** `grep -rin claude crates/statecraft-driver-core/src` is
  empty, asserted by a test.

## 5. Acceptance

- `cargo test --workspace` green; clippy and fmt clean.
- `cd members && bun test src/members/driver-parity.test.ts` passes.
- A live smoke, recorded in the status note: the TypeScript engine's
  seam, with `STATECRAFT_DRIVER_BIN` at the Rust driver, completes one
  turn of the real Claude CLI and the journaled chain verifies.

## Verification

```verify:cli
cargo test --workspace --locked -p statecraft-driver-core -p statecraft-driver-claude
```

```verify:cli
cd members && bun test src/members/driver-parity.test.ts
```

## Status (2026-09-09)

Implemented. The parity test's eight fixtures (completed with cost, usage
and an overflow line; quota with an epoch reset hint; auth; max-turns;
hook-blocked; transient; crashed; timeout under a 300 ms deadline) yielded
the same event streams from both drivers on the first run, after one
correction: the journaled `repo` is `path.resolve`'s form, not the
symlink-resolved one. The engine's seam produced the same two journal
records through either driver. The live smoke ran from the checkout:
`createProcessDriver` with `STATECRAFT_DRIVER_BIN` at the Rust binary
drove one fast-tier turn of Claude Code to completion (session
1407207b-5039-4b5c-ba2a-9de640b5ad46, 51595 micro-USD), the chain held
`session.init` and `session.result`, and both verifiers reported it intact.

## 6. Out of scope

A Codex driver (the next spec, two files and no core change). Retiring
the TypeScript driver. The browser verifier's MCP config, which stays
the engine's to write. Any change to what a session is allowed to do
(032) or which model a tier resolves to (040).

## 7. Resolved decisions

D-1. D30's "the driver may stay TypeScript" is not reversed, it is
superseded by a better proof: a polyglot family showed the seam is
real; a core with two thin crates will show the split is real. The
TypeScript driver stays until the second provider exists and the two
Rust drivers have run live.

D-2. The trait carries the provider's `session.init` extras (`claudeBin`
for Claude) rather than the core naming a `bin` field, because the
journaled shape is 014's and a reader of the chain must not see a key
change when the implementation did.

D-3. Reset-time extraction lives in the core. Its patterns are English
prose about resets, not a provider's format; a provider that reports
resets structurally overrides `reset_at_ms` and the table simply does
not match.

D-4. The core's `session run` refuses nothing a provider might need: an
unknown provider event is a `stream` event and an unparseable line is
overflow, exactly as 014 B-3 keeps them, so a richer driver's
vendor-specific extensions pass through to the journal verbatim (doc 01
§5).
