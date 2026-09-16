import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import type { CodingStandard } from "./types.js";
import type { ResolveResult } from "./resolver.js";
import {
  formatStandardsForPrompt,
  resolveAndFormat,
  composeSystemPrompt,
} from "./integration.js";

// --- Helpers ---

function makeStandard(overrides: Partial<CodingStandard> = {}): CodingStandard {
  return {
    id: "test-001",
    category: "testing",
    priority: "medium",
    status: "active",
    rules: [
      {
        verb: "ALWAYS",
        subject: "write tests for new code",
        rationale: "Tests prevent regressions.",
      },
    ],
    ...overrides,
  };
}

function makeResolved(standards: CodingStandard[]): ResolveResult {
  const map = new Map<string, CodingStandard>();
  for (const s of standards) {
    map.set(s.id, s);
  }
  return { standards: map };
}

function writeYaml(dir: string, filename: string, content: string): void {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, filename), content, "utf-8");
}

// --- formatStandardsForPrompt ---

describe("formatStandardsForPrompt", () => {
  it("returns empty result for no standards", () => {
    const result = formatStandardsForPrompt(makeResolved([]));
    expect(result.promptText).toBe("");
    expect(result.standardCount).toBe(0);
    expect(result.standardIds).toEqual([]);
  });

  it("formats a single standard with rules", () => {
    const s = makeStandard();
    const result = formatStandardsForPrompt(makeResolved([s]));
    expect(result.standardCount).toBe(1);
    expect(result.standardIds).toEqual(["test-001"]);
    expect(result.promptText).toContain("## Applicable Coding Standards");
    expect(result.promptText).toContain("### test-001 [medium]");
    expect(result.promptText).toContain("Category: testing");
    expect(result.promptText).toContain("ALWAYS: write tests for new code");
    expect(result.promptText).toContain("Rationale: Tests prevent regressions.");
  });

  it("includes context when present", () => {
    const s = makeStandard({ context: "TypeScript files only" });
    const result = formatStandardsForPrompt(makeResolved([s]));
    expect(result.promptText).toContain("Context: TypeScript files only");
  });

  it("includes anti-patterns by default", () => {
    const s = makeStandard({
      anti_patterns: [
        { pattern: "catch (e) {}", correction: "catch (e) { log(e); }" },
      ],
    });
    const result = formatStandardsForPrompt(makeResolved([s]));
    expect(result.promptText).toContain("**Anti-patterns:**");
    expect(result.promptText).toContain("catch (e) {}");
    expect(result.promptText).toContain("catch (e) { log(e); }");
  });

  it("excludes anti-patterns when disabled", () => {
    const s = makeStandard({
      anti_patterns: [
        { pattern: "catch (e) {}", correction: "catch (e) { log(e); }" },
      ],
    });
    const result = formatStandardsForPrompt(makeResolved([s]), {
      includeAntiPatterns: false,
    });
    expect(result.promptText).not.toContain("**Anti-patterns:**");
  });

  it("excludes examples by default", () => {
    const s = makeStandard({
      examples: [
        { good: "const x = 1;", bad: "var x = 1;", explanation: "Use const." },
      ],
    });
    const result = formatStandardsForPrompt(makeResolved([s]));
    expect(result.promptText).not.toContain("**Examples:**");
  });

  it("includes examples when enabled", () => {
    const s = makeStandard({
      examples: [
        { good: "const x = 1;", bad: "var x = 1;", explanation: "Use const." },
      ],
    });
    const result = formatStandardsForPrompt(makeResolved([s]), {
      includeExamples: true,
    });
    expect(result.promptText).toContain("**Examples:**");
    expect(result.promptText).toContain("const x = 1;");
    expect(result.promptText).toContain("var x = 1;");
    expect(result.promptText).toContain("Use const.");
  });

  it("sorts by priority (critical first)", () => {
    const low = makeStandard({ id: "low-001", priority: "low" });
    const crit = makeStandard({ id: "crit-001", priority: "critical" });
    const high = makeStandard({ id: "high-001", priority: "high" });
    const result = formatStandardsForPrompt(makeResolved([low, crit, high]));
    const ids = result.standardIds;
    expect(ids).toEqual(["crit-001", "high-001", "low-001"]);
  });

  it("sorts by id within same priority", () => {
    const b = makeStandard({ id: "b-001", priority: "high" });
    const a = makeStandard({ id: "a-001", priority: "high" });
    const result = formatStandardsForPrompt(makeResolved([b, a]));
    expect(result.standardIds).toEqual(["a-001", "b-001"]);
  });

  it("respects maxStandards limit", () => {
    const standards = [
      makeStandard({ id: "a-001", priority: "critical" }),
      makeStandard({ id: "b-001", priority: "high" }),
      makeStandard({ id: "c-001", priority: "low" }),
    ];
    const result = formatStandardsForPrompt(makeResolved(standards), {
      maxStandards: 2,
    });
    expect(result.standardCount).toBe(2);
    expect(result.standardIds).toEqual(["a-001", "b-001"]);
  });

  it("maxStandards 0 returns empty", () => {
    const result = formatStandardsForPrompt(
      makeResolved([makeStandard()]),
      { maxStandards: 0 },
    );
    expect(result.standardCount).toBe(0);
    expect(result.promptText).toBe("");
  });

  it("disabling sortByPriority sorts only by id", () => {
    const low = makeStandard({ id: "a-001", priority: "low" });
    const crit = makeStandard({ id: "b-001", priority: "critical" });
    const result = formatStandardsForPrompt(makeResolved([low, crit]), {
      sortByPriority: false,
    });
    expect(result.standardIds).toEqual(["a-001", "b-001"]);
  });

  it("separates multiple standards with dividers", () => {
    const standards = [
      makeStandard({ id: "a-001" }),
      makeStandard({ id: "b-001" }),
    ];
    const result = formatStandardsForPrompt(makeResolved(standards));
    expect(result.promptText).toContain("---");
  });

  it("formats multiple rules per standard", () => {
    const s = makeStandard({
      rules: [
        { verb: "ALWAYS", subject: "do A", rationale: "reason A" },
        { verb: "NEVER", subject: "do B", rationale: "reason B" },
        { verb: "PREFER", subject: "do C", rationale: "reason C" },
      ],
    });
    const result = formatStandardsForPrompt(makeResolved([s]));
    expect(result.promptText).toContain("ALWAYS: do A");
    expect(result.promptText).toContain("NEVER: do B");
    expect(result.promptText).toContain("PREFER: do C");
  });

  it("header mentions correct count (singular)", () => {
    const result = formatStandardsForPrompt(
      makeResolved([makeStandard()]),
    );
    expect(result.promptText).toContain("1 coding standard applies");
  });

  it("header mentions correct count (plural)", () => {
    const result = formatStandardsForPrompt(
      makeResolved([makeStandard({ id: "a" }), makeStandard({ id: "b" })]),
    );
    expect(result.promptText).toContain("2 coding standards apply");
  });
});

// --- resolveAndFormat (filesystem integration) ---

describe("resolveAndFormat", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "055-integration-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("loads and formats standards from disk", async () => {
    writeYaml(
      path.join(tmpDir, "standards", "official"),
      "naming-001.yaml",
      [
        "id: naming-001",
        "category: naming",
        "priority: high",
        "status: active",
        "rules:",
        "  - verb: ALWAYS",
        "    subject: use camelCase for variables",
        "    rationale: Consistency.",
      ].join("\n"),
    );

    const result = await resolveAndFormat({ projectRoot: tmpDir });
    expect(result.standardCount).toBe(1);
    expect(result.standardIds).toEqual(["naming-001"]);
    expect(result.promptText).toContain("naming-001");
    expect(result.promptText).toContain("ALWAYS: use camelCase");
  });

  it("applies category filter", async () => {
    const officialDir = path.join(tmpDir, "standards", "official");
    writeYaml(
      officialDir,
      "naming-001.yaml",
      "id: naming-001\ncategory: naming\npriority: high\nstatus: active\nrules:\n  - verb: ALWAYS\n    subject: camelCase\n    rationale: consistency",
    );
    writeYaml(
      officialDir,
      "security-001.yaml",
      "id: security-001\ncategory: security\npriority: critical\nstatus: active\nrules:\n  - verb: NEVER\n    subject: eval\n    rationale: unsafe",
    );

    const result = await resolveAndFormat({
      projectRoot: tmpDir,
      filter: { category: "security" },
    });
    expect(result.standardCount).toBe(1);
    expect(result.standardIds).toEqual(["security-001"]);
  });

  it("applies tag filter", async () => {
    writeYaml(
      path.join(tmpDir, "standards", "official"),
      "ts-001.yaml",
      "id: ts-001\ncategory: naming\npriority: medium\nstatus: active\ntags:\n  - typescript\nrules:\n  - verb: PREFER\n    subject: interfaces over types\n    rationale: extensibility",
    );
    writeYaml(
      path.join(tmpDir, "standards", "official"),
      "py-001.yaml",
      "id: py-001\ncategory: naming\npriority: medium\nstatus: active\ntags:\n  - python\nrules:\n  - verb: ALWAYS\n    subject: snake_case\n    rationale: PEP 8",
    );

    const result = await resolveAndFormat({
      projectRoot: tmpDir,
      filter: { tags: ["typescript"] },
    });
    expect(result.standardCount).toBe(1);
    expect(result.standardIds).toEqual(["ts-001"]);
  });

  it("returns empty for no matching standards", async () => {
    const result = await resolveAndFormat({ projectRoot: tmpDir });
    expect(result.standardCount).toBe(0);
    expect(result.promptText).toBe("");
  });

  it("respects three-tier override (local wins)", async () => {
    writeYaml(
      path.join(tmpDir, "standards", "official"),
      "naming-001.yaml",
      "id: naming-001\ncategory: naming\npriority: low\nstatus: active\nrules:\n  - verb: PREFER\n    subject: camelCase\n    rationale: default",
    );
    writeYaml(
      path.join(tmpDir, "standards", "local"),
      "naming-001.yaml",
      "id: naming-001\ncategory: naming\npriority: critical\nstatus: active\nrules:\n  - verb: ALWAYS\n    subject: snake_case\n    rationale: project override",
    );

    const result = await resolveAndFormat({ projectRoot: tmpDir });
    expect(result.standardCount).toBe(1);
    expect(result.promptText).toContain("[critical]");
    expect(result.promptText).toContain("snake_case");
    expect(result.promptText).not.toContain("camelCase");
  });

  it("excludes candidate standards", async () => {
    writeYaml(
      path.join(tmpDir, "standards", "official"),
      "active-001.yaml",
      "id: active-001\ncategory: testing\npriority: high\nstatus: active\nrules:\n  - verb: ALWAYS\n    subject: test\n    rationale: quality",
    );
    writeYaml(
      path.join(tmpDir, "standards", "local"),
      "candidate-001.yaml",
      "id: candidate-001\ncategory: testing\npriority: medium\nstatus: candidate\nrules:\n  - verb: PREFER\n    subject: mocks\n    rationale: draft",
    );

    const result = await resolveAndFormat({ projectRoot: tmpDir });
    expect(result.standardCount).toBe(1);
    expect(result.standardIds).toEqual(["active-001"]);
  });

  it("passes format options through", async () => {
    writeYaml(
      path.join(tmpDir, "standards", "official"),
      "s-001.yaml",
      [
        "id: s-001",
        "category: security",
        "priority: critical",
        "status: active",
        "rules:",
        "  - verb: NEVER",
        "    subject: eval",
        "    rationale: unsafe",
        "anti_patterns:",
        "  - pattern: eval(x)",
        "    correction: safeEval(x)",
      ].join("\n"),
    );

    const withAp = await resolveAndFormat({
      projectRoot: tmpDir,
      format: { includeAntiPatterns: true },
    });
    expect(withAp.promptText).toContain("Anti-patterns");

    const withoutAp = await resolveAndFormat({
      projectRoot: tmpDir,
      format: { includeAntiPatterns: false },
    });
    expect(withoutAp.promptText).not.toContain("Anti-patterns");
  });
});

// --- composeSystemPrompt ---

describe("composeSystemPrompt", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "055-compose-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("appends standards to base prompt", async () => {
    writeYaml(
      path.join(tmpDir, "standards", "official"),
      "naming-001.yaml",
      "id: naming-001\ncategory: naming\npriority: high\nstatus: active\nrules:\n  - verb: ALWAYS\n    subject: camelCase\n    rationale: consistency",
    );

    const base = "You are a code reviewer.";
    const { prompt, integration } = await composeSystemPrompt(base, {
      projectRoot: tmpDir,
    });

    expect(prompt.startsWith("You are a code reviewer.")).toBe(true);
    expect(prompt).toContain("## Applicable Coding Standards");
    expect(prompt).toContain("naming-001");
    expect(integration.standardCount).toBe(1);
  });

  it("returns base prompt unchanged when no standards match", async () => {
    const base = "You are a code reviewer.";
    const { prompt, integration } = await composeSystemPrompt(base, {
      projectRoot: tmpDir,
      filter: { category: "nonexistent" },
    });

    expect(prompt).toBe(base);
    expect(integration.standardCount).toBe(0);
  });

  it("preserves base prompt exactly (no trailing whitespace)", async () => {
    writeYaml(
      path.join(tmpDir, "standards", "official"),
      "s-001.yaml",
      "id: s-001\ncategory: testing\npriority: medium\nstatus: active\nrules:\n  - verb: ALWAYS\n    subject: test\n    rationale: quality",
    );

    const base = "Base prompt with trailing newline.\n";
    const { prompt } = await composeSystemPrompt(base, {
      projectRoot: tmpDir,
    });

    expect(prompt.startsWith(base)).toBe(true);
    expect(prompt.indexOf("## Applicable Coding Standards")).toBeGreaterThan(
      base.length,
    );
  });
});
