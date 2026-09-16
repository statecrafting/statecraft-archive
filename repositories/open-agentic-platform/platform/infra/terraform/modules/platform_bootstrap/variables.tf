variable "charts_root" { type = string }

variable "cloud_provider" {
  type        = string
  default     = "azure"
  description = "Cloud provider: azure, aws, gcp, do, hetzner, local"
}

variable "registry_url" {
  type        = string
  default     = ""
  description = "Container registry URL (e.g., statecraftdevacr.azurecr.io). Empty = use GHCR."
}

variable "statecraft_namespace" { type = string }
variable "deployd_namespace" { type = string }

variable "statecraft_host" { type = string }
variable "deployd_host" { type = string }

variable "statecraft_sa_name" { type = string }
variable "deployd_sa_name" { type = string }

variable "cloud_identity_id" {
  type        = string
  default     = ""
  description = "Cloud identity ID (Azure client ID, AWS role ARN, GCP SA email)"
}
