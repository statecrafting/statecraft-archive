import { describe, expect, it } from "vitest";
import { matchesRuleEventType, matchesRuleMatcher } from "./matcher.js";
import type { HookEvent, Matcher } from "./types.js";

describe("matchesRuleEventType", () => {
  it("matches same lifecycle event type", () => {
    const event: HookEvent = { type: "PreToolUse", payload: {} };
    expect(matchesRuleEventType("PreToolUse", event)).toBe(true);
    expect(matchesRuleEventType("PostToolUse", event)).toBe(false);
  });
});

describe("matchesRuleMatcher", () => {
  const event: HookEvent = {
    type: "PreToolUse",
    payload: {
      tool: { name: "Bash" },
      input: { command: "git push --force", cwd: "/repo" },
      output: { exitCode: 0, summary: "ok" },
    },
  };

  it("matches on tool name + input + output selectors", () => {
    const matcher: Matcher = {
      tool: "Bash",
      input: { command: "git push --force" },
      output: { exitCode: 0 },
    };
    expect(matchesRuleMatcher(matcher, event)).toBe(true);
  });

  it("fails when tool name does not match", () => {
    expect(matchesRuleMatcher({ tool: "Read" }, event)).toBe(false);
  });

  it("fails when requested input selector is missing", () => {
    expect(matchesRuleMatcher({ input: { missing: "value" } }, event)).toBe(false);
  });

  it("matches empty matcher as catch-all within event type", () => {
    expect(matchesRuleMatcher({}, event)).toBe(true);
  });
});
