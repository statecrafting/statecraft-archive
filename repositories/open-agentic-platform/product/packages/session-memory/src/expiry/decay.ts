/**
 * Trust-weighted decay (spec 204 FR-004).
 *
 * Machine-harvested entries that are not re-accessed within the configured
 * horizon are demoted one importance tier; when they reach the floor they are
 * marked expired (the expiry sweeper then deletes them). Human-curated and
 * verified entries are EXEMPT: a human established them, so they do not decay
 * from disuse (they remain explicitly deletable). This bounds poison
 * persistence (ASI06 m8) without eroding human-established memory.
 *
 * Decay targets DISUSE: an entry kept fresh by repeated reads is in active use
 * and is not a candidate (this is the spec's "not re-accessed" signal). That
 * does not let poison persist unbounded, because the write-time retention
 * ceiling means an accessed machine-harvested entry can never exceed
 * medium-term, so it is bounded by that tier's expiry regardless of reads.
 * Decay is the additional bound for the un-accessed tail.
 *
 * Design note (plan.md FR-004 refinement): the spec frames decay over
 * "unverified" entries; we scope it to `machine-harvested` and exempt both
 * `human-curated` and `verified`, because human curation is itself a trust
 * signal (m9) that should protect an entry from disuse-decay. AC-4 (a
 * machine-harvested entry decays, a verified entry does not) holds either way.
 */

import type { MemoryStorage } from "../storage/sqlite.js";
import type { ImportanceLevel } from "../types.js";
import { EXPIRY_DEFAULTS } from "../types.js";
import { getPrevImportance } from "./promotion.js";

/** Default decay horizon: not re-accessed for 30 days decays one tier. */
export const DEFAULT_DECAY_HORIZON_SECONDS = 30 * 24 * 60 * 60;

export interface DecayOptions {
  /** Not-re-accessed-within horizon, in seconds. Default 30 days. */
  horizonSeconds?: number;
  /** Clock override (seconds since epoch) for deterministic tests. */
  now?: number;
}

export interface DecayResult {
  demotedCount: number;
  expiredCount: number;
  actions: Array<{
    id: string;
    from: ImportanceLevel;
    to: ImportanceLevel | "expired";
  }>;
}

/**
 * Run one trust-weighted decay pass. Deterministic given `now`. Each stale
 * machine-harvested entry is demoted one tier (its updated_at is reset, so it
 * will not decay again until another full horizon elapses); an entry already
 * at the floor is expired.
 */
export function runTrustWeightedDecay(
  storage: MemoryStorage,
  options?: DecayOptions,
): DecayResult {
  const horizon = options?.horizonSeconds ?? DEFAULT_DECAY_HORIZON_SECONDS;
  const now = options?.now ?? Math.floor(Date.now() / 1000);
  const staleBefore = now - horizon;

  const candidates = storage.getDecayCandidates(staleBefore);
  const actions: DecayResult["actions"] = [];
  let demotedCount = 0;
  let expiredCount = 0;

  for (const entry of candidates) {
    const lower = getPrevImportance(entry.importance);
    if (lower === null) {
      // Already at the floor (ephemeral): expire it; the sweeper deletes it.
      if (storage.expireNow(entry.id, now)) {
        actions.push({ id: entry.id, from: entry.importance, to: "expired" });
        expiredCount++;
      }
      continue;
    }
    const expiryDelta = EXPIRY_DEFAULTS[lower];
    const newExpiresAt = expiryDelta === null ? null : now + expiryDelta;
    if (storage.updateImportance(entry.id, lower, newExpiresAt)) {
      actions.push({ id: entry.id, from: entry.importance, to: lower });
      demotedCount++;
    }
  }

  return { demotedCount, expiredCount, actions };
}
