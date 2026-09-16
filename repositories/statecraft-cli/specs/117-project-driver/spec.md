---
id: "117-project-driver"
title: "The driver is part of the posture: a per-project driver choice through the profile, late-bound at every spawn"
status: approved
created: "2026-09-09"
implementation: complete
risk: medium
depends_on:
  - "116-codex-driver"
  - "043-driver-seam"
  - "032-execution-profiles"
  - "040-session-models"
establishes:
  - "members/src/orchestrator/project-driver.test.ts"
extends:
  # 032 owns the profile: the field, its codec, its refusal and its render.
  - { spec: "032-execution-profiles", unit: "members/src/orchestrator/profile.ts", nature: additive }
  - { spec: "032-execution-profiles", unit: "members/src/orchestrator/profile.test.ts", nature: additive }
  # 043 owns the seam: the driver-per-name facade and the wire request.
  - { spec: "043-driver-seam", unit: "members/src/orchestrator/driver.ts", nature: additive }
  - { spec: "043-driver-seam", unit: "members/src/orchestrator/driver.test.ts", nature: additive }
  # 021 owns the production wiring, where the facade replaces the fixed driver.
  - { spec: "021-orchestrator-daemon", unit: "members/src/orchestrator/daemon.ts", nature: additive }
  # 023 and 028 own the CLI: the flag, the detail line, the usage text.
  - { spec: "023-orchestrator-cli", unit: "members/src/commands/orchestrator.ts", nature: additive }
  - { spec: "028-cli-projects", unit: "members/src/commands/orchestrator.test.ts", nature: additive }
  # 022 owns the API: one operator-facing message names the field.
  - { spec: "022-http-api-and-events", unit: "members/src/orchestrator/api/server.ts", nature: additive }
  # 114 owns the Rust profile; both sides emit the field so parity holds.
  - { spec: "114-driver-port", unit: { kind: symbol, id: "statecraft_driver_core::Profile" }, nature: additive }
  - { spec: "114-driver-port", unit: { kind: symbol, id: "statecraft_driver_core::tests" }, nature: additive }
  # 111 owns the wire fixture both languages parse.
  # 111 owns the contract crate whole; the wire fixture and the test that
  # writes it gain the field.
  - { spec: "111-contract-crate", unit: { kind: directory, path: "crates/statecraft-contract/" }, nature: additive }
  - { spec: "111-contract-crate", unit: "members/src/members/contract-fixtures.test.ts", nature: additive }
  # 114's and 116's crate tests build a Profile and name the new field.
  - { spec: "114-driver-port", unit: { kind: symbol, id: "statecraft_driver_claude::tests" }, nature: additive }
  - { spec: "116-codex-driver", unit: { kind: symbol, id: "statecraft_driver_codex::tests" }, nature: additive }
references:
  - { unit: { kind: file, path: "docs/design/03-the-codex-provider.md" }, role: context }
summary: >
  Doc 02 §11 named the one engine change a second driver needs, and doc
  03 D38 decided where it goes: the execution profile gains an optional
  driver field, claude or codex, absent meaning claude so every existing
  chain folds unchanged. It is registry state like mode, set through the
  same project.profile.set record by the same CLI verb and API route,
  journaled in session.init with the rest of the profile, and rendered
  wherever the posture is. The engine reads it late: the daemon's one
  driver per project becomes a facade that resolves the profile at each
  spawn and keeps one process driver per name, so a driver set
  mid-flight reaches the next session rather than the next daemon
  restart, which is the promise 032 B-4 made for the mode. Nothing else
  in the engine learns the word codex. The Rust profile emits the field
  too, so the journal a Rust driver writes and the one the TypeScript
  driver writes stay identical. Proven by driving the Rust Codex driver
  from the production wiring over a project whose profile says codex.
---

# 117: The driver is part of the posture

## 1. Purpose

After 116 the family has two drivers and the engine can run either, but
only by an environment variable that names a binary. A project's driver
is a property of the project, decided by whoever armed it, and it
belongs with the other consent that lives on the registry chain: the
posture. This spec makes it that, and makes the engine read it the way
032 B-4 reads the mode, at spawn time.

## 2. Territory

Owned: `members/src/orchestrator/project-driver.test.ts`, the test that
drives the production wiring end to end over a project whose profile
names each driver.

Extended: `profile.ts` and its test (032), `driver.ts` and its test
(043), `daemon.ts` (021), the CLI and its test (023, 028), one message
in the API server (022), the Rust `Profile` and its round-trip test
(114), the wire fixture (111).

Not claimed: `projects.ts`, the API types, the state payload, the typed
client and the web bundle's types, all of which carry the whole profile
through unchanged; the web UI, which renders no posture today (a gap
that predates this spec and is not widened by it).

## 3. Behavior

- **B-1 (the field).** `ExecutionProfile` gains `driver?: "claude" |
  "codex"`. `profilePayload` emits `driver` as the name or `null`, the
  explicit-null convention 032 B-5 and 040 use. `parseProfile` reads it,
  accepts absence as `undefined`, and refuses any other value the way it
  refuses an unknown mode. The legacy and default-registration profiles
  carry no driver, so absence stays the default rather than a
  materialized `claude`.
- **B-2 (set and shown).** `projects add` and `projects profile` accept
  `--driver <name>`; the profile the verb assembles carries it, and the
  usage text says so. The detail view prints a `driver:` line after
  `models:`, `(default)` when absent. `renderProfile` appends ` via
  <name>` when a driver is set, so the list row and every surface that
  prints the posture shows a non-default driver and prints exactly what
  it printed before for a default one. The API's `POST
  .../profile` message names the field; the payload already carries the
  whole profile.
- **B-3 (late-bound at the spawn).** `driver.ts` gains
  `createProfileDriver({profile, env})`, a `Driver` whose `name`, `tier`
  and `runSession` resolve the `ProfileSource` at each call, pick
  `profile.driver ?? DEFAULT_DRIVER_NAME`, and delegate to one process
  driver per name, created on first use and kept. `createProductionDaemonDeps`
  uses it in place of `createProcessDriver()`, so the runner the build,
  ship and shepherd stages share, the browser verifier, and the daemon's
  `runSession` all follow the project's profile at every spawn. The
  synthesis session in the CLI, which has the folded project in hand,
  passes the name directly.
- **B-4 (the env knob still wins).** `STATECRAFT_DRIVER_BIN` keeps 043
  B-8's precedence over discovery, name included: it is the operator's
  explicit binary for a run, and every test relies on it. A profile
  naming a driver whose member cannot be discovered fails the session as
  `crashed` naming the three locations searched (043 B-5), which is the
  existing behavior, now reachable.
- **B-5 (journaled, on both sides).** `session.init`'s `profile` carries
  `driver` because the payload does. The Rust `Profile` gains the same
  optional field, emits it in `payload()` and reads it in
  `from_payload()`, so 114's parity test still finds the two drivers'
  records identical and the 111 wire fixture, regenerated, carries it.
- **B-6 (nothing else knows).** The engine bundle still contains no
  provider invocation string (043's test); the only places the word
  `codex` appears in the engine are the driver-name enum and its
  refusal message.

## 4. Functional requirements

- **FR-001.** Profile tests: payload and parse round-trip with and
  without a driver; an unknown driver refuses; the legacy fold carries
  none; `renderProfile` with a driver.
- **FR-002.** Driver tests: the facade resolves the name per call from a
  function source, keeps one process driver per name, reports the
  current name and tier, and forwards `runSession` to the driver the
  profile names at that moment.
- **FR-003.** CLI tests: `projects profile <name> guarded --driver codex`
  sends the field; `--driver nope` is refused with the accepted names;
  the detail view prints the `driver:` line; the list row for a default
  project is byte-identical to before.
- **FR-004.** The owned test: `createProductionDaemonDeps` with a
  profile source that names `codex`, `STATECRAFT_DRIVER_BIN` at the Rust
  Codex binary and a fake `codex` script, drives a runner session to a
  `completed` result whose `session.init` profile says `codex` and
  whose `codexBin` names the script; flipping the source to `claude`
  between two sessions makes the second one go to a fake Claude driver.
- **FR-005.** The Rust round-trip test covers the field; the contract
  fixtures test passes over the regenerated fixture; 114's and 116's
  members tests pass unchanged.

## 5. Acceptance

- `cd members && bun run typecheck && bun test` green; `cargo test
  --workspace`, clippy, fmt clean.
- A live smoke, recorded in the status note: a project registered with
  `--driver codex` shows `via codex` in `projects` and `driver: codex`
  in its detail, and the production wiring drives one fast-tier turn of
  the real Codex from it.

## Verification

```verify:cli
cd members && bun test src/orchestrator/project-driver.test.ts src/orchestrator/profile.test.ts src/orchestrator/driver.test.ts src/members/driver-parity.test.ts src/members/contract-fixtures.test.ts
```

```verify:cli
cargo test --workspace --locked -p statecraft-driver-core -p statecraft-contract
```

## Status (2026-09-09)

Implemented. The field rides through the profile codec on both sides
(TypeScript and Rust emit `driver`, the 111 wire fixture carries
`"driver": "codex"` and both parsers read it); the facade
`createProfileDriver` replaces the fixed driver in
`createProductionDaemonDeps` and is exercised by the owned test, which
built the Rust Codex driver, put it in a managed member directory beside
a fake Claude member, and watched the first session go to Codex and the
second to Claude after the profile source flipped, with no rebuild in
between. The CLI test covers `--driver` on both verbs, the refusal
naming the accepted drivers, the `via codex` cell and the `driver:`
line; the list row for a default project is byte-identical to before.
The whole members suite (887) and the workspace (193 plus the new Rust
cases) are green. The live smoke registered a project with a guarded
posture and `driver: "codex"`, rendered `guarded (9 baseline tools) via
codex`, and drove one fast-tier turn of the real Codex through the
production deps to `completed` in 6.0 s, `session.init` carrying
`profile.driver: "codex"`, `codexBin` and `degraded: ["cost"]`, and the
transcript path resolved to the rollout.

## 6. Out of scope

A provider-neutral posture vocabulary (doc 03 D39). Rendering the
posture in the web UI. A per-stage driver (one project, one driver).
The Codex harness (118).

## 7. Resolved decisions

D-1 (2026-09-09). Born approved on doc 03 §7's authority (115 D-1).

D-2 (2026-09-09). Late-bound through a facade, not read once when the
daemon's deps are built. The scheduler caches deps per project for the
process's life (standby.ts), so an eager read would freeze the driver
until restart, the exact failure 032 B-4 exists to prevent for the
mode. One process driver per name is kept because each holds its own
lazily resolved command and tier.

D-3 (2026-09-09). The env knob keeps precedence over the profile's name.
The alternative, refusing to run when the profile and the knob disagree,
would break every test and every one-off run that points the seam at a
built binary; the journal's `session.init` carries both the profile's
name and the binary that ran, so the disagreement is visible.

D-4 (2026-09-09). The driver rides on the profile, not on a record of
its own, for the reason 040 D-2 gave for the model pair: it answers the
same question the mode does.
