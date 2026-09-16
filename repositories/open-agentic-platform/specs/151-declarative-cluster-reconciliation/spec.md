---
id: "151-declarative-cluster-reconciliation"
title: "Declarative cluster reconciliation — GitOps for cluster-side state via Flux v2"
status: approved
approved: "2026-05-18"
amended: "2026-06-16"
amendment_record: |
  Amended 2026-06-16 by 214-tenant-app-chart-supersession (Stage 2): the
  example GitOps READMEs drop tenant-hello from their illustrative
  application-HelmRelease lists, since 214 retired the synthetic tenant-hello
  service. Documentation-only; no manifest or reconciliation change.
implementation: pending
owner: bart
created: "2026-05-17"
kind: platform
domain: platform
risk: high
depends_on:
  - "087-unified-workspace-architecture"  # unified-workspace-architecture (statecraft is the operator surface; this defines how its operator actions reach the cluster)
  - "143-presigned-upload-public-endpoint"  # presigned-upload-public-endpoint (FU-008 names the setup.sh-monolith seam this spec retires)
code_aliases: ["GITOPS_RECONCILIATION"]
establishes:
  - unit: { kind: file, path: platform/gitops/clusters/hetzner-prod/README.md }
  - unit: { kind: file, path: platform/gitops/clusters/hetzner-prod/infrastructure/README.md }
  - unit: { kind: file, path: platform/gitops/clusters/hetzner-prod/manifests/README.md }
  - unit: { kind: file, path: platform/gitops/clusters/hetzner-prod/secrets/README.md }
  - unit: { kind: file, path: .sops.yaml }
  - unit: { kind: file, path: tools/spec-spine/spec-compiler/tests/v004_consolidation_excludes.rs }
  - unit: { kind: file, path: platform/gitops/clusters/hetzner-prod/infrastructure/reflector.yaml }
  - unit: { kind: file, path: platform/gitops/clusters/hetzner-prod/manifests/tenants-wildcard-certificate.yaml }
  - unit: { kind: file, path: platform/gitops/clusters/hetzner-prod/infrastructure/cert-manager.yaml }
  - unit: { kind: file, path: platform/gitops/clusters/hetzner-prod/infrastructure/ingress-nginx.yaml }
  - unit: { kind: file, path: platform/gitops/clusters/hetzner-prod/manifests/cert-manager-clusterissuers.yaml }
  - unit: { kind: file, path: platform/gitops/clusters/hetzner-prod/infrastructure/rauthy.yaml }
  - unit: { kind: file, path: platform/gitops/clusters/hetzner-prod/kustomization.yaml }
  - unit: { kind: file, path: platform/gitops/clusters/hetzner-prod/infrastructure-kustomization.yaml }
  - unit: { kind: file, path: platform/gitops/clusters/hetzner-prod/manifests-kustomization.yaml }
  - unit: { kind: file, path: platform/gitops/clusters/hetzner-dr-stage2/README.md }
  - unit: { kind: file, path: platform/gitops/clusters/hetzner-dr-stage2/kustomization.yaml }
  - unit: { kind: file, path: specs/151-declarative-cluster-reconciliation/execution/drift-detection.md }
extends:
  - spec: "001-spec-compiler-mvp"
    nature: additive
    unit: { kind: file, path: tools/spec-spine/spec-compiler/src/lib.rs }
co_authority:
  - with_specs:
      - "072-multi-cloud-k8s-portability"
      - "106-rauthy-native-oidc-and-membership"
      - "137-tenant-environment-access-gates"
      - "143-presigned-upload-public-endpoint"
    unit: { kind: section, file: platform/infra/hetzner/setup.sh, anchor: bootstrap }
  - with_specs:
      - "072-multi-cloud-k8s-portability"
      - "106-rauthy-native-oidc-and-membership"
      - "143-presigned-upload-public-endpoint"
    unit: { kind: section, file: platform/infra/hetzner/.env.example, anchor: env-vars }
  - with_specs:
      - "072-multi-cloud-k8s-portability"
    unit: { kind: section, file: platform/infra/hetzner/cluster.yaml, anchor: k3s-version }
  - with_specs:
      - "106-rauthy-native-oidc-and-membership"
    unit: { kind: section, file: platform/infra/hetzner/post-create.sh, anchor: cert-nginx-strikes }
  - with_specs:
      - "104-makefile-ci-parity-contract"
    unit: { kind: section, file: platform/Makefile, anchor: rauthy-deploy }
summary: >
  Replace `platform/infra/hetzner/setup.sh`'s imperative cluster-mutation
  monolith with a declarative GitOps reconciliation layer. Flux v2 runs
  in-cluster, watches `platform/gitops/`, and reconciles HelmReleases,
  Kustomizations, Certificates, and SOPS-encrypted Secrets continuously.
  setup.sh shrinks to one-time bootstrap. Application image rollouts
  migrate from `helm upgrade --set image.tag` against the cluster to
  CD writing the new tag into the gitops tree as a commit to main —
  Flux reconciles; helm-controller rolls pods; CD never touches the
  cluster. Phase 2 unblocks spec 137 Phase 6 by landing the reflector +
  wildcard-cert annotations as the first declarative reconciliation
  under the new tree.
---

# Feature Specification: Declarative cluster reconciliation via Flux v2 GitOps

**Feature Branch**: `151-declarative-cluster-reconciliation`
**Created**: 2026-05-17
**Status**: Approved (2026-05-18)
**Input**: When PR #157 added a Helm install (`kubernetes-reflector`) and a
Certificate-manifest annotation change, neither reached the cluster on
merge — the canonical path is "re-run setup.sh," a monolith that interleaves
cluster create, helm installs, kubectl creates, secret materialisation,
statecraft rollouts, and GitHub Actions sync. Re-running it has known
side effects (FU-009 CronJob clobber, force-roll of statecraft-api).
Spec 143 §12 names the setup.sh-monolith seam pattern this spec retires.
The active follow-ups on that pattern — FU-008
(`statecraft-knowledge-sweeper-credentials`) and FU-003 (which covers
three sibling sweepers: `extraction-staleness-sweeper`,
`connector-sync-scheduler`, `factory-runs-staleness-sweeper` per spec
143 §12) — all retire through this spec's M-002 contract for declarative
cluster state. The fix is not "decompose setup.sh
into smaller imperative scripts" — that just makes a smaller monolith.
The fix is to invert the dependency: cluster mutations depend on
declarative state in git, and an in-cluster controller reconciles
continuously. PR-merge → cluster-converged becomes the loop, not
"PR-merge → operator re-runs script."

## Purpose and charter

Application image deploys today flow through CD as `helm upgrade --install
--set image.tag=sha-${SHA}` invoked directly against the cluster
(`cd-statecraft.yml:117-118`, `cd-deployd-api-rs.yml:110-111`). That
mechanism is incompatible with Flux owning the HelmRelease — two helm
clients writing to the same release would dual-writer-fight. So this spec
not only adds Flux for cluster declarative state, it also migrates the
image-rollout mechanism: CD writes the new image tag as a commit to the
gitops tree, Flux reconciles, helm-controller rolls pods. CD no longer
touches the cluster. The gap addressed is **cluster declarative state**
— Helm releases, Custom Resources, Certificates, ConfigMaps, the
per-purpose Secrets the FU-008 / FU-003 follow-up class struggles with —
which today is materialised by `platform/infra/hetzner/setup.sh` only when
an operator re-runs it. This spec defines the inversion: declarative state
lives in `platform/gitops/`, Flux v2 reconciles continuously from there,
and setup.sh stops being modified for every infrastructure delta. Image
tags are themselves declarative state under this model.

The principle is **declarative over imperative for cluster state**.
Imperative scripts may exist for one-time bootstrap (cluster creation,
Flux installation, the git-secret handshake) but not for ongoing
reconciliation. The git ref is the cluster's intended state.

**Explicitly in scope:**

- Stand up Flux v2 (`source-controller`, `helm-controller`,
  `kustomize-controller`, `notification-controller`) on the existing
  Hetzner cluster, bootstrapped against this repository.
- A `platform/gitops/` tree of HelmRelease, HelmRepository, Kustomization,
  Certificate, and SOPS-encrypted Secret manifests. The complete declared
  cluster state is readable from this tree at any git ref.
- Migrate existing cluster-side concerns (reflector — new; cert-manager —
  existing; ingress-nginx — existing; rauthy chart — existing; statecraft
  chart — existing; deployd-api chart — existing; tenant-hello chart
  hosting; per-purpose Secrets) into the gitops tree, one PR per
  concern, with `setup.sh` shrinking as each lands.
- SOPS-encrypted Secret manifests as the canonical path for per-purpose
  M2M credentials. The cluster holds the SOPS age private key; git holds
  encrypted ciphertext only.
- Drift detection: Flux events + Prometheus metrics surface drift.
  Statecraft UI surfacing of drift is a follow-up, not this spec.
- Disaster recovery: re-bootstrapping Flux against the same git ref
  reconverges the cluster to declared state.

**Explicitly out of scope:**

- Application image rollouts (stays on the existing per-service CD
  workflows: `cd-statecraft.yml`, `cd-deployd-api-rs.yml`,
  `cd-tenant-hello.yml`). Image tags do not flow through git.
  Flux Image Reflector / Image Update Automation may be adopted later
  as a separate spec; this one keeps the image-push → rollout-restart
  loop unchanged.
- Tenant resources (Deployments, Services, Ingresses rendered by
  deployd-api at tenant-deploy time). Those remain deployd-api owned;
  this spec governs only platform infrastructure.
- Multi-cluster federation (one Flux instance per cluster; the gitops
  tree supports Kustomize overlays for per-cluster differences but each
  cluster pulls independently).
- Statecraft UI for editing cluster state. Operators still author YAML
  in PRs; the PR review is the governance surface.
- Replacing terraform for cluster creation (terraform stays the entry
  point; Flux takes over after `kubectl` is reachable).
- Cross-region disaster recovery (single-region per cluster for v1).

## Current state vs intent

**Current state (2026-05-17):**

- `platform/infra/hetzner/setup.sh` (≈400 lines, growing) interleaves:
  cluster create via `hcloud-cli` + `kubeone`, helm installs (cert-manager,
  ingress-nginx, rauthy, reflector as of #157), `kubectl create secret`
  calls (rauthy-secrets, deployd-api-secrets, per-purpose M2M creds),
  statecraft-api rollout, deployd-api helm-managed rollout, GitHub Actions
  secret sync. One sequential, partially-idempotent script.
- `platform/infra/hetzner/post-create.sh` (called by setup.sh) carries
  additional concerns including the FU-009 CronJob clobber at lines
  419-422 that fires on every re-run.
- Three application-level CD workflows handle image rollouts cleanly:
  `cd-statecraft.yml`, `cd-deployd-api-rs.yml`, `cd-tenant-hello.yml`.
  These work and are not the seam this spec addresses.
- `platform/charts/` holds Helm charts for statecraft, deployd-api,
  rauthy, tenant-hello, oauth2-proxy-gate. They are referenced from
  setup.sh by helm CLI invocation.
- `platform/infra/hetzner/manifests/` holds raw Kubernetes manifests
  (currently the wildcard Certificate from spec 106 §12.4 / spec 137 T076).
  Applied by `kubectl apply` from setup.sh.
- Every cluster-side delta in a PR (Helm chart change, new manifest,
  new Secret) requires an operator to re-run setup.sh after merge.
  PR merge does not converge the cluster.

**Intent (this spec's aspiration):**

- `platform/gitops/` tree of declarative manifests. The complete intended
  state of the Hetzner cluster (and any future cluster) is readable from
  this tree at any git ref.
- A Flux v2 instance running in `flux-system` namespace, bootstrapped
  against this repository, watching `platform/gitops/clusters/hetzner/`
  (or the equivalent cluster-specific path).
- Every PR merge that touches `platform/gitops/` triggers Flux
  reconciliation within minutes. No operator intervention to converge.
- `platform/infra/hetzner/setup.sh` reduced to a thin one-time-bootstrap
  script: `hcloud-cli` cluster create → kubeconfig → `flux bootstrap`
  with this repo + path → done. Target line count: under 100 lines.
- A drifted cluster (e.g. someone hand-edits a Deployment) is reverted
  by Flux within the reconciliation interval.
- Disaster recovery: re-create cluster → `flux bootstrap` against the
  same git ref → cluster reconverges to declared state. No "rebuild
  setup.sh state machine" path.
- Spec 143 FU-008 closes by reference: per-purpose Secrets materialise
  via SOPS-encrypted YAML in git; the setup.sh-monolith seam is retired
  for the secret-sync class.

## Cluster mutation contract *(normative)*

Any cluster mutation that this platform owns MUST follow one of three
paths. The path is determined by the kind of mutation, not by operator
preference.

- **M-001 (application image rollouts):** Image tag bumps for
  `statecraft-api`, `deployd-api`, `tenant-hello`, and any future
  in-tree application service MUST flow through the per-service CD
  workflow, which (a) builds and pushes the image to GHCR with the
  commit-SHA tag, then (b) commits the new `image.tag` value to the
  corresponding HelmRelease values file under
  `platform/gitops/clusters/<cluster>/` and pushes to main. Flux's
  `source-controller` picks up the commit; `helm-controller` reconciles
  the HelmRelease, which rolls the Deployment naturally. CD does NOT
  invoke `helm upgrade`, `kubectl set image`, or `kubectl rollout
  restart` against the cluster. The image field is Flux-owned via the
  HelmRelease values; there is no dual-writer, so no
  `driftDetection.ignore` is required for the image path. Init
  containers and multi-container pods are handled by separate values
  keys per container; CD updates whichever key it built.
  Rationale: keeps image tags as declarative state in git (consistent
  with the rest of the contract), eliminates the existing dual-writer
  hazard (FU-002's class), removes the carve-out from C-004.
- **M-002 (declarative cluster state):** Helm releases (versions,
  values), Kubernetes manifests (Certificates, ConfigMaps, RBAC, CRDs,
  Custom Resources), and SOPS-encrypted Secrets MUST be expressed as
  YAML under `platform/gitops/` and reconciled by Flux. No `helm install`
  or `kubectl apply` for these mutations from any operator-side script
  after bootstrap. PR merge is the only mutation channel.
- **M-003 (one-time cluster bootstrap):** Cluster creation,
  kubeconfig handoff, Flux installation, and the initial git-secret
  handshake MAY run imperatively from `platform/infra/<cloud>/setup.sh`.
  Once Flux is running and watching the repo, the bootstrap script's
  job is done; further mutations follow M-002.

Per-purpose Secrets (the FU-008 class) fall under **M-002** via SOPS-
encrypted manifests, not under M-003. The setup.sh imperative
`kubectl create secret` path is retired once the SOPS migration lands.

Constraints on the contract:

- **C-001 (single source of truth):** The complete intended cluster
  state is derivable from one git ref + `platform/gitops/` + the
  SOPS age key held in-cluster. No state lives in operator workstations,
  shared drives, or out-of-band notes.
- **C-002 (drift recovery):** Flux MUST revert manual cluster mutations
  to the declared state within one reconciliation interval. Operators
  changing the cluster outside the gitops tree is a recoverable error,
  not a permanent fork.
- **C-003 (idempotent reconciliation):** Applying the current git state
  to a clean cluster MUST produce identical resources to applying it to
  a partially-converged cluster. Flux's reconciliation model already
  guarantees this; the spec records the requirement so future
  contributions don't introduce non-idempotent CRDs or post-install
  hooks that violate it.
- **C-004 (no cluster credentials in CI, no carve-out):** Flux pulls
  from git; CI MUST NOT push to the cluster. The previous M-001
  carve-out for image rollouts is removed by the new M-001 mechanism
  (CD writes image tags as commits to the gitops tree, not as cluster
  mutations). CI does need git-push access to main for image-tag
  commits; that permission is scoped to the gitops values files only
  (enforced by CODEOWNERS or branch protection rules where supported)
  and is not equivalent to cluster credentials. Adding cluster-admin
  kubeconfig to GitHub Actions for ad-hoc apply remains explicitly
  prohibited by this contract.
- **C-005 (SOPS key custody is named, not implicit):** Every age
  private key listed as a recipient in `.sops.yaml` MUST be custodied
  at a named location pinned in Clarification #9 — never in git, never
  in CI, never in a developer chat. The recipient set is the contract;
  "wherever the operator put it" is not acceptable for any recipient.
  Multi-recipient SOPS is the v1 model: at least two recipients
  (operator-host laptop key + Bitwarden-stored backup key); either
  private key can decrypt. Disaster recovery presupposes at least one
  recipient's private key is recoverable from its named custody, not
  from cluster state (which is the thing being recovered).

## Functional Requirements *(MVP)*

- **FR-001:** A Flux v2 instance MUST run in the `flux-system` namespace
  on every cluster the platform operates. Components: `source-controller`,
  `kustomize-controller`, `helm-controller`, `notification-controller`.
  Pinned to a specific Flux version; bumps are deliberate edits.
- **FR-002:** `platform/gitops/` MUST contain the complete declarative
  cluster state for every cluster the platform operates. Per-cluster
  differences MUST be expressible as Kustomize overlays under
  `platform/gitops/clusters/<cluster-name>/` without forking the base
  tree.
- **FR-003:** `platform/infra/hetzner/setup.sh` MUST reduce to under
  100 lines covering only one-time bootstrap (cluster create, kubeconfig,
  `flux bootstrap`). All ongoing reconcile concerns MUST migrate into
  the gitops tree before this spec closes.
- **FR-004:** Application image rollouts MUST migrate from the current
  imperative `helm upgrade --install --set image.tag=...` flow (which
  CD invokes directly against the cluster — see `cd-statecraft.yml:117-118`
  and `cd-deployd-api-rs.yml:110-111`) to a git-write flow: CD commits
  the new `image.tag` value to the per-service HelmRelease values file
  under `platform/gitops/clusters/<cluster>/` and pushes to main. The
  migration MUST land per-service atomically (the PR that converts a
  service's helm-install setup.sh block into a HelmRelease also updates
  the corresponding CD workflow). Until each service migrates, its CD
  flow remains imperative; the spec MUST NOT mix migrated and
  unmigrated states for the same service. Spec 137 Phase 6 closure
  does not depend on Image Automation or on any app-service migration
  (Phase 2 lands reflector + cert annotations only).
- **FR-005:** Per-purpose Secrets MUST materialise via SOPS-encrypted
  manifests under `platform/gitops/`. The age private keys MUST be
  custodied per C-005 + Clarification #9 (multi-recipient model with
  at least two named recipients — operator-host laptop key and
  Bitwarden-stored backup key — and a checked-in `.sops.yaml` declaring
  both public keys); at runtime at least one of the recipients'
  private keys materialises as the `sops-age` Secret in `flux-system`
  namespace, allowing `kustomize-controller` to decrypt at apply time.
  `kubectl create secret` MUST NOT appear in setup.sh or post-create.sh
  after Phase 5 lands.
- **FR-006:** Flux drift detection MUST emit cluster events for every
  reconciliation; Prometheus metrics MUST expose reconciliation success
  rate, drift count, and last-reconcile-time per resource. Statecraft
  surfacing of these signals is a follow-up, not this spec.
- **FR-007:** Disaster recovery MUST be expressible as a runbook of:
  recreate cluster via terraform/setup.sh → `flux bootstrap` against
  the same git ref → cluster converges to declared state. The runbook
  MUST be exercised at least once before this spec closes.
- **FR-008:** The reflector Helm release and the spec 137 wildcard-cert
  annotations MUST be the first migrations under the new tree (Phase 2).
  This unblocks spec 137 Phase 6 evidence collection. **Slippage path:**
  the default path is no fallback — spec 137 Phase 6 waits for spec 151
  Phase 2. If Phase 0–2 slippage exceeds two sessions AND external
  pressure to close spec 137 is non-trivial, the documented escape is a
  one-time imperative `helm upgrade --install reflector` +
  `kubectl apply -f tenants-wildcard-certificate.yaml` invocation
  captured as migration debt in
  `specs/137-tenant-environment-access-gates/execution/verification.md`
  — explicitly NOT in `platform/infra/hetzner/setup.sh`, which would
  poison this spec's declarative invariant. Phase 2 then adopts the
  manually-applied state on first reconcile (Flux's `helm-controller`
  adopts existing releases by name; cert-manager re-applies the
  Certificate annotations idempotently).
  **Cleanup ownership (so the debt does not become permanent):**
  the PR that lands spec 151 FR-008 implementation MUST also strike
  the imperative apply lines from spec 137's
  `execution/verification.md` (the lines added under the slippage path
  above) and include a verification step in the PR description
  asserting the imperative-apply lines are absent. The PR's
  `implements:` block MUST claim both
  `platform/gitops/clusters/hetzner-prod/reflector.yaml` /
  `tenants-wildcard-certificate.yaml` AND
  `specs/137-tenant-environment-access-gates/execution/verification.md`
  so the spec/code coupling gate cross-checks the cleanup landed
  alongside the implementation.
  The fallback exists so spec 137 closure is not held hostage to spec
  151's timeline indefinitely; the trip-wire framing (two-session
  slippage + external pressure) ensures it is not the default, and the
  cleanup-ownership clause ensures the migration debt is bounded in time.
- **FR-009:** Migration of existing cluster state into gitops MUST be
  incremental — one PR per concern (cert-manager, ingress-nginx, rauthy,
  statecraft chart, deployd-api chart, tenant-hello chart, per-purpose
  Secrets). Each PR MUST be independently mergeable and the cluster
  MUST remain operational after each merge.
- **FR-010:** v1 lands one cluster (`platform/gitops/clusters/hetzner-prod/`)
  as a flat tree — no `base/` + `overlays/` split. Adding overlay
  machinery before a second concrete cluster exists is premature
  abstraction the OAP discipline rejects elsewhere; v1 builds for the
  one cluster we operate. The flat tree MUST NOT preclude a future
  overlay model: file naming, manifest organisation, and
  `Kustomization` scope MUST be compatible with introducing a shared
  `base/` tree later without a wholesale rewrite. Adding the overlay
  machinery itself is deferred until spec 072
  (multi-cloud-k8s-portability) brings a concrete second cluster
  target. Spec 072 benefits from this spec without itself being a
  precondition.

## Success Criteria

- **SC-001:** Modifying a HelmRelease YAML under
  `platform/gitops/clusters/hetzner/` and merging to main results in
  Flux reconciling the change within 5 minutes without operator
  intervention. Demonstrated via the reflector or cert-annotation
  Phase 2 deltas.
- **SC-002:** `platform/infra/hetzner/setup.sh` line count drops from
  the current ≈400 to under 100 lines, covering only bootstrap. The
  reduction is verified by `wc -l` at spec closure.
- **SC-003 (aspirational pending Phase 0 partial baseline + post-
  implementation end-state measurement):** A second cluster can be
  bootstrapped from scratch via the runbook in under 30 minutes of
  operator wall-clock time, arriving at a converged state matching the
  declared gitops tree. The 30-minute budget explicitly INCLUDES four
  steps: (a) at least one SOPS recipient private key available on the
  bootstrap operator's machine per Clarification #9 (the laptop key is
  the expected default; if the laptop is unavailable, the operator
  pulls the backup key from the Bitwarden `OAP` organization's
  `sops-age-hetzner-prod-recovery` item (notes field — amended
  2026-05-18, see §Clarification 9 (b)) and places at
  `~/.config/sops/age/keys.txt`), (b) terraform / `setup.sh` cluster
  create, (c) `flux bootstrap`, (d) cluster convergence to declared
  state.

  **The 30-minute number is aspirational, not measured.** Closing the
  evidence gap is a two-stage measurement, because step (d) cannot
  exist before this spec is implemented (there is no `platform/gitops/`
  tree to converge to at Phase 0). The two stages:

  **Stage 1 — Phase 0 partial baseline (feasibility check, not an
  end-state measurement):** Measure steps (a), (b), and (c) against a
  throwaway Hetzner cluster. Step (d) is structurally NOT measurable
  at Phase 0 because the declared gitops tree does not yet exist; a
  `flux bootstrap` with no manifests to reconcile completes once the
  controllers are healthy. The partial baseline therefore measures the
  **bootstrap-shape feasibility** (the path is real, the tooling
  resolves, the SOPS restore is operational), not the **end-state
  30-min budget**. The numbers it produces are NOT a verdict on
  whether SC-003 holds end-to-end — they are inputs to the per-step
  threshold checks below. Specifically:
  - If SOPS restoration (step a) alone exceeds ~5 minutes, the custody
    choice in Clarification #9 surfaces as needing revisit.
  - If terraform / setup.sh (step b) alone exceeds ~20 minutes, the
    bootstrap is too coupled to the imperative script and the FR-003
    shrink target needs revisit.
  - `flux bootstrap` (step c) feasibility is measured as
    install-only (no gitops tree to reconcile at Phase 0); the
    per-step number records the controller-set install time, not
    convergence time.

  Recorded in `execution/dr-baseline.md`. Phase 0 closure depends on
  the partial baseline existing and being readable; it does NOT depend
  on the partial baseline matching the 30-min budget (which it
  structurally cannot, because step d is absent).

  **Stage 2 — post-implementation end-state DR exercise:** Once the
  declarative gitops tree exists and Flux reconciles a non-empty
  declared state (Phases 1–5 implementation), the full four-step
  sequence is re-measured against a throwaway cluster and recorded in
  `execution/disaster-recovery.md`. This is the measurement that
  confirms or refutes the 30-min budget; the Phase 0 partial baseline
  is what its per-step timings are cross-checked against to detect
  drift between the bootstrap path's feasibility (Phase 0) and its
  end-state behavior (post-implementation).

  **Baseline-vs-target policy (applies to Stage 2's end-state
  measurement, not Stage 1's partial):** if the Stage 2 measurement is
  at or below the 30-minute target, SC-003 closes verbatim. If it
  exceeds the target, the spec body MUST amend SC-003 in the same
  commit that records the Stage 2 measurement, with all three of:
  (a) the measured number, (b) the identified dominant cost (e.g.
  "terraform/Hetzner provisioning at ~25min"), and (c) a sentence on
  the future-shrink path or its explicit absence (e.g. "no v1 path to
  shrink; deferred to a future spec exploring per-cloud provisioning
  alternatives"). Silent acceptance of a larger number ("baseline
  replaces target without rationale") is NOT acceptable — that is the
  cert pipeline's gap closure, not its blank check. Blocking on
  shrinking back to 30 without rationale is ALSO not acceptable — it
  stalls closure on a number argument the spec body should resolve.
  The amendment-with-rationale path is the disciplined middle and the
  pinned policy. The policy does NOT apply to the Stage 1 partial
  because the partial cannot measure the 30-min budget by construction
  (step d is absent); Stage 1 either records the per-step thresholds
  cleanly or triggers the named per-step revisit clauses above.

  **Amendment (2026-05-19, Stage 2 measurement — partial).** SC-003's
  30-min budget for the four-step bare-cluster DR sequence was
  measured against a throwaway Hetzner cluster on 2026-05-19. Steps
  (a) + (b) + (c) closed verbatim in **664 s combined** (well inside
  the 1800 s budget for the parts that ran). Step (d) was structurally
  blocked by **Finding F8** recorded in
  `execution/disaster-recovery.md`: the bare-cluster Flux-only
  reconciliation cannot converge with the current gitops shape —
  kustomize-controller's auto-generated recursive Kustomization fails
  server-side-apply dry-run on the `tenants-wildcard-certificate`
  Certificate (no `cert-manager.io/v1` CRD yet) and aborts before the
  cert-manager HelmRelease is applied, so cert-manager never installs.
  The retry-pattern claim in `infrastructure/cert-manager.yaml`
  ("Convergence is robust per the Phase 2 retry pattern") is
  falsified; the deferred `dependsOn` machinery anticipated by the
  same file's comment IS required. **Dominant cost: design — not
  time.** F8 has a named, scoped resolution (split into
  `Kustomization/infrastructure` + `Kustomization/manifests` with
  `dependsOn`), filed as a follow-up PR before
  `implementation: complete` flips. **Future-shrink path:** F8
  follow-up lands the dependsOn split + re-runs Stage 2 DR against
  the new shape; the re-run measurement either closes SC-003 verbatim
  (expected — steps a+b+c already at 664 s, step d budgeted ~5 min)
  or triggers a further amendment with its own rationale. Spec 151
  `implementation: complete` is gated on the F8 follow-up's clean
  Stage 2 re-run, not this partial measurement. **Related operational
  finding:** F7 captures that the Stage 2 runbook's choice of
  `--path=platform/gitops/clusters/hetzner-prod` (matching production)
  rotated production's deploy key as a side effect; the F8 follow-up
  PR will also switch the runbook to a throwaway-specific path to
  eliminate the cross-environment impact window. Full evidence:
  `execution/disaster-recovery.md` §"SC-003 verdict", §"Finding F8",
  §Step (c) F7 block.

  **F8 follow-up implementation (2026-05-19, code landed; DR re-run
  pending).** The deferred dependsOn machinery is implemented in:
  - `platform/gitops/clusters/hetzner-prod/kustomization.yaml` (NEW
    root, explicit `resources` list — replaces the auto-recursive
    single-batch apply that triggered F8).
  - `platform/gitops/clusters/hetzner-prod/infrastructure-kustomization.yaml`
    (NEW Flux Kustomization for the infrastructure tier; selective
    `healthChecks: [HelmRelease/cert-manager]` so the rauthy
    bare-cluster-failure does not block the chain).
  - `platform/gitops/clusters/hetzner-prod/manifests-kustomization.yaml`
    (NEW Flux Kustomization for the manifests tier;
    `dependsOn: [infrastructure]`, `wait: true` — Certificate /
    ClusterIssuer dry-run only runs after cert-manager Ready).
  - `platform/gitops/clusters/hetzner-prod/infrastructure/cert-manager.yaml`
    inline comment refreshed: the original "retry-pattern is robust"
    claim is marked falsified; the dependsOn-machinery anchor it
    deferred to now exists alongside.

  F8 closure itself remains gated on the Stage 2 DR re-run against
  the new gitops shape. The re-run can now proceed safely against the
  distinct throwaway path landed by F7 future-prevention (below) and
  will NOT collide with production's deploy key. The
  `implementation: complete` flip waits on that re-run AND T-026
  setup.sh shrink.

  **F7 future-prevention (2026-05-19, landed — distinct throwaway
  path).** The Stage 2 DR runbook now bootstraps against
  `--path=platform/gitops/clusters/hetzner-dr-stage2` (sibling tree
  under `platform/gitops/clusters/`) instead of production's
  `--path=platform/gitops/clusters/hetzner-prod`. flux bootstrap
  generates the deploy-key title as
  `flux-system-<branch>-flux-system-<path>`, so distinct paths produce
  distinct titles and the throwaway bootstrap cannot rotate
  production's deploy key as a side effect. The throwaway tree
  reconciles the SAME content production reconciles —
  `hetzner-dr-stage2/kustomization.yaml` imports
  `../hetzner-prod/infrastructure-kustomization.yaml` and
  `../hetzner-prod/manifests-kustomization.yaml` via relative path; no
  duplicated YAML. The F8 dependsOn machinery is inherited by
  reference. The bootstrap-managed `flux-system/` subdirectory is
  created on first DR cycle's `flux bootstrap` invocation; subsequent
  DR cycles re-use the existing entry point (idempotent flux
  bootstrap). The cross-environment hazard window F7 captured is
  now structurally eliminated.
- **SC-004:** No `kubectl create secret`, `helm upgrade --install`, or
  `kubectl apply -f` invocations remain in `setup.sh` /
  `post-create.sh` for runtime cluster state. Verified by grep at spec
  closure.
- **SC-005:** A manual `kubectl edit deployment` against a Flux-managed
  resource is reverted within one reconciliation interval. Evidence:
  a deliberate drift test recorded in `execution/verification.md`.
- **SC-006:** Spec 143 FU-008 closes by reference to SC-006 here:
  per-purpose Secret materialisation no longer requires re-running
  setup.sh; the seam is retired structurally for the M2M Secret class.
- **SC-007:** Spec 137 Phase 6 evidence E1–E6 is collected against a
  cluster where the spec 137 reflector + cert annotations were
  reconciled by Flux from `platform/gitops/`, not applied by setup.sh.

## Out of scope (MVP)

- **Image automation in Flux** — image-push to GHCR continues to drive
  app rollouts via the existing CD workflows. Adopting
  `image-reflector-controller` + `image-automation-controller` is a
  future spec, not this one.
- **Tenant resource reconciliation** — deployd-api remains the renderer
  for tenant Deployments / Services / Ingresses at tenant-deploy time.
  Migrating tenant rendering to Flux is a different conversation.
- **Replacing terraform** — cluster creation stays on terraform / hcloud-cli
  / kubeone. Flux installs after `kubectl` is reachable.
- **Statecraft UI for declared state** — operators continue to edit YAML
  in PRs; PR review is the governance surface. A future spec may add a
  statecraft view over the gitops tree, but authoring stays in git.
- **Cross-region disaster recovery** — single-region per cluster for v1.
  Multi-region is a different problem class.
- **Multi-tenant Flux** — one Flux instance per cluster with cluster-admin
  scope. Tenant-scoped Flux (per-namespace reconciliation policies) is
  out of scope; tenants don't operate clusters.

## Clarifications

The clarifications below are real open decisions; each is load-bearing.
Phase 0 closes when **all three** are satisfied: (a) every §Decision in
`clarifications-resolved.md` matches the six-field schema below, (b)
the SC-003 **Stage 1 partial baseline** (feasibility check on steps a,
b, c; step d structurally deferred to Stage 2) has been measured and
recorded in `execution/dr-baseline.md`, and (c) any §Decision that
requires the operator to substitute a placeholder (e.g. Clarification
#9's password-manager vault path) has had the substitution committed
to the spec body verbatim. A thumbs-up reaction on GitHub does not
close a clarification; an unstructured "accepted" does not close one
either. The governance certificate pipeline ingests this file; the
schema is what makes "rationale" non-trivially verifiable rather than
file-exists-with-N-entries.

**`clarifications-resolved.md` schema (every §Decision entry, all six
fields required):**

```markdown
### §Decision N — <kebab-case slug matching the clarification topic>

**Decision:** <quote the spec's pinned text verbatim — after Phase 0
closes, the spec body's "Recommend X" lines are rewritten to "Pinned:
X" and this field quotes that text exactly, OR references the spec
line by stable anchor (e.g. `§Clarification N`). Free paraphrase is
NOT allowed — it invites drift between spec body and resolved-md, a
class of bug the cert pipeline cannot detect without the structural
link>

**Alternatives considered:** <bulleted list of the alternatives the
clarification surfaced; for each, one line on why it lost. "None" is
not a valid value — every load-bearing decision has at least one
alternative, even if that alternative is "do nothing">

**Rationale:** <one line; the load-bearing reason. "Reviewer agreed"
is not a rationale — name the actual structural / constitutional /
empirical reason>

**Consequences:** <one line; what changes downstream if this decision
flips. Names the downstream specs / FRs / files that would have to
change. This is the cert pipeline's tamper-detection surface — if a
later decision contradicts this consequence, the conflict surfaces
empirically>

**Review:** <one of `single-author-self-pinned`, `external-reviewer`,
`multi-party-review` — this field exists so the cert pipeline does
NOT conflate self-pinning with multi-party review. Self-pinning is a
legitimate state for a single-author project; the pipeline emits the
review class as-is and the artifact does not claim social proof it
does not have. If `external-reviewer` or `multi-party-review`, list
the reviewer handles inline. **Downstream-treatment contract:** the
governance certificate pipeline (spec 102) MUST surface
`single-author-self-pinned` distinctly in emitted artifacts —
either as a flagged field in the certificate JSON, or as a separate
evidence class — so downstream consumers do not read it as equivalent
to externally-reviewed pins. Implementing this differential surfacing
is a spec 102 amendment, not a spec 151 deliverable; spec 151 names
the requirement (this clause) and spec 102 implements it. If spec 102
has not added the surfacing by spec 151's Phase 0 close, a stub
follow-up filed against spec 102 is acceptable evidence — the
requirement is named, not silently assumed>

**Pinned:** <YYYY-MM-DD by <name-or-handle>>
```

The schema is enforced at Phase 0 close: a `clarifications-resolved.md`
that is missing any of the six required fields for any §Decision is
not a valid pin set, and Phase 0 is not closed. A future spec may add
an automated linter for this schema; the MVP enforcement is reviewer
discipline against the schema printed above.

Recommended answers below are starting points for reviewer discussion,
not decisions.

### Session 2026-05-17

1. **Reconciliation tool: Flux v2 vs Argo CD vs other?** Recommend
   **Flux v2** for one constitutional reason and a small set of
   tiebreakers. *Constitutional reason:* Spec 087 establishes
   statecraft as the platform's operator surface. Argo CD ships a
   first-class operator dashboard that would create a competing
   operator surface for cluster state — operators would face two
   surfaces (statecraft for tenant + governance, Argo for cluster)
   instead of one. Flux v2 has no operator UI; its interface is
   controller-set + cluster events + Prometheus metrics, leaving
   statecraft as the single operator surface per spec 087.
   *Tiebreakers:* lighter-weight runtime, Helm-native (HelmRelease
   is a first-class CRD), no dashboard server to operate, aligns
   with our minimal-binary aesthetic. Other tools (Rancher Fleet,
   Werf) are off the table — not enough adoption / CNCF momentum.
2. **Secrets approach: SOPS vs Sealed Secrets vs External Secrets Operator?**
   Recommend **SOPS with age**: git-native, no in-cluster controller
   dependency beyond Flux's built-in SOPS support, no external Secret
   Manager required. Sealed Secrets requires a dedicated controller and
   per-cluster key management that complicates disaster recovery.
   External Secrets Operator pulls Anthos/Vault/AWS Secrets Manager —
   useful long-term but adds a hard external dependency we don't need
   for the FU-008 use case (M2M creds we already hold locally).
3. **Repo topology: monorepo (this repo) vs separate gitops repo vs
   branch?** Recommend **monorepo with `platform/gitops/` tree**.
   Aligns with constitution Principle V (legacy inputs non-normative,
   one canonical truth) and the existing spec/code coupling model.
   Separate gitops repo would split the spec-to-code traceability the
   codebase-indexer relies on. Branch-based gitops is fragile.
4. **Bootstrap shape: `flux bootstrap` vs Terraform-installed Flux vs
   setup.sh wrapper?** Recommend **`flux bootstrap`** as the canonical
   Flux pattern, invoked once from the shrunk setup.sh after cluster
   creation. Terraform-installed Flux would couple Flux lifecycle to
   terraform state (over-coupling). setup.sh wrapper-with-helm-install
   re-implements `flux bootstrap` worse.
5. **App image CD relationship: dissolve the dual-writer by moving image
   tags into git, not by ignoring fields.** The previous draft pinned
   `spec.driftDetection.ignore` on a path, which is a patch-over-conflict.
   This pin commits to the architecturally coherent answer: **CD writes
   image tags to the gitops tree, Flux reconciles, helm-controller rolls
   pods. CD never touches the cluster.** Concretely:
   - **Current CD flow (to be retired per service):**
     `cd-statecraft.yml:117-118` and `cd-deployd-api-rs.yml:110-111`
     invoke `helm upgrade --install --set image.tag=sha-${SHA}`
     directly against the cluster. That is a second helm client; under
     Flux this is the dual-writer fight.
   - **v1 CD flow (per-service migration in Phase 5):** CD builds and
     pushes the image to GHCR first, then commits the new `image.tag`
     value into the relevant HelmRelease values file under
     `platform/gitops/clusters/hetzner-prod/` and pushes to main. Flux's
     `source-controller` picks up the commit (with a webhook receiver
     to avoid the default 1-min polling delay), `helm-controller`
     reconciles the HelmRelease, the Deployment rolls naturally.
   - **Failure-mode ordering (push image first, then commit):** if
     image-push succeeds and the commit fails, the GHCR tag is orphaned
     but harmless (next CD invocation writes a new SHA tag; GHCR's
     retention garbage-collects untagged-but-orphaned tags). If the
     commit lands before GHCR replicates the new tag (rare race),
     `helm-controller` hits `ImagePullBackOff` briefly until the image
     appears; no manual recovery required.
   - **Conflict on concurrent CDs:** if two services build at the same
     time and both push to main, GitHub's branch-protection serialises;
     the second push rebases or retries. The values file write is a
     single-line edit so merge conflicts are not expected; if they
     occur, the CD job retries with rebase.
   - **Chart-contract for image values shape (CD's reading surface):**
     every OAP application chart MUST expose its image values under a
     uniform shape, declared in a `cd-managed-images.yaml` companion
     file at the chart root. Pinned schema, with worked example:

     ```yaml
     # platform/charts/<service>/cd-managed-images.yaml
     #
     # CD-managed images contract (spec 151 Clarification #5 sub-pin i).
     # Every entry names one container that CD builds. CD's git-write
     # step reads this file, finds the entry matching the container it
     # just built, and updates the named `values_path` in the
     # HelmRelease's `spec.values` block. Charts without this file are
     # NOT CD-managed (operator pins tags manually).
     images:
       - container: statecraft               # required: container name in Deployment template
         values_path: image.tag              # required: dotted YAML key CD writes
         repository_path: image.repository   # informational; CD never bumps repository
         init: false                         # optional, default false; marks init containers
     ```

     Schema invariants:
     - `container` (string, required) — MUST match a `name:` field in
       the chart's Deployment template's `spec.template.spec.containers`
       or `initContainers` array. CD matches on this to find its entry.
     - `values_path` (string, required) — dotted YAML key path into the
       HelmRelease's `spec.values`. CD writes the new image SHA tag to
       this key on every build.
     - `repository_path` (string, optional) — informational. CD does
       NOT bump the repository on builds (image repository is a chart-
       contract concern, not a CD-bump concern).
     - `init` (boolean, optional, default `false`) — marks init
       containers. CD does not currently treat init containers
       differently, but the flag is reserved so future tooling
       (e.g. an automated check enforcing all init-container builds
       go through a fixture pipeline) has a stable surface.

     Multi-container charts add one entry per container with distinct
     `values_path` keys (e.g. `image.main.tag`, `image.sidecar.tag`).
     Charts WITHOUT this file are NOT CD-managed (operator pins the
     tag manually, e.g. `rauthy` which is third-party-versioned at
     `0.35.0`). This contract centralises path knowledge in the chart
     that owns it, not in per-service CD scripts. Schema lives in the
     spec body (the snippet above is the authoritative shape); the
     first chart migration in Phase 5 establishes the working example.
   - **First-image-deploy baseline (per-service migration PR's
     responsibility):** when a HelmRelease for service X first lands in
     git, its `image.tag` MUST be pinned to the SHA of the image
     currently running in the cluster at migration time (read from
     `kubectl get deployment <X> -o jsonpath='...'` and pasted into
     the HelmRelease). Empty tags fail helm; sentinel tags like
     `:bootstrap` fail image-pull. CD's first run after migration
     replaces this with the next-built SHA.
   - **Per-service migration atomicity — enforcement is layered, not
     a single hand-wave "gate":**
     The PR that lands a HelmRelease for service X MUST also update
     `.github/workflows/cd-<X>.yml` to remove the `helm upgrade --install`
     block and replace it with the git-write step, in the SAME commit.
     Landing a HelmRelease for service X without updating its CD
     workflow guarantees a dual-writer fight (Flux reconciles to the
     HelmRelease values, CD imperatively overwrites them, Flux reverts
     on next reconcile loop). The enforcement is structural in two
     layers:

     **(1) First-claim enforcement — reviewer + CODEOWNERS at migration
     PR time.** The migration PR's `implements:` block (in
     `specs/151-declarative-cluster-reconciliation/spec.md`) adds
     claims for BOTH `platform/gitops/clusters/hetzner-prod/<X>-helmrelease.yaml`
     AND `.github/workflows/cd-<X>.yml`. The PR description's
     verification step asserts both claims are present. CODEOWNERS for
     `platform/gitops/clusters/**` and `.github/workflows/cd-*.yml`
     overlap on the spec 151 owner, so the migration PR cannot land
     without a review that catches an incomplete claim. The spec/code
     coupling gate (spec 127, `tools/spec-spine/spec-code-coupling-check/`,
     CI workflow `.github/workflows/ci-spec-code-coupling.yml`) does
     NOT directly catch a missing claim at first-claim time — it fires
     on *touched paths claimed by some spec*; if a path is unclaimed
     and untouched, the gate has nothing to inspect.

     **(2) Post-migration enforcement — coupling gate fires structurally.**
     Once the migration PR has landed and both paths are claimed in
     spec 151's `implements:`, any subsequent PR that touches ONLY one
     of the two paths (e.g. updates the HelmRelease without touching
     `cd-<X>.yml`) triggers the coupling gate: a claimed-path is in
     the diff but the spec.md is not. The PR must either modify
     `spec.md` to remove the orphaned claim (an explicit decision to
     un-couple, reviewable) or include the paired path in the diff.
     The structural enforcement is real *after* the migration PR
     correctly claims both paths.

     **(3) Future hardening (named, not v1):** a sibling check in
     `ci-spec-code-coupling.yml` that fails when a PR touches
     `platform/gitops/clusters/<cluster>/<service>-helmrelease.yaml`
     without `.github/workflows/cd-<service>.yml` (or vice versa) at
     first-claim time would close layer (1)'s discipline-dependence.
     Adding this check is a future spec-151 amendment (Phase 5+) or a
     spec 127 sibling-rule; not v1. Documented here so the gap is
     named, not silently assumed away.

     Reviewer MUST refuse a HelmRelease-only PR for a CD-managed
     service; the layered enforcement above is the structural backbone,
     not a substitute for the reviewer's first-line discipline.
   - **Rollback semantics (break-glass, not routine):** routine
     rollback is `git revert` on the offending commit; CD picks up the
     revert and rolls pods back. `helm rollback` and `kubectl rollout
     undo` are NOT prohibited but are break-glass — when paging an
     operator at 3am, the operator may invoke them to restore service
     immediately. Within 24h, the operator MUST land a follow-up PR
     that either (a) reverts the offending commit (codifying the
     rollback in git) or (b) restores the original state by re-applying
     the intended values. Until the follow-up PR lands, Flux's drift
     detection actively surfaces the divergence in cluster events.
     This honours C-001 (single source of truth in git) without
     pretending 3am-emergency operations don't exist.
   - **Commit signing for CD-bot commits — explicitly out of scope v1,
     not silently traded:** the CD GitHub Actions job commits to main
     as `github-actions[bot]` (via the default `GITHUB_TOKEN` for
     `contents: write` on `platform/gitops/clusters/<cluster>/**/values.yaml`,
     scoped via CODEOWNERS or branch protection). These commits are
     NOT signed. Spec 116 does not currently require commit signing
     (verified against spec 116 §3 in-scope list); adding signed CD
     commits would require a dedicated bot identity with key custody
     analogous to C-005. That is named here as a known gap, addressed
     by a future spec (likely a spec 116 amendment or a sibling
     supply-chain spec). v1 explicitly accepts unsigned CD commits to
     `platform/gitops/values/**` paths; the trade-off is recorded, not
     silent.
   - **CI/CD permissions:** the CD GitHub Actions job needs
     `contents: write` on this repo, scoped via CODEOWNERS or branch
     protection to the gitops values files only. The cluster kubeconfig
     that today's CD uses for `helm upgrade` can be revoked at
     migration time per service.
   - **Why this over `driftDetection.ignore`:** ignore-paths model the
     image field as "shared ownership" between Flux and CD, which is a
     latent dual-writer with a polite truce. Git-write makes the image
     field exclusively Flux-owned with CD as the upstream content
     producer — single-writer, consistent with the spec's principle
     that declarative state in git is the cluster's intended state.
   - **Image automation (future spec):** Flux's `image-reflector-
     controller` + `image-automation-controller` would observe new tags
     in GHCR and commit values updates without CD doing the write. That
     is a strictly stronger version of v1's mechanism (no CD git push
     needed) and lands as a separate spec once v1 is operational.
6. **Multi-cluster topology: defer overlay machinery until a second
   cluster exists.** Recommend **flat single-cluster v1**:
   `platform/gitops/clusters/hetzner-prod/` holds the full declared
   state directly, no `base/` + `overlays/` split. Kustomize is still
   the renderer (Flux's `Kustomization` CR) but with a flat tree.
   Building overlay machinery before a second cluster exists is the
   premature abstraction the OAP discipline rejects elsewhere — three
   similar lines is better than a speculative abstraction. When spec
   072 (multi-cloud-k8s-portability) brings a concrete second target
   (AWS / GCP / DO), that is when the `base/` extraction lands,
   driven by an actual second instance with real differences to
   capture (domain, replicas, region, provider-specific values). The
   v1 flat tree MUST be structured so the future extraction is
   mechanical — kustomize-compatible file naming, single
   `Kustomization` per cluster, no implicit dependencies between
   manifest files — but the extraction itself is deferred.
7. **Drift surfacing: cluster events + Prometheus only vs statecraft UI
   vs Slack/PagerDuty?** Recommend **cluster events + Prometheus for v1**.
   These are the Flux defaults and require no additional integration.
   Statecraft UI surfacing is a follow-up that uses the same Prometheus
   metrics; Slack/PagerDuty hooks into the existing notification stack
   are also a follow-up. Don't gate this spec on observability ergonomics.
8. **Migration ordering: which existing concerns migrate first vs last?**
   Recommend **reverse-risk ordering**: lowest-stakes first (reflector,
   which is new and standalone), then operational helpers (cert-manager,
   ingress-nginx), then identity (rauthy), then app-charts (statecraft,
   deployd-api), then per-purpose Secrets (highest stakes, gated on
   SOPS path being solid). Each migration is one PR; setup.sh shrinks
   monotonically.

9. **SOPS key custody — multi-recipient model, five load-bearing
   sub-decisions:**

   **Locked pin (verbatim):** *"Custody: operator-host
   `~/.config/sops/age/keys.txt` (mode 0600) + Bitwarden `OAP`
   organization, item `sops-age-hetzner-prod-recovery`, notes field.
   `.sops.yaml` recipients list includes both public keys; either
   private key can decrypt. Multi-operator custody remains out of scope
   v1 per the named future spec."* **Amended 2026-05-18 (Phase 5 F1
   measurement)**: "attachment `keys.txt`" → "notes field"; see
   §Clarification 9 (b) amendment block below for rationale.

   **(a) Mechanism — multi-recipient SOPS (minimum two recipients,
   v1 commits to exactly two).**
   `.sops.yaml` declares both public keys as recipients. age supports
   multi-recipient natively: every encrypted file carries N wrapped
   data-encryption-keys, one per recipient pubkey; either private key
   decrypts. This is architecturally stronger than "two copies of one
   key" — the two keys are independent recipients, not custodial
   duplicates, which means partial rotation (rotate one key, leave the
   other) is possible without losing decryption continuity. The future
   rotation-tooling spec (sub-decision (d)) is cheaper as a result:
   rotation becomes a recipient-list edit + re-encrypt sweep, with
   the unchanged recipient providing continuity throughout.

   **(b) Named custody locations — Bitwarden, not 1Password, not
   "operator's password manager."**
   - *Laptop (daily-use) private key:* operator-host filesystem at
     `~/.config/sops/age/keys.txt`. File mode `0600`, ownership
     operator-only. This is the key the operator uses for `sops edit`
     and the key whose private form lives in the cluster's `sops-age`
     Secret (sub-decision (c) below).
   - *Backup (recovery) private key:* **Bitwarden `OAP` organization,
     item `sops-age-hetzner-prod-recovery`, notes field**.
     Held purely as operator-side DR; never used day-to-day. If the
     laptop key is lost (device failure, key compromise), the
     operator imports the backup key from Bitwarden, applies it as
     the new `sops-age` Secret in-cluster, and (optionally) rotates
     the laptop key out of `.sops.yaml` to revoke the lost one.
   - *`.sops.yaml` recipients list:* checked-in at repo root (or under
     `platform/gitops/`), declares both public keys verbatim. Adding
     or removing a recipient is a PR edit; CODEOWNERS gates the file.

   Bitwarden chosen over 1Password as the operator's working
   password-manager-of-record; clean upgrade path from LastPass.
   Substitution from the earlier 1Password recommendation is committed
   verbatim in this clarification per Phase 0 criterion (c).

   **Amended 2026-05-18 (Phase 5 F1 measurement).** The original
   clarification text said "free tier covers the attachment-storage
   requirement"; that was factually wrong — Bitwarden's free tier does
   NOT support attachments (paid Premium plan required). The custody
   shape uses the item's **notes field** instead, which the free tier
   supports without length restriction. The age secret-key file
   (3 lines: `# created` header + `# public key` header +
   `AGE-SECRET-KEY-1...`, ~188 bytes) pastes cleanly into the notes
   field with no information loss vs the attachment path, equivalent
   vault-encrypted-at-rest security, and faster operator copy during
   DR (one click vs download-then-read). F1 measured end-to-end at
   ≤35s wall-clock (well inside the 5-min threshold) on 2026-05-18;
   see [`execution/dr-baseline.md`](./execution/dr-baseline.md) F1
   closure block. The session also demonstrated an emergent recovery
   property the original §FR-007 didn't claim: the cluster's
   `flux-system/sops-age` Secret can be read back via `kubectl get
   secret … -o jsonpath` to recover whichever private key it holds —
   the cluster acts as a third de-facto recipient store complementing
   the operator-host laptop key + Bitwarden backup pair. Real-world
   validated 2026-05-18 when a workstation stash/restore bug lost the
   laptop key from disk; cluster-pull recovered it cleanly.

   **(c) Cluster runtime form — `sops-age` Secret holds the laptop
   private key.**
   At bootstrap time the operator pastes the laptop private key
   contents into the cluster as the `sops-age` Secret in `flux-system`
   namespace (Flux's convention). Flux's `kustomize-controller` reads
   it for SOPS decryption at apply time. The backup private key NEVER
   touches the cluster under normal operation — it lives in Bitwarden
   as pure DR. If the laptop key is lost, the operator pulls the
   backup key from Bitwarden and re-applies it as the new `sops-age`
   Secret on the running cluster (no re-bootstrap needed; Flux picks
   up the new key on next reconcile). The `.sops.yaml` recipients
   list is unchanged in this flow because both pubkeys remain valid.

   **(d) Rotation policy — out of scope for v1, but mechanism is
   already in place.**
   v1 does NOT ship key-rotation tooling. The future spec
   ("SOPS key rotation tooling") adds `make rotate-sops-key` that
   automates the recipient-list edit + tree-wide re-encryption sweep.
   v1 compromise-recovery path: if the laptop key is compromised, the
   operator manually edits `.sops.yaml` to remove the compromised
   pubkey + add a fresh laptop pubkey, runs `sops updatekeys` against
   every encrypted file, and updates the cluster's `sops-age` Secret —
   all without touching the backup key. Tree size today is small
   enough that this is a 1-hour operation, not the 1-day operation
   single-recipient rotation would have been. The mechanism (multi-
   recipient + `sops updatekeys`) is already in place; the v1 gap is
   tooling, not architecture.

   **(e) Multi-operator custody — out of scope for v1, named future
   spec.**
   v1 assumes a single operator-of-record. The two recipients are
   that operator's keys (daily + backup), not multi-operator. When
   OAP eventually has multiple platform operators, the custody model
   extends the same `.sops.yaml` recipients list with one additional
   pubkey per operator + an offboarding contract (when an operator
   leaves, their pubkey is removed AND the tree is re-encrypted to
   exclude them via `sops updatekeys` — same mechanism, different
   trigger). That work is a future spec ("multi-operator SOPS
   custody"), not v1. Multi-recipient v1 puts the platform on the
   path; the future spec just expands the recipient set.

   **Recovery boundary — included in SC-003's 30-min budget.**
   SC-003's "fresh cluster in <30min" MUST include the time to
   restore at least one recipient private key from custody. The 5-min
   sub-threshold applies to either key path: if the laptop key is
   already on the bootstrap operator's machine (the expected
   default), restoration is free; if the laptop is unavailable and
   the operator must pull from Bitwarden, the 5-min threshold
   measures the Bitwarden-unlock-and-extract path. Exceeding ~5 min
   on the Bitwarden path surfaces the custody choice as needing
   revisit. SC-003 amended above to make this explicit.

## Risks

- **R-001 (Flux as new SPOF):** Flux itself becomes critical
  infrastructure. If Flux is mis-bootstrapped or its controllers crash
  loop, cluster state stops converging. Mitigation: Flux has been
  battle-tested in production at large scale (CNCF graduated 2024-04);
  pin to a known-good version; the disaster recovery runbook covers
  Flux re-bootstrap.
- **R-002 (SOPS key custody — named in Clarification #9, not mitigated
  here):** The age private keys are the cluster's decryption surface.
  If ALL recipients' private keys are lost, all SOPS-encrypted Secrets
  become inaccessible (existing values continue to work since Flux
  already decrypted them, but rotation breaks). The multi-recipient
  v1 model means SINGLE-key loss is recoverable from the other
  recipient — total-key-loss requires losing both the laptop key and
  the Bitwarden backup, which is a meaningfully smaller failure
  surface than the previous single-key model would have had. The
  custody locations are load-bearing contract decisions pinned in
  Clarification #9 + C-005 — they cannot be a Risks-section
  mitigation. R-002 records the consequence only and points at the
  contract clauses for resolution. A future spec may move recipients
  to a managed KMS or hardware-attested keys; v1 commits to
  operator-host laptop + Bitwarden-stored backup per Clarification #9.
- **R-003 (migration mid-state operational risk):** While Phases 3–5
  are in flight, some concerns are managed by Flux and some by
  setup.sh. A re-run of setup.sh during this window would conflict
  with Flux-managed state. Mitigation: each migration PR includes the
  setup.sh edit to retire the relevant imperative block in the same
  commit; setup.sh cannot re-create what Flux owns.
- **R-004 (CRD ordering):** Flux installs HelmReleases that themselves
  install CRDs (cert-manager Issuer, Certificate; rauthy CRDs if any).
  CRD-before-CR ordering must be respected. Mitigation: Kustomization
  `dependsOn` and HelmRelease ordering primitives handle this; the
  Phase 3 cert-manager migration exercises the pattern first.
- **R-005 (spec 137 timing — mutual dependency):** The binding between
  spec 151 and spec 137 goes both directions: 151 Phase 2 unblocks 137
  Phase 6, but if 151 Phase 0–2 slips, 137 stalls. Mitigation: Phase 2
  is intentionally scoped narrowly (reflector + cert annotations only
  — the two spec 137 deltas) so the unblock is concrete and bounded.
  FR-008 names the documented slippage path (one-time imperative apply,
  recorded as migration debt in spec 137's `execution/verification.md`,
  NOT in setup.sh) for the case where 151's timeline runs long under
  external pressure. The default path is no fallback; the fallback is
  trip-wire-bounded (two-session slippage + external pressure) so it
  is not the default. Full migration of other concerns continues in
  parallel without blocking 137.

## Cross-references

- **Spec 087 (unified-workspace-architecture):** Statecraft is the
  operator surface; this spec defines how statecraft's operator
  actions (and PRs from any author) reach the cluster.
- **Spec 143 (presigned-upload-public-endpoint) §12 FU-008 + FU-003:**
  This spec is the structural fix that retires the setup.sh-monolith
  seam pattern. FU-008 names the pattern explicitly
  (`statecraft-knowledge-sweeper-credentials`); FU-003 names three
  sibling sweepers that inherit the same pattern
  (`extraction-staleness-sweeper`, `connector-sync-scheduler`,
  `factory-runs-staleness-sweeper`, per spec 143 §12). SC-006 here
  satisfies FU-008's intent and obviates FU-003's per-sweeper
  re-derivation. Spec 143 §12's separate Rauthy-seam (L-005/L-006) is
  a different class — protocol-generality-vs-empirical-behavior — and
  is NOT addressed by this spec.
- **Spec 137 (tenant-environment-access-gates):** Phase 6 evidence
  collection is unblocked by this spec's Phase 2.
- **Spec 105 (scripts-to-binaries-migration):** Same lineage — moving
  imperative scripts to governed structures. Spec 105 migrated tools
  to Rust binaries or Makefile recipes; spec 151 migrates cluster
  mutations to declarative manifests.
- **Spec 072 (multi-cloud-k8s-portability):** Beneficiary, not
  dependency — the gitops tree's overlay model makes multi-cloud
  cluster bootstrap consistent across providers.
- **Spec 089 (governed-convergence-plan):** Aligns with the
  convergence direction (governance non-optional; cluster mutations
  governed by spec-bound PRs, not operator-side scripts).
- **Spec 116 (supply-chain-policy-gates):** SOPS-encrypted Secrets in
  git are within the supply-chain envelope; the encryption discipline
  must satisfy 116's gates.

## Why this spec is filed as `draft`

The 9 clarifications above are load-bearing decisions that benefit from
one reviewer pass before lock-in. The recommendations are starting
points; Phase 0 closes when ALL of the following land: (a) every
§Decision in `clarifications-resolved.md` matches the six-field schema
in the Clarifications preamble (Decision verbatim / Alternatives
considered / Rationale / Consequences / Review / Pinned), (b) the
SC-003 **Stage 1 partial baseline** (steps a + b + c only; step d is
structurally deferred to the post-implementation Stage 2 DR exercise
because the gitops tree does not exist at Phase 0) is measured and
recorded in `execution/dr-baseline.md`, (c) any placeholder pin (e.g.
Clarification #9's password-manager vault path if substituted) is
committed to the spec body verbatim. A recommendation accepted verbatim still requires
the five other fields; pinning is not a GitHub reaction and "accepted"
alone is not a rationale. Until Phase 0 closes, the `platform/gitops/`
directory and the Flux installation MUST NOT be created — the spec's
body drives the implementation, not the other way around (CONST-005).

## Implementation scope — a plan-time decision

This spec's surface has grown across review rounds: from one
clarification to nine, with Clarification #5 carrying eight sub-pins,
plus a new contract clause (C-005), new closure gates, and a structured
schema for `clarifications-resolved.md`. Each addition closes a real
seam; the growth is a feature, not bloat. But the implementation
surface — Flux bootstrap → operational chart migrations → app-chart
migrations with the new chart-contract + CD git-write flow → SOPS
per-purpose Secrets → drift detection + DR validation — is now large
enough that plan.md must make a deliberate decision about how to phase
or split it.

The two plan-time options:

- **Single-spec sequenced implementation.** Phases 0–6 (or however many)
  land under spec 151's banner, ordered carefully so load-bearing
  dependencies hold: Flux MUST exist before HelmReleases; the
  chart-contract (sub-pin i) MUST exist before the first per-service
  migration; SOPS bootstrap MUST exist before any per-purpose Secret
  migrates. The phasing itself becomes the risk surface — a stalled
  Phase 3 blocks Phase 4.
- **Split into sibling specs.** Spec 151 narrows to Flux + bootstrap
  + operational chart migrations (reflector, cert-manager,
  ingress-nginx, rauthy) and unblocks spec 137 Phase 6. A sibling
  spec (provisionally 151b — "declarative app-chart migration") takes
  on Clarification #5's eight sub-pins, the chart-contract, the
  per-service atomicity rules, and the CD git-write flow. A second
  sibling (151c) handles SOPS per-purpose Secret migration (FU-008 /
  FU-003 retirement). Each sibling lands independently; spec 151
  closes as soon as its narrower scope holds.

This decision was **explicitly deferred to plan.md** and **pinned
2026-05-18 by bart: split into three sibling specs** (this spec
narrowed to Flux + bootstrap + operational charts; provisional spec
152 carries Clarification #5's eight sub-pins + chart-contract + CD
git-write; provisional spec 153 carries SOPS per-purpose Secret
migration that closes spec 143 FU-008 + FU-003). The three-reason
rationale and per-sibling scope boundaries are recorded in
[`plan.md`](./plan.md). The contracts (M-001/M-002/M-003,
C-001..C-005, FR-001..FR-010, SC-001..SC-007) apply regardless of
the split — siblings inherit the contract surface, they don't
re-decide it. Spec 151's own implementation scope is the narrowed
subset (FR-001/002/003-narrowed/005-Flux-runtime-only/006/007/008/009/010);
FR-004 and the per-purpose application of FR-005 lift verbatim into
152 and 153's spec bodies when those siblings are filed (filing
protocol in plan.md).

## Phase 1 prep landed (2026-05-18)

Foundation-only edits — no FR closures, no Flux running in production
yet. This section records the bootstrap-scaffold landing so the
`implements:` block above is anchored to a narrative entry rather than
floating as a list of paths.

**What landed:**

- `platform/infra/hetzner/setup.sh` — header comment updated (T-001) to
  document the prerequisites surface and forward-link to docs/DEVELOPERS.md
  §"Hetzner GitOps operator (spec 151)". The pre-flight enforcement
  (`for cmd in kubectl helm hetzner-k3s ...`) is NOT tightened in this
  PR: extending it to require `flux`, `sops`, `age` before T-007 has
  any consumer for those tools would break current operators. T-007's
  PR adds them to pre-flight at the same time it wires
  `flux bootstrap`.
- `platform/gitops/clusters/hetzner-prod/` — directory scaffold for
  the declared state tree (T-004). Three subdirectories with
  explanatory READMEs: `infrastructure/` (Phase 2–4 HelmReleases),
  `manifests/` (raw K8s resources), `secrets/` (placeholder; spec 153
  owns the per-purpose Secret migration). `flux-system/` is
  intentionally absent — `flux bootstrap` creates its content on T-007.
- `docs/DEVELOPERS.md` — new "Hetzner GitOps operator (spec 151)" subsection
  under Prerequisites. Lists the four CLIs (`hetzner-k3s`, `flux`,
  `sops`, `age`) with brew install lines and a one-liner. Records the
  k3s ↔ Flux version pair as the operator-facing pin and points at the
  top-level gitops tree README as the durable source of truth.

**What did NOT land:**

- T-002 (the canonical Flux version-pin manifest) — owned by `flux
  bootstrap` itself; the bootstrap-generated `flux-system/
  gotk-components.yaml` is where the version is canonically recorded in
  the cluster tree. The docs/DEVELOPERS.md + gitops-tree-README entries are
  the human-readable mirror, not the source of truth.
- T-003 (`cluster.yaml` `k3s_version` bump from `v1.31.4+k3s1` to
  `v1.33.11+k3s1`) — dr-baseline.md §F4 specifies "same PR as the one
  that lands `flux bootstrap`". Pairing the bump with T-007 keeps the
  cluster shape and the Flux runtime atomically aligned: if Phase 1
  prep merged with the bump alone, an operator-initiated cluster
  recreation between this PR and T-007's PR would land a Flux-less
  v1.33 cluster with no in-tree GitOps reconciler. T-003 moves to
  T-007's PR.
- T-005, T-006 — operator-host laptop age keypair + Bitwarden-stored
  backup keypair. Key generation has real-world side effects
  (`~/.config/sops/age/keys.txt` written, Bitwarden vault item created);
  scheduled for an interactive operator session, not a code PR. The
  resulting `.sops.yaml` at repo root will land alongside.
- T-007 — `setup.sh` shrink + `flux bootstrap github` invocation.
  Requires operator-side execution against the production cluster;
  scheduled for the maintenance window that lands the Phase 2
  reflector + wildcard-cert annotations (the original "why now" trigger
  per spec 137 Phase 6).

**Phase 1 done-when status:** still pending. The done-when criterion
in tasks.md ("`kubectl get pods -n flux-system` shows the four default
controllers Ready") is closed by T-007 (B) against a real cluster;
Phase 1 prep is the file-only precondition for that step, not its
completion.

## Phase 1 closure code landed (2026-05-18)

The Phase 1 closure splits naturally in two: the **code PR** (T-005 +
T-006 + T-007 (A) — file edits) lands first; the **live bootstrap**
(T-007 (B) — `flux bootstrap github` + `sops-age` Secret apply against
the production cluster) executes in the operator window that pairs
with Phase 2's reflector + wildcard-cert migration. Recording the code
landing here keeps the `implements:` block anchored to a narrative
entry per the same pattern as the prep section above.

**What landed in this PR:**

- `.sops.yaml` at repo root — multi-recipient SOPS configuration per
  §Clarification 9. Operator-host laptop pubkey + Bitwarden-stored DR
  pubkey both declared; `encrypted_regex` scoped to `(data|stringData)`
  so Secret metadata stays diff-readable; `path_regex` scoped to
  `platform/gitops/clusters/hetzner-prod/secrets/` (spec 151 ships the
  runtime mechanism; spec 153 lands the encrypted manifests).
  Multi-recipient roundtrip verified locally against both pubkeys
  before commit.
- `tools/spec-spine/spec-compiler/src/lib.rs` — V-004 (no standalone authored
  YAML) exemption arm extended to include `.sops.yaml` at repo root.
  Spec 000's invariant targets parallel spec registries as authored
  truth; `.sops.yaml` is the SOPS CLI's own tool-format config file,
  consumed by an external binary — same class as `pnpm-workspace.yaml`
  and `pnpm-lock.yaml` already exempt. Rationale recorded inline on
  `v004_yaml_scan_exempt` and back-referenced to plan.md §"Constitution
  check". Covered by a new test (`root_sops_yaml_does_not_trigger_v004`)
  in `tools/spec-spine/spec-compiler/tests/v004_consolidation_excludes.rs`.
- `platform/infra/hetzner/cluster.yaml` — `k3s_version` bumped from
  `v1.31.4+k3s1` to `v1.33.11+k3s1` per dr-baseline.md §F4. Pairs
  atomically with the `flux bootstrap` invocation in setup.sh.
- `platform/infra/hetzner/setup.sh` — bootstrap-section rewrite (T-007).
  Pre-flight extended to require `flux`, `sops`, `age`, the operator-
  host SOPS-age key file, and `GITHUB_TOKEN`. Node-Ready wait narrowed
  from `nodes --all --timeout=300s` to `node -l
  '!node-role.kubernetes.io/master' --timeout=10m` per dr-baseline.md
  §F5 (k3s master's `CriticalAddonsOnly` taint blocks Flux controller
  scheduling — gating on a worker node Ready is the load-bearing wait).
  `flux bootstrap github --owner=statecrafting
  --repo=open-agentic-platform --branch=main
  --path=platform/gitops/clusters/hetzner-prod --personal=false
  --network-policy=true` invoked between cluster creation and
  post-create.sh; `sops-age` Secret applied immediately after with the
  operator-host private key via `--from-file=age.agekey=`. The
  post-create.sh call is intentionally preserved as the legacy
  phase-out path — Phase 3 strips ingress-nginx + cert-manager out of
  it as their HelmReleases land; setup.sh shrinkage continues
  monotonically per FR-003.
- `platform/gitops/clusters/hetzner-prod/README.md` — version-pin
  table flattened to a single "Current pin" column reflecting the new
  state; Phase-mapping table extended to distinguish "Phase 1 prep"
  (PR #160) from "Phase 1 closure" (this PR).
- `specs/151-declarative-cluster-reconciliation/tasks.md` — Phase 1
  done-when amended from "six controllers Ready" to "the four default
  controllers Ready", with explicit pin that T-007 does NOT pass
  `--components-extra`. Image controllers
  (`image-reflector-controller`, `image-automation-controller`) defer
  to spec 152 per plan.md split.

**What did NOT land:**

- T-007 (B) — live `flux bootstrap` execution against the production
  cluster. Scheduled for the operator window that lands Phase 2's
  reflector + wildcard-cert migration (the original "why now" trigger
  per spec 137 Phase 6). Until B executes, the production cluster runs
  with no in-tree GitOps reconciler; this PR is the precondition, not
  the closure.

**Phase 1 done-when status:** code precondition met; operational
done-when (`kubectl get pods -n flux-system` showing four default
controllers Ready + `flux-system/sops-age` Secret present and readable
by `kustomize-controller`) opens on T-007 (B) execution.

## Phase 1 closure operational landing (2026-05-18)

The operational closure executed in a single 48-minute window
(13:00–13:48 UTC, on `main` post-#161). T-007 (B0) and T-007 (B)
landed; Phase 1 done-when verified end-to-end against the production
cluster. This section mirrors the "code landed" pattern above so the
narrative anchors the in-cluster reality the `implements:` block now
points at.

**What landed in-cluster:**

- **K3s in-place upgrade** (T-007 (B0)): `v1.31.4+k3s1` →
  `v1.33.11+k3s1` via `hetzner-k3s upgrade --new-k3s-version
  v1.33.11+k3s1` + Rancher system-upgrade-controller Plans. Both
  nodes rolled in ~11 min. Required step (not optional cluster.yaml
  drift): per dr-baseline.md §F4 amendment, `flux check --pre` is a
  hard gate inside `flux bootstrap` and aborts on K8s <1.33 against
  Flux 2.8.7. Operator-side workaround applied during this window:
  `hetzner-k3s` reads `cluster.yaml`'s `k3s_version` as the
  cluster's "current" version (not the live cluster) — because the
  code PR (#161) already bumped `cluster.yaml` to `v1.33.11+k3s1`,
  the operator temporarily reverted that field on the workstation
  for the duration of the `hetzner-k3s upgrade` invocation, then
  restored. See agent memory `hetzner-k3s-upgrade-comparator` for
  the durable note; recorded in tasks.md under T-007 (B0).
- **Flux v2.8.7 bootstrap** (T-007 (B)): `flux bootstrap github
  --owner=statecrafting --repo=open-agentic-platform --branch=main
  --path=platform/gitops/clusters/hetzner-prod --personal=false
  --network-policy=true`. First attempt failed 422 at deploy-key
  creation — `statecrafting` org default-disables deploy keys
  (dr-baseline.md §F6). Org admin enabled the toggle (Settings →
  Repository policies → Deploy keys); re-run succeeded idempotently
  on the already-pushed components. The bootstrap pushed two
  commits to remote `main`: `52b28cbe` (gotk-components.yaml) and
  `a3d0096b` (gotk-sync.yaml + kustomization.yaml).
- **`flux-system/sops-age` Secret**: applied with the operator-host
  age private key via `kubectl create secret generic sops-age
  --namespace=flux-system --from-file=age.agekey=
  ~/.config/sops/age/keys.txt`. The in-cluster SOPS decryption
  path is live; spec 153's per-purpose encrypted manifests will
  reconcile cleanly when filed.

**Done-when verification (against the live cluster at 2026-05-18T13:48Z):**

- `kubectl get pods -n flux-system` — four default controllers
  Ready: `source-controller`, `kustomize-controller`,
  `helm-controller`, `notification-controller`. Image controllers
  intentionally absent per plan.md split (spec 152 surface).
- `kubectl -n flux-system get secret sops-age -o jsonpath='{.type}'`
  → `Opaque`; `data.age.agekey` present.
- `flux get sources git flux-system` — reconciled at
  `main@sha1:a3d0096b`.

**Findings sharpened during this window:**

- F4 amended in dr-baseline.md — the pre-check is a hard gate
  inside `flux bootstrap`, not a soft warning. K3s in-place upgrade
  is a REQUIRED operator step; sequenced as T-007 (B0) in tasks.md.
- F6 added to dr-baseline.md — `statecrafting` org default-disables
  deploy keys; first-time bootstrap fails 422 unless the org-level
  toggle is enabled (path taken 2026-05-18) or `--token-auth` is
  used (in-cluster long-lived PAT trade-off).

**Phase 1 done-when status: SATISFIED.** Phase 2 (T-008–T-013 —
reflector + spec 137 wildcard-cert annotations as first
Flux-reconciled migrations) is unblocked.

## Phase 2 — reflector + wildcard-cert annotations (T-008–T-013)

**Status:** code landed in this PR; the gitops tree now carries the
first Flux-reconciled chart + the first cert-manager Certificate.
Operational landing follows on the next reconciliation cycle (the
flux-system Kustomization reconciles every 10 min per the
gotk-sync.yaml `interval` setting; the next push to `main` triggers
the GitRepository to refetch immediately).

**What landed in this PR:**

- `platform/gitops/clusters/hetzner-prod/infrastructure/reflector.yaml`
  (T-008) — HelmRepository for `emberstack/helm-charts` +
  HelmRelease for `reflector` chart `9.1.6`, namespace
  `kube-system`. Operational parity: same chart, same version, same
  namespace, default values — only the install mechanism shifts
  from `helm upgrade --install` to helm-controller reconciliation.
  No `dependsOn` against cert-manager: reflector watches core/v1
  Secret objects and registers no CRDs of its own.
- `platform/gitops/clusters/hetzner-prod/manifests/tenants-wildcard-certificate.yaml`
  (T-009) — `cert-manager.io/v1` Certificate covering
  `*.tenants.statecraft.ing` + the apex `tenants.statecraft.ing`.
  ECDSA P-256, 90-day duration, 15-day renewal window.
  `spec.secretTemplate.annotations` carries reflector
  `reflection-allowed` + `reflection-auto-enabled` +
  `reflection-auto-namespaces: ".+"`; cert-manager propagates
  those onto the generated `tenants-wildcard-tls` Secret;
  reflector clones the Secret into every namespace. Domain is
  hardcoded (`statecraft.ing`) because the tree under
  `clusters/hetzner-prod/` is cluster-specific by convention;
  multi-cluster parity (if/when needed) refactors to Flux's
  `postBuild.substituteFrom` ConfigMap pattern.
- `platform/gitops/clusters/hetzner-prod/manifests/tenants-wildcard-certificate.yaml`
  CRD-ordering (T-010) — interim resolution per tasks.md T-010 with
  no wrapping `Kustomization`: cert-manager is materialised by
  `post-create.sh` BEFORE Flux's first Certificate reconciliation,
  and Flux retries on transient apply failure, so convergence is
  robust during the Phase-2-to-Phase-3 window without an explicit
  `dependsOn`. When Phase 3 lands cert-manager as a Flux-reconciled
  HelmRelease, that PR adds the wrapping Kustomization with
  `dependsOn: [cert-manager]` for explicit CRD-before-CR ordering
  per spec 151 §R-004.
- `platform/infra/hetzner/setup.sh` (T-011 strike) — the imperative
  `helm upgrade --install reflector` block (L226-247 pre-edit) and
  the imperative `kubectl apply tenants-wildcard-certificate.yaml`
  line (inside the for-loop at L274-277 pre-edit) are retired,
  with phase-out comments referencing the gitops counterparts. The
  DNS-01 ClusterIssuer apply (and the cloudflare-api-token Secret)
  remain imperative — those are Phase 3 cert-manager territory
  and absorb into gitops when cert-manager itself migrates.
- `specs/137-tenant-environment-access-gates/tasks.md` (T-011 +
  T-012) — T075 + T076 annotated with the Phase 2 migration trail;
  spec 137 records the new Flux-reconciled ownership of both the
  reflector chart and the wildcard cert manifest in its own tasks
  list. This is the spec-side cross-check required by FR-008.

**What did NOT land in this PR (Phase 2 follow-ups):**

- T-013 — spec 137 Phase 6 evidence collection (E1–E6) is unblocked
  by this PR but executes independently against the deployed
  tenant. Phase 6 closure is a spec 137 PR, not a 151 PR.
- The imperative manifest file at
  `platform/infra/hetzner/manifests/tenants-wildcard-certificate.yaml`
  is no longer applied by setup.sh but remains in-tree as a
  reference. A follow-up cleanup PR can delete it once specs 106
  and 137 amender-edits are coordinated (the file is claimed by
  both). Not a Phase 2 blocker.

**Phase 2 done-when:** when the next flux-system Kustomization
reconciliation cycle (≤10 min) picks up these new gitops files and
both resources reach Ready:

- `kubectl -n flux-system get helmrelease reflector` → READY=True.
- `kubectl -n kube-system get pods -l app.kubernetes.io/name=reflector`
  → at least one pod Ready.
- `kubectl -n cert-manager get certificate tenants-wildcard` →
  READY=True (or already Ready if it was issued by the previous
  imperative apply; cert-manager treats the Flux-reconciled
  resource as the same object by name).
- `kubectl get secret tenants-wildcard-tls -A` → present in the
  `cert-manager` namespace + cloned into every other namespace
  per reflector's catch-all regex.
- `grep -E 'helm upgrade --install reflector|kubectl apply.*tenants-wildcard-certificate'
  platform/infra/hetzner/setup.sh` → no matches.

Once verified, this section gets an "operational landing
(<date>)" sub-section mirroring the Phase 1 closure pattern.

### Phase 2 operational landing (2026-05-18)

PR #163 merged 2026-05-18; the flux-system Kustomization's next
reconciliation cycle picked up the new gitops files immediately. The
HelmRepository fetched the chart, helm-controller installed the
release, and kustomize-controller applied the Certificate — all
within ~90s of GitRepository refresh.

**In-cluster state (verified against the production cluster
2026-05-18, post-#163 reconcile):**

- `GitRepository flux-system`: reconciled at
  `main@sha1:7f7c68a9abe07a1c23217829fdfca2b909289ac6` (the #163
  merge commit) — Flux's source-of-truth is the merged tree.
- `HelmRepository emberstack` (namespace `flux-system`): READY=True,
  stored artifact pinned to
  `sha256:91cee52a0fafcad3b402cb350f31b9bdd50cf59921d364b9beb75af5b5bfc06f`.
  Re-fetch interval `24h` per the manifest.
- `HelmRelease reflector` (namespace `kube-system`): READY=True,
  installed `reflector.v1` with chart `reflector@9.1.6`. Install
  wall-clock from GitRepository refresh: ~92s (HelmRepository fetch +
  helm-controller install + pod start).
- `Pod reflector-8b778cb-lzp55` (namespace `kube-system`): 1/1
  Running, no restarts.
- `Certificate tenants-wildcard` (namespace `cert-manager`):
  READY=True, validity 2026-05-17T22:55:26Z → 2026-08-15T22:55:25Z,
  AGE 20h. **The Certificate object was NOT re-issued by Flux's
  reconciliation** — cert-manager treats the Flux-reconciled resource
  as the same named object the imperative setup.sh apply created
  ~20h prior. Flux took ownership of the manifest server-side; the
  `tenants-wildcard-tls` Secret persists unchanged, and reflector's
  ~20h-old replicated copies remain valid. This is the desired
  cutover behaviour: zero downtime for downstream tenant Ingresses.
- `Secret tenants-wildcard-tls` (kubernetes.io/tls, 2 data keys):
  present in `cert-manager` (source, AGE 20h) + cloned by reflector
  into 10 additional namespaces (`default`, `deployd-system`,
  `flux-system`, `ingress-nginx`, `kube-node-lease`, `kube-public`,
  `kube-system`, `rauthy-system`, `statecraft-system`,
  `system-upgrade`). Clones AGE ~107s — refreshed by reflector when
  the source's reflector annotations were re-asserted by Flux's
  apply. Catch-all `reflection-auto-namespaces: ".+"` regex
  working as documented.

**Imperative-path absence (FR-008 cleanup-ownership verification):**

```
$ grep -E 'helm upgrade --install reflector|kubectl apply.*tenants-wildcard-certificate' platform/infra/hetzner/setup.sh
(no matches)
```

The DNS-01 ClusterIssuer apply + cloudflare-api-token Secret create
remain imperative — those are Phase 3 cert-manager territory.

**Phase 2 done-when status: SATISFIED.** All four criteria green:
HelmRelease Ready, pod Running, Certificate Ready, Secret replicated.
Spec 137 Phase 6 evidence collection (E1–E6) is unblocked — the
cluster carries the full set of moving parts the evidence path
requires, now under declarative reconciliation. Phase 3 (T-014–T-018
— cert-manager + ingress-nginx) is the next migration.

**Operational notes captured during this window:**

- helm-controller install wall-clock (HelmRepository fetch through
  pod Ready) was ~92s — well inside any meaningful SC-003 bracket
  for a single chart migration. cert-manager's expected install
  cost in Phase 3 is similar (single chart, no CRD-install hooks
  on reflector to compare against, but cert-manager's CRD install
  is documented as ~30s).
- The Certificate cutover from imperative to declarative is a
  zero-downtime no-op when the manifest's `metadata.name +
  metadata.namespace` matches — cert-manager simply absorbs the
  Flux-managed spec without re-issuing. This is the durable
  pattern for Phase 3's cert-manager + ClusterIssuer migration
  too: shape the gitops manifests so the resource identities
  match what setup.sh applied, and the cutover is a no-op.

## Phase 3 — cert-manager + ingress-nginx + ClusterIssuers (T-014–T-018)

**Status:** code landed in this PR; helm-controller adopts the two
in-cluster helm releases (`cert-manager` and `ingress-nginx`) and
cert-manager picks up the gitops ClusterIssuers as the same-named
objects it already manages. Per the Phase 2 cutover pattern: zero
downtime, no certificate re-issuance, no ACME re-registration.

**What landed in this PR:**

- `platform/gitops/clusters/hetzner-prod/infrastructure/cert-manager.yaml`
  (T-014) — HelmRepository for `charts.jetstack.io` + HelmRelease for
  `cert-manager` chart `v1.19.3` in namespace `cert-manager`.
  `values.crds.enabled=true` matches post-create.sh's `--set
  crds.enabled=true` so the chart's inlined CRD resources adopt the
  pre-existing CRDs without churn. helm-controller picks up the
  existing release in place because the release name + namespace
  match.
- `platform/gitops/clusters/hetzner-prod/infrastructure/ingress-nginx.yaml`
  (T-017) — HelmRepository for `kubernetes.github.io/ingress-nginx` +
  HelmRelease for `ingress-nginx` chart `4.15.1` in namespace
  `ingress-nginx`. Five values preserved verbatim from post-create.sh:
  `controller.kind=DaemonSet`, `controller.hostPort.enabled=true`,
  `controller.service.type=ClusterIP`, `controller.config.use-forwarded-headers="true"`,
  `controller.config.compute-full-forwarded-for="true"`. The
  hostPort-DaemonSet shape is Hetzner-specific (apex DNS A-records
  point at node IPs directly; no external LoadBalancer Service).
- `platform/gitops/clusters/hetzner-prod/manifests/cert-manager-clusterissuers.yaml`
  (T-015) — `letsencrypt-prod` (HTTP-01 via nginx) and
  `letsencrypt-prod-dns01-cloudflare` (DNS-01 via Cloudflare). Same
  metadata.name as the live objects; cert-manager treats them as the
  same ClusterIssuers it already manages. ACME account state
  (`privateKeySecretRef`) is keyed off the ClusterIssuer name +
  Secret reference; both persist across cutover. Co-ownership note
  on the DNS-01 issuer: spec 106 was the original primary owner
  (PR #155); spec 151 migrates the file to gitops but spec 106
  retains primary ownership per spec 130 heuristic.
- `platform/infra/hetzner/post-create.sh` (T-016 + T-018) — strikes:
  - `helm upgrade --install ingress-nginx` block removed (~14
    lines).
  - `helm upgrade --install cert-manager` block + the `kubectl
    wait --for=condition=Available deployment/cert-manager-webhook`
    line removed (~14 lines).
  - HTTP-01 `letsencrypt-prod` ClusterIssuer heredoc removed (~28
    lines).

  Phase 3 originally **preserved** the dormant
  `cert-manager-webhook-hetzner` install + the dormant
  `letsencrypt-dns01` ClusterIssuer heredoc, framing them as
  "fallback for a future DNS migration." That framing was wrong:
  Hetzner DNS holds no zone for `statecraft.ing`, authoritative
  nameservers are at Cloudflare (`leo.ns.cloudflare.com` /
  `rosalie.ns.cloudflare.com`), and the DNS-01 validation chain
  would fail twice over (no zone for the webhook to write into;
  Let's Encrypt queries Cloudflare anyway). A Phase 3 follow-up
  cleanup PR removes both blocks. See the follow-up section below.
- `platform/infra/hetzner/setup.sh` (T-016 follow-on) — the DNS-01
  cloudflare ClusterIssuer apply block from Phase 2's leftovers is
  retired. The `cloudflare-api-token` Secret create stays imperative
  (it carries `$CLOUDFLARE_DNS_API_TOKEN` from .env into the
  cluster; SOPS migration is spec 153 territory).

**What did NOT land in this PR (Phase 3 follow-ups):**

- The Phase 2 deferred T-010 work (wrapping Flux Kustomization with
  `dependsOn: [cert-manager]` for the wildcard Certificate and the
  ClusterIssuers) — still deferred. The Phase 2 retry-on-failure
  pattern (cert-manager retries when CRDs / Secrets / solvers
  arrive) handles convergence for both cutover and fresh-cluster
  scenarios. Phase 5's drift-detection + DR runbook (T-022/T-023)
  measures the retry-cycle cost against the SC-003 30-min budget;
  if it overruns, the wrapping-Kustomization machinery is added
  then with a measured rationale.
- The imperative-manifest cleanup
  (`platform/infra/hetzner/manifests/tenants-wildcard-certificate.yaml`
  from Phase 2 + `platform/infra/hetzner/manifests/letsencrypt-prod-dns01-cloudflare-issuer.yaml`
  from Phase 3) — both files are no longer applied by setup.sh but
  remain in-tree as interim references. A follow-up cleanup PR
  deletes them once specs 106 + 137 amender-edits are coordinated.
- The `cloudflare-api-token` Secret migration to SOPS — spec 153
  territory.
- Phase 4 (rauthy chart to Flux) — identity-critical, maintenance
  window.

**Phase 3 done-when:** when the next flux-system Kustomization
reconciliation cycle picks up these new gitops files and the cluster
state stabilises:

- `kubectl -n cert-manager get helmrelease cert-manager` → READY=True.
- `kubectl -n ingress-nginx get helmrelease ingress-nginx` → READY=True.
- `kubectl get clusterissuer letsencrypt-prod letsencrypt-prod-dns01-cloudflare`
  → both READY=True (existing ACME account state preserved).
- `kubectl -n cert-manager get certificate tenants-wildcard` → still
  READY=True, AGE unchanged (no re-issuance — Phase 2's cutover
  pattern repeated).
- Existing platform ingress Certificates (statecraft, deployd,
  rauthy, minio) remain Ready under `letsencrypt-prod`; no
  renewals triggered by the cutover.
- `grep -E 'helm upgrade --install (cert-manager|ingress-nginx)\b|kind: ClusterIssuer' platform/infra/hetzner/post-create.sh`
  → no matches (after the follow-up cleanup below removes the
  dormant Hetzner-DNS block).

Once verified, this section gets an "operational landing (<date>)"
sub-section mirroring the Phase 1 / Phase 2 closure pattern.

### Phase 3 follow-up — remove Hetzner DNS dormant path (2026-05-18)

Phase 3's initial framing preserved the `cert-manager-webhook-hetzner`
chart install + the `letsencrypt-dns01` ClusterIssuer heredoc in
`post-create.sh` as a "dormant fallback for future DNS migration."
That framing was speculative scaffolding for a switch from
Cloudflare to Hetzner DNS that has no plan and would lose
Cloudflare's proxy / WAF / Email Routing. More structurally: the
dormant code was not just unused, it was **structurally non-functional
in this deployment**. The DNS-01 validation chain breaks in two
places:

1. The webhook would call Hetzner DNS Console API
   (`https://dns.hetzner.com/api/v1`) to write the
   `_acme-challenge.<host>` TXT record — but Hetzner DNS holds
   **no zone** for `statecraft.ing` (verified empirically:
   Hetzner Console → DNS shows "You don't have any DNS zones
   yet"). The API call would return zone-not-found.
2. Even if the zone existed and the TXT record were written, Let's
   Encrypt's validator queries the **authoritative** nameservers
   for `statecraft.ing` — which are `leo.ns.cloudflare.com` and
   `rosalie.ns.cloudflare.com` per the registry's NS records. The
   TXT record written into a non-authoritative provider is
   invisible to the validator; the challenge times out.

The dormant code was speculative copy-paste from a Hetzner-only
tutorial that pre-dated the project's commitment to Cloudflare-as-
authoritative-DNS. Resurrection path is real but expensive: revert
the Phase-3-follow-up strikes AND migrate `statecraft.ing`'s
registrar NS records from Cloudflare to Hetzner. The migration is
out of scope for any current plan; capturing it here as the
explicit "resurrection cost" rather than implicit "fallback
available" framing.

**Cleanup this PR lands:**

- Strikes the `cert-manager-webhook-hetzner` `helm upgrade --install`
  block + its `SKIP_HETZNER_DNS_WEBHOOK` gate from
  `post-create.sh`.
- Strikes the `letsencrypt-dns01` ClusterIssuer heredoc + its
  `HCLOUD_DNS_API_TOKEN` gate from `post-create.sh`.
- Updates the MinIO block's stale comment in `post-create.sh` (line
  numbers + dormant-block references no longer valid).
- Updates `cert-manager-clusterissuers.yaml`'s "dormant alternates"
  header to record the removal rationale instead of the false
  "preserved for future" framing.
- Spec 151 Phase 3 narrative (above) amended to match.

**Operator step required at merge time:** uninstall the
running-but-useless webhook chart from the live cluster:

```
helm uninstall cert-manager-webhook-hetzner -n cert-manager
```

The chart currently runs a pod (`cert-manager-webhook-hetzner-*`)
that consumes resources for no functional benefit — uninstalling
reclaims that pod. No downstream consumer references it (the
`letsencrypt-dns01` ClusterIssuer it served has never existed in
the cluster because `HCLOUD_DNS_API_TOKEN` was always unset).

**Why this isn't a spec 143 amendment:** spec 143 §4.7 L-005 (the
"don't infer authoritative DNS from cluster-provider identity"
lesson) is a structural observation that stands as historical
record. The dormant-code removal doesn't invalidate L-005; it
acts on the lesson L-005 already captured. Spec 151 records the
removal because the imperative-cleanup ownership lives here (per
FR-008); spec 143's narrative remains accurate as-of-its-writing.

### Phase 3 operational landing (2026-05-18)

PR #165 merged 2026-05-18; PR #166 (Hetzner DNS dormant-path cleanup)
merged shortly after; the operator ran `helm uninstall
cert-manager-webhook-hetzner -n cert-manager`. Phase 3's cutover
applied the Phase 2 zero-downtime pattern at scale: two helm releases
adopted in place + two ClusterIssuers adopted in place + the
downstream Phase 2 wildcard Certificate untouched + every existing
platform Certificate untouched.

**In-cluster state (verified against the production cluster
2026-05-18, post-#166 + post-`helm uninstall`):**

- `GitRepository flux-system`: reconciled at
  `main@sha1:0442b5804731c25ecb8729b06b6d0311d4a63443` (the #166
  merge commit).
- `HelmRelease cert-manager` (namespace `cert-manager`): READY=True,
  status `"Helm upgrade succeeded for release
  cert-manager/cert-manager.v2 with chart cert-manager@v1.19.3"`.
  The `.v2` suffix is helm-controller's record of taking over from
  the imperative `helm CLI` install (which was `.v1`); the upgrade
  was a no-op on the underlying resources (values matched).
- `HelmRelease ingress-nginx` (namespace `ingress-nginx`):
  READY=True, status `"Helm upgrade succeeded for release
  ingress-nginx/ingress-nginx.v2 with chart ingress-nginx@4.15.1"`.
  Same `.v2` adoption pattern.
- `ClusterIssuer letsencrypt-prod`: READY=True, status `"The ACME
  account was registered with the ACME server"`, AGE **40d** —
  unchanged. cert-manager treated the Flux-applied object as the
  same one it has managed since the original imperative apply; no
  ACME re-registration.
- `ClusterIssuer letsencrypt-prod-dns01-cloudflare`: READY=True,
  AGE **22h** — also unchanged (it was created by Phase 2's
  setup.sh apply 22h prior; Phase 3 just re-asserted ownership).
- **Pod ages confirm zero-downtime cutover:**
  - `cert-manager-5b4798f47c-bbhc5`: AGE 40d, 0 restarts
  - `cert-manager-cainjector-5fc564b897-tghsg`: 40d, 0 restarts
  - `cert-manager-webhook-6fb68cfb5b-rbvnc`: 40d, 0 restarts
    (note: cert-manager's own admission webhook, NOT the now-
    removed cert-manager-webhook-hetzner)
  - `ingress-nginx-controller-xkvz6`: 40d, 0 restarts
- **Certificate state preserved across the cutover** (none re-
  issued; AGE = original creation time):

  | Certificate | Namespace | AGE | Status |
  |---|---|---|---|
  | `statecraft-tls` | statecraft-system | 39d | Ready |
  | `rauthy-tls` | rauthy-system | 40d | Ready |
  | `deployd-api-tls` | deployd-system | 29d | Ready |
  | `minio-tls` | statecraft-system | 10d | Ready |
  | `tenants-wildcard` | cert-manager | 22h | Ready |
- **Hetzner DNS webhook removed:** `kubectl -n cert-manager get
  pods` no longer lists `cert-manager-webhook-hetzner-*`. No
  downstream consumer impacted (the webhook served the
  never-existed `letsencrypt-dns01` ClusterIssuer; no certificate
  was on its issuance path).

**Imperative-path absence (final state):**

```
$ grep -nE 'helm upgrade --install (cert-manager|ingress-nginx)\b|kind: ClusterIssuer|webhook-hetzner|HCLOUD_DNS' \
    platform/infra/hetzner/post-create.sh platform/infra/hetzner/setup.sh
platform/infra/hetzner/post-create.sh:42:# The `cert-manager-webhook-hetzner` chart + the dormant `letsencrypt-
```

The single remaining hit is the explanatory removal-rationale
comment authored in PR #166 — no live code references the Hetzner
DNS path or invokes any of the three cert-manager / ingress-nginx
imperative install paths.

**Phase 3 done-when status: SATISFIED.** All success criteria green;
the cutover pattern from Phase 2 scaled cleanly to four resources at
once (cert-manager + ingress-nginx HelmReleases + two ClusterIssuers).
Phase 4 (rauthy chart to Flux) is the next migration — identity-
critical, maintenance window.

**Pattern observation (durable for Phase 4):** the `.v<existing+1>`
helm release revision is the helm-controller signature of "adopted an
existing release written by the helm CLI." It is the expected outcome
of a correctly-identity-preserving cutover. The Phase 2 + Phase 3
adopted releases all happened to land at `.v2` because their imperative
ancestors had been installed once and never upgraded — the `+1` was
`(1 → 2)`. Phase 4's rauthy adoption (below) lands at `.v81` because
rauthy's imperative ancestor had been upgraded 80 times across the
40d StatefulSet lifetime; helm-controller's bookkeeping increment is
the same `+1`, just from a higher starting point. The durable formula
is `existing_revision + 1`, not `phase_number + 1`. The chart contents
didn't change; helm just recorded the upgrade transaction.

### Phase 4 — rauthy chart to Flux (T-019/T-020/T-021)

Identity-critical: rauthy is the OIDC identity provider for statecraft,
deployd-api, and every tenant magic-link / federated-login flow. The
cutover lands in a maintenance window per T-020. The Phase 2 + Phase 3
zero-downtime adoption pattern (helm-controller assumes ownership of an
existing release in-place, generates a `.v2` revision, leaves the
rendered manifests identical) applies here unchanged — but the blast
radius of a misstep is higher than for reflector / cert-manager /
ingress-nginx, so the cutover is scheduled rather than opportunistic.

**Chart sourcing — first in-tree chart under Flux.** Phases 2 + 3 all
referenced remote `HelmRepository` sources (emberstack, jetstack,
kubernetes/ingress-nginx). Rauthy's chart lives in-tree at
`platform/charts/rauthy/`, so the HelmRelease references the
cluster's bootstrap `GitRepository flux-system` directly:

```yaml
chart:
  spec:
    chart: ./platform/charts/rauthy
    sourceRef:
      kind: GitRepository
      name: flux-system
      namespace: flux-system
    reconcileStrategy: Revision   # any git commit touching the chart triggers reconcile
```

This is the canonical pattern for in-tree charts under Flux. The
`reconcileStrategy: Revision` ensures chart template edits land
without requiring a `Chart.yaml` version bump (the in-tree chart pins
`version: 0.1.0` and historically rarely bumps; `appVersion` plus
values are the live signal). Future in-tree charts (the spec 152
app-chart migration ahead) reuse this pattern.

**Values inlining (vs values-hetzner.yaml file).** The pre-Phase-4
deployment composed values from THREE sources: the chart's `values.yaml`
(defaults), `platform/charts/rauthy/values-hetzner.yaml` (Hetzner-prod
overrides — replicas=1, proxyMode=true, Cloudflare trustedProxies,
persistence.size=2Gi), and three `--set` overrides from `setup.sh`
(`ingress.host`, `oidc.issuer`, `bootstrap.adminEmail` — all DOMAIN-pinned),
plus a conditional `--set smtp.enabled=true` when SMTP_USERNAME was in
.env. The HelmRelease inlines the Hetzner-prod overrides and the
DOMAIN-pinned overrides directly under `spec.values` (the chart's own
`values.yaml` is helm's default, so it is loaded automatically by
helm-controller and doesn't need to be re-listed). The Hetzner-prod
domain (`statecraft.ing`) is hardcoded for the same reason
`tenants-wildcard-certificate.yaml` hardcodes it: the manifest lives
under `clusters/hetzner-prod/`, the gitops-tree convention is
cluster-specific. `values-hetzner.yaml` is deleted in the same PR
since it has no remaining consumers (the parallel `make deploy-hetzner`
rauthy block retires in the same PR).

**SMTP hardcoded `enabled: true`.** Spec 106 §12.1 amendments (PRs #152,
#155, #156) wired SMTP into production. With Phase 4 the chart values
move into static gitops YAML, which cannot be conditional on operator
.env presence. So `smtp.enabled: true` is hardcoded in the HelmRelease,
matching the production reality. `setup.sh` still materialises
`rauthy-smtp-secret` from .env (spec 153 SOPS-migrates it later); the
operator MUST confirm the Secret exists before Flux's first reconcile,
or rauthy crash-loops trying to mount a non-existent Secret. `setup.sh`'s
warning when SMTP_USERNAME is absent now names this crash-loop risk
explicitly rather than the previous "magic-link login unavailable"
soft-warning.

**Dual-writer hazard cleanup.** Two imperative-rauthy paths retired in
this PR:

- `setup.sh` line ~339-348: the `helm upgrade --install rauthy ...`
  block. The `RAUTHY_SMTP_HELM_ARGS` plumbing retires alongside.
- `platform/Makefile` `deploy-hetzner` target: the parallel
  `helm upgrade --install rauthy ...` block (statecraft + deployd-api
  blocks stay imperative until spec 152's migration).

Both paths would dual-writer-fight with Flux's HelmRelease ownership
once the cutover lands. Eliminating them in the same PR is the
Phase 2 / Phase 3 cleanup-ownership pattern (FR-008 clause) applied
to rauthy.

**Cutover sequence (operator-driven, maintenance window):**

1. Confirm `rauthy-secrets` and `rauthy-smtp-secret` exist in
   `rauthy-system` namespace (`kubectl get secret -n rauthy-system`).
   Phase 4 does not touch Secret materialisation.
2. Land the PR. Flux's `flux-system` Kustomization picks up the new
   `infrastructure/rauthy.yaml` within the 1-minute GitRepository poll
   interval.
3. `helm-controller` reads the HelmRelease, finds the existing
   `rauthy` release in `rauthy-system`, and adopts it in-place. Expect
   `helm list -A | grep rauthy` to show `rauthy.v2` (Phase 3 adoption
   pattern).
4. Validate end-to-end: load `https://auth.statecraft.ing/auth/v1/`
   (admin login form), trigger a magic-link from the statecraft
   sign-in flow (exercises the rauthy-smtp-secret mount + SMTP
   submission path), confirm the OIDC token-exchange round-trip from
   statecraft completes.

**Phase 4 done-when:** when the next flux-system Kustomization
reconciliation cycle picks up the new gitops file and the cluster
state stabilises:

- `kubectl -n rauthy-system get helmrelease rauthy` → READY=True.
- `helm list -n rauthy-system | grep rauthy` → revision `v2` (or
  higher if subsequent reconciles fire), chart `rauthy-0.1.0`.
- `kubectl -n rauthy-system get statefulset rauthy` → DESIRED=1,
  CURRENT=1, READY=1, AGE preserved (no pod roll — value diff is
  identical to the pre-Phase-4 imperative-apply state).
- `kubectl -n rauthy-system get certificate rauthy-tls` → still
  READY=True, AGE unchanged.
- OIDC login flow (statecraft → rauthy → callback → statecraft) still
  works end-to-end; magic-link flow still delivers email.
- `grep -nE 'helm upgrade --install rauthy\b' platform/infra/hetzner/setup.sh platform/Makefile`
  → no matches (only comment hits explaining the retirement).

Once verified, this section gets an "operational landing (<date>)"
sub-section mirroring the Phase 2 / Phase 3 closure pattern. Phase 5
(drift detection + DR runbook) is the next phase after Phase 4
operational landing.

### Phase 4 operational landing (2026-05-18)

PR #168 merged 2026-05-18. Flux's `flux-system` GitRepository picked
up the merge commit (`3977dc48b11df1e92ff357cd4b5ba5d4f035d280`)
within the 1-minute poll interval; helm-controller adopted the
existing `rauthy` release in-place. The cutover was a no-op on the
underlying StatefulSet — pod AGE 22h preserved through the adoption
(predates the cutover by ~22h, post-dates the Phase 3 cutover
window), Certificate AGE 40d preserved, Ingress AGE 40d preserved.

**In-cluster state (verified against the production cluster
2026-05-18 ~23:15 UTC, 71s after the HelmRelease became Ready):**

- `GitRepository flux-system`: reconciled at
  `main@sha1:3977dc48b11df1e92ff357cd4b5ba5d4f035d280` (the #168
  merge commit).
- `HelmRelease rauthy` (namespace `rauthy-system`): READY=True,
  status `"Helm upgrade succeeded for release rauthy-system/rauthy.v81
  with chart rauthy@0.1.0+3977dc48b11d"`. The `+3977dc48b11d` suffix
  is helm-controller's convention for git-sourced charts (the chart's
  base `version: 0.1.0` from `Chart.yaml` gets the source commit SHA
  appended; the rendered manifests are identical to the
  pre-Phase-4 imperative apply).
- **Helm history reveals the existing-revision context** (`helm
  history rauthy -n rauthy-system --max 3`):

  | Rev | Updated (UTC) | Status | Chart | Description |
  |---|---|---|---|---|
  | 79 | 2026-05-17 16:52 | failed | `rauthy-0.1.0` | `Upgrade "rauthy" failed: resource StatefulSet/rauthy-system/rauthy not ready` |
  | 80 | 2026-05-17 18:25 | failed | `rauthy-0.1.0` | same failure mode |
  | 81 | 2026-05-18 23:14 | **deployed** | `rauthy-0.1.0+3977dc48b11d` | Upgrade complete |

  The two failed imperative re-runs at v79 + v80 (recent setup.sh
  iterations during the spec 106 §12.1 SMTP work in PRs #152 / #155 /
  #156) had left rauthy in a "helm-bookkeeping says failed; pod is
  Running anyway" state. Flux's adoption upgrade (v81) is the first
  successful helm transaction on the release in over a day — Phase 4
  not only preserved state, it *cleaned the bookkeeping* that the
  prior imperative path had failed to commit.
- **StatefulSet preserved** (`kubectl -n rauthy-system get sts`):
  - `rauthy`: READY=1/1, AGE 40d, IMAGE `ghcr.io/sebadob/rauthy:0.35.0`.
- **Pod preserved** (`kubectl -n rauthy-system get pods`):
  - `rauthy-0`: 1/1 Running, RESTARTS=0, AGE 22h (predates the
    cutover by ~22h — adoption did not roll the pod).
- **Certificate preserved** (`kubectl -n rauthy-system get cert`):
  - `rauthy-tls`: READY=True, SECRET `rauthy-tls`, AGE 40d.
- **Ingress preserved** (`kubectl -n rauthy-system get ingress`):
  - `rauthy`: CLASS=nginx, HOST `auth.statecraft.ing`, AGE 40d.
- **Secrets present** (cross-namespace dependencies the HelmRelease
  mounts): `rauthy-secrets` (AGE 40d, 5 keys), `rauthy-smtp-secret`
  (AGE 25h, 8 keys). Both stay imperative until spec 153 SOPS-
  migrates them.

**Live values match the HelmRelease verbatim** (`helm get values
rauthy -n rauthy-system`):

```
bootstrap:
  adminEmail: admin@statecraft.ing
ingress:
  host: auth.statecraft.ing
oidc:
  issuer: https://auth.statecraft.ing/auth/v1/
persistence:
  size: 2Gi
proxyMode: true
replicas: 1
smtp:
  enabled: true
trustedProxies:
  - 10.244.0.0/16
  - 173.245.48.0/20
  - 103.21.244.0/22
  ... (full Cloudflare IPv4 ranges as inlined)
```

**End-to-end validation:**

- `curl -sS -o /dev/null -w "%{http_code}" https://auth.statecraft.ing/auth/v1/health`
  → **200**. The health endpoint responds through the full chain:
  Cloudflare edge → Hetzner node hostPort → ingress-nginx (Phase 3
  Flux-reconciled) → rauthy Service → rauthy-0 pod. Every link in
  this path is now Flux-reconciled except the rauthy-secrets +
  rauthy-smtp-secret materialisation (spec 153 deferral).

**Imperative-path absence (final state):**

```
$ grep -nE 'helm upgrade --install rauthy\b' \
    platform/infra/hetzner/setup.sh platform/Makefile
platform/infra/hetzner/setup.sh:270:# `helm upgrade --install rauthy` block retired here. The `rauthy-secrets`
platform/infra/hetzner/setup.sh:348:# The previous `helm upgrade --install rauthy ...` invocation retired
platform/Makefile:128:# The previous `helm upgrade --install rauthy ...` invocation retired
```

Three hits, all explanatory removal-rationale comments. No live code
invokes `helm upgrade --install rauthy` from any operator-side path.

**Phase 4 done-when status: SATISFIED.** All success criteria green;
the in-tree chart adoption pattern works (HelmRelease referencing
`./platform/charts/rauthy` via `GitRepository flux-system` with
`reconcileStrategy: Revision`). The pattern generalises to the spec
152 app-chart migrations ahead.

**Pattern correction recorded:** the `.v<N+1>` observation in the
preceding Phase 3 section was originally framed as `phase_number +
1`. Rauthy's `.v81` adoption disconfirms that read; the durable
formula is `existing_helm_revision + 1`. Phase 2 + 3 happened to land
on `.v2` because their imperative ancestors had been installed exactly
once; rauthy's ancestor had 80 prior upgrades. The Phase 3 narrative
above carries the corrected formula in the same PR that lands this
section (single-author self-pinned amendment per spec 102 FU-001's
pattern).

**Phase 5 (drift detection + DR runbook + final setup.sh shrink) is
the next surface.** Some of Phase 5's `setup.sh < 100 lines` target
(SC-002) depends on spec 153's SOPS migration retiring the remaining
`kubectl create secret` blocks; the Phase 5 work that doesn't depend
on 153 can proceed independently (T-022 drift detection, T-023 DR
runbook).

### Phase 5 — drift detection documentation (T-022, 2026-05-18)

`execution/drift-detection.md` authored as the T-022 deliverable.
The doc closes the documentation half of SC-005 + FR-006; the
live-evidence half (the SC-005 drift-revert demonstration) is queued
for the next operator-confirmed session.

**What landed:**

- **Mechanism explanation** — the per-controller drift surface and
  correction model. Key finding: kustomize-controller eagerly
  re-applies its manifests every 10m (so drift on
  Kustomization-owned objects — including the HelmRelease CRs
  themselves, raw Certificates, ClusterIssuers — reverts within
  10m). helm-controller, by default, does NOT revert drift on
  chart-rendered resources (Deployment, StatefulSet, etc); it only
  diffs against the rendered helm manifest on its interval. The
  asymmetry is deliberate (helm's release storage decides what's
  "the chart"), not a Flux bug.
- **Cadence inventory** — GitRepository poll 1m, Kustomization
  reconcile 10m, all four HelmRelease intervals 1h. A commit on
  main becomes a Kustomization-resource cluster change within
  `1m + 10m`; a chart-resource change within `1m + 10m + (up to 1h)`.
- **Flux event taxonomy** — `GitOperationSucceeded`,
  `ReconciliationSucceeded`, `Progressing`, `HelmChartCreated`,
  `ChartPackageSucceeded`, `UpgradeSucceeded`, plus the alertable
  `*Failed` variants. `kubectl get events --field-selector
  type=Warning` is the load-bearing operator surface; a
  continuously-healthy Flux installation emits no warnings.
- **Prometheus metric inventory** — three `gotk_*` families
  (`gotk_reconcile_duration_seconds`, `gotk_token_cached_items`,
  `gotk_token_cache_evictions_total`) plus the five
  `controller_runtime_reconcile_*` families from kubebuilder
  (total / errors / time / timeouts / panics). Sample live values
  captured 2026-05-18 ~23:30 UTC. Flux v2.8.7 removed the per-
  condition `gotk_reconcile_condition` + `gotk_suspend_status`
  metrics that v2.7 exposed; the substitute Prometheus queries are
  recorded in the doc.
- **driftDetection state (current)** — none of the four
  HelmReleases set `spec.driftDetection.mode: Enabled`. Manual edits
  to chart-rendered resources are NOT reverted by helm-controller.
  Enabling driftDetection is a deliberate behavior change with
  tradeoffs (chart-vs-webhook resource churn risk); deferred to a
  follow-up spec rather than folded into 151 closure.
- **SC-005 live-test recipe** — pinned: a benign annotation on
  the `reflector` HelmRelease CR (kustomize-controller-managed,
  lowest blast radius); `flux reconcile kustomization flux-system
  --with-source` to force immediate reconcile; expected wall-clock
  revert in <30s. The recipe is operator-runnable from the doc.

**Phase 5 T-022 done-when status: doc deliverable SATISFIED.**
The SC-005 live evidence half also landed in the same Phase 5
sprint (next sub-section).

### Phase 5 — SC-005 live evidence (2026-05-18)

The drift-revert test ran 2026-05-18 23:41:47 UTC against the
production cluster on `main@sha1:4814b86ffee0` (PR #170's merge
commit). Operator pre-approved the test in-session; results captured
into `execution/drift-detection.md` §"SC-005 live evidence
(2026-05-18)".

**Result: SATISFIED in 8 seconds wall-clock.**

The test followed the recipe pinned in T-022's documentation:

- Target: a benign annotation on the `reflector` HelmRelease CR
  (kustomize-controller-managed, lowest blast radius).
- Procedure: `kubectl annotate helmrelease reflector
  drift-test.spec-151=<ts> --overwrite` → verify present → `flux
  reconcile kustomization flux-system --with-source` → verify
  absent.
- Wall-clock: 8 seconds (T0 → T1 epoch-second delta).
- The matching kustomize-controller event was `Progressing —
  HelmRelease/kube-system/reflector configured` — the empirical
  fingerprint of drift correction. `configured` is the verb
  kustomize-controller emits when a per-object change had to be
  applied during a reconcile cycle (vs steady-state reconciles
  which emit only `ReconciliationSucceeded` with no per-object
  events).

**Side observation captured in the doc:** the reconcile also
triggered `rauthy.v83` to upgrade because the GitRepository
revision change (`313bd2e0` → `4814b86f`) re-packages every
HelmRelease whose chart uses `reconcileStrategy: Revision` (rauthy
is the only one currently). The chart contents didn't differ from
v82; helm history accumulates a revision per upstream commit. This
is the designed behavior of `Revision` strategy (vs `ChartVersion`
which would require manual `Chart.yaml` bumps). Recorded as
operational expectation, not a defect.

**Phase 5 T-022 done-when status (final): SATISFIED across both
doc and live evidence.** Phase 5's other open tasks (T-023 DR
runbook, T-024 SC-003 measurement, T-025 dr-baseline F1/F2
resolution, T-026 setup.sh final shrink) are independent of T-022
and proceed on their own gating (operator session + fresh throwaway
cluster for T-023/T-024/T-025; spec 153 for T-026).

## Amendment 2026-06-29 (reset-prep housekeeping)

Operator kubeconfig + .env were relocated out of the repo tree to
`$OAP_HETZNER_DIR` (`~/.config/oap/infra/hetzner`); the `platform/Makefile`
deploy/mirrord targets and `cluster.yaml`'s `kubeconfig_path` are repointed
accordingly (never writing `~/.kube/config`). Mechanical operator-ergonomics
change; no change to the declarative-reconciliation design.
