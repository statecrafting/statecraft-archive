/**
 * Sync service layer.
 *
 * Boundaries:
 *   - `handleInbound`   : called by the duplex endpoint for each client event.
 *                         Validates, records, ACKs or NACKs.
 *   - `dispatchServerEvent` : called by producers (factory subscriber, policy
 *                         updates, etc) to push an authoritative event to an
 *                         org's connected clients.
 *   - `publishAck` / `publishNack` : helpers for ACK/NACK responses.
 *
 * This layer is the only place that talks to both the registry and the
 * outbox/inbox stores, and it is the only place that mints cursors for the
 * outbound path.
 *
 * Spec 119: scope key is `orgId`; per-event projectId
 * stays on each variant for project-scoped routing.
 */
import log from "encore.dev/log";
import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { db } from "../db/drizzle";
import {
  auditLog,
  factoryArtifactSubstrate,
  orgHalts,
  projects,
} from "../db/schema";
import {
  FACTORY_ORG_HALT_ACK_DROPPED,
  FACTORY_ORG_HALT_ENGINE_ACK,
  FACTORY_ORG_HALT_REINTEGRATED,
} from "../factory/auditActions";
import { loadLatestAdmission } from "../factory/admission";
import { resolveOriginsForOrg } from "../factory/substrateBrowser";
import type {
  ClientEnvelope,
  ServerEnvelope,
  ServerAck,
  ServerNack,
  ServerMeta,
  ServerAgentCatalogUpdated,
} from "./types";
import { ENVELOPE_SCHEMA_VERSION } from "./types";
import type { CatalogFrontmatter } from "../agents/frontmatter";

// Distributive Omit so Omit<UnionMember, "meta"> works variant-by-variant.
type DistributiveOmit<T, K extends keyof T> = T extends unknown
  ? Omit<T, K>
  : never;
export type ServerEnvelopeWithoutMeta = DistributiveOmit<ServerEnvelope, "meta">;
import { isClientEnvelope } from "./types";
import * as registry from "./registry";
import { inbox, outbox, cursors } from "./store";
import {
  handleStageStarted,
  handleStageCompleted,
  handleRunCompleted,
  handleRunFailed,
  handleRunCancelled,
  type RunHandlerResult,
} from "../factory/runDuplexHandlers";
import {
  countersignRunCertificate,
  handleGrantRenew,
  handleGrantRequest,
} from "../factory/grantDuplexHandlers";
import { handleAuditSegmentCountersignRequest } from "../factory/auditSegmentHandlers";

// ---------------------------------------------------------------------------
// Inbound path
// ---------------------------------------------------------------------------

export interface InboundContext {
  orgId: string;
  clientId: string;
  userId: string;
  // Spec 205 FR-005: two-principal attribution for agent (NHI) sessions.
  // Undefined for ordinary human sessions (Phase 0 plumbing; Phase 1
  // populates them when the duplex session is an agent NHI).
  nhiSub?: string | null;
  onBehalfOf?: string | null;
}

export type InboundResult =
  | { ok: true }
  | { ok: false; reason: ServerNack["reason"]; detail?: string };

export async function handleInbound(
  ctx: InboundContext,
  raw: unknown,
): Promise<InboundResult> {
  if (!isClientEnvelope(raw)) {
    log.warn("sync: rejected malformed client envelope", {
      orgId: ctx.orgId,
      clientId: ctx.clientId,
    });
    return { ok: false, reason: "invalid", detail: "malformed envelope" };
  }

  const evt: ClientEnvelope = raw;

  // Heartbeats and ACKs get lightweight handling — no inbox write.
  if (evt.kind === "sync.heartbeat") {
    const session = registry.get(ctx.orgId, ctx.clientId);
    if (session) session.meta.lastHeartbeatAt = new Date();
    return { ok: true };
  }

  if (evt.kind === "sync.ack") {
    await outbox.markAcked(ctx.orgId, evt.serverEventId, ctx.clientId);
    return { ok: true };
  }

  if (evt.kind === "sync.resync_request") {
    await deliverResync(ctx, evt.sinceCursor);
    return { ok: true };
  }

  if (evt.kind === "agent.catalog.fetch_request") {
    // Spec 111 §2.3 (amended by spec 119): reply is a targeted
    // agent.catalog.updated. The server resolves the agent's project from
    // the catalog row and verifies it belongs to the session's org —
    // preventing a cross-org probe from leaking entries through a
    // mismatched session.
    const served = await serveAgentCatalogFetch(ctx, evt.agentId);
    return served;
  }

  // Spec 124 §6 — `factory.run.*` lifecycle envelopes mutate a
  // `factory_runs` row. Dispatch goes through `runDuplexHandlers`; each
  // handler enforces org ownership and is idempotent on
  // (run_id, stage_id, status).
  if (
    evt.kind === "factory.run.stage_started" ||
    evt.kind === "factory.run.stage_completed" ||
    evt.kind === "factory.run.completed" ||
    evt.kind === "factory.run.failed" ||
    evt.kind === "factory.run.cancelled"
  ) {
    return runDispatch(ctx, evt);
  }

  // Spec 198 FR-005 — run-grant issuance/renewal. The handler validates the
  // capsule against the standing admission + FR-010 revocations and returns
  // a targeted `factory.run.grant` reply (granted or attributably refused).
  if (
    evt.kind === "factory.run.grant_request" ||
    evt.kind === "factory.run.grant_renew"
  ) {
    return grantDispatch(ctx, evt);
  }

  // Spec 207 AC-4: audit segment countersign. The handler signs the segment
  // HEAD and returns a targeted `audit.segment.countersign` reply.
  if (evt.kind === "audit.segment.countersign_request") {
    return auditSegmentDispatch(ctx, evt);
  }

  // Spec 208 FR-003: org.halt.ack records the engine's per-broadcast
  // propagation bound (a timestamp) on the quarantine record, so the realized
  // bound is an audited fact after every pull.
  if (evt.kind === "org.halt.ack") {
    return orgHaltAckDispatch(ctx, evt);
  }

  // For all other kinds, persist + log + audit where appropriate.
  try {
    await inbox.recordInbound({
      orgId: ctx.orgId,
      clientId: ctx.clientId,
      event: evt,
      status: "accepted",
      receivedAt: new Date(),
    });

    if (evt.kind === "audit.candidate") {
      // Statecraft remains audit authority: we normalise and commit under the
      // authenticated user. We deliberately DO NOT trust the desktop to pick
      // actor_user_id or the timestamp.
      await db.insert(auditLog).values({
        actorUserId: ctx.userId,
        nhiSub: ctx.nhiSub ?? null,
        onBehalfOf: ctx.onBehalfOf ?? null,
        action: `opc.${evt.action}`,
        targetType: evt.targetType,
        targetId: evt.targetId,
        metadata: {
          ...(evt.details ?? {}),
          clientId: ctx.clientId,
          orgId: ctx.orgId,
          clientEventId: evt.meta.eventId,
        },
      });
    }

    log.info("sync: inbound accepted", {
      orgId: ctx.orgId,
      clientId: ctx.clientId,
      kind: evt.kind,
      eventId: evt.meta.eventId,
    });
    return { ok: true };
  } catch (err) {
    log.error("sync: inbound processing failed", {
      orgId: ctx.orgId,
      clientId: ctx.clientId,
      kind: evt.kind,
      err: err instanceof Error ? err.message : String(err),
    });
    await inbox
      .recordInbound({
        orgId: ctx.orgId,
        clientId: ctx.clientId,
        event: evt,
        status: "rejected",
        receivedAt: new Date(),
        rejectionReason: "internal_error",
      })
      .catch(() => undefined);
    return { ok: false, reason: "internal_error" };
  }
}

// ---------------------------------------------------------------------------
// ACK / NACK publishing
// ---------------------------------------------------------------------------

function mintMeta(orgId: string, correlationId?: string): ServerMeta {
  return {
    v: ENVELOPE_SCHEMA_VERSION,
    eventId: randomUUID(),
    sentAt: new Date().toISOString(),
    correlationId,
    orgId,
    orgCursor: cursors.next(orgId),
  };
}

export async function publishAck(
  ctx: InboundContext,
  clientEventId: string,
): Promise<void> {
  const ack: ServerAck = {
    kind: "sync.ack",
    meta: mintMeta(ctx.orgId, clientEventId),
    clientEventId,
  };
  await registry.sendTo(ctx.orgId, ctx.clientId, ack);
}

export async function publishNack(
  ctx: InboundContext,
  clientEventId: string,
  reason: ServerNack["reason"],
  detail?: string,
): Promise<void> {
  const nack: ServerNack = {
    kind: "sync.nack",
    meta: mintMeta(ctx.orgId, clientEventId),
    clientEventId,
    reason,
    detail,
  };
  await registry.sendTo(ctx.orgId, ctx.clientId, nack);
}

// ---------------------------------------------------------------------------
// Outbound dispatch (called by producers)
// ---------------------------------------------------------------------------

/**
 * Dispatch a server-originated event to an org. The caller supplies the
 * event without `meta` — this function stamps it with the cursor and IDs,
 * records it in the outbox, and fans it out to connected clients.
 */
export async function dispatchServerEvent(
  orgId: string,
  event: ServerEnvelopeWithoutMeta,
  opts: { excludeClientId?: string; correlationId?: string } = {},
): Promise<{ eventId: string; cursor: string; delivered: number }> {
  const meta = mintMeta(orgId, opts.correlationId);
  // Cast is safe: we've just minted meta that satisfies ServerMeta for every variant.
  const full = { ...event, meta } as ServerEnvelope;

  await outbox.recordOutbound({
    orgId,
    event: full,
    createdAt: new Date(),
    ackedBy: new Set(),
  });

  const { sent } = await registry.broadcastOrg(orgId, full, {
    excludeClientId: opts.excludeClientId,
  });

  log.info("sync: server event dispatched", {
    orgId,
    kind: full.kind,
    eventId: meta.eventId,
    cursor: meta.orgCursor,
    delivered: sent,
  });

  return { eventId: meta.eventId, cursor: meta.orgCursor, delivered: sent };
}

/**
 * Send a server-originated event to a single connected client (instead of
 * broadcasting). Used for direct replies — e.g. the targeted
 * `agent.catalog.updated` response to an `agent.catalog.fetch_request`
 * (spec 111 §2.3). The targeted send deliberately skips the outbox: the
 * desktop already has a correlation-free path to re-request on reconnect
 * via the snapshot, so durable replay of a single-client reply is wasted.
 */
export async function sendTargetedServerEvent(
  orgId: string,
  clientId: string,
  event: ServerEnvelopeWithoutMeta,
  opts: { correlationId?: string } = {},
): Promise<boolean> {
  const meta = mintMeta(orgId, opts.correlationId);
  const full = { ...event, meta } as ServerEnvelope;
  return registry.sendTo(orgId, clientId, full);
}

// ---------------------------------------------------------------------------
// Spec 208 FR-001/FR-003/FR-004: org-halt broadcast (the propagation seam)
// ---------------------------------------------------------------------------

/** The halt scopes mirrored from `api/factory/orgHalt.ts` (inlined to keep the
 *  sync to factory edge type-only / cycle-free). */
type OrgHaltBroadcastScope = "org" | "project" | "agent-profile";

/**
 * Spec 208 FR-001/FR-003: broadcast a halt activation (or lift) to every engine
 * connected to the org over the outbox-durable `dispatchServerEvent` path.
 * Called by `pullHaltCore` / `liftHaltCore` AFTER their DB transaction commits
 * (the agents/relay.ts ordering precedent): enforcement is already in effect
 * via the `org_halts` row, so a failed broadcast never leaves the row and the
 * wire out of step, and a grant renewal racing this still fails closed.
 *
 * Outbox-durable (not targeted) is the deliberate choice (plan.md §Propagation
 * decision): an engine that reconnects after the broadcast replays the halt on
 * `sync.resync_request`, so a disconnected engine is covered at the reconnect
 * handshake, not only the connected ones.
 */
export async function broadcastOrgHalt(
  orgId: string,
  event:
    | {
        change: "activated";
        haltId: string;
        scope: OrgHaltBroadcastScope;
        scopeKey: string;
        reason: string;
      }
    | {
        change: "lifted";
        haltId: string;
        scope: OrgHaltBroadcastScope;
        scopeKey: string;
      },
): Promise<{ eventId: string; cursor: string; delivered: number }> {
  const payload: ServerEnvelopeWithoutMeta =
    event.change === "activated"
      ? {
          kind: "org.halt.activated",
          haltId: event.haltId,
          scope: event.scope,
          scopeKey: event.scopeKey,
          // Free-form reason rides `detail` (the `reason` wire field is a closed
          // nack/resync union); see api/sync/types.ts ServerOrgHaltActivated.
          detail: event.reason,
        }
      : {
          kind: "org.halt.lifted",
          haltId: event.haltId,
          scope: event.scope,
          scopeKey: event.scopeKey,
        };

  const result = await dispatchServerEvent(orgId, payload);
  log.info("sync: org-halt broadcast dispatched", {
    orgId,
    change: event.change,
    haltId: event.haltId,
    scope: event.scope,
    scopeKey: event.scopeKey,
    delivered: result.delivered,
  });
  return result;
}

// ---------------------------------------------------------------------------
// Spec 198 FR-005 — factory.run.grant_request / grant_renew dispatch
// ---------------------------------------------------------------------------

async function grantDispatch(
  ctx: InboundContext,
  evt: ClientEnvelope,
): Promise<InboundResult> {
  try {
    // Spec 205 FR-005: forward the two-principal fields so the grant-path
    // audit inserts receive them once Phase 1 populates the session ctx.
    const handlerCtx = {
      orgId: ctx.orgId,
      userId: ctx.userId,
      nhiSub: ctx.nhiSub,
      onBehalfOf: ctx.onBehalfOf,
    };
    const outcome =
      evt.kind === "factory.run.grant_request"
        ? await handleGrantRequest(evt, handlerCtx)
        : evt.kind === "factory.run.grant_renew"
          ? await handleGrantRenew(evt, handlerCtx)
          : null;
    if (!outcome) {
      return { ok: false, reason: "invalid", detail: "unknown grant event" };
    }
    if (outcome.reply) {
      await sendTargetedServerEvent(ctx.orgId, ctx.clientId, outcome.reply, {
        correlationId: evt.meta.eventId,
      });
    }
    if (!outcome.result.ok) {
      log.warn("sync: factory.run grant handler rejected", {
        orgId: ctx.orgId,
        clientId: ctx.clientId,
        kind: evt.kind,
        reason: outcome.result.reason,
        detail: outcome.result.detail,
      });
    }
    return outcome.result;
  } catch (err) {
    log.error("sync: factory.run grant handler failed", {
      orgId: ctx.orgId,
      clientId: ctx.clientId,
      kind: evt.kind,
      err: err instanceof Error ? err.message : String(err),
    });
    return { ok: false, reason: "internal_error" };
  }
}

// ---------------------------------------------------------------------------
// Spec 207 AC-4: audit.segment.countersign_request dispatch
// ---------------------------------------------------------------------------

async function auditSegmentDispatch(
  ctx: InboundContext,
  evt: ClientEnvelope,
): Promise<InboundResult> {
  if (evt.kind !== "audit.segment.countersign_request") {
    return { ok: false, reason: "invalid", detail: "unexpected event kind" };
  }
  try {
    const handlerCtx = { orgId: ctx.orgId, userId: ctx.userId };
    const reply = await handleAuditSegmentCountersignRequest(evt, handlerCtx);
    await sendTargetedServerEvent(ctx.orgId, ctx.clientId, reply, {
      correlationId: evt.meta.eventId,
    });
    return { ok: true };
  } catch (err) {
    log.error("sync: audit segment countersign handler failed", {
      orgId: ctx.orgId,
      clientId: ctx.clientId,
      kind: evt.kind,
      err: err instanceof Error ? err.message : String(err),
    });
    return { ok: false, reason: "internal_error" };
  }
}

// ---------------------------------------------------------------------------
// Spec 208 FR-003: org.halt.ack dispatch (per-engine propagation timestamp)
// ---------------------------------------------------------------------------

// Spec 208 FR-004 (D2): "fresh two-sided validation" for a lift-ack. Mirrors
// grantDuplexHandlers.ts::resolveStandingAdmission using the same admission
// primitives (`resolveOriginsForOrg` + `loadLatestAdmission`), inlined here
// rather than importing that higher-level helper to avoid an import cycle back
// into this module (the same reason the halt scopes above are inlined). A lift
// only counts toward reintegration when the org's factory is currently
// admitted; otherwise the engine's self-reported readiness is not honored.
async function orgFactoryAdmitted(orgId: string): Promise<boolean> {
  const { factoryOriginId } = await resolveOriginsForOrg(orgId);
  if (!factoryOriginId) return false;
  const state = await loadLatestAdmission(orgId, factoryOriginId);
  return state.status === "admitted";
}

async function orgHaltAckDispatch(
  ctx: InboundContext,
  evt: ClientEnvelope,
): Promise<InboundResult> {
  if (evt.kind !== "org.halt.ack") {
    return { ok: false, reason: "invalid", detail: "unexpected event kind" };
  }
  // Server-authoritative fields: `clientId` from the authenticated session and
  // `recordedAt` from the server clock at receipt (the audit.candidate posture
  // -- the wire never self-reports either). `ackedAt` is the engine's CLAIMED
  // pause/checkpoint boundary, retained as an observation. An engine (or an
  // attacker on a valid duplex session) can put any value in `ackedAt`, so the
  // trustworthy propagation bound an auditor reads is `recordedAt`, not it.
  const entry = {
    clientId: ctx.clientId,
    ackedAt: evt.ackedAt,
    recordedAt: new Date().toISOString(),
    kind: evt.haltKind,
  };
  try {
    const result = await db.transaction(async (tx) => {
      // Dropped-ack audit (spec 208 T024, FR-004 follow-up): every benign drop
      // path below records a FACTORY_ORG_HALT_ACK_DROPPED row so a dropped ack is
      // visible in the audit chain rather than only in log.info. `reason` names
      // which guard fired. Written inside the txn (atomic with the drop decision);
      // the drop paths do not mutate org_halts, so this is the only write they do.
      const auditDrop = (
        reason: "duplicate" | "not-halted" | "not-reintegrating",
      ) =>
        tx.insert(auditLog).values({
          actorUserId: ctx.userId,
          nhiSub: ctx.nhiSub ?? null,
          onBehalfOf: ctx.onBehalfOf ?? null,
          action: FACTORY_ORG_HALT_ACK_DROPPED,
          targetType: "org_halts",
          targetId: evt.haltId,
          metadata: {
            orgId: ctx.orgId,
            clientId: ctx.clientId,
            haltKind: evt.haltKind,
            ackedAt: evt.ackedAt,
            recordedAt: entry.recordedAt,
            reason,
          },
        });
      // FOR UPDATE locks the quarantine row for the txn so the dedup
      // read-modify-write is race-free. The ack is a cold path (one per engine
      // per broadcast), so the lock cost is irrelevant. A cross-org or unknown
      // haltId matches zero rows -> out-of-scope / unknown.
      const [row] = await tx
        .select({
          id: orgHalts.id,
          acks: orgHalts.acks,
          state: orgHalts.state,
        })
        .from(orgHalts)
        .where(and(eq(orgHalts.id, evt.haltId), eq(orgHalts.orgId, ctx.orgId)))
        .for("update")
        .limit(1);
      if (!row) return "unknown" as const;

      // Idempotency (FR-003): the broadcast is outbox-durable, so a reconnecting
      // engine replays the halt on resync and re-acks. Without this guard every
      // reconnect would append another entry (unbounded jsonb growth) and emit a
      // duplicate engine_ack audit row miscounted as a distinct ack. One
      // (clientId, kind) ack per halt is the fact; the first `recordedAt` is the
      // bound. The replay is instead recorded as an explicit ACK_DROPPED marker
      // (T024) -- forensically visible, but not a phantom ack and not jsonb growth.
      const already = row.acks.some(
        (a) => a.clientId === ctx.clientId && a.kind === evt.haltKind,
      );
      if (already) {
        await auditDrop("duplicate");
        return "duplicate" as const;
      }

      // Symmetric write-path guard (spec 208 T023, FR-004): a halt ack only
      // counts while the scope is `halted`. A late halt-ack replayed via resync
      // after the scope has moved to `reintegrating` (the operator already
      // lifted) or `lifted` must NOT be recorded: for a client not already in the
      // ledger (the idempotency check above misses it) it would widen the
      // halt-acker set, adding a phantom acker that is then expected to lift-ack
      // and so holds the scope in `reintegrating` indefinitely. The direction is
      // fail-safe (over-count, never a premature `lifted`), but a stuck
      // reintegration is still a defect, so drop it. The engine re-acks on the
      // next broadcast per the resync-replay contract, so the drop is lossless.
      // This mirrors the lift-ack cycle guard below.
      if (evt.haltKind === "halt" && row.state !== "halted") {
        await auditDrop("not-halted");
        return "not-halted" as const;
      }

      // Cycle guard (spec 208 FR-004): a lift ack only counts while the halt is
      // actively reintegrating. Outside that window (a halt still `halted` after
      // a D3 re-pull reset the ledger, or one already `lifted`), an in-flight
      // lift ack replayed via resync must NOT be recorded: it would sit in the
      // ledger and be miscounted as a completed lift in the NEXT reintegration
      // cycle, flipping the halt to `lifted` for an engine that never lift-acked
      // that cycle. The engine re-acks on the next `lifted` broadcast per the
      // resync-replay contract, so ignoring it here is safe and lossless. Halt
      // acks (kind === "halt") are unaffected; they record while `halted`.
      if (evt.haltKind === "lift" && row.state !== "reintegrating") {
        await auditDrop("not-reintegrating");
        return "not-reintegrating" as const;
      }

      // D2 (spec 208 FR-004): a lift ack must pass fresh two-sided validation
      // before it counts toward reintegration. Re-check the standing admission
      // (the liftRevocationCore "lifting alone does not re-admit" precedent): if
      // the org's factory admission is not currently 'admitted', the engine's
      // self-reported readiness is NOT honored, the ack is not recorded, and the
      // engine re-acks on its next resync.
      if (evt.haltKind === "lift" && !(await orgFactoryAdmitted(ctx.orgId))) {
        return "not-readmitted" as const;
      }

      await tx
        .update(orgHalts)
        .set({
          acks: sql`${orgHalts.acks} || ${JSON.stringify([entry])}::jsonb`,
        })
        .where(eq(orgHalts.id, evt.haltId));
      await tx.insert(auditLog).values({
        actorUserId: ctx.userId,
        nhiSub: ctx.nhiSub ?? null,
        onBehalfOf: ctx.onBehalfOf ?? null,
        action: FACTORY_ORG_HALT_ENGINE_ACK,
        targetType: "org_halts",
        targetId: evt.haltId,
        metadata: {
          orgId: ctx.orgId,
          clientId: ctx.clientId,
          haltKind: evt.haltKind,
          ackedAt: evt.ackedAt,
          recordedAt: entry.recordedAt,
        },
      });
      // Reintegration completion (FR-004): a halt reaches 'lifted' only when
      // every engine that recorded a halt-ack has since recorded a lift-ack.
      // Computed over the ack ledger including this entry; no new column. The
      // vacuous case (no engine ever halt-acked, e.g. none were connected)
      // completes on the first lift-ack, which is correct: there is nothing to
      // re-admit. The row is FOR UPDATE-locked above, so the CAS is race-free.
      if (evt.haltKind === "lift" && row.state === "reintegrating") {
        const acks = [...row.acks, entry];
        const haltAckers = new Set(
          acks.filter((a) => a.kind === "halt").map((a) => a.clientId),
        );
        const liftAckers = new Set(
          acks.filter((a) => a.kind === "lift").map((a) => a.clientId),
        );
        const outstanding = [...haltAckers].filter((c) => !liftAckers.has(c));
        if (outstanding.length === 0) {
          const done = await tx
            .update(orgHalts)
            .set({ state: "lifted" })
            .where(
              and(
                eq(orgHalts.id, evt.haltId),
                eq(orgHalts.state, "reintegrating"),
              ),
            )
            .returning({ id: orgHalts.id });
          if (done.length > 0) {
            await tx.insert(auditLog).values({
              actorUserId: ctx.userId,
              nhiSub: ctx.nhiSub ?? null,
              onBehalfOf: ctx.onBehalfOf ?? null,
              action: FACTORY_ORG_HALT_REINTEGRATED,
              targetType: "org_halts",
              targetId: evt.haltId,
              metadata: {
                orgId: ctx.orgId,
                haltAckers: [...haltAckers],
                liftAckers: [...liftAckers],
              },
            });
            return "completed" as const;
          }
        }
      }
      return "appended" as const;
    });
    if (result === "unknown") {
      return {
        ok: false,
        reason: "invalid",
        detail: "unknown or out-of-scope halt",
      };
    }
    if (result === "not-readmitted") {
      // D2: the lift-ack was refused because the org's factory admission is not
      // currently 'admitted'. Not recorded; the engine re-acks on resync once
      // admission is restored (fresh two-sided validation, FR-004).
      log.info("sync: org-halt lift ack rejected (admission not admitted)", {
        orgId: ctx.orgId,
        clientId: ctx.clientId,
        haltId: evt.haltId,
      });
      return {
        ok: false,
        reason: "invalid",
        detail:
          "lift ack rejected: org factory admission is not currently " +
          "admitted (fresh re-validation failed, FR-004)",
      };
    }
    if (result === "not-halted") {
      // Symmetric write-path guard (T023): the halt ack arrived while the scope
      // was no longer `halted` (already `reintegrating` or `lifted`). Not
      // recorded, so a stale halt-ack cannot widen the halt-acker set of a cycle
      // that has moved on. Benign no-op: the engine re-acks on the next broadcast
      // per the resync-replay contract. Audited as a drop (T024).
      log.info("sync: org-halt halt ack ignored (halt no longer halted)", {
        orgId: ctx.orgId,
        clientId: ctx.clientId,
        haltId: evt.haltId,
      });
      return { ok: true };
    }
    if (result === "not-reintegrating") {
      // Cycle guard: the lift ack arrived while the halt was not actively
      // reintegrating. Not recorded, so a stale ack cannot contaminate the next
      // reintegration cycle's completion count. Benign no-op in both branches:
      // for `halted` (e.g. after a D3 re-pull) the engine re-acks on the next
      // `lifted` broadcast per the resync-replay contract; for `lifted` the halt
      // is already complete, so there is no next broadcast and the drop is final.
      log.info("sync: org-halt lift ack ignored (halt not reintegrating)", {
        orgId: ctx.orgId,
        clientId: ctx.clientId,
        haltId: evt.haltId,
      });
      return { ok: true };
    }
    if (result === "completed") {
      log.info(
        "sync: org-halt reintegration complete (every halt-acker lift-acked)",
        { orgId: ctx.orgId, haltId: evt.haltId },
      );
      return { ok: true };
    }
    if (result === "duplicate") {
      // A replayed ack is a no-op success: the bound is already recorded. The
      // replay is captured as an ACK_DROPPED audit (T024) so the audit chain
      // shows the reconnect without minting a second engine_ack.
      log.info("sync: org-halt engine ack replay ignored (already recorded)", {
        orgId: ctx.orgId,
        clientId: ctx.clientId,
        haltId: evt.haltId,
        haltKind: evt.haltKind,
      });
      return { ok: true };
    }
    log.info("sync: org-halt engine ack recorded", {
      orgId: ctx.orgId,
      clientId: ctx.clientId,
      haltId: evt.haltId,
      haltKind: evt.haltKind,
    });
    return { ok: true };
  } catch (err) {
    log.error("sync: org-halt ack handler failed", {
      orgId: ctx.orgId,
      clientId: ctx.clientId,
      haltId: evt.haltId,
      err: err instanceof Error ? err.message : String(err),
    });
    return { ok: false, reason: "internal_error" };
  }
}

// ---------------------------------------------------------------------------
// Agent catalog fetch request (spec 111 §2.3, amended by spec 119)
// ---------------------------------------------------------------------------

async function serveAgentCatalogFetch(
  ctx: InboundContext,
  agentId: string,
): Promise<InboundResult> {
  // Spec 139 Phase 4b — substrate-direct read (legacy `agent_catalog`
  // dropped by migration 35). Agents live as
  // `(origin='user-authored', kind='agent')` rows; the spec 111
  // publication ternary recovers from `frontmatter.publication_status`.
  const [row] = await db
    .select()
    .from(factoryArtifactSubstrate)
    .where(
      and(
        eq(factoryArtifactSubstrate.id, agentId),
        eq(factoryArtifactSubstrate.origin, "user-authored"),
        eq(factoryArtifactSubstrate.kind, "agent"),
      ),
    )
    .limit(1);

  if (!row) {
    return { ok: false, reason: "invalid", detail: "agent not found" };
  }
  if (row.orgId !== ctx.orgId) {
    return {
      ok: false,
      reason: "org_mismatch",
      detail: "agent belongs to a different org",
    };
  }

  const fm = (row.frontmatter as Record<string, unknown> | null) ?? null;
  const fmStatus = fm?.publication_status;
  const publicationStatus =
    row.status === "retired"
      ? "retired"
      : fmStatus === "published" || fmStatus === "retired"
        ? fmStatus
        : "draft";
  if (publicationStatus === "draft") {
    return {
      ok: false,
      reason: "invalid",
      detail: "agent is a draft; drafts never travel the catalog wire",
    };
  }

  const PATH_PREFIX = "user-authored/";
  const PATH_SUFFIX = ".md";
  const name = row.path.startsWith(PATH_PREFIX) && row.path.endsWith(PATH_SUFFIX)
    ? row.path.slice(PATH_PREFIX.length, row.path.length - PATH_SUFFIX.length)
    : row.path;
  const cleanedFm: Record<string, unknown> = { ...(fm ?? {}) };
  delete cleanedFm.publication_status;

  const event: Omit<ServerAgentCatalogUpdated, "meta"> = {
    kind: "agent.catalog.updated",
    agentId: row.id,
    orgId: row.orgId,
    name,
    version: row.version,
    status: publicationStatus,
    contentHash: row.contentHash,
    frontmatter: cleanedFm as CatalogFrontmatter,
    bodyMarkdown: row.userBody ?? row.effectiveBody,
    updatedAt: row.updatedAt.toISOString(),
  };
  await sendTargetedServerEvent(ctx.orgId, ctx.clientId, event);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Spec 124 §6 — factory.run.* dispatch
// ---------------------------------------------------------------------------

async function runDispatch(
  ctx: InboundContext,
  evt: ClientEnvelope,
): Promise<InboundResult> {
  let result: RunHandlerResult;
  try {
    switch (evt.kind) {
      case "factory.run.stage_started":
        result = await handleStageStarted(evt, {
          orgId: ctx.orgId,
          userId: ctx.userId,
        });
        break;
      case "factory.run.stage_completed":
        result = await handleStageCompleted(evt, {
          orgId: ctx.orgId,
          userId: ctx.userId,
        });
        break;
      case "factory.run.completed":
        result = await handleRunCompleted(evt, {
          orgId: ctx.orgId,
          userId: ctx.userId,
        });
        // Spec 198 FR-014 — when the completion reports a certificate hash,
        // verify the issued grant chain and countersign. The reply is
        // targeted (the engine patches the persisted certificate); a
        // refusal reply is still sent so an unsealed certificate is
        // attributable, never silent.
        if (result.ok) {
          const countersign = await countersignRunCertificate(evt, {
            orgId: ctx.orgId,
            userId: ctx.userId,
            // Spec 205 FR-005: countersign rows carry the two principals
            // once Phase 1 populates the session ctx.
            nhiSub: ctx.nhiSub,
            onBehalfOf: ctx.onBehalfOf,
          });
          if (countersign) {
            await sendTargetedServerEvent(ctx.orgId, ctx.clientId, countersign, {
              correlationId: evt.meta.eventId,
            });
          }
        }
        break;
      case "factory.run.failed":
        result = await handleRunFailed(evt, {
          orgId: ctx.orgId,
          userId: ctx.userId,
        });
        break;
      case "factory.run.cancelled":
        result = await handleRunCancelled(evt, {
          orgId: ctx.orgId,
          userId: ctx.userId,
        });
        break;
      default:
        // The kind-narrowing in `handleInbound` makes this unreachable.
        return { ok: false, reason: "invalid", detail: "unknown run event" };
    }
  } catch (err) {
    log.error("sync: factory.run handler failed", {
      orgId: ctx.orgId,
      clientId: ctx.clientId,
      kind: evt.kind,
      err: err instanceof Error ? err.message : String(err),
    });
    return { ok: false, reason: "internal_error" };
  }

  if (!result.ok) {
    log.warn("sync: factory.run handler rejected", {
      orgId: ctx.orgId,
      clientId: ctx.clientId,
      kind: evt.kind,
      reason: result.reason,
      detail: result.detail,
    });
    return result;
  }

  log.info("sync: factory.run handler accepted", {
    orgId: ctx.orgId,
    clientId: ctx.clientId,
    kind: evt.kind,
    eventId: evt.meta.eventId,
  });
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Resync delivery
// ---------------------------------------------------------------------------

async function deliverResync(
  ctx: InboundContext,
  sinceCursor: string | undefined,
): Promise<void> {
  const pending = await outbox.loadPendingForClient(
    ctx.orgId,
    ctx.clientId,
    sinceCursor,
  );

  log.info("sync: delivering resync", {
    orgId: ctx.orgId,
    clientId: ctx.clientId,
    pendingCount: pending.length,
    sinceCursor,
  });

  for (const evt of pending) {
    const ok = await registry.sendTo(ctx.orgId, ctx.clientId, evt);
    if (!ok) break;
  }
}
