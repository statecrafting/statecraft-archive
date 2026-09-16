// Spec 115 FR-011 — extractor dispatch table.
//
// `pickExtractor` walks the registered extractors in cost-ascending order
// and returns the first whose `canHandle(input, policy)` predicate matches.
// Adding a new extractor is one new file under `extractors/` plus a row
// in `EXTRACTORS` here — no edits to `extractionCore.ts` or
// `extractionWorker.ts` (FR-012).
//
// Phase 1a ships an empty registry so the worker can be wired end-to-end
// before any extractor implementation exists. Phase 1b registers the
// deterministic kinds; Phase 2 adds the agent kinds gated on policy.

import type { Extractor, ExtractorInput } from "./types";
import type { ExtractionPolicy } from "../extractionPolicy";

// ---------------------------------------------------------------------------
// Registry — populated by side-effect imports in Phase 1b/2.
// ---------------------------------------------------------------------------

const EXTRACTORS: Extractor[] = [];

/**
 * Register an extractor with the dispatcher. Order matters: callers should
 * register the cheapest/most-specific extractors first so `pickExtractor`
 * picks deterministic over agent when both could handle the input.
 */
export function registerExtractor(extractor: Extractor): void {
  EXTRACTORS.push(extractor);
}

/**
 * Visible for tests — clears the registry between cases. Production code
 * MUST NOT call this.
 */
export function _resetExtractorsForTesting(): void {
  EXTRACTORS.length = 0;
}

// ---------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------

export type DispatchResult = {
  extractor: Extractor;
  kind: string;
  version: string;
};

/**
 * FR-011: pick the cheapest extractor whose mime-type predicate matches AND
 * whose policy gate passes AND whose `maxBytes` ceiling can hold the input.
 * Returns null when no extractor qualifies — the worker then fails the run
 * with either `policy_pending` (no policy bundle yet) or
 * `extractor_not_implemented` / `policy_denied` (real policy + no match).
 *
 * FR-013: If the picked extractor's `maxBytes` is exceeded, we walk forward
 * to the next eligible extractor. The dispatcher does NOT itself decide on
 * `object_too_large` — that's the worker's call once it has run out of
 * candidates.
 */
export function pickExtractor(
  input: ExtractorInput,
  policy: ExtractionPolicy,
): DispatchResult | null {
  for (const extractor of EXTRACTORS) {
    if (input.sizeBytes > extractor.maxBytes) continue;
    if (!extractor.canHandle(input, policy)) continue;
    return {
      extractor,
      kind: extractor.kind,
      version: extractor.version,
    };
  }
  return null;
}

/**
 * Enqueue-time helper: returns just the `(kind, version)` pair the caller
 * needs for the idempotency key, without instantiating the extractor. When
 * no extractor matches at enqueue time we still allow the row to land —
 * a fresh policy bundle compile or a Phase 1b/2 deploy may make it dispatchable
 * by the time the worker fires. The placeholder version "unresolved" keeps
 * the idempotency key stable for that retry window.
 */
export function pickExtractorVersion(
  input: ExtractorInput,
  policy: ExtractionPolicy,
): { kind: string; version: string } {
  const pick = pickExtractor(input, policy);
  if (pick) return { kind: pick.kind, version: pick.version };
  return { kind: "unresolved", version: "unresolved" };
}
