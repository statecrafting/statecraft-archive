---
id: "120-capability-contract"
title: "The capability contract: a closed token vocabulary, required refuses before spawn, preferred degrades in the journal"
status: approved
created: "2026-09-09"
implementation: complete
risk: high
depends_on:
  - "119-admission-and-outcome"
  - "111-contract-crate"
  - "043-driver-seam"
  - "032-execution-profiles"
  - "042-member-contract"
establishes:
  - "members/src/orchestrator/capabilities.ts"
  - "members/src/orchestrator/capabilities.test.ts"
extends:
  # 111 owns the wire: the token enum, the manifest field, the request field.
  - { spec: "111-contract-crate", unit: { kind: directory, path: "crates/statecraft-contract/" }, nature: additive }
  - { spec: "111-contract-crate", unit: "members/src/members/contract-fixtures.test.ts", nature: additive }
  # 042 owns the TypeScript manifest declarations.
  - { spec: "042-member-contract", unit: "members/src/members/manifest.ts", nature: additive }
  - { spec: "042-member-contract", unit: "members/src/members/manifest.test.ts", nature: additive }
  # 043 owns the seam where the refusal lives and the wire request.
  - { spec: "043-driver-seam", unit: "members/src/orchestrator/driver.ts", nature: additive }
  - { spec: "043-driver-seam", unit: "members/src/orchestrator/driver.test.ts", nature: additive }
  - { spec: "043-driver-seam", unit: "members/src/members/driver-session.ts", nature: additive }
  - { spec: "043-driver-seam", unit: "members/src/members/driver-session.test.ts", nature: additive }
  # 032 owns the profile: the requirements field, its codec and render.
  - { spec: "032-execution-profiles", unit: "members/src/orchestrator/profile.ts", nature: additive }
  - { spec: "032-execution-profiles", unit: "members/src/orchestrator/profile.test.ts", nature: additive }
  # 023 and 028 own the CLI verbs that set and show the profile.
  - { spec: "023-orchestrator-cli", unit: "members/src/commands/orchestrator.ts", nature: additive }
  - { spec: "028-cli-projects", unit: "members/src/commands/orchestrator.test.ts", nature: additive }
  # 114 owns the core and the Claude provider.
  - { spec: "114-driver-port", unit: { kind: directory, path: "crates/statecraft-driver-core/" }, nature: additive }
  - { spec: "114-driver-port", unit: { kind: directory, path: "crates/statecraft-driver-claude/" }, nature: additive }
  - { spec: "114-driver-port", unit: "members/src/members/driver-parity.test.ts", nature: additive }
  # 116 owns the Codex provider.
  - { spec: "116-codex-driver", unit: { kind: directory, path: "crates/statecraft-driver-codex/" }, nature: additive }
  - { spec: "116-codex-driver", unit: "members/src/members/driver-codex.test.ts", nature: additive }
  # 014 owns the in-process session, which reports what it applied.
  - { spec: "014-session-driver", unit: "members/src/orchestrator/session.ts", nature: additive }
  - { spec: "014-session-driver", unit: "members/src/orchestrator/session.test.ts", nature: additive }
  # Every member builds a Manifest literal; the field is total on the type.
  - { spec: "112-sensor-port", unit: { kind: directory, path: "crates/statecraft-sensor-claude/" }, nature: additive }
  - { spec: "113-journal-port", unit: { kind: directory, path: "crates/statecraft-journal/" }, nature: additive }
  - { spec: "115-codex-sensor", unit: { kind: directory, path: "crates/statecraft-sensor-codex/" }, nature: additive }
  # 117's production-wiring test pins the Codex session.init, which gains applied.
  - { spec: "117-project-driver", unit: "members/src/orchestrator/project-driver.test.ts", nature: additive }
references:
  - { unit: { kind: file, path: "docs/design/04-the-governed-substrate.md" }, role: context }
summary: >
  The design doc 03 D39 deferred, decided in doc 04 §4. The contract crate
  gains a closed set of six capability tokens: tool-allowlist, max-turns,
  mcp-config, cost, workspace-write, hook-enforcement. A driver's manifest
  lists the tokens it supports; a session request carries what the run
  requires and what it prefers. The engine reads the manifest before
  spawning and refuses a required token the driver lacks without starting
  a process, generalizing 043 B-6's mcp-config refusal into the rule it
  was an instance of; a preferred token the driver lacks is journaled and
  the session runs. session.init carries the tokens the provider applied
  beside those it degraded, so the effective configuration is evidence.
  The tier stays as a summary derived from the token set.
---

# 120: The capability contract

## 1. Purpose

After 117 a project chooses its driver, and after doc 03 D34 the Codex
driver says what it could not apply. What no one can say yet is what a
run needs. `guarded` is a different protection under each driver, and
the only refusal the engine makes is keyed on one tier token and one
feature name. This spec gives the family the vocabulary: a run states
its requirements in provider-neutral tokens, a driver states its support
in the same tokens, and the engine decides before a process exists.

## 2. Territory

Owned: `members/src/orchestrator/capabilities.ts`, the engine's copy of
the vocabulary, the requirement derivation from a profile, and the
decision function; and its test.

Extended: the contract crate and its fixtures (111); the TypeScript
manifests (042); the driver seam and wire request (043); the profile,
its CLI and tests (032, 023, 028); the core and both providers (114,
116); the in-process session (014).

Not claimed: the sensors, the web UI, the stages (they pass the profile
through and are unchanged).

## 3. Behavior

- **B-1 (the vocabulary).** `Capability` in the contract crate is a
  closed kebab-case enum: `tool-allowlist`, `max-turns`, `mcp-config`,
  `cost`, `workspace-write`, `hook-enforcement`. `CAPABILITIES` in
  `capabilities.ts` is the same list in the same order; the contract
  fixture `capabilities.json` is the list both sides assert against.
  A token's meaning is fixed in the crate's doc comment and repeated
  here: `tool-allowlist`, the request's tool lists are enforced;
  `max-turns`, the turn cap is enforced; `mcp-config`, an MCP server set
  is hosted; `cost`, the provider reports cost; `workspace-write`, the
  provider confines writes to the repository; `hook-enforcement`, the
  project's hooks run.
- **B-2 (the manifest declares support).** `Manifest` gains
  `capabilities: Vec<Capability>`. The Claude driver declares the four
  request tokens and `hook-enforcement` (its permission modes do not
  confine writes to the repository, so it does not claim
  `workspace-write`); the Codex driver declares `workspace-write` and
  `hook-enforcement`; the sensor and engine declare none.
  `capabilityTier` is kept and must equal `reference` when the four
  request tokens (`tool-allowlist`, `max-turns`, `mcp-config`, `cost`)
  are all present and `basic` otherwise; the two boundary tokens do not
  enter the tier. `Manifest::parse` and `parseManifest` refuse a manifest
  whose tier disagrees with its tokens; a manifest without the field is
  an older member and is not checked. The fixtures gain
  `manifest-driver-codex.json`.
- **B-3 (the request states needs).** `SessionRequest` gains
  `requirements: { required: Vec<Capability>, preferred: Vec<Capability> }`,
  explicit and possibly empty; the schema version stays `1` because both
  parsers accept absence as empty. `DriverSessionRequest` and the wire
  request carry the same field.
- **B-4 (the profile derives them).** `ExecutionProfile` gains
  `require?: Capability[]`. `requirementsFor(profile, request)` in
  `capabilities.ts` returns the required set as the profile's `require`
  list, and the preferred set as the tokens the request actually uses:
  `tool-allowlist` when the profile carries a list or is `guarded`,
  `max-turns` when `maxTurns` is set, `mcp-config` when `mcpConfigPath`
  is set, `cost` always. A profile's `require` is set by `--require
  <token,...>` on `projects add` and `projects profile`, refused for an
  unknown token, rendered as ` requiring <tokens>` after the driver, and
  journaled in `session.init`'s profile like every other field.
- **B-5 (required refuses before spawn).** `createProcessDriver`'s
  `runSession` reads the manifest (as `tier()` does today) and computes
  `decide(manifest.capabilities, requirements)`. An unsupported required
  token journals `driver.refused` `{driver, required, unsupported}` and
  returns a synthesized `crashed` result whose detail names the tokens;
  no process is spawned. An unsupported preferred token journals
  `driver.degraded` `{driver, feature}` per token and the session runs.
  043 B-6's refusal is now the case `mcp-config ∈ required`; a verify
  stage that hosts a browser server puts `mcp-config` in `required`.
- **B-6 (the provider reports what it applied).** `spawn_extras` in the
  core is replaced by `applied(&SpawnSpec) -> Vec<Capability>`; the core
  computes `degraded` as the request's preferred and required tokens
  minus `applied`, and emits both as top-level `session.init` fields
  `applied` and `degraded`. The Claude provider applies every request
  token the request uses and `hook-enforcement`; the Codex provider
  applies `workspace-write` under `guarded` and `hook-enforcement`
  always, and its `degraded` list is what 116 B-8 fixed, in the same
  order. The tokens a request uses are: `tool-allowlist` when the
  profile is `guarded` or carries a list, `max-turns` when a cap is set,
  `mcp-config` when a path is set, `cost` always, plus whatever
  `requirements` names. `session.ts` emits the same two
  fields for the in-process session.
- **B-7 (the tier is derived).** `capability_tier()` on the `Provider`
  trait is replaced by `capabilities() -> &[Capability]`; the manifest's
  tier is computed from it by B-2's rule. Nothing in the engine reads the tier for a
  decision; `tier()` on the `Driver` interface remains for the posture
  cell and the tests that quote it.

## 4. Functional requirements

- **FR-001.** Contract tests: the enum round-trips every token; a
  manifest whose tier disagrees with its tokens is refused on both sides;
  the fixtures regenerate with `capabilities`, `requirements` and the
  Codex manifest, and `contract-fixtures.test.ts` asserts the new file
  list.
- **FR-002.** Capabilities tests: `requirementsFor` over each profile
  shape; `decide` refuses on any missing required token and lists every
  missing preferred one; the vocabulary matches the fixture.
- **FR-003.** Driver tests: a fake manifest lacking a required token
  yields `crashed` with `driver.refused` and no spawn; lacking a
  preferred token yields `driver.degraded` and a spawn; the mcp-config
  case behaves as 043 B-6's test expects.
- **FR-004.** Profile and CLI tests: `--require` round-trips, refuses an
  unknown token, renders; the list row for a project without `require`
  is byte-identical to before.
- **FR-005.** Rust tests: each provider's `applied` over a full request;
  the core's `session.init` carries `applied` and `degraded` disjoint and
  covering the request's tokens; the parity and Codex members tests pass
  with the new fields.

## 5. Acceptance

- `cd members && bun run typecheck && bun test` green; `cargo test
  --workspace --locked`, clippy, fmt clean; `make gate` green.
- A live smoke, recorded in the status note: a project with `--driver
  codex --require tool-allowlist` refuses its first session with
  `driver.refused` naming the token and spawns nothing; the same project
  with `--require workspace-write` runs one fast-tier turn whose
  `session.init` shows `applied` containing it.

## Verification

```verify:cli
cd members && bun test src/orchestrator/capabilities.test.ts src/orchestrator/driver.test.ts src/orchestrator/profile.test.ts src/members/manifest.test.ts src/members/contract-fixtures.test.ts src/members/driver-parity.test.ts src/members/driver-codex.test.ts
```

```verify:cli
cargo test --workspace --locked -p statecraft-contract -p statecraft-driver-core -p statecraft-driver-claude -p statecraft-driver-codex
```

## Status (2026-09-09)

Implemented. `Capability` and `Requirements` live in the contract crate
with `CapabilityTier::for_capabilities`; the manifest carries
`capabilities` (optional on the wire, D-4) and `Manifest::parse` refuses
a tier that disagrees with declared tokens; `SessionRequest` carries
`requirements`. The core's `Provider` gained `capabilities()` and
`applied()` in place of `capability_tier()` and `spawn_extras()`, and
`SpawnSpec::requested()` is the one derivation of what a request uses,
so `session.init` carries `applied` and `degraded` disjoint and covering
it on both drivers; the TypeScript in-process session emits the same two
fields and the parity records stay identical. The engine's
`capabilities.ts` mirrors the vocabulary against the `capabilities.json`
fixture; `driver.ts` reads the manifest before every first session,
journals `driver.degraded` per missing preferred token and
`driver.refused` with a synthesized `crashed` for a missing required one,
and 043 B-6's mcp-config case is the same path (its record shape kept).
The profile carries `require`, set by `--require` on both verbs, shown as
`require:` in the detail and ` requiring <tokens>` in the posture cell.
The members suite (912) and the workspace are green; fourteen fixtures.
Two observations from the build: a guarded Codex posture now reports
`tool-allowlist` degraded even without an explicit list, because the
guarded baseline is a list the driver cannot apply (117's test updated to
say so); and every driver's first session is preceded by a manifest
read, which the kill test now waits for instead of sleeping. The live
smoke through the production deps: a guarded project with `--driver
codex --require tool-allowlist` had its first session refused with
`driver.refused` naming the token and no process spawned; the same
project with `--require workspace-write` drove one fast-tier turn of the
real Codex (0.153.4) to `completed` in 7.1 s, `session.init` reading
`applied: ["workspace-write", "hook-enforcement"]` and `degraded:
["tool-allowlist", "cost"]`.

## 6. Out of scope

Renaming the profile's tool lists to neutral names (the payload of
`tool-allowlist` stays provider-specific, doc 04 D44). Qualification of
a claimed token against a live binary (124). A `restricted` or
sandbox-refusing startup mode for Claude.

## 7. Resolved decisions

D-1 (2026-09-09). Born approved on doc 04 §9's authority (119 D-1).

D-2 (2026-09-09). Six tokens, not a grammar. `workspace-write` is a
claim about confinement, and the Claude driver does not make it: its
permission modes gate prompts, they do not fence the filesystem, so a
Claude manifest naming the token would be the false evidence this spec
exists to prevent. The tier is therefore derived from the four request
tokens alone, which keeps 042 B-8's meaning (the richest driver for the
engine's requests) and every fixture that says `reference`. The four are what the Codex
driver already declares; the two are what 121 and 122 need to require.
A token is added by a spec that names its enforcement, never by a driver
that wants to advertise one.

D-3 (2026-09-09). The refusal is synthesized as `crashed`, as 043 B-6
did, rather than a new termination kind. The journal record
`driver.refused` is the authoritative fact; the classification enum is
consumed by nine tables and a tenth value would touch them all for a
case the record already distinguishes.

D-5 (2026-09-09). A guarded posture without an explicit list still asks
for `tool-allowlist`: the guarded baseline is a list, and a driver that
cannot apply it has degraded the posture whether or not the operator
typed the list. 116 B-8's order is kept; its content widens by this one
case, which the journal now says out loud.

D-4 (2026-09-09). The schema version stays at `1`. Both parsers treat an
absent `requirements` as empty and an absent `capabilities` as none, so
an old driver and a new engine (or the reverse) keep working, with the
new engine refusing nothing it cannot see support for. A required token
against an old manifest is therefore a refusal, which is the safe
reading.
