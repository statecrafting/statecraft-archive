/**
 * Tenant membership data access on CoreLedger (spec 011 §5.2).
 *
 * Schema is ensured eagerly at load, alongside the tenants tables. CoreLedger
 * has no native upsert, so writes use the chassis find-then-write-in-a-
 * transaction idiom. The membership "primary key" is logical, not a DB
 * constraint: one active row per tenant per identity, where an identity is a
 * `githubUserId` when known and a `userAccountId` otherwise. `upsertMembership`
 * dedups on either side so the two install paths and the login sweep converge
 * on one row.
 */
import { ledger } from "../../core/ledger";

import {
  type MembershipRole,
  type MembershipSource,
  TenantMembership,
} from "./entities";

export const dbReady: Promise<void> = ledger().init([TenantMembership]);
dbReady.catch(() => {});

export function memberships() {
  return ledger().repo(TenantMembership);
}

export async function listMembershipsForTenant(tenantId: string): Promise<TenantMembership[]> {
  await dbReady;
  return memberships().findWhere({ tenantId }, { orderBy: "createdAt", direction: "asc" });
}

/** Memberships an app user holds (post-attach); used by the accessible-tenants list. */
export async function listMembershipsForUserAccount(
  userAccountId: string,
): Promise<TenantMembership[]> {
  await dbReady;
  return memberships().findWhere({ userAccountId } as Partial<TenantMembership>);
}

/** The caller's membership on a tenant, resolved by app-user id (the authz path). */
export async function membershipForUserAccount(
  tenantId: string,
  userAccountId: string,
): Promise<TenantMembership | null> {
  await dbReady;
  return memberships().findOne({ tenantId, userAccountId } as Partial<TenantMembership>);
}

/** A tenant's row for a GitHub identity (the reconciliation path). */
export async function findMembership(
  tenantId: string,
  githubUserId: string,
): Promise<TenantMembership | null> {
  await dbReady;
  return memberships().findOne({ tenantId, githubUserId } as Partial<TenantMembership>);
}

export interface UpsertMembershipInput {
  tenantId: string;
  githubUserId?: string | null;
  userAccountId?: string | null;
  role: MembershipRole;
  source: MembershipSource;
}

async function findExisting(
  rows: ReturnType<typeof memberships>,
  tenantId: string,
  githubUserId: string | null,
  userAccountId: string | null,
): Promise<TenantMembership | null> {
  if (githubUserId != null) {
    const byGh = await rows.findOne({ tenantId, githubUserId } as Partial<TenantMembership>);
    if (byGh) return byGh;
  }
  if (userAccountId != null) {
    const byUa = await rows.findOne({ tenantId, userAccountId } as Partial<TenantMembership>);
    if (byUa) return byUa;
  }
  return null;
}

/**
 * Grant or refresh a membership, deduping on either identity side. Reconcile
 * writes stamp `lastReconciledAt`; either side, once known, is filled in and
 * never blanked.
 */
export async function upsertMembership(input: UpsertMembershipInput): Promise<TenantMembership> {
  await dbReady;
  const now = new Date();
  const githubUserId = input.githubUserId ?? null;
  const userAccountId = input.userAccountId ?? null;
  return ledger().transaction(async ({ repo }) => {
    const rows = repo(TenantMembership);
    const existing = await findExisting(rows, input.tenantId, githubUserId, userAccountId);
    if (existing) {
      const patch: Partial<TenantMembership> = {
        role: input.role,
        source: input.source,
        updatedAt: now,
      };
      if (githubUserId != null && existing.githubUserId == null) patch.githubUserId = githubUserId;
      if (userAccountId != null && existing.userAccountId == null) patch.userAccountId = userAccountId;
      if (input.source === "reconcile") patch.lastReconciledAt = now;
      await rows.updateById(existing.id, patch);
      return (await rows.findById(existing.id))!;
    }
    const row = Object.assign(new TenantMembership(), {
      tenantId: input.tenantId,
      githubUserId,
      userAccountId,
      role: input.role,
      source: input.source,
      createdAt: now,
      updatedAt: now,
      lastReconciledAt: input.source === "reconcile" ? now : null,
    });
    await rows.insert(row);
    return row;
  });
}

/** Attach an app user to any pending rows carrying its GitHub id (reconcile step 1). */
export async function attachUserAccount(
  githubUserId: string,
  userAccountId: string,
): Promise<void> {
  await dbReady;
  const now = new Date();
  await ledger().transaction(async ({ repo }) => {
    const rows = repo(TenantMembership);
    const pending = await rows.findWhere({
      githubUserId,
      userAccountId: null,
    } as Partial<TenantMembership>);
    for (const row of pending) {
      await rows.updateById(row.id, { userAccountId, updatedAt: now });
    }
  });
}

/** Attach a GitHub id to any of a user's rows that still lack one (reconcile step 1, reverse). */
export async function attachGithubUserId(
  userAccountId: string,
  githubUserId: string,
): Promise<void> {
  await dbReady;
  const now = new Date();
  await ledger().transaction(async ({ repo }) => {
    const rows = repo(TenantMembership);
    const pending = await rows.findWhere({
      userAccountId,
      githubUserId: null,
    } as Partial<TenantMembership>);
    for (const row of pending) {
      await rows.updateById(row.id, { githubUserId, updatedAt: now });
    }
  });
}

/** Remove a tenant's row for a GitHub identity (org departure, operator revoke). */
export async function removeMembership(tenantId: string, githubUserId: string): Promise<boolean> {
  await dbReady;
  const existing = await findMembership(tenantId, githubUserId);
  if (!existing) return false;
  return memberships().deleteById(existing.id);
}
