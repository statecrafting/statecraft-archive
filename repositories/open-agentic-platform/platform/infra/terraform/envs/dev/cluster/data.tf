data "terraform_remote_state" "core" {
  backend = "local"

  config = {
    path = abspath("${path.module}/../core/terraform.tfstate")
  }
}

data "azurerm_kubernetes_cluster" "cluster" {
  name                = data.terraform_remote_state.core.outputs.aks_name
  resource_group_name = data.terraform_remote_state.core.outputs.resource_group_name
}
