# The composite gate (spec 013, from the spec-spine kit's Makefile).
#
# Two variables, both overridable:
#
#   SPEC_SPINE  the binary to govern with. statecraft does not build its own,
#               so the PATH binary is right here; the resolution order spec 051
#               established is $SPEC_SPINE, then ./target/release, then PATH.
#   BASE        the ref the coupling gate compares against. Resolved from
#               the repository rather than assumed to be origin/main
#               (spec 072); override it here or on the command line.
#
#   make gate                 read-only: the whole governed loop, in order
#   make refresh              writing: recompute the committed shard trees
#   make verify SPEC=013      run one spec's declared acceptance (spec 049)
#   make stack                the stack gate: the npm half of the PR gate
#
# `gate` is byte-identical to the kit's, so a kit update stays a copy rather
# than a merge. The stack targets below are statecraft's own and mirror
# .github/workflows/verify.yml.

SPEC_SPINE ?= spec-spine
# Spec 072 3.3: the coupling base follows the branch this repository
# actually has. The same three steps the push gate resolves with, in the
# same order: $SPEC_SPINE_DEFAULT_BRANCH (make imports the environment, so
# `?=` leaves an exported value alone), then the remote's own HEAD, then
# `main`. An explicit `BASE=` on the command line still wins.
SPEC_SPINE_DEFAULT_BRANCH ?= $(shell git symbolic-ref --short refs/remotes/origin/HEAD 2>/dev/null | sed 's|^origin/||')
BASE       ?= origin/$(or $(SPEC_SPINE_DEFAULT_BRANCH),main)

.PHONY: gate refresh verify stack test build typecheck help

## The governed loop, read-only throughout. A gate that writes repairs what it
## is meant to judge (spec 046), so this uses `check` and never `compile`.
gate:
	$(SPEC_SPINE) check --fail-on-unresolved --fail-on-warn
	$(SPEC_SPINE) lint --fail-on-warn
	$(SPEC_SPINE) index coverage --fail-on-untraced
	$(SPEC_SPINE) couple --base $(BASE) --head HEAD

## The writing half, for a live session that has edited a spec and can commit
## the regenerated shards with the change that made them stale.
refresh:
	$(SPEC_SPINE) compile
	$(SPEC_SPINE) index

## One spec's declared acceptance. Runs code the corpus declares (spec 049),
## which is why it is deliberately not part of `gate`.
verify:
	@test -n "$(SPEC)" || { echo "usage: make verify SPEC=<id>"; exit 3; }
	$(SPEC_SPINE) verify $(SPEC)

## The stack gate. Mirrors .github/workflows/verify.yml: the app builds both
## SPAs into backend/web/, generates encore.gen, checks the app model, then
## typechecks and tests. No cargo anywhere: the governance and fleet addons
## are pinned @statecrafting/* packages (specs 006/008), not in-tree crates.
stack: build typecheck test

build:
	npm run build:web
	npm run build:web-admin
	npm run build:app
	npm run check:model

typecheck:
	npm run typecheck
	npm --prefix frontend run typecheck

test:
	npm test
	npm --prefix frontend test

help:
	@echo "gate      the governed loop, read-only"
	@echo "refresh   recompute the committed shard trees"
	@echo "verify    SPEC=<id>, one spec's declared acceptance"
	@echo "stack     build + typecheck + test, the npm half of the PR gate"
