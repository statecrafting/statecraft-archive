import { describe, it, expect } from "vitest";
import { fuzzyScore, scoreFilePath, scoreAgent } from "./scoring.js";

describe("fuzzyScore", () => {
  it("returns null when query doesn't match", () => {
    expect(fuzzyScore("xyz", "abc")).toBeNull();
  });

  it("returns score 0 for empty query", () => {
    const result = fuzzyScore("", "anything");
    expect(result).toEqual({ score: 0, matchedRanges: [] });
  });

  it("returns null when query is longer than text", () => {
    expect(fuzzyScore("abcdef", "abc")).toBeNull();
  });

  it("matches exact string", () => {
    const result = fuzzyScore("abc", "abc");
    expect(result).not.toBeNull();
    expect(result!.score).toBeGreaterThan(0);
  });

  it("matches non-contiguous characters (FR-004)", () => {
    const result = fuzzyScore("cmp", "components");
    expect(result).not.toBeNull();
    expect(result!.score).toBeGreaterThan(0);
  });

  it("is case-insensitive", () => {
    const result = fuzzyScore("BTN", "Button");
    expect(result).not.toBeNull();
  });

  it("scores consecutive matches higher than gaps", () => {
    const consecutive = fuzzyScore("abc", "abcdef");
    const gapped = fuzzyScore("abc", "axbxcx");
    expect(consecutive).not.toBeNull();
    expect(gapped).not.toBeNull();
    expect(consecutive!.score).toBeGreaterThan(gapped!.score);
  });

  it("returns matched ranges", () => {
    const result = fuzzyScore("ab", "ab");
    expect(result).not.toBeNull();
    expect(result!.matchedRanges).toEqual([[0, 2]]);
  });

  it("returns non-contiguous ranges for gapped matches", () => {
    const result = fuzzyScore("ac", "abc");
    expect(result).not.toBeNull();
    expect(result!.matchedRanges.length).toBeGreaterThanOrEqual(1);
  });

  it("gives segment start bonus", () => {
    const segStart = fuzzyScore("b", "a/b");
    const midSegment = fuzzyScore("b", "ab");
    expect(segStart).not.toBeNull();
    expect(midSegment).not.toBeNull();
    expect(segStart!.score).toBeGreaterThan(midSegment!.score);
  });
});

describe("scoreFilePath", () => {
  it("boosts basename matches (FR-004)", () => {
    const basenameMatch = scoreFilePath("btn", "src/components/Button.tsx");
    const dirMatch = scoreFilePath("src", "src/components/Button.tsx");
    expect(basenameMatch).not.toBeNull();
    expect(dirMatch).not.toBeNull();
    // basename "Button" contains "btn" and gets boosted
    expect(basenameMatch!.score).toBeGreaterThan(dirMatch!.score);
  });

  it("falls back to full path when basename doesn't match", () => {
    const result = scoreFilePath("scb", "src/components/Button.tsx");
    expect(result).not.toBeNull();
    expect(result!.score).toBeGreaterThan(0);
  });

  it("offsets ranges for basename matches", () => {
    const result = scoreFilePath("btn", "src/Button.tsx");
    expect(result).not.toBeNull();
    // Ranges should be in the "Button.tsx" portion (offset 4+)
    for (const [start] of result!.matchedRanges) {
      expect(start).toBeGreaterThanOrEqual(4); // "src/" = 4 chars
    }
  });

  it("handles files without directory prefix", () => {
    const result = scoreFilePath("read", "README.md");
    expect(result).not.toBeNull();
    expect(result!.score).toBeGreaterThan(0);
  });

  it("SC-002: '@btn' surfaces Button.tsx highly", () => {
    const files = [
      "src/components/Button.tsx",
      "src/utils/buildConfig.ts",
      "src/lib/batch.ts",
      "package.json",
      "README.md",
    ];
    const scores = files.map((f) => ({
      path: f,
      result: scoreFilePath("btn", f),
    }));
    const buttonScore = scores.find((s) => s.path.includes("Button"))!;
    expect(buttonScore.result).not.toBeNull();
    // Button should be top or near top
    const validScores = scores.filter((s) => s.result !== null);
    validScores.sort((a, b) => b.result!.score - a.result!.score);
    const buttonRank = validScores.findIndex((s) => s.path.includes("Button"));
    expect(buttonRank).toBeLessThanOrEqual(2); // Top 3
  });
});

describe("scoreAgent", () => {
  it("matches agent display name", () => {
    const result = scoreAgent("build", "build-agent");
    expect(result).not.toBeNull();
    expect(result!.score).toBeGreaterThan(0);
  });

  it("returns null for non-matching query", () => {
    expect(scoreAgent("xyz", "build-agent")).toBeNull();
  });
});
