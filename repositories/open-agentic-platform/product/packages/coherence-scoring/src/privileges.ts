// ── Privilege Level Mapping (spec 063, Phase 2) ─────────────────────

import type { CapabilityName, CapabilitySet, PrivilegeLevel } from "./types.js";
import { PRIVILEGE_CAPABILITIES } from "./types.js";

/**
 * Map a coherence score to a privilege level (FR-005).
 * - full:       score > 0.7
 * - restricted:  0.5 < score <= 0.7
 * - read_only:   0.3 < score <= 0.5
 * - suspended:   score <= 0.3
 */
export function scoreToLevel(score: number): PrivilegeLevel {
  if (score > 0.7) return "full";
  if (score > 0.5) return "restricted";
  if (score > 0.3) return "read_only";
  return "suspended";
}

/** Get the capability set for a privilege level. */
export function getCapabilities(level: PrivilegeLevel): CapabilitySet {
  return { ...PRIVILEGE_CAPABILITIES[level] };
}

/** Check whether a specific capability is enabled at a privilege level. */
export function hasCapability(level: PrivilegeLevel, capability: CapabilityName): boolean {
  return PRIVILEGE_CAPABILITIES[level][capability];
}

/** Get all enabled capability names for a privilege level. */
export function enabledCapabilities(level: PrivilegeLevel): CapabilityName[] {
  const caps = PRIVILEGE_CAPABILITIES[level];
  return (Object.keys(caps) as CapabilityName[]).filter((k) => caps[k]);
}

/** Get all disabled capability names for a privilege level. */
export function disabledCapabilities(level: PrivilegeLevel): CapabilityName[] {
  const caps = PRIVILEGE_CAPABILITIES[level];
  return (Object.keys(caps) as CapabilityName[]).filter((k) => !caps[k]);
}

/**
 * Compare two privilege levels. Returns:
 *  - negative if `a` is more privileged than `b`
 *  - zero if equal
 *  - positive if `a` is less privileged than `b`
 */
export function compareLevels(a: PrivilegeLevel, b: PrivilegeLevel): number {
  const order: Record<PrivilegeLevel, number> = {
    full: 0,
    restricted: 1,
    read_only: 2,
    suspended: 3,
  };
  return order[a] - order[b];
}
