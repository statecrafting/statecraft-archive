import { api, APIError } from "encore.dev/api";
import { getAuthData } from "~encore/auth";
import log from "encore.dev/log";
import { db } from "../db/drizzle";
import {
  auditLog,
  desktopRefreshTokens,
  githubTeamRoleMappings,
  oidcGroupRoleMappings,
  oidcProviders,
  orgMemberships,
  users,
} from "../db/schema";
import { desc, eq, and, inArray, lt, gte, lte, sql, count as drizzleCount } from "drizzle-orm";
import { revokeSession } from "../auth/rauthy";
import { evictDisabledCache } from "../auth/handler";

/** Require admin or owner platform role. Throws 403 if not. */
function requireAdmin(): { userID: string; orgId: string } {
  const auth = getAuthData()!;
  if (auth.platformRole !== "admin" && auth.platformRole !== "owner") {
    throw APIError.permissionDenied("Admin access required");
  }
  return auth;
}

/** Require admin for a specific org. Prevents cross-org access. */
function requireOrgAdmin(reqOrgId: string): { userID: string; orgId: string } {
  const auth = requireAdmin();
  if (auth.orgId !== reqOrgId) {
    throw APIError.permissionDenied("Cannot manage another organization's resources");
  }
  return auth;
}

/** Verify a target user belongs to the caller's org. Prevents cross-org IDOR. */
async function requireUserInOrg(targetUserId: string, orgId: string): Promise<void> {
  const [membership] = await db
    .select({ id: orgMemberships.id })
    .from(orgMemberships)
    .where(
      and(
        eq(orgMemberships.userId, targetUserId),
        eq(orgMemberships.orgId, orgId),
        eq(orgMemberships.status, "active")
      )
    )
    .limit(1);

  if (!membership) {
    throw APIError.permissionDenied("User is not a member of your organization");
  }
}

export type UserRow = {
  id: string;
  email: string;
  name: string;
  role: "user" | "admin";
  disabled: boolean;
  lastLoginAt: Date | null;
  activeSessionCount: number;
  createdAt: Date;
};

export type ListUsersResponse = { users: UserRow[] };

export type SetRoleResponse = { ok: true };

export type SetDisabledResponse = { ok: true };

export type AuditRow = {
  id: string;
  actorUserId: string;
  action: string;
  targetType: string;
  targetId: string;
  metadata: Record<string, unknown>;
  createdAt: Date;
};

export type ListAuditResponse = {
  events: AuditRow[];
  nextCursor?: string;
};

// FR-030: Org-scoped admin user listing with enrichment
export const listUsers = api(
  { expose: true, auth: true, method: "GET", path: "/admin/users" },
  async (): Promise<ListUsersResponse> => {
    const auth = requireAdmin();

    // Join through org_memberships to scope to caller's org
    const rows = await db
      .select({
        id: users.id,
        email: users.email,
        name: users.name,
        role: users.role,
        disabled: users.disabled,
        lastLoginAt: users.lastLoginAt,
        createdAt: users.createdAt,
      })
      .from(users)
      .innerJoin(orgMemberships, eq(users.id, orgMemberships.userId))
      .where(
        and(
          eq(orgMemberships.orgId, auth.orgId),
          eq(orgMemberships.status, "active")
        )
      );

    // Enrich with active session counts (desktop refresh tokens)
    const userIds = rows.map((r) => r.id);
    const sessionCounts = new Map<string, number>();

    if (userIds.length > 0) {
      const counts = await db
        .select({
          userId: desktopRefreshTokens.userId,
          count: sql<number>`count(*)::int`,
        })
        .from(desktopRefreshTokens)
        .where(
          and(
            inArray(desktopRefreshTokens.userId, userIds),
            gte(desktopRefreshTokens.expiresAt, new Date())
          )
        )
        .groupBy(desktopRefreshTokens.userId);

      for (const c of counts) {
        sessionCounts.set(c.userId, c.count);
      }
    }

    return {
      users: rows.map((r) => ({
        ...r,
        activeSessionCount: sessionCounts.get(r.id) ?? 0,
      })),
    };
  }
);

export const setRole = api(
  { expose: true, auth: true, method: "POST", path: "/admin/users/set-role" },
  async (req: {
    userId: string;
    role: "user" | "admin";
  }): Promise<SetRoleResponse> => {
    const auth = requireAdmin();
    await requireUserInOrg(req.userId, auth.orgId);
    await db.update(users).set({ role: req.role }).where(eq(users.id, req.userId));

    await db.insert(auditLog).values({
      actorUserId: auth.userID,
      action: "user.set_role",
      targetType: "user",
      targetId: req.userId,
      metadata: { role: req.role },
    });

    return { ok: true };
  }
);

// ---------------------------------------------------------------------------
// FR-025: User disable/enable (spec 080 Phase 6)
// ---------------------------------------------------------------------------

export const setDisabled = api(
  { expose: true, auth: true, method: "POST", path: "/admin/users/set-disabled" },
  async (req: {
    userId: string;
    disabled: boolean;
  }): Promise<SetDisabledResponse> => {
    const auth = requireAdmin();

    // Prevent self-disable
    if (req.userId === auth.userID) {
      throw APIError.invalidArgument("Cannot disable your own account");
    }

    await requireUserInOrg(req.userId, auth.orgId);
    await db.update(users).set({ disabled: req.disabled, updatedAt: new Date() }).where(eq(users.id, req.userId));

    // Evict from auth handler cache so the change takes effect immediately
    evictDisabledCache(req.userId);

    // On disable: revoke all sessions
    if (req.disabled) {
      const [user] = await db
        .select({ rauthyUserId: users.rauthyUserId })
        .from(users)
        .where(eq(users.id, req.userId))
        .limit(1);

      if (user?.rauthyUserId) {
        try {
          await revokeSession(user.rauthyUserId);
        } catch (err) {
          log.warn("Failed to revoke Rauthy sessions on user disable", { error: String(err) });
        }
      }

      // Delete all desktop refresh tokens
      await db.delete(desktopRefreshTokens).where(eq(desktopRefreshTokens.userId, req.userId));
    }

    await db.insert(auditLog).values({
      actorUserId: auth.userID,
      action: req.disabled ? "user.disabled" : "user.enabled",
      targetType: "user",
      targetId: req.userId,
      metadata: {},
    });

    return { ok: true };
  }
);

// ---------------------------------------------------------------------------
// FR-026: Session management (spec 080 Phase 6)
// ---------------------------------------------------------------------------

export type SessionRow = {
  id: string;
  userId: string;
  idpProvider: string;
  platformRole: string;
  orgSlug: string;
  expiresAt: Date;
  createdAt: Date;
};

export type ListSessionsResponse = { sessions: SessionRow[] };

export const listUserSessions = api(
  { expose: true, auth: true, method: "GET", path: "/admin/users/:userId/sessions" },
  async (req: { userId: string }): Promise<ListSessionsResponse> => {
    const auth = requireAdmin();
    await requireUserInOrg(req.userId, auth.orgId);

    const rows = await db
      .select({
        id: desktopRefreshTokens.id,
        userId: desktopRefreshTokens.userId,
        idpProvider: desktopRefreshTokens.idpProvider,
        platformRole: desktopRefreshTokens.platformRole,
        orgSlug: desktopRefreshTokens.orgSlug,
        expiresAt: desktopRefreshTokens.expiresAt,
        createdAt: desktopRefreshTokens.createdAt,
      })
      .from(desktopRefreshTokens)
      .where(
        and(
          eq(desktopRefreshTokens.userId, req.userId),
          gte(desktopRefreshTokens.expiresAt, new Date())
        )
      )
      .orderBy(desc(desktopRefreshTokens.createdAt));

    return { sessions: rows };
  }
);

export const revokeUserSessions = api(
  { expose: true, auth: true, method: "DELETE", path: "/admin/users/:userId/sessions" },
  async (req: { userId: string }): Promise<{ ok: true }> => {
    const auth = requireAdmin();
    await requireUserInOrg(req.userId, auth.orgId);

    // Revoke Rauthy sessions
    const [user] = await db
      .select({ rauthyUserId: users.rauthyUserId })
      .from(users)
      .where(eq(users.id, req.userId))
      .limit(1);

    if (user?.rauthyUserId) {
      try {
        await revokeSession(user.rauthyUserId);
      } catch (err) {
        log.warn("Failed to revoke Rauthy sessions", { error: String(err) });
      }
    }

    // Delete all desktop refresh tokens
    await db.delete(desktopRefreshTokens).where(eq(desktopRefreshTokens.userId, req.userId));

    await db.insert(auditLog).values({
      actorUserId: auth.userID,
      action: "user.sessions_revoked",
      targetType: "user",
      targetId: req.userId,
      metadata: { scope: "all" },
    });

    return { ok: true };
  }
);

export const revokeUserSession = api(
  { expose: true, auth: true, method: "DELETE", path: "/admin/users/:userId/sessions/:tokenId" },
  async (req: { userId: string; tokenId: string }): Promise<{ ok: true }> => {
    const auth = requireAdmin();
    await requireUserInOrg(req.userId, auth.orgId);

    const [deleted] = await db
      .delete(desktopRefreshTokens)
      .where(
        and(
          eq(desktopRefreshTokens.id, req.tokenId),
          eq(desktopRefreshTokens.userId, req.userId)
        )
      )
      .returning({ id: desktopRefreshTokens.id });

    if (!deleted) {
      throw APIError.notFound("Session not found");
    }

    await db.insert(auditLog).values({
      actorUserId: auth.userID,
      action: "user.sessions_revoked",
      targetType: "desktop_refresh_token",
      targetId: req.tokenId,
      metadata: { scope: "single", user_id: req.userId },
    });

    return { ok: true };
  }
);

// ---------------------------------------------------------------------------
// FR-028: Audit log with pagination and filtering (spec 080 Phase 6)
// ---------------------------------------------------------------------------

export const listAudit = api(
  { expose: true, auth: true, method: "GET", path: "/admin/audit" },
  async (req: {
    cursor?: string;
    limit?: number;
    action?: string;
    actorUserId?: string;
    targetType?: string;
    targetId?: string;
    from?: string;
    to?: string;
  }): Promise<ListAuditResponse> => {
    requireAdmin();

    const pageLimit = Math.min(req.limit ?? 50, 200);

    // Build dynamic conditions
    const conditions = [];
    if (req.cursor) {
      conditions.push(lt(auditLog.id, req.cursor));
    }
    if (req.action) {
      conditions.push(eq(auditLog.action, req.action));
    }
    if (req.actorUserId) {
      conditions.push(eq(auditLog.actorUserId, req.actorUserId));
    }
    if (req.targetType) {
      conditions.push(eq(auditLog.targetType, req.targetType));
    }
    if (req.targetId) {
      conditions.push(eq(auditLog.targetId, req.targetId));
    }
    if (req.from) {
      conditions.push(gte(auditLog.createdAt, new Date(req.from)));
    }
    if (req.to) {
      conditions.push(lte(auditLog.createdAt, new Date(req.to)));
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const rows = await db
      .select()
      .from(auditLog)
      .where(whereClause)
      .orderBy(desc(auditLog.id))
      .limit(pageLimit + 1); // fetch one extra to detect next page

    const hasMore = rows.length > pageLimit;
    const page = hasMore ? rows.slice(0, pageLimit) : rows;

    return {
      events: page.map((r) => ({
        ...r,
        metadata: (r.metadata ?? {}) as Record<string, unknown>,
      })),
      nextCursor: hasMore ? page[page.length - 1].id : undefined,
    };
  }
);

// ---------------------------------------------------------------------------
// Team-to-role mapping CRUD (spec 080 Phase 3 — FR-009)
// ---------------------------------------------------------------------------

export type TeamMappingRow = {
  id: string;
  orgId: string;
  githubTeamSlug: string;
  githubTeamId: number;
  targetScope: "org" | "project";
  targetId: string | null;
  role: string;
  createdAt: Date;
};

export type ListTeamMappingsResponse = { mappings: TeamMappingRow[] };

export const listTeamMappings = api(
  {
    expose: true,
    auth: true,
    method: "GET",
    path: "/admin/orgs/:orgId/team-mappings",
  },
  async (req: { orgId: string }): Promise<ListTeamMappingsResponse> => {
    requireOrgAdmin(req.orgId);
    const rows = await db
      .select()
      .from(githubTeamRoleMappings)
      .where(eq(githubTeamRoleMappings.orgId, req.orgId));

    return { mappings: rows };
  }
);

export const createTeamMapping = api(
  {
    expose: true,
    auth: true,
    method: "POST",
    path: "/admin/orgs/:orgId/team-mappings",
  },
  async (req: {
    orgId: string;
    githubTeamSlug: string;
    githubTeamId: number;
    targetScope: "org" | "project";
    targetId?: string;
    role: string;
  }): Promise<TeamMappingRow> => {
    const auth = requireOrgAdmin(req.orgId);

    // Validate role against scope
    const validOrgRoles = new Set(["owner", "admin", "member"]);
    const validProjectRoles = new Set(["viewer", "developer", "deployer", "admin"]);
    const validRoles = req.targetScope === "org" ? validOrgRoles : validProjectRoles;
    if (!validRoles.has(req.role)) {
      throw APIError.invalidArgument(
        `Invalid role "${req.role}" for ${req.targetScope} scope. Valid: ${[...validRoles].join(", ")}`
      );
    }

    if (req.targetScope === "project" && !req.targetId) {
      throw APIError.invalidArgument("targetId is required for project-scope mappings");
    }

    const [created] = await db
      .insert(githubTeamRoleMappings)
      .values({
        orgId: req.orgId,
        githubTeamSlug: req.githubTeamSlug,
        githubTeamId: req.githubTeamId,
        targetScope: req.targetScope,
        targetId: req.targetId ?? null,
        role: req.role,
      })
      .returning();

    await db.insert(auditLog).values({
      actorUserId: auth.userID,
      action: "team_mapping.created",
      targetType: "team_mapping",
      targetId: created.id,
      metadata: {
        org_id: req.orgId,
        team_slug: req.githubTeamSlug,
        target_scope: req.targetScope,
        role: req.role,
      },
    });

    return created;
  }
);

export const updateTeamMapping = api(
  {
    expose: true,
    auth: true,
    method: "PUT",
    path: "/admin/orgs/:orgId/team-mappings/:id",
  },
  async (req: { orgId: string; id: string; role: string }): Promise<{ ok: true }> => {
    const auth = requireOrgAdmin(req.orgId);

    const result = await db
      .update(githubTeamRoleMappings)
      .set({ role: req.role })
      .where(
        and(
          eq(githubTeamRoleMappings.id, req.id),
          eq(githubTeamRoleMappings.orgId, req.orgId)
        )
      );

    if (!result.rowCount || result.rowCount === 0) {
      throw APIError.notFound("Team mapping not found");
    }

    await db.insert(auditLog).values({
      actorUserId: auth.userID,
      action: "team_mapping.updated",
      targetType: "team_mapping",
      targetId: req.id,
      metadata: { org_id: req.orgId, role: req.role },
    });

    return { ok: true };
  }
);

export const deleteTeamMapping = api(
  {
    expose: true,
    auth: true,
    method: "DELETE",
    path: "/admin/orgs/:orgId/team-mappings/:id",
  },
  async (req: { orgId: string; id: string }): Promise<{ ok: true }> => {
    const auth = requireOrgAdmin(req.orgId);

    const [deleted] = await db
      .delete(githubTeamRoleMappings)
      .where(
        and(
          eq(githubTeamRoleMappings.id, req.id),
          eq(githubTeamRoleMappings.orgId, req.orgId)
        )
      )
      .returning({ id: githubTeamRoleMappings.id });

    if (!deleted) {
      throw APIError.notFound("Team mapping not found");
    }

    await db.insert(auditLog).values({
      actorUserId: auth.userID,
      action: "team_mapping.deleted",
      targetType: "team_mapping",
      targetId: req.id,
      metadata: { org_id: req.orgId },
    });

    return { ok: true };
  }
);

// ---------------------------------------------------------------------------
// OIDC Provider CRUD (spec 080 Phase 4 — Enterprise OIDC Federation)
// ---------------------------------------------------------------------------

export type OidcProviderRow = {
  id: string;
  orgId: string;
  name: string;
  providerType: string;
  issuer: string;
  clientId: string;
  scopes: string;
  claimsMapping: unknown;
  emailDomain: string | null;
  autoProvision: boolean;
  status: string;
  createdAt: Date;
  updatedAt: Date;
};

export type ListOidcProvidersResponse = { providers: OidcProviderRow[] };

export const listOidcProviders = api(
  {
    expose: true,
    auth: true,
    method: "GET",
    path: "/admin/orgs/:orgId/oidc-providers",
  },
  async (req: { orgId: string }): Promise<ListOidcProvidersResponse> => {
    requireOrgAdmin(req.orgId);
    const rows = await db
      .select({
        id: oidcProviders.id,
        orgId: oidcProviders.orgId,
        name: oidcProviders.name,
        providerType: oidcProviders.providerType,
        issuer: oidcProviders.issuer,
        clientId: oidcProviders.clientId,
        scopes: oidcProviders.scopes,
        claimsMapping: oidcProviders.claimsMapping,
        emailDomain: oidcProviders.emailDomain,
        autoProvision: oidcProviders.autoProvision,
        status: oidcProviders.status,
        createdAt: oidcProviders.createdAt,
        updatedAt: oidcProviders.updatedAt,
      })
      .from(oidcProviders)
      .where(eq(oidcProviders.orgId, req.orgId));

    return { providers: rows };
  }
);

export const createOidcProvider = api(
  {
    expose: true,
    auth: true,
    method: "POST",
    path: "/admin/orgs/:orgId/oidc-providers",
  },
  async (req: {
    orgId: string;
    name: string;
    providerType: string;
    issuer: string;
    clientId: string;
    clientSecretEnc: string;
    scopes?: string;
    claimsMapping?: Record<string, string>;
    emailDomain?: string;
    autoProvision?: boolean;
  }): Promise<OidcProviderRow> => {
    const auth = requireOrgAdmin(req.orgId);

    const [created] = await db
      .insert(oidcProviders)
      .values({
        orgId: req.orgId,
        name: req.name,
        providerType: req.providerType,
        issuer: req.issuer,
        clientId: req.clientId,
        clientSecretEnc: req.clientSecretEnc,
        scopes: req.scopes ?? "openid profile email",
        claimsMapping: req.claimsMapping ?? {},
        emailDomain: req.emailDomain ?? null,
        autoProvision: req.autoProvision ?? true,
        status: "active",
      })
      .returning();

    await db.insert(auditLog).values({
      actorUserId: auth.userID,
      action: "oidc_provider.created",
      targetType: "oidc_provider",
      targetId: created.id,
      metadata: {
        org_id: req.orgId,
        name: req.name,
        provider_type: req.providerType,
        issuer: req.issuer,
        email_domain: req.emailDomain,
      },
    });

    return {
      id: created.id,
      orgId: created.orgId,
      name: created.name,
      providerType: created.providerType,
      issuer: created.issuer,
      clientId: created.clientId,
      scopes: created.scopes,
      claimsMapping: created.claimsMapping,
      emailDomain: created.emailDomain,
      autoProvision: created.autoProvision,
      status: created.status,
      createdAt: created.createdAt,
      updatedAt: created.updatedAt,
    };
  }
);

export const updateOidcProvider = api(
  {
    expose: true,
    auth: true,
    method: "PUT",
    path: "/admin/orgs/:orgId/oidc-providers/:id",
  },
  async (req: {
    orgId: string;
    id: string;
    name?: string;
    scopes?: string;
    claimsMapping?: Record<string, string>;
    emailDomain?: string;
    autoProvision?: boolean;
    status?: string;
  }): Promise<{ ok: true }> => {
    const auth = requireOrgAdmin(req.orgId);

    const VALID_STATUSES = ["active", "disabled", "pending"];
    if (req.status !== undefined && !VALID_STATUSES.includes(req.status)) {
      throw APIError.invalidArgument(`Invalid status: must be one of ${VALID_STATUSES.join(", ")}`);
    }

    const updates: Record<string, unknown> = { updatedAt: new Date() };
    if (req.name !== undefined) updates.name = req.name;
    if (req.scopes !== undefined) updates.scopes = req.scopes;
    if (req.claimsMapping !== undefined) updates.claimsMapping = req.claimsMapping;
    if (req.emailDomain !== undefined) updates.emailDomain = req.emailDomain;
    if (req.autoProvision !== undefined) updates.autoProvision = req.autoProvision;
    if (req.status !== undefined) updates.status = req.status;

    const result = await db
      .update(oidcProviders)
      .set(updates)
      .where(
        and(
          eq(oidcProviders.id, req.id),
          eq(oidcProviders.orgId, req.orgId)
        )
      );

    if (!result.rowCount || result.rowCount === 0) {
      throw APIError.notFound("OIDC provider not found");
    }

    await db.insert(auditLog).values({
      actorUserId: auth.userID,
      action: "oidc_provider.updated",
      targetType: "oidc_provider",
      targetId: req.id,
      metadata: { org_id: req.orgId, ...updates },
    });

    return { ok: true };
  }
);

export const deleteOidcProvider = api(
  {
    expose: true,
    auth: true,
    method: "DELETE",
    path: "/admin/orgs/:orgId/oidc-providers/:id",
  },
  async (req: { orgId: string; id: string }): Promise<{ ok: true }> => {
    const auth = requireOrgAdmin(req.orgId);

    // Cascade will handle oidc_group_role_mappings
    const [deleted] = await db
      .delete(oidcProviders)
      .where(
        and(
          eq(oidcProviders.id, req.id),
          eq(oidcProviders.orgId, req.orgId)
        )
      )
      .returning({ id: oidcProviders.id });

    if (!deleted) {
      throw APIError.notFound("OIDC provider not found");
    }

    await db.insert(auditLog).values({
      actorUserId: auth.userID,
      action: "oidc_provider.deleted",
      targetType: "oidc_provider",
      targetId: req.id,
      metadata: { org_id: req.orgId },
    });

    return { ok: true };
  }
);

// ---------------------------------------------------------------------------
// OIDC Group-to-Role Mapping CRUD (spec 080 Phase 4)
// ---------------------------------------------------------------------------

export type OidcGroupMappingRow = {
  id: string;
  orgId: string;
  providerId: string;
  idpGroupId: string;
  idpGroupName: string | null;
  targetScope: "org" | "project";
  targetId: string | null;
  role: string;
  createdAt: Date;
};

export type ListOidcGroupMappingsResponse = { mappings: OidcGroupMappingRow[] };

export const listOidcGroupMappings = api(
  {
    expose: true,
    auth: true,
    method: "GET",
    path: "/admin/orgs/:orgId/oidc-providers/:providerId/group-mappings",
  },
  async (req: { orgId: string; providerId: string }): Promise<ListOidcGroupMappingsResponse> => {
    requireOrgAdmin(req.orgId);
    const rows = await db
      .select()
      .from(oidcGroupRoleMappings)
      .where(
        and(
          eq(oidcGroupRoleMappings.orgId, req.orgId),
          eq(oidcGroupRoleMappings.providerId, req.providerId)
        )
      );

    return { mappings: rows };
  }
);

export const createOidcGroupMapping = api(
  {
    expose: true,
    auth: true,
    method: "POST",
    path: "/admin/orgs/:orgId/oidc-providers/:providerId/group-mappings",
  },
  async (req: {
    orgId: string;
    providerId: string;
    idpGroupId: string;
    idpGroupName?: string;
    targetScope: "org" | "project";
    targetId?: string;
    role: string;
  }): Promise<OidcGroupMappingRow> => {
    const auth = requireOrgAdmin(req.orgId);

    // Validate role against scope
    const validOrgRoles = new Set(["owner", "admin", "member"]);
    const validProjectRoles = new Set(["viewer", "developer", "deployer", "admin"]);
    const validRoles = req.targetScope === "org" ? validOrgRoles : validProjectRoles;
    if (!validRoles.has(req.role)) {
      throw APIError.invalidArgument(
        `Invalid role "${req.role}" for ${req.targetScope} scope. Valid: ${[...validRoles].join(", ")}`
      );
    }

    if (req.targetScope === "project" && !req.targetId) {
      throw APIError.invalidArgument("targetId is required for project-scope mappings");
    }

    // Verify the provider belongs to this org
    const [provider] = await db
      .select({ id: oidcProviders.id })
      .from(oidcProviders)
      .where(
        and(eq(oidcProviders.id, req.providerId), eq(oidcProviders.orgId, req.orgId))
      )
      .limit(1);

    if (!provider) {
      throw APIError.notFound("OIDC provider not found in this organization");
    }

    const [created] = await db
      .insert(oidcGroupRoleMappings)
      .values({
        orgId: req.orgId,
        providerId: req.providerId,
        idpGroupId: req.idpGroupId,
        idpGroupName: req.idpGroupName ?? null,
        targetScope: req.targetScope,
        targetId: req.targetId ?? null,
        role: req.role,
      })
      .returning();

    await db.insert(auditLog).values({
      actorUserId: auth.userID,
      action: "oidc_group_mapping.created",
      targetType: "oidc_group_mapping",
      targetId: created.id,
      metadata: {
        org_id: req.orgId,
        provider_id: req.providerId,
        idp_group_id: req.idpGroupId,
        target_scope: req.targetScope,
        role: req.role,
      },
    });

    return created;
  }
);

export const deleteOidcGroupMapping = api(
  {
    expose: true,
    auth: true,
    method: "DELETE",
    path: "/admin/orgs/:orgId/oidc-providers/:providerId/group-mappings/:id",
  },
  async (req: { orgId: string; providerId: string; id: string }): Promise<{ ok: true }> => {
    const auth = requireOrgAdmin(req.orgId);

    const [deleted] = await db
      .delete(oidcGroupRoleMappings)
      .where(
        and(
          eq(oidcGroupRoleMappings.id, req.id),
          eq(oidcGroupRoleMappings.orgId, req.orgId),
          eq(oidcGroupRoleMappings.providerId, req.providerId)
        )
      )
      .returning({ id: oidcGroupRoleMappings.id });

    if (!deleted) {
      throw APIError.notFound("OIDC group mapping not found");
    }

    await db.insert(auditLog).values({
      actorUserId: auth.userID,
      action: "oidc_group_mapping.deleted",
      targetType: "oidc_group_mapping",
      targetId: req.id,
      metadata: { org_id: req.orgId, provider_id: req.providerId },
    });

    return { ok: true };
  }
);
