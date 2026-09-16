variable "keyvault_id" { type = string }
variable "keyvault_name" { type = string }

variable "secrets" {
  type        = map(string)
  description = "Map of secret name to secret value"
  sensitive   = true
}
