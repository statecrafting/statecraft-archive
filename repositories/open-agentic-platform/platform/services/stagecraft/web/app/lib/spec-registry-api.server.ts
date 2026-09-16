// Spec 163 — server-side fetch helpers for the Requirements view.
//
// Mirrors the pattern in `project-api.server.ts`: direct fetch with
// cookie forwarding so the React Router v7 loader can call the Encore
// API while preserving the user's session.

import type {
  SpecDetail,
  SpecInventory,
  SpecRelationships,
} from "../../../api/specRegistry/types";

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
    const err = new Error(body || `API error: ${res.status}`) as Error & {
      status?: number;
    };
    err.status = res.status;
    throw err;
  }
  return res.json();
}

const specsBase = (projectId: string) =>
  `/api/projects/${encodeURIComponent(projectId)}/specs`;

/** FR-001 — inventory loader. Returns the registryAvailable flag. */
export async function listProjectSpecs(
  request: Request,
  projectId: string
): Promise<SpecInventory> {
  return apiFetch(request, specsBase(projectId)) as Promise<SpecInventory>;
}

/** FR-006 — single spec record + body. */
export async function showProjectSpec(
  request: Request,
  projectId: string,
  specId: string
): Promise<{ spec: SpecDetail }> {
  return apiFetch(
    request,
    `${specsBase(projectId)}/${encodeURIComponent(specId)}`
  ) as Promise<{ spec: SpecDetail }>;
}

/** FR-006 — outgoing + incoming relationship edges. */
export async function showProjectSpecRelationships(
  request: Request,
  projectId: string,
  specId: string
): Promise<{ relationships: SpecRelationships }> {
  return apiFetch(
    request,
    `${specsBase(projectId)}/${encodeURIComponent(specId)}/relationships`
  ) as Promise<{ relationships: SpecRelationships }>;
}

// ---------------------------------------------------------------------------
// Cosmetic group display names (FR-004)
// ---------------------------------------------------------------------------

const groupNamesBase = (projectId: string) =>
  `/api/projects/${encodeURIComponent(projectId)}/spec-group-names`;

export interface SpecGroupNameRow {
  groupId: string;
  displayName: string;
}

export async function listSpecGroupNames(
  request: Request,
  projectId: string
): Promise<{ names: SpecGroupNameRow[] }> {
  return apiFetch(request, groupNamesBase(projectId)) as Promise<{
    names: SpecGroupNameRow[];
  }>;
}

export async function setSpecGroupName(
  request: Request,
  projectId: string,
  groupId: string,
  displayName: string
): Promise<{ name: SpecGroupNameRow }> {
  return apiFetch(
    request,
    `${groupNamesBase(projectId)}/${encodeURIComponent(groupId)}`,
    {
      method: "PUT",
      body: JSON.stringify({ displayName }),
    }
  ) as Promise<{ name: SpecGroupNameRow }>;
}

export async function deleteSpecGroupName(
  request: Request,
  projectId: string,
  groupId: string
): Promise<{ deleted: boolean }> {
  return apiFetch(
    request,
    `${groupNamesBase(projectId)}/${encodeURIComponent(groupId)}`,
    { method: "DELETE" }
  ) as Promise<{ deleted: boolean }>;
}
