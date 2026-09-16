/**
 * Spec 201 FR-001 — server-side `ApprovalSummary` assembly from recorded
 * facts. DB half: fetches admission state + substrate rows and feeds the
 * pure assembly in `approvalSummary-pure.ts`.
 *
 * Read-only by contract (FR-003): no row writes, no model calls, no I/O
 * other than DB reads; the only clock-dependent value is `assembledAt`,
 * which is outside the hashed field set.
 */

import { api, APIError } from "encore.dev/api";
import { getAuthData } from "~encore/auth";
import { and, desc, eq, inArray, isNotNull } from "drizzle-orm";
import { db } from "../db/drizzle";
import { auditLog, factoryArtifactSubstrate, factoryRuns } from "../db/schema";
import { isFactoryAdmitted, loadLatestAdmission } from "./admission";
import { sweepContentHashRevocations } from "./overrideScanCore";
import { FACTORY_RUN_GATE_APPROVED } from "./auditActions";
import { DEFAULT_REQUIRE_STAGE_APPROVAL } from "./factory";
import { resolveOriginsForOrg } from "./substrateBrowser";
import {
  assembleApprovalSummaryFromFacts,
  pickRunGatePredicate,
  OVERRIDE_VERIFICATION_PREDICATE,
  type ApprovalSummary,
  type ApprovalSummaryResult,
} from "./approvalSummary-pure";
// Spec 202 FR-004: approval-velocity (governance-drift) counter. Composes
// with the spec 201 ratification trail: it counts the `gate_approved` rows
// this module writes and surfaces / records anomalous velocity. Records,
// never blocks.
import {
  measureApprovalVelocity,
  detectApprovalVelocity,
} from "./approvalVelocity";
import type { ApprovalVelocity } from "./approvalVelocity-pure";

export {
  OVERRIDE_VERIFICATION_PREDICATE,
  computeApprovalSummaryHash,
  type ApprovalSummary,
  type ApprovalSummaryResult,
  type ApprovalProvenanceLink,
  type ApprovalConsumedOverride,
} from "./approvalSummary-pure";

// ---------------------------------------------------------------------------
// Per-artifact read endpoint — what the override-verify surface renders
// (spec 201 FR-002; phase 2). GET, read-only: satisfies FR-003 preview
// purity by construction.
// ---------------------------------------------------------------------------

/** Flat (Encore requires a named interface, not a union, at the wire
 * boundary): `applicable: false` → spec 111 user-authored trust class, no
 * envelope governs the row (FR-004 scoping amendment), other fields
 * absent. Otherwise exactly one of `summary` (ok) or `reason` (refused)
 * is present. */
export interface ArtifactApprovalSummaryResponse {
  applicable: boolean;
  ok?: boolean;
  reason?: string;
  summary?: ApprovalSummary;
}

export async function getArtifactApprovalSummaryCore(
  auth: { orgId: string; userID: string },
  req: { id: string },
): Promise<ArtifactApprovalSummaryResponse> {
  // Inline org-scoped lookup (importing artifacts.ts here would cycle —
  // verifyOverrideCore imports this module).
  const rows = await db
    .select({
      origin: factoryArtifactSubstrate.origin,
    })
    .from(factoryArtifactSubstrate)
    .where(
      and(
        eq(factoryArtifactSubstrate.orgId, auth.orgId),
        eq(factoryArtifactSubstrate.id, req.id),
      ),
    )
    .limit(1);
  if (!rows[0]) {
    throw APIError.notFound(`artifact ${req.id} not found`);
  }
  if (rows[0].origin === "user-authored") {
    return { applicable: false };
  }
  const result = await assembleApprovalSummary({
    orgId: auth.orgId,
    origin: rows[0].origin,
    gatePredicate: OVERRIDE_VERIFICATION_PREDICATE,
    actorId: auth.userID,
  });
  return result.ok
    ? { applicable: true, ok: true, summary: result.summary }
    : { applicable: true, ok: false, reason: result.reason };
}

export const getArtifactApprovalSummary = api(
  {
    expose: true,
    auth: true,
    method: "GET",
    path: "/api/factory/artifacts/:id/approval-summary",
  },
  async (req: { id: string }): Promise<ArtifactApprovalSummaryResponse> => {
    const auth = getAuthData()!;
    return getArtifactApprovalSummaryCore(
      { orgId: auth.orgId, userID: auth.userID },
      req,
    );
  },
);

export type AssembleApprovalSummaryInput = {
  orgId: string;
  /** Admitted-factory origin (the substrate `origin` discriminator). */
  origin: string;
  /** Envelope-declared gate predicate, or the reserved
   * `overrides.require_verified` for the override-verify surface. */
  gatePredicate: string;
  /** Rauthy subject who will perform the approval (TOCTOU-bound). */
  actorId: string;
};

export async function assembleApprovalSummary(
  input: AssembleApprovalSummaryInput,
): Promise<ApprovalSummaryResult> {
  const verdict = await isFactoryAdmitted(input.orgId, input.origin);
  const state = await loadLatestAdmission(input.orgId, input.origin);

  const provenanceRows = await db
    .select({
      id: factoryArtifactSubstrate.id,
      path: factoryArtifactSubstrate.path,
      kind: factoryArtifactSubstrate.kind,
      contentHash: factoryArtifactSubstrate.contentHash,
    })
    .from(factoryArtifactSubstrate)
    .where(
      and(
        eq(factoryArtifactSubstrate.orgId, input.orgId),
        eq(factoryArtifactSubstrate.origin, input.origin),
        eq(factoryArtifactSubstrate.status, "active"),
        inArray(factoryArtifactSubstrate.kind, [
          "governance-envelope",
          "adapter-manifest",
        ]),
      ),
    )
    .orderBy(factoryArtifactSubstrate.path);

  // FR-001 rule 2 — spec 198 FR-013 c parity (`collectConsumedOverrides`):
  // org + origin, active, non-null user_body, path-ordered.
  const overrideRows = await db
    .select({
      id: factoryArtifactSubstrate.id,
      path: factoryArtifactSubstrate.path,
      contentHash: factoryArtifactSubstrate.contentHash,
      userBodyVerified: factoryArtifactSubstrate.userBodyVerified,
      verifiedBy: factoryArtifactSubstrate.verifiedBy,
      verifiedAt: factoryArtifactSubstrate.verifiedAt,
    })
    .from(factoryArtifactSubstrate)
    .where(
      and(
        eq(factoryArtifactSubstrate.orgId, input.orgId),
        eq(factoryArtifactSubstrate.origin, input.origin),
        eq(factoryArtifactSubstrate.status, "active"),
        isNotNull(factoryArtifactSubstrate.userBody),
      ),
    )
    .orderBy(factoryArtifactSubstrate.path);

  // Spec 200 FR-003(a) parity — this inline query replicates
  // `collectConsumedOverrides` (cycle-avoidance keeps it from importing
  // it), so the content-hash revocation sweep that refuses the serve MUST
  // refuse the summary too: no approval basis exists while a consumed
  // override is quarantined, exactly as the serve would refuse.
  const quarantine = await sweepContentHashRevocations(
    input.orgId,
    overrideRows.map((r) => r.contentHash),
  );
  if (quarantine) {
    const hitRow = overrideRows.find((r) => r.contentHash === quarantine.key);
    return {
      ok: false,
      reason:
        `artifact '${hitRow?.path ?? "(unknown)"}' carries an override whose ` +
        `content hash is ${quarantine.mode} (revocation ` +
        `${quarantine.revocationId}) — lift the quarantine or revise the ` +
        `override (spec 198 FR-010 / spec 200 FR-003)`,
    };
  }

  return assembleApprovalSummaryFromFacts({
    gatePredicate: input.gatePredicate,
    actorId: input.actorId,
    assembledAt: new Date().toISOString(),
    admission: {
      admitted: verdict.admitted,
      reason: verdict.reason,
      envelopeHash: state.envelopeHash,
      composed: state.composed,
    },
    provenanceRows,
    overrideRows,
  });
}

// ---------------------------------------------------------------------------
// Run-level HITL gate (spec 201 phase 3 — FR-002/FR-003/FR-004 run path).
// Approval state is the audit trail itself: a `factory.run.gate_approved`
// audit_log row per (runId, stageId). No second state store.
// ---------------------------------------------------------------------------

export interface RunGateApproval {
  stageId: string;
  gatePredicate: string;
  summaryHash: string;
  approvedBy: string;
  approvedAt: string;
}

/** Flat wire shape (named interface; Encore rejects unions). When `ok` is
 * false the approve control must not render — `reason` is the attributable
 * error (FR-002). `blockingOverridePaths` carries the FR-002 withhold list:
 * unverified overrides under a require_verified envelope block APPROVE
 * (unlike the verify surface, where verify is the resolution path). */
export interface RunApprovalContextResponse {
  /** Stage ids requiring human sign-off (factory.ts policy, `sN` form). */
  requiredStageIds: string[];
  approvals: RunGateApproval[];
  ok: boolean;
  reason?: string;
  gatePredicate?: string;
  summary?: ApprovalSummary;
  blockingOverridePaths?: string[];
  /** Spec 202 FR-004: the approving actor's recent gate-approval velocity in
   * this org. Read-only diagnostic (outside the `summary` hash by design so
   * the FR-003(b) replay guard is unaffected); absent only when the
   * measurement query failed. Records, never blocks the approve control. */
  approvalVelocity?: ApprovalVelocity;
}

const REQUIRED_STAGE_IDS = DEFAULT_REQUIRE_STAGE_APPROVAL.map((n) => `s${n}`);

async function loadRunOrThrow(orgId: string, runId: string) {
  const [run] = await db
    .select({ id: factoryRuns.id })
    .from(factoryRuns)
    .where(and(eq(factoryRuns.id, runId), eq(factoryRuns.orgId, orgId)))
    .limit(1);
  // Same 404 for "absent" and "foreign org" — no cross-org existence leak
  // (mirrors runs.ts::getRunCore).
  if (!run) throw APIError.notFound("run not found");
  return run;
}

async function listRunGateApprovals(runId: string): Promise<RunGateApproval[]> {
  const rows = await db
    .select({
      metadata: auditLog.metadata,
      actorUserId: auditLog.actorUserId,
      createdAt: auditLog.createdAt,
    })
    .from(auditLog)
    .where(
      and(
        eq(auditLog.action, FACTORY_RUN_GATE_APPROVED),
        eq(auditLog.targetType, "factory_runs"),
        eq(auditLog.targetId, runId),
      ),
    )
    .orderBy(desc(auditLog.createdAt));
  return rows.map((r) => {
    const m = (r.metadata ?? {}) as Record<string, unknown>;
    return {
      stageId: String(m.stageId ?? ""),
      gatePredicate: String(m.gatePredicate ?? ""),
      summaryHash: String(m.summaryHash ?? ""),
      approvedBy: r.actorUserId ?? "",
      approvedAt: r.createdAt.toISOString(),
    };
  });
}

/** Assemble the run-gate approval basis for the org's admitted factory
 * origin, with the deterministically-selected declared predicate. */
async function assembleRunGateSummary(
  orgId: string,
  actorId: string,
): Promise<
  | { ok: true; gatePredicate: string; summary: ApprovalSummary }
  | { ok: false; reason: string }
> {
  const { factoryOriginId } = await resolveOriginsForOrg(orgId);
  if (!factoryOriginId) {
    return {
      ok: false,
      reason:
        "no factory upstream configured for this org — no approval basis " +
        "exists (spec 201 FR-001)",
    };
  }
  const state = await loadLatestAdmission(orgId, factoryOriginId);
  const declared = (state.composed?.process?.gates ?? []).map(
    (g) => g.predicate,
  );
  const gatePredicate = pickRunGatePredicate(declared);
  if (!gatePredicate) {
    return {
      ok: false,
      reason:
        "the admitted envelope declares no gate predicates — nothing to " +
        "ratify (spec 201 FR-001 fail-closed)",
    };
  }
  const result = await assembleApprovalSummary({
    orgId,
    origin: factoryOriginId,
    gatePredicate,
    actorId,
  });
  if (!result.ok) return result;
  return { ok: true, gatePredicate, summary: result.summary };
}

export async function getRunApprovalContextCore(
  auth: { orgId: string; userID: string },
  req: { id: string },
): Promise<RunApprovalContextResponse> {
  await loadRunOrThrow(auth.orgId, req.id);
  const approvals = await listRunGateApprovals(req.id);
  // FR-004 read-only measurement (never writes on this GET path, preserving
  // FR-003 preview purity); null (measurement error) collapses to absent.
  const approvalVelocity =
    (await measureApprovalVelocity({
      orgId: auth.orgId,
      actorId: auth.userID,
      runId: req.id,
    })) ?? undefined;
  const assembled = await assembleRunGateSummary(auth.orgId, auth.userID);
  if (!assembled.ok) {
    return {
      requiredStageIds: REQUIRED_STAGE_IDS,
      approvals,
      ok: false,
      reason: assembled.reason,
      approvalVelocity,
    };
  }
  return {
    requiredStageIds: REQUIRED_STAGE_IDS,
    approvals,
    ok: true,
    gatePredicate: assembled.gatePredicate,
    summary: assembled.summary,
    blockingOverridePaths: assembled.summary.consumedOverrides
      .filter((o) => !o.requireVerifiedSatisfied)
      .map((o) => o.path),
    approvalVelocity,
  };
}

export const getRunApprovalContext = api(
  {
    expose: true,
    auth: true,
    method: "GET",
    path: "/api/factory/runs/:id/approval-context",
  },
  async (req: { id: string }): Promise<RunApprovalContextResponse> => {
    const auth = getAuthData()!;
    return getRunApprovalContextCore(
      { orgId: auth.orgId, userID: auth.userID },
      req,
    );
  },
);

export interface ApproveRunGateRequest {
  id: string;
  stageId: string;
  /** The summaryHash the client rendered. Re-assembly must produce the
   * same hash or the approve is refused (FR-003 b replay guard). Because
   * `actorId` is inside the hashed field set, a hash assembled for a
   * different session user can never match — FR-003 (c) is subsumed. */
  summaryHash: string;
}

export interface ApproveRunGateResponse {
  approval: RunGateApproval;
  /** False when the (runId, stageId) pair was already approved — the
   * recorded approval is returned unchanged (idempotent; no new audit). */
  created: boolean;
}

export async function approveRunGateCore(
  auth: { orgId: string; userID: string },
  req: ApproveRunGateRequest,
): Promise<ApproveRunGateResponse> {
  await loadRunOrThrow(auth.orgId, req.id);
  if (!REQUIRED_STAGE_IDS.includes(req.stageId)) {
    throw APIError.invalidArgument(
      `stage '${req.stageId}' is not a gated stage ` +
        `(gated: ${REQUIRED_STAGE_IDS.join(", ")})`,
    );
  }

  // Idempotency — an approval is a recorded fact; re-approving returns it.
  const existing = (await listRunGateApprovals(req.id)).find(
    (a) => a.stageId === req.stageId,
  );
  if (existing) {
    return { approval: existing, created: false };
  }

  const assembled = await assembleRunGateSummary(auth.orgId, auth.userID);
  if (!assembled.ok) {
    throw APIError.failedPrecondition(
      `approval basis unavailable: ${assembled.reason} (spec 201 FR-002)`,
    );
  }

  // FR-002 withhold — the approve surface blocks on envelope-unsatisfied
  // overrides (server-side enforcement matching the UI's withhold).
  const blocking = assembled.summary.consumedOverrides.filter(
    (o) => !o.requireVerifiedSatisfied,
  );
  if (blocking.length > 0) {
    throw APIError.failedPrecondition(
      `approval withheld: ${blocking.length} override(s) are unverified ` +
        `under the envelope's require_verified policy — ` +
        `${blocking.map((o) => o.path).join(", ")} (spec 201 FR-002)`,
    );
  }

  // FR-003 (b) replay guard — a stale summary from a previous page load
  // (or another actor's summary, since actorId is hashed) is refused.
  if (req.summaryHash !== assembled.summary.summaryHash) {
    throw APIError.failedPrecondition(
      "stale approval summary: the recorded facts changed since this " +
        "summary was rendered — reload and re-review (spec 201 FR-003 b)",
    );
  }

  const [row] = await db
    .insert(auditLog)
    .values({
      actorUserId: auth.userID,
      action: FACTORY_RUN_GATE_APPROVED,
      targetType: "factory_runs",
      targetId: req.id,
      metadata: {
        stageId: req.stageId,
        gatePredicate: assembled.gatePredicate,
        summaryHash: assembled.summary.summaryHash,
        provenanceLinks: assembled.summary.provenanceLinks.map(
          (l) => l.contentHash,
        ),
        consumedOverrideCount: assembled.summary.consumedOverrides.length,
      },
    })
    .returning({ createdAt: auditLog.createdAt });

  // FR-004: with the approval now recorded, count this actor's recent gate
  // approvals and record an anomaly audit row if the rate crossed the
  // threshold. Fail-open by construction (never throws, never blocks) so a
  // detection hiccup cannot undo the approval just committed above.
  await detectApprovalVelocity({
    orgId: auth.orgId,
    actorId: auth.userID,
    runId: req.id,
  });

  return {
    approval: {
      stageId: req.stageId,
      gatePredicate: assembled.gatePredicate,
      summaryHash: assembled.summary.summaryHash,
      approvedBy: auth.userID,
      approvedAt: row.createdAt.toISOString(),
    },
    created: true,
  };
}

export const approveRunGate = api(
  {
    expose: true,
    auth: true,
    method: "POST",
    path: "/api/factory/runs/:id/gates/:stageId/approve",
  },
  async (req: ApproveRunGateRequest): Promise<ApproveRunGateResponse> => {
    const auth = getAuthData()!;
    return approveRunGateCore(
      { orgId: auth.orgId, userID: auth.userID },
      req,
    );
  },
);
