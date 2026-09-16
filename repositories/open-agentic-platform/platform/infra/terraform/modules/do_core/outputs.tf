output "kube_host" {
  value = digitalocean_kubernetes_cluster.doks.endpoint
}

output "kube_client_certificate" {
  value       = ""
  description = "DOKS uses token-based auth"
}

output "kube_client_key" {
  value       = ""
  description = "DOKS uses token-based auth"
}

output "kube_cluster_ca_certificate" {
  value = digitalocean_kubernetes_cluster.doks.kube_config[0].cluster_ca_certificate
}

output "cluster_name" {
  value = digitalocean_kubernetes_cluster.doks.name
}

output "oidc_issuer_url" {
  value       = ""
  description = "DOKS does not provide a managed OIDC issuer"
}

output "registry_url" {
  value = digitalocean_container_registry.docr.endpoint
}

output "resource_group_or_project" {
  value = var.project_name
}

output "secret_store_name" {
  value       = ""
  description = "DO has no managed secret store — use Vault or K8s secrets"
}

output "kube_token" {
  value       = digitalocean_kubernetes_cluster.doks.kube_config[0].token
  sensitive   = true
  description = "DOKS API token for kubectl authentication"
}

output "statecraft_serviceaccount_name" { value = "statecraft-api-sa" }
output "deployd_serviceaccount_name"    { value = "deployd-api-sa" }
