import { describe, it, expect } from "vitest";
import {
  TRACK_STATES,
  TDD_PHASES,
  TrackTransitionError,
  TrackNotFoundError,
  TrackStorageError,
} from "./types.js";
import type {
  TrackState,
  TrackMetadata,
  PlanStep,
  PhaseCheckpoint,
  GitBoundary,
  TestResults,
  TddPhase,
  PlanStepStatus,
  CreateTrackOptions,
} from "./types.js";

describe("types", () => {
  it("TRACK_STATES contains all 5 states", () => {
    expect(TRACK_STATES).toEqual([
      "pending",
      "in_progress",
      "complete",
      "archived",
      "reverted",
    ]);
  });

  it("TDD_PHASES contains red, green, refactor", () => {
    expect(TDD_PHASES).toEqual(["red", "green", "refactor"]);
  });

  it("TrackTransitionError includes context", () => {
    const err = new TrackTransitionError("t1", "pending", "complete", "steps incomplete");
    expect(err.name).toBe("TrackTransitionError");
    expect(err.trackId).toBe("t1");
    expect(err.from).toBe("pending");
    expect(err.to).toBe("complete");
    expect(err.reason).toBe("steps incomplete");
    expect(err.message).toContain("pending");
    expect(err.message).toContain("complete");
    expect(err instanceof Error).toBe(true);
  });

  it("TrackNotFoundError includes trackId", () => {
    const err = new TrackNotFoundError("missing-track");
    expect(err.name).toBe("TrackNotFoundError");
    expect(err.trackId).toBe("missing-track");
    expect(err.message).toContain("missing-track");
  });

  it("TrackStorageError includes trackId and message", () => {
    const err = new TrackStorageError("t2", "disk full");
    expect(err.name).toBe("TrackStorageError");
    expect(err.trackId).toBe("t2");
    expect(err.message).toContain("disk full");
  });

  it("TrackMetadata type satisfies structure", () => {
    const meta: TrackMetadata = {
      id: "test",
      title: "Test Track",
      state: "pending",
      createdAt: "2026-03-31T00:00:00.000Z",
      updatedAt: "2026-03-31T00:00:00.000Z",
      git: { startCommit: "abc123", branch: "main" },
      plan: { totalSteps: 0, completedSteps: 0, steps: [] },
      tdd: { red: null, green: null, refactor: null },
    };
    expect(meta.state).toBe("pending");
  });

  it("PlanStep supports all statuses", () => {
    const statuses: PlanStepStatus[] = ["pending", "in_progress", "done", "skipped"];
    const steps: PlanStep[] = statuses.map((s, i) => ({
      index: i,
      description: `Step ${i}`,
      status: s,
    }));
    expect(steps).toHaveLength(4);
  });

  it("PhaseCheckpoint with optional testResults", () => {
    const cp: PhaseCheckpoint = {
      passedAt: "2026-03-31T00:00:00.000Z",
      commitSha: "abc123",
    };
    expect(cp.testResults).toBeUndefined();

    const cpWithResults: PhaseCheckpoint = {
      ...cp,
      testResults: { passed: 10, failed: 0, skipped: 1 },
    };
    expect(cpWithResults.testResults?.passed).toBe(10);
  });

  it("GitBoundary with optional endCommit", () => {
    const git: GitBoundary = { startCommit: "aaa", branch: "feat" };
    expect(git.endCommit).toBeUndefined();

    const completed: GitBoundary = { ...git, endCommit: "bbb" };
    expect(completed.endCommit).toBe("bbb");
  });

  it("CreateTrackOptions contains required fields", () => {
    const opts: CreateTrackOptions = {
      id: "t1",
      title: "Track 1",
      specContent: "# Spec\n\nDo things.",
      branch: "main",
      startCommit: "abc123",
    };
    expect(opts.id).toBe("t1");
  });
});
