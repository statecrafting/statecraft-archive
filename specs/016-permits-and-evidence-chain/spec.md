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
  - "017-rahi-cell-migration"
  - "018-hosted-work-service"
establishes:
  - { kind: directory, path: "specs/016-permits-and-evidence-chain/" }
summary: >
  Two permits and one chain. A WorkPermit says who may do what work,
  against which authority, for how long; an ActionPermit says that one
  named external effect may happen, on one exact subject, in one target,
  under one policy, with one set of approvals, once. Both carry an
  independent issuer, a scoped audience, an expiry, a nonce and a fence
  checked at effect time, and neither can be authorized by content that
  signs itself. The chain that binds them is acyclic, each link
  referencing only what came before it by digest. A change to the rules of
  authority is evaluated under the rules that were trusted before it, with
  a named bootstrap. Intent and outcome are reconciled, never assumed
  atomic. Aligned on 2026-09-12 with the owner's adoption (spec 014
  section 11): the four evidence dimensions and separate admission of
  G-05 and G-06, typed byte references (G-07), an offline owner-held root
  enrolling an online platform issuer with the legacy chain archived and
  closed rather than re-anchored (G-08, ST-03), and a pilot slice
  (permits, prior-policy authority change, the issuer, broker actions and
  reconciliation) approvable only for the N=1 pilot after its
  prerequisites. Artifact and deployment binding, runtime binding and
  expanded delegation are deferred until the local slice and the pilot
  pass (ST-07).
---

# 016: Permits and the evidence chain

Link a compilation unit to this spec via `[package.metadata.spec-spine].spec`
in its manifest, a `// Spec:` header, or the edges above.

## 1. Purpose

Spec 015 admits work and judges evidence. It authorizes nothing. This
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
  pilot cell of spec 017 Part A, beside spec 018's work service.
- **The permit schemas and worked examples**: published beside spec 015's
  in statecraft-cli's Apache-2.0 workspace, before either end is
  implemented.
- **The pure evaluator** of section 12, item 3 (a function of permit,
  policy, time, usage, fence and evidence): in the same permissive
  workspace, since the local broker evaluates the same shape. Adopted as
  that home on 2026-09-12 (G-04); statecraft owns the semantics and
  contributes no AGPL code there.
- **The governance chain**: spec 008's record shape and construction are
  not redefined here. The issuer of section 5 starts a new chain in the
  pilot cell; the legacy file chain is archived and closed, never
  re-anchored (section 5.4).

### 2.1 The pilot slice, and what is deferred

Recorded 2026-09-12 (spec 014 section 11, ST-06 and ST-07). This spec is
approved in slices, and only the first has a date it can be approved on:
the N=1 pilot, after the prerequisites spec 018 section 1.1 names.

| Slice | Sections | Approvable |
|---|---|---|
| **Pilot**: the permits and prior-policy slice the pilot requires | 3 (a WorkPermit issued directly to a person or a runner); 4 for the source actions `push`, `openPr`, `merge` and `note`; 5 (the issuer); 6 (trusted-base authority change and bootstrap); 7 (intent, outcome, reconciliation); 8 up to `outcome`; 11 and 12 except the rows marked deferred | only for the N=1 pilot, after its prerequisites |
| **Deferred** until the local slice and the pilot pass (ST-07) | 3.3 beyond a single permit (expanded delegation); 4's `deploy` and `restore` actions and 4.5; 9's artifact provenance; 10.1 (runtime binding) | not before then; the first artifact target is chosen at that point |
| **Outside the pilot**, specified and unscheduled | 10.2 (historical replay), 10.3 (shadow policy) | when the pilot has records worth replaying (spec 014 section 4.6, step 6) |

Provenance, fleet extraction and observability expansion block no part of
the pilot slice (ST-07). The named owners are kept as record 06 set them:
spec-spine for source contracts, statecraft-cli for adapter and
submission consumers, statecraft for runtime binding.

## 3. The WorkPermit

**3.1 What it binds.** `{permitId, issuer, audience, tenantId,
projectId, subject, actorClass, scopeRef, authorityRef, closureRef?,
policyDigest, obligations[], notBefore, notAfter, nonce, maxUses,
attenuatedFrom?}`.

- `subject` is the actor the permit is for: a person's IdP `sub`, or a
  runner id, never both. In the pilot a runner is always a person's
  session (spec 015 section 4.2), so a runner id resolves to one `sub`.
- `scopeRef` is the WorkScope digest, when spec-spine files one. Until
  then the field is present and `null`, and any claim that depends on a
  scope reports `not recorded`. WorkScope is deferred beyond the local
  slice, and its absence blocks nothing here.
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
is refused at issue rather than at use. **Deferred** (ST-07): chains of
derivation beyond one permit issued directly to its subject, which is the
expanded agent delegation the adoption holds back until the local slice
and the pilot pass. The pilot refuses a derived permit at issue.

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
| `action` | `push`, `openPr`, `merge`, `note`; `deploy` and `restore` are deferred (2.1) |
| `source` | the repository, the exact commit id and the tree id, each with its object format (spec 015 section 5.3) |
| `artifact` | for `deploy` and `restore`, when they arrive: the artifact digest, never a tag |
| `environment` | the exact target, named; `null` for source-only actions |
| `policyDigest` | the policy this was evaluated under, from the base |
| `approvals[]` | each approval's subject, time and the policy clause it satisfies |
| `evidence[]` | the typed references required (spec 015 section 7.1), each with its four dimensions and admission result as evaluated, and the verifier and root-set identities of that evaluation |
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

**4.5 Deployment requires more than a permit.** **Deferred** (ST-07),
kept as the design the deferral will reopen. An `action: deploy` permit
issues only when three things exist: immutable build provenance for the
artifact digest (section 9), an authorization for the target environment
distinct from the authorization for the source, and a recorded recovery
behavior for the environment (what happens on failure, and what a restore
restores). Missing any one, the permit is refused and the refusal names
which. The first artifact target is chosen when the local slice and the
pilot have passed, not before.

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
reported separately, each in its own value domain, and admission is a
separate result (spec 015 section 7.2, adopted 2026-09-12 as G-05 and
G-06). A permit that requires a trusted issuer is satisfied only by
`issuerTrust: pass`, which exists only after a passing signature against
a key eligible under a root set supplied independently of the evidence.
An absent key is `unknown`; a positively revoked or excluded key is
`fail`; a self-anchored chain satisfies neither.

**5.2 The issuer is established out of band.** A trust root reaches the
plane by an operator action recorded as its own attestation, never from
inside a bundle, a payload or a candidate. Adding a trust root is itself
an authority change and goes through section 6.

**5.3 The first issuer.** Adopted 2026-09-12 (G-08). An offline root
Ed25519 key, held by the owner and never on the cluster, is published by
fingerprint out of band (a tagged revision of this repository and the
site), never inside evidence. The root signs the enrolment of an online
platform issuer key held in the pilot cell's secret custody:
`{issuerId, publicKey, scope, notBefore, notAfter}`. Rotation and
revocation are root-signed records, and `issuerTrust` is evaluated
against the enrolment set valid at the evidence's time, passed in
explicitly. The bootstrap is the first record of the new chain (6.4).
Local use keeps the user's own root (statecraft-cli's), and neither root
is trusted across that line. A transparency log is deferred.

Before the hosted plane admits anything under a policy that requires a
trusted issuer, enrolment, rotation, revocation and evaluation-time
semantics are tested (N-15 to N-17). Setting up the root's custody does
not delay unsigned local fixtures, and an unsigned chain with an honest
`unknown` stays strictly better than a signed chain whose key nobody
decided about.

**5.4 No retroactive anchor; the legacy chain closes.** Added 2026-09-12,
and made a decision the same day (G-08, ST-03). The existing production
chain is not signed after the fact. Calling `ledgerAnchor` on it now would
sign a root chosen after the records it roots, which manufactures
continuity instead of recording it. Its records keep `issuerTrust:
unknown` permanently. At migration (spec 017 section 7) the chain is
archived and closed: its exact bytes and the actual published verifier
binary that verifies them are preserved, each by digest. It is historical
evidence and never the active ledger. The first record of the issuer's
chain references the legacy head hash and the archive's byte digests as
history, never as trust.

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
rules, and their verifiers are kept as the binaries that ran, not as
source that might build differently.

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
references a later one, and no link is rewritten once written. The pilot
slice builds the chain to `outcome`. Two of its links are deferred (2.1):
build provenance and the artifact digest, which only `deploy` requires,
and the runtime binding below `outcome`.

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
build provenance + artifact digest   (in-toto / SLSA, section 9; deferred)
        |
        v
    ActionPermit                     (this spec, section 4)
        |
        v
    outcome                          (section 7)
        |
        v
runtime epoch / binding              (section 10, detached; deferred)
```

**8.1 Original bytes, original references.** A link binds the bytes it
was given. Old signed evidence keeps its original construction and its
original verifier forever; a migration never re-derives an old digest
under a new rule, and never substitutes a reconstruction for the bytes
that were signed.

A link to evidence another producer made is spec 015 section 7.1's typed
reference (adopted as G-07) to bytes kept verbatim in the cell's
content-addressed store. The object itself never enters a ledger payload.
The governance ledger's append parses and re-serializes, and was measured
folding two different integers into one digest and dropping a duplicate
member.

**8.2 A missing link is `not recorded`.** Not absent, not assumed
satisfied. Every field a future contract will add (scope, closure,
provenance) reports `not recorded` until it exists, so a reader can tell
a system that did not record something from a system that recorded
nothing happening.

## 9. Reuse, not reinvention

Build provenance and artifact identity are solved problems with adopted
standards, and inventing a competing one would produce evidence nobody
else can read. The artifact half of this section is **deferred** with
`deploy` (2.1, ST-07); the composition rules for source actions are in
the pilot slice.

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
  hqgit's facts), statecraft references it by spec 015 section 7.1's
  typed reference and re-derives nothing.

## 10. Runtime binding, replay and shadow policy

**10.1 A runtime binding is detached and does not assume a substrate.**
**Deferred** until the local slice and the pilot pass (ST-07); statecraft
remains its named owner. Binding a running instance to an artifact digest
is a separate record from the artifact's provenance, because the running
thing cannot contain an assertion about itself. It carries an epoch so
that a restart is distinguishable from a redeploy, and it must work for
an application that does not run Rahi, does not run in our cluster, and
reports nothing. For such an application the binding is `unknown`, which
is a legitimate state and not a degraded `pass`.

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
these are those five plus what the sections above require. N-15 to N-17
were added on 2026-09-12 from G-06 and G-08. Rows marked *deferred*
belong to a deferred section (2.1) and are not pilot-slice tests.

| # | Case | Required behavior |
|---|---|---|
| N-1 | a permit for a different subject or tenant than the caller | refused at effect time; the effect does not happen |
| N-2 | a candidate that weakens ownership, the constitution, a waiver rule or a verification block | classified under the base's policy, refused without a prior-policy approval |
| N-3 | a permit or evidence signed by a key absent from the supplied root set, and one by a key it revokes | `issuerTrust: unknown` for the first, `fail` for the second; a policy requiring a trusted issuer refuses both |
| N-4 | an expired permit | refused at effect time even though it was valid at issue |
| N-5 | a replayed permit (nonce or `maxUses` exhausted) | refused; the reservation is not double-spent |
| N-6 | required evidence missing | refused, and the refusal names which evidence |
| N-7 | a `deploy` naming a tag rather than a digest (*deferred*) | refused at issue |
| N-8 | a stale fence at effect time | refused; another run holds the lease |
| N-9 | an external call whose response is lost | reconciled by reading, never retried blindly, never recorded as failed |
| N-10 | an approval by the requester where the policy names a second party | does not count toward the requirement |
| N-11 | the plane restored from its backup | every chain is preserved: original bytes, original digests, original verifiers |
| N-12 | a foreign evidence object sent through a canonicalizing ledger append instead of by typed reference | refused before the append; no digest is recorded for re-serialized bytes |
| N-13 | a request to anchor or sign the legacy chain after the fact | refused; its records keep `issuerTrust: unknown` |
| N-14 | a trust root, or an issuer enrolment, carried inside a bundle or candidate | ignored as a root; `issuerTrust` unchanged; the attempt recorded |
| N-15 | evidence signed by the platform issuer before its enrolment's `notBefore`, or after its revocation | `issuerTrust: fail`; evaluated against the enrolment set valid at the evidence's time, not today's |
| N-16 | a rotation record not signed by the offline root | ignored; the prior enrolment set stays in force |
| N-17 | a local user's root presented to the hosted plane, or the platform root to a local verifier | not an eligible root across that line; `issuerTrust: unknown` |

## 12. Acceptance

For the pilot slice, unless an item names a deferred section.

1. N-1 to N-17 are tests that fail if the behavior changes, except N-7,
   which waits with `deploy`.
2. One hosted broker action, end to end, rejects N-1, N-2, N-3, N-4 and
   N-6, which is the packet's exit criterion stated as a single run.
3. A permit's evaluation is a pure function of `(permit, policy, time,
   usage, fence, evidence)`, with time and usage passed in, and a test
   reproduces a past decision by replaying its inputs.
4. Intent, outcome and reconciled are three durable records, and a test
   kills the process between intent and outcome and shows the reconciler
   reaching the right answer by reading.
5. A restore of the pilot cell preserves every chain: the same digests
   verify, with the same verifiers, over the original bytes.
6. No permit is issued, and no effect is authorized, by anything a
   candidate or a payload contains. A test asserts the trust root cannot
   be set from inside a bundle.
7. The issuer's enrolment, rotation and revocation are exercised (N-15 to
   N-17) before any admission under a policy that requires a trusted
   issuer.
8. `spec-spine verify 016` is green.

## 13. Cross-repo dependency

- **spec-spine**: draft 087 (AuthoritySnapshot) and draft 088
  (classification under the base's rules) must be approved before
  `authorityRef` and section 6.1 are more than references to proposals.
  Status 2026-09-12: both are committed as drafts (spec-spine PR #179),
  087's D3 (framed digest or the legacy `specAttestationHash`) is open,
  and no installed binary carries either. Revision 4 did not certify a
  current release, so this spec asserts none.
- **statecraft-cli**: receipt version 1's fixtures (its draft 132), with
  the verdict's concrete version and serialization frozen there (G-05);
  the permit schemas and pure evaluator in its workspace (G-04); and
  agreement that the action permit lives here (its doc 04 D52 and doc 05
  D71 already state it). statecraft adopted the verdict contract on
  2026-09-12; 132 encodes it.
- **statecrafting**: none blocking. Its 009 F-3 is answered in 014
  section 10.3, and this spec puts no foreign object in a ledger payload.
  The archive of section 5.4 preserves governance-native 0.1.0 as the
  published binary that ran, which a source tag alone does not reproduce.
- **Rahi**: the pilot cell (spec 017 Part A) for the service, and no
  second durable store, so the issuer's chain is built in the cell's own
  store. Section 10.1 deliberately does not assume the deployed
  application is a cell.

## 14. Out of scope

- **The root key ceremony itself.** Section 5.3 fixes the design (G-08).
  Generating the offline root and publishing its fingerprint are owner
  operations, recorded as the bootstrap of section 6.4, not code.
- **The neutral verifier's implementation.** It lives in statecraft-cli's
  Apache-2.0 workspace (G-04); this repository is AGPL-3.0 and cannot
  host a permissive verifier.
- **Defining an SBOM or build-description format.** Section 9.
- **Spec-fitness, pressure, CVE and compliance analytics.** Deferred
  until linked data and a customer need justify them. Evidence coverage
  is not certification, correlation is not causality, and no cross-tenant
  learning dataset is created from tenant evidence.
- **Billing and entitlement enforcement through permits.** A permit is
  not a licence check, and commercial terms wait until before external
  customer enrolment (spec 014 section 11, ST-05).
