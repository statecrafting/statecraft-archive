---
id: "187-opc-e2e-test-harness"
slug: opc-e2e-test-harness
title: "OPC end-to-end test harness — built-binary driver, mock-statecraft, process-tree introspection"
status: approved
implementation: in-progress
owner: bart
created: "2026-05-26"
kind: capability
domain: opc
risk: medium
depends_on:
  - "032-opc-inspect-governance-wiring-mvp"  # opc-inspect-governance-wiring-mvp (the cockpit surface under test)
  - "073-axiomregent-unification"  # axiomregent-unification (the sidecar e2e fixtures must spawn / kill)
  - "087-unified-workspace-architecture"  # unified-workspace-architecture (the duplex stream mock-statecraft must emulate)
  - "134-fast-local-ci-mode"  # fast-local-ci-mode (the daily-dev cadence the harness must not erode)
  - "147-spec-kind-grammar"  # spec-kind-grammar (`kind: capability`)
  - "177-ci-orchestrator-pr-gate"  # ci-orchestrator-pr-gate (the gate-orchestration contract a future nightly job will register against)
  - "183-opc-boot-precondition-gate"  # opc-boot-precondition-gate (the canonical first consumer — AC-7/8/9 were deferred to this harness)
code_aliases:
  - "OPC_E2E_HARNESS"
establishes:
  # Implementation-time amendment (spec 187 §2): these paths now exist on
  # disk, so the establishes: units the §2 enumeration mandated are declared
  # here. `registry-consumer by-authority <path>` now returns this spec.
  - unit: { kind: directory, path: product/apps/opc/tests-e2e }
  - unit: { kind: directory, path: product/apps/opc/tests-e2e/harness }
  - unit: { kind: directory, path: product/apps/opc/tests-e2e/fixtures }
  - unit: { kind: file, path: .github/workflows/opc-e2e-nightly.yml }
  # The [[opc-e2e-auth-state-seeding]] follow-up (§8) brought this e2e-only
  # keychain seed helper into existence. It lives in the opc crate (not under
  # tests-e2e) solely to link the SAME `keyring` crate/version the app reads
  # back with; it is feature-gated (`e2e-seed`) and never in a shipping build.
  # It is a cargo `[[example]]` under `examples/`, not a `[[bin]]` under
  # `src/bin/`: Tauri's bundler copies every bin of the packaged crate and a
  # required-features bin the release build skips broke the app bundle (see
  # §3.5.1). Examples are not bundled, so it stays in the crate without breaking
  # `tauri build`. The harness is its authority even though the file sits in the
  # opc crate.
  - unit: { kind: file, path: product/apps/opc/src-tauri/examples/e2e_seed_session.rs }
refines:
  # The e2e seed example's target + feature registration in the opc manifest.
  # The opc crate spec owns the manifest at large; 187 co-authors only the
  # `[[example]] e2e_seed_session` + `[features] e2e-seed` additions (both inert
  # in production builds), so the harness spec is the authority for that aspect.
  # (The aspect id keeps its historical `-bin-` name for stability; the target
  # is now an `[[example]]` per §3.5.1.)
  - aspect: "e2e-seed-bin-registration"
    unit: { kind: file, path: product/apps/opc/src-tauri/Cargo.toml }
extends:
  # Mechanical featuregraph-golden refresh required by spec 177
  # ci-orchestrator-pr-gate atomicity contract — any new spec
  # appended to the corpus shifts the golden fingerprint. Same
  # precedent as specs 167/168/169 (178 rename) and spec 183 (PR
  # #244). No semantic change to spec 034's claims.
  - spec: "034-featuregraph-registry-scanner-fix"
    nature: additive
    unit: { kind: file, path: crates/featuregraph/tests/golden/features_graph.json }
  # FR-T1 needs a WebDriver-observable marker for the BootGate<->Cockpit
  # transition. App.tsx's boot-gate branch is governed by spec 183; this is a
  # render-neutral data-testid="opc-phase"/data-phase additive touch (no
  # behavioral change), so it extends 183 rather than amending it.
  - spec: "183-opc-boot-precondition-gate"
    nature: additive
    unit: { kind: file, path: product/apps/opc/src/App.tsx }
references:
  - role: deferral-source
    unit: { kind: file, path: specs/183-opc-boot-precondition-gate/spec.md }
summary: >
  Establishes the test infrastructure required to execute spec-bound
  end-to-end acceptance criteria against a built OPC desktop binary.
  The canonical motivating consumer is spec 183 AC-7/8/9 (boot-screen
  stickiness when statecraft is unreachable; mid-session restore on
  axiomregent kill; clean process-tree teardown on Quit) which were
  explicitly deferred to nightly/manual at spec-183 PR time because no
  e2e harness existed. The harness has three load-bearing components:
  a built-binary driver that launches the OPC Tauri executable and
  introspects WebView render state (the BootGate→Cockpit transition is
  the canonical assertion target); a mock-statecraft duplex server
  that can be made selectively unreachable (network-level deny vs.
  protocol-level reject) so AC-7-style "substrate-unavailable" cases
  are deterministic; and platform-portable process-tree introspection
  for AC-9-style "no orphan sidecar" assertions. The harness is not
  itself a gate — it is a capability other specs opt into by
  registering their AC against it. The non-goal section pins this:
  no per-PR runtime budget assumed, no implicit gating, no
  per-feature flake amnesty.
---

# 187 — OPC end-to-end test harness

## 1. Preamble

Spec 183 (OPC boot precondition gate) bound nine acceptance criteria.
Six (AC-1 through AC-6) ride per-PR via spec-lint, registry-consumer
queries, and unit tests on the load-bearing primitives
(`probe_port_alive`; the `sync.hello` dispatch arm). Three (AC-7, AC-8,
AC-9) require a *built OPC binary* under conditions the unit-test
shape cannot express:

- **AC-7** — "with sidecar binary present but statecraft unreachable,
  the boot screen MUST render and remain rendered; the cockpit MUST
  NOT appear." Requires a controlled statecraft-unreachable context
  AND a way to assert which subtree the WebView currently mounts.
- **AC-8** — "killing axiomregent MUST cause the cockpit to unmount
  and `<BootGate>` to mount in its place within an implementer-bounded
  window (e.g. 2s of `CommandEvent::Terminated` observation)." A
  process-kill + UI-state race window the test must time-bound.
- **AC-9** — "invoking Quit from the boot screen MUST leave no
  axiomregent process running on the system." Process-tree
  introspection after a clean exit.

Spec 183's §6 paragraph deferred these to "nightly / manual" because
no infrastructure existed in the repository to execute them. This spec
establishes that infrastructure and is the canonical first consumer.

The constitutional claim is *spec-bound e2e ACs are honored, not
informally deferred*. The deferral pattern is acceptable as an interim
posture — but only if a successor spec exists to retire it. This is
that successor.

## 2. Authority enumeration

This spec will **establish** new test infrastructure under a new
root directory once that directory is created during implementation.
The directory layout below is deliberate so consumer specs can add
their AC fixtures alongside without entangling load-bearing harness
primitives. All four paths below are mandated by this spec. They were
held out of `establishes:` while they did not yet exist on disk (spec
154 §3.5 hard-errors on missing-directory units at compile time, same
pattern as spec 180 §3 for the benches/ directory); the
implementation-time amendment that created them now declares the
`establishes:` units in the frontmatter above.

- `product/apps/opc/tests-e2e/` — the harness root.
- `product/apps/opc/tests-e2e/harness/` — the load-bearing harness
  primitives: built-binary driver, mock-statecraft duplex server,
  process-tree introspection adapters. Edits here require this
  spec's spec.md edit (per spec 133 coupling gate).
- `product/apps/opc/tests-e2e/fixtures/` — per-AC test fixtures
  (one file per (consuming spec, AC) pair). Edits here are
  co-authored by this spec AND the consuming spec under spec 152
  section-scoped authority — see §3.7 below.
- `.github/workflows/opc-e2e-nightly.yml` — the nightly CI runner
  that executes the harness. Edits here are bound by this spec; the
  workflow MUST be SHA-pinned per spec 158.

The harness's `kind: capability` placement is intentional. It does
not itself gate any merge — consuming specs decide whether to
register their AC against the nightly run, the pre-release manual
run, or both. Spec 177 (ci-orchestrator-pr-gate) defines the gate
composition surface; this spec adds a new check kind that registers
against it but does not auto-enroll.

## 3. Tier 1 — Structural invariants

These are boolean assertions about the harness shape that must hold
once it lands. Each invariant cites the path(s) it constrains.

### 3.1 Built-binary driver (FR-T1)

**FR-T1.** The harness MUST drive a *built* OPC Tauri binary, not a
mocked Tauri context. The driver MUST:

(a) build the binary via `cargo tauri build` (or invoke a cached
artifact from a prior CI step) BEFORE any AC fixture runs;

(b) launch the binary in a context where the test process can observe
its lifecycle (PID, exit code, stderr, log directory);

(c) drive the WebView's React subtree via a Tauri-driver-class
adapter (tauri-driver, webdriver-bidi, or equivalent) so assertions
can read which top-level component is currently mounted.

> *Rationale.* A mock Tauri context catches API-shape regressions but
> not the load-bearing claim spec 183 encodes ("cockpit cannot render
> before preconditions"). Only a *built* binary exercises the App.tsx
> conditional render boundary in production conditions.

**Files FR-T1 binds on:** `product/apps/opc/tests-e2e/harness/driver.*`.

### 3.2 Mock-statecraft duplex server (FR-T2)

**FR-T2.** The harness MUST provide a configurable statecraft
double — a duplex WebSocket server that speaks the spec 087 envelope
grammar — with at least these selectable modes:

(a) **healthy** — accepts the handshake, emits `sync.hello`, then
keeps the connection open as a statecraft would.

(b) **network-unreachable** — accepts no connections (TCP RST or
listen-refused). The desktop's reconnect loop should fail at the
transport layer.

(c) **handshake-rejects** — accepts the connection but closes before
emitting `sync.hello`. AC-7's "boot stays sticky" branch fires here:
sidecar liveness passes, org-session-ready never flips.

(d) **mid-session-drop** — emits `sync.hello`, then disconnects
without reconnect. Used by AC-8's mid-session restore assertion's
duplex-side variant.

The selection MUST be controllable from the test fixture (test sets
the mode, harness configures the server, then proceeds).

> *Rationale.* Spec 183 AC-7 binds "statecraft unreachable" without
> specifying a level. The harness exposes both transport-level and
> protocol-level rejection so consumer specs can pick the level that
> matches their invariant.

**Files FR-T2 binds on:** `product/apps/opc/tests-e2e/harness/mock_statecraft.*`.

### 3.3 Process-tree introspection (FR-T3)

**FR-T3.** The harness MUST provide a platform-portable assertion
helper for "is process X running?" — used by AC-9-class invariants
("no orphan sidecar after Quit"). The helper MUST:

(a) work on macOS (`pgrep` or equivalent), Linux (`pgrep`), and
Windows (`tasklist` or PowerShell `Get-Process`);

(b) match by executable name or PID (not just by command-line, which
is OS-fragmented);

(c) tolerate the race window between SIGKILL and process-table cleanup
by retrying with bounded backoff (the threshold value is harness
config, not spec-bound).

> *Rationale.* The simplest assertion ("ps shows no axiomregent")
> is platform-fragmented and race-prone. Codifying the helper here
> means consumer specs write `assert_no_orphan("axiomregent")` rather
> than re-implementing the platform fork.

**Files FR-T3 binds on:** `product/apps/opc/tests-e2e/harness/process_tree.*`.

### 3.4 Time-bounded UI-state assertions (FR-T4)

**FR-T4.** AC-8-class invariants ("cockpit unmounts within an
implementer-bounded window of the kill signal") require time-bounded
assertions. The harness MUST provide a `wait_for_subtree(component,
timeout)` helper that polls the WebView's mounted-component state at
a bounded cadence and fails the test if the predicate isn't satisfied
within the timeout.

The default poll cadence and timeout are harness config (not
spec-bound). Consumer specs MAY override per-fixture.

**Files FR-T4 binds on:** `product/apps/opc/tests-e2e/harness/wait.*`.

### 3.5 Nightly CI integration (FR-T5)

**FR-T5.** The harness MUST run on a CI cadence that is *not*
per-PR. The canonical landing is a nightly job
(`.github/workflows/opc-e2e-nightly.yml`) that:

(a) runs at a fixed schedule (cron) AND on workflow_dispatch;

(b) builds OPC across the supported targets matrix — the
WebDriver-capable subset of the release matrix. `tauri-driver` has a
Linux (WebKitWebDriver) / Windows (Edge) backend but **no macOS
WKWebView backend**, so the per-PR `desktop / rust` target
(aarch64-apple-darwin) cannot execute the WebView path; the nightly
builds + drives on Linux today, with Windows as future work (§8).
*(Implementation finding: the original "same targets as the per-PR
desktop/rust matrix" wording assumed that matrix was WebDriver-capable;
macOS-only, it is not.)*;

(c) executes all registered AC fixtures against each target's
binary;

(d) reports per-fixture pass/fail summary into the CI orchestrator
surface (spec 177);

(e) opens an issue (auto-filed or via dispatch hook — implementer's
choice) on failure so the regression is captured even when no one
is actively watching the dashboard.

The harness MUST NOT register itself as a required per-PR check.
Consumer specs MAY opt their fixtures into a pre-merge "fast e2e"
subset, but the default posture is post-merge nightly.

> *Rationale.* Per-PR e2e gates create a quadratic flake surface
> (every desktop target × every fixture). Spec 134's fast-local-ci-mode
> precedent is explicit: per-PR runs should target ~5 min warm. The
> harness's natural runtime is closer to ~20-30 min per target build,
> which budget-fits nightly but not per-PR.

**Files FR-T5 binds on:** `.github/workflows/opc-e2e-nightly.yml`.

#### 3.5.1 Seed helper is a cargo `[[example]]`, not a `[[bin]]` (2026-07-09)

The `[[opc-e2e-auth-state-seeding]]` follow-up (§8) first registered the
keychain seed helper as a `[[bin]]` in the opc crate manifest, gated behind
`required-features = ["e2e-seed"]` so the shipping build never compiles it.
That gating is correct for *production* but interacts badly with Tauri's
bundler: `tauri build` enumerates **every** `[[bin]]` target of the packaged
crate and copies each from the release target dir into the app bundle. A bin
whose `required-features` are not enabled is never built, so the bundler
failed with:

```
failed to bundle project Failed to copy binary from
".../target/aarch64-apple-darwin/release/e2e_seed_session": does not exist
```

This broke the Release Desktop workflow on all three platforms and the
nightly's own `tauri build` step (regression window: the nightly went green
→ red the first night after the helper landed). The fix keeps the helper in
the opc crate (the SAME-`keyring` guarantee above is load-bearing and a
standalone helper crate would forfeit it) but declares it as a cargo
`[[example]]` under `examples/e2e_seed_session.rs`. Tauri does not bundle
examples, so the app build is clean, while the nightly still builds the
helper explicitly with `cargo build --release --example e2e_seed_session
--features e2e-seed`. The harness resolves it at
`src-tauri/target/release/examples/e2e_seed_session`.

**Invariant.** The seed helper MUST NOT be a `[[bin]]` of a Tauri-bundled
crate. Any e2e-only executable co-located in the opc crate for dependency
parity is a cargo `[[example]]`.

#### 3.5.2 WebDriver session + keyring bootstrap (first-green-nightly, 2026-07-09)

Record correction: before the seed helper's `[[example]]` fix, the e2e step
had run green on 2026-07-04 *only because it masked failures* (`npm run
test:e2e | tee` returned `tee`'s exit code; the run showed 2 failed test files
yet "succeeded"). The `set -eo pipefail` that makes a fixture failure fail the
step landed in the same PR (#508) as the seeding fixtures, so the first honest
signal did not surface until the bundler bug (§3.5.1) was cleared. The
"first green nightly" §6 defers `implementation: complete` to has therefore
**never happened**; getting it green is initial bring-up, not a regression fix.

Environment contract 1, **FIXED and verified by nightly run 29042838102:**

1. **Classic WebDriver only.** WebdriverIO v9 negotiates WebDriver BiDi by
   default (`webSocketUrl: true`). tauri-driver proxies to WebKitWebDriver on
   Linux, which has no BiDi support and rejected the whole session with
   `session not created: Failed to match capabilities`. Fixtures MUST set
   `wdio:enforceWebDriverClassic: true`. `tauri-driver` and `webdriverio` are
   version-pinned in the nightly so this contract does not silently drift (a
   tauri-driver bump is a known cause of this exact error class,
   tauri-apps/tauri#8828). After this change the non-seeding fixture `ac7`
   passes and sessions create; the "failed to match capabilities" class is
   gone.

Environment contract 2, **FIXED and verified by `workflow_dispatch` run
29075858753** (the failure mode is Secret-Service-only and does not reproduce on
the macOS `apple-native` keychain, so this was verified push-then-observe
against the `workflow_dispatch` nightly rather than a local run):

2. **A default Secret Service collection MUST exist before any keychain
   write.** `gnome-keyring-daemon --unlock` on the fresh runner does not
   establish a default collection, so the seed writer's `set` failed with
   `Secret Service: no result found` (fixtures `ac8`, `208`). The earlier
   invocation piped `echo -n ""` (zero bytes / immediate EOF), which does not
   drive the daemon to register the `default` alias. The bootstrap is now two
   layers, tried in order: **(1)** a newline-terminated *empty* password
   (`printf '\n' | gnome-keyring-daemon --daemonize --unlock`, the keyring-rs CI
   pattern) so the daemon creates + unlocks the login keyring and registers it
   as the `default` collection; **(2)** a fallback that, if the `default` alias
   still did not materialise, force-creates the collection via `secret-tool
   store` (`libsecret-tools`). After this change both seeding fixtures pass
   (`ac8` and both `208` tests), the `Secret Service: no result found` class is
   gone, and the run moved from `3 failed | 1 passed` to `1 failed | 4 passed`
   with `ac9` (contract 3) the sole remaining failure. (The original error
   already confirmed the §3.5.1 `[[example]]` move works: the harness finds and
   runs the relocated binary.)

One contract remains OPEN (tracked in the follow-up issue; the nightly is
non-gating so it blocks nothing):

3. **Per-AC element interactions.** Even with a session, `ac9` fails at an
   element click with `element click intercepted` / `session deleted because
   of page crash or hang` under xvfb. This is per-fixture app/interaction
   bring-up, not an environment pin.

`implementation: complete` stays deferred until the first genuinely-green run,
which now requires only contract 3 (`ac9`) to be resolved: contracts 1 and 2
are verified fixed.

The FR-T5(e) auto-file-a-regression-issue step is scoped to the unattended
`schedule` event. A manual `workflow_dispatch` (the bring-up iteration loop used
to verify contract 2 push-then-observe) has an operator watching the run, so
auto-filing an issue on each failed dispatch would be noise, not signal; the
`schedule`-only guard preserves FR-T5(e)'s "capture the regression even when no
one is watching" intent while keeping iteration clean.

### 3.6 No implicit per-feature flake amnesty (FR-T6)

**FR-T6.** A flaky e2e fixture MUST NOT be silently disabled or
quarantined. If a fixture flakes, the consuming spec's owner is
notified (FR-T5(e) issue path), and the fixture is either fixed,
moved to manual-only with a recorded reason, or removed via spec
amendment. The harness MUST NOT carry a "skip flaky tests" flag.

> *Rationale.* Spec 116 (supply-chain) and spec 127 (coupling gate)
> set the precedent: gates that can be silenced erode invariants by
> surface area. The harness defends against the equivalent erosion
> in test infrastructure — a "tests are flaky, skip them" posture
> would dissolve the spec-bound AC claim.

**Files FR-T6 binds on:** `product/apps/opc/tests-e2e/harness/` (all
files — the absence-of-flag invariant is satisfied by inspection of
the harness root, not a single file).

### 3.7 Co-authority on per-AC fixtures (FR-T7)

**FR-T7.** Each per-AC test fixture under
`product/apps/opc/tests-e2e/fixtures/<consuming-spec>/` is co-authored:
this spec governs the *shape* (fixture must use the FR-T1..FR-T4
helpers, must register against FR-T5's runner), and the consuming
spec governs the *content* (which assertion the fixture makes).

This invariant is encoded via spec 152 section-scoped co-authority
on a per-file basis: when a consuming spec adds a fixture file, both
that spec AND this spec's spec.md must edit (or one of them must
declare amendment to the other under spec 133's `amends:` /
`amendment_record:` posture).

> *Rationale.* Without co-authority, a consumer spec could write a
> fixture that bypasses FR-T1's "use built binary" or FR-T6's "no
> skip flag" — re-introducing the very erosion §3.6 forbids. The
> co-authority binding means "harness shape" survives consumer-spec
> drift.

**Files FR-T7 binds on:** `product/apps/opc/tests-e2e/fixtures/**`.

## 4. Non-goals (binding)

These are written down to constrain future drift. A change that
contradicts any of them amends the corresponding invariant, not the
implementation.

- **Not a per-PR gate.** The harness MUST NOT register as a required
  per-PR check by default. A future "fast e2e subset" proposal
  amends FR-T5; it does not add a flag.
- **Not a unit-test replacement.** Specs that have unit-test-shaped
  ACs (the AC-5/AC-6 pattern in spec 183) MUST continue to ride per-PR.
  The harness covers the integration band, not the contract band.
- **Not a flake-tolerant runner.** Per FR-T6, no skip-flaky flag.
- **No spec-private fixtures.** All fixtures live under
  `tests-e2e/fixtures/<consuming-spec>/` with co-authored authority.
  A consuming spec MUST NOT stash an e2e fixture inside its own
  unit-test tree under a different path layout — the harness
  registry depends on the convention.
- **No mocked Tauri contexts.** Per FR-T1, the harness drives a
  *built* binary. A future "mock-WebView fast path" proposal amends
  FR-T1; it does not add a fallback mode.

## 5. Tier 3 exclusion

Absolute runtime budgets for the harness end-to-end run (e.g., "must
complete in <X minutes") are out of scope at this stage. Build time
varies across CI runners; the spec binds the *shape* (nightly
cadence, not per-PR), not a numeric ceiling. A future spec MAY tighten
this if it becomes a problem.

The same reasoning excludes absolute flake budgets — FR-T6 binds the
absence of a skip flag, not a flake-rate ceiling.

## 6. Acceptance

- **AC-1.** Spec frontmatter declares `kind: capability`, `domain:
  opc`. The relationship-graph fields (`establishes`, `references`,
  `depends_on`) are populated per §2. `code_aliases` includes
  `OPC_E2E_HARNESS`.
- **AC-2.** `spec-lint` does not regress; **V-020** does not fire on
  this spec.
- **AC-3.** `make pr-prep` exits clean against `origin/main` with
  this spec.md as the sole new authored artifact.
- **AC-4.** Once the harness directory exists and this spec's
  follow-up frontmatter amendment lands `establishes:`,
  `registry-consumer by-authority` returns this spec for each path
  under `product/apps/opc/tests-e2e/` (the directory unit) and for
  `.github/workflows/opc-e2e-nightly.yml`. The pre-implementation
  PR landing this spec.md ships without those `establishes:`
  entries per §2 (spec 154 §3.5 missing-directory hard-error).
- **AC-5.** The harness's built-binary driver (FR-T1) successfully
  launches the OPC binary on at least one supported target and
  reports the WebView's mounted top-level component name. This is
  the load-bearing smoke test for the harness itself.
- **AC-6.** The mock-statecraft server (FR-T2) supports all four
  modes (healthy, network-unreachable, handshake-rejects,
  mid-session-drop) and a fixture demonstrating each mode passes.
- **AC-7.** Process-tree introspection (FR-T3) correctly identifies
  a running axiomregent process on all three supported platforms
  (macOS, Linux, Windows). Negative case: returns absent for a
  process that was spawned and then `kill`ed.
- **AC-8.** The nightly workflow (FR-T5) lands at
  `.github/workflows/opc-e2e-nightly.yml`, is SHA-pinned per spec
  158, and triggers on schedule + workflow_dispatch.
- **AC-9.** Spec 183's AC-7, AC-8, AC-9 are migrated to harness
  fixtures under `product/apps/opc/tests-e2e/fixtures/183/`. **AC-7**
  (boot stays sticky when statecraft is unreachable) and **AC-9** (no
  orphan axiomregent after Quit) are migrated and registered in the
  nightly run; neither requires sign-in. Both are *verified by the
  first green nightly* — they have never executed locally, because
  tauri-driver has no macOS WebView backend and the binary-driving
  fixtures run only on Linux (FR-T5). **AC-8** (cockpit reverts to
  `<BootGate>` on sidecar kill) begins "from a fully-signed-in cockpit".
  It was originally migrated as a `describe.skip` (FR-T6 "manual-only"
  path, NOT a flake skip) because reaching that state headlessly was not
  yet possible: OPC sign-in is a full GitHub OAuth/PKCE browser flow
  against Rauthy (`product/apps/opc/src-tauri/src/commands/auth.rs`) with
  no dev bypass, and `org_session_ready` requires a materialised `org_id`.
  The `[[opc-e2e-auth-state-seeding]]` follow-up (§8) has since landed
  `seedSignedInSession` + `killProcess`, so AC-8 is now un-skipped and
  registered in the nightly run alongside AC-7/AC-9, verified by the first
  green nightly. The deferral pattern is fully retired.

AC-1 through AC-4 are spec-shape gates and ride per-PR. AC-5 through
AC-9 are implementation gates that ride post-implementation; they
gate the harness's `implementation: complete` flip, not this spec's
`status: approved` flip.

The landing PR therefore flips `status: approved` (AC-1..AC-4 met) and
holds `implementation: in-progress`. The binary-driving paths
(AC-5/AC-7/AC-9) have never executed end-to-end — by FR-T5 they run
only in the post-merge Linux nightly — so asserting
`implementation: complete` at PR time would claim completion of code
that has never run. `implementation: complete` is deferred to a small
follow-up PR after the first green nightly confirms AC-5/AC-7/AC-9
pass on Linux. That second PR is the verification gate working as
designed, not friction.

## 7. Out of scope (and why)

- **Spec 183's AC-7/8/9 migration in this PR.** The migration is
  this spec's AC-9 — it lands when the harness implementation does.
  This spec's per-PR landing is the spec.md alone (and any frontmatter
  edits to consumer specs that need to declare co-authority).
- **Other consumer-spec migrations.** A future spec MAY enumerate
  other deferred-to-nightly ACs across the corpus (e.g., factory-run
  end-to-end, statecraft duplex resync) and migrate them to this
  harness. Out of scope here; each migration is a separate PR.
- **Performance benchmarking.** "Does OPC boot in <Xs?" is a
  different test class (criterion-style microbench) and belongs in
  `product/apps/opc/src-tauri/benches/` (spec 180 §FR-T8 references
  this directory). The harness covers correctness, not perf.
- **Visual regression testing.** "Does the boot screen look right?"
  is image-diff infrastructure; out of scope here. May be a future
  spec under a separate capability.

## 8. Future work

- `[[opc-e2e-auth-state-seeding]]` (LANDED): the `seedSignedInSession`
  helper (`tests-e2e/harness/seed_session.ts`, backed by the feature-gated
  `e2e_seed_session` bin) writes a keychain `session` token carrying a
  materialised `org_id`, and `killProcess({name})`
  (`tests-e2e/harness/kill_process.ts`) SIGKILLs a sidecar by name. Together
  they un-skip `fixtures/183/ac8-precondition-loss.e2e.ts` (signed-in
  cockpit, sidecar kill, `<BootGate>` reasserts), so AC-8 now runs in the
  nightly rather than as a `describe.skip`. OPC never verifies the session
  JWT's signature (`statecraft_client.rs::decode_jwt_claims`) and the mock
  duplex accepts any bearer, so a seeded fake token is a complete signed-in
  state. The nightly runs the e2e step inside a D-Bus session with an
  unlocked gnome-keyring so the `keyring` crate's Secret Service backend is
  available to both the seed writer and the OPC binary. `implementation:
  complete` still awaits the first green nightly confirming AC-5/AC-7/AC-9
  (now including AC-8) on Linux, per §6.
- `[[opc-e2e-fast-pre-merge-subset]]` — proposal to opt a small
  subset of fixtures into per-PR runs once the nightly cadence has
  established a non-flaky baseline. Amends FR-T5.
- `[[opc-e2e-trace-capture]]` — capture WebView devtools traces,
  Tauri IPC traces, and stderr on every fixture failure so the
  post-mortem path is automatic. Adds an FR; does not amend an
  existing one.
- `[[opc-e2e-cross-platform-binary-cache]]` — share built OPC
  binaries across nightly runs so the harness's runtime is dominated
  by fixture execution rather than rebuilds. Cost/benefit decision
  deferred until nightly cadence is observed in practice.

## 9. Cross-references

- **Spec 032** — OPC inspect+governance MVP; the cockpit surface
  this harness drives.
- **Spec 073** — axiomregent unification; the sidecar the harness
  spawns and kills in FR-T3-class assertions.
- **Spec 087** — unified workspace architecture; defines the duplex
  envelope grammar the mock-statecraft server (FR-T2) must emulate.
- **Spec 134** — fast-local-ci-mode; sets the per-PR runtime
  budget the harness must not erode (rationale for FR-T5 nightly
  posture).
- **Spec 158** — workflow-ref SHA pinning; FR-T5's nightly workflow
  must satisfy this lint.
- **Spec 177** — ci-orchestrator-pr-gate; the harness registers
  against this orchestration surface but does not auto-enroll as a
  per-PR check.
- **Spec 183** — OPC boot precondition gate; the canonical first
  consumer. AC-7/8/9 were deferred to this harness at spec-183 PR
  time (see spec 183 §6 last paragraph).
