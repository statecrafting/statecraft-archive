---
id: "132-evidence-fixtures"
title: "Evidence fixtures: the receipt and the bundle as frozen bytes, with a verdict manifest every verifier is held to"
status: draft
created: "2026-09-11"
implementation: pending
risk: low
depends_on:
  - "031-journal-export"
  - "039-attested-export"
  - "113-journal-port"
  - "121-candidate-and-receipt"
  - "122-action-broker"
  - "125-credential-fence"
establishes:
  - { kind: directory, path: "docs/evidence/fixtures/" }
  - "members/scripts/mint-evidence-fixtures.ts"
  - "members/src/orchestrator/evidence-fixtures.test.ts"
  - "members/src/orchestrator/verification-report.ts"
  - "members/src/orchestrator/verification-report.test.ts"
extends:
  # 121 owns the receipt; it gains the two pure checks a verifier needs
  # (internal consistency and subject binding).
  - { spec: "121-candidate-and-receipt", unit: "members/src/orchestrator/receipt.ts", nature: additive }
  - { spec: "121-candidate-and-receipt", unit: "members/src/orchestrator/receipt.test.ts", nature: additive }
  # 023 owns the engine CLI's `journal verify --bundle`: the input cap.
  - { spec: "023-orchestrator-cli", unit: "members/src/commands/orchestrator.ts", nature: additive }
  # 113 owns the Rust journal crate: the same manifest, run from Rust, and the
  # same input cap on its verifier.
  - { spec: "113-journal-port", unit: { kind: directory, path: "crates/statecraft-journal/" }, nature: additive }
  # Doc 05 is the record this spec is born from (D66, D67).
  - { spec: "110-corpus-merge", unit: { kind: directory, path: "docs/design/" }, nature: additive }
references:
  - { unit: { kind: file, path: "docs/design/05-the-realignment-checked.md" }, role: context }
  - { unit: { kind: file, path: "docs/evidence/journal-bundle.json" }, role: context }
summary: >
  Other repositories are about to read this repository's evidence: Statecraft
  to admit it, hqgit to reference it, a neutral verifier to check it. The only
  committed bundle is export policy version 1, predates the attestation block,
  and holds no acceptance receipt and no broker action, so there are no
  original bytes of the records they would read. This spec mints them once,
  through the real code paths, and freezes them: a journal and its export at
  policy version 5 carrying a receipt, the broker's intents, outcomes and
  refusals, and a fence refusal, with and without an attestation, beside the
  existing policy-1 bundle. It derives a negative set by stated mutations,
  adds statecrafting 010's byte vectors, and writes a manifest giving each
  fixture's expected verification report: the four evidence dimensions the
  owner adopted with Statecraft (integrity, signature, issuer trust, subject
  binding), each with a closed set of values and a reason, and an admission
  result kept apart from them. Statecraft owns those semantics; this
  repository freezes their version and serialization. Both existing verifiers
  emit that report and run the manifest. The first acceptance is the
  admission pair: the same intact, unsigned evidence admitted under a local
  policy that allows unsigned evidence and refused under one that requires a
  trusted signature, neither implying the evidence is trusted. JSON Schemas
  describe version 1 exactly as the code parses it, and evidence is referenced
  by typed digests of its bytes. A verifier never executes what a bundle
  carries, never takes the bundle's own anchor as its trust root, and today
  reports every signature as unsigned and every issuer as unknown, because
  nothing is signed.
---

# 132: Evidence fixtures

## 1. Purpose

This repository owns the receipt format (121) and the export bundle (031,
039), and it is the first to produce either. The realignment asks it to hand
both to Statecraft and hqgit "before separate implementations diverge", and
the handoff is only as good as the bytes it is made of.

Three facts make that handoff impossible today:

- **No original receipt exists outside a test's temporary directory.**
  `docs/evidence/journal-bundle.json` is the one committed bundle. It is policy
  version 1, has no attestation block, and holds 1,090 records of which none
  is an `acceptance.receipt` or a `broker.action`, because it predates 121 and
  122.
- **What verification establishes is integrity, and a reader could take it
  for more.** `verifyBundle` (and the Rust `verify_bundle`) checks each chain
  from the `anchorHash` the bundle declares for itself, and `journal verify
  --bundle` reports `verified: true`. A chain fabricated whole, with a fresh
  anchor, verifies. That is correct for what the code claims; it is also
  exactly the "self-selected root" a verifier must never accept as trust.
- **A forged receipt parses.** `parseReceipt` accepts `passing: true` beside
  a non-zero exit code and never recomputes the suite or policy digest. A
  minted receipt cannot have either defect; a hand-written one can.

Two more facts were measured on 2026-09-12 at `874766b` (doc 05 §18.1,
§18.2 F12). A hand-written receipt with `passing: true` beside exit code 1 and
a zero suite digest, in a freshly anchored bundle, verifies under both
verifiers with exit 0, and a one-byte payload edit fails under both with exit
1: the verifiers agree on integrity. Their `--json` shapes do not agree: the
TypeScript verb answers `data.verified: true` with an array of chains, and the
Rust verb answers `data.chains.ok` as the string `"true"`, nested one level
deeper, with no `verified` member. And the three repositories that will read
this evidence name different verdicts (doc 05 §18.4): Statecraft's draft 015
puts policy among four outcomes, hqgit's design note keeps policy apart and
adds signature validity, and spec-spine's note lists six. Nobody defines the
answer for an absent signature.

On 2026-09-12 the owner settled the vocabulary (doc 05 §19, revision 4's
CLI-04 and G-04 to G-07). Statecraft owns the contract's semantics and this
repository's Apache-2.0 workspace holds the schemas, the fixtures and the pure
verifier (G-04). The dimensions are G-05's, with admission apart; trust comes
only from roots supplied independently of the evidence (G-06); a reference is
G-07's typed digest of bytes. The field names are therefore fixed, and no
review round waits for another repository to arrive at them.

This spec fixes the bytes, the expected verdicts, the report that states them,
the admission evaluator that exercises it and the two receipt checks, and
nothing more. Where the neutral verifier is finally packaged is an open
decision (doc 05 §16), and the manifest is what any verifier, wherever it
lives, is held to.

## 2. Territory

- `docs/evidence/fixtures/`: the frozen fixtures, the negative set, the
  schemas, the manifest, the fixture admission policies (B-9) and, under
  `vectors/`, statecrafting 010's byte vectors copied with their provenance
  (B-10).
- `members/scripts/mint-evidence-fixtures.ts`: mints a new version's positive
  fixtures through the real code paths, and derives the negative set by the
  mutations B-3 lists. It never rewrites a committed fixture.
- `members/src/orchestrator/evidence-fixtures.test.ts`: the TypeScript runner
  of the manifest.
- `members/src/orchestrator/receipt.ts` (extends 121): `checkReceipt` and
  `receiptBindsSubject`.
- `members/src/orchestrator/verification-report.ts`: the report (B-7), built
  from `verifyBundle`, `checkReceipt` and `receiptBindsSubject`, and `admit`,
  the pure admission evaluator (B-9), with its test.
- `members/src/commands/orchestrator.ts` (extends 023) and the Rust journal
  crate (extends 113): the input cap on bundle verification, and the Rust
  runner of the manifest.

## 3. Behavior

### B-1. Positive fixtures are minted once and frozen

The minting script drives the real modules: a journal opened in a temporary
directory, a receipt minted with `mintReceipt` over a real passing suite, the
broker (122) over a fake GitHub client and a local bare remote pushing,
opening and merging on that receipt, a refused broker action, a fence refusal
recorded by the stage, and `exportBundleFromRoot` at the current policy with
the attestation absent and with it present (a real `spec-spine attest` over a
fixture corpus). The outputs are committed under
`docs/evidence/fixtures/v1/` with the journal files alongside the bundles.

The journal stamps wall-clock time, so a second run produces different bytes.
That is accepted rather than engineered around: a compatibility fixture is
the bytes a released version wrote, and it is never regenerated. A later
receipt or bundle version gets a new directory beside `v1/`, and `v1/` stays
as it is for as long as any reader supports version 1. The committed
policy-1 bundle is referenced, not copied, as the oldest fixture.

### B-2. Every fixture has a manifest entry

`docs/evidence/fixtures/manifest.json` lists each fixture with its file, what
it is (a bundle, a single record, a receipt payload, a byte vector), its typed
reference (B-8), the mutation or vector that made it when it is negative, the
subject question it is asked (a G-07 git subject, B-8; every subject-bearing
fixture is asked one), the admission policy it is evaluated under when one
applies, and its expected report (B-7): four evidence dimensions and the
admission result.

| Member | Values | Question, and the rule for each value | Checked today by |
|---|---|---|---|
| `evidence.integrity` | `pass`, `fail`, `unknown` | do the bytes, links, sequence and verbatim payloads recompute, and is every receipt internally consistent; `unknown` only when the format or version is unsupported (reason `unsupported-version`), never `fail` and never `pass` | `verifyBundle`, `verify_bundle`, `checkReceipt` |
| `evidence.signature` | `pass`, `fail`, `unsigned`, `unknown` | is a signature carried, and does it verify; `unsigned` when none is carried, `fail` when one is carried and does not verify, `unknown` for a scheme the verifier does not support | nothing signs: every entry is `unsigned` |
| `evidence.issuerTrust` | `pass`, `fail`, `unknown` | was it signed by a key eligible under a root set the reader supplied independently of the evidence, valid when it signed; `pass` only after `signature: pass` against such a root; `fail` when that root set positively revokes or excludes the key; `unknown` otherwise, including an absent key, an absent root set and all unsigned evidence. The bundle's own `anchorHash` is never an issuer, so a self-anchored chain can never satisfy a policy that requires a trusted issuer | every entry is `unknown` |
| `evidence.subjectBinding` | `pass`, `fail`, `unknown`, `not-applicable` | does the evidence name the repository, commit and object formats asked about, and are the records it references present; `not-applicable` only for a record type that carries no subject; `unknown` when a subject is expected and the evidence cannot establish it (a withheld receipt, a bundle with no receipt, no subject asked of a subject-bearing fixture); `fail` when it names another repository, commit or object format, or references a record the bundle does not hold | `receiptBindsSubject`, the runner's reference check |
| `admission` | `{ evaluated: false }`, or `{ evaluated: true, policy, decision, reasons }` with `policy` a typed reference (B-8) and `decision` `admit` or `refuse` | not an evidence dimension: whether an explicit policy accepts this evidence for an action, including whether `unsigned` or `unknown` is acceptable. Incomplete required evidence refuses with a reason code | `admit` (B-9) |

Every value other than `pass` carries a reason code from a closed list the
schema versions, with a one-line message. A check that did not run is
`unknown`, never `pass`. A runner or a report that folds the dimensions into
one boolean, or places `admission` among them, fails the manifest's own
self-check.

Beside the dimensions, never inside them, a report preserves what G-06 names:
`claims` (what a producer asserted, such as a receipt's `passing` or a
carried attestation's recompute and freshness, each with its producer, kept
distinguishable from what this verifier checked; a signed observation does
not upgrade the evidence it observes), `verifier` (name and version),
`rootSet` (the identity of the root set supplied, `null` when none was, which
is every fixture today), `coverage` (records verified, fields omitted,
payloads withheld, and withheld payload commitments that version 1 leaves
unbound) and `stop` (`null`, or where and why the verifier stopped; every
dimension it did not reach is `unknown`).

### B-3. The negative set, and the mutation behind each

Derived from the frozen positives by the minting script, each by one stated
mutation, so a reader can reproduce it by hand:

- **truncated**: the last record removed (declared count and head now
  contradict the records);
- **tampered payload**: one byte changed inside a verbatim payload;
- **broken link**: one `prevHash` changed;
- **reordered**: two adjacent records swapped;
- **withheld with payload**: a record marked withheld that still carries one;
- **unknown format** and **unsupported version**: `format` and
  `formatVersion` changed;
- **malformed**: the file cut mid-document;
- **attestation mismatch** and **attestation malformed**: the carried
  document altered, and a block claiming an attestation with no document;
- **forged receipt, red**: a receipt payload with `passing: true` and one
  non-zero exit code, re-chained so integrity passes;
- **forged receipt, digest**: a receipt whose `suite.digest` does not
  recompute from its commands, re-chained;
- **dangling receipt**: a `broker.action` naming a `receiptHash` the chain
  does not hold (the missing-evidence case);
- **re-anchored**: the whole chain rebuilt from a fresh anchor, internally
  perfect;
- **oversized**: a bundle over the input cap (B-5).

- **historical credential**: a receipt minted with a fabricated token-bearing
  origin (the shape 128 B-6 stops at the source), exported at the current
  policy. Under policy version 6 (128 B-7) the bundle withholds `origin` and
  carries no token, and the journal fixture beside it still holds the token,
  byte for byte: redaction without rewriting.

The revision-4 matrix (the package's shared contract acceptance) adds, each by
one stated mutation or one vector:

- **duplicate member, before** and **after** the real one, and **at depth**
  inside a nested payload object: refused as `integrity: fail`, reason
  `ambiguous-json`, by both verifiers (B-10);
- **large integers and numeric spellings**, **invalid encoding** (invalid
  UTF-8, a byte-order mark), **whitespace** and **key order**: statecrafting
  010's vectors (B-10);
- **reparsed bundle**: the positive bundle parsed and re-serialized, so every
  `recordHash` recomputes and the byte digest differs: its report is the
  original's, and its typed reference does not match the original's (original
  bytes versus canonical record identity, B-8);
- **unbound withheld commitment**: in a record exported with fields withheld,
  the `payloadHash` and an included value altered. Version 1 checks such a
  record for continuity only, so the chain verifies: the compatibility view
  reports `integrity: pass` with the record counted in `coverage` as unbound,
  and a policy that requires a bound payload commitment refuses it. Version 1
  is never repaired; a construction that binds it is a new, versioned one;
- **wrong subject**: a receipt asked about another repository, another
  commit, and the same commit named in another object format:
  `subjectBinding: fail`;
- **unsupported algorithm**: a reference naming a digest other than
  `sha-256`, refused (B-8);
- **absent root set**: every fixture evaluated with no roots supplied reads
  `issuerTrust: unknown`, and the admission pair's refusal (B-9) rests on it;
- **early stop**: a two-chain bundle broken in its first chain; `stop` names
  the chain and record, and every dimension and coverage count the verifier
  did not reach is `unknown`;
- **type parity**: for every bundle fixture the two verifiers' `report` members
  are equal as JSON values, types included, which F12's string `"true"` would
  fail.

The expectations that matter most: re-anchored is `integrity: pass`,
`signature: unsigned`, `issuerTrust: unknown`, and refused by any policy that
requires a trusted issuer (G-06); the two forged receipts are `integrity:
fail` from `checkReceipt` although the chain verifies, and a forged receipt's
`passing` survives only as a claim; dangling is `integrity: pass`,
`subjectBinding: fail`; unsupported version is `integrity: unknown`; and the
committed policy-1 bundle, asked about a head, is `subjectBinding: unknown`,
because it holds no receipt.

Reserved, each with its reason, until the record it needs exists: a
**signature that does not verify** and a **positively revoked or excluded
issuer key** (no signature envelope or issuer enrollment exists yet: Statecraft
G-08 issues the first, and D-11 records why this spec does not invent one), a
**stale permit** (no WorkPermit format exists, doc 05 D70) and a **wrong
audience** (no hosted evidence intake exists, doc 05 D71).

### B-4. Two receipt checks, both pure

`checkReceipt(payload)` returns the list of reasons a receipt payload is
internally inconsistent: an unknown `schemaVersion`, `passing` beside any
non-zero exit code, a suite digest or policy digest that does not recompute,
a results list whose commands are not the suite's. `receiptBindsSubject(
receipt, {origin, head})` answers whether the receipt names that head and,
when an origin is given, that repository (both sides compared with any
userinfo removed, the normalization 128 B-6 applies at the source). Neither
reads a clock, a file or the network. Neither is called by
the broker, which folds receipts it minted itself from its own chain (121
D49); they exist for a reader who did not.

### B-5. Verification has an input cap, and executes nothing

`journal verify --bundle` and the Rust verifier refuse a file larger than 64
MiB before parsing it, naming the limit and an override flag
(`--max-bytes`). No verifier in this repository executes, evaluates or
fetches anything a bundle names: a command in a receipt is data, and a
spec-spine attestation is hashed, not run (039 B-2). The manifest runners
assert both.

### B-6. Schemas describe version 1 as the code reads it

`docs/evidence/fixtures/schema/` holds JSON Schemas (draft 2020-12) for the
bundle (format `observatory-journal-export`, version 1), a journal record
(`seq`, `ts`, `kind`, `prevHash`, `recordHash`, `payload`), the receipt
payload (schema version 1), `broker.action`, `broker.refused` and
`fence.refused`. Each schema states what the code enforces and nothing it
does not: the broker and fence payloads carry no version field today, and
their schemas say so rather than inventing one. The canonical form behind
every hash (`stableStringify`, key order and number formatting, 113 B-2) is
written out beside them, with the exact recipe for `recordHash` and
`payloadHash`, so a reader in another language can recompute without reading
this repository's code.

### B-7. Both verifiers emit one report, additively

`journal verify --bundle --json` and `statecraft-journal verify-bundle --json`
each gain a `report` member holding B-2's shape with `reportVersion: 1`: the
four dimensions, `admission`, `claims`, `verifier`, `rootSet`, `coverage`,
`stop` and the subject asked, built from the same checks. Both verbs accept
`--subject` and `--policy <file>`; without a policy, `admission` is `{
evaluated: false }`. The report is serialized in 113 B-2's canonical form, so
the two verifiers emit identical bytes for identical reports; this is the
concrete version and serialization G-05 leaves to this spec to freeze.
Everything either verb emits today stays, with the same exit codes (0 intact,
1 broken): the TypeScript `verified` and the Rust `chains.ok` keep meaning
integrity only, and their documentation says so. The two envelopes still
differ (F12), which is why the manifest runners compare `report` objects and
nothing else. A report contains no boolean summary. A verb that refuses an
unsupported input outright (exit 3) emits no report; one that reads it
reports `integrity: unknown`.

### B-8. Evidence is referenced by typed digests of bytes

G-07's reference, in the serialization this spec freezes. A bundle is
referenced as `{ type: "observatory-journal-export", schemaVersion: 1, digest:
{ alg: "sha-256", hex }, length, producerDigest: null }`, over the file's bytes
exactly as written, with `length` their count. A record inside it has no bytes
of its own and is referenced as `{ type: "observatory-journal-record",
schemaVersion: 1, container: <the bundle's reference>, selector: { chain,
seq, anchorHash, kind }, producerDigest: { construction:
"observatory-record-hash/v1", value: <recordHash> } }`. `recordHash` is the
chain's identity, computed over the canonical serialization of the record
without `recordHash` (B-6's recipe, named by its construction); it is not a
digest of any bytes a receiver was handed, and the manifest never uses one in
place of the other. A reference's identity includes its construction, so a
later construction is a new name, never a silent change of this one. `alg`
accepts exactly `sha-256`, and a reference naming anything else is refused. A
git subject is `{ repository, commit: { format, hex }, tree: { format, hex } |
null }`, with `format` `sha1` or `sha256`. The schemas and the manifest state
that a receiver which parses a bundle into a JSON value and re-serializes it
has stored a reparse, whose digest is not the bundle's.

### B-9. The first acceptance is the admission pair

`admit(report, policy)` is pure: it reads a report and a policy, and no clock,
file or network. A fixture policy is a small JSON document under
`docs/evidence/fixtures/policies/`, referenced by its typed digest, stating
which dimension values it requires. Two exist before anything else is added
to the manifest:

- `allow-unsigned-local`: requires `integrity: pass` and `subjectBinding:
  pass`, and accepts any `signature` and `issuerTrust`;
- `require-trusted-signature`: requires as well `signature: pass` and
  `issuerTrust: pass`.

The same minted, intact, unsigned bundle, asked about its receipt's subject,
is admitted under the first and refused under the second with reasons
`signature-unsigned` and `issuer-unknown`. Both reports still read
`signature: unsigned` and `issuerTrust: unknown`: admission under a policy
that allows unsigned evidence does not make the evidence trusted, and the
report never says otherwise. Both runners reproduce the pair before any other
manifest entry lands; the matrix (B-3) follows, with a third fixture policy,
`require-bound-payload-commitment`, for the unbound withheld commitment.

### B-10. Input is portable, and statecrafting 010's vectors test it

Both verifiers refuse, as `integrity: fail` with reason `ambiguous-json`, a
duplicate object member at any depth, and refuse a number that is not an
integer within `-(2^53-1)` to `2^53-1`, invalid UTF-8 and a byte-order mark
(the package's PKG-04, which settles 113 B-2's boundary at `2^53-1`).
Whitespace and key order are not refused: admitted input need not be spelled
canonically, and its byte digest stays its own. The 23 vectors of statecrafting
010 (`specs/010-evidence-byte-seam/vectors/evidence-bytes.v1.json` at
`d0f65e5`, SHA-256 `e5eb55c8e4368f36abc70d0bb9454829132131bfc5c9d42660e0ca2085d48aee`)
are copied byte for byte under `docs/evidence/fixtures/vectors/` with that
provenance, and each has a manifest entry with its expected outcome under
both verifiers. The vectors come from a repository whose root license is
Apache-2.0 (the package's PKG-05); the copy records it.

## 4. Functional requirements

- **FR-001.** The TypeScript runner reproduces every manifest expectation for
  every fixture, and fails if any entry is missing a dimension.
- **FR-002.** The Rust runner reproduces every `integrity` expectation for
  every bundle fixture, and its results match the TypeScript runner's.
- **FR-003.** The committed policy-1 bundle and every `v1/` positive fixture
  verify under both runners, and their bytes are unchanged by this spec.
- **FR-004.** `checkReceipt` reports each forged receipt's defect by name and
  returns no reasons for every minted receipt in the fixtures.
- **FR-005.** Each JSON Schema accepts every positive fixture of its kind and
  rejects the negative fixtures that are structurally invalid.
- **FR-006.** An oversized bundle is refused by both verifiers before
  parsing, with the limit named; `--max-bytes` admits it.
- **FR-007.** The manifest's self-check: a runner that reports one boolean in
  place of the four dimensions fails, and so does a report that carries
  `admission` among the evidence dimensions.
- **FR-008.** For every bundle fixture, the TypeScript and Rust `report`
  members are equal as JSON values, and each verb's existing members and exit
  code are unchanged from before this spec.
- **FR-009.** No fixture this repository mints reports `signature` other than
  `unsigned` or `issuerTrust` other than `unknown`; a report whose
  `issuerTrust` is `pass` while `signature` is not `pass` fails validation.
- **FR-010.** Every manifest entry's typed digest recomputes from the file's
  bytes, and a reference with an `alg` other than `sha-256` is refused.
- **FR-011.** The admission pair, first (B-9): both runners reproduce it, the
  admitted and refused reports are identical in every evidence dimension, and
  both read `signature: unsigned` and `issuerTrust: unknown`.
- **FR-012.** Portable input (B-10): every statecrafting 010 vector yields its
  manifest outcome under both verifiers; a duplicate member before, after and
  at depth is refused with `ambiguous-json`; `2^53` is refused and `2^53-1`
  admitted; the reparsed bundle verifies with a typed reference that does not
  match the original's.
- **FR-013.** The unbound withheld commitment verifies under the version-1
  view with the record counted as unbound in `coverage`, and is refused under
  `require-bound-payload-commitment`.
- **FR-014.** Early stop: the report names the stop, and every dimension and
  coverage count past it is `unknown`.
- **FR-015.** Trust from outside the evidence: with no root set supplied,
  every fixture's `issuerTrust` is `unknown` and `rootSet` is `null`, and no
  fixture's own anchor or content changes that.

## 5. Acceptance

- `bun test` in `members/` and `cargo test -p statecraft-journal` are green;
  `make gate` exits 0.
- Before any fixture is minted, Statecraft's 015 and 016 record the same G-05
  to G-07 contract this spec records (the package's ST-01), and the status
  section names that commit. This is the shared record CLI-04 asks for, not a
  review round.
- The admission pair (FR-011) is accepted first, then the matrix.
- The fixtures, manifest and schemas are handed to Statecraft and hqgit as
  the definition of receipt version 1 and bundle version 1 (doc 05 §14), and
  the hand-off is recorded in this spec's status section with the commit it
  named.

## Verification

```sh
cd members && bun test src/orchestrator/evidence-fixtures.test.ts
cd members && bun test src/orchestrator/verification-report.test.ts
cd members && bun test src/orchestrator/receipt.test.ts
cargo test -p statecraft-journal
make gate
```

## 6. Out of scope

- **Signing, and so issuer trust.** Every signature outcome is `unsigned` and
  every issuer outcome `unknown` until a receipt or bundle is signed by a key
  a reader can pin. The first issuer is Statecraft's (G-08); a fixture that
  later carries a test signature is test evidence, never evidence that a run's
  receipt is signed.
- **A trust store and hosted ingestion.** How a reader supplies its trust set,
  and how Statecraft stores what it receives (doc 05 D81's bytes rule), are
  theirs.
- **The neutral verifier's package.** The manifest is packaging-neutral on
  purpose. Extending `statecraft-journal`, a sibling crate, or another
  repository are all compatible with it; no AGPL code may enter whichever is
  chosen.
- **Receipt version 2.** Doc 05 D68, after spec-spine 087. Its fixtures will
  land beside `v1/`.
- **Archive formats.** A bundle is one JSON file today, so archive-specific
  hazards (path traversal, symlink escape, decompression bombs) do not arise
  here. A future archive format brings its own negative cases.
- **A production reader policy.** The fixture policies of B-9 exist to
  exercise `admission`; which policy Statecraft, hqgit or an operator applies,
  and the trusted base it is read from, are theirs.

## 7. Resolved decisions

D-1 (2026-09-11). Frozen, not reproducible. Byte-for-byte regeneration would
need a clock seam in the journal for no production purpose, and would
invite regenerating a fixture, which is the one thing a compatibility
fixture must never be. B-1 mints once per version and freezes.

D-2 (2026-09-11). Fixtures under `docs/evidence/`, beside the committed
bundle and the qualification records, rather than a new top-level directory.
`docs/**` is already a hashed governance input, so the claim needs no change
to `spec-spine.toml`.

D-3 (2026-09-11, revised 2026-09-12). Four evidence dimensions, reported
apart, and policy beside them rather than among them. Folding them is how a
fabricated but consistent bundle comes to read as "verified", and the
manifest's self-check (FR-007) makes the separation a tested property. The
first draft named `integrity`, `subject`, `issuer` and `policy`; the revision
follows doc 05 D80: `signature` joins because an absent signature and an
invalid one are different answers (`unsigned` and `fail`), and `policy` leaves
because it is a reader's decision over the evidence, not a property of it.

D-4 (2026-09-11). 64 MiB. The largest bundle this repository has produced is
under 1 MiB; the cap is two orders of magnitude above it and exists to make
"refuse before parsing" a stated behavior rather than an accident of memory.

D-5 (2026-09-12; proposed, and superseded the same day by D-9). This repository proposes the
report rather than waiting for Statecraft to lead it. The fixtures need
expected verdicts to be useful at all, and Statecraft's draft 015 writes no
parser until they exist, so one side has to write the shape down first. The
values are a counter-proposal to Statecraft 015 §7.2 and hqgit's note 02 T-3,
sent with the fixtures (doc 05 D80 lists what each would change). If either
settles differently before this spec is approved, the manifest follows the
agreed shape, and this decision is replaced with a dated entry naming it.

D-6 (2026-09-12). What approval of this spec authorizes: the `v1/` fixtures
minted through the real code paths and frozen, the negative set, the
manifest, the schemas, `checkReceipt` and `receiptBindsSubject`, the input
cap, both runners, and the report in both verifiers (and, since D-9, the
admission evaluator with its fixture policies and the copied vectors). Not
signing, a trust store, a production reader policy, hosted ingestion, receipt version 2, or any change to
a committed bundle's bytes. Doc 05 D82.

D-7 (2026-09-12; adopted by the owner the same day, CLI-01). Land 128 first. The fixtures are then minted at
policy version 6 and the historical-credential fixture proves redaction
without rewriting. If this spec lands first, its fixtures are policy 5, and
128 adds a policy-6 fixture directory beside `v1/` without touching it.

D-8 (2026-09-12). Keep both existing JSON envelopes and add the report,
rather than normalizing the Rust envelope to the TypeScript one. The Rust
`chains.ok` string is an unversioned shape somebody may already read;
changing it would be the kind of silent contract edit this spec exists to
prevent. The report is the versioned shape from here on.

D-9 (2026-09-12, the owner). The adoption of revision 4's CLI-04 (doc 05
§19): G-04 to G-07 are this spec's contract. Statecraft owns the semantics;
this repository holds the schemas, fixtures and pure verifier, and freezes
the version and serialization (B-7, B-8). From G-05, `policy` becomes
`admission` with reason codes, `not-applicable` is reserved for subjectless
record types, and a missing expected subject is `unknown`. From G-06, a
report keeps claims, verifier identity, root-set identity, coverage and stop
reasons apart from its dimensions, and trust comes only from roots supplied
independently of the evidence. From G-07, references carry length, a named
construction, and a container and selector for an embedded record. The shared
decision is recorded in Statecraft and here before minting (§5), and the
first acceptance is the admission pair (B-9, answered by the owner in the
adopting session), then the full matrix. This replaces D-5: the names are no
longer a counter-proposal waiting for agreement.

D-10 (2026-09-12). statecrafting 010's vectors are copied, not referenced by
path. A fixture a verifier is held to has to travel with the manifest, and
010 sits on an unmerged branch of another repository. The copy keeps the
bytes, the source commit and the SHA-256 that grand-refactor's source
manifest also records, so a reader can check it against the original. The
package's PKG-05 places the vectors in the permissive workspace with this
repository as consumer; no AGPL material is involved.

D-11 (2026-09-12). The revoked-root and failed-signature cases stay reserved.
The package's matrix names absent and revoked roots. An absent root set needs
nothing new and is in the matrix (FR-015). A revoked root needs a signature
that verifies against a key a root set revokes, which needs a signature
envelope and an enrollment record; neither exists, and Statecraft's G-08
issuer defines the first. Inventing one here would make these fixtures the
definition of a signing format by accident. This is the smallest
counterproposal the package's §4 allows: the two cases are minted, labelled
as test evidence, in the change that adopts G-08's envelope.

## Status (2026-09-12, amended)

Amended on 2026-09-12 to the owner's adoption of revision 4 (doc 05 §19,
CLI-04; D-9 to D-11): the summary, §1, the report's dimensions, `admission`
and its companions (B-2, B-7), the matrix (B-3), G-07's references (B-8), the
admission pair (B-9), portable input and statecrafting 010's vectors (B-10),
FR-007 and FR-011 to FR-015, §5 and §6. Still `draft`, `implementation:
pending`: the flip to `approved` is recorded in the change that dispatches
it, which can run independently of 128 and 129 once Statecraft's record
exists, and mints at policy version 6 once 128 is built.

## Status (2026-09-12)

Authored `draft`, `implementation: pending`, from doc 05 §3 F5 and D66 and
D67. The facts it rests on: the committed bundle's header reads
`formatVersion: 1, policyVersion: 1` with no `attestation` member and no
record of kind `acceptance.receipt` or `broker.action`; `verifyBundle` begins
each chain at the bundle's own `anchorHash`; `parseReceipt` checks field
types and `passing === true` only; neither verifier bounds its input.

Revised on 2026-09-12 from doc 05 §18 (F5 re-measured, F12; D80 to D82): the
report's dimensions and values, `signature` and the separate policy result,
the typed byte references, the historical-credential fixture, the approval
scope and the order with 128. The re-measurement ran both verifiers on the
committed bundle, a forged self-anchored bundle and a tampered copy, all
throwaway except the committed one. No fixture has been minted: that is the
implementation this spec would authorize, and approval is a human flip. D-5
is the choice most worth a look at approval.
