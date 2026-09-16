---
id: "115-codex-sensor"
title: "The Codex universe: a second sensor over the same core, transcribed from evidence"
status: approved
created: "2026-09-09"
implementation: complete
risk: medium
depends_on:
  - "112-sensor-port"
  - "111-contract-crate"
  - "108-member-dispatch"
establishes:
  - { kind: crate, id: "statecraft-sensor-codex" }
  - { kind: directory, path: "crates/statecraft-sensor-codex/" }
extends:
  # 110 owns the family's design record; doc 03 joins it.
  - { spec: "110-corpus-merge", unit: "docs/design/03-the-codex-provider.md", nature: additive }
  # 112 owns the sensor core and the Claude crate. Three seams open here:
  # a state file that sits inside the root (B-3), a peek deny list (B-4)
  # and an OpenAI key pattern in the redactor (B-5); the Claude crate
  # names the new field with an empty list.
  - { spec: "112-sensor-port", unit: { kind: symbol, id: "statecraft_sensor_core::Universe" }, nature: additive }
  - { spec: "112-sensor-port", unit: { kind: symbol, id: "statecraft_sensor_core::watcher::Watcher" }, nature: additive }
  - { spec: "112-sensor-port", unit: { kind: symbol, id: "statecraft_sensor_core::verbs::peek" }, nature: additive }
  - { spec: "112-sensor-port", unit: { kind: symbol, id: "statecraft_sensor_core::redact::rules" }, nature: additive }
  - { spec: "112-sensor-port", unit: { kind: symbol, id: "statecraft_sensor_claude::universe" }, nature: additive }
  # The core's own tests build a Universe and name the new field.
  - { spec: "112-sensor-port", unit: { kind: symbol, id: "statecraft_sensor_core::store::tests" }, nature: additive }
  - { spec: "112-sensor-port", unit: { kind: symbol, id: "statecraft_sensor_core::walker::tests" }, nature: additive }
  - { spec: "102-crate-scaffold", unit: "Cargo.lock", nature: additive }
  # The members workflow builds every Rust member.
  - { spec: "110-corpus-merge", unit: ".github/workflows/members.yml", nature: additive }
references:
  - { unit: { kind: file, path: "docs/design/02-the-monorepo-and-the-rust-sequence.md" }, role: context }
  - { unit: { kind: file, path: "specs/001-observed-universe/spec.md" }, role: context }
  - { unit: { kind: file, path: "specs/003-event-classification/spec.md" }, role: context }
summary: >
  The first spec of the Codex sequence doc 03 plans. Spec 112 ended with
  the sentence "a Codex sensor is then a second thin crate: a root and a
  table", and this spec is that crate, plus the evidence the table is
  transcribed from. The evidence comes first (doc 03 D31): a FINDINGS
  file in the crate records what each path family under ~/.codex turned
  out to mean, citing the three live captures of codex exec that doc 03
  §2 reports, and every rule in the table cites an entry. The universe
  is $CODEX_HOME, else ~/.codex, with the desktop's atom-state file as
  the state file inside the root rather than beside it, which is the
  first of three small seams the core did not have and gains here; the
  other two are a peek deny list, because auth.json is a secret the
  redactor must refuse rather than mask, and an OpenAI key pattern in
  the redactor. The table reuses 003's kinds where the meaning is shared
  and adds kinds only for what the Claude tree does not have: the sqlite
  family and its WAL and SHM siblings, whose shrink is routine and must
  not shout; marketplace checkouts; the app bundle; sandbox shims;
  secrets; identifiers; the desktop's imports of other agents' sessions.
  The binary is statecraft-sensor-codex, discovered by the umbrella with
  no umbrella change, and the core still names no provider.
---

# 115: The Codex universe

## 1. Purpose

Doc 03 §1 states the method: the classification table is only as good as
the observation behind it, and a rule with no observation is not written.
This spec lands the observation and the crate together so that the table
can be checked against its evidence in one place, and so that the day the
Codex CLI changes its layout, the sensor reports `unclassified` loudly
(003 B-2) instead of misfiling silently.

It is also the first proof that 112 B-1 holds. The core was written
against one provider; a second one either fits the `Universe` and
`Classifier` seams as they are, or shows exactly where they were shaped by
Claude's tree. Three such places were found, and they are opened here as
additive changes to the core rather than worked around in the crate.

## 2. Territory

Owned: `crates/statecraft-sensor-codex/` (a binary named
`statecraft-sensor-codex`; `Cargo.toml`, `src/main.rs`, `src/classify.rs`,
`src/redact_extras.rs` if the crate needs one, and `FINDINGS.md`, the
evidence file) and the design record `docs/design/03-the-codex-provider.md`
under 110's directory.

Extended: the sensor core's `lib.rs` (a `Universe` field), `watcher.rs`
(the state file inside the root), `verbs.rs` (the deny list in `peek`),
`redact.rs` (one rule); the Claude crate's `main.rs` (the new field, empty);
the lockfile; the members workflow.

Not claimed: the TypeScript sensor, which observes `~/.claude` only and is
not made provider-aware (doc 03 §7 puts the Codex sensor in Rust because
that is where the split exists); `~/.codex` itself, which is observed and
never written (001 B-7).

## 3. Behavior

- **B-1 (the evidence file).** `crates/statecraft-sensor-codex/FINDINGS.md`
  records, per path family under the root: the pattern, what writes it,
  when it changes, what a change means, and the capture that showed it
  (doc 03 §2's three captures, by number, or "import residue" for what
  only the desktop's onboarding wrote). Every rule in the table carries
  the FINDINGS entry it transcribes, as a comment naming the entry's
  heading. A rule with no entry is a lint the crate's tests enforce
  (FR-003).
- **B-2 (the universe).** The root is `$CODEX_HOME` when set, else
  `~/.codex`; the state file is `<root>/.codex-global-state.json`, displayed
  by its relative name; the ignore rule is 112's (`.DS_Store`, `.swp`,
  `.swo`, `~`). The data directory is `data_dir("sensor-codex")`; the store
  file, the daemon log and the pid file keep 112 B-3's names beside it.
- **B-3 (a state file inside the root).** The core's `Universe` keeps one
  `state_file`, and a provider MAY place it inside `watch_root`. When it
  does, `rel` returns the relative path (which equals the display form the
  provider chose), `rel_state_sibling` still names the temp siblings, and
  the watcher registers no second, non-recursive watch for the state
  directory because the recursive watch over the root already covers it,
  so one filesystem change produces one event. The Claude universe, whose
  state file is a sibling, behaves exactly as before; 112's parity test
  is the check.
- **B-4 (peek refuses secrets).** `Universe` gains `never_peek: Vec<String>`,
  root-relative paths that `peek` refuses with the message `refused:
  <path> is a secret and is never read` and exit 1, before opening the
  file and before redaction. The Codex universe lists `auth.json`; the
  Claude universe lists nothing, so 112's verbs are byte-identical still.
  `explain` still answers for a denied path; only reading is refused.
- **B-5 (the redactor knows OpenAI keys).** `redact.rs` gains one rule
  for the `sk-proj-` and `sk-` key forms OpenAI issues, applied in the
  same pass as the Anthropic rule. It is a core rule, not a provider seam:
  a Claude session's transcript can carry an OpenAI key as easily as the
  reverse, and 112 B-1's neutrality test still passes because the pattern
  names no provider.
- **B-6 (the table).** The rules, first match wins, transcribed from
  FINDINGS in this order: the rollout transcript
  (`sessions/YYYY/MM/DD/rollout-<ts>-<id>.jsonl`, kind `transcript`,
  label carrying the first eight characters of the thread id and
  grew/shrank per 003), the sessions container directories, the sqlite
  family (`<name>_<n>.sqlite` as `sqlite` with the base name and
  generation in the label, `-wal` as `sqlite-wal`, `-shm` as
  `sqlite-shm`, a shrink of either labelled `checkpointed`, never loud),
  the desktop's `sqlite/codex-dev.db` and siblings under the same kinds,
  `.codex-global-state.json` as `state-file` (a replace labelled `atomic
  replace` as 003 does) and its `.bak` as `state-backup`, `config.toml` as
  `config` with the label naming a size-only growth as `appended by the
  tool (project trust or hook trust)`, `hooks.json` and `hooks/**` as
  `hook-file`, `AGENTS.md` as `instructions`, `skills/**` as `skill`,
  `plugins/**` as `plugin`, `.tmp/marketplaces/**` and `.tmp/**` as
  `marketplace`, `cache/**` as `cache`, `auth.json` as `secret`,
  `installation_id` as `identity`, `models_cache.json` as `catalog`,
  `external_agent_session_imports.json` and `vendor_imports/**` as
  `import`, `computer-use/**` as `bundle`, `tmp/arg0/**` and `tmp/path/**`
  as `shim`, `shell_snapshots/**` as `shell-snapshot`, `ipc/**` and
  `thread-writer-locks/**` as `daemon`, `ambient-suggestions/**` as
  `suggestion`, `memories/**` and `memories_*` under `memory`, the
  migration markers as `housekeeping`, `.` as `root`, and everything else
  `unclassified` with 003's all-caps label.
- **B-7 (the manifest and the verbs).** The manifest is 042's with name
  `statecraft-sensor-codex`, the eight sensor verbs, `basic`, the sensor
  taxonomy. `main` answers `--member-manifest` first and hands the rest to
  the core's dispatch; the display name is `sensor-codex`, the plist label
  `com.bartekus.statecraft-sensor-codex`. The FINDINGS location is
  `STATECRAFT_SENSOR_FINDINGS`, else the crate's own `FINDINGS.md` when
  running from a checkout, else beside the data directory, so `explain`
  has a source in every install.
- **B-8 (read-only, sqlite included).** No verb opens any sqlite file
  under the root. The sensor sees the databases as files (size, mtime,
  inode) and nothing more; doc 03 D32's immutable-URI rule is for a later
  reader, not this one.

## 4. Functional requirements

- **FR-001.** Crate tests: every rule classifies its own example path,
  taken from FINDINGS, to the kind and label the table promises (a table
  of (path, action, kind, label) tuples, one per rule); a WAL shrink
  yields `sqlite-wal` with `checkpointed` and no `SHRANK`; a config
  growth by append yields the tool-append label; an unmatched path is
  `unclassified`.
- **FR-002.** Universe tests: `$CODEX_HOME` wins over `~/.codex`; `rel`
  of the state file is `.codex-global-state.json`; `never_peek` holds
  `auth.json`.
- **FR-003.** A test reads `src/classify.rs` and `FINDINGS.md` and asserts
  every rule's cited entry heading exists in FINDINGS.
- **FR-004.** Core tests for the three seams: a universe whose state file
  is inside the root produces one event for one write to it; `peek` of a
  denied path exits 1 with the message and opens nothing (the file may be
  unreadable and the verb still answers); the OpenAI key forms are
  masked.
- **FR-005.** The core's neutrality test (112 FR-005) still passes, and a
  sibling assertion refuses `codex` in the core's sources.
- **FR-006.** The manifest the binary answers parses as a 042 manifest
  with name `statecraft-sensor-codex` and the eight verbs.

## 5. Acceptance

- `cargo test --workspace`, `cargo clippy --workspace --all-targets --
  -D warnings` and `cargo fmt --check` are clean.
- `cd members && bun test src/members/sensor-parity.test.ts` still passes
  (the Claude sensor's bytes did not move).
- `STATECRAFT_MEMBER_DIR=<dir holding target/debug/statecraft-sensor-codex>
  statecraft members list` shows the Codex sensor and
  `statecraft sensor-codex stats` dispatches to it.
- A live smoke, recorded in the status note: `statecraft-sensor-codex
  watch` over the real `~/.codex` while one `codex exec --json` runs
  classifies the rollout as `transcript`, the `threads` write as `sqlite`
  or `sqlite-wal`, and the config append as `config`; `peek auth.json` is
  refused.

## Verification

```verify:cli
cargo test --workspace --locked -p statecraft-sensor-core -p statecraft-sensor-codex -p statecraft-sensor-claude
```

```verify:cli
cd members && bun test src/members/sensor-parity.test.ts
```

## Status (2026-09-09)

Implemented. The crate's tests cover every rule (40 examples) and every
citation; the core's new tests cover the three seams; 112's parity test
still passes, so the Claude sensor's bytes did not move. The umbrella
discovered the binary from a managed directory with no umbrella change
(`members list` showed `sensor-codex 0.1.0 042 basic`, `sensor-codex
stats` dispatched, `peek auth.json` was refused with exit 1). The live
smoke watched the real `~/.codex` through one `codex exec --json`: 491
events in eleven seconds, none unclassified; the rollout was `transcript`
(created, then one 41 KB append at exit), the `threads` write showed as
`sqlite-wal` on `state_5`, and `config.toml` was not touched because the
scratch directory was already trusted by an earlier capture (the append
itself was observed in capture 2 and is what the `config` rule's label
names). The smoke added three FINDINGS entries the snapshot diffs could
not see: the per-thread writer lock, the shim directory's rotation, and
the marketplace staging checkouts.

## 6. Out of scope

A TypeScript Codex sensor. Reading any sqlite database under the root.
Classifying the contents of a rollout (the sensor sees paths and sizes,
003's rule). The Cursor tree. Retiring the TypeScript sensor (112 D-6).

## 7. Resolved decisions

D-1 (2026-09-09). Born approved on doc 03 §7's authority: the corpus owner
asked for the Codex sequence to run to completion in one instruction, and
the decisions are recorded in doc 03 rather than left to the session.

D-2 (2026-09-09). The state file stays a required `Universe` field rather
than becoming optional. Making it optional would touch every core call
site for one provider that has a perfectly good state file; letting it sit
inside the root is one watcher condition. Rejected: `Option<PathBuf>`.

D-3 (2026-09-09). The deny list lives on `Universe`, not on `Sensor`,
because what may never be read is a property of the observed tree, and
`explain` (which takes the universe) should be able to say so.

D-4 (2026-09-09). Marketplace and plugin churn is classified, not
ignored. 1,451 diff lines per launch is noise to a human reading the feed,
but the walker's ignore rule is for the sensor's own litter (001 B-5), and
a `log --kind` filter is the right tool for the rest.
