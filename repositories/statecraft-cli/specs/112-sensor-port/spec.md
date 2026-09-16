---
id: "112-sensor-port"
title: "The sensor in Rust: a provider-neutral core and the Claude table"
status: approved
created: "2026-09-09"
implementation: complete
depends_on:
  - "111-contract-crate"
  - "042-member-contract"
  - "110-corpus-merge"
establishes:
  - { kind: crate, id: "statecraft-sensor-core" }
  - { kind: directory, path: "crates/statecraft-sensor-core/" }
  - { kind: crate, id: "statecraft-sensor-claude" }
  - { kind: directory, path: "crates/statecraft-sensor-claude/" }
  - "members/src/members/sensor-parity.test.ts"
extends:
  - { spec: "102-crate-scaffold", unit: "Cargo.lock", nature: additive }
  # The members workflow builds the Rust sensor for the parity test.
  - { spec: "110-corpus-merge", unit: ".github/workflows/members.yml", nature: additive }
references:
  - { unit: { kind: file, path: "docs/design/02-the-monorepo-and-the-rust-sequence.md" }, role: context }
  - { unit: { kind: file, path: "docs/design/01-umbrella-cli-and-member-seams.md" }, role: context }
summary: >
  The first member port in doc 02 D30's order: the sensor, because it is
  the smallest, the most self-contained, has no chain-compatibility
  constraint, and has a clear Rust story in notify and rusqlite. It lands
  as the two crates D26 calls for. statecraft-sensor-core holds what any
  provider's sensor needs and names no provider: the walker, the state
  table that turns coalesced filesystem notifications into created,
  modified, replaced and deleted events with size deltas, the event
  store with the schema the TypeScript sensor already writes, snapshots
  and diffs, the redactor, the formatter, the FINDINGS reader, the
  daemon plumbing, and the verb set behind the 042 manifest.
  statecraft-sensor-claude is the observed root, the classification
  table and the manifest, and builds the binary the umbrella already
  discovers as statecraft-sensor-claude. Every verb's stdout is
  byte-identical to the TypeScript sensor's over the same store, proved
  by a parity test that runs both. A Codex sensor is then a second thin
  crate: a root and a table.
---

# 112: The sensor in Rust

## 1. Purpose

Specs 001-008 record the sensor as found: a state-diffing watcher over
`~/.claude` and `~/.claude.json`, a sqlite event log, a classification
table that turns paths into semantic events, and six verbs over the
result. Doc 02 §6 measured it at about 1,200 lines with a thin Bun
coupling (`fs.watch`, `bun:sqlite`) and no tests of its own, and D30
picked it as the first port for exactly those reasons.

The port is also the first place D26's shape is built rather than
described. `src/classify.ts` is a pattern-to-semantic-event table over an
observed root; everything around it (the watcher, the store, the
redaction path, the verbs) is the same for any provider. Splitting the
crate along that line is what makes the second sensor cheap, and this
spec's acceptance includes proving the core names no provider.

## 2. Territory

Owned: `crates/statecraft-sensor-core/` (a library), `crates/statecraft-sensor-claude/`
(a binary named `statecraft-sensor-claude`), and the parity test
`members/src/members/sensor-parity.test.ts`.

Extended: the lockfile (102) and the members workflow (110), which builds
the Rust sensor so the parity test can run it.

Not claimed: the TypeScript sensor under `members/src/`, which keeps
running unchanged as `observatory <verb>` and as the TypeScript
`statecraft-sensor-claude` build until a later spec retires it (D-6).

## 3. Behavior

- **B-1 (the core names no provider).** `statecraft-sensor-core` exports
  `Universe` (a watched root, a sibling state file, an ignore rule, a
  display form for paths), `walk`, `Store` (open, insert, snapshot,
  query), `Watcher` (the debounced state-table diff over `notify`, one
  sink), `redact`, `format`, `findings`, `daemon`, and the verb
  implementations, each taking a `Universe` and a `Classifier` rather
  than knowing one. `grep -rn 'claude' crates/statecraft-sensor-core/src`
  is empty (FR-005).
- **B-2 (the Claude crate is a root and a table).** `statecraft-sensor-claude`
  declares the universe (`~/.claude`, `~/.claude.json`, `.DS_Store` and
  editor litter ignored, the `~/.claude.json` display form), the
  classification rules of `classify.ts` in the same order with the same
  kinds and label texts, the FINDINGS location, and the 042 manifest
  (`statecraft-sensor-claude`, the eight verbs, `basic`, the sensor's
  declared taxonomy). Its `main` answers `--member-manifest` before
  anything else (042 B-3) and hands the rest to the core's dispatch.
- **B-3 (the store is the same store).** The sqlite schema, the WAL mode,
  the column set and the insert shapes are the TypeScript sensor's, so a
  database either implementation wrote is read by the other. The default
  location moves off the checkout (D-2): `STATECRAFT_SENSOR_DATA_DIR`,
  else `$XDG_DATA_HOME/statecraft/sensor-claude`, else the platform data
  directory under `statecraft/sensor-claude`; the store file stays
  `observatory.db`, the daemon's `daemon.log` and `daemon.pid` beside it.
- **B-4 (byte-identical verbs).** Over the same store and the same
  arguments, `log`, `stats`, `snapshot --list`, `diff`, `explain` and
  `peek` write byte-identical stdout to the TypeScript sensor's, including
  the `en-US` locale form `toLocaleString` renders and the `toFixed(1)`
  byte sizes. `watch` prints the same start line and event lines
  (`format.ts`, colors off under `NO_COLOR` or a pipe). `daemon
  start|stop|status` behave the same over the pid file; `daemon plist`
  names this binary. An unknown verb prints the usage and exits 1, as the
  TypeScript dispatcher does (042's sensor taxonomy).
- **B-5 (the watcher).** `notify` in recursive mode over the root and
  non-recursive over the state file's directory, filtered to the state
  file and its temp siblings; a 200 ms per-path debounce; the same
  created/modified/replaced/deleted derivation from (size, mtime, inode)
  against the state table; subtree adoption on a created directory,
  subtree forgetting on a deleted one, and reconciliation of a reported
  directory's children. Raw notifications ride along as `raw` exactly as
  before (`[{ts, type}]`, `type` being the backend's event kind).
- **B-6 (no shell, argv only).** `daemon start` spawns `current_exe()
  watch` detached with stdout and stderr on the log; nothing is
  interpolated into a command line (042 B-7).

## 4. Functional requirements

- **FR-001.** Core unit tests: the walker over a fixture tree; the state
  table producing each of the four actions with the right delta from a
  scripted sequence of stats; `redact` over the token, field, env and
  opaque-run cases; `fmt_bytes` and `fmt_time` against values whose
  TypeScript renderings are known; `parse_since` and `glob_to_like`.
- **FR-002.** Claude crate tests: every rule in the table classifies its
  own example path to the kind and label `classify.ts` produces (a
  table of (path, action, kind, label) triples transcribed from the
  TypeScript, one per rule); an unmatched path is `unclassified` with
  the same message.
- **FR-003.** The parity test copies `members/src` into a temp
  directory, seeds a store there with a fixed event set and two
  snapshots through the Rust store, runs each read verb through
  `bun <temp>/src/index.ts` and through the Rust binary with
  `STATECRAFT_SENSOR_DATA_DIR` pointed at the same store, and asserts
  byte-identical stdout for: `log`, `log --since`, `log --kind`,
  `log --raw`, `stats`, `snapshot --list`, `diff 1 2`, `explain <path>`
  and `peek` over a fixture file. Both run under `TZ=UTC` and
  `NO_COLOR=1`.
- **FR-004.** The manifest the Rust binary answers equals the
  `manifest-sensor` fixture of spec 111 modulo `version`.
- **FR-005.** `grep -rn -i claude crates/statecraft-sensor-core/src` is
  empty, asserted by a test in the core crate.

## 5. Acceptance

- `cargo test --workspace` is green; `cargo clippy --workspace
  --all-targets -- -D warnings` and `cargo fmt --check` are clean.
- `cd members && bun test src/members/sensor-parity.test.ts` passes
  (it builds the Rust sensor with `cargo build -p statecraft-sensor-claude`).
- `STATECRAFT_MEMBER_DIR=<dir holding target/debug/statecraft-sensor-claude>
  statecraft members list` shows the Rust sensor, and
  `statecraft sensor-claude log --limit 1` dispatches to it.
- A live smoke, run by hand and recorded in the status note: the Rust
  `watch` over the real `~/.claude` classifies a transcript write the
  same way the TypeScript watcher does.

## Verification

```verify:cli
cargo test --workspace --locked -p statecraft-sensor-core -p statecraft-sensor-claude
```

```verify:cli
cd members && bun test src/members/sensor-parity.test.ts
```

## Status (2026-09-09)

Implemented. The parity test's seventeen cases (`log` in six forms,
`stats` in two, `snapshot --list`, `diff`, three `explain`s, two `peek`s,
`daemon status`, an unknown verb) were byte-identical on the first run.
The live smoke ran over a fixture home rather than the real `~/.claude`
(observed, never written, so the writes this smoke needs cannot go there):
both watchers over the same scripted sequence (a transcript created and
appended, a subagent directory, an atomic replace of the state file, a
deletion) printed the same seven event lines. The one defect the smoke
found: the backend reports resolved paths (`/private/var/...` for a
`/var/...` root on macOS), which the root filter dropped until the watcher
mapped them back onto the universe's spelling.

## 6. Out of scope

Retiring the TypeScript sensor (D-6). Migrating an existing
`members/data/observatory.db` (copy it to the new location; the schema is
the same). A Codex sensor. Publishing the crates or shipping the binary
through spec 107's release pipeline. Any change to the classification
table or the verbs' output.

## 7. Resolved decisions

D-1. Two crates, not one with a feature flag. A feature flag would still
compile the Claude table into a core that claims to name no provider,
and FR-005 would have nothing to check.

D-2. The data directory leaves the checkout. The TypeScript sensor keeps
its store under the project directory because `import.meta.dir` made
that free; a compiled binary has no project directory (042 D-10), and a
member the umbrella installs must not write into its own install
location. The platform data directory is what 108 already uses for the
managed member directory, so the two sit side by side.

D-3. `toLocaleString` is reproduced for `en-US` only. That is what Bun
renders on every machine this sensor has run on, and matching it is what
keeps the parity test honest; a locale-aware rendering would be a
behavior change to spec against, not a port.

D-4. `notify` reports event kinds, not the two strings `fs.watch` used.
The `raw` notes keep the backend's kind name (`create`, `modify`,
`remove`, `access`, `any`) as `type`. The column is free text and no
reader parses it; it exists so a classification can be checked against
what the kernel said (002 B-3).

D-5. The parity test lives in the members' suite, because it needs bun to
run the TypeScript side and the members runner has both toolchains. It
builds the Rust binary itself so the check cannot pass vacuously against
a stale one.

D-6. The TypeScript sensor stays until the Rust one has run live as the
umbrella's `sensor-claude` for long enough to trust. Retiring it is a
small spec of its own: drop the verbs from `observatory`, the
`build:member:sensor` target, and `members/src/{watcher,classify,db,walker,redact,format}.ts`
with the commands that use them.
