/**
 * Org-admin storage purge.
 *
 * Walks the project's object-store bucket, diffs every key against the
 * union of DB-referenced storage keys, and deletes the unreferenced
 * remainder. Recovers bytes left behind when a project delete partially
 * failed (S3 sweep error, manual SQL deletes, legacy direct uploads).
 *
 * Owner/admin-only. Defaults to dry-run so the caller can preview what
 * would be deleted before committing. Every invocation lands in
 * audit_log with the manifest counts so this is also a recoverable
 * trail.
 *
 * Spec 119: project is the unit that owns the bucket; this endpoint is
 * keyed on `projectId` (formerly per-workspace).
 */

import { api, APIError } from "encore.dev/api";
import { getAuthData } from "~encore/auth";
import log from "encore.dev/log";
import { db } from "../db/drizzle";
import {
  auditLog,
  factoryArtifacts,
  factoryPipelines,
  knowledgeObjects,
  projects,
} from "../db/schema";
import { and, eq } from "drizzle-orm";
import { deleteObject, listAllObjects } from "../knowledge/storage";

interface PurgeOrphansRequest {
  /** Project the caller wants to purge. MUST belong to the caller's org. */
  projectId: string;
  /**
   * Default true. When true, no objects are deleted; the response carries
   * the orphan list so an operator can review before re-running with
   * dryRun=false.
   */
  dryRun?: boolean;
  /**
   * Cap on how many orphan keys are reported in the response sample.
   * Hard-clamped to [0, 500].
   */
  sampleLimit?: number;
}

interface PurgeOrphansResponse {
  projectId: string;
  bucket: string;
  totalKeys: number;
  referencedKeys: number;
  orphanKeys: number;
  purged: number;
  failed: number;
  dryRun: boolean;
  /** Up to `sampleLimit` orphan keys (or every orphan when fewer). */
  orphanSample: string[];
}

export const purgeOrphanStorage = api(
  {
    expose: true,
    auth: true,
    method: "POST",
    path: "/api/admin/storage/purge-orphans",
  },
  async (req: PurgeOrphansRequest): Promise<PurgeOrphansResponse> => {
    const auth = getAuthData()!;
    if (auth.platformRole !== "owner" && auth.platformRole !== "admin") {
      throw APIError.permissionDenied("Owner or admin role required");
    }
    if (!req.projectId) {
      throw APIError.invalidArgument("projectId is required");
    }

    const [project] = await db
      .select({
        id: projects.id,
        orgId: projects.orgId,
        objectStoreBucket: projects.objectStoreBucket,
      })
      .from(projects)
      .where(and(eq(projects.id, req.projectId), eq(projects.orgId, auth.orgId)))
      .limit(1);

    if (!project) {
      throw APIError.notFound("project not found");
    }
    if (!project.objectStoreBucket) {
      throw APIError.failedPrecondition(
        "Project has no object store bucket configured"
      );
    }

    const dryRun = req.dryRun ?? true;
    const sampleLimit = Math.max(0, Math.min(500, req.sampleLimit ?? 100));

    // ── Gather referenced keys ────────────────────────────────────────
    const referenced = new Set<string>();

    // knowledge_objects (project-scoped) — primary + extracted derivative.
    const koRows = await db
      .select({
        storageKey: knowledgeObjects.storageKey,
        extractionOutput: knowledgeObjects.extractionOutput,
      })
      .from(knowledgeObjects)
      .where(eq(knowledgeObjects.projectId, project.id));
    for (const k of koRows) {
      referenced.add(k.storageKey);
      const e = readExtractedKey(k.extractionOutput);
      if (e) referenced.add(e);
    }

    // factory_artifacts produced by pipelines under this project.
    const faRows = await db
      .select({ storagePath: factoryArtifacts.storagePath })
      .from(factoryArtifacts)
      .innerJoin(
        factoryPipelines,
        eq(factoryPipelines.id, factoryArtifacts.pipelineId)
      )
      .where(eq(factoryPipelines.projectId, project.id));
    for (const a of faRows) {
      referenced.add(a.storagePath);
    }

    // ── Walk the bucket ───────────────────────────────────────────────
    let allKeys: string[];
    try {
      allKeys = await listAllObjects(project.objectStoreBucket);
    } catch (err) {
      log.error("purgeOrphanStorage: list bucket failed", {
        bucket: project.objectStoreBucket,
        err: err instanceof Error ? err.message : String(err),
      });
      throw APIError.internal("Failed to list project bucket");
    }

    const orphans = allKeys.filter((k) => !referenced.has(k));

    // ── Delete (unless dry-run) ───────────────────────────────────────
    let purged = 0;
    let failed = 0;
    if (!dryRun) {
      for (const key of orphans) {
        try {
          await deleteObject(project.objectStoreBucket, key);
          purged++;
        } catch (err) {
          failed++;
          log.warn("purgeOrphanStorage: delete failed", {
            bucket: project.objectStoreBucket,
            key,
            err: err instanceof Error ? err.message : String(err),
          });
        }
      }
    }

    await db.insert(auditLog).values({
      actorUserId: auth.userID,
      action: "admin.storage.purge_orphans",
      targetType: "project",
      targetId: project.id,
      metadata: {
        bucket: project.objectStoreBucket,
        totalKeys: allKeys.length,
        referencedKeys: referenced.size,
        orphanKeys: orphans.length,
        purged,
        failed,
        dryRun,
      },
    });

    log.info("purgeOrphanStorage done", {
      projectId: project.id,
      bucket: project.objectStoreBucket,
      totalKeys: allKeys.length,
      referenced: referenced.size,
      orphans: orphans.length,
      purged,
      failed,
      dryRun,
    });

    return {
      projectId: project.id,
      bucket: project.objectStoreBucket,
      totalKeys: allKeys.length,
      referencedKeys: referenced.size,
      orphanKeys: orphans.length,
      purged,
      failed,
      dryRun,
      orphanSample: orphans.slice(0, sampleLimit),
    };
  }
);

function readExtractedKey(extractionOutput: unknown): string | null {
  if (!extractionOutput || typeof extractionOutput !== "object") return null;
  const v = (extractionOutput as Record<string, unknown>).extractedStorageKey;
  return typeof v === "string" ? v : null;
}
