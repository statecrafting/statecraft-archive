module "azure_core" {
  source       = "../../../modules/azure_core"
  project_name = var.project_name
  location     = var.location
}

module "workload_identity" {
  source              = "../../../modules/workload_identity"
  resource_group_name = module.azure_core.resource_group_name
  location            = var.location
  aks_name            = module.azure_core.aks_name
  aks_oidc_issuer_url = module.azure_core.aks_oidc_issuer_url
  keyvault_id         = module.azure_core.keyvault_id
}

# Wait for Key Vault RBAC role assignment to propagate before creating secrets
resource "time_sleep" "wait_for_kv_rbac" {
  create_duration = "90s"
  depends_on      = [module.azure_core]
}

module "keyvault_secrets" {
  source        = "../../../modules/keyvault_secrets"
  keyvault_id   = module.azure_core.keyvault_id
  keyvault_name = module.azure_core.keyvault_name

  secrets = {
    OIDC_M2M_CLIENT_ID     = var.oidc_m2m_client_id
    OIDC_M2M_CLIENT_SECRET = var.oidc_m2m_client_secret
    STATECRAFT_DB_URL      = var.statecraft_db_url
    DEPLOYD_DB_URL         = var.deployd_db_url
    # Consumed via the deployd-api chart's secrets.keys (remoteKey
    # hiqlite-secret-raft / hiqlite-secret-api) through the
    # platform_bootstrap module's ESO ExternalSecret. See store.rs.
    HIQLITE_SECRET_RAFT = var.hiqlite_secret_raft
    HIQLITE_SECRET_API  = var.hiqlite_secret_api
    # Spec 143 FR-010 — per-purpose sweeper M2M client credentials.
    # All three purposes are provisioned in Key Vault; only the
    # knowledge pair is wired through ESO into a CronJob this beat
    # (FU-001). Factory and audit pairs land here as the precedent
    # FU-003 inherits — one Rauthy client per sweeper purpose, one
    # Key Vault secret per credential, one K8s Secret per pod.
    STATECRAFT_KNOWLEDGE_SWEEPER_CLIENT_ID     = var.statecraft_knowledge_sweeper_client_id
    STATECRAFT_KNOWLEDGE_SWEEPER_CLIENT_SECRET = var.statecraft_knowledge_sweeper_client_secret
    STATECRAFT_FACTORY_SWEEPER_CLIENT_ID       = var.statecraft_factory_sweeper_client_id
    STATECRAFT_FACTORY_SWEEPER_CLIENT_SECRET   = var.statecraft_factory_sweeper_client_secret
    STATECRAFT_AUDIT_SWEEPER_CLIENT_ID         = var.statecraft_audit_sweeper_client_id
    STATECRAFT_AUDIT_SWEEPER_CLIENT_SECRET     = var.statecraft_audit_sweeper_client_secret
  }

  depends_on = [time_sleep.wait_for_kv_rbac]
}
