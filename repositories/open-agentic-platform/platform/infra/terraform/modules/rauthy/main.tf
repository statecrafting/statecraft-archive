resource "kubernetes_namespace" "rauthy" {
  metadata { name = var.namespace }
}

resource "helm_release" "rauthy" {
  name             = "rauthy"
  chart            = abspath("${var.charts_root}/rauthy")
  namespace        = var.namespace
  create_namespace = false

  values = [yamlencode({
    replicas = var.replicas

    oidc = {
      issuer = "https://${var.rauthy_host}/auth/v1"
    }

    ingress = {
      enabled   = true
      className = "nginx"
      host      = var.rauthy_host
      annotations = {
        "cert-manager.io/cluster-issuer"              = "letsencrypt-prod"
        "nginx.ingress.kubernetes.io/proxy-body-size" = "10m"
      }
    }

    persistence = {
      size         = var.persistence_size
      storageClass = var.storage_class
    }

    raft = {
      existingSecret    = var.secrets_name
      existingSecretKey = "raft-secret"
    }

    api = {
      existingSecret    = var.secrets_name
      existingSecretKey = "api-secret"
    }

    bootstrap = {
      adminEmail        = var.admin_email
      existingSecret    = var.secrets_name
      existingSecretKey = "admin-password"
    }
  })]

  depends_on = [kubernetes_namespace.rauthy]
}
