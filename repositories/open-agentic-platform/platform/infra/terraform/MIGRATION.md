# Terraform Split Migration

The Terraform configuration is split into two layers:

- **core/** — Azure resources (AKS, Key Vault, workload identity, secrets)
- **cluster/** — Kubernetes resources (addons, platform bootstrap)

## Fresh install

1. Copy `core/terraform.tfvars.example` → `core/terraform.tfvars`
2. Copy `cluster/terraform.tfvars.example` → `cluster/terraform.tfvars`
3. Fill in values (especially `letsencrypt_email`, OIDC M2M credentials)
4. Run `make tf-init` then `make tf-apply`

## Migrating from single-root config

If you have existing state in `envs/dev/terraform.tfstate`:

1. **Back up state**: `cp envs/dev/terraform.tfstate envs/dev/terraform.tfstate.backup`

2. **Apply core first** (creates new state with Azure resources):
   ```bash
   cd envs/dev/core && terraform init
   terraform apply -auto-approve -var-file=../terraform.tfvars
   ```
   This will fail because core vars are a subset. Create `core/terraform.tfvars` with:
   - `project_name`, `location`, `oidc_m2m_client_id`, `oidc_m2m_client_secret`

3. **Migrate core state** from old config:
   ```bash
   cd envs/dev
   terraform state pull > full.tfstate
   # Extract core modules (azure_core, workload_identity, keyvault_secrets)
   # and push to core/ - see Terraform docs for state mv/push
   ```
   Or use `terraform state rm` in old + `terraform import` in core for each resource.

4. **Apply cluster**:
   ```bash
   cd envs/dev/cluster && terraform init
   terraform apply -auto-approve -var-file=../terraform.tfvars
   ```
   Create `cluster/terraform.tfvars` with cluster-specific vars.

5. **Remove old state** once migration is verified.
