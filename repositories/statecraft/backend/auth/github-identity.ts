/**
 * GitHub identity resolution for a rauthy-federated app user (spec 011 §5.1).
 *
 * rauthy stores the upstream GitHub account id as `federation_uid` on the user
 * row and exposes it only through its admin API, never in token claims (spec
 * 011 §2). So the numeric id is resolved server-side through the embedded
 * rauthy admin API (a dedicated `RAUTHY_API_KEY`, read-users scope), and the
 * login from the numeric id through the GitHub API (the `preferred_username`
 * claim when captured, else `GET /user/{id}` unauthenticated). Non-federated
 * accounts (the bootstrap admin, the mock driver) keep both columns null and
 * skip everything downstream.
 *
 * This module also hosts the login-time membership sync and the explicit
 * refresh endpoint, keeping the one cross-service edge one-directional
 * (auth -> tenants; tenants never imports auth).
 */
import { APIError, api } from "encore.dev/api";
import { secret } from "encore.dev/config";
import { getAuthData } from "~encore/auth";

import { logError, logInfo } from "../lib/logger";
import { GITHUB_API_BASE, GITHUB_API_VERSION } from "../tenants/config";
import { reconcileMemberships } from "../tenants/access/reconcile";

import { UserAccount } from "./entities";
import { dbReady, ledger } from "./store";
import { getUserById } from "./user-model";

const rauthyApiKeySecret = secret("RAUTHY_API_KEY");

/** The rauthy admin API key: the Encore secret, falling back to env in dev. */
function rauthyApiKey(): string {
  const v = rauthyApiKeySecret().trim();
  return v || (process.env.RAUTHY_API_KEY ?? "").trim();
}

/**
 * The rauthy admin base. Server-to-server calls reach the co-resident rauthy
 * directly (the same upstream the idp proxy streams to), not through the public
 * issuer, so this is independent of the OIDC redirect topology.
 */
function rauthyAdminBase(): string {
  const upstream = process.env.RAUTHY_UPSTREAM ?? "http://127.0.0.1:8081";
  return `${upstream.replace(/\/+$/, "")}/auth/v1`;
}

interface RauthyUser {
  id: string;
  federation_uid?: string | null;
  auth_provider_id?: string | null;
}

/** The GitHub numeric id (federation_uid) for a rauthy user, or null. */
async function fetchFederationUid(rauthyUserId: string): Promise<string | null> {
  const key = rauthyApiKey();
  if (!key) {
    logInfo("auth.github_identity.no_api_key");
    return null;
  }
  const res = await fetch(`${rauthyAdminBase()}/users/${encodeURIComponent(rauthyUserId)}`, {
    headers: { Authorization: `API-Key ${key}`, Accept: "application/json" },
  });
  if (!res.ok) {
    const detail = (await res.text().catch(() => "")).slice(0, 200);
    throw new Error(`rauthy admin user ${rauthyUserId}: ${res.status} ${detail}`);
  }
  const user = (await res.json()) as RauthyUser;
  return user.federation_uid ?? null;
}

/** The GitHub login for a numeric id (unauthenticated GET /user/{id}), or null. */
async function fetchGithubLogin(githubUserId: string): Promise<string | null> {
  const res = await fetch(`${GITHUB_API_BASE}/user/${encodeURIComponent(githubUserId)}`, {
    headers: {
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": GITHUB_API_VERSION,
      "User-Agent": "statecraft-control-plane",
    },
  });
  if (!res.ok) return null;
  const user = (await res.json()) as { login?: string };
  return user.login ?? null;
}

export interface ResolvedIdentity {
  githubUserId: string | null;
  githubLogin: string | null;
}

/**
 * Resolve and persist a federated user's GitHub identity onto `user_account`.
 * Idempotent: an already-resolved row is returned as-is. Best-effort at the
 * call site; the network failures throw here so the caller can log them.
 */
export async function resolveGithubIdentity(
  user: UserAccount,
  opts: { preferredUsername?: string } = {},
): Promise<ResolvedIdentity> {
  if (user.ssoProvider !== "rauthy" || !user.ssoProviderId) {
    return { githubUserId: null, githubLogin: null };
  }
  if (user.githubUserId) {
    return { githubUserId: user.githubUserId, githubLogin: user.githubLogin };
  }
  const githubUserId = await fetchFederationUid(user.ssoProviderId);
  if (!githubUserId) return { githubUserId: null, githubLogin: null };
  let login = opts.preferredUsername?.trim() || null;
  if (!login) login = await fetchGithubLogin(githubUserId);
  await dbReady;
  await ledger()
    .repo(UserAccount)
    .updateById(user.id, { githubUserId, githubLogin: login, updatedAt: new Date() });
  logInfo("auth.github_identity.resolved", { userId: user.id });
  return { githubUserId, githubLogin: login };
}

/**
 * Login-time hook: resolve the GitHub identity, then reconcile org-derived
 * memberships (spec 011 §5.1, §5.3). Best-effort and never throws, so a slow or
 * failing GitHub/rauthy call never breaks login.
 */
export async function syncFederatedMemberships(
  user: UserAccount,
  opts: { preferredUsername?: string } = {},
): Promise<void> {
  try {
    const identity = await resolveGithubIdentity(user, opts);
    if (identity.githubUserId) {
      await reconcileMemberships({
        userAccountId: user.id,
        githubUserId: identity.githubUserId,
        githubLogin: identity.githubLogin,
      });
    }
  } catch (err) {
    logError("auth.github_identity.sync_failed", { userId: user.id, err: String(err) });
  }
}

interface ReconcileResponse {
  ok: boolean;
}

/**
 * POST /api/v1/auth/reconcile (spec 011 §5.3): an explicit membership refresh
 * for the caller. Re-resolves identity if needed, then sweeps installations.
 */
export const reconcile = api(
  { expose: true, auth: true, method: "POST", path: "/api/v1/auth/reconcile" },
  async (): Promise<ReconcileResponse> => {
    const auth = getAuthData()!;
    const user = await getUserById(auth.userID);
    if (!user) throw APIError.notFound("user not found");
    await syncFederatedMemberships(user);
    return { ok: true };
  },
);
