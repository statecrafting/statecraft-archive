---
id: "015-hosted-work-contract"
title: "The hosted work contract: runners, jobs, leases and evidence intake"
status: approved
created: "2026-09-11"
implementation: pending
depends_on:
  - "004-tenants-github-app"
  - "008-governance-attestation"
  - "014-rahi-realignment"
establishes:
  - { kind: directory, path: "specs/015-hosted-work-contract/" }
summary: >
  The wire contract between the control plane and a runner, approved on
  2026-09-12 as the schema and pure-evaluator slice (spec 014 section 11,
  ST-06). It fixes how a runner is enrolled and authenticated (an enrolled
  person's device-grant session), how a project and a job are identified,
  how a job binds to an exact revision and an exact policy, how a lease
  and its fencing token keep one writer on a duration and heartbeat
  interval the plane returns, how cancellation, replay and idempotency
  behave, and how evidence is judged: four dimensions with their own value
  domains, admission kept separate, trust only from independently supplied
  roots, and original bytes behind typed references. The schemas, fixtures
  and pure evaluator are published in statecraft-cli's Apache-2.0
  workspace before either end is built; statecraft owns their semantics
  and pins them by digest. The hosted service that serves this contract is
  spec 018, and the authorization of an external effect is spec 016.
---

# 015: The hosted work contract

Link a compilation unit to this spec via `[package.metadata.spec-spine].spec`
in its manifest, a `// Spec:` header, or the edges above.

## 1. Purpose

statecraft-cli supervises agent runs on a developer's own machine,
account-free and loopback-only. It produces candidates, gates them, mints
an `acceptance.receipt` and publishes through a local broker. All of that
works today, and none of it involves this control plane.

What does not exist anywhere is the seam: how that local execution
reaches a team. A second person cannot see the run, approve it, or rely
on its evidence. statecraft-cli's doc 05 D71 states plainly that this seam
is statecraft's to lead and that it will not draft both ends. spec-spine's
design note 04 (S1 to S4) states the same from its side. This spec is that
half.

It is deliberately the **smaller** half. Nothing here authorizes an
external effect: that is spec 016. Nothing here computes authority: that
is spec-spine. Nothing here enforces what a candidate may write: that is
the executor's fence and sandbox, in statecraft-cli. This spec admits
work, keeps exactly one writer per job, and judges evidence honestly.

### 1.1 What the approval covers

Approved 2026-09-12 (spec 014 section 11, rows ST-06 and G-04) as the
**schema and pure-evaluator slice**: sections 3 to 11 as a wire contract,
the JSON schemas and fixtures that encode it, and a pure evaluator for the
evidence verdict, admission and the lease state machine. All of it is
published in statecraft-cli's Apache-2.0 workspace, where statecraft owns
the semantics and contributes no AGPL code.

Not covered: the hosted service that serves the contract. It was split
into spec 018 the same day, so that this slice is not blocked by spec
017's pilot cell, and 018 is approvable only for the N=1 pilot after its
prerequisites. The same approval wrote the adopted rows into this
contract: G-09 into section 4, G-10 into sections 3, 6 and 8, and G-05 to
G-07 into section 7.

## 2. Territory

This spec claims `specs/015-hosted-work-contract/` in this repository and
nothing else here. The work it orders lands elsewhere, and is claimed
there:

- **The wire schemas, worked and refused examples, the fixture manifest
  and the pure evaluator** live in statecraft-cli's Apache-2.0 workspace,
  beside its draft 132 (G-04). statecraft authors their semantics in this
  spec and reviews them there.
- **The pin.** When a manifest version is adopted, its digest is recorded
  in this spec's directory, in the change that adopts it.
- **The service, its byte store and its run views** are spec 018, built in
  spec 017 Part A's pilot cell.

History, kept because it explains the shape: the first version (2026-09-11)
put a new Encore.ts service in `backend/work/`. That would have been an
interim hosted engine on the EnRaHiTu plane, which the realignment's
sequencing avoids, and it put the schemas in an AGPL-3.0 tree that an
Apache-2.0 runner cannot embed.

## 3. What this contract refuses to do

Stated first, because each refusal is a requirement and each has a
sibling repository asking for it.

- **The plane never executes a spec's declared verification** (G-10). Not
  `## Verification` blocks, not a gate command, not anything a bundle
  carries. It accepts envelopes and payloads produced by a worker and
  recorded under a named tool version. This is spec-spine's S1, and it is
  a refusal in code (an intake that finds an executable plan records it
  as data and never runs it), not a convention.
- **The plane never accepts a bundle's own anchor as a trust root.** A
  chain that verifies internally from a root it selected for itself is
  internally consistent and nothing more. Issuer trust is a separate
  outcome, answered only from roots supplied independently of the
  evidence (section 7.2), and `unknown` is a legitimate answer.
- **Signature validity is never evidence that work happened.** A signed
  report from customer-controlled execution proves who signed it. It does
  not prove a test ran. Section 7.3 makes this a typed distinction rather
  than a warning in prose.
- **The plane holds no runner's credentials for a third party.** It
  issues its own, audience-bound; it never stores a customer's GitHub
  token, model key or SSH material, and an intake that finds one in a
  payload refuses the payload rather than storing it redacted.
- **Tenant authorization is the plane's.** Which tenant a caller may reach
  is decided by the plane on every call, never by the chassis, a runner or
  a payload (ST-06).
- **Local, account-free operation stays.** Nothing in this contract
  becomes required for statecraft-cli to work on a laptop. Registering
  with a plane is an addition, and a run that never registers is a
  complete run.

## 4. Runner enrolment and authentication

**4.1 Enrolment is a two-step exchange.** A tenant admin, authenticated
in the UI, mints a single-use enrolment code scoped to
`{tenant, projects, expiry}`. The runner presents the code once, with an
authenticated session (4.2), and a runner record is created. The code is
consumed on first use, whatever the outcome, so a replayed code is
refused rather than creating a second record.

**4.2 Authentication and authorization are separate records.** Adopted
2026-09-12 (G-09). A first-slice runner authenticates as an enrolled
person: an access token the platform IdP issued to that person through a
public native client using the device grant (Rahi draft 038),
audience-bound to the plane's resource URL and checked in Rahi spec 025's
resource-server shape (RS256, `aud`, a maximum lifetime, a `jti`
deny-list). It is authorized by the runner record the enrolment created,
bound to that person's `sub` and the tenant. The token says who is
calling; only the runner record and a lease say what the caller may do. A
customer runner holds no OAuth client secret, and there is no second
credential type.

**4.3 Renewal never touches a lease.** A lease binds to `runnerId`, the
tenant and the principal's `sub`, never to one access token or its `jti`,
so a renewed token continues a job, and a token for a different principal
does not (N-20). Renewal is the device grant's refresh token, held per
plane, issuer and audience as statecraft-cli's D72 plans, in protected
local storage. Expiry is read from each token response's `expires_in` and
never assumed: no constant credential lifetime appears in this contract,
in a runner, or in a fixture (G-10, N-21). A runner that cannot renew
fails its job cleanly, by reporting a terminal state or by letting its
lease expire so the job is released (6.4). It never stops silently.

**4.4 A runner is a record, not a machine.** The plane stores
`{runnerId, tenantId, label, class, principalSub, enrolledBy, lastSeenAt,
revokedAt}`. It never stores a token. `class` is one of
`customer-controlled`, `registered-runner` or `platform-managed`, and it
is assigned at enrolment by who minted the code and where the runner
runs, never self-declared by the runner. The first slice admits
`customer-controlled` only.

**4.5 Revocation is immediate and observable.** A revoked runner's next
call fails with a typed refusal that says `revoked`, and its live jobs
are marked `orphaned` rather than `failed`: the plane does not know
whether the work happened, and saying so is more useful than guessing.

**4.6 Unattended runners are deferred.** A runner with no person behind
it needs a non-human principal with its own enrolment and revocation
contract. That contract is a later spec, and nothing in this slice
anticipates its shape (G-09).

## 5. Project and job identity

**5.1 A project binds a repository to a tenant.** `{projectId, tenantId,
installationId, repoOwner, repoName, defaultBranch, policyRef}`. The
plane verifies at registration that the tenant's GitHub App installation
covers the repository, and re-verifies on use: an installation that has
been uninstalled makes every job on its projects unadmittable.

**5.2 A job names exactly what it is about.** `{jobId, projectId,
runnerId, kind, baseCommit, specRef?, permitRef, policyDigest,
authorityRef?, createdBy, createdAt}`.

- `baseCommit` is a full commit id with its object format (5.3), never a
  branch name. A branch is a moving ref and a job that names one cannot be
  verified afterwards.
- `policyDigest` is the digest of the policy the job is evaluated under,
  taken from the **base** revision, so a candidate cannot reclassify its
  own change by editing policy. This is spec-spine's S3 and the reason
  088's classification is computed under the base's rules.
- `authorityRef` is the AuthoritySnapshot the job was admitted against,
  when spec-spine 087 provides one. Until then the field is present and
  `null`, and every claim that depends on it reports `not recorded`
  rather than being quietly omitted.
- `permitRef` points at the WorkPermit (spec 016) that authorized the
  job. A job with no permit is admissible only in `dry-run` kind, which
  can produce evidence and can authorize no effect.

**5.3 Every digest is stored with its subject.** A git subject is
`{repo, commit: {format, id}, tree: {format, id} | null}`, where `format`
is the object format (`sha1` or `sha256`) of that id (G-07). It sits
beside every spec-spine digest (spec-spine's S2). A digest with no
subject cannot be checked later, and a subject whose tree is unavailable
makes any recompute `unknown`, never `pass`.

## 6. Leases, fencing, heartbeat and cancellation

Adopted 2026-09-12 as the runner's pull, lease, fence, cancel and
idempotency contract (G-10). The plane never pushes; a runner behind a
NAT with no inbound path is a first-class case.

**6.1 One writer per job, enforced by a fence.** Taking a job issues a
lease `{jobId, runnerId, tenantId, principalSub, fenceToken,
leaseDurationSeconds, heartbeatIntervalSeconds, leaseExpiresAt}`. The
duration and the heartbeat interval are chosen by the plane for that
lease and returned with it; a runner uses what it was given and assumes
no constant. `fenceToken` is the plane's own per-job counter: it
increases on every takeover and never on renewal. Every mutating call on
a job carries its fence token, and the plane refuses any token lower than
the current one, which is what makes a resumed older process harmless.

**6.2 A heartbeat renews the lease and carries the desired state back.**
The runner heartbeats on the lease's interval; the response carries the
new `leaseExpiresAt` and the plane's desired state for the job
(`continue`, `cancel`).

**6.3 Cancellation is cooperative and reconciled, never assumed.**
Setting `cancel` records an intent. The job leaves `cancelling` only when
the runner reports a terminal state or the lease expires. A lease that
expires in `cancelling` moves the job to `abandoned`, which is a distinct
state from `cancelled`: the first means nobody told us, the second means
the runner confirmed. Neither is `failed`.

**6.4 Lease expiry does not fail the job.** It releases it. Another
runner may take it with a higher fence token, and the previous runner's
next call is refused with the current fence in the refusal so it can stop
cleanly rather than retrying.

## 7. Evidence intake

**7.1 Original bytes, typed references.** Adopted 2026-09-12 (G-07). An
`acceptance.receipt` (statecraft-cli's schema version 1) and, optionally,
the journal bundle it came from. statecraft writes no parser for either
until statecraft-cli's fixture set (its draft 132) exists, including the
negative set; the fixtures are the definition.

Every accepted object is kept as its exact submitted bytes, addressed by
SHA-256 over those bytes, in an immutable content-addressed store (018
provides it: an app table the cell's backup covers). Evidence rows and
ledgers hold only a typed reference to it:

```
{ type, schemaVersion,
  digestAlg: "sha-256", byteDigest, byteLength,
  producerDigest: { construction, value } | null,
  container: { byteDigest, selector } | null,
  subject: { repo, commit: { format, id }, tree: { format, id } | null } | null }
```

- `byteDigest` is always over the exact bytes. A producer's canonical
  record hash goes in `producerDigest` with its construction named, and
  never stands in for a byte digest.
- The construction is part of the reference's identity: two references
  with equal values under different constructions are different
  references.
- `container` addresses a record embedded in a larger object: the
  container's byte digest and a selector within it.
- Members are hex strings, ASCII names, `null` and integers inside the
  portable range, so a reference itself survives any conforming JSON
  reader. A reader that does not know `digestAlg` or a `construction`
  refuses the reference.

No submitted object passes through the governance ledger's canonicalizing
append, which was measured to give two different integers one digest and
to drop a duplicate member silently (spec 014 section 10.3). Intake
refuses, as `integrity: fail` with reason `ambiguous-json`, what a
producer's construction cannot bind unambiguously: a duplicate member at
any depth, a number outside the producer's declared range, invalid UTF-8,
a byte-order mark. A refused object is recorded by digest and reason and
its bytes are not kept.

**7.2 Four evidence dimensions, each with its own values, and admission
separately.** Adopted 2026-09-12 (G-05, G-06). Each upload is evaluated on
four dimensions. No two dimensions share a value domain, and every value
other than `pass` carries a reason code from a closed, versioned list:

| Dimension | Values | Question | `fail` when | `unknown` when | Its own extra value |
|---|---|---|---|---|---|
| `integrity` | `pass`, `fail`, `unknown` | do the kept bytes recompute under the producer's declared construction, links and digests included? | a mismatch; ambiguous input (7.1) | the construction or MAJOR version is unsupported; content is withheld or redacted; the check was not performed | none |
| `signature` | `pass`, `fail`, `unsigned`, `unknown` | does a signature present over the bytes verify? | a signature is present and invalid | the algorithm or format is unsupported; the check was not performed | `unsigned`: no signature is present |
| `issuerTrust` | `pass`, `fail`, `unknown` | is the signing key eligible under a root set supplied independently of the evidence, at the evidence's time? | the key is positively revoked, or excluded by the root set | `signature` is not `pass`; the key is absent from the root set; no root set was supplied | none |
| `subjectBinding` | `pass`, `fail`, `unknown`, `not-applicable` | does the evidence name exactly the subject the job named? | it names another subject, or the same id under another object format | the expected subject is missing from the evidence; its tree is unavailable | `not-applicable`: the record type has no subject |

The rules that keep the table honest:

1. `issuerTrust` is `pass` only after `signature` is `pass` against a key
   eligible under the supplied root set. The root set and the evaluation
   time are inputs to the evaluator, never read from the evidence.
2. A self-anchored chain has no root outside itself, so it cannot satisfy
   a policy that requires a trusted issuer, however well it verifies.
3. A signed observation about another evidence object never changes that
   object's dimensions.
4. `unknown`, `unsigned` and `not-applicable` never satisfy a requirement
   that names the dimension.
5. No boolean summarizes the four, and no view invents one.

Today every upload is `signature: unsigned` and `issuerTrust: unknown`,
and saying so is the point.

**Admission is not a dimension.** It is `{decision: admit | refuse,
policyDigest, reasons[]}`, evaluated under the job's `policyDigest` over
the four dimensions, the runner's class (7.3) and the producer's claims.
An `admit` whose inputs include a value other than `pass` names the policy
clause that accepts it. Required evidence that is incomplete refuses
admission with a reason (7.4).

**Producer claims are not dimensions.** What a payload asserts (a
receipt's `passing`, a spec-spine snapshot's recompute and freshness) is
reported as `claims[]`, keyed by producer type, and never feeds a
dimension, so a producer's claim stays distinguishable from a fact the
plane checked.

**The verdict keeps its provenance.** Beside the dimensions, admission
and claims, a verdict records the verifier's identity and version, the
identity of the root set it used (or `null`), its coverage (what it
checked, and what it could not, such as withheld content), and its stop
reasons (G-06). The concrete version and serialization of this verdict
are frozen by statecraft-cli's 132, not here (G-05).

**7.3 Trust classes are a property of the runner, not the payload.** A
`customer-controlled` runner's evidence can be cryptographically perfect
and still carry no weight for a high-risk delivery, because the same
party controls the execution and the signature. The three classes from
4.4 are carried onto every evidence row, and a policy may require a
class. A runner cannot raise its own class, and a payload cannot raise
it either.

**7.4 Incomplete and unknown are outcomes.** A receipt that omits a field
the policy requires is refused at admission with reason `incomplete`; no
dimension becomes `fail` because of it. A check the verifier did not
perform is `unknown`, and a verifier that stops early records the stop
and leaves every later dimension `unknown` (N-23). A recompute against a
tool version the plane does not have is `unknown`. A bundle whose issuer
is trusted but whose subject tree is unavailable is `subjectBinding:
unknown`, never `pass`. A result that cannot be established never becomes
a positive one by default.

**7.5 Runtime assertions carry their population.** If an upload asserts
anything about a running system (coverage, error rate, latency), it
carries the measurement population, units, window, sampling method and
freshness. Missing any of those, the assertion establishes nothing and is
recorded as `unknown`; it does not become a weaker `pass`. Correlation
in such data is never recorded as causality, and evidence coverage is
never recorded as certification.

**7.6 Nothing is executed and nothing is trusted from inside.** Restated
here because intake is where the temptation lives: a verification plan
inside a payload is data, an anchor inside a bundle is not a trust root,
and a payload naming a key the plane holds does not thereby authorize
itself.

## 8. Replay, idempotency and reconnection

**8.1 Every mutating call is idempotent on a key the caller supplies.**
`Idempotency-Key` per call, scoped to the job. A repeat returns the first
outcome unchanged, including the first outcome's failure. A repeat with
the same key and a different body is a refusal, not an overwrite.

**8.2 Evidence upload is idempotent on exact bytes.** The same byte
digest uploaded twice against the same job produces one evidence row and
returns the first evaluation. The same bytes against a *different* job
are a separate row with their own subject binding, which may differ. A
byte-different upload whose producer digest, under the same construction,
equals an existing row's (a reformatted copy) is its own row and names
the earlier one, so the copy is visible rather than silently merged.

**8.3 Reconnection is a fence check.** A runner that reconnects
mid-job presents `{jobId, fenceToken}`. Equal to current: it resumes.
Lower: it is refused and told the current value. Absent: it is treated as
a new taker and gets a new token only if the lease is free.

**8.4 Retries reconcile, never repeat.** Any call that may have had an
effect is reconciled before it is retried: the plane reads the current
state and decides, rather than assuming a failed response means nothing
happened. This is the same rule 016 applies to external effects, and it
is stated in both because the failure mode is the same.

## 9. One authority per mutable transition

Review's first job on this contract is to find a row with two owners.
Tenant authorization sits under every row: the plane decides which tenant
a caller may reach (section 3).

| Transition | Authority | Evidence it leaves |
|---|---|---|
| runner enrolled | tenant admin, through the plane | runner row, `enrolledBy` |
| runner revoked | tenant admin or platform operator | `revokedAt`, live jobs to `orphaned` |
| project registered | tenant admin, checked against the installation | project row |
| job created | the plane, on a valid permit (016) | job row, `permitRef` |
| job taken | the plane (issues the fence, the duration and the interval) | lease, `fenceToken` |
| job progress reported | the runner holding the current fence | heartbeat |
| job cancelled (intent) | tenant admin or platform operator | `cancelling` |
| job terminal (`succeeded`, `failed`, `cancelled`) | the runner holding the current fence | terminal report |
| job terminal (`abandoned`, `orphaned`) | the plane, on lease expiry or revocation | lease expiry |
| evidence accepted | the plane | kept bytes, and an evidence row with four dimensions |
| evidence admitted or refused | the plane, under the job's `policyDigest` | admission result |
| an external effect | **not here**: spec 016 | |

## 10. The schemas are published first

The artifact this contract produces before either end is implemented is a
versioned JSON Schema per payload, each with at least one worked example
and one refused example, in statecraft-cli's Apache-2.0 workspace
(section 2), together with the fixture manifest of section 12 and the
pure evaluator. Versioning follows the family's rule: an unknown MAJOR is
`integrity: unknown` with a reason naming the version, which is neither
`pass` nor `fail`; unknown members are refused, not ignored; every emitted
document has sorted keys. A new hash construction is a new, named
version, and records made under an old one are never silently repaired.

The order is deliberate. statecraft-cli has stated it will not draft both
ends; if statecraft implements before publishing, the CLI implements
against a moving target and the two drift in the exact place a fence
exists to prevent drift.

## 11. Negative cases

These are the acceptance tests, not examples. Eight come from
statecraft-cli's doc 05 section 14; N-9 is this contract's addition, and
spec 014 C-1 records it as such. N-10 to N-15 were added on 2026-09-12:
the first three from the byte measurements in spec 014 section 10.3, the
rest so that cancellation, retry and enrolment replay each have a refusal
to show. N-16 to N-23 were added the same day from the adopted rows G-05
to G-10. Each is a shared fixture or a fake-clock test of the pure
evaluator (G-10), and spec 018 runs the same set against the service.

| # | Case | Required behavior |
|---|---|---|
| N-1 | credential whose `aud` is not the plane's resource URL | refused; no job state changes |
| N-2 | credential valid but for another tenant | refused as not found, never as forbidden; existence is not leaked |
| N-3 | the same evidence bytes uploaded twice | one row, first result returned, no second evaluation |
| N-4 | a call carrying an expired or superseded fence token | refused with the current fence named |
| N-5 | a runner reconnecting mid-job | resumes on an equal fence, refused on a lower one |
| N-6 | a candidate sha that does not match the job's `baseCommit` lineage | refused; the job does not move |
| N-7 | a receipt for a revision the job did not name | accepted as a row, `subjectBinding: fail`, admission refuses |
| N-8 | an unsigned bundle that verifies from its own anchor | `integrity: pass`, `signature: unsigned`, `issuerTrust: unknown`; refused by any policy that requires a trusted issuer |
| N-9 | issuer trusted, subject tree unavailable | `subjectBinding: unknown`; never `pass` |
| N-10 | a duplicate member placed before the real one (which statecraft-cli's own verifier accepts), after it, or at depth | `integrity: fail` (`ambiguous-json`), admission refuses, bytes not kept |
| N-11 | an integer outside the producer's declared range, or a numeric spelling the construction cannot bind | `integrity: fail`; never normalized to a nearby value |
| N-12 | a whitespace or key-order variant of an already accepted bundle | a separate row naming the earlier one; both kept byte-for-byte; neither re-serialized to compare |
| N-13 | cancellation requested, the runner never confirms, the lease expires | `abandoned`, never `cancelled` or `failed`; a later terminal report on the old fence is refused |
| N-14 | a job take whose response was lost, retried | the same lease and fence returned; no second lease issued |
| N-15 | an enrolment code presented a second time | refused; no second runner record |
| N-16 | a call on a lease whose returned duration elapsed with no heartbeat | refused with the current state; the job is released and the next taker's fence is higher |
| N-17 | a signature by a key the supplied root set positively revokes, and one by a key the root set does not contain | `issuerTrust: fail` for the first, `unknown` for the second; a trusted-issuer policy admits neither |
| N-18 | a record type with no subject, and a receipt missing the subject its job expected | `subjectBinding: not-applicable` for the first, `unknown` for the second |
| N-19 | a subject naming the job's commit id under the other object format | `subjectBinding: fail` |
| N-20 | a renewed token for a different principal presented on a live lease | refused; the lease and its fence do not move |
| N-21 | token responses whose `expires_in` values differ from each other and from any familiar lifetime | the runner renews on the value it was given; a fake-clock test shows no constant lifetime assumed |
| N-22 | a signed evidence object that asserts another object's verdict | the other object's dimensions are unchanged |
| N-23 | a verifier that stops early (a truncated bundle, say) | the stop and its reason are recorded; every later dimension is `unknown`, never `pass` |

## 12. Acceptance

For the approved slice. The service's acceptance is spec 018's.

1. **Two policy-specific fixtures come first.** In one fixture manifest
   in statecraft-cli's workspace: one fixture admitted under an explicit
   local policy that allows unsigned evidence, and one refused under a
   policy that requires a trusted signature. Each reports its four
   dimensions, its admission result, reason codes a reader can follow,
   the verifier's identity and the root set's identity. Neither implies
   that unsigned evidence is trusted.
2. **The full matrix follows.** The manifest covers payload tampering,
   truncation, self-anchoring, duplicate members in both positions and
   at depth, an unsupported format or algorithm, large integers and
   numeric spellings, invalid encoding, whitespace and key-order changes,
   original-byte identity against canonical-record identity, a mutated
   `payloadHash` on a withheld record, a wrong subject or object format,
   absent and revoked roots, early verifier stops, and JSON type parity.
   The version-1 compatibility view is kept, and no policy that requires
   a bound payload commitment admits withheld content.
3. **One manifest, two verifiers.** statecraft-cli's TypeScript and Rust
   verifiers read the same manifest and agree on every fixture.
4. **The schemas hold.** Every worked example validates and every refused
   example is refused, in statecraft-cli's CI, and statecraft records the
   adopted manifest's digest in this spec's directory.
5. **N-1 to N-23 exist** as fixtures or fake-clock tests of the pure
   evaluator, and each fails if the behavior changes.
6. **The evaluator is pure.** Verdict, admission and the lease state
   machine are functions of their inputs (bytes, reference, job, policy,
   root set, time, prior lease state): no clock, network, filesystem or
   process of their own. A test replays a recorded evaluation to
   byte-identical output.
7. **One authority per transition.** The lease state machine admits each
   transition of section 9 from exactly the authority that table names.

## 13. Cross-repo dependency

- **statecraft-cli 132.** The receipt and bundle fixtures, including the
  negative set, as the definition of receipt version 1 and bundle version
  1 (section 7.1), and the frozen version and serialization of the
  verdict (G-05). Status 2026-09-12: 132 is a merged draft with no fixture
  files. Nothing in this slice is parsed before those bytes exist.
- **statecraft-cli C-4** (whether a hosted runner is the engine binary of
  its draft 130). Moot for this slice, where every runner is a person's
  statecraft-cli session (4.2); it reopens with the non-human runners of
  4.6.
- **spec-spine 087.** Until an AuthoritySnapshot exists, `authorityRef` is
  present and `null` (5.2). Not a blocker.
- **statecrafting's draft 010** offers portable-input vectors that N-10
  and N-11 can reuse. An input, not a dependency.

Rahi R-1 (bearer renewal) and Rahi's pilot prerequisites are the
service's dependencies, and moved to spec 018 with it. The contract, its
fixtures and its evaluator need neither a running cell nor a real device
login (G-10).

## 14. Out of scope

- **The hosted service.** Spec 018: the plane's endpoints, its durable
  leases and idempotency keys, its byte store, its run views.
- **Authorizing any external effect.** Spec 016.
- **Computing authority.** spec-spine owns snapshots, deltas, closures
  and scopes; this contract stores references to them.
- **Enforcing what a candidate may write.** The executor's fence and
  sandbox, in statecraft-cli.
- **Entitlements, metering and retention commitments.** Deferred until
  before external customer enrolment (spec 014 section 11, ST-05). The
  records here are designed so metering can read them.
- **Unattended runners.** Section 4.6.
- **Multi-region, queueing policy, or fair scheduling.** One tenant, one
  runner, one job at a time is sufficient to prove the contract.
