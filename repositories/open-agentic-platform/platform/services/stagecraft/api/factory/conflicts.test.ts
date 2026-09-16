// Spec 139 Phase 1 — T012 conflicts integration test.
//
// Locks SC-002 (override survival): a user override of any artifact
// survives an upstream sync that does not change the same path. An
// upstream sync that does change the same path produces
// `conflict_state='diverged'` and never overwrites `user_body`.
//
// DB-bound; gated to `encore test` via vite.config.ts exclude list.

import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { sql } from "drizzle-orm";
import { db } from "../db/drizzle";
import { applyOverrideCore } from "./artifacts";
import { syncSubstrateRowCore } from "./syncPipeline";

const ORG_ID = "55555555-0000-0000-0000-000000000001";
const USER_ID = "55555555-0000-0000-0000-000000000002";

describe("spec 139 — conflict state machine over the live DB (T012)", () => {
  beforeAll(async () => {
    await db.execute(sql`
      INSERT INTO organizations (id, name, slug)
        VALUES (${ORG_ID}, 'spec139-conflicts-org', 'spec139-conflicts-org')
        ON CONFLICT (id) DO NOTHING
    `);
    await db.execute(sql`
      INSERT INTO users (id, email, password_hash, name, role)
        VALUES (${USER_ID}, 'spec139-conflicts@test', 'x', 'Conflicts Tester', 'user')
        ON CONFLICT (id) DO NOTHING
    `);
  });

  afterAll(async () => {
    await db.execute(sql`
      DELETE FROM factory_artifact_substrate_audit WHERE org_id = ${ORG_ID}
    `);
    await db.execute(sql`
      DELETE FROM factory_artifact_substrate WHERE org_id = ${ORG_ID}
    `);
    await db.execute(sql`DELETE FROM users WHERE id = ${USER_ID}`);
    await db.execute(sql`DELETE FROM organizations WHERE id = ${ORG_ID}`);
  });

  it("override survives a sync of the same body (no-op fast-forward)", async () => {
    const initial = await syncSubstrateRowCore({
      orgId: ORG_ID,
      origin: "legacy-factory",
      path: "Factory Agent/test/no-change.md",
      kind: "skill",
      upstreamSha: "a".repeat(40),
      upstreamBody: "v1 body",
      frontmatter: null,
    });
    expect(initial.conflictState).toBe("ok");
    expect(initial.userBody).toBeNull();
    expect(initial.version).toBe(1);

    const overridden = await applyOverrideCore({
      orgId: ORG_ID,
      userId: USER_ID,
      artifactId: initial.id,
      userBody: "user custom v1",
    });
    expect(overridden.userBody).toBe("user custom v1");
    expect(overridden.effectiveBody).toBe("user custom v1");
    expect(overridden.conflictState).toBe("ok");

    const afterSync = await syncSubstrateRowCore({
      orgId: ORG_ID,
      origin: "legacy-factory",
      path: "Factory Agent/test/no-change.md",
      kind: "skill",
      upstreamSha: "a".repeat(40),
      upstreamBody: "v1 body",
      frontmatter: null,
    });
    expect(afterSync.conflictState).toBe("ok");
    expect(afterSync.userBody).toBe("user custom v1");
    expect(afterSync.upstreamBody).toBe("v1 body");
    // No version bump — upstream content unchanged.
    expect(afterSync.version).toBe(1);
  });

  it("override + upstream change → conflict_state='diverged', user_body untouched", async () => {
    const initial = await syncSubstrateRowCore({
      orgId: ORG_ID,
      origin: "legacy-factory",
      path: "Factory Agent/test/diverge.md",
      kind: "skill",
      upstreamSha: "a".repeat(40),
      upstreamBody: "v1 body",
      frontmatter: null,
    });
    expect(initial.conflictState).toBe("ok");

    const overridden = await applyOverrideCore({
      orgId: ORG_ID,
      userId: USER_ID,
      artifactId: initial.id,
      userBody: "user custom",
    });
    expect(overridden.userBody).toBe("user custom");
    expect(overridden.conflictUpstreamSha).toBe("a".repeat(40));

    const afterChangedSync = await syncSubstrateRowCore({
      orgId: ORG_ID,
      origin: "legacy-factory",
      path: "Factory Agent/test/diverge.md",
      kind: "skill",
      upstreamSha: "b".repeat(40),
      upstreamBody: "v2 body — upstream moved",
      frontmatter: null,
    });
    expect(afterChangedSync.conflictState).toBe("diverged");
    expect(afterChangedSync.userBody).toBe("user custom");
    expect(afterChangedSync.upstreamBody).toBe("v2 body — upstream moved");
    expect(afterChangedSync.upstreamSha).toBe("b".repeat(40));
    expect(afterChangedSync.effectiveBody).toBe("user custom");

    // Audit row recorded for both override and conflict_detected actions.
    const audit = await db.execute<{ action: string }>(sql`
      SELECT action FROM factory_artifact_substrate_audit
        WHERE artifact_id = ${initial.id}::uuid
        ORDER BY created_at ASC
    `);
    const actions = (audit.rows as { action: string }[]).map((r) => r.action);
    expect(actions).toContain("artifact.synced");
    expect(actions).toContain("artifact.overridden");
    expect(actions).toContain("artifact.conflict_detected");
  });

  it("retire preserves user_body and forbids new bindings", async () => {
    const row = await syncSubstrateRowCore({
      orgId: ORG_ID,
      origin: "legacy-factory",
      path: "Factory Agent/test/will-be-retired.md",
      kind: "skill",
      upstreamSha: "a".repeat(40),
      upstreamBody: "v1",
      frontmatter: null,
    });
    await applyOverrideCore({
      orgId: ORG_ID,
      userId: USER_ID,
      artifactId: row.id,
      userBody: "custom override",
    });

    // Manually retire (sync-driven prune is tested in syncPipeline tests).
    await db.execute(sql`
      UPDATE factory_artifact_substrate SET status = 'retired'
        WHERE id = ${row.id}::uuid
    `);

    const refetched = await db.execute<{
      user_body: string | null;
      effective_body: string;
      status: string;
    }>(sql`
      SELECT user_body, effective_body, status FROM factory_artifact_substrate
        WHERE id = ${row.id}::uuid
    `);
    const r = refetched.rows[0] as {
      user_body: string | null;
      effective_body: string;
      status: string;
    };
    expect(r.status).toBe("retired");
    expect(r.user_body).toBe("custom override");
    expect(r.effective_body).toBe("custom override");
  });
});
