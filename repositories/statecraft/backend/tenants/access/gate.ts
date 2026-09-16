/**
 * The action-gate hook for destructive tenant lifecycle acts (spec 011 §5.5,
 * spec 008 §2). Tenant deletion is a privileged, irreversible act, so it is
 * gated strict: a blocking decision is final, and an unreachable governance
 * service refuses the action rather than proceeding (spec 008 §3, remove-class).
 * On allow the caller attaches the returned `configHash` to its attestation.
 *
 * This mirrors fleet/gate.ts but is owned here to avoid a tenants<->fleet
 * module cycle; the shared policy is small enough to state directly.
 */
import { APIError } from "encore.dev/api";
import { getAuthData } from "~encore/auth";
import { governance } from "~encore/clients";

import { logError } from "../../lib/logger";

export interface GateOk {
  /** The gate config hash from the allow decision (for the attestation). */
  configHash: string | null;
}

export async function gateOrDeny(
  action: string,
  attributes: Record<string, unknown>,
): Promise<GateOk> {
  // The gate's actor check reads the authenticated actor from the context; auth
  // is authoritative and cannot be spoofed by the caller.
  const auth = getAuthData();
  const gateAttributes = auth
    ? { ...attributes, actor: `user:${auth.userID}`, authenticated: true }
    : attributes;

  let decision: { blocking: boolean; outcome: string; reason: string; configHash: string } | null =
    null;
  try {
    decision = await governance.gate({ action, attributes: gateAttributes });
  } catch (err) {
    logError("access.gate_unreachable", { action, err: String(err) });
    decision = null;
  }

  if (!decision) {
    throw APIError.unavailable(`governance gate unreachable; refusing ${action}`);
  }
  if (decision.blocking) {
    throw APIError.permissionDenied(`governance gate denied ${action}: ${decision.reason}`);
  }
  return { configHash: decision.configHash };
}
