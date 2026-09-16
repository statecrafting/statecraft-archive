#!/usr/bin/env bash
# Spec: 193-paired-release-cadence (amends 037, 086, 117)
#
# release-version-guard.sh — the pre-publish version-consistency gate.
#
# A product release is eligible to publish ONLY when its version is identical
# across every source of truth:
#
#   tag  ==  tauri.conf.json  ==  Cargo.toml  ==  package.json  ==  Cargo.lock
#        ( ==  SBOM component version, when an SBOM is supplied )
#
# This is the runtime defence against the 0.3.4-assets-under-a-v0.3.6-envelope
# class of bug: the release envelope took the tag while the artifacts took the
# (stale) committed version, and nothing asserted they agreed.
#
# Two modes:
#   release-version-guard.sh <product>                       internal consistency
#                                                            (all sources agree
#                                                             with each other)
#   release-version-guard.sh <product> <expected-version>    assert all == expected
#                                                            (the resolved tag)
#   release-version-guard.sh <product> <expected-version> <sbom.cdx.json>
#                                                            ... and the SBOM too
#
#   <product> ∈ { opc }   (axiomregent's arm was dropped 2026-06-04 — it is an
#                          internal bundled sidecar with no product version;
#                          spec 037/193, amended)
#
# Exit codes:
#   0  all sources agree (and equal <expected-version> when given)
#   1  version mismatch  → release is NOT eligible; discard the draft, no version burned
#   2  usage error / unknown product

set -euo pipefail

if root="$(git rev-parse --show-toplevel 2>/dev/null)"; then
  cd "$root"
fi

PRODUCT="${1:-}"
EXPECTED="${2:-}"
SBOM="${3:-}"

if [ -z "$PRODUCT" ]; then
  echo "usage: release-version-guard.sh <opc> [expected-version] [sbom.cdx.json]" >&2
  exit 2
fi

# First `^version = "X"` in a Cargo.toml [package] table.
cargo_toml_version() { grep -m1 -E '^version[[:space:]]*=' "$1" | sed -E 's/.*"([^"]+)".*/\1/'; }
# Version of a named [[package]] in a Cargo.lock.
cargo_lock_version() { awk -v n="$2" '$0=="name = \""n"\""{getline; print; exit}' "$1" | sed -E 's/.*"([^"]+)".*/\1/'; }
# .version from a JSON file.
json_version() { jq -r '.version' "$1"; }
# CycloneDX component version by component name.
sbom_component_version() { jq -r --arg n "$1" '[.components[]? | select(.name==$n) | .version] | first // ""' "$2"; }

declare -a NAMES VALUES
add() { NAMES+=("$1"); VALUES+=("$2"); }

case "$PRODUCT" in
  opc)
    base="product/apps/opc"
    add "tauri.conf.json" "$(json_version "$base/src-tauri/tauri.conf.json")"
    add "package.json"    "$(json_version "$base/package.json")"
    add "Cargo.toml"      "$(cargo_toml_version "$base/src-tauri/Cargo.toml")"
    add "Cargo.lock"      "$(cargo_lock_version "$base/src-tauri/Cargo.lock" opc)"
    COMPONENT="opc"
    ;;
  # spec 037/193 (amended 2026-06-04): the axiomregent arm is dropped. axiomregent
  # is an internal sidecar bundled by OPC, not an independently released product —
  # it has no product version to assert. Its commit-pin (build-ref == bundle-ref)
  # is structurally guaranteed by release-desktop.yml building it from the same
  # checkout. 'axiomregent' is now an unknown product → exit 2.
  *)
    echo "::error::unknown product '$PRODUCT' (expected: opc). axiomregent is a bundled sidecar with no standalone version (spec 037/193, amended)." >&2
    exit 2
    ;;
esac

# Reference version: the explicit expected (the tag), or the first source.
REF="${EXPECTED:-${VALUES[0]}}"
if [ -n "$EXPECTED" ]; then ORIGIN="tag/expected"; else ORIGIN="${NAMES[0]}"; fi

fail=0
echo "release-version-guard: product=$PRODUCT reference=$REF (from $ORIGIN)"
for i in "${!NAMES[@]}"; do
  if [ "${VALUES[$i]}" != "$REF" ]; then
    echo "::error::version mismatch [${NAMES[$i]}]: expected '$REF', got '${VALUES[$i]}'"
    fail=1
  else
    echo "  ✓ ${NAMES[$i]} = ${VALUES[$i]}"
  fi
done

# Optional SBOM component check. Mismatch is fatal; absence is a warning — syft
# component naming is scanner-version dependent and outside this repo's control.
if [ -n "$SBOM" ]; then
  if [ ! -f "$SBOM" ]; then
    echo "::error::SBOM file not found: $SBOM"; fail=1
  else
    sv="$(sbom_component_version "$COMPONENT" "$SBOM")"
    if [ -z "$sv" ]; then
      echo "::warning::SBOM component '$COMPONENT' absent from $SBOM — SBOM version assertion skipped"
    elif [ "$sv" != "$REF" ]; then
      echo "::error::version mismatch [SBOM:$COMPONENT]: expected '$REF', got '$sv'"; fail=1
    else
      echo "  ✓ SBOM[$COMPONENT] = $sv"
    fi
  fi
fi

if [ "$fail" -ne 0 ]; then
  echo "::error::release-version-guard FAILED for $PRODUCT (reference $REF) — release NOT eligible; discard the draft."
  exit 1
fi
echo "release-version-guard PASSED: $PRODUCT == $REF"
