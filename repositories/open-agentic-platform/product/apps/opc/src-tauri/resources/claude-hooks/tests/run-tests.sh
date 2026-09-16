#!/usr/bin/env bash
# Spec: 166-opc-stop-hook-gate-chain: hook wrapper test suite.
#
# Self-contained shell tests for the six wrapper scripts. Tests run against
# a synthetic OAP-shaped project tree and a set of mock binaries placed on
# PATH; no network and no compiled toolchain required.
#
# Run: bash product/apps/desktop/src-tauri/resources/claude-hooks/tests/run-tests.sh

set -u

SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd)
HOOKS_DIR=$(cd "$SCRIPT_DIR/.." && pwd)

PASS=0
FAIL=0
FAILED_CASES=()

assert_eq() {
  local label="$1"
  local expected="$2"
  local actual="$3"
  if [ "$expected" = "$actual" ]; then
    PASS=$((PASS + 1))
    printf '  ok %s\n' "$label"
  else
    FAIL=$((FAIL + 1))
    FAILED_CASES+=("$label: expected '$expected', got '$actual'")
    printf '  FAIL %s (expected=%s actual=%s)\n' "$label" "$expected" "$actual"
  fi
}

assert_contains() {
  local label="$1"
  local needle="$2"
  local haystack="$3"
  if printf '%s' "$haystack" | grep -F -q "$needle"; then
    PASS=$((PASS + 1))
    printf '  ok %s\n' "$label"
  else
    FAIL=$((FAIL + 1))
    FAILED_CASES+=("$label: expected output to contain '$needle'; got: $haystack")
    printf '  FAIL %s (needle=%s)\n' "$label" "$needle"
  fi
}

# Make a synthetic OAP project rooted at $1 with mock binaries on PATH.
# Args: project_root, exit_code_for_indexer, exit_code_for_spec_lint,
#       exit_code_for_coupling, exit_code_for_workflow_pins,
#       [optional] exit_code_for_codification_gate.
# Each "exit code" arg is one of: 0, 1, 2, missing (=binary absent),
# workflows (=create workflow yml in tree).
# The codification-gate slot defaults to "missing" so legacy callers are
# unaffected.
make_project() {
  local root="$1"
  local idx_rc="$2"
  local sl_rc="$3"
  local cp_rc="$4"
  local wp_mode="$5"
  local cg_rc="${6:-missing}"

  mkdir -p "$root/specs" "$root/.derived/spec-registry" "$root/.derived/codebase-index"
  printf '{}' > "$root/.derived/spec-registry/registry.json"
  printf '{}' > "$root/.derived/codebase-index/index.json"
  # Initialise git so spec-spine couple's status invocation works.
  (cd "$root" && git init -q && git config user.email t@t && git config user.name t && \
     git add . && git commit -q -m init >/dev/null 2>&1) || true

  local bindir="$root/.mock-bin"
  mkdir -p "$bindir"

  # Single spec-spine mock binary dispatches on subcommand.
  if [ "$idx_rc" != "missing" ] || [ "$cp_rc" != "missing" ]; then
    # Capture values for use inside the heredoc.
    local _idx_rc="$idx_rc"
    local _cp_rc="$cp_rc"
    cat > "$bindir/spec-spine" <<EOF
#!/usr/bin/env bash
subcmd="\$1"
shift || true
if [ "\$subcmd" = "index" ]; then
  action="\$1"
  if [ "\$action" = "check" ]; then
    if [ "${_idx_rc}" != "missing" ] && [ "${_idx_rc}" -ne 0 ]; then
      echo "codebase-index stale: 12 inputs changed" 1>&2
      exit ${_idx_rc}
    fi
    exit 0
  fi
  exit 0
fi
if [ "\$subcmd" = "couple" ]; then
  if [ "${_cp_rc}" != "missing" ] && [ "${_cp_rc}" -ne 0 ]; then
    echo "spec/code coupling violation: path X has no owning spec" 1>&2
    exit ${_cp_rc}
  fi
  exit 0
fi
exit 0
EOF
    chmod +x "$bindir/spec-spine"
  fi

  if [ "$sl_rc" != "missing" ]; then
    cat > "$bindir/spec-lint" <<EOF
#!/usr/bin/env bash
if [ "$sl_rc" -ne 0 ]; then
  echo "W-020 spec lacks relationship fields: specs/166-foo/spec.md" 1>&2
fi
exit $sl_rc
EOF
    chmod +x "$bindir/spec-lint"
  fi

  if [ "$cg_rc" != "missing" ]; then
    cat > "$bindir/codification-gate" <<EOF
#!/usr/bin/env bash
if [ "$cg_rc" -ne 0 ]; then
  echo "codification-gate: blocking; uncoded CRITICAL/HIGH findings:" 1>&2
  echo "  - [Critical] F-MOCK (axiomregent): mock finding for hook test" 1>&2
fi
exit $cg_rc
EOF
    chmod +x "$bindir/codification-gate"
  fi

  if [ "$wp_mode" = "workflows-ok" ] || [ "$wp_mode" = "workflows-bad" ]; then
    mkdir -p "$root/.github/workflows"
    cat > "$root/.github/workflows/ci.yml" <<'EOF'
name: ci
on: push
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
EOF
  fi
  if [ "$wp_mode" = "workflows-bad" ]; then
    cat > "$bindir/workflow-pins.sh" <<'EOF'
#!/usr/bin/env bash
echo ".github/workflows/ci.yml:7: actions/checkout@v4" 1>&2
exit 1
EOF
    chmod +x "$bindir/workflow-pins.sh"
  elif [ "$wp_mode" = "workflows-ok" ]; then
    cat > "$bindir/workflow-pins.sh" <<'EOF'
#!/usr/bin/env bash
exit 0
EOF
    chmod +x "$bindir/workflow-pins.sh"
  fi

  printf '%s' "$bindir"
}

run_hook() {
  local hook_script="$1"
  local stdin_json="$2"
  local bindir="$3"
  local root="$4"
  ( PATH="$bindir:$PATH" CLAUDE_PROJECT_DIR="$root" \
    "$HOOKS_DIR/$hook_script" <<< "$stdin_json" 2>&1 )
}

run_hook_rc() {
  local hook_script="$1"
  local stdin_json="$2"
  local bindir="$3"
  local root="$4"
  PATH="$bindir:$PATH" CLAUDE_PROJECT_DIR="$root" \
    "$HOOKS_DIR/$hook_script" <<< "$stdin_json" >/dev/null 2>&1
  printf '%s' "$?"
}

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

echo
echo "== _lib.sh: pure helpers =="
# shellcheck source=../_lib.sh
. "$HOOKS_DIR/_lib.sh"
assert_eq "is_spec_md positive (project-relative)" "0" "$(oap_is_spec_md specs/166-foo/spec.md && echo 0 || echo 1)"
assert_eq "is_spec_md positive (absolute)"          "0" "$(oap_is_spec_md /tmp/p/specs/166-foo/spec.md && echo 0 || echo 1)"
assert_eq "is_spec_md negative"                     "1" "$(oap_is_spec_md docs/owasp/intent.md && echo 0 || echo 1)"
assert_eq "is_workflow_yaml positive"               "0" "$(oap_is_workflow_yaml .github/workflows/ci.yml && echo 0 || echo 1)"
assert_eq "is_workflow_yaml positive (yaml ext)"    "0" "$(oap_is_workflow_yaml .github/workflows/ci.yaml && echo 0 || echo 1)"
assert_eq "is_workflow_yaml negative"               "1" "$(oap_is_workflow_yaml src/main.rs && echo 0 || echo 1)"
assert_eq "decode_file_path"                        "/a/b/c" "$(oap_decode_file_path '{"tool_input":{"file_path":"/a/b/c"}}')"
assert_eq "decode_file_path absent"                 "" "$(oap_decode_file_path '{}')"

# is_project signals
mkdir -p "$TMP/has-specs/specs"
assert_eq "is_project via specs/"                   "0" "$(oap_is_project "$TMP/has-specs" && echo 0 || echo 1)"
mkdir -p "$TMP/has-registry/.derived/spec-registry"
printf '{}' > "$TMP/has-registry/.derived/spec-registry/registry.json"
assert_eq "is_project via registry"                 "0" "$(oap_is_project "$TMP/has-registry" && echo 0 || echo 1)"
mkdir -p "$TMP/empty"
assert_eq "is_project negative"                     "1" "$(oap_is_project "$TMP/empty" && echo 0 || echo 1)"

echo
echo "== FR-008: hooks no-op outside an OAP project =="
mkdir -p "$TMP/not-project"
empty_bin=$(mktemp -d)
for hook in post-edit-index.sh post-edit-spec-lint.sh stop-index.sh stop-spec-lint.sh stop-coupling.sh stop-workflow-pins.sh stop-codification.sh; do
  rc=$(run_hook_rc "$hook" '{}' "$empty_bin" "$TMP/not-project")
  assert_eq "$hook no-op outside OAP" "0" "$rc"
done

echo
echo "== FR-002: PostToolUse codebase-index check =="
proj=$(mktemp -d)
bindir=$(make_project "$proj" 0 0 0 noop)
rc=$(run_hook_rc post-edit-index.sh '{}' "$bindir" "$proj")
assert_eq "post-edit-index passes when index fresh" "0" "$rc"

proj=$(mktemp -d)
bindir=$(make_project "$proj" 1 0 0 noop)
out=$(run_hook post-edit-index.sh '{}' "$bindir" "$proj")
rc=$(run_hook_rc post-edit-index.sh '{}' "$bindir" "$proj")
assert_eq "post-edit-index exit 2 on staleness" "2" "$rc"
assert_contains "post-edit-index emits FR-005 diagnostic" '"hook":"post-edit-index"' "$out"
assert_contains "post-edit-index names binary" '"binary":"spec-spine"' "$out"

echo
echo "== FR-002: PostToolUse spec-lint conditional =="
proj=$(mktemp -d)
bindir=$(make_project "$proj" 0 0 0 noop)
# Non-spec edit: no-op.
rc=$(run_hook_rc post-edit-spec-lint.sh '{"tool_input":{"file_path":"'"$proj"'/src/main.rs"}}' "$bindir" "$proj")
assert_eq "post-edit-spec-lint no-op on non-spec edit" "0" "$rc"

# spec edit, lint clean: pass.
rc=$(run_hook_rc post-edit-spec-lint.sh '{"tool_input":{"file_path":"'"$proj"'/specs/166-foo/spec.md"}}' "$bindir" "$proj")
assert_eq "post-edit-spec-lint pass on clean spec" "0" "$rc"

# spec edit, lint warns: block.
proj=$(mktemp -d)
bindir=$(make_project "$proj" 0 1 0 noop)
out=$(run_hook post-edit-spec-lint.sh '{"tool_input":{"file_path":"'"$proj"'/specs/166-foo/spec.md"}}' "$bindir" "$proj")
rc=$(run_hook_rc post-edit-spec-lint.sh '{"tool_input":{"file_path":"'"$proj"'/specs/166-foo/spec.md"}}' "$bindir" "$proj")
assert_eq "post-edit-spec-lint exit 2 on lint warning" "2" "$rc"
assert_contains "post-edit-spec-lint diagnostic" '"hook":"post-edit-spec-lint"' "$out"

echo
echo "== FR-003: Stop chain: codebase-index =="
proj=$(mktemp -d)
bindir=$(make_project "$proj" 0 0 0 noop)
rc=$(run_hook_rc stop-index.sh '{}' "$bindir" "$proj")
assert_eq "stop-index passes when fresh" "0" "$rc"

proj=$(mktemp -d)
bindir=$(make_project "$proj" 1 0 0 noop)
out=$(run_hook stop-index.sh '{}' "$bindir" "$proj")
rc=$(run_hook_rc stop-index.sh '{}' "$bindir" "$proj")
assert_eq "stop-index blocks on staleness" "2" "$rc"
assert_contains "stop-index diagnostic" '"hook":"stop-index"' "$out"

# FR-006 platform-mandatory: binary missing must block, not silently pass.
proj=$(mktemp -d)
bindir=$(make_project "$proj" missing 0 0 noop)
rc=$(run_hook_rc stop-index.sh '{}' "$bindir" "$proj")
assert_eq "stop-index blocks when binary missing (platform-mandatory)" "2" "$rc"

echo
echo "== FR-003: Stop chain: spec-lint =="
proj=$(mktemp -d)
bindir=$(make_project "$proj" 0 0 0 noop)
rc=$(run_hook_rc stop-spec-lint.sh '{}' "$bindir" "$proj")
assert_eq "stop-spec-lint passes on clean" "0" "$rc"

proj=$(mktemp -d)
bindir=$(make_project "$proj" 0 1 0 noop)
rc=$(run_hook_rc stop-spec-lint.sh '{}' "$bindir" "$proj")
assert_eq "stop-spec-lint blocks on warning" "2" "$rc"

echo
echo "== FR-003: Stop chain: coupling =="
proj=$(mktemp -d)
bindir=$(make_project "$proj" 0 0 0 noop)
rc=$(run_hook_rc stop-coupling.sh '{}' "$bindir" "$proj")
assert_eq "stop-coupling passes on clean tree (no diff)" "0" "$rc"

# Create a working-tree mod so the gate has paths to check.
proj=$(mktemp -d)
bindir=$(make_project "$proj" 0 0 1 noop)
mkdir -p "$proj/src"
echo "modified" > "$proj/src/main.rs"
rc=$(run_hook_rc stop-coupling.sh '{}' "$bindir" "$proj")
assert_eq "stop-coupling blocks on coupling violation" "2" "$rc"

# Without compiled artifacts: advisory exit 0.
proj=$(mktemp -d)
mkdir -p "$proj/specs"
bindir=$(mktemp -d)
rc=$(run_hook_rc stop-coupling.sh '{}' "$bindir" "$proj")
assert_eq "stop-coupling advisory when artifacts absent" "0" "$rc"

echo
echo "== FR-003: Stop chain: workflow-pins (conditional) =="
proj=$(mktemp -d)
bindir=$(make_project "$proj" 0 0 0 noop)
rc=$(run_hook_rc stop-workflow-pins.sh '{}' "$bindir" "$proj")
assert_eq "stop-workflow-pins no-op without workflows" "0" "$rc"

proj=$(mktemp -d)
bindir=$(make_project "$proj" 0 0 0 workflows-ok)
rc=$(run_hook_rc stop-workflow-pins.sh '{}' "$bindir" "$proj")
assert_eq "stop-workflow-pins passes when pinned" "0" "$rc"

proj=$(mktemp -d)
bindir=$(make_project "$proj" 0 0 0 workflows-bad)
out=$(run_hook stop-workflow-pins.sh '{}' "$bindir" "$proj")
rc=$(run_hook_rc stop-workflow-pins.sh '{}' "$bindir" "$proj")
assert_eq "stop-workflow-pins blocks on unpinned ref" "2" "$rc"
assert_contains "stop-workflow-pins diagnostic" '"hook":"stop-workflow-pins"' "$out"

echo
echo "== spec 174: Stop chain: codification-gate =="
# Clean: gate passes.
proj=$(mktemp -d)
bindir=$(make_project "$proj" 0 0 0 noop 0)
rc=$(run_hook_rc stop-codification.sh '{}' "$bindir" "$proj")
assert_eq "stop-codification passes when no uncoded findings" "0" "$rc"

# Blocking: gate exits 2 with diagnostic envelope.
proj=$(mktemp -d)
bindir=$(make_project "$proj" 0 0 0 noop 2)
out=$(run_hook stop-codification.sh '{}' "$bindir" "$proj")
rc=$(run_hook_rc stop-codification.sh '{}' "$bindir" "$proj")
assert_eq "stop-codification blocks on uncoded finding" "2" "$rc"
assert_contains "stop-codification emits FR-005 diagnostic" '"hook":"stop-codification"' "$out"
assert_contains "stop-codification names binary" '"binary":"codification-gate"' "$out"

# Binary absent: advisory exit 0 (forward-compat: substrate emission may
# not be wired yet; spec-coupling + index gates still gate the spine shape).
proj=$(mktemp -d)
bindir=$(make_project "$proj" 0 0 0 noop missing)
out=$(run_hook stop-codification.sh '{}' "$bindir" "$proj")
rc=$(run_hook_rc stop-codification.sh '{}' "$bindir" "$proj")
assert_eq "stop-codification advisory when binary missing" "0" "$rc"
assert_contains "stop-codification advisory diagnostic" '"hook":"stop-codification"' "$out"

echo
echo "-- summary --"
printf 'PASS=%d FAIL=%d\n' "$PASS" "$FAIL"
if [ "$FAIL" -gt 0 ]; then
  printf '\nFailures:\n'
  for f in "${FAILED_CASES[@]}"; do
    printf '  - %s\n' "$f"
  done
  exit 1
fi
