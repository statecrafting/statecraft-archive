# @statecrafting/governance-native

The control plane's governance spine as a napi-rs addon (statecrafting spec
005). It wraps four crates.io crates (extracted from OAP's policy-kernel,
published under the statecrafting org) and exposes them to an Encore.ts
`governance/` service as plain-JSON-in / plain-JSON-out functions:

**AGPL-3.0.** This is a control-plane internal: no stamped customer app loads
it, so it keeps statecraft's copyleft shield (statecrafting spec 001 §3). It
must never be depended on by `@statecrafting/toolchain`, `hiqlite-native`, or
`kernel-native`, which are Apache-2.0 substrate (spec 001 §3.2).

| crate | primitive |
|---|---|
| `canonical-keysort-json` | byte-identical canonical JSON |
| `attest-ledger` | tamper-evident record chain + Ed25519 anchors |
| `action-gate` | deterministic gate over an ordered check registry |
| `trust-window` | rolling-window trust scorer |

## Surface

```
canonicalize(json)                 -> { canonical, sha256 }
ledgerAppend(stateDir, record)     -> { seq, recordHash, chainHash }
ledgerVerify(stateDir)             -> { ok, seq, error? }
ledgerAnchor(stateDir, keyRef)     -> anchor JSON   (keyRef: base64 32-byte Ed25519 seed)
gateEvaluate(configJson, ctxJson)  -> { outcome, reason, checkIds, blocking, configHash }
trustSample(snapshotJson, sample)  -> snapshot JSON  (snapshotJson may be null)
trustLevel(snapshotJson)           -> { level, score }
```

The ledger file store (`<stateDir>/records.jsonl` + `anchor.json`, the `seq`
counter, the genesis anchor) lives here: `attest-ledger` is storage-agnostic by
design. The gate config schema and the four v1 checks (`posture-required`,
`confirm-name-required`, `tenant-active`, `actor-authenticated`) live here too:
`action-gate` ships the machinery, not the domain policy.

`config/gate.v1.json` is the canonical v1 roster, vendored here so the crate is
self-contained. The consuming service keeps its own deployed copy; both are
pinned to the same asserted config hash, so a drift in either fails a test.

## Build & test

```bash
cargo test --no-default-features   # pure-logic tests, no Node C API linkage
npm install && npm run build       # build the per-platform .node (needs @napi-rs/cli)
```

The `#[napi]` bindings are behind the default `node` feature; `cargo test`
turns it off so the test harness links without Node's symbols. All four
governance crates are exact-pinned (`=0.1.0`) per statecraft spec 008 §1.
