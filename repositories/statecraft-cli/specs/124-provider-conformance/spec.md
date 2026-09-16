---
id: "124-provider-conformance"
title: "Provider conformance: one negative suite every driver runs, a fixture driver that ships with it, and a live qualification record per binary"
status: approved
created: "2026-09-09"
implementation: complete
risk: medium
depends_on:
  - "123-policy-kit-handoff"
  - "120-capability-contract"
  - "114-driver-port"
  - "116-codex-driver"
  - "043-driver-seam"
establishes:
  - "members/src/members/conformance.ts"
  - "members/src/members/conformance.test.ts"
  - "members/src/members/driver-fixture.ts"
  - "scripts/qualify-provider.ts"
  - { kind: directory, path: "docs/evidence/qualification/" }
  - "members/src/orchestrator/qualification.ts"
  - "members/src/orchestrator/qualification.test.ts"
extends:
  # 043 owns the engine bundle test and the driver seam that reads the record.
  - { spec: "043-driver-seam", unit: "members/src/members/engine-bundle.test.ts", nature: additive }
  - { spec: "043-driver-seam", unit: "members/src/orchestrator/driver.ts", nature: additive }
  - { spec: "043-driver-seam", unit: "members/src/orchestrator/driver.test.ts", nature: additive }
  # 042 owns the manifest declarations; the fixture driver is a fourth.
  - { spec: "042-member-contract", unit: "members/src/members/manifest.ts", nature: additive }
  - { spec: "042-member-contract", unit: "members/src/members/manifest.test.ts", nature: additive }
  # 032 owns the posture render, which shows the qualification.
  - { spec: "032-execution-profiles", unit: "members/src/orchestrator/profile.ts", nature: additive }
  - { spec: "032-execution-profiles", unit: "members/src/orchestrator/profile.test.ts", nature: additive }
  # 114 and 116 own the core and providers; the core journals the record.
  - { spec: "114-driver-port", unit: { kind: directory, path: "crates/statecraft-driver-core/" }, nature: additive }
  - { spec: "114-driver-port", unit: "members/src/members/driver-parity.test.ts", nature: additive }
  - { spec: "116-codex-driver", unit: "members/src/members/driver-codex.test.ts", nature: additive }
  # 110 owns the members package manifest, which gains the scripts.
  - { spec: "110-corpus-merge", unit: "members/package.json", nature: additive }
  # 109 owns the Makefile target list.
  - { spec: "109-governed-harness", unit: "Makefile", nature: additive }
  # The verdict is served on the project row and rendered by the CLI.
  - { spec: "022-http-api-and-events", unit: { kind: directory, path: "members/src/orchestrator/api/" }, nature: additive }
  - { spec: "023-orchestrator-cli", unit: "members/src/commands/orchestrator.ts", nature: additive }
  - { spec: "024-web-ui", unit: "members/web/test/fixtures.ts", nature: additive }
  - { spec: "024-web-ui", unit: "members/web/test/store.test.tsx", nature: additive }
  # The in-process session journals the binary version too (parity).
  - { spec: "014-session-driver", unit: "members/src/orchestrator/session.ts", nature: additive }
  - { spec: "043-driver-seam", unit: "members/src/members/driver-session.test.ts", nature: additive }
  - { spec: "117-project-driver", unit: "members/src/orchestrator/project-driver.test.ts", nature: additive }
references:
  - { unit: { kind: file, path: "docs/design/04-the-governed-substrate.md" }, role: context }
summary: >
  Doc 04 §8. A third provider is admitted by passing a suite, not by
  resembling the second. conformance.ts drives every discoverable driver
  through one negative table: a denial retained beside a completed
  result, a required capability refused before spawn, a hang killed with
  its descendants, a malformed stream and an absent cost left explicit, a
  manifest whose tokens agree with its tier, the same records from the
  Rust binary and the engine seam. A fixture driver ships in the members
  package so the suite runs without any real harness; the Claude and Codex
  drivers run it too. A qualification script drives one live turn of a
  named provider and writes a record under docs/evidence/qualification/;
  a driver whose binary version has no record runs as unqualified, shown
  in the posture and journaled, never refused.
---

# 124: Provider conformance

## 1. Purpose

Doc 03 §8 said a third provider is "the same four steps". The steps are
known; what is missing is the test that says a driver built by them is
one the engine can trust with the boundaries 119 to 122 built. The
parity tests prove the Rust and TypeScript Claude drivers agree and the
Codex tests prove the Codex driver's argv; nothing runs every driver
through the same refusals. This spec is that suite, and the evidence
that a real binary passed it.

## 2. Territory

Owned: `conformance.ts`, the table and the harness that runs it over a
driver command; `conformance.test.ts`, which runs it over the fixture
driver and every discoverable real one; `driver-fixture.ts`, the
fixture driver member (`statecraft-driver-fixture`), a scriptable
provider whose behavior is chosen by the request's prompt;
`scripts/qualify-provider.ts`; the qualification evidence directory;
`qualification.ts`, the record shape and its fold, with its test.

Extended: the engine bundle test and the driver seam (043); the
manifests (042); the posture render (032); the core and the parity
suites (114, 116); the members package scripts (110); the Makefile
(109).

Not claimed: the sensors (a sensor's conformance is its FINDINGS test,
115 FR-003); the web UI.

## 3. Behavior

- **B-1 (the fixture driver).** `statecraft-driver-fixture` is a member
  with the driver's verbs and a manifest declaring `capabilities` from
  the environment variable `STATECRAFT_FIXTURE_CAPABILITIES` (default:
  all six). Its `session` verb reads the prompt's first line as a
  script: `complete`, `deny-then-complete`, `hang <ms> [with-child]`,
  `malformed`, `no-cost`, `quota <reset>`, `crash <code>`, and emits
  the corresponding events over the 043 wire. It is built by `bun run
  build:member:driver-fixture` and discovered like any member.
- **B-2 (the table).** `CONFORMANCE_CASES` in `conformance.ts` is a
  fixed list of `{name, request, expect}` where `expect` is a predicate
  over the `SessionResult` and the journal records: `denial-retained`
  (`completed` with `denials: 1`); `required-refused` (a required token
  the manifest lacks yields `crashed`, `driver.refused`, and no process
  started, observed through the fixture's marker file); `hang-killed` (a
  hang with a child yields `timeout` and neither pid survives);
  `malformed-stream` (`crashed` with the parse detail, no throw);
  `cost-unknown` (`costMicroUsd: null`, never zero); `manifest-agrees`
  (tier matches tokens); `records-agree` (the `session.init` and
  `session.result` records from the driver equal the engine seam's).
  `runConformance(command, options)` runs every case and returns
  `{driver, passed: [...], failed: [{name, detail}]}`.
- **B-3 (who runs it).** `conformance.test.ts` runs the table over the
  fixture driver always, and over each real driver whose binary can be
  discovered (`STATECRAFT_CLAUDE_BIN` or `claude` on PATH for the Claude
  driver, `STATECRAFT_CODEX_BIN` or `codex` for Codex) with the real
  binary replaced by a fake provider script per case, as the parity
  tests do; a real driver that cannot be discovered is skipped with a
  message, never failed. `bun run conformance` runs it alone.
- **B-4 (the engine knows no provider).** `PROVIDER_STRINGS` in the
  engine bundle test gains the Codex strings (`codex exec`, `--sandbox`,
  `workspace-write`, `OPENAI_API_KEY`, `--dangerously-bypass`) and the
  fixture's marker; the engine bundle must contain none, and each
  driver bundle must contain its own.
- **B-5 (qualification).** `scripts/qualify-provider.ts <name>` runs the
  named driver with the real binary through one fast-tier turn over a
  fixture repository with a prompt that asks for one file write and one
  refused command, and writes
  `docs/evidence/qualification/<name>.json`: `{schemaVersion: 1, driver,
  binary: {path, version}, platform: {os, arch}, capabilities:
  {declared, applied, degraded}, denials, classification, recordedAt}`.
  The record is committed evidence; the script refuses to overwrite one
  whose binary version matches unless `--force`.
- **B-6 (qualified or not, never refused).** `qualificationFor(name,
  binaryVersion)` in `qualification.ts` reads the directory and returns
  `{qualified: boolean, record}`. The driver seam asks the provider its
  binary version (the core gains `provider.binary_version()`, journaled
  in `session.init` as `binaryVersion`) and journals `driver.unqualified`
  `{driver, binaryVersion, recorded}` once per driver per daemon life
  when no record matches. The posture cell appends ` (unqualified)`
  after the driver name when the project's driver has no record for the
  binary the seam last saw. Nothing refuses.

## 4. Functional requirements

- **FR-001.** Fixture driver tests: each script produces the events its
  case expects; the manifest follows the environment; the marker file
  proves spawn or its absence.
- **FR-002.** Conformance tests: every case passes over the fixture
  driver; over each discoverable real driver with faked binaries; a
  deliberately broken fixture (`STATECRAFT_FIXTURE_BREAK=<case>`) fails
  exactly that case, so the suite cannot pass vacuously.
- **FR-003.** Bundle tests: the extended string sets hold.
- **FR-004.** Qualification tests: the fold over the evidence directory;
  `driver.unqualified` journaled once; the render.
- **FR-005.** The script over the fixture driver writes a record that
  the fold reads back as qualified.

## 5. Acceptance

- `cd members && bun run typecheck && bun test` green; `cargo test
  --workspace --locked`, clippy, fmt clean; `make gate` green.
- Recorded in the status note: `qualify-provider claude` and
  `qualify-provider codex` each write a record from a live turn on the
  machine of record, both committed under `docs/evidence/qualification/`,
  and a project using each driver renders without ` (unqualified)`.

## Verification

```verify:cli
cd members && bun test src/members/conformance.test.ts src/members/engine-bundle.test.ts src/orchestrator/qualification.test.ts
```

```verify:cli
cd members && bun run build:member:driver-fixture && bun run conformance
```

## Status (2026-09-09)

Implemented. `statecraft-driver-fixture` speaks the 043 wire with a
scriptable provider, a manifest from its environment, a marker file at
spawn and a break knob; `conformance.ts` carries the seven cases and the
harness, with the fixture target and the Claude and Codex targets over
fake providers per case; `conformance.test.ts` runs the fixture always,
each Rust driver it can build, and the broken fixture for four cases.
Building the suite found the gap doc 04's table predicted: neither Rust
driver reached a hung provider's descendants, so the core now spawns the
provider as its own process group leader and signals the group
(`hang-killed` passes on all three targets, and the broken fixture that
keeps its child alive fails it). The core and the in-process session
journal `binaryVersion` in `session.init`, read through a bounded
`--version` probe (1.5 s, a descendant holding the pipe is not waited
for); `qualification.ts` folds the evidence directory and the seam
journals `driver.unqualified` once per process driver when no record
names the version; the project row serves `driverQualified` and the
posture cell appends ` (unqualified)`. `scripts/qualify-provider.ts`
drove one live turn of each real provider over a drifting clone of this
checkout: Claude Code 2.1.267 wrote the file and was refused once by the
PR gate, `completed` in 27.6 s; Codex 0.153.4 likewise, `completed` in
18.2 s with `applied: ["hook-enforcement"]` and `degraded: ["cost"]`.
Both records are committed under `docs/evidence/qualification/`. The
bundle test's forbidden set is the Codex driver's three flags:
`workspace-write` is a capability token both sides carry (120 B-1) and
`OPENAI_API_KEY` is the deny list's (121 D-6), so neither is forbidden.
The members suite (963) and the workspace are green.

## 6. Out of scope

A sensor conformance suite beyond 115 FR-003. Qualifying against a
hosted or containerized executor. Refusing an unqualified driver (doc 04
D57: shown and journaled, not locked out). A Cursor or third-provider
driver itself.

## 7. Resolved decisions

D-1 (2026-09-09). Born approved on doc 04 §9's authority (119 D-1).

D-2 (2026-09-09). The fixture driver is a member, not a test helper,
because the suite's first claim is that a driver built to the contract
passes it, and a helper that bypasses the wire proves less.

D-3 (2026-09-09). The real drivers run the suite with faked binaries,
as the parity tests do; the live binary runs once, in qualification,
and its record is committed. A suite that needed a live harness would
not run in CI, and one that never touched a live harness would qualify
nothing.

D-5 (2026-09-09). The fixture driver's manifest is computed in its own
module rather than added to `MEMBER_MANIFESTS`, whose entrypoint test
walks the shipped members' binaries; the fixture ships for the suite,
not as a member the umbrella dispatches to.

D-6 (2026-09-09). The provider runs as its own process group leader and
the kill signals the group. The alternative, walking descendants by
parent pid, races the fork the descendant is in the middle of; a group
is what the kernel gives for exactly this.

D-4 (2026-09-09). Unqualified runs. A new binary version on the
operator's machine is a routine event; refusing it would stall every
project until someone re-ran the script, and the evidence question (which
runs the record covers) is answered by the journal either way.
