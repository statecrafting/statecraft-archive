#!/usr/bin/env bash
# Spec: 188-derived-index-merge-serialization
#
# Git merge driver `oap-index-regen` for the committed derived index shards
# under `.derived/codebase-index/` (by-spec/*, by-package/*, slices.json).
# When two branches both regenerated the index, a same-shard textual merge
# conflicts on the content hash. This driver resolves that conflict
# deterministically: regenerate the index from the merged working tree and
# hand the fresh shard back to git as the resolution, so a rebase onto a
# merged PR no longer leaves a conflict to resolve by hand (spec 188 Phase 1,
# FR-001/FR-002; sharded per spec 217, which makes same-shard conflicts rare).
#
# Enable in this clone (opt-in, mirrors `git config core.hooksPath
# .githooks` for the pre-commit hook):
#   git config merge.oap-index-regen.name "regenerate codebase index on conflict"
#   git config merge.oap-index-regen.driver ".githooks/merge-derived-index.sh %O %A %B %P"
#
# Disable:
#   git config --unset merge.oap-index-regen.driver
#   git config --unset merge.oap-index-regen.name
#
# Assignment lives in committed .gitattributes (shard globs, repointed with
# the committed shards per spec 217):
#   .derived/codebase-index/by-spec/*.json    merge=oap-index-regen
#   .derived/codebase-index/by-package/*.json merge=oap-index-regen
#
# Git invokes:  <driver> %O %A %B %P
#   $1 = %O  ancestor version  (unused — the index is fully derived)
#   $2 = %A  current/ours temp file — the driver MUST leave the merged
#            result here and exit 0 on success
#   $3 = %B  other/theirs version  (unused)
#   $4 = %P  pathname being merged (for logging)
#
# Fail-closed: if the spec-spine CLI is absent or `spec-spine index` fails,
# exit 1 and leave the conflict in place. The CI staleness gate
# (`spec-spine index check`, spec 101/184) remains the source of truth;
# this driver is a convenience over the conflict, never a replacement for
# the gate.
#
# Known limitation (spec 188, observed 2026-06-02): regeneration is only as
# complete as the working tree at git's driver-invocation moment, so on some
# rebases the auto-heal can still emit a stale-but-clean hash (it cannot
# self-detect — a `check` right after `compile` agrees with the same tree).
# The CI staleness gate / `make pr-prep` is the freshness source of truth,
# not this driver — see spec 188 User Story 1 "Known limitation".

set -eu

OURS="${2:?merge driver expects %A as \$2}"
PATHNAME="${4:-.derived/codebase-index/index.json}"

INDEX_DIR=.derived/codebase-index

if ! command -v spec-spine >/dev/null 2>&1; then
  cat >&2 <<EOF
[merge-derived-index] spec-spine CLI not on PATH; cannot auto-resolve $PATHNAME.
            Install it (\`make setup\` one-time, or \`cargo install spec-spine-cli
            --version 0.10.0 --locked\`), then re-run the rebase/merge, or resolve
            manually: make registry && git add $INDEX_DIR
EOF
  exit 1
fi

# Regenerate from the merged working tree. The indexer is deterministic
# for a given committed input set, so the regenerated index is the correct
# union of both branches' input changes.
if ! spec-spine index >/dev/null 2>&1; then
  cat >&2 <<EOF
[merge-derived-index] \`spec-spine index\` failed; leaving conflict in $PATHNAME
            for manual resolution (\`make registry && git add $INDEX_DIR\`).
EOF
  exit 1
fi

# Hand the freshly-regenerated shard back to git as the merge result. Git
# invokes this driver once per conflicting shard file ($PATHNAME); copy that
# specific regenerated file, not a monolithic index (sharded per spec 217 /
# 188; the .gitattributes glob repoint lands with the committed shards).
cp "$PATHNAME" "$OURS"
echo "[merge-derived-index] regenerated $PATHNAME from the merged tree." >&2
exit 0
