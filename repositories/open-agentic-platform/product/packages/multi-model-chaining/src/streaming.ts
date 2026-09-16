import type { AgentEvent } from "@opc/provider-registry";
import type { ChainEvent, ChainPhase, PhaseUsage, ChainUsage } from "./types.js";

/**
 * Emit a phase_start event (FR-007).
 */
export function createPhaseStartEvent(phase: ChainPhase): ChainEvent {
  return {
    type: "chain:phase_start",
    phaseIndex: phase.phaseIndex,
    providerId: phase.providerId,
    modelId: phase.modelId,
  };
}

/**
 * Emit a phase_end event with usage (FR-007).
 */
export function createPhaseEndEvent(
  phaseIndex: number,
  usage: PhaseUsage,
): ChainEvent {
  return {
    type: "chain:phase_end",
    phaseIndex,
    usage,
  };
}

/**
 * Emit a chain:complete event (FR-007).
 */
export function createChainCompleteEvent(usage: ChainUsage): ChainEvent {
  return {
    type: "chain:complete",
    usage,
  };
}

/**
 * Emit a chain:error event (FR-008).
 */
export function createChainErrorEvent(
  phaseIndex: number,
  error: string,
): ChainEvent {
  return {
    type: "chain:error",
    phaseIndex,
    error,
  };
}

/**
 * Augment an AgentEvent with phaseIndex metadata for the SSE stream.
 */
export function augmentEventWithPhase(
  event: AgentEvent,
  phaseIndex: number,
): ChainEvent {
  return { ...event, phaseIndex };
}
