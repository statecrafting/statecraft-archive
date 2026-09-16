import { describe, it, expect, vi, beforeEach } from "vitest";
import { createStagingOps } from "./staging.js";

// Mock the plumbing module
vi.mock("../backend/plumbing.js", () => ({
  stageFile: vi.fn().mockResolvedValue(undefined),
  unstageFile: vi.fn().mockResolvedValue(undefined),
  fileDiff: vi.fn().mockResolvedValue(""),
  applyPatch: vi.fn().mockResolvedValue(undefined),
  execGit: vi.fn().mockResolvedValue({ stdout: "", stderr: "" }),
}));

import {
  stageFile,
  unstageFile,
  fileDiff,
  applyPatch,
  execGit,
} from "../backend/plumbing.js";

const mockStageFile = vi.mocked(stageFile);
const mockUnstageFile = vi.mocked(unstageFile);
const mockFileDiff = vi.mocked(fileDiff);
const mockApplyPatch = vi.mocked(applyPatch);
const mockExecGit = vi.mocked(execGit);

describe("createStagingOps", () => {
  const cwd = "/repo";
  let ops: ReturnType<typeof createStagingOps>;

  beforeEach(() => {
    vi.clearAllMocks();
    ops = createStagingOps(cwd);
  });

  describe("stage", () => {
    it("stages a whole file when no hunks specified", async () => {
      await ops.stage("src/index.ts");
      expect(mockStageFile).toHaveBeenCalledWith(cwd, "src/index.ts");
    });

    it("stages a whole file when hunks array is empty", async () => {
      await ops.stage("src/index.ts", []);
      expect(mockStageFile).toHaveBeenCalledWith(cwd, "src/index.ts");
    });

    it("stages specific hunks via patch apply", async () => {
      const diffOutput = [
        "diff --git a/f.ts b/f.ts",
        "--- a/f.ts",
        "+++ b/f.ts",
        "@@ -1,2 +1,3 @@",
        " ctx",
        "+new line",
        " ctx2",
      ].join("\n");

      mockFileDiff.mockResolvedValue(diffOutput);

      await ops.stage("f.ts", [
        { oldStart: 1, oldCount: 2, newStart: 1, newCount: 3 },
      ]);

      expect(mockFileDiff).toHaveBeenCalledWith(cwd, "f.ts", false);
      expect(mockApplyPatch).toHaveBeenCalledWith(
        cwd,
        expect.stringContaining("@@ -1,2 +1,3 @@"),
        true,
      );
    });

    it("does nothing when diff has no matching hunks", async () => {
      const diffOutput = [
        "diff --git a/f.ts b/f.ts",
        "--- a/f.ts",
        "+++ b/f.ts",
        "@@ -1,2 +1,3 @@",
        " ctx",
        "+new",
        " ctx2",
      ].join("\n");

      mockFileDiff.mockResolvedValue(diffOutput);

      await ops.stage("f.ts", [
        { oldStart: 99, oldCount: 1, newStart: 99, newCount: 1 },
      ]);

      expect(mockApplyPatch).not.toHaveBeenCalled();
    });
  });

  describe("unstage", () => {
    it("unstages a whole file when no hunks specified", async () => {
      await ops.unstage("src/index.ts");
      expect(mockUnstageFile).toHaveBeenCalledWith(cwd, "src/index.ts");
    });

    it("unstages specific hunks via reverse patch", async () => {
      const diffOutput = [
        "diff --git a/f.ts b/f.ts",
        "--- a/f.ts",
        "+++ b/f.ts",
        "@@ -1,2 +1,3 @@",
        " ctx",
        "+added",
        " ctx2",
      ].join("\n");

      mockFileDiff.mockResolvedValue(diffOutput);

      await ops.unstage("f.ts", [
        { oldStart: 1, oldCount: 2, newStart: 1, newCount: 3 },
      ]);

      expect(mockFileDiff).toHaveBeenCalledWith(cwd, "f.ts", true);
      expect(mockApplyPatch).toHaveBeenCalledWith(
        cwd,
        expect.stringContaining("-added"),
        true,
      );
    });
  });

  describe("stageAll", () => {
    it("runs git add -A", async () => {
      await ops.stageAll();
      expect(mockExecGit).toHaveBeenCalledWith(["add", "-A"], { cwd });
    });
  });

  describe("unstageAll", () => {
    it("runs git reset HEAD", async () => {
      await ops.unstageAll();
      expect(mockExecGit).toHaveBeenCalledWith(["reset", "HEAD"], { cwd });
    });
  });
});
