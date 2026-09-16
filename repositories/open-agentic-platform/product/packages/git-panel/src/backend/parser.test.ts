import { describe, it, expect } from "vitest";
import {
  parseNameStatus,
  parseUntrackedFiles,
  parseLog,
  parseBranches,
} from "./parser.js";

describe("parseNameStatus", () => {
  it("parses modified files", () => {
    const output = "M\tsrc/index.ts\nM\tsrc/app.ts\n";
    const result = parseNameStatus(output, false);
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({
      path: "src/index.ts",
      status: "modified",
      staged: false,
    });
  });

  it("parses added files", () => {
    const output = "A\tnew-file.ts\n";
    const result = parseNameStatus(output, true);
    expect(result[0]).toEqual({
      path: "new-file.ts",
      status: "added",
      staged: true,
    });
  });

  it("parses deleted files", () => {
    const output = "D\told-file.ts\n";
    const result = parseNameStatus(output, false);
    expect(result[0]!.status).toBe("deleted");
  });

  it("parses renamed files with old and new paths", () => {
    const output = "R100\told-name.ts\tnew-name.ts\n";
    const result = parseNameStatus(output, true);
    expect(result[0]).toEqual({
      path: "new-name.ts",
      oldPath: "old-name.ts",
      status: "renamed",
      staged: true,
    });
  });

  it("parses copied files", () => {
    const output = "C100\tsrc.ts\tdest.ts\n";
    const result = parseNameStatus(output, true);
    expect(result[0]!.status).toBe("copied");
    expect(result[0]!.oldPath).toBe("src.ts");
    expect(result[0]!.path).toBe("dest.ts");
  });

  it("handles empty output", () => {
    expect(parseNameStatus("", false)).toEqual([]);
    expect(parseNameStatus("\n", true)).toEqual([]);
  });

  it("handles mixed statuses", () => {
    const output = "A\ta.ts\nM\tb.ts\nD\tc.ts\n";
    const result = parseNameStatus(output, true);
    expect(result).toHaveLength(3);
    expect(result[0]!.status).toBe("added");
    expect(result[1]!.status).toBe("modified");
    expect(result[2]!.status).toBe("deleted");
  });
});

describe("parseUntrackedFiles", () => {
  it("parses file list", () => {
    const output = "untracked1.ts\nsome/path/file.js\n";
    const result = parseUntrackedFiles(output);
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({
      path: "untracked1.ts",
      status: "untracked",
      staged: false,
    });
  });

  it("handles empty output", () => {
    expect(parseUntrackedFiles("")).toEqual([]);
    expect(parseUntrackedFiles("\n")).toEqual([]);
  });
});

describe("parseLog", () => {
  const NUL = "\x00";
  const SEP = "\x01"; // record separator

  it("parses single commit", () => {
    const output =
      `abc123def456${NUL}abc123d${NUL}Alice${NUL}alice@test.com${NUL}1234567890${NUL}parent1${NUL}feat: add stuff${SEP}\n`;
    const result = parseLog(output);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      hash: "abc123def456",
      abbreviatedHash: "abc123d",
      author: "Alice",
      authorEmail: "alice@test.com",
      date: 1234567890,
      message: "feat: add stuff",
      parentHashes: ["parent1"],
    });
  });

  it("parses multiple commits", () => {
    const output = [
      `hash1${NUL}h1${NUL}A${NUL}a@t.com${NUL}1111${NUL}p1${NUL}msg1${SEP}`,
      `hash2${NUL}h2${NUL}B${NUL}b@t.com${NUL}2222${NUL}p2 p3${NUL}msg2${SEP}`,
    ].join("\n");
    const result = parseLog(output);
    expect(result).toHaveLength(2);
    expect(result[1]!.parentHashes).toEqual(["p2", "p3"]);
  });

  it("handles commit with no parents (root commit)", () => {
    const output = `hash1${NUL}h1${NUL}A${NUL}a@t.com${NUL}1111${NUL}${NUL}initial${SEP}\n`;
    const result = parseLog(output);
    expect(result[0]!.parentHashes).toEqual([]);
  });

  it("handles empty output", () => {
    expect(parseLog("")).toEqual([]);
    expect(parseLog("\n")).toEqual([]);
  });

  it("handles subject-only message", () => {
    const output = `hash1${NUL}h1${NUL}A${NUL}a@t.com${NUL}1111${NUL}p1${NUL}feat: something${SEP}\n`;
    const result = parseLog(output);
    expect(result[0]!.message).toBe("feat: something");
  });
});

describe("parseBranches", () => {
  const NUL = "\x00";

  it("parses branch list with current branch", () => {
    const output = [
      `main${NUL}abc1234${NUL}1234567890${NUL}origin/main`,
      `feature${NUL}def5678${NUL}1234567891${NUL}`,
    ].join("\n");
    const result = parseBranches(output, "main");
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({
      name: "main",
      isCurrent: true,
      upstream: "origin/main",
      lastCommitHash: "abc1234",
      lastCommitDate: 1234567890,
    });
    expect(result[1]!.isCurrent).toBe(false);
    expect(result[1]!.upstream).toBeUndefined();
  });

  it("handles empty output", () => {
    expect(parseBranches("", "main")).toEqual([]);
  });

  it("marks no branch as current when name doesn't match", () => {
    const output = `dev${NUL}abc${NUL}1111${NUL}\n`;
    const result = parseBranches(output, "main");
    expect(result[0]!.isCurrent).toBe(false);
  });
});
