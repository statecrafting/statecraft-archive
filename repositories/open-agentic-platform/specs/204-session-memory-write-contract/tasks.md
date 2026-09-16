# Tasks: Session-Memory Write Contract (spec 204)

Task ids are grouped by the PR that lands them (see `plan.md` for the PR
decomposition and the packaging decision).

## PR-A: shared carrier-gate + repoint overrideGate (FR-001 foundation)

- T-A1 Create `product/packages/carrier-gate` (`@opc/carrier-gate`),
  zero-dependency, authored as plain ESM JavaScript (`rules.js`,
  `fixture.js`, `index.js`) with a hand-written `index.d.ts` for consumer
  types. NOT a TypeScript-to-`dist` package: the spike proved a raw `.ts`
  entry is not Node-loadable in the Encore runtime, so the leaf ships `.js`
  directly (plan.md Decision 1). `oap.spec = "204-session-memory-write-contract"`.
- T-A2 Port the carrier + secret + UTF-8 rules verbatim from `overrideGate.ts`
  into `carrier-gate/src/rules.js` (regexes byte-identical); export
  `runCarrierGate(content)` and the granular predicates (`checkUtf8`,
  `checkCarriers`, `checkSecrets`). Preserve every `ruleId` string.
- T-A3 Add `carrier-gate/src/fixture.js` exporting `CARRIER_FIXTURE`: at
  least one `{ ruleId, label, sample }` per carrier/secret/utf8 rule (two
  for zero-width/bidi and for the token shape) plus `CLEAN_FIXTURE` negative
  samples. This is the shared AC-1 fixture.
- T-A4 Unit-test the package against `CARRIER_FIXTURE` / `CLEAN_FIXTURE`
  (`rules.test.ts`).
- T-A5 Repoint `overrideGate.ts` to compose the shared `checkUtf8` /
  `checkCarriers` / `checkSecrets` around its local `size-ceiling` +
  `kind-stability` checks; keep declaration-order and every `ruleId`. Keep
  `overrideGate.test.ts` green unchanged.
- T-A6 Add the `file:` dep to statecraft `package.json` + refresh
  `package-lock.json` (npm symlink, `"link": true`). The manifest + lock
  change is the mechanical FR-001 wiring; it rides a `Spec-Drift-Waiver`
  (plan.md Coupling graph changes).
- T-A7 Amend spec 198 (in-body delegation record + `amended` /
  `amendment_record`) and add spec 204 `establishes: carrier-gate` +
  `refines: overrideGate.ts` + `amends: 198` edges (promote the analog
  reference).
- T-A8 Verify the Encore boundary locally: `node` runtime-loads the package,
  `overrideGate` vitest green (23), carrier-gate vitest green (19), tsc clean
  in both, `encore check` builds/starts cleanly.

## PR-A2: carrier-gate CI/CD coverage (follow-on to PR-A)

- T-A2-1 Extend ci.yml `statecraft` / `statecraft_encore` path filters to
  include `product/packages/carrier-gate/**` so `overrideGate.test.ts` runs
  when the shared rules change; handle the workflow-section coupling.
- T-A2-2 Make `@opc/carrier-gate`'s own `vitest` / `tsc` run in CI (the AC-1
  fixture proof is otherwise CI-dark, a systemic gap shared with
  session-memory).

## PR-B: session-memory write gate (FR-001 on the memory surface, AC-1)

- T-B1 Add `@opc/carrier-gate` as a `workspace:*` dep of session-memory.
- T-B2 Compose a memory write gate (carrier core + memory-specific ceiling)
  and wire it into `tools/store.ts` / `storage.store` and the harvested
  persistence path; fail-closed with the attributable `ruleId`.
- T-B3 Parity test: session-memory refuses every `CARRIER_FIXTURE` sample
  the substrate gate refuses (AC-1).

## PR-C: provenance + trust classes (FR-002, FR-003 schema, AC-2)

- T-C1 `types.ts`: add `ActorKind`, `TrustClass`; extend `MemoryEntry`,
  `StoreMemoryInput` with provenance + trust fields.
- T-C2 Migration v2 (additive): `actor_kind`, `origin_session_id`,
  `source_attribution`, `content_hash`, `trust_class` columns + indexes;
  backfill existing rows.
- T-C3 `storage.store` stamps provenance + sha256 content hash + default
  `machine-harvested`; `rowToEntry` maps the new columns.
- T-C4 MCP query/list expose provenance + trust class (AC-2).

## PR-D: promotion boundary + trust-weighted decay (FR-003, FR-004, AC-3/AC-4)

- T-D1 `getPromotionCandidates` / `runPromotion`: cap machine-harvested
  promotion below the `long-term` boundary; permanent/long-term require a
  human trust class (AC-3).
- T-D2 Trust-weighted decay sweep: demote/expire unaccessed
  machine-harvested entries on a configurable horizon; exempt `verified`
  (AC-4).

## PR-E: no-self-ingestion + segmentation/quarantine (FR-005, FR-006, AC-5)

- T-E1 Force `machine-harvested` for agent/harvester writes; no automated
  re-classification path (FR-005).
- T-E2 Storage-layer cross-project read refusal; record origin-session
  segmentation (FR-006).
- T-E3 Enumerate-by-session + bulk-quarantine; exclude quarantined entries
  from all reads (AC-5).

## PR-F: lifecycle flip + golden regen

- T-F1 Verify all claimed paths exist; flip spec 204 `draft` to `approved`,
  `pending` to `complete`.
- T-F2 Regen featuregraph golden (`UPDATE_GOLDEN=1`), spec registry, and
  codebase index; commit the refreshed shards.
