# governance/

The platform's governance spine (spec 008): tamper-evident attestation
records, the deterministic action gate, and per-actor trust scoring. Every
privileged act factory (005) and fleet (006) perform is gated, recorded, and
independently verifiable.

## Shape

```
encore.service.ts   the Encore service declaration
native.ts           typed facade over @statecrafting/governance-native
config.ts           state dir, committed gate config, anchor signing secret
store.ts            CoreLedger index (attestation rows + trust snapshots)
records.ts          POST /governance/records, GET /governance/records, GET /governance/verify
gate.ts             POST /governance/gate
trust.ts            POST /governance/trust/sample, GET /governance/trust/:actor
config/gate.v1.json the deployed gate config (same hash the addon pins)
```

The heavy lifting is in the `governance-native` napi-rs addon, consumed as the
published `@statecrafting/governance-native` (statecrafting spec 005; it lived
here under `addon/governance-native/` until that transfer). It wraps four
crates.io crates:
`canonical-keysort-json`, `attest-ledger`, `action-gate`, and `trust-window`.
The chain file under the state dir is the authority; CoreLedger keeps a query
index only.

## The integration contract (spec 008 §3)

A caller wraps a privileged transition as: evaluate the gate; on `allow`, act,
then append an attestation carrying the gate's `configHash` and the action's
`payloadHash`. Factory stamps additionally record the born-with `certHash`
(enrahitu spec 012), making the repo-local cert and the platform ledger
mutually checkable. A missing governance service is treated by the caller as
deny for remove-class actions and warn-and-proceed for read-class; a gate is
never silently skipped.

## Status: awaiting the app shell (spec 002)

The addon is complete and its Rust tests pass (`cargo test
--no-default-features` in the statecrafting repo, including the
gate -> append -> verify flow). This service's TypeScript is authored against the
Encore + CoreLedger idiom but cannot typecheck, run, or be vitest-tested until
the chassis (spec 002) lands: it imports `encore.dev/*`, `../core/ledger`
(CoreLedger, spec 003), and `@statecrafting/governance-native`. When 002 lands, the service wiring rebases onto the shell
(AGENTS.md backlog exception, 2026-07-14): add `@statecrafting/governance-native`
as a dependency and the service typechecks and its vitest suite runs. The remaining acceptance items are tracked in spec 008 §6.
