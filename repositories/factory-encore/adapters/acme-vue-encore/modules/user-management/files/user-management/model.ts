/**
 * User-management data-access layer (spec 003).
 *
 * Tagged-template queries only (INV-2): interpolated ${…} values are
 * auto-parameterized, never string-concatenated. Queries run against the
 * single shared SQLDatabase("app") (the `encore-app-architecture` base), importing `db` from ../db/db.
 */

import { db } from "../db/db";
import type { AppRole } from "./types";

// --- Row shapes (snake_case DB columns) ---------------------------------

interface AppRoleRow {
  pk_app_role: string;
  role_name: string;
  description: string | null;
  is_system: boolean;
  created_at: string;
}

/** A user_account row plus the aggregated app_role names assigned to it. */
export interface UserWithRoles {
  pk_user_account: string;
  user_email_address: string;
  user_display_name: string;
  user_roles: string[];
  is_active: boolean;
  last_login_at: string | null;
  created_at: string;
  app_role_names: string[];
}

function toAppRole(r: AppRoleRow): AppRole {
  return {
    id: r.pk_app_role,
    name: r.role_name,
    description: r.description,
    isSystem: r.is_system,
    createdAt: r.created_at,
  };
}

// --- Users --------------------------------------------------------------

/**
 * List users with their app-managed role names, paginated. `search` (when
 * present) filters on display name / email. Each branch is a fixed-shape
 * parameterized statement (no dynamic SQL fragment interpolation).
 */
export async function listUsers(
  limit: number,
  offset: number,
  search?: string,
): Promise<{ rows: UserWithRoles[]; total: number }> {
  let rows: UserWithRoles[];
  let total: number;

  if (search && search.trim() !== "") {
    const like = `%${search.trim()}%`;
    rows = await db.queryAll<UserWithRoles>`
      SELECT u.id AS pk_user_account, u.email AS user_email_address, u.name AS user_display_name,
             u.user_roles, u.is_active, u.last_login_at, u.created_at,
             COALESCE(ARRAY_AGG(ar.role_name) FILTER (WHERE ar.role_name IS NOT NULL), '{}') AS app_role_names
        FROM user_account u
        LEFT JOIN user_role ur ON ur.fk_user_account = u.id
        LEFT JOIN app_role ar ON ar.pk_app_role = ur.fk_app_role
       WHERE u.name ILIKE ${like} OR u.email ILIKE ${like}
       GROUP BY u.id
       ORDER BY u.name ASC
       LIMIT ${limit} OFFSET ${offset}
    `;
    const countRow = await db.queryRow<{ count: number }>`
      SELECT COUNT(*)::int AS count FROM user_account u
       WHERE u.name ILIKE ${like} OR u.email ILIKE ${like}
    `;
    total = countRow?.count ?? 0;
  } else {
    rows = await db.queryAll<UserWithRoles>`
      SELECT u.id AS pk_user_account, u.email AS user_email_address, u.name AS user_display_name,
             u.user_roles, u.is_active, u.last_login_at, u.created_at,
             COALESCE(ARRAY_AGG(ar.role_name) FILTER (WHERE ar.role_name IS NOT NULL), '{}') AS app_role_names
        FROM user_account u
        LEFT JOIN user_role ur ON ur.fk_user_account = u.id
        LEFT JOIN app_role ar ON ar.pk_app_role = ur.fk_app_role
       GROUP BY u.id
       ORDER BY u.name ASC
       LIMIT ${limit} OFFSET ${offset}
    `;
    const countRow = await db.queryRow<{ count: number }>`
      SELECT COUNT(*)::int AS count FROM user_account
    `;
    total = countRow?.count ?? 0;
  }

  return { rows, total };
}

/** Fetch one user (by user_account pk) with aggregated app role names. */
export async function getUserById(id: string): Promise<UserWithRoles | null> {
  const row = await db.queryRow<UserWithRoles>`
    SELECT u.id AS pk_user_account, u.email AS user_email_address, u.name AS user_display_name,
           u.user_roles, u.is_active, u.last_login_at, u.created_at,
           COALESCE(ARRAY_AGG(ar.role_name) FILTER (WHERE ar.role_name IS NOT NULL), '{}') AS app_role_names
      FROM user_account u
      LEFT JOIN user_role ur ON ur.fk_user_account = u.id
      LEFT JOIN app_role ar ON ar.pk_app_role = ur.fk_app_role
     WHERE u.id = ${id}
     GROUP BY u.id
  `;
  return row ?? null;
}

/** Set a user's active flag; returns the refreshed row (or null if absent). */
export async function setUserActive(
  id: string,
  isActive: boolean,
): Promise<UserWithRoles | null> {
  await db.exec`
    UPDATE user_account SET is_active = ${isActive}, updated_at = now()
     WHERE id = ${id}
  `;
  return getUserById(id);
}

// --- Role assignments ---------------------------------------------------

/** The app-managed roles currently assigned to a user. */
export async function getAppRolesForUser(userId: string): Promise<AppRole[]> {
  const rows = await db.queryAll<AppRoleRow>`
    SELECT ar.* FROM app_role ar
     INNER JOIN user_role ur ON ur.fk_app_role = ar.pk_app_role
     WHERE ur.fk_user_account = ${userId}
     ORDER BY ar.role_name ASC
  `;
  return rows.map(toAppRole);
}

/**
 * Returns the subset of `roleIds` that do NOT exist in app_role. The caller
 * rejects the request when this is non-empty, so assignAppRoles never inserts
 * a dangling id (which would otherwise raise a raw FK violation).
 */
export async function findUnknownRoleIds(roleIds: string[]): Promise<string[]> {
  if (roleIds.length === 0) return [];
  const rows = await db.queryAll<{ pk_app_role: string }>`
    SELECT pk_app_role FROM app_role WHERE pk_app_role = ANY(${roleIds}::text[])
  `;
  const known = new Set(rows.map((r) => r.pk_app_role));
  return roleIds.filter((id) => !known.has(id));
}

/**
 * Replace a user's app-role assignments with `roleIds` (transactional:
 * delete-all + single set-based re-insert, committed atomically). Two
 * round-trips regardless of how many roles are assigned. Caller validates
 * the ids first (findUnknownRoleIds).
 */
export async function assignAppRoles(
  userId: string,
  roleIds: string[],
  assignedBy: string | null,
): Promise<void> {
  const tx = await db.begin();
  try {
    await tx.exec`DELETE FROM user_role WHERE fk_user_account = ${userId}`;
    if (roleIds.length > 0) {
      await tx.exec`
        INSERT INTO user_role (fk_user_account, fk_app_role, assigned_by)
        SELECT ${userId}, r, ${assignedBy} FROM unnest(${roleIds}::text[]) AS r
        ON CONFLICT DO NOTHING
      `;
    }
    await tx.commit();
  } catch (err) {
    await tx.rollback();
    throw err;
  }
}

// --- Role catalog -------------------------------------------------------

export async function listRoles(): Promise<AppRole[]> {
  const rows = await db.queryAll<AppRoleRow>`
    SELECT * FROM app_role ORDER BY role_name ASC
  `;
  return rows.map(toAppRole);
}

export async function getRoleById(id: string): Promise<AppRole | null> {
  const row = await db.queryRow<AppRoleRow>`
    SELECT * FROM app_role WHERE pk_app_role = ${id}
  `;
  return row ? toAppRole(row) : null;
}

export async function getRoleByName(name: string): Promise<AppRole | null> {
  const row = await db.queryRow<AppRoleRow>`
    SELECT * FROM app_role WHERE lower(role_name) = lower(${name})
  `;
  return row ? toAppRole(row) : null;
}

export async function createRole(
  name: string,
  description: string | null,
): Promise<AppRole> {
  const row = await db.queryRow<AppRoleRow>`
    INSERT INTO app_role (role_name, description) VALUES (${name}, ${description})
    RETURNING *
  `;
  if (!row) throw new Error("createRole: INSERT … RETURNING produced no row");
  return toAppRole(row);
}

/**
 * True when an error is a Postgres unique-constraint violation (SQLSTATE
 * 23505). Used to map the createRole insert race (two concurrent creates of
 * the same name pass the pre-check) onto a clean APIError.alreadyExists rather
 * than leaking a 500. Matches the SQLSTATE or the constraint-violation message
 * since the exact error surface depends on the driver layer.
 */
export function isUniqueViolation(err: unknown): boolean {
  const e = err as { code?: string; message?: string } | null;
  if (!e) return false;
  return e.code === "23505" || /duplicate key|unique constraint/i.test(e.message ?? "");
}

/**
 * Update a role's name/description. Undefined fields are left unchanged
 * (the existing value is re-written). Returns null when the role is absent.
 */
export async function updateRole(
  id: string,
  data: { name?: string; description?: string },
): Promise<AppRole | null> {
  const existing = await getRoleById(id);
  if (!existing) return null;

  const nextName = data.name ?? existing.name;
  const nextDescription =
    data.description !== undefined ? data.description : existing.description;

  const row = await db.queryRow<AppRoleRow>`
    UPDATE app_role SET role_name = ${nextName}, description = ${nextDescription}
     WHERE pk_app_role = ${id}
     RETURNING *
  `;
  return row ? toAppRole(row) : null;
}

/** Delete a (non-system) role. Caller guards is_system before calling. */
export async function deleteRole(id: string): Promise<void> {
  await db.exec`DELETE FROM app_role WHERE pk_app_role = ${id} AND is_system = FALSE`;
}
