/**
 * Pure action-gate policy (spec 006 §3, spec 008 §3). No Encore imports, so it
 * is unit-testable without the runtime. `gate.ts` wires the governance client to
 * `resolveGate` and translates the verdict into APIError / a config hash.
 */

export type GateClass = "strict" | "soft";

/** The fields of a governance gate decision fleet reads. */
export interface GateDecision {
  outcome: string;
  reason: string;
  blocking: boolean;
  configHash: string;
}

export type GateVerdict =
  | { kind: "allow"; configHash: string | null }
  | { kind: "deny"; reason: string }
  | { kind: "unavailable" };

/**
 * `decision === null` means the gate was unreachable: deny for a strict verb
 * (remove/update), warn-and-proceed for a soft one (deploy/backup). A blocking
 * decision denies; otherwise it allows and carries the config hash.
 */
export function resolveGate(cls: GateClass, decision: GateDecision | null): GateVerdict {
  if (decision === null) {
    return cls === "strict" ? { kind: "unavailable" } : { kind: "allow", configHash: null };
  }
  if (decision.blocking) {
    return { kind: "deny", reason: decision.reason };
  }
  return { kind: "allow", configHash: decision.configHash };
}
