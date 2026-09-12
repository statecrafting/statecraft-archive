---
id: "010-evidence-byte-seam"
title: "The evidence-byte seam: original bytes beside the ledger, never through it"
status: approved
implementation: in-progress
created: "2026-09-12"
depends_on:
  - "001-packages-thesis"
  - "005-governance-native"
establishes:
  - { kind: directory, path: "specs/010-evidence-byte-seam/" }
extends:
  - spec: "005-governance-native"
    unit: { kind: directory, path: "addon/governance-native/" }
    nature: additive
summary: >
  What `governance-native` promises about bytes, split from the native
  extraction (009) because it is on statecraft's evidence-intake path and
  the extraction is not. Measured on 2026-09-12 against current source
  and all three published 0.1.0 binaries, the ledger stores and hashes a
  reparse of what it is given. Distinct bytes share a record hash,
  including two different 30-digit integers. `ledgerVerify` accepts
  stored-byte edits that keep the parsed model, including an injected
  duplicate key. A record carrying a float verifies or reports "content
  was altered" depending on which `serde_json` the verifier links,
  because every addon's `Cargo.lock` is gitignored. statecraft's 014 D-3
  already keeps foreign evidence out of the addon. This spec accepts that
  and proposes the addon's half: keep 0.1.0's construction permanently,
  pin it, and add a portable admission rule, aligned with statecraft-cli
  113 B-2, that refuses what the ledger would silently rewrite. It
  supplies 23 regression vectors and the probe that produced every
  result here. Approved 2026-09-12 on the repository owner's
  instruction, scoped to the addon contract A-1 to A-5 as its seven open
  decisions were answered that day (section 10). Publishing 0.2.0 is a
  separate act.
---

# 010: The evidence-byte seam

Link a compilation unit to this spec via `[package.metadata.spec-spine].spec`
in its manifest, a `// Spec:` header, or the edges above.

## 1. Purpose

A revision-3 packet dated 2026-09-11 asked this repository to take one
issue off the extraction schedule. `governance-native::ledger::append`
parses JSON into a `serde_json::Value`, so it cannot promise original
bytes. The packet asks for three things. First, a recommendation
between immutable opaque evidence with typed ledger references and an
explicit opaque-byte encoding. Second, regression inputs for large
numbers, duplicate keys, whitespace and key order, checking bytes and
declared digest separately from metadata. Third, no rewriting of
historical chain hashes. It assigns ownership: statecraft owns intake
and storage, and this repository owns the addon contract statecraft
calls.

statecraft answered first. Its 014 section 10.3 measured the same
normalization and proposed D-3: foreign evidence is kept as its exact
bytes outside the ledger. The ledger holds only a typed reference, no
foreign object passes through `canonicalize` or `ledgerAppend`, and its
own chain keeps its construction forever. That changes the question for
this repository. The addon does not need to store evidence. It needs to
say exactly what its existing functions do, keep doing it, and refuse
the inputs it would otherwise rewrite silently.

**Status: draft.** The packet is planning input, not approval. statecraft's
014 is a draft on a local branch (`c879de1`, not on its remote as of
2026-09-12). Nothing here amends spec 005 or changes a published package.

**Approved, 2026-09-12.** The paragraph above is this spec as drafted. The
repository owner answered D-1 to D-7 the same day (section 8) and
instructed that a scoped approval be recorded before implementation.
The scope is A-1 to A-5 and section 9's acceptance. It does not cover
publishing 0.2.0, D-6's format declaration, spec 009, or any fleet
change. Section 10 records the ratification.

## 2. Territory

This spec's territory is `specs/010-evidence-byte-seam/`: this file, the
regression vectors under `vectors/`, and the probe under `probe/`. The
`extends` edge declares that section 4's work would reach into
`addon/governance-native/`, which spec 005 owns. It amends nobody, and
while this spec is `draft` it claims nothing there. Approved, the edge is
how section 9's changes to that crate reach spec 005's unit; spec 005
still owns the directory.

| file | role |
|---|---|
| `vectors/evidence-bytes.v1.json` | the 23 vectors: base64 bytes, size, declared digest (SHA-256 over the bytes), class, note |
| `vectors/generate.mjs` | the readable source of the vectors; regenerates the JSON byte for byte |
| `probe/ledger-seam-probe.mjs` | drives an addon binary with the vectors and six stored-byte mutations; asserts nothing, reports everything |

The vectors are base64 so no line-ending or encoding normalization, in git
or an editor, can change them. The files sit outside every package
directory, under the repository's Apache-2.0 root, so statecraft-cli's
fixture set may take them.

## 3. What was measured

2026-09-12. `addon/governance-native/` is byte-identical at `main`
`844ac86` and at 009's `3ff787e`. The probe ran against five binaries and
produced the same report body, vectors, pairs and mutations, from each:

| binary | sha256 of the `.node` file | Node |
|---|---|---|
| release build of this tree, cargo 1.96.0, on-disk `Cargo.lock` (`serde_json` 1.0.151) | not published | v24.6.0, macOS arm64 |
| the same source with 009 section 4.1's feature split applied (scratch copy) | not published | v24.6.0 |
| `@statecrafting/governance-native-darwin-arm64@0.1.0` | `9fd21982e2c510ee23c8a3cfecf4d311b3bf26f08145e334ec332614d16d8fc5` | v24.6.0 |
| `@statecrafting/governance-native-linux-arm64-gnu@0.1.0` | `9cb340ca830ec5d0120ebfe07d270630815155415f357404fb3bd9ccf07b3aaf` | v24.21.0, `node:24-slim` |
| `@statecrafting/governance-native-linux-x64-gnu@0.1.0` | `3177f701b09d1bc39363b2bfad44953eb99ff8347b5180ce62513421a99de8e2` | v24.21.0, `node:24-slim` under amd64 emulation |

Reproduce with any of them:

```sh
node specs/010-evidence-byte-seam/probe/ledger-seam-probe.mjs \
  <governance-native.node> specs/010-evidence-byte-seam/vectors/evidence-bytes.v1.json \
  "$(mktemp -d)" report.json
```

Not run: statecraft's production chain, statecraft's Encore request-body
parser (the probe's `JSON.parse` stands in for it), and any Windows build.

### 3.1 The seam parses

`ledgerAppend(stateDir, record)` parses `record` (`ledger.rs:130-131`) and
hands the `Value` to `attest-ledger-core` 0.1.0's `RecordChain::append`.
The record hash is SHA-256 over canonical-keysort JSON of the record with
`record_hash` removed (`record_chain.rs:33-40`), and the stored line is
`serde_json::to_string` of that record. `ledgerVerify` parses every stored
line again (`ledger.rs:71`) and recomputes. Two doc comments say otherwise.
`ledger.rs:118-119` says "The payload is stored opaquely", which is not
true. `canon.rs:5-7` says a payload hash is "independently reproducible
by any third party from the same JSON", which holds only for a reader
that reproduces this crate's key order and `serde_json`'s number
formatting.

### 3.2 Every vector, separately

Path A submits the vector's bytes as the record. Path B is statecraft's
`backend/governance/records.ts` on its `main` (`9658e29`):
`payloadHash = canonicalize(JSON.stringify(payload)).sha256`, then
`ledgerAppend(JSON.stringify(envelope))`. "Kept" compares the stored
payload with the submitted bytes. "Digest" compares SHA-256 of the stored
payload with the declared digest. "Same hash" means the stored form,
submitted on its own, yields the same record hash, so the chain cannot
tell the two byte strings apart. "Id" is the envelope id the ledger
derived: metadata, reported apart from the bytes. Every appended chain
verified.

| vector | A: stored payload | A: kept / digest | A: same hash | A: id | B: `payloadHash` = declared |
|---|---|---|---|---|---|
| V01 key order | `{"alpha":2,"zeta":1}` | no / no | yes | `00000000` | no |
| V02 CRLF, tab, spaces, trailing LF | `{"a":1,"b":[1,2]}` | no / no | yes | `00000000` | no |
| V03 `{"a":1,"a":2}` | `{"a":2}` | no / no | yes | `00000000` | no |
| V04 duplicate `id` | `{"id":"second","kind":"evidence"}` | no / no | yes | **`second`** | no |
| V05 23-digit integer | `{"big":1.2345678901234568e+22}` | no / no | yes | `00000000` | no |
| V06 2^53 + 1 | `{"n":9007199254740993}` | yes / yes | no | `00000000` | **no**: `JSON.parse` made it `...992` |
| V07 2^64 | `{"n":1.8446744073709552e+19}` | no / no | yes | `00000000` | no |
| V08 `1.0`, `1e3`, `-0`, `1E+2`, `0.10` | `{"d":0.1,"e":1000.0,"f":1.0,"x":100.0,"z":-0.0}` | no / no | yes | `00000000` | no |
| V09 34-significant-digit decimal | `{"price":0.1}` | no / no | yes | `00000000` | no |
| V10 `é\/A` | `{"s":"é/A"}` | no / no | yes | `00000000` | no |
| V11 keys U+E000, U+1F600 | U+E000 first | no / no | yes | `00000000` | no |
| V12 escaped lone surrogate | refused: "unexpected end of hex escape" | | | | refused |
| V13 UTF-8 BOM | refused: "expected value at line 1 column 1" | | | | refused by `JSON.parse` |
| V14 raw `0xFF` in a string | `{"a":"\u{FFFD}"}` | no / no | yes | `00000000` | no |
| V15 200-deep arrays | refused: "recursion limit exceeded" | | | | refused |
| V16 two documents | refused: "trailing characters" | | | | refused by `JSON.parse` |
| V17 2^53 | `{"n":9007199254740992}` | yes / yes | no | `00000000` | yes |
| V18 2^53 - 1 | `{"n":9007199254740991}` | yes / yes | no | `00000000` | yes |
| V19 30-digit integer | `{"n":1.2345678901234568e+29}` | no / no | yes | `00000000` | no |
| V20 V19 plus one | `{"n":1.2345678901234568e+29}` | no / no | yes | `00000000` | no |
| C01 flat strings (control) | unchanged | yes / yes | no | `x` | yes |
| C02 014 D-3 reference, canonical (control) | unchanged | yes / yes | no | `00000000` | yes |
| C03 the same reference, keys in construction order | C02's bytes | no / no | yes | `00000000` | no |

Pairs of distinct submissions with distinct declared digests and **equal
record hashes**: V19 and V20 (two integers, one digest, as statecraft's
Probe 1 found), and C03 and C02. Of the 19 appended vectors, 14 were
stored as different bytes, and each of those 14 has the record hash of its
stored form. On path B, `payloadHash` equals the SHA-256 of the submitted
bytes for 4 of 19: V17, V18, C01 and C02.

V14 never reached the addon as submitted. Node's `Buffer.toString("utf8")`
replaced `0xFF` with U+FFFD before the call, so a napi `String` parameter
cannot carry invalid UTF-8 even to be refused. The same probe shows why an
intake check needs care: `new TextDecoder("utf-8", { fatal: true })`
throws on V14, but a `TextDecoder` with the default `ignoreBOM: false`
strips V13's BOM silently and returns `{}`. Only `ignoreBOM: true` keeps
the BOM so it can be refused.

### 3.3 Verification is over the parsed model, not the stored bytes

Six edits to a copy of the same two-record chain, each changing stored
bytes:

| mutation | `ledgerVerify` |
|---|---|
| M01 a space after `"payload":` | ok |
| M02 `"kind":"forged"` injected before the real `"kind":"stamp"` | **ok**: the last member wins, so a first-wins reader of the archived file sees `forged` |
| M03 `1.2345678901234568e+22` respelled `12345678901234567890123` | ok |
| M04 `"stamp"` respelled `"stamp"` | ok |
| M05 keys reordered inside a payload | ok |
| M06 control: `stamp` changed to `stamq` | fails: "record 0: record_hash mismatch (content was altered)" |

statecraft 017 section 7 already requires copying the archive and
comparing byte digests before and after. M02 is why that comparison is
necessary, not redundant with `ledgerVerify`.

### 3.4 The construction depends on an unpinned float formatter

`addon/governance-native/.gitignore` lists `Cargo.lock`, and so does each
of the other three addons'. The published binaries therefore link
whatever `serde_json` resolved on the publish runner. Measured with each
version pinned in a scratch crate:

| `serde_json` | float formatter | `12345678901234567890123` | `18446744073709551616` | `1e21` |
|---|---|---|---|---|
| 1.0.143, 1.0.145 | ryu 1.0.23 | `1.2345678901234568e22` | `1.8446744073709552e19` | `1e21` |
| 1.0.150, 1.0.151 | zmij 1.0.23 | `1.2345678901234568e+22` | `1.8446744073709552e+19` | `1e+21` |

`1000.0`, `-0.0`, `1e-7` and `5e-324` are identical across all four, and
so is a document of integers at the 64-bit limits and a string holding an
escaped control character, a quote, U+2028, an astral character and a
tab.

A chain written by the addon, with a second record carrying
`12345678901234567890123`, was checked by `attest-ledger-core` 0.1.0's
`verify_chain`, reading lines exactly as `ledger::verify` does:

| verifier links | result |
|---|---|
| `serde_json` 1.0.151 | ok, 2 records |
| `serde_json` 1.0.145 | **"record 1: record_hash mismatch (content was altered)"**, on an unaltered chain |
| either, over the flat-string control chain | ok |

All three published 0.1.0 binaries write `e+22`, so they are zmij-era. The
consequence for the phrase "0.1.0's construction" is that, for a record
holding a non-integer number or an integer beyond 64 bits, the
construction is defined by those three binaries. It is not defined by
0.1.0's source. A rebuild of the same source that resolves a ryu-era
`serde_json` would report the record altered, and so would any future
formatter change. Integers within 64 bits and strings did not vary in
what was measured. Whether any live record is exposed is D-4.

### 3.5 Key sorting is not RFC 8785, and the family does not use RFC 8785

Against an RFC 8785 ordering and ECMAScript number output, the
canonical-keysort form differed on V06 (after `JSON.parse`), V07, V08
and V11. It agreed on V05 under zmij. statecraft-cli 113 B-2 defines the
family's canonical bytes as `canonical_keysort_json::to_canonical_string`
over a portability set (null, booleans, strings, integers within the
safe range, arrays and objects of the same), with keys in UTF-8 byte
order. Inside that set the numeric differences cannot arise. The key-order
difference of V11 remains. Nothing here proposes RFC 8785.

## 4. Behavior: the proposed addon contract

A proposal for agreement, not an approved design.

### 4.1 What this repository accepts from statecraft's 014 D-3

As it binds the addon, D-3 is accepted:

- item 1: foreign evidence is kept as its exact bytes, addressed by
  SHA-256 over them
- item 2: the ledger records only a typed reference
- item 3: no foreign object passes through `canonicalize` or
  `ledgerAppend`
- item 5: where the bytes live is 017 Part A's choice
- item 6: statecraft's chain keeps its construction and verifier
  permanently
- item 7: content-addressed bytes, not base64 inside a payload

Item 4, intake refusals, is statecraft's. This spec adds two measured
cautions to it (3.2): a napi `String` cannot carry invalid UTF-8, and a
default `TextDecoder` strips a BOM without saying so.

The packet's other option, an explicit opaque-byte encoding inside the
ledger, is not recommended. There are three reasons. It would make an
erased object break the chain (D-3 item 7). `append` reads the whole
`records.jsonl` on every call (`ledger.rs:123`), so embedded evidence
grows the cost of every later append. And a base64 field has
non-canonical spellings a strict decoder must refuse.

### 4.2 The addon's obligations

- **A-1. The existing functions do not change.** `canonicalize`,
  `ledgerAppend`, `ledgerVerify` and `ledgerAnchor` MUST give the same
  output as the published 0.1.0 binaries in every later version. A chain
  written by 0.1.0 MUST verify under every later version. No stored
  record is rewritten, re-hashed or migrated.
- **A-2. The construction is pinned.** `addon/governance-native/Cargo.lock`
  MUST be committed, and a golden test MUST pin the record hashes of a
  flat-string record and of a record holding `12345678901234567890123` as
  the 0.1.0 binaries write them. A change of float formatter then fails a
  pull request instead of failing a verification years later.
  **Added 2026-09-12 (D-3, D-4):** the historical verifier is preserved
  by digest, whatever D-4's production inventory later finds.
  `verifiers/governance-native-0.1.0.v1.json` MUST name each published
  0.1.0 platform binary by its npm tarball integrity and the SHA-256 of
  its `.node` file, and MUST mark the one statecraft deploys. A rebuild of
  0.1.0's source is not that verifier (3.4). No 0.1.0 package is
  unpublished.
- **A-3. A portable admission rule, additive.** Two new functions,
  `canonicalizePortable(json)` and `ledgerAppendPortable(stateDir,
  record)`. They MUST refuse, with an error naming the JSON pointer and a
  reason code, any input holding a duplicate member at any depth
  (`duplicate-member`), a number that is not an integer
  (`non-integer-number`), an integer outside -(2^53 - 1) through
  2^53 - 1 inclusive (`unsafe-integer`, D-5), or text that is not valid Unicode
  (`invalid-unicode`). For every input they admit, they MUST return
  exactly what `canonicalize` and `ledgerAppend` return, record hash
  included. That keeps one construction and one `ledgerVerify`, lets
  portable and legacy records share a chain, and makes this the rule
  statecraft-cli 113 B-2 already applies with the same crate.
- **A-4. The doc comments tell the truth.** `ledger.rs:118-119` and
  `canon.rs:5-7` MUST describe the parse, the key sort and the formatter
  dependence of 3.1 and 3.4.
- **A-5. No evidence store, and no verdicts.** The addon MUST NOT receive
  foreign evidence bytes or store them. It reports refusals and hashes.
  `integrity`, `signature`, `issuerTrust`, `subjectBinding` and policy
  outcomes belong to statecraft and statecraft-cli.

Expected results of A-3 over the vectors, as acceptance inputs:

The rule is judged on the literal as submitted. A parsed `Value` has
already turned V05's integer into a float, so the check needs the number
token (a strict visitor), not the `Value`.

| vectors | `*Portable` |
|---|---|
| V03, V04 | refuse `duplicate-member` |
| V05, V06, V07, V19, V20 | refuse `unsafe-integer` |
| V08, V09 | refuse `non-integer-number` |
| V17 | refuse `unsafe-integer` (D-5, decided 2026-09-12) |
| V12 | refuse `invalid-unicode` (D-5's decision names invalid Unicode) |
| V13, V15, V16 | refused, as today |
| V14 | not representable at a `String` seam (3.2) |
| V01, V02, V10, V11, V18, C01, C02, C03 | admitted, output identical to the lenient function |

### 4.3 Counterproposal to statecraft's narrower request

014 section 10.3 asks this repository to "refuse duplicate members in a
future major version of `canonicalize` and `ledgerAppend`, keep 0.1.0's
construction for historical chains, and document the normalization".
Agreed on the second and third. On the first, two changes are proposed.

1. **Scope.** Refusing duplicates alone leaves the integer collision
   (V19, V20 hold no duplicate) and the formatter dependence (3.4) in
   place. A-3 refuses the portability set's complement as well.
2. **Packaging.** Add new names in `governance-native` 0.2.0, a minor
   version, rather than changing the existing names in a major version.
   - statecraft pins exactly 0.1.0, and its 017 section 7 keeps 0.1.0's
     `ledgerVerify` for the archive.
   - Existing callers are not all under statecraft's new design:
     `backend/fleet/api.ts` passes `Record<string, unknown>` payloads
     while 014 D-6 keeps the fleet running unextended.
   - The construction does not change either way, so a major version buys
     only a forced migration for callers the rule does not concern. The
     cost is that the lenient names stay available; A-4's corrected doc
     comments are the mitigation.
   
   If statecraft prefers the major form, the rule is the same and only
   the names and version change (D-2).

**Decided 2026-09-12 (D-1, D-2).** Both as proposed: the stricter rule,
through additive `canonicalizePortable` and `ledgerAppendPortable` in
0.2.0, with the existing functions' behavior and hashes preserved. The
major form is not taken.

### 4.4 The reference is opaque to the addon

The addon does not interpret the typed reference. Statecraft's D-3 form
is `{type, schemaVersion, digestAlg: "sha-256", byteDigest, byteLength,
...}`. Rahi 041 B-3 (draft, unmerged `corpus/runtime-binding`) writes
`{type, digest: "sha256:<64 hex>", id}`. hqgit's design 02 R-2 separates
`digest_alg` from a bare hex digest. The ledger's own hashes use the
`sha256:` prefix. Choosing among these is statecraft's composition
agreement, not this seam's. The seam's only condition is 3.2's: a
reference stays byte-identical when its members are in the portability
set and its keys are in UTF-8 order (C02). With A-3, a reference outside
the set is refused. A reference with keys out of order (C03) is still
admitted and sorted. Refusing that too is D-7, decided no on 2026-09-12:
admitted reference input is not required to be in canonical spelling.

## 5. The regression inputs

`vectors/evidence-bytes.v1.json`, format
`statecrafting.evidence-bytes.vectors/v1`. Each vector carries
`bytesBase64`, `size` and `declaredDigest` (`sha256:<64 lowercase hex>`
over the decoded bytes), a `class` (`key-order`, `whitespace`,
`duplicate-key`, `large-number`, `number-spelling`, `escape-spelling`,
`invalid-i-json`, `encoding`, `parser-limit`, `control`), a `note`, and
for the two collision pairs a `pairWith`. Every vector the addon appends
must be a JSON object, because the probe reads a stored payload back by
position. V15, an array, is refused before that point. A future vector
that breaks the rule stops the probe instead of producing a result. The
probe reports four results
per vector: whether the bytes were kept, whether the declared digest
still holds over what was stored, what metadata the ledger derived, and
whether the chain verifies. It never folds those into one verdict.

For an original-byte store, which is statecraft's under D-3, the
expectation is simple: all 23 vectors store and read back byte-identical
under their declared digest, V12 to V16 included, because a store that
never parses has nothing to refuse. For this addon, the expectations are
section 3 today and section 4.2 once A-3 is built. The vectors are
offered to statecraft-cli's draft 132 as candidates for its negative set.

## 6. Out of scope

- Where evidence bytes live, their retention and their erasure:
  statecraft 016 and 017 Part A.
- Verdict dimensions, issuer enrolment and trust roots: statecraft 014
  section 10.2 and D-2.
- Adopting RFC 8785, or changing the family's canonical form.
- Any change to what `canonicalize`, `ledgerAppend`, `ledgerVerify` or
  `ledgerAnchor` return, and any re-hashing of a stored record.
- `kernel-native`. Its `model::canonical_bytes` hashes the app model
  through the same crate and the same `serde_json`, and whether its inputs
  can hold a float was not measured. That needs its own spec if it
  matters.
- The other three addons' `Cargo.lock` files. Pinning all four is a spec
  007 question; A-2 pins the one whose hashes are load-bearing.
- Publishing anything. A release is a tag, after approval and
  implementation, and no version is republished. Publishing 0.2.0 is
  distinct from implementing it and needs its own authorization.
- The permissive format declaration D-6 decides. It is a later spec,
  written against the rights holder's explicit grant.
- statecraft's read-only inventory of its production chain (D-4). It is
  verification work, not a prerequisite for A-2.

## 7. This repository's positions on sibling text

Each row is this repository's stance on text a sibling has already
written. None is a sibling's sign-off on this spec, which no sibling has
reviewed.

| sibling | position |
|---|---|
| statecraft 014 D-3 | **Accepted** as it binds the addon (4.1): items 1, 2, 3, 5, 6 and 7. Item 4 accepted with the two cautions of 3.2. |
| statecraft 014 section 10.3, the narrower request | **Counterproposed** (4.3): portability set plus duplicates, as additive names in 0.2.0. |
| statecraft 017 section 7 | **Accepted**, with one precision. "0.1.0's `ledgerVerify`" means the three published binaries listed in section 3, kept fetchable for as long as the archive is kept, not a rebuild of 0.1.0's source (3.4). |
| statecraft-cli 113 B-2 | **Adopted** as A-3's rule. D-5, decided 2026-09-12, fixes the boundary 113's prose leaves ambiguous at -(2^53 - 1) through 2^53 - 1, which is what `statecraft-journal`'s `MAX_SAFE_INTEGER` already enforces (statecraft-cli `main`, `f570b0a`). Correcting 113's "±2^53" is statecraft-cli's edit. |
| statecraft-cli 132 | **Offered**: the 23 vectors and 6 mutations (009 C-1, moved here). |
| spec-spine design note 04, section 4.7 | **Noted**: "Refuse bytes that are not the canonical serialization of their own parse" is stricter than A-3; D-7. |
| Rahi 041 B-3, hqgit 02 R-2 | **Not this seam's decision** (4.4). |

## 8. Open decisions

Each is stated so that a yes or a no is a complete answer. All seven were
answered by the repository owner on 2026-09-12. Each answer follows its
question; the questions stand as drafted.

- **D-1 (statecraft).** Does the admission rule refuse the portability
  set's complement as well as duplicate members? Recommended: yes (4.3).
  **Decided: yes.** Safer intake, without silently breaking legacy
  callers.
- **D-2 (statecraft, then this repository's owner).** Additive
  `canonicalizePortable` and `ledgerAppendPortable` in 0.2.0, rather than
  changed `canonicalize` and `ledgerAppend` in 1.0.0? Recommended: yes,
  additive. **Decided: yes, additive, in 0.2.0.** The existing functions'
  behavior and hashes are preserved. Publishing the new version is a
  separate act from implementing it.
- **D-3 (this repository's owner).** Commit
  `addon/governance-native/Cargo.lock` and add A-2's golden test?
  Recommended: yes. It is the only change here that protects existing
  records. **Decided: yes.**
- **D-4 (statecraft).** Does any of the production chain's records hold a
  non-integer number or an integer beyond 64 bits? If none does, A-2
  protects future records and rebuilds only. If one does, the published
  `linux-x64-gnu` or `linux-arm64-gnu` binary that wrote it is part of
  the archive's verifier and should be recorded beside the archive by
  sha256. **Decided: preserve the deployed published verifier by digest
  regardless of the answer** (A-2's addition). The read-only production
  inventory is verification work, not a prerequisite for protecting
  future builds, and a source tree tagged 0.1.0 alone is not sufficient
  as the historical verifier.
- **D-5 (this repository, with statecraft-cli).** Is 2^53 (V17) admitted?
  113 B-2 says "integers within `±2^53`" and also "outside the safe
  range", and JavaScript's safe range ends at 2^53 - 1. Recommended:
  refuse 2^53, matching `Number.isSafeInteger`, once statecraft-cli
  confirms what its implementation does. **Decided: no.** Portable
  integers are -(2^53 - 1) through 2^53 - 1. Duplicate members,
  non-integer number tokens and invalid Unicode are refused. The boundary
  is resolved explicitly here rather than left waiting on 113's prose.
- **D-6 (statecraft; 009 F-4, moved here).** Is a permissive declaration
  of the ledger's on-disk format wanted: layout, genesis seed, chain id,
  unsigned-anchor rule, with conformance vectors? If so, where does it
  live? Recommended: yes, as a document plus vectors, since statecraft's
  016 section 14 says its own repository cannot host a permissive
  verifier. **Decided: yes, prepared in this repository's existing
  Apache-2.0 root, with statecraft-cli as its consumer.** Current file
  licenses are preserved. Any new grant is recorded explicitly by the
  rights holder, and no AGPL-3.0 code is relicensed by implication. It is
  not permission to translate protected source wholesale. The work is
  outside this spec's approved scope (section 6).
- **D-7 (this repository's owner).** Should admission also refuse bytes
  that differ from their own canonical serialization (C03, V01, V02)?
  Recommended: not now. No consumer submits reference bytes whose
  identity it then claims, and statecraft builds its references in code.
  **Decided: no.** Canonical spelling of admitted reference input is not
  required. Reference normalization and an opaque byte store are
  different seams: opaque storage round-trips bytes, and typed intake
  refuses malformed input.

## 9. Acceptance

If this spec is approved, it is satisfied by:

1. The probe's report body over the committed vectors, for a build of
   the changed crate, equals the report from the published
   `@statecrafting/governance-native-<host>@0.1.0` binary on the same
   host (A-1). This holds today for the unchanged source (section 3).
2. A chain written by a published 0.1.0 binary, including a record
   holding `12345678901234567890123`, verifies under the new build, and a
   golden test pins both record hashes (A-1, A-2).
3. `addon/governance-native/Cargo.lock` is committed. The golden test
   fails on a scratch copy pinned to `serde_json = "=1.0.145"`: the
   negative case of 3.4, run once and recorded (A-2).
4. `canonicalizePortable` and `ledgerAppendPortable` refuse exactly the
   vectors 4.2's table lists, with the named reason codes. For every
   admitted vector they return output byte-identical to `canonicalize`
   and `ledgerAppend`, record hash included (A-3).
5. The two doc comments are corrected (A-4).
6. `cargo test --no-default-features` passes with the existing 22 tests
   unedited. `make addons`, `make gate` and
   `make typecheck test licenses` pass, and the AGPL-3.0 tier is
   unchanged.
7. The crate and npm manifests read 0.2.0. Publishing it is a tag, a
   separate act with its own authorization (D-2). No version is
   republished, and the JSON shape of every existing function is
   unchanged.
8. `verifiers/governance-native-0.1.0.v1.json` names all three published
   0.1.0 binaries. Its integrity values equal the registry's, its
   `.node` digests equal section 3's, and it marks the deployed one
   (A-2's addition, D-4).

Items 7 and 8 replace the drafted item 7, "The release is
`governance-native` 0.2.0 by tag", as D-2 and D-4's answers require.

A `## Verification` block is added with the implementation, when each of
its commands exists.

## 10. Decisions recorded

- **2026-09-12. Why this is its own draft.** Evidence bytes are on
  statecraft's intake path; 009's extraction is on no launch path. The
  repository owner chose a separate draft over a section of 009, so each
  can be approved or declined alone.
- **2026-09-12. Why the addon stores no evidence.** The first sketch for
  this spec had an `evidencePut` and `evidenceGet` pair writing
  content-addressed files under the ledger's `stateDir`. statecraft's
  D-3, written the same day, puts the bytes in 017 Part A's store and
  says they cannot be a file on a cell volume. An addon store would be a
  second home for the same bytes, so the sketch was dropped before it
  reached this file.
- **2026-09-12. Why the probe asserts nothing.** It characterizes shipped
  binaries, including published ones this repository cannot change. An
  assertion would make a finding look like a failure of the probe.
  Acceptance tests arrive with the implementation, in spec 005's crate,
  through the `extends` edge.
- **2026-09-12. Why the float finding is not "fixed" by switching the
  formatter back.** Every published 0.1.0 binary is zmij-era. Moving to a
  ryu-era `serde_json` would break the records those binaries wrote. The
  historical construction is the one already shipped, and A-2 pins that
  one.
- **2026-09-12. Ratified on the repository owner's instruction, scoped.**
  This spec was authored by an agent session. The repository owner
  answered D-1 to D-7 and instructed that a scoped approval be recorded
  before implementation. An agent session then set `status: approved` on
  that instruction. The harness rule is that ratification is a human act
  and an agent never flips a spec it wrote on its own authority. It is
  not weakened here, and it is why the exception is written down, as
  spec 008's was. The approval covers A-1 to A-5 and section 9's
  acceptance as answered. It does not cover:
  - tagging or publishing 0.2.0
  - D-6's format declaration
  - statecraft's production inventory (D-4)
  - spec 009, which the same owner deferred the same day
  - any fleet change

  Merging PR #20 is a separate publishing action, taken when authorized.
  Implementation proceeds on this spec's existing branch without waiting
  for that merge. An earlier refusal of an automated merge is not a
  reason to loosen any permission rule.
- **2026-09-12. Why the deployed verifier is `linux-x64-gnu`.**
  statecraft's lockfile (`main` `9658e29`) pins all three 0.1.0 platform
  packages by the integrity values the npm registry reports.
  Its cluster definition (`infra/hetzner/cluster.yaml`) runs `cx23` and
  `cx43` instances, which are x86-64. The linux-arm64 and darwin-arm64
  binaries are recorded too, because a rebuild on another host or a
  developer's verification may use them.
