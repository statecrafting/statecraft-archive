# Hetzner throwaway DR cluster — Flux v2 GitOps tree (sibling of hetzner-prod)

This tree is the bootstrap entry point for **spec 151 SC-003 Stage 2 disaster-recovery exercises** (`oap-dr-stage2-throwaway` per the runbook at [`specs/151-declarative-cluster-reconciliation/execution/disaster-recovery.md`](../../../../specs/151-declarative-cluster-reconciliation/execution/disaster-recovery.md)).

Its sole reason for existing is to **eliminate the deploy-key collision** documented as spec 151 Finding F7 in PR #173. `flux bootstrap` generates the GitHub deploy-key title from the bootstrap path:

```
flux-system-<branch>-flux-system-<path>
```

Production bootstraps against `platform/gitops/clusters/hetzner-prod` and gets the title `flux-system-main-flux-system-./platform/gitops/clusters/hetzner-prod`. Before this PR, the Stage 2 DR runbook also bootstrapped against the same path → throwaway-cluster bootstrap REPLACED production's deploy key on GitHub, breaking production's source-controller until the operator restored the production public key manually. With this tree present, the DR runbook bootstraps against `platform/gitops/clusters/hetzner-dr-stage2` → deploy-key title `flux-system-main-flux-system-./platform/gitops/clusters/hetzner-dr-stage2`. The two titles are distinct, the keys never collide, and the production cluster is unaffected by any DR exercise.

## What the DR cluster reconciles

The same content production reconciles. There is no duplicated YAML — `kustomization.yaml` here imports the same `infrastructure-kustomization.yaml` and `manifests-kustomization.yaml` files that live under `../hetzner-prod/`. Each of those Flux Kustomization CRs has `path:` pointing into `hetzner-prod/{infrastructure,manifests}/`, so the DR cluster's Flux pulls the identical HelmReleases (cert-manager, ingress-nginx, reflector, rauthy) and Certificate/ClusterIssuer set the production cluster reconciles. That's the whole point — the DR exercise validates that the same declared state converges on a freshly-created cluster.

The bootstrap-managed `flux-system/` subdirectory is created by `flux bootstrap` itself on first run against this path. It is intentionally absent from the initial scaffold (same pattern as `hetzner-prod/`). Until the first DR bootstrap happens, `kubectl kustomize platform/gitops/clusters/hetzner-dr-stage2/` will fail at the `flux-system` resource reference — this is by design and is the same pre-bootstrap state `hetzner-prod/` was in before its first bootstrap.

## Layout

```
platform/gitops/clusters/hetzner-dr-stage2/
├── README.md                          (this file)
├── kustomization.yaml                 (root — references flux-system + the
│                                       two prod Kustomization CRs via
│                                       ../hetzner-prod/ relative paths)
└── flux-system/                       (bootstrap-managed; populated on first
                                        DR `flux bootstrap` invocation against
                                        this path)
```

## How a DR cycle uses this tree

Per the runbook §Step (c). The operator runs:

```bash
flux bootstrap github \
  --owner=statecrafting \
  --repository=open-agentic-platform \
  --branch=main \
  --path=platform/gitops/clusters/hetzner-dr-stage2 \
  --personal=false \
  --network-policy=true
```

On first DR cycle, this creates `flux-system/{gotk-components.yaml, gotk-sync.yaml, kustomization.yaml}` in this directory and pushes the bootstrap commit. The deploy-key title is `flux-system-main-flux-system-./platform/gitops/clusters/hetzner-dr-stage2` — distinct from production's. Subsequent DR cycles re-use the existing `flux-system/` content; `flux bootstrap` rotates the deploy-key keypair (replacing the previous throwaway's public half) but **never touches production's deploy key** (different title). Production's source-controller continues to clone with its in-cluster private key against an unchanged deploy-key entry on GitHub.

After teardown, the `flux-system/` content remains committed to main. The next DR cycle picks up where this one left off. The Hetzner cluster itself is the throwaway — git state is durable.

## Out of scope

- Application HelmReleases that production doesn't reconcile (spec 152 territory if applicable).
- Per-purpose Secret materialisation — `rauthy-secrets` is operator-managed and does not exist on a bare DR cluster; the rauthy HelmRelease therefore stays `Ready: False` on the throwaway. Acceptable per the F8 design (`infrastructure-kustomization.yaml` uses `healthChecks: [HelmRelease/cert-manager]`, not `wait: true`, so rauthy's failure does not block manifests).
- Production-only differences — none. The tree intentionally reconciles the same content; the only divergence is the bootstrap-distinct entry point.
