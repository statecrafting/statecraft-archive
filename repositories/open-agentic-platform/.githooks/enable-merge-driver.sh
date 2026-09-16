#!/usr/bin/env bash
# Spec: 188-derived-index-merge-serialization
#
# One-command, idempotent enablement of the `oap-index-regen` git merge
# driver in THIS clone. Run once per clone — the driver registration lives
# in per-clone `.git/config`, which is not committed, so each clone (you
# may keep several) must enable it locally. Worktrees created off a clone
# inherit the clone's config, so one run covers every worktree under it.
#
#   ./.githooks/enable-merge-driver.sh
#
# Disable:
#   git config --unset merge.oap-index-regen.driver
#   git config --unset merge.oap-index-regen.name
#
# The path→driver assignment (`.derived/codebase-index/index.json
# merge=oap-index-regen`) lives in committed `.gitattributes`, and the
# driver itself is `.githooks/merge-derived-index.sh` — both travel with
# the repo. This script only wires the non-committed registration that
# connects them. Safe to re-run; `git config` overwrites idempotently.

set -eu

# Resolve repo root so the script works from any CWD inside the worktree.
root="$(git rev-parse --show-toplevel)"
cd "$root"

git config merge.oap-index-regen.name "regenerate codebase index on conflict"
git config merge.oap-index-regen.driver ".githooks/merge-derived-index.sh %O %A %B %P"

echo "[enable-merge-driver] oap-index-regen registered in $root/.git/config"
echo "  name:      $(git config --get merge.oap-index-regen.name)"
echo "  driver:    $(git config --get merge.oap-index-regen.driver)"
echo "  path attr: $(git check-attr merge .derived/codebase-index/index.json)"
echo "[enable-merge-driver] index.json conflicts will now auto-regenerate on merge/rebase."
