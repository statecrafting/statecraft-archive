---
id: "015-hosted-work-contract"
title: "The hosted work contract: runners, jobs, leases and evidence intake"
status: draft
created: "2026-09-11"
implementation: pending
depends_on:
  - "004-tenants-github-app"
  - "008-governance-attestation"
  - "014-rahi-realignment"
  - "017-rahi-cell-migration"
establishes:
  - { kind: directory, path: "specs/015-hosted-work-contract/" }
summary: >
  The wire contract between the control plane and a runner: how a runner
  is enrolled and authenticated, how a project and a job are identified,
  how a job binds to an exact revision and an exact policy, how a lease
  and its fencing token keep one writer, how heartbeat and cancellation
  work, what evidence the plane accepts and what it refuses to do with
  it, and how replay, idempotency and reconnection behave. One authority
  is named for every mutable transition. The schemas and their examples
  are published before either end is implemented, because two
  implementations of an unwritten contract drift. This spec covers the
  admission of work only; the authorization of an external effect is
  spec 016.
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
on its evidence, and a statecraft-hosted worker cannot do the work on
behalf of a tenant at all. statecraft-cli's doc 05 D71 states plainly
that this seam is statecraft's to lead and that it will not draft both
ends. spec-spine's design note 04 (S1 to S4) states the same from its
side. This spec is that half.

It is deliberately the **smaller** half. Nothing here authorizes an
external effect: that is spec 016. Nothing here computes authority: that
is spec-spine. Nothing here enforces what a candidate may write: that is
the executor's fence and sandbox, in statecraft-cli. This spec admits
work, keeps exactly one writer per job, and accepts evidence honestly.

## 2. Territory

Planned. A draft's territory is a declaration of intent, not a claim on
existing code (spec-spine spec 076); the places below are named so review
can judge the shape, and the spec claims files for real in the change
that writes them.

Revised 2026-09-12 (014 section 10.1). The first version put a new
Encore.ts service in `backend/work/`. That would be an interim hosted
engine on the EnRaHiTu plane, which the realignment's sequencing avoids,
and it put the schemas in an AGPL-3.0 tree that an Apache-2.0 runner
cannot embed.

- **The wire schemas, examples and fixtures** are published in
  statecraft-cli's Apache-2.0 workspace, beside its draft 132. statecraft
  authors their semantics in this spec, reviews them there, pins them by
  digest here, and contributes no AGPL code to that workspace.
- **The service** (runners, projects, jobs, leases, evidence intake) is
  built in the Rahi pilot cell of spec 017 Part A, not in `backend/`.
- **The UI**: a run list and a run detail view, reusing `frontend/`
  components behind the pilot's adapter.

The service reads tenant, installation and membership semantics through
017's domain port and adds no table to `tenants/` or `governance/`.

## 3. What this spec refuses to do

Stated first, because each refusal is a requirement and each has a
sibling repository asking for it.

- **The plane never executes a spec's declared verification.** Not
  `## Verification` blocks, not a gate command, not anything a bundle
  carries. It accepts envelopes and payloads produced by a worker and
  recorded under a named tool version. This is spec-spine's S1, and it is
  a refusal in code (an intake that finds an executable plan records it
  as data and never runs it), not a convention.
- **The plane never accepts a bundle's own anchor as a trust root.** A
  chain that verifies internally from a root it selected for itself is
  internally consistent and nothing more. Issuer trust is a separate
  outcome with its own answer, and `unknown` is a legitimate one.
- **Signature validity is never evidence that work happened.** A signed
  report from customer-controlled execution proves who signed it. It does
  not prove a test ran. Section 7.3 makes this a typed distinction rather
  than a warning in prose.
- **The plane holds no runner's credentials for a third party.** It
  issues its own, audience-bound; it never stores a customer's GitHub
  token, model key or SSH material, and an intake that finds one in a
  payload refuses the payload rather than storing it redacted.
- **Local, account-free operation stays.** Nothing in this spec becomes
  required for statecraft-cli to work on a laptop. Registering with a
  plane is an addition, and a run that never registers is a complete run.

## 4. Runner enrolment and authentication

**4.1 Enrolment is a two-step exchange.** A tenant admin, authenticated
in the UI, mints a single-use enrolment code scoped to
`{tenant, projects, expiry}`. The runner presents the code once, with an
authenticated session (4.2), and a runner record is created. The code is
consumed on first use, whatever the outcome, so a replayed code is
refused rather than creating a second record.

**4.2 Authentication and authorization are separate records.** Proposed
as 014 D-4, and not settled until the owner answers it. The runner
authenticates with an access token the platform IdP issued to a person
through Rahi's native public client (rahi draft 038: device grant or
authorization code), audience-bound to the plane's resource URL and
checked in rahi spec 025's resource-server shape (RS256, `aud`, a maximum
lifetime, a `jti` deny-list). It is authorized by the runner record the
enrolment created, bound to that person's `sub` and the tenant. The token
says who is calling; only the runner record and a lease say what the
caller may do. There is no second credential type.

**4.3 Renewal never touches a lease.** Leases and fences bind to
`runnerId`, never to a token's `jti`, so a renewed token continues a job.
Rahi `main` has no bearer renewal, and draft 038 sets lifetimes without a
refresh rule. The proposed renewal is the device grant's refresh token,
held per plane, issuer and audience, as statecraft-cli's D72 already
plans. A runner that cannot renew fails its job cleanly (it reports a
terminal state, or its lease expires to `abandoned`), and never silently
stops. A runner with no person behind it needs a non-human principal that
Rahi does not define; that class is out of the first slice.

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

## 5. Project and job identity

**5.1 A project binds a repository to a tenant.** `{projectId, tenantId,
installationId, repoOwner, repoName, defaultBranch, policyRef}`. The
plane verifies at registration that the tenant's GitHub App installation
covers the repository, and re-verifies on use: an installation that has
been uninstalled makes every job on its projects unadmittable.

**5.2 A job names exactly what it is about.** `{jobId, projectId,
runnerId, kind, baseCommit, specRef?, permitRef, policyDigest,
authorityRef?, createdBy, createdAt}`.

- `baseCommit` is a full commit sha, never a branch name. A branch is a
  moving ref and a job that names one cannot be verified afterwards.
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

**5.3 Every digest is stored with its subject.** `{repo, commit, tree}`
beside every spec-spine digest (spec-spine's S2). A digest with no
subject cannot be checked later, and a subject whose tree is unavailable
makes any recompute `unknown`, never `pass`.

## 6. Leases, fencing, heartbeat and cancellation

**6.1 One writer per job, enforced by a fence.** Taking a job issues a
lease `{jobId, runnerId, fenceToken, leaseExpiresAt}` where `fenceToken`
is monotonically increasing per job. Every mutating call on a job carries
its fence token, and the plane refuses any token lower than the current
one. This is the same mechanism rahi's store uses for its ten-second
leases, and it is what makes a resumed older process harmless.

**6.2 A heartbeat renews the lease and carries the desired state back.**
The runner heartbeats on an interval; the response carries the plane's
desired state for the job (`continue`, `cancel`). The plane never pushes;
a runner behind a NAT with no inbound path is a first-class case.

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

**7.1 What is accepted, and what is kept.** An `acceptance.receipt`
(statecraft-cli's schema version 1) and, optionally, the journal bundle it
came from. statecraft writes no parser for either until statecraft-cli's
fixture set (its draft 132) exists, including the negative set; the
fixtures are the definition, and 014 C-2 requests them.

Every accepted object is kept as its exact submitted bytes, addressed by
SHA-256 over those bytes, and the evidence row and the ledger hold only a
typed reference to it (014 section 10.3, proposal D-3). No submitted
object passes through the governance ledger's canonicalizing append,
which was measured to give two different integers one digest and to drop
a duplicate member silently. Intake refuses what a producer's
construction cannot bind unambiguously: a duplicate member, a number
outside the producer's declared range, invalid UTF-8, a byte-order mark.

**7.2 Four evidence dimensions, and admission separately.** Revised
2026-09-12 as the proposed `statecraft.evidence-verdict` version 0 (014
section 10.2 records its cross-repository status). Each upload is
evaluated on four dimensions, each `pass`, `fail`, `unknown` or
`not-applicable`, and each non-`pass` value carries a reason code from a
closed, versioned list:

| Dimension | Question | `fail` | `unknown` | `not-applicable` |
|---|---|---|---|---|
| `integrity` | do the kept bytes recompute under the producer's declared construction, links and digests included? | a mismatch, or ambiguous input (7.1) | construction or MAJOR version unsupported; content withheld or redacted | never |
| `signature` | does a signature present over the bytes verify? | present and invalid | algorithm or format unsupported | no signature, reason `unsigned` |
| `issuerTrust` | is the signer a key enrolled from a root established out of band, valid at the evidence's time? | the key is revoked, expired or outside its enrolled scope | `signature` is not `pass`, the key is not enrolled, or the trust snapshot is unavailable | never |
| `subjectBinding` | does the evidence name exactly the `{repo, commit, tree}` this job named? | it names another subject | the subject tree is unavailable | no subject was asked about |

No boolean summarizes the four, no view invents one, and `unknown` or
`not-applicable` never satisfies a requirement that names the dimension.
Today every upload is `signature: not-applicable` (`unsigned`) and
`issuerTrust: unknown`, and saying so is the point.

**Admission is not a dimension.** It is `{decision: admit | refuse,
policyDigest, reasons[]}`, evaluated under the job's `policyDigest` over
the four dimensions, the runner's class (7.3) and the producer's claims.
An `admit` whose inputs include a non-`pass` dimension names the policy
clause that accepts it.

**Producer claims are not dimensions.** What a payload asserts (a
receipt's `passing`, a spec-spine snapshot's recompute and freshness) is
reported as `claims[]` in the same value domain, keyed by producer type,
and never feeds a dimension.

**7.3 Trust classes are a property of the runner, not the payload.** A
`customer-controlled` runner's evidence can be cryptographically perfect
and still carry no weight for a high-risk delivery, because the same
party controls the execution and the signature. The three classes from
4.4 are carried onto every evidence row, and a policy may require a
class. A runner cannot raise its own class, and a payload cannot raise
it either.

**7.4 Incomplete and unknown are outcomes.** A receipt that omits a field
the policy requires is refused at admission with reason `incomplete`; no
dimension becomes `fail` because of it. A recompute against a tool version
the plane does not have is `unknown`. A bundle whose issuer is trusted
but whose subject tree is unavailable is `subjectBinding: unknown`, never
`pass` (014 C-1's ninth case). A result that cannot be established never
becomes a positive one by default.

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
byte-different upload whose producer digest equals an existing row's (a
reformatted copy) is its own row and names the earlier one, so the copy
is visible rather than silently merged.

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

Review's first job on this spec is to find a row with two owners.

| Transition | Authority | Evidence it leaves |
|---|---|---|
| runner enrolled | tenant admin, through the plane | runner row, `enrolledBy` |
| runner revoked | tenant admin or platform operator | `revokedAt`, live jobs to `orphaned` |
| project registered | tenant admin, checked against the installation | project row |
| job created | the plane, on a valid permit (016) | job row, `permitRef` |
| job taken | the plane (issues the fence) | lease, `fenceToken` |
| job progress reported | the runner holding the current fence | heartbeat |
| job cancelled (intent) | tenant admin or platform operator | `cancelling` |
| job terminal (`succeeded`, `failed`, `cancelled`) | the runner holding the current fence | terminal report |
| job terminal (`abandoned`, `orphaned`) | the plane, on lease expiry or revocation | lease expiry |
| evidence accepted | the plane | kept bytes, and an evidence row with four dimensions |
| evidence admitted or refused | the plane, under the job's `policyDigest` | admission result |
| an external effect | **not here**: spec 016 | |

## 10. The schemas are published first

The artifact this spec produces before either end is implemented is a
versioned JSON Schema per payload, each with at least one worked example
and one refused example, published in statecraft-cli's Apache-2.0
workspace (section 2). Versioning follows
the family's rule: an unknown MAJOR is `unsupported`, which is neither
pass nor fail; unknown members are refused, not ignored; every emitted
document has sorted keys.

The order is deliberate. statecraft-cli has stated it will not draft both
ends; if statecraft implements before publishing, the CLI implements
against a moving target and the two drift in the exact place a fence
exists to prevent drift.

## 11. Negative cases

These are the acceptance tests, not examples. Eight come from
statecraft-cli's doc 05 section 14; the ninth is this spec's addition and
014 C-1 records it as such. N-10 to N-15 were added on 2026-09-12: the
first three from the byte measurements in 014 section 10.3, the rest so
that cancellation, retry and enrolment replay each have a refusal to
show.

| # | Case | Required behavior |
|---|---|---|
| N-1 | credential whose `aud` is not the plane's resource URL | refused; no job state changes |
| N-2 | credential valid but for another tenant | refused as not found, never as forbidden; existence is not leaked |
| N-3 | the same evidence bytes uploaded twice | one row, first result returned, no second evaluation |
| N-4 | a call carrying an expired or superseded fence token | refused with the current fence named |
| N-5 | a runner reconnecting mid-job | resumes on an equal fence, refused on a lower one |
| N-6 | a candidate sha that does not match the job's `baseCommit` lineage | refused; the job does not move |
| N-7 | a receipt for a revision the job did not name | accepted as a row, `subjectBinding: fail`, admission refuses |
| N-8 | an unsigned bundle that verifies from its own anchor | `integrity: pass`, `signature: not-applicable` (`unsigned`), `issuerTrust: unknown`; refused by any policy that requires a trusted issuer |
| N-9 | issuer trusted, subject tree unavailable | `subjectBinding: unknown`; never `pass` |
| N-10 | a bundle with a duplicate member placed before the real one, which statecraft-cli's own verifier accepts | `integrity: fail` (`ambiguous-json`), admission refuses, bytes not kept |
| N-11 | an integer outside the producer's declared range | `integrity: fail`; never normalized to a nearby value |
| N-12 | a whitespace or key-order variant of an already accepted bundle | a separate row naming the earlier one; both kept byte-for-byte; neither re-serialized to compare |
| N-13 | cancellation requested, the runner never confirms, the lease expires | `abandoned`, never `cancelled` or `failed`; a later terminal report on the old fence is refused |
| N-14 | a job take whose response was lost, retried | the same lease and fence returned; no second lease issued |
| N-15 | an enrolment code presented a second time | refused; no second runner record |

## 12. Acceptance

0. Before any service code: one statecraft-cli 132 fixture is admitted
   and one refused, each reporting its four dimensions, its admission
   result and reason codes a reader can follow, and N-10 to N-12 exist as
   fixtures in the same manifest.
1. The published schemas validate every worked example and refuse every
   refused example, and the suite runs in CI in both repositories.
2. Each of N-1 through N-15 is a test that fails if the behavior changes.
3. A runner enrols, takes a job, heartbeats, reports terminal state and
   uploads evidence against the pilot cell run locally, with no GitHub App
   and no live data.
4. Every mutating endpoint refuses a repeated `Idempotency-Key` with a
   different body, and returns the first outcome for an identical one.
5. No code path in the work service spawns a process, and a test asserts
   it: the refusal in section 3 is mechanical.
6. A job's every mutable transition has exactly one authority in the
   code, matching section 9's table.
7. The plane survives a restart mid-job: leases, fences and idempotency
   keys are durable, and a runner reconnecting after the restart resumes.

## 13. Cross-repo dependency

This spec cannot be implemented to completion without three answers it
does not own, and none of them should be mocked around:

- **Rahi R-1**: bearer-token renewal for a client whose session outlives
  one token (section 4.3). Status 2026-09-12: `main` has none; draft 038
  proposes native clients and lifetimes without a refresh rule; 014 D-4
  proposes the device grant's refresh token and leases bound to the
  runner record. Rahi 038 must also land its CSRF exemption, because a
  bearer write is refused `403 csrf` today.
- **statecraft-cli C-2**: the receipt and bundle fixtures, including the
  negative set, as the definition of version 1 (section 7.1). Status: 132
  is a merged draft with no fixture files; 014 section 10.2 asks for the
  verdict columns and byte mutations before they are minted.
- **statecraft-cli C-4**: whether the hosted runner is the engine binary
  its draft 130 distributes, configured with a hosted endpoint, or a
  separate member (section 4.4's `class`). Proposed in 014 D-4: the same
  binary.
- **Rahi's pilot prerequisites**: a pinned release (draft 039) and 017
  Part A, since the service is built in the pilot cell (section 2).

Sections 4 through 6, 8, 9 and 10 can be specified without them. Section
7's parser cannot be written, and no section can be built.

## 14. Out of scope

- **Authorizing any external effect.** Spec 016.
- **Computing authority.** spec-spine owns snapshots, deltas, closures
  and scopes; this spec stores references to them.
- **Enforcing what a candidate may write.** The executor's fence and
  sandbox, in statecraft-cli.
- **Entitlements, metering and retention.** 014 O-6; the records here are
  designed so metering can read them, and metering is not specified here.
- **A hosted UI beyond a run list and a run detail.** The explanation
  view statecraft-cli's draft 131 designs is the richer surface, and
  duplicating it here would create two accounts of one run.
- **Multi-region, queueing policy, or fair scheduling.** One tenant, one
  runner, one job at a time is sufficient to prove the contract.
