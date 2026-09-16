---
id: "113-journal-port"
title: "The journal in Rust: one canonical form, the substrate's, verified against every chain that exists"
status: approved
created: "2026-09-09"
implementation: complete
depends_on:
  - "111-contract-crate"
  - "011-work-journal"
  - "020-decision-ledger"
  - "031-journal-export"
  - "039-attested-export"
establishes:
  - { kind: crate, id: "statecraft-journal" }
  - { kind: directory, path: "crates/statecraft-journal/" }
  - "members/src/members/journal-parity.test.ts"
extends:
  - { spec: "102-crate-scaffold", unit: "Cargo.lock", nature: additive }
  # 011 owns the TypeScript writer; its canonical form is pinned to the
  # substrate's and its portability set closed (B-2, D-2).
  - { spec: "011-work-journal", unit: "members/src/orchestrator/journal.ts", nature: additive }
  - { spec: "011-work-journal", unit: "members/src/orchestrator/journal.test.ts", nature: additive }
  # 031 owns the exporter; its serializer emits the canonical order too.
  - { spec: "031-journal-export", unit: "members/src/orchestrator/export.ts", nature: additive }
  # The members workflow builds the Rust journal for the parity test.
  - { spec: "110-corpus-merge", unit: ".github/workflows/members.yml", nature: additive }
references:
  - { unit: { kind: file, path: "docs/design/02-the-monorepo-and-the-rust-sequence.md" }, role: context }
  - { unit: { kind: file, path: "docs/evidence/journal-bundle.json" }, role: context }
summary: >
  Doc 02 §6 names the one thing a Rust port deletes rather than tidies:
  underneath a product whose whole claim is offline-verifiable
  tamper-evident chains sit two implementations of canonical JSON, one of
  which exists only in journal.ts. This spec is the second step of D30.
  statecraft-journal is the hash-linked chain of spec 011 (open, recover
  a torn tail, append with fsync, verify, fold, the intent bracket), the
  decision record's content hash and validation (020), and the export
  bundle (031, 039): its redaction policy, its assembly, its serialized
  bytes and its offline verifier, all over canonical-keysort-json and
  sha2. It ships as a member binary, statecraft-journal, so the umbrella
  dispatches `statecraft journal verify` and `verify-bundle` and `export`
  to a verifier that shares no code with the writer. The gate doc 02 set
  is met before anything is retired: every chain and bundle this family
  has written reverifies byte for byte, the committed evidence bundle
  included, and a bundle exported from one chain by either
  implementation is the same bytes. The canonicalization divergences doc
  02 measured are decided here (D-2): the substrate's order is the
  canonical one, and the TypeScript writer is tightened to it.
---

# 113: The journal in Rust

## 1. Purpose

Spec 011's journal is the orchestrator's memory and the evidence bundle's
source of truth; it reimplemented the attest-ledger chain discipline "as a
small pure module rather than pulled in as a dependency" because the
repository had a zero-runtime-dependency rule and no Rust. The monorepo
has both crates on crates.io and a workspace to hold them, so the port
lands where D30 put it: after the sensor proved the ergonomics, before
the engine, gated on reverifying everything that exists.

The canonicalization check doc 02 ran found the two implementations agree
on every record ever written and disagree on four classes of input the
corpus does not contain. A second implementation makes those classes a
contract question rather than a latent one, and this spec answers it
rather than shipping two canonical forms.

## 2. Territory

Owned: `crates/statecraft-journal/` (a library and the binary
`statecraft-journal`) and the parity test
`members/src/members/journal-parity.test.ts`.

Extended: `journal.ts` and its test (011), whose canonical form is pinned
to the substrate's; the lockfile (102); the members workflow (110).

Not claimed: `decisions.ts` beyond the record shape and content hash
(sealing a drop-box is the engine's writer path and moves with the
engine), `export.ts` (it keeps serving the TypeScript engine's `journal
export`; the parity test is what holds it to the crate), the engine's use
of either.

## 3. Behavior

- **B-1 (the chain).** `Chain::open(dir, basename)` takes the exclusive
  lock (`O_CREAT|O_EXCL`), loads or creates the anchor
  (`sha256(canonical({kind: "orchestrator-journal-anchor", createdAt}))`),
  recovers a torn tail into the `.torn` sidecar and truncates, parses and
  shape-checks every line, and checks only the tail's link and hash;
  `append(kind, payload)` seals `{seq, ts, kind, payload, prevHash}` with
  `recordHash = sha256(canonical(base))`, writes the canonical line and
  fsyncs before returning; `verify_chain(dir, basename)` recomputes every
  hash and link from the anchor; `fold` and `unresolved_intents` are
  011's. The four filenames per basename are 011's. A chain the
  TypeScript writer wrote opens, verifies and extends; one this crate
  wrote does the same under the TypeScript reader.
- **B-2 (one canonical form).** The canonical bytes of a value are
  `canonical_keysort_json::to_canonical_string` over the portability set:
  null, booleans, strings, integers within `±2^53`, arrays and objects of
  the same. Object keys sort by UTF-8 byte order at every depth. A float,
  an integer outside the safe range, or a string that is not valid
  Unicode is refused before it reaches disk, on both sides.
  `journal.ts`'s `stableStringify` is changed to serialize in that order
  itself rather than through `JSON.stringify`'s enumeration order, so an
  integer-like key sorts lexicographically with its neighbors, and its
  `canonicalizeValue` refuses an unsafe integer and a lone surrogate. Every
  record ever written is unaffected (D-2 records the measurement).
- **B-3 (the decision record).** `DecisionRecord`, its allowed and
  required fields, `validate` with 020's messages, and `content_hash`
  (`sha256(canonical(record with optional fields omitted))`) are 020's.
- **B-4 (the bundle).** `RedactionPolicy` with 031's version-1 allowlist
  and stripped-field list as data; `redact_payload`; `build_bundle`;
  `serialize_bundle` as canonical keys, two-space indent, trailing newline,
  byte-identical to `JSON.stringify(canonicalizeValue(bundle), null, 2)`;
  `parse_bundle` with 031's structural refusals; `verify_bundle` and
  `verify_attestation` with 031 B-3's and 039 B-2's verdicts and counts;
  `run_corpus_attest` reading `spec-spine attest --with-coupling` exactly
  as 039 does, with the same recorded absences.
- **B-5 (the member).** `statecraft-journal` answers `--member-manifest`
  (`contract` 042, verbs `verify`, `verify-bundle`, `export`, tier
  `basic`, the D-4 taxonomy) and:
  - `verify [--dir <state root>] [--chain work|decisions|both] [--json]`:
    011's verdict per chain, exit 0 intact, 1 broken, 3 usage;
  - `verify-bundle <path> [--json]`: 031's chain verification and 039's
    attestation verdict, separately reported; exit 0 when every chain is
    intact, 1 otherwise;
  - `export --dir <state root> [--project <name>] [--out <path>]
    [--no-attest] [--json]`: 031's bundle with 039's attestation (or the
    recorded absence), written with `serialize_bundle`.
  Under `--json` the envelope is the family's (111 B-3).
- **B-6 (the gate).** Before this spec's status reads complete, the Rust
  verifier has reverified: the committed `docs/evidence/journal-bundle.json`
  (every verbatim payload recomputed into its record hash), and every
  local chain the orchestrator has written on the machine that ran the
  port, with counts recorded in the status note.

## 4. Functional requirements

- **FR-001.** Chain unit tests: open on an empty directory writes an
  anchor and an empty journal; append seals and links; a torn tail is
  moved aside and the tail re-verified; a second open refuses on the
  lock; `verify_chain` names the first broken seq and reason for each of
  011's four corruptions; `unresolved_intents` pairs order-aware per op.
- **FR-002.** Canonical-form tests: the four classes doc 02 measured
  (integer-like keys, a lone surrogate, an integer above `2^53`, a float)
  each refused or ordered as B-2 says, on both sides, with the TypeScript
  test extended to the same cases.
- **FR-003.** The parity test: (a) the Rust verifier reverifies the
  committed evidence bundle and reports the same counts `verifyBundle`
  reports; (b) a chain written by `openJournal` (payloads covering
  included and withheld kinds, stripped fields, private paths, nested
  objects, integer-like keys) verifies under the Rust verifier, and a
  chain written by the crate verifies under `verifyChain`; (c) a bundle
  exported from that chain by `exportBundleFromRoot` and by
  `statecraft-journal export --no-attest` is byte-identical; (d) the two
  verifiers agree on a tampered bundle's first failure.
- **FR-004.** The manifest the binary answers parses through the
  contract crate and the umbrella lists it.

## 5. Acceptance

- `cargo test --workspace` green; clippy and fmt clean.
- `cd members && bun test src/members/journal-parity.test.ts
  src/orchestrator/journal.test.ts` passes.
- `statecraft journal verify-bundle docs/evidence/journal-bundle.json`
  reports both chains intact with 1038 work and 52 decision records.
- The status note records the local chains reverified (B-6).

## Verification

```verify:cli
cargo test --workspace --locked -p statecraft-journal
```

```verify:cli
cd members && bun test src/members/journal-parity.test.ts
```

## Status (2026-09-09)

Implemented. B-6's gate, run on the machine that ran the port:

| Chain | Work records | Decision records | Rust verdict | TypeScript verdict |
|---|---|---|---|---|
| `docs/evidence/journal-bundle.json` | 1038 (676 verified, 97 redacted, 265 withheld) | 52 (51, 1, 0) | intact | intact, same counts |
| claude-observatory `data/orchestrator` | 1696 | 70 | intact | intact |
| rahi | 632 | 86 | intact | intact |
| tenant-tail | 437 | 0 | intact | (not re-run) |
| tenant-emit | 193 | 0 | intact | (not re-run) |
| icebeek | 110 | 0 | intact | (not re-run) |

Every record ever written reproduces under the substrate's canonical form.
The parity test's four parts passed once the TypeScript bundle serializer
was also moved onto the canonical order (B-2 reached `export.ts` as well as
`journal.ts`: `JSON.stringify(v, null, 2)` enumerated an integer-like key
first, and the fixture chain deliberately carries one).

## 6. Out of scope

Retiring the TypeScript writer (it retires with the engine, D30). The
drop-box seal and the decision query (engine writer and reader paths).
Signing anchors (attest-ledger's Ed25519 anchor is a later choice the
chain format does not preclude, D-3).

## 7. Resolved decisions

D-1. `canonical-keysort-json` and `sha2`, not `attest-ledger-core`. The
journal's envelope is not attest-ledger's `LedgerRecord`; it shares the
discipline (canonical key-sorted JSON, sha256, prevHash), which the
canonical crate and a hash provide. Depending on the ledger core would
buy an Ed25519 stack for one `sha256_hex`.

D-2. The substrate's order is canonical. Doc 02 measured: all 1,766 local
records and the 1,090 bundled ones reproduce under both implementations;
zero records contain an integer-like key, a lone surrogate, an unsafe
integer or a float. The four classes are therefore free to decide, and
deciding for the published crate means the Rust ports and every other
consumer (attest-ledger, spec-spine) already agree. The TypeScript writer
is tightened to the same form; nothing it has written changes hash.

D-3. A member binary rather than verbs on the engine. A verifier that
shares no code with the writer is the property offline verification
claims, and `statecraft journal verify-bundle` is that claim made
runnable by anyone with the umbrella. When the engine is Rust it links
the crate and the member's verbs become its own.
