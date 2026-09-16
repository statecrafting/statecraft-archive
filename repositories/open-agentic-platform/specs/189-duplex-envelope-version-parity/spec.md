---
id: "189-duplex-envelope-version-parity"
slug: duplex-envelope-version-parity
title: "Duplex envelope schema-version parity — a cross-language tripwire for ENVELOPE_SCHEMA_VERSION"
status: approved
implementation: complete
owner: bart
created: "2026-05-29"
approved: "2026-05-29"
kind: governance
domain: tooling
risk: low
depends_on:
  - "087-unified-workspace-architecture"  # unified-workspace-architecture (FR-SYNC-003 — every envelope carries meta.v)
  - "119-project-as-unit-of-governance"  # project-as-unit-of-governance (collapsed workspace→org; bumped the duplex wire to v2)
  - "120-factory-extraction-stage"  # factory-extraction-stage (originating spec for the schema-parity tool)
  - "125-schema-parity-walker-rebuild"  # schema-parity-walker-rebuild (the walker this spec extends)
  - "183-opc-boot-precondition-gate"  # opc-boot-precondition-gate (whose boot gate surfaced the silent v1↔v2 skew)
code_aliases:
  - "ENVELOPE_VERSION_PARITY"
establishes:
  - unit: { kind: file, path: tools/oap/schema-parity-check/envelope-version.mjs }
  - unit: { kind: file, path: tools/oap/schema-parity-check/envelope-version.test.mjs }
extends:
  - spec: "120-factory-extraction-stage"
    nature: additive
    unit: { kind: file, path: tools/oap/schema-parity-check/index.mjs }
  - spec: "034-featuregraph-registry-scanner-fix"
    nature: additive
    unit: { kind: file, path: crates/featuregraph/tests/golden/features_graph.json }
summary: >
  Adds a scalar-constant parity check to the schema-parity walker (spec 125)
  that fails CI when the desktop's `ENVELOPE_SCHEMA_VERSION`
  (`product/apps/opc/src-tauri/src/commands/sync_client.rs`) does not equal the
  statecraft server's (`platform/services/statecraft/api/sync/types.ts`). The
  protocol-wide duplex envelope version is the one number both ends of the
  WebSocket must agree on, yet — unlike the per-kind mirror constants, which
  are kept honest by Rust↔TS fingerprint comparison — it had no automated
  parity check. It drifted silently when spec 119 moved the wire to v2 while
  the desktop constant stayed at 1, and stayed invisible until spec 183's boot
  gate turned the dropped `sync.hello` into a hard block. This spec closes the
  gap with the cheapest possible mechanism: a source-read scalar comparison
  inside the existing walker, with no new build step and no runtime import.
  Implementing it surfaced that the walker itself had been silently
  non-functional since the spec-spine crate split (#176) and the
  `build/`→`.derived/` migration left two stale path assumptions in
  `index.mjs`; this spec repairs those as a precondition (§3.0), restoring the
  whole gate — which is itself the reason the drift went uncaught.
---

# 189 — Duplex envelope schema-version parity

## 1. Problem statement

The duplex stream between the OPC desktop and statecraft frames every
message in an envelope whose `meta.v` MUST equal a single protocol-wide
constant, `ENVELOPE_SCHEMA_VERSION`, declared independently on each side:

- **desktop (Rust):** `product/apps/opc/src-tauri/src/commands/sync_client.rs`
  — `pub const ENVELOPE_SCHEMA_VERSION: u8 = 2;`
- **server (TS):** `platform/services/statecraft/api/sync/types.ts`
  — `export const ENVELOPE_SCHEMA_VERSION: EnvelopeSchemaVersion = 2;`

Both sides enforce **strict equality** at the boundary
(`is_server_envelope` on the desktop, `isClientEnvelope` on the server):
a frame whose `meta.v` differs is rejected as unknown/invalid rather than
best-effort decoded. That is the correct wire discipline — but it means a
**one-line skew between the two constants silently breaks the entire
duplex** in both directions.

That skew is exactly what happened. Spec 119 (workspace→org session-key
collapse) bumped the server wire to **v2**; the desktop migrated the
envelope *struct shapes* (`ServerMeta.org_cursor` / `org_id`) but the
`ENVELOPE_SCHEMA_VERSION` constant was left at **1**. Every server frame —
including the `sync.hello` handshake — failed the desktop's version guard
and was dropped. Nothing surfaced it: pre-spec-183 a dropped `sync.hello`
was a logged warning the cockpit ignored. When spec 183 made `sync.hello`
receipt a hard boot-gate precondition (FR-T2(b)), the latent skew became a
permanent "Preparing OPC" block. Spec 183's PR (#257) corrected the
constant; **this spec prevents the class of regression from recurring.**

### Why this slipped through

The schema-parity walker (specs 120 / 125) already keeps Rust and TS in
lock-step for the *structural* contracts — knowledge, provenance,
stakeholder-doc — by comparing fingerprints emitted from
`crates/factory-contracts`. The per-kind envelope contract versions
(`AGENT_CATALOG_ENVELOPE_VERSION`, `FACTORY_RUN_ENVELOPE_VERSION`, …) are
likewise mirrored and exercised by tests on both sides. The
**protocol-wide** `ENVELOPE_SCHEMA_VERSION` is the conspicuous exception:
it is the most load-bearing scalar on the wire, and it was the one number
with no cross-language tripwire. `git grep` answers "are the two equal?"
but nothing in CI asks.

## 2. Decision

Add a **scalar-constant parity check** to the existing schema-parity
walker (`tools/oap/schema-parity-check/index.mjs`). The check reads
`ENVELOPE_SCHEMA_VERSION` from both source files and fails the
`ci-schema-parity` gate when they differ.

Two implementations were considered.

- **A. Structural-fingerprint pattern (reuse the cargo-test machinery).**
  Emit a Rust fingerprint `{ version }` from a `cargo test` and compare it
  to a TS-imported value, mirroring knowledge/provenance/stakeholder-doc.
  **Rejected.** The constant lives in the desktop crate (`opc`), not in
  `crates/factory-contracts`, so this would compile the large Tauri crate
  inside the parity job purely to read one integer — minutes of CI for a
  scalar — and would add a new cargo invocation to the `ci-schema-parity`
  Makefile target (widening Makefile co-authority for no benefit).

- **B. Source-read scalar comparison (accepted).** The value is a plain
  integer literal in a `const` declaration on each side. Read both files,
  extract the integer with a strict anchored regex, compare. No build
  step, no runtime import, no new Makefile target — the check is a
  self-contained block inside the walker that the existing
  `bun run …/index.mjs` invocation already executes.

Source-reading (rather than importing the TS module to evaluate the
constant) is deliberate and consistent with spec 125's design ethos: the
walker is dependency-free and stable under Encore.ts's TS parser.
`types.ts` imports Encore stream types, so importing it from a bare `bun`
runtime is fragile; a regex over the declaration is maximally stable and
has no transitive-import surface. The brittleness cost — a rename of the
constant — is eliminated by failing **loud** (exit 2) when the anchored
pattern does not match exactly once on either side, so a rename can never
silently pass the gate.

## 3. Implementation

### 3.0 Precondition — repair the walker's path resolution

Implementing §3.1 surfaced that the schema-parity walker has been
**silently non-functional**, which is the deeper reason the envelope
version could drift uncaught: the gate that exists to catch Rust↔TS drift
was resolving every path to the wrong place and exiting before it
compared anything. Two stale assumptions in `index.mjs`, each from a
repo-wide move the walker was not updated for:

1. **Repo-root climb.** `REPO_ROOT = path.resolve(SCRIPT_DIR, "..", "..")`
   predates commit #176 ("cut-d cleanup: spec-spine crate split"), which
   relocated this tool from `tools/schema-parity-check/` to
   `tools/oap/schema-parity-check/` (one level deeper) without extending
   the climb. Since then `REPO_ROOT` has resolved to `…/tools`, so every
   `path.join(REPO_ROOT, …)` pointed under `tools/`. Fix: climb `..` three
   times.
2. **Fingerprint directory.** The walker reads Rust fingerprints from
   `build/schema-parity/…`, but the Rust emitters
   (`crates/factory-contracts`) write to `.derived/schema-parity/…` after
   the constitution-Principle-II `build/`→`.derived/` migration. Fix:
   read from `.derived/schema-parity/…`.

Either bug alone makes the walker `exit 2` ("rust fingerprint not found")
before any comparison. With both fixed the gate runs green end-to-end:
`knowledge` parity passes (no accumulated drift), provenance and
stakeholder-doc remain in their spec-121/122 reserved mode, and §3.1's
envelope check passes.

To stop a future relocation from re-darkening the gate the same way, the
walker gains a **loud root guard**: immediately after computing
`REPO_ROOT` it asserts that known repo subtrees
(`crates/factory-contracts`, `platform/services/statecraft`) exist under
it, and `exit 2`s with a "REPO_ROOT does not resolve to the repo root"
diagnostic otherwise — instead of the misleading downstream
"fingerprint not found".

### 3.1 Scalar-parity module

A new dependency-free ES module
`tools/oap/schema-parity-check/envelope-version.mjs` exports pure
functions so the logic is unit-testable without running the full walker:

- `extractEnvelopeVersion(source, label)` — returns the integer matched by
  the anchored pattern for `ENVELOPE_SCHEMA_VERSION` in `source`. Throws a
  labelled error when the constant is absent or matches more than once
  (rename / duplication guard).
- `compareEnvelopeVersions({ desktop, server })` — returns
  `{ ok, desktop, server }`.

The desktop pattern matches a Rust `pub const ENVELOPE_SCHEMA_VERSION: <int-type> = <N>;`;
the server pattern matches a TS `export const ENVELOPE_SCHEMA_VERSION<optional :Type> = <N>;`.
Both anchor on the full declaration so a `type EnvelopeSchemaVersion = 2`
alias or a comment mention is never mistaken for the value.

### 3.2 Walker wiring

`index.mjs` gains an **envelope-version block run first**, before the
structural-fingerprint checks. It is independent of the
factory-contracts fingerprints and of the statecraft TS imports, so it
reports even when an unrelated structural check would later error. On
mismatch it exits `1` with a diagnostic naming both files and both
values plus the remediation ("bump the desktop constant to match the
server, then rebuild OPC"); on a missing/ambiguous constant it exits `2`.
The block carries a `// Spec: specs/189-…/spec.md` annotation.

### 3.3 Unit test

`tools/oap/schema-parity-check/envelope-version.test.mjs` (node test
runner, matching `walk-descriptor.test.mjs`) covers: equal versions pass;
unequal versions fail with both values surfaced; a Rust `u8`/`u16` type
annotation is accepted; the TS `type` alias line is **not** mistaken for
the `const`; absent and duplicated constants throw.

### 3.4 Subjects (read, not governed)

The check **reads** two files it does not author or modify; they remain
governed by their own specs and are named here for traceability:

- `product/apps/opc/src-tauri/src/commands/sync_client.rs` — desktop
  envelope version (spec 183 refines; spec 110 establishes).
- `platform/services/statecraft/api/sync/types.ts` — server envelope
  version (spec 087 / spec 119).

This spec does not change either file; it only asserts they agree.

## 4. Acceptance

- **AC-0.** `make ci-schema-parity` runs to completion and exits `0` —
  the path-resolution repair (§3.0) restores the gate. Before this spec
  the walker `exit 2`s on a wrong-rooted "fingerprint not found"; after
  it, the `knowledge` parity line reports `OK` and the reserved
  provenance/stakeholder surfaces record their fingerprints.
- **AC-0b.** A relocation or mis-resolution of `REPO_ROOT` `exit 2`s with
  the explicit "REPO_ROOT does not resolve to the repo root" guard
  diagnostic, not a downstream "fingerprint not found".
- **AC-1.** With the two constants equal (the post-#257 `main` state),
  `make ci-schema-parity` prints an `envelope-version OK (v=N)` line and
  the gate passes.
- **AC-2.** Temporarily setting the desktop constant to a value different
  from the server's makes `make ci-schema-parity` exit non-zero with a
  diagnostic naming both files and both versions. (Demonstrated by the
  unit test; need not be committed as a fixture skew.)
- **AC-3.** Renaming or removing `ENVELOPE_SCHEMA_VERSION` on either side
  makes the check exit `2` (loud failure), never a silent pass.
- **AC-4.** The check adds **no** new cargo build to `ci-schema-parity`
  and **no** new CI workflow step — it runs inside the existing
  `bun run tools/oap/schema-parity-check/index.mjs`.
- **AC-5.** `tools/oap/schema-parity-check/envelope-version.test.mjs`
  passes under the node test runner.

## 5. Non-goals (binding)

- **No generalisation to all scalar constants.** This spec adds parity
  for the one protocol-wide envelope version. The per-kind mirror
  constants keep their existing test-based enforcement; a future spec may
  fold them into the scalar-parity path if it proves its weight.
- **No runtime version negotiation.** The wire stays strict-equality
  (spec 087 FR-SYNC-003). This is a build-time tripwire, not a
  compatibility shim.
- **No change to the envelope version itself.** v2 is correct as of #257;
  this spec only guards the two declarations against future drift.

## 6. Cross-references

- Spec 125 — schema-parity walker this extends; `index.mjs` is its
  current home.
- Spec 120 — originating spec for the parity tool (the `extends:` anchor).
- Spec 119 — moved the wire to v2; the drift this spec prevents originated
  in the desktop's lagging mirror of that bump.
- Spec 183 — boot precondition gate; FR-T2(b) is what made the silent
  skew observable. This spec is its named follow-up.
- Spec 087 — FR-SYNC-003, the strict-equality envelope-version invariant.
