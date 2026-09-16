/**
 * The action gate (spec 008 §2).
 *
 * Factory (005) and fleet (006) call this before a privileged verb. Deny is
 * final; on allow the caller must attach the returned `configHash` to the
 * attestation it records. Callers treat a missing governance service as deny
 * for remove-class actions and warn-and-proceed for read-class (spec 008 §3);
 * that fallback lives in the caller, not here.
 */
import { api } from "encore.dev/api";

import { GATE_CONFIG_JSON } from "./config";
import native, { type GateOutcome } from "./native";

interface GateRequest {
  /** The proposed action, e.g. "stamp", "deploy", "remove". */
  action: string;
  /** A canonical string form of the payload, for scanning checks. */
  payloadSummary?: string;
  /** The full content under review, when there is one. */
  payloadBody?: string;
  /** Domain-specific inputs the checks read (posture, tenant_status, ...). */
  attributes?: Record<string, unknown>;
}

interface GateResponse {
  outcome: GateOutcome;
  reason: string;
  checkIds: string[];
  blocking: boolean;
  configHash: string;
}

// POST /governance/gate : evaluate an ActionContext against gate config v1.
export const gate = api(
  { expose: false, method: "POST", path: "/governance/gate" },
  async (req: GateRequest): Promise<GateResponse> => {
    // The addon's ActionContext uses snake_case field names (serde default).
    const actionContext = {
      action: req.action,
      payload_summary: req.payloadSummary ?? "",
      payload_body: req.payloadBody ?? null,
      attributes: req.attributes ?? {},
    };
    return native.gateEvaluate(GATE_CONFIG_JSON, JSON.stringify(actionContext));
  },
);
