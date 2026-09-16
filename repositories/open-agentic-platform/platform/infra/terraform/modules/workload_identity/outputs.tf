output "statecraft_identity_client_id" { value = azurerm_user_assigned_identity.statecraft.client_id }
output "deployd_identity_client_id" { value = azurerm_user_assigned_identity.deployd.client_id }

output "statecraft_serviceaccount_name" { value = "statecraft-api-sa" }
output "deployd_serviceaccount_name" { value = "deployd-api-sa" }
