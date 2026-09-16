// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Bartek Kus
// Spec: specs/120-factory-extraction-stage/spec.md — FR-016 through FR-019

// External extraction-output endpoints. OPC's `s-1-extract` stage produces
// typed `ExtractionOutput` locally and POSTs the same payload here so it is
// preserved as a versioned `knowledge_extraction_runs` record server-side.
// A second endpoint accepts yield-extraction requests for content that
// requires agent extraction; a third returns the most-recent successful
// record for a given content hash.
//
// Auth follows the same `expose: true, auth: true` Rauthy-JWT pattern as
// `ingestEvents` and `recordArtifacts`. The `X-Knowledge-Schema-Version`
// header carries OPC's compile-time `KNOWLEDGE_SCHEMA_VERSION`; bodies
// declaring an older version are rejected with `failed_precondition`.

import { api, APIError, Header } from "encore.dev/api";
import log from "encore.dev/log";
import { and, eq, desc } from "drizzle-orm";
import { db } from "../db/drizzle";
import {
  auditLog,
  knowledgeExtractionRuns,
  knowledgeObjects,
  projects,
} from "../db/schema";
import {
  ExtractionOutput,
  KNOWLEDGE_SCHEMA_VERSION,
  MINIMUM_KNOWLEDGE_SCHEMA_VERSION,
  validateExtractionOutput,
} from "./extractionOutput";
import {
  KNOWLEDGE_EXTRACTED,
} from "./auditActions";
import {
  broadcastObjectUpdated,
  enqueueExtraction,
} from "./extractionCore";

const SYSTEM_USER_ID = "00000000-0000-0000-0000-000000000000";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function verifyProjectInScope(
  projectId: string,
  orgId: string,
): Promise<void> {
  const rows = await db
    .select({ id: projects.id })
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.orgId, orgId)))
    .limit(1);
  if (rows.length === 0) {
    throw APIError.notFound("project not found");
  }
}

function checkSchemaVersion(headerValue: string | undefined): void {
  const version = headerValue?.trim() || KNOWLEDGE_SCHEMA_VERSION;
  if (compareSemver(version, MINIMUM_KNOWLEDGE_SCHEMA_VERSION) < 0) {
    throw APIError.failedPrecondition(
      `schema_version_too_old: ${version} < ${MINIMUM_KNOWLEDGE_SCHEMA_VERSION}`,
    );
  }
}

function compareSemver(a: string, b: string): number {
  const ap = a.split(".").map((n) => Number.parseInt(n, 10) || 0);
  const bp = b.split(".").map((n) => Number.parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(ap.length, bp.length); i++) {
    const av = ap[i] ?? 0;
    const bv = bp[i] ?? 0;
    if (av !== bv) return av - bv;
  }
  return 0;
}

// ---------------------------------------------------------------------------
// FR-016: POST extraction-output
// ---------------------------------------------------------------------------

type PostExtractionOutputRequest = {
  projectId: string;
  objectId: string;
  orgId: string;
  schemaVersion: Header<"X-Knowledge-Schema-Version">;
  output: ExtractionOutput;
};

type PostExtractionOutputResponse = {
  duplicate: boolean;
  extractionRunId: string;
};

export const postExtractionOutput = api(
  {
    expose: true,
    auth: true,
    method: "POST",
    path: "/api/projects/:projectId/knowledge/objects/:objectId/extraction-output",
  },
  async (req: PostExtractionOutputRequest): Promise<PostExtractionOutputResponse> => {
    checkSchemaVersion(req.schemaVersion);
    const output = validateExtractionOutput(req.output);
    await verifyProjectInScope(req.projectId, req.orgId);

    const [obj] = await db
      .select({
        id: knowledgeObjects.id,
        projectId: knowledgeObjects.projectId,
        contentHash: knowledgeObjects.contentHash,
        state: knowledgeObjects.state,
      })
      .from(knowledgeObjects)
      .where(eq(knowledgeObjects.id, req.objectId))
      .limit(1);
    if (!obj || obj.projectId !== req.projectId) {
      throw APIError.notFound("knowledge object not found in project");
    }

    // FR-016(e): idempotency on (object_id, content_hash, extractor.version).
    // Application-layer pre-select; existing schema has no UNIQUE.
    const existing = await db
      .select({
        id: knowledgeExtractionRuns.id,
      })
      .from(knowledgeExtractionRuns)
      .where(
        and(
          eq(knowledgeExtractionRuns.knowledgeObjectId, obj.id),
          eq(knowledgeExtractionRuns.extractorKind, output.extractor.kind),
          eq(knowledgeExtractionRuns.extractorVersion, output.extractor.version),
          eq(knowledgeExtractionRuns.status, "completed"),
        ),
      )
      .limit(1);
    if (existing.length > 0) {
      log.info("postExtractionOutput: idempotent duplicate", {
        objectId: obj.id,
        runId: existing[0].id,
      });
      return { duplicate: true, extractionRunId: existing[0].id };
    }

    // FR-016(f): insert completed row + advance state in one transaction.
    let runId = "";
    await db.transaction(async (tx) => {
      const inserted = await tx
        .insert(knowledgeExtractionRuns)
        .values({
          knowledgeObjectId: obj.id,
          projectId: obj.projectId,
          status: "completed",
          extractorKind: output.extractor.kind,
          extractorVersion: output.extractor.version,
          agentRun: output.extractor.agentRun
            ? (output.extractor.agentRun as unknown as Record<string, unknown>)
            : null,
          completedAt: new Date(),
        })
        .returning({ id: knowledgeExtractionRuns.id });
      runId = inserted[0].id;

      if (obj.state === "imported" || obj.state === "extracting") {
        await tx
          .update(knowledgeObjects)
          .set({
            state: "extracted",
            extractionOutput: output as unknown as Record<string, unknown>,
            lastExtractionError: null,
            updatedAt: new Date(),
          })
          .where(eq(knowledgeObjects.id, obj.id));
      }

      await tx.insert(auditLog).values({
        actorUserId: SYSTEM_USER_ID,
        action: KNOWLEDGE_EXTRACTED,
        targetType: "knowledge_object",
        targetId: obj.id,
        metadata: {
          source: "opc-s-1-extract",
          runId,
          extractorKind: output.extractor.kind,
          extractorVersion: output.extractor.version,
          projectId: obj.projectId,
          ...(output.extractor.agentRun
            ? {
                modelId: output.extractor.agentRun.modelId,
                promptFingerprint: output.extractor.agentRun.promptFingerprint,
                costUsd: output.extractor.agentRun.costUsd,
                tokenSpend: output.extractor.agentRun.tokenSpend,
              }
            : {}),
        },
      });
    });

    await broadcastObjectUpdated(obj.projectId, {
      objectId: obj.id,
      state: "extracted",
      hasExtractionOutput: true,
      lastExtractionError: null,
    });

    return { duplicate: false, extractionRunId: runId };
  },
);

// ---------------------------------------------------------------------------
// FR-018: POST yield-extraction
// ---------------------------------------------------------------------------

type YieldExtractionRequest = {
  projectId: string;
  objectId: string;
  orgId: string;
  contentHash: string;
  requestedExtractorKind?: string;
  reason: string;
};

type YieldExtractionResponse = {
  runId: string;
  outcome: "enqueued" | "deduped";
  duplexEventType: "knowledge.object.updated";
};

export const yieldExtraction = api(
  {
    expose: true,
    auth: true,
    method: "POST",
    path: "/api/projects/:projectId/knowledge/objects/:objectId/yield-extraction",
  },
  async (req: YieldExtractionRequest): Promise<YieldExtractionResponse> => {
    if (!req.contentHash || !req.reason) {
      throw APIError.invalidArgument("contentHash and reason are required");
    }
    await verifyProjectInScope(req.projectId, req.orgId);

    const [obj] = await db
      .select({
        id: knowledgeObjects.id,
        projectId: knowledgeObjects.projectId,
        contentHash: knowledgeObjects.contentHash,
      })
      .from(knowledgeObjects)
      .where(eq(knowledgeObjects.id, req.objectId))
      .limit(1);
    if (!obj || obj.projectId !== req.projectId) {
      throw APIError.notFound("knowledge object not found in project");
    }
    if (obj.contentHash !== req.contentHash) {
      throw APIError.failedPrecondition(
        `content_hash mismatch: object ${obj.contentHash} vs request ${req.contentHash}`,
      );
    }

    const result = await enqueueExtraction({
      knowledgeObjectId: obj.id,
      projectId: obj.projectId,
      reason: `opc-yield: ${req.reason}`,
    });

    return {
      runId: result.runId,
      outcome: result.outcome,
      duplexEventType: "knowledge.object.updated",
    };
  },
);

// ---------------------------------------------------------------------------
// FR-019: GET extraction-output
// ---------------------------------------------------------------------------

type GetExtractionOutputRequest = {
  projectId: string;
  objectId: string;
  orgId: string;
  contentHash: string;
};

type GetExtractionOutputResponse = {
  extractionRunId: string;
  output: ExtractionOutput;
};

export const getExtractionOutput = api(
  {
    expose: true,
    auth: true,
    method: "GET",
    path: "/api/projects/:projectId/knowledge/objects/:objectId/extraction-output",
  },
  async (req: GetExtractionOutputRequest): Promise<GetExtractionOutputResponse> => {
    await verifyProjectInScope(req.projectId, req.orgId);

    const [obj] = await db
      .select({
        id: knowledgeObjects.id,
        contentHash: knowledgeObjects.contentHash,
        extractionOutput: knowledgeObjects.extractionOutput,
      })
      .from(knowledgeObjects)
      .where(eq(knowledgeObjects.id, req.objectId))
      .limit(1);
    if (!obj) {
      throw APIError.notFound("knowledge object not found");
    }
    if (obj.contentHash !== req.contentHash) {
      throw APIError.notFound(
        "no extraction record matches the supplied content hash",
      );
    }

    const [run] = await db
      .select({
        id: knowledgeExtractionRuns.id,
      })
      .from(knowledgeExtractionRuns)
      .where(
        and(
          eq(knowledgeExtractionRuns.knowledgeObjectId, obj.id),
          eq(knowledgeExtractionRuns.status, "completed"),
        ),
      )
      .orderBy(desc(knowledgeExtractionRuns.completedAt))
      .limit(1);

    if (!run || !obj.extractionOutput) {
      throw APIError.notFound("no completed extraction for this content hash");
    }

    return {
      extractionRunId: run.id,
      output: obj.extractionOutput as unknown as ExtractionOutput,
    };
  },
);
