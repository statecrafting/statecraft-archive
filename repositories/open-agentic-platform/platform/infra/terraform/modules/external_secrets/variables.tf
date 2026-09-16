variable "cloud_provider" {
  type        = string
  description = "Cloud provider: azure, aws, gcp, do"
}

variable "secret_store_name" {
  type        = string
  default     = ""
  description = "Cloud secret store name (Key Vault name, etc.)"
}

variable "cloud_region" {
  type        = string
  default     = ""
  description = "Cloud region for secret store access"
}

variable "cloud_project_id" {
  type        = string
  default     = ""
  description = "Cloud project ID (GCP only)"
}

variable "cluster_name" {
  type        = string
  default     = ""
  description = "Kubernetes cluster name"
}

variable "service_account_name" {
  type        = string
  default     = "external-secrets-sa"
  description = "K8s service account for ESO to authenticate"
}

variable "service_account_namespace" {
  type        = string
  default     = "external-secrets"
  description = "Namespace of the ESO service account"
}
