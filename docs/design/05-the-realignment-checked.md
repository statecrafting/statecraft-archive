# 05: The realignment, checked against the tree

The fifth design record. Doc 04 built the governed substrate (specs 119 to
125) and left five things open in its §11. On 2026-09-11 an external
realignment of the whole family arrived as three documents: a plan that
extends spec-spine into a compiler of authority snapshots, work scopes and
context closures; a register of 45 proposals (A01 to A10, B01 to B35), each
with a disposition; and a handoff packet addressed to this repository. The
packet asks this repository to finish local distribution and evidence, to
consume the records spec-spine is drafting, and to define its half of a
hosted connection.

This document checks each of the packet's claims against the tree at
`6f49d9a`, records what the check found that the packet did not, and turns
what survives into proposed decisions and draft specs. The method is doc
04's: one question per section, each decision numbered so a spec can cite
it, the evidence named. Decisions continue doc 04's numbering at D58.

**Status: proposed.** Unlike doc 04, nothing here is born approved. Every
decision below (D58 to D73, and D74 to D86 in §18) is a proposal until the
owner ratifies this document. §18 was added on 2026-09-12, after this
document merged as a record (#41); merging it approved nothing. The five specs it introduces (128 to 132) are born `draft`; the
two drafts it revises (126, 127) stay `draft`. The packet is evidence and a
recommendation. It amends no approved spec, and neither does this document.
Where the packet quotes an instruction from an earlier date (a September 10
baseline, a warning about uncommitted changes), that instruction is history,
checked below, and not a work order.

## 1. What the realignment asks of this repository

The realignment's ownership table gives this repository local policy
application, permit enforcement adapters, provider negotiation, candidates,
leases, event attribution, receipts, local explanations and the packaging
of an independent bundle verifier. It excludes two things explicitly:
claiming a protection a provider or the operating system cannot enforce, and
hosted tenant authority. Both exclusions are already this repository's
habits (120 D45's refusal of an unsupported required token; doc 04 D52's
"the hosted plane is already a broker"), so the realignment extends the
repository's direction rather than reversing it.

It names five records this repository would consume or produce. None exists
yet as an agreed contract:

| Record | Producer | State on 2026-09-11 |
|---|---|---|
| AuthoritySnapshot | spec-spine | spec-spine draft 087, uncommitted in that repository's working tree |
| WorkScope, ContextClosure | spec-spine | a design note in the same working tree, "proposed P1, not filed" |
| WorkPermit | a local operator or Statecraft | defined nowhere |
| ExecutionEvidence, AcceptanceReceipt | this repository | `acceptance.receipt` schema version 1 exists (121); nothing else |
| VerificationReport | a neutral verifier | defined nowhere; this repository's journal crate verifies bundles today |

So the consumption half of the realignment (scope, closure, permit) cannot
be specified to the field yet, and §8 records it as intent with the
constraints the packet fixed. The production half (receipts, fixtures, a
verifier, the explanation of a run) can, and §7 does.

## 2. The packet's findings, checked

Each claim read against the tree, the registry and a run of the suites it
cites.

| Packet claim | Verdict | Evidence |
|---|---|---|
| HEAD `6f49d9a`, registry and index fresh, tree clean | confirmed | `git status` clean; the session hook reports both fresh |
| 125 complete; 126 and 127 draft and pending | confirmed | `spec-spine registry list`: 71 specs, 68 approved (66 complete, 010 `n-a`, 000 with no implementation field), 100 superseded, 2 draft |
| Fence, receipt and broker suites: 26 tests, 133 assertions | confirmed | rerun: 26 pass, 0 fail, 133 `expect()`; the candidate, export, handoff, API server and static suites add 95 pass, 667 `expect()`. Fixtures and a local bare remote only; not live-provider or hosted evidence |
| The earlier baseline (`bf2f0fd`, 18 tests, uncommitted 109 edits) | superseded | 109 was ratified (#35) and kit 082 adopted (#38); nothing is uncommitted |
| Engine is Bun/TypeScript; Rust contracts, journal, sensors and both drivers exist; a full engine port is unresolved | confirmed | `crates/`; doc 02 D30; doc 04 §11 |
| The UI exposes standby, run, DAG, quota, economics, decisions and history | confirmed, with a gap | `members/web/src/views/`. No view shows a receipt, a broker action, a denial, a fence refusal, or a capability applied or degraded; the only verdict shown is the registry's project qualification (025) |
| Candidates, receipts, brokered publication, lifecycle policy, handoff capsules and capability negotiation exist | confirmed | 120 to 125 |
| The release packages only the umbrella | confirmed | `release.yml:71-82` builds and archives `statecraft` alone; `install.sh` mentions no member |
| Member CI builds members and the UI, but does not distribute them | confirmed | `members.yml:57-65`; 042 §6 and 108 §10 put installing and publishing members out of scope, for "a later spec" |
| UI asset lookup is source-relative | confirmed, and worse than stated | `static.ts:19-21` resolves from `import.meta.dir`. A compiled engine run outside the checkout answers `/` with 503 "The web UI has not been built", expecting assets at `/web/dist` (measured, §3 F4) |
| The daemon refuses a non-loopback bind because it has no auth layer | confirmed | `server.ts:93-105`; 022 "no auth in v1 (loopback trust)" |
| Login asks for a pasted browser session token | confirmed | `auth.rs:203-221`. Echo is left on deliberately (`auth.rs:198-201`, a recorded v1 deferral), so that part is a known limit, not a finding |
| Rahi supplies an audience-bound bearer contract | confirmed, with limits | rahi 025 is approved and complete: an RS256 access token whose `aud` must contain the resource URL, RFC 9728 discovery, a 15-minute maximum lifetime, a `jti` deny-list for revocation. It defines no refresh for a bearer client and no tenant binding, and the chassis implements no native flow itself (B-8 names rauthy's device grant) |
| A source receipt alone does not identify a deployed artifact | confirmed | `receipt.ts:63-74` binds a candidate sha. The release's SLSA provenance names the umbrella archive and is not linked to any receipt |

Two corrections to the packet's framing, both small. The packet says the
fence suite passed "today" with "fixture/local Git scope"; that remains the
whole of the evidence, and nothing in this document upgrades it. And it
lists 126 as proposing "a credential-focused deny-list"; that is accurate,
and 126 already says so in its own D-1 and §6. What 126 lacks is not honesty
about the deny-list but a stated threat model and the gate (§4, D61).

## 3. What the check found that the packet did not

- **F1. Any web page can drive the daemon.** The API checks neither `Origin`
  nor `Host`. `X-Api-Version` is optional (`server.ts:284-292`), and a body
  is parsed as JSON whatever its `Content-Type` (`server.ts:314-324`). A POST
  with a `text/plain` body and no custom header is a CORS "simple request",
  which a browser sends without a preflight; the page cannot read the answer,
  but the effect happens. Measured against a real server with the test
  fixtures: a POST to `/api/projects/alpha/disarm` carrying
  `Origin: https://attacker.example` and `Content-Type: text/plain` returned
  200 and journaled `project.disarmed`; a GET carrying a foreign `Host` (the
  DNS-rebinding shape) returned 200. Reachable this way: registering a path,
  arming, the execution profile, the gate contract, the lifecycle policy, the
  cost ceiling, `approve` and `force-human-gate`. Loopback binding keeps other
  machines out; it does not keep out a browser on the operator's own machine.
  Some browsers now gate public-to-local requests behind a permission, but
  that is a property of a browser, not of this server.
- **F2. The gate runs outside the fence.** `runGate` spawns each command with
  no `env` (`stages/build.ts:135-136, 296-303`), so the gate inherits the
  daemon's whole environment: the model keys, `GH_TOKEN`, `SSH_AUTH_SOCK`, the
  real `gh` on `PATH` and the operator's git credential helper. The gate runs
  the project's own commands (`make gate`, `cargo test`, `bun test`) in the
  candidate, and the candidate can edit every file those commands execute. So
  the fence (125) and the scrub (121 B-3) hold for the session and not for the
  code the session wrote. 125's claim is "the broker is the only path that
  works, so the journal is complete", and a test that pushes during the gate
  is an effect the journal never sees. 125 §6 lists three residuals; this is a
  fourth it does not list, and draft 126 as it stood at `6f49d9a` (B-7: "the
  sandbox wraps the member the driver spawns and nothing else") would have
  left it open as well; D61 revises that. spec-spine's request R7 names the
  same boundary from the other side.
- **F3. A credential in the remote URL is journaled and exported.**
  `originUrl` returns `git remote get-url origin` verbatim
  (`candidate.ts:143-146`). With an origin of the common CI shape
  `https://x-access-token:<token>@github.com/...`, a minted receipt carries the
  token in `repo.origin`, and the export policy passes it (measured:
  `withheldFields: []`), because `origin` is not a stripped field and the
  value is not a path. The API serves the same string as a project's
  `origin`, and the handoff capsule carries it into every remediation prompt
  (`stages/build.ts:1122-1126`, `handoff.ts:172`), which sends it to the model
  provider. A journal is hash-chained, so a token that reached one cannot be
  removed without breaking it.
- **F4. A packaged engine is not a working engine.** Built with
  `bun run build:member:engine` and run from a directory outside the checkout:
  `daemon run` serves the API, but `/` answers 503 with assets expected at
  `/web/dist`, and `daemon start` fails. Its re-spawn passes
  `join(PROJECT_DIR, "src/index.ts")` to `process.execPath`
  (`commands/orchestrator.ts:296-298`), which a compiled binary reads as an
  unknown command, so the child prints usage, the lock is never acquired, and
  the start exits 1 after 15 s. The default data directory has the same
  source-relative shape (`paths.ts:11-12`), as do the sensor's `daemon start`
  and its launchd plist (`commands/daemon.ts:38, 70-71`). 042 D-10 recorded the
  cause and deferred the fix to "the spec that makes a member binary the
  primary way its verbs are reached". No such spec exists.
- **F5. No original-bytes receipt exists to hand anyone.** The one committed
  bundle (`docs/evidence/journal-bundle.json`) is export policy version 1,
  predates 039's attestation block, and contains no `acceptance.receipt` and
  no `broker.action`. And what bundle verification establishes is internal
  consistency: `verifyBundle` checks each chain from the `anchorHash` the
  bundle declares for itself (`export.ts:625-674`), and `journal verify
  --bundle` reports `verified: true` (`commands/orchestrator.ts:1844`). A
  chain fabricated end to end, with a fresh anchor, verifies. That is correct
  for what the code claims, and it is exactly the "self-selected root" the
  packet warns a verifier against trusting. Separately, `parseReceipt`
  (`receipt.ts:136-179`) accepts a payload with `passing: true` beside a
  non-zero exit code and never recomputes the suite or policy digest; a
  minted receipt cannot have either defect, and a forged one can.
- **F6. The review note cannot be posted from a governed session.** Draft 127
  has the session post a pull request comment through the GitHub API. In a
  driven run that session is fenced (125): `gh` refuses and git has no
  credential. 127 B-5 makes a failed post non-fatal, so in every driven run the
  note would silently never appear, and if it did appear through some other
  credential it would be an effect with no receipt and no journal record,
  which is what 122 and 125 exist to prevent.
- **Two of spec-spine's requests describe this tree accurately, and a third
  only half does.** R1: the export and the adoption holdback match
  `attestationHash:` in prose (`export.ts:248`, `adopt/holdback.ts:325`). R5:
  `spec-spine.toml` pins `required_version = "0.18.0"` as a caret range and
  both workflows install from `main`'s `install.sh` unpinned. R6: the engine's
  floor (`gate-contract.ts:121-125`) does omit `--fail-on-unresolved`, but the
  request's premise that this repository's own floor carries it is wrong: the
  Makefile's gate omits it too, deliberately (spec 050's opt-in; the comment
  above `gate:` says to add it once every approved spec is implemented).

## 4. Local protections

- **D58 (proposed; the daemon answers only its own origin).** Before any
  route runs, the server refuses a request whose `Host` is not one of the
  loopback names at the bound port, and a request that carries an `Origin`
  other than the daemon's own. A state-changing request must also carry a
  header a cross-origin page cannot send without a preflight
  (`X-Api-Version`, which both first-party clients already send), and the
  server never answers a preflight with permission. A request with no
  `Origin` (the CLI's client, `curl`) is admitted as before; loopback remains
  the trust boundary for local processes, and nothing here is an auth layer
  or a reason to bind anywhere else. Spec 128.
- **D59 (proposed; a credential never leaves through the API, a receipt or an
  export).** The origin URL is reduced to scheme, host and path before it is
  journaled or served: userinfo in an `http` or `https` URL is dropped whole,
  because a token can sit in the user field as well as the password. The
  export policy treats a URL with userinfo as a value to strip, so a record
  minted before the fix exports as redacted rather than leaking, and its bytes
  in the journal are never rewritten. Spec 128.
- **D60 (proposed; the gate runs behind the fence).** Gate and bracket
  commands spawn with the same scrubbed, fenced environment the session
  receives, from the fence of the candidate they run in. A gate-time refusal
  is tallied apart from the session's, so a reader can tell the session
  reaching for `gh` from a test doing it. The broker, which publishes, keeps
  the daemon's environment (125 B-6). The verify stage, which runs a merged
  spec's declared acceptance after publication, is left as it is and recorded
  as a residual, because some declared acceptance is live by design. Spec 129,
  small enough to land before 126.
- **D61 (proposed; 126 is a credential deny-list and says so).** Draft 126
  gains an explicit threat model: a capable session, not a hostile one, and an
  integrity property (a complete journal), not confinement of source authority.
  Three corrections follow. Its `required` policy guarantees that the named
  deny set is in force, not that "containment is in force", and the text says
  exactly that. Its blast radius includes the gate (after 129, the gate is
  fenced; 126 adds the profile to the same spawn), because the gate executes
  candidate-authored code. And it claims no capability token: a read and
  exec deny-list confines no writes, so it neither lets the Claude driver
  claim `workspace-write` nor stands in for any future WorkScope enforcement.
  `sandboxMode` names the deny set it applied by digest, so "declared" and
  "enforced" are two fields, not one inference.

## 5. The review note

- **D62 (proposed; the session proposes a note, a publisher posts it).** The
  note keeps 127's one-marked-comment shape and its honesty rules, and changes
  who posts. In a driven run the ship session adds the review's findings and
  dispositions, as a `review` field, to the proposal it already writes to the
  drop box (122 D-6), and the broker posts the note as a fourth action,
  `note`, admitted on the same receipt and lease as `openPr` and journaled as
  intent and outcome with the body's digest. In an interactive session the
  operator's own credentials post it, as the first draft said. Either way the
  note has two sections that never mix: **machine results**, copied from the
  receipt the publication consumed and labelled `receipted` (or, where no
  receipt exists, labelled `reported by the session`), and **review
  findings**, the model's own account, labelled as narrative. It names the
  head sha and the receipt hash; a note whose head is not the pull request's
  head says it is stale.

## 6. Distribution

- **D63 (proposed; a complete install is one release).** A tag builds, beside
  the umbrella's five archives, a member archive per supported triple
  (macOS and Linux, both architectures) holding the engine, the native sensor
  and driver members, the built web assets, the provider qualification
  records, and a `members.json` manifest that names every file with its
  SHA-256, its member-contract version and the release tag. The archive carries the same checksum sidecar, SBOM and SLSA
  provenance as the umbrella's (107). `install.sh` installs it into the
  managed member directory (108 §4) when asked, verifies every digest before
  anything is moved into place, and replaces the previous set atomically.
  `statecraft members doctor` reports each expected member as present, missing,
  refused, digest-mismatched or shadowed, and each provider prerequisite (the `claude`
  and `codex` binaries, `spec-spine` at the required floor, `git`, `gh` for
  the broker) as found or absent, with its version and qualification record.
  Nothing installs a provider or signs in to one. Spec 130.
- **D64 (proposed; a packaged member finds its files at run time).** 042
  D-10's successor. The engine stops resolving locations from
  `import.meta.dir`. Its web assets and qualification records resolve from an
  explicit flag or variable first, then the directory beside the installed
  binary, then the checkout for the source path; a packaged engine's default
  daemon home sits under the platform data directory 108 §4 already uses,
  while the source checkout keeps its own so no operator's registry moves.
  `daemon start` re-spawns `process.execPath` with the verb arguments when
  compiled. Acceptance is a clean machine: a CI job that
  never checks the repository out installs from the release artifacts, starts
  the daemon, loads the UI and registers a repository. Spec 130.

## 7. Evidence

- **D65 (proposed; one view explains a change).** A read-only view, reached by
  a verb, a route and a UI panel, joins the records a run already writes into
  one account per spec: the spec's lifecycle, the candidate and its base,
  every round's gate commands and exit codes, the receipt with its suite and
  policy digests, `acceptance.unstable` and `acceptance.sensitive`, denials,
  fence refusals, the driver's capabilities applied, degraded and refused, the
  provider's qualification, approvals and forced gates, the broker's intents,
  outcomes and refusals, the merge sha and verify's result. Each value is
  labelled with its source record, and four labels are first-class: `none`
  (the run recorded that nothing happened), `not recorded` (no record of this
  kind exists for the run, including every field a future contract will add:
  scope, closure, permit), `stale` (a receipt whose candidate is no longer
  the branch head), and `unknown` (a fact no record can establish: provider
  tool-event coverage is shown this way, because neither driver proves it saw
  every call). A "declared versus enforced" section sets the profile's
  posture and required tokens beside what `session.init` says was applied,
  and a model's narrative is labelled apart from what a machine observed.
  Spec 131.
- **D66 (proposed; compatibility is original bytes plus a verdict manifest).**
  A fixture directory holds bytes minted by the real code paths: a journal and
  its export at policy version 5 containing `acceptance.receipt` version 1,
  `broker.action` intent and outcome, `broker.refused` and `fence.refused`,
  with and without an attestation; the committed policy-1 bundle stays as the
  oldest fixture. Beside them, the negative set: truncation, a tampered
  payload, a broken link, a reordered sequence, a withheld record that carries
  a payload, an unknown format, an unsupported version, malformed JSON, an
  attestation mismatch, a forged receipt (`passing: true` beside a red exit
  code, or a digest that does not recompute), a broker action naming a receipt
  the chain does not hold, and a re-anchored chain that is internally perfect.
  A manifest states each fixture's expected outcome per dimension, and both
  existing verifiers (the TypeScript `verifyBundle` and the Rust journal
  crate's `verify_bundle`) run it. JSON Schemas describe version 1 exactly as
  the code parses it. This is what Statecraft and hqgit receive, before either
  writes a parser. Spec 132.
- **D67 (proposed; a verification report has four outcomes).** Integrity (do
  the bytes and links recompute), subject binding (does the receipt name the
  revision and repository asked about), issuer trust (was it produced by a key
  or an anchor the reader trusts, given out of band), and policy (does it meet
  the reader's rules). Each is `pass`, `fail`, `unknown` or `not-applicable`,
  never folded into one boolean. A verifier never executes anything a bundle
  carries, and never accepts the bundle's own anchor as its trust root. Today
  every bundle's issuer trust is `unknown`, because nothing is signed; saying
  so is the point. Where the neutral verifier is packaged is an open decision
  (§16): the Apache-2.0 `statecraft-journal` crate already parses and verifies
  bundles and is the obvious seed, and no AGPL code may enter it.
- **D68 (proposed; receipt version 2 is additive).** A later receipt revision
  adds, without changing version 1's bytes or meaning: the merge base `couple`
  diffed from; per gate command, the verdict envelope's schema version and the
  SHA-256 of its bytes (spec-spine R2); an `authority` block that holds the
  corpus attestation hash and the spec's attestation until spec-spine 087
  provides a snapshot hash to replace them; and an `execution` block naming
  the driver, its binary version and qualification, the capabilities applied
  and degraded, the fence and sandbox modes, and the denial and refusal counts
  (these exist today in separate records). A reader of version 1 keeps reading
  version 1. Not specified until spec-spine's snapshot shape is approved.

## 8. Scope, context and permits: the consumer side

Intent and constraints, not specifications. Each waits on a record another
repository has not yet agreed.

- **D69 (proposed; what reached the provider is recorded).** Every session
  records what was actually submitted to it: the digest of the prompt, the
  capsule it carried (123 D55) by digest, the spec text by digest, and, once
  spec-spine files ContextClosure, the closure it was built from, with each
  required item marked included, omitted or truncated. Anything retrieved
  beyond the closure is listed separately as optional. A truncated or omitted
  required item invalidates any completeness claim and is shown, not hidden.
  What the provider retained, and whether it read it, is `unknown`.
- **D70 (proposed; a permit is enforced by the executor, not the prompt).**
  When a WorkPermit exists, the engine maps each protection it requires onto
  what can actually enforce it: a capability token (120), the fence (125), the
  sandbox profile (126), the gate fence (129). A required protection with no
  enforcer refuses before spawn, as 120 D45 already does for tokens. A scope
  that names symbols is checked after the change (the coupling verdict, or
  spec-spine 088's delta), because an OS rule fences a file and not a symbol.
  Mutable reservations stay in the engine and extend the existing lease (122
  D51); conflict sets come from spec-spine. Compiling a scope is not issuing a
  permit: the actor, run, audience, validity and fencing come from the local
  operator or from Statecraft.

## 9. The hosted seam: the client half

- **D71 (proposed; this repository states constraints, not the protocol).**
  Runner enrollment, the outbound connection, jobs, cancellation and fencing,
  evidence upload and hosted action authorization are Statecraft's to lead,
  and Statecraft's corpus defines none of them yet. This repository commits to
  what its side needs and to the negative cases a first wire contract must
  carry before either end is built (§14). It will not draft both ends.
- **D72 (proposed; login moves to an authorization flow, once agreed).** The
  token paste gives way to rauthy's device authorization grant (or, where a
  browser is at hand, authorization code with PKCE on a loopback redirect),
  requesting the plane's resource URL as audience and the scopes the plane
  advertises. A credential is stored per plane, issuer and audience, not per
  base URL alone, with its expiry; an expired token is renewed where the flow
  allows and otherwise prompts a fresh login, never retried blindly. A
  revoked token (the plane's 401) is discarded. This waits on Statecraft
  choosing its client registration and on rahi 025's silence about renewal
  being resolved.

## 10. The journey

- **D73 (proposed; one path from a repository to verifiable publication).**
  Install (130), register an existing repository, approve or name a spec,
  watch the run, open the explanation (131), export and verify (132), with no
  account. The engine's verbs flatten from `statecraft engine orchestrator
  <verb>` once a packaged member is the primary way they are reached, which is
  042 D-7's condition, and every old path stays as an alias for at least one
  minor release. Two supervisions stay two concepts in every name and screen:
  this repository supervises agents working a repository; a Rahi-hosted plane
  may supervise running applications. A command or view never mixes them.

## 11. Replay and shadow policy

Register B27 and B28 are later work (the register's P4). One constraint is
worth fixing now, because 132's frozen fixtures will be replay's first
inputs: a replay evaluates recorded inputs under a named policy and verifier
version, reports a missing fact as `unknown`, and never re-runs an effect or
guesses what another provider would have written. A shadow policy's verdicts
are recorded apart from enforcement and can authorize nothing.

## 12. Declared versus enforced, today

What a reader of this repository's evidence can rely on at `6f49d9a`.

| Protection | Declared where | Enforced by | Holds against |
|---|---|---|---|
| Publication only through the broker | 122, 125 | fence shims, git config, deny list | a capable session; not the gate (F2), not an absolute path, `HOME` reads or `~/.ssh` (125 §6) |
| Required capability tokens | 120 D45 | refusal before spawn | an unsupporting driver |
| Writes confined to the candidate | the `workspace-write` token | Codex's `--sandbox workspace-write`, under `guarded` only (`bypass` disables it); Claude does not claim the token | nothing, under Claude or a `bypass` posture |
| Candidate isolation | 121 D47 | a git worktree | accidental edits to the operator's checkout; it is not a security boundary |
| Acceptance | 121 D49 | a stable, passing gate over one revision | a moving head or dirty tree; not a candidate that edits its own gate (recorded as `acceptance.sensitive`, not refused) |
| Merge of the checked head | 119 D43 | GitHub's `sha` parameter | a push between check and merge |
| Control API reachable only locally | 022 | loopback bind | other machines; not a web page (F1) |
| Bundle integrity | 031, 039 | link and payload recomputation | edits to a bundle; not a fabricated bundle (F5) |
| Provider tool-event coverage | none | none | unknown |

## 13. Responses to spec-spine's requests

spec-spine's working tree carries seven requests to this repository (its
design note 04 §7). They are proposals from a draft; each is answered here so
that its authors can plan around the answer.

| Request | Response |
|---|---|
| R1: parse `attest --json`, not prose | accepted; a small change to 031/039's export and 036's holdback. Waits on spec-spine confirming the `--json` report shape it wants consumed |
| R2: receipt carries spec-spine envelopes, an authority block, the merge base | accepted as D68, after spec-spine 087 is approved |
| R3: read acceptance from `verify --plan --json` at the base revision | accepted in principle; the verify stage's browser path (019) keeps working because spec-spine reports `verify:browser` blocks as skipped. A later spec |
| R4: hash stored attestation bytes, refuse unknown members | the first half holds today (`export.ts:284`); the member check joins R1's change |
| R5: pin the spec-spine installer | accepted; a harness change under 109 when a spec-spine release carries 083 |
| R6: `--fail-on-unresolved` on the floor | deferred to the owner: it changes what every governed project must satisfy, and this repository's own Makefile omits it by spec 050's design, so the request's comparison does not hold (§3). Distinguishing exit codes 1, 2 and 3 in evidence is accepted with D68 |
| R7: acceptance only behind the fence | accepted for the build gate as D60 (spec 129); the verify stage stays a recorded residual |

## 14. Requests to other repositories

Proposals for each repository's own governance; none changes its contract
from here.

**Statecraft.** (1) Lead the first runner and evidence wire contract, and
include before either end is built these negative cases: a token for the
wrong audience, a token for another tenant, the same evidence uploaded twice,
a job whose lease has expired or been superseded (stale fencing token), a
runner reconnecting mid-job, a candidate sha that does not match the job's,
a receipt for a revision the job did not name, and an upload whose bundle
verifies but whose issuer is not trusted. (2) Say which client registration a
native CLI uses (a public client with device grant, or dynamic registration)
and what it may request as scopes. (3) State that the plane never executes a
spec's declared verification (spec-spine's S1). (4) Consume 132's fixtures
and schemas as the definition of receipt version 1 and bundle version 1.

**spec-spine.** (1) Commit and review drafts 085 to 088 and the design note;
this document cites them as uncommitted. (2) Name the JSON report fields a
consumer should read from `attest --json` (R1). (3) When ContextClosure is
filed, include the `omitted` and `truncated` states D69 needs.

**hqgit.** Reference receipts and bundles by the digests 132 defines rather
than defining a second receipt format; review D67's four outcomes against its
own verifier (hqgit 034, 064). hqgit is AGPL-3.0: this repository will not
depend on its code, and the neutral verifier stays Apache-2.0.

**Rahi.** Say whether rahi 025's 15-minute access token is renewed for a
bearer client, and how, since a CLI session outlives one token. Review D72
before Statecraft adopts it.

## 15. The spec plan

| Step | Spec | Lands | Depends on |
|---|---|---|---|
| The origin guard and credential hygiene | 128 | D58, D59 | 022, 027, 031, 121 |
| The gate fence | 129 | D60 | 016, 121, 125 |
| The sandboxed executor, revised | 126 | D61 | 121, 122, 125, 129 |
| The review note, revised | 127 | D62 | 017, 018, 109, 122 |
| Distribution | 130 | D63, D64 | 024, 042, 107, 108, 124 |
| The evidence view | 131 | D65 | 027, 120 to 122, 124, 125, 129 |
| Compatibility fixtures | 132 | D66, D67 (fixtures and manifest only) | 031, 039, 113, 121, 122, 125 |
| Receipt version 2 | later | D68 | spec-spine 087 |
| The context submission record | later | D69 | spec-spine ContextClosure |
| Permit enforcement | later | D70 | a permit format |
| The hosted client and login | later | D71, D72 | Statecraft's wire contract, rahi's renewal answer |

The recommended order is 128, 129, then 132 and 130 in either order, then
131 (which reads more once 129's tallies exist), then 126 and 127. 128 and 129
are small, verified and security-relevant; either can be approved on its own.

What the register's proposals assigned to this repository come to here:

| Register | Where it lands | State |
|---|---|---|
| B01 WorkPermits | D70 | waits on a permit format; compiling a scope is not issuing one |
| B02 OS enforcement | 126 (revised), 129 | drafts; a credential deny-list, not source-authority confinement |
| B03 Leases | D70, 122 D51 | the run lease exists; reservations extend it once conflict sets exist |
| B04, B05 Context closure | D69 | waits on spec-spine ContextClosure; omission and truncation are first-class |
| B06 Spec-addressable events | 131 | draft; every value names its record; attribution the records lack is `not recorded` |
| B07 Flight recorder | 131 | draft; narrative apart from machine outcomes; no invented complete trace |
| B17 Waiver half-life | none here | the waiver is a human instrument in a PR body (109) and no session writes one; a scoped, expiring waiver whose use is consumed atomically belongs to a broker or the plane, not an authored counter |
| B18 Constraint budgets | 033, unchanged | spend is a known-cost floor with unknown sessions counted beside it (033 B-5); a hard budget would need a reservation before a turn, which nothing proposes yet |
| B27 Replay, B28 Shadow policy | §11 | later; constraints fixed |
| B32 Audit bundles | 132 | draft; original bytes, explicit coverage, an input cap, no execution |
| B33 Proof protocol | §14, D67 | Statecraft leads the envelope; this repository supplies receipt and bundle version 1 |
| B34 Verifiers first | 132, D67 | draft fixtures and manifest; the package home is open (§16) |
| B35 Policy compiler, not runtime | D70, 132 B-4 | pure checks of explicit inputs; keys, clocks, leases and approvals stay in the engine or the plane |

## 16. Not decided here

- The neutral verifier's home: extend `statecraft-journal`, add a sibling
  crate in this workspace, or a separate repository. The realignment calls
  this workspace a proposed initial home, not a settled one.
- Which member builds ship: the Rust sensor and drivers (112, 114, 115, 116)
  or the TypeScript builds of the same names, which no spec has retired. 130
  D-1 recommends the Rust builds; approving 130 confirms or changes it.
- Whether web assets ship beside the engine (130 D-2's recommendation) or
  embedded in it.
- The first issuer and trust model for a signed receipt, and whether the
  daemon holds a signing key at all (126's brokered signing is a candidate).
- `--fail-on-unresolved` on every governed project's floor (R6).
- Whether a failure to post the review note in a driven run is a stage
  failure (127 says no; D62 keeps that).
- Doc 04 §11's remaining items: a custom agent loop, per-stage driver routing,
  and the engine port (doc 02 D30).

## 17. Sources

The handoff packet `04-statecraft-cli.md` and its index, the realignment plan
and the feature disposition register, all dated 2026-09-11. This repository
at `6f49d9a`: `members/src/orchestrator/{api/server.ts, api/static.ts,
api/types.ts, stages/build.ts, candidate.ts, receipt.ts, export.ts, broker.ts,
gate-contract.ts, adopt/holdback.ts}`, `members/src/{paths.ts,
commands/orchestrator.ts, commands/daemon.ts}`, `members/web/src/`,
`src/{auth,members}.rs`, `.github/workflows/{release,members,spec-spine}.yml`,
`install.sh`, `spec-spine.toml`, `docs/evidence/journal-bundle.json`, and
specs 022, 024, 042, 107, 108, 112, 114, 121, 122, 125, 126, 127. The
measurements in §3 were taken on this machine (macOS, Bun 1.3.11) with
throwaway probes against the test fixtures and a compiled engine in a scratch
directory; nothing touched a real remote or the operator's running daemon.
spec-spine's working tree at `75181a5` plus uncommitted drafts 085 to 088,
`docs/design/04-authority-evidence-extension.md` and
`docs/authority-evidence.md`. rahi specs 021, 022 and 025 at their approved
text. The statecraft and hqgit corpora, searched for runner, job, evidence,
receipt, permit and verifier contracts.

## 18. Revision 3: checked again after the drafts merged

On 2026-09-12 a third revision of the handoff packet arrived. It records #41
as merged, keeps 128 to 132 as proposals, and asks for five things before any
of them is built: 128's negative cases including historical redaction and
client compatibility; an explicit disposition of every repository-controlled
execution path for 129, including the verify stage, and a rule for a refusal
the gate swallows; a verdict contract for 132 agreed with Statecraft and
hqgit; an explicit choice of shipped members and a clean-machine proof for
130; and the hosted seam agreed before either end is coded. The packet is
planning input, not approval, and this section treats it that way: nothing
below is implemented, and 126 to 132 stay `draft` and `pending`.

Everything in this section was measured or read at `874766b` (main after
#41), with Bun 1.3.11, git 2.50.1 and spec-spine 0.18.0 on macOS. Probes were
throwaway scripts outside the repository, against the API test fixtures,
temporary repositories, local bare remotes and fabricated tokens; nothing
touched a real remote, a provider or the operator's running daemon.

### 18.1 The earlier findings, re-measured

| Finding | At `874766b` |
|---|---|
| F1, any page drives the daemon | reproduces. Over real HTTP: a `text/plain` POST with `Origin: https://attacker.example` disarmed a project (200, one registry record); so did `Origin: null` and `Origin: http://localhost:5173`; a GET with `Host: rebind.attacker.example` returned the project list, including every `repoDir`; `OPTIONS` answers 405 and no response carries `Access-Control-Allow-*` |
| F2, the gate runs outside the fence | reproduces. The production `runGate` over a real candidate saw a fabricated `GH_TOKEN` and `ANTHROPIC_API_KEY` from the daemon's environment and resolved `gh` to `/opt/homebrew/bin/gh`; the refusal tally read 0 |
| F3, a credential in the remote URL | reproduces. `originUrl` returned all five remote shapes verbatim; a receipt minted over a token-bearing origin exported at policy 5 with `withheldFields: []`, the token present in the serialized bundle, and the bundle verified |
| F4, a packaged engine is not a working engine | reproduces. Compiled and run outside the checkout: `GET /` 503 "The web UI has not been built", `/api/meta` ok, `daemon stop` stops it; `daemon start` exits 1 after 15 s with the child printing the sensor's usage |
| F5, no original-bytes receipt | reproduces. A hand-written receipt with `passing: true` beside exit code 1 and a zero suite digest is accepted by `parseReceipt`; its self-anchored bundle verifies under both verifiers (exit 0); a one-byte payload edit fails under both (exit 1) |

The suites behind these findings still pass, which is the point of the
findings: 976 Bun tests across 60 files (11,057 `expect()` calls), 198 Rust
tests with none ignored, `bun run typecheck` and `make gate` all exit 0.
Green gates did not and do not establish any property F1 to F5 names.

### 18.2 What the second check found

- **F7. Repository-controlled code outside `runGate` runs with the daemon's
  environment.** The verify stage runs each declared acceptance line as
  `sh -c` with no `env` (`stages/verify.ts:254`, reached from `:670`); a probe
  of its production runner saw the fabricated `GH_TOKEN` and the real `gh`.
  The engine's own git runs through the same unscrubbed helper, and git runs
  hooks: with a tracked hooks directory (husky's shape, `core.hooksPath`), the
  engine's commit in the candidate (`build.ts:284`) ran the candidate's
  `pre-commit` with the daemon's `GH_TOKEN`, and the broker's production push
  (`broker.ts:118`) ran the candidate's `pre-push` with it, then pushed
  successfully. A pre-push hook is candidate-authored code sitting beside the
  one credential the broker exists to hold. Worktree creation
  (`candidate.ts:117,120`, `verify.ts:233`), fetches (`build.ts:155`,
  `verify.ts:227`) and the in-place scheduler's `pull --ff-only`
  (`daemon.ts:426-428`) take the same path. The full inventory is §18.3.
- **F8. A refusal is recorded, not enforced, and the record is the child's to
  erase.** Under 129's proposed environment, `gh pr create --fill` exits 127
  and tallies 1, but `sh -c 'gh pr create --fill || true'` exits 0 with the
  tally still 1, so draft 129's B-4 ("a refusal in the gate is a red gate") is
  false for any gate that swallows an exit code. `gh --version` inside an
  availability check is refused and tallied the same way, because the shim
  never reads its arguments. And a child that truncates
  `$(dirname "$(command -v gh)")/../refusals.log` after being refused exits 0
  with a tally of 0. The log is a plain file beside the candidate, owned by
  the same user.
- **F9. A second copy of `originUrl` puts the token in the daemon's registry.**
  The project probe has its own `originUrl` (`projects.ts:716-720`), and its
  verdict carries `origin is <url>` as a check detail (`projects.ts:785-790`)
  into `project.registered` and `project.requalified`. Measured: the token is
  in the projects chain's bytes. That chain is never exported, but the API
  serves the detail (`api/state.ts:492`) and the standby panel renders it.
  Draft 128 fixes only `candidate.ts`.
- **F10. Draft 128 as written refuses the Vite dev UI.** `web:dev` proxies
  `/api` to the daemon with `changeOrigin: false` (`web/vite.config.ts:30-34`),
  so every proxied request carries `Host: localhost:5173` and every POST
  carries `Origin: http://localhost:5173`; B-1 would refuse all of it, SSE
  included. Read from the config and Vite 8.2.0's proxy source, not run.
  The other legitimate clients survive the guard as drafted: the daemon's own
  page and the engine CLI use the typed client, which sends `X-Api-Version`
  on every request; the event stream and the evidence links are GETs; nothing
  in the umbrella or the Rust crates speaks HTTP to the daemon; and the daemon
  is the only listener in `members/`. The API tests hold 37 raw non-GET
  requests (36 in `server.test.ts`, one in `static.test.ts`), most without the
  header; those would read 403.
- **F11. Three more source-relative defaults in a packaged engine.** With no
  `--repo`, a compiled `daemon run` registers `/$bunfs` (the bundle's virtual
  root) as its first project, unqualified (measured; `orchestrator.ts:321`).
  The code-staleness freeze reads the engine's own git head from
  `import.meta.dir` (`orchestrator.ts:2814-2817`), which compiled is `/`, so
  the freeze is silently off (read). `--url` accepts port 0, but `daemon
  start` then waits on the literal `:0` URL (`orchestrator.ts:2590-2591`)
  (read). Separately: drivers resolve explicit variable, then the managed
  member directory, then `PATH`, then the source entry (`driver.ts:212-233`),
  so installing a member set changes which driver even a source-checkout
  engine runs; there is no TypeScript Codex driver; and the engine never
  invokes a sensor. The umbrella's `members list` already discovers a
  compiled engine placed in a managed directory (measured); `members doctor`
  does not exist.
- **F12. The two verifiers agree on exit codes and disagree on shape.** On
  the committed bundle, the TypeScript `journal verify --bundle --json`
  answers `data.verified: true` with `data.chains` as an array; the Rust
  `statecraft-journal verify-bundle --json` answers `data.chains.ok` as the
  *string* `"true"` with the chains nested one level deeper and no `verified`
  member. Both answer the same for the forged, self-anchored bundle and the
  tampered one. A manifest runner that compared envelopes would report a
  difference that is not a verdict difference, and a consumer that parsed
  either would be parsing an unversioned shape.
- **F13. Draft 128's FR-006 names the wrong field.** The export scan removes
  the leaf key holding a flagged value (`export.ts:159-186`); a private path
  in `repo.origin` was measured as `withheldFields: ["origin"]`, not `repo`.

### 18.3 Local protections, revised

- **D74 (proposed; every path that runs repository-controlled code has a
  named disposition).** Draft 129 carries this table as its B-11; it replaces
  D60's "the verify stage is left as it is".

  | Path | Today | Proposed | Where |
  |---|---|---|---|
  | Gate suite, every round: build preflight and rounds, ship round 3, shepherd round 4 (`build.ts:390`, `ship.ts:845`, `shepherd.ts:638`) | daemon env | the session's fenced env (D60) | 129 B-1 |
  | Bracket `spec-spine compile` and `index`, `spec-spine --version` | daemon env | fenced, through `runGate` | 129 B-1 |
  | Engine git in the candidate: `worktree add`, `add`, `commit`, `status`, `checkout` (hooks, filters) | daemon env | fenced env; hooks still run, without credentials | 129 B-6 |
  | Credentialed git: `fetch`, `pull --ff-only`, the broker's `ls-remote` and `push` | daemon env, repository hooks run | daemon env with `-c core.hooksPath=/dev/null` (measured to skip a tracked pre-push hook) | 129 B-7 |
  | Verify stage acceptance lines (`verify.ts:254`) | daemon env, block read from the merged head | a verify fence; the block read from the run's base revision; an operator allowance for live acceptance | 129 B-8, B-9 |
  | Verify stage browser sessions (`verify.ts:472`) | scrubbed, no fence, operator checkout | fenced, in the verify worktree | 129 B-10 |
  | Driven sessions: build, ship, shepherd remediation | fenced (125) | unchanged | 125 |
  | Broker's `gh` client, the project probe's `spec-spine compile`, `dag.ts` registry reads, member version probes | daemon env; read repository content, run none of it | unchanged, recorded | 129 B-11 |
  | Operator-invoked CLI verbs: `adopt synthesize` (its session is scrubbed, not fenced), `journal export`'s attest, `statecraft template upgrade` codemods | the operator's own shell | out of 129's scope: the operator ran them; `adopt synthesize`'s session is a named follow-up | 129 §6 |
  | Writes to the shared `.git/config` or `.git/hooks` by an unconfined session | possible under `bypass` | out of scope; confinement of writes is 126's | 126 |

- **D75 (proposed; a refusal fails acceptance, whatever the exit code).** A
  gate round whose refusal tally rose is not accepted: no receipt is minted,
  the build evidence records the refusals and the reason
  `gate-fence-refused`, and the remediation prompt names the tool refused. The
  exit code cannot be the rule, because F8 measured a gate that swallows the
  shim's exit. The cost is real: a project whose tests probe for `gh` by
  running it fails acceptance under the fence and must change the probe. The
  alternative, recording the refusal and accepting the round, leaves a
  receipt beside an attempted credentialed effect; it is recorded in 129 D-5
  for the owner to choose.
- **D76 (proposed; the fence is credential protection, not hostile-code
  isolation).** 129 and 125 say this in one sentence each and mean it: the
  fence removes credentials from the gate's reach so the obvious move fails
  and the broker stays the only working publisher. It does not confine a
  process that means to escape: an absolute path skips the shims (measured:
  `/opt/homebrew/bin/gh --version` answers under the fence), `HOME` stays
  readable, and the refusal log can be truncated by the process it records
  (F8). A tally of zero is therefore evidence that a capable process did not
  reach for a fenced tool through `PATH`, and nothing stronger; 131 labels
  it that way.
- **D77 (proposed; acceptance is read at the base and run behind a fence).**
  The verify stage reads the `## Verification` block from the spec as it
  stood at the run's base revision (the receipt's `baseSha`), so a session
  cannot weaken the acceptance it will be judged by; where the merged head's
  block differs, it journals `acceptance.changed` with both digests and runs
  the base's. Each line runs in the verify worktree with a fence built beside
  it. Acceptance that is live by design (a qualification round, a real plane)
  needs an operator allowance: a per-project setting journaled like the gate
  contract, default `fenced`, whose `inherit` value is shown on the project
  and recorded on every verify evidence as `fence: { applied: false, reason:
  "operator-allowed" }`. The allowance is never read from a spec, which a
  session can edit. When a pinned spec-spine release provides `verify --plan
  --json` (R3), the base block is read through it instead of parsed.
- **D78 (proposed; one normalization for every copy of the origin, and
  historical values reduced where they are served).** 128 B-6's userinfo
  removal is one exported function used by both `originUrl` copies
  (`candidate.ts`, `projects.ts`). A value already chained stays in its
  record: the export withholds any included string that contains an `http` or
  `https` URL with userinfo (the leaf field is named, F13), and the API
  applies the same reduction to what it serves from historical records (a
  registration's check detail, a receipt's origin) without writing anything.
  No journal is rewritten.
- **D79 (proposed; the guard admits the dev UI through the proxy, not
  through a daemon exception).** `web/vite.config.ts` sets `changeOrigin:
  true` and rewrites `Origin` to the daemon's own only when the incoming
  `Origin` is the dev server's own; a foreign origin passes through unchanged
  and the daemon refuses it. The daemon keeps one rule and no dev flag. The
  alternative, a daemon flag admitting one extra origin, is recorded in 128
  D-6. The raw non-GET API test requests that lack the version header gain
  it.

### 18.4 Evidence: the verdict contract

The three repositories that will read this repository's evidence do not name
the same answers. Statecraft 015 §7.2 has `integrity`, `subject binding`,
`issuer trust` and `policy`, with `incomplete`, `unsupported` and `not
recorded` used beside its four values. hqgit's design note 02 T-3 has byte
integrity, signature validity, issuer trust and subject binding, with policy a
separate, later predicate and no `unknown` in 064's verdict. spec-spine's note
04 has integrity, signature, subject binding, recompute, freshness and policy.
No two sets agree, and nobody defines the value of an absent signature.

- **D80 (proposed; the verification report: four evidence dimensions and a
  separate policy result).** This repository's counter-proposal, which
  accepts the reconciliation's recommendation and fixes the values. A report
  (`reportVersion: 1`) carries:

  | Member | Values | Rule |
  |---|---|---|
  | `evidence.integrity` | `pass`, `fail`, `unknown` | bytes, links, sequence and verbatim payloads recompute; an unsupported format or version is `unknown` with reason `unsupported-version`, never `fail` and never `pass` |
  | `evidence.signature` | `pass`, `fail`, `unsigned`, `unknown` | `unsigned` when no signature is carried; `fail` when one is carried and does not verify; `unknown` for a scheme the verifier does not support. Every bundle and receipt this repository writes today is `unsigned` |
  | `evidence.issuerTrust` | `pass`, `fail`, `unknown` | `pass` only when `signature` is `pass` and the key is in a trust set the reader supplied out of band, valid when it signed; `fail` when the signature verifies and that set revokes or distrusts the key; `unknown` otherwise, which includes all unsigned evidence. A bundle's own `anchorHash` is never an issuer |
  | `evidence.subjectBinding` | `pass`, `fail`, `unknown`, `not-applicable` | `not-applicable` when the reader asked about no subject; `unknown` when the evidence cannot answer (a withheld receipt, a bundle with no receipt); `fail` when it names another revision or repository, or references a record the bundle does not hold |
  | `policy` | `{ evaluated: false }` or `{ evaluated: true, policyDigest, decision: "admit" \| "refuse", reasons }` | never an evidence dimension. Policy decides whether `unsigned`, `unknown` or a missing field is acceptable for an action |

  Each non-`pass` value carries a one-line reason. The report contains no
  boolean summary. What this asks of each repository: Statecraft moves
  `policy` out of the four and treats `incomplete` as a policy refusal reason
  and `not recorded` as a view label (131's), and answers its N-8 as
  `unknown`, not "`fail` or `unknown`"; hqgit's `--strict` becomes a policy
  over `issuerTrust: unknown` rather than a second meaning of the dimension;
  spec-spine's `recompute` and `freshness` stay in spec-spine's report about
  its own attestation, which a later receipt (D68) references by digest
  rather than flattening. Both verifiers here keep their exit codes and
  their current `--json` members, whose meaning is integrity only (F12), and
  gain the report as an additive member. Spec 132 B-2 and B-7.
- **D81 (proposed; evidence is referenced by typed digests of bytes, and
  stored as bytes).** A bundle is referenced as `{ type:
  "observatory-journal-export", formatVersion: 1, digest: { alg: "sha-256",
  hex } }` over the file's bytes exactly as written. A record inside it is
  referenced by its chain, `seq`, the chain's `anchorHash`, its `kind`, and
  its `recordHash`, beside the bundle's digest. `recordHash` is SHA-256 over
  the canonical serialization of the record without `recordHash`
  (`journal.ts:168-169`, 132 B-6 writes out the recipe); it is the chain's
  identity and not a digest of any bytes a receiver was handed, and the two
  are never substituted for each other. `alg` has exactly one accepted value
  today, and anything else is refused. A receiver that parses a bundle into a
  JSON value and re-serializes it has stored a reparse, and a digest taken
  after that is a digest of the reparse (the statecrafting repository's native
  ledger does exactly this, `addon/governance-native/src/ledger.rs:130-148`
  there); Statecraft 015 §8.2's dedup key becomes
  the bundle digest plus the receipt record's `recordHash`. Spec 132 B-8.
- **D82 (proposed; what approving 132 would authorize, and what it would
  not).** Approval would authorize: minting the `v1/` fixtures through the
  real code paths and freezing them, the negative set, the manifest and
  schemas, `checkReceipt` and `receiptBindsSubject`, the input cap, both
  runners, and D80's report in both verifiers. It would not authorize
  signing, a trust store, a reader policy, hosted ingestion, receipt version
  2, or any change to a committed bundle's bytes. If 128 lands first, the
  fixtures are minted at policy version 6 and include a receipt carrying a
  fabricated token-bearing origin, to prove historical redaction; if 132
  lands first, they are policy 5, and 128 adds a policy-6 directory beside
  `v1/` without touching it. 128 first is the recommendation.

### 18.5 Distribution: the members and the proof

- **D83 (proposed; the member set, with its consequences stated).** 130 D-1's
  recommendation stands, with what F11 adds made explicit: the archive ships
  the TypeScript engine, the Rust `statecraft-driver-claude` and
  `statecraft-driver-codex`, the Rust sensors, and the Rust
  `statecraft-journal` as the independent verifier. Installing the set
  changes the Claude driver a source-checkout engine resolves (managed
  directory before source entry) from the TypeScript build to the Rust one,
  which 114's parity tests are the justification for and the release notes
  must say. Codex has only a Rust driver. The sensors are not on the engine's
  path, so omitting them from the first archive would change nothing the
  engine does; they are included because they are built and parity-tested.
- **D84 (proposed; "available" means installed and verified, and the proof
  is one governed change).** Every surface (engine API, UI, drivers,
  verifier) is described by one of `source-only`, `packaged` (built by CI,
  not released), `released` (in a tag's assets), `installed-verified` (the
  no-checkout job passed for that tag) and `exercised` (a recorded live
  round). No document, page or view says a surface is available below
  `installed-verified`. Today the UI is `source-only`, the engine API is
  `packaged`, and driver discovery is `packaged`. 130's smoke job gains one
  governed change, driven by the fixture driver shipped to the job as a
  separate CI artifact (never in the archive), whose bundle is exported and
  verified by the archive's Rust `statecraft-journal`: a second
  implementation, reporting D80's dimensions (`integrity: pass`, `signature:
  unsigned`, `issuerTrust: unknown`). The developer-machine round with a
  signed-in provider stays in 130's acceptance.

### 18.6 The hosted seam and spec-spine: agreement before code

- **D85 (proposed; the client half accepts Statecraft 015's job protocol and
  refuses to guess its credential).** Accepted as the basis, from Statecraft
  015 (draft): the plane never executes a spec's declared verification; the
  job names `baseCommit` and a `policyDigest` from the base, and the runner
  reads the base's acceptance as data (D77's rule, applied to a hosted job);
  single-use enrollment codes; a lease with a monotonic per-job fence token on
  every mutating call; a pull heartbeat answering `continue` or `cancel`;
  `cancelling`, `abandoned` and `orphaned` distinct from `failed`; an
  `Idempotency-Key` per call, scoped to the job. Counter-proposed: the lease
  duration and heartbeat interval come back with each lease rather than as
  constants, and a runner that cannot renew before `leaseExpiresAt` stops its
  session (the driver's process-group kill, 124 D-6) instead of working
  unleased; evidence upload is keyed by D81's digests; enrollment records the
  runner's member manifest digest (130's `members.json`). Not accepted until
  answered, because the answers change the client's code: how a runner's
  credential is renewed (Statecraft 015 §4.3 waits on rahi; rahi's consumer
  contract, 01:561-567, hands the question back to Statecraft and this
  repository) and who mints it (a plane-minted credential is not a rauthy
  token that rahi 025's resource server validates). This repository's
  preference: rauthy's device grant with a public native client (rahi draft
  038 B-2) for an operator's login, with a refresh token stored per issuer,
  audience and client id; and for an unattended runner, whichever of a
  client-credentials principal or a plane-issued runner token Statecraft
  chooses, stated once. Lifetimes are read from `expires_in`, never assumed
  (025's text says 15 minutes, rahi as built uses rauthy's 1,800 s, draft 038
  proposes 600 s). The equal-cookie CSRF workaround rahi 01:598-600 suggests
  for bearer writes is not adopted in shipped code; the client waits for 038
  B-1's exemption. D71 and D72 stand, sharpened by this.
- **D86 (proposed; spec-spine is consumed at a pinned release).** No
  spec-spine release contains 083 to 089: v0.18.0 predates them, and drafts
  085 to 088 are committed on spec-spine's `main` (`0e41641`, #179) as drafts.
  This repository reads them as design references and codes only against
  released behavior at the pinned floor. R1 (`attest --json`), R3 (`verify
  --plan --json`) and R5 (a pinned installer) wait for a release that carries
  what they consume; §13's answers are otherwise unchanged.

### 18.7 Superseded in this document

- §1's table: AuthoritySnapshot is spec-spine draft 087, committed on
  `main` as a draft (#179) and unreleased, not "uncommitted".
- §2: the suite counts at `874766b` are §18.1's.
- §4 D60: the verify stage is no longer a residual; D74 and D77 dispose of it.
- §9 D72 and §14 (Rahi): the token lifetime is not settled at 15 minutes
  (D85).
- §13 R7: accepted for the verify stage as well (D77).
- §14 spec-spine (1): done (#179). §14 Statecraft (1) to (3): answered in
  part by Statecraft's drafts 015 to 017, to which D80 and D85 respond.
- §15: 129 lands D60 and D74 to D77 and now depends on 019 and 122; 128
  lands D58, D59, D78 and D79; 132 lands D66, D80 to D82; 130 lands D63, D64,
  D83 and D84; 131 now depends on 132, whose report it renders (131 D-4).
  The recommended order is unchanged: 128, 129, then 132 and 130, then 131.
- §16: the verifier's result shape (D80), the shipped members (D83) and the
  verify stage (D77) now carry concrete proposals; each is still the owner's
  to decide.

### 18.8 Decisions only the owner can make

1. Approve 128 (with D78 and D79), and whether it lands before 132 (D82).
2. For 129: fail on refusal or record only (D75); the verify-stage allowance
   and base-revision acceptance (D77); whether 129 grows to D74's full table
   or splits the verify stage into its own spec.
3. For 132: adopt D80 as this repository's report, before Statecraft 015 and
   hqgit 064 settle theirs, or wait for Statecraft to lead it; and D81's
   byte references.
4. For 130: D83's member set, including the Rust Claude driver replacing the
   TypeScript one for managed installs, and D84's availability vocabulary.
5. For the hosted seam: which credential an unattended runner holds, and who
   renews it (D85), decided with Statecraft and rahi before either end is
   written.

Answered on 2026-09-12 by the owner's adoption of revision 4 (§19).

## 19. Revision 4: the owner's adoption

On 2026-09-12 the owner adopted the statecraft-cli rows of the revision-4
decision package (`grand-refactor/07-revision-4-decision-package.md` §3,
CLI-01 to CLI-09), with the shared rows those rows cite (G-04 to G-07, G-09,
G-10) and the package's shared contract acceptance, in a working session of
this repository, and answered there the three points the rows left open
(§19.2). The package is the family's planning record and keeps its own
adoption line; this section is this repository's record of what was adopted
and where each decision lands.

Adoption authorizes the scoped local specification amendments,
implementation and tests. It does not include publication: G-02 keeps draft
pull requests for an explicit inclusion the owner has not made, and merges,
releases and deployments for later. The revision-3 commit and the commit
carrying this section are local until the owner decides.

### 19.1 What was adopted, and where it lands

| ID | Adopted | Lands |
|---|---|---|
| CLI-01 | Approve revised 128 and build it first. Keep the compatible dev proxy (D79); reduce both origin lookups and redact served historical values without rewriting a journal (D78). The real attack probes become regression tests | 128 `approved`; its D-6 resolved; D-9 |
| CLI-02 | A refusal fails the gate and verify-stage acceptance even when a command swallows its exit (D75). Verify-stage fencing and base-revision acceptance stay in 129, not split (D77). Any allowance for live acceptance is journaled. Refusal accounting belongs to the supervisor and its child cannot erase it. Hooks, verify commands and the broker's push are protected, and an authorized broker push still succeeds | 129 `approved`; D-5 and D-7 resolved; B-3 and FR-008 revised; D-9 |
| CLI-03 | 126 is credential protection reporting `applied`, `degraded` or `refused`, with any keychain or environment residual visible in the result. 127's note is posted by the broker in a driven run. Neither claims hostile-code isolation or preventive territory confinement. Both follow 128 and 129, and neither delays 132 | 126 and 127 amended, still `draft` |
| CLI-04 | G-04 to G-07: Statecraft owns the verdict semantics and this repository's Apache-2.0 workspace holds the schemas, fixtures and pure verifier; G-05's four dimensions with `admission` apart; G-06's trust rules; G-07's typed byte references. Statecraft and 132 both record the shared decision before a fixture is minted. statecrafting 010's vectors join the negative set. The first acceptance is the admission pair (§19.2), then the full matrix | 132 amended, still `draft`; D80 and D81 superseded (§19.3) |
| CLI-05 | The member archive ships the Rust verifier and leaves the currently selected Claude driver implementation as it is; installing or selecting the Rust Claude driver as a new default waits for explicit parity evidence. The clean-machine proof covers assets, provider data, the working directory, member discovery and the daemon lifecycle | 130 amended, still `draft`; D83 superseded |
| CLI-06 | 131 renders 132's report once its schema freezes. Unknown, unsigned, omitted and unbound coverage are visible, and there is no single verified badge | 131 amended, still `draft` |
| CLI-07 | G-09 and G-10: a first pilot runner is an enrolled person's device-grant session with refresh-token renewal; leases bind to `runnerId`, tenant and principal, never to one access token; unattended service-principal runners are deferred; lease duration and heartbeat interval come back from the plane; expiry is read from `expires_in`; the plane never runs repository verification. Local delivery and packaging do not wait for hosted credentials, and hosted runner integration waits for working Rahi 038 authentication | D85 resolved |
| CLI-08 | Authority-affecting changes are judged under the trusted base's gate contract and need human approval. The evidence carries the policy identity and the actual candidate and merge-tree identity. A candidate cannot authorize its own weakened rules. spec-spine 088's report is integrated once a pinned release carries it, and no support is claimed before | a later spec on D68's line (below) |
| CLI-09 | aicortex publishing and observation, a richer submission closure (D69) and the A10 adapter wait for their producer contracts. Capability tokens stay the names of what an executor protects, never a user's authorization. The later publisher is least-privilege and journal-based, and feeds 123's capsules and 131's reports. None of this blocks the local release | nothing built; §15's later rows |

CLI-08, measured against the tree: the gate contract is registry state an
operator journals (041), never read from the candidate, and the receipt
already carries that contract's digest and the candidate sha (121). A gate
command still runs the candidate's own Makefile and tests, which 121 records
as `acceptance.sensitive` without refusing, and nothing requires a human
approval before such a receipt admits a publication or records the merge
tree. Those two parts land with D68's receipt revision, authored once a
pinned spec-spine release carries 087 and 088. 129 B-8 already reads the
acceptance a merge is verified by from the base.

### 19.2 Points the rows left open, answered in the adopting session

- **132's first acceptance is the admission pair.** The same intact, unsigned
  evidence is admitted under an explicit local policy allowing unsigned
  evidence, and refused under a policy requiring a trusted signature. Neither
  implies that unsigned evidence is trusted. The redaction pair and the
  base-policy pair belong to the matrix that follows.
- **130's archive:** the compiled TypeScript engine and its built web UI, the
  provider qualification records, the Rust `statecraft-journal` verifier, the
  Rust Codex driver, and the compiled TypeScript Claude driver, which keeps
  the Claude implementation a source checkout runs today. The Rust sensors
  and a switch to the Rust Claude driver are deferred. Leaving the Claude
  driver out would make the packaged loop depend on the user supplying its
  adapter; provider software and sign-in stay prerequisites, and shipping the
  adapter bundles neither.
- **The UI stays a local dashboard.** The engine serves it on loopback and
  the operator opens it in a browser (024, 130 D-2), without a Statecraft
  account. A hosted dashboard controlling a local engine would add an
  authentication and browser-origin boundary, and connectivity and
  version-compatibility requirements. A later hosted Statecraft dashboard can
  coordinate teams without becoming a prerequisite of the local loop.

### 19.3 This document's proposals, settled or superseded

- **D74 to D77:** adopted as drafted, with CLI-02's addition that the
  supervisor, not a file its child can write, owns refusal accounting (129
  B-3).
- **D78 and D79:** adopted (128).
- **D80:** superseded by G-05 and G-06. The four evidence dimensions and
  their values stand. `policy` becomes `admission`, `admit` or `refuse` with
  reason codes, and incomplete required evidence refuses admission with a
  reason. `subjectBinding: not-applicable` applies only to a record type that
  carries no subject, and a missing expected subject is `unknown`. A report
  keeps producer claims, verifier identity and version, root-set identity,
  coverage and stop reasons apart from the dimensions, and a check that did
  not run is `unknown`.
- **D81:** superseded by G-07, which extends it. A reference carries a type,
  a schema version, the SHA-256 digest and length of the bytes, an optional
  producer digest naming its construction, and a container and selector for
  an embedded record. A git subject names its repository and its commit and
  tree object formats. A reference's identity includes its construction, and
  a canonical record hash never substitutes for a file-byte digest.
- **D82:** stands, with the admission pair as the first acceptance and 128
  first, so the fixtures are minted at policy version 6.
- **D83:** superseded by CLI-05 and §19.2.
- **D84:** stands as this repository's internal packaging criterion only.
  G-12 keeps `installed-verified` out of any family-wide or public label.
- **D85:** resolved by G-09 and G-10 (CLI-07).
- **D86:** stands. The package's SP-02 adds that a consumed build is a tagged,
  pinned release, never a development build.
- **§16:** the neutral verifier lives in this workspace (G-04), in a form 132
  chooses (`statecraft-journal` or a sibling crate), with no AGPL code; the
  shipped members are §19.2's; web assets ship beside the engine; the first
  issuer is Statecraft's (G-08: an offline owner-held root enrolling an online
  platform issuer), and local user roots stay separate. R6 and 127 B-5 are
  unchanged.

### 19.4 Order, and what an approval records

128, then 129, both `approved` in the change that carries this section. 132's
schema and fixture harness proceed independently of both. Then 126, 127 and
130 (whose evidence smoke waits for 132), then 131 against the frozen
report. 126, 127, 130, 131 and 132
carry the adopted amendments and stay `draft`: each is flipped to `approved`
in the change that dispatches it, which records this adoption rather than
asking for it again. Before 132 mints a fixture, Statecraft's 015 and 016
record the same G-05 to G-07 contract (the package's ST-01); that is the
shared record CLI-04 names, not a review round.

The local slice's exit, from the package: the attack refusals demonstrated
beside a successful authorized broker operation, verifier parity, and a
clean installed run. A source-only UI is not called released.
