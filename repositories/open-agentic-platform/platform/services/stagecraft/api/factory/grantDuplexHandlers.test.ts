// Spec 198 FR-005/FR-010/FR-014 — run-grant + countersign handler tests.
//
// Covers: issuance happy path (signed grant, persisted chain), the
// attributable refusal reasons (not-admitted, envelope-mismatch, revoked,
// goal-shift, capsule-mismatch, seq-conflict), revocation propagation at
// renewal (the FR-010 grant leg of AC-8), idempotent re-delivery, and the
// emission countersign (chain verification + refusals).
//
// Excluded from `npm test` and run only under `encore test` — same posture
// as runDuplexHandlers.test.ts (the live DB is required). Signing uses a
// throwaway Ed25519 keypair injected via the env fallback (CONST-002: no
// committed key material).

import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { generateKeyPairSync } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "../db/drizzle";
import {
  auditLog,
  factoryAdmissions,
  factoryRevocations,
  factoryRunGrants,
  factoryRuns,
  factoryUpstreams,
  organizations,
  projects,
  users,
} from "../db/schema";
import {
  countersignRunCertificate,
  handleGrantRenew,
  handleGrantRequest,
} from "./grantDuplexHandlers";
import { exportPublicJwk, verifyCompactJws } from "./signing-pure";
import { FACTORY_RUN_GRANT_REFUSED } from "./auditActions";
import type {
  ClientFactoryRunCompleted,
  ClientFactoryRunGrantRenew,
  ClientFactoryRunGrantRequest,
} from "../sync/types";

const ORG_ID = "55555555-0000-0000-0000-0000000000b1";
const USER_ID = "55555555-0000-0000-0000-0000000000b3";
const PROJECT_ID = "55555555-0000-0000-0000-0000000000b4";
const RUN_A = "55555555-0000-0000-0000-0000000000c1";
const RUN_B = "55555555-0000-0000-0000-0000000000c2";
const RUN_C = "55555555-0000-0000-0000-0000000000c3";
const RUN_D = "55555555-0000-0000-0000-0000000000c4";

const ORIGIN = "factory-grant-test";
const ENVELOPE_HASH = "envhash-grant-test-aaa";
const CTX = { orgId: ORG_ID, userId: USER_ID };

const KID = "fk-grant-test";
const PEM = generateKeyPairSync("ed25519")
  .privateKey.export({ type: "pkcs8", format: "pem" })
  .toString();
const JWKS = [exportPublicJwk(PEM, KID)];

const META = (eventId: string) => ({
  v: 2 as const,
  eventId,
  sentAt: "2026-06-09T12:00:00Z",
});

function grantRequest(
  runId: string,
  overrides: Partial<ClientFactoryRunGrantRequest> = {},
): ClientFactoryRunGrantRequest {
  return {
    kind: "factory.run.grant_request",
    meta: META(`evt-req-${runId}-${overrides.goalId ?? "g"}`),
    runId,
    goalId: "goal-1",
    goal: "scaffold the community grant portal",
    constraints: ["no-deploy-without-gate"],
    capsuleHash: "capsule-aaa",
    envelopeHash: ENVELOPE_HASH,
    ...overrides,
  };
}

function grantRenew(
  runId: string,
  seq: number,
  overrides: Partial<ClientFactoryRunGrantRenew> = {},
): ClientFactoryRunGrantRenew {
  return {
    kind: "factory.run.grant_renew",
    meta: META(`evt-renew-${runId}-${seq}-${overrides.goalId ?? "g"}`),
    runId,
    goalId: "goal-1",
    capsuleHash: "capsule-aaa",
    seq,
    ...overrides,
  };
}

async function seedRun(runId: string): Promise<void> {
  await db.insert(factoryRuns).values({
    id: runId,
    orgId: ORG_ID,
    projectId: PROJECT_ID,
    triggeredBy: USER_ID,
    adapterId: "adapter-x",
    processId: "process-x",
    clientRunId: `client-${runId}`,
    status: "running",
    sourceShas: { adapter: "a", process: "p", contracts: {}, agents: [] },
  });
}

async function cleanup(): Promise<void> {
  await db.delete(factoryRunGrants).where(eq(factoryRunGrants.orgId, ORG_ID));
  await db.delete(factoryRuns).where(eq(factoryRuns.orgId, ORG_ID));
  await db.delete(factoryAdmissions).where(eq(factoryAdmissions.orgId, ORG_ID));
  await db
    .delete(factoryRevocations)
    .where(eq(factoryRevocations.orgId, ORG_ID));
  await db.delete(factoryUpstreams).where(eq(factoryUpstreams.orgId, ORG_ID));
  await db.delete(auditLog).where(eq(auditLog.actorUserId, USER_ID));
  await db.delete(projects).where(eq(projects.id, PROJECT_ID));
  await db.delete(organizations).where(eq(organizations.id, ORG_ID));
  await db.delete(users).where(eq(users.id, USER_ID));
}

beforeAll(async () => {
  process.env.FACTORY_SIGNING_PRIVATE_KEY = PEM;
  process.env.FACTORY_SIGNING_KID = KID;
  await cleanup();
  await db.insert(users).values({
    id: USER_ID,
    email: "grant-test-198@example.test",
    name: "Grant Test User",
  });
  await db.insert(organizations).values({
    id: ORG_ID,
    name: "Grant Test Org",
    slug: "grant-test-org-198",
  });
  await db.insert(projects).values({
    id: PROJECT_ID,
    orgId: ORG_ID,
    name: "Grant Test Project",
    slug: "grant-test-project-198",
    objectStoreBucket: "grant-test-bucket-198",
    createdBy: USER_ID,
  });
  await db.insert(factoryUpstreams).values({
    orgId: ORG_ID,
    sourceId: ORIGIN,
    role: "orchestration",
    repoUrl: "https://github.com/example/factory-grant-test.git",
    ref: "main",
  });
  await db.insert(factoryAdmissions).values({
    orgId: ORG_ID,
    origin: ORIGIN,
    status: "admitted",
    envelopeHash: ENVELOPE_HASH,
    composed: {
      process: null,
      adapters: {
        "acme-vue-encore": {
          governance: {},
          manifestHash: "manifesthash-grant-test",
        },
      },
      agentDigests: { "adapters/a/agents/x.md": "agenthash-grant-test" },
      agentIds: { "adapters/a/agents/x.md": "api-scaffolder" },
    },
    violations: [],
    scaffoldResolutions: {},
    factorySha: "f-sha",
  });
  await Promise.all([seedRun(RUN_A), seedRun(RUN_B), seedRun(RUN_C), seedRun(RUN_D)]);
});

afterAll(async () => {
  delete process.env.FACTORY_SIGNING_PRIVATE_KEY;
  delete process.env.FACTORY_SIGNING_KID;
  await cleanup();
});

describe("factory.run.grant_request (FR-005 issuance)", () => {
  it("issues a signed seq-0 grant whose claims bind the capsule", async () => {
    const { result, reply } = await handleGrantRequest(grantRequest(RUN_A), CTX);
    expect(result.ok).toBe(true);
    expect(reply?.granted).toBe(true);
    expect(reply?.seq).toBe(0);
    expect(reply?.kid).toBe(KID);

    const verified = verifyCompactJws(reply!.grantJws!, JWKS, "oap-run-grant+jwt");
    expect(verified.payload.aud).toBe("oap-opc-run");
    expect(verified.payload.org_id).toBe(ORG_ID);
    expect(verified.payload.run_id).toBe(RUN_A);
    expect(verified.payload.goal_id).toBe("goal-1");
    expect(verified.payload.capsule_hash).toBe("capsule-aaa");
    expect(verified.payload.envelope_hash).toBe(ENVELOPE_HASH);
    expect(verified.payload.seq).toBe(0);
    expect(typeof verified.payload.exp).toBe("number");

    const rows = await db
      .select()
      .from(factoryRunGrants)
      .where(eq(factoryRunGrants.runId, RUN_A));
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("issued");
  });

  it("re-serves the live grant on idempotent re-delivery", async () => {
    const first = await handleGrantRequest(grantRequest(RUN_A), CTX);
    expect(first.reply?.granted).toBe(true);
    expect(first.reply?.seq).toBe(0);
    const rows = await db
      .select()
      .from(factoryRunGrants)
      .where(eq(factoryRunGrants.runId, RUN_A));
    expect(rows).toHaveLength(1); // no second issuance
  });

  it("refuses when the presented envelope hash mismatches the admission", async () => {
    const { reply } = await handleGrantRequest(
      grantRequest(RUN_B, { envelopeHash: "stale-envelope-hash" }),
      CTX,
    );
    expect(reply?.granted).toBe(false);
    expect(reply?.refusedReason).toBe("envelope-mismatch");
  });

  it("rejects an unknown run at transport level (no refusal row)", async () => {
    const { result, reply } = await handleGrantRequest(
      grantRequest("55555555-0000-0000-0000-00000000dead"),
      CTX,
    );
    expect(result.ok).toBe(false);
    expect(reply).toBeUndefined();
  });
});

describe("factory.run.grant_renew (FR-005 renewal + FR-010 propagation)", () => {
  it("extends the chain at a stage boundary", async () => {
    const { reply } = await handleGrantRenew(grantRenew(RUN_A, 1), CTX);
    expect(reply?.granted).toBe(true);
    expect(reply?.seq).toBe(1);
    const verified = verifyCompactJws(reply!.grantJws!, JWKS, "oap-run-grant+jwt");
    expect(verified.payload.seq).toBe(1);
  });

  it("re-serves an already-issued renewal idempotently", async () => {
    const again = await handleGrantRenew(grantRenew(RUN_A, 1), CTX);
    expect(again.reply?.granted).toBe(true);
    expect(again.reply?.seq).toBe(1);
    const rows = await db
      .select()
      .from(factoryRunGrants)
      .where(eq(factoryRunGrants.runId, RUN_A));
    expect(rows.filter((r) => r.status === "issued")).toHaveLength(2);
  });

  it("refuses a goal shift and records it (ASI01 m4/m7)", async () => {
    const { reply } = await handleGrantRenew(
      grantRenew(RUN_A, 2, { goalId: "goal-SHIFTED" }),
      CTX,
    );
    expect(reply?.granted).toBe(false);
    expect(reply?.refusedReason).toBe("goal-shift");

    const refusals = await db
      .select()
      .from(factoryRunGrants)
      .where(eq(factoryRunGrants.runId, RUN_A));
    expect(refusals.some((r) => r.status === "refused")).toBe(true);
    const audits = await db
      .select()
      .from(auditLog)
      .where(eq(auditLog.action, FACTORY_RUN_GRANT_REFUSED));
    expect(audits.length).toBeGreaterThan(0);
  });

  it("refuses a capsule swap under the same goal id", async () => {
    const { reply } = await handleGrantRenew(
      grantRenew(RUN_A, 2, { capsuleHash: "capsule-EVIL" }),
      CTX,
    );
    expect(reply?.granted).toBe(false);
    expect(reply?.refusedReason).toBe("capsule-mismatch");
  });

  it("refuses a non-contiguous sequence", async () => {
    const { reply } = await handleGrantRenew(grantRenew(RUN_A, 7), CTX);
    expect(reply?.granted).toBe(false);
    expect(reply?.refusedReason).toBe("seq-conflict");
  });

  it("refuses renewal without an issuance grant", async () => {
    const { reply } = await handleGrantRenew(grantRenew(RUN_C, 1), CTX);
    expect(reply?.granted).toBe(false);
    expect(reply?.refusedReason).toBe("malformed");
  });

  it("binds the frozen Build-Spec hash one-way", async () => {
    const frozen = await handleGrantRenew(
      grantRenew(RUN_A, 2, { buildSpecHash: "bs-frozen-1" }),
      CTX,
    );
    expect(frozen.reply?.granted).toBe(true);
    const shifted = await handleGrantRenew(
      grantRenew(RUN_A, 3, { buildSpecHash: "bs-frozen-CHANGED" }),
      CTX,
    );
    expect(shifted.reply?.granted).toBe(false);
    expect(shifted.reply?.refusedReason).toBe("capsule-mismatch");
  });

  it("propagates a content-hash revocation at renewal (AC-8 grant leg)", async () => {
    await db.insert(factoryRevocations).values({
      orgId: ORG_ID,
      scopeKind: "content-hash",
      key: "agenthash-grant-test",
      mode: "quarantined",
      reason: "test: poisoned prompt advisory",
      actor: USER_ID,
    });
    try {
      const { reply } = await handleGrantRenew(grantRenew(RUN_A, 3), CTX);
      expect(reply?.granted).toBe(false);
      expect(reply?.refusedReason).toBe("revoked");
      expect(reply?.detail).toContain("agenthash-grant-test");
    } finally {
      await db
        .delete(factoryRevocations)
        .where(eq(factoryRevocations.key, "agenthash-grant-test"));
    }
  });

  it("propagates an agent-id revocation at renewal (FR-010 agent key)", async () => {
    await db.insert(factoryRevocations).values({
      orgId: ORG_ID,
      scopeKind: "agent",
      key: "api-scaffolder",
      mode: "revoked",
      reason: "test: rogue agent",
      actor: USER_ID,
    });
    try {
      const { reply } = await handleGrantRenew(grantRenew(RUN_A, 3), CTX);
      expect(reply?.granted).toBe(false);
      expect(reply?.refusedReason).toBe("revoked");
      expect(reply?.detail).toContain("api-scaffolder");
    } finally {
      await db
        .delete(factoryRevocations)
        .where(eq(factoryRevocations.key, "api-scaffolder"));
    }
  });
});

describe("emission countersign (FR-014)", () => {
  function completed(
    runId: string,
    certificateSha256: string | undefined,
    seq?: number,
  ): ClientFactoryRunCompleted {
    return {
      kind: "factory.run.completed",
      meta: META(`evt-done-${runId}`),
      runId,
      tokenSpend: { input: 1, output: 1, total: 2 },
      completedAt: "2026-06-09T13:00:00Z",
      certificateSha256,
      seq,
    };
  }

  it("returns null for ungoverned completions (no certificate hash)", async () => {
    const reply = await countersignRunCertificate(completed(RUN_A, undefined), CTX);
    expect(reply).toBeNull();
  });

  it("countersigns a certificate over a consistent issued chain", async () => {
    // RUN_A holds issued grants at seq 0..2 from the tests above.
    const reply = await countersignRunCertificate(
      completed(RUN_A, "cert-sha-aaa", 2),
      CTX,
    );
    expect(reply?.countersigned).toBe(true);
    const verified = verifyCompactJws(
      reply!.countersignJws!,
      JWKS,
      "oap-cert-countersign+jws",
    );
    expect(verified.payload.certificate_sha256).toBe("cert-sha-aaa");
    expect(verified.payload.run_id).toBe(RUN_A);
    expect(verified.payload.grant_count).toBe(3);
    expect(verified.payload.envelope_hash).toBe(ENVELOPE_HASH);

    const [run] = await db
      .select()
      .from(factoryRuns)
      .where(eq(factoryRuns.id, RUN_A));
    expect(run.countersignedAt).not.toBeNull();
  });

  it("refuses when the engine-reported final seq disagrees with the chain", async () => {
    const reply = await countersignRunCertificate(
      completed(RUN_A, "cert-sha-aaa", 9),
      CTX,
    );
    expect(reply?.countersigned).toBe(false);
    expect(reply?.refusedReason).toContain("chain head");
  });

  it("refuses to seal a run with no grant chain", async () => {
    const reply = await countersignRunCertificate(
      completed(RUN_D, "cert-sha-ddd"),
      CTX,
    );
    expect(reply?.countersigned).toBe(false);
    expect(reply?.refusedReason).toContain("no grant chain");
  });
});
