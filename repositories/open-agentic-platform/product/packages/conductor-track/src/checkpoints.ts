/**
 * TDD phase checkpoints — validation and recording.
 *
 * FR-006: Red (failing tests written), Green (tests pass), Refactor (tests still pass).
 * Each phase is recorded in metadata.json with timestamp, commit SHA, and test results.
 */

import type {
  TrackMetadata,
  TddPhase,
  PhaseCheckpoint,
  TestResults,
} from "./types.js";
import { TDD_PHASES } from "./types.js";
import { readMetadata, writeMetadata } from "./storage.js";

// ---------------------------------------------------------------------------
// Checkpoint recording
// ---------------------------------------------------------------------------

export interface RecordCheckpointOptions {
  tracksRoot: string;
  trackId: string;
  phase: TddPhase;
  commitSha: string;
  testResults?: TestResults;
}

/**
 * Record a TDD phase checkpoint.
 * Validates phase ordering: red must come before green, green before refactor.
 */
export async function recordCheckpoint(
  opts: RecordCheckpointOptions,
): Promise<TrackMetadata> {
  const meta = await readMetadata(opts.tracksRoot, opts.trackId);

  if (meta.state !== "in_progress") {
    throw new Error(
      `Cannot record checkpoint for track "${opts.trackId}" in state "${meta.state}" — must be in_progress`,
    );
  }

  // Validate phase ordering
  const phaseError = validatePhaseOrder(meta, opts.phase);
  if (phaseError) {
    throw new Error(phaseError);
  }

  // Validate test results match phase expectations
  const resultError = validatePhaseResults(opts.phase, opts.testResults);
  if (resultError) {
    throw new Error(resultError);
  }

  const checkpoint: PhaseCheckpoint = {
    passedAt: new Date().toISOString(),
    commitSha: opts.commitSha,
    testResults: opts.testResults,
  };

  meta.tdd[opts.phase] = checkpoint;
  await writeMetadata(opts.tracksRoot, opts.trackId, meta);
  return meta;
}

// ---------------------------------------------------------------------------
// Phase ordering validation
// ---------------------------------------------------------------------------

/**
 * Validate TDD phase ordering: red → green → refactor.
 * Returns an error message if ordering is violated, null if valid.
 */
export function validatePhaseOrder(
  meta: TrackMetadata,
  phase: TddPhase,
): string | null {
  switch (phase) {
    case "red":
      // Red can always be recorded first
      return null;

    case "green":
      if (!meta.tdd.red) {
        return 'Cannot record "green" phase before "red" phase has passed';
      }
      return null;

    case "refactor":
      if (!meta.tdd.red) {
        return 'Cannot record "refactor" phase before "red" phase has passed';
      }
      if (!meta.tdd.green) {
        return 'Cannot record "refactor" phase before "green" phase has passed';
      }
      return null;

    default:
      return `Unknown TDD phase: "${phase}"`;
  }
}

// ---------------------------------------------------------------------------
// Phase result validation
// ---------------------------------------------------------------------------

/**
 * Validate test results match phase expectations.
 * - Red phase: should have failing tests (failed > 0)
 * - Green phase: all tests should pass (failed === 0)
 * - Refactor phase: all tests should still pass (failed === 0)
 *
 * Returns error message or null. Results are optional — when absent, skip validation.
 * R-002: can be overridden by conductor with explicit reason.
 */
export function validatePhaseResults(
  phase: TddPhase,
  results?: TestResults,
): string | null {
  if (!results) return null;

  switch (phase) {
    case "red":
      if (results.failed === 0) {
        return "Red phase expects failing tests, but all tests passed";
      }
      return null;

    case "green":
      if (results.failed > 0) {
        return `Green phase requires all tests to pass, but ${results.failed} test(s) failed`;
      }
      return null;

    case "refactor":
      if (results.failed > 0) {
        return `Refactor phase requires all tests to pass, but ${results.failed} test(s) failed`;
      }
      return null;

    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Override (R-002: manual override with reason)
// ---------------------------------------------------------------------------

export interface OverrideCheckpointOptions extends RecordCheckpointOptions {
  reason: string;
}

/**
 * Force-record a checkpoint, bypassing phase result validation.
 * R-002: conductor can manually override with an explicit reason.
 */
export async function overrideCheckpoint(
  opts: OverrideCheckpointOptions,
): Promise<TrackMetadata> {
  const meta = await readMetadata(opts.tracksRoot, opts.trackId);

  if (meta.state !== "in_progress") {
    throw new Error(
      `Cannot record checkpoint for track "${opts.trackId}" in state "${meta.state}"`,
    );
  }

  const checkpoint: PhaseCheckpoint = {
    passedAt: new Date().toISOString(),
    commitSha: opts.commitSha,
    testResults: opts.testResults,
  };

  meta.tdd[opts.phase] = checkpoint;
  await writeMetadata(opts.tracksRoot, opts.trackId, meta);
  return meta;
}

// ---------------------------------------------------------------------------
// Query helpers
// ---------------------------------------------------------------------------

/**
 * Check if all TDD phases have passed for a track.
 * SC-003: blocks completion if any phase not passed.
 */
export function allPhasesPassed(meta: TrackMetadata): boolean {
  return TDD_PHASES.every((phase) => meta.tdd[phase] !== null);
}

/**
 * Get the next required TDD phase, or null if all passed.
 */
export function nextRequiredPhase(meta: TrackMetadata): TddPhase | null {
  for (const phase of TDD_PHASES) {
    if (meta.tdd[phase] === null) return phase;
  }
  return null;
}
