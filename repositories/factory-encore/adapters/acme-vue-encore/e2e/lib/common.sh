#!/usr/bin/env bash
# common.sh -- shared config, logging, repo resolution, preflight.
# Sourced by run-e2e.sh. No side effects on source beyond setting vars.
#
# This harness lives inside factory-encore (adapters/acme-vue-encore/e2e), so
# FACTORY_ENCORE defaults to this repository root. TEMPLATE_ENCORE is the lean
# baseline passed to the generator as --source; locally it defaults to a sibling
# checkout, and in CI the workflow fetches the baseline (at the pinned ref, or
# at main for the drift sweep) into a directory and points TEMPLATE_ENCORE at it.

set -o pipefail

# ---------------------------------------------------------------------------
# Configuration (override via environment).
# ---------------------------------------------------------------------------
# FACTORY_ENCORE  : the generator-home checkout (default: this repo root)
# TEMPLATE_ENCORE : the lean-baseline checkout used as --source (default: sibling)
# OUT_DIR         : where prebuilts, generated apps, and logs land
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# e2e -> acme-vue-encore -> adapters -> repo root
FACTORY_ENCORE="${FACTORY_ENCORE:-$(cd "$HERE/../../.." && pwd)}"
TEMPLATE_ENCORE="${TEMPLATE_ENCORE:-$(cd "$FACTORY_ENCORE/../template-encore" 2>/dev/null && pwd)}"
OUT_DIR="${OUT_DIR:-$HERE/.out}"

ADAPTER_SCRIPTS="$FACTORY_ENCORE/adapters/acme-vue-encore/scripts"
SETUP_APP="$ADAPTER_SCRIPTS/setup-app.ts"
SETUP_DUAL="$ADAPTER_SCRIPTS/setup-dual-app.ts"
ADD_MODULE="$ADAPTER_SCRIPTS/add-module.ts"
TSX_CLI="$FACTORY_ENCORE/node_modules/tsx/dist/cli.mjs"

PREBUILT_DIR="$OUT_DIR/prebuilt"
APPS_DIR="$OUT_DIR/apps"
LOG_DIR="$OUT_DIR/logs"
RESULTS_TSV="$OUT_DIR/results.tsv"

# The five opt-in modules, in dependency-respecting INSTALL_ORDER (this is the
# exact order stagecraft's moduleCatalog.ts::INSTALL_ORDER applies).
INSTALL_ORDER=(security-core data-postgres data-redis api-gateway user-management)

# The four stagecraft prebuild profiles (templateCache.ts::PROFILE_SPECS).
PROFILES=(minimal public internal dual)

# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------
if [ -t 1 ]; then
  C_RST=$'\033[0m'; C_GRN=$'\033[32m'; C_RED=$'\033[31m'; C_YEL=$'\033[33m'; C_BLU=$'\033[34m'; C_DIM=$'\033[2m'
else
  C_RST=""; C_GRN=""; C_RED=""; C_YEL=""; C_BLU=""; C_DIM=""
fi
log()  { printf '%s\n' "${C_BLU}==>${C_RST} $*"; }
ok()   { printf '%s\n' "${C_GRN}PASS${C_RST} $*"; }
fail() { printf '%s\n' "${C_RED}FAIL${C_RST} $*"; }
warn() { printf '%s\n' "${C_YEL}warn${C_RST} $*"; }
dim()  { printf '%s\n' "${C_DIM}$*${C_RST}"; }

# ---------------------------------------------------------------------------
# Preflight: verify the toolchain and the two upstream checkouts exist.
# ---------------------------------------------------------------------------
preflight() {
  local errs=0
  log "preflight: toolchain + upstream checkouts"

  command -v node >/dev/null || { fail "node not found"; errs=1; }
  command -v npm  >/dev/null || { fail "npm not found"; errs=1; }
  if command -v node >/dev/null; then
    local nodemaj; nodemaj="$(node -p 'process.versions.node.split(".")[0]')"
    if [ "$nodemaj" -lt 24 ]; then warn "node $(node -v) < 24 (template engines require >=24)"; fi
  fi
  command -v encore >/dev/null || warn "encore CLI not found (build verification needs it)"
  command -v docker >/dev/null || warn "docker not found (encore check may need it)"

  [ -d "$FACTORY_ENCORE" ]  || { fail "FACTORY_ENCORE not found: $FACTORY_ENCORE"; errs=1; }
  [ -d "$TEMPLATE_ENCORE" ] || { fail "TEMPLATE_ENCORE not found: $TEMPLATE_ENCORE (pass --source or set TEMPLATE_ENCORE)"; errs=1; }
  [ -f "$SETUP_APP" ]   || { fail "setup-app.ts not found: $SETUP_APP"; errs=1; }
  [ -f "$SETUP_DUAL" ]  || { fail "setup-dual-app.ts not found: $SETUP_DUAL"; errs=1; }
  [ -f "$ADD_MODULE" ]  || { fail "add-module.ts not found: $ADD_MODULE"; errs=1; }

  # tsx is a factory-encore devDependency; install it once if absent.
  if [ ! -f "$TSX_CLI" ]; then
    warn "tsx absent in factory-encore; running 'npm install' there once"
    ( cd "$FACTORY_ENCORE" && npm install ) || { fail "npm install in factory-encore failed"; errs=1; }
  fi
  [ -f "$TSX_CLI" ] || { fail "tsx still missing: $TSX_CLI"; errs=1; }

  if [ "$errs" -ne 0 ]; then
    fail "preflight failed; resolve the above and re-run"
    return 1
  fi
  ok "preflight"
  dim "  factory-encore : $FACTORY_ENCORE"
  dim "  template-encore: $TEMPLATE_ENCORE"
  dim "  out            : $OUT_DIR"
  return 0
}

# Run a tsx-driven generator script with NO_INSTALL/NO_GIT so generation is
# fast and VCS-free (exactly as stagecraft's warmup runs it). Logs to $2.
run_tsx() {
  local logf="$1"; shift
  NO_INSTALL=true node "$TSX_CLI" "$@" >"$logf" 2>&1
}

mkdirs() { mkdir -p "$PREBUILT_DIR" "$APPS_DIR" "$LOG_DIR"; }

# slugify a comma list of modules into a filesystem-safe token
slug() { if [ -z "$1" ] || [ "$1" = "none" ]; then printf 'base'; else printf '%s' "$1" | tr ',' '+'; fi; }
