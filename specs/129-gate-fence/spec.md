---
id: "129-gate-fence"
title: "The gate fence: acceptance runs in the world the session worked in, not in the daemon's"
status: approved
created: "2026-09-11"
implementation: in-progress
risk: medium
depends_on:
  - "125-credential-fence"
  - "121-candidate-and-receipt"
  - "122-action-broker"
  - "016-stage-build"
  - "019-stage-verify"
establishes:
  - "members/src/orchestrator/gate-fence.test.ts"
extends:
  # 016 owns the build runner, whose runGate and git helper spawn with no env
  # today.
  - { spec: "016-stage-build", unit: "members/src/orchestrator/stages/build.ts", nature: additive }
  - { spec: "016-stage-build", unit: "members/src/orchestrator/stages/build.test.ts", nature: additive }
  # 121 owns the candidate, whose worktree creation runs repository hooks.
  - { spec: "121-candidate-and-receipt", unit: "members/src/orchestrator/candidate.ts", nature: additive }
  # 125 owns the fence: its shims report each refusal to the supervisor, which
  # owns the count a child cannot erase (B-3).
  - { spec: "125-credential-fence", unit: "members/src/orchestrator/fence.ts", nature: additive }
  - { spec: "125-credential-fence", unit: "members/src/orchestrator/fence.test.ts", nature: additive }
  # 122 owns the broker, whose push runs a pre-push hook beside the credential.
  - { spec: "122-action-broker", unit: "members/src/orchestrator/broker.ts", nature: additive }
  - { spec: "122-action-broker", unit: "members/src/orchestrator/broker.test.ts", nature: additive }
  # 019 owns the verify stage: its acceptance lines and browser sessions.
  - { spec: "019-stage-verify", unit: "members/src/orchestrator/stages/verify.ts", nature: additive }
  - { spec: "019-stage-verify", unit: "members/src/orchestrator/stages/verify.test.ts", nature: additive }
  # 025 owns the registry, where the verify allowance is journaled per project.
  - { spec: "025-project-registry", unit: "members/src/orchestrator/projects.ts", nature: additive }
  # 021 and 026 own fixture runners and evidence literals that gain the field,
  # as they did for 125's tally.
  - { spec: "021-orchestrator-daemon", unit: "members/src/orchestrator/daemon.test.ts", nature: additive }
  - { spec: "026-standby-daemon", unit: "members/src/orchestrator/standby.test.ts", nature: additive }
  # Doc 05 is the record this spec is born from (D60, D74 to D77).
  - { spec: "110-corpus-merge", unit: { kind: directory, path: "docs/design/" }, nature: additive }
references:
  - { unit: { kind: file, path: "docs/design/05-the-realignment-checked.md" }, role: context }
  - { unit: { kind: file, path: "specs/125-credential-fence/spec.md" }, role: context }
summary: >
  Spec 125 fenced the driven session so the broker is the only path that
  works and the journal is complete. The fence stops at the session. Every
  other place the engine runs code a repository controls inherits the
  daemon's whole environment: the gate suite in every round, the bracket, the
  engine's own git (whose hooks a tracked hooks directory supplies), the
  broker's push (whose pre-push hook runs beside the one credential the broker
  holds), and the verify stage's acceptance lines. Each was measured on
  2026-09-12 seeing a fabricated token from the daemon's environment. This
  spec gives every such path a named disposition: gate, bracket and candidate
  git run with the session's fenced environment; credentialed git runs with
  no repository hooks; the verify stage reads acceptance at the base revision
  and runs it behind a fence unless the operator journals an allowance. A
  refusal fails the gate and acceptance even when a command swallows the exit
  code, and the refusal is counted by the supervisor, where the child that
  was refused cannot erase it. The property is credential protection, not
  hostile-code isolation.
---

# 129: The gate fence

## 1. Purpose

125's claim is precise: "the broker is the only path that works, so the
journal is complete." It holds for the process 125 fenced, the provider
session. It does not hold for the processes that judge and publish the
session's work.

`createProcessRunner` in `stages/build.ts` runs every gate command through
`runProcessSync(workDir, cmd)`, which calls `Bun.spawnSync(cmd, { cwd })` with
no `env`. The child inherits the daemon's environment unchanged. That
environment holds everything 121 B-3 and 125 took away from the session: the
two model keys, `GH_TOKEN` and `GITHUB_TOKEN`, `SSH_AUTH_SOCK`, the real `gh`
first on `PATH`, and a git that reads the operator's credential helper.

The gate is not the engine's own code. It is the project's gate contract
(041), typically `make gate`, `cargo test`, `bun test`, run in the candidate
after the session ends. The session can edit the Makefile, the test files and
the build scripts those commands execute. 121 records such an edit as
`acceptance.sensitive`; it does not refuse it, and it should not have to,
because editing tests is ordinary work.

So a capable session, meeting 125's refusal for `gh pr create`, has one more
obvious move: a test, or a Makefile target, that does what it wanted. No
malice is required for the same effect: a project whose own integration tests
push to a remote does it on every gate. Either way the effect happens with
the operator's credential, outside the broker, with no receipt, no lease and
no journal record.

The gate is not the only such path. Measured on 2026-09-12 at `874766b`
(doc 05 §18.2 F7), with a fabricated `GH_TOKEN` in the daemon's environment:

- the production `runGate` over a real candidate saw the token and resolved
  `gh` to the operator's binary;
- with a tracked hooks directory (`core.hooksPath`, husky's shape), the
  engine's own commit in the candidate ran the candidate's `pre-commit` with
  the token;
- the broker's production push ran the candidate's `pre-push` with the token,
  and then pushed;
- the verify stage's production runner ran a declared acceptance line with
  the token and the real `gh`.

And the refusal record is weaker than draft 129 first assumed (F8): under the
fenced environment, `sh -c 'gh pr create --fill || true'` exits 0 with the
refusal tallied, and a child that truncates the refusal log afterwards exits
0 with a tally of 0.

This spec closes the reach the way 125 closed it for the session, for every
path in B-11's table. It is credential protection, not hostile-code isolation,
for the reasons D-8 gives.

## 2. Territory

- `members/src/orchestrator/stages/build.ts` (extends 016): `runGate` and the
  candidate-local git spawn with the session's environment; credentialed git
  runs without repository hooks; the gate evidence gains the fence record and
  the refusal rule.
- `members/src/orchestrator/candidate.ts` (extends 121): `git worktree add`
  runs with the fenced environment of the fence it has just built.
- `members/src/orchestrator/broker.ts` (extends 122): the push seam runs
  without repository hooks.
- `members/src/orchestrator/stages/verify.ts` (extends 019): acceptance read
  at the base, run behind a verify fence, browser sessions fenced.
- `members/src/orchestrator/projects.ts` (extends 025): the per-project verify
  allowance, journaled.
- `members/src/orchestrator/gate-fence.test.ts`: the negative suite, run from
  a real fenced candidate, the shape of 125's `fence.test.ts`.
- `members/src/orchestrator/stages/build.test.ts` (extends 016),
  `broker.test.ts` (extends 122), `stages/verify.test.ts` (extends 019), and
  the fixture literals in `daemon.test.ts` (021) and `standby.test.ts` (026).

## 3. Behavior

### B-1. The gate receives the session's environment

`runGate` spawns each command with `applyFence(scrubEnv(process.env),
fenceDir)`, the same expression `driver.ts` uses for the session, where
`fenceDir` is the fence of the open candidate (125 D-1). Every caller reaches
the gate through `runGate`: the build preflight's "gate green at base" check,
build rounds 1 and 2, ship's round 3 and shepherd's round 4 (both through
`evaluateCompletion`). The bracket commands (`spec-spine compile` and `index`,
016 D-8) and the receipt's `spec-spine --version` read run through `runGate`
and are fenced with it.

### B-2. In-place mode keeps its shape

A runner built without a candidate home has no fence (125 D-1). Its gate
receives the scrub without the overlay, which is exactly what its session
already receives. No path runs the gate with more than the session had.

### B-3. A refusal is counted by the supervisor, and a gate's apart from the session's

Every shim reports its refusal, at the moment it refuses and before it exits
127, to the supervisor: the engine process that spawned the fenced work (the
build runner for a session and its gate, the verify stage for acceptance).
The report travels over a channel the supervisor holds and reads itself, and
the supervisor's count is the tally. The refusal log (125 B-7) stays as a
legible copy for a person reading the fence, and no stage reads a count from
it, so a child that truncates, rewrites or deletes the log changes no tally.
The channel is the build's choice, recorded as a dated decision; its
requirement is that a refusal once reported cannot be withdrawn by any process
the supervisor spawned. A process that never reaches a shim (an absolute
path, D-8) reports nothing, and that stays a residual rather than a refusal.

The build takes the supervisor's count immediately before and after the gate
suite, and the difference is the gate's. `GateEvidence` gains `fence: {
applied: boolean; refusals: number }`, required with an explicit zero (125
D-3's rule: a missing tally must not read as "nothing was refused"), and the
session's `fenceRefusals`, read from the same count, no longer includes a
gate's refusals.

### B-4. A refusal fails acceptance, whatever the gate's exit code

A round whose gate-time tally rose is not accepted, even when every command
exited 0: no receipt is minted, the round's completion carries the reason
`gate-fence-refused` with the count and the tools named in the log, and the
remediation prompt carries the shim's message naming the broker. The exit
code is not the rule because a gate can swallow it: `gh pr create || true`
exits 0 with the refusal logged. A gate command that does not swallow the
shim's 127 fails the suite as well, so both reasons can appear together.

### B-5. The receipt is unchanged

`acceptance.receipt` stays at schema version 1. The fence is recorded on the
build evidence beside it, not inside it, so no existing receipt reader changes
and no receipt bytes change meaning. Doc 05 D68 puts the execution context into
a later receipt revision.

### B-6. The engine's git in the candidate runs fenced

Every git invocation the engine makes inside the candidate and that needs no
network (`git worktree add` for the candidate, `add`, `commit`, `status`,
`branch`, `checkout`, `rev-parse`, `diff`) spawns with the same fenced
environment as the gate. Repository hooks and filters still run, so a
formatting `pre-commit` keeps working; they run without a credential.
`openCandidate` builds the fence before the worktree exists (125 B-2), so the
fence is available to `worktree add`'s `post-checkout`.

### B-7. Credentialed git runs without repository hooks

The git invocations that need the operator's credential (`fetch` in
`resolveBaseSha` and in the verify stage, the in-place scheduler's `pull
--ff-only`, and the broker's `ls-remote` and `push`) keep the daemon's
environment, and pass `-c core.hooksPath=/dev/null`, so no hook from the
shared git directory or a tracked hooks directory runs beside the credential.
Measured on git 2.50.1: a tracked `pre-push` hook that exits 1 blocks a plain
push and does not run under that flag. A project's pre-push checks therefore
do not run on a brokered push; the gate, which ran fenced over the same head,
is acceptance.

### B-8. The verify stage reads acceptance at the base and runs it fenced

The verify stage reads the `## Verification` block from the spec as it stood
at the base revision of the run that produced the merge (the consumed
receipt's `baseSha`). When the merged head's block differs, it journals
`acceptance.changed` with the spec id and both blocks' digests, and runs the
base's block. Each acceptance line runs in the verify worktree with
`applyFence(scrubEnv(process.env), verifyFence)`, where `verifyFence` is built
beside the verify worktree under the daemon home and removed with it. The
verify evidence gains the same `fence` record as the gate's (B-3), and a
refusal fails the stage (B-4's rule).

A requalification or re-verify with no recorded run reads the block at the
revision it verifies and records `acceptance.base: "unrecorded"`, never an
inferred base.

### B-9. Live acceptance needs an operator allowance, never a spec's say-so

A project's verify allowance is journaled like its gate contract (041), with
two values: `fenced` (the default) and `inherit`. Under `inherit`, acceptance
lines run with the daemon's environment, the allowance and its source are
shown on the project, and every verify evidence records `fence: { applied:
false, refusals: 0, reason: "operator-allowed" }`. The allowance is never read
from a spec or a file in the repository, which a session can edit.

### B-10. Browser verification sessions are fenced too

The verify stage's browser sessions (019's `verify:browser` blocks) run in the
verify worktree rather than the operator's checkout, with `verifyFence` passed
to the driver as the build's sessions pass theirs (125 B-3).

### B-11. Every path, disposed

| Path | Runs repository-controlled code | Disposition |
|---|---|---|
| Gate suite in every round (build preflight and rounds, ship round 3, shepherd round 4) | yes | fenced (B-1), refusal fails acceptance (B-4) |
| Bracket `spec-spine compile`/`index`; `spec-spine --version` | reads the repository; `couple` in the floor runs git | fenced (B-1) |
| Engine git in the candidate, including `worktree add` | hooks and filters | fenced (B-6) |
| `fetch`, `pull --ff-only`, broker `ls-remote` and `push` | hooks | daemon environment, no repository hooks (B-7) |
| Verify stage acceptance lines | yes | base block, fenced, operator allowance (B-8, B-9) |
| Verify stage browser sessions | the repository's provider hooks | fenced, in the verify worktree (B-10) |
| Driven sessions (build, ship, shepherd remediation) | yes | fenced by 125, unchanged |
| Broker's `gh` client, the project probe's `spec-spine compile`, `dag.ts` registry reads, member version probes | reads only | unchanged; each named in this table so the absence of a fence is a decision |
| `adopt synthesize`'s session and commits, `journal export`'s attest, `statecraft template upgrade` codemods | yes | out of scope (§6): run by the operator in the operator's own shell |
| An unconfined session writing the shared `.git/config` or `.git/hooks` | yes, afterwards | out of scope (§6): confinement of writes is 126's |

## 4. Functional requirements

- **FR-001.** From a real fenced candidate (`gate-fence.test.ts`), a gate
  command that prints its environment shows none of the six `CHILD_ENV_DENY`
  names and shows the fence's `PATH`, `GH_CONFIG_DIR` and `GIT_CONFIG_GLOBAL`.
- **FR-002.** A gate command running `gh` exits 127, the suite is red, and
  `fence.refusals` on the gate evidence is 1 while the session's
  `fenceRefusals` is 0.
- **FR-003.** A gate command pushing to an `ssh` remote fails at the fenced
  `ssh`; the same command pushing to a local bare remote over a `file://` URL
  succeeds, which proves the fence closes credentials and not git.
- **FR-004.** A clean gate over the governance floor passes and a receipt is
  minted, with `fence: { applied: true, refusals: 0 }` on the evidence.
- **FR-005.** In-place mode (no candidate home): the gate environment is the
  scrub, `fence.applied` is false, and every existing build test passes.
- **FR-006.** A broker push with a receipt and a lease succeeds in the same
  world whose gate was fenced (B-1): the positive control.
- **FR-007.** The swallowed refusal: a gate command `sh -c 'gh pr create
  --fill || true'` exits 0, the suite's exit codes are all 0, `fence.refusals`
  is 1, the round is not accepted with reason `gate-fence-refused`, and no
  `acceptance.receipt` is journaled.
- **FR-008.** The erasure, closed: a gate command that is refused and then
  truncates the refusal log exits 0, the supervisor's `fence.refusals` is still
  1, and the round is not accepted. A companion case pins the residual that
  remains: a tool invoked by an absolute path meets no shim and adds nothing to
  the tally, so nobody reads a zero tally as proof no attempt was made (D-8).
- **FR-009.** With a tracked hooks directory configured, the engine's bracket
  commit runs the `pre-commit` hook, and the hook sees no `GH_TOKEN` and the
  fence's `PATH`.
- **FR-010.** With a tracked `pre-push` hook that records its environment and
  exits 1, the broker's push over a local bare remote succeeds, the hook did
  not run, and the remote head equals the pushed head.
- **FR-011.** A verify stage over a merged spec runs its acceptance lines with
  no `CHILD_ENV_DENY` name present; a line that runs `gh` and swallows the exit
  fails the stage, and so does one that is refused and then truncates the
  refusal log; under a journaled `inherit` allowance the same line sees the
  daemon's environment and the evidence records `reason: "operator-allowed"`.
- **FR-012.** A merged head whose `## Verification` block differs from the
  base's: the stage runs the base's block and journals `acceptance.changed`
  with both digests.

## 5. Acceptance

- `bun test` in `members/` is green; `make gate` exits 0; `make members` exits 0.
- A live round on a governed fixture project whose gate is this repository's
  shape (`make gate` plus a language gate): the build passes under the fence
  and mints a receipt, the broker publishes, and the verify stage passes under
  its fence. Any gate or acceptance line that needs a credential to pass is
  found here, named in the status section, and resolved by changing the gate,
  or by the project's journaled allowance for live acceptance, never by
  unfencing a path.

## Verification

```sh
cd members && bun test src/orchestrator/gate-fence.test.ts
cd members && bun test src/orchestrator/stages/build.test.ts
cd members && bun test src/orchestrator/stages/verify.test.ts
cd members && bun test src/orchestrator/broker.test.ts
cd members && bun test src/orchestrator/fence.test.ts
make gate
```

## 6. Out of scope, and what stays open

- **Everything 125 §6 names.** `HOME` reads, absolute paths and `~/.ssh` stay
  open for the gate and the verify stage as for the session. Draft 126 wraps
  them.
- **A process that means to escape.** An absolute path skips the shims
  (measured: `/opt/homebrew/bin/gh --version` answers under the fence). The
  refusal log is writable by the process it records, which is why no tally is
  read from it (B-3). See D-8.
- **Writes outside the candidate.** An unconfined session can write the shared
  `.git/config` (a credential helper, `core.fsmonitor`, a filter) or
  `.git/hooks`, which the daemon's credentialed git would then read. B-7 keeps
  hooks off; configuration-defined commands stay a residual, and confining
  writes is 126's.
- **Operator-invoked verbs.** `adopt synthesize` (whose session is scrubbed,
  not fenced, in the operator's checkout), `journal export`'s attest and
  `statecraft template upgrade` run as the operator's own command in the
  operator's shell. The synthesize session is a named follow-up for the adopt
  specs, not part of this one.
- **A private dependency fetched over SSH during the gate** fails, as it does
  in the session under 125. A project that needs one fetches over HTTPS or
  vendors it.

## 7. Resolved decisions

D-1 (2026-09-11). The session's expression, not a gate-specific environment.
Two environments would drift, and the property worth having is that the gate
can do nothing the session could not. Reusing `applyFence(scrubEnv(...))`
makes that a fact of the code rather than of a test.

D-2 (2026-09-11). Scrub in in-place mode too. The session is scrubbed in every
mode; leaving the gate unscrubbed where there is no fence would keep a
difference with no reason behind it. The cost is that a fixture world's gate
no longer sees `GH_TOKEN`, which no existing gate reads.

D-3 (2026-09-11; where the count is read from, superseded 2026-09-12 by D-9). Attribution by difference, not a second log. The shims are
125's and stay a pure function of the fence directory; reading the tally
before and after a sequential suite attributes a refusal exactly without
changing them.

D-4 (2026-09-11). The fence goes on the evidence, not the receipt (B-5). A
receipt field would be a schema change for a fact the evidence already
carries, and receipt revisions are doc 05 D68's to make once.

D-5 (2026-09-12; adopted by the owner the same day, D-9). A refusal fails acceptance
(B-4). The alternative is to record the refusal and accept the round on its
exit codes. Failing is recommended because a receipt says "a stable, passing
gate over this revision" (121 D49), and a round in which a command reached for
a credentialed tool and hid the result is not what that sentence describes.
The cost is compatibility: a test that probes for `gh` by running it (`gh
--version`) is refused and tallied, because the shim does not read its
arguments, so such a project fails acceptance until its probe changes.
Doc 05 D75.

D-6 (2026-09-12). Hooks run fenced where no credential is needed, and not at
all where one is. Disabling hooks everywhere would change what an ordinary
project's commit does (a formatting hook); running them everywhere with the
daemon's environment is F7. The split follows the credential, which is the
thing this spec protects. Doc 05 D74.

D-7 (2026-09-12; adopted by the owner the same day, without the split, D-9). The verify stage is in scope,
superseding doc 05 D60's residual. Acceptance is read at the base so that the
session being judged cannot rewrite its own acceptance, and live acceptance
is an operator's journaled allowance rather than a spec annotation, because a
spec is a file the session can edit. When a pinned spec-spine release provides
`verify --plan --json` (doc 05 R3), the base block is read through it. The
owner may instead split B-8 to B-10 into their own spec after this one. Doc 05
D77.

D-8 (2026-09-12). Credential protection, not hostile-code isolation. The
fence takes credentials out of reach so the obvious move fails and the broker
stays the only working publisher. It does not confine a process that means to
escape: absolute paths skip the shims, `HOME` is readable, and the refusal log
is a same-user file the fenced process can truncate, which is why B-3 counts
at the supervisor instead. A tally is therefore evidence about a capable
process that reached for a fenced tool through `PATH`; a tally of zero proves
nothing stronger, and 131 labels it that way. Doc 05 D76.

D-9 (2026-09-12, the owner). Approved by the adoption of revision 4's CLI-02
(doc 05 §19). A refusal fails both the gate and verify-stage acceptance even
when a command swallows its exit (D-5, B-4, B-8); the verify stage's fencing
and base-revision acceptance stay in this spec rather than a split (D-7); an
allowance for live acceptance is journaled (B-9); hooks, verify commands and
the broker's push are protected (B-6 to B-8); and an authorized broker push
still succeeds, which FR-006 and FR-010 hold as the positive control. The
adoption adds one requirement the draft lacked: refusal accounting belongs to
the supervisor and a child cannot erase it. B-3 now counts at the supervisor,
which supersedes D-3's reading of the log, and FR-008 turns the truncation F8
measured from a pinned limit into a regression test.

## Status (2026-09-12, approved)

Approved on 2026-09-12 by the owner's adoption of revision 4 (doc 05 §19,
CLI-02; D-9), `implementation: pending`. It follows 128. The adoption added
B-3's supervisor-owned count and the 125 edges it needs; the rest of the
revision-3 text stands as drafted.

## Status (2026-09-12)

Authored `draft`, `implementation: pending`, on 2026-09-11 from doc 05 §3 F2.
Revised on 2026-09-12 from doc 05 §18 (F7, F8; D74 to D77) after the packet's
third revision asked for every execution path to be disposed of and for a rule
on a swallowed refusal. The revision rests on throwaway probes at `874766b`
against the production runner, broker push seam and verify runner, with
fabricated tokens, temporary repositories and local bare remotes; nothing
touched a real remote or the operator's daemon. Nothing is implemented, and
approval is a human flip. D-5 and D-7 are the choices most worth a look at
approval.
