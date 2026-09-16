/**
 * GitHub Team Membership Sync (spec 080 Phase 3 — FR-009, FR-010, FR-011).
 *
 * Background sync job that reconciles GitHub org/team memberships with OAP
 * org_memberships, applies team-to-role mappings, and revokes access for
 * removed members.
 */

import { api } from "encore.dev/api";
import { CronJob } from "encore.dev/cron";
import log from "encore.dev/log";
import { db } from "../db/drizzle";
import {
  auditLog,
  githubInstallations,
  githubTeamRoleMappings,
  orgMemberships,
  users,
} from "../db/schema";
import { eq, and, inArray } from "drizzle-orm";
import { signAppJwt } from "./appJwt";
import { revokeSession } from "../auth/rauthy";
import { applyTeamRoleMappings } from "../auth/membership";

const SYSTEM_USER_ID = "00000000-0000-0000-0000-000000000000";

// ---------------------------------------------------------------------------
// GitHub App API helpers (server-to-server via installation token)
// ---------------------------------------------------------------------------

/**
 * Broker a scoped installation access token from the GitHub App.
 */
async function brokerInstallationToken(
  installationId: number,
  permissions: Record<string, string>
): Promise<string> {
  const jwt = await signAppJwt();
  const resp = await fetch(
    `https://api.github.com/app/installations/${installationId}/access_tokens`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${jwt}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      body: JSON.stringify({ permissions }),
    }
  );
  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(
      `Installation token exchange failed: ${resp.status} ${body}`
    );
  }
  const data = (await resp.json()) as { token: string };
  return data.token;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface GitHubOrgMember {
  githubUserId: number;
  githubLogin: string;
  role: "admin" | "member";
}

interface TeamMember {
  githubUserId: number;
  githubLogin: string;
}

// ---------------------------------------------------------------------------
// Fetch org members via GitHub App API
// ---------------------------------------------------------------------------

/**
 * Fetch all members of a GitHub org using an App installation token.
 */
export async function fetchOrgMembersViaApp(
  installationId: number,
  githubOrgLogin: string
): Promise<GitHubOrgMember[]> {
  const token = await brokerInstallationToken(installationId, {
    members: "read",
  });

  const members: GitHubOrgMember[] = [];
  let page = 1;

  while (true) {
    const resp = await fetch(
      `https://api.github.com/orgs/${encodeURIComponent(githubOrgLogin)}/members?per_page=100&page=${page}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
        },
      }
    );

    if (!resp.ok) {
      if (resp.status === 403 || resp.status === 404) {
        log.warn("Org members API returned non-OK", {
          org: githubOrgLogin,
          status: resp.status,
        });
        break;
      }
      throw new Error(
        `GitHub org members API failed: ${resp.status} for ${githubOrgLogin}`
      );
    }

    const data = (await resp.json()) as Array<{
      id: number;
      login: string;
      role_name?: string;
    }>;
    if (data.length === 0) break;

    for (const m of data) {
      members.push({
        githubUserId: m.id,
        githubLogin: m.login,
        role: (m.role_name === "admin" ? "admin" : "member") as
          | "admin"
          | "member",
      });
    }

    if (data.length < 100) break;
    page++;
  }

  return members;
}

// ---------------------------------------------------------------------------
// Fetch team members via GitHub App API
// ---------------------------------------------------------------------------

/**
 * Fetch all members of a specific GitHub team using an App installation token.
 */
export async function fetchTeamMembersViaApp(
  installationId: number,
  githubOrgLogin: string,
  teamSlug: string
): Promise<TeamMember[]> {
  const token = await brokerInstallationToken(installationId, {
    members: "read",
  });

  const members: TeamMember[] = [];
  let page = 1;

  while (true) {
    const resp = await fetch(
      `https://api.github.com/orgs/${encodeURIComponent(githubOrgLogin)}/teams/${encodeURIComponent(teamSlug)}/members?per_page=100&page=${page}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
        },
      }
    );

    if (!resp.ok) {
      if (resp.status === 404) {
        log.warn("Team not found", { org: githubOrgLogin, team: teamSlug });
        return [];
      }
      throw new Error(
        `GitHub team members API failed: ${resp.status} for ${githubOrgLogin}/${teamSlug}`
      );
    }

    const data = (await resp.json()) as Array<{ id: number; login: string }>;
    if (data.length === 0) break;

    for (const m of data) {
      members.push({ githubUserId: m.id, githubLogin: m.login });
    }

    if (data.length < 100) break;
    page++;
  }

  return members;
}

// ---------------------------------------------------------------------------
// Revocation primitive (spec 080 FR-011)
// ---------------------------------------------------------------------------

/**
 * Revoke a user's org membership and invalidate their Rauthy sessions.
 * Used by both the sync job and the organization.member_removed webhook.
 */
export async function revokeOrgMembership(
  userId: string,
  orgId: string
): Promise<void> {
  // Mark membership as removed
  await db
    .update(orgMemberships)
    .set({ status: "removed", updatedAt: new Date() })
    .where(
      and(eq(orgMemberships.userId, userId), eq(orgMemberships.orgId, orgId))
    );

  // Revoke Rauthy sessions
  const [user] = await db
    .select({ rauthyUserId: users.rauthyUserId })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  if (user?.rauthyUserId) {
    await revokeSession(user.rauthyUserId);
    log.info("Revoked Rauthy sessions for removed member", {
      userId,
      orgId,
      rauthyUserId: user.rauthyUserId,
    });
  }

  // Audit log
  await db.insert(auditLog).values({
    actorUserId: SYSTEM_USER_ID,
    action: "membership.revoked",
    targetType: "user",
    targetId: userId,
    metadata: { org_id: orgId, reason: "github_membership_removed" },
  });
}

// ---------------------------------------------------------------------------
// Per-installation sync logic
// ---------------------------------------------------------------------------

/**
 * Sync a single GitHub App installation: reconcile org members, apply
 * team mappings, and revoke stale memberships.
 */
export async function syncOrgInstallation(
  installation: {
    installationId: number;
    githubOrgLogin: string;
    orgId: string;
  }
): Promise<{ added: number; removed: number; teamMappingsApplied: number }> {
  const { installationId, githubOrgLogin, orgId } = installation;
  let added = 0;
  let removed = 0;
  let teamMappingsApplied = 0;

  // 1. Fetch current GitHub org members
  const ghMembers = await fetchOrgMembersViaApp(
    installationId,
    githubOrgLogin
  );
  const ghUserIds = new Set(ghMembers.map((m) => m.githubUserId));

  // 2. Load current active OAP memberships for this org
  const currentMemberships = await db
    .select({
      id: orgMemberships.id,
      userId: orgMemberships.userId,
    })
    .from(orgMemberships)
    .where(
      and(
        eq(orgMemberships.orgId, orgId),
        eq(orgMemberships.source, "github"),
        eq(orgMemberships.status, "active")
      )
    );

  // Build a map of userId -> githubUserId for current members
  const currentUserIds = currentMemberships.map((m) => m.userId);
  const existingUsers =
    currentUserIds.length > 0
      ? await db
          .select({ id: users.id, githubUserId: users.githubUserId })
          .from(users)
          .where(inArray(users.id, currentUserIds))
      : [];
  const userIdToGhId = new Map(
    existingUsers
      .filter((u) => u.githubUserId != null)
      .map((u) => [u.id, u.githubUserId!])
  );

  // 3. Upsert memberships for current GitHub members
  for (const ghMember of ghMembers) {
    // Find OAP user by github_user_id
    const [oapUser] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.githubUserId, ghMember.githubUserId))
      .limit(1);

    if (!oapUser) continue; // User hasn't logged in via OAP yet — skip

    await db
      .insert(orgMemberships)
      .values({
        userId: oapUser.id,
        orgId,
        source: "github",
        githubRole: ghMember.role,
        platformRole: "member",
        status: "active",
        syncedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [orgMemberships.userId, orgMemberships.orgId],
        set: {
          githubRole: ghMember.role,
          syncedAt: new Date(),
          status: "active",
          updatedAt: new Date(),
        },
      });
    added++;
  }

  // 4. Revoke memberships for users no longer in the GitHub org
  for (const membership of currentMemberships) {
    const ghId = userIdToGhId.get(membership.userId);
    if (ghId != null && ghUserIds.has(ghId)) continue;

    // User is no longer in the GitHub org
    await revokeOrgMembership(membership.userId, orgId);
    removed++;
  }

  // 5. Apply team-to-role mappings
  const teamMappings = await db
    .select({
      githubTeamSlug: githubTeamRoleMappings.githubTeamSlug,
    })
    .from(githubTeamRoleMappings)
    .where(eq(githubTeamRoleMappings.orgId, orgId));

  // Deduplicate team slugs
  const uniqueTeamSlugs = [...new Set(teamMappings.map((m) => m.githubTeamSlug))];

  for (const teamSlug of uniqueTeamSlugs) {
    try {
      const teamMembers = await fetchTeamMembersViaApp(
        installationId,
        githubOrgLogin,
        teamSlug
      );
      const result = await applyTeamRoleMappings(orgId, teamSlug, teamMembers);
      teamMappingsApplied += result.orgUpdated + result.projectUpdated;
    } catch (err) {
      log.error("Failed to sync team", {
        orgId,
        teamSlug,
        error: String(err),
      });
      // Continue with other teams
    }
  }

  return { added, removed, teamMappingsApplied };
}

// ---------------------------------------------------------------------------
// Cron endpoint — must be an api() endpoint for Encore CronJob
// ---------------------------------------------------------------------------

export const runMembershipSync = api(
  {
    expose: false,
    method: "POST",
    path: "/internal/github/membership-sync",
  },
  async (): Promise<void> => {
    log.info("Starting GitHub membership sync");

    const installations = await db
      .select({
        installationId: githubInstallations.installationId,
        githubOrgLogin: githubInstallations.githubOrgLogin,
        orgId: githubInstallations.orgId,
      })
      .from(githubInstallations)
      .where(eq(githubInstallations.installationState, "active"));

    let totalAdded = 0;
    let totalRemoved = 0;
    let totalTeamMappings = 0;

    for (const inst of installations) {
      if (!inst.orgId) {
        log.warn("Skipping installation with no linked org", {
          installationId: inst.installationId,
        });
        continue;
      }

      try {
        const result = await syncOrgInstallation({
          installationId: inst.installationId,
          githubOrgLogin: inst.githubOrgLogin,
          orgId: inst.orgId,
        });
        totalAdded += result.added;
        totalRemoved += result.removed;
        totalTeamMappings += result.teamMappingsApplied;
      } catch (err) {
        log.error("Failed to sync installation", {
          installationId: inst.installationId,
          org: inst.githubOrgLogin,
          error: String(err),
        });
        // Continue with other installations
      }
    }

    // Audit log for the sync run
    await db.insert(auditLog).values({
      actorUserId: SYSTEM_USER_ID,
      action: "membership.sync_completed",
      targetType: "system",
      targetId: "membership-sync",
      metadata: {
        installations_processed: installations.length,
        members_synced: totalAdded,
        members_revoked: totalRemoved,
        team_mappings_applied: totalTeamMappings,
      },
    });

    log.info("GitHub membership sync completed", {
      installations: installations.length,
      added: totalAdded,
      removed: totalRemoved,
      teamMappings: totalTeamMappings,
    });
  }
);

// ---------------------------------------------------------------------------
// CronJob — every 6 hours (spec 080 FR-010)
// ---------------------------------------------------------------------------

const _ = new CronJob("github-membership-sync", {
  title: "GitHub org membership sync",
  every: "6h",
  endpoint: runMembershipSync,
});
