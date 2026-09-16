import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  parsePlanSteps,
  updateStepStatus,
  startNextStep,
  completeCurrentStep,
  getPlanProgress,
} from "./plan-implementer.js";
import { createTrack, writePlan, readMetadata } from "./storage.js";
import type { CreateTrackOptions, PlanStep, TrackMetadata } from "./types.js";

let tracksRoot: string;

const baseOpts: CreateTrackOptions = {
  id: "t1",
  title: "Test",
  specContent: "# Spec",
  branch: "main",
  startCommit: "abc",
};

beforeEach(async () => {
  tracksRoot = await mkdtemp(join(tmpdir(), "plan-impl-test-"));
});

afterEach(async () => {
  await rm(tracksRoot, { recursive: true, force: true });
});

async function setupTrackWithSteps(steps: PlanStep[]): Promise<TrackMetadata> {
  await createTrack(tracksRoot, baseOpts);
  const planContent = steps.map((s, i) => `${i + 1}. ${s.description}`).join("\n");
  return writePlan(tracksRoot, "t1", planContent, steps);
}

describe("parsePlanSteps", () => {
  it("parses numbered list", () => {
    const plan = "# Plan\n\n1. Write types\n2. Write tests\n3. Implement";
    const steps = parsePlanSteps(plan);
    expect(steps).toHaveLength(3);
    expect(steps[0].description).toBe("Write types");
    expect(steps[0].index).toBe(0);
    expect(steps[0].status).toBe("pending");
    expect(steps[2].description).toBe("Implement");
    expect(steps[2].index).toBe(2);
  });

  it("parses bulleted list", () => {
    const plan = "- First\n- Second\n- Third";
    const steps = parsePlanSteps(plan);
    expect(steps).toHaveLength(3);
    expect(steps[1].description).toBe("Second");
  });

  it("parses parenthesis-numbered list", () => {
    const plan = "1) First\n2) Second";
    const steps = parsePlanSteps(plan);
    expect(steps).toHaveLength(2);
  });

  it("handles mixed formats", () => {
    const plan = "# Plan\n\n1. First step\n- Sub item\n2. Third step";
    const steps = parsePlanSteps(plan);
    expect(steps).toHaveLength(3);
  });

  it("returns empty for no-step content", () => {
    const plan = "# Plan\n\nJust some text.";
    const steps = parsePlanSteps(plan);
    expect(steps).toHaveLength(0);
  });

  it("ignores heading-like items", () => {
    const plan = "- # Not a step\n- Real step";
    const steps = parsePlanSteps(plan);
    expect(steps).toHaveLength(1);
    expect(steps[0].description).toBe("Real step");
  });

  it("handles asterisk bullets", () => {
    const plan = "* Step one\n* Step two";
    const steps = parsePlanSteps(plan);
    expect(steps).toHaveLength(2);
  });
});

describe("updateStepStatus", () => {
  it("marks step as done with completedAt", async () => {
    const steps: PlanStep[] = [
      { index: 0, description: "First", status: "pending" },
      { index: 1, description: "Second", status: "pending" },
    ];
    await setupTrackWithSteps(steps);

    const result = await updateStepStatus(tracksRoot, "t1", 0, "done");
    expect(result.step.status).toBe("done");
    expect(result.step.completedAt).toBeDefined();
    expect(result.metadata.plan.completedSteps).toBe(1);
  });

  it("marks step as skipped with completedAt", async () => {
    const steps: PlanStep[] = [
      { index: 0, description: "First", status: "pending" },
    ];
    await setupTrackWithSteps(steps);

    const result = await updateStepStatus(tracksRoot, "t1", 0, "skipped");
    expect(result.step.status).toBe("skipped");
    expect(result.step.completedAt).toBeDefined();
  });

  it("marks step as in_progress without completedAt", async () => {
    const steps: PlanStep[] = [
      { index: 0, description: "First", status: "pending" },
    ];
    await setupTrackWithSteps(steps);

    const result = await updateStepStatus(tracksRoot, "t1", 0, "in_progress");
    expect(result.step.status).toBe("in_progress");
    expect(result.step.completedAt).toBeUndefined();
  });

  it("throws for invalid step index", async () => {
    const steps: PlanStep[] = [
      { index: 0, description: "First", status: "pending" },
    ];
    await setupTrackWithSteps(steps);

    await expect(
      updateStepStatus(tracksRoot, "t1", 99, "done"),
    ).rejects.toThrow("Step 99 not found");
  });

  it("persists to disk", async () => {
    const steps: PlanStep[] = [
      { index: 0, description: "First", status: "pending" },
    ];
    await setupTrackWithSteps(steps);

    await updateStepStatus(tracksRoot, "t1", 0, "done");
    const meta = await readMetadata(tracksRoot, "t1");
    expect(meta.plan.steps[0].status).toBe("done");
    expect(meta.plan.completedSteps).toBe(1);
  });
});

describe("startNextStep", () => {
  it("starts the first pending step", async () => {
    const steps: PlanStep[] = [
      { index: 0, description: "First", status: "pending" },
      { index: 1, description: "Second", status: "pending" },
    ];
    await setupTrackWithSteps(steps);

    const result = await startNextStep(tracksRoot, "t1");
    expect(result).not.toBeNull();
    expect(result!.step.index).toBe(0);
    expect(result!.step.status).toBe("in_progress");
  });

  it("skips done steps", async () => {
    const steps: PlanStep[] = [
      { index: 0, description: "First", status: "done", completedAt: "2026-01-01" },
      { index: 1, description: "Second", status: "pending" },
    ];
    await setupTrackWithSteps(steps);

    const result = await startNextStep(tracksRoot, "t1");
    expect(result!.step.index).toBe(1);
  });

  it("returns null when no pending steps", async () => {
    const steps: PlanStep[] = [
      { index: 0, description: "First", status: "done", completedAt: "2026-01-01" },
    ];
    await setupTrackWithSteps(steps);

    const result = await startNextStep(tracksRoot, "t1");
    expect(result).toBeNull();
  });
});

describe("completeCurrentStep", () => {
  it("completes the in-progress step", async () => {
    const steps: PlanStep[] = [
      { index: 0, description: "First", status: "in_progress" },
      { index: 1, description: "Second", status: "pending" },
    ];
    await setupTrackWithSteps(steps);

    const result = await completeCurrentStep(tracksRoot, "t1");
    expect(result).not.toBeNull();
    expect(result!.step.index).toBe(0);
    expect(result!.step.status).toBe("done");
  });

  it("returns null when no in-progress step", async () => {
    const steps: PlanStep[] = [
      { index: 0, description: "First", status: "pending" },
    ];
    await setupTrackWithSteps(steps);

    const result = await completeCurrentStep(tracksRoot, "t1");
    expect(result).toBeNull();
  });
});

describe("getPlanProgress", () => {
  it("computes correct progress", () => {
    const meta: TrackMetadata = {
      id: "t1",
      title: "Test",
      state: "in_progress",
      createdAt: "",
      updatedAt: "",
      git: { startCommit: "a", branch: "main" },
      plan: {
        totalSteps: 4,
        completedSteps: 2,
        steps: [
          { index: 0, description: "A", status: "done" },
          { index: 1, description: "B", status: "done" },
          { index: 2, description: "C", status: "in_progress" },
          { index: 3, description: "D", status: "pending" },
        ],
      },
      tdd: { red: null, green: null, refactor: null },
    };

    const progress = getPlanProgress(meta);
    expect(progress.total).toBe(4);
    expect(progress.completed).toBe(2);
    expect(progress.inProgress).toBe(1);
    expect(progress.pending).toBe(1);
    expect(progress.skipped).toBe(0);
    expect(progress.percentComplete).toBe(50);
  });

  it("handles empty plan", () => {
    const meta: TrackMetadata = {
      id: "t1",
      title: "Test",
      state: "pending",
      createdAt: "",
      updatedAt: "",
      git: { startCommit: "a", branch: "main" },
      plan: { totalSteps: 0, completedSteps: 0, steps: [] },
      tdd: { red: null, green: null, refactor: null },
    };

    const progress = getPlanProgress(meta);
    expect(progress.total).toBe(0);
    expect(progress.percentComplete).toBe(0);
  });

  it("counts skipped as complete for percentage", () => {
    const meta: TrackMetadata = {
      id: "t1",
      title: "Test",
      state: "in_progress",
      createdAt: "",
      updatedAt: "",
      git: { startCommit: "a", branch: "main" },
      plan: {
        totalSteps: 2,
        completedSteps: 2,
        steps: [
          { index: 0, description: "A", status: "done" },
          { index: 1, description: "B", status: "skipped" },
        ],
      },
      tdd: { red: null, green: null, refactor: null },
    };

    const progress = getPlanProgress(meta);
    expect(progress.percentComplete).toBe(100);
  });
});
