import { api, APIError, Header } from "encore.dev/api";
import { getAuthData } from "~encore/auth";
import { and, desc, eq, or, sql } from "drizzle-orm";
import { db } from "../db/drizzle";
import { auditLog, projects, users } from "../db/schema";
import { validateM2mRequest } from "../auth/m2mAuth.js";

const SYSTEM_USER_ID = "00000000-0000-0000-0000-000000000000";

// Format guards on the caller-controlled fields of an ingested audit record.
// None of these can fully "bind" the record to the calling M2M client (the
// M2M credential behind this seam carries no per-client identity beyond a
// scope claim, see m2mAuth.ts), but they close off the cheapest forgery
// paths: free-form injection strings, unbounded payloads, and onBehalfOf
// values that do not name a real platform user.
const ACTION_PATTERN = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/;
const TARGET_TYPE_PATTERN = /^[a-z][a-z0-9_]*$/;
const NHI_SUB_PATTERN = /^[A-Za-z0-9_.:$-]{1,128}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_TARGET_ID_LEN = 256;
const MAX_METADATA_BYTES = 32 * 1024;

type IngestAuditRequest = {
  authorization: Header<"Authorization">;
  action: string;
  targetType: string;
  targetId: string;
  metadata?: Record<string, unknown>;
  // Spec 205 FR-005: when an agent NHI generates the record (via OPC
  // axiomregent), it passes both principals: the NHI subject and the
  // human it acts for. Populated onto the row when present, NULL otherwise.
  nhiSub?: string;
  onBehalfOf?: string;
};

type IngestAuditResponse = { ok: true };

/**
 * Seam B: Ingest audit records from OPC axiomregent.
 * POST /api/audit-records: M2M bearer token auth (OIDC JWT or static fallback).
 */
export const ingestAuditRecord = api(
  { expose: true, method: "POST", path: "/api/audit-records" },
  async (req: IngestAuditRequest): Promise<IngestAuditResponse> => {
    await validateM2mRequest(req.authorization, "platform:audit:write");

    if (!ACTION_PATTERN.test(req.action)) {
      throw APIError.invalidArgument(
        "action must be lowercase, dot-namespaced (e.g. 'agent.session_started')"
      );
    }
    if (!TARGET_TYPE_PATTERN.test(req.targetType)) {
      throw APIError.invalidArgument("targetType must be lowercase snake_case");
    }
    if (!req.targetId || req.targetId.length > MAX_TARGET_ID_LEN) {
      throw APIError.invalidArgument(
        `targetId is required and must be at most ${MAX_TARGET_ID_LEN} characters`
      );
    }
    if (req.nhiSub !== undefined && !NHI_SUB_PATTERN.test(req.nhiSub)) {
      throw APIError.invalidArgument("nhiSub has an invalid format");
    }

    // Spec 205 FR-005: onBehalfOf names the human principal an agent acted
    // for. Bind it to a real platform identity instead of trusting an
    // arbitrary caller-supplied value verbatim, closing the audit-forgery
    // path where any M2M-scoped caller could attribute a record to a
    // fabricated or unrelated human.
    let onBehalfOf: string | null = null;
    if (req.onBehalfOf !== undefined) {
      if (!UUID_PATTERN.test(req.onBehalfOf)) {
        throw APIError.invalidArgument("onBehalfOf must be a user UUID");
      }
      const [human] = await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.id, req.onBehalfOf))
        .limit(1);
      if (!human) {
        throw APIError.invalidArgument("onBehalfOf does not reference a known user");
      }
      onBehalfOf = human.id;
    }

    const metadata = req.metadata ?? {};
    if (Buffer.byteLength(JSON.stringify(metadata)) > MAX_METADATA_BYTES) {
      throw APIError.invalidArgument("metadata payload is too large");
    }

    await db.insert(auditLog).values({
      actorUserId: SYSTEM_USER_ID,
      nhiSub: req.nhiSub ?? null,
      onBehalfOf,
      action: req.action,
      targetType: req.targetType,
      targetId: req.targetId,
      metadata,
    });

    return { ok: true };
  }
);

// ---------------------------------------------------------------------------
// Spec 175 — project-scoped audit summary read.
//
// The dashboard endpoint composes this read into the audit summary panel.
// Filter shape mirrors the existing `metadata->>'projectId'` query used by
// `factory/runDuplexHandlers.test.ts` and `knowledge/orphanSweeper`: a
// row matches the project when either `target_type='project' AND
// target_id=:projectId` or the metadata jsonb carries the project id
// under the `projectId` key.
// ---------------------------------------------------------------------------

export type ProjectAuditRow = {
  id: string;
  actorUserId: string;
  action: string;
  targetType: string;
  targetId: string;
  createdAt: string;
  metadata: Record<string, unknown>;
};

export type ListProjectAuditRecordsResponse = {
  rows: ProjectAuditRow[];
};

async function assertProjectInOrg(projectId: string): Promise<void> {
  const auth = getAuthData();
  if (!auth) {
    throw APIError.unauthenticated("authentication required");
  }
  const rows = await db
    .select({ id: projects.id })
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.orgId, auth.orgId)))
    .limit(1);
  if (rows.length === 0) {
    throw APIError.notFound("project not found");
  }
}

/**
 * Spec 175 FR-007 — list recent audit_log rows scoped to a project.
 *
 * The default `limit` is 5 to match the dashboard panel; callers asking
 * for more raise to a hard cap of 50.
 */
export const listProjectAuditRecords = api(
  {
    expose: true,
    auth: true,
    method: "GET",
    path: "/api/projects/:projectId/audit",
  },
  async (req: {
    projectId: string;
    limit?: number;
  }): Promise<ListProjectAuditRecordsResponse> => {
    await assertProjectInOrg(req.projectId);
    const limit = Math.min(Math.max(req.limit ?? 5, 1), 50);

    const rows = await db
      .select({
        id: auditLog.id,
        actorUserId: auditLog.actorUserId,
        action: auditLog.action,
        targetType: auditLog.targetType,
        targetId: auditLog.targetId,
        metadata: auditLog.metadata,
        createdAt: auditLog.createdAt,
      })
      .from(auditLog)
      .where(
        or(
          and(
            eq(auditLog.targetType, "project"),
            eq(auditLog.targetId, req.projectId)
          ),
          sql`${auditLog.metadata}->>'projectId' = ${req.projectId}`
        )
      )
      .orderBy(desc(auditLog.createdAt))
      .limit(limit);

    return {
      rows: rows.map((r) => ({
        id: r.id,
        actorUserId: r.actorUserId,
        action: r.action,
        targetType: r.targetType,
        targetId: r.targetId,
        metadata: (r.metadata ?? {}) as Record<string, unknown>,
        createdAt: r.createdAt.toISOString(),
      })),
    };
  }
);
