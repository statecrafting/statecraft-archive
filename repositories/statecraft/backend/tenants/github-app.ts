/**
 * GitHub App REST access (spec 004 §3).
 *
 * Two credentials are in play. An App JWT (RS256, signed by the App private
 * key, `iss` = App ID, <=10 min) authenticates App-level calls: reading an
 * installation, and minting installation access tokens. An installation access
 * token (60 min lifetime) authenticates calls scoped to one org's installation:
 * listing repositories, and everything the factory (spec 005) will do. We cache
 * installation tokens in hiqlite KV (~50 min TTL) so a burst of factory work
 * does not re-mint on every call.
 *
 * No Octokit: plain fetch against api.github.com with the pinned API version,
 * which keeps the surface small and auditable (spec 004 §3). The token helper
 * is exported for the factory to consume.
 */
import jwt from "jsonwebtoken";

import hiqlite, { ready as hiqReady } from "../hiq/init";
import { logError } from "../lib/logger";

import {
  GITHUB_API_BASE,
  GITHUB_API_VERSION,
  githubAppId,
  githubPrivateKeyPem,
} from "./config";

const APP_JWT_TTL_SECONDS = 9 * 60; // under GitHub's 10-min ceiling, with margin
const APP_JWT_BACKDATE_SECONDS = 30; // tolerate minor clock skew against GitHub
const TOKEN_CACHE_TTL_SECONDS = 50 * 60; // tokens live 60 min; refresh before then
const TOKEN_REFRESH_BUFFER_SECONDS = 5 * 60;

export interface InstallationInfo {
  id: number;
  account: { login: string; type: string } | null;
}

export interface InstallationTokenResponse {
  token: string;
  expires_at: string;
}

export interface Repo {
  id: number;
  name: string;
  fullName: string;
  private: boolean;
  htmlUrl: string;
}

class MissingCredentialsError extends Error {
  constructor() {
    super("GitHub App credentials are not configured (GITHUB_APP_ID / GITHUB_APP_PRIVATE_KEY_B64)");
    this.name = "MissingCredentialsError";
  }
}

/** Mint a short-lived App JWT. Throws if the App credentials are absent. */
export function mintAppJwt(): string {
  const appId = githubAppId();
  const pem = githubPrivateKeyPem();
  if (!appId || !pem) throw new MissingCredentialsError();
  const now = Math.floor(Date.now() / 1000);
  return jwt.sign(
    { iat: now - APP_JWT_BACKDATE_SECONDS, exp: now + APP_JWT_TTL_SECONDS, iss: appId },
    pem,
    { algorithm: "RS256" },
  );
}

interface GithubCallOptions {
  method?: string;
  auth: string; // full Authorization header value
  body?: unknown;
}

async function githubCall<T>(path: string, opts: GithubCallOptions): Promise<T> {
  const res = await fetch(`${GITHUB_API_BASE}${path}`, {
    method: opts.method ?? "GET",
    headers: {
      Authorization: opts.auth,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": GITHUB_API_VERSION,
      "User-Agent": "statecraft-control-plane",
      ...(opts.body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  if (!res.ok) {
    // Body may carry a GitHub error message; keep it short and never log tokens.
    const detail = (await res.text().catch(() => "")).slice(0, 200);
    throw new Error(`GitHub ${opts.method ?? "GET"} ${path} failed: ${res.status} ${detail}`);
  }
  return (await res.json()) as T;
}

/** Read an installation by id via an App JWT (verifies it exists; yields org). */
export async function getInstallation(installationId: string): Promise<InstallationInfo> {
  return githubCall<InstallationInfo>(`/app/installations/${encodeURIComponent(installationId)}`, {
    auth: `Bearer ${mintAppJwt()}`,
  });
}

function cacheKey(installationId: string): string {
  return `github:installation-token:${installationId}`;
}

/**
 * An installation access token, minted via the App JWT and cached in hiqlite
 * KV. On a cache hit the stored token is returned; otherwise a fresh one is
 * minted and cached until shortly before expiry. Exported for the factory.
 */
export async function getInstallationToken(installationId: string): Promise<string> {
  try {
    await hiqReady;
    const cached = await hiqlite.kvGet(cacheKey(installationId));
    if (cached) return cached;
  } catch {
    // Cache unavailable: fall through and mint a fresh token.
  }

  const minted = await githubCall<InstallationTokenResponse>(
    `/app/installations/${encodeURIComponent(installationId)}/access_tokens`,
    { method: "POST", auth: `Bearer ${mintAppJwt()}` },
  );

  const ttl = cacheTtlFromExpiry(minted.expires_at);
  if (ttl > 0) {
    try {
      await hiqReady;
      await hiqlite.kvPut(cacheKey(installationId), minted.token, ttl);
    } catch {
      logError("tenants.token_cache_write_failed", { installationId });
    }
  }
  return minted.token;
}

function cacheTtlFromExpiry(expiresAt: string): number {
  const parsed = Date.parse(expiresAt);
  if (Number.isNaN(parsed)) return TOKEN_CACHE_TTL_SECONDS;
  const seconds = Math.floor((parsed - Date.now()) / 1000) - TOKEN_REFRESH_BUFFER_SECONDS;
  return Math.max(0, Math.min(TOKEN_CACHE_TTL_SECONDS, seconds));
}

interface RawRepo {
  id: number;
  name: string;
  full_name: string;
  private: boolean;
  html_url: string;
}

/** Repositories visible to an installation (first page, up to 100). */
export async function listInstallationRepos(installationId: string): Promise<Repo[]> {
  const token = await getInstallationToken(installationId);
  const data = await githubCall<{ repositories: RawRepo[] }>(
    "/installation/repositories?per_page=100",
    { auth: `Bearer ${token}` },
  );
  return (data.repositories ?? []).map((r) => ({
    id: r.id,
    name: r.name,
    fullName: r.full_name,
    private: r.private,
    htmlUrl: r.html_url,
  }));
}
