/**
 * Factory upstream token resolution (spec 109 §4).
 *
 * Precedence:
 *   1. factory_upstream_pats — org-scoped PAT, stored encrypted. If
 *      present it always wins, even if an installation also exists. A
 *      configured PAT that fails decryption is a hard error; we do not
 *      silently fall through to a weaker credential.
 *   2. github_installations — brokered installation token via the
 *      existing GitHub App path. Used when the upstream org happens to
 *      also have the OAP App installed (rare in practice).
 *   3. undefined — anonymous clone. Only works against public repos.
 *
 * This function does NOT throw on "no token available" — the sync worker
 * will try an anonymous clone and the authoritative error comes from git
 * if the upstream is private.
 */

import log from "encore.dev/log";
import { and, eq } from "drizzle-orm";
import { db } from "../db/drizzle";
import { githubInstallations } from "../db/schema";
import { brokerInstallationToken } from "../github/repoInit";
import { loadFactoryUpstreamPatToken } from "./upstreamPat";

export type ResolvedToken = {
  token: string;
  source: "factory_upstream_pat" | "github_installation";
} | null;

export async function resolveFactoryUpstreamToken(
  orgId: string
): Promise<ResolvedToken> {
  const patToken = await loadFactoryUpstreamPatToken(orgId);
  if (patToken) {
    return { token: patToken, source: "factory_upstream_pat" };
  }

  const [installation] = await db
    .select({
      installationId: githubInstallations.installationId,
    })
    .from(githubInstallations)
    .where(
      and(
        eq(githubInstallations.orgId, orgId),
        eq(githubInstallations.installationState, "active")
      )
    )
    .limit(1);

  if (!installation) return null;

  try {
    const { token } = await brokerInstallationToken(installation.installationId, {
      contents: "read",
      metadata: "read",
    });
    return { token, source: "github_installation" };
  } catch (err) {
    log.warn("factory sync: installation token broker failed", {
      orgId,
      err: String(err),
    });
    return null;
  }
}
