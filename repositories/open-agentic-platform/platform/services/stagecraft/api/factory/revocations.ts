/**
 * Spec 198 FR-010 — revocation operations on the admission graph.
 *
 * One mechanism, four keys (factory / adapter / agent / content-hash), two
 * modes (`revoked` / `quarantined`). Rows here are consulted fail-closed by
 * the serve path (`browse.ts` via `admission.isFactoryAdmitted`), the bind
 * path (`projects/create.ts`), and — when the run-grant service lands
 * (FR-005/FR-014 phase 4) — grant issuance/renewal.
 *
 * Lifting a quarantine is NOT an un-revoke: reintegration requires fresh
 * two-sided validation (a re-sync re-evaluates admission) plus this
 * explicit human approval (ASI10 m7). Content-hash lifting is
 * mode-sensitive (spec 200 FR-004): `revoked` rows are never lifted —
 * fixed upstream bytes carry a new hash and re-enter via normal
 * admission — while `quarantined` rows (the scanner's only mode) are
 * liftable by a human with factory:configure after a deterministic gate
 * re-run, with the affected rows reset to unverified.
 */

import { api, APIError } from "encore.dev/api";
import log from "encore.dev/log";
import { getAuthData } from "~encore/auth";
import { and, desc, eq, inArray, isNotNull, isNull, or, sql } from "drizzle-orm";
import { db } from "../db/drizzle";
import {
  auditLog,
  factoryArtifactSubstrate,
  factoryRevocations,
} from "../db/schema";
import { getUserOrgRole, hasOrgPermission } from "../auth/membership";
import { assertOverrideGate } from "./artifacts";

type ScopeKind = "factory" | "adapter" | "agent" | "content-hash";
type Mode = "revoked" | "quarantined";

// Exported so the spec 208 org-halt verb (api/factory/orgHalt.ts) reuses the
// exact factory:configure + human-actor gate rather than duplicating it: a
// service identity has no org-membership row, so `getUserOrgRole` returns
// null and the gate rejects it (the spec 200 AC-4 / 208 AC-4 pattern).
export async function requireFactoryConfigure(): Promise<{
  orgId: string;
  userId: string;
}> {
  const auth = getAuthData()!;
  const role = await getUserOrgRole(auth.userID, auth.orgId);
  if (!role || !hasOrgPermission(role, "factory:configure")) {
    throw APIError.permissionDenied(
      "factory:configure permission required",
    );
  }
  return { orgId: auth.orgId, userId: auth.userID };
}

export type RevocationRow = {
  id: string;
  scopeKind: ScopeKind;
  key: string;
  mode: Mode;
  reason: string;
  createdAt: string;
  liftedAt: string | null;
};

export const listRevocations = api(
  { expose: true, auth: true, method: "GET", path: "/api/factory/revocations" },
  async (): Promise<{ revocations: RevocationRow[] }> => {
    const { orgId } = await requireFactoryConfigure();
    const rows = await db
      .select()
      .from(factoryRevocations)
      .where(
        or(
          eq(factoryRevocations.orgId, sql`${orgId}::uuid`),
          isNull(factoryRevocations.orgId),
        ),
      )
      .orderBy(desc(factoryRevocations.createdAt))
      .limit(200);
    return {
      revocations: rows.map((r) => ({
        id: r.id,
        scopeKind: r.scopeKind,
        key: r.key,
        mode: r.mode,
        reason: r.reason,
        createdAt: r.createdAt.toISOString(),
        liftedAt: r.liftedAt ? r.liftedAt.toISOString() : null,
      })),
    };
  },
);

export const createRevocation = api(
  {
    expose: true,
    auth: true,
    method: "POST",
    path: "/api/factory/revocations",
  },
  async (req: {
    scope_kind: ScopeKind;
    key: string;
    mode: Mode;
    reason: string;
  }): Promise<{ id: string }> => {
    const { orgId, userId } = await requireFactoryConfigure();
    if (!req.key.trim()) {
      throw APIError.invalidArgument("revocation key is empty");
    }
    if (!req.reason.trim()) {
      throw APIError.invalidArgument(
        "a revocation requires a reason (it is audit evidence, not a toggle)",
      );
    }
    const [row] = await db
      .insert(factoryRevocations)
      .values({
        orgId,
        scopeKind: req.scope_kind,
        key: req.key,
        mode: req.mode,
        reason: req.reason,
        actor: userId,
      })
      .returning({ id: factoryRevocations.id });
    await db.insert(auditLog).values({
      actorUserId: userId,
      action: "factory.revocation.created",
      targetType: "factory_revocations",
      targetId: row.id,
      metadata: {
        orgId,
        scopeKind: req.scope_kind,
        key: req.key,
        mode: req.mode,
        reason: req.reason,
      },
    });
    log.warn("factory revocation created — takes effect at serve/bind/grant", {
      orgId,
      scopeKind: req.scope_kind,
      key: req.key,
      mode: req.mode,
    });
    return { id: row.id };
  },
);

/**
 * Core lift logic (auth-explicit; tests call this directly). The HTTP
 * endpoint below is the ONLY route in, and it requires an authenticated
 * human with `factory:configure` — the scanner's service identity
 * (`actor=NULL` provenance) has no session and no code path here
 * (spec 200 FR-004 / AC-4).
 */
export async function liftRevocationCore(
  auth: { orgId: string; userId: string },
  req: { id: string },
): Promise<{ lifted: boolean }> {
  const { orgId, userId } = auth;
  const [row] = await db
      .select()
      .from(factoryRevocations)
      .where(eq(factoryRevocations.id, req.id))
      .limit(1);
    if (!row || (row.orgId !== null && row.orgId !== orgId)) {
      throw APIError.notFound("revocation not found");
    }
    if (row.orgId === null) {
      throw APIError.permissionDenied(
        "global advisories cannot be lifted org-side",
      );
    }
    // Spec 200 FR-004 — content-hash lifting is mode-sensitive. `revoked`
    // stays never-liftable: fixed upstream bytes carry a new hash and
    // re-enter via normal admission. `quarantined` (the scanner's only
    // mode, and manual quarantines alike) is liftable by an authenticated
    // human with factory:configure — a false positive on an override would
    // otherwise permanently brick that content for the org, because
    // re-submitting the same desired bytes reproduces the same hash.
    if (row.scopeKind === "content-hash" && row.mode === "revoked") {
      throw APIError.failedPrecondition(
        "content-hash revocations in 'revoked' mode are never lifted — fixed upstream bytes carry a new hash and re-enter via normal admission (spec 198 FR-010)",
      );
    }
    if (row.liftedAt) return { lifted: true };

    let gateRerunArtifacts: string[] = [];
    if (row.scopeKind === "content-hash") {
      // Fresh-validation leg (spec 198 FR-010's two-sided reintegration):
      // re-run the deterministic gate over the CURRENT user_body of every
      // active artifact carrying the quarantined hash. A gate refusal
      // audits `artifact.override_gate_rejected` and aborts the lift. The
      // rows remain/return unverified, so consumption under
      // `overrides.require_verified` still demands the human verify step.
      const artifacts = await db
        .select({
          id: factoryArtifactSubstrate.id,
          kind: factoryArtifactSubstrate.kind,
          path: factoryArtifactSubstrate.path,
          userBody: factoryArtifactSubstrate.userBody,
        })
        .from(factoryArtifactSubstrate)
        .where(
          and(
            eq(factoryArtifactSubstrate.orgId, orgId),
            eq(factoryArtifactSubstrate.contentHash, row.key),
            eq(factoryArtifactSubstrate.status, "active"),
            isNotNull(factoryArtifactSubstrate.userBody),
          ),
        );
      for (const artifact of artifacts) {
        await assertOverrideGate(
          {
            orgId,
            userId,
            artifactId: artifact.id,
            kind: artifact.kind,
            path: artifact.path,
          },
          artifact.userBody as string,
        );
      }
      if (artifacts.length > 0) {
        await db
          .update(factoryArtifactSubstrate)
          .set({
            userBodyVerified: false,
            verifiedBy: null,
            verifiedAt: null,
            updatedAt: new Date(),
          })
          .where(
            inArray(
              factoryArtifactSubstrate.id,
              artifacts.map((a) => a.id),
            ),
          );
      }
      gateRerunArtifacts = artifacts.map((a) => a.id);
    }

    await db
      .update(factoryRevocations)
      .set({ liftedAt: new Date(), liftedBy: userId })
      .where(eq(factoryRevocations.id, req.id));
    await db.insert(auditLog).values({
      actorUserId: userId,
      action: "factory.revocation.lifted",
      targetType: "factory_revocations",
      targetId: req.id,
      metadata: {
        orgId,
        scopeKind: row.scopeKind,
        key: row.key,
        ...(row.scopeKind === "content-hash"
          ? {
              mode: row.mode,
              gateRerunArtifacts,
              note: "quarantine lift: deterministic gate re-run passed; rows reset to unverified (spec 200 FR-004)",
            }
          : {
              note: "reintegration requires a fresh sync (re-evaluated admission) — lifting alone does not re-admit",
            }),
      },
    });
    return { lifted: true };
}

export const liftRevocation = api(
  {
    expose: true,
    auth: true,
    method: "POST",
    path: "/api/factory/revocations/:id/lift",
  },
  async (req: { id: string }): Promise<{ lifted: boolean }> => {
    const auth = await requireFactoryConfigure();
    return liftRevocationCore(auth, req);
  },
);
