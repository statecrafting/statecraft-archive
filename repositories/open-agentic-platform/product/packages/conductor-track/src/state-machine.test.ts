import { describe, it, expect } from "vitest";
import {
  canTransition,
  validateTransition,
  applyTransition,
} from "./state-machine.js";
import type { TrackMetadata } from "./types.js";
import { TrackTransitionError } from "./types.js";

function makeMeta(overrides: Partial<TrackMetadata> = {}): TrackMetadata {
  return {
    id: "t1",
    title: "Test",
    state: "pending",
    createdAt: "2026-03-31T00:00:00.000Z",
    updatedAt: "2026-03-31T00:00:00.000Z",
    git: { startCommit: "abc123", branch: "main" },
    plan: { totalSteps: 0, completedSteps: 0, steps: [] },
    tdd: { red: null, green: null, refactor: null },
    ...overrides,
  };
}

const checkpoint = {
  passedAt: "2026-03-31T01:00:00.000Z",
  commitSha: "def456",
  testResults: { passed: 5, failed: 0, skipped: 0 },
};

describe("canTransition", () => {
  it("allows pending → in_progress", () => {
    expect(canTransition("pending", "in_progress")).toBe(true);
  });

  it("allows pending → reverted", () => {
    expect(canTransition("pending", "reverted")).toBe(true);
  });

  it("allows in_progress → complete", () => {
    expect(canTransition("in_progress", "complete")).toBe(true);
  });

  it("allows in_progress → reverted", () => {
    expect(canTransition("in_progress", "reverted")).toBe(true);
  });

  it("allows complete → archived", () => {
    expect(canTransition("complete", "archived")).toBe(true);
  });

  it("allows complete → reverted", () => {
    expect(canTransition("complete", "reverted")).toBe(true);
  });

  it("rejects pending → complete (skip)", () => {
    expect(canTransition("pending", "complete")).toBe(false);
  });

  it("rejects archived → anything", () => {
    expect(canTransition("archived", "pending")).toBe(false);
    expect(canTransition("archived", "reverted")).toBe(false);
  });

  it("rejects reverted → anything", () => {
    expect(canTransition("reverted", "pending")).toBe(false);
    expect(canTransition("reverted", "in_progress")).toBe(false);
  });

  it("rejects in_progress → pending (backwards)", () => {
    expect(canTransition("in_progress", "pending")).toBe(false);
  });
});

describe("validateTransition", () => {
  it("allows pending → in_progress unconditionally", () => {
    const result = validateTransition(makeMeta(), "in_progress");
    expect(result.allowed).toBe(true);
  });

  it("blocks in_progress → complete when steps incomplete", () => {
    const meta = makeMeta({
      state: "in_progress",
      plan: {
        totalSteps: 2,
        completedSteps: 1,
        steps: [
          { index: 0, description: "Done", status: "done" },
          { index: 1, description: "Pending", status: "pending" },
        ],
      },
    });
    const result = validateTransition(meta, "complete");
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("1 plan step(s) not yet done");
  });

  it("blocks in_progress → complete when TDD phases missing", () => {
    const meta = makeMeta({
      state: "in_progress",
      plan: {
        totalSteps: 1,
        completedSteps: 1,
        steps: [{ index: 0, description: "Done", status: "done" }],
      },
      tdd: { red: checkpoint, green: null, refactor: null },
    });
    const result = validateTransition(meta, "complete");
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('TDD phase "green" has not passed');
  });

  it("allows in_progress → complete when all gates pass", () => {
    const meta = makeMeta({
      state: "in_progress",
      plan: {
        totalSteps: 1,
        completedSteps: 1,
        steps: [{ index: 0, description: "Done", status: "done" }],
      },
      tdd: { red: checkpoint, green: checkpoint, refactor: checkpoint },
    });
    const result = validateTransition(meta, "complete");
    expect(result.allowed).toBe(true);
  });

  it("allows skipped steps for completion", () => {
    const meta = makeMeta({
      state: "in_progress",
      plan: {
        totalSteps: 2,
        completedSteps: 1,
        steps: [
          { index: 0, description: "Done", status: "done" },
          { index: 1, description: "Skipped", status: "skipped" },
        ],
      },
      tdd: { red: checkpoint, green: checkpoint, refactor: checkpoint },
    });
    const result = validateTransition(meta, "complete");
    expect(result.allowed).toBe(true);
  });

  it("blocks revert from archived", () => {
    const meta = makeMeta({ state: "archived" });
    const result = validateTransition(meta, "reverted");
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("Invalid transition");
  });
});

describe("applyTransition", () => {
  it("returns updated metadata with new state", () => {
    const meta = makeMeta();
    const updated = applyTransition(meta, "in_progress");
    expect(updated.state).toBe("in_progress");
    expect(updated.id).toBe("t1");
  });

  it("throws TrackTransitionError for invalid transitions", () => {
    const meta = makeMeta();
    expect(() => applyTransition(meta, "complete")).toThrow(
      TrackTransitionError,
    );
  });

  it("throws with descriptive message for guard failures", () => {
    const meta = makeMeta({
      state: "in_progress",
      plan: {
        totalSteps: 1,
        completedSteps: 0,
        steps: [{ index: 0, description: "Todo", status: "pending" }],
      },
    });
    try {
      applyTransition(meta, "complete");
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(TrackTransitionError);
      const te = err as TrackTransitionError;
      expect(te.from).toBe("in_progress");
      expect(te.to).toBe("complete");
      expect(te.reason).toContain("plan step(s) not yet done");
    }
  });

  it("does not mutate original metadata", () => {
    const meta = makeMeta();
    const original = { ...meta };
    applyTransition(meta, "in_progress");
    expect(meta.state).toBe(original.state);
  });

  it("sets updatedAt on transition", () => {
    const meta = makeMeta();
    const updated = applyTransition(meta, "in_progress");
    expect(updated.updatedAt).not.toBe(meta.updatedAt);
  });
});
