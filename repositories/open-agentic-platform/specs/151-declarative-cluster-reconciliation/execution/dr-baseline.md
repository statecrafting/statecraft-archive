# Spec 151 — SC-003 Stage 1 Partial Baseline

**Date:** 2026-05-17 → 2026-05-18 (single session, spanning midnight UTC).
**Operator:** bart.
**Cluster:** `oap-dr-baseline-throwaway` (distinct from production
`oap-hetzner`; created + torn down within this session).
**Scope:** SC-003 Stage 1 partial baseline per the amended spec.md §SC-003.
Steps (a) SOPS recipient restoration, (b) cluster create, (c) `flux bootstrap`
install-only. Step (d) cluster convergence to declared state is STRUCTURALLY
NOT MEASURABLE at Phase 0 because the `platform/gitops/` declared tree does
not yet exist; step (d) defers to the Stage 2 post-implementation DR exercise
recorded in `execution/disaster-recovery.md` after Phases 1–5 implementation
land.

This baseline is a **feasibility check on the bootstrap-shape decisions
pinned in §Clarifications 4 (`flux bootstrap`) + 9 (multi-recipient SOPS)
+ §FR-005 / FR-007 (DR runbook expressibility)**, not a measurement of
the 30-min end-state SC-003 budget. The per-step threshold checks below
(≤5 min for step a, ≤20 min for step b) apply to the partial; the
30-min total budget applies to Stage 2.

---

## Step (a) — SOPS recipient restoration (sub-step + workflow)

**Pinned model:** spec.md §Clarification 9 (amended 2026-05-18,
attachment → notes field). Multi-recipient SOPS with two named
recipients (operator-host laptop + Bitwarden `OAP` organization,
item `sops-age-hetzner-prod-recovery`, notes field). The recipient
private key lands at `~/.config/sops/age/keys.txt` (mode 0600).

**Two sub-stages within step (a):**

1. **Bitwarden-unlock + extract** (human-action) — the operator opens
   Bitwarden, unlocks the vault, locates the `OAP` organization's
   `sops-age-hetzner-prod-recovery` item, copies the notes-field
   content to `~/.config/sops/age/keys.txt`, chmods 0600.
2. **CLI round-trip** (mechanical) — once the key file is on disk,
   `age` / `sops` decrypt is sub-second.

**Measurements in this session:**

| Sub-step | Wall-clock | Source |
|---|---|---|
| 1. Bitwarden-unlock + extract | **NOT MEASURED IN-SESSION** | `bw` CLI is not installed on the operator workstation; the human-action portion would require interactive Bitwarden client use. Documented as a Stage 2 measurement item. |
| 2.a `age-keygen` (synthetic stand-in for "restored key reaches disk") | 0.437s | `time age-keygen -o ./age-key.txt` |
| 2.b `sops --encrypt --in-place` (1 KB Secret manifest) | 0.025s | `time sops --encrypt --in-place sample.secret.yaml` (recipient declared via `.sops.yaml`) |
| 2.c `sops --decrypt` (same manifest) | 0.020s | `time sops --decrypt sample.secret.yaml` |
| **CLI portion of step (a) total** | **~0.5s** | sub-second; not the dominant cost |

**Threshold check (SC-003 ≤5 min for step a):**

- CLI portion: ✓ sub-second.
- Bitwarden-unlock + extract: ✗ not measured. Estimate budget: 1–3 min
  for the human-action portion on a familiar Bitwarden client; ~5 min
  on a cold-cache / 2FA-prompted flow. Stays under the 5-min threshold
  on the optimistic path; close to it on the cold path.

**Finding F1.** The Bitwarden-unlock-and-extract sub-step is the
dominant cost of step (a), and it is NOT exercised in this baseline.
Stage 2 (post-implementation DR exercise) MUST measure the Bitwarden
flow end-to-end against the real `OAP` organization
`sops-age-hetzner-prod-recovery` item to confirm the 5-min threshold.
The CLI portion is mechanically fast; the human-action portion is the
threshold-relevant surface.

**Amendment (2026-05-18, Stage 2 measurement — F1 closes verbatim).**
F1 measured end-to-end against the real `bd954307-a326-4376-a8ed-b44e00985759`
item at ≤35 seconds wall-clock — well inside the 5-min threshold
(≥8× headroom). Measurement covered the realistic operator cold-start
path: Bitwarden master-password unlock, `bw list items` lookup, `bw
get item | jq -r .notes` extraction, file write, `chmod 0600`. Three
sub-findings closed alongside F1:

1. **Custody shape correction.** The Phase 0 spec assumption was
   "attachment `keys.txt`"; reality is "notes field" because the
   Bitwarden free tier does NOT support attachments (Premium plan
   required). spec.md §Clarification 9 (b) amended in the same
   commit. No security difference — both are vault-encrypted at rest
   — and the notes path is marginally faster (one-click copy vs
   download-then-read).
2. **Cluster as emergent third recovery surface.** Mid-session, a
   stash/restore bug in the runbook's step (a) commands lost the
   laptop key from operator disk. Recovery via `kubectl -n
   flux-system get secret sops-age -o jsonpath='{.data.age\.agekey}'
   | base64 -d` restored recipient #1 cleanly; the cluster's
   `sops-age` Secret holds whichever private key Flux bootstrap
   used, and that Secret is readable by the operator's kubeconfig.
   This is a stronger DR property than FR-007 explicitly claims —
   the cluster is itself a recipient store, complementing the
   operator-laptop + Bitwarden pair. Worth recording as an emergent
   FR-007 enrichment without amending the spec (the property is
   consistent with multi-recipient SOPS and doesn't change the
   spec's contract).
3. **Runbook stash-pattern bug.** `mv keys.txt → keys.txt.session-stash`
   silently clobbers `.session-stash` if a previous run left it
   populated. The Stage 2 runbook
   (`execution/disaster-recovery.md`) replaces this with a
   timestamp-suffix pattern (`keys.txt.stash-$(date +%s)`) so each
   stash file is uniquely named and a previous-run residue cannot be
   overwritten. The session that surfaced this incident was itself
   the validation of the cluster-recovery-surface property in
   sub-finding (2).

---

## Step (b) — Hetzner cluster create

**Mechanism per spec.md §M-003:** `hetzner-k3s create --config
cluster.yaml` (the production tooling; future-shrunk `setup.sh` per
FR-003 is a Phase-3+ deliverable, not Phase 0).

**Cluster shape:** production cluster.yaml's instance shape verbatim
(`cx23` master + `cx43` worker, single instance each, location varies).

### Attempt 1 — nbg1 (Nuremberg)

- **Start epoch:** 1779082407 (2026-05-17T05:33:27Z).
- **Master ready (kubeconfig generated):** approx 2 min after start
  (per fsn1 timing, master-ready is consistently ~2 min on Hetzner).
- **Worker pool placement:** 10 consecutive attempts hit
  `resource_unavailable / error during placement` for `cx43` in nbg1
  (`b-create.log` lines 31–186). Retry backoff escalated 5s → 60s. The
  hetzner-k3s tooling does not give up on its own; the operator must
  decide.
- **Operator action:** killed at attempt 10 after ~10 min of sustained
  placement failures.
- **Teardown:** `hetzner-k3s delete` hung indefinitely (no working
  kubeconfig for node-drain handshake; see Finding F4). Fell back to
  `hcloud server delete` + `hcloud network delete` + `hcloud firewall
  delete` — clean within seconds.

### Attempt 2 — fsn1 (Falkenstein)

- **Start epoch:** 1779083944 (2026-05-18T05:59:04Z).
- **Master ready (kubeconfig file mtime):** epoch 1779084068
  (06:01:08Z). **Wall: 124s = 2 min 4 sec.**
- **Control-plane operational:** k3s installed, kubeconfig generated,
  master node `Ready`, coredns / hcloud-cloud-controller-manager /
  hcloud-csi-node / system-upgrade-controller all `Running` within
  the next ~2 min (per `kubectl get pods -A` snapshot).
  `cluster-autoscaler` `CrashLoopBackOff` (expected with zero worker
  pools attached).
- **Worker pool placement:** attempt 1 hit `resource_unavailable`,
  attempt 2 succeeded the server-create call BUT the worker then
  stalled in "powering on" (SSH/cloud-init never reachable from the
  hetzner-k3s tool's POV). 43+ min of empty heartbeat lines
  (`[worker-worker1] : `) accumulated.
- **Operator action:** killed at the 46-min mark; master remained
  fully usable for step (c) (worker pool was never needed for `flux
  install`).
- **Teardown:** `hcloud server delete` + network + firewall — 40s
  total wall-clock.

### Step (b) threshold checks

| Sub-step | Wall | SC-003 ≤20 min threshold | Status |
|---|---|---|---|
| Master ready (control plane usable) | **2 min 4 sec** (fsn1) | ≤20 min | ✓ (10× headroom) |
| Worker pool ready | **NEVER succeeded** in either DC today | ≤20 min | ✗ environmental, not tooling |
| `hetzner-k3s delete` clean teardown | **HUNG** without ready kubeconfig | (no threshold) | failure mode F4 |
| `hcloud`-direct teardown | **40s** | (no threshold) | ✓ fallback path |

**Finding F2.** Hetzner `cx43` (8 vCPU shared x86) capacity was
constrained in BOTH nbg1 and fsn1 during this session. Two consecutive
DC attempts with the production-shape `cx23`+`cx43` config failed to
reach worker-pool-ready. The Phase 0 partial CANNOT distinguish
"Hetzner had a capacity weather event 2026-05-17/18" from "cx43 is
chronically constrained in EU DCs." Either is a real signal for SC-003
step (b)'s 20-min threshold: the bootstrap path is sensitive to the
instance type's regional capacity. **Implementation phase MUST
re-validate against fresh capacity** AND consider one of:

1. **Pin a different instance_type** with healthier capacity. ARM
   `cax21` (4 vCPU / 8 GB ARM, fsn1/nbg1/hel1) is the obvious
   alternative; the master+worker shape stays the same, the CPU
   architecture flips.
2. **Document an in-runbook fallback to alternate location** for the
   step (b) sub-step. The DR runbook (FR-007) should include "if the
   primary DC bounces placement, retry against \<list\>". The Phase 0
   experience suggests fsn1 → nbg1 → hel1 → switch instance_type to
   cax* as a hierarchy.
3. **Accept a retry budget** in the 20-min threshold — e.g. 5 min for
   placement retries + 15 min for actual bootstrap = 20 min hard
   ceiling — with the slippage path being "abort and retry against
   alternate DC."

Phase 0 records the friction; resolution choice is a plan.md / Stage 2
question, not a Phase 0 decision. The master-ready timing (2 min) is
firmly inside the 20-min threshold; the worker-pool overhead is the
threshold-relevant unknown.

**Finding F3.** `hetzner-k3s delete` requires a working kubeconfig to
clean up cleanly (it drains k3s nodes before deleting Hetzner
resources). If a partial-bootstrap run is killed mid-stream, the
delete sub-command hangs indefinitely. The DR runbook MUST include
an `hcloud`-direct teardown fallback for partial-bootstrap recovery.
Measured: `hcloud server delete` + network + firewall = 40s wall —
faster than the in-tool delete even on a healthy cluster. (Spec 151
implementation should consider exposing a `--force-hcloud-teardown`
hetzner-k3s flag or documenting the fallback in setup.sh, not in
spec body.)

---

## Step (c) — `flux bootstrap` install-only

**Mechanism:** `flux install` (the install-only path; full `flux
bootstrap` requires a git target which is not part of the Phase 0
partial). Components installed: source-controller, kustomize-controller,
helm-controller, notification-controller, image-reflector-controller,
image-automation-controller (last two are `--components-extra`).

**Step (c) timing (against the fsn1 master, no worker pool):**

| Sub-step | Wall-clock | Notes |
|---|---|---|
| `flux check --pre` | 0.636s | One warning (see F4) |
| Manifest apply (CRDs + namespace + RBAC + services + 6 deployments + 3 network policies) | **<15s** (estimated; not separately timed — embedded in the 5m install verify-timeout) | All 41 `created` lines flush in seconds; the rest of the 5m 20s is `verifying installation` |
| `flux install` total (incl. verify-wait) | **5m 20.83s** | hit the install-verify timeout (5 min default) because deployments never went Ready (see F5) |
| `flux check` (post-install, controllers-ready probe) | 5m timeout | also did not converge |

### Step (c) feasibility verdict

- **Manifest apply:** ✓ fast (sub-15s). Flux's install pipeline does
  exactly what it advertises: CRDs install, namespace + RBAC + service
  accounts + services + 6 deployments + 3 network policies all created
  cleanly against K8s 1.31. No manifest-shape failure.
- **Controller-ready:** ✗ NOT in this throwaway environment, for two
  reasons captured below as F4 and F5. Neither is a Flux problem; both
  are environmental surfaces that exercise themselves under the partial
  baseline shape.

**Finding F4 (K8s version vs Flux version).** `flux check --pre`
emitted `Kubernetes version v1.31.4+k3s1 does not match >=1.33.0-0`.
Flux 2.8.7 advertises K8s 1.33+ as supported; the OAP production
`cluster.yaml` pins `k3s_version: v1.31.4+k3s1`. The mismatch is a
warning, not a hard block — manifest apply still succeeded — but the
warning is load-bearing: Flux upstream may pull support for K8s 1.31
in a future minor and the OAP cluster would silently lose `flux
bootstrap` viability. **Resolution path** (plan.md decision, not Phase
0): either bump `k3s_version` in cluster.yaml during the Phase 1
bootstrap rework, OR pin a Flux version with explicit K8s 1.31
support. Recommended: bump k3s to the latest 1.33.x at the same time
spec 151 lands the `flux bootstrap` step — both edits live in
cluster.yaml / setup.sh, so they go in the same PR.

**Amendment (2026-05-18, post-Phase-1 operational landing).** The
Phase 0 wording above was imprecise. `flux check --pre` is a **hard
gate inside `flux bootstrap`**, not a soft warning: the bootstrap
subcommand invokes `check --pre` first and aborts non-zero on
version mismatch before it reaches the manifest-apply step. The
Phase 0 baseline ran the install-only `flux install` path (not
`flux bootstrap`), which is why manifest apply was observed to
succeed despite the warning — the install-only path does NOT run
the pre-check. Operational consequence: **the K3s in-place upgrade
to ≥1.33 is a REQUIRED operator step before `flux bootstrap`**, not
merely a `cluster.yaml` declarative pin. The upgrade itself runs
via `hetzner-k3s upgrade --new-k3s-version` + Rancher
system-upgrade-controller Plans against the live cluster (~11 min
for the OAP master+worker pair, 2026-05-18). It is sequenced in
tasks.md as T-007 (B0), between the code-side scaffold (T-007 (A),
PR #161) and the operator-driven `flux bootstrap` (T-007 (B)). See
also: hetzner-k3s reads `cluster.yaml`'s `k3s_version` as the
cluster's "current" version, not the live cluster — bumping
`cluster.yaml` on `main` BEFORE running the in-place upgrade
requires a temporary operator-workstation revert during the
`hetzner-k3s upgrade` invocation (durable note in agent memory
`hetzner-k3s-upgrade-comparator`).

**Finding F5 (master-only + `CriticalAddonsOnly` taint).** hetzner-k3s
configures master nodes with the `CriticalAddonsOnly: true` taint by
default; Flux's deployment specs do NOT include a matching toleration
(verified via `kubectl describe pod` on a Pending Flux controller —
events show `0/1 nodes are available: 1 node(s) had untolerated taint
{CriticalAddonsOnly: true}`). Result: in a master-only cluster, all
Flux controllers stay Pending forever. In production this is moot —
worker pool exists, controllers schedule on workers, the master taint
is invisible — but the Stage 2 end-state DR exercise (`flux bootstrap`
against a freshly-created cluster) MUST run AFTER the worker pool is
ready, not at the master-ready point. **Resolution path:** the spec
151 DR runbook MUST order steps (b)/(c) as "wait until at least one
worker is Ready BEFORE running `flux bootstrap`". A `kubectl wait
--for=condition=Ready node --selector=!node-role.kubernetes.io/master
--timeout=10m` gate between steps b and c is the mechanical answer.

**Finding F6 (org-level deploy-key default-disable; 2026-05-18,
post-Phase-1 operational landing).** `flux bootstrap github` against
a non-personal repository creates a repo-scoped deploy key on first
invocation (so `source-controller` can pull from the gitops path).
The `statecrafting` organisation default-disables deploy keys at
the org level (Settings → Repository policies → Deploy keys), so the
first-time bootstrap against any repo under the org fails with HTTP
422 `Deploy keys are disabled` at the deploy-key creation step. Two
resolution paths, both verified during the 2026-05-18 operator
window:

1. **Org-admin enables deploy keys at the org level.** Settings →
   Repository policies → Deploy keys → toggle. The flux bootstrap
   subcommand is idempotent on the already-pushed components, so
   the operator can re-run the same invocation after the org-level
   toggle flips and bootstrap completes cleanly. This is the path
   taken on 2026-05-18; the toggle was enabled to unblock and left
   enabled (durable note in agent memory `statecrafting-org-policies`).
2. **`flux bootstrap --token-auth`.** Bypasses deploy-key creation
   by storing the operator's PAT as a Kubernetes Secret in
   `flux-system`. Trade-off: the PAT lives in-cluster as
   long-lived auth material; rotation becomes an operator burden
   the deploy-key path does not have. Documented as the fallback
   when org policy cannot be toggled (downstream tenant deploys,
   non-admin operators).

**Resolution path:** DR runbook must call out the org-policy
prerequisite explicitly so the first-time bootstrap is not the
moment an operator discovers the toggle. setup.sh's pre-flight
already enforces `GITHUB_TOKEN`; extending the pre-flight to probe
deploy-key creation rights against the GitHub API is feasible but
not currently implemented.

### Step (c) threshold check (informational — no SC-003 numeric threshold)

SC-003's per-step thresholds are 5 min (step a) and 20 min (step b).
There is no numeric threshold on step (c); the spec amendment's
language is "controller-set install time, not convergence time."

The recorded controller-set install times:

- Manifest apply: <15s ✓
- Controller-ready: blocked in this partial by F5 (taint); not
  re-measurable until Stage 2 with workers present.

For the Stage 2 measurement, the bracketed budget for step (c) is the
remaining 30min − step(a) − step(b) − step(d), which on the
amendment's per-step thresholds leaves roughly 5 min for step (c)
controller-set readiness. Flux's documented controller startup is
~30s once pods can schedule; well under that bracket. Phase 0 cannot
confirm this empirically without a worker pool; the bracket holds on
documented timings.

---

## Aggregate threshold table (Stage 1 vs SC-003)

| Step | SC-003 threshold | Stage 1 partial measurement | Status |
|---|---|---|---|
| (a) SOPS restore — CLI portion | ≤5 min | ~0.5s | ✓ (10⁴× headroom) |
| (a) SOPS restore — Bitwarden unlock+extract | ≤5 min | **NOT MEASURED** | deferred to Stage 2 |
| (b) Cluster create — master ready | (subset of ≤20 min) | 124s (fsn1) | ✓ |
| (b) Cluster create — worker pool ready | (subset of ≤20 min) | **NEVER converged** in either DC during this session (cx43 placement weather) | ✗ environmental, see F2 |
| (b) `hetzner-k3s delete` clean teardown | — | hung; `hcloud`-direct fallback 40s | F3 |
| (c) `flux install` manifest apply | (no numeric threshold) | <15s | ✓ |
| (c) Flux controllers Ready | (≤~5min by bracket) | blocked by master-only taint (F5) | deferred to Stage 2 |

**Phase 0 closure status (per spec.md §"Why this spec is filed as
draft" criterion (b)):** Stage 1 partial baseline measured + recorded.
Criterion (b) **SATISFIED.** Steps (a) CLI / (b) master-ready / (c)
manifest-apply all clear their relevant thresholds; the unmeasured
sub-steps (Bitwarden unlock, worker-pool, controllers-ready) are
either deferred to Stage 2 by the amended SC-003 (step d's family),
or environmental (cx43 capacity, master-only taint) and named here as
findings F1–F5 for plan.md / Phase-1 implementation pickup.

---

## Findings summary (recap)

- **F1** — Bitwarden unlock + extract NOT measured this session
  (operator workstation lacks `bw` CLI). Stage 2 measurement required.
- **F2** — `cx43` capacity volatile in both nbg1 and fsn1 today; two
  consecutive DC attempts failed worker-pool placement. Implementation
  must re-validate against fresh capacity AND offer a fallback
  (alternate DC list, alternate instance_type, or accepted retry budget
  in the 20-min threshold).
- **F3** — `hetzner-k3s delete` hangs without a usable kubeconfig
  (drain-then-delete model). The DR runbook MUST document an
  `hcloud`-direct teardown fallback for partial-bootstrap recovery
  (40s measured wall).
- **F4** — Flux 2.8.7 vs cluster k3s v1.31.4: pre-check warns (Flux
  expects K8s ≥1.33). Manifest apply still works; load-bearing for
  Stage 2 / future Flux upgrades. Bump k3s to 1.33.x in the same PR
  that lands `flux bootstrap` for production. **Amended 2026-05-18:**
  the pre-check is a HARD GATE inside `flux bootstrap`, not a soft
  warning — the K3s in-place upgrade is a required operator step
  before bootstrap (sequenced as T-007 (B0)).
- **F5** — Master `CriticalAddonsOnly: true` taint blocks Flux
  controller scheduling in a master-only cluster. In production
  (worker pool present) this is invisible. DR runbook MUST gate the
  `flux bootstrap` step on `kubectl wait` for at least one
  non-master node Ready.
- **F6** (added 2026-05-18) — `statecrafting` org default-disables
  deploy keys at the org level. First-time `flux bootstrap github`
  against any repo under the org fails 422 at deploy-key creation.
  Resolutions: (a) org-admin enables Settings → Repository policies
  → Deploy keys (path taken 2026-05-18; bootstrap is idempotent on
  re-run after the toggle); (b) `flux bootstrap --token-auth`
  (in-cluster long-lived PAT trade-off).

---

## Cost record (incurred against HCLOUD_TOKEN in
`platform/infra/hetzner/.env`)

Two throwaway-cluster create attempts (nbg1 + fsn1), each torn down
within ~50 min of master existence. Master shape `cx23` (~€0.0067/h);
worker `cx43` (~€0.0341/h) — only the nbg1 worker reached an actual
running state for ~16 min before manual hcloud teardown. Combined run
cost: under €0.10 (well below the throwaway threshold the user
authorised). The throwaway cluster never touched production state;
the production `oap-hetzner` cluster in
`platform/infra/hetzner/kubeconfig` was not used or read by this
session.

---

## Inputs to Stage 2 DR exercise (post-implementation)

Stage 2 (recorded in `execution/disaster-recovery.md` after Phases
1–5 land) MUST:

1. Measure step (a)'s Bitwarden-unlock-and-extract sub-step end-to-end
   on the real `OAP` organization `sops-age-hetzner-prod-recovery`
   vault item, notes field (closes F1). **Closed 2026-05-18** — see
   F1 Amendment block above; ≤35s wall-clock measured.
2. Run step (b) against a fresh DC at implementation time; the cx43
   capacity weather of 2026-05-17/18 may have lifted, or may have
   become a chronic constraint requiring instance_type revisit (F2
   resolution).
3. Order steps (b)→(c) with a `kubectl wait` gate for ≥1 worker Ready
   before invoking `flux bootstrap` (F5 resolution).
4. Confirm Flux + k3s version compatibility at the version pair shipped
   in setup.sh / cluster.yaml at Stage 2 time (F4 resolution).
5. Measure step (d) — Flux reconciles the `platform/gitops/` tree to
   declared state — and confirm the 30-min total budget against the
   amended baseline-vs-target policy.

The Stage 1 partial timings recorded above are the cross-check anchor
for Stage 2: step (a) CLI ≪ Stage 2 step (a) total; step (b)
master-ready ≈ Stage 2 step (b) master-ready (should be stable across
sessions); step (c) manifest-apply ≪ Stage 2 step (c) controllers
Ready time.

---

## Provenance

- Spec amendment: `specs/151-declarative-cluster-reconciliation/spec.md`
  §SC-003 (Stage 1 / Stage 2 distinction landed in the same commit
  as this file).
- Raw logs: `/tmp/oap-dr-baseline-throwaway/{b-create.log,
  b-create-fsn1.log, c-flux.log, teardown.log, sops-test/*.log}` —
  session-local, not committed (the throwaway namespace and the
  logs both live outside the repo). The summary tables in this
  document are the durable record.
- Cluster: `oap-dr-baseline-throwaway` — created + torn down within
  this session; no residual Hetzner resources at session close
  (verified via `hcloud server list` / `network list` / `firewall
  list`).
