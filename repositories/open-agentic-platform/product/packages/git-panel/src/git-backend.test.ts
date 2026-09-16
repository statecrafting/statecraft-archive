import { describe, it, expect, vi, beforeEach } from "vitest";
import { createGitBackend } from "./git-backend.js";

vi.mock("./backend/plumbing.js", () => ({
  diffFiles: vi.fn().mockResolvedValue(""),
  diffIndex: vi.fn().mockResolvedValue(""),
  lsFilesUntracked: vi.fn().mockResolvedValue(""),
  currentBranch: vi.fn().mockResolvedValue("main"),
  aheadBehind: vi.fn().mockResolvedValue([0, 0]),
  upstreamBranch: vi.fn().mockResolvedValue(undefined),
  fileDiff: vi.fn().mockResolvedValue(""),
  gitLog: vi.fn().mockResolvedValue(""),
  commitDiffRaw: vi.fn().mockResolvedValue(""),
  forEachRef: vi.fn().mockResolvedValue(""),
  stageFile: vi.fn().mockResolvedValue(undefined),
  unstageFile: vi.fn().mockResolvedValue(undefined),
  applyPatch: vi.fn().mockResolvedValue(undefined),
  createCommit: vi.fn().mockResolvedValue("abc"),
  checkoutBranch: vi.fn().mockResolvedValue(undefined),
  createNewBranch: vi.fn().mockResolvedValue(undefined),
  stagedDiff: vi.fn().mockResolvedValue(""),
  execGit: vi.fn().mockResolvedValue({ stdout: "", stderr: "" }),
}));

import {
  diffFiles,
  diffIndex,
  lsFilesUntracked,
  currentBranch,
  aheadBehind,
  upstreamBranch,
  fileDiff,
  gitLog,
  stageFile,
  unstageFile,
  createCommit,
} from "./backend/plumbing.js";

const mockDiffFiles = vi.mocked(diffFiles);
const mockDiffIndex = vi.mocked(diffIndex);
const mockLsFilesUntracked = vi.mocked(lsFilesUntracked);
const mockCurrentBranch = vi.mocked(currentBranch);
const mockAheadBehind = vi.mocked(aheadBehind);
const mockUpstreamBranch = vi.mocked(upstreamBranch);
const mockGitLog = vi.mocked(gitLog);
const mockCreateCommit = vi.mocked(createCommit);

describe("createGitBackend", () => {
  const cwd = "/repo";

  beforeEach(() => {
    vi.clearAllMocks();
    mockDiffFiles.mockResolvedValue("");
    mockDiffIndex.mockResolvedValue("");
    mockLsFilesUntracked.mockResolvedValue("");
    mockCurrentBranch.mockResolvedValue("main");
    mockAheadBehind.mockResolvedValue([0, 0]);
    mockUpstreamBranch.mockResolvedValue(undefined);
    mockGitLog.mockResolvedValue("");
  });

  describe("status", () => {
    it("returns a complete GitStatus from plumbing commands", async () => {
      mockDiffFiles.mockResolvedValue("M\tsrc/app.ts\n");
      mockDiffIndex.mockResolvedValue("A\tsrc/new.ts\n");
      mockLsFilesUntracked.mockResolvedValue("untracked.txt\n");
      mockCurrentBranch.mockResolvedValue("feature");
      mockUpstreamBranch.mockResolvedValue("origin/feature");
      mockAheadBehind.mockResolvedValue([2, 1]);

      const backend = createGitBackend(cwd);
      const status = await backend.status();

      expect(status.branch).toBe("feature");
      expect(status.upstream).toBe("origin/feature");
      expect(status.ahead).toBe(2);
      expect(status.behind).toBe(1);
      expect(status.unstaged).toHaveLength(1);
      expect(status.unstaged[0]!.path).toBe("src/app.ts");
      expect(status.staged).toHaveLength(1);
      expect(status.staged[0]!.path).toBe("src/new.ts");
      expect(status.untracked).toHaveLength(1);
      expect(status.untracked[0]!.path).toBe("untracked.txt");
    });

    it("handles clean repository", async () => {
      const backend = createGitBackend(cwd);
      const status = await backend.status();

      expect(status.staged).toHaveLength(0);
      expect(status.unstaged).toHaveLength(0);
      expect(status.untracked).toHaveLength(0);
    });
  });

  describe("stage/unstage", () => {
    it("delegates file staging to plumbing", async () => {
      const backend = createGitBackend(cwd);
      await backend.stage("file.ts");
      expect(vi.mocked(stageFile)).toHaveBeenCalledWith(cwd, "file.ts");
    });

    it("delegates file unstaging to plumbing", async () => {
      const backend = createGitBackend(cwd);
      await backend.unstage("file.ts");
      expect(vi.mocked(unstageFile)).toHaveBeenCalledWith(cwd, "file.ts");
    });
  });

  describe("commit", () => {
    it("creates a commit and returns details", async () => {
      mockCreateCommit.mockResolvedValue("abc123");
      mockGitLog.mockResolvedValue(
        `abc123\x00abc\x00A\x00a@t.com\x001111\x00p1\x00feat: msg\x01\n`,
      );

      const backend = createGitBackend(cwd);
      const result = await backend.commit("feat: msg");
      expect(result.hash).toBe("abc123");
      expect(result.message).toBe("feat: msg");
    });
  });

  describe("log", () => {
    it("returns parsed commits", async () => {
      mockGitLog.mockResolvedValue(
        `h1\x00h\x00A\x00a@t\x001111\x00p\x00msg\x01\n`,
      );

      const backend = createGitBackend(cwd);
      const commits = await backend.log(10);
      expect(commits).toHaveLength(1);
      expect(commits[0]!.message).toBe("msg");
    });

    it("passes offset to gitLog", async () => {
      const backend = createGitBackend(cwd);
      await backend.log(10, 5);
      expect(mockGitLog).toHaveBeenCalledWith(cwd, 10, 5);
    });
  });

  describe("branches/checkout/createBranch", () => {
    it("implements the GitBackend interface", () => {
      const backend = createGitBackend(cwd);
      expect(backend.branches).toBeDefined();
      expect(backend.checkout).toBeDefined();
      expect(backend.createBranch).toBeDefined();
    });
  });
});
