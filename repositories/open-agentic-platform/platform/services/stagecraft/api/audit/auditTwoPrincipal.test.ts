// Spec 205 Phase 0 (FR-005, AC-4): two-principal audit attribution.
//
// Proves the forensic-query contract: a query keyed on the non-human
// identity subject ("everything agent X did") returns that agent's
// complete audit trail, with the human principal (on_behalf_of) readable
// off the same rows. No log archaeology, and the actor column does not
// have to be consulted: the trail is retrievable across both write-site
// actor shapes (human actor for the duplex/sync paths; SYSTEM actor for
// the M2M ingest path).
//
// Phase 0 lands the retrievable data model. The live write-site threading
// (HandlerCtx / InboundContext / ingestAuditRecord populating these
// columns from a minted NHI) is type-checked at compile and exercised by
// the Phase 1 integration suite, where ctx actually carries an NHI; in
// Phase 0 ctx.nhiSub is always undefined, so there is nothing to observe
// at the write sites yet. This suite seeds rows in exactly the shape
// those sites emit and verifies the query that reads them.
//
// Excluded from `npm test` and run only under `encore test` (live DB
// required). Mirrors auditSegmentHandlers.test.ts fixture conventions.

import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { and, eq, inArray, isNull, or } from "drizzle-orm";
import { db } from "../db/drizzle";
import { auditLog, organizations, users } from "../db/schema";

const SYSTEM_USER_ID = "00000000-0000-0000-0000-000000000000";

const ORG_ID = "20500000-0000-0000-0000-000000000a01";
const HUMAN_ID = "20500000-0000-0000-0000-000000000a02";

const AGENT_X = "dyn$agent-205-x";
const AGENT_Y = "dyn$agent-205-y";

async function cleanup(): Promise<void> {
  await db
    .delete(auditLog)
    .where(
      or(
        inArray(auditLog.nhiSub, [AGENT_X, AGENT_Y]),
        eq(auditLog.actorUserId, HUMAN_ID),
      ),
    );
  await db.delete(organizations).where(eq(organizations.id, ORG_ID));
  await db.delete(users).where(eq(users.id, HUMAN_ID));
}

beforeAll(async () => {
  await cleanup();
  await db.insert(users).values({
    id: HUMAN_ID,
    email: "audit-2principal-205@example.test",
    name: "Two-Principal Test Human",
  });
  await db.insert(organizations).values({
    id: ORG_ID,
    name: "Two-Principal Test Org",
    slug: "audit-2principal-test-org-205",
  });

  // Agent X trail across BOTH write-site actor shapes:
  //  - duplex/sync shape: actor = human, nhi_sub = agent, on_behalf_of = human
  //  - M2M ingest shape:  actor = SYSTEM, nhi_sub = agent, on_behalf_of = human
  await db.insert(auditLog).values([
    {
      actorUserId: HUMAN_ID,
      nhiSub: AGENT_X,
      onBehalfOf: HUMAN_ID,
      action: "opc.tool.invoke",
      targetType: "project",
      targetId: ORG_ID,
      metadata: { orgId: ORG_ID, step: 1 },
    },
    {
      actorUserId: HUMAN_ID,
      nhiSub: AGENT_X,
      onBehalfOf: HUMAN_ID,
      action: "factory.run.grant.issued",
      targetType: "factory_runs",
      targetId: "run-205-1",
      metadata: { orgId: ORG_ID, step: 2 },
    },
    {
      actorUserId: SYSTEM_USER_ID,
      nhiSub: AGENT_X,
      onBehalfOf: HUMAN_ID,
      action: "opc.audit.candidate",
      targetType: "tool",
      targetId: "tool-205-1",
      metadata: { orgId: ORG_ID, step: 3 },
    },
    // A second agent under the same human: must NOT leak into agent X's trail.
    {
      actorUserId: HUMAN_ID,
      nhiSub: AGENT_Y,
      onBehalfOf: HUMAN_ID,
      action: "opc.tool.invoke",
      targetType: "project",
      targetId: ORG_ID,
      metadata: { orgId: ORG_ID, agent: "y" },
    },
    // A pre-NHI human-only row: both principals NULL, still a valid row.
    {
      actorUserId: HUMAN_ID,
      action: "user.login",
      targetType: "user",
      targetId: HUMAN_ID,
      metadata: { orgId: ORG_ID },
    },
  ]);
});

afterAll(async () => {
  await cleanup();
});

describe("two-principal audit attribution (spec 205 FR-005, AC-4)", () => {
  it("forensic query by NHI subject returns the agent's complete trail", async () => {
    const trail = await db
      .select()
      .from(auditLog)
      .where(eq(auditLog.nhiSub, AGENT_X));

    // All three agent-X rows, across both actor shapes, and nothing else.
    // (Set membership, not order: the forensic contract is "every row for
    // agent X", which is order-independent.)
    expect(trail).toHaveLength(3);
    const actions = trail.map((r) => r.action).sort();
    expect(actions).toEqual([
      "factory.run.grant.issued",
      "opc.audit.candidate",
      "opc.tool.invoke",
    ]);
  });

  it("the human principal is readable off the same rows (no archaeology)", async () => {
    const trail = await db
      .select()
      .from(auditLog)
      .where(eq(auditLog.nhiSub, AGENT_X));

    for (const row of trail) {
      // on_behalf_of names the human inline; the actor column varies
      // (human for duplex/sync, SYSTEM for M2M ingest) and need not be
      // consulted to attribute the action to its human.
      expect(row.onBehalfOf).toBe(HUMAN_ID);
    }
    // The trail spans both actor shapes, proving the query is actor-agnostic.
    const actors = new Set(trail.map((r) => r.actorUserId));
    expect(actors.has(HUMAN_ID)).toBe(true);
    expect(actors.has(SYSTEM_USER_ID)).toBe(true);
  });

  it("a different agent's rows do not leak into the trail", async () => {
    const trailX = await db
      .select()
      .from(auditLog)
      .where(eq(auditLog.nhiSub, AGENT_X));
    expect(trailX.some((r) => r.nhiSub === AGENT_Y)).toBe(false);

    const trailY = await db
      .select()
      .from(auditLog)
      .where(eq(auditLog.nhiSub, AGENT_Y));
    expect(trailY).toHaveLength(1);
    expect(trailY[0].onBehalfOf).toBe(HUMAN_ID);
  });

  it("pre-NHI rows stay valid with both principals NULL (non-breaking)", async () => {
    const humanOnly = await db
      .select()
      .from(auditLog)
      .where(
        and(
          eq(auditLog.actorUserId, HUMAN_ID),
          eq(auditLog.action, "user.login"),
        ),
      );
    expect(humanOnly).toHaveLength(1);
    expect(humanOnly[0].nhiSub).toBeNull();
    expect(humanOnly[0].onBehalfOf).toBeNull();

    // And such rows are excluded from any NHI-keyed forensic query.
    const nullSub = await db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.actorUserId, HUMAN_ID), isNull(auditLog.nhiSub)));
    expect(nullSub.every((r) => r.action !== "opc.tool.invoke")).toBe(true);
  });
});
