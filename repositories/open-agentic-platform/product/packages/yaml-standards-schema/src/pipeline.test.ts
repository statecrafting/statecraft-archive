import { describe, it, expect } from "vitest";
import {
  aggregateFindings,
  generateCandidates,
  runContributorPipeline,
} from "./pipeline.js";
import type { ExecutionFinding, AggregateResult } from "./pipeline.js";
import { parseStandardFile } from "./parser.js";

// --- Test fixtures ---

function lint(ruleId: string, message: string, extra?: Partial<ExecutionFinding>): ExecutionFinding {
  return { ruleId, message, source: "lint", ...extra };
}

function review(ruleId: string, message: string, extra?: Partial<ExecutionFinding>): ExecutionFinding {
  return { ruleId, message, source: "review", ...extra };
}

function security(ruleId: string, message: string, extra?: Partial<ExecutionFinding>): ExecutionFinding {
  return { ruleId, message, source: "security", ...extra };
}

// --- aggregateFindings ---

describe("aggregateFindings", () => {
  it("groups findings by category and ruleId", () => {
    const findings = [
      lint("no-empty-catch", "Avoid empty catch blocks", { category: "error-handling" }),
      lint("no-empty-catch", "Avoid empty catch blocks", { category: "error-handling" }),
      lint("no-var", "Use const/let instead of var", { category: "naming" }),
    ];

    const result = aggregateFindings(findings);

    expect(result.totalFindings).toBe(3);
    expect(result.groups).toHaveLength(2);
    expect(result.groups[0].ruleId).toBe("no-empty-catch");
    expect(result.groups[0].count).toBe(2);
    expect(result.groups[1].ruleId).toBe("no-var");
    expect(result.groups[1].count).toBe(1);
  });

  it("sorts groups by frequency descending", () => {
    const findings = [
      lint("rule-a", "msg a", { category: "general" }),
      lint("rule-b", "msg b", { category: "general" }),
      lint("rule-b", "msg b", { category: "general" }),
      lint("rule-b", "msg b", { category: "general" }),
      lint("rule-a", "msg a", { category: "general" }),
    ];

    const result = aggregateFindings(findings);

    expect(result.groups[0].ruleId).toBe("rule-b");
    expect(result.groups[0].count).toBe(3);
    expect(result.groups[1].ruleId).toBe("rule-a");
    expect(result.groups[1].count).toBe(2);
  });

  it("deduplicates messages and caps at 5", () => {
    const findings = Array.from({ length: 10 }, (_, i) =>
      lint("rule-x", i < 3 ? `unique-${i}` : "repeated", { category: "general" }),
    );

    const result = aggregateFindings(findings);
    const group = result.groups[0];

    expect(group.count).toBe(10);
    // 3 unique + 1 "repeated" = 4 unique messages (all fit under cap of 5)
    expect(group.messages.length).toBeLessThanOrEqual(5);
    expect(new Set(group.messages).size).toBe(group.messages.length);
  });

  it("collects snippets for anti-pattern derivation (max 3)", () => {
    const findings = Array.from({ length: 5 }, (_, i) =>
      lint("rule-x", "msg", {
        category: "general",
        snippet: `bad code ${i}`,
        fix: `good code ${i}`,
      }),
    );

    const result = aggregateFindings(findings);
    expect(result.groups[0].snippets).toHaveLength(3);
  });

  it("tracks multiple source types", () => {
    const findings = [
      lint("sql-injection", "Possible SQL injection", { category: "security" }),
      security("sql-injection", "SQL injection detected", { category: "security" }),
      review("sql-injection", "Review: SQL injection risk", { category: "security" }),
    ];

    const result = aggregateFindings(findings);
    const group = result.groups[0];

    expect(group.sources.size).toBe(3);
    expect(group.sources.has("lint")).toBe(true);
    expect(group.sources.has("security")).toBe(true);
    expect(group.sources.has("review")).toBe(true);
  });

  it("falls back to source-based category when category is absent", () => {
    const findings = [
      security("xss-check", "XSS detected"),
      { ruleId: "slow-test", message: "Test too slow", source: "test" as const },
    ];

    const result = aggregateFindings(findings);
    const categories = result.groups.map((g) => g.category);

    expect(categories).toContain("security");
    expect(categories).toContain("testing");
  });

  it("returns empty groups for empty input", () => {
    const result = aggregateFindings([]);
    expect(result.groups).toHaveLength(0);
    expect(result.totalFindings).toBe(0);
  });
});

// --- generateCandidates ---

describe("generateCandidates", () => {
  function makeAggregated(groups: Array<{ ruleId: string; category: string; count: number; messages?: string[]; snippets?: Array<{ pattern: string; correction?: string }> }>): AggregateResult {
    return {
      totalFindings: groups.reduce((sum, g) => sum + g.count, 0),
      groups: groups.map((g) => ({
        ...g,
        sources: new Set<"lint">(["lint"]),
        messages: g.messages ?? [`Finding for ${g.ruleId}`],
        snippets: g.snippets ?? [],
      })),
    };
  }

  it("generates candidate standards with status: candidate (FR-007)", () => {
    const agg = makeAggregated([
      { ruleId: "no-empty-catch", category: "error-handling", count: 5 },
    ]);

    const result = generateCandidates(agg);

    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0].standard.status).toBe("candidate");
  });

  it("skips groups below minimum frequency", () => {
    const agg = makeAggregated([
      { ruleId: "rare-issue", category: "general", count: 1 },
      { ruleId: "common-issue", category: "general", count: 5 },
    ]);

    const result = generateCandidates(agg, { minFrequency: 2 });

    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0].standard.id).toContain("general");
    expect(result.skippedCount).toBe(1);
  });

  it("respects maxCandidates limit", () => {
    const groups = Array.from({ length: 20 }, (_, i) => ({
      ruleId: `rule-${i}`,
      category: "general",
      count: 20 - i,
    }));
    const agg = makeAggregated(groups);

    const result = generateCandidates(agg, { maxCandidates: 3 });

    expect(result.candidates).toHaveLength(3);
  });

  it("maps frequency to priority levels", () => {
    const agg = makeAggregated([
      { ruleId: "critical-rule", category: "a", count: 15 },
      { ruleId: "high-rule", category: "b", count: 7 },
      { ruleId: "medium-rule", category: "c", count: 4 },
      { ruleId: "low-rule", category: "d", count: 2 },
    ]);

    const result = generateCandidates(agg);
    const priorities = result.candidates.map((c) => c.standard.priority);

    expect(priorities).toEqual(["critical", "high", "medium", "low"]);
  });

  it("infers NEVER verb for no- prefixed rules", () => {
    const agg = makeAggregated([
      { ruleId: "no-empty-catch", category: "error-handling", count: 3 },
    ]);

    const result = generateCandidates(agg);
    expect(result.candidates[0].standard.rules[0].verb).toBe("NEVER");
  });

  it("infers ALWAYS verb from 'must'/'require' messages", () => {
    const agg = makeAggregated([
      { ruleId: "type-annotations", category: "typing", count: 3, messages: ["Must include type annotations"] },
    ]);

    const result = generateCandidates(agg);
    expect(result.candidates[0].standard.rules[0].verb).toBe("ALWAYS");
  });

  it("derives anti-patterns from snippets with corrections", () => {
    const agg = makeAggregated([
      {
        ruleId: "no-var",
        category: "code-quality",
        count: 5,
        snippets: [
          { pattern: "var x = 1;", correction: "const x = 1;" },
          { pattern: "var y = 2;" }, // no correction — should be excluded
        ],
      },
    ]);

    const result = generateCandidates(agg);
    const standard = result.candidates[0].standard;

    expect(standard.anti_patterns).toHaveLength(1);
    expect(standard.anti_patterns![0].pattern).toBe("var x = 1;");
    expect(standard.anti_patterns![0].correction).toBe("const x = 1;");
  });

  it("produces valid YAML that parses back cleanly (SC-004)", () => {
    const agg = makeAggregated([
      {
        ruleId: "no-empty-catch",
        category: "error-handling",
        count: 5,
        snippets: [{ pattern: "catch (e) {}", correction: "catch (e) { log(e); }" }],
      },
    ]);

    const result = generateCandidates(agg);
    const yaml = result.candidates[0].yaml;

    // Parse the generated YAML through the existing parser
    const parsed = parseStandardFile(yaml, "candidate.yaml");

    expect(parsed.diagnostics).toHaveLength(0);
    expect(parsed.standard).not.toBeNull();
    expect(parsed.standard!.status).toBe("candidate");
    expect(parsed.standard!.id).toBe("error-handling-001");
  });

  it("generates unique sequential IDs per category", () => {
    const agg = makeAggregated([
      { ruleId: "rule-a", category: "security", count: 10 },
      { ruleId: "rule-b", category: "security", count: 8 },
      { ruleId: "rule-c", category: "testing", count: 6 },
    ]);

    const result = generateCandidates(agg);
    const ids = result.candidates.map((c) => c.standard.id);

    expect(ids).toEqual(["security-001", "security-002", "testing-001"]);
  });

  it("includes source tags on generated candidates", () => {
    const agg: AggregateResult = {
      totalFindings: 5,
      groups: [
        {
          ruleId: "mixed-sources",
          category: "general",
          count: 5,
          sources: new Set(["lint", "review"] as const),
          messages: ["Found an issue"],
          snippets: [],
        },
      ],
    };

    const result = generateCandidates(agg);
    expect(result.candidates[0].standard.tags).toContain("lint");
    expect(result.candidates[0].standard.tags).toContain("review");
  });

  it("provides suggested fileName for candidates dir", () => {
    const agg = makeAggregated([
      { ruleId: "some-rule", category: "naming", count: 3 },
    ]);

    const result = generateCandidates(agg);
    expect(result.candidates[0].fileName).toBe("naming-001.yaml");
  });
});

// --- runContributorPipeline (end-to-end) ---

describe("runContributorPipeline", () => {
  it("runs aggregation and generation in one call", () => {
    const findings: ExecutionFinding[] = [
      lint("no-empty-catch", "Avoid empty catch", { category: "error-handling" }),
      lint("no-empty-catch", "Avoid empty catch", { category: "error-handling" }),
      lint("no-empty-catch", "Empty catch block", { category: "error-handling" }),
      security("sql-injection", "SQL injection risk", { category: "security" }),
      security("sql-injection", "SQL injection detected", { category: "security" }),
    ];

    const result = runContributorPipeline(findings);

    expect(result.candidates).toHaveLength(2);
    // Most frequent first
    expect(result.candidates[0].standard.category).toBe("error-handling");
    expect(result.candidates[0].findingCount).toBe(3);
    expect(result.candidates[1].standard.category).toBe("security");
    expect(result.candidates[1].findingCount).toBe(2);
  });

  it("respects options passed through", () => {
    const findings = Array.from({ length: 20 }, (_, i) =>
      lint(`rule-${i % 3}`, `msg ${i}`, { category: "general" }),
    );

    const result = runContributorPipeline(findings, { maxCandidates: 1 });

    expect(result.candidates).toHaveLength(1);
  });

  it("all generated candidates parse as valid standards (SC-004)", () => {
    const findings: ExecutionFinding[] = [
      lint("no-var", "Use const", { category: "naming", snippet: "var x = 1;", fix: "const x = 1;" }),
      lint("no-var", "Use const", { category: "naming" }),
      lint("no-var", "Use const", { category: "naming" }),
      review("missing-types", "Must add types", { category: "typing" }),
      review("missing-types", "Must add types", { category: "typing" }),
      security("xss-check", "XSS vulnerability", { category: "security" }),
      security("xss-check", "XSS found", { category: "security" }),
      security("xss-check", "XSS detected", { category: "security" }),
    ];

    const result = runContributorPipeline(findings);

    for (const candidate of result.candidates) {
      const parsed = parseStandardFile(candidate.yaml, candidate.fileName);
      expect(parsed.diagnostics).toHaveLength(0);
      expect(parsed.standard).not.toBeNull();
      expect(parsed.standard!.status).toBe("candidate");
    }
  });
});
