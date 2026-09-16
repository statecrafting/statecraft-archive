# Hetzner production cluster — Flux v2 GitOps tree

This tree is the declared state for the OAP Hetzner production cluster (`oap-hetzner` per [`platform/infra/hetzner/cluster.yaml`](../../../infra/hetzner/cluster.yaml)). Flux v2 runs in-cluster, watches this path, and reconciles HelmReleases, Kustomizations, Certificates, and (post-spec-153) SOPS-encrypted Secrets continuously.

> **Spec spine:** authority for what lands here is [spec 151 — declarative cluster reconciliation](../../../../specs/151-declarative-cluster-reconciliation/spec.md). The plan-time split decision is in [`plan.md`](../../../../specs/151-declarative-cluster-reconciliation/plan.md): chart-contract + CD git-write is spec 152; per-purpose Secret migration is spec 153.

## Version pair (operator-facing pin)

| Component | Current pin | Source of truth |
|---|---|---|
| K3s | `v1.33.11+k3s1` | [`platform/infra/hetzner/cluster.yaml`](../../../infra/hetzner/cluster.yaml) `k3s_version` |
| Flux v2 | `v2.8.7` | Operator workstation `flux` CLI (controllers track CLI version at bootstrap) |

The K3s + Flux pair is intentionally tracked here as the operator-facing pin because the two MUST move atomically per [spec 151 `execution/dr-baseline.md` §F4](../../../../specs/151-declarative-cluster-reconciliation/execution/dr-baseline.md): Flux 2.8.7 expects K8s ≥ 1.33, and landing the K3s bump alone would risk an operator-initiated cluster recreation producing a Flux-less v1.33 cluster.

Bumping either side: open a PR that updates the matching edit and re-runs the DR Stage 2 exercise (spec 151 SC-003).

## Layout

```
platform/gitops/clusters/hetzner-prod/
├── README.md                          (this file — version pin + tree map)
├── kustomization.yaml                 (root kustomize bundle — explicit
│                                       resources list; resolves spec 151
│                                       Finding F8 by forcing structural
│                                       ordering instead of auto-recursive
│                                       single-batch apply)
├── infrastructure-kustomization.yaml  (Flux Kustomization CR for the
│                                       infrastructure/ tier; healthCheck
│                                       on cert-manager HelmRelease)
├── manifests-kustomization.yaml       (Flux Kustomization CR for the
│                                       manifests/ tier; dependsOn:
│                                       infrastructure, wait: true)
├── flux-system/                       (bootstrap-managed —
│                                       gotk-components.yaml + gotk-sync.yaml
│                                       + kustomization.yaml from
│                                       `flux bootstrap`)
├── infrastructure/                    (operational HelmReleases — spec 151
│                                       Phases 2–4; reconciled via
│                                       Flux Kustomization "infrastructure")
├── manifests/                         (raw Kubernetes manifests —
│                                       Certificates, ClusterIssuers,
│                                       namespace bootstraps; reconciled via
│                                       Flux Kustomization "manifests")
└── secrets/                           (SOPS-encrypted Secret manifests —
                                        placeholder until spec 153 lands
                                        FR-005 end-to-end)
```

The `flux-system/` directory is intentionally absent from the initial scaffold. `flux bootstrap github --owner=statecrafting --repository=open-agentic-platform --path=platform/gitops/clusters/hetzner-prod` populates it itself on first bootstrap; pre-creating it would conflict with the bootstrap-generated kustomization.

### Reconciliation topology

```
flux-system/flux-system  (root, from gotk-sync.yaml, path: ./platform/gitops/clusters/hetzner-prod)
  applies kustomization.yaml → flux-system/* + 2 sub-Kustomizations
       │
       ├── flux-system/infrastructure  (path: ./infrastructure)
       │     healthChecks: HelmRelease/cert-manager
       │     applies: HelmRepository jetstack, ingress-nginx, stakater, rauthy
       │              HelmRelease  cert-manager, ingress-nginx, reflector, rauthy
       │
       └── flux-system/manifests        (path: ./manifests; dependsOn: infrastructure; wait: true)
             applies: ClusterIssuer letsencrypt-prod (+ letsencrypt-staging)
                      Certificate tenants-wildcard
```

The dependsOn chain enforces "cert-manager HelmRelease Ready ⇒ then Certificate / ClusterIssuer dry-run runs". On a bare cluster this is the difference between converging in ~5 min and never converging at all (the F8 failure mode).

## Single-cluster v1 shape

Per spec 151 §Clarification 6, the v1 layout is **flat single-cluster**, not the canonical Flux `clusters/<env>/` ↔ `infrastructure/<env>/` ↔ `apps/<env>/` overlay shape. Kustomize-compatible naming throughout — extracting overlays later is a refactor, not a redesign. Spec 151 §FR-010 records the constraint.

## Phase mapping

| Phase | Tasks | What lands here |
|---|---|---|
| 1 prep | T-001…T-004 | Directory READMEs + setup.sh forward-link |
| 1 closure | T-005…T-007 | `.sops.yaml` at repo root; `setup.sh` bootstrap rewrite (Flux bootstrap + sops-age Secret); `flux-system/` populated by `flux bootstrap` on first run |
| 2 | T-008…T-013 | `infrastructure/reflector.yaml` + `manifests/tenants-wildcard-certificate.yaml` (unblocks spec 137 Phase 6) |
| 3 | T-014…T-018 | `infrastructure/cert-manager.yaml`, `manifests/cert-manager-clusterissuers.yaml`, `infrastructure/ingress-nginx.yaml` |
| 4 | T-019…T-021 | `infrastructure/rauthy.yaml` |
| 5 | T-022…T-026 | drift-detection + DR-runbook evidence (no manifests; the cluster is already declarative) |

Application HelmReleases (statecraft, deployd-api) land in spec 152 under a sibling `apps/` subtree to be created in 152's first PR. SOPS-encrypted application Secrets land in spec 153.

## Adding a new manifest

1. Drop the YAML into the appropriate subdirectory.
2. Update that subdirectory's README index table.
3. Run `kubectl --dry-run=client -k platform/gitops/clusters/hetzner-prod/<subdir>/` locally if the subdirectory carries a `kustomization.yaml`; otherwise `kubectl --dry-run=client -f <file>` per manifest.
4. PR the change. Flux's CI gate (spec 116 `cargo-deny` / `pnpm audit` / `npm audit` family does **not** cover Kubernetes manifests; a Kustomize-build gate is queued as a future hardening — see spec 151 §future-hardening once filed).
5. After merge, `flux reconcile kustomization <name> --with-source` on the operator workstation to short-circuit the reconcile interval.

## Sibling: `hetzner-dr-stage2/`

The sibling tree at [`../hetzner-dr-stage2/`](../hetzner-dr-stage2/) is the bootstrap entry point for spec 151 SC-003 Stage 2 disaster-recovery exercises. It exists solely to give the throwaway bootstrap a distinct `flux bootstrap --path` argument, so its GitHub deploy-key title cannot collide with this tree's (spec 151 Finding F7 future-prevention). The DR cluster reconciles the SAME content this cluster does — `hetzner-dr-stage2/kustomization.yaml` imports `infrastructure-kustomization.yaml` and `manifests-kustomization.yaml` from this directory via relative path; no YAML is duplicated.

## Out of scope

- `flux-system/` content (owned by `flux bootstrap`).
- Per-purpose application Secret YAMLs (spec 153).
- Application image rollouts (spec 152 — CD writes image-tag commits, never touches the cluster).
