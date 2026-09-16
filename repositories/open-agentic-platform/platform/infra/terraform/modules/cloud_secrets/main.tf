# Azure Key Vault secrets
resource "azurerm_key_vault_secret" "azure" {
  for_each = var.cloud_provider == "azure" ? var.secrets : {}

  key_vault_id = var.secret_store_id
  name         = lower(replace(each.key, "_", "-"))
  value        = each.value
}

# AWS Secrets Manager secrets
resource "aws_secretsmanager_secret" "aws" {
  for_each = var.cloud_provider == "aws" ? var.secrets : {}

  name = lower(replace(each.key, "_", "-"))
}

resource "aws_secretsmanager_secret_version" "aws" {
  for_each = var.cloud_provider == "aws" ? var.secrets : {}

  secret_id     = aws_secretsmanager_secret.aws[each.key].id
  secret_string = each.value
}

# GCP Secret Manager secrets
resource "google_secret_manager_secret" "gcp" {
  for_each = var.cloud_provider == "gcp" ? var.secrets : {}

  secret_id = lower(replace(each.key, "_", "-"))

  replication {
    auto {}
  }
}

resource "google_secret_manager_secret_version" "gcp" {
  for_each = var.cloud_provider == "gcp" ? var.secrets : {}

  secret      = google_secret_manager_secret.gcp[each.key].id
  secret_data = each.value
}
