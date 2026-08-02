---
id: "004-kernel-native"
title: "The governance kernel as a napi-rs native addon"
status: approved
created: "2026-07-20"
implementation: complete
depends_on:
  - "000-bootstrap"
  - "001-packages-thesis"
establishes:
  - { kind: directory, path: "addon/kernel-native/" }
summary: >
  The third package: `@statecrafting/kernel-native`, the runtime governance
  kernel of the governed cell. It is the generalization of chancery's
  `kernel-addon` (the donor: 853 LOC, Apache-2.0, spineless) from the
  message-send domain to arbitrary effects: action-gate adjudication, the
  attest-ledger Decision chain, and the trust-window ladder behind a
  JSON-in / JSON-out napi surface that is a pure function of its inputs.
  It boots from `app-model.json` (enrahitu spec 020), builds per-service
  enforcement tables, and refuses to start on integrity mismatch.
  Apache-2.0: it is substrate that stamped apps consume; the AGPL shield
  stays reserved for the control-plane addons. The in-house
  effect-dispatch crate is Phase B and is not this package.
---

# 004: The governance kernel as a napi-rs native addon

## 1. Purpose

kernel-native is Phase A's enforcement point (the realignment, fork 4:
knowledge://grand-refactor/02-realignment): the kernel at the existing
napi boundary. It gives the whole TS tier attempt-deny-audit semantics
with a pure, golden-testable kernel before any effect-dispatch machinery
exists. The operations that already route through Rust (CoreLedger driver
calls, hiqlite KV/counters, secrets, governed egress) are adjudicated
against the app model; every denial and grant is expressible as a
ledgered Decision.

It is a generalization, not a greenfield build. chancery's `kernel-addon`
(`chancery-kernel` 0.1.0) already proves the composition: action-gate +
attest-ledger + trust-window + canonical-keysort-json, behind JSON-in /
JSON-out napi functions, in under 1k LOC, with persistence and I/O-bound
signal precomputation left to the consumer. What changes here is the
domain: where chancery gates one effect kind (`message.send`) with
message-domain checks, kernel-native gates arbitrary effects against a
declared capability ceiling loaded from `app-model.json`.

**Reframing of the spec 001 ladder.** Spec 001 section 5 sequenced
"004: kernel-native. From chancery." as a package move. The grand
refactor sharpened what actually arrives: not chancery's message-domain
kernel renamed, but its generalization to arbitrary effects. The donor
code is read, not transferred; chancery keeps its addon untouched until
it re-bases (section 4). What spec 001 promised still holds: the package
arrives here governed, with the LICENSE file chancery never had.

## 2. Territory

A single napi-rs package, `addon/kernel-native/`, plus the per-platform
binary packages napi generates from it:

| Package | Contents |
|---|---|
| `@statecrafting/kernel-native` | the napi loader (`index.js` + `index.d.ts`, built); no binary |
| `@statecrafting/kernel-native-darwin-arm64` | the `.node` for macOS arm64 |
| `@statecrafting/kernel-native-linux-x64-gnu` | the `.node` for linux x64 |
| `@statecrafting/kernel-native-linux-arm64-gnu` | the `.node` for linux arm64 |

The Rust crate is self-contained: it depends on the four family crates
from crates.io (`action-gate-core` with `checks-common`,
`attest-ledger-core`, `trust-window`, `canonical-keysort-json`) plus
serde, with no workspace or path dependency. Build output (`index.js`,
`index.d.ts`, `*.node`, `npm/`) is gitignored; the platform package
directories are generated at publish time by `napi create-npm-dirs`.

The crate keeps the donor's two-build discipline: `crate-type` is
`["cdylib", "rlib"]`, the `napi` feature is off by default, and every
exported behavior lives in napi-free modules, so a plain `cargo test`
builds and tests the entire kernel without a Node runtime. The `#[napi]`
layer (`src/napi_api.rs`) is a thin delegator with no logic of its own.

Module map: `model` (app-model DTOs, integrity verification), `kinds`
(the v0.1 capability-kind table), `tables` (enforcement-table
compilation), `gate` (roster assembly and config hash), `adjudicate`
(the effect decision), `kernel` (the booted instance and its write-once
process slot), `payload` (the Decision payload, record build, chain
verify, genesis), `ladder` (trust-window scoring), `wire` (the JSON
boundary), `napi_api` (feature-gated delegators).

## 3. Behavior

### 3.1 License

Apache-2.0, with its own LICENSE file. kernel-native is substrate:
stamped customer apps load it in-process, so it belongs to the
permissive tier (spec 001 section 3). The AGPL shield stays reserved for
statecraft's control-plane addons (`governance-native`, `fleet-native`);
per the dependency-direction invariant (spec 001 section 3.2),
kernel-native must never depend on either.

### 3.2 The kernel contract

The crate is a pure function of its inputs: no host calls, no wall
clock, no database, no environment reads. Persistence (the Decision
chain, trust-window snapshots) and the precomputation of I/O-bound
signals (anything the consumer must look up before adjudication) are the
consumer's job. Timestamps are caller-supplied. Same inputs produce the
same bytes on every platform; that is what keeps the kernel
golden-testable and every recorded Decision independently recomputable.

One honest exception to statelessness: the kernel holds exactly one
piece of process state, the compiled enforcement tables of the booted
model, set once at boot. The alternative (passing the tables back in on
every call) would make the TS caller the custodian of its own ceiling,
able to widen it per call. Instead the model crosses the boundary once,
integrity-checked; a second `boot` with the same model hash is
idempotent, and a `boot` with a different model is an error (changing
the model means restarting the process). Every exported function remains
a deterministic function of (booted model, arguments), and the
compilation itself is a pure function exercised directly by the tests.

### 3.3 Boot

`boot(model_json)` loads an `app-model.json` (the contract is enrahitu
spec 020; this spec consumes it and does not own it), verifies it,
compiles the enforcement tables, and returns a receipt
`{modelHash, gateConfigHash, contractVersion, services, agents,
capabilities}`. A model that fails any verification is a refusal to
start, not a warning. The refusals, all fail-closed:

1. JSON parse failure, or a document missing the members the kernel
   reads.
2. `contract.name` is not `app-model`, or `contract.version` is outside
   the kernel's pinned range (v0.1 accepts `>=0.1.0 <0.2.0`).
3. `integrity.algorithm` is not `sha256-canonical-keysort-v1`, or
   `integrity.hash` does not match recomputation (canonical bytes of the
   document with the `integrity` member removed, per 020 section 3.5).
   The verified `integrity.hash` is the model hash everywhere below.
4. A dangling reference: a service or agent naming a capability id not
   in the catalog, or an agent naming an unknown service.
5. A capability kind outside the kernel's kind table. The kernel must
   classify every kind it enforces; an unknown kind cannot be enforced
   and therefore cannot be permitted.

   **The table is therefore the gate on the whole vocabulary, and that is
   the point rather than a limitation.** A consumer cannot govern an
   effect the kernel has never heard of, so adding a kind is deliberately
   a change here, reviewed and released, rather than a string a producer
   invents. The cost is a release on the critical path of every new
   effect family; the alternative is a model that can name its own
   ceiling into existence, which is not a ceiling.

   `smtp.egress` is the first kind added after v0.1's original 28
   (enrahitu spec 037 §3.2). Mail is the first effect to escape the
   HTTP-shaped egress facade: an SMTP transport opens a TCP socket, which
   a governed fetch never sees, so a deployment could be made to send
   mail with no Decision recorded. It is classified non-read for the same
   reason `secret.read` is: sending acts on the world, whatever the verb
   suggests.
6. A constraint key the kernel cannot enforce (v0.1 enforces `tables`,
   `keyPrefix`, `domains`, `topics`, `tools`). A declared constraint the
   kernel would silently skip is a hole in the ceiling.
7. A gate check id the kernel does not implement (v0.1 vocabulary:
   `secrets`). Running without a mandated check would weaken
   enforcement, so the old-kernel-new-model case refuses.
8. An assembled roster whose `config_hash()` differs from the model's
   pinned `gate.configHash`: adjudication config is part of the anchored
   surface (020 section 3.1).
9. A `trust.windowConfig` that does not deserialize as trust-window's
   `WindowConfig`.

### 3.4 Adjudication

`adjudicate(request_json)` disposes one proposed effect against the
booted tables. The request names the acting `service`, optionally the
acting `agent` and its current `trust` level (from the consumer's
persisted ladder state), the `capability` `{kind, resource}` being
exercised, and optional `payloadSummary` / `payloadBody` / `attributes`
(the precomputation contract: `domain`, `table`/`tables`, `key`,
`topic`, `tool`). The result is
`{decision: {outcome, reason, check_ids, blocking}, configHash,
modelHash}`, the donor's decision shape bound to both anchors.

Deny-by-default, in short-circuit order:

1. **Unknown service**: blocking deny (`kernel:deny:service:*`).
2. **Ceiling membership**: the request must match a grant in the
   service's capability set; when an agent acts, the grant must also be
   in the agent's rows (the intersection: an agent never exceeds its
   service). A grant matches when its kind equals the request's and its
   resource is `*` or equals the request's. No match is a blocking deny
   (`kernel:deny:capability:undeclared`). Absence is never permission.
3. **Constraints**: a matching grant's constraints must be satisfied by
   the request's attributes (`domains` membership, `tables` membership,
   `keyPrefix` prefix, `topics` membership, `tools` membership). A
   constrained grant whose attribute is absent is denied, not excused:
   unverifiable is denied. When several grants match, satisfying any
   one suffices (a broad grant may sit beside a narrow one). Violation
   is a blocking deny (`kernel:deny:constraint:*`): constraints are part
   of the declared ceiling.
4. **Trust ceiling** (only when an agent acts): the effective level is
   the request's `trust` if given, else the agent's declared `initial`,
   clamped to the agent's declared `ceiling` (worst-of, trust-window
   severity ordering). `suspended` is a blocking deny. `read-only`
   denies (non-blocking) any kind not classified read in the kind
   table; a human grant can meaningfully override a trust throttle, so
   this deny is overridable where a ceiling violation is not.
   `secret.read` is deliberately classified non-read: released
   credential material acts on the world, whatever the verb says.
   `restricted` adds no v0.1 restriction; fusing risk tiers with trust
   (chancery's autonomy policy) stays a domain layer above this kernel.
5. **The roster gate**: the checks named by `gate.checks` run as an
   action-gate over the request (action `kind:resource`, payload and
   attributes passed through). v0.1 ships `secrets` (credential
   patterns in the payload, blocking deny). The structural checks above
   are not roster-configurable: a model cannot opt out of its own
   ceiling.

The gate's `config_hash()` covers the roster; the model hash covers the
tables. A recorded Decision binds both, so an auditor can replay any
recorded adjudication against the exact configuration that produced it.

### 3.5 The Decision chain

The ledger faculty is the donor's, re-anchored to the model. The
consumer assembles an `EffectDecision` payload (`decision/v1`):
`{modelHash, gateConfigHash, service, agent?, capability: {kind,
resource}, contextHash, outcome, reason, checkIds, approver?}`; the
`approver` field records the principal on a human-granted override, so
grants as well as denials append as Decisions.
`build_record(prevHash, id, timestamp, effectDecision)` produces one
hash-linked `LedgerRecord` (timestamps caller-supplied);
`verify_chain(records)` re-verifies integrity exactly as the stock
attest-ledger CLI would. `genesis_payload(model_json)` derives the
deploy-time genesis payload `{modelHash, gateConfigHash,
contractVersion}` (020 section 3.6) from a verified model; the genesis
instance lives only in the ledger, never in the model.

### 3.6 The trust ladder

`score(config, snapshot?, samples)` runs trust-window scoring over
consumer-persisted snapshots and returns `{score, level, snapshot}`;
`default_window_config()` returns trust-window's defaults. The model's
`trust.windowConfig`, when present, is validated at boot and echoed in
no hidden form: the consumer persists window state and passes it back,
exactly the donor's seam. Mapping review outcomes to samples is domain
vocabulary and stays with the consumer (chancery's `ReviewOutcome` is
the worked example).

### 3.7 The napi surface

Eight JSON-in / JSON-out functions, each a thin delegator over the
napi-free `wire` module:

| Function | Contract |
|---|---|
| `boot(modelJson)` | verify + compile + hold (write-once); returns the receipt |
| `adjudicate(requestJson)` | one effect against the booted tables |
| `genesisPayload(modelJson)` | `{modelHash, gateConfigHash, contractVersion}` from a verified model |
| `gateConfigHash(checksJson)` | the roster hash, for producers pinning `gate.configHash` |
| `buildRecord(prevHash, id, timestamp, effectDecisionJson)` | one hash-linked ledger record |
| `verifyChain(recordsJson)` | `{ok, error?}` chain integrity |
| `score(configJson, snapshotJson?, samplesJson)` | `{score, level, snapshot}` |
| `defaultWindowConfig()` | trust-window defaults as JSON |

### 3.8 Publishing

Joins the spec 002 publish matrix (`.github/workflows/publish.yml`) with
the same three napi legs as hiqlite-native plus the meta package,
idempotent per version. The `napi` feature is passed explicitly by the
build script, mirroring the donor.

## 4. Ownership: a donor, not a transfer

chancery's `kernel-addon/` is the donor and is not modified by this
spec. chancery has no spine, so there is no `establishes` edge to drop
(spec 001 section 4); the ungoverned original simply stays where it is
until chancery re-bases onto the generalized kernel, re-expressing its
domain content (the grounding / suppression / injection / fatigue / tone
checks, the autonomy policy and risk tiers, `SendContext`,
`ReviewOutcome`, `MessageDecision`) as a layer above
`@statecrafting/kernel-native`. That re-base, and the npm disposition of
`@chancery/kernel-native` (never published; the name retires with the
re-base), are chancery's work, out of scope here.

## 5. Acceptance

1. The pure core builds and tests green under a plain `cargo test` (no
   napi): boot refusals (integrity, gate hash, unknown kind, unknown
   check, unenforceable constraint, dangling refs), deny-by-default
   membership, constraint denial, trust ceiling, the roster gate, chain
   build + verify, genesis payload, and determinism of the model hash.
2. `@statecrafting/kernel-native` and its three platform packages
   publish at `0.1.0` with provenance, all declaring Apache-2.0 with a
   LICENSE file.
3. The first consumer (enrahitu's Phase A kernel boot) builds against
   the published package. Per spec 001 section 5 the package is not done
   until a consumer does; that consumer's arrival is enrahitu's spec
   work, not this repo's. **Satisfied 2026-07-20**: enrahitu spec 021
   (statecrafting/enrahitu PR #23) boots the kernel from its committed
   app-model.json, adjudicates its Rust-routed operations, and runs its
   full suite green against the published 0.1.0, on both CoreLedger
   drivers, including boot-refusal, constraint-denial, and
   chain-verify tests against this package's napi surface.

## 6. Out of scope

- Phase B: the in-house effect-dispatch crate (corophage-pattern), the
  Rust handler tier, actor mailboxes. The dispatch crate is a separate
  future spec; this kernel is what it will dispatch into.
- The app-model contract itself (enrahitu spec 020 owns schema,
  determinism rules, versioning) and its producers (the toolchain
  lowering stage, the Phase B registry).
- Wiring enrahitu's Rust-routed operations through `adjudicate`, the
  live Decision ledger, and the deploy-time genesis append: enrahitu's
  Phase A specs.
- Persistence and I/O-bound signal precomputation, by construction.
- chancery's re-base and the retirement of `@chancery/kernel-native`.
- `governance-native` and `fleet-native` (specs 005 and 006, AGPL-3.0).
