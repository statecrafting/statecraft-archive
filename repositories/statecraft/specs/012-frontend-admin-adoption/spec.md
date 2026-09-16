---
id: "012-frontend-admin-adoption"
title: "frontend-admin adoption: the platform operator dashboard"
status: approved
created: "2026-07-21"
implementation: complete
depends_on:
  - "001-statecraft-thesis"
  - "002-app-shell"
  - "009-control-plane-deploy"
  - "011-tenant-lifecycle"
establishes:
  - { kind: directory, path: "frontend-admin/" }
  - { kind: directory, path: "backend/admin/" }
  - { kind: directory, path: "backend/obs/" }
  - "app-manifest.json"
  - "app-model.json"
  - "scripts/extract-model.mjs"
summary: >
  statecraft adopts the substrate's flag-gated admin dashboard
  (enrahitu specs 022/023: the observability contract and
  frontend-admin) as the platform operator dashboard promised by
  thesis section 3.4: same-origin, gated on statecraft_operator,
  rendering the platform's own /metrics, traces, service catalog, and
  app model. This is the piece specs 001 and 010 already committed to
  ("platform observability is the in-substrate flag-gated admin
  dashboard"; cluster Grafana was dropped on that promise), landing as
  a chassis capability consumed here, not as platform-original code.
  The domain operator console (all-tenants, spec 011) stays in
  frontend/; frontend-admin is the substrate observability surface.
  The platform's /metrics becomes the scrape target for spec 010's
  in-cluster Prometheus and must not be exposed at the public ingress.
---

# 012: frontend-admin adoption

## 1. Purpose

Thesis §3.4 retired the idea of a platform-external observability
stack: no Grafana OIDC client, no standalone monitoring identity;
"platform observability is the in-substrate admin dashboard". Spec 010
already cashed that promise by dropping cluster Grafana and demoting
Prometheus to an unexposed in-cluster metrics sink with, so far,
nothing to scrape. This spec is where the promise lands: the chassis
grows the dashboard (enrahitu 022/023), and statecraft, as the first
production EnRaHiTu app, turns it on, gates it on
`statecraft_operator`, and points Prometheus at its own `/metrics`.

The boundary with spec 011 is deliberate: frontend-admin is the
substrate surface (what every governed cell gets: metrics, traces,
catalog, app model), while the tenants console is platform domain UI
and lives in `frontend/` under spec 011. Nothing statecraft-specific
is forked into the chassis dashboard.

## 2. Cross-repo dependency

This spec cannot start until, in the enrahitu repo:

- **enrahitu 022 (observability contract)** has landed: `/metrics`
  and OTel tracing with the in-app trace buffer, `app-model.json`
  reporting `observability.otel: true`.
- **enrahitu 023 (frontend-admin)** has landed: the dashboard app,
  its same-origin admin API, the operator-role gate, and the
  template contract bump that names the flag.
- The updated chassis is published/consumable the way spec 002
  imported it (chassis import plus pinned `@statecrafting/*`
  packages; the statecrafting 002/003 repoints should be complete so
  no `@enrahitu/*` names re-enter this tree).

If any of these are missing when a session picks this spec up: stop
and report exactly what is needed; do not mock the dashboard or
hand-roll metrics endpoints here.

## 3. Territory

- `frontend-admin/` (new top-level directory): the platform's copy of
  the chassis admin dashboard, on the same import discipline spec 002
  used for `backend/` + `frontend/` (imported, then owned here).
- Coordinated edits in other specs' territory, each paired with a
  dated pointer amendment: spec 002's chassis plumbing (build wiring,
  admin service enablement), spec 009's deploy env (flag + any new
  non-secret env), spec 010's `infra/` (ingress exclusion for
  `/metrics` and `/admin`, Prometheus scrape config).

## 4. Behavior

- **Adopt, do not fork.** The dashboard arrives from the chassis at a
  pinned enrahitu commit (recorded in this spec when taken), with the
  platform's identity: gated on `statecraft_operator` (the
  `<app>_operator` convention instantiated), branded neutrally as
  shipped by the template.
- **Flag on.** The platform enables the admin surface via the
  mechanism enrahitu 023 defines (stamp-time slot + runtime env);
  statecraft runs with it on in production, since the operator
  dashboard is the platform's own observability.
- **Observability live.** `/metrics` serves the platform's Prometheus
  metrics; OTel tracing is on with the in-app buffer feeding the
  traces surface. Spec 010's Prometheus scrapes the platform Service
  on `/metrics`; the public ingress must not route `/metrics`, and
  `/admin` is reachable only through the app with an authenticated
  operator session (server-side enforced).
- **Access.** Every admin API route and the dashboard itself return
  `permissionDenied` without `statecraft_operator`; `rauthy_admin`
  alone grants nothing here (role separation per thesis §3.3).

## 5. Acceptance

1. An operator (holder of `statecraft_operator`) opens the dashboard
   at the platform origin and sees live platform data: the service
   catalog, at least one real trace, and the app model surface.
2. A signed-in non-operator receives `permissionDenied` on the
   dashboard and on every admin API route; an unauthenticated request
   is redirected to login.
3. In-cluster Prometheus shows the platform target UP and platform
   metric families queryable; `curl https://app.statecraft.ing/metrics`
   from the public internet does not serve metrics.
4. `app-model.json` for the platform records the admin/observability
   posture truthfully (`observability.otel: true`, operator role
   `statecraft_operator`).
5. Gates green: spec-spine compile/index/lint/index check plus the
   chassis npm gates.

## 5.1 Implementation notes (2026-07-22)

Taken against enrahitu commit `950a9be` (specs 022 + 023 complete on its
main). Design points fixed at implementation time, recorded so the prose
above reads precisely.

**Territory, completed.** Acceptance 4 requires `app-model.json`, and §3
never named its producer; the chassis pieces land inside spec 002's
`backend/`. This spec therefore also establishes `backend/obs/` and
`backend/admin/` (the two imported service directories, mirroring
enrahitu 022/023's own establishes), plus the model plane:
`app-manifest.json`, `app-model.json`, and `scripts/extract-model.mjs`.

**The model plane is statecraft-produced, toolchain-observed.** The
chassis's sanctioned producer (`enrahitu-extract`, toolchain 0.3.0)
cannot run here: its verify step presumes the post-021 kernel chassis
(governed facades under `backend/kernel/`, the bare-fetch ban, the hiq
facade), and this backend pre-dates the kernel plane (eight direct
`fetch` sites across idp/auth/tenants/factory, service-local secret
bindings, direct `hiq/init` imports). Adopting the kernel is its own
future front, not this spec. `scripts/extract-model.mjs` therefore
drives the pinned toolchain's own extractor modules (meta decode,
lowering, canonical hashing, and the real `otelObserved` import walk,
so `observability.otel: true` is observed, never declared) and replaces
the kernel-only verify with the statecraft-native checks: manifest
service set equals the built app's, otel declaration equals the
observation, every Encore secret binding declared. `gate.configHash` is
sealed from the governance spine's real gate config via
governance-native's `gateEvaluate` (it matches the addon's pinned
`GATE_V1_CONFIG_HASH`), not the kernel's roster hash. CI runs
`npm run check:model` after every build; `backend/lib/app-model.ts`
re-verifies the canonical integrity hash fail-closed at module load, so
a hand-edited model refuses to boot; `backend/lib/app-model.test.ts`
pins the truth couplings (operator role = tenants' `OPERATOR_ROLE`,
gate hash = the running gate's, service roster = the backend tree).
The manifest declares `capabilities: []` throughout: the platform
enforces no kernel capability ceilings yet, and the model must not
claim governance that is not real.

**Kernel seams, re-pointed at platform truth.** `kernel/boot`'s
`modelJson`/`receipt` become `backend/lib/app-model.ts`; the Overview's
ledger panel renders the spec 008 attestation chain
(governance-native `ledgerVerify`: records, chain verification) instead
of the kernel Decision ledger; the kernel denial observer is dropped
(decision-id span correlation arrives with kernel adoption). Everything
else is adopted verbatim from the chassis: `backend/obs/` (with the
tracer anchor intact), `backend/admin/` (gate, gated static serving of
`backend/web/dist-admin/`, SSE stream), `frontend-admin/` (neutral
"Operator console" identity, renamed `@statecraft/frontend-admin`,
spec-linked here), the jwt-verify split, `operatorRole()` reading the
model, `ADMIN_UI_ENABLED`, and the mock operator principal.

**The cross-repo fixture arm.** enrahitu 023 §4.1 left the pinned
template fixture to this spec: `backend/factory/fixtures/`
`template.v0_6_0.toml` (the real contract 0.6.0 with the `admin` slot)
plus contract tests proving the spec 005 reader accepts 0.6.0 and
stamps with the admin slot riding its default.

**Verified locally (dev run, mock driver):** operator loads `/admin`
(200) with Overview/Catalog/Traces rendering live platform data (12
services, 57 endpoints, verified attestation chain); non-operator gets
403 on the page and `permissionDenied` with
`required: ["statecraft_operator"]` on every admin API; signed-out gets
the login redirect; `/metrics` serves the request/duration/CoreLedger
families and the counters move; the SSE stream opens; the kill switch
404s both surfaces with `/metrics` unaffected. Acceptance 1-4's live
(cluster) arms and 5's CI arm remain for the deploy; status flips to
complete when they hold at app.statecraft.ing.

## 5.2 Closure (2026-07-22): live acceptance holds

Deployed as image digest `ce8edee5` (spec 009's re-pin amendment) and
verified against app.statecraft.ing:

1. **Operator sees live platform data (acceptance 1).** The operator
   (`statecraft_operator` holder) loaded `/admin` at the platform
   origin: Overview renders the model identity (statecraft /
   statecrafting, app-model v0.1.0, model + gate hashes, 12 services /
   57 endpoints / 0 capabilities), the observability posture
   (`/metrics`, OTel on), the operator role, trust levels, gate checks,
   and the verified attestation chain; Catalog lists all twelve
   services, and the inline API caller executed a real
   `GET /health` round trip (200, ~168ms) whose trace, alongside the
   readiness probe's steady `health.health` traffic, appears in Traces
   with the `coreledger.read` child span correctly parented and the
   request attributes populated.
2. **The gate (acceptance 2).** Signed-out `/admin` 302s to login and
   the admin API answers 401 at the public origin (verified live);
   the non-operator `permissionDenied` arm was proven against the same
   server-side code path in the local run above.
3. **Prometheus + ingress posture (acceptance 3).** The in-cluster
   Prometheus shows the pod target UP under the
   `statecraft-annotated-pods` job with `http_requests_total`
   queryable; public `https://app.statecraft.ing/metrics` serves 403
   from the metrics-deny Ingress.
4. **The model records the posture (acceptance 4).** The committed
   `app-model.json` (otel: true, operator role `statecraft_operator`)
   is what the Overview renders. One reading note: the model's
   `source` block records the extract-time git state, and extraction
   necessarily precedes the commit that carries its output, so the
   `uncommittedChanges: true` badge on the Overview is a property of
   the producer, not evidence of prod drift; the freshness gate
   ignores `source` for exactly this reason.
5. **Gates (acceptance 5).** verify + govern CI green on PRs #55/#56;
   the chassis npm gates and the model check run in both workflows.

Follow-ups landed the same day on the spec 011 trail: `RAUTHY_API_KEY`
mounted (PR #57) and the GitHub provider's `auto_onboarding` flipped by
the operator. Spec 011's own live acceptance walk remains its own work.

## 6. Out of scope

- Building dashboard surfaces themselves (enrahitu 023 owns the
  dashboard; defects and features go upstream).
- The tenants/operator domain console (spec 011).
- Per-tenant observability add-ons sold through the fleet (spec 006
  territory, later).
- Alerting and log aggregation.
