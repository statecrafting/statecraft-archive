// ── Capability Enforcement (spec 063, Phase 3) ──────────────────────

import type {
  CapabilityName,
  CoherenceResult,
  EnforcementResult,
  PrivilegeLevel,
} from "./types.js";
import { PRIVILEGE_CAPABILITIES } from "./types.js";

/**
 * Check whether a capability is allowed at the current coherence state.
 * Returns an EnforcementResult with allowed/denied + reason.
 */
export function checkCapability(
  capability: CapabilityName,
  result: CoherenceResult,
): EnforcementResult {
  const allowed = PRIVILEGE_CAPABILITIES[result.level][capability];
  return {
    allowed,
    capability,
    level: result.level,
    score: result.score,
    reason: allowed
      ? undefined
      : `Capability "${capability}" is disabled at privilege level "${result.level}" (score: ${result.score.toFixed(3)})`,
  };
}

/**
 * Enforce a capability — throws if not allowed.
 */
export function enforceCapability(
  capability: CapabilityName,
  result: CoherenceResult,
): void {
  const check = checkCapability(capability, result);
  if (!check.allowed) {
    throw new CapabilityDeniedError(check);
  }
}

/**
 * Batch-check multiple capabilities. Returns all results.
 */
export function checkCapabilities(
  capabilities: CapabilityName[],
  result: CoherenceResult,
): EnforcementResult[] {
  return capabilities.map((cap) => checkCapability(cap, result));
}

/**
 * Map an action description to the required capability.
 * This provides a simple action-to-capability mapping for the governance engine.
 */
export function actionToCapability(action: string): CapabilityName | undefined {
  const mapping: Record<string, CapabilityName> = {
    "file.read": "fileRead",
    "file.write": "fileWrite",
    "file.delete": "fileDelete",
    "git.log": "gitRead",
    "git.status": "gitRead",
    "git.diff": "gitRead",
    "git.commit": "gitWrite",
    "git.push": "gitWrite",
    "git.branch": "gitWrite",
    "network.fetch": "networkAccess",
    "network.request": "networkAccess",
    "tool.invoke": "toolUse",
    "agent.spawn": "agentSpawn",
  };
  return mapping[action];
}

/** Error thrown when a capability is denied by coherence enforcement. */
export class CapabilityDeniedError extends Error {
  readonly capability: CapabilityName;
  readonly level: PrivilegeLevel;
  readonly score: number;

  constructor(result: EnforcementResult) {
    super(result.reason ?? `Capability "${result.capability}" denied at level "${result.level}"`);
    this.name = "CapabilityDeniedError";
    this.capability = result.capability;
    this.level = result.level;
    this.score = result.score;
  }
}
