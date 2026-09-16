import type { CodingStandard } from "./types.js";
import type { TierResult } from "./loader.js";

/** Filter criteria for resolved standards (FR-008). */
export interface StandardsFilter {
  /** Only include standards matching this category. */
  category?: string;
  /** Only include standards that have at least one of these tags. */
  tags?: string[];
}

/** Result of standards resolution. */
export interface ResolveResult {
  /** Merged active standards keyed by id. */
  standards: Map<string, CodingStandard>;
}

/**
 * Merge standards across tiers with later-wins precedence for the same `id` (FR-004).
 * Excludes `status: candidate` standards from the resolved set (SC-003).
 * Supports category and tag filtering (FR-008).
 *
 * @param tiers — ordered array of tier results (official first, local last)
 * @param filter — optional category/tag filter
 */
export function resolveStandards(
  tiers: TierResult[],
  filter?: StandardsFilter,
): ResolveResult {
  const merged = new Map<string, CodingStandard>();

  // Apply tiers in order: later tiers override earlier for the same id (FR-004).
  for (const tier of tiers) {
    for (const [id, standard] of tier.standards) {
      // Exclude candidates (SC-003).
      if (standard.status === "candidate") {
        continue;
      }
      merged.set(id, standard);
    }
  }

  // Apply filters if provided (FR-008).
  if (filter) {
    for (const [id, standard] of merged) {
      if (filter.category && standard.category !== filter.category) {
        merged.delete(id);
        continue;
      }
      if (filter.tags && filter.tags.length > 0) {
        const standardTags = new Set(standard.tags ?? []);
        const hasMatch = filter.tags.some((t) => standardTags.has(t));
        if (!hasMatch) {
          merged.delete(id);
        }
      }
    }
  }

  return { standards: merged };
}
