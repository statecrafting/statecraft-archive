variable "project_name" { type = string }

variable "region" {
  type    = string
  default = "nyc1"
}

variable "k8s_version" {
  type    = string
  default = "1.31.1-do.4"
}

variable "droplet_size" {
  type    = string
  default = "s-2vcpu-4gb"
}
