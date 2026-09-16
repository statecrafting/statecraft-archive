/**
 * Track directory storage — read/write operations for track artifacts.
 *
 * Each track is a directory containing:
 *   spec.md       — what to build
 *   plan.md       — ordered implementation steps
 *   metadata.json — machine-readable state, timestamps, git refs, checkpoints
 */

import { readFile, writeFile, mkdir, readdir, access, rm } from "node:fs/promises";
import { join } from "node:path";
import type { TrackMetadata, CreateTrackOptions, PlanStep } from "./types.js";
import { TrackNotFoundError, TrackStorageError } from "./types.js";

const METADATA_FILE = "metadata.json";
const SPEC_FILE = "spec.md";
const PLAN_FILE = "plan.md";

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

export function buildInitialMetadata(opts: CreateTrackOptions): TrackMetadata {
  const now = new Date().toISOString();
  return {
    id: opts.id,
    title: opts.title,
    state: "pending",
    createdAt: now,
    updatedAt: now,
    git: {
      startCommit: opts.startCommit,
      branch: opts.branch,
    },
    plan: {
      totalSteps: 0,
      completedSteps: 0,
      steps: [],
    },
    tdd: {
      red: null,
      green: null,
      refactor: null,
    },
  };
}

export async function createTrack(
  tracksRoot: string,
  opts: CreateTrackOptions,
): Promise<TrackMetadata> {
  const trackDir = join(tracksRoot, opts.id);

  try {
    await access(trackDir);
    throw new TrackStorageError(opts.id, "Track directory already exists");
  } catch (err: unknown) {
    if (err instanceof TrackStorageError) throw err;
    // Directory doesn't exist — expected
  }

  await mkdir(trackDir, { recursive: true });

  const metadata = buildInitialMetadata(opts);

  await Promise.all([
    writeFile(join(trackDir, SPEC_FILE), opts.specContent, "utf-8"),
    writeFile(
      join(trackDir, METADATA_FILE),
      JSON.stringify(metadata, null, 2) + "\n",
      "utf-8",
    ),
  ]);

  return metadata;
}

// ---------------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------------

export async function readMetadata(
  tracksRoot: string,
  trackId: string,
): Promise<TrackMetadata> {
  const filePath = join(tracksRoot, trackId, METADATA_FILE);
  try {
    const raw = await readFile(filePath, "utf-8");
    return JSON.parse(raw) as TrackMetadata;
  } catch {
    throw new TrackNotFoundError(trackId);
  }
}

export async function readSpec(
  tracksRoot: string,
  trackId: string,
): Promise<string> {
  const filePath = join(tracksRoot, trackId, SPEC_FILE);
  try {
    return await readFile(filePath, "utf-8");
  } catch {
    throw new TrackNotFoundError(trackId);
  }
}

export async function readPlan(
  tracksRoot: string,
  trackId: string,
): Promise<string> {
  const filePath = join(tracksRoot, trackId, PLAN_FILE);
  try {
    return await readFile(filePath, "utf-8");
  } catch {
    throw new TrackNotFoundError(trackId);
  }
}

// ---------------------------------------------------------------------------
// Write
// ---------------------------------------------------------------------------

export async function writeMetadata(
  tracksRoot: string,
  trackId: string,
  metadata: TrackMetadata,
): Promise<void> {
  const filePath = join(tracksRoot, trackId, METADATA_FILE);
  const updated: TrackMetadata = {
    ...metadata,
    updatedAt: new Date().toISOString(),
  };
  await writeFile(filePath, JSON.stringify(updated, null, 2) + "\n", "utf-8");
}

export async function writePlan(
  tracksRoot: string,
  trackId: string,
  planContent: string,
  steps: PlanStep[],
): Promise<TrackMetadata> {
  const trackDir = join(tracksRoot, trackId);
  const metadata = await readMetadata(tracksRoot, trackId);

  metadata.plan = {
    totalSteps: steps.length,
    completedSteps: 0,
    steps,
  };

  await Promise.all([
    writeFile(join(trackDir, PLAN_FILE), planContent, "utf-8"),
    writeMetadata(tracksRoot, trackId, metadata),
  ]);

  return { ...metadata, updatedAt: new Date().toISOString() };
}

// ---------------------------------------------------------------------------
// List
// ---------------------------------------------------------------------------

export async function listTracks(
  tracksRoot: string,
): Promise<TrackMetadata[]> {
  try {
    await access(tracksRoot);
  } catch {
    return [];
  }

  const entries = await readdir(tracksRoot, { withFileTypes: true });
  const dirs = entries.filter((e) => e.isDirectory());

  const results: TrackMetadata[] = [];
  for (const dir of dirs) {
    try {
      const meta = await readMetadata(tracksRoot, dir.name);
      results.push(meta);
    } catch {
      // Skip directories without valid metadata
    }
  }

  return results.sort(
    (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
  );
}

// ---------------------------------------------------------------------------
// Delete (for revert cleanup)
// ---------------------------------------------------------------------------

export async function removeTrackDir(
  tracksRoot: string,
  trackId: string,
): Promise<void> {
  const trackDir = join(tracksRoot, trackId);
  try {
    await rm(trackDir, { recursive: true, force: true });
  } catch (err: unknown) {
    throw new TrackStorageError(
      trackId,
      `Failed to remove track directory: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}
