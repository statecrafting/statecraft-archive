# 04: The governed substrate

The fourth design record. Doc 02 made the tool repository a monorepo and
sequenced the Rust ports; doc 03 added a second provider and found, at
D39, that the posture vocabulary is provider-relative and that making it
neutral is "a larger design". This document is that design, plus the
correctness work the Codex sequence exposed and the boundaries a third
provider needs before it is admitted. It was written on 2026-09-09 from
an external assessment of the four repositories (spec-spine, this one,
the control plane, the retired observatory) and from a read of the code
the assessment cited, each claim checked against the tree at
`b7baf2d`.

The method is doc 01's and doc 03's: one question per section, the
decision numbered so a spec can cite it, the evidence named. Decisions
continue doc 03's numbering at D41.

## 1. What uniform governance can mean

The assessment's central claim, accepted here: a uniform substrate is
uniform at three points, the admission of work, the acceptance of code,
and the authorization of an external effect. It is not uniform in tool
interception, permission prompts, cost reporting or conversational
behavior, and translating CLI flags cannot make it so: Claude's
`--allowedTools` preapproves calls that `--tools` makes available, Codex
has no tool allowlist at all, and a `guarded` profile therefore means a
different protection under each driver (doc 03 D34, D39). The substrate
must say what protection a run needs, who enforces it, and what happens
when nobody can.

The repositories already hold the seams. spec-spine evaluates authority
(ownership, lifecycle, freshness, coupling, verification) independently
of any agent. This repository supervises runs, negotiates with drivers,
and collects evidence. The control plane authorizes and executes the
privileged delivery verbs behind its API, which the CLI and MCP faces
reach with one identity (101). Nothing here moves a responsibility
between them; every decision below lands inside this repository.

## 2. What the Codex sequence exposed

Four findings, each verified on disk, each with a spec below.

- **The gate floor writes before it reads.** `GATE_COMMANDS`
  (gate-contract.ts) opens with `spec-spine compile`, then `index check`,
  lint and couple. A stale committed registry is repaired before anyone
  looks at it, and the couple base is the literal `origin/main`, a
  moving ref that the Makefile (spec 072's three-step resolution) and CI
  resolve properly while the engine does not. `spec-spine check` exists
  for precisely this read and appears nowhere in the engine.
- **A completed session erases a refusal.** `classify` returns
  `completed` on any non-error result before the hook-blocked rule can
  fire (classify.rs, classify-termination.ts), and the build stage keys
  its whole completion path on that one enum. Doc 03 §8 recorded the
  consequence: a Codex hook refusal ends the turn as `turn.completed`.
  The gates still run, so no bad build was accepted, but the denial
  leaves no trace in the evidence.
- **Merge is unbound from the checked head.** Shepherd polls check runs
  by head sha and then calls `mergePr(number, method)` (ship.ts), which
  sends no `sha`. A push between the last green poll and the merge
  merges code no check saw. GitHub's merge endpoint accepts an expected
  head and refuses a mismatch.
- **Kit parity is content parity.** `scripts/codex-kit.py` copies skills
  and emits agent instructions but drops `tools:` and `model:` silently
  (118 B-2 says so), and its stray walk sees files, not directories: an
  empty `.agents/skills/init/` sits in the tree today, invisible to
  `--check`.

Two more facts shape the boundaries: the build stage mutates the
operator's own checkout in place (`git checkout -b`, no worktree; only
verify isolates), and the driven session inherits every environment
variable but `ANTHROPIC_API_KEY`, `GH_TOKEN` and `GITHUB_TOKEN`
included, then is instructed to push and run `gh pr create` itself
(ship.ts, the "standing authorization" paragraph).

## 3. The outcome has more than one dimension

- **D41 (denials are evidence, independent of completion):** a session's
  result carries, beside its classification, the refusals its harness
  reported: a count and a bounded sample, read from the provider's
  structured event for a refused tool call, never from the model's final
  text. `completed` with denials stays `completed`; the gates decide
  acceptance, and the denials ride into the stage evidence and the
  export. The classification enum is not widened: a contained refusal
  followed by finished, permitted work is not a failure, and turning it
  into one would punish the guard for working.
- **D42 (the floor reads first, and names its base):** the engine's gate
  floor becomes `spec-spine check --fail-on-warn`, `lint --fail-on-warn`,
  `couple --base <sha> --head HEAD`, the base resolved to a commit at
  stage start from the project's default branch and journaled.
  Regeneration (`compile`, `index`) stays where 016 D-8 put it, in the
  orchestrator-owned bracket that flips the frontmatter, and is a
  candidate step, not the acceptance read. The Makefile's fourth command,
  `index coverage --fail-on-untraced`, is this repository's policy and
  belongs in its gate contract, not in the floor every project inherits.
- **D43 (merge names the head it verified):** `mergePr` takes the
  expected head and sends it; shepherd re-reads the PR head after the
  last green poll and refuses to merge a head it did not watch. A refusal
  is `failed` with `needsHuman`, journaled with both shas.

## 4. A capability vocabulary both providers map onto

- **D44 (properties, not tool names):** the contract crate gains a closed
  set of capability tokens, the four the Codex driver already declares as
  degradations (`tool-allowlist`, `max-turns`, `mcp-config`, `cost`) plus
  two the boundaries below need (`workspace-write`: writes confined to
  the candidate; `hook-enforcement`: the project's hooks run). A
  provider's manifest lists the tokens it supports. The profile's tool
  lists stay Claude-named under the `tool-allowlist` token: the
  vocabulary is neutral, the payload of a token may not be, and saying
  so is the honest half of D39.
- **D45 (required refuses, preferred degrades):** a session request
  carries `requirements: {required, preferred}`. The engine reads the
  driver's manifest before spawning, as 043 B-6 already does for
  `mcp-config`, and refuses a required token the driver does not support
  without starting a process: journaled `driver.refused`, the result
  `crashed` with the unsupported tokens in its detail. A preferred token
  the driver lacks is journaled `driver.degraded` and the session runs.
  The existing `mcp-config` refusal becomes the first instance of the
  rule rather than a special case. `session.init` carries `applied` beside
  `degraded`, so the effective configuration is evidence, not a claim.
- **D46 (the tier stays, as a summary):** `reference` and `basic` remain
  on the manifest for compatibility; they are derived from the four
  request tokens (reference means all four are supported; the two
  boundary tokens are claims about confinement and enforcement that no
  tier summarizes), never consulted for a decision the tokens can make.
  The Claude driver does not claim `workspace-write`: its permission
  modes gate prompts and do not fence the filesystem.

## 5. The candidate and the receipt

- **D47 (the build works a candidate, not the checkout):** the build
  stage adds a worktree under the daemon's home for the spec's branch and
  drives every session, gate and commit there; the operator's checkout is
  read for its `.git` and nothing else. A worktree shares repository
  administration and is not a security boundary; it is the organization
  the receipt needs (a stable revision, a single writer) and the smallest
  change that stops a driven session from editing the tree the operator
  is sitting in. Process containment is a later increment and is not
  claimed here.
- **D48 (the candidate holds no publish credential):** the child
  environment is scrubbed by a deny list the engine owns, starting with
  the two model keys and, once D50's broker publishes, the two GitHub
  tokens. What the list cannot reach (a keyring-backed `gh`) is recorded
  as a limit, not hidden.
- **D49 (acceptance is a receipt):** when the post-session gate passes on
  a candidate whose HEAD did not move and whose tree is clean across the
  run, the engine journals `acceptance.receipt`: repository origin, base
  sha, candidate sha, the gate suite and its digest, the policy digest
  (the folded gate contract and profile, canonically hashed), the
  spec-spine version that answered, every command's exit code, and the
  paths the candidate changed under the policy-sensitive set (the
  Makefile, the workflows, the kit, `spec-spine.toml`, `standards/`).
  The receipt's authority is the journal chain's; a receipt whose
  candidate sha is not the head of the branch being published is not a
  receipt for that publication.

## 6. The action boundary

- **D50 (the engine publishes, the session proposes):** the push and the
  pull request move from the driven session to the engine. The ship
  session gates, reviews and commits in the candidate and drops the PR
  title and body into a drop box, as 020 drops decisions; the engine
  validates the text with 017's marker rules, requires an
  `acceptance.receipt` for the candidate head, pushes, and opens the PR.
  Shepherd's merge consumes the same receipt beside the green checks and
  D43's head. Each effect is journaled as `broker.action` with the action,
  the target, the head and the receipt hash it consumed, before and after.
- **D51 (one run holds the lease):** an action is refused unless the run
  that requests it is the project's live run in the folded state; a
  resumed older process cannot publish over a newer one. Retries first
  reconcile (017 B-4's idempotent check, now for push and PR alike) and
  never repeat an effect that already happened.
- **D52 (the hosted plane is already a broker):** the umbrella's verbs
  reach the control plane with the posture and confirm guards 104 fixed,
  and login is not an MCP tool (105). Nothing here adds a permit format
  for the hosted side; that is the plane's contract to extend, and the
  tool repository consumes it when it exists.

## 7. The policy, the kit and the handoff

- **D53 (a repository's lifecycle is a typed record):** what a project
  will schedule (which statuses, whether a named draft may build), how it
  merges, which paths are policy-sensitive and where a human gate stands
  become a `LifecyclePolicy` on the projects chain beside the gate
  contract (041), probed from an optional `.statecraft/policy.json` at
  registration and settable by verb. Absent, the defaults are today's
  behavior. 012's readiness reads the policy's statuses instead of a
  constant.
- **D54 (the kit is generated with provenance and declared drops):** the
  Codex kit gains a manifest naming every generated file, its source and
  the source's hash, and every field the generator dropped; `--check`
  verifies the manifest and walks directories as well as files.
  Provider-specific tests remain the proof of which restrictions hold;
  shared text is consistency of guidance, not of enforcement.
- **D55 (a handoff is a capsule, not a transcript):** a typed capsule
  carries what a new session in any harness needs: repository and
  candidate revisions, the spec, the policy digest, the sealed decisions
  in scope, the outstanding gate diagnostics, the latest receipt, the
  remaining allowance and the prior sessions' driver, classification and
  denials. It is built from the journal, printed by a verb, and injected
  into every remediation prompt. Provider resume identifiers stay inside
  their driver.

## 8. Admitting a third provider

- **D56 (conformance is a suite, run against every driver):** one test
  file drives every discoverable driver through the same negative table:
  a denial retained beside a completed result, a required capability
  refused before spawn, a hang killed with its descendants, a malformed
  stream and an absent cost left explicit, a manifest whose tokens match
  its declared tier. A fixture driver ships for the suite so it runs
  without a real harness; the real drivers run it too. The engine bundle
  test extends its forbidden strings to the Codex ones.
- **D57 (qualification is recorded evidence):** a script drives one live
  turn of a named provider and writes a qualification record (binary
  version, OS, the capabilities observed applied) under
  `docs/evidence/qualification/`. A driver whose record is absent or
  whose binary version differs from the record is `unqualified`, shown in
  the posture cell and journaled in `session.init`; it still runs, so a
  new version is not a lockout, but the evidence says which runs it
  covers.

## 9. The spec plan

| Step | Spec | Lands |
|---|---|---|
| The floor, the head, the denial | 119 | D41, D42, D43 |
| The capability contract | 120 | D44, D45, D46 |
| The candidate and the receipt | 121 | D47, D48, D49 |
| The action boundary | 122 | D50, D51, D52 |
| The policy, the kit, the handoff | 123 | D53, D54, D55 |
| Provider conformance | 124 | D56, D57 |

Each spec is born approved on this document's authority, as 115 through
118 were on doc 03's: the corpus owner asked for the six increments to be
specified and then built to completion in one instruction, and the
decisions are recorded here rather than left to the sessions. All six
land as specs with 119's pull request; each is then built, shipped and
shepherded as its own pull request in the governed loop.

## 10. Where this stands (2026-09-09)

Recorded the day the sequence ran, as doc 02 §11 and doc 03 §8 were.

| Step | Spec | Landed as |
|---|---|---|
| The floor, the head, the denial | 119 | a read-only floor at a resolved base, `mergePr` with `sha=`, `denials` on the result read from the harness's structured event (and Codex's router line, D-6), doc 04 and all six specs (#28) |
| The capability contract | 120 | six tokens in the contract crate, `capabilities` on the manifest with the tier derived, `requirements` on the request and `require` on the profile, `driver.refused` before spawn, `applied` beside `degraded` in `session.init`; Claude does not claim `workspace-write` (#29) |
| The candidate and the receipt | 121 | a worktree per spec branch under the daemon's home, one deny list on both sides, `acceptance.receipt` over a stable pass with digests and sensitive paths, `acceptance.unstable` otherwise (#30) |
| The action boundary | 122 | the broker over lease and receipt, push and PR and merge journaled as intent and outcome, the ship session proposing into the drop box, the GitHub tokens denied (#31) |
| The policy, the kit, the handoff | 123 | `LifecyclePolicy` on the projects chain, named drafts, the policy's gates and merge method, `.codex/kit-manifest.json` with declared drops and a directory-walking check in the gate, the handoff capsule on a verb, a route and every remediation prompt (#32) |
| Provider conformance | 124 | the fixture driver, seven cases over three targets, the process-group kill the suite found missing, `binaryVersion` journaled, two live qualification records committed (#33) |

Three things the build changed about the design, each recorded as a
decision in its spec: the Claude driver does not claim `workspace-write`
(120 D-2, corrected in this document before 120 was built); ship and
shepherd mint their own receipt when a session moved the head (122 D-5),
and the proposal lands in the drop box rather than the candidate (122
D-6); and the deny list's names are the one provider-named thing the
engine carries (121 D-6). Two things the sequence found that no
assessment had named: a guarded Codex posture degrades `tool-allowlist`
even without an explicit list, because the baseline is a list (120 D-5);
and neither Rust driver reached a hung provider's descendants until 124
made the provider a process group leader (124 D-6).

What "governed" now means, concretely: a run's session works a candidate
worktree with no publish credential in its environment; the floor reads
before it writes and names the commit it compared against; a passing
gate over a candidate that held still is a receipt; the engine pushes,
opens and merges only on a receipt covering the head and a lease the run
holds, and journals every effect before and after; a refusal the harness
reported survives a completed turn; what a run requires is stated in
tokens a driver either supports or refuses before it spawns; a
project's lifecycle is a typed record; and a third provider is admitted
by a suite and a live record, not by resemblance. What remains is §11.

## 11. Not decided here

Process containment beyond the worktree (a sandboxed executor with a
brokered file service), a custom agent loop over model APIs, per-stage
driver routing, a permit format for the hosted plane, and the engine
port to Rust (doc 02 D30) remain open. The assessment's shutdown-test
failure did not reproduce on the machine this was written on (the
driver, session and standby suites pass); it is noted, not acted on.

## 12. Sources

The external assessment of 2026-09-09 and its evidence snapshot; this
repository at `b7baf2d`: `members/src/orchestrator/gate-contract.ts`,
`stages/build.ts`, `stages/ship.ts`, `stages/shepherd.ts`,
`stages/verify.ts`, `session.ts`, `driver.ts`, `profile.ts`,
`journal.ts`, `decisions.ts`, `export.ts`, `budget.ts`, `dag.ts`,
`projects.ts`, `api/server.ts`, `crates/statecraft-contract/src/lib.rs`,
`crates/statecraft-driver-core/src/{lib,session,classify}.rs`,
`crates/statecraft-driver-{claude,codex}/src/main.rs`,
`scripts/codex-kit.py`, `.claude/settings.json`, `Makefile`,
`.github/workflows/spec-spine.yml`, `src/{api,auth,mcp,members}.rs`;
the GitHub REST reference for merging a pull request (the `sha`
parameter); the Claude Code CLI reference for `--tools` and
`--allowedTools`.
