locals {
  core = data.terraform_remote_state.core.outputs
}

module "cluster_addons" {
  source = "../../../modules/cluster_addons"

  repo_root = "${path.module}/../../../../.."

  cloud_provider           = "azure"
  ingress_nginx_enabled    = true
  cert_manager_enabled     = true
  external_secrets_enabled = true

  apply_cluster_issuer = var.apply_cluster_issuer
  letsencrypt_email    = var.letsencrypt_email
}

module "external_secrets_config" {
  source = "../../../modules/external_secrets"

  cloud_provider    = "azure"
  secret_store_name = local.core.keyvault_name

  depends_on = [module.cluster_addons]
}

module "rauthy" {
  source = "../../../modules/rauthy"

  charts_root = "${path.module}/../../../../../charts"
  rauthy_host = var.rauthy_host
  replicas    = 1 # Single replica for dev; use 3 for prod HA

  depends_on = [module.cluster_addons]
}

module "platform_bootstrap" {
  source = "../../../modules/platform_bootstrap"

  cloud_provider = "azure"
  registry_url   = local.core.acr_login_server

  statecraft_namespace = "statecraft-system"
  deployd_namespace    = "deployd-system"

  statecraft_host = var.statecraft_host
  deployd_host    = var.deployd_host

  statecraft_sa_name = local.core.statecraft_serviceaccount_name
  deployd_sa_name    = local.core.deployd_serviceaccount_name
  cloud_identity_id  = local.core.statecraft_identity_client_id

  charts_root = "${path.module}/../../../../../charts"

  depends_on = [module.cluster_addons, module.external_secrets_config]
}
