#!/usr/bin/env bash
# Spec: 166-opc-stop-hook-gate-chain (FR-003, platform-mandatory)
#
# Stop hook: spec-spine couple against the working tree. This is the
# second platform-mandatory entry (FR-006).
#
# Conversation-end runs use HEAD as the comparison base (working-tree diff)
# rather than origin/main. This is intentionally lighter than `make
# pr-prep`: we are catching drift introduced this session, not drift between
# the branch and trunk. The PR-time CI workflow (`ci-spec-code-coupling`)
# remains the origin/main authority.

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
  oap_emit_diagnostic stop-coupling spec-spine 127 "spec-spine binary not found; cannot validate working-tree coupling at Stop"
  exit 2
fi

# Without compiled artifacts the gate cannot run. Surface as advisory so
# the user knows to compile, but do not hard-block: the stop-index hook
# already covers the staleness signal, and the coupling gate needs both
# artifacts present to be meaningful.
if ! "$bin" index check >/dev/null 2>&1; then
  # index is stale or absent; advisory exit so stop-index gate surfaces first.
  oap_emit_diagnostic stop-coupling spec-spine 0 "codebase-index not fresh; coupling gate skipped (run spec-spine index)"
  exit 0
fi

cd "$root" || exit 2

# Working-tree diff: compare HEAD against the index+untracked changes.
# `git status --porcelain=v1` enumerates modified, added, deleted, and
# untracked paths. Empty output → clean tree → nothing to gate; exit 0.
paths_file=$(mktemp)
trap 'rm -f "$paths_file"' EXIT
git status --porcelain=v1 2>/dev/null \
  | sed -E 's/^.{3}//' \
  | sed -E 's/^"(.*)"$/\1/' \
  | grep -v '^$' \
  > "$paths_file" || true

if [ ! -s "$paths_file" ]; then
  exit 0
fi

# spec-spine couple supports a `--paths-from` override that bypasses
# git-base/--head diff computation for the path set. We point it at the
# working-tree paths. Per the binary's CLI, section attribution falls back
# to whole-file authority in this mode; that's intentional for a
# conversation-end seam (we want a fast cohesion check, not a section-level
# audit).
output=$("$bin" couple --repo "$root" --paths-from "$paths_file" 2>&1)
rc=$?
if [ $rc -ne 0 ]; then
  summary=$(printf '%s' "$output" | head -n5 | tr '\n' ' ' | sed 's/  */ /g')
  oap_emit_diagnostic stop-coupling spec-spine "$rc" "${summary:-spec/code coupling violation in working tree; touch the owning spec.md or revert before closing}"
  exit 2
fi
exit 0
