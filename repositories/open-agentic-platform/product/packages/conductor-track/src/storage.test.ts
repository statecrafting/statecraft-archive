import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readFile, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  buildInitialMetadata,
  createTrack,
  readMetadata,
  readSpec,
  readPlan,
  writeMetadata,
  writePlan,
  listTracks,
  removeTrackDir,
} from "./storage.js";
import { TrackNotFoundError, TrackStorageError } from "./types.js";
import type { CreateTrackOptions, PlanStep } from "./types.js";

let tracksRoot: string;

beforeEach(async () => {
  tracksRoot = await mkdtemp(join(tmpdir(), "conductor-track-test-"));
});

afterEach(async () => {
  await rm(tracksRoot, { recursive: true, force: true });
});

const baseOpts: CreateTrackOptions = {
  id: "track-001",
  title: "Test Track",
  specContent: "# Test Spec\n\nBuild a widget.",
  branch: "main",
  startCommit: "abc123def",
};

describe("buildInitialMetadata", () => {
  it("creates metadata with pending state", () => {
    const meta = buildInitialMetadata(baseOpts);
    expect(meta.id).toBe("track-001");
    expect(meta.title).toBe("Test Track");
    expect(meta.state).toBe("pending");
    expect(meta.git.startCommit).toBe("abc123def");
    expect(meta.git.branch).toBe("main");
    expect(meta.git.endCommit).toBeUndefined();
    expect(meta.plan.totalSteps).toBe(0);
    expect(meta.plan.steps).toEqual([]);
    expect(meta.tdd.red).toBeNull();
    expect(meta.tdd.green).toBeNull();
    expect(meta.tdd.refactor).toBeNull();
  });

  it("sets ISO timestamps", () => {
    const meta = buildInitialMetadata(baseOpts);
    expect(() => new Date(meta.createdAt)).not.toThrow();
    expect(meta.createdAt).toBe(meta.updatedAt);
  });
});

describe("createTrack", () => {
  it("creates track directory with spec.md and metadata.json", async () => {
    const meta = await createTrack(tracksRoot, baseOpts);
    expect(meta.id).toBe("track-001");
    expect(meta.state).toBe("pending");

    const specContent = await readFile(
      join(tracksRoot, "track-001", "spec.md"),
      "utf-8",
    );
    expect(specContent).toBe("# Test Spec\n\nBuild a widget.");

    const metaContent = await readFile(
      join(tracksRoot, "track-001", "metadata.json"),
      "utf-8",
    );
    const parsed = JSON.parse(metaContent);
    expect(parsed.id).toBe("track-001");
  });

  it("throws if track directory already exists", async () => {
    await createTrack(tracksRoot, baseOpts);
    await expect(createTrack(tracksRoot, baseOpts)).rejects.toThrow(
      TrackStorageError,
    );
  });
});

describe("readMetadata", () => {
  it("reads existing metadata", async () => {
    await createTrack(tracksRoot, baseOpts);
    const meta = await readMetadata(tracksRoot, "track-001");
    expect(meta.id).toBe("track-001");
    expect(meta.state).toBe("pending");
  });

  it("throws TrackNotFoundError for missing track", async () => {
    await expect(readMetadata(tracksRoot, "nope")).rejects.toThrow(
      TrackNotFoundError,
    );
  });
});

describe("readSpec", () => {
  it("reads spec.md content", async () => {
    await createTrack(tracksRoot, baseOpts);
    const content = await readSpec(tracksRoot, "track-001");
    expect(content).toContain("Test Spec");
  });

  it("throws TrackNotFoundError for missing track", async () => {
    await expect(readSpec(tracksRoot, "nope")).rejects.toThrow(
      TrackNotFoundError,
    );
  });
});

describe("readPlan", () => {
  it("throws when no plan.md exists yet", async () => {
    await createTrack(tracksRoot, baseOpts);
    await expect(readPlan(tracksRoot, "track-001")).rejects.toThrow(
      TrackNotFoundError,
    );
  });
});

describe("writeMetadata", () => {
  it("updates metadata and persists state changes", async () => {
    await createTrack(tracksRoot, baseOpts);
    const meta = await readMetadata(tracksRoot, "track-001");

    meta.state = "in_progress";
    await writeMetadata(tracksRoot, "track-001", meta);

    const updated = await readMetadata(tracksRoot, "track-001");
    expect(updated.state).toBe("in_progress");
    // updatedAt is refreshed on every write
    expect(typeof updated.updatedAt).toBe("string");
    expect(() => new Date(updated.updatedAt)).not.toThrow();
  });
});

describe("writePlan", () => {
  it("writes plan.md and updates metadata steps", async () => {
    await createTrack(tracksRoot, baseOpts);
    const steps: PlanStep[] = [
      { index: 0, description: "Write types", status: "pending" },
      { index: 1, description: "Write tests", status: "pending" },
      { index: 2, description: "Implement", status: "pending" },
    ];
    const planContent = "# Plan\n\n1. Write types\n2. Write tests\n3. Implement";

    const updated = await writePlan(tracksRoot, "track-001", planContent, steps);
    expect(updated.plan.totalSteps).toBe(3);
    expect(updated.plan.completedSteps).toBe(0);
    expect(updated.plan.steps).toHaveLength(3);

    const content = await readPlan(tracksRoot, "track-001");
    expect(content).toContain("Write types");
  });
});

describe("listTracks", () => {
  it("returns empty array when tracksRoot doesn't exist", async () => {
    const result = await listTracks("/nonexistent/path");
    expect(result).toEqual([]);
  });

  it("returns empty array for empty directory", async () => {
    const result = await listTracks(tracksRoot);
    expect(result).toEqual([]);
  });

  it("lists multiple tracks sorted by updatedAt descending", async () => {
    await createTrack(tracksRoot, baseOpts);
    await createTrack(tracksRoot, {
      ...baseOpts,
      id: "track-002",
      title: "Second Track",
    });

    // Update second track so it's newer
    const meta2 = await readMetadata(tracksRoot, "track-002");
    meta2.state = "in_progress";
    await writeMetadata(tracksRoot, "track-002", meta2);

    const tracks = await listTracks(tracksRoot);
    expect(tracks).toHaveLength(2);
    expect(tracks[0].id).toBe("track-002");
  });

  it("skips directories without valid metadata", async () => {
    await createTrack(tracksRoot, baseOpts);
    await mkdir(join(tracksRoot, "invalid-dir"), { recursive: true });

    const tracks = await listTracks(tracksRoot);
    expect(tracks).toHaveLength(1);
    expect(tracks[0].id).toBe("track-001");
  });
});

describe("removeTrackDir", () => {
  it("removes track directory", async () => {
    await createTrack(tracksRoot, baseOpts);
    await removeTrackDir(tracksRoot, "track-001");

    await expect(readMetadata(tracksRoot, "track-001")).rejects.toThrow(
      TrackNotFoundError,
    );
  });

  it("succeeds even if directory doesn't exist (force)", async () => {
    await expect(
      removeTrackDir(tracksRoot, "nonexistent"),
    ).resolves.not.toThrow();
  });
});
