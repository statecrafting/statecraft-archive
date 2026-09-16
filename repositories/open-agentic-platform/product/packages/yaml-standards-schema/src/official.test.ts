import { describe, it, expect } from "vitest";
import { join } from "node:path";
import { loadStandardsFromDir } from "./loader.js";
import { parseStandardFile } from "./parser.js";
import { readdir, readFile } from "node:fs/promises";

const OFFICIAL_DIR = join(__dirname, "../../../standards/official");

describe("official standards library", () => {
  it("official directory contains at least 5 standards covering the required categories", async () => {
    const result = await loadStandardsFromDir(OFFICIAL_DIR, "official");
    expect(result.diagnostics).toEqual([]);
    expect(result.standards.size).toBeGreaterThanOrEqual(5);

    const categories = new Set(
      [...result.standards.values()].map((s) => s.category),
    );
    // Spec Phase 3 requires: error handling, naming, testing, security, architecture
    expect(categories).toContain("error-handling");
    expect(categories).toContain("naming");
    expect(categories).toContain("testing");
    expect(categories).toContain("security");
    expect(categories).toContain("architecture");
  });

  it("all official standards have status: active", async () => {
    const result = await loadStandardsFromDir(OFFICIAL_DIR, "official");
    for (const [id, standard] of result.standards) {
      expect(standard.status, `${id} should be active`).toBe("active");
    }
  });

  it("all official standards have valid ids (kebab-case, unique)", async () => {
    const result = await loadStandardsFromDir(OFFICIAL_DIR, "official");
    const ids = [...result.standards.keys()];
    // No duplicates (Map already dedupes, but check diagnostic)
    expect(result.diagnostics.filter((d) => d.code === "CS_DUPLICATE_ID")).toEqual([]);
    // All kebab-case
    for (const id of ids) {
      expect(id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
    }
  });

  it("every standard has at least one rule", async () => {
    const result = await loadStandardsFromDir(OFFICIAL_DIR, "official");
    for (const [id, standard] of result.standards) {
      expect(standard.rules.length, `${id} should have at least one rule`).toBeGreaterThan(0);
    }
  });

  it("every standard has tags for filtering", async () => {
    const result = await loadStandardsFromDir(OFFICIAL_DIR, "official");
    for (const [id, standard] of result.standards) {
      expect(standard.tags, `${id} should have tags`).toBeDefined();
      expect(standard.tags!.length, `${id} should have at least one tag`).toBeGreaterThan(0);
    }
  });

  it("all five rule verbs are represented across the library", async () => {
    const result = await loadStandardsFromDir(OFFICIAL_DIR, "official");
    const verbs = new Set<string>();
    for (const standard of result.standards.values()) {
      for (const rule of standard.rules) {
        verbs.add(rule.verb);
      }
    }
    expect(verbs).toContain("ALWAYS");
    expect(verbs).toContain("NEVER");
    expect(verbs).toContain("USE");
    expect(verbs).toContain("PREFER");
    expect(verbs).toContain("AVOID");
  });

  it("each YAML file individually parses without diagnostics", async () => {
    const files = (await readdir(OFFICIAL_DIR)).filter(
      (f) => f.endsWith(".yaml") || f.endsWith(".yml"),
    );
    expect(files.length).toBeGreaterThan(0);

    for (const file of files) {
      const filePath = join(OFFICIAL_DIR, file);
      const content = await readFile(filePath, "utf-8");
      const result = parseStandardFile(content, filePath);
      expect(result.diagnostics, `${file} should parse cleanly`).toEqual([]);
      expect(result.standard, `${file} should produce a standard`).not.toBeNull();
    }
  });

  it("standards cover categories with both critical and non-critical priorities", async () => {
    const result = await loadStandardsFromDir(OFFICIAL_DIR, "official");
    const priorities = new Set(
      [...result.standards.values()].map((s) => s.priority),
    );
    expect(priorities.size).toBeGreaterThanOrEqual(2);
  });
});
