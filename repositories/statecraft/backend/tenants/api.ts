/**
 * Tenant + installation API (spec 004 §3). All endpoints sit under /api/v1 and
 * require auth; the Gateway authHandler (backend/auth) has already populated
 * AuthData, and `auth.userID` is the owner for every read and write. Ownership
 * is enforced on every :id path: a tenant the caller does not own reads as a
 * 404 (existence is not leaked).
 */
import { APIError, api } from "encore.dev/api";
import { getAuthData } from "~encore/auth";

import { authorizeTenant, listAccessibleTenants, principalFrom } from "./access/authz";
import { GITHUB_APP_SLUG, githubWebhookSecret } from "./config";
import { Installation, Tenant } from "./entities";
import { listInstallationRepos } from "./github-app";
import { signState } from "./state";
import {
  activeInstallationForTenant,
  listInstallationsForTenant,
  tenants,
} from "./store";

export interface TenantView {
  id: string;
  name: string;
  ownerUserId: string;
  createdAt: string;
}

export interface InstallationView {
  id: string;
  tenantId: string;
  githubOrg: string;
  installationId: string;
  status: string;
  createdAt: string;
  updatedAt: string;
}

export interface RepoView {
  id: number;
  name: string;
  fullName: string;
  private: boolean;
  htmlUrl: string;
}

function toTenantView(t: Tenant): TenantView {
  return {
    id: t.id,
    name: t.name,
    ownerUserId: t.ownerUserId,
    createdAt: t.createdAt.toISOString(),
  };
}

function toInstallationView(i: Installation): InstallationView {
  return {
    id: i.id,
    tenantId: i.tenantId,
    githubOrg: i.githubOrg,
    installationId: i.installationId,
    status: i.status,
    createdAt: i.createdAt.toISOString(),
    updatedAt: i.updatedAt.toISOString(),
  };
}

interface CreateTenantRequest {
  name: string;
}

/** POST /api/v1/tenants: create a tenant; the creator becomes its owner. */
export const create = api(
  { expose: true, auth: true, method: "POST", path: "/api/v1/tenants" },
  async ({ name }: CreateTenantRequest): Promise<TenantView> => {
    const auth = getAuthData()!;
    const trimmed = (name ?? "").trim();
    if (trimmed.length === 0) throw APIError.invalidArgument("tenant name is required");
    if (trimmed.length > 100) throw APIError.invalidArgument("tenant name is too long");

    const now = new Date();
    const tenant = Object.assign(new Tenant(), {
      name: trimmed,
      ownerUserId: auth.userID,
      createdAt: now,
    });
    await tenants().insert(tenant);
    return toTenantView(tenant);
  },
);

interface ListTenantsResponse {
  tenants: TenantView[];
}

/** GET /api/v1/tenants: the caller's own tenants. */
export const list = api(
  { expose: true, auth: true, method: "GET", path: "/api/v1/tenants" },
  async (): Promise<ListTenantsResponse> => {
    const auth = getAuthData()!;
    const rows = await listAccessibleTenants(principalFrom(auth));
    return { tenants: rows.map(toTenantView) };
  },
);

interface TenantDetailResponse {
  tenant: TenantView;
  installations: InstallationView[];
}

/** GET /api/v1/tenants/:id: a tenant plus its installations. */
export const detail = api(
  { expose: true, auth: true, method: "GET", path: "/api/v1/tenants/:id" },
  async ({ id }: { id: string }): Promise<TenantDetailResponse> => {
    const auth = getAuthData()!;
    const tenant = await authorizeTenant(id, principalFrom(auth), "read");
    if (!tenant) throw APIError.notFound("tenant not found");
    const rows = await listInstallationsForTenant(id);
    return { tenant: toTenantView(tenant), installations: rows.map(toInstallationView) };
  },
);

interface InstallUrlResponse {
  url: string;
}

/**
 * GET /api/v1/tenants/:id/github/install-url: the App installation URL, with a
 * signed `state` binding this tenant + user so the setup callback can attribute
 * the resulting installation back to them.
 */
export const installUrl = api(
  { expose: true, auth: true, method: "GET", path: "/api/v1/tenants/:id/github/install-url" },
  async ({ id }: { id: string }): Promise<InstallUrlResponse> => {
    const auth = getAuthData()!;
    const tenant = await authorizeTenant(id, principalFrom(auth), "read");
    if (!tenant) throw APIError.notFound("tenant not found");
    const state = signState(githubWebhookSecret(), { tenantId: id, userId: auth.userID });
    const url = `https://github.com/apps/${GITHUB_APP_SLUG}/installations/new?state=${encodeURIComponent(state)}`;
    return { url };
  },
);

interface ReposResponse {
  repos: RepoView[];
}

/**
 * GET /api/v1/tenants/:id/repos: repositories visible to the tenant's active
 * installation. 412 when no installation has been completed yet.
 */
export const repos = api(
  { expose: true, auth: true, method: "GET", path: "/api/v1/tenants/:id/repos" },
  async ({ id }: { id: string }): Promise<ReposResponse> => {
    const auth = getAuthData()!;
    const tenant = await authorizeTenant(id, principalFrom(auth), "read");
    if (!tenant) throw APIError.notFound("tenant not found");
    const installation = await activeInstallationForTenant(id);
    if (!installation) {
      throw APIError.failedPrecondition("tenant has no active GitHub App installation");
    }
    const list = await listInstallationRepos(installation.installationId);
    return { repos: list };
  },
);
