---
id: "122-action-broker"
title: "The action boundary: the engine publishes on a receipt and a lease, the session proposes the text, and the candidate holds no publish credential"
status: approved
created: "2026-09-09"
implementation: complete
risk: critical
depends_on:
  - "121-candidate-and-receipt"
  - "017-stage-ship"
  - "018-stage-shepherd"
  - "020-decision-ledger"
  - "013-run-state-machine"
establishes:
  - "members/src/orchestrator/broker.ts"
  - "members/src/orchestrator/broker.test.ts"
extends:
  # 017 owns the ship stage, the GitHub seam and the marker rules.
  - { spec: "017-stage-ship", unit: "members/src/orchestrator/stages/ship.ts", nature: additive }
  - { spec: "017-stage-ship", unit: "members/src/orchestrator/stages/ship.test.ts", nature: additive }
  # 018 owns the merge.
  - { spec: "018-stage-shepherd", unit: "members/src/orchestrator/stages/shepherd.ts", nature: additive }
  - { spec: "018-stage-shepherd", unit: "members/src/orchestrator/stages/shepherd.test.ts", nature: additive }
  # 021 owns the daemon, which constructs the broker and passes the lease.
  - { spec: "021-orchestrator-daemon", unit: "members/src/orchestrator/daemon.ts", nature: additive }
  - { spec: "021-orchestrator-daemon", unit: "members/src/orchestrator/daemon.test.ts", nature: additive }
  # 121 owns the deny list that gains the GitHub tokens.
  - { spec: "121-candidate-and-receipt", unit: "members/src/orchestrator/candidate.ts", nature: additive }
  - { spec: "121-candidate-and-receipt", unit: "members/src/orchestrator/candidate.test.ts", nature: additive }
  # 114 and 116 own the drivers' child_env, which drop the same names.
  - { spec: "114-driver-port", unit: { kind: directory, path: "crates/statecraft-driver-claude/" }, nature: additive }
  - { spec: "116-codex-driver", unit: { kind: directory, path: "crates/statecraft-driver-codex/" }, nature: additive }
  - { spec: "111-contract-crate", unit: { kind: directory, path: "crates/statecraft-contract/" }, nature: additive }
  # 031 owns the export allowlist, which admits the broker records.
  - { spec: "031-journal-export", unit: "members/src/orchestrator/export.ts", nature: additive }
  - { spec: "031-journal-export", unit: "members/src/orchestrator/export.test.ts", nature: additive }
  # 016 exports its completion evaluation for ship and shepherd's receipts (D-5).
  - { spec: "016-stage-build", unit: "members/src/orchestrator/stages/build.ts", nature: additive }
  # 116's members test widens a load-sensitive timeout fixture; 114's likewise.
  - { spec: "116-codex-driver", unit: "members/src/members/driver-codex.test.ts", nature: additive }
  - { spec: "114-driver-port", unit: "members/src/members/driver-parity.test.ts", nature: additive }
  # 113 mirrors the export policy; the broker records bump it to 4.
  - { spec: "113-journal-port", unit: { kind: directory, path: "crates/statecraft-journal/" }, nature: additive }
  # 043's bundle rule lists the four deny-list names.
  - { spec: "043-driver-seam", unit: "members/src/members/engine-bundle.test.ts", nature: additive }
  # Fakes that implement GitHubClient gain createPr.
  - { spec: "026-standby-daemon", unit: "members/src/orchestrator/standby.test.ts", nature: additive }
  - { spec: "119-admission-and-outcome", unit: "members/src/orchestrator/admission.test.ts", nature: additive }
references:
  - { unit: { kind: file, path: "docs/design/04-the-governed-substrate.md" }, role: context }
summary: >
  Doc 04 §6. The push and the pull request move from the driven session to
  the engine. The ship session gates, reviews and commits in the candidate
  and drops the PR title and body into a drop box, as 020 drops decisions;
  the broker validates the text with 017's marker rules, requires an
  acceptance receipt covering the candidate head, checks the run holds the
  project's lease, pushes, and opens the PR. Shepherd's merge consumes the
  same receipt beside the green checks and 119's head. Every effect is
  journaled before and after with the action, the target, the head and the
  receipt it consumed; a retry reconciles before it acts. The GitHub tokens
  join the environment deny list, so the candidate can no longer publish
  on its own. The hosted plane's verbs already sit behind their guards and
  are not changed.
---

# 122: The action boundary

## 1. Purpose

Today the engine tells a headless session that it is authorized to push
and open a pull request, and hands it an environment that can. The gate
runs, but the session publishes whether or not it passed, and nothing
binds the push to the revision the gate judged. This spec puts the
effects behind one door: the engine's broker, which acts only on a
receipt, a lease and text it has checked.

## 2. Territory

Owned: `broker.ts`, the `Broker` interface, its production
implementation over the `GitHubClient` and a git push seam, the lease
check, the reconciliation, and the journal records; its test.

Extended: ship and shepherd and their tests (017, 018); the daemon
(021); the deny list (121) and the drivers' `child_env` with the
contract fixture (114, 116, 111); the export allowlist (031).

Not claimed: the umbrella's verbs and MCP server (104, 105); the
control plane.

## 3. Behavior

- **B-1 (the session proposes).** `buildShipPrompt` no longer instructs
  the session to push or run `gh pr create`; it instructs it to gate,
  review, commit, and write `<candidate>/.statecraft/proposal.json`
  with `{title, body}`. The "standing authorization" paragraph is
  replaced by one sentence: publication is the engine's. The PR gate
  hook stays as feedback for a session that tries anyway.
- **B-2 (the broker).** `Broker` has `push(request)`, `openPr(request)`
  and `merge(request)`. Every request carries `{runId, specId, branch,
  headSha, receiptHash}`; `openPr` adds `{title, body}`; `merge` adds
  `{prNumber, method}`. Each method, in order: checks the lease (B-4);
  checks `receiptCovers(receipt, headSha)` for the receipt the hash
  names, and that it is `passing`; for `openPr`, checks the text with
  017's marker rules and `verifyOutside`'s forbidden patterns; journals
  `broker.action` `{action, target, headSha, receiptHash, phase:
  "intent"}`; performs the effect; journals the same with `phase:
  "outcome", ok, detail}`. A failed check journals `broker.refused`
  `{action, reason, ...}` and throws `BrokerRefusedError`.
- **B-3 (the effects).** `push` runs `git push --set-upstream origin
  <branch>` in the candidate through a `GitPush` seam. `openPr` runs `gh
  pr create --head <branch> --title --body-file <tmp>`, then reads the PR
  back and verifies `pr.headSha === headSha`. `merge` calls
  `GitHubClient.mergePr(number, method, headSha)` (119 B-4).
- **B-4 (the lease).** `holdsLease(state, runId, project)` is true when
  the folded run state (013) has `runId` as the project's live run
  (`running` or `paused`). A request from any other run is refused
  `lease-lost`. The daemon passes the run id with every stage.
- **B-5 (reconcile before act).** `push` first compares the remote
  branch head (`git ls-remote origin <branch>`) with `headSha`: equal is
  a no-op outcome `already`; a remote head that is an ancestor of
  `headSha` is pushed; anything else is refused `remote-diverged`.
  `openPr` first calls `prForBranch`: an open PR whose head is `headSha`
  is `already`; one with a different head is refused `pr-head-mismatch`.
  `merge` first checks `pr.merged`: merged at `headSha` is `already`.
  017 B-4's idempotent check becomes the ship stage calling the broker
  with the same request.
- **B-6 (ship uses it).** After the session, ship reads the proposal
  (missing or malformed is `outcome: "failed"` with `refusalDetail`),
  requires `latestReceipt(specId)` covering the candidate head (none is
  `failed` with `no-receipt`), then `push` and `openPr`. `ShipPrEvidence`
  gains `receiptHash` and `brokered: true`. Shepherd's green path calls
  `merge` with the receipt covering the PR head; a PR head without a
  receipt (a remediation commit without a passing round) is `failed`
  with `needsHuman` and `no-receipt`.
- **B-7 (the candidate cannot publish).** `CHILD_ENV_DENY` gains
  `GH_TOKEN` and `GITHUB_TOKEN`; the Rust providers drop the same names;
  the fixture `child-env-deny.json` lists four. The broker's own `gh`
  and `git push` run with the daemon's environment, unscrubbed. A `gh`
  authenticated through a keyring remains reachable to the candidate;
  this is recorded in the status note as the known limit.
- **B-8 (exported).** `broker.action` and `broker.refused` join the
  export allowlist; `detail` is stripped as elsewhere.

## 4. Functional requirements

- **FR-001.** Broker tests over a fake `GitHubClient` and a fake
  `GitPush`: each method journals intent and outcome; each refusal kind
  (`lease-lost`, `no-receipt`, `receipt-mismatch`, `forbidden-text`,
  `remote-diverged`, `pr-head-mismatch`) is exercised and performs no
  effect; each `already` path performs no effect and is `ok`.
- **FR-002.** Ship tests: the prompt carries no `gh pr create` and no
  `git push`; a session that writes a proposal and leaves a receipt
  yields one push, one PR and evidence naming the receipt; a session
  without a receipt yields `failed` `no-receipt` and no effect.
- **FR-003.** Shepherd tests: the merge goes through the broker with the
  receipt covering the PR head; a head without a receipt is `failed`
  with `needsHuman` and no merge call.
- **FR-004.** Environment tests: the deny list is four names on both
  sides.
- **FR-005.** Daemon tests: the run id reaches the stage and a stale run
  id is refused by the broker.

## 5. Acceptance

- `cd members && bun run typecheck && bun test` green; `cargo test
  --workspace --locked`, clippy, fmt clean; `make gate` green.
- A live smoke, recorded in the status note: a ship round over a
  fixture repository with a real remote (a bare repository on disk, the
  `gh` calls faked) pushes the candidate and journals `broker.action`
  intent and outcome for `push` and `openPr`, the PR request naming the
  receipt hash; a second run of the same stage is `already` twice.

## Verification

```verify:cli
cd members && bun test src/orchestrator/broker.test.ts src/orchestrator/stages/ship.test.ts src/orchestrator/stages/shepherd.test.ts src/orchestrator/candidate.test.ts src/orchestrator/daemon.test.ts
```

```verify:cli
cargo test --workspace --locked -p statecraft-driver-claude -p statecraft-driver-codex -p statecraft-contract
```

## Status (2026-09-09)

Implemented. `broker.ts` carries the `Broker` interface, `createBroker`
over the `GitHubClient` and a `GitPush` seam (`createProcessGitPush`
over the candidate the runner has open), `holdsLease` over the folded
run state, the reconciliations of B-5 and the `broker.action` and
`broker.refused` records. `GitHubClient` gained `createPr` (through a
body file) and `prForBranch` reads the merge state. The ship stage,
with a broker, drives a prompt (version 3) that proposes into
`<dropbox>/proposal-<spec>.json` (D-6), reads the proposal, receipts the
head the session left when the build's receipt does not cover it
(D-5), pushes and opens through the broker, and keeps B-3's outside
verification; its idempotent precheck is the broker answering
`already`. Shepherd merges through the broker on the receipt covering
the PR head, and after a remediation session gates, receipts and pushes
the fix itself (prompt told to commit and stop). The daemon builds the
broker over the work journal and passes the run id, drop box, gate and
profile to both stages; without a broker both stages keep the pre-122
in-place flow (D-7). The deny list has four names on both sides;
export policy is version 4. The members suite (943) and the workspace
are green. The live smoke over a bare remote on disk with `gh` faked: a
build round receipted the candidate, the ship round pushed it (the
remote head equal to the candidate head) and journaled
`broker.action` intent and outcome for `push` and `openPr` naming the
receipt hash, the operator's checkout stayed clean on main, and a second
ship round answered `already` for both. Known limit, as B-7 says: a
`gh` authenticated through a keyring remains reachable to the
candidate; the scrub is the boundary where the environment is.

## 6. Out of scope

A permit format for the hosted plane (doc 04 D52). Signing the receipt
or the action record. Revoking a lease from outside the daemon (the
control verbs pause and skip; an `approve` remains the human gate 021
has). Removing `gh` from the candidate's reach.

## 7. Resolved decisions

D-1 (2026-09-09). Born approved on doc 04 §9's authority (119 D-1).

D-2 (2026-09-09). The proposal is a file in the candidate, as decisions
are (020). A session cannot append to the chain, and the text it writes
is a proposal until the broker has checked it; the drop box is the
existing shape for exactly that.

D-3 (2026-09-09). The lease is the folded run state, not a new record.
013 already answers "which run is live"; a second lease record would
have to be kept consistent with it.

D-5 (2026-09-09). Ship and shepherd mint their own receipt when the
head they hold is not the one the build receipted: a ship session that
commits after review, or a remediation commit, moves the head, and B-6's
rule (publish only on a receipt covering the head) would otherwise fail
every such round. The receipt is the same gate over the same stable
candidate (121 B-4, B-5), journaled with round 3 (ship) or 4 (shepherd).

D-6 (2026-09-09). The proposal lands in the decisions' drop box, not in
the candidate: a file under `<candidate>/.statecraft/` would dirty the
tree 121 B-4 requires clean before a receipt, and "as 020 drops
decisions" is the drop box.

D-7 (2026-09-09). Without a broker the stages keep the pre-122 flow, in
which the session publishes; the production deps always pass one. This
is 121 D-5's shape for the same reason: fixture worlds without a remote
or a run.

D-4 (2026-09-09). The GitHub tokens leave the environment now, though a
keyring-backed `gh` still answers. The limit is recorded rather than the
scrub withheld: on a machine that authenticates through the environment
(CI, a container), the scrub is the boundary.
