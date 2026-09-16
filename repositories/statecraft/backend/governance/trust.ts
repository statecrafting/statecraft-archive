/**
 * Per-actor trust (spec 008 §2).
 *
 * A rolling window of weighted samples maps to a graduated privilege level.
 * Samples are appended on gate outcomes and operation results; the level is
 * advisory in v1 (exposed, not yet enforced). Snapshots persist per actor in
 * CoreLedger; the addon owns the window arithmetic.
 */
import { api } from "encore.dev/api";

import native, { type TrustLevelResult } from "./native";
import { initStore, trustSnapshots, TrustSnapshot } from "./store";

/**
 * Fold one sample (value in [0,1], 1.0 = fully aligned) into an actor's window
 * and persist the result. Returns the actor's new level + score.
 */
export async function recordTrustSample(
  actor: string,
  value: number,
  weight = 1,
): Promise<TrustLevelResult> {
  await initStore();
  const repo = trustSnapshots();

  const existing = await repo.findById(actor);
  const prior = existing?.snapshot ?? null;
  const updated = native.trustSample(prior, JSON.stringify({ value, weight }));

  if (existing) {
    await repo.updateById(actor, { snapshot: updated, updatedAt: new Date() });
  } else {
    await repo.insert(
      Object.assign(new TrustSnapshot(), {
        actor,
        snapshot: updated,
        updatedAt: new Date(),
      }),
    );
  }

  return native.trustLevel(updated);
}

interface SampleRequest {
  actor: string;
  value: number;
  weight?: number;
}

// POST /governance/trust/sample : append a trust sample for an actor.
export const sample = api(
  { expose: false, method: "POST", path: "/governance/trust/sample" },
  async (req: SampleRequest): Promise<TrustLevelResult> => {
    return recordTrustSample(req.actor, req.value, req.weight ?? 1);
  },
);

interface LevelRequest {
  actor: string;
}

// GET /governance/trust/:actor : read an actor's advisory trust level.
export const level = api(
  { expose: true, method: "GET", path: "/governance/trust/:actor" },
  async ({ actor }: LevelRequest): Promise<TrustLevelResult> => {
    await initStore();
    const existing = await trustSnapshots().findById(actor);
    if (!existing) {
      // No samples yet: full trust (nothing has gone wrong).
      return { level: "full", score: 1 };
    }
    return native.trustLevel(existing.snapshot);
  },
);
