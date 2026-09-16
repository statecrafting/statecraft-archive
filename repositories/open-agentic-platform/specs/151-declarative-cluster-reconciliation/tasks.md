# Tasks: Declarative cluster reconciliation (151, narrowed)

**Spec**: [`spec.md`](./spec.md) | **Plan**: [`plan.md`](./plan.md) |
**Branch**: `151-declarative-cluster-reconciliation` (Phase 0) →
implementation branches off main post-Phase-0-merge.

**Scope:** Spec 151's narrowed surface per the plan.md split decision:
Flux v2 bootstrap + operational chart migration (reflector,
cert-manager, ingress-nginx, rauthy) + SOPS-age cluster runtime + DR
runbook. Application image rollouts (spec 152) and per-purpose
Secret migration (spec 153) are tracked in their own siblings, not
here.

Task IDs use the `T-NNN` convention. Phases match plan.md
sequencing.

---

## Phase 1 — Bootstrap

- **T-001** — Add `flux` CLI to the operator-host prerequisite list
  in `platform/infra/hetzner/setup.sh` header comments and in
  [`docs/DEVELOPERS.md`](../../docs/DEVELOPERS.md) if it exists; add to the
  homebrew install one-liner used in onboarding.
- **T-002** — Pin Flux v2 version (current spec hint: 2.8.7;
  re-validate at implementation time against the k3s version pinned
  in `cluster.yaml`). dr-baseline F4 records the K8s 1.31 vs Flux
  1.33+ surface; resolution lands here or in T-003.
- **T-003** — Bump `k3s_version` in `platform/infra/hetzner/cluster.yaml`
  to a Flux-supported K8s minor (≥1.33 if pinning current Flux), OR
  pin a Flux version compatible with the current K3s. Decision
  lives in the PR description; not pre-pinned in this task list.
- **T-004** — Author `platform/gitops/clusters/hetzner-prod/`
  directory structure: `flux-system/` (Flux's own GitRepository +
  Kustomization), `infrastructure/` (cert-manager, ingress-nginx,
  reflector, rauthy HelmReleases), `secrets/` (placeholder, empty
  until spec 153 lands), `manifests/` (raw Kubernetes manifests like
  the wildcard Certificate).
- **T-005** — Generate the operator-host laptop age keypair (NOT the
  synthetic Phase 0 key); upload public key to `.sops.yaml` at repo
  root. Apply the private key as the `flux-system/sops-age` Secret
  at first cluster bootstrap.
- **T-006** — Generate the Bitwarden-stored backup age keypair;
  upload to Bitwarden vault `OAP` item
  `sops-age-hetzner-prod-recovery` attachment `keys.txt`; add public
  key as second recipient in `.sops.yaml`.
- **T-007** — Shrink `setup.sh` bootstrap section: invoke `hetzner-k3s
  create` → wait for at least one non-master node Ready (per
  dr-baseline F5) → `flux bootstrap github --owner=... --repo=... --
  path=platform/gitops/clusters/hetzner-prod`. Strip every other
  cluster-mutation step from this section (helm installs, kubectl
  applies — they move into `infrastructure/`). Splits into three
  sequenced sub-tasks:
  - **T-007 (A) — code-side scaffold (mergeable without operator
    action).** `setup.sh` shrink, `cluster.yaml` `k3s_version` bump
    to ≥1.33, `.sops.yaml` multi-recipient config, `flux`/`sops`/
    `age` pre-flight, `GITHUB_TOKEN` pre-flight. **Landed PR #161**
    (2026-05-18, `d2e1b8fc`).
  - **T-007 (B0) — in-place K3s upgrade (operator-driven, runs
    BEFORE bootstrap).** `hetzner-k3s upgrade --new-k3s-version
    <pin>` + Rancher system-upgrade-controller Plans against the
    live cluster. Required by dr-baseline F4 amendment (the Flux
    pre-check is a hard gate inside `flux bootstrap`, not a soft
    warning). **Workaround when the code-side bump (T-007 (A))
    landed on `main` before this step runs:** `hetzner-k3s` reads
    `cluster.yaml`'s `k3s_version` as the cluster's "current"
    version (not the live cluster), so a `main` already bumped to
    the target version makes the upgrade comparator think the
    cluster is already on-target. Mitigation: on the operator
    workstation only, temporarily revert `cluster.yaml`'s
    `k3s_version` to the live cluster's version for the duration
    of `hetzner-k3s upgrade --new-k3s-version <target>`; restore
    `main`-state immediately after. Do NOT commit the revert. See
    agent memory `hetzner-k3s-upgrade-comparator` for the durable
    note.
  - **T-007 (B) — operator runs `flux bootstrap`.** `flux bootstrap
    github --owner=... --repo=... --branch=main --path=platform/
    gitops/clusters/hetzner-prod --personal=false
    --network-policy=true` against the upgraded cluster. Apply
    `flux-system/sops-age` Secret immediately after with the
    operator-host age private key (`kubectl create secret generic
    sops-age -n flux-system --from-file=age.agekey=
    ~/.config/sops/age/keys.txt`). First-time invocation may fail
    422 at deploy-key creation if the org default-disables deploy
    keys — see dr-baseline F6.

**Phase 1 done-when:** `kubectl get pods -n flux-system` shows the
four default controllers Ready (`source-controller`,
`kustomize-controller`, `helm-controller`, `notification-controller`).
Image controllers (`image-reflector-controller`,
`image-automation-controller`) defer to spec 152 per plan.md split;
T-007 does NOT pass `--components-extra`. SOPS-age Secret present
and readable by `kustomize-controller`.

---

## Phase 2 — Reflector + spec-137 wildcard-cert annotations (unblocks spec 137 Phase 6)

- **T-008** — Author `platform/gitops/clusters/hetzner-prod/infrastructure/reflector.yaml`:
  HelmRepository + HelmRelease for emberstack/reflector. Values
  identical to what setup.sh installs today (preserve operational
  parity).
- **T-009** — Author `platform/gitops/clusters/hetzner-prod/manifests/tenants-wildcard-certificate.yaml`:
  the Certificate resource with reflector annotations (`reflector.v1.k8s.emberstack.com/reflection-allowed: "true"` etc), wrapped in a
  `Kustomization` that depends on cert-manager being available.
- **T-010** — Wire the Kustomization `dependsOn`: cert-manager
  HelmRelease must be Ready before the wildcard Certificate
  Kustomization reconciles (CRD-before-CR ordering per R-004).
  Since cert-manager is itself a Phase 3 migration, T-010 holds
  until Phase 3 lands OR the Certificate references the pre-Phase-3
  cert-manager that setup.sh already installed (interim state, OK
  for the 2026-05-17 → cert-manager-migration window).
- **T-011** — Strike the imperative `helm upgrade --install reflector`
  and `kubectl apply -f tenants-wildcard-certificate.yaml` lines from
  `specs/137-tenant-environment-access-gates/execution/verification.md`
  per spec 151 FR-008's cleanup-ownership clause. Add a
  verification step in the PR description asserting both imperative-
  apply lines are absent.
- **T-012** — Spec 151 spec.md `implements:` block adds
  `platform/gitops/clusters/hetzner-prod/infrastructure/reflector.yaml`,
  `platform/gitops/clusters/hetzner-prod/manifests/tenants-wildcard-certificate.yaml`,
  and `specs/137-tenant-environment-access-gates/execution/verification.md`
  (per FR-008's coupling-gate cross-check requirement).
- **T-013** — Verify spec 137 Phase 6 evidence (E1–E6 per spec 137)
  collected against the Flux-reconciled state; spec 137 frontmatter
  flips per its own closure rules.

**Phase 2 done-when:** Flux is reconciling the reflector HelmRelease
+ wildcard Certificate annotations in production; spec 137 Phase 6
evidence collected; setup.sh + post-create.sh no longer touch
either resource.

---

## Phase 3 — cert-manager + ingress-nginx

- **T-014** — Author `platform/gitops/clusters/hetzner-prod/infrastructure/cert-manager.yaml`:
  HelmRepository + HelmRelease for jetstack/cert-manager. Includes
  the CRD-install hook configuration. Migrates the existing
  cert-manager from setup.sh.
- **T-015** — Author `platform/gitops/clusters/hetzner-prod/manifests/cert-manager-clusterissuers.yaml`:
  ClusterIssuer resources (Let's Encrypt prod + staging). Kustomize
  `dependsOn` cert-manager HelmRelease.
- **T-016** — Strike cert-manager helm install + ClusterIssuer
  kubectl apply from `setup.sh`. Verify by grep.
- **T-017** — Author `platform/gitops/clusters/hetzner-prod/infrastructure/ingress-nginx.yaml`:
  HelmRepository + HelmRelease. Values preserve LoadBalancer service
  shape currently in use.
- **T-018** — Strike ingress-nginx helm install from `setup.sh`.
  Verify by grep.

**Phase 3 done-when:** cert-manager + ClusterIssuers + ingress-nginx
all Flux-reconciled. Certificate provisioning continues to work
end-to-end (existing tenant Certificates re-issued on rotation).

---

## Phase 4 — rauthy

- **T-019** — Author `platform/gitops/clusters/hetzner-prod/infrastructure/rauthy.yaml`:
  HelmRepository + HelmRelease for the in-tree `platform/charts/rauthy/`
  chart. Values preserve current production config (Hiqlite storage,
  HA, SMTP, upstream providers).
- **T-020** — Migration risk-class: rauthy is identity-critical. PR
  lands in a maintenance window; bring-up validates against the
  existing `rauthy-secrets` Secret (NOT migrated yet — that's spec
  153). Until 153 lands, the rauthy HelmRelease references the
  setup.sh-materialised Secret by name.
- **T-021** — Strike rauthy helm install + secret kubectl-create
  from `setup.sh`. The Secret create stays — Phase 4 only migrates
  the chart, not the per-purpose Secret. Comment marks the line as
  "owned by spec 153 (FR-005 SOPS migration)."

**Phase 4 done-when:** rauthy reconciled by Flux against the
in-tree chart; OIDC end-to-end flow continues to work (login
test passes); secret materialisation still imperative pending
153.

---

## Phase 5 — Drift detection + DR runbook (Stage 2 SC-003)

- **T-022** — Verify Flux events + Prometheus metrics emit for every
  reconciliation. Document the cluster-events query +
  `flux_reconciliation_*` Prometheus metric names in
  [`execution/drift-detection.md`](./execution/drift-detection.md)
  (new file). SC-005 evidence (manual `kubectl edit` reverted within
  one reconciliation interval) recorded here.
- **T-023** — Author `execution/disaster-recovery.md`: the full
  four-step DR sequence rerun against a fresh throwaway cluster,
  this time WITH a populated `platform/gitops/` tree to reconcile
  to. Step (d) is now measurable. Cross-check per-step timings
  against the Phase 0 dr-baseline.md anchors.
- **T-024** — Apply the SC-003 baseline-vs-target policy: if Stage 2
  end-state ≤30 min, SC-003 closes verbatim. If >30 min, amend
  SC-003 in the same commit with (a) measured number, (b) dominant
  cost, (c) future-shrink path or explicit absence.
- **T-025** — Resolve dr-baseline findings F1 + F2 explicitly: the
  Bitwarden-unlock human-action sub-step (F1) measured against the
  real `OAP` vault item; cx43 capacity (F2) re-validated against
  fresh DC weather (or instance_type swap pinned + rationale).
- **T-026** — Final shrink of `setup.sh` and `post-create.sh`. Line
  count verified by `wc -l` at SC-002. Target <100 lines for setup.sh.

**Phase 5 done-when:** SC-001, SC-002, SC-003 (Stage 2), SC-005, SC-007
all green. Spec 151 frontmatter flips to `implementation:
complete`. F4 + F5 resolutions recorded. Spec 137 Phase 6 evidence
back-references the Flux-reconciled cluster.

---

## Cross-cutting tasks (any phase)

- **T-027** — Each migration PR re-runs `codebase-indexer compile`
  and commits the regenerated `.derived/codebase-index/index.json`
  alongside the spec/code edits, OR queues a chore PR per the
  `feedback_codebase_index_spec_edits` memory.
- **T-028** — Each migration PR's `implements:` block claims BOTH
  the new gitops file AND the setup.sh edit (the line removal) in
  the same diff, per spec 130 FR-001 any-claimant rule + the spec
  127 coupling gate. Reviewer checks the implements block before
  approving.
- **T-029** — Drift detection during migration: if a migration PR is
  landed and Flux starts fighting setup.sh-materialised state,
  document the conflict in `execution/migration-incidents.md` and
  resolve (typically: setup.sh edit was missed in the migration
  PR; land a follow-up PR removing the now-orphaned line).

---

## Sibling-spec filing tasks (NOT in this tasks.md)

Tasks for spec 152 and spec 153 live in their own `tasks.md` files
once filed. The gate to file:

- **File 152** when 151 reaches Phase 4 done-when (Flux operational
  with rauthy reconciled).
- **File 153** when 152 has been operational for 14 days clean per
  the 152→153 gate in plan.md.

Filing is itself a task (`F-152-001 — file spec 152 draft`, etc.),
but those tasks live in 152's / 153's own tracking, not here.
