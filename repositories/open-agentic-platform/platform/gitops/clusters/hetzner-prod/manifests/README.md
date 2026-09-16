# `manifests/` — raw Kubernetes manifests

Non-Helm manifests that Flux reconciles directly: Certificates, ClusterIssuers, namespace bootstraps, and any other API objects that aren't expressed as a HelmRelease.

## Current inventory

| File | Resource | Phase landed | Spec FR |
|---|---|---|---|
| _empty_ | — | — | — |

(Spec 151 Phase 1 ships the scaffold only. Files land per the phase table in [`../README.md`](../README.md).)

## Phase 2 — first arrivals

- `tenants-wildcard-certificate.yaml` (T-009): the `Certificate` resource with reflector annotations on `spec.secretTemplate`, wrapped in a `Kustomization` that depends on cert-manager being available (interim: setup.sh-installed cert-manager; long-term: the Phase 3 HelmRelease). Unblocks spec 137 Phase 6 evidence collection.

## Phase 3 — cert-manager-bound

- `cert-manager-clusterissuers.yaml` (T-015): `ClusterIssuer` resources (Let's Encrypt prod + staging). `Kustomization` `dependsOn` cert-manager `HelmRelease`.

## Conventions

- One resource per file is preferred. Multi-document manifests are acceptable when the resources are logically a unit (e.g. a `ClusterIssuer` + its supporting `Secret` reference).
- Every manifest carries an `app.kubernetes.io/managed-by: flux` label so operators can grep for non-Flux-owned objects with `kubectl get ... -l '!app.kubernetes.io/managed-by'`.
- ClusterRole / ClusterRoleBinding live here, not under `infrastructure/`, because they're raw RBAC not a HelmRelease.

## Drift-detection contract

Spec 151 §FR-006 requires drift detection via Flux events + Prometheus metrics. Resources in this directory are subject to the same drift-revert behaviour as HelmReleases: a manual `kubectl edit` lands transiently and is reverted within one reconciliation interval (default 10 min for Kustomizations). SC-005 evidence (manual edit reverted) is recorded in `execution/drift-detection.md` at Phase 5.
