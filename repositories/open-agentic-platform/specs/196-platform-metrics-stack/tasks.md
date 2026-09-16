# Tasks: Platform metrics stack (Prometheus + Grafana)

**Input**: [`spec.md`](./spec.md), [`plan.md`](./plan.md)

> Format: `[ID] [P?] Description`. `[P]` = parallelisable with adjacent
> tasks. Tasks track plan.md phases. Phases 1–2 are *deploy-sequencing*
> phases (plan.md §Phasing); both land in one implementation PR because
> the Phase-2 boundary is the operator's manual Rauthy-client step, not
> a separate code drop.

## Phase 0 — Current-state reconciliation *(implementation findings, 2026-06-12)*

The implementation survey falsified three "Current state" claims the
spec body carried from filing time. Each is corrected in spec.md in
this PR (correction-grade edits to a draft body, surfaced in the PR
description — not post-hoc justification of an action that contradicts
the design; the design is implemented as specified):

- [x] T001 deployd-api-rs exposes **no** `/metrics` endpoint (no
  `metrics`/`prometheus` token anywhere in its sources or manifest)
  and its chart carries no scrape annotations. FR-003's "already-
  annotated" premise is false for deployd. → T010/T011 create the
  endpoint + annotations; spec.md §Current state corrected.
- [x] T002 ingress-nginx metrics are **not enabled** — the spec-151
  HelmRelease sets no `controller.metrics.*`; the controller serves
  nothing on :10254. → T012 enables metrics + annotations; spec.md
  §Current state corrected.
- [x] T003 The default-deny posture is applied to **no namespace**:
  `platform/infra/hetzner/post-create.sh` applies only
  resourcequota + limitrange and says "skip default-deny for MVP".
  SC-005 as filed ("an un-allowed egress from statecraft-system is
  still dropped") is unverifiable against the live cluster. →
  FR-006/SC-005 rescoped: `monitoring` ships with the repo's first
  *enforced* default-deny + named flows; the statecraft-system
  egress allow is declared-but-dormant until that namespace gains
  default-deny under its own spec.

## Phase 1 — Data plane (FR-001/002/003/005/006/007/008/010/011)

- [x] T010 deployd-api-rs `/metrics` endpoint:
  `platform/services/deployd-api-rs/src/metrics.rs` (new; hand-rolled
  Prometheus text exposition, zero new crates: `deployd_api_build_info`
  + `deployd_api_uptime_seconds`), route wired in `src/main.rs` beside
  the existing public `/healthz` (no OIDC — Prometheus cannot do the
  client_credentials dance; isolation comes from FR-006(b) instead).
  CI lane: `ci-deployd-api-rs.yml` (check + clippy + test) — already
  routes on `platform/services/deployd-api-rs/**`.
- [x] T011 [P] deployd-api chart scrape annotations:
  `podAnnotations` hook in
  `platform/charts/deployd-api/templates/deployment.yaml` + default
  `prometheus.io/{scrape,port,path}` in `values.yaml`. CD redeploys on
  merge (cd-deployd-api-rs.yml routes on `platform/charts/deployd-api/**`).
- [x] T012 [P] ingress-nginx metrics enablement in the spec-151
  HelmRelease (`gitops/.../infrastructure/ingress-nginx.yaml`):
  `controller.metrics.enabled: true` + pod scrape annotations
  (:10254). 196 takes a `refines:` edge (aspect `metrics-export`).
- [x] T013 `monitoring.yaml` HelmRelease (establishes):
  Namespace + `prometheus-community` HelmRepository +
  kube-prometheus-stack pinned `86.2.2`. Values per FRs:
  `enableRemoteWriteReceiver: true`, `enableAdminAPI: false`
  (explicit — FR-002), `alertmanager.enabled: false` +
  `defaultRules.create: false` (FR-008), retention `15d` / TSDB PVC
  `20Gi` on `hcloud-volumes` (FR-010; plan §Concrete values), Grafana
  PVC `2Gi` on the cluster default class (hcloud CSI has a 10Gi floor
  — deployd values-hetzner T002 verification — so the planned 2Gi
  cannot ride `hcloud-volumes`; local-path matches the rauthy-chart
  persistence precedent), `additionalScrapeConfigs` annotation-based
  pod job over `flux-system`/`deployd-system`/`ingress-nginx`
  (FR-003), k3s-absent component scrapes disabled
  (controller-manager/scheduler/etcd/kube-proxy), CRDs
  `install./upgrade.crds: CreateReplace` (FR-007), admission webhooks
  off (no PrometheusRule authoring surface in scope + keeps
  default-deny ingress simple).
- [x] T014 NetworkPolicies (FR-006, establishes):
  `platform/k8s/policies/monitoring/networkpolicy-monitoring.yaml`
  (default-deny + intra-ns + remote_write 9090 ← statecraft-system
  only + Grafana 3000 ← ingress-nginx + bounded egress). ~~and
  `namespace-baseline/networkpolicy-allow-metrics-egress.yaml`~~ —
  the cross-namespace halves shipped here were WITHDRAWN the same day
  after taking down all public ingress (spec.md §Incident addendum;
  T040). flux-system needs no new allow — Flux ships `allow-scraping`
  permitting :8080 from any namespace.
- [x] T015 Declarative application path (FR-005; *not* post-create.sh —
  growing the imperative bootstrap would run against spec 151's
  thesis): `platform/k8s/policies/kustomization.yaml` (explicit
  resource list — keeps the per-namespace quota/limitrange templates,
  which carry no namespace metadata, out of the apply set) + Flux
  Kustomization `policies`
  (`gitops/.../policies-kustomization.yaml`, dependsOn
  infrastructure) + registration in the root `kustomization.yaml` and
  the DR-stage2 bundle (parity invariant: "reconciles the SAME
  content production reconciles").
- [x] T016 `infra.config.hetzner.json` `metrics` block (FR-001;
  refines): `type: prometheus`, `collection_interval: 60` (≥15s
  floor), literal
  `http://monitoring-prometheus.monitoring.svc.cluster.local:9090/api/v1/write`.
  Schema verified against `encore.dev/schemas/infra.schema.json`
  (integer seconds; `remote_write_url` is env_string — literal OK).
  SC-004 guard: this is the ONLY change under
  `platform/services/statecraft/**`.

## Phase 2 — Grafana + OIDC (FR-004)

- [x] T020 Grafana OIDC values in `monitoring.yaml` (atomic with
  Phase 1's file; the *deploy* phase boundary is the manual client):
  `generic_oauth` against issuer `https://auth.statecraft.ing/auth/v1`
  (endpoints `/oidc/authorize`, `/oidc/token`, `/oidc/userinfo` — the
  paths statecraft itself uses in `api/auth/rauthy.ts`), scopes
  `openid email profile oap` (the `oap` scope maps the
  `platform_role` attribute — `seed-rauthy.mjs` OAP_SCOPE),
  `role_attribute_path` reading `custom.platform_role` (Rauthy nests
  OAP claims under `custom.*` — `auth.server.ts:44`) with top-level
  fallback, locked map `owner|admin → Admin`, `member → Viewer`,
  `role_attribute_strict: true` (unknown/missing role ⇒ no login).
  OIDC-only property: `disable_login_form`, `basic_enabled: false`,
  anonymous off, per-provider `auto_login: true`,
  `disable_initial_admin_creation: true` (no admin credential ever
  exists). Client id/secret arrive via `envFromSecret: grafana-oidc`
  (GF_AUTH_GENERIC_OAUTH_CLIENT_ID/_SECRET) — never in git.
- [x] T021 [P] Grafana ingress `grafana.statecraft.ing` (className
  nginx, `cert-manager.io/cluster-issuer: letsencrypt-prod` — the
  platform-host default per post-create.sh issuer policy; domain
  hardcoded per the rauthy.yaml cluster-subtree convention).
- [x] T022 [P] Manual-client plumbing: `[manual]`
  `GRAFANA_OIDC_CLIENT_ID`/`GRAFANA_OIDC_CLIENT_SECRET` stubs in
  `platform/infra/hetzner/.env.example` (redirect URI pinned exactly
  to `https://grafana.<DOMAIN>/login/generic_oauth`) + conditional
  `grafana-oidc` Secret materialisation in `setup.sh` (mirrors the
  SMTP_USERNAME-conditional `rauthy-smtp-secret` pattern; skips with
  a warning until the operator fills .env and re-runs — the
  documented `[manual]` flow).
- [x] T023 [P] Dashboard provisioning (SC-010 surface):
  `gitops/.../infrastructure/monitoring-dashboards.yaml` ConfigMap
  (`grafana_dashboard` sidecar label) with the OAP Platform Overview
  dashboard: statecraft remote_write panel (provisional expr
  `e_requests_total` — **pinned/corrected when SC-001 records the
  validated series name**), deployd-api (`deployd_api_build_info`),
  Flux (`controller_runtime_reconcile_total`), ingress-nginx
  (`nginx_ingress_controller_requests`), node + kube-state panels.
  kps default dashboards stay off (they lean on the pruned
  defaultRules recording rules — FR-008 no-silent-inheritance).

## Phase 3 — Spec spine + gates *(this PR)*

- [x] T030 spec.md: land the deferred `establishes:`/`refines:` edges
  (frontmatter comment contract from the filing PR) covering every
  path this PR creates/edits; correct §Current state per T001–T003;
  rescope SC-005; FR-003 wording ("already-annotated" → created
  here).
- [x] T031 Registry recompile → featuregraph golden regen
  (`UPDATE_GOLDEN=1`, registry FIRST) → `make pr-prep` (index +
  coupling gate) → `make ci-fast-rust` (deployd clippy/test lane).
- [x] T032 PR with Spec-Drift-Waiver for the mechanical golden bump,
  conventional subject, no AI attribution; enqueue via
  `gh pr merge --auto` once green.

## Phase 4 — Incident hotfix *(2026-06-12, spec.md §Incident addendum)*

- [x] T040 Withdraw the cross-namespace allow halves: delete
  `platform/k8s/policies/namespace-baseline/networkpolicy-allow-metrics-egress.yaml`,
  drop its line from `platform/k8s/policies/kustomization.yaml`, remove
  its `establishes:` edge. The three objects isolated the service pods
  they selected (ingress-nginx all-pods Ingress; statecraft-system
  all-pods Egress; deployd-api Ingress on the shared :8080) — all
  public hosts returned Cloudflare 521. FR-006/SC-005 corrected: an
  allow is never dormant; outside-`monitoring` halves land WITH their
  namespace's default-deny under its own spec.
- [x] T041 FR-010 TSDB PVC fix: `cleanPrometheusOperatorObjectNames:
  true` in `monitoring.yaml` — the 71-char operator-default PVC name
  overflowed hcloud's 63-char volume-label cap
  (`invalid input in field 'labels'`; PVC stuck Pending). Service name
  (FR-001 remote_write literal) unaffected.
- [x] T042 Post-merge: resume the `policies` Flux Kustomization
  (suspended during mitigation), confirm the three deleted objects stay
  pruned and the reduced apply set reconciles; rerun the failed
  `CD statecraft` deploy-hetzner job (and the `CD deployd-api-rs` run,
  which failed on an unrelated GHA cache-export flake). → V011/V012.

## Deploy-time validation checklist *(post-merge; SC evidence lands as a spec.md amendment)*

- [x] V001 SC-001: statecraft series queryable in Prometheus within
  ~60s of a request. **Record the concrete series name** — it is the
  SC-010 anchor and the dashboard-panel correction input (T023).
- [x] V002 SC-002: one known series each from deployd-api
  (`deployd_api_build_info`), Flux
  (`controller_runtime_reconcile_total`), ingress-nginx
  (`nginx_ingress_controller_requests`).
- [x] V003 SC-005 (rescoped): no pre-existing NetworkPolicy weakened;
  negative probe against monitoring's default-deny drops an
  un-allowed flow.
- [x] V004 SC-006: no Alertmanager pods; zero PrometheusRules from the
  release.
- [x] V005 SC-007: Flux-reconciled (no imperative helm in the path),
  CRDs at chart-pinned version, PVC-bounded retention,
  `collection_interval` ≥ 15s.
- [x] V006 SC-008: receiver :9090 unreachable from a generic
  namespace AND from flux-system / deployd-system / ingress-nginx;
  reachable from statecraft-system.
- [x] V007 Manual step: create `grafana` client in Rauthy admin UI
  (confidential, authorization_code + PKCE, exact redirect URI, scopes
  openid email profile oap), fill .env, re-run `./setup.sh`; Grafana
  pod becomes Ready (it blocks on the `grafana-oidc` Secret until
  then — same operator contract as `rauthy-smtp-secret`).
- [x] V008 SC-003: member ⇒ Viewer, owner/admin ⇒ Admin; negative
  non-OIDC probes (`Authorization: Basic`, `Bearer glsa_…`) return
  401/403. *(owner/admin ⇒ Admin driven live; member ⇒ Viewer inferred via
  the shared `role_attribute_path` JMESPath branch and locked map, not
  separately driven, for want of a member-role test user at validation time;
  see spec.md §SC-003 evidence.)*
- [x] V009 SC-009: Grafana :3000 reachable only from ingress-nginx.
- [x] V010 SC-010: the SC-001-recorded series renders in the OAP
  Platform Overview panel; correct the provisional expr if Encore's
  name differs.
- [x] V011 Incident closure (T040): with the `policies` Kustomization
  resumed on the reduced apply set, the three withdrawn NetworkPolicies
  are absent and all four public hosts (`statecraft.ing`, `auth.`,
  `deploy.`, `minio.`) return non-5xx through Cloudflare; the
  `seed-rauthy` job completes on the rerun deploy.
- [x] V012 Incident closure (T041): `kubectl get pvc -n monitoring`
  shows the Prometheus TSDB PVC `Bound` on `hcloud-volumes` and
  `prometheus-monitoring-0` Running.

## Follow-ups (owned by other specs, not 196)

- **Cross-namespace HTTP-01 solver allow.** The solver default-deny gap fixed
  here for `monitoring` also exists in `statecraft-system`, `deployd-system`,
  and `rauthy` (all issue via the HTTP-01 `letsencrypt-prod` ClusterIssuer;
  `minio.` lands in `statecraft-system` under the same issuer). Certificate
  *renewal* for `statecraft.ing`/`auth.`/`deploy.`/`minio.` will 502 at the
  next ACME cycle until each owning spec adds an
  `allow-acme-solver-from-ingress-nginx` equivalent to its namespace policy.
  Tracked here so the risk is not lost; 196 does not `establishes:` those
  policy files, so the fix belongs to those specs.

## Deferred (per plan.md §Out of scope)

- Per-component resource requests/limits for the stack — revisit at
  the FR-009/FR-010 promotion trigger. The monitoring namespace also
  deliberately gets no ResourceQuota/LimitRange in this landing
  (Prometheus memory is workload-shaped; quota tuning belongs with
  the same trigger).
- Azure binding type (FR-009 deferred-null; `infra.config.json`
  untouched — SC-004).
- Alerting / logging / tracing — separate specs.
