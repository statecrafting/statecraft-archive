// Spec 204 FR-005 (no self-ingestion) + FR-006 (segmentation / quarantine), AC-5.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MemoryStorage } from "./storage/sqlite.js";
import { handleMemoryStore } from "./tools/store.js";
import { runPromotion } from "./expiry/promotion.js";
import { runTrustWeightedDecay } from "./expiry/decay.js";
import { loadSessionMemories } from "./integration.js";

const contents = (entries: { content: string }[]) =>
  entries.map((e) => e.content).sort();

// Far enough ahead that anything stored during a test is "stale" for decay.
const FAR_FUTURE = Math.floor(Date.now() / 1000) + 365 * 24 * 3600;

describe("spec 204 FR-006 segmentation + quarantine", () => {
  let tempDir: string;
  let storage: MemoryStorage;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "quarantine-test-"));
    storage = new MemoryStorage(join(tempDir, "memory.db"));
  });

  afterEach(() => {
    storage.close();
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("enumerates + bulk-quarantines a session; quarantined excluded from reads (AC-5)", () => {
    storage.store({ content: "poison-1", kind: "note", projectScope: "/p", sourceSessionId: "bad-sess" });
    storage.store({ content: "poison-2", kind: "note", projectScope: "/p", sourceSessionId: "bad-sess" });
    storage.store({ content: "clean-1", kind: "note", projectScope: "/p", sourceSessionId: "good-sess" });

    // The poisoned session's writes are enumerable.
    expect(storage.getBySession("bad-sess")).toHaveLength(2);

    // Bulk-quarantine the session.
    expect(storage.quarantineSession("bad-sess")).toBe(2);

    // Quarantined entries are excluded from every read surface.
    expect(contents(storage.query({ projectScope: "/p" }))).toEqual(["clean-1"]);
    expect(contents(storage.list({ projectScope: "/p" }))).toEqual(["clean-1"]);

    // But still enumerable for human review, flagged quarantined.
    const enumerated = storage.getBySession("bad-sess");
    expect(enumerated).toHaveLength(2);
    expect(enumerated.every((e) => e.quarantined)).toBe(true);

    // Release after review restores readability.
    expect(storage.releaseSession("bad-sess")).toBe(2);
    expect(contents(storage.query({ projectScope: "/p" }))).toEqual([
      "clean-1",
      "poison-1",
      "poison-2",
    ]);
  });

  it("freezes a quarantined entry: not counted, promoted, decayed, swept, or deleted (AC-5)", () => {
    const e = storage.store({ content: "frozen", kind: "note", importance: "medium-term", projectScope: "/p", sourceSessionId: "poison" });
    for (let i = 0; i < 5; i++) storage.query({ projectScope: "/p", text: "frozen" }); // promotion-eligible
    storage.quarantineSession("poison");

    // Excluded from the count, and frozen from all lifecycle housekeeping.
    expect(storage.count("/p")).toBe(0);
    expect(storage.getPromotionCandidates(3)).toHaveLength(0);
    runPromotion(storage);
    expect(storage.getDecayCandidates(FAR_FUTURE)).toHaveLength(0);
    runTrustWeightedDecay(storage, { now: FAR_FUTURE });

    // Even an expired quarantined entry is not swept, and the agent-facing
    // delete cannot destroy the evidence.
    const db = (storage as unknown as { db: { prepare: (s: string) => { run: (...a: unknown[]) => void } } }).db;
    db.prepare("UPDATE memory_entries SET expires_at = 1 WHERE id = ?").run(e.id);
    expect(storage.sweepExpired()).toBe(0);
    expect(storage.delete(e.id)).toBe(false);

    // Still enumerable for human review, unchanged and flagged quarantined.
    const [enumerated] = storage.getBySession("poison");
    expect(enumerated.importance).toBe("medium-term");
    expect(enumerated.quarantined).toBe(true);

    // After release, normal lifecycle (here: deletion) resumes.
    storage.releaseSession("poison");
    expect(storage.delete(e.id)).toBe(true);
  });

  it("refuses cross-project reads at the storage layer (FR-006)", () => {
    storage.store({ content: "x-secret", kind: "note", projectScope: "/projX" });
    storage.store({ content: "y-secret", kind: "note", projectScope: "/projY" });

    expect(contents(storage.query({ projectScope: "/projX" }))).toEqual(["x-secret"]);
    expect(contents(storage.list({ projectScope: "/projY" }))).toEqual(["y-secret"]);
    // A query scoped to X never returns Y's content even with a matching term.
    expect(contents(storage.query({ projectScope: "/projX", text: "secret" }))).toEqual([
      "x-secret",
    ]);
  });

  it("quarantined entries are not injected into a later session (integration)", () => {
    const dbFile = join(tempDir, "inject.db");
    const s = new MemoryStorage(dbFile);
    s.store({ content: "clean note", kind: "note", importance: "long-term", projectScope: "/p", sourceSessionId: "ok" });
    s.store({ content: "poison note", kind: "note", importance: "long-term", projectScope: "/p", sourceSessionId: "bad" });
    s.quarantineSession("bad");
    s.close();

    const result = loadSessionMemories({ projectScope: "/p", databasePath: dbFile });
    expect(result.promptText).toContain("clean note");
    expect(result.promptText).not.toContain("poison note");
  });
});

describe("spec 204 FR-005 no self-ingestion", () => {
  let tempDir: string;
  let storage: MemoryStorage;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "self-ingest-test-"));
    storage = new MemoryStorage(join(tempDir, "memory.db"));
  });

  afterEach(() => {
    storage.close();
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("agent output is always machine-harvested and re-ingestion cannot launder it (m6)", () => {
    // An agent writes via the untrusted MCP tool.
    const first = handleMemoryStore(storage, { content: "an agent claim", kind: "note" }, { projectScope: "/p", sourceSessionId: "s1" });
    expect(first.actorKind).toBe("agent");
    expect(first.trustClass).toBe("machine-harvested");

    // The agent READS its own memory back (the real self-ingestion data flow)...
    const [readBack] = storage.query({ projectScope: "/p", text: "agent claim" });
    expect(readBack.content).toBe("an agent claim");

    // ...and re-stores a paraphrase of what it just read, via the MCP tool.
    const paraphrase = handleMemoryStore(
      storage,
      { content: `${readBack.content} (paraphrased)`, kind: "note" },
      { projectScope: "/p", sourceSessionId: "s2" },
    );
    expect(paraphrase.actorKind).toBe("agent");
    expect(paraphrase.trustClass).toBe("machine-harvested");

    // No sequence of automated accesses + promotions launders it higher.
    for (let i = 0; i < 10; i++) storage.query({ projectScope: "/p", text: "paraphrased" });
    for (let i = 0; i < 5; i++) runPromotion(storage);
    const got = storage.getById(paraphrase.id);
    expect(got?.trustClass).toBe("machine-harvested");
    expect(["ephemeral", "short-term", "medium-term"]).toContain(got?.importance);
  });
});
