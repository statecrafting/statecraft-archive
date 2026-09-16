#!/usr/bin/env bash
# =============================================================================
# OAP Hetzner Setup — Single entrypoint for cluster + platform deployment
# =============================================================================
# Usage:
#   1. cp .env.example ~/.config/oap/infra/hetzner/.env && $EDITOR it  # set HCLOUD_TOKEN
#   2. ./setup.sh                              # Phase 1: cluster + secrets (Flux reconciles rauthy)
#   3. Fill in GitHub + OIDC values in .env
#   4. ./setup.sh                              # Phase 2: full platform
#
# Prerequisites: kubectl, helm, hetzner-k3s, flux, sops, age. Full operator
#                prereq table + version pins: docs/DEVELOPERS.md §"Hetzner GitOps
#                operator (spec 151)".
#
# Flags:
#   --clean   Destroy existing cluster, remove kubeconfig and auto-generated
#             secrets from .env, then start fresh from Phase 1.
# =============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLATFORM_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
GENERATORS="$PLATFORM_ROOT/scripts/generate"

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
info()  { printf '\033[1;34m==> %s\033[0m\n' "$*"; }
warn()  { printf '\033[1;33m    %s\033[0m\n' "$*"; }
ok()    { printf '\033[1;32m    %s\033[0m\n' "$*"; }
err()   { printf '\033[1;31mERROR: %s\033[0m\n' "$*" >&2; exit 1; }

generate_secret()  { bash "$GENERATORS/generate-secret.sh"; }
generate_b64url()  { bash "$GENERATORS/generate-base64url-password.sh"; }
# Rauthy ENC_KEY_ID must match ^[a-zA-Z0-9:_-]{2,20}$
generate_enc_key_id() { openssl rand -hex 8; }
# Rauthy ENC_KEY must be exactly 32 random bytes, base64-encoded
generate_enc_key()    { openssl rand -base64 32 | tr -d '\n'; echo; }

# ---------------------------------------------------------------------------
# Load .env
# ---------------------------------------------------------------------------
# Operator state (.env + kubeconfig) lives outside the repo tree, under the
# operator's XDG config home (same pattern as SOPS_AGE_KEY_FILE below). Override
# OAP_HETZNER_DIR to relocate; if you do, also update cluster.yaml's
# kubeconfig_path to match.
OAP_HETZNER_DIR="${OAP_HETZNER_DIR:-$HOME/.config/oap/infra/hetzner}"
mkdir -p "$OAP_HETZNER_DIR"
ENV_FILE="$OAP_HETZNER_DIR/.env"
KUBECONFIG_PATH="$OAP_HETZNER_DIR/kubeconfig"
if [ ! -f "$ENV_FILE" ]; then
  err ".env not found at $ENV_FILE. Run:  cp \"$SCRIPT_DIR/.env.example\" \"$ENV_FILE\"  and set HCLOUD_TOKEN"
fi

set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a

[ -n "${HCLOUD_TOKEN:-}" ] || err "HCLOUD_TOKEN is empty in .env"
[ -n "${DOMAIN:-}" ]       || err "DOMAIN is empty in .env"

# ---------------------------------------------------------------------------
# --clean: destroy cluster and reset local state
# ---------------------------------------------------------------------------
if [ "${1:-}" = "--clean" ]; then
  info "Clean start requested"

  # Destroy Hetzner cluster if kubeconfig exists. If destroy fails, bail out
  # BEFORE clearing .env — otherwise the cluster's postgres keeps the old
  # password while a fresh one lands in .env, and every subsequent deploy
  # writes a statecraft secret that can't authenticate (account_error in the
  # OAuth callback, etc).
  if [ -f "$KUBECONFIG_PATH" ]; then
    warn "Destroying existing cluster..."
    hetzner-k3s delete --config "$SCRIPT_DIR/cluster.yaml" \
      || err "hetzner-k3s delete failed; cluster still exists. Refusing to clear .env secrets (would drift from live postgres)."
    rm -f "$KUBECONFIG_PATH"
    ok "Cluster destroyed and kubeconfig removed"
  else
    ok "No kubeconfig found, nothing to destroy"
  fi

  # Clear auto-generated secrets from .env (preserve manual values)
  AUTO_SECRETS=(
    POSTGRES_PASSWORD SESSION_SECRET
    RAUTHY_RAFT_SECRET RAUTHY_API_SECRET RAUTHY_ADMIN_PASSWORD
    RAUTHY_ENC_KEY_ID RAUTHY_ENC_KEY
    HIQLITE_SECRET_RAFT HIQLITE_SECRET_API
    GITHUB_WEBHOOK_SECRET
    MINIO_ROOT_USER MINIO_ROOT_PASSWORD
  )
  for var in "${AUTO_SECRETS[@]}"; do
    sed -i.bak "s|^${var}=.*|${var}=|" "$ENV_FILE"
  done
  rm -f "$ENV_FILE.bak"
  ok "Auto-generated secrets cleared from .env"

  info "Clean complete — re-run ./setup.sh to start fresh"
  exit 0
fi

# ---------------------------------------------------------------------------
# Auto-generate secrets (fill blanks, write back to .env)
# ---------------------------------------------------------------------------
info "Checking secrets..."
CHANGED=false

auto_fill() {
  local var_name="$1"
  local generator="${2:-generate_secret}"
  local current_val="${!var_name:-}"

  if [ -z "$current_val" ]; then
    local new_val
    new_val=$($generator)
    export "$var_name=$new_val"
    if grep -q "^${var_name}=" "$ENV_FILE"; then
      sed -i.bak "s|^${var_name}=.*|${var_name}=\"${new_val}\"|" "$ENV_FILE"
    else
      echo "${var_name}=\"${new_val}\"" >> "$ENV_FILE"
    fi
    ok "Generated $var_name"
    CHANGED=true
  fi
}

auto_fill POSTGRES_PASSWORD   generate_secret
auto_fill SESSION_SECRET      generate_secret
auto_fill RAUTHY_RAFT_SECRET  generate_secret
auto_fill RAUTHY_API_SECRET   generate_secret
auto_fill RAUTHY_ADMIN_PASSWORD generate_b64url
auto_fill RAUTHY_ENC_KEY_ID    generate_enc_key_id
auto_fill RAUTHY_ENC_KEY       generate_enc_key
auto_fill HIQLITE_SECRET_RAFT generate_secret
auto_fill HIQLITE_SECRET_API  generate_secret
auto_fill GITHUB_WEBHOOK_SECRET generate_secret

# MinIO in-cluster object store. Root user must be >= 3 chars, password
# must be >= 8 chars per the bitnami chart's validator.
generate_minio_user() { openssl rand -hex 6; }
auto_fill MINIO_ROOT_USER     generate_minio_user
auto_fill MINIO_ROOT_PASSWORD generate_secret

# Sync DB_PASSWORD = POSTGRES_PASSWORD
export DB_PASSWORD="$POSTGRES_PASSWORD"

rm -f "$ENV_FILE.bak"

if [ "$CHANGED" = true ]; then
  ok "Secrets written to .env — keep this file safe"
fi

# ---------------------------------------------------------------------------
# Pre-flight checks
# ---------------------------------------------------------------------------
info "Pre-flight checks..."
for cmd in kubectl helm hetzner-k3s flux sops age; do
  command -v "$cmd" >/dev/null 2>&1 || err "$cmd not found. Install it first."
done
ok "All tools present"

# Spec 151 §Clarification 9 — the laptop age private key materialises as the
# `flux-system/sops-age` Secret during `flux bootstrap`. Refuse to proceed
# if the operator key is missing; the cluster's `kustomize-controller` will
# crash-loop on encrypted-Secret decryption without it.
SOPS_AGE_KEY_FILE="${SOPS_AGE_KEY_FILE:-$HOME/.config/sops/age/keys.txt}"
[ -f "$SOPS_AGE_KEY_FILE" ] || err "operator-host age key not found at $SOPS_AGE_KEY_FILE (spec 151 §Clarification 9). Generate with: age-keygen -o $SOPS_AGE_KEY_FILE && chmod 0600 $SOPS_AGE_KEY_FILE"
[ -n "${GITHUB_TOKEN:-}" ] || err "GITHUB_TOKEN not set (needed by 'flux bootstrap github'). Export a fine-grained PAT with Contents:read+write on statecrafting/open-agentic-platform."

# ---------------------------------------------------------------------------
# Phase 1: Create K3s cluster (idempotent)
# ---------------------------------------------------------------------------
# KUBECONFIG_PATH was defined earlier ($OAP_HETZNER_DIR/kubeconfig).
if [ ! -f "$KUBECONFIG_PATH" ]; then
  info "Creating Hetzner K3s cluster..."
  hetzner-k3s create --config "$SCRIPT_DIR/cluster.yaml"
else
  info "Kubeconfig exists, skipping cluster creation"
fi

export KUBECONFIG="$KUBECONFIG_PATH"

# Spec 151 dr-baseline F5 — the k3s master carries `CriticalAddonsOnly: true`
# and Flux controller deployments don't tolerate it. Gate `flux bootstrap`
# on at least one non-master node Ready. With workers present in production
# this is invisible; the explicit wait is the defensive line for fresh-DR
# rebootstrap when worker placement is still pending.
info "Waiting for at least one non-master node Ready..."
kubectl wait --for=condition=Ready node -l '!node-role.kubernetes.io/master' --timeout=10m
ok "Non-master node ready"

# region: bootstrap
# ---------------------------------------------------------------------------
# Spec 151 Phase 1 — Flux v2 GitOps bootstrap.
#
# `flux bootstrap github` is idempotent: on a fresh cluster it commits a
# `flux-system/` Kustomization to the gitops path, installs the four
# controllers (source / kustomize / helm / notification), and creates the
# in-cluster GitRepository that Flux uses to reconcile itself. On an
# already-bootstrapped cluster it no-ops. Image controllers (image-reflector
# / image-automation) defer to spec 152 — narrowed 151 ships the four
# defaults only.
#
# The SOPS-age Secret holds the laptop private key (spec 151 §Clarification
# 9 (c)). `kustomize-controller` reads it for decryption at apply time.
# Applied as `--from-file` so the file mode stays operator-private on disk
# while the Secret carries the raw bytes.
# ---------------------------------------------------------------------------
info "Bootstrapping Flux v2..."
# FLUX_OWNER / FLUX_REPO / FLUX_BRANCH let a fork point Flux at its own repo so
# the GitOps loop reconciles from the fork, not upstream (spec 221 FR-040). They
# default to the upstream owner/repo/branch, so an unset .env behaves exactly as
# before.
flux bootstrap github \
  --owner="${FLUX_OWNER:-statecrafting}" \
  --repo="${FLUX_REPO:-open-agentic-platform}" \
  --branch="${FLUX_BRANCH:-main}" \
  --path=platform/gitops/clusters/hetzner-prod \
  --personal=false \
  --network-policy=true

info "Applying flux-system/sops-age Secret (laptop key)..."
kubectl create secret generic sops-age \
  --namespace=flux-system \
  --from-file=age.agekey="$SOPS_AGE_KEY_FILE" \
  --dry-run=client -o yaml | kubectl apply -f -
ok "Flux v2 bootstrapped + SOPS-age Secret present"
# endregion bootstrap

# ---------------------------------------------------------------------------
# Phase 1: Bootstrap infrastructure (legacy path — retires phase by phase
# as spec 151 Phases 2-4 migrate each chart into platform/gitops/...).
# ---------------------------------------------------------------------------
info "Bootstrapping infrastructure (pre-Flux phase-out path)..."
"$SCRIPT_DIR/post-create.sh"

# region: reflector-install
# ---------------------------------------------------------------------------
# Spec 151 Phase 2 (2026-05-18) — kubernetes-reflector is now Flux-
# reconciled via `platform/gitops/clusters/hetzner-prod/infrastructure/
# reflector.yaml`. The imperative `helm upgrade --install reflector`
# block that lived here is retired. Flux's `helm-controller` installs
# the chart on first reconciliation of the gitops tree; setup.sh no
# longer touches reflector.
# ---------------------------------------------------------------------------
# endregion reflector-install

# ---------------------------------------------------------------------------
# Spec 151 Phase 3 (2026-05-18) — DNS-01 cloudflare ClusterIssuer is
# now Flux-reconciled via `platform/gitops/clusters/hetzner-prod/
# manifests/cert-manager-clusterissuers.yaml`. Only the
# `cloudflare-api-token` Secret materialisation stays imperative here
# (it carries CLOUDFLARE_DNS_API_TOKEN from .env into the cluster);
# spec 153 will move it to a SOPS-encrypted per-purpose Secret under
# the gitops tree.
#
# Without the Cloudflare token, this block no-ops; cert-manager marks
# the Flux-reconciled DNS-01 ClusterIssuer Ready=False until the
# Secret arrives, and the wildcard tenant Certificate stays Pending.
# The HTTP-01 ClusterIssuer (also Flux-reconciled) keeps handling
# statecraft/deployd/rauthy/minio Ingresses — those don't need
# wildcards.
# ---------------------------------------------------------------------------
if [ -n "${CLOUDFLARE_DNS_API_TOKEN:-}" ]; then
  info "Creating cloudflare-api-token secret in cert-manager namespace..."
  kubectl create secret generic cloudflare-api-token \
    --namespace cert-manager \
    --from-literal=api-token="$CLOUDFLARE_DNS_API_TOKEN" \
    --dry-run=client -o yaml | kubectl apply -f -
  ok "cloudflare-api-token Secret applied; Flux reconciles the DNS-01 ClusterIssuer."
else
  warn "CLOUDFLARE_DNS_API_TOKEN not set — DNS-01 ClusterIssuer will stay Ready=False."
  warn "  Spec 137 magic-link / federated-login evidence (E2/E3/E4) requires"
  warn "  TLS on tenant ingress hostnames via the wildcard cert. The Flux-"
  warn "  reconciled Certificate stays Pending until the operator sets"
  warn "  CLOUDFLARE_DNS_API_TOKEN in .env and re-runs setup.sh."
fi

# ---------------------------------------------------------------------------
# Phase 1: Materialise K8s Secrets that Flux's HelmReleases reference.
#
# rauthy itself moved to Flux per spec 151 Phase 4 — the imperative
# `helm upgrade --install rauthy` block retired here. The `rauthy-secrets`
# and `rauthy-smtp-secret` materialisations stay imperative until spec 153
# SOPS-migrates them.
# ---------------------------------------------------------------------------
CHARTS_ROOT="$PLATFORM_ROOT/charts"

info "Creating rauthy-secrets..."
# ENC_KEYS format: key_id/base64_of_32_random_bytes
RAUTHY_ENC_KEYS="${RAUTHY_ENC_KEY_ID}/${RAUTHY_ENC_KEY}"
kubectl create secret generic rauthy-secrets \
  --namespace rauthy-system \
  --from-literal=raft-secret="$RAUTHY_RAFT_SECRET" \
  --from-literal=api-secret="$RAUTHY_API_SECRET" \
  --from-literal=admin-password="$RAUTHY_ADMIN_PASSWORD" \
  --from-literal=enc-keys="$RAUTHY_ENC_KEYS" \
  --from-literal=enc-key-active="$RAUTHY_ENC_KEY_ID" \
  --dry-run=client -o yaml | kubectl apply -f -

info "Creating deployd-api-secrets..."
kubectl create secret generic deployd-api-secrets \
  --namespace deployd-system \
  --from-literal=HIQLITE_SECRET_RAFT="$HIQLITE_SECRET_RAFT" \
  --from-literal=HIQLITE_SECRET_API="$HIQLITE_SECRET_API" \
  --dry-run=client -o yaml | kubectl apply -f -

# ---------------------------------------------------------------------------
# Spec 106 amendment (2026-05-17) — SMTP for Rauthy magic-link.
# When SMTP_USERNAME is set in .env, materialise `rauthy-smtp-secret`.
# Flux's rauthy HelmRelease has `smtp.enabled: true` hardcoded
# (`platform/gitops/clusters/hetzner-prod/infrastructure/rauthy.yaml`),
# so the StatefulSet will crash-loop on first reconcile if this Secret
# is absent. The chart's statefulset pulls
# SMTP_FROM/URL/PORT/USERNAME/PASSWORD from this Secret.
#
# **Hetzner Cloud blocks outbound TCP on port 465** (implicit-TLS / SMTPS),
# confirmed empirically 2026-05-17 against smtp.gmail.com. Port 587 with
# STARTTLS is reachable and is the supported default. Setting SMTP_PORT=465
# yields a hard `warn` here because Rauthy will crash-loop at startup on
# the SMTP connection probe (mailer.rs panics after retry exhaustion).
# ---------------------------------------------------------------------------
if [ -n "${SMTP_USERNAME:-}" ]; then
  SMTP_PORT_RESOLVED="${SMTP_PORT:-587}"
  if [ "$SMTP_PORT_RESOLVED" = "465" ]; then
    warn "SMTP_PORT=465 is blocked on Hetzner outbound — Rauthy will crash at startup."
    warn "  Override with SMTP_PORT=587 (STARTTLS submission) in .env, then re-run setup.sh."
    warn "  Skipping rauthy-smtp-secret materialisation; rauthy HelmRelease will crash-loop until fixed."
  else
    # Default starttls_only=true when port is 587 (STARTTLS submission).
    # Rauthy 0.35's mailer defaults to "try implicit TLS first, fall back
    # to STARTTLS" but the fallback doesn't trigger on every error shape
    # (e.g. Gmail's plaintext-banner-then-STARTTLS-upgrade returns
    # `InvalidMessage(InvalidContentType)` from the implicit-TLS handshake,
    # bypassing the fallback). Setting SMTP_STARTTLS_ONLY=true is the
    # documented way to make Rauthy negotiate STARTTLS from the start.
    STARTTLS_ONLY_RESOLVED="${SMTP_STARTTLS_ONLY:-}"
    if [ -z "$STARTTLS_ONLY_RESOLVED" ] && [ "$SMTP_PORT_RESOLVED" = "587" ]; then
      STARTTLS_ONLY_RESOLVED="true"
    fi
    info "Creating rauthy-smtp-secret (SMTP_USERNAME=${SMTP_USERNAME}, SMTP_PORT=${SMTP_PORT_RESOLVED}, STARTTLS_ONLY=${STARTTLS_ONLY_RESOLVED:-<default>})..."
    kubectl create secret generic rauthy-smtp-secret \
      --namespace rauthy-system \
      --from-literal=from="${SMTP_FROM:-Rauthy <rauthy@${DOMAIN}>}" \
      --from-literal=url="${SMTP_URL:-}" \
      --from-literal=port="$SMTP_PORT_RESOLVED" \
      --from-literal=username="$SMTP_USERNAME" \
      --from-literal=password="${SMTP_PASSWORD:-}" \
      --from-literal=starttls_only="$STARTTLS_ONLY_RESOLVED" \
      --from-literal=danger_insecure="${SMTP_DANGER_INSECURE:-false}" \
      --dry-run=client -o yaml | kubectl apply -f -
    ok "rauthy-smtp-secret materialised — Flux's rauthy HelmRelease will mount it via $SMTP_URL:$SMTP_PORT_RESOLVED"
  fi
else
  warn "SMTP_USERNAME not set in .env — Rauthy magic-link login unavailable"
  warn "  Flux's rauthy HelmRelease pins smtp.enabled=true; the StatefulSet will crash-loop until rauthy-smtp-secret exists."
fi

# ---------------------------------------------------------------------------
# Spec 196 — Grafana OIDC client credentials (platform metrics stack).
# When GRAFANA_OIDC_CLIENT_ID/_SECRET are set in .env (the operator has
# created the `grafana` client manually in the Rauthy admin UI — the
# documented [manual] OIDC-client convention; see .env.example),
# materialise the `grafana-oidc` Secret the monitoring HelmRelease's
# Grafana consumes via envFromSecret. Key names ARE the Grafana env
# overrides (GF_AUTH_GENERIC_OAUTH_*). Imperative like rauthy-secrets /
# rauthy-smtp-secret above, until spec 153 SOPS-migrates them.
# ---------------------------------------------------------------------------
if [ -n "${GRAFANA_OIDC_CLIENT_ID:-}" ] && [ -n "${GRAFANA_OIDC_CLIENT_SECRET:-}" ]; then
  if kubectl get namespace monitoring >/dev/null 2>&1; then
    info "Creating grafana-oidc secret..."
    kubectl create secret generic grafana-oidc \
      --namespace monitoring \
      --from-literal=GF_AUTH_GENERIC_OAUTH_CLIENT_ID="$GRAFANA_OIDC_CLIENT_ID" \
      --from-literal=GF_AUTH_GENERIC_OAUTH_CLIENT_SECRET="$GRAFANA_OIDC_CLIENT_SECRET" \
      --dry-run=client -o yaml | kubectl apply -f -
    ok "grafana-oidc materialised — the Grafana pod starts on the next reconcile"
  else
    warn "monitoring namespace not found — Flux hasn't reconciled the metrics stack yet (spec 196)."
    warn "  Re-run setup.sh after the monitoring HelmRelease lands; grafana-oidc is created then."
  fi
else
  warn "GRAFANA_OIDC_CLIENT_ID/_SECRET not set in .env — Grafana login unavailable (spec 196 Phase 2)"
  warn "  Create the 'grafana' client in Rauthy admin (redirect https://grafana.${DOMAIN:-<DOMAIN>}/login/generic_oauth,"
  warn "  scopes: openid email profile oap), fill .env, re-run setup.sh. The Grafana pod blocks on this Secret."
fi

# Spec 151 Phase 4 — rauthy chart now reconciled by Flux via
# `platform/gitops/clusters/hetzner-prod/infrastructure/rauthy.yaml`.
# The previous `helm upgrade --install rauthy ...` invocation retired
# here. `rauthy-secrets` + `rauthy-smtp-secret` (above) stay imperative
# until spec 153 SOPS-migrates them.

# ---------------------------------------------------------------------------
# Show Node IP + DNS instructions
# ---------------------------------------------------------------------------
echo ""
NODE_IP=$(kubectl get nodes -l '!node-role.kubernetes.io/master' \
  -o jsonpath='{.items[0].status.addresses[?(@.type=="ExternalIP")].address}' 2>/dev/null \
  || kubectl get nodes -o jsonpath='{.items[0].status.addresses[?(@.type=="ExternalIP")].address}' 2>/dev/null \
  || echo "pending")

info "Worker Node IP: $NODE_IP"
echo ""
echo "  DNS A records needed (if not already set):"
echo "    ${DOMAIN}            -> $NODE_IP"
echo "    deploy.${DOMAIN}     -> $NODE_IP"
echo "    auth.${DOMAIN}       -> $NODE_IP"
echo ""

# ---------------------------------------------------------------------------
# Check if Phase 2 values are ready
# ---------------------------------------------------------------------------
PHASE2_READY=true
MISSING=()

for var in GITHUB_UPSTREAM_CLIENT_ID GITHUB_UPSTREAM_CLIENT_SECRET \
           GITHUB_APP_ID GITHUB_APP_PRIVATE_KEY_B64 \
           OIDC_SPA_CLIENT_ID OIDC_M2M_CLIENT_ID OIDC_M2M_CLIENT_SECRET \
           RAUTHY_CLIENT_ID RAUTHY_CLIENT_SECRET RAUTHY_ADMIN_TOKEN \
           STATECRAFT_KNOWLEDGE_SWEEPER_CLIENT_ID STATECRAFT_KNOWLEDGE_SWEEPER_CLIENT_SECRET \
           STATECRAFT_FACTORY_SWEEPER_CLIENT_ID STATECRAFT_FACTORY_SWEEPER_CLIENT_SECRET; do
  if [ -z "${!var:-}" ]; then
    PHASE2_READY=false
    MISSING+=("$var")
  fi
done

if [ "$PHASE2_READY" = false ]; then
  echo "============================================"
  echo "  Phase 1 Complete"
  echo "============================================"
  echo ""
  echo "Rauthy admin panel:"
  echo "  URL:      https://auth.${DOMAIN}"
  echo "  Email:    admin@${DOMAIN}"
  echo "  Password: $RAUTHY_ADMIN_PASSWORD"
  echo ""
  echo "Next steps:"
  echo "  1. Point DNS A records to $NODE_IP (see above)"
  echo "  2. Log into Rauthy and create OIDC clients:"
  echo "     - SPA client (public, authorization_code, redirect: https://${DOMAIN}/auth/callback)"
  echo "     - M2M client (confidential, client_credentials, scope: deployd:deploy)"
  echo "     - Server client (confidential, for backend OIDC)"
  echo "     - statecraft-knowledge-sweeper-m2m-app (confidential, client_credentials)"
  echo "       Default Scopes: platform:knowledge:sweep   (spec 143 FR-010 + §12 L-006:"
  echo "       Rauthy 0.35 client_credentials mints Default Scopes regardless of scope=,"
  echo "       so Allowed Scopes alone is silently inert. Default Scopes is load-bearing.)"
  echo "       Fill STATECRAFT_KNOWLEDGE_SWEEPER_CLIENT_ID/_SECRET in .env."
  echo "     - statecraft-factory-sweeper-m2m-app (confidential, client_credentials)"
  echo "       Default Scopes: platform:factory:sweep   (spec 224, same L-006 rule:"
  echo "       the scope MUST be a Default Scope, not just an Allowed Scope, or the"
  echo "       minted JWT will silently lack it.)"
  echo "       Fill STATECRAFT_FACTORY_SWEEPER_CLIENT_ID/_SECRET in .env."
  echo "       (A future spec adds statecraft-audit-sweeper-m2m-app for the"
  echo "        remaining spec 115/087 sweeper legs; .env carries the slot.)"
  echo "  3. Create the GitHub OAuth App for Rauthy at https://github.com/settings/developers"
  echo "     (GITHUB_UPSTREAM_CLIENT_ID/_SECRET, spec 106)"
  echo "        - Homepage: https://auth.${DOMAIN}"
  echo "        - Callback: https://auth.${DOMAIN}/auth/v1/providers/callback"
  echo "  3a. (Optional, spec 137 federated upstream) Google upstream Auth Provider"
  echo "     for tenant gates. Create the Google OAuth client at"
  echo "     https://console.cloud.google.com/auth/clients and store the"
  echo "     credentials in .env as GOOGLE_UPSTREAM_CLIENT_ID/_SECRET."
  echo "     Then register the provider in Rauthy admin UI:"
  echo "        - URL:       https://auth.${DOMAIN}/auth/v1/admin/providers"
  echo "        - Type:      Google"
  echo "        - Issuer:    https://accounts.google.com"
  echo "        - Client ID: \$GOOGLE_UPSTREAM_CLIENT_ID"
  echo "        - Secret:    \$GOOGLE_UPSTREAM_CLIENT_SECRET"
  echo "        - Callback:  https://auth.${DOMAIN}/auth/v1/providers/callback"
  echo "     (Auto-provisioning the provider via the admin API is tracked as"
  echo "      a spec 106 follow-up; the .env values are loaded but currently"
  echo "      surfaced only as this manual instruction.)"
  echo "  4. Create GitHub App at https://github.com/settings/apps/new"
  echo "     - Webhook URL: https://${DOMAIN}/api/github/webhook"
  echo "     - Webhook secret: $GITHUB_WEBHOOK_SECRET"
  echo "     - Store private key as base64:"
  echo "       base64 -i private-key.pem  (macOS)"
  echo "       base64 -w0 private-key.pem (Linux)"
  echo "  5. Fill in the values in .env, then re-run:"
  echo "     ./setup.sh"
  echo ""
  echo "Missing values:"
  for m in "${MISSING[@]}"; do
    echo "  - $m"
  done
  echo ""
  exit 0
fi

# ---------------------------------------------------------------------------
# Phase 2: Create statecraft secrets + deploy all services
# ---------------------------------------------------------------------------
info "Phase 2: All values present — deploying full platform"

STATECRAFT_DB_URL="postgres://statecraft:${POSTGRES_PASSWORD}@postgresql.statecraft-system:5432/statecraft?sslmode=disable"

# Decode base64-encoded GitHub App private key
GITHUB_APP_PRIVATE_KEY=$(echo "$GITHUB_APP_PRIVATE_KEY_B64" | base64 -d 2>/dev/null) \
  || err "GITHUB_APP_PRIVATE_KEY_B64 is not valid base64. Encode with: base64 -i private-key.pem"

# Create GHCR image-pull secrets (required for pulling from private ghcr.io)
if [ -n "${GHCR_PAT:-}" ]; then
  info "Creating GHCR image-pull secrets..."
  for ns_secret in "statecraft-system/ghcr-credentials" "deployd-system/ghcr-pull-secret"; do
    ns="${ns_secret%%/*}"
    secret_name="${ns_secret##*/}"
    kubectl create secret docker-registry "$secret_name" \
      --namespace "$ns" \
      --docker-server=ghcr.io \
      --docker-username=oap \
      --docker-password="$GHCR_PAT" \
      --dry-run=client -o yaml | kubectl apply -f -
  done

  # Spec 214 FR-005 / SC-005 (deferred at 214 close, completed here):
  # reflector-source private-image pull secret. deployd-api renders
  # imagePullSecrets:[ghcr-pull] on every tenant Deployment (helm.rs) and
  # creates the namespace with --create-namespace, but never the secret, so a
  # tenant pod cannot pull its private GHCR image (an unauthenticated pull
  # returns NotFound because GHCR masks private packages). Materialise the
  # manifest's kube-system source so kubernetes-reflector auto-clones
  # `ghcr-pull` into every namespace, mirroring tenants-wildcard-tls. Build the
  # base64 dockerconfigjson and sed-substitute it (avoids an envsubst
  # dependency; base64 contains no `|` so the delimiter is safe).
  info "Materialising ghcr-pull reflector source secret (spec 214 FR-005)..."
  GHCR_REG_AUTH=$(printf 'oap:%s' "$GHCR_PAT" | base64 | tr -d '\n')
  GHCR_PULL_DOCKERCONFIGJSON=$(printf '{"auths":{"ghcr.io":{"auth":"%s"}}}' "$GHCR_REG_AUTH" | base64 | tr -d '\n')
  sed "s|\${GHCR_PULL_DOCKERCONFIGJSON}|${GHCR_PULL_DOCKERCONFIGJSON}|g" \
    "$SCRIPT_DIR/manifests/ghcr-pull-secret.yaml" | kubectl apply -f -
  ok "ghcr-pull source applied in kube-system; reflector clones it into tenant namespaces."
else
  warn "GHCR_PAT not set — skipping image-pull secrets (pods won't be able to pull from ghcr.io)"
fi

# Spec 137: statecraft's deploy path refuses a gate-enabled tenant deploy
# unless RAUTHY_ISSUER_URL is set (it forwards the issuer to the tenant's
# oauth2-proxy). oauth2-proxy uses --oidc-issuer-url as BOTH the discovery
# base AND the expected issuer, and validates the returned claim exactly, so
# the value must be the full Rauthy issuer "<RAUTHY_URL>/auth/v1/" (with the
# /auth/v1/ path and trailing slash), not the bare host. (deployd-api's own
# M2M path reads the issuer from the discovery document, which is why its
# bare OIDC_ENDPOINT works; the gate proxy cannot.) Overridable via env.
RAUTHY_ISSUER_URL="${RAUTHY_ISSUER_URL:-${RAUTHY_URL%/}/auth/v1/}"

info "Creating statecraft-api-secrets..."
kubectl create secret generic statecraft-api-secrets \
  --namespace statecraft-system \
  --from-literal=DOMAIN="$DOMAIN" \
  --from-literal=APP_BASE_URL="$APP_BASE_URL" \
  --from-literal=SESSION_SECRET="$SESSION_SECRET" \
  --from-literal=OIDC_SPA_CLIENT_ID="$OIDC_SPA_CLIENT_ID" \
  --from-literal=OIDC_M2M_CLIENT_ID="$OIDC_M2M_CLIENT_ID" \
  --from-literal=OIDC_M2M_CLIENT_SECRET="$OIDC_M2M_CLIENT_SECRET" \
  --from-literal=RAUTHY_URL="$RAUTHY_URL" \
  --from-literal=RAUTHY_ISSUER_URL="$RAUTHY_ISSUER_URL" \
  --from-literal=RAUTHY_CLIENT_ID="$RAUTHY_CLIENT_ID" \
  --from-literal=RAUTHY_CLIENT_SECRET="$RAUTHY_CLIENT_SECRET" \
  --from-literal=RAUTHY_ADMIN_TOKEN="$RAUTHY_ADMIN_TOKEN" \
  --from-literal=GITHUB_UPSTREAM_CLIENT_ID="$GITHUB_UPSTREAM_CLIENT_ID" \
  --from-literal=GITHUB_UPSTREAM_CLIENT_SECRET="$GITHUB_UPSTREAM_CLIENT_SECRET" \
  --from-literal=GITHUB_APP_ID="$GITHUB_APP_ID" \
  --from-literal=GITHUB_APP_PRIVATE_KEY="$GITHUB_APP_PRIVATE_KEY" \
  --from-literal=GITHUB_WEBHOOK_SECRET="$GITHUB_WEBHOOK_SECRET" \
  --from-literal=POSTGRES_PASSWORD="$POSTGRES_PASSWORD" \
  --from-literal=STATECRAFT_DB_URL="$STATECRAFT_DB_URL" \
  --from-literal=SLACK_WEBHOOK_URL="${SLACK_WEBHOOK_URL:-}" \
  --from-literal=S3_ENDPOINT="http://minio.statecraft-system.svc.cluster.local:9000" \
  --from-literal=S3_PUBLIC_ENDPOINT="${S3_PUBLIC_ENDPOINT:-https://minio.${DOMAIN}}" \
  --from-literal=S3_REGION="us-east-1" \
  --from-literal=S3_ACCESS_KEY="$MINIO_ROOT_USER" \
  --from-literal=S3_SECRET_KEY="$MINIO_ROOT_PASSWORD" \
  --dry-run=client -o yaml | kubectl apply -f -

# Spec 143 FR-010 — per-purpose-credential mount discipline.
# `statecraft-knowledge-sweeper-credentials` is the SOLE Secret the
# orphan-imported sweeper CronJob mounts. Materialised here directly
# (Hetzner uses `secrets.provider: "k8s"`); cloud deployments that
# enable ESO will get the same Secret name + key shape from the
# `external-secret-knowledge-sweeper.yaml` chart template instead.
# A leaked credential here is bounded to one Rauthy client's surface.
# FU-003 will add sibling Secrets for spec 115 / 087 / 124 sweepers,
# each separate, no cross-purpose mounts.
info "Creating statecraft-knowledge-sweeper-credentials..."
kubectl create secret generic statecraft-knowledge-sweeper-credentials \
  --namespace statecraft-system \
  --from-literal=CLIENT_ID="$STATECRAFT_KNOWLEDGE_SWEEPER_CLIENT_ID" \
  --from-literal=CLIENT_SECRET="$STATECRAFT_KNOWLEDGE_SWEEPER_CLIENT_SECRET" \
  --dry-run=client -o yaml | kubectl apply -f -

# Spec 224 FR-004: per-purpose-credential mount discipline for the
# factory-runs sweeper. `statecraft-factory-sweeper-credentials` is the SOLE
# Secret the factory-runs sweeper CronJob mounts. Same shape and rationale as
# the knowledge sweeper Secret above (separate Rauthy client, no cross-purpose
# mount). Cloud deployments that enable ESO get the same Secret name + key
# shape from the `external-secret-factory-sweeper.yaml` chart template instead.
info "Creating statecraft-factory-sweeper-credentials..."
kubectl create secret generic statecraft-factory-sweeper-credentials \
  --namespace statecraft-system \
  --from-literal=CLIENT_ID="$STATECRAFT_FACTORY_SWEEPER_CLIENT_ID" \
  --from-literal=CLIENT_SECRET="$STATECRAFT_FACTORY_SWEEPER_CLIENT_SECRET" \
  --dry-run=client -o yaml | kubectl apply -f -

info "Refreshing statecraft pods to pick up new secrets..."
# Spec 143 §12 L-003 — CD owns the statecraft helm release. setup.sh
# does NOT helm-upgrade statecraft because doing so applied
# values-hetzner.yaml's `tag: latest` which clobbered CD's
# sha-pinned tag and caused a stale-pod-against-forward-DB
# regression on 2026-05-08. Single writer for the helm field-manager
# surface; restart is the right verb for "secrets rotated, re-read".
if kubectl get deploy statecraft-api -n statecraft-system >/dev/null 2>&1; then
  kubectl rollout restart deploy/statecraft-api -n statecraft-system
  kubectl rollout status deploy/statecraft-api -n statecraft-system --timeout=600s
  ok "statecraft-api rollout complete"
else
  warn "statecraft-api deployment not yet provisioned (fresh cluster). CD will create it on first push to main; re-run setup.sh after CD lands to refresh secrets."
fi

info "Refreshing deployd-api pods to pick up new secrets..."
# Spec 143 §12 L-003 / FU-002 closure — CD owns the deployd-api helm
# release (cd-deployd-api-rs.yml deploys with sha-pinned image.tag).
# setup.sh does NOT helm-upgrade deployd-api because doing so would
# apply values-hetzner.yaml's `tag: latest` and clobber CD's sha-pin —
# the same dual-writer shape L-003 documents for statecraft. Single
# writer for the helm field-manager surface; restart is the right verb
# for "HIQLITE_SECRET_* rotated, re-read". The values-hetzner.yaml
# `tag: latest` line is now latent (no active racer); a future spec
# can mirror L-003's chart-side hardening (remove `tag:`, add
# `pullPolicy: Always`) as defence-in-depth.
if kubectl get deploy deployd-api -n deployd-system >/dev/null 2>&1; then
  kubectl rollout restart deploy/deployd-api -n deployd-system
  kubectl rollout status deploy/deployd-api -n deployd-system --timeout=600s
  ok "deployd-api rollout complete"
else
  warn "deployd-api deployment not yet provisioned (fresh cluster). CD will create it on first push to main touching platform/services/deployd-api-rs/** or platform/charts/deployd-api/** (or workflow_dispatch with deploy=true); re-run setup.sh after CD lands to refresh secrets."
fi

# ---------------------------------------------------------------------------
# Sync secrets to GitHub Actions (if gh CLI is available)
# ---------------------------------------------------------------------------
if command -v gh >/dev/null 2>&1 && gh auth status >/dev/null 2>&1; then
  info "Syncing secrets to GitHub Actions..."
  KUBECONFIG_B64=$(base64 < "$KUBECONFIG_PATH" | tr -d '\n')

  # Pin --repo so multiple git remotes don't trigger an interactive picker.
  GH_REPO="${GH_REPO:-statecrafting/open-agentic-platform}"

  gh secret set KUBECONFIG_HETZNER --repo "$GH_REPO" --body "$KUBECONFIG_B64" 2>/dev/null && ok "KUBECONFIG_HETZNER synced" || warn "Failed to sync KUBECONFIG_HETZNER"
  gh secret set WEBHOOK_SECRET --repo "$GH_REPO" --body "$GITHUB_WEBHOOK_SECRET" 2>/dev/null && ok "WEBHOOK_SECRET synced" || warn "Failed to sync WEBHOOK_SECRET"

  if [ -n "${GHCR_PAT:-}" ]; then
    gh secret set GHCR_PAT --repo "$GH_REPO" --body "$GHCR_PAT" 2>/dev/null && ok "GHCR_PAT synced" || warn "Failed to sync GHCR_PAT"
  fi
else
  warn "gh CLI not available or not authenticated — skipping GitHub Actions secret sync"
  echo "  To sync manually:"
  echo "    gh secret set KUBECONFIG_HETZNER --repo statecrafting/open-agentic-platform < <(base64 < $KUBECONFIG_PATH)"
  echo "    gh secret set WEBHOOK_SECRET --repo statecrafting/open-agentic-platform --body \"\$GITHUB_WEBHOOK_SECRET\""
  echo "    gh secret set GHCR_PAT --repo statecrafting/open-agentic-platform --body \"\$GHCR_PAT\""
fi

# ---------------------------------------------------------------------------
# Done
# ---------------------------------------------------------------------------
echo ""
echo "============================================"
echo "  OAP Platform Live on Hetzner"
echo "============================================"
echo ""
echo "  Statecraft:  https://${DOMAIN}"
echo "  Deployd API: https://deploy.${DOMAIN}"
echo "  Rauthy OIDC: https://auth.${DOMAIN}"
echo ""
echo "  Tear down:   hetzner-k3s delete --config $SCRIPT_DIR/cluster.yaml"
echo ""
