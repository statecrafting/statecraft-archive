/**
 * Login-time org-role reconciliation (spec 011 §5.3).
 *
 * rauthy discards the upstream GitHub token at login (spec 011 §2), so org
 * roles cannot ride token claims; they are derived app-side through the GitHub
 * App's installation tokens (which spec 004 already grants org Members read).
 *
 * For a user with a resolved GitHub identity:
 *   1. attach pending membership rows (both identity sides) to this user;
 *   2. sweep every active installation and map the user's GitHub org role onto
 *      a tenant membership (admin -> admin, member -> member, absent -> row
 *      removed), never touching operator-granted rows.
 *
 * The sweep is bounded by the number of active installations, small in this
 * phase; a push-based org-webhook refinement rides later (spec 011 §8).
 */
import { GITHUB_API_BASE, GITHUB_API_VERSION } from "../config";
import { getInstallationToken } from "../github-app";
import { listAllActiveInstallations } from "../store";
import { logError, logInfo } from "../../lib/logger";

import type { MembershipRole } from "./entities";
import {
  attachGithubUserId,
  attachUserAccount,
  findMembership,
  removeMembership,
  upsertMembership,
} from "./store";

export interface ReconcileInput {
  userAccountId: string;
  githubUserId: string;
  githubLogin: string | null;
}

/** Pure: GitHub org role -> tenant membership role (spec 011 §5.2), or null if neither. */
export function membershipRoleForOrgRole(orgRole: string | undefined | null): MembershipRole | null {
  if (orgRole === "admin") return "admin";
  if (orgRole === "member") return "member";
  return null;
}

interface OrgMembership {
  state?: string;
  role?: string;
}

/**
 * The user's membership of one org via an installation token, or null when the
 * user is not a member (a 404). A non-404 error throws, so a transient failure
 * never masquerades as an authoritative "not a member" (which would remove the
 * row).
 */
async function fetchOrgMembership(
  org: string,
  login: string,
  installationId: string,
): Promise<OrgMembership | null> {
  const token = await getInstallationToken(installationId);
  const res = await fetch(
    `${GITHUB_API_BASE}/orgs/${encodeURIComponent(org)}/memberships/${encodeURIComponent(login)}`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": GITHUB_API_VERSION,
        "User-Agent": "statecraft-control-plane",
      },
    },
  );
  if (res.status === 404) return null;
  if (!res.ok) {
    const detail = (await res.text().catch(() => "")).slice(0, 200);
    throw new Error(`org membership ${org}/${login}: ${res.status} ${detail}`);
  }
  return (await res.json()) as OrgMembership;
}

export async function reconcileMemberships(input: ReconcileInput): Promise<void> {
  // Step 1: attach this user to any pending rows, learned from either side.
  await attachUserAccount(input.githubUserId, input.userAccountId);
  await attachGithubUserId(input.userAccountId, input.githubUserId);

  // Step 2 needs the login to query org membership; without it, stop after attach.
  if (!input.githubLogin) return;

  for (const inst of await listAllActiveInstallations()) {
    try {
      const om = await fetchOrgMembership(inst.githubOrg, input.githubLogin, inst.installationId);
      const existing = await findMembership(inst.tenantId, input.githubUserId);
      if (om && (om.state === "active" || om.state == null)) {
        if (existing?.source === "operator") continue; // operator grants are authoritative
        const role = membershipRoleForOrgRole(om.role) ?? "member";
        await upsertMembership({
          tenantId: inst.tenantId,
          githubUserId: input.githubUserId,
          userAccountId: input.userAccountId,
          role,
          source: "reconcile",
        });
      } else if (existing && existing.source !== "operator") {
        await removeMembership(inst.tenantId, input.githubUserId);
      }
    } catch (err) {
      logError("access.reconcile_install_failed", {
        installationId: inst.installationId,
        err: String(err),
      });
    }
  }
  logInfo("access.reconciled", { userAccountId: input.userAccountId });
}
