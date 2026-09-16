// Spec 202 FR-003(c): queue-storm gate integration tests.
//
// Detection-only: the gate never blocks admission. Every case below
// asserts `reserveRunCore` still returns `reserved: true`; the only thing
// that varies is whether a `factory.run.storm_detected` audit row was
// written alongside.
//
// Fixture family: `33333333-...`. Distinct from `runsMigration.test.ts`
// (`11111111-...`) and `runs.test.ts` (`22222222-...`; that suite's own
// `FOREIGN_ORG` transiently uses a `33333333-...` literal but deletes it in
// its own `afterAll`, so there is no live collision under the
// `--fileParallelism=false` sequential run this project requires).
//
// These tests touch the live database; they are EXCLUDED from `npm test`
// (vite.config.ts) and run only under `encore test`, mirroring the
// neighbouring `runs.test.ts` / `runsMigration.test.ts` posture.

import { describe, expect, it, beforeAll, afterAll, afterEach } from "vitest";
import { sql } from "drizzle-orm";
import { db } from "../db/drizzle";
import { reserveRunCore } from "./runs";
import { maxRunsInFlight } from "./queueStormGate";
import { FACTORY_RUN_STORM_DETECTED } from "./auditActions";

const ORG_ID = "33333333-0000-0000-0000-0000000000b1";
const USER_ID = "33333333-0000-0000-0000-0000000000b2";

const ORIGIN = "queue-storm-gate-test";
const ADAPTER_NAME = "acme-vue-encore";
const PROCESS_NAME = "seven-stage-build";
const FACTORY_SHA = "c".repeat(40);

const ORG_CTX = { orgId: ORG_ID, userID: USER_ID };

const ENV_KEY = "STATECRAFT_FACTORY_MAX_RUNS_IN_FLIGHT";
const ORIGINAL_ENV = process.env[ENV_KEY];
const TEST_CEILING = 2;

/** Seed one bare `factory_runs` row for `ORG_ID` at the given status,
 *  bypassing `reserveRunCore` so the count query exercises exactly the
 *  fixture shape under test. */
async function seedRun(clientRunId: string, status: string): Promise<void> {
  await db.execute(sql`
    INSERT INTO factory_runs (org_id, triggered_by, adapter_id, process_id, client_run_id, status, source_shas)
      VALUES (${ORG_ID}, ${USER_ID}, 'synthetic-adapter-storm-test', 'synthetic-process-storm-test',
              ${clientRunId}, ${status}, '{}'::jsonb)
  `);
}

async function stormAuditRows(clientRunId: string) {
  const rows = await db.execute(sql`
    SELECT metadata FROM audit_log
      WHERE actor_user_id = ${USER_ID}
        AND action = ${FACTORY_RUN_STORM_DETECTED}
        AND metadata->>'clientRunId' = ${clientRunId}
  `);
  return rows.rows as { metadata: Record<string, unknown> }[];
}

describe("spec 202 FR-003(c): queue-storm gate", () => {
  beforeAll(async () => {
    process.env[ENV_KEY] = String(TEST_CEILING);

    await db.execute(sql`
      INSERT INTO organizations (id, name, slug)
        VALUES (${ORG_ID}, 'spec202-storm-org', 'spec202-storm-org')
        ON CONFLICT (id) DO NOTHING
    `);
    await db.execute(sql`
      INSERT INTO users (id, email, password_hash, name, role)
        VALUES (${USER_ID}, 'spec202-storm@test', 'x', 'Storm Tester', 'user')
        ON CONFLICT (id) DO NOTHING
    `);

    // Substrate seeding mirrors runs.test.ts: an admitted adapter plus
    // governance envelope so reserveRunCore reaches the INSERT rather than
    // failing precondition before the queue-storm gate's admit path.
    await db.execute(sql`
      INSERT INTO factory_upstreams (org_id, source_id, role, repo_url, ref)
        VALUES (${ORG_ID}, ${ORIGIN}, 'orchestration',
                'https://github.com/example/queue-storm-gate-test.git', 'main')
        ON CONFLICT (org_id, source_id) DO NOTHING
    `);
    await db.execute(sql`
      INSERT INTO factory_artifact_substrate
        (org_id, origin, path, kind, version, status, upstream_sha, upstream_body, content_hash, conflict_state)
      VALUES
        (${ORG_ID}, ${ORIGIN},
         'adapters/acme-vue-encore/adapter.yaml', 'adapter-manifest', 1, 'active',
         ${FACTORY_SHA},
         ${'adapter:\n  name: acme-vue-encore\n  version: "1.0.0"\n'},
         ${"4".padStart(64, "0")}, 'ok')
      ON CONFLICT (org_id, origin, path, version) DO NOTHING
    `);
    await db.execute(sql`
      INSERT INTO factory_artifact_substrate
        (org_id, origin, path, kind, version, status, upstream_sha, upstream_body, content_hash, conflict_state)
      VALUES
        (${ORG_ID}, ${ORIGIN},
         'process/governance-envelope.yaml', 'governance-envelope', 1, 'active',
         ${FACTORY_SHA},
         ${'schema_version: "1.0.0"\nprocess:\n  id: seven-stage-build\n  objective_class: scaffold\n  goal_identifier_scheme: uuid\n'},
         ${"5".padStart(64, "0")}, 'ok')
      ON CONFLICT (org_id, origin, path, version) DO NOTHING
    `);
    await db.execute(sql`
      DELETE FROM factory_admissions WHERE org_id = ${ORG_ID}::uuid AND origin = ${ORIGIN}
    `);
    const composed = JSON.stringify({
      process: null,
      adapters: {
        "acme-vue-encore": { governance: {}, manifestHash: "manifest-hash-storm-test" },
      },
      agentDigests: {},
      agentIds: {},
    });
    await db.execute(sql`
      INSERT INTO factory_admissions
        (org_id, origin, status, envelope_hash, composed, violations, scaffold_resolutions)
      VALUES
        (${ORG_ID}, ${ORIGIN}, 'admitted', ${"6".padStart(64, "0")},
         ${composed}::jsonb, '[]'::jsonb, '{}'::jsonb)
    `);
  });

  afterEach(async () => {
    // Reset per-test in-flight state so each case's count starts from zero.
    await db.execute(sql`DELETE FROM factory_runs WHERE org_id = ${ORG_ID}`);
    await db.execute(sql`DELETE FROM audit_log WHERE actor_user_id = ${USER_ID}`);
  });

  afterAll(async () => {
    if (ORIGINAL_ENV === undefined) delete process.env[ENV_KEY];
    else process.env[ENV_KEY] = ORIGINAL_ENV;

    await db.execute(sql`DELETE FROM factory_admissions WHERE org_id = ${ORG_ID}`);
    await db.execute(sql`DELETE FROM factory_artifact_substrate WHERE org_id = ${ORG_ID}`);
    await db.execute(sql`DELETE FROM factory_upstreams WHERE org_id = ${ORG_ID}`);
    await db.execute(sql`DELETE FROM organizations WHERE id = ${ORG_ID}`);
    await db.execute(sql`DELETE FROM users WHERE id = ${USER_ID}`);
  });

  it("still admits the run and records storm_detected when in-flight count is at the ceiling", async () => {
    await seedRun("storm-seed-1", "queued");
    await seedRun("storm-seed-2", "running");

    const result = await reserveRunCore(
      { adapterName: ADAPTER_NAME, processName: PROCESS_NAME, clientRunId: "storm-detect-at-ceiling" },
      ORG_CTX,
    );
    expect(result.reserved).toBe(true);

    const audits = await stormAuditRows("storm-detect-at-ceiling");
    expect(audits).toHaveLength(1);
    expect(audits[0].metadata).toMatchObject({
      orgId: ORG_ID,
      clientRunId: "storm-detect-at-ceiling",
      inFlightCount: TEST_CEILING,
      ceiling: TEST_CEILING,
    });
  });

  it("admits the run without detection when in-flight count is under the ceiling", async () => {
    await seedRun("storm-seed-3", "queued");

    const result = await reserveRunCore(
      { adapterName: ADAPTER_NAME, processName: PROCESS_NAME, clientRunId: "storm-under-ceiling" },
      ORG_CTX,
    );
    expect(result.reserved).toBe(true);

    const audits = await stormAuditRows("storm-under-ceiling");
    expect(audits).toHaveLength(0);
  });

  it("does not count terminal-status runs (ok/failed/cancelled) toward in-flight", async () => {
    await seedRun("storm-seed-ok", "ok");
    await seedRun("storm-seed-failed", "failed");
    await seedRun("storm-seed-cancelled", "cancelled");

    const result = await reserveRunCore(
      { adapterName: ADAPTER_NAME, processName: PROCESS_NAME, clientRunId: "storm-terminal-excluded" },
      ORG_CTX,
    );
    expect(result.reserved).toBe(true);

    const audits = await stormAuditRows("storm-terminal-excluded");
    expect(audits).toHaveLength(0);
  });
});

describe("spec 202 FR-003(c): maxRunsInFlight()", () => {
  afterEach(() => {
    if (ORIGINAL_ENV === undefined) delete process.env[ENV_KEY];
    else process.env[ENV_KEY] = ORIGINAL_ENV;
  });

  it("falls back to the platform default (25) when unset", () => {
    delete process.env[ENV_KEY];
    expect(maxRunsInFlight()).toBe(25);
  });

  it("honours a valid override", () => {
    process.env[ENV_KEY] = "7";
    expect(maxRunsInFlight()).toBe(7);
  });

  it("falls back to the default on a non-numeric override", () => {
    process.env[ENV_KEY] = "not-a-number";
    expect(maxRunsInFlight()).toBe(25);
  });
});
