/**
 * Org membership resolution (spec 080 FR-005).
 *
 * Resolves user's GitHub org memberships against active GitHub App installations,
 * upserts org_memberships, and marks stale memberships.
 */

import log from "encore.dev/log";
import { db } from "../db/drizzle";
import {
  githubInstallations,
  githubTeamRoleMappings,
  oidcGroupRoleMappings,
  oidcProviders,
  orgMemberships,
  organizations,
  projectMembers,
  users,
} from "../db/schema";
import { eq, and, notInArray, inArray, sql } from "drizzle-orm";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface GitHubOrg {
  id: number;
  login: string;
  role: string; // "admin" | "member"
}

// Spec 119: workspace collapsed into project. Resolved orgs no longer carry
// an active-workspace id; per-request projectId supplies project scope.
export interface ResolvedOrg {
  orgId: string;
  orgSlug: string;
  githubOrgLogin: string;    // empty for enterprise OIDC orgs
  orgDisplayName: string;    // best display name (githubOrgLogin || org name || orgSlug)
  platformRole: "owner" | "admin" | "member";
}

// ---------------------------------------------------------------------------
// GitHub API helpers
// ---------------------------------------------------------------------------

/**
 * Fetch the user's GitHub org memberships using their OAuth access token.
 */
export async function fetchUserGitHubOrgs(
  accessToken: string
): Promise<GitHubOrg[]> {
  const orgs: GitHubOrg[] = [];
  let page = 1;

  while (true) {
    const resp = await fetch(
      `https://api.github.com/user/memberships/orgs?state=active&per_page=100&page=${page}`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
        },
      }
    );

    if (!resp.ok) {
      // read:org scope might not be granted — log and return what we have
      if (resp.status === 403 || resp.status === 404) {
        log.warn("GitHub org membership API returned non-OK", {
          status: resp.status,
        });
        break;
      }
      throw new Error(`GitHub orgs API failed: ${resp.status}`);
    }

    const data = (await resp.json()) as Array<{
      organization: { id: number; login: string };
      role: string;
    }>;
    if (data.length === 0) break;

    for (const m of data) {
      orgs.push({
        id: m.organization.id,
        login: m.organization.login,
        role: m.role,
      });
    }

    if (data.length < 100) break;
    page++;
  }

  return orgs;
}

// ---------------------------------------------------------------------------
// Membership resolution
// ---------------------------------------------------------------------------

/**
 * Resolve org memberships for a user after GitHub login.
 *
 * 1. Get user's GitHub org memberships
 * 2. Match against active GitHub App installations
 * 3. Upsert org_memberships for matches
 * 4. Mark stale memberships (user left org)
 */
export async function resolveOrgMemberships(
  githubAccessToken: string,
  userId: string
): Promise<ResolvedOrg[]> {
  // 1. Fetch user's GitHub org memberships
  const ghOrgs = await fetchUserGitHubOrgs(githubAccessToken);
  log.info("Fetched GitHub org memberships", {
    userId,
    orgCount: ghOrgs.length,
  });

  // 2. Match against active installations in a single join query
  const ghOrgIds = ghOrgs.map((o) => o.id);
  const matchedRows =
    ghOrgIds.length > 0
      ? await db
          .select({
            installGithubOrgId: githubInstallations.githubOrgId,
            orgId: organizations.id,
            orgSlug: organizations.slug,
          })
          .from(githubInstallations)
          .innerJoin(
            organizations,
            eq(organizations.id, githubInstallations.orgId)
          )
          .where(
            and(
              eq(githubInstallations.installationState, "active"),
              inArray(githubInstallations.githubOrgId, ghOrgIds)
            )
          )
      : [];

  const matchedOrgs: ResolvedOrg[] = [];
  const matchedOrgIds: string[] = [];

  // 3. Upsert org_memberships for each match.
  for (const row of matchedRows) {
    const ghOrg = ghOrgs.find((o) => o.id === row.installGithubOrgId);
    if (!ghOrg) continue;

    await db
      .insert(orgMemberships)
      .values({
        userId,
        orgId: row.orgId,
        source: "github",
        githubRole: ghOrg.role,
        platformRole: "member", // default; elevated by OAP policy
        status: "active",
        syncedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [orgMemberships.userId, orgMemberships.orgId],
        set: {
          githubRole: ghOrg.role,
          syncedAt: new Date(),
          status: "active",
          updatedAt: new Date(),
        },
      });

    matchedOrgs.push({
      orgId: row.orgId,
      orgSlug: row.orgSlug,
      githubOrgLogin: ghOrg.login,
      orgDisplayName: ghOrg.login || row.orgSlug,
      platformRole: "member",
    });
    matchedOrgIds.push(row.orgId);
  }

  // 4. Mark stale memberships (user no longer in these orgs via GitHub)
  if (matchedOrgIds.length > 0) {
    await db
      .update(orgMemberships)
      .set({ status: "removed", updatedAt: new Date() })
      .where(
        and(
          eq(orgMemberships.userId, userId),
          eq(orgMemberships.source, "github"),
          eq(orgMemberships.status, "active"),
          notInArray(orgMemberships.orgId, matchedOrgIds)
        )
      );
  } else {
    // No matches — mark all GitHub-sourced memberships as removed
    await db
      .update(orgMemberships)
      .set({ status: "removed", updatedAt: new Date() })
      .where(
        and(
          eq(orgMemberships.userId, userId),
          eq(orgMemberships.source, "github"),
          eq(orgMemberships.status, "active")
        )
      );
  }

  log.info("Org membership resolution complete", {
    userId,
    matched: matchedOrgs.length,
    ghOrgsTotal: ghOrgs.length,
  });

  return matchedOrgs;
}

// ---------------------------------------------------------------------------
// Org-level permissions (spec 080 FR-007)
// ---------------------------------------------------------------------------

export type OrgPermission =
  | "project:create"
  | "project:delete"
  | "org:manage_members"
  | "org:manage_policies"
  | "org:manage_billing"
  | "factory:init"
  | "factory:confirm"
  | "factory:configure"
  | "deploy:production";

const ORG_PERMISSION_MAP: Record<OrgPermission, Set<"owner" | "admin" | "member">> = {
  "project:create": new Set(["owner", "admin", "member"]),
  "project:delete": new Set(["owner", "admin"]),
  "org:manage_members": new Set(["owner", "admin"]),
  "org:manage_policies": new Set(["owner"]),
  "org:manage_billing": new Set(["owner"]),
  "factory:init": new Set(["owner", "admin", "member"]),
  "factory:confirm": new Set(["owner", "admin"]),
  "factory:configure": new Set(["owner", "admin"]),
  "deploy:production": new Set(["owner"]),
};

/**
 * Check whether a platform role has a specific org-level permission.
 * Uses the default role-permission mapping from spec 080 FR-007.
 */
export function hasOrgPermission(
  platformRole: "owner" | "admin" | "member",
  permission: OrgPermission
): boolean {
  return ORG_PERMISSION_MAP[permission]?.has(platformRole) ?? false;
}

// ---------------------------------------------------------------------------
// Role lookups
// ---------------------------------------------------------------------------

/**
 * Get the platform role for a user in a specific org.
 * Reads from org_memberships (the resolved state).
 */
export async function getUserOrgRole(
  userId: string,
  orgId: string
): Promise<"owner" | "admin" | "member" | null> {
  const [row] = await db
    .select({ platformRole: orgMemberships.platformRole })
    .from(orgMemberships)
    .where(
      and(
        eq(orgMemberships.userId, userId),
        eq(orgMemberships.orgId, orgId),
        eq(orgMemberships.status, "active")
      )
    )
    .limit(1);

  return row?.platformRole ?? null;
}

// ---------------------------------------------------------------------------
// Team-to-role mapping application (spec 080 FR-009 / FR-010)
// ---------------------------------------------------------------------------

interface TeamMember {
  githubUserId: number;
  githubLogin: string;
}

/**
 * Apply team-to-role mappings for a specific team.
 *
 * For org-scope mappings: elevates `org_memberships.platform_role` for team members.
 * For project-scope mappings: upserts `project_members` with the mapped role.
 */
export async function applyTeamRoleMappings(
  orgId: string,
  teamSlug: string,
  teamMembers: TeamMember[]
): Promise<{ orgUpdated: number; projectUpdated: number }> {
  const mappings = await db
    .select()
    .from(githubTeamRoleMappings)
    .where(
      and(
        eq(githubTeamRoleMappings.orgId, orgId),
        eq(githubTeamRoleMappings.githubTeamSlug, teamSlug)
      )
    );

  if (mappings.length === 0) return { orgUpdated: 0, projectUpdated: 0 };

  // Resolve OAP user IDs for team members
  const ghUserIds = teamMembers.map((m) => m.githubUserId);
  const oapUsers =
    ghUserIds.length > 0
      ? await db
          .select({ id: users.id, githubUserId: users.githubUserId })
          .from(users)
          .where(inArray(users.githubUserId, ghUserIds))
      : [];

  const ghToOap = new Map(
    oapUsers
      .filter((u) => u.githubUserId != null)
      .map((u) => [u.githubUserId!, u.id])
  );

  let orgUpdated = 0;
  let projectUpdated = 0;

  for (const mapping of mappings) {
    if (mapping.targetScope === "org") {
      // Elevate org membership platform_role for team members
      const validRoles = new Set(["owner", "admin", "member"]);
      if (!validRoles.has(mapping.role)) continue;

      for (const [, userId] of ghToOap) {
        const result = await db
          .update(orgMemberships)
          .set({
            platformRole: mapping.role as "owner" | "admin" | "member",
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(orgMemberships.userId, userId),
              eq(orgMemberships.orgId, orgId),
              eq(orgMemberships.status, "active")
            )
          );
        if (result.rowCount && result.rowCount > 0) orgUpdated++;
      }
    } else if (mapping.targetScope === "project" && mapping.targetId) {
      // Upsert project_members for team members
      const validRoles = new Set(["viewer", "developer", "deployer", "admin"]);
      if (!validRoles.has(mapping.role)) continue;

      for (const [, userId] of ghToOap) {
        await db
          .insert(projectMembers)
          .values({
            projectId: mapping.targetId!,
            userId,
            role: mapping.role as "viewer" | "developer" | "deployer" | "admin",
          })
          .onConflictDoUpdate({
            target: [projectMembers.projectId, projectMembers.userId],
            set: {
              role: mapping.role as "viewer" | "developer" | "deployer" | "admin",
              updatedAt: new Date(),
            },
          });
        projectUpdated++;
      }
    }
  }

  log.info("Applied team role mappings", {
    orgId,
    teamSlug,
    teamMemberCount: teamMembers.length,
    orgUpdated,
    projectUpdated,
  });

  return { orgUpdated, projectUpdated };
}

// ---------------------------------------------------------------------------
// OIDC Membership Resolution (spec 080 Phase 4)
// ---------------------------------------------------------------------------

/**
 * Resolve org memberships for a user from OIDC group claims.
 *
 * Unlike GitHub membership (which queries the GitHub API), OIDC membership
 * derives from group claims in the ID token, mapped via oidc_group_role_mappings.
 *
 * If no group mappings exist for the provider, the user is assigned to the
 * provider's org with the default "member" role.
 */
export async function resolveOidcMemberships(
  userId: string,
  providerId: string,
  providerOrgId: string,
  idpGroups: string[]
): Promise<ResolvedOrg[]> {
  log.info("Resolving OIDC org memberships", {
    userId,
    providerId,
    groupCount: idpGroups.length,
  });

  // Always create/update the base org membership for the provider's org
  const [org] = await db
    .select({ id: organizations.id, slug: organizations.slug, name: organizations.name })
    .from(organizations)
    .where(eq(organizations.id, providerOrgId))
    .limit(1);

  if (!org) {
    log.error("OIDC provider org not found", { orgId: providerOrgId });
    return [];
  }

  // Start with default member role
  let resolvedPlatformRole: "owner" | "admin" | "member" = "member";

  // If there are group claims, apply group-to-role mappings
  if (idpGroups.length > 0) {
    const groupMappings = await db
      .select()
      .from(oidcGroupRoleMappings)
      .where(
        and(
          eq(oidcGroupRoleMappings.orgId, org.id),
          eq(oidcGroupRoleMappings.providerId, providerId),
          inArray(oidcGroupRoleMappings.idpGroupId, idpGroups)
        )
      );

    // Apply org-level mappings (highest role wins)
    const roleHierarchy: Record<string, number> = { member: 0, admin: 1, owner: 2 };
    for (const mapping of groupMappings) {
      if (mapping.targetScope === "org") {
        const mappedRole = mapping.role as "owner" | "admin" | "member";
        if ((roleHierarchy[mappedRole] ?? 0) > (roleHierarchy[resolvedPlatformRole] ?? 0)) {
          resolvedPlatformRole = mappedRole;
        }
      }
    }

    // Apply project-level mappings
    const projectMappings = groupMappings.filter(
      (m) => m.targetScope === "project" && m.targetId
    );
    for (const mapping of projectMappings) {
      const validRoles = new Set(["viewer", "developer", "deployer", "admin"]);
      if (!validRoles.has(mapping.role)) continue;

      await db
        .insert(projectMembers)
        .values({
          projectId: mapping.targetId!,
          userId,
          role: mapping.role as "viewer" | "developer" | "deployer" | "admin",
        })
        .onConflictDoUpdate({
          target: [projectMembers.projectId, projectMembers.userId],
          set: {
            role: mapping.role as "viewer" | "developer" | "deployer" | "admin",
            updatedAt: new Date(),
          },
        });
    }
  }

  // Upsert the org membership — preserve existing source if already set
  // (e.g. a user who logged in via GitHub first keeps source=github)
  await db
    .insert(orgMemberships)
    .values({
      userId,
      orgId: org.id,
      source: "oidc",
      platformRole: resolvedPlatformRole,
      status: "active",
      syncedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [orgMemberships.userId, orgMemberships.orgId],
      set: {
        // Don't overwrite source — keep the original provider trace
        platformRole: resolvedPlatformRole,
        syncedAt: new Date(),
        status: "active",
        updatedAt: new Date(),
      },
    });

  const resolvedOrgs: ResolvedOrg[] = [
    {
      orgId: org.id,
      orgSlug: org.slug,
      githubOrgLogin: "",
      orgDisplayName: org.name || org.slug,
      platformRole: resolvedPlatformRole,
    },
  ];

  log.info("OIDC org membership resolution complete", {
    userId,
    orgId: org.id,
    role: resolvedPlatformRole,
    groupsUsed: idpGroups.length,
  });

  return resolvedOrgs;
}
