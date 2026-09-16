// Spec 124 §6 / T062 — `factory_runs` staleness sweeper integration tests.
//
// Drives `sweepStaleFactoryRuns()` against a real Postgres so the FK on
// `audit_log.actor_user_id → users(id)` and the closed status set on
// `factory_runs.status` are exercised end-to-end. Excluded from
// `npm test` (vite.config.ts) and runs only under `encore test`.
//
// Coverage matches the bullets in tasks.md:
//   * stale `running` row gets swept (row → failed, audit row emitted)
//   * stale `queued` row also gets swept (the desktop never followed
//     through with the first stage_started)
//   * fresh `running` row is NOT swept
//   * terminal rows (ok / failed / cancelled) are never touched
//   * env knob honoured: a small STATECRAFT_FACTORY_RUN_STALE_AFTER_SEC
//     value sweeps a row that would otherwise be young
//
// adapter_id / process_id are plain TEXT since migration 38 (dropped FK
// from migration 34); no factory_adapters / factory_processes rows needed.

import { describe, expect, it, beforeAll, afterAll, beforeEach } from "vitest";
import { sql } from "drizzle-orm";
import { db } from "../db/drizzle";
import { sweepStaleFactoryRuns } from "./runsScheduler";
import { FACTORY_RUN_SWEPT } from "./auditActions";

const ORG_ID = "55555555-0000-0000-0000-0000000000a1";
const USER_ID = "55555555-0000-0000-0000-0000000000a2";
const PROJECT_ID = "55555555-0000-0000-0000-0000000000a3";

// Synthetic TEXT ids — no FK target rows required after migration 34/38.
const ADAPTER_ID = "synthetic-adapter-55555555-spec124-sweep";
const PROCESS_ID = "synthetic-process-55555555-spec124-sweep-v1";

const SYSTEM_USER_ID = "00000000-0000-0000-0000-000000000000";

async function seedRun(opts: {
  id: string;
  clientRunId: string;
  status: "queued" | "running" | "ok" | "failed" | "cancelled";
  /** Set `last_event_at` to (now - ageSec). Use 0 for "fresh". */
  ageSec: number;
}): Promise<void> {
  await db.execute(sql`
    INSERT INTO factory_runs (
      id, org_id, project_id, triggered_by, adapter_id, process_id,
      client_run_id, status, source_shas, last_event_at, started_at
    ) VALUES (
      ${opts.id}, ${ORG_ID}, ${PROJECT_ID}, ${USER_ID}, ${ADAPTER_ID}, ${PROCESS_ID},
      ${opts.clientRunId}, ${opts.status},
      '{"adapter":"a","process":"p","contracts":{},"agents":[]}'::jsonb,
      now() - (${opts.ageSec} || ' seconds')::interval,
      now() - (${opts.ageSec} || ' seconds')::interval
    )
  `);
}

async function getStatus(id: string): Promise<{
  status: string;
  error: string | null;
  completedAt: Date | null;
}> {
  const rows = await db.execute(sql`
    SELECT status, error, completed_at FROM factory_runs WHERE id = ${id}
  `);
  const r = rows.rows[0] as { status: string; error: string | null; completed_at: Date | null };
  return {
    status: r.status,
    error: r.error,
    completedAt: r.completed_at,
  };
}

async function countSweepAudits(targetId: string): Promise<number> {
  const rows = await db.execute(sql`
    SELECT count(*) AS c FROM audit_log
     WHERE target_type = 'factory_runs'
       AND target_id = ${targetId}
       AND action = ${FACTORY_RUN_SWEPT}
  `);
  return Number((rows.rows[0] as { c: string | number }).c);
}

describe("spec 124 — sweepStaleFactoryRuns", () => {
  beforeAll(async () => {
    await db.execute(sql`
      INSERT INTO organizations (id, name, slug)
        VALUES (${ORG_ID}, 'spec124-sweep-org', 'spec124-sweep-org')
        ON CONFLICT (id) DO NOTHING
    `);
    await db.execute(sql`
      INSERT INTO users (id, email, password_hash, name, role)
        VALUES (${USER_ID}, 'spec124-sweep@test', 'x', 'Sweep Tester', 'user')
        ON CONFLICT (id) DO NOTHING
    `);
    // System user must exist — the seed migration normally takes care
    // of this, but assert here so a missing seed surfaces with a clear
    // error rather than an opaque FK violation later.
    await db.execute(sql`
      INSERT INTO users (id, email, password_hash, name, role)
        VALUES (${SYSTEM_USER_ID}, 'system@opc.local', '!disabled', 'system', 'admin')
        ON CONFLICT (id) DO NOTHING
    `);
    await db.execute(sql`
      INSERT INTO projects (id, org_id, name, slug, description, object_store_bucket, created_by)
        VALUES (${PROJECT_ID}, ${ORG_ID}, 'spec124-sweep-p', 'spec124-sweep-p', '', 'bucket-sweep', ${USER_ID})
        ON CONFLICT (id) DO NOTHING
    `);
  });

  afterAll(async () => {
    // Cleanup in dependency order; no factory_adapters / factory_processes
    // rows were seeded (migration 34 dropped those tables).
    await db.execute(sql`DELETE FROM audit_log WHERE action = ${FACTORY_RUN_SWEPT} AND metadata->>'orgId' = ${ORG_ID}`);
    await db.execute(sql`DELETE FROM factory_runs WHERE org_id = ${ORG_ID}`);
    await db.execute(sql`DELETE FROM projects WHERE id = ${PROJECT_ID}`);
    await db.execute(sql`DELETE FROM users WHERE id = ${USER_ID}`);
    await db.execute(sql`DELETE FROM organizations WHERE id = ${ORG_ID}`);
    delete process.env.statecraft_FACTORY_RUN_STALE_AFTER_SEC;
  });

  beforeEach(async () => {
    // Wipe runs before each test so the prior test's seeds don't leak
    // into the SELECT result. Audit rows persist across tests; the
    // assertions key on target_id so cross-test interference is moot.
    await db.execute(sql`DELETE FROM factory_runs WHERE org_id = ${ORG_ID}`);
    delete process.env.statecraft_FACTORY_RUN_STALE_AFTER_SEC;
  });

  it("sweeps a stale `running` row and emits a factory.run.swept audit", async () => {
    process.env.statecraft_FACTORY_RUN_STALE_AFTER_SEC = "60";
    const id = "55555555-0000-0000-0000-0000000000b1";
    await seedRun({
      id,
      clientRunId: "sweep-running-1",
      status: "running",
      ageSec: 600,  // 10 minutes — well past the 60s test cutoff
    });

    const result = await sweepStaleFactoryRuns();
    expect(result.ids).toContain(id);

    const after = await getStatus(id);
    expect(after.status).toBe("failed");
    expect(after.error).toMatch(/sweeper: no events for/);
    expect(after.completedAt).not.toBeNull();

    const audits = await countSweepAudits(id);
    expect(audits).toBe(1);
  });

  it("also sweeps a stale `queued` row (desktop never started a stage)", async () => {
    process.env.statecraft_FACTORY_RUN_STALE_AFTER_SEC = "60";
    const id = "55555555-0000-0000-0000-0000000000b2";
    await seedRun({
      id,
      clientRunId: "sweep-queued-1",
      status: "queued",
      ageSec: 600,
    });

    const result = await sweepStaleFactoryRuns();
    expect(result.ids).toContain(id);

    const after = await getStatus(id);
    expect(after.status).toBe("failed");
  });

  it("leaves a fresh `running` row alone", async () => {
    process.env.statecraft_FACTORY_RUN_STALE_AFTER_SEC = "60";
    const id = "55555555-0000-0000-0000-0000000000b3";
    await seedRun({
      id,
      clientRunId: "sweep-fresh-1",
      status: "running",
      ageSec: 5,  // five seconds — well within the 60s window
    });

    const result = await sweepStaleFactoryRuns();
    expect(result.ids).not.toContain(id);

    const after = await getStatus(id);
    expect(after.status).toBe("running");
  });

  it("never touches terminal rows (ok / failed / cancelled)", async () => {
    process.env.statecraft_FACTORY_RUN_STALE_AFTER_SEC = "60";
    const okId = "55555555-0000-0000-0000-0000000000b4";
    const failedId = "55555555-0000-0000-0000-0000000000b5";
    const cancelledId = "55555555-0000-0000-0000-0000000000b6";
    await seedRun({ id: okId, clientRunId: "sweep-ok", status: "ok", ageSec: 600 });
    await seedRun({ id: failedId, clientRunId: "sweep-failed", status: "failed", ageSec: 600 });
    await seedRun({
      id: cancelledId,
      clientRunId: "sweep-cancelled",
      status: "cancelled",
      ageSec: 600,
    });

    const result = await sweepStaleFactoryRuns();
    expect(result.ids).not.toContain(okId);
    expect(result.ids).not.toContain(failedId);
    expect(result.ids).not.toContain(cancelledId);
  });

  it("honours STATECRAFT_FACTORY_RUN_STALE_AFTER_SEC override", async () => {
    // Use a 5s window so an age-10s row qualifies as stale despite being
    // far below the 30-min default.
    process.env.statecraft_FACTORY_RUN_STALE_AFTER_SEC = "5";
    const id = "55555555-0000-0000-0000-0000000000b7";
    await seedRun({
      id,
      clientRunId: "sweep-env-1",
      status: "running",
      ageSec: 10,
    });

    const result = await sweepStaleFactoryRuns();
    expect(result.ids).toContain(id);
  });

  it("default 30-minute window: a 10-minute-old row is NOT swept", async () => {
    // No env override.
    const id = "55555555-0000-0000-0000-0000000000b8";
    await seedRun({
      id,
      clientRunId: "sweep-default-1",
      status: "running",
      ageSec: 10 * 60,  // ten minutes — under the 30-minute default
    });

    const result = await sweepStaleFactoryRuns();
    expect(result.ids).not.toContain(id);
    const after = await getStatus(id);
    expect(after.status).toBe("running");
  });

  it("a second sweep over an already-swept run is idempotent (no second audit)", async () => {
    process.env.statecraft_FACTORY_RUN_STALE_AFTER_SEC = "60";
    const id = "55555555-0000-0000-0000-0000000000b9";
    await seedRun({
      id,
      clientRunId: "sweep-twice-1",
      status: "running",
      ageSec: 600,
    });

    await sweepStaleFactoryRuns();
    expect(await countSweepAudits(id)).toBe(1);

    // The row is now in `failed` status — a second sweep ignores it.
    const second = await sweepStaleFactoryRuns();
    expect(second.ids).not.toContain(id);
    expect(await countSweepAudits(id)).toBe(1);
  });
});
