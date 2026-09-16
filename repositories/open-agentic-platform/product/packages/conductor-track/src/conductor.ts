/**
 * Conductor agent integration — creates and transitions tracks.
 *
 * The conductor is the owner of the track lifecycle. It creates tracks from
 * task descriptions, transitions them through states, and monitors execution.
 */

import type {
  TrackMetadata,
  CreateTrackOptions,
  PlanStep,
  TrackState,
  PhaseCheckpoint,
} from "./types.js";
import {
  createTrack,
  readMetadata,
  writeMetadata,
  writePlan,
  listTracks,
} from "./storage.js";
import { applyTransition, validateTransition } from "./state-machine.js";

// ---------------------------------------------------------------------------
// Conductor options
// ---------------------------------------------------------------------------

export interface ConductorOptions {
  tracksRoot: string;
  /** Resolve current git HEAD SHA. */
  getHeadCommit: () => Promise<string>;
  /** Resolve current git branch name. */
  getBranch: () => Promise<string>;
}

// ---------------------------------------------------------------------------
// Conductor class
// ---------------------------------------------------------------------------

export class Conductor {
  private readonly tracksRoot: string;
  private readonly getHeadCommit: () => Promise<string>;
  private readonly getBranch: () => Promise<string>;

  constructor(opts: ConductorOptions) {
    this.tracksRoot = opts.tracksRoot;
    this.getHeadCommit = opts.getHeadCommit;
    this.getBranch = opts.getBranch;
  }

  /**
   * Create a new track in pending state.
   * FR-001: track created with unique id, spec.md, initial state pending.
   */
  async createTrack(
    id: string,
    title: string,
    specContent: string,
  ): Promise<TrackMetadata> {
    const [startCommit, branch] = await Promise.all([
      this.getHeadCommit(),
      this.getBranch(),
    ]);

    const opts: CreateTrackOptions = {
      id,
      title,
      specContent,
      branch,
      startCommit,
    };

    return createTrack(this.tracksRoot, opts);
  }

  /**
   * Start a track — transition pending → in_progress.
   * FR-003: records git HEAD as start boundary.
   */
  async startTrack(
    trackId: string,
    planContent: string,
    steps: PlanStep[],
  ): Promise<TrackMetadata> {
    const meta = await readMetadata(this.tracksRoot, trackId);
    const transitioned = applyTransition(meta, "in_progress");

    // Record fresh git boundary at start time
    const startCommit = await this.getHeadCommit();
    transitioned.git = { ...transitioned.git, startCommit };

    // Merge plan data into transitioned metadata
    transitioned.plan = {
      totalSteps: steps.length,
      completedSteps: 0,
      steps,
    };

    // Write plan file and metadata together
    await writePlan(this.tracksRoot, trackId, planContent, steps);

    // Overwrite metadata with transitioned state (writePlan wrote its own metadata)
    await writeMetadata(this.tracksRoot, trackId, transitioned);

    return transitioned;
  }

  /**
   * Complete a track — transition in_progress → complete.
   * FR-010: requires all steps done and all TDD phases passed.
   */
  async completeTrack(trackId: string): Promise<TrackMetadata> {
    const meta = await readMetadata(this.tracksRoot, trackId);
    const transitioned = applyTransition(meta, "complete");

    const endCommit = await this.getHeadCommit();
    transitioned.git = { ...transitioned.git, endCommit };

    await writeMetadata(this.tracksRoot, trackId, transitioned);
    return transitioned;
  }

  /**
   * Archive a completed track.
   */
  async archiveTrack(trackId: string): Promise<TrackMetadata> {
    const meta = await readMetadata(this.tracksRoot, trackId);
    const transitioned = applyTransition(meta, "archived");
    await writeMetadata(this.tracksRoot, trackId, transitioned);
    return transitioned;
  }

  /**
   * Check whether a transition is valid without applying it.
   */
  async canTransition(
    trackId: string,
    to: TrackState,
  ): Promise<{ allowed: boolean; reason?: string }> {
    const meta = await readMetadata(this.tracksRoot, trackId);
    return validateTransition(meta, to);
  }

  /**
   * Get track metadata.
   */
  async getTrack(trackId: string): Promise<TrackMetadata> {
    return readMetadata(this.tracksRoot, trackId);
  }

  /**
   * List all tracks.
   * FR-008: shows all tracks with state, creation date, last activity.
   */
  async listTracks(): Promise<TrackMetadata[]> {
    return listTracks(this.tracksRoot);
  }
}
