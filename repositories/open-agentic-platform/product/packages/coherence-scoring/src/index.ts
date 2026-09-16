// ── @opc/coherence-scoring barrel exports (spec 063) ────────────────

// Types
export type {
  ActionOutcome,
  ActionRecord,
  CapabilityName,
  CapabilitySet,
  CoherenceInputs,
  CoherenceResult,
  CoherenceWeights,
  EnforcementResult,
  PipelineOptions,
  PrivilegeChangedEvent,
  PrivilegeLevel,
  ProofEventType,
  ProofRecord,
  SlidingWindowOptions,
} from "./types.js";

export {
  DEFAULT_WEIGHTS,
  DEFAULT_WINDOW_SIZE,
  PRIVILEGE_CAPABILITIES,
  PRIVILEGE_LEVELS,
  PRIVILEGE_THRESHOLDS,
} from "./types.js";

// Scoring
export { computeCoherence, SlidingWindow } from "./scoring.js";

// Privileges
export {
  scoreToLevel,
  getCapabilities,
  hasCapability,
  enabledCapabilities,
  disabledCapabilities,
  compareLevels,
} from "./privileges.js";

// Enforcement
export {
  checkCapability,
  enforceCapability,
  checkCapabilities,
  actionToCapability,
  CapabilityDeniedError,
} from "./enforcement.js";

// Proof chain
export {
  ProofChain,
  computePayloadHash,
  computeRecordHash,
} from "./proof-chain.js";
export type { ProofChainVerifyResult, ProofChainOptions } from "./proof-chain.js";

// Pipeline
export { CoherencePipeline } from "./pipeline.js";
export type { PrivilegeChangeListener } from "./pipeline.js";
