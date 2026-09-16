import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { MemoryStorage } from "./storage/sqlite.js";
import { loadSessionMemories, formatMemoriesForPrompt, composeSessionPrompt } from "./integration.js";

describe("loadSessionMemories", () => {
  let tempDir: string;
  let dbPath: string;
  let storage: MemoryStorage;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "integration-test-"));
    dbPath = join(tempDir, "memory.db");
    storage = new MemoryStorage(dbPath);
  });

  afterEach(() => {
    storage.close();
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("loads memories for a project (FR-006)", () => {
    storage.store({ content: "Use ESM", kind: "decision", importance: "long-term", projectScope: "/proj" });
    storage.store({ content: "Prefer vitest", kind: "preference", importance: "permanent", projectScope: "/proj" });
    storage.close();

    const result = loadSessionMemories({ projectScope: "/proj", databasePath: dbPath });
    expect(result.entryCount).toBe(2);
    expect(result.entries).toHaveLength(2);
    expect(result.promptText).toContain("Use ESM");
    expect(result.promptText).toContain("Prefer vitest");
  });

  it("excludes ephemeral entries by default", () => {
    storage.store({ content: "temp note", kind: "note", importance: "ephemeral", projectScope: "/proj" });
    storage.store({ content: "durable note", kind: "note", importance: "long-term", projectScope: "/proj" });
    storage.close();

    const result = loadSessionMemories({ projectScope: "/proj", databasePath: dbPath });
    expect(result.entryCount).toBe(1);
    expect(result.entries[0].content).toBe("durable note");
  });

  it("respects minImportance filter", () => {
    storage.store({ content: "short", kind: "note", importance: "short-term", projectScope: "/proj" });
    storage.store({ content: "long", kind: "note", importance: "long-term", projectScope: "/proj", actorKind: "human" });
    storage.close();

    const result = loadSessionMemories({ projectScope: "/proj", databasePath: dbPath, minImportance: "long-term" });
    expect(result.entryCount).toBe(1);
    expect(result.entries[0].content).toBe("long");
  });

  it("respects kinds filter", () => {
    storage.store({ content: "a decision", kind: "decision", importance: "long-term", projectScope: "/proj" });
    storage.store({ content: "a note", kind: "note", importance: "long-term", projectScope: "/proj" });
    storage.close();

    const result = loadSessionMemories({ projectScope: "/proj", databasePath: dbPath, kinds: ["decision"] });
    expect(result.entryCount).toBe(1);
    expect(result.entries[0].kind).toBe("decision");
  });

  it("respects maxEntries limit (R-003)", () => {
    for (let i = 0; i < 30; i++) {
      storage.store({ content: `Entry ${i}`, kind: "note", importance: "long-term", projectScope: "/proj" });
    }
    storage.close();

    const result = loadSessionMemories({ projectScope: "/proj", databasePath: dbPath, maxEntries: 5 });
    expect(result.entryCount).toBe(5);
  });

  it("sorts by importance desc, then recency desc", () => {
    storage.store({ content: "medium entry", kind: "note", importance: "medium-term", projectScope: "/proj" });
    storage.store({ content: "permanent entry", kind: "preference", importance: "permanent", projectScope: "/proj", actorKind: "human" });
    storage.store({ content: "long entry", kind: "decision", importance: "long-term", projectScope: "/proj", actorKind: "human" });
    storage.close();

    const result = loadSessionMemories({ projectScope: "/proj", databasePath: dbPath });
    expect(result.entries[0].importance).toBe("permanent");
    expect(result.entries[1].importance).toBe("long-term");
    expect(result.entries[2].importance).toBe("medium-term");
  });

  it("returns empty result for project with no memories", () => {
    storage.close();
    const result = loadSessionMemories({ projectScope: "/proj", databasePath: dbPath });
    expect(result.entryCount).toBe(0);
    expect(result.promptText).toBe("");
  });
});

describe("formatMemoriesForPrompt", () => {
  it("formats empty list", () => {
    expect(formatMemoriesForPrompt([])).toBe("");
  });

  it("formats single entry", () => {
    const entries = [{
      id: "1", content: "Use ESM", kind: "decision" as const, importance: "long-term" as const,
      expiresAt: null, projectScope: "/proj", tags: [], sourceSessionId: "s1",
      accessCount: 0, createdAt: 1000, updatedAt: 1000,
    }];
    const text = formatMemoriesForPrompt(entries);
    expect(text).toContain("## Project Memory");
    expect(text).toContain("### Decisions");
    expect(text).toContain("- Use ESM");
  });

  it("includes tags in output", () => {
    const entries = [{
      id: "1", content: "Use ESM", kind: "decision" as const, importance: "long-term" as const,
      expiresAt: null, projectScope: "/proj", tags: ["imports", "esm"], sourceSessionId: "s1",
      accessCount: 0, createdAt: 1000, updatedAt: 1000,
    }];
    const text = formatMemoriesForPrompt(entries);
    expect(text).toContain("[imports, esm]");
  });

  it("groups by kind", () => {
    const entries = [
      { id: "1", content: "decision 1", kind: "decision" as const, importance: "long-term" as const, expiresAt: null, projectScope: "/proj", tags: [], sourceSessionId: "s1", accessCount: 0, createdAt: 1000, updatedAt: 1000 },
      { id: "2", content: "note 1", kind: "note" as const, importance: "long-term" as const, expiresAt: null, projectScope: "/proj", tags: [], sourceSessionId: "s1", accessCount: 0, createdAt: 1000, updatedAt: 1000 },
      { id: "3", content: "pattern 1", kind: "pattern" as const, importance: "long-term" as const, expiresAt: null, projectScope: "/proj", tags: [], sourceSessionId: "s1", accessCount: 0, createdAt: 1000, updatedAt: 1000 },
    ];
    const text = formatMemoriesForPrompt(entries);
    expect(text).toContain("### Decisions");
    expect(text).toContain("### Notes");
    expect(text).toContain("### Patterns");
  });

  it("uses singular/plural header correctly", () => {
    const entries = [{
      id: "1", content: "one", kind: "note" as const, importance: "long-term" as const,
      expiresAt: null, projectScope: "/proj", tags: [], sourceSessionId: "s1",
      accessCount: 0, createdAt: 1000, updatedAt: 1000,
    }];
    const text = formatMemoriesForPrompt(entries);
    expect(text).toContain("1 memory");
  });
});

describe("composeSessionPrompt", () => {
  let tempDir: string;
  let dbPath: string;
  let storage: MemoryStorage;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "compose-test-"));
    dbPath = join(tempDir, "memory.db");
    storage = new MemoryStorage(dbPath);
  });

  afterEach(() => {
    storage.close();
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("appends memories to base prompt (SC-006)", () => {
    storage.store({ content: "Use ESM", kind: "decision", importance: "long-term", projectScope: "/proj" });
    storage.close();

    const result = composeSessionPrompt("You are a helpful assistant.", { projectScope: "/proj", databasePath: dbPath });
    expect(result).toContain("You are a helpful assistant.");
    expect(result).toContain("## Project Memory");
    expect(result).toContain("Use ESM");
  });

  it("returns base prompt unchanged when no memories match", () => {
    storage.close();
    const base = "You are a helpful assistant.";
    const result = composeSessionPrompt(base, { projectScope: "/proj", databasePath: dbPath });
    expect(result).toBe(base);
  });

  it("preserves base prompt content", () => {
    storage.store({ content: "test", kind: "note", importance: "long-term", projectScope: "/proj" });
    storage.close();

    const base = "System prompt with special instructions.\nDo not hallucinate.";
    const result = composeSessionPrompt(base, { projectScope: "/proj", databasePath: dbPath });
    expect(result.startsWith(base)).toBe(true);
  });
});
