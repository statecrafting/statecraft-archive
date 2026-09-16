#!/usr/bin/env bash
# run-e2e.sh -- standalone end-to-end test of factory-encore + template-encore.
#
# Proves that the factory-encore generator, driven directly against a
# template-encore checkout, can do everything stagecraft's create-project flow
# does: materialise the four profile prebuilts (minimal/public/internal/dual)
# and compose every opt-in module, with each produced app verified by a real
# build (npm install + encore check + typecheck + build). No stagecraft, no OAP.
#
# It replicates the stagecraft contract found in:
#   platform/services/stagecraft/api/projects/scaffold/templateCache.ts  (prebuild)
#   platform/services/stagecraft/api/projects/scaffold/perRequestScaffold.ts (compose)
#   platform/services/stagecraft/api/projects/scaffold/moduleCatalog.ts  (INSTALL_ORDER)
#
# Usage:
#   ./run-e2e.sh                      full matrix: prebuild + every combo + build
#   ./run-e2e.sh prebuild             only materialise the 4 profile prebuilts
#   ./run-e2e.sh combo <profile> <mods>   one combo (mods = none|all|a,b,c)
#   ./run-e2e.sh matrix               the full (profile x modules) matrix
#   ./run-e2e.sh report               re-print the last results table
#
# Flags:
#   --no-build         structural assertions only; skip npm install + build
#   --profiles a,b     restrict the matrix to these profiles
#   --clean            wipe OUT_DIR before running
#   --keep             do not delete per-combo app trees after build (default)
#
# Env: FACTORY_ENCORE, TEMPLATE_ENCORE, OUT_DIR (see lib/common.sh).
set -o pipefail
source "$(dirname "${BASH_SOURCE[0]}")/lib/common.sh"

DO_BUILD=1
RESTRICT_PROFILES=""
KEEP_MODULES=0   # after a green build, drop node_modules to keep the matrix disk-safe

prune_modules() {
  # remove installed deps but keep the produced source tree + build output
  find "$1" -name node_modules -type d -prune -exec rm -rf {} + 2>/dev/null
}

# ---------------------------------------------------------------------------
# Stage 1 -- prebuild (stagecraft ensurePrebuilts). For each profile, run the
# manifest-declared generator with --source <template-encore>. NO_INSTALL keeps
# it fast and (because the generator treats NO_INSTALL as implying --no-git)
# VCS-free, matching the warmup path exactly.
# ---------------------------------------------------------------------------
prebuild_one() {
  local profile="$1" dest logf
  dest="$PREBUILT_DIR/$profile"
  logf="$LOG_DIR/prebuild-$profile.log"
  rm -rf "$dest"
  log "prebuild: $profile -> $dest"
  if [ "$profile" = "dual" ]; then
    run_tsx "$logf" "$SETUP_DUAL" --source "$TEMPLATE_ENCORE" --dest "$dest" --yes
  else
    run_tsx "$logf" "$SETUP_APP" --profile "$profile" --source "$TEMPLATE_ENCORE" --dest "$dest" --yes
  fi
  local rc=$?
  if [ $rc -ne 0 ]; then fail "prebuild $profile (rc=$rc); see $logf"; tail -15 "$logf"; return 1; fi
  ok "prebuild $profile"
}

prebuild_all() {
  mkdirs
  local p rc=0
  for p in "${PROFILES[@]}"; do
    if [ -n "$RESTRICT_PROFILES" ] && [[ ",$RESTRICT_PROFILES," != *",$p,"* ]]; then continue; fi
    prebuild_one "$p" || rc=1
  done
  return $rc
}

# ---------------------------------------------------------------------------
# Structural assertions -- prove the generator did what stagecraft expects,
# without compiling. $1 = app root dir, $2 = profile, $3 = comma module list.
# Appends "key=verdict" tokens to the global ASSERT_NOTES; sets ASSERT_RC.
# ---------------------------------------------------------------------------
af() { ASSERT_NOTES+="$1 "; }
assert_app() {
  local root="$1" profile="$2" mods="$3"
  ASSERT_RC=0; ASSERT_NOTES=""

  # A1 structure: backend + at least one SPA carried forward
  [ -d "$root/apps/api" ] || { fail "  no apps/api"; ASSERT_RC=1; }
  [ -f "$root/apps/api/encore.app" ] || { fail "  no apps/api/encore.app"; ASSERT_RC=1; }

  # A2 auth driver: minimal => mock, others => rauthy
  local want="rauthy"; [ "$profile" = "minimal" ] && want="mock"
  if grep -Eq "^AUTH_DRIVER=$want\b" "$root/apps/api/.env.example" 2>/dev/null; then
    af "auth=$want:ok"
  else
    fail "  AUTH_DRIVER not '$want' in apps/api/.env.example"; ASSERT_RC=1; af "auth=$want:MISS"
  fi

  # A3 no generator artifacts leaked into the produced app
  local leak=""
  for d in scripts modules orchestration; do [ -e "$root/$d" ] && leak+="$d "; done
  if [ -n "$leak" ]; then fail "  generator artifacts leaked: $leak"; ASSERT_RC=1; af "leak:YES"; else af "noleak:ok"; fi

  # A4/A5 per requested module: template.json record + payload + env var
  if [ -n "$mods" ] && [ "$mods" != "none" ]; then
    local m
    for m in ${mods//,/ }; do
      grep -q "\"$m\"" "$root/template.json" 2>/dev/null && af "$m:tmpl" || { warn "  $m not in template.json"; af "$m:NO-tmpl"; }
      case "$m" in
        api-gateway)
          [ -f "$root/apps/web/src/views/ConnectivityTestView.vue" ] && af "ag:file" || { fail "  api-gateway payload missing"; ASSERT_RC=1; }
          # A6 dependency auto-resolution: api-gateway requires security-core
          grep -q '"security-core"' "$root/template.json" 2>/dev/null && af "ag-dep:sec-core" || { fail "  api-gateway did not pull security-core"; ASSERT_RC=1; }
          ;;
        user-management)
          [ -f "$root/apps/web/src/views/admin/UserListView.vue" ] && af "um:file" || { fail "  user-management payload missing"; ASSERT_RC=1; }
          [ -d "$root/apps/api/user-management" ] && af "um:service" || { fail "  user-management service dir missing"; ASSERT_RC=1; }
          ls "$root/apps/api/db/migrations/"*user_management*.sql >/dev/null 2>&1 && af "um:migration" || { fail "  user-management migration missing"; ASSERT_RC=1; }
          ;;
        security-core)  af "sc:overlay" ;;
        data-redis)     grep -q "REDIS_URL" "$root/apps/api/.env.example" 2>/dev/null && af "redis:env" || warn "  REDIS_URL not in .env.example" ;;
        data-postgres)  af "pg:marker" ;;
      esac
    done
  fi
}

# ---------------------------------------------------------------------------
# Build verification -- the real "does it compile" gate. $1 = app root dir.
# Returns 0 only if install + encore check + typecheck + build all pass.
# ---------------------------------------------------------------------------
verify_build() {
  local root="$1" tag="$2" logf="$LOG_DIR/build-$tag.log"
  : >"$logf"
  _step() { local name="$1"; shift; printf '\n### %s: %s\n' "$name" "$*" >>"$logf"; ( cd "$root" && "$@" ) >>"$logf" 2>&1; }

  _step "root-install"   npm install --no-audit --no-fund         || { fail "  [$tag] npm install (root); see $logf"; return 1; }
  _step "api-install"    npm --prefix apps/api install --no-audit --no-fund || { fail "  [$tag] npm install (apps/api)"; return 1; }
  # keys are needed at runtime, not for check/build; best-effort
  ( cd "$root" && npm --prefix apps/api run generate-keys ) >>"$logf" 2>&1 || warn "  [$tag] generate-keys failed (non-fatal)"
  # Isolate the local DB: every generated app carries the same empty encore.app
  # id, so Encore maps them to one shared local Postgres and migration state
  # bleeds across apps. Reset before each check so each app migrates from clean
  # (the matrix runs serially, so this fully isolates). Tolerate failure when no
  # cluster/DB exists yet.
  ( cd "$root/apps/api" && encore db reset --all ) >>"$logf" 2>&1 || true
  _step "encore-check"   npm run typecheck:api                    || { fail "  [$tag] encore check (typecheck:api)"; return 1; }
  _step "typecheck"      npm run typecheck                        || { fail "  [$tag] typecheck (SPAs/packages)"; return 1; }
  _step "build"          npm run build                            || { fail "  [$tag] build"; return 1; }
  return 0
}

# ---------------------------------------------------------------------------
# A single combo: copy prebuilt -> dest, compose extras (add-module per the
# INSTALL_ORDER filter, exactly like perRequestScaffold), assert, then build.
# Dual is special: no extras; verify both public/ and internal/ sub-apps.
# ---------------------------------------------------------------------------
combo() {
  local profile="$1" mods_in="$2"
  local mods="$mods_in" tag dest src
  [ "$mods" = "none" ] && mods=""
  if [ "$mods_in" = "all" ]; then mods="$(IFS=,; echo "${INSTALL_ORDER[*]}")"; fi

  tag="${profile}__$(slug "$mods")"
  dest="$APPS_DIR/$tag"
  src="$PREBUILT_DIR/$profile"
  [ -d "$src" ] || { fail "missing prebuilt for $profile (run prebuild first)"; record "$profile" "$mods_in" "GEN" "no-prebuilt"; return 1; }

  log "combo: profile=$profile modules=[${mods:-none}] -> $tag"
  rm -rf "$dest"; mkdir -p "$dest"
  # copy excluding .git + node_modules (perRequestScaffold filter)
  ( cd "$src" && tar --exclude=.git --exclude=node_modules -cf - . ) | ( cd "$dest" && tar -xf - )

  # compose extras in INSTALL_ORDER; dual takes none (perRequestScaffold:103).
  # Skip any module the profile already shipped by default (post-STRUCT-1: read
  # from the prebuilt's template.json, the profile-default authority), mirroring
  # stagecraft moduleCatalog::extrasFor filtering out profile built-ins.
  local composed="" skipped=""
  if [ "$profile" != "dual" ] && [ -n "$mods" ]; then
    local want=",$mods,"
    local m
    for m in "${INSTALL_ORDER[@]}"; do
      [[ "$want" == *",$m,"* ]] || continue
      if [ -f "$dest/template.json" ] && grep -q "\"$m\"" "$dest/template.json"; then
        skipped+="$m "; continue
      fi
      local mlog="$LOG_DIR/addmod-$tag-$m.log"
      if NO_INSTALL=true ROOT="$dest" node "$TSX_CLI" "$ADD_MODULE" "$m" --yes --no-install --root "$dest" >"$mlog" 2>&1; then
        composed+="$m "
      else
        fail "  add-module $m failed; see $mlog"; tail -12 "$mlog"
        record "$profile" "$mods_in" "COMPOSE" "add-module:$m"
        return 1
      fi
    done
  fi
  ok "  composed: ${composed:-<none>}${skipped:+  (profile-default, skipped: $skipped)}"

  # structural assertions
  if [ "$profile" = "dual" ]; then
    assert_app "$dest/public" "public" ""; local ar1=$ASSERT_RC; local an1="$ASSERT_NOTES"
    assert_app "$dest/internal" "internal" ""; local ar2=$ASSERT_RC; local an2="$ASSERT_NOTES"
    [ -d "$dest/public" ] && [ -d "$dest/internal" ] && ok "  dual topology: public/ + internal/" || { fail "  dual missing a sub-app"; ar1=1; }
    ASSERT_RC=$(( ar1 || ar2 )); ASSERT_NOTES="public{$an1} internal{$an2}"
  else
    assert_app "$dest" "$profile" "$mods"
  fi
  [ "$ASSERT_RC" -eq 0 ] && ok "  structural: $ASSERT_NOTES" || fail "  structural failed: $ASSERT_NOTES"

  if [ "$DO_BUILD" -eq 0 ]; then
    record "$profile" "$mods_in" "$([ "$ASSERT_RC" -eq 0 ] && echo STRUCT-OK || echo STRUCT-FAIL)" "$ASSERT_NOTES"
    return $ASSERT_RC
  fi

  # build verification
  local brc=0
  if [ "$profile" = "dual" ]; then
    verify_build "$dest/public" "$tag-public" || brc=1
    verify_build "$dest/internal" "$tag-internal" || brc=1
  else
    verify_build "$dest" "$tag" || brc=1
  fi
  if [ "$brc" -eq 0 ] && [ "$ASSERT_RC" -eq 0 ]; then
    ok "  BUILD PASS [$tag]"; record "$profile" "$mods_in" "PASS" "$ASSERT_NOTES"
    [ "$KEEP_MODULES" -eq 0 ] && prune_modules "$dest"
  else
    fail "  BUILD/STRUCT FAIL [$tag]"; record "$profile" "$mods_in" "FAIL" "$ASSERT_NOTES"
    return 1
  fi
}

# results recording -------------------------------------------------------
record() { printf '%s\t%s\t%s\t%s\n' "$1" "$2" "$3" "$4" >>"$RESULTS_TSV"; }
report() {
  [ -f "$RESULTS_TSV" ] || { fail "no results yet"; return 1; }
  printf '\n%s\n' "${C_BLU}=== RESULTS ===${C_RST}"
  printf '%-9s %-26s %-12s %s\n' PROFILE MODULES VERDICT NOTES
  printf '%-9s %-26s %-12s %s\n' "-------" "------------------------" "----------" "-----"
  local pass=0 total=0 line
  while IFS=$'\t' read -r prof mods verdict notes; do
    total=$((total+1)); [ "$verdict" = "PASS" ] || [ "$verdict" = "STRUCT-OK" ] && pass=$((pass+1))
    local col="$C_GRN"; case "$verdict" in FAIL|*FAIL*|GEN|COMPOSE) col="$C_RED";; esac
    printf "%-9s %-26s ${col}%-12s${C_RST} %s\n" "$prof" "$mods" "$verdict" "$notes"
  done < "$RESULTS_TSV"
  printf '\n%s %d / %d combos green\n' "${C_BLU}summary:${C_RST}" "$pass" "$total"
  # Propagate the matrix verdict as the exit code so the CI lanes actually gate:
  # report is the terminal step of matrix() and the matrix/all/combo dispatch, so
  # a non-zero return here fails `npm run e2e:struct` / `e2e:build` on any red
  # combo (spec 007 FR-007). Zero combos is also a failure (nothing ran).
  [ "$total" -gt 0 ] && [ "$pass" -eq "$total" ]
}

# the full matrix ---------------------------------------------------------
matrix() {
  : >"$RESULTS_TSV"
  local p
  for p in "${PROFILES[@]}"; do
    if [ -n "$RESTRICT_PROFILES" ] && [[ ",$RESTRICT_PROFILES," != *",$p,"* ]]; then continue; fi
    if [ "$p" = "dual" ]; then
      combo dual none
    else
      combo "$p" none
      local m; for m in "${INSTALL_ORDER[@]}"; do combo "$p" "$m"; done
      combo "$p" all
    fi
  done
  report
}

# ---------------------------------------------------------------------------
# arg parse + dispatch
# ---------------------------------------------------------------------------
ARGS=()
while [ $# -gt 0 ]; do
  case "$1" in
    --no-build) DO_BUILD=0; shift;;
    --profiles) RESTRICT_PROFILES="$2"; shift 2;;
    --clean) rm -rf "$OUT_DIR"; shift;;
    --keep) shift;;
    --keep-modules) KEEP_MODULES=1; shift;;
    *) ARGS+=("$1"); shift;;
  esac
done
set -- "${ARGS[@]}"
CMD="${1:-all}"

case "$CMD" in
  prebuild) preflight && prebuild_all ;;
  combo)    preflight && mkdirs && { [ -d "$PREBUILT_DIR/${2:-}" ] || prebuild_one "${2:?profile}"; } && { : >"$RESULTS_TSV"; combo "${2:?profile}" "${3:-none}"; report; } ;;
  matrix)   preflight && prebuild_all && matrix ;;
  all)      preflight && prebuild_all && matrix ;;
  report)   report ;;
  *) echo "unknown command: $CMD (try: prebuild | combo | matrix | all | report)"; exit 2 ;;
esac
