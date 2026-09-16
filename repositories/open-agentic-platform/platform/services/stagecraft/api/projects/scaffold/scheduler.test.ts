// Spec 140 §2.2 / T030 — scaffold scheduler resolver.
//
// Covers the `factory_upstreams` lookup branch:
//   * resolved row → returns `{ repoUrl, ref }`.
//   * missing source_id → returns `null`.
//   * cross-org isolation → another org's row does NOT bleed across.
//
// Encore-gated (vite.config.ts exclude) because it queries the live
// `factory_upstreams` table. The wider `resolveWarmupContext` state
// machine (no-adapters / no-scaffold-source-id / no-scaffold-source-
// resolved / no-pat / ok) is exercised end-to-end by the browser smoke
// at T073 and by the production warmup loop itself; unit-level coverage
// of the lookup primitive is what spec 140 §2.2 SC-001 requires.

import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { sql } from "drizzle-orm";
import { db } from "../../db/drizzle";
import { resolveScaffoldUpstream } from "./scheduler";

const ORG_ID_A = "70140030-0000-0000-0000-000000000001";
const ORG_ID_B = "70140030-0000-0000-0000-000000000002";

describe("spec 140 §2.2 — resolveScaffoldUpstream (T030)", () => {
  beforeAll(async () => {
    for (const id of [ORG_ID_A, ORG_ID_B]) {
      await db.execute(sql`
        INSERT INTO organizations (id, name, slug)
          VALUES (${id}, ${'spec140-sched-' + id.slice(-1)}, ${'spec140-sched-' + id.slice(-1)})
          ON CONFLICT (id) DO NOTHING
      `);
    }
    // Seed: org A has the template upstream registered.
    await db.execute(sql`
      INSERT INTO factory_upstreams (
        org_id, source_id, role, repo_url, ref, subpath, created_at, updated_at
      ) VALUES (
        ${ORG_ID_A}, 'template', 'scaffold',
        'statecrafting/template', 'main', NULL, now(), now()
      )
      ON CONFLICT (org_id, source_id) DO NOTHING
    `);
  });

  afterAll(async () => {
    for (const id of [ORG_ID_A, ORG_ID_B]) {
      await db.execute(sql`
        DELETE FROM factory_upstreams WHERE org_id = ${id}
      `);
      await db.execute(sql`
        DELETE FROM organizations WHERE id = ${id}
      `);
    }
  });

  it("returns repoUrl + ref when source_id resolves", async () => {
    const result = await resolveScaffoldUpstream(
      ORG_ID_A,
      "template",
    );
    expect(result).not.toBeNull();
    expect(result!.repoUrl).toBe("statecrafting/template");
    expect(result!.ref).toBe("main");
  });

  it("returns null when no factory_upstreams row matches the source_id", async () => {
    const result = await resolveScaffoldUpstream(ORG_ID_A, "unknown-source-id");
    expect(result).toBeNull();
  });

  it("returns null when the source_id exists but for a DIFFERENT org (org-scoped lookup)", async () => {
    // Org B has no template row, even though org A does.
    const result = await resolveScaffoldUpstream(
      ORG_ID_B,
      "template",
    );
    expect(result).toBeNull();
  });
});
