#!/usr/bin/env bash
# Spec: 166-opc-stop-hook-gate-chain (FR-002)
#
# PostToolUse hook fired after every `Edit` or `Write` tool call. Surfaces
# codebase-index staleness without blocking the next tool call: exit 0 on
# pass, exit 2 on staleness so the diagnostic reaches the model, never any
# other non-zero (which would surface to the user as a noisy error).

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
  # FR-007: PostToolUse hooks must complete fast. A missing binary is not a
  # drift signal; surface it as advisory (non-blocking) and let Stop-time
  # validation handle hard enforcement.
  oap_emit_diagnostic post-edit-index spec-spine 0 "spec-spine binary not found; PostToolUse staleness check skipped"
  exit 0
fi

cd "$root" || exit 2
stderr=$("$bin" index check 2>&1)
rc=$?
if [ $rc -ne 0 ]; then
  summary=$(printf '%s' "$stderr" | head -n3 | tr '\n' ' ' | sed 's/  */ /g')
  oap_emit_diagnostic post-edit-index spec-spine "$rc" "${summary:-codebase-index is stale; run spec-spine index}"
  exit 2
fi
exit 0
