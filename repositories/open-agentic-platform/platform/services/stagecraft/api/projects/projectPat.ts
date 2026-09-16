/**
 * Project-scoped GitHub PAT CRUD (spec 109 §6).
 *
 * Same shape as factory_upstream_pats but keyed on project_id. Used when a
 * project lives in a GitHub org that does NOT have the OAP App installed —
 * the installation-token broker can't produce credentials for external orgs,
 * so the operator drops in a project-scoped PAT for that project's
 * clone/push/create-repo operations.
 *
 * Permission model: either the caller is an org admin/owner on the parent
 * org, or they hold role='admin' on project_members for this project. Org
 * admins can always configure the PAT; project admins can configure their
 * own project without bothering an org admin.
 */

import { api, APIError } from "encore.dev/api";
import log from "encore.dev/log";
import { getAuthData } from "~encore/auth";
import { and, eq } from "drizzle-orm";
import { db } from "../db/drizzle";
import {
  auditLog,
  projectGithubPats,
  projectMembers,
  projects,
} from "../db/schema";
import { hasOrgPermission } from "../auth/membership";
import { encryptPat, decryptPat } from "../auth/patCrypto";
import { classifyFormat, probeGitHub, tokenPrefix } from "../auth/patProbe";
import { errorForLog } from "../auth/errorLog";

export interface ProjectPatMetadata {
  exists: boolean;
  tokenPrefix?: string;
  isFineGrained?: boolean;
  scopes?: string[];
  githubLogin?: string | null;
  lastUsedAt?: string | null;
  lastCheckedAt?: string;
  createdAt?: string;
}

export interface ProjectPatValidationResult {
  ok: boolean;
  tokenPrefix: string;
  isFineGrained: boolean;
  scopes: string[];
  lastCheckedAt: string;
  githubLogin?: string;
  reason?: "pat_invalid" | "pat_rate_limited" | "pat_saml_not_authorized";
}

async function requireProjectAdmin(
  projectId: string,
  auth: ReturnType<typeof getAuthData> extends infer T ? NonNullable<T> : never
): Promise<void> {
  const [project] = await db
    .select({ id: projects.id })
    .from(projects)
    .where(
      and(eq(projects.id, projectId), eq(projects.orgId, auth.orgId))
    )
    .limit(1);

  if (!project) throw APIError.notFound("project not found");

  if (hasOrgPermission(auth.platformRole, "factory:configure")) return;

  const [membership] = await db
    .select({ role: projectMembers.role })
    .from(projectMembers)
    .where(
      and(
        eq(projectMembers.projectId, projectId),
        eq(projectMembers.userId, auth.userID)
      )
    )
    .limit(1);

  if (membership?.role === "admin") return;

  throw APIError.permissionDenied(
    "Only project or org admins can manage the project GitHub PAT"
  );
}

// ---------------------------------------------------------------------------
// GET /api/projects/:projectId/pat — metadata only
// ---------------------------------------------------------------------------

export const getProjectPat = api(
  {
    expose: true,
    auth: true,
    method: "GET",
    path: "/api/projects/:projectId/pat",
  },
  async ({ projectId }: { projectId: string }): Promise<ProjectPatMetadata> => {
    const auth = getAuthData()!;
    await requireProjectAdmin(projectId, auth);

    const [row] = await db
      .select()
      .from(projectGithubPats)
      .where(eq(projectGithubPats.projectId, projectId))
      .limit(1);

    if (!row) return { exists: false };

    return {
      exists: true,
      tokenPrefix: row.tokenPrefix,
      isFineGrained: row.isFineGrained,
      scopes: row.scopes,
      githubLogin: row.githubLogin,
      lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
      lastCheckedAt: row.lastCheckedAt.toISOString(),
      createdAt: row.createdAt.toISOString(),
    };
  }
);

// ---------------------------------------------------------------------------
// POST /api/projects/:projectId/pat — store/replace
// ---------------------------------------------------------------------------

interface StoreProjectPatRequest {
  projectId: string;
  token: string;
}

export const storeProjectPat = api<
  StoreProjectPatRequest,
  ProjectPatValidationResult
>(
  {
    expose: true,
    auth: true,
    method: "POST",
    path: "/api/projects/:projectId/pat",
  },
  async (req) => {
    const auth = getAuthData()!;
    await requireProjectAdmin(req.projectId, auth);

    const token = (req.token ?? "").trim();
    if (!token) {
      throw APIError.invalidArgument("token is required");
    }

    const fmt = classifyFormat(token);
    if (!fmt) {
      throw APIError.invalidArgument(
        "Unrecognised token format. Expected a GitHub PAT (ghp_*, github_pat_*, ghs_*, gho_*, or ghu_*)"
      );
    }

    let probe: Awaited<ReturnType<typeof probeGitHub>>;
    try {
      probe = await probeGitHub(token);
    } catch (err) {
      log.warn("project PAT probe failed", {
        projectId: req.projectId,
        error: errorForLog(err),
      });
      throw APIError.unavailable("Could not reach GitHub to validate token");
    }

    const now = new Date();
    const prefix = tokenPrefix(token);

    if (!probe.ok) {
      return {
        ok: false,
        tokenPrefix: prefix,
        isFineGrained: fmt.isFineGrained,
        scopes: [],
        lastCheckedAt: now.toISOString(),
        reason: probe.reason,
      };
    }

    let tokenEnc: Buffer;
    let tokenNonce: Buffer;
    try {
      ({ tokenEnc, tokenNonce } = encryptPat(token));
    } catch (err) {
      log.error("project PAT encryption failed", {
        projectId: req.projectId,
        error: errorForLog(err),
      });
      throw APIError.internal(
        "PAT encryption is not configured (set the PAT_ENCRYPTION_KEY secret)"
      );
    }

    await db
      .insert(projectGithubPats)
      .values({
        projectId: req.projectId,
        tokenEnc,
        tokenNonce,
        tokenPrefix: prefix,
        scopes: probe.scopes,
        isFineGrained: fmt.isFineGrained,
        githubLogin: probe.githubLogin,
        lastCheckedAt: now,
        createdBy: auth.userID,
      })
      .onConflictDoUpdate({
        target: projectGithubPats.projectId,
        set: {
          tokenEnc,
          tokenNonce,
          tokenPrefix: prefix,
          scopes: probe.scopes,
          isFineGrained: fmt.isFineGrained,
          githubLogin: probe.githubLogin,
          lastCheckedAt: now,
          lastUsedAt: null,
          createdBy: auth.userID,
          updatedAt: now,
        },
      });

    await db.insert(auditLog).values({
      actorUserId: auth.userID,
      action: "pat.project.stored",
      targetType: "project_github_pats",
      targetId: req.projectId,
      metadata: {
        prefix,
        is_fine_grained: fmt.isFineGrained,
        scopes: probe.scopes,
        github_login: probe.githubLogin,
      },
    });

    return {
      ok: true,
      tokenPrefix: prefix,
      isFineGrained: fmt.isFineGrained,
      scopes: probe.scopes,
      lastCheckedAt: now.toISOString(),
      githubLogin: probe.githubLogin,
    };
  }
);

// ---------------------------------------------------------------------------
// DELETE /api/projects/:projectId/pat — hard delete
// ---------------------------------------------------------------------------

export const revokeProjectPat = api(
  {
    expose: true,
    auth: true,
    method: "DELETE",
    path: "/api/projects/:projectId/pat",
  },
  async ({
    projectId,
  }: {
    projectId: string;
  }): Promise<{ revoked: boolean }> => {
    const auth = getAuthData()!;
    await requireProjectAdmin(projectId, auth);

    const deleted = await db
      .delete(projectGithubPats)
      .where(eq(projectGithubPats.projectId, projectId))
      .returning({ projectId: projectGithubPats.projectId });

    if (deleted.length === 0) return { revoked: false };

    await db.insert(auditLog).values({
      actorUserId: auth.userID,
      action: "pat.project.revoked",
      targetType: "project_github_pats",
      targetId: projectId,
      metadata: { reason: "user_requested" },
    });

    return { revoked: true };
  }
);

// ---------------------------------------------------------------------------
// POST /api/projects/:projectId/pat/validate — re-probe
// ---------------------------------------------------------------------------

export const validateProjectPat = api(
  {
    expose: true,
    auth: true,
    method: "POST",
    path: "/api/projects/:projectId/pat/validate",
  },
  async ({
    projectId,
  }: {
    projectId: string;
  }): Promise<ProjectPatValidationResult> => {
    const auth = getAuthData()!;
    await requireProjectAdmin(projectId, auth);

    const [row] = await db
      .select()
      .from(projectGithubPats)
      .where(eq(projectGithubPats.projectId, projectId))
      .limit(1);

    if (!row) {
      throw APIError.notFound("No project PAT configured");
    }

    let token: string;
    try {
      token = decryptPat(row.tokenEnc, row.tokenNonce);
    } catch (err) {
      log.error("project PAT decryption failed", {
        projectId,
        error: errorForLog(err),
      });
      throw APIError.internal("Stored token could not be decrypted");
    }

    let probe: Awaited<ReturnType<typeof probeGitHub>>;
    try {
      probe = await probeGitHub(token);
    } catch (err) {
      log.warn("project PAT re-probe failed", {
        projectId,
        error: errorForLog(err),
      });
      throw APIError.unavailable("Could not reach GitHub");
    }

    const now = new Date();

    if (!probe.ok) {
      await db
        .update(projectGithubPats)
        .set({ lastCheckedAt: now, updatedAt: now })
        .where(eq(projectGithubPats.projectId, projectId));

      return {
        ok: false,
        tokenPrefix: row.tokenPrefix,
        isFineGrained: row.isFineGrained,
        scopes: row.scopes,
        lastCheckedAt: now.toISOString(),
        reason: probe.reason,
      };
    }

    await db
      .update(projectGithubPats)
      .set({
        lastCheckedAt: now,
        scopes: probe.scopes,
        githubLogin: probe.githubLogin,
        updatedAt: now,
      })
      .where(eq(projectGithubPats.projectId, projectId));

    return {
      ok: true,
      tokenPrefix: row.tokenPrefix,
      isFineGrained: row.isFineGrained,
      scopes: probe.scopes,
      lastCheckedAt: now.toISOString(),
      githubLogin: probe.githubLogin,
    };
  }
);

// ---------------------------------------------------------------------------
// Internal helper — used by repo operations to resolve a token for a project.
// Returns plaintext token or null if no PAT on file. Stamps last_used_at.
// ---------------------------------------------------------------------------

export async function loadProjectPatToken(
  projectId: string
): Promise<string | null> {
  const [row] = await db
    .select()
    .from(projectGithubPats)
    .where(eq(projectGithubPats.projectId, projectId))
    .limit(1);

  if (!row) return null;

  let token: string;
  try {
    token = decryptPat(row.tokenEnc, row.tokenNonce);
  } catch (err) {
    log.error("project PAT decryption failed during load", {
      projectId,
      error: errorForLog(err),
    });
    throw new Error(
      "project PAT could not be decrypted — check PAT_ENCRYPTION_KEY and that the stored nonce/ciphertext have not been tampered with"
    );
  }
  await db
    .update(projectGithubPats)
    .set({ lastUsedAt: new Date() })
    .where(eq(projectGithubPats.projectId, projectId));
  return token;
}
