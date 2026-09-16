/**
 * Importance promotion logic (FR-007, SC-005).
 *
 * Promotes memory entries that have been accessed frequently
 * to a higher importance tier, extending their lifetime.
 */

import type { MemoryStorage } from "../storage/sqlite.js";
import type { ImportanceLevel } from "../types.js";
import {
  IMPORTANCE_ORDER,
  EXPIRY_DEFAULTS,
  PROMOTION_ACCESS_THRESHOLD,
  HUMAN_GATED_TIERS,
  isHumanTrusted,
} from "../types.js";

/** The importance level immediately below the current one, or null at the floor. */
export function getPrevImportance(current: ImportanceLevel): ImportanceLevel | null {
  const idx = IMPORTANCE_ORDER.indexOf(current);
  if (idx <= 0) return null;
  return IMPORTANCE_ORDER[idx - 1];
}

export interface PromotionResult {
  promotedCount: number;
  promotions: Array<{
    id: string;
    from: ImportanceLevel;
    to: ImportanceLevel;
  }>;
}

/** Get the next importance level above the current one. Returns null if already at max. */
export function getNextImportance(current: ImportanceLevel): ImportanceLevel | null {
  const idx = IMPORTANCE_ORDER.indexOf(current);
  if (idx === -1 || idx >= IMPORTANCE_ORDER.length - 1) return null;
  return IMPORTANCE_ORDER[idx + 1];
}

/**
 * Run promotion for all eligible entries in the database.
 *
 * Finds entries with access_count >= threshold and importance
 * below long-term, then promotes each one level up (SC-005).
 */
export function runPromotion(
  storage: MemoryStorage,
  threshold?: number,
): PromotionResult {
  const accessThreshold = threshold ?? PROMOTION_ACCESS_THRESHOLD;
  const candidates = storage.getPromotionCandidates(accessThreshold);
  const promotions: PromotionResult["promotions"] = [];

  for (const entry of candidates) {
    const nextLevel = getNextImportance(entry.importance);
    if (!nextLevel) continue;

    // FR-003 retention boundary (AC-3): access-count promotion may raise
    // importance within the machine-harvested-eligible tiers, but can never
    // cross into long-term/permanent for a machine-harvested entry. Those
    // tiers require human-curated or verified trust. This is one half of the
    // boundary: the write path (storage.store) clamps machine-harvested writes
    // to the same ceiling, so neither a direct write nor a run of automated
    // accesses can land machine-harvested content past this line.
    if (HUMAN_GATED_TIERS.has(nextLevel) && !isHumanTrusted(entry.trustClass)) {
      continue;
    }

    const expiryDelta = EXPIRY_DEFAULTS[nextLevel];
    const now = Math.floor(Date.now() / 1000);
    const newExpiresAt = expiryDelta === null ? null : now + expiryDelta;

    const updated = storage.updateImportance(entry.id, nextLevel, newExpiresAt);
    if (updated) {
      promotions.push({ id: entry.id, from: entry.importance, to: nextLevel });
    }
  }

  return { promotedCount: promotions.length, promotions };
}
