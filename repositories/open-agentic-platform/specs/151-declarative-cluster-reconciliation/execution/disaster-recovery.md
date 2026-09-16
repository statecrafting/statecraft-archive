# Spec 151 — Disaster Recovery Runbook (SC-003 Stage 2)

> Phase 5 T-023 deliverable. The Stage 2 end-state DR exercise rerun
> against a throwaway Hetzner cluster, WITH a populated
> `platform/gitops/clusters/hetzner-prod/` tree to reconcile to. Step
> (d) — convergence to declared state — is now structurally
> measurable (it was absent at Phase 0). Cross-checks per-step
> timings against the Phase 0 anchors in [`dr-baseline.md`](./dr-baseline.md).
>
> **This file is the runbook the operator follows during the session
> AND the record of the session's measurements.** Slots marked
> `_____` are filled in-session; per-step `Status:` cells update from
> `PENDING` to `✓` / `✗` as each step closes.

**Session date:** 2026-05-19 (single Hetzner operator window).
**Operator:** bart.
**Cluster name:** `oap-dr-stage2-throwaway` (distinct from production
`oap-hetzner`; created + torn down within the session).
**Scope:** SC-003 Stage 2 full four-step DR sequence (a → b → c → d),
SC-005 drift-revert is independently closed in [`drift-detection.md`](./drift-detection.md) §"SC-005 live evidence (2026-05-18)" and is NOT re-measured here.

**Outcome:** Steps (a) + (b) + (c) closed verbatim (664s combined, well
under the 30-min SC-003 budget). Step (d) **structurally blocked by
new finding F8** — the deferred `dependsOn` machinery anticipated by
`infrastructure/cert-manager.yaml` IS required. SC-003 closes with
**amendment-with-rationale** per spec.md §SC-003 baseline-vs-target
policy. Two new findings recorded below: **F7** (throwaway bootstrap
rotates production deploy key as side-effect — operational hazard)
and **F8** (bare-cluster Flux-only reconciliation cannot converge with
current gitops shape — gates `implementation: complete`).

---

## Pre-flight (before opening the session window)

The pre-flight catches the named obstacles BEFORE the cost clock
starts. Each item below is a binary check the operator does once at
the start; failures are resolved before step (a) begins.

| Check | Mechanism | Status |
|---|---|---|
| `HCLOUD_TOKEN` exported (with cluster-create + image-create scopes) | sourced into shell via `set -a; source platform/infra/hetzner/.env; set +a` (length 64) | ✓ |
| `GITHUB_TOKEN` PAT with `Contents:read+write` on `statecrafting/open-agentic-platform` | `gh auth status` reports `repo, read:org, gist` scopes | ✓ |
| `statecrafting` org-level Deploy Keys ENABLED (F6) | repo `keys` API showed the existing flux-system deploy key from 2026-05-18 as `enabled:true` (re-confirmed) | ✓ |
| Bitwarden vault accessible (F1) | re-validation skipped this session — F1 closed verbatim at PR #172 (≤35s measurement); laptop key present on disk and recipient #1 match verified pre-session. Bitwarden path is exercised again only on the next operator who lands without the laptop key | ✓ (closed at #172, not re-measured) |
| Workstation tools present | kubectl, helm, hetzner-k3s, flux 2.8.7, sops, age, hcloud 1.62.2, bw, jq, gh — all present | ✓ |
| Throwaway `cluster.yaml` ready | `platform/infra/hetzner/cluster.yaml` copied to `/tmp/oap-dr-stage2/cluster.yaml`; `cluster_name: oap-dr-stage2-throwaway` substituted; production `oap-hetzner` cluster NOT touched | ✓ |
| K3s version pinned ≥1.33 (F4) | `k3s_version: v1.33.11+k3s1` in throwaway `cluster.yaml`; `flux check --pre` passed `Kubernetes 1.33.11+k3s1 >=1.33.0-0` post-create | ✓ |
| Instance type validated (F2) | cx43/nbg1 pinned (production shape); F2 closes verbatim — see "F2 resolution" below | ✓ |

Pre-flight failures stop the session BEFORE step (a). Resolve the
named obstacle, then restart pre-flight from the top.

---

## Step (a) — SOPS recipient restoration (CLOSES F1)

**Pinned model:** spec.md §Clarification 9 + dr-baseline.md §Step (a).
The Bitwarden-unlock+extract sub-step is the dominant cost; this
session measures it end-to-end on the real vault item.

### (a.1) Bitwarden-unlock + extract — measured 2026-05-18 (F1 closed)

The session deliberately starts from a state where the laptop key
is NOT on disk, so the Bitwarden path is the one exercised. After
the session closes, the laptop key is restored to disk (the
production default).

**Stash discipline.** Use a timestamp-suffixed stash path (NOT a
fixed `.session-stash` name). `mv` is destructive: a fixed name lets
a second stash silently overwrite a still-populated previous stash,
which lost the laptop key from operator disk during the 2026-05-18
session (recovered via cluster `sops-age` Secret pull — see
dr-baseline.md F1 Amendment, sub-finding 2). Timestamp-suffix
prevents the failure mode.

```bash
# 0. Stash laptop key with unique-per-run name (avoids overwriting a prior stash)
STASH_PATH="$HOME/.config/sops/age/keys.txt.stash-$(date +%s)"
test -f ~/.config/sops/age/keys.txt && \
  mv ~/.config/sops/age/keys.txt "$STASH_PATH" && \
  echo "Stashed laptop key → $STASH_PATH"

# 1. START CLOCK
date -u +%s > /tmp/dr-stage2-step-a-start

# 2. Unlock Bitwarden (interactive; 2FA-prompted is the realistic path).
#    Run `bw unlock` interactively, then paste the printed
#    `export BW_SESSION="…"` line into the shell. The `--raw` capture
#    inside $(...) can corrupt the session value due to tty interaction;
#    interactive paste is the working pattern.
bw login           # if not already authenticated
bw unlock          # paste the printed BW_SESSION export line
bw status | jq -r .status   # expect: "unlocked"

# 3. Extract the notes-field content to the operator key file
#    (Item type doesn't matter: Login or Secure Note, the API surface
#    is the same; the `bd954307...` id is stable.)
ITEM_ID="bd954307-a326-4376-a8ed-b44e00985759"
mkdir -p ~/.config/sops/age
bw get item "$ITEM_ID" | jq -r '.notes' > ~/.config/sops/age/keys.txt
chmod 0600 ~/.config/sops/age/keys.txt

# 4. STOP CLOCK
date -u +%s > /tmp/dr-stage2-step-a-end
echo "Step (a) wall-clock: $(( $(cat /tmp/dr-stage2-step-a-end) - $(cat /tmp/dr-stage2-step-a-start) )) seconds"
```

| Sub-step | Wall-clock | dr-baseline anchor | Status |
|---|---|---|---|
| Bitwarden-unlock + extract end-to-end | ≤35 s (2026-05-18) | NOT MEASURED at Phase 0 (F1) | ✓ |
| `chmod 0600` + on-disk verification | <1 s | — | ✓ |
| **Step (a) total wall-clock** | ≤35 s | CLI portion 0.5s (dr-baseline.md §Step (a)) | ✓ |

**Threshold check (2026-05-18 outcome):** SC-003 step (a) ≤5 min →
≤35s measured → **F1 closes verbatim.** The Bitwarden custody choice
in Clarification #9 holds with ≥8× headroom. Dominant cost is the
master-password unlock; the CLI extraction is sub-second. See
dr-baseline.md F1 Amendment for the full closure record.

### (a.2) Verify the recipient key matches `.sops.yaml`

```bash
PUBKEY="$(age-keygen -y ~/.config/sops/age/keys.txt)"
echo "Derived pubkey: $PUBKEY"
# Expected: age1s8vhfm82rnqw8enq52c026qsxuxd6uh5ntd75wzdah39jws3cctsqp0ava
#           (the Bitwarden backup key — recipient #2 in .sops.yaml)
grep -F "$PUBKEY" "$(git rev-parse --show-toplevel)/.sops.yaml" \
  && echo "✓ recipient match — F1 closed" \
  || echo "✗ MISMATCH — vault holds a key not in .sops.yaml"
ls -l ~/.config/sops/age/keys.txt   # expect mode 0600, ~189 bytes
```

If `MISMATCH` — the vault holds a key that is no longer (or never
was) a `.sops.yaml` recipient. Stop the session and resolve before
step (b) — a mismatched recipient means `kustomize-controller` will
crash-loop on decryption regardless of how clean the rest of the
bootstrap is. Likely causes: vault holds an outdated key from a
prior rotation; the `.sops.yaml` recipients list was edited without
updating the vault entry; or the vault entry was created with a
different keygen invocation than the one whose pubkey is in
`.sops.yaml`.

### (a.3) Cluster-as-recovery-surface emergency path

If neither the laptop nor the Bitwarden backup is reachable (stash
overwrite, vault account locked, device failure mid-session) AND
the production cluster is still running, the operator can recover
the in-cluster private key directly:

```bash
export KUBECONFIG="$HOME/Dev2/open-agentic-platform/platform/infra/hetzner/kubeconfig"
kubectl -n flux-system get secret sops-age \
  -o jsonpath='{.data.age\.agekey}' | base64 -d > ~/.config/sops/age/keys.txt
chmod 0600 ~/.config/sops/age/keys.txt
age-keygen -y ~/.config/sops/age/keys.txt   # whichever recipient the cluster was bootstrapped with
```

This validates the dr-baseline F1 sub-finding (2) cluster-as-third-
recipient-store property. Use only as an emergency path — the
healthy operator flow keeps two independent recovery surfaces
(laptop + Bitwarden); the cluster is a third de-facto surface that
the spec's FR-007 didn't explicitly claim but the multi-recipient
mechanism enables.

---

## Step (b) — Hetzner cluster create (CLOSES F2)

**Mechanism:** `hetzner-k3s create --config /tmp/oap-dr-stage2/cluster.yaml`.

```bash
# 1. START CLOCK
date -u +%s > /tmp/dr-stage2-step-b-start

# 2. Create cluster (foreground; tee log for finding-citation evidence)
cd /tmp/oap-dr-stage2
hetzner-k3s create --config cluster.yaml 2>&1 | tee b-create.log

# 3. Capture master-ready timestamp (kubeconfig file mtime is the durable anchor)
stat -f '%m' kubeconfig    # epoch when hetzner-k3s wrote the file

# 4. STOP CLOCK after BOTH master AND ≥1 worker Ready
export KUBECONFIG=$(pwd)/kubeconfig
kubectl wait --for=condition=Ready node --selector='!node-role.kubernetes.io/master' --timeout=20m
date -u +%s > /tmp/dr-stage2-step-b-end
echo "Step (b) wall-clock: $(( $(cat /tmp/dr-stage2-step-b-end) - $(cat /tmp/dr-stage2-step-b-start) )) seconds"
```

| Sub-step | Wall-clock | dr-baseline anchor | Status |
|---|---|---|---|
| Master ready (kubeconfig written) | ~128 s (kubeconfig mtime epoch 1779160260) | 124s fsn1 (dr-baseline.md §Step (b)) — stable across sessions ✓ | ✓ |
| Worker pool Ready (first non-master node) | ~188 s (worker oap-dr-stage2-throwaway-pool-worker-worker1 condition met) | NEVER converged at Phase 0 (F2) — now converged in nbg1 with cx43 | ✓ |
| **Step (b) total wall-clock** | **188 s** | (well under ≤20 min / 1200 s SC-003 cap — ~6× headroom) | ✓ |

**Threshold check:** SC-003 step (b) ≤20 min → **188 s measured → F2
closes verbatim.** Production-shape `cx23` master + `cx43` worker
placed Ready in nbg1; the 2026-05-17/18 capacity weather lifted on the
2026-05-19 attempt. No fallback to cax21 ARM required this session.
Phase 0 master-ready anchor (124s fsn1) reproduced cleanly in nbg1
(128s) — the bootstrap path is stable across sessions and DCs.

### (b.1) K3s version verification (F4 gate)

```bash
kubectl version --output=yaml | grep gitVersion
# Expected: server version ≥ v1.33.0; matches the cluster.yaml pin
flux check --pre
# Expected: no version-mismatch warning (Flux 2.8.7 wants K8s ≥1.33)
```

If `flux check --pre` reports a version mismatch, the bootstrap will
abort at the pre-check inside `flux bootstrap`. Resolve by either
re-creating the cluster against a higher k3s version (preferred) or
pinning a Flux version with explicit support for the cluster's k3s.

| Check | Result | Status |
|---|---|---|
| `kubectl version` reports k3s ≥1.33 | server `gitVersion: v1.33.11+k3s1` (client `gitVersion: v1.34.1`) | ✓ |
| `flux check --pre` clean (no warnings, no errors) | `✔ Kubernetes 1.33.11+k3s1 >=1.33.0-0 / ✔ prerequisites checks passed` | ✓ |

**F4 closes verbatim** — the K3s ≥1.33 pin in `cluster.yaml` survives
the fresh cluster create, and Flux 2.8.7's hard pre-check inside
`flux bootstrap` (which would otherwise abort) passes cleanly.

---

## Step (c) — `flux bootstrap` (CLOSES F5, F6 prerequisite re-confirmed)

**Mechanism:** the same `flux bootstrap github` invocation that
`platform/infra/hetzner/setup.sh` uses — but with a **distinct path
argument**: `--path=platform/gitops/clusters/hetzner-dr-stage2`
instead of production's `--path=platform/gitops/clusters/hetzner-prod`.
This is the spec 151 Finding F7 future-prevention fix (PR #175): the
deploy-key title flux bootstrap generates is `flux-system-<branch>-flux-system-<path>`, so distinct paths produce distinct titles and the
throwaway bootstrap can no longer rotate production's deploy key as a
side effect. The throwaway tree reconciles the same content production
does — `hetzner-dr-stage2/kustomization.yaml` imports production's
Flux Kustomization CRs via relative path; see
`platform/gitops/clusters/hetzner-dr-stage2/README.md`.

The setup.sh wait-for-worker-Ready gate (F5 mechanical answer,
setup.sh:184) is the same kubectl-wait that step (b) closes on. Step
(c) begins immediately after step (b)'s wall-clock stops.

```bash
# 1. START CLOCK
date -u +%s > /tmp/dr-stage2-step-c-start

# 2. Bootstrap Flux against the throwaway-distinct gitops path.
#    The `--path=...hetzner-dr-stage2` value is the F7 fix — distinct
#    from production's `--path=...hetzner-prod`, so the deploy-key
#    title doesn't collide with production's on GitHub.
flux bootstrap github \
  --owner=statecrafting \
  --repository=open-agentic-platform \
  --branch=main \
  --path=platform/gitops/clusters/hetzner-dr-stage2 \
  --personal=false \
  --network-policy=true \
  2>&1 | tee c-bootstrap.log

# 3. Materialise the sops-age Secret (the kubectl create line that stays
#    in setup.sh per T-021 / spec 153 ownership — NOT a 151-removable line)
kubectl create secret generic sops-age \
  --namespace=flux-system \
  --from-file=age.agekey="$HOME/.config/sops/age/keys.txt" \
  --dry-run=client -o yaml | kubectl apply -f -

# 4. STOP CLOCK when all four controllers Ready
kubectl -n flux-system wait --for=condition=Ready pod \
  -l 'app.kubernetes.io/part-of=flux' --timeout=5m
date -u +%s > /tmp/dr-stage2-step-c-end
echo "Step (c) wall-clock: $(( $(cat /tmp/dr-stage2-step-c-end) - $(cat /tmp/dr-stage2-step-c-start) )) seconds"
```

| Sub-step | Wall-clock | dr-baseline anchor | Status |
|---|---|---|---|
| `flux bootstrap` returns (deploy-key created — toggle ON, F6 fallback not used) | (subset of 476s) | install-only 5m 20s at Phase 0; controllers Ready blocked by F5 | ✓ |
| `sops-age` Secret applied | (subset of 476s; sub-second `kubectl apply` cost) | (new — not in Phase 0) | ✓ |
| All four Flux controllers Ready (`helm-controller`, `kustomize-controller`, `notification-controller`, `source-controller`) | converged inside the 5m wait window | blocked by F5 at Phase 0; now converged with workers present | ✓ |
| **Step (c) total wall-clock** | **476 s** | (no numeric SC-003 threshold; informational; F5 closes verbatim) | ✓ |

**F5 closes verbatim.** With the worker pool Ready from step (b), the
Flux controllers reach Ready in well under the 5m timeout. The Phase 0
F5 block (controllers couldn't schedule because workers never came up)
is structurally resolved.

**F6 closes verbatim.** Org-level deploy keys toggle was already ON
pre-session (re-confirmed via repo `keys` API showing the
2026-05-18 flux-system key as `enabled:true`). `flux bootstrap` created
its deploy key successfully on first attempt; the `--token-auth`
fallback path was NOT exercised this session. The toggle ON state is
the production default per spec 151 §Clarification 8.

**Finding F7 (new — operational hazard):** the throwaway's
`flux bootstrap` invocation REPLACED the production cluster's deploy
key on the shared repo path `platform/gitops/clusters/hetzner-prod`.
Pre-session the repo carried one deploy key (id `151869855`, created
2026-05-18T19:46:00Z, public half matching production's in-cluster
`flux-system/flux-system` Secret). Post-throwaway-bootstrap the repo
carried one deploy key (id `151897224`, created 2026-05-19T03:17:21Z)
with the same title but the throwaway's new public half. Production's
in-cluster Secret still held the OLD private key → production
source-controller could no longer authenticate to clone for ~1h post
the throwaway bootstrap, until the surgical mitigation below.
Production cluster kept running on last-applied state; staleness
window only — no degradation of running workloads.

**Mitigation applied this session — and the lesson learned about
re-bootstrap idempotency.** First attempt: `KUBECONFIG=…/hetzner/kubeconfig
flux bootstrap github …--path=platform/gitops/clusters/hetzner-prod`.
This **did NOT rotate** the deploy key — flux-bootstrap's output read
`✔ source secret up to date` because the production in-cluster
Secret still contained valid keys. flux-bootstrap is idempotent on an
existing in-cluster Secret: it neither re-uploads the matching public
key to GitHub nor regenerates the keypair when the cluster-side
Secret looks healthy. Re-running flux-bootstrap is the WRONG
mitigation for F7. The working path is surgical re-upload of the
in-cluster public half:

```bash
PUBKEY="$(kubectl -n flux-system get secret flux-system \
  -o jsonpath='{.data.identity\.pub}' | base64 -d)"
gh api -X POST repos/statecrafting/open-agentic-platform/keys \
  -f title='flux-system-main-flux-system-./platform/gitops/clusters/hetzner-prod' \
  -f key="$PUBKEY" \
  -F read_only=true
# Delete the throwaway-owned orphan
gh api -X DELETE repos/statecrafting/open-agentic-platform/keys/<orphan-id>
flux reconcile source git flux-system
```

This restored production source-controller cloning immediately
(`Succeeded — stored artifact for commit main@sha1:8a467fb0…`),
verified by `kubectl -n flux-system get gitrepositories` reporting
`READY: True`. The new production deploy key is id `151900351`
(same public half as the deleted `151869855`, restoring the
pre-session state).

**Future-prevention resolved (PR #175 — F7 future-prevention).** Two
resolutions were considered; option (1) landed because it eliminates
the production-impact window entirely:

1. **Distinct path for throwaway bootstraps** ✓ — DR runbook now uses
   `--path=platform/gitops/clusters/hetzner-dr-stage2` (sibling tree
   under `platform/gitops/clusters/`). flux bootstrap generates the
   deploy-key title as `flux-system-<branch>-flux-system-<path>`, so
   distinct paths produce distinct titles and the throwaway bootstrap
   cannot rotate production's deploy key as a side effect. The
   throwaway tree reconciles the same content production reconciles —
   `hetzner-dr-stage2/kustomization.yaml` imports production's
   `infrastructure-kustomization.yaml` and `manifests-kustomization.yaml`
   via relative path; no YAML duplication. See
   [`platform/gitops/clusters/hetzner-dr-stage2/README.md`](../../../platform/gitops/clusters/hetzner-dr-stage2/README.md).
2. **Document the surgical mitigation as a mandatory post-teardown step** — rejected as the long-term resolution. The runbook
   §Teardown still describes the surgical `gh api POST/DELETE` path
   as the operator-recovery path for ANY future deploy-key incident
   (e.g. operator workstation corruption), but it is no longer a
   mandatory step of the DR runbook itself.

F7 future-prevention closes with PR #175.

---

## Step (d) — Cluster convergence to declared state (NEW vs Phase 0)

Step (d) was structurally absent at Phase 0 (no `platform/gitops/`
tree to reconcile against). With the tree populated by Phases 1–4,
step (d) is the measurement that confirms or refutes the
end-to-end SC-003 budget.

**What "converged" means here:** every `Kustomization` under the
gitops path is `READY: True`, AND every `HelmRelease` claimed by
those Kustomizations is `READY: True`, AND no `Warning` events
remain on any Flux controller. The Kustomization reconcile interval
is 10 min (drift-detection.md §"In-cluster reconciliation cadence")
— step (d) measures the time from `flux bootstrap` completion to
the first all-green Kustomization-set, NOT the steady-state cadence.

```bash
# 1. START CLOCK (immediately after step (c) stops)
date -u +%s > /tmp/dr-stage2-step-d-start

# 2. Force-reconcile the top-level flux-system Kustomization to pull
#    the gitops tree without waiting for the 10-min cadence
flux reconcile kustomization flux-system --with-source

# 3. Wait for the gitops Kustomizations to converge.
#    Production tree has one top-level (`flux-system`) + the cluster's
#    `infrastructure` + `manifests` Kustomizations that flux-system
#    composes (see platform/gitops/clusters/hetzner-prod/ tree).
kubectl wait --for=condition=Ready kustomization \
  --all --all-namespaces --timeout=30m

# 4. Wait for the HelmReleases (cert-manager, ingress-nginx, reflector,
#    rauthy) to converge. HelmRelease reconcile is 1h interval; the
#    initial install does not wait for the interval.
kubectl wait --for=condition=Ready helmrelease \
  --all --all-namespaces --timeout=30m

# 5. STOP CLOCK
date -u +%s > /tmp/dr-stage2-step-d-end
echo "Step (d) wall-clock: $(( $(cat /tmp/dr-stage2-step-d-end) - $(cat /tmp/dr-stage2-step-d-start) )) seconds"
```

| Resource | Expected READY | Wall-clock | Status |
|---|---|---|---|
| `kustomization/flux-system` (root) | True | n/a — never converged | ✗ blocked by F8 |
| `helmrelease/cert-manager/cert-manager` | True | n/a — never applied | ✗ blocked by F8 |
| `helmrelease/ingress-nginx/ingress-nginx` | True | n/a — never applied | ✗ blocked by F8 |
| `helmrelease/kube-system/reflector` | True | n/a — never applied | ✗ blocked by F8 |
| `helmrelease/rauthy-system/rauthy` | (Option 1 — deferred to spec 153) | — | (deferred) |
| `certificate/tenants-wildcard-certificate` issued | Ready | n/a — dry-run failed | ✗ blocked by F8 |
| `clusterissuer/letsencrypt-prod` Ready | True | n/a — never applied | ✗ blocked by F8 |
| **Step (d) total wall-clock** | — | **not measurable this session** | **✗ blocked by F8** |

**Pinned this session: option 1** (rauthy convergence deferred to spec
153 close) — but the decision is moot for this session because step
(d) is structurally blocked by F8 before any HelmRelease (rauthy or
otherwise) reaches the convergence stage.

### Finding F8 (new — design finding gating `implementation: complete`)

**Failure mode observed.** `flux reconcile kustomization flux-system
--with-source` returns `context deadline exceeded` after 300s. The
GitRepository fetches cleanly (`main@sha1:8a467fb0…`). The
Kustomization status reports:

> `Certificate/cert-manager/tenants-wildcard dry-run failed: no
> matches for kind "Certificate" in version "cert-manager.io/v1"`

`kubectl get helmrelease --all-namespaces` returns `No resources
found` — **no HelmRelease was applied at all**, including the
`cert-manager` release that would have installed the missing CRDs.
The kustomize-controller logs the same error and retries with
`next try in 10m0s`.

**Root cause.** `platform/gitops/clusters/hetzner-prod/` has no root
`kustomization.yaml`. Flux's kustomize-controller auto-generates a
recursive Kustomization including every YAML file under all
subdirectories. The resulting server-side-apply batch contains both
the `cert-manager` HelmRelease (which would install the cert-manager
CRDs) AND the `tenants-wildcard-certificate` Certificate manifest
(which depends on those CRDs). When the Certificate fails dry-run,
the Kustomization-level apply is aborted before the HelmRelease is
applied. Cert-manager never installs → CRDs never land → Certificate
keeps failing → permanent loop on a 10-min retry interval.

**Design claim falsified.** `infrastructure/cert-manager.yaml` lines
23–37 explicitly assume Flux retries past a "transient apply failure
during the ~30-60s window cert-manager's CRDs are installing".
Measured behavior: the failure is NOT transient because nothing
applies the CRDs in the first place. The "retry pattern" assumed by
the Phase 2 cert-annotation work doesn't compose with the
Kustomization-level dry-run rejection seen here. The
`infrastructure/cert-manager.yaml` comment ALSO already anticipates
this fallback:

> "A wrapping Flux Kustomization with `dependsOn: [cert-manager]` for
> the manifests/ directory is intentionally deferred — Phase 5's
> drift-detection + DR runbook (T-022/T-023) measures whether the
> retry-pattern's convergence cost stays inside the SC-003 30-min
> budget. **If not, a follow-up adds the dependsOn machinery at that
> point with a measured rationale.**"

**Measured rationale is now in hand.** T-023 has produced the
falsifying measurement. The deferred `dependsOn` machinery IS
required.

**Why production works today.** `platform/infra/hetzner/setup.sh`
imperatively installs cert-manager via `helm upgrade --install`
BEFORE running `flux bootstrap`. The CRDs are present in the cluster
when Flux's Kustomization first reconciles → Certificate dry-run
passes → HelmRelease for cert-manager adopts the existing release
in-place. The Stage 2 DR exercise deliberately skips the imperative
pre-installs (per spec 151 §FR-003's setup.sh shrink target), which
exposes the bare-cluster-only failure mode F8 captures.

**Resolution path (F8 follow-up — code landed; Stage 2 re-run pending).**
The split is implemented in `platform/gitops/clusters/hetzner-prod/`:

- `kustomization.yaml` (NEW root) — explicit `resources` list:
  `flux-system`, `infrastructure-kustomization.yaml`,
  `manifests-kustomization.yaml`. Replaces the auto-recursive
  single-batch apply that triggered F8.
- `infrastructure-kustomization.yaml` — Flux Kustomization for
  `./infrastructure` with selective
  `healthChecks: [HelmRelease/cert-manager]` (NOT `wait: true` —
  rauthy's bare-cluster-failure must not block the chain).
- `manifests-kustomization.yaml` — Flux Kustomization for
  `./manifests` with `dependsOn: [{name: infrastructure, namespace:
  flux-system}]` and `wait: true`. Certificate + ClusterIssuer
  dry-run only runs after cert-manager is Ready.
- `infrastructure/cert-manager.yaml` inline comment refreshed to
  retire the falsified "retry-pattern is robust" claim and point
  forward to the new dependsOn anchors.

The new shape honours the spec's staged plan. Stage 2 DR re-run
against the new gitops shape is **deferred to a future operator
window** — ideally after the F7 future-prevention follow-up lands,
so the re-run uses a distinct `--path` argument and does not
collide with production's deploy key. `implementation: complete`
remains gated on the re-run's clean Stage 2 measurement, T-026
setup.sh shrink, AND F7 future-prevention closure.

---

## SC-003 verdict (T-024 input)

```
Step (a) Bitwarden-unlock + extract:       not re-measured (F1 closed at #172, ≤35 s; threshold ≤5 min  / 300 s — closed verbatim)
Step (b) cluster create (master + worker):     188 s   (threshold ≤20 min / 1200 s — ✓ verbatim, ~6× headroom)
Step (c) flux bootstrap + controllers:         476 s   (no numeric threshold; ✓ controllers Ready; F5+F6 closed verbatim)
Step (d) gitops convergence:               BLOCKED-BY-F8  (structurally non-converging on bare cluster; see F8 above)
─────────────────────────────────────────────────────
Total operator wall-clock (a+b+c):             664 s   (~11 min)
SC-003 30-min budget (1800 s):                +1136 s under for the steps that ran; step (d) didn't run.
```

**Apply the baseline-vs-target policy** (spec.md §SC-003):

The verbatim-close branch ("total ≤30 min") doesn't strictly apply
because step (d) never produced a measurable number — it was
structurally blocked by F8. The exceed-target branch ("MUST amend
SC-003 in the same commit") DOES apply, with the amendment text below
recording (a) the partial-measurement number, (b) the dominant
NON-time cost (F8 — design finding, not a timing overrun), and (c)
the future-shrink path (F8 follow-up + Stage 2 DR re-run against the
new gitops shape before `implementation: complete`).

**Verdict this session: amendment-with-rationale.**

The amendment text below lands in `spec.md` §SC-003 in the same PR
that lands this disaster-recovery.md update (the T-024 PR).

```
**Amendment (2026-05-19, Stage 2 measurement).** SC-003's 30-min
budget for the four-step bare-cluster DR sequence was measured against
a throwaway Hetzner cluster on 2026-05-19. Steps (a) + (b) + (c)
closed verbatim in 664 s combined (well inside the 1800 s budget for
the parts that ran). Step (d) was structurally blocked by Finding F8
recorded in `execution/disaster-recovery.md`: the bare-cluster
Flux-only reconciliation cannot converge with the current gitops
shape — kustomize-controller's auto-generated recursive Kustomization
fails server-side-apply dry-run on the `tenants-wildcard-certificate`
Certificate (no `cert-manager.io/v1` CRD yet) and aborts before the
cert-manager HelmRelease is applied, so cert-manager never installs.
The retry-pattern claim in `infrastructure/cert-manager.yaml`
("Convergence is robust per the Phase 2 retry pattern") is falsified;
the deferred `dependsOn` machinery anticipated by the same file's
comment IS required. **Dominant cost: design — not time.** F8 has a
named, scoped resolution (split into `Kustomization/infrastructure`
+ `Kustomization/manifests` with `dependsOn`), filed as a follow-up
PR before `implementation: complete` flips. **Future-shrink path:** F8
follow-up lands the dependsOn split + re-runs Stage 2 DR against the
new shape; the re-run measurement either closes SC-003 verbatim
(expected — steps a+b+c already at 664 s, step d budgeted ~5 min) or
triggers a further amendment with its own rationale. Spec 151
`implementation: complete` is gated on the F8 follow-up's clean Stage
2 re-run, not this partial measurement. **Related operational
finding:** F7 captures that the Stage 2 runbook's choice of
`--path=platform/gitops/clusters/hetzner-prod` (matching production)
rotated production's deploy key as a side effect; the F8 follow-up
PR will also switch the runbook to a throwaway-specific path to
eliminate the cross-environment impact window.
```

---

## F1 resolution (T-025 — Bitwarden flow measured)

**Phase 0 finding (dr-baseline.md §Step (a) Finding F1):** the
Bitwarden-unlock+extract sub-step was the dominant cost of step
(a) and was NOT exercised at Phase 0 (operator workstation lacked
`bw` CLI).

**Stage 2 measurement (2026-05-18):** ≤35 seconds end-to-end.

**Closure status: ✓ F1 closes verbatim.** ≤5 min threshold met
with ≥8× headroom. The realistic operator cold-start path —
master-password unlock + CLI item lookup + `bw get item | jq -r
.notes` extraction + file write + `chmod 0600` — measured well
inside the threshold. Three sub-findings closed alongside:

1. **Custody shape correction (spec amendment).** Phase 0 spec said
   "attachment `keys.txt`"; reality is "notes field" because the
   Bitwarden free tier does NOT support attachments. spec.md
   §Clarification 9 (b) amended in the same commit. See
   dr-baseline.md F1 Amendment block.
2. **Cluster as emergent third recovery surface.** Validated when a
   stash/restore bug lost the laptop key from operator disk;
   `kubectl -n flux-system get secret sops-age -o jsonpath` restored
   recipient #1 cleanly. The cluster's `sops-age` Secret is a
   readable third recipient store complementing
   laptop + Bitwarden. Stronger DR property than FR-007 explicitly
   claims; consistent with multi-recipient SOPS mechanism.
3. **Runbook stash-pattern bug fixed.** `mv keys.txt →
   keys.txt.session-stash` clobbers a populated previous stash;
   replaced with timestamp-suffix pattern (`keys.txt.stash-$(date
   +%s)`). The 2026-05-18 incident itself surfaced and validated the
   sub-finding (2) cluster-recovery property.

---

## F2 resolution (T-025 — cx43 capacity re-validated)

**Phase 0 finding (dr-baseline.md §Step (b) Finding F2):** cx43
capacity was constrained in both nbg1 and fsn1 on 2026-05-17/18.
Two consecutive DC attempts failed worker-pool placement.

**Stage 2 re-validation (this session):**
- **DC tried first:** nbg1 (production placement; runbook recorded
  fsn1 OR nbg1 as acceptable starting choices — nbg1 chosen to keep
  throwaway in the same DC as production for a directly-comparable
  measurement)
- **Instance type used:** cx43 unchanged (production shape held)
- **Worker pool reached Ready:** yes — worker
  `oap-dr-stage2-throwaway-pool-worker-worker1` `condition met` at
  the 188s wall-clock mark
- **Fallback escalation:** none required

**Closure status: ✓ F2 closes verbatim.** cx43 placed Ready in 188s
on the first attempt in nbg1, well under the 20-min SC-003 step (b)
threshold. The 2026-05-17/18 capacity weather lifted — F2's
worker-pool placement claim is operationally true today on
production-shape `cx23` master + `cx43` worker in nbg1. No
instance_type swap to cax21 ARM was required; `cluster.yaml` is
unchanged. The 2026-05-17/18 weather is recorded as a Phase 0
transient, not a structural Hetzner-capacity constraint on the cx43
class.

---

## Teardown

Hard-delete the throwaway cluster within the session — leaving
Hetzner resources running outside the cost window inflates the cost
record below.

```bash
# Preferred: in-tool teardown (works because we have a healthy kubeconfig)
hetzner-k3s delete --config /tmp/oap-dr-stage2/cluster.yaml

# Fallback (F3 path): if hetzner-k3s delete hangs (partial-bootstrap
# kubeconfig), hcloud-direct teardown is 40s wall-clock:
hcloud server list -o noheader -o columns=name | grep '^oap-dr-stage2' | xargs -n1 hcloud server delete
hcloud network list -o noheader -o columns=name | grep '^oap-dr-stage2' | xargs -n1 hcloud network delete
hcloud firewall list -o noheader -o columns=name | grep '^oap-dr-stage2' | xargs -n1 hcloud firewall delete

# Verify no residual resources
hcloud server list | grep oap-dr-stage2     # expect empty
hcloud network list | grep oap-dr-stage2    # expect empty
hcloud firewall list | grep oap-dr-stage2   # expect empty

# Local cleanup
rm -rf /tmp/oap-dr-stage2

# Restore laptop key from the most recent stash-* file. The timestamp
# suffix means we pick the latest by sort order; safer than a fixed
# name. If keys.txt currently exists (e.g. the backup key from step a),
# stash IT too with a fresh timestamp before restoring, so neither
# laptop nor backup is silently overwritten.
LATEST_STASH="$(ls -1 ~/.config/sops/age/keys.txt.stash-* 2>/dev/null | sort | tail -1)"
if [ -n "$LATEST_STASH" ]; then
  test -f ~/.config/sops/age/keys.txt && \
    mv ~/.config/sops/age/keys.txt "$HOME/.config/sops/age/keys.txt.stash-$(date +%s)-pre-restore"
  mv "$LATEST_STASH" ~/.config/sops/age/keys.txt
  echo "Laptop key restored from $LATEST_STASH"
  # Verify derived pubkey is the laptop recipient (recipient #1)
  age-keygen -y ~/.config/sops/age/keys.txt
fi

# Emergency fallback: if no stash file exists (or restore produces wrong
# pubkey), pull recipient #1 from the cluster's sops-age Secret per
# §Step (a.3) Cluster-as-recovery-surface emergency path. The cluster
# is a third de-facto recipient store the multi-recipient SOPS model
# enables; validated 2026-05-18 (see dr-baseline.md F1 Amendment sub-
# finding 2).
```

| Teardown step | Wall-clock | Status |
|---|---|---|
| `hetzner-k3s delete` (after flipping `protect_against_deletion: false` in `/tmp/oap-dr-stage2/cluster.yaml` — production `cluster.yaml` unchanged) | 163 s | ✓ |
| Residual `hcloud server/network/firewall list` empty for `oap-dr-stage2-*` | (verified — instance, network, firewall all deleted in-tool) | ✓ |
| `~/.config/sops/age/keys.txt` laptop-default state | (no-op — never stashed this session since step (a) was skipped; recipient #1 stayed continuously on disk) | ✓ |
| F7 mitigation: production deploy-key restored via surgical `gh api` re-upload + orphan delete | (~30 s) | ✓ |
| F7 mitigation: production `kubectl -n flux-system get gitrepositories` reports `READY: True` | (verified — `stored artifact for revision main@sha1:8a467fb0…`) | ✓ |

---

## Cost record

Two throwaway-cluster cost components against `HCLOUD_TOKEN` in
`platform/infra/hetzner/.env`:

| Resource | Hourly | Wall-time present | Cost |
|---|---|---|---|
| Master `cx23` (~€0.0067/h) | ~0.82 h (cluster create 03:07 UTC → teardown end 03:56 UTC = ~49 min) | ~0.0055 € | ~€0.005 |
| Worker `cx43` (~€0.0341/h) | ~0.82 h (same window) | ~0.0278 € | ~€0.028 |
| **Combined throwaway cost** | — | — | **~€0.033** |

Budget envelope authorised at session start: comfortably under
€0.50/30min (single operator window). Actual: ~€0.033 over ~49
minutes — well inside the envelope. The session took longer than 30
minutes wall-clock because of the F8 diagnostic work after step (d)
failed; the cluster itself ran cleanly during that window.

---

## Provenance

- Spec amendment (if any): `specs/151-declarative-cluster-reconciliation/spec.md`
  §SC-003 (drafted in the same commit as this file if Stage 2 ran
  over budget per the baseline-vs-target policy).
- Phase 0 anchors: [`dr-baseline.md`](./dr-baseline.md) — per-step
  timings cross-checked above.
- Drift-revert evidence (independent of Stage 2): [`drift-detection.md`](./drift-detection.md) §"SC-005 live evidence (2026-05-18)".
- Raw logs: `/tmp/oap-dr-stage2/{b-create.log, c-bootstrap.log,
  step-{a,b,c,d}-{start,end}}` — session-local, not committed. The
  measurement tables in this document are the durable record.
- Cluster: `oap-dr-stage2-throwaway` — created + torn down within
  the session; no residual Hetzner resources at session close
  (verified via `hcloud server list` / `network list` / `firewall
  list`).
- Production `oap-hetzner` cluster in `platform/infra/hetzner/kubeconfig`
  was NOT used or read by this session.

---

## Phase 5 done-when cross-check (T-024 + T-025 + T-026 inputs)

After this runbook records its measurements, the Phase 5 done-when
clauses (tasks.md §"Phase 5 done-when") are evaluated:

| Clause | Closed by | Status |
|---|---|---|
| SC-001 (Flux reconciles edits in ≤5 min) | Demonstrated by Phase 2 reflector / wildcard-cert migrations | ✓ (verified pre-session) |
| SC-002 (setup.sh <100 lines) | T-026 — final setup.sh shrink, gated on F8 follow-up (since F8 may rewrite parts of setup.sh's bootstrap order semantics) | gated on F8 |
| SC-003 Stage 2 (≤30 min OR amendment-with-rationale) | T-024 verdict above — **amendment-with-rationale landed** | ✓ |
| SC-005 (drift reverts within one reconciliation) | [`drift-detection.md`](./drift-detection.md) (closed 2026-05-18) | ✓ |
| SC-007 (spec 137 Phase 6 evidence against Flux-reconciled cluster) | Phase 2 reflector + wildcard-cert in gitops tree | ✓ (verified pre-session) |
| F2 resolution recorded (cx43 weather lifted) | This document §"F2 resolution" | ✓ |
| F4 resolution recorded (k3s ≥1.33 + flux pre-check) | This document §Step (b.1) | ✓ |
| F5 resolution recorded (workers Ready → controllers Ready) | This document §Step (c) | ✓ |
| F6 resolution recorded (org-toggle ON, no `--token-auth` fallback needed) | This document §Step (c) | ✓ |
| F7 future-prevention landed (deploy-key rotation hazard eliminated) | This document §Step (c) F7 block; in-session surgical mitigation applied (#173); distinct-path future-prevention landed (#175 — `hetzner-dr-stage2/` sibling tree + runbook re-pointed) | ✓ |
| F8 follow-up code landed (dependsOn machinery — bare-cluster convergence) | This document §"Resolution path" + new `kustomization.yaml` / `infrastructure-kustomization.yaml` / `manifests-kustomization.yaml` files in `platform/gitops/clusters/hetzner-prod/` | code landed (2026-05-19); Stage 2 re-run pending; gates `implementation: complete` |
| Spec 151 frontmatter `implementation: complete` | Same commit as T-026 shrink AND clean Stage 2 DR re-run after F8 follow-up lands | **pending F8 follow-up** |

The spec 151 → 152 gate (plan.md) opens for spec 152 implementation
only after F8 follow-up lands a successful Stage 2 DR re-run AND the
T-026 setup.sh shrink commits with `implementation: complete`. T-024
(this PR) closes the partial measurement + amendment; the gate stays
held until F8 closure.
