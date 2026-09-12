---
id: "009-native-extraction"
title: "The native extraction: a Rust consumer path that does not link Node"
status: draft
created: "2026-09-11"
implementation: pending
depends_on:
  - "001-packages-thesis"
  - "004-kernel-native"
  - "005-governance-native"
  - "006-fleet-native"
establishes:
  - { kind: directory, path: "specs/009-native-extraction/" }
extends:
  - spec: "005-governance-native"
    unit: { kind: directory, path: "addon/governance-native/" }
    nature: additive
  - spec: "006-fleet-native"
    unit: { kind: directory, path: "addon/fleet-native/" }
    nature: additive
summary: >
  This repository's answer to the 2026-09-11 family realignment packet.
  The packet asks whether the Rust in these packages can be reused by a
  consumer that is not Node. Measured at 844ac86, the answer is no, for
  all four addons, and the reason is not the feature flags the packet
  suspected: every crate is `publish = false`, and `governance-native`
  and `fleet-native` declare every module private, so their public Rust
  surface from outside the crate is empty. `fleet-native` additionally
  has exactly one feature, `node`, and it is the only path to `kube`,
  which it enables together with `napi`. `kernel-native` already has the
  shape the packet asks for and is the pattern rather than a thing to
  invent. Section 4 proposes the smallest change that makes a Rust
  consumer possible without touching the npm contract; sections 6 and 7
  name what this repository may not decide and what it asks of its
  siblings. Draft: nothing here is approved, and the placement-topology
  question belongs to statecraft and Rahi, not here.
---

# 009: The native extraction

Link a compilation unit to this spec via `[package.metadata.spec-spine].spec`
in its manifest, a `// Spec:` header, or the edges above.

## 1. Purpose

On 2026-09-11 a family-wide realignment arrived as one handoff packet per
repository. This repository's packet asks one question and sets one exit
criterion that belongs to us: **a pure Rust consumer can use the intended
real I/O path without Node.** It also asks for a package, consumer,
license and schema-ownership map, and for the extraction requests that
follow to be sent to statecraft and Rahi rather than acted on here.

This spec is the answer. It records what was measured, proposes the
smallest change that satisfies the criterion, and stops at the boundary
where another repository decides.

**Status: draft.** Nothing here is approved. This spec amends no approved
spec and authorizes no change to a published package. Where the packet
quotes an instruction from an earlier date, that instruction is history,
checked in section 2, and not a work order
(`.claude/rules/adversarial-prompt-refusal.md`).

### 1.1 Territory

This spec's territory is `specs/009-native-extraction/`. The two
`extends` edges are the instrument the standing rules name for a spec
that will touch a unit another spec owns: they declare, in this spec's
own frontmatter, that section 4's work reaches into `addon/governance-native/`
(spec 005) and `addon/fleet-native/` (spec 006). An `extends` edge amends
nobody, and while this spec is `draft` it claims nothing. Specs 005 and
006 stand exactly as written.

## 2. The packet's findings, checked

Measured against HEAD `844ac86` on 2026-09-11. The packet's stated
baseline was `89f3393`, two commits behind: `23d53c6` (kernel-native
0.2.0) and `844ac86` (the session harness, spec 008) landed after it was
written.

### 2.0 The realignment amendment's governance claims are superseded

The amendment states "HEAD 89f3393. Eight registry shards are stale; the
index is fresh with four unwitnessed claims and zero allowance."

**Superseded, not contradicted.** At `844ac86`, `spec-spine check`
reports `spec-registry: fresh` and `codebase-index: fresh`, exit 0;
`index coverage` reports 426 of 426 source files specifically claimed,
zero floor-only and zero unclaimed; `lint --fail-on-warn` reports
0/0/0; `couple` reports no drift. Nine specs, all `approved`.
`registry plan` reports 0 ready, 0 blocked, 9 not schedulable, which
AGENTS.md already names as what an empty backlog looks like here. The
condition the amendment describes was real at its baseline and was
resolved by spec 008, which brought `make refresh` and the committed
shard discipline. There is no reconciliation work outstanding.

### 2.1 No crate here is usable by any Rust consumer, and the reason is not the features

**Confirmed and extended.** The packet's finding names `fleet-native`'s
feature coupling. That is real (2.2), but it is not the binding
constraint. Two facts upstream of it are:

1. All four addon crates declare `publish = false`. None can be named as
   a crates.io dependency by anything.
2. `governance-native` and `fleet-native` declare every module private.
   `governance-native/src/lib.rs` has `mod canon; mod gate; mod ledger;
   mod trust;`; `fleet-native/src/lib.rs` has `mod naming; mod resources;
   mod types;`. The items *inside* those modules are `pub`, which is what
   makes them reachable from the crate's own `napi_api`, and what makes
   the private module declaration easy to miss in review.

Probed with a throwaway consumer crate taking a path dependency, which is
already more access than crates.io would give:

```
error[E0603]: module `resources` is private
  --> src/main.rs:3:28
note: the module `resources` is defined here
  --> addon/fleet-native/src/lib.rs:28:1
   |
28 | mod resources;

error[E0603]: module `canon` is private
note: the module `canon` is defined here
  --> addon/governance-native/src/lib.rs:22:1
```

The public Rust API of both crates, from outside, is empty. Removing the
napi coupling alone would change nothing.

### 2.2 `fleet-native`'s `node` feature is the only path to Kubernetes I/O

**Confirmed.** The crate declares exactly two features:

```
fleet-native {"default":["node"],"node":["dep:napi","dep:napi-derive","dep:kube","dep:tokio"]}
```

There is no `kube` feature to ask for:

```
error: package `fleet-native v0.2.0` does not have feature `kube`
Dependency `kube` would be enabled by these features:
	- `node`
```

So `--no-default-features` compiles the pure builders with no cluster and
no Node, which is what spec 006 section 2 promised and delivered, and the
only alternative is `node`, which links `kube`, `tokio`, `napi` and
`napi-derive` together. A Rust consumer that wants the real apiserver
path has no configuration that gives it one without Node-API.

### 2.3 The pure-builder suites pass, and prove less than a reader expects

**Confirmed.** `cargo test --no-default-features` is green in both
crates: 13 tests in `fleet-native` (12 in the transfer, plus the
two-apps-two-ports regression the 0.2.0 amendment added), 22 in
`governance-native`. Neither suite executes a single line of
`kube_ops.rs`: the module is `#[cfg(feature = "node")]` and the suite
compiles it out. The packet's caution is exactly right and worth keeping
as a standing sentence: **a green pure-builder run is evidence about
resource shapes and evidence about nothing else.** No automated test in
this repository has ever contacted an apiserver; the only live-cluster
evidence for this code is statecraft spec 006's 2026-07-16 E2E on
`deployd.xyz`, and the 0.2.0 amendment already records that its own
resource change is owed a new one.

### 2.4 `kernel-native` is the contrast, and it is the pattern

**New; the packet did not have this.** `kernel-native` does not share the
defect. It declares `default = []` with the napi surface behind an opt-in
`napi` feature, every core module `pub`, and a `pub use` block over the
composition. A pure Rust consumer links it and runs it:

```
$ cargo run          # path dep, default-features = false, no Node anywhere
model hash: Ok("sha256:e346432021b04179518d9614f3560ccd71354a4ee101ddcb893d6959a9d6301c")
```

Its manifest states the reason the feature is off by default: a napi
crate cannot link a test executable, because the Node-API symbols are
supplied by the Node process at load time rather than at link time.
`fleet-native` and `governance-native` solved that same problem the other
way round, by gating *out* rather than gating *in*, and inherited a
default that links Node for everyone. Section 4 proposes converging on
`kernel-native`'s answer, which is already built, already published, and
already exercised by Rahi through spec 021.

`kernel-native` is still `publish = false`, so the Rust consumer above
needs a path dependency. 4.3 addresses that separately.

### 2.5 The ledger normalizes the caller's bytes; it does not preserve them

**New; this contradicts an exit criterion.** The packet asks for
interfaces that "preserve exact evidence bytes" and sets "metadata
survives round-trip unchanged" as an exit criterion. `governance-native`
does not do this today, and the deviation is silent.

`ledger::append` takes the record as a string, parses it to a
`serde_json::Value`, and stores and hashes the parsed value. `serde_json`
is compiled without `preserve_order` here, verified by the absence of
`indexmap` from `Cargo.lock`, so its object map is a `BTreeMap`.
Replaying that exact path:

| submitted | stored | identical |
|---|---|---|
| `{"zeta":1,"alpha":2}` | `{"alpha":2,"zeta":1}` | no |
| `{ "a" : 1 }` | `{"a":1}` | no |
| `{"a":1,"a":2}` | `{"a":2}` | no |
| `{"n":1.0,"e":1e3,"big":12345678901234567890123}` | `{"big":1.2345678901234568e22,"e":1000.0,"n":1.0}` | no |
| `{"id":"x","kind":"stamp"}` | `{"id":"x","kind":"stamp"}` | yes |

The last row is why this has never been noticed: statecraft's
`backend/governance/records.ts` builds a flat envelope of strings, so
every record in the live chain is of that shape and round-trips
unchanged. The envelope also carries `payload: req.payload`, an arbitrary
caller-supplied object, which is the door the other four rows come
through.

Row four is the one that matters. A large integer is silently replaced by
a different number, and that different number is what gets hashed and
chained.

A second, narrower fact sits under this. `canon::canonicalize` wraps
`canonical-keysort-json`, whose own README says plainly that it "sorts
keys, it does not do full canonical JSON" and is byte-incompatible with
specifications that normalize floats and escape non-ASCII. It is
therefore **not** RFC 8785 / JCS. The doc comment on `canon.rs` says a
payload hash is "independently reproducible by any third party from the
same JSON", and that holds only for a third party who reproduces
`serde_json`'s exact number formatting and string escaping. A JavaScript
verifier canonicalizing the same document writes `1.2345678901234568e+22`
where this writes `1.2345678901234568e22`, and gets a different SHA-256.

Both facts are load-bearing for B32 (original bytes) and B34 (a
permissive independent verifier). Neither is fixed here: changing either
changes hashes in a live chain, and the live chain is statecraft's. They
are reported, with a proposal in 4.5 and a request in section 7.

### 2.6 The gate is a policy compiler; it is not an authorization

**Confirmed, and this is the packet's most important sentence for us.**
The packet writes that "passing a local gate or a trust score does not
supersede prior-policy approval, current revocation or exact-artifact
binding." Measured against the code, that is not a risk to guard against;
it is a description of what `governance-native` is.

`gate::evaluate` takes a config and an `ActionContext`, which is an
action string plus a free-text `attributes` map. The four v1 checks read
`posture`, `subject_name` / `confirm_name`, `tenant_status` /
`tenant_active`, and `actor` / `authenticated`. There is no field for an
artifact digest, an authority or policy reference, an issuer, an expiry,
an idempotency key, or a revocation state, and no call that could consult
one: the crate has no clock, no network and no store.

That is exactly the B35 disposition ("policy compiler, not runtime": pure
evaluation of explicit inputs may be shared; live keys, clocks, locks,
approvals, I/O and revocation state belong to the CLI or the platform).
It is also exactly why the crate cannot, as it stands, carry B13
(proof-carrying deployments), B14 (proof-carrying external actions) or
B30 (a trust window revalidated at effect time). Those need fields and a
revalidation moment the type does not have.

`trust::level` is the same shape one layer over: a rolling score and a
four-level ladder, with a degrade-only latch. statecraft spec 008 already
calls trust advisory. Nothing here should change that, and the packet's
sentence should be preserved verbatim in whatever spec lands B30.

### 2.7 The fleet's placement shape and Rahi's topology have already diverged, and Rahi has written the verdict

**Confirmed, and further along than the packet knew.** The packet
observes that the single-replica Deployment with scale-down plus restic
is unlike Rahi's StatefulSet contract. Rahi has recorded its own
conclusion in its spec 030 section 3.4, approved on 2026-07-25:

> statecrafting spec 006 (fleet-native) currently encodes a Deployment
> plus PVC placement shape. The object graph above is different
> (StatefulSet with `volumeClaimTemplates`, headless Service,
> PodDisruptionBudget, anti-affinity, separate learner Deployment), so
> that spec is reworked rather than parameterized.

Two qualifications matter and neither is in the packet. Rahi 030 is
`approved` but `implementation: pending`, so the StatefulSet topology is
a design and not a running thing; and Rahi 030 states that N=1 is the
primary mode and N=3 is the scale path, so the divergence is about the
object graph rather than about replica count as such.

The consequence for this repository is a boundary, not a task. "Reworked
rather than parameterized" is a decision about placement, and placement
is statecraft's product behavior on Rahi's chassis contract. Section 6
records it as out of scope here.

### 2.8 The neutral verifier's blocker is a format, not a crate

**New.** The exit criterion asks that "no AGPL or legacy toolchain
dependency leaks into neutral verification by accident." Checked:

| unit | license |
|---|---|
| `action-gate`, `attest-ledger`, `trust-window`, `canonical-keysort-json` | Apache-2.0 |
| `statecraft-journal` (statecraft-cli's verifier seed) | Apache-2.0 |
| `governance-native`, `fleet-native` | AGPL-3.0 |

No leak exists today, because no neutral verifier exists today. The
latent problem is narrower and more specific than a dependency edge. The
chain mathematics a verifier needs (`verify_chain`, `compute_record_hash`,
the canonical bytes) is already Apache-2.0 and already on crates.io. What
is **not** permissive is the on-disk format: `<stateDir>/records.jsonl`
as the authority, `<stateDir>/anchor.json`, the genesis seed string
`statecraft.governance.ledger/v1`, the chain id `governance`, and the
unsigned-anchor fallback in `verify`. Those sixty lines live in
`governance-native/src/ledger.rs`, which is AGPL-3.0.

A third party writing a permissive verifier for statecraft's chain must
therefore either read AGPL source to learn the format, or be handed the
format by us. 4.5 proposes the second.

### 2.9 The README's consumer list is ahead of the tree, for one consumer

**Corrected.** The packet reports, accurately, that "its README names
Statecraft, Enrahitu and Chancery consumers." Inspected:

| consumer | pins | verified |
|---|---|---|
| statecraft | `fleet-native` 0.2.0, `governance-native` 0.1.0, `hiqlite-native` 0.1.0, `toolchain` 0.3.0 | yes |
| enrahitu (Rahi) | `hiqlite-native` ^0.2.0, `kernel-native` ^0.2.0, `toolchain` ^0.4.0 | yes |
| chancery | none | no |

chancery has no root manifest and no `@statecrafting/*` dependency. Its
`kernel-addon/` is still in its tree, which is what spec 004 section 4
says should be true: the donor "is not modified by this spec", and
chancery keeps its own addon "until chancery re-bases onto the
generalized kernel". chancery is a planned consumer, not a current one,
and the README's present tense is the only thing out of step.

Reported rather than edited. `README.md` is spec 001's unit and is folded
into `[index] extra_hashed_inputs`, so changing one word restales all
nine shards, and the sentence it belongs to is spec 001's account of why
this repository exists. A one-word precision fix is a human's call.

Two version facts fall out of the same table and are not defects:
statecraft pins `toolchain` 0.3.0 and `hiqlite-native` 0.1.0 while 0.4.0
and 0.2.0 are published, and `governance-native` has only ever published
0.1.0.

## 3. The package, consumer and license map

Eight published packages, four cargo crates, three licenses. `Rust
consumable` is the column the packet's exit criterion is about.

| package | version | license | verified consumers | Rust consumable | classification |
|---|---|---|---|---|---|
| `@statecrafting/toolchain` | 0.4.0 | Apache-2.0 | statecraft (0.3.0), enrahitu (^0.4.0) | n/a, not a crate | required by legacy consumers |
| `@statecrafting/toolchain-{darwin-arm64,linux-x64,linux-arm64}` | 0.4.0 | MPL-2.0 | the meta package | n/a, carry vendored binaries | required by legacy consumers |
| `@statecrafting/hiqlite-native` | 0.2.0 | Apache-2.0 | statecraft (0.1.0), enrahitu (^0.2.0) | no: `publish = false` | required by legacy consumers |
| `@statecrafting/kernel-native` | 0.2.0 | Apache-2.0 | enrahitu (^0.2.0); chancery planned | partly: public API, but `publish = false` | reusable in the new service |
| `@statecrafting/governance-native` | 0.1.0 | AGPL-3.0 | statecraft (0.1.0) | no: private modules and `publish = false` | unresolved, pending statecraft |
| `@statecrafting/fleet-native` | 0.2.0 | AGPL-3.0 | statecraft (0.2.0) | no: private modules and `publish = false` | unresolved, pending statecraft |

Per the packet's own instruction, no package is classified "superseded".
statecraft's answer to its packet states plainly that it files **no
request** to this repository and that its draft 017 decides the two AGPL
addons' future as part of the fleet disposition. Until that draft is
approved, "superseded" would be this repository asserting a conclusion
about another repository's work, which the packet forbids.

### 3.1 Schema ownership

The exit criterion asks that the package graph identify who owns every
referenced schema. It does not today; this table is the proposal for what
it should say.

| schema | declared in | owner | consumed by |
|---|---|---|---|
| `app-model.json` | Rahi spec 020 | Rahi | `kernel-native::model` |
| gate config v1 (four ordered check ids) | `addon/governance-native/config/gate.v1.json` | statecrafting spec 005, with statecraft spec 008 holding the deployed copy and both pinning one hash | `governance-native::gate` |
| `LedgerRecord`, `ChainAnchor` | `attest-ledger-types` (Apache-2.0) | attest-ledger | `governance-native::ledger`, `kernel-native::payload` |
| the ledger's on-disk layout and genesis seed | `addon/governance-native/src/ledger.rs` | statecrafting spec 005 | statecraft `backend/governance/`; **no permissive declaration exists** (2.8) |
| `ActionContext`, `Decision`, `Outcome` | `action-gate-types` (Apache-2.0) | action-gate | `governance-native::gate`, `kernel-native::gate` |
| `WindowConfig`, `WindowSnapshot`, `Sample` | `trust-window` (Apache-2.0) | trust-window | `governance-native::trust`, `kernel-native::ladder` |
| the trust envelope (`{config, window}`) | `addon/governance-native/src/trust.rs` | statecrafting spec 005 | statecraft `backend/governance/` |
| `DeploySpec`, `AppStatus`, `BackupTarget`, `BackupResult`, `RemoveResult` | `addon/fleet-native/src/types.rs` | **ambiguous**, see below | statecraft `backend/fleet/` |
| the EnRaHiTu placement object graph | `addon/fleet-native/src/resources.rs` | statecraft spec 006 section 3 decided it; statecrafting spec 006 implements it; Rahi spec 030 supersedes the topology it assumes | statecraft `backend/fleet/` |
| the hiqlite KV and counter surface | Rahi spec 032 | Rahi | `hiqlite-native` |

The one genuine ambiguity is the fleet DTOs. statecrafting spec 006
section 3.2 says the napi surface is "unchanged from what statecraft spec
006 section 2 specified and landed", which makes the contract statecraft's
and the declaration ours. Nothing breaks while one consumer exists; it
becomes a real question the moment the wire is versioned. Request F-1 in
section 7 asks statecraft to settle it.

## 4. The proposed extraction

Proposal, not an approved design. Each part is separable, and 4.1 through
4.3 depend on no decision outside this repository.

### 4.1 Converge on the shape `kernel-native` already has

For `governance-native` and `fleet-native`:

- Declare the core modules `pub` and add a `pub use` re-export block over
  the types and functions a consumer needs. For `governance-native`:
  `canon`, `gate`, `ledger`, `trust`. For `fleet-native`: `naming`,
  `resources`, `types`.
- Invert the napi feature from opt-out to opt-in, so `default = []` and
  the `#[napi]` layer is behind `napi = ["dep:napi", "dep:napi-derive"]`,
  exactly as `kernel-native` declares it. The `napi build` script passes
  `--features napi`, which `kernel-native`'s build script already does
  and spec 004 records.

This changes no behavior, no JSON wire shape and no exported JavaScript
symbol. It changes which Rust items are nameable from outside the crate
and which cargo invocation produces the addon.

### 4.2 Split `fleet-native`'s features into three

The criterion "a pure Rust consumer can use the intended real I/O path
without Node" is satisfied by one feature the crate does not have:

```toml
[features]
default = []
kube    = ["dep:kube", "dep:tokio"]          # real apiserver I/O, no Node
napi    = ["kube", "dep:napi", "dep:napi-derive"]
```

`napi` implies `kube` because `napi_api` delegates to `kube_ops`; there
is no coherent addon without the I/O layer. The `#[cfg(feature = "node")]`
guards become `#[cfg(feature = "kube")]` on `kube_ops` and
`#[cfg(feature = "napi")]` on `napi_api`. `--no-default-features` keeps
doing what it does now, and the 13 golden tests keep passing unchanged,
which is the regression guard for the whole change.

A Rust consumer then writes `features = ["kube"]` and links `k8s-openapi`,
`kube`, `tokio` and serde, with no `napi`, no `napi-build` and no
Node-API symbols.

### 4.3 Decide `publish = false` deliberately, per crate

All four crates carry `publish = false`. For three of them that was
correct and incidental: the deliverable was an npm package and nobody
asked for a crate. The exit criterion asks for a crate.

`publish = false` is not a licensing decision and must not be argued as
one. The AGPL question for `governance-native` and `fleet-native` is
spec 001 section 3's question about customer reach, and publishing an
AGPL-3.0 crate to crates.io changes no reach: it is the same code under
the same licence at a different address, and crates.io hosts AGPL-3.0
crates. The dependency-direction invariant (spec 001 section 3.2) is
unaffected and `scripts/check-licenses.mjs` keeps enforcing it in both
manifest systems.

What publishing does change is a promise: a published crate version is
immutable and its API is something other people can depend on. That is
the decision, and it is different per crate:

- `kernel-native` (Apache-2.0, public API today, consumed by Rahi through
  spec 021): the strongest candidate, and the only one where a Rust
  consumer is already conceivable.
- `governance-native` and `fleet-native` (AGPL-3.0): publishing is
  premature while statecraft draft 017 is open (section 6).
- `hiqlite-native`: no request for it exists. Leave it.

The minimum that satisfies the exit criterion without publishing anything
is 4.1 plus 4.2 plus a documented path-dependency recipe. That is the
increment section 8 proposes.

### 4.4 The npm contract does not move

The packet asks that the old npm contract be preserved while it is
needed, and that a breaking change never be republished under an existing
version. Nothing in 4.1 through 4.3 touches the JavaScript surface: the
same `#[napi]` functions, the same camelCase names, the same JSON in and
out, the same `napi.targets` triples, the same three platform packages,
the same `optionalDependencies` injection at publish time.

The version rule follows from that. 4.1 through 4.3 are additive to the
Rust surface and invisible to npm, so they are a minor bump on each
package they touch, and the two consumers' existing pins keep resolving.
`publish.yml` is idempotent by version and stays untouched. Should any
later spec change the JSON wire shape, that is a major bump argued in its
own spec, never a republish of a version already on npm.

### 4.5 The evidence-byte question is stated, not solved

2.5 and 2.8 describe two properties this repository could change and
should not change unilaterally, because the artifacts they govern are
live in statecraft's production volume. Stated as the proposal:

1. **Byte preservation.** An interface that claims to preserve evidence
   must store the submitted bytes, not a reparse of them. The shape that
   does this without disturbing the existing chain is an additive one: a
   second field carrying the original bytes verbatim, hashed as bytes,
   beside the parsed payload that the current chain hashes. Records
   written before it are unaffected; records written after it carry both.
   Whether that field is worth its size is statecraft's call, since
   statecraft owns the chain and pays for the volume.
2. **A permissive format declaration.** The ledger's on-disk layout,
   genesis seed, chain id and unsigned-anchor rule, published as a
   versioned format specification with conformance fixtures under a
   permissive licence, so a neutral verifier can be written without
   reading AGPL source. This is a document and a fixture set, not a code
   move, and it relicenses nothing: the AGPL implementation stays exactly
   where it is.

Neither is scheduled by this spec.

## 5. What this spec does not claim

- That anything here is approved. It is `draft`.
- That any consumer is finished with any package. The packet says to
  treat an uninspected consumer as unknown; section 3 reports what was
  inspected and marks chancery as planned rather than absent.
- That `--no-default-features` green means the Kubernetes path works
  (2.3).
- That a gate decision or a trust level authorizes anything (2.6).

## 6. Out of scope

- **The fleet's future placement topology.** Rahi spec 030 section 3.4
  says spec 006 is "reworked rather than parameterized"; statecraft's
  2026-09-11 record recommends managed hosting stay out of the initial
  offer and defers the two AGPL addons' future to its draft 017. Both are
  other repositories' decisions. This repository will not encode a
  StatefulSet, a PodDisruptionBudget or a learner Deployment into
  `fleet-native` on its own authority, and will not retire the Deployment
  shape while statecraft pins 0.2.0.
- **Permit, authority and evidence semantics for fleet actions.** The
  packet asks for "the minimal request/outcome metadata required by the
  product broker, including an idempotency reference and target
  identity", and immediately adds: avoid a new generic proof framework
  inside the addon. Both are right, and they resolve to the same
  boundary. The addon may carry fields a broker defines; it may not
  define them. Request F-2.
- **Changing any hash, wire constant or on-disk format.** The gate config
  hash, the ledger genesis seed, the chain id, the
  `fleet.statecraft.ing/app` label and the `statecraft-system`
  blocklist entry are pinned by tests on both sides of a live boundary.
- **Relicensing.** Spec 001 section 3.1 governs: an argument from the
  root licence or from vendored Encore's MPL-2.0 is invalid on its face.
- **`vendor/encore/` and the toolchain.** The packet's phrase "legacy
  toolchain" describes a consumer's future, not a defect here. Rahi pins
  `toolchain` ^0.4.0 today.
- **Retiring anything.** The packet is explicit that it does not
  authorize retiring dependencies used by other applications, and no
  dependency evidence gathered here supports a retirement.

## 7. Requests to sibling repositories

Proposals for each repository's own governance. None changes another
repository's contract, and none is assumed satisfied.

**statecraft.**

- F-1. Settle ownership of the five fleet DTOs (`DeploySpec`,
  `AppStatus`, `BackupTarget`, `BackupResult`, `RemoveResult`). They are
  declared in `fleet-native/src/types.rs` under spec 006 here, and their
  contract is statecraft spec 006 section 2 there. Section 3.1 cannot
  close without an answer, and the answer decides who may version the
  wire.
- F-2. If draft 016 issues permits for fleet effects, state the minimal
  request and outcome metadata the broker requires: the exact operation
  and target identity, the authority reference, expiry, and an
  idempotency reference. This repository will carry those fields on
  `DeploySpec` and the result types; it will not define their semantics
  and will not build a proof framework inside the addon.
- F-3. Confirm or correct 2.5. The byte normalization is invisible in
  every record the live chain holds today, and becomes visible the first
  time a `payload` carries a large integer or an externally produced
  document. If draft 016 intends to put third-party evidence into that
  payload, 4.5 item 1 needs scheduling before it, not after.
- F-4. Say whether the permissive format declaration in 4.5 item 2 is
  wanted, and where it should live. Open decision O-5 in statecraft's
  record ("where does the neutral verifier live?") is adjacent but not
  the same question: the format is a document and can be published from
  anywhere; the verifier is a crate and cannot be AGPL.
- F-5. Noted, not requested: statecraft's record files no request to this
  repository and defers the addons to draft 017. This spec is written to
  be reviewable without 017 and to schedule nothing that 017 could
  contradict. It also cites 014, 015 and 016 as uncommitted working-tree
  files, which by statecraft's own standard (its S-3 to spec-spine) is
  not a citable state; sections 2.7, 3 and 6 are written so that they
  stand on Rahi 030 and on this repository's own measurements even if
  those drafts change.

**Rahi.**

- R-1. Confirm that spec 030 section 3.4's "reworked rather than
  parameterized" is a statement about the object graph and not about
  `fleet-native`'s continued existence, and say whether a reworked
  placement engine is expected to be a native addon at all. This
  repository will not begin either the rework or a retirement without it.
- R-2. State whether spec 030's N=3 scale path is on the path to
  `implementation: complete`, or remains a design that the primary N=1
  mode does not need. 2.7 reports it as approved and pending; the
  urgency of R-1 follows from the answer.
- R-3. If `kernel-native` is to be a crates.io crate (4.3), Rahi is the
  consumer that would benefit first, through spec 021. Say whether a Rust
  consumer of the kernel is foreseen, or whether the napi surface remains
  the only one Rahi needs.

**spec-spine.**

- S-1. Accepted from its design note 04, as constraints on anything this
  repository later builds: nothing is executed in a governed plane,
  `{repo, commit, tree}` is stored beside every digest, and an
  unavailable tree reports `unknown` rather than `pass`.
- S-2. Noted: 2.6 is this repository's confirmation of B35 from the
  implementation side. `governance-native`'s gate is a pure evaluator
  with no clock, no network and no store, and cannot be made an
  authorization by adding checks to it.

**statecraft-cli.**

- C-1. Requested: the receipt and bundle fixtures of its draft 132,
  including the negative set, if a permissive verifier is ever to read
  this ledger's records. 2.5 and 2.8 are the two facts that would make a
  naive reader's verifier disagree with ours, and both are cheaper to fix
  in fixtures than in a live chain.
- C-2. Noted: `statecraft-journal` is Apache-2.0 and the four family
  primitives are Apache-2.0, so a neutral verifier has a clean base
  today. What it lacks is the format (2.8), not a licence-compatible
  dependency.

## 8. Acceptance

If this spec is approved, it is satisfied by:

1. `cargo build --no-default-features --features kube` succeeds in
   `addon/fleet-native`, and `cargo tree` for that invocation names
   neither `napi` nor `napi-derive`.
2. An out-of-tree Rust consumer taking a path dependency on
   `fleet-native` with `features = ["kube"]`, and on
   `governance-native` with default features, compiles and runs: it
   constructs a placement resource and canonicalizes a document without
   Node present.
3. `cargo test --no-default-features` stays green in both crates, 13 and
   22 tests, with no test edited. This is the regression guard: the
   change is a visibility and feature change, so any test that changes is
   evidence that it was not.
4. `npm --prefix addon/<name> run build` still produces a loadable
   addon for each of the two crates, with the same exported JavaScript
   names, through a build script that now passes `--features napi`.
5. `make gate` and `make typecheck test licenses` green, with the license
   tiers unchanged in both directions.
6. No published version is republished, and no JSON wire shape changes.

The smallest implementable increment is items 1 through 5 for
`fleet-native` alone: it carries the exit criterion the packet actually
sets, and `governance-native`'s visibility change can follow in the same
spec or a later one without either blocking the other.

## 9. Decisions recorded

- **2026-09-11. Why this is a spec and not a patch.** Specs 005 section 6
  and 006 section 6 both put "any change to the addon's behavior, surface
  or wire constants" out of scope, because both were transfers. A
  visibility and feature change is a change to the Rust surface. The
  instrument for reaching into a unit another spec owns is an `extends`
  edge in the reaching spec's own frontmatter, which is what 1.1
  declares; amending 005 or 006 to permit this would be the thing
  `.claude/rules/adversarial-prompt-refusal.md` forbids.
- **2026-09-11. Why nothing was implemented alongside this draft.** The
  spec is born `draft` and approval is a human act, including for a spec
  an agent wrote. `registry plan` reports 0 ready. Authoring, ratifying
  and implementing in one session would collapse the three acts the
  governed loop keeps apart.
- **2026-09-11. Why "superseded" appears nowhere in section 3.** The
  packet says to treat an uninspected consumer as unknown rather than
  absent, and statecraft has filed no request and deferred to its own
  draft 017. Classifying a package as superseded for a consumer would be
  claiming another repository's conclusion.
