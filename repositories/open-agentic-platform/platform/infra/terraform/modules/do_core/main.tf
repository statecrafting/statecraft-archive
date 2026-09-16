# DOKS Cluster
resource "digitalocean_kubernetes_cluster" "doks" {
  name    = "${var.project_name}-doks"
  region  = var.region
  version = var.k8s_version

  node_pool {
    name       = "system"
    size       = var.droplet_size
    node_count = 2
  }
}

# DigitalOcean Container Registry
resource "digitalocean_container_registry" "docr" {
  name                   = var.project_name
  subscription_tier_slug = "basic"
  region                 = var.region
}

# Connect DOKS to DOCR for image pulls
resource "digitalocean_container_registry_docker_credentials" "docr_creds" {
  registry_name = digitalocean_container_registry.docr.name
}
