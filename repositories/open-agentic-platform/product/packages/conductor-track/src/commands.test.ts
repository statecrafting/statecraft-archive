import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  trackList,
  formatTrackList,
  trackInspect,
  formatTrackInspection,
} from "./commands.js";
import { createTrack, readMetadata, writeMetadata, writePlan } from "./storage.js";
import type { PlanStep, PhaseCheckpoint } from "./types.js";

let tracksRoot: string;

beforeEach(async () => {
  tracksRoot = await mkdtemp(join(tmpdir(), "commands-test-"));
});

afterEach(async () => {
  await rm(tracksRoot, { recursive: true, force: true });
});

describe("trackList (FR-008)", () => {
  it("returns empty for no tracks", async () => {
    const entries = await trackList(tracksRoot);
    expect(entries).toEqual([]);
  });

  it("returns entries with state and progress", async () => {
    await createTrack(tracksRoot, {
      id: "t1",
      title: "First",
      specContent: "spec",
      branch: "main",
      startCommit: "abc",
    });

    const steps: PlanStep[] = [
      { index: 0, description: "A", status: "done", completedAt: "2026-01-01" },
      { index: 1, description: "B", status: "pending" },
    ];
    await writePlan(tracksRoot, "t1", "plan", steps);

    const entries = await trackList(tracksRoot);
    expect(entries).toHaveLength(1);
    expect(entries[0].id).toBe("t1");
    expect(entries[0].state).toBe("PENDING");
    expect(entries[0].progress).toBe("1/2 (50%)");
  });

  it("shows — for tracks with no plan", async () => {
    await createTrack(tracksRoot, {
      id: "t1",
      title: "First",
      specContent: "spec",
      branch: "main",
      startCommit: "abc",
    });

    const entries = await trackList(tracksRoot);
    expect(entries[0].progress).toBe("—");
  });
});

describe("formatTrackList", () => {
  it("formats empty list", () => {
    expect(formatTrackList([])).toBe("No tracks found.");
  });

  it("formats entries as table", () => {
    const output = formatTrackList([
      {
        id: "t1",
        title: "First",
        state: "PENDING",
        createdAt: "2026-03-31",
        updatedAt: "2026-03-31",
        progress: "—",
      },
    ]);
    expect(output).toContain("ID | Title");
    expect(output).toContain("t1 | First");
  });
});

describe("trackInspect (FR-009)", () => {
  it("returns full inspection with progress", async () => {
    await createTrack(tracksRoot, {
      id: "t1",
      title: "Test Track",
      specContent: "spec",
      branch: "feat/test",
      startCommit: "abc123def456",
    });

    const steps: PlanStep[] = [
      { index: 0, description: "Write types", status: "done", completedAt: "2026-01-01" },
      { index: 1, description: "Write tests", status: "in_progress" },
      { index: 2, description: "Implement", status: "pending" },
    ];
    await writePlan(tracksRoot, "t1", "plan", steps);

    // Add a TDD checkpoint
    const meta = await readMetadata(tracksRoot, "t1");
    meta.state = "in_progress";
    const cp: PhaseCheckpoint = {
      passedAt: "2026-03-31T00:00:00.000Z",
      commitSha: "red-commit-sha",
      testResults: { passed: 3, failed: 2, skipped: 0 },
    };
    meta.tdd.red = cp;
    await writeMetadata(tracksRoot, "t1", meta);

    const inspection = await trackInspect(tracksRoot, "t1");
    expect(inspection.metadata.id).toBe("t1");
    expect(inspection.progress.total).toBe(3);
    expect(inspection.progress.completed).toBe(1);
    expect(inspection.progress.inProgress).toBe(1);
    expect(inspection.tddSummary.red).toContain("PASSED");
    expect(inspection.tddSummary.red).toContain("3P/2F/0S");
    expect(inspection.tddSummary.green).toBe("NOT PASSED");
  });
});

describe("formatTrackInspection", () => {
  it("formats full inspection as text (FR-009)", async () => {
    await createTrack(tracksRoot, {
      id: "t1",
      title: "Test Track",
      specContent: "spec",
      branch: "main",
      startCommit: "abc123",
    });

    const steps: PlanStep[] = [
      { index: 0, description: "Write types", status: "done" },
      { index: 1, description: "Implement", status: "pending" },
    ];
    await writePlan(tracksRoot, "t1", "plan", steps);

    const inspection = await trackInspect(tracksRoot, "t1");
    const text = formatTrackInspection(inspection);

    expect(text).toContain("# Track: t1");
    expect(text).toContain("Title: Test Track");
    expect(text).toContain("Branch: main");
    expect(text).toContain("Start commit: abc123");
    expect(text).toContain("[x] 0. Write types");
    expect(text).toContain("[ ] 1. Implement");
    expect(text).toContain("red: NOT PASSED");
  });

  it("shows end commit when present", async () => {
    await createTrack(tracksRoot, {
      id: "t1",
      title: "Done Track",
      specContent: "spec",
      branch: "main",
      startCommit: "start",
    });

    const meta = await readMetadata(tracksRoot, "t1");
    meta.git.endCommit = "end-sha";
    await writeMetadata(tracksRoot, "t1", meta);

    const inspection = await trackInspect(tracksRoot, "t1");
    const text = formatTrackInspection(inspection);
    expect(text).toContain("End commit: end-sha");
  });

  it("shows step status icons", async () => {
    await createTrack(tracksRoot, {
      id: "t1",
      title: "Test",
      specContent: "spec",
      branch: "main",
      startCommit: "abc",
    });
    const steps: PlanStep[] = [
      { index: 0, description: "Done", status: "done" },
      { index: 1, description: "WIP", status: "in_progress" },
      { index: 2, description: "Skip", status: "skipped" },
      { index: 3, description: "Todo", status: "pending" },
    ];
    await writePlan(tracksRoot, "t1", "plan", steps);

    const inspection = await trackInspect(tracksRoot, "t1");
    const text = formatTrackInspection(inspection);
    expect(text).toContain("[x] 0. Done");
    expect(text).toContain("[>] 1. WIP");
    expect(text).toContain("[-] 2. Skip");
    expect(text).toContain("[ ] 3. Todo");
  });
});
