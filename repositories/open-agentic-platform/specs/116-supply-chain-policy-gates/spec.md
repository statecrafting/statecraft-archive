---
id: "116-supply-chain-policy-gates"
slug: supply-chain-policy-gates
title: Supply-Chain Policy Gates — cargo-deny + dependency audit in CI
status: approved
implementation: complete
owner: bart
created: "2026-04-28"
approved: "2026-05-02"
closed: "2026-05-02"
amended: "2026-05-22"
amendment_record: "158-workflow-ref-sha-pinning-lint"
kind: governance
domain: tooling
risk: medium
depends_on:
  - "000-bootstrap-spec-system"  # bootstrap-spec-system
  - "047-governance-control-plane"  # governance-control-plane (policy posture precedent)
  - "104-makefile-ci-parity-contract"  # makefile-ci-parity-contract (Makefile mirror requirement)
code_aliases: ["SUPPLY_CHAIN_POLICY"]
establishes:
  - unit: { kind: file, path: deny.toml }
  - unit: { kind: file, path: .github/workflows/ci-supply-chain.yml }
refines:
  # §11 advisory responses — the audit-response knobs (dependency
  # overrides, documented audit ignores) are this spec's gate machinery
  # even though the host manifests belong to their service specs, same
  # as deny.toml's triaged ignores (2026-06-12, GHSA-gv7w-rqvm-qjhr).
  - aspect: "advisory-response-overrides"
    unit: { kind: file, path: platform/services/statecraft/package.json }
  - aspect: "advisory-response-overrides"
    unit: { kind: file, path: product/pnpm-workspace.yaml }
co_authority:
  - with_specs:
      - "104-makefile-ci-parity-contract"
    unit: { kind: section, file: Makefile, anchor: supply-chain }
compliance:
  - framework: "owasp-asi-2026"
    # ASI04 (supply-chain compromise) via the gate composition: cargo-deny
    # advisory + license + banned-crate policies across every Rust manifest
    # plus pnpm/npm audit on the JavaScript surface, blocking from day 0.
    # NOTE: the "ASI04 = supply-chain compromise" name is asserted by
    # docs/launch/gaps.md (line 116) and matches OWASP ASI 2026 framework
    # naming, but is not itself defined in any OAP file-of-record. A future
    # spec should fold canonical control definitions into a registry-consumer
    # config so this mapping is mechanically defensible rather than
    # human-asserted.
    controls: ["ASI04"]
summary: >
  Add governed supply-chain gates to CI. cargo-deny enforces a policy bundle
  for advisories, licenses, and banned crates across every Rust manifest in
  the repo; pnpm/npm audit covers the JavaScript surface (product/apps/opc +
  platform/services/statecraft). Posture is blocking from day 0 (the 30-day
  warn-only window planned in §9.1 was collapsed on 2026-05-02 after a clean
  dry-run; see §9 promotion record). The gate is mirrored in the Makefile
  under a new `ci-supply-chain` target, composed into `make ci`, and validated
  by ci-parity-check.
---

# 116 — Supply-Chain Policy Gates

> **Amended 2026-05-22 by [158-workflow-ref-sha-pinning-lint](../158-workflow-ref-sha-pinning-lint/spec.md).**
> Spec 158 promotes the workflow-ref SHA-pinning convention from
> discipline to merge-blocking and commit-blocking contract.
> `.github/workflows/ci-supply-chain.yml` (this spec's
> `establishes:` path) gains a new `workflow-pins` job that runs
> `tools/lint/workflow-pins.sh`; the same lint also lands in
> `.githooks/pre-commit`. The amendment closes the convention-vs-
> contract gap that existed at the time of this spec's
> 2026-05-02 closure — every external Action ref was already SHA-
> pinned by hand, but no gate would have refused a regression.

## 1. Problem Statement

The CI surface today (10 workflows, 4 composite actions, full SHA pinning on
every external action) is unusually disciplined for a pre-alpha repo, but
contains zero dependency-level supply-chain enforcement:

- No `cargo audit` or `cargo deny` step runs against any of the 30 Rust
  crates inventoried in `.derived/codebase-index/index.json`.
- No `pnpm audit` or `npm audit` step runs against the 24 npm packages
  (notably `@opc/desktop` and `platform/services/statecraft`).
- No license policy is asserted — a contributor can pull in a GPL-3.0 crate
  via transitive dependency without any signal in CI.
- No banned-crate registry exists. If we standardise on, say, `tracing` over
  `log`, nothing prevents a future change from re-introducing `log` directly.

For a project whose stated framing is the **governed operating system for
AI-native software delivery** (README.md), the absence of supply-chain
governance on the platform's own dependencies is conspicuous. It is also
operationally cheap to fix: cargo-deny is a single binary, pnpm audit is
already shipped with the package manager, and the policy file (`deny.toml`)
is markdown-friendly TOML that fits the project's authoring conventions.

This spec adds those gates as a first-class workflow, mirrored in the
Makefile per spec 104.

## 2. Goals

- **One advisory database, one license policy, one ban list.** Authoritative
  policy lives at `deny.toml` at repo root. Hand-edited TOML is the source of
  truth; cargo-deny is the consumer.
- **Coverage parity with CI inventory.** Every Rust manifest enumerated in
  `Makefile` `CI_RUST_MANIFESTS` plus all tool manifests are scanned. No
  manifest is silently excluded.
- **JavaScript audit at the package-manager layer.** `pnpm audit` is run for
  the pnpm workspace (product/apps/opc + product/packages/) and `npm audit` for
  `platform/services/statecraft`. Both scoped to `--audit-level=high` (warn
  on moderate, block on high/critical).
- **Blocking from day 0.** A 30-day warn-only window was originally planned
  (see §9.1 for the historical design). It was collapsed on the day the spec
  approved after a clean dry-run found zero `--audit-level=high` advisories
  across cargo-deny + pnpm audit + npm audit. The gate ships strict: every
  audit step propagates non-zero exit codes. The `SUPPLY_CHAIN_BLOCKING` repo
  variable referenced in §9.1 was never created.
- **Local mirror at parity.** A new `make ci-supply-chain` target invokes
  the same checks. `make ci` composes it. `ci-parity-check` validates the
  workflow ↔ Makefile mirror.

## 3. Scope

### In scope

- `deny.toml` with sections: `advisories`, `bans`, `licenses`, `sources`.
- `.github/workflows/ci-supply-chain.yml` (new) running:
  - `cargo deny check` per Rust manifest group.
  - `pnpm audit --audit-level=high` for the pnpm workspace.
  - `npm audit --audit-level=high` for `platform/services/statecraft`.
- `Makefile`: `ci-supply-chain` target composing all three.
- `make ci` (root composite): adds `ci-supply-chain` to the dependency chain.
- Posture record (§9): the 30-day warn-only window planned in §9.1 was
  collapsed on day 0 after a clean dry-run.
- Documentation entry in `make help`.

### Out of scope

- Renovate/Dependabot-driven version bumps. Spec 116 is the gate; the bump
  cadence is handled separately by the dependabot config landed in Phase 0
  of the parent CI hardening branch.
- SBOM generation — that lives in spec 117.
- Build provenance attestations — also spec 117.
- Per-crate vendoring or `cargo vendor` workflows — out of scope for v1.

## 4. Policy Bundle (deny.toml)

The initial policy is intentionally narrow. It blocks the common foot-guns
without forcing a backlog of false-positives on day one.

```toml
[advisories]
# Pull from the official RustSec database.
db-path = "~/.cargo/advisory-db"
db-urls = ["https://github.com/RustSec/advisory-db"]
# Block any advisory rated yanked, vulnerability, or unmaintained on day 30.
# During the warn-only window these are reported but not blocked.
yanked = "warn"
ignore = []

[bans]
# Block multiple major versions of the same crate transitively. This is the
# single most common foot-gun in Rust workspaces.
multiple-versions = "warn"
wildcards = "deny"
# Crates we have explicitly chosen NOT to use. Empty on day 1; populate via
# follow-up PRs as architectural decisions land.
deny = []
# Skip multiple-version warnings for these crates (use sparingly, document why).
skip = []

[licenses]
# Permissive licenses we accept by default.
allow = [
  "MIT",
  "Apache-2.0",
  "Apache-2.0 WITH LLVM-exception",
  "BSD-2-Clause",
  "BSD-3-Clause",
  "ISC",
  "Unicode-DFS-2016",
  "Unicode-3.0",
  "CC0-1.0",
  "Zlib",
  "MPL-2.0",
]
# Hard block. GPL-family is incompatible with the desktop bundle's
# distribution model.
deny = [
  "GPL-1.0",
  "GPL-2.0",
  "GPL-3.0",
  "AGPL-1.0",
  "AGPL-3.0",
  "LGPL-2.0",
  "LGPL-2.1",
  "LGPL-3.0",
]
confidence-threshold = 0.93

[sources]
# Block crates from sources other than crates.io and github.com unless
# explicitly allowlisted (e.g. a vendored grammar fork).
unknown-registry = "deny"
unknown-git = "warn"
allow-git = []
```

The `confidence-threshold` of 0.93 matches cargo-deny's default; lower
values produce false positives on dual-licensed crates.

## 5. CI Workflow Shape

`.github/workflows/ci-supply-chain.yml`:

- Triggers: `pull_request` (path filter on `Cargo.toml`, `Cargo.lock`,
  `package.json`, `pnpm-lock.yaml`, `package-lock.json`, `deny.toml`, the
  workflow itself), `push` on main, `workflow_dispatch`, and a weekly cron
  (`0 12 * * 1`) so advisory-db updates surface even on a quiet week.
- Three independent jobs (`cargo-deny`, `pnpm-audit`, `npm-audit-statecraft`)
  run in parallel.
- Each audit step propagates non-zero exit codes. There is no
  `SUPPLY_CHAIN_BLOCKING` repo variable — the staged-enforcement plan in
  §9.1 was collapsed on day 0 (see §9.2).
- The repository has no top-level `Cargo.toml`; the `cargo-deny` step
  iterates the same Rust manifests CI compiles (workspace
  `crates/Cargo.toml` plus standalone tool / desktop / deployd-api
  manifests). The Makefile mirrors the same list via
  `SUPPLY_CHAIN_RUST_MANIFESTS`.
- `cargo-deny` is pinned to `^0.19` (≥ 0.19 is required to parse RustSec
  advisories that use CVSS v4.0 vectors).
- Each job uploads its raw output as a workflow artifact for triage.

## 6. Makefile Shape

```makefile
# Spec 116 — supply-chain policy gates.
# Mirrored in .github/workflows/ci-supply-chain.yml.
ci-supply-chain: ci-supply-chain-cargo ci-supply-chain-pnpm ci-supply-chain-npm
	@echo ""
	@echo "==> ci-supply-chain: all gates passed."

# No top-level Cargo.toml: iterate every Rust manifest CI compiles.
SUPPLY_CHAIN_RUST_MANIFESTS = \
    crates/Cargo.toml \
    platform/services/deployd-api-rs/Cargo.toml \
    product/apps/opc/src-tauri/Cargo.toml \
    tools/spec-spine/spec-compiler/Cargo.toml \
    tools/spec-spine/registry-consumer/Cargo.toml \
    tools/spec-spine/spec-lint/Cargo.toml \
    tools/spec-spine/codebase-indexer/Cargo.toml \
    tools/oap/policy-compiler/Cargo.toml \
    tools/oap/adapter-scopes-compiler/Cargo.toml \
    tools/oap/ci-parity-check/Cargo.toml \
    tools/shared/frontmatter/Cargo.toml

ci-supply-chain-cargo:
	@command -v cargo-deny >/dev/null 2>&1 || cargo install cargo-deny --locked --version '^0.19'
	@for m in $(SUPPLY_CHAIN_RUST_MANIFESTS); do \
	    cargo deny --manifest-path $$m check; \
	done

ci-supply-chain-pnpm:
	pnpm audit --audit-level=high

ci-supply-chain-npm:
	cd platform/services/statecraft && npm audit --audit-level=high
```

`ci` is updated to `ci: ci-rust ci-tools ci-desktop ci-statecraft ci-supply-chain`.

`make help` gains a "Supply chain" section.

## 7. Acceptance Criteria

- **AC-1:** A PR introducing a crate with a known RUSTSEC advisory of
  `severity: high` or `critical` triggers a red (blocking) `cargo-deny` job.
- **AC-2:** A PR adding a GPL-3.0 dependency (direct or transitive) triggers
  a red (blocking) license violation in `cargo-deny`.
- **AC-3:** A PR introducing a known npm advisory at `--audit-level=high`
  triggers the corresponding `pnpm-audit` or `npm-audit-statecraft` job.
- **AC-4:** `make ci-supply-chain` runs all three checks locally with the
  same exit-code semantics as CI.
- **AC-5:** `make ci-parity` (spec 104) confirms the workflow's `run:`
  blocks are mirrored by the Makefile recipe; deliberate divergence is
  detected.
- **AC-6:** A weekly cron run produces a workflow run even with no source
  changes, ensuring fresh advisory-db reports.

## 8. Risks and Mitigations

- **Risk:** initial advisory backlog creates noise that obscures real
  signals.
  **Mitigation (originally planned):** a 30-day warn window for triage
  before flipping to blocking.
  **Mitigation (actual):** dry-run on day 0 surfaced zero highs across all
  three audits. The 14 cargo-deny advisory-ignore entries already in
  `deny.toml` cover the known transitive-dependency exposure. The warn
  window was unnecessary and was collapsed (see §9.2). Future advisory
  backlog (e.g. a new RUSTSEC entry firing on next cron) is handled via
  targeted `deny.toml` ignore entries with rationale and expiry comments.

- **Risk:** false-positive license detection on dual-licensed crates causes
  contributor friction.
  **Mitigation:** `confidence-threshold = 0.93` is the cargo-deny default
  and well-tested. Borderline crates are added to a per-crate
  `[licenses.exceptions]` block on a case-by-case basis with documented
  rationale.

- **Risk:** advisory-db rate limits or fetch failures break CI.
  **Mitigation:** cargo-deny caches the db at `~/.cargo/advisory-db`;
  `actions/cache` keys it by date for once-a-day refresh.

## 9. Promotion Record

### 9.1 Original plan (historical, not in effect)

The spec was originally drafted with a 30-day warn-only window: each audit
step would soft-fail (exit 0 with a `::warning::` annotation) until day 30,
gated behind a `SUPPLY_CHAIN_BLOCKING` repo variable. A follow-up PR on
2026-05-28 would have set the variable to `true`, dropped the dead `else`
branches, and flipped this spec's `implementation` field to `complete`.

The rationale for that design was the standard supply-chain rollout pattern:
discover an unknown advisory inventory and triage it without blocking
in-flight PRs from contributors who weren't in the design loop.

### 9.2 Day-0 collapse (2026-05-02)

That rationale does not apply to OAP. There are no in-flight PRs from
contributors outside the design loop (single-operator repo, per project
memory: "No users; prioritize proper architecture over cautious phasing").
The advisory inventory was knowable in 60 seconds by running cargo-deny
once locally — and `deny.toml` already carried 14 triaged ignores from
the original drafting effort.

A dry-run executed on 2026-05-02, immediately after spec approval, with
the soft-fail removed:

```
cargo-deny: 13/13 manifests pass
pnpm audit --audit-level=high: 0 highs (1 moderate, below threshold)
npm audit --audit-level=high (statecraft): 0 highs (4 moderates, below threshold)
```

By the gate's own threshold the run is clean. The warn window had nothing
to discover. The window was collapsed in the same PR that flipped
`implementation: complete`:

1. `|| true` removed from all three Makefile recipes.
2. The `SUPPLY_CHAIN_BLOCKING` env-var guards removed from all three
   workflow jobs (the variable was never created at the GitHub repo level).
3. Frontmatter flipped: `implementation: pending` → `complete`, added
   `closed: "2026-05-02"`.
4. Prose throughout §2, §3, §5, §6, §7, §8, and §9 updated to record the
   collapse rather than the planned phasing.

### 9.3 Below-threshold inventory (informational, not a blocker)

The day-0 dry-run surfaced 5 moderate advisories below the `high` threshold
the gate enforces:

- **pnpm workspace:** 1 moderate (transitive).
- **statecraft (npm):** 4 moderates in the `esbuild → @esbuild-kit/* →
  drizzle-kit` chain (`GHSA-67mh-4wv8-2f99`, esbuild dev-server CORS).

These do not fire under `--audit-level=high` and do not block. They are
recorded here so the spec is honest about current posture: the codebase is
clean against the gate's chosen severity bar, not vulnerability-free in
absolute terms. Whether to tighten the threshold to `moderate` (or to bump
`drizzle-kit` past the affected version range) is a separate decision and
does not belong to this spec — open a follow-up if pursued.

## 10. Cross-references

- Spec 127 (`spec-code-coupling-gate`) adds an `ci-spec-code-coupling`
  Makefile target as a sibling above `ci-supply-chain` in the `make ci`
  composition. No change to this spec's gates or warn-window posture.

## 11. Advisory response log

- **2026-06-12 — GHSA-gv7w-rqvm-qjhr (esbuild <0.28.1, high).** The
  advisory wave landed mid-day and turned both JS audit gates red on
  every open PR. Two-pronged response, each leg justified on its own
  facts: (a) **statecraft (npm)** — `"overrides": { "esbuild": "^0.28.1" }`
  takes the patched release; validated by the full vitest lane (585
  green) and the react-router frontend build. (b) **product (pnpm)** —
  the patched 0.28.1 itself regresses down-level transforms against the
  OPC Tauri target set (chrome87/safari14: "Transforming destructuring
  … is not supported yet"), breaking `vite build`; since the advisory's
  vector is the Deno-module binary fetch trusting `NPM_CONFIG_REGISTRY`
  at install time (not our lockfile-pinned pnpm path),
  `auditConfig.ignoreGhsas` carries the documented ignore until esbuild
  ships a transform fix, at which point the ignore drops in favour of
  the override. This entry is the triage record the gate design (§8)
  prescribes for advisory storms.

- **2026-06-15: GHSA-hmw2-7cc7-3qxx (form-data <4.0.6),
  GHSA-fx2h-pf6j-xcff (vite <=6.4.2), GHSA-wcpc-wj8m-hjx6 (protobufjs
  <=7.6.0), all high.** A second advisory wave turned `pnpm audit
  --audit-level=high` red on the product (pnpm) workspace. All three
  patched releases are clean in-major bumps (form-data 4.0.5 to 4.0.6,
  vite 6.4.2 to 6.4.3, protobufjs 7.5.6 to 7.6.4) with no known
  regression against the OPC build, so each is taken via
  `pnpm-workspace.yaml` `overrides` rather than ignored (contrast the
  esbuild leg above, kept ignored because its patch regresses). `pnpm
  audit --audit-level=high` returns to exit 0; the one remaining high is
  the still-ignored esbuild GHSA. The lockfile is regenerated in the
  same change.

## Amendment 2026-06-29 (reset-prep housekeeping)

Added `RUSTSEC-2026-0192` (ttf-parser unmaintained, transitive via pdf-extract
font parsing) to `deny.toml`'s advisory ignore list. Policy-list maintenance
only; no change to the supply-chain gate design.


## Advisory exception amendment (2026-07-02)

Added documented deny.toml ignores for RUSTSEC-2026-0194 and RUSTSEC-2026-0195 (quick-xml duplicate-attribute quadratic DoS and unbounded namespace-allocation DoS, both published 2026-07-02). Both match transitive quick-xml pins (0.36 / 0.39); the patched line is 0.40+, a semver-breaking bump requiring the parent dependencies to be updated, tracked as a follow-up supply-chain change. This is a time-boxed, documented exception consistent with the existing transitive-advisory ignore pattern; XML parsing on these paths is not attacker-controlled input.
