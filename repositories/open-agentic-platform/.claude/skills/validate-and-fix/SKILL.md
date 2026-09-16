---
name: validate-and-fix
description: Run the local fast CI loop (`make ci`) and automatically fix discovered issues using concurrent agents
allowed-tools: Bash, Agent, Read, Edit, Glob, Grep
---

# Validate and Fix

Run the local fast CI loop and automatically fix discovered issues. `make ci` covers the same gate set as every GitHub Actions enforcing workflow — if `make ci` passes locally, CI will pass too. For pre-merge release verification or parity-drift investigation, `make ci-strict` is the slower parity mirror (token-equivalent to the workflows).

## Process

### 1. Run the local fast CI loop

Invoke `make ci` from the repo root. The `Makefile` is the **single source of truth** for what CI validates. Do not discover validation commands by grepping `package.json`, `Cargo.toml`, or CLAUDE.md — the Makefile already enumerates every gate the CI workflows enforce.

> **Two modes (spec 134, defaults reversed by spec 135).** `make ci` is the parity-exempt fast loop (~5 min warm on M1 Pro 10c / 64 GB) — parallel, with sccache + nextest auto-detected. This is the daily dev loop. `make ci-strict` is the parity-bound mirror (~90 min) — token-equivalent to every enforcing workflow's `run:` blocks; use it pre-merge for release verification or when investigating parity drift.

`make ci` composes (concurrently, with `make -j$(CIFAST_JOBS)`):

- **`ci-fast-rust`** — `cargo clippy --workspace -- -D warnings` + `cargo test --workspace` (or `nextest run --workspace` if installed) on `crates/Cargo.toml` (all 18 workspace members per spec 135 FR-01) and `platform/services/deployd-api-rs/Cargo.toml`. Mirrors `ci-axiomregent.yml`, `ci-crates.yml`, `ci-deployd-api-rs.yml`, `ci-orchestrator.yml`, `ci-policy-kernel.yml`.
- **`ci-fast-tools`**: parallel xargs fan-out across tool manifests with shared `CARGO_TARGET_DIR`; `cargo test -- --list` post-pass asserting each `CI_REGISTRY_CONSUMER_CONTRACTS` prefix has ≥1 match; `spec-lint --fail-on-warn` smoke; `spec-spine index` smoke (broad staleness gate retired per spec 188 Phase 4b). Mirrors `spec-conformance.yml`.
- **`ci-fast-desktop`** — `apps/opc/src-tauri` Rust (custom clippy flags: `-A dead_code -D warnings`) concurrent with `pnpm install --frozen-lockfile`; `tsc --noEmit` and vitest concurrent; `Cargo.toml` ↔ `package.json` version alignment. Mirrors `ci-desktop.yml`.
- **`ci-fast-statecraft`** — `platform/services/statecraft`: `npm ci`, then `tsc --noEmit` and `npm test` concurrent. Mirrors `ci-statecraft.yml`.
- **`ci-fast-schema-parity`** — Rust factory-contracts fingerprints + `bun run tools/oap/schema-parity-check/index.mjs`. Mirrors `ci-schema-parity.yml` (spec 120/125).
- **`ci-fast-spec-coupling`** — PR-time spec/code coupling gate. Mirrors `ci-spec-code-coupling.yml` (spec 127).
- **`ci-fast-supply-chain`** — `cargo-deny` parallel xargs over Rust manifests + `pnpm audit` + `npm audit` concurrent. Mirrors `ci-supply-chain.yml` (spec 116).

`make ci-strict` composes the same gate set via the canonical sequential targets (`ci-rust`, `ci-tools`, `ci-desktop`, `ci-statecraft`, `ci-schema-parity`, `ci-spec-code-coupling`, `ci-supply-chain`) — token-equivalent to the workflows but ~90 min on M1 Pro.

Not in either `make ci` or `make ci-strict` (run on demand):
- `make ci-cross` — axiomregent cross-target matrix (requires `rustup target add` per triple). Mirrors `build-axiomregent.yml`.

**If a check is missing, add it to the Makefile and the relevant workflow in the same change.** Never introduce a new validation via a one-off script under `scripts/` — that directory is being retired in favour of Rust binaries invoked from the Makefile (spec 105).

After edits to either the Makefile `ci*` targets or any workflow under `.github/workflows/`, run `make ci-parity` as a pre-PR check. It asserts that every `run:` block in an enforcing workflow has a mirror in `make ci-strict` (the parity-bound recipe); drift is a workflow violation (spec 104, rebound by spec 135 FR-04). The check is also enforced by `.github/workflows/ci-parity.yml`, so a PR that skips the local run will still be caught in CI.

Capture full output — file paths, line numbers, error messages. Categorize findings:

- **CRITICAL** — security issues, breaking changes, data loss risk
- **HIGH** — functionality bugs, test failures, build breaks, staleness gate failures, version mismatches
- **MEDIUM** — clippy warnings, code quality, documentation gaps
- **LOW** — formatting, minor optimizations

### 2. Strategic Fix Execution

#### Phase 1 — Safe Quick Wins
- Start with LOW and MEDIUM priority fixes that can't break anything
- Verify each fix by re-running the narrowest affected subtarget (e.g. `make ci-tools`)

#### Phase 2 — Functionality Fixes
- Address HIGH priority issues one at a time
- Run the affected `make ci-<sub>` after each fix to confirm no regressions

#### Phase 3 — Critical Issues
- Handle CRITICAL issues with explicit user confirmation
- Provide detailed plan before executing

#### Phase 4 — Verification
- Re-run the full `make ci` composite to confirm end-to-end parity
- Provide summary of what was fixed vs. what remains

### 3. Comprehensive Error Handling

#### Rollback Capability
- Create git stash checkpoint before ANY changes: `git stash push -m "pre-validate-and-fix"`
- Provide instant rollback procedure if fixes cause issues

#### Partial Success Handling
- Continue execution even if some fixes fail
- Clearly separate successful fixes from failures
- Provide manual fix instructions for unfixable issues

#### Quality Validation
- Accept 100% success in each phase before proceeding
- If a phase fails, diagnose and provide specific next steps

### 4. Parallel Execution

Launch multiple agents concurrently for independent, parallelizable tasks:
- **CRITICAL**: Include multiple Agent tool calls in a SINGLE message ONLY when tasks can be done in parallel
- Parallelizable: fixes in different manifests (one agent per failing crate), independent test suites, non-overlapping components
- Sequential: shared-interface changes across crates, ordered phases, anything mutating a cross-crate contract
- Each parallel agent must have non-overlapping file responsibilities
- Each agent verifies its fix by re-running the relevant `make ci-<sub>` target before reporting complete

### 5. Final Verification

After all agents complete:
- Re-run `make ci` to confirm 100% CI parity
- Confirm no new issues were introduced by fixes
- Report any remaining manual fixes needed with specific instructions
- Summary: `Fixed X/Y issues, Z require manual intervention — CI parity: {PASS|FAIL}`
