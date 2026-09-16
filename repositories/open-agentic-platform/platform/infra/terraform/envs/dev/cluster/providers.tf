provider "azurerm" {
  features {}
}

locals {
  kube_config = try(
    data.azurerm_kubernetes_cluster.cluster.kube_admin_config[0],
    data.azurerm_kubernetes_cluster.cluster.kube_config[0]
  )
}

provider "kubernetes" {
  host                   = local.kube_config.host
  client_certificate     = base64decode(local.kube_config.client_certificate)
  client_key             = base64decode(local.kube_config.client_key)
  cluster_ca_certificate = base64decode(local.kube_config.cluster_ca_certificate)
}

provider "helm" {
  kubernetes {
    host                   = local.kube_config.host
    client_certificate     = base64decode(local.kube_config.client_certificate)
    client_key             = base64decode(local.kube_config.client_key)
    cluster_ca_certificate = base64decode(local.kube_config.cluster_ca_certificate)
  }
}
