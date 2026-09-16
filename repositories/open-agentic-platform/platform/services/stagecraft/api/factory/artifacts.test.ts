// Spec 139 Phase 1 — T013 artifacts API integration test.
//
// Covers the new spec 139 endpoints:
//   GET  /api/factory/artifacts?kind=...&page=...&pageSize=...
//   GET  /api/factory/artifacts/by-path?origin=...&path=...
//   GET  /api/factory/artifacts/:id
//
// DB-bound; gated to `encore test` via vite.config.ts exclude list.

import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { sql } from "drizzle-orm";
import { db } from "../db/drizzle";
import {
  listArtifactsCore,
  getArtifactByPathCore,
  getArtifactByIdCore,
} from "./artifacts";
import { APIError } from "encore.dev/api";

const ORG_ID = "66666666-0000-0000-0000-000000000001";
const FOREIGN_ORG = "66666666-0000-0000-0000-000000000002";
const USER_ID = "66666666-0000-0000-0000-000000000003";

const ORG_CTX = { orgId: ORG_ID, userID: USER_ID };
const FOREIGN_CTX = { orgId: FOREIGN_ORG, userID: USER_ID };

describe("spec 139 — /api/factory/artifacts (T013)", () => {
  beforeAll(async () => {
    await db.execute(sql`
      INSERT INTO organizations (id, name, slug)
        VALUES (${ORG_ID}, 'spec139-art-org', 'spec139-art-org')
        ON CONFLICT (id) DO NOTHING
    `);
    await db.execute(sql`
      INSERT INTO organizations (id, name, slug)
        VALUES (${FOREIGN_ORG}, 'spec139-foreign', 'spec139-foreign')
        ON CONFLICT (id) DO NOTHING
    `);
    await db.execute(sql`
      INSERT INTO users (id, email, password_hash, name, role)
        VALUES (${USER_ID}, 'spec139-art@test', 'x', 'Artifacts Tester', 'user')
        ON CONFLICT (id) DO NOTHING
    `);
    // Seed a small mix of kinds so the kind filter can prove it filters.
    // 5 skill rows, 3 reference-data rows, 2 contract-schema rows.
    for (let i = 1; i <= 5; i++) {
      await db.execute(sql`
        INSERT INTO factory_artifact_substrate
          (org_id, origin, path, kind, version, status, upstream_sha, upstream_body, content_hash, frontmatter, conflict_state)
        VALUES
          (${ORG_ID}::uuid, 'legacy-factory',
           ${`Factory Agent/Controllers/api-skill-${i}.md`},
           'skill', 1, 'active',
           ${"a".repeat(40)}, ${`skill ${i} body`},
           ${`${i.toString().padStart(64, "0")}`},
           ${`{"id":"api-skill-${i}"}`}::jsonb, 'ok')
      `);
    }
    for (let i = 1; i <= 3; i++) {
      await db.execute(sql`
        INSERT INTO factory_artifact_substrate
          (org_id, origin, path, kind, version, status, upstream_sha, upstream_body, content_hash, frontmatter, conflict_state)
        VALUES
          (${ORG_ID}::uuid, 'legacy-factory',
           ${`Factory Agent/Requirements/Service/sitemap-${i}.json`},
           'reference-data', 1, 'active',
           ${"a".repeat(40)}, ${`{"v":${i}}`},
           ${`${(100 + i).toString().padStart(64, "0")}`},
           NULL, 'ok')
      `);
    }
    await db.execute(sql`
      INSERT INTO factory_artifact_substrate
        (org_id, origin, path, kind, version, status, upstream_sha, upstream_body, content_hash, frontmatter, conflict_state)
      VALUES
        (${ORG_ID}::uuid, 'legacy-factory',
         'Factory Agent/contracts/build-spec.schema.json',
         'contract-schema', 1, 'active',
         ${"a".repeat(40)}, '{"type":"object"}',
         ${"deadbeef".padStart(64, "0")},
         NULL, 'ok')
    `);
    await db.execute(sql`
      INSERT INTO factory_artifact_substrate
        (org_id, origin, path, kind, version, status, upstream_sha, upstream_body, content_hash, frontmatter, conflict_state)
      VALUES
        (${ORG_ID}::uuid, 'template',
         'orchestration/contracts/pipeline-state.schema.yaml',
         'contract-schema', 1, 'active',
         ${"e".repeat(40)}, 'type: object',
         ${"feedface".padStart(64, "0")},
         NULL, 'ok')
    `);
    // A foreign-org row to assert org scoping.
    await db.execute(sql`
      INSERT INTO factory_artifact_substrate
        (org_id, origin, path, kind, version, status, upstream_sha, upstream_body, content_hash, frontmatter, conflict_state)
      VALUES
        (${FOREIGN_ORG}::uuid, 'legacy-factory',
         'Factory Agent/Controllers/foreign-skill.md',
         'skill', 1, 'active',
         ${"a".repeat(40)}, 'foreign body',
         ${"cafebabe".padStart(64, "0")},
         NULL, 'ok')
    `);
  });

  afterAll(async () => {
    await db.execute(sql`
      DELETE FROM factory_artifact_substrate WHERE org_id IN (${ORG_ID}, ${FOREIGN_ORG})
    `);
    await db.execute(sql`DELETE FROM users WHERE id = ${USER_ID}`);
    await db.execute(sql`
      DELETE FROM organizations WHERE id IN (${ORG_ID}, ${FOREIGN_ORG})
    `);
  });

  it("filters by kind and paginates", async () => {
    const page1 = await listArtifactsCore(ORG_CTX, {
      kind: "skill",
      page: 1,
      pageSize: 3,
    });
    expect(page1.total).toBe(5);
    expect(page1.artifacts).toHaveLength(3);
    for (const r of page1.artifacts) {
      expect(r.kind).toBe("skill");
      expect(r.orgId).toBe(ORG_ID);
    }

    const page2 = await listArtifactsCore(ORG_CTX, {
      kind: "skill",
      page: 2,
      pageSize: 3,
    });
    expect(page2.artifacts).toHaveLength(2);

    // Different kind, different count.
    const refs = await listArtifactsCore(ORG_CTX, {
      kind: "reference-data",
      page: 1,
      pageSize: 50,
    });
    expect(refs.total).toBe(3);
  });

  it("kind=undefined returns all org-scoped rows", async () => {
    const all = await listArtifactsCore(ORG_CTX, {
      page: 1,
      pageSize: 100,
    });
    expect(all.total).toBe(10); // 5 + 3 + 2
    for (const r of all.artifacts) {
      expect(r.orgId).toBe(ORG_ID);
    }
  });

  it("foreign org cannot see this org's rows", async () => {
    const all = await listArtifactsCore(FOREIGN_CTX, {
      page: 1,
      pageSize: 100,
    });
    expect(all.total).toBe(1);
    expect(all.artifacts[0].path).toBe(
      "Factory Agent/Controllers/foreign-skill.md",
    );
  });

  it("by-path returns effective body and content_hash", async () => {
    const row = await getArtifactByPathCore(ORG_CTX, {
      origin: "legacy-factory",
      path: "Factory Agent/Controllers/api-skill-2.md",
    });
    expect(row.path).toBe("Factory Agent/Controllers/api-skill-2.md");
    expect(row.effectiveBody).toBe("skill 2 body");
    expect(row.contentHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("by-path 404s on missing (origin, path)", async () => {
    await expect(
      getArtifactByPathCore(ORG_CTX, {
        origin: "legacy-factory",
        path: "no/such/path.md",
      }),
    ).rejects.toThrow(APIError);
  });

  it("by-path is org-scoped — cannot reach foreign rows", async () => {
    await expect(
      getArtifactByPathCore(ORG_CTX, {
        origin: "legacy-factory",
        path: "Factory Agent/Controllers/foreign-skill.md",
      }),
    ).rejects.toThrow(APIError);
  });

  it("by-id returns the row when org matches", async () => {
    const list = await listArtifactsCore(ORG_CTX, {
      kind: "contract-schema",
      page: 1,
      pageSize: 50,
    });
    expect(list.artifacts).toHaveLength(2);
    const target = list.artifacts[0];
    const single = await getArtifactByIdCore(ORG_CTX, { id: target.id });
    expect(single.id).toBe(target.id);
  });

  it("by-id 404s when fetching a foreign-org row", async () => {
    const list = await listArtifactsCore(FOREIGN_CTX, {
      page: 1,
      pageSize: 100,
    });
    const foreignId = list.artifacts[0].id;
    await expect(
      getArtifactByIdCore(ORG_CTX, { id: foreignId }),
    ).rejects.toThrow(APIError);
  });
});
