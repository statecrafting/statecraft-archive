// Spec 175 — Remix loader helper for `GET /api/projects/:projectId/dashboard`.
//
// Mirrors `spec-registry-api.server.ts`: SSR-side cookie forwarding so the
// route loader can call the Encore endpoint while preserving the user's
// session. One round-trip per page load (FR-002 / SC-007).

import type { ProjectDashboardSnapshot } from "../../../api/projectDashboard/types";

const DEFAULT_API_BASE = "http://localhost:4000";

function getBaseUrl(_request: Request): string {
  return process.env.ENCORE_API_BASE_URL ?? DEFAULT_API_BASE;
}

export async function getProjectDashboard(
  request: Request,
  projectId: string
): Promise<ProjectDashboardSnapshot> {
  const base = getBaseUrl(request);
  const cookie = request.headers.get("Cookie") ?? "";
  const res = await fetch(
    `${base}/api/projects/${encodeURIComponent(projectId)}/dashboard`,
    {
      headers: {
        "Content-Type": "application/json",
        ...(cookie && { Cookie: cookie }),
      },
    }
  );
  if (!res.ok) {
    const body = await res.text();
    const err = new Error(body || `dashboard API error: ${res.status}`) as Error & {
      status?: number;
    };
    err.status = res.status;
    throw err;
  }
  return (await res.json()) as ProjectDashboardSnapshot;
}
