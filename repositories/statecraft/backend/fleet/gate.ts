/**
 * The action-gate soft hook (spec 006 §3, spec 008 §3).
 *
 * Fleet is the first consumer of `POST /governance/gate`. Before a mutating verb
 * it asks the gate; a blocking outcome (GateOutcome "deny") is final. The
 * governance service is a SOFT dependency: when it is unreachable, spec 008 §3
 * says deny for remove-class actions and warn-and-proceed for read-class. Fleet
 * maps its verbs to two classes:
 *   - "strict" (remove, update): deny if the gate is unreachable.
 *   - "soft"   (deploy, backup): warn and proceed if the gate is unreachable.
 * The decision policy is `resolveGate` (pure, unit-tested in gate-policy.ts);
 * this module wires the client to it. A transport error never masquerades as an
 * allow. On allow the caller attaches the returned configHash to its attestation.
 */
import { APIError } from "encore.dev/api";
import { getAuthData } from "~encore/auth";
import { governance } from "~encore/clients";

import { logError, logWarn } from "../lib/logger";

import { type GateClass, type GateDecision, resolveGate } from "./gate-policy";

export type { GateClass } from "./gate-policy";

export interface GateOk {
  /** The gate config hash from the allow decision, or null when skipped (soft). */
  configHash: string | null;
}

export async function gateOrDeny(
  action: string,
  attributes: Record<string, unknown>,
  cls: GateClass,
): Promise<GateOk> {
  // The gate's actor-authenticated check requires the authenticated actor in the
  // ActionContext. Every gated fleet verb runs under auth: true, so attach the
  // caller identity here (auth context is authoritative; callers cannot spoof it).
  const auth = getAuthData();
  const gateAttributes = auth
    ? { ...attributes, actor: `user:${auth.userID}`, authenticated: true }
    : attributes;
  let decision: GateDecision | null = null;
  try {
    decision = await governance.gate({ action, attributes: gateAttributes });
  } catch (err) {
    logError("fleet.gate_unreachable", { action, cls, err: String(err) });
    decision = null;
  }

  const verdict = resolveGate(cls, decision);
  if (verdict.kind === "deny") {
    throw APIError.permissionDenied(`governance gate denied ${action}: ${verdict.reason}`);
  }
  if (verdict.kind === "unavailable") {
    throw APIError.unavailable(`governance gate unreachable; refusing ${action}`);
  }
  if (decision === null && cls === "soft") {
    logWarn("fleet.gate_skipped_soft", { action });
  }
  return { configHash: verdict.configHash };
}
