import { describe, it, expect, vi, beforeEach } from "vitest";
import { createBranchOps } from "./branch.js";

vi.mock("../backend/plumbing.js", () => ({
  forEachRef: vi.fn().mockResolvedValue(""),
  currentBranch: vi.fn().mockResolvedValue("main"),
  checkoutBranch: vi.fn().mockResolvedValue(undefined),
  createNewBranch: vi.fn().mockResolvedValue(undefined),
  diffFiles: vi.fn().mockResolvedValue(""),
  diffIndex: vi.fn().mockResolvedValue(""),
}));

import {
  forEachRef,
  currentBranch,
  checkoutBranch,
  createNewBranch,
  diffFiles,
  diffIndex,
} from "../backend/plumbing.js";

const mockForEachRef = vi.mocked(forEachRef);
const mockCurrentBranch = vi.mocked(currentBranch);
const mockCheckoutBranch = vi.mocked(checkoutBranch);
const mockCreateNewBranch = vi.mocked(createNewBranch);
const mockDiffFiles = vi.mocked(diffFiles);
const mockDiffIndex = vi.mocked(diffIndex);

describe("createBranchOps", () => {
  const cwd = "/repo";
  let ops: ReturnType<typeof createBranchOps>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockCurrentBranch.mockResolvedValue("main");
    mockForEachRef.mockResolvedValue(
      `main\x00abc1234\x001234567890\x00origin/main\nfeature\x00def5678\x001234567891\x00`,
    );
    mockDiffFiles.mockResolvedValue("");
    mockDiffIndex.mockResolvedValue("");
    ops = createBranchOps(cwd);
  });

  describe("list", () => {
    it("returns parsed branches with current branch marked", async () => {
      const branches = await ops.list();
      expect(branches).toHaveLength(2);
      expect(branches[0]!.name).toBe("main");
      expect(branches[0]!.isCurrent).toBe(true);
      expect(branches[1]!.name).toBe("feature");
      expect(branches[1]!.isCurrent).toBe(false);
    });
  });

  describe("checkout", () => {
    it("switches branch when tree is clean", async () => {
      await ops.checkout("feature");
      expect(mockCheckoutBranch).toHaveBeenCalledWith(cwd, "feature");
    });

    it("throws when tree is dirty and force is false", async () => {
      mockDiffFiles.mockResolvedValue("M\tsrc/index.ts\n");
      await expect(ops.checkout("feature")).rejects.toThrow(
        "uncommitted changes",
      );
      expect(mockCheckoutBranch).not.toHaveBeenCalled();
    });

    it("allows checkout with force when tree is dirty", async () => {
      mockDiffFiles.mockResolvedValue("M\tsrc/index.ts\n");
      await ops.checkout("feature", { force: true });
      expect(mockCheckoutBranch).toHaveBeenCalledWith(cwd, "feature");
    });
  });

  describe("create", () => {
    it("creates and switches to a new branch", async () => {
      await ops.create("new-feature");
      expect(mockCreateNewBranch).toHaveBeenCalledWith(cwd, "new-feature");
    });

    it("rejects empty branch name", async () => {
      await expect(ops.create("")).rejects.toThrow(
        "Branch name cannot be empty",
      );
    });
  });

  describe("isDirty", () => {
    it("returns false for clean tree", async () => {
      expect(await ops.isDirty()).toBe(false);
    });

    it("returns true when unstaged changes exist", async () => {
      mockDiffFiles.mockResolvedValue("M\tfile.ts\n");
      expect(await ops.isDirty()).toBe(true);
    });

    it("returns true when staged changes exist", async () => {
      mockDiffIndex.mockResolvedValue("A\tnew.ts\n");
      expect(await ops.isDirty()).toBe(true);
    });
  });
});
