output "resource_group_name" { value = module.azure_core.resource_group_name }
output "aks_name" { value = module.azure_core.aks_name }
output "acr_login_server" { value = module.azure_core.acr_login_server }
output "keyvault_name" { value = module.azure_core.keyvault_name }
output "tenant_id" { value = module.azure_core.tenant_id }
output "aks_oidc_issuer_url" { value = module.azure_core.aks_oidc_issuer_url }

output "statecraft_serviceaccount_name" { value = module.workload_identity.statecraft_serviceaccount_name }
output "deployd_serviceaccount_name" { value = module.workload_identity.deployd_serviceaccount_name }
output "statecraft_identity_client_id" { value = module.workload_identity.statecraft_identity_client_id }
output "deployd_identity_client_id" { value = module.workload_identity.deployd_identity_client_id }
