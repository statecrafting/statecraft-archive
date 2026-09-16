// ── Coherence Pipeline (spec 063, Phase 5) ──────────────────────────

import type {
  ActionOutcome,
  CapabilityName,
  CoherenceResult,
  CoherenceWeights,
  EnforcementResult,
  PipelineOptions,
  PrivilegeChangedEvent,
  PrivilegeLevel,
} from "./types.js";
import { DEFAULT_WEIGHTS, DEFAULT_WINDOW_SIZE } from "./types.js";
import { SlidingWindow } from "./scoring.js";
import { scoreToLevel } from "./privileges.js";
import { checkCapability, enforceCapability } from "./enforcement.js";
import { ProofChain } from "./proof-chain.js";

/** Listener for privilege change events (FR-007). */
export type PrivilegeChangeListener = (event: PrivilegeChangedEvent) => void;

/**
 * The CoherencePipeline is the main integration point.
 * It wires together the sliding window, score computation, privilege mapping,
 * capability enforcement, proof chain, and event emission.
 */
export class CoherencePipeline {
  private readonly window: SlidingWindow;
  private readonly weights: CoherenceWeights;
  private readonly proofChain: ProofChain;
  private readonly intentDriftProvider: () => number;
  private readonly clock: () => number;
  private readonly listeners: PrivilegeChangeListener[] = [];
  private currentLevel: PrivilegeLevel = "full";
  private lastResult: CoherenceResult | null = null;

  constructor(options?: PipelineOptions) {
    this.window = new SlidingWindow({
      windowSize: options?.windowSize ?? DEFAULT_WINDOW_SIZE,
    });
    this.weights = { ...DEFAULT_WEIGHTS, ...options?.weights };
    this.intentDriftProvider = options?.intentDriftProvider ?? (() => 0);
    this.clock = options?.now ?? (() => Date.now());
    this.proofChain = new ProofChain({
      now: () => new Date(this.clock()).toISOString(),
    });
  }

  /**
   * Record an action outcome and recompute coherence.
   * This is the main entry point for the governance engine.
   * Returns the updated CoherenceResult.
   */
  recordAction(outcome: ActionOutcome): CoherenceResult {
    const timestamp = this.clock();
    this.window.record(outcome, timestamp);

    // Record action in proof chain
    this.proofChain.append("action_recorded", { outcome, timestamp });

    // Compute new score
    const intentDrift = this.intentDriftProvider();
    const result = this.window.computeResult(
      intentDrift,
      this.weights,
      () => new Date(this.clock()).toISOString(),
    );

    // Record score computation in proof chain
    this.proofChain.append("score_computed", {
      score: result.score,
      level: result.level,
      inputs: result.inputs,
    });

    // Check for privilege level transition (FR-007)
    const previousLevel = this.currentLevel;
    if (result.level !== previousLevel) {
      this.currentLevel = result.level;
      const event: PrivilegeChangedEvent = {
        previousLevel,
        newLevel: result.level,
        score: result.score,
        timestamp: result.computedAt,
      };

      // Record transition in proof chain
      this.proofChain.append("privilege_changed", event);

      // Emit to listeners
      for (const listener of this.listeners) {
        listener(event);
      }
    }

    this.lastResult = result;
    return result;
  }

  /** Check whether a capability is allowed at the current coherence state. */
  check(capability: CapabilityName): EnforcementResult {
    const result = this.getResult();
    return checkCapability(capability, result);
  }

  /** Enforce a capability — throws CapabilityDeniedError if not allowed. */
  enforce(capability: CapabilityName): void {
    const result = this.getResult();
    enforceCapability(capability, result);
  }

  /** Subscribe to privilege level change events. Returns unsubscribe function. */
  onPrivilegeChanged(listener: PrivilegeChangeListener): () => void {
    this.listeners.push(listener);
    return () => {
      const idx = this.listeners.indexOf(listener);
      if (idx >= 0) this.listeners.splice(idx, 1);
    };
  }

  /** Get the current coherence result. Returns a default "full" result if no actions recorded. */
  getResult(): CoherenceResult {
    if (this.lastResult) return this.lastResult;
    return {
      score: 1.0,
      level: "full",
      inputs: { violationRate: 0, reworkFrequency: 0, intentDrift: 0 },
      weights: this.weights,
      windowSize: 0,
      computedAt: new Date(this.clock()).toISOString(),
    };
  }

  /** Get current privilege level. */
  get level(): PrivilegeLevel {
    return this.currentLevel;
  }

  /** Get current coherence score. */
  get score(): number {
    return this.lastResult?.score ?? 1.0;
  }

  /** Access the underlying proof chain for verification. */
  get chain(): ProofChain {
    return this.proofChain;
  }

  /** Reset the pipeline to initial state. */
  reset(): void {
    this.window.clear();
    this.currentLevel = "full";
    this.lastResult = null;
  }
}
