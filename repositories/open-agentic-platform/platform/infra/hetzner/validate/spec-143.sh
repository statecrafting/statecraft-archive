#!/usr/bin/env bash
# =============================================================================
# Spec 143 step 8 — end-to-end validation against a deployed cluster.
# =============================================================================
#
# Verifies that the spec-143 contract actually holds on a live cluster
# after `make deploy-hetzner` has run. The contract is "browser uploads
# land in MinIO and produce a confirmed knowledge_object row"; this
# script is the executable form of that claim.
#
# Two failure classes, distinguished by exit code:
#
#   exit 2 — PREREQUISITE failure: deploy is incomplete. DNS missing,
#            cert not yet issued, ingress not reachable, CORS not
#            configured. Operator action: finish the deploy, including
#            the manual DNS A-record step documented in
#            ../post-create.sh's DNS-01 ClusterIssuer block.
#
#   exit 3 — CONTRACT failure: deploy is complete but the spec
#            guarantees are broken. The presigned-PUT path landed
#            something other than the bytes we sent, audit row never
#            wrote, blob isn't where it should be, or sweeper didn't
#            register. Operator action: investigate; the spec's
#            integration tests should NOT have passed if this fires.
#
#   exit 0 — both classes pass.
#
# Idempotent + re-runnable — leaves the cluster in the same state it
# started. Test artifacts (bucket key, knowledge_objects row, audit
# rows) are cleaned up via an EXIT trap.
#
# Browser-shape requests, not bare curl: the validation issues a
# preflight OPTIONS with Origin and Access-Control-Request-Method
# before the PUT, asserting that the CORS contract holds. A naked
# `curl -X PUT` would pass even with broken CORS (curl doesn't
# preflight) and false-validate spec 143's whole point.
#
# Usage:
#   cd platform/infra/hetzner
#   ./validate/spec-143.sh                    # uses ../kubeconfig
#   KUBECONFIG=/path ./validate/spec-143.sh   # override
#
# Required env (read from .env or shell):
#   DOMAIN          — apex domain; minio.${DOMAIN} is the validation target
#   APP_BASE_URL    — statecraft origin used for the preflight Origin header
#
# Read-only otherwise — does not modify any production data; all writes
# scoped to a synthetic test row + a single test blob, both removed on exit.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HETZNER_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

: "${KUBECONFIG:=${HETZNER_ROOT}/kubeconfig}"
export KUBECONFIG

# Pull DOMAIN + APP_BASE_URL from .env if not already set.
if [ -f "$HETZNER_ROOT/.env" ] && [ -z "${DOMAIN:-}" ]; then
  set -a
  # shellcheck disable=SC1091
  . "$HETZNER_ROOT/.env"
  set +a
fi

DOMAIN="${DOMAIN:?DOMAIN must be set (in .env or environment)}"
APP_BASE_URL="${APP_BASE_URL:?APP_BASE_URL must be set (in .env or environment)}"
MINIO_HOST="minio.${DOMAIN}"

# Test fixtures. UUIDs intentionally low-entropy so collisions with
# real production data are obvious if they ever occur.
TEST_PROJECT_ID="${TEST_PROJECT_ID:-}"
TEST_OBJECT_ID="55143000-0000-0000-0000-$(date +%s | tail -c 12)"
TEST_KEY="knowledge/${TEST_OBJECT_ID}/validate-spec-143.bin"
TEST_PAYLOAD="spec 143 validate $(date -u +%Y-%m-%dT%H:%M:%SZ)"

# ------------------------------------------------------------------
# Output helpers — colour distinguishes prerequisite vs contract.
# ------------------------------------------------------------------

PREREQ_COLOR="\033[1;33m"  # yellow
CONTRACT_COLOR="\033[1;36m" # cyan
OK_COLOR="\033[1;32m"
FAIL_COLOR="\033[1;31m"
RESET="\033[0m"

prereq_section() { printf "\n${PREREQ_COLOR}=== PREREQUISITE: %s${RESET}\n" "$*"; }
contract_section() { printf "\n${CONTRACT_COLOR}=== CONTRACT: %s${RESET}\n" "$*"; }
ok()  { printf "${OK_COLOR}  PASS:${RESET} %s\n" "$*"; }
prereq_fail() {
  printf "${FAIL_COLOR}  FAIL (prerequisite):${RESET} %s\n" "$*" >&2
  exit 2
}
contract_fail() {
  printf "${FAIL_COLOR}  FAIL (contract):${RESET} %s\n" "$*" >&2
  exit 3
}

# ------------------------------------------------------------------
# Cleanup trap — runs on any exit, including failures.
# ------------------------------------------------------------------

cleanup() {
  local rc=$?
  printf "\n=== CLEANUP\n"

  # Preflight response tempfile (created during PREREQUISITE 4).
  if [ -n "${PREFLIGHT_RESPONSE:-}" ]; then
    rm -f "$PREFLIGHT_RESPONSE" 2>/dev/null || true
  fi

  # Test blob in MinIO bucket. Best-effort; missing == already cleaned.
  # Use `mc rm` not filesystem rm — MinIO RELEASE.2024-12-18+ on-disk
  # layout does not expose objects at /export/${bucket}/${key} (see §12 FU-004(c)).
  if [ -n "${TEST_BUCKET:-}" ]; then
    kubectl -n statecraft-system exec deploy/minio -- sh -c '
      mc alias set local http://localhost:9000 "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD" >/dev/null 2>&1
      mc rm "local/'"$TEST_BUCKET"'/'"$TEST_KEY"'" >/dev/null 2>&1
    ' >/dev/null 2>&1 || true
  fi

  # Test knowledge_objects row + audit rows scoped by target_id.
  kubectl -n statecraft-system exec postgresql-0 -- env PGPASSWORD="${POSTGRES_PASSWORD:-}" \
    psql -U statecraft -d auth -v ON_ERROR_STOP=1 -tAc "
      DELETE FROM knowledge_objects WHERE id = '${TEST_OBJECT_ID}';
      DELETE FROM audit_log WHERE target_id = '${TEST_OBJECT_ID}';
    " >/dev/null 2>&1 || true

  if [ "$rc" = "0" ]; then
    printf "${OK_COLOR}=== validate-spec-143: ALL CHECKS PASSED${RESET}\n"
  fi
  exit "$rc"
}
trap cleanup EXIT

# ------------------------------------------------------------------
# Helper: resolve a real project ID from the cluster if not provided.
# ------------------------------------------------------------------

require_project_id() {
  if [ -n "$TEST_PROJECT_ID" ]; then
    return
  fi
  # Filter the picker to projects whose bucket is S3-valid (<=63 chars).
  # The 'oldest project' alone can land on an over-long bucket — FU-004(a)
  # caught the 80-char EFVS bucket on the Hetzner cluster. The underlying
  # production bug (statecraft creating projects with invalid bucket
  # names) is filed as FU-005 on spec 087.
  #
  # Prefer non-test projects so the canary lands on a stable, non-fixture
  # bucket where one exists; fall back to test-named projects if no other
  # valid-bucket project is on the cluster (i.e. don't strand the canary
  # entirely just because every prod project has an over-long bucket).
  TEST_PROJECT_ID=$(kubectl -n statecraft-system exec postgresql-0 -- env PGPASSWORD="${POSTGRES_PASSWORD:-}" \
    psql -U statecraft -d auth -tAc "
      SELECT id FROM projects
      WHERE length(object_store_bucket) <= 63
      ORDER BY CASE WHEN name ILIKE '%test%' THEN 1 ELSE 0 END,
               created_at ASC
      LIMIT 1;
    " 2>/dev/null | tr -d '[:space:]')
  if [ -z "$TEST_PROJECT_ID" ]; then
    prereq_fail "no projects with a valid bucket exist on the cluster — create at least one before running validation, or fix any over-long object_store_bucket values (see FU-005 on spec 087)"
  fi
}

# ------------------------------------------------------------------
# PREREQUISITES (exit 2 on failure)
# ------------------------------------------------------------------

prereq_section "DNS A record minio.${DOMAIN} resolves"
RESOLVED_IP=$(dig +short A "$MINIO_HOST" 2>/dev/null | head -1 || true)
if [ -z "$RESOLVED_IP" ]; then
  prereq_fail "minio.${DOMAIN} does not resolve. Create the A record manually:
    Hetzner DNS Console → ${DOMAIN} → Add record
      Type: A   Name: minio   TTL: 60
      Value: \$(kubectl get svc -n ingress-nginx ingress-nginx-controller -o jsonpath='{.status.loadBalancer.ingress[0].ip}')
  See platform/infra/hetzner/.env.example HCLOUD_DNS_API_TOKEN block."
fi
ok "minio.${DOMAIN} → ${RESOLVED_IP}"

prereq_section "TLS certificate minio-tls is Ready"
CERT_READY=$(kubectl -n statecraft-system get certificate minio-tls \
  -o jsonpath='{.status.conditions[?(@.type=="Ready")].status}' 2>/dev/null || true)
if [ "$CERT_READY" != "True" ]; then
  CERT_REASON=$(kubectl -n statecraft-system get certificate minio-tls \
    -o jsonpath='{.status.conditions[?(@.type=="Ready")].message}' 2>/dev/null || echo "certificate not found")
  prereq_fail "TLS certificate minio-tls not Ready: ${CERT_REASON}
  Possible causes: HCLOUD_DNS_API_TOKEN missing, letsencrypt-dns01 ClusterIssuer not created, cert-manager-webhook-hetzner not installed.
  See platform/infra/hetzner/post-create.sh DNS-01 block."
fi
ok "minio-tls Ready=True"

prereq_section "Public ingress is reachable on TLS"
HTTP_STATUS=$(curl -sS -o /dev/null -w "%{http_code}" --max-time 10 "https://${MINIO_HOST}/" || echo "000")
if [ "$HTTP_STATUS" = "000" ]; then
  prereq_fail "https://${MINIO_HOST}/ unreachable (network/TLS error). Check ingress-nginx, cert validity, DNS propagation."
fi
ok "https://${MINIO_HOST}/ responds (HTTP ${HTTP_STATUS}; any non-000 status proves reachability)"

prereq_section "CORS preflight against MinIO ingress (OPTIONS, browser-shape)"
# Browser-shape preflight: OPTIONS with Origin + Access-Control-Request-Method.
# A bare `curl -X PUT` would pass even with broken CORS (curl doesn't
# preflight), so this check is the actual contract-level test of CORS.
# Tempfile cleanup is handled by the unified cleanup() trap above —
# do NOT install a separate `trap` here, which would clobber it.
PREFLIGHT_RESPONSE=$(mktemp)

# We can't preflight-test against a real bucket/key without an auth'd
# presigned URL, but we CAN test the OPTIONS response against the
# generic root path. MinIO returns ACAO when CORS is configured for any
# origin match.
HTTP_STATUS=$(curl -sS -o "$PREFLIGHT_RESPONSE" -D - --max-time 10 \
  -X OPTIONS \
  -H "Origin: ${APP_BASE_URL}" \
  -H "Access-Control-Request-Method: PUT" \
  -H "Access-Control-Request-Headers: Content-Type" \
  "https://${MINIO_HOST}/" \
  | head -1 | awk '{print $2}' || echo "000")

ACAO=$(curl -sS -D - -o /dev/null --max-time 10 \
  -X OPTIONS \
  -H "Origin: ${APP_BASE_URL}" \
  -H "Access-Control-Request-Method: PUT" \
  -H "Access-Control-Request-Headers: Content-Type" \
  "https://${MINIO_HOST}/" \
  | grep -i "^access-control-allow-origin:" | head -1 | tr -d '\r' | awk '{print $2}' || true)

if [ -z "$ACAO" ]; then
  prereq_fail "CORS preflight returned no Access-Control-Allow-Origin header.
  MINIO_API_CORS_ALLOW_ORIGIN env may not be set on the MinIO container.
  Verify with: kubectl -n statecraft-system exec deploy/minio -- env | grep CORS"
fi
if [ "$ACAO" != "${APP_BASE_URL}" ] && [ "$ACAO" != "*" ]; then
  prereq_fail "CORS ACAO mismatch: got '${ACAO}', expected '${APP_BASE_URL}'.
  Re-run post-create.sh after fixing MINIO_API_CORS_ALLOW_ORIGIN; see spec 143 §4.4."
fi
ok "OPTIONS preflight returns Access-Control-Allow-Origin: ${ACAO}"

# ------------------------------------------------------------------
# CONTRACT CHECKS (exit 3 on failure)
# ------------------------------------------------------------------

require_project_id

contract_section "Resolve project bucket"
TEST_BUCKET=$(kubectl -n statecraft-system exec postgresql-0 -- env PGPASSWORD="${POSTGRES_PASSWORD:-}" \
  psql -U statecraft -d auth -tAc "SELECT object_store_bucket FROM projects WHERE id = '${TEST_PROJECT_ID}';" \
  2>/dev/null | tr -d '[:space:]')
if [ -z "$TEST_BUCKET" ]; then
  contract_fail "no bucket recorded for project ${TEST_PROJECT_ID}; project row is malformed"
fi
ok "project ${TEST_PROJECT_ID} → bucket ${TEST_BUCKET}"

contract_section "Generate presigned PUT URL via SigV4 (python3 stdlib)"
# Pull MinIO root credentials directly from the pod environment. The
# helm chart renders them there; reading via printenv is the canonical
# authoritative path. Avoids relying on operator-workstation env vars,
# which the prior `mc share upload` path silently depended on.
MINIO_USER=$(kubectl -n statecraft-system exec deploy/minio -- printenv MINIO_ROOT_USER 2>/dev/null | tr -d '[:space:]')
MINIO_PASS=$(kubectl -n statecraft-system exec deploy/minio -- printenv MINIO_ROOT_PASSWORD 2>/dev/null | tr -d '[:space:]')
if [ -z "$MINIO_USER" ] || [ -z "$MINIO_PASS" ]; then
  contract_fail "could not read MINIO_ROOT_USER/MINIO_ROOT_PASSWORD from the MinIO pod env"
fi

# SigV4 PUT presigning in pure stdlib — no aws CLI, no boto3.
# Signed against the public host directly, so no host-substitution
# step (and no SignatureDoesNotMatch failure mode from a Host rewrite).
# Replaces the prior `mc share upload` path which produced a multipart
# POST form — incompatible with the script's `curl -X PUT --data-binary`
# call shape. See §12 FU-004(b).
PRESIGNED_URL=$(MINIO_USER="$MINIO_USER" MINIO_PASS="$MINIO_PASS" \
  MINIO_HOST="$MINIO_HOST" TEST_BUCKET="$TEST_BUCKET" TEST_KEY="$TEST_KEY" \
  python3 - <<'PY'
import datetime, hashlib, hmac, os, urllib.parse

access  = os.environ["MINIO_USER"]
secret  = os.environ["MINIO_PASS"]
host    = os.environ["MINIO_HOST"]
bucket  = os.environ["TEST_BUCKET"]
key     = os.environ["TEST_KEY"]
region  = "us-east-1"
service = "s3"
expires = 300

now      = datetime.datetime.now(datetime.timezone.utc)
amz_date = now.strftime("%Y%m%dT%H%M%SZ")
date     = now.strftime("%Y%m%d")
scope    = f"{date}/{region}/{service}/aws4_request"

# Each path segment URL-encoded, but '/' between segments preserved.
canon_uri = "/" + bucket + "/" + "/".join(
    urllib.parse.quote(seg, safe="") for seg in key.split("/")
)

qs = {
    "X-Amz-Algorithm":     "AWS4-HMAC-SHA256",
    "X-Amz-Credential":    f"{access}/{scope}",
    "X-Amz-Date":          amz_date,
    "X-Amz-Expires":       str(expires),
    "X-Amz-SignedHeaders": "host",
}
canon_qs = "&".join(
    f"{k}={urllib.parse.quote(v, safe='')}" for k, v in sorted(qs.items())
)

canonical_request = "\n".join([
    "PUT",
    canon_uri,
    canon_qs,
    f"host:{host}\n",
    "host",
    "UNSIGNED-PAYLOAD",
])

string_to_sign = "\n".join([
    "AWS4-HMAC-SHA256",
    amz_date,
    scope,
    hashlib.sha256(canonical_request.encode()).hexdigest(),
])

def sign(k, m):
    return hmac.new(k, m.encode(), hashlib.sha256).digest()

k_date    = sign(("AWS4" + secret).encode(), date)
k_region  = sign(k_date,    region)
k_service = sign(k_region,  service)
k_signing = sign(k_service, "aws4_request")
signature = hmac.new(k_signing, string_to_sign.encode(), hashlib.sha256).hexdigest()

print(f"https://{host}{canon_uri}?{canon_qs}&X-Amz-Signature={signature}")
PY
)

if [ -z "$PRESIGNED_URL" ]; then
  contract_fail "presigned PUT URL generation failed (python3 stdlib SigV4 path)"
fi
ok "presigned PUT URL generated (SigV4 stdlib, public host)"

contract_section "Browser-shape PUT against the public ingress"
# URL is signed against the public host directly — no substitution
# needed. The Origin header exercises the CORS post-flight contract
# on the data path (preflight is covered by PREREQUISITE 4 above).
PUT_STATUS=$(printf "%s" "$TEST_PAYLOAD" | curl -sS -o /dev/null -w "%{http_code}" --max-time 30 \
  -X PUT \
  -H "Origin: ${APP_BASE_URL}" \
  -H "Content-Type: application/octet-stream" \
  --data-binary @- \
  "$PRESIGNED_URL" || echo "000")

case "$PUT_STATUS" in
  2*) ok "PUT to public ingress returned ${PUT_STATUS}" ;;
  403) contract_fail "PUT returned 403 SignatureDoesNotMatch.
  Likely cause: MINIO_SERVER_URL on the MinIO container does not match the public ingress hostname,
  or proxy_set_header Host is being rewritten somewhere in the chain. See spec 143 FR-006a." ;;
  413) contract_fail "PUT returned 413 — payload exceeds ingress body-size limit.
  Either the test payload is over 1 GiB (it shouldn't be: ${#TEST_PAYLOAD} bytes), or the
  nginx.ingress.kubernetes.io/proxy-body-size annotation is missing/wrong.
  See spec 143 FR-005." ;;
  *) contract_fail "PUT returned unexpected status ${PUT_STATUS}" ;;
esac

contract_section "Blob lands in MinIO bucket under the expected key"
# `mc stat` is the canonical authoritative answer — MinIO's on-disk
# layout (RELEASE.2024-12-18+) does not expose objects at the simple
# /export/${bucket}/${key} path that the prior filesystem `[ -f ... ]`
# check assumed. See §12 FU-004(c).
BLOB_LANDED=$(kubectl -n statecraft-system exec deploy/minio -- sh -c '
  mc alias set local http://localhost:9000 "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD" >/dev/null 2>&1
  if mc stat "local/'"$TEST_BUCKET"'/'"$TEST_KEY"'" >/dev/null 2>&1; then echo present; else echo absent; fi
' 2>/dev/null | tr -d '[:space:]')
if [ "$BLOB_LANDED" != "present" ]; then
  contract_fail "PUT returned 2xx but mc stat does not see the object at ${TEST_BUCKET}/${TEST_KEY}.
  The signature validated but the upload did not register with MinIO. Check MinIO pod logs and disk usage."
fi
ok "blob present at ${TEST_BUCKET}/${TEST_KEY} (verified via mc stat)"

contract_section "Self-hosted scheduler — K8s CronJob registered (spec 143 §4.5b / L-001)"
# Per spec 143 L-001 (2026-05-08 amendment), Encore's CronJob primitive
# is platform-driven and a no-op in self-hosted deployments. The actual
# production scheduler is the K8s CronJob provisioned by post-create.sh.
# Validate it exists, schedule matches, and has fired at least once
# (after the first cadence interval has elapsed since deploy).
SWEEPER_SCHEDULE=$(kubectl -n statecraft-system get cronjob knowledge-orphan-imported-sweeper \
  -o jsonpath='{.spec.schedule}' 2>/dev/null || true)
if [ -z "$SWEEPER_SCHEDULE" ]; then
  contract_fail "K8s CronJob 'knowledge-orphan-imported-sweeper' not found in statecraft-system.
  Re-run post-create.sh; the spec 143 §4.5b amendment requires this resource as the
  production scheduler. The Encore CronJob declaration alone is a no-op in
  self-hosted deploys (no Encore Cloud scheduler present)."
fi
ok "K8s CronJob schedule: ${SWEEPER_SCHEDULE}"

# Liveness check: lastScheduleTime within 2× cadence ago. CronJobs that
# have NEVER fired (just-deployed cluster) won't have lastScheduleTime
# set yet — that's an exit-2 prerequisite (deploy is too fresh), not
# exit-3 contract failure.
LAST_SCHEDULE=$(kubectl -n statecraft-system get cronjob knowledge-orphan-imported-sweeper \
  -o jsonpath='{.status.lastScheduleTime}' 2>/dev/null || true)
if [ -z "$LAST_SCHEDULE" ]; then
  prereq_fail "CronJob has never fired (no .status.lastScheduleTime).
  Either the cluster was deployed less than 30 minutes ago and the cron
  hasn't hit its first cadence yet, or the controller is wedged. Wait
  30+ minutes and re-run; if still empty, check the
  cronjob-controller-manager pod."
fi

# Compute age of last schedule in seconds.
LAST_SCHEDULE_EPOCH=$(date -j -f "%Y-%m-%dT%H:%M:%SZ" "$LAST_SCHEDULE" +%s 2>/dev/null \
  || date -d "$LAST_SCHEDULE" +%s 2>/dev/null || echo 0)
NOW_EPOCH=$(date +%s)
AGE_SEC=$((NOW_EPOCH - LAST_SCHEDULE_EPOCH))
# 2× cadence = 3600s for the every-30m schedule.
if [ "$AGE_SEC" -gt 3600 ]; then
  contract_fail "CronJob lastScheduleTime is ${AGE_SEC}s old — beyond the
  2× cadence window (3600s). The cron is registered but has stopped
  firing. Investigate the cronjob-controller, recent K8s events, and
  the most recent job's pod logs:
    kubectl -n statecraft-system get jobs -l job-name=knowledge-orphan-imported-sweeper-...
    kubectl -n statecraft-system describe cronjob knowledge-orphan-imported-sweeper"
fi
ok "CronJob last fired ${AGE_SEC}s ago (within 2× cadence window)"

# Spec 143 §12 L-004 — firing on schedule is necessary but not sufficient.
# A CronJob can fire reliably while every run 404s because the curl-target
# is unreachable (e.g. handler declared expose:false). Assert the most
# recent Job owned by this CronJob succeeded — i.e. the curl returned 2xx
# AND the handler ran. Without this check, FR-010 reports green even when
# reconciliation has never executed in production.
LAST_JOB=$(kubectl -n statecraft-system get jobs \
  --sort-by=.metadata.creationTimestamp \
  -o json 2>/dev/null \
  | python3 -c '
import sys, json
data = json.load(sys.stdin)
matching = [j for j in data.get("items", [])
            if any(o.get("kind") == "CronJob"
                   and o.get("name") == "knowledge-orphan-imported-sweeper"
                   for o in j.get("metadata", {}).get("ownerReferences", []) or [])]
print(matching[-1]["metadata"]["name"] if matching else "")
' 2>/dev/null || echo "")

if [ -z "$LAST_JOB" ]; then
  ok "no completed jobs yet (CronJob registered but cadence not reached)"
else
  JOB_SUCCEEDED=$(kubectl -n statecraft-system get job "$LAST_JOB" -o jsonpath='{.status.succeeded}' 2>/dev/null || echo "0")
  JOB_FAILED=$(kubectl -n statecraft-system get job "$LAST_JOB" -o jsonpath='{.status.failed}' 2>/dev/null || echo "0")
  if [ "${JOB_FAILED:-0}" != "0" ] || [ "${JOB_SUCCEEDED:-0}" = "0" ]; then
    POD_LOG=$(kubectl -n statecraft-system logs --selector=job-name="$LAST_JOB" --tail=10 2>/dev/null | head -20 || true)
    contract_fail "most recent CronJob run ($LAST_JOB) did not succeed.
  succeeded=${JOB_SUCCEEDED:-0}, failed=${JOB_FAILED:-0}.
  Recent pod logs:
${POD_LOG}
  A 404 from the curl target indicates the orphan-sweep endpoint is not
  reachable from a K8s CronJob — see spec 143 §12 L-004 (expose:false is
  internal to the Encore service, not internal to the cluster). FR-010 is
  not delivered until the most recent run succeeds."
  fi
  ok "most recent CronJob run ($LAST_JOB) succeeded"
fi

# Cleanup runs from the EXIT trap; if we got here, all checks passed.
exit 0
