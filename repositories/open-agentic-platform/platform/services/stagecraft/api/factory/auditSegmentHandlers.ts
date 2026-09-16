// Spec 207 AC-4: server-side handler for session-scoped audit segment
// countersignature requests.
//
// Mirrors the countersignRunCertificate pattern from grantDuplexHandlers.ts.
// Statecraft is the sole signing authority (spec 198 FR-014 posture): the
// local side (OPC) is keyless and submits a segment HEAD (hash + metadata);
// this handler validates and returns a short-lived signed countersignature,
// persisting a seal row.
//
// Offline-first: the local side accumulates unanchored heads and submits at
// reconnect. The upsert is idempotent on (org_id, session_id, segment_id).
//
// Transport concerns stay in api/sync/service.ts. This handler returns the
// targeted reply envelope (without meta); the dispatcher sends it.

import log from "encore.dev/log";
import { db } from "../db/drizzle";
import { auditLog, factorySessionAuditSeals } from "../db/schema";
import { FACTORY_AUDIT_SEGMENT_COUNTERSIGNED } from "./auditActions";
import { signFactoryJws, signingConfigured } from "./signing";
import type {
  ClientAuditSegmentCountersignRequest,
  ServerAuditSegmentCountersign,
} from "../sync/types";

interface HandlerCtx {
  orgId: string;
  userId: string;
}

export type AuditSegmentCountersignReply = Omit<
  ServerAuditSegmentCountersign,
  "meta"
>;

export async function handleAuditSegmentCountersignRequest(
  evt: ClientAuditSegmentCountersignRequest,
  ctx: HandlerCtx,
): Promise<AuditSegmentCountersignReply> {
  const { sessionId, segmentId, segmentHeadHash, segmentRecordCount, firstRecordAt, lastRecordAt } =
    evt;

  const refuse = (reason: string): AuditSegmentCountersignReply => {
    log.warn("audit segment countersign refused", {
      orgId: ctx.orgId,
      sessionId,
      segmentId,
      reason,
    });
    return {
      kind: "audit.segment.countersign",
      sessionId,
      segmentId,
      countersigned: false,
      refusedReason: reason,
    };
  };

  if (!signingConfigured()) {
    return refuse("signing authority not configured (FR-014)");
  }

  const { jws, kid } = signFactoryJws("oap-audit-segment-countersign+jws", {
    iss: "statecraft-factory",
    org_id: ctx.orgId,
    session_id: sessionId,
    segment_id: segmentId,
    segment_head_hash: segmentHeadHash,
    segment_record_count: segmentRecordCount,
    iat: Math.floor(Date.now() / 1000),
    // No exp: audit seals do not age out.
  });

  // Upsert the seal row: idempotent on re-submission (reconnect / at-least-once).
  const sealRows = await db
    .insert(factorySessionAuditSeals)
    .values({
      orgId: ctx.orgId,
      sessionId,
      segmentId,
      segmentHeadHash,
      segmentRecordCount,
      firstRecordAt: new Date(firstRecordAt),
      lastRecordAt: new Date(lastRecordAt),
      unanchored: false,
      countersignJws: jws,
      countersignKid: kid,
      countersignedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [
        factorySessionAuditSeals.orgId,
        factorySessionAuditSeals.sessionId,
        factorySessionAuditSeals.segmentId,
      ],
      set: {
        segmentHeadHash,
        segmentRecordCount,
        firstRecordAt: new Date(firstRecordAt),
        lastRecordAt: new Date(lastRecordAt),
        unanchored: false,
        countersignJws: jws,
        countersignKid: kid,
        countersignedAt: new Date(),
      },
    })
    .returning({ id: factorySessionAuditSeals.id });

  const sealId = sealRows[0]?.id ?? segmentId;

  await db.insert(auditLog).values({
    actorUserId: ctx.userId,
    action: FACTORY_AUDIT_SEGMENT_COUNTERSIGNED,
    targetType: "factory_session_audit_seals",
    targetId: sealId,
    metadata: {
      orgId: ctx.orgId,
      sessionId,
      segmentId,
      segmentHeadHash,
      segmentRecordCount,
    },
  });

  log.info("audit segment countersigned", {
    orgId: ctx.orgId,
    sessionId,
    segmentId,
    sealId,
  });

  return {
    kind: "audit.segment.countersign",
    sessionId,
    segmentId,
    countersigned: true,
    countersignJws: jws,
    kid,
  };
}
