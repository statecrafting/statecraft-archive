import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  checkRevertSafety,
  revertTrack,
} from "./git.js";
import type { GitOps, RevertOptions } from "./git.js";
import { createTrack, readMetadata, writeMetadata } from "./storage.js";

let tracksRoot: string;

const cleanGit: GitOps = {
  isDirty: async () => false,
  getHead: async () => "current-head-sha",
  resetToCommit: vi.fn(async () => {}),
};

function dirtyGit(): GitOps {
  return {
    isDirty: async () => true,
    getHead: async () => "current-head-sha",
    resetToCommit: vi.fn(async () => {}),
  };
}

beforeEach(async () => {
  tracksRoot = await mkdtemp(join(tmpdir(), "git-revert-test-"));
  await createTrack(tracksRoot, {
    id: "t1",
    title: "Test",
    specContent: "# Spec",
    branch: "main",
    startCommit: "start-sha-000",
  });
});

afterEach(async () => {
  await rm(tracksRoot, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe("checkRevertSafety", () => {
  it("safe for pending track with clean tree", async () => {
    const result = await checkRevertSafety({
      tracksRoot,
      trackId: "t1",
      git: cleanGit,
    });
    expect(result.safe).toBe(true);
    expect(result.reasons).toHaveLength(0);
  });

  it("unsafe when tree is dirty (R-001)", async () => {
    const result = await checkRevertSafety({
      tracksRoot,
      trackId: "t1",
      git: dirtyGit(),
    });
    expect(result.safe).toBe(false);
    expect(result.reasons[0]).toContain("uncommitted changes");
  });

  it("unsafe for archived track", async () => {
    const meta = await readMetadata(tracksRoot, "t1");
    meta.state = "archived";
    await writeMetadata(tracksRoot, "t1", meta);

    const result = await checkRevertSafety({
      tracksRoot,
      trackId: "t1",
      git: cleanGit,
    });
    expect(result.safe).toBe(false);
    expect(result.reasons[0]).toContain("archived");
  });

  it("unsafe for already-reverted track", async () => {
    const meta = await readMetadata(tracksRoot, "t1");
    meta.state = "reverted";
    await writeMetadata(tracksRoot, "t1", meta);

    const result = await checkRevertSafety({
      tracksRoot,
      trackId: "t1",
      git: cleanGit,
    });
    expect(result.safe).toBe(false);
    expect(result.reasons[0]).toContain("already been reverted");
  });

  it("collects multiple reasons", async () => {
    const meta = await readMetadata(tracksRoot, "t1");
    meta.state = "archived";
    await writeMetadata(tracksRoot, "t1", meta);

    const result = await checkRevertSafety({
      tracksRoot,
      trackId: "t1",
      git: dirtyGit(),
    });
    expect(result.safe).toBe(false);
    expect(result.reasons.length).toBeGreaterThanOrEqual(2);
  });
});

describe("revertTrack", () => {
  it("reverts pending track to start boundary (FR-007)", async () => {
    const git: GitOps = {
      isDirty: async () => false,
      getHead: async () => "current-sha",
      resetToCommit: vi.fn(async () => {}),
    };

    const result = await revertTrack({ tracksRoot, trackId: "t1", git });
    expect(result.trackId).toBe("t1");
    expect(result.startCommit).toBe("start-sha-000");
    expect(result.revertedFrom).toBe("current-sha");
    expect(result.dirRemoved).toBe(true);
    expect(git.resetToCommit).toHaveBeenCalledWith("start-sha-000");
  });

  it("reverts in_progress track (SC-004)", async () => {
    const meta = await readMetadata(tracksRoot, "t1");
    meta.state = "in_progress";
    await writeMetadata(tracksRoot, "t1", meta);

    const git: GitOps = {
      isDirty: async () => false,
      getHead: async () => "mid-sha",
      resetToCommit: vi.fn(async () => {}),
    };

    const result = await revertTrack({ tracksRoot, trackId: "t1", git });
    expect(result.startCommit).toBe("start-sha-000");
    expect(git.resetToCommit).toHaveBeenCalledWith("start-sha-000");
  });

  it("keeps directory when removeDir=false", async () => {
    const git: GitOps = {
      isDirty: async () => false,
      getHead: async () => "sha",
      resetToCommit: vi.fn(async () => {}),
    };

    const result = await revertTrack({
      tracksRoot,
      trackId: "t1",
      git,
      removeDir: false,
    });
    expect(result.dirRemoved).toBe(false);

    // Metadata should still be readable but state = reverted
    const meta = await readMetadata(tracksRoot, "t1");
    expect(meta.state).toBe("reverted");
  });

  it("throws when safety check fails", async () => {
    await expect(
      revertTrack({ tracksRoot, trackId: "t1", git: dirtyGit() }),
    ).rejects.toThrow("uncommitted changes");
  });

  it("throws for archived track", async () => {
    const meta = await readMetadata(tracksRoot, "t1");
    meta.state = "archived";
    await writeMetadata(tracksRoot, "t1", meta);

    await expect(
      revertTrack({ tracksRoot, trackId: "t1", git: cleanGit }),
    ).rejects.toThrow("archived");
  });

  it("removes track directory after revert", async () => {
    const git: GitOps = {
      isDirty: async () => false,
      getHead: async () => "sha",
      resetToCommit: vi.fn(async () => {}),
    };

    await revertTrack({ tracksRoot, trackId: "t1", git });

    // Track directory should be gone
    await expect(readMetadata(tracksRoot, "t1")).rejects.toThrow();
  });
});
