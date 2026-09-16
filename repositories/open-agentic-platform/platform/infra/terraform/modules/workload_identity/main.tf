data "azurerm_client_config" "current" {}

# User assigned managed identities
resource "azurerm_user_assigned_identity" "statecraft" {
  name                = "statecraft-api-identity"
  resource_group_name = var.resource_group_name
  location            = var.location
}

resource "azurerm_user_assigned_identity" "deployd" {
  name                = "deployd-api-identity"
  resource_group_name = var.resource_group_name
  location            = var.location
}

# Allow these identities to read secrets from Key Vault (Mode 1, file mount)
resource "azurerm_role_assignment" "statecraft_kv_secrets_user" {
  scope                = var.keyvault_id
  role_definition_name = "Key Vault Secrets User"
  principal_id         = azurerm_user_assigned_identity.statecraft.principal_id
}

resource "azurerm_role_assignment" "deployd_kv_secrets_user" {
  scope                = var.keyvault_id
  role_definition_name = "Key Vault Secrets User"
  principal_id         = azurerm_user_assigned_identity.deployd.principal_id
}

# Kubernetes service accounts we will use (names only, actual SA objects are in Helm charts)
locals {
  statecraft_namespace = "statecraft-system"
  deployd_namespace    = "deployd-system"

  statecraft_sa_name = "statecraft-api-sa"
  deployd_sa_name    = "deployd-api-sa"
}

# Federated Identity Credentials (Workload Identity)
resource "azurerm_federated_identity_credential" "statecraft" {
  name                = "statecraft-api-fic"
  resource_group_name = var.resource_group_name
  parent_id           = azurerm_user_assigned_identity.statecraft.id

  issuer   = var.aks_oidc_issuer_url
  subject  = "system:serviceaccount:${local.statecraft_namespace}:${local.statecraft_sa_name}"
  audience = ["api://AzureADTokenExchange"]
}

resource "azurerm_federated_identity_credential" "deployd" {
  name                = "deployd-api-fic"
  resource_group_name = var.resource_group_name
  parent_id           = azurerm_user_assigned_identity.deployd.id

  issuer   = var.aks_oidc_issuer_url
  subject  = "system:serviceaccount:${local.deployd_namespace}:${local.deployd_sa_name}"
  audience = ["api://AzureADTokenExchange"]
}
