variable "environment" {
  type    = string
  default = "dev"
}

variable "statecraft_host" {
  type    = string
  default = "statecraft.localdev.online "
}

variable "deployd_host" {
  type    = string
  default = "deployd.localdev.online "
}

variable "rauthy_host" {
  type    = string
  default = "rauthy.localdev.online"
}

variable "letsencrypt_email" { type = string }

variable "apply_cluster_issuer" {
  type    = bool
  default = true
}
