---
id: "016-permits-and-evidence-chain"
title: "Permits and the evidence chain: authorizing work, authorizing an effect"
status: draft
created: "2026-09-11"
implementation: pending
depends_on:
  - "008-governance-attestation"
  - "014-rahi-realignment"
  - "015-hosted-work-contract"
establishes:
  - { kind: directory, path: "specs/016-permits-and-evidence-chain/" }
summary: >
  Two permits and one chain. A WorkPermit says who may do what work,
  against which authority, for how long; an ActionPermit says that one
  named external effect may happen, on one exact artifact, in one target
  environment, under one policy, with one set of approvals, once. Both
  carry an independent issuer, a scoped audience, an expiry, a nonce and
  a fence checked at effect time, and neither can be authorized by
  content that signs itself. The chain that binds them is acyclic:
  authority and scope, permit, candidate results, acceptance receipt,
  build provenance and artifact digest, action permit, outcome, runtime
  binding, each referencing only what came before it by digest. A change
  to the rules of authority is evaluated under the rules that were
  trusted before it, with a named bootstrap. Intent and outcome are
  reconciled, never assumed atomic.
---

# 016: Permits and the evidence chain

Link a compilation unit to this spec via `[package.metadata.spec-spine].spec`
in its manifest, a `// Spec:` header, or the edges above.

## 1. Purpose

Spec 015 admits work and accepts evidence. It authorizes nothing. This
spec is the authorization half, and it is separate for a reason the
family has already converged on independently: a uniform substrate is
uniform at three points, the admission of work, the acceptance of code,
and the authorization of an external effect (statecraft-cli's doc 04
section 1). Folding the third into the first produces a system where
being allowed to *try* something and being allowed to *do* it are the
same record, which is precisely the confusion a control plane exists to
remove.

Four properties are load-bearing throughout and are stated once here
rather than repeated:

- **Source authority, actor identity, policy approval and credentials are
  four different things.** spec-spine says what a tree's authority state
  is. An IdP says who is calling. A policy says whether this class of
  change may proceed and who must approve it. A credential lets a
  process act. A permit binds all four together for a bounded purpose,
  and it is the only place they meet.
- **Signed candidate content cannot self-authorize.** A change that
  proposes to weaken the rules is judged by the rules it proposes to
  replace. This holds for a signature too: a payload that names its own
  trust root has named nothing.
- **A permit is evaluated at effect time, not at issue time.** Expiry,
  revocation, the lease fence and the reserved budget are all checked at
  the moment the effect is attempted, because everything can change
  between issue and use.
- **Time and usage are inputs, not ambient state.** Whatever evaluates a
  permit is handed the time and the usage snapshot explicitly, so the
  same evaluation can be reproduced later. The clock and the counter live
  in the plane; the evaluation is a pure function of what it was given.

## 2. Territory

Planned (spec-spine spec 076); claimed for real in the change that writes
the files. Revised 2026-09-12 for the same two reasons as spec 015
section 2: no interim hosted engine on the EnRaHiTu plane, and shared
schemas an Apache-2.0 consumer can embed.

- **The permit service** (issuance, evaluation and revocation; budget and
  waiver-use reservation; the intent and outcome reconciler): in the Rahi
  pilot cell of spec 017 Part A.
- **The permit schemas and worked examples**: published beside spec 015's
  in statecraft-cli's Apache-2.0 workspace, before either end is
  implemented.
- **The pure evaluator** of section 12.3 (a function of permit, policy,
  time, usage, fence and evidence): a candidate for the same permissive
  workspace, since the local broker evaluates the same shape.
- **The governance chain**: spec 008's record shape and construction are
  not redefined here. The issuer of section 5 starts a new chain in the
  pilot cell; the legacy file chain is not re-anchored (section 5.4).

## 3. The WorkPermit

**3.1 What it binds.** `{permitId, issuer, audience, tenantId,
projectId, subject, actorClass, scopeRef, authorityRef, closureRef?,
policyDigest, obligations[], notBefore, notAfter, nonce, maxUses,
attenuatedFrom?}`.

- `subject` is the actor the permit is for: a person's IdP `sub`, or a
  runner id, never both.
- `scopeRef` is the WorkScope digest, when spec-spine files one. Until
  then the field is present and `null`, and any claim that depends on a
  scope reports `not recorded`.
- `authorityRef` is the AuthoritySnapshot digest the permit was issued
  against (spec-spine draft 087).
- `obligations[]` are the things that must hold for the work to be
  accepted, by id and text digest. The permit names them; it does not run
  them.

**3.2 Who issues it.** statecraft, for hosted work; an authorized local
operator, for local work. A permit issued by the local operator is valid
only for local effects, and section 4.4 explains why that is not a
loophole.

**3.3 Attenuation only narrows.** A permit derived from another names its
parent and may remove scope, shorten validity, reduce uses or add
obligations. It can never widen any of them, and a derivation that tries
is refused at issue rather than at use.

**3.4 A permit is not an enforcement mechanism.** It states what must
hold. The executor maps each requirement onto something that can actually
enforce it (a capability token, a credential fence, a sandbox profile),
and a required protection with no enforcer refuses before the work
starts rather than pretending. This is statecraft-cli's D70 and D45, and
this spec depends on that behavior rather than duplicating it.

## 4. The ActionPermit

**4.1 What it binds.** One permit, one effect:

| Field | Binds |
|---|---|
| `requester` | the IdP `sub` or runner id that asked |
| `tenantId`, `projectId` | whose, and against what |
| `action` | `push`, `openPr`, `merge`, `note`, `deploy`, `restore` |
| `source` | repository, exact commit sha, and tree digest where available |
| `artifact` | for `deploy` and `restore`: the artifact digest, never a tag |
| `environment` | the exact target, named; `null` for source-only actions |
| `policyDigest` | the policy this was evaluated under, from the base |
| `approvals[]` | each approval's subject, time and the policy clause it satisfies |
| `evidence[]` | the typed references required (byte digest, producer digest, subject), with their four dimensions and admission result as evaluated |
| `notBefore`, `notAfter` | a short validity, sized to the effect |
| `nonce`, `idempotencyKey` | replay refusal, and reconciliation on retry |
| `fence` | the lease fence that must still be current at effect time |

**4.2 A tag is never an artifact.** `deploy` binds an artifact digest. The
tag that happened to point at it is recorded as a label and is never what
is authorized. This repository has already paid for the alternative:
a published image went stale against `main` silently, and the correction
was to pin by digest.

**4.3 Approvals reference the policy clause they satisfy.** An approval
that is not attached to a requirement is a comment. Where the policy
requires a second person, the permit refuses to issue with one, and an
approval by the requester never counts toward a requirement that names a
second party.

**4.4 A local permit cannot authorize a hosted effect.** The issuer is
part of what the effect-time check evaluates: the acting component
accepts permits from its own issuer and audience only. A local operator
issuing a permit to itself is exactly what statecraft-cli's broker
already does with its lease and receipt, and its authority is the local
journal's. It does not reach a hosted environment, and a hosted permit
does not reach the operator's laptop.

**4.5 Deployment requires more than a permit.** An `action: deploy`
permit issues only when three things exist: immutable build provenance
for the artifact digest (section 9), an authorization for the target
environment distinct from the authorization for the source, and a
recorded recovery behavior for the environment (what happens on failure,
and what a restore restores). Missing any one, the permit is refused and
the refusal names which.

## 5. Issuer trust, and the anchor we do not have

Spec 014 section 3.5 records the measurement: the production chain's
anchor is `{"kind": "unsigned"}` with an empty key and signature, the
`GOVERNANCEANCHORKEY` secret is absent from the live Secret, and
`ledgerAnchor` is never called. Spec 008 permits this and puts key
ceremonies out of scope. So today, every verification of our own evidence
answers `unknown` on issuer trust, and this spec makes that answer
explicit rather than letting a `verified: true` stand in for it.

**5.1 Four dimensions and admission, here as in intake.** `integrity`,
`signature`, `issuerTrust` and `subjectBinding` are evaluated and
reported separately, never folded, and admission is a separate result
(spec 015 section 7.2, revised 2026-09-12). A permit that requires a
trusted issuer cannot be satisfied by `unknown` or `not-applicable`.

**5.2 The issuer is established out of band.** A trust root reaches the
plane by an operator action recorded as its own attestation, never from
inside a bundle, a payload or a candidate. Adding a trust root is itself
an authority change and goes through section 6.

**5.3 The first issuer is proposed, not decided.** This spec fixes the
shape of the answer: an issuer id, its public key, the scope of what it
may attest, its validity window, and a revocation path. 014 D-2 proposes
the answer. An offline owner-held root is published by fingerprint out of
band. It enrols an online platform issuer held in the pilot cell's secret
custody. Rotation and revocation are root-signed records, and
`issuerTrust` is evaluated against the enrolment set valid at the
evidence's time, passed in explicitly. Nothing here is blocked by the
decision: an unsigned chain with an honest `unknown` is strictly better
than a signed chain whose key nobody decided about.

**5.4 No retroactive anchor.** Added 2026-09-12. The existing production
chain is not signed after the fact. Calling `ledgerAnchor` on it now
would sign a root chosen after the records it roots, which manufactures
continuity instead of recording it. Its records keep
`issuerTrust: unknown` (`unsigned`) permanently. The first record of the
issuer's chain references the legacy head hash and the archived bytes'
digest as history, never as trust.

## 6. Trusted-base authority change

A change to who owns what, to the constitution, to the waiver rules or to
the verification rules is not an ordinary change, because it changes the
thing that would judge it.

**6.1 The base's rules judge the candidate.** Classification is computed
under the **base** revision's configuration, so a candidate cannot
reclassify its own change by editing the config in the same change. This
is spec-spine's draft 088 and its S3; the plane consumes the
classification and does not recompute it.

**6.2 Which classes are authority changes.** Ownership edges, the
constitution and the standards tree, waiver rules and keywords, the
verification block of a spec, the gate configuration and its hash, the
resolver exclusions and the ownership ratchet, and the trust roots of
section 5. The list is data, versioned with the policy, not a constant in
code.

Decision (2026-09-12), recorded because the section was silent on it:
spec-spine's draft 088 names the classes `authority`, `constitutional`,
`verification` and `policy`, and has no class for waiver rules or for
trust roots. A waiver rule that lives in `spec-spine.toml` is caught by
`policy`, without being told apart from any other configuration edit.
Trust roots are plane state, not tree state, so the plane classifies them
itself and 088 never will. A finer waiver class is a request to
spec-spine (014 section 10.2), not a dependency of this spec.

**6.3 What an authority change requires.** Approval under the prior
policy by a party the prior policy names; a permit whose `policyDigest`
is the prior policy's; and a recorded reason. A waiver is a human
instrument: the plane records its use, never authors one, and an agent
never self-approves one. This repository's own rule already says so
(`.claude/rules/adversarial-prompt-refusal.md`); the difference here is
that the plane can refuse rather than only ask.

**6.4 Bootstrap is named, not implied.** The first policy, the first
trust root and the first operator are established by a recorded
bootstrap: an operator action, attested, with its own record naming what
was established and by whom. Everything after it is evaluated under what
came before. A system that cannot say where its first authority came from
is not auditable, however good its chain is.

**6.5 Migration is named too.** Changing the policy format, the digest
construction or the schema major version is an authority change with a
migration procedure: which records are re-evaluated, which keep their
original construction forever, and what a reader of the old version does
with the new. Historical constructions are never re-derived under new
rules.

## 7. Intent and outcome are not atomic

A journal write and an external API call cannot be made atomic, and
designing as though they can produces a plane whose records are
confidently wrong.

**7.1 Three records, in order.** `intent` before the call, naming the
permit, the idempotency key and everything the call will carry;
`outcome` after it, naming what the external system said; and
`reconciled` when the two are made to agree. An intent with no outcome is
a normal state, not a defect.

**7.2 Reconciliation reads, it does not guess.** On restart or retry, the
plane reads the external system's current state for the idempotency key
and decides. A failed response is never evidence that nothing happened; a
timeout is evidence of nothing at all.

**7.3 A retry never repeats an effect.** The idempotency key is presented
to the external system where the API supports one, and reconciled by
reading where it does not. GitHub's merge endpoint accepting an expected
head is the model: the effect names the state it expects, and a mismatch
refuses rather than proceeding.

**7.4 Budgets and waiver uses are reserved atomically.** Where a permit
carries `maxUses` or spends a bounded allowance, the reservation happens
in the same transaction that issues the intent, and is released on a
reconciled non-effect. A counter incremented after a successful call is
a counter that undercounts exactly when it matters.

## 8. The evidence chain, acyclic

Each link references only links that precede it, by digest. No link
references a later one, and no link is rewritten once written.

```
AuthoritySnapshot + WorkScope        (spec-spine)
        |
        v
    WorkPermit                       (this spec, section 3)
        |
        v
candidate results + obligation results
        |
        v
    AcceptanceReceipt                (statecraft-cli, version 1)
        |
        v
build provenance + artifact digest   (in-toto / SLSA, section 9)
        |
        v
    ActionPermit                     (this spec, section 4)
        |
        v
    outcome                          (section 7)
        |
        v
runtime epoch / binding              (section 10, detached)
```

**8.1 Original bytes, original references.** A link binds the bytes it
was given. Old signed evidence keeps its original construction and its
original verifier forever; a migration never re-derives an old digest
under a new rule, and never substitutes a reconstruction for the bytes
that were signed.

A link to evidence another producer made is a typed reference `{type,
schemaVersion, digestAlg, byteDigest, byteLength, producerDigest,
subject}` to bytes kept verbatim (014 section 10.3, D-3). The object
itself never enters a ledger payload. The governance ledger's append
parses and re-serializes, and was measured folding two different
integers into one digest and dropping a duplicate member.

**8.2 A missing link is `not recorded`.** Not absent, not assumed
satisfied. Every field a future contract will add (scope, closure,
permit) reports `not recorded` until it exists, so a reader can tell a
system that did not record something from a system that recorded nothing
happening.

## 9. Reuse, not reinvention

Build provenance and artifact identity are solved problems with adopted
standards, and inventing a competing one would produce evidence nobody
else can read.

- Build provenance uses **in-toto attestations** with a **SLSA**
  provenance predicate, referencing the artifact by digest. statecraft
  defines no SBOM format and no build-description format of its own.
- statecraft's contribution is **composition**: which predicates it
  requires for which action, how they bind to a permit, and what a
  missing or unverifiable one means. spec-spine's S4 asks statecraft to
  lead the composition envelope, and this is the boundary of that lead:
  statecraft names the payload types and their required bindings;
  spec-spine supplies stable type names and versions for its own
  payloads and reviews the mapping.
- Where a family repository defines a record (statecraft-cli's receipt,
  hqgit's facts), statecraft references it by
  `(type, schemaVersion, SHA-256 of the record bytes)` plus subject tree
  and commit, and re-derives nothing.

## 10. Runtime binding, replay and shadow policy

**10.1 A runtime binding is detached and does not assume a substrate.**
Binding a running instance to an artifact digest is a separate record
from the artifact's provenance, because the running thing cannot contain
an assertion about itself. It carries an epoch so that a restart is
distinguishable from a redeploy, and it must work for an application that
does not run Rahi, does not run in our cluster, and reports nothing. For
such an application the binding is `unknown`, which is a legitimate
state and not a degraded `pass`.

**10.2 Historical replay is not present authorization.** Re-evaluating
recorded inputs under a named policy and verifier version answers a
historical question. It produces a replay record, it never produces a
permit, and it never triggers an effect. A fact missing from the record
replays as `unknown`, never as what a current system would say.

**10.3 A shadow policy can authorize nothing.** A policy running in
shadow records its verdicts beside the enforced one and is structurally
incapable of issuing or refusing a permit. Promoting it is an authority
change under section 6.

## 11. Negative cases

Acceptance tests, not examples. The packet's exit criteria name five;
these are those five plus what the sections above require.

| # | Case | Required behavior |
|---|---|---|
| N-1 | a permit for a different subject or tenant than the caller | refused at effect time; the effect does not happen |
| N-2 | a candidate that weakens ownership, the constitution, a waiver rule or a verification block | classified under the base's policy, refused without a prior-policy approval |
| N-3 | a permit or evidence from an untrusted issuer | `issuerTrust` is `fail` or `unknown`; a policy requiring a trusted issuer refuses |
| N-4 | an expired permit | refused at effect time even though it was valid at issue |
| N-5 | a replayed permit (nonce or `maxUses` exhausted) | refused; the reservation is not double-spent |
| N-6 | required evidence missing | refused, and the refusal names which evidence |
| N-7 | a `deploy` naming a tag rather than a digest | refused at issue |
| N-8 | a stale fence at effect time | refused; another run holds the lease |
| N-9 | an external call whose response is lost | reconciled by reading, never retried blindly, never recorded as failed |
| N-10 | an approval by the requester where the policy names a second party | does not count toward the requirement |
| N-11 | a restore | the chain is preserved: original bytes, original digests, original verifiers |
| N-12 | a foreign evidence object sent through a canonicalizing ledger append instead of by typed reference | refused before the append; no digest is recorded for re-serialized bytes |
| N-13 | a request to anchor or sign the legacy chain after the fact | refused; its records keep `issuerTrust: unknown` (`unsigned`) |
| N-14 | a trust root, or an issuer enrolment, carried inside a bundle or candidate | ignored as a root; `issuerTrust` unchanged; the attempt recorded |

## 12. Acceptance

1. N-1 through N-14 are tests that fail if the behavior changes.
2. One hosted effect, end to end, rejects N-1, N-2, N-3, N-4 and N-6,
   which is the packet's exit criterion stated as a single run.
3. A permit's evaluation is a pure function of `(permit, policy, time,
   usage, fence, evidence)`, with time and usage passed in, and a test
   reproduces a past decision by replaying its inputs.
4. Intent, outcome and reconciled are three durable records, and a test
   kills the process between intent and outcome and shows the reconciler
   reaching the right answer by reading.
5. A restore of the control plane preserves every chain: the same
   digests verify, with the same verifiers, over the original bytes.
6. No permit is issued, and no effect is authorized, by anything a
   candidate or a payload contains. A test asserts the trust root cannot
   be set from inside a bundle.
7. `spec-spine verify 016` is green.

## 13. Cross-repo dependency

- **spec-spine**: draft 087 (AuthoritySnapshot) and draft 088
  (classification under the base's rules) must be approved before
  `authorityRef` and section 6.1 are more than references to proposals.
  Status 2026-09-12: both are committed as drafts (spec-spine PR #179),
  087's D3 (framed digest or the legacy `specAttestationHash`) is open,
  and no release after `v0.18.0` exists, so no installed binary carries
  either.
- **statecraft-cli**: receipt version 1's fixtures (its draft 132),
  agreement that the action permit lives here (its doc 04 D52 and doc 05
  D71 already state it), and acceptance of the verdict contract (014
  section 10.2).
- **statecrafting**: none blocking. Its 009 F-3 is answered in 014
  section 10.3; this spec puts no foreign object in a ledger payload.
- **Rahi**: the pilot cell (spec 017 Part A) for the service, and no
  second durable store, so the issuer's chain is built in the cell's own
  store. Section 10.1 deliberately does not assume the deployed
  application is a cell.

## 14. Out of scope

- **Choosing the first trust root.** Proposed as 014 D-2; the owner
  decides.
- **The neutral verifier's implementation.** Its proposed home is
  statecraft-cli's Apache-2.0 workspace (014 section 10.2); this
  repository is AGPL-3.0 and cannot host a permissive verifier.
- **Defining an SBOM or build-description format.** Section 9.
- **Spec-fitness, pressure, CVE and compliance analytics.** Deferred
  until linked data and a customer need justify them. Evidence coverage
  is not certification, correlation is not causality, and no cross-tenant
  learning dataset is created from tenant evidence.
- **Billing and entitlement enforcement through permits.** A permit is
  not a licence check; 014 O-6.
