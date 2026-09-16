import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  recordCheckpoint,
  validatePhaseOrder,
  validatePhaseResults,
  overrideCheckpoint,
  allPhasesPassed,
  nextRequiredPhase,
} from "./checkpoints.js";
import { createTrack, readMetadata, writeMetadata } from "./storage.js";
import type { TrackMetadata, PhaseCheckpoint } from "./types.js";

let tracksRoot: string;

beforeEach(async () => {
  tracksRoot = await mkdtemp(join(tmpdir(), "checkpoint-test-"));
  // Create a track and transition to in_progress
  await createTrack(tracksRoot, {
    id: "t1",
    title: "Test",
    specContent: "# Spec",
    branch: "main",
    startCommit: "abc",
  });
  const meta = await readMetadata(tracksRoot, "t1");
  meta.state = "in_progress";
  await writeMetadata(tracksRoot, "t1", meta);
});

afterEach(async () => {
  await rm(tracksRoot, { recursive: true, force: true });
});

const cp: PhaseCheckpoint = {
  passedAt: "2026-01-01T00:00:00.000Z",
  commitSha: "abc",
};

describe("validatePhaseOrder", () => {
  it("allows red first", () => {
    const meta = makeMeta({ tdd: { red: null, green: null, refactor: null } });
    expect(validatePhaseOrder(meta, "red")).toBeNull();
  });

  it("allows green after red", () => {
    const meta = makeMeta({ tdd: { red: cp, green: null, refactor: null } });
    expect(validatePhaseOrder(meta, "green")).toBeNull();
  });

  it("blocks green before red", () => {
    const meta = makeMeta({ tdd: { red: null, green: null, refactor: null } });
    expect(validatePhaseOrder(meta, "green")).toContain("red");
  });

  it("allows refactor after green", () => {
    const meta = makeMeta({ tdd: { red: cp, green: cp, refactor: null } });
    expect(validatePhaseOrder(meta, "refactor")).toBeNull();
  });

  it("blocks refactor before green", () => {
    const meta = makeMeta({ tdd: { red: cp, green: null, refactor: null } });
    expect(validatePhaseOrder(meta, "refactor")).toContain("green");
  });

  it("blocks refactor before red", () => {
    const meta = makeMeta({ tdd: { red: null, green: null, refactor: null } });
    expect(validatePhaseOrder(meta, "refactor")).toContain("red");
  });
});

describe("validatePhaseResults", () => {
  it("red: allows failing tests", () => {
    expect(
      validatePhaseResults("red", { passed: 5, failed: 2, skipped: 0 }),
    ).toBeNull();
  });

  it("red: rejects all-passing", () => {
    const result = validatePhaseResults("red", {
      passed: 5,
      failed: 0,
      skipped: 0,
    });
    expect(result).toContain("Red phase expects failing tests");
  });

  it("green: allows all-passing", () => {
    expect(
      validatePhaseResults("green", { passed: 7, failed: 0, skipped: 1 }),
    ).toBeNull();
  });

  it("green: rejects failing tests", () => {
    const result = validatePhaseResults("green", {
      passed: 5,
      failed: 1,
      skipped: 0,
    });
    expect(result).toContain("Green phase requires all tests to pass");
  });

  it("refactor: allows all-passing", () => {
    expect(
      validatePhaseResults("refactor", { passed: 7, failed: 0, skipped: 0 }),
    ).toBeNull();
  });

  it("refactor: rejects failing tests", () => {
    const result = validatePhaseResults("refactor", {
      passed: 5,
      failed: 2,
      skipped: 0,
    });
    expect(result).toContain("Refactor phase requires all tests to pass");
  });

  it("returns null when no results provided", () => {
    expect(validatePhaseResults("red")).toBeNull();
    expect(validatePhaseResults("green")).toBeNull();
    expect(validatePhaseResults("refactor")).toBeNull();
  });
});

describe("recordCheckpoint", () => {
  it("records red phase", async () => {
    const meta = await recordCheckpoint({
      tracksRoot,
      trackId: "t1",
      phase: "red",
      commitSha: "sha-red",
      testResults: { passed: 3, failed: 2, skipped: 0 },
    });
    expect(meta.tdd.red).not.toBeNull();
    expect(meta.tdd.red!.commitSha).toBe("sha-red");
    expect(meta.tdd.red!.testResults?.failed).toBe(2);
  });

  it("records green after red", async () => {
    await recordCheckpoint({
      tracksRoot,
      trackId: "t1",
      phase: "red",
      commitSha: "sha-red",
      testResults: { passed: 3, failed: 2, skipped: 0 },
    });
    const meta = await recordCheckpoint({
      tracksRoot,
      trackId: "t1",
      phase: "green",
      commitSha: "sha-green",
      testResults: { passed: 5, failed: 0, skipped: 0 },
    });
    expect(meta.tdd.green).not.toBeNull();
    expect(meta.tdd.green!.commitSha).toBe("sha-green");
  });

  it("persists to disk", async () => {
    await recordCheckpoint({
      tracksRoot,
      trackId: "t1",
      phase: "red",
      commitSha: "sha-red",
    });
    const meta = await readMetadata(tracksRoot, "t1");
    expect(meta.tdd.red).not.toBeNull();
  });

  it("throws for non-in_progress track", async () => {
    const meta = await readMetadata(tracksRoot, "t1");
    meta.state = "pending";
    await writeMetadata(tracksRoot, "t1", meta);

    await expect(
      recordCheckpoint({
        tracksRoot,
        trackId: "t1",
        phase: "red",
        commitSha: "sha",
      }),
    ).rejects.toThrow("must be in_progress");
  });

  it("throws for out-of-order phases", async () => {
    await expect(
      recordCheckpoint({
        tracksRoot,
        trackId: "t1",
        phase: "green",
        commitSha: "sha",
      }),
    ).rejects.toThrow("red");
  });

  it("throws for invalid phase results", async () => {
    await expect(
      recordCheckpoint({
        tracksRoot,
        trackId: "t1",
        phase: "red",
        commitSha: "sha",
        testResults: { passed: 5, failed: 0, skipped: 0 },
      }),
    ).rejects.toThrow("Red phase expects failing tests");
  });
});

describe("overrideCheckpoint", () => {
  it("bypasses result validation (R-002)", async () => {
    // Red with all-passing results would normally fail
    const meta = await overrideCheckpoint({
      tracksRoot,
      trackId: "t1",
      phase: "red",
      commitSha: "sha",
      testResults: { passed: 5, failed: 0, skipped: 0 },
      reason: "Initial scaffold — no tests yet",
    });
    expect(meta.tdd.red).not.toBeNull();
  });
});

describe("allPhasesPassed", () => {
  it("returns true when all phases set", () => {
    const meta = makeMeta({ tdd: { red: cp, green: cp, refactor: cp } });
    expect(allPhasesPassed(meta)).toBe(true);
  });

  it("returns false when any phase null", () => {
    const meta = makeMeta({ tdd: { red: cp, green: null, refactor: cp } });
    expect(allPhasesPassed(meta)).toBe(false);
  });
});

describe("nextRequiredPhase", () => {
  it("returns red when nothing done", () => {
    const meta = makeMeta({ tdd: { red: null, green: null, refactor: null } });
    expect(nextRequiredPhase(meta)).toBe("red");
  });

  it("returns green when red done", () => {
    const meta = makeMeta({ tdd: { red: cp, green: null, refactor: null } });
    expect(nextRequiredPhase(meta)).toBe("green");
  });

  it("returns refactor when green done", () => {
    const meta = makeMeta({ tdd: { red: cp, green: cp, refactor: null } });
    expect(nextRequiredPhase(meta)).toBe("refactor");
  });

  it("returns null when all done", () => {
    const meta = makeMeta({ tdd: { red: cp, green: cp, refactor: cp } });
    expect(nextRequiredPhase(meta)).toBeNull();
  });
});

// Helper
function makeMeta(overrides: Partial<TrackMetadata> = {}): TrackMetadata {
  return {
    id: "t1",
    title: "Test",
    state: "in_progress",
    createdAt: "",
    updatedAt: "",
    git: { startCommit: "a", branch: "main" },
    plan: { totalSteps: 0, completedSteps: 0, steps: [] },
    tdd: { red: null, green: null, refactor: null },
    ...overrides,
  };
}
