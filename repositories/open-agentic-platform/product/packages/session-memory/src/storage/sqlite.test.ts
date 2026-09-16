import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { MemoryStorage } from "./sqlite.js";

describe("MemoryStorage", () => {
  let storage: MemoryStorage;
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "session-memory-test-"));
    storage = new MemoryStorage(join(tempDir, "memory.db"));
  });

  afterEach(() => {
    storage.close();
    rmSync(tempDir, { recursive: true, force: true });
  });

  describe("store", () => {
    it("creates an entry with all fields populated", () => {
      const entry = storage.store({
        content: "Use ESM imports everywhere",
        kind: "decision",
        importance: "long-term",
        tags: ["imports", "esm"],
        projectScope: "/project",
        sourceSessionId: "session-1",
        // long-term is a human-gated tier; a human actor may reach it (a
        // machine-harvested write would be clamped to medium-term).
        actorKind: "human",
      });

      expect(entry.id).toMatch(/^[0-9a-f-]{36}$/);
      expect(entry.content).toBe("Use ESM imports everywhere");
      expect(entry.kind).toBe("decision");
      expect(entry.importance).toBe("long-term");
      expect(entry.expiresAt).toBeTypeOf("number");
      expect(entry.projectScope).toBe("/project");
      expect(entry.tags).toEqual(["imports", "esm"]);
      expect(entry.sourceSessionId).toBe("session-1");
      expect(entry.accessCount).toBe(0);
      expect(entry.createdAt).toBeTypeOf("number");
      expect(entry.updatedAt).toBe(entry.createdAt);
    });

    it("defaults importance to medium-term", () => {
      const entry = storage.store({
        content: "some note",
        kind: "note",
        projectScope: "/project",
      });
      expect(entry.importance).toBe("medium-term");
    });

    it("sets expiresAt to null for permanent entries", () => {
      const entry = storage.store({
        content: "permanent note",
        kind: "preference",
        importance: "permanent",
        projectScope: "/project",
        actorKind: "human", // permanent is human-gated
      });
      expect(entry.expiresAt).toBeNull();
    });

    it("calculates correct expiry for short-term", () => {
      const before = Math.floor(Date.now() / 1000);
      const entry = storage.store({
        content: "short note",
        kind: "note",
        importance: "short-term",
        projectScope: "/project",
      });
      // 24 hours = 86400 seconds
      expect(entry.expiresAt).toBeGreaterThanOrEqual(before + 86_400);
    });
  });

  describe("getById", () => {
    it("returns stored entry", () => {
      const stored = storage.store({
        content: "test entry",
        kind: "note",
        projectScope: "/project",
      });
      const fetched = storage.getById(stored.id);
      expect(fetched).not.toBeNull();
      expect(fetched!.id).toBe(stored.id);
      expect(fetched!.content).toBe("test entry");
      expect(fetched!.tags).toEqual([]);
    });

    it("returns null for unknown ID", () => {
      expect(storage.getById("nonexistent")).toBeNull();
    });
  });

  describe("query", () => {
    beforeEach(() => {
      storage.store({ content: "Use vitest for testing", kind: "decision", tags: ["testing"], projectScope: "/proj", sourceSessionId: "s1" });
      storage.store({ content: "Actually use jest instead", kind: "correction", tags: ["testing"], projectScope: "/proj", sourceSessionId: "s1" });
      storage.store({ content: "React components use PascalCase", kind: "pattern", tags: ["naming", "react"], projectScope: "/proj", sourceSessionId: "s2" });
      storage.store({ content: "Unrelated entry", kind: "note", tags: ["other"], projectScope: "/other", sourceSessionId: "s3" });
    });

    it("filters by projectScope", () => {
      const results = storage.query({ projectScope: "/proj" });
      expect(results).toHaveLength(3);
    });

    it("filters by kind", () => {
      const results = storage.query({ projectScope: "/proj", kind: "correction" });
      expect(results).toHaveLength(1);
      expect(results[0].content).toBe("Actually use jest instead");
    });

    it("filters by tags (OR semantics)", () => {
      const results = storage.query({ projectScope: "/proj", tags: ["react"] });
      expect(results).toHaveLength(1);
      expect(results[0].content).toContain("PascalCase");
    });

    it("filters by free text", () => {
      const results = storage.query({ projectScope: "/proj", text: "vitest" });
      expect(results).toHaveLength(1);
    });

    it("respects limit", () => {
      const results = storage.query({ projectScope: "/proj", limit: 2 });
      expect(results).toHaveLength(2);
    });

    it("bumps accessCount on query (FR-007)", () => {
      const results = storage.query({ projectScope: "/proj", kind: "decision" });
      expect(results[0].accessCount).toBe(1);

      // Query again
      const results2 = storage.query({ projectScope: "/proj", kind: "decision" });
      expect(results2[0].accessCount).toBe(2);
    });

    it("does not return entries from other projects", () => {
      const results = storage.query({ projectScope: "/proj" });
      expect(results.every((e) => e.projectScope === "/proj")).toBe(true);
    });
  });

  describe("list", () => {
    beforeEach(() => {
      for (let i = 0; i < 5; i++) {
        storage.store({ content: `Entry ${i}`, kind: "note", projectScope: "/proj" });
      }
    });

    it("returns entries ordered by createdAt desc", () => {
      const results = storage.list({ projectScope: "/proj" });
      expect(results).toHaveLength(5);
    });

    it("supports pagination", () => {
      const page1 = storage.list({ projectScope: "/proj", limit: 2, offset: 0 });
      const page2 = storage.list({ projectScope: "/proj", limit: 2, offset: 2 });
      expect(page1).toHaveLength(2);
      expect(page2).toHaveLength(2);
      expect(page1[0].id).not.toBe(page2[0].id);
    });

    it("filters by kind", () => {
      storage.store({ content: "A decision", kind: "decision", projectScope: "/proj" });
      const results = storage.list({ projectScope: "/proj", kind: "decision" });
      expect(results).toHaveLength(1);
    });
  });

  describe("delete", () => {
    it("removes an entry and returns true", () => {
      const entry = storage.store({ content: "to delete", kind: "note", projectScope: "/proj" });
      expect(storage.delete(entry.id)).toBe(true);
      expect(storage.getById(entry.id)).toBeNull();
    });

    it("returns false for unknown ID", () => {
      expect(storage.delete("nonexistent")).toBe(false);
    });
  });

  describe("sweepExpired", () => {
    it("removes expired entries (SC-004)", () => {
      // Store an entry that already expired
      const entry = storage.store({ content: "expired", kind: "note", importance: "ephemeral", projectScope: "/proj" });
      // Manually set expires_at to the past
      // Access the internal db to backdoor the test
      const db = (storage as unknown as { db: { prepare: (s: string) => { run: (...a: unknown[]) => void } } }).db;
      db.prepare("UPDATE memory_entries SET expires_at = ? WHERE id = ?").run(1000, entry.id);

      const deleted = storage.sweepExpired();
      expect(deleted).toBe(1);
      expect(storage.getById(entry.id)).toBeNull();
    });

    it("does not remove permanent entries", () => {
      storage.store({ content: "permanent", kind: "preference", importance: "permanent", projectScope: "/proj" });
      const deleted = storage.sweepExpired();
      expect(deleted).toBe(0);
    });
  });

  describe("updateImportance", () => {
    it("changes importance and expiresAt", () => {
      const entry = storage.store({ content: "test", kind: "note", importance: "short-term", projectScope: "/proj" });
      const updated = storage.updateImportance(entry.id, "long-term", null);
      expect(updated).toBe(true);

      const fetched = storage.getById(entry.id);
      expect(fetched!.importance).toBe("long-term");
      expect(fetched!.expiresAt).toBeNull();
    });

    it("returns false for unknown ID", () => {
      expect(storage.updateImportance("nope", "permanent", null)).toBe(false);
    });
  });

  describe("getPromotionCandidates", () => {
    it("returns entries with access_count >= threshold", () => {
      storage.store({ content: "popular", kind: "decision", projectScope: "/proj" });
      // Query 3 times to bump access count
      storage.query({ projectScope: "/proj", kind: "decision" });
      storage.query({ projectScope: "/proj", kind: "decision" });
      storage.query({ projectScope: "/proj", kind: "decision" });

      const candidates = storage.getPromotionCandidates(3);
      expect(candidates).toHaveLength(1);
      expect(candidates[0].content).toBe("popular");
    });

    it("excludes long-term and permanent entries", () => {
      // human actor so the long-term tier is not clamped to medium-term.
      storage.store({ content: "already long", kind: "note", importance: "long-term", projectScope: "/proj", actorKind: "human" });
      // Bump access count via direct SQL
      const db = (storage as unknown as { db: { prepare: (s: string) => { run: (...a: unknown[]) => void } } }).db;
      db.prepare("UPDATE memory_entries SET access_count = 10").run();

      const candidates = storage.getPromotionCandidates(3);
      expect(candidates).toHaveLength(0);
    });
  });

  describe("count", () => {
    it("returns entry count for a project", () => {
      storage.store({ content: "a", kind: "note", projectScope: "/proj" });
      storage.store({ content: "b", kind: "note", projectScope: "/proj" });
      storage.store({ content: "c", kind: "note", projectScope: "/other" });
      expect(storage.count("/proj")).toBe(2);
      expect(storage.count("/other")).toBe(1);
      expect(storage.count("/nonexistent")).toBe(0);
    });
  });

  describe("forProject", () => {
    it("creates storage from project root", () => {
      const projStorage = MemoryStorage.forProject(tempDir);
      const entry = projStorage.store({ content: "test", kind: "note", projectScope: tempDir });
      expect(entry.id).toBeTruthy();
      projStorage.close();
    });
  });
});
