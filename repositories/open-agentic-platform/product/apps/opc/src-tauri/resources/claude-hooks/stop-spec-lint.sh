#!/usr/bin/env bash
# Spec: 166-opc-stop-hook-gate-chain (FR-003)
#
# Stop hook: full spec-lint with default-fail-on-warn (spec 128). Blocks
# closure on any warning-tier emission.

set -u

SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd)
# shellcheck source=_lib.sh
. "$SCRIPT_DIR/_lib.sh"

stdin_json=$(oap_slurp_stdin)
root=$(oap_resolve_project_root "$stdin_json")

if ! oap_is_project "$root"; then
  exit 0
fi

if [ ! -d "$root/specs" ]; then
  exit 0
fi

bin=$(oap_locate_binary "$root" spec-lint || true)
if [ -z "$bin" ]; then
  oap_emit_diagnostic stop-spec-lint spec-lint 127 "spec-lint binary not found; cannot validate spec corpus at Stop"
  exit 2
fi

cd "$root" || exit 2
output=$("$bin" --fail-on-warn 2>&1)
rc=$?
if [ $rc -ne 0 ]; then
  summary=$(printf '%s' "$output" | head -n5 | tr '\n' ' ' | sed 's/  */ /g')
  oap_emit_diagnostic stop-spec-lint spec-lint "$rc" "${summary:-spec-lint emitted warnings; address before closing the session}"
  exit 2
fi
exit 0
