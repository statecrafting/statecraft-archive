---
id: "072-multi-cloud-k8s-portability"
title: "Multi-Cloud Kubernetes Portability"
feature_branch: "072-multi-cloud-k8s-portability"
status: approved
implementation: complete
kind: platform
domain: platform
created: "2026-04-01"
authors: ["open-agentic-platform"]
language: en
summary: >
  Generalizes the platform's Kubernetes infrastructure from Azure-only to a
  portable two-tier model supporting managed cloud K8s (Azure AKS, AWS EKS,
  GCP GKE, DigitalOcean DOKS), bare K8s (Hetzner K3s via hetzner-k3s), and
  local development (k3d). Introduces a provider-agnostic output contract for
  Terraform modules, replaces Azure CSI secrets + workload identity with
  external-secrets-operator, and parameterizes Helm charts with per-environment
  values overlays.
code_aliases: ["MULTI_CLOUD_K8S"]
sources: ["platform-infra"]
establishes:
  - unit: { kind: directory, path: platform/infra }
---

# Feature Specification: Multi-Cloud Kubernetes Portability

> **Post-implementation change (2026-04-16):** The local-dev k3d/kind bootstrap
> (`platform/infra/local/`, `values-local.yaml`, `make k8s-up`/`k8s-down`,
> `bootstrap-local`/`deploy-local`/`destroy-local` targets) has been removed.
> Local development runs Encore/Tauri directly; there is no supported local
> Kubernetes target. Tier 2 is now Hetzner K3s only. The sections below that
> reference local k3d/kind, `values-local.yaml`, and the local migration phase
> are kept as historical record.

## Purpose

The platform's Kubernetes infrastructure was bootstrapped on Azure AKS with tight coupling to Azure-specific services: AKS for compute, Key Vault + CSI secrets driver for secrets, Azure AD Federated Identity for workload identity, and ACR for container images. While the application code is already cloud-agnostic (secrets are read from mounted files, no Azure SDK calls), the infrastructure layer prevents deployment to any other cloud or to bare-metal/VPS Kubernetes.

This spec generalizes the infrastructure into a portable model that supports seven deployment targets across two tiers, while preserving the existing Azure deployment as a first-class target.

## Deployment Targets

### Tier 1: Managed Cloud Kubernetes

Clusters with managed control planes, cloud-native secret stores, workload identity, and cloud load balancers.

| Target | Provisioner | Secret Store | Identity | Registry |
|--------|------------|--------------|----------|----------|
| **Azure AKS** | Terraform `azurerm` | Key Vault via ESO | Azure Workload Identity | ACR or GHCR |
| **AWS EKS** | Terraform `aws` | AWS Secrets Manager via ESO | IRSA | ECR or GHCR |
| **GCP GKE** | Terraform `google` | GCP Secret Manager via ESO | GKE Workload Identity | GCR/Artifact Registry or GHCR |
| **DigitalOcean DOKS** | Terraform `digitalocean` | DO Vault (external) or K8s Secrets via ESO | No managed identity; static credentials | DOCR or GHCR |

### Tier 2: Bare Kubernetes

Clusters without managed secret stores or workload identity. Secrets are provided via Kubernetes-native mechanisms.

| Target | Provisioner | Secret Store | Identity | Registry |
|--------|------------|--------------|----------|----------|
| **Hetzner K3s** | `hetzner-k3s` CLI | K8s Secrets (sealed-secrets or ESO + Vault) | None (static) | GHCR |
| **Local k3d** | `k3d` CLI | K8s Secrets from `.env` | None | Local registry or GHCR |
| **Local kind** | `kind` CLI | K8s Secrets from `.env` | None | Local registry or GHCR |

## Architecture

### Provider-Agnostic Output Contract

Every cloud Terraform module (`modules/{azure,aws,gcp,do}_core/`) MUST emit the same output interface:

```hcl
# Required outputs — consumed by cluster/ layer and platform_bootstrap
output "kube_host"                  { value = <provider-specific> }
output "kube_client_certificate"    { value = <provider-specific> }
output "kube_client_key"            { value = <provider-specific> }
output "kube_cluster_ca_certificate" { value = <provider-specific> }
output "cluster_name"               { value = <provider-specific> }
output "oidc_issuer_url"            { value = <provider-specific> }  # empty string if N/A
output "registry_url"               { value = <provider-specific> }  # empty string if using GHCR
output "resource_group_or_project"  { value = <provider-specific> }  # cloud project/RG identifier
```

For Tier 2 targets (Hetzner, local), these outputs are provided by a `kubeconfig` input variable pointing to the file produced by `hetzner-k3s` or `k3d`, rather than by a Terraform cloud module.

### Secrets Strategy: External Secrets Operator (ESO)

The current approach uses Azure-specific `SecretProviderClass` CRDs with the Azure CSI secrets driver and Azure AD workload identity. This is replaced with a cloud-agnostic pattern:

**Tier 1 (managed cloud):**
1. `external-secrets-operator` (ESO) is installed as a cluster addon
2. A `ClusterSecretStore` CRD connects ESO to the cloud's secret manager (Key Vault, Secrets Manager, Secret Manager, or Vault)
3. `ExternalSecret` CRDs in each service namespace reference secret keys and produce standard K8s `Secret` objects
4. Deployments mount secrets via standard `envFrom` or `volumeMounts` referencing the K8s Secret — no CSI driver needed

**Tier 2 (bare K8s):**
- **Hetzner:** ESO with a Vault `SecretStore`, or `sealed-secrets` for git-committed encrypted secrets, or plain K8s Secrets created by the bootstrap script
- **Local dev:** Plain K8s Secrets created by `bootstrap.sh` from a `.env` file. No ESO needed — keep the inner loop fast

**Application code change: none.** The services already read from `/mnt/secrets-store` or `SECRETS_DIR`. The K8s Secret can be mounted at the same path, preserving the file-based reader pattern in `secrets.ts`.

### Helm Chart Parameterization

Azure-specific resources are removed from chart templates and replaced with cloud-agnostic alternatives:

#### Removed from templates
- `secretproviderclass.yaml` (Azure CSI SecretProviderClass)
- `azure.workload.identity/use: "true"` pod label
- `azure.workload.identity/client-id` service account annotation

#### Added to templates
- `external-secret.yaml` — `ExternalSecret` CRD that produces a K8s `Secret`
- Conditional service account annotations via `values.yaml`

#### Values overlay structure

```
charts/statecraft/
  values.yaml              # Defaults (cloud-agnostic, no provider-specific values)
  values-azure.yaml        # Azure: ACR image, Azure-specific SA annotations
  values-aws.yaml          # AWS: ECR image, IRSA SA annotation
  values-gcp.yaml          # GCP: GCR image, GKE WI SA annotation
  values-do.yaml           # DO: DOCR image
  values-hetzner.yaml      # Hetzner: GHCR image, no identity annotations
  values-local.yaml        # Local: local registry, secrets from K8s Secret
```

Helm install uses `-f values.yaml -f values-<target>.yaml` to merge base + overlay.

### Cluster Addons Refactoring

The `cluster_addons` module is refactored to be provider-aware:

| Addon | Tier 1 (Cloud) | Tier 2 (Bare) |
|-------|----------------|---------------|
| ingress-nginx | Yes | Yes |
| cert-manager | Yes | Yes (Hetzner); No (local — use self-signed or skip TLS) |
| external-secrets-operator | Yes (cloud SecretStore) | Optional (Vault SecretStore for Hetzner) |
| Azure CSI secrets provider | **Removed** — replaced by ESO | N/A |
| sealed-secrets | No | Optional (Hetzner alternative to Vault) |

The Azure-specific LB annotation on ingress-nginx is moved to a conditional variable:

```hcl
dynamic "set" {
  for_each = var.cloud_provider == "azure" ? [1] : []
  content {
    name  = "controller.service.annotations.service\\.beta\\.kubernetes\\.io/azure-load-balancer-health-probe-request-path"
    value = "/healthz"
  }
}
```

### Terraform Environment Structure

```
platform/infra/terraform/
  modules/
    azure_core/           # Existing — AKS + Key Vault + ACR
    aws_core/             # New — EKS + Secrets Manager + ECR
    gcp_core/             # New — GKE + Secret Manager + GCR/AR
    do_core/              # New — DOKS + DOCR
    cluster_addons/       # Refactored — provider-aware, ESO instead of CSI Azure
    platform_bootstrap/   # Refactored — no hardcoded ACR refs, uses registry_url output
    workload_identity/    # Azure-only, called conditionally
    keyvault_secrets/     # Azure-only, called conditionally
    cloud_secrets/        # New — provider-agnostic secret writing (wraps per-cloud API)
    external_secrets/     # New — installs ESO + configures ClusterSecretStore per cloud
  envs/
    dev/                  # Azure dev (existing, updated to use new modules)
      core/
      cluster/
    aws-dev/              # AWS dev
      core/
      cluster/
    gcp-dev/              # GCP dev
      core/
      cluster/
    do-dev/               # DO dev
      core/
      cluster/
```

### Hetzner K3s Provisioning

Hetzner sits outside Terraform — it uses the `hetzner-k3s` CLI:

```
platform/infra/hetzner/
  cluster.yaml            # hetzner-k3s cluster configuration
  post-create.sh          # Installs addons: ingress-nginx, cert-manager, ESO or sealed-secrets
  values-overrides.yaml   # Helm values for platform services on Hetzner
```

Workflow:
1. `hetzner-k3s create --config platform/infra/hetzner/cluster.yaml`
2. `export KUBECONFIG=<output-kubeconfig-path>`
3. `./platform/infra/hetzner/post-create.sh` — installs cluster addons
4. `make deploy TARGET=hetzner` — deploys platform services via Helm

### Local Development Provisioning

```
platform/infra/local/
  k3d-config.yaml         # k3d cluster with local registry
  kind-config.yaml        # Alternative: kind cluster
  bootstrap.sh            # Creates cluster, installs addons, seeds secrets from .env
  .env.example            # Template for local secrets
```

Workflow:
1. `cp platform/infra/local/.env.example platform/infra/local/.env` (fill in values)
2. `./platform/infra/local/bootstrap.sh` — creates k3d cluster, seeds secrets, installs nginx-ingress
3. `make deploy TARGET=local` — deploys platform services via Helm

### Makefile Multi-Target Support

The Makefile gains a `TARGET` variable (default: `azure`) that selects the deployment target:

```makefile
TARGET ?= azure

deploy:
    @$(MAKE) deploy-$(TARGET)

deploy-azure:    # Existing Terraform flow
deploy-aws:      # AWS Terraform flow
deploy-gcp:      # GCP Terraform flow
deploy-do:       # DO Terraform flow
deploy-hetzner:  # hetzner-k3s + Helm
deploy-local:    # k3d/kind + Helm
```

## Invariants

- **INV-1:** Application source code MUST NOT contain any cloud-provider SDK imports or cloud-specific logic. All cloud abstraction happens at the infrastructure layer.
- **INV-2:** Every Terraform `*_core` module MUST emit the output contract defined in this spec. The `cluster/` layer consumes only these outputs.
- **INV-3:** Helm chart templates MUST NOT contain hardcoded cloud-provider annotations or labels. All provider-specific configuration comes from values overlays.
- **INV-4:** The secrets mount path (`/mnt/secrets-store`) and file-based reader pattern MUST be preserved across all tiers. Application code reads files; infrastructure decides how they get there.
- **INV-5:** The existing Azure deployment MUST continue to work after this refactoring. This is an additive change, not a replacement.

## Migration Path

Phase 1 — Spec + Helm chart refactor (this PR):
- Write spec
- Remove Azure-specific templates from Helm charts
- Add ExternalSecret templates and per-environment values files
- Refactor `cluster_addons` to be provider-aware

Phase 2 — Local dev bootstrap:
- k3d config + bootstrap.sh
- Validate full platform deployment on local k3d

Phase 3 — Hetzner K3s:
- hetzner-k3s cluster.yaml + post-create.sh
- Validate deployment on Hetzner

Phase 4 — Cloud Terraform modules:
- AWS EKS module + env
- GCP GKE module + env
- DO DOKS module + env

Phase 5 — Makefile + CI:
- Multi-target Makefile
- Optional: GitHub Actions matrix for multi-cloud validation

## Dependencies

- `external-secrets-operator` Helm chart (https://charts.external-secrets.io)
- `hetzner-k3s` CLI (`brew install vitobotta/tap/hetzner_k3s`)
- `k3d` CLI (`brew install k3d`)
- Existing specs: none (this is infrastructure-only, no OPC or Spec Spine changes)

## Amendment 2026-06-29 (reset-prep housekeeping)

Operator state (kubeconfig + .env) was relocated out of the repo tree to
`$OAP_HETZNER_DIR` (`~/.config/oap/infra/hetzner`), so `cluster.yaml`
(`kubeconfig_path`) and the `mirrord/` configs (`statecraft-compile.sh`,
`statecraft.yaml`) are repointed accordingly. The two Encore infra configs were
also unified into a single `infra.config.json` (mirrord now compiles against
it). Mechanical only; no change to the multi-cloud portability design.


## Security hardening amendment (2026-07-02)

Applied default-deny NetworkPolicies to the application namespaces declaratively, removing the MVP skip in the Hetzner post-create bootstrap, and provisioned the deployd-api hiqlite secrets through the platform_bootstrap and dev-core Terraform so Key Vault holds them for external-secrets to sync.

Recorded during the cross-subsystem security-hardening sweep; couples the security fixes in the code paths this spec authors to their owning spec per the spec 127 coupling gate.
