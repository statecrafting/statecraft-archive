/**
 * Factory upstream sync trigger (spec 109 §5, replacing spec 108 Phase 3
 * inline behaviour).
 *
 * POST /api/factory/upstreams/sync:
 *   1. Inserts a factory_sync_runs row in state 'pending'.
 *   2. Publishes on FactorySyncRequestTopic.
 *   3. Returns the run id immediately — the worker does the clone/translate
 *      out of band and updates the row when it finishes.
 *
 * Rejects if an existing run is already 'pending' or 'running' for this org
 * (coalesce rapid double-clicks into a single run).
 */

import { api, APIError } from "encore.dev/api";
import log from "encore.dev/log";
import { getAuthData } from "~encore/auth";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "../db/drizzle";
import {
  auditLog,
  factorySyncRuns,
  factoryUpstreams,
} from "../db/schema";
import { hasOrgPermission } from "../auth/membership";
import { FactorySyncRequestTopic } from "./events";

export interface TriggerSyncResponse {
  syncRunId: string;
  status: "pending" | "running";
  queuedAt: string;
}

export const syncUpstreams = api(
  {
    expose: true,
    auth: true,
    method: "POST",
    path: "/api/factory/upstreams/sync",
  },
  async (): Promise<TriggerSyncResponse> => {
    const auth = getAuthData()!;

    if (!hasOrgPermission(auth.platformRole, "factory:configure")) {
      throw APIError.permissionDenied(
        "Only org admins can trigger factory sync"
      );
    }

    const [upstreamRow] = await db
      .select({ orgId: factoryUpstreams.orgId })
      .from(factoryUpstreams)
      .where(eq(factoryUpstreams.orgId, auth.orgId))
      .limit(1);

    if (!upstreamRow) {
      throw APIError.failedPrecondition(
        "No factory upstream configured for this org. Configure sources first."
      );
    }

    const [inFlight] = await db
      .select({ id: factorySyncRuns.id, status: factorySyncRuns.status })
      .from(factorySyncRuns)
      .where(
        and(
          eq(factorySyncRuns.orgId, auth.orgId),
          inArray(factorySyncRuns.status, ["pending", "running"])
        )
      )
      .limit(1);

    if (inFlight) {
      return {
        syncRunId: inFlight.id,
        status: inFlight.status as "pending" | "running",
        queuedAt: new Date().toISOString(),
      };
    }

    const queuedAt = new Date();
    const [inserted] = await db
      .insert(factorySyncRuns)
      .values({
        orgId: auth.orgId,
        status: "pending",
        triggeredBy: auth.userID,
        queuedAt,
      })
      .returning({ id: factorySyncRuns.id });

    await db
      .update(factoryUpstreams)
      .set({
        lastSyncStatus: "running",
        lastSyncError: null,
        updatedAt: queuedAt,
      })
      .where(eq(factoryUpstreams.orgId, auth.orgId));

    await FactorySyncRequestTopic.publish({
      syncRunId: inserted.id,
      orgId: auth.orgId,
      triggeredBy: auth.userID,
    });

    await db.insert(auditLog).values({
      actorUserId: auth.userID,
      action: "factory.upstreams.sync_enqueued",
      targetType: "factory_sync_runs",
      targetId: inserted.id,
      metadata: { orgId: auth.orgId },
    });

    log.info("factory sync enqueued", {
      syncRunId: inserted.id,
      orgId: auth.orgId,
    });

    return {
      syncRunId: inserted.id,
      status: "pending",
      queuedAt: queuedAt.toISOString(),
    };
  }
);
