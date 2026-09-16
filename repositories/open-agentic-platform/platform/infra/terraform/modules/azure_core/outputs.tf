output "resource_group_name" { value = azurerm_resource_group.rg.name }
output "aks_name" { value = azurerm_kubernetes_cluster.aks.name }

output "aks_oidc_issuer_url" { value = azurerm_kubernetes_cluster.aks.oidc_issuer_url }

output "kube_host" {
  value = try(
    azurerm_kubernetes_cluster.aks.kube_admin_config[0].host,
    azurerm_kubernetes_cluster.aks.kube_config[0].host
  )
}

output "kube_client_certificate" {
  value = try(
    azurerm_kubernetes_cluster.aks.kube_admin_config[0].client_certificate,
    azurerm_kubernetes_cluster.aks.kube_config[0].client_certificate
  )
}

output "kube_client_key" {
  value = try(
    azurerm_kubernetes_cluster.aks.kube_admin_config[0].client_key,
    azurerm_kubernetes_cluster.aks.kube_config[0].client_key
  )
}

output "kube_cluster_ca_certificate" {
  value = try(
    azurerm_kubernetes_cluster.aks.kube_admin_config[0].cluster_ca_certificate,
    azurerm_kubernetes_cluster.aks.kube_config[0].cluster_ca_certificate
  )
}

output "acr_login_server" { value = azurerm_container_registry.acr.login_server }
output "keyvault_id" { value = azurerm_key_vault.kv.id }
output "keyvault_name" { value = azurerm_key_vault.kv.name }
output "tenant_id" { value = data.azurerm_client_config.current.tenant_id }
