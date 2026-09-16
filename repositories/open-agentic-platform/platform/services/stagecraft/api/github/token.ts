import { api, APIError } from "encore.dev/api";
import { getAuthData } from "~encore/auth";
import log from "encore.dev/log";
import { db } from "../db/drizzle";
import { projectRepos, projects } from "../db/schema";
import { eq, and } from "drizzle-orm";
import { signAppJwt } from "./appJwt";

// Scope mapping per tool category
const SCOPE_MAP: Record<string, Record<string, string>> = {
  "contents:read": { contents: "read" },
  "issues:read": { issues: "read" },
  "pull_requests:read": { pull_requests: "read" },
  "metadata:read": { metadata: "read" },
  "checks:write": { checks: "write" },
  "actions:write": { actions: "write" },
};

interface TokenRequest {
  repo: string;  // "owner/name"
  scope: string; // e.g. "contents:read"
}

interface TokenResponse {
  token: string;
  expires_at: string;
  permissions: Record<string, string>;
}

// POST /api/github/token: broker a scoped installation token
export const getToken = api(
  { expose: true, method: "POST", path: "/api/github/token", auth: true },
  async (req: TokenRequest): Promise<TokenResponse> => {
    const auth = getAuthData()!;
    const [owner, name] = req.repo.split("/");
    if (!owner || !name) {
      throw APIError.invalidArgument("repo must be owner/name format");
    }

    // Look up the installation ID from projectRepos, scoped to a repo whose
    // owning project belongs to the caller's org. Without this join, any
    // authenticated user (of any org) could mint a write-capable
    // (actions:write / checks:write) GitHub App token for a repo owned by
    // another tenant simply by naming its owner/repo.
    const rows = await db
      .select({ githubInstallId: projectRepos.githubInstallId })
      .from(projectRepos)
      .innerJoin(projects, eq(projectRepos.projectId, projects.id))
      .where(
        and(
          eq(projectRepos.githubOrg, owner),
          eq(projectRepos.repoName, name),
          eq(projects.orgId, auth.orgId)
        )
      )
      .limit(1);

    let installationId: number | null = null;
    if (rows.length > 0 && rows[0].githubInstallId != null) {
      installationId = rows[0].githubInstallId;
    }

    // Fall back to environment variable for local dev / bootstrap only.
    // Guarded to non-production so it cannot be used to cross a tenant
    // boundary once the platform is deployed live: without this guard, a
    // caller whose org does not own the requested repo (the lookup above
    // returned no row) would still receive a token scoped to whatever
    // installation GITHUB_INSTALLATION_ID happens to point at.
    if (installationId == null) {
      if (process.env.NODE_ENV === "production") {
        throw APIError.notFound(
          `No GitHub App installation found for repo ${req.repo} in your organization`
        );
      }
      const envId = process.env.GITHUB_INSTALLATION_ID;
      if (!envId) {
        throw APIError.notFound(
          `No GitHub App installation found for repo ${req.repo}`
        );
      }
      installationId = parseInt(envId, 10);
    }

    // Sign JWT as the GitHub App
    const jwt = await signAppJwt();

    // Exchange for a scoped installation token
    const permissions = SCOPE_MAP[req.scope] ?? { metadata: "read" };
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
      throw new Error(`GitHub token exchange failed: ${resp.status} ${body}`);
    }

    const data = (await resp.json()) as {
      token: string;
      expires_at: string;
      permissions: Record<string, string>;
    };

    log.info("GitHub installation token issued", {
      repo: req.repo,
      scope: req.scope,
    });

    return {
      token: data.token,
      expires_at: data.expires_at,
      permissions: data.permissions,
    };
  }
);

