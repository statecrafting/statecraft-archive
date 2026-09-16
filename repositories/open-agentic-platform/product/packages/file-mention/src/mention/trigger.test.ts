import { describe, it, expect, beforeEach } from "vitest";
import { createMentionTrigger, findTriggerAt } from "./trigger.js";
import { MentionSearchIndex } from "../fuzzy/engine.js";

describe("findTriggerAt", () => {
  it("finds @ at start of text", () => {
    expect(findTriggerAt("@foo", 4)).toBe(0);
  });

  it("finds @ after space", () => {
    expect(findTriggerAt("hello @foo", 10)).toBe(6);
  });

  it("returns null for email-like patterns", () => {
    expect(findTriggerAt("user@domain", 11)).toBeNull();
  });

  it("returns null when no @", () => {
    expect(findTriggerAt("hello world", 11)).toBeNull();
  });

  it("returns null when space between @ and cursor", () => {
    expect(findTriggerAt("@foo bar", 8)).toBeNull();
  });

  it("finds @ with empty query (just typed @)", () => {
    expect(findTriggerAt("@", 1)).toBe(0);
  });

  it("finds @ after newline", () => {
    expect(findTriggerAt("hello\n@foo", 10)).toBe(6);
  });

  it("returns null for @ preceded by alphanumeric", () => {
    expect(findTriggerAt("abc@def", 7)).toBeNull();
  });
});

describe("createMentionTrigger", () => {
  let index: MentionSearchIndex;

  beforeEach(() => {
    index = new MentionSearchIndex();
    index.rebuild(
      ["src/components/Button.tsx", "src/utils/format.ts", "README.md"],
      [{ agentId: "builder", displayName: "builder", avatar: "🤖" }],
    );
  });

  it("returns inactive state when no @", () => {
    const trigger = createMentionTrigger(index);
    const state = trigger.onInput("hello world", 11);
    expect(state.active).toBe(false);
  });

  it("activates on @ (FR-001)", () => {
    const trigger = createMentionTrigger(index);
    const state = trigger.onInput("@", 1);
    expect(state.active).toBe(true);
    if (state.active) {
      expect(state.query).toBe("");
      expect(state.anchorPosition).toBe(0);
      expect(state.candidates.length).toBeGreaterThan(0);
    }
  });

  it("extracts query after @", () => {
    const trigger = createMentionTrigger(index);
    const state = trigger.onInput("@btn", 4);
    expect(state.active).toBe(true);
    if (state.active) {
      expect(state.query).toBe("btn");
    }
  });

  it("returns fuzzy-matched candidates", () => {
    const trigger = createMentionTrigger(index);
    const state = trigger.onInput("@btn", 4);
    expect(state.active).toBe(true);
    if (state.active) {
      expect(state.candidates.length).toBeGreaterThanOrEqual(1);
      const first = state.candidates[0]!;
      expect(first.candidate.type).toBe("file");
      if (first.candidate.type === "file") {
        expect(first.candidate.relativePath).toContain("Button");
      }
    }
  });

  it("includes agents in candidates", () => {
    const trigger = createMentionTrigger(index);
    const state = trigger.onInput("@build", 6);
    expect(state.active).toBe(true);
    if (state.active) {
      const agentMatch = state.candidates.find((c) => c.candidate.type === "agent");
      expect(agentMatch).toBeDefined();
    }
  });

  it("deactivates when space is typed after query", () => {
    const trigger = createMentionTrigger(index);
    const state = trigger.onInput("@btn ", 5);
    expect(state.active).toBe(false);
  });

  it("works mid-sentence", () => {
    const trigger = createMentionTrigger(index);
    const state = trigger.onInput("check @btn", 10);
    expect(state.active).toBe(true);
    if (state.active) {
      expect(state.query).toBe("btn");
      expect(state.anchorPosition).toBe(6);
    }
  });

  it("respects limit parameter", () => {
    const trigger = createMentionTrigger(index, 2);
    const state = trigger.onInput("@", 1);
    expect(state.active).toBe(true);
    if (state.active) {
      expect(state.candidates.length).toBeLessThanOrEqual(2);
    }
  });
});
