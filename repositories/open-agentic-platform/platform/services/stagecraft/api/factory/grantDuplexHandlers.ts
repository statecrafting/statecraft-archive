// Spec 198 FR-005/FR-014 — duplex handlers for the run-grant envelope
// family and the emission countersign.
//
// The run-grant is the intent capsule realised (ASI01 m5 "signed envelope
// per execution cycle"): the engine submits the capsule before s0
// (`factory.run.grant_request`) and re-presents the goal id + capsule hash
// at every stage boundary (`factory.run.grant_renew`). Statecraft is the
// PDP: it validates the capsule against the standing admission, sweeps the
// admitted composition's nodes against FR-010 revocations (this is what
// propagates a revocation into an in-flight run within one stage boundary),
// and returns a short-lived, audience-bound signed grant. A goal shift
// refuses renewal — the run pauses and the deviation is recorded (ASI01
// m4/m7).
//
// Capsule-hash contract (mirrored in `crates/factory-engine`): the capsule
// hash covers `{goal, goal_id, constraints, envelope_hash, project_id,
// run_id}` and is STABLE for the run's lifetime. The frozen Build-Spec hash
// is presented separately once it exists (s2 freeze): first presentation
// records it on the grant chain; any later change refuses with
// `capsule-mismatch`.
//
// Transport concerns (envelope decoding, ACK/NACK) stay in
// `api/sync/service.ts::handleInbound`. To avoid an import cycle with the
// sync service, handlers RETURN the targeted reply envelope (without meta);
// the dispatcher sends it.

import log from "encore.dev/log";
import { createHash } from "node:crypto";
import { and, asc, eq, inArray, isNotNull, isNull, or, sql } from "drizzle-orm";
import { db } from "../db/drizzle";
import {
  auditLog,
  factoryArtifactSubstrate,
  factoryRevocations,
  factoryRunGrants,
  factoryRuns,
} from "../db/schema";
import {
  FACTORY_RUN_COUNTERSIGNED,
  FACTORY_RUN_GRANT_ISSUED,
  FACTORY_RUN_GRANT_REFUSED,
} from "./auditActions";
import { loadOwnedRun, type RunHandlerResult } from "./runDuplexHandlers";
import {
  loadLatestAdmission,
  type AdmissionState,
} from "./admission";
import { resolveOriginsForOrg } from "./substrateBrowser";
import { isHaltedInScope } from "./orgHalt";
import { signFactoryJws, signingConfigured } from "./signing";
import type {
  ClientFactoryRunCompleted,
  ClientFactoryRunGrantRenew,
  ClientFactoryRunGrantRequest,
  RunGrantRefusalReason,
  ServerFactoryRunCertificateCountersign,
  ServerFactoryRunGrant,
} from "../sync/types";

const GRANT_AUDIENCE = "oap-opc-run";

/** Grant TTL (ASI08 m3 — expiry caps unattended run authority). */
function grantTtlSec(): number {
  const raw = Number(process.env.statecraft_RUN_GRANT_TTL_SEC ?? "1800");
  return Number.isFinite(raw) && raw > 0 ? raw : 1800;
}

function sha256hex(data: string): string {
  return createHash("sha256").update(data, "utf-8").digest("hex");
}

interface HandlerCtx {
  orgId: string;
  userId: string;
  // Spec 205 FR-005: when the requesting session is an agent NHI, these
  // carry the two principals onto every audit row this handler writes.
  // Undefined for ordinary human sessions (Phase 0 plumbing; Phase 1
  // populates them at mint).
  nhiSub?: string | null;
  onBehalfOf?: string | null;
}

export type GrantReply = Omit<ServerFactoryRunGrant, "meta">;
export type CountersignReply = Omit<
  ServerFactoryRunCertificateCountersign,
  "meta"
>;

export interface GrantHandlerOutcome {
  result: RunHandlerResult;
  /** Targeted reply for the requesting client; absent only on
   * transport-level rejection (org mismatch / unknown run). */
  reply?: GrantReply;
}

// ---------------------------------------------------------------------------
// Standing admission + FR-010 composition sweep
// ---------------------------------------------------------------------------

type StandingAdmission =
  | { ok: true; origin: string; state: AdmissionState }
  | { ok: false; reason: RunGrantRefusalReason; detail: string };

async function resolveStandingAdmission(
  orgId: string,
): Promise<StandingAdmission> {
  const { factoryOriginId } = await resolveOriginsForOrg(orgId);
  if (!factoryOriginId) {
    return {
      ok: false,
      reason: "not-admitted",
      detail: "no factory upstream configured for this org",
    };
  }
  const state = await loadLatestAdmission(orgId, factoryOriginId);
  if (state.status !== "admitted") {
    return {
      ok: false,
      reason: "not-admitted",
      detail:
        state.status === "unevaluated"
          ? `factory '${factoryOriginId}' has no admission evaluation`
          : `factory '${factoryOriginId}' was refused admission`,
    };
  }
  return { ok: true, origin: factoryOriginId, state };
}

/**
 * FR-010 — sweep every node of the admitted composition graph against
 * unlifted revocations: factory (origin), adapter (sub-envelope names),
 * agent (declared ids), content-hash (envelope, manifests, agent digests).
 * One query per scope kind. Returns the first hit, or null.
 */
export async function sweepCompositionRevocations(
  orgId: string,
  origin: string,
  state: AdmissionState,
): Promise<string | null> {
  const adapterNames = Object.keys(state.composed?.adapters ?? {});
  // Spec 200 FR-003(b) — the admitted composition's hash set extends with
  // the org's ACTIVE override content hashes for this origin: a scanner
  // (or manual) content-hash quarantine propagates into in-flight runs
  // within one stage boundary, per spec 198's renewal contract. Override
  // hashes are runtime state (stamped by `applyOverrideCore`), not
  // admission-pinned upstream bytes, so they are read here rather than
  // from the admission record.
  const overrideRows = await db
    .select({ contentHash: factoryArtifactSubstrate.contentHash })
    .from(factoryArtifactSubstrate)
    .where(
      and(
        eq(factoryArtifactSubstrate.orgId, orgId),
        eq(factoryArtifactSubstrate.origin, origin),
        eq(factoryArtifactSubstrate.status, "active"),
        isNotNull(factoryArtifactSubstrate.userBody),
      ),
    );
  const contentHashes = [
    ...(state.envelopeHash ? [state.envelopeHash] : []),
    ...Object.values(state.composed?.adapters ?? {}).map(
      (a) => a.manifestHash,
    ),
    ...Object.values(state.composed?.agentDigests ?? {}),
    ...overrideRows.map((r) => r.contentHash),
  ];
  const agentIds = Object.values(state.composed?.agentIds ?? {});

  const checks: Array<{
    scope: "factory" | "adapter" | "agent" | "content-hash";
    keys: string[];
  }> = [
    { scope: "factory", keys: [origin] },
    { scope: "adapter", keys: adapterNames },
    { scope: "agent", keys: agentIds },
    { scope: "content-hash", keys: contentHashes },
  ];

  for (const check of checks) {
    if (check.keys.length === 0) continue;
    const [hit] = await db
      .select({
        key: factoryRevocations.key,
        mode: factoryRevocations.mode,
      })
      .from(factoryRevocations)
      .where(
        and(
          eq(factoryRevocations.scopeKind, check.scope),
          inArray(factoryRevocations.key, check.keys),
          isNull(factoryRevocations.liftedAt),
          or(
            eq(factoryRevocations.orgId, sql`${orgId}::uuid`),
            isNull(factoryRevocations.orgId),
          ),
        ),
      )
      .limit(1);
    if (hit) {
      return `${check.scope} '${hit.key}' is ${hit.mode} (spec 198 FR-010)`;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Grant signing + persistence
// ---------------------------------------------------------------------------

interface GrantFacts {
  runId: string;
  projectId: string | null;
  goalId: string;
  capsuleHash: string;
  envelopeHash: string;
  buildSpecHash: string | null;
  seq: number;
}

async function signAndPersistGrant(
  ctx: HandlerCtx,
  facts: GrantFacts,
): Promise<GrantReply> {
  const ttl = grantTtlSec();
  const iat = Math.floor(Date.now() / 1000);
  const exp = iat + ttl;
  const { jws, kid } = signFactoryJws("oap-run-grant+jwt", {
    iss: "statecraft-factory",
    aud: GRANT_AUDIENCE,
    org_id: ctx.orgId,
    project_id: facts.projectId,
    run_id: facts.runId,
    goal_id: facts.goalId,
    capsule_hash: facts.capsuleHash,
    envelope_hash: facts.envelopeHash,
    build_spec_hash: facts.buildSpecHash,
    seq: facts.seq,
    iat,
    exp,
  });
  const expiresAt = new Date(exp * 1000);
  await db.insert(factoryRunGrants).values({
    orgId: ctx.orgId,
    runId: facts.runId,
    projectId: facts.projectId,
    goalId: facts.goalId,
    capsuleHash: facts.capsuleHash,
    envelopeHash: facts.envelopeHash,
    buildSpecHash: facts.buildSpecHash,
    seq: facts.seq,
    status: "issued",
    grantJws: jws,
    kid,
    expiresAt,
  });
  await db.insert(auditLog).values({
    actorUserId: ctx.userId,
    nhiSub: ctx.nhiSub ?? null,
    onBehalfOf: ctx.onBehalfOf ?? null,
    action: FACTORY_RUN_GRANT_ISSUED,
    targetType: "factory_runs",
    targetId: facts.runId,
    metadata: {
      orgId: ctx.orgId,
      seq: facts.seq,
      goalId: facts.goalId,
      capsuleHash: facts.capsuleHash,
      envelopeHash: facts.envelopeHash,
      expiresAt: expiresAt.toISOString(),
    },
  });
  return {
    kind: "factory.run.grant",
    runId: facts.runId,
    granted: true,
    seq: facts.seq,
    grantJws: jws,
    kid,
    expiresAt: expiresAt.toISOString(),
  };
}

async function refuseGrant(
  ctx: HandlerCtx,
  facts: Omit<GrantFacts, "buildSpecHash"> & { buildSpecHash?: string | null },
  reason: RunGrantRefusalReason,
  detail: string,
): Promise<GrantReply> {
  await db.insert(factoryRunGrants).values({
    orgId: ctx.orgId,
    runId: facts.runId,
    projectId: facts.projectId,
    goalId: facts.goalId,
    capsuleHash: facts.capsuleHash,
    envelopeHash: facts.envelopeHash,
    buildSpecHash: facts.buildSpecHash ?? null,
    seq: facts.seq,
    status: "refused",
    refusedReason: `${reason}: ${detail}`,
  });
  await db.insert(auditLog).values({
    actorUserId: ctx.userId,
    nhiSub: ctx.nhiSub ?? null,
    onBehalfOf: ctx.onBehalfOf ?? null,
    action: FACTORY_RUN_GRANT_REFUSED,
    targetType: "factory_runs",
    targetId: facts.runId,
    metadata: {
      orgId: ctx.orgId,
      seq: facts.seq,
      goalId: facts.goalId,
      reason,
      detail,
    },
  });
  log.warn("factory run grant refused", {
    orgId: ctx.orgId,
    runId: facts.runId,
    seq: facts.seq,
    reason,
    detail,
  });
  return {
    kind: "factory.run.grant",
    runId: facts.runId,
    granted: false,
    seq: facts.seq,
    refusedReason: reason,
    detail,
  };
}

async function loadIssuedGrants(orgId: string, runId: string) {
  return db
    .select()
    .from(factoryRunGrants)
    .where(
      and(
        eq(factoryRunGrants.orgId, orgId),
        eq(factoryRunGrants.runId, runId),
        eq(factoryRunGrants.status, "issued"),
      ),
    )
    .orderBy(asc(factoryRunGrants.seq));
}

/** Shared admission/revocation/halt/signing preflight for issue + renew. */
async function grantPreflight(
  ctx: HandlerCtx,
  envelopeHash: string,
  projectId: string | null,
  // Spec 208 FR-001/AC-3: the agent profile about to execute the stage being
  // renewed, resolved engine-side and presented on `factory.run.grant_renew`.
  // Only renewal supplies it (issuance has no single profile); null on issue.
  agentProfile: string | null = null,
): Promise<
  | { ok: true; origin: string; state: AdmissionState }
  | { ok: false; reason: RunGrantRefusalReason; detail: string }
> {
  if (!signingConfigured()) {
    return {
      ok: false,
      reason: "signing-unconfigured",
      detail:
        "the signing authority is not configured on this deployment (FR-014)",
    };
  }
  const standing = await resolveStandingAdmission(ctx.orgId);
  if (!standing.ok) return standing;
  if (standing.state.envelopeHash !== envelopeHash) {
    return {
      ok: false,
      reason: "envelope-mismatch",
      detail:
        "the presented envelope hash does not match the standing admission " +
        "(the admission changed since the bundle was fetched — refetch)",
    };
  }
  const revoked = await sweepCompositionRevocations(
    ctx.orgId,
    standing.origin,
    standing.state,
  );
  if (revoked) {
    return { ok: false, reason: "revoked", detail: revoked };
  }
  // Spec 208 FR-001/FR-002: an active org-, project-, or agent-profile-scoped
  // halt refuses grant issuance and renewal, so in-flight runs pause at the
  // next stage boundary (the 198 FR-005 semantics, not a forced mid-stage
  // kill). The detail names the quarantine record (AC-2). `agentProfile` is
  // present only on renewal (Phase 3, AC-3); issuance passes null, which the
  // agent-profile arm ignores.
  const haltId = await isHaltedInScope(ctx.orgId, { projectId, agentProfile });
  if (haltId) {
    return {
      ok: false,
      reason: "halted",
      detail: `org halt ${haltId} is active for this scope`,
    };
  }
  return { ok: true, origin: standing.origin, state: standing.state };
}

// ---------------------------------------------------------------------------
// factory.run.grant_request — issuance (seq 0; restart-safe)
// ---------------------------------------------------------------------------

export async function handleGrantRequest(
  evt: ClientFactoryRunGrantRequest,
  ctx: HandlerCtx,
): Promise<GrantHandlerOutcome> {
  if (!evt.goalId || !evt.capsuleHash || !evt.envelopeHash) {
    return {
      result: {
        ok: false,
        reason: "invalid",
        detail: "goalId, capsuleHash, envelopeHash required",
      },
    };
  }
  const owned = await loadOwnedRun(evt.runId, ctx.orgId);
  if (!owned.ok) return { result: owned };
  const projectId = owned.row.projectId;

  const baseFacts = {
    runId: evt.runId,
    projectId,
    goalId: evt.goalId,
    capsuleHash: evt.capsuleHash,
    envelopeHash: evt.envelopeHash,
  };

  const pre = await grantPreflight(ctx, evt.envelopeHash, projectId);
  if (!pre.ok) {
    return {
      result: { ok: true },
      reply: await refuseGrant(
        ctx,
        { ...baseFacts, seq: 0, buildSpecHash: evt.buildSpecHash ?? null },
        pre.reason,
        pre.detail,
      ),
    };
  }

  const issued = await loadIssuedGrants(ctx.orgId, evt.runId);
  if (issued.length === 0) {
    const reply = await signAndPersistGrant(ctx, {
      ...baseFacts,
      buildSpecHash: evt.buildSpecHash ?? null,
      seq: 0,
    });
    return { result: { ok: true }, reply };
  }

  // A chain already exists (engine restart / re-delivery). The goal may
  // never shift across a re-request (ASI01 m4).
  const latest = issued[issued.length - 1];
  if (latest.goalId !== evt.goalId) {
    return {
      result: { ok: true },
      reply: await refuseGrant(
        ctx,
        { ...baseFacts, seq: latest.seq + 1 },
        "goal-shift",
        `re-request presents goal id '${evt.goalId}' but the chain was issued for '${latest.goalId}'`,
      ),
    };
  }
  if (latest.capsuleHash !== evt.capsuleHash) {
    return {
      result: { ok: true },
      reply: await refuseGrant(
        ctx,
        { ...baseFacts, seq: latest.seq + 1 },
        "capsule-mismatch",
        "re-request presents a different capsule hash than the issued chain",
      ),
    };
  }
  if (latest.expiresAt && latest.expiresAt.getTime() > Date.now()) {
    // Idempotent re-delivery: re-serve the live grant.
    return {
      result: { ok: true },
      reply: {
        kind: "factory.run.grant",
        runId: evt.runId,
        granted: true,
        seq: latest.seq,
        grantJws: latest.grantJws ?? undefined,
        kid: latest.kid ?? undefined,
        expiresAt: latest.expiresAt.toISOString(),
      },
    };
  }
  // Expired chain head after a restart: extend the chain rather than
  // re-issue seq 0 (the unique index keeps history append-only).
  const reply = await signAndPersistGrant(ctx, {
    ...baseFacts,
    buildSpecHash: evt.buildSpecHash ?? latest.buildSpecHash,
    seq: latest.seq + 1,
  });
  return { result: { ok: true }, reply };
}

// ---------------------------------------------------------------------------
// factory.run.grant_renew — stage-boundary renewal
// ---------------------------------------------------------------------------

export async function handleGrantRenew(
  evt: ClientFactoryRunGrantRenew,
  ctx: HandlerCtx,
): Promise<GrantHandlerOutcome> {
  if (!evt.goalId || !evt.capsuleHash || typeof evt.seq !== "number") {
    return {
      result: {
        ok: false,
        reason: "invalid",
        detail: "goalId, capsuleHash, seq required",
      },
    };
  }
  const owned = await loadOwnedRun(evt.runId, ctx.orgId);
  if (!owned.ok) return { result: owned };
  const projectId = owned.row.projectId;

  const issued = await loadIssuedGrants(ctx.orgId, evt.runId);
  if (issued.length === 0) {
    return {
      result: { ok: true },
      reply: await refuseGrant(
        ctx,
        {
          runId: evt.runId,
          projectId,
          goalId: evt.goalId,
          capsuleHash: evt.capsuleHash,
          envelopeHash: "",
          seq: evt.seq,
        },
        "malformed",
        "renewal without an issuance grant — request a grant first",
      ),
    };
  }
  const issuance = issued[0];
  const latest = issued[issued.length - 1];
  const baseFacts = {
    runId: evt.runId,
    projectId,
    goalId: evt.goalId,
    capsuleHash: evt.capsuleHash,
    envelopeHash: issuance.envelopeHash,
  };

  // ASI01 m4/m7 — goal-shift detection: renewal re-presents the goal id
  // and capsule hash; either differing from the issued chain refuses.
  if (evt.goalId !== issuance.goalId) {
    return {
      result: { ok: true },
      reply: await refuseGrant(
        ctx,
        { ...baseFacts, seq: evt.seq },
        "goal-shift",
        `renewal presents goal id '${evt.goalId}' but the chain was issued for '${issuance.goalId}'`,
      ),
    };
  }
  if (evt.capsuleHash !== issuance.capsuleHash) {
    return {
      result: { ok: true },
      reply: await refuseGrant(
        ctx,
        { ...baseFacts, seq: evt.seq },
        "capsule-mismatch",
        "renewal presents a different capsule hash than the issued chain",
      ),
    };
  }
  // Frozen Build-Spec binding: first presentation records it; any change
  // afterwards refuses (the freeze is one-way).
  if (
    latest.buildSpecHash &&
    evt.buildSpecHash &&
    latest.buildSpecHash !== evt.buildSpecHash
  ) {
    return {
      result: { ok: true },
      reply: await refuseGrant(
        ctx,
        { ...baseFacts, seq: evt.seq },
        "capsule-mismatch",
        "renewal presents a different frozen Build-Spec hash than the chain recorded",
      ),
    };
  }

  // Idempotent re-delivery of an already-issued renewal.
  const existing = issued.find((g) => g.seq === evt.seq);
  if (existing) {
    return {
      result: { ok: true },
      reply: {
        kind: "factory.run.grant",
        runId: evt.runId,
        granted: true,
        seq: existing.seq,
        grantJws: existing.grantJws ?? undefined,
        kid: existing.kid ?? undefined,
        expiresAt: existing.expiresAt?.toISOString(),
      },
    };
  }
  if (evt.seq !== latest.seq + 1) {
    return {
      result: { ok: true },
      reply: await refuseGrant(
        ctx,
        { ...baseFacts, seq: evt.seq },
        "seq-conflict",
        `renewal seq ${evt.seq} does not extend the chain (head is ${latest.seq})`,
      ),
    };
  }

  // FR-010 propagation leg: the standing admission and every node of the
  // admitted composition are re-checked at every boundary.
  const pre = await grantPreflight(
    ctx,
    issuance.envelopeHash,
    projectId,
    evt.agentProfile ?? null,
  );
  if (!pre.ok) {
    return {
      result: { ok: true },
      reply: await refuseGrant(ctx, { ...baseFacts, seq: evt.seq }, pre.reason, pre.detail),
    };
  }

  const reply = await signAndPersistGrant(ctx, {
    ...baseFacts,
    buildSpecHash: evt.buildSpecHash ?? latest.buildSpecHash,
    seq: evt.seq,
  });
  return { result: { ok: true }, reply };
}

// ---------------------------------------------------------------------------
// Emission countersign (FR-014) — triggered by factory.run.completed
// ---------------------------------------------------------------------------

/**
 * Verify the engine's reported certificate against the grant chain this
 * platform issued, and countersign. Returns null when the completion
 * envelope carries no `certificateSha256` (ungoverned/legacy run — the
 * certificate stays visibly unsealed). A non-null refusal reply is sent so
 * the engine can surface why its certificate stayed unsealed.
 */
export async function countersignRunCertificate(
  evt: ClientFactoryRunCompleted,
  ctx: HandlerCtx,
): Promise<CountersignReply | null> {
  if (!evt.certificateSha256) return null;

  const refuse = (reason: string): CountersignReply => {
    log.warn("certificate countersign refused", {
      orgId: ctx.orgId,
      runId: evt.runId,
      reason,
    });
    return {
      kind: "factory.run.certificate_countersign",
      runId: evt.runId,
      countersigned: false,
      refusedReason: reason,
    };
  };

  if (!signingConfigured()) {
    return refuse("signing authority not configured (FR-014)");
  }
  const owned = await loadOwnedRun(evt.runId, ctx.orgId);
  if (!owned.ok) {
    return refuse(owned.detail ?? owned.reason);
  }

  const issued = await loadIssuedGrants(ctx.orgId, evt.runId);
  if (issued.length === 0) {
    return refuse(
      "no grant chain was issued for this run — an ungranted run cannot be sealed",
    );
  }
  // Chain integrity: contiguous sequence starting at 0, one goal, one
  // capsule, one envelope. This is the platform's half of "verify the
  // engine's chain against the grant sequence it issued".
  for (let i = 0; i < issued.length; i++) {
    if (issued[i].seq !== i) {
      return refuse(`issued grant chain has a gap at seq ${i}`);
    }
  }
  const issuance = issued[0];
  if (
    issued.some(
      (g) =>
        g.goalId !== issuance.goalId ||
        g.capsuleHash !== issuance.capsuleHash ||
        g.envelopeHash !== issuance.envelopeHash,
    )
  ) {
    return refuse("issued grant chain is not internally consistent");
  }
  if (typeof evt.seq === "number" && evt.seq !== issued[issued.length - 1].seq) {
    return refuse(
      `engine reports final seq ${evt.seq} but the issued chain head is ${issued[issued.length - 1].seq}`,
    );
  }

  const grantChainSha256 = sha256hex(
    JSON.stringify(issued.map((g) => sha256hex(g.grantJws ?? ""))),
  );
  const { jws, kid } = signFactoryJws("oap-cert-countersign+jws", {
    iss: "statecraft-factory",
    org_id: ctx.orgId,
    project_id: issuance.projectId,
    run_id: evt.runId,
    certificate_sha256: evt.certificateSha256,
    envelope_hash: issuance.envelopeHash,
    goal_id: issuance.goalId,
    capsule_hash: issuance.capsuleHash,
    grant_count: issued.length,
    grant_chain_sha256: grantChainSha256,
    iat: Math.floor(Date.now() / 1000),
  });

  await db
    .update(factoryRuns)
    .set({ countersignedAt: new Date() })
    .where(eq(factoryRuns.id, evt.runId));
  await db.insert(auditLog).values({
    actorUserId: ctx.userId,
    nhiSub: ctx.nhiSub ?? null,
    onBehalfOf: ctx.onBehalfOf ?? null,
    action: FACTORY_RUN_COUNTERSIGNED,
    targetType: "factory_runs",
    targetId: evt.runId,
    metadata: {
      orgId: ctx.orgId,
      certificateSha256: evt.certificateSha256,
      grantCount: issued.length,
      grantChainSha256,
    },
  });

  return {
    kind: "factory.run.certificate_countersign",
    runId: evt.runId,
    countersigned: true,
    countersignJws: jws,
    kid,
  };
}
