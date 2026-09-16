variable "namespace" {
  type    = string
  default = "rauthy-system"
}

variable "charts_root" {
  type        = string
  description = "Path to the platform/charts directory"
}

variable "rauthy_host" {
  type        = string
  default     = "rauthy.localdev.online"
  description = "Ingress hostname for Rauthy OIDC provider"
}

variable "replicas" {
  type        = number
  default     = 1
  description = "Number of Rauthy replicas (1 for dev, 3 for prod HA via hiqlite Raft)"
}

variable "persistence_size" {
  type    = string
  default = "2Gi"
}

variable "storage_class" {
  type    = string
  default = ""
}

variable "secrets_name" {
  type        = string
  default     = "rauthy-secrets"
  description = "Name of the K8s secret containing raft-secret, api-secret, and admin-password"
}

variable "admin_email" {
  type    = string
  default = "admin@example.com"
}
