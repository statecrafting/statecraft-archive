/**
 * Plan-implementer binding — executes within a track context.
 *
 * FR-005: reads plan.md for step sequence, updates metadata.json as each step completes.
 * Parses plan markdown into PlanStep[] and provides step-level progress tracking.
 */

import type { PlanStep, PlanStepStatus, TrackMetadata } from "./types.js";
import { readMetadata, writeMetadata, readPlan } from "./storage.js";

// ---------------------------------------------------------------------------
// Plan parsing
// ---------------------------------------------------------------------------

/**
 * Parse a plan.md into ordered PlanStep[].
 * Expects numbered lines like "1. Description" or "- Description".
 */
export function parsePlanSteps(planContent: string): PlanStep[] {
  const lines = planContent.split("\n");
  const steps: PlanStep[] = [];
  let index = 0;

  for (const line of lines) {
    const trimmed = line.trim();

    // Match "1. Description", "2) Description", or "- Description"
    const numbered = trimmed.match(/^(\d+)[.)]\s+(.+)/);
    const bulleted = trimmed.match(/^[-*]\s+(.+)/);

    let description: string | null = null;
    if (numbered) {
      description = numbered[2];
    } else if (bulleted) {
      description = bulleted[1];
    }

    if (description) {
      // Skip headings that snuck through (lines starting with #)
      if (description.startsWith("#")) continue;

      steps.push({
        index,
        description: description.trim(),
        status: "pending",
      });
      index++;
    }
  }

  return steps;
}

// ---------------------------------------------------------------------------
// Step progress tracking
// ---------------------------------------------------------------------------

export interface StepUpdateResult {
  step: PlanStep;
  metadata: TrackMetadata;
}

/**
 * Mark a plan step as a given status.
 * FR-005: updates metadata.json with step progress.
 */
export async function updateStepStatus(
  tracksRoot: string,
  trackId: string,
  stepIndex: number,
  status: PlanStepStatus,
): Promise<StepUpdateResult> {
  const meta = await readMetadata(tracksRoot, trackId);

  const step = meta.plan.steps.find((s) => s.index === stepIndex);
  if (!step) {
    throw new Error(
      `Step ${stepIndex} not found in track "${trackId}" (${meta.plan.totalSteps} total steps)`,
    );
  }

  step.status = status;
  if (status === "done" || status === "skipped") {
    step.completedAt = new Date().toISOString();
  }

  // Recompute completedSteps
  meta.plan.completedSteps = meta.plan.steps.filter(
    (s) => s.status === "done" || s.status === "skipped",
  ).length;

  await writeMetadata(tracksRoot, trackId, meta);
  return { step: { ...step }, metadata: meta };
}

/**
 * Start the next pending step (mark as in_progress).
 * Returns null if no pending steps remain.
 */
export async function startNextStep(
  tracksRoot: string,
  trackId: string,
): Promise<StepUpdateResult | null> {
  const meta = await readMetadata(tracksRoot, trackId);
  const next = meta.plan.steps.find((s) => s.status === "pending");
  if (!next) return null;

  return updateStepStatus(tracksRoot, trackId, next.index, "in_progress");
}

/**
 * Complete the current in-progress step.
 * Returns null if no in-progress step exists.
 */
export async function completeCurrentStep(
  tracksRoot: string,
  trackId: string,
): Promise<StepUpdateResult | null> {
  const meta = await readMetadata(tracksRoot, trackId);
  const current = meta.plan.steps.find((s) => s.status === "in_progress");
  if (!current) return null;

  return updateStepStatus(tracksRoot, trackId, current.index, "done");
}

/**
 * Get progress summary for a track's plan.
 */
export function getPlanProgress(meta: TrackMetadata): {
  total: number;
  completed: number;
  inProgress: number;
  pending: number;
  skipped: number;
  percentComplete: number;
} {
  const steps = meta.plan.steps;
  const completed = steps.filter((s) => s.status === "done").length;
  const inProgress = steps.filter((s) => s.status === "in_progress").length;
  const pending = steps.filter((s) => s.status === "pending").length;
  const skipped = steps.filter((s) => s.status === "skipped").length;
  const total = steps.length;
  const percentComplete = total > 0 ? Math.round(((completed + skipped) / total) * 100) : 0;

  return { total, completed, inProgress, pending, skipped, percentComplete };
}
