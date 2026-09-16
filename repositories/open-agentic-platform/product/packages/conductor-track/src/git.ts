/**
 * Git-aware revert — reset to track's start boundary commit.
 *
 * FR-007: reverting resets git state to start boundary, removing all track commits.
 * R-001: checks for uncommitted changes before proceeding.
 * SC-004: marks track as reverted.
 */

import type { TrackMetadata } from "./types.js";
import { readMetadata, writeMetadata, removeTrackDir } from "./storage.js";
import { applyTransition } from "./state-machine.js";

// ---------------------------------------------------------------------------
// Git operations interface (injectable for testing)
// ---------------------------------------------------------------------------

export interface GitOps {
  /** Check if the working tree has uncommitted changes. */
  isDirty: () => Promise<boolean>;
  /** Get current HEAD SHA. */
  getHead: () => Promise<string>;
  /** Reset to a specific commit (hard reset). */
  resetToCommit: (sha: string) => Promise<void>;
}

// ---------------------------------------------------------------------------
// Revert options
// ---------------------------------------------------------------------------

export interface RevertOptions {
  tracksRoot: string;
  trackId: string;
  git: GitOps;
  /** Remove track directory after revert. Default: true. */
  removeDir?: boolean;
}

export interface RevertResult {
  trackId: string;
  startCommit: string;
  revertedFrom: string;
  dirRemoved: boolean;
}

// ---------------------------------------------------------------------------
// Safety checks
// ---------------------------------------------------------------------------

export interface RevertSafetyResult {
  safe: boolean;
  reasons: string[];
}

export async function checkRevertSafety(
  opts: Pick<RevertOptions, "tracksRoot" | "trackId" | "git">,
): Promise<RevertSafetyResult> {
  const reasons: string[] = [];

  const meta = await readMetadata(opts.tracksRoot, opts.trackId);

  if (meta.state === "archived") {
    reasons.push("Track is archived and cannot be reverted");
  }

  if (meta.state === "reverted") {
    reasons.push("Track has already been reverted");
  }

  if (!meta.git.startCommit) {
    reasons.push("No git start boundary recorded");
  }

  // R-001: check for uncommitted changes
  const dirty = await opts.git.isDirty();
  if (dirty) {
    reasons.push(
      "Working tree has uncommitted changes — commit or stash before reverting",
    );
  }

  return { safe: reasons.length === 0, reasons };
}

// ---------------------------------------------------------------------------
// Revert execution
// ---------------------------------------------------------------------------

/**
 * Revert a track to its git start boundary.
 * FR-007: removes all commits made during track execution.
 */
export async function revertTrack(
  opts: RevertOptions,
): Promise<RevertResult> {
  const { tracksRoot, trackId, git, removeDir = true } = opts;

  // Run safety checks
  const safety = await checkRevertSafety({ tracksRoot, trackId, git });
  if (!safety.safe) {
    throw new Error(
      `Cannot revert track "${trackId}": ${safety.reasons.join("; ")}`,
    );
  }

  const meta = await readMetadata(tracksRoot, trackId);
  const currentHead = await git.getHead();

  // Apply state transition (validates the transition is valid)
  const reverted = applyTransition(meta, "reverted");
  await writeMetadata(tracksRoot, trackId, reverted);

  // Reset git to start boundary
  await git.resetToCommit(meta.git.startCommit);

  // Optionally remove the track directory
  let dirRemoved = false;
  if (removeDir) {
    await removeTrackDir(tracksRoot, trackId);
    dirRemoved = true;
  }

  return {
    trackId,
    startCommit: meta.git.startCommit,
    revertedFrom: currentHead,
    dirRemoved,
  };
}
