# Makefile: factory-encore developer + CI entry points.
#
# Thin wrapper over the npm scripts in package.json (the underlying authority)
# and the gate set enforced by .github/workflows/. A local `make ci` runs the
# same gates as CI, so if it passes locally the PR gates pass too. Add a new
# gate here AND in the owning workflow in the same change; never introduce a
# validation via a one-off script.

SHELL := /bin/bash
.DEFAULT_GOAL := help

NPX := npx --no-install
# Coupling gate base ref; override with `make spine-couple COUPLE_BASE=...`.
COUPLE_BASE ?= origin/main

.PHONY: help check-deps setup ci pr-prep \
        typecheck test lockstep \
        spine spine-compile spine-lint spine-index spine-index-check spine-couple

help: ## List available targets
	@grep -hE '^[a-zA-Z_-]+:.*?## ' $(MAKEFILE_LIST) \
	  | awk 'BEGIN{FS=":.*?## "}{printf "  %-20s %s\n", $$1, $$2}'

check-deps: ## Verify host prerequisites (node, npm, git)
	@for t in node npm git; do \
	  command -v $$t >/dev/null 2>&1 || { echo "missing prerequisite: $$t"; exit 1; }; \
	done
	@echo "prerequisites OK: node $$(node -v), npm $$(npm -v), $$(git --version)"

setup: check-deps ## One-time contributor setup: install deps, compile registry, build index
	npm install
	$(NPX) spec-spine compile
	$(NPX) spec-spine index

## --- spec-spine governance gate (mirrors .github/workflows/spec-spine.yml) ---

spine-compile: ## Compile the spec registry
	$(NPX) spec-spine compile

spine-lint: ## Corpus conformance lint (a warning is a failure)
	$(NPX) spec-spine lint --fail-on-warn

spine-index: ## Rebuild the codebase-index shards
	$(NPX) spec-spine index

spine-index-check: ## Staleness gate for the codebase index
	$(NPX) spec-spine index check

spine-couple: ## Spec/code coupling gate (HEAD vs COUPLE_BASE, default origin/main; fetch the base first)
	$(NPX) spec-spine couple --base $(COUPLE_BASE)

spine: spine-compile spine-lint spine-index-check spine-couple ## All four governance verbs in order

## --- generator gate (mirrors .github/workflows/generator-ci.yml) ---

typecheck: ## tsc --noEmit over the generator package
	npm run typecheck

test: ## Vitest generator/module/lockstep suite
	npm test

## --- lockstep gate (mirrors .github/workflows/ci-lockstep.yml) ---

lockstep: ## Verify the generator against the pinned template-encore baseline
	npm run lockstep

## --- composite entry points ---

ci: spine typecheck test lockstep ## Full local gate set: governance + typecheck + test + lockstep

pr-prep: spine-index spine-couple ## Pre-commit refresh: rebuild the index, then run the coupling gate
