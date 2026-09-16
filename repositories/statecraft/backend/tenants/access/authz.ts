/**
 * The tenant authorization helper (spec 011 §3): the one place that decides
 * whether a caller may act on a tenant. Ad-hoc `ownerUserId` equality checks
 * are retired in favour of this three-tier rule:
 *
 *   (a) a platform operator (`statecraft_operator`) may do anything, anywhere;
 *   (b) a member with sufficient role (admin to mutate, member to read);
 *   (c) the legacy `ownerUserId` (the creator), so pre-011 tenants and
 *       non-GitHub accounts keep working.
 *
 * Returns the tenant on success and `null` on any failure, so callers surface
 * a uniform 404 that never leaks a tenant's existence.
 */
import { hasRole } from "../../lib/roles";
import type { Tenant } from "../entities";
import { getTenant, listTenantsForOwner } from "../store";

import type { MembershipRole } from "./entities";
import { listMembershipsForUserAccount, membershipForUserAccount } from "./store";

/** The global platform-operator role (spec 011 §3, seeded per spec 009). */
export const OPERATOR_ROLE = "statecraft_operator";

export type TenantAccess = "read" | "write";

/** The subset of AuthData the authz rule reads; constructed by every endpoint. */
export interface Principal {
  userID: string;
  roles: string[];
}

export function principalFrom(auth: { userID: string; roles: string[] }): Principal {
  return { userID: auth.userID, roles: auth.roles };
}

export function isOperator(principal: Principal): boolean {
  return hasRole(principal.roles, OPERATOR_ROLE);
}

/** Pure: does a tenant-scoped role satisfy the requested access level? */
export function roleSatisfies(level: TenantAccess, role: MembershipRole): boolean {
  return level === "read" ? true : role === "admin";
}

/**
 * Resolve the tenant the caller may act on at `level`, or null. Operators and
 * the legacy owner get full access; a member is admitted only when its role
 * satisfies the level.
 */
export async function authorizeTenant(
  tenantId: string,
  principal: Principal,
  level: TenantAccess,
): Promise<Tenant | null> {
  const tenant = await getTenant(tenantId);
  if (!tenant) return null;
  if (isOperator(principal)) return tenant;
  if (tenant.ownerUserId && tenant.ownerUserId === principal.userID) return tenant;
  const membership = await membershipForUserAccount(tenantId, principal.userID);
  if (membership && roleSatisfies(level, membership.role)) return tenant;
  return null;
}

/**
 * Tenants the caller can see in their own list: those they own plus those they
 * hold any membership on (spec 011 §5.6, the second-org-admin case). Operators
 * use the dedicated all-tenants view instead (spec 011 §5.8).
 */
export async function listAccessibleTenants(principal: Principal): Promise<Tenant[]> {
  const owned = await listTenantsForOwner(principal.userID);
  const seen = new Set<string>(owned.map((t) => t.id));
  const result = [...owned];
  for (const membership of await listMembershipsForUserAccount(principal.userID)) {
    if (seen.has(membership.tenantId)) continue;
    const tenant = await getTenant(membership.tenantId);
    if (tenant) {
      seen.add(tenant.id);
      result.push(tenant);
    }
  }
  return result;
}
