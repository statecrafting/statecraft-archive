# `infrastructure/` — operational HelmReleases

Cluster-wide infrastructure charts. Each file is a Flux `HelmRepository` + `HelmRelease` pair, named after the chart it installs.

## Current inventory

| File | Chart | Phase landed | Spec FR |
|---|---|---|---|
| _empty_ | — | — | — |

(Spec 151 Phase 1 ships the scaffold only. Files land per the phase table in [`../README.md`](../README.md).)

## Migration order (spec 151 §Clarification 8 / §FR-009)

1. **reflector** (Phase 2) — wildcard-cert replication into tenant namespaces. Unblocks spec 137 Phase 6.
2. **cert-manager** (Phase 3) — Certificate / ClusterIssuer controller. CRD-install via the chart's `installCRDs: true`.
3. **ingress-nginx** (Phase 3) — ingress controller, LoadBalancer Service preserved from current setup.sh.
4. **rauthy** (Phase 4) — OIDC identity provider, in-tree chart at `platform/charts/rauthy/`. Identity-critical; lands in a maintenance window per T-020.

Application HelmReleases (statecraft, deployd-api) defer to spec 152 — a sibling `apps/` subtree, not `infrastructure/`.

## Ordering and dependencies

Inter-HelmRelease ordering uses Flux's `dependsOn` field on the wrapping `Kustomization`. The wildcard `Certificate` manifest under `../manifests/` depends on cert-manager being Ready; the `Kustomization` wrapping the wildcard cert sets `dependsOn: [cert-manager-helmrelease]` to express that.

Per spec 151 §R-004 (CRD-before-CR ordering): every chart that installs CRDs must reach Ready before any chart or manifest that creates instances of those CRDs reconciles. The `Kustomization`-level `dependsOn` enforces this.
