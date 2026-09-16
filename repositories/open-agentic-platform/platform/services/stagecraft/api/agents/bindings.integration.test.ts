// Spec 139 Phase 4b (B-2) — DB-backed integration tests for the
// substrate-direct `bindings.ts`.
//
// Mirrors the spec 124 `runs.test.ts` pattern: live-DB tests under
// `encore test`, excluded from `npm test` via `vite.config.ts`. Coverage:
//   * bind — inserts a `factory_bindings` row and writes
//     `agent.binding_created` audit
//   * repin — updates pinned_version + pinned_content_hash to a different
//     version; writes `agent.binding_repinned` audit
//   * unbind — deletes the row; writes `agent.binding_unbound` audit
//   * retired-upstream — bind/repin to a retired substrate row is
//     rejected with a "retired" error (spec 123 I-B3 carries over);
//     existing bindings whose substrate row was retired AFTER bind time
//     remain readable as `status='retired_upstream'`
//
// Fixtures use only `factory_artifact_substrate` rows (no
// `agent_catalog`); the legacy bindings.ts implementation cannot resolve
// these rows, so this file goes RED before the substrate re-point and
// GREEN after.

import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { sql } from "drizzle-orm";
import { db } from "../db/drizzle";
import {
  bindAgentCore,
  repinBindingCore,
  unbindAgentCore,
  listBindingsCore,
} from "./bindings";

const ORG_ID = "4b000000-0000-0000-0000-0000000000a1";
const USER_ID = "4b000000-0000-0000-0000-0000000000a2";
const PROJECT_ID = "4b000000-0000-0000-0000-0000000000a3";
const AGENT_V1_ID = "4b000000-0000-0000-0000-0000000000a4";
const AGENT_V2_ID = "4b000000-0000-0000-0000-0000000000a5";
const RETIRED_AGENT_ID = "4b000000-0000-0000-0000-0000000000a6";
const ALT_AGENT_V1_ID = "4b000000-0000-0000-0000-0000000000a7";

const ORG_CTX = { orgId: ORG_ID, userID: USER_ID };

async function clearBindings() {
  await db.execute(sql`
    DELETE FROM factory_bindings WHERE project_id = ${PROJECT_ID}
  `);
  await db.execute(sql`
    DELETE FROM audit_log WHERE actor_user_id = ${USER_ID}
      AND target_type = 'project_agent_binding'
  `);
}

async function deleteAllFixtures() {
  await clearBindings();
  await db.execute(sql`
    DELETE FROM factory_artifact_substrate_audit WHERE org_id = ${ORG_ID}
      AND artifact_id IN (
        ${AGENT_V1_ID}, ${AGENT_V2_ID}, ${RETIRED_AGENT_ID}, ${ALT_AGENT_V1_ID}
      )
  `);
  await db.execute(sql`
    DELETE FROM factory_artifact_substrate WHERE org_id = ${ORG_ID}
      AND id IN (
        ${AGENT_V1_ID}, ${AGENT_V2_ID}, ${RETIRED_AGENT_ID}, ${ALT_AGENT_V1_ID}
      )
  `);
}

describe("spec 139 Phase 4b — bindings.ts (substrate-direct)", () => {
  beforeAll(async () => {
    await db.execute(sql`
      INSERT INTO organizations (id, name, slug)
        VALUES (${ORG_ID}, 'spec139-4b-org', 'spec139-4b-org')
        ON CONFLICT (id) DO NOTHING
    `);
    await db.execute(sql`
      INSERT INTO users (id, email, password_hash, name, role)
        VALUES (${USER_ID}, 'spec139-4b@test', 'x', 'Bindings Tester', 'user')
        ON CONFLICT (id) DO NOTHING
    `);
    await db.execute(sql`
      INSERT INTO projects (id, org_id, name, slug, description, object_store_bucket, created_by)
        VALUES (${PROJECT_ID}, ${ORG_ID}, 'spec139-4b-p', 'spec139-4b-p', '',
                'bucket-spec139-4b', ${USER_ID})
        ON CONFLICT (id) DO NOTHING
    `);
    await deleteAllFixtures();

    // Substrate row v1 — active, published. Bindable.
    await db.execute(sql`
      INSERT INTO factory_artifact_substrate
        (id, org_id, origin, path, kind, version, status,
         user_body, user_modified_by, content_hash, frontmatter, conflict_state)
        VALUES (${AGENT_V1_ID}, ${ORG_ID}, 'user-authored',
                'user-authored/extract.md', 'agent', 1, 'active',
                '# extract v1', ${USER_ID}, 'agent-hash-v1',
                '{"publication_status":"published"}'::jsonb, 'ok')
    `);
    // Substrate row v2 — active, published. Repin target.
    await db.execute(sql`
      INSERT INTO factory_artifact_substrate
        (id, org_id, origin, path, kind, version, status,
         user_body, user_modified_by, content_hash, frontmatter, conflict_state)
        VALUES (${AGENT_V2_ID}, ${ORG_ID}, 'user-authored',
                'user-authored/extract.md', 'agent', 2, 'active',
                '# extract v2', ${USER_ID}, 'agent-hash-v2',
                '{"publication_status":"published"}'::jsonb, 'ok')
    `);
    // Substrate row — retired. Cannot be bound.
    await db.execute(sql`
      INSERT INTO factory_artifact_substrate
        (id, org_id, origin, path, kind, version, status,
         user_body, user_modified_by, content_hash, frontmatter, conflict_state)
        VALUES (${RETIRED_AGENT_ID}, ${ORG_ID}, 'user-authored',
                'user-authored/retired-trigger.md', 'agent', 1, 'retired',
                '# retired', ${USER_ID}, 'agent-hash-retired',
                '{"publication_status":"retired"}'::jsonb, 'ok')
    `);
    // Alt-name substrate row — used by the "one-binding-per-name" test.
    await db.execute(sql`
      INSERT INTO factory_artifact_substrate
        (id, org_id, origin, path, kind, version, status,
         user_body, user_modified_by, content_hash, frontmatter, conflict_state)
        VALUES (${ALT_AGENT_V1_ID}, ${ORG_ID}, 'user-authored',
                'user-authored/classify.md', 'agent', 1, 'active',
                '# classify v1', ${USER_ID}, 'agent-hash-classify-v1',
                '{"publication_status":"published"}'::jsonb, 'ok')
    `);
  });

  afterAll(async () => {
    await deleteAllFixtures();
    await db.execute(sql`DELETE FROM projects WHERE id = ${PROJECT_ID}`);
    await db.execute(sql`DELETE FROM users WHERE id = ${USER_ID}`);
    await db.execute(sql`DELETE FROM organizations WHERE id = ${ORG_ID}`);
  });

  it("bind: inserts a factory_bindings row, returns the wire shape, writes audit", async () => {
    await clearBindings();
    const { binding } = await bindAgentCore(
      { projectId: PROJECT_ID, org_agent_id: AGENT_V1_ID, version: 1 },
      ORG_CTX,
    );
    expect(binding.project_id).toBe(PROJECT_ID);
    expect(binding.org_agent_id).toBe(AGENT_V1_ID);
    expect(binding.agent_name).toBe("extract");
    expect(binding.pinned_version).toBe(1);
    expect(binding.pinned_content_hash).toBe("agent-hash-v1");
    expect(binding.status).toBe("active");

    const rows = await db.execute(sql`
      SELECT count(*) AS c FROM factory_bindings
        WHERE project_id = ${PROJECT_ID} AND artifact_id = ${AGENT_V1_ID}
    `);
    expect(Number((rows.rows[0] as { c: string | number }).c)).toBe(1);

    const audit = await db.execute(sql`
      SELECT count(*) AS c FROM audit_log
        WHERE action = 'agent.binding_created'
          AND target_id = ${binding.binding_id}
    `);
    expect(Number((audit.rows[0] as { c: string | number }).c)).toBe(1);
  });

  it("bind rejects a retired substrate row with a 'retired' error", async () => {
    await clearBindings();
    await expect(
      bindAgentCore(
        { projectId: PROJECT_ID, org_agent_id: RETIRED_AGENT_ID, version: 1 },
        ORG_CTX,
      ),
    ).rejects.toThrow(/retired/i);

    const rows = await db.execute(sql`
      SELECT count(*) AS c FROM factory_bindings
        WHERE project_id = ${PROJECT_ID} AND artifact_id = ${RETIRED_AGENT_ID}
    `);
    expect(Number((rows.rows[0] as { c: string | number }).c)).toBe(0);
  });

  it("repin: moves the binding to v2 and updates content_hash; writes audit", async () => {
    await clearBindings();
    const { binding: bound } = await bindAgentCore(
      { projectId: PROJECT_ID, org_agent_id: AGENT_V1_ID, version: 1 },
      ORG_CTX,
    );

    const { binding: repinned } = await repinBindingCore(
      { projectId: PROJECT_ID, bindingId: bound.binding_id, version: 2 },
      ORG_CTX,
    );
    expect(repinned.binding_id).toBe(bound.binding_id);
    expect(repinned.org_agent_id).toBe(AGENT_V2_ID);
    expect(repinned.pinned_version).toBe(2);
    expect(repinned.pinned_content_hash).toBe("agent-hash-v2");

    const audit = await db.execute(sql`
      SELECT count(*) AS c FROM audit_log
        WHERE action = 'agent.binding_repinned'
          AND target_id = ${bound.binding_id}
    `);
    expect(Number((audit.rows[0] as { c: string | number }).c)).toBe(1);
  });

  it("repin to a retired substrate row is rejected (I-B3)", async () => {
    await clearBindings();
    const { binding: bound } = await bindAgentCore(
      { projectId: PROJECT_ID, org_agent_id: AGENT_V1_ID, version: 1 },
      ORG_CTX,
    );

    await db.execute(sql`
      UPDATE factory_artifact_substrate SET status = 'retired'
        WHERE id = ${AGENT_V2_ID}
    `);
    await expect(
      repinBindingCore(
        { projectId: PROJECT_ID, bindingId: bound.binding_id, version: 2 },
        ORG_CTX,
      ),
    ).rejects.toThrow(/retired/i);

    await db.execute(sql`
      UPDATE factory_artifact_substrate SET status = 'active'
        WHERE id = ${AGENT_V2_ID}
    `);
  });

  it("unbind: deletes the row and writes audit", async () => {
    await clearBindings();
    const { binding: bound } = await bindAgentCore(
      { projectId: PROJECT_ID, org_agent_id: AGENT_V1_ID, version: 1 },
      ORG_CTX,
    );

    const result = await unbindAgentCore(
      { projectId: PROJECT_ID, bindingId: bound.binding_id },
      ORG_CTX,
    );
    expect(result.ok).toBe(true);

    const rows = await db.execute(sql`
      SELECT count(*) AS c FROM factory_bindings WHERE id = ${bound.binding_id}
    `);
    expect(Number((rows.rows[0] as { c: string | number }).c)).toBe(0);

    const audit = await db.execute(sql`
      SELECT count(*) AS c FROM audit_log
        WHERE action = 'agent.binding_unbound'
          AND target_id = ${bound.binding_id}
    `);
    expect(Number((audit.rows[0] as { c: string | number }).c)).toBe(1);
  });

  it("list: existing binding whose substrate row was retired AFTER bind surfaces as retired_upstream (I-B3)", async () => {
    await clearBindings();
    const { binding: bound } = await bindAgentCore(
      { projectId: PROJECT_ID, org_agent_id: AGENT_V1_ID, version: 1 },
      ORG_CTX,
    );

    await db.execute(sql`
      UPDATE factory_artifact_substrate SET status = 'retired'
        WHERE id = ${AGENT_V1_ID}
    `);

    const { bindings } = await listBindingsCore(
      { projectId: PROJECT_ID },
      ORG_CTX,
    );
    const target = bindings.find((b) => b.binding_id === bound.binding_id);
    expect(target).toBeDefined();
    expect(target!.status).toBe("retired_upstream");

    await db.execute(sql`
      UPDATE factory_artifact_substrate SET status = 'active'
        WHERE id = ${AGENT_V1_ID}
    `);
  });

  it("bind: rejects a second binding for the same agent name on one project", async () => {
    await clearBindings();
    await bindAgentCore(
      { projectId: PROJECT_ID, org_agent_id: AGENT_V1_ID, version: 1 },
      ORG_CTX,
    );
    await expect(
      bindAgentCore(
        { projectId: PROJECT_ID, org_agent_id: AGENT_V2_ID, version: 2 },
        ORG_CTX,
      ),
    ).rejects.toThrow(/already.*binding/i);
  });
});
