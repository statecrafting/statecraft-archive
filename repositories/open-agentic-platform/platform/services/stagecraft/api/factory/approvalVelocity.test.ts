// Spec 202 FR-004: approval-velocity counter integration tests (DB half).
//
// Records-only: neither entry point ever blocks. These cases assert the
// org-scoped count over the `gate_approved` ratification trail, that
// `detectApprovalVelocity` writes exactly one `approval_velocity_anomaly`
// audit row when (and only when) the break trips, and that the org join keeps
// one org's approvals out of another's count.
//
// Fixture family: `44444444-...` (queueStormGate.test.ts owns `33333333-...`,
// runs.test.ts `22222222-...`, runsMigration.test.ts `11111111-...`), so there
// is no live collision under the `--fileParallelism=false` sequential run this
// project requires.
//
// Live database; EXCLUDED from `npm test` (vite.config.ts) and run only under
// `encore test`, same posture as queueStormGate.test.ts.

import { describe, expect, it, beforeAll, afterAll, afterEach } from "vitest";
import { sql } from "drizzle-orm";
import { db } from "../db/drizzle";
import {
  detectApprovalVelocity,
  measureApprovalVelocity,
} from "./approvalVelocity";
import {
  FACTORY_RUN_GATE_APPROVED,
  FACTORY_RUN_APPROVAL_VELOCITY_ANOMALY,
} from "./auditActions";

const ORG_ID = "44444444-0000-0000-0000-0000000000c1";
const OTHER_ORG_ID = "44444444-0000-0000-0000-0000000000c2";
const USER_ID = "44444444-0000-0000-0000-0000000000c3";

const WINDOW_ENV = "STATECRAFT_FACTORY_APPROVAL_VELOCITY_WINDOW_SEC";
const THRESHOLD_ENV = "STATECRAFT_FACTORY_APPROVAL_VELOCITY_THRESHOLD";
const ORIGINAL_WINDOW = process.env[WINDOW_ENV];
const ORIGINAL_THRESHOLD = process.env[THRESHOLD_ENV];
const TEST_WINDOW = 60;
const TEST_THRESHOLD = 3;

// Run ids captured at seed time; the gate_approved audit rows target them.
let runId = "";
let otherRunId = "";

async function seedRun(orgId: string, clientRunId: string): Promise<string> {
  const res = await db.execute(sql`
    INSERT INTO factory_runs
      (org_id, triggered_by, adapter_id, process_id, client_run_id, status, source_shas)
    VALUES
      (${orgId}, ${USER_ID}, 'synthetic-adapter-vel-test',
       'synthetic-process-vel-test', ${clientRunId}, 'queued', '{}'::jsonb)
    RETURNING id
  `);
  return (res.rows[0] as { id: string }).id;
}

/** Seed one `gate_approved` ratification row `secsAgo` seconds before now,
 *  targeting `targetRunId` (which fixes the org via the count query's join). */
async function seedApproval(
  targetRunId: string,
  secsAgo: number,
): Promise<void> {
  await db.execute(sql`
    INSERT INTO audit_log
      (actor_user_id, action, target_type, target_id, metadata, created_at)
    VALUES
      (${USER_ID}, ${FACTORY_RUN_GATE_APPROVED}, 'factory_runs', ${targetRunId},
       '{}'::jsonb, now() - (${secsAgo} * interval '1 second'))
  `);
}

async function anomalyRows() {
  const rows = await db.execute(sql`
    SELECT metadata FROM audit_log
      WHERE actor_user_id = ${USER_ID}
        AND action = ${FACTORY_RUN_APPROVAL_VELOCITY_ANOMALY}
  `);
  return rows.rows as { metadata: Record<string, unknown> }[];
}

describe("spec 202 FR-004: approval-velocity counter", () => {
  beforeAll(async () => {
    process.env[WINDOW_ENV] = String(TEST_WINDOW);
    process.env[THRESHOLD_ENV] = String(TEST_THRESHOLD);

    await db.execute(sql`
      INSERT INTO organizations (id, name, slug)
        VALUES (${ORG_ID}, 'spec202-vel-org', 'spec202-vel-org')
        ON CONFLICT (id) DO NOTHING
    `);
    await db.execute(sql`
      INSERT INTO organizations (id, name, slug)
        VALUES (${OTHER_ORG_ID}, 'spec202-vel-org-other', 'spec202-vel-org-other')
        ON CONFLICT (id) DO NOTHING
    `);
    await db.execute(sql`
      INSERT INTO users (id, email, password_hash, name, role)
        VALUES (${USER_ID}, 'spec202-vel@test', 'x', 'Velocity Tester', 'user')
        ON CONFLICT (id) DO NOTHING
    `);

    runId = await seedRun(ORG_ID, "vel-run-primary");
    otherRunId = await seedRun(OTHER_ORG_ID, "vel-run-other-org");
  });

  afterEach(async () => {
    await db.execute(
      sql`DELETE FROM audit_log WHERE actor_user_id = ${USER_ID}`,
    );
  });

  afterAll(async () => {
    if (ORIGINAL_WINDOW === undefined) delete process.env[WINDOW_ENV];
    else process.env[WINDOW_ENV] = ORIGINAL_WINDOW;
    if (ORIGINAL_THRESHOLD === undefined) delete process.env[THRESHOLD_ENV];
    else process.env[THRESHOLD_ENV] = ORIGINAL_THRESHOLD;

    await db.execute(sql`DELETE FROM audit_log WHERE actor_user_id = ${USER_ID}`);
    await db.execute(sql`DELETE FROM factory_runs WHERE org_id = ${ORG_ID}`);
    await db.execute(sql`DELETE FROM factory_runs WHERE org_id = ${OTHER_ORG_ID}`);
    await db.execute(sql`DELETE FROM users WHERE id = ${USER_ID}`);
    await db.execute(sql`DELETE FROM organizations WHERE id = ${ORG_ID}`);
    await db.execute(sql`DELETE FROM organizations WHERE id = ${OTHER_ORG_ID}`);
  });

  it("measures the actor's in-window approvals as anomalous at the threshold", async () => {
    await seedApproval(runId, 5);
    await seedApproval(runId, 10);
    await seedApproval(runId, 15);

    const v = await measureApprovalVelocity({
      orgId: ORG_ID,
      actorId: USER_ID,
      runId,
    });
    expect(v).not.toBeNull();
    expect(v!.count).toBe(3);
    expect(v!.threshold).toBe(TEST_THRESHOLD);
    expect(v!.windowSecs).toBe(TEST_WINDOW);
    expect(v!.anomalous).toBe(true);
  });

  it("records exactly one anomaly audit row on the approve path when anomalous", async () => {
    // Represents three approvals within the window (the third being the one
    // just committed before detect fires on the approve path).
    await seedApproval(runId, 2);
    await seedApproval(runId, 4);
    await seedApproval(runId, 6);

    await detectApprovalVelocity({ orgId: ORG_ID, actorId: USER_ID, runId });

    const rows = await anomalyRows();
    expect(rows).toHaveLength(1);
    expect(rows[0].metadata).toMatchObject({
      orgId: ORG_ID,
      actorId: USER_ID,
      count: 3,
      threshold: TEST_THRESHOLD,
      windowSecs: TEST_WINDOW,
    });
  });

  it("does not record an anomaly (and reads not-anomalous) below the threshold", async () => {
    await seedApproval(runId, 5);
    await seedApproval(runId, 10);

    const v = await measureApprovalVelocity({
      orgId: ORG_ID,
      actorId: USER_ID,
      runId,
    });
    expect(v!.count).toBe(2);
    expect(v!.anomalous).toBe(false);

    await detectApprovalVelocity({ orgId: ORG_ID, actorId: USER_ID, runId });
    expect(await anomalyRows()).toHaveLength(0);
  });

  it("excludes approvals older than the window", async () => {
    await seedApproval(runId, 5); // in
    await seedApproval(runId, TEST_WINDOW + 10); // out
    await seedApproval(runId, TEST_WINDOW + 20); // out

    const v = await measureApprovalVelocity({
      orgId: ORG_ID,
      actorId: USER_ID,
      runId,
    });
    expect(v!.count).toBe(1);
    expect(v!.anomalous).toBe(false);
  });

  it("scopes to the org: another org's approvals by the same actor do not count", async () => {
    // Three approvals in the window, but all target a run in OTHER_ORG_ID.
    await seedApproval(otherRunId, 5);
    await seedApproval(otherRunId, 10);
    await seedApproval(otherRunId, 15);

    const v = await measureApprovalVelocity({
      orgId: ORG_ID,
      actorId: USER_ID,
      runId,
    });
    expect(v!.count).toBe(0);
    expect(v!.anomalous).toBe(false);

    // And the other org does see them.
    const other = await measureApprovalVelocity({
      orgId: OTHER_ORG_ID,
      actorId: USER_ID,
      runId: otherRunId,
    });
    expect(other!.count).toBe(3);
    expect(other!.anomalous).toBe(true);
  });
});
