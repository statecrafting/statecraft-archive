# Template — Root Makefile
#
# Quick start:
#   make setup        # one-time: npm install (pulls the spec-spine CLI), compile registry + index
#   make spine        # all four governance verbs: compile, lint, index, couple
#   make pr-prep      # pre-commit gate: refresh index, run coupling check
#
# Governance is provided by the published `spec-spine` npm package
# (root package.json devDependencies). Spec: specs/000-bootstrap/spec.md

SPINE := npx --no-install spec-spine

.PHONY: setup check-deps spine spine-compile spine-lint spine-index \
        spine-index-check spine-couple registry pr-prep ci clean

# ============================================================
# Prerequisites
# ============================================================

check-deps:
	@echo "Checking prerequisites..."
	@command -v node >/dev/null 2>&1 || { echo "  MISSING: node (>=18) — https://nodejs.org"; exit 1; }
	@command -v npm  >/dev/null 2>&1 || { echo "  MISSING: npm"; exit 1; }
	@command -v git  >/dev/null 2>&1 || { echo "  MISSING: git"; exit 1; }
	@echo "All prerequisites found."

# ============================================================
# Setup (one-time)
# ============================================================

setup: check-deps
	@echo ""
	@echo "==> Installing dependencies (includes the spec-spine CLI)..."
	npm install
	@echo ""
	@echo "==> Compiling spec registry..."
	$(SPINE) compile
	@echo ""
	@echo "==> Compiling codebase index..."
	$(SPINE) index
	@echo ""
	@echo "==> Setup complete. Run 'make spine' after spec edits, 'make pr-prep' before commit."

# ============================================================
# Governance verbs (spec-spine)
# ============================================================

## All four verbs in gate order — mirrors .github/workflows/spec-spine.yml.
spine: spine-compile spine-lint spine-index-check spine-couple
	@echo "==> spine: all governance gates passed."

spine-compile:
	$(SPINE) compile

spine-lint:
	$(SPINE) lint --fail-on-warn

spine-index:
	$(SPINE) index

spine-index-check:
	$(SPINE) index check

## Coupling gate: refuses owned-path changes whose owning spec is not in
## the diff. Requires a fresh index (exit 2 = stale; run `make spine-index`).
spine-couple:
	$(SPINE) couple --base origin/main

## Recompile registry + index in one step (after spec edits).
registry: spine-compile spine-index
	@echo "==> Registry and index recompiled."

## Pre-PR / pre-commit gate. Regenerates the index and runs the coupling
## gate against origin/main — the two checks that fail first in CI when
## forgotten. Stage the .derived/codebase-index/ shards if they drifted.
pr-prep: spine-index spine-couple
	@echo ""
	@echo "==> pr-prep: index refreshed, coupling gate clean."
	@if ! git diff --quiet .derived/codebase-index/ 2>/dev/null; then \
	  echo ""; \
	  echo "  !  .derived/codebase-index/ shards drifted; stage them:"; \
	  echo "       git add .derived/codebase-index/"; \
	fi

# ============================================================
# Local CI loop
# ============================================================

## Local mirror of the PR gates: governance + lint + workspace tests.
ci: spine
	npm run lint
	npm run typecheck
	npm test
	bash tools/lint/workflow-pins-test.sh
	@echo "==> CI: all checks passed."

# ============================================================
# Cleanup
# ============================================================

clean:
	rm -rf .derived/spec-registry .derived/codebase-index
