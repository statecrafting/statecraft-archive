/**
 * Track lifecycle state machine.
 *
 * States: pending → in_progress → complete → archived
 * Special: any state except archived → reverted (terminal)
 *
 * Each transition has guard conditions that must be satisfied.
 */

import type { TrackMetadata, TrackState } from "./types.js";
import { TrackTransitionError, TDD_PHASES } from "./types.js";

// ---------------------------------------------------------------------------
// Valid transitions
// ---------------------------------------------------------------------------

const VALID_TRANSITIONS: Record<TrackState, TrackState[]> = {
  pending: ["in_progress", "reverted"],
  in_progress: ["complete", "reverted"],
  complete: ["archived", "reverted"],
  archived: [],
  reverted: [],
};

export function canTransition(from: TrackState, to: TrackState): boolean {
  return VALID_TRANSITIONS[from]?.includes(to) ?? false;
}

// ---------------------------------------------------------------------------
// Guard conditions
// ---------------------------------------------------------------------------

export interface TransitionGuardResult {
  allowed: boolean;
  reason?: string;
}

function guardToInProgress(meta: TrackMetadata): TransitionGuardResult {
  // No special guard — plan.md generation happens during the transition
  return { allowed: true };
}

function guardToComplete(meta: TrackMetadata): TransitionGuardResult {
  // FR-010: all plan steps must be done
  const pendingSteps = meta.plan.steps.filter(
    (s) => s.status !== "done" && s.status !== "skipped",
  );
  if (pendingSteps.length > 0) {
    return {
      allowed: false,
      reason: `${pendingSteps.length} plan step(s) not yet done or skipped`,
    };
  }

  // FR-010: all TDD phases must have passed
  for (const phase of TDD_PHASES) {
    if (meta.tdd[phase] === null) {
      return {
        allowed: false,
        reason: `TDD phase "${phase}" has not passed`,
      };
    }
  }

  return { allowed: true };
}

function guardToArchived(_meta: TrackMetadata): TransitionGuardResult {
  return { allowed: true };
}

function guardToReverted(meta: TrackMetadata): TransitionGuardResult {
  if (meta.state === "archived") {
    return { allowed: false, reason: "Cannot revert an archived track" };
  }
  if (!meta.git.startCommit) {
    return { allowed: false, reason: "No git start boundary recorded" };
  }
  return { allowed: true };
}

const GUARDS: Partial<
  Record<TrackState, (meta: TrackMetadata) => TransitionGuardResult>
> = {
  in_progress: guardToInProgress,
  complete: guardToComplete,
  archived: guardToArchived,
  reverted: guardToReverted,
};

// ---------------------------------------------------------------------------
// Transition
// ---------------------------------------------------------------------------

export function validateTransition(
  meta: TrackMetadata,
  to: TrackState,
): TransitionGuardResult {
  if (!canTransition(meta.state, to)) {
    return {
      allowed: false,
      reason: `Invalid transition from "${meta.state}" to "${to}"`,
    };
  }

  const guard = GUARDS[to];
  if (guard) {
    return guard(meta);
  }

  return { allowed: true };
}

export function applyTransition(
  meta: TrackMetadata,
  to: TrackState,
): TrackMetadata {
  const result = validateTransition(meta, to);
  if (!result.allowed) {
    throw new TrackTransitionError(
      meta.id,
      meta.state,
      to,
      result.reason ?? "Unknown reason",
    );
  }

  const now = new Date().toISOString();
  const updated: TrackMetadata = {
    ...meta,
    state: to,
    updatedAt: now,
  };

  // Record end commit placeholder on completion
  if (to === "complete") {
    updated.git = { ...meta.git };
    // endCommit will be set by the caller with the actual SHA
  }

  return updated;
}
