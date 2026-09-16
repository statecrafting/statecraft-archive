# ClusterSecretStore for Azure Key Vault
resource "kubernetes_manifest" "azure_secret_store" {
  count = var.cloud_provider == "azure" ? 1 : 0

  manifest = {
    apiVersion = "external-secrets.io/v1beta1"
    kind       = "ClusterSecretStore"
    metadata   = { name = "azure-keyvault" }
    spec = {
      provider = {
        azurekv = {
          authType = "WorkloadIdentity"
          vaultUrl = "https://${var.secret_store_name}.vault.azure.net"
          serviceAccountRef = {
            name      = var.service_account_name
            namespace = var.service_account_namespace
          }
        }
      }
    }
  }
}

# ClusterSecretStore for AWS Secrets Manager
resource "kubernetes_manifest" "aws_secret_store" {
  count = var.cloud_provider == "aws" ? 1 : 0

  manifest = {
    apiVersion = "external-secrets.io/v1beta1"
    kind       = "ClusterSecretStore"
    metadata   = { name = "aws-secrets-manager" }
    spec = {
      provider = {
        aws = {
          service = "SecretsManager"
          region  = var.cloud_region
          auth = {
            jwt = {
              serviceAccountRef = {
                name      = var.service_account_name
                namespace = var.service_account_namespace
              }
            }
          }
        }
      }
    }
  }
}

# ClusterSecretStore for GCP Secret Manager
resource "kubernetes_manifest" "gcp_secret_store" {
  count = var.cloud_provider == "gcp" ? 1 : 0

  manifest = {
    apiVersion = "external-secrets.io/v1beta1"
    kind       = "ClusterSecretStore"
    metadata   = { name = "gcp-secret-manager" }
    spec = {
      provider = {
        gcpsm = {
          projectID = var.cloud_project_id
          auth = {
            workloadIdentity = {
              clusterLocation = var.cloud_region
              clusterName     = var.cluster_name
              serviceAccountRef = {
                name      = var.service_account_name
                namespace = var.service_account_namespace
              }
            }
          }
        }
      }
    }
  }
}
