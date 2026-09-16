# Implementation Plan: Schema-Parity Walker — Rebuild for Hand-Rolled Validators

**Spec**: [spec.md](./spec.md)
**Feature**: `125-schema-parity-walker-rebuild`
**Date**: 2026-05-01
**Branch**: `125-schema-parity-walker-rebuild`

## Summary

Restore `make ci-schema-parity` after commit `b6859d3` removed zod from
`api/knowledge/extractionOutput.ts` for Encore parser stability.
Author a plain-data `extractionOutputDescriptor: SchemaNode` next to
the existing `Validator` class; teach
`tools/oap/schema-parity-check/index.mjs` to walk descriptors instead of
zod for the knowledge schema; ship an in-file vitest case asserting
the descriptor matches what `Validator` actually checks for a
representative payload pair. The Rust mirror at
`crates/factory-contracts/src/knowledge.rs` is untouched. The descriptor
pattern becomes the recommended shape for any future Rust↔TS parity
surface that cannot use zod (Encore parser invariant).

## Sequencing

| Phase | Focus | Spec sections |
|-------|-------|---------------|
| **0** | Foundations: define the `SchemaNode` discriminated union type that the walker will accept; pin the type either inside `extractionOutput.ts` or in a new `tools/oap/schema-parity-check/schema-node.ts` consumed by both | §3.1, §3.2 |
| **1** | Author `extractionOutputDescriptor` — the plain-data tree that mirrors what `Validator` checks; place it next to the validator in `extractionOutput.ts`; export it | §3.1 |
| **2** | In-file consistency test: vitest case asserting the descriptor matches the validator (every required field trips the validator when removed; non-required does not; enums reject out-of-set values) | §3.3 |
| **3** | Walker rewrite: split `tools/oap/schema-parity-check/index.mjs` into a dispatcher that picks descriptor walker for the knowledge schema and zod walker for the (still-zod) provenance + stakeholder-doc schemas; add `walkDescriptor(node)` returning the same fingerprint shape `walkType(zod)` already produces | §3.2 |
| **4** | CI integration: re-run `make ci-schema-parity` (already wired by spec 120) and confirm exit 0; verify the descriptor↔Rust drift case fails with a clear diff message | §5 A-1, A-3 |
| **5** | Acceptance closure: A-1..A-5 verified; spec 125 frontmatter flips to `status: approved` / `implementation: complete`; `make ci` green | §5 |

Phases 0–3 are sequential within `extractionOutput.ts` and the parity
tool; Phase 2 (the in-file test) blocks Phase 3 because the test
catches the descriptor↔validator drift the walker rewrite depends on.
Phase 4 is verification. Phase 5 is closure.

## Approach decisions

- **Descriptor lives next to the validator, not in a shared package.**
  Spec §6 non-goal calls this out. Co-location is the simplest drift
  guarantee — the in-file test makes the descriptor-validator
  contract local. Generalising into a shared schema-DSL package is
  premature.
- **Hand-written descriptor, not auto-derived.** Spec §7 OQ-1 default.
  The `Validator` class is hand-coded; a hand-coded descriptor is its
  natural pair. Auto-derivation pulls in framework dependencies (or
  AST tooling) that the project doesn't otherwise need.
- **Walker dispatch on node shape.** The descriptor walker recognises
  `SchemaNode` by the `kind` field (string literal union); the zod
  walker recognises `ZodTypeAny` by `_def.type`. The dispatcher checks
  for `kind` first; if absent, falls through to zod. This lets specs
  121 / 122 keep zod walking until their TS mirrors are written, at
  which point they migrate to descriptors and zod walker dies.
- **Fingerprint shape unchanged.** The walker output is the same
  `{kind, fields, ...}` tree the Rust side produces; only the input
  changes. The Rust side does NOT need to change.
- **Zod removal must NOT regress to Encore parser breakage.** Spec §5
  A-5 makes this an acceptance gate. The descriptor file imports zero
  zod symbols; Encore parser walks `extractionOutput.ts` and never
  reaches a hostile `.d.cts`.
- **Single PR for the change.** Spec §4 prescribes a single PR. The
  descriptor + the test + the walker change land together so the gate
  flips green in one commit.
- **No retroactive parity checks.** Spec 124's `factory_runs` table is
  not parity-checked (no Rust mirror); spec 123's envelope types are
  ts-rs–driven (different mechanism). This spec does not extend the
  parity surface; it restores the existing one.
- **Drift between descriptor and validator is caught locally, drift
  between descriptor and Rust is caught in CI.** Two separate gates,
  same shape (asserts on shape mismatch). Belt and suspenders.

## Risks

- **Descriptor drifts from validator without anyone noticing.** The
  in-file vitest case (Phase 2) is the mitigation. It exercises
  representative valid + invalid payloads against both the validator
  and the descriptor; if the descriptor says a field is required and
  the validator doesn't enforce it, the test fails.
- **Walker rewrite breaks the still-zod provenance / stakeholder-doc
  paths.** Spec §3.2 keeps the zod walker alive behind the dispatcher;
  Phase 3's test suite exercises both paths against fixtures.
  Mitigation: do not delete the zod walker until specs 121 §8 and 122
  land their TS mirrors as descriptors.
- **Encore parser regression.** If anyone re-introduces a zod import
  into `extractionOutput.ts`, the original crash returns. Mitigation:
  A-5 grep gate (`! rg "from \"zod" platform/services/statecraft/api/knowledge/extractionOutput.ts`).
- **Hidden enum values.** Some `Validator` checks accept enum
  membership via a private helper. The descriptor must list those
  values explicitly. Mitigation: Phase 2's test enumerates the
  `kind` enum (`text | pdf | image`) and any other enum in the file;
  if the descriptor lists fewer values than the validator accepts,
  the consistency test fails.
- **Schema-parity tool's other consumers.** If anything else imports
  `tools/oap/schema-parity-check/index.mjs`, the dispatcher refactor
  could break it. Mitigation: `rg "schema-parity-check" .` to list
  importers; the only caller today is the Makefile target. If that
  changes, this risk re-evaluates.
- **Future parity surfaces fork the dispatcher.** Once specs 121 / 122
  migrate, the zod walker can be deleted. Until then, the dispatcher
  carries dead-ish code. Mitigation: comment on the dispatcher
  explaining the migration timeline; track the deletion as a
  follow-up TODO referencing spec 125.

## References

- Spec: [`./spec.md`](./spec.md)
- Tasks: [`./tasks.md`](./tasks.md)
- Pattern reuse:
  - Spec 120 (`factory-extraction-stage`) — origin of the parity check
    (FR-003, FR-004); the Rust-side fingerprint emission this spec
    leaves untouched
  - Spec 121 (`claim-provenance-enforcement`) — second parity surface;
    will migrate to descriptors when its §8 TS mirror lands
  - Spec 122 (`stakeholder-doc-inversion`) — third parity surface;
    same migration story
- Existing primitives this spec touches:
  - `platform/services/statecraft/api/knowledge/extractionOutput.ts`
    — the validator that gains the descriptor
  - `tools/oap/schema-parity-check/index.mjs` — the walker getting
    dispatched
  - `crates/factory-contracts/src/knowledge.rs` — Rust mirror
    (untouched; reference only)
- Cross-crate dependencies: none. This spec is a statecraft + tools
  change; no Rust source moves.
- Related specs: 120 (origin of parity check), 121 (second parity
  surface), 122 (third parity surface), 123 (envelope types — out of
  scope but referenced in spec §3.2 for the descriptor pattern's
  future-fit story)
