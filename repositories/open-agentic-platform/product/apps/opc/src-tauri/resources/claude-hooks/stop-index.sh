#!/usr/bin/env bash
# Spec: 166-opc-stop-hook-gate-chain (FR-003, platform-mandatory)
#
# Stop hook: re-run the codebase-index staleness gate at conversation end.
# This is one of the two platform-mandatory entries (FR-006); project-level
# settings cannot disable it.

set -u

SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd)
# shellcheck source=_lib.sh
. "$SCRIPT_DIR/_lib.sh"

stdin_json=$(oap_slurp_stdin)
root=$(oap_resolve_project_root "$stdin_json")

if ! oap_is_project "$root"; then
  exit 0
fi

bin=$(oap_locate_binary "$root" spec-spine || true)
if [ -z "$bin" ]; then
  oap_emit_diagnostic stop-index spec-spine 127 "spec-spine binary not found; cannot validate staleness at Stop"
  exit 2
fi

cd "$root" || exit 2
stderr=$("$bin" index check 2>&1)
rc=$?
if [ $rc -ne 0 ]; then
  summary=$(printf '%s' "$stderr" | head -n3 | tr '\n' ' ' | sed 's/  */ /g')
  oap_emit_diagnostic stop-index spec-spine "$rc" "${summary:-codebase-index is stale; run spec-spine index and commit before closing}"
  exit 2
fi
exit 0
