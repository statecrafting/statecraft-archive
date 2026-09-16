import { describe, expect, it } from "vitest";
import { executeRuleAction } from "./actions.js";
import type { Rule } from "./types.js";

function makeRule(overrides: Partial<Rule>): Rule {
  return {
    id: "rule-id",
    event: "PreToolUse",
    matcher: { tool: "Bash" },
    conditions: { all: [{ field: "input.command", contains: "git" }] },
    action: { type: "warn" },
    priority: 10,
    rationale: "Rule rationale",
    sourcePath: "rules/rule.md",
    ...overrides,
  };
}

describe("executeRuleAction", () => {
  it("blocks git push --force and short-circuits with rationale source (SC-001)", () => {
    const rule = makeRule({
      id: "block-force-push",
      action: { type: "block" },
      rationale: "Force push is blocked. Use --force-with-lease.",
    });
    const result = executeRuleAction({
      rule,
      payload: { input: { command: "git push --force origin main" } },
    });

    expect(result.terminalDecision).toBe("blocked");
    expect(result.blockedByRuleId).toBe("block-force-push");
    expect(result.matchedRuleIds).toEqual(["block-force-push"]);
  });

  it("emits warning and allows operation (SC-002)", () => {
    const rule = makeRule({
      id: "warn-risky-command",
      action: { type: "warn" },
      rationale: "This command may have side effects.",
    });
    const result = executeRuleAction({
      rule,
      payload: { input: { command: "npm publish" } },
    });

    expect(result.terminalDecision).toBe("allowed");
    expect(result.warnings).toEqual(["This command may have side effects."]);
    expect(result.matchedRuleIds).toEqual(["warn-risky-command"]);
  });

  it("modifies payload using append_arg transform (SC-003)", () => {
    const rule = makeRule({
      id: "modify-append-dry-run",
      action: {
        type: "modify",
        transform: {
          type: "append_arg",
          field: "input.command",
          value: "--dry-run",
        },
      },
    });
    const result = executeRuleAction({
      rule,
      payload: { input: { command: "git push origin main" } },
    });

    expect(result.terminalDecision).toBe("allowed");
    expect((result.payload.input as Record<string, unknown>).command).toBe(
      "git push origin main --dry-run",
    );
    expect(result.matchedRuleIds).toEqual(["modify-append-dry-run"]);
  });

  it("skips modify rule with unsupported transform and emits diagnostic", () => {
    const rule = makeRule({
      id: "bad-transform",
      action: {
        type: "modify",
        transform: {
          type: "shell_eval",
          script: "rm -rf /",
        },
      },
    });
    const result = executeRuleAction({
      rule,
      payload: { input: { command: "echo safe" } },
    });

    expect(result.terminalDecision).toBe("allowed");
    expect(result.matchedRuleIds).toEqual([]);
    expect(result.diagnostics.some((d) => d.code === "HKY_UNKNOWN_TRANSFORM")).toBe(true);
  });
});
