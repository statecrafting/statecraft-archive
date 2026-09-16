data "azurerm_client_config" "current" {}

# Allow the Terraform caller (az login / SP) to manage secrets in this vault
resource "azurerm_role_assignment" "tf_kv_secrets_officer" {
  scope                = azurerm_key_vault.kv.id
  role_definition_name = "Key Vault Secrets Officer"
  principal_id         = data.azurerm_client_config.current.object_id
}

resource "azurerm_resource_group" "rg" {
  name     = "${var.project_name}-rg"
  location = var.location
}

resource "azurerm_container_registry" "acr" {
  name                = replace("${var.project_name}acr", "-", "")
  resource_group_name = azurerm_resource_group.rg.name
  location            = var.location
  sku                 = "Basic" # or "Standard"
  admin_enabled       = false
}

resource "azurerm_key_vault" "kv" {
  name                       = replace("${var.project_name}-kv", "_", "-")
  location                   = var.location
  resource_group_name        = azurerm_resource_group.rg.name
  tenant_id                  = data.azurerm_client_config.current.tenant_id
  sku_name                   = "standard"
  enable_rbac_authorization  = true
  purge_protection_enabled   = true
  soft_delete_retention_days = 7
}

resource "azurerm_kubernetes_cluster" "aks" {
  name                = "${var.project_name}-aks"
  location            = var.location
  resource_group_name = azurerm_resource_group.rg.name
  dns_prefix          = "${var.project_name}-dns"
  sku_tier            = "Free" # or "Standard"

  oidc_issuer_enabled       = true
  workload_identity_enabled = true

  default_node_pool {
    name       = "system"
    node_count = 2
    vm_size    = "Standard_D2as_v6"
  }

  identity {
    type = "SystemAssigned"
  }

  network_profile {
    network_plugin    = "azure"
    network_policy    = "calico"
    load_balancer_sku = "standard"
  }
}

# Allow AKS to pull from ACR without creds
resource "azurerm_role_assignment" "aks_acr_pull" {
  scope                = azurerm_container_registry.acr.id
  role_definition_name = "AcrPull"
  principal_id         = azurerm_kubernetes_cluster.aks.kubelet_identity[0].object_id
}
