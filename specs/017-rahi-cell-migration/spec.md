---
id: "017-rahi-cell-migration"
title: "The Rahi cell shell and the domain port: migration, cutover and rollback"
status: draft
created: "2026-09-11"
implementation: pending
depends_on:
  - "002-app-shell"
  - "014-rahi-realignment"
establishes:
  - { kind: directory, path: "specs/017-rahi-cell-migration/" }
summary: >
  The control plane becomes a Rahi cell: a manifest, migrations, routes,
  operator routes, and a one-line main that hands control to the chassis
  runner. Roughly half of today's backend is chassis plumbing that Rahi
  supplies outright and is deleted rather than ported; the other half is
  the domain, which moves behind a port that preserves tenant and GitHub
  semantics exactly, negative authorization tests first. Stamping retires
  (it has never run in production); the fleet's disposition waits on one
  owner decision. Identity is a volume, not a database, so the volume is
  the migration's primary object and the evidence chain moves as original
  bytes with its original verifier. Cutover is staged behind a reverse
  proxy with a stated rollback, and acceptance is live, never a green
  unit suite.
---

# 017: The Rahi cell shell and the domain port

Link a compilation unit to this spec via `[package.metadata.spec-spine].spec`
in its manifest, a `// Spec:` header, or the edges above.

## 1. Purpose

Spec 002 built the control plane as an EnRaHiTu app: an Encore.ts
application on the enrahitu chassis, with CoreLedger over Postgres, an
embedded rauthy proxied at `/auth/*`, and a napi addon for each of the
two privileged subsystems. The chassis it was built on has been rebuilt
as Rahi, in Rust, with a different set of answers: one store, no
CoreLedger, no template, no stamping, no Encore toolchain, and a `Cell`
trait where the template used to be.

This spec is the migration. It is a backend and operational-contract
change, not a dependency rename, and spec 014 sections 2 and 3 carry the
measurements it rests on.

**The one thing this spec is not:** a requirement on customers. statecraft
can run on Rahi without any customer application running on Rahi, and
spec 014 section 4.1 keeps that as a thesis-level property. An existing
EnRaHiTu customer application does not move when the control plane does.

## 2. What the port actually is, measured

`backend/` is 137 TypeScript files, 8811 lines of production code and
2162 lines of tests. It divides almost evenly, and the halves have
completely different fates.

| Half | Directories | Files | Fate |
|---|---|---|---|
| Chassis plumbing | `auth/`, `idp/`, `core/`, `lib/`, `hiq/`, `obs/`, `web/`, `health/` | 69 | **deleted**, not ported: Rahi supplies each (`rahi-idp`, `rahi-edge`, `rahi-store`, `rahi-ops`, spec 023's observability, spec 020's static slot) |
| Domain | `tenants/`, `factory/`, `fleet/`, `governance/`, `admin/` | 68 | ported, retired or re-founded, per sections 5 to 9 |

That is the honest size of it: half of this backend exists because the
previous chassis did not supply something, and the new one does. The
migration's risk is not in the line count. It is in the two places
section 6 and section 7 name, where the durable state lives.

## 3. The cell shell

`hqgit`'s spec 003 B-2 already describes the shape for a sibling product
and statecraft adopts the same one, which is worth saying because it
means the pattern gets two independent proofs rather than one.

A `statecraft-cell` crate implements rahi's `Cell` trait
(`crates/rahi-cli/src/cell.rs`):

- `manifest()`: the declared TOML ceiling, hand-authored, parsed and
  hashed at every boot, the hash becoming the decision chain's genesis
  parent. Section 10 decides what happens to the parts of today's
  `app-model.json` that have no home in it.
- `migrations()`: the schema, in version order. Migrations never run at
  boot in Rahi; the `migrate` verb is the only caller, and a cell can
  serve on an old schema but cannot migrate itself into a surprise.
- `routes(state)`: the API, merged at the root, authenticated unless
  `exposed()` names otherwise.
- `operator_routes(state)`: mounted under `/operator` behind the role
  gate. Today's `admin/` service and the `frontend-admin` surface move
  here, which also resolves the `/metrics` exposure by construction
  rather than by a second deny Ingress.
- `exposed()`: the public routes, named individually. The login entry and
  the static SPA are the whole list.
- `static_dir()`: the built `frontend/` assets.

`main` hands control to the runner and nothing else. Configuration,
telemetry, health, shutdown and supervision are the chassis's, which is
why 69 files leave.

## 4. What the shell inherits, and what it must not assume

Rahi's facts that change how the domain is written, from its
`docs/design/00-architecture.md` and its specs:

- **Writes are deterministic bytes.** hiqlite panics on `unixepoch()`,
  `random()` and every other non-deterministic SQL function on the write
  path. Timestamps and ids are caller-supplied parameters. Today's
  entities default `createdAt = new Date()` and `id = randomUUID()` in
  the row constructor, which is compatible with this rule but must stay
  that way deliberately rather than by accident.
- **A `txn` is one Raft entry and one SQLite transaction**, rolled back
  whole on any statement's failure. This is stronger than what CoreLedger
  gave us and simplifies the fleet's intent journal.
- **Migrations are a deploy step, never a boot step.** Spec 014 section
  6 records that CoreLedger has no auto-migration and that adding a
  column needed a manual ALTER against the live database. The cell's
  `migrate` verb replaces that practice with a named one.
- **Backups are leader-only and restore is a cluster reset.** The fleet's
  scale-to-zero-and-restic pattern has no analogue and does not port
  (section 8).

## 5. The domain port

**5.1 Tenants move first, and the negative tests move before the code.**
`tenants/` is 25 files and is the only domain subsystem with production
rows that matter. Its semantics are not negotiable and are what the port
must preserve:

- An owner-scoped resource belonging to another tenant reads as **404**,
  never 403; existence is never leaked.
- `installation.installationId` is unique, and its authority is GitHub's,
  not ours.
- Membership is reconciled from the org at login, with `role` and
  `source` recorded.
- Uninstall and delete-tenant are the two exits, each with its own
  attested record.

The port begins by translating the existing negative authorization tests
to the new stack and watching them fail against an empty implementation.
A port that writes the happy path first and adds the negative tests
afterwards will reproduce the happy path and quietly lose a refusal.

**5.2 Governance ports as-is, with one addition.** The attestation chain,
the action gate and its config hash, and the trust window keep their
shapes; spec 008 remains their design. The addition is the issuer
(spec 016 section 5). The `governance-native` addon's future is a
packaging question, not a design one: its Rust crates
(`attest-ledger`, `action-gate`, `trust-window`,
`canonical-keysort-json`) are already Rust and already pinned, so a cell
links them directly instead of crossing a napi boundary.

**5.3 The domain port is a trait, not a rewrite in place.** Each domain
subsystem exposes a port (the operations the API needs) with two
implementations during the transition: the existing service, reached over
HTTP, and the native one. Section 12's staged cutover moves traffic per
subsystem behind that seam, which is what makes a rollback a routing
change rather than a restore.

## 6. Identity: the volume is the migration

Spec 014 section 3.6 measures it: `/data` holds rauthy's database
(36M), the admin password, the bootstrap marker, the app's own access and
refresh signing keys, the rauthy client secret, the governance chain and
a hiqlite tree. Postgres is a separate volume. Neither is reconstructible
from git.

- **The IdP database moves as a volume, not as rows.** Rahi's spec 031
  puts rauthy's Raft state at `/data/rauthy` and refuses to let the app's
  own hiqlite open any data directory with a `rauthy` path component,
  which is the same layout this deployment already has. The migration is
  therefore a volume-preserving change for `/data/rauthy`, and any design
  that re-seeds the IdP loses every subject.
- **`user_account.ssoProviderId` is the binding that must survive.**
  Every application user row is keyed to an IdP `sub`. Rahi's spec 022
  carries the same decision this repository made (the IdP's `sub` is the
  principal, no local account row), so the port is an opportunity to
  delete `user_account` in favor of the principal plus a profile row,
  and the migration must map the two before that deletion, not after.
- **The signing keys are self-minted and must not be re-minted.**
  `/data/keys/*.pem` were generated at first boot. Re-minting them
  invalidates every live session and every refresh token, which is
  survivable but must be a decision rather than a side effect.

## 7. Evidence moves as original bytes

`/data/governance/state/records.jsonl` is 10 records and
`anchor.json` is their root. The chain moves byte-for-byte:

- The file is copied, not re-serialized. A canonical re-emission that
  produces identical bytes is still a re-emission and a migration that
  relies on it has bet the chain on a serializer.
- The original verifier is preserved and kept runnable. Old records keep
  their original digest construction forever (spec 016 section 8.1), so
  whatever verifies them today must still exist after the port.
- The Postgres index rows (`governance_attestations`) are rebuilt from
  the file, never the reverse. The file is the authority and the port is
  where that could silently invert.
- If an issuer is established before the port (spec 014 O-4), the
  anchoring happens on one side or the other and is recorded, never on
  both.

## 8. The fleet disposition

Gated on spec 014 O-1 (whether managed application hosting is in the
initial offer). Both branches are specified so the decision is a choice
between two designs rather than a choice to design later.

**If hosting is out of the initial offer:** the fleet stays running,
unported, on the existing deployment until the last placed application is
gone. It is not extended. Its five `fleet_app` rows are already all
`removed` and its tenant namespace is empty (spec 014 section 3.4), so
this branch costs nothing today and is reversible.

**If hosting is in:** the placement unit changes from "EnRaHiTu container
plus volume plus ingress" to "a cell", and three things follow:

- **Deployment becomes StatefulSet.** rahi spec 032 is the topology: N=1
  primary, N=3 the scale path, a volume per replica, two Raft clusters
  per replica, peers by stable pod DNS, one key set custodied once.
  Single-replica `Recreate` does not survive that shape.
- **Backup changes mechanism.** Scale-to-zero plus restic over `/data`
  is replaced by rahi 030's `backup` verb against the leader, with a
  CronJob, and restore is a cluster reset rather than a file copy. The
  clean-shutdown-consistency argument that justified scale-to-zero does
  not apply to a leader-side backup, and the entrypoint signal handling
  this deployment already fixed is a chassis property in Rahi.
- **`fleet-native` is re-evaluated.** It builds the placement shape with
  `kube-rs` and is already Rust. A cell can consume it directly; whether
  it stays a separate package is a statecrafting question and is not
  decided here.

## 9. The factory disposition

Stamping retires. The evidence is spec 014 section 3.3: `stamp_job` is
empty in production and no `stamp`-kind attestation exists, so the
subsystem most tightly coupled to the removed `template.toml` contract is
the one with no production usage. Rahi states the other half plainly:
"There is no `template.toml` and nothing stamps."

What replaces it is **not** today's `mode: adopt`, and the distinction
matters enough to state rather than let the word carry:

| | today's `adopt` | the successor |
|---|---|---|
| What it does to the repository | opens a PR overlaying the enrahitu chassis onto it | nothing; the repository stays as it is |
| What it requires of the customer | adopt a chassis | adopt a governance loop |
| What it produces | a born-green stamped tree | a project registration (spec 015 section 5.1) |

So the successor to the factory is spec 015's project, not a renamed
stamp. `backend/factory/` is deleted with its spec marked superseded, and
three of its pieces are kept because they are useful independently of
stamping: the born-with certificate construction (`cert.ts`, a
keysorted-canonical digest), the GitHub App client (`github.ts`), and the
job state machine pattern, which spec 015's jobs reuse.

**A retirement is a human decision.** This spec proposes it; approving
this spec approves it; nothing is deleted before that.

## 10. The model disposition

Spec 014 section 2.2 measures the delta between Rahi's manifest ceiling
and today's extracted `app-model.json`. Three of the four gaps cost
nothing: `agents`, `types` and `trust.levels` are empty, and `extraction`
and `source` describe a producer that goes away with Encore. Two need a
decision:

- **The endpoint table** (12 services, their paths, methods and access)
  has no home in the Rahi ceiling and is what `frontend-admin`'s catalog
  view reads. Options: Rahi's ceiling grows a section (spec 014 R-2), a
  statecraft-owned overlay carries it, or the catalog view retires.
  Recommendation: an overlay, because the table is a statecraft product
  surface and not a chassis concern, and because asking a chassis to
  carry a consumer's view is how the previous chassis grew a membership
  product.
- **`ledger.signing`** is removed from whatever replaces the model until
  an issuer exists (spec 014 section 3.5). A declaration nothing enforces
  is worse than no declaration, because it reads as a guarantee.

## 11. The UI

The cheapest part, and worth saying so. `frontend/` reaches the backend
through one 346-line adapter (`frontend/src/lib/api.ts`);
`frontend-admin/` has its own. Every component, route and test is reused;
the adapters are rewritten against the cell's routes.

Two behaviors in the adapter are load-bearing and must be re-established
deliberately, not inherited: the CSRF double-submit (the token cookie is
httpOnly, so the response body is the only readable source), and the
silent single retry through refresh on an expired-access-token 401. Both
become chassis behaviors in Rahi's session model and should be checked
against `rahi-idp` rather than reimplemented.

## 12. Cutover and rollback

Staged, per subsystem, behind a routing seam. Never a big-bang swap.

1. **The shell serves nothing.** The cell is deployed beside the running
   control plane, on its own hostname, with `EmptyCell`-shaped routes
   plus health. Acceptance is a boot, a `/readyz`, and a login through
   the cell's own flow. This proves the chassis without touching the
   product.
2. **Read-only mirrors.** The cell reads the existing durable state and
   serves read-only routes. Any disagreement between old and new on the
   same request is a defect found before anything writes.
3. **One subsystem at a time, writes included.** Governance first (its
   writes are append-only and its authority is a file), then tenants,
   then whatever section 8 decided about the fleet. Each subsystem's
   traffic moves at the reverse proxy.
4. **The volume moves once.** `/data` is detached from the old workload
   and attached to the new, in a scheduled window, with a verified backup
   taken immediately before. This is the only irreversible step, and it
   is why steps 1 to 3 exist.
5. **The old workload stays deployable for one release.** Its image
   digest is pinned and recorded; rolling back is re-pointing the
   Deployment and re-attaching the volume.

**Rollback conditions, named in advance:** login fails for an existing
subject; any owner-scoped route returns 403 where it must return 404; the
evidence chain fails to verify with its original verifier; a write lands
in the new store that the old one cannot read; or the `migrate` verb
reports a schema the old workload refuses. Any one of those is a
rollback, not a debugging session in production.

**Rollback is not free after step 4.** Writes made by the new cell to a
migrated store are not readable by the old workload, so a rollback after
step 4 is a restore from the pre-cutover backup with those writes lost.
Saying so in advance is the difference between a plan and a hope.

## 13. Live prerequisites

Acceptance is live. A green unit suite is not operational acceptance, and
this repository has already recorded what that mistake costs: a published
image that lagged `main` by 60 files while every gate stayed green, and a
stop-path fix that could only be proved by the boot after a deliberate
delete, never by the roll that deployed it.

Before step 4:

- A restore has been performed from the backup that step 4 relies on,
  into a scratch environment, and the evidence chain verified there.
- The GitHub App installation has been exercised end to end against the
  new cell (an installation callback, a membership reconcile, one
  owner-scoped 404).
- The IdP has served a login to an existing subject from the migrated
  volume, not a fresh one.
- The rollback in section 12 step 5 has been rehearsed, not just written.

## 14. Acceptance

1. The cell boots, `/readyz` answers, and a login completes through its
   own flow (rahi spec 033's harness shape).
2. Every negative authorization test from `tenants/` passes against the
   port, and each one was seen to fail first against the empty
   implementation.
3. The evidence chain verifies after the move with its original
   verifier, over bytes identical to the pre-move file.
4. An existing IdP subject logs in after the volume move and resolves to
   the same application identity as before.
5. `spec-spine index coverage` stays at 100 percent through every stage:
   each file the port adds is claimed in the change that adds it.
6. The rollback of section 12 step 5 has been performed once, in a
   scratch environment, and recorded.
7. `spec-spine verify 017` is green.

## 15. Cross-repo dependency

- **Rahi R-2** (manifest evolution) gates section 10's first decision.
- **Rahi R-3** (recovery and consumer contract, and whether a cell may
  carry a second durable store it owns) gates section 7: statecraft's
  evidence chain is a file, not a hiqlite table, and Rahi must say
  whether that is a supported shape or a thing to migrate.
- **Rahi's crate availability.** `rahi-cli`, `rahi-edge`, `rahi-idp`,
  `rahi-kernel`, `rahi-ledger`, `rahi-ops` and `rahi-store` exist in that
  repository; whether they are published or consumed by path is a
  packaging question this spec does not answer.
- **statecrafting**: `fleet-native` and `governance-native`'s future,
  gated on section 8's branch.

## 16. Out of scope

- **Deciding spec 014 O-1 or O-2.** Section 8 specifies both branches of
  the first; the second is a sequencing decision for the owner.
- **Executing any cutover.** This spec is a draft, and section 12 is a
  plan awaiting approval.
- **Migrating customer applications.** They do not move.
- **Rahi's internal design.** Section 15 asks; it does not decide.
- **The hosted work and permit contracts.** Specs 015 and 016.
- **Retiring spec 001.** It stays the record of what was built; spec 014
  section 4 is the successor thesis, and both stand.
