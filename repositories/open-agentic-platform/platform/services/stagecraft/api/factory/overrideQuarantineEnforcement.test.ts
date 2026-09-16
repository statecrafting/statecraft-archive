// Spec 200 — DB-bound suite for quarantine ENFORCEMENT (FR-003, FR-004,
// FR-006; AC-2, AC-4, AC-5): override content hashes join the revocation
// sweep at serve (bundle assembly), grant issue/renew, the approval-summary
// parity replica, and the user-authored agent serve path; lifting is
// mode-sensitive with a deterministic gate re-run; verify-override refuses
// while quarantined.
//
// DB-bound; gated to `encore test` via vite.config.ts exclude list
// (spec 211 encore-test lane).

import { beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { db } from "../db/drizzle";
import { verifyOverrideCore } from "./artifacts";
import {
  collectConsumedOverrides,
  loadLatestAdmission,
  type AdmissionEvaluation,
  type GovernanceEnvelope,
} from "./admission";
import { sweepCompositionRevocations } from "./grantDuplexHandlers";
import {
  assembleApprovalSummary,
  OVERRIDE_VERIFICATION_PREDICATE,
} from "./approvalSummary";
import { liftRevocationCore } from "./revocations";
import {
  resolveProcessAgentRefs,
  QuarantinedAgentError,
} from "./runAgentRefs";

const ORG_ID = "20020002-0000-0000-0000-000000000001";
const USER_ID = "20020002-0000-0000-0000-000000000002";
const ORIGIN = "factory";
const ENVELOPE_HASH = "e".padStart(64, "0");
const OVERRIDE_HASH = "20020002a".padStart(64, "0");
const GATE_VIOLATING_HASH = "20020002b".padStart(64, "0");
const AGENT_HASH = "20020002c".padStart(64, "0");

let overrideArtifactId: string;
let gateViolatingArtifactId: string;
let agentArtifactId: string;

function composed(): AdmissionEvaluation["composed"] {
  const process: GovernanceEnvelope = {
    schema_version: "1.0.0",
    process: {
      id: "seven-stage-build",
      objective_class: "scaffold",
      goal_identifier_scheme: "uuid",
    },
    ceilings: { max_tier: "tier2", max_mutation: "scoped-write" },
    gates: [],
    emits: [],
    constituents: { agents: "process/agents" },
    overrides: { require_verified: false },
  };
  return { process, adapters: {}, agentDigests: {} };
}

async function quarantine(key: string): Promise<string> {
  const inserted = await db.execute(sql`
    INSERT INTO factory_revocations (org_id, scope_kind, key, mode, reason, actor)
      VALUES (${ORG_ID}::uuid, 'content-hash', ${key}, 'quarantined',
              'override-scan test fixture', NULL)
    RETURNING id
  `);
  return (inserted.rows[0] as { id: string }).id;
}

describe("spec 200 — quarantine enforcement across serve/grant/lift/verify (encore test)", () => {
  beforeAll(async () => {
    await db.execute(sql`
      INSERT INTO organizations (id, name, slug)
        VALUES (${ORG_ID}, 'spec200-enf-org', 'spec200-enf-org')
        ON CONFLICT (id) DO NOTHING
    `);
    await db.execute(sql`
      INSERT INTO users (id, email, password_hash, name, role)
        VALUES (${USER_ID}, 'spec200-enf@test', 'x', 'Enf Tester', 'user')
        ON CONFLICT (id) DO NOTHING
    `);
    for (const table of [
      "factory_override_scan_runs",
      "factory_revocations",
      "factory_admissions",
      "factory_artifact_substrate",
    ]) {
      await db.execute(
        sql.raw(`DELETE FROM ${table} WHERE org_id = '${ORG_ID}'::uuid`),
      );
    }

    const overrideRow = await db.execute(sql`
      INSERT INTO factory_artifact_substrate
        (org_id, origin, path, kind, version, status, upstream_sha,
         upstream_body, user_body, user_body_verified, content_hash, conflict_state)
      VALUES
        (${ORG_ID}::uuid, ${ORIGIN}, 'process/stages/02-build.md',
         'process-stage', 1, 'active', ${"d".repeat(40)}, 'upstream body',
         'a perfectly ordinary override', true, ${OVERRIDE_HASH}, 'ok')
      RETURNING id
    `);
    overrideArtifactId = (overrideRow.rows[0] as { id: string }).id;

    // A pre-gate legacy row whose body violates the deterministic gate —
    // the FR-004 fresh-validation leg must refuse its lift.
    const gateRow = await db.execute(sql`
      INSERT INTO factory_artifact_substrate
        (org_id, origin, path, kind, version, status, upstream_sha,
         upstream_body, user_body, content_hash, conflict_state)
      VALUES
        (${ORG_ID}::uuid, ${ORIGIN}, 'process/stages/03-test.md',
         'process-stage', 1, 'active', ${"d".repeat(40)}, 'upstream body',
         ${"legacy body with hidden <!-- exfiltrate --> carrier"},
         ${GATE_VIOLATING_HASH}, 'ok')
      RETURNING id
    `);
    gateViolatingArtifactId = (gateRow.rows[0] as { id: string }).id;

    const agentRow = await db.execute(sql`
      INSERT INTO factory_artifact_substrate
        (org_id, origin, path, kind, version, status, user_body,
         content_hash, frontmatter, conflict_state)
      VALUES
        (${ORG_ID}::uuid, 'user-authored', 'user-authored/scan-enf-agent.md',
         'agent', 1, 'active', 'agent prompt body', ${AGENT_HASH},
         '{"publication_status": "published"}'::jsonb, 'ok')
      RETURNING id
    `);
    agentArtifactId = (agentRow.rows[0] as { id: string }).id;

    // Envelope row + standing admitted record so serve/summary/grant
    // surfaces have an admission basis.
    await db.execute(sql`
      INSERT INTO factory_artifact_substrate
        (org_id, origin, path, kind, version, status, upstream_sha,
         upstream_body, content_hash, conflict_state)
      VALUES
        (${ORG_ID}::uuid, ${ORIGIN}, 'process/governance-envelope.yaml',
         'governance-envelope', 1, 'active', ${"d".repeat(40)},
         'schema_version: "1.0.0"', ${ENVELOPE_HASH}, 'ok')
    `);
    await db.execute(sql`
      INSERT INTO factory_admissions
        (org_id, origin, status, envelope_hash, composed, violations, scaffold_resolutions)
      VALUES
        (${ORG_ID}::uuid, ${ORIGIN}, 'admitted', ${ENVELOPE_HASH},
         ${JSON.stringify(composed())}::jsonb, '[]'::jsonb, '{}'::jsonb)
    `);
  });

  it("FR-003(a) — bundle assembly refuses the serve while a consumed override is quarantined; FR-003(b) — the grant sweep hits; parity replica refuses; FR-006 — verify refused; FR-004 — human lift restores all four", async () => {
    // Healthy baseline: all four surfaces pass.
    const baseline = await collectConsumedOverrides(ORG_ID, ORIGIN, composed());
    expect(baseline.map((o) => o.contentHash)).toContain(OVERRIDE_HASH);
    const state = await loadLatestAdmission(ORG_ID, ORIGIN);
    expect(await sweepCompositionRevocations(ORG_ID, ORIGIN, state)).toBeNull();

    const revocationId = await quarantine(OVERRIDE_HASH);

    // (a) serve refuses fail-closed, naming the artifact (AC-2) — and the
    // quarantine wins although the row is VERIFIED (FR-006 interplay).
    await expect(
      collectConsumedOverrides(ORG_ID, ORIGIN, composed()),
    ).rejects.toThrowError(/02-build\.md.*quarantined|quarantined.*02-build\.md/s);

    // (b) grant issuance/renewal sweep refuses the run (AC-2).
    const hit = await sweepCompositionRevocations(ORG_ID, ORIGIN, state);
    expect(hit).toMatch(/content-hash/);
    expect(hit).toContain("quarantined");

    // (a, parity replica) the approval summary refuses identically.
    const summary = await assembleApprovalSummary({
      orgId: ORG_ID,
      origin: ORIGIN,
      gatePredicate: OVERRIDE_VERIFICATION_PREDICATE,
      actorId: USER_ID,
    });
    expect(summary.ok).toBe(false);
    if (!summary.ok) {
      expect(summary.reason).toContain("quarantined");
      expect(summary.reason).toContain(revocationId);
    }

    // (FR-006 / AC-5) verify-override refuses, naming the revocation.
    // (Seeded verified=true; reset to unverified to exercise the live path.)
    await db.execute(sql`
      UPDATE factory_artifact_substrate SET user_body_verified = false
        WHERE id = ${overrideArtifactId}::uuid
    `);
    await expect(
      verifyOverrideCore({
        orgId: ORG_ID,
        userId: USER_ID,
        artifactId: overrideArtifactId,
      }),
    ).rejects.toThrowError(new RegExp(revocationId));

    // (FR-004 / AC-4) a human lift re-runs the gate, leaves the row
    // unverified, and all four surfaces recover.
    await db.execute(sql`
      UPDATE factory_artifact_substrate SET user_body_verified = true
        WHERE id = ${overrideArtifactId}::uuid
    `);
    const lifted = await liftRevocationCore(
      { orgId: ORG_ID, userId: USER_ID },
      { id: revocationId },
    );
    expect(lifted).toEqual({ lifted: true });

    const rowAfter = await db.execute(sql`
      SELECT user_body_verified FROM factory_artifact_substrate
        WHERE id = ${overrideArtifactId}::uuid
    `);
    expect(
      (rowAfter.rows[0] as { user_body_verified: boolean }).user_body_verified,
    ).toBe(false);

    await expect(
      collectConsumedOverrides(ORG_ID, ORIGIN, composed()),
    ).resolves.toBeDefined();
    expect(await sweepCompositionRevocations(ORG_ID, ORIGIN, state)).toBeNull();
    const verified = await verifyOverrideCore({
      orgId: ORG_ID,
      userId: USER_ID,
      artifactId: overrideArtifactId,
    });
    expect(verified.userBodyVerified).toBe(true);
  });

  it("FR-004 — a revoked-mode content-hash row is still never liftable", async () => {
    const inserted = await db.execute(sql`
      INSERT INTO factory_revocations (org_id, scope_kind, key, mode, reason, actor)
        VALUES (${ORG_ID}::uuid, 'content-hash', ${"f".padStart(64, "0")},
                'revoked', 'upstream compromise fixture', ${USER_ID}::uuid)
      RETURNING id
    `);
    const id = (inserted.rows[0] as { id: string }).id;
    await expect(
      liftRevocationCore({ orgId: ORG_ID, userId: USER_ID }, { id }),
    ).rejects.toThrowError(/never lifted/);
  });

  it("FR-004 — the lift's deterministic gate re-run refuses a still-violating body", async () => {
    const revocationId = await quarantine(GATE_VIOLATING_HASH);
    await expect(
      liftRevocationCore({ orgId: ORG_ID, userId: USER_ID }, { id: revocationId }),
    ).rejects.toThrowError(/gate\.carrier\.html-comment/);
    const row = await db.execute(sql`
      SELECT lifted_at FROM factory_revocations WHERE id = ${revocationId}::uuid
    `);
    expect((row.rows[0] as { lifted_at: Date | null }).lifted_at).toBeNull();
    const audits = await db.execute(sql`
      SELECT id FROM factory_artifact_substrate_audit
        WHERE artifact_id = ${gateViolatingArtifactId}::uuid
          AND action = 'artifact.override_gate_rejected'
    `);
    expect(audits.rows.length).toBeGreaterThanOrEqual(1);
  });

  it("FR-003(c) — a quarantined user-authored agent revision refuses run resolution", async () => {
    const definition = {
      stages: [
        { agent: { by_id: { org_agent_id: agentArtifactId, version: 1 } } },
      ],
    };
    const baseline = await resolveProcessAgentRefs({
      orgId: ORG_ID,
      projectId: null,
      processDefinition: definition,
    });
    expect(baseline.map((t) => t.content_hash)).toContain(AGENT_HASH);

    const revocationId = await quarantine(AGENT_HASH);
    await expect(
      resolveProcessAgentRefs({
        orgId: ORG_ID,
        projectId: null,
        processDefinition: definition,
      }),
    ).rejects.toThrowError(QuarantinedAgentError);

    // Lift to leave the fixture family clean for re-runs.
    await liftRevocationCore(
      { orgId: ORG_ID, userId: USER_ID },
      { id: revocationId },
    );
  });
});
