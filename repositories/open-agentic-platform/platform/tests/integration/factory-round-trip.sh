#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Factory Round-Trip Integration Test
# ---------------------------------------------------------------------------
#
# Validates the full OPC → Statecraft → deployd pipeline lifecycle.
#
# Prerequisites:
#   - Statecraft running on localhost:4000
#   - deployd-api-rs running on localhost:8080  (optional; test skips deploy step if unavailable)
#   - A project must exist in the Statecraft DB (seeded on first startup)
#
# Usage:
#   ./platform/tests/integration/factory-round-trip.sh [statecraft-url] [project-id]
#
# Defaults:
#   statecraft-url: http://localhost:4000
#   project-id:     auto-detected from GET /api/projects
# ---------------------------------------------------------------------------

set -euo pipefail

STATECRAFT="${1:-http://localhost:4000}"
PROJECT_ID="${2:-}"
DEPLOYD="${DEPLOYD_URL:-http://localhost:8080}"
ACTOR="integration-test"

red()   { printf "\033[0;31m%s\033[0m\n" "$1"; }
green() { printf "\033[0;32m%s\033[0m\n" "$1"; }
info()  { printf "  -> %s\n" "$1"; }

fail() { red "FAIL: $1"; exit 1; }
pass() { green "PASS: $1"; }

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

api() {
  local method="$1" path="$2"
  shift 2
  curl -sf -X "$method" \
    -H "Content-Type: application/json" \
    "${STATECRAFT}${path}" \
    "$@"
}

api_status() {
  local method="$1" path="$2"
  shift 2
  curl -s -o /dev/null -w "%{http_code}" -X "$method" \
    -H "Content-Type: application/json" \
    "${STATECRAFT}${path}" \
    "$@"
}

# ---------------------------------------------------------------------------
# 0. Check Statecraft is reachable
# ---------------------------------------------------------------------------

echo "=== Factory Round-Trip Integration Test ==="
echo "Statecraft: $STATECRAFT"
echo "Deployd:    $DEPLOYD"
echo ""

if ! curl -sf "${STATECRAFT}/api/monitor/ping" > /dev/null 2>&1; then
  fail "Statecraft not reachable at ${STATECRAFT}"
fi
pass "Statecraft is reachable"

# ---------------------------------------------------------------------------
# 1. Resolve project ID
# ---------------------------------------------------------------------------

if [ -z "$PROJECT_ID" ]; then
  PROJECT_ID=$(api GET "/api/projects" | python3 -c "import sys,json; ps=json.load(sys.stdin); print(ps[0]['id'])" 2>/dev/null || echo "")
fi

if [ -z "$PROJECT_ID" ]; then
  fail "No project found. Seed the DB or pass a project ID as argument."
fi
info "Project: $PROJECT_ID"

# ---------------------------------------------------------------------------
# 2. Init pipeline
# ---------------------------------------------------------------------------

INIT_RESP=$(api POST "/api/projects/${PROJECT_ID}/factory/init" \
  -d "{\"adapter\":\"next-prisma\",\"actorUserId\":\"${ACTOR}\"}")

PIPELINE_ID=$(echo "$INIT_RESP" | python3 -c "import sys,json; print(json.load(sys.stdin)['pipeline_id'])")

[ -n "$PIPELINE_ID" ] || fail "init_pipeline did not return pipeline_id"
info "Pipeline: $PIPELINE_ID"
pass "Pipeline initialized"

# ---------------------------------------------------------------------------
# 3. Status update: mark running
# ---------------------------------------------------------------------------

api POST "/api/projects/${PROJECT_ID}/factory/status-update" \
  -d "{\"pipeline_id\":\"${PIPELINE_ID}\",\"status\":\"running\",\"current_stage\":\"s0-preflight\",\"phase\":\"process\",\"actorUserId\":\"${ACTOR}\"}" > /dev/null

pass "Pipeline marked as running"

# ---------------------------------------------------------------------------
# 4. Report token spend for s1
# ---------------------------------------------------------------------------

api POST "/api/projects/${PROJECT_ID}/factory/token-spend" \
  -d "{\"run_id\":\"test-run-001\",\"stage_id\":\"s1-business-requirements\",\"prompt_tokens\":1000,\"completion_tokens\":500,\"model\":\"claude-sonnet-4-20250514\"}" > /dev/null

pass "Token spend reported for s1"

# ---------------------------------------------------------------------------
# 5. Confirm stage s1
# ---------------------------------------------------------------------------

CONFIRM_RESP=$(api POST "/api/projects/${PROJECT_ID}/factory/stage/s1-business-requirements/confirm" \
  -d "{\"actorUserId\":\"${ACTOR}\"}")

AUDIT_ID=$(echo "$CONFIRM_RESP" | python3 -c "import sys,json; print(json.load(sys.stdin)['audit_entry_id'])")
[ -n "$AUDIT_ID" ] || fail "confirm did not return audit_entry_id"
pass "Stage s1 confirmed"

# ---------------------------------------------------------------------------
# 6. Ingest step events
# ---------------------------------------------------------------------------

api POST "/api/projects/${PROJECT_ID}/factory/events" \
  -d "{\"pipeline_id\":\"${PIPELINE_ID}\",\"events\":[{\"event_type\":\"step_completed\",\"step_id\":\"s0-preflight\",\"timestamp\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\",\"payload\":{\"agent\":\"preflight\",\"status\":\"Success\"}},{\"event_type\":\"step_completed\",\"step_id\":\"s1-business-requirements\",\"timestamp\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\",\"payload\":{\"agent\":\"business-analyst\",\"status\":\"Success\"}}]}" > /dev/null

pass "Step events ingested"

# ---------------------------------------------------------------------------
# 7. Report scaffold progress
# ---------------------------------------------------------------------------

api POST "/api/projects/${PROJECT_ID}/factory/scaffold-progress" \
  -d "{\"pipeline_id\":\"${PIPELINE_ID}\",\"features\":[{\"feature_id\":\"feat-user-auth\",\"category\":\"data\",\"status\":\"completed\",\"prompt_tokens\":500,\"completion_tokens\":300},{\"feature_id\":\"feat-api-users\",\"category\":\"api\",\"status\":\"failed\",\"last_error\":\"test error\",\"retry_count\":2}],\"actorUserId\":\"${ACTOR}\"}" > /dev/null

pass "Scaffold progress reported"

# ---------------------------------------------------------------------------
# 8. Status update: mark completed
# ---------------------------------------------------------------------------

api POST "/api/projects/${PROJECT_ID}/factory/status-update" \
  -d "{\"pipeline_id\":\"${PIPELINE_ID}\",\"status\":\"completed\",\"actorUserId\":\"${ACTOR}\"}" > /dev/null

pass "Pipeline marked as completed"

# ---------------------------------------------------------------------------
# 9. Verify full status
# ---------------------------------------------------------------------------

STATUS_RESP=$(api GET "/api/projects/${PROJECT_ID}/factory/status")
STATUS=$(echo "$STATUS_RESP" | python3 -c "import sys,json; print(json.load(sys.stdin)['status'])")
[ "$STATUS" = "completed" ] || fail "Expected status=completed, got ${STATUS}"
pass "Pipeline status verified: completed"

# Token spend check
TOTAL_TOKENS=$(echo "$STATUS_RESP" | python3 -c "import sys,json; print(json.load(sys.stdin)['token_spend']['total'])")
[ "$TOTAL_TOKENS" -ge 1500 ] || fail "Expected total tokens >= 1500, got ${TOTAL_TOKENS}"
pass "Token spend verified: ${TOTAL_TOKENS} tokens"

# ---------------------------------------------------------------------------
# 10. Verify audit trail
# ---------------------------------------------------------------------------

AUDIT_RESP=$(api GET "/api/projects/${PROJECT_ID}/factory/audit")
TOTAL_EVENTS=$(echo "$AUDIT_RESP" | python3 -c "import sys,json; print(json.load(sys.stdin)['total'])")
[ "$TOTAL_EVENTS" -ge 6 ] || fail "Expected >= 6 audit events, got ${TOTAL_EVENTS}"
pass "Audit trail verified: ${TOTAL_EVENTS} events"

# Check for key event types
for event_type in "pipeline_initialized" "pipeline_status_changed" "stage_confirmed" "token_spend_reported" "step_completed" "scaffold_progress_reported"; do
  COUNT=$(echo "$AUDIT_RESP" | python3 -c "import sys,json; entries=json.load(sys.stdin)['entries']; print(sum(1 for e in entries if e['event']=='${event_type}'))")
  [ "$COUNT" -ge 1 ] || fail "Missing audit event: ${event_type}"
done
pass "All expected audit event types present"

# ---------------------------------------------------------------------------
# 11. Trigger deployment (optional — requires deployd-api)
# ---------------------------------------------------------------------------

DEPLOY_STATUS=$(api_status POST "/api/projects/${PROJECT_ID}/factory/deploy" \
  -d "{\"environment\":\"staging\",\"git_ref\":\"abc1234\",\"actorUserId\":\"${ACTOR}\"}")

if [ "$DEPLOY_STATUS" = "200" ]; then
  pass "Deployment triggered successfully"
else
  info "Deployment returned HTTP ${DEPLOY_STATUS} (may be expected in local dev without deployd)"
fi

# ---------------------------------------------------------------------------
# Done
# ---------------------------------------------------------------------------

echo ""
green "=== All tests passed ==="
