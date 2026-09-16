// Spec 201 phase 2 — DB-bound tests for the approval-summary read
// endpoint (FR-001 assembly against live substrate) and AC-3 GET purity
// (reads leave the database unchanged).
//
// DB-bound; gated to `encore test` via vite.config.ts exclude list.

import { describe, expect, it, beforeAll } from "vitest";
import { sql } from "drizzle-orm";
import { db } from "../db/drizzle";
import {
  approveRunGateCore,
  getArtifactApprovalSummaryCore,
  getRunApprovalContextCore,
} from "./approvalSummary";
import {
  getArtifactByIdCore,
  listArtifactsCore,
  verifyOverrideCore,
} from "./artifacts";

const ORG_ID = "88888888-0000-0000-0000-000000000001";
const USER_ID = "88888888-0000-0000-0000-000000000002";
const ORIGIN = "factory";
const ENVELOPE_HASH = "3".padStart(64, "0");

let overriddenId: string;
let userAuthoredId: string;
let runId: string;

const AUTH = { orgId: ORG_ID, userID: USER_ID };

describe("spec 201 — /api/factory/artifacts/:id/approval-summary (encore test)", () => {
  beforeAll(async () => {
    await db.execute(sql`
      INSERT INTO organizations (id, name, slug)
        VALUES (${ORG_ID}, 'spec201-as-org', 'spec201-as-org')
        ON CONFLICT (id) DO NOTHING
    `);
    await db.execute(sql`
      INSERT INTO users (id, email, password_hash, name, role)
        VALUES (${USER_ID}, 'spec201-as@test', 'x', 'AS Tester', 'user')
        ON CONFLICT (id) DO NOTHING
    `);
    await db.execute(sql`
      DELETE FROM factory_artifact_substrate WHERE org_id = ${ORG_ID}::uuid
    `);
    await db.execute(sql`
      DELETE FROM factory_admissions WHERE org_id = ${ORG_ID}::uuid
    `);

    const overridden = await db.execute(sql`
      INSERT INTO factory_artifact_substrate
        (org_id, origin, path, kind, version, status, upstream_sha, upstream_body, user_body, user_modified_by, content_hash, conflict_state)
      VALUES
        (${ORG_ID}::uuid, ${ORIGIN},
         'process/agents/architect.md', 'agent', 1, 'active',
         ${"a".repeat(40)}, 'upstream agent body', 'overridden agent body',
         ${USER_ID}::uuid, ${"4".padStart(64, "0")}, 'ok')
      RETURNING id
    `);
    overriddenId = (overridden.rows[0] as { id: string }).id;

    const userAuthored = await db.execute(sql`
      INSERT INTO factory_artifact_substrate
        (org_id, origin, path, kind, version, status, user_body, user_modified_by, content_hash, conflict_state)
      VALUES
        (${ORG_ID}::uuid, 'user-authored',
         'agents/custom.md', 'agent', 1, 'active', 'custom agent body',
         ${USER_ID}::uuid, ${"5".padStart(64, "0")}, 'ok')
      RETURNING id
    `);
    userAuthoredId = (userAuthored.rows[0] as { id: string }).id;

    await db.execute(sql`
      INSERT INTO factory_artifact_substrate
        (org_id, origin, path, kind, version, status, upstream_sha, upstream_body, content_hash, conflict_state)
      VALUES
        (${ORG_ID}::uuid, ${ORIGIN},
         'process/governance-envelope.yaml', 'governance-envelope', 1, 'active',
         ${"b".repeat(40)}, 'schema_version: "1.0.0"', ${ENVELOPE_HASH}, 'ok')
    `);
    const composed = JSON.stringify({
      process: {
        schema_version: "1.0.0",
        process: {
          id: "factory-process",
          objective_class: "scaffold",
          goal_identifier_scheme: "uuid",
        },
        ceilings: { max_tier: "tier2", max_mutation: "scoped-write" },
        gates: [{ predicate: "approval-before-build-spec-freeze" }],
        emits: [{ kind: "build-spec" }],
        constituents: { agents: "process/agents/*.md" },
        overrides: { require_verified: true },
      },
      adapters: {},
      agentDigests: {},
    });
    await db.execute(sql`
      INSERT INTO factory_admissions
        (org_id, origin, status, envelope_hash, composed, violations, scaffold_resolutions)
      VALUES
        (${ORG_ID}::uuid, ${ORIGIN}, 'admitted', ${ENVELOPE_HASH},
         ${composed}::jsonb, '[]'::jsonb, '{}'::jsonb)
    `);

    // Spec 201 phase 3 — run-gate fixtures: the origin resolver reads
    // factory_upstreams (role orchestration/mixed → factory origin), and
    // the approve path needs an org-scoped factory_runs row.
    await db.execute(sql`
      INSERT INTO factory_upstreams (
        org_id, source_id, role, repo_url, ref, subpath, created_at, updated_at
      ) VALUES (
        ${ORG_ID}::uuid, ${ORIGIN}, 'orchestration',
        'statecrafting/factory', 'main', NULL, now(), now()
      )
      ON CONFLICT (org_id, source_id) DO NOTHING
    `);
    await db.execute(sql`
      DELETE FROM audit_log
        WHERE action = 'factory.run.gate_approved'
          AND target_id IN (
            SELECT id::text FROM factory_runs WHERE org_id = ${ORG_ID}::uuid
          )
    `);
    await db.execute(sql`
      DELETE FROM factory_runs WHERE org_id = ${ORG_ID}::uuid
    `);
    const run = await db.execute(sql`
      INSERT INTO factory_runs
        (org_id, triggered_by, adapter_id, process_id, client_run_id, status, source_shas)
      VALUES
        (${ORG_ID}::uuid, ${USER_ID}::uuid, 'adapter:spec201', 'process:spec201',
         'spec201-run-1', 'running',
         '{"adapter":"a","process":"p","contracts":{},"agents":[]}'::jsonb)
      RETURNING id
    `);
    runId = (run.rows[0] as { id: string }).id;
  });

  it("assembles the basis for an admitted-origin override (FR-001)", async () => {
    const res = await getArtifactApprovalSummaryCore(AUTH, {
      id: overriddenId,
    });
    expect(res.applicable).toBe(true);
    expect(res.ok).toBe(true);
    const s = res.summary;
    if (!s) throw new Error("expected ok summary");
    expect(s.gatePredicate).toBe("overrides.require_verified");
    expect(s.provenanceLinks).toHaveLength(1);
    expect(s.provenanceLinks[0].kind).toBe("governance-envelope");
    expect(s.provenanceLinks[0].contentHash).toBe(ENVELOPE_HASH);
    expect(s.consumedOverrides).toHaveLength(1);
    expect(s.consumedOverrides[0].path).toBe("process/agents/architect.md");
    expect(s.consumedOverrides[0].requireVerifiedSatisfied).toBe(false);
    expect(s.summaryHash).toMatch(/^[0-9a-f]{64}$/);
    expect(s.actorId).toBe(USER_ID);
  });

  it("returns the user-authored trust class without a summary (FR-004 scope)", async () => {
    const res = await getArtifactApprovalSummaryCore(AUTH, {
      id: userAuthoredId,
    });
    expect(res).toEqual({ applicable: false });
  });

  it("AC-3 — the read path writes no rows", async () => {
    // Org-scoped counts: other DB-bound suites run concurrently in the
    // same database, so global counts race; this org is exclusively ours.
    const counts = async () => {
      const [a] = (
        await db.execute(sql`
          SELECT (SELECT count(*) FROM factory_artifact_substrate_audit
                    WHERE org_id = ${ORG_ID}::uuid)::int AS substrate_audit,
                 (SELECT count(*) FROM audit_log
                    WHERE actor_user_id = ${USER_ID})::int AS audit_log,
                 (SELECT count(*) FROM factory_runs
                    WHERE org_id = ${ORG_ID}::uuid)::int AS factory_runs,
                 (SELECT count(*) FROM factory_artifact_substrate
                    WHERE org_id = ${ORG_ID}::uuid)::int AS substrate
        `)
      ).rows as Array<Record<string, number>>;
      return a;
    };
    const before = await counts();
    await listArtifactsCore(AUTH, {});
    await getArtifactByIdCore(AUTH, { id: overriddenId });
    await getArtifactApprovalSummaryCore(AUTH, { id: overriddenId });
    await getRunApprovalContextCore(AUTH, { id: runId });
    const after = await counts();
    expect(after).toEqual(before);
  });
});

// Spec 201 phase 3 — run-level HITL gate: context assembly, FR-002
// withhold, FR-003 (b) replay guard, FR-004 audit row, idempotency.
// Sequential within this file; the verify step below intentionally
// resolves the withhold for the approve tests that follow.
describe("spec 201 phase 3 — run gate approve (encore test)", () => {
  it("context: assembled basis with the withhold list (FR-002)", async () => {
    const ctx = await getRunApprovalContextCore(AUTH, { id: runId });
    expect(ctx.requiredStageIds).toEqual(["s1", "s2", "s3"]);
    expect(ctx.ok).toBe(true);
    expect(ctx.gatePredicate).toBe("approval-before-build-spec-freeze");
    expect(ctx.blockingOverridePaths).toEqual([
      "process/agents/architect.md",
    ]);
    expect(ctx.approvals).toEqual([]);
  });

  it("approve is withheld while an override is envelope-unsatisfied", async () => {
    const ctx = await getRunApprovalContextCore(AUTH, { id: runId });
    await expect(
      approveRunGateCore(AUTH, {
        id: runId,
        stageId: "s1",
        summaryHash: ctx.summary!.summaryHash,
      }),
    ).rejects.toThrowError(/withheld.*architect\.md/s);
  });

  it("refuses a non-gated stage id", async () => {
    await expect(
      approveRunGateCore(AUTH, {
        id: runId,
        stageId: "s0",
        summaryHash: "x".repeat(64),
      }),
    ).rejects.toThrowError(/not a gated stage/);
  });

  it("replay guard: a stale summaryHash is refused (FR-003 b)", async () => {
    // Resolve the withhold first — verify the override (the FR-013 c
    // resolution path).
    await verifyOverrideCore({
      orgId: ORG_ID,
      userId: USER_ID,
      artifactId: overriddenId,
    });
    await expect(
      approveRunGateCore(AUTH, {
        id: runId,
        stageId: "s1",
        // A hash assembled against the PRE-verify DB state — now stale.
        summaryHash: "0".repeat(64),
      }),
    ).rejects.toThrowError(/stale approval summary/);
  });

  it("approves with a fresh hash; audit row carries the basis (FR-004)", async () => {
    const ctx = await getRunApprovalContextCore(AUTH, { id: runId });
    expect(ctx.blockingOverridePaths).toEqual([]);
    const res = await approveRunGateCore(AUTH, {
      id: runId,
      stageId: "s1",
      summaryHash: ctx.summary!.summaryHash,
    });
    expect(res.created).toBe(true);
    expect(res.approval.stageId).toBe("s1");
    expect(res.approval.gatePredicate).toBe(
      "approval-before-build-spec-freeze",
    );
    expect(res.approval.summaryHash).toBe(ctx.summary!.summaryHash);

    const rows = await db.execute(sql`
      SELECT metadata FROM audit_log
        WHERE action = 'factory.run.gate_approved'
          AND target_id = ${runId}
    `);
    expect(rows.rows.length).toBe(1);
    const meta = (rows.rows[0] as { metadata: Record<string, unknown> })
      .metadata;
    expect(meta.stageId).toBe("s1");
    expect(meta.summaryHash).toBe(ctx.summary!.summaryHash);
    expect(meta.gatePredicate).toBe("approval-before-build-spec-freeze");
    expect(Array.isArray(meta.provenanceLinks)).toBe(true);
    expect(meta.consumedOverrideCount).toBe(1);
  });

  it("re-approving the same stage is idempotent — no second audit row", async () => {
    const ctx = await getRunApprovalContextCore(AUTH, { id: runId });
    const res = await approveRunGateCore(AUTH, {
      id: runId,
      stageId: "s1",
      summaryHash: ctx.summary!.summaryHash,
    });
    expect(res.created).toBe(false);
    const rows = await db.execute(sql`
      SELECT id FROM audit_log
        WHERE action = 'factory.run.gate_approved'
          AND target_id = ${runId}
    `);
    expect(rows.rows.length).toBe(1);
  });

  it("context now carries the recorded approval", async () => {
    const ctx = await getRunApprovalContextCore(AUTH, { id: runId });
    expect(ctx.approvals).toHaveLength(1);
    expect(ctx.approvals[0].stageId).toBe("s1");
    expect(ctx.approvals[0].approvedBy).toBe(USER_ID);
  });
});
