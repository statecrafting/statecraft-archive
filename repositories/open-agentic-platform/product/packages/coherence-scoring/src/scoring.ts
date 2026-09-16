// ── Coherence Score Computation (spec 063, Phase 1) ─────────────────

import type {
  ActionOutcome,
  ActionRecord,
  CoherenceInputs,
  CoherenceResult,
  CoherenceWeights,
  SlidingWindowOptions,
} from "./types.js";
import {
  DEFAULT_WEIGHTS,
  DEFAULT_WINDOW_SIZE,
} from "./types.js";
import { scoreToLevel } from "./privileges.js";

// ── Pure score computation (FR-001) ─────────────────────────────────

/**
 * Compute coherence score from three weighted input signals.
 * score = 1 - (violationRate * w1 + reworkFrequency * w2 + intentDrift * w3)
 * Result is clamped to [0, 1].
 */
export function computeCoherence(
  inputs: CoherenceInputs,
  weights: CoherenceWeights = DEFAULT_WEIGHTS,
): number {
  const raw =
    1 -
    (inputs.violationRate * weights.violationRate +
      inputs.reworkFrequency * weights.reworkFrequency +
      inputs.intentDrift * weights.intentDrift);
  return Math.max(0, Math.min(1, raw));
}

// ── Sliding window tracker (FR-002, FR-003, FR-008) ─────────────────

export class SlidingWindow {
  private readonly maxSize: number;
  private readonly actions: ActionRecord[] = [];

  constructor(options?: SlidingWindowOptions) {
    this.maxSize = options?.windowSize ?? DEFAULT_WINDOW_SIZE;
  }

  /** Record an action outcome. Oldest actions are evicted when window is full. */
  record(outcome: ActionOutcome, timestamp: number = Date.now()): void {
    this.actions.push({ outcome, timestamp });
    if (this.actions.length > this.maxSize) {
      this.actions.shift();
    }
  }

  /** Current number of actions in the window. */
  get size(): number {
    return this.actions.length;
  }

  /** Configured maximum window size. */
  get capacity(): number {
    return this.maxSize;
  }

  /** Compute violation rate: violations / total (FR-002). */
  get violationRate(): number {
    if (this.actions.length === 0) return 0;
    const violations = this.actions.filter((a) => a.outcome === "violation").length;
    return violations / this.actions.length;
  }

  /** Compute rework frequency: reworks / total (FR-003). */
  get reworkFrequency(): number {
    if (this.actions.length === 0) return 0;
    const reworks = this.actions.filter((a) => a.outcome === "rework").length;
    return reworks / this.actions.length;
  }

  /** Get current coherence inputs from the window state. */
  getInputs(intentDrift: number = 0): CoherenceInputs {
    return {
      violationRate: this.violationRate,
      reworkFrequency: this.reworkFrequency,
      intentDrift,
    };
  }

  /**
   * Compute a full CoherenceResult from current window state.
   * Combines window metrics with optional intent drift and weights.
   */
  computeResult(
    intentDrift: number = 0,
    weights: CoherenceWeights = DEFAULT_WEIGHTS,
    now?: () => string,
  ): CoherenceResult {
    const inputs = this.getInputs(intentDrift);
    const score = computeCoherence(inputs, weights);
    return {
      score,
      level: scoreToLevel(score),
      inputs,
      weights,
      windowSize: this.actions.length,
      computedAt: now ? now() : new Date().toISOString(),
    };
  }

  /** Reset the window. */
  clear(): void {
    this.actions.length = 0;
  }

  /** Get a snapshot of all actions (defensive copy). */
  snapshot(): readonly ActionRecord[] {
    return [...this.actions];
  }
}
