#!/usr/bin/env bash
# Spec: 193-paired-release-cadence
#
# release-version-guard-test.sh — regression tests for release-version-guard.sh.
#
# The fixtures ARE the spec for the guard: every input shape the guard must
# classify (internal consistency, expected-version match/mismatch, SBOM
# match/mismatch/absent, unknown product) lives here with its exact expected
# exit code. If the guard's semantics change, these change with it.
#
# Exit: 0 if all assertions pass, 1 otherwise.

set -euo pipefail

if root="$(git rev-parse --show-toplevel 2>/dev/null)"; then
  cd "$root"
fi

GUARD=tools/lint/release-version-guard.sh
fail=0
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

assert_rc() { # description expected-rc actual-rc
  if [ "$2" -ne "$3" ]; then
    echo "FAIL: $1 → exit $3 (expected $2)" >&2
    fail=1
  else
    echo "ok: $1 (exit $3)"
  fi
}

run() { "$GUARD" "$@" >/dev/null 2>&1 && echo 0 || echo $?; }

# 1. opc internal consistency (committed tree must be self-consistent).
assert_rc "opc internal consistency" 0 "$(run opc)"

# 2. axiomregent is no longer a product — the arm was dropped (spec 037/193,
#    amended 2026-06-04: internal bundled sidecar, no product version). It is now
#    an unknown product → usage error (exit 2).
assert_rc "axiomregent dropped → unknown product" 2 "$(run axiomregent)"

# 3. opc against the committed version (derived live, not hard-coded).
opc_ver="$(jq -r .version product/apps/opc/src-tauri/tauri.conf.json)"
assert_rc "opc == committed ($opc_ver)" 0 "$(run opc "$opc_ver")"

# 4. opc against a wrong version → mismatch.
assert_rc "opc != 9.9.9" 1 "$(run opc 9.9.9)"

# 5. unknown product → usage error.
assert_rc "unknown product" 2 "$(run frobnicate)"

# 6. SBOM matches → pass.
cat > "$tmp/match.cdx.json" <<JSON
{"components":[{"name":"opc","version":"$opc_ver"},{"name":"serde","version":"1.0"}]}
JSON
assert_rc "opc SBOM match" 0 "$(run opc "$opc_ver" "$tmp/match.cdx.json")"

# 7. SBOM mismatch → fail.
cat > "$tmp/bad.cdx.json" <<JSON
{"components":[{"name":"opc","version":"0.0.1"}]}
JSON
assert_rc "opc SBOM mismatch" 1 "$(run opc "$opc_ver" "$tmp/bad.cdx.json")"

# 8. SBOM without the component → pass (warn, do not fail on scanner naming).
cat > "$tmp/absent.cdx.json" <<JSON
{"components":[{"name":"serde","version":"1.0"}]}
JSON
assert_rc "opc SBOM component absent (warn)" 0 "$(run opc "$opc_ver" "$tmp/absent.cdx.json")"

if [ "$fail" -ne 0 ]; then
  echo "release-version-guard-test: FAILURES present" >&2
  exit 1
fi
echo "release-version-guard-test: all assertions passed"
