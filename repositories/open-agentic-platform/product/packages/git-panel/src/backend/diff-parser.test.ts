import { describe, it, expect } from "vitest";
import { parseDiff, buildHunkPatch } from "./diff-parser.js";

describe("parseDiff", () => {
  it("parses a single-file diff with one hunk", () => {
    const raw = [
      "diff --git a/src/index.ts b/src/index.ts",
      "index abc1234..def5678 100644",
      "--- a/src/index.ts",
      "+++ b/src/index.ts",
      "@@ -1,3 +1,4 @@",
      " line1",
      "-old line",
      "+new line",
      "+added line",
      " line3",
    ].join("\n");

    const files = parseDiff(raw);
    expect(files).toHaveLength(1);
    expect(files[0]!.oldPath).toBe("src/index.ts");
    expect(files[0]!.newPath).toBe("src/index.ts");
    expect(files[0]!.isBinary).toBe(false);
    expect(files[0]!.hunks).toHaveLength(1);

    const hunk = files[0]!.hunks[0]!;
    expect(hunk.range).toEqual({
      oldStart: 1,
      oldCount: 3,
      newStart: 1,
      newCount: 4,
    });
    expect(hunk.lines).toHaveLength(5);
    expect(hunk.lines[0]!.type).toBe("context");
    expect(hunk.lines[1]!.type).toBe("deletion");
    expect(hunk.lines[2]!.type).toBe("addition");
    expect(hunk.lines[3]!.type).toBe("addition");
    expect(hunk.lines[4]!.type).toBe("context");
  });

  it("parses multiple hunks", () => {
    const raw = [
      "diff --git a/file.ts b/file.ts",
      "--- a/file.ts",
      "+++ b/file.ts",
      "@@ -1,2 +1,2 @@",
      "-old1",
      "+new1",
      " same",
      "@@ -10,2 +10,3 @@",
      " ctx",
      "+added",
      " ctx2",
    ].join("\n");

    const files = parseDiff(raw);
    expect(files[0]!.hunks).toHaveLength(2);
    expect(files[0]!.hunks[1]!.range.oldStart).toBe(10);
  });

  it("parses multiple files", () => {
    const raw = [
      "diff --git a/a.ts b/a.ts",
      "--- a/a.ts",
      "+++ b/a.ts",
      "@@ -1,1 +1,1 @@",
      "-old",
      "+new",
      "diff --git a/b.ts b/b.ts",
      "--- a/b.ts",
      "+++ b/b.ts",
      "@@ -1,1 +1,2 @@",
      " existing",
      "+added",
    ].join("\n");

    const files = parseDiff(raw);
    expect(files).toHaveLength(2);
    expect(files[0]!.oldPath).toBe("a.ts");
    expect(files[1]!.oldPath).toBe("b.ts");
  });

  it("detects binary files", () => {
    const raw = [
      "diff --git a/img.png b/img.png",
      "index abc..def 100644",
      "Binary files a/img.png and b/img.png differ",
    ].join("\n");

    const files = parseDiff(raw);
    expect(files).toHaveLength(1);
    expect(files[0]!.isBinary).toBe(true);
    expect(files[0]!.hunks).toHaveLength(0);
  });

  it("handles empty diff", () => {
    expect(parseDiff("")).toEqual([]);
    expect(parseDiff("\n")).toEqual([]);
  });

  it("tracks line numbers correctly", () => {
    const raw = [
      "diff --git a/f.ts b/f.ts",
      "--- a/f.ts",
      "+++ b/f.ts",
      "@@ -5,3 +5,4 @@",
      " ctx",
      "-del",
      "+add1",
      "+add2",
      " ctx2",
    ].join("\n");

    const lines = parseDiff(raw)[0]!.hunks[0]!.lines;
    expect(lines[0]!.oldLineNumber).toBe(5);
    expect(lines[0]!.newLineNumber).toBe(5);
    expect(lines[1]!.oldLineNumber).toBe(6); // deletion
    expect(lines[1]!.newLineNumber).toBeUndefined();
    expect(lines[2]!.newLineNumber).toBe(6); // addition
    expect(lines[2]!.oldLineNumber).toBeUndefined();
    expect(lines[3]!.newLineNumber).toBe(7); // addition
    expect(lines[4]!.oldLineNumber).toBe(7); // context
    expect(lines[4]!.newLineNumber).toBe(8);
  });

  it("handles 'no newline at end of file' marker", () => {
    const raw = [
      "diff --git a/f.ts b/f.ts",
      "--- a/f.ts",
      "+++ b/f.ts",
      "@@ -1,1 +1,1 @@",
      "-old",
      "\\ No newline at end of file",
      "+new",
    ].join("\n");

    const lines = parseDiff(raw)[0]!.hunks[0]!.lines;
    expect(lines).toHaveLength(2);
    expect(lines[0]!.type).toBe("deletion");
    expect(lines[1]!.type).toBe("addition");
  });

  it("parses renamed files", () => {
    const raw = [
      "diff --git a/old.ts b/new.ts",
      "similarity index 90%",
      "rename from old.ts",
      "rename to new.ts",
      "--- a/old.ts",
      "+++ b/new.ts",
      "@@ -1,1 +1,1 @@",
      "-old content",
      "+new content",
    ].join("\n");

    const files = parseDiff(raw);
    expect(files[0]!.oldPath).toBe("old.ts");
    expect(files[0]!.newPath).toBe("new.ts");
  });

  it("handles hunk header with function context", () => {
    const raw = [
      "diff --git a/f.ts b/f.ts",
      "--- a/f.ts",
      "+++ b/f.ts",
      "@@ -10,3 +10,4 @@ function foo() {",
      " line",
      "+added",
      " line",
      " line",
    ].join("\n");

    const hunk = parseDiff(raw)[0]!.hunks[0]!;
    expect(hunk.header).toContain("function foo()");
    expect(hunk.range.oldStart).toBe(10);
  });
});

describe("buildHunkPatch", () => {
  it("builds a patch for selected hunks", () => {
    const fileDiff = parseDiff([
      "diff --git a/f.ts b/f.ts",
      "--- a/f.ts",
      "+++ b/f.ts",
      "@@ -1,2 +1,2 @@",
      "-old1",
      "+new1",
      " same",
      "@@ -10,2 +10,3 @@",
      " ctx",
      "+added",
      " ctx2",
    ].join("\n"))[0]!;

    // Only select the second hunk
    const patch = buildHunkPatch(fileDiff, [1]);
    expect(patch).toContain("diff --git a/f.ts b/f.ts");
    expect(patch).toContain("@@ -10,2 +10,3 @@");
    expect(patch).not.toContain("@@ -1,2 +1,2 @@");
  });

  it("builds a patch with multiple hunks", () => {
    const fileDiff = parseDiff([
      "diff --git a/f.ts b/f.ts",
      "--- a/f.ts",
      "+++ b/f.ts",
      "@@ -1,1 +1,1 @@",
      "-a",
      "+b",
      "@@ -5,1 +5,1 @@",
      "-c",
      "+d",
    ].join("\n"))[0]!;

    const patch = buildHunkPatch(fileDiff, [0, 1]);
    expect(patch).toContain("@@ -1,1 +1,1 @@");
    expect(patch).toContain("@@ -5,1 +5,1 @@");
  });

  it("skips invalid hunk indices", () => {
    const fileDiff = parseDiff([
      "diff --git a/f.ts b/f.ts",
      "--- a/f.ts",
      "+++ b/f.ts",
      "@@ -1,1 +1,1 @@",
      "-a",
      "+b",
    ].join("\n"))[0]!;

    const patch = buildHunkPatch(fileDiff, [0, 99]);
    expect(patch).toContain("@@ -1,1 +1,1 @@");
  });
});
