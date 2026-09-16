// Spec 207 AC-4: audit segment countersign handler tests.
//
// Covers: positive path (signed seal, persisted row), refusal when signing
// is not configured, and idempotent re-submission.
//
// Excluded from `npm test` and run only under `encore test` (live DB required).
// Signing uses a throwaway Ed25519 keypair injected via the env fallback
// (CONST-002: no committed key material). Mirrors grantDuplexHandlers.test.ts.

import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { generateKeyPairSync } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db } from "../db/drizzle";
import {
  auditLog,
  factorySessionAuditSeals,
  organizations,
  users,
} from "../db/schema";
import { handleAuditSegmentCountersignRequest } from "./auditSegmentHandlers";
import { exportPublicJwk, verifyCompactJws } from "./signing-pure";
import { FACTORY_AUDIT_SEGMENT_COUNTERSIGNED } from "./auditActions";
import type { ClientAuditSegmentCountersignRequest } from "../sync/types";

const ORG_ID = "66666666-0000-0000-0000-000000000a01";
const USER_ID = "66666666-0000-0000-0000-000000000a02";

const SESSION_A = "test-session-207-a";
const SESSION_B = "test-session-207-b";
const SEGMENT_1 = "seg-001";
const SEGMENT_2 = "seg-002";

const CTX = { orgId: ORG_ID, userId: USER_ID };

const KID = "fk-audit-seg-test";
const PEM = generateKeyPairSync("ed25519")
  .privateKey.export({ type: "pkcs8", format: "pem" })
  .toString();
const JWKS = [exportPublicJwk(PEM, KID)];

const META = (eventId: string) => ({
  v: 2 as const,
  eventId,
  sentAt: "2026-06-19T12:00:00Z",
});

function makeRequest(
  sessionId: string,
  segmentId: string,
  overrides: Partial<ClientAuditSegmentCountersignRequest> = {},
): ClientAuditSegmentCountersignRequest {
  return {
    kind: "audit.segment.countersign_request",
    meta: META(`evt-audit-${sessionId}-${segmentId}`),
    sessionId,
    segmentId,
    segmentHeadHash: `head-hash-${segmentId}`,
    segmentRecordCount: 42,
    firstRecordAt: "2026-06-19T10:00:00Z",
    lastRecordAt: "2026-06-19T11:00:00Z",
    ...overrides,
  };
}

async function cleanup(): Promise<void> {
  await db
    .delete(factorySessionAuditSeals)
    .where(eq(factorySessionAuditSeals.orgId, ORG_ID));
  await db.delete(auditLog).where(eq(auditLog.actorUserId, USER_ID));
  await db.delete(organizations).where(eq(organizations.id, ORG_ID));
  await db.delete(users).where(eq(users.id, USER_ID));
}

beforeAll(async () => {
  process.env.FACTORY_SIGNING_PRIVATE_KEY = PEM;
  process.env.FACTORY_SIGNING_KID = KID;
  await cleanup();
  await db.insert(users).values({
    id: USER_ID,
    email: "audit-seg-test-207@example.test",
    name: "Audit Segment Test User",
  });
  await db.insert(organizations).values({
    id: ORG_ID,
    name: "Audit Segment Test Org",
    slug: "audit-seg-test-org-207",
  });
});

afterAll(async () => {
  delete process.env.FACTORY_SIGNING_PRIVATE_KEY;
  delete process.env.FACTORY_SIGNING_KID;
  await cleanup();
});

describe("audit.segment.countersign_request (spec 207 AC-4)", () => {
  it("countersigns a segment HEAD and persists the seal row", async () => {
    const reply = await handleAuditSegmentCountersignRequest(
      makeRequest(SESSION_A, SEGMENT_1),
      CTX,
    );

    expect(reply.countersigned).toBe(true);
    expect(reply.kind).toBe("audit.segment.countersign");
    expect(reply.sessionId).toBe(SESSION_A);
    expect(reply.segmentId).toBe(SEGMENT_1);
    expect(reply.kid).toBe(KID);
    expect(reply.countersignJws).toBeTruthy();

    // Verify the JWS signature and claims.
    const verified = verifyCompactJws(
      reply.countersignJws!,
      JWKS,
      "oap-audit-segment-countersign+jws",
    );
    expect(verified.payload.org_id).toBe(ORG_ID);
    expect(verified.payload.session_id).toBe(SESSION_A);
    expect(verified.payload.segment_id).toBe(SEGMENT_1);
    expect(verified.payload.segment_head_hash).toBe(`head-hash-${SEGMENT_1}`);
    expect(verified.payload.segment_record_count).toBe(42);
    expect(typeof verified.payload.iat).toBe("number");
    // No exp on audit seals.
    expect(verified.payload.exp).toBeUndefined();

    // Verify the seal row was persisted.
    const rows = await db
      .select()
      .from(factorySessionAuditSeals)
      .where(
        and(
          eq(factorySessionAuditSeals.orgId, ORG_ID),
          eq(factorySessionAuditSeals.sessionId, SESSION_A),
          eq(factorySessionAuditSeals.segmentId, SEGMENT_1),
        ),
      );
    expect(rows).toHaveLength(1);
    expect(rows[0].segmentHeadHash).toBe(`head-hash-${SEGMENT_1}`);
    expect(rows[0].segmentRecordCount).toBe(42);
    expect(rows[0].countersignJws).toBe(reply.countersignJws);
    expect(rows[0].countersignedAt).not.toBeNull();
    expect(rows[0].unanchored).toBe(false);

    // Verify the audit log entry.
    const auditRows = await db
      .select()
      .from(auditLog)
      .where(eq(auditLog.action, FACTORY_AUDIT_SEGMENT_COUNTERSIGNED));
    expect(auditRows.length).toBeGreaterThan(0);
    const entry = auditRows.find(
      (r) =>
        (r.metadata as Record<string, unknown>).sessionId === SESSION_A &&
        (r.metadata as Record<string, unknown>).segmentId === SEGMENT_1,
    );
    expect(entry).toBeDefined();
  });

  it("idempotently upserts on re-submission of the same segment", async () => {
    // First submission (already done above, but we call again here).
    const firstReply = await handleAuditSegmentCountersignRequest(
      makeRequest(SESSION_A, SEGMENT_1),
      CTX,
    );
    expect(firstReply.countersigned).toBe(true);

    // Re-submission: same (org, session, segment).
    const secondReply = await handleAuditSegmentCountersignRequest(
      makeRequest(SESSION_A, SEGMENT_1),
      CTX,
    );
    expect(secondReply.countersigned).toBe(true);

    // Only one row should exist for the (org, session, segment) key.
    const rows = await db
      .select()
      .from(factorySessionAuditSeals)
      .where(
        and(
          eq(factorySessionAuditSeals.orgId, ORG_ID),
          eq(factorySessionAuditSeals.sessionId, SESSION_A),
          eq(factorySessionAuditSeals.segmentId, SEGMENT_1),
        ),
      );
    expect(rows).toHaveLength(1);
  });

  it("accepts distinct segments within the same session", async () => {
    const reply = await handleAuditSegmentCountersignRequest(
      makeRequest(SESSION_A, SEGMENT_2),
      CTX,
    );
    expect(reply.countersigned).toBe(true);
    expect(reply.segmentId).toBe(SEGMENT_2);
  });

  it("accepts the same segment id under a different session", async () => {
    const reply = await handleAuditSegmentCountersignRequest(
      makeRequest(SESSION_B, SEGMENT_1),
      CTX,
    );
    expect(reply.countersigned).toBe(true);
    expect(reply.sessionId).toBe(SESSION_B);
  });

  it("refuses when signing is not configured", async () => {
    const savedPem = process.env.FACTORY_SIGNING_PRIVATE_KEY;
    const savedKid = process.env.FACTORY_SIGNING_KID;
    delete process.env.FACTORY_SIGNING_PRIVATE_KEY;
    delete process.env.FACTORY_SIGNING_KID;
    try {
      const reply = await handleAuditSegmentCountersignRequest(
        makeRequest("unconfigured-session", "seg-x"),
        CTX,
      );
      expect(reply.countersigned).toBe(false);
      expect(reply.refusedReason).toContain("signing authority not configured");
    } finally {
      process.env.FACTORY_SIGNING_PRIVATE_KEY = savedPem;
      process.env.FACTORY_SIGNING_KID = savedKid;
    }
  });
});
