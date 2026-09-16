import { describe, it, expect, vi, beforeEach } from "vitest";
import { createCommitOps } from "./commit.js";

vi.mock("../backend/plumbing.js", () => ({
  createCommit: vi.fn().mockResolvedValue("abc123"),
  gitLog: vi.fn().mockResolvedValue(""),
}));

import { createCommit, gitLog } from "../backend/plumbing.js";

const mockCreateCommit = vi.mocked(createCommit);
const mockGitLog = vi.mocked(gitLog);

const LOG_ENTRY = `abc123def456\x00abc123d\x00Test\x00test@test.com\x001234567890\x00parent1\x00feat: test\x01\n`;

describe("createCommitOps", () => {
  const cwd = "/repo";
  let ops: ReturnType<typeof createCommitOps>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockCreateCommit.mockResolvedValue("abc123");
    mockGitLog.mockResolvedValue(LOG_ENTRY);
    ops = createCommitOps(cwd);
  });

  it("creates a commit and returns the commit details", async () => {
    const result = await ops.commit("feat: add stuff");
    expect(mockCreateCommit).toHaveBeenCalledWith(
      cwd,
      "feat: add stuff",
      undefined,
    );
    expect(result.hash).toBe("abc123def456");
    expect(result.message).toBe("feat: test");
  });

  it("passes amend option", async () => {
    await ops.commit("fix: amend", { amend: true });
    expect(mockCreateCommit).toHaveBeenCalledWith(cwd, "fix: amend", {
      amend: true,
    });
  });

  it("passes signoff option", async () => {
    await ops.commit("feat: signed", { signoff: true });
    expect(mockCreateCommit).toHaveBeenCalledWith(cwd, "feat: signed", {
      signoff: true,
    });
  });

  it("rejects empty commit messages", async () => {
    await expect(ops.commit("")).rejects.toThrow(
      "Commit message cannot be empty",
    );
    expect(mockCreateCommit).not.toHaveBeenCalled();
  });

  it("rejects whitespace-only commit messages", async () => {
    await expect(ops.commit("   \n  ")).rejects.toThrow(
      "Commit message cannot be empty",
    );
  });

  it("throws if log returns no commits after create", async () => {
    mockGitLog.mockResolvedValue("");
    await expect(ops.commit("feat: test")).rejects.toThrow(
      "Failed to read newly created commit",
    );
  });
});
