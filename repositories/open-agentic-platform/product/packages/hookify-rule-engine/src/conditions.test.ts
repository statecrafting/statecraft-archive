import { describe, expect, it } from "vitest";
import { evaluateConditionNode } from "./conditions.js";
import type { ConditionNode } from "./types.js";

describe("evaluateConditionNode", () => {
  const baseContext = {
    payload: {
      tool: { name: "Bash" },
      input: {
        command: "git push --force origin main",
        path: "specs/048-hookify-rule-engine/spec.md",
        tags: ["git", "dangerous"],
      },
      output: {
        status: "ok",
      },
    },
    filePath: "rules/test.md",
    ruleId: "test-rule",
  };

  it("evaluates all operators in the matrix", () => {
    const matrix: ConditionNode = {
      all: [
        { field: "tool.name", "==": "Bash" },
        { field: "output.status", "!=": "error" },
        { field: "input.command", contains: "--force" },
        { field: "input.command", matches: "git push.*--force" },
        { field: "input.path", glob: "specs/*/spec.md" },
      ],
    };
    const result = evaluateConditionNode(matrix, baseContext);
    expect(result.matched).toBe(true);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("supports nested AND/OR/NOT combinators", () => {
    const node: ConditionNode = {
      all: [
        { field: "tool.name", "==": "Bash" },
        {
          any: [
            { field: "input.command", contains: "--dry-run" },
            { field: "input.command", contains: "--force" },
          ],
        },
        {
          not: { field: "output.status", "==": "error" },
        },
      ],
    };

    const result = evaluateConditionNode(node, baseContext);
    expect(result.matched).toBe(true);
  });

  it("returns false and emits diagnostic for undefined field access", () => {
    const result = evaluateConditionNode(
      { field: "input.missing.path", contains: "x" },
      baseContext,
    );
    expect(result.matched).toBe(false);
    expect(result.diagnostics.some((d) => d.code === "HKY_FIELD_UNDEFINED")).toBe(true);
  });

  it("short-circuits OR and avoids evaluating invalid branch regex", () => {
    const result = evaluateConditionNode(
      {
        any: [
          { field: "tool.name", "==": "Bash" },
          { field: "input.command", matches: "[" },
        ],
      },
      baseContext,
    );
    expect(result.matched).toBe(true);
    expect(result.diagnostics.some((d) => d.code === "HKY_INVALID_REGEX")).toBe(false);
  });

  it("supports contains for arrays", () => {
    const result = evaluateConditionNode(
      { field: "input.tags", contains: "dangerous" },
      baseContext,
    );
    expect(result.matched).toBe(true);
  });
});
