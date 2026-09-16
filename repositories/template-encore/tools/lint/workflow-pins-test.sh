#!/usr/bin/env bash
# Spec: 158-workflow-ref-sha-pinning-lint (amends 116)
#
# workflow-pins-test.sh — regression tests for workflow-pins.sh.
#
# Each fixture asserts a precise exit code and (for the failing case)
# a precise count of violations. The fixtures ARE the spec for the
# lint: every input shape the lint must classify lives here, and the
# pass/fail expectations are committed alongside the lint itself. If
# the lint's classification changes, the fixtures must change with it
# — the test is the proof that the lint's semantics still hold.
#
# Exit: 0 if all assertions pass, 1 otherwise.

set -euo pipefail

if root="$(git rev-parse --show-toplevel 2>/dev/null)"; then
  cd "$root"
fi

LINT=tools/lint/workflow-pins.sh
FIXTURES=tools/lint/tests/fixtures

fail=0

# ── Assertion 1: passing fixture → exit 0, no stderr ─────────────────
pass_out=$("$LINT" "$FIXTURES/passing/action.yml" 2>&1) && pass_rc=$? || pass_rc=$?
if [ "$pass_rc" -ne 0 ]; then
  echo "FAIL: passing fixture returned exit $pass_rc (expected 0)" >&2
  echo "  output: $pass_out" >&2
  fail=1
else
  if [ -n "$pass_out" ]; then
    echo "FAIL: passing fixture produced output (expected silent)" >&2
    echo "  output: $pass_out" >&2
    fail=1
  else
    echo "PASS: passing fixture → exit 0, silent"
  fi
fi

# ── Assertion 2: failing fixture → exit 1, exactly 5 violations ──────
fail_out=$("$LINT" "$FIXTURES/failing/action.yml" 2>&1) && fail_rc=$? || fail_rc=$?
if [ "$fail_rc" -ne 1 ]; then
  echo "FAIL: failing fixture returned exit $fail_rc (expected 1)" >&2
  echo "  output: $fail_out" >&2
  fail=1
else
  violation_lines=$(printf '%s\n' "$fail_out" | grep -c "^${FIXTURES}/failing/action.yml:" || true)
  if [ "$violation_lines" -ne 5 ]; then
    echo "FAIL: failing fixture reported $violation_lines violations (expected 5)" >&2
    echo "  output:" >&2
    printf '%s\n' "$fail_out" | sed 's/^/    /' >&2
    fail=1
  else
    echo "PASS: failing fixture → exit 1, 5 violations on stderr"
  fi
fi

# ── Assertion 3: bash version gate emits exit 2 (smoke — current shell
#    already passed the gate at script entry; assert the gate exists as
#    a literal in the lint source). ─────────────────────────────────
if grep -q 'BASH_VERSINFO\[0\] < 4' "$LINT"; then
  echo "PASS: bash 4+ gate present in lint source"
else
  echo "FAIL: bash 4+ gate missing from lint source" >&2
  fail=1
fi

# ── Assertion 4: tree-wide invocation succeeds (the convention-is-
#    enforced proof for the current repo state). ──────────────────────
tree_out=$("$LINT" 2>&1) && tree_rc=$? || tree_rc=$?
if [ "$tree_rc" -ne 0 ]; then
  echo "FAIL: tree-wide scan returned exit $tree_rc (expected 0 — every ref should already be pinned)" >&2
  echo "  output: $tree_out" >&2
  fail=1
else
  echo "PASS: tree-wide scan → exit 0 (all current refs SHA-pinned)"
fi

if [ "$fail" -ne 0 ]; then
  echo
  echo "workflow-pins-test: one or more assertions failed" >&2
  exit 1
fi

echo
echo "workflow-pins-test: all assertions passed"
