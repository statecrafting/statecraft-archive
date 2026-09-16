#!/usr/bin/env bash
# =============================================================================
# OAP Hetzner — Infrastructure Bootstrap
# =============================================================================
# Installs cluster add-ons and dependencies. Called by setup.sh.
# Idempotent — safe to re-run.
# =============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLATFORM_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
KUBECONFIG_PATH="${KUBECONFIG:-${OAP_HETZNER_DIR:-$HOME/.config/oap/infra/hetzner}/kubeconfig}"

if [ ! -f "$KUBECONFIG_PATH" ]; then
  echo "ERROR: Kubeconfig not found at $KUBECONFIG_PATH"
  echo "Run 'hetzner-k3s create --config cluster.yaml' first."
  exit 1
fi

export KUBECONFIG="$KUBECONFIG_PATH"

info()  { printf '\033[1;34m==> %s\033[0m\n' "$*"; }
err()   { printf '\033[1;31mERROR: %s\033[0m\n' "$*" >&2; exit 1; }

# region: cert-nginx-strikes
# --- ingress-nginx + cert-manager + ClusterIssuers ---
# Spec 151 Phase 3 (2026-05-18) — both charts and both active
# ClusterIssuers (`letsencrypt-prod` HTTP-01 + `letsencrypt-prod-dns01-
# cloudflare` DNS-01) are Flux-reconciled via the gitops tree:
#
#   platform/gitops/clusters/hetzner-prod/infrastructure/ingress-nginx.yaml
#   platform/gitops/clusters/hetzner-prod/infrastructure/cert-manager.yaml
#   platform/gitops/clusters/hetzner-prod/manifests/cert-manager-clusterissuers.yaml
#
# Issuer selection policy (decided 2026-05-08, spec 143 step 7):
#   - letsencrypt-prod (HTTP-01) is the DEFAULT for platform hosts
#     (statecraft.${DOMAIN}, auth.${DOMAIN}, deploy.${DOMAIN},
#     minio.${DOMAIN}).
#   - letsencrypt-prod-dns01-cloudflare (DNS-01) serves the wildcard
#     tenant cert per spec 137 Phase 4↔5.
#
# Hetzner DNS removed (spec 151 Phase 3 follow-up cleanup, 2026-05-18):
# The `cert-manager-webhook-hetzner` chart + the dormant `letsencrypt-
# dns01` ClusterIssuer that previously lived here have been removed.
# They were never functional in this deployment — `statecraft.ing`'s
# authoritative nameservers are at Cloudflare (`leo.ns.cloudflare.com`
# / `rosalie.ns.cloudflare.com`), Hetzner DNS holds no zone for the
# domain, and the DNS-01 validation chain would always fail at the
# webhook's API call (no zone) and at Let's Encrypt's query
# (Cloudflare doesn't have the TXT record the webhook wrote
# elsewhere). The "future fallback" framing dressed up structural
# lock-in to Cloudflare-as-authoritative-DNS as optional flexibility
# it wasn't. Resurrection path: revert this PR's strikes AND migrate
# `statecraft.ing` authoritative DNS from Cloudflare to Hetzner DNS
# (out of scope for any current plan; would lose Cloudflare proxy /
# WAF / Email Routing).
#
# When adding a new ingress, copy the cert-manager.io/cluster-issuer
# annotation from a similar existing ingress; if you find yourself
# guessing, document the choice in the new ingress's PR rather than
# assuming.
# endregion cert-nginx-strikes

# --- Namespaces ---
info "Creating namespaces..."
for ns in statecraft-system deployd-system rauthy-system; do
  kubectl create namespace "$ns" --dry-run=client -o yaml | kubectl apply -f -
done

# --- Resource quotas + limit ranges ---
#
# Default-deny NetworkPolicies (plus the allow rules each namespace needs
# for ingress-nginx/DNS/cross-namespace traffic) are no longer skipped
# for statecraft-system/deployd-system/rauthy-system: they are Flux-
# managed declaratively via platform/k8s/policies/{statecraft,deployd,
# rauthy}/networkpolicy-*.yaml, wired into the `policies` Flux
# Kustomization through the explicit list in
# platform/k8s/policies/kustomization.yaml (same pattern already proven
# for the monitoring namespace). They are intentionally NOT applied
# imperatively here the way resourcequota/limitrange below are: unlike
# those, a bare `kubectl apply` of a default-deny landing before Flux has
# reconciled its paired allow rules would repeat the 2026-06-12 incident
# (see the monitoring policy's header comment) -- Ingress/Egress
# isolation has no "dormant-additive" grace window, so default-deny and
# its allows must land together, which the single Flux Kustomization
# apply guarantees and a second imperative code path here would not.
info "Applying resource policies..."
for ns in statecraft-system deployd-system rauthy-system; do
  kubectl apply -n "$ns" -f "$PLATFORM_ROOT/k8s/policies/namespace-baseline/resourcequota.yaml" 2>/dev/null || true
  kubectl apply -n "$ns" -f "$PLATFORM_ROOT/k8s/policies/namespace-baseline/limitrange.yaml" 2>/dev/null || true
done

# --- PostgreSQL ---
if helm status postgresql -n statecraft-system >/dev/null 2>&1; then
  info "PostgreSQL already installed, skipping"

  # Drift guard: the bitnami chart only initializes the statecraft user
  # password on first install (via initdb against an empty PVC). If .env's
  # POSTGRES_PASSWORD later diverges — e.g. `setup.sh --clean` ran without
  # destroying the cluster, or .env was hand-edited — Phase 2 would silently
  # write a statecraft-api-secrets that can't authenticate, and every DB
  # query in statecraft throws (OAuth callback surfaces as `account_error`).
  # Verify the current password actually works before continuing.
  info "Verifying POSTGRES_PASSWORD authenticates against live postgres..."
  POSTGRES_PASSWORD="${POSTGRES_PASSWORD:?POSTGRES_PASSWORD must be set}"
  kubectl delete pod pg-auth-check -n statecraft-system --ignore-not-found=true >/dev/null
  # --rm requires an attached stream on newer kubectl; -i + </dev/null gives
  # us attached stdin without a TTY (TTYs drop output on fast-exit pods).
  if ! kubectl run pg-auth-check --rm -i --restart=Never --quiet \
       --namespace statecraft-system \
       --image=bitnami/postgresql:latest \
       --env="PGPASSWORD=$POSTGRES_PASSWORD" \
       --command -- psql -h postgresql.statecraft-system.svc.cluster.local \
       -U statecraft -d statecraft -tAc 'SELECT 1' </dev/null >/dev/null 2>&1; then
    cat >&2 <<'EOF'
ERROR: POSTGRES_PASSWORD in .env does NOT authenticate against postgresql-0.
The live postgres still has its old password (persisted on its PVC) while
.env has drifted. Pick one of:

  a) Reset the DB user to match .env (dev clusters only; no data loss).
     Source .env first so bash and the DB use byte-identical values, and
     pipe the SQL on stdin so psql's :'pass' substitution runs (it does
     NOT run under `psql -c` with pure SQL, and shell-interpolating
     '$POSTGRES_PASSWORD' into a SQL literal breaks on $, `, \, or ':

       set -a; source .env; set +a
       PG_SUPER=$(kubectl -n statecraft-system get secret postgresql \
         -o jsonpath='{.data.postgres-password}' | base64 -d)
       printf "ALTER USER statecraft WITH PASSWORD :'pass';\n" | \
         kubectl -n statecraft-system exec -i postgresql-0 -- \
           env PGPASSWORD="$PG_SUPER" psql -U postgres \
             -v ON_ERROR_STOP=1 -v pass="$POSTGRES_PASSWORD"

  b) Update .env POSTGRES_PASSWORD to what the DB actually has:
       kubectl -n statecraft-system get secret postgresql \
         -o jsonpath='{.data.password}' | base64 -d
EOF
    exit 1
  fi
else
  info "Installing PostgreSQL..."
  POSTGRES_PASSWORD="${POSTGRES_PASSWORD:?POSTGRES_PASSWORD must be set}"

  helm upgrade --install postgresql oci://registry-1.docker.io/bitnamicharts/postgresql \
    --namespace statecraft-system \
    --set auth.username=statecraft \
    --set auth.password="$POSTGRES_PASSWORD" \
    --set auth.database=statecraft \
    --set primary.persistence.size=10Gi \
    --wait --timeout 300s
fi

# --- NSQ ---
info "Installing NSQ..."
kubectl apply -f "$SCRIPT_DIR/nsq.yaml"

# --- MinIO (S3-compatible object store for knowledge intake) ---
# Uses the official MinIO chart at charts.min.io (quay.io/minio images).
# We deliberately avoid Bitnami's chart because Bitnami moved free MinIO
# images behind a paywall in mid-2025 — `docker.io/bitnami/minio:*` tags
# 404 today, leaving pods in ImagePullBackOff.
MINIO_CHART_INSTALLED=false
if helm status minio -n statecraft-system >/dev/null 2>&1; then
  CURRENT_CHART=$(helm list -n statecraft-system -o json \
    | grep -o '"chart":"minio-[^"]*"' | head -1 || true)
  # The official chart's name is `minio-<ver>`; Bitnami's is the same prefix
  # but pulls from a doomed registry. Re-install if the running pods are in
  # ImagePullBackOff regardless of which chart is recorded.
  if kubectl -n statecraft-system get pods -l app=minio \
       -o jsonpath='{.items[*].status.containerStatuses[*].state.waiting.reason}' 2>/dev/null \
       | grep -q ImagePullBackOff; then
    info "MinIO release exists but pods are in ImagePullBackOff — reinstalling"
    helm uninstall minio -n statecraft-system >/dev/null 2>&1 || true
    kubectl -n statecraft-system delete pvc -l release=minio --ignore-not-found=true >/dev/null 2>&1 || true
  else
    info "MinIO already installed (${CURRENT_CHART}), skipping"
    MINIO_CHART_INSTALLED=true
  fi
fi

if [ "$MINIO_CHART_INSTALLED" = false ]; then
  info "Installing MinIO (official chart)..."
  MINIO_ROOT_USER="${MINIO_ROOT_USER:?MINIO_ROOT_USER must be set}"
  MINIO_ROOT_PASSWORD="${MINIO_ROOT_PASSWORD:?MINIO_ROOT_PASSWORD must be set}"

  helm repo add minio https://charts.min.io/ 2>/dev/null || true
  helm repo update minio >/dev/null

  # Standalone mode: single replica, single drive. Two services:
  # - API service: ClusterIP for in-cluster server ops + public ingress
  #   on minio.${DOMAIN} for browser presigned-PUT (spec 143 FR-005).
  # - Console service: ClusterIP only, no public ingress (operators
  #   reach it via kubectl port-forward).
  #
  # Spec 143 history: the original Hetzner deployment shipped with NO
  # ingress on either service because the platform was provisioned for
  # a server-side-proxy upload flow (option B) that the application
  # code never matched — storage.ts always issued presigned URLs to
  # the browser. The browser couldn't reach the cluster-internal
  # MinIO, so uploads silently failed for months. Spec 143 closed the
  # gap on the option-A side: dual-endpoint storage client + public
  # ingress here + CORS contract for the statecraft origin.
  #
  # Required envs (FR-006a):
  #   MINIO_SERVER_URL — must match the public ingress hostname so
  #     SigV4 canonicalisation produces the same signature browser-side
  #     and server-side. Without this MinIO recomputes against its
  #     in-cluster hostname and rejects with SignatureDoesNotMatch.
  #   MINIO_API_CORS_ALLOW_ORIGIN — strict to the statecraft origin;
  #     no wildcards.
  #
  # Recommended envs (defence-in-depth):
  #   MINIO_BROWSER=off — disables the console daemon globally. The
  #     console is also not exposed via ingress (consoleService.type
  #     remains ClusterIP), so this is belt-and-suspenders.
  #   MINIO_BROWSER_REDIRECT_URL — informational; coherent state if
  #     a future operator flips the console back on.
  #
  # Body-size annotation: 1g matches KNOWLEDGE_UPLOAD_MAX_BYTES in
  # platform/services/statecraft/api/knowledge/uploadLimits.ts (spec
  # 143 FR-011). When that constant changes, this value MUST change
  # to match — uploadLimits.ts has the propagation comment pointing
  # back here.
  #
  # Cluster-issuer: `letsencrypt-prod` (HTTP-01 via the nginx solver)
  # is Flux-reconciled via `platform/gitops/clusters/hetzner-prod/
  # manifests/cert-manager-clusterissuers.yaml` and is the default
  # issuer for `*.${DOMAIN}` platform hosts. Spec 143 §4.7
  # (amendment, 2026-05-08, L-005) relaxed FR-008 from a strict
  # DNS-01 mandate to "DNS-01 only when the authoritative DNS
  # provider supports a cert-manager webhook AND wildcard/DNS-only
  # validation is needed; HTTP-01 acceptable for single-host
  # non-wildcard certs once the parent domain's ingress is routing."
  # `statecraft.ing` is fronted by Cloudflare; the wildcard tenant
  # cert (spec 137 / spec 106) uses the Cloudflare DNS-01 issuer
  # (`letsencrypt-prod-dns01-cloudflare`); the Hetzner DNS path
  # was removed in the spec 151 Phase 3 follow-up cleanup as
  # never-functional given Cloudflare-authoritative DNS.
  helm upgrade --install minio minio/minio \
    --namespace statecraft-system \
    --set rootUser="$MINIO_ROOT_USER" \
    --set rootPassword="$MINIO_ROOT_PASSWORD" \
    --set mode=standalone \
    --set replicas=1 \
    --set persistence.size=20Gi \
    --set resources.requests.memory=512Mi \
    --set resources.requests.cpu=100m \
    --set service.type=ClusterIP \
    --set consoleService.type=ClusterIP \
    --set environment.MINIO_SERVER_URL="https://minio.${DOMAIN}" \
    --set environment.MINIO_API_CORS_ALLOW_ORIGIN="${APP_BASE_URL}" \
    --set environment.MINIO_BROWSER="off" \
    --set environment.MINIO_BROWSER_REDIRECT_URL="https://minio.${DOMAIN}" \
    --set ingress.enabled=true \
    --set ingress.ingressClassName=nginx \
    --set "ingress.hosts[0]=minio.${DOMAIN}" \
    --set "ingress.tls[0].secretName=minio-tls" \
    --set "ingress.tls[0].hosts[0]=minio.${DOMAIN}" \
    --set "ingress.annotations.nginx\.ingress\.kubernetes\.io/proxy-body-size=1g" \
    --set "ingress.annotations.cert-manager\.io/cluster-issuer=letsencrypt-prod" \
    --wait --timeout 300s
fi

# --- Spec 143 FR-010 K8s CronJob: legacy-bootstrap retirement ---
#
# Earlier revisions of post-create.sh imperatively created the
# `knowledge-orphan-imported-sweeper` CronJob via heredoc-apply. That
# bootstrap is now retired: the resource is owned by the statecraft
# Helm chart at
# `platform/charts/statecraft/templates/cronjob-orphan-sweeper.yaml`
# (FU-001 beat 4). Two systems writing the same K8s object is the
# §12 L-003 single-writer anti-pattern; Helm is the sole writer going
# forward.
#
# Idempotency is now LABEL-GATED (FU-009). The bootstrap-only delete
# fired unconditionally on every setup.sh run, which was correct on
# first cluster bootstrap (cluster carries legacy un-Helm-owned
# cronjob → delete fires → helm release recreates it Helm-owned) but
# WRONG on subsequent re-runs against a cluster where CD has already
# deployed the Helm-owned successor (delete fires AFTER the
# Helm-owned cronjob exists and removes it). Empirically validated
# twice in the 2026-05-09 FU-001 verification session — see spec 143
# §12 FU-009 filing for the evidence.
#
# Label gate: delete only when `app.kubernetes.io/managed-by` is
# absent or != "Helm". The legacy un-Helm-owned cronjob (raw
# kubectl-applied) carried no such label by construction; the Helm-
# owned successor always carries it. Result: setup.sh re-runs against
# a cluster carrying the Helm-owned cronjob preserve it; first-time
# bootstrap against a cluster carrying the legacy cronjob still
# clears it.
#
# Note: this delete is for the post-create.sh legacy bootstrap path.
# The cd-statecraft helm-deploy action carries its own one-time
# operator step (`kubectl delete cronjob knowledge-orphan-imported-sweeper
# -n statecraft-system --ignore-not-found=true`) before the next helm
# upgrade lands the chart, because helm-deploy's ownership-transfer
# logic only handles Deployments and a CronJob would otherwise fail
# the upgrade on immutable-field collision.
#
# The systemic L-001 finding (spec 115 / 087 / 124 sweepers carry the
# same self-hosted scheduler gap) is tracked as FU-003; their K8s
# CronJobs will land Helm-native from day zero, no post-create.sh
# bootstrap needed.

info "Checking spec-143 orphan-imported-sweeper cronjob ownership (FU-009 label-gate)..."
managed_by=$(kubectl get cronjob knowledge-orphan-imported-sweeper \
  --namespace statecraft-system \
  -o jsonpath='{.metadata.labels.app\.kubernetes\.io/managed-by}' 2>/dev/null || echo "")
if [ -z "$managed_by" ] || [ "$managed_by" != "Helm" ]; then
  kubectl delete cronjob knowledge-orphan-imported-sweeper \
    --namespace statecraft-system \
    --ignore-not-found=true
  info "Legacy un-Helm-owned orphan sweeper cronjob cleared."
else
  info "Helm-owned orphan sweeper cronjob present; skipping legacy delete (FU-009 label-gate)."
fi

info "Infrastructure bootstrap complete"
