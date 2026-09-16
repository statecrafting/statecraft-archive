---
id: "119-admission-and-outcome"
title: "The floor reads before it writes, the merge names its head, and a denial survives a completed turn"
status: approved
created: "2026-09-09"
implementation: complete
risk: high
depends_on:
  - "118-codex-harness"
  - "041-project-gate-contract"
  - "016-stage-build"
  - "017-stage-ship"
  - "018-stage-shepherd"
  - "014-session-driver"
  - "114-driver-port"
  - "116-codex-driver"
establishes:
  - "members/src/orchestrator/admission.test.ts"
extends:
  # 041 owns the floor and its one composer.
  - { spec: "041-project-gate-contract", unit: "members/src/orchestrator/gate-contract.ts", nature: additive }
  - { spec: "041-project-gate-contract", unit: "members/src/orchestrator/gate-contract.test.ts", nature: additive }
  # 016 owns the build stage: the base resolution, the suite it runs, the evidence.
  - { spec: "016-stage-build", unit: "members/src/orchestrator/stages/build.ts", nature: additive }
  - { spec: "016-stage-build", unit: "members/src/orchestrator/stages/build.test.ts", nature: additive }
  # 017 owns the GitHub seam and mergePr.
  - { spec: "017-stage-ship", unit: "members/src/orchestrator/stages/ship.ts", nature: additive }
  - { spec: "017-stage-ship", unit: "members/src/orchestrator/stages/ship.test.ts", nature: additive }
  # 018 owns the merge call and the remediation suite.
  - { spec: "018-stage-shepherd", unit: "members/src/orchestrator/stages/shepherd.ts", nature: additive }
  - { spec: "018-stage-shepherd", unit: "members/src/orchestrator/stages/shepherd.test.ts", nature: additive }
  # 014 owns the in-process session and its result shape.
  - { spec: "014-session-driver", unit: "members/src/orchestrator/session.ts", nature: additive }
  - { spec: "014-session-driver", unit: "members/src/orchestrator/session.test.ts", nature: additive }
  # 043 owns the driver seam that carries the result through the wire.
  - { spec: "043-driver-seam", unit: "members/src/orchestrator/driver.ts", nature: additive }
  - { spec: "043-driver-seam", unit: "members/src/orchestrator/driver.test.ts", nature: additive }
  # 021 owns the daemon, which threads the resolved base into the stages.
  - { spec: "021-orchestrator-daemon", unit: "members/src/orchestrator/daemon.ts", nature: additive }
  # 031 owns the export policy: the denial samples are stripped like every tail.
  - { spec: "031-journal-export", unit: "members/src/orchestrator/export.ts", nature: additive }
  - { spec: "031-journal-export", unit: "members/src/orchestrator/export.test.ts", nature: additive }
  # 111 owns the wire result; it gains the denial fields and their fixtures.
  - { spec: "111-contract-crate", unit: { kind: directory, path: "crates/statecraft-contract/" }, nature: additive }
  - { spec: "111-contract-crate", unit: "members/src/members/contract-fixtures.test.ts", nature: additive }
  # 114 owns the core and the Claude provider; both learn the denial event.
  - { spec: "114-driver-port", unit: { kind: directory, path: "crates/statecraft-driver-core/" }, nature: additive }
  - { spec: "114-driver-port", unit: { kind: directory, path: "crates/statecraft-driver-claude/" }, nature: additive }
  - { spec: "114-driver-port", unit: "members/src/members/driver-parity.test.ts", nature: additive }
  # 116 owns the Codex provider.
  - { spec: "116-codex-driver", unit: { kind: directory, path: "crates/statecraft-driver-codex/" }, nature: additive }
  - { spec: "116-codex-driver", unit: "members/src/members/driver-codex.test.ts", nature: additive }
  # The test fixtures that build a SessionResult by hand gain the two fields
  # (the type is total): 037, 035, 028 own theirs; 021 and 026 own the
  # daemon and standby fakes.
  - { spec: "037-defect-capture", unit: "members/src/orchestrator/adopt/defects.test.ts", nature: additive }
  - { spec: "035-corpus-synthesis", unit: "members/src/orchestrator/adopt/synthesis.test.ts", nature: additive }
  - { spec: "028-cli-projects", unit: "members/src/commands/orchestrator.test.ts", nature: additive }
  - { spec: "021-orchestrator-daemon", unit: "members/src/orchestrator/daemon.test.ts", nature: additive }
  - { spec: "026-standby-daemon", unit: "members/src/orchestrator/standby.test.ts", nature: additive }
  # 113 mirrors the export policy in Rust; the version bump is on both sides.
  - { spec: "113-journal-port", unit: { kind: directory, path: "crates/statecraft-journal/" }, nature: additive }
  # 110 owns docs/design/; doc 04 is this sequence's record, as 115 claimed doc 03.
  - { spec: "110-corpus-merge", unit: "docs/design/04-the-governed-substrate.md", nature: additive }
references:
  - { unit: { kind: file, path: "docs/design/04-the-governed-substrate.md" }, role: context }
summary: >
  Three corrections doc 04 §2 found in the loop that every later boundary
  stands on. The engine's gate floor becomes read-only (spec-spine check,
  lint, couple) with its base resolved to a commit at stage start and
  journaled, so a stale committed registry is refused rather than repaired
  and the coupling verdict names the revision it compared against (D42).
  The merge sends the head sha shepherd watched go green and refuses one it
  did not (D43). A session's result carries the refusals its harness
  reported as a count and a bounded sample read from the provider's
  structured event, independent of the classification, so a hook refusal
  followed by a completed turn is evidence and not silence (D41).
---

# 119: The floor, the head, the denial

## 1. Purpose

Doc 04 §2 lists four findings from the Codex sequence; this spec closes
the three that live in the engine's own correctness. None of the later
boundaries (a receipt, a broker, a conformance suite) is worth building
over a floor that repairs what it should refuse, a merge that trusts a
moving head, or an outcome that forgets a denial.

## 2. Territory

Owned: `members/src/orchestrator/admission.test.ts`, the test that drives
the three behaviors end to end through the stage seams with a fake
driver, a fake GitHub client and a fixture repository.

Extended: the floor and its test (041); build, ship and shepherd and
their tests (016, 017, 018); the in-process session and the driver seam
(014, 043); the daemon's stage wiring (021); the export policy (031);
the contract crate and its fixtures (111); the driver core and both
providers with their parity tests (114, 116).

Not claimed: the Makefile and CI workflow, whose gate is already
read-only; the web UI; the profile.

## 3. Behavior

- **B-1 (the floor is read-only).** `gateFloor(base)` replaces the
  constant `GATE_COMMANDS` as the source of the floor and returns exactly
  `spec-spine check --fail-on-warn`, `spec-spine lint --fail-on-warn`,
  `spec-spine couple --base <base> --head HEAD`. `gateSuiteFor(contract,
  base)` composes the floor with the contract's commands as before.
  `GATE_COMMANDS` remains exported as `gateFloor("origin/main")` for
  the prompt text and the tests that quote it, and nothing runs it.
  `spec-spine compile` and `spec-spine index` appear in the engine only
  in the bracket (016 D-8) that regenerates before the flip commit.
- **B-2 (the base is a commit).** The build and shepherd runners gain
  `resolveBase(defaultBranch)`: `git fetch origin <branch>` then `git
  rev-parse origin/<branch>`, returning the sha. Each stage resolves it
  once at start, passes it to every floor it runs, and journals it:
  `stage.build.bracket` and `stage.build.gate` gain `baseSha`, and
  shepherd's remediation journals `stage.shepherd.base` `{specId,
  baseSha}` before the suite runs. A base that cannot be resolved is a
  preflight refusal `base-unresolved` naming the branch and stderr.
- **B-3 (staleness is a refusal).** With B-1, a candidate whose committed
  shards are stale fails the floor at `check` with exit 2, which the
  preflight reports as `gate-red-at-base` and the post-session evaluation
  as a failing gate, the same as any red command. No stage regenerates on
  the operator's behalf outside the bracket.
- **B-4 (the merge names its head).** `GitHubClient.mergePr(number,
  method, expectedHeadSha)` sends `-f sha=<expectedHeadSha>` with the
  merge method. A response whose status is 405 or 409, or whose body
  carries no `sha`, is a `MergeRefusedError` carrying the expected head
  and the message. Shepherd, after the last green watch, re-reads the PR
  head through `prForBranch`; if it differs from the sha the watch
  followed, or if `mergePr` refuses, it journals
  `stage.shepherd.merge-refused` `{specId, prNumber, watchedSha,
  currentSha, reason}` and finishes `failed` with `needsHuman`. No second
  merge attempt is made in that run.
- **B-5 (denials are read from the event).** The `Provider` trait gains
  `denial_in_event(&Value) -> Option<String>`, default `None`. The Claude
  provider answers for a `user` event whose `tool_result` content has
  `is_error: true` and matches its hook-blocked rule; the Codex provider
  answers for an `item.completed` whose item output matches its
  hook-blocked rule. The core counts every answer and keeps the first
  three, each bounded to 512 bytes. The result carries `denials: u64` and
  `denialSamples: Vec<String>`; `session.result` carries `denials` and
  `denialSamples`. The classification is unchanged: a completed turn with
  denials is `completed`.
- **B-6 (the wire and the engine carry them).** `SessionResult` in the
  contract crate, the TypeScript `SessionResult`, `synthesizedResult`,
  the fixtures `session-result-*.json` and the parity suites all gain the
  two fields; a synthesized result has zero denials. `SessionEvidence` in
  build gains `denials: number`; `ShipSessionEvidence` gains both fields.
  The export policy strips `denialSamples` like every other tail.
- **B-7 (build records what it saw).** When the first or the remediation
  session completes with `denials > 0`, build journals
  `stage.build.denials` `{specId, round, sessionId, denials, samples}`
  before evaluating completion, and `stage.build.result` gains
  `denials: number` summed over the round's sessions. The hook-blocked
  short-circuit (016 B-4) is unchanged for a session that classifies
  `hook-blocked`.
- **B-8 (the in-process session agrees).** `session.ts` reads the same
  Claude event shape and reports the same fields, so the parity test
  finds the Rust and TypeScript records identical over a fake provider
  that emits one denial then completes.

## 4. Functional requirements

- **FR-001.** Gate-contract tests: `gateFloor` yields the three commands
  with the base spliced in; `gateSuiteFor` composes it; no command in the
  floor is `compile` or `index`.
- **FR-002.** Build tests: the preflight suite and the post-session suite
  both run with the resolved sha; `stage.build.gate` carries `baseSha`; a
  fixture whose `check` exits 2 is `gate-red-at-base`; an unresolvable
  base refuses `base-unresolved`.
- **FR-003.** Ship and shepherd tests: the fake `mergePr` records the
  expected head; a fake whose PR head changes after the green watch does
  not merge and journals `merge-refused`; a fake `mergePr` that refuses
  yields `failed` with `needsHuman` and exactly one merge call.
- **FR-004.** Rust tests: the Claude and Codex providers each recognize
  their denial event from a fixture line and ignore an ordinary tool
  result; the core counts, samples and bounds; the fixtures regenerate
  with the two fields; the parity and Codex members tests pass with a
  fake that emits a denial and completes, and the records match.
- **FR-005.** The owned test drives a build round over a fixture corpus
  through `runBuildStage` with a fake driver that denies once and
  completes, and asserts the journal holds `stage.build.gate` with
  `baseSha`, `stage.build.denials`, and a `completed` session evidence
  with `denials: 1`; then drives shepherd over a fake GitHub client whose
  head moves after green and asserts the refusal.

## 5. Acceptance

- `cd members && bun run typecheck && bun test` green; `cargo test
  --workspace --locked`, clippy, fmt clean; `make gate` green.
- A live smoke, recorded in the status note: the real Codex driver over
  the 118 fixture checkout drives one session that the PR gate refuses;
  `session.result` shows `denials: 1` beside `classification: completed`.

## Verification

```verify:cli
cd members && bun test src/orchestrator/admission.test.ts src/orchestrator/gate-contract.test.ts src/orchestrator/stages/build.test.ts src/orchestrator/stages/shepherd.test.ts src/members/driver-parity.test.ts src/members/driver-codex.test.ts src/members/contract-fixtures.test.ts
```

```verify:cli
cargo test --workspace --locked -p statecraft-driver-core -p statecraft-driver-claude -p statecraft-driver-codex -p statecraft-contract
```

## Status (2026-09-09)

Implemented. The floor is `gateFloor(base)`: check, lint, couple at a sha
the stage resolved (`resolveBaseSha`, origin first, the local branch when
no remote answers, D-5), journaled in `stage.build.bracket`,
`stage.build.gate` and `stage.shepherd.base`; `compile` and `index` run
only in the bracket. `mergePr` sends `sha=<head>` and raises
`MergeRefusedError` on 405 or 409; shepherd re-reads the head after the
green watch and journals `stage.shepherd.merge-refused` on a move or a
refusal, finishing `failed` with `needsHuman`. The result carries
`denials` and `denialSamples` on both sides of the wire (contract
fixtures regenerated, the completed fixture carrying one), read by
`denial_in_event` (Claude: a flagged `tool_result` matching the
hook-blocked rule; Codex: a refused `command_execution` item) and, per
D-6, by `denials_in_stderr` over the bounded tail (Codex's router line).
Build journals `stage.build.denials` and sums `denials` into the result;
the export policy is version 2 on both sides with the samples stripped.
The members suite (900) and the workspace are green; the parity suites
carry a `denied` fixture on each driver. The live smoke: the real Codex
(0.153.4) over a clone of this checkout with `src/main.rs` edited on a
branch, asked to run `gh pr create`, was refused by the generated PR
gate; the stream carried no `command_execution` item for the blocked
command, only two `agent_message` items quoting the refusal and the
router's line on stderr, and `session.result` read `classification:
completed`, `denials: 1`, the sample being that line. The 118
observation is therefore exact, and D-6 is the reader the evidence
requires.

## 6. Out of scope

The candidate worktree and the receipt (121). The broker (122). A
capability token for `hook-enforcement` (120). Widening the
classification enum. Detecting a denial from the model's prose.

## 7. Resolved decisions

D-1 (2026-09-09). Born approved on doc 04 §9's authority: the corpus
owner asked for the six increments to be specified and built to
completion in one instruction, and the decisions are recorded in doc 04
rather than left to the session.

D-2 (2026-09-09). The floor has three commands, not the Makefile's four.
`index coverage --fail-on-untraced` is this repository's ownership
policy; a project inherits the floor, and its own coverage rule belongs
in its gate contract (041), where `projects gate` can set it.

D-3 (2026-09-09). The denial is read from the harness's structured event
for a refused tool call, and the provider decides the shape. The
assessment's warning stands: a phrase in the final text is a quotation,
not a verdict. The samples exist for a human reading the evidence and
are stripped from the export.

D-4 (2026-09-09). A merge refusal needs a human. The alternative, waiting
for the new head's checks and merging that, would merge a revision no
receipt (121) and no remediation round examined.

D-5 (2026-09-09). A repository with no reachable origin resolves the base
from its local default branch. B-2 names the fetch and the remote ref; a
fixture world and a checkout without a remote have neither, and refusing
them would take every stage test offline. The sha is journaled either
way, so which one answered is in the record.

D-6 (2026-09-09). The Codex harness reports a refusal on its own stderr
(the tool router's log line 118 observed), not on the stream, where only
the agent's quotation appears. The `Provider` trait therefore gains a
second reader over the bounded stderr tail beside the per-event one; a
refusal early in a very noisy stderr can fall off the 16 KiB tail, which
the bound makes explicit rather than hidden. The export policy moved to
version 2 for the new records and their stripped samples, mirrored in
the Rust journal so the parity test stays byte-equal.
