/**
 * Knowledge intake service (spec 087 Phase 2, amended by spec 119).
 *
 * Manages knowledge objects and source connectors. Both are project-
 * scoped after the workspace collapse (spec 119 §4.3). The
 * document_bindings table is dropped — a knowledge object lives in
 * exactly one project, and clone duplicates the row into the
 * destination project (spec 113/114).
 *
 * Upload flow: request presigned URL → client uploads to S3 → confirm upload.
 */

import { api, APIError } from "encore.dev/api";
import { getAuthData } from "~encore/auth";
import log from "encore.dev/log";
import { db } from "../db/drizzle";
import {
  knowledgeObjects,
  sourceConnectors,
  projects,
  auditLog,
  syncRuns,
  knowledgeExtractionRuns,
} from "../db/schema";
import { and, eq, desc, inArray, sql } from "drizzle-orm";
import {
  getPresignedUploadUrl,
  getPresignedDownloadUrl,
  headObject,
  deleteObject,
} from "./storage";
import { randomUUID } from "crypto";
import { getConnectorImpl } from "./connectors";
import type { SyncContext } from "./connectors";
import { broadcastToOrg } from "../sync/sync";
import { enqueueExtraction } from "./extractionCore";
import {
  KNOWLEDGE_EXTRACTION_RETRY_REQUESTED,
  KNOWLEDGE_EXTRACTION_RESOLVED,
} from "./auditActions";
import {
  KNOWLEDGE_UPLOAD_MAX_BYTES,
  KNOWLEDGE_UPLOAD_MAX_HUMAN,
} from "./uploadLimits";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type KnowledgeObjectRow = {
  id: string;
  projectId: string;
  connectorId: string | null;
  storageKey: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  contentHash: string;
  state: string;
  extractionOutput: unknown;
  classification: unknown;
  provenance: unknown;
  /** Spec 115 FR-025 — populated when the most recent extraction failed. */
  lastExtractionError: unknown;
  createdAt: Date;
  updatedAt: Date;
};

/**
 * Spec 115 FR-030 — denormalised "latest run" surface so the dashboard
 * does not need a second round-trip to render the status badge / extractor
 * footer / Retry banner.
 */
type LatestExtractionRun = {
  status: string;
  extractorKind: string | null;
  completedAt: string | null;
  durationMs: number | null;
};

type KnowledgeObjectListRow = KnowledgeObjectRow & {
  latestRun: LatestExtractionRun | null;
};

type SourceConnectorRow = {
  id: string;
  projectId: string;
  type: string;
  name: string;
  syncSchedule: string | null;
  status: string;
  lastSyncedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

type SyncRunRow = {
  id: string;
  connectorId: string;
  projectId: string;
  status: string;
  objectsCreated: number;
  objectsUpdated: number;
  objectsSkipped: number;
  error: string | null;
  deltaToken: string | null;
  startedAt: Date;
  completedAt: Date | null;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface ProjectScope {
  projectId: string;
  orgId: string;
  bucket: string;
}

async function loadProjectScope(
  projectId: string,
  callerOrgId: string,
): Promise<ProjectScope> {
  const [p] = await db
    .select({
      id: projects.id,
      orgId: projects.orgId,
      bucket: projects.objectStoreBucket,
    })
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.orgId, callerOrgId)))
    .limit(1);

  if (!p) {
    throw APIError.notFound("project not found");
  }
  return { projectId: p.id, orgId: p.orgId, bucket: p.bucket };
}

// =========================================================================
// KNOWLEDGE OBJECTS
// =========================================================================

// ---------------------------------------------------------------------------
// List knowledge objects in a project
// ---------------------------------------------------------------------------

/**
 * Core implementation of `listKnowledgeObjects` — exported for direct
 * integration testing under `encore test` without going through the
 * Encore auth/api surface. The api wrapper below pulls orgId from
 * `getAuthData()` and delegates here.
 */
export async function listKnowledgeObjectsCore(args: {
  projectId: string;
  orgId: string;
  state?: string;
}): Promise<{ objects: KnowledgeObjectListRow[] }> {
  const scope = await loadProjectScope(args.projectId, args.orgId);

  const conditions = [eq(knowledgeObjects.projectId, scope.projectId)];
  if (args.state) {
    conditions.push(eq(knowledgeObjects.state, args.state as any));
  }

  const rows = await db
    .select()
    .from(knowledgeObjects)
    .where(and(...conditions))
    .orderBy(desc(knowledgeObjects.createdAt));

  if (rows.length === 0) {
    return { objects: [] };
  }

  // Spec 115 FR-030 — fetch the most-recent extraction run per object in
  // one query. DISTINCT ON keeps it indexed against the
  // (knowledgeObjectId, queuedAt DESC) covering index from migration 25.
  //
  // `IN (sql.join(...))` rather than `= ANY(${array})`: Drizzle's `sql`
  // tag spreads JS arrays into individual placeholders, so the latter
  // emits `ANY(($1, $2, ...))` — a row constructor, not an array — and
  // Postgres rejects it with "op ANY/ALL (array) requires array on right
  // side". Regression covered by `listKnowledgeObjects.integration.test.ts`.
  const objectIds = rows.map((r) => r.id);
  const idList = sql.join(
    objectIds.map((id) => sql`${id}`),
    sql`, `
  );
  // db.execute<>() returns timestamptz columns as string at runtime — the TS
  // generic is compile-time-only and does not invoke Drizzle's Date mapping.
  // The list path uses raw SQL via db.execute() (deliberate workaround for
  // Drizzle's ANY-array-binding bug, per the comment at lines 181-185); the
  // single-row typed-select path at line 282 uses db.select() and gets Date
  // back automatically. The generic here therefore declares completed_at as
  // string | null to match runtime, and the consumer wraps it in new Date(...)
  // before calling .toISOString() — the explicit conversion the typed-select
  // path gets for free. (Spec 143 FU-014.)
  const latestRuns = await db.execute<{
    knowledge_object_id: string;
    status: string;
    extractor_kind: string | null;
    completed_at: string | null;
    duration_ms: number | null;
  }>(sql`
    SELECT DISTINCT ON (knowledge_object_id)
      knowledge_object_id,
      status,
      extractor_kind,
      completed_at,
      duration_ms
    FROM knowledge_extraction_runs
    WHERE knowledge_object_id IN (${idList})
    ORDER BY knowledge_object_id, queued_at DESC
  `);

  const runsByObjectId = new Map<string, LatestExtractionRun>();
  for (const r of latestRuns.rows) {
    runsByObjectId.set(r.knowledge_object_id, {
      status: r.status,
      extractorKind: r.extractor_kind,
      completedAt: r.completed_at ? new Date(r.completed_at).toISOString() : null,
      durationMs: r.duration_ms,
    });
  }

  const objects: KnowledgeObjectListRow[] = rows.map((row) => ({
    ...row,
    latestRun: runsByObjectId.get(row.id) ?? null,
  }));

  return { objects };
}

export const listKnowledgeObjects = api(
  {
    expose: true,
    auth: true,
    method: "GET",
    path: "/api/projects/:projectId/knowledge/objects",
  },
  async (req: {
    projectId: string;
    state?: string;
  }): Promise<{ objects: KnowledgeObjectListRow[] }> => {
    const auth = getAuthData()!;
    return listKnowledgeObjectsCore({
      projectId: req.projectId,
      orgId: auth.orgId,
      state: req.state,
    });
  }
);

// ---------------------------------------------------------------------------
// Get a single knowledge object
// ---------------------------------------------------------------------------

export const getKnowledgeObject = api(
  {
    expose: true,
    auth: true,
    method: "GET",
    path: "/api/projects/:projectId/knowledge/objects/:id",
  },
  async (
    req: { projectId: string; id: string }
  ): Promise<{
    object: KnowledgeObjectListRow;
  }> => {
    const auth = getAuthData()!;
    const scope = await loadProjectScope(req.projectId, auth.orgId);

    const [row] = await db
      .select()
      .from(knowledgeObjects)
      .where(
        and(
          eq(knowledgeObjects.id, req.id),
          eq(knowledgeObjects.projectId, scope.projectId)
        )
      )
      .limit(1);

    if (!row) {
      throw APIError.notFound("knowledge object not found");
    }

    // Spec 115 FR-030 — denormalise the most recent extraction run.
    const [latest] = await db
      .select({
        status: knowledgeExtractionRuns.status,
        extractorKind: knowledgeExtractionRuns.extractorKind,
        completedAt: knowledgeExtractionRuns.completedAt,
        durationMs: knowledgeExtractionRuns.durationMs,
      })
      .from(knowledgeExtractionRuns)
      .where(eq(knowledgeExtractionRuns.knowledgeObjectId, req.id))
      .orderBy(desc(knowledgeExtractionRuns.queuedAt))
      .limit(1);

    const latestRun: LatestExtractionRun | null = latest
      ? {
          status: latest.status,
          extractorKind: latest.extractorKind,
          completedAt: latest.completedAt
            ? latest.completedAt.toISOString()
            : null,
          durationMs: latest.durationMs,
        }
      : null;

    return {
      object: { ...row, latestRun },
    };
  }
);

// ---------------------------------------------------------------------------
// Request presigned upload URL
// ---------------------------------------------------------------------------

type RequestUploadRequest = {
  projectId: string;
  filename: string;
  mimeType: string;
  contentHash: string; // client-provided SHA-256 for dedup
  sizeBytes: number; // client-known file size; verified against S3 HEAD on confirm
  /**
   * Optional folder-relative path for batch/folder uploads. Stored in
   * provenance.sourceUri as `upload://<sourcePath>`; falls back to filename.
   */
  sourcePath?: string;
};

type RequestUploadResponse = {
  objectId: string;
  uploadUrl: string;
  storageKey: string;
};

export const requestUpload = api(
  {
    expose: true,
    auth: true,
    method: "POST",
    path: "/api/projects/:projectId/knowledge/upload",
  },
  async (req: RequestUploadRequest): Promise<RequestUploadResponse> => {
    const auth = getAuthData()!;
    const scope = await loadProjectScope(req.projectId, auth.orgId);

    if (!req.filename || !req.mimeType || !req.contentHash) {
      throw APIError.invalidArgument(
        "filename, mimeType, and contentHash are required"
      );
    }
    if (typeof req.sizeBytes !== "number" || req.sizeBytes < 0) {
      throw APIError.invalidArgument("sizeBytes must be a non-negative number");
    }
    // Spec 143 FR-011 — server-side size cap. Defence in depth: the
    // browser pre-checks before fetching the presigned URL, and the
    // ingress caps the body size at the same value (FR-005). If this
    // check rejects, the browser pre-check has been bypassed (e.g.
    // direct-API caller skipping the UI) — surface the cap explicitly
    // rather than letting the request consume an objectId + storageKey
    // that nothing will ever PUT to.
    if (req.sizeBytes > KNOWLEDGE_UPLOAD_MAX_BYTES) {
      throw APIError.invalidArgument(
        `sizeBytes ${req.sizeBytes} exceeds the upload size cap of ${KNOWLEDGE_UPLOAD_MAX_HUMAN} (${KNOWLEDGE_UPLOAD_MAX_BYTES} bytes)`
      );
    }

    const objectId = randomUUID();
    const storageKey = `knowledge/${objectId}/${req.filename}`;

    // Create the knowledge object record in "imported" state (pending upload).
    // sizeBytes is trusted from the client at request time and verified
    // against S3 metadata on confirmUpload.
    await db.insert(knowledgeObjects).values({
      id: objectId,
      projectId: scope.projectId,
      connectorId: null, // direct upload — no connector
      storageKey,
      filename: req.filename,
      mimeType: req.mimeType,
      sizeBytes: req.sizeBytes,
      contentHash: req.contentHash,
      state: "imported",
      provenance: {
        sourceType: "upload",
        sourceUri: `upload://${req.sourcePath ?? req.filename}`,
        importedAt: new Date().toISOString(),
      },
    });

    const uploadUrl = await getPresignedUploadUrl(
      scope.bucket,
      storageKey,
      req.mimeType
    );

    await db.insert(auditLog).values({
      actorUserId: auth.userID,
      action: "knowledge.upload_requested",
      targetType: "knowledge_object",
      targetId: objectId,
      metadata: {
        filename: req.filename,
        mimeType: req.mimeType,
        projectId: scope.projectId,
      },
    });

    log.info("upload requested", { objectId, filename: req.filename });

    return { objectId, uploadUrl, storageKey };
  }
);

// ---------------------------------------------------------------------------
// Confirm upload (verifies object landed in S3, updates size)
// ---------------------------------------------------------------------------

/**
 * Spec 143 FR-010 — `confirmUploadCore` is the extracted core of the
 * user-driven `confirmUpload` API handler. Same pattern as
 * `listKnowledgeObjectsCore` from `c1b5d51`: the API wrapper handles
 * auth + project-scope resolution; the core does the actual work and
 * is callable from non-API contexts (the spec-143 orphan-sweeper Class B
 * path; future tests).
 *
 * Audit-actor surface matches spec 143 FR-010: user-driven confirms
 * pass the requesting user's id and OMIT `source`; sweeper-driven
 * confirms pass `SYSTEM_USER_ID` and set `source = "orphan_sweep_class_b"`.
 * The action name (`knowledge.upload_confirmed`) is the same for both —
 * dashboards see all confirms uniformly; analytics distinguish via the
 * actor + metadata.source pair.
 */
export type ConfirmUploadActor = {
  userId: string;
  source?: string;
};

export async function confirmUploadCore(args: {
  knowledgeObjectId: string;
  projectId: string;
  bucket: string;
  actor: ConfirmUploadActor;
}): Promise<KnowledgeObjectRow> {
  const [obj] = await db
    .select()
    .from(knowledgeObjects)
    .where(
      and(
        eq(knowledgeObjects.id, args.knowledgeObjectId),
        eq(knowledgeObjects.projectId, args.projectId)
      )
    )
    .limit(1);

  if (!obj) {
    throw APIError.notFound("knowledge object not found");
  }

  if (obj.state !== "imported") {
    throw APIError.invalidArgument(
      `cannot confirm upload: object is in state "${obj.state}"`
    );
  }

  // Verify the object actually exists in S3
  const meta = await headObject(args.bucket, obj.storageKey);

  if (!meta) {
    throw APIError.invalidArgument(
      "upload not found in object store — upload the file before confirming"
    );
  }

  // Trust the client-reported sizeBytes from requestUpload, but overwrite
  // with the S3 HEAD value when it disagrees and is non-zero. Some
  // S3-compatible stores omit Content-Length on HEAD; in that case we keep
  // the request-time size rather than clobbering it with 0.
  const updateSet: Record<string, unknown> = { updatedAt: new Date() };
  if (meta.contentLength > 0 && meta.contentLength !== obj.sizeBytes) {
    updateSet.sizeBytes = meta.contentLength;
  }

  const [updated] = await db
    .update(knowledgeObjects)
    .set(updateSet)
    .where(eq(knowledgeObjects.id, args.knowledgeObjectId))
    .returning();

  const auditMetadata: Record<string, unknown> = {
    sizeBytes: updated.sizeBytes,
    contentType: meta.contentType,
    projectId: args.projectId,
  };
  if (args.actor.source !== undefined) {
    auditMetadata.source = args.actor.source;
  }

  await db.insert(auditLog).values({
    actorUserId: args.actor.userId,
    action: "knowledge.upload_confirmed",
    targetType: "knowledge_object",
    targetId: args.knowledgeObjectId,
    metadata: auditMetadata,
  });

  // Spec 115 FR-008 — automatic extraction. Enqueue happens after the
  // audit insert; failure to enqueue MUST NOT roll back the upload (the
  // bytes are already in S3). The Retry endpoint re-enqueues if needed.
  // FR-003 dedup makes concurrent enqueue safe — see spec 143 FR-010
  // concurrency model layer 2/3.
  try {
    await enqueueExtraction({
      knowledgeObjectId: args.knowledgeObjectId,
      projectId: args.projectId,
      reason: "upload_confirmed",
    });
  } catch (err) {
    log.error("confirmUploadCore: enqueueExtraction failed; upload kept", {
      objectId: args.knowledgeObjectId,
      err: err instanceof Error ? err.message : String(err),
    });
  }

  log.info("upload confirmed", {
    objectId: args.knowledgeObjectId,
    sizeBytes: updated.sizeBytes,
    source: args.actor.source ?? "user",
  });

  return updated;
}

export const confirmUpload = api(
  {
    expose: true,
    auth: true,
    method: "POST",
    path: "/api/projects/:projectId/knowledge/objects/:id/confirm",
  },
  async (req: {
    projectId: string;
    id: string;
  }): Promise<{ object: KnowledgeObjectRow }> => {
    const auth = getAuthData()!;
    const scope = await loadProjectScope(req.projectId, auth.orgId);

    const updated = await confirmUploadCore({
      knowledgeObjectId: req.id,
      projectId: scope.projectId,
      bucket: scope.bucket,
      actor: { userId: auth.userID },
    });

    return { object: updated };
  }
);

// ---------------------------------------------------------------------------
// Get presigned download URL for a knowledge object
// ---------------------------------------------------------------------------

export const getDownloadUrl = api(
  {
    expose: true,
    auth: true,
    method: "GET",
    path: "/api/projects/:projectId/knowledge/objects/:id/download",
  },
  async (req: {
    projectId: string;
    id: string;
  }): Promise<{ downloadUrl: string }> => {
    const auth = getAuthData()!;
    const scope = await loadProjectScope(req.projectId, auth.orgId);

    const [obj] = await db
      .select({
        storageKey: knowledgeObjects.storageKey,
      })
      .from(knowledgeObjects)
      .where(
        and(
          eq(knowledgeObjects.id, req.id),
          eq(knowledgeObjects.projectId, scope.projectId)
        )
      )
      .limit(1);

    if (!obj) {
      throw APIError.notFound("knowledge object not found");
    }

    try {
      const downloadUrl = await getPresignedDownloadUrl(
        scope.bucket,
        obj.storageKey,
      );
      return { downloadUrl };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.error("getDownloadUrl: failed to generate presigned url", {
        objectId: req.id,
        bucket: scope.bucket,
        storageKey: obj.storageKey,
        error: msg,
      });
      throw APIError.internal(`failed to generate download url: ${msg}`);
    }
  }
);

// ---------------------------------------------------------------------------
// Transition knowledge object state (legacy, gated off)
// ---------------------------------------------------------------------------

const VALID_TRANSITIONS: Record<string, string[]> = {
  imported: ["extracting"],
  extracting: ["extracted"],
  extracted: ["classified"],
  classified: ["available"],
};

type TransitionStateRequest = {
  projectId: string;
  id: string;
  targetState: string;
  extractionOutput?: Record<string, unknown>;
  classification?: string[];
};

export const transitionState = api(
  {
    expose: true,
    auth: true,
    method: "POST",
    path: "/api/projects/:projectId/knowledge/objects/:id/transition",
  },
  async (
    req: TransitionStateRequest
  ): Promise<{ object: KnowledgeObjectRow }> => {
    const auth = getAuthData()!;
    const scope = await loadProjectScope(req.projectId, auth.orgId);

    // Spec 115 FR-027 — the legacy click-walk endpoint is gated off in
    // default builds. Operators flip the env to "true" during incident
    // response only; every successful legacy call is tagged with
    // `legacy_path = true` in the audit row so usage shows up in reports.
    if (process.env.statecraft_EXTRACT_LEGACY_TRANSITION !== "true") {
      throw APIError.failedPrecondition(
        "legacy_transition_disabled: use POST /api/projects/:projectId/knowledge/objects/:id/retry-extraction or rely on the automatic pipeline",
      );
    }

    const [obj] = await db
      .select()
      .from(knowledgeObjects)
      .where(
        and(
          eq(knowledgeObjects.id, req.id),
          eq(knowledgeObjects.projectId, scope.projectId)
        )
      )
      .limit(1);

    if (!obj) {
      throw APIError.notFound("knowledge object not found");
    }

    const allowed = VALID_TRANSITIONS[obj.state];
    if (!allowed || !allowed.includes(req.targetState)) {
      throw APIError.invalidArgument(
        `invalid transition: ${obj.state} → ${req.targetState}`
      );
    }

    const updates: Record<string, unknown> = {
      state: req.targetState,
      updatedAt: new Date(),
    };

    if (req.extractionOutput !== undefined) {
      updates.extractionOutput = req.extractionOutput;
    }
    if (req.classification !== undefined) {
      updates.classification = req.classification;
    }

    const [updated] = await db
      .update(knowledgeObjects)
      .set(updates)
      .where(eq(knowledgeObjects.id, req.id))
      .returning();

    await db.insert(auditLog).values({
      actorUserId: auth.userID,
      action: "knowledge.state_transition",
      targetType: "knowledge_object",
      targetId: req.id,
      metadata: {
        from: obj.state,
        to: req.targetState,
        legacy_path: true,
        projectId: scope.projectId,
      },
    });

    return { object: updated };
  }
);

// ---------------------------------------------------------------------------
// Spec 115 FR-010 — Retry extraction
// ---------------------------------------------------------------------------
//
// Operator-initiated re-enqueue of the extraction pipeline for an object
// whose previous attempt failed. Refuses with `not_failed` when
// `lastExtractionError` is null. The dispatcher re-resolves at run time so
// a Retry against a deterministic failure routes to the agent path when
// policy allows — Retry never re-runs the failing extractor verbatim.

export const retryExtraction = api(
  {
    expose: true,
    auth: true,
    method: "POST",
    path: "/api/projects/:projectId/knowledge/objects/:id/retry-extraction",
  },
  async (
    req: { projectId: string; id: string },
  ): Promise<{ runId: string; outcome: "enqueued" | "deduped" }> => {
    const auth = getAuthData()!;
    const scope = await loadProjectScope(req.projectId, auth.orgId);

    const [obj] = await db
      .select({
        id: knowledgeObjects.id,
        projectId: knowledgeObjects.projectId,
        lastExtractionError: knowledgeObjects.lastExtractionError,
      })
      .from(knowledgeObjects)
      .where(
        and(
          eq(knowledgeObjects.id, req.id),
          eq(knowledgeObjects.projectId, scope.projectId),
        ),
      )
      .limit(1);
    if (!obj) {
      throw APIError.notFound("knowledge object not found");
    }
    if (obj.lastExtractionError == null) {
      throw APIError.failedPrecondition(
        "not_failed: object has no lastExtractionError; nothing to retry",
      );
    }

    const result = await enqueueExtraction({
      knowledgeObjectId: obj.id,
      projectId: obj.projectId,
      reason: "retry",
    });

    await db.insert(auditLog).values({
      actorUserId: auth.userID,
      action: KNOWLEDGE_EXTRACTION_RETRY_REQUESTED,
      targetType: "knowledge_object",
      targetId: req.id,
      metadata: {
        runId: result.runId,
        outcome: result.outcome,
        previousError: obj.lastExtractionError,
        projectId: scope.projectId,
      },
    });

    return result;
  },
);

// ---------------------------------------------------------------------------
// Delete knowledge object
// ---------------------------------------------------------------------------

export const deleteKnowledgeObject = api(
  {
    expose: true,
    auth: true,
    method: "DELETE",
    path: "/api/projects/:projectId/knowledge/objects/:id",
  },
  async (
    req: { projectId: string; id: string }
  ): Promise<{ deleted: boolean }> => {
    const auth = getAuthData()!;
    const scope = await loadProjectScope(req.projectId, auth.orgId);

    const [obj] = await db
      .select()
      .from(knowledgeObjects)
      .where(
        and(
          eq(knowledgeObjects.id, req.id),
          eq(knowledgeObjects.projectId, scope.projectId)
        )
      )
      .limit(1);

    if (!obj) {
      throw APIError.notFound("knowledge object not found");
    }

    // Delete from object store. Best-effort: if the blob is already missing
    // (e.g. a partially-uploaded object), continue with DB cleanup so the
    // user is not stuck with a ghost row they cannot remove.
    try {
      await deleteObject(scope.bucket, obj.storageKey);
    } catch (err) {
      log.warn("deleteKnowledgeObject: object store delete failed, continuing", {
        objectId: req.id,
        storageKey: obj.storageKey,
        error: err instanceof Error ? err.message : String(err),
      });
    }

    await db
      .delete(knowledgeObjects)
      .where(eq(knowledgeObjects.id, req.id));

    await db.insert(auditLog).values({
      actorUserId: auth.userID,
      action: "knowledge.object_deleted",
      targetType: "knowledge_object",
      targetId: req.id,
      metadata: {
        filename: obj.filename,
        state: obj.state,
        projectId: scope.projectId,
      },
    });

    return { deleted: true };
  }
);

// =========================================================================
// SOURCE CONNECTORS
// =========================================================================

// ---------------------------------------------------------------------------
// List connectors for a project
// ---------------------------------------------------------------------------

export const listConnectors = api(
  {
    expose: true,
    auth: true,
    method: "GET",
    path: "/api/projects/:projectId/knowledge/connectors",
  },
  async (req: {
    projectId: string;
  }): Promise<{ connectors: SourceConnectorRow[] }> => {
    const auth = getAuthData()!;
    const scope = await loadProjectScope(req.projectId, auth.orgId);

    const rows = await db
      .select({
        id: sourceConnectors.id,
        projectId: sourceConnectors.projectId,
        type: sourceConnectors.type,
        name: sourceConnectors.name,
        syncSchedule: sourceConnectors.syncSchedule,
        status: sourceConnectors.status,
        lastSyncedAt: sourceConnectors.lastSyncedAt,
        createdAt: sourceConnectors.createdAt,
        updatedAt: sourceConnectors.updatedAt,
      })
      .from(sourceConnectors)
      .where(eq(sourceConnectors.projectId, scope.projectId))
      .orderBy(desc(sourceConnectors.createdAt));

    return { connectors: rows };
  }
);

// ---------------------------------------------------------------------------
// Create connector
// ---------------------------------------------------------------------------

type CreateConnectorRequest = {
  projectId: string;
  type: string;
  name: string;
  config?: Record<string, unknown>;
  syncSchedule?: string;
};

export const createConnector = api(
  {
    expose: true,
    auth: true,
    method: "POST",
    path: "/api/projects/:projectId/knowledge/connectors",
  },
  async (
    req: CreateConnectorRequest
  ): Promise<{ connector: SourceConnectorRow }> => {
    const auth = getAuthData()!;
    const scope = await loadProjectScope(req.projectId, auth.orgId);

    if (!req.type || !req.name) {
      throw APIError.invalidArgument("type and name are required");
    }

    const validTypes = ["upload", "sharepoint", "s3", "azure-blob", "gcs"];
    if (!validTypes.includes(req.type)) {
      throw APIError.invalidArgument(`invalid connector type: ${req.type}`);
    }

    // Validate config via connector implementation
    if (req.config) {
      const impl = getConnectorImpl(req.type);
      if (impl) {
        const validation = impl.validateConfig(req.config);
        if (!validation.valid) {
          throw APIError.invalidArgument(
            `invalid config: ${validation.errors.join(", ")}`
          );
        }
      }
    }

    const [connector] = await db
      .insert(sourceConnectors)
      .values({
        projectId: scope.projectId,
        type: req.type as any,
        name: req.name,
        configEncrypted: req.config ?? null,
        syncSchedule: req.syncSchedule ?? null,
      })
      .returning();

    await db.insert(auditLog).values({
      actorUserId: auth.userID,
      action: "knowledge.connector_created",
      targetType: "source_connector",
      targetId: connector.id,
      metadata: {
        type: req.type,
        name: req.name,
        projectId: scope.projectId,
      },
    });

    return {
      connector: {
        id: connector.id,
        projectId: connector.projectId,
        type: connector.type,
        name: connector.name,
        syncSchedule: connector.syncSchedule,
        status: connector.status,
        lastSyncedAt: connector.lastSyncedAt,
        createdAt: connector.createdAt,
        updatedAt: connector.updatedAt,
      },
    };
  }
);

// ---------------------------------------------------------------------------
// Delete connector
// ---------------------------------------------------------------------------

export const deleteConnector = api(
  {
    expose: true,
    auth: true,
    method: "DELETE",
    path: "/api/projects/:projectId/knowledge/connectors/:id",
  },
  async (req: {
    projectId: string;
    id: string;
  }): Promise<{ deleted: boolean }> => {
    const auth = getAuthData()!;
    const scope = await loadProjectScope(req.projectId, auth.orgId);

    const [conn] = await db
      .select()
      .from(sourceConnectors)
      .where(
        and(
          eq(sourceConnectors.id, req.id),
          eq(sourceConnectors.projectId, scope.projectId)
        )
      )
      .limit(1);

    if (!conn) {
      throw APIError.notFound("connector not found");
    }

    // Check if any knowledge objects reference this connector
    const [ref] = await db
      .select({ id: knowledgeObjects.id })
      .from(knowledgeObjects)
      .where(eq(knowledgeObjects.connectorId, req.id))
      .limit(1);

    if (ref) {
      throw APIError.invalidArgument(
        "cannot delete connector: knowledge objects still reference it"
      );
    }

    await db
      .delete(sourceConnectors)
      .where(eq(sourceConnectors.id, req.id));

    await db.insert(auditLog).values({
      actorUserId: auth.userID,
      action: "knowledge.connector_deleted",
      targetType: "source_connector",
      targetId: req.id,
      metadata: { name: conn.name, projectId: scope.projectId },
    });

    return { deleted: true };
  }
);

// ---------------------------------------------------------------------------
// Get a single connector
// ---------------------------------------------------------------------------

export const getConnector = api(
  {
    expose: true,
    auth: true,
    method: "GET",
    path: "/api/projects/:projectId/knowledge/connectors/:id",
  },
  async (req: {
    projectId: string;
    id: string;
  }): Promise<{ connector: SourceConnectorRow }> => {
    const auth = getAuthData()!;
    const scope = await loadProjectScope(req.projectId, auth.orgId);

    const [row] = await db
      .select({
        id: sourceConnectors.id,
        projectId: sourceConnectors.projectId,
        type: sourceConnectors.type,
        name: sourceConnectors.name,
        syncSchedule: sourceConnectors.syncSchedule,
        status: sourceConnectors.status,
        lastSyncedAt: sourceConnectors.lastSyncedAt,
        createdAt: sourceConnectors.createdAt,
        updatedAt: sourceConnectors.updatedAt,
      })
      .from(sourceConnectors)
      .where(
        and(
          eq(sourceConnectors.id, req.id),
          eq(sourceConnectors.projectId, scope.projectId)
        )
      )
      .limit(1);

    if (!row) {
      throw APIError.notFound("connector not found");
    }

    return { connector: row };
  }
);

// ---------------------------------------------------------------------------
// Update connector
// ---------------------------------------------------------------------------

type UpdateConnectorRequest = {
  projectId: string;
  id: string;
  name?: string;
  config?: Record<string, unknown>;
  syncSchedule?: string | null;
  status?: string;
};

export const updateConnector = api(
  {
    expose: true,
    auth: true,
    method: "PATCH",
    path: "/api/projects/:projectId/knowledge/connectors/:id",
  },
  async (
    req: UpdateConnectorRequest
  ): Promise<{ connector: SourceConnectorRow }> => {
    const auth = getAuthData()!;
    const scope = await loadProjectScope(req.projectId, auth.orgId);

    const [existing] = await db
      .select()
      .from(sourceConnectors)
      .where(
        and(
          eq(sourceConnectors.id, req.id),
          eq(sourceConnectors.projectId, scope.projectId)
        )
      )
      .limit(1);

    if (!existing) {
      throw APIError.notFound("connector not found");
    }

    // Validate config if provided
    if (req.config) {
      const impl = getConnectorImpl(existing.type);
      if (impl) {
        const validation = impl.validateConfig(req.config);
        if (!validation.valid) {
          throw APIError.invalidArgument(
            `invalid config: ${validation.errors.join(", ")}`
          );
        }
      }
    }

    if (req.status) {
      const validStatuses = ["active", "paused", "error", "disabled"];
      if (!validStatuses.includes(req.status)) {
        throw APIError.invalidArgument(`invalid status: ${req.status}`);
      }
    }

    const updates: Record<string, unknown> = { updatedAt: new Date() };
    if (req.name !== undefined) updates.name = req.name;
    if (req.config !== undefined) updates.configEncrypted = req.config;
    if (req.syncSchedule !== undefined) updates.syncSchedule = req.syncSchedule;
    if (req.status !== undefined) updates.status = req.status;

    const [updated] = await db
      .update(sourceConnectors)
      .set(updates)
      .where(eq(sourceConnectors.id, req.id))
      .returning();

    await db.insert(auditLog).values({
      actorUserId: auth.userID,
      action: "knowledge.connector_updated",
      targetType: "source_connector",
      targetId: req.id,
      metadata: {
        fields: Object.keys(updates).filter((k) => k !== "updatedAt"),
        projectId: scope.projectId,
      },
    });

    return {
      connector: {
        id: updated.id,
        projectId: updated.projectId,
        type: updated.type,
        name: updated.name,
        syncSchedule: updated.syncSchedule,
        status: updated.status,
        lastSyncedAt: updated.lastSyncedAt,
        createdAt: updated.createdAt,
        updatedAt: updated.updatedAt,
      },
    };
  }
);

// ---------------------------------------------------------------------------
// Test connector connection
// ---------------------------------------------------------------------------

export const testConnectorConnection = api(
  {
    expose: true,
    auth: true,
    method: "POST",
    path: "/api/projects/:projectId/knowledge/connectors/:id/test",
  },
  async (req: {
    projectId: string;
    id: string;
  }): Promise<{ success: boolean; error?: string }> => {
    const auth = getAuthData()!;
    const scope = await loadProjectScope(req.projectId, auth.orgId);

    const [conn] = await db
      .select()
      .from(sourceConnectors)
      .where(
        and(
          eq(sourceConnectors.id, req.id),
          eq(sourceConnectors.projectId, scope.projectId)
        )
      )
      .limit(1);

    if (!conn) {
      throw APIError.notFound("connector not found");
    }

    const impl = getConnectorImpl(conn.type);
    if (!impl) {
      throw APIError.invalidArgument(`no implementation for connector type: ${conn.type}`);
    }

    try {
      await impl.testConnection(
        (conn.configEncrypted as Record<string, unknown>) ?? {}
      );
      return { success: true };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { success: false, error: message };
    }
  }
);

// ---------------------------------------------------------------------------
// Trigger sync for a connector
// ---------------------------------------------------------------------------

export const triggerSync = api(
  {
    expose: true,
    auth: true,
    method: "POST",
    path: "/api/projects/:projectId/knowledge/connectors/:id/sync",
  },
  async (req: {
    projectId: string;
    id: string;
  }): Promise<{ syncRunId: string }> => {
    const auth = getAuthData()!;
    const scope = await loadProjectScope(req.projectId, auth.orgId);

    const [conn] = await db
      .select()
      .from(sourceConnectors)
      .where(
        and(
          eq(sourceConnectors.id, req.id),
          eq(sourceConnectors.projectId, scope.projectId)
        )
      )
      .limit(1);

    if (!conn) {
      throw APIError.notFound("connector not found");
    }

    if (conn.status !== "active") {
      throw APIError.invalidArgument(
        `connector is ${conn.status} — only active connectors can be synced`
      );
    }

    if (conn.type === "upload") {
      throw APIError.invalidArgument(
        "upload connectors do not support sync — use the upload endpoint"
      );
    }

    // Get the last successful delta token
    const [lastRun] = await db
      .select({ deltaToken: syncRuns.deltaToken })
      .from(syncRuns)
      .where(
        and(
          eq(syncRuns.connectorId, conn.id),
          eq(syncRuns.status, "completed")
        )
      )
      .orderBy(desc(syncRuns.completedAt))
      .limit(1);

    const syncRunId = await executeSyncRun(
      conn.id,
      scope.projectId,
      scope.orgId,
      scope.bucket,
      conn.type,
      (conn.configEncrypted as Record<string, unknown>) ?? {},
      lastRun?.deltaToken ?? null,
      auth.userID
    );

    return { syncRunId };
  }
);

// ---------------------------------------------------------------------------
// List sync runs for a connector
// ---------------------------------------------------------------------------

export const listSyncRuns = api(
  {
    expose: true,
    auth: true,
    method: "GET",
    path: "/api/projects/:projectId/knowledge/connectors/:id/sync-runs",
  },
  async (req: {
    projectId: string;
    id: string;
  }): Promise<{ runs: SyncRunRow[] }> => {
    const auth = getAuthData()!;
    const scope = await loadProjectScope(req.projectId, auth.orgId);

    // Verify the connector belongs to this project
    const [conn] = await db
      .select({ id: sourceConnectors.id })
      .from(sourceConnectors)
      .where(
        and(
          eq(sourceConnectors.id, req.id),
          eq(sourceConnectors.projectId, scope.projectId)
        )
      )
      .limit(1);

    if (!conn) {
      throw APIError.notFound("connector not found");
    }

    const rows = await db
      .select()
      .from(syncRuns)
      .where(eq(syncRuns.connectorId, req.id))
      .orderBy(desc(syncRuns.startedAt))
      .limit(50);

    return { runs: rows };
  }
);

// ---------------------------------------------------------------------------
// Sync execution orchestrator (used by both on-demand and scheduled sync)
// ---------------------------------------------------------------------------

export async function executeSyncRun(
  connectorId: string,
  projectId: string,
  orgId: string,
  bucket: string,
  connectorType: string,
  config: Record<string, unknown>,
  previousDeltaToken: string | null,
  actorUserId: string
): Promise<string> {
  const impl = getConnectorImpl(connectorType);
  if (!impl) {
    throw new Error(`no implementation for connector type: ${connectorType}`);
  }

  // Create sync run record
  const [run] = await db
    .insert(syncRuns)
    .values({
      connectorId,
      projectId,
      status: "running",
    })
    .returning();

  const ctx: SyncContext = {
    connectorId,
    projectId,
    bucket,
    config,
    previousDeltaToken,
  };

  // Execute the sync asynchronously (don't block the request)
  setImmediate(async () => {
    try {
      const result = await impl.sync(ctx);

      let created = 0;
      let updated = 0;
      let skipped = 0;

      // Create/update knowledge objects for each synced file
      for (const obj of result.objects) {
        if (obj.action === "skipped") {
          skipped++;
          continue;
        }

        // Check if a knowledge object with this content hash already exists
        const [existing] = await db
          .select({ id: knowledgeObjects.id, contentHash: knowledgeObjects.contentHash })
          .from(knowledgeObjects)
          .where(
            and(
              eq(knowledgeObjects.projectId, projectId),
              eq(knowledgeObjects.connectorId, connectorId),
              eq(knowledgeObjects.storageKey, obj.storageKey)
            )
          )
          .limit(1);

        // Spec 115 FR-009 — track which rows are newly inserted or had a
        // content-hash change so we can enqueue extraction for them after
        // the sync transaction.
        let enqueueObjectId: string | null = null;

        if (existing) {
          if (existing.contentHash === obj.contentHash) {
            skipped++;
            continue;
          }
          // Update existing object (content changed)
          await db
            .update(knowledgeObjects)
            .set({
              contentHash: obj.contentHash,
              sizeBytes: obj.sizeBytes,
              mimeType: obj.mimeType,
              provenance: obj.provenance,
              state: "imported",
              extractionOutput: null,
              lastExtractionError: null,
              updatedAt: new Date(),
            })
            .where(eq(knowledgeObjects.id, existing.id));
          enqueueObjectId = existing.id;
          updated++;
        } else {
          const [created_] = await db
            .insert(knowledgeObjects)
            .values({
              projectId,
              connectorId,
              storageKey: obj.storageKey,
              filename: obj.filename,
              mimeType: obj.mimeType,
              sizeBytes: obj.sizeBytes,
              contentHash: obj.contentHash,
              state: "imported",
              provenance: obj.provenance,
            })
            .returning({ id: knowledgeObjects.id });
          enqueueObjectId = created_.id;
          created++;
        }

        if (enqueueObjectId) {
          try {
            await enqueueExtraction({
              knowledgeObjectId: enqueueObjectId,
              projectId,
              reason: "connector_sync",
            });
          } catch (err) {
            log.warn("connector sync: enqueueExtraction failed; row kept", {
              connectorId,
              objectId: enqueueObjectId,
              err: err instanceof Error ? err.message : String(err),
            });
          }
        }
      }

      // Mark sync run as completed
      await db
        .update(syncRuns)
        .set({
          status: "completed",
          objectsCreated: created,
          objectsUpdated: updated,
          objectsSkipped: skipped,
          deltaToken: result.deltaToken,
          completedAt: new Date(),
        })
        .where(eq(syncRuns.id, run.id));

      // Update connector's last_synced_at
      await db
        .update(sourceConnectors)
        .set({ lastSyncedAt: new Date(), updatedAt: new Date() })
        .where(eq(sourceConnectors.id, connectorId));

      // Audit
      await db.insert(auditLog).values({
        actorUserId,
        action: "knowledge.sync_completed",
        targetType: "source_connector",
        targetId: connectorId,
        metadata: { syncRunId: run.id, created, updated, skipped, projectId },
      });

      // Broadcast sync completion to connected clients in the org
      broadcastToOrg(orgId, {
        type: "connector_sync_complete",
        orgId,
        timestamp: new Date().toISOString(),
        payload: {
          connectorId,
          projectId,
          syncRunId: run.id,
          objectsCreated: created,
          objectsUpdated: updated,
          objectsSkipped: skipped,
        },
      });

      log.info("sync run completed", {
        syncRunId: run.id,
        connectorId,
        created,
        updated,
        skipped,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);

      await db
        .update(syncRuns)
        .set({
          status: "failed",
          error: message,
          completedAt: new Date(),
        })
        .where(eq(syncRuns.id, run.id));

      // Set connector to error status
      await db
        .update(sourceConnectors)
        .set({ status: "error" as any, updatedAt: new Date() })
        .where(eq(sourceConnectors.id, connectorId));

      log.error("sync run failed", {
        syncRunId: run.id,
        connectorId,
        error: message,
      });
    }
  });

  return run.id;
}

// =========================================================================
// FACTORY INTEGRATION
// =========================================================================

// ---------------------------------------------------------------------------
// Resolve project knowledge objects into factory business doc references.
// Called by factory initPipeline when knowledge_object_ids are provided.
// Spec 119: knowledge is project-scoped; bindings table dropped.
// ---------------------------------------------------------------------------

export type FactoryDocRef = {
  name: string;
  storage_ref: string;
};

export async function resolveKnowledgeForFactory(
  projectId: string,
  knowledgeObjectIds: string[]
): Promise<FactoryDocRef[]> {
  if (knowledgeObjectIds.length === 0) return [];

  const objs = await db
    .select({
      id: knowledgeObjects.id,
      filename: knowledgeObjects.filename,
      storageKey: knowledgeObjects.storageKey,
      state: knowledgeObjects.state,
      contentHash: knowledgeObjects.contentHash,
      projectId: knowledgeObjects.projectId,
    })
    .from(knowledgeObjects)
    .where(
      and(
        inArray(knowledgeObjects.id, knowledgeObjectIds),
        eq(knowledgeObjects.projectId, projectId)
      )
    );

  // Verify all requested objects exist in this project
  if (objs.length !== knowledgeObjectIds.length) {
    const found = new Set(objs.map((o) => o.id));
    const missing = knowledgeObjectIds.filter((id) => !found.has(id));
    throw APIError.invalidArgument(
      `knowledge objects not found in project: ${missing.join(", ")}`
    );
  }

  // Spec 120 FR-020 — multi-record selection. For each object pick the
  // most-recent `completed` run; tie-break on `extractor_kind` ascending.
  // Failed runs are skipped, never returned. Throw `no_successful_extraction`
  // when an object has runs but all are failed (rather than silently dropping).
  const runs = await db
    .select({
      id: knowledgeExtractionRuns.id,
      knowledgeObjectId: knowledgeExtractionRuns.knowledgeObjectId,
      status: knowledgeExtractionRuns.status,
      completedAt: knowledgeExtractionRuns.completedAt,
      extractorKind: knowledgeExtractionRuns.extractorKind,
    })
    .from(knowledgeExtractionRuns)
    .where(
      and(
        eq(knowledgeExtractionRuns.projectId, projectId),
        inArray(knowledgeExtractionRuns.knowledgeObjectId, knowledgeObjectIds),
      ),
    );

  type RunRow = (typeof runs)[number];
  const byObject = new Map<string, RunRow[]>();
  for (const r of runs) {
    const list = byObject.get(r.knowledgeObjectId) ?? [];
    list.push(r);
    byObject.set(r.knowledgeObjectId, list);
  }

  const winners: { objectId: string; runId: string; candidateIds: string[] }[] = [];
  for (const obj of objs) {
    const list = byObject.get(obj.id) ?? [];
    if (list.length === 0) {
      // No extraction record yet — fall back to the legacy "available" gate.
      if (obj.state !== "available") {
        throw APIError.invalidArgument(
          `knowledge object ${obj.id} has no completed extraction and is not in 'available' state`,
        );
      }
      continue;
    }
    const completed = list.filter((r) => r.status === "completed");
    if (completed.length === 0) {
      throw APIError.failedPrecondition(
        `no_successful_extraction: object ${obj.id} has only failed extraction runs`,
      );
    }
    completed.sort((a, b) => {
      const at = a.completedAt?.getTime() ?? 0;
      const bt = b.completedAt?.getTime() ?? 0;
      if (at !== bt) return bt - at; // most-recent first
      return (a.extractorKind ?? "").localeCompare(b.extractorKind ?? "");
    });
    winners.push({
      objectId: obj.id,
      runId: completed[0].id,
      candidateIds: list.map((r) => r.id),
    });
  }

  // Audit each multi-candidate decision so the resolver's choice is
  // traceable. Single-candidate cases skip the audit (no decision to record).
  for (const w of winners) {
    if (w.candidateIds.length > 1) {
      await db.insert(auditLog).values({
        actorUserId: "00000000-0000-0000-0000-000000000000",
        action: KNOWLEDGE_EXTRACTION_RESOLVED,
        targetType: "knowledge_object",
        targetId: w.objectId,
        metadata: {
          projectId,
          winnerRunId: w.runId,
          candidateRunIds: w.candidateIds,
        },
      });
    }
  }

  return objs.map((o) => ({
    name: o.filename,
    storage_ref: o.storageKey,
  }));
}

// ---------------------------------------------------------------------------
// Resolve project knowledge objects into full wire-level KnowledgeBundle
// entries for the spec 110 factory.run.request envelope. Unlike
// resolveKnowledgeForFactory this generates a presigned download URL so the
// OPC consumer can materialise the blob locally before handing it to the
// engine.
// ---------------------------------------------------------------------------

export type KnowledgeBundleEntry = {
  objectId: string;
  filename: string;
  contentHash: string;
  downloadUrl: string;
};

/**
 * Presigned URL TTL for knowledge bundles dispatched on factory.run.request
 * (spec 110 §2.3, open question 1). Short enough that a leaked URL expires
 * quickly; long enough that a busy OPC can download the blob on a cold
 * cache. Resync regenerates it if the run rides an outbox retry.
 */
const KNOWLEDGE_BUNDLE_URL_TTL_SECONDS = 15 * 60;

export async function resolveKnowledgeBundlesForFactory(
  projectId: string,
  knowledgeObjectIds: string[]
): Promise<KnowledgeBundleEntry[]> {
  if (knowledgeObjectIds.length === 0) return [];

  const objs = await db
    .select({
      id: knowledgeObjects.id,
      filename: knowledgeObjects.filename,
      storageKey: knowledgeObjects.storageKey,
      contentHash: knowledgeObjects.contentHash,
      state: knowledgeObjects.state,
    })
    .from(knowledgeObjects)
    .where(
      and(
        inArray(knowledgeObjects.id, knowledgeObjectIds),
        eq(knowledgeObjects.projectId, projectId)
      )
    );

  if (objs.length !== knowledgeObjectIds.length) {
    const found = new Set(objs.map((o) => o.id));
    const missing = knowledgeObjectIds.filter((id) => !found.has(id));
    throw APIError.invalidArgument(
      `knowledge objects not found in project: ${missing.join(", ")}`
    );
  }

  const notReady = objs.filter((o) => o.state !== "available");
  if (notReady.length > 0) {
    throw APIError.invalidArgument(
      `knowledge objects not in 'available' state: ${notReady.map((o) => o.id).join(", ")}`
    );
  }

  // Resolve the project's bucket once; all objects share it.
  const [project] = await db
    .select({ bucket: projects.objectStoreBucket })
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1);
  if (!project) {
    throw APIError.notFound("project not found");
  }

  return Promise.all(
    objs.map(async (o) => ({
      objectId: o.id,
      filename: o.filename,
      contentHash: o.contentHash,
      downloadUrl: await getPresignedDownloadUrl(
        project.bucket,
        o.storageKey,
        KNOWLEDGE_BUNDLE_URL_TTL_SECONDS
      ),
    }))
  );
}
