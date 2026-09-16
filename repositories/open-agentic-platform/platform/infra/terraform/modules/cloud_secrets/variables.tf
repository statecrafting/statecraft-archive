variable "cloud_provider" {
  type        = string
  description = "Cloud provider: azure, aws, gcp"
}

variable "secret_store_id" {
  type        = string
  default     = ""
  description = "Cloud secret store ID (Azure Key Vault ID)"
}

variable "secrets" {
  type        = map(string)
  description = "Map of secret name to secret value"
  sensitive   = true
}
