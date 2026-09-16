#!/usr/bin/env bash
# Spec: 166-opc-stop-hook-gate-chain
#
# Common helpers for OPC's bundled Claude Code hooks.
#
# Hooks observe spec-103 (governed-artifact-reads): they invoke the consumer
# binaries and never parse `.derived/**/*.json` directly. Hook scripts must
# `source` this file and use the exported helpers.

set -u

# Detect the OAP project root for the current hook invocation.
#
# Resolution order (matches the existing make pr-prep / make ci surface):
#   1. $CLAUDE_PROJECT_DIR (Claude Code populates this for every hook).
#   2. The decoded `cwd` field from the hook stdin JSON, if non-empty.
#   3. `pwd` as a last resort.
#
# Echoes the absolute project root path. Always exits 0; the caller decides
# what to do when the path is not an OAP project.
oap_resolve_project_root() {
  local stdin_json="${1:-}"
  local from_env="${CLAUDE_PROJECT_DIR:-}"
  if [ -n "$from_env" ] && [ -d "$from_env" ]; then
    printf '%s\n' "$from_env"
    return 0
  fi

  if [ -n "$stdin_json" ]; then
    # Use grep+sed instead of jq so the hook is dependency-free; the field
    # is a flat string, so a line-oriented match is sufficient.
    local cwd
    cwd=$(printf '%s' "$stdin_json" | grep -o '"cwd"[[:space:]]*:[[:space:]]*"[^"]*"' | head -n1 | sed -E 's/.*"cwd"[[:space:]]*:[[:space:]]*"([^"]*)".*/\1/')
    if [ -n "$cwd" ] && [ -d "$cwd" ]; then
      printf '%s\n' "$cwd"
      return 0
    fi
  fi

  pwd
}

# Decide whether a directory looks like an OAP-shaped project that the
# Stop-hook gate chain should fire on.
#
# Two positive signals: the project has either a `specs/` directory (a spec
# spine project) or a compiled `.derived/spec-registry/registry.json` (a
# project that has already been compiled). Both signals can be present;
# either is sufficient.
#
# FR-008: hooks no-op when not in an OAP project. Project-detection here is
# intentionally lighter than factory-project-detect: factory detection is
# about pipeline state, OAP detection is about spec-spine presence.
oap_is_project() {
  local root="$1"
  if [ -d "$root/specs" ]; then return 0; fi
  if [ -f "$root/.derived/spec-registry/registry.json" ]; then return 0; fi
  return 1
}

# Locate a binary by name. Search order:
#   1. $PATH
#   2. Project-relative well-known build location (target/release).
#   3. Repo-resident tools/lint/*.sh shell scripts.
#
# Echoes the resolved path on success; returns non-zero on miss. The caller
# is expected to emit a diagnostic if the binary is required.
oap_locate_binary() {
  local root="$1"
  local name="$2"
  if command -v "$name" >/dev/null 2>&1; then
    command -v "$name"
    return 0
  fi
  local candidates=()
  case "$name" in
    spec-spine)
      # Published CLI (cargo install spec-spine-cli); no in-tree fallback.
      ;;
    spec-lint)
      candidates+=("$root/tools/spec-spine/spec-lint/target/release/spec-lint")
      ;;
    codification-gate)
      candidates+=("$root/tools/oap/codification-gate/target/release/codification-gate")
      ;;
    workflow-pins.sh)
      candidates+=("$root/tools/lint/workflow-pins.sh")
      ;;
  esac
  local c
  for c in "${candidates[@]}"; do
    if [ -x "$c" ]; then
      printf '%s\n' "$c"
      return 0
    fi
  done
  return 1
}

# Decode the `tool_input.file_path` field from a PostToolUse stdin JSON.
# Echoes the empty string when the field is absent. Dependency-free: grep+sed.
oap_decode_file_path() {
  local stdin_json="$1"
  printf '%s' "$stdin_json" | grep -o '"file_path"[[:space:]]*:[[:space:]]*"[^"]*"' | head -n1 | sed -E 's/.*"file_path"[[:space:]]*:[[:space:]]*"([^"]*)".*/\1/'
}

# Emit a structured diagnostic to stderr (FR-005). The diagnostic is a
# single-line JSON object so the receiving agent or UI can parse it
# verbatim:
#
#   { "spec": "166", "hook": "<id>", "binary": "<name>",
#     "exit_code": <n>, "summary": "<one-line summary>" }
#
# We deliberately do not use multi-line pretty-printed JSON: Claude Code
# streams stderr line-by-line, and a single line is the easiest contract.
oap_emit_diagnostic() {
  local hook_id="$1"
  local binary="$2"
  local exit_code="$3"
  local summary="$4"
  local escaped_summary
  escaped_summary=$(printf '%s' "$summary" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g' -e ':a;N;$!ba;s/\n/\\n/g')
  printf '{"spec":"166","hook":"%s","binary":"%s","exit_code":%s,"summary":"%s"}\n' \
    "$hook_id" "$binary" "$exit_code" "$escaped_summary" 1>&2
}

# Pattern match for `specs/**/spec.md` path semantics. Returns 0 (match) when
# the given path is a project-relative or absolute path to a spec.md inside
# the specs tree.
oap_is_spec_md() {
  local path="$1"
  case "$path" in
    */specs/*/spec.md|specs/*/spec.md) return 0 ;;
    *) return 1 ;;
  esac
}

# Pattern match for `.github/workflows/*.yml`. Returns 0 (match) on hit.
oap_is_workflow_yaml() {
  local path="$1"
  case "$path" in
    *.github/workflows/*.yml|*.github/workflows/*.yaml) return 0 ;;
    *) return 1 ;;
  esac
}

# Read all of stdin into a variable. Hook scripts call this once; downstream
# helpers receive the resulting blob as an argument so they can be tested in
# isolation without re-routing stdin.
oap_slurp_stdin() {
  if [ -t 0 ]; then
    printf ''
  else
    cat
  fi
}
