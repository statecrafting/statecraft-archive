---
id: "001-statecraft-thesis"
title: "statecraft: the governed agentic delivery control plane"
status: approved
created: "2026-07-14"
implementation: n-a
depends_on:
  - "000-bootstrap"
establishes:
  - "README.md"
summary: >
  The product thesis and the consolidation record, rewritten ground-up on
  2026-07-19 from the grand-refactor realignment. statecraft is the
  control plane for governed AI-native software delivery: intent becomes
  a governed spec, the factory stamps an application from the EnRaHiTu
  template, the fleet operates the resulting governed cells, and the
  customer's code lives in the customer's GitHub org the entire time. The
  architecture is a two-plane model: the platform is ONE EnRaHiTu app
  (embedded rauthy as THE platform IdP, operator surfaces gated on a
  custom statecraft_operator role, observability via the in-substrate
  flag-gated admin dashboard) and every tenant app is ANOTHER,
  independent EnRaHiTu app (its own IdP, its own state, its own
  /metrics). Every app honors the substrate observability contract and
  carries app-model.json, the hash-anchored extracted record of what it
  contains and what it is permitted to do; enforcement phases in behind
  the model (Phase A: extraction, kernel adjudication, Decision ledger;
  Phase B: the Rust effect tier). This spec records the consolidation
  history, the service map, and the milestone ladder that orders the
  build.
---

# 001: statecraft thesis

## 1. Purpose

statecraft sells one loop: **intent -> governed spec -> factory-stamped
app -> governed cell -> operated fleet**, with code sovereignty (the
customer's repos, in the customer's GitHub org) as a first-class
property, not a concession. The control plane charges for seats and
per-app backend hosting; the EnRaHiTu single-container shape (one image +
one volume, no managed Postgres/Redis/Auth0 in COGS) is the unit-economics
weapon, and Turso replica sync is the natural paid durability tier.

What statecraft sells is not deployment but governance made verifiable.
Every privileged act of the platform is gated, recorded, and
independently verifiable (spec 008), and the same discipline extends into
every application it stamps: each app is a **governed cell** carrying an
extracted, hash-anchored model of what it contains and what it is
permitted to do (§3.5). Encore cannot occupy this point in the design
space because it externalizes state and treats governance as out-of-band;
the governed cell embeds identity and consensus and lets one extracted
model drive validation, capability enforcement, and an append-only audit
chain.

## 2. What consolidates here

Two consolidation events shape this spec.

**2026-07-14, the OAP consolidation.** This repo consolidates the Open
Agentic Platform research era. The OAP monorepo (224 specs) is the design
archive; designs lifted from it are cited as
knowledge://open-agentic-platform/... links rather than migrated
wholesale.

| Predecessor | Fate here |
|---|---|
| `platform/services/statecraft` (Encore.ts SaaS, OAP) | Rebuilt as the control plane services on the EnRaHiTu substrate |
| `deployd-api-rs` (axum + hiqlite K8s orchestrator, OAP) | Orchestration core becomes `addon/fleet-native` (napi-rs, in-process); the axum HTTP layer disappears |
| `factory-encore` (repo stamping) | Absorbed as the factory service, consuming enrahitu's versioned template contract (enrahitu spec 009) |
| OPC (Tauri desktop cockpit, OAP) | Retired as a desktop app; governance verbs move to the statecraft-cli repo (CLI + MCP server) |
| `template-encore` (previous chassis) | Retired after absorption into enrahitu (enrahitu spec 010) |

**2026-07-19, the grand refactor.** This thesis was rewritten ground-up
from the grand-refactor realignment record
(knowledge://grand-refactor/00-directional-vectors through
03-app-model-contract): the two-plane model, embedded rauthy as the
platform IdP, the substrate observability contract, and app-model.json
as the governance seam all enter here. The realignment's fork
resolutions are decided input to this spec, not open questions to
re-litigate. The 009 (deploy) and 010 (cluster) realignments to this
rewrite follow in their own specs.

## 3. Architecture: the two-plane model

statecraft is the first production EnRaHiTu app, deliberately: every
fleet operation sold to customers is rehearsed on the platform itself
first.

### 3.1 Two planes

- **statecraft-the-platform is ONE EnRaHiTu app.** It hosts the platform
  IdP (embedded rauthy, §3.3), the control-plane services, and the
  flag-gated admin dashboard. Its own observability is the in-substrate
  dashboard (§3.4).
- **Each tenant app is ANOTHER, independent EnRaHiTu app.**
  Self-contained: its own embedded rauthy for its end-users, its own
  state, its own `/metrics`. It can be fleet-operated on statecraft's
  cluster or exported to the customer's own infrastructure, unchanged.

Consequences: multi-tenancy is ordinary rauthy multi-user plus a GitHub
upstream provider, and a tenant is a GitHub App installation (§4);
portability is inherent, because every app is a complete solution rather
than a slice of a shared platform; and the platform's stack choices are
local to the platform app, so nothing the platform picks for itself
constrains a tenant.

### 3.2 The platform app

- **One container.** The control plane ships in the EnRaHiTu
  single-container shape: embedded rauthy is the platform IdP, hiqlite
  runs in-process (cache, rate limits, coordination), CoreLedger owns
  durable state.
- **CoreLedger is the data API** (spec 003; enrahitu spec 011). The
  control plane carries webhook bursts, audit writes, and multi-tenant
  state, so it runs the Postgres driver while stamped customer apps run
  the same decorator API on libSQL/Turso. No direct SQL client and no
  Encore `SQLDatabase` anywhere; the driver-swap scaling thesis is
  validated on ourselves. The hermetic one-container-one-volume claim
  belongs to stamped apps; the control plane is allowed to be a
  platform-grade K8s deployment (specs 009/010).
- **Fleet v1 targets the statecraft-owned hetzner-k3s cluster** (spec
  010) via the deployd orchestration core (spec 006); the unit of
  placement is "one EnRaHiTu container + one volume + one ingress". No
  raw-docker rebuild.
- **The governance UI is not a template flavor.** The platform frontend
  (Vite + React Router v7, spec 007) owes nothing to template frontend
  stack choices. The substrate's own React-only convergence makes the
  stacks coincide, but by merit, not obligation.

### 3.3 Identity: one rauthy, role-separated

- **Embedded rauthy is THE platform IdP.** The control plane hosts it
  in-container. There is no standalone cluster rauthy and no second IdP;
  the 010 realignment retires the cluster instance.
- **One rauthy, two audiences.** Customers authenticate here (GitHub
  OAuth as an upstream provider) and create tenants; operators
  authenticate here with an operator role. Operator-plane vs
  customer-plane separation is a role + same-origin gating concern, not
  a second IdP. Tenant end-users never appear in the platform IdP (they
  live in their tenant app's own embedded rauthy, §3.1), so its
  population is exactly customers-as-tenant-owners plus operators.
- **The operator role is a custom `statecraft_operator` role, not
  `rauthy_admin`.** `rauthy_admin` administers the IdP itself (users,
  clients, providers) and stays with break-glass accounts; the admin
  dashboard and every operator surface gate on `statecraft_operator`.
  Stamped tenant apps inherit the same mechanism as an `<app>_operator`
  convention at stamp time. This costs nothing and removes the failure
  mode where every platform operator can silently edit the identity
  plane.
- **Accepted trade-off:** the control plane is the auth SPOF for the
  platform. That is thesis-consistent (a single container that IS the
  platform), and single-tenant self-host degenerates to operator-only,
  which is trivially fine.

### 3.4 Observability: a substrate contract, not a platform stack

- **Per-app contract.** Every EnRaHiTu app (the control plane and every
  stamped tenant app) exposes the standard signals: a Prometheus
  `/metrics` endpoint and OTel traces. This is a non-negotiable substrate
  capability, recorded in the app model (§3.5).
- **Platform observability is the in-substrate admin dashboard.** The
  encore.dev-style dashboard is rebuilt into the substrate as the
  first-class, flag-gated `frontend-admin`, same-origin behind
  `statecraft_operator`. No separate Grafana OIDC client, no standalone
  monitoring identity.
- **Tenant portability is preserved by construction.** A tenant app's
  `/metrics` can be scraped by the customer's own Prometheus + Grafana,
  rendered by the in-substrate dashboard, or shipped to a cloud tool;
  the platform's observability choice never constrains a tenant's. The
  fleet (spec 006) may offer per-tenant Grafana/Prometheus as an add-on.

### 3.5 The governed cell and app-model.json

The grand refactor's central addition to the thesis. Every EnRaHiTu app
is a governed cell: embedded identity (rauthy), embedded consensus and
coordination (hiqlite), durable state behind CoreLedger, and one
extracted model, **`app-model.json`**, describing what the app contains
and what it is permitted to do.

- **The model is the sibling of `template.toml`, never its replacement.**
  `template.toml` (enrahitu spec 009) is the stamp-time contract between
  template and factory; the model is the build/run-time contract of the
  app itself, produced inside the app's own build after stamping. The
  factory keeps reading `template.toml` and nothing else; it never
  parses a model. The fleet may record the model hash as placement
  metadata but never parses the model's interior.
- **One model, two producers, hash-anchored, drift-enforced.** The model
  is language-neutral JSON produced by the TS-tier static extractor
  (and, in Phase B, merged with the Rust-tier registry), canonicalized
  and integrity-hashed via the family primitives
  (canonical-keysort-json, attest-ledger hashing). The committed model
  is a governed derived artifact in the spec-spine sense: a stale or
  hand-edited model fails the coupling gate. Never in the model:
  credentials, connection strings, hostnames, environment values,
  timestamps.
- **Declare-verify-enforce, deny-by-default.** Capability declarations
  are the authoritative ceiling; the extractor verifies observed usage
  is a subset of the declaration at build time; the kernel enforces the
  declaration at runtime. Any operation outside a handler's effective
  capability set is denied and ledgered as a Decision. The deploy's
  ledger genesis record commits to the model hash.
- **The contract is owned upstream.** The schema, determinism rules,
  and versioning of app-model.json belong to the new enrahitu spec
  spine, which absorbs the grand-refactor v0.1 draft
  (knowledge://grand-refactor/03-app-model-contract) as its starting
  point. This thesis binds statecraft to produce and consume the model,
  not to define it.

**The seam is the model, not the kernel.** Enforcement phases in behind
the model, and every phase produces or consumes the same artifact:

- **Phase A (near-term; rides the enrahitu substrate rewrite):**
  extraction from day one (encore meta + capability manifest lowered to
  app-model.json, verified, hash-anchored); the governance kernel at the
  existing napi boundary (`@statecrafting/kernel-native`, the
  generalization of chancery's kernel: gate + ledger + trust as a pure
  function), adjudicating the operations that already route through
  Rust; and the Decision ledger live, with genesis committing to the
  model hash and denials and grants appending as Decisions. This gives
  the whole TS tier attempt-deny-audit semantics with no new runtime
  machinery.
- **Phase B (the deep axis):** the Rust handler tier with compile-time
  capability rows, effect dispatch as the only path from handler to
  kernel, actor mailboxes as the isolation and audit boundary, and cell
  clustering as hiqlite Raft membership. Phase B's extractor merges into
  the same model, so swapping it in is invisible to every consumer.
- **Enforcement asymmetry, stated honestly.** The TS tier is
  disciplinary and auditable (attempt-deny-audit), not a sandbox; the
  Rust tier is cannot-express (a capability escalation is a reviewed
  diff, not a runtime event). Tier by privilege: TypeScript for breadth,
  Rust for the crown jewels.

### 3.6 Service map

```
backend/         the Encore.ts app (chassis convention, spec 002)
  auth/ idp/     EnRaHiTu auth baseline + embedded rauthy, platform-flavored (§3.3)
  core/          CoreLedger (chassis) + the Postgres driver (spec 003; enrahitu spec 011)
  tenants/       GitHub App installations, workspaces, invites (spec 004)
  factory/       stamping; reads template.toml and nothing else (spec 005)
  fleet/         deploy / update / backup orchestration over fleet-native (spec 006)
  governance/    ledger + gate + trust APIs over governance-native (spec 008)
  web/ health/ hiq/ lib/   chassis plumbing (spec 002)
addon/           fleet-native + governance-native (napi-rs; the AGPL-3.0
                 control-plane addons, consolidating into the statecrafting
                 workspace as @statecrafting/* packages)
frontend/        governance UI (Vite + React Router v7, spec 007)
frontend-admin/  flag-gated operator dashboard (§3.4); arrives with the
                 substrate rewrite, gated on statecraft_operator
```

Substrate packages arrive as pinned dependencies, not in-tree source:
today the `@enrahitu/*` toolchain and hiqlite addon (spec 002),
consolidating into `@statecrafting/*` (toolchain, hiqlite-native, and
the planned kernel-native). Services graduated into their own numbered
specs as their builds started; this thesis holds the map.

## 4. Tenancy

Per-customer GitHub App installation (the Vercel/Renovate pattern): a
customer authenticates at the platform rauthy (GitHub OAuth upstream,
§3.3), creates a tenant, installs the statecraft GitHub App into their
own org, and everything the platform does for them keys off
`installation_id` (spec 004). Nobody joins our org; stamped repos are
born in the customer's org. Code sovereignty is a selling point, not a
limitation.

The two-plane model keeps tenancy small: a tenant's end-users
authenticate against the tenant app's own embedded rauthy, never against
the platform's, so "multi-tenancy" never grows platform-side machinery
beyond ordinary rauthy users and GitHub App installations.

## 5. Licensing

AGPL-3.0 for this repo: the SaaS shield (hosting a modified control
plane commercially requires publishing the modifications) while keeping
the free self-hosted single-tenant tier real. The artifacts customers
touch stay permissive, so stamped apps are unencumbered: the enrahitu
template is Apache-2.0, statecraft-cli is Apache-2.0 (the funnel and the
MCP bridge), and the substrate packages (`@statecrafting/toolchain`,
`hiqlite-native`, the planned `kernel-native`) are Apache-2.0 because
stamped apps consume them. The AGPL shield is reserved for the
control-plane addons (`governance-native`, `fleet-native`), on which no
permissive package may depend. No open-core split is pre-built; a closed
sliver gets carved out only when something is genuinely worth closing.

## 6. Milestone ladder

Each milestone falsifies a hypothesis before the next spends effort.
Status recorded as of the 2026-07-19 rewrite:

- **M1: template contract.** enrahitu publishes template.toml (enrahitu
  spec 009, v0 landed 2026-07-14); the factory consumes only it.
  **Done.**
- **M2: stranger onboarding.** A person who has never seen the system
  goes from login to a running stamped app in 15 minutes (specs
  004/005/007 + the GitHub App flow). The services are built; the live
  rerun happens on the realigned deploy (the 009 rewrite) against the
  rewritten substrate.
- **M2.5: the model on ourselves** (new, from the grand refactor).
  statecraft rides the rewritten substrate and becomes the first
  governed cell: app-model.json extracted, verified, and hash-anchored
  under this repo's coupling gate; kernel-native adjudicating privileged
  operations; the Decision ledger's genesis committing to the model
  hash. Falsifies: one extracted model can drive validation, enforcement,
  and audit for a production app (the surpasses-encore claim in
  miniature). Numbered fractionally so M3-M5 keep the identities other
  specs already cite.
- **M3: fleet of ten.** Ten stamped apps operated on one box (spec 006 +
  fleet-native), with update and backup verbs exercised. After M2.5 the
  ten are governed cells, and the fleet records each cell's model hash
  as placement metadata.
- **M4: the agent bridge.** statecraft-cli's MCP server lets an agent
  request approvals, check coupling, and trigger factory stages under
  governance. After M2.5 an agent is a first-class model entry (a
  capability row plus a trust level), and every agent-triggered effect
  is adjudicated and ledgered.
- **M5: three paying agencies.** The verdict. Everything before M5 is
  preparation.

Phase B (the Rust effect tier, §3.5) deliberately has no rung: it phases
in behind the model without blocking any milestone.

## 7. Out of scope

- Migrating the OAP spec corpus (harvest with provenance links only).
- Template authoring and the template contract (enrahitu repo).
- The app-model contract's schema, determinism rules, and versioning:
  owned by the new enrahitu spec spine (§3.5); statecraft produces and
  consumes the model, it does not define it.
- The Phase B runtime internals (the effect crate, actor mailboxes, cell
  clustering): their own specs when their builds start, behind the model
  seam.
- CLI/MCP implementation (statecraft-cli repo).
- Multi-cloud fleet targets; v1 is the statecraft-owned hetzner-k3s
  posture (spec 010).
- Executing the 009 (deploy) and 010 (cluster) realignments: this spec
  records their required direction (§3.3, §3.4); the work lands in those
  specs.

## 8. Lifecycle note (2026-09-11): this spec is a record

`implementation` moves from `pending` to `n-a`. The thesis is a record, not
a work order: there is no code whose landing would make it "complete", and
`AGENTS.md` has said so in prose since the corpus began. While it sat at
`pending`, `spec-spine registry plan` offered it as ready work and reported
specs 010 and 011 as blocked on a dependency that could never resolve. The
flip is a correction to the scheduler's view, not a change to anything this
spec claims or requires. See specs/013-agent-harness/spec.md section 4.4.
