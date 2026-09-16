# Implementation Plan: Session-Memory Write Contract (spec 204)

> Companion to `spec.md`. This plan refines the sketch FRs into an
> implementable, coupling-clean, multi-PR sequence and records the one
> decision the spec explicitly deferred to planning: the shared-rules
> packaging home.

## Decision 1: shared carrier-rule packaging (the spec's designated first decision)

FR-001 requires the carrier-class rule set to be "shared with, not copied
from, `overrideGate.ts`" (spec 198). The two consumers sit in disjoint
package trees:

- `overrideGate.ts` lives in **statecraft** (`platform/services/statecraft/`),
  an Encore.ts service on **npm**, deliberately excluded from the `product/`
  pnpm workspace.
- The session-memory write path lives in **`product/packages/session-memory`**,
  inside the `product/` pnpm workspace.

There is no in-tree precedent for statecraft consuming a `product/` package.
Three options were weighed (fixture-parity only; shared package now with a
later repoint; true single source now). The chosen resolution is **true
single source now**:

**Create `product/packages/carrier-gate` (`@opc/carrier-gate`)** as the one
canonical home for the carrier-class + secret + UTF-8 rule set, and route
**both** consumers through it.

- The package is **zero-dependency** and **authored as plain ESM JavaScript**
  (`rules.js`, `fixture.js`, `index.js`) with a hand-written `index.d.ts` for
  consumer types. It is NOT a TypeScript package built to `dist/`. The spike
  in PR-A proved why: Encore installs and `import`s node_modules dependencies
  at runtime, and a raw `.ts` entry point is not Node-loadable in that
  runtime (verified: `node` refuses to import the `.ts` source). Shipping
  `.js` gives one canonical rule set that loads unchanged in the Encore
  runtime, the pnpm workspace (vitest/tsc), and plain Node, with no build
  step and no committed `dist` (which is globally gitignored anyway).
- **session-memory** consumes it as a normal workspace dependency
  (`"@opc/carrier-gate": "workspace:*"`).
- **statecraft** consumes it via a relative `file:` dep
  (`"@opc/carrier-gate": "file:../../../product/packages/carrier-gate"`);
  npm symlinks the package and `overrideGate.ts` imports the shared rules.
  Because the entry is already `.js`, no build is required at install time.

### Scope of the shared set

`@opc/carrier-gate` owns exactly the rules FR-001 names as carrier classes,
plus the secret + UTF-8 shapes overrideGate already groups with them:

- `gate.utf8` (lone surrogates)
- `gate.carrier.zero-width-bidi`, `gate.carrier.html-comment`,
  `gate.carrier.data-uri`, `gate.carrier.encoded-blob`,
  `gate.carrier.ansi-escape`
- `gate.secret.pem`, `gate.secret.token`, `gate.secret.jwt`

It exports pure functions returning the same `{ ok } | { ok, ruleId, detail }`
verdict shape, and a `CARRIER_FIXTURE` (the shared fixture AC-1 requires).

**Not shared** (they are consumer-specific policy, not carrier classes, and
FR-001 does not name them): `gate.size-ceiling` (the substrate's 256 KiB
`user_body` ceiling; memory picks its own ceiling) and `gate.kind-stability`
(the substrate's structured-kind YAML/JSON parse check, which has no analog
for free-text memory content). Each consumer keeps its own ceiling and any
consumer-specific checks and composes them around the shared carrier core.

## Coupling graph changes

- `overrideGate.ts` / `overrideGate.test.ts` are `establishes:`-owned by
  spec **198** (approved/complete). Repointing them is a genuine refinement
  of 198's implementation, so **spec 198 is amended** (in-body record) to
  note the carrier rules now delegate to `@opc/carrier-gate`, and **spec 204
  adds a `refines:` edge** on `overrideGate.ts` (aspect:
  `shared-carrier-rules`). Editing both spec.md files keeps the coupling gate
  satisfied whichever authority it demands.
- Spec 204 **`establishes:`** the new `product/packages/carrier-gate/**`
  paths (it brings them into existence).
- The `references: { role: analog }` entry for `overrideGate.ts` is promoted
  to a `refines:` edge (it is no longer merely an analog; 204 now shapes it).
- The existing `extends: 034` featuregraph-golden edge and the three
  `refines:` edges on session-memory files are retained.
- `platform/services/statecraft/package.json` + `package-lock.json` change
  only to add the `@opc/carrier-gate` `file:` dependency (the mechanical
  FR-001 wiring). They are co-owned by specs 116/160, not 204, and adding a
  third-party-style dependency to a generated lockfile is not a spec-authored
  edit. PR-A carries these under a `Spec-Drift-Waiver` rather than forcing an
  unrelated edit to 116/160; the design rationale is this plan plus the
  spec 198 amendment.
- CI path-filter coverage for the new cross-workspace dependency (so the
  consumer's `overrideGate.test.ts` and the package's own fixture test run on
  isolated carrier-gate edits) is a workflow-governance change deferred to a
  focused follow-on PR (PR-A2), since ci.yml is section-co-authored by
  several CI specs. PR-A itself exercises every affected job because it
  touches both `platform/services/statecraft/**` and `product/packages/**`.

## Decision 2: FR refinements (sketch to contract)

- **FR-001.** Gate every write on both surfaces. On the memory surface the
  gated writes are: `memory_store` (explicit), the harvested-signal
  persistence path, and any future revise path. Verdict is fail-closed with
  an attributable `ruleId` surfaced as the tool error.
- **FR-002.** Provenance columns on `memory_entries`: `actor_kind`
  (`human | agent | harvester`), `origin_session_id`, `source_attribution`
  (nullable; set when harvested), `content_hash` (sha256 of content). The
  existing `updated_at` is the revision timestamp. Migration v2 is additive
  and backfills existing rows to `actor_kind='agent'`,
  `trust_class='machine-harvested'`, `content_hash` computed.
- **FR-003.** `trust_class`: `machine-harvested | human-curated | verified`.
  Default on write is `machine-harvested` unless the caller presents a human
  actor id. The **retention boundary**: reaching `long-term` or `permanent`
  importance requires `human-curated` or `verified`. Access-count promotion
  (spec 056's 3+-access rule) may raise importance **within** the
  machine-harvested-eligible tiers (up to `medium-term`) but never crosses
  into `long-term`/`permanent`.
- **FR-004.** Trust-weighted decay: a sweep demotes unaccessed
  machine-harvested entries one tier and expires them at the floor on a
  configurable horizon; `verified` entries are exempt from decay (not from
  explicit deletion).
- **FR-005.** No-self-ingestion: the store path forces
  `trust_class='machine-harvested'` for any write whose actor is
  `agent`/`harvester`; no automated path may raise trust. Only an explicit
  human-actor store/edit yields `human-curated`, and only an explicit verify
  action yields `verified`.
- **FR-006.** Segmentation as contract: `query`/`list`/`getById` refuse
  cross-project reads at the storage layer (project_scope is mandatory and
  matched exactly); origin-session segmentation supports enumerate-by-session
  and bulk-quarantine; quarantined entries are excluded from all reads.

## PR decomposition (each independently shippable + coupling-clean)

1. **PR-A**: `@opc/carrier-gate` package + repoint `overrideGate.ts` + amend
   198 + 204 edges + this plan/tasks. Proves the Encore boundary.
2. **PR-B**: session-memory depends on `@opc/carrier-gate`; wire the write
   gate into every write path; shared-fixture parity test (AC-1).
3. **PR-C**: provenance columns + trust-class types + stamping; MCP query
   surface exposes them (FR-002/003, AC-2).
4. **PR-D**: human-gated promotion boundary + trust-weighted decay
   (FR-003/004, AC-3/AC-4).
5. **PR-E**: no-self-ingestion + segmentation/quarantine (FR-005/006, AC-5).
6. **PR-F**: flip 204 `draft` to `approved` / `pending` to `complete`; regen
   the featuregraph golden + registry + codebase index.

The PRs are dependency-ordered (B needs A's package; C to E build on the
memory package; F needs all). They land serially: each merges to `main`
before the next branches, so rebases stay clean.

## Risk: Encore boundary (halt-if-fails)

The one novel mechanism is statecraft consuming a `product/` package across
the pnpm/npm + Encore bundler boundary. PR-A verifies it locally before the
sequence proceeds: build `@opc/carrier-gate`, `file:`-install it into
statecraft, typecheck statecraft, run the `overrideGate` vitest suite green,
and run `encore check`/build. If the boundary cannot be made to work
cleanly, PR-A halts and the packaging decision is re-surfaced to the user
rather than forcing a broken design (orchestrator Rule 4).

## Out of scope (unchanged from spec.md)

Async model-assisted scanning of memory content (the spec 200 analog for
this surface), the factory substrate write path (spec 198/200 own it), RAG
stores beyond session memory, and memory UI/presentation (spec 201).
