# The composite gate (spec 008), from the spec-spine kit's `Makefile` with this
# repository's stack targets substituted for the kit's single-workspace probes.
#
# Two variables, both overridable:
#
#   SPEC_SPINE  the binary to govern with. This repository does not build one,
#               so the resolution order spec 051 established collapses to
#               $SPEC_SPINE then PATH.
#   BASE        the ref the coupling gate compares against. Resolved from the
#               repository rather than assumed to be origin/main (spec 072);
#               override it here or on the command line.
#
#   make gate                 read-only: the whole governed loop, in order
#   make gate PR_BODY=<file>  the same, with the PR body the waiver is read from
#   make refresh              writing: recompute the committed shard trees
#   make verify SPEC=008      run one spec's declared acceptance (spec 049)
#   make typecheck test licenses   the stack gate, which CI runs in govern.yml
#   make addons               compile all four napi-rs addons for this host
#
# The kit guards its language targets on a manifest probe at the repository
# root. That probe answers the wrong question here: there is no root
# `Cargo.toml`, and the Rust in this tree lives in four standalone workspaces
# under `addon/` plus the vendored Encore workspace under `vendor/encore/`.
# The targets below name those workspaces directly.

SPEC_SPINE ?= spec-spine
# Spec 072 3.3: the coupling base follows the branch this repository actually
# has. The same three steps the push gate resolves with, in the same order:
# $SPEC_SPINE_DEFAULT_BRANCH (make imports the environment, so `?=` leaves an
# exported value alone), then the remote's own HEAD, then `main`. An explicit
# `BASE=` on the command line still wins.
SPEC_SPINE_DEFAULT_BRANCH ?= $(shell git symbolic-ref --short refs/remotes/origin/HEAD 2>/dev/null | sed 's|^origin/||')
BASE       ?= origin/$(or $(SPEC_SPINE_DEFAULT_BRANCH),main)

# The four napi-rs addons, in ladder order (specs 003 through 006). Each is its
# own cargo workspace and its own npm package.
ADDONS ?= hiqlite-native kernel-native governance-native fleet-native

.PHONY: gate refresh verify typecheck test licenses addons sanity fmt clippy help

## The governed loop, read-only throughout. A gate that writes repairs what it
## is meant to judge (spec 046), so this uses `check` and never `compile`.
##
## PR_BODY is the path to a file holding the pull-request body, which the
## coupling gate reads to honour a `Spec-Drift-Waiver:` line. It exists so the
## pull-request leg of govern.yml can run THIS target instead of restating the
## four commands: a gate with two definitions is a gate that drifts. Empty
## locally, where there is no pull request to read. A file, never an argument:
## a body containing a waiver line has no safe shell quoting.
PR_BODY ?=

gate:
	$(SPEC_SPINE) check --fail-on-unresolved --fail-on-warn
	$(SPEC_SPINE) lint --fail-on-warn
	$(SPEC_SPINE) index coverage --fail-on-untraced
	$(SPEC_SPINE) couple --base $(BASE) --head HEAD $(if $(PR_BODY),--pr-body "$(PR_BODY)")

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

# --- the stack gate: what govern.yml runs beside the governed loop -----------

## The TypeScript surface: `packages/toolchain` and the root build harness.
typecheck:
	npm run typecheck

test:
	npm test

## Spec 001 section 3's license tiers and the section 3.2 dependency direction,
## enforced by scripts/check-licenses.mjs (spec 005 section 3.3). No npm install
## needed: it reads manifests and LICENSE files off disk.
licenses:
	npm run check:licenses

# --- the Rust surface: real targets, deliberately outside `gate` -------------

## Compile every addon for this host with the profile publish uses. Expensive
## (`lto = true` on hiqlite-native), so CI runs it path-filtered in build.yml
## across the three publish platforms rather than on every pull request.
addons:
	@for a in $(ADDONS); do \
	  echo "==> addon/$$a"; \
	  npm --prefix addon/$$a run build || exit 1; \
	done

## hiqlite-native's two behavioral sanity suites (spec 007 section 3 step 4).
## Both boot a single-voter node against a temp directory on loopback ports.
sanity:
	cd addon/hiqlite-native && node sanity.mjs && node sanity-state.mjs

## NOT part of `gate`, and not yet enforced by CI: three of the four addon
## workspaces are not rustfmt-clean, and reformatting them is a change to code
## owned by specs 003, 005 and 006 rather than to this harness. Kept as working
## targets so the cleanup is one command away when a spec claims it.
fmt:
	@for a in $(ADDONS); do \
	  echo "==> addon/$$a"; \
	  cargo fmt --manifest-path addon/$$a/Cargo.toml --all --check || exit 1; \
	done

clippy:
	@for a in $(ADDONS); do \
	  echo "==> addon/$$a"; \
	  cargo clippy --manifest-path addon/$$a/Cargo.toml --all-targets --locked -- -D warnings || exit 1; \
	done

help:
	@echo "gate       the governed loop, read-only"
	@echo "refresh    recompute the committed shard trees"
	@echo "verify     SPEC=<id>, one spec's declared acceptance"
	@echo "typecheck test licenses   the stack gate CI runs in govern.yml"
	@echo "addons     build all four napi-rs addons for this host"
	@echo "sanity     hiqlite-native's two behavioral sanity suites"
	@echo "fmt clippy the Rust hygiene targets, not part of gate (see the comment)"
