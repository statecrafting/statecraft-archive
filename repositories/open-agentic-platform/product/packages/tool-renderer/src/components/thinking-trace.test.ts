import { describe, it, expect } from "vitest";
import { summarizeThinking } from "./thinking-trace.js";
import type { ThinkingTrace } from "../types.js";

describe("summarizeThinking", () => {
  it("returns first line if short enough", () => {
    expect(summarizeThinking("Short thought")).toBe("Short thought");
  });

  it("truncates long first lines with ellipsis", () => {
    const long = "A".repeat(100);
    const result = summarizeThinking(long, 80);
    expect(result).toHaveLength(80);
    expect(result.endsWith("...")).toBe(true);
  });

  it("uses only first line of multi-line text", () => {
    const text = "First line\nSecond line\nThird line";
    expect(summarizeThinking(text)).toBe("First line");
  });

  it("handles empty text", () => {
    expect(summarizeThinking("")).toBe("");
  });

  it("trims whitespace", () => {
    expect(summarizeThinking("  padded  ")).toBe("padded");
  });
});

describe("ThinkingTrace type (FR-008)", () => {
  it("supports required fields", () => {
    const trace: ThinkingTrace = {
      id: "think-1",
      text: "Let me analyze this problem...",
      startedAt: 1000,
      completedAt: 3500,
    };
    expect(trace.completedAt! - trace.startedAt).toBe(2500);
  });

  it("supports in-progress thinking (SC-005)", () => {
    const trace: ThinkingTrace = {
      id: "think-2",
      text: "Still thinking...",
      startedAt: 1000,
    };
    expect(trace.completedAt).toBeUndefined();
  });
});
