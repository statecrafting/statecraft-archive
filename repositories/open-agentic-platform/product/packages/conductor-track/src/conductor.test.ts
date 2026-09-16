import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Conductor } from "./conductor.js";
import { TrackTransitionError } from "./types.js";
import type { PlanStep } from "./types.js";

let tracksRoot: string;
let commitCounter: number;

function makeCommit(): string {
  commitCounter++;
  return `sha-${String(commitCounter).padStart(6, "0")}`;
}

function makeConductor(): Conductor {
  return new Conductor({
    tracksRoot,
    getHeadCommit: async () => makeCommit(),
    getBranch: async () => "main",
  });
}

const sampleSteps: PlanStep[] = [
  { index: 0, description: "Write types", status: "pending" },
  { index: 1, description: "Write tests", status: "pending" },
  { index: 2, description: "Implement", status: "pending" },
];

beforeEach(async () => {
  tracksRoot = await mkdtemp(join(tmpdir(), "conductor-test-"));
  commitCounter = 0;
});

afterEach(async () => {
  await rm(tracksRoot, { recursive: true, force: true });
});

describe("Conductor", () => {
  describe("createTrack", () => {
    it("creates a track in pending state (FR-001)", async () => {
      const c = makeConductor();
      const meta = await c.createTrack("t1", "Title", "# Spec\n\nContent");
      expect(meta.id).toBe("t1");
      expect(meta.title).toBe("Title");
      expect(meta.state).toBe("pending");
      expect(meta.git.branch).toBe("main");
      expect(meta.git.startCommit).toBeTruthy();
    });

    it("records git HEAD at creation time", async () => {
      const c = makeConductor();
      const meta = await c.createTrack("t1", "Title", "spec");
      expect(meta.git.startCommit).toMatch(/^sha-/);
    });
  });

  describe("startTrack", () => {
    it("transitions to in_progress and writes plan (FR-003)", async () => {
      const c = makeConductor();
      await c.createTrack("t1", "Title", "spec");
      const meta = await c.startTrack("t1", "# Plan\n\n1. Do things", sampleSteps);
      expect(meta.state).toBe("in_progress");
      expect(meta.plan.totalSteps).toBe(3);
      expect(meta.plan.steps).toHaveLength(3);
    });

    it("records fresh git boundary at start", async () => {
      const c = makeConductor();
      const created = await c.createTrack("t1", "Title", "spec");
      const started = await c.startTrack("t1", "plan", sampleSteps);
      // Start commit should differ from creation since getHeadCommit increments
      expect(started.git.startCommit).not.toBe(created.git.startCommit);
    });

    it("throws for non-pending track", async () => {
      const c = makeConductor();
      await c.createTrack("t1", "Title", "spec");
      await c.startTrack("t1", "plan", sampleSteps);
      await expect(c.startTrack("t1", "plan", sampleSteps)).rejects.toThrow(
        TrackTransitionError,
      );
    });
  });

  describe("completeTrack", () => {
    it("transitions to complete when all gates pass (FR-010)", async () => {
      const c = makeConductor();
      await c.createTrack("t1", "Title", "spec");
      await c.startTrack("t1", "plan", [
        { index: 0, description: "Step", status: "done", completedAt: new Date().toISOString() },
      ]);

      // We need to set TDD checkpoints via direct metadata update
      const { readMetadata, writeMetadata } = await import("./storage.js");
      const meta = await readMetadata(tracksRoot, "t1");
      meta.plan.steps[0].status = "done";
      const cp = { passedAt: new Date().toISOString(), commitSha: "abc" };
      meta.tdd = { red: cp, green: cp, refactor: cp };
      await writeMetadata(tracksRoot, "t1", meta);

      const completed = await c.completeTrack("t1");
      expect(completed.state).toBe("complete");
      expect(completed.git.endCommit).toBeTruthy();
    });

    it("throws when TDD phases not passed", async () => {
      const c = makeConductor();
      await c.createTrack("t1", "Title", "spec");
      await c.startTrack("t1", "plan", [
        { index: 0, description: "Step", status: "done" },
      ]);

      // Steps done but no TDD checkpoints
      const { readMetadata, writeMetadata } = await import("./storage.js");
      const meta = await readMetadata(tracksRoot, "t1");
      meta.plan.steps[0].status = "done";
      await writeMetadata(tracksRoot, "t1", meta);

      await expect(c.completeTrack("t1")).rejects.toThrow(TrackTransitionError);
    });
  });

  describe("archiveTrack", () => {
    it("archives a complete track", async () => {
      const c = makeConductor();
      await c.createTrack("t1", "Title", "spec");
      await c.startTrack("t1", "plan", [
        { index: 0, description: "Step", status: "done" },
      ]);

      const { readMetadata, writeMetadata } = await import("./storage.js");
      const meta = await readMetadata(tracksRoot, "t1");
      meta.plan.steps[0].status = "done";
      const cp = { passedAt: new Date().toISOString(), commitSha: "abc" };
      meta.tdd = { red: cp, green: cp, refactor: cp };
      await writeMetadata(tracksRoot, "t1", meta);

      await c.completeTrack("t1");
      const archived = await c.archiveTrack("t1");
      expect(archived.state).toBe("archived");
    });
  });

  describe("canTransition", () => {
    it("reports valid transition", async () => {
      const c = makeConductor();
      await c.createTrack("t1", "Title", "spec");
      const result = await c.canTransition("t1", "in_progress");
      expect(result.allowed).toBe(true);
    });

    it("reports invalid transition with reason", async () => {
      const c = makeConductor();
      await c.createTrack("t1", "Title", "spec");
      const result = await c.canTransition("t1", "complete");
      expect(result.allowed).toBe(false);
      expect(result.reason).toBeDefined();
    });
  });

  describe("listTracks", () => {
    it("returns all created tracks (FR-008)", async () => {
      const c = makeConductor();
      await c.createTrack("t1", "First", "spec1");
      await c.createTrack("t2", "Second", "spec2");
      const tracks = await c.listTracks();
      expect(tracks).toHaveLength(2);
    });

    it("returns empty when no tracks", async () => {
      const c = makeConductor();
      const tracks = await c.listTracks();
      expect(tracks).toHaveLength(0);
    });
  });

  describe("getTrack", () => {
    it("returns track metadata", async () => {
      const c = makeConductor();
      await c.createTrack("t1", "Title", "spec");
      const meta = await c.getTrack("t1");
      expect(meta.id).toBe("t1");
    });
  });
});
