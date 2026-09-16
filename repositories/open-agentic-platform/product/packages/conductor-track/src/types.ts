/**
 * Conductor Track Lifecycle — Type definitions
 *
 * Spec 061: tracks are the fundamental work unit with a formal lifecycle,
 * standard directory structure, TDD phase checkpoints, and git-aware boundaries.
 */

// ---------------------------------------------------------------------------
// Track states
// ---------------------------------------------------------------------------

export type TrackState =
  | "pending"
  | "in_progress"
  | "complete"
  | "archived"
  | "reverted";

export const TRACK_STATES: readonly TrackState[] = [
  "pending",
  "in_progress",
  "complete",
  "archived",
  "reverted",
] as const;

// ---------------------------------------------------------------------------
// Plan steps
// ---------------------------------------------------------------------------

export type PlanStepStatus = "pending" | "in_progress" | "done" | "skipped";

export interface PlanStep {
  index: number;
  description: string;
  status: PlanStepStatus;
  completedAt?: string; // ISO 8601
}

// ---------------------------------------------------------------------------
// TDD phase checkpoints
// ---------------------------------------------------------------------------

export type TddPhase = "red" | "green" | "refactor";

export const TDD_PHASES: readonly TddPhase[] = [
  "red",
  "green",
  "refactor",
] as const;

export interface TestResults {
  passed: number;
  failed: number;
  skipped: number;
}

export interface PhaseCheckpoint {
  passedAt: string; // ISO 8601
  commitSha: string;
  testResults?: TestResults;
}

// ---------------------------------------------------------------------------
// Git boundary
// ---------------------------------------------------------------------------

export interface GitBoundary {
  startCommit: string; // SHA at track start
  branch: string; // Branch the track operates on
  endCommit?: string; // SHA at track completion
}

// ---------------------------------------------------------------------------
// Track metadata (metadata.json)
// ---------------------------------------------------------------------------

export interface TrackMetadata {
  id: string;
  title: string;
  state: TrackState;
  createdAt: string; // ISO 8601
  updatedAt: string; // ISO 8601
  git: GitBoundary;
  plan: {
    totalSteps: number;
    completedSteps: number;
    steps: PlanStep[];
  };
  tdd: {
    red: PhaseCheckpoint | null;
    green: PhaseCheckpoint | null;
    refactor: PhaseCheckpoint | null;
  };
}

// ---------------------------------------------------------------------------
// Track creation options
// ---------------------------------------------------------------------------

export interface CreateTrackOptions {
  id: string;
  title: string;
  specContent: string;
  branch: string;
  startCommit: string;
}

// ---------------------------------------------------------------------------
// Transition errors
// ---------------------------------------------------------------------------

export class TrackTransitionError extends Error {
  constructor(
    public readonly trackId: string,
    public readonly from: TrackState,
    public readonly to: TrackState,
    public readonly reason: string,
  ) {
    super(
      `Cannot transition track "${trackId}" from "${from}" to "${to}": ${reason}`,
    );
    this.name = "TrackTransitionError";
  }
}

export class TrackNotFoundError extends Error {
  constructor(public readonly trackId: string) {
    super(`Track "${trackId}" not found`);
    this.name = "TrackNotFoundError";
  }
}

export class TrackStorageError extends Error {
  constructor(
    public readonly trackId: string,
    message: string,
  ) {
    super(`Track storage error for "${trackId}": ${message}`);
    this.name = "TrackStorageError";
  }
}
