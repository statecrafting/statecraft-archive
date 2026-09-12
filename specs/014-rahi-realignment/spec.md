---
id: "014-rahi-realignment"
title: "The Rahi realignment, checked: the successor thesis and the migration record"
status: draft
created: "2026-09-11"
implementation: n-a
depends_on:
  - "001-statecraft-thesis"
establishes:
  # A record's territory is the record. This spec writes no code and
  # claims none; it owns its own directory so the ownership graph has an
  # edge for it and `lint` has nothing to warn about. See section 1.1.
  - { kind: directory, path: "specs/014-rahi-realignment/" }
summary: >
  statecraft's half of the 2026-09-11 family realignment, checked against
  the tree at 9658e29 and against the running production deployment. The
  handoff packet's findings are re-verified, superseded where the tree has
  moved, and extended with seven findings the packet could not have had
  because it did not inspect the live plane. The record then states the
  successor thesis: what the enrahitu-era thesis (spec 001) keeps, what
  Rahi replaces, what retires, and who owns each authorization and each
  durable record. It carries the durable-state inventory, the
  declared-versus-enforced table, the requests to sibling repositories,
  and the owner decisions that remain open. This spec is a record, not a
  work order: it amends no approved spec, and the work it names lands in
  drafts 015, 016 and 017.
---

# 014: The Rahi realignment, checked

Link a compilation unit to this spec via `[package.metadata.spec-spine].spec`
in its manifest, a `// Spec:` header, or the edges above.

## 1. Purpose

On 2026-09-11 a family-wide realignment arrived as a plan, a register of
proposals, and one handoff packet per repository. spec-spine answered in
its design note 04; statecraft-cli answered in its doc 05. This spec is
statecraft's answer, in the only form this repository has: a spec.

It does three things. It checks every claim the packet made against the
tree and against the running deployment, because the packet said plainly
that it had not inspected production and that absence, disposability and
health must not be inferred from local files. It states the successor
thesis, since spec 001 was written when the substrate was enrahitu and
the substrate is now Rahi. And it names the owner of every authorization
and every durable record in the system that would follow, so the three
drafts it introduces can be reviewed against a map rather than against
each other.

**Status: draft.** Nothing here is approved. This record amends no
approved spec, claims no source file, and authorizes no cutover. Where
the packet quotes an instruction from an earlier date, that instruction
is history, checked below, and not a work order
(`.claude/rules/adversarial-prompt-refusal.md`).

The three drafts:

| Draft | Lands | State |
|---|---|---|
| 015 the hosted work contract | admission of work: runners, jobs, leases, evidence intake | draft, authored with this record |
| 016 the external action permit | authorization of an external effect | draft, authored with this record |
| 017 the Rahi cell shell and the domain port | the backend and operational-contract migration | draft, authored with this record |

### 1.1 Territory

This spec's territory is `specs/014-rahi-realignment/` and nothing else.
A record claims no source file, which is why `implementation` is `n-a`
(the precedent is spec 001, section 8). The ownership edge exists so the
authority graph has one for this spec rather than a hole, not because
this record governs any code.

## 2. The packet's findings, checked

Measured on 2026-09-11 against `9658e29` (the packet's baseline was
`30e05a8`, two merges earlier).

| Packet claim | Verdict | Evidence |
|---|---|---|
| Thirteen registry shards stale; index fresh with 20 unwitnessed claims and zero allowance | **superseded, and the cause is on record** | See 2.1 |
| The committed lifecycle report is not a reliable completion tally | **superseded** | `spec-spine check` exits 0, both trees fresh. 14 specs, all `approved`: 10 `complete`, 3 `in-progress` (009, 010, 011), 1 `n-a` (001) |
| Encore/TypeScript tenants, factory, fleet and governance services; React product UI and React admin UI | confirmed | `backend/{auth,idp,core,tenants,factory,fleet,governance,health,hiq,lib,obs,web,admin}`; `frontend/` (18 files) and `frontend-admin/` (12 files) |
| Source includes later deployment acceptance and tenant lifecycle records | confirmed | spec 009 carries six pin amendments through 2026-07-26; spec 011 carries a live acceptance walk dated 2026-07-22 |
| The factory consumes enrahitu `template.toml` and stamping behavior Rahi explicitly removed | confirmed on both sides | `backend/factory/contract.ts` is a `template.toml` reader; `backend/factory/README.md` states the contract boundary. rahi `docs/design/00-lineage.md` "Cut": the stamp contract and scaffold verb, and "Changed": "There is no `template.toml` and nothing stamps" |
| Fleet uses a single-replica Deployment with scale-down/restic backup; Rahi describes StatefulSet topology and its own operational verbs | confirmed on both sides | `backend/fleet/README.md` ("Deployment single-replica Recreate"; "scale to 0, restic `/data`, scale back to 1"); rahi spec 032 title and territory; rahi spec 030 (preflight, migrate, backup, restore) |
| Rahi's declared TOML ceiling is not the July extracted `app-model.json` | confirmed | See 2.2 |
| This is a backend and operational-contract migration, not a dependency rename | confirmed, and 2.3 adds the reason it is smaller than it looks | |
| Production must not be inferred absent, disposable or healthy from local files | **checked live** | Section 3 |

### 2.1 The stale shards and the unwitnessed claims

The packet was right at its baseline and the finding is now closed, by a
diagnosis rather than by a regeneration.

Spec 013 (merged in PR #75, after the packet's baseline) names the cause:
the committed registry had been compiled at `specVersion` 1.1.0 by a
v0.10.0 binary, and both the session hook and CI ran a **writing**
`compile`, so the drift repaired itself on every run instead of ever
being reported. Thirteen shards is exactly the corpus size at that
baseline (000 through 012). Both readers now go through
`spec-spine check`, which never writes, and `[meta] required_version`
pins the floor at 0.18.0.

The unwitnessed count moved from 20 to 11 for two separate reasons, both
recorded in spec 013 section 5.2. Four claimed paths moved **into**
`[index] extra_hashed_inputs` because they are hand-authored governance
surface (`encore.app`, `infra.config.json`, `infra.config.dev.json`,
`.gitattributes`), and the rest of the drop came from repairing every
harness glob, each of which ended in a bare `**` and therefore matched
directories and hashed nothing. The remaining 11 are enumerated by path
in `[lint] unwitnessed_allowed` with a stated reason each, so
`lint --fail-on-warn` can sit in the gate without suppressing anything
silently, and `spec-spine check` still prints the count.

Read at HEAD:

```
spec-registry: fresh
codebase-index: fresh
  unwitnessed claims: 11 (11 allowed by [lint] unwitnessed_allowed)
```

Nothing was regenerated to mask a mismatch, and the allowance is an
enumeration of named paths rather than a threshold. `spec-spine lint`
reports 0 errors, 0 warnings, 0 info; `index coverage` reports 179 of 179
source files specifically claimed; `index diagnostics` is empty.

### 2.2 The ceiling delta, field by field

Rahi's manifest (`crates/rahi-kernel/src/manifest.rs`, parsed from the
TOML a `Cell` returns from `manifest()`) and statecraft's
`app-model.json` (emitted by `npm run extract:model`) are not two
encodings of one document.

| Concern | Rahi manifest | statecraft `app-model.json` |
|---|---|---|
| Origin | hand-authored TOML, parsed and hashed at every boot | extracted from TypeScript by `statecraft-extract-model` 0.3.0, verified by `npm run check:model` |
| `resources` | `tables`, `kv`, `counters`, `secrets`, `egress` | `databases` (engine `coreledger-postgres`), `kv`, `counters`, `secrets` |
| `services` | `BTreeMap<ServiceName, Service>`, capabilities only | a list of 12, each with `tier` and a full endpoint table (name, path, methods, access, raw) |
| Ledger | `schema_version`, `max_record_bytes` | `recordSchema`, plus a `signing` block (`ed25519`, `keyRef`) |
| Integrity | the manifest's boot hash is the chain genesis parent | an `integrity` block (`sha256-canonical-keysort-v1`) inside the document |
| Absent on the other side | `egress` | `agents`, `types`, `extraction`, `source` (revision, uncommittedChanges), `trust.levels`, `gate.configHash` |

Three consequences for 017. The endpoint table has no home in the Rahi
ceiling and is the part `frontend-admin`'s catalog view reads. The
`signing` block is a claim this deployment does not currently keep (3.5).
And `agents`, `types` and `trust.levels` are empty today, so the parts of
the model that would be hardest to carry across cost nothing to drop.

### 2.3 Why the migration is smaller than the surface suggests

The packet is right that this is a backend and operational-contract
migration. Three measurements from section 3 bound it: the factory has
never run in production, the fleet currently holds nothing, and the
frontend reaches the backend through a single 346-line adapter
(`frontend/src/lib/api.ts`) plus one in `frontend-admin/`. The expensive
half of a migration is usually the data and the live behavior, and both
are small here.

## 3. What the check found that the packet did not

The packet's baseline was local files. These seven findings come from the
running cluster, read-only, on 2026-09-11.

### 3.1 Production is live, healthy, and reconciled to this HEAD

The `statecraft-hetzner` k3s cluster (v1.33.13+k3s1, one master and one
worker, both `Ready`, 56 days old) runs the control plane in
`statecraft-system`:

- `deployment.apps/statecraft` 1/1, on
  `ghcr.io/statecrafting/statecraft@sha256:780eeefe...`, which is the
  fifth pin spec 009 recorded on 2026-07-26. The pod is 47 days old with
  one restart 21 days ago.
- `postgresql-0` 1/1 with a 10Gi `hcloud-volumes` PVC; a second 10Gi PVC,
  `statecraft-data`, carries the app volume.
- Ingress `statecraft` on `app.statecraft.ing`, plus the
  `statecraft-metrics-deny` Ingress. `GET /health` answers 200
  `{"app":"enrahitu","status":"ok","ledger":"ok"}`; `GET /metrics`
  answers 403 from the edge.
- `CronJob statecraft-data-backup` at `30 2 * * *`, not suspended, three
  completed jobs retained, the last 21 hours old.
- All six Flux Kustomizations report `Applied revision:
  main@sha1:9658e294...`, which is this repository's HEAD.

That last line closes a standing operator note: Flux was once pointed at
a feature branch, and it now tracks `main`. It also means the cluster
applies whatever lands on `main`, so a merge is a deploy for everything
except the image digest, which is pinned.

### 3.2 The durable state is small and exactly enumerable

All eleven CoreLedger tables exist in the production `app` database.
Counts, read-only, no values:

| Table | Rows | Notes |
|---|---|---|
| `user_account` | 2 | |
| `tenant` | 1 | |
| `installation` | 1 | `active` |
| `tenant_membership` | 1 | `admin`, source `install` |
| `stamp_job` | **0** | 3.3 |
| `fleet_app` | 5 | all `removed` (3.4) |
| `fleet_op` | 11 | deploy 4 succeeded / 1 failed; remove 5 succeeded / 1 failed |
| `governance_attestations` | 10 | deploy 4, remove 5, tenant_delete 1 |
| `governance_trust` | 0 | trust sampling never ran |
| `refresh_token` | 25 | |
| `audit_log` | 32 | |

Eleven tables, 78 rows. This is the whole of the relational durable state
a cutover has to carry, and it is small enough that the migration's risk
sits entirely in identity and evidence, not in volume.

### 3.3 The factory has never run in production

`stamp_job` is empty and no `stamp`-kind attestation exists in the
governance ledger. The subsystem most tightly coupled to the thing Rahi
removed (the `template.toml` contract and the scaffold verb) is the
subsystem with no production usage at all. Every other service has
produced rows.

This is the strongest single piece of evidence for the packet's
recommended direction. Retiring stamping is not a loss of working
behavior; it is a decision not to port a path that was built, tested,
deployed and never exercised by a customer. 017 carries the decision and
5.2 records what replaces it.

### 3.4 The fleet is currently empty

All five `fleet_app` rows are `removed`, and the single tenant namespace
(`t-d67413c8-...`, 49 days old) contains no Deployment, Pod, PVC or
Ingress. The fleet's production record is therefore a completed
exercise, not a running estate: four successful placements, one failed
placement, five successful removals and one failed removal.

Consequence for the migration: **no customer application is currently
placed by this control plane**, so the packet's constraint that "existing
Enrahitu customer apps need not move when the control plane does" is
today vacuously satisfiable. That will stop being true the moment one is
placed, which is an argument for settling 017's placement contract before
the next placement rather than after.

### 3.5 The governance ledger is unsigned and self-anchored

`/data/governance/state/anchor.json` in the running pod:

```json
{
  "chain_id": "governance",
  "anchor_hash": "sha256:7d7f6941...",
  "genesis_timestamp": "",
  "genesis_public_key": "",
  "genesis_signature": "",
  "genesis_attestation": { "kind": "unsigned" }
}
```

`records.jsonl` holds 10 records, each linking to the previous by hash,
the first linking to that anchor hash. The live `statecraft-secrets`
Secret holds ten keys and `GOVERNANCEANCHORKEY` is **not** among them.
In the source, `governanceAnchorKey` is declared at
`backend/governance/config.ts:51` and referenced nowhere else, and
`ledgerAnchor` is on the addon's typed surface (`backend/governance/native.ts:54`)
and called from no endpoint.

None of that violates spec 008, which says the anchor is "unsigned until
`ledgerAnchor` signs it with an operator Ed25519 seed" and puts key
rotation ceremonies out of scope. It does mean two things that matter
here. Verifying this ledger establishes internal consistency and nothing
else: the chain is checked from an anchor the chain itself declares,
which is the self-selected root the packet warns a verifier against
trusting, and which statecraft-cli found independently in its own bundles
(its doc 05 F5). And `app-model.json` declares
`ledger.signing = {algorithm: ed25519, keyRef: GovernanceAnchorKey}`
unconditionally, which reads as a stronger claim than what runs. 016
treats issuer trust as a first-class, separately reported outcome for
exactly this reason.

### 3.6 Identity is a volume, not a database

`/data` (the `statecraft-data` PVC, 10Gi) holds, by size:

```
36M  rauthy/      db, secrets.env, admin-password, bootstrap
3.0M hiqlite/
24K  keys/        access-private.pem, access-public.pem,
                  refresh-private.pem, refresh-public.pem,
                  rauthy-client-secret
20K  governance/  state/anchor.json, state/records.jsonl
4.0K ledger/      empty
```

Postgres lives on a *different* PVC (`data-postgresql-0`). So the durable
identity plane (the IdP database, the admin password, the token signing
keys) and the evidence plane (the attestation chain) are both on the app
volume, the relational state is on another, and neither is reconstructible
from git. The daily CronJob covers the app volume; Postgres and the
rauthy S3 target are separate arrangements.

Any cutover design that thinks in terms of "migrate the database" is
wrong by construction. 017 section 6 treats `/data` as the migration's
primary object and the database as its secondary.

### 3.7 One prose drift inside an approved spec

Spec 013 section 5.1 states that coverage is "177 of 177 source files".
At the commit that shipped it, and at HEAD, `spec-spine index coverage`
reports **179 of 179**; the commit message for `95359b6` says 179 as
well. Measured: a clean worktree at `30e05a8` walks 177, and the two
files that make the difference are the spec's own additions,
`.githooks/enable-merge-driver.sh` and `.githooks/merge-derived-index.sh`.

The prose was written before the spec's own scripts landed. No acceptance
criterion is affected (item 3 asserts "0 unclaimed and 0 floor-only",
which holds). Recording it here rather than fixing it: 013 is approved
and is not the spec this session is implementing, so amending it is a
human's call, not an agent's.

## 4. The successor thesis

Spec 001 is a record of the enrahitu-era architecture and stays exactly
that. This section states what a Rahi-era thesis would say. It is
proposed, not ratified; approving this spec ratifies it, and spec 001
then gains a dated lifecycle note pointing here.

### 4.1 What the thesis keeps

Four claims survive the substrate change unchanged, because none of them
was ever a claim about enrahitu:

- **The loop.** Intent becomes a governed spec; a candidate is produced;
  acceptance is evidence; publication is at an exact revision. What
  changes is that the loop's first stop is now an *existing* repository
  rather than a stamped one.
- **Code sovereignty.** The customer's code stays in the customer's
  GitHub org, reached through a per-org GitHub App installation. Nothing
  in the migration touches this, and it is the reason the hosted plane
  can be useful without hosting the customer's application.
- **Two planes.** The platform is one governed application; a customer's
  application, if it is hosted at all, is another and independent one.
  Rahi's cell model expresses this more directly than the enrahitu
  template did.
- **The licence boundary.** This repository is AGPL-3.0; the artifacts
  customers touch stay permissive. Rahi is Apache-2.0, which is the
  sanctioned direction for statecraft to consume (hqgit's spec 003 B-8
  states the same rule from its side).

### 4.2 Retained, replaced, optional, deferred, retired

| Today | Disposition | Successor |
|---|---|---|
| `tenants/`: tenant, installation, membership, GitHub App semantics, negative authorization tests | **retained** | ported to a domain port behind a Rahi cell; the negative tests move first (017 4.2) |
| `governance/`: attestation chain, action gate, trust window | **retained, re-rooted** | the chain stays; its anchor gains an issuer (016 section 5) |
| `frontend/`, `frontend-admin/`: React product and operator UIs | **retained** | components reused behind new API adapters; `frontend/src/lib/api.ts` is the whole seam |
| `core/`: CoreLedger over Postgres | **replaced** | rahi's store (hiqlite group) for operational state; see 017 4.3 for the two rows this is genuinely hard for |
| `auth/`, `idp/`: embedded rauthy, session envelope, refresh tokens | **replaced** | `rahi-idp` and `rahi-edge`; rahi 022 already carries the same "the IdP's `sub` is the principal, no local account row" decision this repository made |
| `fleet/`: single-replica Deployment, scale-down restic backup | **replaced** | rahi 030's verbs and 032's StatefulSet topology, for hosted applications; the placement unit changes from "container + volume + ingress" to "a cell" |
| `app-model.json` extraction | **replaced** | the Rahi manifest as a declared, verified TOML document (2.2); the endpoint table needs a new home or retires with `frontend-admin`'s catalog view |
| Managed application hosting at all | **optional, and an open decision** | O-1 in section 8 |
| `factory/`: stamping from `template.toml` | **retired** | never exercised in production (3.3); the existing-repo path (`mode: adopt`, already built) is the successor shape, re-founded without a template |
| `agents`, `types`, `trust.levels` model sections | **retired** | empty in the extracted model today |

Note the one asymmetry worth arguing about at review: `mode: adopt`
already exists in the factory (`backend/factory/entities.ts`,
`backend/factory/README.md`: "adopt (PR the chassis onto an existing
repo)"). Retiring the factory while keeping the adopt-shaped workflow is
a re-founding, not a port, because adopt today means "overlay the enrahitu
chassis onto your repo" and the successor means "govern the repo you
already have, unchanged". 017 states that plainly rather than letting the
word `adopt` carry it.

### 4.3 The responsibility map

Every authorization and every durable record in the proposed system, with
its single owner. A transition with two owners is a defect; this table
exists so review can find one.

| Authorization or record | Owner | Where it is enforced | State |
|---|---|---|---|
| What a tree's authority state is (ownership, lifecycle, freshness, coupling) | spec-spine | pure computation over explicit inputs; no keys, no clock | AuthoritySnapshot is spec-spine draft 087 |
| How a change classifies against a trusted base | spec-spine | computed under the **base** revision's config | draft 088 |
| Which trees to snapshot, and retaining them | statecraft (hosted) / the operator (local) | 015 | proposed |
| That a runner may take work at all | statecraft | 015 section 4: enrollment and audience-bound token | proposed |
| That this runner may take **this** job | statecraft | 015 section 5: lease with a fencing token | proposed |
| What a candidate may write and must satisfy | spec-spine computes the scope; the executor enforces it | statecraft-cli (fence 125, sandbox draft 126, gate fence draft 129) | WorkScope proposed, not filed |
| That work may begin, by whom, for how long | statecraft or an authorized local operator | 016 section 3: the WorkPermit | proposed |
| That a candidate's gate actually passed | statecraft-cli | `acceptance.receipt`, schema version 1 | **implemented** (CLI spec 121) |
| That a declared verification actually ran | a trusted worker, never the control plane | 015 section 7 (spec-spine's S1) | proposed |
| That an external effect may happen | statecraft | 016: the action permit | proposed |
| The effect itself (push, PR, merge, note) | statecraft-cli's broker, locally | journaled intent and outcome | **implemented** (CLI spec 122) |
| A deployment of a hosted application | statecraft | 016 section 6, gated on build provenance | proposed |
| The attestation chain and its issuer | statecraft | `governance/`, `/data/governance/state` | chain implemented, **issuer absent** (3.5) |
| Tenant, installation, membership | statecraft | `tenants/` | **implemented** |
| A verdict on somebody else's evidence | a neutral verifier, packaged permissively | four separate outcomes, never folded | proposed (CLI D67) |
| Per-repository evidence DAG and its identities | hqgit | its own ledger; never in a chassis store | hqgit spec 003 B-4, B-5 |
| Infrastructure primitives (store, edge, IdP, verbs, packaging) | Rahi | its crates | 010, 011, 020 to 026, 030 to 034 landed |

Two exclusions are as load-bearing as the entries. Rahi owns no tenancy,
no billing and no business authorization. spec-spine holds no key, reads
no clock, resolves no identity and executes nothing on a stranger's
behalf. Anything that needs a key, a clock, a lease or an approval is the
control plane's or the operator's, and that is the whole reason 015 and
016 exist here rather than there.

### 4.4 One complete customer scenario

The scenario the first hosted slice must support, end to end, with the
authority named at each step. Nothing in it requires the customer's
application to run on Rahi.

1. **Sign in.** A person authenticates at the platform IdP (rauthy,
   GitHub OAuth upstream). Authority: the IdP. Record: none in the
   control plane beyond the session; the `sub` is the principal.
2. **Install.** They install the statecraft GitHub App into their own
   org. Authority: GitHub, then statecraft. Records: `installation`,
   `tenant`, `tenant_membership` (the self-serve entry spec 011 already
   built).
3. **Register a repository they already have.** No stamp, no template, no
   PR against their tree. Authority: statecraft, checking the
   installation covers the repository. Record: a project row binding
   `{tenant, installation, repo, default branch}`.
4. **Enrol a runner.** The operator's own machine, or a statecraft-hosted
   worker. Authority: statecraft (015 section 4). Record: a runner row
   with its audience-bound credential's issuer, audience and expiry, never
   the credential.
5. **Name the work.** A spec in the customer's repository, or an
   approved change class. Authority: spec-spine computes what the work
   structurally requires; a human or the tenant's policy approves it.
   Record: a WorkPermit (016) naming actor, scope, validity and fencing.
6. **Run.** The runner takes the job under a lease with a fencing token,
   produces a candidate, gates it, and mints an `acceptance.receipt`.
   Authority: the lease for the job, the local broker for any local
   effect. Records: the job, its heartbeats, the receipt.
7. **Upload evidence.** The runner posts the receipt and its bundle.
   Authority: statecraft validates; it does not execute anything the
   bundle carries and does not accept the bundle's own anchor as a trust
   root. Record: an evidence row with four separate outcomes (integrity,
   subject binding, issuer trust, policy).
8. **Approve.** A second person on the tenant approves the change class
   the delta reports, under the **base** revision's policy. Authority:
   statecraft. Record: the approval, referenced by the action permit.
9. **Publish at an exact revision.** The control plane authorizes the
   effect; the effect itself happens through the broker or the GitHub
   App, and intent and outcome are reconciled rather than assumed atomic.
   Authority: statecraft (016). Records: action permit, intent, outcome.
10. **Explain it afterwards.** One view joins the records into one
    account, with `none`, `not recorded`, `stale` and `unknown` as
    first-class labels.

Steps 1 to 3 exist today apart from the project row. Step 6 exists today
in statecraft-cli, locally and account-free. Steps 4, 5, 7, 8, 9 and 10
are proposed, and that is the honest size of the first slice.

### 4.5 Implemented versus proposed

The packet's new exit criteria ask which guarantees are implemented and
which are proposed. At HEAD:

**Implemented and running in production:** tenant, installation and
membership lifecycle with org-derived access; owner-scoped 404 on
cross-tenant reads; the action gate with a stable config hash; the
hash-linked attestation chain; fleet placement, update, backup and
removal with an intent journal; the extracted and hash-anchored
`app-model.json`; the governed spec spine over this repository itself.

**Implemented in statecraft-cli, locally and account-free:** candidate
worktrees, the credential fence, `acceptance.receipt` version 1, the
action broker over lease and receipt, capability negotiation, the handoff
capsule, lifecycle policy.

**Proposed, nothing built:** every hosted record in 4.3 marked proposed;
the WorkPermit; the action permit; evidence trust classes; runner
enrolment; replay and shadow policy; issuer trust for our own chain.

**Not a guarantee, and should stop being written as one:**
`app-model.json`'s `ledger.signing` block (3.5).

## 5. The durable-state and deployment inventory

Identifiers and relationships, no secret values. This is what a cutover
must carry, and what a restore must reproduce.

### 5.1 Identity

| Object | Where it lives | Identifier | Reconstructible? |
|---|---|---|---|
| IdP subjects and their credentials | `/data/rauthy/db` on `statecraft-data` | rauthy `sub` (uuid) | no |
| The rauthy admin password and bootstrap state | `/data/rauthy/{admin-password,bootstrap}` | n/a | no |
| Access and refresh token signing keys | `/data/keys/*.pem` | n/a | no; self-minted at first boot |
| The rauthy client secret | `/data/keys/rauthy-client-secret` | n/a | no |
| Application user rows | `user_account` (Postgres) | `id` (uuid), `ssoProviderId` (the IdP `sub`), `githubUserId` | keyed to the IdP |
| Live refresh tokens | `refresh_token` (Postgres) | `tokenHash` | disposable |

The binding that matters is `user_account.ssoProviderId` to the IdP's
`sub`. Lose `/data/rauthy` and every row in `user_account` is orphaned;
lose Postgres and every IdP subject is anonymous. Neither volume alone is
a backup of this system.

### 5.2 Tenancy and delivery

| Object | Table | Key relationships |
|---|---|---|
| Tenant | `tenant` | `ownerUserId` to `user_account.id` |
| GitHub App installation | `installation` | `tenantId`; `installationId` unique, and authoritative at GitHub, not here |
| Membership | `tenant_membership` | `tenantId`; `githubUserId` or `userAccountId`; `role`, `source` |
| Stamp job | `stamp_job` | `tenantId`, `installationId`; empty in production |
| Placed application | `fleet_app` | `tenantId`, optional `stampJobId`, `namespace` (`t-<tenantId>`), `host`, `image` |
| Operation | `fleet_op` | `appId`; the intent journal |

`installation.installationId` is the one identifier whose authority is
external. A restore that reproduces every row but does not re-establish
the GitHub App installation restores a tenant that can do nothing.

### 5.3 Evidence

| Object | Where | Notes |
|---|---|---|
| Attestation chain | `/data/governance/state/records.jsonl` | 10 records; the authority |
| Chain anchor | `/data/governance/state/anchor.json` | unsigned (3.5) |
| Index rows | `governance_attestations` (Postgres) | for queries; the file is the authority |
| Trust snapshots | `governance_trust` | empty |
| Gate config hash | `backend/governance/config/gate.v1.json` | `sha256:a0356df3...`, recorded in every allow |
| Audit log | `audit_log` | 32 rows |

The chain and its index can disagree (two stores, one write path). The
file wins by design; a migration has to say so explicitly, because a
database-first cutover would silently make the index the authority.

### 5.4 Secrets and external references

Named, never valued. The live `statecraft-secrets` holds
`FLEET_S3_ACCESS_KEY_ID`, `FLEET_S3_RESTIC_PASSWORD`,
`FLEET_S3_SECRET_ACCESS_KEY`, `GITHUB_APP_ID`,
`GITHUB_APP_PRIVATE_KEY_B64`, `GITHUB_WEBHOOK_SECRET`, `RAUTHY_API_KEY`,
`RAUTHY_S3_ACCESS_KEY_ID`, `RAUTHY_S3_SECRET_ACCESS_KEY` and
`SMTP_PASSWORD`. Beside it: `statecraft-postgres`,
`statecraft-platform-backup`, `statecraft-tls` and `ghcr-pull`. JWT
material is absent by design (self-minted onto `/data`), and
`GOVERNANCEANCHORKEY` is absent in fact (3.5).

External references a cutover depends on: the GitHub App and its one
active installation; three Hetzner Object Storage buckets (rauthy
backups, fleet restic backups, the platform backup); the `app.statecraft.ing`
DNS record and its cert-manager certificate; the `ghcr.io` image
repository; and the SOPS age key held outside the cluster.

## 6. Declared versus enforced, today

What a reader of statecraft's evidence can rely on at `9658e29`.

| Guarantee as declared | Declared where | Enforced by | Holds against |
|---|---|---|---|
| Cross-tenant reads are 404, never 403 | specs 005, 006; `backend/*/README.md` | owner scoping through the tenant | an authenticated caller of another tenant; existence is not leaked |
| Mutating verbs are gated | spec 008; `backend/fleet/gate.ts` | `POST /governance/gate` before the effect | a caller with no posture or no name confirmation; **not** an unreachable governance service on a soft verb (deploy, backup: warn and proceed) |
| Every mutating verb is journaled | spec 006 section 3 | `FleetOp` opened before, closed after | a crash between open and close leaves `running`; reconciliation is not implemented |
| The attestation chain is tamper-evident | spec 008 | hash links over `records.jsonl` | edits to the file; **not** a rebuilt chain with a fresh anchor (3.5) |
| Ledger records are Ed25519-signed | `app-model.json` `ledger.signing` | **nothing** | nothing; `ledgerAnchor` is never called and the key is absent (3.5) |
| The app model is current | `npm run check:model` in CI | a re-extraction compared in the verify workflow | a drifted model on a merged branch |
| `/metrics` is not public | spec 012 | a second Exact-path deny Ingress | the public edge (403, measured) |
| The committed shards are what the corpus compiles to | `AGENTS.md` Freshness | `spec-spine check`, never a writing `compile` | a stale committed ledger; for the index, only the hash fields are compared (spec-spine's own F11) |
| A changed source file is claimed by a spec | `[coupling] require_ownership` | `C-002` at PR time | an unclaimed new file |
| An agent does not weaken the spec it implements | `.claude/rules/adversarial-prompt-refusal.md` | a prompt; the gate passes it | nothing mechanical (spec-spine's F7) |

Two rows are the honest weak points and both have a successor in this
record: the signing row (016 section 5) and the journal-reconciliation
row (016 section 7).

## 7. Requests to sibling repositories

Proposals for each repository's own governance. None changes its contract
from here, and none is a dependency this record assumes satisfied.

**Rahi.**

- R-1. Say whether spec 025's 15-minute access token is renewed for a
  bearer client, and how. A runner's session outlives one token, and
  015 section 4 cannot choose a renewal shape without this. Rahi's own
  answer is also what statecraft-cli's D72 waits on.
- R-2. State the manifest's evolution rule: whether a cell may add
  manifest sections a deployed kernel does not know, and what a kernel
  does with an unknown section. 017 needs this before it can decide where
  the endpoint table from 2.2 lives.
- R-3. Confirm the consumer and recovery contract for a cell that is not
  hqgit: what `restore` guarantees across a version change, and whether a
  cell may carry a second durable store it owns (statecraft's evidence
  chain is a file today, not a hiqlite table).
- R-4. Confirm that tenancy, billing and business authorization stay out
  of the chassis, so 015 and 016 are not duplicating a primitive that is
  about to arrive.

**statecraft-cli.**

- C-1. Accepted: statecraft leads the first runner and evidence wire
  contract (its D71). 015 carries all eight negative cases its section 14
  listed, plus a ninth (a bundle whose issuer is trusted but whose
  subject tree is unavailable, which must be `unknown`, not `pass`).
- C-2. Requested: the receipt and bundle fixtures of its draft 132,
  including the negative set, as the definition of receipt version 1 and
  bundle version 1. statecraft will write no parser before those bytes
  exist, and 015 section 7 says so.
- C-3. Confirmed from this side: the control plane will never execute a
  spec's declared verification (spec-spine's S1). 015 section 7 states it
  as a refusal, not a convention.
- C-4. Requested: agreement on the runner implementation, specifically
  whether the hosted runner is the same engine binary its draft 130
  distributes, configured with a hosted endpoint, or a separate member.
  This determines whether 015's enrolment is a new credential type or a
  new mode of an existing one.
- C-5. Answered: the client registration a native CLI uses is an open
  decision here (O-3), gated on R-1.

**spec-spine.**

- S-1. Accepted: S1, S2 and S3 from its design note 04 section 7. 015 and
  016 carry them as requirements rather than conventions: nothing is
  executed in the plane, `{repo, commit, tree}` is stored beside every
  digest, and an unavailable tree reports `unknown`.
- S-2. Accepted with a caveat: S4, that statecraft leads the composition
  envelope. The caveat is sequencing. The envelope cannot be finished
  before 087's snapshot shape and the receipt version 2 block that
  references it are approved, so 016 fixes the envelope's **rules**
  (separate outcomes, no folded booleans, no self-selected trust root,
  original bytes) and leaves its type names to a later spec.
- S-3. Requested: commit drafts 085 to 088 and the design note. This
  record cites them as uncommitted working-tree files, which is not a
  citable state for an approved spec to depend on.
- S-4. Requested: when ContextClosure is filed, keep `omitted` and
  `truncated` distinct, as statecraft-cli's D69 also asks. A permit that
  claims a complete context is worth nothing if truncation is invisible.

**hqgit.**

- H-1. Requested: a bounded evidence scope. statecraft will reference
  hqgit records by `(type, schemaVersion, SHA-256 of the record bytes)`
  plus subject tree and commit, and will not re-derive hqgit digests or
  mirror its evidence DAG. Its spec 003 B-4 and B-7 already draw this
  line from its side; this is the confirmation from ours.
- H-2. Requested: review of the four verification outcomes (integrity,
  subject binding, issuer trust, policy) against its own verifier, and a
  statement of which it can answer for a repository it hosts.
- H-3. Noted, not requested: hqgit is AGPL-3.0 and statecraft is
  AGPL-3.0, so the boundary is not a licence problem here as it is for
  statecraft-cli. Launch does not depend on hqgit's forge roadmap; 015
  and 016 name no hqgit type.

**statecrafting.** No request. The two native addons (`fleet-native`,
`governance-native`) are pinned dependencies and 017 decides their future
as part of the fleet disposition; an extraction question would be
premature before that.

## 8. Open owner decisions

Recorded as proposals for decision, not resolved here. Each blocks
something named.

- **O-1. Does managed application hosting belong in the initial offer?**
  The packet asks for an explicit decision. Evidence for "no": nothing is
  placed today (3.4), the factory never ran (3.3), and hosting is the
  only part of the product that requires the customer to adopt a
  substrate. Evidence for "yes": the fleet works, it is the only part
  that is metered per unit rather than per seat, and dropping it removes
  the reason the cluster exists. **Recommendation: not in the initial
  offer.** Keep the fleet running and specified, sell governed delivery
  for existing repositories first. Blocks: 017's scope.
- **O-2. Is the control plane itself a Rahi cell before or after the
  hosted slice ships?** Before is cleaner (one substrate, and it proves
  the chassis on ourselves); after is safer (the hosted slice is the
  revenue path and does not require it). Blocks: 017's sequencing.
- **O-3. Which client registration does a native CLI use**, a public
  client with the device grant or dynamic registration, and what scopes
  may it request? Gated on R-1. Blocks: 015 section 4.
- **O-4. What is the first issuer and trust root for our own chain?**
  Options: an operator-held Ed25519 key used in an anchoring ceremony
  (what spec 008 already sketches), a key held by the plane, or an
  external transparency log. Nothing is signed today. Blocks: 016
  section 5, and any claim that our evidence is verifiable by a third
  party.
- **O-5. Where does the neutral verifier live?** statecraft-cli's
  Apache-2.0 `statecraft-journal` crate is the obvious seed and this
  repository is AGPL-3.0, so it cannot be here. Blocks: nothing in 015 or
  016; it is a packaging decision.
- **O-6. Entitlements, metering, retention and support.** Required
  commercially, and the packet is explicit that they must not delay
  proving the core workflow. Recommendation: specify after the first
  hosted slice is accepted, and design 015's records so metering can read
  them rather than needing its own.
- **O-7. Does `app-model.json` survive at all?** 2.2 shows the endpoint
  table has no home in the Rahi ceiling. Either the ceiling grows (R-2),
  or the table moves to a statecraft-owned overlay, or `frontend-admin`'s
  catalog view retires with it. Blocks: 017 section 5.

## 9. Out of scope

- **Any cutover.** This record authorizes nothing to be migrated,
  deployed or retired. It records the design so a human can decide.
- **Amending spec 001.** The successor thesis in section 4 is proposed.
  If this spec is approved, 001 gains a dated lifecycle note pointing
  here; until then 001 stands unchanged and remains the record of what
  was actually built.
- **Amending spec 013.** The drift in 3.7 is reported, not fixed.
- **The wire schemas themselves.** 015 and 016 hold them.
- **Rahi's, spec-spine's, statecraft-cli's or hqgit's internal design.**
  Section 7 asks; it does not decide.
- **Any commercial commitment.** O-6 stays open.
