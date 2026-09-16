// Spec 204 FR-003 retention boundary (AC-3) + FR-004 trust-weighted decay (AC-4).

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MemoryStorage } from "../storage/sqlite.js";
import type { ActorKind, ImportanceLevel } from "../types.js";
import { PROMOTION_ACCESS_THRESHOLD } from "../types.js";
import { runPromotion } from "./promotion.js";
import { runTrustWeightedDecay } from "./decay.js";
import { signalsToStoreInputs, type HarvestedSignal } from "../harvesting/engine.js";

// A `now` far enough in the future that anything stored during the test is
// "stale" relative to the default decay horizon.
const FAR_FUTURE = Math.floor(Date.now() / 1000) + 365 * 24 * 3600;

describe("spec 204 retention boundary + trust-weighted decay", () => {
  let tempDir: string;
  let storage: MemoryStorage;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "retention-test-"));
    storage = new MemoryStorage(join(tempDir, "memory.db"));
  });

  afterEach(() => {
    storage.close();
    rmSync(tempDir, { recursive: true, force: true });
  });

  function storeWithAccesses(
    content: string,
    importance: ImportanceLevel,
    actorKind?: ActorKind,
    accesses = PROMOTION_ACCESS_THRESHOLD,
  ): string {
    const entry = storage.store({
      content,
      kind: "note",
      importance,
      projectScope: "/p",
      actorKind,
    });
    for (let i = 0; i < accesses; i++) {
      storage.query({ projectScope: "/p", text: content });
    }
    return entry.id;
  }

  describe("FR-003 promotion boundary (AC-3)", () => {
    it("machine-harvested cannot cross into long-term via access count", () => {
      const id = storeWithAccesses("mh-medium", "medium-term");
      runPromotion(storage);
      expect(storage.getById(id)?.importance).toBe("medium-term");
    });

    it("machine-harvested still promotes WITHIN the allowed tiers (short to medium)", () => {
      const id = storeWithAccesses("mh-short", "short-term");
      runPromotion(storage);
      expect(storage.getById(id)?.importance).toBe("medium-term");
    });

    it("no sequence of automated accesses reaches long-term or permanent (AC-3)", () => {
      const id = storeWithAccesses("mh-climb", "short-term", undefined, 50);
      for (let i = 0; i < 10; i++) runPromotion(storage);
      const importance = storage.getById(id)?.importance;
      expect(importance).toBe("medium-term");
      expect(importance).not.toBe("long-term");
      expect(importance).not.toBe("permanent");
    });

    it("human-curated promotes across the boundary to long-term", () => {
      const id = storeWithAccesses("hc-medium", "medium-term", "human");
      runPromotion(storage);
      expect(storage.getById(id)?.importance).toBe("long-term");
    });

    it("a verified entry can cross the boundary", () => {
      const id = storeWithAccesses("vf-medium", "medium-term");
      expect(storage.markVerified(id)).toBe(true);
      runPromotion(storage);
      expect(storage.getById(id)?.importance).toBe("long-term");
    });
  });

  describe("FR-003 retention boundary at the WRITE path (AC-3)", () => {
    it("clamps a machine-harvested write requesting permanent to medium-term", () => {
      const e = storage.store({ content: "mh-perm", kind: "note", importance: "permanent", projectScope: "/p" });
      expect(e.importance).toBe("medium-term");
      expect(e.trustClass).toBe("machine-harvested");
      expect(storage.getById(e.id)?.importance).toBe("medium-term");
    });

    it("clamps a machine-harvested write requesting long-term to medium-term", () => {
      const e = storage.store({ content: "mh-long", kind: "note", importance: "long-term", projectScope: "/p" });
      expect(e.importance).toBe("medium-term");
    });

    it("lets a human-actor write reach permanent (human-curated)", () => {
      const e = storage.store({ content: "hc-perm", kind: "note", importance: "permanent", projectScope: "/p", actorKind: "human" });
      expect(e.trustClass).toBe("human-curated");
      expect(e.importance).toBe("permanent");
    });

    it("clamps a HARVESTER write requesting permanent to medium-term (closes the harvester bypass)", () => {
      // The harvester's builtin rules request permanent/long-term; those writes
      // are machine-harvested and must not land at a human-gated tier.
      const signal: HarvestedSignal = {
        ruleId: "note-remember",
        kind: "note",
        importance: "permanent",
        content: "remember this forever",
        matchText: "x",
      };
      const [input] = signalsToStoreInputs([signal], "/p", "sess-h");
      const e = storage.store(input);
      expect(e.actorKind).toBe("harvester");
      expect(e.trustClass).toBe("machine-harvested");
      expect(e.importance).toBe("medium-term");
    });
  });

  describe("FR-004 trust-weighted decay (AC-4)", () => {
    it("demotes each stale entry at most one tier per pass (no cascade)", () => {
      // a is human-curated (exempt); b and c are machine-harvested and each
      // must drop EXACTLY one tier in a single pass (not cascade to the floor).
      const a = storage.store({ content: "d-a", kind: "note", importance: "long-term", projectScope: "/p", actorKind: "human" });
      const b = storage.store({ content: "d-b", kind: "note", importance: "medium-term", projectScope: "/p" });
      const c = storage.store({ content: "d-c", kind: "note", importance: "short-term", projectScope: "/p" });
      const result = runTrustWeightedDecay(storage, { now: FAR_FUTURE });
      expect(storage.getById(a.id)?.importance).toBe("long-term");
      expect(storage.getById(b.id)?.importance).toBe("short-term");
      expect(storage.getById(c.id)?.importance).toBe("ephemeral");
      expect(result.demotedCount).toBe(2);
    });

    it("demotes a stale machine-harvested entry one tier", () => {
      const e = storage.store({ content: "stale-mh", kind: "note", importance: "medium-term", projectScope: "/p" });
      const result = runTrustWeightedDecay(storage, { now: FAR_FUTURE });
      expect(result.demotedCount).toBe(1);
      expect(storage.getById(e.id)?.importance).toBe("short-term");
    });

    it("expires a stale machine-harvested entry at the floor", () => {
      const e = storage.store({ content: "stale-eph", kind: "note", importance: "ephemeral", projectScope: "/p" });
      const result = runTrustWeightedDecay(storage, { now: FAR_FUTURE });
      expect(result.expiredCount).toBe(1);
      expect(storage.getById(e.id)?.expiresAt).toBe(FAR_FUTURE);
    });

    it("does NOT decay a verified entry (AC-4)", () => {
      const e = storage.store({ content: "verified", kind: "note", importance: "medium-term", projectScope: "/p" });
      storage.markVerified(e.id);
      const result = runTrustWeightedDecay(storage, { now: FAR_FUTURE });
      expect(result.demotedCount + result.expiredCount).toBe(0);
      expect(storage.getById(e.id)?.importance).toBe("medium-term");
    });

    it("does NOT decay a human-curated entry (trust-weighted refinement)", () => {
      const e = storage.store({ content: "curated", kind: "note", importance: "medium-term", projectScope: "/p", actorKind: "human" });
      const result = runTrustWeightedDecay(storage, { now: FAR_FUTURE });
      expect(result.demotedCount + result.expiredCount).toBe(0);
      expect(storage.getById(e.id)?.importance).toBe("medium-term");
    });

    it("does NOT decay a recently-accessed machine-harvested entry (within horizon)", () => {
      const e = storage.store({ content: "fresh-mh", kind: "note", importance: "medium-term", projectScope: "/p" });
      const result = runTrustWeightedDecay(storage);
      expect(result.demotedCount + result.expiredCount).toBe(0);
      expect(storage.getById(e.id)?.importance).toBe("medium-term");
    });
  });
});
