/**
 * Agent catalog SSR API helpers.
 *
 * Spec 123: agents are org-scoped; projects consume via bindings.
 *
 * Two families of helpers:
 *
 * 1. **Org-scoped** (spec 123 §5.1): `listOrgAgents`, `getOrgAgent`,
 *    `createOrgAgent`, `patchOrgAgent`, `publishOrgAgent`, `retireOrgAgent`,
 *    `forkOrgAgent`, `listOrgAgentAudit` — hit `/api/orgs/:orgId/agents…`.
 *    The `OrgCatalogAgent` type carries `org_id` (not `project_id`).
 *
 * 2. **Project binding helpers** (spec 123 §5.2): `listProjectAgentBindings`,
 *    `bindAgent`, `repinBinding`, `unbindAgent` — hit
 *    `/api/projects/:projectId/agents…` (now binding endpoints, not CRUD).
 */

import type {
  AgentCatalogAuditAction,
  AgentCatalogStatus,
} from "../../../api/db/schema";
import type { CatalogFrontmatter } from "../../../api/agents/frontmatter";

export type {
  AgentCatalogAuditAction,
  AgentCatalogStatus,
};
export type { CatalogFrontmatter };

const DEFAULT_API_BASE = "http://localhost:4000";

function getBaseUrl(_request: Request): string {
  return process.env.ENCORE_API_BASE_URL ?? DEFAULT_API_BASE;
}

async function apiFetch(request: Request, path: string, init?: RequestInit) {
  const base = getBaseUrl(request);
  const cookie = request.headers.get("Cookie") ?? "";
  const res = await fetch(`${base}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(cookie && { Cookie: cookie }),
      ...init?.headers,
    },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(body || `API error: ${res.status}`);
  }
  return res.json();
}

// ---------------------------------------------------------------------------
// Org-scoped types (spec 123 §5.1)
// ---------------------------------------------------------------------------

/** Wire shape for org-scoped agent catalog rows (spec 123). */
export type OrgCatalogAgent = {
  id: string;
  org_id: string;
  name: string;
  version: number;
  status: AgentCatalogStatus;
  frontmatter: CatalogFrontmatter;
  body_markdown: string;
  content_hash: string;
  created_by: string;
  created_at: string;
  updated_at: string;
};

export type OrgCatalogAuditEntry = {
  id: string;
  agent_id: string;
  org_id: string;
  action: AgentCatalogAuditAction;
  actor_user_id: string;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  created_at: string;
};

// ---------------------------------------------------------------------------
// Project binding types (spec 123 §5.2)
// ---------------------------------------------------------------------------

/** Wire shape from `api/agents/bindings.ts` (spec 123). */
export type ProjectAgentBinding = {
  binding_id: string;
  project_id: string;
  org_agent_id: string;
  agent_name: string;
  pinned_version: number;
  pinned_content_hash: string;
  /** `retired_upstream` when the catalog row was retired after bind time (I-B3). */
  status: "active" | "retired_upstream";
  bound_by: string;
  bound_at: string; // ISO-8601
};

// ---------------------------------------------------------------------------
// Org-scoped helpers (spec 123 §5.1)
// ---------------------------------------------------------------------------

export async function listOrgAgents(
  request: Request,
  orgId: string,
  status?: AgentCatalogStatus,
) {
  const qs = status ? `?status=${encodeURIComponent(status)}` : "";
  return apiFetch(
    request,
    `/api/orgs/${orgId}/agents${qs}`,
  ) as Promise<{ agents: OrgCatalogAgent[] }>;
}

export async function getOrgAgent(
  request: Request,
  orgId: string,
  id: string,
) {
  return apiFetch(
    request,
    `/api/orgs/${orgId}/agents/${id}`,
  ) as Promise<{ agent: OrgCatalogAgent }>;
}

export async function createOrgAgent(
  request: Request,
  orgId: string,
  data: {
    name: string;
    frontmatter: CatalogFrontmatter;
    body_markdown: string;
  },
) {
  return apiFetch(request, `/api/orgs/${orgId}/agents`, {
    method: "POST",
    body: JSON.stringify(data),
  }) as Promise<{ agent: OrgCatalogAgent }>;
}

export async function patchOrgAgent(
  request: Request,
  orgId: string,
  id: string,
  data: {
    frontmatter?: CatalogFrontmatter;
    body_markdown?: string;
    expected_content_hash?: string;
  },
) {
  return apiFetch(request, `/api/orgs/${orgId}/agents/${id}`, {
    method: "PATCH",
    body: JSON.stringify(data),
  }) as Promise<{ agent: OrgCatalogAgent }>;
}

export async function publishOrgAgent(
  request: Request,
  orgId: string,
  id: string,
) {
  return apiFetch(request, `/api/orgs/${orgId}/agents/${id}/publish`, {
    method: "POST",
    body: "{}",
  }) as Promise<{ agent: OrgCatalogAgent; retired?: OrgCatalogAgent }>;
}

export async function retireOrgAgent(
  request: Request,
  orgId: string,
  id: string,
) {
  return apiFetch(request, `/api/orgs/${orgId}/agents/${id}/retire`, {
    method: "POST",
    body: "{}",
  }) as Promise<{ agent: OrgCatalogAgent }>;
}

export async function forkOrgAgent(
  request: Request,
  orgId: string,
  id: string,
  newName: string,
) {
  return apiFetch(request, `/api/orgs/${orgId}/agents/${id}/fork`, {
    method: "POST",
    body: JSON.stringify({ new_name: newName }),
  }) as Promise<{ agent: OrgCatalogAgent }>;
}

export async function listOrgAgentAudit(
  request: Request,
  orgId: string,
  id: string,
) {
  return apiFetch(
    request,
    `/api/orgs/${orgId}/agents/${id}/audit`,
  ) as Promise<{ entries: OrgCatalogAuditEntry[] }>;
}

// ---------------------------------------------------------------------------
// Project binding helpers (spec 123 §5.2)
// ---------------------------------------------------------------------------

export async function listProjectAgentBindings(
  request: Request,
  projectId: string,
) {
  return apiFetch(
    request,
    `/api/projects/${projectId}/agents`,
  ) as Promise<{ bindings: ProjectAgentBinding[] }>;
}

export async function bindAgent(
  request: Request,
  projectId: string,
  body: { org_agent_id: string; version: number },
) {
  return apiFetch(request, `/api/projects/${projectId}/agents/bind`, {
    method: "POST",
    body: JSON.stringify(body),
  }) as Promise<{ binding: ProjectAgentBinding }>;
}

export async function repinBinding(
  request: Request,
  projectId: string,
  bindingId: string,
  body: { version: number },
) {
  return apiFetch(request, `/api/projects/${projectId}/agents/${bindingId}`, {
    method: "PATCH",
    body: JSON.stringify(body),
  }) as Promise<{ binding: ProjectAgentBinding }>;
}

export async function unbindAgent(
  request: Request,
  projectId: string,
  bindingId: string,
) {
  return apiFetch(request, `/api/projects/${projectId}/agents/${bindingId}`, {
    method: "DELETE",
  }) as Promise<{ ok: true }>;
}
