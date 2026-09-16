import { describe, it, expect } from "vitest";
import { parseDiffLines } from "./diff.js";
import { tryParseJson } from "./json.js";
import { builtinRenderers } from "./index.js";

describe("builtinRenderers", () => {
  it("has 7 built-in renderers (FR-005)", () => {
    expect(builtinRenderers).toHaveLength(7);
    const ids = builtinRenderers.map((r) => r.id).sort();
    expect(ids).toEqual(["code", "diff", "error", "image", "json", "markdown", "text"]);
  });

  it("all renderers have a render function", () => {
    for (const renderer of builtinRenderers) {
      expect(typeof renderer.render).toBe("function");
    }
  });
});

describe("parseDiffLines", () => {
  it("classifies added lines", () => {
    const lines = parseDiffLines("+added line");
    expect(lines[0]).toEqual({ type: "added", content: "+added line" });
  });

  it("classifies removed lines", () => {
    const lines = parseDiffLines("-removed line");
    expect(lines[0]).toEqual({ type: "removed", content: "-removed line" });
  });

  it("classifies context lines", () => {
    const lines = parseDiffLines(" context line");
    expect(lines[0]).toEqual({ type: "context", content: " context line" });
  });

  it("classifies header lines", () => {
    const lines = parseDiffLines("--- a/file.ts\n+++ b/file.ts\n@@ -1,3 +1,4 @@");
    expect(lines[0].type).toBe("header");
    expect(lines[1].type).toBe("header");
    expect(lines[2].type).toBe("header");
  });

  it("handles a full diff", () => {
    const diff = `--- a/file.ts
+++ b/file.ts
@@ -1,3 +1,4 @@
 line 1
-old line
+new line
+added line
 line 3`;
    const lines = parseDiffLines(diff);
    expect(lines).toHaveLength(8);
    expect(lines.filter((l) => l.type === "added")).toHaveLength(2);
    expect(lines.filter((l) => l.type === "removed")).toHaveLength(1);
    expect(lines.filter((l) => l.type === "context")).toHaveLength(2);
    expect(lines.filter((l) => l.type === "header")).toHaveLength(3);
  });
});

describe("tryParseJson", () => {
  it("parses valid JSON", () => {
    expect(tryParseJson('{"a": 1}')).toEqual({ a: 1 });
  });

  it("returns undefined for invalid JSON", () => {
    expect(tryParseJson("not json")).toBeUndefined();
  });

  it("handles arrays", () => {
    expect(tryParseJson("[1, 2, 3]")).toEqual([1, 2, 3]);
  });

  it("handles null", () => {
    expect(tryParseJson("null")).toBeNull();
  });
});
