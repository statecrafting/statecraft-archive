#!/usr/bin/env bash
# Spec: 174-codification-gate (FR-001, FR-008)
#
# Stop hook: block session closure on any uncoded CRITICAL/HIGH finding
# emitted by axiomregent / provenance-validator / policy-kernel during
# the session.
#
# This entry composes with the existing spec 166 chain (FR-008). It is
# not platform-mandatory: substrate emission is forward-compatible, so
# in projects where no finding artifacts exist the gate cleanly exits 0
# without blocking. Per-finding override is via the project's
# .codification-override.yaml file, not by removing this hook entry.

set -u

SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd)
# shellcheck source=_lib.sh
. "$SCRIPT_DIR/_lib.sh"

stdin_json=$(oap_slurp_stdin)
root=$(oap_resolve_project_root "$stdin_json")

if ! oap_is_project "$root"; then
  exit 0
fi

bin=$(oap_locate_binary "$root" codification-gate || true)
if [ -z "$bin" ]; then
  # The binary is built by the toolchain; if it's missing, the project
  # has not run `make registry` or equivalent. Surface as advisory so the
  # user knows what to build; do not hard-block — the spec-code-coupling
  # gate and codebase-index check already gate the spine-level shape.
  oap_emit_diagnostic stop-codification codification-gate 0 "codification-gate binary not found; build with cargo or make (substrate emission may not be wired yet)"
  exit 0
fi

cd "$root" || exit 2

output=$("$bin" --repo "$root" 2>&1)
rc=$?
if [ $rc -ne 0 ]; then
  summary=$(printf '%s' "$output" | head -n5 | tr '\n' ' ' | sed 's/  */ /g')
  oap_emit_diagnostic stop-codification codification-gate "$rc" "${summary:-uncoded CRITICAL or HIGH finding(s); codify under standards/security/ or under §Constraints on the implicated spec before closing}"
  exit 2
fi
exit 0
