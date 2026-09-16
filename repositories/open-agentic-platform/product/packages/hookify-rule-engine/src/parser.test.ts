import { describe, expect, it } from "vitest";
import { parseRuleFile, parseRuleSet } from "./parser.js";

const VALID_RULE = `---
id: block-force-push
event: PreToolUse
matcher:
  tool: Bash
conditions:
  - field: input.command
    matches: "git push.*--force"
action:
  type: block
priority: 10
---
Force-pushing rewrites remote history. Use --force-with-lease instead.
`;

describe("parseRuleFile", () => {
  it("parses a valid markdown rule (FR-001)", () => {
    const result = parseRuleFile(VALID_RULE, "rules/block-force-push.md");
    expect(result.diagnostics).toHaveLength(0);
    expect(result.rule).not.toBeNull();
    expect(result.rule?.id).toBe("block-force-push");
    expect(result.rule?.event).toBe("PreToolUse");
    expect(result.rule?.action.type).toBe("block");
    expect(result.rule?.priority).toBe(10);
  });

  it("preserves markdown body as rationale (NF-002)", () => {
    const result = parseRuleFile(VALID_RULE, "rules/block-force-push.md");
    expect(result.rule?.rationale).toContain("Force-pushing rewrites remote history");
  });

  it("normalizes flat conditions arrays as implicit AND", () => {
    const result = parseRuleFile(VALID_RULE, "rules/block-force-push.md");
    expect(result.rule?.conditions).toEqual({
      all: [{ field: "input.command", matches: "git push.*--force" }],
    });
  });

  it("parses explicit any/not combinators", () => {
    const combinators = `---
id: combinators
event: PreToolUse
matcher: {}
conditions:
  any:
    - field: input.command
      contains: "git push"
    - not:
        field: tool.name
        ==: "Read"
action:
  type: warn
priority: 5
---
Combinator coverage.`;
    const result = parseRuleFile(combinators, "rules/combinators.md");
    expect(result.diagnostics).toHaveLength(0);
    expect(result.rule?.conditions).toEqual({
      any: [
        { field: "input.command", contains: "git push" },
        { not: { field: "tool.name", "==": "Read" } },
      ],
    });
  });

  it("reports malformed YAML and skips rule (FR-009)", () => {
    const malformed = `---
id: bad
event: PreToolUse
matcher: [unclosed
---
oops`;
    const result = parseRuleFile(malformed, "rules/bad.md");
    expect(result.rule).toBeNull();
    expect(result.diagnostics.some((d) => d.code === "HKY_YAML_PARSE_ERROR")).toBe(
      true,
    );
  });

  it("reports missing required fields", () => {
    const missing = `---
id: missing
event: PreToolUse
priority: 1
---
Missing matcher, conditions, and action.`;
    const result = parseRuleFile(missing, "rules/missing.md");
    expect(result.rule).toBeNull();
    expect(result.diagnostics.map((d) => d.code)).toEqual(
      expect.arrayContaining(["HKY_MISSING_MATCHER", "HKY_MISSING_ACTION"]),
    );
  });

  it("rejects invalid action type", () => {
    const invalidAction = `---
id: invalid-action
event: PreToolUse
matcher: {}
conditions:
  - field: input.command
    contains: "rm -rf"
action:
  type: explode
priority: 1
---
Nope.`;
    const result = parseRuleFile(invalidAction, "rules/invalid-action.md");
    expect(result.rule).toBeNull();
    expect(result.diagnostics.some((d) => d.code === "HKY_INVALID_ACTION")).toBe(
      true,
    );
  });

  it("rejects invalid event name", () => {
    const invalidEvent = `---
id: invalid-event
event: BeforeEverything
matcher: {}
conditions:
  - field: input.command
    contains: "rm -rf"
action:
  type: warn
priority: 1
---
Nope.`;
    const result = parseRuleFile(invalidEvent, "rules/invalid-event.md");
    expect(result.rule).toBeNull();
    expect(result.diagnostics.some((d) => d.code === "HKY_INVALID_EVENT")).toBe(
      true,
    );
  });

  it("rejects malformed condition objects", () => {
    const badCondition = `---
id: invalid-condition
event: PreToolUse
matcher: {}
conditions:
  - field: input.command
    contains: "git"
    matches: "git.*"
action:
  type: warn
priority: 1
---
Nope.`;
    const result = parseRuleFile(badCondition, "rules/invalid-condition.md");
    expect(result.rule).toBeNull();
    expect(
      result.diagnostics.some((d) => d.code === "HKY_INVALID_CONDITION_OPERATOR"),
    ).toBe(true);
  });
});

describe("parseRuleSet", () => {
  it("detects duplicate rule IDs and keeps pipeline alive (FR-009)", () => {
    const { rules, diagnostics } = parseRuleSet([
      { path: "rules/a.md", content: VALID_RULE },
      { path: "rules/b.md", content: VALID_RULE.replace("priority: 10", "priority: 20") },
    ]);
    expect(rules).toHaveLength(1);
    expect(diagnostics.some((d) => d.code === "HKY_DUPLICATE_RULE_ID")).toBe(true);
  });

  it("is a pure parser/validator for synthetic inputs (NF-003)", () => {
    const a = parseRuleFile(VALID_RULE, "rules/block-force-push.md");
    const b = parseRuleFile(VALID_RULE, "rules/block-force-push.md");
    expect(a).toEqual(b);
  });
});
