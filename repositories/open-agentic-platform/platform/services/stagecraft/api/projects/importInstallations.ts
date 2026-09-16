// Spec 112 §6.1 — App-installation picker support for the Statecraft Import UI.
//
// Lists every active OAP App installation registered for the caller's
// org and, for each, queries GitHub for the repos that installation
// can see (`GET /installation/repositories`). The Import route uses
// this to render a "pick a repo" picker; the URL-paste path remains
// available for repos in orgs without an installation.
//
// Repos are returned as `owner/name` plus the canonical `https://`
// URL the form's `repoUrl` field expects, so picking a row is a pure
// client-side substitution.

import { api, APIError } from "encore.dev/api";
import { getAuthData } from "~encore/auth";
import log from "encore.dev/log";
import { and, eq } from "drizzle-orm";
import { db } from "../db/drizzle";
import { githubInstallations } from "../db/schema";
import { hasOrgPermission } from "../auth/membership";
import { brokerInstallationToken } from "../github/repoInit";

const GITHUB_API = "https://api.github.com";
const API_VERSION = "2022-11-28";
const REPOS_PER_PAGE = 100;
const MAX_PAGES = 5;

export interface ImportInstallationRepo {
  owner: string;
  name: string;
  fullName: string;
  htmlUrl: string;
  cloneUrl: string;
  defaultBranch: string;
  isPrivate: boolean;
}

export interface ImportInstallationEntry {
  installationId: number;
  githubOrgLogin: string;
  /**
   * Set when listing the installation's repos failed (the row stays
   * in the response so the UI can show "couldn't list — try the URL
   * paste path"). Repos is empty in that case.
   */
  error: string | null;
  repos: ImportInstallationRepo[];
}

export interface ListImportInstallationsResponse {
  installations: ImportInstallationEntry[];
}

export const listImportInstallations = api(
  {
    expose: true,
    auth: true,
    method: "GET",
    path: "/api/projects/factory-import/installations",
  },
  async (): Promise<ListImportInstallationsResponse> => {
    const auth = getAuthData()!;
    if (!hasOrgPermission(auth.platformRole, "project:create")) {
      throw APIError.permissionDenied(
        "Insufficient permissions to import projects in this org"
      );
    }

    const rows = await db
      .select({
        installationId: githubInstallations.installationId,
        githubOrgLogin: githubInstallations.githubOrgLogin,
      })
      .from(githubInstallations)
      .where(
        and(
          eq(githubInstallations.orgId, auth.orgId),
          eq(githubInstallations.installationState, "active")
        )
      );

    const installations: ImportInstallationEntry[] = await Promise.all(
      rows.map(async (row) => {
        try {
          const repos = await listInstallationRepos(row.installationId);
          return {
            installationId: row.installationId,
            githubOrgLogin: row.githubOrgLogin,
            error: null,
            repos,
          };
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          log.warn("listImportInstallations: failed to enumerate repos", {
            installationId: row.installationId,
            githubOrgLogin: row.githubOrgLogin,
            error: message,
          });
          return {
            installationId: row.installationId,
            githubOrgLogin: row.githubOrgLogin,
            error: message,
            repos: [],
          };
        }
      })
    );

    installations.sort((a, b) =>
      a.githubOrgLogin.toLowerCase().localeCompare(b.githubOrgLogin.toLowerCase())
    );
    for (const install of installations) {
      install.repos.sort((a, b) =>
        a.fullName.toLowerCase().localeCompare(b.fullName.toLowerCase())
      );
    }

    return { installations };
  }
);

async function listInstallationRepos(
  installationId: number
): Promise<ImportInstallationRepo[]> {
  const { token } = await brokerInstallationToken(installationId, {
    contents: "read",
    metadata: "read",
  });

  const acc: ImportInstallationRepo[] = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const url =
      `${GITHUB_API}/installation/repositories` +
      `?per_page=${REPOS_PER_PAGE}&page=${page}`;
    const resp = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": API_VERSION,
      },
    });
    if (!resp.ok) {
      const body = await resp.text();
      throw new Error(
        `GitHub /installation/repositories failed: ${resp.status} ${body}`
      );
    }
    const data = (await resp.json()) as {
      total_count: number;
      repositories: Array<{
        owner: { login: string };
        name: string;
        full_name: string;
        html_url: string;
        clone_url: string;
        default_branch: string;
        private: boolean;
      }>;
    };
    for (const r of data.repositories) {
      acc.push({
        owner: r.owner.login,
        name: r.name,
        fullName: r.full_name,
        htmlUrl: r.html_url,
        cloneUrl: r.clone_url,
        defaultBranch: r.default_branch,
        isPrivate: r.private,
      });
    }
    if (data.repositories.length < REPOS_PER_PAGE) break;
  }
  return acc;
}
