import { describe, expect, it } from "vitest";
import { evaluate } from "./engine.js";
import type { HookEvent, Rule } from "./types.js";

function baseRule(overrides: Partial<Rule>): Rule {
  return {
    id: "rule",
    event: "PreToolUse",
    matcher: { tool: "Bash" },
    conditions: { all: [{ field: "input.command", contains: "git" }] },
    action: { type: "warn" },
    priority: 10,
    rationale: "Rationale",
    sourcePath: "rules/rule.md",
    ...overrides,
  };
}

function event(payload: Record<string, unknown>): HookEvent {
  return { type: "PreToolUse", payload };
}

describe("evaluate", () => {
  it("runs lower priority numbers before higher (ascending priority order)", () => {
    const rules: Rule[] = [
      baseRule({
        id: "second",
        priority: 20,
        action: { type: "warn" },
        rationale: "second",
      }),
      baseRule({
        id: "first",
        priority: 10,
        action: { type: "warn" },
        rationale: "first",
      }),
    ];
    const ev = event({ tool: "Bash", input: { command: "git status" } });
    const result = evaluate({ rules, event: ev });

    expect(result.warnings).toEqual(["first", "second"]);
    expect(result.matchedRuleIds).toEqual(["first", "second"]);
  });

  it("tie-breaks equal priority by rule id then source path", () => {
    const rules: Rule[] = [
      baseRule({
        id: "b",
        priority: 5,
        sourcePath: "z.md",
        rationale: "b",
      }),
      baseRule({
        id: "a",
        priority: 5,
        sourcePath: "a.md",
        rationale: "a",
      }),
    ];
    const ev = event({ tool: "Bash", input: { command: "git log" } });
    const result = evaluate({ rules, event: ev });

    expect(result.warnings).toEqual(["a", "b"]);
  });

  it("short-circuits on block: later rules do not run", () => {
    const rules: Rule[] = [
      baseRule({
        id: "blocker",
        priority: 10,
        action: { type: "block" },
        rationale: "Stopped here.",
      }),
      baseRule({
        id: "late-warn",
        priority: 20,
        action: { type: "warn" },
        rationale: "Never runs",
      }),
    ];
    const ev = event({ tool: "Bash", input: { command: "git push --force" } });
    const result = evaluate({ rules, event: ev });

    expect(result.allowed).toBe(false);
    expect(result.terminalDecision).toBe("blocked");
    expect(result.blockedByRuleId).toBe("blocker");
    expect(result.blockRationale).toBe("Stopped here.");
    expect(result.matchedRuleIds).toEqual(["blocker"]);
    expect(result.warnings).toEqual([]);
  });

  it("threads modified payload into matcher/conditions for later rules", () => {
    const rules: Rule[] = [
      baseRule({
        id: "add-flag",
        priority: 10,
        conditions: { all: [{ field: "input.command", contains: "git push" }] },
        action: {
          type: "modify",
          transform: { type: "append_arg", field: "input.command", value: "--dry-run" },
        },
        rationale: "append",
      }),
      baseRule({
        id: "match-after-mod",
        priority: 20,
        conditions: { all: [{ field: "input.command", contains: "--dry-run" }] },
        action: { type: "warn" },
        rationale: "saw dry-run",
      }),
    ];
    const ev = event({ tool: "Bash", input: { command: "git push origin main" } });
    const result = evaluate({ rules, event: ev });

    expect((result.payload.input as Record<string, unknown>).command).toBe(
      "git push origin main --dry-run",
    );
    expect(result.warnings).toContain("saw dry-run");
    expect(result.matchedRuleIds).toEqual(["add-flag", "match-after-mod"]);
  });

  it("skips rules when matcher does not match (non-fatal)", () => {
    const rules: Rule[] = [
      baseRule({
        id: "bash-only",
        matcher: { tool: "Bash" },
        rationale: "ok",
      }),
      baseRule({
        id: "other-tool",
        matcher: { tool: "Read" },
        priority: 5,
        rationale: "skip",
      }),
    ];
    const ev = event({ tool: "Bash", input: { command: "git diff" } });
    const result = evaluate({ rules, event: ev });

    expect(result.warnings).toEqual(["ok"]);
    expect(result.matchedRuleIds).toEqual(["bash-only"]);
  });

  it("skips rules when conditions do not match", () => {
    const rules: Rule[] = [
      baseRule({
        id: "no-match",
        conditions: { all: [{ field: "input.command", contains: "npm" }] },
        rationale: "skip",
      }),
      baseRule({
        id: "yes-match",
        priority: 20,
        conditions: { all: [{ field: "input.command", contains: "git" }] },
        rationale: "kept",
      }),
    ];
    const ev = event({ tool: "Bash", input: { command: "git status" } });
    const result = evaluate({ rules, event: ev });

    expect(result.warnings).toEqual(["kept"]);
    expect(result.matchedRuleIds).toEqual(["yes-match"]);
  });
});
