/**
 * Tenant lifecycle + operator API (spec 011 §5.4-§5.8). These endpoints live in
 * the tenants service alongside spec 004's, adding the exit surfaces (uninstall,
 * delete), the tenant-less self-serve install URL, and the operator console's
 * backing verbs. Every tenant-scoped verb routes through `authorizeTenant`
 * (spec 011 §3); the operator verbs gate on `statecraft_operator`.
 */
import { APIError, api } from "encore.dev/api";
import { getAuthData } from "~encore/auth";
import { fleet } from "~encore/clients";

import { requireRole } from "../../lib/roles";
import { GITHUB_APP_SLUG, githubWebhookSecret } from "../config";
import type { Installation } from "../entities";
import { signState } from "../state";
import { getTenant, listAllTenants, listInstallationsForTenant } from "../store";

import { authorizeTenant, OPERATOR_ROLE, principalFrom } from "./authz";
import type { MembershipRole, TenantMembership } from "./entities";
import { deleteTenant, uninstallForTenant } from "./lifecycle";
import {
  listMembershipsForTenant,
  removeMembership,
  upsertMembership,
} from "./store";

interface InstallationView {
  id: string;
  tenantId: string;
  githubOrg: string;
  installationId: string;
  status: string;
  createdAt: string;
  updatedAt: string;
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

interface MembershipView {
  id: string;
  tenantId: string;
  githubUserId: string | null;
  userAccountId: string | null;
  role: string;
  source: string;
  createdAt: string;
  updatedAt: string;
}

function toMembershipView(m: TenantMembership): MembershipView {
  return {
    id: m.id,
    tenantId: m.tenantId,
    githubUserId: m.githubUserId,
    userAccountId: m.userAccountId,
    role: m.role,
    source: m.source,
    createdAt: m.createdAt.toISOString(),
    updatedAt: m.updatedAt.toISOString(),
  };
}

interface InstallUrlResponse {
  url: string;
}

/**
 * GET /api/v1/github/install-url (spec 011 §5.6): the tenant-less install URL.
 * Its signed state binds only the user; the setup callback, seeing no tenant,
 * creates one named after the org the user chose.
 */
export const installUrlForUser = api(
  { expose: true, auth: true, method: "GET", path: "/api/v1/github/install-url" },
  async (): Promise<InstallUrlResponse> => {
    const auth = getAuthData()!;
    const state = signState(githubWebhookSecret(), { tenantId: "", userId: auth.userID });
    const url = `https://github.com/apps/${GITHUB_APP_SLUG}/installations/new?state=${encodeURIComponent(state)}`;
    return { url };
  },
);

interface TenantIdParams {
  id: string;
}

/**
 * DELETE /api/v1/tenants/:id/github/installation (spec 011 §5.4): uninstall the
 * tenant's active installation. Teardown never gates on linkage; requires
 * tenant-admin (write) access.
 */
export const uninstall = api(
  { expose: true, auth: true, method: "DELETE", path: "/api/v1/tenants/:id/github/installation" },
  async ({ id }: TenantIdParams): Promise<InstallationView> => {
    const auth = getAuthData()!;
    const tenant = await authorizeTenant(id, principalFrom(auth), "write");
    if (!tenant) throw APIError.notFound("tenant not found");
    const inst = await uninstallForTenant(id);
    if (!inst) throw APIError.failedPrecondition("tenant has no active installation");
    return toInstallationView(inst);
  },
);

interface DeleteTenantRequest {
  id: string;
  /** Must equal the tenant name (spec 011 §5.5 destructive guard). */
  confirm: string;
}

interface DeleteTenantResponse {
  deleted: boolean;
}

/**
 * DELETE /api/v1/tenants/:id (spec 011 §5.5): delete a tenant. Requires
 * tenant-admin (write) access and the typed name confirmation; runs through the
 * action gate and writes an attestation.
 */
export const removeTenant = api(
  { expose: true, auth: true, method: "DELETE", path: "/api/v1/tenants/:id" },
  async ({ id, confirm }: DeleteTenantRequest): Promise<DeleteTenantResponse> => {
    const auth = getAuthData()!;
    const tenant = await authorizeTenant(id, principalFrom(auth), "write");
    if (!tenant) throw APIError.notFound("tenant not found");
    if ((confirm ?? "") !== tenant.name) {
      throw APIError.invalidArgument(`confirm must equal the tenant name "${tenant.name}"`);
    }
    await deleteTenant(tenant, `user:${auth.userID}`);
    return { deleted: true };
  },
);

interface OperatorTenantView {
  id: string;
  name: string;
  ownerUserId: string;
  createdAt: string;
  installationStatus: string;
  memberCount: number;
  fleetAppCount: number;
}

interface OperatorTenantsResponse {
  tenants: OperatorTenantView[];
}

function installationSummary(insts: Installation[]): string {
  if (insts.some((i) => i.status === "active")) return "active";
  if (insts.length === 0) return "none";
  return insts[insts.length - 1]!.status;
}

/**
 * GET /api/v1/operator/tenants (spec 011 §5.8): every tenant with installation
 * status, membership counts, and fleet app counts. Operator-only.
 */
export const operatorListTenants = api(
  { expose: true, auth: true, method: "GET", path: "/api/v1/operator/tenants" },
  async (): Promise<OperatorTenantsResponse> => {
    const auth = getAuthData()!;
    requireRole(auth, OPERATOR_ROLE);
    const all = await listAllTenants();
    const views: OperatorTenantView[] = [];
    for (const tenant of all) {
      const [insts, mems, summary] = await Promise.all([
        listInstallationsForTenant(tenant.id),
        listMembershipsForTenant(tenant.id),
        fleet.tenantAppSummary({ tenantId: tenant.id }),
      ]);
      views.push({
        id: tenant.id,
        name: tenant.name,
        ownerUserId: tenant.ownerUserId,
        createdAt: tenant.createdAt.toISOString(),
        installationStatus: installationSummary(insts),
        memberCount: mems.length,
        fleetAppCount: summary.activeCount,
      });
    }
    return { tenants: views };
  },
);

interface GrantMembershipRequest {
  id: string;
  githubUserId: string;
  role: string;
}

/**
 * POST /api/v1/operator/tenants/:id/memberships (spec 011 §5.8): manually grant
 * a membership. Operator grants are authoritative and reconciliation never
 * removes them. Operator-only.
 */
export const operatorGrantMembership = api(
  { expose: true, auth: true, method: "POST", path: "/api/v1/operator/tenants/:id/memberships" },
  async ({ id, githubUserId, role }: GrantMembershipRequest): Promise<MembershipView> => {
    const auth = getAuthData()!;
    requireRole(auth, OPERATOR_ROLE);
    const tenant = await getTenant(id);
    if (!tenant) throw APIError.notFound("tenant not found");
    const normalizedRole: MembershipRole | null =
      role === "admin" ? "admin" : role === "member" ? "member" : null;
    if (!normalizedRole) throw APIError.invalidArgument("role must be admin or member");
    const gh = (githubUserId ?? "").trim();
    if (!gh) throw APIError.invalidArgument("githubUserId is required");
    const membership = await upsertMembership({
      tenantId: id,
      githubUserId: gh,
      role: normalizedRole,
      source: "operator",
    });
    return toMembershipView(membership);
  },
);

interface RevokeMembershipRequest {
  id: string;
  githubUserId: string;
}

interface RevokeMembershipResponse {
  revoked: boolean;
}

/**
 * DELETE /api/v1/operator/tenants/:id/memberships (spec 011 §5.8): revoke a
 * membership by GitHub id. Operator-only.
 */
export const operatorRevokeMembership = api(
  { expose: true, auth: true, method: "DELETE", path: "/api/v1/operator/tenants/:id/memberships" },
  async ({ id, githubUserId }: RevokeMembershipRequest): Promise<RevokeMembershipResponse> => {
    const auth = getAuthData()!;
    requireRole(auth, OPERATOR_ROLE);
    const gh = (githubUserId ?? "").trim();
    if (!gh) throw APIError.invalidArgument("githubUserId is required");
    const revoked = await removeMembership(id, gh);
    return { revoked };
  },
);
