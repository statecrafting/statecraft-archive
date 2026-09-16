---
id: "008-governance-attestation"
title: "Governance spine: attestation ledger + action gate + trust window"
status: approved
created: "2026-07-14"
implementation: complete
depends_on:
  - "001-statecraft-thesis"
establishes:
  - { kind: directory, path: "backend/governance/" }
summary: >
  The platform's tamper-evident memory and its decision spine, built on
  the four crates extracted from OAP's policy-kernel: attest-ledger
  (tamper-evident record chain + signed anchors), canonical-keysort-json
  (byte-identical canonical JSON), action-gate (pure deterministic
  Gate over an ordered Check registry), and trust-window
  (rolling-window trust scorer mapping to graduated privilege). A
  napi-rs addon wraps the Rust crates; a governance/ Encore service
  exposes record/verify/gate/trust APIs that factory (005) and fleet
  (006) call at their privileged moments. This is the platform's
  differentiator: not that it deploys apps, but that every privileged
  act is gated, recorded, and independently verifiable.
---

# 008: Governance: attestation, gating, trust

## 1. Crate dependencies (read first)

Four external crates, extracted from the OAP policy-kernel
(statecraft-ing lineage). DECIDED 2026-07-14: all are published on
crates.io under the statecraft-ing org (verified: canonical-keysort-json
0.1.0, attest-ledger-types/core/cli 0.1.0, action-gate-types/core
0.1.0, trust-window 0.1.0; repository fields point at
github.com/statecrafting/*). Consume from crates.io with exact version
pins (`=0.1.x` while pre-1.0); do NOT use git dependencies. Local
working copies exist at ~/DevWork/<name> for reference reading if the
session has access.

- `canonical-keysort-json`: deterministic canonical JSON: recursive
  lexicographic key sort at the serialization boundary; values
  serialize byte-identically regardless of serde preserve_order.
- `attest-ledger-types` + `attest-ledger-core` (repo attest-ledger):
  the tamper-evident LedgerRecord envelope, signed ChainAnchor,
  hashing, Ed25519 anchor signing, independent verification of the
  record chain and audit-segment chain. (`attest-ledger-cli` exists as
  an independent verifier; not a dependency, but its existence is the
  design point: third parties can verify our ledger without our code.)
- `action-gate-types` + `action-gate-core` (repo action-gate): a pure,
  deterministic Gate over a pluggable ordered Check registry, stable
  config hash, ActionContext -> Decision/Outcome.
- `trust-window`: rolling-window trust scorer: weighted samples map to
  a graduated privilege level, degrade-only or bidirectional,
  deterministic, snapshot-persistable.

## 2. Territory

- `@statecrafting/governance-native`: napi-rs cdylib `governance-native`.
  **Transferred 2026-07-20** to the statecrafting repo as its spec 005 and
  consumed here as a pinned published dependency; it lived at
  `addon/governance-native/` until then. The surface below is unchanged by
  that move and remains this spec's integration contract, but the addon's
  implementation, tests, and license are governed there. Exposed surface
  (plain JSON in/out):
  - `canonicalize(json) -> {canonical, sha256}`
  - `ledgerAppend(stateDir, record) -> {seq, recordHash, chainHash}`
    and `ledgerVerify(stateDir) -> {ok, seq, error?}` over an
    append-only file store; `ledgerAnchor(stateDir, keyRef) -> anchor`
    (Ed25519; key from an Encore secret, never on disk unencrypted).
  - `gateEvaluate(configJson, actionContextJson) -> decision` with the
    gate's stable config hash included in the result.
  - `trustSample(snapshotJson|null, sampleJson) -> snapshotJson` and
    `trustLevel(snapshotJson) -> {level, score}`.
- `governance/`: Encore.ts service:
  - `POST /governance/records` (internal + API): append an attestation
    {kind: stamp|deploy|update|backup|remove|approval, subject ids,
    payloadHash (keysorted sha256 of the full payload), actor}: the
    full payload itself goes into the record; CoreLedger keeps an
    index row (recordSeq, kind, subject, hash) for queries while the
    chain file is the authority.
  - `GET /governance/records?subject=...` list from the index;
    `GET /governance/verify` runs ledgerVerify and returns the chain
    head.
  - `POST /governance/gate` (internal): evaluate an ActionContext for
    factory/fleet privileged verbs; deny is final, allow returns the
    decision + config hash which the caller must attach to its
    attestation record.
  - Trust: per-actor (user or agent identity) snapshots persisted via
    CoreLedger; samples appended on gate outcomes and operation
    results; level is advisory v1 (exposed, not yet enforced).
- Gate config v1 (checks, ordered): posture-required (stamps must
  carry an explicit agentic posture), confirm-name-required (fleet
  remove), tenant-active, actor-authenticated. Config lives in a
  committed JSON with its stable hash asserted in a test, so config
  drift is visible in review.

## 3. Integration contract (for specs 005/006)

Callers wrap privileged transitions: evaluate gate -> on allow, act ->
append attestation with the gate's config hash and the action's
payload hash. Factory stamps additionally record the born-with
certHash (enrahitu spec 012 §4), which makes the repo-local cert and
the platform ledger mutually checkable. Callers must treat a missing
governance service as deny for remove-class actions and
warn-and-proceed for read-class; never silently skip a gate.

## 4. Acceptance

- Rust addon tests: canonicalize matches canonical-keysort-json's own
  test vectors; append/verify detects a tampered byte; gate decision
  deterministic across runs with stable config hash; trust level
  transitions on a scripted sample stream.
- Service tests: record round-trip (index row + chain growth +
  verify ok), gate deny surfaces to callers, payloadHash equals an
  independently computed keysorted sha256.
- One integration test proving the spec 005 pattern: a fake stamp
  flow calls gate -> append -> verify.
- Spine gates + verify verb green.

## 5. Out of scope

- Enforcing trust levels on real actions (advisory in v1).
- External anchor publication (e.g. a public transparency log) and
  key rotation ceremonies.
- The approvals human-workflow UI (data shape lands here; UI is a
  follow-up to spec 007).

## 6. Status (2026-07-14)

`implementation: in-progress`. Taken ahead of the app shell under the
AGENTS.md backlog exception (008's addon + service may start first; the
service wiring rebases onto the shell when spec 002 lands). The addon is
complete and green; the Encore service is authored against the chassis idiom
and awaits the shell to typecheck and run.

**Implementation decisions** (refine §2/§3, do not contradict them):

- **Crate consumption.** All four crates verified live on crates.io and
  pinned exactly: `canonical-keysort-json`, `attest-ledger-types`,
  `attest-ledger-core`, `action-gate-types`, `action-gate-core`,
  `trust-window`, all `=0.1.0`. No git deps (§1 honoured).
- **The addon owns the ledger file store.** `attest-ledger` is
  storage-agnostic, so `addon/governance-native/` defines the layout:
  `<stateDir>/records.jsonl` (one `LedgerRecord` per line, the authority) +
  `<stateDir>/anchor.json` (the genesis anchor, unsigned until
  `ledgerAnchor` signs it with an operator Ed25519 seed). `seq` is the
  0-based line index; the chain head after an append equals that record's
  hash. Genesis root is `sha256("statecraft.governance.ledger/v1")`.
- **The addon owns the gate config schema and the four checks.**
  `action-gate` ships the ordered-registry machinery but no config model
  and none of the v1 checks, so `GateConfigV1` (an ordered id list) and
  `posture-required` / `confirm-name-required` / `tenant-active` /
  `actor-authenticated` are implemented here, reading `ActionContext`
  attributes. The committed `governance/config/gate.v1.json` keeps the spec
  order; its stable config hash
  (`sha256:a0356df3a1d2ca95a030e1d9329a7ceb20a54fc1ed1834dd0b158047c306f107`)
  is pinned by an addon test so config drift shows up in review (§2).
- **Trust envelope.** `trust-window` keeps config and snapshot separate; the
  addon's snapshot JSON embeds both so a snapshot round-trips its own
  configuration (and the degrade-only latch) across stateless calls.
- **napi test linkage.** The `#[napi]` bindings sit behind a default `node`
  feature; `cargo test --no-default-features` exercises the pure logic
  without linking the Node C API.

**Landed:** `addon/governance-native/` (the six-function napi surface over the
four crates, `cargo build` green as a cdylib and `cargo test
--no-default-features` green: 22 tests covering canonicalize vectors,
append/verify tamper detection, gate determinism + pinned config hash, trust
level transitions, and the §4 gate→append→verify flow); `governance/` (the
Encore service: records/verify/gate/trust endpoints, the CoreLedger index and
trust store, the native facade, config); `governance/config/gate.v1.json`;
`spec-spine.toml` standalone lists. Spine gates green (compile, index, lint
`--fail-on-warn`, index check) with zero waivers.

**Remaining (blocks `complete`), all gated on the app shell (spec 002):**

- The service cannot typecheck, run, or be vitest-tested until the chassis
  provides `encore.dev/*`, CoreLedger (`../core/ledger`, spec 003), the root
  npm package, and the built `@statecraft/governance-native` `.node`. On 002:
  add the addon as a dependency, `npm run build` it, and the authored
  `governance/records.test.ts` (record round-trip + index row + independent
  payloadHash + gate deny) runs green.
- Acceptance items still open until then: the service tests (§4 bullet 2) and
  the verify verb (§4 bullet 4) over the shell; the born-with certHash
  cross-check (§3) lands with the factory (spec 005).

**Status (2026-07-15): complete.** Rebased onto the app shell (spec 002)
in the same landing. The service moved from repo-root `governance/` to
`backend/governance/` (the two-directory layout, enrahitu spec 019): its
`../core/ledger` import now resolves to `backend/core/ledger` and Encore
discovers it as a service. The root `package.json` carries
`@statecraft/governance-native` as a `file:` dep built by `build:addon`;
`native.ts` imports the built `.node`.

Wiring adjustments made on the rebase (faithful to §2/§3, no behavior
change): the list response uses a plain `AttestationRecord` DTO (Encore's
schema parser rejects a decorated CoreLedger entity as a response type);
the gate-config and state-dir paths resolve from the app root
(`process.cwd()`), not `import.meta.url`, because enrahitu-build runs the
bundled app from `.encore/build/combined/` (mirrors the chassis's own
`backend/lib/secrets.ts`); the pinned gate-config hash is byte-unchanged.

Acceptance now holds: `npm run typecheck` and `npm test` are green,
including `backend/governance/records.test.ts` (record round-trip + index
row + independent payloadHash + gate deny + the §4 gate->append->verify
flow); `cargo test --no-default-features` stays green (22); `npm run dev`
serves `/governance/verify` (ok), `/governance/records`, and
`/governance/trust/:actor`. Deferred by design: the born-with certHash
cross-check (§3) lands with the factory (spec 005); trust-level
enforcement stays advisory (§5).

### 2026-07-20: the addon transferred out; this spec narrowed, not retired

`addon/governance-native/` left for the statecrafting repo, where it is that
repo's spec 005 and publishes as `@statecrafting/governance-native` 0.1.0
(AGPL-3.0, unchanged). This spec dropped that one `establishes` edge and keeps
`backend/governance/`: the service, its endpoints, the CoreLedger index and
trust store, the deployed gate config, and the section 3 integration contract
that specs 005 and 006 call at their privileged moments. Per statecrafting spec
001 section 4 an edge is transferred, never duplicated, and no exporting spec
retires: this one owns code that is still running.

What changed here: the root manifest depends on
`@statecrafting/governance-native` at `0.1.0` instead of
`file:./addon/governance-native`, `backend/governance/native.ts` imports the
published package, the `build:addon` script and its CI steps are gone (`npm ci`
installs a prebuilt per-platform binary), and the two `spec-spine.toml`
standalone entries are removed.

`backend/governance/config/gate.v1.json` stays here and is still read at
runtime from the app root. The addon vendored its own copy of the same roster
so its crate is self-contained (statecrafting spec 005 section 2.1); both are
pinned to the identical config hash
(`sha256:a0356df3a1d2ca95a030e1d9329a7ceb20a54fc1ed1834dd0b158047c306f107`,
byte-unchanged by the move), so drift in either copy fails a test in its own
repository. That is the same "config drift is visible in review" property
section 2 asked for, now holding across two repositories.

Nothing in the addon's behavior or surface changed. Acceptance is unaffected:
the service tests still pass against the published package.

## Amendment (2026-07-21): spec 011 tenant lifecycle

Spec 011 makes one coordinated edit in this spec's `backend/governance/`
territory: `records.ts` adds a `tenant_delete` value to the
`AttestationKind` union, so deleting a tenant (a privileged act) can be
recorded in the attestation ledger. The gate and ledger behavior are
otherwise unchanged. See specs/011-tenant-lifecycle/spec.md §5.5.
