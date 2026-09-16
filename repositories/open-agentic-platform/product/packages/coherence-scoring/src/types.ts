// ── Coherence Scoring Types (spec 063) ──────────────────────────────

/** Three input signals for coherence computation. All values in [0, 1]. */
export interface CoherenceInputs {
  /** Ratio of governance violations to total governed actions in the window. */
  violationRate: number;
  /** Ratio of reverted/redone actions to total actions in the window. */
  reworkFrequency: number;
  /** Divergence from session intent: 0 = aligned, 1 = fully diverged. */
  intentDrift: number;
}

/** Weights for the three coherence input signals. Must sum to <= 1. */
export interface CoherenceWeights {
  violationRate: number; // default 0.4
  reworkFrequency: number; // default 0.3
  intentDrift: number; // default 0.3
}

/** Privilege levels ordered by decreasing trust. */
export type PrivilegeLevel = "full" | "restricted" | "read_only" | "suspended";

/** Result of a coherence score computation. */
export interface CoherenceResult {
  score: number;
  level: PrivilegeLevel;
  inputs: CoherenceInputs;
  weights: CoherenceWeights;
  windowSize: number;
  computedAt: string; // ISO 8601
}

/** Capability flags per privilege level. */
export interface CapabilitySet {
  fileRead: boolean;
  fileWrite: boolean;
  fileDelete: boolean;
  gitRead: boolean;
  gitWrite: boolean;
  networkAccess: boolean;
  toolUse: boolean;
  agentSpawn: boolean;
}

/** Outcome of a single governed action recorded in the sliding window. */
export type ActionOutcome = "clean" | "violation" | "rework";

/** A recorded action in the sliding window. */
export interface ActionRecord {
  outcome: ActionOutcome;
  timestamp: number;
}

/** Configuration for the sliding window tracker. */
export interface SlidingWindowOptions {
  /** Maximum number of actions in the window (FR-002, default 50). */
  windowSize?: number;
}

/** Event types recorded in the proof chain. */
export type ProofEventType =
  | "score_computed"
  | "privilege_changed"
  | "governance_decision"
  | "action_recorded";

/** A single record in the hash-chained proof trail. */
export interface ProofRecord {
  sequence: number;
  timestamp: string; // ISO 8601
  eventType: ProofEventType;
  payload: unknown;
  payloadHash: string; // SHA-256 hex
  previousHash: string; // empty string for first record
  recordHash: string; // SHA-256 hex
}

/** Options for the coherence pipeline. */
export interface PipelineOptions {
  weights?: Partial<CoherenceWeights>;
  windowSize?: number;
  /** Injectable intent drift provider. Returns 0-1. */
  intentDriftProvider?: () => number;
  /** Injectable clock for deterministic testing. */
  now?: () => number;
}

/** Emitted when a privilege level transition occurs. */
export interface PrivilegeChangedEvent {
  previousLevel: PrivilegeLevel;
  newLevel: PrivilegeLevel;
  score: number;
  timestamp: string;
}

/** Capability names for enforcement checking. */
export type CapabilityName = keyof CapabilitySet;

/** Result of a capability enforcement check. */
export interface EnforcementResult {
  allowed: boolean;
  capability: CapabilityName;
  level: PrivilegeLevel;
  score: number;
  reason?: string;
}

// ── Constants ────────────────────────────────────────────────────────

export const DEFAULT_WEIGHTS: CoherenceWeights = {
  violationRate: 0.4,
  reworkFrequency: 0.3,
  intentDrift: 0.3,
};

export const DEFAULT_WINDOW_SIZE = 50;

/** Privilege levels ordered from highest to lowest trust. */
export const PRIVILEGE_LEVELS: readonly PrivilegeLevel[] = [
  "full",
  "restricted",
  "read_only",
  "suspended",
] as const;

/** Score thresholds for privilege level boundaries (FR-005). */
export const PRIVILEGE_THRESHOLDS: Record<PrivilegeLevel, { min: number; max: number }> = {
  full: { min: 0.7, max: 1.0 },
  restricted: { min: 0.5, max: 0.7 },
  read_only: { min: 0.3, max: 0.5 },
  suspended: { min: 0.0, max: 0.3 },
};

/** Capability sets per privilege level (FR-006). */
export const PRIVILEGE_CAPABILITIES: Record<PrivilegeLevel, CapabilitySet> = {
  full: {
    fileRead: true,
    fileWrite: true,
    fileDelete: true,
    gitRead: true,
    gitWrite: true,
    networkAccess: true,
    toolUse: true,
    agentSpawn: true,
  },
  restricted: {
    fileRead: true,
    fileWrite: true,
    fileDelete: false,
    gitRead: true,
    gitWrite: false,
    networkAccess: false,
    toolUse: true,
    agentSpawn: false,
  },
  read_only: {
    fileRead: true,
    fileWrite: false,
    fileDelete: false,
    gitRead: true,
    gitWrite: false,
    networkAccess: false,
    toolUse: false,
    agentSpawn: false,
  },
  suspended: {
    fileRead: false,
    fileWrite: false,
    fileDelete: false,
    gitRead: false,
    gitWrite: false,
    networkAccess: false,
    toolUse: false,
    agentSpawn: false,
  },
};
