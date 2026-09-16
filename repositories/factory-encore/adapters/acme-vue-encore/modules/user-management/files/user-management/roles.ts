import { api, APIError } from "encore.dev/api";
import { getAuthData } from "~encore/auth";
import { requireRole } from "../lib/roles";
import { writeAudit } from "../lib/audit";
import * as model from "./model";
import type { AppRole } from "./types";

/**
 * Admin role-catalog CRUD (spec 003). app_role rows seeded as is_system cannot
 * be deleted. Every endpoint is auth:true + requireRole("admin","user-manager").
 */

interface RoleListResponse {
  roles: AppRole[];
}

export const listRoles = api(
  { expose: true, auth: true, method: "GET", path: "/api/v1/admin/roles" },
  async (): Promise<RoleListResponse> => {
    requireRole(getAuthData()!.roles, "admin", "user-manager");
    return { roles: await model.listRoles() };
  },
);

interface CreateRoleParams {
  name: string;
  description?: string;
}

interface RoleResponse {
  role: AppRole;
}

export const createRole = api(
  { expose: true, auth: true, method: "POST", path: "/api/v1/admin/roles" },
  async ({ name, description }: CreateRoleParams): Promise<RoleResponse> => {
    const auth = getAuthData()!;
    requireRole(auth.roles, "admin", "user-manager");
    const normalized = name.trim().toLowerCase();
    if (normalized === "") throw APIError.invalidArgument("Role name is required");
    // Pre-check for the common case; the try/catch closes the check-then-insert
    // race (two concurrent creates both pass the pre-check) so a unique-violation
    // becomes a clean alreadyExists rather than an unhandled 500.
    if (await model.getRoleByName(normalized)) {
      throw APIError.alreadyExists("A role with this name already exists");
    }
    let role: AppRole;
    try {
      role = await model.createRole(normalized, description?.trim() ?? null);
    } catch (err) {
      if (model.isUniqueViolation(err)) {
        throw APIError.alreadyExists("A role with this name already exists");
      }
      throw err;
    }
    await writeAudit({
      action: "INSERT",
      tableName: "app_role",
      recordId: role.id,
      actorId: auth.userID,
      newData: { name: role.name, description: role.description },
    });
    return { role };
  },
);

interface UpdateRoleParams {
  id: string;
  name?: string;
  description?: string;
}

export const updateRole = api(
  { expose: true, auth: true, method: "PATCH", path: "/api/v1/admin/roles/:id" },
  async ({ id, name, description }: UpdateRoleParams): Promise<RoleResponse> => {
    const auth = getAuthData()!;
    requireRole(auth.roles, "admin", "user-manager");
    // Capture the pre-mutation row so the audit record shows what changed.
    const before = await model.getRoleById(id);
    if (!before) throw APIError.notFound("Role not found");
    const role = await model.updateRole(id, {
      name: name?.trim().toLowerCase(),
      description: description?.trim(),
    });
    if (!role) throw APIError.notFound("Role not found");
    await writeAudit({
      action: "UPDATE",
      tableName: "app_role",
      recordId: id,
      actorId: auth.userID,
      oldData: { name: before.name, description: before.description },
      newData: { name: role.name, description: role.description },
    });
    return { role };
  },
);

interface RoleIdParams {
  id: string;
}

interface DeleteRoleResponse {
  deleted: boolean;
}

export const deleteRole = api(
  { expose: true, auth: true, method: "DELETE", path: "/api/v1/admin/roles/:id" },
  async ({ id }: RoleIdParams): Promise<DeleteRoleResponse> => {
    const auth = getAuthData()!;
    requireRole(auth.roles, "admin", "user-manager");
    const role = await model.getRoleById(id);
    if (!role) throw APIError.notFound("Role not found");
    if (role.isSystem) throw APIError.failedPrecondition("System roles cannot be deleted");
    await model.deleteRole(id);
    await writeAudit({
      action: "DELETE",
      tableName: "app_role",
      recordId: id,
      actorId: auth.userID,
      oldData: { name: role.name, description: role.description },
    });
    return { deleted: true };
  },
);
