---
id: "121-candidate-and-receipt"
title: "The candidate and the receipt: the build works a worktree with a scrubbed environment, and a passing gate over a stable revision is journaled as an acceptance receipt"
status: approved
created: "2026-09-09"
implementation: complete
risk: high
depends_on:
  - "120-capability-contract"
  - "016-stage-build"
  - "019-stage-verify"
  - "011-work-journal"
  - "041-project-gate-contract"
establishes:
  - "members/src/orchestrator/candidate.ts"
  - "members/src/orchestrator/candidate.test.ts"
  - "members/src/orchestrator/receipt.ts"
  - "members/src/orchestrator/receipt.test.ts"
extends:
  # 016 owns the build stage, whose runner becomes the candidate's.
  - { spec: "016-stage-build", unit: "members/src/orchestrator/stages/build.ts", nature: additive }
  - { spec: "016-stage-build", unit: "members/src/orchestrator/stages/build.test.ts", nature: additive }
  # 017 and 018 own the stages that work the same candidate after build.
  - { spec: "017-stage-ship", unit: "members/src/orchestrator/stages/ship.ts", nature: additive }
  - { spec: "017-stage-ship", unit: "members/src/orchestrator/stages/ship.test.ts", nature: additive }
  - { spec: "018-stage-shepherd", unit: "members/src/orchestrator/stages/shepherd.ts", nature: additive }
  - { spec: "018-stage-shepherd", unit: "members/src/orchestrator/stages/shepherd.test.ts", nature: additive }
  # 021 owns the daemon, which hands each stage the candidate.
  - { spec: "021-orchestrator-daemon", unit: "members/src/orchestrator/daemon.ts", nature: additive }
  - { spec: "021-orchestrator-daemon", unit: "members/src/orchestrator/daemon.test.ts", nature: additive }
  # 014 owns the in-process child environment; 043 the member's.
  - { spec: "014-session-driver", unit: "members/src/orchestrator/session.ts", nature: additive }
  - { spec: "014-session-driver", unit: "members/src/orchestrator/session.test.ts", nature: additive }
  - { spec: "043-driver-seam", unit: "members/src/orchestrator/driver.ts", nature: additive }
  - { spec: "043-driver-seam", unit: "members/src/orchestrator/driver.test.ts", nature: additive }
  # 114 and 116 own the drivers' child_env.
  - { spec: "114-driver-port", unit: { kind: directory, path: "crates/statecraft-driver-core/" }, nature: additive }
  - { spec: "114-driver-port", unit: { kind: directory, path: "crates/statecraft-driver-claude/" }, nature: additive }
  - { spec: "116-codex-driver", unit: { kind: directory, path: "crates/statecraft-driver-codex/" }, nature: additive }
  # 031 owns the export allowlist, which admits the receipt.
  - { spec: "031-journal-export", unit: "members/src/orchestrator/export.ts", nature: additive }
  - { spec: "031-journal-export", unit: "members/src/orchestrator/export.test.ts", nature: additive }
  # 022 owns the API, which exposes the latest receipt per spec.
  - { spec: "022-http-api-and-events", unit: { kind: directory, path: "members/src/orchestrator/api/" }, nature: additive }
  # 111 owns the contract, which carries the deny list and its fixture.
  - { spec: "111-contract-crate", unit: { kind: directory, path: "crates/statecraft-contract/" }, nature: additive }
  - { spec: "111-contract-crate", unit: "members/src/members/contract-fixtures.test.ts", nature: additive }
  # 113 mirrors the export policy; the acceptance records bump it to 3.
  - { spec: "113-journal-port", unit: { kind: directory, path: "crates/statecraft-journal/" }, nature: additive }
  # 043's bundle rule learns the deny list is the engine's to carry (D-6).
  - { spec: "043-driver-seam", unit: "members/src/members/engine-bundle.test.ts", nature: additive }
  # Fakes that implement Runner or build evidence literals gain the new members.
  - { spec: "026-standby-daemon", unit: "members/src/orchestrator/standby.test.ts", nature: additive }
  - { spec: "024-web-ui", unit: "members/web/test/fixtures.ts", nature: additive }
references:
  - { unit: { kind: file, path: "docs/design/04-the-governed-substrate.md" }, role: context }
summary: >
  Doc 04 §5. The build stage stops editing the operator's checkout: it adds
  a worktree for the spec's branch under the daemon's home and drives every
  session, gate and commit there, and ship and shepherd work the same
  candidate. The child environment every session receives is scrubbed by a
  deny list the engine owns. When the post-session gate passes on a
  candidate whose HEAD did not move and whose tree stayed clean, the engine
  journals an acceptance receipt binding the repository, the base, the
  candidate sha, the gate suite, the policy digest, the spec-spine version,
  every exit code, and the policy-sensitive paths the candidate touched.
  The receipt is what 122's broker consumes before it publishes.
---

# 121: The candidate and the receipt

## 1. Purpose

Acceptance today is a boolean on the build evidence, computed over
whatever tree the operator's checkout held when the session ended. Two
things make it untrustworthy as a thing to publish on: the tree is the
operator's, so a session's writes and the operator's coexist, and nothing
says which revision the gate judged. This spec gives the run a candidate
of its own and turns a passing gate into a receipt that names its
revision.

## 2. Territory

Owned: `candidate.ts`, the worktree lifecycle and the environment deny
list; `receipt.ts`, the receipt shape, its digests, the policy-sensitive
path set and the stability check; their tests.

Extended: build, ship, shepherd and their tests (016, 017, 018); the
daemon (021); the child environments on both sides (014, 043, 114,
116); the export allowlist (031); the API's read routes (022).

Not claimed: verify.ts, which already works a detached worktree of the
merged sha (019 B-2) and is the model for this; the web UI.

## 3. Behavior

- **B-1 (the candidate).** `openCandidate({repoDir, homeDir, branch,
  baseSha})` adds a worktree at `<homeDir>/candidates/<project>/<branch>`
  for the branch, creating the branch from `baseSha` when it does not
  exist and checking it out when it does (016 B-2's `reused`). It returns
  `{path, branch, reused}`. `closeCandidate(path)` removes the worktree
  and prunes. A candidate that exists from an earlier run is reopened,
  not recreated; a candidate whose branch has been merged (the daemon's
  `daemon.merge-sha` for the spec exists) is closed at the run's end.
- **B-2 (every stage works it).** The build runner's `repoDir` becomes
  the candidate path for `createBranch`, `runGate`, `add`, `commit`,
  `headSha`, `readFile`, `writeFile` and `runSession`. Ship and shepherd
  receive the same path from the daemon and drive their sessions and
  gates there. The operator's checkout is used for `resolveBase` (119
  B-2) and for `git worktree` itself, and nothing writes to it. The
  preflight's `dirty-tree` and `wrong-branch` refusals apply to the
  candidate; the operator's checkout may be on any branch and dirty.
- **B-3 (the environment is scrubbed).** `CHILD_ENV_DENY` in
  `candidate.ts` is `["ANTHROPIC_API_KEY", "OPENAI_API_KEY"]` and
  `scrubEnv(env)` removes them and sets `NO_COLOR=1`. `session.ts` and
  `driver.ts` build the child environment through it, and the Rust
  providers' `child_env` remove the same two names; the core's test
  asserts the list is the same on both sides through a contract fixture
  `child-env-deny.json`. 122 adds the GitHub tokens when the broker
  publishes.
- **B-4 (stability).** After the session ends and before the gate runs,
  build records `headSha` and `git status --porcelain` of the candidate;
  after the gate, both again. A receipt is minted only when the two heads
  are equal and both statuses are empty; otherwise `acceptance.unstable`
  `{specId, round, headBefore, headAfter, dirty}` is journaled and the
  round's completion is `passing: false`.
- **B-5 (the receipt).** `mintReceipt(input)` in `receipt.ts` builds
  `{schemaVersion: 1, specId, round, repo: {origin, baseSha, candidateSha,
  branch}, suite: {commands, digest}, policy: {gate, profile, digest},
  verifier: {specSpine: <version>}, results: [{cmd, exitCode}],
  sensitivePaths: [...], passing: true}`. `digest` fields are
  `sha256Hex(stableStringify(...))` of the suite's commands and of the
  folded gate contract and profile payloads. `sensitivePaths` is `git diff
  --name-only <baseSha>..<candidateSha>` filtered by
  `POLICY_SENSITIVE_PREFIXES` = `Makefile`, `.github/workflows/`,
  `.claude/`, `.codex/`, `.agents/`, `spec-spine.toml`, `standards/`,
  `scripts/`. Build journals it as `acceptance.receipt`; the record hash
  is the receipt's identity.
- **B-6 (read back).** `latestReceipt(records, specId)` folds the newest
  passing receipt for a spec, `null` when none; `receiptCovers(receipt,
  headSha)` is `receipt.repo.candidateSha === headSha`. The API's spec
  detail gains `receipt` (the folded record or `null`); the export
  allowlist admits `acceptance.receipt` and `acceptance.unstable` whole
  (no path tails: `sensitivePaths` are repository-relative).
- **B-7 (sensitive paths are surfaced).** A receipt with a non-empty
  `sensitivePaths` is still a receipt; build journals
  `acceptance.sensitive` `{specId, paths}` beside it and the build
  evidence carries `sensitivePaths`. 123's lifecycle policy decides what
  a project does with them.

## 4. Functional requirements

- **FR-001.** Candidate tests: open creates a worktree and a branch from
  the base; reopen reuses; close removes and prunes; the operator's
  checkout is unchanged by every operation (its HEAD, branch and status
  compared before and after).
- **FR-002.** Build tests: the fake runner's operations are observed at
  the candidate path; a session that leaves the tree dirty yields
  `acceptance.unstable` and no receipt; a clean pass yields a receipt
  whose `candidateSha` equals the round's head and whose digests match a
  recomputation.
- **FR-003.** Receipt tests: the digest is stable under key order;
  `sensitivePaths` filters by prefix; `latestReceipt` picks the newest
  passing one per spec; `receiptCovers` is a sha equality.
- **FR-004.** Environment tests: `scrubEnv` drops exactly the deny list
  and sets `NO_COLOR`; both Rust providers drop the same names; the
  fixture matches both sides.
- **FR-005.** Daemon tests: a stage is handed the candidate path, and the
  candidate is closed after the spec's merge sha is journaled.

## 5. Acceptance

- `cd members && bun run typecheck && bun test` green; `cargo test
  --workspace --locked`, clippy, fmt clean; `make gate` green.
- A live smoke, recorded in the status note: a build round over a
  fixture corpus runs in `<home>/candidates/...`, the operator checkout's
  status is unchanged, and the journal holds one `acceptance.receipt`
  whose `candidateSha` is the candidate's HEAD.

## Verification

```verify:cli
cd members && bun test src/orchestrator/candidate.test.ts src/orchestrator/receipt.test.ts src/orchestrator/stages/build.test.ts src/orchestrator/daemon.test.ts src/orchestrator/export.test.ts
```

```verify:cli
cargo test --workspace --locked -p statecraft-driver-core -p statecraft-driver-claude -p statecraft-driver-codex
```

## Status (2026-09-09)

Implemented. `candidate.ts` opens, reopens and closes the worktree at
`<home>/candidates/<project>/<branch>` and owns `CHILD_ENV_DENY`;
`receipt.ts` mints, serializes, parses and folds the receipt. The runner
gained a candidate face (`candidateHome`, `openCandidate`, `workDir`,
`closeCandidate`, `changedPaths`, `originUrl`, `statusText`) and every
other operation follows the open candidate; the production deps build the
stage runner with the data dir as its home and a second runner for the
checkout reads the scheduler makes. The build preflight, with a
candidate, resolves the base, opens the candidate, and applies the
dirty-tree and gate refusals to it; a branch the operator has checked
out is `candidate-unavailable`. Completion reads head and status before
and after the suite, journals `acceptance.unstable` when they differ,
and mints `acceptance.receipt` (and `acceptance.sensitive`) on a stable
pass, with the profile threaded from the daemon for the policy digest.
Ship and shepherd reopen the candidate at their start; the daemon closes
it after the merge sha is journaled. The history view carries the
receipt's hash, shas, policy digest and sensitive paths. Both drivers'
`child_env` filter by the contract's `CHILD_ENV_DENY`, the fixture
`child-env-deny.json` pins the list, and the engine and member spawn
paths scrub through one function. Export policy is version 3 on both
sides. The members suite (927) and the workspace are green. The live
smoke (FR-002's worktree test over a real repository): the round ran at
the candidate path, the operator's checkout kept its branch, head and
dirty scratch file, and the journal held one receipt whose
`candidateSha` was the candidate's HEAD and whose `sensitivePaths` named
the Makefile the session wrote.

## 6. Out of scope

Process containment (a sandboxed executor, a brokered file service): the
worktree organizes, it does not confine (doc 04 D47). Refusing a receipt
on sensitive paths (123 decides per project). The push and the PR
(122). The verify stage, already isolated.

## 7. Resolved decisions

D-1 (2026-09-09). Born approved on doc 04 §9's authority (119 D-1).

D-2 (2026-09-09). The candidate lives under the daemon's home, not under
`tmpdir()` as verify's does, because it persists across stages and
across a parked run; verify's is disposable within one stage.

D-3 (2026-09-09). The receipt is a journal record, not a signed
document. The chain's hash discipline (011) is the authority the engine
has; external anchoring is the attested export's concern (039) and a
signing authority outside the writer is doc 04 §10's open question.

D-5 (2026-09-09). A runner built without a candidate home works the
checkout in place, as 016 B-2 did. The production deps always pass one;
the in-place mode is what a fixture world without a daemon home runs
under, and every pre-121 stage test keeps its meaning through it.

D-6 (2026-09-09). The environment deny list names two providers' keys
and lives in the engine, because scrubbing is the engine's to do before
a member is spawned. 043 FR-005's rule that the engine bundle names no
provider string is amended for exactly those two names, and the test
now asserts they appear in both bundles rather than in neither.

D-7 (2026-09-09). Ship and shepherd reopen the candidate themselves
rather than trusting the runner's pointer, because the deps are cached
per project for the process's life (026) and a daemon restart between
stages loses the pointer but never the worktree.

D-4 (2026-09-09). Stability is head-and-status equality across the gate,
not a snapshot. Copying a candidate before checking it would double the
disk for every round and still race a writer that survives the session;
the driver's kill discipline (014) is what ends writers, and the check
catches the failure of that discipline rather than working around it.
