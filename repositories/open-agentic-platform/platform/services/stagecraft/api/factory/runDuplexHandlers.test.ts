// Spec 124 §6 / T036 — duplex handler integration tests for factory.run.*
//
// Covers the contract from the spec / tasks file:
//   * in-order delivery: stage_started → stage_completed → completed
//   * out-of-order delivery: stage_completed BEFORE stage_started, handler
//     synthesises the entry rather than rejects (T032)
//   * duplicate-event idempotency on (run_id, stage_id, status)
//   * foreign-org reject (org_mismatch, no row mutation)
//   * envelope-version mismatch reject (`meta.v: 0` rejected by
//     `isClientEnvelope` before any handler runs — invalid)
//   * terminal events emit the corresponding audit row
//
// adapter_id / process_id are plain TEXT since migration 38 (FK dropped by
// migration 34); no factory_adapters / factory_processes rows are seeded.
// agent_catalog was dropped by migration 35; agentRef in stage events
// carries a literal id string — no catalog row required for duplex handlers.
//
// Excluded from `npm test` and run only under `encore test` — same posture
// as runs.test.ts and runsMigration.test.ts (the live DB is required).

import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { sql, eq } from "drizzle-orm";
import { db } from "../db/drizzle";
import {
  factoryRuns,
  auditLog,
  type FactoryRunStageProgressEntry,
} from "../db/schema";
import {
  handleStageStarted,
  handleStageCompleted,
  handleRunCompleted,
  handleRunFailed,
  handleRunCancelled,
} from "./runDuplexHandlers";
import { handleInbound } from "../sync/service";
import {
  FACTORY_RUN_COMPLETED,
  FACTORY_RUN_FAILED,
  FACTORY_RUN_CANCELLED,
} from "./auditActions";

// Distinct fixture namespace — keeps these tests independent of
// runsMigration.test.ts (1xxx prefix) and runs.test.ts (2xxx prefix).
const ORG_ID = "44444444-0000-0000-0000-0000000000a1";
const FOREIGN_ORG = "44444444-0000-0000-0000-0000000000a2";
const USER_ID = "44444444-0000-0000-0000-0000000000a3";
const PROJECT_ID = "44444444-0000-0000-0000-0000000000a4";

// Synthetic TEXT ids — migration 34 dropped factory_adapters / factory_processes;
// migration 38 widened adapter_id / process_id to TEXT.
const ADAPTER_ID = "synthetic-adapter-44444444-spec124-dx";
const PROCESS_ID = "synthetic-process-44444444-spec124-dx-v1";

// A literal agent id used in agentRef fields. agent_catalog was dropped by
// migration 35; duplex handlers store the ref as-is without a catalog lookup.
const AGENT_ID = "44444444-0000-0000-0000-0000000000a7";

const CTX = { orgId: ORG_ID, userId: USER_ID };
const FOREIGN_CTX = { orgId: FOREIGN_ORG, userId: USER_ID };

const META = (eventId: string) => ({
  v: 2 as const,
  eventId,
  sentAt: "2026-05-01T12:00:00Z",
});

async function seedRun(
  runId: string,
  clientRunId: string,
  status: "queued" | "running" = "queued",
): Promise<void> {
  await db.execute(sql`
    INSERT INTO factory_runs (
      id, org_id, project_id, triggered_by, adapter_id, process_id,
      client_run_id, status, source_shas
    ) VALUES (
      ${runId}, ${ORG_ID}, ${PROJECT_ID}, ${USER_ID}, ${ADAPTER_ID}, ${PROCESS_ID},
      ${clientRunId}, ${status},
      '{"adapter":"ada-sha-dx","process":"proc-sha-dx","contracts":{},"agents":[]}'::jsonb
    )
  `);
}

async function seedForeignRun(runId: string, clientRunId: string): Promise<void> {
  await db.execute(sql`
    INSERT INTO factory_runs (
      id, org_id, triggered_by, adapter_id, process_id,
      client_run_id, status, source_shas
    ) VALUES (
      ${runId}, ${FOREIGN_ORG}, ${USER_ID}, ${ADAPTER_ID}, ${PROCESS_ID},
      ${clientRunId}, 'queued',
      '{"adapter":"ada-sha-dx","process":"proc-sha-dx","contracts":{},"agents":[]}'::jsonb
    )
  `);
}

async function getRow(runId: string) {
  const [row] = await db
    .select()
    .from(factoryRuns)
    .where(eq(factoryRuns.id, runId))
    .limit(1);
  return row;
}

describe("spec 124 §6 — factory.run.* duplex handlers", () => {
  beforeAll(async () => {
    await db.execute(sql`
      INSERT INTO organizations (id, name, slug)
        VALUES (${ORG_ID}, 'spec124-dx-org', 'spec124-dx-org')
        ON CONFLICT (id) DO NOTHING
    `);
    // Foreign org for the cross-org rejection tests.
    await db.execute(sql`
      INSERT INTO organizations (id, name, slug)
        VALUES (${FOREIGN_ORG}, 'spec124-dx-foreign', 'spec124-dx-foreign')
        ON CONFLICT (id) DO NOTHING
    `);
    await db.execute(sql`
      INSERT INTO users (id, email, password_hash, name, role)
        VALUES (${USER_ID}, 'spec124-dx@test', 'x', 'DX Tester', 'user')
        ON CONFLICT (id) DO NOTHING
    `);
    await db.execute(sql`
      INSERT INTO projects (id, org_id, name, slug, description, object_store_bucket, created_by)
        VALUES (${PROJECT_ID}, ${ORG_ID}, 'spec124-dx-p', 'spec124-dx-p', '', 'bucket-spec124-dx', ${USER_ID})
        ON CONFLICT (id) DO NOTHING
    `);
  });

  afterAll(async () => {
    await db.execute(sql`DELETE FROM factory_runs WHERE org_id IN (${ORG_ID}, ${FOREIGN_ORG})`);
    await db.execute(sql`DELETE FROM audit_log WHERE target_type = 'factory_runs' AND metadata->>'orgId' IN (${ORG_ID}, ${FOREIGN_ORG})`);
    await db.execute(sql`DELETE FROM projects WHERE id = ${PROJECT_ID}`);
    await db.execute(sql`DELETE FROM users WHERE id = ${USER_ID}`);
    await db.execute(sql`DELETE FROM organizations WHERE id IN (${ORG_ID}, ${FOREIGN_ORG})`);
  });

  it("in-order: stage_started flips queued → running and appends progress", async () => {
    const runId = "44444444-0000-0000-0000-0000000000b1";
    await seedRun(runId, "dx-in-order-1", "queued");

    const result = await handleStageStarted(
      {
        kind: "factory.run.stage_started",
        meta: META("ev-1"),
        runId,
        stageId: "s0",
        agentRef: { orgAgentId: AGENT_ID, version: 1, contentHash: "dx-hash-1" },
        startedAt: "2026-05-01T12:00:00Z",
      },
      CTX,
    );
    expect(result).toEqual({ ok: true });

    const row = await getRow(runId);
    expect(row.status).toBe("running");
    expect(row.stageProgress).toHaveLength(1);
    const entry = row.stageProgress[0] as FactoryRunStageProgressEntry;
    expect(entry.stage_id).toBe("s0");
    expect(entry.status).toBe("running");
    expect(entry.agent_ref).toEqual({
      org_agent_id: AGENT_ID,
      version: 1,
      content_hash: "dx-hash-1",
    });
  });

  it("in-order: stage_completed updates the matching entry's status and completedAt", async () => {
    const runId = "44444444-0000-0000-0000-0000000000b2";
    await seedRun(runId, "dx-in-order-2", "queued");
    await handleStageStarted(
      {
        kind: "factory.run.stage_started",
        meta: META("ev-2a"),
        runId,
        stageId: "s0",
        agentRef: { orgAgentId: AGENT_ID, version: 1, contentHash: "dx-hash-1" },
        startedAt: "2026-05-01T12:00:00Z",
      },
      CTX,
    );

    const result = await handleStageCompleted(
      {
        kind: "factory.run.stage_completed",
        meta: META("ev-2b"),
        runId,
        stageId: "s0",
        stageOutcome: "ok",
        completedAt: "2026-05-01T12:01:00Z",
      },
      CTX,
    );
    expect(result).toEqual({ ok: true });

    const row = await getRow(runId);
    expect(row.stageProgress).toHaveLength(1);
    const entry = row.stageProgress[0] as FactoryRunStageProgressEntry;
    expect(entry.status).toBe("ok");
    expect(entry.completed_at).toBe("2026-05-01T12:01:00Z");
  });

  it("out-of-order: stage_completed without prior stage_started synthesises an entry (T032)", async () => {
    const runId = "44444444-0000-0000-0000-0000000000b3";
    await seedRun(runId, "dx-ooo-1", "queued");

    const result = await handleStageCompleted(
      {
        kind: "factory.run.stage_completed",
        meta: META("ev-3"),
        runId,
        stageId: "s1",
        stageOutcome: "ok",
        completedAt: "2026-05-01T12:01:30Z",
      },
      CTX,
    );
    expect(result).toEqual({ ok: true });

    const row = await getRow(runId);
    expect(row.stageProgress).toHaveLength(1);
    const entry = row.stageProgress[0] as FactoryRunStageProgressEntry;
    expect(entry.stage_id).toBe("s1");
    expect(entry.status).toBe("ok");
    // Synthesised: started_at falls back to completed_at.
    expect(entry.started_at).toBe("2026-05-01T12:01:30Z");
    expect(entry.completed_at).toBe("2026-05-01T12:01:30Z");
  });

  it("idempotent: duplicate stage_started for the same (run, stage) is a no-op", async () => {
    const runId = "44444444-0000-0000-0000-0000000000b4";
    await seedRun(runId, "dx-idempotent-1", "queued");
    const evt = {
      kind: "factory.run.stage_started" as const,
      meta: META("ev-dup-1"),
      runId,
      stageId: "s0",
      agentRef: { orgAgentId: AGENT_ID, version: 1, contentHash: "dx-hash-1" },
      startedAt: "2026-05-01T12:00:00Z",
    };
    await handleStageStarted(evt, CTX);
    await handleStageStarted({ ...evt, meta: META("ev-dup-2") }, CTX);
    await handleStageStarted({ ...evt, meta: META("ev-dup-3") }, CTX);

    const row = await getRow(runId);
    expect(row.stageProgress).toHaveLength(1);
  });

  it("idempotent: duplicate stage_completed (same terminal status) is a no-op", async () => {
    const runId = "44444444-0000-0000-0000-0000000000b5";
    await seedRun(runId, "dx-idempotent-2", "queued");
    await handleStageStarted(
      {
        kind: "factory.run.stage_started",
        meta: META("ev-id2-a"),
        runId,
        stageId: "s0",
        agentRef: { orgAgentId: AGENT_ID, version: 1, contentHash: "dx-hash-1" },
        startedAt: "2026-05-01T12:00:00Z",
      },
      CTX,
    );
    const evt = {
      kind: "factory.run.stage_completed" as const,
      meta: META("ev-id2-b"),
      runId,
      stageId: "s0",
      stageOutcome: "ok" as const,
      completedAt: "2026-05-01T12:01:00Z",
    };
    await handleStageCompleted(evt, CTX);
    await handleStageCompleted({ ...evt, meta: META("ev-id2-c") }, CTX);

    const row = await getRow(runId);
    expect(row.stageProgress).toHaveLength(1);
    expect(
      (row.stageProgress[0] as FactoryRunStageProgressEntry).status,
    ).toBe("ok");
  });

  it("foreign-org event is rejected with org_mismatch and does not mutate the row", async () => {
    const runId = "44444444-0000-0000-0000-0000000000b6";
    await seedRun(runId, "dx-foreign-1", "queued");

    const result = await handleStageStarted(
      {
        kind: "factory.run.stage_started",
        meta: META("ev-foreign-1"),
        runId,
        stageId: "s0",
        agentRef: { orgAgentId: AGENT_ID, version: 1, contentHash: "dx-hash-1" },
        startedAt: "2026-05-01T12:00:00Z",
      },
      FOREIGN_CTX,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("org_mismatch");
    }

    const row = await getRow(runId);
    expect(row.status).toBe("queued");
    expect(row.stageProgress).toHaveLength(0);
  });

  it("foreign-org rejects on a row that lives in the other org too", async () => {
    // Sanity: a run in the foreign org cannot be touched by the home org.
    const runId = "44444444-0000-0000-0000-0000000000b7";
    await seedForeignRun(runId, "dx-foreign-2");

    const result = await handleStageStarted(
      {
        kind: "factory.run.stage_started",
        meta: META("ev-foreign-2"),
        runId,
        stageId: "s0",
        agentRef: { orgAgentId: AGENT_ID, version: 1, contentHash: "dx-hash-1" },
        startedAt: "2026-05-01T12:00:00Z",
      },
      CTX, // home-org context, foreign-org row
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("org_mismatch");
    }
    const row = await getRow(runId);
    expect(row.stageProgress).toHaveLength(0);
  });

  it("terminal: factory.run.completed sets ok + tokenSpend + audit row", async () => {
    const runId = "44444444-0000-0000-0000-0000000000b8";
    await seedRun(runId, "dx-completed-1", "running");
    const evt = {
      kind: "factory.run.completed" as const,
      meta: META("ev-completed-1"),
      runId,
      tokenSpend: { input: 100, output: 200, total: 300 },
      completedAt: "2026-05-01T12:30:00Z",
    };
    const result = await handleRunCompleted(evt, CTX);
    expect(result).toEqual({ ok: true });

    const row = await getRow(runId);
    expect(row.status).toBe("ok");
    expect(row.completedAt).toBeInstanceOf(Date);
    expect(row.tokenSpend).toEqual({ input: 100, output: 200, total: 300 });

    const audits = await db.execute(sql`
      SELECT count(*) AS c FROM audit_log
       WHERE target_type = 'factory_runs'
         AND target_id = ${runId}
         AND action = ${FACTORY_RUN_COMPLETED}
    `);
    expect(Number((audits.rows[0] as { c: string | number }).c)).toBe(1);

    // Idempotent re-delivery: same payload again → no second audit row.
    await handleRunCompleted(evt, CTX);
    const audits2 = await db.execute(sql`
      SELECT count(*) AS c FROM audit_log
       WHERE target_type = 'factory_runs'
         AND target_id = ${runId}
         AND action = ${FACTORY_RUN_COMPLETED}
    `);
    expect(Number((audits2.rows[0] as { c: string | number }).c)).toBe(1);
  });

  it("terminal: factory.run.failed sets failed + error + preserves stage_progress", async () => {
    const runId = "44444444-0000-0000-0000-0000000000b9";
    await seedRun(runId, "dx-failed-1", "running");
    // Seed partial stage progress.
    await handleStageStarted(
      {
        kind: "factory.run.stage_started",
        meta: META("ev-failed-pre"),
        runId,
        stageId: "s0",
        agentRef: { orgAgentId: AGENT_ID, version: 1, contentHash: "dx-hash-1" },
        startedAt: "2026-05-01T12:00:00Z",
      },
      CTX,
    );

    const result = await handleRunFailed(
      {
        kind: "factory.run.failed",
        meta: META("ev-failed-1"),
        runId,
        error: "boom",
        completedAt: "2026-05-01T12:05:00Z",
      },
      CTX,
    );
    expect(result).toEqual({ ok: true });

    const row = await getRow(runId);
    expect(row.status).toBe("failed");
    expect(row.error).toBe("boom");
    expect(row.stageProgress).toHaveLength(1);

    const audits = await db.execute(sql`
      SELECT count(*) AS c FROM audit_log
       WHERE target_type = 'factory_runs'
         AND target_id = ${runId}
         AND action = ${FACTORY_RUN_FAILED}
    `);
    expect(Number((audits.rows[0] as { c: string | number }).c)).toBe(1);
  });

  it("terminal: factory.run.cancelled sets cancelled, leaves error null, audits", async () => {
    const runId = "44444444-0000-0000-0000-0000000000ba";
    await seedRun(runId, "dx-cancelled-1", "running");
    const result = await handleRunCancelled(
      {
        kind: "factory.run.cancelled",
        meta: META("ev-cancel-1"),
        runId,
        reason: "user-aborted",
        completedAt: "2026-05-01T12:10:00Z",
      },
      CTX,
    );
    expect(result).toEqual({ ok: true });

    const row = await getRow(runId);
    expect(row.status).toBe("cancelled");
    expect(row.error).toBeNull();

    const audits = await db.execute(sql`
      SELECT count(*) AS c FROM audit_log
       WHERE target_type = 'factory_runs'
         AND target_id = ${runId}
         AND action = ${FACTORY_RUN_CANCELLED}
    `);
    expect(Number((audits.rows[0] as { c: string | number }).c)).toBe(1);
  });

  it("v=0 envelope is rejected by handleInbound before any handler runs (envelope-version mismatch)", async () => {
    // The wire-level meta.v is checked by `isClientEnvelope`; a non-2 value
    // never reaches the runDispatch path.
    const result = await handleInbound(
      { orgId: ORG_ID, clientId: "test-c", userId: USER_ID },
      {
        kind: "factory.run.stage_started",
        meta: { v: 0, eventId: "bad", sentAt: "2026-05-01T12:00:00Z" },
        runId: "44444444-0000-0000-0000-0000000000bb",
        stageId: "s0",
        agentRef: { orgAgentId: AGENT_ID, version: 1, contentHash: "dx-hash-1" },
        startedAt: "2026-05-01T12:00:00Z",
      },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("invalid");
    }
  });

  it("invalid runId on a stage_started returns invalid (no DB write)", async () => {
    const before = await db.execute(
      sql`SELECT count(*) AS c FROM factory_runs WHERE org_id = ${ORG_ID}`,
    );
    const beforeCount = Number((before.rows[0] as { c: string | number }).c);

    const result = await handleStageStarted(
      {
        kind: "factory.run.stage_started",
        meta: META("ev-invalid-1"),
        // Random runId that does not exist in the DB.
        runId: "44444444-0000-0000-0000-0000000000ff",
        stageId: "s0",
        agentRef: { orgAgentId: AGENT_ID, version: 1, contentHash: "dx-hash-1" },
        startedAt: "2026-05-01T12:00:00Z",
      },
      CTX,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("invalid");
    }

    const after = await db.execute(
      sql`SELECT count(*) AS c FROM factory_runs WHERE org_id = ${ORG_ID}`,
    );
    expect(Number((after.rows[0] as { c: string | number }).c)).toBe(
      beforeCount,
    );
  });
});
