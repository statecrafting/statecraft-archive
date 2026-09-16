variable "project_name" { type = string }

variable "gcp_project_id" {
  type        = string
  description = "GCP project ID"
}

variable "region" {
  type    = string
  default = "us-central1"
}

variable "machine_type" {
  type    = string
  default = "e2-medium"
}
