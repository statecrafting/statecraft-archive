---
id: "018-hosted-work-service"
title: "The hosted work service: the 015 contract served from the N=1 pilot cell"
status: draft
created: "2026-09-12"
implementation: pending
depends_on:
  - "014-rahi-realignment"
  - "015-hosted-work-contract"
  - "017-rahi-cell-migration"
establishes:
  - { kind: directory, path: "specs/018-hosted-work-service/" }
summary: >
  The service half of spec 015, split from it on 2026-09-12 so that the
  contract's schema work is not blocked by a cell that does not exist yet
  (spec 014 section 11, ST-06). The contract, its fixtures and its pure
  evaluator stay in 015. This spec is what a running plane adds on top:
  the endpoints that serve the contract from spec 017 Part A's N=1 pilot
  cell, device-grant runner identity against Rahi's native client, durable
  leases, fences and idempotency keys, an immutable content-addressed byte
  store the cell's backup covers, tenant authorization with automated
  cross-tenant 404 tests, a mechanical refusal to execute anything, and a
  run list and run detail. It runs as a controlled engineering pilot with
  no external customer, and customer-data retention and deletion are
  configured before any customer data is accepted. It is approvable only
  for the N=1 pilot, after its prerequisites are evidenced.
---

# 018: The hosted work service

Link a compilation unit to this spec via `[package.metadata.spec-spine].spec`
in its manifest, a `// Spec:` header, or the edges above.

## 1. Purpose

Spec 015 was written as one spec holding both a wire contract and the
service that serves it. The owner's adoption on 2026-09-12 approved the
first and not the second (spec 014 section 11, ST-06): the contract,
schemas, fixtures and pure evaluator can be built now in statecraft-cli's
workspace, while a hosted service needs a Rahi cell, a working identity
refresh and an issuer that do not exist yet. Kept in one spec, the service
half would make `registry plan` report schema work as blocked by spec 017.
This spec is the service half, split out so each half carries its own
lifecycle.

It defines nothing the contract already defines. Sections 4 to 9 of 015
are the behavior; this spec is what a running plane must add to deliver
that behavior durably, to one tenant at a time, without executing
anything and without leaking one tenant to another.

### 1.1 The approval gate

This spec is approvable **only for the N=1 pilot, and only after its
prerequisites are evidenced** (ST-06). Each prerequisite is a thing that
can be shown, not a date:

- **017 Part A's checklist.** The Rahi release the pilot cell pins meets
  the prerequisites 017 section 1.2 copies, at N=1.
- **Working identity refresh.** A native client completes the device
  grant, renews by refresh token, and makes an authenticated bearer write
  past CSRF against that release (Rahi 038).
- **Issuer setup.** Before this service admits anything under a policy
  that requires a trusted issuer, 016 section 5's enrolment, rotation,
  revocation and evaluation-time semantics have been tested (G-08). A
  policy that admits unsigned evidence explicitly does not wait on it.
- **015's slice.** Its acceptance items 1 to 6 pass, so the service
  consumes a frozen manifest and evaluator rather than a moving one.

## 2. Territory

Planned. A draft's territory is a declaration of intent, not a claim on
existing code (spec-spine spec 076), and each file is claimed in the
change that writes it.

- **The service**: routes in the pilot cell of spec 017 Part A (the
  `statecraft-cell` shape of 017 section 3). Its exact paths are fixed
  when 017 Part A places the cell's source.
- **The pure evaluator and the schemas**: consumed from statecraft-cli's
  Apache-2.0 workspace as a pinned dependency, never re-implemented or
  copied here (G-04). Apache-2.0 code entering this AGPL-3.0 repository is
  the sanctioned direction.
- **The run views**: a run list and a run detail, reusing `frontend/`
  components behind the pilot's API adapter.

## 3. What the service serves

**3.1 The contract, unchanged.** Enrolment (015 section 4), projects and
jobs (5), leases, heartbeat and cancellation (6), evidence intake and the
verdict (7), idempotency and reconnection (8), with the authorities of
015 section 9. Where the service and the contract disagree, the contract
wins and the service has a defect.

**3.2 The evaluator is called, not re-derived.** Every verdict, admission
result and lease transition the service records is the output of 015's
pure evaluator, called with explicit inputs: the kept bytes, the
reference, the job, the policy, the root set and the time. The service
owns the clock, the store and the root set; the evaluator owns the answer.

**3.3 Identity against Rahi's native client.** A runner's token comes from
the platform IdP's public native client with the device grant (Rahi
draft 038), and the service checks it in Rahi spec 025's resource-server
shape. The client's scope list is fixed in this spec, against 038's
native client, when the service is built (spec 014 O-3's resolution
leaves it here). Expiry is read from `expires_in`; the service assumes no
lifetime either.

## 4. Durability

**4.1 Every contract record is durable in the cell's store.** Runner,
project, job, lease, fence, idempotency key, evidence row and verdict
live in the cell's own store, in one transaction per transition, so a
transition is either wholly recorded or not at all.

**4.2 Writes carry their own time and ids.** The cell's store refuses
non-deterministic functions on the write path (spec 017 section 4), so
every timestamp and id is a parameter the service supplies. This is also
what lets 015's evaluator replay a recorded decision.

**4.3 A restart loses nothing a runner relied on.** A runner that
reconnects after a restart presents its fence and resumes on an equal one
(015 section 8.3). An idempotency key recorded before the restart answers
the same way after it.

## 5. The byte store

Adopted as G-07; built here.

**5.1 One immutable, content-addressed table.** Kept evidence bytes live
in an app table of the cell, keyed by SHA-256 over the bytes and never
updated in place. The cell's backup covers it, which is why the bytes are
not a file on a volume (spec 014 section 10.1, R-3).

**5.2 Only references leave the table.** Evidence rows and any ledger
hold 015's typed reference (015 section 7.1). No kept object passes
through a canonicalizing append.

**5.3 A refusal keeps its digest, not its bytes.** An object refused at
intake is recorded by digest and reason, and its bytes are not written to
the table.

**5.4 Restore returns the same bytes.** Restoring the cell from its backup
returns every kept object byte-identical, checked by recomputing each
digest. Recovery of original bytes is part of the pilot's evidence, not
an assumption about the backup.

## 6. Tenant authorization, and cross-tenant 404s under test

**6.1 The plane authorizes every call.** Tenant authorization belongs to
the plane (ST-06). Every tenant-scoped route resolves the caller's tenant
from the runner record or the session, and never from a path segment, a
header or a payload the caller chose.

**6.2 Another tenant's resource is 404, never 403.** Existence is not
leaked. This is the running plane's rule (spec 014 section 6) and 015's
N-2, and the service holds it on every route, not just the ones that were
checked by hand.

**6.3 The rule is tested automatically, per route.** A table-driven test
enumerates every tenant-scoped route and calls each with a second
tenant's valid credential, asserting 404 and an unchanged store. A new
tenant-scoped route with no row in that table fails the test. The running
plane's equivalent gap (the 404 mapping was checked only in live walks,
spec 014 section 10.1) is 017 section 5.1's to close for today's
services; this spec does not inherit it.

## 7. Customer data, before any is accepted

**7.1 The pilot is a controlled engineering pilot.** It enrols no external
customer (ST-05). Its tenants are the operator's own.

**7.2 Retention and deletion are configured before customer data
arrives.** Before this service accepts a customer's data, the retention
limit for kept bytes and evidence rows is configured, and deletion is
implemented and exercised. Deleting kept bytes leaves the reference, the
digest and a reason in place, which is why the bytes are addressed rather
than embedded (spec 014 section 10.3, item 7).

**7.3 No contractual term is invented here.** Paid-offer terms, metering,
retention commitments and support promises are written before external
customers enrol, in their own record (ST-05). The limits of 7.2 are
engineering configuration, not a promise to anyone.

## 8. Nothing executes

The contract's first refusal (015 section 3) is mechanical here. No code
path in the service spawns a process, evaluates a script, or runs a
command a payload names, and a test asserts it over the service's
dependency surface rather than over a sample of calls.

## 9. The run views

A run list and a run detail per project: the job, its lease history, its
terminal state, and each evidence row's four dimensions, admission result
and reasons, with `unknown`, `unsigned`, `not recorded` and `stale` shown
as themselves. The richer explanation surface is statecraft-cli's draft
131, and duplicating it here would create two accounts of one run.

## 10. Negative cases

015's N-1 to N-23 run against the service, each as an end-to-end test
against the pilot cell. This spec adds the cases only a running plane can
fail:

| # | Case | Required behavior |
|---|---|---|
| S-1 | the cell restarts while a job holds a lease | the lease, fence and idempotency keys survive; the runner resumes on an equal fence |
| S-2 | every tenant-scoped route, called with another tenant's valid credential | 404, never 403; the store is unchanged (6.3) |
| S-3 | the cell is restored from its backup | every kept object's bytes recompute to its recorded digest |
| S-4 | a payload carrying an executable verification plan | recorded as data; no process starts, and the test of section 8 holds |
| S-5 | kept bytes deleted under the configured retention limit | the bytes are gone; the reference, digest and reason remain; a later read reports the deletion, not a missing row |
| S-6 | a token whose `aud` is right but whose `jti` is on the deny-list | refused; no job state changes |

## 11. Acceptance

1. 015's N-1 to N-23 and this spec's S-1 to S-6 are tests against the
   pilot cell, and each fails if the behavior changes.
2. A runner enrols, takes a job, heartbeats, reports a terminal state and
   uploads evidence against the pilot cell run locally, with no GitHub
   App and no live data.
3. Every mutating endpoint refuses a repeated `Idempotency-Key` with a
   different body, and returns the first outcome for an identical one.
4. No code path in the service spawns a process, and a test asserts it
   (section 8).
5. Each mutable transition has exactly one authority in the code,
   matching 015 section 9.
6. The service survives a restart mid-job (S-1) and a restore from backup
   (S-3).
7. The cross-tenant route table of 6.3 covers every tenant-scoped route.
8. Before the first customer data: 7.2's retention limit is configured
   and a deletion has been exercised (S-5).
9. `spec-spine index coverage` stays at 100 percent: each file this spec
   adds is claimed in the change that adds it.

## 12. Cross-repo dependency

- **Rahi.** The pilot prerequisites 017 Part A copies (revision-4 G-11,
  Rahi's to adopt), and specifically 038's native public client, device
  grant, refresh renewal, revocation and authenticated bearer writes past
  CSRF. R-1 (bearer renewal) is answered by G-09's device grant and
  refresh token, and waits on 038 to exist in a release.
- **statecraft-cli.** 015's fixture manifest and pure evaluator in a form
  this service can pin (its 132 and the evaluator beside it).
- **Spec 016.** A job with no permit is admissible only in `dry-run` kind
  (015 section 5.2), so this service can run the pilot's dry-run jobs
  before 016's pilot slice exists, and runs permitted jobs only after.

## 13. Out of scope

- **Permits and effects.** Spec 016.
- **Commercial terms.** Section 7.3.
- **Unattended runners.** 015 section 4.6.
- **N=3 and multi-replica operation.** The pilot is N=1.
- **Migrating the live plane.** 017 Part B.
- **Artifact and deployment binding.** Deferred until the local slice and
  the pilot pass (spec 014 section 11, ST-07).
- **Multi-region, queueing policy, or fair scheduling.** One tenant, one
  runner, one job at a time proves the service.
