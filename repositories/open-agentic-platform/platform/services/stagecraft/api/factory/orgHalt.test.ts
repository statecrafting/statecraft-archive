// Spec 208 FR-001/FR-002/FR-004 (AC-2): org-wide kill-switch enforcement.
//
// Covers the shared fail-closed consult (isHaltedInScope) across the full
// scope lattice (org / project / agent-profile, plus the lifted and
// reintegrating states), the verb lifecycle (pullHaltCore / liftHaltCore +
// their audit emission and the human-actor / validation gates), and the
// end-to-end AC-2 refusals: with a halt active, grant issuance and grant
// renewal are refused with reason "halted" and a detail that names the
// quarantine record. Project-scope precision is proven both directions: a
// sibling-project halt leaves the grant working, and a same-project halt
// refuses it.
//
// Excluded from `npm test` and run only under `encore test` (the live DB is
// required), same posture as grantDuplexHandlers.test.ts. Signing uses a
// throwaway Ed25519 keypair injected via the env fallback (CONST-002: no
// committed key material) so grantPreflight reaches the halt consult instead
// of short-circuiting on signing-unconfigured.

import { describe, expect, it, beforeAll, afterAll, afterEach } from "vitest";
import { generateKeyPairSync } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "../db/drizzle";
import {
  auditLog,
  factoryAdmissions,
  factoryRunGrants,
  factoryRuns,
  factoryUpstreams,
  orgHalts,
  organizations,
  projects,
  users,
  type OrgHaltInsert,
} from "../db/schema";
import { handleGrantRenew, handleGrantRequest } from "./grantDuplexHandlers";
import { isHaltedInScope, liftHaltCore, pullHaltCore } from "./orgHalt";
import {
  FACTORY_ORG_HALT_ACK_DROPPED,
  FACTORY_ORG_HALT_ACTIVATED,
  FACTORY_ORG_HALT_ENGINE_ACK,
  FACTORY_ORG_HALT_LIFTED,
  FACTORY_ORG_HALT_REASSERTED,
  FACTORY_ORG_HALT_REINTEGRATED,
  FACTORY_RUN_GRANT_REFUSED,
} from "./auditActions";
import { handleInbound } from "../sync/service";
import { outbox } from "../sync/store";
import type {
  ClientFactoryRunGrantRenew,
  ClientFactoryRunGrantRequest,
  ClientOrgHaltAck,
  ServerOrgHaltActivated,
} from "../sync/types";

const ORG_ID = "20808080-0000-0000-0000-0000000000a1";
const USER_ID = "20808080-0000-0000-0000-0000000000a3";
const PROJECT_ID = "20808080-0000-0000-0000-0000000000a4";
const SIBLING_PROJECT_ID = "20808080-0000-0000-0000-0000000000a5";
const AGENT_PROFILE = "api-scaffolder";

const RUN_ISSUE = "20808080-0000-0000-0000-0000000000c1";
const RUN_RENEW = "20808080-0000-0000-0000-0000000000c2";
const RUN_SIBLING = "20808080-0000-0000-0000-0000000000c3";
const RUN_PROJ = "20808080-0000-0000-0000-0000000000c4";
// Spec 208 Phase 3 fresh runs (distinct ids so grant chains do not accrete
// across tests, matching the RUN_ISSUE/RUN_RENEW/RUN_SIBLING/RUN_PROJ pattern).
const RUN_AP = "20808080-0000-0000-0000-0000000000c5";
const RUN_AP_ISS = "20808080-0000-0000-0000-0000000000c6";
const RUN_REINT = "20808080-0000-0000-0000-0000000000c7";

const ORIGIN = "factory-halt-test";
const ENVELOPE_HASH = "envhash-halt-test-aaa";
const CTX = { orgId: ORG_ID, userId: USER_ID };
const AUTH = { orgId: ORG_ID, userId: USER_ID };

const KID = "fk-halt-test";
const PEM = generateKeyPairSync("ed25519")
  .privateKey.export({ type: "pkcs8", format: "pem" })
  .toString();

const META = (eventId: string) => ({
  v: 2 as const,
  eventId,
  sentAt: "2026-06-24T12:00:00Z",
});

function grantRequest(
  runId: string,
  overrides: Partial<ClientFactoryRunGrantRequest> = {},
): ClientFactoryRunGrantRequest {
  return {
    kind: "factory.run.grant_request",
    meta: META(`evt-req-${runId}`),
    runId,
    goalId: "goal-1",
    goal: "scaffold the portal",
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
    meta: META(`evt-renew-${runId}-${seq}`),
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

/** Insert a halt row directly with sensible defaults (state control for the
 * lattice tests; the verb suite uses pullHaltCore instead). */
async function insertHalt(
  overrides: Partial<OrgHaltInsert> & Pick<OrgHaltInsert, "scope" | "scopeKey">,
): Promise<string> {
  const [row] = await db
    .insert(orgHalts)
    .values({
      orgId: ORG_ID,
      state: "halted",
      reason: "test halt",
      pulledBy: USER_ID,
      ...overrides,
    })
    .returning({ id: orgHalts.id });
  return row.id;
}

async function clearHalts(): Promise<void> {
  await db.delete(orgHalts).where(eq(orgHalts.orgId, ORG_ID));
}

async function cleanup(): Promise<void> {
  await clearHalts();
  await db.delete(factoryRunGrants).where(eq(factoryRunGrants.orgId, ORG_ID));
  await db.delete(factoryRuns).where(eq(factoryRuns.orgId, ORG_ID));
  await db.delete(factoryAdmissions).where(eq(factoryAdmissions.orgId, ORG_ID));
  await db.delete(factoryUpstreams).where(eq(factoryUpstreams.orgId, ORG_ID));
  await db.delete(auditLog).where(eq(auditLog.actorUserId, USER_ID));
  await db.delete(projects).where(eq(projects.id, SIBLING_PROJECT_ID));
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
    email: "halt-test-208@example.test",
    name: "Halt Test User",
  });
  await db.insert(organizations).values({
    id: ORG_ID,
    name: "Halt Test Org",
    slug: "halt-test-org-208",
  });
  await db.insert(projects).values([
    {
      id: PROJECT_ID,
      orgId: ORG_ID,
      name: "Halt Test Project",
      slug: "halt-test-project-208",
      objectStoreBucket: "halt-test-bucket-208",
      createdBy: USER_ID,
    },
    {
      id: SIBLING_PROJECT_ID,
      orgId: ORG_ID,
      name: "Halt Sibling Project",
      slug: "halt-sibling-project-208",
      objectStoreBucket: "halt-sibling-bucket-208",
      createdBy: USER_ID,
    },
  ]);
  await db.insert(factoryUpstreams).values({
    orgId: ORG_ID,
    sourceId: ORIGIN,
    role: "orchestration",
    repoUrl: "https://github.com/example/factory-halt-test.git",
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
        "acme-vue-encore": { governance: {}, manifestHash: "manifesthash-halt" },
      },
      agentDigests: { "adapters/a/agents/x.md": "agenthash-halt" },
      agentIds: { "adapters/a/agents/x.md": AGENT_PROFILE },
    },
    violations: [],
    scaffoldResolutions: {},
    factorySha: "f-sha",
  });
  await Promise.all([
    seedRun(RUN_ISSUE),
    seedRun(RUN_RENEW),
    seedRun(RUN_SIBLING),
    seedRun(RUN_PROJ),
    seedRun(RUN_AP),
    seedRun(RUN_AP_ISS),
    seedRun(RUN_REINT),
  ]);
});

afterAll(async () => {
  delete process.env.FACTORY_SIGNING_PRIVATE_KEY;
  delete process.env.FACTORY_SIGNING_KID;
  await cleanup();
});

// No halt may leak across tests: a stray org halt would make the renewal
// test's clean issuance fail closed.
afterEach(async () => {
  await clearHalts();
});

describe("isHaltedInScope (scope lattice, FR-001/FR-004)", () => {
  it("an org halt subsumes every scope query", async () => {
    const id = await insertHalt({ scope: "org", scopeKey: ORG_ID });
    expect(await isHaltedInScope(ORG_ID)).toBe(id);
    expect(await isHaltedInScope(ORG_ID, { projectId: PROJECT_ID })).toBe(id);
    expect(await isHaltedInScope(ORG_ID, { agentProfile: AGENT_PROFILE })).toBe(
      id,
    );
  });

  it("a project halt matches its project, not a sibling", async () => {
    const id = await insertHalt({ scope: "project", scopeKey: PROJECT_ID });
    expect(await isHaltedInScope(ORG_ID, { projectId: PROJECT_ID })).toBe(id);
    expect(
      await isHaltedInScope(ORG_ID, { projectId: SIBLING_PROJECT_ID }),
    ).toBeNull();
    // No projectId in scope (e.g. the org-wide duplex seam) does not match a
    // project-scoped halt.
    expect(await isHaltedInScope(ORG_ID)).toBeNull();
  });

  it("an agent-profile halt matches its profile, not another", async () => {
    const id = await insertHalt({
      scope: "agent-profile",
      scopeKey: AGENT_PROFILE,
    });
    expect(await isHaltedInScope(ORG_ID, { agentProfile: AGENT_PROFILE })).toBe(
      id,
    );
    expect(
      await isHaltedInScope(ORG_ID, { agentProfile: "other-profile" }),
    ).toBeNull();
  });

  it("a lifted halt no longer matches", async () => {
    await insertHalt({ scope: "org", scopeKey: ORG_ID, state: "lifted" });
    expect(await isHaltedInScope(ORG_ID)).toBeNull();
  });

  it("a reintegrating halt still matches (FR-004 stays enforced)", async () => {
    const id = await insertHalt({
      scope: "org",
      scopeKey: ORG_ID,
      state: "reintegrating",
    });
    expect(await isHaltedInScope(ORG_ID)).toBe(id);
  });
});

describe("pullHaltCore / liftHaltCore (FR-001/FR-004 verb + audit)", () => {
  it("pullHaltCore writes a halted row and audits activation", async () => {
    const res = await pullHaltCore(AUTH, {
      scope: "org",
      reason: "supply-chain incident",
    });
    expect(res.state).toBe("halted");
    expect(res.scopeKey).toBe(ORG_ID);

    const [row] = await db
      .select()
      .from(orgHalts)
      .where(eq(orgHalts.id, res.haltId));
    expect(row.state).toBe("halted");
    expect(row.reason).toBe("supply-chain incident");
    expect(row.pulledBy).toBe(USER_ID);

    const audits = await db
      .select()
      .from(auditLog)
      .where(eq(auditLog.action, FACTORY_ORG_HALT_ACTIVATED));
    expect(audits.some((a) => a.targetId === res.haltId)).toBe(true);
  });

  it("pullHaltCore rejects an empty reason", async () => {
    await expect(
      pullHaltCore(AUTH, { scope: "org", reason: "   " }),
    ).rejects.toThrow(/non-empty reason/);
  });

  it("pullHaltCore rejects a project scope with no scopeKey", async () => {
    await expect(
      pullHaltCore(AUTH, { scope: "project", reason: "bad" }),
    ).rejects.toThrow(/scopeKey is required/);
  });

  it("pullHaltCore accepts an agent-profile scope (Phase 3, enforced at renewal)", async () => {
    const res = await pullHaltCore(AUTH, {
      scope: "agent-profile",
      scopeKey: AGENT_PROFILE,
      reason: "surgical",
    });
    expect(res.state).toBe("halted");
    expect(res.scope).toBe("agent-profile");
    expect(res.scopeKey).toBe(AGENT_PROFILE);
    const [row] = await db
      .select()
      .from(orgHalts)
      .where(eq(orgHalts.id, res.haltId));
    expect(row.scope).toBe("agent-profile");
    expect(row.scopeKey).toBe(AGENT_PROFILE);
  });

  it("pullHaltCore is idempotent: a repeated pull returns the same record", async () => {
    const first = await pullHaltCore(AUTH, { scope: "org", reason: "incident" });
    const second = await pullHaltCore(AUTH, {
      scope: "org",
      reason: "incident again",
    });
    expect(second.haltId).toBe(first.haltId);
    const rows = await db
      .select()
      .from(orgHalts)
      .where(eq(orgHalts.orgId, ORG_ID));
    expect(rows).toHaveLength(1);
  });

  it("liftHaltCore transitions halted to reintegrating and audits the lift", async () => {
    const pulled = await pullHaltCore(AUTH, {
      scope: "project",
      scopeKey: PROJECT_ID,
      reason: "drill",
    });
    const lifted = await liftHaltCore(AUTH, { id: pulled.haltId });
    expect(lifted.state).toBe("reintegrating");

    const [row] = await db
      .select()
      .from(orgHalts)
      .where(eq(orgHalts.id, pulled.haltId));
    expect(row.state).toBe("reintegrating");
    expect(row.liftedBy).toBe(USER_ID);
    expect(row.liftedAt).not.toBeNull();

    const audits = await db
      .select()
      .from(auditLog)
      .where(eq(auditLog.action, FACTORY_ORG_HALT_LIFTED));
    expect(audits.some((a) => a.targetId === pulled.haltId)).toBe(true);
  });

  it("liftHaltCore refuses a non-halted record", async () => {
    const pulled = await pullHaltCore(AUTH, {
      scope: "org",
      reason: "twice",
    });
    await liftHaltCore(AUTH, { id: pulled.haltId }); // -> reintegrating
    await expect(liftHaltCore(AUTH, { id: pulled.haltId })).rejects.toThrow(
      /not 'halted'/,
    );
  });

  it("liftHaltCore refuses a record from another org", async () => {
    const pulled = await pullHaltCore(AUTH, { scope: "org", reason: "x" });
    await expect(
      liftHaltCore(
        { orgId: "20808080-0000-0000-0000-0000000000ff", userId: USER_ID },
        { id: pulled.haltId },
      ),
    ).rejects.toThrow(/not found/);
  });
});

describe("grant refusal under halt (AC-2, FR-001/FR-002)", () => {
  it("refuses grant issuance during an org halt, naming the record", async () => {
    const halt = await pullHaltCore(AUTH, {
      scope: "org",
      reason: "rogue divergence",
    });
    const { reply } = await handleGrantRequest(grantRequest(RUN_ISSUE), CTX);
    expect(reply?.granted).toBe(false);
    expect(reply?.refusedReason).toBe("halted");
    expect(reply?.detail).toContain(halt.haltId);

    const audits = await db
      .select()
      .from(auditLog)
      .where(eq(auditLog.action, FACTORY_RUN_GRANT_REFUSED));
    expect(audits.length).toBeGreaterThan(0);
  });

  it("refuses grant renewal during an org halt (in-flight run pauses)", async () => {
    // Clean issuance first (no halt active), then halt, then renew.
    const issued = await handleGrantRequest(grantRequest(RUN_RENEW), CTX);
    expect(issued.reply?.granted).toBe(true);

    await pullHaltCore(AUTH, { scope: "org", reason: "halt mid-run" });
    const { reply } = await handleGrantRenew(grantRenew(RUN_RENEW, 1), CTX);
    expect(reply?.granted).toBe(false);
    expect(reply?.refusedReason).toBe("halted");
  });

  it("a sibling-project halt leaves the grant working; a same-project halt refuses it", async () => {
    // A halt on the sibling project must not refuse our project's grant (AC-3
    // scope precision); the run is bound to PROJECT_ID.
    await pullHaltCore(AUTH, {
      scope: "project",
      scopeKey: SIBLING_PROJECT_ID,
      reason: "sibling only",
    });
    const ok = await handleGrantRequest(grantRequest(RUN_SIBLING), CTX);
    expect(ok.reply?.granted).toBe(true);
    await clearHalts();

    // A halt on our own project refuses (project-scoped precision the other
    // direction).
    const halt = await pullHaltCore(AUTH, {
      scope: "project",
      scopeKey: PROJECT_ID,
      reason: "our project",
    });
    const refused = await handleGrantRequest(grantRequest(RUN_PROJ), CTX);
    expect(refused.reply?.granted).toBe(false);
    expect(refused.reply?.refusedReason).toBe("halted");
    expect(refused.reply?.detail).toContain(halt.haltId);
  });
});

// Spec 208 Phase 2 (PR-2): the propagation seam. A fresh pull broadcasts
// org.halt.activated over the outbox-durable path (FR-001/FR-003), and the
// engine's org.halt.ack records the per-engine propagation bound on the
// quarantine record (FR-003, the AC-4 halt-ack leg). The engine-side pause +
// checkpoint and the full three-session drill are covered by the OPC Rust
// unit suite and the Phase 5 e2e drill respectively.
describe("org-halt propagation (FR-001/FR-003, AC-4 ack leg)", () => {
  const CLIENT_ID = "20808080-0000-0000-0000-0000000000e1";
  const OTHER_ORG_ID = "20808080-0000-0000-0000-0000000000ff";

  function orgHaltAck(
    haltId: string,
    haltKind: "halt" | "lift",
    ackedAt: string,
  ): ClientOrgHaltAck {
    return {
      kind: "org.halt.ack",
      meta: META(`evt-ack-${haltId}-${haltKind}`),
      haltId,
      haltKind,
      ackedAt,
    };
  }

  it("broadcasts org.halt.activated to the org on a fresh pull", async () => {
    const halt = await pullHaltCore(AUTH, {
      scope: "org",
      reason: "fleet stop",
    });
    // A fresh client (acked nothing) sees every pending outbox event; filter to
    // ours by halt id so cross-test outbox accretion cannot perturb this.
    const pending = await outbox.loadPendingForClient(ORG_ID, "probe-client");
    const activated = pending.find(
      (e): e is ServerOrgHaltActivated =>
        e.kind === "org.halt.activated" && e.haltId === halt.haltId,
    );
    expect(activated).toBeDefined();
    expect(activated?.scope).toBe("org");
    expect(activated?.scopeKey).toBe(ORG_ID);
    // The free-form reason rides `detail` (the `reason` field is the closed
    // nack/resync union on the server wire).
    expect(activated?.detail).toBe("fleet stop");
  });

  it("records a per-engine halt ack timestamp and audits engine_ack", async () => {
    const halt = await pullHaltCore(AUTH, {
      scope: "org",
      reason: "ack me",
    });
    const ackedAt = "2026-06-25T12:34:56.000Z";
    const res = await handleInbound(
      { orgId: ORG_ID, clientId: CLIENT_ID, userId: USER_ID },
      orgHaltAck(halt.haltId, "halt", ackedAt),
    );
    expect(res.ok).toBe(true);

    const [row] = await db
      .select({ acks: orgHalts.acks })
      .from(orgHalts)
      .where(eq(orgHalts.id, halt.haltId));
    // The engine-claimed `ackedAt` is retained as an observation; the server
    // additionally stamps `recordedAt` (the trustworthy propagation bound) and
    // `clientId` from the authenticated session, never the wire.
    expect(row.acks).toEqual([
      {
        clientId: CLIENT_ID,
        ackedAt,
        recordedAt: expect.any(String),
        kind: "halt",
      },
    ]);

    const audits = await db
      .select()
      .from(auditLog)
      .where(eq(auditLog.action, FACTORY_ORG_HALT_ENGINE_ACK));
    const mine = audits.find((a) => a.targetId === halt.haltId);
    expect(mine).toBeDefined();
    expect(mine?.targetType).toBe("org_halts");
    const meta = mine?.metadata as Record<string, unknown>;
    expect(meta?.clientId).toBe(CLIENT_ID);
    expect(meta?.ackedAt).toBe(ackedAt);
    expect(meta?.recordedAt).toEqual(expect.any(String));
  });

  it("a replayed ack is idempotent: no duplicate acks entry or audit row", async () => {
    // The broadcast is outbox-durable, so a reconnecting engine replays the
    // halt on resync and re-acks. The second ack must not grow the acks array
    // or emit a duplicate engine_ack audit row (FR-003 records the bound once).
    const halt = await pullHaltCore(AUTH, { scope: "org", reason: "replay me" });
    const ctx = { orgId: ORG_ID, clientId: CLIENT_ID, userId: USER_ID };
    const firstAckedAt = "2026-06-25T01:02:03.000Z";

    const first = await handleInbound(
      ctx,
      orgHaltAck(halt.haltId, "halt", firstAckedAt),
    );
    const second = await handleInbound(
      ctx,
      orgHaltAck(halt.haltId, "halt", "2026-06-25T09:09:09.000Z"),
    );
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);

    const [row] = await db
      .select({ acks: orgHalts.acks })
      .from(orgHalts)
      .where(eq(orgHalts.id, halt.haltId));
    expect(row.acks).toHaveLength(1);
    // The replay did not overwrite the first ack's recorded boundary.
    expect(row.acks[0].ackedAt).toBe(firstAckedAt);

    const audits = await db
      .select()
      .from(auditLog)
      .where(eq(auditLog.action, FACTORY_ORG_HALT_ENGINE_ACK));
    expect(audits.filter((a) => a.targetId === halt.haltId)).toHaveLength(1);
  });

  it("ignores a cross-org ack without mutating the record", async () => {
    const halt = await pullHaltCore(AUTH, {
      scope: "org",
      reason: "cross-org probe",
    });
    // An ack arriving on a session authenticated for a different org must not
    // touch this org's quarantine record (the org-scoped UPDATE matches zero
    // rows; the dispatch returns invalid rather than leaking existence).
    const res = await handleInbound(
      { orgId: OTHER_ORG_ID, clientId: CLIENT_ID, userId: USER_ID },
      orgHaltAck(halt.haltId, "halt", "2026-06-25T00:00:00.000Z"),
    );
    expect(res.ok).toBe(false);

    const [row] = await db
      .select({ acks: orgHalts.acks })
      .from(orgHalts)
      .where(eq(orgHalts.id, halt.haltId));
    expect(row.acks).toEqual([]);
  });
});

// Spec 208 Phase 3 (PR-3): the agent-profile seam (AC-3, enforced at grant
// renewal), staged reintegration completion with two-sided validation (FR-004,
// AC-4 lift leg), the reintegrating-state refusal (AC-7), and the re-halt
// reassertion (D3). The engine-side org.halt.lifted ack and the profile
// resolution from the reservation-time stage-agent map are covered by the OPC
// Rust unit suite.
describe("agent-profile halt enforcement (AC-3, Phase 3, grant renewal)", () => {
  it("refuses renewal for the halted profile but grants a sibling profile", async () => {
    const issued = await handleGrantRequest(grantRequest(RUN_AP), CTX);
    expect(issued.reply?.granted).toBe(true);

    await pullHaltCore(AUTH, {
      scope: "agent-profile",
      scopeKey: AGENT_PROFILE,
      reason: "surgical profile halt",
    });

    // A renewal presenting a DIFFERENT profile is not in scope: granted, and it
    // advances the chain head to seq 1.
    const sibling = await handleGrantRenew(
      grantRenew(RUN_AP, 1, { agentProfile: "other-profile" }),
      CTX,
    );
    expect(sibling.reply?.granted).toBe(true);

    // A renewal presenting the halted profile is refused (AC-3); reason
    // "halted", the same class as the org/project legs.
    const { reply } = await handleGrantRenew(
      grantRenew(RUN_AP, 2, { agentProfile: AGENT_PROFILE }),
      CTX,
    );
    expect(reply?.granted).toBe(false);
    expect(reply?.refusedReason).toBe("halted");
  });

  it("does not gate issuance on an agent-profile halt (issuance carries no profile)", async () => {
    // Enforcement is at renewal only: a run spans several profiles, so issuance
    // has no single profile to check. A run whose stage profile is halted is
    // issued (an auditable no-op) then refused at the first renewal before s0.
    await pullHaltCore(AUTH, {
      scope: "agent-profile",
      scopeKey: AGENT_PROFILE,
      reason: "issuance passthrough",
    });
    const issued = await handleGrantRequest(grantRequest(RUN_AP_ISS), CTX);
    expect(issued.reply?.granted).toBe(true);
  });
});

describe("scope union independence (T015a, AC-3)", () => {
  it("a lifted org halt does not suppress an independent active project halt", async () => {
    await insertHalt({ scope: "org", scopeKey: ORG_ID, state: "lifted" });
    const projHalt = await insertHalt({
      scope: "project",
      scopeKey: PROJECT_ID,
      state: "halted",
    });
    // The org query alone sees no active org halt (the org row is lifted)...
    expect(await isHaltedInScope(ORG_ID)).toBeNull();
    // ...but the project remains independently halted (union arm still hits).
    expect(await isHaltedInScope(ORG_ID, { projectId: PROJECT_ID })).toBe(
      projHalt,
    );
  });
});

describe("reintegration completion + two-sided validation (FR-004, AC-4, AC-7)", () => {
  const CLIENT_A = "20808080-0000-0000-0000-0000000000e2";
  const CLIENT_B = "20808080-0000-0000-0000-0000000000e3";

  function ack(
    haltId: string,
    haltKind: "halt" | "lift",
    ackedAt: string,
  ): ClientOrgHaltAck {
    return {
      kind: "org.halt.ack",
      meta: META(`evt-p3-ack-${haltId}-${haltKind}-${ackedAt}`),
      haltId,
      haltKind,
      ackedAt,
    };
  }

  async function haltState(haltId: string): Promise<string> {
    const [row] = await db
      .select({ state: orgHalts.state })
      .from(orgHalts)
      .where(eq(orgHalts.id, haltId));
    return row.state;
  }

  it("a single engine's lift ack completes reintegration (state -> lifted)", async () => {
    const halt = await pullHaltCore(AUTH, {
      scope: "org",
      reason: "complete me",
    });
    await handleInbound(
      { orgId: ORG_ID, clientId: CLIENT_A, userId: USER_ID },
      ack(halt.haltId, "halt", "2026-07-02T00:00:00.000Z"),
    );
    await liftHaltCore(AUTH, { id: halt.haltId }); // -> reintegrating
    const res = await handleInbound(
      { orgId: ORG_ID, clientId: CLIENT_A, userId: USER_ID },
      ack(halt.haltId, "lift", "2026-07-02T00:01:00.000Z"),
    );
    expect(res.ok).toBe(true);
    expect(await haltState(halt.haltId)).toBe("lifted");

    const [row] = await db
      .select({ acks: orgHalts.acks })
      .from(orgHalts)
      .where(eq(orgHalts.id, halt.haltId));
    expect(row.acks.map((a) => a.kind).sort()).toEqual(["halt", "lift"]);

    const audits = await db
      .select()
      .from(auditLog)
      .where(eq(auditLog.action, FACTORY_ORG_HALT_REINTEGRATED));
    expect(audits.some((a) => a.targetId === halt.haltId)).toBe(true);
  });

  it("completion requires every halt-acker to lift-ack (multi-engine)", async () => {
    const halt = await pullHaltCore(AUTH, {
      scope: "org",
      reason: "two engines",
    });
    for (const c of [CLIENT_A, CLIENT_B]) {
      await handleInbound(
        { orgId: ORG_ID, clientId: c, userId: USER_ID },
        ack(halt.haltId, "halt", "2026-07-02T00:00:00.000Z"),
      );
    }
    await liftHaltCore(AUTH, { id: halt.haltId });

    // Only engine A lift-acks: engine B is still outstanding, so the halt stays
    // reintegrating (still enforced).
    await handleInbound(
      { orgId: ORG_ID, clientId: CLIENT_A, userId: USER_ID },
      ack(halt.haltId, "lift", "2026-07-02T00:01:00.000Z"),
    );
    expect(await haltState(halt.haltId)).toBe("reintegrating");

    // Engine B lift-acks: every halt-acker has now lift-acked -> lifted.
    await handleInbound(
      { orgId: ORG_ID, clientId: CLIENT_B, userId: USER_ID },
      ack(halt.haltId, "lift", "2026-07-02T00:02:00.000Z"),
    );
    expect(await haltState(halt.haltId)).toBe("lifted");
  });

  it("D2: a lift ack is rejected (not recorded) when admission is not admitted", async () => {
    const halt = await pullHaltCore(AUTH, { scope: "org", reason: "d2" });
    await handleInbound(
      { orgId: ORG_ID, clientId: CLIENT_A, userId: USER_ID },
      ack(halt.haltId, "halt", "2026-07-02T00:00:00.000Z"),
    );
    await liftHaltCore(AUTH, { id: halt.haltId }); // -> reintegrating

    // Revoke the standing admission so the fresh two-sided re-validation fails.
    await db
      .update(factoryAdmissions)
      .set({ status: "refused" })
      .where(eq(factoryAdmissions.orgId, ORG_ID));
    try {
      const res = await handleInbound(
        { orgId: ORG_ID, clientId: CLIENT_A, userId: USER_ID },
        ack(halt.haltId, "lift", "2026-07-02T00:01:00.000Z"),
      );
      expect(res.ok).toBe(false);
      // The lift ack was NOT recorded and the halt did NOT complete.
      expect(await haltState(halt.haltId)).toBe("reintegrating");
      const [row] = await db
        .select({ acks: orgHalts.acks })
        .from(orgHalts)
        .where(eq(orgHalts.id, halt.haltId));
      expect(row.acks.some((a) => a.kind === "lift")).toBe(false);
    } finally {
      await db
        .update(factoryAdmissions)
        .set({ status: "admitted" })
        .where(eq(factoryAdmissions.orgId, ORG_ID));
    }
  });

  it("AC-7: a reintegrating halt still refuses grant renewal", async () => {
    const issued = await handleGrantRequest(grantRequest(RUN_REINT), CTX);
    expect(issued.reply?.granted).toBe(true);

    const halt = await pullHaltCore(AUTH, {
      scope: "org",
      reason: "reintegrating refusal",
    });
    await liftHaltCore(AUTH, { id: halt.haltId }); // -> reintegrating (enforced)

    const { reply } = await handleGrantRenew(grantRenew(RUN_REINT, 1), CTX);
    expect(reply?.granted).toBe(false);
    expect(reply?.refusedReason).toBe("halted");
  });

  it("D3: a pull on a reintegrating scope re-asserts halted and resets the ack ledger", async () => {
    const halt = await pullHaltCore(AUTH, { scope: "org", reason: "first pull" });
    await handleInbound(
      { orgId: ORG_ID, clientId: CLIENT_A, userId: USER_ID },
      ack(halt.haltId, "halt", "2026-07-02T00:00:00.000Z"),
    );
    await liftHaltCore(AUTH, { id: halt.haltId }); // -> reintegrating

    const re = await pullHaltCore(AUTH, {
      scope: "org",
      reason: "re-halt mid-reintegration",
    });
    expect(re.haltId).toBe(halt.haltId);
    expect(re.state).toBe("halted");

    const [row] = await db
      .select()
      .from(orgHalts)
      .where(eq(orgHalts.id, halt.haltId));
    expect(row.state).toBe("halted");
    expect(row.reason).toBe("re-halt mid-reintegration");
    expect(row.liftedBy).toBeNull();
    expect(row.liftedAt).toBeNull();
    expect(row.acks).toEqual([]);

    const audits = await db
      .select()
      .from(auditLog)
      .where(eq(auditLog.action, FACTORY_ORG_HALT_REASSERTED));
    expect(audits.some((a) => a.targetId === halt.haltId)).toBe(true);
  });

  it("a lift ack arriving while the halt is not reintegrating is ignored (not recorded)", async () => {
    // Cycle guard: a lift ack only counts during reintegration. A lift ack that
    // lands while the halt is still `halted` (e.g. an in-flight resync replay
    // after a D3 re-pull reset the ledger) must be a benign no-op, never a
    // ledger entry, or it contaminates the next cycle's completion count.
    const halt = await pullHaltCore(AUTH, { scope: "org", reason: "still halted" });
    expect(await haltState(halt.haltId)).toBe("halted");

    const res = await handleInbound(
      { orgId: ORG_ID, clientId: CLIENT_A, userId: USER_ID },
      ack(halt.haltId, "lift", "2026-07-02T00:01:00.000Z"),
    );
    // Benign ignore, not a hard rejection: the engine re-acks on the next
    // `lifted` broadcast per the resync-replay contract.
    expect(res.ok).toBe(true);
    expect(await haltState(halt.haltId)).toBe("halted");

    const [row] = await db
      .select({ acks: orgHalts.acks })
      .from(orgHalts)
      .where(eq(orgHalts.id, halt.haltId));
    expect(row.acks.some((a) => a.kind === "lift")).toBe(false);

    // The guard returns before the tx.insert(auditLog): no phantom engine_ack
    // row for the ignored ack (only a lift ack was sent in this test).
    const audits = await db
      .select()
      .from(auditLog)
      .where(eq(auditLog.action, FACTORY_ORG_HALT_ENGINE_ACK));
    expect(audits.filter((a) => a.targetId === halt.haltId)).toHaveLength(0);
  });

  it("a lift ack arriving after the halt already lifted is ignored (guard covers the lifted branch)", async () => {
    // The cycle guard fires on any state !== "reintegrating", which includes
    // `lifted`. A late resync replay landing after completion (from an engine
    // not already in the ledger, so it is not caught by the idempotency check)
    // must be a no-op: the halt is complete, there is no next lift broadcast.
    const halt = await pullHaltCore(AUTH, { scope: "org", reason: "already lifted" });
    await handleInbound(
      { orgId: ORG_ID, clientId: CLIENT_A, userId: USER_ID },
      ack(halt.haltId, "halt", "2026-07-02T00:00:00.000Z"),
    );
    await liftHaltCore(AUTH, { id: halt.haltId }); // -> reintegrating
    await handleInbound(
      { orgId: ORG_ID, clientId: CLIENT_A, userId: USER_ID },
      ack(halt.haltId, "lift", "2026-07-02T00:01:00.000Z"),
    );
    expect(await haltState(halt.haltId)).toBe("lifted");

    // A different engine's late lift ack lands after the halt is `lifted`.
    const late = await handleInbound(
      { orgId: ORG_ID, clientId: CLIENT_B, userId: USER_ID },
      ack(halt.haltId, "lift", "2026-07-02T00:02:00.000Z"),
    );
    expect(late.ok).toBe(true);
    expect(await haltState(halt.haltId)).toBe("lifted");

    const [row] = await db
      .select({ acks: orgHalts.acks })
      .from(orgHalts)
      .where(eq(orgHalts.id, halt.haltId));
    // B's late lift ack was not recorded; only A's halt + lift entries remain.
    expect(row.acks.filter((a) => a.kind === "lift").map((a) => a.clientId)).toEqual([
      CLIENT_A,
    ]);
  });

  it("a stale lift ack replayed after a D3 re-pull does not complete the next cycle prematurely", async () => {
    // The contamination scenario the cycle guard closes. Cycle 1: A and B both
    // halt-ack, the operator lifts (-> reintegrating), A lift-acks (B still
    // outstanding). B's lift ack is in flight when the operator re-pulls (D3),
    // which resets the ledger. B's delayed cycle-1 lift ack then lands while the
    // halt is `halted`. Without the guard it would be recorded and later counted
    // as B's cycle-2 lift, letting A's first cycle-2 lift ack complete
    // reintegration even though B never lift-acked cycle 2.
    const halt = await pullHaltCore(AUTH, { scope: "org", reason: "cycle 1" });
    for (const c of [CLIENT_A, CLIENT_B]) {
      await handleInbound(
        { orgId: ORG_ID, clientId: c, userId: USER_ID },
        ack(halt.haltId, "halt", "2026-07-02T00:00:00.000Z"),
      );
    }
    await liftHaltCore(AUTH, { id: halt.haltId }); // -> reintegrating (cycle 1)
    await handleInbound(
      { orgId: ORG_ID, clientId: CLIENT_A, userId: USER_ID },
      ack(halt.haltId, "lift", "2026-07-02T00:01:00.000Z"),
    );
    expect(await haltState(halt.haltId)).toBe("reintegrating");

    // D3: re-pull mid-reintegration re-asserts the SAME halt record (identity
    // is what makes the ledger reset, not a fresh row) and resets the ledger.
    const re = await pullHaltCore(AUTH, { scope: "org", reason: "cycle 2 re-halt" });
    expect(re.haltId).toBe(halt.haltId);
    expect(re.state).toBe("halted");

    // B's in-flight cycle-1 lift ack lands late, while the halt is `halted`.
    const stale = await handleInbound(
      { orgId: ORG_ID, clientId: CLIENT_B, userId: USER_ID },
      ack(halt.haltId, "lift", "2026-07-02T00:01:30.000Z"),
    );
    expect(stale.ok).toBe(true);
    const [afterStale] = await db
      .select({ acks: orgHalts.acks })
      .from(orgHalts)
      .where(eq(orgHalts.id, halt.haltId));
    expect(afterStale.acks.some((a) => a.kind === "lift")).toBe(false);

    // Cycle 2 proceeds legitimately: A and B halt-ack, operator lifts, A
    // lift-acks. Because B's stale lift did not leak into the ledger, B is still
    // outstanding, so the halt must stay reintegrating (not prematurely lifted).
    for (const c of [CLIENT_A, CLIENT_B]) {
      await handleInbound(
        { orgId: ORG_ID, clientId: c, userId: USER_ID },
        ack(halt.haltId, "halt", "2026-07-02T00:02:00.000Z"),
      );
    }
    await liftHaltCore(AUTH, { id: halt.haltId }); // -> reintegrating (cycle 2)
    await handleInbound(
      { orgId: ORG_ID, clientId: CLIENT_A, userId: USER_ID },
      ack(halt.haltId, "lift", "2026-07-02T00:03:00.000Z"),
    );
    expect(await haltState(halt.haltId)).toBe("reintegrating");

    // B finally lift-acks cycle 2: now every halt-acker has lift-acked -> lifted.
    await handleInbound(
      { orgId: ORG_ID, clientId: CLIENT_B, userId: USER_ID },
      ack(halt.haltId, "lift", "2026-07-02T00:04:00.000Z"),
    );
    expect(await haltState(halt.haltId)).toBe("lifted");
  });
});

// Spec 208 Phase 3.1 (PR-3.1): ack-ledger hardening (T023 symmetric halt-ack
// write-path guard, T024 dropped-ack audit trail). T023 mirrors the PR #502
// lift-ack cycle guard onto the halt-ack write path: a late halt-ack replayed
// via resync after the scope has left `halted` must not widen the recorded
// halt-acker set. T024 makes every benign drop (a duplicate replay, a
// stale halt-ack, a stale lift-ack) visible in the audit chain instead of only
// log.info.
describe("ack-ledger hardening (Phase 3.1, T023/T024, FR-004)", () => {
  const CLIENT_A = "20808080-0000-0000-0000-0000000000f1";
  const CLIENT_C = "20808080-0000-0000-0000-0000000000f2";

  function ack(
    haltId: string,
    haltKind: "halt" | "lift",
    ackedAt: string,
  ): ClientOrgHaltAck {
    return {
      kind: "org.halt.ack",
      meta: META(`evt-p31-ack-${haltId}-${haltKind}-${ackedAt}`),
      haltId,
      haltKind,
      ackedAt,
    };
  }

  async function haltState(haltId: string): Promise<string> {
    const [row] = await db
      .select({ state: orgHalts.state })
      .from(orgHalts)
      .where(eq(orgHalts.id, haltId));
    return row.state;
  }

  async function acksOf(haltId: string) {
    const [row] = await db
      .select({ acks: orgHalts.acks })
      .from(orgHalts)
      .where(eq(orgHalts.id, haltId));
    return row.acks;
  }

  async function droppedAudits(haltId: string) {
    const rows = await db
      .select()
      .from(auditLog)
      .where(eq(auditLog.action, FACTORY_ORG_HALT_ACK_DROPPED));
    return rows.filter((a) => a.targetId === haltId);
  }

  it("T023: a stale halt-ack while reintegrating is dropped, not widening the halt-acker set", async () => {
    // A halt-acks, the operator lifts (-> reintegrating), then a DIFFERENT engine
    // that missed the halt window replays the (still outbox-durable) halt
    // broadcast and halt-acks late. The idempotency check misses it (new client),
    // so without the T023 guard it would be recorded, adding C to the halt-acker
    // set. C is then expected to lift-ack, holding the scope in `reintegrating`.
    const halt = await pullHaltCore(AUTH, { scope: "org", reason: "widen probe" });
    await handleInbound(
      { orgId: ORG_ID, clientId: CLIENT_A, userId: USER_ID },
      ack(halt.haltId, "halt", "2026-07-03T00:00:00.000Z"),
    );
    await liftHaltCore(AUTH, { id: halt.haltId }); // -> reintegrating (A outstanding)
    expect(await haltState(halt.haltId)).toBe("reintegrating");

    const stale = await handleInbound(
      { orgId: ORG_ID, clientId: CLIENT_C, userId: USER_ID },
      ack(halt.haltId, "halt", "2026-07-03T00:01:00.000Z"),
    );
    // Benign ignore, not a hard rejection.
    expect(stale.ok).toBe(true);
    // C's halt-ack was not recorded: only A remains a halt-acker.
    const acks = await acksOf(halt.haltId);
    expect(acks.filter((a) => a.kind === "halt").map((a) => a.clientId)).toEqual([
      CLIENT_A,
    ]);

    // The decisive behavioural check: because C never widened the halt-acker set,
    // A (the only halt-acker) lift-acking completes reintegration. If the stale
    // halt-ack had leaked in, C would still be outstanding and the halt would
    // remain reintegrating.
    await handleInbound(
      { orgId: ORG_ID, clientId: CLIENT_A, userId: USER_ID },
      ack(halt.haltId, "lift", "2026-07-03T00:02:00.000Z"),
    );
    expect(await haltState(halt.haltId)).toBe("lifted");

    // T024: the drop is auditable (reason names the guard that fired).
    const drops = await droppedAudits(halt.haltId);
    const notHalted = drops.find(
      (a) => (a.metadata as Record<string, unknown>)?.reason === "not-halted",
    );
    expect(notHalted).toBeDefined();
    const meta = notHalted?.metadata as Record<string, unknown>;
    expect(meta?.clientId).toBe(CLIENT_C);
    expect(meta?.haltKind).toBe("halt");
  });

  it("T023: a stale halt-ack after the halt already lifted is dropped (guard covers the lifted branch)", async () => {
    const halt = await pullHaltCore(AUTH, { scope: "org", reason: "post-lift probe" });
    await handleInbound(
      { orgId: ORG_ID, clientId: CLIENT_A, userId: USER_ID },
      ack(halt.haltId, "halt", "2026-07-03T01:00:00.000Z"),
    );
    await liftHaltCore(AUTH, { id: halt.haltId }); // -> reintegrating
    await handleInbound(
      { orgId: ORG_ID, clientId: CLIENT_A, userId: USER_ID },
      ack(halt.haltId, "lift", "2026-07-03T01:01:00.000Z"),
    );
    expect(await haltState(halt.haltId)).toBe("lifted");

    // A late halt-ack from an engine not in the ledger lands after completion.
    const stale = await handleInbound(
      { orgId: ORG_ID, clientId: CLIENT_C, userId: USER_ID },
      ack(halt.haltId, "halt", "2026-07-03T01:02:00.000Z"),
    );
    expect(stale.ok).toBe(true);
    expect(await haltState(halt.haltId)).toBe("lifted");
    // The ledger is untouched: only A's halt + lift entries remain.
    const acks = await acksOf(halt.haltId);
    expect(acks.filter((a) => a.clientId === CLIENT_C)).toHaveLength(0);

    const drops = await droppedAudits(halt.haltId);
    expect(
      drops.some(
        (a) => (a.metadata as Record<string, unknown>)?.reason === "not-halted",
      ),
    ).toBe(true);
  });

  it("T024: a lift-ack dropped while halted (not-reintegrating) writes an ack-dropped audit", async () => {
    // The PR #502 cycle-guard drop, now asserted to be audit-visible.
    const halt = await pullHaltCore(AUTH, { scope: "org", reason: "lift-while-halted" });
    expect(await haltState(halt.haltId)).toBe("halted");

    const res = await handleInbound(
      { orgId: ORG_ID, clientId: CLIENT_A, userId: USER_ID },
      ack(halt.haltId, "lift", "2026-07-03T02:00:00.000Z"),
    );
    expect(res.ok).toBe(true);
    expect((await acksOf(halt.haltId)).some((a) => a.kind === "lift")).toBe(false);

    const drops = await droppedAudits(halt.haltId);
    const notReint = drops.find(
      (a) =>
        (a.metadata as Record<string, unknown>)?.reason === "not-reintegrating",
    );
    expect(notReint).toBeDefined();
    expect((notReint?.metadata as Record<string, unknown>)?.haltKind).toBe("lift");
  });

  it("T024: a duplicate ack replay writes an ack-dropped audit without a second engine_ack", async () => {
    const halt = await pullHaltCore(AUTH, { scope: "org", reason: "dup-audit" });
    const ctx = { orgId: ORG_ID, clientId: CLIENT_A, userId: USER_ID };
    await handleInbound(ctx, ack(halt.haltId, "halt", "2026-07-03T03:00:00.000Z"));
    // The reconnect replay: same (clientId, kind) -> duplicate drop.
    const replay = await handleInbound(
      ctx,
      ack(halt.haltId, "halt", "2026-07-03T03:01:00.000Z"),
    );
    expect(replay.ok).toBe(true);

    // One recorded ack, one engine_ack audit (the replay minted neither).
    expect(await acksOf(halt.haltId)).toHaveLength(1);
    const engineAcks = await db
      .select()
      .from(auditLog)
      .where(eq(auditLog.action, FACTORY_ORG_HALT_ENGINE_ACK));
    expect(engineAcks.filter((a) => a.targetId === halt.haltId)).toHaveLength(1);

    // ...but the replay IS visible as an explicit drop marker.
    const drops = await droppedAudits(halt.haltId);
    expect(
      drops.some(
        (a) => (a.metadata as Record<string, unknown>)?.reason === "duplicate",
      ),
    ).toBe(true);
  });
});
