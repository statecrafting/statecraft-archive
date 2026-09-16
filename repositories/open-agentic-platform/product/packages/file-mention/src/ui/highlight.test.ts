import { describe, it, expect } from "vitest";
import { highlightText, candidateDisplayText } from "./highlight.js";

describe("highlightText", () => {
  it("returns single unhighlighted segment for no ranges", () => {
    expect(highlightText("hello", [])).toEqual([
      { text: "hello", highlighted: false },
    ]);
  });

  it("highlights a single range", () => {
    expect(highlightText("hello", [[0, 3]])).toEqual([
      { text: "hel", highlighted: true },
      { text: "lo", highlighted: false },
    ]);
  });

  it("highlights multiple ranges", () => {
    expect(highlightText("abcdef", [[0, 2], [4, 6]])).toEqual([
      { text: "ab", highlighted: true },
      { text: "cd", highlighted: false },
      { text: "ef", highlighted: true },
    ]);
  });

  it("highlights entire text", () => {
    expect(highlightText("abc", [[0, 3]])).toEqual([
      { text: "abc", highlighted: true },
    ]);
  });

  it("handles ranges at end", () => {
    expect(highlightText("abcd", [[2, 4]])).toEqual([
      { text: "ab", highlighted: false },
      { text: "cd", highlighted: true },
    ]);
  });

  it("clamps out-of-bounds ranges", () => {
    const result = highlightText("abc", [[0, 10]]);
    expect(result).toEqual([{ text: "abc", highlighted: true }]);
  });
});

describe("candidateDisplayText", () => {
  it("returns relativePath for files", () => {
    expect(
      candidateDisplayText({ type: "file", relativePath: "src/app.ts" }),
    ).toBe("src/app.ts");
  });

  it("returns displayName for agents", () => {
    expect(
      candidateDisplayText({ type: "agent", displayName: "Builder" }),
    ).toBe("Builder");
  });
});
