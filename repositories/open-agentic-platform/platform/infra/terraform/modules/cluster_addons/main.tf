resource "helm_release" "ingress_nginx" {
  count            = var.ingress_nginx_enabled ? 1 : 0
  name             = "ingress-nginx"
  repository       = "https://kubernetes.github.io/ingress-nginx"
  chart            = "ingress-nginx"
  namespace        = "ingress-nginx"
  create_namespace = true

  # Azure-specific: health probe path annotation for Azure Load Balancer
  dynamic "set" {
    for_each = var.cloud_provider == "azure" ? [1] : []
    content {
      name  = "controller.service.annotations.service\\.beta\\.kubernetes\\.io/azure-load-balancer-health-probe-request-path"
      value = "/healthz"
    }
  }
}

resource "helm_release" "cert_manager" {
  name             = "cert-manager"
  repository       = "https://charts.jetstack.io"
  chart            = "cert-manager"
  namespace        = "cert-manager"
  create_namespace = true
  version          = "v1.19.3"
  wait             = true

  set {
    name  = "installCRDs"
    value = "true"
  }
}

resource "helm_release" "external_secrets" {
  count            = var.external_secrets_enabled ? 1 : 0
  name             = "external-secrets"
  repository       = "https://charts.external-secrets.io"
  chart            = "external-secrets"
  namespace        = "external-secrets"
  create_namespace = true

  set {
    name  = "installCRDs"
    value = "true"
  }
}

resource "time_sleep" "wait_for_cert_manager_crds" {
  create_duration = "90s"
  depends_on      = [helm_release.cert_manager]
}

resource "kubernetes_manifest" "letsencrypt_cluster_issuer" {
  count = var.apply_cluster_issuer ? 1 : 0

  manifest = {
    apiVersion = "cert-manager.io/v1"
    kind       = "ClusterIssuer"
    metadata   = { name = "letsencrypt-prod" }
    spec = {
      acme = {
        server              = "https://acme-v02.api.letsencrypt.org/directory"
        email               = var.letsencrypt_email
        privateKeySecretRef = { name = "letsencrypt-prod" }
        solvers = [{
          http01 = { ingress = { class = "nginx" } }
        }]
      }
    }
  }

  depends_on = [
    helm_release.cert_manager,
    time_sleep.wait_for_cert_manager_crds,
  ]
}
