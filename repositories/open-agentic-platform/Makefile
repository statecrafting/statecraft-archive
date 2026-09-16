# Open Agentic Platform — Root Makefile
#
# Quick start:
#   make setup   # one-time: install deps, build tools, compile spec registry
#   make dev     # start desktop app (Vite + Tauri with hot-reload)
#
# Platform services (optional, for org policy/auth work):
#   make dev-platform   # start statecraft + deployd-api in background
#   make dev-all        # desktop + platform services

.PHONY: setup dev dev-platform dev-all stop \
        axiomregent axiomregent-all fetch-axiomregent fetch-axiomregent-check \
        registry spec-compile spec-tools register-merge-driver ensure-spec-spine \
        index index-check index-render pr-prep \
        check-deps \
        agent-frontmatter-ts ci-agent-frontmatter-ts \
        build-certificate verify-certificate \
        ci ci-strict ci-rust ci-tools ci-config-hash ci-desktop ci-statecraft ci-statecraft-encore ci-schema-parity \
        factory-schema-lockstep \
        ci-supply-chain ci-supply-chain-cargo ci-supply-chain-pnpm ci-supply-chain-npm \
        ci-spec-code-coupling \
        ci-cross ci-parity \
        ci-fast-rust ci-fast-tools ci-fast-desktop \
        ci-fast-statecraft ci-fast-schema-parity \
        ci-fast-spec-coupling ci-fast-supply-chain

# ============================================================
# Prerequisites check
# ============================================================

check-deps:
	@echo "Checking prerequisites..."
	@command -v rustc  >/dev/null 2>&1 || { echo "  MISSING: rust    — curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh"; exit 1; }
	@command -v pnpm   >/dev/null 2>&1 || { echo "  MISSING: pnpm    — brew install pnpm"; exit 1; }
	@command -v bun    >/dev/null 2>&1 || { echo "  MISSING: bun     — brew install bun"; exit 1; }
	@command -v node   >/dev/null 2>&1 || { echo "  MISSING: node    — brew install node"; exit 1; }
	@command -v gh     >/dev/null 2>&1 || { echo "  MISSING: gh      — brew install gh, then run: gh auth login"; exit 1; }
	@echo "All prerequisites found."

# ============================================================
# Setup (one-time)
# ============================================================

setup: check-deps ensure-spec-spine
	@echo ""
	@echo "==> Installing pnpm workspace dependencies..."
	cd product && pnpm install
	@echo ""
	@echo "==> Compiling spec registry (spec-spine compile)..."
	spec-spine compile
	@echo ""
	@echo "==> Fetching axiomregent sidecar binary (before the index so the binary is present in the resolver's walk)..."
	@$(MAKE) fetch-axiomregent-check || echo "  WARN: fetch failed. Run 'make axiomregent' to build from source."
	@echo ""
	@echo "==> Building the codebase index (spec-spine index)..."
	spec-spine index
	@echo ""
	@echo "==> Building OAP code-index enricher..."
	cargo build --release --manifest-path tools/oap/oap-code-index-enrich/Cargo.toml --target-dir tools/oap/oap-code-index-enrich/target
	@echo ""
	@echo "==> Compiling OAP overlay (index-oap.json: required for /init's render step)..."
	./tools/oap/oap-code-index-enrich/target/release/oap-code-index-enrich
	@echo ""
	@echo "==> Building OAP registry enricher (registry-oap.json + governed-read authority verbs for /init)..."
	cargo build --release --manifest-path tools/oap/oap-registry-enrich/Cargo.toml --target-dir tools/oap/oap-registry-enrich/target
	@echo ""
	@echo "==> Registering oap-index-regen git merge driver (spec 188)..."
	@$(MAKE) register-merge-driver
	@echo ""
	@echo "==> Setup complete. Run 'make dev' to start."

# ============================================================
# Git merge driver registration (spec 188)
# ============================================================
## tag: merge-driver

# Register the per-clone `oap-index-regen` merge driver (spec 188). The
# path→driver assignment is committed in `.gitattributes`; this wires the
# non-committed `.git/config` registration that activates it. Idempotent;
# `make setup` runs it, and it stands alone for clones bootstrapped before
# spec 188 landed. Worktrees inherit the registration from their clone.
register-merge-driver:
	@./.githooks/enable-merge-driver.sh

# ============================================================
# axiomregent sidecar binary
# ============================================================
## tag: axiomregent-build

# Default repo for `gh run download`. Auto-detected from the local git remote
# when possible; otherwise falls back to the canonical path so fresh clones from
# a fork still resolve to the upstream CI build artifacts.
AXIOMREGENT_REPO   ?= $(shell git config --get remote.origin.url 2>/dev/null | sed -E 's,.*github.com[:/](.+)\.git,\1,' | sed -E 's,.*github.com[:/](.+)$$,\1,' | head -1)
ifeq ($(AXIOMREGENT_REPO),)
AXIOMREGENT_REPO   := statecrafting/open-agentic-platform
endif
AXIOMREGENT_BINDIR = product/apps/opc/src-tauri/binaries

axiomregent:
	@echo "==> Building axiomregent from source..."
	cargo build --release --manifest-path crates/axiomregent/Cargo.toml --target-dir crates/axiomregent/target
	@HOST_TRIPLE=$$(rustc -vV | grep '^host:' | awk '{print $$2}'); \
	EXT=""; \
	case "$$HOST_TRIPLE" in *windows*) EXT=".exe";; esac; \
	SRC="crates/axiomregent/target/release/axiomregent$$EXT"; \
	DST="$(AXIOMREGENT_BINDIR)/axiomregent-$$HOST_TRIPLE$$EXT"; \
	mkdir -p $(AXIOMREGENT_BINDIR); \
	cp "$$SRC" "$$DST"; \
	case "$$HOST_TRIPLE" in *windows*) ;; *) strip "$$DST" 2>/dev/null || true;; esac; \
	echo "    -> $$DST"

## Build axiomregent for every supported target and install into the sidecar dir.
## Replaces scripts/build-axiomregent.sh --all (spec 105 Phase 3).
## Prerequisite per target: `rustup target add <triple>`.
axiomregent-all:
	@set -e; mkdir -p $(AXIOMREGENT_BINDIR); \
	 for t in $(CI_CROSS_TARGETS); do \
	   echo "==> axiomregent-all: $$t"; \
	   cargo build --release --target $$t --manifest-path crates/axiomregent/Cargo.toml; \
	   EXT=""; case "$$t" in *windows*) EXT=".exe";; esac; \
	   SRC=crates/target/$$t/release/axiomregent$$EXT; \
	   DST=$(AXIOMREGENT_BINDIR)/axiomregent-$$t$$EXT; \
	   cp "$$SRC" "$$DST"; \
	   case "$$t" in *windows*) ;; *) strip "$$DST" 2>/dev/null || true;; esac; \
	   echo "    -> $$DST"; \
	 done

## Fetch the pre-built axiomregent sidecar for the host triple from the latest
## successful build-axiomregent.yml CI run (a non-ceremonial per-commit artifact,
## 30-day retention) — NOT a release. axiomregent has no standalone release; it is
## an internal sidecar bundled by OPC (specs 037/193/105, amended). Replaces the
## former `gh release download` path (spec 105 Phase 2; re-pointed after the demotion).
##
## TRUST NOTE: this pulls a per-commit CI artifact (produced on every push to main),
## NOT an attested/human-gated release asset, and it is NOT attestation-verified.
## For a zero-trust-delegation sidecar built from your own checkout — and the
## offline / no-CI fallback — use `make axiomregent` (build from source).
fetch-axiomregent:
	@command -v gh >/dev/null 2>&1 || { echo "  MISSING: gh — brew install gh, then run: gh auth login. Or build from source: make axiomregent"; exit 1; }
	@HOST=$$(rustc -vV | grep '^host:' | awk '{print $$2}'); \
	 EXT=""; case "$$HOST" in *windows*) EXT=".exe";; esac; \
	 ART="axiomregent-$$HOST$$EXT"; \
	 mkdir -p $(AXIOMREGENT_BINDIR); \
	 echo "==> fetch-axiomregent: $$HOST (latest build-axiomregent.yml artifact)"; \
	 RUN_ID=$$(gh run list --repo $(AXIOMREGENT_REPO) --workflow build-axiomregent.yml \
	    --branch main --status success --limit 1 --json databaseId --jq '.[0].databaseId'); \
	 if [ -z "$$RUN_ID" ] || [ "$$RUN_ID" = "null" ]; then \
	   echo "  no successful build-axiomregent.yml run found on main — build from source: make axiomregent"; \
	   exit 1; \
	 fi; \
	 echo "  WARNING: fetching an UNATTESTED per-commit CI artifact (run $$RUN_ID), not a verified release."; \
	 echo "           For a verified, build-from-your-checkout sidecar: make axiomregent"; \
	 TMP=$$(mktemp -d); \
	 gh run download "$$RUN_ID" --repo $(AXIOMREGENT_REPO) --name "$$ART" --dir "$$TMP" \
	   || { rm -rf "$$TMP"; echo "  download failed — build from source: make axiomregent"; exit 1; }; \
	 SRC=$$(find "$$TMP" -type f -name "$$ART" | head -1); \
	 if [ -z "$$SRC" ]; then rm -rf "$$TMP"; echo "  artifact contained no $$ART — build from source: make axiomregent"; exit 1; fi; \
	 mv "$$SRC" "$(AXIOMREGENT_BINDIR)/$$ART"; \
	 rm -rf "$$TMP"; \
	 case "$$HOST" in *windows*) ;; *) chmod +x "$(AXIOMREGENT_BINDIR)/$$ART" 2>/dev/null || true;; esac; \
	 echo "    -> $(AXIOMREGENT_BINDIR)/$$ART"

## Idempotent variant: skip fetch if the sidecar is already present for the host triple.
fetch-axiomregent-check:
	@HOST=$$(rustc -vV | grep '^host:' | awk '{print $$2}'); \
	 EXT=""; case "$$HOST" in *windows*) EXT=".exe";; esac; \
	 BIN=$(AXIOMREGENT_BINDIR)/axiomregent-$$HOST$$EXT; \
	 if [ -f "$$BIN" ]; then \
	   echo "  axiomregent sidecar present at $$BIN"; \
	 else \
	   $(MAKE) fetch-axiomregent; \
	 fi

# ============================================================
# spec-spine CLI (the published governance engine; the in-tree engine
# crates were deleted per spec 217). Targets below assume `spec-spine`
# is on PATH; `make setup` installs the pinned version via the
# `ensure-spec-spine` prerequisite.
# ============================================================
SPEC_SPINE_VERSION ?= 0.10.0

ensure-spec-spine:
	@if [ "$$(spec-spine --version 2>/dev/null | awk '{print $$2}')" != "$(SPEC_SPINE_VERSION)" ]; then \
	    echo "==> Installing spec-spine $(SPEC_SPINE_VERSION) CLI (cargo install spec-spine-cli)..."; \
	    cargo install spec-spine-cli --version $(SPEC_SPINE_VERSION) --locked --force; \
	  else \
	    echo "  spec-spine $(SPEC_SPINE_VERSION) present"; \
	  fi

# ============================================================
# Spec tools
# ============================================================
## tag: registry

## Recompile spec registry + codebase index in one step (102 FR-026).
registry: spec-compile oap-registry-enrich index oap-code-index-enrich ci-schema-parity
	@echo "==> Registry and index recompiled."

## Cut D W-06a: emit .derived/spec-registry/registry-oap.json from the
## generic registry.json + spec corpus + .factory/build-spec.yaml walk
## (specs 074 / 102). OAP-internal CI artifact; never shipped via
## release-tools.yml.
oap-registry-enrich:
	cargo build --release --manifest-path tools/oap/oap-registry-enrich/Cargo.toml --target-dir tools/oap/oap-registry-enrich/target
	./tools/oap/oap-registry-enrich/target/release/oap-registry-enrich

## Cut D W-07a: emit .derived/codebase-index/index-oap.json from the
## generic index.json + walks over
## platform/services/statecraft/api/factory/ (post-spec-160 relocation,
## see CLAUDE.md), .claude/{agents,commands,rules,schemas}, .github/workflows
## (specs 101 + 118). OAP-internal CI artifact; never shipped via
## release-tools.yml.
oap-code-index-enrich:
	cargo build --release --manifest-path tools/oap/oap-code-index-enrich/Cargo.toml --target-dir tools/oap/oap-code-index-enrich/target
	./tools/oap/oap-code-index-enrich/target/release/oap-code-index-enrich

## Pre-PR / pre-commit prep. Regenerates the codebase index (catches the
## hash drift the staleness check fires on) and runs the spec-code
## coupling gate against origin/main. Run before `git commit` on PRs so
## the corresponding CI check passes first try.
##
## Index inputs (see spec-spine.toml [index] extra_hashed_inputs + the always-hashed core):
##   Cargo.toml, workspace + tool Cargo.tomls, package.json, pnpm-workspace.yaml,
##   specs/*/spec.md, platform/services/statecraft/api/factory/adapter-scopes.json
##   (post-spec-160; was factory/adapters/*/manifest.yaml),
##   platform/services/statecraft/api/factory/process-stages/*
##   (post-spec-160; was factory/process/stages/*),
##   .claude/{agents,commands,rules}/**/*.md,
##   standards/schemas/**/*.{json,yaml,yml}, .github/workflows/*.yml — i.e. most of what you'd
##   normally edit in a non-trivial PR.
pr-prep: index ci-fast-spec-coupling
	@echo ""
	@echo "==> pr-prep: codebase-index regenerated (gitignored, not committed per spec 188 Phase 4b), coupling gate clean."

spec-compile: ensure-spec-spine
	spec-spine compile

## Build the surviving OAP overlay lint binaries. The generic engine
## crates were deleted in spec 217; the published `spec-spine` CLI
## (ensured above) replaces them. spec-lint and stakeholder-doc-lint are
## OAP-domain overlays that survive.
spec-tools: ensure-spec-spine
	cargo build --release --manifest-path tools/spec-spine/spec-lint/Cargo.toml --target-dir tools/spec-spine/spec-lint/target
	cargo build --release --manifest-path tools/oap/stakeholder-doc-lint/Cargo.toml --target-dir tools/oap/stakeholder-doc-lint/target

# ============================================================
# agent-frontmatter TS mirror (spec 111 §2.1, Phase 2)
# ============================================================
#
# The `agent-frontmatter` crate (spec 054) owns the `UnifiedFrontmatter`
# type. `cargo test` on that crate regenerates the TypeScript mirror
# under platform/services/statecraft/api/agents/frontmatter/ via ts-rs.
# Two targets:
#   agent-frontmatter-ts       regenerate the bindings (write-through)
#   ci-agent-frontmatter-ts    regenerate + fail if the working tree drifts

AGENT_FRONTMATTER_TS_DIR = platform/services/statecraft/api/agents/frontmatter

agent-frontmatter-ts:
	cargo test --manifest-path crates/agent-frontmatter/Cargo.toml
	@echo "==> agent-frontmatter TS mirror regenerated at $(AGENT_FRONTMATTER_TS_DIR)/"

## CI drift gate: regenerate bindings, then require a clean working tree
## for the generated dir. Any modified or untracked file means the Rust
## type changed without a corresponding commit of the regenerated TS.
ci-agent-frontmatter-ts:
	cargo test --manifest-path crates/agent-frontmatter/Cargo.toml
	@git diff --exit-code -- $(AGENT_FRONTMATTER_TS_DIR) || { \
	    echo "ERROR: agent-frontmatter TS mirror has modified files."; \
	    echo "Run 'make agent-frontmatter-ts' and commit the result."; \
	    exit 1; \
	}
	@UNTRACKED=$$(git ls-files --others --exclude-standard -- $(AGENT_FRONTMATTER_TS_DIR)); \
	 if [ -n "$$UNTRACKED" ]; then \
	    echo "ERROR: agent-frontmatter TS mirror has untracked files:"; \
	    echo "$$UNTRACKED"; \
	    echo "A new #[derive(TS)] type was added without committing its generated .ts."; \
	    exit 1; \
	 fi

# ============================================================
# Governance Certificate (spec 102 FR-003 / FR-007 / FR-009)
# ============================================================
#
# Two operator-facing targets pair with the live emission wired into
# `factory-run` (see crates/factory-engine/src/bin/factory_run.rs):
#
#   make build-certificate FILE=<run-dir>      Generate a certificate from
#                                              an existing factory run dir
#                                              (retroactive certification).
#                                              Optional: BUSINESS_DOCS=...,
#                                              ADAPTER=...
#   make verify-certificate FILE=<cert-json>   Independently verify a
#                                              certificate by re-deriving
#                                              artifact hashes. Optional:
#                                              ARTIFACT_DIR=<run-dir>.
#
# Both targets build the binaries with --release; cold first build
# compiles factory-engine, warm rebuilds are seconds.

FACTORY_ENGINE_MANIFEST = crates/factory-engine/Cargo.toml
# factory-engine is a member of the `crates/` workspace, so cargo writes
# all binaries to the shared workspace target dir.
FACTORY_ENGINE_TARGET   = crates/target/release

build-certificate:
	@if [ -z "$(FILE)" ]; then \
	    echo "ERROR: FILE=<run-dir> is required."; \
	    echo "  example: make build-certificate FILE=./demo/.factory/runs/<run-id>"; \
	    exit 1; \
	fi
	@cargo build --release --manifest-path $(FACTORY_ENGINE_MANIFEST) --bin build-certificate --target-dir crates/target
	@./$(FACTORY_ENGINE_TARGET)/build-certificate "$(FILE)" \
	    $(if $(ADAPTER),--adapter $(ADAPTER)) \
	    $(if $(REQUIREMENTS_HASH),--requirements-hash $(REQUIREMENTS_HASH)) \
	    $(if $(BUSINESS_DOCS),--business-docs $(BUSINESS_DOCS))

verify-certificate:
	@if [ -z "$(FILE)" ]; then \
	    echo "ERROR: FILE=<governance-certificate.json> is required."; \
	    echo "  example: make verify-certificate FILE=./demo/.factory/runs/<run-id>/governance-certificate.json"; \
	    exit 1; \
	fi
	@cargo build --release --manifest-path $(FACTORY_ENGINE_MANIFEST) --bin verify-certificate --target-dir crates/target
	@./$(FACTORY_ENGINE_TARGET)/verify-certificate "$(FILE)" \
	    $(if $(ARTIFACT_DIR),--artifact-dir $(ARTIFACT_DIR)) \
	    $(if $(PLATFORM_JWKS),--platform-jwks $(PLATFORM_JWKS)) \
	    $(if $(JWKS_URL),--jwks-url $(JWKS_URL)) \
	    $(if $(REQUIRE_SEALED),--require-sealed)

# ============================================================
# Codebase Index
# ============================================================
#
# The index is built by the published `spec-spine` CLI (`spec-spine index`,
# bare: there is no `index compile` subcommand). The pinned CLI version
# (SPEC_SPINE_VERSION, installed by `make setup` via ensure-spec-spine)
# makes the content hash deterministic across machines, replacing the
# in-tree indexer's rebuild-before-invoke guard (issue #46).

index: ensure-spec-spine
	spec-spine index

index-check: ensure-spec-spine
	spec-spine index check

## Generic Layers 1+2+Diagnostics rendering (Epic 2 I11 restored).
## Goes to stdout; redirect to capture.
index-render-generic: ensure-spec-spine
	spec-spine index render

## OAP-overlay (Layers 1-5) markdown rendering.
## Requires index-oap.json (produced by `make oap-code-index-enrich`).
index-render:
	cargo build --release --manifest-path tools/oap/oap-code-index-enrich/Cargo.toml --target-dir tools/oap/oap-code-index-enrich/target
	./tools/oap/oap-code-index-enrich/target/release/oap-code-index-enrich render

# ============================================================
# Adapter Scopes (removed in spec 108 — see factory_adapters table;
# repointed by spec 160 — see factory_artifact_substrate table)
# ============================================================
# adapter-scopes.json was historically compiled from the legacy
# `factory/adapters/*/manifest.yaml` directory (retired in the spec 108
# relocation). Spec 108 moved adapter manifests into the `factory_adapters`
# table; spec 139 then absorbed those rows into the universal
# `factory_artifact_substrate` table. The bundled snapshot at
# platform/services/statecraft/api/factory/adapter-scopes.json is retained
# as a static fallback and is the file the spec-spine index hashes per
# spec 160 (replacing the legacy in-tree manifest walk).

# ============================================================
# Development — Desktop App
# ============================================================

dev:
	@echo "==> Starting OPC desktop (Vite + Tauri)..."
	@echo "    This will compile Rust on first run (~2-3 min)."
	@echo ""
	cd product/apps/opc && pnpm tauri dev

# ============================================================
# Development — Platform Services
# ============================================================

dev-statecraft:
	@echo "==> Starting statecraft (Encore.ts, port 4000)..."
	@command -v encore >/dev/null 2>&1 || { echo "  MISSING: encore — brew install encoredev/tap/encore"; exit 1; }
	cd platform/services/statecraft && npm install --silent && npm run start

dev-deployd:
	@echo "==> Starting deployd-api (Rust/axum, port 8080)..."
	DEPLOYD_DATA_DIR=$(CURDIR)/.local/deployd DEPLOYD_AUDIENCE=deployd-local DEPLOYD_REQUIRED_SCOPE=deployd:admin cargo run --manifest-path platform/services/deployd-api-rs/Cargo.toml

dev-platform:
	@echo "==> Starting platform services in background..."
	@echo "    statecraft → http://localhost:4000"
	@echo "    deployd    → http://localhost:8080"
	@echo ""
	@$(MAKE) dev-statecraft &
	@$(MAKE) dev-deployd &
	@echo "Platform services starting. Use 'make stop' to kill them."

dev-all:
	@$(MAKE) dev-platform
	@sleep 2
	@$(MAKE) dev

stop:
	@echo "==> Stopping background services..."
	-@pkill -f "encore run" 2>/dev/null || true
	-@pkill -f "deployd-api" 2>/dev/null || true   # literal binary name; the prior `deployd.api` regex matched any character in place of `-`.
	@echo "Done."

# ============================================================
# Cloud deployment (delegates to platform/Makefile)
# ============================================================

deploy-%:
	cd platform && $(MAKE) deploy TARGET=$*

destroy-%:
	cd platform && $(MAKE) destroy TARGET=$*

# ============================================================
# CI parity — single source of truth for local end-to-end validation.
#
# Spec 135 (2026-05-03) reversed the daily/pre-merge defaults:
#   `make ci`        — parallel fast loop (≈ 5 min warm). Daily dev loop.
#                      Lives under the `# BEGIN ci-fast (spec 134)` /
#                      `# END ci-fast` sentinel below; parity-exempt.
#   `make ci-strict` — parity mirror (≈ 90 min). Pre-merge release
#                      verification or parity-drift investigation.
#                      The recipe in this section.
#
# `make ci-strict` mirrors every gate enforced by .github/workflows/.
# If it passes locally, CI will pass too. Any new workflow gate MUST be
# added here in the same change — never a one-off script under scripts/.
#
# Composes:
#   ci-rust       — Rust workspace + deployd-api-rs: check + clippy
#                   -D warnings + test (covers all 18 crates/ workspace
#                   members in one --workspace invocation per spec 135 FR-01)
#   ci-tools      : OAP overlay-tool crates + spec-spine engine smokes
#                   (spec-conformance.yml)
#   ci-desktop    — product/apps/opc: tauri rust (custom clippy flags) +
#                   version alignment + tsc --noEmit + vitest (ci-desktop.yml)
#   ci-statecraft — platform/services/statecraft: npm ci + tsc + vitest
#                   (ci-statecraft.yml)
#
# Opt-in (not part of `ci-strict`):
#   ci-cross      — axiomregent cross-target matrix (build-axiomregent.yml);
#                   requires `rustup target add <triple>` per target.
# ============================================================

ci-strict: ci-rust ci-tools ci-config-hash ci-desktop ci-statecraft ci-statecraft-encore ci-schema-parity factory-schema-lockstep ci-spec-code-coupling ci-supply-chain
	@echo ""
	@echo "==> ci-strict: parity-mirror gates passed."

# ============================================================
# Narrow Claude shared-config staleness gate (spec 188 Phase 3)
# ============================================================
## tag: ci-config-hash

# Mirrors the check-config step inside .github/workflows/spec-conformance.yml
# for `make ci-strict` parity (spec 104; the standalone ci-config-hash.yml
# was deleted 2026-06-10, see spec 188's amendment). Gates the committed
# `claude-config` slice (.claude/settings.json + .mcp.json) declared under
# spec-spine.toml [index.slices] and emitted to .derived/codebase-index/
# slices.json: the narrow PR-time gate that preserves spec 184's guarantee
# after the broad index-freshness check became best-effort/report-only
# (spec 188 Phase 3). Spec 217 replaced the in-tree config-hash check
# with `spec-spine index check --slice claude-config`; behavior is
# unchanged.
ci-config-hash: ensure-spec-spine
	@echo ""
	@echo "==> ci-config-hash: Claude shared-config slice staleness"
	spec-spine index check --slice claude-config

# Rust validation (spec 135 FR-01): the `crates/` workspace is validated
# once via `cargo --workspace --manifest-path crates/Cargo.toml`, covering
# all 18 workspace members in a single invocation set. `deployd-api-rs`
# lives in its own workspace and stays as a separate per-manifest call.
# Desktop has different clippy flags and is handled in ci-desktop. Tool
# crates have extra smoke/contract steps and are handled in ci-tools.
ci-rust:
	@echo ""
	@echo "==> ci-rust: crates/ workspace (18 members)"
	cargo check  --workspace --manifest-path crates/Cargo.toml
	cargo clippy --workspace --manifest-path crates/Cargo.toml -- -D warnings
	cargo test   --workspace --manifest-path crates/Cargo.toml
	@echo ""
	@echo "==> ci-rust: platform/services/deployd-api-rs/Cargo.toml"
	cargo check  --manifest-path platform/services/deployd-api-rs/Cargo.toml
	cargo clippy --manifest-path platform/services/deployd-api-rs/Cargo.toml -- -D warnings
	cargo test   --manifest-path platform/services/deployd-api-rs/Cargo.toml

ci-tools: ensure-spec-spine
	@echo "==> ci-tools: spec-spine compile (engine smoke; replaces the deleted in-tree compiler, spec 217)"
	spec-spine compile
	@echo ""
	@echo "==> ci-tools: spec-spine registry (read-path smoke; replaces the deleted in-tree registry reader, spec 217)"
	spec-spine registry list | head -n 5
	@echo ""
## tag: spec-lint
	@echo "==> ci-tools: spec-lint"
	cargo build --release --manifest-path tools/spec-spine/spec-lint/Cargo.toml --target-dir tools/spec-spine/spec-lint/target
	./tools/spec-spine/spec-lint/target/release/spec-lint --fail-on-warn   # spec 128: strict posture (amends spec 006)
	cargo test --manifest-path tools/spec-spine/spec-lint/Cargo.toml
	@echo ""
	@echo "==> ci-tools: stakeholder-doc-lint (spec 122 FR-035)"
	cargo build --release --manifest-path tools/oap/stakeholder-doc-lint/Cargo.toml --target-dir tools/oap/stakeholder-doc-lint/target
	cargo clippy --manifest-path tools/oap/stakeholder-doc-lint/Cargo.toml -- -D warnings
	cargo test --manifest-path tools/oap/stakeholder-doc-lint/Cargo.toml
	./tools/oap/stakeholder-doc-lint/target/release/stakeholder-doc-lint --project . || true   # warnings non-blocking by default (FR-035)
	@echo ""
	@echo "==> ci-tools: spec-spine index (engine smoke; replaces the deleted in-tree indexer, spec 217; broad staleness gate retired per spec 188 Phase 4b)"
	spec-spine index
	@echo ""
	@echo "==> ci-tools: policy-compiler"
	cargo build --release --manifest-path tools/oap/policy-compiler/Cargo.toml --target-dir tools/oap/policy-compiler/target
	cargo test --manifest-path tools/oap/policy-compiler/Cargo.toml
	@echo ""
	@echo "==> ci-tools: assumption-cascade-check (spec 121 FR-034)"
	cargo build --release --manifest-path tools/oap/assumption-cascade-check/Cargo.toml --target-dir tools/oap/assumption-cascade-check/target
	cargo test --manifest-path tools/oap/assumption-cascade-check/Cargo.toml
	./tools/oap/assumption-cascade-check/target/release/assumption-cascade-check --repo .

ci-desktop:
	@# CI creates these stubs on fresh checkout; locally only if missing.
	@test -f product/apps/opc/dist/index.html || { \
	    mkdir -p product/apps/opc/dist; \
	    echo '<!doctype html><html><body>stub</body></html>' > product/apps/opc/dist/index.html; \
	    echo "  (created dist stub)"; \
	}
	@HOST=$$(rustc -vV | grep '^host:' | awk '{print $$2}'); \
	 BIN=product/apps/opc/src-tauri/binaries/axiomregent-$$HOST; \
	 if [ ! -f "$$BIN" ]; then \
	   mkdir -p product/apps/opc/src-tauri/binaries; \
	   touch "$$BIN"; chmod +x "$$BIN"; \
	   echo "  (created sidecar stub: $$BIN)"; \
	 fi
	@echo "==> ci-desktop: rust (src-tauri)"
	cargo check  --manifest-path product/apps/opc/src-tauri/Cargo.toml
	cargo clippy --manifest-path product/apps/opc/src-tauri/Cargo.toml -- -A dead_code -D warnings
	cargo test   --manifest-path product/apps/opc/src-tauri/Cargo.toml --lib
	cargo test   --manifest-path product/apps/opc/src-tauri/Cargo.toml --doc
	@echo ""
	@echo "==> ci-desktop: version alignment (Cargo.toml <-> package.json)"
	@CARGO_V=$$(grep '^version' product/apps/opc/src-tauri/Cargo.toml | head -1 | sed 's/.*"\(.*\)".*/\1/'); \
	 PKG_V=$$(node -p "require('./product/apps/opc/package.json').version"); \
	 if [ "$$CARGO_V" != "$$PKG_V" ]; then \
	   echo "ERROR: version mismatch — Cargo.toml=$$CARGO_V package.json=$$PKG_V"; exit 1; \
	 else \
	   echo "  versions aligned: $$CARGO_V"; \
	 fi
	@echo ""
	@echo "==> ci-desktop: typescript"
	cd product && pnpm install --frozen-lockfile
	cd product && pnpm --filter @opc/desktop exec tsc --noEmit
	cd product && pnpm --filter @opc/desktop --filter @opc/carrier-gate --filter @opc/session-memory test

ci-statecraft: ci-agent-frontmatter-ts
	@echo "==> ci-statecraft: npm ci + tsc + vitest"
	@# CI=true forces vitest to run-once instead of TTY watch mode.
	cd platform/services/statecraft && CI=true npm ci && CI=true npx tsc --noEmit && CI=true npm test

# ============================================================
# Statecraft encore-test lane (spec 211) — mirrors
# .github/workflows/ci-statecraft-encore.yml.
#
# Runs the DB-bound suites that vite.config.ts excludes from bare vitest
# (the `encore test` lane) against Encore-provisioned per-test databases,
# then cross-checks the reporter output against the exclude list so a
# file can never silently skip both lanes (FR-003 skip-as-pass guard).
# Requires the Encore CLI + Docker locally; CI installs the same pinned
# CLI version ci-statecraft.yml uses for codegen.
#
# Strict-lane only (spec 135 / FR-002 decision): the suite itself runs in
# seconds warm, but the lane needs the Encore CLI + a Docker daemon —
# dependencies `make ci` must not require for the daily loop. Measured
# 2026-06-12 (M1 Pro): DB-bound set ~40s warm incl. daemon startup.
# ============================================================
## tag: ci-statecraft-encore

ci-statecraft-encore:
	@echo "==> ci-statecraft-encore: DB-bound encore-test lane (spec 211)"
	@command -v encore >/dev/null 2>&1 || { echo "  MISSING: encore — brew install encoredev/tap/encore"; exit 1; }
	cd platform/services/statecraft && CI=true npm ci
	cd platform/services/statecraft/web && npx react-router build
	cd platform/services/statecraft && node scripts/encore-test-lane.mjs list > /tmp/encore-lane-files.txt
	cd platform/services/statecraft && CI=true encore test --run $$(cat /tmp/encore-lane-files.txt) --fileParallelism=false --reporter=default --reporter=json --outputFile=/tmp/encore-test-report.json
	cd platform/services/statecraft && node scripts/encore-test-lane.mjs check --report /tmp/encore-test-report.json

# ============================================================
# Schema parity (spec 120 FR-003) — asserts the Rust mirror in
# `crates/factory-contracts/src/knowledge.rs` and the TS source-of-truth
# in `platform/services/statecraft/api/knowledge/extractionOutput.ts`
# describe the same shape. Drift fails CI before any runtime divergence
# can ship.
#
# Step 1 emits the Rust-side fingerprints via `cargo test`. Step 2 walks
# the TS side with bun (which handles .ts natively): every schema walks
# a plain-data `SchemaNode` descriptor co-located with its hand-rolled
# validator (spec 125, no zod — Encore parser invariant). Provenance and
# stakeholder-doc surfaces are in reserved mode until their TS mirrors
# land at the paths spec 121 §8 / 122 reserve.
# ============================================================

ci-schema-parity:
	@echo "==> ci-schema-parity: emit rust fingerprints (knowledge + provenance + stakeholder_docs)"
	cargo test --manifest-path crates/factory-contracts/Cargo.toml --lib -- \
	    knowledge::tests::writes_fingerprint_file \
	    provenance::tests::writes_provenance_fingerprint_file \
	    stakeholder_docs::tests::writes_stakeholder_docs_fingerprint_file
	@echo ""
	@echo "==> ci-schema-parity: walk TS descriptors and compare"
	bun run tools/oap/schema-parity-check/index.mjs

# ============================================================
# Factory schema lockstep (spec 212) — mirrors
# .github/workflows/ci-factory-schema-lockstep.yml (the PR lane).
#
# Cross-repo contract parity: OAP's canonical standards/schemas/factory/**
# vs the owned factory source factory's contract/schemas/** under a
# three-mode structural compare + the spec-197 FR-005 GoA-concept guard.
#
# CI fetches the pinned ref (specs/212-*/spec.md `pinned_ref`) into
# .factory/ via UPSTREAM_SOURCES_RO_TOKEN. Locally, point FE_SCHEMAS at
# an existing factory checkout's contract/schemas, or export the token
# to fetch. Absent both, the LOCAL run degrades gracefully (loud skip) — the
# CI lane is the enforcing gate and is never skipped-green.
# ============================================================
## tag: factory-schema-lockstep
FE_SCHEMAS ?= .factory/contract/schemas

factory-schema-lockstep:
	@echo "==> factory-schema-lockstep: cross-repo contract lockstep (spec 212)"
	cargo build --release --manifest-path tools/oap/factory-schema-lockstep/Cargo.toml --target-dir tools/oap/factory-schema-lockstep/target
	cargo test --manifest-path tools/oap/factory-schema-lockstep/Cargo.toml --target-dir tools/oap/factory-schema-lockstep/target
	@# Resolve the factory contract/schemas tree. The pin (FR-007) lives
	@# in specs/212-factory-schema-lockstep-ci/spec.md. Prefer an existing local
	@# checkout (FE_SCHEMAS); else fetch the pinned ref if a token is present.
	@if [ -d "$(FE_SCHEMAS)" ]; then \
	    ./tools/oap/factory-schema-lockstep/target/release/factory-schema-lockstep --oap-dir standards/schemas/factory --factory-dir $(FE_SCHEMAS); \
	  elif [ -n "$$UPSTREAM_SOURCES_RO_TOKEN" ]; then \
	    pin=$$(grep -E '^pinned_ref:' specs/212-factory-schema-lockstep-ci/spec.md | head -1 | sed -E 's/^pinned_ref:[[:space:]]*"?([0-9a-fA-F]+)"?.*/\1/'); \
	    [ -n "$$pin" ] || { echo "ERROR: could not read pinned_ref from specs/212-factory-schema-lockstep-ci/spec.md"; exit 1; }; \
	    rm -rf .factory && mkdir .factory && cd .factory && git init -q && \
	    git remote add origin "https://x-access-token:$$UPSTREAM_SOURCES_RO_TOKEN@github.com/statecrafting/factory.git" && \
	    git config core.sparseCheckout true && git sparse-checkout init --cone && git sparse-checkout set contract/schemas && \
	    git fetch --depth 1 origin $$pin && git checkout -q FETCH_HEAD && cd .. && \
	    ./tools/oap/factory-schema-lockstep/target/release/factory-schema-lockstep --oap-dir standards/schemas/factory --factory-dir .factory/contract/schemas; \
	  else \
	    echo "    SKIPPED locally: set FE_SCHEMAS=<factory/contract/schemas> or export UPSTREAM_SOURCES_RO_TOKEN."; \
	    echo "    The CI lane (ci-factory-schema-lockstep.yml) enforces this — never skipped-green in CI."; \
	  fi

# ============================================================
# Spec/code coupling (spec 127) — mirrors
# .github/workflows/ci-spec-code-coupling.yml.
#
# PR-time gate: any diff path claimed by a spec's `implements:` list must
# be accompanied by an edit to that spec's spec.md. Locally this defaults
# to `origin/main...HEAD`; override BASE_REF/HEAD_REF on the command line
# (e.g. `make ci-spec-code-coupling BASE_REF=HEAD~3`).
# ============================================================
## tag: spec-code-coupling

ci-spec-code-coupling: ensure-spec-spine
	@echo "==> ci-spec-code-coupling: index staleness + coupling gate (spec-spine)"
	spec-spine index check
	@# Local mirror of .github/workflows/ci-spec-code-coupling.yml. CI passes
	@# explicit base/head SHAs via --base/--head; locally we materialise the
	@# working-tree-vs-origin/main diff (committed + staged + unstaged) plus
	@# untracked-but-not-ignored new files so uncommitted edits AND new files
	@# participate in the self-test. Override BASE_REF on the command line.
	@paths_file=$$(mktemp); \
	  base=$(or $(BASE_REF),origin/main); \
	  { git diff --name-only $$base; git ls-files --others --exclude-standard; } \
	      | sort -u > $$paths_file; \
	  spec-spine couple --base $$base --head HEAD --paths-from $$paths_file; \
	  status=$$?; rm -f $$paths_file; exit $$status

# ============================================================
# Supply chain (spec 116) — mirrors .github/workflows/ci-supply-chain.yml.
# Posture: blocking from day 0 (spec 116 §9 — warn window collapsed 2026-05-02).
# ============================================================
## tag: supply-chain

ci-supply-chain: ci-supply-chain-cargo ci-supply-chain-pnpm ci-supply-chain-npm
	@echo ""
	@echo "==> ci-supply-chain: all gates passed."

# cargo-deny scans every Rust manifest. No top-level Cargo.toml exists,
# so iterate; the workspace `crates/Cargo.toml` covers all 16 member crates.
SUPPLY_CHAIN_RUST_MANIFESTS = \
    Cargo.toml \
    platform/services/deployd-api-rs/Cargo.toml \
    product/apps/opc/src-tauri/Cargo.toml

ci-supply-chain-cargo:
	@echo "==> ci-supply-chain: cargo-deny"
	@command -v cargo-deny >/dev/null 2>&1 || cargo install cargo-deny --locked --version '^0.19'
	@for m in $(SUPPLY_CHAIN_RUST_MANIFESTS); do \
	    echo "  cargo deny --manifest-path $$m check"; \
	    cargo deny --manifest-path $$m check; \
	done

ci-supply-chain-pnpm:
	@echo "==> ci-supply-chain: pnpm audit"
	cd product && pnpm audit --audit-level=high

ci-supply-chain-npm:
	@echo "==> ci-supply-chain: npm audit (statecraft)"
	cd platform/services/statecraft && npm audit --audit-level=high

# axiomregent cross-target matrix (build-axiomregent.yml). Opt-in.
# Prerequisite per target: rustup target add <triple>
CI_CROSS_TARGETS = \
    aarch64-apple-darwin \
    x86_64-unknown-linux-gnu \
    x86_64-pc-windows-msvc \
    aarch64-unknown-linux-gnu

ci-cross:
	@set -e; for t in $(CI_CROSS_TARGETS); do \
	    echo "==> ci-cross: cargo build --release --target $$t --manifest-path crates/axiomregent/Cargo.toml"; \
	    cargo build --release --target $$t --manifest-path crates/axiomregent/Cargo.toml; \
	done

# Parity drift check (spec 104, rebound by spec 135 FR-04): asserts
# `make ci-strict` mirrors every enforcing workflow's `run:` blocks. Not
# included in `ci-strict` to avoid circular failure — CI runs it
# independently via .github/workflows/ci-parity.yml.
## tag: ci-parity
ci-parity:
	cargo build --release --manifest-path tools/oap/ci-parity-check/Cargo.toml --target-dir tools/oap/ci-parity-check/target
	./tools/oap/ci-parity-check/target/release/ci-parity-check

## tag: ci-fast
# BEGIN ci-fast (spec 134)
# ============================================================
# Fast local CI (spec 134) — performance-optimised local validation.
# Promoted to `make ci` (the daily dev loop) by spec 135 (2026-05-03).
# The sentinel comments still reference "ci-fast" because they bind to
# the spec 134 contract identifier, not the make target name; renaming
# them would invalidate `tools/oap/ci-parity-check`'s parsing without value.
#
# Parity-exempt by design: lines between this BEGIN sentinel and the
# corresponding `# END ci-fast` are skipped by `tools/oap/ci-parity-check`.
# Bound instead by the spec 134 §2.3 coverage invariant: the gate set
# performed here MUST be a superset of `make ci-strict`.
#
# Reference hardware: M1 Pro 10c / 64 GB. Measured warm cache: 4m54s
# (docs/ci-fast-bench.md SC-01).
#
# Tunables (env or `make CIFAST_JOBS=N ci`):
#   CIFAST_JOBS         outer concurrency (default 4)
#
# Auto-detected accelerators (no-op if absent):
#   sccache         shared compilation cache via RUSTC_WRAPPER
#   cargo-nextest   replaces cargo test (strict superset for execution)
# ============================================================

CIFAST_JOBS         ?= 4
CIFAST_TARGET_DIR   ?= $(CURDIR)/.target/cifast-tools

ifneq (,$(shell command -v sccache 2>/dev/null))
  export RUSTC_WRAPPER := $(shell command -v sccache)
endif
ifneq (,$(shell command -v cargo-nextest 2>/dev/null))
  # `--no-tests=pass` matches `cargo test` semantics: a binary with zero
  # `#[test]` functions exits 0 silently. Without this, nextest errors
  # with "no tests to run" on workspace members whose `tests/` dirs (or
  # `examples/`, `benches/` under --all-targets) contain no test fns.
  CIFAST_CARGO_TEST := nextest run --no-tests=pass
else
  CIFAST_CARGO_TEST := test
endif

## tag: ci-default-rename
ci:
	@echo "==> ci (spec 134 fast loop, promoted to default by spec 135): parallel local validation"
	@echo "    sccache:  $(if $(RUSTC_WRAPPER),enabled ($(RUSTC_WRAPPER)),absent — install: brew install sccache)"
	@echo "    nextest:  $(if $(filter nextest run,$(CIFAST_CARGO_TEST)),enabled,absent — install: cargo install cargo-nextest)"
	@echo ""
	@$(MAKE) -j$(CIFAST_JOBS) \
	    ci-fast-rust ci-fast-tools ci-fast-desktop \
	    ci-fast-statecraft ci-fast-schema-parity \
	    ci-fast-spec-coupling ci-fast-supply-chain
	@echo ""
	@echo "==> ci: all gates passed."

# Workspace-mode for crates/ collapses 18 workspace members to one clippy
# + one test invocation. deployd-api-rs (separate workspace) runs as a
# concurrent sibling. `cargo clippy --all-targets -- -D warnings` subsumes
# the separate `cargo check` step (spec 134 §2.2(2)).
# Spec 135 FR-01 made `ci-rust` itself use `--workspace`; this fast-mode
# recipe pre-dated that and remains its concurrent counterpart.
ci-fast-rust:
	@echo "==> ci-fast-rust: crates/ workspace + deployd-api-rs (concurrent)"
	@# Drop `--jobs` from cargo invocations: under `make -j` the jobserver
	@# already throttles, and explicit `--jobs` is silently ignored with a
	@# warning per invocation (matches the ci-fast-tools fix in PR #78).
	@( cargo clippy --workspace \
	      --manifest-path crates/Cargo.toml --all-targets -- -D warnings && \
	   cargo $(CIFAST_CARGO_TEST) --workspace \
	      --manifest-path crates/Cargo.toml ) & WS_PID=$$!; \
	  ( cargo clippy \
	      --manifest-path platform/services/deployd-api-rs/Cargo.toml \
	      --all-targets -- -D warnings && \
	    cargo $(CIFAST_CARGO_TEST) \
	      --manifest-path platform/services/deployd-api-rs/Cargo.toml ) & DA_PID=$$!; \
	  wait $$WS_PID; W=$$?; wait $$DA_PID; D=$$?; exit $$((W | D))

# Tools: parallel xargs fan-out, shared CARGO_TARGET_DIR so the isolated
# OAP overlay-tool manifests dedup deps. The generic engine crates were
# deleted per spec 217; their CI coverage is now the `spec-spine
# compile|index` smokes appended below.
CIFAST_TOOL_MANIFESTS = \
    tools/spec-spine/spec-lint/Cargo.toml \
    tools/oap/stakeholder-doc-lint/Cargo.toml \
    tools/oap/policy-compiler/Cargo.toml \
    tools/oap/assumption-cascade-check/Cargo.toml

ci-fast-tools: ensure-spec-spine
	@mkdir -p $(CIFAST_TARGET_DIR)
	@echo "==> ci-fast-tools: $(words $(CIFAST_TOOL_MANIFESTS)) manifests, shared target dir"
	@# BSD xargs (macOS) caps `-I{}` replacement at 255 bytes by default and
	@# fails this recipe with "command line cannot be assembled, too long".
	@# Pass the manifest as a positional arg (`$$1`) instead of substituting `{}`.
	@# Drop `--jobs` from cargo invocations: under `make -j` the jobserver
	@# already throttles, and explicit `--jobs` is silently ignored with a
	@# warning per invocation. && chains short-circuit on first failure.
	@printf '%s\n' $(CIFAST_TOOL_MANIFESTS) | \
	  xargs -n1 -P$(CIFAST_JOBS) sh -c '\
	    m="$$1"; \
	    echo "  [start] $$m"; \
	    CARGO_TARGET_DIR=$(CIFAST_TARGET_DIR) cargo clippy --manifest-path "$$m" --all-targets -- -D warnings && \
	    CARGO_TARGET_DIR=$(CIFAST_TARGET_DIR) cargo $(CIFAST_CARGO_TEST) --manifest-path "$$m" && \
	    echo "  [done ] $$m"' _
	@# Spec-lint smoke (survives) + spec-spine engine smokes. The generic
	@# engine crates were deleted per spec 217; the dropped registry-reader
	@# contract-prefix guard tested that deleted binary's CLI and is gone with
	@# it. Broad staleness gate retired per spec 188 Phase 4b.
	@CARGO_TARGET_DIR=$(CIFAST_TARGET_DIR) \
	  cargo run --release --manifest-path tools/spec-spine/spec-lint/Cargo.toml -- --fail-on-warn
	@spec-spine compile
	@spec-spine index

ci-fast-desktop:
	@test -f product/apps/opc/dist/index.html || { mkdir -p product/apps/opc/dist; \
	    echo '<!doctype html><html><body>stub</body></html>' > product/apps/opc/dist/index.html; }
	@HOST=$$(rustc -vV | grep '^host:' | awk '{print $$2}'); \
	 BIN=product/apps/opc/src-tauri/binaries/axiomregent-$$HOST; \
	 [ -f "$$BIN" ] || { mkdir -p $$(dirname "$$BIN"); touch "$$BIN"; chmod +x "$$BIN"; }
	@echo "==> ci-fast-desktop: rust + pnpm install (concurrent)"
	@# `--jobs` dropped: under `make -j` the jobserver throttles cargo;
	@# explicit `--jobs` is silently ignored with a warning (PR #78 precedent).
	@( cargo clippy --manifest-path product/apps/opc/src-tauri/Cargo.toml \
	     --all-targets -- -A dead_code -D warnings && \
	   cargo $(CIFAST_CARGO_TEST) --manifest-path product/apps/opc/src-tauri/Cargo.toml --lib && \
	   cargo test --manifest-path product/apps/opc/src-tauri/Cargo.toml --doc \
	) & RUST_PID=$$!; \
	  ( cd product && pnpm install --frozen-lockfile ); PI=$$?; \
	  wait $$RUST_PID; R=$$?; exit $$((R | PI))
	@echo "==> ci-fast-desktop: tsc | vitest (concurrent)"
	@# Each backgrounded compound needs its own `cd` (same lesson as
	@# ci-fast-statecraft above): `cd X && cmd &` runs in a subshell, so the
	@# parent shell's CWD doesn't change between the two jobs.
	@( cd product && pnpm --filter @opc/desktop exec tsc --noEmit ) & TSC_PID=$$!; \
	  ( cd product && pnpm --filter @opc/desktop test ) & VT_PID=$$!; \
	  wait $$TSC_PID; T=$$?; wait $$VT_PID; V=$$?; exit $$((T | V))
	@CARGO_V=$$(grep '^version' product/apps/opc/src-tauri/Cargo.toml | head -1 | sed 's/.*"\(.*\)".*/\1/'); \
	 PKG_V=$$(node -p "require('./product/apps/opc/package.json').version"); \
	 [ "$$CARGO_V" = "$$PKG_V" ] || { echo "ERROR: version mismatch $$CARGO_V vs $$PKG_V"; exit 1; }

ci-fast-statecraft: ci-agent-frontmatter-ts
	@echo "==> ci-fast-statecraft: npm ci then (tsc | vitest)"
	cd platform/services/statecraft && CI=true npm ci
	@# Each backgrounded compound needs its own `cd` — bash treats
	@# `cd X && cmd &` as a backgrounded subshell, so the parent shell's
	@# CWD doesn't change. Without this fix, only the first job runs in
	@# statecraft/; the second runs from repo root and `npm test` fails
	@# with "Missing script: test" (the workspace root has no test script).
	@( cd platform/services/statecraft && CI=true npx tsc --noEmit ) & TSC_PID=$$!; \
	  ( cd platform/services/statecraft && CI=true npm test ) & VT_PID=$$!; \
	  wait $$TSC_PID; T=$$?; wait $$VT_PID; V=$$?; exit $$((T | V))

ci-fast-schema-parity:
	cargo test --manifest-path crates/factory-contracts/Cargo.toml --lib -- \
	    knowledge::tests::writes_fingerprint_file \
	    provenance::tests::writes_provenance_fingerprint_file \
	    stakeholder_docs::tests::writes_stakeholder_docs_fingerprint_file
	bun run tools/oap/schema-parity-check/index.mjs

ci-fast-spec-coupling: ensure-spec-spine
	@paths_file=$$(mktemp); \
	  base=$(or $(BASE_REF),origin/main); \
	  { git diff --name-only $$base; git ls-files --others --exclude-standard; } \
	      | sort -u > $$paths_file; \
	  spec-spine couple --base $$base --head HEAD --paths-from $$paths_file; \
	  status=$$?; rm -f $$paths_file; exit $$status

ci-fast-supply-chain:
	@command -v cargo-deny >/dev/null 2>&1 || cargo install cargo-deny --locked --version '^0.19'
	@echo "==> ci-fast-supply-chain: cargo-deny -P$(CIFAST_JOBS) | pnpm audit | npm audit"
	@( cd product && pnpm audit --audit-level=high ) & PNPM_PID=$$!; \
	  ( cd platform/services/statecraft && npm audit --audit-level=high ) & NPM_PID=$$!; \
	  printf '%s\n' $(SUPPLY_CHAIN_RUST_MANIFESTS) | \
	    xargs -n1 -P$(CIFAST_JOBS) -I{} cargo deny --manifest-path {} check; \
	  CD=$$?; \
	  wait $$PNPM_PID; PA=$$?; wait $$NPM_PID; NA=$$?; \
	  exit $$((CD | PA | NA))

# END ci-fast

# ============================================================
# Utility
# ============================================================

## Remove build outputs the spec/index compilers and the desktop bundle write.
## Does NOT clean cargo target dirs under crates/ or tools/ — use
## `cargo clean --manifest-path <path>` for those (preserves cargo cache by default).
clean:
	@echo "==> Cleaning build artifacts..."
	rm -rf .derived/spec-registry
	rm -rf .derived/codebase-index
	rm -rf .derived/schema-parity
	rm -rf product/apps/opc/dist
	rm -rf product/apps/opc/src-tauri/target

help:
	@echo "Open Agentic Platform"
	@echo ""
	@echo "Quick start:"
	@echo "  make setup          One-time: install deps, build tools, compile specs"
	@echo "  make dev            Start desktop app (Vite + Tauri, hot-reload)"
	@echo ""
	@echo "Platform services (optional):"
	@echo "  make dev-platform   Start statecraft + deployd-api in background"
	@echo "  make dev-all        Desktop + platform services"
	@echo "  make stop           Stop background platform services"
	@echo ""
	@echo "Specs:"
	@echo "  make registry             Recompile spec registry + codebase index"
	@echo "  make spec-compile         Recompile spec registry only"
	@echo "  make spec-tools           Build all spec CLI tools"
	@echo ""
	@echo "Index:"
	@echo "  make index                Recompile codebase index"
	@echo "  make index-check          Check if index is stale"
	@echo "  make index-render         Render CODEBASE-INDEX.md from index"
	@echo ""
	@echo "PR prep:"
	@echo "  make pr-prep              Refresh codebase index + run coupling gate (run before commit)"
	@echo ""
	@echo "agent-frontmatter (ts-rs mirror, spec 111):"
	@echo "  make agent-frontmatter-ts     Regenerate the TS bindings (write-through)"
	@echo "  make ci-agent-frontmatter-ts  Regenerate + fail if working tree drifts"
	@echo ""
	@echo "Governance certificate (spec 102):"
	@echo "  make build-certificate FILE=<run-dir>      Build a certificate from a factory run dir"
	@echo "  make verify-certificate FILE=<cert-json>   Verify a certificate by re-deriving hashes"
	@echo ""
	@echo "CI parity (mirrors .github/workflows):"
	@echo "  make ci                 Spec 134 fast loop (promoted to default by spec 135) — parallel local validation, parity-exempt. Daily dev loop. ~5 min warm on M1 Pro 10c / 64 GB."
	@echo "  make ci-strict          Parity mirror — composes ci-rust, ci-tools, ci-desktop, ci-statecraft, ci-supply-chain. Pre-push / parity-investigation. ~90 min on M1 Pro."
	@echo "  make ci-rust            All Rust manifests: check + clippy -D warnings + test"
	@echo "  make ci-tools           OAP overlay-tool crates + spec-spine engine smokes + staleness gate"
	@echo "  make ci-desktop         product/apps/opc rust + version alignment + tsc + vitest"
	@echo "  make ci-statecraft      platform/services/statecraft: npm ci + tsc + vitest"
	@echo "  make ci-statecraft-encore  DB-bound encore-test lane + coverage guard (spec 211; needs encore CLI + Docker)"
	@echo "  make ci-spec-code-coupling  PR-time spec/code coupling gate (spec 127)"
	@echo "  make ci-supply-chain    cargo-deny + pnpm/npm audit (spec 116; blocking)"
	@echo "  make ci-cross           axiomregent cross-target matrix (opt-in; requires rustup targets)"
	@echo "  make ci-parity          Drift check: Makefile mirrors enforcing workflows (spec 104)"
	@echo ""
	@echo "Kubernetes:"
	@echo "  make deploy-azure   Deploy to Azure AKS"
	@echo "  make deploy-aws     Deploy to AWS EKS"
	@echo "  make deploy-hetzner Deploy to Hetzner K3s"
	@echo ""
	@echo "Sidecar:"
	@echo "  make axiomregent             Build axiomregent sidecar for host triple"
	@echo "  make axiomregent-all         Build for every target and install into sidecar dir"
	@echo "  make fetch-axiomregent       Download pre-built sidecar from latest CI build artifact (gh CLI)"
	@echo "  make fetch-axiomregent-check Fetch only if sidecar is missing"
	@echo ""
	@echo "Other:"
	@echo "  make clean          Remove build artifacts"
	@echo "  make check-deps     Verify prerequisites are installed"
