data "google_client_config" "current" {}

# GKE Cluster
resource "google_container_cluster" "gke" {
  name     = "${var.project_name}-gke"
  location = var.region

  initial_node_count       = 1
  remove_default_node_pool = true

  workload_identity_config {
    workload_pool = "${var.gcp_project_id}.svc.id.goog"
  }

  release_channel {
    channel = "REGULAR"
  }
}

resource "google_container_node_pool" "system" {
  name       = "system"
  cluster    = google_container_cluster.gke.name
  location   = var.region
  node_count = 2

  node_config {
    machine_type = var.machine_type
    oauth_scopes = [
      "https://www.googleapis.com/auth/cloud-platform",
    ]

    workload_metadata_config {
      mode = "GKE_METADATA"
    }
  }
}

# Artifact Registry repository
resource "google_artifact_registry_repository" "repo" {
  location      = var.region
  repository_id = var.project_name
  format        = "DOCKER"
}

# GCP Service Account for statecraft (Workload Identity)
resource "google_service_account" "statecraft" {
  account_id   = "${var.project_name}-statecraft"
  display_name = "Statecraft API service account"
}

resource "google_service_account_iam_binding" "statecraft_wi" {
  service_account_id = google_service_account.statecraft.name
  role               = "roles/iam.workloadIdentityUser"
  members = [
    "serviceAccount:${var.gcp_project_id}.svc.id.goog[statecraft-system/statecraft-api-sa]"
  ]
}

# GCP Service Account for deployd (Workload Identity)
resource "google_service_account" "deployd" {
  account_id   = "${var.project_name}-deployd"
  display_name = "Deployd API service account"
}

resource "google_service_account_iam_binding" "deployd_wi" {
  service_account_id = google_service_account.deployd.name
  role               = "roles/iam.workloadIdentityUser"
  members = [
    "serviceAccount:${var.gcp_project_id}.svc.id.goog[deployd-system/deployd-api-sa]"
  ]
}

# Grant Secret Manager access to service accounts
resource "google_project_iam_member" "statecraft_secrets" {
  project = var.gcp_project_id
  role    = "roles/secretmanager.secretAccessor"
  member  = "serviceAccount:${google_service_account.statecraft.email}"
}

resource "google_project_iam_member" "deployd_secrets" {
  project = var.gcp_project_id
  role    = "roles/secretmanager.secretAccessor"
  member  = "serviceAccount:${google_service_account.deployd.email}"
}

# GCP Service Account for ESO (Workload Identity)
resource "google_service_account" "eso" {
  account_id   = "${var.project_name}-eso"
  display_name = "External Secrets Operator service account"
}

resource "google_service_account_iam_binding" "eso_wi" {
  service_account_id = google_service_account.eso.name
  role               = "roles/iam.workloadIdentityUser"
  members = [
    "serviceAccount:${var.gcp_project_id}.svc.id.goog[external-secrets/external-secrets-sa]"
  ]
}

resource "google_project_iam_member" "eso_secrets" {
  project = var.gcp_project_id
  role    = "roles/secretmanager.secretAccessor"
  member  = "serviceAccount:${google_service_account.eso.email}"
}
