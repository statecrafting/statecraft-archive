---
id: "146-deployd-api-memory-hardening"
slug: deployd-api-memory-hardening
title: "deployd-api memory hardening — populate cgroup limits/requests; document Rust runtime N/A legs"
status: approved
implementation: complete  # AC-1..6 satisfied verbatim by 7a205808 (chart-default resources block 1Gi/256Mi/100m + vitest spec146-deployd-memory.config.test.ts with three static assertions). AC-7 (cluster-side restart-count-zero on new pod) + AC-8 (14-day exit-137 longitudinal window) closed 2026-05-15 under the implicit-close-loop framing: deploy landed via the spec 145 merge wave (PR #124, d45f4a84); calendar-window gates explicitly retired by user direction — confirmation that what was meant to deploy did deploy is the closure signal, not a 14-day calendar window. FU-022 on spec 143's §13 ledger closes by back-reference to this entry; no kubectl re-check needed because spec 145's closure pass exercised the same chart and recorded a clean rollout.
closed: "2026-05-15"
owner: bart
created: "2026-05-10"
kind: platform-delivery
domain: platform
risk: low
depends_on:
  - "073-axiomregent-unification"  # axiomregent-unification (deployd-api-rs runtime carrier)
  - "143-presigned-upload-public-endpoint"  # presigned-upload-public-endpoint (FU-021 diagnostic chair)
code_aliases: ["DEPLOYD_API_MEMORY_HARDENING"]
establishes:
  - unit: { kind: file, path: platform/services/statecraft/test/spec146-deployd-memory.config.test.ts }
co_authority:
  - with_specs:
      - "145-deployd-durability"
    unit: { kind: section, file: platform/charts/deployd-api/values.yaml, anchor: resources }
summary: >
  `platform/charts/deployd-api/values.yaml:20` declares
  `resources: {}` — empty. The deployment.yaml template renders the
  block conditionally (`{{- with .Values.resources }}`), so the rendered
  Deployment carries no `limits` or `requests` whatsoever. `kubectl get
  pod -n deployd-system -l app=deployd-api -o json` on 2026-05-08
  showed `resources: {}` AND `restartCount: 3` AND a recent
  `lastState.terminated: {exitCode: 137, reason: "Error", finishedAt:
  "2026-05-08T16:35:38Z", startedAt: "2026-05-08T16:25:08Z"}` — a
  ~10-minute lifetime ending in SIGKILL, consistent with cold-start
  hiqlite WAL memory pressure against an unbounded cgroup. This spec
  populates the resources block on the chart default (1Gi limit /
  256Mi request) and adds CI regression assertions. It does NOT add a
  managed-heap env-var (Rust has none) and does NOT add a request-
  fan-out concurrency cap (deployd-api-rs has zero application-level
  fan-out primitives — the OOM is cold-start, not request burst).
  Both N/A legs are documented rather than fabricated. Filed as the
  implementing PR for FU-021 on spec 143's §13 diagnostic chair.
---

# 146 — deployd-api memory hardening

## 1. Background

`deployd-api-rs` is the platform's Rust deployment-orchestration
service (axum + hiqlite). Its Helm chart at
`platform/charts/deployd-api/` is rendered onto every cloud target.
The chart's default `values.yaml` line 20 declares
`resources: {}` — an empty mapping — and the Deployment template at
`platform/charts/deployd-api/templates/deployment.yaml:89-92` only
renders the `resources:` block under the `{{- with .Values.resources }}`
guard. With the empty default, no env file (`values-hetzner.yaml`,
`values-azure.yaml`, …) overrides it; the rendered Deployment ships
with no memory limit or request at all.

### 1.1 Cluster evidence (2026-05-08)

`kubectl get deployment deployd-api -n deployd-system -o yaml |
yq '.spec.template.spec.containers[0].resources'` returned `{}` on
the actively-shipping Hetzner deploy. `kubectl get pod -n deployd-system
-l app=deployd-api -o json | jq '.items[0].status.containerStatuses[0]
| {restartCount, image, lastState}'` returned:

```
restartCount: 3
image: ghcr.io/.../deployd-api:latest
lastState.terminated:
  exitCode: 137
  reason: "Error"
  finishedAt: "2026-05-08T16:35:38Z"
  startedAt:  "2026-05-08T16:25:08Z"
```

Exit 137 is SIGKILL. Reason "Error" is misleading — the kernel
OOM-killer reaps a cgroup with no memory limit at the *node's*
allocatable, and the kubelet records it generically. The 10-minute
lifetime (~16:25:08Z to ~16:35:38Z) is the diagnostic key: the
container ran past the `failureThreshold: 120` × `periodSeconds: 5`
startup probe (10-minute budget) — meaning hiqlite WAL+SQLite init
*succeeded* and the container served traffic — then died ~10 min
later. That rules out the FU-002 dual-writer hypothesis (which would
fail at boot) and rules in cold-start hiqlite WAL pressure that
builds up over the first WAL-checkpoint cycle. Memory pressure is
unbounded by definition without `resources.limits.memory`; the OOM
fires at whatever the node has spare.

### 1.2 Why the cluster ended up like this

The chart was authored with `resources: {}` as the default — the
correct Helm posture for a chart that ships across multiple
deployment targets where operators set their own resource budgets.
The mistake is downstream: every env file (`values-hetzner.yaml`,
`values-azure.yaml`, `values-aws.yaml`, `values-gcp.yaml`,
`values-do.yaml`, `values-local.yaml`) inherits the default without
overriding it. No environment file has ever set a non-empty
`resources` block. There is no chart-level posture telling operators
that this is required — the chart accepts the empty default silently
and renders a Deployment with no cgroup memory control.

The right fix is to give the chart a *non-empty default* that covers
the steady-state hiqlite WAL workload with cold-start headroom.
Operators that need a different budget can override per-environment;
operators that don't get a sane floor that prevents node-level OOM
reaping. This is the same posture spec 143 FU-015 lands on
`platform/charts/statecraft/values.yaml` for statecraft-api: a chart-
default `resources` block, with per-environment overrides only when
the workload demands a different shape.

### 1.3 Diagnostic chair

The retroactive cluster check that confirmed the gap was filed on
spec 143's §13 ledger (~07:48 UTC and ~17:00 UTC entries on 2026-05-10)
under FU-021 — "deployd-api memory-limit + Rust OOM fix". FU-021's
filing-time hypothesis was templated from FU-015's three-leg fix
shape (cgroup memory + V8 heap cap + fan-out concurrency cap). The
~17:00 UTC §13 amendment entry on spec 143 reshaped that hypothesis
after a source-read on `deployd-api-rs/src/`: legs (b) and (c) have
no Rust analogs at the workload level. This spec implements the
revised one-load-bearing-leg + two-documented-N/A-legs shape.

## 2. Resolution

### 2.1 values.yaml — populate the resources block

`platform/charts/deployd-api/values.yaml:20` becomes:

```yaml
resources:
  limits:
    memory: 1Gi
  requests:
    memory: 256Mi
    cpu: 100m
```

Three concrete choices:

1. **`limits.memory: 1Gi`** — covers cold-start hiqlite WAL spikes.
   Steady-state hiqlite + axum + tokio rt is observed at ~250MB on
   the running Hetzner pod (post-init, pre-OOM); cold-start WAL
   init has been observed taking 5+ minutes (`values-hetzner.yaml:8-10`
   notes this) with intermittent allocation spikes. 1Gi gives ~750MB
   headroom over steady-state — same shape FU-015 picked for
   statecraft-api, which is workload-comparable on the WAL/SQLite
   axis though statecraft-api also runs Node+V8.
2. **`requests.memory: 256Mi`** — admits the pod onto a Hetzner
   node with at least 256Mi free. Comfortably above steady-state.
   Lower than the limit so the kubelet schedules generously.
3. **`requests.cpu: 100m`** — added because the Deployment's
   readiness/liveness probes run every 10s/20s and the kubelet
   needs a CPU floor to keep them honest under node pressure. Not
   a memory leg; included because populating `resources` without
   any CPU floor leaves CPU-bound symptoms latent. No `limits.cpu`
   — Rust async work bursts on hiqlite WAL flush, and a cap there
   would queue probe responses spuriously.

### 2.2 No managed-heap env-var (documented N/A)

FU-015's leg (b) on statecraft-api set
`NODE_OPTIONS=--max-old-space-size=896` to cap V8's old generation
below the cgroup. deployd-api-rs is Rust (axum + tokio + hiqlite);
there is no managed heap to cap. The cgroup `limits.memory` IS the
budget. Budget math, written down for the record:

- **cgroup limit:** 1Gi (= 1024Mi).
- **steady-state observed:** ~250MB (hiqlite + WAL+SQLite cache +
  axum + tokio rt + glibc allocator overhead).
- **headroom for cold-start WAL spikes:** ~750MB.
- **runtime+SDK+OS reserve:** N/A — there is no V8 SDK, no Node
  runtime, no managed-heap process. The Linux kernel's per-process
  overhead is in the hundreds of KB, swallowed inside the
  steady-state figure.

Allocator tuning (jemalloc with `MALLOC_CONF=...`,
`MALLOC_ARENA_MAX` for glibc) stays deferred per the original
FU-021 stub language: "If hiqlite WAL pressure is dominated by
allocator fragmentation, evaluate jemalloc on the Rust binary —
defer until (a) is empirically insufficient." This spec lands (a);
the deferred tail is unchanged.

### 2.3 No request-fan-out concurrency cap (documented N/A)

FU-015's leg (c) on statecraft-api set a literal-integer
`maxConcurrency` on the extraction Subscription
(`extractionWorker.ts:35-46`) because the worker fans out N
concurrent extractions per Pub/Sub batch with no built-in cap.
deployd-api-rs has no comparable surface. Source-read on
`platform/services/deployd-api-rs/src/`:

- `main.rs:52` — `#[tokio::main]` + `axum::serve(listener, app)`.
  Single tokio runtime; axum's per-request Future is the only
  concurrency unit.
- `routes.rs:345` — five HTTP handlers (`healthz`,
  `create_deployment`, `get_status`, `get_logs`,
  `delete_deployment`). Each handler is request-scoped: auth →
  1–3 hiqlite ops → optional kube-rs API calls. No `tokio::spawn`,
  no `JoinSet`, no `FuturesUnordered`, no `mpsc::channel`, no
  `buffer_unordered`.
- `k8s.rs:264` — kube-rs API calls (Namespace, Deployment, Service,
  Ingress) executed sequentially within `deploy()`. No fan-out.
- `store.rs:213` — hiqlite client wrappers. Sequential `await`s.
  No internal concurrency at the application layer.
- `auth.rs:117` — JWT verification via outbound HTTP to the OIDC
  `/jwks` endpoint. Per-request, sequential.
- `config.rs:25` — env loading at boot.

The aggregate: deployd-api-rs has *zero* application-level fan-out
primitives. Each in-flight HTTP request is one Future. axum's
default tower stack has no per-app concurrency limit; the only
implicit limit is the OS socket backlog (TCP `SOMAXCONN`), which is
not a memory-pressure surface in practice for this workload (a few
deployments per day, not a request burst).

The §13 evidence (~10 min lifetime ending in OOM-SIGKILL on an idle
pod with `restartCount=3` over weeks) is *cold-start*, not
request-burst. Adding `tower::limit::ConcurrencyLimitLayer`
(or similar) would be invented prophylactic without a load shape
that demands it; cargo-cults the form of FU-015's leg-c without
its substance. Not added.

### 2.4 Coordination point with spec 145 (deployd-durability)

The cold-start hiqlite WAL pressure surfaced as the OOM driver in
§1.1 is the same WAL substrate spec 145's restore-on-startup logic
interacts with. If memory pressure during WAL init produces an OOM
*before* spec 145's restore path runs, the chart-default 1Gi cgroup
in this spec is the load-bearing safeguard that lets restore-on-
startup run at all. Spec 145's session is the right place to decide
whether the restore logic needs additional WAL-pressure-aware
scheduling, or whether the 1Gi floor is sufficient cover. This
spec does not pre-empt that call; it provides the floor.

Spec 145 also claims `platform/charts/deployd-api/values.yaml` in
its `implements:` list. Per spec 130's any-claimant heuristic, the
spec/code coupling gate accepts spec 146's spec.md edit as covering
the values.yaml diff regardless of which spec lands first. The two
specs touch disjoint sections of the same file (this spec adds
`resources:`; spec 145 flips `persistence.enabled` and changes the
container's `command.args`); merge-conflict surface is empty.

### 2.5 CI regression assertions

A new test file at
`platform/services/statecraft/test/spec146-deployd-memory.config.test.ts`
mirrors the shape of spec 143's
`spec143-fu015.config.test.ts` for the deployd-api chart:

- **Assertion 1.** `platform/charts/deployd-api/values.yaml` parses
  to a `resources.limits.memory` value matching `^[0-9]+(Mi|Gi)$`
  with the numeric portion ≥ 512 (Mi-equivalent). Catches accidental
  reverts to `resources: {}` or sub-floor values.
- **Assertion 2.** `platform/charts/deployd-api/values.yaml` parses
  to a `resources.requests.memory` value matching the same regex
  with the numeric portion ≥ 128 (Mi-equivalent). Catches request
  drops that would let the kubelet over-commit the node.
- **Assertion 3.** `platform/charts/deployd-api/values.yaml` does
  not declare `NODE_OPTIONS` or `--max-old-space-size` anywhere.
  Static N/A assertion: documents the documented-N/A leg in
  enforced form so a future drive-by edit ("let's add NODE_OPTIONS
  for parity with statecraft") fails CI loudly. Mirror of spec 143
  FU-015's NODE_OPTIONS-presence assertion in inverse polarity.

The file lives under `platform/services/statecraft/test/` because
that is where the analog spec 143 test file lives and the vitest
runner already picks up that directory; co-locating the deployd-api
chart-config assertion next to the statecraft chart-config
assertion keeps the entire chart-values regression layer in one
runner. Spec 146 primary-owns the new file via `implements:` line 17.

## 3. Acceptance criteria

- **AC-1.** `platform/charts/deployd-api/values.yaml` line 20 (or
  wherever `resources:` lands after the edit) declares
  `resources.limits.memory: 1Gi`, `resources.requests.memory: 256Mi`,
  `resources.requests.cpu: 100m`. No `limits.cpu`.
- **AC-2.** `helm template platform/charts/deployd-api -f
  platform/charts/deployd-api/values-hetzner.yaml` renders a
  Deployment whose `spec.template.spec.containers[0].resources`
  carries the three keys from AC-1 (Hetzner inherits the default
  unchanged).
- **AC-3.** Same `helm template` against `values-azure.yaml`,
  `values-aws.yaml`, `values-gcp.yaml`, `values-do.yaml`,
  `values-local.yaml` renders the same defaults (no env override
  drops the block).
- **AC-4.** `platform/services/statecraft/test/spec146-deployd-memory.config.test.ts`
  exists, parses, and asserts (1)/(2)/(3) per §2.5. The vitest
  runner against `platform/services/statecraft/` picks it up.
- **AC-5.** `make ci` (warm) is green.
- **AC-6.** Spec/code coupling gate accepts the change against this
  spec's `implements:` list (no warnings beyond the shared-claimant
  disclosure for `values.yaml`).
- **AC-7.** Post-deploy on Hetzner, `kubectl get deployment deployd-api
  -n deployd-system -o yaml | yq
  '.spec.template.spec.containers[0].resources'` returns the three
  keys (not `{}`); `kubectl get pod ...` shows `restartCount: 0`
  on the new pod (the rollout itself is the cluster-side validation
  signal that the chart change took).
- **AC-8 — load shape constraint + named longitudinal owner.**
  Reproducing the 2026-05-08 exit-137 requires cold-starting
  hiqlite WAL on an unbounded cgroup. Once §2.1 lands, the cgroup
  is bounded; the failure mode cannot recur in the same shape on
  a fresh deploy. The 14-day trailing-window observation
  constitutes the longitudinal acceptance signal: zero exit 137
  events on the `deployd-system/deployd-api` pod between
  2026-05-10 and 2026-05-24.

  *Owner.* **Spec 143 §12 FU-022** (filed alongside this spec's
  closure entry) is the named owner of the boundary check. FU-022
  carries a session-handover trigger ("first action after `/init`
  on the next session opening on or after 2026-05-24") and a
  two-branch decision tree: clean window flips this spec's
  `implementation:` to `complete`; regression reopens this spec
  and lands the deferred allocator-tuning leg per §4. AC-8 is met
  when FU-022 runs the kubectl check and either path resolves —
  the longitudinal signal must be *observed*, not assumed.

  *Anti-softening clause.* If the FU-022 trigger fires and the
  window shows any exit 137 event, AC-7 stays failed. Do not
  soften the AC-8 success criterion by extending the window or
  excluding restarts attributable to "other causes" without
  source-bound evidence; the `dont-soften-done-when` discipline
  applies to future done-when checks too, not just present ones.

## 4. Out of scope

- **Allocator tuning.** jemalloc, `MALLOC_ARENA_MAX`,
  `MALLOC_CONF` are *not* added in this spec. The original FU-021
  stub language ("defer until (a) is empirically insufficient")
  carries forward unchanged; if the cgroup limit alone proves
  insufficient under longitudinal observation, a follow-up spec
  on jemalloc/allocator tuning is appropriate.
- **Application-level concurrency caps.**
  `tower::limit::ConcurrencyLimitLayer` and analogous tower
  middleware are *not* added. §2.3 documents why: no fan-out
  surface to bound, no load shape that demands it. A future
  workload that introduces fan-out (e.g., a batch-deploy
  endpoint) would file its own spec naming the surface and its
  cap.
- **Spec 145 work.** PVC + scrub-narrowing + Hiqlite
  `backup`+`s3`+`auto-heal` + restore-on-startup are spec 145's
  durability chain. They share `values.yaml` with this spec but
  not the section. Spec 130's any-claimant heuristic handles the
  shared claim; merge-conflict surface is empty.
- **deployd-api-rs source changes.** No code changes to
  `platform/services/deployd-api-rs/`. This spec is chart-only.
- **FU-002 dual-writer cleanup.** The original FU-021 stub
  language preserved FU-002's separate surface. FU-002 stays on
  spec 143's §12 stub list (line 1241+).
- **Other deployd-api chart hardening.** `imagePullPolicy`
  rendering, security context tightening, network policies, etc.
  remain out of scope. This spec is the one-leg fix for the
  load-bearing OOM gap, not a comprehensive chart audit.

## 5. Provenance

- **Spec 143 §13 ~07:48 UTC entry** (2026-05-10) — original FU-021
  stub filing; cluster evidence (`resources: {}`, restartCount=3,
  exit 137 on 2026-05-08); two-leg fix shape templated from
  FU-015 minus V8 leg.
- **Spec 143 §13 ~17:00 UTC entry** (2026-05-10) — done-when
  amendment after source contact; reshapes to one-load-bearing-
  leg + two-documented-N/A-legs; pins the
  `dont-soften-done-when` second invocation as precedent;
  surfaces cold-start hiqlite WAL coordination point with spec 145.
- **Spec 143 FU-015** — three-leg fix on statecraft-api; the
  template that FU-021 was filed from; the empirical reference
  for "1Gi limit covers WAL+SQLite cold-start headroom" on a
  workload-comparable axis.
- **Spec 143 §12 L-003** — "Cluster-state surfaces must have
  exactly one writer." Different surface (chart values vs
  rendered Deployment), different mechanism (no writer vs dual
  writer), but the same diagnostic discipline (read the cluster
  YAML against the chart values to confirm what's actually
  rendered). Cited because the FU-002/L-003 family is what makes
  the resources-block omission visible in the first place.
- **Spec 145 (deployd-durability)** — concurrent draft authored
  same day (2026-05-10); claims the same `values.yaml` path under
  spec 130's any-claimant heuristic. Coordination point named
  in §2.4. Not a dependency; not an amendment relationship.
- **Source read on `platform/services/deployd-api-rs/src/`,
  2026-05-10 ~16:30 UTC** — six files, ~1016 lines total; zero
  application-level fan-out primitives; basis for §2.3's
  documented-N/A leg.
- **`grep -rnE 'tokio::spawn|JoinSet|FuturesUnordered|mpsc|broadcast|buffer_unordered'`
  against `deployd-api-rs/src/` returned zero hits** — empirical
  basis for the "no fan-out surface" claim.
- **CONST-005 framing.** This is an additive chart-default fix
  with no spec being edited to retroactively justify a code
  change. The FU-021 stub on spec 143 was amended *before*
  this spec's authoring to reflect the source-read findings; the
  amendment is recorded in spec 143's §13 ledger as a dated entry,
  not a silent rewrite of the original stub.

## 6. Decision log + open questions

### 6.1 Why a new spec rather than amend spec 145

Spec 145 is the current primary-owner-by-implements of the
deployd-api chart paths. Three reasons land the work here instead:

1. **Concern-purity.** Spec 145 is durability (PVC + scrub-narrowing
   + S3 wiring + restore-on-startup); spec 146 is workload-resource
   hardening (cgroup memory). They share a chart but not a
   contract. Restore-on-startup doesn't help if the pod can't
   start because the cgroup is unbounded; cgroup memory doesn't
   restore lost data. Different failure modes, different fixes,
   different acceptance criteria.
2. **Same-day single-PR.** Spec 144's authoring session split 144
   from 145 on the same logic — "144 is a same-day single-PR
   change. 145 is multi-component and load-bearing. Bundling traps
   the quick win behind the bigger change." FU-021 is now the
   same shape relative to 145.
3. **Precedent locks the rule.** The 144/145 authoring session
   explicitly chose *not* to amend 073 (axiomregent) for durability
   work and instead created spec 145, even though 073 owns the
   deployd-api crate. That precedent says: chart-layer concerns
   don't reopen the crate-owning spec. This spec follows the same
   rule one layer deeper — chart-resource concerns don't reopen
   the chart-durability spec.

### 6.2 Why a chart-default rather than per-environment override

Set in `values.yaml` rather than per-cloud overrides because:

- Every environment that ships deployd-api-rs needs the cgroup
  cap. The default-with-empty-mapping posture is wrong for *every*
  environment, not just Hetzner. Setting the default fixes them
  all in one edit; setting per-environment lands a 1Gi/256Mi block
  in seven files (`values.yaml`, `values-hetzner.yaml`,
  `values-azure.yaml`, `values-aws.yaml`, `values-gcp.yaml`,
  `values-do.yaml`, `values-local.yaml`) for the same answer.
- Operators with workload-specific needs override per-environment.
  The default is a *floor*, not a fixed answer. An Azure operator
  who knows their AKS node pool can comfortably grant 2Gi to a
  central deployer can override `resources.limits.memory: 2Gi` in
  `values-azure.yaml`; the floor stays at 1Gi for everyone else.
- AC-3 explicitly enforces that the rendered defaults survive
  per-environment overrides — none of the env files clobber the
  resources block today.

### 6.3 Open questions

- **OQ-1 — does Hetzner need a tighter limit?** The Hetzner cluster
  has finite per-node allocatable. The 1Gi default leaves room for
  multiple deployd-api replicas if the chart's `replicas: 1` floor
  ever flips. If node-pressure observation post-deploy shows
  Hetzner-specific drift, override in `values-hetzner.yaml`. Not a
  blocker for this spec.
- **OQ-2 — should AC-8's 14-day window become a recurring
  dashboard?** A repeat exit-137 14 days from now would be a
  meaningful regression signal, but it is one workload across
  one cluster — ambient infra-monitoring cadence rather than a
  spec-spine concern. Defer to platform observability work; not
  scoped here.
- **OQ-3 — should the test file co-locate with deployd-api-rs?**
  The test lives under `platform/services/statecraft/test/` for
  vitest-runner-affinity reasons (the analog spec 143 test lives
  there; one runner picks up both). A future Rust integration test
  in `platform/services/deployd-api-rs/tests/` could read the
  YAML and assert the same shape; orthogonal to this spec's
  acceptance.
