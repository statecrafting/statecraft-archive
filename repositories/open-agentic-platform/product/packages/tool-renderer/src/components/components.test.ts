import { describe, it, expect } from "vitest";
import { formatElapsed } from "./elapsed-time.js";
import { extractFields } from "./input-display.js";
import { selectContentRenderer } from "./result-display.js";
import { shouldAutoCollapse } from "./tool-block.js";
import type { ToolDisplayConfig, ToolInvocation, ToolResult, ContentRenderer } from "../types.js";

// --- formatElapsed ---

describe("formatElapsed", () => {
  it("formats milliseconds", () => {
    expect(formatElapsed(500)).toBe("500ms");
  });

  it("formats seconds", () => {
    expect(formatElapsed(2300)).toBe("2.3s");
  });

  it("formats minutes", () => {
    expect(formatElapsed(125000)).toBe("2m 5s");
  });

  it("formats sub-second", () => {
    expect(formatElapsed(0)).toBe("0ms");
  });
});

// --- extractFields ---

describe("extractFields", () => {
  it("extracts specified fields from input (FR-003)", () => {
    const result = extractFields(["command"], { command: "ls -la", timeout: 5000 });
    expect(result).toEqual([{ field: "command", value: "ls -la" }]);
  });

  it("skips missing fields", () => {
    const result = extractFields(["command", "description"], { command: "ls" });
    expect(result).toEqual([{ field: "command", value: "ls" }]);
  });

  it("stringifies non-string values", () => {
    const result = extractFields(["count"], { count: 42 });
    expect(result).toEqual([{ field: "count", value: "42" }]);
  });

  it("returns empty for no matching fields", () => {
    const result = extractFields(["missing"], { other: "value" });
    expect(result).toEqual([]);
  });

  it("handles multiple fields", () => {
    const result = extractFields(["file_path", "offset"], { file_path: "/a.ts", offset: 10 });
    expect(result).toHaveLength(2);
  });
});

// --- selectContentRenderer ---

describe("selectContentRenderer", () => {
  const makeRenderer = (id: string): ContentRenderer => ({ id, render: () => null });
  const lookup = (id: string): ContentRenderer | undefined => {
    const renderers: Record<string, ContentRenderer> = {
      code: makeRenderer("code"),
      error: makeRenderer("error"),
      text: makeRenderer("text"),
    };
    return renderers[id];
  };

  it("uses error renderer for error results (FR-004)", () => {
    const result: ToolResult = { content: "fail", isError: true };
    const config = { contentRenderer: "code", maxCollapsedLines: 20 };
    const renderer = selectContentRenderer(result, config, lookup);
    expect(renderer?.id).toBe("error");
  });

  it("uses config renderer for normal results", () => {
    const result: ToolResult = { content: "ok" };
    const config = { contentRenderer: "code", maxCollapsedLines: 20 };
    const renderer = selectContentRenderer(result, config, lookup);
    expect(renderer?.id).toBe("code");
  });

  it("falls back to text for unknown renderer", () => {
    const result: ToolResult = { content: "ok" };
    const config = { contentRenderer: "unknown", maxCollapsedLines: 20 };
    const renderer = selectContentRenderer(result, config, lookup);
    expect(renderer?.id).toBe("text");
  });
});

// --- shouldAutoCollapse ---

describe("shouldAutoCollapse", () => {
  const baseConfig: ToolDisplayConfig = {
    toolId: "Bash",
    label: "Bash",
    icon: "terminal",
    accentColor: "#000",
    inputDisplay: { fields: ["command"], format: "inline" },
    resultDisplay: { contentRenderer: "code", maxCollapsedLines: 20 },
    collapse: { defaultState: "expanded", collapseThreshold: 50 },
  };

  it("returns true when defaultState is collapsed", () => {
    const config = { ...baseConfig, collapse: { defaultState: "collapsed" as const, collapseThreshold: 50 } };
    const inv: ToolInvocation = { id: "1", toolId: "Bash", input: {}, startedAt: 0 };
    expect(shouldAutoCollapse(inv, config)).toBe(true);
  });

  it("returns true when result exceeds threshold", () => {
    const longContent = Array(100).fill("line").join("\n");
    const inv: ToolInvocation = {
      id: "1", toolId: "Bash", input: {}, startedAt: 0,
      result: { content: longContent },
    };
    expect(shouldAutoCollapse(inv, baseConfig)).toBe(true);
  });

  it("returns false when result is under threshold", () => {
    const inv: ToolInvocation = {
      id: "1", toolId: "Bash", input: {}, startedAt: 0,
      result: { content: "short output" },
    };
    expect(shouldAutoCollapse(inv, baseConfig)).toBe(false);
  });

  it("returns false when no result yet", () => {
    const inv: ToolInvocation = { id: "1", toolId: "Bash", input: {}, startedAt: 0 };
    expect(shouldAutoCollapse(inv, baseConfig)).toBe(false);
  });
});
