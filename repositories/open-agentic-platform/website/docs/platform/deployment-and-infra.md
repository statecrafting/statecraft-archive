# Deployment and Infrastructure

The Open Agentic Platform is designed to run on Kubernetes. The infrastructure code is located in the `platform/infra/` and `platform/charts/` directories.

## Helm Charts

OAP provides Helm charts for its core services:
- `charts/statecraft/`: The main SaaS service.
- `charts/deployd-api/`: The deployment orchestrator.
- `charts/rauthy/`: The OIDC identity provider.

These charts are designed to be cloud-neutral.

## Terraform Infrastructure

The repository includes Terraform modules for provisioning the underlying infrastructure.

### Azure AKS

The primary development and production target is Azure Kubernetes Service (AKS). The Terraform configuration is split into two layers:
1. **Core** (`envs/dev/core/`): Provisions the Azure Resource Group, AKS cluster, Azure Container Registry (ACR), and Key Vault.
2. **Cluster** (`envs/dev/cluster/`): Deploys in-cluster services like Ingress-nginx, cert-manager, and the CSI secrets provider.

Deployment commands:
```bash
make tf-init      # Init both layers
make tf-apply     # Create Azure resources + deploy
```

### Hetzner K3s / GitOps

OAP also supports deployment to Hetzner Cloud using K3s and Flux GitOps (Spec 151). This provides a cost-effective alternative to managed Kubernetes.

The bootstrap process uses `hetzner-k3s` to provision the cluster and `flux bootstrap` to install the GitOps controllers. Secrets are managed using SOPS and age encryption.

### Multi-Cloud Portability

Spec 072 defines Terraform modules for AWS, GCP, and DigitalOcean (`platform/infra/terraform/modules/`). However, instantiating these environments is currently on the roadmap; only the Azure and Hetzner targets are actively maintained today.
