// Spec 139 Phase 2 — T041 dispatch E2E test.
//
// Asserts that a project bound to a substrate-backed agent at a specific
// (version, content_hash) resolves to the expected agent body via
// factory_artifact_substrate ⨝ factory_bindings.
//
// The legacy agent_catalog / project_agent_bindings path was removed by
// migration 35; only the substrate path is tested here.
//
// DB-bound; gated to `encore test` via the vite.config.ts exclude list.
//
// **Halt condition (per Phase 2 directive):** if a project bound to an
// org agent at v3 cannot resolve through the substrate-backed binding,
// stop and surface — dispatch would silently break production.

import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { sql } from "drizzle-orm";
import { db } from "../db/drizzle";

const ORG_ID = "70139041-0000-0000-0000-000000000001";
const USER_ID = "70139041-0000-0000-0000-000000000002";
const PROJECT_ID = "70139041-0000-0000-0000-000000000003";
const AGENT_ID = "70139041-0000-0000-0000-000000000004";

describe("spec 139 Phase 2 — dispatch via substrate-backed binding (T041)", () => {
  beforeAll(async () => {
    await db.execute(sql`
      INSERT INTO organizations (id, name, slug)
        VALUES (${ORG_ID}, 'spec139-disp-org', 'spec139-disp-org')
        ON CONFLICT (id) DO NOTHING
    `);
    await db.execute(sql`
      INSERT INTO users (id, email, password_hash, name, role)
        VALUES (${USER_ID}, 'spec139-disp@test', 'x', 'Dispatch Tester', 'user')
        ON CONFLICT (id) DO NOTHING
    `);
    await db.execute(sql`
      INSERT INTO projects (id, org_id, name, slug, description, object_store_bucket, created_by)
        VALUES (${PROJECT_ID}, ${ORG_ID}, 'spec139-disp', 'spec139-disp', '', 'bucket-spec139-disp', ${USER_ID})
        ON CONFLICT (id) DO NOTHING
    `);
    // Substrate row for the agent at version 3, published.
    await db.execute(sql`
      INSERT INTO factory_artifact_substrate (
        id, org_id, origin, path, kind, version, status,
        user_body, user_modified_at, user_modified_by,
        content_hash, frontmatter, conflict_state
      )
      VALUES (${AGENT_ID}, ${ORG_ID}, 'user-authored',
              'user-authored/extract-v3.md', 'agent', 3, 'active',
              '# extract v3 body', NOW(), ${USER_ID},
              'hash-extract-v3', '{"id":"extract-v3","publication_status":"published"}'::jsonb, 'ok')
      ON CONFLICT (org_id, origin, path, version) DO NOTHING
    `);
    await db.execute(sql`
      INSERT INTO factory_bindings (project_id, artifact_id, pinned_version, pinned_content_hash, bound_by)
        VALUES (${PROJECT_ID}, ${AGENT_ID}, 3, 'hash-extract-v3', ${USER_ID})
        ON CONFLICT (project_id, artifact_id) DO NOTHING
    `);
  });

  afterAll(async () => {
    await db.execute(sql`DELETE FROM factory_bindings WHERE project_id = ${PROJECT_ID}`);
    await db.execute(sql`DELETE FROM factory_artifact_substrate WHERE org_id = ${ORG_ID}`);
    await db.execute(sql`DELETE FROM projects WHERE id = ${PROJECT_ID}`);
    await db.execute(sql`DELETE FROM users WHERE id = ${USER_ID}`);
    await db.execute(sql`DELETE FROM organizations WHERE id = ${ORG_ID}`);
  });

  it("substrate binding resolves to the seeded agent body", async () => {
    // Legacy agent_catalog ⨝ project_agent_bindings path removed by migration 35.

    // Substrate lookup — factory_artifact_substrate ⨝ factory_bindings.
    type SubstrateHit = {
      effective_body: string;
      content_hash: string;
      version: number;
    };
    const substrateResult = await db.execute<SubstrateHit>(sql`
      SELECT fas.effective_body, fas.content_hash, fas.version
        FROM factory_artifact_substrate fas
        JOIN factory_bindings fb ON fb.artifact_id = fas.id
       WHERE fb.project_id = ${PROJECT_ID}
    `);
    const sub = substrateResult.rows[0] as SubstrateHit | undefined;
    expect(sub).toBeTruthy();
    expect(sub!.effective_body).toBe("# extract v3 body");
    expect(sub!.content_hash).toBe("hash-extract-v3");
    expect(sub!.version).toBe(3);
  });

  it("retired-upstream substrate row is still readable via binding", async () => {
    // Retire the substrate row — the binding's ability to resolve historical
    // content must survive an upstream retirement (spec 123 I-B3 carries over).
    await db.execute(sql`
      UPDATE factory_artifact_substrate SET status = 'retired'
       WHERE id = ${AGENT_ID}
    `);
    type Hit = { effective_body: string; status: string };
    const result = await db.execute<Hit>(sql`
      SELECT fas.effective_body, fas.status
        FROM factory_artifact_substrate fas
        JOIN factory_bindings fb ON fb.artifact_id = fas.id
       WHERE fb.project_id = ${PROJECT_ID}
    `);
    const hit = result.rows[0] as Hit | undefined;
    expect(hit).toBeTruthy();
    expect(hit!.status).toBe("retired");
    expect(hit!.effective_body).toBe("# extract v3 body");
  });
});
