// Spec 124 §4 / T021 + T023 — `/api/factory/runs` integration tests.
//
// Covers the canonical reservation cases plus list/detail behaviour:
//   * happy-path reservation populates a row with correct source_shas
//   * idempotent replay with the same `clientRunId` returns the existing
//     row (and a hot loop produces exactly one row)
//   * foreign-org GETs are 404
//   * list pagination + filters return the expected slice
//
// Spec 199 cutover (2026-06-12): factory_adapters / factory_processes /
// agent_catalog / project_agent_bindings are all dropped (migrations 34/35).
// Adapters resolve via loadSubstrateForOrg + findAdapterView from
// factory_artifact_substrate; the process comes from findEnvelopeProcess;
// admission is gated on factory_admissions (spec 198). The substrate seeding
// idiom follows grantDuplexHandlers.test.ts / approvalSummaryEndpoint.test.ts.
//
// Two tests from the previous version of this suite were retired:
//   "rejects reservation when binding points at retired catalog row" —
//       reserveRunCore now builds process.definition as { byKind: ... } from
//       substrate rows (spec 199 FR-004); walkForAgentRefs finds zero embedded
//       AgentReference tokens so resolveProcessAgentRefs always returns [].
//       Factory bindings no longer participate in the reservation path through
//       this surface. The retired-agent contract is still live in
//       runAgentRefs.ts::resolveProcessAgentRefs and is tested directly in
//       that module's own integration suite.
//   "two projects bound to same agent record identical source_shas.agents" —
//       same reason: agents[] is always [] at reservation time under spec 199.
//       The spec 122 Stage CD comparator contract is exercised at the engine
//       layer (crates/factory-engine).
//
// These tests touch the live database; they are EXCLUDED from `npm test`
// (vite.config.ts) and run only under `encore test`. See the
// `runsMigration.test.ts` neighbour for the same exclusion mechanic.

import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { sql } from "drizzle-orm";
import { db } from "../db/drizzle";
import { reserveRunCore, listRunsCore, getRunCore } from "./runs";
import { APIError } from "encore.dev/api";

// Per-test fixture ids. Distinct from the runsMigration.test.ts fixtures
// to avoid cross-test seeding collisions when both run under one invocation.
const ORG_ID = "22222222-0000-0000-0000-0000000000a1";
const USER_ID = "22222222-0000-0000-0000-0000000000a2";
const PROJECT_ID = "22222222-0000-0000-0000-0000000000a3";
const FOREIGN_ORG = "33333333-0000-0000-0000-0000000000a1";

// Substrate-derived identity (spec 199): the origin that factory_upstreams
// points at, the adapter name the manifest declares, and the process id the
// governance envelope declares.
const ORIGIN = "factory-runs-test";
const ADAPTER_NAME = "acme-vue-encore";
const PROCESS_NAME = "seven-stage-build";
const FACTORY_SHA = "a".repeat(40);

// The reservation/list/detail Core functions take auth explicitly so the
// integration test does not need to wire the `~encore/auth` runtime.
// The thin api() wrappers in `runs.ts` are exercised end-to-end by the
// desktop integration test in spec 124 Phase 5.
const ORG_CTX = { orgId: ORG_ID, userID: USER_ID };
const FOREIGN_CTX = { orgId: FOREIGN_ORG, userID: USER_ID };

describe("spec 124 — /api/factory/runs", () => {
  beforeAll(async () => {
    await db.execute(sql`
      INSERT INTO organizations (id, name, slug)
        VALUES (${ORG_ID}, 'spec124-runs-org', 'spec124-runs-org')
        ON CONFLICT (id) DO NOTHING
    `);
    await db.execute(sql`
      INSERT INTO organizations (id, name, slug)
        VALUES (${FOREIGN_ORG}, 'spec124-foreign-org', 'spec124-foreign-org')
        ON CONFLICT (id) DO NOTHING
    `);
    await db.execute(sql`
      INSERT INTO users (id, email, password_hash, name, role)
        VALUES (${USER_ID}, 'spec124-runs@test', 'x', 'Runs Tester', 'user')
        ON CONFLICT (id) DO NOTHING
    `);
    await db.execute(sql`
      INSERT INTO projects (id, org_id, name, slug, description, object_store_bucket, created_by)
        VALUES (${PROJECT_ID}, ${ORG_ID}, 'spec124-rp', 'spec124-rp', '', 'bucket-spec124-runs', ${USER_ID})
        ON CONFLICT (id) DO NOTHING
    `);

    // Spec 199 seeding: factory_upstreams row so resolveOriginsForOrg picks
    // up the factory origin id.
    await db.execute(sql`
      INSERT INTO factory_upstreams (org_id, source_id, role, repo_url, ref)
        VALUES (${ORG_ID}, ${ORIGIN}, 'orchestration',
                'https://github.com/example/factory-runs-test.git', 'main')
        ON CONFLICT (org_id, source_id) DO NOTHING
    `);

    // Adapter manifest row — findAdapterView resolves adapter.name from the
    // parsed upstream_body YAML.
    await db.execute(sql`
      INSERT INTO factory_artifact_substrate
        (org_id, origin, path, kind, version, status, upstream_sha, upstream_body, content_hash, conflict_state)
      VALUES
        (${ORG_ID}, ${ORIGIN},
         'adapters/acme-vue-encore/adapter.yaml', 'adapter-manifest', 1, 'active',
         ${FACTORY_SHA},
         ${'adapter:\n  name: acme-vue-encore\n  version: "1.0.0"\n'},
         ${"1".padStart(64, "0")}, 'ok')
      ON CONFLICT (org_id, origin, path, version) DO NOTHING
    `);

    // Governance envelope row — findEnvelopeProcess reads process.id from
    // the parsed upstream_body YAML.
    await db.execute(sql`
      INSERT INTO factory_artifact_substrate
        (org_id, origin, path, kind, version, status, upstream_sha, upstream_body, content_hash, conflict_state)
      VALUES
        (${ORG_ID}, ${ORIGIN},
         'process/governance-envelope.yaml', 'governance-envelope', 1, 'active',
         ${FACTORY_SHA},
         ${'schema_version: "1.0.0"\nprocess:\n  id: seven-stage-build\n  objective_class: scaffold\n  goal_identifier_scheme: uuid\n'},
         ${"2".padStart(64, "0")}, 'ok')
      ON CONFLICT (org_id, origin, path, version) DO NOTHING
    `);

    // Admission record — isFactoryAdmitted checks for the latest row for
    // (orgId, origin). factory_admissions has no unique constraint so the
    // idempotent pattern is delete-then-insert (matches overrideTrustClass.test.ts).
    await db.execute(sql`
      DELETE FROM factory_admissions WHERE org_id = ${ORG_ID}::uuid AND origin = ${ORIGIN}
    `);
    const composed = JSON.stringify({
      process: null,
      adapters: {
        "acme-vue-encore": { governance: {}, manifestHash: "manifest-hash-runs-test" },
      },
      agentDigests: {},
      agentIds: {},
    });
    await db.execute(sql`
      INSERT INTO factory_admissions
        (org_id, origin, status, envelope_hash, composed, violations, scaffold_resolutions)
      VALUES
        (${ORG_ID}, ${ORIGIN}, 'admitted', ${"3".padStart(64, "0")},
         ${composed}::jsonb, '[]'::jsonb, '{}'::jsonb)
    `);
  });

  afterAll(async () => {
    // Cleanup in dependency order.
    await db.execute(sql`DELETE FROM factory_runs WHERE org_id IN (${ORG_ID}, ${FOREIGN_ORG})`);
    await db.execute(sql`DELETE FROM audit_log WHERE actor_user_id = ${USER_ID}`);
    await db.execute(sql`DELETE FROM factory_admissions WHERE org_id = ${ORG_ID}`);
    await db.execute(sql`DELETE FROM factory_artifact_substrate WHERE org_id = ${ORG_ID}`);
    await db.execute(sql`DELETE FROM factory_upstreams WHERE org_id = ${ORG_ID}`);
    await db.execute(sql`DELETE FROM projects WHERE id = ${PROJECT_ID}`);
    await db.execute(sql`DELETE FROM organizations WHERE id IN (${ORG_ID}, ${FOREIGN_ORG})`);
    await db.execute(sql`DELETE FROM users WHERE id = ${USER_ID}`);
  });

  it("reserves a new run, populates source_shas, returns reserved=true", async () => {
    const result = await reserveRunCore(
      {
        adapterName: ADAPTER_NAME,
        processName: PROCESS_NAME,
        projectId: PROJECT_ID,
        clientRunId: "happy-path-1",
      },
      ORG_CTX,
    );
    expect(result.reserved).toBe(true);
    expect(result.runId).toBeDefined();
    // adapter sha comes from the adapter-manifest row's upstream_sha.
    expect(result.sourceShas.adapter).toBe(FACTORY_SHA);
    // process sha comes from factorySourceSha (same upstream_sha for this origin).
    expect(result.sourceShas.process).toBe(FACTORY_SHA);
    // spec 199: process.definition is { byKind: ... } — no embedded
    // AgentReference tokens, so agents[] is always empty at reservation.
    expect(result.sourceShas.agents).toEqual([]);
  });

  it("idempotent replay returns the same runId without creating a second row", async () => {
    const first = await reserveRunCore(
      {
        adapterName: ADAPTER_NAME,
        processName: PROCESS_NAME,
        projectId: PROJECT_ID,
        clientRunId: "idempotent-1",
      },
      ORG_CTX,
    );
    const second = await reserveRunCore(
      {
        adapterName: ADAPTER_NAME,
        processName: PROCESS_NAME,
        projectId: PROJECT_ID,
        clientRunId: "idempotent-1",
      },
      ORG_CTX,
    );
    expect(first.reserved).toBe(true);
    expect(second.reserved).toBe(false);
    expect(second.runId).toBe(first.runId);
    // Confirm the DB has exactly one row.
    const rows = await db.execute(sql`
      SELECT count(*) AS c FROM factory_runs WHERE org_id = ${ORG_ID} AND client_run_id = 'idempotent-1'
    `);
    expect(Number((rows.rows[0] as { c: string | number }).c)).toBe(1);
  });

  it(
    "hot-loop concurrent reservations produce exactly one row (T023)",
    async () => {
      // Fire the same (orgId, clientRunId) ten times in parallel; the
      // (org_id, client_run_id) unique index plus ON CONFLICT DO NOTHING
      // ensures only one row is created. Each reservation loads the org
      // substrate, so under parallel test files the default 5s budget is
      // too tight — this is a stress test, give it headroom.
      const results = await Promise.all(
        Array.from({ length: 10 }, () =>
          reserveRunCore(
            {
              adapterName: ADAPTER_NAME,
              processName: PROCESS_NAME,
              projectId: PROJECT_ID,
              clientRunId: "hot-loop-1",
            },
            ORG_CTX,
          ),
        ),
      );
      const ids = new Set(results.map((r) => r.runId));
      expect(ids.size).toBe(1);
      const rows = await db.execute(sql`
        SELECT count(*) AS c FROM factory_runs WHERE org_id = ${ORG_ID} AND client_run_id = 'hot-loop-1'
      `);
      expect(Number((rows.rows[0] as { c: string | number }).c)).toBe(1);
    },
    20_000,
  );

  it("returns 404 when fetching a run from a foreign org", async () => {
    const created = await reserveRunCore(
      {
        adapterName: ADAPTER_NAME,
        processName: PROCESS_NAME,
        projectId: PROJECT_ID,
        clientRunId: "foreign-org-1",
      },
      ORG_CTX,
    );
    await expect(
      getRunCore({ id: created.runId }, FOREIGN_CTX),
    ).rejects.toThrow(/run not found/i);
  });

  it("listRunsCore is org-scoped, filters by status and adapter, and paginates", async () => {
    // Create two runs in different statuses.
    const a = await reserveRunCore(
      {
        adapterName: ADAPTER_NAME,
        processName: PROCESS_NAME,
        projectId: PROJECT_ID,
        clientRunId: "list-a",
      },
      ORG_CTX,
    );
    const b = await reserveRunCore(
      {
        adapterName: ADAPTER_NAME,
        processName: PROCESS_NAME,
        projectId: PROJECT_ID,
        clientRunId: "list-b",
      },
      ORG_CTX,
    );
    // Flip one to running so the status filter has something to match.
    await db.execute(sql`UPDATE factory_runs SET status = 'running' WHERE id = ${a.runId}`);

    const queued = await listRunsCore(
      { status: "queued", adapter: ADAPTER_NAME },
      ORG_CTX,
    );
    const queuedIds = queued.runs.map((r) => r.id);
    expect(queuedIds).toContain(b.runId);
    expect(queuedIds).not.toContain(a.runId);

    const running = await listRunsCore({ status: "running" }, ORG_CTX);
    const runningIds = running.runs.map((r) => r.id);
    expect(runningIds).toContain(a.runId);
    expect(runningIds).not.toContain(b.runId);

    // Foreign org sees nothing.
    const foreign = await listRunsCore({}, FOREIGN_CTX);
    const foreignIds = new Set(foreign.runs.map((r) => r.id));
    expect(foreignIds.has(a.runId)).toBe(false);
    expect(foreignIds.has(b.runId)).toBe(false);

    // Pagination: limit=1 must produce a nextCursor.
    const page1 = await listRunsCore({ limit: 1 }, ORG_CTX);
    expect(page1.runs).toHaveLength(1);
    expect(page1.nextCursor).toBeDefined();
  });

  it("invalid `before` cursor surfaces as invalidArgument", async () => {
    await expect(
      listRunsCore({ before: "not-a-date" }, ORG_CTX),
    ).rejects.toMatchObject({ code: APIError.invalidArgument("x").code });
  });

  it("rejects reservation when the org has no admitted factory", async () => {
    // Use a distinct org id that has substrate rows but NO admission record.
    // reserveRunCore must fail with failedPrecondition.
    const inadmissibleOrg = "22222222-0000-0000-0000-00000000ff01";
    const inadmissibleUser = "22222222-0000-0000-0000-00000000ff02";
    await db.execute(sql`
      INSERT INTO organizations (id, name, slug)
        VALUES (${inadmissibleOrg}, 'spec124-inadmissible', 'spec124-inadmissible')
        ON CONFLICT (id) DO NOTHING
    `);
    await db.execute(sql`
      INSERT INTO users (id, email, password_hash, name, role)
        VALUES (${inadmissibleUser}, 'spec124-inadmissible@test', 'x', 'Inadmissible', 'user')
        ON CONFLICT (id) DO NOTHING
    `);
    // Same substrate shape as the admitted org but no factory_admissions row.
    await db.execute(sql`
      INSERT INTO factory_upstreams (org_id, source_id, role, repo_url, ref)
        VALUES (${inadmissibleOrg}, ${ORIGIN}, 'orchestration',
                'https://github.com/example/factory-runs-test.git', 'main')
        ON CONFLICT (org_id, source_id) DO NOTHING
    `);
    await db.execute(sql`
      INSERT INTO factory_artifact_substrate
        (org_id, origin, path, kind, version, status, upstream_sha, upstream_body, content_hash, conflict_state)
      VALUES
        (${inadmissibleOrg}, ${ORIGIN},
         'adapters/acme-vue-encore/adapter.yaml', 'adapter-manifest', 1, 'active',
         ${FACTORY_SHA},
         ${'adapter:\n  name: acme-vue-encore\n  version: "1.0.0"\n'},
         ${"a".padStart(64, "0")}, 'ok'),
        (${inadmissibleOrg}, ${ORIGIN},
         'process/governance-envelope.yaml', 'governance-envelope', 1, 'active',
         ${FACTORY_SHA},
         ${'schema_version: "1.0.0"\nprocess:\n  id: seven-stage-build\n  objective_class: scaffold\n  goal_identifier_scheme: uuid\n'},
         ${"b".padStart(64, "0")}, 'ok')
      ON CONFLICT (org_id, origin, path, version) DO NOTHING
    `);

    try {
      await expect(
        reserveRunCore(
          {
            adapterName: ADAPTER_NAME,
            processName: PROCESS_NAME,
            clientRunId: "inadmissible-1",
          },
          { orgId: inadmissibleOrg, userID: inadmissibleUser },
        ),
      ).rejects.toThrow(/cannot start a run/i);
    } finally {
      // Cleanup regardless of assertion outcome.
      await db.execute(sql`DELETE FROM factory_artifact_substrate WHERE org_id = ${inadmissibleOrg}`);
      await db.execute(sql`DELETE FROM factory_upstreams WHERE org_id = ${inadmissibleOrg}`);
      await db.execute(sql`DELETE FROM users WHERE id = ${inadmissibleUser}`);
      await db.execute(sql`DELETE FROM organizations WHERE id = ${inadmissibleOrg}`);
    }
  });
});
