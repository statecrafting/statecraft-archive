/**
 * Project GitHub token resolution (spec 109 §6).
 *
 * Precedence:
 *   1. If the target GitHub org has an active installation for this OAP
 *      org, broker an installation token — that's the preferred path
 *      because the App grant is revocable at the org level.
 *   2. Otherwise, fall back to project_github_pats. Used when the target
 *      repo lives in an external org (the OAP App isn't — and often can't
 *      be — installed there).
 *   3. Return null for public-read anonymous clone. git will surface an
 *      authoritative error if the repo is private.
 *
 * Callers pass the target `githubOrgLogin` because only they know which
 * org the about-to-happen clone/create is targeted at.
 */

import log from "encore.dev/log";
import { and, eq } from "drizzle-orm";
import { db } from "../db/drizzle";
import { githubInstallations } from "../db/schema";
import { brokerInstallationToken } from "../github/repoInit";
import { loadProjectPatToken } from "./projectPat";

export type ResolvedProjectToken = {
  token: string;
  source: "github_installation" | "project_github_pat";
  /**
   * ISO-8601 expiry for installation tokens (~1h TTL); null for PATs
   * which do not expire on a server-driven schedule. Spec 112 §6.4.4
   * uses this to drive OPC's refresh window.
   */
  expiresAt: Date | null;
} | null;

export async function resolveProjectToken(args: {
  orgId: string;
  projectId: string;
  targetGithubOrgLogin: string;
  permissions?: Record<string, string>;
}): Promise<ResolvedProjectToken> {
  const [installation] = await db
    .select({
      installationId: githubInstallations.installationId,
      githubOrgLogin: githubInstallations.githubOrgLogin,
    })
    .from(githubInstallations)
    .where(
      and(
        eq(githubInstallations.orgId, args.orgId),
        eq(githubInstallations.installationState, "active"),
        eq(githubInstallations.githubOrgLogin, args.targetGithubOrgLogin)
      )
    )
    .limit(1);

  if (installation) {
    try {
      const { token, expiresAt } = await brokerInstallationToken(
        installation.installationId,
        args.permissions ?? { contents: "read", metadata: "read" }
      );
      return { token, source: "github_installation", expiresAt };
    } catch (err) {
      log.warn(
        "project token: installation broker failed, falling back to project PAT",
        { orgId: args.orgId, projectId: args.projectId, err: String(err) }
      );
    }
  }

  const patToken = await loadProjectPatToken(args.projectId);
  if (patToken) {
    return { token: patToken, source: "project_github_pat", expiresAt: null };
  }

  return null;
}
