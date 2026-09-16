// Spec 143 FR-010 — orphan-row reconciliation for the
// `requestUpload → confirmUpload` flow.
//
// `requestUpload` inserts the knowledge_objects row in `imported` state
// BEFORE the browser PUT (`knowledge.ts:365`). Two orphan classes
// accumulate from that insertion ordering:
//
//   Class A — PUT failed, no blob. Row says imported, headObject returns
//             404. The row is unrecoverable; delete it with an audit
//             marker so the orphan rate is observable.
//
//   Class B — PUT succeeded, confirmUpload never fired (browser tab
//             closed mid-flow, network flapped, etc). Row says imported,
//             headObject returns 200. The blob is present and the row
//             can self-heal by invoking confirmUploadCore from the
//             sweeper context — same code path as the user-driven
//             confirm.
//
// `retryExtraction` (spec 115 FR-010) cannot help either class — it
// keys on `lastExtractionError`, which is null for rows whose extraction
// has never been attempted. Spec 143 owns the cleanup because both
// classes were surfaced in 143's diagnosis and silent accumulation
// would undermine the spec's claim that A-with-hardening is the
// chosen architecture.
//
// Concurrency model (spec 143 FR-010):
//
//   1. Sweeper-vs-sweeper, Class A. Per-row DELETE ... WHERE state =
//      'imported' RETURNING id, plus same-transaction audit insert.
//      Only the first concurrent DELETE returns rows; the second is a
//      no-op and skips the audit. No duplicate `knowledge.upload_orphaned`
//      rows.
//
//   2. Sweeper-vs-sweeper, Class B. The UPDATE inside confirmUploadCore
//      is naturally idempotent (same row, same value). Audit + enqueue
//      can fire twice; audit is journal-style (informational double is
//      fine), and extraction enqueue is deduplicated by spec 115 FR-003
//      (`(projectId, contentHash, extractorVersion)` over 24h, see
//      `extractionCore.ts:148-200`). Net: at most two
//      `knowledge.upload_confirmed` audit rows but exactly one
//      extraction run.
//
//   3. Sweeper Class B vs returning user. Same shape as case 2 — race
//      with user's `confirmUpload` API call produces at most two audits
//      (one with `metadata.source = "orphan_sweep_class_b"`, one
//      without) and exactly one extraction run. Pinned by the race
//      test in `orphanSweeper.integration.test.ts`.

import { and, eq, lt, sql } from "drizzle-orm";
import log from "encore.dev/log";
import { db } from "../db/drizzle";
import { auditLog, knowledgeObjects, projects } from "../db/schema";
import { headObject } from "./storage";
import { confirmUploadCore } from "./knowledge";
import { KNOWLEDGE_UPLOAD_ORPHANED } from "./auditActions";

const SYSTEM_USER_ID = "00000000-0000-0000-0000-000000000000";

// FR-010 grace window. Default 3600s = upload TTL (FR-012). A row whose
// presigned URL has expired and has no blob is unrecoverable by the
// browser; a row with a blob past the URL TTL has clearly lost its
// confirm signal.
const DEFAULT_GRACE_SEC = 3600;

function getGraceSec(): number {
  const v = process.env.statecraft_KNOWLEDGE_ORPHAN_AFTER_SEC;
  if (!v) return DEFAULT_GRACE_SEC;
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_GRACE_SEC;
}

export type OrphanSweepResult = {
  scanned: number;
  deletedClassA: number;
  selfHealedClassB: number;
  /** Rows that were past grace but where headObject errored or
   *  Class B's confirmUploadCore threw. Counted separately so a
   *  monitoring alert can fire on a non-zero value without
   *  conflating it with normal sweep activity. */
  errored: number;
};

/**
 * Spec 143 FR-010. Iterates candidate rows past the grace window and
 * routes each to the Class A (delete) or Class B (self-heal) handler
 * based on `headObject`. Returns a per-class summary so the cron
 * wrapper can log it.
 *
 * Tunable via `STATECRAFT_KNOWLEDGE_ORPHAN_AFTER_SEC` (default 3600s).
 */
export async function runOrphanSweep(
  now: Date = new Date(),
): Promise<OrphanSweepResult> {
  const graceSec = getGraceSec();
  const cutoff = new Date(now.getTime() - graceSec * 1000);

  // Candidates: rows in `imported` state whose created_at is past the
  // grace window. Joined to projects to resolve the bucket per row in
  // the same query rather than N+1.
  const candidates = await db
    .select({
      id: knowledgeObjects.id,
      projectId: knowledgeObjects.projectId,
      storageKey: knowledgeObjects.storageKey,
      filename: knowledgeObjects.filename,
      bucket: projects.objectStoreBucket,
    })
    .from(knowledgeObjects)
    .innerJoin(projects, eq(knowledgeObjects.projectId, projects.id))
    .where(
      and(
        eq(knowledgeObjects.state, "imported"),
        lt(knowledgeObjects.createdAt, cutoff),
      ),
    );

  const result: OrphanSweepResult = {
    scanned: candidates.length,
    deletedClassA: 0,
    selfHealedClassB: 0,
    errored: 0,
  };

  if (candidates.length === 0) {
    return result;
  }

  for (const row of candidates) {
    try {
      const meta = await headObject(row.bucket, row.storageKey);
      if (meta === null) {
        // Class A — no blob. Delete + audit in one transaction so the
        // race-resolved DELETE-RETURNING gates the audit insert.
        const deleted = await db.transaction(async (tx) => {
          const rows = await tx
            .delete(knowledgeObjects)
            .where(
              and(
                eq(knowledgeObjects.id, row.id),
                eq(knowledgeObjects.state, "imported"),
              ),
            )
            .returning({ id: knowledgeObjects.id });
          if (rows.length === 0) {
            return 0; // lost race to a concurrent sweep
          }
          await tx.insert(auditLog).values({
            actorUserId: SYSTEM_USER_ID,
            action: KNOWLEDGE_UPLOAD_ORPHANED,
            targetType: "knowledge_object",
            targetId: row.id,
            metadata: {
              filename: row.filename,
              storageKey: row.storageKey,
              class: "no_blob",
              projectId: row.projectId,
              graceSec,
            },
          });
          return 1;
        });
        result.deletedClassA += deleted;
      } else {
        // Class B — blob present. Self-heal via confirmUploadCore with
        // sweeper actor. confirmUploadCore is idempotent at the
        // extraction-enqueue layer (spec 115 FR-003); audit may double
        // under race but is journal-style.
        await confirmUploadCore({
          knowledgeObjectId: row.id,
          projectId: row.projectId,
          bucket: row.bucket,
          actor: {
            userId: SYSTEM_USER_ID,
            source: "orphan_sweep_class_b",
          },
        });
        result.selfHealedClassB += 1;
      }
    } catch (err) {
      // confirmUploadCore can throw APIError.invalidArgument if a
      // concurrent caller raced through the state transition; that
      // counts as expected (the row is no longer in `imported`) and
      // does not mark the sweep as errored. Anything else is logged
      // and counted.
      const code = (err as { code?: string }).code;
      if (code === "invalid_argument") {
        log.info("orphan sweep: row state changed mid-flight, skipping", {
          objectId: row.id,
          err: (err as Error).message,
        });
        continue;
      }
      result.errored += 1;
      log.error("orphan sweep: row processing failed", {
        objectId: row.id,
        projectId: row.projectId,
        err: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return result;
}
