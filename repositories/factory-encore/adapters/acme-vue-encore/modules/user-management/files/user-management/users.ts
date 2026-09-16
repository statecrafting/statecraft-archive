import { api, APIError, Query } from "encore.dev/api";
import { getAuthData } from "~encore/auth";
import { requireRole } from "../lib/roles";
import { writeAudit } from "../lib/audit";
import * as model from "./model";
import type { AppRole, UserSummary } from "./types";

/**
 * Admin user surface (spec 003): list/get/update users + role assignment.
 * Every endpoint is auth:true and any-of requireRole("admin","user-manager")
 * (INV-1). Errors are APIError (the { code, message, details } shape).
 */

function toSummary(u: model.UserWithRoles): UserSummary {
  return {
    id: u.pk_user_account,
    email: u.user_email_address,
    name: u.user_display_name,
    isActive: u.is_active,
    lastLoginAt: u.last_login_at,
    createdAt: u.created_at,
    appRoles: u.app_role_names ?? [],
    idpRoles: u.user_roles ?? [],
  };
}

interface ListUsersParams {
  page?: Query<number>;
  limit?: Query<number>;
  search?: Query<string>;
}

interface ListUsersResponse {
  users: UserSummary[];
  total: number;
  page: number;
  limit: number;
}

export const listUsers = api(
  { expose: true, auth: true, method: "GET", path: "/api/v1/admin/users" },
  async ({ page, limit, search }: ListUsersParams): Promise<ListUsersResponse> => {
    requireRole(getAuthData()!.roles, "admin", "user-manager");
    const p = page && page > 0 ? page : 1;
    const l = limit && limit > 0 ? Math.min(limit, 100) : 20;
    const { rows, total } = await model.listUsers(l, (p - 1) * l, search);
    return { users: rows.map(toSummary), total, page: p, limit: l };
  },
);

interface UserIdParams {
  id: string;
}

interface UserResponse {
  user: UserSummary;
}

export const getUser = api(
  { expose: true, auth: true, method: "GET", path: "/api/v1/admin/users/:id" },
  async ({ id }: UserIdParams): Promise<UserResponse> => {
    requireRole(getAuthData()!.roles, "admin", "user-manager");
    const u = await model.getUserById(id);
    if (!u) throw APIError.notFound("User not found");
    return { user: toSummary(u) };
  },
);

interface UpdateUserParams {
  id: string;
  isActive: boolean;
}

export const updateUser = api(
  { expose: true, auth: true, method: "PATCH", path: "/api/v1/admin/users/:id" },
  async ({ id, isActive }: UpdateUserParams): Promise<UserResponse> => {
    const auth = getAuthData()!;
    requireRole(auth.roles, "admin", "user-manager");
    // Capture the pre-mutation state so the audit record reconstructs the
    // change (OWASP A09), not just the new value.
    const before = await model.getUserById(id);
    if (!before) throw APIError.notFound("User not found");
    const u = await model.setUserActive(id, isActive);
    if (!u) throw APIError.notFound("User not found");
    // INV-8: durable audit trail for privileged mutations (best-effort).
    await writeAudit({
      action: "UPDATE",
      tableName: "user_account",
      recordId: id,
      actorId: auth.userID,
      oldData: { isActive: before.is_active },
      newData: { isActive },
    });
    return { user: toSummary(u) };
  },
);

interface RolesResponse {
  roles: AppRole[];
}

export const getUserRoles = api(
  { expose: true, auth: true, method: "GET", path: "/api/v1/admin/users/:id/roles" },
  async ({ id }: UserIdParams): Promise<RolesResponse> => {
    requireRole(getAuthData()!.roles, "admin", "user-manager");
    return { roles: await model.getAppRolesForUser(id) };
  },
);

interface AssignRolesParams {
  id: string;
  roleIds: string[];
}

export const assignUserRoles = api(
  { expose: true, auth: true, method: "PUT", path: "/api/v1/admin/users/:id/roles" },
  async ({ id, roleIds }: AssignRolesParams): Promise<RolesResponse> => {
    const auth = getAuthData()!;
    requireRole(auth.roles, "admin", "user-manager");
    const user = await model.getUserById(id);
    if (!user) throw APIError.notFound("User not found");
    // Reject unknown role ids up front (avoids a raw FK violation → 500).
    const unknown = await model.findUnknownRoleIds(roleIds);
    if (unknown.length > 0) {
      throw APIError.invalidArgument(`Unknown role id(s): ${unknown.join(", ")}`);
    }
    // Capture the prior assignment so the audit record shows what changed.
    const before = await model.getAppRolesForUser(id);
    await model.assignAppRoles(id, roleIds, auth.userID);
    // INV-8: durable audit trail for privileged mutations (best-effort).
    await writeAudit({
      action: "UPDATE",
      tableName: "user_role",
      recordId: id,
      actorId: auth.userID,
      oldData: { roleIds: before.map((r) => r.id) },
      newData: { roleIds },
    });
    return { roles: await model.getAppRolesForUser(id) };
  },
);
