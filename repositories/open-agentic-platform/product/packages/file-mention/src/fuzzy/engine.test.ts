import { describe, it, expect, beforeEach } from "vitest";
import { MentionSearchIndex } from "./engine.js";

describe("MentionSearchIndex", () => {
  let index: MentionSearchIndex;

  beforeEach(() => {
    index = new MentionSearchIndex();
  });

  it("starts empty", () => {
    expect(index.fileCount).toBe(0);
    expect(index.agentCount).toBe(0);
  });

  it("rebuilds with files and agents", () => {
    index.rebuild(
      ["src/app.ts", "src/lib/utils.ts"],
      [{ agentId: "a1", displayName: "Builder", avatar: "🤖" }],
    );
    expect(index.fileCount).toBe(2);
    expect(index.agentCount).toBe(1);
  });

  it("returns candidates for empty query", () => {
    index.rebuild(["a.ts", "b.ts"], []);
    const results = index.search("");
    expect(results).toHaveLength(2);
    expect(results[0]!.score).toBe(0);
  });

  it("limits empty query results", () => {
    const files = Array.from({ length: 30 }, (_, i) => `file${i}.ts`);
    index.rebuild(files, []);
    const results = index.search("", 10);
    expect(results).toHaveLength(10);
  });

  it("fuzzy matches files", () => {
    index.rebuild(["src/components/Button.tsx", "src/utils/format.ts"], []);
    const results = index.search("btn");
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0]!.candidate.type).toBe("file");
    if (results[0]!.candidate.type === "file") {
      expect(results[0]!.candidate.relativePath).toBe("src/components/Button.tsx");
    }
  });

  it("fuzzy matches agents", () => {
    index.rebuild([], [{ agentId: "builder", displayName: "Builder Agent", avatar: "🤖" }]);
    const results = index.search("build");
    expect(results).toHaveLength(1);
    expect(results[0]!.candidate.type).toBe("agent");
  });

  it("mixes files and agents in results (FR-003)", () => {
    index.rebuild(
      ["src/build/config.ts"],
      [{ agentId: "builder", displayName: "build-agent", avatar: "🤖" }],
    );
    const results = index.search("build");
    const types = results.map((r) => r.candidate.type);
    expect(types).toContain("file");
    expect(types).toContain("agent");
  });

  it("sorts by score descending", () => {
    index.rebuild(
      ["src/components/Button.tsx", "src/lib/obscure-btn-helper.ts", "README.md"],
      [],
    );
    const results = index.search("btn");
    for (let i = 1; i < results.length; i++) {
      expect(results[i]!.score).toBeLessThanOrEqual(results[i - 1]!.score);
    }
  });

  it("respects limit parameter (FR-002)", () => {
    const files = Array.from({ length: 50 }, (_, i) => `file${i}.ts`);
    index.rebuild(files, []);
    const results = index.search("file", 5);
    expect(results).toHaveLength(5);
  });

  it("defaults to limit 20 (FR-002)", () => {
    const files = Array.from({ length: 50 }, (_, i) => `f${i}.ts`);
    index.rebuild(files, []);
    const results = index.search("f");
    expect(results.length).toBeLessThanOrEqual(20);
  });

  it("addFile adds incrementally", () => {
    index.rebuild(["a.ts"], []);
    expect(index.fileCount).toBe(1);
    index.addFile("b.ts");
    expect(index.fileCount).toBe(2);
  });

  it("addFile skips duplicates", () => {
    index.rebuild(["a.ts"], []);
    index.addFile("a.ts");
    expect(index.fileCount).toBe(1);
  });

  it("removeFile removes from index", () => {
    index.rebuild(["a.ts", "b.ts"], []);
    index.removeFile("a.ts");
    expect(index.fileCount).toBe(1);
    const results = index.search("a");
    const paths = results
      .filter((r) => r.candidate.type === "file")
      .map((r) => (r.candidate as { relativePath: string }).relativePath);
    expect(paths).not.toContain("a.ts");
  });

  it("returns empty array for non-matching query", () => {
    index.rebuild(["app.ts"], []);
    const results = index.search("zzz");
    expect(results).toEqual([]);
  });
});
