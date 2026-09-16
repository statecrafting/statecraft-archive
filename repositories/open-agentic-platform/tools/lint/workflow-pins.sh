#!/usr/bin/env bash
# Spec: 158-workflow-ref-sha-pinning-lint (amends 116)
#
# workflow-pins.sh — enforce SHA-pinning of GitHub Actions `uses:` refs.
#
# A `uses:` line is classified as one of:
#   - local path:    uses: ./.github/actions/foo         → skip
#   - reusable wf:   uses: ./.github/workflows/foo.yml   → skip (local path)
#   - docker image:  uses: docker://image@sha256:<hex>   → skip (digest-pinned)
#   - action ref:    uses: owner/repo@<40-hex>           → pass
#   - unpinned:      uses: owner/repo@<tag-or-branch>    → FAIL
#   - dynamic:       uses: ${{ ... }}@${{ ... }}         → FAIL (closed)
#
# Output: file:line:ref on stderr for each unpinned ref.
# Exit:   0 if all pinned (or no files to scan)
#         1 if one or more refs are not SHA-pinned
#         2 if the lint cannot run (bad invocation or unsupported bash).
#           Exit 2 is distinct so CI can fail "gate could not execute"
#           differently from "gate found violations" — both must fail
#           CI, never silently pass.
#
# Soundness: the lint is a static proof system. Dynamic ${{ }}
# expressions in `uses:` refs are refused unconditionally because the
# lint cannot statically prove they resolve to a pinned SHA. Approving
# an unprovable claim would turn the contract into a suggestion.
#
# Methodology limitation (spec 158 §FR-NEW-4): the line-oriented grep
# approach has a known false-positive surface inside multi-line string
# scalars (heredocs, folded blocks). The spec converts this into a
# contract clause: workflow YAML MUST NOT embed example `uses:` lines
# inside string scalars. Examples that need to be embedded live in
# docs/examples/ instead, which the lint excludes by path.
#
# Same script runs in CI (ci-supply-chain.yml step) and as a pre-commit
# hook (.githooks/pre-commit). The lint is the compile; there is no
# allow-list for un-pinned refs — if you find yourself needing one,
# pin the ref instead.

set -euo pipefail

# Bash 4+ is required for `[[ =~ ]]` with named regex variables in
# the form used below, and for `${var,,}`-style features that may
# appear in future maintenance. macOS ships bash 3.2; devs need
# `brew install bash`. Fail fast with a clear message rather than
# misbehaving silently.
if (( BASH_VERSINFO[0] < 4 )); then
  echo "workflow-pins: requires bash 4+ (found ${BASH_VERSION}). On macOS: brew install bash" >&2
  exit 2
fi

usage() {
  cat <<EOF
usage: workflow-pins.sh [FILE ...]

Enforce SHA-pinning of GitHub Actions \`uses:\` refs. With no arguments,
scans .github/workflows/*.{yml,yaml} and .github/actions/**/*.{yml,yaml}
from the repository root.

Exit codes:
  0  all refs SHA-pinned (or no files to scan)
  1  one or more refs are not SHA-pinned (details on stderr)
  2  invalid invocation
EOF
}

case "${1:-}" in
  -h|--help) usage; exit 0 ;;
esac

# No-arg scans run from repo root regardless of cwd.
if [ "$#" -eq 0 ]; then
  if root="$(git rev-parse --show-toplevel 2>/dev/null)"; then
    cd "$root"
  fi
fi

files=()
if [ "$#" -eq 0 ]; then
  while IFS= read -r f; do
    [ -n "$f" ] && files+=("$f")
  done < <(find .github/workflows .github/actions \
              -type f \( -name '*.yml' -o -name '*.yaml' \) \
              2>/dev/null | sort)
else
  files=("$@")
fi

if [ "${#files[@]}" -eq 0 ]; then
  exit 0
fi

# YAML lets a `uses:` step appear either as a mapping key or as the
# first key of a list item (`- uses: ...`). All three regexes below
# accept the optional `- ` list-marker prefix.

# Pinned: uses: <ref>@<40-hex> followed by whitespace, EOL, or # comment.
pinned_re='^[[:space:]]*(-[[:space:]]+)?uses:[[:space:]]+[^@[:space:]#]+@[0-9a-f]{40}([[:space:]]|$|#)'

# `uses:` line carrying an @ that is not a local path. Docker refs are
# handled by an explicit skip before this regex applies, so they do not
# false-positive here.
unpinned_candidate_re='^[[:space:]]*(-[[:space:]]+)?uses:[[:space:]]+[^./[:space:]][^@[:space:]]*@'

# Match any `uses:` line, for grep pre-filtering.
any_uses_re='^[[:space:]]*(-[[:space:]]+)?uses:'

# docker:// skip pattern.
docker_re='^[[:space:]]*(-[[:space:]]+)?uses:[[:space:]]+docker://'

# Dynamic `${{ ... }}` expressions in a `uses:` line: the static lint
# cannot verify the resolved ref, so flag unconditionally. Forces
# literal in-YAML SHA-pinning per the spec-116 contract.
dynamic_re='^[[:space:]]*(-[[:space:]]+)?uses:.*\$\{\{'

unpinned_count=0

for f in "${files[@]}"; do
  while IFS=':' read -r lineno line; do
    [ -z "${lineno:-}" ] && continue

    # docker:// is digest-pinned via sha256: prefix; out of scope here.
    if [[ "$line" =~ $docker_re ]]; then
      continue
    fi

    # Dynamic refs (`${{ ... }}`) fail closed — no static proof of pin.
    if [[ "$line" =~ $dynamic_re ]]; then
      trimmed="${line#"${line%%[![:space:]]*}"}"
      printf '%s:%s:%s [dynamic ref — pin literally]\n' "$f" "$lineno" "$trimmed" >&2
      unpinned_count=$((unpinned_count + 1))
      continue
    fi

    if [[ "$line" =~ $pinned_re ]]; then
      continue
    fi

    if [[ "$line" =~ $unpinned_candidate_re ]]; then
      trimmed="${line#"${line%%[![:space:]]*}"}"
      printf '%s:%s:%s\n' "$f" "$lineno" "$trimmed" >&2
      unpinned_count=$((unpinned_count + 1))
    fi
  done < <(grep -nE "$any_uses_re" "$f" 2>/dev/null || true)
done

if [ "$unpinned_count" -gt 0 ]; then
  printf '\nworkflow-pins: %d unpinned ref(s) found. Pin to a full 40-hex SHA.\n' \
    "$unpinned_count" >&2
  printf 'See: https://docs.github.com/en/actions/security-for-github-actions/security-guides/security-hardening-for-github-actions#using-third-party-actions\n' >&2
  exit 1
fi

exit 0
