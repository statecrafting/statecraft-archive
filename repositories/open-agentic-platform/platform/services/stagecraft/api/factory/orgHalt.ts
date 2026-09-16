// Spec 208 FR-001/FR-002/FR-004: org-wide agent kill-switch verb.
//
// The switch is a thin org-scoped verb over primitives that already ship: it
// writes a quarantine record (org_halts) that the existing fail-closed check
// sites (grant issuance/renewal in grantDuplexHandlers.ts, new-session
// registration in api/sync/duplex.ts, serve/bind in admission.ts) consult via
// `isHaltedInScope`. No parallel control plane.
//
// Two-tier shape (the revocations.ts liftRevocationCore precedent): each verb
// is a `*Core(auth, req)` function plus a thin `api(...)` endpoint wrapper that
// resolves `auth` through `requireFactoryConfigure`. AC-2/AC-4 tests drive the
// core functions directly with an explicit `{orgId, userId}` and never need an
// HTTP/auth context. The human-actor gate (AC-4: a service identity is
// rejected) is structural: the only route in is the `auth: true` endpoint
// through `requireFactoryConfigure`, and a service identity has no
// org-membership row to satisfy it.
//
// Phase 3 enforces all three scopes. `agent-profile` halts now refuse grant
// renewal: the engine resolves the profile about to execute a stage from its
// reservation-time stage-agent map and presents it on `factory.run.grant_renew`
// (spec 208 FR-001/AC-3), so `isHaltedInScope`'s agent-profile arm gates a real
// fact. Enforcement is at grant renewal only (issuance has no single profile,
// since a run spans several over its life); the first renewal fires before s0,
// so a run whose stage profile is halted is refused before any agent output.

import { api, APIError } from "encore.dev/api";
import log from "encore.dev/log";
import { and, eq, ne, or } from "drizzle-orm";
import { db } from "../db/drizzle";
import { auditLog, orgHalts } from "../db/schema";
import { requireFactoryConfigure } from "./revocations";
import {
  FACTORY_ORG_HALT_ACTIVATED,
  FACTORY_ORG_HALT_LIFTED,
  FACTORY_ORG_HALT_REASSERTED,
} from "./auditActions";
import { broadcastOrgHalt } from "../sync/service";

export type HaltScope = "org" | "project" | "agent-profile";
export type HaltState = "halted" | "reintegrating" | "lifted";

/** Discriminators a check site can supply to scope the halt consult. */
export interface HaltScopeQuery {
  /** The project the action belongs to (known at the grant seam). */
  projectId?: string | null;
  /** The agent profile the action belongs to (known at session seams). */
  agentProfile?: string | null;
}

/**
 * Returns the id of an active (non-'lifted') halt covering this scope, or
 * null. Scope union (spec 208 §Scope lattice): an `org` halt subsumes
 * everything; a `project` halt matches when its scope_key === projectId; an
 * `agent-profile` halt matches when its scope_key === agentProfile. A
 * 'reintegrating' row still counts as active (FR-004); only 'lifted' clears
 * the scope, which is exactly the partial liveness index predicate.
 *
 * The scope predicate is pushed into SQL with `.limit(1)` (the
 * `hasActiveRevocation` precedent) so this fail-closed hot-path consult is an
 * indexed equality lookup, not an in-app scan: `org_id` + `state != 'lifted'`
 * is the partial index, and the scope-union arms key off `scope`/`scope_key`.
 */
export async function isHaltedInScope(
  orgId: string,
  { projectId, agentProfile }: HaltScopeQuery = {},
): Promise<string | null> {
  const scopeArms = [eq(orgHalts.scope, "org")];
  if (projectId) {
    scopeArms.push(
      and(eq(orgHalts.scope, "project"), eq(orgHalts.scopeKey, projectId))!,
    );
  }
  if (agentProfile) {
    scopeArms.push(
      and(
        eq(orgHalts.scope, "agent-profile"),
        eq(orgHalts.scopeKey, agentProfile),
      )!,
    );
  }

  const [row] = await db
    .select({ id: orgHalts.id })
    .from(orgHalts)
    .where(
      and(
        eq(orgHalts.orgId, orgId),
        ne(orgHalts.state, "lifted"),
        or(...scopeArms),
      ),
    )
    .limit(1);

  return row?.id ?? null;
}

export interface PullHaltRequest {
  scope: HaltScope;
  /**
   * The scope target: a project id for `project`. Ignored for `org` (the org
   * id is used by convention).
   */
  scopeKey?: string;
  reason: string;
}

export interface PullHaltResponse {
  haltId: string;
  scope: HaltScope;
  scopeKey: string;
  /** The active state: 'halted' for a fresh pull, or the existing state if an
   * active halt already covered this scope (the pull is idempotent). */
  state: "halted" | "reintegrating";
}

/**
 * FR-001: set a halt for one scope. Requires `factory:configure` (resolved by
 * the endpoint wrapper) and a non-empty reason (the reason is audit evidence,
 * not a toggle). The row write and its activation audit are one transaction
 * (the reason-as-evidence guarantee must be atomic). Idempotent: if an active
 * (non-'lifted') halt already covers the exact scope, it is returned rather
 * than duplicated, and the partial UNIQUE index is the DB backstop against a
 * racing second insert.
 */
export async function pullHaltCore(
  auth: { orgId: string; userId: string },
  req: PullHaltRequest,
): Promise<PullHaltResponse> {
  const reason = req.reason?.trim();
  if (!reason) {
    throw APIError.invalidArgument(
      "a non-empty reason is required to pull a halt",
    );
  }
  // For an `org` scope the scope_key is the org id by convention; a project
  // scope carries an explicit target.
  const scopeKey =
    req.scope === "org" ? auth.orgId : (req.scopeKey ?? "").trim();
  if (req.scope !== "org" && !scopeKey) {
    throw APIError.invalidArgument(
      `scopeKey is required for a ${req.scope}-scoped halt`,
    );
  }

  const { response, fresh } = await db.transaction(async (tx) => {
    const [existing] = await tx
      .select({ id: orgHalts.id, state: orgHalts.state })
      .from(orgHalts)
      .where(
        and(
          eq(orgHalts.orgId, auth.orgId),
          eq(orgHalts.scope, req.scope),
          eq(orgHalts.scopeKey, scopeKey),
          ne(orgHalts.state, "lifted"),
        ),
      )
      .for("update")
      .limit(1);
    if (existing) {
      // D3 (spec 208 FR-004): a pull landing on a scope still 'reintegrating'
      // re-asserts the halt. The scope is still enforced, but the new pull
      // carries a new reason and must re-pause engines that had begun
      // re-admission, so transition back to 'halted', adopt the new reason,
      // and RESET the ack ledger + lift actor: the prior halt/lift acks
      // describe a pause being re-issued, so the reintegration completion
      // count (service.ts) must recount from a clean slate. Row-locked via
      // `.for("update")` above, so this CAS cannot race a concurrent lift.
      if (existing.state === "reintegrating") {
        await tx
          .update(orgHalts)
          .set({
            state: "halted",
            reason,
            pulledBy: auth.userId,
            pulledAt: new Date(),
            liftedBy: null,
            liftedAt: null,
            acks: [],
          })
          .where(eq(orgHalts.id, existing.id));

        await tx.insert(auditLog).values({
          actorUserId: auth.userId,
          action: FACTORY_ORG_HALT_REASSERTED,
          targetType: "org_halts",
          targetId: existing.id,
          metadata: { orgId: auth.orgId, scope: req.scope, scopeKey, reason },
        });

        return {
          response: {
            haltId: existing.id,
            scope: req.scope,
            scopeKey,
            state: "halted" as const,
          },
          // A re-assertion re-broadcasts 'activated' so engines re-pause.
          fresh: true as const,
        };
      }
      return {
        response: {
          haltId: existing.id,
          scope: req.scope,
          scopeKey,
          state: existing.state as "halted" | "reintegrating",
        },
        fresh: false as const,
      };
    }

    const [row] = await tx
      .insert(orgHalts)
      .values({
        orgId: auth.orgId,
        scope: req.scope,
        scopeKey,
        state: "halted",
        reason,
        pulledBy: auth.userId,
      })
      .returning({ id: orgHalts.id });

    await tx.insert(auditLog).values({
      actorUserId: auth.userId,
      action: FACTORY_ORG_HALT_ACTIVATED,
      targetType: "org_halts",
      targetId: row.id,
      metadata: { orgId: auth.orgId, scope: req.scope, scopeKey, reason },
    });

    return {
      response: {
        haltId: row.id,
        scope: req.scope,
        scopeKey,
        state: "halted" as const,
      },
      fresh: true as const,
    };
  });

  // Spec 208 FR-001/FR-003: propagate AFTER the row commits, and only on a
  // fresh pull. Enforcement (grant/serve/bind/registration refusal) is already
  // live via the committed row, so the broadcast accelerates the engine pause;
  // it does not gate it. A missed broadcast therefore degrades safely (the run
  // pauses at the next grant renewal instead of immediately), and a
  // reconnecting engine replays the halt off the outbox on resync. An
  // idempotent re-pull does not re-broadcast: the active record already drives
  // both the refusal path and the resync replay.
  if (fresh) {
    // The broadcast is best-effort acceleration, not the enforcement path: the
    // committed row already drives the fail-closed refusal and the resync
    // replay. A broadcast failure must therefore NOT convert a succeeded,
    // already-enforced halt into a client-visible 500 (the caller would retry,
    // land on the idempotent path above, and never re-broadcast). Log and
    // continue so the documented "degrades safely" contract holds in the code,
    // not just the comment.
    try {
      await broadcastOrgHalt(auth.orgId, {
        change: "activated",
        haltId: response.haltId,
        scope: response.scope,
        scopeKey: response.scopeKey,
        reason,
      });
    } catch (err) {
      log.error(
        "org-halt: activation broadcast failed (halt already enforced)",
        {
          orgId: auth.orgId,
          haltId: response.haltId,
          err: err instanceof Error ? err.message : String(err),
        },
      );
    }
  }

  return response;
}

export const pullHalt = api(
  { method: "POST", path: "/api/factory/org-halts", expose: true, auth: true },
  async (req: PullHaltRequest): Promise<PullHaltResponse> => {
    const auth = await requireFactoryConfigure();
    return pullHaltCore(auth, req);
  },
);

export interface LiftHaltRequest {
  id: string;
}

export interface LiftHaltResponse {
  haltId: string;
  state: "reintegrating";
}

/**
 * FR-004 (Phase 1 leg): begin lifting a halt. Requires a human actor id
 * (the endpoint wrapper's `factory:configure` gate; a service identity is
 * rejected, AC-4) and transitions 'halted' -> 'reintegrating'. Lifting alone
 * does not re-admit: a 'reintegrating' scope still refuses new sessions and
 * grants until staged per-scope re-admission flips it to 'lifted', which
 * lands in Phase 3 (the revocations.ts "lifting alone does not re-admit"
 * precedent).
 *
 * The transition is a compare-and-swap inside one transaction: the UPDATE
 * carries `AND state = 'halted'` and the affected-row count is the gate, so
 * two concurrent lifts cannot both transition + double-audit (a TOCTOU the
 * read-then-write shape would otherwise allow). The state mutation and its
 * audit are atomic.
 */
export async function liftHaltCore(
  auth: { orgId: string; userId: string },
  req: LiftHaltRequest,
): Promise<LiftHaltResponse> {
  const { scope, scopeKey } = await db.transaction(async (tx) => {
    const [row] = await tx
      .select({
        orgId: orgHalts.orgId,
        state: orgHalts.state,
        scope: orgHalts.scope,
        scopeKey: orgHalts.scopeKey,
      })
      .from(orgHalts)
      .where(eq(orgHalts.id, req.id));

    if (!row || row.orgId !== auth.orgId) {
      throw APIError.notFound("halt record not found");
    }
    if (row.state !== "halted") {
      throw APIError.failedPrecondition(
        `halt ${req.id} is '${row.state}', not 'halted'`,
      );
    }

    // Compare-and-swap: only the writer that observes 'halted' transitions it.
    const updated = await tx
      .update(orgHalts)
      .set({
        state: "reintegrating",
        liftedBy: auth.userId,
        liftedAt: new Date(),
      })
      .where(and(eq(orgHalts.id, req.id), eq(orgHalts.state, "halted")))
      .returning({ id: orgHalts.id });
    if (updated.length === 0) {
      // Lost the race: another lift transitioned it between the read and here.
      throw APIError.failedPrecondition(
        `halt ${req.id} is no longer 'halted'`,
      );
    }

    await tx.insert(auditLog).values({
      actorUserId: auth.userId,
      action: FACTORY_ORG_HALT_LIFTED,
      targetType: "org_halts",
      targetId: req.id,
      metadata: { orgId: auth.orgId, scope: row.scope, scopeKey: row.scopeKey },
    });

    return { scope: row.scope, scopeKey: row.scopeKey };
  });

  // Spec 208 FR-004: broadcast the lift AFTER the transition commits so engines
  // can begin re-admission and ack the lift leg (FR-003). A 'reintegrating'
  // scope is still enforced until staged re-admission completes (Phase 3), so
  // this notice starts that process; it does not re-admit by itself.
  // Same best-effort posture as the activation broadcast: the 'reintegrating'
  // transition is committed and still enforced, so a failed lift broadcast must
  // not throw past a state change the caller already succeeded in making.
  try {
    await broadcastOrgHalt(auth.orgId, {
      change: "lifted",
      haltId: req.id,
      scope,
      scopeKey,
    });
  } catch (err) {
    log.error("org-halt: lift broadcast failed (transition already committed)", {
      orgId: auth.orgId,
      haltId: req.id,
      err: err instanceof Error ? err.message : String(err),
    });
  }

  return { haltId: req.id, state: "reintegrating" };
}

export const liftHalt = api(
  {
    method: "POST",
    path: "/api/factory/org-halts/:id/lift",
    expose: true,
    auth: true,
  },
  async ({ id }: { id: string }): Promise<LiftHaltResponse> => {
    const auth = await requireFactoryConfigure();
    return liftHaltCore(auth, { id });
  },
);
