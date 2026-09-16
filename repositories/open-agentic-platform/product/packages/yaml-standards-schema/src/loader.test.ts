import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadStandardsFromDir, loadAllTiers } from "./loader.js";

/** Helper to create a minimal valid standard YAML. */
function standardYaml(overrides: Record<string, unknown> = {}): string {
  const obj: Record<string, unknown> = {
    id: "test-001",
    category: "testing",
    priority: "high",
    rules: [
      { verb: "ALWAYS", subject: "write tests", rationale: "ensures correctness" },
    ],
    ...overrides,
  };
  return Object.entries(obj)
    .map(([k, v]) => {
      if (k === "rules" || k === "anti_patterns" || k === "examples" || k === "tags") {
        return `${k}:\n${formatYamlArray(v as unknown[])}`;
      }
      return `${k}: ${JSON.stringify(v)}`;
    })
    .join("\n");
}

function formatYamlArray(arr: unknown[]): string {
  return arr
    .map((item) => {
      if (typeof item === "object" && item !== null) {
        const entries = Object.entries(item as Record<string, unknown>);
        const first = entries[0];
        const rest = entries.slice(1);
        const lines = [`  - ${first[0]}: ${JSON.stringify(first[1])}`];
        for (const [k, v] of rest) {
          lines.push(`    ${k}: ${JSON.stringify(v)}`);
        }
        return lines.join("\n");
      }
      return `  - ${JSON.stringify(item)}`;
    })
    .join("\n");
}

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), "css-loader-"));
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

describe("loadStandardsFromDir", () => {
  it("returns empty for nonexistent directory", async () => {
    const result = await loadStandardsFromDir(join(tmpDir, "nope"), "official");
    expect(result.tier).toBe("official");
    expect(result.standards.size).toBe(0);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("returns empty for directory with no yaml files", async () => {
    const dir = join(tmpDir, "empty");
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "readme.txt"), "not yaml");
    const result = await loadStandardsFromDir(dir, "local");
    expect(result.standards.size).toBe(0);
  });

  it("loads a single .yaml file", async () => {
    const dir = join(tmpDir, "single");
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "test-001.yaml"), standardYaml());
    const result = await loadStandardsFromDir(dir, "official");
    expect(result.standards.size).toBe(1);
    expect(result.standards.get("test-001")).toBeDefined();
    expect(result.standards.get("test-001")!.category).toBe("testing");
    expect(result.diagnostics).toHaveLength(0);
  });

  it("loads .yml files", async () => {
    const dir = join(tmpDir, "yml");
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "test-001.yml"), standardYaml());
    const result = await loadStandardsFromDir(dir, "local");
    expect(result.standards.size).toBe(1);
    expect(result.standards.get("test-001")).toBeDefined();
  });

  it("loads multiple files and keys by id", async () => {
    const dir = join(tmpDir, "multi");
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "a.yaml"), standardYaml({ id: "naming-001", category: "naming" }));
    await writeFile(join(dir, "b.yaml"), standardYaml({ id: "error-001", category: "error-handling" }));
    const result = await loadStandardsFromDir(dir, "community");
    expect(result.standards.size).toBe(2);
    expect(result.standards.get("naming-001")!.category).toBe("naming");
    expect(result.standards.get("error-001")!.category).toBe("error-handling");
  });

  it("emits CS_DUPLICATE_ID warning for same id in one tier", async () => {
    const dir = join(tmpDir, "dup");
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "a.yaml"), standardYaml({ id: "test-001", priority: "low" }));
    await writeFile(join(dir, "b.yaml"), standardYaml({ id: "test-001", priority: "high" }));
    const result = await loadStandardsFromDir(dir, "official");
    expect(result.standards.size).toBe(1);
    const dupDiag = result.diagnostics.find((d) => d.code === "CS_DUPLICATE_ID");
    expect(dupDiag).toBeDefined();
    expect(dupDiag!.message).toContain("test-001");
  });

  it("emits diagnostics for invalid YAML but continues loading valid files", async () => {
    const dir = join(tmpDir, "mixed");
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "bad.yaml"), "id: [invalid\n");
    await writeFile(join(dir, "good.yaml"), standardYaml({ id: "good-001" }));
    const result = await loadStandardsFromDir(dir, "local");
    expect(result.standards.size).toBe(1);
    expect(result.standards.get("good-001")).toBeDefined();
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("emits CS_FILE_READ_ERROR for unreadable files", async () => {
    const dir = join(tmpDir, "unreadable");
    await mkdir(dir, { recursive: true });
    // Create a directory with .yaml extension — reading it as file will fail
    await mkdir(join(dir, "fake.yaml"));
    const result = await loadStandardsFromDir(dir, "official");
    expect(result.standards.size).toBe(0);
    const readErr = result.diagnostics.find((d) => d.code === "CS_FILE_READ_ERROR");
    expect(readErr).toBeDefined();
  });

  it("ignores non-yaml files", async () => {
    const dir = join(tmpDir, "ignore");
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "notes.md"), "# notes");
    await writeFile(join(dir, "data.json"), "{}");
    await writeFile(join(dir, "test-001.yaml"), standardYaml());
    const result = await loadStandardsFromDir(dir, "local");
    expect(result.standards.size).toBe(1);
  });
});

describe("loadAllTiers", () => {
  it("loads from official/community/local under project root", async () => {
    const root = tmpDir;
    await mkdir(join(root, "standards/official"), { recursive: true });
    await mkdir(join(root, "standards/community"), { recursive: true });
    await mkdir(join(root, "standards/local"), { recursive: true });

    await writeFile(
      join(root, "standards/official/naming-001.yaml"),
      standardYaml({ id: "naming-001", category: "naming" }),
    );
    await writeFile(
      join(root, "standards/community/arch-001.yaml"),
      standardYaml({ id: "arch-001", category: "architecture" }),
    );
    await writeFile(
      join(root, "standards/local/local-001.yaml"),
      standardYaml({ id: "local-001", category: "local" }),
    );

    const result = await loadAllTiers(root);
    expect(result.tiers).toHaveLength(3);
    expect(result.tiers[0].tier).toBe("official");
    expect(result.tiers[0].standards.size).toBe(1);
    expect(result.tiers[1].tier).toBe("community");
    expect(result.tiers[1].standards.size).toBe(1);
    expect(result.tiers[2].tier).toBe("local");
    expect(result.tiers[2].standards.size).toBe(1);
  });

  it("works with missing tier directories", async () => {
    const root = tmpDir;
    // Only create official — community and local don't exist
    await mkdir(join(root, "standards/official"), { recursive: true });
    await writeFile(
      join(root, "standards/official/test-001.yaml"),
      standardYaml(),
    );

    const result = await loadAllTiers(root);
    expect(result.tiers[0].standards.size).toBe(1);
    expect(result.tiers[1].standards.size).toBe(0);
    expect(result.tiers[2].standards.size).toBe(0);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("accepts a custom community path (R-007)", async () => {
    const root = tmpDir;
    const customCommunity = join(tmpDir, "shared-standards");
    await mkdir(join(root, "standards/official"), { recursive: true });
    await mkdir(customCommunity, { recursive: true });

    await writeFile(
      join(customCommunity, "shared-001.yaml"),
      standardYaml({ id: "shared-001", category: "shared" }),
    );

    const result = await loadAllTiers(root, customCommunity);
    expect(result.tiers[1].tier).toBe("community");
    expect(result.tiers[1].standards.get("shared-001")!.category).toBe("shared");
  });
});
