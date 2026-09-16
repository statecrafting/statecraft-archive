#!/usr/bin/env bash
# Spec: 166-opc-stop-hook-gate-chain (FR-003, conditional)
#
# Stop hook: workflow-ref SHA-pinning lint (spec 158). Conditional on the
# project actually having any `.github/workflows/*.yml`. When there are no
# workflows in the tree, the underlying lint script no-ops, so this hook
# also exits 0.

set -u

SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd)
# shellcheck source=_lib.sh
. "$SCRIPT_DIR/_lib.sh"

stdin_json=$(oap_slurp_stdin)
root=$(oap_resolve_project_root "$stdin_json")

if ! oap_is_project "$root"; then
  exit 0
fi

shopt -s nullglob
workflows=("$root/.github/workflows/"*.yml "$root/.github/workflows/"*.yaml)
shopt -u nullglob
if [ ${#workflows[@]} -eq 0 ]; then
  exit 0
fi

bin=$(oap_locate_binary "$root" workflow-pins.sh || true)
if [ -z "$bin" ]; then
  exit 0
fi

cd "$root" || exit 2
output=$(bash "$bin" 2>&1)
rc=$?
if [ $rc -ne 0 ]; then
  summary=$(printf '%s' "$output" | head -n5 | tr '\n' ' ' | sed 's/  */ /g')
  oap_emit_diagnostic stop-workflow-pins workflow-pins.sh "$rc" "${summary:-workflow uses: refs are not SHA-pinned (spec 158); pin to a 40-hex commit SHA before closing}"
  exit 2
fi
exit 0
