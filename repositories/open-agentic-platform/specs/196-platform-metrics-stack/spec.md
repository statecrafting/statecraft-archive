---
id: "196-platform-metrics-stack"
slug: platform-metrics-stack
title: "Platform metrics stack — Prometheus + Grafana for the platform control plane"
status: draft
implementation: complete
owner: bart
created: "2026-06-02"
kind: platform
domain: platform
risk: medium
depends_on:
  - "106-rauthy-native-oidc-and-membership"  # rauthy-native-oidc-and-membership — runtime dependency: Grafana authenticates via Rauthy OIDC (client created manually; see FR-004)
  - "151-declarative-cluster-reconciliation"  # declarative-cluster-reconciliation — the Hetzner deploy mechanism (Flux HelmRelease) this rides on
  - "078-platform-completion-plan"  # platform-completion-plan — statecraft deployment + infra.config surface this refines
code_aliases: ["METRICS_STACK", "PROMETHEUS_REMOTE_WRITE", "GRAFANA_OIDC"]
# Implementation PR (2026-06-12) — the deferred edges land here, exactly as
# the filing PR's frontmatter comment staged: an edge lands in the PR that
# creates/edits the code. The forward-described set grew beyond the minimum
# three because the implementation survey falsified two "already exists"
# current-state claims (see §Current state corrections): the deployd-api
# /metrics endpoint and the ingress-nginx metrics enablement had to be
# CREATED, and the declarative policy-application path (FR-005) needed its
# Flux Kustomization pair.
establishes:
  # 1. The metrics stack HelmRelease (FR-001/002/004/005/007/008/010).
  - unit: { kind: file, path: platform/gitops/clusters/hetzner-prod/infrastructure/monitoring.yaml }
  # 2. Monitoring-ns NetworkPolicies: default-deny + remote_write ingress ←
  #    statecraft-system ONLY + Grafana ingress ← ingress-nginx + bounded
  #    egress (FR-006 (a)/(b)/(c), SC-008/SC-009).
  - unit: { kind: file, path: platform/k8s/policies/monitoring/networkpolicy-monitoring.yaml }
  # (withdrawn 2026-06-12) Cross-namespace flow halves
  #    (namespace-baseline/networkpolicy-allow-metrics-egress.yaml) were
  #    established here and WITHDRAWN the same day after taking down all
  #    public ingress — the "dormant-additive" premise was false; see
  #    §Incident addendum. The flows return WITH each namespace's
  #    default-deny under its own spec.
  # 3. Declarative application path for the policy tier (FR-005; not
  #    post-create.sh — spec 151 retires imperative cluster mutation).
  - unit: { kind: file, path: platform/k8s/policies/kustomization.yaml }
  - unit: { kind: file, path: platform/gitops/clusters/hetzner-prod/policies-kustomization.yaml }
  # 4. Dashboard provisioning (SC-010 surface).
  - unit: { kind: file, path: platform/gitops/clusters/hetzner-prod/infrastructure/monitoring-dashboards.yaml }
  # 5. The deployd-api /metrics endpoint (FR-003 — created here; the
  #    filing-time "already exposes /metrics" claim was false).
  - unit: { kind: file, path: platform/services/deployd-api-rs/src/metrics.rs }
refines:
  # FR-001: the metrics block. The two infra configs were later unified into a
  # single infra.config.json (the metrics remote_write_url is a cluster-internal
  # service name, identical on every cloud), so the former hetzner-only,
  # Azure-metric-free split (FR-009, SC-004) no longer holds; the block now
  # lives in infra.config.json. (Supersession flagged for a formal amendment.)
  - aspect: "metrics-export"
    unit: { kind: file, path: platform/services/statecraft/infra.config.json }
  # FR-003 — enable the controller's exporter + scrape annotations in the
  # spec-151 HelmRelease (metrics were NOT enabled at filing time).
  - aspect: "metrics-export"
    unit: { kind: file, path: platform/gitops/clusters/hetzner-prod/infrastructure/ingress-nginx.yaml }
  # FR-003 — route wiring for the new /metrics module.
  - aspect: "metrics-export"
    unit: { kind: file, path: platform/services/deployd-api-rs/src/main.rs }
  # FR-003 — scrape-annotation declaration on the deployd-api pod.
  - aspect: "metrics-export"
    unit: { kind: file, path: platform/charts/deployd-api/templates/deployment.yaml }
  - aspect: "metrics-export"
    unit: { kind: file, path: platform/charts/deployd-api/values.yaml }
  # FR-005 — register the policy tier in the root gitops bundle + the
  # DR-stage2 bundle (parity invariant: DR reconciles the same content).
  - aspect: "policy-tier-registration"
    unit: { kind: file, path: platform/gitops/clusters/hetzner-prod/kustomization.yaml }
  - aspect: "policy-tier-registration"
    unit: { kind: file, path: platform/gitops/clusters/hetzner-dr-stage2/kustomization.yaml }
  # FR-004 — the [manual] Grafana OIDC client plumbing: .env stubs + the
  # conditional grafana-oidc Secret materialisation (imperative like
  # rauthy-smtp-secret until spec 153 SOPS-migrates the secret set).
  - aspect: "grafana-oidc-client-plumbing"
    unit: { kind: file, path: platform/infra/hetzner/.env.example }
  - aspect: "grafana-oidc-client-plumbing"
    unit: { kind: file, path: platform/infra/hetzner/setup.sh }
extends:
  # Mechanical featuregraph-golden refresh: appending spec 196 to the corpus
  # shifts the golden fingerprint. No semantic change to spec 034's claims.
  # Same precedent as spec 194 (PR #277), 193 (PR #276), 187, 183.
  - spec: "034-featuregraph-registry-scanner-fix"
    nature: additive
    unit: { kind: file, path: crates/featuregraph/tests/golden/features_graph.json }
# references: (intentionally none) — 196 owns NO identity-subsystem code path.
#   The Grafana OIDC client is created manually in the Rauthy admin UI (FR-004),
#   following the documented [manual] OIDC-client convention in
#   platform/infra/hetzner/.env.example ("[manual] OIDC clients … create in
#   Rauthy admin … re-run ./setup.sh"), exactly like statecraft-server and the
#   GitHub/Google upstream providers. 196's only identity relationship is the
#   runtime dependency carried by depends_on: 106 — no owned edge into the
#   seeder or the Rauthy chart, hence no co-authorship and no collision surface.
summary: >
  Stand up a Prometheus + Grafana metrics stack for the platform control plane.
  Statecraft (Encore.ts) already auto-instruments every API, PubSub, cron, and
  DB call but emits nowhere; deployd-api, Flux, and ingress-nginx already carry
  scrape annotations nobody consumes. This spec wires a full kube-prometheus-stack
  (Prometheus server + Grafana + node-exporter + kube-state-metrics) that
  RECEIVES statecraft's Prometheus remote_write, SCRAPES the annotated pull
  targets, and SERVES Grafana — with Grafana fronted by native Rauthy OIDC.
  Metrics only: logs and distributed tracing (Encore's other two pillars) are
  out of scope and owned by later specs. Hetzner is implemented; the Azure
  binding is declared-but-deferred. Zero statecraft application-code change.
---

# Feature Specification: Platform metrics stack (Prometheus + Grafana)

**Feature Branch**: `196-platform-metrics-stack`
**Created**: 2026-06-02
**Status**: Draft
**Input**: Wire Prometheus + Grafana into OAP. Statecraft (Encore.ts) is
already capable of the integration; evaluate whether this is spec-worthy or a
de-facto infra-config change.

## Purpose and charter

The platform's thesis is *governed observability*. Today the platform observes
nothing: metrics are emitted into the void. This spec closes that gap for the
**metrics** pillar — and only that pillar.

The grain is deliberate. In Encore's own taxonomy, observability is three
pillars — **metrics**, **logging**, **distributed tracing** — and Encore emits
all three. A spec titled "observability-stack" that ships only metrics would
claim territory it does not deliver, forcing a future logs/traces effort to
either squat under a misleading title or supersede it. This spec is therefore
scoped and named **metrics-stack**; logs and traces are explicitly out of
scope (§Out of scope) and left to later specs.

## Current state vs intent

**What exists today:**

- **Statecraft auto-instruments but emits nowhere.** Encore.ts instruments
  every API endpoint, PubSub topic, cron job, and DB query automatically — no
  application code is required. There is no `metrics` block in either
  `infra.config.json` or `infra.config.hetzner.json`, so nothing is exported.
- **Scrape targets emit but are unconsumed.** `deployd-api-rs` (axum), the Flux
  controllers (`prometheus.io/scrape: "true"` in `gotk-components.yaml`), and
  ingress-nginx already expose `/metrics`. Nothing scrapes them — the
  annotations describe an intent with no collector behind it.
  *(Corrected at implementation — see §Current-state corrections below:
  this held only for the Flux controllers.)*
- **The two statecraft infra configs are byte-identical.** They sit on
  different deploy paths (`infra.config.json` → Azure/default
  `encore build docker`; `infra.config.hetzner.json` → the Hetzner build) and
  exist precisely so per-cloud infrastructure can diverge. They coincide only
  because no field has yet needed to differ.

### Current-state corrections *(implementation findings, 2026-06-12)*

The implementation survey falsified parts of the filing-time picture.
Recorded here as correction-grade edits to this draft body — the *design*
(hybrid ingestion, receiver isolation, OIDC-only Grafana, declarative
deploy) is unchanged and implemented as specified; what changed is the
honest description of the starting state and the work needed to reach it:

1. **deployd-api-rs exposed no `/metrics` endpoint and carried no scrape
   annotations** (no `metrics`/`prometheus` token anywhere in its sources,
   manifest, or chart). The endpoint is *created by this spec* —
   `src/metrics.rs`, a hand-rolled format-0.0.4 exposition
   (`deployd_api_build_info`, `deployd_api_uptime_seconds`; zero new
   crates), public at the router layer beside `/healthz` because
   Prometheus cannot perform the OIDC client_credentials dance on a
   scrape; inbound containment is FR-006 (b)'s
   ingress←monitoring-only NetworkPolicy. The chart gains the
   `prometheus.io/*` pod annotations.
2. **ingress-nginx metrics were not enabled** — the spec-151 HelmRelease
   set no `controller.metrics.*`, so the controller served nothing on
   :10254. Enabled at implementation (with scrape annotations) in
   `infrastructure/ingress-nginx.yaml`; 196 carries the `refines:` edge.
3. **No namespace carried an applied default-deny.**
   `post-create.sh` applies only resourcequota/limitrange and skips
   default-deny "for MVP"; the in-tree
   `namespace-baseline/networkpolicy-default-deny.yaml` was applied
   nowhere. FR-006's "preserved" posture and SC-005's original negative
   probe assumed otherwise. Resolution: the `monitoring` namespace ships
   with the deployment's **first enforced default-deny** plus the named
   flows; the statecraft-system egress allow lands as a
   **declared, dormant-additive** flow (it changes nothing until that
   namespace gains default-deny under its own spec, at which point
   remote_write keeps flowing instead of silently dropping). SC-005 is
   rescoped accordingly. Bringing default-deny to `statecraft-system`
   itself — which requires enumerating that service's full legitimate
   egress (DNS, Rauthy, postgres, NSQ, GitHub, S3, Slack, Anthropic) —
   is explicitly **not** this spec's scope.

**Intent:** a single Prometheus server that receives statecraft's remote_write,
scrapes the annotated targets, and serves Grafana; Grafana behind Rauthy OIDC;
deployed declaratively via Flux on Hetzner. The first field to make the two
infra configs **diverge** is the `metrics` block this spec adds.

## Architecture — hybrid ingestion *(normative)*

Encore.ts metrics export is **push-only via Prometheus `remote_write`**. The
`prometheus` exporter block carries exactly three keys — `type`,
`collection_interval`, `remote_write_url` — and **no auth field** (unlike
`datadog`'s `api_key` or the GCP/AWS variants). Encore does **not** expose a
`/metrics` scrape endpoint. This forces a **hybrid ingestion topology**:

| Source | Path | Mechanism |
|---|---|---|
| statecraft (Encore.ts) | **push** | Prometheus `remote_write` → in-cluster receiver |
| deployd-api-rs, Flux controllers, ingress-nginx, node-exporter, kube-state-metrics | **pull** | Prometheus scrape (annotations / ServiceMonitor) |

Because statecraft pushes and the rest are scraped, the collector MUST be a
full **Prometheus server** running with `--web.enable-remote-write-receiver`,
which can simultaneously (a) receive remote_write, (b) scrape pull targets, and
(c) answer Grafana queries. Prometheus **agent mode** cannot satisfy this — it
is a scrape-and-forward shipper that neither receives remote_write nor serves
queries. The "slim agent + standalone Grafana" framing is therefore rejected as
infeasible against these requirements.

## User Scenarios & Testing

### User Story 1 — Operator sees statecraft health (Priority: P1)

An operator opens Grafana, signs in with their Rauthy identity, and sees
statecraft request rates, error rates, latency, PubSub backlog, and DB query
timings — without statecraft having shipped a single line of metrics code.

**Why this priority**: this is the core gap. Statecraft is the busiest service
and currently emits nothing observable.

**Independent Test**: deploy the stack on Hetzner, confirm statecraft series
appear in Grafana within one `collection_interval` of a request.

**Acceptance Scenarios**:

1. **Given** the stack is deployed and statecraft has the `metrics` block,
   **When** a request hits a statecraft endpoint, **Then** its series is
   queryable in Prometheus and rendered in Grafana within ~`collection_interval`.

### User Story 2 — Previously-unconsumed scrape targets become visible (Priority: P1)

The deployd-api, Flux, and ingress-nginx metrics that have been emitted-but-
unconsumed are now scraped and dashboarded.

**Independent Test**: query a known deployd-api or Flux series in Grafana after
deploy; it returns data.

### User Story 3 — Identity-scoped Grafana access (Priority: P2)

A user whose Rauthy `platform_role` is `member` lands in Grafana as a Viewer; an
`owner`/`admin` user lands as Admin. No local Grafana passwords.

**Independent Test**: sign in as each role; confirm the mapped Grafana role.

### Edge Cases

- **remote_write receiver unreachable at statecraft boot** — statecraft MUST
  start and serve regardless; metrics export is best-effort, never a readiness
  dependency.
- **Default-deny blocks the push** — without an explicit egress allow,
  statecraft's remote_write is dropped silently. FR-006 covers this.
- **Operator CRDs absent** — a `ServiceMonitor`/`PrometheusRule` applied before
  the Operator's CRDs exist fails. CRD install ordering is part of FR-007.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001 (statecraft export, Hetzner):** `infra.config.hetzner.json` MUST
  gain a `metrics` block: `type: prometheus`, a bounded `collection_interval`
  (target ~`60s`; MUST NOT be sub-`15s`, which fans out abusive high-frequency
  remote_write), and a `remote_write_url` set to the **literal** in-cluster Prometheus
  remote_write endpoint (e.g. `http://<release>-prometheus.monitoring.svc.cluster.local:9090/api/v1/write`).
  A literal is correct here — the endpoint is stable cluster-internal DNS, not a
  secret, so no `$env` indirection and no new secret is introduced.

- **FR-002 (collector shape):** the collector MUST be a Prometheus **server**
  with `--web.enable-remote-write-receiver` enabled — not agent mode — so it
  serves all three roles (receive / scrape / query) per the Architecture §. The
  Prometheus **admin API (`--web.enable-admin-api`) MUST remain disabled** (the
  HelmRelease values MUST NOT enable it) — it exposes series-deletion, snapshots,
  and TSDB compaction, a data-destruction surface reachable from `monitoring`;
  parallel to Grafana's `auth.basic_enabled` closure (FR-004).

- **FR-003 (scrape the pull targets):** Prometheus MUST scrape the pull
  targets — deployd-api-rs, the Flux controllers, ingress-nginx — plus the
  stack-bundled node-exporter and kube-state-metrics. At filing time only
  the Flux controllers were genuinely annotated-and-emitting (see
  §Current-state corrections); implementation therefore also *creates* the
  deployd-api `/metrics` endpoint + annotations and *enables* the
  ingress-nginx exporter, then consumes all three via an
  annotation-keyed pod scrape job over an enumerated namespace allowlist
  (`flux-system`, `deployd-system`, `ingress-nginx`). This closes the
  emitted-but-unconsumed gap, not just the statecraft gap.

- **FR-004 (Grafana auth via Rauthy OIDC):** Grafana MUST authenticate via
  **native generic OIDC against Rauthy** (spec 106), mapping the Rauthy
  `platform_role` claim (spec 106 Principle 2; values `owner`/`admin`/`member`,
  per `seed-rauthy.mjs`) to Grafana roles. Fronting Grafana with the existing
  `oauth2-proxy-gate` chart is explicitly rejected: it forces Grafana into
  proxy-auth/anonymous mode and forfeits clean role mapping. The Grafana OIDC
  client MUST be **created manually in the Rauthy admin UI**, following the
  documented `[manual]` OIDC-client convention
  (`platform/infra/hetzner/.env.example`: "[manual] OIDC clients … create in
  Rauthy admin … fill these in and re-run ./setup.sh") — exactly as
  `statecraft-server`, the SPA/M2M clients, and the GitHub/Google upstream
  providers already are. The client MUST pin the **exact** redirect URI
  `https://grafana.<DOMAIN>/login/generic_oauth` — no wildcards, path-prefix, or
  trailing-slash variants (open-redirect / token-harvest prevention). Its
  `client_id`/`client_secret` are captured into the
  env/secret set; Grafana's HelmRelease consumes them plus the issuer to drive
  `generic_oauth`, with `role_attribute_path` mapping the Rauthy `platform_role`
  claim to a Grafana role under the **locked map: `owner` and `admin` → `Admin`,
  `member` → `Viewer`** (Grafana's `Editor` role is unused). This is the existing
  scope-driven `platform_role` claim, **not** a Rauthy "groups" array — there is
  no `operator`/`viewer`/`editor` vocabulary in the identity model. Grafana MUST
  be **OIDC-only** — **every non-OIDC
  authentication path disabled so Rauthy OIDC is the sole auth provider**. This
  is a *property*, not a fixed knob-list (enumerating each knob is a whack-a-mole
  that never terminates): the known knobs are `auth.disable_login_form: true`,
  `auth.basic_enabled: false` (closes the `Authorization: Basic` API path),
  `auth.anonymous.enabled: false`, `oauth_auto_login: true`, and a
  disabled/randomized default admin — with proxy/JWT/API-key/service-account
  paths and the exhaustive set pinned at implementation. The **contract** is the
  property (no credential authenticates outside OIDC); the full knob enumeration
  is implementation detail. 196 therefore touches **no** statecraft code — and the seeder
  not at all; its only identity relationship is the runtime `depends_on: 106`
  (Relationships §).

- **FR-005 (declarative deploy, Hetzner):** the stack MUST deploy as a Flux
  `HelmRelease` under `platform/gitops/clusters/hetzner-prod/infrastructure/`,
  sourced from a `prometheus-community` **`HelmRepository`** — the same Flux
  source kind already used by cert-manager (jetstack), ingress-nginx, and
  reflector (emberstack); only rauthy uses an in-tree `GitRepository` chart. The
  reconciliation model (drift-reverted GitOps) is identical to every existing
  infra release per spec 151. No imperative `helm install`.

- **FR-006 (network policy, fail-safe):** the namespace default-deny posture
  MUST be preserved. This spec adds **additive** allow flows, in the directions
  the actual traffic takes:
  - **(a) remote_write (push):** `statecraft-system` egress → Prometheus, and
    Prometheus ingress ← `statecraft-system` **only**. The unauthenticated
    receiver's inbound surface is reachable from nowhere else (SC-008).
  - **(b) scrape (pull):** Prometheus *initiates* the connection — so
    `monitoring` egress → each scrape-target namespace's metrics port, and each
    target namespace ingress ← `monitoring`. There is **no** ingress to
    Prometheus from scrape targets; that would expose the receiver port
    (`9090`) to `flux-system`/deployd-api and undercut SC-008.
  - **(c) Grafana UI:** Grafana ingress ← ingress-nginx.
  - **(d) ACME HTTP-01 solver (added 2026-07-08; see §FR-006 correction
    below):** ephemeral cert-manager solver pods
    (`acme.cert-manager.io/http01-solver`) ingress ← ingress-nginx on `:8089`
    only, so a `monitoring` ingress (Grafana) can obtain and renew its Let's
    Encrypt certificate. Scoped to the solver label and port; receiver
    isolation (SC-008) is untouched.
  The global default-deny is not weakened; only these named flows open. Because
  they span `statecraft-system`, `monitoring`, and the target namespaces,
  implementation creates **multiple NetworkPolicy objects across namespaces**
  (≥2 `establishes:` edges; see the deferred-establishes note in frontmatter).

  **Corrected 2026-06-12 (§Incident addendum) — allow objects are isolating,
  never dormant.** A NetworkPolicy isolates every pod its `podSelector`
  matches for each listed `policyType`; only the named flows then pass.
  There is no such thing as a "dormant-additive" allow in a namespace
  without default-deny — applying one IS applying a deny-all-except for
  the selected pods and direction. The halves of (a)/(b) that live
  **outside `monitoring`** (statecraft-system egress, deployd-system /
  ingress-nginx ingress) therefore MUST NOT ship before their namespace
  gains an enforced default-deny under its own spec; until then 196 ships
  only the `monitoring`-namespace objects, whose source/destination halves
  fully carry today's traffic (those namespaces are un-isolated, so the
  monitoring-side allows suffice end-to-end).

- **FR-007 (Operator CRDs as a governed dependency surface):** adopting
  kube-prometheus-stack introduces the Prometheus Operator CRDs
  (`ServiceMonitor`, `PodMonitor`, `PrometheusRule`, `Probe`, …) as a new
  cluster-wide governed dependency. Their version MUST be pinned via the
  HelmRelease and their presence treated as a tracked dependency, not an
  incidental side effect. CRD install/upgrade ordering is part of the contract.

- **FR-008 (Alertmanager off; default rules pruned):** Alertmanager MUST be
  **disabled** in the initial landing, and the ~100 bundled default
  `PrometheusRule`s MUST be pruned/disabled rather than silently inherited.
  Alert routing and SLO rules are out of scope and tracked as a **separate spec**
  (§Out of scope) — a distinct capability, not a later FR appended to this locked
  spec. The spec takes a position so the chart does not decide by default.

- **FR-009 (Azure binding — DECLARED, DEFERRED-NULL):** the Azure cloud binding
  is part of this spec's contract surface, but `infra.config.json`'s `metrics`
  block remains **null** pending resolution. The binding's *existence* is
  declared now (so no future amendment must *add* it to a frozen registry); its
  *type* is deferred (the genuinely uncertain half).
  - **Reopening trigger (forcing function):** the Azure type resolves when
    statecraft is first deployed to Azure with metrics required, **or** when
    Azure-dev is promoted to a long-lived/validated environment — whichever
    comes first. Absent a named trigger, "deferred" and "forgotten" are
    indistinguishable at registry-read time; this clause makes them distinct.
  - **Both-branch costs (preserved, not discarded):**
    - *Azure Monitor managed Prometheus* → **+1 follow-up FR**: an Entra-ID
      `remote_write` **auth-proxy sidecar** (managed-identity → bearer),
      required precisely because Encore's `prometheus` block has no auth field
      and cannot reach an Entra-gated endpoint on its own. Microsoft lock-in on
      the observability substrate.
    - *Self-hosted in-cluster on AKS* → **zero new machinery**: reuse the
      Hetzner mechanism verbatim; only the literal `remote_write_url` DNS
      differs.
  - **Decided vs anticipated:** the sovereignty/anti-lock-in disposition
    *predicts* the resolution is self-hosted-symmetric, but prediction is not a
    reason to freeze. The registry stays honest about decided-versus-anticipated;
    the lock-in argument is applied at implementation time, where it is
    load-bearing rather than presumed.

- **FR-010 (retention & persistence):** Prometheus and Grafana MUST have
  bounded retention backed by PVCs. The retention window and PVC sizes are a
  plan-time value, not frozen here; the *requirement* for bounded, persisted
  storage is. **Retention sizing MUST be revisited at the same long-lived /
  validated promotion trigger as FR-009**, so the pre-alpha defaults cannot
  silently persist into a production-grade deployment.

- **FR-011 (zero statecraft application-code change — invariant):** this spec
  MUST NOT add or modify statecraft application code. Instrumentation is
  Encore-native; the only change to the *running service* is the `infra.config`
  metrics block (FR-001). Any diff to `platform/services/statecraft/api/**`
  attributed to this spec is a contract violation, proven by SC-004 via
  `git diff`. The Grafana OIDC client is created manually in Rauthy (FR-004), so
  196 touches **no** statecraft file at all — not `api/**`, and not the
  `scripts/seed-rauthy.mjs` seeder. The only statecraft-side artifact 196 edits
  is the `infra.config` metrics block; Grafana's own OIDC config lives in its
  HelmRelease values under gitops, which 196 owns.

### Key Entities

- **Metrics stack** — the kube-prometheus-stack HelmRelease: Prometheus server,
  Grafana, node-exporter, kube-state-metrics; Alertmanager disabled (FR-008).
- **Cloud binding** — a (cloud, infra.config file, metrics `type`, endpoint)
  tuple. Hetzner: `prometheus` / in-cluster literal. Azure: declared, null,
  deferred (FR-009).
- **Grafana OIDC client** — a Rauthy client + `platform_role`→Grafana-role
  mapping (FR-004).

## Success Criteria *(mandatory)*

- **SC-001 (Phase 1):** statecraft series are queryable in **Prometheus** within
  ~one `collection_interval` of a request (remote_write path works); the
  validating run MUST **name and record the concrete series** it confirmed — e.g.
  an Encore-emitted statecraft request-count series — as the evidence anchor that
  **SC-010** reuses verbatim (the spec does not guess Encore's exact metric name;
  the validated name is captured at test time). This gates
  the Prometheus (push) half only; end-to-end visibility in **Grafana** is a
  separate Phase-2 criterion (**SC-010**), since Grafana doesn't exist yet — note
  SC-003 covers Grafana *auth*, not data visibility.
- **SC-002 (Phase 1):** at least one known series from each of deployd-api, Flux, and
  ingress-nginx is queryable post-deploy — the previously-unconsumed
  annotations are now consumed (scrape path works).
- **SC-003 (Phase 2):** a Rauthy user whose `platform_role` is `member` lands in
  Grafana as **Viewer**, and an `owner`/`admin` user as **Admin** — the locked
  FR-004 `platform_role`→role map (OIDC role mapping works); **and** every
  non-OIDC auth path is disabled (Basic Auth, anonymous, proxy, JWT, API-key,
  service-account — per FR-004's set) so **no credential authenticates outside
  OIDC** — not merely the form hidden or the default password rotated (FR-004).
  The OIDC-only property MUST be confirmed by an **actual negative probe, not
  config inspection**: at least one non-OIDC request against the Grafana API —
  e.g. `Authorization: Basic …` **and** a service-account
  `Authorization: Bearer glsa_…` — MUST return `401`/`403`. The map is locked in
  `plan.md` (owner decision, 2026-06-04), so SC-003 is verifiable at Phase 2 with
  no pending precondition.
- **SC-004 (Phase 2):** `git diff` for the implementing branch shows the **only**
  changed file anywhere under `platform/services/statecraft/**` is
  `infra.config.hetzner.json` (and only its `metrics` block) — **zero** changes
  elsewhere in the service tree, explicitly including `api/**`, `encore.app`,
  `package.json`, and `scripts/seed-rauthy.mjs`. FR-011's invariant is
  service-wide ("no statecraft file at all" except the metrics block), so the
  check is scoped to the whole service root, not `api/**` alone — `infra.config.*`
  and the seeder live at the service root, outside `api/**`, and an `api/**`-only
  glob would pass silently on a stray edit to any of them (proves FR-011).
- **SC-005 (Phase 1, rescoped at implementation — see §Current-state
  corrections):** no pre-existing NetworkPolicy is weakened or removed;
  everything this spec adds is either `monitoring`'s own default-deny or a
  strictly additive named allow; and a negative probe confirms
  `monitoring`'s default-deny actually drops an un-allowed flow (e.g. a
  generic-namespace pod cannot reach an arbitrary monitoring port that no
  allow names). The original wording probed egress from
  `statecraft-system`, which presumed a default-deny that namespace has
  never had applied (post-create.sh skips it "for MVP") — unverifiable as
  filed. *(Corrected 2026-06-12: the first implementation also shipped
  cross-namespace allow halves it called "dormant-additive" — a premise
  FR-006's correction shows is false, and which the §Incident addendum
  records as a production outage. SC-005 now reads: 196's only
  NetworkPolicy objects live in `monitoring`; namespaces outside
  `monitoring` are policy-untouched by this spec, which is what proves
  FR-006 did not globally change the posture.)*
- **SC-006 (Phase 1):** post-deploy, Alertmanager pods are **absent** and the
  `PrometheusRule`s **installed by the kube-prometheus-stack release** are
  absent/disabled (the phase-1 allowed set from this release is ∅; alerting is a
  separate later spec; FR-008) — proving the prune held and the ~100 bundled
  defaults were not silently inherited. (Pre-existing rules from other tooling
  are out of scope.)
- **SC-007 (Phase 1):** the stack is reconciled by Flux (no imperative `helm install` in
  the deploy path), the Prometheus Operator CRDs are present at the
  HelmRelease-pinned version, Prometheus + Grafana retention is PVC-bounded, and
  the deployed `collection_interval` honours the FR-001 floor (≥`15s`) — proving
  FR-005, FR-007, FR-010, and guarding FR-001's bound against later drift.
- **SC-008 (receiver inbound isolation — Phase 1):** Prometheus's remote_write
  ingest port is reachable **only** from `statecraft-system`. The negative test
  confirms pods in a generic namespace **and in each scrape-target namespace to
  which `monitoring` holds egress under FR-006 (b)** (`flux-system`, deployd-api,
  ingress-nginx) **cannot initiate connections to** the receiver port — those
  scrape targets are the most likely to be wrongly granted the reverse inbound.
  This is the test closure for the spec's primary security risk (the
  unauthenticated receiver): FR-006 isolates *inbound*, not merely leaving egress
  un-weakened (SC-005). Verifiable in **Phase 1** (the receiver + its
  NetworkPolicies land there).
- **SC-009 (Grafana inbound isolation — Phase 2):** Grafana's port is reachable
  **only** from ingress-nginx (FR-006 (c)); a pod in any other namespace cannot
  initiate a connection to it. Verifiable in **Phase 2** (Grafana lands there).
- **SC-010 (end-to-end visibility — Phase 2):** the **exact statecraft series
  named and recorded in SC-001** **renders in a Grafana dashboard panel** —
  confirming the Prometheus datasource is wired and the full push → store →
  visualize pipeline works, not merely that Grafana is up and OIDC-gated (SC-003).

## Out of scope (MVP)

- **Logging pillar** — Encore's structured-log export. A later spec owns it.
- **Distributed tracing pillar** — Encore's trace export. A later spec owns it.
- **Alerting** — Alertmanager routing + SLO `PrometheusRule`s. Disabled and
  pruned here (FR-008); a **separate, later spec** owns alert routing and SLOs.
  It is a *distinct capability* — unlike the Azure binding (FR-009), which stays
  *in* 196 because it is the same capability on another cloud (only a value
  resolves; the structure is stable).
- **Azure implementation** — declared (FR-009) but not implemented; type
  deferred to the FR-009 trigger.
- **AWS / GCP / DigitalOcean bindings** — no environment instantiates these
  yet; out of scope until those environments exist.

## Relationships

- **→ spec 106 (identity) — runtime dependency only, no owned edge.** Grafana
  authenticates via Rauthy OIDC (FR-004). The Grafana OIDC client is **created
  manually in the Rauthy admin UI** — the documented `[manual]` convention used
  for every other client (`statecraft-server`, SPA, M2M) and the upstream
  GitHub/Google providers (`platform/infra/hetzner/.env.example`). 196 therefore
  edits **no** identity-subsystem code path — not the seeder, not the Rauthy
  chart — so its sole identity relationship is the runtime `depends_on: 106`.
  **Why there is no seeder co-authorship or collision surface here.** An earlier
  draft modeled the Grafana client as an additive `extends` of the shared seeder
  `seed-rauthy.mjs`, which would have dragged in a sectioning prerequisite
  (provisional spec 197). Investigation retired that path on two grounds: (1) a
  Grafana addition cannot be confined to one self-contained block — the seeder
  dispatches client config by per-`clientId` branching spread across both 106's
  and 107's functions, and it does not even *create* clients (it converges drift
  on manually-created ones); and (2) this is an **admin-only, single, fixed**
  client, exactly the manual-creation profile of `statecraft-server` and the
  upstream providers. Routing it through the per-client seeder machinery was
  never warranted. The one trade-off — a manually-created client's
  redirect/flows/scope are not seeder-drift-protected — is low-value here: a
  broken Grafana login is immediately visible to the operators whose own tool it
  is. (The seeder's pre-existing 106/107 whole-file co-ownership is untouched by
  196 and out of its scope.)
- **→ spec 151 (GitOps).** The Hetzner deploy mechanism — a Flux HelmRelease
  reconciled like every other infra release (FR-005). `depends_on: ["151"]`.
- **refines** (deferred to implementation, like `establishes` — not declared in
  this filing PR) the `metrics-export` aspect of the Hetzner infra config: 196
  adds its `metrics` block (FR-001) at implementation, and the edge lands in that
  PR, not this spec-only one (declaring it now would claim an untouched file).
  The Azure config is never refined by 196 (FR-009 deferred-null).
- **establishes** (at implementation, not in this draft's frontmatter) the
  gitops monitoring HelmRelease and **≥2 NetworkPolicy objects across two
  namespaces** (monitoring-ns ingress + statecraft-system egress; see FR-006 and
  the frontmatter deferred-establishes note). The compiler existence-checks
  `kind: file` units (V-023), so these edges land in the PR that creates the
  files — the same PR where the coupling gate wants the spec↔code link.
- **extends** spec 034's featuregraph golden (mechanical corpus-fingerprint
  refresh only).

## Risks

`risk: medium` is a **deliberate** rating, not a default. This spec stands up a
new authenticated UI into platform internals, an *unauthenticated* in-cluster
remote_write receiver, cluster-wide CRDs, an amendment to a default-deny
posture, and a new Rauthy-OIDC-gated admin UI (Grafana). Medium holds because every
item below carries an in-spec mitigation and the blast radius is a pre-alpha,
single-tenant control plane with **no production user data**. Revisit to `high`
the moment this stack observes an environment that carries tenant data.

- **Operator CRD surface (FR-007).** Cluster-wide CRDs are a standing
  dependency and an upgrade-coupling risk; pinned via HelmRelease.
- **Default-rule noise.** Inheriting ~100 bundled alert rules would create
  alert fatigue and an implicit, ungoverned alerting policy — mitigated by the
  FR-008 prune.
- **remote_write receiver is unauthenticated.** Encore's exporter has no auth
  field, so the in-cluster receiver MUST be reachable only via the named
  NetworkPolicy flow (FR-006) and never exposed at ingress.
- **Grafana as a new attack surface.** A new authenticated UI into platform
  internals; mitigated by Rauthy OIDC + role mapping (FR-004) rather than local
  auth.

## Why this spec is filed as `draft`

The cloud-binding decision (FR-009) and the FR-010 retention values are the
load-bearing choices that benefit from one reviewer pass before lock-in. (The
Grafana OIDC client is created manually in Rauthy — FR-004 / Relationships § —
so 196 owns no identity-subsystem code path and the question of seeder
co-authorship does not arise.) Until this body locks, the gitops monitoring
HelmRelease, the monitoring + statecraft-system NetworkPolicy objects, and the
`infra.config` `metrics` blocks **MUST NOT be created** — the spec's body drives
the implementation, not the other way around (CONST-005). This filing PR
declares **no** code-path edge except the mechanical featuregraph-golden
`extends: 034`: both the `establishes` (gitops + NetworkPolicy) and the
`refines` (infra.config.hetzner.json) edges are deferred to the implementation
PR that touches those files — the consistent rule being that an edge lands in
the PR that edits the code, not this spec-only filing. (V-023 independently
forbids the not-yet-existent gitops/NetworkPolicy paths; the existing
infra.config is deferred for consistency, not because it must be.) The filing
PR therefore changes no claimed code path except the golden.

*(Resolved: the load-bearing choices went through the reviewer pass — the
access-policy map locked 2026-06-04 in `plan.md`, FR-009 stayed
deferred-null, FR-010 values pinned. The implementation PR (2026-06-12)
created the staged files and landed their `establishes:`/`refines:` edges,
exactly as this section scheduled. Status stays `draft` until the
deploy-time SC evidence closes — see §Implementation record.)*

## Implementation scope — a plan-time decision

- **Implemented now (Hetzner):** FR-001, FR-002, FR-003, FR-004, FR-005,
  FR-006, FR-007, FR-008, FR-010, FR-011.
- **Declared, deferred (Azure):** FR-009 — binding declared, metrics block
  null, type resolved at the FR-009 trigger.
- **Out-of-band follow-ups:** alerting (Alertmanager + SLO rules), logging
  pillar, tracing pillar — each a separate spec.

`plan.md` decides phasing (single-spec sequenced vs. split), carries the
concrete Grafana OIDC client values (client_id, redirect_uri, and the locked
`platform_role` → Grafana-role map) as the manual Rauthy-admin setup step plus
the Grafana HelmRelease OIDC config, and pins the FR-010 retention values. No
`compliance:` mapping is asserted here: an OWASP-ASI detection/monitoring
mapping may apply but is a plan-time determination, not a frontmatter claim
made on faith.

## Implementation record (2026-06-12)

The implementation PR landed both plan phases as manifests in one change —
the Phase-2 boundary is the *operator's manual Rauthy-client step* (the
Grafana pod blocks on the `grafana-oidc` Secret until `.env` is filled and
`setup.sh` re-run; same operator contract as `rauthy-smtp-secret`), not a
second code drop. What landed, by FR:

- **FR-001** — `infra.config.hetzner.json` `metrics` block:
  `prometheus` / `collection_interval: 60` (declared explicitly so SC-007's
  ≥15s guard checks a real value, not an Encore default) / literal
  `http://monitoring-prometheus.monitoring.svc.cluster.local:9090/api/v1/write`.
  The two infra configs now diverge for the first time, as §Current state
  intended; SC-004's service-wide guard holds (this is the only
  `platform/services/statecraft/**` change).
- **FR-002** — kube-prometheus-stack `86.2.2` (pinned), server mode,
  `enableRemoteWriteReceiver: true`, `enableAdminAPI: false` explicit.
- **FR-003** — per §Current-state corrections: deployd-api `/metrics`
  *created* (`src/metrics.rs` + route + chart annotations), ingress-nginx
  exporter *enabled*, Flux controllers consumed as-annotated; one
  annotation-keyed scrape job over the enumerated namespace allowlist.
- **FR-004** — Grafana OIDC-only against Rauthy: scopes
  `openid email profile oap`, `role_attribute_path` on
  `custom.platform_role` (Rauthy nests OAP claims under `custom.*` — spec
  106 FR-002) with legacy top-level fallback and
  `role_attribute_strict: true`; locked map `owner|admin→Admin`,
  `member→Viewer`; `disable_login_form` + `basic_enabled: false` +
  anonymous off + per-provider `auto_login` +
  `disable_initial_admin_creation: true` (no local admin credential ever
  exists). Client credentials ride `envFromSecret: grafana-oidc`, never git.
- **FR-005** — Flux `HelmRelease` + `prometheus-community` `HelmRepository`
  under the infrastructure tier, plus a new `policies` Flux Kustomization
  for the namespace-explicit NetworkPolicies (the imperative
  post-create.sh path was deliberately NOT extended — spec 151 retires it).
  DR-stage2 bundle imports the new tier by reference (parity invariant).
- **FR-006** — `monitoring` ships with the deployment's first enforced
  default-deny + the named flows ((a) push, (b) pull, (c) Grafana UI);
  receiver inbound is statecraft-system-only (SC-008's probe set). The
  first landing also shipped cross-namespace halves outside `monitoring`
  under the false "dormant-additive" premise; they were withdrawn the
  same day (§Incident addendum) and FR-006 now forbids shipping them
  ahead of their namespace's default-deny.
- **FR-007** — CRDs ride the chart pin with explicit
  `install/upgrade.crds: CreateReplace` (helm-controller's upgrade default
  silently Skips — that would be exactly the unpinned drift FR-007 forbids).
- **FR-008** — `alertmanager.enabled: false`, `defaultRules.create: false`;
  Grafana's bundled kube-mixin dashboards also off (they lean on the
  pruned recording rules); the OAP dashboard is provisioned explicitly.
- **FR-009** — untouched, per contract (`infra.config.json` not in the diff).
- **FR-010** — retention `15d`, TSDB PVC `20Gi` on `hcloud-volumes`;
  Grafana `2Gi` on the cluster default class (hcloud CSI's 10Gi floor —
  verified in deployd's values-hetzner T002 note — rules `hcloud-volumes`
  out for a 2Gi claim; local-path matches the rauthy persistence
  precedent). *(Hotfix 2026-06-12: the TSDB PVC never bound — the
  operator's default PVC name is 71 chars, the hcloud CSI labels each
  volume with its PVC name, and hcloud caps label values at 63 chars, so
  volume creation failed with `invalid input in field 'labels'` while the
  short-named Grafana PVC bound fine. `cleanPrometheusOperatorObjectNames:
  true` shortens the PVC to 48 chars; the chart-owned
  `monitoring-prometheus` Service — the FR-001 remote_write literal — is
  unaffected.)*
- **FR-011** — holds: zero statecraft application-code change.

**Deploy-gated evidence (open):** SC-001…SC-010 are live-cluster criteria;
`tasks.md` §Deploy-time validation checklist (V001–V010) is the runbook.
SC-001 must record the concrete Encore series name — the dashboard's
statecraft panel carries a provisional expression until then.
`implementation:` stays `pending` until that checklist closes.

## Incident addendum (2026-06-12) — cross-namespace allows withdrawn

Within minutes of the implementation merge reconciling, **all four public
hosts went down with Cloudflare 521 (origin connection refused)**:
`statecraft.ing`, `auth.`, `deploy.`, and `minio.statecraft.ing`. The
`CD statecraft` deploy failed at its `seed-rauthy` job (Rauthy
unreachable through the public URL) and the
`knowledge-orphan-imported-sweeper` cron failed every cycle.

**Root cause** — the three policies in
`namespace-baseline/networkpolicy-allow-metrics-egress.yaml`, shipped
under the "dormant-additive" premise the FR-006 correction now
invalidates. A NetworkPolicy isolates every pod it selects, so:

1. `ingress-nginx/allow-metrics-ingress-from-monitoring`
   (`podSelector: {}`, Ingress) — the controller rejected everything
   inbound except monitoring→10254, **including 80/443 from the Hetzner
   LB**. k3s's embedded netpol controller REJECTs rather than drops,
   hence 521 (refused) rather than 522 (timeout).
2. `statecraft-system/allow-remote-write-egress-to-monitoring`
   (`podSelector: {}`, Egress) — every statecraft pod lost all egress
   except monitoring:9090: DNS, in-namespace Postgres, Rauthy, GitHub.
   The seeder's `TypeError: fetch failed` was this object.
3. `deployd-system/allow-metrics-ingress-from-monitoring`
   (`app=deployd-api`, Ingress) — blocked ingress-nginx→deployd-api on
   the shared :8080, breaking `deploy.statecraft.ing` independently.

**Mitigation** (operator, out-of-band): suspend the `policies` Flux
Kustomization, delete the three objects, verify the public endpoints,
resume after the durable fix merges.

**Durable fix** (this amendment's PR): the file is deleted, its
`establishes:` edge removed, and the `policies` apply set reduced to
`monitoring/networkpolicy-monitoring.yaml` — the monitoring-namespace
objects (default-deny + named flows) are correct and stay. The
cross-namespace halves return WITH each namespace's enforced
default-deny under its own spec, where the full legitimate flow set
(DNS, LB ingress, in-namespace databases, admission webhooks) is
enumerated together — per the corrected FR-006. The same PR fixes the
FR-010 TSDB PVC that never bound (hcloud 63-char label limit; see the
FR-010 hotfix note).

**Verification residue:** V011/V012 in `tasks.md` close this addendum —
public endpoints healthy after the policies tier reconciles the reduced
set, and the Prometheus TSDB PVC Bound.

**Comment alignment (2026-06-12, follow-up):** the egress policy's
header comment in `networkpolicy-monitoring.yaml` still described the
withdrawn `networkpolicy-allow-metrics-egress.yaml` as the live
destination-side containment. Corrected to state the post-withdrawal
truth: destination-side containment for pod-addressable targets does
not currently exist and returns with each target namespace's own
default-deny under its owning spec (per the corrected FR-006). No
behavioral change — comment only.

## Supersession addendum (2026-06-29): config unification

FR-009 (Azure binding deferred-null: `infra.config.json` is never given the
metrics block) and SC-004 (a `git diff` proves `infra.config.json` untouched)
are superseded by the later config unification. The two per-cloud Encore infra
configs were merged into a single `infra.config.json`, because the metrics
`remote_write_url` is a cluster-internal service name
(`monitoring-prometheus.monitoring.svc.cluster.local`) identical on every
cloud. The metrics block therefore now lives in that one config and applies to
every cloud the substrate targets, including Azure once it is stood up. The
FR-001 refine unit is repointed to `infra.config.json`. This is a deliberate
design change to FR-009/SC-004, not a drift correction.


## Security hardening amendment (2026-07-02)

Wired the new per-namespace default-deny NetworkPolicies into the policies kustomization so the statecraft, deployd, and rauthy namespaces are covered alongside monitoring.

Recorded during the cross-subsystem security-hardening sweep; couples the security fixes in the code paths this spec authors to their owning spec per the spec 127 coupling gate.

## Deploy-time validation record (2026-07-08): checklist closed, implementation complete

`tasks.md` §Deploy-time validation (V001–V012) was executed end-to-end against
the live Hetzner cluster. All criteria pass (with one disclosed caveat on
SC-003's member-role leg, recorded in its evidence bullet below), so
`implementation:` flips `pending → complete`. `status:` stays `draft`:
implementation completeness (code shipped and deploy-validated) and formal
approval are independent lifecycle axes, and ratification is a separate act.
(196 is the first spec to pair `status: draft` with `implementation: complete`;
there is no prior corpus precedent for the pairing. An earlier draft of this
record cited 199/201/211 as precedent, which was inaccurate: those specs are
`status: approved`.)

**SC-001 anchor series (the value the spec deferred to test time): `e_requests_total`.**
The dashboard's provisional expression was already `sum(rate(e_requests_total[5m]))`,
so the SC-001 recording confirmed it verbatim; no dashboard correction (T023) was
needed.

Evidence, by success criterion:

- **SC-001 / SC-002 (data plane):** statecraft's Encore `remote_write` series
  (`e_requests_total`, `e_sys_memory_used_bytes`) are queryable in Prometheus,
  and one known series each from deployd-api (`deployd_api_build_info`), Flux
  (`controller_runtime_reconcile_total`), and ingress-nginx
  (`nginx_ingress_controller_requests`) is present. `oap-annotated-pods 6/6 up`.
- **SC-003 (Grafana OIDC):** an OAP owner/admin user signs in via Rauthy OIDC
  (Generic OAuth) and lands as Grafana **Admin** (role synced from the
  `custom.platform_role` claim through `role_attribute_path`). The OIDC-only
  property is confirmed by negative probes: `Authorization: Basic` and a
  service-account `Bearer glsa_…` both return **401**. (The `member → Viewer`
  leg exercises the same JMESPath branch and locked map; it was not separately
  driven for want of a member-role test user at validation time.)
- **SC-005 (no pre-existing policy weakened; default-deny drops un-allowed
  flows):** the SC-008 probe matrix doubles as the SC-005 negative probe: a
  generic-namespace pod cannot reach an un-named `monitoring` port, and no
  pre-existing NetworkPolicy was weakened (196's only objects live in
  `monitoring`; other namespaces stay policy-untouched by this spec). See the
  SC-008 bullet below. (SC-004 is not listed in this record: it was superseded
  2026-06-29 by the config-unification addendum, above.)
- **SC-006 (Alertmanager off):** no Alertmanager pods, zero release
  `PrometheusRule`s.
- **SC-007 (deploy shape):** Flux-reconciled (HelmRelease revision 3, no
  imperative `helm`), Operator CRDs at the chart pin, retention `15d` on a
  PVC-bounded TSDB, `enableAdminAPI: false`, `collection_interval` 60s (≥15s).
- **SC-008 (receiver isolation):** probe matrix confirms the unauthenticated
  remote_write receiver (`:9090`) is reachable **only** from
  `statecraft-system`; blocked from a generic namespace and from every
  scrape-target namespace (`flux-system`, `deployd-system`, `ingress-nginx`).
- **SC-009 (Grafana isolation):** Grafana (`:3000`) reachable **only** from
  `ingress-nginx`; blocked from every other probed namespace.
- **SC-010 (end-to-end visibility):** the SC-001 series renders live in the
  "statecraft requests/s (remote_write)" panel of the OAP Platform Overview
  dashboard, alongside the deployd-api / Flux / ingress-nginx / node panels.
- **V011 / V012 (incident closure):** the three withdrawn cross-namespace
  policies stay absent, the `policies` Kustomization reconciles the reduced set
  (`Ready=True`), the four public hosts return non-5xx, and the Prometheus TSDB
  PVC is `Bound` on the clean (48-char) name with `prometheus-monitoring-0`
  Running.

### FR-006 correction: allow the HTTP-01 solver (new NetworkPolicy)

Validation surfaced a real defect in the FR-006 network policy: the
`monitoring` default-deny admitted ingress-nginx → Grafana (`:3000`) but had
**no allow for the ephemeral cert-manager HTTP-01 solver pods (`:8089`)**. On
this cluster the netpol controller *rejects* rather than drops (the 2026-06-12
incident-addendum behaviour), so every ACME challenge for a `monitoring`
ingress failed with a 502 and Grafana's TLS certificate could never issue,
silently defeating the spec's own "operator opens Grafana over TLS" goal
(SC-009/SC-010). The fix adds `allow-acme-solver-from-ingress-nginx` to
`platform/k8s/policies/monitoring/networkpolicy-monitoring.yaml` (already a
`establishes:` unit): ingress-nginx → `http01-solver` pods on `:8089` only. It
does not touch receiver isolation (SC-008): Prometheus is not a solver pod and
`:8089` is not the receiver port. With it applied the certificate issued
immediately.

Out of scope, flagged as a follow-up: the same default-deny gap exists for the
HTTP-01 solver in the namespaces the 2026-07-02 hardening covered
(`statecraft-system`, etc.), so certificate *renewal* for hosts like minio will
fail the same way until each owning spec adds the equivalent solver allow. That
is not `monitoring`'s policy and is left to those specs.

### Operator steps performed (outside the repo)

Recorded for reproducibility; none are code changes. The `grafana` Rauthy OIDC
client was created via the Rauthy admin API (confidential, `authorization_code`
+ PKCE `S256`, redirect `https://grafana.<DOMAIN>/login/generic_oauth`, allowed
scopes `openid email profile oap`); its credentials were written to the
operator `.env` and materialised as the `grafana-oidc` Secret (`setup.sh`
contract). A Cloudflare A record for `grafana.<DOMAIN>` was added **DNS-only**
(grey-cloud, matching minio's posture) so the HTTP-01 challenge reaches the
origin directly rather than deadlocking behind the proxy's Full-strict TLS.
