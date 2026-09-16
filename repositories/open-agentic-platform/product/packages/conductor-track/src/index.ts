/**
 * @opc/conductor-track — Spec-driven work unit lifecycle
 *
 * Spec 061: Conductor Track Lifecycle
 */

// Types
export type {
  TrackState,
  PlanStepStatus,
  PlanStep,
  TddPhase,
  TestResults,
  PhaseCheckpoint,
  GitBoundary,
  TrackMetadata,
  CreateTrackOptions,
} from "./types.js";
export {
  TRACK_STATES,
  TDD_PHASES,
  TrackTransitionError,
  TrackNotFoundError,
  TrackStorageError,
} from "./types.js";

// Storage
export {
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

// State machine
export {
  canTransition,
  validateTransition,
  applyTransition,
} from "./state-machine.js";
export type { TransitionGuardResult } from "./state-machine.js";

// Conductor
export { Conductor } from "./conductor.js";
export type { ConductorOptions } from "./conductor.js";

// Plan implementer
export {
  parsePlanSteps,
  updateStepStatus,
  startNextStep,
  completeCurrentStep,
  getPlanProgress,
} from "./plan-implementer.js";
export type { StepUpdateResult } from "./plan-implementer.js";

// TDD checkpoints
export {
  recordCheckpoint,
  validatePhaseOrder,
  validatePhaseResults,
  overrideCheckpoint,
  allPhasesPassed,
  nextRequiredPhase,
} from "./checkpoints.js";
export type {
  RecordCheckpointOptions,
  OverrideCheckpointOptions,
} from "./checkpoints.js";

// Git-aware revert
export {
  checkRevertSafety,
  revertTrack,
} from "./git.js";
export type {
  GitOps,
  RevertOptions,
  RevertResult,
  RevertSafetyResult,
} from "./git.js";

// CLI commands
export {
  trackList,
  formatTrackList,
  trackInspect,
  formatTrackInspection,
} from "./commands.js";
export type {
  TrackListEntry,
  TrackInspection,
} from "./commands.js";
