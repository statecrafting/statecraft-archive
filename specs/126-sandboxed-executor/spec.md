---
id: "126-sandboxed-executor"
title: "Credential protection: the OS refuses the credential reaches a shim could only discourage"
status: draft
created: "2026-09-10"
implementation: pending
depends_on:
  - "125-credential-fence"
  - "129-gate-fence"
  - "122-action-broker"
  - "121-candidate-and-receipt"
establishes:
  - "members/src/orchestrator/sandbox.ts"
  - "members/src/orchestrator/sandbox.test.ts"
  - "members/src/orchestrator/signer.ts"
  - "members/src/orchestrator/signer.test.ts"
extends:
  # 043 owns the driver seam; the sandbox wraps argv at the same spawn where
  # 125 overlays the fence on the environment.
  - { spec: "043-driver-seam", unit: "members/src/orchestrator/driver.ts", nature: additive }
  # 121 owns the candidate; the profile and the signing helper are written
  # beside the fence, on open.
  - { spec: "121-candidate-and-receipt", unit: "members/src/orchestrator/candidate.ts", nature: additive }
  # 014 owns the session; evidence gains the denial tally, as 125 gave it
  # `fenceRefusals`.
  - { spec: "014-session-driver", unit: "members/src/orchestrator/session.ts", nature: additive }
  # 122 owns the broker; signing joins publishing as an act the engine
  # performs on the candidate's behalf.
  - { spec: "122-action-broker", unit: "members/src/orchestrator/broker.ts", nature: additive }
  # The three stages that open a candidate and spawn a session.
  - { spec: "016-stage-build", unit: "members/src/orchestrator/stages/build.ts", nature: additive }
  - { spec: "017-stage-ship", unit: "members/src/orchestrator/stages/ship.ts", nature: additive }
  - { spec: "018-stage-shepherd", unit: "members/src/orchestrator/stages/shepherd.ts", nature: additive }
  # Doc 05 D61 is the revision this draft carries (2026-09-11).
  - { spec: "110-corpus-merge", unit: { kind: directory, path: "docs/design/" }, nature: additive }
references:
  - { unit: { kind: file, path: "docs/design/04-the-governed-substrate.md" }, role: context }
  - { unit: { kind: file, path: "docs/design/05-the-realignment-checked.md" }, role: context }
summary: >
  Spec 125 fenced the credential path a driven session reaches for first,
  and recorded three residuals it could not close: HOME stays readable, an
  absolute path bypasses PATH, and ~/.ssh keys stay on disk. All three go
  around PATH, so nothing built from shims and environment variables
  reaches them; what refuses a read of a path is the operating system.
  This spec makes the engine apply an OS deny profile at the session spawn
  in driver.ts and at the gate's spawn (after 129 fenced it), written beside
  the candidate. It closes the ~/.ssh read, the gh config read and the
  absolute-path exec outright, and closes the keyring only ergonomically,
  because the Claude provider authenticates out of that same keyring. The
  threat model is 125's: a capable session, not a hostile one, and the
  property is credential protection for a complete journal, not hostile-code
  isolation and not preventive confinement of territory or source authority;
  the profile confines no writes and claims no capability token. Signing
  moves to the engine rather than being abandoned, so the candidate holds no
  signing key and publication stays autonomous. Whether the profile must be
  in force is an operator policy with a required setting, and every run's
  result says whether protection was applied, degraded or refused, with every
  keychain and environment residual named in it.
---

# 126: The sandboxed executor

## 1. Purpose

Spec 122 made the broker the only *sanctioned* path to publishing. Spec 125
made it the only *ergonomic* one: refusing `gh` and `ssh` shims first on
`PATH`, git redirected off every inherited credential helper. The value of
that boundary is the journal, and the journal is complete only if the broker
is the path that works. 125 bought integrity, and §6 recorded three
residuals rather than hiding them.

The three share a shape the fence could not reach, because a shim is a file
on `PATH` and every residual goes around `PATH`:

- `HOME` stays readable, so `~/.config/gh/hosts.yml` answers a session that
  reads it, and the platform keyring answers one that asks it;
- a binary invoked by absolute path never consults `PATH`, so
  `/opt/homebrew/bin/gh` still runs;
- `~/.ssh` is a directory, not a command, and no shim stands in front of it.

No list of names closes any of these, however long it grows. What refuses a
read of a path is the operating system.

Neither provider can be asked to do it. The Claude driver's permission modes
gate prompts and do not fence the filesystem, which is exactly why it does
not claim `workspace-write` (120 D-2). Codex does confine, but
`--sandbox workspace-write` confines *writes* to the workspace, and every
residual here is a read or an exec. So the engine applies its own, at the
one place it already constructs the child's world: the spawn in `driver.ts`
where 125 overlays the fence.

**The threat model, stated so the name is not read as more.** The adversary
is 125's: a capable session told to finish, which takes the obvious path when
the obvious path works. It is not a hostile process trying to escape, and the
property bought is 125's too, a complete journal, not confidentiality and not
confinement. "Sandboxed" here means "the named credential reaches are refused
by the operating system", and nothing wider: the profile confines no writes,
so it neither lets the Claude driver claim `workspace-write` (120 D-2) nor
enforces a spec's territory, a work scope or a set of symbols. A later
executor that does confine source authority is a different spec with a
different profile shape (doc 05 D70), and this one does not grow into it.

**What this spec does not do is take publication away from the engine.**
The point of confining the session is that the broker keeps working while
the session cannot reach a credential. A run still pushes, opens and merges
by itself, on a receipt and a lease (122). Losing credential access inside
the coding session must not turn into a human pushing by hand, and B-5 and
B-7 exist to keep that true.

## 2. Territory

- `members/src/orchestrator/sandbox.ts`: the profile builder, the argv
  wrapper, the platform probe, the policy check and the denial tally.
- `members/src/orchestrator/sandbox.test.ts`: the suite.
- `members/src/orchestrator/signer.ts`: the signing helper and the
  daemon-side signing service (B-5).
- `members/src/orchestrator/signer.test.ts`: its suite.
- `members/src/orchestrator/candidate.ts` (extends 121): the profile and the
  helper are written on `openCandidate`, beside the fence.
- `members/src/orchestrator/driver.ts` (extends 043): argv is wrapped at the
  session spawn, where the fence is already overlaid on the environment.
- `members/src/orchestrator/session.ts` (extends 014): `SessionEvidence`
  gains `credentialDenials` and `credentialProtection` (B-6, B-8).
- `members/src/orchestrator/broker.ts` (extends 122): signing joins push,
  openPr and merge as an act the engine performs on the candidate's behalf.
- `members/src/orchestrator/stages/{build,ship,shepherd}.ts` (extends
  016, 017, 018): each carries the counts and the mode to its result, and
  build's `runGate` wraps each gate and bracket command (B-7).

## 3. Behavior

### B-1. The profile sits beside the candidate, never inside it

`buildSandbox(homeDir, project, branch)` writes to
`<home>/sandboxes/<project>/<branch>/profile.sb`, the sibling shape 125 B-2
chose for the fence and for the same reason: a file under the worktree
would dirty the tree that 121 B-4 requires clean before a receipt. The
profile is a pure function of its inputs, so a stale profile from a crashed
run is overwritten rather than trusted.

### B-2. The profile is a deny-list, not an allow-list

The profile opens `(allow default)` and then denies, by name, the credential
material 125 §6 enumerated. It does not enumerate what a session may read.

This is a deliberate weakening of the obvious design, and D-1 records why:
both providers authenticate out of `HOME`, the session's own toolchain is
spread across the machine, and an allow-list tight enough to be worth
calling containment breaks the session it is protecting. 125 §6 already
named that trade. A deny-list that provably closes the reaches it names is
worth more than an allow-list that has to be widened until it closes none.

### B-3. The deny set

Denied for reading:

- `~/.ssh` (subpath): the keys, `known_hosts` and any `config` naming them;
- `~/.config/gh` (subpath): where `gh` stores a token in plaintext. 125
  already points the session's `GH_CONFIG_DIR` at an empty directory; this
  denies the real one, which is what an absolute read reached around;
- `~/.git-credentials` and `~/.config/git/credentials` (literal).

Denied for execution:

- every `gh` and `ssh` binary discoverable on the host at profile-build
  time, by absolute path, plus the conventional locations
  (`/usr/bin/ssh`, `/opt/homebrew/bin/gh`, `/usr/local/bin/gh`);
- `/usr/bin/security` (macOS), the keyring CLI 125 §6 names.

**Not denied: the keychain itself.** An earlier draft of this spec denied
`mach-lookup` on `com.apple.SecurityServer`, which would have closed the
keyring completely. It is not in the deny set because it breaks the Claude
provider outright: Claude Code keeps no credentials file on macOS and reads
its own credential from that keychain (`Claude Code-credentials`). D-6
records the measurement. Denying the CLI closes the ergonomic path; a
session that links the Security framework directly still reaches the
keyring, and §6 carries that as a residual this spec does not close rather
than a claim it quietly drops.

The fence (125) stays on top of all of this. It is not made redundant: the
fence produces a *legible refusal* naming the broker, and the sandbox makes
the refusal unavoidable. A session that runs `gh` from `PATH` should meet
125's message, not an opaque OS denial.

### B-4. The wrapper is applied at the session spawn

On a supported platform, `wrapArgv(profile, argv)` returns
`["sandbox-exec", "-f", <profile>, "--", ...argv]`. `driver.ts` applies it
to the member spawn that already receives `applyFence(env, fenceDir)`, so
the provider inherits the confinement the same way it inherits the fence,
without the member knowing about it.

### B-5. Signing moves to the engine, and is not abandoned

Denying `~/.ssh` denies the SSH signing key this repository's
`commit.gpgsign` + `gpg.format=ssh` configuration uses. The candidate must
therefore not sign with that key, and the naive answers are both wrong:
handing the key to the session re-opens the reach this spec exists to
close, and committing unsigned assumes an answer about branch protection
this spec has no business assuming (D-3).

Signing becomes a brokered act, the same shape 122 gave publication. The
candidate's fence-local `GIT_CONFIG_GLOBAL` (125) sets `gpg.ssh.program` to
a helper on the fence `PATH`. The helper holds no key: it forwards the
payload to the daemon over the seam the broker already uses, the daemon
signs **outside** the sandbox with the operator's key, and the signature
returns. The session's commits are signed, provenance is preserved, and the
key never enters the confined process.

Every signature the daemon issues is journaled as `broker.sign` with the
commit it covers, so a signature is as accountable as a push.

If the signing service is unreachable, the run does not silently produce
unsigned commits: the stage fails with the reason, which is the same
posture 122 takes when a receipt or a lease is missing.

### B-6. Protection is an operator policy, and its result is applied, degraded or refused

`sandboxSupport()` reports `seatbelt` where `/usr/bin/sandbox-exec` is
executable, `bwrap` where `bwrap` is on `PATH`, and `none` otherwise.

What happens on `none` is the operator's decision, not this spec's, and it
is expressed in the profile vocabulary 120 already established:

- **`required`**: a run whose deny profile is unavailable does not start.
  The stage refuses with the platform and the reason, journaled. This is
  the setting for unattended operation, where "Statecraft is running" must
  imply "the B-3 deny set is in force". It does not imply containment:
  §6's reaches stay open under `required` exactly as under `preferred`.
- **`preferred`**: the session runs without the profile and the engine
  journals `sandbox.unavailable` with the platform and the reason, exactly as
  124 journals an unqualified binary and 120 journals a degraded capability.

Every session and gate spawn this spec wraps reports its result as
`credentialProtection` on `SessionEvidence` and on the gate's evidence, in
120's outcome vocabulary so a reader has one set of words for what an
executor protected:

- `policy`: `required` or `preferred`, the setting in force (declared);
- `outcome`: `applied` when the B-3 deny set was in force for the spawn,
  `degraded` when the spawn ran with less than the policy asked for (under
  `preferred`, no profile at all), `refused` when the policy refused the run
  (under `required`, no profile available);
- `platform` and `profileDigest`: the support `sandboxSupport()` reported and
  the SHA-256 of the profile text applied, null when none was (enforced);
- `residuals`: the reaches that stayed open for this spawn, by closed name,
  never empty. On macOS it always holds `keychain-service` (the Security
  framework reaches the keyring, D-6), `environment-unlisted` (a credential
  in an environment variable outside the scrub's names reaches the child),
  `home-readable` and `network`; under `degraded` or `refused` it also names
  every B-3 reach the profile would have closed.

A reader never has to infer the deny set from the absence of a complaint, and
a residual is read from the result rather than from §6. D-7 records why
`required` is not simply the only behavior, and D-11 why the outcome
vocabulary is 120's.

### B-7. The blast radius is the candidate's processes, and only those

The profile wraps two spawns: the member the driver spawns for a session,
and each gate and bracket command the build runs in the candidate. The gate
belongs inside because it executes code the session wrote (the Makefile, the
tests, the build scripts), and 129 established that it runs with the
session's fenced environment; this spec adds the profile to the same spawn,
so the gate can do nothing the session could not.

The daemon's own processes are untouched, which is what keeps the broker
working: the broker pushes, opens and merges from the daemon (122), and the
signing service of B-5 runs there too. It must keep the credentials the
candidate is denied. This is 125 B-6's property restated for the OS
boundary, and it is asserted in `sandbox.test.ts` for the reason 125 D-4
put that case beside the fence's own suite.

This is also the property that keeps publication autonomous: confining the
candidate's processes removes no capability from the engine.

### B-8. A denial is counted and reaches the evidence

Seatbelt denials are reported on the child's stderr. The driver tallies
them into `credentialDenials` on `SessionEvidence`, required with an explicit
zero, which is 125 D-3's shape and for its reason: a missing tally must not
read as "nothing was denied" to a consumer downstream.

## 4. Functional requirements

- **FR-001.** `sandbox.test.ts` asserts the profile text is a pure function
  of its inputs, and that a hand-edited profile is overwritten on the next
  `openCandidate`.
- **FR-002.** Deny-set tests: each B-3 entry is present in the built
  profile, `com.apple.SecurityServer` is **absent** from it (D-6), and the
  profile parses on a machine reporting `seatbelt`.
- **FR-003.** Wrapper tests: `wrapArgv` returns argv unchanged when the
  policy is `preferred` and support is `none`, and the `sandbox-exec` form
  otherwise.
- **FR-004.** Blast-radius test: a process the daemon spawns itself is
  unwrapped (B-7), asserted beside the broker's own publish path; a gate
  command the build runs in the candidate is wrapped, and a gate command
  that reads `~/.ssh` fails.
- **FR-005.** Evidence tests: `credentialDenials` is present with an
  explicit zero on a clean run; `credentialProtection` names the policy, the
  outcome `applied`, the platform, the profile's digest and a `residuals` list
  holding `keychain-service` and `environment-unlisted`; and both reach each
  of the three stage results and the gate's evidence.
- **FR-006.** Policy tests: with support forced to `none`, `required`
  refuses the run with outcome `refused` and journals the refusal, and
  `preferred` runs with outcome `degraded`, a null digest and every B-3 reach
  among its residuals, and journals `sandbox.unavailable` exactly once.
- **FR-007.** Signing tests: the helper carries no key material; a commit
  made through it verifies against the operator's public key; the daemon
  journals `broker.sign`; and an unreachable signing service fails the
  stage rather than producing an unsigned commit.
- **FR-008.** No claim widens: neither driver's manifest gains a capability
  token because of this spec, and the Claude driver's manifest still omits
  `workspace-write` with the profile applied (asserted against the contract
  crate's token set).

## 5. Acceptance

Shell probes establish that a mechanism *can* deny a path. They do not
establish that a provider still works, and this spec is not accepted on
them.

- `bun test` in `members/` is green, including the two new suites.
- `make gate` exits 0 and `make members` exits 0.
- **A live round for each provider.** A build session driven by Claude and
  a build session driven by Codex each, inside the sandbox: authenticate,
  read the repository, make a change, run the project's gate, and commit
  through the B-5 signing helper with a signature that verifies. A failure
  to authenticate is a failure of this criterion, not a note.
- **A live brokered publication.** The same round's ship stage pushes and
  opens a pull request through the broker, and the journal shows
  `broker.action` for `push` and `openPr` and `broker.sign` for the
  commits. No human pushes or merges by hand.
- **The four reaches, confirmed closed from inside a real session** (not a
  shell probe): reading `~/.ssh` fails, reading `~/.config/gh` fails,
  executing `gh` by absolute path fails, and executing `/usr/bin/security`
  fails, while the session's own provider credential still resolves.
- **The same four, confirmed closed from the gate** of the same round, by a
  gate command added for the check and removed after it.
- **The policy is exercised both ways** on a machine reporting `none`:
  `required` refuses, `preferred` proceeds and journals.

## Verification

```sh
cd members && bun test src/orchestrator/sandbox.test.ts
cd members && bun test src/orchestrator/signer.test.ts
cd members && bun test src/orchestrator/candidate.test.ts
cd members && bun test src/orchestrator/driver.test.ts
make gate
```

## 6. Out of scope, and what stays open

The other half of doc 04 §11. This spec is the sandboxed executor; the
**brokered file service** is not built here. The profile denies, it does not
mediate: there is no path by which a session asks the engine for a file it
was refused, and no record of such a request.

Reaches this spec does **not** close, stated so that "sandboxed" is not read
as "contained":

- **The keyring through the Security framework.** B-3 denies the
  `/usr/bin/security` CLI and deliberately not the keychain service,
  because Claude Code authenticates from it (D-6). A session that links the
  framework directly still reaches every item the user's keychain holds,
  including `gh`'s. This is the one residual of 125 §6 that 126 closes only
  ergonomically, and it is the strongest argument for the brokered file
  service that follows.
- **Network access.** The session keeps it, needing it to be a coding agent
  at all. A session that means to exfiltrate, or to publish over HTTPS with
  a token obtained another way, is not stopped by a filesystem profile.
- **A secret already in the session's context.** The sandbox denies reads
  of credential material on disk. It cannot un-know what has been read.
- **Anything not launched by this engine.** The wrapper applies to provider
  sessions the driver spawns and to the build's gate. An agent the operator
  starts directly is outside it, and this spec hardens no machine.
- **The verify stage.** It runs a merged spec's declared acceptance after
  publication. 129 B-8 fences its environment; this spec does not add the
  profile to it.
- **Source authority.** The profile denies credential reads and execs. It
  does not confine writes to the candidate, to a spec's territory, to a work
  scope or to a set of symbols, and no reader of `sandboxMode` should take it
  to. An operating-system rule fences a file, not a symbol, so symbol-level
  authority would be checked after the change in any case (doc 05 D70).
- **Linux as a qualified platform.** See B-6 and D-4.
- **`sandbox-exec` being a supported Apple interface.** It is deprecated
  and present; D-2 records the bet and the fallback.

Known compatibility effects, accepted rather than discovered later:

- **SSH-authenticated dependency fetching inside the session breaks.**
  Denying `~/.ssh` and the `ssh` binary denies a private dependency fetched
  over SSH. Projects that need one must fetch over HTTPS, or vendor it, or
  run `preferred`. §5's live rounds are the check.

Also out of scope: signing the action record (122 §6), a permit format for
the hosted plane, and per-stage driver routing.

## 7. Resolved decisions

D-1 (2026-09-10). Deny-list, not allow-list. An allow-list is the stronger
shape and was rejected on evidence: both providers authenticate out of
`HOME`, the session's toolchain is spread across the machine, and the
allow-list would have to be widened on every provider upgrade until it
enumerated most of the filesystem. 125 §6 identified the same trade from the
other side. The weakness is stated rather than finessed: it closes the
reaches it names, and a reach nobody enumerated stays open.

D-2 (2026-09-10). Seatbelt (`/usr/bin/sandbox-exec`) on macOS, not a
container. A container changes the developer's loop, the worktree's identity
and the provider's own installation, for a spec whose job is to deny a small
set of reads. Seatbelt is deprecated by Apple, still shipped (present on
macOS 26.5.1, the machine this was written on), and is what Codex's own
sandbox uses on macOS, so the bet is one the ecosystem already makes. If
Apple removes it, `sandboxSupport()` reports `none` and B-6's policy decides.

D-3 (2026-09-10). Signing is brokered, and this spec asserts nothing about
unsigned commits. An earlier draft had the candidate commit unsigned, on the
grounds that every commit on `main` is committed by
`GitHub <noreply@github.com>` and signed with GitHub's key because the squash
merge is created server-side. That observation is true and it is not
sufficient: it describes what a *merged* commit looks like, not whether a
head branch carrying unsigned commits is accepted. This repository has
`required_signatures` enabled on `main` with `enforce_admins` enabled, and
GitHub documents that unsigned head-branch commits can block a merge. Rather
than resolve that question by experiment on a protected branch, B-5 removes
the dependency on the answer: the commits are signed, by the engine, with
the key kept outside the sandbox. Handing the key to the session was
rejected outright, and is not the only alternative to unsigned.

D-4 (2026-09-10). macOS is qualified, Linux is declared. The `bwrap` branch
is written and unit-tested, but §5's live criteria are macOS only, and this
spec does not claim a Linux confinement it has not run. That mirrors 124's
distinction between a claimed capability and a qualified one: a claim nobody
exercised is a claim, and the record should say which it is.

D-5 (2026-09-10). The fence (125) stays, and is not folded into the profile.
They do different jobs: the fence produces a legible refusal naming the
broker, tallied as `fence.refused`, and the sandbox makes the refusal
unavoidable. Removing the fence would replace a message a session can act on
with an OS denial it cannot interpret, and would lose the journal kind 125
added to the export policy at version 5.

D-6 (2026-09-10). The keychain service is not denied, and the keyring is
therefore closed only ergonomically. This reverses an earlier draft of B-3,
on a measurement taken on the authoring machine: Claude Code keeps **no**
credentials file (`~/.claude/.credentials.json` is absent) and holds its
credential in the macOS keychain as `Claude Code-credentials`. Under a
profile denying `mach-lookup` on `com.apple.SecurityServer`, a lookup of
that item returns 44 rather than 0: the deny would break the Claude
provider's own authentication on every driven session. Codex is unaffected,
authenticating from `~/.codex/auth.json`. Closing the keyring properly
therefore requires either a provider that authenticates without it or the
brokered file service, and until then §6 carries it as open. The general
lesson is recorded because it will recur: a deny that closes a reach is not
adopted until a live provider session has run behind it.

D-7 (2026-09-10). Two policy settings, and `preferred` is not the default
for unattended work. `required` is what makes containment a property a
reader can rely on. `preferred` exists because this engine also runs on
machines that cannot offer a sandbox, and refusing every run there would
make the spec undeployable rather than safe. The choice is the operator's
and is recorded per run in `sandboxMode`, so a session that ran without
containment is legible as such rather than indistinguishable from one that
ran with it.

D-8 (2026-09-11, proposed revision). The threat model is stated, and
`required` promises the deny set, not containment. The earlier text let
"containment is in force" stand for what `required` guarantees, while §6
listed the network, the keyring through the Security framework and a secret
already read as open under every setting. A reader relying on `required` for
unattended operation needs the narrower sentence, and doc 05 D61 records why
the name "sandboxed executor" must not be read as authority confinement.

D-9 (2026-09-11, proposed revision). The gate is inside the blast radius.
The earlier B-7 wrapped only the provider session, and the gate executes
code the session wrote, with (until 129) the daemon's full environment. A
profile that denies the session `~/.ssh` and leaves the session's own tests
free to read it closes nothing the session could not route around by
writing a test. 129 fences the gate's environment first because it needs no
OS mechanism; this spec adds the profile to the same spawn.

D-10 (2026-09-11, proposed revision). No capability token is claimed or
widened. The capability vocabulary (120) makes claims about what a driver
enforces, and `workspace-write` means writes confined to the candidate. A
read and exec deny-list confines no writes, so it must not become the reason
a driver claims that token, and a future token for "credential reads
denied", if one is wanted, is a change to 120's vocabulary in its own spec.

D-11 (2026-09-12, the owner). The adoption of revision 4's CLI-03 (doc 05
§19) sets what this spec is: credential protection, reporting `applied`,
`degraded` or `refused` with every keychain and environment residual visible
in the result (B-6), and never a claim of hostile-code isolation or of
preventive territory confinement. The outcome words are 120's because a
reader already meets them for what a driver enforced, and one vocabulary for
"what the executor protected" is harder to misread than two; B-6's result
therefore replaces the draft's `sandboxMode` and `sandboxDenials` names,
whose word "sandbox" read as isolation. CLI-09 confirms D-10: a capability
token stays the name of what an executor protects, never a user's
authorization. D-8 to D-10, proposed on 2026-09-11, are adopted with it. The
spec's id keeps its original slug; the title no longer says "sandboxed
executor". It is scheduled after 128 and 129, and it delays nothing in 132.
D-7's "containment" is read as D-8 narrowed it: the B-3 deny set.

## Status (2026-09-12)

Amended on 2026-09-12 to the owner's adoption of revision 4 (doc 05 §19,
CLI-03; D-11): the title, the summary, B-6's result (policy, outcome,
platform, digest, residuals), B-8's tally name, FR-005, FR-006 and §6's
verify-stage line, which 129's revision had made stale. Still `draft`,
`implementation: pending`: the flip to `approved` is recorded in the change
that dispatches it, after 128 and 129.

## Status (2026-09-11)

Still `draft`, `implementation: pending`. Revised on 2026-09-11 from doc 05
D61, and **the revision is a proposal for the owner's review, not a change the
owner has accepted**: the summary and §1 state the threat model; B-6 narrows
what `required` guarantees; B-7, FR-004 and §5 bring the build's gate inside
the blast radius; B-6 and FR-005 record the profile's digest; FR-008, §6 and
D-10 rule out any capability claim. The dependency on 129 is new, because 129
fences the gate's environment and this spec wraps the same spawn. Nothing the
2026-09-10 revision decided is reversed.

## Status (2026-09-10)

Authored `draft`, `implementation: pending`. It comes from doc 04 §11's
first open item and from the three residuals 125 §6 recorded.

Revised before approval, on owner review, in three places: D-3 (the signing
justification was insufficient, and signing is now brokered rather than
abandoned), D-6 and B-3 (the keychain deny would have broken Claude's own
authentication, measured), and B-6 and D-7 (containment is an operator
policy with a `required` setting, not a best effort). §5 was rewritten at
the same time: shell probes are feasibility evidence, and acceptance now
requires live Claude and Codex sessions authenticating, building and
publishing through the broker under the sandbox.

Measurements taken on the authoring machine (macOS 26.5.1) that the spec
rests on, recorded so a later reader can retake them: under a profile of the
B-2 shape, reading `~/.ssh` was denied, reading `~/.config/gh/hosts.yml` was
denied, executing `gh` by absolute path was denied, and `/usr/bin/security`
exited 71 against 44 outside the profile, while an ordinary command still
ran; `Claude Code-credentials` resolved at 0 on the host and 44 under a
`SecurityServer` deny; `main` reports `required_signatures` enabled and
`enforce_admins` enabled. These establish feasibility and the two
constraints, not acceptance.

Approval is a human flip.
