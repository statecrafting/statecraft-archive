import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { MemoryStorage } from "../storage/sqlite.js";
import { ExpirySweeper } from "./sweeper.js";
import { runPromotion, getNextImportance } from "./promotion.js";

describe("ExpirySweeper", () => {
  let storage: MemoryStorage;
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "sweeper-test-"));
    storage = new MemoryStorage(join(tempDir, "memory.db"));
  });

  afterEach(() => {
    storage.close();
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("removes expired entries on sweep (SC-004)", () => {
    const entry = storage.store({ content: "expired", kind: "note", importance: "ephemeral", projectScope: "/proj" });
    // Manually set expires_at to the past
    const db = (storage as unknown as { db: { prepare: (s: string) => { run: (...a: unknown[]) => void } } }).db;
    db.prepare("UPDATE memory_entries SET expires_at = ? WHERE id = ?").run(1000, entry.id);

    const sweeper = new ExpirySweeper(storage);
    const result = sweeper.sweep();
    expect(result.deletedCount).toBe(1);
    expect(storage.getById(entry.id)).toBeNull();
  });

  it("does not remove non-expired entries", () => {
    storage.store({ content: "fresh", kind: "note", importance: "long-term", projectScope: "/proj" });
    const sweeper = new ExpirySweeper(storage);
    const result = sweeper.sweep();
    expect(result.deletedCount).toBe(0);
  });

  it("tracks last result", () => {
    const sweeper = new ExpirySweeper(storage);
    expect(sweeper.getLastResult()).toBeNull();
    sweeper.sweep();
    expect(sweeper.getLastResult()).not.toBeNull();
    expect(sweeper.getLastResult()!.sweptAt).toBeTypeOf("number");
  });

  it("starts and stops background sweep", () => {
    const sweeper = new ExpirySweeper(storage, { intervalMs: 100 });
    expect(sweeper.isRunning()).toBe(false);
    sweeper.start();
    expect(sweeper.isRunning()).toBe(true);
    // Initial sweep runs immediately
    expect(sweeper.getLastResult()).not.toBeNull();
    sweeper.stop();
    expect(sweeper.isRunning()).toBe(false);
  });

  it("start is idempotent", () => {
    const sweeper = new ExpirySweeper(storage, { intervalMs: 100 });
    sweeper.start();
    sweeper.start(); // second call is a no-op
    expect(sweeper.isRunning()).toBe(true);
    sweeper.stop();
  });
});

describe("getNextImportance", () => {
  it("promotes ephemeral to short-term", () => {
    expect(getNextImportance("ephemeral")).toBe("short-term");
  });

  it("promotes short-term to medium-term (SC-005)", () => {
    expect(getNextImportance("short-term")).toBe("medium-term");
  });

  it("promotes medium-term to long-term", () => {
    expect(getNextImportance("medium-term")).toBe("long-term");
  });

  it("promotes long-term to permanent", () => {
    expect(getNextImportance("long-term")).toBe("permanent");
  });

  it("returns null for permanent (already max)", () => {
    expect(getNextImportance("permanent")).toBeNull();
  });
});

describe("runPromotion", () => {
  let storage: MemoryStorage;
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "promotion-test-"));
    storage = new MemoryStorage(join(tempDir, "memory.db"));
  });

  afterEach(() => {
    storage.close();
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("promotes short-term to medium-term after 3 accesses (SC-005)", () => {
    storage.store({ content: "popular", kind: "decision", importance: "short-term", projectScope: "/proj" });
    // Query 3 times to bump access count
    storage.query({ projectScope: "/proj", kind: "decision" });
    storage.query({ projectScope: "/proj", kind: "decision" });
    storage.query({ projectScope: "/proj", kind: "decision" });

    const result = runPromotion(storage);
    expect(result.promotedCount).toBe(1);
    expect(result.promotions[0].from).toBe("short-term");
    expect(result.promotions[0].to).toBe("medium-term");

    // Verify in DB
    const entry = storage.getById(result.promotions[0].id);
    expect(entry!.importance).toBe("medium-term");
  });

  it("promotes ephemeral to short-term", () => {
    storage.store({ content: "temp", kind: "note", importance: "ephemeral", projectScope: "/proj" });
    // Bump access count directly
    const db = (storage as unknown as { db: { prepare: (s: string) => { run: (...a: unknown[]) => void } } }).db;
    db.prepare("UPDATE memory_entries SET access_count = 5").run();

    const result = runPromotion(storage);
    expect(result.promotedCount).toBe(1);
    expect(result.promotions[0].to).toBe("short-term");
  });

  it("does not promote entries below threshold", () => {
    storage.store({ content: "unpopular", kind: "note", importance: "short-term", projectScope: "/proj" });
    const result = runPromotion(storage);
    expect(result.promotedCount).toBe(0);
  });

  it("does not promote long-term or permanent entries", () => {
    storage.store({ content: "durable", kind: "preference", importance: "long-term", projectScope: "/proj" });
    const db = (storage as unknown as { db: { prepare: (s: string) => { run: (...a: unknown[]) => void } } }).db;
    db.prepare("UPDATE memory_entries SET access_count = 100").run();

    const result = runPromotion(storage);
    expect(result.promotedCount).toBe(0);
  });

  it("handles empty database", () => {
    const result = runPromotion(storage);
    expect(result.promotedCount).toBe(0);
    expect(result.promotions).toEqual([]);
  });

  it("respects custom threshold", () => {
    storage.store({ content: "test", kind: "note", importance: "short-term", projectScope: "/proj" });
    const db = (storage as unknown as { db: { prepare: (s: string) => { run: (...a: unknown[]) => void } } }).db;
    db.prepare("UPDATE memory_entries SET access_count = 1").run();

    // threshold=1 should trigger promotion
    const result = runPromotion(storage, 1);
    expect(result.promotedCount).toBe(1);
  });
});
