import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  buildPrompt,
  generateCommitMessage,
  MAX_DIFF_SIZE,
} from "./commit-message.js";
import type { CommitMessageProvider } from "../types.js";

vi.mock("../backend/plumbing.js", () => ({
  stagedDiff: vi.fn().mockResolvedValue(""),
  gitLog: vi.fn().mockResolvedValue(""),
}));

import { stagedDiff, gitLog } from "../backend/plumbing.js";

const mockStagedDiff = vi.mocked(stagedDiff);
const mockGitLog = vi.mocked(gitLog);

describe("buildPrompt", () => {
  it("includes the diff", () => {
    const prompt = buildPrompt("+ new line", []);
    expect(prompt).toContain("+ new line");
    expect(prompt).toContain("Staged diff:");
  });

  it("includes recent commit messages as examples", () => {
    const prompt = buildPrompt("+ change", [
      "feat: add thing",
      "fix: broken stuff",
    ]);
    expect(prompt).toContain("feat: add thing");
    expect(prompt).toContain("fix: broken stuff");
    expect(prompt).toContain("style reference");
  });

  it("omits example section when no recent messages", () => {
    const prompt = buildPrompt("+ change", []);
    expect(prompt).not.toContain("style reference");
  });

  it("truncates large diffs", () => {
    const largeDiff = "x".repeat(MAX_DIFF_SIZE + 1000);
    const prompt = buildPrompt(largeDiff, []);
    expect(prompt).toContain("[diff truncated]");
    expect(prompt.length).toBeLessThan(MAX_DIFF_SIZE + 500);
  });

  it("includes conventional commit format instructions", () => {
    const prompt = buildPrompt("diff", []);
    expect(prompt).toContain("conventional commit");
    expect(prompt).toContain("feat, fix, refactor");
  });
});

describe("generateCommitMessage", () => {
  const cwd = "/repo";
  let provider: CommitMessageProvider;

  beforeEach(() => {
    vi.clearAllMocks();
    provider = {
      generateCommitMessage: vi.fn().mockResolvedValue("feat: generated message"),
    };
  });

  it("generates a commit message from staged diff", async () => {
    mockStagedDiff.mockResolvedValue("+ new code\n");
    mockGitLog.mockResolvedValue(
      `hash1\x00h1\x00A\x00a@t.com\x001111\x00p1\x00feat: prev\x01\n`,
    );

    const result = await generateCommitMessage(cwd, provider);
    expect(result).toBe("feat: generated message");
    expect(provider.generateCommitMessage).toHaveBeenCalledWith(
      "+ new code\n",
      ["feat: prev"],
    );
  });

  it("throws when no staged changes", async () => {
    mockStagedDiff.mockResolvedValue("");
    await expect(generateCommitMessage(cwd, provider)).rejects.toThrow(
      "No staged changes",
    );
  });

  it("passes empty examples when no log history", async () => {
    mockStagedDiff.mockResolvedValue("+ code\n");
    mockGitLog.mockResolvedValue("");

    await generateCommitMessage(cwd, provider);
    expect(provider.generateCommitMessage).toHaveBeenCalledWith(
      "+ code\n",
      [],
    );
  });

  it("respects custom example count", async () => {
    mockStagedDiff.mockResolvedValue("+ code\n");
    mockGitLog.mockResolvedValue("");

    await generateCommitMessage(cwd, provider, 10);
    expect(mockGitLog).toHaveBeenCalledWith(cwd, 10);
  });
});
