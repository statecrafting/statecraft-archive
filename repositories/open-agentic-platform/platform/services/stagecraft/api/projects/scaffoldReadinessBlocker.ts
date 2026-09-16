// Spec 140 §2.3 / T051 — pure blocker-resolution for the scaffold
// readiness response.
//
// Lives in its own module (separate from `scaffoldReadiness.ts`) so the
// pure-function tests can run under bare vitest without pulling in
// `encore.dev/storage/sqldb` (the DB collaborator chain).

export type ScaffoldReadinessBlocker =
  | "warming-up"
  | "warmup-error"
  | "no-factory-adapter"
  | "stale-adapter-manifest"
  | "no-scaffold-source-resolved"
  | "no-upstream-pat";

export type BlockerInputs = {
  hasFactoryAdapter: boolean;
  /** True iff at least one adapter row declares `scaffold_source_id`. */
  anyDeclaresScaffoldSource: boolean;
  scaffoldSourceResolved: boolean;
  hasUpstreamPat: boolean;
  warmupReady: boolean;
  warmupError?: string | undefined;
};

/**
 * Spec 140 §2.3 — pure blocker resolution. Order matters:
 *
 *   1. No adapter rows at all                     → `no-factory-adapter`.
 *   2. Adapter rows present, none declares
 *      `scaffold_source_id`                       → `stale-adapter-manifest`.
 *   3. Declared but no `factory_upstreams` match  → `no-scaffold-source-resolved`.
 *   4. (PAT is optional: absent → anonymous clone for public template repos.)
 *   5. Warmup error                                → `warmup-error`.
 *   6. Warmup not yet ready                        → `warming-up`.
 *   7. Otherwise                                   → `undefined` (Create OK).
 *
 * The legacy `template_remote` fallback (spec 138 §2.1) is gone end-to-end
 * — Create-eligibility is purely `scaffoldSourceResolved`.
 */
export function resolveBlocker(
  inputs: BlockerInputs,
): ScaffoldReadinessBlocker | undefined {
  if (!inputs.hasFactoryAdapter) return "no-factory-adapter";
  if (!inputs.anyDeclaresScaffoldSource) return "stale-adapter-manifest";
  if (!inputs.scaffoldSourceResolved) return "no-scaffold-source-resolved";
  // PAT is optional: an absent token yields an anonymous clone, which works
  // for public template repos. A private repo without a PAT surfaces a clear
  // clone error at scaffold time rather than a preemptive readiness block.
  if (inputs.warmupError) return "warmup-error";
  if (!inputs.warmupReady) return "warming-up";
  return undefined;
}
