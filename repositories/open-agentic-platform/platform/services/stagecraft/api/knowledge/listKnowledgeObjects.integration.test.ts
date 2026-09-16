// Regression test for the `WHERE knowledge_object_id IN (sql.join(...))`
// query in `listKnowledgeObjectsCore`.
//
// Background: a previous revision used `ANY(${objectIds})` inside a Drizzle
// `sql` template. Drizzle spreads JS arrays into individual placeholders,
// so the query landed in Postgres as `ANY(($1, $2, ...))` — a row
// constructor, not an array — and Postgres rejected it with
// `op ANY/ALL (array) requires array on right side`. The Remix
// loader at `web/app/routes/app.project.$projectId.knowledge.tsx` has no
// catch wrapper, so the resulting 500 propagated to the route boundary
// and rendered the production "Oops!" page.
//
// This test exercises the multi-row path with a real DB so the regression
// fails loudly if the array-binding shape regresses. Live DB → runs only
// under `encore test`, gated out of bare `npm test` via
// `vite.config.ts`.

import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { sql } from "drizzle-orm";
import { db } from "../db/drizzle";
import { listKnowledgeObjectsCore } from "./knowledge";

const ORG_ID = "55000000-0000-0000-0000-0000000000a1";
const USER_ID = "55000000-0000-0000-0000-0000000000a2";
const PROJECT_ID = "55000000-0000-0000-0000-0000000000a3";
const OBJ_A_ID = "55000000-0000-0000-0000-0000000000b1";
const OBJ_B_ID = "55000000-0000-0000-0000-0000000000b2";
const OBJ_C_ID = "55000000-0000-0000-0000-0000000000b3";

async function deleteFixtures() {
  await db.execute(sql`
    DELETE FROM knowledge_extraction_runs WHERE project_id = ${PROJECT_ID}
  `);
  await db.execute(sql`
    DELETE FROM knowledge_objects WHERE project_id = ${PROJECT_ID}
  `);
  await db.execute(sql`
    DELETE FROM projects WHERE id = ${PROJECT_ID}
  `);
  await db.execute(sql`
    DELETE FROM organizations WHERE id = ${ORG_ID}
  `);
  await db.execute(sql`DELETE FROM users WHERE id = ${USER_ID}`);
}

describe("listKnowledgeObjectsCore — IN (sql.join) array binding", () => {
  beforeAll(async () => {
    await deleteFixtures();
    await db.execute(sql`
      INSERT INTO organizations (id, name, slug)
        VALUES (${ORG_ID}, 'list-knowledge-test', 'list-knowledge-test')
    `);
    await db.execute(sql`
      INSERT INTO users (id, email, password_hash, name, role)
        VALUES (${USER_ID}, 'list-knowledge@test', 'x', 'List Tester', 'user')
    `);
    await db.execute(sql`
      INSERT INTO projects (id, org_id, name, slug, description, object_store_bucket, created_by)
        VALUES (${PROJECT_ID}, ${ORG_ID}, 'list-knowledge-p', 'list-knowledge-p', '',
                'list-knowledge-bucket', ${USER_ID})
    `);

    // Three knowledge objects so the multi-row path exercises the
    // array-binding query. Two have extraction runs; one does not — so
    // the test also covers the null-latestRun branch.
    for (const id of [OBJ_A_ID, OBJ_B_ID, OBJ_C_ID]) {
      await db.execute(sql`
        INSERT INTO knowledge_objects
          (id, project_id, storage_key, filename, mime_type, size_bytes,
           content_hash, state, provenance)
        VALUES
          (${id}, ${PROJECT_ID}, ${`knowledge/${id}/x.txt`}, 'x.txt',
           'text/plain', 11, ${`hash-${id}`}, 'imported',
           '{"sourceType":"upload","sourceUri":"upload://x.txt","importedAt":"2026-05-07T00:00:00Z"}'::jsonb)
      `);
    }

    // OBJ_A has two runs — the DISTINCT ON should return the LATEST
    // (queued_at desc), so the older "failed" run must NOT win.
    await db.execute(sql`
      INSERT INTO knowledge_extraction_runs
        (knowledge_object_id, project_id, status, extractor_kind,
         queued_at, completed_at, duration_ms, attempts)
      VALUES
        (${OBJ_A_ID}, ${PROJECT_ID}, 'failed', 'deterministic-text',
         '2026-05-07T10:00:00Z', '2026-05-07T10:00:01Z', 1000, 1),
        (${OBJ_A_ID}, ${PROJECT_ID}, 'completed', 'deterministic-text',
         '2026-05-07T11:00:00Z', '2026-05-07T11:00:02Z', 2000, 2)
    `);

    // OBJ_B has one run.
    await db.execute(sql`
      INSERT INTO knowledge_extraction_runs
        (knowledge_object_id, project_id, status, extractor_kind,
         queued_at, completed_at, duration_ms, attempts)
      VALUES
        (${OBJ_B_ID}, ${PROJECT_ID}, 'running', 'agent-pdf-vision',
         '2026-05-07T12:00:00Z', NULL, NULL, 1)
    `);

    // OBJ_C has no runs at all.
  });

  afterAll(async () => {
    await deleteFixtures();
  });

  it("returns all objects without throwing on multi-row IN binding", async () => {
    // The bug: `WHERE x = ANY(${jsArray})` in a Drizzle sql tag emits
    // `ANY(($1, $2, ...))`. Postgres rejects with
    // `op ANY/ALL (array) requires array on right side`. With three
    // rows, this would throw before we ever see a result.
    const result = await listKnowledgeObjectsCore({
      projectId: PROJECT_ID,
      orgId: ORG_ID,
    });

    expect(result.objects).toHaveLength(3);
    const byId = new Map(result.objects.map((o) => [o.id, o]));
    expect(byId.has(OBJ_A_ID)).toBe(true);
    expect(byId.has(OBJ_B_ID)).toBe(true);
    expect(byId.has(OBJ_C_ID)).toBe(true);
  });

  it("DISTINCT ON returns the latest run per object (most-recent queued_at wins)", async () => {
    const result = await listKnowledgeObjectsCore({
      projectId: PROJECT_ID,
      orgId: ORG_ID,
    });
    const byId = new Map(result.objects.map((o) => [o.id, o]));

    // OBJ_A: two runs, latest is "completed".
    expect(byId.get(OBJ_A_ID)?.latestRun?.status).toBe("completed");
    expect(byId.get(OBJ_A_ID)?.latestRun?.durationMs).toBe(2000);
    // FU-014 regression — completedAt must serialize as ISO 8601 string for
    // populated rows. Prior bug: the handler called r.completed_at.toISOString()
    // directly on the db.execute<>() raw-SQL result, which returns timestamptz
    // as string at runtime; .toISOString() then threw TypeError because the
    // value is a string, not a Date. The existing test (which only asserted
    // .status and .durationMs for OBJ_A) was the gap that let the bug ship.
    expect(byId.get(OBJ_A_ID)?.latestRun?.completedAt).toBe(
      "2026-05-07T11:00:02.000Z"
    );

    // OBJ_B: single "running" run, no completedAt.
    expect(byId.get(OBJ_B_ID)?.latestRun?.status).toBe("running");
    expect(byId.get(OBJ_B_ID)?.latestRun?.completedAt).toBeNull();

    // OBJ_C: no runs.
    expect(byId.get(OBJ_C_ID)?.latestRun).toBeNull();
  });

  it("empty-rows path short-circuits before the IN query", async () => {
    // Project exists but has zero knowledge_objects → the function
    // returns early without executing the IN query, regardless of how
    // it's bound. Guards against accidental refactors that move the
    // query above the `rows.length === 0` short-circuit.
    const EMPTY_PROJECT = "55000000-0000-0000-0000-0000000000a4";
    await db.execute(sql`
      INSERT INTO projects (id, org_id, name, slug, description, object_store_bucket, created_by)
        VALUES (${EMPTY_PROJECT}, ${ORG_ID}, 'empty-p', 'empty-p', '',
                'empty-bucket', ${USER_ID})
        ON CONFLICT (id) DO NOTHING
    `);
    try {
      const result = await listKnowledgeObjectsCore({
        projectId: EMPTY_PROJECT,
        orgId: ORG_ID,
      });
      expect(result.objects).toEqual([]);
    } finally {
      await db.execute(sql`DELETE FROM projects WHERE id = ${EMPTY_PROJECT}`);
    }
  });
});
