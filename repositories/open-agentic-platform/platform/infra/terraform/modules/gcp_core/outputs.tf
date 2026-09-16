output "kube_host" {
  value = "https://${google_container_cluster.gke.endpoint}"
}

output "kube_client_certificate" {
  value       = ""
  description = "GKE uses token-based auth via gcloud"
}

output "kube_client_key" {
  value       = ""
  description = "GKE uses token-based auth via gcloud"
}

output "kube_cluster_ca_certificate" {
  value = google_container_cluster.gke.master_auth[0].cluster_ca_certificate
}

output "cluster_name" {
  value = google_container_cluster.gke.name
}

output "oidc_issuer_url" {
  value = "https://container.googleapis.com/v1/projects/${var.gcp_project_id}/locations/${var.region}/clusters/${google_container_cluster.gke.name}"
}

output "registry_url" {
  value = "${var.region}-docker.pkg.dev/${var.gcp_project_id}/${google_artifact_registry_repository.repo.repository_id}"
}

output "resource_group_or_project" {
  value = var.gcp_project_id
}

output "secret_store_name" {
  value = "gcp-secret-manager"
}

output "statecraft_identity_id" {
  value = google_service_account.statecraft.email
}

output "deployd_identity_id" {
  value = google_service_account.deployd.email
}

output "statecraft_serviceaccount_name" { value = "statecraft-api-sa" }
output "deployd_serviceaccount_name"    { value = "deployd-api-sa" }
