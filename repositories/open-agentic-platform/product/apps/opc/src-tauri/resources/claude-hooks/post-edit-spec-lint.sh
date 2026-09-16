#!/usr/bin/env bash
# Spec: 166-opc-stop-hook-gate-chain (FR-002)
#
# PostToolUse hook: when the Edit/Write tool touched a `specs/**/spec.md`,
# run spec-lint silently to surface conformance warnings (W-001..) early.
# No-op for every other edit.

set -u

SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd)
# shellcheck source=_lib.sh
. "$SCRIPT_DIR/_lib.sh"

stdin_json=$(oap_slurp_stdin)
root=$(oap_resolve_project_root "$stdin_json")

if ! oap_is_project "$root"; then
  exit 0
fi

file_path=$(oap_decode_file_path "$stdin_json")
if [ -z "$file_path" ]; then
  exit 0
fi
if ! oap_is_spec_md "$file_path"; then
  exit 0
fi

bin=$(oap_locate_binary "$root" spec-lint || true)
if [ -z "$bin" ]; then
  exit 0
fi

cd "$root" || exit 2
# Capture stderr+stdout so we can attach a one-line summary to the
# structured diagnostic. spec-lint emits W-### codes; surfacing the first
# few lines is enough to orient the agent.
output=$("$bin" --fail-on-warn 2>&1)
rc=$?
if [ $rc -ne 0 ]; then
  summary=$(printf '%s' "$output" | head -n3 | tr '\n' ' ' | sed 's/  */ /g')
  oap_emit_diagnostic post-edit-spec-lint spec-lint "$rc" "${summary:-spec-lint emitted warnings; run spec-lint --fail-on-warn locally}"
  exit 2
fi
exit 0
