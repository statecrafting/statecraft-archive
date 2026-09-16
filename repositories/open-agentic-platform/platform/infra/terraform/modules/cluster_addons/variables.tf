variable "cloud_provider" {
  type        = string
  default     = "azure"
  description = "Cloud provider: azure, aws, gcp, do, hetzner, local"
}

variable "ingress_nginx_enabled" { type = bool }
variable "cert_manager_enabled" { type = bool }

variable "external_secrets_enabled" {
  type        = bool
  default     = true
  description = "Install external-secrets-operator for cloud-agnostic secret management"
}

variable "repo_root" { type = string }

variable "apply_cluster_issuer" {
  type    = bool
  default = false
}

variable "letsencrypt_email" {
  type        = string
  description = "Email used for ACME registration with Let's Encrypt."
}
